import { app } from 'electron';
import deMenu from '@locales/de/menu.json';
import enMenu from '@locales/en/menu.json';
import { pickLanguage, type Language } from '@shared/language';

const menus: Record<Language, typeof enMenu> = { de: deMenu, en: enMenu };

let language: Language | null = null;

/** The interface language, chosen once from the system's preferred languages. */
export function currentLanguage(): Language {
  language ??= pickLanguage(app.getPreferredSystemLanguages());
  return language;
}

/** Texts the main process shows itself: menus, the settings window title, dialogs. */
export function menuText(key: keyof typeof enMenu): string {
  return menus[currentLanguage()][key];
}

/** A text with {{placeholders}} filled in. */
export function menuFormat(key: keyof typeof enMenu, values: Record<string, string>): string {
  return menuText(key).replace(/{{(\w+)}}/g, (whole, name: string) => values[name] ?? whole);
}
