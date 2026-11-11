import assert from "node:assert/strict";
import test from "node:test";

import { MEMORY_MAX_CHARS, USER_MAX_CHARS, agentId, agentsMd, globalPlan, parseFact, projectPlan, rewriteIndex, userMd } from "../projects-core.mjs";

test("agent name: Latin kebab-case, Cyrillic transliterated", () => {
  assert.equal(agentId("ALPHA"), "alpha");
  assert.equal(agentId("Сад"), "sad");
  assert.equal(agentId("Мой проект 2"), "moy-proekt-2");
  assert.throws(() => agentId("???"), /cannot derive/);
});

test("memory index: links to known facts move into memory/, others are untouched", () => {
  const idx = "- [Watering](watering.md) — x\n- [External](https://e.com/a.md) — y\n- [No file](gone.md)";
  assert.equal(rewriteIndex(idx, ["watering.md"]),
    "- [Watering](memory/watering.md) — x\n- [External](https://e.com/a.md) — y\n- [No file](gone.md)");
});

test("AGENTS.md: instructions verbatim, project folders as a list", () => {
  const t = agentsMd({ name: "Alpha", instructions: "# Alpha\n\na rule", folders: ["/h/code", "/h/Documents/Alpha"] }, { importedAt: "2026-11-04" });
  assert.match(t, /# Alpha\n\na rule/);
  assert.match(t, /- `\/h\/Documents\/Alpha`/);
});

test("project plan: facts in memory/, existing files not overwritten without force", () => {
  const space = { id: "s1", name: "Beta", folders: [{ path: "/a" }], instructions: "" };
  const memory = { "MEMORY.md": "- [f](f.md)", "f.md": "a fact", "pic.png": "x" };
  const p = projectPlan(space, memory, { importedAt: "d", exists: (rel) => rel === "AGENTS.md" });
  assert.deepEqual(p.write.map((f) => f.path).sort(), ["MEMORY.md", "memory/f.md", "project.json"]);
  assert.deepEqual(p.kept, ["AGENTS.md"]);
  assert.match(p.warn.join(), /pic\.png/);
  assert.equal(p.write.find((f) => f.path === "MEMORY.md").text, "- [f](memory/f.md)");
  const forced = projectPlan(space, memory, { importedAt: "d", exists: () => true, force: true });
  assert.equal(forced.kept.length, 0);
});

test("an index over the OpenClaw limit gives a warning, not silent truncation", () => {
  const p = projectPlan({ id: "s", name: "Big", folders: [] }, { "MEMORY.md": "я".repeat(MEMORY_MAX_CHARS + 1) }, { importedAt: "d", exists: () => false });
  assert.match(p.warn.join(), /truncate/);
});

const TZ_FACT = '---\nname: user-timezone\ndescription: "Time zone: Berlin"\nmetadata: \n  node_type: memory\n  type: user\n---\n\nThe user time zone is Berlin.\nWatering runs on UTC: add 1 hour.\n';

test("memory fact: front matter with nested metadata.type, and the text", () => {
  const f = parseFact(TZ_FACT.replace(/\n/g, "\r\n"));
  assert.equal(f.name, "user-timezone");
  assert.equal(f.description, "Time zone: Berlin");
  assert.equal(f.type, "user");
  assert.equal(f.body, "The user time zone is Berlin.\nWatering runs on UTC: add 1 hour.");
  assert.deepEqual(parseFact("just text\n"), { body: "just text" });
});

test("USER.md: one entry per fact with a date, active, one line linking the fact", () => {
  const t = userMd([{ file: "tz.md", observed: "2026-07-20", body: "line 1\nline 2" }], { importedAt: "2026-11-04" });
  assert.match(t, /<!-- observed: 2026-07-20 \| status: active -->\n\n- line 1 line 2 \(details in `memory\/tz\.md` of agent main\)/);
});

test("shared memory: facts as is, index into memory/, USER.md only from user-type facts", () => {
  const memory = { "MEMORY.md": "- [Time zone](tz.md) — Berlin\n- [Decision](dec.md)", "tz.md": TZ_FACT,
    "dec.md": "---\nname: dec\nmetadata:\n  type: project\n---\ndecision", "x.bin": "?" };
  const p = globalPlan(memory, { importedAt: "2026-11-04", observed: { "tz.md": "2026-07-20" }, exists: () => false });
  assert.deepEqual(p.write.map((f) => f.path).sort(), ["MEMORY.md", "USER.md", "memory/dec.md", "memory/tz.md"]);
  assert.equal(p.write.find((f) => f.path === "memory/tz.md").text, TZ_FACT);
  assert.equal(p.write.find((f) => f.path === "MEMORY.md").text, "- [Time zone](memory/tz.md) — Berlin\n- [Decision](memory/dec.md)");
  assert.equal(p.user, 1);
  assert.match(p.userText, /observed: 2026-07-20/);
  assert.doesNotMatch(p.userText, /decision/);
  assert.match(p.warn.join(), /x\.bin/);
  const kept = globalPlan(memory, { importedAt: "d", exists: (rel) => rel === "USER.md" });
  assert.deepEqual(kept.kept, ["USER.md"]);
  assert.equal(globalPlan({ "dec.md": "decision" }, { importedAt: "d", exists: () => false }).userText, null);
});

test("USER.md over the OpenClaw limit gives a warning", () => {
  const big = `---\nmetadata:\n  type: user\n---\n${"я".repeat(USER_MAX_CHARS)}`;
  assert.match(globalPlan({ "b.md": big }, { importedAt: "d", exists: () => false }).warn.join(), /truncate/);
});
