import { createReadStream } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import type { ProjectId, SessionId } from "@the-manager/shared";
import { paths } from "../paths";
import { type TranscriptLine, TranscriptLineSchema } from "../schemas";

/**
 * Transcripts are append-only JSONL — one line per event. We never rewrite the
 * whole file: appending a line is O(1) and crash-safe (partial last lines are
 * ignored on read).
 */
export class TranscriptRepo {
  async append(projectId: ProjectId, sessionId: SessionId, line: TranscriptLine): Promise<void> {
    const validated = TranscriptLineSchema.parse(line);
    const file = paths.sessionTranscript(projectId, sessionId);
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(validated)}\n`, "utf8");
  }

  /**
   * Stream existing lines. Skips a malformed trailing line (which can happen
   * if the process was killed mid-append). Yields nothing if the file is
   * missing.
   */
  async *read(projectId: ProjectId, sessionId: SessionId): AsyncGenerator<TranscriptLine> {
    const file = paths.sessionTranscript(projectId, sessionId);
    let stream: ReturnType<typeof createReadStream>;
    try {
      stream = createReadStream(file, { encoding: "utf8" });
    } catch {
      return;
    }
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const raw of rl) {
      if (raw.length === 0) continue;
      try {
        yield TranscriptLineSchema.parse(JSON.parse(raw));
      } catch {
        // partial / corrupt last line — ignore
      }
    }
  }
}
