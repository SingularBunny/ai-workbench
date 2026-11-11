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

test("free providers: those whose key is in .env count as free for Multi-model; an explicit list or none wins", async () => {
  const { freeProviderSteps } = await import("../lib.mjs");
  const value = (env) => JSON.parse(freeProviderSteps(env)[0].argv[3]);
  assert.deepEqual(value({ GROQ_API_KEY: "g", HF_TOKEN: "h", MISTRAL_API_KEY: " " }), ["groq", "huggingface"]);
  // A key of a provider that charges (Cerebras, NVIDIA, Mistral in November 2026) does not make it free.
  assert.deepEqual(freeProviderSteps({ CEREBRAS_API_KEY: "c", NVIDIA_API_KEY: "n", MISTRAL_API_KEY: "m" }), []);
  assert.deepEqual(value({ GOOGLE_API_KEY: "x" }), ["google"]);
  assert.deepEqual(freeProviderSteps({ OPENROUTER_API_KEY: "o" }), []);          // OpenRouter's free models are known by id
  assert.deepEqual(value({ GROQ_API_KEY: "g", WORKBENCH_FREE_PROVIDERS: "ollama, groq" }), ["ollama", "groq"]);
  assert.deepEqual(value({ GROQ_API_KEY: "g", WORKBENCH_FREE_PROVIDERS: "none" }), []);
});
