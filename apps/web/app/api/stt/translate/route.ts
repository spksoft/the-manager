import "server-only";
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { paths } from "@the-manager/persistence";
import { z } from "zod";
import { handleErr, jsonOk, parseJson } from "../../../../lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  text: z.string().min(1).max(4000),
});

const CLAUDE_BIN = process.env.THE_MANAGER_CLAUDE_BIN ?? "claude";

const PROMPT = (text: string) =>
  `Translate the following text to English. Output ONLY the translation as a single line of plain text — no quotes, no preamble, no explanation. If the text is already English, output it unchanged.\n\nTEXT:\n${text}`;

/**
 * One-shot `claude -p` call used by the mic input to translate non-English STT
 * results before they're injected into the terminal. Kept deliberately small:
 * no streaming, hard timeout, returns just the translated string.
 */
export async function POST(req: Request) {
  try {
    const { text } = await parseJson(req, Body);
    const cwd = paths.managerCwd();
    await mkdir(cwd, { recursive: true });
    const translated = await runClaudePrompt(PROMPT(text), cwd);
    return jsonOk({ text: translated });
  } catch (err) {
    return handleErr(err);
  }
}

function runClaudePrompt(prompt: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      CLAUDE_BIN,
      ["-p", prompt],
      {
        cwd,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        env: process.env,
      },
      (err, stdout, stderr) => {
        if (err) {
          const detail = stderr?.toString().trim() || err.message;
          reject(new Error(`claude -p failed: ${detail}`));
          return;
        }
        resolve(stdout.toString().trim());
      },
    );
    child.on("error", (e) => reject(e));
  });
}
