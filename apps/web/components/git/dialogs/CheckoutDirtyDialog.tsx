"use client";

import { Button, Dialog, DialogBody, DialogFooter } from "@the-manager/ui";

interface CheckoutDirtyDialogProps {
  open: boolean;
  onClose: () => void;
  target: string;
  dirty: { path: string; index: string; working_dir: string }[];
  busy?: boolean;
  onStashAndCheckout: () => Promise<void>;
  onDiscardAndCheckout: () => Promise<void>;
}

export function CheckoutDirtyDialog({
  open,
  onClose,
  target,
  dirty,
  busy,
  onStashAndCheckout,
  onDiscardAndCheckout,
}: CheckoutDirtyDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Working tree has uncommitted changes"
      description={`Checking out "${target}" would overwrite local edits in ${dirty.length} file${dirty.length === 1 ? "" : "s"}.`}
    >
      <DialogBody>
        <ul className="max-h-40 overflow-y-auto rounded border border-zinc-800 bg-zinc-950/40 p-2 font-mono text-[11px]">
          {dirty.slice(0, 50).map((f) => (
            <li key={f.path} className="truncate text-zinc-300">
              <span className="mr-2 text-zinc-500">
                {f.index || " "}
                {f.working_dir || " "}
              </span>
              {f.path}
            </li>
          ))}
          {dirty.length > 50 && <li className="text-zinc-500">… +{dirty.length - 50} more</li>}
        </ul>
        <p className="text-[11px] text-zinc-400">
          <strong>Stash</strong> saves the changes and restores them later via the stash list.
          <strong className="ml-2">Discard</strong> uses <code>git checkout -f</code> and cannot be
          undone.
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => void onDiscardAndCheckout()}
          className="!bg-red-600 hover:!bg-red-700"
        >
          Discard & checkout
        </Button>
        <Button variant="primary" disabled={busy} onClick={() => void onStashAndCheckout()}>
          {busy ? "Working…" : "Stash & checkout"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
