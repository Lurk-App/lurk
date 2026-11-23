// What the list pages share: the stream grid with its load state, the refresh button and the
// refresh command (View → Aktualisieren, ⌘R / Ctrl+R). Port of StreamGrid of the macOS app
// (lurk-macos, Sources/Lurk/Views/BrowseViews.swift).

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCw } from 'lucide-react';
import type { BrowseStream } from '@shared/browse';
import type { Platform } from '@shared/ipc';
import { HeaderIconButton, LoadState } from '../components';
import { StreamTile } from '../components/tiles';
import type { Loader } from '../components/useLoader';

export const refreshShortcut: Record<Platform, string> = { darwin: '⌘R', win32: 'Ctrl+R', linux: 'Ctrl+R' };

/** The menu's refresh reaches only the page in front. */
export function useRefreshCommand(active: boolean, reload: () => void): void {
  useEffect(() => {
    if (!active) return;
    return window.lurk.onCommand((command) => {
      if (command === 'refresh') reload();
    });
  }, [active, reload]);
}

export function RefreshButton({ platform, loader }: { platform: Platform; loader: Loader<unknown> }) {
  const { t } = useTranslation('browse');
  return (
    <HeaderIconButton
      title={t('refresh', { shortcut: refreshShortcut[platform] })}
      icon={RotateCw}
      busy={loader.loading}
      onClick={loader.reload}
    />
  );
}

export function StreamGrid({ loader }: { loader: Loader<BrowseStream> }) {
  const { t } = useTranslation('browse');
  return (
    <>
      <LoadState loader={loader} emptyTitle={t('streams.emptyTitle')} emptyText={t('streams.emptyText')} />
      {loader.items.length ? (
        <div className="stream-grid">
          {loader.items.map((stream) => (
            <StreamTile key={stream.id} stream={stream} />
          ))}
        </div>
      ) : null}
    </>
  );
}
