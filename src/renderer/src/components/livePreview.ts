// The muted live preview of a stream tile. One plays at a time; it starts after the pointer has
// rested on a tile for 0.65 s and shows once frames arrive. Port of the macOS app's LivePreviewer
// (lurk-macos, Sources/Lurk/Views/LivePreview.swift) on the player's own engine.

import { useSyncExternalStore } from 'react';
import { PlayerEngine } from '../player/engine';

/** Rest time before the preview loads – passing over a tile costs nothing. */
const delayMs = 650;

export interface PreviewState {
  login: string | null;
  /** The video element, once a session is loading. */
  video: HTMLVideoElement | null;
  /** Frames arrived: the preview replaces the still image. */
  showing: boolean;
}

class LivePreviewer {
  private state: PreviewState = { login: null, video: null, showing: false };
  private readonly listeners = new Set<() => void>();
  private timer: number | undefined;
  private engine: PlayerEngine | null = null;
  /** The setting and the system's reduced motion; the main window keeps it current. */
  private enabled = false;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): PreviewState => this.state;

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.stop();
  }

  start(login: string): void {
    if (!this.enabled || this.state.login === login) return;
    this.stop();
    this.update({ login });
    this.timer = window.setTimeout(() => this.load(login), delayMs);
  }

  /** Without a login: whatever plays (a page change, the setting turned off). */
  stop(login?: string): void {
    if (login !== undefined && login !== this.state.login) return;
    window.clearTimeout(this.timer);
    this.engine?.destroy();
    this.engine = null;
    if (this.state.login !== null) this.update({ login: null, video: null, showing: false });
  }

  private update(next: Partial<PreviewState>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }

  private load(login: string) {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.className = 'live-preview-video';
    video.setAttribute('aria-hidden', 'true');
    const engine: PlayerEngine = new PlayerEngine(
      video,
      {
        onPreroll: () => {},
        onLevels: () => {},
        onLevel: () => {},
        // Shown once this channel's video plays; it then stays through short stalls.
        onPlaying: () => {
          if (this.engine === engine) this.update({ showing: true });
        },
        onFatal: () => {
          if (this.engine === engine) {
            engine.destroy();
            this.engine = null;
            this.update({ video: null, showing: false });
          }
        },
      },
      { preview: true },
    );
    this.engine = engine;
    this.update({ video });
    engine.start({ kind: 'live', login }).catch(() => {
      // Offline or refused: the still image simply stays.
    });
  }
}

export const livePreviewer = new LivePreviewer();

/** The preview's state when it belongs to this channel, else null. */
export function usePreview(login: string): PreviewState | null {
  const state = useSyncExternalStore(livePreviewer.subscribe, livePreviewer.snapshot);
  return state.login === login ? state : null;
}
