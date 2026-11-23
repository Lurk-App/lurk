// Pasted twitch.tv links (channel, video, clip), recognised the way FreeTube recognises YouTube
// links. Port of TwitchLink from the native macOS app (lurk-macos, Sources/Lurk/Models.swift).

export type TwitchLink =
  { kind: 'channel'; login: string } | { kind: 'vod'; id: string } | { kind: 'clip'; slug: string };

const reserved = new Set([
  'directory',
  'search',
  'settings',
  'downloads',
  'p',
  'jobs',
  'turbo',
  'subscriptions',
  'inventory',
  'wallet',
  'drops',
]);

export function parseTwitchLink(text: string): TwitchLink | null {
  let value = text.trim();
  if (!value.toLowerCase().includes('twitch.tv')) return null;
  if (!value.includes('://')) value = `https://${value}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== 'twitch.tv' && !host.endsWith('.twitch.tv')) return null;
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (host === 'clips.twitch.tv') {
    if (parts[0] === 'embed') {
      const slug = url.searchParams.get('clip');
      return slug ? { kind: 'clip', slug } : null;
    }
    if (parts[0]) return { kind: 'clip', slug: parts[0] };
  }
  if (parts.length >= 2 && parts[0] === 'clip') return { kind: 'clip', slug: parts[1]! };
  if (parts.length >= 3 && parts[1] === 'clip') return { kind: 'clip', slug: parts[2]! };
  const first = parts[0]?.toLowerCase();
  if (!first) return null;
  if (first === 'videos' && parts[1]) return { kind: 'vod', id: parts[1] };
  if (parts.length >= 3 && (parts[1] === 'video' || parts[1] === 'v')) return { kind: 'vod', id: parts[2]! };
  if (reserved.has(first)) return null;
  if (!/^[a-z0-9_]{1,25}$/.test(first)) return null;
  return { kind: 'channel', login: first };
}

export function twitchUrl(link: TwitchLink): string {
  switch (link.kind) {
    case 'channel':
      return `https://www.twitch.tv/${encodeURIComponent(link.login)}`;
    case 'vod':
      return `https://www.twitch.tv/videos/${encodeURIComponent(link.id)}`;
    case 'clip':
      return `https://clips.twitch.tv/${encodeURIComponent(link.slug)}`;
  }
}
