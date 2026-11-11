#!/usr/bin/env node
// Claude Desktop projects → OpenClaw agent workspaces in the data repository.
// The source is read-only. Existing files are not overwritten without --force.
//
//   node migrate/claude-desktop/projects.mjs --to <repository>/projects [--from <folder>] [--dry-run] [--force]
//
// --from: the Claude Desktop account folder (with spaces.json and spaces/<id>/memory) or an export
// (spaces/spaces.json and spaces/<name>/memory). Defaults to the live folder
// ~/.config/Claude/local-agent-mode-sessions/<…>/<account>.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { agentId, projectPlan } from "./projects-core.mjs";
import { liveAccountDir } from "./source.mjs";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const flag = (name) => args.includes(name);

const from = opt("--from") ? path.resolve(opt("--from")) : liveAccountDir();
const to = opt("--to") && path.resolve(opt("--to"));
if (!from || !to) { console.error("Required: --to <repository>/projects and a Claude Desktop folder (--from or the live one in ~/.config/Claude)"); process.exit(1); }
const spacesFile = [path.join(from, "spaces.json"), path.join(from, "spaces", "spaces.json")].find(existsSync);
if (!spacesFile) { console.error(`No spaces.json in ${from}`); process.exit(1); }
const spaces = JSON.parse(readFileSync(spacesFile, "utf8")).spaces;

function memoryOf(space) {
  const dir = [path.join(from, "spaces", space.id, "memory"), path.join(from, "spaces", space.name, "memory")].find(existsSync);
  const out = {};
  if (!dir) return out;
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isFile()) out[n] = readFileSync(p, "utf8");
  }
  return out;
}

const importedAt = new Date().toISOString().slice(0, 10);
const seen = new Map();
let written = 0;
console.log(`Source: ${from}\nTarget: ${to}${flag("--dry-run") ? "  [dry-run]" : ""}\n`);
for (const space of spaces) {
  const id = agentId(space.name);
  const exists = (rel) => existsSync(path.join(to, id, ...rel.split("/")));
  const plan = projectPlan(space, memoryOf(space), { importedAt, exists, force: flag("--force") });
  if (seen.has(plan.id)) { console.error(`✗ two projects map to the same agent name ${plan.id}: "${seen.get(plan.id)}" and "${space.name}"`); process.exit(1); }
  seen.set(plan.id, space.name);
  console.log(`  ${space.name.padEnd(10)} → ${plan.id.padEnd(10)} folders ${plan.folders.length}, facts ${plan.facts}, files to write ${plan.write.length}${plan.kept.length ? `, existing and kept ${plan.kept.length}` : ""}`);
  for (const w of plan.warn) console.log(`    ⚠ ${w}`);
  if (flag("--dry-run")) continue;
  for (const f of plan.write) {
    const p = path.join(to, plan.id, ...f.path.split("/"));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, f.text);
    written++;
  }
}
console.log(`\nDone: projects ${spaces.length}, files written ${written}.`);
