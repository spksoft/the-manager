import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type { ProgressEvent } from "./types";

interface RunOptions {
  cwd: string;
  onProgress?: (e: ProgressEvent) => void;
  signal?: AbortSignal;
}

const STAGE_RE =
  /^(Counting objects|Compressing objects|Receiving objects|Resolving deltas|Writing objects|remote: Counting objects|remote: Compressing objects):\s*(\d+)%(?:\s*\((\d+)\/(\d+)\))?/;

function parseProgressLine(line: string): ProgressEvent | null {
  const m = STAGE_RE.exec(line.trim());
  if (!m?.[1] || !m[2]) return null;
  const stage = m[1].replace(/^remote:\s*/, "");
  const progress = Number.parseInt(m[2], 10);
  const processed = m[3] ? Number.parseInt(m[3], 10) : undefined;
  const total = m[4] ? Number.parseInt(m[4], 10) : undefined;
  return { stage, progress, processed, total, raw: line };
}

/**
 * Run `git <args>` and emit progress events parsed from stderr. We bypass
 * simple-git for fetch/pull/push because we need (a) abort via SIGINT through
 * an AbortSignal and (b) reliable progress parsing on every line. simple-git's
 * `progress` plugin uses the same stderr parsing approach internally.
 */
export function runGitWithProgress(
  args: string[],
  opts: RunOptions,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // `--progress` is a per-subcommand flag (e.g. `git fetch --progress`), not
    // a top-level flag — `git --progress fetch` errors out with "unknown
    // option: --progress". Insert it right after the subcommand. Git also only
    // emits progress on a tty by default, so the explicit flag is needed here
    // because stderr is a pipe.
    const [sub, ...rest] = args;
    const finalArgs = sub ? [sub, "--progress", ...rest] : args;
    const child: ChildProcessWithoutNullStreams = spawn("git", finalArgs, {
      cwd: opts.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let stdout = "";
    let stderr = "";
    let buf = "";

    const abort = () => {
      child.kill("SIGINT");
    };
    if (opts.signal) {
      if (opts.signal.aborted) abort();
      else opts.signal.addEventListener("abort", abort, { once: true });
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      buf += text;
      // git emits \r between progress updates on the same line; treat both as separators
      const parts = buf.split(/[\r\n]/);
      buf = parts.pop() ?? "";
      for (const line of parts) {
        if (!line) continue;
        const ev = parseProgressLine(line);
        if (ev && opts.onProgress) opts.onProgress(ev);
      }
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (opts.signal) opts.signal.removeEventListener("abort", abort);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `git ${args[0] ?? ""} exited with code ${code}`));
    });
  });
}
