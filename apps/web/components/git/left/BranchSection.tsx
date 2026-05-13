"use client";

import { ChevronDownIcon, ChevronRightIcon, GitBranchIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { useBranches } from "../../../lib/hooks";
import { useGitActions } from "../GitActionsContext";
import { formatAheadBehind } from "../helpers";
import { RowMenu } from "./RowMenu";

interface BranchSectionProps {
  projectId: string;
}

export function BranchSection({ projectId }: BranchSectionProps) {
  const { data } = useBranches(projectId);
  const [openLocal, setOpenLocal] = useState(true);
  const [openRemote, setOpenRemote] = useState(false);
  const actions = useGitActions();

  if (!data) return <Skeleton />;

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/30">
      <Header
        label={`Local (${data.local.length})`}
        open={openLocal}
        onToggle={() => setOpenLocal((v) => !v)}
        trailing={
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              actions.openCreateBranch();
            }}
            aria-label="Create branch"
            className="ml-auto rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          >
            <PlusIcon className="h-3.5 w-3.5" />
          </button>
        }
      />
      {openLocal && (
        <ul className="flex flex-col">
          {data.local.map((b) => (
            <li
              key={b.name}
              className={`group flex items-center gap-2 px-3 py-1.5 ${b.current ? "bg-zinc-900 text-zinc-100" : "text-zinc-300 hover:bg-zinc-900/60"}`}
            >
              <button
                type="button"
                onDoubleClick={() => {
                  if (!b.current) void actions.checkout(b.name);
                }}
                className="flex flex-1 items-center gap-2 truncate text-left"
                title={b.current ? "Current branch" : "Double-click to checkout"}
              >
                <GitBranchIcon className="h-3 w-3 flex-shrink-0 text-zinc-500" />
                <span className="truncate">{b.name}</span>
              </button>
              {b.current ? (
                <span className="text-[10px] uppercase tracking-wide text-emerald-400">
                  current
                </span>
              ) : (
                (b.ahead > 0 || b.behind > 0) && (
                  <span className="text-[10px] text-zinc-500">
                    {formatAheadBehind(b.ahead, b.behind)}
                  </span>
                )
              )}
              <RowMenu
                ariaLabel={`Actions for ${b.name}`}
                items={[
                  ...(b.current
                    ? []
                    : [{ label: "Checkout", onClick: () => void actions.checkout(b.name) }]),
                  {
                    label: "Create branch here…",
                    onClick: () => actions.openCreateBranch(b.name, b.name),
                  },
                  { label: "Rename…", onClick: () => actions.openRenameBranch(b.name) },
                  ...(b.current
                    ? []
                    : [{ label: "Merge into current…", onClick: () => actions.openMerge(b.name) }]),
                  {
                    label: "Delete…",
                    danger: true,
                    disabled: b.current,
                    onClick: () => actions.openDeleteBranch(b.name),
                  },
                ]}
              />
            </li>
          ))}
          {data.local.length === 0 && (
            <li className="px-3 py-1.5 text-[10px] text-zinc-600">No branches</li>
          )}
        </ul>
      )}
      <Header
        label={`Remote (${data.remote.length})`}
        open={openRemote}
        onToggle={() => setOpenRemote((v) => !v)}
        bordered
      />
      {openRemote && (
        <ul className="flex flex-col">
          {data.remote.map((b) => (
            <li
              key={b.name}
              className="group flex items-center gap-2 px-3 py-1.5 text-zinc-400 hover:bg-zinc-900/60"
            >
              <span className="flex flex-1 items-center gap-2 truncate">
                <GitBranchIcon className="h-3 w-3 flex-shrink-0 text-zinc-600" />
                <span className="truncate">{b.name}</span>
              </span>
              <RowMenu
                ariaLabel={`Actions for ${b.name}`}
                items={[
                  {
                    label: "Checkout (detached)",
                    onClick: () => void actions.checkout(b.name),
                  },
                  {
                    label: "Create local branch from here…",
                    onClick: () => actions.openCreateBranch(b.name, b.name),
                  },
                  ...(b.name.includes("/")
                    ? [
                        {
                          label: "Delete on remote…",
                          danger: true,
                          onClick: () => {
                            const [remote, ...rest] = b.name.split("/");
                            const branch = rest.join("/");
                            if (remote && branch) actions.openDeleteBranch(branch, remote);
                          },
                        },
                      ]
                    : []),
                ]}
              />
            </li>
          ))}
          {data.remote.length === 0 && (
            <li className="px-3 py-1.5 text-[10px] text-zinc-600">No remote branches</li>
          )}
        </ul>
      )}
    </div>
  );
}

function Header({
  label,
  open,
  onToggle,
  bordered,
  trailing,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  bordered?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <div
      className={`flex w-full items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium text-zinc-400 ${bordered ? "border-t border-zinc-800" : ""}`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex flex-1 items-center gap-1.5 hover:text-zinc-200"
      >
        {open ? <ChevronDownIcon className="h-3 w-3" /> : <ChevronRightIcon className="h-3 w-3" />}
        {label}
      </button>
      {trailing}
    </div>
  );
}

function Skeleton() {
  return <div className="h-12 animate-pulse rounded-md bg-zinc-800/40" />;
}
