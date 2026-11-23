// A channel's page: avatar and header, the live stream or the last broadcast, then its videos.
// Port of ChannelView of the macOS app (lurk-macos, Sources/Lurk/Views/ChannelView.swift), Twitch
// only; clips arrive with stage 2, "Abonnieren" with part 6.

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Compass, Film, Play, User, UserRoundX } from 'lucide-react';
import { formatCompact, formatNumber, formatRelative, formatUptime } from '@shared/format';
import { twitchUrl } from '@shared/links';
import { videoKinds, type ChannelDetails, type VideoDetails, type VideoKind } from '@shared/models';
import {
  Avatar,
  HeaderIconButton,
  Icon,
  LiveBadge,
  LoadState,
  Page,
  PageHeader,
  SectionTitle,
  Segmented,
} from '../components';
import { useOpenRoute } from '../components/navigation';
import { SubscribeButton } from '../components/SubscribeButton';
import { HoverThumbnail, VideoTile, freshPreviewURL } from '../components/tiles';
import { useLoader } from '../components/useLoader';
import { useLibrary } from '../useLibrary';
import { useRefreshCommand } from './parts';
import './browse.css';

export function ChannelPage({ login, active }: { login: string; active: boolean }) {
  const { t, i18n } = useTranslation('browse');
  // One answer, kept as a list of one; none means there is no such channel.
  const info = useLoader<ChannelDetails>(`channel|${login}`, async () => {
    const details = await window.lurk.twitch.channel(login);
    return details ? [details] : [];
  });
  const channel = info.items[0] ?? null;
  const [kind, setKind] = useState<VideoKind>('ARCHIVE');
  const videos = useLoader<VideoDetails>(channel ? `${login}|${kind}` : null, () =>
    window.lurk.twitch.videos(login, kind),
  );
  const progress = useLibrary()?.progress ?? {};
  const reloadInfo = info.reload;
  const reloadVideos = videos.reload;
  const refresh = useCallback(() => {
    reloadInfo();
    reloadVideos();
  }, [reloadInfo, reloadVideos]);
  useRefreshCommand(active, refresh);

  if (!channel) {
    return (
      <Page>
        <LoadState
          loader={info}
          emptyIcon={UserRoundX}
          emptyTitle={t('channel.notFound')}
          emptyText={t('channel.notFoundText', { login })}
        />
      </Page>
    );
  }

  const facts = [
    ...(channel.followers !== null
      ? [t('search.followers', { value: formatCompact(channel.followers, i18n.language) })]
      : []),
    ...(channel.stream ? [t('channel.live')] : []),
  ].join(' · ');

  return (
    <Page>
      <div className="art-head is-centered">
        <Avatar url={channel.ref.profileImageURL} size={84} live={channel.stream !== null} />
        <PageHeader title={channel.ref.displayName} subtitle={facts || null} detail={channel.description}>
          <SubscribeButton channel={channel.ref} />
          <HeaderIconButton
            title={t('player:openOnTwitch')}
            icon={Compass}
            onClick={() => window.lurk.openExternal(twitchUrl({ kind: 'channel', login: channel.ref.login }))}
          />
        </PageHeader>
      </div>
      {/* A failed refresh below the head, as on the list pages – once: when the videos failed too,
          their failure stands for both, and its "Erneut versuchen" reloads both. */}
      {info.error !== null && videos.error === null ? <LoadState loader={info} emptyText="" /> : null}
      {channel.stream ? <LiveBanner channel={channel} /> : <OfflineBanner channel={channel} />}
      <div className="section-row">
        <SectionTitle title={t('channel.videos')} />
        <Segmented<VideoKind>
          options={videoKinds}
          value={kind}
          label={t('channel.kindLabel')}
          title={(option) => t(`channel.kind.${option}`)}
          onChange={setKind}
        />
      </div>
      <LoadState
        // When the channel failed too, this one failure stands for both: its retry reloads both.
        loader={info.error !== null ? { ...videos, reload: refresh } : videos}
        emptyIcon={Film}
        emptyTitle={t(`channel.empty.${kind}`)}
        emptyText={t('channel.emptyText')}
      />
      {videos.items.length ? (
        <div className="stream-grid">
          {videos.items.map((video) => (
            <VideoTile key={video.id} video={video} position={progress[video.id]} />
          ))}
        </div>
      ) : null}
    </Page>
  );
}

function LiveBanner({ channel }: { channel: ChannelDetails }) {
  const { t, i18n } = useTranslation('browse');
  const open = useOpenRoute();
  const stream = channel.stream!;
  const play = () => open({ kind: 'play', target: { kind: 'live', login: channel.ref.login } });
  return (
    <section className="channel-banner" aria-label={t('channel.liveLabel')}>
      <button
        type="button"
        className="channel-live-thumb"
        title={stream.title}
        aria-label={`${t('common:live')}: ${stream.title || t('untitled')}`}
        onClick={play}
      >
        <HoverThumbnail url={freshPreviewURL(stream.previewImageURL)}>
          <span className="thumb-marks">
            <span className="thumb-mark top-left">
              <LiveBadge />
            </span>
          </span>
        </HoverThumbnail>
      </button>
      <div className="channel-live-text">
        <p className="channel-live-title">{stream.title || t('untitled')}</p>
        {stream.game ? (
          <button
            type="button"
            className="link channel-live-game"
            onClick={() => open({ kind: 'category', game: stream.game! })}
          >
            {stream.game.displayName}
          </button>
        ) : null}
        <p className="channel-live-facts">
          <span title={t('shell:search.viewers', { value: formatNumber(stream.viewersCount, i18n.language) })}>
            <Icon icon={User} size={12} />
            {formatNumber(stream.viewersCount, i18n.language)}
          </span>
          {stream.startedAt ? (
            <span title={t('uptime', { value: formatUptime(stream.startedAt) })}>
              <Icon icon={Clock} size={12} />
              {formatUptime(stream.startedAt)}
            </span>
          ) : null}
        </p>
        <button type="button" className="button button-primary button-large channel-watch" onClick={play}>
          <Icon icon={Play} size={14} />
          {t('channel.watchNow')}
        </button>
      </div>
    </section>
  );
}

function OfflineBanner({ channel }: { channel: ChannelDetails }) {
  const { t, i18n } = useTranslation('browse');
  const last = channel.lastBroadcast;
  // As the macOS app: only with the start of the last broadcast; its line only with a title.
  if (!last?.startedAt) return null;
  return (
    <section className="channel-banner is-offline">
      <p className="channel-offline-title">
        {t('channel.offline', { when: formatRelative(last.startedAt, i18n.language) })}
      </p>
      {last.title ? (
        <p className="channel-offline-text">{[last.title, last.game?.displayName].filter(Boolean).join(' · ')}</p>
      ) : null}
    </section>
  );
}
