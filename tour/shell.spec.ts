// Tour, part "window": the main window and the settings window, clicked and typed like a user,
// with screenshots per system in light and dark (tour/out/<platform>/, uploaded by CI).
// The search uses a pasted twitch.tv link and the "all results" entry, so it needs no network.

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
// One app for all steps: a failing step skips the rest instead of starting a fresh app.
test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let page: Page;
let dataDir: string;
let shell: typeof enShell;
let settingsText: typeof enSettings;
let browse: typeof enBrowse;

test.beforeAll(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'lurk-tour-'));
  app = await electron.launch({ args: ['.'], env: { ...process.env, LURK_DATA_DIR: dataDir } });
  page = await app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  const language = await page.evaluate(() => document.documentElement.lang);
  shell = language === 'de' ? deShell : enShell;
  settingsText = language === 'de' ? deSettings : enSettings;
  browse = language === 'de' ? deBrowse : enBrowse;
  mkdirSync(screenshots, { recursive: true });
});

test.afterAll(async () => {
  await app?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const canvas = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
/** Lets hover and fade transitions finish, so screenshots show the settled state. */
const settle = () => page.waitForTimeout(400);

test('starts dark on Abos, with the navigation of this stage', async () => {
  const nav = page.getByRole('navigation', { name: shell.navigation });
  await expect(nav.getByRole('button')).toHaveText([
    shell.nav.subscriptions,
    shell.nav.browse,
    shell.nav.categories,
    shell.nav.history,
  ]);
  await expect(nav.getByRole('button', { name: shell.nav.subscriptions })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(shell.pages.subscriptions);
  expect(await canvas()).toBe('rgb(18, 16, 22)');
  await page.screenshot({ path: path.join(screenshots, 'window-dark.png') });
});

test('switches pages from the sidebar; a second click returns to the root', async () => {
  const nav = page.getByRole('navigation', { name: shell.navigation });
  await nav.getByRole('button', { name: shell.nav.browse }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(shell.pages.browse);
  await expect(nav.getByRole('button', { name: shell.nav.browse })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: shell.back })).toBeDisabled();
});

test('search: a twitch.tv link opens the channel, Back returns', async () => {
  const search = page.getByRole('combobox', { name: shell.search.label, exact: true });
  await search.fill('twitch.tv/gronkh');
  const option = page.getByRole('option').first();
  await expect(option).toContainText(shell.search.linkChannel.replace('{{login}}', 'gronkh'));
  await search.press('Enter');
  // The channel page (part 5b): Twitch's display name, then the avatar beside the header.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/gronkh/i, { timeout: 15_000 });
  await expect(page.locator('.page-layer:not(.is-covered) .art-head')).toBeVisible();
  await expect(search).toHaveValue('');
  // On a page above the sections, no navigation entry claims to be the current page.
  await expect(page.locator('nav [aria-current]')).toHaveCount(0);
  await page.getByRole('button', { name: shell.back }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(shell.pages.browse);
});

test('search: arrow keys, Escape and "all results"', async () => {
  const search = page.getByRole('combobox', { name: shell.search.label, exact: true });
  await search.fill('zzzlurktour');
  await expect(search).toHaveAttribute('aria-expanded', 'true');
  const all = page.getByRole('option', { name: new RegExp(shell.search.allSubtitle) });
  await expect(all).toBeVisible();
  await search.press('ArrowDown');
  await expect(search).toHaveAttribute('aria-activedescendant', /suggestion-\d+/);
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await search.fill('zzzlurktour');
  await search.press('Enter');
  // The search's own page (part 5a): the term as its title, then what Twitch found.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    browse.search.title.replace('{{term}}', 'zzzlurktour'),
  );
  // Twitch's search is fuzzy: whatever it finds, the channels section is there.
  await expect(page.getByRole('heading', { level: 2, name: new RegExp(browse.search.channelsSection) })).toBeVisible({
    timeout: 15_000,
  });
});

test('the sidebar can be hidden and shown again', async () => {
  await page.getByRole('button', { name: shell.toggleSidebar }).click();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await page.getByRole('button', { name: shell.toggleSidebar }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
});

test('the settings window changes the appearance in every window at once', async () => {
  const [settings] = await Promise.all([
    app.waitForEvent('window'),
    page.getByRole('button', { name: shell.settings }).click(),
  ]);
  // "Einstellungen" opens on the tab used last – the first time "Wiedergabe", as on macOS.
  const playbackTab = settings.getByRole('tab', { name: settingsText.tabs.playback });
  await expect(playbackTab).toHaveAttribute('aria-selected', 'true');
  // The tab list is one Tab stop; the arrow keys switch tabs.
  await playbackTab.focus();
  await settings.keyboard.press('ArrowLeft');
  const appearanceTab = settings.getByRole('tab', { name: settingsText.tabs.appearance });
  await expect(appearanceTab).toHaveAttribute('aria-selected', 'true');
  await expect(appearanceTab).toBeFocused();
  await expect.poll(() => settings.title()).toBe(settingsText.tabs.appearance);
  await settle();
  await settings.screenshot({ path: path.join(screenshots, 'settings-dark.png') });

  // A second open focuses the same window.
  await page.getByRole('button', { name: shell.settings }).click();
  expect(app.windows()).toHaveLength(2);

  await settings.getByRole('radio', { name: settingsText.appearance.mode.light }).click();
  await expect(settings.getByRole('radio', { name: settingsText.appearance.mode.light })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect.poll(canvas).toBe('rgb(246, 245, 249)');
  await settle();
  await page.screenshot({ path: path.join(screenshots, 'window-light.png') });
  await settings.screenshot({ path: path.join(screenshots, 'settings-light.png') });

  await settings.getByRole('radio', { name: settingsText.appearance.accent.teal }).click();
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent')))
    .toBe('#0E8487');

  await settings
    .getByRole('radio', {
      name: settingsText.appearance.toneLabel.replace('{{name}}', settingsText.appearance.tone.midnight),
    })
    .click();
  await expect.poll(canvas).toBe('rgb(242, 245, 251)');

  // The mode group is one Tab stop; the arrow keys move and choose (Hell → Dunkel).
  await settings.getByRole('radio', { name: settingsText.appearance.mode.light }).focus();
  await settings.keyboard.press('ArrowRight');
  await expect(settings.getByRole('radio', { name: settingsText.appearance.mode.dark })).toBeFocused();
  await expect(settings.getByRole('radio', { name: settingsText.appearance.mode.dark })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await settings.getByRole('radio', { name: settingsText.appearance.accent.violet }).click();
  await settings
    .getByRole('radio', {
      name: settingsText.appearance.toneLabel.replace('{{name}}', settingsText.appearance.tone.graphite),
    })
    .click();
  await expect.poll(canvas).toBe('rgb(18, 16, 22)');
  await settings.close();
});
