import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { settingsTabs, type SettingsTab } from '@shared/ipc';
import { boot } from '../boot';
import '../styles.css';
import { lastSettingsTab, SettingsApp } from './SettingsApp';

const { settings } = await boot();
// A named tab ("Lurk anpassen …"), else the one used last, else "Wiedergabe" as on macOS.
const requested = new URLSearchParams(window.location.search).get('tab') ?? lastSettingsTab();
const tab: SettingsTab = settingsTabs.includes(requested as SettingsTab) ? (requested as SettingsTab) : 'playback';

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing');
createRoot(root).render(
  <StrictMode>
    <SettingsApp initialSettings={settings} initialTab={tab} />
  </StrictMode>,
);
