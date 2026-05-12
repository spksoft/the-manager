import type { DriverId } from "@the-manager/shared";

/**
 * Print-mode driver: a CLI agent (e.g. `claude -p`) that takes a prompt as
 * input and emits a stream of structured events until done. Conversation
 * continuity is the driver's responsibility — callers pass a stable
 * `conversationId` (a UUID we own) on every call.
 *
 * This is intentionally different from `AgentDriver`, which models long-lived
 * interactive pty sessions. Print-mode is the better fit for chat-style
 * surfaces where each user message is a discrete request/response.
 */
export interface PromptInput {
  /** Working directory the CLI runs in. Must be absolute. */
  cwd: string;
  /** User prompt to send. */
  prompt: string;
  /** Stable conversation UUID. First call creates the session; subsequent calls resume it. */
  conversationId: string;
  /** True if this is the first message in the conversation (use --session-id). */
  firstMessage: boolean;
  /** Environment overrides on top of process.env. */
  env?: Record<string, string>;
  /** Abort signal — when fired, the underlying process is killed. */
  signal?: AbortSignal;
}

export type PromptEvent =
  /** Conversation metadata from the agent's init event. */
  | { type: "session"; conversationId: string; cwd: string; model: string | null }
  /** Plain text the assistant produced (one block at a time without partial-message support). */
  | { type: "text"; text: string }
  /** Assistant decided to call a tool. */
  | { type: "tool_use"; id: string; name: string; input: unknown }
  /** A tool finished — content can be a string, array of blocks, or arbitrary JSON. */
  | { type: "tool_result"; toolUseId: string; content: unknown; isError: boolean }
  /** Final result; `text` is the agent's last-message text (helpful for non-stream UIs). */
  | { type: "result"; ok: boolean; durationMs: number; costUsd: number | null; text: string }
  /** Any non-fatal info we choose to surface (rate limits, hook errors, etc.). */
  | { type: "info"; message: string }
  /** Fatal stream error — the agent will not produce more events after this. */
  | { type: "error"; message: string };

export interface PromptDriver {
  readonly id: DriverId;
  prompt(input: PromptInput): AsyncIterable<PromptEvent>;
}
