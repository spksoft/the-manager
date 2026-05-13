"use client";

import { ChevronDownIcon, ChevronRightIcon, TagIcon } from "lucide-react";
import { useState } from "react";
import { useTags } from "../../../lib/hooks";

interface TagSectionProps {
  projectId: string;
}

export function TagSection({ projectId }: TagSectionProps) {
  const { data } = useTags(projectId);
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
        Tags ({count})
      </button>
      {open && (
        <ul className="flex flex-col border-t border-zinc-800">
          {(data ?? []).slice(0, 50).map((t) => (
            <li key={t.name} className="flex items-center gap-2 px-3 py-1.5 text-zinc-400">
              <TagIcon className="h-3 w-3 flex-shrink-0 text-zinc-600" />
              <span className="truncate">{t.name}</span>
            </li>
          ))}
          {count === 0 && <li className="px-3 py-1.5 text-[10px] text-zinc-600">No tags</li>}
        </ul>
      )}
    </div>
  );
}
