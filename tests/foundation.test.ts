import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { languages, pickLanguage } from '@shared/language';
import { resolveInside } from '../src/main/files';

describe('lurk:// serves only files inside the interface folder', () => {
  const root = path.resolve('/app/out/renderer');

  it('maps normal paths and "/" to index.html', () => {
    expect(resolveInside(root, '/')).toBe(path.join(root, 'index.html'));
    expect(resolveInside(root, '/assets/index.js')).toBe(path.join(root, 'assets', 'index.js'));
    expect(resolveInside(root, '/assets/a%20b.css')).toBe(path.join(root, 'assets', 'a b.css'));
  });

  it('refuses everything that would leave the folder', () => {
    for (const attempt of [
      '/../main/index.js',
      '/assets/../../main/index.js',
      '/%2e%2e/main/index.js',
      '/..%2fmain%2findex.js',
      '/..%5cmain%5cindex.js',
      '/%00',
      '/%E0%A4%A',
    ]) {
      expect(resolveInside(root, attempt), attempt).toBeNull();
    }
  });
});

describe('language', () => {
  it('takes the first system language Lurk has, otherwise English', () => {
    expect(pickLanguage(['de-DE', 'en-US'])).toBe('de');
    expect(pickLanguage(['fr-FR', 'de-AT'])).toBe('de');
    expect(pickLanguage(['en_GB'])).toBe('en');
    expect(pickLanguage(['fr-FR'])).toBe('en');
    expect(pickLanguage([])).toBe('en');
  });

  it('has the same files, keys and placeholders in every language', () => {
    const keys = (value: unknown, prefix = ''): string[] =>
      typeof value === 'object' && value !== null
        ? Object.entries(value).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key))
        : [`${prefix} ${(String(value).match(/{{\w+}}/g) ?? []).sort().join(' ')}`];
    const read = (language: string) =>
      Object.fromEntries(
        readdirSync(path.join('locales', language))
          .filter((file) => file.endsWith('.json'))
          .map((file) => [file, keys(JSON.parse(readFileSync(path.join('locales', language, file), 'utf8'))).sort()]),
      );
    const english = read('en');
    expect(Object.keys(english).sort()).toEqual([
      'browse.json',
      'chat.json',
      'common.json',
      'follows.json',
      'menu.json',
      'player.json',
      'settings.json',
      'shell.json',
    ]);
    for (const language of languages) expect(read(language), language).toEqual(english);
  });
});
