import assert from "node:assert/strict";
import test from "node:test";

import { formatPlan, keepLinkedOwn, staleLoadPathSteps } from "../lib.mjs";

test("own plugins already loaded from the same folder are not linked again, also one inside another's folder", () => {
  const steps = [
    { kind: "own", id: "garden", dir: "/p/garden", argv: ["plugins", "install", "--link", "/p/garden"] },
    { kind: "own", id: "garden-board", dir: "/p/garden/openclaw/board", argv: ["plugins", "install", "--link", "/p/garden/openclaw/board"] },
    { kind: "own", id: "orchard", dir: "/p/orchard", argv: ["plugins", "install", "--link", "/p/orchard"] },
    { kind: "own", id: "moved", dir: "/p/new-place", argv: ["plugins", "install", "--link", "/p/new-place"] },
    { kind: "own", id: "fresh", dir: "/p/fresh", pending: true },
    { kind: "config", id: "x" },
  ];
  const sources = { garden: "/p/garden", "garden-board": "/p/garden/openclaw/board/index.js", moved: "/p/old-place", fresh: "/p/fresh",
    orchard: "/p/orchard-other" };
  const kept = keepLinkedOwn(steps, (id) => sources[id]);
  assert.deepEqual(kept.map((s) => [s.id, Boolean(s.linked)]),
    [["garden", true], ["garden-board", true], ["orchard", false], ["moved", false], ["fresh", false], ["x", false]]);
  assert.ok(kept.every((s, i) => s.kind === steps[i].kind));   // still own steps: their skills still count
  assert.match(formatPlan(kept).split("\n").find((l) => l.includes("garden-board")), /\(already linked\)/);
});

test("load paths of folders that are gone are dropped in one write; nothing to drop, no step", () => {
  const exists = (p) => p !== "/p/old/eval-runs";
  const [step] = staleLoadPathSteps(["/p/garden", "/p/old/eval-runs", "/p/orchard"], { exists });
  assert.equal(step.id, "plugins.load.paths");
  assert.deepEqual(JSON.parse(step.argv[3]), ["/p/garden", "/p/orchard"]);
  assert.match(step.note, /\/p\/old\/eval-runs/);
  assert.deepEqual(staleLoadPathSteps(["/p/garden"], { exists }), []);
  assert.deepEqual(staleLoadPathSteps(undefined, { exists }), []);
});
