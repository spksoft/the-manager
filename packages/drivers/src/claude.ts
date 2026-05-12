import { PtyAgentDriver } from "./pty-driver";

/**
 * Spawns the `claude` CLI under a pty so its TUI (status line, prompts, syntax
 * highlighting) renders identically to a user's terminal.
 *
 * The binary is resolved through PATH — users authenticate `claude` once on
 * their machine and we inherit that auth via the spawned process.
 */
export class ClaudeDriver extends PtyAgentDriver {
  constructor() {
    super({
      id: "claude",
      command: process.env.THE_MANAGER_CLAUDE_BIN ?? "claude",
    });
  }
}
