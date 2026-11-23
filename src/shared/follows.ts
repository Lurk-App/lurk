// "Von Twitch übernehmen": the follows of a Twitch account, read once with Twitch's device code
// (the user signs in and confirms in their own browser) and Lurk's own public client. What the
// main process checks in Twitch's answers, and what the import window hears. Everything here is
// data: Twitch's answers are never trusted, and tokens never leave the main process.
//
// The macOS app embeds twitch.tv's login instead (lurk-macos, Sources/Lurk/Views/FollowsImport.swift);
// the desktop app asks in the user's browser (decided 2026-11-23, see the plan and SECURITY.md).

import type { ChannelRef } from './models';
import { normalizeLogin, subscriptionLimit } from './subscriptions';

/** The only permission Lurk asks for. */
export const followsScope = 'user:read:follows';

/** Why the import ended without channels. */
export type FollowsFailure = 'empty' | 'expired' | 'denied' | 'failed';

/** What the import window shows; tokens and the device code are never part of it. */
export type FollowsPhase =
  | { kind: 'preparing' }
  | { kind: 'code'; userCode: string; minutes: number }
  | { kind: 'reading'; count: number }
  | { kind: 'confirm'; login: string; count: number }
  | { kind: 'done'; added: number; total: number }
  | { kind: 'failed'; reason: FollowsFailure };

export interface DeviceGrant {
  deviceCode: string;
  userCode: string;
  expiresIn: number;
  interval: number;
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const integerIn = (value: unknown, min: number, max: number): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;

/** Twitch's answer to starting the device code, or null when it is not one. */
export function parseDeviceGrant(raw: unknown): DeviceGrant | null {
  const answer = record(raw);
  const deviceCode = answer['device_code'];
  const userCode = answer['user_code'];
  const expiresIn = integerIn(answer['expires_in'], 1, 3600);
  const interval = integerIn(answer['interval'], 1, 60);
  if (typeof deviceCode !== 'string' || !/^[\x21-\x7e]{8,256}$/.test(deviceCode)) return null;
  if (typeof userCode !== 'string' || !/^[A-Z0-9-]{4,16}$/.test(userCode)) return null;
  if (expiresIn === null || interval === null) return null;
  return { deviceCode, userCode, expiresIn, interval };
}

/**
 * Where the user confirms – built by Lurk from the user code alone, never taken from Twitch's
 * answer, so the secret device code can never end up in an address.
 */
export function activationURL(userCode: string): string {
  return `https://www.twitch.tv/activate?${new URLSearchParams({ public: 'true', 'device-code': userCode })}`;
}

/** The minutes the code is valid, as the window says it ("Er gilt 30 Minuten"). */
export function codeMinutes(expiresIn: number): number {
  return Math.max(1, Math.round(expiresIn / 60));
}

const tokenPattern = /^[A-Za-z0-9]{10,200}$/;

/** One answer while Lurk waits for the user's confirmation. */
export type PollOutcome =
  | { kind: 'token'; accessToken: string; refreshToken: string | null }
  | { kind: 'pending' }
  | { kind: 'slowDown' }
  | { kind: 'rateLimited' }
  | { kind: 'expired' }
  | { kind: 'denied' }
  | { kind: 'failed' };

/** Sorts an answer of the token endpoint. Twitch writes errors in `message`, the standard in `error`. */
export function classifyPoll(status: number, raw: unknown): PollOutcome {
  const answer = record(raw);
  if (status === 200) {
    const access = answer['access_token'];
    const refresh = answer['refresh_token'];
    if (typeof access !== 'string' || !tokenPattern.test(access)) return { kind: 'failed' };
    return {
      kind: 'token',
      accessToken: access,
      refreshToken: typeof refresh === 'string' && tokenPattern.test(refresh) ? refresh : null,
    };
  }
  if (status === 429) return { kind: 'rateLimited' };
  const text = [answer['message'], answer['error']]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  if (text.includes('authorization_pending')) return { kind: 'pending' };
  if (text.includes('slow_down')) return { kind: 'slowDown' };
  if (text.includes('invalid device code') || text.includes('expired')) return { kind: 'expired' };
  if (text.includes('denied')) return { kind: 'denied' };
  return { kind: 'failed' };
}

/** `validate`'s answer: only for Lurk's own client, with a user and the follows permission. */
export function checkValidation(raw: unknown, clientId: string): { userId: string; login: string } | null {
  const answer = record(raw);
  const userId = answer['user_id'];
  const login = typeof answer['login'] === 'string' ? normalizeLogin(answer['login']) : null;
  const scopes = answer['scopes'];
  if (!clientId || answer['client_id'] !== clientId) return null;
  if (typeof userId !== 'string' || !/^\d{1,20}$/.test(userId) || !login) return null;
  if (!Array.isArray(scopes) || !scopes.includes(followsScope)) return null;
  return { userId, login };
}

/** The address of one page of followed channels. */
export function followedChannelsURL(userId: string, cursor: string | null): string {
  const query = new URLSearchParams({ user_id: userId, first: '100' });
  if (cursor) query.set('after', cursor);
  return `https://api.twitch.tv/helix/channels/followed?${query}`;
}

/** One page of Twitch's "Get Followed Channels": the channels kept and the cursor to the next. */
export function parseFollowsPage(raw: unknown): { channels: ChannelRef[]; cursor: string | null } {
  const answer = record(raw);
  const data = answer['data'];
  const channels: ChannelRef[] = [];
  for (const item of Array.isArray(data) ? data : []) {
    const entry = record(item);
    const id = entry['broadcaster_id'];
    const login = typeof entry['broadcaster_login'] === 'string' ? normalizeLogin(entry['broadcaster_login']) : null;
    const name = entry['broadcaster_name'];
    if (typeof id !== 'string' || !/^\d{1,20}$/.test(id) || !login) continue;
    channels.push({
      id,
      login,
      displayName: typeof name === 'string' && name.trim() ? name.slice(0, 100) : login,
      profileImageURL: null,
    });
  }
  const cursor = record(answer['pagination'])['cursor'];
  return { channels, cursor: typeof cursor === 'string' && /^[A-Za-z0-9_=-]{1,512}$/.test(cursor) ? cursor : null };
}

/**
 * Reads page after page until there is no next one, a cursor repeats, or the subscription limit
 * is reached; each channel once.
 */
export async function collectFollows(
  page: (cursor: string | null) => Promise<{ channels: ChannelRef[]; cursor: string | null }>,
  onProgress: (count: number) => void,
  limit: number = subscriptionLimit,
): Promise<ChannelRef[]> {
  const byId = new Map<string, ChannelRef>();
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const next = await page(cursor);
    for (const channel of next.channels) {
      if (byId.size >= limit) break;
      if (!byId.has(channel.id)) byId.set(channel.id, channel);
    }
    onProgress(byId.size);
    cursor = next.cursor && !seen.has(next.cursor) ? next.cursor : null;
    if (cursor) seen.add(cursor);
  } while (cursor && byId.size < limit);
  return [...byId.values()];
}

/** The seconds Twitch asks to wait after HTTP 429 (`Ratelimit-Reset` is a Unix time), 1–60. */
export function rateLimitWait(reset: string | null, now: number = Date.now()): number {
  const at = Number(reset);
  if (!Number.isFinite(at) || at <= 0) return 10;
  return Math.min(60, Math.max(1, Math.ceil(at - now / 1000)));
}

/** The phase as the page receives it: checked before it is shown. */
export function isFollowsPhase(value: unknown): value is FollowsPhase {
  const phase = record(value);
  switch (phase['kind']) {
    case 'preparing':
      return true;
    case 'code':
      return typeof phase['userCode'] === 'string' && typeof phase['minutes'] === 'number';
    case 'reading':
      return typeof phase['count'] === 'number';
    case 'confirm':
      return typeof phase['login'] === 'string' && typeof phase['count'] === 'number';
    case 'done':
      return typeof phase['added'] === 'number' && typeof phase['total'] === 'number';
    case 'failed':
      return ['empty', 'expired', 'denied', 'failed'].includes(phase['reason'] as string);
    default:
      return false;
  }
}
