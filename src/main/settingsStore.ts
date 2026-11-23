import { app } from 'electron';
import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyPatch, normalizeSettings, type Settings } from '@shared/settings';

type Listener = (settings: Settings) => void;

/** settings.json in the data folder: read once at start, written atomically on every change. */
class SettingsStore {
  private current: Settings | null = null;
  private listeners = new Set<Listener>();
  private writing: Promise<void> = Promise.resolve();

  private get file(): string {
    return path.join(app.getPath('userData'), 'settings.json');
  }

  get(): Settings {
    if (!this.current) {
      let raw: unknown = {};
      try {
        raw = JSON.parse(readFileSync(this.file, 'utf8'));
      } catch {
        // Missing or broken: start from the defaults.
      }
      this.current = normalizeSettings(raw);
    }
    return this.current;
  }

  update(patch: unknown): Settings {
    this.current = applyPatch(this.get(), patch);
    this.save(this.current);
    for (const listener of this.listeners) listener(this.current);
    return this.current;
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** One write at a time; a temporary file and a rename, so a crash never leaves half a file. */
  private save(settings: Settings): void {
    const file = this.file;
    const json = `${JSON.stringify(settings, null, 2)}\n`;
    this.writing = this.writing
      .then(async () => {
        const temporary = `${file}.tmp`;
        await writeFile(temporary, json, 'utf8');
        await rename(temporary, file);
      })
      .catch((error: unknown) => console.error('Could not save settings', error));
  }
}

export const settingsStore = new SettingsStore();
