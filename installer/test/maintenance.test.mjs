import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { enterMaintenance, exitMaintenance, MAINTENANCE_TTL_MS, parseCallOutput } from "../maintenance.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const status = (activeWork, activeTurns = activeWork) => ({ ok: true, result: { active: true, activeWork, activeTurns, blockers: [] } });

test("call output: JSON after banner lines, unknown method, no Gateway", () => {
  assert.deepEqual(parseCallOutput(0, 'Gateway call: x\n{"active":true}'), { ok: true, result: { active: true } });
  assert.equal(parseCallOutput(1, "Gateway call failed: unknown method: gateway.maintenance.enter").kind, "unsupported");
  assert.equal(parseCallOutput(1, "Error: connect ECONNREFUSED 127.0.0.1:18789").kind, "no-gateway");
  assert.equal(parseCallOutput(1, "something else").kind, "error");
});

test("enter turns maintenance on with a time limit and waits until running turns finish", async () => {
  const calls = [];
  const replies = [status(2), status(1), status(0)];
  const call = (method, params) => { calls.push([method, params]); return replies.shift(); };
  let t = 0;
  const r = await enterMaintenance({ call, sleep: async (ms) => { t += ms; }, now: () => t, log: () => {}, pollMs: 5_000 });
  assert.equal(r.status, "ready");
  assert.equal(calls[0][0], "gateway.maintenance.enter");
  assert.deepEqual(calls[0][1], { source: "installer", reason: "OpenClaw update", ttlMs: MAINTENANCE_TTL_MS });
  assert.deepEqual(calls.slice(1).map(([m]) => m), ["gateway.maintenance.status", "gateway.maintenance.status"]);
});

test("enter gives up after the wait limit and reports what still runs", async () => {
  let t = 0;
  const r = await enterMaintenance({ call: () => status(1), sleep: async (ms) => { t += ms; }, now: () => t, log: () => {},
    waitMs: 12_000, pollMs: 5_000 });
  assert.equal(r.status, "timeout");
  assert.equal(r.state.activeTurns, 1);
});

test("enter on a Gateway without maintenance mode or without a Gateway does nothing", async () => {
  for (const kind of ["unsupported", "no-gateway"]) {
    const r = await enterMaintenance({ call: () => ({ ok: false, kind, message: "x" }), log: () => {} });
    assert.equal(r.status, kind);
  }
});

test("ensure (no wait) does not poll", async () => {
  const calls = [];
  const r = await enterMaintenance({ call: (m) => { calls.push(m); return status(3); }, log: () => {}, wait: false });
  assert.equal(r.status, "ready");
  assert.deepEqual(calls, ["gateway.maintenance.enter"]);
});

test("exit reports whether chats resumed", () => {
  assert.equal(exitMaintenance({ call: () => ({ ok: true, result: { resumed: true } }), log: () => {} }).status, "resumed");
  assert.equal(exitMaintenance({ call: () => ({ ok: true, result: { resumed: false } }), log: () => {} }).status, "already-off");
  assert.equal(exitMaintenance({ call: () => ({ ok: false, kind: "error", message: "x" }), log: () => {} }).status, "error");
});

// install.sh itself, with a fake `openclaw` that logs its calls and a fake setup.mjs: the order of
// maintenance on, setup, maintenance off, also when setup fails or turns do not finish in time.
function runInstall({ setupExit = 0, gateway = "fork", busy = false } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "aiwb-maint-"));
  try {
    const inst = path.join(dir, "repo", "installer");
    mkdirSync(inst, { recursive: true });
    mkdirSync(path.join(dir, "repo", "openclaw"));
    copyFileSync(path.join(here, "..", "install.sh"), path.join(inst, "install.sh"));
    for (const f of ["maintenance.mjs", "upgrade.mjs"]) copyFileSync(path.join(here, "..", f), path.join(inst, f));
    copyFileSync(path.join(here, "..", "..", "openclaw", "workbench.config.mjs"), path.join(dir, "repo", "openclaw", "workbench.config.mjs"));
    const log = path.join(dir, "calls.log");
    writeFileSync(path.join(inst, "setup.mjs"), `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(log)}, "setup\\n"); process.exit(${setupExit});\n`);
    const version = readFileSync(path.join(dir, "repo", "openclaw", "workbench.config.mjs"), "utf8").match(/OPENCLAW_VERSION = "(.*)"/)[1];
    const bin = path.join(dir, "prefix", "bin");
    mkdirSync(bin, { recursive: true });
    const reply = gateway === "fork"
      ? `case "$3" in gateway.maintenance.exit) echo '{"resumed":true}';; *) echo '{"active":true,"activeWork":${busy ? 1 : 0},"activeTurns":${busy ? 1 : 0},"blockers":[]}';; esac`
      : `echo "Gateway call failed: unknown method: $3" >&2; exit 1`;
    writeFileSync(path.join(bin, "openclaw"), `#!/usr/bin/env bash
case "$1" in
  --version) echo "OpenClaw ${version}";;
  gateway) if [[ "$2" == call ]]; then echo "call $3" >> ${JSON.stringify(log)}; ${reply}; else echo '{"loaded": false}'; fi;;
  sessions|cron) echo '{}';;
esac
`);
    chmodSync(path.join(bin, "openclaw"), 0o755);
    const r = spawnSync("bash", [path.join(inst, "install.sh"), "--yes"], { encoding: "utf8",
      env: { PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: dir, OPENCLAW_PREFIX: path.join(dir, "prefix"),
        WORKBENCH_MAINTENANCE_WAIT_MIN: "0.0001" } });
    let calls = [];
    try { calls = readFileSync(log, "utf8").trim().split("\n"); } catch { calls = []; }
    return { code: r.status, calls, out: r.stdout + r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("install.sh: maintenance on before setup, off after it", () => {
  const r = runInstall();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.calls, ["call gateway.maintenance.enter", "setup", "call gateway.maintenance.exit"]);
  assert.match(r.out, /chats are paused/);
});

test("install.sh: a failed setup still turns maintenance off and keeps its exit code", () => {
  const r = runInstall({ setupExit: 7 });
  assert.equal(r.code, 7, r.out);
  assert.deepEqual(r.calls, ["call gateway.maintenance.enter", "setup", "call gateway.maintenance.exit"]);
});

test("install.sh: turns that do not finish in time stop the install with chats resumed, nothing changed", () => {
  const r = runInstall({ busy: true });
  assert.equal(r.code, 1, r.out);
  assert.equal(r.calls.at(-1), "call gateway.maintenance.exit");
  assert.ok(!r.calls.includes("setup"));
  assert.match(r.out, /Nothing has been changed/);
});

test("install.sh: a Gateway without maintenance mode runs setup as before", () => {
  const r = runInstall({ gateway: "upstream" });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.calls, ["call gateway.maintenance.enter", "setup"]);
});
