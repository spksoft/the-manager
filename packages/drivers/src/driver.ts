import type { DriverId } from "@the-manager/shared";

export interface SpawnOptions {
  /** Working directory the CLI runs in. Must be absolute. */
  cwd: string;
  /** Environment overrides on top of process.env. */
  env?: Record<string, string>;
  /** Extra command-line arguments to pass to the CLI. */
  args?: string[];
  /** Initial pty dimensions. If omitted, the driver picks sensible defaults. */
  pty?: { cols: number; rows: number };
}

export type AgentEvent =
  | { type: "data"; chunk: string }
  | { type: "exit"; code: number | null; signal: NodeJS.Signals | null }
  | { type: "error"; error: Error };

export type AgentEventName = AgentEvent["type"];

export interface AgentHandle {
  readonly pid: number;
  /** Write text to the CLI's stdin (keystrokes, prompt input). */
  write(data: string): void;
  /** Resize the pty. No-op if the driver isn't pty-backed. */
  resize(cols: number, rows: number): void;
  /** Send a signal (default SIGTERM). */
  kill(signal?: NodeJS.Signals): void;
  on<E extends AgentEventName>(
    event: E,
    cb: (payload: Extract<AgentEvent, { type: E }>) => void,
  ): void;
  off<E extends AgentEventName>(
    event: E,
    cb: (payload: Extract<AgentEvent, { type: E }>) => void,
  ): void;
}

/**
 * The chokepoint for ALL CLI interaction. UI and Route Handlers must depend on
 * this interface, never on node-pty or a specific binary name. New CLI agents
 * (Codex, Gemini, etc.) plug in by implementing this one interface.
 */
export interface AgentDriver {
  readonly id: DriverId;
  spawn(opts: SpawnOptions): AgentHandle;
}
