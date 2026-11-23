// Anonymous, read-only Twitch chat: IRC lines, message segments, emotes and name colours.
// Port of IRCMessage, ChatParser and ChatColor from the native macOS app (lurk-macos,
// Sources/Lurk/Chat.swift). Pure functions; the WebSocket lives in the interface.

import { chatNamePalette } from './theme';

export type ChatSegment = { kind: 'text'; text: string } | { kind: 'emote'; id: string; name: string };

export interface ChatMessage {
  id: string;
  login: string;
  author: string;
  colorHex: string | null;
  segments: ChatSegment[];
  isAction: boolean;
  isSystem: boolean;
  isDeleted: boolean;
}

export interface IrcMessage {
  tags: Record<string, string>;
  prefix: string | null;
  command: string;
  params: string[];
  trailing: string | null;
}

/** IRCv3 tag values: \s space, \: semicolon, \r, \n, \\ backslash. */
export function unescapeTag(value: string): string {
  if (!value.includes('\\')) return value;
  let output = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (char !== '\\') {
      output += char;
      continue;
    }
    const next = value[index + 1];
    index += 1;
    if (next === undefined) break;
    output += next === 's' ? ' ' : next === ':' ? ';' : next === 'r' ? '\r' : next === 'n' ? '\n' : next;
  }
  return output;
}

export function parseIrc(raw: string): IrcMessage | null {
  let rest = raw;
  const tags: Record<string, string> = {};
  let prefix: string | null = null;
  if (rest.startsWith('@')) {
    const space = rest.indexOf(' ');
    if (space < 0) return null;
    for (const pair of rest.slice(1, space).split(';')) {
      const equals = pair.indexOf('=');
      if (equals > 0) tags[pair.slice(0, equals)] = unescapeTag(pair.slice(equals + 1));
      else if (pair) tags[pair] = '';
    }
    rest = rest.slice(space + 1);
  }
  if (rest.startsWith(':')) {
    const space = rest.indexOf(' ');
    if (space < 0) return null;
    prefix = rest.slice(1, space);
    rest = rest.slice(space + 1);
  }
  let trailing: string | null = null;
  const trailingStart = rest.indexOf(' :');
  if (trailingStart >= 0) {
    trailing = rest.slice(trailingStart + 2);
    rest = rest.slice(0, trailingStart);
  }
  const parts = rest.split(' ').filter(Boolean);
  const command = parts.shift();
  if (!command) return null;
  return { tags, prefix, command, params: parts, trailing };
}

/** Splits a message by the `emotes` tag (positions in Unicode code points). */
export function segmentsFor(text: string, emotesTag: string | undefined): ChatSegment[] {
  if (!emotesTag) return [{ kind: 'text', text }];
  const points = Array.from(text);
  const ranges: { start: number; end: number; id: string }[] = [];
  for (const emote of emotesTag.split('/')) {
    const colon = emote.indexOf(':');
    if (colon <= 0) continue;
    const id = emote.slice(0, colon);
    for (const position of emote.slice(colon + 1).split(',')) {
      const [from, to] = position.split('-').map((value) => Number.parseInt(value, 10));
      if (
        from !== undefined &&
        to !== undefined &&
        Number.isInteger(from) &&
        Number.isInteger(to) &&
        from <= to &&
        to < points.length
      ) {
        ranges.push({ start: from, end: to, id });
      }
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  const segments: ChatSegment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    if (range.start > cursor) segments.push({ kind: 'text', text: points.slice(cursor, range.start).join('') });
    segments.push({ kind: 'emote', id: range.id, name: points.slice(range.start, range.end + 1).join('') });
    cursor = range.end + 1;
  }
  if (cursor < points.length) segments.push({ kind: 'text', text: points.slice(cursor).join('') });
  return segments;
}

/**
 * Replaces whole words in text segments with emotes of BTTV, 7TV and FFZ (name → emote id).
 * Twitch emotes stay as they are; applying it twice changes nothing.
 */
export function applyWordEmotes(emotes: ReadonlyMap<string, string>, segments: ChatSegment[]): ChatSegment[] {
  if (emotes.size === 0) return segments;
  const result: ChatSegment[] = [];
  for (const segment of segments) {
    if (segment.kind !== 'text') {
      result.push(segment);
      continue;
    }
    let buffer = '';
    segment.text.split(' ').forEach((word, index) => {
      if (index > 0) buffer += ' ';
      const id = emotes.get(word);
      if (id) {
        if (buffer) result.push({ kind: 'text', text: buffer });
        buffer = '';
        result.push({ kind: 'emote', id, name: word });
      } else {
        buffer += word;
      }
    });
    if (buffer) result.push({ kind: 'text', text: buffer });
  }
  return result;
}

let counter = 0;
function localId(): string {
  counter += 1;
  return `local-${counter}`;
}

export function messageFrom(irc: IrcMessage, wordEmotes: ReadonlyMap<string, string> = new Map()): ChatMessage | null {
  switch (irc.command) {
    case 'PRIVMSG': {
      let text = irc.trailing;
      if (text === null) return null;
      let isAction = false;
      if (text.startsWith('\u0001ACTION ') && text.endsWith('\u0001')) {
        text = text.slice(8, -1);
        isAction = true;
      }
      const login = irc.prefix?.split('!')[0] ?? '?';
      return {
        id: irc.tags['id'] ?? localId(),
        login,
        author: irc.tags['display-name'] || login,
        colorHex: irc.tags['color'] || null,
        segments: applyWordEmotes(wordEmotes, segmentsFor(text, irc.tags['emotes'])),
        isAction,
        isSystem: false,
        isDeleted: false,
      };
    }
    case 'USERNOTICE': {
      const segments: ChatSegment[] = [{ kind: 'text', text: irc.tags['system-msg'] ?? '' }];
      if (irc.trailing) {
        segments.push({ kind: 'text', text: ' – ' });
        segments.push(...segmentsFor(irc.trailing, irc.tags['emotes']));
      }
      return {
        id: irc.tags['id'] ?? localId(),
        login: irc.tags['login'] ?? '',
        author: irc.tags['display-name'] ?? '',
        colorHex: irc.tags['color'] || null,
        segments,
        isAction: false,
        isSystem: true,
        isDeleted: false,
      };
    }
    case 'NOTICE':
      return irc.trailing === null
        ? null
        : {
            id: localId(),
            login: '',
            author: '',
            colorHex: null,
            segments: [{ kind: 'text', text: irc.trailing }],
            isAction: false,
            isSystem: true,
            isDeleted: false,
          };
    default:
      return null;
  }
}

/** Twitch emotes by id; third-party ids carry their own image address. */
export function twitchEmoteUrl(id: string, scheme: 'light' | 'dark'): string {
  return `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}/default/${scheme}/2.0`;
}

// MARK: Name colours

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

function rgbToHsb([r, g, b]: [number, number, number]): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue /= 6;
    if (hue < 0) hue += 1;
  }
  return [hue, max === 0 ? 0 : delta / max, max];
}

function hsbToHex(hue: number, saturation: number, brightness: number): string {
  const f = (n: number) => {
    const k = (n + hue * 6) % 6;
    return brightness - brightness * saturation * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return `#${[f(5), f(3), f(1)]
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase()}`;
}

/** The user's colour, lifted on dark and darkened on light so it stays readable (ChatColor). */
export function chatColor(hex: string | null, login: string, dark: boolean): string {
  let sum = 0;
  for (const char of login) sum += char.codePointAt(0) ?? 0;
  const fallback = chatNamePalette[sum % chatNamePalette.length]!;
  const rgb = hexToRgb(hex || fallback) ?? hexToRgb(fallback)!;
  const [hue, baseSaturation, baseBrightness] = rgbToHsb(rgb);
  let saturation = baseSaturation;
  let brightness = baseBrightness;
  if (dark) {
    brightness = Math.max(brightness, 0.82);
    saturation = Math.min(saturation, 0.75);
  } else {
    brightness = Math.min(brightness, 0.62);
  }
  return hsbToHex(hue, saturation, brightness);
}
