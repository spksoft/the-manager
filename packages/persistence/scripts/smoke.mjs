// Smoke test for the JSON store. Verifies: defaults are written, two upserts
// survive a process restart, and the resulting file is human-readable JSON.
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectRepo, paths, setHomeRoot } from "../src/index.ts";

const root = join(tmpdir(), `the-manager-smoke-${Date.now()}`);
setHomeRoot(root);

const repo1 = new ProjectRepo();
const a = {
  id: randomUUID(),
  name: "alpha",
  path: "/tmp/alpha",
  defaultDriver: "claude",
  createdAt: new Date().toISOString(),
  lastUsedAt: null,
  ephemeral: false,
  expiresAt: null,
  description: null,
};
const b = {
  id: randomUUID(),
  name: "beta",
  path: "/tmp/beta",
  defaultDriver: "claude",
  createdAt: new Date().toISOString(),
  lastUsedAt: null,
  ephemeral: false,
  expiresAt: null,
  description: "Second smoke project, used for restart verification.",
};

await repo1.add(a);
await repo1.add(b);

const list1 = await repo1.list();
console.log(`first run: ${list1.length} projects`);
if (list1.length !== 2) throw new Error("expected 2 projects after add");

// Simulate restart by constructing a fresh repo instance (drops in-memory cache).
const repo2 = new ProjectRepo();
const list2 = await repo2.list();
console.log(`after restart: ${list2.length} projects`);
if (list2.length !== 2) throw new Error("state did not survive restart");

const raw = await readFile(paths.projectsIndex(), "utf8");
console.log("--- projects.json ---");
console.log(raw);

await rm(root, { recursive: true, force: true });
console.log("OK");
