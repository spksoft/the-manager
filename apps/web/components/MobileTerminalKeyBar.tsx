"use client";

/**
 * On-screen key bar for terminals on touch devices. Browser soft keyboards
 * don't expose Tab / arrows / Esc, which makes both the `claude` REPL and
 * regular shells nearly unusable on phones and tablets. This bar dispatches
 * the same ANSI escape sequences xterm.js would emit for a hardware press,
 * so the pty backend can't tell the difference.
 *
 * Hidden at the Tailwind `lg` breakpoint (≥ 1024px) where physical keys are
 * assumed. `onPointerDown` + preventDefault keeps the underlying xterm
 * textarea focused so the soft keyboard doesn't dismiss between taps.
 */

const KEYS: ReadonlyArray<{ label: string; aria: string; data: string }> = [
  { label: "←", aria: "Left arrow", data: "\x1b[D" },
  { label: "↑", aria: "Up arrow", data: "\x1b[A" },
  { label: "↓", aria: "Down arrow", data: "\x1b[B" },
  { label: "→", aria: "Right arrow", data: "\x1b[C" },
  { label: "Tab", aria: "Tab", data: "\t" },
  { label: "⇧Tab", aria: "Shift Tab", data: "\x1b[Z" },
  { label: "Esc", aria: "Escape", data: "\x1b" },
];

interface MobileTerminalKeyBarProps {
  onKey: (data: string) => void;
}

export function MobileTerminalKeyBar({ onKey }: MobileTerminalKeyBarProps) {
  return (
    <div
      role="toolbar"
      aria-label="On-screen terminal keys"
      className="flex flex-shrink-0 select-none gap-1 overflow-x-auto px-1 py-1 touch-manipulation lg:hidden"
    >
      {KEYS.map((k) => (
        <button
          key={k.aria}
          type="button"
          aria-label={k.aria}
          onPointerDown={(e) => {
            // Keep focus on the xterm textarea so the soft keyboard stays open
            // and successive taps don't trigger a focus/blur churn.
            e.preventDefault();
            onKey(k.data);
          }}
          className="min-h-10 min-w-10 flex-shrink-0 rounded-md border border-zinc-800 bg-zinc-900 px-3 text-xs font-medium text-zinc-200 hover:bg-zinc-800 active:bg-zinc-700"
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}
