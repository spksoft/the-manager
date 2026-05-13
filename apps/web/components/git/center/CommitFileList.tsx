"use client";

import type { CommitFileChange } from "@the-manager/git";

interface CommitFileListProps {
  files: CommitFileChange[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

const STATUS_LABEL: Record<CommitFileChange["status"], { ch: string; cls: string }> = {
  A: { ch: "A", cls: "text-emerald-400" },
  M: { ch: "M", cls: "text-amber-400" },
  D: { ch: "D", cls: "text-red-400" },
  R: { ch: "R", cls: "text-blue-400" },
  C: { ch: "C", cls: "text-blue-400" },
  T: { ch: "T", cls: "text-zinc-400" },
};

export function CommitFileList({ files, selectedPath, onSelect }: CommitFileListProps) {
  if (files.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3 text-xs text-zinc-500">
        No files in this commit.
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-col rounded-lg border border-zinc-800 bg-zinc-900/30">
      <div className="border-b border-zinc-800 px-3 py-2 text-[11px] font-medium text-zinc-400">
        Files ({files.length})
      </div>
      <ul className="min-h-0 overflow-y-auto">
        {files.map((f) => {
          const lab = STATUS_LABEL[f.status] ?? { ch: "?", cls: "text-zinc-500" };
          return (
            <li key={`${f.status}-${f.path}`}>
              <button
                type="button"
                onClick={() => onSelect(f.path)}
                className={`flex w-full items-center gap-2 px-3 py-1 text-left text-xs transition-colors ${
                  selectedPath === f.path
                    ? "bg-zinc-900 text-zinc-100"
                    : "text-zinc-300 hover:bg-zinc-900/60"
                }`}
              >
                <span className={`flex-shrink-0 font-mono text-[10px] ${lab.cls}`}>{lab.ch}</span>
                <span className="truncate">{f.path}</span>
                {f.renameFrom && (
                  <span className="ml-auto truncate text-[10px] text-zinc-600">
                    ← {f.renameFrom}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
