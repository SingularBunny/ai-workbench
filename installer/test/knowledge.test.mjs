import assert from "node:assert/strict";
import test from "node:test";

import { knowledgeFolders, knowledgeScopes } from "../knowledge.mjs";
import { knowledgeSteps, mainSteps, projectSteps, sharedMemorySteps } from "../lib.mjs";

const home = "/home/u";
const value = (step) => JSON.parse(step.argv[3]);

test("knowledge folders: global from .env, per project from project.json, ~ expanded, bad entries skipped", () => {
  const k = knowledgeFolders({
    global: "~/Documents/Vault: /srv/team-notes ::~/Documents/Vault",
    projects: [{ id: "garden", knowledge: ["~/Garden/notes"] }, { id: "orchard" }, { id: "bad", knowledge: "notes" },
      { id: "home", knowledge: ["~", "relative/dir"] }],
    home,
    exists: (d) => d !== "/srv/team-notes",
  });
  assert.deepEqual(k.all, ["/home/u/Documents/Vault", "/srv/team-notes"]);
  assert.deepEqual(k.byProject, { garden: ["/home/u/Garden/notes"] });
  assert.ok(k.warn.some((w) => w.includes("/srv/team-notes does not exist")));
  assert.ok(k.warn.some((w) => w.startsWith("project bad: knowledge must be a list")));
  assert.ok(k.warn.some((w) => w.includes("home folder")) && k.warn.some((w) => w.includes("not an absolute")));
  assert.deepEqual(knowledgeScopes(k), { "*": ["/home/u/Documents/Vault", "/srv/team-notes"], garden: ["/home/u/Garden/notes"] });
});

test("knowledge with shared memory: one extraPaths list and the folders in the aiwb-memory config", () => {
  const k = knowledgeFolders({ global: "/k/vault", projects: [{ id: "garden", knowledge: ["/k/garden"] }], home });
  const [search, config, hooks] = sharedMemorySteps({ dir: "/p/shared", knowledge: k });
  assert.deepEqual(value(search), ["/p/shared/memory", "/k/vault"]);
  assert.deepEqual(value(config), { dir: "/p/shared", knowledge: { "*": ["/k/vault"], garden: ["/k/garden"] } });
  assert.equal(hooks.id, "plugins.entries.aiwb-memory.hooks");
  // Without knowledge the config stays as before.
  assert.deepEqual(value(sharedMemorySteps({ dir: "/p/shared" })[1]), { dir: "/p/shared" });
});

test("knowledge without shared memory: its own steps, the main agent's memory list carries the folders", () => {
  const k = knowledgeFolders({ global: "/k/vault", home });
  const [ws, search] = mainSteps({ dir: "/p/main", knowledge: k });
  assert.equal(ws.id, "agents.entries.main.workspace");
  assert.deepEqual(value(search), ["/p/main/memory", "/k/vault"]);
  assert.deepEqual(knowledgeSteps({ knowledge: k, searchSet: true }).map((s) => s.id),
    ["plugins.entries.aiwb-memory.config", "plugins.entries.aiwb-memory.hooks"]);
  const alone = knowledgeSteps({ knowledge: k });
  assert.deepEqual(value(alone[0]), ["/k/vault"]);
  assert.deepEqual(value(alone[1]), { knowledge: { "*": ["/k/vault"] } });
  assert.deepEqual(knowledgeSteps({ knowledge: knowledgeFolders({ home }) }), []);
});

test("project knowledge goes into that agent's memory search only", () => {
  const [garden, orchard] = projectSteps([
    { id: "garden", name: "Garden", dir: "/p/projects/garden", knowledgeDirs: ["/k/garden"] },
    { id: "orchard", name: "Orchard", dir: "/p/projects/orchard" },
  ]);
  assert.deepEqual(value(garden), { workspace: "/p/projects/garden", identity: { name: "Garden" }, memory: { search: { extraPaths: ["/k/garden"] } } });
  assert.deepEqual(value(orchard), { workspace: "/p/projects/orchard", identity: { name: "Orchard" } });
});
