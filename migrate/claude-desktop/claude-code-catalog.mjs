#!/usr/bin/env node
// Claude Desktop and Claude Code chats in the "Claude Code" section of the OpenClaw sidebar, as the
// projects folder tree (WORKBENCH_CLAUDE_DESKTOP_ROOT) (one folder per project), complete and live: OpenClaw reads the
// ~/.claude/projects files themselves, with no copies and no import limit. They continue as the same Claude CLI chat.
//
//   node migrate/claude-desktop/claude-code-catalog.mjs [--root <projects folder>] [--from <Desktop folder>] [--scheduled] [--no-adopt] [--readopt "<id or title>"]… [--dry-run]
//
// How: OpenClaw takes Claude Desktop chat titles, working folder and archive flag from local_*.json files
// in ~/Library/Application Support/Claude/claude-code-sessions/<account>/<folder>/, a macOS path that
// does not exist on Linux. The script puts one file there per Claude Code session whose working folder
// is inside --root: the title (its own from Claude Code, else from Desktop), the folder, the time. Only in
// its own ai-workbench/claude-desktop subfolder; a rerun updates and removes what disappeared.
// Claude Desktop scheduled runs and archived chats are hidden; --scheduled shows the runs as a separate
// "<project> · scheduled" group. Transcripts of programmatic Claude CLI runs (entrypoint sdk-cli) are
// hidden too: OpenClaw creates them itself (new chats, and chats retelling the history when an interrupted
// turn is recovered); their owner is an OpenClaw session, not a Claude Desktop chat.
// Parts of one chat: Claude Desktop continues a long chat in new sessions, which Claude Code names
// "<chat> (1)", "<chat> (2)"… Only one stays in the folder, the one with the latest message, titled
// without the number; the rest are hidden.
// Requires the catalog enabled: plugins.entries.anthropic.config.sessionCatalog.enabled = true.
// With the Claude Desktop & Code bridge plugin (aiwb-plugins/claude-bridge, "Projects" tree) each tree chat is adopted into the agent
// of its folder (plugins.entries.aiwb-claude-bridge.config.projects; a folder without a project goes to the default agent): a Claude catalog import with full history
// and binding to the Claude CLI chat itself (plugin method aiwb-claude-bridge.bind), without launching Claude CLI;
// chats already adopted are left alone. The plugin does this in the Gateway when the Gateway allows it
// (method aiwb-claude-bridge.adoption reports inGateway; the OpenClaw fork grant OPENCLAW_PLUGIN_GATEWAY_METHODS):
// then the script only passes --readopt to the plugin (aiwb-claude-bridge.readopt). Otherwise the script
// adopts itself, as before. Requires a running Gateway; --no-adopt skips this.
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, globSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

import { liveAccountDir } from "./source.mjs";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const flag = (name) => args.includes(name);
const opts = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const home = os.homedir();
const tilde = (p) => p.replace(/^~(?=\/|$)/, home);

const rootArg = opt("--root") || process.env.WORKBENCH_CLAUDE_DESKTOP_ROOT;
if (!rootArg) { console.error("Set the projects folder: --root <folder> or WORKBENCH_CLAUDE_DESKTOP_ROOT."); process.exit(2); }
const root = path.resolve(tilde(rootArg));
const from = opt("--from") ? path.resolve(tilde(opt("--from"))) : liveAccountDir();
const out = path.join(home, "Library", "Application Support", "Claude", "claude-code-sessions", "ai-workbench", "claude-desktop");
const dry = flag("--dry-run");
const scheduled = flag("--scheduled");

/** Claude Desktop chats by CLI session id: title, scheduled run, archived. */
function desktopChats(dir) {
  const map = new Map();
  if (!dir || !existsSync(dir)) return map;
  for (const n of readdirSync(dir)) {
    if (!/^local_.*\.json$/.test(n)) continue;
    try {
      const m = JSON.parse(readFileSync(path.join(dir, n), "utf8"));
      if (m.cliSessionId) map.set(m.cliSessionId, { title: m.title, scheduled: !!m.scheduledTaskId, archived: !!m.isArchived });
    } catch { /* broken file: treat as missing */ }
  }
  return map;
}

/** A Claude Code session: working folder, start, last message, latest title (custom and model-given). */
async function readSession(file) {
  const s = { cwd: null, createdAt: null, lastReplyAt: null, customTitle: null, aiTitle: null, entrypoint: null };
  const lines = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    // Parse only what is needed: the files run to gigabytes.
    const head = line.slice(0, 200);
    const reply = /"type":\s*"(user|assistant)"/.test(line);
    if (reply || head.includes('"custom-title"') || head.includes('"ai-title"') || (!s.cwd && line.includes('"cwd"'))) {
      let r;
      try { r = JSON.parse(line); } catch { continue; }
      if (r.type === "custom-title" && r.customTitle) s.customTitle = r.customTitle;
      else if (r.type === "ai-title" && r.aiTitle) s.aiTitle = r.aiTitle;
      if (!s.cwd && r.cwd) { s.cwd = r.cwd; s.createdAt = Date.parse(r.timestamp) || null; }
      if (!s.entrypoint && r.entrypoint) s.entrypoint = r.entrypoint;
      if ((r.type === "user" || r.type === "assistant") && !r.isSidechain) s.lastReplyAt = Math.max(s.lastReplyAt || 0, Date.parse(r.timestamp) || 0) || s.lastReplyAt;
    }
  }
  return s;
}

// Claude Code project folders for --root: the path with every character except Latin letters and digits replaced by "-".
const enc = root.replace(/[^a-zA-Z0-9]/g, "-");
const dirs = globSync(path.join(home, ".claude", "projects", `${enc}*`)).filter((d) => statSync(d).isDirectory());
const desktop = desktopChats(from);
const want = new Map();
const perFolder = new Map();
let hiddenScheduled = 0, hiddenArchived = 0, hiddenOpenClaw = 0, outside = 0;
for (const dir of dirs.sort()) {
  for (const n of readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort()) {
    const id = n.slice(0, -6);
    const file = path.join(dir, n);
    const d = desktop.get(id);
    if (d?.archived) { want.set(id, { cliSessionId: id, isArchived: true }); hiddenArchived++; continue; }
    if (d?.scheduled && !scheduled) { want.set(id, { cliSessionId: id, isArchived: true }); hiddenScheduled++; continue; }
    const s = await readSession(file);
    if (!s.cwd || (s.cwd !== root && !s.cwd.startsWith(root + path.sep))) { outside++; continue; }
    if (s.entrypoint === "sdk-cli") { want.set(id, { cliSessionId: id, isArchived: true }); hiddenOpenClaw++; continue; }
    const folder = path.relative(root, s.cwd).split(path.sep)[0] || path.basename(root);
    const entry = {
      cliSessionId: id,
      title: s.customTitle || d?.title || s.aiTitle || id,
      cwd: path.join(root, folder),
      ...(s.createdAt ? { createdAt: s.createdAt } : {}),
      lastActivityAt: s.lastReplyAt || Math.round(statSync(file).mtimeMs),
      ...(d?.scheduled ? { customGroup: `${folder} · scheduled` } : {}),
    };
    want.set(id, entry);
  }
}

// Parts of one chat → one: the key is the folder and the title without " (N)".
const base = (t) => t.replace(/ \(\d{1,3}\)$/, "");
const families = new Map();
for (const e of want.values()) {
  if (e.isArchived) continue;
  const k = `${e.cwd}\0${base(e.title)}`;
  if (!families.has(k)) families.set(k, []);
  families.get(k).push(e);
}
let hiddenParts = 0;
for (const members of families.values()) {
  members.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  const [keep, ...rest] = members;
  keep.title = base(keep.title);
  for (const e of rest) { want.set(e.cliSessionId, { cliSessionId: e.cliSessionId, isArchived: true }); hiddenParts++; }
  const folder = path.basename(keep.cwd);
  perFolder.set(folder, (perFolder.get(folder) || 0) + 1);
}

let written = 0, same = 0, removed = 0;
if (!dry) mkdirSync(out, { recursive: true });
for (const [id, entry] of want) {
  const f = path.join(out, `local_${id}.json`);
  const text = JSON.stringify(entry, null, 2) + "\n";
  if (existsSync(f) && readFileSync(f, "utf8") === text) { same++; continue; }
  if (!dry) writeFileSync(f, text);
  written++;
}
for (const n of existsSync(out) ? readdirSync(out) : []) {
  const id = /^local_(.*)\.json$/.exec(n)?.[1];
  if (id && !want.has(id)) { if (!dry) rmSync(path.join(out, n)); removed++; }
}

console.log(`Root: ${root}\nClaude Desktop: ${from || "none"} (chats ${desktop.size})\nClaude Code folders: ${dirs.length}\nTarget: ${out}${dry ? "  [dry-run]" : ""}\n`);
for (const [f, n] of [...perFolder].sort()) console.log(`  ${f.padEnd(14)} ${n}`);
console.log(`\nIn tree: ${[...perFolder.values()].reduce((a, b) => a + b, 0)}; hidden chat parts ${hiddenParts}, scheduled runs ${hiddenScheduled}, archived ${hiddenArchived}, programmatic Claude CLI runs ${hiddenOpenClaw}` +
  `${outside ? `, outside ${root} ${outside}` : ""}.\nFiles: written ${written}, unchanged ${same}, removed ${removed}.`);

// Adoption by project agents: tree chats without a session are "Projects" catalog rows without a sessionKey.
const oc = (argv) => spawnSync(process.env.OPENCLAW_BIN || "openclaw", argv, { encoding: "utf8" });
const call = (method, params) => {
  const r = oc(["gateway", "call", method, "--params", JSON.stringify(params), "--json", "--timeout", "600000"]);
  try { return JSON.parse(r.stdout); } catch { return { ok: false, error: { message: (r.stderr || r.stdout || "").trim().split("\n").pop() } }; }
};
if (!dry && !flag("--no-adopt")) {
  let plugin = null, pluginId = null;
  // The plugin id; until the installer has moved an install to it, the plugin still runs under its old id.
  for (const id of ["aiwb-claude-bridge", "aiwb-projects"]) {
    const got = oc(["config", "get", `plugins.entries.${id}.config`, "--json"]);
    if (got.error?.code === "ENOENT") { console.log("\nAdoption by agents skipped: no `openclaw` in PATH (or set OPENCLAW_BIN)."); break; }
    try { plugin = JSON.parse(got.stdout); pluginId = id; break; } catch { /* not under this id */ }
  }
  // The plugin adopts in the Gateway: --readopt goes to it, the rest is its job. An older plugin or a
  // Gateway without the grant: the method is missing or reports inGateway false, and the script adopts.
  const inGateway = plugin && call(`${pluginId}.adoption`, {});
  if (inGateway?.inGateway === true) {
    const again = opts("--readopt");
    if (again.length) {
      const r = call(`${pluginId}.readopt`, { chats: again });
      if (r.error || r.ok === false) console.log(`\n--readopt: ${r.error?.message || "no response"}`);
      else {
        for (const v of r.unknown || []) console.log(`\n--readopt ${v}: no such chat in the tree`);
        console.log(`\nAdoption by agents (in the Gateway): adopted ${r.adopted}, errors ${r.failed}.`);
        for (const e of r.errors || []) console.log(`  ✗ ${e}`);
      }
    } else console.log("\nAdoption by agents: done by the plugin in the Gateway.");
    plugin = null;
  } else if (plugin && inGateway?.reason) console.log(`\nAdoption by agents here: the plugin cannot in the Gateway (${inGateway.reason}).`);
  if (plugin) {
    // A folder without a project goes to the default agent, as in the plugin.
    const projects = plugin.projects || {}, defaultAgent = plugin.defaultAgent || "main";
    // Registry of adopted chats: a chat is not adopted twice on its own, so one deleted or archived in
    // OpenClaw does not come back. It is also filled with adopted sessions reported by the plugin
    // (archived ones included); --readopt "<id or title>" clears the mark and the chat is adopted again.
    const workbench = path.join(process.env.OPENCLAW_STATE_DIR || path.join(home, ".openclaw"), "workbench");
    const registryFile = path.join(workbench, "aiwb-claude-bridge-adopted.json");
    // Kept under the plugin's old name before the rename: moved, as the plugin itself does.
    const oldRegistry = path.join(workbench, "aiwb-projects-adopted.json");
    if (!existsSync(registryFile) && existsSync(oldRegistry)) try { renameSync(oldRegistry, registryFile); } catch { /* the plugin moved it */ }
    let registry = {};
    try { registry = JSON.parse(readFileSync(registryFile, "utf8")); } catch { /* not yet */ }
    const again = new Set();
    for (const v of opts("--readopt")) {
      const hit = [...new Set([...want.keys(), ...Object.keys(registry)])].filter((id) => id === v || id.startsWith(v) || want.get(id)?.title === v);
      if (!hit.length) console.log(`\n--readopt ${v}: no such chat in the tree`);
      for (const id of hit) { again.add(id); delete registry[id]; }
    }
    for (const c of call(`${pluginId}.adopted`, {}).chats || []) {
      if (!again.has(c.threadId)) registry[c.threadId] ||= { agentId: c.agentId, sessionKey: c.sessionKey };
    }
    const saveRegistry = () => { mkdirSync(path.dirname(registryFile), { recursive: true }); writeFileSync(registryFile, JSON.stringify(registry, null, 2) + "\n"); };
    saveRegistry();
    const rows = [];
    let cursor;
    do {
      const r = call("sessions.catalog.list", { catalogId: "projects", limitPerHost: 100, ...(cursor ? { cursors: { "gateway:local": cursor } } : {}) });
      const host = r.catalogs?.[0]?.hosts?.[0];
      if (!host) { console.log(`\nAdoption by agents: "Projects" catalog unavailable: ${r.error?.message || "is the Gateway running?"}`); break; }
      rows.push(...host.sessions);
      cursor = host.nextCursor;
    } while (cursor);
    let adopted = 0, failed = 0;
    for (const row of rows.filter((x) => !x.sessionKey)) {
      const agentId = projects[row.customGroup] || defaultAgent;
      // Import with the full history (a catalog continuation takes only the last 200 records),
      // then bind to the Claude CLI chat itself; a session from a previous import is reused from the archive.
      const imp = call("sessions.catalog.import", { catalogId: "claude", hostId: "gateway:local", threadId: row.threadId, agentId, displayName: row.name });
      const key = imp.sessionKey;
      const bind = key && call(`${pluginId}.bind`, { agentId, sessionKey: key, threadId: row.threadId, cwd: row.cwd });
      if (bind?.archived) call("sessions.patch", { key, expectedSessionId: bind.sessionId, archived: false });
      // The import creates a draft (visible only to its owner, a ghost in the sidebar); a project chat is shared.
      if (bind?.sessionKey) call("session.visibility.set", { sessionKey: key, visibility: "shared" });
      if (bind?.sessionKey) { adopted++; registry[row.threadId] = { agentId, sessionKey: key }; }
      else { failed++; console.log(`  ✗ ${row.customGroup} · ${row.name}: ${(bind || imp).error?.message || "no response"}`); }
    }
    saveRegistry();
    if (rows.length) console.log(`\nAdoption by agents: adopted ${adopted}, errors ${failed}.`);
  }
}
