#!/usr/bin/env node
// Claude Desktop shared memory → the workspace of agent main in the data repository.
// Facts as is, the MEMORY.md index with links into memory/, user-type facts also into USER.md.
// USER.md is also placed in project folders (--projects) that lack one: scheduled runs see
// USER.md but not MEMORY.md. The source is read-only; existing files are not overwritten without --force.
//
//   node migrate/claude-desktop/memory.mjs --to <repository>/main [--projects <repository>/projects] [--from <folder>] [--dry-run] [--force]
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { globalPlan } from "./projects-core.mjs";
import { globalMemoryDir, liveAccountDir } from "./source.mjs";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const flag = (name) => args.includes(name);

const from = opt("--from") ? path.resolve(opt("--from")) : liveAccountDir();
const to = opt("--to") && path.resolve(opt("--to"));
const projects = opt("--projects") && path.resolve(opt("--projects"));
if (!from || !to) { console.error("Required: --to <repository>/main and a Claude Desktop folder (--from or the live one in ~/.config/Claude)"); process.exit(1); }
const dir = globalMemoryDir(from);
if (!dir) { console.error(`No shared memory in ${from} (memory/memory or global_memory/memory)`); process.exit(1); }

const memory = {};
const observed = {};
for (const n of readdirSync(dir)) {
  const p = path.join(dir, n);
  if (!statSync(p).isFile()) continue;
  memory[n] = readFileSync(p, "utf8");
  observed[n] = statSync(p).mtime.toISOString().slice(0, 10);
}
const importedAt = new Date().toISOString().slice(0, 10);
const dry = flag("--dry-run");
const plan = globalPlan(memory, { importedAt, observed, exists: (rel) => existsSync(path.join(to, ...rel.split("/"))), force: flag("--force") });
console.log(`Source: ${dir}\nTarget: ${to}${dry ? "  [dry-run]" : ""}\n`);
console.log(`  main       facts ${plan.facts}, of them in USER.md ${plan.user}; files to write ${plan.write.length}${plan.kept.length ? `, existing and kept ${plan.kept.length}` : ""}`);
for (const w of plan.warn) console.log(`    ⚠ ${w}`);

const writes = plan.write.map((f) => ({ p: path.join(to, ...f.path.split("/")), text: f.text }));
if (projects && plan.userText) {
  const found = existsSync(projects) ? readdirSync(projects).filter((d) => existsSync(path.join(projects, d, "project.json"))).sort() : [];
  for (const d of found) {
    const p = path.join(projects, d, "USER.md");
    const has = existsSync(p) && !flag("--force");
    console.log(`  ${d.padEnd(10)} USER.md ${has ? "exists, kept" : "to write"}`);
    if (!has) writes.push({ p, text: plan.userText });
  }
}
if (!dry) {
  for (const w of writes) { mkdirSync(path.dirname(w.p), { recursive: true }); writeFileSync(w.p, w.text); }
}
console.log(`\nDone: files ${dry ? "to write" : "written"} ${writes.length}.`);
