// Playlist addresses on usher.ttvnw.net, as the macOS app and the stage-0 prototype build them.

import type { PlayTarget } from './models';

export interface PlaybackToken {
  value: string;
  signature: string;
}

function query(params: [string, string][]): string {
  return params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
}

/** A random player id, as Twitch's web player sends one. */
export function playerSessionId(random: () => number = Math.random): string {
  return String(1_000_000 + Math.floor(random() * 9_000_000));
}

export function usherUrl(target: PlayTarget, token: PlaybackToken, random: () => number = Math.random): string {
  const common: [string, string][] = [
    ['allow_source', 'true'],
    ['allow_audio_only', 'true'],
    ['player_backend', 'mediaplayer'],
    ['playlist_include_framerate', 'true'],
    ['supported_codecs', 'h264'],
    ['p', playerSessionId(random)],
    ['sig', token.signature],
    ['token', token.value],
  ];
  if (target.kind === 'live') {
    const login = target.login.toLowerCase();
    return `https://usher.ttvnw.net/api/channel/hls/${encodeURIComponent(login)}.m3u8?${query([
      ...common,
      ['reassignments_supported', 'true'],
      ['fast_bread', 'true'],
    ])}`;
  }
  return `https://usher.ttvnw.net/vod/${encodeURIComponent(target.id)}.m3u8?${query(common)}`;
}

/**
 * Hosts whose playlists the main process fetches for the player: Twitch's own (usher, the live
 * edge servers) and the CDN of past broadcasts. Nothing else goes through this door.
 */
export function isPlaylistHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      parsed.protocol === 'https:' &&
      (host.endsWith('.ttvnw.net') || host.endsWith('.live-video.net') || host.endsWith('.cloudfront.net'))
    );
  } catch {
    return false;
  }
}
