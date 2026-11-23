import { describe, expect, it } from 'vitest';
import { formatDuration, formatRelative, formatUptime } from '@shared/format';
import { applyPatch, defaultSettings, normalizeSettings } from '@shared/settings';
import { isPlaylistHost, usherUrl } from '@shared/usher';
import { navigate, initialNavigation, type NavigationState } from '../src/renderer/src/shell/router';

const token = { value: '{"a":1}', signature: 'abc' };

describe('usher addresses', () => {
  it('builds the live address like the macOS app, with fast_bread', () => {
    const url = new URL(usherUrl({ kind: 'live', login: 'GronkhTV' }, token, () => 0.5));
    expect(url.origin + url.pathname).toBe('https://usher.ttvnw.net/api/channel/hls/gronkhtv.m3u8');
    expect(url.searchParams.get('token')).toBe('{"a":1}');
    expect(url.searchParams.get('sig')).toBe('abc');
    expect(url.searchParams.get('fast_bread')).toBe('true');
    expect(url.searchParams.get('allow_source')).toBe('true');
    expect(url.searchParams.get('p')).toBe('5500000');
  });

  it('builds the VOD address without the live-only parameters', () => {
    const url = new URL(usherUrl({ kind: 'vod', id: '123' }, token));
    expect(url.pathname).toBe('/vod/123.m3u8');
    expect(url.searchParams.has('fast_bread')).toBe(false);
  });

  it('lets only Twitch playlist hosts through the main process', () => {
    expect(isPlaylistHost('https://usher.ttvnw.net/api/channel/hls/x.m3u8')).toBe(true);
    expect(isPlaylistHost('https://video-weaver.fra05.hls.ttvnw.net/v1/playlist/x.m3u8')).toBe(true);
    expect(isPlaylistHost('https://d1m7jfoe9zdc1j.cloudfront.net/x/chunked/index-dvr.m3u8')).toBe(true);
    expect(isPlaylistHost('http://usher.ttvnw.net/x.m3u8')).toBe(false);
    expect(isPlaylistHost('https://ttvnw.net.evil.example/x.m3u8')).toBe(false);
    expect(isPlaylistHost('https://example.com/x.m3u8')).toBe(false);
  });
});

describe('player settings', () => {
  it('remembers volume and mute, within bounds', () => {
    expect(defaultSettings.player).toEqual({
      volume: 0.8,
      muted: false,
      showChat: true,
      thirdPartyEmotes: true,
      animatedEmotes: true,
      followRaids: true,
      hoverPreview: true,
      liveNotifications: false,
      adSwitch: true,
    });
    expect(normalizeSettings({ player: { volume: 7, muted: 'yes', showChat: false } }).player).toEqual({
      ...defaultSettings.player,
      volume: 1,
      showChat: false,
    });
    const quieter = applyPatch(defaultSettings, { player: { volume: 0.3 } });
    expect(quieter.player).toEqual({ ...defaultSettings.player, volume: 0.3 });
    expect(quieter.appearance).toEqual(defaultSettings.appearance);
  });
});

describe('formatting', () => {
  it('shows uptime, duration and relative dates like the macOS app', () => {
    const now = new Date('2026-11-23T20:00:00Z');
    expect(formatUptime('2026-11-23T18:37:00Z', now)).toBe('1:23 h');
    expect(formatDuration(7384)).toBe('2:03:04');
    expect(formatDuration(184)).toBe('3:04');
    expect(formatRelative('2026-11-20T20:00:00Z', 'de', now)).toBe('vor 3 Tagen');
    expect(formatRelative('2026-11-20T20:00:00Z', 'en', now)).toBe('3 days ago');
    // In numbers, as the macOS app: "vor 1 Tag", not "gestern".
    expect(formatRelative(new Date(now.getTime() - 86_400_000), 'de', now)).toBe('vor 1 Tag');
  });
});

describe('players in the navigation', () => {
  const play = (login: string) => ({
    type: 'open' as const,
    route: { kind: 'play' as const, target: { kind: 'live' as const, login } },
  });

  it('replaces a player on top and keeps each player once in the stack', () => {
    let state: NavigationState = initialNavigation;
    state = navigate(state, play('a'));
    state = navigate(state, play('b'));
    expect(state.path).toHaveLength(1);
    state = navigate(state, { type: 'open', route: { kind: 'channel', login: 'b' } });
    state = navigate(state, play('A'));
    expect(state.path.map((route) => route.kind)).toEqual(['play', 'channel', 'play']);
    state = navigate(state, { type: 'open', route: { kind: 'channel', login: 'c' } });
    state = navigate(state, play('b'));
    // The same player further down leaves the stack.
    expect(state.path.filter((route) => route.kind === 'play')).toHaveLength(2);
    expect(state.path.at(-1)).toEqual({ kind: 'play', target: { kind: 'live', login: 'b' } });
  });
});
