// "Live aus deinen Abos" in the sidebar: one row per live subscription. Port of LiveRow and the
// sidebar's section title of the macOS app (lurk-macos, Sources/Lurk/Views/RootView.swift).

import { useTranslation } from 'react-i18next';
import type { BrowseStream } from '@shared/browse';
import { formatViewers } from '@shared/format';
import { Avatar } from '../components';
import { useOpenRoute } from '../components/navigation';
import { showTargetMenu } from '../components/tiles';

export function LiveRow({ stream, playing }: { stream: BrowseStream; playing: boolean }) {
  const { t, i18n } = useTranslation('browse');
  const open = useOpenRoute();
  const channel = stream.broadcaster;
  const viewers = formatViewers(stream.viewersCount, i18n.language);
  return (
    <button
      type="button"
      className={`live-row${playing ? ' is-playing' : ''}`}
      title={stream.title || channel.displayName}
      aria-current={playing ? 'true' : undefined}
      onClick={() => open({ kind: 'play', target: { kind: 'live', login: channel.login } })}
      onContextMenu={(event) =>
        void showTargetMenu(
          event,
          { target: { kind: 'live', login: channel.login }, channel, game: stream.game },
          open,
          t,
        )
      }
    >
      <Avatar url={channel.profileImageURL} size={26} />
      <span className="live-row-text">
        <span className="live-row-name">{channel.displayName}</span>
        <span className="live-row-game">{stream.game?.displayName ?? t('search.live')}</span>
      </span>
      <span className="live-row-viewers">
        <span className="live-dot" aria-hidden="true" />
        <span aria-hidden="true">{viewers}</span>
        <span className="visually-hidden">{t('shell:search.viewers', { value: viewers })}</span>
      </span>
    </button>
  );
}
