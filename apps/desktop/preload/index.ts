import { contextBridge, ipcRenderer } from "electron";

/**
 * Narrow bridge between the Next.js renderer and the Electron main process.
 * Only operations that *cannot* be done over HTTP belong here — everything
 * else goes through the embedded Next.js server like a normal web client.
 */

export interface AppInfo {
  url: string;
  port: number | null;
  isDev: boolean;
  isPackaged: boolean;
}

export interface RestartResult {
  ok: boolean;
  url: string | null;
  /** Set when `ok` is false (e.g. dev-mode restart is not supported). */
  message?: string;
}

contextBridge.exposeInMainWorld("theManager", {
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke("the-manager:pick-directory"),
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke("the-manager:get-app-info"),
  restartServer: (preferredPort?: number): Promise<RestartResult> =>
    ipcRenderer.invoke("the-manager:restart-server", { preferredPort }),
  quit: (): Promise<void> => ipcRenderer.invoke("the-manager:quit-app"),
  /**
   * Subscribes to the "user clicked Preferences in the tray" event. Returns an
   * unsubscribe function so React effects can clean up on unmount.
   */
  onOpenPreferences: (cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.on("the-manager:open-preferences", handler);
    return () => ipcRenderer.off("the-manager:open-preferences", handler);
  },
});
