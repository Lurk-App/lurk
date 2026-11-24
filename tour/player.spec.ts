// Tour, part "player": plays the most watched live Twitch stream, opened through the search like a
// user would. Needs network (as the GitHub runners have). Screenshots in tour/out/<platform>/.

import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import deChat from '../locales/de/chat.json' with { type: 'json' };
import dePlayer from '../locales/de/player.json' with { type: 'json' };
import deSettings from '../locales/de/settings.json' with { type: 'json' };
import deShell from '../locales/de/shell.json' with { type: 'json' };
import enChat from '../locales/en/chat.json' with { type: 'json' };
import enPlayer from '../locales/en/player.json' with { type: 'json' };
import enSettings from '../locales/en/settings.json' with { type: 'json' };
import enShell from '../locales/en/shell.json' with { type: 'json' };
import { playFromSearch, searchableLiveStreams } from './live';

const screenshots = path.join('tour', 'out', process.platform);
let app: ElectronApplication;
let page: Page;
let dataDir: string;
let player: typeof enPlayer;
let shell: typeof enShell;
let chat: typeof enChat;
let settingsText: typeof enSettings;
let login: string;
let second: string;

// One app for all steps: a failing step skips the rest instead of starting a fresh app.
test.describe.configure({ mode: 'serial', timeout: 120_000 });

test.beforeAll(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'lurk-tour-'));
  app = await electron.launch({ args: ['.'], env: { ...process.env, LURK_DATA_DIR: dataDir } });
  page = await app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  const language = await page.evaluate(() => document.documentElement.lang);
  player = language === 'de' ? dePlayer : enPlayer;
  shell = language === 'de' ? deShell : enShell;
  chat = language === 'de' ? deChat : enChat;
  settingsText = language === 'de' ? deSettings : enSettings;
  // Mute the tour; the player remembers volume and mute in the tour's own data folder.
  await page.evaluate(() => window.lurk.settings.update({ player: { muted: true } }));
  // The most watched English stream: its chat shows emotes within seconds (the most watched stream
  // overall may chat in a language that uses few).
  const [top, next] = await searchableLiveStreams(page, 2);
  login = top!.broadcaster.login;
  second = next!.broadcaster.login;
  mkdirSync(screenshots, { recursive: true });
});

test.afterAll(async () => {
  await app?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

// The stream's video, never a clip that may play over it during ads.
const video = () => page.locator('video.stage-video:not(.stage-clip)');

test('a live channel from the search opens the player and plays', async () => {
  await playFromSearch(page, login);
  await expect(page.getByRole('region', { name: player.player })).toBeVisible();
  // The picture runs: the playhead moves.
  await expect
    .poll(() => video().evaluate((element: HTMLVideoElement) => element.currentTime), { timeout: 60_000 })
    .toBeGreaterThan(2);
  await expect(page.locator('.info-strip')).toContainText(shell.search.viewers.split(' ')[1]!);
  expect(await page.title()).not.toBe('Lurk');
});

test('the chat connects, shows messages and emotes as images', async () => {
  const panel = page.getByRole('complementary', { name: chat.title });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('img', { name: chat.connected })).toBeVisible({ timeout: 20_000 });
  await expect(panel.locator('.chat-row').first()).toBeVisible({ timeout: 30_000 });
  // A busy chat shows emotes soon; each is an image with its name. A chat without any for a minute
  // (a tournament's, CI 2026-11-24) says nothing about Lurk: the tour then watches the second
  // channel's.
  test.setTimeout(240_000);
  const emote = panel.locator('img.chat-emote:not(.is-hidden), canvas.chat-emote').first();
  const shown = await emote
    .waitFor({ timeout: 60_000 })
    .then(() => true)
    .catch(() => false);
  if (!shown) {
    await playFromSearch(page, second);
    await expect(panel.getByRole('img', { name: chat.connected })).toBeVisible({ timeout: 20_000 });
  }
  await expect(emote).toBeVisible({ timeout: 60_000 });
  await expect(panel.getByText(chat.readOnly)).toBeVisible();
});

test('the chat toggle hides and shows the panel', async () => {
  const stage = page.getByRole('region', { name: player.player });
  // The label says what a click does ("Chat ausblenden" / "Chat einblenden").
  const hide = page.getByRole('button', { name: chat.hide.split(' (')[0] });
  const show = page.getByRole('button', { name: chat.show.split(' (')[0] });
  await stage.hover();
  await expect(hide).toHaveClass(/is-on/);
  await hide.click();
  await expect(page.getByRole('complementary', { name: chat.title })).toHaveCount(0);
  await stage.hover();
  await show.click();
  await expect(page.getByRole('complementary', { name: chat.title })).toBeVisible();
});

test('the Wiedergabe tab switches third-party emotes', async () => {
  const [settings] = await Promise.all([
    app.waitForEvent('window'),
    page.evaluate(() => window.lurk.openSettings('playback')),
  ]);
  await expect(settings.getByRole('tab', { name: settingsText.tabs.playback })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const emotes = settings.getByRole('switch', { name: settingsText.playback.thirdPartyEmotes });
  await expect(emotes).toBeChecked();
  await emotes.click();
  await expect
    .poll(() => page.evaluate(async () => (await window.lurk.settings.get()).player.thirdPartyEmotes))
    .toBe(false);
  await emotes.click();
  await settings.waitForTimeout(300);
  await settings.screenshot({ path: path.join(screenshots, 'settings-playback.png') });
  await settings.close();
});

test('the bar shows quality and hides after a while', async () => {
  const stage = page.getByRole('region', { name: player.player });
  await stage.hover();
  // The button's name is what it shows ("Automatisch · 1080p60"); its tooltip says what it does.
  const quality = page.getByTitle(player.quality);
  await expect(quality).toBeVisible();
  await expect(quality).toContainText(player.auto);
  await expect(quality).toHaveAttribute('aria-haspopup', 'menu');
  // Twitch's own variant names: "1080p60", "720p60", "480p" (30 fps carries no number) …
  await expect(quality).toContainText(/\d{3,4}p|audio|Audio/);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(screenshots, 'player-dark.png') });
  await page.mouse.move(5, 5);
  await expect(page.locator('.control-bar')).not.toHaveClass(/is-visible/, { timeout: 5_000 });
  // Hidden, the bar is out of the Tab order; focus on the stage brings it back.
  await expect(quality).toBeHidden();
  await video().focus();
  await expect(page.locator('.control-bar')).toHaveClass(/is-visible/);
  // Keyboard focus in the bar keeps it open past the 2.5 s (the video's own controls take Tab
  // first, so the step lands on the quality button directly, after a key press).
  await page.keyboard.press('Shift');
  await quality.focus();
  await page.waitForTimeout(3_000);
  await expect(page.locator('.control-bar')).toHaveClass(/is-visible/);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
});

test('fullscreen shows the cinema layout, Escape leaves it', async () => {
  const stage = page.getByRole('region', { name: player.player });
  await stage.hover();
  await page.locator('.control-bar .bar-icon').last().click();
  await expect(page.locator('.window')).toHaveClass(/is-cinema/, { timeout: 10_000 });
  await expect(page.locator('.info-strip')).toHaveCount(0);
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  await expect(page.locator('.window')).not.toHaveClass(/is-cinema/, { timeout: 10_000 });
  await expect(page.locator('.info-strip')).toBeVisible();
});

test('the info strip leads to the channel page, Back returns to the player', async () => {
  await page.locator('.info-strip .link').first().click();
  // The channel page (part 5b): avatar beside the header.
  await expect(page.locator('.page-layer:not(.is-covered) .art-head')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: shell.back }).click();
  await expect(page.getByRole('region', { name: player.player })).toBeVisible();
});

test('the stage stays dark in light mode', async () => {
  await page.evaluate(() => window.lurk.settings.update({ appearance: { mode: 'light' } }));
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe('rgb(246, 245, 249)');
  expect(await page.locator('.stage').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    'rgb(0, 0, 0)',
  );
  await page.getByRole('region', { name: player.player }).hover();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(screenshots, 'player-light.png') });
  await page.evaluate(() => window.lurk.settings.update({ appearance: { mode: 'dark' } }));
});
