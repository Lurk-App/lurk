// History, positions and subscriptions (library.json) and the subscriptions' live status, read once
// per window and shared by every component that shows them: one listener each, however many tiles,
// rows and buttons ask.

import { useSyncExternalStore } from 'react';
import type { LibraryState } from '@shared/library';
import type { LiveState } from '@shared/subscriptions';

function sharedStore<T>(read: () => Promise<T>, watch: (listener: (value: T) => void) => () => void) {
  let value: T | null = null;
  let started = false;
  const listeners = new Set<() => void>();
  const set = (next: T) => {
    value = next;
    for (const listener of listeners) listener();
  };
  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      if (!started) {
        started = true;
        // The change event first, so nothing between the read and the subscription is missed.
        watch(set);
        void read().then((first) => value === null && set(first));
      }
      return () => listeners.delete(listener);
    },
    snapshot: (): T | null => value,
  };
}

const library = sharedStore<LibraryState>(
  () => window.lurk.library.get(),
  (listener) => window.lurk.library.onChange(listener),
);

// Watch time changes every few seconds while a stream plays: the settings window hears it at once,
// the rest of the library every 30 s.
const watchTime = sharedStore<Record<string, number>>(
  async () => (await window.lurk.library.get()).watchTime,
  (listener) => {
    const stopWatch = window.lurk.library.onWatchTime(listener);
    const stopLibrary = window.lurk.library.onChange((state) => listener(state.watchTime));
    return () => {
      stopWatch();
      stopLibrary();
    };
  },
);

const live = sharedStore<LiveState>(
  () => window.lurk.subscriptions.live(),
  (listener) => window.lurk.subscriptions.onLive(listener),
);

/** History, video positions and subscriptions, updated when any window or the player changes them. Null until read. */
export function useLibrary(): LibraryState | null {
  return useSyncExternalStore(library.subscribe, library.snapshot);
}

/** Seconds watched per channel, as they are counted. Null until read. */
export function useWatchTime(): Record<string, number> | null {
  return useSyncExternalStore(watchTime.subscribe, watchTime.snapshot);
}

/** The subscriptions' live status from the main process. Null until read. */
export function useLive(): LiveState | null {
  return useSyncExternalStore(live.subscribe, live.snapshot);
}
