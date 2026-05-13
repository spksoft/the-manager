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

export function shortHash(hash: string, n = 7): string {
  return hash.slice(0, n);
}

export interface ParsedRef {
  /** e.g. "main", "feature/x" */
  name: string;
  kind: "head" | "branch" | "remote" | "tag" | "other";
  /** true for the ref pointed at by `HEAD ->` */
  isHead?: boolean;
}

/**
 * Parse `%D` decoration output: "HEAD -> main, origin/main, tag: v1.0".
 */
export function parseRefDecoration(refs: string[]): ParsedRef[] {
  return refs
    .map((raw): ParsedRef | null => {
      const t = raw.trim();
      if (!t) return null;
      if (t.startsWith("HEAD -> ")) {
        return { name: t.slice("HEAD -> ".length), kind: "branch", isHead: true };
      }
      if (t === "HEAD") return { name: "HEAD", kind: "head" };
      if (t.startsWith("tag: ")) return { name: t.slice("tag: ".length), kind: "tag" };
      if (t.includes("/")) return { name: t, kind: "remote" };
      return { name: t, kind: "branch" };
    })
    .filter((x): x is ParsedRef => x !== null);
}

export function formatAheadBehind(ahead: number, behind: number): string {
  if (ahead === 0 && behind === 0) return "";
  const parts: string[] = [];
  if (ahead > 0) parts.push(`↑${ahead}`);
  if (behind > 0) parts.push(`↓${behind}`);
  return parts.join(" ");
}

/**
 * Hook: true when viewport is below the md breakpoint (768px). Used to gate
 * mobile-only behaviors such as auto-opening the diff sheet on file selection.
 * SSR-safe — returns false during the initial render and updates on mount.
 */
import { useEffect, useState } from "react";

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isMobile;
}
