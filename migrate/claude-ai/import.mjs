#!/usr/bin/env node
// claude.ai cloud chats → Claude Code sessions in a Claude Desktop folder (and, with --to, the text
// archive). Input: the official claude.ai data export (Settings → Privacy → Export data): a folder
// with its zip archives (conversations-*.zip, projects-*.zip), an unpacked folder, or conversations.json.
// After the import the chat tree, adoption by agents and `claude --resume` see these chats like
// local ones; the chats-sync timer picks them up on its next run.
//
// Never overwrites local chats: a session file is written only if it is new or was written by this
// import before (marker entrypoint "claude-ai-export"); anything else is skipped and reported.
// Re-running with a newer export updates changed chats only.
//
//   node migrate/claude-ai/import.mjs --from ~/Downloads [--root <projects folder>] [--folder _no_space]
//        [--to <profile>/chats --secrets <.env>… --tz <IANA zone>] [--dry-run]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, openSync, readSync, closeSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { chatMarkdown, chatPath } from "../claude-desktop/chats-core.mjs";
import { agentId } from "../claude-desktop/projects-core.mjs";
import { readSecrets, writeChatsIndex } from "../claude-desktop/source.mjs";
import { archiveMeta, conversationFolder, conversationRecords, ownedByImport, sessionFile } from "./core.mjs";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const opts = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const home = os.homedir();
const tilde = (p) => p.replace(/^~(?=\/|$)/, home);

const from = path.resolve(tilde(opt("--from") || "~/Downloads"));
const rootArg = opt("--root") || process.env.WORKBENCH_CLAUDE_DESKTOP_ROOT;
if (!rootArg) { console.error("Set the projects folder: --root <folder> or WORKBENCH_CLAUDE_DESKTOP_ROOT."); process.exit(2); }
const root = path.resolve(tilde(rootArg));
const fallback = opt("--folder") || "_no_space";
const claudeDir = path.resolve(tilde(opt("--claude-dir") || "~/.claude"));
const to = opt("--to") ? path.resolve(tilde(opt("--to"))) : null;
const tz = opt("--tz") || Intl.DateTimeFormat().resolvedOptions().timeZone;
const dry = args.includes("--dry-run");

/** Newest archive of a category in the export folder (conversations-000.zip …). */
function newestZip(dir, category) {
  const zips = readdirSync(dir).filter((n) => new RegExp(`^${category}-\\d+\\.zip$`).test(n))
    .map((n) => path.join(dir, n)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return zips[0];
}

const unzipList = (zip) => execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).split("\n").filter(Boolean);
const unzipRead = (zip, entry) => execFileSync("unzip", ["-p", zip, entry], { encoding: "utf8", maxBuffer: 1 << 30 });

/** conversations.json and project names (uuid → name) from any of the accepted input forms. */
function loadExport(input) {
  if (input.endsWith(".json")) return { conversations: JSON.parse(readFileSync(input, "utf8")), projects: new Map() };
  const projects = new Map();
  const unpacked = [path.join(input, "conversations.json"), path.join(input, "conversations-000", "conversations.json")].find(existsSync);
  if (unpacked) {
    const pdir = [path.join(input, "projects"), path.join(input, "projects-000", "projects")].find(existsSync);
    for (const n of pdir ? readdirSync(pdir).filter((f) => f.endsWith(".json")) : []) {
      const p = JSON.parse(readFileSync(path.join(pdir, n), "utf8")); if (p.uuid && p.name) projects.set(p.uuid, p.name);
    }
    return { conversations: JSON.parse(readFileSync(unpacked, "utf8")), projects };
  }
  const conv = newestZip(input, "conversations");
  if (!conv) throw new Error(`no claude.ai export in ${input}: expected conversations-*.zip, conversations.json or its folder`);
  const proj = newestZip(input, "projects");
  for (const entry of proj ? unzipList(proj).filter((e) => e.endsWith(".json")) : []) {
    const p = JSON.parse(unzipRead(proj, entry)); if (p.uuid && p.name) projects.set(p.uuid, p.name);
  }
  return { conversations: JSON.parse(unzipRead(conv, "conversations.json")), projects };
}

function head(file) {
  const fd = openSync(file, "r");
  try { const b = Buffer.alloc(4096); return b.toString("utf8", 0, readSync(fd, b, 0, 4096, 0)); } finally { closeSync(fd); }
}

const { conversations, projects } = loadExport(from);
const folders = new Set(existsSync(root) ? readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : []);
const secrets = to ? readSecrets(opts("--secrets")) : { values: [] };
console.log(`claude.ai export: ${from}\nChats: ${conversations.length}; projects: ${projects.size}; root: ${root}${dry ? " (dry run)" : ""}`);

const count = { written: 0, updated: 0, unchanged: 0, empty: 0, notOurs: 0, archived: 0 };
for (const conv of conversations) {
  const folder = conversationFolder(conv, projects, folders, fallback);
  const cwd = path.join(root, folder);
  const records = conversationRecords(conv, cwd);
  if (!records.length) { count.empty++; continue; }
  const file = sessionFile(claudeDir, cwd, conv.uuid);
  const text = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  if (existsSync(file)) {
    if (!ownedByImport(head(file))) { count.notOurs++; console.log(`  ⚠ ${conv.name}: ${file} is not from this import — left as is`); continue; }
    if (readFileSync(file, "utf8") === text) count.unchanged++;
    else { count.updated++; if (!dry) writeFileSync(file, text, { mode: 0o600 }); }
  } else {
    count.written++;
    if (!dry) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text, { mode: 0o600 }); }
  }
  if (to) {
    const agent = folder === fallback ? "main" : agentId(folder);
    const meta = archiveMeta(conv, folder);
    const { text: md } = chatMarkdown(meta, records.filter((r) => r.message), { agent, project: folder === fallback ? null : folder, tz, secrets: secrets.values, source: "claude-ai" });
    const out = path.join(to, chatPath(meta, agent, tz));
    if (!existsSync(out) || readFileSync(out, "utf8") !== md) {
      count.archived++;
      if (!dry) { mkdirSync(path.dirname(out), { recursive: true }); writeFileSync(out, md); }
    }
  }
}
if (to && !dry && count.archived) writeChatsIndex(to, tz);
console.log(`Done: written ${count.written}, updated ${count.updated}, unchanged ${count.unchanged}, empty ${count.empty}, `
  + `not ours (kept) ${count.notOurs}${to ? `; archive files written ${count.archived}` : ""}.`);
if (count.notOurs) process.exitCode = 1;
