import { type ChildProcess, spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { app } from "electron";
import { getPort } from "get-port-please";
import { DEFAULT_PORT } from "./config";

let child: ChildProcess | null = null;
let currentPort: number | null = null;

/**
 * Boots the prebuilt Next.js server packaged alongside the desktop app and
 * returns the port it ended up listening on. Only invoked in production —
 * `next dev` is driven by `pnpm dev:web` during development.
 *
 * Port selection order:
 *   1. `settings.json` → `data.network.preferredPort` (if free).
 *   2. `DEFAULT_PORT` (48723) if free.
 *   3. Any free port in `[DEFAULT_PORT, 49999]` via `get-port-please`.
 *
 * The chosen port is written back to settings on first run so subsequent
 * launches keep a stable URL — useful for the tray's "Open in Browser" link.
 */
export async function startEmbeddedServer(): Promise<number> {
  if (child) {
    throw new Error("Embedded server already running");
  }
  const port = await pickPort();
  await spawnChild(port);
  await waitForHealth(port, 30_000);
  currentPort = port;
  await persistPortIfChanged(port);
  return port;
}

/**
 * Kills the running Next child and respawns it (optionally on a new preferred
 * port supplied by the user via the Preferences UI). Resolves once the new
 * server is healthy.
 */
export async function restartEmbeddedServer(opts?: { preferredPort?: number }): Promise<number> {
  if (opts?.preferredPort !== undefined) {
    await writePreferredPort(opts.preferredPort);
  }
  await killChild();
  const port = await pickPort();
  await spawnChild(port);
  await waitForHealth(port, 30_000);
  currentPort = port;
  await persistPortIfChanged(port);
  return port;
}

/** Current port if the embedded server is running, else `null`. */
export function getCurrentServerPort(): number | null {
  return currentPort;
}

async function pickPort(): Promise<number> {
  const preferred = (await readPreferredPort()) ?? DEFAULT_PORT;
  // get-port-please returns the requested port if it's free, otherwise a free
  // port in the supplied range — exactly the fallback behavior we want.
  return getPort({
    port: preferred,
    portRange: [DEFAULT_PORT, 49999],
  });
}

async function spawnChild(port: number): Promise<void> {
  // Standalone output for a monorepo lives at <root>/apps/web/server.js, with
  // node_modules hoisted to <root>/. extraResources maps that root to "web/"
  // inside the bundle, so the runtime cwd ends up at .../web/apps/web/.
  const webDir = join(process.resourcesPath, "web", "apps", "web");
  child = spawn(process.execPath, [join(webDir, "server.js")], {
    cwd: webDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      // process.execPath is the Electron binary in a packaged build; this
      // env var makes it act as Node instead of opening another window.
      ELECTRON_RUN_AS_NODE: "1",
      // Next.js standalone reads PORT/HOSTNAME from env, not flags.
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
    },
    stdio: "inherit",
  });

  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      // Quit the app if the server falls over — the window has nothing to show.
      app.quit();
    }
  });
}

async function killChild(): Promise<void> {
  if (!child || child.killed) {
    child = null;
    return;
  }
  const dying = child;
  child = null;
  await new Promise<void>((resolve) => {
    const onExit = () => resolve();
    dying.once("exit", onExit);
    dying.kill("SIGTERM");
    // Hard-kill if SIGTERM doesn't take.
    setTimeout(() => {
      if (!dying.killed) dying.kill("SIGKILL");
    }, 3_000);
  });
}

async function persistPortIfChanged(port: number): Promise<void> {
  const current = await readPreferredPort();
  if (current === port) return;
  await writePreferredPort(port);
}

async function waitForHealth(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Embedded server failed to become healthy in time");
}

// ---------------------------------------------------------------------------
// settings.json read/write — limited to the slice the desktop owns
// (`data.network.preferredPort`). The web side uses the proper-lockfile-backed
// `JsonStore`; here we touch only the same file with raw fs because the
// Electron main process can't import the workspace persistence package
// directly (no JS build output, ESM resolution of .ts fails at runtime).
// Races with the web process are bounded: the desktop writes only on first
// launch and on user-driven restart, and the web's PUT happens *before* the
// restart IPC call (so the value is already on disk when we read it back).
// ---------------------------------------------------------------------------
function settingsPath(): string {
  const root = process.env.THE_MANAGER_HOME?.length
    ? process.env.THE_MANAGER_HOME
    : join(homedir(), ".the-manager");
  return join(root, "settings.json");
}

async function readPreferredPort(): Promise<number | null> {
  try {
    const raw = await readFile(settingsPath(), "utf8");
    const parsed = JSON.parse(raw) as {
      data?: { network?: { preferredPort?: unknown } };
    };
    const value = parsed?.data?.network?.preferredPort;
    return typeof value === "number" && Number.isInteger(value) ? value : null;
  } catch {
    return null;
  }
}

async function writePreferredPort(port: number): Promise<void> {
  const path = settingsPath();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    // File doesn't exist or is unreadable — the web side will recreate the
    // full structure on first GET /api/settings. We still want to write our
    // slice now so the next desktop launch can read it back.
    parsed = { version: 1, data: {} };
  }
  const data = (parsed.data && typeof parsed.data === "object" ? parsed.data : {}) as Record<
    string,
    unknown
  >;
  const network = (data.network && typeof data.network === "object" ? data.network : {}) as Record<
    string,
    unknown
  >;
  network.preferredPort = port;
  data.network = network;
  parsed.data = data;
  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

app.on("before-quit", () => {
  if (child && !child.killed) {
    child.kill("SIGTERM");
  }
});
