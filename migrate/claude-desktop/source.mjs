// Reads Claude Desktop data for migration: the live account folder or an export. Read-only;
// chat files (.credentials.json, .audit-key, uploads, outputs) are not opened.
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { frontmatter, indexMarkdown, mergeTranscripts, secretValues } from "./chats-core.mjs";

/** ~/.config/Claude/local-agent-mode-sessions/<…>/<account>: the folder holding spaces.json. */
export function liveAccountDir(home = os.homedir()) {
  const base = path.join(home, ".config", "Claude", "local-agent-mode-sessions");
  if (!existsSync(base)) return null;
  for (const root of readdirSync(base).filter((d) => d !== "skills-plugin")) {
    for (const acc of readdirSync(path.join(base, root))) {
      const dir = path.join(base, root, acc);
      if (existsSync(path.join(dir, "spaces.json"))) return dir;
    }
  }
  return null;
}

/** Projects: spaces.json in the account folder or spaces/spaces.json in an export. */
export function readSpaces(from) {
  const file = [path.join(from, "spaces.json"), path.join(from, "spaces", "spaces.json")].find(existsSync);
  return file ? JSON.parse(readFileSync(file, "utf8")).spaces : null;
}

/** Shared memory: memory/memory in the account folder or global_memory/memory in an export. */
export function globalMemoryDir(from) {
  return [path.join(from, "memory", "memory"), path.join(from, "global_memory", "memory")].find(existsSync) || null;
}

function readJsonl(file) {
  const out = [];
  let bad = 0;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { bad++; }
  }
  return { out, bad };
}
const jsonlIn = (dir) => (existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".jsonl")).sort().map((n) => path.join(dir, n)) : []);

/** Session files: live Claude Desktop (local_<id>.json + .claude/projects) or an export (metadata.json). */
function sessionFiles(from) {
  const out = [];
  if (existsSync(path.join(from, "sessions"))) {
    for (const space of readdirSync(path.join(from, "sessions"))) {
      for (const d of readdirSync(path.join(from, "sessions", space))) {
        const dir = path.join(from, "sessions", space, d);
        if (existsSync(path.join(dir, "metadata.json"))) out.push({ metaFile: path.join(dir, "metadata.json"), dir, files: jsonlIn(dir) });
      }
    }
    return out;
  }
  for (const n of readdirSync(from).filter((n) => /^local_.*\.json$/.test(n))) {
    const dir = path.join(from, n.replace(/\.json$/, ""));
    const proj = path.join(dir, ".claude", "projects");
    out.push({ metaFile: path.join(from, n), dir, files: existsSync(proj) ? readdirSync(proj).flatMap((d) => jsonlIn(path.join(proj, d))) : [] });
  }
  return out;
}

/** Session headers by creation time: { meta, dir, files }, without reading the transcripts. */
export function sessionList(from) {
  return sessionFiles(from).map((s) => ({ ...s, meta: JSON.parse(readFileSync(s.metaFile, "utf8")) }))
    .sort((a, b) => a.meta.createdAt - b.meta.createdAt);
}

/** Session attachments: uploads/ and outputs/ next to it, as paths relative to the session folder. */
export function attachmentsOf(dir) {
  const out = [];
  const walk = (rel) => {
    for (const e of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) walk(r);
      else if (e.isFile()) out.push(r);
    }
  };
  for (const k of ["uploads", "outputs"]) if (existsSync(path.join(dir, k))) walk(k);
  return out.sort();
}

/**
 * Claude Desktop chats continued in Claude Code: the same transcript in the Claude Code layout
 * (<folder>/<CLI session id>.jsonl, chat parts as separate files). A file belongs to a chat by
 * name or, for parts, by the uuids of its first records, without reading whole files: they run to gigabytes.
 * dirs are Claude Code project folders (…/.claude/projects/<project>).
 */
export function continuationIndex(dirs, sample = 20) {
  const byName = new Map(), byUuid = new Map(), all = [];
  for (const dir of dirs) {
    for (const file of jsonlIn(dir)) {
      all.push(file);
      const id = path.basename(file, ".jsonl");
      if (!byName.has(id)) byName.set(id, []);
      byName.get(id).push(file);
      let n = 0;
      // Only the start of the file: the first records fit in the first kilobytes, the files run to gigabytes.
      const fd = openSync(file, "r");
      const buf = Buffer.alloc(256 << 10);
      const got = readSync(fd, buf, 0, buf.length, 0);
      closeSync(fd);
      let lines = buf.subarray(0, got).toString("utf8").split("\n");
      if (got === buf.length) lines.pop();          // the last line may be cut off
      // The first records are longer than the head (attachments): read the whole file.
      if (got === buf.length && !lines.some((l) => l.includes('"uuid"'))) lines = readFileSync(file, "utf8").split("\n");
      for (const line of lines) {
        if (n >= sample) break;
        // The same records can be in several files (a part and the whole chat): remember all of them.
        try { const r = JSON.parse(line); if (r.uuid) { if (!byUuid.has(r.uuid)) byUuid.set(r.uuid, []); byUuid.get(r.uuid).push(file); n++; } } catch { /* broken line */ }
      }
    }
  }
  return { byName, byUuid, all };
}

/**
 * Sessions by creation time: { meta, dir, records, bad, extra, continuedAt }; records of all parts are
 * merged without duplicates; with index (continuationIndex) the Claude Code continuation is added:
 * extra are its files, continuedAt is the time of the last new message (null if there are none).
 */
export function* readSessions(from, index = null) {
  for (const { meta, dir, files } of sessionList(from)) {
    const parsed = files.map(readJsonl);
    let extra = [], continuedAt = null;
    if (index) {
      const base = new Set(parsed.flatMap((p) => p.out.map((r) => r.uuid)).filter(Boolean));
      const id = meta.cliSessionId || String(meta.sessionId).replace(/^local_/, "");
      const set = new Set(index.byName.get(id) || []);
      for (const p of parsed) for (const r of p.out) for (const f of (r.uuid && index.byUuid.get(r.uuid)) || []) set.add(f);
      extra = [...set].sort();
      parsed.push(...extra.map(readJsonl));
      for (const p of parsed) for (const r of p.out) {
        if (r.uuid && !base.has(r.uuid) && (r.type === "user" || r.type === "assistant")) continuedAt = Math.max(continuedAt || 0, Date.parse(r.timestamp) || 0);
      }
    }
    yield { meta, dir, records: mergeTranscripts(parsed.map((p) => p.out)), bad: parsed.reduce((s, p) => s + p.bad, 0), extra, continuedAt };
  }
}

/** Secret values: ~/.openclaw/.env if present, and explicitly named .env files (missing ones are an error). */
export function readSecrets(extra = [], home = os.homedir()) {
  const files = [path.join(home, ".openclaw", ".env"), ...extra.map((p) => path.resolve(p))];
  const values = [];
  const used = [];
  for (const [i, f] of files.entries()) {
    if (existsSync(f)) { values.push(...secretValues(readFileSync(f, "utf8"))); used.push(f); }
    else if (i > 0) throw new Error(`Secrets file not found: ${f}`);
  }
  return { values, used };
}

/** Files in the repository chats/ with front matter: [{ rel, fm }]; rel is relative to chats/, joined with "/". */
export function scanChats(to) {
  const out = [];
  const walk = (rel) => {
    for (const e of readdirSync(path.join(to, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.name.endsWith(".md") && r !== "INDEX.md") out.push({ rel: r, fm: frontmatter(readFileSync(path.join(to, r), "utf8").slice(0, 4000)) });
    }
  };
  if (existsSync(to)) walk("");
  return out;
}

/** chats/INDEX.md from the front matter of all chats, shared by the Claude Desktop and OpenClaw exports. */
export function writeChatsIndex(to, tz) {
  const rows = scanChats(to).filter((r) => r.fm.created);
  writeFileSync(path.join(to, "INDEX.md"), indexMarkdown(rows, tz));
  return rows.length;
}
