"use client";

import { Button, Dialog, DialogBody, DialogFooter } from "@the-manager/ui";

interface ForcePushDialogProps {
  open: boolean;
  onClose: () => void;
  branch: string;
  remote: string;
  busy?: boolean;
  onConfirm: () => Promise<void>;
}

export function ForcePushDialog({
  open,
  onClose,
  branch,
  remote,
  busy,
  onConfirm,
}: ForcePushDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Force push"
      description={`Push ${branch} → ${remote} with --force-with-lease.`}
    >
      <DialogBody>
        <p className="rounded border border-amber-900/40 bg-amber-950/30 p-2 text-[11px] text-amber-200">
          Force-push uses{" "}
          <code className="rounded bg-zinc-900 px-1 font-mono">--force-with-lease</code>: the push
          is rejected if the remote has new commits you haven't fetched. This protects against
          overwriting unseen work but still rewrites history that collaborators may already have
          based work on.
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => void onConfirm()}
          className="!bg-amber-600 hover:!bg-amber-700"
        >
          {busy ? "Pushing…" : "Force push with lease"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
