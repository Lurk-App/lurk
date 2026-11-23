// "Alle Ergebnisse": categories (one row that scrolls sideways) and channels for a search term.
// Port of SearchView of the macOS app (lurk-macos, Sources/Lurk/Views/BrowseViews.swift).

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { formatCompact, formatViewers } from '@shared/format';
import type { ChannelInfo, SearchResults } from '@shared/models';
import { LoadState, Page, PageHeader, SectionTitle } from '../components';
import './browse.css';
import { CategoryTile, ChannelRow } from '../components/tiles';
import { useLoader } from '../components/useLoader';

export function SearchPage({ query }: { query: string }) {
  const { t, i18n } = useTranslation('browse');
  // One answer holds both lists; the loader keeps it as a list of one.
  const loader = useLoader<SearchResults>(query, async () => [await window.lurk.twitch.search(query)]);
  const results = loader.items[0] ?? null;
  // Live channels first, then by followers (as the macOS app sorts them).
  const channels = useMemo(
    () =>
      [...(results?.channels ?? [])].sort(
        (a, b) => Number(b.stream !== null) - Number(a.stream !== null) || (b.followers ?? 0) - (a.followers ?? 0),
      ),
    [results],
  );
  const games = results?.categories ?? [];

  function subtitle(info: ChannelInfo): string {
    if (info.stream) {
      const viewers = info.stream.viewersCount;
      return [
        viewers > 0 ? t('shell:search.viewers', { value: formatViewers(viewers, i18n.language) }) : t('search.live'),
        ...(info.stream.game ? [info.stream.game.displayName] : []),
      ].join(' · ');
    }
    return info.followers !== null
      ? t('search.followers', { value: formatCompact(info.followers, i18n.language) })
      : t('search.offline');
  }

  return (
    <Page>
      <PageHeader
        title={t('search.title', { term: query })}
        // Counted from the start, as the macOS app does ("0 Kanäle · 0 Kategorien" while it searches).
        subtitle={[
          t('search.channels', { count: channels.length }),
          t('search.categories', { count: games.length }),
        ].join(' · ')}
      />
      <LoadState loader={loader} failedTitle={t('search.failedTitle')} emptyIcon={Search} emptyText="" />
      {results ? (
        <>
          {games.length ? (
            <>
              <SectionTitle title={t('search.categoriesSection')} count={games.length} />
              <div className="category-strip">
                {games.map((game) => (
                  <CategoryTile key={game.id} game={game} />
                ))}
              </div>
            </>
          ) : null}
          <SectionTitle title={t('search.channelsSection')} count={channels.length} />
          {channels.length ? (
            <div className="channel-grid">
              {channels.map((info) => (
                <ChannelRow
                  key={info.ref.id}
                  channel={info.ref}
                  subtitle={subtitle(info)}
                  live={info.stream !== null}
                  game={info.stream?.game ?? null}
                />
              ))}
            </div>
          ) : (
            <p className="search-empty">{t('search.noChannels', { term: query })}</p>
          )}
        </>
      ) : null}
    </Page>
  );
}
