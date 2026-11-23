// Tour, part "follows": "Von Twitch übernehmen" with the device code. The tour answers Twitch
// itself – fixed replies on the import's private session, installed from outside through
// Playwright (the app has no hook for it) – so no real code, token or account is involved. It
// checks the window, the code, reading, the revokes before subscribing, the question, the
// failures, a late token and that nothing of the sign-in stays in the data folder. Needs network
// only for the channels' live status. Screenshots in tour/out/<platform>/.

import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import deBrowse from '../locales/de/browse.json' with { type: 'json' };
import deFollows from '../locales/de/follows.json' with { type: 'json' };
import deShell from '../locales/de/shell.json' with { type: 'json' };
import enBrowse from '../locales/en/browse.json' with { type: 'json' };
import enFollows from '../locales/en/follows.json' with { type: 'json' };
import enShell from '../locales/en/shell.json' with { type: 'json' };

const screenshots = path.join('tour', 'out', process.platform);
const clientId = 'lurktourclient0001';
let app: ElectronApplication;
let page: Page;
let dataDir: string;
let browse: typeof enBrowse;
let follows: typeof enFollows;
let shell: typeof enShell;
let savedClipboard = '';

type Scenario = 'success' | 'expired' | 'denied' | 'empty' | 'late';
interface Seen {
  host: string;
  path: string;
  method: string;
  auth: string | null;
  clientId: string | null;
  cookie: string | null;
}
interface TourTwitch {
  scenario: Scenario;
  requests: Seen[];
  revoked: string[];
  opened: string[];
}

test.describe.configure({ mode: 'serial', timeout: 120_000 });

const twitch = () =>
  app.evaluate(() => (globalThis as unknown as { tourTwitch: TourTwitch }).tourTwitch) as Promise<TourTwitch>;
const setScenario = (scenario: Scenario) =>
  app.evaluate((_electron, value) => {
    (globalThis as unknown as { tourTwitch: TourTwitch }).tourTwitch.scenario = value;
  }, scenario);
const subscriptionCount = () => page.evaluate(async () => (await window.lurk.library.get()).subscriptions.length);

test.beforeAll(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'lurk-tour-'));
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, LURK_DATA_DIR: dataDir, LURK_TWITCH_CLIENT_ID: clientId },
  });
  page = await app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  const language = await page.evaluate(() => document.documentElement.lang);
  browse = language === 'de' ? deBrowse : enBrowse;
  follows = language === 'de' ? deFollows : enFollows;
  shell = language === 'de' ? deShell : enShell;
  await page.evaluate(() => window.lurk.settings.update({ player: { muted: true } }));
  // Three real channels, so the Abos page can show them with their live status afterwards.
  const top = await page.evaluate(() => window.lurk.twitch.top(3));
  const channels = [];
  for (const stream of top) {
    const details = await page.evaluate((login) => window.lurk.twitch.channel(login), stream.login);
    if (details) channels.push(details.ref);
  }
  expect(channels).toHaveLength(3);
  savedClipboard = await app.evaluate(({ clipboard }) => clipboard.readText());

  // Twitch, answered by the tour on the import's own session; the system browser, recorded.
  await app.evaluate(
    ({ session, shell: system }, { channels: known, client }) => {
      const state = { scenario: 'success', requests: [], revoked: [], opened: [], codes: 0, polls: 0, tokens: 0 };
      (globalThis as Record<string, unknown>)['tourTwitch'] = state;
      system.openExternal = (async (url: string) => {
        state.opened.push(url as never);
      }) as typeof system.openExternal;
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      const token = () => {
        state.tokens += 1;
        const n = String(state.tokens).padStart(4, '0');
        return json(200, {
          access_token: `tourAccess${n}abcdefghijklmnop`,
          refresh_token: `tourRefresh${n}abcdefghijklmnopqrstuvwxyz`,
          expires_in: 14_000,
          scope: ['user:read:follows'],
          token_type: 'bearer',
        });
      };
      session.fromPartition('follows', { cache: false }).protocol.handle('https', async (request) => {
        const url = new URL(request.url);
        const form = new URLSearchParams(request.method === 'POST' ? await request.text() : '');
        state.requests.push({
          host: url.host,
          path: url.pathname,
          method: request.method,
          auth: request.headers.get('authorization'),
          clientId: request.headers.get('client-id') ?? form.get('client_id'),
          cookie: request.headers.get('cookie'),
        } as never);
        const scenario = state.scenario;
        if (url.host === 'id.twitch.tv' && url.pathname === '/oauth2/device') {
          state.codes += 1;
          state.polls = 0;
          return json(200, {
            device_code: `TourDeviceCode000${state.codes}`,
            user_code: `TOURCOD${state.codes}`,
            verification_uri: `https://www.twitch.tv/activate?public=true&device-code=TOURCOD${state.codes}`,
            expires_in: 1800,
            interval: 1,
          });
        }
        if (url.host === 'id.twitch.tv' && url.pathname === '/oauth2/token') {
          state.polls += 1;
          if (scenario === 'expired') return json(400, { status: 400, message: 'invalid device code' });
          if (scenario === 'denied') return json(400, { status: 400, message: 'authorization denied' });
          if (scenario === 'late') {
            await new Promise((resolve) => setTimeout(resolve, 4000));
            return token();
          }
          if (scenario === 'success' && state.polls === 1)
            return json(400, { status: 400, message: 'authorization_pending' });
          if (scenario === 'success' && state.polls === 2) return json(400, { error: 'slow_down' });
          return token();
        }
        if (url.host === 'id.twitch.tv' && url.pathname === '/oauth2/validate') {
          return json(200, {
            client_id: client,
            login: 'tourviewer',
            scopes: ['user:read:follows'],
            user_id: '424242',
            expires_in: 14_000,
          });
        }
        if (url.host === 'id.twitch.tv' && url.pathname === '/oauth2/revoke') {
          state.revoked.push(form.get('token') as never);
          return new Response(null, { status: 200 });
        }
        if (url.host === 'api.twitch.tv' && url.pathname === '/helix/channels/followed') {
          if (scenario === 'empty') return json(200, { total: 0, data: [], pagination: {} });
          const second = url.searchParams.get('after') === 'page2';
          const list = second ? known.slice(2) : known.slice(0, 2);
          return json(200, {
            total: known.length,
            data: list.map((channel) => ({
              broadcaster_id: channel.id,
              broadcaster_login: channel.login,
              broadcaster_name: channel.displayName,
              followed_at: '2026-01-01T00:00:00Z',
            })),
            pagination: second ? {} : { cursor: 'page2' },
          });
        }
        return new Response('not found', { status: 404 });
      });
    },
    { channels, client: clientId },
  );
  mkdirSync(screenshots, { recursive: true });
});

test.afterAll(async () => {
  await app?.evaluate(({ clipboard }, text) => clipboard.writeText(text), savedClipboard);
  await app?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const front = () => page.locator('.page-layer:not(.is-covered)');
let importWindow: Page;

/** The next system menu the page opens picks the entry with this label (Playwright cannot click it). */
async function chooseFromNextMenu(label: string): Promise<void> {
  await app.evaluate(({ Menu }, wanted) => {
    const original = Menu.buildFromTemplate;
    Menu.buildFromTemplate = ((template: Electron.MenuItemConstructorOptions[]) => {
      Menu.buildFromTemplate = original;
      (globalThis as Record<string, unknown>)['tourMenu'] = template.map((item) => item.label ?? '—');
      return {
        popup: (options: Electron.PopupOptions = {}) => {
          const item = template.find((entry) => entry.label === wanted);
          (item?.click as (() => void) | undefined)?.();
          options.callback?.();
        },
      } as unknown as Electron.Menu;
    }) as typeof Menu.buildFromTemplate;
  }, label);
}

test('"Von Twitch übernehmen …" opens one window with a code', async () => {
  await page.getByRole('navigation').getByRole('button', { name: shell.nav.subscriptions, exact: true }).click();
  await chooseFromNextMenu(browse.subs.fromTwitch);
  [importWindow] = await Promise.all([
    app.waitForEvent('window'),
    front().getByRole('button', { name: browse.subs.transfer }).click(),
  ]);
  const labels = await app.evaluate(() => (globalThis as Record<string, unknown>)['tourMenu'] as string[]);
  expect(labels.slice(0, 2)).toEqual([browse.subs.fromTwitch, browse.subs.import]);
  await expect(importWindow.getByRole('heading', { level: 1, name: follows.title })).toBeVisible();
  await expect(importWindow.locator('.device-code')).toContainText('TOURCOD1');
  // A second call brings the same window to the front.
  const count = app.windows().length;
  await page.evaluate(() => window.lurk.subscriptions.importFromTwitch());
  expect(app.windows()).toHaveLength(count);
  await importWindow.screenshot({ path: path.join(screenshots, '20-follows-code.png') });
});

test('the code opens in the browser and is copied, nothing else leaves the main process', async () => {
  await importWindow.getByRole('button', { name: follows.code.open }).click();
  await expect
    .poll(async () => (await twitch()).opened)
    .toEqual(['https://www.twitch.tv/activate?public=true&device-code=TOURCOD1']);
  await importWindow.getByRole('button', { name: follows.code.copy }).click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('TOURCOD1');
  expect(await importWindow.content()).not.toContain('TourDeviceCode');
  // Another page of the app cannot act for the import window.
  await expect(page.evaluate(() => window.lurk.follows.phase())).rejects.toThrow();
});

test('after the confirmation Lurk reads, ends the sign-in, then asks', async () => {
  const question = follows.confirm.title.replace('{{login}}', 'tourviewer');
  await expect(importWindow.getByRole('heading', { name: question })).toBeVisible({ timeout: 45_000 });
  const seen = await twitch();
  // Revoked before anything was subscribed: the refresh token first, then the access token.
  expect(seen.revoked).toEqual(['tourRefresh0001abcdefghijklmnopqrstuvwxyz', 'tourAccess0001abcdefghijklmnop']);
  expect(await subscriptionCount()).toBe(0);
  const validate = seen.requests.find((request) => request.path === '/oauth2/validate');
  expect(validate?.auth).toBe('OAuth tourAccess0001abcdefghijklmnop');
  const pages = seen.requests.filter((request) => request.path === '/helix/channels/followed');
  expect(pages).toHaveLength(2);
  expect(pages.every((request) => request.auth === 'Bearer tourAccess0001abcdefghijklmnop')).toBe(true);
  // Every request names Lurk's client (validate needs only the token, as Twitch documents it).
  expect(
    seen.requests.filter((request) => request.path !== '/oauth2/validate').every((r) => r.clientId === clientId),
  ).toBe(true);
  expect(seen.requests.every((request) => request.cookie === null)).toBe(true);
  await importWindow.screenshot({ path: path.join(screenshots, '21-follows-frage.png') });

  await importWindow.getByRole('button', { name: follows.confirm.accept }).click();
  await expect(
    importWindow.getByRole('heading', { name: follows.done.title_other.replace('{{number}}', '3') }),
  ).toBeVisible();
  await expect(importWindow.getByText(follows.done.forgotten)).toBeVisible();
  expect(await subscriptionCount()).toBe(3);
  await importWindow.screenshot({ path: path.join(screenshots, '22-follows-fertig.png') });
  await Promise.all([
    importWindow.waitForEvent('close'),
    importWindow.getByRole('button', { name: follows.done.finish }).click(),
  ]);
  await expect(front().locator('.stream-tile, .channel-row')).toHaveCount(3, { timeout: 20_000 });
});

test('expired, refused and empty end with "Erneut versuchen", which starts over', async () => {
  await setScenario('expired');
  [importWindow] = await Promise.all([
    app.waitForEvent('window'),
    page.evaluate(() => window.lurk.subscriptions.importFromTwitch()),
  ]);
  await expect(importWindow.getByText(follows.failed.expired)).toBeVisible({ timeout: 20_000 });
  await expect(importWindow.getByRole('heading', { name: follows.failed.title })).toBeVisible();
  await importWindow.screenshot({ path: path.join(screenshots, '23-follows-fehler.png') });

  await setScenario('denied');
  await importWindow.getByRole('button', { name: follows.failed.retry }).click();
  await expect(importWindow.locator('.device-code')).toContainText('TOURCOD3');
  await expect(importWindow.getByText(follows.failed.denied)).toBeVisible({ timeout: 20_000 });

  await setScenario('empty');
  await importWindow.getByRole('button', { name: follows.failed.retry }).click();
  await expect(importWindow.getByText(follows.failed.empty)).toBeVisible({ timeout: 20_000 });
  const seen = await twitch();
  expect(seen.revoked).toContain('tourAccess0002abcdefghijklmnop');
});

test('closing while a token is on its way revokes it, and nothing is subscribed', async () => {
  await setScenario('late');
  await importWindow.getByRole('button', { name: follows.failed.retry }).click();
  await expect(importWindow.locator('.device-code')).toBeVisible();
  const before = (await twitch()).requests.filter((request) => request.path === '/oauth2/token').length;
  await expect
    .poll(async () => (await twitch()).requests.filter((request) => request.path === '/oauth2/token').length, {
      timeout: 15_000,
    })
    .toBeGreaterThan(before);
  await importWindow.close();
  await expect
    .poll(async () => (await twitch()).revoked, { timeout: 15_000 })
    .toContain('tourAccess0003abcdefghijklmnop');
  expect(await subscriptionCount()).toBe(3);
});

test('"Fenster schließen" is in the menu, and the sign-in leaves no trace on disk', async () => {
  await setScenario('expired');
  [importWindow] = await Promise.all([
    app.waitForEvent('window'),
    page.evaluate(() => window.lurk.subscriptions.importFromTwitch()),
  ]);
  await expect(importWindow.getByRole('heading', { level: 1, name: follows.title })).toBeVisible();
  // ⌘W / Ctrl+W is the menu's "Fenster schließen" (the system's close command; Playwright's keys
  // and clicks from outside do not reach it on macOS): the tour checks the entry, then closes.
  const hasClose = await app.evaluate(({ Menu }) => {
    const roles = (items: Electron.MenuItem[]): string[] =>
      items.flatMap((item) => [item.role ?? '', ...(item.submenu ? roles(item.submenu.items) : [])]);
    return roles(Menu.getApplicationMenu()?.items ?? []).includes('close');
  });
  expect(hasClose).toBe(true);
  await importWindow.close();
  // Give the stores a moment to write, then search every file of the data folder.
  await page.evaluate(() => window.lurk.settings.update({ player: { muted: true } }));
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const files: string[] = [];
  const walk = (folder: string) => {
    for (const name of readdirSync(folder)) {
      const file = path.join(folder, name);
      // Chromium's singleton links point nowhere readable: skip links, follow folders.
      const info = lstatSync(file);
      if (info.isDirectory()) walk(file);
      else if (info.isFile()) files.push(file);
    }
  };
  walk(dataDir);
  for (const file of files) {
    const bytes = readFileSync(file);
    for (const secret of ['tourAccess', 'tourRefresh', 'TourDeviceCode']) {
      expect(bytes.includes(secret), `${secret} in ${path.relative(dataDir, file)}`).toBe(false);
    }
  }
});
