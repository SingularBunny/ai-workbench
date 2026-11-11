// node --test 'installer/test/*.test.mjs' (no dependencies).
import assert from "node:assert/strict";
import test from "node:test";

import { CHAT_FILES_ENV, chatFileFolderSteps, chatFolder } from "../chat-files.mjs";
import { batchEnvVarSteps, formatPlan } from "../lib.mjs";

const home = "/home/u";
const ID = `env.vars.${CHAT_FILES_ENV}`;

test("chat file folders: ~ expanded, / and the home folder refused", () => {
  assert.deepEqual(chatFolder("~/Downloads/", { home }), { dir: "/home/u/Downloads" });
  assert.deepEqual(chatFolder(" /srv/shared ", { home }), { dir: "/srv/shared" });
  for (const bad of ["", "Downloads", "/", "~", "~/", "/home/u/", "/home", "/srv/a:b", "/srv/a;b"]) {
    assert.ok(chatFolder(bad, { home }).error, bad);
  }
});

test("chat file folders: .env list for all agents and project lists merge into one fork setting", () => {
  const projects = [
    { id: "reports", chatFileFolders: ["~/Projects/reports", "/srv/shared"] },
    { id: "notes" },
    { id: "empty", chatFileFolders: [] },
  ];
  const [step, ...rest] = chatFileFolderSteps({ global: " ~/Desktop: ~/Downloads :~/Desktop", projects, fork: true, home });
  assert.equal(rest.length, 0);
  const value = "*=/home/u/Desktop:/home/u/Downloads;reports=/home/u/Projects/reports:/srv/shared";
  assert.deepEqual(step, { kind: "config", id: ID, note: value, argv: ["config", "set", ID, JSON.stringify(value), "--strict-json"] });
  // Written in the one env.vars batch with the other fork settings.
  const [batch] = batchEnvVarSteps([step]);
  assert.equal(batch.kind, "config-batch");
  assert.deepEqual(JSON.parse(batch.argv[3]), [{ path: ID, value }]);
  // Per project only, without the .env key.
  assert.equal(chatFileFolderSteps({ projects, fork: true, home })[0].note, "reports=/home/u/Projects/reports:/srv/shared");
});

test("chat file folders: nothing declared leaves the setting alone; without the fork it is skipped", () => {
  assert.deepEqual(chatFileFolderSteps({ global: "", projects: [{ id: "a" }], fork: true, home }), []);
  assert.deepEqual(chatFileFolderSteps({ global: undefined, fork: false, home }), []);
  const [skip] = chatFileFolderSteps({ global: "~/Desktop", fork: false, home });
  assert.equal(skip.kind, "skip");
  assert.match(skip.reason, /fork/);
});

test("chat file folders: bad entries are skipped with a warning, missing folders kept with one", () => {
  const exists = (dir) => dir !== "/home/u/Later";
  const [step] = chatFileFolderSteps({ global: "~:/:Desktop:~/Later:~/Downloads", projects: [{ id: "x", chatFileFolders: "~/Desktop" }],
    fork: true, home, exists });
  assert.equal(step.note, "*=/home/u/Later:/home/u/Downloads");
  assert.equal(step.warn.length, 5);
  assert.match(step.warn.join("\n"), /home folder.*\n.*filesystem root.*\n.*not an absolute.*\n.*Later does not exist[\s\S]*project x: chatFileFolders must be a list/);
  assert.match(formatPlan([step]), /⚠ WORKBENCH_CHAT_FILE_FOLDERS: ~: the home folder/);
  // Only bad entries: nothing usable, the setting is not written.
  const [none] = chatFileFolderSteps({ global: "/", fork: true, home });
  assert.equal(none.kind, "skip");
});
