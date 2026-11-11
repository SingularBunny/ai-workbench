#!/usr/bin/env node
// Imports staged chats into OpenClaw sessions: from import-plan.json produced by
// `chats.mjs --openclaw-stage`, runs `sessions.catalog.import` on the `claude` catalog with the project
// agent and the Claude Desktop title. The Gateway must run with CLAUDE_CONFIG_DIR=<staging folder>
// and the catalog enabled (docs/features/chats.md, "As OpenClaw sessions"). Repeating creates no copies:
// the same chat is updated and only new records are added.
//
//   node migrate/claude-desktop/chats-import.mjs --plan <folder>/import-plan.json [--parallel 6] [--limit N]
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const planFile = opt("--plan");
if (!planFile) { console.error("--plan <folder>/import-plan.json is required"); process.exit(1); }
const plan = JSON.parse(readFileSync(path.resolve(planFile), "utf8")).slice(0, Number(opt("--limit")) || undefined);
const parallel = Math.max(1, Number(opt("--parallel")) || 6);
const bin = process.env.OPENCLAW_BIN || "openclaw";

async function importOne(p) {
  const params = { catalogId: "claude", hostId: "gateway:local", threadId: p.threadId, agentId: p.agentId, displayName: p.displayName };
  try {
    const { stdout } = await run(bin, ["gateway", "call", "sessions.catalog.import", "--params", JSON.stringify(params), "--json", "--timeout", "600000"],
      { maxBuffer: 16 << 20 });
    const r = JSON.parse(stdout);
    // The import creates a draft (visible only to its owner, a ghost in the sidebar); an adopted chat is shared.
    await run(bin, ["gateway", "call", "session.visibility.set", "--params", JSON.stringify({ sessionKey: r.sessionKey, visibility: "shared" }), "--json"]).catch(() => {});
    return { ...p, ok: true, created: r.created, items: r.importedItems, total: r.totalItems, complete: r.complete, sessionKey: r.sessionKey };
  } catch (e) {
    return { ...p, ok: false, error: (e.stderr || e.message || "").toString().trim().split("\n").slice(-1)[0] };
  }
}

const results = [];
let next = 0;
await Promise.all(Array.from({ length: parallel }, async () => {
  while (next < plan.length) {
    const r = await importOne(plan[next++]);
    results.push(r);
    const what = r.ok ? `${r.created ? "created" : "updated"}, records ${r.items}/${r.total}${r.complete ? "" : "; older records cut"}` : `✗ ${r.error}`;
    console.log(`  ${String(results.length).padStart(4)}/${plan.length} ${r.agentId.padEnd(9)} ${r.displayName.slice(0, 50).padEnd(50)} ${what}`);
  }
}));

const ok = results.filter((r) => r.ok);
const cut = ok.filter((r) => !r.complete);
console.log(`\nDone: ${ok.length} of ${plan.length}; created ${ok.filter((r) => r.created).length}, updated ${ok.filter((r) => !r.created).length}` +
  `${cut.length ? `; older records cut in ${cut.length} (OpenClaw import limit; the full history is in the repository chats/)` : ""}; errors ${results.length - ok.length}.`);
process.exit(results.length === ok.length ? 0 : 1);
