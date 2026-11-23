// library.json in the data folder: the history, the positions in videos and the watch time. Read
// once at start, written atomically a moment after a change (positions arrive every 10 s while a
// video plays; watch time every 5 s: the settings window hears it at once, the other windows and the
// file every 30 s, as the macOS app saves it).
// The settings "Wiedergabeverlauf speichern" and "Position in Videos merken" decide what is kept.

import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  addToHistory,
  addWatchTime,
  normalizeLibrary,
  positionToKeep,
  resumeAt,
  type HistoryRecord,
  type LibraryState,
} from '@shared/library';
import type { ChannelRef } from '@shared/models';
import { addSubscriptions, updateFromStatuses, type ChannelStatus } from '@shared/subscriptions';
import { settingsStore } from './settingsStore';

type Listener = (state: LibraryState) => void;
type WatchListener = (watchTime: Record<string, number>) => void;

const saveDelayMs = 1500;
/** Watch time is gathered this long before it is written and shared with every window (the macOS app saves it every 30 s). */
const watchTimeDelayMs = 30_000;

class LibraryStore {
  private current: LibraryState | null = null;
  private listeners = new Set<Listener>();
  private watchListeners = new Set<WatchListener>();
  private writing: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | undefined;
  private watchTimer: NodeJS.Timeout | undefined;

  private get file(): string {
    return path.join(app.getPath('userData'), 'library.json');
  }

  get(): LibraryState {
    if (!this.current) {
      let raw: unknown = {};
      try {
        raw = JSON.parse(readFileSync(this.file, 'utf8'));
      } catch {
        // Missing or broken: start empty.
      }
      this.current = normalizeLibrary(raw);
    }
    return this.current;
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Watch time as it is counted, every few seconds while a stream plays. */
  onWatchTime(listener: WatchListener): () => void {
    this.watchListeners.add(listener);
    return () => this.watchListeners.delete(listener);
  }

  isSubscribed(id: string): boolean {
    return this.get().subscriptions.some((entry) => entry.id === id);
  }

  /** Adds channels not yet subscribed; how many were added. */
  subscribe(channels: ChannelRef[]): number {
    const state = this.get();
    const { list, added } = addSubscriptions(state.subscriptions, channels);
    if (added) this.change({ ...state, subscriptions: list });
    return added;
  }

  unsubscribe(id: string): void {
    const state = this.get();
    if (state.subscriptions.some((entry) => entry.id === id))
      this.change({ ...state, subscriptions: state.subscriptions.filter((entry) => entry.id !== id) });
  }

  /** Renamed channels and new avatars from the live status. */
  updateChannels(statuses: ChannelStatus[]): void {
    const state = this.get();
    const list = updateFromStatuses(state.subscriptions, statuses);
    if (list) this.change({ ...state, subscriptions: list });
  }

  record(entry: HistoryRecord): void {
    if (!settingsStore.get().privacy.saveHistory) return;
    const state = this.get();
    this.change({
      ...state,
      history: addToHistory(state.history, { ...entry, id: randomUUID(), watchedAt: new Date().toISOString() }),
    });
  }

  remove(id: string): void {
    const state = this.get();
    if (state.history.some((entry) => entry.id === id))
      this.change({ ...state, history: state.history.filter((entry) => entry.id !== id) });
  }

  clearHistory(): void {
    this.change({ ...this.get(), history: [] });
  }

  saveProgress(videoId: string, seconds: number, duration: number | null): void {
    if (!settingsStore.get().privacy.rememberPosition) return;
    const position = positionToKeep(seconds, duration);
    if (position === null) return;
    const state = this.get();
    if (state.progress[videoId] === position) return;
    this.change({ ...state, progress: { ...state.progress, [videoId]: position } });
  }

  resumePosition(videoId: string, duration: number | null): number | null {
    if (!settingsStore.get().privacy.rememberPosition) return null;
    return resumeAt(this.get().progress[videoId], duration);
  }

  clearProgress(): void {
    this.change({ ...this.get(), progress: {} });
  }

  /** Seconds of real playback of a channel; written and shared with every window in 30-second bundles. */
  addWatchTime(id: string, seconds: number): void {
    const state = this.get();
    this.current = { ...state, watchTime: addWatchTime(state.watchTime, id, seconds) };
    for (const listener of this.watchListeners) listener(this.current.watchTime);
    if (this.watchTimer) return;
    this.watchTimer = setTimeout(() => {
      this.watchTimer = undefined;
      this.change(this.get());
    }, watchTimeDelayMs);
  }

  resetWatchTime(): void {
    clearTimeout(this.watchTimer);
    this.watchTimer = undefined;
    this.change({ ...this.get(), watchTime: {} });
  }

  /** Writes what is pending at once (the app is quitting). */
  async flush(): Promise<void> {
    if (this.watchTimer) {
      clearTimeout(this.watchTimer);
      this.watchTimer = undefined;
      this.change(this.get());
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.save();
    }
    await this.writing;
  }

  private change(next: LibraryState) {
    this.current = next;
    for (const listener of this.listeners) listener(next);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.save();
    }, saveDelayMs);
  }

  /** One write at a time; a temporary file and a rename, so a crash never leaves half a file. */
  private save(): void {
    const file = this.file;
    const json = `${JSON.stringify(this.get(), null, 2)}\n`;
    this.writing = this.writing
      .then(async () => {
        const temporary = `${file}.tmp`;
        await writeFile(temporary, json, 'utf8');
        await rename(temporary, file);
      })
      .catch((error: unknown) => console.error('Could not save the library', error));
  }
}

export const libraryStore = new LibraryStore();
