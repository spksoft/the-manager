import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { startEmbeddedServer } from "./server";

const isDev = !app.isPackaged;

async function resolveAppUrl(): Promise<string> {
  if (isDev) {
    // Dev: point at `pnpm dev:web` (next dev on 3000).
    return process.env.THE_MANAGER_DEV_URL ?? "http://localhost:3000";
  }
  const port = await startEmbeddedServer();
  return `http://localhost:${port}`;
}

/**
 * Polls /api/health until the URL is reachable, or gives up after `timeoutMs`.
 * In dev mode this avoids the racy "Electron beats next dev to the punch and
 * shows a connection-refused page" startup that you'd otherwise hit when
 * launching both processes in parallel via `turbo run dev`.
 */
async function waitForReachable(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url.replace(/\/$/, "")}/api/health`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function createWindow(): Promise<void> {
  const url = await resolveAppUrl();
  if (isDev) await waitForReachable(url);

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#0a0a0a",
    show: false,
    webPreferences: {
      preload: join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => win.show());
  await win.loadURL(url);
}

app.whenReady().then(async () => {
  // Privileged ops that genuinely need Electron (cannot be done over HTTP).
  ipcMain.handle("the-manager:pick-directory", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win ?? (undefined as never), {
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
