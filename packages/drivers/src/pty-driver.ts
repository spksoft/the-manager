import { EventEmitter } from "node:events";
import type { DriverId } from "@the-manager/shared";
import type { AgentDriver, AgentEvent, AgentHandle, SpawnOptions } from "./driver";

/**
 * node-pty is loaded lazily via `await import()` so that:
 *   (a) the package can be required in a browser bundle without crashing
 *       (Next.js sometimes pre-evaluates server module graphs at build time),
 *   (b) consumers that never call `spawn()` don't pay the native-binding cost.
 *
 * We use `@lydell/node-pty` because it ships prebuilt binaries for the common
 * platforms — no node-gyp toolchain required at `pnpm install` time.
 */
type PtyModule = typeof import("@lydell/node-pty");
let ptyModulePromise: Promise<PtyModule> | null = null;
async function loadPty(): Promise<PtyModule> {
  if (!ptyModulePromise) {
    ptyModulePromise = import("@lydell/node-pty");
  }
  return ptyModulePromise;
}

export interface PtyDriverConfig {
  id: DriverId;
  /** Binary on PATH that this driver launches. */
  command: string;
  /** Arguments prepended to user-supplied args on every spawn. */
  baseArgs?: string[];
  /** Environment variables merged on top of process.env on every spawn. */
  baseEnv?: Record<string, string>;
}

/**
 * Generic pty-backed driver. The three CLIs we care about today (Claude Code,
 * Codex, Gemini) are interactive REPLs whose only shape difference is the
 * binary name — wrap them in one place so adding a fourth is a one-liner.
 */
export class PtyAgentDriver implements AgentDriver {
  readonly id: DriverId;

  constructor(private readonly config: PtyDriverConfig) {
    this.id = config.id;
  }

  spawn(opts: SpawnOptions): AgentHandle {
    const cols = opts.pty?.cols ?? 120;
    const rows = opts.pty?.rows ?? 32;
    const args = [...(this.config.baseArgs ?? []), ...(opts.args ?? [])];
    const env: Record<string, string> = {
      // Inherit by default so the agent can see the user's PATH, auth files, etc.
      ...(process.env as Record<string, string>),
      ...(this.config.baseEnv ?? {}),
      ...(opts.env ?? {}),
      // Mark child processes so agents can detect they're running inside The Manager.
      THE_MANAGER: "1",
      // Force colour even though we're piping over SSE — xterm.js can render it.
      FORCE_COLOR: "1",
    };

    const emitter = new EventEmitter();
    let term: import("@lydell/node-pty").IPty | null = null;
    let killed = false;
    let pendingWrites: string[] = [];
    let pendingResize: { cols: number; rows: number } | null = null;
    let pendingKill: NodeJS.Signals | null = null;

    void loadPty()
      .then((pty) => {
        if (killed) return;
        term = pty.spawn(this.config.command, args, {
          name: "xterm-256color",
          cols,
          rows,
          cwd: opts.cwd,
          env,
          encoding: "utf8",
        });
        for (const chunk of pendingWrites) term.write(chunk);
        pendingWrites = [];
        if (pendingResize) {
          term.resize(pendingResize.cols, pendingResize.rows);
          pendingResize = null;
        }
        if (pendingKill) {
          term.kill(pendingKill);
        }
        term.onData((data) => {
          emitter.emit("data", { type: "data", chunk: data } satisfies AgentEvent);
        });
        term.onExit(({ exitCode, signal }) => {
          emitter.emit("exit", {
            type: "exit",
            code: exitCode ?? null,
            signal: signal != null ? (`${signal}` as NodeJS.Signals) : null,
          } satisfies AgentEvent);
        });
      })
      .catch((cause) => {
        const err = cause instanceof Error ? cause : new Error(String(cause));
        emitter.emit("error", { type: "error", error: err } satisfies AgentEvent);
        emitter.emit("exit", {
          type: "exit",
          code: null,
          signal: null,
        } satisfies AgentEvent);
      });

    const handle: AgentHandle = {
      get pid() {
        return term?.pid ?? -1;
      },
      write(data) {
        if (term) term.write(data);
        else pendingWrites.push(data);
      },
      resize(cols2, rows2) {
        if (term) term.resize(cols2, rows2);
        else pendingResize = { cols: cols2, rows: rows2 };
      },
      kill(signal = "SIGTERM") {
        killed = true;
        if (term) term.kill(signal);
        else pendingKill = signal;
      },
      on(event, cb) {
        emitter.on(event, cb as (payload: AgentEvent) => void);
      },
      off(event, cb) {
        emitter.off(event, cb as (payload: AgentEvent) => void);
      },
    };
    return handle;
  }
}
