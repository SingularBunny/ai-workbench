// Commit of what the chats timer writes into the data repository (profile CHATS.commit): only the listed
// paths, so the owner's own edits elsewhere (plans, notes) are never swept in, and the repository's hooks
// (secret checks) run as for any commit. Nothing is pushed: the commits stay local until the owner pushes.
// A repository busy with a commit, merge or rebase is left alone until the next run.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const run = (git, cwd, args) => spawnSync(git, ["-C", cwd, ...args], { encoding: "utf8" });

/**
 * Commits the changes under `paths` (absolute, all in one repository) with `message`.
 * Returns { status: "committed", files } | { status: "clean" } | { status: "skipped", reason }; throws when
 * git or a hook refuses (the paths are unstaged again then).
 */
export function commitPaths({ paths, message, git = "git" }) {
  const existing = paths.filter((p) => existsSync(p));
  if (!existing.length) return { status: "skipped", reason: "none of the paths exist" };
  const top = run(git, existing[0], ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0) return { status: "skipped", reason: `not a git repository: ${existing[0]}` };
  const repo = top.stdout.trim();
  const gitDir = path.resolve(repo, run(git, repo, ["rev-parse", "--git-dir"]).stdout.trim());
  const busy = ["index.lock", "MERGE_HEAD", "REBASE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD"]
    .find((f) => existsSync(path.join(gitDir, f)));
  if (busy) return { status: "skipped", reason: `repository busy (${busy})` };
  const rel = existing.map((p) => path.relative(repo, p) || ".");
  if (rel.some((r) => r.startsWith(".."))) throw new Error(`paths outside ${repo}`);

  const add = run(git, repo, ["add", "-A", "--", ...rel]);
  if (add.status !== 0) throw new Error(`git add: ${add.stderr.trim()}`);
  const staged = run(git, repo, ["diff", "--cached", "--name-only", "--", ...rel]).stdout.split("\n").filter(Boolean);
  if (!staged.length) return { status: "clean" };
  // A pathspec commit takes only these paths, even when the owner has other files staged. Only paths
  // with changes are named: git refuses a pathspec it knows no file under (an empty folder).
  const changed = rel.filter((r) => r === "." || staged.some((f) => f === r || f.startsWith(`${r}/`)));
  const commit = run(git, repo, ["commit", "-q", "-m", message, "--", ...changed]);
  if (commit.status !== 0) {
    run(git, repo, ["reset", "-q", "--", ...rel]);
    throw new Error(`git commit refused (hook or git): ${(commit.stdout + commit.stderr).trim().split("\n").slice(-5).join(" | ")}`);
  }
  return { status: "committed", files: staged.length };
}
