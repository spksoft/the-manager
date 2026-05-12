import { cn } from "@the-manager/ui";

export type ProjectStatus = "running" | "ready" | "off";

const STATUS_LABEL: Record<ProjectStatus, string> = {
  running: "Running",
  ready: "Ready",
  off: "Disconnected",
};

const STATUS_PILL: Record<ProjectStatus, string> = {
  running: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
  ready: "bg-sky-500/10 text-sky-300 ring-sky-500/30",
  off: "bg-zinc-500/10 text-zinc-400 ring-zinc-500/30",
};

const STATUS_DOT: Record<ProjectStatus, string> = {
  running: "bg-emerald-400 animate-pulse",
  ready: "bg-sky-400",
  off: "bg-zinc-500",
};

interface StatusBadgeProps {
  status: ProjectStatus;
  dotOnly?: boolean;
  className?: string;
}

export function StatusBadge({ status, dotOnly = false, className }: StatusBadgeProps) {
  if (dotOnly) {
    return (
      <span
        role="img"
        aria-label={STATUS_LABEL[status]}
        className={cn("inline-block h-2 w-2 rounded-full", STATUS_DOT[status], className)}
      />
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        STATUS_PILL[status],
        className,
      )}
    >
      <span className={cn("inline-block h-1.5 w-1.5 rounded-full", STATUS_DOT[status])} />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Derive a project's display status from its live sessions list. */
export function deriveProjectStatus(
  sessions: Array<{ status: string }> | undefined,
): ProjectStatus {
  if (!sessions || sessions.length === 0) return "off";
  const hasRunning = sessions.some((s) => s.status === "running" || s.status === "starting");
  if (hasRunning) return "running";
  return "ready";
}
