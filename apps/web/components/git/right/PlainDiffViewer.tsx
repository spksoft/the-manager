"use client";

interface PlainDiffViewerProps {
  path: string;
  diff: string;
  loading?: boolean;
}

/**
 * Read-only unified-diff renderer used for committed file diffs (where hunk
 * staging makes no sense). Working-tree diffs go through HunkDiffViewer.
 */
export function PlainDiffViewer({ path, diff, loading }: PlainDiffViewerProps) {
  return (
    <div className="animate-slide-up overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
      <div className="border-b border-zinc-800 px-3 py-1.5">
        <span className="font-mono text-[11px] text-zinc-300">{path}</span>
      </div>
      {loading ? (
        <div className="px-3 py-2 text-[11px] text-zinc-500">Loading…</div>
      ) : diff.trim().length === 0 ? (
        <div className="px-3 py-3 text-[11px] text-zinc-500">(no diff)</div>
      ) : (
        <pre className="overflow-x-auto px-3 pb-2 font-mono text-[11px] leading-relaxed">
          {diff.split("\n").map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: diff line index is its natural key
            <DiffLine key={i} line={line} />
          ))}
        </pre>
      )}
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
