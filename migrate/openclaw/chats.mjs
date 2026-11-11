#!/usr/bin/env node
// OpenClaw chats → Markdown in chats/ of the data repository (backup): the same layout and secret
// redaction as Claude Desktop chats; the chats/INDEX.md table of contents is shared. Reads through the
// Gateway (sessions.list, chat.history), not SQLite: the agent database also holds keys. A session whose
// update time has not changed is not re-read; chats adopted from Claude Desktop are not duplicated:
// such a session exports only what was added in OpenClaw (the continues: field is the source chat id).
//
//   node migrate/openclaw/chats.mjs --to <repository>/chats [--secrets <.env>]… [--tz <zone>] [--agent <id>] [--all] [--dry-run]
//
// The "has it changed" check uses the session updatedAt, like rsync's quick check by file time; it
// misses an edit that does not move updatedAt, in which case --all re-reads every history.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { readSecrets, scanChats, writeChatsIndex } from "../claude-desktop/source.mjs";
import { continuesOf, isImported, segmentOf, sessionMarkdown, sessionPath, sessionTitle } from "./chats-core.mjs";

const run = promisify(execFile);
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const opts = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const to = opt("--to") && path.resolve(opt("--to"));
if (!to) { console.error("--to <repository>/chats is required"); process.exit(1); }
const tz = opt("--tz") || Intl.DateTimeFormat().resolvedOptions().timeZone;
const only = opt("--agent");
const dry = args.includes("--dry-run");
const all = args.includes("--all");
const bin = process.env.OPENCLAW_BIN || "openclaw";
let secrets;
try { secrets = readSecrets(opts("--secrets")); } catch (e) { console.error(e.message); process.exit(1); }

async function call(method, params) {
  const { stdout } = await run(bin, ["gateway", "call", method, "--params", JSON.stringify(params), "--json", "--timeout", "600000"], { maxBuffer: 256 << 20 });
  const r = JSON.parse(stdout);
  if (r.ok === false) throw new Error(`${method}: ${r.error?.message || JSON.stringify(r.error)}`);
  return r;
}

async function listSessions() {
  const out = [];
  for (let offset = 0; ;) {
    // archived: "all" includes archived sessions: sessions.list omits them by default.
    const r = await call("sessions.list", { limit: 200, offset, archived: "all" });
    out.push(...r.sessions);
    if (!r.hasMore || !r.sessions.length) return out;
    offset = r.nextOffset ?? offset + r.sessions.length;
  }
}

/** The whole session history in order: chat.history returns pages from the end, offset counts from the last. */
async function history(s) {
  const byId = new Map();
  for (let offset = 0; ;) {
    const r = await call("chat.history", { sessionKey: s.key, agentId: s.agentId, limit: 1000, offset, maxBytes: 64 << 20, toolResultMaxChars: 2000 });
    for (const m of r.messages) byId.set(m.__openclaw?.id ?? `${offset}:${byId.size}`, m);
    if (!r.hasMore || !r.messages.length) break;
    offset += r.messages.length;
  }
  return [...byId.values()].sort((a, b) => (a.__openclaw?.seq ?? 0) - (b.__openclaw?.seq ?? 0));
}

console.log(`OpenClaw Gateway → ${to}${dry ? "  [dry-run]" : ""}\nTime zone: ${tz}; secret files: ${secrets.used.length}, values: ${secrets.values.length}\n`);
// A file is one segment of the session history (segmentOf): after a reset a new file starts, the old one is left alone.
const files = scanChats(to).filter((r) => r.fm.source === "openclaw");
const known = new Map(files.map((r) => [`${r.fm.session}/${r.fm.segment}`, r]));
const latest = new Map();   // sessionId → file of the latest segment (by updated)
for (const r of files) if (!latest.has(r.fm.session) || r.fm.updated > latest.get(r.fm.session).fm.updated) latest.set(r.fm.session, r);
// Sessions without their own text (only adopted from Claude Desktop, or empty) have no file, and
// without remembering them every run would re-read hundreds of histories. sessionId → updatedAt.
const skipFile = path.join(to, ".openclaw-skip.json");
const skip = existsSync(skipFile) ? JSON.parse(readFileSync(skipFile, "utf8")) : {};
const stats = { sessions: 0, written: 0, same: 0, skipped: 0, onlyImported: 0, empty: 0, redacted: 0, errors: 0 };
const perAgent = new Map();
for (const s of (await listSessions()).filter((x) => !only || x.agentId === only)) {
  stats.sessions++;
  const last = latest.get(s.sessionId);
  if (!all && last && last.fm.updated === new Date(s.updatedAt).toISOString()) { stats.same++; continue; }
  if (!all && !last && skip[s.sessionId] === s.updatedAt) { stats.skipped++; continue; }
  let full;
  try { full = await history(s); } catch (e) { stats.errors++; console.log(`  ✗ ${s.key}: ${e.message.split("\n")[0]}`); continue; }
  // Own messages are everything except adopted ones; but a segment with only system messages (Reset) is not a chat.
  const own = full.filter((m) => !isImported(m) && ["user", "assistant", "toolResult", "system"].includes(m.role));
  if (!own.some((m) => m.role !== "system")) { stats[full.length ? "onlyImported" : "empty"]++; skip[s.sessionId] = s.updatedAt; continue; }
  delete skip[s.sessionId];
  const segment = segmentOf(full);
  const was = known.get(`${s.sessionId}/${segment}`);
  const title = sessionTitle(s, own);
  const rel = sessionPath(s, title, tz, { segment, startedAt: full[0]?.timestamp ?? full[0]?.__openclaw?.recordTimestampMs });
  const { text, count } = sessionMarkdown(s, own, { title, tz, secrets: secrets.values, continues: continuesOf(full), segment });
  stats.redacted += count;
  const p = path.join(to, ...rel.split("/"));
  if (existsSync(p) && readFileSync(p, "utf8") === text) { stats.same++; continue; }
  stats.written++;
  perAgent.set(s.agentId, (perAgent.get(s.agentId) || 0) + 1);
  console.log(`  ${s.agentId.padEnd(10)} ${title.slice(0, 50).padEnd(50)} messages ${own.length}${was && was.rel !== rel ? " (renamed)" : ""}`);
  if (dry) continue;
  // The title changed in the Control UI: the file of the same segment moves, the old one is not left orphaned.
  if (was && was.rel !== rel) unlinkSync(path.join(to, ...was.rel.split("/")));
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, text);
}
if (!dry) {
  mkdirSync(to, { recursive: true });
  writeFileSync(skipFile, JSON.stringify(skip, null, 1) + "\n");
  if (stats.written) writeChatsIndex(to, tz);
}

for (const [a, n] of [...perAgent].sort()) console.log(`  ${a.padEnd(10)} written ${n}`);
console.log(`\nDone: sessions ${stats.sessions}; written ${stats.written}, unchanged ${stats.same + stats.skipped}; only adopted ` +
  `from Claude Desktop ${stats.onlyImported}, empty ${stats.empty}; secrets redacted ${stats.redacted}; errors ${stats.errors}.`);
process.exit(stats.errors ? 1 : 0);
