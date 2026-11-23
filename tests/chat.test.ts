import { describe, expect, it } from 'vitest';
import { applyWordEmotes, chatColor, messageFrom, parseIrc, segmentsFor, unescapeTag } from '@shared/chat';
import { contrastRatio } from '@shared/theme';
import { decodeEmoteList, emoteListUrl, isEmoteImageUrl } from '@shared/thirdPartyEmotes';
import { parseHermes, parseRaid, subscribeMessage } from '@shared/raids';

describe('IRC lines', () => {
  it('reads tags (unescaped), prefix, command and the trailing text', () => {
    const irc = parseIrc(
      '@badge-info=;color=#1E90FF;display-name=Gast\\sEins;emotes=25:0-4;id=abc;room-id=42 :gast!gast@gast.tmi.twitch.tv PRIVMSG #kanal :Kappa hallo',
    );
    expect(irc).toMatchObject({
      command: 'PRIVMSG',
      params: ['#kanal'],
      trailing: 'Kappa hallo',
      prefix: 'gast!gast@gast.tmi.twitch.tv',
    });
    expect(irc?.tags['display-name']).toBe('Gast Eins');
    expect(irc?.tags['badge-info']).toBe('');
    expect(unescapeTag('a\\:b\\\\c')).toBe('a;b\\c');
    expect(parseIrc('PING :tmi.twitch.tv')).toMatchObject({ command: 'PING', trailing: 'tmi.twitch.tv' });
  });

  it('turns PRIVMSG, /me and USERNOTICE into messages', () => {
    const plain = messageFrom(parseIrc('@id=1;display-name=Anna;color= :anna!a@a PRIVMSG #k :hi Kappa')!);
    expect(plain).toMatchObject({ id: '1', login: 'anna', author: 'Anna', colorHex: null, isAction: false });
    const action = messageFrom(parseIrc('@id=2 :bob!b@b PRIVMSG #k :\u0001ACTION winkt\u0001')!);
    expect(action).toMatchObject({ author: 'bob', isAction: true, segments: [{ kind: 'text', text: 'winkt' }] });
    const sub = messageFrom(
      parseIrc('@id=3;login=cara;system-msg=cara\\shat\\sabonniert! :tmi.twitch.tv USERNOTICE #k :Danke!')!,
    );
    expect(sub?.isSystem).toBe(true);
    expect(sub?.segments.map((s) => (s.kind === 'text' ? s.text : s.name)).join('')).toBe(
      'cara hat abonniert! – Danke!',
    );
    expect(messageFrom(parseIrc(':tmi.twitch.tv 001 justinfan1 :Welcome')!)).toBeNull();
  });
});

describe('emotes', () => {
  it('cuts Twitch emotes by code points, also after emoji', () => {
    expect(segmentsFor('😀 Kappa x', '25:2-6')).toEqual([
      { kind: 'text', text: '😀 ' },
      { kind: 'emote', id: '25', name: 'Kappa' },
      { kind: 'text', text: ' x' },
    ]);
    expect(segmentsFor('Kappa Kappa', '25:0-4,6-10')).toHaveLength(3);
    expect(segmentsFor('short', '25:0-40')).toEqual([{ kind: 'text', text: 'short' }]);
  });

  it('replaces whole words with third-party emotes, idempotently', () => {
    const emotes = new Map([['OMEGALUL', 'bttv:1']]);
    const once = applyWordEmotes(emotes, [{ kind: 'text', text: 'so OMEGALUL wow' }]);
    expect(once).toEqual([
      { kind: 'text', text: 'so ' },
      { kind: 'emote', id: 'bttv:1', name: 'OMEGALUL' },
      { kind: 'text', text: ' wow' },
    ]);
    expect(applyWordEmotes(emotes, once)).toEqual(once);
    expect(applyWordEmotes(emotes, [{ kind: 'text', text: 'OMEGALULs' }])).toEqual([
      { kind: 'text', text: 'OMEGALULs' },
    ]);
  });

  it('reads the lists of BTTV, 7TV and FFZ', () => {
    expect(emoteListUrl('bttv', '42')).toBe('https://api.betterttv.net/3/cached/users/twitch/42');
    expect(
      decodeEmoteList('bttv', null, [
        { id: 'a', code: 'catJAM' },
        { id: 'm', code: 'h!', modifier: true },
      ]),
    ).toEqual([{ id: 'bttv:a', name: 'catJAM', url: 'https://cdn.betterttv.net/emote/a/2x' }]);
    expect(
      decodeEmoteList('bttv', '42', {
        channelEmotes: [{ id: 'b', code: 'one' }],
        sharedEmotes: [{ id: 'c', code: 'two' }],
      }),
    ).toHaveLength(2);
    expect(
      decodeEmoteList('7tv', '42', {
        emote_set: { emotes: [{ id: 'x', name: 'peepo', data: { host: { url: '//cdn.7tv.app/emote/x' } } }] },
      }),
    ).toEqual([{ id: '7tv:x', name: 'peepo', url: 'https://cdn.7tv.app/emote/x/2x.webp' }]);
    const ffz = {
      default_sets: [3],
      sets: {
        '3': {
          emoticons: [
            {
              id: 9,
              name: 'LilZ',
              urls: { '1': '//cdn.frankerfacez.com/emote/9/1', '2': '//cdn.frankerfacez.com/emote/9/2' },
            },
          ],
        },
        '4': { emoticons: [{ id: 10, name: 'Other', urls: { '1': '//cdn.frankerfacez.com/emote/10/1' } }] },
      },
    };
    expect(decodeEmoteList('ffz', null, ffz)).toEqual([
      { id: 'ffz:9', name: 'LilZ', url: 'https://cdn.frankerfacez.com/emote/9/2' },
    ]);
    expect(decodeEmoteList('ffz', '42', ffz)).toHaveLength(2);
    expect(decodeEmoteList('7tv', null, 'garbage')).toEqual([]);
    // Only the services' own image servers.
    expect(
      decodeEmoteList('7tv', '42', {
        emote_set: { emotes: [{ id: 'y', name: 'evil', data: { host: { url: '//tracker.example/e' } } }] },
      }),
    ).toEqual([]);
    expect(isEmoteImageUrl('https://cdn.betterttv.net/emote/a/2x')).toBe(true);
    expect(isEmoteImageUrl('http://cdn.betterttv.net/emote/a/2x')).toBe(false);
  });
});

describe('name colours', () => {
  it('lifts colours on dark and darkens them on light, like the macOS app', () => {
    // Brightness at least 0.82 on dark (saturation at most 0.75), at most 0.62 on light.
    expect(chatColor('#000000', 'x', true)).toBe('#D1D1D1');
    expect(chatColor('#0000FF', 'x', true)).toBe('#4040FF');
    expect(chatColor('#FFFF00', 'x', false)).toBe('#9E9E00');
    expect(chatColor(null, 'abc', true)).toBe(chatColor(null, 'abc', true));
    // Known weakness of the rule (kept as in the macOS app): pure blue stays dark on dark.
    expect(contrastRatio(chatColor('#0000FF', 'x', true), '#1B1820')).toBeLessThan(4.5);
  });
});

describe('raids', () => {
  it('reads update, go and cancel, and the Hermes envelopes', () => {
    const update = JSON.stringify({
      type: 'raid_update_v2',
      raid: { id: 'r', target_id: '7', target_login: 'ziel', target_display_name: 'Ziel', viewer_count: 120 },
    });
    expect(parseRaid(update)).toMatchObject({
      kind: 'update',
      id: 'r',
      viewers: 120,
      target: { login: 'ziel', displayName: 'Ziel' },
    });
    expect(
      parseRaid(JSON.stringify({ type: 'raid_go_v2', raid: { id: 'r', target_id: '7', target_login: 'ziel' } })),
    ).toMatchObject({ kind: 'go' });
    expect(parseRaid(JSON.stringify({ type: 'raid_cancel_v2', raid: { id: 'r' } }))).toEqual({
      kind: 'cancel',
      id: 'r',
    });
    expect(parseRaid('nope')).toBeNull();
    expect(parseHermes(JSON.stringify({ type: 'welcome', welcome: { keepaliveSec: 10 } }))).toEqual({
      kind: 'welcome',
      keepaliveSeconds: 10,
    });
    expect(parseHermes(JSON.stringify({ type: 'notification', notification: { pubsub: update } }))).toMatchObject({
      kind: 'event',
    });
    expect(JSON.parse(subscribeMessage('42', () => 'x', new Date(0)))).toMatchObject({
      subscribe: { pubsub: { topic: 'raid.42' } },
    });
  });
});
