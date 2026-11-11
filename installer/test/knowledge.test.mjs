import assert from "node:assert/strict";
import test from "node:test";

import { knowledgeFolders, knowledgeScopes, knowledgeTextTimerSteps, projectKnowledgeDirs, withTextCopies } from "../knowledge.mjs";
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

test("text copies: one root for every agent and one per project, in memory search and in the aiwb-memory config", () => {
  const k = withTextCopies(knowledgeFolders({ global: "/k/My Vault", projects: [{ id: "garden", knowledge: ["/k/garden"] }], home }),
    { root: "/s/workbench/knowledge-text" });
  assert.equal(k.textAll, "/s/workbench/knowledge-text/all");
  assert.deepEqual(projectKnowledgeDirs(k, "garden"), ["/k/garden", "/s/workbench/knowledge-text/agent-garden"]);
  const [search, config] = sharedMemorySteps({ dir: "/p/shared", knowledge: k });
  assert.deepEqual(value(search), ["/p/shared/memory", "/k/My Vault", "/s/workbench/knowledge-text/all"]);
  assert.deepEqual(value(config).knowledgeText, { "*": ["/s/workbench/knowledge-text/all"], garden: ["/s/workbench/knowledge-text/agent-garden"] });
  // Without aiwb-office (no root) there are no copies, and the config has no knowledgeText.
  const plain = withTextCopies(knowledgeFolders({ global: "/k/v", home }), { root: null });
  assert.equal(plain.textAll, undefined);
  assert.equal("knowledgeText" in value(sharedMemorySteps({ dir: "/p/shared", knowledge: plain })[1]), false);
  assert.deepEqual(value(sharedMemorySteps({ dir: "/p/shared", knowledge: plain })[0]), ["/p/shared/memory", "/k/v"]);
});

test("text copies timer: every 15 minutes on Linux with each scope as an argument; elsewhere a skip with the command", () => {
  const k = withTextCopies(knowledgeFolders({ global: "/k/My Vault:/k/b", projects: [{ id: "garden", knowledge: ["/k/garden"] }], home }),
    { root: "/s/kt" });
  const args = { knowledge: k, unitDir: "/u", node: "/n/node", script: "/p/office/bin/knowledge-text.mjs", pathDirs: ["/usr/bin"] };
  const [step] = knowledgeTextTimerSteps({ ...args, platform: "linux", systemctl: "/usr/bin/systemctl" });
  assert.equal(step.kind, "timer");
  const service = step.files["/u/aiwb-knowledge-text.service"];
  assert.match(service, /ExecStart=\/n\/node \/p\/office\/bin\/knowledge-text.mjs --scope "\/s\/kt\/all=\/k\/My Vault:\/k\/b" --scope \/s\/kt\/agent-garden=\/k\/garden/);
  assert.match(step.files["/u/aiwb-knowledge-text.timer"], /OnUnitActiveSec=15min/);
  const [skip] = knowledgeTextTimerSteps({ ...args, platform: "darwin" });
  assert.equal(skip.kind, "skip");
  assert.match(skip.reason, /run by hand: node \/p\/office\/bin\/knowledge-text.mjs --scope/);
  assert.deepEqual(knowledgeTextTimerSteps({ ...args, knowledge: knowledgeFolders({ home }), platform: "linux", systemctl: "x" }), []);
});
