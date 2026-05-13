"use client";

import { Button, Dialog, DialogBody, DialogFooter } from "@the-manager/ui";
import { useState } from "react";

interface CreateBranchDialogProps {
  open: boolean;
  onClose: () => void;
  /** Optional starting point — commit hash or branch ref. Empty = HEAD. */
  startPoint?: string;
  startPointLabel?: string;
  busy?: boolean;
  onSubmit: (name: string, checkout: boolean) => Promise<void>;
}

export function CreateBranchDialog({
  open,
  onClose,
  startPoint,
  startPointLabel,
  busy,
  onSubmit,
}: CreateBranchDialogProps) {
  const [name, setName] = useState("");
  const [checkout, setCheckout] = useState(true);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setName("");
          onClose();
        }
      }}
      title="Create branch"
      description={
        startPoint ? `From ${startPointLabel ?? startPoint}` : "Branches from the current HEAD"
      }
    >
      <DialogBody>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-zinc-500">Branch name</span>
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="feature/new-thing"
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-xs text-zinc-100 outline-none focus:border-emerald-500"
          />
        </label>
        <label className="flex items-center gap-2 text-zinc-300">
          <input
            type="checkbox"
            checked={checkout}
            onChange={(e) => setCheckout(e.target.checked)}
            className="accent-emerald-500"
          />
          Check out after creating
        </label>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={busy || name.trim().length === 0}
          onClick={() => void onSubmit(name.trim(), checkout)}
        >
          {busy ? "Creating…" : "Create"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
