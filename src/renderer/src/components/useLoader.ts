// A list loaded from the main process: its items, whether a request is out, the failure. A newer
// request wins; an answer to an older one (filters changed meanwhile) is dropped. Port of the macOS
// app's ListLoader (lurk-macos, Sources/Lurk/Views/Components.swift).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface Loader<T> {
  items: T[];
  loading: boolean;
  /** An answer (or a failure) has arrived at least once. */
  loaded: boolean;
  error: string | null;
  reload(): void;
}

/** `key` names what is asked; a new key loads again from scratch. Null waits (settings not read yet). */
export function useLoader<T>(key: string | null, load: () => Promise<T[]>): Loader<T> {
  const { t } = useTranslation('common');
  const [state, setState] = useState<{ items: T[]; loading: boolean; loaded: boolean; error: string | null }>({
    items: [],
    loading: true,
    loaded: false,
    error: null,
  });
  const latest = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const run = useCallback(
    (fresh: boolean) => {
      const request = ++latest.current;
      setState((previous) =>
        // A retry keeps the failure on screen until a load succeeds (as the macOS app's loader).
        fresh ? { items: [], loading: true, loaded: false, error: null } : { ...previous, loading: true },
      );
      loadRef.current().then(
        (items) => {
          if (request === latest.current) setState({ items, loading: false, loaded: true, error: null });
        },
        () => {
          if (request !== latest.current) return;
          // A refresh that fails keeps what was there, with the failure above it (as the macOS
          // app's LoaderStatus). Twitch's own messages are technical English, so the page says
          // what to do instead.
          setState((previous) => ({
            items: previous.items,
            loading: false,
            loaded: true,
            error: t('connectionFailed'),
          }));
        },
      );
    },
    [t],
  );

  useEffect(() => {
    if (key !== null) run(true);
  }, [key, run]);

  const reload = useCallback(() => run(false), [run]);
  return { ...state, reload };
}
