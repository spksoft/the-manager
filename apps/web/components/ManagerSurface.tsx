"use client";

import { MANAGER_PROJECT_ID } from "../lib/manager-id";
import { TerminalView } from "./TerminalView";

/**
 * The Manager is an interactive `claude` REPL running in the dedicated
 * `~/.the-manager/manager/cwd` directory. The pty stays alive across page
 * loads — TerminalView attaches to the existing session and replays its
 * recent output, so users see the conversation they left.
 */
export function ManagerSurface() {
  return <TerminalView projectId={MANAGER_PROJECT_ID} />;
}
