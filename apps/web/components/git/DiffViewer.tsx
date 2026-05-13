"use client";

interface DiffViewerProps {
  path: string;
  staged: string;
  unstaged: string;
  loading: boolean;
  onClose: () => void;
}

export function DiffViewer({ path, staged, unstaged, loading, onClose }: DiffViewerProps) {
  const hasStaged = staged.trim().length > 0;
  const hasUnstaged = unstaged.trim().length > 0;

  return (
    <div className="animate-slide-up overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
        <span className="font-mono text-[11px] text-zinc-300">{path}</span>
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
      ) : !hasStaged && !hasUnstaged ? (
        <div className="px-3 py-3 text-[11px] text-zinc-500">
          No diff against HEAD — likely a brand-new untracked file. Stage it to see a diff.
        </div>
      ) : (
        <div className="flex flex-col">
          {hasUnstaged && <DiffBlock label="Unstaged" body={unstaged} />}
          {hasStaged && <DiffBlock label="Staged" body={staged} />}
        </div>
      )}
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
