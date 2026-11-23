// The settings Lurk keeps in settings.json in its data folder. Only the main process reads and
// writes the file; windows get a copy and a change event. Unknown or broken values fall back to the
// defaults instead of failing, so an old or hand-edited file never stops the app from starting.

import {
  appearanceModes,
  backgroundTones,
  defaultAppearance,
  isAccentPreset,
  isCustomAccent,
  type Appearance,
  type AppearanceMode,
  type BackgroundTone,
} from './theme';
import {
  contentTypes,
  streamLanguages,
  streamSorts,
  type ContentType,
  type StreamLanguage,
  type StreamSort,
} from './browse';

export interface PlayerSettings {
  /** 0 … 1, like the macOS app's default 0.8. */
  volume: number;
  muted: boolean;
  /** The chat beside a live stream (menu "Wiedergabe → Chat anzeigen", ⇧⌘K). */
  showChat: boolean;
  /** Emotes of BTTV, 7TV and FFZ – Lurk then contacts those services. */
  thirdPartyEmotes: boolean;
  animatedEmotes: boolean;
  /** Go along when the channel raids another one, as twitch.tv does. */
  followRaids: boolean;
  /** A stream tile plays muted when the pointer rests on it (off with reduced motion too). */
  hoverPreview: boolean;
  /** A system notification when a subscribed channel goes live (off, as on macOS). */
  liveNotifications: boolean;
  /** "Bei Werbepausen auf einen anderen Abo-Kanal wechseln" (on, as on macOS). */
  adSwitch: boolean;
}

/** The filters of Entdecken, Kategorien and a category's page, kept like the macOS app's. */
export interface BrowseSettings {
  /** Shared by Entdecken and every category's page. */
  language: StreamLanguage;
  browseContent: ContentType;
  browseSort: StreamSort;
  categoriesContent: ContentType;
  /** Categories sort by viewers only. */
  categoriesSort: Exclude<StreamSort, 'RECENT'>;
  categorySort: StreamSort;
}

/** "Datenschutz → Speichern": what Lurk keeps about watching (library.json). */
export interface PrivacySettings {
  saveHistory: boolean;
  rememberPosition: boolean;
}

/** "Werbeblocker": on by default, as on macOS; so are the clips while ads are skipped. */
export interface BlockerSettings {
  enabled: boolean;
  adFillClips: boolean;
}

export interface Settings {
  appearance: Appearance;
  player: PlayerSettings;
  browse: BrowseSettings;
  privacy: PrivacySettings;
  blocker: BlockerSettings;
}

export type SettingsPatch = {
  appearance?: Partial<Appearance>;
  player?: Partial<PlayerSettings>;
  browse?: Partial<BrowseSettings>;
  privacy?: Partial<PrivacySettings>;
  blocker?: Partial<BlockerSettings>;
};

export const defaultSettings: Settings = {
  appearance: { ...defaultAppearance },
  player: {
    volume: 0.8,
    muted: false,
    showChat: true,
    thirdPartyEmotes: true,
    animatedEmotes: true,
    followRaids: true,
    hoverPreview: true,
    liveNotifications: false,
    adSwitch: true,
  },
  browse: {
    language: '',
    browseContent: 'all',
    browseSort: 'VIEWER_COUNT',
    categoriesContent: 'all',
    categoriesSort: 'VIEWER_COUNT',
    categorySort: 'VIEWER_COUNT',
  },
  privacy: { saveHistory: true, rememberPosition: true },
  blocker: { enabled: true, adFillClips: true },
};

const playerSwitches = [
  'muted',
  'showChat',
  'thirdPartyEmotes',
  'animatedEmotes',
  'followRaids',
  'hoverPreview',
  'liveNotifications',
  'adSwitch',
] as const;

function normalizePlayer(value: unknown, base: PlayerSettings): PlayerSettings {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const volume = raw['volume'];
  const result: PlayerSettings = {
    ...base,
    volume: typeof volume === 'number' && Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : base.volume,
  };
  for (const key of playerSwitches) {
    const value = raw[key];
    if (typeof value === 'boolean') result[key] = value;
  }
  return result;
}

function normalizeBrowse(value: unknown, base: BrowseSettings): BrowseSettings {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return {
    language: pick<StreamLanguage>(raw['language'], streamLanguages, base.language),
    browseContent: pick<ContentType>(raw['browseContent'], contentTypes, base.browseContent),
    browseSort: pick<StreamSort>(raw['browseSort'], streamSorts, base.browseSort),
    categoriesContent: pick<ContentType>(raw['categoriesContent'], contentTypes, base.categoriesContent),
    categoriesSort: pick(raw['categoriesSort'], ['VIEWER_COUNT', 'VIEWER_COUNT_ASC'] as const, base.categoriesSort),
    categorySort: pick<StreamSort>(raw['categorySort'], streamSorts, base.categorySort),
  };
}

function normalizePrivacy(value: unknown, base: PrivacySettings): PrivacySettings {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return {
    saveHistory: typeof raw['saveHistory'] === 'boolean' ? raw['saveHistory'] : base.saveHistory,
    rememberPosition: typeof raw['rememberPosition'] === 'boolean' ? raw['rememberPosition'] : base.rememberPosition,
  };
}

function normalizeBlocker(value: unknown, base: BlockerSettings): BlockerSettings {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return {
    enabled: typeof raw['enabled'] === 'boolean' ? raw['enabled'] : base.enabled,
    adFillClips: typeof raw['adFillClips'] === 'boolean' ? raw['adFillClips'] : base.adFillClips,
  };
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function normalizeAppearance(value: unknown, base: Appearance): Appearance {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const accent = raw['accent'];
  return {
    mode: pick<AppearanceMode>(raw['mode'], appearanceModes, base.mode),
    tone: pick<BackgroundTone>(raw['tone'], backgroundTones, base.tone),
    accent: isAccentPreset(accent)
      ? accent
      : isCustomAccent(accent)
        ? (accent.toUpperCase() as `#${string}`)
        : base.accent,
  };
}

/** Reads whatever was stored into valid settings. */
export function normalizeSettings(value: unknown): Settings {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return {
    appearance: normalizeAppearance(raw['appearance'], defaultSettings.appearance),
    player: normalizePlayer(raw['player'], defaultSettings.player),
    browse: normalizeBrowse(raw['browse'], defaultSettings.browse),
    privacy: normalizePrivacy(raw['privacy'], defaultSettings.privacy),
    blocker: normalizeBlocker(raw['blocker'], defaultSettings.blocker),
  };
}

/** Applies a change; invalid fields in the change are ignored. */
export function applyPatch(settings: Settings, patch: unknown): Settings {
  const raw = (typeof patch === 'object' && patch !== null ? patch : {}) as Record<string, unknown>;
  const appearance = raw['appearance'];
  const player = raw['player'];
  const browse = raw['browse'];
  const privacy = raw['privacy'];
  const blocker = raw['blocker'];
  const hasAppearance = typeof appearance === 'object' && appearance !== null;
  const hasPlayer = typeof player === 'object' && player !== null;
  const hasBrowse = typeof browse === 'object' && browse !== null;
  const hasPrivacy = typeof privacy === 'object' && privacy !== null;
  const hasBlocker = typeof blocker === 'object' && blocker !== null;
  if (!hasAppearance && !hasPlayer && !hasBrowse && !hasPrivacy && !hasBlocker) return settings;
  return {
    appearance: hasAppearance
      ? normalizeAppearance({ ...settings.appearance, ...appearance }, settings.appearance)
      : settings.appearance,
    player: hasPlayer ? normalizePlayer({ ...settings.player, ...player }, settings.player) : settings.player,
    browse: hasBrowse ? normalizeBrowse({ ...settings.browse, ...browse }, settings.browse) : settings.browse,
    privacy: hasPrivacy ? normalizePrivacy({ ...settings.privacy, ...privacy }, settings.privacy) : settings.privacy,
    blocker: hasBlocker ? normalizeBlocker({ ...settings.blocker, ...blocker }, settings.blocker) : settings.blocker,
  };
}
