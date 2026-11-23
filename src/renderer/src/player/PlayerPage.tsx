// The player: a dark stage over the info strip. Follows PlayerView of the macOS app (lurk-macos,
// Sources/Lurk/Views/PlayerView.swift): Lurk's bar at the top right appears with the mouse and hides
// after 2.5 s; the browser's own video controls take the place of AVKit's at the bottom.

import type { TFunction } from 'i18next';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeftRight,
  ChevronDown,
  Ellipsis,
  ListChecks,
  Maximize2,
  MessagesSquare,
  Minimize2,
  Megaphone,
  ShieldHalf,
  ShieldOff,
  TriangleExclamationPoint,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { pickClipSlugs } from '@shared/adBreaks';
import { emptyTotals, type BlockerTotals } from '@shared/blocker';
import type { MenuEntry, Platform } from '@shared/ipc';
import { twitchUrl } from '@shared/links';
import { formatDuration, formatNumber, formatRelative, formatUptime } from '@shared/format';
import type { HistoryRecord } from '@shared/library';
import type { ChannelDetails, ChannelRef, GameRef, PlayTarget, VideoDetails } from '@shared/models';
import { Avatar, EmptyState, FloatingPanel, Icon, Spinner } from '../components';
import { Popover } from '../components/Popover';
import { Toast, useToast } from '../components/Toast';
import { SubscribeButton } from '../components/SubscribeButton';
import type { Route } from '../shell/router';
import { ChatPanel } from '../chat/ChatPanel';
import { useSettings } from '../useSettings';
import { PlayerEngine, type QualityLevel } from './engine';
import { useRaids, type PendingRaid } from './useRaids';
import './player.css';

type Phase = 'loading' | 'preroll' | 'playing' | 'offline' | 'failed';

/** Timing of the bar, as in the macOS app. */
const hideAfterMs = 2500;
const hideAfterLeaveMs = 800;
const fullScreenShortcut: Record<Platform, string> = { darwin: '⌃⌘F', win32: 'F11', linux: 'F11' };
const chatShortcut: Record<Platform, string> = { darwin: '⇧⌘K', win32: 'Ctrl+Shift+K', linux: 'Ctrl+Shift+K' };
/** Watch time is counted in steps of 5 s of playback (the macOS app's time observer). */
const watchTimeStep = 5;
/** More than this between two looks a second apart is a jump, not playback (s). */
const maxWatchStep = 2;

export function PlayerPage({
  target,
  cinema,
  fullScreen,
  platform,
  open,
}: {
  target: PlayTarget;
  /** Fullscreen with the player on top: no sidebar, no info strip. */
  cinema: boolean;
  fullScreen: boolean;
  platform: Platform;
  open(route: Route): void;
}) {
  const { t, i18n } = useTranslation('player');
  const language = i18n.language;
  const video = useRef<HTMLVideoElement>(null);
  const engine = useRef<PlayerEngine | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>('loading');
  const [failure, setFailure] = useState<string | null>(null);
  const [channel, setChannel] = useState<ChannelDetails | null>(null);
  const [vod, setVod] = useState<VideoDetails | null>(null);
  const [prerollEnd, setPrerollEnd] = useState<number | null>(null);
  const [levels, setLevels] = useState<QualityLevel[]>([]);
  const [chosenLevel, setChosenLevel] = useState(-1);
  const [shownLevel, setShownLevel] = useState<number | null>(null);
  /** What the ad blocker skipped in this stream (the shield's count and popover). */
  const [blocked, setBlocked] = useState({ breaks: 0, seconds: 0 });
  const [blockerOpen, setBlockerOpen] = useState(false);
  /** A mid-roll is hidden now; its expected end (ms) when known. */
  const [adHide, setAdHide] = useState<{ until: number | null } | null>(null);
  const toast = useToast();
  /** Who the blocker's log names; known once the channel or video loaded. */
  const channelName = useRef('');
  const controls = useBarVisibility();
  const settings = useSettings();
  // Popular clips of the channel while ads are skipped (Werbeblocker → "Clips des Kanals zeigen").
  const clipsWanted =
    target.kind === 'live' &&
    (settings?.blocker.enabled ?? true) &&
    (settings?.blocker.adFillClips ?? true) &&
    (phase === 'preroll' || (phase === 'playing' && adHide !== null));
  const adClip = useAdClip(channel?.ref.login ?? null, clipsWanted);
  const [playingClip, setPlayingClip] = useState<string | null>(null);
  // A new break starts without a clip on screen.
  useEffect(() => {
    if (!clipsWanted) setPlayingClip(null);
  }, [clipsWanted]);
  /** A switch or reload attaches the stream anew: the project's spinner until it plays. */
  const [reattaching, setReattaching] = useState(false);
  /** The ad-break switch shows another subscribed channel; the break's expected end. */
  const [detour, setDetour] = useState<{ channel: ChannelRef; until: number | null } | null>(null);
  /** A break without a clear subscribed channel (shown while ads play as they are). */
  const [noAlternative, setNoAlternative] = useState<{ until: number | null } | null>(null);
  const showChat = settings?.player.showChat ?? true;
  const raids = useRaids(
    target.kind === 'live' ? (channel?.ref.id ?? null) : null,
    settings?.player.followRaids ?? true,
    (raidTarget) =>
      // Like twitch.tv: the player switches to the raided channel.
      open({ kind: 'play', target: { kind: 'live', login: raidTarget.login } }),
  );
  // "live seit" moves on.
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const targetKey = target.kind === 'live' ? `live:${target.login.toLowerCase()}` : `vod:${target.id}`;

  // Load the channel or video, then start a session. Only the page on top is mounted, so leaving
  // or covering the player stops it and frees hls.js.
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let cancelled = false;
    setPhase('loading');
    setFailure(null);
    setLevels([]);
    setChosenLevel(-1);
    setShownLevel(null);
    setBlocked({ breaks: 0, seconds: 0 });
    setAdHide(null);
    setReattaching(false);
    setDetour(null);
    setNoAlternative(null);
    toast.clear();
    channelName.current = '';
    let skipping = false;
    // What the history keeps once playback runs ("Wiedergabeverlauf speichern" decides in main).
    let historyRecord: HistoryRecord | null = null;
    const session = new PlayerEngine(element, {
      onPreroll: (end) => {
        if (cancelled) return;
        setPrerollEnd(end);
        setPhase('preroll');
        // A break counts when it begins, its time when it ends (as on macOS).
        if (!skipping) {
          skipping = true;
          window.lurk.blocker.record({ kind: 'skipStart' });
          setBlocked((value) => ({ ...value, breaks: value.breaks + 1 }));
        }
      },
      onPrerollDone: (seconds) => {
        if (cancelled) return;
        window.lurk.blocker.record({ kind: 'skipEnd', channel: channelName.current || 'Stream', seconds });
        setBlocked((value) => ({ ...value, seconds: value.seconds + seconds }));
      },
      onPrune: (report) => {
        if (cancelled) return;
        window.lurk.blocker.record({
          kind: 'prune',
          channel: channelName.current || 'Stream',
          segments: report.removedSegments,
          seconds: report.removedSeconds,
          rule: [...report.rules].sort()[0] ?? 'm3u-prune',
        });
      },
      onReattach: () => !cancelled && setReattaching(true),
      onDetour: (switched, until) => !cancelled && setDetour({ channel: switched, until }),
      onDetourUpdate: (until) => !cancelled && setDetour((value) => (value ? { ...value, until } : value)),
      onDetourEnd: () => !cancelled && setDetour(null),
      onNoAlternative: (active, until) => !cancelled && setNoAlternative(active ? { until } : null),
      onPlaying: () => {
        if (cancelled) return;
        setReattaching(false);
        setPhase('playing');
        if (historyRecord) {
          window.lurk.library.record(historyRecord);
          historyRecord = null;
        }
      },
      onLevels: (list) => !cancelled && setLevels(list),
      onLevel: (index) => !cancelled && setShownLevel(index),
      onChosenLevel: (index) => !cancelled && setChosenLevel(index),
      // A mid-roll: hidden from the moment playback reaches it; counted like a pre-roll.
      onAdHide: (until) => {
        if (cancelled) return;
        setAdHide({ until });
        window.lurk.blocker.record({ kind: 'skipStart' });
        setBlocked((value) => ({ ...value, breaks: value.breaks + 1 }));
      },
      onAdUpdate: (until) => !cancelled && setAdHide({ until }),
      onAdResume: (seconds) => {
        if (cancelled) return;
        setAdHide(null);
        window.lurk.blocker.record({ kind: 'skipEnd', channel: channelName.current || 'Stream', seconds });
        setBlocked((value) => ({ ...value, seconds: value.seconds + seconds }));
      },
      onAdCancel: () => !cancelled && setAdHide(null),
      // The second source took over: a break that never showed.
      onSourceSwitch: () => {
        if (cancelled) return;
        window.lurk.blocker.record({ kind: 'switch', channel: channelName.current || 'Stream' });
        setBlocked((value) => ({ ...value, breaks: value.breaks + 1 }));
        toast.show({ text: t('sourceSwitched') });
      },
      onFatal: (message) => {
        if (cancelled) return;
        setFailure(message);
        setPhase('failed');
      },
    });
    engine.current = session;
    void (async () => {
      try {
        if (target.kind === 'live') {
          const details = await window.lurk.twitch.channel(target.login);
          if (cancelled) return;
          setChannel(details);
          if (!details) throw new Error(t('notFound'));
          channelName.current = details.ref.displayName;
          if (!details.stream) {
            setPhase('offline');
            return;
          }
          historyRecord = {
            target: { kind: 'live', login: details.ref.login },
            channelLogin: details.ref.login,
            channelName: details.ref.displayName,
            title: details.stream.title,
            gameName: details.stream.game?.displayName ?? null,
            thumbnailURL: details.ref.profileImageURL,
            duration: null,
          };
          await session.start(target, { channelId: details.ref.id });
        } else {
          const details = await window.lurk.twitch.video(target.id);
          if (cancelled) return;
          setVod(details);
          if (!details) throw new Error(t('notFound'));
          channelName.current = details.owner?.displayName ?? '';
          historyRecord = {
            target,
            channelLogin: details.owner?.login ?? '',
            channelName: details.owner?.displayName ?? '',
            title: details.title,
            gameName: details.game?.displayName ?? null,
            thumbnailURL: details.thumbnailURL,
            duration: details.lengthSeconds || null,
          };
          // A video starts where it was left ("Position in Videos merken").
          const resume = await window.lurk.library.resumePosition(target.id, details.lengthSeconds || null);
          if (cancelled) return;
          await session.start(target, { startPosition: resume });
        }
      } catch (error) {
        if (cancelled) return;
        setFailure(error instanceof Error ? error.message : String(error));
        setPhase('failed');
      }
    })();
    return () => {
      cancelled = true;
      session.destroy();
      engine.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new session only for a new target or a retry
  }, [targetKey, attempt]);

  // The ad-break switch follows its setting at once ("…" menu or the settings tab).
  const adSwitch = settings?.player.adSwitch ?? true;
  useEffect(() => {
    engine.current?.setAdSwitch(adSwitch);
  }, [adSwitch]);

  // Watch time for the switch's ranking: 5 s for every 5 s of real playback – the channel on
  // screen (during the switch the shown one), never a clip, a hidden break, a pause or a stall. It
  // follows the picture's own clock, as the macOS app's time observer: jumps (the live edge, another
  // source) do not count.
  const watchedId = useRef<string | null>(null);
  watchedId.current =
    phase === 'playing' && !adHide && !reattaching
      ? (detour?.channel.id ?? (target.kind === 'live' ? channel?.ref.id : vod?.owner?.id) ?? null)
      : null;
  useEffect(() => {
    let element: HTMLVideoElement | null = null;
    let id: string | null = null;
    let last = 0;
    let played = 0;
    const timer = window.setInterval(() => {
      const current = video.current;
      if (current !== element || watchedId.current !== id) {
        element = current;
        id = watchedId.current;
        played = 0;
        last = current?.currentTime ?? 0;
        return;
      }
      if (!element || !id) return;
      const step = element.currentTime - last;
      last = element.currentTime;
      if (element.paused || step <= 0 || step > maxWatchStep) return;
      played += step;
      if (played < watchTimeStep) return;
      played -= watchTimeStep;
      window.lurk.library.addWatchTime(id, watchTimeStep);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // A video's position: every 10 s while the page shows it, and once more on leaving, as the macOS
  // app keeps it. The main process ignores it while "Position in Videos merken" is off. The last
  // played time is kept as it goes: on leaving, the session has already emptied the element.
  const vodLength = vod?.lengthSeconds ?? null;
  useEffect(() => {
    const element = video.current;
    if (target.kind !== 'vod' || !element) return;
    const id = target.id;
    let played = 0;
    const onTime = () => {
      if (element.currentTime > 0) played = element.currentTime;
    };
    const save = () => {
      if (played > 0) window.lurk.library.saveProgress(id, played, vodLength || null);
    };
    element.addEventListener('timeupdate', onTime);
    const timer = window.setInterval(save, 10_000);
    return () => {
      element.removeEventListener('timeupdate', onTime);
      window.clearInterval(timer);
      save();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one per video and its length
  }, [targetKey, vodLength]);

  // Volume and mute are remembered (the macOS app keeps the volume too).
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let timer: number | undefined;
    void window.lurk.settings.get().then(({ player }) => {
      element.volume = player.volume;
      element.muted = player.muted;
    });
    const save = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void window.lurk.settings.update({ player: { volume: element.volume, muted: element.muted } });
      }, 400);
    };
    element.addEventListener('volumechange', save);
    return () => {
      window.clearTimeout(timer);
      element.removeEventListener('volumechange', save);
    };
  }, []);

  const ref = target.kind === 'live' ? (channel?.ref ?? null) : (vod?.owner ?? null);
  // Like the macOS app's displayTitle: the stream's title, else the channel; a VOD's, else "Video".
  const title =
    target.kind === 'live'
      ? channel?.stream?.title || channel?.ref.displayName || target.login
      : vod?.title || t('video');
  // The window title as in the macOS player: the channel, for a VOD "<Owner> – <Titel>".
  const windowTitle =
    target.kind === 'live'
      ? (channel?.ref.displayName ?? target.login)
      : vod
        ? t('vodTitle', { owner: vod.owner?.displayName ?? t('video'), title: vod.title })
        : t('video');
  useEffect(() => {
    document.title = windowTitle;
    return () => {
      document.title = 'Lurk';
    };
  }, [windowTitle]);

  // Escape leaves fullscreen.
  useEffect(() => {
    if (!fullScreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') window.lurk.setFullScreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullScreen]);

  const link = target.kind === 'live' ? twitchUrl({ kind: 'channel', login: target.login }) : twitchUrl(target);
  const live = target.kind === 'live' && Boolean(channel?.stream);

  async function showQualityMenu(event: MouseEvent<HTMLButtonElement>) {
    const entries: MenuEntry[] = [
      { type: 'item', id: '-1', label: t('auto'), checked: chosenLevel === -1 },
      ...[...levels]
        .sort((a, b) => b.bitrate - a.bitrate)
        .map((level): MenuEntry => ({
          type: 'item',
          id: String(level.index),
          label: levelLabel(level, t),
          checked: chosenLevel === level.index,
        })),
    ];
    const chosen = await controls.withMenu(() => window.lurk.showMenu(entries, below(event.currentTarget)));
    if (chosen === null) return;
    const index = Number(chosen);
    setChosenLevel(index);
    engine.current?.setLevel(index);
  }

  async function showMoreMenu(event: MouseEvent<HTMLButtonElement>) {
    const chosen = await controls.withMenu(() =>
      window.lurk.showMenu(
        [
          { type: 'item', id: 'copy', label: t('copyLink') },
          { type: 'item', id: 'open', label: t('openOnTwitch') },
          ...(live ? [{ type: 'item' as const, id: 'adSwitch', label: t('adSwitchMenu'), checked: adSwitch }] : []),
        ],
        below(event.currentTarget),
      ),
    );
    if (chosen === 'copy') window.lurk.copyLink(link);
    if (chosen === 'open') window.lurk.openExternal(link);
    if (chosen === 'adSwitch') void window.lurk.settings.update({ player: { adSwitch: !adSwitch } });
  }

  const shown = levels.find((level) => level.index === (chosenLevel === -1 ? shownLevel : chosenLevel));
  const qualityLabel =
    chosenLevel === -1
      ? shown
        ? t('autoWith', { level: levelLabel(shown, t) })
        : t('auto')
      : shown
        ? levelLabel(shown, t)
        : t('auto');
  const shortcut = fullScreenShortcut[platform];
  /** Ads are being skipped: the pre-roll wait or a hidden mid-roll. */
  const skipping = phase === 'preroll' || (phase === 'playing' && adHide !== null);
  // Once a clip played in this break, the next one takes its place without the preview in between.
  const clipShown = adClip.clip !== null && playingClip !== null;

  return (
    <div className="player-layout">
      <div className={`player-page${cinema ? ' is-cinema' : ''}`}>
        <div
          className="stage dark-scope"
          onMouseMove={controls.reveal}
          onMouseLeave={controls.leave}
          // Keyboard users: focus on the stage shows the bar, so Tab can reach it.
          onFocus={controls.reveal}
          aria-label={t('player')}
          role="region"
        >
          <video
            ref={video}
            className={`stage-video${phase === 'playing' && !reattaching ? ' is-visible' : ''}`}
            controls
            controlsList="nodownload nofullscreen noremoteplayback"
            playsInline
          />

          {phase === 'loading' ? (
            <div className="stage-center message-area">
              <Spinner size="large" label={t('loading')} />
            </div>
          ) : null}

          {reattaching && phase === 'playing' && !skipping ? (
            <div className="stage-center message-area">
              <Spinner size="large" label={t('loading')} />
            </div>
          ) : null}
          {skipping && !clipShown ? <AdWaitBackdrop url={channel?.stream?.previewImageURL ?? null} /> : null}
          {adClip.clip ? (
            <video
              key={adClip.clip.slug}
              // The stage's video look; above the stream, which is not shown meanwhile.
              className={`stage-video stage-clip${clipShown ? ' is-visible' : ''}`}
              src={adClip.clip.url}
              aria-label={t('clipLabel')}
              autoPlay
              playsInline
              // The player's own controls, as the macOS app plays the clip in the stream's player:
              // volume and mute stay at hand during the break, and they are the stream's.
              controls
              controlsList="nodownload nofullscreen noremoteplayback"
              ref={(element) => {
                if (element && video.current) {
                  element.volume = video.current.volume;
                  element.muted = video.current.muted;
                }
              }}
              onVolumeChange={(event) => {
                const stream = video.current;
                if (!stream) return;
                stream.volume = event.currentTarget.volume;
                stream.muted = event.currentTarget.muted;
              }}
              onPlaying={() => setPlayingClip(adClip.clip?.slug ?? null)}
              onEnded={adClip.next}
              onError={adClip.drop}
            />
          ) : null}

          {phase === 'offline' && channel ? (
            <OfflinePanel
              channel={channel}
              onPast={() => open({ kind: 'channel', login: channel.ref.login, displayName: channel.ref.displayName })}
            />
          ) : null}

          {phase === 'failed' ? (
            <div className="stage-center message-area">
              <EmptyState
                icon={TriangleExclamationPoint}
                title={t('failedTitle')}
                text={failure ?? undefined}
                action={{ label: t('retry'), onClick: () => setAttempt((value) => value + 1) }}
              />
            </div>
          ) : null}

          {phase === 'playing' ? (
            <div
              className={`control-bar fade-toggle${controls.visible ? ' is-visible' : ''}`}
              // While keyboard focus is in the bar, it stays open.
              onFocus={(event) => {
                // Keyboard focus only: a mouse click leaves focus on the button, and the bar should still hide.
                if (event.target.matches(':focus-visible')) controls.pin();
              }}
              onBlur={(event) => {
                // Focus moving into the shield's popover keeps the bar open.
                if (!blockerOpen && !event.currentTarget.contains(event.relatedTarget)) controls.unpin();
              }}
            >
              {levels.length > 0 ? (
                <>
                  <button
                    type="button"
                    className="bar-text-button"
                    title={t('quality')}
                    aria-haspopup="menu"
                    onClick={showQualityMenu}
                  >
                    <span>{qualityLabel}</span>
                    <Icon icon={ChevronDown} size={11} />
                  </button>
                  <BarDivider />
                </>
              ) : null}
              {live ? (
                <BarIcon
                  icon={MessagesSquare}
                  on={showChat}
                  help={
                    showChat
                      ? t('chat:hide', { shortcut: chatShortcut[platform] })
                      : t('chat:show', { shortcut: chatShortcut[platform] })
                  }
                  onClick={() => void window.lurk.settings.update({ player: { showChat: !showChat } })}
                />
              ) : null}
              <BlockerButton
                enabled={settings?.blocker.enabled ?? true}
                stream={blocked}
                onOpenChange={(open) => {
                  setBlockerOpen(open);
                  if (open) controls.pin();
                  else controls.unpin();
                }}
                onToggle={(enabled) => {
                  // Takes effect at once: the same Twitch session plays again, with or without the
                  // filter – bar, popover and quality stay (as the macOS app's setAdBlock).
                  void window.lurk.settings.update({ blocker: { enabled } }).then(() => engine.current?.reload());
                }}
              />
              <BarIcon icon={Ellipsis} size={14} help={t('more')} menu onClick={showMoreMenu} />
              <BarIcon
                icon={fullScreen ? Minimize2 : Maximize2}
                help={fullScreen ? t('exitFullscreen', { shortcut }) : t('fullscreen', { shortcut })}
                onClick={() => window.lurk.setFullScreen(!fullScreen)}
              />
            </div>
          ) : null}

          {cinema && controls.visible && ref ? (
            <div className="status-badges">
              <div className="channel-badge">
                <Avatar url={ref.profileImageURL} size={34} live={live} />
                <span className="channel-badge-text">
                  <span className="channel-badge-name">{ref.displayName}</span>
                  <span className="channel-badge-title">{title}</span>
                </span>
              </div>
            </div>
          ) : null}

          <div className="banners">
            {skipping ? (
              <AdSkipBanner
                kind={phase === 'preroll' ? 'preroll' : 'midroll'}
                end={phase === 'preroll' ? prerollEnd : (adHide?.until ?? null)}
                clipTitle={clipShown ? (adClip.clip?.title ?? '') : null}
              />
            ) : null}
            {raids.pending && ref ? (
              <RaidBanner source={ref.displayName} raid={raids.pending} stay={raids.stay} goNow={raids.goNow} />
            ) : null}
            {detour && ref ? (
              <AdBreakBanner
                primary={ref.displayName}
                channel={detour.channel.displayName}
                until={detour.until}
                onBack={() => engine.current?.goBack()}
                onStay={() => {
                  const adopted = engine.current?.adoptDetour();
                  if (adopted) open({ kind: 'play', target: { kind: 'live', login: adopted.login } });
                }}
              />
            ) : noAlternative && !skipping && ref ? (
              <AdBreakBanner primary={ref.displayName} channel={null} until={noAlternative.until} />
            ) : null}
          </div>
          {/* The live region is always there and gets its text later, so every screen reader
            announces it – once: the visible countdown is not read out every second. */}
          <span className="visually-hidden" role="status">
            {phase === 'preroll'
              ? `${t('prerollTitle')}. ${t('prerollDetail')}`
              : adHide
                ? `${t('midrollTitle')}. ${t('midrollDetail')}`
                : detour && ref
                  ? t('detourTitle', { primary: ref.displayName, channel: detour.channel.displayName })
                  : noAlternative && ref
                    ? `${t('breakTitle', { primary: ref.displayName })}. ${t('noAlternative')}`
                    : raids.pending && ref
                      ? `${t('chat:raidTitle', { source: ref.displayName, target: raids.pending.target.displayName })}. ${t('chat:raidDetailNoViewers')}`
                      : ''}
          </span>
          <Toast toast={toast.toast} className="stage-toast" />
        </div>

        {cinema ? null : (
          <InfoStrip
            title={title}
            channel={ref}
            live={live}
            game={target.kind === 'live' ? (channel?.stream?.game ?? null) : (vod?.game ?? null)}
            details={target.kind === 'live' ? liveDetails(channel, t, language) : vodDetails(vod, t, language)}
            open={open}
          />
        )}
      </div>
      {/* As the macOS app: only for live streams and while "Chat" is on – also in fullscreen. */}
      {showChat && live && target.kind === 'live' && settings ? (
        <ChatPanel
          login={target.login}
          thirdPartyEmotes={settings.player.thirdPartyEmotes}
          animatedEmotes={settings.player.animatedEmotes}
        />
      ) : null}
    </div>
  );
}

function levelLabel(level: QualityLevel, t: (key: string) => string): string {
  // Twitch's own name ("1080p60", "480p30"), as the macOS app shows it.
  const name = level.name ?? (level.height ? `${level.height}p` : 'audio_only');
  if (name === 'audio_only' || !level.height) return t('audioOnly');
  return `${name}${level.isSource ? ` (${t('source')})` : ''}`;
}

/** The point below a button, in window coordinates, for a native menu. */
function below(element: HTMLElement): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom + 4 };
}

/** The bar shows on mouse movement and hides 2.5 s later, 0.8 s after leaving; never while a menu is open. */
function useBarVisibility() {
  const [visible, setVisible] = useState(true);
  const timer = useRef<number | undefined>(undefined);
  const pinned = useRef(false);

  const schedule = useCallback((ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (!pinned.current) setVisible(false);
    }, ms);
  }, []);

  useEffect(() => {
    schedule(hideAfterMs);
    return () => window.clearTimeout(timer.current);
  }, [schedule]);

  return {
    visible,
    reveal: () => {
      setVisible(true);
      schedule(hideAfterMs);
    },
    leave: () => schedule(hideAfterLeaveMs),
    pin: () => {
      pinned.current = true;
      setVisible(true);
    },
    unpin: () => {
      pinned.current = false;
      schedule(hideAfterMs);
    },
    async withMenu<T>(show: () => Promise<T>): Promise<T> {
      // A menu opened from the keyboard: focus stays on its button, so the earlier pin stays too.
      const before = pinned.current;
      pinned.current = true;
      setVisible(true);
      try {
        return await show();
      } finally {
        pinned.current = before;
        if (!before) schedule(hideAfterMs);
      }
    },
  };
}

function BarIcon({
  icon,
  help,
  label,
  size = 13,
  menu = false,
  on,
  popover,
  iconClassName,
  className = '',
  buttonRef,
  children,
  onClick,
}: {
  icon: LucideIcon;
  /** The tooltip; also the name unless `label` gives one. */
  help: string;
  label?: string;
  /** A switch: on shows the accent symbol on a faint fill (the chat toggle). */
  on?: boolean;
  /** 13 as the reference's bar symbols; the "…" is drawn at 14 there. */
  size?: number;
  /** Opens a menu. */
  menu?: boolean;
  /** Opens a `Popover`: its id and whether it is open. */
  popover?: { id: string; open: boolean };
  iconClassName?: string;
  className?: string;
  buttonRef?: RefObject<HTMLButtonElement | null>;
  /** Drawn over the symbol (the shield's count). */
  children?: ReactNode;
  onClick(event: MouseEvent<HTMLButtonElement>): void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`bar-icon${on ? ' is-on' : ''}${className ? ` ${className}` : ''}`}
      title={help}
      aria-label={label ?? help}
      aria-haspopup={menu ? 'menu' : popover ? 'dialog' : undefined}
      aria-expanded={popover?.open}
      aria-controls={popover?.id}
      onClick={onClick}
    >
      <Icon icon={icon} size={size} className={iconClassName} />
      {children}
    </button>
  );
}

/**
 * The shield: the ad blocker's switch and counts, like uBlock's popup (the macOS app's
 * BlockerButton and BlockerPopover). The count on the shield is this stream's skipped breaks.
 */
function BlockerButton({
  enabled,
  stream,
  onOpenChange,
  onToggle,
}: {
  enabled: boolean;
  stream: { breaks: number; seconds: number };
  onOpenChange(open: boolean): void;
  onToggle(enabled: boolean): void;
}) {
  const { t, i18n } = useTranslation('player');
  const anchor = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [totals, setTotals] = useState<BlockerTotals>(emptyTotals);
  const number = (value: number) => formatNumber(value, i18n.language);
  const shield = enabled ? ShieldHalf : ShieldOff;
  const shieldClass = enabled ? 'shield-on' : 'shield-off';

  useEffect(() => {
    let alive = true;
    void window.lurk.blocker.state().then((state) => alive && setTotals(state.totals));
    const off = window.lurk.blocker.onChange((state) => setTotals(state.totals));
    return () => {
      alive = false;
      off();
    };
  }, []);

  const close = useCallback(() => setOpen(false), []);
  useEffect(() => onOpenChange(open), [open]); // eslint-disable-line react-hooks/exhaustive-deps -- reports changes only

  return (
    <>
      <BarIcon
        buttonRef={anchor}
        icon={shield}
        iconClassName={shieldClass}
        className="blocker-shield"
        help={enabled ? t('blocker.on') : t('blocker.off')}
        label={t('blocker.name')}
        popover={{ id, open }}
        onClick={() => setOpen((value) => !value)}
      >
        {enabled && stream.breaks > 0 ? (
          <span className="shield-count" aria-hidden="true">
            {number(stream.breaks)}
          </span>
        ) : null}
      </BarIcon>
      <Popover
        id={id}
        open={open}
        anchor={anchor}
        label={t('blocker.name')}
        className="blocker-popover"
        // The player is dark in every appearance, its popover too (as on macOS).
        dark
        onClose={close}
      >
        <div className="blocker-popover-head">
          <Icon icon={shield} size={26} className={shieldClass} />
          <span className="blocker-popover-text">
            <span className="blocker-popover-title">{t('blocker.name')}</span>
            <span className="blocker-popover-detail">{enabled ? t('blocker.onDetail') : t('blocker.offDetail')}</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={enabled}
            aria-label={t('blocker.name')}
            onChange={(event) => onToggle(event.target.checked)}
          />
        </div>
        <hr className="blocker-popover-line" />
        <table className="blocker-popover-table">
          <thead>
            <tr>
              <td />
              <th scope="col">{t('blocker.thisStream')}</th>
              <th scope="col">{t('blocker.total')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">{t('blocker.breaks')}</th>
              <td>{number(stream.breaks)}</td>
              <td>{number(totals.adBreaks)}</td>
            </tr>
            <tr>
              <th scope="row">{t('blocker.hidden')}</th>
              <td>{formatDuration(stream.seconds)}</td>
              <td>{formatDuration(totals.adSeconds)}</td>
            </tr>
            <tr>
              <th scope="row">{t('blocker.requests')}</th>
              <td className="is-none">–</td>
              <td>{number(totals.blockedRequests)}</td>
            </tr>
          </tbody>
        </table>
        <p className="blocker-popover-note">{t('blocker.note')}</p>
        <button
          type="button"
          className="button blocker-popover-link"
          onClick={() => window.lurk.openSettings('blocker')}
        >
          <Icon icon={ListChecks} size={13} />
          {t('blocker.settings')}
        </button>
      </Popover>
    </>
  );
}

function BarDivider() {
  return <span className="bar-divider" aria-hidden="true" />;
}

/** While ads are skipped without a clip: the stream's preview image, dimmed, with a spinner. */
function AdWaitBackdrop({ url }: { url: string | null }) {
  // A fresh image: Twitch caches preview images for a while.
  const [fresh] = useState(() => (url ? `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}` : null));
  return (
    <div className="ad-backdrop" aria-hidden="true">
      {fresh ? <img src={fresh} alt="" /> : null}
      <div className="ad-dim" />
      <Spinner size="large" />
    </div>
  );
}

/**
 * While Lurk skips ads: what kind, what plays meanwhile and the time left (the macOS app's
 * AdSkipBanner). Bottom left, at the edge – not in the middle of the picture.
 */
function AdSkipBanner({
  kind,
  end,
  clipTitle,
}: {
  kind: 'preroll' | 'midroll';
  end: number | null;
  /** The clip that plays meanwhile; null without one. */
  clipTitle: string | null;
}) {
  const { t } = useTranslation('player');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const detail =
    clipTitle !== null
      ? t('clipDetail', { title: clipTitle || t('untitledClip') })
      : kind === 'preroll'
        ? t('prerollDetail')
        : t('midrollDetail');
  // Whole seconds left, cut off as the macOS app counts them.
  const seconds = end === null ? null : Math.max(0, Math.floor((end - now) / 1000));
  return (
    <FloatingPanel className="banner">
      <div className="banner-content" aria-hidden="true">
        <Icon icon={ShieldHalf} size={18} className="banner-icon" />
        <span className="banner-text">
          <span className="banner-title">{kind === 'preroll' ? t('prerollTitle') : t('midrollTitle')}</span>
          <span className="banner-detail">
            <span className="banner-detail-text">{detail}</span>
            {seconds === null ? null : <span className="banner-detail-time">{t('remainingTime', { seconds })}</span>}
          </span>
        </span>
      </div>
    </FloatingPanel>
  );
}

/** Clips that may fail to play in one break before the dimmed preview stays. */
const clipAttempts = 3;

/**
 * A popular clip of the channel while ads are skipped (the macOS app's AdFiller): random among the
 * ten most viewed, none twice in a break until all were seen. `next` when one ends, `drop` when it
 * cannot play – the next is tried, and after three failures the dimmed preview stays.
 */
function useAdClip(
  login: string | null,
  active: boolean,
): { clip: { slug: string; title: string; url: string } | null; next(): void; drop(): void } {
  const [clip, setClip] = useState<{ slug: string; title: string; url: string } | null>(null);
  const played = useRef(new Set<string>());
  const failures = useRef(0);
  const run = useRef(0);
  const next = useCallback(() => {
    const current = ++run.current;
    if (!login) return;
    void (async () => {
      try {
        const clips = await window.lurk.twitch.adClips(login);
        for (const slug of pickClipSlugs(clips, played.current)) {
          const url = await window.lurk.twitch.clipSource(slug, 1080);
          if (current !== run.current) return;
          if (url) {
            played.current.add(slug);
            setClip({ slug, title: clips.find((entry) => entry.slug === slug)?.title ?? '', url });
            return;
          }
        }
      } catch {
        // No clip: the dimmed preview shows.
      }
      if (current === run.current) setClip(null);
    })();
  }, [login]);
  const drop = useCallback(() => {
    failures.current += 1;
    if (failures.current < clipAttempts) {
      next();
      return;
    }
    run.current += 1;
    setClip(null);
  }, [next]);
  useEffect(() => {
    if (active) next();
    else {
      run.current += 1;
      played.current.clear();
      failures.current = 0;
      setClip(null);
    }
  }, [active, next]);
  return { clip, next, drop };
}

function OfflinePanel({ channel, onPast }: { channel: ChannelDetails; onPast(): void }) {
  const { t, i18n } = useTranslation('player');
  const last = channel.lastBroadcast;
  const when = last?.startedAt ? formatRelative(last.startedAt, i18n.language) : null;
  return (
    <div className="stage-center message-area">
      <Avatar url={channel.ref.profileImageURL} size={80} />
      <h2 className="offline-title">{t('offline', { name: channel.ref.displayName })}</h2>
      {when ? (
        <p className="offline-text">
          {last?.title ? t('lastLiveTitle', { when, title: last.title }) : t('lastLive', { when })}
        </p>
      ) : null}
      <button type="button" className="button" onClick={onPast}>
        {t('pastBroadcasts')}
      </button>
    </div>
  );
}

/** "62.528 Zuschauer · live seit 1:23 h", or null before the stream is known. */
function liveDetails(channel: ChannelDetails | null, t: TFunction<'player'>, language: string): string | null {
  const stream = channel?.stream;
  if (!stream) return null;
  const parts = [t('shell:search.viewers', { value: formatNumber(stream.viewersCount, language) })];
  if (stream.startedAt) parts.push(t('liveSince', { value: formatUptime(stream.startedAt) }));
  return parts.join(' · ');
}

/** "2:03:04 · vor 3 Tagen · 1.234 Aufrufe". */
function vodDetails(vod: VideoDetails | null, t: TFunction<'player'>, language: string): string | null {
  if (!vod) return null;
  const parts = [formatDuration(vod.lengthSeconds)];
  if (vod.publishedAt) parts.push(formatRelative(vod.publishedAt, language));
  if (vod.viewCount !== null) parts.push(t('views', { value: formatNumber(vod.viewCount, language) }));
  return parts.join(' · ');
}

/** The strip under the picture: channel, title, category and numbers. */
function InfoStrip({
  title,
  channel,
  live,
  game,
  details,
  open,
}: {
  title: string;
  channel: ChannelRef | null;
  live: boolean;
  game: GameRef | null;
  details: string | null;
  open(route: Route): void;
}) {
  return (
    <div className="info-strip">
      <Avatar url={channel?.profileImageURL ?? null} size={42} live={live} />
      <div className="info-text">
        <p className="info-title">{title}</p>
        <p className="info-line">
          {channel ? (
            <button
              type="button"
              className="link"
              onClick={() => open({ kind: 'channel', login: channel.login, displayName: channel.displayName })}
            >
              {channel.displayName}
            </button>
          ) : null}
          {game ? (
            <>
              <span className="info-dot">·</span>
              <button type="button" className="link" onClick={() => open({ kind: 'category', game })}>
                {game.displayName}
              </button>
            </>
          ) : null}
          {/* The dot only stands before something (the reference checks for empty details). */}
          {details ? (
            <>
              <span className="info-dot">·</span>
              <span className="info-details">{details}</span>
            </>
          ) : null}
        </p>
      </div>
      {channel ? (
        <div className="info-actions">
          <SubscribeButton channel={channel} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The ad-break switch (the macOS app's AdBreakBanner): while another subscribed channel shows, with
 * "Zurück" and "Bei B bleiben"; without one, only what happens (ads then play as they are).
 */
function AdBreakBanner({
  primary,
  channel,
  until,
  onBack,
  onStay,
}: {
  primary: string;
  /** The channel shown meanwhile; null without a clear one. */
  channel: string | null;
  until: number | null;
  onBack?(): void;
  onStay?(): void;
}) {
  const { t } = useTranslation('player');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = until === null ? null : Math.max(0, Math.floor((until - now) / 1000));
  return (
    <FloatingPanel className="banner">
      <div className="banner-content action-banner">
        <Icon icon={channel ? ArrowLeftRight : Megaphone} size={18} className="banner-icon" />
        <span className="banner-text" aria-hidden="true">
          <span className="banner-title">
            {channel ? t('detourTitle', { primary, channel }) : t('breakTitle', { primary })}
          </span>
          <span className="banner-detail">
            {channel ? (
              <span className="banner-detail-text">
                {seconds === null ? t('detourBackLater') : t('detourBack', { seconds })}
              </span>
            ) : (
              <>
                <span className="banner-detail-text">{t('noAlternative')}</span>
                {seconds === null ? null : (
                  <span className="banner-detail-time">{t('remainingTime', { seconds })}</span>
                )}
              </>
            )}
          </span>
        </span>
        {channel ? (
          <>
            <button type="button" className="button" title={t('detourReturnHelp', { primary })} onClick={onBack}>
              {t('detourReturn')}
            </button>
            <button type="button" className="button button-primary" onClick={onStay}>
              {t('detourStay', { channel })}
            </button>
          </>
        ) : null}
      </div>
    </FloatingPanel>
  );
}

/** While the channel prepares a raid. Follows RaidBanner of the macOS app. */
function RaidBanner({ source, raid, stay, goNow }: { source: string; raid: PendingRaid; stay(): void; goNow(): void }) {
  const { t, i18n } = useTranslation('chat');
  return (
    <FloatingPanel className="banner">
      <div className="banner-content action-banner">
        <Icon icon={Users} size={18} className="banner-icon" />
        <Avatar url={raid.target.profileImageURL} size={28} />
        <span className="banner-text">
          <span className="banner-title">{t('raidTitle', { source, target: raid.target.displayName })}</span>
          <span className="banner-detail">
            <span className="banner-detail-text">
              {raid.viewers > 0
                ? t('raidDetail', { viewers: formatNumber(raid.viewers, i18n.language) })
                : t('raidDetailNoViewers')}
            </span>
          </span>
        </span>
        <button type="button" className="button" title={t('stayHelp')} onClick={stay}>
          {t('stay')}
        </button>
        <button type="button" className="button button-primary" onClick={goNow}>
          {t('goNow')}
        </button>
      </div>
    </FloatingPanel>
  );
}
