// Tour, part "foundation": starts the built app like a user would and checks the security baseline
// from inside the page.

import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// One app for all steps: a failing step skips the rest instead of starting a fresh app.
test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let page: Page;
let dataDir: string;

test.beforeAll(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'lurk-tour-'));
  app = await electron.launch({ args: ['.'], env: { ...process.env, LURK_DATA_DIR: dataDir } });
  page = await app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test('runs on its own origin with the tour data folder', async () => {
  expect(page.url()).toBe('lurk://app/index.html');
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(dataDir);
});

test('the page has no Node, only the bridge', async () => {
  const globals = await page.evaluate(() => ({
    require: typeof (globalThis as Record<string, unknown>)['require'],
    process: typeof (globalThis as Record<string, unknown>)['process'],
    bridge: Object.keys((globalThis as unknown as { lurk: object }).lurk),
  }));
  expect(globals).toEqual({
    require: 'undefined',
    process: 'undefined',
    bridge: [
      'appInfo',
      'settings',
      'openSettings',
      'onSettingsTab',
      'openExternal',
      'onCommand',
      'copyLink',
      'showMenu',
      'setFullScreen',
      'onFullScreenChange',
      'chat',
      'subscriptions',
      'blocker',
      'follows',
      'library',
      'browse',
      'twitch',
    ],
  });
});

test('the Content-Security-Policy blocks eval and inline scripts', async () => {
  const result = await page.evaluate(async () => {
    // DevTools lets the evaluated code itself use eval; a timer callback runs as normal page code.
    const evalResult = await new Promise<string>((resolve) =>
      setTimeout(() => {
        try {
          eval('1');
          resolve('allowed');
        } catch {
          resolve('blocked');
        }
      }, 0),
    );
    const marker = 'lurkInlineRan';
    const script = document.createElement('script');
    script.textContent = `window.${marker} = true;`;
    document.body.append(script);
    await new Promise((resolve) => setTimeout(resolve, 100));
    script.remove();
    return { eval: evalResult, inline: (window as unknown as Record<string, unknown>)[marker] === true };
  });
  expect(result).toEqual({ eval: 'blocked', inline: false });
  const policy = await page.evaluate(async () =>
    (await fetch('lurk://app/index.html')).headers.get('content-security-policy'),
  );
  expect(policy).toContain("script-src 'self'");
  expect(policy).not.toContain('unsafe');
});

test('the app does not navigate away or open windows', async () => {
  // Not https: so nothing is handed to the system browser either.
  const opened = await page.evaluate(() => window.open('http://127.0.0.1:9/') === null);
  expect(opened).toBe(true);
  await page.evaluate(() => {
    window.location.href = 'http://127.0.0.1:9/';
  });
  await page.waitForTimeout(300);
  expect(page.url()).toBe('lurk://app/index.html');
  expect(app.windows()).toHaveLength(1);
});

test('lurk:// does not serve files outside the interface', async () => {
  const statuses = await page.evaluate(async () => {
    const paths = ['/../main/index.js', '/%2e%2e/main/index.js', '/..%2fpreload%2findex.cjs', '/missing.js'];
    return Promise.all(paths.map(async (path) => (await fetch(`lurk://app${path}`)).status));
  });
  expect(statuses).toEqual([404, 404, 404, 404]);
});
