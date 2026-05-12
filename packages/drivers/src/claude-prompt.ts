import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { PromptDriver, PromptEvent, PromptInput } from "./prompt-driver";

/**
 * Drives the `claude` CLI in `-p` (print) mode for one user prompt at a time,
 * parsing its `--output-format stream-json` lines into a normalized event
 * stream.
 *
 * Conversation continuity:
 *   - First message:  `claude -p "<prompt>" --session-id <uuid> ...`
 *   - Continuations:  `claude -p "<prompt>" --resume <uuid> ...`
 *
 * The CLI handles its own on-disk session storage; we just thread the uuid
 * through and persist whatever transcript we want in our own format.
 */
export class ClaudePromptDriver implements PromptDriver {
  readonly id = "claude" as const;

  constructor(private readonly command: string = process.env.THE_MANAGER_CLAUDE_BIN ?? "claude") {}

  async *prompt(input: PromptInput): AsyncIterable<PromptEvent> {
    const args: string[] = ["-p", input.prompt, "--output-format", "stream-json", "--verbose"];
    if (input.firstMessage) {
      args.push("--session-id", input.conversationId);
    } else {
      args.push("--resume", input.conversationId);
    }

    const child = spawn(this.command, args, {
      cwd: input.cwd,
      env: { ...process.env, ...(input.env ?? {}), THE_MANAGER: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    // If the caller aborts, terminate the child.
    if (input.signal) {
      const onAbort = () => child.kill("SIGTERM");
      if (input.signal.aborted) onAbort();
      else input.signal.addEventListener("abort", onAbort, { once: true });
    }

    // Catch the "claude isn't on PATH" case up front so we can surface a real
    // setup hint rather than the generic `exited with code 127` later. The
    // ENOENT lands as a `child.on("error")` event before any stdout arrives.
    let spawnError: string | null = null;
    child.on("error", (err) => {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === "ENOENT") {
        spawnError = `the \`claude\` CLI was not found at \`${this.command}\`. Install Claude Code (https://docs.claude.com/en/docs/claude-code) and make sure it is on PATH, or set THE_MANAGER_CLAUDE_BIN to its absolute path.`;
      } else {
        spawnError = err.message;
      }
    });

    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    let resolveExit: (code: number | null) => void = () => {};
    const exitPromise = new Promise<number | null>((resolve) => {
      resolveExit = resolve;
    });
    let exited = false;
    let exitCode: number | null = null;
    child.on("exit", (code) => {
      exited = true;
      exitCode = code;
      resolveExit(code);
    });

    let stderrTail = "";
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrTail += String(chunk);
      if (stderrTail.length > 4096) stderrTail = stderrTail.slice(-4096);
    });

    try {
      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        let obj: Record<string, unknown>;
        try {
          obj = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          continue;
        }
        const t = obj.type as string | undefined;
        const sub = obj.subtype as string | undefined;

        if (t === "system" && sub === "init") {
          yield {
            type: "session",
            conversationId: String(obj.session_id ?? input.conversationId),
            cwd: String(obj.cwd ?? input.cwd),
            model: (obj.model as string) ?? null,
          };
          continue;
        }
        if (t === "assistant") {
          const message = obj.message as { content?: unknown[] } | undefined;
          for (const block of message?.content ?? []) {
            const b = block as Record<string, unknown>;
            if (b.type === "text" && typeof b.text === "string") {
              yield { type: "text", text: b.text };
            } else if (b.type === "tool_use") {
              yield {
                type: "tool_use",
                id: String(b.id ?? ""),
                name: String(b.name ?? ""),
                input: b.input,
              };
            }
          }
          continue;
        }
        if (t === "user") {
          const message = obj.message as { content?: unknown[] } | undefined;
          for (const block of message?.content ?? []) {
            const b = block as Record<string, unknown>;
            if (b.type === "tool_result") {
              yield {
                type: "tool_result",
                toolUseId: String(b.tool_use_id ?? ""),
                content: b.content,
                isError: Boolean(b.is_error),
              };
            }
          }
          continue;
        }
        if (t === "result") {
          yield {
            type: "result",
            ok: !obj.is_error,
            durationMs: typeof obj.duration_ms === "number" ? obj.duration_ms : 0,
            costUsd: typeof obj.total_cost_usd === "number" ? obj.total_cost_usd : null,
            text: typeof obj.result === "string" ? obj.result : "",
          };
          continue;
        }
        if (t === "rate_limit_event") {
          yield { type: "info", message: `rate-limit event` };
        }
        // hook_started / hook_response / other system events are intentionally
        // ignored — they're noise for the chat UI but live in the raw transcript.
      }

      // Make sure the child has exited before we declare done; if it failed
      // before printing a `result`, surface the stderr tail.
      if (!exited) await exitPromise;
      if (spawnError) {
        yield { type: "error", message: spawnError };
      } else if (exitCode !== 0) {
        const tail = stderrTail.trim();
        yield {
          type: "error",
          message: tail
            ? `claude exited with code ${exitCode}: ${tail}`
            : `claude exited with code ${exitCode}`,
        };
      }
    } finally {
      rl.close();
      if (!exited) child.kill("SIGTERM");
    }
  }
}
