// HLS playlist parsing with Twitch ad detection.
// Port of M3U8.parseMaster / MediaPlaylist.parse from the native macOS app (lurk-macos, Sources/Lurk/HLS.swift).

export interface StreamVariant {
  name: string;
  isSource: boolean;
  height: number | null;
  bandwidth: number;
  url: string;
}

export interface MediaSegment {
  sequence: number;
  duration: number;
  url: string;
  title: string;
  /** Program date time in ms since epoch. */
  programDate: number | null;
  discontinuity: boolean;
  isAd: boolean;
  /** Init segment (fMP4 streams with #EXT-X-MAP); null for MPEG-TS. */
  map: string | null;
}

export interface AdBreakRange {
  start: number;
  duration: number | null;
}

export interface MediaPlaylist {
  targetDuration: number;
  mediaSequence: number;
  segments: MediaSegment[];
  adBreaks: AdBreakRange[];
  ended: boolean;
}

/** Attribute list of an HLS tag: KEY=VALUE,KEY="quoted, value". */
export function attributes(input: string): Record<string, string> {
  const result: Record<string, string> = {};
  let key = '';
  let value = '';
  let readingKey = true;
  let inQuotes = false;
  for (const char of input) {
    if (readingKey) {
      if (char === '=') readingKey = false;
      else if (char !== ',') key += char;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result[key] = value;
      key = '';
      value = '';
      readingKey = true;
    } else {
      value += char;
    }
  }
  if (key) result[key] = value;
  return result;
}

function resolve(uri: string, base: string): string | null {
  try {
    return new URL(uri, base).toString();
  } catch {
    return null;
  }
}

function parseDate(text: string | undefined): number | null {
  if (!text) return null;
  const value = Date.parse(text);
  return Number.isNaN(value) ? null : value;
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n|\r/);
}

export function parseMaster(text: string, base: string): StreamVariant[] {
  const groupNames: Record<string, string> = {};
  const variants: StreamVariant[] = [];
  let pending: Record<string, string> | null = null;

  for (const raw of splitLines(text)) {
    const line = raw.trim();
    if (line.startsWith('#EXT-X-MEDIA:')) {
      const attrs = attributes(line.slice('#EXT-X-MEDIA:'.length));
      if (attrs['GROUP-ID'] && attrs['NAME']) groupNames[attrs['GROUP-ID']] = attrs['NAME'];
    } else if (line.startsWith('#EXT-X-STREAM-INF:')) {
      pending = attributes(line.slice('#EXT-X-STREAM-INF:'.length));
    } else if (!line.startsWith('#') && line !== '' && pending) {
      const attrs = pending;
      pending = null;
      const url = resolve(line, base);
      if (!url) continue;
      const group = attrs['VIDEO'] ?? '';
      let name = groupNames[group] ?? group;
      const isSource = name.includes('(source)') || group === 'chunked';
      name = name.replace(' (source)', '');
      // Live the track is called "audio_only", VODs say "Audio Only".
      if (group === 'audio_only' || name.toLowerCase().startsWith('audio')) name = 'audio_only';
      const heightText = attrs['RESOLUTION']?.split('x').at(-1);
      const height = heightText ? Number.parseInt(heightText, 10) : NaN;
      const resolvedHeight = Number.isNaN(height) ? null : height;
      if (name === '' || name === 'chunked') name = resolvedHeight ? `${resolvedHeight}p` : 'Quelle';
      variants.push({
        name,
        isSource,
        height: resolvedHeight,
        bandwidth: Number.parseInt(attrs['BANDWIDTH'] ?? '0', 10) || 0,
        url,
      });
    }
  }
  return variants.sort((lhs, rhs) => {
    const la = isAudioOnly(lhs);
    const ra = isAudioOnly(rhs);
    if (la !== ra) return la ? 1 : -1;
    return rhs.bandwidth - lhs.bandwidth;
  });
}

export function isAudioOnly(variant: StreamVariant): boolean {
  return variant.name === 'audio_only';
}

/** Best video variant no taller than `maxHeight`; the smallest one if none fits. */
export function pickVariant(variants: StreamVariant[], maxHeight: number): StreamVariant | null {
  const video = variants.filter((variant) => !isAudioOnly(variant));
  const fitting = video.filter((variant) => (variant.height ?? 0) <= maxHeight);
  return fitting[0] ?? video.at(-1) ?? null;
}

/** The live preview of a tile: the smallest video variant from 360p up, else the smallest of all. */
export function previewVariant(variants: StreamVariant[]): StreamVariant | null {
  const video = variants.filter((variant) => !isAudioOnly(variant)).sort((a, b) => a.bandwidth - b.bandwidth);
  return video.find((variant) => (variant.height ?? 0) >= 360) ?? video[0] ?? null;
}

export function parseMedia(text: string, base: string): MediaPlaylist {
  const playlist: MediaPlaylist = { targetDuration: 2, mediaSequence: 0, segments: [], adBreaks: [], ended: false };
  let pendingDuration: number | null = null;
  let pendingTitle = '';
  let pendingDate: number | null = null;
  let pendingDiscontinuity = false;
  let index = 0;
  let lastDate: number | null = null;
  let lastDuration = 0;
  let currentMap: string | null = null;

  for (const raw of splitLines(text)) {
    const line = raw.trim();
    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      playlist.targetDuration = Number.parseFloat(line.slice(22)) || 2;
    } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      playlist.mediaSequence = Number.parseInt(line.slice(22), 10) || 0;
    } else if (line === '#EXT-X-DISCONTINUITY') {
      pendingDiscontinuity = true;
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const uri = attributes(line.slice(11))['URI'];
      currentMap = uri ? resolve(uri, base) : null;
    } else if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
      pendingDate = parseDate(line.slice(25));
    } else if (line.startsWith('#EXT-X-DATERANGE:')) {
      const attrs = attributes(line.slice(17));
      const isAd = attrs['CLASS'] === 'twitch-stitched-ad' || (attrs['ID'] ?? '').startsWith('stitched-ad');
      const start = parseDate(attrs['START-DATE']);
      if (isAd && start !== null) {
        const duration = attrs['DURATION'] ? Number.parseFloat(attrs['DURATION']) : NaN;
        playlist.adBreaks.push({ start, duration: Number.isNaN(duration) ? null : duration });
      }
    } else if (line.startsWith('#EXTINF:')) {
      const body = line.slice(8);
      const comma = body.indexOf(',');
      const durationText = comma >= 0 ? body.slice(0, comma) : body;
      const duration = Number.parseFloat(durationText);
      pendingDuration = Number.isNaN(duration) ? 2 : duration;
      pendingTitle = comma >= 0 ? body.slice(comma + 1) : '';
    } else if (line === '#EXT-X-ENDLIST') {
      playlist.ended = true;
    } else if (!line.startsWith('#') && line !== '' && pendingDuration !== null) {
      const url = resolve(line, base);
      if (!url) continue;
      const date: number | null = pendingDate ?? (lastDate !== null ? lastDate + lastDuration * 1000 : null);
      playlist.segments.push({
        sequence: playlist.mediaSequence + index,
        duration: pendingDuration,
        url,
        title: pendingTitle,
        programDate: date,
        discontinuity: pendingDiscontinuity,
        isAd: false,
        map: currentMap,
      });
      index += 1;
      lastDate = date;
      lastDuration = pendingDuration;
      pendingDuration = null;
      pendingTitle = '';
      pendingDate = null;
      pendingDiscontinuity = false;
    }
  }

  for (const segment of playlist.segments) {
    const titledAd = segment.title !== '' && !segment.title.toLowerCase().startsWith('live');
    const date = segment.programDate;
    const inBreak =
      date !== null &&
      playlist.adBreaks.some(
        (range) => range.duration !== null && date >= range.start - 100 && date < range.start + range.duration * 1000,
      );
    segment.isAd = titledAd || inBreak;
  }
  return playlist;
}

/** Is an ad running at the live edge? */
export function edgeHasAd(playlist: MediaPlaylist): boolean {
  return playlist.segments.slice(-2).some((segment) => segment.isAd);
}

/** Are the last seconds of the playlist ad-free? The player starts a few segments behind the edge. */
export function isAdFree(playlist: MediaPlaylist, lastSeconds: number): boolean {
  if (playlist.segments.length === 0) return false;
  let covered = 0;
  for (let i = playlist.segments.length - 1; i >= 0; i--) {
    const segment = playlist.segments[i]!;
    if (segment.isAd) return false;
    covered += segment.duration;
    if (covered >= lastSeconds) return true;
  }
  return true;
}

/** Start of the ad currently running at the live edge (ms since epoch). */
export function currentAdStart(playlist: MediaPlaylist): number | null {
  if (!edgeHasAd(playlist)) return null;
  let start: number | null = null;
  for (let i = playlist.segments.length - 1; i >= 0; i--) {
    const segment = playlist.segments[i]!;
    if (!segment.isAd) break;
    start = segment.programDate;
  }
  return start;
}

/** Estimated end of the running ad break, if Twitch sends its length (ms since epoch). */
export function estimatedAdEnd(playlist: MediaPlaylist): number | null {
  const start = currentAdStart(playlist);
  if (start === null) return null;
  const ends = playlist.adBreaks
    .filter((range): range is AdBreakRange & { duration: number } => range.duration !== null)
    .map((range) => range.start + range.duration * 1000)
    .filter((end) => end > start);
  return ends.length ? Math.max(...ends) : null;
}
