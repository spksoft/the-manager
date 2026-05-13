export interface BranchRow {
  name: string;
  scope: "local" | "remote";
  current: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  sha: string;
}

export interface BranchList {
  current: string | null;
  local: BranchRow[];
  remote: BranchRow[];
}

export interface RemoteRow {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface TagRow {
  name: string;
}

export interface StashRow {
  index: number;
  message: string;
  hash: string;
  date: string;
}

export interface CommitFileChange {
  path: string;
  status: "A" | "M" | "D" | "R" | "C" | "T";
  renameFrom?: string;
}

export interface CommitDetails {
  hash: string;
  parents: string[];
  author: { name: string; email: string };
  date: string;
  subject: string;
  body: string;
  files: CommitFileChange[];
}

export interface GraphNode {
  hash: string;
  parents: string[];
  refs: string[];
  author: string;
  date: string;
  subject: string;
  lane: number;
  parentLanes: number[];
}

export interface ProgressEvent {
  stage: string;
  progress: number;
  processed?: number;
  total?: number;
  raw?: string;
}

export interface RemoteOpOptions {
  remote?: string;
  branch?: string;
  setUpstream?: boolean;
  force?: boolean;
  tags?: boolean;
  prune?: boolean;
  rebase?: boolean;
  onProgress?: (e: ProgressEvent) => void;
  signal?: AbortSignal;
}
