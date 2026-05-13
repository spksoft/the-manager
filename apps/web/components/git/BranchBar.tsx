"use client";

interface BranchBarProps {
  branch: string | null;
  ahead: number;
  behind: number;
  tracking: string | null;
}

export function BranchBar({ branch, ahead, behind, tracking }: BranchBarProps) {
  return (
    <section className="flex flex-col gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="font-mono text-sm text-zinc-100">
          {branch ?? <span className="text-zinc-500">no commits yet</span>}
        </span>
        <div className="flex gap-2 text-xs text-zinc-500">
          {ahead > 0 && <span className="text-emerald-400">↑{ahead}</span>}
          {behind > 0 && <span className="text-amber-400">↓{behind}</span>}
          {tracking && <span className="text-zinc-500">tracking {tracking}</span>}
        </div>
      </div>
    </section>
  );
}
