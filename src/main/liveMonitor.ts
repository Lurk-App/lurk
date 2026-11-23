// The live status of the subscriptions: asked at start, every two minutes while Lurk runs, right
// after subscribing and on "Aktualisieren". A failed answer keeps the last values. When a channel
// goes live and "Melden, wenn abonnierte Kanäle live gehen" is on, the system shows a notification.
// Port of refreshLive, startMonitor and notifyNewlyLive of the macOS app's Library
// (lurk-macos, Sources/Lurk/Library.swift).

import { Notification } from 'electron';
import { emptyLiveState, newlyLive, type ChannelStatus, type LiveState } from '@shared/subscriptions';
import { menuFormat } from './i18n';
import { libraryStore } from './libraryStore';
import { settingsStore } from './settingsStore';
import { channelStatuses } from './twitch';

type Listener = (state: LiveState) => void;

const intervalMs = 120_000;

class LiveMonitor {
  private state: LiveState = emptyLiveState;
  private listeners = new Set<Listener>();
  private timer: NodeJS.Timeout | undefined;
  private again = false;
  /** Channel id → live at the last answer; a channel goes live when it was false before. */
  private wasLive: Record<string, boolean> = {};

  get(): LiveState {
    return this.state;
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), intervalMs);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async refresh(): Promise<void> {
    if (this.state.refreshing) {
      // A refresh is out (a channel was just subscribed meanwhile): once more afterwards.
      this.again = true;
      return;
    }
    const ids = libraryStore.get().subscriptions.map((entry) => entry.id);
    if (!ids.length) {
      this.wasLive = {};
      this.update({ statuses: {}, refreshing: false, lastRefresh: new Date().toISOString(), failed: false });
      return;
    }
    this.update({ ...this.state, refreshing: true });
    try {
      const statuses = await channelStatuses(ids);
      const subscribed = new Set(libraryStore.get().subscriptions.map((entry) => entry.id));
      const map: Record<string, ChannelStatus> = {};
      for (const status of statuses) if (subscribed.has(status.ref.id)) map[status.ref.id] = status;
      this.notify(statuses);
      libraryStore.updateChannels(statuses);
      this.update({ statuses: map, refreshing: false, lastRefresh: new Date().toISOString(), failed: false });
    } catch {
      this.update({ ...this.state, refreshing: false, lastRefresh: new Date().toISOString(), failed: true });
    }
    if (this.again) {
      this.again = false;
      await this.refresh();
    }
  }

  /** An unsubscribed channel leaves the status at once, without asking Twitch. */
  forget(id: string): void {
    if (!(id in this.state.statuses)) return;
    const statuses = { ...this.state.statuses };
    delete statuses[id];
    delete this.wasLive[id];
    this.update({ ...this.state, statuses });
  }

  private notify(statuses: ChannelStatus[]) {
    const enabled = settingsStore.get().player.liveNotifications && Notification.isSupported();
    if (enabled) {
      for (const status of newlyLive(this.wasLive, statuses)) {
        const body = [status.stream?.title, status.stream?.game?.displayName].filter(Boolean).join(' · ');
        new Notification({ title: menuFormat('liveNotification', { name: status.ref.displayName }), body }).show();
      }
    }
    for (const status of statuses) this.wasLive[status.ref.id] = status.stream !== null;
  }

  private update(next: LiveState) {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }
}

export const liveMonitor = new LiveMonitor();
