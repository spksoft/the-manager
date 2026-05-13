"use client";

import { cn } from "@the-manager/ui";
import { setTerminalDrawer, useUiState } from "../lib/hooks";
import { MANAGER_PROJECT_ID } from "../lib/manager-id";
import { TerminalsPanel } from "./TerminalsPanel";

/**
 * App-wide bottom drawer hosting shell terminals scoped to the Manager cwd
 * (`~/.the-manager/manager/cwd`). Collapse / expand state and panel height
 * are persisted in ui-state so they survive reloads. Per-project terminals
 * are NOT shown here — they live in `ProjectWorkspace`'s "Terminal" tab.
 */

const MIN_HEIGHT = 160;
const MAX_HEIGHT = 800;
const DEFAULT_HEIGHT = 280;

export function BottomTerminalDrawer() {
  const { data: uiState, patchUiState } = useUiState();
  const drawer = uiState?.terminalDrawer;
  // Until uiState hydrates, render the collapsed header at default height so
  // we don't reflow once it lands.
  const expanded = drawer?.expanded ?? false;
  const heightPx = clamp(drawer?.heightPx ?? DEFAULT_HEIGHT, MIN_HEIGHT, MAX_HEIGHT);

  const toggle = () => {
    void setTerminalDrawer(patchUiState, { expanded: !expanded });
  };

  return (
    <div
      className={cn("flex flex-shrink-0 flex-col border-t border-zinc-800 bg-zinc-950/60")}
      style={expanded ? { height: heightPx } : undefined}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        aria-controls="bottom-terminal-content"
        className="flex h-8 flex-shrink-0 items-center gap-2 px-3 text-xs text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-100"
      >
        <span aria-hidden className="font-mono text-[10px]">
          {expanded ? "▾" : "▸"}
        </span>
        <span>Terminal</span>
        <span className="ml-2 text-[10px] text-zinc-600">
          global · {"~/.the-manager/manager/cwd"}
        </span>
      </button>
      {expanded && (
        <div id="bottom-terminal-content" className="min-h-0 flex-1 overflow-hidden">
          <TerminalsPanel scope={MANAGER_PROJECT_ID} />
        </div>
      )}
    </div>
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
