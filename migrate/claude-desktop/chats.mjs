#!/usr/bin/env node
// Claude Desktop chats → Markdown in the data repository and, optionally, → OpenClaw sessions.
// The source is read-only; chat files are derived: rewritten when the source changed, otherwise
// left alone.
//
//   node migrate/claude-desktop/chats.mjs --to <repository>/chats [--from <folder>] [--secrets <.env>]… [--tz <zone>] [--dry-run]
//   node migrate/claude-desktop/chats.mjs --openclaw-stage <temp folder> [--from …] [--secrets …]
//
// --from: the Claude Desktop account folder or an export (source.mjs). Defaults to the live one.
// --claude-code '<glob>': Claude Code project folders where Claude Desktop chats were continued
// (`claude --resume`); their records are added to the chat without duplicates. Quote the glob, the
// script expands it; defaults to all of ~/.claude/projects/* (only a chat's own transcript is matched);
// --no-claude-code means Claude Desktop only.
// --secrets: a .env whose secret key values are redacted (repeatable); ~/.openclaw/.env is always
// used if present. Key and password patterns are redacted regardless.
// --openclaw-stage: a folder in the Claude Code layout (projects/<agent>/<id>.jsonl, sessions-index.json)
// plus import-plan.json for the stock import; see docs/features/chats.md, "As OpenClaw sessions". It holds
// transcript copies (without secrets): delete it after the import.
import { existsSync, globSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { chatMarkdown, chatPath, filesPath, stageSession } from "./chats-core.mjs";
import { agentId } from "./projects-core.mjs";
import { attachmentsOf, continuationIndex, liveAccountDir, readSecrets, readSessions, readSpaces, writeChatsIndex } from "./source.mjs";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const opts = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const flag = (name) => args.includes(name);

const from = opt("--from") ? path.resolve(opt("--from")) : liveAccountDir();
const to = opt("--to") && path.resolve(opt("--to"));
const stage = opt("--openclaw-stage") && path.resolve(opt("--openclaw-stage"));
if (!from || (!to && !stage)) {
  console.error("Required: --to <repository>/chats or --openclaw-stage <folder>, and a Claude Desktop folder (--from or the live one in ~/.config/Claude)");
  process.exit(1);
}
const tz = opt("--tz") || Intl.DateTimeFormat().resolvedOptions().timeZone;
const dry = flag("--dry-run");
let secrets;
try { secrets = readSecrets(opts("--secrets")); } catch (e) { console.error(e.message); process.exit(1); }
const spaceName = new Map((readSpaces(from) || []).map((s) => [s.id, s.name]));
const ccGlobs = flag("--no-claude-code") ? [] : opts("--claude-code").length ? opts("--claude-code") : ["~/.claude/projects/*"];
const ccDirs = ccGlobs.flatMap((g) => globSync(g.replace(/^~(?=\/)/, os.homedir()))).filter((d) => statSync(d).isDirectory()).sort();
const index = ccDirs.length ? continuationIndex(ccDirs) : null;
const used = new Set();

console.log(`Source: ${from}${index ? `\nClaude Code continuations: folders ${ccDirs.length}, files ${index.all.length}` : ""}\nTarget: ${to || stage}${dry ? "  [dry-run]" : ""}\nTime zone: ${tz}; secret files: ${secrets.used.length}, values: ${secrets.values.length}\n`);

const stats = { continued: 0, sessions: 0, written: 0, same: 0, empty: 0, redacted: 0, bytes: 0, bad: 0 };
const perAgent = new Map();
const staged = new Map();   // agent → sessions-index.json entries
const plan = [];
for (const { meta: m, dir, records, bad, extra, continuedAt } of readSessions(from, index)) {
  stats.sessions++;
  for (const f of extra) used.add(f);
  // Continued in Claude Code: "updated" is the last new message; copies with nothing new do not move the date.
  const meta = continuedAt && continuedAt > (m.lastActivityAt || m.createdAt) ? { ...m, lastActivityAt: continuedAt } : m;
  if (continuedAt) stats.continued++;
  stats.bad += bad;
  if (!records.length) { stats.empty++; continue; }
  const project = spaceName.get(meta.spaceId) || null;
  const agent = project ? agentId(project) : "main";
  perAgent.set(agent, (perAgent.get(agent) || 0) + 1);

  if (stage) {
    const s = stageSession(meta, records, { agent, secrets: secrets.values });
    stats.redacted += s.redacted;
    stats.bytes += Buffer.byteLength(s.jsonl);
    if (!staged.has(agent)) staged.set(agent, []);
    staged.get(agent).push(s.entry);
    plan.push({ threadId: s.threadId, agentId: agent, displayName: s.displayName });
    if (!dry) {
      mkdirSync(path.join(stage, "projects", agent), { recursive: true });
      writeFileSync(path.join(stage, "projects", agent, `${s.threadId}.jsonl`), s.jsonl);
    }
    continue;
  }

  const rel = chatPath(meta, agent, tz);
  // Attachments go to the file store (files.mjs), not git; the chat front matter holds their path there.
  const files = attachmentsOf(dir).length ? filesPath(meta, agent, tz) : null;
  const { text, count } = chatMarkdown(meta, records, { agent, project, tz, secrets: secrets.values, files });
  stats.redacted += count;
  stats.bytes += Buffer.byteLength(text);
  const p = path.join(to, ...rel.split("/"));
  if (existsSync(p) && readFileSync(p, "utf8") === text) { stats.same++; continue; }
  stats.written++;
  if (dry) continue;
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, text);
}

if (stage && !dry) {
  for (const [agent, entries] of staged) {
    writeFileSync(path.join(stage, "projects", agent, "sessions-index.json"), JSON.stringify({ version: 1, entries }, null, 1));
  }
  writeFileSync(path.join(stage, "import-plan.json"), JSON.stringify(plan, null, 1));
}
// The table of contents covers the front matter of all chats/ files, including OpenClaw exports (migrate/openclaw).
if (to && !dry) { mkdirSync(to, { recursive: true }); writeChatsIndex(to, tz); }

for (const [a, n] of [...perAgent].sort()) console.log(`  ${a.padEnd(10)} chats ${n}`);
const done = stage ? `staged for import ${plan.length}` : `written ${stats.written}, unchanged ${stats.same}`;
console.log(`\nDone: sessions ${stats.sessions} (empty ${stats.empty}); ${done}.`);
if (index) {
  const orphan = index.all.filter((f) => !used.has(f));
  console.log(`Claude Code continuations: chats with new messages ${stats.continued}; files matched to chats ${used.size} of ${index.all.length}` +
    (orphan.length ? `; unmatched (not Claude Desktop chats, not migrated): ${orphan.length}, e.g. ${orphan.slice(0, 3).map((f) => path.basename(path.dirname(f)) + "/" + path.basename(f)).join(", ")}` : "") + ".");
}
console.log(`Size ${(stats.bytes / 1e6).toFixed(1)} MB; secrets redacted ${stats.redacted}${stats.bad ? `; broken JSONL lines skipped ${stats.bad}` : ""}.`);
