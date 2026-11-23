// What the player does about an ad break in a running live stream, decided twice a second. Port of
// evaluateAdBlocking and otherSourceIsClear of the macOS app's PlayerModel (lurk-macos,
// Sources/Lurk/PlayerModel.swift):
// 1. the same stream from the other Twitch session (the second source) when it has real content,
// 2. otherwise the stream is hidden – a clip or the dimmed preview shows – until the live edge has
//    real content again. (The ad-break switch to a subscribed channel comes with part 7c.)
// Hidden only from the moment playback reaches the ad: what plays before it must not be lost.

import { currentAdStart, edgeHasAd, estimatedAdEnd, isAdFree, type MediaPlaylist } from './m3u8';

/** Real content the live edge needs before the hidden stream goes on. */
export const resumeContentSeconds = 6;
/** Real content the other source needs before Lurk switches to it. */
export const switchContentSeconds = 8;
/** Hiding begins this close to the ad's start (ms). */
export const hideLeadMs = 400;
/** A watched playlist older than this is not trusted (three missed reads of 3 s). */
export const freshForMs = 10_000;

export interface WatchedPlaylist {
  playlist: MediaPlaylist | null;
  /** When it was read (ms since epoch); 0 before the first read. */
  readAt: number;
}

export type AdStep =
  | { action: 'none' }
  | { action: 'hide'; until: number | null }
  | { action: 'update'; until: number | null }
  | { action: 'resume' }
  | { action: 'switch' }
  | { action: 'resumeAndSwitch' };

/** Has the other source enough real content at its live edge to take over? */
export function otherSourceIsClear(other: WatchedPlaylist | null, now: number): boolean {
  if (!other?.playlist || now - other.readAt > freshForMs) return false;
  return !edgeHasAd(other.playlist) && isAdFree(other.playlist, switchContentSeconds);
}

export function adStep(input: {
  hiding: boolean;
  /** The raw playlist of what plays (before the filter). */
  playing: MediaPlaylist | null;
  /** The other source's playlist, read in the background. */
  other: WatchedPlaylist | null;
  /** The time of the picture on screen (ms since epoch), from the playlist's dates. */
  playbackDate: number | null;
  paused: boolean;
  now: number;
}): AdStep {
  const { playing } = input;
  if (!playing) return { action: 'none' };
  const otherClear = otherSourceIsClear(input.other, input.now);
  if (input.hiding) {
    if (!edgeHasAd(playing) && isAdFree(playing, resumeContentSeconds)) return { action: 'resume' };
    if (otherClear) return { action: 'resumeAndSwitch' };
    return { action: 'update', until: estimatedAdEnd(playing) };
  }
  if (!edgeHasAd(playing)) return { action: 'none' };
  const start = currentAdStart(playing);
  if (start !== null && input.playbackDate !== null && !input.paused && input.playbackDate < start - hideLeadMs) {
    return { action: 'none' };
  }
  if (otherClear) return { action: 'switch' };
  return { action: 'hide', until: estimatedAdEnd(playing) };
}

/** A clip to play: random among the ten most viewed, none twice until all were seen. */
export function pickClipSlugs(
  clips: { slug: string; viewCount: number }[],
  played: Set<string>,
  random: () => number = Math.random,
  count = 3,
): string[] {
  const top = [...clips].sort((a, b) => b.viewCount - a.viewCount).slice(0, 10);
  let pool = top.filter((clip) => !played.has(clip.slug));
  // All seen: from the start again.
  if (pool.length === 0) pool = top;
  const shuffled = pool.map((clip) => ({ clip, key: random() })).sort((a, b) => a.key - b.key);
  return shuffled.slice(0, count).map((entry) => entry.clip.slug);
}

// MARK: The ad-break switch (part 7c)

/** A candidate's last seconds must be ad-free before Lurk shows it (the reference's isClear). */
export const candidateClearSeconds = 20;
/** The playing channel's last seconds must be ad-free before Lurk returns to it. */
export const returnClearSeconds = 20;
/** Switching begins this close to the ad's start (ms; the reference's 0.5 s). */
export const switchLeadMs = 500;

export interface SwitchCandidate {
  id: string;
  watched: WatchedPlaylist;
}

export type SwitchStep =
  | { action: 'none' }
  | { action: 'show'; candidate: string; until: number | null }
  | { action: 'return' }
  | { action: 'update'; until: number | null }
  | { action: 'noAlternative'; until: number | null }
  | { action: 'idle' };

/** A candidate that is read and has no ad in its last 20 s. */
export function candidateIsClear(candidate: SwitchCandidate, now: number): boolean {
  const { playlist, readAt } = candidate.watched;
  return playlist !== null && now - readAt <= freshForMs && isAdFree(playlist, candidateClearSeconds);
}

/**
 * The ad-break switch, decided twice a second (the reference's AdBreakSwitcher.evaluate): show the
 * first clear candidate once playback reaches the ad, go on to the next when the shown one gets an
 * ad itself or stops answering, return once the playing channel's last 20 s are ad-free.
 */
export function switchStep(input: {
  /** The raw playlist of the channel the viewer chose (read on while another one shows). */
  primary: MediaPlaylist | null;
  /** The candidate shown now, or null. */
  showing: string | null;
  candidates: SwitchCandidate[];
  /** "Werbepause bei A" without a clear candidate is shown. */
  noAlternative: boolean;
  /** The second source can take over (the blocker's part comes first). */
  otherSourceClear: boolean;
  hiding: boolean;
  playbackDate: number | null;
  paused: boolean;
  now: number;
}): SwitchStep {
  const { primary, now } = input;
  if (!primary) return { action: 'none' };
  if (input.showing !== null) {
    if (isAdFree(primary, returnClearSeconds)) return { action: 'return' };
    const current = input.candidates.find((candidate) => candidate.id === input.showing);
    const stale = !current || now - current.watched.readAt > freshForMs;
    const hasAd = current?.watched.playlist ? edgeHasAd(current.watched.playlist) : false;
    if (stale || (hasAd && !candidateIsClear(current!, now))) {
      const next = input.candidates.find(
        (candidate) => candidate.id !== input.showing && candidateIsClear(candidate, now),
      );
      return next ? { action: 'show', candidate: next.id, until: estimatedAdEnd(primary) } : { action: 'return' };
    }
    return { action: 'update', until: estimatedAdEnd(primary) };
  }
  if (!edgeHasAd(primary)) {
    return input.noAlternative && isAdFree(primary, returnClearSeconds) ? { action: 'idle' } : { action: 'none' };
  }
  if (input.otherSourceClear) return { action: 'none' };
  const start = currentAdStart(primary);
  if (
    !input.hiding &&
    !input.paused &&
    start !== null &&
    input.playbackDate !== null &&
    input.playbackDate < start - switchLeadMs
  ) {
    return { action: 'none' };
  }
  const best = input.candidates.find((candidate) => candidateIsClear(candidate, now));
  if (best) return { action: 'show', candidate: best.id, until: estimatedAdEnd(primary) };
  return { action: 'noAlternative', until: estimatedAdEnd(primary) };
}
