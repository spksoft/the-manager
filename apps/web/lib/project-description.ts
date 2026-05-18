import "server-only";
import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectId } from "@the-manager/shared";
import { repos } from "./runtime";

const CLAUDE_BIN = process.env.THE_MANAGER_CLAUDE_BIN ?? "claude";

/**
 * Hard limits on the per-source snippet we feed claude. The total prompt is
 * what we send through `-p`, so keeping each source small keeps token cost
 * predictable regardless of how big the actual files are.
 */
const README_MAX_BYTES = 4 * 1024;
const PACKAGE_JSON_MAX_BYTES = 4 * 1024;
const DIR_LISTING_MAX_ENTRIES = 60;
const CLAUDE_TIMEOUT_MS = 90_000;
const MAX_DESCRIPTION_CHARS = 400;

const README_CANDIDATES = ["README.md", "README", "README.txt", "readme.md", "Readme.md"];
const PACKAGE_FILE_CANDIDATES = [
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "composer.json",
  "Gemfile",
  "build.gradle",
  "build.gradle.kts",
  "pom.xml",
];

const inFlight = new Set<string>();

/**
 * Best-effort background task. Reads a few well-known files in the project
 * directory, asks `claude -p` to summarise, and saves the result back onto the
 * project row. Failures are swallowed (logged only) — a missing description is
 * recoverable via the manual "Regenerate" button in the edit dialog.
 */
export async function regenerateProjectDescription(projectId: ProjectId): Promise<string | null> {
  if (inFlight.has(projectId)) return null;
  inFlight.add(projectId);
  try {
    const project = await repos.projects.get(projectId);
    const snippet = await collectProjectSnippet(project.path);
    const prompt = buildPrompt(project.name, project.path, snippet);
    const raw = await runClaudePrompt(prompt, project.path);
    const description = sanitiseDescription(raw);
    if (description.length === 0) return null;
    await repos.projects.update(projectId, { description });
    return description;
  } catch (err) {
    console.error(`[project-description] generation failed for ${projectId}:`, err);
    return null;
  } finally {
    inFlight.delete(projectId);
  }
}

/**
 * Fire-and-forget wrapper. Used by POST /api/projects so the create call
 * returns immediately and the description fills in later (UI picks it up on
 * the next SWR refresh).
 */
export function scheduleProjectDescriptionGeneration(projectId: ProjectId): void {
  void regenerateProjectDescription(projectId);
}

async function collectProjectSnippet(projectPath: string): Promise<string> {
  const parts: string[] = [];
  const readme = await readFirstFile(projectPath, README_CANDIDATES, README_MAX_BYTES);
  if (readme) parts.push(`README (${readme.filename}):\n${readme.content}`);

  for (const candidate of PACKAGE_FILE_CANDIDATES) {
    const content = await readSingleFile(projectPath, candidate, PACKAGE_JSON_MAX_BYTES);
    if (content) {
      parts.push(`${candidate}:\n${content}`);
      // Don't dump every manifest — one is usually enough signal.
      break;
    }
  }

  const listing = await topLevelListing(projectPath);
  if (listing.length > 0) parts.push(`Top-level entries:\n${listing.join("\n")}`);

  return parts.join("\n\n---\n\n");
}

async function readFirstFile(
  dir: string,
  candidates: string[],
  maxBytes: number,
): Promise<{ filename: string; content: string } | null> {
  for (const filename of candidates) {
    const content = await readSingleFile(dir, filename, maxBytes);
    if (content !== null) return { filename, content };
  }
  return null;
}

async function readSingleFile(
  dir: string,
  filename: string,
  maxBytes: number,
): Promise<string | null> {
  try {
    const buf = await readFile(join(dir, filename));
    const truncated = buf.length > maxBytes;
    const slice = truncated ? buf.subarray(0, maxBytes) : buf;
    const text = slice.toString("utf8");
    return truncated ? `${text}\n[... truncated at ${maxBytes} bytes ...]` : text;
  } catch {
    return null;
  }
}

async function topLevelListing(dir: string): Promise<string[]> {
  let entries: string[] = [];
  try {
    const dirents = await readdir(dir, { withFileTypes: true });
    entries = dirents
      .filter((d) => !d.name.startsWith("."))
      .slice(0, DIR_LISTING_MAX_ENTRIES)
      .map((d) => (d.isDirectory() ? `${d.name}/` : d.name));
  } catch {
    return [];
  }
  // Annotate with size for clarity on at most a few files (skip dirs).
  const annotated: string[] = [];
  for (const entry of entries) {
    if (entry.endsWith("/")) {
      annotated.push(entry);
      continue;
    }
    try {
      const s = await stat(join(dir, entry));
      annotated.push(`${entry} (${s.size}B)`);
    } catch {
      annotated.push(entry);
    }
  }
  return annotated;
}

function buildPrompt(name: string, path: string, snippet: string): string {
  const body = snippet.length > 0 ? snippet : "(no README / manifest / files found in directory)";
  return `You are writing a one-or-two-sentence project description that will be shown to a meta-agent (The Manager) so it can route work without opening the project.

CONSTRAINTS:
  - Output ONLY the description text — no preamble, no quotes, no markdown fences, no labels like "Description:".
  - Single paragraph. Max 300 characters.
  - State WHAT the project is and its primary purpose. Mention the language/stack only if it materially affects routing.
  - If the available signal is too thin to describe the project, output exactly: (no description available)

PROJECT NAME: ${name}
PROJECT PATH: ${path}

PROJECT SIGNAL:
${body}`;
}

function sanitiseDescription(raw: string): string {
  let text = raw.trim();
  // Strip a single outer code fence if claude wrapped the answer.
  const fence = /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/;
  const m = fence.exec(text);
  if (m?.[1]) text = m[1].trim();
  // Collapse internal whitespace to keep the description a single line.
  text = text.replace(/\s+/g, " ").trim();
  if (text === "(no description available)") return "";
  if (text.length > MAX_DESCRIPTION_CHARS) {
    text = `${text.slice(0, MAX_DESCRIPTION_CHARS - 1).trimEnd()}…`;
  }
  return text;
}

function runClaudePrompt(prompt: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      CLAUDE_BIN,
      ["-p", prompt],
      {
        cwd,
        timeout: CLAUDE_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
        env: process.env,
      },
      (err, stdout, stderr) => {
        if (err) {
          const detail = stderr?.toString().trim() || err.message;
          reject(new Error(`claude -p failed: ${detail}`));
          return;
        }
        resolve(stdout.toString());
      },
    );
    child.on("error", (e) => reject(e));
  });
}
