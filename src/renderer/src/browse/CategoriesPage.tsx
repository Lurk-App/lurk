// "Kategorien": the most watched categories by content type, sorted by viewers. Port of
// CategoriesView of the macOS app (lurk-macos, Sources/Lurk/Views/BrowseViews.swift).

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutGrid } from 'lucide-react';
import type { CategoryWithTags } from '@shared/browse';
import type { Platform } from '@shared/ipc';
import type { BrowseSettings } from '@shared/settings';
import { LoadState, Page, PageHeader } from '../components';
import { FilterBar, SortPicker } from '../components/filters';
import { CategoryTile } from '../components/tiles';
import { useLoader } from '../components/useLoader';
import { useSettings } from '../useSettings';
import { RefreshButton, useRefreshCommand } from './parts';

const categorySorts = ['VIEWER_COUNT', 'VIEWER_COUNT_ASC'] as const;

function setBrowse(patch: Partial<BrowseSettings>) {
  void window.lurk.settings.update({ browse: patch });
}

export function CategoriesPage({ platform, active }: { platform: Platform; active: boolean }) {
  const { t } = useTranslation('browse');
  const settings = useSettings()?.browse ?? null;
  const loader = useLoader<CategoryWithTags>(settings ? settings.categoriesContent : null, () =>
    settings ? window.lurk.browse.categories(settings.categoriesContent) : Promise.resolve([]),
  );
  useRefreshCommand(active, loader.reload);
  const sort = settings?.categoriesSort ?? 'VIEWER_COUNT';
  // Sorting needs no new request: the list is the same, only its order changes.
  const games = useMemo(() => {
    const direction = sort === 'VIEWER_COUNT_ASC' ? 1 : -1;
    return [...loader.items].sort((a, b) => direction * ((a.viewersCount ?? 0) - (b.viewersCount ?? 0)));
  }, [loader.items, sort]);

  const subtitle = settings
    ? [
        settings.categoriesContent === 'all' ? t('categories.allTopics') : t(`content.${settings.categoriesContent}`),
        t(`sort.${sort}`),
      ].join(' · ')
    : null;

  return (
    <Page>
      <PageHeader title={t('shell:pages.categories')} subtitle={subtitle}>
        {settings ? (
          <SortPicker
            options={categorySorts}
            value={settings.categoriesSort}
            onChange={(categoriesSort) => setBrowse({ categoriesSort })}
          />
        ) : null}
        <RefreshButton platform={platform} loader={loader} />
      </PageHeader>
      {settings ? (
        <FilterBar
          content={settings.categoriesContent}
          onContent={(categoriesContent) => setBrowse({ categoriesContent })}
        />
      ) : null}
      <LoadState loader={loader} emptyIcon={LayoutGrid} emptyText={t('categories.emptyText')} />
      {games.length ? (
        <div className="category-grid">
          {games.map((game) => (
            <CategoryTile key={game.id} game={game} />
          ))}
        </div>
      ) : null}
    </Page>
  );
}
