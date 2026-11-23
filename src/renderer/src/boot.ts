// Start of every window: language, settings and theme before the first paint, then live updates.

import type { AppInfo } from '@shared/ipc';
import type { Settings } from '@shared/settings';
import { setUpI18n } from './i18n';
import { applyTheme, onSystemSchemeChange } from './theme/applyTheme';

let bootedInfo: AppInfo | null = null;

/** What the main process told the window at its start (features, platform, language). */
export function appInfo(): AppInfo {
  if (!bootedInfo) throw new Error('boot() has not run');
  return bootedInfo;
}

export async function boot(): Promise<{ info: AppInfo; settings: Settings }> {
  const [info, settings] = await Promise.all([window.lurk.appInfo(), window.lurk.settings.get()]);
  bootedInfo = info;
  await setUpI18n(info.language);
  let current = settings;
  applyTheme(current.appearance);
  window.lurk.settings.onChange((next) => {
    current = next;
    applyTheme(current.appearance);
  });
  onSystemSchemeChange(() => applyTheme(current.appearance));
  return { info, settings };
}
