// Tour, part "adbreaks": ad breaks while a real stream plays. Twitch cannot be asked for an ad, so
// the tour puts one in: it answers the app's https requests itself (installed through Playwright,
// everything passed through to Twitch) and marks the newest segments of a session's playlists as
// an ad for a while – the way Twitch's stitched ads look. No hook in the app. It checks the second
// source with its toast (while the first session plays), hiding a mid-roll with a clip, the dimmed
// preview without clips, and that the shield's switch keeps the bar, the popover and the quality.
// Needs network.

import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dePlayer from '../locales/de/player.json' with { type: 'json' };
import enPlayer from '../locales/en/player.json' with { type: 'json' };
import { playFromSearch, searchableLiveStreams } from './live';

const screenshots = path.join('tour', 'out', process.platform);
let app: ElectronApplication;
let page: Page;
let dataDir: string;
let player: typeof enPlayer;
let login: string;

interface TourAds {
  /** Which sessions get the ad: every one, or only the first ("embed"). */
  sessions: 'all' | 'embed';
  /** The ad's window (ms since epoch); 0 while none is planned. */
  start: number;
  end: number;
  /** player_type of each usher request, in order. */
  ushers: string[];
  /** Media playlist (without query) → player_type of its session. */
  sessionOf: Record<string, string>;
  /** player_type → whether its latest playlist carried Twitch's own ad (before the tour's). */
  twitchAd: Record<string, boolean>;
}

test.describe.configure({ mode: 'serial', timeout: 180_000 });

const ads = () => app.evaluate(() => (globalThis as unknown as { tourAds: TourAds }).tourAds) as Promise<TourAds>;

/**
 * Marked from this far back, so every session's live edge has the ad at once: Twitch's sessions lag
 * by different amounts, and one still showing what came before the start would be ad-free – Lurk
 * would rightly go on from it (CI, 2026-11-24).
 */
const adLeadMs = 20_000;

/** An ad at the live edge, for `seconds` from now. */
async function planAd(sessions: TourAds['sessions'], seconds: number): Promise<void> {
  await app.evaluate(
    (_electron, { sessions: which, length, lead }) => {
      const state = (globalThis as unknown as { tourAds: TourAds }).tourAds;
      state.sessions = which;
      state.start = Date.now() - lead;
      state.end = Date.now() + length * 1000;
    },
    { sessions, length: seconds, lead: adLeadMs },
  );
}

test.beforeAll(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'lurk-tour-'));
  app = await electron.launch({ args: ['.'], env: { ...process.env, LURK_DATA_DIR: dataDir } });
  page = await app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  const language = await page.evaluate(() => document.documentElement.lang);
  player = language === 'de' ? dePlayer : enPlayer;
  await page.evaluate(() => window.lurk.settings.update({ player: { muted: true } }));
  const [top] = await searchableLiveStreams(page);
  login = top!.broadcaster.login;

  // Twitch's answers, passed through – with an ad marked into a session's playlists while planned.
  await app.evaluate(({ net, session }) => {
    const state: TourAds = { sessions: 'all', start: 0, end: 0, ushers: [], sessionOf: {}, twitchAd: {} };
    (globalThis as unknown as { tourAds: TourAds }).tourAds = state;
    const plain = (url: string) => url.split('?')[0]!;
    session.defaultSession.protocol.handle('https', async (request) => {
      const url = new URL(request.url);
      const response = await net.fetch(request, { bypassCustomProtocolHandlers: true });
      const isPlaylist = url.pathname.endsWith('.m3u8');
      if (!isPlaylist || !response.ok) return response;
      const text = await response.text();
      const headers = { 'Content-Type': 'application/vnd.apple.mpegurl' };
      if (url.host === 'usher.ttvnw.net') {
        const token = url.searchParams.get('token') ?? '';
        const type = /"player_type":"(\w+)"/.exec(token)?.[1] ?? (state.ushers.length ? 'popout' : 'embed');
        state.ushers.push(type);
        for (const line of text.split('\n')) if (line.startsWith('https://')) state.sessionOf[plain(line)] = type;
        return new Response(text, { status: 200, headers });
      }
      const type = state.sessionOf[plain(request.url)];
      if (type) {
        state.twitchAd[type] =
          text.includes('CLASS="twitch-stitched-ad"') ||
          text.split('\n').some((line) => line.startsWith('#EXTINF:') && /,\S/.test(line) && !/,live\s*$/.test(line));
      }
      const now = Date.now();
      const planned = state.end > now && (state.sessions === 'all' || type === 'embed');
      if (!planned) return new Response(text, { status: 200, headers });
      // Segments from the ad's start on carry an ad title, with Twitch's ad marker on top.
      const lines = text.split('\n');
      let date = 0;
      const out: string[] = [];
      for (const line of lines) {
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
  mkdirSync(screenshots, { recursive: true });
});

test.afterAll(async () => {
  await app?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

// The stream's video, never the clip that may play over it.
const video = () => page.locator('video.stage-video:not(.stage-clip)');
const currentTime = () => video().evaluate((element: HTMLVideoElement) => element.currentTime);
const banners = () => page.locator('.banners');

test('a stream plays, and its second source is opened in the background', async () => {
  await playFromSearch(page, login);
  await expect.poll(currentTime, { timeout: 60_000 }).toBeGreaterThan(2);
  // The first session asks as "embed", the second source as "popout" – once more for each new start
  // when the player asked Twitch again (CI, 2026-11-24).
  await expect
    .poll(
      async () => {
        const ushers = (await ads()).ushers;
        return (
          ushers.length > 0 &&
          ushers.length % 2 === 0 &&
          ushers.every((type, i) => type === (i % 2 ? 'popout' : 'embed'))
        );
      },
      { timeout: 20_000 },
    )
    .toBe(true);
});

test('with ads only in the first session, the stream goes on from the second source', async () => {
  test.setTimeout(300_000);
  // Twitch's own ad in the second source keeps it from taking over, and Lurk then rightly hides the
  // break (PGL's tournament stream, CI 2026-11-24): the step waits until Twitch shows none there.
  await expect.poll(async () => (await ads()).twitchAd['popout'], { timeout: 180_000 }).toBe(false);
  const source = () => video().evaluate((element: HTMLVideoElement) => element.currentSrc);
  const before = await source();
  await planAd('embed', 30);
  await expect(page.getByRole('status').filter({ hasText: player.sourceSwitched })).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: path.join(screenshots, 'player-zweite-quelle.png') });
  expect(await source()).not.toBe(before);
  await expect(banners()).not.toContainText(player.midrollTitle);
  const switched = await currentTime();
  await expect.poll(currentTime, { timeout: 20_000 }).toBeGreaterThan(switched + 1);
  const state = await page.evaluate(() => window.lurk.blocker.state());
  expect(state.entries.some((entry) => entry.detail.kind === 'switch')).toBe(true);
  // Wait for the planned ad and the toast to pass before the next step.
  await expect.poll(async () => (await ads()).end < Date.now(), { timeout: 60_000 }).toBe(true);
  await expect(page.locator('.toast.is-visible')).toHaveCount(0, { timeout: 10_000 });
});

test('a mid-roll is hidden once it is reached, a clip plays, then the stream goes on', async () => {
  test.setTimeout(300_000);
  const before = (await page.evaluate(() => window.lurk.blocker.state())).totals.adBreaks;
  const clip = page.locator('.stage-clip.is-visible');
  // A popular clip of the channel takes the stage (the dimmed preview until it plays). When Twitch
  // gives no clip, the dimmed preview stays for that break (as on macOS, CI 2026-11-24); a second
  // break asks again.
  for (let attempt = 1; attempt <= 2; attempt++) {
    await planAd('all', 45);
    await expect(banners()).toContainText(player.midrollTitle, { timeout: 30_000 });
    const shown = await clip
      .waitFor({ timeout: 25_000 })
      .then(() => true)
      .catch(() => false);
    if (shown) break;
    await expect(banners()).not.toContainText(player.midrollTitle, { timeout: 90_000 });
  }
  await expect(clip).toBeVisible();
  await expect(banners()).toContainText(player.clipDetail.split('{{')[0]!.trim());
  await page.screenshot({ path: path.join(screenshots, 'player-werbung-clip.png') });
  // After the break the stream goes on at the live edge, the clip and the banner go.
  await expect(banners()).not.toContainText(player.midrollTitle, { timeout: 90_000 });
  await expect(page.locator('.stage-clip')).toHaveCount(0);
  const resumed = await currentTime();
  await expect.poll(currentTime, { timeout: 20_000 }).toBeGreaterThan(resumed + 1);
  await expect(page.locator('.toast.is-visible')).toHaveCount(0, { timeout: 10_000 });
  const state = await page.evaluate(() => window.lurk.blocker.state());
  // At least this break; when the second source turns clear first, the switch counts as one more
  // (as on macOS).
  expect(state.totals.adBreaks).toBeGreaterThanOrEqual(before + 1);
  expect(state.entries.some((entry) => entry.detail.kind === 'skip')).toBe(true);
});

test('without clips, the dimmed preview shows during the break', async () => {
  await page.evaluate(() => window.lurk.settings.update({ blocker: { adFillClips: false } }));
  await planAd('all', 30);
  await expect(banners()).toContainText(player.midrollTitle, { timeout: 40_000 });
  await expect(page.locator('.ad-backdrop')).toBeVisible();
  await expect(banners()).toContainText(player.midrollDetail);
  await expect(page.locator('.stage-clip')).toHaveCount(0);
  await expect(banners()).not.toContainText(player.midrollTitle, { timeout: 60_000 });
  await page.evaluate(() => window.lurk.settings.update({ blocker: { adFillClips: true } }));
});

test('the shield keeps the bar, its popover and the chosen quality when switched', async () => {
  const stage = page.getByRole('region', { name: player.player });
  await stage.hover();
  // Choose a fixed quality through the system menu (the tour picks the second entry).
  await app.evaluate(({ Menu }) => {
    const original = Menu.buildFromTemplate;
    Menu.buildFromTemplate = ((template: Electron.MenuItemConstructorOptions[]) => {
      Menu.buildFromTemplate = original;
      const items = template.filter((item) => item.type !== 'separator');
      return {
        popup: (options: Electron.PopupOptions = {}) => {
          (items[1]?.click as (() => void) | undefined)?.();
          options.callback?.();
        },
      } as unknown as Electron.Menu;
    }) as typeof Menu.buildFromTemplate;
  });
  const quality = page.getByTitle(player.quality);
  await quality.click();
  await expect(quality).not.toContainText(player.auto, { timeout: 10_000 });
  const chosen = (await quality.textContent())!.trim();
  const shield = page.getByRole('button', { name: player.blocker.name, exact: true });
  await shield.click();
  const popover = page.getByRole('dialog', { name: player.blocker.name });
  const source = () => video().evaluate((element: HTMLVideoElement) => element.currentSrc);
  const before = await source();
  await popover.getByRole('switch', { name: player.blocker.name }).click();
  await expect.poll(source, { timeout: 30_000 }).not.toBe(before);
  await expect(popover).toBeVisible();
  await expect(popover).toContainText(player.blocker.offDetail);
  await expect(quality).toHaveText(chosen);
  await popover.getByRole('switch', { name: player.blocker.name }).click();
  await expect(popover).toContainText(player.blocker.onDetail);
  await expect(quality).toHaveText(chosen);
  await page.keyboard.press('Escape');
});
