// Twitch's public GraphQL interface, as the web player uses it – without an account.
// Ported from the native macOS app (lurk-macos, Sources/Lurk/TwitchAPI.swift).

import { net } from 'electron';
import type { ChannelStatus } from '@shared/subscriptions';
import type {
  AdClip,
  PlaybackSource,
  ChannelDetails,
  ChannelRef,
  ChannelInfo,
  Game,
  GameRef,
  LiveStream,
  PlayTarget,
  SearchResults,
  VideoDetails,
  VideoKind,
} from '@shared/models';
import { twitchWebClientId as clientId } from '@shared/twitchClient';
import { isPlaylistHost, usherUrl, type PlaybackToken } from '@shared/usher';
import { settingsStore } from './settingsStore';

const timeoutMs = 10_000;

const fields = {
  game: 'id name displayName boxArtURL(width: 285, height: 380) viewersCount',
  user: `id login displayName profileImageURL(width: 150) followers { totalCount }
    stream { id title viewersCount game { id name displayName } }`,
};

export class TwitchError extends Error {}

/** For the other Twitch modules of the main process (lists.ts). */
export function gqlQuery<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  return gql<T>(query, variables);
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await net.fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Client-ID': clientId, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new TwitchError(`HTTP ${response.status}`);
  const body = (await response.json()) as { data?: T; errors?: { message?: string }[] };
  // Do not swallow errors: Twitch answers null, and the list would silently be empty.
  const message = body.errors?.[0]?.message;
  if (message) throw new TwitchError(message);
  if (!body.data) throw new TwitchError('Empty answer');
  return body.data;
}

interface RawGameRef {
  id: string;
  name: string;
  displayName?: string | null;
}
interface RawGame extends RawGameRef {
  boxArtURL?: string | null;
  viewersCount?: number | null;
}
interface RawUser {
  id: string;
  login: string;
  displayName?: string | null;
  profileImageURL?: string | null;
  followers?: { totalCount?: number | null } | null;
  stream?: { id: string; title?: string | null; viewersCount?: number | null; game?: RawGameRef | null } | null;
}

function gameRef(raw: RawGameRef): GameRef {
  return { id: raw.id, name: raw.name, displayName: raw.displayName ?? raw.name };
}

function toGame(raw: RawGame): Game {
  return { ...gameRef(raw), boxArtURL: raw.boxArtURL ?? null, viewersCount: raw.viewersCount ?? null };
}

function toChannel(raw: RawUser): ChannelInfo {
  return {
    ref: {
      id: raw.id,
      login: raw.login,
      displayName: raw.displayName ?? raw.login,
      profileImageURL: raw.profileImageURL ?? null,
    },
    followers: raw.followers?.totalCount ?? null,
    stream: raw.stream
      ? {
          id: raw.stream.id,
          title: raw.stream.title ?? '',
          viewersCount: raw.stream.viewersCount ?? 0,
          game: raw.stream.game ? gameRef(raw.stream.game) : null,
        }
      : null,
  };
}

export async function searchChannels(term: string): Promise<ChannelInfo[]> {
  const data = await gql<{ searchFor?: { channels?: { items?: (RawUser | null)[] | null } | null } | null }>(
    `query($q: String!) {
      searchFor(userQuery: $q, platform: "web", options: { targets: [{ index: CHANNEL }] }) {
        channels { items { ${fields.user} } }
      }
    }`,
    { q: term },
  );
  return (data.searchFor?.channels?.items ?? []).flatMap((item) => (item ? [toChannel(item)] : []));
}

export async function searchCategories(term: string): Promise<Game[]> {
  const data = await gql<{ searchCategories?: { edges?: ({ node?: RawGame | null } | null)[] | null } | null }>(
    `query($q: String!) {
      searchCategories(query: $q, first: 20) { edges { node { ${fields.game} } } }
    }`,
    { q: term },
  );
  return (data.searchCategories?.edges ?? []).flatMap((edge) => (edge?.node ? [toGame(edge.node)] : []));
}

/** Channels and categories for the sidebar search; one failing half does not hide the other. */
export async function search(term: string): Promise<SearchResults> {
  const query = term.trim().slice(0, 100);
  if (!query) return { channels: [], categories: [] };
  const [channels, categories] = await Promise.allSettled([searchChannels(query), searchCategories(query)]);
  if (channels.status === 'rejected' && categories.status === 'rejected') throw channels.reason;
  return {
    channels: channels.status === 'fulfilled' ? channels.value : [],
    categories: categories.status === 'fulfilled' ? categories.value : [],
  };
}

// MARK: Playback

/**
 * Which Twitch session Lurk opens (the macOS app's TwitchSource.primary): with the ad blocker on
 * "embed" – it carried no pre-roll in the stage-0 measurements (15 of 15) and no ads in the macOS
 * app's (12 channels); with it off "site", as twitch.tv does.
 */
const playerType = () => (settingsStore.get().blocker.enabled ? 'embed' : 'site');

/**
 * The second source (the macOS app's TwitchSource.backup): "popout" carried ads in 4 of 12 sessions
 * in the macOS app's measurement, but stayed ad-free during the other session's breaks.
 */
const backupPlayerType = 'popout';

export async function playbackUrl(target: PlayTarget, source: PlaybackSource = 'primary'): Promise<string> {
  if (target.kind === 'live') {
    const data = await gql<{ streamPlaybackAccessToken?: PlaybackToken | null }>(
      `query($login: String!, $type: String!) {
        streamPlaybackAccessToken(channelName: $login, params: { platform: "web", playerBackend: "mediaplayer", playerType: $type }) { value signature }
      }`,
      { login: target.login.toLowerCase(), type: source === 'backup' ? backupPlayerType : playerType() },
    );
    if (!data.streamPlaybackAccessToken) throw new TwitchError('No session for this channel');
    return usherUrl(target, data.streamPlaybackAccessToken);
  }
  const data = await gql<{ videoPlaybackAccessToken?: PlaybackToken | null }>(
    `query($id: ID!, $type: String!) {
      videoPlaybackAccessToken(id: $id, params: { platform: "web", playerBackend: "mediaplayer", playerType: $type }) { value signature }
    }`,
    { id: target.id, type: playerType() },
  );
  if (!data.videoPlaybackAccessToken) throw new TwitchError('No session for this video');
  return usherUrl(target, data.videoPlaybackAccessToken);
}

// MARK: Clips while ads are skipped

interface RawAdClip {
  slug?: string | null;
  title?: string | null;
  durationSeconds?: number | null;
  viewCount?: number | null;
}

/** A channel's clips for the ad breaks, asked once per channel while Lurk runs. */
const adClipCache = new Map<string, AdClip[]>();

async function channelClips(login: string, period: 'LAST_MONTH' | 'ALL_TIME'): Promise<RawAdClip[]> {
  const data = await gql<{
    user?: { clips?: { edges?: ({ node?: RawAdClip | null } | null)[] | null } | null } | null;
  }>(
    `query($login: String!, $period: ClipsPeriod!) {
      user(login: $login) {
        clips(first: 20, criteria: { period: $period }) { edges { node { slug title durationSeconds viewCount } } }
      }
    }`,
    { login, period },
  );
  return (data.user?.clips?.edges ?? []).flatMap((edge) => (edge?.node ? [edge.node] : []));
}

/**
 * Popular clips of a channel (the macOS app's AdFiller.pick): the most viewed of the last month, of
 * all time when there are fewer than five; at least 8 s long – shorter ones are not worth switching.
 */
export async function adClips(login: string): Promise<AdClip[]> {
  const key = login.toLowerCase();
  const cached = adClipCache.get(key);
  if (cached) return cached;
  let found = await channelClips(key, 'LAST_MONTH');
  if (found.length < 5) found = [...found, ...(await channelClips(key, 'ALL_TIME').catch(() => []))];
  const seen = new Set<string>();
  const clips = found.flatMap((raw): AdClip[] => {
    const slug = raw.slug ?? '';
    const duration = raw.durationSeconds ?? 0;
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(slug) || duration < 8 || seen.has(slug)) return [];
    seen.add(slug);
    return [{ slug, title: (raw.title ?? '').slice(0, 300), durationSeconds: duration, viewCount: raw.viewCount ?? 0 }];
  });
  adClipCache.set(key, clips);
  return clips;
}

/**
 * Where a clip plays: its MP4 with Twitch's clip token, the best quality up to `maxHeight` (the
 * macOS app's ClipPlayback.pick), else the smallest. Only https addresses.
 */
export async function clipSource(slug: string, maxHeight: number): Promise<string | null> {
  const data = await gql<{
    clip?: {
      playbackAccessToken?: PlaybackToken | null;
      videoQualities?: ({ quality?: string | null; sourceURL?: string | null } | null)[] | null;
    } | null;
  }>(
    `query($slug: ID!) {
      clip(slug: $slug) {
        playbackAccessToken(params: { platform: "web", playerBackend: "mediaplayer", playerType: "site" }) { value signature }
        videoQualities { quality sourceURL }
      }
    }`,
    { slug },
  );
  const token = data.clip?.playbackAccessToken;
  if (!token) return null;
  const sources = (data.clip?.videoQualities ?? [])
    .flatMap((quality) => {
      const url = quality?.sourceURL ?? '';
      if (!url.startsWith('https://')) return [];
      return [{ height: Number.parseInt(quality?.quality ?? '', 10) || 0, url }];
    })
    .sort((a, b) => b.height - a.height);
  const pick = sources.find((source) => source.height <= maxHeight) ?? sources.at(-1);
  if (!pick) return null;
  const query = new URLSearchParams({ sig: token.signature, token: token.value });
  return `${pick.url}?${query}`;
}

/** A playlist for the player – only from Twitch's playlist hosts, only text, at most 2 MB. */
export async function fetchPlaylist(url: string): Promise<{ status: number; text: string }> {
  if (!isPlaylistHost(url)) throw new TwitchError('Not a playlist host');
  const response = await net.fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  if (text.length > 2_000_000) throw new TwitchError('Playlist too large');
  return { status: response.status, text };
}

/**
 * A video's segment (VOD). Twitch's video CDN answers cross-origin requests only for twitch.tv, so
 * the page cannot load these itself; live segments come from hosts that allow any origin.
 */
export async function fetchSegment(url: string): Promise<{ status: number; data: Uint8Array | null }> {
  if (!isPlaylistHost(url)) throw new TwitchError('Not a video host');
  const response = await net.fetch(url, { signal: AbortSignal.timeout(timeoutMs * 3) });
  if (!response.ok) return { status: response.status, data: null };
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.byteLength > 64_000_000) throw new TwitchError('Segment too large');
  return { status: response.status, data };
}

// MARK: Subscriptions

interface RawStatusUser {
  id: string;
  login: string;
  displayName?: string | null;
  profileImageURL?: string | null;
  stream?: {
    id: string;
    title?: string | null;
    viewersCount?: number | null;
    createdAt?: string | null;
    previewImageURL?: string | null;
    game?: RawGameRef | null;
  } | null;
  lastBroadcast?: { startedAt?: string | null } | null;
}

const statusFields = `id login displayName profileImageURL(width: 150)
  stream { id title viewersCount createdAt previewImageURL(width: 640, height: 360) game { id name displayName } }
  lastBroadcast { startedAt }`;

function toStatus(raw: RawStatusUser): ChannelStatus {
  const ref = {
    id: raw.id,
    login: raw.login,
    displayName: raw.displayName ?? raw.login,
    profileImageURL: raw.profileImageURL ?? null,
  };
  return {
    ref,
    stream: raw.stream
      ? {
          id: raw.stream.id,
          title: raw.stream.title ?? '',
          viewersCount: raw.stream.viewersCount ?? 0,
          startedAt: raw.stream.createdAt ?? null,
          previewImageURL: raw.stream.previewImageURL ?? null,
          game: raw.stream.game ? gameRef(raw.stream.game) : null,
          broadcaster: ref,
        }
      : null,
    lastLiveAt: raw.lastBroadcast?.startedAt ?? null,
  };
}

/** Users by id or by login, in blocks of 50 (as the macOS app asks). */
async function usersIn(argument: 'ids' | 'logins', values: string[]): Promise<ChannelStatus[]> {
  const type = argument === 'ids' ? '[ID!]' : '[String!]';
  const result: ChannelStatus[] = [];
  for (let start = 0; start < values.length; start += 50) {
    const data = await gql<{ users?: (RawStatusUser | null)[] | null }>(
      `query($v: ${type}) { users(${argument}: $v) { ${statusFields} } }`,
      { v: values.slice(start, start + 50) },
    );
    result.push(...(data.users ?? []).flatMap((user) => (user ? [toStatus(user)] : [])));
  }
  return result;
}

/** The live status of subscribed channels. */
export function channelStatuses(ids: string[]): Promise<ChannelStatus[]> {
  return usersIn('ids', ids);
}

/** Channels for names from an import file; names Twitch does not know are left out. */
export async function channelsByLogin(logins: string[]): Promise<ChannelRef[]> {
  return (
    await usersIn(
      'logins',
      logins.map((login) => login.toLowerCase()),
    )
  ).map((status) => status.ref);
}

interface RawChannel {
  id: string;
  login: string;
  displayName?: string | null;
  profileImageURL?: string | null;
  stream?: {
    id: string;
    title?: string | null;
    viewersCount?: number | null;
    createdAt?: string | null;
    previewImageURL?: string | null;
    game?: RawGameRef | null;
  } | null;
  description?: string | null;
  followers?: { totalCount?: number | null } | null;
  lastBroadcast?: { startedAt?: string | null; title?: string | null; game?: RawGameRef | null } | null;
}

export async function channel(login: string): Promise<ChannelDetails | null> {
  const data = await gql<{ user?: RawChannel | null }>(
    `query($login: String!) {
      user(login: $login) {
        id login displayName profileImageURL(width: 150) description followers { totalCount }
        stream { id title viewersCount createdAt previewImageURL(width: 1280, height: 720) game { id name displayName } }
        lastBroadcast { startedAt title game { id name displayName } }
      }
    }`,
    { login: login.toLowerCase() },
  );
  const user = data.user;
  if (!user) return null;
  return {
    ref: {
      id: user.id,
      login: user.login,
      displayName: user.displayName ?? user.login,
      profileImageURL: user.profileImageURL ?? null,
    },
    followers: user.followers?.totalCount ?? null,
    description: user.description?.trim() || null,
    stream: user.stream
      ? {
          id: user.stream.id,
          title: user.stream.title ?? '',
          viewersCount: user.stream.viewersCount ?? 0,
          game: user.stream.game ? gameRef(user.stream.game) : null,
          startedAt: user.stream.createdAt ?? null,
          previewImageURL: user.stream.previewImageURL ?? null,
        }
      : null,
    lastBroadcast: user.lastBroadcast
      ? {
          startedAt: user.lastBroadcast.startedAt ?? null,
          title: user.lastBroadcast.title ?? null,
          game: user.lastBroadcast.game ? gameRef(user.lastBroadcast.game) : null,
        }
      : null,
  };
}

interface RawVideo {
  id: string;
  title?: string | null;
  lengthSeconds?: number | null;
  previewThumbnailURL?: string | null;
  publishedAt?: string | null;
  viewCount?: number | null;
  game?: RawGameRef | null;
  owner?: { id: string; login: string; displayName?: string | null; profileImageURL?: string | null } | null;
}

const videoFields = `id title lengthSeconds previewThumbnailURL(width: 640, height: 360) publishedAt viewCount
  game { id name displayName } owner { id login displayName profileImageURL(width: 150) }`;

function toVideo(raw: RawVideo): VideoDetails {
  // Twitch answers a placeholder path for videos still processing; no picture then.
  const thumbnail = raw.previewThumbnailURL ?? null;
  return {
    id: raw.id,
    title: raw.title ?? '',
    thumbnailURL: thumbnail && !thumbnail.includes('404_processing') ? thumbnail : null,
    lengthSeconds: raw.lengthSeconds ?? 0,
    publishedAt: raw.publishedAt ?? null,
    viewCount: raw.viewCount ?? null,
    game: raw.game ? gameRef(raw.game) : null,
    owner: raw.owner
      ? {
          id: raw.owner.id,
          login: raw.owner.login,
          displayName: raw.owner.displayName ?? raw.owner.login,
          profileImageURL: raw.owner.profileImageURL ?? null,
        }
      : null,
  };
}

export async function video(id: string): Promise<VideoDetails | null> {
  const data = await gql<{ video?: RawVideo | null }>(`query($id: ID!) { video(id: $id) { ${videoFields} } }`, { id });
  return data.video ? toVideo(data.video) : null;
}

/** A channel's videos of one kind, newest first (the first 100, as the macOS app asks). */
export async function videos(login: string, kind: VideoKind): Promise<VideoDetails[]> {
  const data = await gql<{
    user?: { videos?: { edges?: ({ node?: RawVideo | null } | null)[] | null } | null } | null;
  }>(
    `query($login: String!, $type: BroadcastType) {
      user(login: $login) { videos(first: 100, type: $type, sort: TIME) { edges { node { ${videoFields} } } } }
    }`,
    { login: login.toLowerCase(), type: kind },
  );
  return (data.user?.videos?.edges ?? []).flatMap((edge) => (edge?.node ? [toVideo(edge.node)] : []));
}

/** The most watched live streams (the first page Twitch allows anonymously). */
export async function topStreams(count: number): Promise<LiveStream[]> {
  const data = await gql<{
    streams?: {
      edges?:
        | ({
            node?: {
              viewersCount?: number | null;
              broadcaster?: { login: string; displayName?: string | null } | null;
            } | null;
          } | null)[]
        | null;
    } | null;
  }>(
    `query($first: Int!) {
      streams(first: $first, options: { sort: VIEWER_COUNT }) { edges { node { viewersCount broadcaster { login displayName } } } }
    }`,
    { first: Math.min(30, Math.max(1, Math.floor(count))) },
  );
  return (data.streams?.edges ?? []).flatMap((edge) => {
    const node = edge?.node;
    return node?.broadcaster
      ? [
          {
            login: node.broadcaster.login,
            displayName: node.broadcaster.displayName ?? node.broadcaster.login,
            viewersCount: node.viewersCount ?? 0,
          },
        ]
      : [];
  });
}
