// What Lurk knows about channels, streams and categories – the parts the interface shows.
// Ported from the native macOS app (lurk-macos, Sources/Lurk/Models.swift), reduced to what is used.

export interface ChannelRef {
  id: string;
  login: string;
  displayName: string;
  profileImageURL: string | null;
}

export interface GameRef {
  id: string;
  name: string;
  displayName: string;
}

export interface StreamSummary {
  id: string;
  title: string;
  viewersCount: number;
  game: GameRef | null;
}

export interface ChannelInfo {
  ref: ChannelRef;
  followers: number | null;
  /** Set while the channel is live. */
  stream: StreamSummary | null;
}

export interface Game extends GameRef {
  boxArtURL: string | null;
  viewersCount: number | null;
}

export interface SearchResults {
  channels: ChannelInfo[];
  categories: Game[];
}

/** A channel as the player and the channel page show it: live stream details or the last broadcast. */
export interface ChannelDetails {
  ref: ChannelRef;
  followers: number | null;
  description: string | null;
  stream: (StreamSummary & { startedAt: string | null; previewImageURL: string | null }) | null;
  lastBroadcast: { startedAt: string | null; title: string | null; game: GameRef | null } | null;
}

export interface VideoDetails {
  id: string;
  title: string;
  /** 640 × 360. */
  thumbnailURL: string | null;
  lengthSeconds: number;
  publishedAt: string | null;
  viewCount: number | null;
  game: GameRef | null;
  owner: ChannelRef | null;
}

export interface LiveStream {
  login: string;
  displayName: string;
  viewersCount: number;
}

/** A popular clip of a channel that plays while Lurk skips ads (the macOS app's AdFiller). */
export interface AdClip {
  slug: string;
  title: string;
  durationSeconds: number;
  viewCount: number;
}

/** Which Twitch session of a live channel: the one that plays, or the second source. */
export type PlaybackSource = 'primary' | 'backup';

/** The kinds of a channel's videos, in the order of the channel page's segments. */
export const videoKinds = ['ARCHIVE', 'HIGHLIGHT', 'UPLOAD'] as const;
export type VideoKind = (typeof videoKinds)[number];

/** What the player plays: a live channel or a past broadcast (VOD). */
export type PlayTarget = { kind: 'live'; login: string } | { kind: 'vod'; id: string };
