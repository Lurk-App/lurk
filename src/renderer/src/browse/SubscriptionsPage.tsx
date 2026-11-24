// "Abos": subscriptions without an account – the live ones as tiles, the others as rows, import and
// export in the header (with "Von Twitch übernehmen …" while Lurk's Twitch client id is set, then
// also on the empty page). Port
// of SubscriptionsView of the macOS app (lurk-macos, Sources/Lurk/Views/SubscriptionsView.swift),
// Twitch only; the first-steps card comes with the introduction.

import { useCallback, useEffect, useMemo, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpDown, ChevronDown, Heart, RotateCw, TriangleAlert } from 'lucide-react';
import { formatNumber, formatRelative } from '@shared/format';
import type { Platform } from '@shared/ipc';
import { liveStreams, offlineSubscriptions, type Subscription } from '@shared/subscriptions';
import { appInfo } from '../boot';
import { EmptyState, HeaderIconButton, Icon, Page, PageHeader, SectionTitle } from '../components';
import { useOpenRoute } from '../components/navigation';
import { ChannelRow, StreamTile, menuPoint } from '../components/tiles';
import { useLibrary, useLive } from '../useLibrary';
import { refreshShortcut, useRefreshCommand } from './parts';
import './browse.css';

/** The page asks again when it shows and the last answer is older than this (as on macOS). */
const freshForMs = 60_000;

export function SubscriptionsPage({
  platform,
  active,
  onBrowse,
}: {
  platform: Platform;
  active: boolean;
  /** "Streams entdecken": Entdecken in the sidebar. */
  onBrowse(): void;
}) {
  const { t, i18n } = useTranslation('browse');
  const open = useOpenRoute();
  const library = useLibrary();
  const live = useLive();
  const subscriptions = useMemo(() => library?.subscriptions ?? [], [library]);
  const statuses = useMemo(() => live?.statuses ?? {}, [live]);
  const streams = useMemo(() => liveStreams(subscriptions, statuses), [subscriptions, statuses]);
  const offline = useMemo(() => offlineSubscriptions(subscriptions, statuses), [subscriptions, statuses]);
  const refresh = useCallback(() => window.lurk.subscriptions.refresh(), []);
  useRefreshCommand(active, refresh);

  // The status loads when the page shows, unless the last answer is under a minute old.
  const lastRefresh = live?.lastRefresh ?? null;
  const haveLive = live !== null;
  useEffect(() => {
    if (!active || !haveLive) return;
    if (!lastRefresh || Date.now() - Date.parse(lastRefresh) > freshForMs) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the page comes to the front
  }, [active, haveLive]);

  const language = i18n.language;
  const subtitle = !subscriptions.length
    ? t('subs.kept')
    : streams.length
      ? t('subs.someLive', {
          live: formatNumber(streams.length, language),
          count: subscriptions.length,
          total: formatNumber(subscriptions.length, language),
        })
      : t('subs.noneLive', { count: subscriptions.length, total: formatNumber(subscriptions.length, language) });

  async function showTransferMenu(event: MouseEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const empty = subscriptions.length === 0;
    const chosen = await window.lurk.showMenu(
      [
        ...(appInfo().twitchImport ? [{ type: 'item' as const, id: 'twitch', label: t('subs.fromTwitch') }] : []),
        { type: 'item', id: 'import', label: t('subs.import') },
        { type: 'separator' },
        { type: 'item', id: 'json', label: t('subs.exportJson'), enabled: !empty },
        { type: 'item', id: 'text', label: t('subs.exportText'), enabled: !empty },
      ],
      { x: rect.left, y: rect.bottom + 4 },
    );
    if (chosen === 'twitch') window.lurk.subscriptions.importFromTwitch();
    if (chosen === 'import') await window.lurk.subscriptions.importFile();
    if (chosen === 'json' || chosen === 'text') await window.lurk.subscriptions.exportFile(chosen);
  }

  async function showOfflineMenu(event: MouseEvent<HTMLElement>, subscription: Subscription) {
    event.preventDefault();
    const chosen = await window.lurk.showMenu(
      [
        { type: 'item', id: 'channel', label: t('menu.openChannel') },
        { type: 'item', id: 'end', label: t('subscribe.end') },
      ],
      menuPoint(event),
    );
    if (chosen === 'channel')
      open({ kind: 'channel', login: subscription.login, displayName: subscription.displayName });
    if (chosen === 'end') window.lurk.subscriptions.unsubscribe(subscription.id);
  }

  function offlineText(subscription: Subscription): string {
    const last = statuses[subscription.id]?.lastLiveAt;
    return last ? t('subs.lastLive', { when: formatRelative(last, language) }) : t('search.offline');
  }

  return (
    <Page>
      <PageHeader title={t('shell:pages.subscriptions')} subtitle={library ? subtitle : null}>
        <button
          type="button"
          className="menu-button"
          aria-haspopup="menu"
          title={t('subs.transferHelp')}
          onClick={(event) => void showTransferMenu(event)}
        >
          <Icon icon={ArrowUpDown} size={13} />
          {t('subs.transfer')}
          <Icon icon={ChevronDown} size={12} className="menu-button-chevron" />
        </button>
        <HeaderIconButton
          title={t('subs.refresh', { shortcut: refreshShortcut[platform] })}
          icon={RotateCw}
          busy={live?.refreshing ?? false}
          onClick={refresh}
        />
      </PageHeader>
      {library === null ? null : !subscriptions.length ? (
        <EmptyState
          icon={Heart}
          title={t('subs.emptyTitle')}
          text={t('subs.emptyText')}
          action={{ label: t('subs.discover'), onClick: onBrowse, prominent: true }}
          // Where a new user looks first: the follows from Twitch, while Lurk can read them (asked
          // for 2026-11-24 – on macOS only in the menu); the file import stays in "Import/Export".
          secondaryAction={
            appInfo().twitchImport
              ? { label: t('subs.fromTwitch'), onClick: () => window.lurk.subscriptions.importFromTwitch() }
              : { label: t('subs.import'), onClick: () => void window.lurk.subscriptions.importFile() }
          }
        />
      ) : (
        <>
          {live?.failed ? (
            <p className="warning-line" role="status">
              <Icon icon={TriangleAlert} size={14} />
              {t('subs.failed')}
            </p>
          ) : null}
          {streams.length ? (
            <div className="stream-grid">
              {streams.map((stream) => (
                <StreamTile key={stream.id} stream={stream} />
              ))}
            </div>
          ) : (
            <p className="search-empty">{live?.lastRefresh ? t('subs.nobodyLive') : t('subs.loading')}</p>
          )}
          <div className="section-head">
            <SectionTitle title={t('subs.offline')} count={offline.length} />
          </div>
          {offline.length ? (
            <div className="channel-grid">
              {offline.map((subscription) => (
                <ChannelRow
                  key={subscription.id}
                  channel={subscription}
                  subtitle={offlineText(subscription)}
                  live={false}
                  game={null}
                  subscribable={false}
                  onMenu={(event) => void showOfflineMenu(event, subscription)}
                />
              ))}
            </div>
          ) : null}
        </>
      )}
    </Page>
  );
}
