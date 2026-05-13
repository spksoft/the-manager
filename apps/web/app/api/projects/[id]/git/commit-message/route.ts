import "server-only";
import { execFile } from "node:child_process";
import { GitView } from "@the-manager/git";
import { NotFoundError, type ProjectId, ValidationError } from "@the-manager/shared";
import { handleErr, jsonOk } from "../../../../../../lib/api";
import { repos } from "../../../../../../lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CLAUDE_BIN = process.env.THE_MANAGER_CLAUDE_BIN ?? "claude";

// Hard cap on diff bytes piped to claude. A monster diff burns tokens for no
// benefit — the model truncates anyway — and risks exceeding the CLI's argv
// limit. 64 KiB is enough to summarise a typical feature commit.
const MAX_DIFF_BYTES = 64 * 1024;

const PROMPT = (diff: string, fallback: boolean) =>
  `You are generating a git commit message for the following diff. Output ONLY the commit message — no preamble, no quotes, no markdown fences, no explanation.

Format:
  - First line: imperative, <= 72 chars, no trailing period.
  - Optional body after a blank line: wrap at ~72 chars, explain WHY when non-obvious.

${fallback ? "NOTE: Nothing is staged yet, so this diff is the working tree against HEAD.\n\n" : ""}DIFF:
${diff}`;

/**
 * One-shot `claude -p` call to draft a commit message from the staged diff.
 * Falls back to the working-tree diff so the "Generate" button still does
 * something useful before the user has clicked any checkboxes.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const project = await repos.projects.get(id as ProjectId);
    const view = new GitView(project.path);
    if (!(await view.isRepository())) {
      throw new NotFoundError("git repository", project.path);
    }

    let diff = await view.stagedDiff();
    let fallback = false;
    if (diff.trim().length === 0) {
      diff = await view.workingDiff();
      fallback = true;
    }
    if (diff.trim().length === 0) {
      throw new ValidationError("nothing to summarise — working tree is clean");
    }
    if (diff.length > MAX_DIFF_BYTES) {
      diff = `${diff.slice(0, MAX_DIFF_BYTES)}\n\n[... diff truncated at ${MAX_DIFF_BYTES} bytes ...]`;
    }

    const message = await runClaudePrompt(PROMPT(diff, fallback), project.path);
    return jsonOk({ message, usedFallbackDiff: fallback });
  } catch (err) {
    return handleErr(err);
  }
}

function runClaudePrompt(prompt: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      CLAUDE_BIN,
      ["-p", prompt],
      {
        cwd,
        timeout: 60_000,
        // The diff is already capped, but `claude -p` may stream tool output
        // before settling on a final message. 4 MiB is conservative headroom.
        maxBuffer: 4 * 1024 * 1024,
        env: process.env,
      },
      (err, stdout, stderr) => {
        if (err) {
          const detail = stderr?.toString().trim() || err.message;
          reject(new Error(`claude -p failed: ${detail}`));
          return;
        }
        resolve(stripFences(stdout.toString()).trim());
      },
    );
    child.on("error", (e) => reject(e));
  });
}

/**
 * Claude sometimes wraps the output in ``` fences despite being told not to.
 * Strip a single outer fence if it covers the whole message.
 */
function stripFences(text: string): string {
  const trimmed = text.trim();
  const fence = /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/;
  const m = fence.exec(trimmed);
  return m?.[1] ?? trimmed;
}
