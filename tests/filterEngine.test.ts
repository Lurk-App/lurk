// Cases of the macOS app's self-test "Filter-Engine (uBO-Syntax)" (lurk-macos,
// Sources/Lurk/SelfTest.swift) and a few more for the parts the settings tab shows.

import { describe, expect, it } from 'vitest';
import {
  FilterEngine,
  builtInFilterList,
  classifyRequest,
  maxFilterLineLength,
  regexFromArgument,
  splitArguments,
} from '../src/shared/filterEngine';
import { builtInPruneRules, HlsPruner } from '../src/shared/hlsPruner';

const sample = `! Kommentar
||ads.example.com^
@@||ads.example.com/ok^
||track.example.com^$important
@@||track.example.com^
/\\/beacon\\?id=\\d+/$ping
|https://cdn.example.com/*.gif|$image
example.org##.banner
twitch.tv##+js(set-constant, a, b)
||x.example^$redirect=noop.js`;

describe('the filter engine (uBO syntax)', () => {
  const engine = new FilterEngine([sample]);

  it('decides as uBO: hosts, exceptions, $important, regex, types, anchors', () => {
    expect(engine.decide('https://ads.example.com/a.js').kind).toBe('block');
    expect(engine.decide('https://sub.ads.example.com/x').kind).toBe('block');
    expect(engine.decide('https://notads.example.com/')).toEqual({ kind: 'none' });
    expect(engine.decide('https://ads.example.com/ok/1')).toEqual({ kind: 'allow', rule: '@@||ads.example.com/ok^' });
    expect(engine.decide('https://track.example.com/x')).toEqual({
      kind: 'block',
      rule: '||track.example.com^$important',
    });
    expect(engine.decide('https://e.example/beacon?id=12', 'ping').kind).toBe('block');
    expect(engine.decide('https://e.example/beacon?id=12', 'xhr')).toEqual({ kind: 'none' });
    expect(engine.decide('https://cdn.example.com/a/b.gif', 'image').kind).toBe('block');
    expect(engine.decide('https://cdn.example.com/a/b.gif?x', 'image')).toEqual({ kind: 'none' });
  });

  it('skips what Lurk cannot use and says why', () => {
    expect(engine.ignoredCosmetic).toBe(1);
    expect(engine.issues.map((issue) => [issue.line, issue.reason])).toEqual([
      [9, { kind: 'scriptlet', name: 'set-constant' }],
      [10, { kind: 'option', name: 'redirect=noop.js' }],
    ]);
  });

  it('reports types that never occur, broken patterns and lines that are too long', () => {
    const other = new FilterEngine([
      `||a.example^$script\n/(unclosed/\ntwitch.tv##+js(m3u-prune, /(/, .m3u8)\n||b.example^$~script\nexample.com##+js(m3u-prune, /x/, .m3u8)\n${'a'.repeat(maxFilterLineLength + 1)}`,
    ]);
    expect(other.issues.map((issue) => issue.reason.kind)).toEqual(['type', 'pattern', 'regex', 'tooLong']);
    expect(other.networkRules.map((rule) => rule.text)).toEqual(['||b.example^$~script']);
    expect(other.ignoredOtherSites).toBe(1);
  });

  it('splits scriptlet arguments as uBO does', () => {
    expect(splitArguments('m3u-prune, /a\\,b/, .m3u8')).toEqual(['m3u-prune', '/a,b/', '.m3u8']);
  });

  it('reads arguments as regular expressions or literal text', () => {
    expect(regexFromArgument('/^x/gm')).toMatchObject({ isMultiline: true, isGlobal: true });
    const literal = regexFromArgument('.m3u8')!;
    expect(literal.pattern.test('https://x/playlist.m3u8?a')).toBe(true);
    expect(regexFromArgument('a*b')!.pattern.test('a-long-b')).toBe(true);
    expect(regexFromArgument('/[/')).toBeNull();
  });

  it('classifies Lurk\u2019s requests', () => {
    expect(classifyRequest('wss://irc-ws.chat.twitch.tv/')).toBe('websocket');
    expect(classifyRequest('https://video-edge.example/v1/segment/abc')).toBe('media');
    expect(classifyRequest('https://static-cdn.jtvnw.net/x')).toBe('image');
    expect(classifyRequest('https://usher.ttvnw.net/api/channel/hls/x.m3u8')).toBe('xhr');
    expect(classifyRequest('https://gql.twitch.tv/gql')).toBe('xhr');
    expect(classifyRequest('https://example.com/')).toBe('other');
    expect(classifyRequest('not a url')).toBe('other');
  });
});

describe('the built-in list', () => {
  const standard = new FilterEngine([builtInFilterList]);

  it('reads without problems: 2 playlist rules and 8 servers', () => {
    expect(standard.issues).toEqual([]);
    expect(standard.pruneRules).toHaveLength(2);
    expect(standard.networkRules).toHaveLength(8);
    expect(standard.ruleCount).toBe(10);
    expect(standard.decide('https://spade.twitch.tv/track').kind).toBe('block');
    expect(standard.decide('https://gql.twitch.tv/gql')).toEqual({ kind: 'none' });
  });

  it('has the same playlist rules the pruner used so far', () => {
    const rules = standard.pruneRulesFor('https://example.ttvnw.net/v1/playlist/abc.m3u8');
    expect(rules.map((rule) => rule.pattern.source)).toEqual(builtInPruneRules.map((rule) => rule.pattern.source));
    expect(standard.pruneRulesFor('https://example.com/other.json')).toEqual([]);
  });

  it('removes ad segments through the pruner, video segments stay', () => {
    const rules = standard.pruneRulesFor('https://x.ttvnw.net/a.m3u8');
    const playlist = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:2',
      '#EXT-X-MEDIA-SEQUENCE:10',
      '#EXTINF:2.000,live',
      'https://cdn.example/a10.ts',
      '#EXTINF:2.000,Amazon|42',
      'https://cdn.example/x11.ts',
      '#EXTINF:2.000,',
      'https://cdn.example/v12.ts',
    ].join('\n');
    const result = new HlsPruner().prune(playlist, 'https://x.ttvnw.net/a.m3u8', rules);
    expect(result.text).toContain('a10.ts');
    expect(result.text).not.toContain('x11.ts');
    expect(result.text).toContain('v12.ts');
    expect(result.report.removedSegments).toBe(1);
  });
});

describe('what the player reports', () => {
  it('takes only well-formed reports', async () => {
    const { parseBlockerEvent, normalizeTotals, adTimeParts, totalsAreEmpty, emptyTotals } =
      await import('../src/shared/blocker');
    expect(parseBlockerEvent({ kind: 'skipStart' })).toEqual({ kind: 'skipStart' });
    expect(parseBlockerEvent({ kind: 'skipEnd', channel: ' Kanal ', seconds: 31.5 })).toEqual({
      kind: 'skipEnd',
      channel: 'Kanal',
      seconds: 31.5,
    });
    expect(parseBlockerEvent({ kind: 'prune', channel: 'K', segments: 3, seconds: 6, rule: 'x' })).toMatchObject({
      segments: 3,
    });
    expect(parseBlockerEvent({ kind: 'prune', channel: 'K', segments: 0, seconds: 6, rule: 'x' })).toBeNull();
    expect(parseBlockerEvent({ kind: 'prune', channel: 'K', segments: 1.5, seconds: 6, rule: 'x' })).toBeNull();
    expect(parseBlockerEvent({ kind: 'skipEnd', channel: '', seconds: 3 })).toBeNull();
    expect(parseBlockerEvent({ kind: 'skipEnd', channel: 'K', seconds: -1 })).toBeNull();
    expect(parseBlockerEvent({ kind: 'other' })).toBeNull();
    expect(normalizeTotals({ adBreaks: 3, adSeconds: 'x', blockedRequests: -2 })).toEqual({
      adBreaks: 3,
      adSeconds: 0,
      adSegments: 0,
      blockedRequests: 0,
    });
    expect(totalsAreEmpty(emptyTotals)).toBe(true);
    expect(adTimeParts(12.4)).toEqual({ seconds: 12 });
    expect(adTimeParts(185)).toEqual({ hours: 0, minutes: 3 });
    expect(adTimeParts(3900)).toEqual({ hours: 1, minutes: 5 });
  });
});
