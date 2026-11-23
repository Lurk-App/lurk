import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from 'electron';
import { Channel, settingsTabs, type AppInfo, type MenuEntry, type Platform, type SettingsTab } from '@shared/ipc';
import type { PlayTarget } from '@shared/models';
import { defaultAppearance } from '@shared/theme';
import { currentLanguage, menuText } from './i18n';
import { isTrustedSender, openExternal } from './security';
import { settingsStore } from './settingsStore';
import { isContentType, isStreamLanguage, isStreamSort } from '@shared/browse';
import { thirdPartyEmotes } from './emotes';
import { browseStreams, categories, categoryPage, searchTags } from './lists';
import { adSwitchCandidates, normalizeRecord } from '@shared/library';
import { videoKinds, type VideoKind } from '@shared/models';
import { normalizeLogin } from '@shared/subscriptions';
import { libraryStore } from './libraryStore';
import { liveMonitor } from './liveMonitor';
import { exportSubscriptions, importSubscriptions } from './subscriptionFiles';
import {
  adClips,
  channel,
  clipSource,
  fetchPlaylist,
  fetchSegment,
  playbackUrl,
  search,
  topStreams,
  video,
  videos,
} from './twitch';
import { parseBlockerEvent } from '@shared/blocker';
import { blocker } from './blocker';
import { followsClientId, followsImport } from './followsImport';
import { closeFollowsWindow, isFollowsPage, openFollowsWindow, openSettingsWindow } from './windows';

/** Registers a handler that refuses every caller except the app's own top frames. */
function handle<T>(channel: Channel, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => T): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error(`Refused ${channel} from ${event.senderFrame?.url ?? 'unknown'}`);
    return listener(event, ...args);
  });
}

/** Only twitch.tv pages leave the app through this bridge. */
function isTwitchPage(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === 'https:' && (host === 'twitch.tv' || host.endsWith('.twitch.tv'));
  } catch {
    return false;
  }
}

/** The import window's own calls: refused from every other page, the app's other windows included. */
function handleFollows(channel: Channel, listener: () => unknown): void {
  handle(channel, (event) => {
    if (!isFollowsPage(event.sender)) throw new Error(`Refused ${channel} from another page`);
    return listener();
  });
}

export function registerIpc(): void {
  handle(Channel.appInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform as Platform,
    language: currentLanguage(),
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
    twitchImport: followsClientId() !== '',
  }));

  handle(Channel.settingsGet, () => settingsStore.get());
  handle(Channel.settingsUpdate, (_event, patch) => settingsStore.update(patch));
  handle(Channel.settingsReset, async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      type: 'warning' as const,
      buttons: [menuText('resetConfirm'), menuText('cancel')],
      defaultId: 1,
      cancelId: 1,
      message: menuText('resetTitle'),
      detail: menuText('resetDetail'),
    };
    const { response } = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options);
    if (response !== 0) return false;
    settingsStore.update({ appearance: defaultAppearance });
    return true;
  });

  handle(Channel.subscribe, (_event, channel) => {
    const raw = (typeof channel === 'object' && channel !== null ? channel : {}) as Record<string, unknown>;
    const id = raw['id'];
    const login = typeof raw['login'] === 'string' ? normalizeLogin(raw['login']) : null;
    if (typeof id !== 'string' || !/^\d{1,20}$/.test(id) || !login) return;
    const name = raw['displayName'];
    const picture = raw['profileImageURL'];
    const added = libraryStore.subscribe([
      {
        id,
        login,
        displayName: typeof name === 'string' && name ? name.slice(0, 100) : login,
        profileImageURL: typeof picture === 'string' && picture.startsWith('https://') ? picture : null,
      },
    ]);
    // Who subscribes wants to see the channel's status at once.
    if (added) void liveMonitor.refresh();
  });
  handle(Channel.unsubscribe, (_event, id) => {
    if (typeof id !== 'string') return;
    libraryStore.unsubscribe(id);
    liveMonitor.forget(id);
  });
  handle(Channel.liveGet, () => liveMonitor.get());
  handle(Channel.liveRefresh, () => void liveMonitor.refresh());
  handle(Channel.subscriptionsImport, (event) => importSubscriptions(BrowserWindow.fromWebContents(event.sender)));
  handle(Channel.subscriptionsExport, (event, format) =>
    exportSubscriptions(BrowserWindow.fromWebContents(event.sender), format === 'text' ? 'text' : 'json'),
  );
  handle(Channel.subscriptionsImportTwitch, () => {
    if (followsClientId()) openFollowsWindow();
  });
  handleFollows(Channel.followsPhase, () => followsImport.get());
  handleFollows(Channel.followsOpenActivation, () => followsImport.openActivation());
  handleFollows(Channel.followsCopyCode, () => followsImport.copyCode());
  handleFollows(Channel.followsConfirm, () => followsImport.confirm());
  handleFollows(Channel.followsRetry, () => followsImport.retry());
  handleFollows(Channel.followsClose, () => closeFollowsWindow());
  handle(Channel.blockerState, () => blocker.state());
  handle(Channel.blockerSaveFilters, (_event, text) => blocker.saveFilters(text));
  handle(Channel.blockerRecord, (_event, value) => {
    const event = parseBlockerEvent(value);
    if (event) blocker.record(event);
  });
  handle(Channel.blockerReset, async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      type: 'warning' as const,
      buttons: [menuText('blockerResetConfirm'), menuText('cancel')],
      defaultId: 1,
      cancelId: 1,
      message: menuText('blockerResetTitle'),
      detail: menuText('blockerResetDetail'),
    };
    const { response } = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options);
    if (response !== 0) return false;
    blocker.reset();
    return true;
  });
  handle(Channel.libraryGet, () => libraryStore.get());
  handle(Channel.libraryRecord, (_event, entry) => {
    const record = normalizeRecord(entry);
    if (record) libraryStore.record(record);
  });
  handle(Channel.libraryRemove, (_event, id) => {
    if (typeof id === 'string') libraryStore.remove(id);
  });
  handle(Channel.libraryClearHistory, async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      type: 'warning' as const,
      buttons: [menuText('clearHistoryConfirm'), menuText('cancel')],
      defaultId: 1,
      cancelId: 1,
      message: menuText('clearHistoryTitle'),
      detail: menuText('clearHistoryDetail'),
    };
    const { response } = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options);
    if (response !== 0) return false;
    libraryStore.clearHistory();
    return true;
  });
  handle(Channel.libraryClearProgress, () => libraryStore.clearProgress());
  handle(Channel.librarySaveProgress, (_event, id, seconds, duration) => {
    if (typeof seconds !== 'number') return;
    libraryStore.saveProgress(requireId(id), seconds, typeof duration === 'number' && duration > 0 ? duration : null);
  });
  handle(Channel.libraryWatchTime, (_event, id, seconds) => {
    // At most one tick's worth at a time (the player counts every 5 s).
    if (typeof id === 'string' && /^\d{1,20}$/.test(id) && typeof seconds === 'number' && seconds > 0 && seconds <= 10)
      libraryStore.addWatchTime(id, seconds);
  });
  handle(Channel.libraryResetWatchTime, async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      type: 'warning' as const,
      buttons: [menuText('watchTimeResetConfirm'), menuText('cancel')],
      defaultId: 1,
      cancelId: 1,
      message: menuText('watchTimeResetTitle'),
      detail: menuText('watchTimeResetDetail'),
    };
    const { response } = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options);
    if (response !== 0) return false;
    libraryStore.resetWatchTime();
    return true;
  });
  handle(Channel.adSwitchCandidates, (_event, excludingId) => {
    const state = libraryStore.get();
    return adSwitchCandidates(
      state.subscriptions,
      liveMonitor.get().statuses,
      state.watchTime,
      typeof excludingId === 'string' ? excludingId : '',
    );
  });
  handle(Channel.libraryResume, (_event, id, duration) =>
    libraryStore.resumePosition(requireId(id), typeof duration === 'number' && duration > 0 ? duration : null),
  );
  handle(Channel.twitchVideos, (_event, login, kind) =>
    videos(requireLogin(login), videoKinds.includes(kind as VideoKind) ? (kind as VideoKind) : 'ARCHIVE'),
  );

  handle(Channel.openSettings, (_event, tab) =>
    openSettingsWindow(settingsTabs.includes(tab as SettingsTab) ? (tab as SettingsTab) : undefined),
  );
  handle(Channel.openExternal, (_event, url) => {
    if (isTwitchPage(url)) openExternal(url);
  });
  handle(Channel.twitchSearch, (_event, term) => search(typeof term === 'string' ? term : ''));
  handle(Channel.twitchChannel, (_event, login) => channel(requireLogin(login)));
  handle(Channel.twitchVideo, (_event, id) => video(requireId(id)));
  handle(Channel.twitchTop, (_event, count) => topStreams(typeof count === 'number' ? count : 1));
  handle(Channel.twitchPlayback, (_event, target, source) => {
    const checked = requireTarget(target);
    // A second source exists for live channels only.
    return playbackUrl(checked, source === 'backup' && checked.kind === 'live' ? 'backup' : 'primary');
  });
  handle(Channel.twitchAdClips, (_event, login) => adClips(requireLogin(login)));
  handle(Channel.twitchClipSource, (_event, slug, maxHeight) => {
    if (typeof slug !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(slug)) throw new Error('Invalid clip');
    const height =
      typeof maxHeight === 'number' && Number.isFinite(maxHeight) ? Math.max(144, Math.min(4320, maxHeight)) : 1080;
    return clipSource(slug, height);
  });
  handle(Channel.twitchPlaylist, (_event, url) => fetchPlaylist(typeof url === 'string' ? url : ''));
  handle(Channel.twitchSegment, (_event, url) => fetchSegment(typeof url === 'string' ? url : ''));

  handle(Channel.chatEmotes, (_event, room) => {
    // Only while the setting is on: otherwise Lurk does not contact these services at all.
    if (!settingsStore.get().player.thirdPartyEmotes) return {};
    if (typeof room !== 'string' || !/^\d{1,20}$/.test(room)) throw new Error('Invalid room');
    return thirdPartyEmotes(room);
  });
  handle(Channel.browseStreams, (_event, content, language, sort, tag) =>
    browseStreams(
      isContentType(content) ? content : 'all',
      isStreamLanguage(language) ? language : '',
      isStreamSort(sort) ? sort : 'VIEWER_COUNT',
      typeof tag === 'string' && tag.length <= 50 ? tag : null,
    ),
  );
  handle(Channel.browseCategories, (_event, content) => categories(isContentType(content) ? content : 'all'));
  handle(Channel.browseCategoryStreams, (_event, name, language, sort) => {
    if (typeof name !== 'string' || name.length === 0 || name.length > 200) throw new Error('Invalid category');
    return categoryPage(name, isStreamLanguage(language) ? language : '', isStreamSort(sort) ? sort : 'VIEWER_COUNT');
  });
  handle(Channel.browseTags, (_event, query) =>
    typeof query === 'string' && query.trim() ? searchTags(query.trim()) : [],
  );
  handle(Channel.copyLink, (_event, url) => {
    if (isTwitchPage(url)) clipboard.writeText(url);
  });
  handle(Channel.menuPopup, (event, entries, at) => popupMenu(event, entries, at));
  handle(Channel.setFullScreen, (event, on) => {
    BrowserWindow.fromWebContents(event.sender)?.setFullScreen(on === true);
  });
}

function requireLogin(value: unknown): string {
  if (typeof value === 'string' && /^[a-zA-Z0-9_]{1,25}$/.test(value)) return value;
  throw new Error('Invalid channel name');
}

function requireId(value: unknown): string {
  if (typeof value === 'string' && /^\d{1,20}$/.test(value)) return value;
  throw new Error('Invalid video id');
}

function requireTarget(value: unknown): PlayTarget {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  if (raw['kind'] === 'live') return { kind: 'live', login: requireLogin(raw['login']) };
  if (raw['kind'] === 'vod') return { kind: 'vod', id: requireId(raw['id']) };
  throw new Error('Invalid play target');
}

/** A native menu at a point of the sender's window; resolves with the chosen id or null. */
function popupMenu(event: IpcMainInvokeEvent, entries: unknown, at: unknown): Promise<string | null> {
  const window = BrowserWindow.fromWebContents(event.sender);
  const list = Array.isArray(entries) ? (entries.slice(0, 40) as MenuEntry[]) : [];
  const point = (typeof at === 'object' && at !== null ? at : {}) as { x?: unknown; y?: unknown };
  return new Promise((resolve) => {
    let chosen: string | null = null;
    const template: MenuItemConstructorOptions[] = list.flatMap((entry): MenuItemConstructorOptions[] => {
      if (entry?.type === 'separator') return [{ type: 'separator' }];
      if (entry?.type !== 'item' || typeof entry.id !== 'string' || typeof entry.label !== 'string') return [];
      const id = entry.id;
      return [
        {
          label: entry.label.slice(0, 200),
          type: typeof entry.checked === 'boolean' ? 'checkbox' : 'normal',
          checked: entry.checked === true,
          enabled: entry.enabled !== false,
          click: () => {
            chosen = id;
          },
        },
      ];
    });
    if (!window || template.length === 0) {
      resolve(null);
      return;
    }
    Menu.buildFromTemplate(template).popup({
      window,
      x: typeof point.x === 'number' ? Math.round(point.x) : undefined,
      y: typeof point.y === 'number' ? Math.round(point.y) : undefined,
      // The click handler runs before the menu reports it closed.
      callback: () => setTimeout(() => resolve(chosen), 0),
    });
  });
}
