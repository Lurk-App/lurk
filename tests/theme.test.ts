// The macOS self-test "Darstellung: Kontraste hell und dunkel", as an offline test: every tone in
// light and dark keeps secondary text ≥ 7 : 1 and tertiary text ≥ 4.5 : 1 on the canvas, and every
// accent preset stays ≥ 3 : 1 against the canvas and against white button text.

import { describe, expect, it } from 'vitest';
import {
  accentPresetColors,
  accentPresets,
  backgroundTones,
  blend,
  composite,
  contrastRatio,
  relativeLuminance,
  resolveAccent,
  resolveColors,
  schemeFor,
  tonePalettes,
  translucent,
  type Scheme,
} from '@shared/theme';

const schemes: Scheme[] = ['light', 'dark'];

describe('contrast of every tone, light and dark', () => {
  for (const tone of backgroundTones) {
    for (const scheme of schemes) {
      it(`${tone} ${scheme}`, () => {
        const palette = tonePalettes[tone];
        const canvas = palette.canvas[scheme];
        expect(contrastRatio(palette.textSecondary[scheme], canvas)).toBeGreaterThanOrEqual(7);
        expect(contrastRatio(palette.textTertiary[scheme], canvas)).toBeGreaterThanOrEqual(4.5);
        for (const preset of accentPresets) {
          const accent = accentPresetColors[preset][scheme];
          expect(contrastRatio(accent, canvas), `${preset} on canvas`).toBeGreaterThanOrEqual(3);
          expect(contrastRatio('#FFFFFF', accent), `white on ${preset}`).toBeGreaterThanOrEqual(3);
        }
      });
    }
  }
});

describe('colour arithmetic', () => {
  it('computes luminance and contrast like WCAG', () => {
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBe(0);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
  });

  it('blends like AppKit and composites translucent fills', () => {
    expect(blend('#FFFFFF', '#000000', 0.5)).toBe('#808080');
    expect(composite(['#FFFFFF', 0.06], '#121016')).toBe('#201E24');
  });
});

describe('accent', () => {
  it('keeps presets as they are', () => {
    expect(resolveAccent('violet')).toEqual({ dark: '#9B6BFF', light: '#7A45F0' });
  });

  it('darkens a too light custom colour until white text has 3 : 1', () => {
    const { dark, light } = resolveAccent('#FFE066');
    expect(contrastRatio('#FFFFFF', dark)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio('#FFFFFF', light)).toBeGreaterThan(contrastRatio('#FFFFFF', dark));
  });

  it('keeps a dark enough custom colour and falls back to violet for garbage', () => {
    expect(resolveAccent('#1F6BEB').dark).toBe('#1F6BEB');
    expect(resolveAccent('#nonsense' as `#${string}`).dark).toBe('#9B6BFF');
  });
});

describe('resolved colours', () => {
  it('gives the sidebar the canvas colour and the translucent roles their opacity', () => {
    const dark = resolveColors({ tone: 'graphite', accent: 'violet' }, 'dark');
    const light = resolveColors({ tone: 'graphite', accent: 'violet' }, 'light');
    expect(dark.sidebar).toBe(dark.canvas);
    expect(light.sidebar).toBe(light.canvas);
    expect(dark.hairline).toBe('rgba(255, 255, 255, 0.08)');
    expect(light.fieldFill).toBe('rgba(0, 0, 0, 0.05)');
    expect(translucent.quietFill.dark[1]).toBe(0.14);
  });

  it('keeps the contrast rules on the sidebar too', () => {
    for (const tone of backgroundTones) {
      for (const scheme of schemes) {
        const colors = resolveColors({ tone, accent: 'violet' }, scheme);
        expect(contrastRatio(colors.textSecondary, colors.sidebar), `${tone} ${scheme}`).toBeGreaterThanOrEqual(7);
        expect(contrastRatio(colors.textTertiary, colors.sidebar), `${tone} ${scheme}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps destructive text readable on canvas and surface', () => {
    for (const tone of backgroundTones) {
      for (const scheme of schemes) {
        const colors = resolveColors({ tone, accent: 'violet' }, scheme);
        expect(contrastRatio(colors.destructive, colors.canvas), `${tone} ${scheme}`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(colors.destructive, colors.surface), `${tone} ${scheme}`).toBeGreaterThanOrEqual(4.5);
        // On the shared button: the field fill over surface and canvas.
        for (const ground of [colors.surface, colors.canvas]) {
          const button = composite(translucent.fieldFill[scheme], ground);
          expect(contrastRatio(colors.destructive, button), `${tone} ${scheme} button`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('keeps warning text readable on canvas and surface', () => {
    for (const tone of backgroundTones) {
      for (const scheme of schemes) {
        const colors = resolveColors({ tone, accent: 'violet' }, scheme);
        expect(contrastRatio(colors.warning, colors.canvas), `${tone} ${scheme}`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(colors.warning, colors.surface), `${tone} ${scheme}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps the connected dot visible on the chat panel', () => {
    for (const scheme of schemes) {
      const colors = resolveColors({ tone: 'graphite', accent: 'violet' }, scheme);
      expect(contrastRatio(colors.online, colors.surface), scheme).toBeGreaterThanOrEqual(3);
    }
  });

  it('follows the system only in "system" mode', () => {
    expect(schemeFor('system', true)).toBe('dark');
    expect(schemeFor('system', false)).toBe('light');
    expect(schemeFor('light', true)).toBe('light');
    expect(schemeFor('dark', false)).toBe('dark');
  });
});
