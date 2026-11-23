/// <reference types="vite/client" />
import type { LurkApi } from '@shared/ipc';

declare global {
  interface Window {
    /** The bridge from src/preload – the only way the interface reaches the main process. */
    readonly lurk: LurkApi;
  }
}
