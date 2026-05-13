import { join } from "node:path";
import { type BrowserWindow, Menu, nativeImage, shell, Tray } from "electron";

/**
 * Tray (menu-bar) integration. Owns the `Tray` instance and a small set of
 * callbacks for menu actions, so `index.ts` doesn't need to know how Electron
 * builds menus.
 *
 * The menu is rebuilt whenever the current URL changes (e.g. after a server
 * restart picks a different port), so the "Open in Browser" entry and the
 * status label always reflect the live server.
 */

export interface TrayOptions {
  getUrl: () => string;
  getMainWindow: () => BrowserWindow | null;
  isPackaged: boolean;
  onRestartServer: () => void;
  onOpenPreferences: () => void;
  onQuit: () => void;
}

let tray: Tray | null = null;
let opts: TrayOptions | null = null;

export function setupTray(options: TrayOptions): Tray {
  if (tray) return tray;
  opts = options;
  // Electron resolves `foo@2x.png` automatically when given `foo.png` on
  // hi-DPI displays, so we only pass the 1x path explicitly.
  const iconPath = join(__dirname, "..", "..", "assets", "trayTemplate.png");
  const image = nativeImage.createFromPath(iconPath);
  if (process.platform === "darwin") image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip("The Manager");
  // No explicit click handler: macOS opens the context menu on a single click
  // once `setContextMenu` is set. Adding a custom click handler that calls
  // `win.show()` here would force the window to reappear every time the user
  // touches the tray — surprising and unwanted. The menu's "Show Window" item
  // is the explicit way to bring the window back.
  rebuildTrayMenu();
  return tray;
}

export function rebuildTrayMenu(): void {
  if (!tray || !opts) return;
  const url = opts.getUrl();
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: `The Manager — ${url}`, enabled: false },
    { type: "separator" },
    {
      label: "Show Window",
      click: () => {
        const win = opts?.getMainWindow();
        if (win) win.show();
      },
    },
    {
      label: "Open in Browser",
      click: () => {
        void shell.openExternal(url);
      },
    },
    { type: "separator" },
    {
      label: "Preferences…",
      click: () => opts?.onOpenPreferences(),
    },
  ];
  if (opts.isPackaged) {
    items.push({
      label: "Restart Server",
      click: () => opts?.onRestartServer(),
    });
  }
  items.push(
    { type: "separator" },
    {
      label: "Quit The Manager",
      click: () => opts?.onQuit(),
    },
  );
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
  opts = null;
}
