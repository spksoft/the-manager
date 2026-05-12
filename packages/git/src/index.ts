import { type SimpleGit, simpleGit } from "simple-git";

/**
 * Read-mostly wrapper for the mini git display. We intentionally do NOT expose
 * write operations (commit/push/checkout) here — agents have their own git
 * tooling and the UI should never silently move someone's HEAD around.
 */
export class GitView {
  private readonly git: SimpleGit;

  constructor(cwd: string) {
    this.git = simpleGit({ baseDir: cwd });
  }

  /**
   * True iff the cwd is inside a git work tree, even if HEAD is unborn (a fresh
   * `git init` with zero commits). Prefer this over `currentBranch()` for the
   * "is this a repo?" question — a brand-new repo with no commits has no HEAD
   * to resolve, but it is still a repository.
   */
  async isRepository(): Promise<boolean> {
    try {
      const out = await this.git.revparse(["--is-inside-work-tree"]);
      return out.trim() === "true";
    } catch {
      return false;
    }
  }

  async status() {
    return this.git.status();
  }

  async log(maxCount = 50) {
    return this.git.log({ maxCount });
  }

  async diff(ref?: string) {
    return ref ? this.git.diff([ref]) : this.git.diff();
  }

  async currentBranch(): Promise<string | null> {
    try {
      const branch = await this.git.revparse(["--abbrev-ref", "HEAD"]);
      return branch.trim();
    } catch {
      return null;
    }
  }
}
