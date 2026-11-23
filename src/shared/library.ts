// What Lurk remembers about watching: the history, the positions in videos and the watch time per
// channel (for the ad-break switch). Kept in library.json in the data folder, on this computer only.
// Port of the history, progress and watch-time parts of the native macOS app's Library (lurk-macos,
// Sources/Lurk/Library.swift).

import type { ChannelRef, PlayTarget } from './models';
import { normalizeSubscriptions, type ChannelStatus, type Subscription } from './subscriptions';

export interface HistoryEntry {
  id: string;
  target: PlayTarget;
  channelLogin: string;
  channelName: string;
  title: string;
  gameName: string | null;
  /** Live: the channel's avatar; video: its picture. */
  thumbnailURL: string | null;
  /** ISO time. */
  watchedAt: string;
  /** A video's length in seconds. */
  duration: number | null;
}

/** What the player reports; the main process adds the id and the time. */
export type HistoryRecord = Omit<HistoryEntry, 'id' | 'watchedAt'>;

export interface LibraryState {
  /** Channels subscribed without an account, sorted by name. */
  subscriptions: Subscription[];
  history: HistoryEntry[];
  /** Video id → seconds watched (the length once finished). */
  progress: Record<string, number>;
  /** Channel id → seconds watched, live and videos (the ad-break switch's ranking). */
  watchTime: Record<string, number>;
}

/** The most channels whose watch time is kept (the ones watched longest). */
export const watchTimeLimit = 5000;
/** The ad-break switch reads this many candidates in the background. */
export const adSwitchCandidateCount = 3;
/** The settings tab ranks this many subscriptions. */
export const watchRankingLength = 8;

export function addWatchTime(watchTime: Record<string, number>, id: string, seconds: number): Record<string, number> {
  if (!/^\d{1,20}$/.test(id) || !(seconds > 0) || !Number.isFinite(seconds)) return watchTime;
  return { ...watchTime, [id]: (watchTime[id] ?? 0) + seconds };
}

/** Subscriptions with their watch time, most watched first (the reference's watchRanking). */
export function watchRanking(
  subscriptions: Subscription[],
  watchTime: Record<string, number>,
  limit: number = watchRankingLength,
): { subscription: Subscription; seconds: number }[] {
  return subscriptions
    .map((subscription) => ({ subscription, seconds: watchTime[subscription.id] ?? 0 }))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, limit);
}

/**
 * Subscribed channels live right now, except the one playing: most watch time first, then most
 * viewers (the reference's adSwitchCandidates).
 */
export function adSwitchCandidates(
  subscriptions: Subscription[],
  statuses: Record<string, ChannelStatus>,
  watchTime: Record<string, number>,
  excludingId: string,
  limit: number = adSwitchCandidateCount,
): ChannelRef[] {
  return subscriptions
    .flatMap((subscription) => {
      const status = statuses[subscription.id];
      if (!status?.stream || subscription.id === excludingId) return [];
      return [{ ref: status.ref, seconds: watchTime[subscription.id] ?? 0, viewers: status.stream.viewersCount }];
    })
    .sort((a, b) => b.seconds - a.seconds || b.viewers - a.viewers)
    .slice(0, limit)
    .map((entry) => entry.ref);
}

/** "unter 1 min", "12 min", "1 h 5 min" (the reference's Fmt.watchTime). */
export function watchTimeParts(seconds: number): { underAMinute: true } | { hours: number; minutes: number } {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return { underAMinute: true };
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}

export const historyLimit = 2000;
/** The last 20 s count as finished, as in the macOS app. */
const endMargin = 20;
/** Shorter than this is not worth remembering. */
const minimumSeconds = 10;

export function targetKey(target: PlayTarget): string {
  return target.kind === 'live' ? `live:${target.login.toLowerCase()}` : `vod:${target.id}`;
}

/** The newest first, each stream or video once, at most 2000. */
export function addToHistory(history: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const key = targetKey(entry.target);
  return [entry, ...history.filter((other) => targetKey(other.target) !== key)].slice(0, historyLimit);
}

/** The position to keep for a video, or null when there is nothing worth keeping. */
export function positionToKeep(seconds: number, duration: number | null): number | null {
  if (!Number.isFinite(seconds)) return null;
  if (duration !== null && duration > 0 && seconds > duration - endMargin) return duration;
  return seconds > minimumSeconds ? seconds : null;
}

/** Where a video starts again: the remembered position, unless it was watched to the end. */
export function resumeAt(position: number | undefined, duration: number | null): number | null {
  if (position === undefined) return null;
  if (duration !== null && duration > 0 && position >= duration - endMargin) return null;
  return position;
}

export function progressFraction(position: number | undefined, duration: number | null): number | null {
  if (position === undefined || duration === null || duration <= 0) return null;
  return Math.min(1, position / duration);
}

/** Matches title, channel and category, ignoring case. */
export function matchesFilter(entry: HistoryEntry, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [entry.title, entry.channelName, entry.gameName ?? ''].some((text) =>
    text.toLocaleLowerCase().includes(needle),
  );
}

/** Groups by the local day: 0 is today, 1 yesterday, … (in the order of the entries). */
export function groupByDay(
  entries: HistoryEntry[],
  now: Date,
): { daysAgo: number; date: Date; entries: HistoryEntry[] }[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const groups: { daysAgo: number; date: Date; entries: HistoryEntry[] }[] = [];
  for (const entry of entries) {
    const watched = new Date(entry.watchedAt);
    const day = new Date(watched.getFullYear(), watched.getMonth(), watched.getDate());
    const daysAgo = Math.round((startOfToday - day.getTime()) / 86_400_000);
    const last = groups.at(-1);
    if (last && last.daysAgo === daysAgo) last.entries.push(entry);
    else groups.push({ daysAgo, date: day, entries: [entry] });
  }
  return groups;
}

function text(value: unknown, limit: number): string | null {
  return typeof value === 'string' ? value.slice(0, limit) : null;
}

function httpsUrl(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith('https://') && value.length <= 2000 ? value : null;
}

function playTarget(value: unknown): PlayTarget | null {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  if (raw['kind'] === 'live' && typeof raw['login'] === 'string' && /^[a-zA-Z0-9_]{1,25}$/.test(raw['login']))
    return { kind: 'live', login: raw['login'] };
  if (raw['kind'] === 'vod' && typeof raw['id'] === 'string' && /^\d{1,20}$/.test(raw['id']))
    return { kind: 'vod', id: raw['id'] };
  return null;
}

/** A record from the player, checked field by field; null when it is not one. */
export function normalizeRecord(value: unknown): HistoryRecord | null {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const target = playTarget(raw['target']);
  if (!target) return null;
  const duration = raw['duration'];
  return {
    target,
    channelLogin: text(raw['channelLogin'], 25) ?? '',
    channelName: text(raw['channelName'], 100) ?? '',
    title: text(raw['title'], 300) ?? '',
    gameName: text(raw['gameName'], 200),
    thumbnailURL: httpsUrl(raw['thumbnailURL']),
    duration: typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
  };
}

/** Reads whatever library.json holds; broken entries are dropped instead of failing. */
export function normalizeLibrary(value: unknown): LibraryState {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const history = Array.isArray(raw['history']) ? raw['history'] : [];
  const entries = history.flatMap((item: unknown): HistoryEntry[] => {
    const record = normalizeRecord(item);
    const fields = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    const id = text(fields['id'], 64);
    const watchedAt = text(fields['watchedAt'], 40);
    if (!record || !id || !watchedAt || Number.isNaN(Date.parse(watchedAt))) return [];
    return [{ ...record, id, watchedAt }];
  });
  const progress: Record<string, number> = {};
  const rawProgress = (
    typeof raw['progress'] === 'object' && raw['progress'] !== null ? raw['progress'] : {}
  ) as Record<string, unknown>;
  for (const [id, seconds] of Object.entries(rawProgress)) {
    if (/^\d{1,20}$/.test(id) && typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0)
      progress[id] = seconds;
  }
  const watched: [string, number][] = [];
  const rawWatch = (
    typeof raw['watchTime'] === 'object' && raw['watchTime'] !== null ? raw['watchTime'] : {}
  ) as Record<string, unknown>;
  for (const [id, seconds] of Object.entries(rawWatch)) {
    if (/^\d{1,20}$/.test(id) && typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0)
      watched.push([id, seconds]);
  }
  watched.sort((a, b) => b[1] - a[1]);
  return {
    subscriptions: normalizeSubscriptions(raw['subscriptions']),
    history: entries.slice(0, historyLimit),
    progress,
    watchTime: Object.fromEntries(watched.slice(0, watchTimeLimit)),
  };
}
