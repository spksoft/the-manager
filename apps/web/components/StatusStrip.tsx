"use client";

import type { SessionActivityState } from "@the-manager/core";
import type { ProjectRow } from "@the-manager/persistence";
import { cn } from "@the-manager/ui";
import { useState } from "react";
import { useActivity } from "../lib/hooks";
import { ActivityPanel } from "./ActivityPanel";
import type { ActiveView } from "./Sidebar";

const PILL: Record<SessionActivityState, { className: string; label: string }> = {
  idle: { className: "bg-zinc-700 text-zinc-200", label: "Idle" },
  working: { className: "bg-emerald-500/80 text-emerald-50", label: "Working" },
  needs_input: { className: "bg-amber-500/90 text-amber-950", label: "Needs you" },
};

interface StatusStripProps {
  projects: ProjectRow[];
  onJump: (view: ActiveView) => void;
}

export function StatusStrip({ projects, onJump }: StatusStripProps) {
  const { activity } = useActivity();
  const [open, setOpen] = useState(false);

  const pill = PILL[activity.worst];
  const totalLive = activity.sessions.length;
  const headlineSession = activity.sessions.find((s) => s.state !== "idle") ?? activity.sessions[0];
  let headlineLabel: string | null = null;
  if (headlineSession) {
    const scope = headlineSession.scope;
    if (scope === "manager") {
      headlineLabel = "Manager";
    } else {
      headlineLabel = projects.find((p) => p.id === scope.projectId)?.name ?? headlineSession.label;
    }
  }
  const preview = headlineSession?.preview;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden items-center gap-2 rounded-md border border-zinc-800 px-2 py-1 text-xs text-zinc-400 transition hover:border-zinc-700 hover:bg-zinc-800/40 md:flex"
        aria-label="Open activity panel"
      >
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            pill.className,
          )}
        >
          {activity.worst === "working" && (
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-50" />
          )}
          {pill.label}
        </span>
        {totalLive > 0 ? (
          <span className="font-medium text-zinc-300">
            {activity.busyCount > 0 ? `${activity.busyCount} busy` : `${totalLive} live`}
          </span>
        ) : (
          <span className="text-zinc-500">no sessions</span>
        )}
        {headlineLabel && preview && (
          <span className="hidden max-w-[28ch] truncate text-zinc-500 lg:inline">
            {headlineLabel}: {preview}
          </span>
        )}
      </button>
      <ActivityPanel
        open={open}
        onOpenChange={setOpen}
        projects={projects}
        onJump={(view) => {
          setOpen(false);
          onJump(view);
        }}
      />
    </>
  );
}
