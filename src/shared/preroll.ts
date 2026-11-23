// Waiting out a Twitch pre-roll before playback starts.
// Port of `Preroll.wait` from the native macOS app (lurk-macos, Sources/Lurk/AdBreak.swift).

import { estimatedAdEnd, isAdFree, parseMedia } from './m3u8';

/**
 * Real content needed at the live edge before the stream starts: two segments.
 * Measured on macOS (2026-11-12): 6 s waited 2.7–5.6 s past the ad, 4 s 0.2–3.5 s, both without
 * stalls; 2 s (one segment) stalled for up to 7.6 s afterwards.
 */
export const prerollContentSeconds = 4;

export interface FetchedText {
  status: number;
  text: string;
}

export interface PrerollOptions {
  fetchText: (url: string) => Promise<FetchedText>;
  /** Give up after this many seconds. */
  limit?: number;
  contentSeconds?: number;
  stop?: () => boolean;
  /** Called on every round with an ad, with the expected end (ms since epoch) if Twitch sends it. */
  onAd?: (end: number | null) => void;
  sleep?: (seconds: number) => Promise<void>;
  now?: () => number;
}

export interface PrerollResult {
  /** How long the ad ran while we waited, null without an ad. */
  waitedSeconds: number | null;
  /** Last expected ad end Twitch reported (ms since epoch). */
  expectedEnd: number | null;
  rounds: number;
}

const defaultSleep = (seconds: number) => new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000));

export async function waitForPreroll(probe: string, options: PrerollOptions): Promise<PrerollResult> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const limit = options.limit ?? 90;
  const contentSeconds = options.contentSeconds ?? prerollContentSeconds;
  const started = now();
  let sawAd = false;
  let expectedEnd: number | null = null;
  let rounds = 0;
  while (!(options.stop?.() ?? false) && now() - started < limit * 1000) {
    rounds += 1;
    // No answer or no playlist: not an ad, the player reports errors itself.
    let response: FetchedText;
    try {
      response = await options.fetchText(probe);
    } catch {
      break;
    }
    if (response.status >= 300) break;
    const playlist = parseMedia(response.text, probe);
    if (playlist.segments.length === 0) break;
    if (playlist.segments.at(-1)!.isAd === false && isAdFree(playlist, contentSeconds)) break;
    sawAd = true;
    const end = estimatedAdEnd(playlist);
    if (end !== null) expectedEnd = end;
    options.onAd?.(end);
    // Far from the end every 1.5 s is enough, close to it every 0.5 s.
    const left = end !== null ? (end - now()) / 1000 : 1.5;
    await sleep(left > 2.5 ? Math.min(1.5, left - 2) : 0.5);
  }
  return { waitedSeconds: sawAd ? (now() - started) / 1000 : null, expectedEnd, rounds };
}
