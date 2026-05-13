"use client";

import { Button, Dialog, DialogBody, DialogFooter } from "@the-manager/ui";
import { useState } from "react";

interface StashSaveDialogProps {
  open: boolean;
  onClose: () => void;
  busy?: boolean;
  onSubmit: (message: string, includeUntracked: boolean) => Promise<void>;
}

export function StashSaveDialog({ open, onClose, busy, onSubmit }: StashSaveDialogProps) {
  const [message, setMessage] = useState("");
  const [includeUntracked, setIncludeUntracked] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Stash changes"
      description="Save working-tree changes and reset to HEAD."
    >
      <DialogBody>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-zinc-500">
            Message (optional)
          </span>
          <input
            type="text"
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="WIP feature X"
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-emerald-500"
          />
        </label>
        <label className="flex items-center gap-2 text-zinc-300">
          <input
            type="checkbox"
            checked={includeUntracked}
            onChange={(e) => setIncludeUntracked(e.target.checked)}
            className="accent-emerald-500"
          />
          Include untracked files
        </label>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => void onSubmit(message.trim(), includeUntracked)}
        >
          {busy ? "Stashing…" : "Stash"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
