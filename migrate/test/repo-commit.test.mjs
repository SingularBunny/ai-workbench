import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { commitPaths } from "../repo-commit.mjs";

let repo;
const git = (...args) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
const write = (rel, text) => { mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); writeFileSync(path.join(repo, rel), text); };
const head = () => git("log", "--format=%s", "-1").stdout.trim();
const committed = () => git("show", "--name-only", "--format=", "HEAD").stdout.split("\n").filter(Boolean).sort();
const at = (...rel) => rel.map((r) => path.join(repo, r));

beforeEach(() => {
  repo = mkdtempSync(path.join(os.tmpdir(), "aiwb-repo-commit-"));
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "core.hooksPath", ".git/hooks");
  write("README.md", "x\n");
  write("chats/a.md", "a\n");
  git("add", "-A");
  git("commit", "-qm", "init");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("commits new and changed files under the paths only, leaving other edits alone", () => {
  write("chats/a.md", "a2\n");
  write("chats/new.md", "n\n");
  write("main/memory/fact.md", "f\n");
  write("dev/plan.md", "owner draft\n");
  const r = commitPaths({ paths: at("chats", "main"), message: "Sync: test" });
  assert.deepEqual(r, { status: "committed", files: 3 });
  assert.equal(head(), "Sync: test");
  assert.deepEqual(committed(), ["chats/a.md", "chats/new.md", "main/memory/fact.md"]);
  assert.match(git("status", "--short").stdout, /\?\? dev\//);
});

test("a file the owner staged outside the paths stays staged and out of the commit", () => {
  write("dev/plan.md", "staged by owner\n");
  git("add", "dev/plan.md");
  write("chats/a.md", "a3\n");
  assert.equal(commitPaths({ paths: at("chats"), message: "Sync: test" }).status, "committed");
  assert.deepEqual(committed(), ["chats/a.md"]);
  assert.equal(git("diff", "--cached", "--name-only").stdout.trim(), "dev/plan.md");
});

test("an empty folder among the paths does not stop the commit", () => {
  mkdirSync(path.join(repo, "learned-skills"));
  write("chats/a.md", "a6\n");
  assert.equal(commitPaths({ paths: at("chats", "learned-skills"), message: "Sync: test" }).status, "committed");
  assert.deepEqual(committed(), ["chats/a.md"]);
});

test("nothing changed: clean, no commit", () => {
  assert.deepEqual(commitPaths({ paths: at("chats"), message: "Sync: test" }), { status: "clean" });
  assert.equal(head(), "init");
});

test("missing paths and a busy repository are skipped", () => {
  assert.equal(commitPaths({ paths: at("nope"), message: "m" }).status, "skipped");
  write("chats/a.md", "a4\n");
  writeFileSync(path.join(repo, ".git", "MERGE_HEAD"), "0".repeat(40) + "\n");
  const r = commitPaths({ paths: at("chats"), message: "m" });
  assert.equal(r.status, "skipped");
  assert.match(r.reason, /MERGE_HEAD/);
  assert.equal(head(), "init");
});

test("a refusing hook throws and leaves nothing staged", () => {
  const hook = path.join(repo, ".git", "hooks", "pre-commit");
  writeFileSync(hook, "#!/bin/sh\necho 'secret found' >&2\nexit 1\n");
  chmodSync(hook, 0o755);
  write("chats/a.md", "a5\n");
  assert.throws(() => commitPaths({ paths: at("chats"), message: "m" }), /refused.*secret found/);
  assert.equal(head(), "init");
  assert.equal(git("diff", "--cached", "--name-only").stdout.trim(), "");
});
