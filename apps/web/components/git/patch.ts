/**
 * Pure functions for assembling a minimal unified-diff patch from a subset of
 * hunks (or lines) of a larger diff. Output is consumed by `git apply --cached`
 * (or `--cached --reverse` for unstaging) on the server.
 *
 * We always emit `--unidiff-zero`-compatible patches: hunks have no context
 * lines when assembled from line selections, and the @@ headers carry the
 * recomputed old/new line counts. This matches `git apply --unidiff-zero`'s
 * requirements.
 */

export interface ParsedHunk {
  /** verbatim hunk header line, including the trailing context after `@@` */
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** body lines including the `+`/`-`/` ` prefix; no trailing newline per line */
  lines: string[];
}

export interface ParsedFile {
  /** Header lines verbatim: `diff --git ...`, optional `index ...`, `--- a/x`, `+++ b/x` */
  headerLines: string[];
  oldPath: string;
  newPath: string;
  hunks: ParsedHunk[];
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parse a unified diff text into per-file → per-hunk → per-line structure.
 * Tolerates multiple files in one diff.
 */
export function parseUnifiedDiff(text: string): ParsedFile[] {
  const lines = text.split("\n");
  const files: ParsedFile[] = [];
  let cur: ParsedFile | null = null;
  let curHunk: ParsedHunk | null = null;

  const flushHunk = () => {
    if (curHunk && cur) cur.hunks.push(curHunk);
    curHunk = null;
  };
  const flushFile = () => {
    flushHunk();
    if (cur) files.push(cur);
    cur = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i] ?? "";
    if (ln.startsWith("diff --git ")) {
      flushFile();
      // Parse old/new path from the diff --git header. Most commonly the
      // following ---/+++ lines carry the authoritative paths; we capture
      // header lines verbatim until the first @@ and parse paths from --- /
      // +++ lines.
      cur = { headerLines: [ln], oldPath: "", newPath: "", hunks: [] };
      continue;
    }
    if (!cur) continue;
    if (ln.startsWith("@@")) {
      flushHunk();
      const m = HUNK_HEADER_RE.exec(ln);
      if (!m) continue;
      curHunk = {
        header: ln,
        oldStart: Number.parseInt(m[1] ?? "0", 10),
        oldLines: m[2] ? Number.parseInt(m[2], 10) : 1,
        newStart: Number.parseInt(m[3] ?? "0", 10),
        newLines: m[4] ? Number.parseInt(m[4], 10) : 1,
        lines: [],
      };
      continue;
    }
    if (curHunk) {
      // Stop at "\\ No newline at end of file" — emit verbatim into the hunk body.
      if (ln.startsWith(" ") || ln.startsWith("+") || ln.startsWith("-") || ln.startsWith("\\")) {
        curHunk.lines.push(ln);
        continue;
      }
      // Anything else means the hunk body ended.
      flushHunk();
    }
    if (ln.startsWith("--- ")) {
      cur.headerLines.push(ln);
      cur.oldPath = ln.slice(4).replace(/^a\//, "");
      continue;
    }
    if (ln.startsWith("+++ ")) {
      cur.headerLines.push(ln);
      cur.newPath = ln.slice(4).replace(/^b\//, "");
      continue;
    }
    if (
      ln.startsWith("index ") ||
      ln.startsWith("new file") ||
      ln.startsWith("deleted file") ||
      ln.startsWith("similarity ") ||
      ln.startsWith("rename ") ||
      ln.startsWith("copy ") ||
      ln.startsWith("old mode") ||
      ln.startsWith("new mode")
    ) {
      cur.headerLines.push(ln);
    }
  }
  flushFile();
  return files;
}

/**
 * Reassemble a patch containing only the selected hunks of a file. The header
 * (diff --git / index / --- / +++) is copied verbatim from the parent file.
 */
export function buildHunkPatch(file: ParsedFile, hunkIndexes: number[]): string {
  if (hunkIndexes.length === 0) return "";
  const out: string[] = [...file.headerLines];
  for (const idx of hunkIndexes) {
    const h = file.hunks[idx];
    if (!h) continue;
    out.push(h.header);
    out.push(...h.lines);
  }
  return `${out.join("\n")}\n`;
}

/**
 * Build a patch from a subset of *lines* within a single hunk. The selected
 * lines are emitted as one or more synthetic hunks (split on contiguous runs
 * of selected `+`/`-` lines, separated by gaps). Each synthetic hunk has zero
 * context — that's why the server applies with `--unidiff-zero`.
 *
 * `selected`: an array of indexes into `hunk.lines` to KEEP. Only `+`/`-`
 * lines should be selected; ` ` (context) lines passed in are ignored.
 */
export function buildLinePatch(file: ParsedFile, hunk: ParsedHunk, selected: number[]): string {
  if (selected.length === 0) return "";
  const want = new Set(selected);

  // Walk the hunk; for each line, track running old/new line numbers so we
  // can emit synthetic hunk headers with correct positions.
  let oldLineNo = hunk.oldStart;
  let newLineNo = hunk.newStart;

  type Synthetic = {
    oldStart: number;
    newStart: number;
    body: string[];
    oldCount: number;
    newCount: number;
  };
  const synths: Synthetic[] = [];
  let cur: Synthetic | null = null;

  for (let i = 0; i < hunk.lines.length; i++) {
    const ln = hunk.lines[i] ?? "";
    const isCtx = ln.startsWith(" ");
    const isAdd = ln.startsWith("+");
    const isDel = ln.startsWith("-");
    const include = want.has(i) && (isAdd || isDel);

    if (include) {
      if (!cur) {
        cur = { oldStart: oldLineNo, newStart: newLineNo, body: [], oldCount: 0, newCount: 0 };
      }
      cur.body.push(ln);
      if (isAdd) cur.newCount++;
      else if (isDel) cur.oldCount++;
    } else if (cur) {
      synths.push(cur);
      cur = null;
    }

    // advance line counters AFTER deciding inclusion
    if (isCtx) {
      oldLineNo++;
      newLineNo++;
    } else if (isAdd) {
      newLineNo++;
    } else if (isDel) {
      oldLineNo++;
    }
  }
  if (cur) synths.push(cur);

  if (synths.length === 0) return "";

  const out: string[] = [...file.headerLines];
  for (const s of synths) {
    // For --unidiff-zero, the header form is `@@ -X,n +Y,m @@` with explicit
    // counts (counts of 0 are allowed for pure inserts / pure deletes).
    const oldStartHdr = s.oldCount === 0 ? Math.max(s.oldStart - 1, 0) : s.oldStart;
    const newStartHdr = s.newCount === 0 ? Math.max(s.newStart - 1, 0) : s.newStart;
    out.push(`@@ -${oldStartHdr},${s.oldCount} +${newStartHdr},${s.newCount} @@`);
    out.push(...s.body);
  }
  return `${out.join("\n")}\n`;
}
