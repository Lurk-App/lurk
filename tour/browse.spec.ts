// Tour, part "lists": Entdecken with its filters and the live preview, Kategorien and a category's
// page, the search's "Alle Ergebnisse". Needs network (as the GitHub runners have). Screenshots in
// tour/out/<platform>/. The sort and language pickers open system menus, which Playwright cannot
// click; the tour changes those settings directly and checks what the page makes of them.

import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import deBrowse from '../locales/de/browse.json' with { type: 'json' };
import deShell from '../locales/de/shell.json' with { type: 'json' };
import enBrowse from '../locales/en/browse.json' with { type: 'json' };
import enShell from '../locales/en/shell.json' with { type: 'json' };

const screenshots = path.join('tour', 'out', process.platform);
let app: ElectronApplication;
let page: Page;
let dataDir: string;
let browse: typeof enBrowse;
let shell: typeof enShell;

test.describe.configure({ mode: 'serial', timeout: 120_000 });

test.beforeAll(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'lurk-tour-'));
  app = await electron.launch({ args: ['.'], env: { ...process.env, LURK_DATA_DIR: dataDir } });
  page = await app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  const language = await page.evaluate(() => document.documentElement.lang);
  browse = language === 'de' ? deBrowse : enBrowse;
  shell = language === 'de' ? deShell : enShell;
  await page.evaluate(() => window.lurk.settings.update({ player: { muted: true } }));
  mkdirSync(screenshots, { recursive: true });
});

test.afterAll(async () => {
  await app?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const front = () => page.locator('.page-layer:not(.is-covered)');
const tiles = () => front().locator('.stream-tile');
const subtitle = () => front().locator('.page-subtitle');

test('Entdecken shows live streams as tiles', async () => {
  await page.getByRole('navigation').getByRole('button', { name: shell.nav.browse, exact: true }).click();
  await expect(front().getByRole('heading', { level: 1, name: shell.pages.browse })).toBeVisible();
  await expect(tiles().first()).toBeVisible({ timeout: 20_000 });
  expect(await tiles().count()).toBeGreaterThan(5);
  await expect(subtitle()).toHaveText(
    [browse.contentStreams.all, browse.sort.VIEWER_COUNT, browse.language.all].join(' · '),
  );
  // Every tile: the LIVE badge, viewers, a title line, the channel.
  const first = tiles().first();
  await expect(first.locator('.live-badge')).toBeVisible();
  await expect(first.locator('.pill').first()).toBeVisible();
  await page.screenshot({ path: path.join(screenshots, '10-entdecken.png') });
});

test('the content type, sort and language change the context line and the list', async () => {
  await front().getByRole('radio', { name: browse.content.irl }).click();
  await expect(subtitle()).toContainText(browse.contentStreams.irl);
  await expect(tiles().first()).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => window.lurk.settings.update({ browse: { browseSort: 'RECENT', language: 'DE' } }));
  await expect(subtitle()).toHaveText([browse.contentStreams.irl, browse.sort.RECENT, browse.language.DE].join(' · '));
  // The sort button names the choice.
  await expect(front().getByRole('button', { name: `${browse.sort.label}: ${browse.sort.RECENT}` })).toBeVisible();
  await page.screenshot({ path: path.join(screenshots, '11-entdecken-filter.png') });
  await page.evaluate(() =>
    window.lurk.settings.update({ browse: { browseContent: 'all', browseSort: 'VIEWER_COUNT', language: '' } }),
  );
  await expect(subtitle()).toHaveText(
    [browse.contentStreams.all, browse.sort.VIEWER_COUNT, browse.language.all].join(' · '),
  );
});

test('a tag from the suggestions filters and shows as a capsule', async () => {
  const field = front().getByRole('combobox', { name: browse.tag.label, exact: true });
  await field.fill('Deutsch');
  // A tag in plain letters: Twitch suggests tags in decorative letters too ("DᴇᴜᴛꜱᴄʜEɴɢʟɪꜱᴄʜ"), and
  // finds no stream for them (CI, 2026-11-24).
  const option = front()
    .getByRole('option')
    .filter({ hasText: /^\s*[A-Za-zÄÖÜäöüß0-9]+\s*$/ })
    .first();
  await expect(option).toBeVisible({ timeout: 15_000 });
  const tag = (await option.textContent())!.trim();
  await option.click();
  await expect(subtitle()).toContainText(`#${tag}`);
  const remove = front().getByRole('button', { name: browse.tag.removeNamed.replace('{{tag}}', tag) });
  await expect(remove).toBeVisible();
  await expect(tiles().first()).toBeVisible({ timeout: 20_000 });
  await remove.click();
  await expect(subtitle()).not.toContainText('#');
});

test('resting on a tile plays a muted live preview', async () => {
  await expect(tiles().first()).toBeVisible({ timeout: 20_000 });
  await tiles().first().hover();
  await expect(tiles().first().locator('.live-preview.is-showing')).toBeVisible({ timeout: 25_000 });
  const muted = await tiles()
    .first()
    .locator('video')
    .evaluate((video: HTMLVideoElement) => video.muted);
  expect(muted).toBe(true);
  await page.screenshot({ path: path.join(screenshots, '12-live-vorschau.png') });
  await page.mouse.move(5, 400);
  await expect(page.locator('.live-preview')).toHaveCount(0);
});

test('a tile opens the player; back shows Entdecken as it was', async () => {
  const count = await tiles().count();
  await tiles().nth(1).click();
  await expect(page.locator('.player-page')).toBeVisible();
  await page.getByRole('button', { name: shell.back }).click();
  await expect(page.locator('.player-page')).toHaveCount(0);
  // Kept, not loaded again: the same tiles at once.
  expect(await tiles().count()).toBe(count);
});

test('Kategorien opens a category with its streams', async () => {
  await page.getByRole('navigation').getByRole('button', { name: shell.nav.categories, exact: true }).click();
  const categories = front().locator('.category-tile');
  await expect(categories.first()).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: path.join(screenshots, '13-kategorien.png') });
  const name = (await categories.first().locator('.tile-title').textContent())!.trim();
  await categories.first().click();
  await expect(front().getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(tiles().first()).toBeVisible({ timeout: 20_000 });
  await expect(subtitle()).toContainText(browse.sort.VIEWER_COUNT);
  await page.screenshot({ path: path.join(screenshots, '14-kategorie.png') });
});

test('the search lists channels and categories on its own page', async () => {
  const search = page.getByRole('combobox', { name: shell.search.label, exact: true });
  // Twitch's search now and then answers without channels (CI, 2026-11-24); the step takes the first
  // term it lists channels for.
  for (const term of ['minecraft', 'fortnite', 'valorant']) {
    await search.fill(term);
    const all = page.getByRole('option', { name: new RegExp(shell.search.allSubtitle) });
    await expect(all).toBeVisible({ timeout: 15_000 });
    await all.click();
    await expect(
      front().getByRole('heading', { level: 1, name: browse.search.title.replace('{{term}}', term) }),
    ).toBeVisible();
    await expect(
      front().getByRole('heading', { level: 2, name: new RegExp(browse.search.channelsSection) }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(front().locator('.channel-row, .search-empty').first()).toBeVisible();
    if ((await front().locator('.channel-row').count()) > 0) break;
  }
  await expect(front().locator('.channel-row').first()).toBeVisible();
  // Counts in the interface language, singular or plural.
  await expect(subtitle()).toHaveText(/^\d[\d.,]* \S+ · \d[\d.,]* \S+$/);
  await expect(front().locator('.category-tile').first()).toBeVisible();
  await page.screenshot({ path: path.join(screenshots, '15-suche.png') });
});
