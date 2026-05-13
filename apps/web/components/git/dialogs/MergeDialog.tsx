"use client";

import { Button, Dialog, DialogBody, DialogFooter } from "@the-manager/ui";
import { useState } from "react";

interface MergeDialogProps {
  open: boolean;
  onClose: () => void;
  branch: string;
  currentBranch?: string | null;
  busy?: boolean;
  onSubmit: (opts: { noFastForward: boolean; squash: boolean }) => Promise<void>;
}

export function MergeDialog({
  open,
  onClose,
  branch,
  currentBranch,
  busy,
  onSubmit,
}: MergeDialogProps) {
  const [noFastForward, setNoFastForward] = useState(false);
  const [squash, setSquash] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Merge branch"
      description={`Merge "${branch}" into ${currentBranch ?? "current branch"}`}
    >
      <DialogBody>
        <label className="flex items-start gap-2 text-zinc-300">
          <input
            type="checkbox"
            checked={noFastForward}
            onChange={(e) => setNoFastForward(e.target.checked)}
            className="mt-1 accent-emerald-500"
          />
          <span>
            <span className="font-medium">--no-ff</span>
            <span className="ml-2 text-[11px] text-zinc-500">
              Always create a merge commit even if a fast-forward is possible.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-zinc-300">
          <input
            type="checkbox"
            checked={squash}
            onChange={(e) => setSquash(e.target.checked)}
            className="mt-1 accent-emerald-500"
          />
          <span>
            <span className="font-medium">--squash</span>
            <span className="ml-2 text-[11px] text-zinc-500">
              Combine all changes into one commit (no merge commit; you'll commit manually).
            </span>
          </span>
        </label>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => void onSubmit({ noFastForward, squash })}
        >
          {busy ? "Merging…" : "Merge"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
