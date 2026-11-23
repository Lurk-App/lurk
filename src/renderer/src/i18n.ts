// Translations: one JSON file per area and language in /locales. The main process chooses the
// language (AppInfo.language), so menus and windows always agree.

import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import deBrowse from '@locales/de/browse.json';
import deChat from '@locales/de/chat.json';
import deCommon from '@locales/de/common.json';
import deFollows from '@locales/de/follows.json';
import dePlayer from '@locales/de/player.json';
import deSettings from '@locales/de/settings.json';
import deShell from '@locales/de/shell.json';
import enBrowse from '@locales/en/browse.json';
import enChat from '@locales/en/chat.json';
import enCommon from '@locales/en/common.json';
import enFollows from '@locales/en/follows.json';
import enPlayer from '@locales/en/player.json';
import enSettings from '@locales/en/settings.json';
import enShell from '@locales/en/shell.json';
import { fallbackLanguage, type Language } from '@shared/language';

export const resources = {
  de: {
    common: deCommon,
    shell: deShell,
    settings: deSettings,
    player: dePlayer,
    chat: deChat,
    browse: deBrowse,
    follows: deFollows,
  },
  en: {
    common: enCommon,
    shell: enShell,
    settings: enSettings,
    player: enPlayer,
    chat: enChat,
    browse: enBrowse,
    follows: enFollows,
  },
} as const satisfies Record<Language, Record<string, unknown>>;

export async function setUpI18n(language: Language): Promise<void> {
  await i18next.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: fallbackLanguage,
    defaultNS: 'common',
    ns: ['common', 'shell', 'settings', 'player', 'chat', 'browse', 'follows'],
    // React escapes on its own; i18next must not do it twice.
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  document.documentElement.lang = language;
}
