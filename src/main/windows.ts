// The app's windows: one main window, one settings window and the import window of "Von Twitch
// übernehmen". Both load the interface from
// lurk://app and take their background from the current appearance, so they never flash white.

import {
  app,
  BrowserWindow,
  nativeTheme,
  screen,
  type BrowserWindowConstructorOptions,
  type WebContents,
} from 'electron';
import path from 'node:path';
import { Channel, type AppCommand, type SettingsTab } from '@shared/ipc';
import type { LibraryState } from '@shared/library';
import type { BlockerState } from '@shared/blocker';
import type { FollowsPhase } from '@shared/follows';
import type { LiveState } from '@shared/subscriptions';
import { resolveColors, schemeFor } from '@shared/theme';
import { followsImport } from './followsImport';
import { menuText } from './i18n';
import { appOrigin, devServerUrl } from './security';
import { settingsStore } from './settingsStore';

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let followsWindow: BrowserWindow | null = null;

function pageUrl(page: 'index' | 'settings' | 'follows', query = ''): string {
  const base = devServerUrl ? devServerUrl.replace(/\/$/, '') : appOrigin;
  return `${base}/${page}.html${query}`;
}

function canvasColor(): string {
  const { appearance } = settingsStore.get();
  return resolveColors(appearance, schemeFor(appearance.mode, nativeTheme.shouldUseDarkColors)).canvas;
}

function baseOptions(): BrowserWindowConstructorOptions {
  return {
    show: false,
    backgroundColor: canvasColor(),
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      // Streams start on a click in the app; the player decides about sound itself.
      autoplayPolicy: 'no-user-gesture-required',
      spellcheck: false,
    },
  };
}

export function createMainWindow(): BrowserWindow {
  // Like the macOS app: 1360 × 860 at most, never larger than the screen's work area.
  const area = screen.getPrimaryDisplay().workAreaSize;
  const window = new BrowserWindow({
    ...baseOptions(),
    width: Math.min(1360, area.width - 40),
    height: Math.min(860, area.height - 40),
    minWidth: 980,
    minHeight: 620,
    // Sizes are the content's, as in the macOS app, not including the title bar.
    useContentSize: true,
    title: 'Lurk',
    // macOS: the title bar row belongs to the app (traffic lights inset, sidebar toggle and back
    // beside them). Windows and Linux keep the system title bar; the menu bar shows with Alt.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 18 } }
      : { autoHideMenuBar: true }),
  });
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  // The page switches to the cinema layout in fullscreen (also when the menu or the system starts it).
  window.on('enter-full-screen', () => window.webContents.send(Channel.fullScreenChanged, true));
  window.on('leave-full-screen', () => window.webContents.send(Channel.fullScreenChanged, false));
  void window.loadURL(pageUrl('index'));
  mainWindow = window;
  return window;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function sendCommand(command: AppCommand): void {
  const focused = BrowserWindow.getFocusedWindow();
  // The settings and the import window have no lists or search: their commands go to the main window.
  const target = focused === settingsWindow || focused === followsWindow ? mainWindow : (focused ?? mainWindow);
  if (target && target !== settingsWindow && target !== followsWindow)
    target.webContents.send(Channel.command, command);
}

/** One settings window: a second open brings it to the front. */
/** Without a tab: the window opens on the tab used last, as on macOS; only "Lurk anpassen …" names one. */
export function openSettingsWindow(tab?: SettingsTab): void {
  if (settingsWindow) {
    if (settingsWindow.isMinimized()) settingsWindow.restore();
    settingsWindow.focus();
    // "Lurk anpassen …" switches an open window to its tab, as on macOS.
    if (tab) settingsWindow.webContents.send(Channel.settingsShowTab, tab);
    return;
  }
  const window = new BrowserWindow({
    ...baseOptions(),
    width: 600,
    height: 560,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    minimizable: process.platform === 'darwin',
    fullscreenable: false,
    title: menuText('settingsWindowTitle'),
    ...(process.platform === 'darwin' ? {} : { autoHideMenuBar: true }),
  });
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (settingsWindow === window) settingsWindow = null;
  });
  void window.loadURL(pageUrl('settings', tab ? `?tab=${encodeURIComponent(tab)}` : ''));
  settingsWindow = window;
}

/**
 * "Von Twitch übernehmen …": one import window; a second call brings it to the front. Opening it
 * starts a new code; closing it in any phase ends the sign-in (followsImport.ts).
 */
export function openFollowsWindow(): void {
  if (followsWindow) {
    if (followsWindow.isMinimized()) followsWindow.restore();
    followsWindow.focus();
    return;
  }
  const window = new BrowserWindow({
    ...baseOptions(),
    // No reference size: the Mac's 520 × 720 held its embedded login.
    width: 480,
    height: 460,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    minimizable: process.platform === 'darwin',
    fullscreenable: false,
    title: menuText('followsWindowTitle'),
    ...(process.platform === 'darwin' ? {} : { autoHideMenuBar: true }),
  });
  window.once('ready-to-show', () => window.show());
  // A crashed page must not leave the polling running unseen.
  window.webContents.on('render-process-gone', () => {
    if (!window.isDestroyed()) window.destroy();
  });
  window.on('closed', () => {
    if (followsWindow === window) followsWindow = null;
    followsImport.windowClosed();
  });
  void window.loadURL(pageUrl('follows'));
  followsWindow = window;
  followsImport.start();
}

export function closeFollowsWindow(): void {
  followsWindow?.close();
}

/** Whether a sender is the import window's own page (its calls are refused from anywhere else). */
export function isFollowsPage(contents: WebContents): boolean {
  return followsWindow !== null && !followsWindow.isDestroyed() && followsWindow.webContents === contents;
}

/**
 * After the browser step the user is still in the browser: the question "Follows von @…
 * übernehmen?" (or what went wrong) comes to the front instead of waiting unseen behind it.
 */
export function bringFollowsWindowForward(): void {
  const window = followsWindow;
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  if (process.platform === 'darwin') app.focus({ steal: true });
  window.show();
  window.focus();
  // The system may refuse the focus from the background (Windows; macOS can decline it, and its
  // activation takes a moment): then the taskbar button flashes or the Dock icon bounces once.
  setTimeout(() => {
    if (window.isDestroyed() || window.isFocused()) return;
    window.flashFrame(true);
    window.once('focus', () => window.flashFrame(false));
  }, flashAfterMs);
}

/** How long the focus may take before the window asks for attention instead (ms). */
const flashAfterMs = 400;

/** The import's phase reaches only its own window. */
export function sendFollowsPhase(phase: FollowsPhase): void {
  if (followsWindow && !followsWindow.isDestroyed()) followsWindow.webContents.send(Channel.followsPhaseChanged, phase);
}

/** Window backgrounds follow the canvas (after a setting change or a system light/dark switch). */
export function refreshBackgrounds(): void {
  const background = canvasColor();
  for (const window of BrowserWindow.getAllWindows()) window.setBackgroundColor(background);
}

/** The subscriptions' live status changed: the sidebar, the Abos page and the menus hear it. */
export function broadcastLive(state: LiveState): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(Channel.liveChanged, state);
}

/** The ad blocker's log or totals changed: the settings tab and the player's shield hear it. */
export function broadcastBlocker(state: BlockerState): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(Channel.blockerChanged, state);
}

/** History and positions changed: every window hears it (the history page, the settings' delete buttons). */
export function broadcastLibrary(state: LibraryState): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(Channel.libraryChanged, state);
}

/** Watch time as it is counted: only the settings window shows it (the ranking). */
export function sendWatchTime(watchTime: Record<string, number>): void {
  settingsWindow?.webContents.send(Channel.libraryWatchTimeChanged, watchTime);
}

/** After a settings change: the native frame follows, and every window gets the new settings. */
export function broadcastSettings(): void {
  const settings = settingsStore.get();
  if (nativeTheme.themeSource !== settings.appearance.mode) nativeTheme.themeSource = settings.appearance.mode;
  refreshBackgrounds();
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(Channel.settingsChanged, settings);
}
