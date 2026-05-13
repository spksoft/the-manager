"use client";

import { useEffect, useRef } from "react";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    // Focus input when opened
    inputRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div aria-hidden="true" className="fixed inset-0 z-40 bg-black/60" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        className="fixed left-1/2 top-[10vh] z-50 w-[calc(100vw-1.5rem)] max-w-lg -translate-x-1/2 rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl md:top-[20vh]"
      >
        <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
          <span className="text-zinc-500" aria-hidden>
            ⌘
          </span>
          <input
            ref={inputRef}
            type="search"
            id="command-palette-title"
            placeholder="Type a command…"
            className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
          />
          <kbd
            className="rounded border border-zinc-700 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500"
            aria-label="Escape to close"
          >
            ESC
          </kbd>
        </div>
        <div className="flex items-center justify-center py-10 text-sm text-zinc-500">
          Command palette — coming soon
        </div>
      </div>
    </>
  );
}
