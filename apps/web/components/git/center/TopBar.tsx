"use client";

import {
  ArrowDownIcon,
  ArrowDownUpIcon,
  ArrowUpIcon,
  MenuIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";

interface TopBarProps {
  branch: string | null;
  ahead: number;
  behind: number;
  tracking: string | null;
  busy: boolean;
  progress: { method: string; stage: string; pct: number } | null;
  onFetch: () => void;
  onPull: () => void;
  onSync: () => void;
  onPush: () => void;
  onForcePush: () => void;
  onCancel: () => void;
  /** Mobile-only: open the sidebar drawer. When omitted, the hamburger is hidden. */
  onOpenSidebar?: () => void;
}

export function TopBar({
  branch,
  ahead,
  behind,
  tracking,
  busy,
  progress,
  onFetch,
  onPull,
  onSync,
  onPush,
  onForcePush,
  onCancel,
  onOpenSidebar,
}: TopBarProps) {
  return (
    <div className="flex-shrink-0 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/30">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {onOpenSidebar && (
            <button
              type="button"
              onClick={onOpenSidebar}
              aria-label="Open Git sidebar"
              className="-ml-1 rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 md:hidden"
            >
              <MenuIcon className="h-4 w-4" />
            </button>
          )}
          <span className="text-[10px] uppercase tracking-wide text-zinc-500">on</span>
          <span className="truncate font-mono text-xs text-zinc-100">{branch ?? "(detached)"}</span>
          {tracking && (
            <>
              <span className="text-zinc-600">→</span>
              <span className="truncate font-mono text-xs text-zinc-400">{tracking}</span>
            </>
          )}
          {(ahead > 0 || behind > 0) && (
            <span className="ml-1 flex items-center gap-1 text-[10px] text-zinc-500">
              {ahead > 0 && <span className="text-emerald-400">↑{ahead}</span>}
              {behind > 0 && <span className="text-amber-400">↓{behind}</span>}
            </span>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          <ActionButton
            label="Fetch"
            icon={<RefreshCwIcon className="h-3 w-3" />}
            onClick={onFetch}
            disabled={busy}
          />
          <ActionButton
            label="Pull"
            icon={<ArrowDownIcon className="h-3 w-3" />}
            onClick={onPull}
            disabled={busy || !tracking}
            title={!tracking ? "No upstream — set one before pulling" : "Pull from upstream"}
            highlight={behind > 0}
          />
          <ActionButton
            label="Sync"
            icon={<ArrowDownUpIcon className="h-3 w-3" />}
            onClick={onSync}
            disabled={busy || !tracking}
            highlight={ahead > 0 || behind > 0}
            title={!tracking ? "No upstream — set one before syncing" : "Pull then push"}
          />
          <ActionButton
            label="Push"
            icon={<ArrowUpIcon className="h-3 w-3" />}
            onClick={onPush}
            disabled={busy}
            highlight={ahead > 0}
            onContextMenu={(e) => {
              // Right-click → force push prompt.
              e.preventDefault();
              onForcePush();
            }}
            title="Push to remote. Right-click for force push."
          />
        </div>
      </div>
      {progress && (
        <div className="flex items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1">
          <span className="text-[10px] uppercase tracking-wide text-zinc-500">
            {progress.method}
          </span>
          <span className="text-[10px] text-zinc-400">{progress.stage}</span>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${Math.min(progress.pct, 100)}%` }}
            />
          </div>
          <span className="w-8 text-right text-[10px] text-zinc-500">{progress.pct}%</span>
          <button
            type="button"
            onClick={onCancel}
            className="ml-1 rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Cancel"
          >
            <XIcon className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

function ActionButton({
  label,
  icon,
  onClick,
  disabled,
  highlight,
  title,
  onContextMenu,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  highlight?: boolean;
  title?: string;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      disabled={disabled}
      title={title}
      className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        highlight
          ? "bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30"
          : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
