"use client";

import { cn } from "@the-manager/ui";
import type { GitStatusFile } from "../../lib/hooks";
import { isStaged } from "./helpers";

interface WorkingTreeListProps {
  files: GitStatusFile[];
  selectedPath: string | null;
  stageBusy: boolean;
  onToggleStage: (path: string, currentlyStaged: boolean) => void;
  onSelectDiff: (path: string) => void;
  onStageAll: () => void;
  onUnstageAll: () => void;
}

export function WorkingTreeList({
  files,
  selectedPath,
  stageBusy,
  onToggleStage,
  onSelectDiff,
  onStageAll,
  onUnstageAll,
}: WorkingTreeListProps) {
  const stagedCount = files.filter((f) => isStaged(f.index)).length;
  const unstagedCount = files.length - stagedCount;

  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Working tree ({files.length})
        </h3>
        <div className="flex gap-2 text-[11px]">
          <button
            type="button"
            onClick={onStageAll}
            disabled={unstagedCount === 0 || stageBusy}
            className="text-emerald-400 hover:text-emerald-300 disabled:text-zinc-700"
          >
            Stage all
          </button>
          <span className="text-zinc-700">·</span>
          <button
            type="button"
            onClick={onUnstageAll}
            disabled={stagedCount === 0 || stageBusy}
            className="text-zinc-400 hover:text-zinc-200 disabled:text-zinc-700"
          >
            Unstage all
          </button>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-zinc-800">
        {files.map((f) => {
          const selected = selectedPath === f.path;
          const staged = isStaged(f.index);
          return (
            <div
              key={f.path}
              className={cn(
                "flex w-full items-center gap-2 border-b border-zinc-900 px-3 py-1.5 last:border-0",
                selected ? "bg-zinc-800/70" : "hover:bg-zinc-900/60",
              )}
            >
              <input
                type="checkbox"
                checked={staged}
                disabled={stageBusy}
                onChange={() => onToggleStage(f.path, staged)}
                aria-label={staged ? `Unstage ${f.path}` : `Stage ${f.path}`}
                className="h-3.5 w-3.5 cursor-pointer accent-emerald-500"
              />
              <button
                type="button"
                onClick={() => onSelectDiff(f.path)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                aria-expanded={selected}
                aria-label={`Toggle diff for ${f.path}`}
              >
                <StatusCode index={f.index} working={f.working_dir} />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-300">
                  {f.path}
                </span>
                <span className="flex-shrink-0 text-[10px] text-zinc-600">
                  {selected ? "▾" : "▸"}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
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
