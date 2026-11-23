// Tour, part "channel and history": a live channel's page with its videos, a video that resumes
// where it was left, the history with its filter, and "Datenschutz". Needs network (as the GitHub
// runners have). Screenshots in tour/out/<platform>/.

import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import deBrowse from '../locales/de/browse.json' with { type: 'json' };
import deSettings from '../locales/de/settings.json' with { type: 'json' };
import deShell from '../locales/de/shell.json' with { type: 'json' };
import enBrowse from '../locales/en/browse.json' with { type: 'json' };
import enSettings from '../locales/en/settings.json' with { type: 'json' };
import enShell from '../locales/en/shell.json' with { type: 'json' };

const screenshots = path.join('tour', 'out', process.platform);
let app: ElectronApplication;
let page: Page;
let dataDir: string;
let browse: typeof enBrowse;
let shell: typeof enShell;
let settingsText: typeof enSettings;
let login: string;
let displayName: string;

// Twitch's video lists and thumbnails are sometimes slow (measured: with and without the network
// filter alike): one more try of the whole file before it counts as failed.
test.describe.configure({ mode: 'serial', timeout: 120_000, retries: 1 });

test.beforeAll(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'lurk-tour-'));
  app = await electron.launch({ args: ['.'], env: { ...process.env, LURK_DATA_DIR: dataDir } });
  page = await app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  const language = await page.evaluate(() => document.documentElement.lang);
  browse = language === 'de' ? deBrowse : enBrowse;
  shell = language === 'de' ? deShell : enShell;
  settingsText = language === 'de' ? deSettings : enSettings;
  await page.evaluate(() => window.lurk.settings.update({ player: { muted: true } }));
  // A big live channel with past broadcasts (asked first: the steps are about the page, not about
  // whether a channel happens to keep its broadcasts).
  const top = await page.evaluate(() => window.lurk.twitch.top(8));
  let chosen = top[0]!;
  for (const stream of top) {
    const archive = await page.evaluate((name) => window.lurk.twitch.videos(name, 'ARCHIVE'), stream.login);
    if (archive.length >= 3) {
      chosen = stream;
      break;
    }
  }
  login = chosen.login;
  displayName = chosen.displayName;
  mkdirSync(screenshots, { recursive: true });
});

test.afterAll(async () => {
  await app?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const front = () => page.locator('.page-layer:not(.is-covered)');
const video = () => page.locator('.player-page video.stage-video:not(.stage-clip)');

async function openChannel() {
  const search = page.getByRole('combobox', { name: shell.search.label, exact: true });
  await search.fill(`twitch.tv/${login}`);
  await search.press('Enter');
  await expect(front().locator('.art-head')).toBeVisible({ timeout: 15_000 });
}

test('a live channel shows its card and its past broadcasts', async () => {
  await openChannel();
  await expect(front().getByRole('heading', { level: 1 })).toHaveText(displayName);
  await expect(front().locator('.avatar-live')).toBeVisible();
  await expect(front().getByRole('button', { name: browse.channel.watchNow })).toBeVisible();
  await expect(front().getByRole('radio', { name: browse.channel.kind.ARCHIVE })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(front().locator('.video-tile, .empty-state').first()).toBeVisible({ timeout: 20_000 });
  // The pictures load lazily; the screenshot waits for the first ones.
  await expect
    .poll(
      () =>
        front()
          .locator('.video-tile img')
          .evaluateAll((images) => images.filter((image) => (image as HTMLImageElement).naturalWidth > 0).length),
      // Twitch's thumbnail server is sometimes slow; the step is about the page, not its speed.
      { timeout: 25_000 },
    )
    .toBeGreaterThan(1);
  await page.screenshot({ path: path.join(screenshots, '16-kanal.png') });
});

test('the kinds switch the videos', async () => {
  await front().getByRole('radio', { name: browse.channel.kind.HIGHLIGHT }).click();
  await expect(front().getByRole('radio', { name: browse.channel.kind.HIGHLIGHT })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(
    front().locator('.video-tile').or(front().getByText(browse.channel.empty.HIGHLIGHT)).first(),
    // Twitch's video lists are sometimes slow; the step is about switching, not speed.
  ).toBeVisible({ timeout: 35_000 });
  await front().getByRole('radio', { name: browse.channel.kind.ARCHIVE }).click();
  await expect(front().locator('.video-tile').first()).toBeVisible({ timeout: 35_000 });
});

test('a video resumes where it was left, and its tile shows how far', async () => {
  const tile = front().locator('.video-tile').first();
  await tile.click();
  await expect(page.locator('.player-page')).toBeVisible();
  await expect
    .poll(() => video().evaluate((element: HTMLVideoElement) => element.currentTime), { timeout: 30_000 })
    .toBeGreaterThan(1);
  await video().evaluate((element: HTMLVideoElement) => {
    element.currentTime = 300;
  });
  await expect
    .poll(() => video().evaluate((element: HTMLVideoElement) => element.currentTime), { timeout: 30_000 })
    .toBeGreaterThan(300);
  // Leaving keeps the position.
  await page.getByRole('button', { name: shell.back }).click();
  await expect(front().locator('.video-tile').first().locator('.progress-strip')).toBeVisible({ timeout: 10_000 });
  await front().locator('.video-tile').first().click();
  await expect
    .poll(() => video().evaluate((element: HTMLVideoElement) => element.currentTime), { timeout: 30_000 })
    .toBeGreaterThan(290);
  await page.getByRole('button', { name: shell.back }).click();
});

test('the live card plays the stream', async () => {
  await front().getByRole('button', { name: browse.channel.watchNow }).click();
  await expect(page.locator('.player-page')).toBeVisible();
  await expect
    .poll(() => video().evaluate((element: HTMLVideoElement) => element.currentTime), { timeout: 45_000 })
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: shell.back }).click();
});

test('the history lists both, filters and removes', async () => {
  await page.getByRole('navigation').getByRole('button', { name: shell.nav.history, exact: true }).click();
  await expect(front().getByRole('heading', { level: 1, name: shell.pages.history })).toBeVisible();
  await expect(front().getByRole('heading', { level: 2, name: new RegExp(browse.history.today) })).toBeVisible();
  const rows = front().locator('.history-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.locator('.progress-strip')).toHaveCount(1);
  await page.screenshot({ path: path.join(screenshots, '17-verlauf.png') });
  const filter = front().getByRole('searchbox', { name: browse.history.filter });
  await filter.fill('zzzlurktour');
  await expect(front().getByText(browse.history.noMatch.replace('{{filter}}', 'zzzlurktour'))).toBeVisible();
  await filter.fill('');
  await rows.first().hover();
  await rows.first().locator('.history-remove').click();
  await expect(rows).toHaveCount(1);
});

test('"Datenschutz" turns the history off', async () => {
  const [settings] = await Promise.all([
    app.waitForEvent('window'),
    page.evaluate(() => window.lurk.openSettings('privacy')),
  ]);
  const tab = settings.getByRole('tab', { name: settingsText.tabs.privacy });
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await settings.getByRole('switch', { name: settingsText.privacy.saveHistory }).click();
  await expect(front().locator('.page-subtitle')).toHaveText(browse.history.off);
  await settings.screenshot({ path: path.join(screenshots, 'settings-privacy.png') });
  await settings.close();
});
