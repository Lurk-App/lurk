// How a tile or row opens a page without being handed the router: the main window provides
// `open`, as the macOS app's views take the router from their environment.

import { createContext, useContext } from 'react';
import type { Route } from '../shell/router';

export const OpenRouteContext = createContext<(route: Route) => void>(() => {});

export function useOpenRoute(): (route: Route) => void {
  return useContext(OpenRouteContext);
}
