// The same cases as the macOS self-test ("M3U8-Parser", "Werbeerkennung in der Playlist",
// "HLS-Werbefilter (m3u-prune) mit stabilen Nummern"), so both ports compute the same thing.

import { describe, expect, it } from 'vitest';
import { HlsPruner } from '@shared/hlsPruner';
import {
  currentAdStart,
  edgeHasAd,
  estimatedAdEnd,
  isAdFree,
  parseMaster,
  parseMedia,
  pickVariant,
} from '@shared/m3u8';
import { waitForPreroll } from '@shared/preroll';

describe('M3U8 parser', () => {
  it('reads variants in the right order', () => {
    const sample = `#EXTM3U
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="chunked",NAME="1080p60 (source)",AUTOSELECT=YES,DEFAULT=YES
#EXT-X-STREAM-INF:BANDWIDTH=8226154,RESOLUTION=1920x1080,CODECS="avc1.64002A,mp4a.40.2",VIDEO="chunked",FRAME-RATE=60.000
https://example.com/source.m3u8
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="audio_only",NAME="Audio Only",AUTOSELECT=NO,DEFAULT=NO
#EXT-X-STREAM-INF:BANDWIDTH=160000,CODECS="mp4a.40.2",VIDEO="audio_only"
https://example.com/audio.m3u8
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="720p60",NAME="720p60",AUTOSELECT=YES,DEFAULT=YES
#EXT-X-STREAM-INF:BANDWIDTH=3422999,RESOLUTION=1280x720,CODECS="avc1.4D401F,mp4a.40.2",VIDEO="720p60",FRAME-RATE=60.000
https://example.com/720.m3u8`;
    const variants = parseMaster(sample, 'https://example.com/master.m3u8');
    expect(variants.map((v) => v.name)).toEqual(['1080p60', '720p60', 'audio_only']);
    expect(variants[0]!.isSource).toBe(true);
    expect(variants[0]!.height).toBe(1080);
    expect(pickVariant(variants, 720)?.name).toBe('720p60');
    expect(pickVariant(variants, 360)?.name).toBe('720p60');
  });
});

const adSample = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:100
#EXT-X-DATERANGE:ID="stitched-ad-1",CLASS="twitch-stitched-ad",START-DATE="2026-11-11T20:00:04.000Z",DURATION=30.000
#EXT-X-PROGRAM-DATE-TIME:2026-11-11T20:00:00.000Z
#EXTINF:2.000,live
https://example.com/100.ts
#EXTINF:2.000,live
https://example.com/101.ts
#EXT-X-DISCONTINUITY
#EXT-X-PROGRAM-DATE-TIME:2026-11-11T20:00:04.000Z
#EXTINF:2.000,Amazon|123
https://example.com/102.ts
#EXTINF:2.000,Amazon|123
https://example.com/103.ts`;

describe('ad detection', () => {
  it('finds ad segments, start and end', () => {
    const playlist = parseMedia(adSample, 'https://example.com/a.m3u8');
    expect(playlist.segments.map((s) => s.sequence)).toEqual([100, 101, 102, 103]);
    expect(playlist.segments.map((s) => s.isAd)).toEqual([false, false, true, true]);
    expect(edgeHasAd(playlist)).toBe(true);
    expect(isAdFree(playlist, 4)).toBe(false);
    expect(currentAdStart(playlist)).toBe(Date.parse('2026-11-11T20:00:04.000Z'));
    expect(estimatedAdEnd(playlist)).toBe(Date.parse('2026-11-11T20:00:34.000Z'));
    const clean = parseMedia(
      adSample.replaceAll('Amazon|123', 'live').replaceAll('twitch-stitched-ad', 'x').replaceAll('stitched-ad-1', 'y'),
      'https://example.com/a.m3u8',
    );
    expect(isAdFree(clean, 8)).toBe(true);
    expect(edgeHasAd(clean)).toBe(false);
  });
});

function playlist(sequence: number, entries: [string, string][], discontinuityBefore: string[] = []): string {
  let text = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:${sequence}\n`;
  text +=
    '#EXT-X-DATERANGE:ID="stitched-ad-1",CLASS="twitch-stitched-ad",START-DATE="2026-11-11T20:00:00Z",DURATION=6.0\n';
  for (const [title, uri] of entries) {
    if (discontinuityBefore.includes(uri)) text += '#EXT-X-DISCONTINUITY\n';
    text += `#EXT-X-PROGRAM-DATE-TIME:2026-11-11T20:00:00.000Z\n#EXTINF:2.000,${title}\nhttps://cdn.example/${uri}.ts\n`;
  }
  return text;
}
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const live = (from: number, to: number): [string, string][] => range(from, to).map((n) => ['live', `a${n}`]);
const ads = (from: number, to: number): [string, string][] => range(from, to).map((n) => ['Amazon|42', `x${n}`]);
const base = 'https://example.ttvnw.net/v1/playlist/abc.m3u8';

describe('HLS ad filter (m3u-prune) with stable numbers', () => {
  it('removes ads, keeps numbers stable, marks the cut and is never empty', () => {
    const pruner = new HlsPruner();
    const inputs = [
      playlist(100, live(100, 104)),
      playlist(102, [...live(102, 104), ...ads(105, 107)], ['x105']),
      playlist(105, [...ads(105, 107), ...live(108, 110)], ['x105', 'a108']),
      playlist(107, [...ads(107, 107), ...live(108, 112)], ['a108']),
      playlist(110, live(110, 114)),
    ];
    const virtualOf = new Map<string, number>();
    let lastSequence = Number.MIN_SAFE_INTEGER;
    let removed = 0;
    let breaks = 0;
    const outputs: string[] = [];
    for (const input of inputs) {
      const result = pruner.prune(input, base);
      removed += result.report.removedSegments;
      breaks += result.report.startedBreak ? 1 : 0;
      outputs.push(result.text);
      const lines = result.text.split('\n');
      const sequence = Number.parseInt(lines.find((l) => l.startsWith('#EXT-X-MEDIA-SEQUENCE:'))!.slice(22), 10);
      expect(sequence).toBeGreaterThanOrEqual(lastSequence);
      lastSequence = sequence;
      expect(result.text).not.toContain('/x1');
      expect(result.text).not.toContain('Amazon');
      expect(result.text).not.toContain('stitched-ad');
      const uris = lines.filter((l) => l.startsWith('https://'));
      expect(uris.length).toBeGreaterThan(0);
      uris.forEach((uri, offset) => {
        const name = uri.split('/').at(-1)!.slice(0, -3);
        const known = virtualOf.get(name);
        if (known !== undefined) expect(known).toBe(sequence + offset);
        virtualOf.set(name, sequence + offset);
      });
    }
    expect(virtualOf.get('a108')).toBe((virtualOf.get('a104') ?? 0) + 1);
    expect(outputs[2]).toContain(
      '#EXT-X-DISCONTINUITY\n#EXT-X-PROGRAM-DATE-TIME:2026-11-11T20:00:00.000Z\n#EXTINF:2.000,live\nhttps://cdn.example/a108.ts',
    );
    expect(outputs[4]).toContain('#EXT-X-DISCONTINUITY-SEQUENCE:1');
    expect(outputs[4]).not.toContain('#EXT-X-DISCONTINUITY\n');
    expect(removed).toBe(3);
    expect(breaks).toBe(1);
    expect(new HlsPruner().prune(playlist(200, ads(200, 203)), base).isEmpty).toBe(true);
  });

  it('removes only the pre-roll in leading-only mode (the macOS app mode)', () => {
    const leading = new HlsPruner(true);
    const start = leading.prune(playlist(300, [...ads(300, 302), ...live(303, 305)], ['a303']), base);
    expect(start.text).not.toContain('/x30');
    expect(start.text).toContain('#EXT-X-MEDIA-SEQUENCE:303');
    const later = leading.prune(playlist(304, [...live(304, 306), ...ads(307, 307)]), base);
    expect(later.text).toContain('/x307');
    expect(later.text).toContain('#EXT-X-MEDIA-SEQUENCE:304');
  });
});

describe('pre-roll wait', () => {
  it('starts at once without an ad and waits for two content segments after one', async () => {
    const clean = adSample
      .replaceAll('Amazon|123', 'live')
      .replaceAll('twitch-stitched-ad', 'x')
      .replaceAll('stitched-ad-1', 'y');
    const noAd = await waitForPreroll('https://example.com/a.m3u8', {
      fetchText: async () => ({ status: 200, text: clean }),
      sleep: async () => {},
    });
    expect(noAd.waitedSeconds).toBeNull();
    expect(noAd.rounds).toBe(1);

    // Ad for three rounds, then one content segment (not enough), then two.
    const oneLive = adSample.replace('Amazon|123\nhttps://example.com/103.ts', 'live\nhttps://example.com/103.ts');
    const answers = [adSample, adSample, adSample, oneLive, clean];
    let clock = 0;
    const withAd = await waitForPreroll('https://example.com/a.m3u8', {
      fetchText: async () => ({ status: 200, text: answers.shift() ?? clean }),
      sleep: async (seconds) => {
        clock += seconds * 1000;
      },
      now: () => clock,
    });
    expect(withAd.rounds).toBe(5);
    expect(withAd.waitedSeconds).not.toBeNull();
    expect(withAd.expectedEnd).toBe(Date.parse('2026-11-11T20:00:34.000Z'));
  });
});

describe('videos (VODs)', () => {
  it('keeps untitled video segments: only titled ones that are not "live" are ads', () => {
    const vod = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:10',
      '#EXT-X-PLAYLIST-TYPE:EVENT',
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXTINF:10.000,',
      '0.ts',
      '#EXTINF:10.000,',
      '1.ts',
      '#EXTINF:8.051,',
      '2.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
    const result = new HlsPruner().prune(vod, 'https://example.cloudfront.net/x/chunked/index-dvr.m3u8');
    expect(result.text.match(/#EXTINF/g)).toHaveLength(3);
    expect(result.text).toContain('#EXT-X-ENDLIST');
  });
});
