"use client";

import type { SessionActivity, SessionActivityState } from "@the-manager/core";
import type { ProjectRow, TaskRow } from "@the-manager/persistence";
import type { TaskStatus } from "@the-manager/shared";
import { cn, Sheet } from "@the-manager/ui";
import { useState } from "react";
import { useActivity, useTasks } from "../lib/hooks";
import type { ActiveView } from "./Sidebar";

const STATE_LABEL: Record<SessionActivityState, string> = {
  idle: "Idle",
  working: "Working",
  needs_input: "Needs input",
};

const STATE_CLASS: Record<SessionActivityState, string> = {
  idle: "bg-zinc-700 text-zinc-200",
  working: "bg-emerald-500/80 text-emerald-50",
  needs_input: "bg-amber-500/90 text-amber-950",
};

const TASK_STATUS_CLASS: Record<TaskStatus, string> = {
  pending: "bg-zinc-700 text-zinc-200",
  running: "bg-emerald-500/80 text-emerald-50",
  completed: "bg-sky-500/70 text-sky-50",
  failed: "bg-red-500/80 text-red-50",
  cancelled: "bg-zinc-600 text-zinc-200",
};

interface ActivityPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectRow[];
  onJump: (view: ActiveView) => void;
}

type Tab = "sessions" | "tasks";

export function ActivityPanel({ open, onOpenChange, projects, onJump }: ActivityPanelProps) {
  const [tab, setTab] = useState<Tab>("sessions");
  const { activity, hydrated } = useActivity();
  const { tasks, hydrated: tasksHydrated } = useTasks();

  const busyTasks = tasks.filter((t) => t.status === "pending" || t.status === "running").length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} side="right" ariaLabel="Activity panel">
      <div className="flex h-full flex-col overflow-hidden bg-zinc-950 text-zinc-200">
        <header className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Activity</h2>
            <p className="text-xs text-zinc-500">
              {tab === "sessions"
                ? activity.busyCount > 0
                  ? `${activity.busyCount} session${activity.busyCount === 1 ? "" : "s"} busy`
                  : `${activity.sessions.length} live session${activity.sessions.length === 1 ? "" : "s"}`
                : busyTasks > 0
                  ? `${busyTasks} task${busyTasks === 1 ? "" : "s"} in flight`
                  : `${tasks.length} recent task${tasks.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800/60"
          >
            Close
          </button>
        </header>
        <nav className="flex flex-shrink-0 gap-1 border-b border-zinc-800 px-2 py-1.5 text-xs">
          <TabButton active={tab === "sessions"} onClick={() => setTab("sessions")}>
            Sessions
            {activity.busyCount > 0 && (
              <span className="ml-1 rounded-full bg-emerald-500/30 px-1.5 py-0.5 text-[10px] text-emerald-200">
                {activity.busyCount}
              </span>
            )}
          </TabButton>
          <TabButton active={tab === "tasks"} onClick={() => setTab("tasks")}>
            Tasks
            {busyTasks > 0 && (
              <span className="ml-1 rounded-full bg-emerald-500/30 px-1.5 py-0.5 text-[10px] text-emerald-200">
                {busyTasks}
              </span>
            )}
          </TabButton>
        </nav>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {tab === "sessions" ? (
            !hydrated ? (
              <p className="px-2 py-4 text-xs text-zinc-500">Loading…</p>
            ) : activity.sessions.length === 0 ? (
              <p className="px-2 py-4 text-xs text-zinc-500">
                No agents are running right now. Open a project or talk to the Manager to start one.
              </p>
            ) : (
              <ul className="space-y-1">
                {activity.sessions.map((s) => (
                  <SessionRow key={keyOf(s)} session={s} projects={projects} onJump={onJump} />
                ))}
              </ul>
            )
          ) : !tasksHydrated ? (
            <p className="px-2 py-4 text-xs text-zinc-500">Loading…</p>
          ) : tasks.length === 0 ? (
            <p className="px-2 py-4 text-xs text-zinc-500">
              No Manager tasks yet. Ask the Manager to do something and it'll show up here.
            </p>
          ) : (
            <ul className="space-y-1">
              {tasks.slice(0, 50).map((t) => (
                <TaskItem key={t.id} task={t} projects={projects} onJump={onJump} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1 text-xs transition",
        active ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-800/60",
      )}
    >
      {children}
    </button>
  );
}

function keyOf(s: SessionActivity): string {
  return s.scope === "manager" ? "__manager__" : s.scope.projectId;
}

function SessionRow({
  session,
  projects,
  onJump,
}: {
  session: SessionActivity;
  projects: ProjectRow[];
  onJump: (view: ActiveView) => void;
}) {
  const scope = session.scope;
  let label: string;
  let target: ActiveView;
  if (scope === "manager") {
    label = "Manager";
    target = { type: "manager" };
  } else {
    label = projects.find((p) => p.id === scope.projectId)?.name ?? session.label;
    target = { type: "project", id: scope.projectId };
  }
  return (
    <li>
      <button
        type="button"
        onClick={() => onJump(target)}
        className="flex w-full flex-col items-start gap-1 rounded-md px-2 py-2 text-left transition hover:bg-zinc-800/60"
      >
        <div className="flex w-full items-center gap-2">
          <span
            className={cn(
              "inline-flex flex-shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              STATE_CLASS[session.state],
            )}
          >
            {STATE_LABEL[session.state]}
          </span>
          <span className="truncate text-sm font-medium text-zinc-100">{label}</span>
          <span className="ml-auto flex-shrink-0 text-[11px] text-zinc-500">
            {formatRelative(session.lastActivityAt)}
          </span>
        </div>
        {session.preview && (
          <p className="line-clamp-2 w-full break-words text-xs text-zinc-500">{session.preview}</p>
        )}
      </button>
    </li>
  );
}

function TaskItem({
  task,
  projects,
  onJump,
}: {
  task: TaskRow;
  projects: ProjectRow[];
  onJump: (view: ActiveView) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const projectName = task.targetProjectId
    ? (projects.find((p) => p.id === task.targetProjectId)?.name ?? "(unknown project)")
    : "—";

  return (
    <li>
      <div
        className={cn(
          "flex flex-col gap-1 rounded-md px-2 py-2 transition hover:bg-zinc-800/40",
          expanded && "bg-zinc-800/40",
        )}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-2 text-left"
        >
          <span
            className={cn(
              "inline-flex flex-shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              TASK_STATUS_CLASS[task.status],
            )}
          >
            {task.status}
          </span>
          <span className="truncate text-sm text-zinc-200">{shorten(task.payload, 80)}</span>
          <span className="ml-auto flex-shrink-0 text-[11px] text-zinc-500">
            {formatRelative(task.finishedAt ?? task.createdAt)}
          </span>
        </button>
        {expanded && (
          <div className="pt-1 text-xs text-zinc-400">
            <div className="text-zinc-500">
              Project:{" "}
              {task.targetProjectId ? (
                <button
                  type="button"
                  onClick={() => onJump({ type: "project", id: task.targetProjectId ?? "" })}
                  className="text-zinc-300 underline-offset-2 hover:underline"
                >
                  {projectName}
                </button>
              ) : (
                <span className="text-zinc-300">{projectName}</span>
              )}
            </div>
            {task.payload && task.payload.length > 80 && (
              <details className="mt-1 text-zinc-500">
                <summary className="cursor-pointer text-zinc-400">Full request</summary>
                <pre className="mt-1 whitespace-pre-wrap break-words text-zinc-300">
                  {task.payload}
                </pre>
              </details>
            )}
            {task.result && (
              <div className="mt-1">
                <div className="text-zinc-500">Result</div>
                <pre className="mt-0.5 whitespace-pre-wrap break-words text-zinc-300">
                  {task.result}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function shorten(text: string, max: number): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (Number.isNaN(diff) || diff < 5_000) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
