"use client";

import type { ProjectRow } from "@the-manager/persistence";
import { useState } from "react";

interface ManagerOnboardingProps {
  projects: ProjectRow[];
}

const EXAMPLES: string[] = [
  "Add the repo at ~/code/my-app as a new project",
  "List my projects and tell me which have uncommitted changes",
  "For each registered project, summarise what it does in one line",
  "Find any project whose README hasn't been touched in six months",
];

/**
 * Lightweight empty-state nudge for new users. Renders above the Manager
 * terminal when there are zero registered projects. Each example posts to
 * `/api/manager/ask` so the user can kick off a conversation without typing.
 */
export function ManagerOnboarding({ projects }: ManagerOnboardingProps) {
  const [dismissed, setDismissed] = useState(false);
  const [busyIdx, setBusyIdx] = useState<number | null>(null);

  // Only nudge while genuinely empty.
  if (projects.length > 0 || dismissed) return null;

  return (
    <div className="mb-2 rounded-md border border-zinc-800 bg-zinc-900/40 p-3 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-medium text-zinc-100">Try one to get started</h3>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-md px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-800/60"
        >
          Hide
        </button>
      </div>
      <p className="mb-2 text-xs text-zinc-500">
        Manager runs <code className="text-zinc-300">claude</code> against your registered projects.
        Pick an example or type into the terminal below.
      </p>
      <ul className="grid grid-cols-1 gap-1 md:grid-cols-2">
        {EXAMPLES.map((text, i) => (
          <li key={text}>
            <button
              type="button"
              disabled={busyIdx !== null}
              onClick={async () => {
                setBusyIdx(i);
                try {
                  await fetch("/api/manager/ask", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ text }),
                  });
                } finally {
                  setBusyIdx(null);
                }
              }}
              className="w-full rounded-md border border-zinc-800 px-3 py-2 text-left text-xs text-zinc-200 transition hover:border-zinc-700 hover:bg-zinc-800/40 disabled:opacity-50"
            >
              {busyIdx === i ? "Sending…" : text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
