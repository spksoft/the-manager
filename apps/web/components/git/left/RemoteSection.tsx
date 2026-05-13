"use client";

import { ChevronDownIcon, ChevronRightIcon, CloudIcon } from "lucide-react";
import { useState } from "react";
import { useRemotes } from "../../../lib/hooks";

interface RemoteSectionProps {
  projectId: string;
}

export function RemoteSection({ projectId }: RemoteSectionProps) {
  const { data } = useRemotes(projectId);
  const [open, setOpen] = useState(false);
  const count = data?.length ?? 0;

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium text-zinc-400 hover:text-zinc-200"
      >
        {open ? <ChevronDownIcon className="h-3 w-3" /> : <ChevronRightIcon className="h-3 w-3" />}
        Remotes ({count})
      </button>
      {open && (
        <ul className="flex flex-col border-t border-zinc-800">
          {(data ?? []).map((r) => (
            <li
              key={r.name}
              className="flex items-center gap-2 px-3 py-1.5 text-zinc-400"
              title={r.fetchUrl}
            >
              <CloudIcon className="h-3 w-3 flex-shrink-0 text-zinc-600" />
              <span className="truncate">{r.name}</span>
            </li>
          ))}
          {count === 0 && <li className="px-3 py-1.5 text-[10px] text-zinc-600">No remotes</li>}
        </ul>
      )}
    </div>
  );
}
