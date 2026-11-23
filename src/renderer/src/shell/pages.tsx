// The pages of the main window: Abos (part 6a), Entdecken, Kategorien, a category, the search
// results (part 5a), a channel and the history (part 5b). Clips offer to open on twitch.tv until
// stage 2.

import { useTranslation } from 'react-i18next';
import { Construction } from 'lucide-react';
import { twitchUrl } from '@shared/links';
import type { Platform } from '@shared/ipc';
import { EmptyState, Page, PageHeader } from '../components';
import { BrowsePage } from '../browse/BrowsePage';
import { CategoriesPage } from '../browse/CategoriesPage';
import { CategoryPage } from '../browse/CategoryPage';
import { ChannelPage } from '../browse/ChannelPage';
import { HistoryPage } from '../browse/HistoryPage';
import { SubscriptionsPage } from '../browse/SubscriptionsPage';
import { SearchPage } from '../browse/SearchPage';
import { PlayerPage } from '../player/PlayerPage';
import type { NavigationState, Route, sections } from './router';

export function PageFor({
  state,
  platform,
  fullScreen,
  cinema,
  open,
  onSelect,
}: {
  state: NavigationState;
  platform: Platform;
  fullScreen: boolean;
  cinema: boolean;
  open(route: Route): void;
  /** Select a sidebar section ("Streams entdecken" on the empty Abos page). */
  onSelect(section: (typeof sections)[number]): void;
}) {
  // Every page of the stack stays as it was – its list, its filters, where it was scrolled to – and
  // only the top one shows, as in the macOS app's navigation stack. A player that another page
  // covers leaves: one stream plays at a time.
  const layers: { key: string; route: Route | null }[] = [
    { key: `${state.section}|${state.query}`, route: null },
    ...state.path.map((route, index) => ({ key: `${index}|${JSON.stringify(route)}`, route })),
  ];
  return (
    <>
      {layers.map(({ key, route }, index) => {
        const active = index === layers.length - 1;
        if (route?.kind === 'play' && !active) return null;
        return (
          <div key={key} className={`page-layer${active ? '' : ' is-covered'}`} inert={!active}>
            {route === null ? (
              <SectionPage state={state} platform={platform} active={active} onBrowse={() => onSelect('browse')} />
            ) : route.kind === 'play' ? (
              <PlayerPage
                key={JSON.stringify(route.target)}
                target={route.target}
                platform={platform}
                fullScreen={fullScreen}
                cinema={cinema}
                open={open}
              />
            ) : route.kind === 'category' ? (
              <CategoryPage game={route.game} platform={platform} active={active} />
            ) : route.kind === 'channel' ? (
              <ChannelPage login={route.login} active={active} />
            ) : (
              <RoutePage route={route} />
            )}
          </div>
        );
      })}
    </>
  );
}

function SectionPage({
  state,
  platform,
  active,
  onBrowse,
}: {
  state: NavigationState;
  platform: Platform;
  active: boolean;
  onBrowse(): void;
}) {
  switch (state.section) {
    case 'browse':
      return <BrowsePage platform={platform} active={active} />;
    case 'categories':
      return <CategoriesPage platform={platform} active={active} />;
    case 'search':
      return <SearchPage query={state.query} />;
    case 'history':
      return <HistoryPage />;
    case 'subscriptions':
      return <SubscriptionsPage platform={platform} active={active} onBrowse={onBrowse} />;
  }
}

/** A clip opens on twitch.tv until clips arrive (stage 2). */
function RoutePage({ route }: { route: Extract<Route, { kind: 'clip' }> }) {
  const { t } = useTranslation('shell');
  const external = twitchUrl(route);
  return (
    <Page>
      <PageHeader title={t('pages.clip')} subtitle={route.slug} />
      <EmptyState
        icon={Construction}
        title={t('placeholder.title')}
        text={t('placeholder.twitch')}
        action={{ label: t('placeholder.openOnTwitch'), onClick: () => window.lurk.openExternal(external) }}
      />
    </Page>
  );
}
