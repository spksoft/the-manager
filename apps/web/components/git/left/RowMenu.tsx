"use client";

import { MoreHorizontalIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface RowMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface RowMenuProps {
  items: RowMenuItem[];
  ariaLabel?: string;
}

/**
 * Tiny dropdown menu used as the "⋯" trigger on branch / stash rows in the
 * left sidebar. Closes on outside click and Escape.
 */
export function RowMenu({ items, ariaLabel }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative ml-auto">
      <button
        type="button"
        aria-label={ariaLabel ?? "Row menu"}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 md:p-0.5"
      >
        <MoreHorizontalIcon className="h-4 w-4 md:h-3.5 md:w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 min-w-[10rem] overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 shadow-lg">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              disabled={it.disabled}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                it.onClick();
              }}
              className={`block w-full px-3 py-1.5 text-left text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                it.danger ? "text-red-300 hover:bg-red-900/30" : "text-zinc-200 hover:bg-zinc-900"
              }`}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
