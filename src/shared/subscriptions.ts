// Subscriptions without an account: channels kept on this computer, and their live status. Port of
// the subscription parts of the native macOS app's Library (lurk-macos, Sources/Lurk/Library.swift:
// subscribe, liveChannels, offlineSubscriptions, import and export, normalizeLogin).

import type { BrowseStream } from './browse';
import { parseTwitchLink } from './links';
import type { ChannelRef } from './models';

export interface Subscription {
  id: string;
  login: string;
  displayName: string;
  profileImageURL: string | null;
  /** ISO time. */
  addedAt: string;
}

/** What Lurk knows about a subscribed channel right now (not stored). */
export interface ChannelStatus {
  ref: ChannelRef;
  stream: BrowseStream | null;
  /** Start of the last broadcast, ISO. */
  lastLiveAt: string | null;
}

export interface LiveState {
  /** Channel id → status, for the channels Twitch answered about. */
  statuses: Record<string, ChannelStatus>;
  refreshing: boolean;
  /** ISO time of the last answer (or failure); null before the first. */
  lastRefresh: string | null;
  /** The last refresh failed; the statuses are the ones before it. */
  failed: boolean;
}

export const emptyLiveState: LiveState = { statuses: {}, refreshing: false, lastRefresh: null, failed: false };

/** The most subscriptions Lurk keeps (Twitch is asked in blocks of 50). */
export const subscriptionLimit = 5000;

export function toSubscription(channel: ChannelRef, now: Date = new Date()): Subscription {
  return {
    id: channel.id,
    login: channel.login.toLowerCase(),
    displayName: channel.displayName || channel.login,
    profileImageURL: channel.profileImageURL,
    addedAt: now.toISOString(),
  };
}

export function sortByName(list: Subscription[]): Subscription[] {
  return [...list].sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }));
}

/** Adds channels not yet subscribed; returns the new list and how many were added. */
export function addSubscriptions(
  list: Subscription[],
  channels: ChannelRef[],
  now: Date = new Date(),
): { list: Subscription[]; added: number } {
  const known = new Set(list.map((entry) => entry.id));
  const fresh: Subscription[] = [];
  for (const channel of channels) {
    if (known.has(channel.id) || list.length + fresh.length >= subscriptionLimit) continue;
    known.add(channel.id);
    fresh.push(toSubscription(channel, now));
  }
  return { list: fresh.length ? sortByName([...list, ...fresh]) : list, added: fresh.length };
}

/** Takes over renamed channels and new avatars from fresh answers. */
export function updateFromStatuses(list: Subscription[], statuses: ChannelStatus[]): Subscription[] | null {
  const byId = new Map(statuses.map((status) => [status.ref.id, status.ref]));
  let changed = false;
  const next = list.map((entry) => {
    const ref = byId.get(entry.id);
    if (!ref) return entry;
    const login = ref.login.toLowerCase();
    if (login === entry.login && ref.displayName === entry.displayName && ref.profileImageURL === entry.profileImageURL)
      return entry;
    changed = true;
    return { ...entry, login, displayName: ref.displayName, profileImageURL: ref.profileImageURL };
  });
  return changed ? sortByName(next) : null;
}

/** Live subscriptions, most viewers first. */
export function liveStreams(list: Subscription[], statuses: Record<string, ChannelStatus>): BrowseStream[] {
  return list
    .flatMap((entry) => {
      const stream = statuses[entry.id]?.stream;
      return stream ? [stream] : [];
    })
    .sort((a, b) => b.viewersCount - a.viewersCount);
}

/** Offline subscriptions, the most recently live first. */
export function offlineSubscriptions(list: Subscription[], statuses: Record<string, ChannelStatus>): Subscription[] {
  const lastLive = (entry: Subscription) => Date.parse(statuses[entry.id]?.lastLiveAt ?? '') || 0;
  return list.filter((entry) => !statuses[entry.id]?.stream).sort((a, b) => lastLive(b) - lastLive(a));
}

/** Channels that went live since the last answer (known to be offline before). */
export function newlyLive(previous: Record<string, boolean>, statuses: ChannelStatus[]): ChannelStatus[] {
  return statuses.filter((status) => status.stream !== null && previous[status.ref.id] === false);
}

/** A Twitch login from a name, "@name" or a twitch.tv link; null when it is none. */
export function normalizeLogin(raw: string): string | null {
  let value = raw.trim().replace(/^["'@<>]+|["'@<>]+$/g, '');
  if (value.toLowerCase().includes('twitch.tv')) {
    const link = parseTwitchLink(value);
    if (link?.kind !== 'channel') return null;
    value = link.login;
  }
  value = value.toLowerCase();
  return /^[a-z0-9_]{1,25}$/.test(value) ? value : null;
}

/**
 * What an import file holds: Lurk's own JSON (channels with their ids), a JSON list of names or of
 * objects with login/name/channel, or text and CSV with names or twitch.tv links.
 */
export function parseImport(text: string): { channels: ChannelRef[]; logins: string[] } {
  const channels: ChannelRef[] = [];
  const names: string[] = [];
  let json: unknown = undefined;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON: a text list.
  }
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const list = (json as Record<string, unknown>)['subscriptions'];
    for (const item of Array.isArray(list) ? list : []) {
      const raw = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
      const id = raw['id'];
      const login = typeof raw['login'] === 'string' ? normalizeLogin(raw['login']) : null;
      // Kick and YouTube subscriptions of the macOS app are left out (stage 3).
      const provider = raw['provider'];
      if (
        typeof id !== 'string' ||
        !/^\d{1,20}$/.test(id) ||
        !login ||
        (provider !== undefined && provider !== 'twitch')
      )
        continue;
      const displayName = typeof raw['displayName'] === 'string' ? raw['displayName'].slice(0, 100) : login;
      const picture = raw['profileImageURL'];
      channels.push({
        id,
        login,
        displayName,
        profileImageURL: typeof picture === 'string' && picture.startsWith('https://') ? picture : null,
      });
    }
  } else if (Array.isArray(json)) {
    for (const item of json) {
      if (typeof item === 'string') names.push(item);
      else if (typeof item === 'object' && item !== null) {
        const raw = item as Record<string, unknown>;
        const name = raw['login'] ?? raw['name'] ?? raw['channel'];
        if (typeof name === 'string') names.push(name);
      }
    }
  } else if (json === undefined) {
    names.push(...text.split(/[\s,;]+/));
  }
  const logins = [...new Set(names.flatMap((name) => normalizeLogin(name) ?? []))];
  return { channels, logins };
}

export function exportJSON(list: Subscription[], now: Date = new Date()): string {
  return `${JSON.stringify({ app: 'Lurk', version: 1, exportedAt: now.toISOString(), subscriptions: list }, null, 2)}\n`;
}

export function exportText(list: Subscription[]): string {
  return `${list.map((entry) => entry.login).join('\n')}\n`;
}

/** Reads the stored list; broken entries are dropped instead of failing. */
export function normalizeSubscriptions(value: unknown): Subscription[] {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const result: Subscription[] = [];
  for (const item of list) {
    const raw = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    const id = raw['id'];
    const login = typeof raw['login'] === 'string' ? normalizeLogin(raw['login']) : null;
    if (typeof id !== 'string' || !/^\d{1,20}$/.test(id) || !login || seen.has(id)) continue;
    seen.add(id);
    const picture = raw['profileImageURL'];
    const addedAt =
      typeof raw['addedAt'] === 'string' && !Number.isNaN(Date.parse(raw['addedAt'])) ? raw['addedAt'] : '';
    result.push({
      id,
      login,
      displayName:
        typeof raw['displayName'] === 'string' && raw['displayName'] ? raw['displayName'].slice(0, 100) : login,
      profileImageURL: typeof picture === 'string' && picture.startsWith('https://') ? picture : null,
      addedAt: addedAt || new Date(0).toISOString(),
    });
  }
  return sortByName(result.slice(0, subscriptionLimit));
}
