import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";
import { app } from "electron";
import { getPort } from "get-port-please";

let child: ChildProcess | null = null;

/**
 * Boots the prebuilt Next.js server packaged alongside the desktop app and
 * returns the port it ended up listening on. Only invoked in production —
 * `next dev` is driven by `pnpm dev:web` during development.
 *
 * NOTE: Phase 0 only sketches the wiring. Actual packaging of `apps/web` into
 * the Electron bundle (and the matching `electron-builder` `extraResources`
 * entries) will land alongside the Phase 2 release pipeline.
 */
export async function startEmbeddedServer(): Promise<number> {
  if (child) {
    throw new Error("Embedded server already running");
  }
  const port = await getPort({ portRange: [40000, 49999] });
  const webDir = join(process.resourcesPath, "web");
  child = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-p", String(port)],
    {
      cwd: webDir,
      env: { ...process.env, NODE_ENV: "production" },
      stdio: "inherit",
    },
  );

  child.on("exit", (code) => {
    if (code !== 0) {
      // Quit the app if the server falls over — the window has nothing to show.
      app.quit();
    }
  });

  await waitForHealth(port, 30_000);
  return port;
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

app.on("before-quit", () => {
  if (child && !child.killed) {
    child.kill("SIGTERM");
  }
});
