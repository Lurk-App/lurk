// The playback engine: <video> with hls.js, as measured in stage 0 (Lurk-Prototyp).
//
// - Playlists go through the main process (Twitch refuses the app's origin), segments load directly.
// - The master playlist is fetched once per session and handed to hls.js: fetching it again would
//   open a new Twitch session, with its own pre-roll.
// - Every live media playlist passes the playlist filter (HlsPruner), which removes ad segments –
//   also in the middle of a stream; hls.js keeps playing through a pause in the playlist. Videos
//   (VODs) pass unchanged: Twitch stitches no ads into them, and the filter keeps a live window.
// - A video's segments come through the main process as well: Twitch's video CDN answers
//   cross-origin requests only for twitch.tv (live segment hosts allow any origin).
// - A live session first waits out a pre-roll (waitForPreroll) before the picture starts.
// - The playlist filter takes the m3u-prune rules of the built-in list and the own filters; with the
//   ad blocker off ("Werbeblocker"), nothing is filtered and no pre-roll is waited out.
// - While the blocker is on, a live stream also has a second source (Twitch's "popout" session of the
//   same channel, read in the background) and an eye on ad breaks (shared/adBreaks.ts): when
//   playback reaches one, the stream continues from the second source if that is clear, else it is
//   hidden until the live edge has real content again (macOS: PlayerModel.evaluateAdBlocking).
// - The ad-break switch (with or without the blocker, part 7c): three subscribed channels are read
//   in the background; at a break the one watched longest that is ad-free shows until the stream
//   is ad-free again (macOS: AdBreakSwitcher). Order at a break: second source, switch, hiding.
// - A tile's live preview (`preview`) skips that wait – it only shows once frames arrive – and
//   keeps to one small variant with a short buffer, like the macOS app's LivePreviewer.

import Hls, {
  type ErrorData,
  type HlsConfig,
  type LoaderCallbacks,
  type LoaderConfiguration,
  type LoaderContext,
  type LoaderStats,
  type PlaylistLoaderContext,
} from 'hls.js';
import { builtInFilterList, FilterEngine } from '@shared/filterEngine';
import { HlsPruner, type PruneReport } from '@shared/hlsPruner';
import { adStep, otherSourceIsClear, switchStep, type WatchedPlaylist } from '@shared/adBreaks';
import {
  edgeHasAd,
  parseMaster,
  parseMedia,
  pickVariant,
  previewVariant,
  type MediaPlaylist,
  type StreamVariant,
} from '@shared/m3u8';
import type { ChannelRef, PlaybackSource, PlayTarget } from '@shared/models';
import { waitForPreroll } from '@shared/preroll';

export interface QualityLevel {
  /** hls.js level index. */
  index: number;
  /** Twitch's own name for the variant ("1080p60", "480p30", "audio_only"). */
  name: string | null;
  height: number | null;
  frameRate: number | null;
  bitrate: number;
  isSource: boolean;
}

export interface EngineCallbacks {
  /** A pre-roll is being waited out; the expected end (ms) when Twitch announces it. */
  onPreroll(expectedEnd: number | null): void;
  onPlaying(): void;
  onLevels(levels: QualityLevel[]): void;
  /** The level on screen changed (also in automatic mode). */
  onLevel(index: number): void;
  onFatal(message: string): void;
  /** The pre-roll ended after this many seconds of ads. */
  onPrerollDone?(seconds: number): void;
  /** Ad segments left a playlist (each segment reported once). */
  onPrune?(report: PruneReport): void;
  /** A mid-roll is hidden from now on; its expected end (ms) when Twitch announces it. */
  onAdHide?(expectedEnd: number | null): void;
  /** The expected end of the hidden break changed. */
  onAdUpdate?(expectedEnd: number | null): void;
  /** The hidden break ended after this many seconds; the stream goes on. */
  onAdResume?(seconds: number): void;
  /** Hiding stopped without the break ending (the blocker was switched). */
  onAdCancel?(): void;
  /** The stream continues from the other Twitch session. */
  onSourceSwitch?(): void;
  /** After a reload or a switch: the level the chosen quality now has (-1 automatic). */
  onChosenLevel?(index: number): void;
  /** The stream is attached anew (a switch or a reload); `onPlaying` follows. */
  onReattach?(): void;
  /** The ad-break switch shows another subscribed channel; the break's expected end. */
  onDetour?(channel: ChannelRef, expectedEnd: number | null): void;
  onDetourUpdate?(expectedEnd: number | null): void;
  /** Back at the channel the viewer chose. */
  onDetourEnd?(): void;
  /** A break without a clear subscribed channel (`active` false once it is over). */
  onNoAlternative?(active: boolean, expectedEnd: number | null): void;
}

/** How often the second source's playlist is read (the macOS app's PlaylistWatcher, 3 s). */
const watchIntervalMs = 3000;
/** How often an ad break is looked for. */
const adTickMs = 500;
/** How often the ad-break switch asks for its candidates (the reference's 60 s). */
const candidateRefreshMs = 60_000;
/** The candidates' quality when "Automatisch" is chosen (the reference's 720p). */
const candidateHeight = 720;

async function playlistText(url: string): Promise<{ status: number; text: string }> {
  return window.lurk.twitch.playlist(url);
}

function freshStats(): LoaderStats {
  return {
    aborted: false,
    loaded: 0,
    retry: 0,
    total: 0,
    chunkCount: 0,
    bwEstimate: 0,
    loading: { start: 0, first: 0, end: 0 },
    parsing: { start: 0, end: 0 },
    buffering: { start: 0, first: 0, end: 0 },
  };
}

/**
 * hls.js playlist loader that fetches through the main process, hands back the cached master and
 * passes every media playlist through `transform`.
 */
function playlistLoader(
  transform: (url: string, text: string) => string,
  master: () => { url: string; text: string } | null,
) {
  return class PlaylistLoader {
    context: LoaderContext | null = null;
    stats: LoaderStats = freshStats();
    private aborted = false;

    constructor(_config: HlsConfig) {}

    destroy() {
      this.aborted = true;
    }

    abort() {
      this.aborted = true;
      this.stats.aborted = true;
    }

    load(context: LoaderContext, _config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>) {
      this.context = context;
      const stats = this.stats;
      stats.loading.start = performance.now();
      const isManifest = (context as PlaylistLoaderContext).type === 'manifest';
      const cached = isManifest ? master() : null;
      const answer =
        cached && cached.url === context.url
          ? Promise.resolve({ status: 200, text: cached.text })
          : playlistText(context.url);
      answer.then(
        ({ status, text }) => {
          if (this.aborted) return;
          stats.loading.first = stats.loading.end = performance.now();
          if (status < 200 || status >= 300) {
            callbacks.onError({ code: status, text: `HTTP ${status}` }, context, null, stats);
            return;
          }
          const data = isManifest ? text : transform(context.url, text);
          stats.loaded = stats.total = data.length;
          callbacks.onSuccess({ url: context.url, data }, stats, context, null);
        },
        (error: unknown) => {
          if (!this.aborted) callbacks.onError({ code: 0, text: String(error) }, context, null, stats);
        },
      );
    }

    getCacheAge() {
      return null;
    }

    getResponseHeader() {
      return null;
    }
  };
}

/** hls.js fragment loader for videos: each segment through the main process. */
function segmentLoader() {
  return class SegmentLoader {
    context: LoaderContext | null = null;
    stats: LoaderStats = freshStats();
    private aborted = false;

    constructor(_config: HlsConfig) {}

    destroy() {
      this.aborted = true;
    }

    abort() {
      this.aborted = true;
      this.stats.aborted = true;
    }

    load(context: LoaderContext, _config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>) {
      this.context = context;
      const stats = this.stats;
      stats.loading.start = performance.now();
      window.lurk.twitch.segment(context.url).then(
        ({ status, data }) => {
          if (this.aborted) return;
          stats.loading.first = stats.loading.end = performance.now();
          if (!data) {
            callbacks.onError({ code: status, text: `HTTP ${status}` }, context, null, stats);
            return;
          }
          const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
          stats.loaded = stats.total = buffer.byteLength;
          callbacks.onSuccess({ url: context.url, data: buffer }, stats, context, null);
        },
        (error: unknown) => {
          if (!this.aborted) callbacks.onError({ code: 0, text: String(error) }, context, null, stats);
        },
      );
    }

    getCacheAge() {
      return null;
    }

    getResponseHeader() {
      return null;
    }
  };
}

/** A media playlist read in the background (the other source). */
class PlaylistWatcher implements WatchedPlaylist {
  playlist: MediaPlaylist | null = null;
  readAt = 0;
  private timer: number | undefined;
  private stopped = false;

  constructor(readonly url: string) {}

  start(): this {
    void this.read();
    return this;
  }

  stop(): void {
    this.stopped = true;
    window.clearTimeout(this.timer);
  }

  private async read(): Promise<void> {
    if (this.stopped) return;
    try {
      const answer = await playlistText(this.url);
      if (answer.status < 300 && !this.stopped) {
        this.playlist = parseMedia(answer.text, this.url);
        this.readAt = Date.now();
      }
    } catch {
      // Unread: it turns stale and is not trusted.
    }
    if (!this.stopped) this.timer = window.setTimeout(() => void this.read(), watchIntervalMs);
  }
}

interface Session {
  url: string;
  text: string;
  variants: StreamVariant[];
}

export class PlayerEngine {
  private hls: Hls | null = null;
  private destroyed = false;
  private master: { url: string; text: string } | null = null;
  private pruners = new Map<string, HlsPruner>();
  /** The filters while the ad blocker is on; null while it is off. */
  private filters: FilterEngine | null = null;
  /** Seconds a video starts at (its remembered position); -1 is the start, as hls.js counts. */
  private startPosition = -1;
  private isVideo = false;
  private target: PlayTarget | null = null;
  /** The two Twitch sessions of a live channel and the one that plays. */
  private sessions: Record<PlaybackSource, Session | null> = { primary: null, backup: null };
  private source: PlaybackSource = 'primary';
  private openingBackup = false;
  /** The other source's playlist, read in the background. */
  private watcher: PlaylistWatcher | null = null;
  /** The raw playlist of what plays (before the filter). */
  private raw: MediaPlaylist | null = null;
  private hiding: { since: number; until: number | null } | null = null;
  private adTimer: number | undefined;
  /** The height the viewer chose; null for automatic. Kept across reloads and switches. */
  private chosenHeight: number | null = null;
  /** The playing channel's id (the switch never shows it as a candidate). */
  private channelId: string | null = null;
  private adSwitch = false;
  /** The subscribed channels the switch may show, read in the background, in their order. */
  private candidates = new Map<string, { ref: ChannelRef; session: Session; watcher: PlaylistWatcher }>();
  private candidateTimer: number | undefined;
  private askedCandidates = false;
  /** The channel the switch shows now. */
  private showing: { ref: ChannelRef; until: number | null } | null = null;
  /** While another channel shows: the playing source, read on. */
  private primaryWatcher: PlaylistWatcher | null = null;
  private noAlternative: { until: number | null } | null = null;
  /**
   * "Zurück" while the break still runs: no switching until it is over. (The reference would switch
   * again half a second later; the button promises to stay "auch wenn die Werbung noch läuft".)
   */
  private declined = false;

  constructor(
    readonly video: HTMLVideoElement,
    private readonly callbacks: EngineCallbacks,
    private readonly options: { preview?: boolean } = {},
  ) {}

  /** Opens a new session for the target, waits out a pre-roll (live), then plays. */
  async start(
    target: PlayTarget,
    options: { startPosition?: number | null; channelId?: string | null } = {},
  ): Promise<void> {
    this.isVideo = target.kind === 'vod';
    this.target = target;
    this.channelId = options.channelId ?? null;
    // A video starts at its remembered position, else at its beginning – also one still being
    // recorded, which hls.js would otherwise treat as live and start at its end.
    if (this.isVideo) this.startPosition = options.startPosition ?? 0;
    // The own filters as they are now (a running stream keeps them, as on macOS); the ad-break
    // switch as it is now, changed later through setAdSwitch.
    const [settings, blocker] = await Promise.all([window.lurk.settings.get(), window.lurk.blocker.state()]);
    this.filters = settings.blocker.enabled ? new FilterEngine([builtInFilterList, blocker.user.text]) : null;
    this.adSwitch = settings.player.adSwitch;
    const masterUrl = await window.lurk.twitch.playback(target);
    if (this.destroyed) return;
    const answer = await playlistText(masterUrl);
    if (this.destroyed) return;
    if (answer.status >= 300) throw new Error(`HTTP ${answer.status}`);
    this.master = { url: masterUrl, text: answer.text };
    this.sessions.primary = { url: masterUrl, text: answer.text, variants: parseMaster(answer.text, masterUrl) };
    if (target.kind === 'live' && !this.options.preview && this.filters) {
      const variant = pickVariant(parseMaster(answer.text, masterUrl), 1080);
      if (variant) {
        const result = await waitForPreroll(variant.url, {
          fetchText: playlistText,
          stop: () => this.destroyed,
          onAd: (end) => this.callbacks.onPreroll(end),
        });
        if (result.waitedSeconds !== null && !this.destroyed) this.callbacks.onPrerollDone?.(result.waitedSeconds);
      }
    }
    if (this.destroyed) return;
    this.attach(masterUrl);
    this.watchAds();
  }

  /** Whether the blocker's part looks after breaks: a live stream in the player, the blocker on. */
  private get watchesAds(): boolean {
    return this.isLivePlayer && this.filters !== null;
  }

  private get isLivePlayer(): boolean {
    return !this.isVideo && !this.options.preview && this.target?.kind === 'live';
  }

  /** Whether breaks are looked at at all: the blocker's part or the switch. */
  private get watchesBreaks(): boolean {
    return this.isLivePlayer && (this.filters !== null || this.adSwitch);
  }

  private watchAds(): void {
    window.clearInterval(this.adTimer);
    window.clearInterval(this.candidateTimer);
    this.adTimer = this.watchesBreaks ? window.setInterval(() => this.evaluateAds(), adTickMs) : undefined;
    this.candidateTimer =
      this.isLivePlayer && this.adSwitch
        ? window.setInterval(() => void this.refreshCandidates(), candidateRefreshMs)
        : undefined;
  }

  /** The switch on or off ("…" menu, settings): at once, as the reference's setAdSwitch. */
  setAdSwitch(enabled: boolean): void {
    if (this.adSwitch === enabled) return;
    this.adSwitch = enabled;
    if (!enabled) {
      this.returnToPrimary();
      for (const candidate of this.candidates.values()) candidate.watcher.stop();
      this.candidates.clear();
      this.askedCandidates = false;
      this.setNoAlternative(null);
    }
    this.watchAds();
  }

  /** Asks for the candidates and reads the new ones in the background (their own sessions). */
  private async refreshCandidates(): Promise<void> {
    if (!this.adSwitch || !this.channelId || this.destroyed) return;
    let refs: ChannelRef[];
    try {
      refs = await window.lurk.subscriptions.adSwitchCandidates(this.channelId);
    } catch {
      return;
    }
    const next = new Map<string, { ref: ChannelRef; session: Session; watcher: PlaylistWatcher }>();
    for (const ref of refs) {
      const known = this.candidates.get(ref.id);
      if (known) {
        next.set(ref.id, known);
        continue;
      }
      try {
        const url = await window.lurk.twitch.playback({ kind: 'live', login: ref.login });
        const answer = await playlistText(url);
        if (this.destroyed || !this.adSwitch) return;
        if (answer.status >= 300) continue;
        const session = { url, text: answer.text, variants: parseMaster(answer.text, url) };
        const variant = pickVariant(session.variants, this.chosenHeight ?? candidateHeight);
        if (variant) next.set(ref.id, { ref, session, watcher: new PlaylistWatcher(variant.url).start() });
      } catch {
        // Not readable now: asked again in a minute.
      }
    }
    for (const [id, old] of this.candidates) {
      if (next.has(id)) continue;
      // The one showing stays until the switch returns.
      if (this.showing?.ref.id === id) next.set(id, old);
      else old.watcher.stop();
    }
    this.candidates = next;
  }

  /** The switch: another subscribed channel shows (a hidden break ends here, counted). */
  private show(id: string, until: number | null): void {
    const candidate = this.candidates.get(id);
    if (!candidate) return;
    if (this.hiding) this.resume(false);
    if (!this.showing) {
      // The playing source is read on, to know when to return; the second source waits.
      const playing = this.sessions[this.source];
      const variant = playing ? pickVariant(playing.variants, this.playingHeight() ?? 1080) : null;
      this.primaryWatcher = variant ? new PlaylistWatcher(variant.url).start() : null;
      this.watcher?.stop();
      this.watcher = null;
    }
    this.setNoAlternative(null);
    this.showing = { ref: candidate.ref, until };
    this.master = { url: candidate.session.url, text: candidate.session.text };
    this.rebuild(candidate.session.url);
    this.callbacks.onDetour?.(candidate.ref, until);
  }

  /** Back to the channel the viewer chose ("Zurück", or the break is over). */
  returnToPrimary(): void {
    if (!this.showing) return;
    this.showing = null;
    this.primaryWatcher?.stop();
    this.primaryWatcher = null;
    const session = this.sessions[this.source];
    if (session && !this.destroyed) {
      this.master = { url: session.url, text: session.text };
      this.rebuild(session.url);
      this.watchOther();
    }
    this.callbacks.onDetourEnd?.();
  }

  /** "Zurück": back at once, and no switching for the rest of this break. */
  goBack(): void {
    if (!this.showing) return;
    this.declined = true;
    this.returnToPrimary();
  }

  /** "Bei B bleiben": the switch ends here; the caller opens B's player. */
  adoptDetour(): ChannelRef | null {
    const ref = this.showing?.ref ?? null;
    this.showing = null;
    this.primaryWatcher?.stop();
    this.primaryWatcher = null;
    return ref;
  }

  private setNoAlternative(until: { until: number | null } | null): void {
    const before = this.noAlternative;
    if (before === null && until === null) return;
    if (before && until && before.until === until.until) return;
    this.noAlternative = until;
    this.callbacks.onNoAlternative?.(until !== null, until?.until ?? null);
  }

  /** The switch's part of a break; true when it took over (nothing else is to happen now). */
  private evaluateSwitch(now: number, playbackDate: number | null): boolean {
    if (!this.adSwitch) return false;
    if (!this.askedCandidates && !this.video.paused) {
      this.askedCandidates = true;
      void this.refreshCandidates();
    }
    const primary = this.showing ? (this.primaryWatcher?.playlist ?? null) : this.raw;
    if (this.declined && primary && !edgeHasAd(primary)) this.declined = false;
    const step = switchStep({
      primary,
      showing: this.showing?.ref.id ?? null,
      candidates: [...this.candidates.values()].map((candidate) => ({
        id: candidate.ref.id,
        watched: candidate.watcher,
      })),
      noAlternative: this.noAlternative !== null,
      otherSourceClear: this.filters !== null && otherSourceIsClear(this.watcher, now),
      hiding: this.hiding !== null,
      playbackDate: this.showing ? null : playbackDate,
      paused: this.video.paused,
      now,
    });
    switch (step.action) {
      case 'show':
        // Declined for this break: the blocker's part (or the ad itself) takes it.
        if (this.declined && !this.showing) return false;
        this.show(step.candidate, step.until);
        return true;
      case 'return':
        this.returnToPrimary();
        return true;
      case 'update':
        if (this.showing) {
          const until = step.until ?? this.showing.until;
          if (until !== this.showing.until) {
            this.showing.until = until;
            this.callbacks.onDetourUpdate?.(until);
          }
        }
        return this.showing !== null;
      case 'noAlternative':
        this.setNoAlternative({ until: step.until ?? this.noAlternative?.until ?? null });
        return false;
      case 'idle':
        this.setNoAlternative(null);
        return false;
      case 'none':
        return this.showing !== null;
    }
  }

  private evaluateAds(): void {
    if (this.destroyed || !this.hls || !this.watchesBreaks) return;
    const now = Date.now();
    const playbackDate = this.hls.playingDate?.getTime() ?? null;
    if (this.evaluateSwitch(now, playbackDate) || !this.watchesAds) return;
    // The second source opens once the stream plays (as on macOS, in its resolution).
    if (!this.sessions.backup && !this.openingBackup && !this.video.paused) void this.openBackup();
    const step = adStep({
      hiding: this.hiding !== null,
      playing: this.raw,
      other: this.watcher,
      playbackDate: this.hls.playingDate?.getTime() ?? null,
      paused: this.video.paused,
      now: Date.now(),
    });
    switch (step.action) {
      case 'hide':
        this.hiding = { since: Date.now(), until: step.until };
        this.video.pause();
        this.callbacks.onAdHide?.(step.until);
        break;
      case 'update': {
        // A missing estimate keeps the end already known (the macOS app's `?? hiddenAdUntil`).
        const until = step.until ?? this.hiding?.until ?? null;
        if (this.hiding && until !== this.hiding.until) {
          this.hiding.until = until;
          this.callbacks.onAdUpdate?.(until);
        }
        break;
      }
      case 'resume':
        this.resume(true);
        break;
      case 'resumeAndSwitch':
        this.resume(false);
        this.switchSource();
        break;
      case 'switch':
        this.switchSource();
        break;
      case 'none':
        break;
    }
  }

  /** The break is over: on at the live edge (`play: false` when the caller switches the source). */
  private resume(play: boolean): void {
    if (!this.hiding) return;
    const seconds = (Date.now() - this.hiding.since) / 1000;
    this.hiding = null;
    this.callbacks.onAdResume?.(seconds);
    if (!play || !this.hls) return;
    const edge = this.hls.liveSyncPosition;
    if (edge !== null && Number.isFinite(edge)) this.video.currentTime = edge;
    void this.video.play().catch(() => undefined);
  }

  /** Opens the second Twitch session of the channel and reads it in the resolution that plays. */
  private async openBackup(): Promise<void> {
    const target = this.target;
    if (!target || target.kind !== 'live') return;
    this.openingBackup = true;
    try {
      const url = await window.lurk.twitch.playback(target, 'backup');
      if (this.destroyed) return;
      const answer = await playlistText(url);
      if (this.destroyed || answer.status >= 300 || !this.watchesAds) return;
      this.sessions.backup = { url, text: answer.text, variants: parseMaster(answer.text, url) };
      this.watchOther();
    } catch {
      // No second source this time: breaks are hidden instead.
    } finally {
      this.openingBackup = false;
    }
  }

  /** Reads the source that does not play, in the height that plays. */
  private watchOther(): void {
    this.watcher?.stop();
    this.watcher = null;
    const other = this.sessions[this.source === 'primary' ? 'backup' : 'primary'];
    if (!other || !this.watchesAds) return;
    const variant = pickVariant(other.variants, this.playingHeight() ?? 1080);
    if (variant) this.watcher = new PlaylistWatcher(variant.url).start();
  }

  private playingHeight(): number | null {
    const level = this.hls?.levels[this.hls.currentLevel];
    if (level?.height) return level.height;
    const heights = this.hls?.levels.map((entry) => entry.height).filter(Boolean) ?? [];
    return heights.length ? Math.max(...heights) : null;
  }

  /** The same stream from the other Twitch session (a few seconds apart), in the same quality. */
  private switchSource(): void {
    const to: PlaybackSource = this.source === 'primary' ? 'backup' : 'primary';
    const session = this.sessions[to];
    if (!session) return;
    this.source = to;
    this.master = { url: session.url, text: session.text };
    this.rebuild(session.url);
    this.watchOther();
    this.callbacks.onSourceSwitch?.();
  }

  /** A new hls.js on the same element: the playlist reads start afresh. */
  private rebuild(url: string): void {
    this.hls?.destroy();
    this.hls = null;
    this.raw = null;
    this.pruners.clear();
    this.callbacks.onReattach?.();
    this.attach(url);
  }

  /**
   * The shield's switch: the same Twitch session plays again, with or without the filter – no new
   * session, no pre-roll wait (as the macOS app's setAdBlock plays the primary again).
   */
  async reload(): Promise<void> {
    const primary = this.sessions.primary;
    if (!primary || this.destroyed) return;
    const [settings, blocker] = await Promise.all([window.lurk.settings.get(), window.lurk.blocker.state()]);
    if (this.destroyed) return;
    this.filters =
      settings.blocker.enabled && !this.isVideo ? new FilterEngine([builtInFilterList, blocker.user.text]) : null;
    if (this.hiding) {
      this.hiding = null;
      this.callbacks.onAdCancel?.();
    }
    if (this.showing) {
      this.adoptDetour();
      this.callbacks.onDetourEnd?.();
    }
    if (!this.filters) {
      this.watcher?.stop();
      this.watcher = null;
      this.sessions.backup = null;
    }
    this.source = 'primary';
    this.master = { url: primary.url, text: primary.text };
    this.rebuild(primary.url);
    this.watchOther();
    this.watchAds();
  }

  private transform = (url: string, text: string): string => {
    if (this.isVideo) return text;
    // What plays, as Twitch sent it: the ad breaks are judged from this.
    if (this.watchesBreaks) this.raw = parseMedia(text, url);
    if (!this.filters) return text;
    const key = url.split('?')[0]!;
    let pruner = this.pruners.get(key);
    if (!pruner) {
      pruner = new HlsPruner();
      this.pruners.set(key, pruner);
    }
    const result = pruner.prune(text, url, this.filters.pruneRulesFor(url));
    if (result.report.removedSegments > 0) this.callbacks.onPrune?.(result.report);
    return result.text;
  };

  private attach(url: string) {
    const preview = this.options.preview === true;
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      backBufferLength: preview ? 0 : 30,
      startPosition: this.startPosition,
      // About two seconds ahead, as the macOS preview buffers.
      ...(preview ? { maxBufferLength: 4, maxMaxBufferLength: 6 } : {}),
      // "Automatic" never loads more than the player can show.
      capLevelToPlayerSize: !preview,
      pLoader: playlistLoader(this.transform, () => this.master) as unknown as HlsConfig['pLoader'],
      ...(this.isVideo ? { fLoader: segmentLoader() as unknown as HlsConfig['fLoader'] } : {}),
    });
    this.hls = hls;
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      // The names and the source mark come from the master playlist, matched by bandwidth.
      const variants = this.master ? parseMaster(this.master.text, this.master.url) : [];
      if (preview) {
        const small = previewVariant(variants);
        const index = hls.levels.findIndex((level) => level.bitrate === small?.bandwidth);
        if (index >= 0) hls.currentLevel = index;
      }
      // After a reload or a switch the chosen quality stays: the level of that height here.
      let chosen = -1;
      if (!preview && this.chosenHeight !== null) {
        hls.levels.forEach((level, index) => {
          if (level.height === this.chosenHeight && (chosen < 0 || level.bitrate > hls.levels[chosen]!.bitrate))
            chosen = index;
        });
        if (chosen >= 0) hls.currentLevel = chosen;
      }
      this.callbacks.onLevels(
        hls.levels.map((level, index) => {
          const variant = variants.find((candidate) => candidate.bandwidth === level.bitrate);
          return {
            index,
            name: variant?.name ?? null,
            height: level.height || null,
            frameRate: level.frameRate || null,
            bitrate: level.bitrate,
            // Live and VODs alike, as the macOS app marks the source.
            isSource: variant?.isSource ?? false,
          };
        }),
      );
      this.callbacks.onChosenLevel?.(chosen);
      void this.video.play().catch(() => {
        // Autoplay is allowed in Lurk's windows; if the system still refuses, the controls remain.
      });
    });
    hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => this.callbacks.onLevel(data.level));
    this.video.addEventListener('playing', this.onPlaying);
    hls.on(Hls.Events.ERROR, (_event, data: ErrorData) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
      else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
      else this.callbacks.onFatal(data.details);
    });
    hls.loadSource(url);
    hls.attachMedia(this.video);
  }

  private onPlaying = () => this.callbacks.onPlaying();

  /** -1 for automatic. */
  setLevel(index: number) {
    if (!this.hls) return;
    this.chosenHeight = index === -1 ? null : (this.hls.levels[index]?.height ?? null);
    // nextLevel switches at the next fragment without flushing what is buffered.
    this.hls.nextLevel = index;
    if (index === -1) this.hls.currentLevel = -1;
  }

  get autoLevelEnabled(): boolean {
    return this.hls?.autoLevelEnabled ?? true;
  }

  destroy() {
    this.destroyed = true;
    window.clearInterval(this.adTimer);
    window.clearInterval(this.candidateTimer);
    this.watcher?.stop();
    this.watcher = null;
    this.primaryWatcher?.stop();
    this.primaryWatcher = null;
    for (const candidate of this.candidates.values()) candidate.watcher.stop();
    this.candidates.clear();
    this.video.removeEventListener('playing', this.onPlaying);
    this.hls?.destroy();
    this.hls = null;
    this.video.removeAttribute('src');
    this.video.load();
  }
}
