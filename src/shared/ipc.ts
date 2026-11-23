// The typed bridge between the interface (renderer) and the main process.
//
// The preload exposes exactly `LurkApi` as `window.lurk` – nothing else from Node or Electron
// reaches the page. Every channel the main process answers is listed in `Channel`, and the main
// process only answers frames that belong to the app itself (see src/main/security.ts).

import type { Language } from './language';
import type { CategoryWithTags, ContentType, BrowseStream, StreamLanguage, StreamSort } from './browse';
import type { HistoryRecord, LibraryState } from './library';
import type { BlockerEvent, BlockerState, FilterReport } from './blocker';
import type { FollowsPhase } from './follows';
import type { LiveState } from './subscriptions';
import type {
  AdClip,
  ChannelDetails,
  ChannelRef,
  Game,
  LiveStream,
  PlaybackSource,
  PlayTarget,
  SearchResults,
  VideoDetails,
  VideoKind,
} from './models';
import type { Settings, SettingsPatch } from './settings';

export const Channel = {
  appInfo: 'app:info',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsReset: 'settings:reset-appearance',
  settingsChanged: 'settings:changed',
  openSettings: 'window:open-settings',
  openExternal: 'app:open-external',
  command: 'app:command',
  twitchSearch: 'twitch:search',
  twitchChannel: 'twitch:channel',
  twitchVideo: 'twitch:video',
  twitchTop: 'twitch:top',
  twitchPlayback: 'twitch:playback',
  twitchAdClips: 'twitch:ad-clips',
  twitchClipSource: 'twitch:clip-source',
  twitchPlaylist: 'twitch:playlist',
  menuPopup: 'menu:popup',
  copyLink: 'app:copy-link',
  setFullScreen: 'window:set-full-screen',
  fullScreenChanged: 'window:full-screen-changed',
  chatEmotes: 'chat:third-party-emotes',
  settingsShowTab: 'settings:show-tab',
  browseStreams: 'browse:streams',
  browseCategories: 'browse:categories',
  browseCategoryStreams: 'browse:category-streams',
  browseTags: 'browse:tags',
  twitchVideos: 'twitch:videos',
  twitchSegment: 'twitch:segment',
  libraryGet: 'library:get',
  libraryChanged: 'library:changed',
  libraryRecord: 'library:record',
  libraryRemove: 'library:remove',
  libraryClearHistory: 'library:clear-history',
  libraryClearProgress: 'library:clear-progress',
  librarySaveProgress: 'library:save-progress',
  libraryResume: 'library:resume',
  libraryWatchTime: 'library:watch-time',
  libraryResetWatchTime: 'library:reset-watch-time',
  libraryWatchTimeChanged: 'library:watch-time-changed',
  adSwitchCandidates: 'subscriptions:ad-switch-candidates',
  subscribe: 'subscriptions:subscribe',
  unsubscribe: 'subscriptions:unsubscribe',
  liveGet: 'subscriptions:live',
  liveChanged: 'subscriptions:live-changed',
  liveRefresh: 'subscriptions:refresh',
  subscriptionsImport: 'subscriptions:import',
  subscriptionsExport: 'subscriptions:export',
  subscriptionsImportTwitch: 'subscriptions:import-twitch',
  followsPhase: 'follows:phase',
  followsPhaseChanged: 'follows:phase-changed',
  followsOpenActivation: 'follows:open-activation',
  followsCopyCode: 'follows:copy-code',
  followsConfirm: 'follows:confirm',
  followsRetry: 'follows:retry',
  followsClose: 'follows:close',
  blockerState: 'blocker:state',
  blockerChanged: 'blocker:changed',
  blockerSaveFilters: 'blocker:save-filters',
  blockerReset: 'blocker:reset',
  blockerRecord: 'blocker:record',
} as const;

export type Channel = (typeof Channel)[keyof typeof Channel];

export type Platform = 'darwin' | 'win32' | 'linux';

export interface AppInfo {
  name: string;
  version: string;
  platform: Platform;
  /** The interface language the main process chose (menus use it too). */
  language: Language;
  versions: { electron: string; chrome: string; node: string };
  /** "Von Twitch übernehmen" is offered (Lurk's Twitch client id is set). */
  twitchImport: boolean;
}

/** Menu and keyboard commands the main window acts on. */
export type AppCommand = 'toggle-sidebar' | 'go-back' | 'focus-search' | 'refresh';
export const appCommands: readonly AppCommand[] = ['toggle-sidebar', 'go-back', 'focus-search', 'refresh'];

export type SettingsTab = 'appearance' | 'playback' | 'replay' | 'blocker' | 'privacy';
export const settingsTabs: readonly SettingsTab[] = ['appearance', 'playback', 'replay', 'blocker', 'privacy'];

/** An entry of a native menu the page asks the main process to show. */
export type MenuEntry =
  { type: 'item'; id: string; label: string; checked?: boolean; enabled?: boolean } | { type: 'separator' };

export interface LurkApi {
  appInfo(): Promise<AppInfo>;
  settings: {
    get(): Promise<Settings>;
    update(patch: SettingsPatch): Promise<Settings>;
    /** Asks in a system dialog first; true when it was reset. */
    resetAppearance(): Promise<boolean>;
    onChange(listener: (settings: Settings) => void): () => void;
  };
  openSettings(tab?: SettingsTab): void;
  /** The settings window: another part of the app asked for a tab ("Lurk anpassen …"). */
  onSettingsTab(listener: (tab: SettingsTab) => void): () => void;
  /** Opens a twitch.tv page in the system browser (only https on twitch.tv). */
  openExternal(url: string): void;
  onCommand(listener: (command: AppCommand) => void): () => void;
  /** Copies a twitch.tv link to the clipboard. */
  copyLink(url: string): void;
  /** Shows a native menu at a point of the window; the chosen entry's id, or null. */
  showMenu(entries: MenuEntry[], at: { x: number; y: number }): Promise<string | null>;
  setFullScreen(on: boolean): void;
  onFullScreenChange(listener: (on: boolean) => void): () => void;
  chat: {
    /** Emotes of BTTV, 7TV and FFZ for a channel (global ones included): name → id and image. */
    thirdPartyEmotes(roomId: string): Promise<Record<string, { id: string; url: string }>>;
  };
  browse: {
    streams(
      content: ContentType,
      language: StreamLanguage,
      sort: StreamSort,
      tag: string | null,
    ): Promise<BrowseStream[]>;
    categories(content: ContentType): Promise<CategoryWithTags[]>;
    /** A category's box art and viewers with its live streams. */
    categoryStreams(
      name: string,
      language: StreamLanguage,
      sort: StreamSort,
    ): Promise<{ game: Game | null; streams: BrowseStream[] }>;
    tags(query: string): Promise<string[]>;
  };
  /** History and video positions (library.json), on this computer only. */
  library: {
    get(): Promise<LibraryState>;
    onChange(listener: (state: LibraryState) => void): () => void;
    /** The player: playback runs. Kept only while "Wiedergabeverlauf speichern" is on. */
    record(entry: HistoryRecord): void;
    remove(id: string): void;
    /** Asks in a system dialog first; true when it was cleared. */
    clearHistory(): Promise<boolean>;
    clearProgress(): void;
    saveProgress(videoId: string, seconds: number, duration: number | null): void;
    /** Where a video starts again, or null (none, finished, or "Position merken" off). */
    resumePosition(videoId: string, duration: number | null): Promise<number | null>;
    /** The player: seconds of real playback of a channel (the ad-break switch's ranking). */
    addWatchTime(channelId: string, seconds: number): void;
    /** The settings window: watch time as it is counted (the rest of the library hears it every 30 s). */
    onWatchTime(listener: (watchTime: Record<string, number>) => void): () => void;
    /** Asks in a system dialog first; true when it was reset. */
    resetWatchTime(): Promise<boolean>;
  };
  /** Subscriptions without an account (kept in library.json) and their live status. */
  subscriptions: {
    subscribe(channel: ChannelRef): void;
    unsubscribe(id: string): void;
    live(): Promise<LiveState>;
    onLive(listener: (state: LiveState) => void): () => void;
    /** Asks Twitch now (⌘R on the Abos page). */
    refresh(): void;
    /** A system file dialog, then a system message with the result. */
    importFile(): Promise<void>;
    exportFile(format: 'json' | 'text'): Promise<void>;
    /** "Von Twitch übernehmen …": opens the import window, or brings it to the front. */
    importFromTwitch(): void;
    /** The ad-break switch's candidates: subscribed channels live now, most watched first. */
    adSwitchCandidates(excludingId: string): Promise<ChannelRef[]>;
  };
  /** The ad blocker: filters, log and totals (the switch is in settings). */
  blocker: {
    state(): Promise<BlockerState>;
    onChange(listener: (state: BlockerState) => void): () => void;
    /** "Übernehmen": saves the own filters and uses them at once. */
    saveFilters(text: string): Promise<FilterReport>;
    /** Asks in a system dialog first; true when it was reset. */
    reset(): Promise<boolean>;
    /** The player: what it removed from a playlist or skipped. */
    record(event: BlockerEvent): void;
  };
  /** The import window's own page only (the main process refuses every other sender). */
  follows: {
    phase(): Promise<FollowsPhase>;
    onPhase(listener: (phase: FollowsPhase) => void): () => void;
    /** Opens twitch.tv/activate with the code shown, in the system browser. */
    openActivation(): void;
    copyCode(): void;
    /** "Übernehmen" after reading. */
    confirm(): void;
    retry(): void;
    close(): void;
  };
  twitch: {
    search(term: string): Promise<SearchResults>;
    videos(login: string, kind: VideoKind): Promise<VideoDetails[]>;
    channel(login: string): Promise<ChannelDetails | null>;
    video(id: string): Promise<VideoDetails | null>;
    top(count: number): Promise<LiveStream[]>;
    /** The master playlist address of a new session. */
    playback(target: PlayTarget, source?: PlaybackSource): Promise<string>;
    /** Popular clips of a channel, for ad breaks (asked once per channel while Lurk runs). */
    adClips(login: string): Promise<AdClip[]>;
    /** A clip's playable address, at most `maxHeight` high when the clip offers it. */
    clipSource(slug: string, maxHeight: number): Promise<string | null>;
    /** A playlist through the main process (Twitch refuses the app's origin). */
    playlist(url: string): Promise<{ status: number; text: string }>;
    /** A video's segment through the main process (Twitch's video CDN refuses the app's origin). */
    segment(url: string): Promise<{ status: number; data: Uint8Array | null }>;
  };
}
