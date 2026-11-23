// Lurk's ad blocker, modelled on uBlock Origin (gorhill/uBlock). Port of FilterEngine and
// BuiltInFilters of the macOS app (lurk-macos, Sources/Lurk/Blocker/FilterEngine.swift).
//
// Taken over from uBO:
// - Static network filters in uBO syntax: ||host^, |start, end|, *, ^, /regex/, exceptions with
//   @@ and the options $important, the types ($image, $media, $xhr, $websocket, $other, $ping …)
//   with negation (~type).
// - The decision order of StaticNetFilteringEngine.matchRequest: block rules → exceptions →
//   $important.
// - The scriptlet m3u-prune (##+js(m3u-prune, pattern, url-pattern)), applied by HlsPruner.
// Not transferable, because Lurk loads no web pages: cosmetic filters (##), other scriptlets,
// $redirect, $removeparam, $csp and so on – they are counted and skipped.

import type { PruneRule } from './hlsPruner';

export type RequestType = 'xhr' | 'media' | 'image' | 'websocket' | 'ping' | 'other';

/** uBO's request types for Lurk's requests, from the address alone. */
export function classifyRequest(url: string): RequestType {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'other';
  }
  const scheme = parsed.protocol.replace(':', '').toLowerCase();
  if (scheme === 'ws' || scheme === 'wss') return 'websocket';
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  if (['.ts', '.mp4', '.aac'].some((end) => path.endsWith(end)) || path.includes('/v1/segment/')) return 'media';
  if (host === 'static-cdn.jtvnw.net' || ['.png', '.jpg', '.jpeg', '.gif', '.webp'].some((end) => path.endsWith(end)))
    return 'image';
  if (path.endsWith('.m3u8') || host === 'gql.twitch.tv') return 'xhr';
  return 'other';
}

export interface NetworkRule {
  text: string;
  isException: boolean;
  isImportant: boolean;
  types: Set<RequestType> | null;
  excludedTypes: Set<RequestType>;
  /** Fast path for plain host rules (||host^). */
  hostname: string | null;
  regex: RegExp | null;
}

/** An m3u-prune rule with the playlist addresses it applies to. */
export interface FilterPruneRule extends PruneRule {
  urlPattern: RegExp;
}

/** Why a line was not taken; the settings tab says it in words. */
export type FilterIssueReason =
  | { kind: 'scriptlet'; name: string }
  | { kind: 'regex' }
  | { kind: 'type'; name: string }
  | { kind: 'option'; name: string }
  | { kind: 'pattern' }
  | { kind: 'tooLong' };

export interface FilterIssue {
  line: number;
  text: string;
  reason: FilterIssueReason;
}

/** As in uBO: no rule, block, or allow (an exception). */
export type FilterDecision = { kind: 'none' } | { kind: 'block'; rule: string } | { kind: 'allow'; rule: string };

/** A longer line is not a filter anyone wrote by hand; it is reported and skipped. */
export const maxFilterLineLength = 2000;

const typeOption: Record<string, RequestType> = {
  media: 'media',
  image: 'image',
  xhr: 'xhr',
  xmlhttprequest: 'xhr',
  websocket: 'websocket',
  ping: 'ping',
  beacon: 'ping',
  other: 'other',
};

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

function hostMatches(host: string, hostname: string): boolean {
  return host === hostname || host.endsWith(`.${hostname}`);
}

function ruleMatches(rule: NetworkRule, url: string, host: string, type: RequestType): boolean {
  if (rule.types && !rule.types.has(type)) return false;
  if (rule.excludedTypes.has(type)) return false;
  if (rule.hostname !== null) return hostMatches(host, rule.hostname);
  return rule.regex?.test(url) ?? false;
}

export class FilterEngine {
  readonly networkRules: NetworkRule[] = [];
  readonly pruneRules: FilterPruneRule[] = [];
  readonly issues: FilterIssue[] = [];
  ignoredCosmetic = 0;
  ignoredOtherSites = 0;

  get ruleCount(): number {
    return this.networkRules.length + this.pruneRules.length;
  }

  /** Reads filter lists in uBO syntax; line numbers count per list. */
  constructor(lists: string[]) {
    for (const list of lists) {
      list.split('\n').forEach((raw, index) => this.parseLine(raw.trim(), index + 1));
    }
  }

  private parseLine(line: string, number: number): void {
    if (!line || line.startsWith('!') || line.startsWith('[')) return;
    if (line.length > maxFilterLineLength) {
      this.issues.push({ line: number, text: line, reason: { kind: 'tooLong' } });
      return;
    }
    // Extended filters: domain##… / domain#@#… / domain#?#… (in this order, as the reference).
    const marker = ['#@#', '#?#', '##'].find((candidate) => line.includes(candidate));
    if (marker) {
      const at = line.indexOf(marker);
      const domains = line.slice(0, at);
      const body = line.slice(at + marker.length);
      if (marker !== '##' || !body.startsWith('+js(') || !body.endsWith(')')) {
        this.ignoredCosmetic += 1;
        return;
      }
      if (!appliesToTwitch(domains)) {
        this.ignoredOtherSites += 1;
        return;
      }
      this.parseScriptlet(body.slice(4, -1), line, number);
      return;
    }
    this.parseNetworkRule(line, number);
  }

  // MARK: Scriptlets

  private parseScriptlet(body: string, line: string, number: number): void {
    const args = splitArguments(body);
    const name = args[0] ?? '';
    if (name !== 'm3u-prune' && name !== 'm3u-prune.js') {
      this.issues.push({ line: number, text: line, reason: { kind: 'scriptlet', name } });
      return;
    }
    const pattern = regexFromArgument(args[1] ?? '');
    const url = regexFromArgument(args[2] ?? '');
    if (!pattern || !url) {
      this.issues.push({ line: number, text: line, reason: { kind: 'regex' } });
      return;
    }
    // The rule's text is the whole line, as the log shows it.
    this.pruneRules.push({ ...pattern, text: line, urlPattern: url.pattern });
  }

  // MARK: Network filters

  private parseNetworkRule(line: string, number: number): void {
    let pattern = line;
    const isException = pattern.startsWith('@@');
    if (isException) pattern = pattern.slice(2);

    let optionText = '';
    const lastSlash = pattern.lastIndexOf('/');
    if (pattern.startsWith('/') && lastSlash > 0) {
      const tail = pattern.slice(lastSlash + 1);
      if (tail.startsWith('$')) optionText = tail.slice(1);
      pattern = pattern.slice(0, lastSlash + 1);
    } else {
      const dollar = pattern.lastIndexOf('$');
      if (dollar >= 0) {
        optionText = pattern.slice(dollar + 1);
        pattern = pattern.slice(0, dollar);
      }
    }

    let important = false;
    const types = new Set<RequestType>();
    const excluded = new Set<RequestType>();
    for (const option of optionText.split(',').map((entry) => entry.trim().toLowerCase())) {
      if (!option) continue;
      const negated = option.startsWith('~');
      const name = negated ? option.slice(1) : option;
      const type = typeOption[name];
      if (type) {
        (negated ? excluded : types).add(type);
        continue;
      }
      if (name === 'important') important = true;
      else if (['all', '1p', '3p', 'first-party', 'third-party', 'match-case'].includes(name)) continue;
      else if (
        ['script', 'css', 'stylesheet', 'font', 'subdocument', 'frame', 'object', 'popup', 'document', 'doc'].includes(
          name,
        )
      ) {
        // These types never occur in Lurk – the rule could never apply.
        if (!negated) {
          this.issues.push({ line: number, text: line, reason: { kind: 'type', name } });
          return;
        }
      } else if (!name.startsWith('domain=') && !name.startsWith('from=')) {
        this.issues.push({ line: number, text: line, reason: { kind: 'option', name } });
        return;
      }
    }

    const base = {
      text: line,
      isException,
      isImportant: important,
      types: types.size ? types : null,
      excludedTypes: excluded,
    };
    // A plain host filter: ||example.com^
    if (pattern.startsWith('||') && pattern.endsWith('^')) {
      const host = pattern.slice(2, -1).toLowerCase();
      if (host && /^[\p{L}\p{N}.-]+$/u.test(host)) {
        this.networkRules.push({ ...base, hostname: host, regex: null });
        return;
      }
    }
    const regex = compileNetworkPattern(pattern);
    if (!regex) {
      this.issues.push({ line: number, text: line, reason: { kind: 'pattern' } });
      return;
    }
    this.networkRules.push({ ...base, hostname: null, regex });
  }

  // MARK: Deciding

  /** The order of uBO's matchRequest: block → exception → $important. */
  decide(url: string, type?: RequestType): FilterDecision {
    let host = '';
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return { kind: 'none' };
    }
    const kind = type ?? classifyRequest(url);
    const block = this.networkRules.find((rule) => !rule.isException && ruleMatches(rule, url, host, kind));
    if (!block) return { kind: 'none' };
    if (block.isImportant) return { kind: 'block', rule: block.text };
    const allow = this.networkRules.find((rule) => rule.isException && ruleMatches(rule, url, host, kind));
    if (!allow) return { kind: 'block', rule: block.text };
    const important = this.networkRules.find(
      (rule) => !rule.isException && rule.isImportant && ruleMatches(rule, url, host, kind),
    );
    return important ? { kind: 'block', rule: important.text } : { kind: 'allow', rule: allow.text };
  }

  /** The m3u-prune rules that apply to this playlist address. */
  pruneRulesFor(url: string): FilterPruneRule[] {
    return this.pruneRules.filter((rule) => {
      rule.urlPattern.lastIndex = 0;
      return rule.urlPattern.test(url);
    });
  }
}

function appliesToTwitch(domains: string): boolean {
  const list = domains
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0 || (list.length === 1 && list[0] === '*')) return true;
  return list.some(
    (domain) =>
      !domain.startsWith('~') && ['twitch.tv', 'ttvnw.net', 'jtvnw.net'].some((own) => hostMatches(domain, own)),
  );
}

/** Arguments as in uBO: separated by commas, `\,` stands for a comma. */
export function splitArguments(body: string): string[] {
  const result: string[] = [];
  let current = '';
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]!;
    if (char === '\\' && index + 1 < body.length) {
      const next = body[index + 1]!;
      current += next === ',' ? ',' : char + next;
      index += 1;
    } else if (char === ',') {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * As `regexFromArg` in uBO's m3u-prune: `/…/flags` is a regular expression (JavaScript's own, as
 * uBO runs it), anything else literal text with `*` as a wildcard. Empty matches everything.
 */
export function regexFromArgument(
  argument: string,
): { text: string; pattern: RegExp; isMultiline: boolean; isGlobal: boolean } | null {
  if (!argument) return { text: argument, pattern: /^/g, isMultiline: false, isGlobal: false };
  const match = /^\/(.+)\/([gmsi]*)$/s.exec(argument);
  if (match) {
    const flags = match[2]!;
    try {
      return {
        text: argument,
        // Always global inside; `isGlobal` decides how many matches are used (see HlsPruner).
        pattern: new RegExp(match[1]!, flags.includes('g') ? flags : `${flags}g`),
        isMultiline: flags.includes('m'),
        isGlobal: flags.includes('g'),
      };
    } catch {
      return null;
    }
  }
  const literal = escapeRegex(argument).replaceAll('\\*', '.*?');
  return { text: argument, pattern: new RegExp(literal, 'g'), isMultiline: false, isGlobal: false };
}

/** Translates a uBO network pattern into a regular expression. */
export function compileNetworkPattern(pattern: string): RegExp | null {
  if (pattern.length > 2 && pattern.startsWith('/') && pattern.endsWith('/')) {
    try {
      return new RegExp(pattern.slice(1, -1), 'i');
    } catch {
      return null;
    }
  }
  let body = pattern;
  let prefix = '';
  let suffix = '';
  if (body.startsWith('||')) {
    body = body.slice(2);
    prefix = '^[a-z][a-z0-9+.-]*://(?:[^/?#]*\\.)?';
  } else if (body.startsWith('|')) {
    body = body.slice(1);
    prefix = '^';
  }
  if (body.endsWith('|')) {
    body = body.slice(0, -1);
    suffix = '$';
  }
  if (!body && !prefix) return null;
  let source = '';
  for (const char of body) {
    if (char === '*') source += '.*';
    else if (char === '^') source += '(?:[^\\w.%-]|$)';
    else source += escapeRegex(char);
  }
  try {
    return new RegExp(prefix + source + suffix, 'i');
  } catch {
    return null;
  }
}

/**
 * Lurk's built-in list (the macOS app's `BuiltInFilters.lurkDefault`). The ad-segment rule requires
 * a title: video (VOD) segments have none and must stay (see HlsPruner).
 */
export const builtInFilterList = `! Titel: Lurk-Standardfilter
! Beschreibung: Entfernt Twitch-Werbung aus HLS-Playlists und sperrt Werbe- und Tracking-Adressen.
! Syntax: uBlock Origin (Netzwerkfilter und ##+js(m3u-prune, …))
!
! Werbesegmente: Twitch fügt Werbung serverseitig in den Stream ein. Werbesegmente tragen
! einen anderen Titel als „live“ (z. B. „Amazon|…“). Die Regel entfernt jeden #EXTINF-Block,
! dessen Titel nicht mit „live“ beginnt – samt Segmentadresse.
twitch.tv##+js(m3u-prune, /^#EXTINF:[\\d.]+\\,(?!live)[^\\n]+\\n[^\\n#][^\\n]*/gm, .m3u8)
!
! Werbe-Markierungen in derselben Playlist
twitch.tv##+js(m3u-prune, /^#EXT-X-DATERANGE:[^\\n]*(?:twitch-stitched-ad|twitch-ad-quartile|stitched-ad-)[^\\n]*/gm, .m3u8)
!
! Werbe- und Tracking-Dienste. Lurk ruft sie nicht auf – die Regeln sind ein
! Sicherheitsnetz, falls sie in Playlists oder Antworten auftauchen.
||spade.twitch.tv^
||countess.twitch.tv^
||trowel.twitch.tv^
||amazon-adsystem.com^
||doubleclick.net^
||imasdk.googleapis.com^
||scorecardresearch.com^
||branch.io^`;
