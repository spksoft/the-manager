"use client";

import { Button, Dialog, DialogBody, DialogFooter } from "@the-manager/ui";
import { useState } from "react";

interface RenameBranchDialogProps {
  open: boolean;
  onClose: () => void;
  from: string;
  busy?: boolean;
  onSubmit: (to: string) => Promise<void>;
}

export function RenameBranchDialog({
  open,
  onClose,
  from,
  busy,
  onSubmit,
}: RenameBranchDialogProps) {
  const [to, setTo] = useState(from);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Rename branch"
      description={`Rename "${from}" to a new name`}
    >
      <DialogBody>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-zinc-500">New name</span>
          <input
            type="text"
            autoFocus
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-xs text-zinc-100 outline-none focus:border-emerald-500"
          />
        </label>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={busy || to.trim().length === 0 || to.trim() === from}
          onClick={() => void onSubmit(to.trim())}
        >
          {busy ? "Renaming…" : "Rename"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
