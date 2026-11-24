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
import { playFromSearch, searchableLiveStreams } from './live';

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

interface TourAds {
  /** The channel whose sessions get the ad; empty while none is planned. */
  login: string;
  start: number;
  end: number;
  /** Media playlist (without query) → the channel of its session. */
  channelOf: Record<string, string>;
  /** Channels whose sessions were opened, in order. */
  opened: string[];
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

test.beforeAll(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'lurk-tour-'));
  app = await electron.launch({ args: ['.'], env: { ...process.env, LURK_DATA_DIR: dataDir } });
  page = await app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  const language = await page.evaluate(() => document.documentElement.lang);
  player = language === 'de' ? dePlayer : enPlayer;
  settingsText = language === 'de' ? deSettings : enSettings;
  await page.evaluate(() => window.lurk.settings.update({ player: { muted: true } }));

  await app.evaluate(({ net, session }) => {
    const state: TourAds = { login: '', start: 0, end: 0, channelOf: {}, opened: [] };
    (globalThis as unknown as { tourAds: TourAds }).tourAds = state;
    const plain = (url: string) => url.split('?')[0]!;
    session.defaultSession.protocol.handle('https', async (request) => {
      const url = new URL(request.url);
      const response = await net.fetch(request, { bypassCustomProtocolHandlers: true });
      if (!url.pathname.endsWith('.m3u8') || !response.ok) return response;
      const text = await response.text();
      const headers = { 'Content-Type': 'application/vnd.apple.mpegurl' };
      const channel = /\/api\/channel\/hls\/([^/.]+)\.m3u8$/.exec(url.pathname)?.[1];
      if (url.host === 'usher.ttvnw.net' && channel) {
        state.opened.push(channel);
        for (const line of text.split('\n')) if (line.startsWith('https://')) state.channelOf[plain(line)] = channel;
        return new Response(text, { status: 200, headers });
      }
      const planned = state.end > Date.now() && state.channelOf[plain(request.url)] === state.login;
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
  const top = await page.evaluate(() => window.lurk.browse.streams('all', 'EN', 'VIEWER_COUNT', null));
  const others = top.filter((stream) => stream.broadcaster.login !== primary.login);
  expect(others.length).toBeGreaterThanOrEqual(2);
  const refs = [];
  for (const stream of others.slice(0, 2)) {
    const details = await page.evaluate((login) => window.lurk.twitch.channel(login), stream.broadcaster.login);
    expect(details).toBeTruthy();
    refs.push(details!.ref);
    await page.evaluate((ref) => window.lurk.subscriptions.subscribe(ref), details!.ref);
  }
  other = refs[0]!;
  favourite = refs[1]!;
  // The second has watch time, so the switch prefers it.
  for (let i = 0; i < 3; i++) await page.evaluate((id) => window.lurk.library.addWatchTime(id, 10), favourite.id);
  await expect
    .poll(async () => Object.keys((await page.evaluate(() => window.lurk.subscriptions.live())).statuses).length, {
      timeout: 30_000,
    })
    .toBe(2);
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

test('the subscribed channels are read in the background while a stream plays', async () => {
  await playFromSearch(page, primary.login);
  await expect.poll(currentTime, { timeout: 60_000 }).toBeGreaterThan(2);
  await expect
    .poll(async () => (await ads()).opened, { timeout: 30_000 })
    .toEqual(expect.arrayContaining([favourite.login, other.login]));
});

test('at a break the channel watched longest shows, and the player comes back by itself', async () => {
  await planAd(primary.login, 40);
  await expect(banners()).toContainText(detourTitle(primary.displayName, favourite.displayName), { timeout: 45_000 });
  await expect(banners().getByRole('button', { name: player.detourReturn, exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(screenshots, 'player-werbepausen-wechsel.png') });
  // Twitch's channel on screen is B's; the info strip stays A's.
  await expect(page.locator('.info-strip')).toContainText(primary.displayName);
  await expect(banners()).not.toContainText(detourTitle(primary.displayName, favourite.displayName), {
    timeout: 120_000,
  });
  const back = await currentTime();
  await expect.poll(currentTime, { timeout: 30_000 }).toBeGreaterThan(back + 1);
  await adOver();
});

test('"Zurück" returns at once and stays for the rest of the break', async () => {
  await planAd(primary.login, 40);
  const banner = banners().getByRole('button', { name: player.detourReturn, exact: true });
  await expect(banner).toBeVisible({ timeout: 45_000 });
  await banner.click();
  await expect(banners()).not.toContainText(detourTitle(primary.displayName, favourite.displayName));
  // The blocker hides the rest of the break instead of switching again.
  await page.waitForTimeout(3000);
  await expect(banners()).not.toContainText(detourTitle(primary.displayName, favourite.displayName));
  await adOver();
  await expect(banners()).not.toContainText(player.midrollTitle, { timeout: 60_000 });
});

test('"Bei B bleiben" opens B in the player', async () => {
  await planAd(primary.login, 40);
  const stay = banners().getByRole('button', {
    name: player.detourStay.replace('{{channel}}', favourite.displayName),
  });
  await expect(stay).toBeVisible({ timeout: 45_000 });
  await stay.click();
  await expect(page.locator('.info-strip')).toContainText(favourite.displayName, { timeout: 30_000 });
  await expect(banners()).not.toContainText(player.detourTitle.split('{{')[0]!);
  await expect.poll(currentTime, { timeout: 60_000 }).toBeGreaterThan(2);
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
  await expect(banners()).not.toContainText(player.detourTitle.split('{{')[0]!);
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
