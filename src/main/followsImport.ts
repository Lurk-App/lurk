// "Von Twitch übernehmen" with Twitch's device code: Lurk asks Twitch for a code, the user signs in
// and confirms it in their own browser, Lurk reads only whom they follow, ends the sign-in at once
// and – after the user's "Übernehmen" – subscribes to those channels.
//
// Security (reviewed 2026-11-23, see the plan and SECURITY.md):
// - Lurk's own public client, the single scope user:read:follows; no secret exists.
// - The device code and the tokens stay in this module: never sent to a page, never logged, never
//   written, never part of an error. The window hears only the phase (shared/follows.ts).
// - Every request goes through a private in-memory session to fixed addresses, without cookies,
//   without following redirects (a redirect would send the token along) and without a cache.
// - The tokens are revoked right after reading, before anything is subscribed, and whenever the
//   window closes, the user starts over or Lurk quits; a token that arrives late is revoked at once.
// - No console output here: whatever fails becomes a reason code.

import { app, clipboard, session, type Session } from 'electron';
import {
  activationURL,
  checkValidation,
  classifyPoll,
  codeMinutes,
  collectFollows,
  followedChannelsURL,
  followsScope,
  parseDeviceGrant,
  parseFollowsPage,
  rateLimitWait,
  type DeviceGrant,
  type FollowsFailure,
  type FollowsPhase,
} from '@shared/follows';
import type { ChannelRef } from '@shared/models';
import { lurkTwitchClientId } from '@shared/twitchClient';
import { libraryStore } from './libraryStore';
import { liveMonitor } from './liveMonitor';
import { openExternal } from './security';

const requestTimeoutMs = 15_000;
/** Revoking may hold up closing or quitting this long at most. */
const revokeTimeoutMs = 3_000;
const minimumIntervalSeconds = 5;
const maxNetworkFailures = 3;
const deviceGrantType = 'urn:ietf:params:oauth:grant-type:device_code';

/** Lurk's client id. A development build may take another from LURK_TWITCH_CLIENT_ID (the tour). */
export function followsClientId(): string {
  const override = app.isPackaged ? undefined : process.env['LURK_TWITCH_CLIENT_ID'];
  return override && /^[a-z0-9]{10,64}$/.test(override) ? override : lurkTwitchClientId;
}

interface Tokens {
  access: string;
  refresh: string | null;
}

interface Answer {
  status: number;
  body: unknown;
  rateLimitReset: string | null;
}

type Listener = (phase: FollowsPhase) => void;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('stopped'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('stopped'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function atMost(promise: Promise<unknown>, ms: number): Promise<void> {
  return Promise.race([promise.then(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, ms))]);
}

class FollowsImport {
  private phase: FollowsPhase = { kind: 'preparing' };
  private listeners = new Set<Listener>();
  /** Raised for every new attempt and whenever it ends: answers of an older attempt are dropped. */
  private attempt = 0;
  private controller: AbortController | null = null;
  private grant: DeviceGrant | null = null;
  /** Only between the confirmation and the revoke, a few seconds. */
  private tokens: Tokens | null = null;
  /** The token request on its way (it is never cut off, so a token it brings can be revoked). */
  private poll: Promise<unknown> | null = null;
  private pending: ChannelRef[] = [];
  private forgetting: Promise<void> | null = null;
  private sessionUsed = false;

  get(): FollowsPhase {
    return this.phase;
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** A new code (the window opened, or "Erneut versuchen" after the last attempt was forgotten). */
  start(): void {
    if (this.forgetting) {
      void this.forgetting.then(() => this.start());
      return;
    }
    const attempt = ++this.attempt;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.set({ kind: 'preparing' });
    void this.run(attempt, controller.signal).catch(() => {
      if (this.isCurrent(attempt)) this.fail('failed');
    });
  }

  /** "Erneut versuchen": ignored while the last attempt is still being forgotten. */
  retry(): void {
    if (this.forgetting) return;
    void this.forget().then(() => this.start());
  }

  /** "Twitch im Browser öffnen": Lurk's own address with the code shown; nothing from the page. */
  openActivation(): void {
    if (this.phase.kind === 'code' && this.grant) openExternal(activationURL(this.grant.userCode));
  }

  /** "Code kopieren": the code shown, written by the main process. */
  copyCode(): void {
    if (this.phase.kind === 'code' && this.grant) clipboard.writeText(this.grant.userCode);
  }

  /** "Übernehmen": the sign-in is already ended; only now are the channels subscribed. */
  confirm(): void {
    if (this.phase.kind !== 'confirm') return;
    const channels = this.pending;
    this.pending = [];
    const added = libraryStore.subscribe(channels);
    if (added) void liveMonitor.refresh();
    this.set({ kind: 'done', added, total: channels.length });
  }

  /** The window closed (also after its page crashed): stop, revoke, forget. */
  windowClosed(): void {
    void this.forget().then(() => this.set({ kind: 'preparing' }));
  }

  /**
   * Stops the attempt, waits for a token request on its way, revokes what there is and clears the
   * private session – at most a few seconds. Calling it twice is harmless.
   */
  forget(): Promise<void> {
    if (this.forgetting) return this.forgetting;
    this.attempt++;
    this.controller?.abort();
    this.controller = null;
    this.grant = null;
    this.pending = [];
    const clientId = followsClientId();
    this.forgetting = (async () => {
      try {
        await atMost(
          Promise.allSettled([this.poll ?? Promise.resolve(), this.revokeTokens(clientId)]),
          revokeTimeoutMs,
        );
        await this.clearSession();
      } catch {
        // Nothing to report: the session is in memory only and ends with Lurk.
      } finally {
        this.forgetting = null;
      }
    })();
    return this.forgetting;
  }

  private async run(attempt: number, signal: AbortSignal): Promise<void> {
    const clientId = followsClientId();
    if (!clientId) return this.fail('failed');
    const started = await this.send(
      'https://id.twitch.tv/oauth2/device',
      { method: 'POST', form: { client_id: clientId, scopes: followsScope } },
      signal,
    );
    if (!this.isCurrent(attempt)) return;
    const grant = started.status === 200 ? parseDeviceGrant(started.body) : null;
    if (!grant) return this.fail('failed');
    this.grant = grant;
    this.set({ kind: 'code', userCode: grant.userCode, minutes: codeMinutes(grant.expiresIn) });

    const tokens = await this.waitForConfirmation(attempt, signal, clientId, grant);
    if (!tokens) return;
    this.tokens = tokens;
    if (!this.isCurrent(attempt)) {
      await this.revokeTokens(clientId);
      return;
    }
    this.grant = null;
    this.set({ kind: 'reading', count: 0 });
    const result = await this.read(attempt, signal, clientId, tokens)
      .catch(() => null)
      // Before anything is subscribed: subscribing needs no token.
      .finally(() => this.revokeTokens(clientId));
    if (!this.isCurrent(attempt)) return;
    await this.clearSession();
    if (!this.isCurrent(attempt)) return;
    if (!result) return this.fail('failed');
    if (!result.channels.length) return this.fail('empty');
    this.pending = result.channels;
    this.set({ kind: 'confirm', login: result.login, count: result.channels.length });
  }

  /** Asks every few seconds whether the user confirmed; null when the attempt ended otherwise. */
  private async waitForConfirmation(
    attempt: number,
    signal: AbortSignal,
    clientId: string,
    grant: DeviceGrant,
  ): Promise<Tokens | null> {
    const deadline = performance.now() + grant.expiresIn * 1000;
    let interval = Math.max(minimumIntervalSeconds, grant.interval);
    let failures = 0;
    for (;;) {
      await sleep(interval * 1000, signal);
      if (!this.isCurrent(attempt)) return null;
      if (performance.now() >= deadline) {
        this.fail('expired');
        return null;
      }
      const request = this.requestToken(attempt, clientId, grant);
      this.poll = request;
      const answer = await request;
      if (this.poll === request) this.poll = null;
      if (!this.isCurrent(attempt)) return null;
      if (answer === null) {
        failures += 1;
        if (failures >= maxNetworkFailures) {
          this.fail('failed');
          return null;
        }
        continue;
      }
      failures = 0;
      switch (answer.outcome.kind) {
        case 'token':
          return { access: answer.outcome.accessToken, refresh: answer.outcome.refreshToken };
        case 'pending':
          break;
        case 'slowDown':
          interval += 5;
          break;
        case 'rateLimited':
          await sleep(rateLimitWait(answer.rateLimitReset) * 1000, signal);
          break;
        case 'expired':
        case 'denied':
          this.fail(answer.outcome.kind);
          return null;
        default:
          this.fail('failed');
          return null;
      }
    }
  }

  /**
   * One token request. It is not cut off when the attempt ends: if it still brings a token, that
   * token is revoked at once and nothing else is done with it.
   */
  private async requestToken(
    attempt: number,
    clientId: string,
    grant: DeviceGrant,
  ): Promise<{ outcome: ReturnType<typeof classifyPoll>; rateLimitReset: string | null } | null> {
    let answer: Answer;
    try {
      answer = await this.send(
        'https://id.twitch.tv/oauth2/token',
        {
          method: 'POST',
          form: {
            client_id: clientId,
            scopes: followsScope,
            device_code: grant.deviceCode,
            grant_type: deviceGrantType,
          },
        },
        new AbortController().signal,
      );
    } catch {
      return null;
    }
    const outcome = classifyPoll(answer.status, answer.body);
    if (outcome.kind === 'token' && !this.isCurrent(attempt)) {
      await this.revoke(outcome.refreshToken, clientId);
      await this.revoke(outcome.accessToken, clientId);
      return null;
    }
    return { outcome, rateLimitReset: answer.rateLimitReset };
  }

  private async read(
    attempt: number,
    signal: AbortSignal,
    clientId: string,
    tokens: Tokens,
  ): Promise<{ login: string; channels: ChannelRef[] } | null> {
    const checked = await this.send(
      'https://id.twitch.tv/oauth2/validate',
      { method: 'GET', headers: { Authorization: `OAuth ${tokens.access}` } },
      signal,
    );
    const user = checked.status === 200 ? checkValidation(checked.body, clientId) : null;
    if (!user) return null;
    const channels = await collectFollows(
      async (cursor) => {
        for (;;) {
          const page = await this.send(
            followedChannelsURL(user.userId, cursor),
            { method: 'GET', headers: { 'Client-Id': clientId, Authorization: `Bearer ${tokens.access}` } },
            signal,
          );
          if (page.status === 429) {
            await sleep(rateLimitWait(page.rateLimitReset) * 1000, signal);
            continue;
          }
          if (page.status !== 200) throw new Error('follows');
          return parseFollowsPage(page.body);
        }
      },
      (count) => {
        if (this.isCurrent(attempt)) this.set({ kind: 'reading', count });
      },
    );
    return { login: user.login, channels };
  }

  /** Takes the tokens (so nobody revokes them twice) and revokes the refresh token, then the access token. */
  private async revokeTokens(clientId: string): Promise<void> {
    const tokens = this.tokens;
    this.tokens = null;
    if (!tokens) return;
    await this.revoke(tokens.refresh, clientId);
    await this.revoke(tokens.access, clientId);
  }

  /** 200, and 400 "Invalid token" (already ended), both count as done; nothing else can be done. */
  private async revoke(token: string | null, clientId: string): Promise<void> {
    if (!token || !clientId) return;
    try {
      await this.send(
        'https://id.twitch.tv/oauth2/revoke',
        { method: 'POST', form: { client_id: clientId, token } },
        new AbortController().signal,
        revokeTimeoutMs,
      );
    } catch {
      // Twitch could not be reached; the token ends with its lifetime (about four hours).
    }
  }

  private privateSession(): Session {
    const target = session.fromPartition('follows', { cache: false });
    if (!this.sessionUsed) {
      this.sessionUsed = true;
      // No page ever runs in this session; refuse everything all the same.
      target.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      target.setPermissionCheckHandler(() => false);
      target.setDevicePermissionHandler(() => false);
    }
    return target;
  }

  private async clearSession(): Promise<void> {
    if (!this.sessionUsed) return;
    const target = this.privateSession();
    await Promise.allSettled([
      target.clearData(),
      target.clearStorageData(),
      target.clearAuthCache(),
      target.clearHostResolverCache(),
    ]);
    await target.closeAllConnections();
  }

  /** Fixed addresses only; no cookies, no redirects, no cache. Errors carry no request details. */
  private async send(
    url: string,
    request: { method: 'GET' | 'POST'; headers?: Record<string, string>; form?: Record<string, string> },
    signal: AbortSignal,
    timeoutMs: number = requestTimeoutMs,
  ): Promise<Answer> {
    const response = await this.privateSession().fetch(url, {
      method: request.method,
      headers: {
        ...(request.form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...request.headers,
      },
      body: request.form ? new URLSearchParams(request.form).toString() : undefined,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    });
    const body: unknown = await response.json().catch(() => null);
    return { status: response.status, body, rateLimitReset: response.headers.get('ratelimit-reset') };
  }

  private isCurrent(attempt: number): boolean {
    return attempt === this.attempt;
  }

  private fail(reason: FollowsFailure): void {
    this.set({ kind: 'failed', reason });
  }

  private set(phase: FollowsPhase): void {
    this.phase = phase;
    for (const listener of this.listeners) listener(phase);
  }
}

export const followsImport = new FollowsImport();
