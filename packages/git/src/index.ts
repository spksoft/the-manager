import { type SimpleGit, simpleGit } from "simple-git";

/**
 * Wrapper for the per-project git surface. Reads (status, log, diff) power
 * the mini git display; writes (stage, unstage, commit) are user-driven from
 * the Git tab. We deliberately do NOT expose checkout/reset/push here — those
 * are destructive enough that the user should run them through the agent's
 * own tooling, not a button.
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

  /**
   * Return both staged and unstaged unified-diff text for a single path.
   * Untracked files have no staged or unstaged diff against HEAD — simple-git
   * surfaces them via `status().not_added`, not via `diff`. We don't synthesise
   * a fake diff for those; the UI shows "(new file — no diff)" instead.
   */
  async fileDiff(path: string): Promise<{ staged: string; unstaged: string }> {
    const [unstaged, staged] = await Promise.all([
      this.git.diff(["--", path]).catch(() => ""),
      this.git.diff(["--cached", "--", path]).catch(() => ""),
    ]);
    return { staged, unstaged };
  }

  async currentBranch(): Promise<string | null> {
    try {
      const branch = await this.git.revparse(["--abbrev-ref", "HEAD"]);
      return branch.trim();
    } catch {
      return null;
    }
  }

  /**
   * Stage paths. `git add` handles new files, modifications, and deletions in
   * recent git, so one call covers every working-tree status code the UI sees.
   */
  async stage(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.git.add(paths);
  }

  /**
   * Unstage paths. `git reset HEAD --` works on both born and unborn HEAD
   * (it falls back to `git rm --cached` semantics for the unborn case under
   * the hood). simple-git's `reset(['HEAD', '--', ...paths])` keeps that
   * behavior in one call.
   */
  async unstage(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.git.reset(["HEAD", "--", ...paths]);
  }

  /**
   * Diff of the index against HEAD — i.e. exactly what `git commit` would
   * record. Used as the input to claude -p when generating a commit message.
   * Empty string on a clean index (no staged changes).
   */
  async stagedDiff(): Promise<string> {
    return this.git.diff(["--cached"]).catch(() => "");
  }

  /**
   * Working-tree diff against HEAD (staged + unstaged combined). Fallback
   * input for commit-message generation when nothing is staged yet so the
   * "Generate" button still produces something useful.
   */
  async workingDiff(): Promise<string> {
    return this.git.diff(["HEAD"]).catch(() => "");
  }

  async commit(message: string): Promise<{ hash: string }> {
    const trimmed = message.trim();
    if (trimmed.length === 0) throw new Error("commit message is empty");
    const res = await this.git.commit(trimmed);
    return { hash: res.commit };
  }

  /**
   * `git init` in the cwd, optionally followed by `git remote add origin <url>`.
   * Safe to call on a directory that already has files — git just starts
   * tracking them as untracked. We don't auto-stage or auto-commit; the user
   * does that from the UI once init finishes.
   */
  async init(remoteUrl?: string): Promise<void> {
    await this.git.init();
    if (remoteUrl && remoteUrl.trim().length > 0) {
      await this.git.addRemote("origin", remoteUrl.trim());
    }
  }
}
