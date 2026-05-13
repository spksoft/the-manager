"use client";

import { BranchSection } from "./BranchSection";
import { RemoteSection } from "./RemoteSection";
import { StashSection } from "./StashSection";
import { TagSection } from "./TagSection";

interface SidebarProps {
  projectId: string;
}

export function Sidebar({ projectId }: SidebarProps) {
  return (
    <div className="flex flex-col gap-3 pr-1 text-xs">
      <BranchSection projectId={projectId} />
      <StashSection projectId={projectId} />
      <RemoteSection projectId={projectId} />
      <TagSection projectId={projectId} />
    </div>
  );
}
