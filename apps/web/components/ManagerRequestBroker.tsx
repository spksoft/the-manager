"use client";

import type { ProjectRow } from "@the-manager/persistence";
import type { DriverId } from "@the-manager/shared";
import { useCallback, useEffect, useState } from "react";
import { NewProjectDialog } from "./NewProjectDialog";

/**
 * Bridges Manager-initiated project proposals to the UI. Subscribes to the
 * SSE feed at `/api/manager/requests/stream`, opens `NewProjectDialog` with
 * the Manager's prefill + reason for the head-of-queue proposal, and POSTs
 * the user's confirm/cancel back to `/api/manager/requests/[id]` so the
 * blocked MCP tool can return its result.
 *
 * Only one dialog is shown at a time; if multiple proposals are in flight,
 * the rest queue and open in order.
 */

interface PendingProposal {
  id: string;
  kind: "create_project";
  payload: {
    name?: string;
    path?: string;
    defaultDriver?: DriverId;
    ephemeral?: boolean;
    reason?: string;
  };
  createdAt: string;
}

interface ManagerRequestBrokerProps {
  onCreated: (project: ProjectRow) => void;
}

export function ManagerRequestBroker({ onCreated }: ManagerRequestBrokerProps) {
  const [queue, setQueue] = useState<PendingProposal[]>([]);
  const active = queue[0] ?? null;

  // Subscribe to the SSE feed of proposals. Reconnects on disconnect since
  // EventSource doesn't auto-reconnect after the browser tab is restored.
  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      es = new EventSource("/api/manager/requests/stream");
      es.addEventListener("enqueued", (ev) => {
        try {
          const p = JSON.parse((ev as MessageEvent).data) as PendingProposal;
          setQueue((q) => (q.some((x) => x.id === p.id) ? q : [...q, p]));
        } catch {
          /* malformed event — drop */
        }
      });
      es.addEventListener("resolved", (ev) => {
        try {
          const { id } = JSON.parse((ev as MessageEvent).data) as { id: string };
          // Drop any local copy of this proposal — server already settled it.
          setQueue((q) => q.filter((p) => p.id !== id));
        } catch {
          /* malformed event — drop */
        }
      });
      es.onerror = () => {
        es?.close();
        es = null;
        // Quick backoff; the SSE server is in-process so reconnect is cheap.
        setTimeout(connect, 1500);
      };
    };

    connect();
    return () => {
      cancelled = true;
      es?.close();
    };
  }, []);

  const advance = useCallback((id: string) => {
    setQueue((q) => q.filter((p) => p.id !== id));
  }, []);

  const postResolution = useCallback(
    async (
      id: string,
      body: { kind: "confirmed"; project: ProjectRow } | { kind: "cancelled" },
    ) => {
      try {
        await fetch(`/api/manager/requests/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        /* the server-side proposal will time out on its own */
      }
    },
    [],
  );

  const handleCreated = useCallback(
    (project: ProjectRow) => {
      if (!active) return;
      const id = active.id;
      onCreated(project);
      advance(id);
      void postResolution(id, { kind: "confirmed", project });
    },
    [active, onCreated, advance, postResolution],
  );

  const handleClose = useCallback(() => {
    if (!active) return;
    const id = active.id;
    advance(id);
    void postResolution(id, { kind: "cancelled" });
  }, [active, advance, postResolution]);

  return (
    <NewProjectDialog
      open={active !== null}
      onClose={handleClose}
      onCreated={handleCreated}
      initialValues={active?.payload}
      reason={active?.payload.reason}
      title={active?.payload.ephemeral ? "Manager: create temp project" : "Manager: create project"}
    />
  );
}
