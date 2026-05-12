import { PtyAgentDriver } from "./pty-driver";

export class GeminiDriver extends PtyAgentDriver {
  constructor() {
    super({
      id: "gemini",
      command: process.env.THE_MANAGER_GEMINI_BIN ?? "gemini",
    });
  }
}
