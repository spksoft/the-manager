import { PtyAgentDriver } from "./pty-driver";

export class CodexDriver extends PtyAgentDriver {
  constructor() {
    super({
      id: "codex",
      command: process.env.THE_MANAGER_CODEX_BIN ?? "codex",
    });
  }
}
