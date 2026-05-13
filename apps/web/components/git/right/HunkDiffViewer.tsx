"use client";

import { useMemo, useState } from "react";
import { buildHunkPatch, buildLinePatch, parseUnifiedDiff } from "../patch";

interface HunkDiffViewerProps {
  path: string;
  staged: string;
  unstaged: string;
  loading: boolean;
  busy: boolean;
  onStageHunkPatch: (patch: string) => Promise<void>;
  onUnstageHunkPatch: (patch: string) => Promise<void>;
  onClose: () => void;
}

/**
 * Working-tree diff viewer with hunk- and line-level stage controls.
 *
 * Layout matches the prior DiffViewer (separate "Unstaged" + "Staged" panes)
 * but each hunk header carries a [Stage] / [Unstage] button. Click a line to
 * toggle line-level selection; the per-pane "Stage selection" button applies
 * the synthetic line patch.
 */
export function HunkDiffViewer({
  path,
  staged,
  unstaged,
  loading,
  busy,
  onStageHunkPatch,
  onUnstageHunkPatch,
  onClose,
}: HunkDiffViewerProps) {
  return (
    <div className="animate-slide-up overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
        <span className="truncate font-mono text-[11px] text-zinc-300">{path}</span>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-zinc-500 hover:text-zinc-300"
          aria-label="Close diff view"
        >
          Close
        </button>
      </div>
      {loading ? (
        <div className="px-3 py-2 text-[11px] text-zinc-500">Loading diff…</div>
      ) : (
        <div className="flex flex-col">
          {unstaged.trim().length > 0 && (
            <DiffPane
              label="Unstaged"
              text={unstaged}
              actionLabel="Stage hunk"
              actionSelectionLabel="Stage selection"
              busy={busy}
              onAction={onStageHunkPatch}
            />
          )}
          {staged.trim().length > 0 && (
            <DiffPane
              label="Staged"
              text={staged}
              actionLabel="Unstage hunk"
              actionSelectionLabel="Unstage selection"
              busy={busy}
              onAction={onUnstageHunkPatch}
            />
          )}
          {unstaged.trim().length === 0 && staged.trim().length === 0 && (
            <div className="px-3 py-3 text-[11px] text-zinc-500">
              No diff against HEAD — likely a brand-new untracked file. Stage it from the file list
              to see a diff.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface DiffPaneProps {
  label: string;
  text: string;
  actionLabel: string;
  actionSelectionLabel: string;
  busy: boolean;
  onAction: (patch: string) => Promise<void>;
}

function DiffPane({
  label,
  text,
  actionLabel,
  actionSelectionLabel,
  busy,
  onAction,
}: DiffPaneProps) {
  const files = useMemo(() => parseUnifiedDiff(text), [text]);
  // Per (fileIdx-hunkIdx) keep a set of selected line indexes within the hunk.
  const [selected, setSelected] = useState<Record<string, Set<number>>>({});

  const toggleLine = (fileIdx: number, hunkIdx: number, lineIdx: number) => {
    setSelected((prev) => {
      const key = `${fileIdx}-${hunkIdx}`;
      const next = new Set(prev[key] ?? []);
      if (next.has(lineIdx)) next.delete(lineIdx);
      else next.add(lineIdx);
      const out = { ...prev };
      if (next.size === 0) delete out[key];
      else out[key] = next;
      return out;
    });
  };

  return (
    <div className="border-b border-zinc-900 last:border-0">
      <div className="flex items-center justify-between px-3 py-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          {label}
        </span>
      </div>
      <div className="flex flex-col">
        {files.map((file, fIdx) => (
          <div key={`${file.oldPath}::${file.newPath}`} className="flex flex-col">
            {file.hunks.map((hunk, hIdx) => {
              const key = `${fIdx}-${hIdx}`;
              const sel = selected[key];
              return (
                <div key={`${file.newPath}-h-${hunk.header}`} className="border-t border-zinc-900">
                  <div className="flex items-center justify-between bg-zinc-900/40 px-3 py-1">
                    <code className="truncate font-mono text-[10px] text-cyan-400">
                      {hunk.header}
                    </code>
                    <div className="flex flex-shrink-0 gap-2">
                      {sel && sel.size > 0 && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            const patch = buildLinePatch(file, hunk, Array.from(sel));
                            if (patch) {
                              void onAction(patch).then(() => {
                                setSelected((prev) => {
                                  const out = { ...prev };
                                  delete out[key];
                                  return out;
                                });
                              });
                            }
                          }}
                          className="rounded bg-amber-600/20 px-2 py-0.5 text-[10px] text-amber-300 hover:bg-amber-600/30 disabled:opacity-50"
                        >
                          {actionSelectionLabel} ({sel.size})
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          const patch = buildHunkPatch(file, [hIdx]);
                          if (patch) void onAction(patch);
                        }}
                        className="rounded bg-emerald-600/20 px-2 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-600/30 disabled:opacity-50"
                      >
                        {actionLabel}
                      </button>
                    </div>
                  </div>
                  <pre className="overflow-x-auto px-3 pb-1 font-mono text-[11px] leading-relaxed">
                    {hunk.lines.map((ln, lIdx) => {
                      const isAdd = ln.startsWith("+");
                      const isDel = ln.startsWith("-");
                      const selectable = isAdd || isDel;
                      const isSel = !!sel?.has(lIdx);
                      const cls = isAdd
                        ? "text-emerald-300"
                        : isDel
                          ? "text-red-300"
                          : ln.startsWith("\\")
                            ? "text-zinc-500"
                            : "text-zinc-400";
                      return (
                        <button
                          // biome-ignore lint/suspicious/noArrayIndexKey: hunk lines are positional
                          key={lIdx}
                          type="button"
                          onClick={selectable ? () => toggleLine(fIdx, hIdx, lIdx) : undefined}
                          disabled={!selectable}
                          className={`block w-full whitespace-pre px-1 text-left transition-colors ${cls} ${isSel ? "bg-amber-500/15" : selectable ? "hover:bg-zinc-900/60" : ""}`}
                        >
                          {ln || " "}
                        </button>
                      );
                    })}
                  </pre>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
