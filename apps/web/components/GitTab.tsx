"use client";

import { cn } from "@the-manager/ui";
import { useState } from "react";
import { useGit, useGitFileDiff } from "../lib/hooks";
import { ErrorBanner } from "./ErrorBanner";

interface GitTabProps {
  projectId: string;
}

export function GitTab({ projectId }: GitTabProps) {
  const { data, error, isLoading } = useGit(projectId);
  const [diffPath, setDiffPath] = useState<string | null>(null);
  const { data: diff, isLoading: diffLoading } = useGitFileDiff(projectId, diffPath);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {[...Array(3)].map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton
          <div key={i} className="h-6 animate-pulse rounded bg-zinc-800" />
        ))}
      </div>
    );
  }

  if (error) return <ErrorBanner message={`Git error: ${String(error)}`} />;

  if (!data) return null;

  if (!data.isRepo) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-zinc-500">
        Not a git repository
      </div>
    );
  }

  const { branch, status, log } = data;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      {/* Branch info */}
      <section className="flex flex-col gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm text-zinc-100">
            {branch ?? <span className="text-zinc-500">no commits yet</span>}
          </span>
          {status && (
            <div className="flex gap-2 text-xs text-zinc-500">
              {status.ahead > 0 && <span className="text-emerald-400">↑{status.ahead}</span>}
              {status.behind > 0 && <span className="text-amber-400">↓{status.behind}</span>}
              {status.tracking && <span className="text-zinc-500">tracking {status.tracking}</span>}
            </div>
          )}
        </div>
      </section>

      {/* Status files */}
      {status && status.files.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Working tree ({status.files.length})
          </h3>
          <div className="overflow-hidden rounded-lg border border-zinc-800">
            {status.files.map((f) => {
              const selected = diffPath === f.path;
              return (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => setDiffPath(selected ? null : f.path)}
                  className={cn(
                    "flex w-full items-center gap-3 border-b border-zinc-900 px-3 py-1.5 text-left transition-colors last:border-0",
                    selected ? "bg-zinc-800/70" : "hover:bg-zinc-900/60",
                  )}
                  aria-expanded={selected}
                  aria-label={`Toggle diff for ${f.path}`}
                >
                  <StatusCode index={f.index} working={f.working_dir} />
                  <span className="flex-1 font-mono text-xs text-zinc-300">{f.path}</span>
                  <span className="text-[10px] text-zinc-600">{selected ? "▾" : "▸"}</span>
                </button>
              );
            })}
          </div>
          {diffPath && (
            <div className="animate-slide-up overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
              <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
                <span className="font-mono text-[11px] text-zinc-300">{diffPath}</span>
                <button
                  type="button"
                  onClick={() => setDiffPath(null)}
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                  aria-label="Close diff view"
                >
                  Close
                </button>
              </div>
              {diffLoading && (
                <div className="px-3 py-2 text-[11px] text-zinc-500">Loading diff…</div>
              )}
              {!diffLoading && diff && <DiffPanes staged={diff.staged} unstaged={diff.unstaged} />}
            </div>
          )}
        </section>
      )}

      {status && status.files.length === 0 && (
        <p className="text-xs text-zinc-600">Working tree clean</p>
      )}

      {/* Log */}
      {log.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Recent commits
          </h3>
          <div className="overflow-hidden rounded-lg border border-zinc-800">
            {log.slice(0, 20).map((entry) => (
              <div
                key={entry.hash}
                className="flex items-baseline gap-3 border-b border-zinc-900 px-3 py-1.5 last:border-0"
              >
                <span className="w-14 flex-shrink-0 font-mono text-[11px] text-zinc-500">
                  {entry.hash.slice(0, 7)}
                </span>
                <span className="w-28 flex-shrink-0 text-[11px] text-zinc-500">
                  {shortDate(entry.date)}
                </span>
                <span className="flex-1 truncate text-xs text-zinc-200">{entry.message}</span>
                <span className="flex-shrink-0 text-[11px] text-zinc-500">{entry.author}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function DiffPanes({ staged, unstaged }: { staged: string; unstaged: string }) {
  const hasStaged = staged.trim().length > 0;
  const hasUnstaged = unstaged.trim().length > 0;
  if (!hasStaged && !hasUnstaged) {
    return (
      <div className="px-3 py-3 text-[11px] text-zinc-500">
        No diff against HEAD — likely a brand-new untracked file. Stage it to see a diff.
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      {hasUnstaged && <DiffBlock label="Unstaged" body={unstaged} />}
      {hasStaged && <DiffBlock label="Staged" body={staged} />}
    </div>
  );
}

function DiffBlock({ label, body }: { label: string; body: string }) {
  return (
    <div className="border-b border-zinc-900 last:border-0">
      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <pre className="overflow-x-auto px-3 pb-2 font-mono text-[11px] leading-relaxed">
        {body.split("\n").map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are positional; index is the natural key
          <DiffLine key={i} line={line} />
        ))}
      </pre>
    </div>
  );
}

function DiffLine({ line }: { line: string }) {
  let cls = "text-zinc-400";
  if (line.startsWith("+++") || line.startsWith("---")) cls = "text-zinc-500";
  else if (line.startsWith("@@")) cls = "text-cyan-400";
  else if (line.startsWith("+")) cls = "text-emerald-300";
  else if (line.startsWith("-")) cls = "text-red-300";
  else if (line.startsWith("diff ") || line.startsWith("index ")) cls = "text-zinc-600";
  return <span className={`block whitespace-pre ${cls}`}>{line || " "}</span>;
}

function StatusCode({ index, working }: { index: string; working: string }) {
  const staged = index.trim() !== "" && index !== "?";
  const modified = working.trim() !== "" && working !== "?";
  const untracked = index === "?" || working === "?";

  return (
    <span className="flex w-6 gap-0.5 font-mono text-[11px]">
      <span className={cn("w-3", staged ? "text-emerald-400" : "text-zinc-700")}>
        {index || " "}
      </span>
      <span
        className={cn(
          "w-3",
          untracked ? "text-zinc-500" : modified ? "text-amber-400" : "text-zinc-700",
        )}
      >
        {working || " "}
      </span>
    </span>
  );
}

function shortDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return dateStr.slice(0, 10);
  }
}
