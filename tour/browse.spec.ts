// Tour, part "lists": Entdecken with its filters and the live preview, Kategorien and a category's
// page, the search's "Alle Ergebnisse". Needs network (as the GitHub runners have). Screenshots in
// tour/out/<platform>/. The sort and language pickers open system menus, which Playwright cannot
// click; the tour changes those settings directly and checks what the page makes of them.

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import deBrowse from '../locales/de/browse.json' with { type: 'json' };
import deCommon from '../locales/de/common.json' with { type: 'json' };
import deShell from '../locales/de/shell.json' with { type: 'json' };
import enBrowse from '../locales/en/browse.json' with { type: 'json' };
import enCommon from '../locales/en/common.json' with { type: 'json' };
import enShell from '../locales/en/shell.json' with { type: 'json' };
import { shown } from './live';

const screenshots = path.join('tour', 'out', process.platform);
let app: ElectronApplication;
let page: Page;
let dataDir: string;
let browse: typeof enBrowse;
let common: typeof enCommon;
let shell: typeof enShell;

test.describe.configure({ mode: 'serial', timeout: 120_000 });

test.beforeAll(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'lurk-tour-'));
  app = await electron.launch({ args: ['.'], env: { ...process.env, LURK_DATA_DIR: dataDir } });
  page = await app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  const language = await page.evaluate(() => document.documentElement.lang);
  browse = language === 'de' ? deBrowse : enBrowse;
  common = language === 'de' ? deCommon : enCommon;
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

/** Whether `locator` shows within `timeout`, for the steps that then ask Twitch again. */
const within = (locator: Locator, timeout: number): Promise<boolean> =>
  locator.waitFor({ timeout }).then(
    () => true,
    () => false,
  );

/**
 * Waits for the search page's answer, its channels section. When Twitch fails both halves of the
 * search, Lurk shows its failure view; the tour presses "Erneut versuchen" up to twice, as a person
 * would. False when no answer came: the step then tries another term.
 */
async function searchAnswered(): Promise<boolean> {
  const section = front()
    .getByRole('heading', { level: 2, name: new RegExp(browse.search.channelsSection) })
    .first();
  const retry = front().getByRole('button', { name: common.retry, exact: true });
  for (let retries = 0; ; retries++) {
    if (!(await within(section.or(retry).first(), 15_000))) return false;
    if (await section.isVisible()) return true;
    if (retries === 2) return false;
    await retry.click();
    // The failure gives way to a spinner until Twitch answers again.
    if (await within(section, 15_000)) return true;
  }
}

test('Entdecken shows live streams as tiles', async () => {
  // Twitch now and then fails a list or lets it time out (browse.streams, CI 2026-11-24); shown()
  // asks again from Lurk's failure view, up to three times.
  test.setTimeout(180_000);
  await page.getByRole('navigation').getByRole('button', { name: shell.nav.browse, exact: true }).click();
  await expect(front().getByRole('heading', { level: 1, name: shell.pages.browse })).toBeVisible();
  await shown(page, tiles().first());
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
  // IRL asks Twitch for its categories, then for their streams: two of Lurk's 10 s timeouts in a
  // row before an answer or the failure view, each asked again by shown().
  test.setTimeout(240_000);
  await front().getByRole('radio', { name: browse.content.irl }).click();
  await expect(subtitle()).toContainText(browse.contentStreams.irl);
  await shown(page, tiles().first(), 35_000);
  await page.evaluate(() => window.lurk.settings.update({ browse: { browseSort: 'RECENT', language: 'DE' } }));
  await expect(subtitle()).toHaveText([browse.contentStreams.irl, browse.sort.RECENT, browse.language.DE].join(' · '));
  // The sort button names the choice (exact: the tiles are buttons named by their stream titles).
  await expect(
    front().getByRole('button', { name: `${browse.sort.label}: ${browse.sort.RECENT}`, exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: path.join(screenshots, '11-entdecken-filter.png') });
  await page.evaluate(() =>
    window.lurk.settings.update({ browse: { browseContent: 'all', browseSort: 'VIEWER_COUNT', language: '' } }),
  );
  await expect(subtitle()).toHaveText(
    [browse.contentStreams.all, browse.sort.VIEWER_COUNT, browse.language.all].join(' · '),
  );
});

test('a tag from the suggestions filters and shows as a capsule', async () => {
  // Up to three rounds of suggestions, then the tag's list asked again by shown().
  test.setTimeout(240_000);
  const field = front().getByRole('combobox', { name: browse.tag.label, exact: true });
  const options = front().getByRole('option');
  // A tag in plain letters: Twitch suggests tags in decorative letters too ("DᴇᴜᴛꜱᴄʜEɴɢʟɪꜱᴄʜ"), and
  // finds no stream for them (CI, 2026-11-24). "Deutsch" itself when listed: Twitch does not list it
  // first, and a compound tag may have nobody live.
  const plain = options.filter({ hasText: /^\s*[A-Za-zÄÖÜäöüß0-9]+\s*$/ });
  const exact = options.filter({ hasText: /^\s*deutsch\s*$/i });
  // Twitch now and then fails the suggestions or lets them time out (CI, 2026-11-24), and Lurk asks
  // again only when the text changes: the tour types it again, as a person would.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await field.fill('');
    await field.fill('Deutsch');
    if (await within(plain.first(), 8_000)) break;
  }
  await expect(plain.first()).toBeVisible();
  const option = (await exact.count()) > 0 ? exact.first() : plain.first();
  const tag = (await option.textContent())!.trim();
  await option.click();
  await expect(subtitle()).toContainText(`#${tag}`);
  // Exact: the tiles are buttons named by their stream titles.
  const remove = front().getByRole('button', { name: browse.tag.removeNamed.replace('{{tag}}', tag), exact: true });
  await expect(remove).toBeVisible();
  await shown(page, tiles().first());
  await remove.click();
  await expect(subtitle()).not.toContainText('#');
});

test('resting on a tile plays a muted live preview', async () => {
  // Entdecken's list again (the tag is gone), asked again by shown(), then up to four rests.
  test.setTimeout(240_000);
  await shown(page, tiles().first());
  // The preview opens its own Twitch session, which Twitch now and then fails ("service error", a
  // timeout; CI 2026-11-24); the tile then keeps its still image and does not ask again. The tour
  // leaves the tile and rests on it once more (a new session), then on the next two, as a person
  // would.
  let tile = tiles().first();
  for (const index of [0, 0, 1, 2]) {
    tile = tiles().nth(index);
    await tile.hover();
    if (await within(tile.locator('.live-preview.is-showing'), 12_000)) break;
    // Leaving stops the attempt.
    await page.mouse.move(5, 400);
    await expect(page.locator('.live-preview')).toHaveCount(0);
  }
  await expect(tile.locator('.live-preview.is-showing')).toBeVisible();
  const muted = await tile.locator('video').evaluate((video: HTMLVideoElement) => video.muted);
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
  // Two lists, each asked again by shown() when Twitch fails it (CI, 2026-11-24).
  test.setTimeout(300_000);
  await page.getByRole('navigation').getByRole('button', { name: shell.nav.categories, exact: true }).click();
  const categories = front().locator('.category-tile');
  await shown(page, categories.first());
  await page.screenshot({ path: path.join(screenshots, '13-kategorien.png') });
  const name = (await categories.first().locator('.tile-title').textContent())!.trim();
  await categories.first().click();
  await expect(front().getByRole('heading', { level: 1, name })).toBeVisible();
  await shown(page, tiles().first());
  await expect(subtitle()).toContainText(browse.sort.VIEWER_COUNT);
  await page.screenshot({ path: path.join(screenshots, '14-kategorie.png') });
});

test('the search lists channels and categories on its own page', async () => {
  // Up to three terms, each asked again twice, with a pause between them.
  test.setTimeout(300_000);
  const search = page.getByRole('combobox', { name: shell.search.label, exact: true });
  const channels = front().locator('.channel-row');
  const categories = front().locator('.category-tile');
  // Twitch's search now and then answers without channels or without categories, or fails both
  // (CI, 2026-11-24); the step takes the first term it lists both for. All three are categories.
  for (const [index, term] of ['minecraft', 'fortnite', 'valorant'].entries()) {
    // A person waits a moment before trying another term.
    if (index > 0) await page.waitForTimeout(5_000);
    await search.fill(term);
    const all = page.getByRole('option', { name: new RegExp(shell.search.allSubtitle) });
    await expect(all).toBeVisible({ timeout: 15_000 });
    await all.click();
    await expect(
      front().getByRole('heading', { level: 1, name: browse.search.title.replace('{{term}}', term) }),
    ).toBeVisible();
    if (!(await searchAnswered())) continue;
    await expect(front().locator('.channel-row, .search-empty').first()).toBeVisible();
    if ((await channels.count()) > 0 && (await categories.count()) > 0) break;
  }
  await expect(channels.first()).toBeVisible();
  // Counts in the interface language, singular or plural.
  await expect(subtitle()).toHaveText(/^\d[\d.,]* \S+ · \d[\d.,]* \S+$/);
  await expect(categories.first()).toBeVisible();
  await page.screenshot({ path: path.join(screenshots, '15-suche.png') });
});
