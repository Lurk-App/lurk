// The application menu, translated, per system: ⌘ on macOS, Ctrl on Windows and Linux.
// No window reload and no developer tools: ⌘R / Ctrl+R reloads the page's list, Ctrl+Shift+R is
// kept free for Replay (stage 2).

import { app, Menu, type MenuItemConstructorOptions } from 'electron';
import { menuText as t } from './i18n';
import { settingsStore } from './settingsStore';
import { openSettingsWindow, sendCommand } from './windows';

export function installMenu(): void {
  const mac = process.platform === 'darwin';

  const settingsItems: MenuItemConstructorOptions[] = [
    { label: t('settings'), accelerator: 'CmdOrCtrl+,', click: () => openSettingsWindow() },
    {
      label: t('customize'),
      accelerator: mac ? 'Cmd+Alt+,' : 'Ctrl+Alt+,',
      click: () => openSettingsWindow('appearance'),
    },
  ];

  const appMenu: MenuItemConstructorOptions = {
    label: app.getName(),
    submenu: [
      { role: 'about', label: t('about') },
      { type: 'separator' },
      ...settingsItems,
      { type: 'separator' },
      { role: 'services', label: t('services') },
      { type: 'separator' },
      { role: 'hide', label: t('hide') },
      { role: 'hideOthers', label: t('hideOthers') },
      { role: 'unhide', label: t('showAll') },
      { type: 'separator' },
      { role: 'quit', label: t('quit') },
    ],
  };

  const fileMenu: MenuItemConstructorOptions = {
    label: t('file'),
    submenu: [
      ...settingsItems,
      { type: 'separator' },
      { role: 'close', label: t('closeWindow') },
      { role: 'quit', label: t('quit') },
    ],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: t('edit'),
    submenu: [
      { role: 'undo', label: t('undo') },
      { role: 'redo', label: t('redo') },
      { type: 'separator' },
      { role: 'cut', label: t('cut') },
      { role: 'copy', label: t('copy') },
      { role: 'paste', label: t('paste') },
      { role: 'selectAll', label: t('selectAll') },
      { type: 'separator' },
      { label: t('find'), accelerator: 'CmdOrCtrl+F', click: () => sendCommand('focus-search') },
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: t('view'),
    submenu: [
      {
        label: t('toggleSidebar'),
        accelerator: mac ? 'Ctrl+Cmd+S' : 'Ctrl+Shift+S',
        click: () => sendCommand('toggle-sidebar'),
      },
      { label: t('back'), accelerator: mac ? 'Cmd+[' : 'Alt+Left', click: () => sendCommand('go-back') },
      // Reloads the list of the page shown (Entdecken, Kategorien …), not the window.
      { label: t('refresh'), accelerator: 'CmdOrCtrl+R', click: () => sendCommand('refresh') },
      { type: 'separator' },
      { role: 'togglefullscreen', label: t('fullscreen') },
    ],
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: t('window'),
    role: 'windowMenu',
    submenu: [
      { role: 'minimize', label: t('minimize') },
      { role: 'zoom', label: t('zoom') },
      { role: 'close', label: t('closeWindow') },
      { type: 'separator' },
      { role: 'front', label: t('front') },
    ],
  };

  const playbackMenu: MenuItemConstructorOptions = {
    label: t('playback'),
    submenu: [
      {
        label: t('showChat'),
        type: 'checkbox',
        checked: settingsStore.get().player.showChat,
        accelerator: 'CmdOrCtrl+Shift+K',
        click: () => settingsStore.update({ player: { showChat: !settingsStore.get().player.showChat } }),
      },
    ],
  };

  const helpMenu: MenuItemConstructorOptions = {
    label: t('help'),
    role: 'help',
    submenu: [{ role: 'about', label: t('about') }],
  };

  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      mac
        ? [appMenu, editMenu, viewMenu, playbackMenu, windowMenu]
        : [fileMenu, editMenu, viewMenu, playbackMenu, helpMenu],
    ),
  );
}
