import { describe, expect, it } from 'vitest';
import {
  categoriesOfType,
  creativeTag,
  irlTag,
  isMusic,
  mergeStreams,
  rankByStreams,
  sortStreams,
  type BrowseStream,
  type CategoryWithTags,
} from '../src/shared/browse';
import { previewVariant, type StreamVariant } from '../src/shared/m3u8';
import { applyPatch, defaultSettings, normalizeSettings } from '../src/shared/settings';

function stream(id: string, viewers: number, startedAt: string, game?: string): BrowseStream {
  return {
    id,
    title: id,
    viewersCount: viewers,
    startedAt,
    previewImageURL: null,
    game: game ? { id: game, name: game, displayName: game } : null,
    broadcaster: { id, login: id, displayName: id, profileImageURL: null },
  };
}

function game(id: string, name: string, tagIds: string[] = [], viewers = 0): CategoryWithTags {
  return { id, name, displayName: name, boxArtURL: null, viewersCount: viewers, tagIds };
}

describe('Entdecken and Kategorien', () => {
  it('sorts streams by viewers either way or by start', () => {
    const list = [stream('a', 5, '2026-11-23T10:00:00Z'), stream('b', 50, '2026-11-23T08:00:00Z')];
    expect(sortStreams(list, 'VIEWER_COUNT').map((s) => s.id)).toEqual(['b', 'a']);
    expect(sortStreams(list, 'VIEWER_COUNT_ASC').map((s) => s.id)).toEqual(['a', 'b']);
    expect(sortStreams(list, 'RECENT').map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('merges the streams of several categories once each, at most 100', () => {
    const first = Array.from({ length: 80 }, (_, index) => stream(`s${index}`, index, '2026-11-23T10:00:00Z'));
    const second = [
      first[0]!,
      ...Array.from({ length: 40 }, (_, i) => stream(`t${i}`, 1000 + i, '2026-11-23T10:00:00Z')),
    ];
    const merged = mergeStreams([first, second], 'VIEWER_COUNT');
    expect(merged).toHaveLength(100);
    expect(new Set(merged.map((s) => s.id)).size).toBe(100);
    expect(merged[0]!.id).toBe('t39');
  });

  it('sorts categories into content types as the macOS app does', () => {
    const all = [game('1', 'Just Chatting', [irlTag]), game('2', 'Minecraft'), game('3', 'Art', [creativeTag])];
    const creative = [
      game('3', 'Art', [creativeTag]),
      game('4', 'DJs', [creativeTag]),
      game('5', 'Music', [creativeTag]),
    ];
    expect(categoriesOfType('games', all, () => []).map((g) => g.name)).toEqual(['Minecraft']);
    expect(categoriesOfType('creative', [], () => creative).map((g) => g.name)).toEqual(['Art']);
    expect(categoriesOfType('music', [], () => creative).map((g) => g.name)).toEqual(['DJs', 'Music']);
    expect(isMusic({ name: 'Karaoke Nights' })).toBe(true);
  });

  it('ranks esports categories by the viewers of their esports streams', () => {
    const streams = [
      stream('a', 10, '2026-11-23T10:00:00Z', 'cs'),
      stream('b', 30, '2026-11-23T10:00:00Z', 'lol'),
      stream('c', 25, '2026-11-23T10:00:00Z', 'cs'),
    ];
    const ranked = rankByStreams(streams, [game('lol', 'League of Legends', [], 99)]);
    expect(ranked.map((g) => g.id)).toEqual(['cs', 'lol']);
    expect(ranked[0]!.viewersCount).toBe(35);
    expect(ranked[1]!.displayName).toBe('League of Legends');
  });

  it('keeps the filters, falling back for unknown values', () => {
    expect(defaultSettings.browse.language).toBe('');
    const german = applyPatch(defaultSettings, { browse: { language: 'DE', categoriesSort: 'RECENT' } });
    expect(german.browse.language).toBe('DE');
    // Categories sort by viewers only.
    expect(german.browse.categoriesSort).toBe('VIEWER_COUNT');
    expect(normalizeSettings({ browse: { browseContent: 'news', browseSort: 'VIEWER_COUNT_ASC' } }).browse).toEqual({
      ...defaultSettings.browse,
      browseSort: 'VIEWER_COUNT_ASC',
    });
  });

  it('previews in the smallest variant from 360p up', () => {
    const variant = (name: string, height: number | null, bandwidth: number): StreamVariant => ({
      name,
      height,
      bandwidth,
      url: name,
      isSource: false,
    });
    const variants = [
      variant('1080p60', 1080, 6_000_000),
      variant('360p30', 360, 700_000),
      variant('160p30', 160, 250_000),
    ];
    expect(previewVariant(variants)?.name).toBe('360p30');
    expect(previewVariant([variant('160p30', 160, 250_000)])?.name).toBe('160p30');
  });
});
