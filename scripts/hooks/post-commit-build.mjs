#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";

if (process.env.THE_MANAGER_SKIP_HOOKS === "1") process.exit(0);

const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
  encoding: "utf8",
}).trim();
if (branch !== "main") process.exit(0);

console.log("[2/2] building desktop app (blocking) ...");
console.log("       this can take several minutes. Skip with THE_MANAGER_SKIP_HOOKS=1.");

const res = spawnSync("pnpm", ["--filter", "@the-manager/desktop", "dist"], {
  stdio: "inherit",
  env: process.env,
});

if (res.error?.code === "ENOENT") {
  console.error("post-commit: pnpm not found in PATH.");
  console.error("Install pnpm@10.33.0 and rerun manually:");
  console.error("  pnpm --filter @the-manager/desktop dist");
  process.exit(1);
}
if (res.status !== 0) {
  console.error(`\npost-commit: desktop build failed (exit ${res.status}).`);
  console.error("The commit has already been recorded. Re-run the build manually:");
  console.error("  pnpm --filter @the-manager/desktop dist");
  process.exit(res.status ?? 1);
}

console.log("       desktop build complete.");
