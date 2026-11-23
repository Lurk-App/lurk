import { describe, expect, it } from 'vitest';
import { adStep, candidateIsClear, otherSourceIsClear, pickClipSlugs, switchStep } from '../src/shared/adBreaks';
import { parseBlockerEvent } from '../src/shared/blocker';
import { parseMedia } from '../src/shared/m3u8';
import { normalizeSettings } from '../src/shared/settings';

const start = Date.parse('2026-11-23T20:00:00.000Z');

/** A live playlist of 2 s segments: "c" real content, "a" an ad (with Twitch's ad marker). */
function playlist(pattern: string, adDuration: number | null = 30) {
  const lines = ['#EXTM3U', '#EXT-X-TARGETDURATION:2', '#EXT-X-MEDIA-SEQUENCE:1'];
  const firstAd = pattern.indexOf('a');
  if (firstAd >= 0) {
    const at = new Date(start + firstAd * 2000).toISOString();
    lines.push(
      `#EXT-X-DATERANGE:ID="stitched-ad-1",CLASS="twitch-stitched-ad",START-DATE="${at}"${
        adDuration === null ? '' : `,DURATION=${adDuration}`
      }`,
    );
  }
  [...pattern].forEach((kind, index) => {
    lines.push(`#EXT-X-PROGRAM-DATE-TIME:${new Date(start + index * 2000).toISOString()}`);
    lines.push(`#EXTINF:2.000,${kind === 'a' ? 'Amazon|1' : 'live'}`);
    lines.push(`https://edge.example/${kind}${index}.ts`);
  });
  return parseMedia(lines.join('\n'), 'https://edge.example/index.m3u8');
}

const now = start + 60_000;
const fresh = (pattern: string) => ({ playlist: playlist(pattern), readAt: now - 1000 });

describe('ad breaks while playing', () => {
  it('waits while playback has not reached the ad yet', () => {
    const step = adStep({
      hiding: false,
      playing: playlist('ccccaa'),
      other: null,
      playbackDate: start + 3 * 2000,
      paused: false,
      now,
    });
    expect(step).toEqual({ action: 'none' });
  });

  it('hides once playback reaches the ad, with its expected end', () => {
    const step = adStep({
      hiding: false,
      playing: playlist('ccccaa'),
      other: null,
      playbackDate: start + 8 * 1000 - 100,
      paused: false,
      now,
    });
    expect(step).toEqual({ action: 'hide', until: start + 8000 + 30_000 });
  });

  it('switches to the other source instead when it has real content at its edge', () => {
    const step = adStep({
      hiding: false,
      playing: playlist('ccccaa'),
      other: fresh('cccccccc'),
      playbackDate: start + 8000,
      paused: false,
      now,
    });
    expect(step).toEqual({ action: 'switch' });
  });

  it('does not trust another source with ads, too little content or an old read', () => {
    expect(otherSourceIsClear(fresh('ccccca'), now)).toBe(false);
    expect(otherSourceIsClear(fresh('aaaccc'), now)).toBe(false);
    expect(otherSourceIsClear({ playlist: playlist('cccccccc'), readAt: now - 11_000 }, now)).toBe(false);
    expect(otherSourceIsClear(null, now)).toBe(false);
    expect(otherSourceIsClear(fresh('cccccccc'), now)).toBe(true);
  });

  it('keeps hiding while the break runs, and updates its end', () => {
    const step = adStep({
      hiding: true,
      playing: playlist('ccaaaa', 40),
      other: null,
      playbackDate: null,
      paused: true,
      now,
    });
    expect(step).toEqual({ action: 'update', until: start + 4000 + 40_000 });
  });

  it('goes on once the live edge has 6 s of real content again (after the marked break)', () => {
    expect(
      adStep({ hiding: true, playing: playlist('aaaacc', 8), other: null, playbackDate: null, paused: true, now }),
    ).toMatchObject({ action: 'update' });
    expect(
      adStep({ hiding: true, playing: playlist('aaaccc', 6), other: null, playbackDate: null, paused: true, now }),
    ).toEqual({ action: 'resume' });
  });

  it('goes on from the other source while hiding, when that one is clear', () => {
    expect(
      adStep({
        hiding: true,
        playing: playlist('ccaaaa'),
        other: fresh('cccccccc'),
        playbackDate: null,
        paused: true,
        now,
      }),
    ).toEqual({ action: 'resumeAndSwitch' });
  });

  it('does nothing without a playlist or without an ad', () => {
    expect(adStep({ hiding: false, playing: null, other: null, playbackDate: null, paused: false, now })).toEqual({
      action: 'none',
    });
    expect(
      adStep({ hiding: false, playing: playlist('cccccc'), other: null, playbackDate: null, paused: false, now }),
    ).toEqual({ action: 'none' });
  });
});

describe('clips while ads are skipped', () => {
  const clips = Array.from({ length: 14 }, (_, index) => ({ slug: `c${index}`, viewCount: 100 - index }));

  it('picks among the ten most viewed, none twice until all were seen', () => {
    const first = pickClipSlugs(clips, new Set(), () => 0.5);
    expect(first).toHaveLength(3);
    expect(first.every((slug) => Number(slug.slice(1)) < 10)).toBe(true);
    const played = new Set(clips.slice(0, 9).map((clip) => clip.slug));
    expect(pickClipSlugs(clips, played)).toEqual(['c9']);
    const all = new Set(clips.slice(0, 10).map((clip) => clip.slug));
    expect(pickClipSlugs(clips, all)).toHaveLength(3);
    expect(pickClipSlugs([], new Set())).toEqual([]);
  });

  it('reads the switch for the clips and the second-source report', () => {
    expect(normalizeSettings({}).blocker.adFillClips).toBe(true);
    expect(normalizeSettings({ blocker: { adFillClips: false } }).blocker.adFillClips).toBe(false);
    expect(parseBlockerEvent({ kind: 'switch', channel: 'Kanal' })).toEqual({ kind: 'switch', channel: 'Kanal' });
    expect(parseBlockerEvent({ kind: 'switch' })).toBeNull();
  });
});

describe('the ad-break switch', () => {
  const candidate = (id: string, pattern: string, options: { readAt?: number; adSeconds?: number } = {}) => ({
    id,
    watched: { playlist: playlist(pattern, options.adSeconds ?? 30), readAt: options.readAt ?? now - 1000 },
  });
  const base = {
    showing: null,
    candidates: [] as ReturnType<typeof candidate>[],
    noAlternative: false,
    otherSourceClear: false,
    hiding: false,
    playbackDate: null,
    paused: false,
    now,
  };

  it('shows the first clear candidate once playback reaches the ad', () => {
    const candidates = [candidate('1', 'cccccccccccc'), candidate('2', 'cccccccccccc')];
    expect(switchStep({ ...base, primary: playlist('ccccaa'), candidates, playbackDate: start + 2000 })).toEqual({
      action: 'none',
    });
    expect(switchStep({ ...base, primary: playlist('ccccaa'), candidates, playbackDate: start + 7600 })).toEqual({
      action: 'show',
      candidate: '1',
      until: start + 8000 + 30_000,
    });
  });

  it('leaves it to the second source when that is clear, and says when no channel is clear', () => {
    const candidates = [candidate('1', 'ccccccccccca')];
    expect(switchStep({ ...base, primary: playlist('ccccaa'), candidates, otherSourceClear: true })).toEqual({
      action: 'none',
    });
    expect(switchStep({ ...base, primary: playlist('ccccaa'), candidates })).toEqual({
      action: 'noAlternative',
      until: start + 8000 + 30_000,
    });
    expect(switchStep({ ...base, primary: playlist('cccccccccccc'), noAlternative: true })).toEqual({ action: 'idle' });
  });

  it('a candidate needs 20 s without ads and a fresh read', () => {
    expect(candidateIsClear(candidate('1', 'cccccccccccc'), now)).toBe(true);
    // An ad 14 s back: not clear yet (a playlist without any ad counts as clear, as on macOS).
    expect(candidateIsClear(candidate('1', 'caccccccc', { adSeconds: 2 }), now)).toBe(false);
    expect(candidateIsClear(candidate('1', 'cccccccccccc', { readAt: now - 11_000 }), now)).toBe(false);
  });

  it('returns once the playing channel is ad-free for 20 s, goes on to the next when the shown one gets an ad', () => {
    const clear = candidate('1', 'cccccccccccc');
    expect(switchStep({ ...base, primary: playlist('aacccccccccccc', 4), showing: '1', candidates: [clear] })).toEqual({
      action: 'return',
    });
    expect(switchStep({ ...base, primary: playlist('ccaaaa'), showing: '1', candidates: [clear] })).toMatchObject({
      action: 'update',
    });
    const busy = candidate('1', 'cccccccccaaa');
    const next = candidate('2', 'cccccccccccc');
    expect(switchStep({ ...base, primary: playlist('ccaaaa'), showing: '1', candidates: [busy, next] })).toMatchObject({
      action: 'show',
      candidate: '2',
    });
    expect(switchStep({ ...base, primary: playlist('ccaaaa'), showing: '1', candidates: [busy] })).toEqual({
      action: 'return',
    });
    const silent = candidate('1', 'cccccccccccc', { readAt: now - 20_000 });
    expect(switchStep({ ...base, primary: playlist('ccaaaa'), showing: '1', candidates: [silent] })).toEqual({
      action: 'return',
    });
  });

  it('switches a hidden break too', () => {
    const candidates = [candidate('1', 'cccccccccccc')];
    expect(
      switchStep({ ...base, primary: playlist('ccaaaa'), candidates, hiding: true, playbackDate: start }),
    ).toMatchObject({ action: 'show', candidate: '1' });
  });
});

describe('watch time', () => {
  it('adds, ranks and picks the candidates', async () => {
    const { addWatchTime, adSwitchCandidates, watchRanking, watchTimeParts, normalizeLibrary } =
      await import('../src/shared/library');
    const sub = (id: string, name: string) => ({
      id,
      login: name,
      displayName: name,
      profileImageURL: null,
      addedAt: '',
    });
    const subscriptions = [sub('1', 'a'), sub('2', 'b'), sub('3', 'c'), sub('4', 'd')];
    let watched = addWatchTime({}, '2', 5);
    watched = addWatchTime(watched, '2', 5);
    watched = addWatchTime(watched, '3', 600);
    watched = addWatchTime(watched, 'x', 5);
    expect(watched).toEqual({ '2': 10, '3': 600 });
    expect(
      watchRanking(subscriptions, watched)
        .map((entry) => entry.subscription.id)
        .slice(0, 2),
    ).toEqual(['3', '2']);
    const live = (id: string, viewers: number) => ({
      ref: { id, login: id, displayName: id, profileImageURL: null },
      stream: { id: `s${id}`, title: '', viewersCount: viewers, game: null } as never,
      lastLiveAt: null,
    });
    const statuses = { '1': live('1', 900), '2': live('2', 10), '3': live('3', 20), '4': live('4', 5000) };
    expect(adSwitchCandidates(subscriptions, statuses, watched, '3').map((ref) => ref.id)).toEqual(['2', '4', '1']);
    expect(watchTimeParts(59)).toEqual({ underAMinute: true });
    expect(watchTimeParts(3900)).toEqual({ hours: 1, minutes: 5 });
    expect(normalizeLibrary({ watchTime: { '5': 30, bad: 3, '6': -1 } }).watchTime).toEqual({ '5': 30 });
  });
});
