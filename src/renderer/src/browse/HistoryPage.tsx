// "Verlauf": what was watched, newest first, grouped by day, on this computer only. Port of
// HistoryView of the macOS app (lurk-macos, Sources/Lurk/Views/HistoryView.swift), Twitch only.

import { useMemo, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Film, ListFilter, Trash2, X } from 'lucide-react';
import { groupByDay, matchesFilter, progressFraction, type HistoryEntry } from '@shared/library';
import { Avatar, EmptyState, HeaderIconButton, Icon, Page, PageHeader, SectionTitle } from '../components';
import { useOpenRoute } from '../components/navigation';
import { SearchInput } from '../components/SearchInput';
import { ProgressStrip, showTargetMenu } from '../components/tiles';
import { useLibrary } from '../useLibrary';
import { useSettings } from '../useSettings';
import './browse.css';

export function HistoryPage() {
  const { t, i18n } = useTranslation('browse');
  const library = useLibrary();
  const saving = useSettings()?.privacy.saveHistory ?? true;
  const [filter, setFilter] = useState('');
  const history = useMemo(() => library?.history ?? [], [library]);
  const progress = library?.progress ?? {};

  const groups = useMemo(
    () =>
      groupByDay(
        history.filter((entry) => matchesFilter(entry, filter)),
        new Date(),
      ),
    [history, filter],
  );

  function dayTitle(daysAgo: number, date: Date): string {
    if (daysAgo === 0) return t('history.today');
    if (daysAgo === 1) return t('history.yesterday');
    return date.toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  return (
    <Page>
      <PageHeader title={t('shell:pages.history')} subtitle={saving ? t('history.kept') : t('history.off')}>
        {history.length ? (
          <div className="history-filter">
            <SearchInput
              icon={ListFilter}
              value={filter}
              onChange={setFilter}
              placeholder={t('history.filter')}
              clearLabel={t('history.clearFilter')}
              compact
              inputProps={{ 'aria-label': t('history.filter') }}
            />
          </div>
        ) : null}
        <HeaderIconButton
          title={t('history.clear')}
          icon={Trash2}
          disabled={!history.length}
          onClick={() => void window.lurk.library.clearHistory()}
        />
      </PageHeader>
      {library === null ? null : !history.length ? (
        <EmptyState
          icon={Clock}
          title={t('history.emptyTitle')}
          text={saving ? t('history.emptyText') : t('history.emptyOff')}
        />
      ) : !groups.length ? (
        <p className="search-empty">{t('history.noMatch', { filter: filter.trim() })}</p>
      ) : (
        <div className="history-list">
          {groups.map((group) => (
            <section key={group.daysAgo} className="history-group" aria-label={dayTitle(group.daysAgo, group.date)}>
              <div className="section-head">
                <SectionTitle title={dayTitle(group.daysAgo, group.date)} count={group.entries.length} />
              </div>
              {group.entries.map((entry) => (
                <HistoryRow
                  key={entry.id}
                  entry={entry}
                  position={progress[entry.target.kind === 'vod' ? entry.target.id : '']}
                />
              ))}
            </section>
          ))}
        </div>
      )}
    </Page>
  );
}

function HistoryRow({ entry, position }: { entry: HistoryEntry; position: number | undefined }) {
  const { t, i18n } = useTranslation('browse');
  const open = useOpenRoute();
  const live = entry.target.kind === 'live';
  const fraction = live ? null : progressFraction(position, entry.duration);
  const time = new Date(entry.watchedAt).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });
  const remove = () => window.lurk.library.remove(entry.id);

  async function showMenu(event: MouseEvent<HTMLElement>) {
    const chosen = await showTargetMenu(
      event,
      {
        target: entry.target,
        channel: entry.channelLogin ? { login: entry.channelLogin, displayName: entry.channelName } : null,
        game: null,
      },
      open,
      t,
      [{ id: 'remove', label: t('history.remove') }],
    );
    if (chosen === 'remove') remove();
  }

  return (
    <div className="history-row" onContextMenu={(event) => void showMenu(event)}>
      <button type="button" className="history-row-main" onClick={() => open({ kind: 'play', target: entry.target })}>
        <span className="history-picture">
          {live ? (
            <Avatar url={entry.thumbnailURL} size={40} />
          ) : entry.thumbnailURL ? (
            <img src={entry.thumbnailURL} alt="" loading="lazy" draggable={false} />
          ) : null}
          {fraction !== null ? <ProgressStrip fraction={fraction} /> : null}
        </span>
        <span className="history-text">
          <span className="tile-title one-line">{entry.title || entry.channelName}</span>
          <span className="tile-line secondary">{[entry.channelName, entry.gameName].filter(Boolean).join(' · ')}</span>
          <span className="history-meta">
            {live ? <span className="history-live">{t('common:live')}</span> : <Icon icon={Film} size={10} />}
            <span>{time}</span>
          </span>
        </span>
      </button>
      <button
        type="button"
        className="history-remove"
        title={t('history.remove')}
        aria-label={t('history.removeNamed', { title: entry.title || entry.channelName })}
        onClick={remove}
      >
        <Icon icon={X} size={13} />
      </button>
    </div>
  );
}
