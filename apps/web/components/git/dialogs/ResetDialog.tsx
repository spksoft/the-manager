"use client";

import { Button, Dialog, DialogBody, DialogFooter } from "@the-manager/ui";
import { useState } from "react";
import { shortHash } from "../helpers";

interface ResetDialogProps {
  open: boolean;
  onClose: () => void;
  target: string;
  targetSubject?: string;
  busy?: boolean;
  onSubmit: (mode: "soft" | "mixed" | "hard") => Promise<void>;
}

export function ResetDialog({
  open,
  onClose,
  target,
  targetSubject,
  busy,
  onSubmit,
}: ResetDialogProps) {
  const [mode, setMode] = useState<"soft" | "mixed" | "hard">("mixed");
  const [confirm, setConfirm] = useState("");
  const requireConfirm = mode === "hard";
  const expected = shortHash(target);
  const canSubmit =
    !busy && (!requireConfirm || confirm.trim().toLowerCase() === expected.toLowerCase());

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setConfirm("");
          onClose();
        }
      }}
      title="Reset HEAD"
      description={`Move HEAD to ${shortHash(target)}${targetSubject ? ` — ${targetSubject}` : ""}.`}
    >
      <DialogBody>
        <div className="flex flex-col gap-2">
          {(["soft", "mixed", "hard"] as const).map((m) => (
            <label key={m} className="flex items-start gap-2 text-zinc-300">
              <input
                type="radio"
                name="reset-mode"
                checked={mode === m}
                onChange={() => setMode(m)}
                className="mt-1 accent-emerald-500"
              />
              <span>
                <span className="font-medium">--{m}</span>
                <span className="ml-2 text-[11px] text-zinc-500">
                  {m === "soft" && "Keep index and working tree (commits become staged changes)."}
                  {m === "mixed" &&
                    "Keep working tree, reset index (commits become unstaged changes)."}
                  {m === "hard" &&
                    "Discard index AND working-tree changes since target. Destructive."}
                </span>
              </span>
            </label>
          ))}
        </div>
        {requireConfirm && (
          <label className="flex flex-col gap-1 rounded border border-red-900/40 bg-red-950/30 p-2">
            <span className="text-[10px] uppercase tracking-wide text-red-300">
              Type <code className="rounded bg-zinc-900 px-1 font-mono">{expected}</code> to confirm
            </span>
            <input
              type="text"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-xs text-zinc-100 outline-none focus:border-red-500"
            />
          </label>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!canSubmit}
          onClick={() => void onSubmit(mode)}
          className={mode === "hard" ? "!bg-red-600 hover:!bg-red-700" : ""}
        >
          {busy ? "Resetting…" : `Reset --${mode}`}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
