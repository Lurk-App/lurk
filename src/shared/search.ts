// Suggestions while typing in the sidebar search. Port of SearchModel from the native macOS app
// (lurk-macos, Sources/Lurk/Views/Search.swift).
//
// Channel order: exact match, then subscribed, then live (by viewers), then your own viewing time,
// then followers. A pasted twitch.tv link comes first; without one, "all results" comes last.

import { parseTwitchLink, type TwitchLink } from './links';
import type { ChannelInfo, Game, SearchResults } from './models';

export type Suggestion =
  | { kind: 'link'; id: string; link: TwitchLink }
  | { kind: 'channel'; id: string; channel: ChannelInfo; subscribed: boolean }
  | { kind: 'category'; id: string; game: Game }
  | { kind: 'all'; id: string; term: string };

/** What Lurk knows locally about the user's channels. Empty until subscriptions exist. */
export interface SearchContext {
  subscriptions: readonly ChannelInfo[];
  isSubscribed(id: string): boolean;
  watchSeconds(id: string): number;
}

export const emptySearchContext: SearchContext = {
  subscriptions: [],
  isSubscribed: () => false,
  watchSeconds: () => 0,
};

export const maxChannelSuggestions = 6;
export const maxCategorySuggestions = 3;
/** Pause in typing before Twitch is asked. */
export const searchDebounceMs = 220;

export function channelScore(channel: ChannelInfo, term: string, context: SearchContext): number {
  const login = channel.ref.login.toLowerCase();
  const name = channel.ref.displayName.toLowerCase();
  let score = 0;
  if (login === term || name === term) score += 1000;
  else if (login.startsWith(term) || name.startsWith(term)) score += 250;
  else if (login.includes(term) || name.includes(term)) score += 60;
  if (context.isSubscribed(channel.ref.id)) score += 300;
  if (channel.stream) score += 120 + Math.log10(channel.stream.viewersCount + 1) * 25;
  const seconds = context.watchSeconds(channel.ref.id);
  if (seconds > 0) score += Math.log10(seconds + 1) * 40;
  if (channel.followers !== null) score += Math.log10(channel.followers + 1) * 30;
  return score;
}

export function buildSuggestions(
  query: string,
  remote: SearchResults | undefined,
  context: SearchContext = emptySearchContext,
): Suggestion[] {
  const term = query.trim();
  if (!term) return [];
  const lower = term.toLowerCase();
  const list: Suggestion[] = [];
  const link = parseTwitchLink(term);
  if (link)
    list.push({
      kind: 'link',
      id: `l-${link.kind}-${'login' in link ? link.login : 'id' in link ? link.id : link.slug}`,
      link,
    });

  const byId = new Map<string, ChannelInfo>();
  for (const channel of context.subscriptions) {
    if (channel.ref.login.toLowerCase().includes(lower) || channel.ref.displayName.toLowerCase().includes(lower)) {
      byId.set(channel.ref.id, channel);
    }
  }
  for (const channel of remote?.channels ?? []) byId.set(channel.ref.id, channel);
  const ranked = [...byId.values()]
    .map((channel) => ({ channel, score: channelScore(channel, lower, context) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxChannelSuggestions);
  for (const { channel } of ranked) {
    list.push({
      kind: 'channel',
      id: `c-${channel.ref.id}`,
      channel,
      subscribed: context.isSubscribed(channel.ref.id),
    });
  }
  for (const game of (remote?.categories ?? []).slice(0, maxCategorySuggestions)) {
    list.push({ kind: 'category', id: `g-${game.id}`, game });
  }
  if (!link) list.push({ kind: 'all', id: `a-${term}`, term });
  return list;
}

/** Arrow keys: moves the highlight with wrap-around; from nothing, down starts at the top. */
export function moveHighlight(current: number | null, delta: number, count: number): number | null {
  if (count === 0) return null;
  const start = current ?? (delta > 0 ? -1 : count);
  return (((start + delta) % count) + count) % count;
}
