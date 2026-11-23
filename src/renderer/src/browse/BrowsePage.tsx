// "Entdecken": live streams by content type, sort, language and one tag. Port of BrowseView of the
// macOS app (lurk-macos, Sources/Lurk/Views/BrowseViews.swift), Twitch only for now.

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { streamSorts } from '@shared/browse';
import type { Platform } from '@shared/ipc';
import type { BrowseSettings } from '@shared/settings';
import { Page, PageHeader } from '../components';
import { FilterBar, LanguagePicker, SortPicker, TagSearchField, languageName } from '../components/filters';
import { useLoader } from '../components/useLoader';
import { useSettings } from '../useSettings';
import { RefreshButton, StreamGrid, useRefreshCommand } from './parts';

function setBrowse(patch: Partial<BrowseSettings>) {
  void window.lurk.settings.update({ browse: patch });
}

export function BrowsePage({ platform, active }: { platform: Platform; active: boolean }) {
  const { t } = useTranslation('browse');
  const settings = useSettings()?.browse ?? null;
  const [tag, setTag] = useState<string | null>(null);
  const loader = useLoader(
    settings ? `${settings.browseContent}|${settings.browseSort}|${settings.language}|${tag ?? ''}` : null,
    () =>
      settings
        ? window.lurk.browse.streams(settings.browseContent, settings.language, settings.browseSort, tag)
        : Promise.resolve([]),
  );
  useRefreshCommand(active, loader.reload);
  const suggestTags = useCallback((query: string) => window.lurk.browse.tags(query), []);

  const subtitle = settings
    ? [
        t(`contentStreams.${settings.browseContent}`),
        t(`sort.${settings.browseSort}`),
        languageName(t)(settings.language),
        ...(tag ? [`#${tag}`] : []),
      ].join(' · ')
    : null;

  return (
    <Page>
      <PageHeader title={t('shell:pages.browse')} subtitle={subtitle}>
        {settings ? (
          <>
            <SortPicker
              options={streamSorts}
              value={settings.browseSort}
              onChange={(browseSort) => setBrowse({ browseSort })}
            />
            <LanguagePicker value={settings.language} onChange={(language) => setBrowse({ language })} />
          </>
        ) : null}
        <RefreshButton platform={platform} loader={loader} />
      </PageHeader>
      {settings ? (
        <FilterBar content={settings.browseContent} onContent={(browseContent) => setBrowse({ browseContent })}>
          <TagSearchField tag={tag} onTag={setTag} placeholder={t('tag.placeholder')} suggest={suggestTags} />
        </FilterBar>
      ) : null}
      <StreamGrid loader={loader} />
    </Page>
  );
}
