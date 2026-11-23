// Tiles and rows of the list pages: a live stream, a video, a category, a channel. Port of
// HoverThumbnail, StreamCard, VideoCard, ProgressStrip, GameCard, ChannelRow and TargetMenu of the
// macOS app (lurk-macos, Sources/Lurk/Views/Components.swift). The right-click menus are system menus.

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Play, User } from 'lucide-react';
import type { BrowseStream } from '@shared/browse';
import { formatCompact, formatDuration, formatRelative, formatUptime, formatViewers } from '@shared/format';
import { progressFraction } from '@shared/library';
import { twitchUrl } from '@shared/links';
import type { ChannelRef, Game, GameRef, PlayTarget, VideoDetails } from '@shared/models';
import type { Route } from '../shell/router';
import { Avatar, Icon, LiveBadge, Pill } from './index';
import { livePreviewer, usePreview } from './livePreview';
import { useOpenRoute } from './navigation';
import { SubscribeButton } from './SubscribeButton';
import './tiles.css';

/** A picture that lifts a little under the pointer and shows a play symbol. */
export function HoverThumbnail({
  url,
  shape = 'video',
  showsPlay = true,
  children,
}: {
  url: string | null;
  /** 16 : 9 for streams, 3 : 4 for box art. */
  shape?: 'video' | 'box-art';
  showsPlay?: boolean;
  children?: ReactNode;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span className={`thumb thumb-${shape}`}>
      {url && failed !== url ? (
        <img className="thumb-image" src={url} alt="" loading="lazy" draggable={false} onError={() => setFailed(url)} />
      ) : null}
      {children}
      {showsPlay ? (
        <span className="thumb-play" aria-hidden="true">
          <Icon icon={Play} size={20} />
        </span>
      ) : null}
    </span>
  );
}

/** Twitch renews its preview pictures every few minutes; the macOS app asks per 5 minutes. */
export function freshPreviewURL(url: string | null): string | null {
  if (!url) return null;
  try {
    const fresh = new URL(url);
    fresh.searchParams.set('t', String(Math.floor(Date.now() / 300_000)));
    return fresh.toString();
  } catch {
    return url;
  }
}

/** Where a menu opened from the keyboard appears: below the element instead of at the pointer. */
export function menuPoint(event: MouseEvent<HTMLElement>): { x: number; y: number } {
  if (event.clientX !== 0 || event.clientY !== 0) return { x: event.clientX, y: event.clientY };
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: rect.left + 12, y: rect.top + 12 };
}

/**
 * The menu of something to watch (the macOS app's TargetMenu, without what arrives in later parts):
 * Ansehen; the channel and the category; the link. `extra` entries come last (the history's
 * "Aus dem Verlauf entfernen"); the chosen extra id is returned.
 */
export async function showTargetMenu(
  event: MouseEvent<HTMLElement>,
  what: {
    target: PlayTarget;
    /** With its id, the menu offers "Abonnieren" / "Abo beenden". */
    channel: { login: string; displayName: string; id?: string; profileImageURL?: string | null } | null;
    game: GameRef | null;
  },
  open: (route: Route) => void,
  t: TFunction<'browse'>,
  extra: { id: string; label: string }[] = [],
): Promise<string | null> {
  event.preventDefault();
  const point = menuPoint(event);
  const { target, channel, game } = what;
  const link = twitchUrl(target.kind === 'live' ? { kind: 'channel', login: target.login } : target);
  const subscribable = channel?.id ? channel : null;
  const subscribed = subscribable
    ? (await window.lurk.library.get()).subscriptions.some((entry) => entry.id === subscribable.id)
    : false;
  const chosen = await window.lurk.showMenu(
    [
      { type: 'item', id: 'watch', label: t('menu.watch') },
      { type: 'separator' },
      ...(channel ? [{ type: 'item' as const, id: 'channel', label: t('menu.openChannel') }] : []),
      ...(subscribable
        ? [{ type: 'item' as const, id: 'subscribe', label: subscribed ? t('subscribe.end') : t('subscribe.action') }]
        : []),
      ...(game
        ? [{ type: 'item' as const, id: 'category', label: t('menu.openCategory', { name: game.displayName }) }]
        : []),
      ...(channel || game ? [{ type: 'separator' as const }] : []),
      { type: 'item', id: 'copy', label: t('player:copyLink') },
      { type: 'item', id: 'twitch', label: t('player:openOnTwitch') },
      ...(extra.length ? [{ type: 'separator' as const }] : []),
      ...extra.map((entry) => ({ type: 'item' as const, ...entry })),
    ],
    point,
  );
  switch (chosen) {
    case 'watch':
      open({ kind: 'play', target });
      return null;
    case 'channel':
      if (channel) open({ kind: 'channel', login: channel.login, displayName: channel.displayName });
      return null;
    case 'subscribe':
      if (subscribable?.id) {
        if (subscribed) window.lurk.subscriptions.unsubscribe(subscribable.id);
        else
          window.lurk.subscriptions.subscribe({
            id: subscribable.id,
            login: subscribable.login,
            displayName: subscribable.displayName,
            profileImageURL: subscribable.profileImageURL ?? null,
          });
      }
      return null;
    case 'category':
      if (game) open({ kind: 'category', game });
      return null;
    case 'copy':
      window.lurk.copyLink(link);
      return null;
    case 'twitch':
      window.lurk.openExternal(link);
      return null;
    default:
      return chosen;
  }
}

function showChannelMenu(
  event: MouseEvent<HTMLElement>,
  channel: ChannelRef,
  game: GameRef | null,
  open: (route: Route) => void,
  t: TFunction<'browse'>,
) {
  return showTargetMenu(event, { target: { kind: 'live', login: channel.login }, channel, game }, open, t);
}

/** How far a video was watched: a thin accent bar on a dark track at the picture's bottom edge. */
export function ProgressStrip({ fraction }: { fraction: number }) {
  return (
    <span className="progress-strip" aria-hidden="true">
      <span className="progress-strip-fill" style={{ width: `${Math.round(fraction * 1000) / 10}%` }} />
    </span>
  );
}

/** The preview's video, over the still image and under the badges. */
function LivePreviewLayer({ login }: { login: string }) {
  const preview = usePreview(login);
  const host = useRef<HTMLSpanElement>(null);
  const video = preview?.video ?? null;
  useLayoutEffect(() => {
    const element = host.current;
    if (!element || !video) return;
    element.appendChild(video);
    return () => video.remove();
  }, [video]);
  if (!preview) return null;
  return <span ref={host} className={`live-preview${preview.showing ? ' is-showing' : ''}`} aria-hidden="true" />;
}

export function StreamTile({ stream }: { stream: BrowseStream }) {
  const { t, i18n } = useTranslation('browse');
  const open = useOpenRoute();
  const login = stream.broadcaster.login;
  const previewing = usePreview(login)?.showing ?? false;
  // A tile that leaves the page takes its preview with it.
  useEffect(() => () => livePreviewer.stop(login), [login]);
  const viewers = formatViewers(stream.viewersCount, i18n.language);
  const uptime = stream.startedAt ? formatUptime(stream.startedAt) : null;
  return (
    <button
      type="button"
      className="stream-tile"
      title={stream.title}
      onClick={() => open({ kind: 'play', target: { kind: 'live', login } })}
      onMouseEnter={() => livePreviewer.start(login)}
      onMouseLeave={() => livePreviewer.stop(login)}
      onContextMenu={(event) => void showChannelMenu(event, stream.broadcaster, stream.game, open, t)}
    >
      <HoverThumbnail url={freshPreviewURL(stream.previewImageURL)} showsPlay={!previewing}>
        <LivePreviewLayer login={login} />
        <span className="thumb-marks">
          <span className="thumb-mark top-left">
            <LiveBadge />
          </span>
          <span className="thumb-mark bottom-left">
            <Pill text={viewers} icon={User} label={t('shell:search.viewers', { value: viewers })} />
          </span>
          {uptime ? (
            <span className="thumb-mark bottom-right">
              <Pill text={uptime} label={t('uptime', { value: uptime })} />
            </span>
          ) : null}
        </span>
      </HoverThumbnail>
      <span className="stream-tile-meta">
        <Avatar url={stream.broadcaster.profileImageURL} size={32} />
        <span className="stream-tile-text">
          <span className="tile-title two-lines">{stream.title || t('untitled')}</span>
          <span className="tile-line secondary">{stream.broadcaster.displayName}</span>
          <span className="tile-line tertiary">{stream.game?.displayName ?? ' '}</span>
        </span>
      </span>
    </button>
  );
}

/** A past broadcast, highlight or upload: a click plays it, where it was left. */
export function VideoTile({ video, position }: { video: VideoDetails; position: number | undefined }) {
  const { t, i18n } = useTranslation('browse');
  const open = useOpenRoute();
  const length = video.lengthSeconds || null;
  const fraction = progressFraction(position, length);
  // Always shown, "0:00" included, as the macOS app's VideoCard.
  const duration = formatDuration(video.lengthSeconds);
  const meta = [
    ...(video.publishedAt ? [formatRelative(video.publishedAt, i18n.language)] : []),
    ...(video.viewCount !== null ? [t('player:views', { value: formatCompact(video.viewCount, i18n.language) })] : []),
    ...(video.game ? [video.game.displayName] : []),
  ].join(' · ');
  const target: PlayTarget = { kind: 'vod', id: video.id };
  return (
    <button
      type="button"
      className="video-tile"
      title={video.title}
      onClick={() => open({ kind: 'play', target })}
      onContextMenu={(event) => void showTargetMenu(event, { target, channel: video.owner, game: null }, open, t)}
    >
      <HoverThumbnail url={video.thumbnailURL}>
        <span className="thumb-marks">
          <span className="thumb-mark bottom-right">
            <Pill text={duration} label={t('video.length', { value: duration })} />
          </span>
        </span>
        {fraction !== null ? <ProgressStrip fraction={fraction} /> : null}
      </HoverThumbnail>
      <span className="video-tile-text">
        <span className="tile-title two-lines">{video.title || t('untitled')}</span>
        <span className="tile-line secondary">{meta || '\u00a0'}</span>
      </span>
    </button>
  );
}

export function CategoryTile({ game }: { game: Game }) {
  const { t, i18n } = useTranslation('browse');
  const open = useOpenRoute();
  return (
    <button
      type="button"
      className="category-tile"
      title={game.displayName}
      onClick={() => open({ kind: 'category', game: { id: game.id, name: game.name, displayName: game.displayName } })}
    >
      <HoverThumbnail url={game.boxArtURL} shape="box-art" showsPlay={false} />
      <span className="tile-title one-line">{game.displayName}</span>
      <span className="tile-line secondary">
        {game.viewersCount !== null
          ? t('shell:search.viewers', { value: formatCompact(game.viewersCount, i18n.language) })
          : ' '}
      </span>
    </button>
  );
}

/**
 * A channel in the search results and on the Abos page: a click opens the stream when live, else the
 * channel page; the compact heart at the end subscribes (not on the Abos page).
 */
export function ChannelRow({
  channel,
  subtitle,
  live,
  game,
  subscribable = true,
  onMenu,
}: {
  channel: ChannelRef;
  subtitle: string | null;
  live: boolean;
  game: GameRef | null;
  subscribable?: boolean;
  /** The page's own context menu instead of the target menu (the Abos page's). */
  onMenu?: (event: MouseEvent<HTMLElement>) => void;
}) {
  const { t } = useTranslation('browse');
  const open = useOpenRoute();
  return (
    <div
      className="channel-row"
      onContextMenu={(event) =>
        onMenu
          ? onMenu(event)
          : void showTargetMenu(event, { target: { kind: 'live', login: channel.login }, channel, game }, open, t)
      }
    >
      <button
        type="button"
        className="channel-row-main"
        onClick={() =>
          open(
            live
              ? { kind: 'play', target: { kind: 'live', login: channel.login } }
              : { kind: 'channel', login: channel.login, displayName: channel.displayName },
          )
        }
      >
        <Avatar url={channel.profileImageURL} size={42} live={live} />
        <span className="channel-row-text">
          <span className="channel-row-name">
            <span className="tile-title one-line">{channel.displayName}</span>
            {live ? <LiveBadge /> : null}
          </span>
          {subtitle ? <span className="tile-line secondary">{subtitle}</span> : null}
        </span>
      </button>
      {subscribable ? <SubscribeButton channel={channel} compact /> : null}
    </div>
  );
}
