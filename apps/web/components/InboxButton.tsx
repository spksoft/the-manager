"use client";

import { cn, Sheet } from "@the-manager/ui";
import { useEffect, useState } from "react";

interface PendingProposal {
  id: string;
  kind: "create_project";
  payload: {
    name?: string;
    path?: string;
    defaultDriver?: string;
    ephemeral?: boolean;
    reason?: string;
  };
  createdAt: string;
}

type PendingAction = {
  id: string;
  createdAt: string;
  proposal:
    | {
        kind: "write_file";
        projectId: string;
        relPath: string;
        newContent: string;
        previousContent: string | null;
        reason?: string;
      }
    | {
        kind: "run_command";
        projectId: string;
        command: string;
        cwd: string;
        reason?: string;
      };
};

/**
 * Header button + drawer for everything waiting on the user's attention:
 *  - create_project proposals (the modal handles the actual confirm flow)
 *  - write_file / run_command action proposals (resolved inline)
 */
export function InboxButton() {
  const [proposals, setProposals] = useState<PendingProposal[]>([]);
  const [actions, setActions] = useState<PendingAction[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    return connectSSE("/api/manager/requests/stream", {
      enqueued: (raw) => {
        const p = safeJSON<PendingProposal>(raw);
        if (!p) return;
        setProposals((q) => (q.some((x) => x.id === p.id) ? q : [...q, p]));
      },
      resolved: (raw) => {
        const data = safeJSON<{ id: string }>(raw);
        if (!data) return;
        setProposals((q) => q.filter((p) => p.id !== data.id));
      },
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    return connectSSE("/api/manager/actions/stream", {
      enqueued: (raw) => {
        const a = safeJSON<PendingAction>(raw);
        if (!a) return;
        setActions((q) => (q.some((x) => x.id === a.id) ? q : [...q, a]));
      },
      resolved: (raw) => {
        const data = safeJSON<{ id: string }>(raw);
        if (!data) return;
        setActions((q) => q.filter((a) => a.id !== data.id));
      },
    });
  }, []);

  const total = proposals.length + actions.length;
  if (total === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative inline-flex items-center gap-1 rounded-md border border-amber-700/40 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-200 transition hover:bg-amber-500/20"
        aria-label={`${total} pending Manager item${total === 1 ? "" : "s"}`}
      >
        <span className="text-base leading-none">📥</span>
        <span>Inbox</span>
        <span className="ml-0.5 rounded-full bg-amber-500/40 px-1.5 text-[10px] text-amber-50">
          {total}
        </span>
      </button>
      <Sheet open={open} onOpenChange={setOpen} side="right" ariaLabel="Manager inbox">
        <div className="flex h-full flex-col overflow-hidden bg-zinc-950 text-zinc-200">
          <header className="flex flex-shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Inbox</h2>
              <p className="text-xs text-zinc-500">
                Proposals from the Manager waiting on you ({total})
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800/60"
            >
              Close
            </button>
          </header>
          <div className="flex-1 overflow-y-auto px-2 py-2">
            <ul className="space-y-2">
              {actions.map((a) => (
                <ActionRow
                  key={a.id}
                  action={a}
                  onResolve={async (kind) => {
                    await fetch(`/api/manager/actions/${a.id}`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ kind }),
                    });
                    setActions((q) => q.filter((x) => x.id !== a.id));
                  }}
                />
              ))}
              {proposals.map((p) => (
                <ProposalRow
                  key={p.id}
                  proposal={p}
                  onDismiss={async () => {
                    await fetch(`/api/manager/requests/${p.id}`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ kind: "cancelled" }),
                    });
                    setProposals((q) => q.filter((x) => x.id !== p.id));
                  }}
                />
              ))}
            </ul>
          </div>
        </div>
      </Sheet>
    </>
  );
}

function ProposalRow({
  proposal,
  onDismiss,
}: {
  proposal: PendingProposal;
  onDismiss: () => void;
}) {
  const isStale = Date.now() - Date.parse(proposal.createdAt) > 5 * 60 * 1000;
  return (
    <li
      className={cn(
        "rounded-md border border-zinc-800 bg-zinc-900/40 p-3 text-xs",
        isStale && "border-amber-700/40",
      )}
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="rounded-full bg-amber-500/30 px-1.5 py-0.5 text-[10px] uppercase text-amber-100">
          {proposal.kind === "create_project"
            ? proposal.payload.ephemeral
              ? "Temp project"
              : "Create project"
            : proposal.kind}
        </span>
        <span className="text-[11px] text-zinc-500">{relTime(proposal.createdAt)}</span>
        {isStale && <span className="text-[10px] text-amber-300/80">waiting &gt; 5 min</span>}
      </div>
      {proposal.payload.reason && <p className="mb-2 text-zinc-300">{proposal.payload.reason}</p>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-zinc-400">
        {proposal.payload.name && (
          <>
            <dt>Name</dt>
            <dd className="text-zinc-200">{proposal.payload.name}</dd>
          </>
        )}
        {proposal.payload.path && (
          <>
            <dt>Path</dt>
            <dd className="break-all text-zinc-200">{proposal.payload.path}</dd>
          </>
        )}
        {proposal.payload.defaultDriver && (
          <>
            <dt>Driver</dt>
            <dd className="text-zinc-200">{proposal.payload.defaultDriver}</dd>
          </>
        )}
      </dl>
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800/60"
        >
          Dismiss
        </button>
        <p className="text-[11px] text-zinc-500">Confirm via the dialog →</p>
      </div>
    </li>
  );
}

function ActionRow({
  action,
  onResolve,
}: {
  action: PendingAction;
  onResolve: (kind: "approved" | "rejected") => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const isStale = Date.now() - Date.parse(action.createdAt) > 5 * 60 * 1000;
  const p = action.proposal;

  return (
    <li
      className={cn(
        "rounded-md border border-zinc-800 bg-zinc-900/40 p-3 text-xs",
        isStale && "border-amber-700/40",
      )}
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="rounded-full bg-sky-500/30 px-1.5 py-0.5 text-[10px] uppercase text-sky-100">
          {p.kind === "write_file" ? "Write file" : "Run command"}
        </span>
        <span className="text-[11px] text-zinc-500">{relTime(action.createdAt)}</span>
        {isStale && <span className="text-[10px] text-amber-300/80">waiting &gt; 5 min</span>}
      </div>
      {p.reason && <p className="mb-2 text-zinc-300">{p.reason}</p>}
      {p.kind === "write_file" ? (
        <div className="space-y-1">
          <div className="font-mono text-zinc-400 break-all">{p.relPath}</div>
          <div className="text-[11px] text-zinc-500">
            {p.previousContent === null
              ? "New file"
              : `Replacing ${p.previousContent.length} → ${p.newContent.length} bytes`}
          </div>
          <details
            open={showFull}
            onToggle={(e) => setShowFull((e.target as HTMLDetailsElement).open)}
            className="text-zinc-400"
          >
            <summary className="cursor-pointer text-zinc-300">Show content</summary>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-zinc-950/60 p-2 text-[11px] text-zinc-200">
              {p.newContent.slice(0, 4000)}
              {p.newContent.length > 4000 ? `\n…(${p.newContent.length - 4000} more bytes)` : ""}
            </pre>
          </details>
        </div>
      ) : (
        <div className="space-y-1">
          <pre className="overflow-auto rounded bg-zinc-950/60 p-2 font-mono text-[11px] text-zinc-200">
            {p.command}
          </pre>
          <div className="text-[11px] text-zinc-500 break-all">cwd: {p.cwd}</div>
        </div>
      )}
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onResolve("rejected");
          }}
          className="rounded-md px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800/60 disabled:opacity-50"
        >
          Reject
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onResolve("approved");
          }}
          className="rounded-md bg-emerald-600/80 px-2 py-1 text-[11px] font-medium text-emerald-50 hover:bg-emerald-600 disabled:opacity-50"
        >
          Approve
        </button>
      </div>
    </li>
  );
}

function connectSSE(
  url: string,
  handlers: { enqueued: (raw: string) => void; resolved: (raw: string) => void },
): () => void {
  let es: EventSource | null = null;
  let cancelled = false;
  const connect = () => {
    if (cancelled) return;
    es = new EventSource(url);
    es.addEventListener("enqueued", (ev) => handlers.enqueued((ev as MessageEvent).data));
    es.addEventListener("resolved", (ev) => handlers.resolved((ev as MessageEvent).data));
    es.onerror = () => {
      es?.close();
      es = null;
      setTimeout(connect, 1500);
    };
  };
  connect();
  return () => {
    cancelled = true;
    es?.close();
  };
}

function safeJSON<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function relTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (Number.isNaN(diff) || diff < 5_000) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}
