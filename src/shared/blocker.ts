// What the ad blocker counts and logs, what the settings tab and the player's shield show, and what
// the player reports. Port of BlockerLog and UserFilters of the macOS app (lurk-macos,
// Sources/Lurk/Blocker/ContentBlocker.swift). Everything a page sends is checked here first.

import type { FilterEngine, FilterIssue, RequestType } from './filterEngine';

/** Totals across sessions, kept in werbeblocker.json. */
export interface BlockerTotals {
  adBreaks: number;
  adSeconds: number;
  adSegments: number;
  blockedRequests: number;
}

export const emptyTotals: BlockerTotals = { adBreaks: 0, adSeconds: 0, adSegments: 0, blockedRequests: 0 };

/** What happened; the pages put it into words. */
export type BlockerEntryDetail =
  | { kind: 'request'; type: RequestType; address: string }
  | { kind: 'prune'; channel: string; segments: number; seconds: number }
  | { kind: 'skip'; channel: string; seconds: number }
  | { kind: 'switch'; channel: string };

export interface BlockerEntry {
  id: number;
  /** ISO time. */
  at: string;
  detail: BlockerEntryDetail;
  /** The filter that applied; null for a skipped break (ad detection and m3u-prune together) and a
   * break avoided through the second source. */
  rule: string | null;
}

/** The own filters as the engine read them. */
export interface FilterReport {
  ruleCount: number;
  /** Cosmetic filters and rules for other sites. */
  skipped: number;
  issues: FilterIssue[];
}

export interface BlockerState {
  totals: BlockerTotals;
  /** Newest first; this session only. */
  entries: BlockerEntry[];
  builtIn: { text: string; ruleCount: number };
  user: { text: string; report: FilterReport };
}

/** What the player reports. */
export type BlockerEvent =
  | { kind: 'prune'; channel: string; segments: number; seconds: number; rule: string }
  | { kind: 'skipStart' }
  | { kind: 'skipEnd'; channel: string; seconds: number }
  | { kind: 'switch'; channel: string };

/** The log keeps this many entries, as on macOS. */
export const maxLogEntries = 300;
/** Own filters larger than this are not a list anyone keeps by hand. */
export const maxUserFiltersLength = 500_000;
/** The settings tab lists at most this many problems. */
export const maxReportedIssues = 100;

export function filterReport(engine: FilterEngine): FilterReport {
  return {
    ruleCount: engine.ruleCount,
    skipped: engine.ignoredCosmetic + engine.ignoredOtherSites,
    issues: engine.issues.slice(0, maxReportedIssues),
  };
}

export function totalsAreEmpty(totals: BlockerTotals): boolean {
  return Object.values(totals).every((value) => value === 0);
}

const count = (value: unknown, max: number): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : null;

const name = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 100) : null;

/** A report from the player, or null when it is not one. */
export function parseBlockerEvent(value: unknown): BlockerEvent | null {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  switch (raw['kind']) {
    case 'skipStart':
      return { kind: 'skipStart' };
    case 'switch': {
      const channel = name(raw['channel']);
      return channel ? { kind: 'switch', channel } : null;
    }
    case 'skipEnd': {
      const channel = name(raw['channel']);
      const seconds = count(raw['seconds'], 3600);
      return channel && seconds !== null ? { kind: 'skipEnd', channel, seconds } : null;
    }
    case 'prune': {
      const channel = name(raw['channel']);
      const segments = count(raw['segments'], 1000);
      const seconds = count(raw['seconds'], 3600);
      const rule = typeof raw['rule'] === 'string' ? raw['rule'].slice(0, 2000) : null;
      return channel && segments && Number.isInteger(segments) && seconds !== null && rule !== null
        ? { kind: 'prune', channel, segments, seconds, rule }
        : null;
    }
    default:
      return null;
  }
}

/** Reads the stored totals; anything broken counts as zero. */
export function normalizeTotals(value: unknown): BlockerTotals {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const read = (key: keyof BlockerTotals) => count(raw[key], Number.MAX_SAFE_INTEGER) ?? 0;
  return {
    adBreaks: Math.floor(read('adBreaks')),
    adSeconds: read('adSeconds'),
    adSegments: Math.floor(read('adSegments')),
    blockedRequests: Math.floor(read('blockedRequests')),
  };
}

/** "Ausgeblendete Werbezeit": seconds under a minute, then minutes and hours (as Fmt.watchTime). */
export function adTimeParts(seconds: number): { seconds: number } | { hours: number; minutes: number } {
  if (seconds < 60) return { seconds: Math.round(seconds) };
  const minutes = Math.floor(seconds / 60);
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}
