// Colours of the design system (DESIGN.md): three background tones, each light and dark, seven
// accent presets or a custom accent. Ported from the native macOS app (lurk-macos,
// Sources/Lurk/Views/Appearance.swift and Theme.swift). Pure functions, no DOM: the main process uses
// them for window backgrounds, the interface for its CSS variables, the tests for the contrast check.

export type AppearanceMode = 'system' | 'light' | 'dark';
export type BackgroundTone = 'graphite' | 'neutral' | 'midnight';
export type AccentPreset = 'violet' | 'blue' | 'teal' | 'green' | 'orange' | 'pink' | 'red';
/** A preset id, or a custom colour as "#RRGGBB". */
export type Accent = AccentPreset | `#${string}`;
export type Scheme = 'light' | 'dark';

export const appearanceModes: readonly AppearanceMode[] = ['system', 'light', 'dark'];
export const backgroundTones: readonly BackgroundTone[] = ['graphite', 'neutral', 'midnight'];
export const accentPresets: readonly AccentPreset[] = ['violet', 'blue', 'teal', 'green', 'orange', 'pink', 'red'];

type Pair = { light: string; dark: string };

/** Solid colours of each tone. */
export const tonePalettes: Record<
  BackgroundTone,
  { canvas: Pair; surface: Pair; raised: Pair; textSecondary: Pair; textTertiary: Pair }
> = {
  graphite: {
    canvas: { light: '#F6F5F9', dark: '#121016' },
    surface: { light: '#FFFFFF', dark: '#1B1820' },
    raised: { light: '#FFFFFF', dark: '#24202B' },
    textSecondary: { light: '#524B61', dark: '#ABA4BA' },
    textTertiary: { light: '#746D84', dark: '#8C859B' },
  },
  neutral: {
    canvas: { light: '#F5F5F6', dark: '#111112' },
    surface: { light: '#FFFFFF', dark: '#1A1A1C' },
    raised: { light: '#FFFFFF', dark: '#232326' },
    textSecondary: { light: '#4E4E55', dark: '#A8A8AE' },
    textTertiary: { light: '#707078', dark: '#8A8A91' },
  },
  midnight: {
    canvas: { light: '#F2F5FB', dark: '#0D111B' },
    surface: { light: '#FFFFFF', dark: '#151A27' },
    raised: { light: '#FFFFFF', dark: '#1D2333' },
    textSecondary: { light: '#424B63', dark: '#A3AAC2' },
    textTertiary: { light: '#5F6884', dark: '#858DA5' },
  },
};

/** Translucent roles, the same for every tone: [colour, opacity]. */
export const translucent: Record<
  'hairline' | 'fieldFill' | 'quietFill',
  { light: [string, number]; dark: [string, number] }
> = {
  hairline: { light: ['#000000', 0.09], dark: ['#FFFFFF', 0.08] },
  fieldFill: { light: ['#000000', 0.05], dark: ['#FFFFFF', 0.06] },
  quietFill: { light: ['#000000', 0.1], dark: ['#FFFFFF', 0.14] },
};

/** Each preset in the version for dark surfaces and the stronger one for light surfaces. */
export const accentPresetColors: Record<AccentPreset, Pair> = {
  violet: { dark: '#9B6BFF', light: '#7A45F0' },
  blue: { dark: '#4A86F0', light: '#1F6BEB' },
  teal: { dark: '#1C9A9C', light: '#0E8487' },
  green: { dark: '#2E9A54', light: '#1E8A41' },
  orange: { dark: '#D6731C', light: '#C2620A' },
  pink: { dark: '#E04C8C', light: '#C92F73' },
  red: { dark: '#E5484D', light: '#D12F35' },
};

/** Primary text: what the macOS app's `Color.primary` resolves to. */
export const text: Pair = { light: '#000000', dark: '#FFFFFF' };
/** Live status only (LIVE badge, recording, the viewer dot). */
export const live = '#FF3B5C';
/** Destructive actions (reset, delete) – never live red. Readable as 13 px text on canvas and surface. */
export const destructive: Pair = { light: '#C8282E', dark: '#FF6B6B' };
/** Warnings in a page ("Live-Status konnte nicht geladen werden"; the macOS app's orange). Readable as
 * 13 px text on canvas and surface. */
export const warning: Pair = { light: '#A84B00', dark: '#FF9F0A' };
/** The "connected" dot of the chat (a status mark, ≥ 3 : 1 on surface). */
export const online: Pair = { light: '#1E8E3E', dark: '#30D158' };
/** Chat names without a colour of their own get one of these, chosen by login (macOS ChatColor). */
export const chatNamePalette: readonly string[] = [
  '#FF4A80',
  '#FF7070',
  '#FA8E4B',
  '#FEE440',
  '#5FFF77',
  '#00F5D4',
  '#00BBF9',
  '#4371FB',
  '#9B5DE5',
  '#F670DD',
];
/** Text and symbols on the accent (button labels, the swatch check). */
export const onAccent = '#FFFFFF';
/** Provider colours appear only as the small dot in a provider mark. */
export const providerColors: Record<'twitch' | 'kick' | 'youtube', Pair> = {
  twitch: { light: '#9146FF', dark: '#9146FF' },
  // Kick's neon green disappears on light surfaces – a darker version there (≥ 3 : 1).
  kick: { light: '#2E8B10', dark: '#53FC18' },
  youtube: { light: '#FF0033', dark: '#FF0033' },
};

export interface Appearance {
  mode: AppearanceMode;
  tone: BackgroundTone;
  accent: Accent;
}

export const defaultAppearance: Appearance = { mode: 'dark', tone: 'graphite', accent: 'violet' };

// MARK: Colour arithmetic (sRGB, as AppKit does it)

type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b]
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase()}`;
}

/** Like NSColor.blended(withFraction:of:): `fraction` of `other` mixed into `base`. */
export function blend(base: string, other: string, fraction: number): string {
  const a = parseHex(base);
  const b = parseHex(other);
  if (!a || !b) return base;
  return toHex([0, 1, 2].map((i) => a[i]! * (1 - fraction) + b[i]! * fraction) as Rgb);
}

/** A translucent colour painted over an opaque one. */
export function composite(color: [string, number], over: string): string {
  return blend(over, color[0], color[1]);
}

export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

export function contrastRatio(a: string, b: string): number {
  const x = relativeLuminance(a);
  const y = relativeLuminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export function isAccentPreset(value: unknown): value is AccentPreset {
  return typeof value === 'string' && (accentPresets as readonly string[]).includes(value);
}

export function isCustomAccent(value: unknown): value is `#${string}` {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

/**
 * The accent in its two versions. A custom colour that is too light is darkened until white
 * button text on it stays readable (≥ 3 : 1); on light surfaces it is 18 % darker still.
 */
export function resolveAccent(accent: Accent): Pair {
  if (isAccentPreset(accent)) return accentPresetColors[accent];
  let base = isCustomAccent(accent) ? accent.toUpperCase() : accentPresetColors.violet.dark;
  for (let step = 0; step < 12 && contrastRatio('#FFFFFF', base) < 3; step += 1) {
    base = blend(base, '#000000', 0.12);
  }
  return { dark: base, light: blend(base, '#000000', 0.18) };
}

/** Every colour role for one tone, scheme and accent – what the interface turns into CSS variables. */
export interface ResolvedColors {
  canvas: string;
  surface: string;
  raised: string;
  /**
   * The sidebar: the canvas itself, set off by a hairline. A tint (as the macOS sidebar material
   * reads) would push secondary and tertiary text below DESIGN.md's contrast rules (decided 2026-11-23).
   */
  sidebar: string;
  hairline: string;
  fieldFill: string;
  quietFill: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  accent: string;
  onAccent: string;
  live: string;
  destructive: string;
  warning: string;
  online: string;
  providerTwitch: string;
  providerKick: string;
  providerYoutube: string;
}

function rgba([hex, alpha]: [string, number]): string {
  const rgb = parseHex(hex) ?? [0, 0, 0];
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

export function resolveColors(appearance: Pick<Appearance, 'tone' | 'accent'>, scheme: Scheme): ResolvedColors {
  const palette = tonePalettes[appearance.tone];
  const canvas = palette.canvas[scheme];
  return {
    canvas,
    surface: palette.surface[scheme],
    raised: palette.raised[scheme],
    sidebar: canvas,
    hairline: rgba(translucent.hairline[scheme]),
    fieldFill: rgba(translucent.fieldFill[scheme]),
    quietFill: rgba(translucent.quietFill[scheme]),
    text: text[scheme],
    textSecondary: palette.textSecondary[scheme],
    textTertiary: palette.textTertiary[scheme],
    accent: resolveAccent(appearance.accent)[scheme],
    onAccent,
    live,
    destructive: destructive[scheme],
    warning: warning[scheme],
    online: online[scheme],
    providerTwitch: providerColors.twitch[scheme],
    providerKick: providerColors.kick[scheme],
    providerYoutube: providerColors.youtube[scheme],
  };
}

/** Which scheme a mode shows, given whether the system is dark right now. */
export function schemeFor(mode: AppearanceMode, systemIsDark: boolean): Scheme {
  if (mode === 'system') return systemIsDark ? 'dark' : 'light';
  return mode;
}
