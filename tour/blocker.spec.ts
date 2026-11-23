// Tour, part "blocker": the settings tab "Werbeblocker" (sections, own filters with their problems,
// a request the network filter blocks, statistics and log, reset through the system dialog the
// tour answers), and the shield in the player with its popover (open, Esc, the switch restarts the
// stream, the link opens the tab). Needs network. Screenshots in tour/out/<platform>/.

import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dePlayer from '../locales/de/player.json' with { type: 'json' };
import deSettings from '../locales/de/settings.json' with { type: 'json' };
import deShell from '../locales/de/shell.json' with { type: 'json' };
import enPlayer from '../locales/en/player.json' with { type: 'json' };
import enSettings from '../locales/en/settings.json' with { type: 'json' };
import enShell from '../locales/en/shell.json' with { type: 'json' };

const screenshots = path.join('tour', 'out', process.platform);
const blockedHost = 'lurk-tour-blocked.example';
let app: ElectronApplication;
let page: Page;
let settingsWindow: Page;
let dataDir: string;
let player: typeof enPlayer;
let settingsText: typeof enSettings;
let shell: typeof enShell;
let login: string;

test.describe.configure({ mode: 'serial', timeout: 120_000 });

test.beforeAll(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'lurk-tour-'));
  app = await electron.launch({ args: ['.'], env: { ...process.env, LURK_DATA_DIR: dataDir } });
  page = await app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  const language = await page.evaluate(() => document.documentElement.lang);
  player = language === 'de' ? dePlayer : enPlayer;
  settingsText = language === 'de' ? deSettings : enSettings;
  shell = language === 'de' ? deShell : enShell;
  await page.evaluate(() => window.lurk.settings.update({ player: { muted: true } }));
  const [top] = await page.evaluate(() => window.lurk.browse.streams('all', 'EN', 'VIEWER_COUNT', null));
  expect(top, 'a live stream on Twitch').toBeTruthy();
  login = top!.broadcaster.login;
  // The tour answers the system's confirmation itself (Playwright cannot click it).
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
  mkdirSync(screenshots, { recursive: true });
});

test.afterAll(async () => {
  await app?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const blockerText = () => settingsText.blocker;
const section = (title: string) => settingsWindow.getByRole('region', { name: title });

test('the tab "Werbeblocker" shows the switch, the statistics, the lists, the own filters and the log', async () => {
  [settingsWindow] = await Promise.all([
    app.waitForEvent('window'),
    page.evaluate(() => window.lurk.openSettings('blocker')),
  ]);
  const text = blockerText();
  await expect(settingsWindow.getByRole('tab', { name: settingsText.tabs.blocker })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(settingsWindow.getByRole('heading', { level: 1, name: text.introTitle })).toBeVisible();
  for (const title of [text.section, text.statsSection, text.listsSection, text.ownSection, text.logSection]) {
    await expect(settingsWindow.getByRole('heading', { level: 2, name: title })).toBeVisible();
  }
  await expect(settingsWindow.getByRole('switch', { name: text.enabled })).toBeChecked();
  await expect(section(text.listsSection)).toContainText(text.rules_other.replace('{{number}}', '10'));
  await section(text.listsSection).getByText(text.showRules).click();
  await expect(section(text.listsSection).locator('.filter-list')).toContainText('||spade.twitch.tv^');
  await expect(section(text.logSection)).toContainText(text.logEmpty);
  await expect(settingsWindow.getByRole('button', { name: text.reset })).toBeDisabled();
  expect(await settingsWindow.title()).toBe(settingsText.tabs.blocker);
});

test('own filters: saved, counted, and their problems named by line', async () => {
  const text = blockerText();
  const editor = settingsWindow.getByRole('textbox', { name: text.ownLabel });
  await expect(settingsWindow.getByRole('button', { name: text.apply })).toBeDisabled();
  await editor.fill(`! Tour\n||${blockedHost}^\n||x.example^$redirect=noop.js\nexample.org##.banner`);
  await settingsWindow.getByRole('button', { name: text.apply }).click();
  await expect(settingsWindow.getByText(text.saved)).toBeVisible();
  await expect(settingsWindow.getByRole('button', { name: text.apply })).toBeDisabled();
  const own = section(text.ownSection);
  await expect(own.locator('.form-line')).toContainText(text.activeRules);
  await expect(own.locator('.form-line .form-value')).toHaveText('1');
  await expect(own).toContainText(text.skipped_one);
  await expect(own).toContainText(
    text.issueLine
      .replace('{{line}}', '3')
      .replace('{{reason}}', text.issue.option.replace('{{name}}', 'redirect=noop.js')),
  );
  expect(readFileSync(path.join(dataDir, 'eigene-filter.txt'), 'utf8')).toContain(`||${blockedHost}^`);
  await settingsWindow.screenshot({ path: path.join(screenshots, 'settings-blocker.png') });
});

test('a request to a filtered server is blocked, counted and logged; reset clears it', async () => {
  const text = blockerText();
  const result = await page.evaluate(async (host) => {
    try {
      await fetch(`https://${host}/tour?id=1`);
      return 'fetched';
    } catch {
      return 'blocked';
    }
  }, blockedHost);
  expect(result).toBe('blocked');
  const stats = section(text.statsSection);
  await expect(stats.locator('.form-line').filter({ hasText: text.blockedRequests }).locator('.form-value')).toHaveText(
    '1',
  );
  const log = section(text.logSection);
  await expect(log.locator('.log-row')).toHaveCount(1);
  await expect(log.locator('.log-row')).toContainText(`${blockedHost}/tour`);
  await expect(log.locator('.log-rule')).toHaveText(`||${blockedHost}^`);
  await expect(log).not.toContainText('id=1');
  await settingsWindow.getByRole('button', { name: text.reset }).click();
  await expect(log).toContainText(text.logEmpty);
  await expect(stats.locator('.form-line').filter({ hasText: text.blockedRequests }).locator('.form-value')).toHaveText(
    '0',
  );
});

test('the shield opens its popover; Esc closes it; the link opens the tab', async () => {
  const search = page.getByRole('combobox', { name: shell.search.label, exact: true });
  await search.fill(login);
  const live = page.getByRole('option').filter({ hasText: shell.search.live }).first();
  await expect(live).toBeVisible({ timeout: 15_000 });
  await live.click();
  await expect
    .poll(
      () =>
        page.locator('video.stage-video:not(.stage-clip)').evaluate((element: HTMLVideoElement) => element.currentTime),
      { timeout: 60_000 },
    )
    .toBeGreaterThan(2);
  await page.getByRole('region', { name: player.player }).hover();
  const shield = page.getByRole('button', { name: player.blocker.name, exact: true });
  await expect(shield).toBeVisible();
  await expect(shield).toHaveAttribute('title', player.blocker.on);
  await shield.click();
  const popover = page.getByRole('dialog', { name: player.blocker.name });
  await expect(popover).toBeVisible();
  await expect(shield).toHaveAttribute('aria-expanded', 'true');
  await expect(popover.getByRole('switch', { name: player.blocker.name })).toBeChecked();
  await expect(popover.getByRole('columnheader', { name: player.blocker.thisStream })).toBeVisible();
  await expect(popover.getByRole('rowheader', { name: player.blocker.requests })).toBeVisible();
  // The bar stays while the popover is open.
  await page.waitForTimeout(3_000);
  await expect(page.locator('.control-bar')).toHaveClass(/is-visible/);
  await page.screenshot({ path: path.join(screenshots, 'player-blocker.png') });
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  await expect(shield).toBeFocused();
  await shield.click();
  await popover.getByRole('button', { name: player.blocker.settings }).click();
  await expect(settingsWindow.getByRole('tab', { name: settingsText.tabs.blocker })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('the switch in the popover turns the blocker off and restarts the stream', async () => {
  await page.bringToFront();
  await page.getByRole('region', { name: player.player }).hover();
  const shield = page.getByRole('button', { name: player.blocker.name, exact: true });
  if ((await shield.getAttribute('aria-expanded')) !== 'true') await shield.click();
  const popover = page.getByRole('dialog', { name: player.blocker.name });
  // A new session gets a new media source: the restart is seen, not assumed.
  const source = () =>
    page.locator('video.stage-video:not(.stage-clip)').evaluate((element: HTMLVideoElement) => element.currentSrc);
  const before = await source();
  await popover.getByRole('switch', { name: player.blocker.name }).click();
  await expect.poll(() => page.evaluate(async () => (await window.lurk.settings.get()).blocker.enabled)).toBe(false);
  // The stream starts again – without the blocker, as twitch.tv plays it – in place: the popover
  // stays open and shows the new state.
  await expect.poll(source, { timeout: 30_000 }).not.toBe(before);
  await expect(popover).toBeVisible();
  await expect(popover.getByRole('switch', { name: player.blocker.name })).not.toBeChecked();
  await expect(popover).toContainText(player.blocker.offDetail);
  await page.keyboard.press('Escape');
  await expect
    .poll(
      () =>
        page.locator('video.stage-video:not(.stage-clip)').evaluate((element: HTMLVideoElement) => element.currentTime),
      { timeout: 90_000 },
    )
    .toBeGreaterThan(1);
  await page.getByRole('region', { name: player.player }).hover();
  await expect(page.getByRole('button', { name: player.blocker.name, exact: true })).toHaveAttribute(
    'title',
    player.blocker.off,
  );
  // Off, the network filter lets everything through (the request fails only for want of a server).
  const counted = (await page.evaluate(() => window.lurk.blocker.state())).totals.blockedRequests;
  await page.evaluate(async (host) => {
    await fetch(`https://${host}/tour`).catch(() => undefined);
  }, blockedHost);
  expect((await page.evaluate(() => window.lurk.blocker.state())).totals.blockedRequests).toBe(counted);
  await expect(settingsWindow.getByRole('switch', { name: blockerText().enabled })).not.toBeChecked();
  await page.evaluate(() => window.lurk.settings.update({ blocker: { enabled: true } }));
});
