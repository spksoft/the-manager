#!/usr/bin/env node
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const bump = process.argv[2];
if (!["patch", "minor", "major"].includes(bump)) {
  console.error("Usage: pnpm release <patch|minor|major>");
  process.exit(1);
}

const files = ["package.json", "apps/desktop/package.json"];
const current = JSON.parse(readFileSync("package.json", "utf8")).version;
const [maj, min, pat] = current.split(".").map(Number);
const next =
  bump === "major"
    ? `${maj + 1}.0.0`
    : bump === "minor"
      ? `${maj}.${min + 1}.0`
      : `${maj}.${min}.${pat + 1}`;

for (const f of files) {
  const pkg = JSON.parse(readFileSync(f, "utf8"));
  pkg.version = next;
  writeFileSync(f, `${JSON.stringify(pkg, null, 2)}\n`);
}

execSync(`git add ${files.join(" ")}`, { stdio: "inherit" });
execSync(`git commit -m "release: v${next}"`, { stdio: "inherit" });
execSync(`git tag -a v${next} -m "v${next}"`, { stdio: "inherit" });
console.log(`\nTagged v${next}. Push with:  git push origin main --follow-tags`);
