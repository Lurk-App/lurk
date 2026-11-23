// A category's page: its box art beside the header, its live streams below. Port of CategoryView
// of the macOS app (lurk-macos, Sources/Lurk/Views/BrowseViews.swift).

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { streamSorts } from '@shared/browse';
import { formatNumber } from '@shared/format';
import type { Platform } from '@shared/ipc';
import type { Game, GameRef } from '@shared/models';
import type { BrowseSettings } from '@shared/settings';
import { BoxArt, Page, PageHeader } from '../components';
import { LanguagePicker, SortPicker, languageName } from '../components/filters';
import { useLoader } from '../components/useLoader';
import { useSettings } from '../useSettings';
import { RefreshButton, StreamGrid, useRefreshCommand } from './parts';
import './browse.css';

function setBrowse(patch: Partial<BrowseSettings>) {
  void window.lurk.settings.update({ browse: patch });
}

export function CategoryPage({ game, platform, active }: { game: GameRef; platform: Platform; active: boolean }) {
  const { t, i18n } = useTranslation('browse');
  const settings = useSettings()?.browse ?? null;
  const [details, setDetails] = useState<Game | null>(null);
  const loader = useLoader(settings ? `${game.name}|${settings.categorySort}|${settings.language}` : null, async () => {
    if (!settings) return [];
    const answer = await window.lurk.browse.categoryStreams(game.name, settings.language, settings.categorySort);
    setDetails(answer.game);
    return answer.streams;
  });
  useRefreshCommand(active, loader.reload);

  const viewers = details?.viewersCount ?? null;
  const subtitle = settings
    ? [
        ...(viewers !== null ? [t('shell:search.viewers', { value: formatNumber(viewers, i18n.language) })] : []),
        t(`sort.${settings.categorySort}`),
        languageName(t)(settings.language),
      ].join(' · ')
    : null;

  return (
    <Page>
      <div className="art-head">
        <BoxArt url={details?.boxArtURL ?? null} width={84} large />
        <PageHeader title={details?.displayName ?? game.displayName} subtitle={subtitle}>
          {settings ? (
            <>
              <SortPicker
                options={streamSorts}
                value={settings.categorySort}
                onChange={(categorySort) => setBrowse({ categorySort })}
              />
              <LanguagePicker value={settings.language} onChange={(language) => setBrowse({ language })} />
            </>
          ) : null}
          <RefreshButton platform={platform} loader={loader} />
        </PageHeader>
      </div>
      <StreamGrid loader={loader} />
    </Page>
  );
}
