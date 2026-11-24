// Tour, part "adswitch": the ad-break switch with real streams. Two live channels are subscribed
// (one with watch time); the tour puts an ad break into the playing channel by rewriting Twitch's
// playlists (installed through Playwright, everything else passed through – no hook in the app,
// as in tour/adbreaks.spec.ts). It checks the switch with its banner and the return, "Zurück",
// "Bei B bleiben", the "…" menu's switch, and the ranking in "Replay & Werbung". Needs network.

import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dePlayer from '../locales/de/player.json' with { type: 'json' };
import deSettings from '../locales/de/settings.json' with { type: 'json' };
import enPlayer from '../locales/en/player.json' with { type: 'json' };
import enSettings from '../locales/en/settings.json' with { type: 'json' };
import type { BrowseStream } from '../src/shared/browse';
import type { ChannelRef } from '../src/shared/models';
import { askAgain, liveStreams, playFromSearch, playing, searchableLiveStreams } from './live';

const screenshots = path.join('tour', 'out', process.platform);
let app: ElectronApplication;
let page: Page;
let dataDir: string;
let player: typeof enPlayer;
let settingsText: typeof enSettings;
/** The channel that plays first, and the two subscribed ones (the second with watch time). */
let primary: { login: string; displayName: string };
let favourite: { id: string; login: string; displayName: string };
let other: { id: string; login: string; displayName: string };
/** The rest of the top list, for a favourite whose stream ends. */
let spares: BrowseStream[] = [];

interface TourAds {
  /** The channel whose sessions get the ad; empty while none is planned. */
  login: string;
  start: number;
  end: number;
  /** Media playlist (without query) → the channel of its session. */
  channelOf: Record<string, string>;
  /** Channels whose sessions were opened, in order. */
  opened: string[];
  /** Channel → when Twitch last answered its session or one of its playlists (ms since epoch). */
  answeredAt: Record<string, number>;
  /** Channel → when Lurk last asked for one of its playlists, whatever Twitch answered (ms since epoch). */
  askedAt: Record<string, number>;
  /** Channel → whether its latest playlist carried Twitch's own ad (before the tour's). */
  twitchAd: Record<string, boolean>;
  /** Channel → whether its latest playlist was marked as ended. */
  ended: Record<string, boolean>;
}

test.describe.configure({ mode: 'serial', timeout: 240_000 });

const ads = () => app.evaluate(() => (globalThis as unknown as { tourAds: TourAds }).tourAds) as Promise<TourAds>;

/**
 * Marked from this far back, so every session's live edge has the ad at once: Twitch's sessions lag
 * by different amounts, and one still showing what came before the start would be ad-free – Lurk
 * would rightly go on from it (CI, 2026-11-24).
 */
const adLeadMs = 20_000;

/** An ad in every session of `login`, at the live edge for `seconds` from now. */
async function planAd(login: string, seconds: number): Promise<void> {
  await app.evaluate(
    (_electron, { who, length, lead }) => {
      const state = (globalThis as unknown as { tourAds: TourAds }).tourAds;
      state.login = who;
      state.start = Date.now() - lead;
      state.end = Date.now() + length * 1000;
    },
    { who: login, length: seconds, lead: adLeadMs },
  );
}

async function adOver(): Promise<void> {
  await expect.poll(async () => (await ads()).end < Date.now(), { timeout: 90_000 }).toBe(true);
}

/** A channel's details, asked again when Twitch fails them ("service error", seen on Windows). */
const channelDetails = (login: string) =>
  askAgain(() => page.evaluate((who) => window.lurk.twitch.channel(who), login));

/**
 * Until Lurk's live status has every channel of `ids` live. A failed answer keeps the last statuses
 * until the next refresh two minutes later; the tour asks again, as "Aktualisieren" does.
 */
async function liveInLurk(ids: string[]): Promise<void> {
  await expect
    .poll(
      async () => {
        const live = await page.evaluate(() => window.lurk.subscriptions.live());
        if (live.failed && !live.refreshing) await page.evaluate(() => window.lurk.subscriptions.refresh());
        return ids.every((id) => live.statuses[id]?.stream);
      },
      { timeout: 60_000 },
    )
    .toBe(true);
}

/** Lurk passes over a candidate read longer ago than this (shared/adBreaks.ts, freshForMs). */
const freshForMs = 10_000;

type Seen = 'clear' | 'ended' | 'unread' | 'waiting';

/**
 * What the tour saw of `login`'s sessions lately: read without Twitch's ad, ended (Lurk asks, Twitch
 * no longer answers), no longer asked for by Lurk, or none of these yet.
 */
function sessionSeen(login: string): Promise<Seen> {
  return app.evaluate(
    (_electron, { who, fresh }): Seen => {
      const state = (globalThis as unknown as { tourAds: TourAds }).tourAds;
      const now = Date.now();
      if (state.ended[who]) return 'ended';
      if (now - (state.answeredAt[who] ?? 0) > fresh) {
        return now - (state.askedAt[who] ?? 0) > fresh ? 'unread' : 'ended';
      }
      return state.twitchAd[who] === false ? 'clear' : 'waiting';
    },
    { who: login, fresh: freshForMs },
  );
}

/**
 * Before a break: until favourite's background session was read lately without Twitch's own ad.
 * While it has one (a fresh session's pre-roll, a commercial), Lurk rightly shows `other`. When
 * favourite's stream ended (seen locally), another live channel takes its place.
 */
async function favouriteClear(): Promise<void> {
  test.setTimeout(test.info().timeout + 120_000);
  let seen = 'waiting' as Seen;
  await expect
    .poll(
      async () => {
        seen = await sessionSeen(favourite.login);
        // Lurk stops reading a subscribed channel only once its live status has it offline; one it
        // drops while live is Lurk's fault, and the step fails here instead of replacing it.
        if (seen === 'unread') {
          const live = await page.evaluate(() => window.lurk.subscriptions.live());
          if (!live.statuses[favourite.id]?.stream) seen = 'ended';
        }
        return seen === 'clear' || seen === 'ended';
      },
      { timeout: 120_000, message: `${favourite.displayName} read by Lurk without ads, or ended` },
    )
    .toBe(true);
  if (seen === 'clear') return;
  await replaceFavourite();
  await expect
    .poll(() => sessionSeen(favourite.login), {
      timeout: 120_000,
      message: `${favourite.displayName} read without ads`,
    })
    .toBe('clear');
}

/**
 * Favourite's stream ended: the next live channel of the top list is subscribed, with clearly more
 * watch time than any so far, and is favourite from here on once Lurk reads it in the background.
 */
async function replaceFavourite(): Promise<void> {
  test.setTimeout(test.info().timeout + 300_000);
  let next: ChannelRef | null = null;
  while (!next && spares.length > 0) {
    const details = await channelDetails(spares.shift()!.broadcaster.login);
    if (details?.stream) next = details.ref;
  }
  expect(next, `a live channel in place of ${favourite.displayName}, whose stream ended`).toBeTruthy();
  const replacement = next!;
  await page.evaluate((ref) => window.lurk.subscriptions.subscribe(ref), replacement);
  // Ten minutes above the subscription watched longest (also an earlier replacement), at most 10 s
  // at a time, as the player counts.
  const library = await page.evaluate(() => window.lurk.library.get());
  const most = Math.max(0, ...library.subscriptions.map((entry) => library.watchTime[entry.id] ?? 0));
  const ticks = Math.ceil((most + 600) / 10);
  for (let i = 0; i < ticks; i++) await page.evaluate((id) => window.lurk.library.addWatchTime(id, 10), replacement.id);
  favourite = replacement;
  await liveInLurk([favourite.id]);
  // The switch asks for its candidates every minute and opens a session for a new one.
  await expect.poll(async () => (await ads()).opened, { timeout: 90_000 }).toContain(favourite.login);
}

test.beforeAll(async () => {
  // The setup asks Twitch again when it fails (askAgain, "Aktualisieren"): more time than a step.
  test.setTimeout(test.info().timeout + 120_000);
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'lurk-tour-'));
  app = await electron.launch({ args: ['.'], env: { ...process.env, LURK_DATA_DIR: dataDir } });
  page = await app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  const language = await page.evaluate(() => document.documentElement.lang);
  player = language === 'de' ? dePlayer : enPlayer;
  settingsText = language === 'de' ? deSettings : enSettings;
  // A raid would replace the player mid-tour; raids are not what this tour checks.
  await page.evaluate(() => window.lurk.settings.update({ player: { muted: true, followRaids: false } }));

  await app.evaluate(({ net, session }) => {
    const state: TourAds = {
      login: '',
      start: 0,
      end: 0,
      channelOf: {},
      opened: [],
      answeredAt: {},
      askedAt: {},
      twitchAd: {},
      ended: {},
    };
    (globalThis as unknown as { tourAds: TourAds }).tourAds = state;
    const plain = (url: string) => url.split('?')[0]!;
    session.defaultSession.protocol.handle('https', async (request) => {
      const url = new URL(request.url);
      // Lurk asks for the channel's session, whether or not Twitch answers.
      const owner = state.channelOf[plain(request.url)];
      if (owner) state.askedAt[owner] = Date.now();
      const response = await net.fetch(request, { bypassCustomProtocolHandlers: true });
      if (!url.pathname.endsWith('.m3u8') || !response.ok) return response;
      const text = await response.text();
      const headers = { 'Content-Type': 'application/vnd.apple.mpegurl' };
      const channel = /\/api\/channel\/hls\/([^/.]+)\.m3u8$/.exec(url.pathname)?.[1];
      if (url.host === 'usher.ttvnw.net' && channel) {
        state.opened.push(channel);
        state.answeredAt[channel] = Date.now();
        for (const line of text.split('\n')) if (line.startsWith('https://')) state.channelOf[plain(line)] = channel;
        return new Response(text, { status: 200, headers });
      }
      // What Twitch sent for the channel's session (a failed answer is not counted as one).
      if (owner) {
        state.answeredAt[owner] = Date.now();
        state.twitchAd[owner] =
          text.includes('CLASS="twitch-stitched-ad"') ||
          text.split('\n').some((line) => line.startsWith('#EXTINF:') && /,\S/.test(line) && !/,live\s*$/.test(line));
        state.ended[owner] = text.includes('#EXT-X-ENDLIST');
      }
      const planned = state.end > Date.now() && owner === state.login;
      if (!planned) return new Response(text, { status: 200, headers });
      let date = 0;
      const out: string[] = [];
      for (const line of text.split('\n')) {
        if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) date = Date.parse(line.slice(25));
        if (line.startsWith('#EXTINF:') && date >= state.start && date < state.end) {
          out.push(line.replace(/,.*$/, ',Amazon|tour'));
          continue;
        }
        out.push(line);
        if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
          const at = new Date(state.start).toISOString();
          const seconds = (state.end - state.start) / 1000;
          out.push(`#EXT-X-DATERANGE:ID="tour-ad",CLASS="twitch-stitched-ad",START-DATE="${at}",DURATION=${seconds}`);
        }
      }
      return new Response(out.join('\n'), { status: 200, headers });
    });
  });

  // Three big live channels: the first plays (found through the search), the other two are
  // subscribed.
  const [first] = await searchableLiveStreams(page);
  primary = { login: first!.broadcaster.login, displayName: first!.broadcaster.displayName };
  // live.ts keeps its list to itself, so it is asked once more.
  const top = await liveStreams(page);
  const others = top.filter((stream) => stream.broadcaster.login !== primary.login);
  expect(others.length).toBeGreaterThanOrEqual(2);
  spares = [...others];
  const refs: ChannelRef[] = [];
  while (refs.length < 2 && spares.length > 0) {
    const details = await channelDetails(spares.shift()!.broadcaster.login);
    expect(details).toBeTruthy();
    // Twitch's list lags behind: a channel offline by now is no candidate for the switch.
    if (!details!.stream) continue;
    refs.push(details!.ref);
    await page.evaluate((ref) => window.lurk.subscriptions.subscribe(ref), details!.ref);
  }
  expect(refs.length, 'live channels to subscribe').toBe(2);
  other = refs[0]!;
  favourite = refs[1]!;
  // The second has watch time, so the switch prefers it.
  for (let i = 0; i < 3; i++) await page.evaluate((id) => window.lurk.library.addWatchTime(id, 10), favourite.id);
  await liveInLurk([favourite.id, other.id]);
  // The tour answers the system's confirmations itself.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
  mkdirSync(screenshots, { recursive: true });
});

test.afterAll(async () => {
  await app?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const video = () => page.locator('video.stage-video:not(.stage-clip)');
const currentTime = () => video().evaluate((element: HTMLVideoElement) => element.currentTime);
const banners = () => page.locator('.banners');
const detourTitle = (from: string, to: string) =>
  player.detourTitle.replace('{{primary}}', from).replace('{{channel}}', to);
/** The start of every switch banner, whichever channel shows. */
const detourPrefix = () => player.detourTitle.split('{{')[0]!;

test('the subscribed channels are read in the background while a stream plays', async () => {
  await playFromSearch(page, primary.login);
  await expect.poll(currentTime, { timeout: 60_000 }).toBeGreaterThan(2);
  await expect
    .poll(async () => (await ads()).opened, { timeout: 30_000 })
    .toEqual(expect.arrayContaining([favourite.login, other.login]));
});

test('at a break the channel watched longest shows, and the player comes back by itself', async () => {
  await favouriteClear();
  await planAd(primary.login, 40);
  await expect(banners()).toContainText(detourTitle(primary.displayName, favourite.displayName), { timeout: 45_000 });
  await expect(banners().getByRole('button', { name: player.detourReturn, exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(screenshots, 'player-werbepausen-wechsel.png') });
  // Twitch's channel on screen is B's; the info strip stays A's.
  await expect(page.locator('.info-strip')).toContainText(primary.displayName);
  // Back to A, not on to another channel.
  await expect(banners()).not.toContainText(detourPrefix(), { timeout: 120_000 });
  const back = await currentTime();
  await expect.poll(currentTime, { timeout: 30_000 }).toBeGreaterThan(back + 1);
  await adOver();
});

test('"Zurück" returns at once and stays for the rest of the break', async () => {
  await favouriteClear();
  await planAd(primary.login, 40);
  const banner = banners().getByRole('button', { name: player.detourReturn, exact: true });
  await expect(banner).toBeVisible({ timeout: 45_000 });
  await banner.click();
  // No channel shows, neither favourite nor another one.
  await expect(banners()).not.toContainText(detourPrefix());
  // The blocker hides the rest of the break instead of switching again.
  await page.waitForTimeout(3000);
  await expect(banners()).not.toContainText(detourPrefix());
  await adOver();
  await expect(banners()).not.toContainText(player.midrollTitle, { timeout: 60_000 });
});

test('"Bei B bleiben" opens B in the player', async () => {
  await favouriteClear();
  await planAd(primary.login, 40);
  const stay = banners().getByRole('button', {
    name: player.detourStay.replace('{{channel}}', favourite.displayName),
    exact: true,
  });
  await expect(stay).toBeVisible({ timeout: 45_000 });
  await stay.click();
  // B's player is a new page with its own channel query and session: when Twitch fails one of them,
  // Lurk shows "Erneut versuchen", and playing() presses it (as for the first player, CI 2026-11-24).
  const retry = page
    .getByRole('region', { name: player.player })
    .getByRole('button', { name: player.retry, exact: true });
  await expect(page.locator('.info-strip').filter({ hasText: favourite.displayName }).or(retry).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(banners()).not.toContainText(detourPrefix());
  await playing(page, 2);
  await expect(page.locator('.info-strip')).toContainText(favourite.displayName);
  await adOver();
});

test('the "…" menu turns the switch off: the break is hidden instead', async () => {
  // The system menu: the tour picks "Bei Werbepausen Kanal wechseln" (Playwright cannot click it).
  await app.evaluate(({ Menu }, label) => {
    const original = Menu.buildFromTemplate;
    Menu.buildFromTemplate = ((template: Electron.MenuItemConstructorOptions[]) => {
      Menu.buildFromTemplate = original;
      return {
        popup: (options: Electron.PopupOptions = {}) => {
          const item = template.find((entry) => entry.label === label);
          (item?.click as (() => void) | undefined)?.();
          options.callback?.();
        },
      } as unknown as Electron.Menu;
    }) as typeof Menu.buildFromTemplate;
  }, player.adSwitchMenu);
  await page.getByRole('region', { name: player.player }).hover();
  await page.getByRole('button', { name: player.more }).click();
  await expect.poll(() => page.evaluate(async () => (await window.lurk.settings.get()).player.adSwitch)).toBe(false);
  await planAd(favourite.login, 30);
  await expect(banners()).toContainText(player.midrollTitle, { timeout: 45_000 });
  await expect(banners()).not.toContainText(detourPrefix());
  await adOver();
  await page.evaluate(() => window.lurk.settings.update({ player: { adSwitch: true } }));
});

test('"Replay & Werbung" ranks the subscriptions by watch time and resets it', async () => {
  const [settings] = await Promise.all([
    app.waitForEvent('window'),
    page.evaluate(() => window.lurk.openSettings('replay')),
  ]);
  await expect(settings.getByRole('switch', { name: settingsText.replay.adSwitch })).toBeChecked();
  const ranking = settings.getByRole('region', { name: settingsText.replay.rankingSection });
  // The settings window hears watch time as it is counted; the favourite comes first.
  await expect(ranking.locator('.ranking-row').first()).toContainText(favourite.displayName, { timeout: 45_000 });
  await expect(ranking.locator('.ranking-row').first()).toContainText('1.');
  await settings.screenshot({ path: path.join(screenshots, 'settings-replay.png') });
  await settings.getByRole('button', { name: settingsText.replay.reset }).click();
  await expect(ranking).toContainText(settingsText.replay.rankingEmpty);
  await settings.close();
});
