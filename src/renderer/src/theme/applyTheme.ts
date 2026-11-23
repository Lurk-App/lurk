import {
  accentPresetColors,
  accentPresets,
  resolveColors,
  schemeFor,
  type Appearance,
  type ResolvedColors,
} from '@shared/theme';

const cssNames: Record<keyof ResolvedColors, string> = {
  canvas: '--canvas',
  surface: '--surface',
  raised: '--raised',
  sidebar: '--sidebar',
  hairline: '--hairline',
  fieldFill: '--field-fill',
  quietFill: '--quiet-fill',
  text: '--text',
  textSecondary: '--text-secondary',
  textTertiary: '--text-tertiary',
  accent: '--accent',
  onAccent: '--on-accent',
  live: '--live',
  destructive: '--destructive',
  warning: '--warning',
  online: '--online',
  providerTwitch: '--provider-twitch',
  providerKick: '--provider-kick',
  providerYoutube: '--provider-youtube',
};

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

/**
 * Writes the colours of an appearance onto the document as CSS variables. The main process sets
 * Chromium's theme source from the same setting, so "system" follows the operating system here.
 */
export function applyTheme(appearance: Appearance): void {
  const scheme = schemeFor(appearance.mode, darkQuery.matches);
  const colors = resolveColors(appearance, scheme);
  const root = document.documentElement;
  // The dark versions too: video stages stay dark in light mode (`.dark-scope` in tokens.css).
  const dark = resolveColors(appearance, 'dark');
  for (const [key, name] of Object.entries(cssNames) as [keyof ResolvedColors, string][]) {
    root.style.setProperty(name, colors[key]);
    root.style.setProperty(`--dark${name.slice(1)}`, dark[key]);
  }
  // The presets as the settings swatches show them, in the version for this scheme.
  for (const preset of accentPresets) root.style.setProperty(`--swatch-${preset}`, accentPresetColors[preset][scheme]);
  root.style.colorScheme = scheme;
  root.dataset['scheme'] = scheme;
}

/** Re-applies when the system switches between light and dark (matters for "system"). */
export function onSystemSchemeChange(listener: () => void): () => void {
  darkQuery.addEventListener('change', listener);
  return () => darkQuery.removeEventListener('change', listener);
}
