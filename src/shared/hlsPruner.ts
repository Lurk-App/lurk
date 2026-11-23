// Lurk's counterpart to uBlock Origin's `m3u-prune` scriptlet.
// Port of HLSPruner from the native macOS app (lurk-macos, Sources/Lurk/Blocker/HLSPruner.swift).
//
// uBO simply removes matching lines. Players identify segments by their running number
// (EXT-X-MEDIA-SEQUENCE + position), so removing segments in the middle of the window would shift
// the numbers on every reload. This pruner gives every kept segment one stable, gap-free number,
// marks every cut with EXT-X-DISCONTINUITY (with a matching EXT-X-DISCONTINUITY-SEQUENCE) and never
// returns an empty or backwards-running playlist. One instance belongs to exactly one media playlist.

import { attributes } from './m3u8';

export interface PruneRule {
  /** The filter text the rule came from, for the log. */
  text: string;
  pattern: RegExp;
  isMultiline: boolean;
  isGlobal: boolean;
}

export interface PruneReport {
  removedSequences: Set<number>;
  removedSegments: number;
  removedSeconds: number;
  removedLines: number;
  startedBreak: boolean;
  rules: Set<string>;
}

export interface PruneResult {
  text: string;
  report: PruneReport;
  isEmpty: boolean;
}

/** A regex argument as uBO writes it: `/source/flags`. */
export function pruneRule(argument: string): PruneRule {
  const match = /^\/(.*)\/([a-z]*)$/s.exec(argument);
  if (!match) throw new Error(`not a regex argument: ${argument}`);
  const source = match[1]!;
  const flags = match[2]!;
  return {
    text: argument,
    // Always global internally; `isGlobal` decides how many matches are used.
    pattern: new RegExp(source, flags.includes('g') ? flags : `${flags}g`),
    isMultiline: flags.includes('m'),
    isGlobal: flags.includes('g'),
  };
}

/** The two m3u-prune rules of Lurk's built-in filter list (`BuiltInFilters.lurkDefault`). */
export const builtInPruneRules: PruneRule[] = [
  // Ad segments: every #EXTINF block with a title that does not start with "live", with its URI.
  // A title is required: video (VOD) segments have none, and the macOS app's marking
  // (HLS.swift, `!segment.title.isEmpty`) leaves them alone too.
  pruneRule('/^#EXTINF:[\\d.]+,(?!live)[^\\n]+\\n[^\\n#][^\\n]*/gm'),
  // Ad markers in the same playlist.
  pruneRule('/^#EXT-X-DATERANGE:[^\\n]*(?:twitch-stitched-ad|twitch-ad-quartile|stitched-ad-)[^\\n]*/gm'),
];

interface Block {
  real: number;
  duration: number;
  tagLines: number[];
  extinfLine: number;
  uriLine: number;
  uri: string;
  hadDiscontinuity: boolean;
  map: string | null;
}

interface Rendered {
  virtual: number;
  lines: string[];
  map: string | null;
}

/** Only these segment tags are carried over; Twitch's own markers would repeat when the window moves. */
const segmentTags = ['#EXT-X-PROGRAM-DATE-TIME', '#EXT-X-BYTERANGE', '#EXT-X-KEY', '#EXT-X-BITRATE'];

export class HlsPruner {
  private virtualForReal = new Map<number, number>();
  private nextVirtual: number | null = null;
  private lastAssignedReal = Number.MIN_SAFE_INTEGER;
  private pendingGap = false;
  private inBreak = false;
  private discontinuities = new Set<number>();
  private lastFirstVirtual = Number.MIN_SAFE_INTEGER;
  private cache: Rendered[] = [];
  private reported = new Set<number>();

  /**
   * @param leadingOnly Only remove ads before the first content, pass everything later through.
   *   AVPlayer aborts a live playlist that stops growing, so the macOS app uses `true`.
   */
  constructor(readonly leadingOnly = false) {}

  /** #EXT-X-MAP with an absolute URI so the filtered playlist stays valid anywhere. */
  static absoluteMap(line: string, base: string): string {
    const uri = attributes(line.slice(11))['URI'];
    if (!uri) return line;
    try {
      return line.replace(`URI="${uri}"`, `URI="${new URL(uri, base).toString()}"`);
    } catch {
      return line;
    }
  }

  prune(text: string, base: string, rules: PruneRule[] = builtInPruneRules): PruneResult {
    const lines = text.replaceAll('\r\n', '\n').split('\n');
    const report: PruneReport = {
      removedSequences: new Set(),
      removedSegments: 0,
      removedSeconds: 0,
      removedLines: 0,
      startedBreak: false,
      rules: new Set(),
    };

    // 1. Split into blocks
    let headerTarget = 2;
    let mediaSequence = 0;
    const keepHeader: string[] = [];
    let ended = false;
    const blocks: Block[] = [];
    let pendingTags: number[] = [];
    let pendingExtinf: number | null = null;
    let discontinuity = false;
    let version = 3;
    let currentMap: string | null = null;
    lines.forEach((raw, index) => {
      const line = raw.trim();
      if (line === '' || line === '#EXTM3U') return;
      if (line.startsWith('#EXT-X-TARGETDURATION:')) {
        headerTarget = Math.trunc(Number.parseFloat(line.slice(22)) || 2);
      } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
        mediaSequence = Number.parseInt(line.slice(22), 10) || 0;
      } else if (line.startsWith('#EXT-X-VERSION:')) {
        version = Math.max(version, Number.parseInt(line.slice(15), 10) || 3);
      } else if (line.startsWith('#EXT-X-MAP:')) {
        currentMap = HlsPruner.absoluteMap(line, base);
      } else if (line.startsWith('#EXT-X-DISCONTINUITY-SEQUENCE') || line.startsWith('#EXT-X-TWITCH-')) {
        return;
      } else if (line === '#EXT-X-ENDLIST') {
        ended = true;
      } else if (line.startsWith('#EXT-X-PLAYLIST-TYPE') || line === '#EXT-X-INDEPENDENT-SEGMENTS') {
        keepHeader.push(line);
      } else if (line === '#EXT-X-DISCONTINUITY') {
        discontinuity = true;
      } else if (line.startsWith('#EXTINF:')) {
        pendingExtinf = index;
      } else if (line.startsWith('#')) {
        pendingTags.push(index);
      } else if (pendingExtinf !== null) {
        const extinf = pendingExtinf;
        const duration = Number.parseFloat(lines[extinf]!.slice(8).split(',')[0] ?? '');
        blocks.push({
          real: mediaSequence + blocks.length,
          duration: Number.isNaN(duration) ? 2 : duration,
          tagLines: pendingTags,
          extinfLine: extinf,
          uriLine: index,
          uri: line,
          hadDiscontinuity: discontinuity,
          map: currentMap,
        });
        pendingTags = [];
        pendingExtinf = null;
        discontinuity = false;
      }
    });

    // 2. Apply rules (semantics like uBO)
    const removed = new Set<number>();
    const joined = lines.join('\n');
    const lineStarts: number[] = [];
    let offset = 0;
    for (const line of lines) {
      lineStarts.push(offset);
      offset += line.length + 1;
    }
    const lineIndex = (position: number): number => {
      let low = 0;
      let high = lineStarts.length - 1;
      while (low < high) {
        const mid = Math.floor((low + high + 1) / 2);
        if (lineStarts[mid]! <= position) low = mid;
        else high = mid - 1;
      }
      return low;
    };
    for (const rule of rules) {
      if (rule.isMultiline) {
        rule.pattern.lastIndex = 0;
        const matches = [...joined.matchAll(rule.pattern)];
        for (const match of rule.isGlobal ? matches : matches.slice(0, 1)) {
          if (match[0].length === 0) continue;
          const start = match.index!;
          const first = lineIndex(start);
          const last = lineIndex(Math.max(start, start + match[0].length - 1));
          for (let index = first; index <= last; index++) {
            if (removed.has(index)) continue;
            removed.add(index);
            report.removedLines += 1;
          }
          report.rules.add(rule.text);
        }
      } else {
        for (const block of blocks) {
          rule.pattern.lastIndex = 0;
          if (rule.pattern.test(block.uri)) {
            removed.add(block.extinfLine);
            removed.add(block.uriLine);
            report.rules.add(rule.text);
          }
        }
        // SCTE-35 ad blocks, like pruneSpliceoutBlock in uBO
        lines.forEach((line, index) => {
          if (!line.startsWith('#EXT-X-CUE:TYPE="SpliceOut"')) return;
          let cursor = index;
          removed.add(cursor);
          cursor += 1;
          while (
            cursor < lines.length &&
            ['#EXT-X-ASSET:CAID', '#EXT-X-SCTE35:', '#EXT-X-CUE-IN'].some((prefix) => lines[cursor]!.startsWith(prefix))
          ) {
            removed.add(cursor);
            cursor += 1;
          }
          report.rules.add(rule.text);
        });
      }
    }

    // 3. Remove and assign stable numbers
    const windowVirtuals: number[] = [];
    for (const block of blocks) {
      let drop = removed.has(block.extinfLine) || removed.has(block.uriLine);
      if (drop && this.leadingOnly && this.lastAssignedReal !== Number.MIN_SAFE_INTEGER) drop = false;
      if (drop) {
        report.removedSequences.add(block.real);
        if (block.real > this.lastAssignedReal) {
          if (!this.pendingGap) report.startedBreak = !this.inBreak;
          this.pendingGap = true;
          this.inBreak = true;
        }
        if (!this.reported.has(block.real)) {
          this.reported.add(block.real);
          report.removedSegments += 1;
          report.removedSeconds += block.duration;
        }
        continue;
      }
      let virtual: number;
      const known = this.virtualForReal.get(block.real);
      if (known !== undefined) {
        virtual = known;
      } else if (block.real > this.lastAssignedReal) {
        virtual = this.nextVirtual ?? block.real;
        this.nextVirtual = virtual + 1;
        this.lastAssignedReal = block.real;
        this.virtualForReal.set(block.real, virtual);
        if (this.pendingGap || block.hadDiscontinuity) this.discontinuities.add(virtual);
        this.pendingGap = false;
        this.inBreak = false;
      } else {
        continue;
      }
      windowVirtuals.push(virtual);
      if (!this.cache.some((entry) => entry.virtual === virtual)) {
        const rendered = block.tagLines
          .filter((index) => !removed.has(index) && segmentTags.some((prefix) => lines[index]!.startsWith(prefix)))
          .map((index) => lines[index]!);
        rendered.push(lines[block.extinfLine]!);
        let uri = block.uri;
        try {
          uri = new URL(block.uri, base).toString();
        } catch {
          // keep as written
        }
        rendered.push(uri);
        this.cache.push({ virtual, lines: rendered, map: block.map });
        this.cache.sort((a, b) => a.virtual - b.virtual);
        if (this.cache.length > 40) this.cache.splice(0, this.cache.length - 40);
      }
    }
    if (this.virtualForReal.size > 2000) {
      const keep = new Set(this.cache.map((entry) => entry.virtual));
      this.virtualForReal = new Map([...this.virtualForReal].filter(([, value]) => keep.has(value)));
      const firstReal = blocks[0]?.real ?? 0;
      this.reported = new Set([...this.reported].filter((real) => real >= firstReal));
    }

    // 4. Output: never empty, never backwards
    let selected = this.cache.filter((entry) => windowVirtuals.includes(entry.virtual));
    if (selected.length < 3) selected = this.cache.slice(-3);
    selected = selected.filter((entry) => entry.virtual >= this.lastFirstVirtual);
    const first = selected[0];
    if (!first) {
      return {
        text: `#EXTM3U\n#EXT-X-VERSION:${version}\n#EXT-X-TARGETDURATION:${headerTarget}\n#EXT-X-MEDIA-SEQUENCE:0\n`,
        report,
        isEmpty: true,
      };
    }
    this.lastFirstVirtual = first.virtual;

    const discontinuitiesBefore = [...this.discontinuities].filter((value) => value < first.virtual).length;
    const output = [
      '#EXTM3U',
      `#EXT-X-VERSION:${version}`,
      `#EXT-X-TARGETDURATION:${headerTarget}`,
      `#EXT-X-MEDIA-SEQUENCE:${first.virtual}`,
      `#EXT-X-DISCONTINUITY-SEQUENCE:${discontinuitiesBefore}`,
      ...keepHeader,
    ];
    let emittedMap: string | null = null;
    for (const block of selected) {
      if (this.discontinuities.has(block.virtual)) output.push('#EXT-X-DISCONTINUITY');
      if (block.map && block.map !== emittedMap) {
        output.push(block.map);
        emittedMap = block.map;
      }
      output.push(...block.lines);
    }
    if (ended) output.push('#EXT-X-ENDLIST');
    return { text: `${output.join('\n')}\n`, report, isEmpty: false };
  }
}
