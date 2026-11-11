#!/usr/bin/env node
// Chats in one command, run by the installer timer (docs/features/chats.md):
//   1. the chat tree by project (claude-desktop/claude-code-catalog.mjs), and adoption of new chats by agents
//      when the bridge plugin cannot adopt them in the Gateway itself;
//   2. the text archive of Claude Desktop chats with their Claude Code continuations (claude-desktop/chats.mjs);
//   3. the text archive of OpenClaw sessions (openclaw/chats.mjs);
//   4. secrets the exporters' own rules missed (cloud keys, VPN keys, webhooks) replaced in the archive with
//      ‹secret›, found by gitleaks (https://github.com/gitleaks/gitleaks) when it is installed;
//   5. a copy of the agents' learned skills (Skill Workshop, <state>/agents/<id>/agent/workshop-skills)
//      in the data repository: OpenClaw keeps them only in its own state and rejects outside links;
//   6. a local commit of the given paths (--commit, repeatable; migrate/repo-commit.mjs), never pushed.
// A step without its inputs is skipped: no --root skips the first, no --to the archives, no Claude
// Desktop folder the second, no --skills-to the fourth, no --commit the last. A failed step does not stop the rest; the
// exit code is 1 if any step failed.
//
//   node migrate/chats-sync.mjs [--root <projects folder>] [--to <profile>/chats] [--secrets <.env>]… [--tz <zone>] [--skills-to <profile>/learned-skills] [--commit <path>]…
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { REDACTED } from "./claude-desktop/chats-core.mjs";
import { liveAccountDir } from "./claude-desktop/source.mjs";
import { commitPaths } from "./repo-commit.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const opts = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const tilde = (p) => p && path.resolve(p.replace(/^~(?=\/|$)/, os.homedir()));

const root = tilde(opt("--root"));
const to = tilde(opt("--to"));
const pass = [...opts("--secrets").flatMap((s) => ["--secrets", tilde(s)]), ...(opt("--tz") ? ["--tz", opt("--tz")] : [])];
const steps = [
  root && ["chat tree and adoption by agents", "claude-desktop/claude-code-catalog.mjs", ["--root", root]],
  to && liveAccountDir() && ["Claude Desktop chat archive", "claude-desktop/chats.mjs", ["--to", to, ...pass]],
  to && ["OpenClaw session archive", "openclaw/chats.mjs", ["--to", to, ...pass]],
].filter(Boolean);

const skillsTo = tilde(opt("--skills-to"));
const stateDir = process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw");

/** Learned skills → <to>/<agent>/: a copy of the live ones, removing what disappeared. The version
 *  archive (.archive) is not copied: OpenClaw keeps and restores it itself (skills workshop restore). */
function mirrorLearnedSkills(to) {
  const agents = path.join(stateDir, "agents");
  let copied = 0;
  const seen = new Set();
  for (const id of existsSync(agents) ? readdirSync(agents) : []) {
    const src = path.join(agents, id, "agent", "workshop-skills");
    const live = existsSync(src) ? readdirSync(src).filter((n) => !n.startsWith(".")) : [];
    if (!live.length) continue;
    const dst = path.join(to, id);
    rmSync(dst, { recursive: true, force: true });
    mkdirSync(dst, { recursive: true });
    for (const n of live) cpSync(path.join(src, n), path.join(dst, n), { recursive: true, dereference: false });
    seen.add(id);
    copied += live.length;
  }
  // An agent without learned skills (or a removed one): drop its copy.
  for (const id of existsSync(to) ? readdirSync(to) : []) if (!seen.has(id)) rmSync(path.join(to, id), { recursive: true, force: true });
  console.log(`Learned skills: ${copied} (agents ${seen.size}) → ${to}`);
}

/** Replaces in the archive every secret gitleaks finds, with the rules of the repository's .gitleaks.toml
 *  if it has one. Values go through a private temp file only and are never printed. */
function redactWithGitleaks(dir) {
  const repo = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).stdout.trim();
  const config = repo && existsSync(path.join(repo, ".gitleaks.toml")) ? ["--config", path.join(repo, ".gitleaks.toml")] : [];
  const tmp = mkdtempSync(path.join(os.tmpdir(), "aiwb-gitleaks-"));
  try {
    const report = path.join(tmp, "report.json");
    const r = spawnSync("gitleaks", ["dir", dir, ...config, "--no-banner", "--log-level", "error", "--exit-code", "0",
      "--report-format", "json", "--report-path", report], { encoding: "utf8" });
    if (r.error || r.status !== 0) throw new Error(r.error?.message || r.stderr.trim() || `exit ${r.status}`);
    const byFile = new Map();
    for (const f of JSON.parse(readFileSync(report, "utf8"))) {
      if (!f.Secret || f.Secret.length < 8) continue;
      const file = path.isAbsolute(f.File) ? f.File : path.join(dir, f.File);
      if (!byFile.has(file)) byFile.set(file, new Set());
      byFile.get(file).add(f.Secret);
    }
    for (const [file, secrets] of byFile) {
      let text = readFileSync(file, "utf8");
      for (const s of [...secrets].sort((a, b) => b.length - a.length)) text = text.split(s).join(REDACTED);
      writeFileSync(file, text);
    }
    console.log(`Secrets replaced by gitleaks: files ${byFile.size}`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

let failed = 0;
for (const [title, script, argv] of steps) {
  const started = Date.now();
  console.log(`\n=== ${title}`);
  const r = spawnSync(process.execPath, [path.join(here, script), ...argv], { stdio: "inherit" });
  if (r.status !== 0) { failed++; console.log(`✗ ${title}: exit ${r.status ?? r.signal}`); }
  console.log(`(${Math.round((Date.now() - started) / 1000)} s)`);
}
if (to && existsSync(to) && spawnSync("gitleaks", ["version"]).status === 0) {
  console.log("\n=== secrets in the archive (gitleaks)");
  try { redactWithGitleaks(to); } catch (e) { failed++; console.log(`✗ secrets in the archive: ${e.message}`); }
}
if (skillsTo) {
  console.log("\n=== learned skills copy");
  try { mirrorLearnedSkills(skillsTo); } catch (e) { failed++; console.log(`✗ learned skills copy: ${e.message}`); }
}
const commit = opts("--commit").map(tilde);
if (commit.length) {
  console.log("\n=== commit to the data repository");
  try {
    const r = commitPaths({ paths: commit, message: "Sync: chat archive, agent memory and learned skills" });
    console.log(r.status === "committed" ? `Committed ${r.files} file(s), not pushed` : r.status === "clean" ? "Nothing to commit" : `Skipped: ${r.reason}`);
  } catch (e) { failed++; console.log(`✗ commit: ${e.message}`); }
}
if (!steps.length && !skillsTo && !commit.length) console.log("Nothing to do: pass --root, --to, --skills-to and/or --commit.");
process.exit(failed ? 1 : 0);
