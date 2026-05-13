export class TheManagerError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TheManagerError";
    this.code = code;
  }
}

export class NotImplementedError extends TheManagerError {
  constructor(what: string) {
    super("NOT_IMPLEMENTED", `${what} is not implemented yet`);
    this.name = "NotImplementedError";
  }
}

export class NotFoundError extends TheManagerError {
  constructor(what: string, id: string) {
    super("NOT_FOUND", `${what} not found: ${id}`);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends TheManagerError {
  constructor(message: string, options?: ErrorOptions) {
    super("VALIDATION", message, options);
    this.name = "ValidationError";
  }
}

export class DirtyWorkingTreeError extends TheManagerError {
  readonly dirty: { path: string; index: string; working_dir: string }[];
  constructor(dirty: { path: string; index: string; working_dir: string }[]) {
    super("DIRTY_TREE", "working tree has uncommitted changes");
    this.name = "DirtyWorkingTreeError";
    this.dirty = dirty;
  }
}

export class MergeConflictError extends TheManagerError {
  readonly conflicted: string[];
  constructor(conflicted: string[]) {
    super("MERGE_CONFLICT", "merge produced conflicts");
    this.name = "MergeConflictError";
    this.conflicted = conflicted;
  }
}
