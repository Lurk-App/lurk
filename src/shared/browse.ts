// Filters of Entdecken and Kategorien: content type, sort, language – as on twitch.tv.
// Port of ContentType, StreamSort and StreamLanguage from the native macOS app (lurk-macos,
// Sources/Lurk/Models.swift).

import type { ChannelRef, Game, GameRef } from './models';

export const contentTypes = ['all', 'games', 'irl', 'music', 'creative', 'esports'] as const;
export type ContentType = (typeof contentTypes)[number];

export const streamSorts = ['VIEWER_COUNT', 'VIEWER_COUNT_ASC', 'RECENT'] as const;
export type StreamSort = (typeof streamSorts)[number];

/** Language codes Twitch filters by; '' is every language. */
export const streamLanguages = ['', 'DE', 'EN', 'ES', 'FR', 'IT', 'PT', 'NL', 'PL', 'TR', 'RU', 'JA', 'KO'] as const;
export type StreamLanguage = (typeof streamLanguages)[number];

/** Content tags with which Twitch sorts categories. */
export const irlTag = '2610cff9-10ae-4cb3-8500-778e6722fbb5';
export const creativeTag = 'e36d0169-268a-4c62-a4f4-ddf61a0b3ae4';
/** Twitch has no content tag for it: esports streams carry this freeform tag. */
export const esportsTag = 'Esports';

export interface BrowseStream {
  id: string;
  title: string;
  viewersCount: number;
  startedAt: string | null;
  previewImageURL: string | null;
  game: GameRef | null;
  broadcaster: ChannelRef;
}

export interface CategoryWithTags extends Game {
  tagIds: string[];
}

export function isMusic(game: { name: string }): boolean {
  const name = game.name.toLowerCase();
  return ['music', 'dj', 'singing', 'musik', 'karaoke'].some((word) => name.includes(word));
}

export function sortStreams(streams: BrowseStream[], sort: StreamSort): BrowseStream[] {
  const copy = [...streams];
  if (sort === 'VIEWER_COUNT') return copy.sort((a, b) => b.viewersCount - a.viewersCount);
  if (sort === 'VIEWER_COUNT_ASC') return copy.sort((a, b) => a.viewersCount - b.viewersCount);
  return copy.sort((a, b) => Date.parse(b.startedAt ?? '0') - Date.parse(a.startedAt ?? '0'));
}

/** Merges stream lists of several categories: each stream once, sorted, at most 100. */
export function mergeStreams(lists: BrowseStream[][], sort: StreamSort): BrowseStream[] {
  const seen = new Set<string>();
  const unique = lists.flat().filter((stream) => {
    if (seen.has(stream.id)) return false;
    seen.add(stream.id);
    return true;
  });
  return sortStreams(unique, sort).slice(0, 100);
}

/** The categories of a content type, from the top categories (as the macOS app filters them). */
export function categoriesOfType<T extends CategoryWithTags>(
  content: ContentType,
  all: T[],
  tagged: (tag: string) => T[],
): T[] {
  switch (content) {
    case 'all':
      return all;
    case 'irl':
      return tagged(irlTag);
    case 'creative':
      return tagged(creativeTag).filter((game) => !isMusic(game));
    case 'music':
      return tagged(creativeTag).filter(isMusic);
    case 'games':
      return all.filter((game) => !game.tagIds.includes(irlTag) && !game.tagIds.includes(creativeTag));
    case 'esports':
      return all;
  }
}

/** Categories ranked by the viewers of esports streams (Twitch has no esports category tag). */
export function rankByStreams<T extends CategoryWithTags>(
  streams: BrowseStream[],
  known: T[],
): (T | CategoryWithTags)[] {
  const viewers = new Map<string, number>();
  const games = new Map<string, GameRef>();
  for (const stream of streams) {
    if (!stream.game) continue;
    viewers.set(stream.game.id, (viewers.get(stream.game.id) ?? 0) + stream.viewersCount);
    games.set(stream.game.id, stream.game);
  }
  const byId = new Map(known.map((game) => [game.id, game]));
  return [...viewers.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => byId.get(id) ?? { ...games.get(id)!, boxArtURL: null, viewersCount: count, tagIds: [] });
}

export function isStreamSort(value: unknown): value is StreamSort {
  return typeof value === 'string' && (streamSorts as readonly string[]).includes(value);
}

export function isContentType(value: unknown): value is ContentType {
  return typeof value === 'string' && (contentTypes as readonly string[]).includes(value);
}

export function isStreamLanguage(value: unknown): value is StreamLanguage {
  return typeof value === 'string' && (streamLanguages as readonly string[]).includes(value);
}
