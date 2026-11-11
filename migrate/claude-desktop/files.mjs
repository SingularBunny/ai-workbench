#!/usr/bin/env node
// Claude Desktop chat attachments (uploads/ received, outputs/ produced) → a local file store
// outside git: <agent>/<YYYY-MM>/<chat>/, the same layout as chats/, with the folder path in the
// files: field of the chat front matter. Only new and changed files are copied (size and time), and
// the modification time is kept, so rclone also sends only the difference (docs/features/chat-archive.md, "Attachments").
// Secrets in attachments are not redacted: images and archives cannot be read, so cloud upload only with encryption.
//
//   node migrate/claude-desktop/files.mjs --to <folder> [--from <folder>] [--tz <zone>] [--dry-run]
import { copyFileSync, existsSync, mkdirSync, statSync, utimesSync } from "node:fs";
import path from "node:path";

import { filesPath } from "./chats-core.mjs";
import { agentId } from "./projects-core.mjs";
import { attachmentsOf, liveAccountDir, readSpaces, sessionList } from "./source.mjs";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const from = opt("--from") ? path.resolve(opt("--from")) : liveAccountDir();
const to = opt("--to") && path.resolve(opt("--to"));
if (!from || !to) { console.error("Required: --to <folder> and a Claude Desktop folder (--from or the live one in ~/.config/Claude)"); process.exit(1); }
const tz = opt("--tz") || Intl.DateTimeFormat().resolvedOptions().timeZone;
const dry = args.includes("--dry-run");
const spaceName = new Map((readSpaces(from) || []).map((s) => [s.id, s.name]));

console.log(`Source: ${from}\nTarget: ${to}${dry ? "  [dry-run]" : ""}\n`);
const stats = { chats: 0, files: 0, copied: 0, same: 0, bytes: 0 };
for (const { meta, dir } of sessionList(from)) {
  const list = attachmentsOf(dir);
  if (!list.length) continue;
  stats.chats++;
  const project = spaceName.get(meta.spaceId);
  const base = path.join(to, ...filesPath(meta, project ? agentId(project) : "main", tz).split("/"));
  for (const rel of list) {
    stats.files++;
    const src = path.join(dir, rel);
    const dst = path.join(base, rel);
    const s = statSync(src);
    if (existsSync(dst)) {
      const d = statSync(dst);
      if (d.size === s.size && Math.trunc(d.mtimeMs / 1000) === Math.trunc(s.mtimeMs / 1000)) { stats.same++; continue; }
    }
    stats.copied++;
    stats.bytes += s.size;
    if (dry) continue;
    mkdirSync(path.dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    utimesSync(dst, s.atime, s.mtime);
  }
}
console.log(`Done: chats with attachments ${stats.chats}, files ${stats.files}; ${dry ? "to copy" : "copied"} ${stats.copied}` +
  ` (${(stats.bytes / 1e6).toFixed(1)} MB), unchanged ${stats.same}.`);
