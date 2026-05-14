#!/usr/bin/env node
import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

const pexec = promisify(execFile);
const CLAUDE_BIN = process.env.THE_MANAGER_CLAUDE_BIN ?? "claude";
const MAX_DIFF_BYTES = 64 * 1024;

if (process.env.THE_MANAGER_SKIP_HOOKS === "1") process.exit(0);

const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
  encoding: "utf8",
}).trim();
if (branch !== "main") process.exit(0);

let diff = execFileSync(
  "git",
  ["diff", "--cached", "--no-color", "--", ".", ":(exclude)CHANGELOG.md"],
  { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, cwd: REPO_ROOT },
);
if (diff.trim().length === 0) process.exit(0);
if (diff.length > MAX_DIFF_BYTES) {
  diff = `${diff.slice(0, MAX_DIFF_BYTES)}\n\n[... diff truncated at ${MAX_DIFF_BYTES} bytes ...]`;
}

const PROMPT = `You are generating a single CHANGELOG bullet for the following staged git diff.

Output ONLY the bullet text — no preamble, no quotes, no markdown fences, no leading dash, no explanation.

Rules:
  - One line, imperative voice, <= 100 chars (e.g. "Add foo", "Fix bar", "Refactor baz").
  - Do not mention file names unless load-bearing.
  - Do not reference commit SHAs or PR numbers.
  - If multiple unrelated changes exist, pick the dominant one — do not output multiple lines.

DIFF:
${diff}`;

console.log("[1/2] generating changelog entry via claude -p ...");

let entry;
try {
  const { stdout } = await pexec(CLAUDE_BIN, ["-p", PROMPT], {
    cwd: REPO_ROOT,
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
    env: process.env,
  });
  entry = stripFences(stdout)
    .trim()
    .replace(/^[-*]\s+/, "");
} catch (err) {
  const detail = err.stderr?.toString().trim() || err.message;
  console.error(`\npre-commit: claude -p failed: ${detail}`);
  console.error(
    "Hint: install Claude Code (https://docs.claude.com/claude-code) or bypass once with: git commit --no-verify",
  );
  process.exit(1);
}

if (!entry) {
  console.error("pre-commit: claude returned empty changelog entry; aborting.");
  process.exit(1);
}

const CHANGELOG = resolve(REPO_ROOT, "CHANGELOG.md");
const today = new Date().toISOString().slice(0, 10);
const header = `## ${today}`;

let body = existsSync(CHANGELOG) ? readFileSync(CHANGELOG, "utf8") : "# Changelog\n\n";
if (!body.startsWith("# Changelog")) body = `# Changelog\n\n${body}`;

if (body.includes(`\n${header}\n`)) {
  body = body.replace(`\n${header}\n`, `\n${header}\n- ${entry}\n`);
} else {
  body = body.replace(/^# Changelog\n+/, `# Changelog\n\n${header}\n- ${entry}\n\n`);
}

writeFileSync(CHANGELOG, body);
// `claude -p` above takes seconds; during that window another git operation
// (editor, file watcher, parallel terminal) can grab .git/index.lock. Retry
// briefly instead of aborting the commit.
await addWithRetry("CHANGELOG.md");
console.log(`       -> CHANGELOG.md: ${entry}`);

function stripFences(text) {
  const t = text.trim();
  const m = /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/.exec(t);
  return m?.[1] ?? t;
}

async function addWithRetry(path, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    try {
      execFileSync("git", ["add", path], { cwd: REPO_ROOT, stdio: "pipe" });
      return;
    } catch (err) {
      const msg = err.stderr?.toString() ?? "";
      const lockHeld = msg.includes("index.lock");
      if (!lockHeld || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 200 * 2 ** i));
    }
  }
}
