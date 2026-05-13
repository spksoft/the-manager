"use client";

import { ArchiveIcon, ChevronDownIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { useStashes } from "../../../lib/hooks";
import { useGitActions } from "../GitActionsContext";
import { RowMenu } from "./RowMenu";

interface StashSectionProps {
  projectId: string;
}

export function StashSection({ projectId }: StashSectionProps) {
  const { data } = useStashes(projectId);
  const [open, setOpen] = useState(false);
  const count = data?.length ?? 0;
  const actions = useGitActions();

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/30">
      <div className="flex w-full items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium text-zinc-400">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-1.5 hover:text-zinc-200"
        >
          {open ? (
            <ChevronDownIcon className="h-3 w-3" />
          ) : (
            <ChevronRightIcon className="h-3 w-3" />
          )}
          Stash ({count})
        </button>
        <button
          type="button"
          onClick={() => actions.openStashSave()}
          aria-label="Save stash"
          className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        >
          <PlusIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && (
        <ul className="flex flex-col border-t border-zinc-800">
          {(data ?? []).map((s) => (
            <li
              key={s.index}
              className="flex items-center gap-2 px-3 py-1.5 text-zinc-400 hover:bg-zinc-900/60"
              title={s.message}
            >
              <ArchiveIcon className="h-3 w-3 flex-shrink-0 text-zinc-600" />
              <span className="flex-1 truncate">{s.message || `stash@{${s.index}}`}</span>
              <RowMenu
                ariaLabel={`Actions for stash@{${s.index}}`}
                items={[
                  { label: "Apply", onClick: () => void actions.stashApply(s.index, false) },
                  {
                    label: "Pop (apply + drop)",
                    onClick: () => void actions.stashApply(s.index, true),
                  },
                  { label: "Drop", danger: true, onClick: () => void actions.stashDrop(s.index) },
                ]}
              />
            </li>
          ))}
          {count === 0 && <li className="px-3 py-1.5 text-[10px] text-zinc-600">No stashes</li>}
        </ul>
      )}
    </div>
  );
}
