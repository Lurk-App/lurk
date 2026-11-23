import { useEffect, useState } from 'react';
import type { Settings } from '@shared/settings';

/** The current settings, updated when any window changes them. Null until the first answer. */
export function useSettings(): Settings | null {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    let active = true;
    void window.lurk.settings.get().then((value) => active && setSettings(value));
    const stop = window.lurk.settings.onChange(setSettings);
    return () => {
      active = false;
      stop();
    };
  }, []);
  return settings;
}
