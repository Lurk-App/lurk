import { describe, expect, it } from 'vitest';
import { parseTwitchLink, twitchUrl } from '@shared/links';
import type { ChannelInfo } from '@shared/models';
import { buildSuggestions, channelScore, emptySearchContext, moveHighlight, type SearchContext } from '@shared/search';
import { applyPatch, defaultSettings, normalizeSettings } from '@shared/settings';

function channel(login: string, options: { viewers?: number; followers?: number; id?: string } = {}): ChannelInfo {
  return {
    ref: { id: options.id ?? login, login, displayName: login, profileImageURL: null },
    followers: options.followers ?? null,
    stream:
      options.viewers === undefined
        ? null
        : { id: `s-${login}`, title: 'Live', viewersCount: options.viewers, game: null },
  };
}

describe('twitch.tv links', () => {
  it('recognises channels, videos and clips like the macOS app', () => {
    expect(parseTwitchLink('https://www.twitch.tv/GronkhTV')).toEqual({ kind: 'channel', login: 'gronkhtv' });
    expect(parseTwitchLink('twitch.tv/gronkh')).toEqual({ kind: 'channel', login: 'gronkh' });
    expect(parseTwitchLink('https://www.twitch.tv/videos/123456')).toEqual({ kind: 'vod', id: '123456' });
    expect(parseTwitchLink('https://www.twitch.tv/gronkh/video/987')).toEqual({ kind: 'vod', id: '987' });
    expect(parseTwitchLink('https://clips.twitch.tv/FunnySlug')).toEqual({ kind: 'clip', slug: 'FunnySlug' });
    expect(parseTwitchLink('https://clips.twitch.tv/embed?clip=Embedded')).toEqual({ kind: 'clip', slug: 'Embedded' });
    expect(parseTwitchLink('https://www.twitch.tv/gronkh/clip/Other')).toEqual({ kind: 'clip', slug: 'Other' });
  });

  it('ignores pages that are not channels and other hosts', () => {
    expect(parseTwitchLink('https://www.twitch.tv/directory/category/minecraft')).toBeNull();
    expect(parseTwitchLink('https://www.twitch.tv/settings')).toBeNull();
    expect(parseTwitchLink('https://twitch.tv.evil.example/gronkh')).toBeNull();
    expect(parseTwitchLink('gronkh')).toBeNull();
    expect(parseTwitchLink('https://www.twitch.tv/')).toBeNull();
  });

  it('builds the twitch.tv address back', () => {
    expect(twitchUrl({ kind: 'channel', login: 'gronkh' })).toBe('https://www.twitch.tv/gronkh');
    expect(twitchUrl({ kind: 'vod', id: '1' })).toBe('https://www.twitch.tv/videos/1');
  });
});

describe('suggestions', () => {
  it('orders exact match first, then live and popular channels', () => {
    const remote = {
      channels: [
        channel('gronkhtv', { viewers: 1447, followers: 500_000 }),
        channel('gronky', { followers: 88_490 }),
        channel('gronkh', { followers: 1_800_000 }),
      ],
      categories: [{ id: '1', name: 'Gronk', displayName: 'Gronk', boxArtURL: null, viewersCount: 10 }],
    };
    const list = buildSuggestions('gronkh', remote);
    expect(list.map((s) => s.kind)).toEqual(['channel', 'channel', 'channel', 'category', 'all']);
    expect(list[0]?.kind === 'channel' && list[0].channel.ref.login).toBe('gronkh');
    expect(list[1]?.kind === 'channel' && list[1].channel.ref.login).toBe('gronkhtv');
    expect(list.at(-1)).toMatchObject({ kind: 'all', term: 'gronkh' });
  });

  it('puts subscribed channels ahead and shows them before Twitch answers', () => {
    const subscribed = channel('gronky', { id: 'sub' });
    const context: SearchContext = {
      subscriptions: [subscribed],
      isSubscribed: (id) => id === 'sub',
      watchSeconds: () => 0,
    };
    const early = buildSuggestions('gron', undefined, context);
    expect(early.map((s) => s.kind)).toEqual(['channel', 'all']);
    expect(early[0]).toMatchObject({ kind: 'channel', subscribed: true });
    expect(channelScore(subscribed, 'gron', context)).toBeGreaterThan(
      channelScore(subscribed, 'gron', emptySearchContext),
    );
  });

  it('offers a pasted link first and no "all results" then', () => {
    const list = buildSuggestions('https://www.twitch.tv/gronkh', { channels: [], categories: [] });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'link', link: { kind: 'channel', login: 'gronkh' } });
  });

  it('keeps at most six channels and three categories', () => {
    const many = Array.from({ length: 10 }, (_, i) => channel(`abc${i}`));
    const games = Array.from({ length: 5 }, (_, i) => ({
      id: `${i}`,
      name: 'g',
      displayName: 'g',
      boxArtURL: null,
      viewersCount: null,
    }));
    const list = buildSuggestions('abc', { channels: many, categories: games });
    expect(list.filter((s) => s.kind === 'channel')).toHaveLength(6);
    expect(list.filter((s) => s.kind === 'category')).toHaveLength(3);
    expect(buildSuggestions('   ', undefined)).toEqual([]);
  });

  it('moves the highlight with wrap-around', () => {
    expect(moveHighlight(null, 1, 3)).toBe(0);
    expect(moveHighlight(null, -1, 3)).toBe(2);
    expect(moveHighlight(2, 1, 3)).toBe(0);
    expect(moveHighlight(0, -1, 3)).toBe(2);
    expect(moveHighlight(null, 1, 0)).toBeNull();
  });
});

describe('settings', () => {
  it('falls back to the defaults for missing or broken values', () => {
    expect(normalizeSettings(undefined)).toEqual(defaultSettings);
    expect(normalizeSettings({ appearance: { mode: 'sepia', tone: 'neutral', accent: 'gold' } })).toEqual({
      appearance: { mode: 'dark', tone: 'neutral', accent: 'violet' },
      player: defaultSettings.player,
      browse: defaultSettings.browse,
      privacy: defaultSettings.privacy,
      blocker: defaultSettings.blocker,
    });
    // The ad blocker is on unless it was switched off.
    expect(normalizeSettings({ blocker: { enabled: 'no' } }).blocker.enabled).toBe(true);
    expect(applyPatch(defaultSettings, { blocker: { enabled: false } }).blocker.enabled).toBe(false);
  });

  it('applies valid changes and ignores invalid ones', () => {
    const light = applyPatch(defaultSettings, { appearance: { mode: 'light', accent: '#ffe066' } });
    expect(light.appearance).toEqual({ mode: 'light', tone: 'graphite', accent: '#FFE066' });
    expect(applyPatch(light, { appearance: { tone: 'beige' } })).toEqual(light);
    expect(applyPatch(light, { other: 1 })).toBe(light);
  });
});
