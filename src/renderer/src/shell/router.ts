// Navigation of the main window: a sidebar section and a stack of pages above it.
// Port of Router and SidebarItem from the native macOS app (lurk-macos, Sources/Lurk/App.swift).

import type { TwitchLink } from '@shared/links';
import type { GameRef, PlayTarget } from '@shared/models';

/** Sidebar entries of this stage, in the reference's order. */
export const sections = ['subscriptions', 'browse', 'categories', 'history'] as const;
export type Section = (typeof sections)[number] | 'search';

export type Route =
  | { kind: 'channel'; login: string; displayName?: string }
  | { kind: 'category'; game: GameRef }
  | { kind: 'play'; target: PlayTarget }
  | { kind: 'clip'; slug: string };

export interface NavigationState {
  section: Section;
  path: Route[];
  query: string;
}

export type NavigationAction =
  | { type: 'select'; section: (typeof sections)[number] }
  | { type: 'open'; route: Route }
  | { type: 'back' }
  | { type: 'search'; query: string };

export const initialNavigation: NavigationState = { section: 'subscriptions', path: [], query: '' };

export function samePlayTarget(a: PlayTarget, b: PlayTarget): boolean {
  if (a.kind === 'live' && b.kind === 'live') return a.login.toLowerCase() === b.login.toLowerCase();
  return a.kind === 'vod' && b.kind === 'vod' && a.id === b.id;
}

export function navigate(state: NavigationState, action: NavigationAction): NavigationState {
  switch (action.type) {
    case 'select':
      // A second click on the selected entry goes back to its root.
      return state.section === action.section
        ? { ...state, path: [] }
        : { ...state, section: action.section, path: [] };
    case 'open': {
      // Pages stack up as in the macOS app. A player replaces a player on top (like switching on
      // twitch.tv), and the same player further down leaves the stack, so each plays only once.
      const route = action.route;
      if (route.kind !== 'play') return { ...state, path: [...state.path, route] };
      let path = state.path;
      if (path.at(-1)?.kind === 'play') path = path.slice(0, -1);
      path = path.filter((entry) => !(entry.kind === 'play' && samePlayTarget(entry.target, route.target)));
      return { ...state, path: [...path, route] };
    }
    case 'back':
      return state.path.length ? { ...state, path: state.path.slice(0, -1) } : state;
    case 'search':
      return { section: 'search', path: [], query: action.query };
  }
}

export function routeForLink(link: TwitchLink): Route {
  switch (link.kind) {
    case 'channel':
      return { kind: 'channel', login: link.login };
    case 'vod':
      return { kind: 'play', target: { kind: 'vod', id: link.id } };
    case 'clip':
      return { kind: 'clip', slug: link.slug };
  }
}
