"use client";

import type { GitLogEntry } from "../../lib/hooks";
import { shortDate } from "./helpers";

interface LogListProps {
  entries: GitLogEntry[];
  /** Cap on the rendered count. The API returns up to 50; UI shows 20 by default. */
  limit?: number;
}

export function LogList({ entries, limit = 20 }: LogListProps) {
  if (entries.length === 0) return null;
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Recent commits
      </h3>
      <div className="overflow-hidden rounded-lg border border-zinc-800">
        {entries.slice(0, limit).map((entry) => (
          <div
            key={entry.hash}
            className="flex items-baseline gap-2 border-b border-zinc-900 px-3 py-1.5 last:border-0 md:gap-3"
          >
            <span className="w-14 flex-shrink-0 font-mono text-[11px] text-zinc-500">
              {entry.hash.slice(0, 7)}
            </span>
            <span className="hidden w-28 flex-shrink-0 text-[11px] text-zinc-500 md:inline">
              {shortDate(entry.date)}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-zinc-200">{entry.message}</span>
            <span className="hidden flex-shrink-0 text-[11px] text-zinc-500 md:inline">
              {entry.author}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
