"use client";

import { Button, Dialog, DialogBody, DialogFooter } from "@the-manager/ui";
import { useState } from "react";

interface DeleteBranchDialogProps {
  open: boolean;
  onClose: () => void;
  branchName: string;
  remote?: string;
  busy?: boolean;
  onSubmit: (force: boolean) => Promise<void>;
}

export function DeleteBranchDialog({
  open,
  onClose,
  branchName,
  remote,
  busy,
  onSubmit,
}: DeleteBranchDialogProps) {
  const [force, setForce] = useState(false);
  const isRemote = !!remote;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={isRemote ? "Delete remote branch" : "Delete branch"}
      description={
        isRemote
          ? `This deletes "${branchName}" from "${remote}". The deletion is pushed to the remote and cannot be undone here.`
          : `Delete "${branchName}" from this repository.`
      }
    >
      <DialogBody>
        {isRemote ? (
          <p className="rounded border border-red-900/40 bg-red-950/30 p-2 text-[11px] text-red-300">
            Remote branch deletion is published immediately. Anyone tracking
            <code className="mx-1 rounded bg-zinc-900 px-1 font-mono">{branchName}</code>
            will see it disappear on their next fetch.
          </p>
        ) : (
          <label className="flex items-center gap-2 text-zinc-300">
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
              className="accent-red-500"
            />
            Force delete (allow unmerged commits)
          </label>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => void onSubmit(force)}
          className="!bg-red-600 hover:!bg-red-700"
        >
          {busy ? "Deleting…" : "Delete"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
