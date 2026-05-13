"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "./cn";

export type SheetSide = "left" | "right" | "bottom";

export interface SheetProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  side?: SheetSide;
  className?: string;
  ariaLabel?: string;
  children: ReactNode;
}

const sideClasses: Record<SheetSide, string> = {
  left: "inset-y-0 left-0 h-full w-[min(20rem,100vw)] border-r border-zinc-800 animate-slide-in-left",
  right:
    "inset-y-0 right-0 h-full w-[min(24rem,100vw)] border-l border-zinc-800 animate-slide-in-right",
  bottom: "inset-x-0 bottom-0 w-full max-h-[85vh] border-t border-zinc-800 animate-slide-up",
};

export function Sheet({
  open,
  onOpenChange,
  side = "left",
  className,
  ariaLabel,
  children,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div
        aria-hidden
        onClick={() => onOpenChange(false)}
        className="animate-fade-in fixed inset-0 z-40 bg-black/60"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        className={cn(
          "fixed z-50 flex flex-col bg-zinc-950 shadow-xl outline-none",
          sideClasses[side],
          className,
        )}
      >
        {children}
      </div>
    </>
  );
}
