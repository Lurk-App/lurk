// How a tile or row opens a page without being handed the router: the main window provides
// `open`, as the macOS app's views take the router from their environment.

import { createContext, useContext } from 'react';
import type { Route } from '../shell/router';

/**
 * Outside the provider a component would open nothing, silently (the sidebar's live rows did until
 * 2026-11-25). In development opening then throws; in a build it is logged.
 */
function missingProvider(): void {
  const message = 'OpenRouteContext is missing: this component sits outside the window that opens pages.';
  if (import.meta.env.DEV) throw new Error(message);
  console.error(message);
}

export const OpenRouteContext = createContext<(route: Route) => void>(missingProvider);

export function useOpenRoute(): (route: Route) => void {
  return useContext(OpenRouteContext);
}
