// Import and export of subscriptions through the system's file dialogs; the result in a system
// message. Port of DataTransfer.importSubscriptions / exportSubscriptions of the macOS app
// (lurk-macos, Sources/Lurk/Views/SettingsView.swift).

import { dialog, type BrowserWindow } from 'electron';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { exportJSON, exportText, parseImport } from '@shared/subscriptions';
import { menuFormat, menuText } from './i18n';
import { libraryStore } from './libraryStore';
import { liveMonitor } from './liveMonitor';
import { channelsByLogin } from './twitch';

/** An import file larger than this is not a list of channels. */
const maxImportBytes = 5_000_000;

async function tell(owner: BrowserWindow | null, message: string) {
  const options = { type: 'info' as const, message: menuText('subscriptionsTitle'), detail: message, buttons: ['OK'] };
  if (owner) await dialog.showMessageBox(owner, options);
  else await dialog.showMessageBox(options);
}

export async function importSubscriptions(owner: BrowserWindow | null): Promise<void> {
  const options = {
    title: menuText('importTitle'),
    message: menuText('importMessage'),
    properties: ['openFile' as const],
    filters: [{ name: menuText('importFilter'), extensions: ['json', 'txt', 'csv'] }],
  };
  const { canceled, filePaths } = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options);
  const file = filePaths[0];
  if (canceled || !file) return;
  try {
    if ((await stat(file)).size > maxImportBytes) throw new Error('too large');
    const { channels, logins } = parseImport(await readFile(file, 'utf8'));
    const known = new Set(channels.map((channel) => channel.login));
    const resolved = await channelsByLogin(logins.filter((login) => !known.has(login)));
    const added = libraryStore.subscribe([...channels, ...resolved]);
    if (added) void liveMonitor.refresh();
    await tell(
      owner,
      added === 0
        ? menuText('importNone')
        : menuFormat(added === 1 ? 'importDoneOne' : 'importDone', { count: String(added) }),
    );
  } catch {
    await tell(owner, menuText('importFailed'));
  }
}

export async function exportSubscriptions(owner: BrowserWindow | null, format: 'json' | 'text'): Promise<void> {
  const list = libraryStore.get().subscriptions;
  if (!list.length) return;
  const options = {
    title: menuText('exportTitle'),
    defaultPath: format === 'json' ? 'lurk-abos.json' : 'lurk-abos.txt',
    filters: [
      format === 'json'
        ? { name: 'JSON', extensions: ['json'] }
        : { name: menuText('exportTextFilter'), extensions: ['txt'] },
    ],
  };
  const { canceled, filePath } = owner
    ? await dialog.showSaveDialog(owner, options)
    : await dialog.showSaveDialog(options);
  if (canceled || !filePath) return;
  try {
    await writeFile(filePath, format === 'json' ? exportJSON(list) : exportText(list), 'utf8');
    await tell(
      owner,
      menuFormat(list.length === 1 ? 'exportDoneOne' : 'exportDone', {
        count: String(list.length),
        file: path.basename(filePath),
      }),
    );
  } catch {
    await tell(owner, menuText('exportFailed'));
  }
}
