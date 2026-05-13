import "server-only";

/**
 * Shared pty recording + attach helpers. Both `sessions.ts` (Claude singleton)
 * and `terminals.ts` (general-purpose shell multi-session) keep a bounded
 * recent-bytes ring buffer so a fresh xterm can replay the existing screen
 * state on attach. The buffer shape is identical across the two registries —
 * collected here so eviction / subscription logic stays in one place.
 */

export const MAX_RECORDING_BYTES = 1_000_000;

export type DataSubscriber = (chunk: string) => void;
export type ExitSubscriber = () => void;

export interface Recordable {
  recording: string[];
  recordingBytes: number;
  dataSubs: Set<DataSubscriber>;
  exitSubs: Set<ExitSubscriber>;
}

/**
 * Push `chunk` onto the recording, then evict oldest entries until the byte
 * total fits under the cap. Always keep at least one entry so a perpetual
 * stream of huge chunks doesn't leave the recording empty.
 */
export function appendChunk(session: Recordable, chunk: string): void {
  session.recording.push(chunk);
  session.recordingBytes += chunk.length;
  while (session.recordingBytes > MAX_RECORDING_BYTES && session.recording.length > 1) {
    const dropped = session.recording.shift();
    if (dropped) session.recordingBytes -= dropped.length;
  }
}

/**
 * Snapshot the current recording and subscribe to live output in a single
 * synchronous step — guarantees no chunk is duplicated or missed on attach.
 * The exit callback fires once when the pty terminates so the caller can
 * tear its transport down cleanly.
 */
export function attach(
  session: Recordable,
  onData: DataSubscriber,
  onExit: ExitSubscriber,
): { initial: string[]; unsubscribe: () => void } {
  const initial = session.recording.slice();
  session.dataSubs.add(onData);
  session.exitSubs.add(onExit);
  return {
    initial,
    unsubscribe: () => {
      session.dataSubs.delete(onData);
      session.exitSubs.delete(onExit);
    },
  };
}
