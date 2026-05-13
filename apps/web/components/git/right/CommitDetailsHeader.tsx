"use client";

import type { CommitDetails } from "@the-manager/git";
import { shortHash } from "../helpers";

interface CommitDetailsHeaderProps {
  commit: CommitDetails;
}

export function CommitDetailsHeader({ commit }: CommitDetailsHeaderProps) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3 text-xs">
      <div className="flex items-center gap-2">
        <code className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">
          {shortHash(commit.hash, 10)}
        </code>
        <span className="text-zinc-400">{commit.author.name}</span>
        <span className="text-zinc-600">·</span>
        <span className="text-zinc-500">{new Date(commit.date).toLocaleString()}</span>
      </div>
      <div className="mt-2 font-medium text-zinc-100">{commit.subject}</div>
      {commit.body && (
        <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] text-zinc-400">
          {commit.body}
        </pre>
      )}
      {commit.parents.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px] text-zinc-500">
          <span>Parents:</span>
          {commit.parents.map((p) => (
            <code key={p} className="rounded bg-zinc-900 px-1 font-mono text-zinc-400">
              {shortHash(p)}
            </code>
          ))}
        </div>
      )}
    </div>
  );
}
