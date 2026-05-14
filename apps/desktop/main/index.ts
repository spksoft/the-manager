import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, session } from "electron";
import { devUrl } from "./config";
import { buildApplicationMenu } from "./menu";
import { getCurrentServerPort, restartEmbeddedServer, startEmbeddedServer } from "./server";
import { rebuildTrayMenu, setupTray } from "./tray";

const isDev = !app.isPackaged;

// Web Speech API (`webkitSpeechRecognition`, used by MicButton) is gated behind
// experimental flags in Electron — Chrome ships it on by default but Electron
// keeps it off. Enable on-device recognition so the API works without needing
// Google's cloud key (which Electron doesn't have).
app.commandLine.appendSwitch(
  "enable-features",
  "OnDeviceWebSpeech,OnDeviceWebSpeechAvailable,MediaStreamTrackTransfer",
);

// macOS Finder launches GUI apps with a stripped PATH (missing Homebrew, user
// dirs, etc.), so child processes can't find `claude` and other CLI agents the
// embedded server shells out to. We rebuild PATH from two sources:
//   1. The user's interactive login shell — most reliable, picks up whatever
//      they've configured in .zshrc/.zshenv/.zprofile.
//   2. A hardcoded fallback covering common install locations, in case the
//      shell capture fails (timeout, non-zero exit, empty output).
// Order matters: user PATH first so their `which claude` wins.
if (process.platform === "darwin" && app.isPackaged) {
  const shell = process.env.SHELL ?? "/bin/zsh";
  let loginPath: string | null = null;
  try {
    const res = spawnSync(shell, ["-l", "-i", "-c", "echo $PATH"], {
      encoding: "utf8",
      timeout: 1500,
    });
    if (res.status === 0) {
      const out = res.stdout.trim();
      if (out.length > 0) loginPath = out;
    }
  } catch {
    // ignore; fall through to hardcoded extras
  }
  const fallbacks = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(homedir(), ".local", "bin"),
    join(homedir(), ".claude", "local"),
  ];
  const current = process.env.PATH ?? "";
  process.env.PATH = [loginPath, ...fallbacks, current].filter(Boolean).join(":");
}

let mainWindow: BrowserWindow | null = null;
let currentUrl: string | null = null;
let isQuitting = false;

const appIconPath = join(__dirname, "..", "..", "assets", "icon.png");
const appIcon = nativeImage.createFromPath(appIconPath);

async function resolveAppUrl(): Promise<string> {
  if (isDev) return devUrl();
  const port = await startEmbeddedServer();
  return `http://localhost:${port}`;
}

/**
 * Polls /api/health until the URL is reachable, or throws after `timeoutMs`.
 * In dev mode this avoids the racy "Electron beats next dev to the punch and
 * shows a connection-refused page" startup that you'd otherwise hit when
 * launching both processes in parallel via `turbo run dev`. Throws on timeout
 * so the caller can surface a real error instead of letting Electron load
 * `chrome-error://chromewebdata/`.
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
  throw new Error(
    `Dev server at ${url} did not respond within ${Math.round(timeoutMs / 1000)}s. ` +
      `Make sure \`pnpm dev:web\` is running (or use \`pnpm dev\`).`,
  );
}

async function createWindow(): Promise<BrowserWindow | null> {
  const url = await resolveAppUrl();
  currentUrl = url;
  if (isDev) {
    try {
      await waitForReachable(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await dialog.showMessageBox({
        type: "error",
        title: "The Manager — dev server unreachable",
        message,
      });
      isQuitting = true;
      app.quit();
      return null;
    }
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#0a0a0a",
    show: false,
    // `icon` is used by the window decoration on Windows/Linux. macOS reads
    // the bundle icon instead — see `app.dock.setIcon` below for the dev-mode
    // Dock override.
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Intercept the red-dot close: hide the window so the app keeps living in
  // the tray. The user can explicitly quit via the tray's "Quit" item, which
  // sets `isQuitting` before calling `app.quit()`.
  win.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.once("ready-to-show", () => win.show());
  try {
    await win.loadURL(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await dialog.showMessageBox({
      type: "error",
      title: "The Manager — failed to load app",
      message: `${message}\n\nIs the dev server running at ${url}?`,
    });
    isQuitting = true;
    app.quit();
    return null;
  }

  mainWindow = win;
  return win;
}

async function showMainWindow(): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  await createWindow();
}

app.on("before-quit", () => {
  isQuitting = true;
});

app.whenReady().then(async () => {
  // Keep the Dock icon visible on macOS so Cmd-Tab works and the standard
  // application menu (with Preferences/Quit) shows in the menu bar. The tray
  // is still set up below; close-to-tray behavior is preserved.
  if (process.platform === "darwin" && !app.isPackaged && !appIcon.isEmpty()) {
    // In packaged builds macOS reads the bundle icon. In dev (`electron .`
    // against unpackaged source) point the Dock at our PNG so it doesn't
    // fall back to the generic Electron icon.
    app.dock?.setIcon(appIcon);
  }

  // Renderer media access (mic, camera) is denied by default in Electron.
  // Approve `media` and `mediaKeySystem` for our own origin so MicButton's
  // SpeechRecognition / getUserMedia calls succeed. We scope to localhost +
  // file:// so a future malicious iframe couldn't piggyback.
  const isOwnOrigin = (url: string) => {
    if (!url) return false;
    if (url.startsWith("file://")) return true;
    try {
      const { hostname } = new URL(url);
      return hostname === "localhost" || hostname === "127.0.0.1";
    } catch {
      return false;
    }
  };
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const url = webContents.getURL();
    if ((permission === "media" || permission === "mediaKeySystem") && isOwnOrigin(url)) {
      callback(true);
      return;
    }
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    if (permission === "media" || permission === "mediaKeySystem") {
      return isOwnOrigin(requestingOrigin);
    }
    return false;
  });

  // Privileged ops that genuinely need Electron (cannot be done over HTTP).
  ipcMain.handle("the-manager:pick-directory", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win ?? (undefined as never), {
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle("the-manager:get-app-info", () => {
    const url = currentUrl ?? "";
    let port: number | null = null;
    if (!isDev) port = getCurrentServerPort();
    if (port === null && url) {
      const match = url.match(/:(\d+)/);
      if (match) port = Number(match[1]);
    }
    return { url, port, isDev, isPackaged: app.isPackaged };
  });

  ipcMain.handle(
    "the-manager:restart-server",
    async (_event, args?: { preferredPort?: number }) => {
      if (isDev) {
        return {
          ok: false,
          message:
            "In dev mode the Next.js server is owned by `pnpm dev:web`. " +
            "Change the port there and relaunch the desktop app.",
          url: currentUrl,
        };
      }
      const port = await restartEmbeddedServer({ preferredPort: args?.preferredPort });
      currentUrl = `http://localhost:${port}`;
      rebuildTrayMenu();
      if (mainWindow && !mainWindow.isDestroyed()) {
        await mainWindow.loadURL(currentUrl);
      }
      return { ok: true, url: currentUrl };
    },
  );

  ipcMain.handle("the-manager:quit-app", () => {
    isQuitting = true;
    app.quit();
  });

  await createWindow();

  Menu.setApplicationMenu(
    buildApplicationMenu({
      onOpenPreferences: () => {
        void (async () => {
          await showMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("the-manager:open-preferences");
          }
        })();
      },
      onShowWindow: () => void showMainWindow(),
      getUrl: () => currentUrl ?? "",
    }),
  );

  setupTray({
    getUrl: () => currentUrl ?? "",
    getMainWindow: () => mainWindow,
    isPackaged: app.isPackaged,
    onRestartServer: () => {
      if (isDev) return;
      void (async () => {
        const port = await restartEmbeddedServer();
        currentUrl = `http://localhost:${port}`;
        rebuildTrayMenu();
        if (mainWindow && !mainWindow.isDestroyed()) {
          await mainWindow.loadURL(currentUrl);
        }
      })();
    },
    onOpenPreferences: () => {
      void (async () => {
        await showMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("the-manager:open-preferences");
        }
      })();
    },
    onQuit: () => {
      isQuitting = true;
      app.quit();
    },
  });

  app.on("activate", () => {
    void showMainWindow();
  });
});

// With a tray icon we want the app to keep running even when every window is
// closed (the user reopens via the tray). Quit is only triggered explicitly
// from the tray's "Quit" item, which flips `isQuitting` before `app.quit()`.
app.on("window-all-closed", () => {
  // no-op
});
