import { cn } from "@the-manager/ui";
import type { ReactNode } from "react";

interface SidebarItemProps {
  label: string;
  icon?: ReactNode;
  trailing?: ReactNode;
  /** Action revealed on hover (used for project-row "remove"). Clicking it
   * does not also fire `onClick` thanks to `stopPropagation` inside. */
  hoverAction?: ReactNode;
  active?: boolean;
  onClick?: () => void;
}

export function SidebarItem({
  label,
  icon,
  trailing,
  hoverAction,
  active,
  onClick,
}: SidebarItemProps) {
  return (
    <div
      className={cn(
        "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        active
          ? "bg-zinc-800/80 text-zinc-50"
          : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex flex-1 items-center gap-2 truncate text-left"
      >
        {icon && (
          <span className="flex h-4 w-4 items-center justify-center text-zinc-500">{icon}</span>
        )}
        <span className="flex-1 truncate">{label}</span>
      </button>
      {hoverAction && (
        <span className="flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
          {hoverAction}
        </span>
      )}
      {trailing && <span className="flex-shrink-0">{trailing}</span>}
    </div>
  );
}
