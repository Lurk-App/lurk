// The only bridge from the page to the main process. It forwards typed calls and exposes nothing
// else: no ipcRenderer, no Node modules, no generic "send anything" function.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { Channel, type AppCommand, type LurkApi, type SettingsTab } from '@shared/ipc';
import type { Settings } from '@shared/settings';
import type { LibraryState } from '@shared/library';
import type { BlockerState } from '@shared/blocker';
import type { FollowsPhase } from '@shared/follows';
import type { LiveState } from '@shared/subscriptions';

function subscribe<T>(channel: Channel, listener: (value: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: LurkApi = {
  appInfo: () => ipcRenderer.invoke(Channel.appInfo),
  settings: {
    get: () => ipcRenderer.invoke(Channel.settingsGet),
    update: (patch) => ipcRenderer.invoke(Channel.settingsUpdate, patch),
    resetAppearance: () => ipcRenderer.invoke(Channel.settingsReset),
    onChange: (listener) => subscribe<Settings>(Channel.settingsChanged, listener),
  },
  openSettings: (tab) => void ipcRenderer.invoke(Channel.openSettings, tab),
  onSettingsTab: (listener) => subscribe<SettingsTab>(Channel.settingsShowTab, listener),
  openExternal: (url) => void ipcRenderer.invoke(Channel.openExternal, url),
  onCommand: (listener) => subscribe<AppCommand>(Channel.command, listener),
  copyLink: (url) => void ipcRenderer.invoke(Channel.copyLink, url),
  showMenu: (entries, at) => ipcRenderer.invoke(Channel.menuPopup, entries, at),
  setFullScreen: (on) => void ipcRenderer.invoke(Channel.setFullScreen, on),
  onFullScreenChange: (listener) => subscribe<boolean>(Channel.fullScreenChanged, listener),
  chat: {
    thirdPartyEmotes: (roomId) => ipcRenderer.invoke(Channel.chatEmotes, roomId),
  },
  subscriptions: {
    subscribe: (channel) => void ipcRenderer.invoke(Channel.subscribe, channel),
    unsubscribe: (id) => void ipcRenderer.invoke(Channel.unsubscribe, id),
    live: () => ipcRenderer.invoke(Channel.liveGet),
    onLive: (listener) => subscribe<LiveState>(Channel.liveChanged, listener),
    refresh: () => void ipcRenderer.invoke(Channel.liveRefresh),
    importFile: () => ipcRenderer.invoke(Channel.subscriptionsImport),
    exportFile: (format) => ipcRenderer.invoke(Channel.subscriptionsExport, format),
    importFromTwitch: () => void ipcRenderer.invoke(Channel.subscriptionsImportTwitch),
    adSwitchCandidates: (excludingId) => ipcRenderer.invoke(Channel.adSwitchCandidates, excludingId),
  },
  blocker: {
    state: () => ipcRenderer.invoke(Channel.blockerState),
    onChange: (listener) => subscribe<BlockerState>(Channel.blockerChanged, listener),
    saveFilters: (text) => ipcRenderer.invoke(Channel.blockerSaveFilters, text),
    reset: () => ipcRenderer.invoke(Channel.blockerReset),
    record: (event) => void ipcRenderer.invoke(Channel.blockerRecord, event),
  },
  follows: {
    phase: () => ipcRenderer.invoke(Channel.followsPhase),
    onPhase: (listener) => subscribe<FollowsPhase>(Channel.followsPhaseChanged, listener),
    openActivation: () => void ipcRenderer.invoke(Channel.followsOpenActivation),
    copyCode: () => void ipcRenderer.invoke(Channel.followsCopyCode),
    confirm: () => void ipcRenderer.invoke(Channel.followsConfirm),
    retry: () => void ipcRenderer.invoke(Channel.followsRetry),
    close: () => void ipcRenderer.invoke(Channel.followsClose),
  },
  library: {
    get: () => ipcRenderer.invoke(Channel.libraryGet),
    onChange: (listener) => subscribe<LibraryState>(Channel.libraryChanged, listener),
    record: (entry) => void ipcRenderer.invoke(Channel.libraryRecord, entry),
    remove: (id) => void ipcRenderer.invoke(Channel.libraryRemove, id),
    clearHistory: () => ipcRenderer.invoke(Channel.libraryClearHistory),
    clearProgress: () => void ipcRenderer.invoke(Channel.libraryClearProgress),
    saveProgress: (videoId, seconds, duration) =>
      void ipcRenderer.invoke(Channel.librarySaveProgress, videoId, seconds, duration),
    resumePosition: (videoId, duration) => ipcRenderer.invoke(Channel.libraryResume, videoId, duration),
    addWatchTime: (channelId, seconds) => void ipcRenderer.invoke(Channel.libraryWatchTime, channelId, seconds),
    resetWatchTime: () => ipcRenderer.invoke(Channel.libraryResetWatchTime),
    onWatchTime: (listener) => subscribe<Record<string, number>>(Channel.libraryWatchTimeChanged, listener),
  },
  browse: {
    streams: (content, language, sort, tag) => ipcRenderer.invoke(Channel.browseStreams, content, language, sort, tag),
    categories: (content) => ipcRenderer.invoke(Channel.browseCategories, content),
    categoryStreams: (name, language, sort) => ipcRenderer.invoke(Channel.browseCategoryStreams, name, language, sort),
    tags: (query) => ipcRenderer.invoke(Channel.browseTags, query),
  },
  twitch: {
    search: (term) => ipcRenderer.invoke(Channel.twitchSearch, term),
    videos: (login, kind) => ipcRenderer.invoke(Channel.twitchVideos, login, kind),
    channel: (login) => ipcRenderer.invoke(Channel.twitchChannel, login),
    video: (id) => ipcRenderer.invoke(Channel.twitchVideo, id),
    top: (count) => ipcRenderer.invoke(Channel.twitchTop, count),
    playback: (target, source) => ipcRenderer.invoke(Channel.twitchPlayback, target, source),
    adClips: (login) => ipcRenderer.invoke(Channel.twitchAdClips, login),
    clipSource: (slug, maxHeight) => ipcRenderer.invoke(Channel.twitchClipSource, slug, maxHeight),
    playlist: (url) => ipcRenderer.invoke(Channel.twitchPlaylist, url),
    segment: (url) => ipcRenderer.invoke(Channel.twitchSegment, url),
  },
};

contextBridge.exposeInMainWorld('lurk', api);
