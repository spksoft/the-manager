import { app, Menu, type MenuItemConstructorOptions, shell } from "electron";

/**
 * Application menu (the macOS top-bar menu / Windows-Linux window menu).
 *
 * Mirrors the entry points the tray exposes so users have menu-bar access to
 * Preferences and Quit even when no window is open. The Settings item is wired
 * to the same renderer event as the tray's "Preferences…" item.
 */
export interface MenuOptions {
  onOpenPreferences: () => void;
  onShowWindow: () => void;
  getUrl: () => string;
}

export function buildApplicationMenu(opts: MenuOptions): Menu {
  const isMac = process.platform === "darwin";

  const appMenu: MenuItemConstructorOptions = {
    label: app.name,
    submenu: [
      { role: "about" },
      { type: "separator" },
      {
        label: "Settings…",
        accelerator: "CmdOrCtrl+,",
        click: () => opts.onOpenPreferences(),
      },
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  };

  const fileMenu: MenuItemConstructorOptions = {
    label: "File",
    submenu: [
      {
        label: "Show Window",
        accelerator: "CmdOrCtrl+0",
        click: () => opts.onShowWindow(),
      },
      {
        label: "Open in Browser",
        click: () => {
          const url = opts.getUrl();
          if (url) void shell.openExternal(url);
        },
      },
      { type: "separator" },
      isMac ? { role: "close" } : { role: "quit" },
    ],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: "View",
    submenu: [
      { role: "reload" },
      { role: "forceReload" },
      { role: "toggleDevTools" },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" },
    ],
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: "Window",
    submenu: [
      { role: "minimize" },
      { role: "zoom" },
      ...(isMac
        ? ([{ type: "separator" }, { role: "front" }] as MenuItemConstructorOptions[])
        : ([{ role: "close" }] as MenuItemConstructorOptions[])),
    ],
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [appMenu] : []),
    fileMenu,
    editMenu,
    viewMenu,
    windowMenu,
  ];

  return Menu.buildFromTemplate(template);
}
