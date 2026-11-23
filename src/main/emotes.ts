// Emote lists of BetterTTV, 7TV and FrankerFaceZ, fetched only from their three APIs and kept in
// memory. A list that fails is simply missing and is tried again for the next channel.

import { net } from 'electron';
import {
  decodeEmoteList,
  emoteListUrl,
  emoteServices,
  type EmoteService,
  type ThirdPartyEmote,
} from '@shared/thirdPartyEmotes';

const lists = new Map<string, Promise<ThirdPartyEmote[] | null>>();

async function fetchList(service: EmoteService, room: string | null): Promise<ThirdPartyEmote[] | null> {
  try {
    const response = await net.fetch(emoteListUrl(service, room), { signal: AbortSignal.timeout(10_000) });
    // 404: the channel does not use this service.
    if (response.status === 404) return [];
    if (!response.ok) return null;
    return decodeEmoteList(service, room, await response.json());
  } catch {
    return null;
  }
}

function list(service: EmoteService, room: string | null): Promise<ThirdPartyEmote[] | null> {
  const key = `${service}|${room ?? ''}`;
  let pending = lists.get(key);
  if (!pending) {
    pending = fetchList(service, room).then((result) => {
      if (result === null) lists.delete(key);
      return result;
    });
    lists.set(key, pending);
  }
  return pending;
}

/** Global and channel emotes of all three services; later lists win on equal names, as on macOS. */
export async function thirdPartyEmotes(room: string): Promise<Record<string, { id: string; url: string }>> {
  const keys: [EmoteService, string | null][] = [
    ...emoteServices.map((service): [EmoteService, null] => [service, null]),
    ...emoteServices.map((service): [EmoteService, string] => [service, room]),
  ];
  const results = await Promise.all(keys.map(([service, key]) => list(service, key)));
  const byName: Record<string, { id: string; url: string }> = {};
  for (const emote of results.flatMap((result) => result ?? [])) byName[emote.name] = { id: emote.id, url: emote.url };
  return byName;
}
