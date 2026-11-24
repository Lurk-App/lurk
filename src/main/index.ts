// Main process: starts the app, serves the interface from lurk://app and holds everything that
// talks to the outside world. Requests to Twitch, Kick and YouTube run here – there is no CORS
// here, and the network filter sees every request in one place.

import { app, BrowserWindow, nativeTheme, session } from 'electron';
import path from 'node:path';
import { registerIpc } from './ipc';
import { installMenu } from './menu';
import { handleAppScheme, registerAppScheme } from './protocol';
import { secureSession, secureWebContents } from './security';
import { libraryStore } from './libraryStore';
import { blocker } from './blocker';
import type { FollowsPhase } from '@shared/follows';
import { followsImport } from './followsImport';
import { liveMonitor } from './liveMonitor';
import { settingsStore } from './settingsStore';
import {
  broadcastBlocker,
  broadcastLibrary,
  broadcastLive,
  broadcastSettings,
  bringFollowsWindowForward,
  createMainWindow,
  getMainWindow,
  refreshBackgrounds,
  sendFollowsPhase,
  sendWatchTime,
} from './windows';

app.setName('Lurk');
// Windows shows notifications only for an app with its own id (the installer's appId).
if (process.platform === 'win32') app.setAppUserModelId('app.lurk.desktop');

// Until 1.0 the new app keeps its data apart. On a Mac, "Lurk" is the folder of the native app,
// which 1.0 takes over (see the plan). LURK_DATA_DIR lets the tour run with a fresh folder.
const dataDir = (!app.isPackaged && process.env['LURK_DATA_DIR']) || path.join(app.getPath('appData'), 'Lurk Preview');
app.setPath('userData', dataDir);

registerAppScheme();
app.enableSandbox();
secureWebContents();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const window = getMainWindow();
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });

  void app.whenReady().then(() => {
    nativeTheme.themeSource = settingsStore.get().appearance.mode;
    settingsStore.onChange(broadcastSettings);
    libraryStore.onChange(broadcastLibrary);
    libraryStore.onWatchTime(sendWatchTime);
    liveMonitor.onChange(broadcastLive);
    // The answer to what the user just did in the browser comes to the front: the question, a
    // refusal there, or a failure while reading. Not an expired code or a failure before it.
    let previousPhase: FollowsPhase['kind'] | null = null;
    followsImport.onChange((phase) => {
      sendFollowsPhase(phase);
      const answer =
        phase.kind === 'confirm' ||
        (phase.kind === 'failed' && (phase.reason === 'denied' || previousPhase === 'reading'));
      if (answer) bringFollowsWindowForward();
      previousPhase = phase.kind;
    });
    blocker.onChange(broadcastBlocker);
    liveMonitor.start();
    // "Wie das System": a system switch changes the window backgrounds too.
    nativeTheme.on('updated', refreshBackgrounds);

    secureSession(session.defaultSession);
    // The network filter sees every request of the app's pages.
    blocker.install(session.defaultSession);
    handleAppScheme(session.defaultSession, path.join(import.meta.dirname, '../renderer'));
    registerIpc();
    installMenu();
    // The checkmark of "Chat anzeigen" follows the setting, whoever changed it.
    settingsStore.onChange(installMenu);
    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// The library and the ad blocker's totals write a moment after a change; what is pending is written
// before Lurk quits. An
// open "Von Twitch übernehmen" ends its sign-in at Twitch (at most 3 s). Quit is held for both, then
// the app exits (a second app.quit() would not end it on every system).
let libraryFlushed = false;
app.on('will-quit', (event) => {
  if (libraryFlushed) return;
  libraryFlushed = true;
  liveMonitor.stop();
  event.preventDefault();
  void Promise.allSettled([libraryStore.flush(), blocker.flush(), followsImport.forget()]).finally(() => app.exit(0));
});
