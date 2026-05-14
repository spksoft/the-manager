#!/usr/bin/env node
// End-to-end smoke test for the HTTP API.
//
// Boots `next start` against the already-built `apps/web` on a free port,
// drives the major endpoints, and exits 0 on success / 1 on first failure.
// Used by CI as the final "did anything wire break" gate.

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(__filename, "..", "..");

function log(line) {
  process.stdout.write(`[smoke] ${line}\n`);
}

async function findFreePort() {
  const { createServer } = await import("node:net");
  return new Promise((resolveFn, rejectFn) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", rejectFn);
    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolveFn(port));
    });
  });
}

async function waitFor(predicate, { timeoutMs = 30_000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch {
      // keep retrying
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("waitFor: timed out");
}

function assert(cond, message) {
  if (!cond) throw new Error(`assertion failed: ${message}`);
}

async function jsonReq(method, url, body) {
  const init = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(url, init);
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    /* allow non-JSON responses */
  }
  return { status: res.status, body: parsed };
}

async function main() {
  // Isolate persistence so we don't pollute the user's ~/.the-manager
  const home = await mkdtemp(join(tmpdir(), "the-manager-smoke-"));
  const projectDir = join(home, "demo-project");
  await mkdir(projectDir, { recursive: true });
  log(`THE_MANAGER_HOME=${home}`);

  const port = await findFreePort();
  const base = `http://127.0.0.1:${port}`;
  log(`starting next on ${base}`);

  const child = spawn(
    "node",
    [join(repoRoot, "apps/web/node_modules/next/dist/bin/next"), "start", "-p", String(port)],
    {
      cwd: join(repoRoot, "apps/web"),
      env: { ...process.env, THE_MANAGER_HOME: home, NODE_ENV: "production" },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );

  let exitedEarly = false;
  child.on("exit", (code) => {
    exitedEarly = true;
    if (code !== 0) log(`next exited early with code ${code}`);
  });

  try {
    await waitFor(async () => {
      if (exitedEarly) throw new Error("next exited before ready");
      const res = await fetch(`${base}/api/health`);
      return res.ok;
    });
    log("server up");

    // /api/health
    {
      const r = await jsonReq("GET", `${base}/api/health`);
      assert(r.status === 200 && r.body?.ok === true, `health: ${r.status}`);
      log("✓ /api/health");
    }

    // /api/projects empty
    {
      const r = await jsonReq("GET", `${base}/api/projects`);
      assert(r.status === 200 && Array.isArray(r.body) && r.body.length === 0, "projects empty");
      log("✓ /api/projects empty");
    }

    // POST /api/projects valid
    let created;
    {
      const r = await jsonReq("POST", `${base}/api/projects`, {
        name: "demo",
        path: projectDir,
        defaultDriver: "claude",
      });
      assert(
        r.status === 201 && r.body?.id,
        `create project: ${r.status} ${JSON.stringify(r.body)}`,
      );
      created = r.body;
      log(`✓ POST /api/projects → ${created.id.slice(0, 8)}…`);
    }

    // POST /api/projects nonexistent path → 400
    {
      const r = await jsonReq("POST", `${base}/api/projects`, {
        name: "ghost",
        path: "/this/path/does/not/exist",
        defaultDriver: "claude",
      });
      assert(r.status === 400, `expected 400, got ${r.status}`);
      log("✓ POST /api/projects bad path → 400");
    }

    // GET /api/projects shows the new project
    {
      const r = await jsonReq("GET", `${base}/api/projects`);
      assert(r.body?.length === 1 && r.body[0].id === created.id, "list contains new project");
      log("✓ GET /api/projects has 1 project");
    }

    // /api/settings GET + PUT
    {
      const get = await jsonReq("GET", `${base}/api/settings`);
      assert(get.status === 200 && get.body?.version === 1, "settings shape");
      const put = await jsonReq("PUT", `${base}/api/settings`, {
        flags: { "driver:claude": true },
      });
      assert(put.status === 200 && put.body.data.flags["driver:claude"] === true, "settings put");
      log("✓ /api/settings GET + PUT");
    }

    // /api/projects/[id]/git on a non-repo
    {
      const r = await jsonReq("GET", `${base}/api/projects/${created.id}/git`);
      assert(r.status === 200 && r.body?.isRepo === false, `git non-repo: ${r.status}`);
      log("✓ /api/projects/[id]/git non-repo → isRepo:false");
    }

    // /api/projects/[id]/files on empty dir
    {
      const r = await fetch(`${base}/api/projects/${created.id}/files?path=`);
      const body = await r.json();
      assert(r.status === 200 && body.type === "dir" && Array.isArray(body.entries), "files dir");
      log("✓ /api/projects/[id]/files lists empty dir");
    }

    // DELETE /api/projects/[id]/conversation (resets the chat thread without
    // hitting the real `claude` binary — keeps the smoke offline-safe).
    {
      const r = await fetch(`${base}/api/projects/${created.id}/conversation`, {
        method: "DELETE",
      });
      assert(r.status === 204, `conversation delete: ${r.status}`);
      log("✓ DELETE /api/projects/[id]/conversation");
    }

    // DELETE /api/projects/[id]
    {
      const r = await fetch(`${base}/api/projects/${created.id}`, { method: "DELETE" });
      assert(r.status === 204, `delete: ${r.status}`);
      log("✓ DELETE /api/projects/[id]");
    }

    log("OK — all checks passed");
  } finally {
    if (!exitedEarly) child.kill("SIGTERM");
    await rm(home, { recursive: true, force: true });
  }
}

main().catch((err) => {
  process.stderr.write(`[smoke] FAILED: ${err.stack ?? err.message ?? err}\n`);
  process.exit(1);
});
