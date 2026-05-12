import { contextBridge, ipcRenderer } from "electron";

/**
 * Narrow bridge between the Next.js renderer and the Electron main process.
 * Only operations that *cannot* be done over HTTP belong here — everything
 * else goes through the embedded Next.js server like a normal web client.
 */
contextBridge.exposeInMainWorld("theManager", {
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke("the-manager:pick-directory"),
});
