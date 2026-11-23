// Emotes of BetterTTV, 7TV and FrankerFaceZ: where their lists live and how to read them.
// Port of ThirdPartyEmotes from the native macOS app (lurk-macos, Sources/Lurk/Chat.swift).

export type EmoteService = 'bttv' | '7tv' | 'ffz';
export const emoteServices: readonly EmoteService[] = ['bttv', '7tv', 'ffz'];

export interface ThirdPartyEmote {
  /** Prefixed with the service, so ids never clash with Twitch's. */
  id: string;
  name: string;
  url: string;
}

/** The list of a service: global (no room) or of a channel (Twitch room id). */
export function emoteListUrl(service: EmoteService, room: string | null): string {
  const id = room === null ? null : encodeURIComponent(room);
  switch (service) {
    case 'bttv':
      return id === null
        ? 'https://api.betterttv.net/3/cached/emotes/global'
        : `https://api.betterttv.net/3/cached/users/twitch/${id}`;
    case '7tv':
      return id === null ? 'https://7tv.io/v3/emote-sets/global' : `https://7tv.io/v3/users/twitch/${id}`;
    case 'ffz':
      return id === null
        ? 'https://api.frankerfacez.com/v1/set/global'
        : `https://api.frankerfacez.com/v1/room/id/${id}`;
  }
}

/** Emote images are taken only from the services' own image servers. */
const imageHosts = ['cdn.betterttv.net', 'cdn.7tv.app', 'cdn.frankerfacez.com'];

export function isEmoteImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && imageHosts.includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Only these hosts are asked for emote lists (see the setting "Emotes von BTTV, 7TV und FFZ"). */
export const emoteApiHosts = ['api.betterttv.net', '7tv.io', 'api.frankerfacez.com'] as const;

type Json = Record<string, unknown>;
const object = (value: unknown): Json => (typeof value === 'object' && value !== null ? (value as Json) : {});
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function https(link: string): string {
  return link.startsWith('//') ? `https:${link}` : link;
}

export function decodeEmoteList(service: EmoteService, room: string | null, body: unknown): ThirdPartyEmote[] {
  // A list may name any address; only the services' image servers are used.
  return decodeAny(service, room, body).filter((emote) => isEmoteImageUrl(emote.url));
}

function decodeAny(service: EmoteService, room: string | null, body: unknown): ThirdPartyEmote[] {
  switch (service) {
    case 'bttv': {
      const list =
        room === null ? array(body) : [...array(object(body)['channelEmotes']), ...array(object(body)['sharedEmotes'])];
      // Modifiers like "h!" only change the emote before them and have no picture of their own.
      return list.flatMap((entry) => {
        const emote = object(entry);
        const id = text(emote['id']);
        const name = text(emote['code']);
        if (!id || !name || emote['modifier'] === true) return [];
        return [{ id: `bttv:${id}`, name, url: `https://cdn.betterttv.net/emote/${encodeURIComponent(id)}/2x` }];
      });
    }
    case '7tv': {
      const set = room === null ? object(body) : object(object(body)['emote_set']);
      return array(set['emotes']).flatMap((entry) => {
        const emote = object(entry);
        const id = text(emote['id']);
        const name = text(emote['name']);
        if (!id || !name) return [];
        const host =
          text(object(object(emote['data'])['host'])['url']) ?? `//cdn.7tv.app/emote/${encodeURIComponent(id)}`;
        return [{ id: `7tv:${id}`, name, url: `${https(host)}/2x.webp` }];
      });
    }
    case 'ffz': {
      const response = object(body);
      const sets = object(response['sets']);
      // Globally only the default sets count; the others belong to single users.
      const chosen =
        room === null
          ? array(response['default_sets']).map((id) => object(sets[String(id)]))
          : Object.values(sets).map(object);
      return chosen.flatMap((set) =>
        array(set['emoticons']).flatMap((entry) => {
          const emote = object(entry);
          const id = emote['id'];
          const name = text(emote['name']);
          if ((typeof id !== 'number' && typeof id !== 'string') || !name || emote['modifier'] === true) return [];
          const animated = object(emote['animated']);
          const urls = object(emote['urls']);
          const link = text(animated['2']) ?? text(animated['1']) ?? text(urls['2']) ?? text(urls['1']);
          return link ? [{ id: `ffz:${id}`, name, url: https(link) }] : [];
        }),
      );
    }
  }
}
