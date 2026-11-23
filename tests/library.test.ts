import { describe, expect, it } from 'vitest';
import {
  addToHistory,
  groupByDay,
  historyLimit,
  matchesFilter,
  normalizeLibrary,
  normalizeRecord,
  positionToKeep,
  progressFraction,
  resumeAt,
  type HistoryEntry,
} from '../src/shared/library';
import { applyPatch, defaultSettings } from '../src/shared/settings';

function entry(
  id: string,
  target: HistoryEntry['target'],
  watchedAt: string,
  extra: Partial<HistoryEntry> = {},
): HistoryEntry {
  return {
    id,
    target,
    channelLogin: 'gronkh',
    channelName: 'Gronkh',
    title: 'Ein Titel',
    gameName: 'Minecraft',
    thumbnailURL: null,
    watchedAt,
    duration: null,
    ...extra,
  };
}

describe('history and positions', () => {
  it('keeps each stream or video once, newest first, at most 2000', () => {
    const live = entry('1', { kind: 'live', login: 'Gronkh' }, '2026-11-22T10:00:00Z');
    const again = entry('2', { kind: 'live', login: 'gronkh' }, '2026-11-23T10:00:00Z');
    const history = addToHistory([live], again);
    expect(history.map((item) => item.id)).toEqual(['2']);
    const many = Array.from({ length: historyLimit }, (_, index) =>
      entry(String(index), { kind: 'vod', id: String(index) }, '2026-11-22T10:00:00Z'),
    );
    expect(addToHistory(many, again)).toHaveLength(historyLimit);
  });

  it('remembers positions as the macOS app does', () => {
    expect(positionToKeep(5, 3600)).toBeNull();
    expect(positionToKeep(600, 3600)).toBe(600);
    // The last 20 s count as finished, and a finished video starts from the beginning.
    expect(positionToKeep(3590, 3600)).toBe(3600);
    expect(resumeAt(3600, 3600)).toBeNull();
    expect(resumeAt(600, 3600)).toBe(600);
    expect(resumeAt(undefined, 3600)).toBeNull();
    expect(progressFraction(900, 3600)).toBe(0.25);
    expect(progressFraction(900, null)).toBeNull();
  });

  it('filters by title, channel and category, ignoring case', () => {
    const item = entry('1', { kind: 'vod', id: '7' }, '2026-11-23T10:00:00Z');
    expect(matchesFilter(item, 'minecr')).toBe(true);
    expect(matchesFilter(item, 'GRONKH')).toBe(true);
    expect(matchesFilter(item, 'zelda')).toBe(false);
    expect(matchesFilter(item, '  ')).toBe(true);
  });

  it('groups by local day', () => {
    const now = new Date(2026, 10, 23, 12, 0);
    const items = [
      entry('1', { kind: 'vod', id: '1' }, new Date(2026, 10, 23, 9, 0).toISOString()),
      entry('2', { kind: 'vod', id: '2' }, new Date(2026, 10, 23, 0, 30).toISOString()),
      entry('3', { kind: 'vod', id: '3' }, new Date(2026, 10, 22, 23, 50).toISOString()),
      entry('4', { kind: 'vod', id: '4' }, new Date(2026, 10, 17, 20, 0).toISOString()),
    ];
    expect(groupByDay(items, now).map((group) => [group.daysAgo, group.entries.length])).toEqual([
      [0, 2],
      [1, 1],
      [6, 1],
    ]);
  });

  it('checks what the player reports and what the file holds', () => {
    expect(normalizeRecord({ target: { kind: 'live', login: 'bad login!' } })).toBeNull();
    const record = normalizeRecord({
      target: { kind: 'vod', id: '123' },
      title: 'x'.repeat(500),
      thumbnailURL: 'http://insecure.example/a.jpg',
      duration: 61.6,
    });
    expect(record?.title).toHaveLength(300);
    expect(record?.thumbnailURL).toBeNull();
    expect(record?.duration).toBe(62);
    const state = normalizeLibrary({
      history: [{ id: 'a', watchedAt: 'not a date', target: { kind: 'vod', id: '1' } }, 'junk'],
      progress: { '42': 120, nope: 5, '7': -1 },
    });
    expect(state).toEqual({ subscriptions: [], history: [], progress: { '42': 120 }, watchTime: {} });
  });

  it('keeps the privacy switches', () => {
    expect(defaultSettings.privacy).toEqual({ saveHistory: true, rememberPosition: true });
    const off = applyPatch(defaultSettings, { privacy: { saveHistory: false, rememberPosition: 'no' } });
    expect(off.privacy).toEqual({ saveHistory: false, rememberPosition: true });
  });
});
