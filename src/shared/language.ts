// Interface languages. German and English ship from the start; a new language is a new folder in
// /locales (see CONTRIBUTING.md) and one entry here.

export const languages = ['de', 'en'] as const;
export type Language = (typeof languages)[number];
export const fallbackLanguage: Language = 'en';

/** The first system language Lurk has a translation for, otherwise English. */
export function pickLanguage(systemLanguages: readonly string[]): Language {
  for (const tag of systemLanguages) {
    const base = tag.toLowerCase().split(/[-_]/)[0];
    if (base && (languages as readonly string[]).includes(base)) return base as Language;
  }
  return fallbackLanguage;
}
