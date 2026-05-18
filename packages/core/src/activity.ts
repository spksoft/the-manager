import type { DriverId } from "@the-manager/shared";

/**
 * Aggregate activity model used by the StatusStrip + ActivityPanel UI. Pure
 * types and reducers — the adapter layer (sessions.ts) maps live pty state
 * onto these shapes and the application layer streams the deltas to clients.
 */

export type SessionActivityState = "idle" | "working" | "needs_input";

export interface SessionActivity {
  /** "manager" or { projectId } so the UI can route clicks. */
  scope: "manager" | { projectId: string };
  driver: DriverId;
  state: SessionActivityState;
  /** ISO timestamp of the most recent stdout chunk. */
  lastActivityAt: string;
  /** First line of the most recent agent output, truncated to 120 chars. */
  preview: string | null;
  /** Display name for the UI — project name or "Manager". */
  label: string;
}

export interface AggregateActivity {
  /** needs_input > working > idle */
  worst: SessionActivityState;
  /** How many sessions are non-idle (working OR needs_input). */
  busyCount: number;
  sessions: SessionActivity[];
  generatedAt: string;
}

/**
 * Roll up per-session snapshots into one summary. Same input → same output.
 */
export function aggregate(snapshots: SessionActivity[]): AggregateActivity {
  let worst: SessionActivityState = "idle";
  let busy = 0;
  for (const s of snapshots) {
    if (s.state === "needs_input") {
      worst = "needs_input";
      busy++;
    } else if (s.state === "working") {
      if (worst !== "needs_input") worst = "working";
      busy++;
    }
  }
  return {
    worst,
    busyCount: busy,
    sessions: snapshots
      .slice()
      .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt)),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Extract a one-line preview from a tail of pty output. Strips ANSI escapes
 * and control chars, returns the last non-empty line truncated to 120 chars.
 */
const ANSI_CSI = new RegExp(`${String.fromCharCode(27)}\\[[\\d;?]*[ -/]*[@-~]`, "g");
const ANSI_OSC = new RegExp(
  `${String.fromCharCode(27)}\\][^${String.fromCharCode(7, 27)}]*(?:${String.fromCharCode(7)}|${String.fromCharCode(27)}\\\\)`,
  "g",
);
const ANSI_OTHER = new RegExp(`${String.fromCharCode(27)}[@-_][\\d;]*`, "g");
const CONTROL_BYTES = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(11)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
  "g",
);

export function extractPreview(recordingTail: string): string | null {
  if (!recordingTail) return null;
  const stripped = recordingTail
    .replace(ANSI_CSI, "")
    .replace(ANSI_OSC, "")
    .replace(ANSI_OTHER, "")
    .replace(/\r/g, "\n");
  const lines = stripped
    .split("\n")
    .map((l) => l.replace(CONTROL_BYTES, "").trim())
    .filter((l) => l.length > 0);
  const last = lines[lines.length - 1];
  if (!last) return null;
  return last.length > 120 ? `${last.slice(0, 117)}...` : last;
}
