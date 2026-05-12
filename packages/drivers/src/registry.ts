import type { DriverId } from "@the-manager/shared";
import { NotFoundError } from "@the-manager/shared";
import { ClaudeDriver } from "./claude";
import { CodexDriver } from "./codex";
import type { AgentDriver } from "./driver";
import { GeminiDriver } from "./gemini";

/**
 * Lookup table for the active driver implementations. Callers should always go
 * through `getDriver(id)` rather than constructing drivers directly — this is
 * where future feature flags / version pinning would live.
 */
const drivers: Record<DriverId, AgentDriver> = {
  claude: new ClaudeDriver(),
  codex: new CodexDriver(),
  gemini: new GeminiDriver(),
};

export function getDriver(id: DriverId): AgentDriver {
  const d = drivers[id];
  if (!d) throw new NotFoundError("AgentDriver", id);
  return d;
}

export function listDriverIds(): DriverId[] {
  return Object.keys(drivers) as DriverId[];
}
