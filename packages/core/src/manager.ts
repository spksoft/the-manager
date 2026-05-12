import { NotImplementedError } from "@the-manager/shared";

/**
 * The Manager is a privileged Claude agent that lives at the app level.
 * It has its own working directory and orchestrates per-project agents.
 *
 * Phase 0: only the type surface is defined. Real dispatch is Phase 4.
 */
export interface ManagerService {
  /** Working directory the Manager agent runs in. */
  readonly cwd: string;

  /** Send a command/prompt to the Manager. Returns a task id once Phase 4 lands. */
  send(input: string): Promise<{ taskId: string }>;
}

export class ManagerServiceStub implements ManagerService {
  constructor(readonly cwd: string) {}
  send(_input: string): Promise<{ taskId: string }> {
    throw new NotImplementedError("ManagerService.send");
  }
}
