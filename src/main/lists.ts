// Stream and category lists for Entdecken and Kategorien – the first page Twitch allows anonymously
// (no paging without an integrity token). Port of TwitchAPI.topStreams, topGames, streams(inGame:),
// categories(for:), streams(content:) and searchTags of the native macOS app (lurk-macos).

import {
  categoriesOfType,
  creativeTag,
  esportsTag,
  irlTag,
  mergeStreams,
  rankByStreams,
  type CategoryWithTags,
  type ContentType,
  type BrowseStream,
  type StreamLanguage,
  type StreamSort,
} from '@shared/browse';
import type { Game } from '@shared/models';
import { gqlQuery } from './twitch';

const streamFields = `id title viewersCount createdAt previewImageURL(width: 640, height: 360)
  game { id name displayName } broadcaster { id login displayName profileImageURL(width: 150) }`;
const gameFields = 'id name displayName boxArtURL(width: 285, height: 380) viewersCount tags(tagType: CONTENT) { id }';

interface RawStream {
  id: string;
  title?: string | null;
  viewersCount?: number | null;
  createdAt?: string | null;
  previewImageURL?: string | null;
  game?: { id: string; name: string; displayName?: string | null } | null;
  broadcaster?: { id: string; login: string; displayName?: string | null; profileImageURL?: string | null } | null;
}
interface RawGame {
  id: string;
  name: string;
  displayName?: string | null;
  boxArtURL?: string | null;
  viewersCount?: number | null;
  tags?: ({ id: string } | null)[] | null;
}
type Edges<T> = { edges?: ({ node?: T | null } | null)[] | null } | null | undefined;

function nodes<T>(connection: Edges<T>): T[] {
  return (connection?.edges ?? []).flatMap((edge) => (edge?.node ? [edge.node] : []));
}

function toStream(raw: RawStream): BrowseStream[] {
  if (!raw.broadcaster) return [];
  return [
    {
      id: raw.id,
      title: raw.title ?? '',
      viewersCount: raw.viewersCount ?? 0,
      startedAt: raw.createdAt ?? null,
      previewImageURL: raw.previewImageURL ?? null,
      game: raw.game
        ? { id: raw.game.id, name: raw.game.name, displayName: raw.game.displayName ?? raw.game.name }
        : null,
      broadcaster: {
        id: raw.broadcaster.id,
        login: raw.broadcaster.login,
        displayName: raw.broadcaster.displayName ?? raw.broadcaster.login,
        profileImageURL: raw.broadcaster.profileImageURL ?? null,
      },
    },
  ];
}

function toGame(raw: RawGame): CategoryWithTags {
  return {
    id: raw.id,
    name: raw.name,
    displayName: raw.displayName ?? raw.name,
    boxArtURL: raw.boxArtURL ?? null,
    viewersCount: raw.viewersCount ?? null,
    tagIds: (raw.tags ?? []).flatMap((tag) => (tag ? [tag.id] : [])),
  };
}

function filterVariables(language: StreamLanguage, tags: string[]): Record<string, unknown> {
  return { ...(language ? { languages: [language] } : {}), ...(tags.length ? { tags } : {}) };
}

export async function topStreams(language: StreamLanguage, sort: StreamSort, tags: string[]): Promise<BrowseStream[]> {
  const data = await gqlQuery<{ streams?: Edges<RawStream> }>(
    `query($languages: [Language!], $tags: [String!]) {
      streams(first: 30, options: { languages: $languages, sort: ${sort}, freeformTags: $tags }) { edges { node { ${streamFields} } } }
    }`,
    filterVariables(language, tags),
  );
  return nodes(data.streams).flatMap(toStream);
}

let gamesCache: { at: number; games: CategoryWithTags[] } | null = null;

/** The list changes slowly; Lurk asks at most every 5 minutes. */
export async function topGames(): Promise<CategoryWithTags[]> {
  if (gamesCache && Date.now() - gamesCache.at < 300_000) return gamesCache.games;
  const data = await gqlQuery<{ games?: Edges<RawGame> }>(
    `query { games(first: 100) { edges { node { ${gameFields} } } } }`,
    {},
  );
  const games = nodes(data.games).map(toGame);
  gamesCache = { at: Date.now(), games };
  return games;
}

async function gamesWithTag(tag: string): Promise<CategoryWithTags[]> {
  const data = await gqlQuery<{ games?: Edges<RawGame> }>(
    `query($tags: [String!]) { games(first: 100, options: { tags: $tags }) { edges { node { ${gameFields} } } } }`,
    { tags: [tag] },
  );
  return nodes(data.games).map(toGame);
}

export async function streamsInCategory(
  name: string,
  language: StreamLanguage,
  sort: StreamSort,
  tags: string[],
  first = 100,
): Promise<BrowseStream[]> {
  const data = await gqlQuery<{ game?: { streams?: Edges<RawStream> } | null }>(
    `query($name: String!, $languages: [String!], $tags: [String!]) {
      game(name: $name) { streams(first: ${first}, options: { languages: $languages, sort: ${sort}, freeformTags: $tags }) { edges { node { ${streamFields} } } } }
    }`,
    { name, ...filterVariables(language, tags) },
  );
  return nodes(data.game?.streams).flatMap(toStream);
}

/** A category's page: its box art and viewers (fresh, whoever opened it) and its live streams. */
export async function categoryPage(
  name: string,
  language: StreamLanguage,
  sort: StreamSort,
): Promise<{ game: Game | null; streams: BrowseStream[] }> {
  const data = await gqlQuery<{ game?: (RawGame & { streams?: Edges<RawStream> }) | null }>(
    `query($name: String!, $languages: [String!]) {
      game(name: $name) {
        id name displayName boxArtURL(width: 285, height: 380) viewersCount
        streams(first: 100, options: { languages: $languages, sort: ${sort} }) { edges { node { ${streamFields} } } }
      }
    }`,
    { name, ...filterVariables(language, []) },
  );
  const game = data.game;
  if (!game) return { game: null, streams: [] };
  const { tagIds: _tags, ...info } = toGame(game);
  return { game: info, streams: nodes(game.streams).flatMap(toStream) };
}

/** Categories of a content type, most watched first. */
export async function categories(content: ContentType): Promise<CategoryWithTags[]> {
  if (content === 'esports') {
    const [streams, known] = await Promise.all([
      topStreams('', 'VIEWER_COUNT', [esportsTag]),
      topGames().catch(() => []),
    ]);
    return rankByStreams(streams, known) as CategoryWithTags[];
  }
  const all = content === 'all' || content === 'games' ? await topGames() : [];
  const tagged =
    content === 'irl' || content === 'creative' || content === 'music'
      ? await gamesWithTag(content === 'irl' ? irlTag : creativeTag)
      : [];
  return categoriesOfType(content, all, () => tagged);
}

/**
 * Live streams of a content type. Twitch filters anonymously only by category, so Lurk asks the ten
 * most watched categories of the type and merges their streams.
 */
export async function browseStreams(
  content: ContentType,
  language: StreamLanguage,
  sort: StreamSort,
  tag: string | null,
): Promise<BrowseStream[]> {
  const tags = tag ? [tag] : [];
  if (content === 'all') return topStreams(language, sort, tags);
  if (content === 'esports') return topStreams(language, sort, [esportsTag, ...tags]);
  const games = (await categories(content)).slice(0, 10);
  const results = await Promise.allSettled(games.map((game) => streamsInCategory(game.name, language, sort, tags, 30)));
  const lists = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  // Every request failed (offline, say): show the failure rather than "Niemand live".
  if (lists.length === 0 && results[0]?.status === 'rejected') throw results[0].reason;
  return mergeStreams(lists, sort);
}

/** Suggestions for the tags streamers give (e.g. "Deutsch", "Speedrun"). */
export async function searchTags(query: string): Promise<string[]> {
  const data = await gqlQuery<{ searchFreeformTags?: Edges<{ tagName?: string | null }> }>(
    `query($q: String!) { searchFreeformTags(userQuery: $q, first: 12) { edges { node { tagName } } } }`,
    { q: query.slice(0, 50) },
  );
  return nodes(data.searchFreeformTags).flatMap((node) => (node.tagName ? [node.tagName] : []));
}
