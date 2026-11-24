// Tour, part "subscriptions": the empty Abos page, subscribing on a channel page and with the heart
// in the search, the sidebar's live section and badge, export and import (the system's file dialogs
// answered by the tour), unsubscribing and the notification switch. Needs network. Screenshots in
// tour/out/<platform>/.

import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import deBrowse from '../locales/de/browse.json' with { type: 'json' };
import deSettings from '../locales/de/settings.json' with { type: 'json' };
import deShell from '../locales/de/shell.json' with { type: 'json' };
import enBrowse from '../locales/en/browse.json' with { type: 'json' };
import enSettings from '../locales/en/settings.json' with { type: 'json' };
import enShell from '../locales/en/shell.json' with { type: 'json' };
import type { LiveState } from '../src/shared/subscriptions';
import { askAgain, channelShown, shown } from './live';

const screenshots = path.join('tour', 'out', process.platform);
let app: ElectronApplication;
let page: Page;
let dataDir: string;
let browse: typeof enBrowse;
let shell: typeof enShell;
let settingsText: typeof enSettings;
let live: { login: string; displayName: string };

test.describe.configure({ mode: 'serial', timeout: 120_000 });

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
  // Twitch now and then fails the list ("service error", Lurk's 10 s timeout; CI 2026-11-24): the
  // hook asks again. It only chooses the channel.
  const top = await askAgain(async () => {
    const [first] = await page.evaluate(() => window.lurk.twitch.top(1));
    if (!first) throw new Error('Twitch listed no live stream');
    return first;
  });
  live = { login: top.login, displayName: top.displayName };
  mkdirSync(screenshots, { recursive: true });
});

test.afterAll(async () => {
  await app?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const front = () => page.locator('.page-layer:not(.is-covered)');
const nav = () => page.getByRole('navigation');

/** Opens a channel through its twitch.tv link; "Erneut versuchen" when Twitch fails the channel. */
async function openChannel() {
  const search = page.getByRole('combobox', { name: shell.search.label, exact: true });
  await search.fill(`twitch.tv/${live.login}`);
  await search.press('Enter');
  await channelShown(page);
}

/**
 * The live status's next answer (or failure) after `after`, the time of the last one seen. Lurk asks
 * Twitch right after subscribing and on the Abos page's refresh button.
 */
async function liveAnswer(after: string | null): Promise<LiveState> {
  let answer: LiveState | undefined;
  await expect
    .poll(
      async () => {
        answer = await page.evaluate(() => window.lurk.subscriptions.live());
        return !answer.refreshing && answer.lastRefresh !== after;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  return answer!;
}

test('without subscriptions, the Abos page offers two ways on', async () => {
  await nav().getByRole('button', { name: shell.nav.subscriptions }).click();
  await expect(front().getByRole('heading', { level: 2, name: browse.subs.emptyTitle })).toBeVisible();
  // With Lurk's Twitch client: the follows from Twitch (the file import is in "Import/Export").
  await expect(front().getByRole('button', { name: browse.subs.fromTwitch })).toBeVisible();
  await front().getByRole('button', { name: browse.subs.discover }).click();
  await expect(front().getByRole('heading', { level: 1, name: shell.pages.browse })).toBeVisible();
});

test('subscribing on a channel page puts it in the sidebar while live', async () => {
  // Two channel opens, each asked again up to three times, and up to three asks for the live status.
  test.setTimeout(420_000);
  // Twitch now and then answers the channel with "service error" (CI, 2026-11-24).
  await openChannel();
  await expect(front().locator('.art-head')).toBeVisible();
  const before = (await page.evaluate(() => window.lurk.subscriptions.live())).lastRefresh;
  // Exact: the live title or a video's title may hold the word too ("subscribers", "abonnieren"), and
  // "Subscribe" is part of "Subscribed".
  await front().getByRole('button', { name: browse.subscribe.action, exact: true }).click();
  await expect(front().getByRole('button', { name: browse.subscribe.done, exact: true })).toBeVisible();
  // Subscribing asks Twitch for the live status once; after a failed answer Lurk asks again only two
  // minutes later. Abos then says so, and its header button asks again, as a person would – up to
  // three times. The tour then returns to the channel.
  let answer = await liveAnswer(before);
  if (answer.failed) {
    for (let attempt = 0; attempt < 3 && answer.failed; attempt++) {
      await nav()
        .getByRole('button', { name: new RegExp(shell.nav.subscriptions) })
        .click();
      await expect(front().getByRole('status').filter({ hasText: browse.subs.failed })).toBeVisible();
      await front()
        .getByRole('button', { name: browse.subs.refresh.split(' (')[0] })
        .click();
      answer = await liveAnswer(answer.lastRefresh);
    }
    await openChannel();
    await expect(front().getByRole('button', { name: browse.subscribe.done, exact: true })).toBeVisible();
  }
  await expect(page.locator('.nav-badge')).toHaveText('1', { timeout: 20_000 });
  await expect(page.getByRole('heading', { level: 2, name: shell.liveSection })).toBeVisible();
  await expect(page.locator('.live-row')).toHaveCount(1);
  await page.screenshot({ path: path.join(screenshots, '18-abonniert.png') });
});

test('the heart in the search subscribes an offline channel too', async () => {
  // Up to three terms, each search asked again up to three times.
  test.setTimeout(360_000);
  const search = page.getByRole('combobox', { name: shell.search.label, exact: true });
  const row = front()
    .locator('.channel-row')
    .filter({ hasNot: page.locator('.live-badge') })
    .first();
  // Twitch's search now and then answers without channels, or fails both halves (CI, 2026-11-24):
  // "Erneut versuchen" asks again on Lurk's failure view, and the step takes the first term Twitch
  // lists an offline channel for.
  for (const term of ['zzzlurktour', 'lurktour', 'lurk']) {
    await search.fill(term);
    await search.press('Enter');
    await expect(
      front().getByRole('heading', { level: 1, name: browse.search.title.replace('{{term}}', term), exact: true }),
    ).toBeVisible();
    await shown(
      page,
      front().getByRole('heading', { level: 2, name: new RegExp(browse.search.channelsSection) }),
      15_000,
    );
    if (await row.isVisible()) break;
  }
  await expect(row).toBeVisible({ timeout: 15_000 });
  // Exact: a channel's name may hold the word too.
  await row.getByRole('button', { name: browse.subscribe.action, exact: true }).click();
  await expect(row.getByRole('button', { name: browse.subscribe.done, exact: true })).toBeVisible();
});

test('the Abos page shows the live one as a tile and the other as a row', async () => {
  await nav()
    .getByRole('button', { name: new RegExp(shell.nav.subscriptions) })
    .click();
  await expect(front().locator('.stream-tile')).toHaveCount(1, { timeout: 20_000 });
  await expect(front().getByRole('heading', { level: 2, name: new RegExp(browse.subs.offline) })).toBeVisible();
  await expect(front().locator('.channel-row')).toHaveCount(1);
  await expect(front().locator('.page-subtitle')).toContainText('1');
  await page.screenshot({ path: path.join(screenshots, '19-abos.png') });
});

test('export and import go through the system dialogs', async () => {
  const file = path.join(dataDir, 'export.json');
  // The tour answers the system's dialogs itself (Playwright cannot click them).
  await app.evaluate(({ dialog }, target) => {
    const shown: string[] = [];
    (globalThis as Record<string, unknown>)['tourMessages'] = shown;
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as typeof dialog.showSaveDialog;
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [target] })) as typeof dialog.showOpenDialog;
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = args.at(-1) as { detail?: string };
      shown.push(options.detail ?? '');
      return { response: 0, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  }, file);
  await page.evaluate(() => window.lurk.subscriptions.exportFile('json'));
  const exported = JSON.parse(readFileSync(file, 'utf8')) as { subscriptions: { login: string }[] };
  expect(exported.subscriptions.map((entry) => entry.login)).toContain(live.login);
  expect(exported.subscriptions).toHaveLength(2);
  // Unsubscribe both, then import the file again.
  const ids = await page.evaluate(async () => (await window.lurk.library.get()).subscriptions.map((entry) => entry.id));
  for (const id of ids) await page.evaluate((value) => window.lurk.subscriptions.unsubscribe(value), id);
  await expect(front().getByRole('heading', { level: 2, name: browse.subs.emptyTitle })).toBeVisible();
  await page.evaluate(() => window.lurk.subscriptions.importFile());
  await expect(front().locator('.stream-tile, .channel-row')).toHaveCount(2, { timeout: 20_000 });
  const messages = await app.evaluate(() => (globalThis as Record<string, unknown>)['tourMessages'] as string[]);
  expect(messages.at(-1)).toMatch(/2/);
});

test('"Abonniert" ends the subscription', async () => {
  // The channel may be asked again up to three times (openChannel).
  test.setTimeout(180_000);
  await openChannel();
  // Exact: the live title or a video's title may hold the word too, and "Subscribe" is part of
  // "Subscribed".
  await front().getByRole('button', { name: browse.subscribe.done, exact: true }).click();
  await expect(front().getByRole('button', { name: browse.subscribe.action, exact: true })).toBeVisible();
  await expect(page.locator('.nav-badge')).toHaveCount(0);
});

test('the notification switch sits in "Wiedergabe"', async () => {
  const [settings] = await Promise.all([
    app.waitForEvent('window'),
    page.evaluate(() => window.lurk.openSettings('playback')),
  ]);
  const toggle = settings.getByRole('switch', { name: settingsText.playback.liveNotifications });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect
    .poll(() => page.evaluate(async () => (await window.lurk.settings.get()).player.liveNotifications))
    .toBe(true);
  await settings.close();
});
