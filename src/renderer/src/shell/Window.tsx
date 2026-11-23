// The main window: sidebar | content, with the title-bar row on top. Follows RootView and
// Sidebar of the macOS app (lurk-macos, Sources/Lurk/Views/RootView.swift). On macOS the top row
// is the title bar (traffic lights inset); on Windows and Linux the system title bar stays and the
// row sits below it.

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Flame, Heart, History, LayoutGrid, PanelLeft, Settings, type LucideIcon } from 'lucide-react';
import type { Platform } from '@shared/ipc';
import type { Suggestion } from '@shared/search';
import { Icon } from '../components';
import { livePreviewer } from '../components/livePreview';
import { OpenRouteContext } from '../components/navigation';
import { useReducedMotion } from '../useAppearance';
import { useSettings } from '../useSettings';
import { liveStreams } from '@shared/subscriptions';
import { useLibrary, useLive } from '../useLibrary';
import { LiveRow } from './LiveRow';
import { PageFor } from './pages';
import { initialNavigation, navigate, routeForLink, sections, type Route, type Section } from './router';
import { SearchField, type SearchFieldHandle } from './SearchField';
import { useSearch } from './useSearch';
import './shell.css';

const navIcons: Record<(typeof sections)[number], LucideIcon> = {
  subscriptions: Heart,
  browse: Flame,
  categories: LayoutGrid,
  history: History,
};

const sidebarWidthKey = 'lurk.sidebarWidth';
const sidebarLimits = { min: 230, initial: 260, max: 340 };

function storedSidebarWidth(): number {
  try {
    const value = Number(window.localStorage.getItem(sidebarWidthKey));
    if (value >= sidebarLimits.min && value <= sidebarLimits.max) return value;
  } catch {
    // No storage: the default width.
  }
  return sidebarLimits.initial;
}

function clampWidth(value: number): number {
  return Math.round(Math.min(sidebarLimits.max, Math.max(sidebarLimits.min, value)));
}

export function Window({ platform }: { platform: Platform }) {
  const { t } = useTranslation('shell');
  const [state, dispatch] = useReducer(navigate, initialNavigation);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(storedSidebarWidth);
  const search = useSearch();
  const searchField = useRef<SearchFieldHandle>(null);
  const [focusSearchSoon, setFocusSearchSoon] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  useEffect(() => window.lurk.onFullScreenChange(setFullScreen), []);
  const openRoute = useCallback((route: Route) => dispatch({ type: 'open', route }), []);

  // "Live aus deinen Abos" and the number on "Abos" (the macOS sidebar shows at most 20 rows).
  const library = useLibrary();
  const liveState = useLive();
  const liveNow = useMemo(
    () => (library && liveState ? liveStreams(library.subscriptions, liveState.statuses) : []),
    [library, liveState],
  );
  const top = state.path.at(-1);
  const playingLogin = top?.kind === 'play' && top.target.kind === 'live' ? top.target.login.toLowerCase() : null;

  // The tiles' live preview: the setting, and never with reduced motion (DESIGN.md).
  const hoverPreview = useSettings()?.player.hoverPreview ?? false;
  const reducedMotion = useReducedMotion();
  useEffect(() => livePreviewer.setEnabled(hoverPreview && !reducedMotion), [hoverPreview, reducedMotion]);
  // Another page in front: whatever preview played stops (its tile is covered, not gone).
  useEffect(() => livePreviewer.stop(), [state]);

  useEffect(() => {
    try {
      window.localStorage.setItem(sidebarWidthKey, String(sidebarWidth));
    } catch {
      // Not stored: the width resets next time.
    }
  }, [sidebarWidth]);

  useEffect(
    () =>
      window.lurk.onCommand((command) => {
        if (command === 'toggle-sidebar') setSidebarVisible((visible) => !visible);
        if (command === 'go-back') dispatch({ type: 'back' });
        if (command === 'focus-search') {
          setSidebarVisible(true);
          setFocusSearchSoon(true);
        }
      }),
    [],
  );

  useEffect(() => {
    if (focusSearchSoon && sidebarVisible) {
      searchField.current?.focus();
      setFocusSearchSoon(false);
    }
  }, [focusSearchSoon, sidebarVisible]);

  function activate(suggestion: Suggestion) {
    switch (suggestion.kind) {
      case 'channel': {
        // Like the macOS app: a live channel opens the player, an offline one the channel page.
        const { ref, stream } = suggestion.channel;
        dispatch({
          type: 'open',
          route: stream
            ? { kind: 'play', target: { kind: 'live', login: ref.login } }
            : { kind: 'channel', login: ref.login, displayName: ref.displayName },
        });
        break;
      }
      case 'category':
        dispatch({ type: 'open', route: { kind: 'category', game: suggestion.game } });
        break;
      case 'link':
        dispatch({ type: 'open', route: routeForLink(suggestion.link) });
        break;
      case 'all':
        dispatch({ type: 'search', query: suggestion.term });
        break;
    }
  }

  function startResize(event: PointerEvent<HTMLDivElement>) {
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (moveEvent: globalThis.PointerEvent) =>
      setSidebarWidth(clampWidth(startWidth + moveEvent.clientX - startX));
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  }

  function resizeWithKeys(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 30 : 10;
    if (event.key === 'ArrowLeft') setSidebarWidth((width) => clampWidth(width - step));
    else if (event.key === 'ArrowRight') setSidebarWidth((width) => clampWidth(width + step));
    else return;
    event.preventDefault();
  }

  const atRoot = state.path.length === 0;
  // Cinema: fullscreen with the player on top – no sidebar, no title-bar row (DESIGN.md).
  const cinema = fullScreen && state.path.at(-1)?.kind === 'play';
  const showsSidebar = sidebarVisible && !cinema;
  const toggleButton = (
    <ToolbarButton
      icon={PanelLeft}
      label={t('toggleSidebar')}
      pressed={sidebarVisible}
      onClick={() => setSidebarVisible((visible) => !visible)}
    />
  );
  const backButton = (
    <ToolbarButton icon={ChevronLeft} label={t('back')} disabled={atRoot} onClick={() => dispatch({ type: 'back' })} />
  );

  return (
    <div
      className={`window platform-${platform}${showsSidebar ? '' : ' sidebar-hidden'}${cinema ? ' is-cinema' : ''}`}
      style={{ ['--sidebar-width' as string]: `${sidebarWidth}px` }}
    >
      {showsSidebar ? (
        <>
          <div className="titlebar titlebar-sidebar">{toggleButton}</div>
          <aside className="sidebar">
            <SearchField ref={searchField} search={search} onActivate={activate} />
            <nav className="sidebar-nav" aria-label={t('navigation')}>
              {sections.map((section) => (
                <NavRow
                  key={section}
                  icon={navIcons[section]}
                  title={t(`nav.${section}`)}
                  selected={state.section === section && atRoot}
                  badge={section === 'subscriptions' ? liveNow.length : 0}
                  onClick={() => dispatch({ type: 'select', section })}
                />
              ))}
            </nav>
            <div className="sidebar-scroll">
              {liveNow.length ? (
                <section className="sidebar-section" aria-labelledby="sidebar-live-title">
                  <h2 className="sidebar-section-title" id="sidebar-live-title">
                    {t('liveSection')}
                  </h2>
                  {liveNow.slice(0, 20).map((stream) => (
                    <LiveRow
                      key={stream.broadcaster.id}
                      stream={stream}
                      playing={playingLogin === stream.broadcaster.login.toLowerCase()}
                    />
                  ))}
                </section>
              ) : null}
            </div>
            <button type="button" className="sidebar-settings" onClick={() => window.lurk.openSettings()}>
              <Icon icon={Settings} size={15} />
              <span>{t('settings')}</span>
            </button>
            <div
              className="sidebar-resize"
              role="separator"
              aria-orientation="vertical"
              aria-label={t('resizeSidebar')}
              aria-valuemin={sidebarLimits.min}
              aria-valuemax={sidebarLimits.max}
              aria-valuenow={sidebarWidth}
              tabIndex={0}
              onPointerDown={startResize}
              onKeyDown={resizeWithKeys}
            />
          </aside>
        </>
      ) : null}
      {cinema ? null : (
        <div className="titlebar titlebar-content">
          {showsSidebar ? null : toggleButton}
          {backButton}
        </div>
      )}
      <main className="content">
        <OpenRouteContext.Provider value={openRoute}>
          <PageFor
            state={state}
            platform={platform}
            fullScreen={fullScreen}
            cinema={cinema}
            open={openRoute}
            onSelect={(section) => dispatch({ type: 'select', section })}
          />
        </OpenRouteContext.Provider>
      </main>
    </div>
  );
}

function ToolbarButton({
  icon,
  label,
  onClick,
  disabled = false,
  pressed,
}: {
  icon: LucideIcon;
  label: string;
  onClick(): void;
  disabled?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      className="toolbar-button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon icon={icon} size={17} />
    </button>
  );
}

function NavRow({
  icon,
  title,
  selected,
  badge = 0,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  /** This section's root page is showing: highlighted and announced as the current page. */
  selected: boolean;
  /** "Abos": how many subscriptions are live; none at 0. */
  badge?: number;
  onClick(): void;
}) {
  const { t } = useTranslation('shell');
  return (
    <button
      type="button"
      className={`nav-row${selected ? ' is-selected' : ''}`}
      aria-current={selected ? 'page' : undefined}
      onClick={onClick}
    >
      <span className="nav-icon">
        <Icon icon={icon} size={14} />
      </span>
      <span className="nav-title">{title}</span>
      {badge > 0 ? (
        <>
          <span className="nav-badge" title={t('liveBadge', { count: badge })} aria-hidden="true">
            {badge}
          </span>
          <span className="visually-hidden">{t('liveBadge', { count: badge })}</span>
        </>
      ) : null}
    </button>
  );
}

export type { Section };
