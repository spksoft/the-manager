/**
 * Porcelain "X" column reads as ' ' (unchanged in index), '?' (untracked),
 * or a single letter for staged add/mod/del/rename. Anything else means
 * "file has staged changes" — the checkbox in WorkingTreeList tracks this.
 */
export function isStaged(index: string): boolean {
  return index !== "" && index !== " " && index !== "?";
}

export function shortDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return dateStr.slice(0, 10);
  }
}
