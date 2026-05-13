"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "./cn";

export interface DialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  title?: string;
  description?: string;
  className?: string;
  ariaLabel?: string;
  children: ReactNode;
}

/**
 * Centered modal. Use for destructive confirms (delete branch, hard reset,
 * force push) — Sheet is for edge slide-ins (sidebar / mobile menu), wrong
 * semantics for blocking confirms.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  className,
  ariaLabel,
  children,
}: DialogProps) {
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
        aria-label={ariaLabel ?? title}
        tabIndex={-1}
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex w-[min(28rem,100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl outline-none animate-scale-in",
          className,
        )}
      >
        {(title || description) && (
          <div className="border-b border-zinc-800 px-4 py-3">
            {title && <div className="text-sm font-medium text-zinc-100">{title}</div>}
            {description && <p className="mt-1 text-xs text-zinc-400">{description}</p>}
          </div>
        )}
        {children}
      </div>
    </>
  );
}

export function DialogBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 px-4 py-3 text-xs text-zinc-200", className)}>
      {children}
    </div>
  );
}

export function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3",
        className,
      )}
    >
      {children}
    </div>
  );
}
