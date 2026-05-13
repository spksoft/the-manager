import { spawn } from "node:child_process";
import { DirtyWorkingTreeError, MergeConflictError } from "@the-manager/shared";
import { type SimpleGit, simpleGit } from "simple-git";
import { runGitWithProgress } from "./progress";
import type {
  BranchList,
  BranchRow,
  CommitDetails,
  CommitFileChange,
  GraphNode,
  RemoteOpOptions,
  RemoteRow,
  StashRow,
  TagRow,
} from "./types";

export * from "./types";

function runGitWithStdin(args: string[], cwd: string, input: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `git ${args[0] ?? ""} exited with code ${code}`));
    });
    child.stdin.write(input);
    child.stdin.end();
  });
}

/**
 * Wrapper for the per-project git surface. Reads (status, log, diff, branches,
 * stash, graph, ...) power the Git tab; writes (stage, unstage, commit,
 * checkout, branch CRUD, stash, reset, merge, hunk apply, fetch/pull/push) are
 * user-driven. Destructive operations expect the caller to surface a confirm
 * dialog first — this layer does not second-guess them.
 */
export class GitView {
  private readonly cwd: string;
  private readonly git: SimpleGit;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.git = simpleGit({ baseDir: cwd });
  }

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

  async stage(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.git.add(paths);
  }

  async unstage(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.git.reset(["HEAD", "--", ...paths]);
  }

  async stagedDiff(): Promise<string> {
    return this.git.diff(["--cached"]).catch(() => "");
  }

  async workingDiff(): Promise<string> {
    return this.git.diff(["HEAD"]).catch(() => "");
  }

  async commit(message: string): Promise<{ hash: string }> {
    const trimmed = message.trim();
    if (trimmed.length === 0) throw new Error("commit message is empty");
    const res = await this.git.commit(trimmed);
    return { hash: res.commit };
  }

  async init(remoteUrl?: string): Promise<void> {
    await this.git.init();
    if (remoteUrl && remoteUrl.trim().length > 0) {
      await this.git.addRemote("origin", remoteUrl.trim());
    }
  }

  // ── Branches ───────────────────────────────────────────────────────────────

  /**
   * `for-each-ref` with Unit-Separator delimited fields. simple-git's
   * BranchSummary loses upstream-tracking detail (ahead/behind counts), so we
   * shell out with a fixed format string and parse it ourselves.
   */
  async branches(): Promise<BranchList> {
    const US = "";
    const fmt = `%(refname)${US}%(objectname)${US}%(upstream:short)${US}%(upstream:track)${US}%(HEAD)`;
    let raw = "";
    try {
      raw = await this.git.raw(["for-each-ref", `--format=${fmt}`, "refs/heads", "refs/remotes"]);
    } catch {
      return { current: null, local: [], remote: [] };
    }
    const local: BranchRow[] = [];
    const remote: BranchRow[] = [];
    let current: string | null = null;
    for (const line of raw.split("\n")) {
      if (!line) continue;
      const parts = line.split(US);
      const refname = parts[0] ?? "";
      const sha = parts[1] ?? "";
      const upstreamRaw = parts[2] ?? "";
      const trackRaw = parts[3] ?? "";
      const headFlag = parts[4] ?? "";
      if (!refname) continue;
      let scope: "local" | "remote";
      let name: string;
      if (refname.startsWith("refs/heads/")) {
        scope = "local";
        name = refname.slice("refs/heads/".length);
      } else if (refname.startsWith("refs/remotes/")) {
        scope = "remote";
        name = refname.slice("refs/remotes/".length);
        if (name.endsWith("/HEAD")) continue;
      } else {
        continue;
      }
      const isHead = headFlag === "*";
      if (isHead) current = name;
      let ahead = 0;
      let behind = 0;
      if (trackRaw) {
        const a = /ahead (\d+)/.exec(trackRaw)?.[1];
        const b = /behind (\d+)/.exec(trackRaw)?.[1];
        if (a) ahead = Number.parseInt(a, 10);
        if (b) behind = Number.parseInt(b, 10);
      }
      const row: BranchRow = {
        name,
        scope,
        current: isHead,
        upstream: upstreamRaw || null,
        ahead,
        behind,
        sha,
      };
      if (scope === "remote") remote.push(row);
      else local.push(row);
    }
    return { current, local, remote };
  }

  async createBranch(name: string, startPoint?: string): Promise<void> {
    const args = ["branch", name];
    if (startPoint) args.push(startPoint);
    await this.git.raw(args);
  }

  async createAndCheckout(name: string, startPoint?: string): Promise<void> {
    const args = ["checkout", "-b", name];
    if (startPoint) args.push(startPoint);
    await this.git.raw(args);
  }

  async renameBranch(from: string, to: string): Promise<void> {
    await this.git.raw(["branch", "-m", from, to]);
  }

  async deleteBranch(name: string, force = false): Promise<void> {
    await this.git.raw(["branch", force ? "-D" : "-d", name]);
  }

  async deleteRemoteBranch(remote: string, name: string): Promise<void> {
    await this.git.raw(["push", remote, "--delete", name]);
  }

  async setUpstream(branch: string, upstream: string): Promise<void> {
    await this.git.raw(["branch", `--set-upstream-to=${upstream}`, branch]);
  }

  /**
   * Checkout `target`. If the working tree has uncommitted changes and `force`
   * is false, throws `DirtyWorkingTreeError` with the dirty file list so the UI
   * can prompt the user to stash / discard / cancel.
   */
  async checkout(target: string, opts: { force?: boolean } = {}): Promise<void> {
    if (!opts.force) {
      const status = await this.git.status();
      if (status.files.length > 0) {
        throw new DirtyWorkingTreeError(
          status.files.map((f) => ({ path: f.path, index: f.index, working_dir: f.working_dir })),
        );
      }
    }
    const args = ["checkout"];
    if (opts.force) args.push("-f");
    args.push(target);
    await this.git.raw(args);
  }

  // ── Remotes / tags ─────────────────────────────────────────────────────────

  async remotes(): Promise<RemoteRow[]> {
    const rows = await this.git.getRemotes(true);
    return rows.map((r) => ({
      name: r.name,
      fetchUrl: r.refs.fetch ?? "",
      pushUrl: r.refs.push ?? "",
    }));
  }

  async tags(): Promise<TagRow[]> {
    try {
      const out = await this.git.raw(["tag", "--sort=-creatordate"]);
      return out
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((name) => ({ name }));
    } catch {
      return [];
    }
  }

  // ── Stash ──────────────────────────────────────────────────────────────────

  async stashList(): Promise<StashRow[]> {
    try {
      const list = await this.git.stashList();
      return list.all.map((entry, index) => ({
        index,
        message: entry.message,
        hash: entry.hash,
        date: entry.date,
      }));
    } catch {
      return [];
    }
  }

  async stashSave(message?: string, includeUntracked = false): Promise<void> {
    const args = ["stash", "push"];
    if (includeUntracked) args.push("--include-untracked");
    if (message && message.trim().length > 0) {
      args.push("-m", message.trim());
    }
    await this.git.raw(args);
  }

  async stashApply(index: number, pop = false): Promise<void> {
    await this.git.raw(["stash", pop ? "pop" : "apply", `stash@{${index}}`]);
  }

  async stashDrop(index: number): Promise<void> {
    await this.git.raw(["stash", "drop", `stash@{${index}}`]);
  }

  // ── Reset / merge ──────────────────────────────────────────────────────────

  async reset(mode: "soft" | "mixed" | "hard", target: string): Promise<void> {
    await this.git.raw(["reset", `--${mode}`, target]);
  }

  async merge(
    branch: string,
    opts: { noFastForward?: boolean; squash?: boolean } = {},
  ): Promise<{ conflicted?: string[] }> {
    const args = ["merge"];
    if (opts.noFastForward) args.push("--no-ff");
    if (opts.squash) args.push("--squash");
    args.push(branch);
    try {
      await this.git.raw(args);
      return {};
    } catch (err) {
      const status = await this.git.status().catch(() => null);
      const conflicted = status?.conflicted ?? [];
      if (conflicted.length > 0) throw new MergeConflictError(conflicted);
      throw err;
    }
  }

  // ── Commit details / graph ─────────────────────────────────────────────────

  /**
   * Single `git show` shell-out: header (hash, parents, author, date, subject,
   * body) + per-file name-status. Per-file diffs are fetched lazily via
   * `commitFileDiff()` so we don't pull megabytes of patch text on every click.
   */
  async commitDetails(hash: string): Promise<CommitDetails> {
    const US = "";
    const RS = ""; // record separator marks end of pretty body, before name-status
    const fmt = `%H${US}%P${US}%an${US}%ae${US}%aI${US}%s${US}%b${RS}`;
    const raw = await this.git.raw([
      "show",
      hash,
      "--no-color",
      `--pretty=format:${fmt}`,
      "--name-status",
    ]);
    const [headerPart, ...rest] = raw.split(RS);
    const fileLinesRaw = rest.join(RS);
    const parts = (headerPart ?? "").split(US);
    const h = parts[0] ?? hash;
    const parentsRaw = parts[1] ?? "";
    const authorName = parts[2] ?? "";
    const authorEmail = parts[3] ?? "";
    const date = parts[4] ?? "";
    const subject = parts[5] ?? "";
    const body = parts[6] ?? "";
    const parents = parentsRaw ? parentsRaw.split(" ").filter(Boolean) : [];

    const files: CommitFileChange[] = fileLinesRaw
      .split("\n")
      .map((s) => s.trim())
      .filter((l) => /^[AMDRCT]/.test(l))
      .map((l) => {
        const cols = l.split("\t");
        const code = cols[0] ?? "M";
        const status = code[0] as CommitFileChange["status"];
        if (status === "R" || status === "C") {
          return { path: cols[2] ?? "", status, renameFrom: cols[1] };
        }
        return { path: cols[1] ?? "", status };
      });

    return {
      hash: h,
      parents,
      author: { name: authorName, email: authorEmail },
      date,
      subject,
      body,
      files,
    };
  }

  async commitFileDiff(hash: string, path: string): Promise<string> {
    try {
      return await this.git.raw(["show", hash, "--", path]);
    } catch {
      return "";
    }
  }

  /**
   * Topologically-ordered commit list across all refs with lane indexes
   * pre-computed server-side. Open-lane algorithm: each lane waits for a
   * parent hash; the first parent inherits the lane, additional parents take a
   * free lane. Merge targets close any other lanes that were waiting on the
   * same hash.
   */
  async graph(opts: { max?: number; refs?: string[] } = {}): Promise<GraphNode[]> {
    const max = opts.max ?? 500;
    const US = "";
    const refs = opts.refs && opts.refs.length > 0 ? opts.refs : ["--all"];
    let raw = "";
    try {
      raw = await this.git.raw([
        "log",
        ...refs,
        `--max-count=${max}`,
        "--date-order",
        `--pretty=format:%H${US}%P${US}%D${US}%an${US}%aI${US}%s`,
      ]);
    } catch {
      return [];
    }

    type RawRow = {
      hash: string;
      parents: string[];
      refs: string[];
      author: string;
      date: string;
      subject: string;
    };
    const rows: RawRow[] = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(US);
        const hash = parts[0] ?? "";
        const parentsRaw = parts[1] ?? "";
        const refsRaw = parts[2] ?? "";
        const author = parts[3] ?? "";
        const date = parts[4] ?? "";
        const subject = parts[5] ?? "";
        const parents = parentsRaw ? parentsRaw.split(" ").filter(Boolean) : [];
        const refList = refsRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        return { hash, parents, refs: refList, author, date, subject };
      })
      .filter((r) => r.hash);

    // Lane assignment
    const lanes: (string | null)[] = [];
    const nodes: GraphNode[] = [];
    for (const c of rows) {
      let laneIdx = lanes.indexOf(c.hash);
      if (laneIdx < 0) {
        laneIdx = lanes.indexOf(null);
        if (laneIdx < 0) {
          lanes.push(null);
          laneIdx = lanes.length - 1;
        }
      }
      lanes[laneIdx] = c.parents[0] ?? null;
      const parentLanes: number[] = [laneIdx];
      for (let i = 1; i < c.parents.length; i++) {
        let l = lanes.indexOf(null);
        if (l < 0) {
          lanes.push(null);
          l = lanes.length - 1;
        }
        lanes[l] = c.parents[i] ?? null;
        parentLanes.push(l);
      }
      // Close any other lanes that were waiting for this commit (merge target)
      for (let i = 0; i < lanes.length; i++) {
        if (i !== laneIdx && lanes[i] === c.hash) lanes[i] = null;
      }
      nodes.push({
        hash: c.hash,
        parents: c.parents,
        refs: c.refs,
        author: c.author,
        date: c.date,
        subject: c.subject,
        lane: laneIdx,
        parentLanes,
      });
    }
    return nodes;
  }

  // ── Hunk staging ───────────────────────────────────────────────────────────

  /**
   * Apply a unified-diff patch fragment to the index. Bypasses simple-git's
   * `applyPatch` (which requires a temp file) and pipes the patch directly via
   * stdin. `--unidiff-zero` is required because line-level selections produce
   * zero-context hunks the default applier would reject.
   */
  async applyHunkPatch(patch: string, opts: { reverse?: boolean } = {}): Promise<void> {
    const args = ["apply", "--cached", "--unidiff-zero", "--whitespace=nowarn"];
    if (opts.reverse) args.push("--reverse");
    args.push("-");
    await runGitWithStdin(args, this.cwd, patch);
  }

  // ── Remote ops (fetch / pull / push) ───────────────────────────────────────

  async fetch(opts: RemoteOpOptions = {}): Promise<void> {
    const args = ["fetch"];
    if (opts.prune) args.push("--prune");
    if (opts.tags) args.push("--tags");
    if (opts.remote) {
      args.push(opts.remote);
      if (opts.branch) args.push(opts.branch);
    } else {
      args.push("--all");
    }
    await runGitWithProgress(args, {
      cwd: this.cwd,
      onProgress: opts.onProgress,
      signal: opts.signal,
    });
  }

  async pull(opts: RemoteOpOptions = {}): Promise<void> {
    const args = ["pull"];
    if (opts.rebase) args.push("--rebase");
    if (opts.remote) args.push(opts.remote);
    if (opts.branch) args.push(opts.branch);
    await runGitWithProgress(args, {
      cwd: this.cwd,
      onProgress: opts.onProgress,
      signal: opts.signal,
    });
  }

  async push(opts: RemoteOpOptions = {}): Promise<void> {
    const args = ["push"];
    // Never bare --force; always --force-with-lease for safety.
    if (opts.force) args.push("--force-with-lease");
    if (opts.setUpstream) args.push("--set-upstream");
    if (opts.tags) args.push("--tags");
    if (opts.remote) args.push(opts.remote);
    if (opts.branch) args.push(opts.branch);
    await runGitWithProgress(args, {
      cwd: this.cwd,
      onProgress: opts.onProgress,
      signal: opts.signal,
    });
  }
}
