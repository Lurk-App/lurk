// The ad blocker in the main process: the filters (the built-in list and the own filters in
// eigene-filter.txt), the network filter on the app's session, the log and the totals
// (werbeblocker.json). Port of ContentBlocker, BlockingURLProtocol, BlockerLog and UserFilters of
// the macOS app (lurk-macos, Sources/Lurk/Blocker/ContentBlocker.swift).
//
// The switch lives in settings.json (`blocker.enabled`): while it is off, nothing is blocked. The
// playlist filter runs in the player with the same lists (engine.ts); the player reports here
// what it removed and skipped.

import { app, type OnBeforeRequestListenerDetails, type Session } from 'electron';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  emptyTotals,
  filterReport,
  maxLogEntries,
  maxUserFiltersLength,
  normalizeTotals,
  type BlockerEntry,
  type BlockerEntryDetail,
  type BlockerEvent,
  type BlockerState,
  type BlockerTotals,
  type FilterReport,
} from '@shared/blocker';
import { builtInFilterList, classifyRequest, FilterEngine, type RequestType } from '@shared/filterEngine';
import { writeFileAtomic } from './files';
import { isAppUrl } from './security';
import { settingsStore } from './settingsStore';

type Listener = (state: BlockerState) => void;

const saveDelayMs = 2000;

/** Electron's resource types in uBO's terms; anything else is judged by its address. */
const resourceTypes: Partial<Record<string, RequestType>> = {
  xhr: 'xhr',
  media: 'media',
  image: 'image',
  webSocket: 'websocket',
  ping: 'ping',
};

function readText(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

class Blocker {
  private readonly builtIn = new FilterEngine([builtInFilterList]);
  private engine = this.builtIn;
  private userText = '';
  private userReport: FilterReport = filterReport(new FilterEngine([]));
  private totals: BlockerTotals = { ...emptyTotals };
  private entries: BlockerEntry[] = [];
  private nextId = 1;
  private loaded = false;
  private listeners = new Set<Listener>();
  private timer: NodeJS.Timeout | undefined;
  private writing: Promise<void> = Promise.resolve();
  /** A break the player began to skip and has not finished yet. */
  private openBreaks = 0;

  private file(name: string): string {
    return path.join(app.getPath('userData'), name);
  }

  /** Reads the own filters and the totals (once, at the first use). */
  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    const text = readText(this.file('eigene-filter.txt'));
    if (text !== null && text.length <= maxUserFiltersLength) this.useFilters(text);
    const stored = readText(this.file('werbeblocker.json'));
    if (stored !== null) {
      try {
        this.totals = normalizeTotals(JSON.parse(stored));
      } catch {
        // Broken: the totals start at zero.
      }
    }
  }

  get enabled(): boolean {
    return settingsStore.get().blocker.enabled;
  }

  state(): BlockerState {
    this.load();
    return {
      totals: { ...this.totals },
      entries: this.entries,
      builtIn: { text: builtInFilterList, ruleCount: this.builtIn.ruleCount },
      user: { text: this.userText, report: this.userReport },
    };
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * The network filter on the app's session: a blocked request fails before it reaches the
   * network. Requests of the app itself (lurk://, the development server) are never judged.
   */
  install(target: Session): void {
    target.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      (details, callback) => callback(this.judge(details) ? { cancel: true } : {}),
    );
  }

  /** True when the request is blocked (and then logged). */
  private judge(details: OnBeforeRequestListenerDetails): boolean {
    if (!this.enabled || isAppUrl(details.url)) return false;
    this.load();
    const type = resourceTypes[details.resourceType] ?? classifyRequest(details.url);
    const decision = this.engine.decide(details.url, type);
    if (decision.kind !== 'block') return false;
    let address = details.url;
    try {
      const url = new URL(details.url);
      // Host and path only: queries can be long and carry identifiers.
      address = `${url.host}${url.pathname}`;
    } catch {
      // Logged as it came.
    }
    this.totals.blockedRequests += 1;
    this.append({ kind: 'request', type, address }, decision.rule);
    return true;
  }

  /** "Übernehmen": saves the own filters and uses them at once. */
  async saveFilters(value: unknown): Promise<FilterReport> {
    this.load();
    if (typeof value !== 'string' || value.length > maxUserFiltersLength) throw new Error('Filters too long');
    const text = value.replaceAll('\r\n', '\n');
    await writeFileAtomic(this.file('eigene-filter.txt'), text);
    this.useFilters(text);
    this.changed(false);
    return this.userReport;
  }

  /** "Statistik und Protokoll zurücksetzen": the own filters stay. */
  reset(): void {
    this.load();
    this.totals = { ...emptyTotals };
    this.entries = [];
    this.changed(true);
  }

  /** What the player removed or skipped (already checked by parseBlockerEvent). */
  record(event: BlockerEvent): void {
    this.load();
    switch (event.kind) {
      case 'prune':
        this.totals.adSegments += event.segments;
        this.append(
          { kind: 'prune', channel: event.channel, segments: event.segments, seconds: event.seconds },
          event.rule,
        );
        break;
      case 'skipStart':
        // Breaks count when they begin, their time when they end (as on macOS).
        this.openBreaks += 1;
        this.totals.adBreaks += 1;
        this.changed(true);
        break;
      case 'switch':
        // A break that never showed: the same stream ran on from the second source.
        this.totals.adBreaks += 1;
        this.append({ kind: 'switch', channel: event.channel }, null);
        break;
      case 'skipEnd':
        if (this.openBreaks === 0) return;
        this.openBreaks -= 1;
        this.totals.adSeconds += event.seconds;
        this.append({ kind: 'skip', channel: event.channel, seconds: event.seconds }, null);
        break;
    }
  }

  /** Writes pending totals at once (the app is quitting). */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.save();
    }
    await this.writing;
  }

  private useFilters(text: string): void {
    this.userText = text;
    this.userReport = filterReport(new FilterEngine([text]));
    this.engine = text.trim() ? new FilterEngine([builtInFilterList, text]) : this.builtIn;
  }

  private append(detail: BlockerEntryDetail, rule: string | null): void {
    this.entries = [{ id: this.nextId++, at: new Date().toISOString(), detail, rule }, ...this.entries].slice(
      0,
      maxLogEntries,
    );
    this.changed(true);
  }

  private changed(totalsChanged: boolean): void {
    const state = this.state();
    for (const listener of this.listeners) listener(state);
    if (!totalsChanged) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.save();
    }, saveDelayMs);
  }

  private save(): void {
    const json = `${JSON.stringify(this.totals, null, 2)}\n`;
    const file = this.file('werbeblocker.json');
    this.writing = this.writing
      .then(() => writeFileAtomic(file, json))
      .catch((error: unknown) => console.error('Could not save the ad blocker totals', error));
  }
}

export const blocker = new Blocker();
