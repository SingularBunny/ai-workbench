import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { clearMaintenanceFile, exitMaintenanceSafely, maintenanceFilePath } from "../maintenance.mjs";
import { configCheck, parseGatewayStatus, parseValidate, waitGatewayUp } from "../upgrade.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const invalid = (p = "/x/openclaw.json") => ({ code: 1, out: JSON.stringify({ valid: false, path: p, issues: [{ path: "agents.defaults", message: 'Unrecognized key: "heartbeat"' }] }) });
const valid = { code: 0, out: '{"valid":true,"path":"/x/openclaw.json","warnings":[]}' };

test("validate output: valid, invalid with issues, a CLI without validate", () => {
  assert.equal(parseValidate(valid.code, valid.out).status, "valid");
  const r = parseValidate(invalid().code, invalid().out);
  assert.equal(r.status, "invalid");
  assert.equal(r.issues[0].path, "agents.defaults");
  assert.equal(parseValidate(1, "error: unknown command 'validate'").status, "unknown");
});

test("gateway status: loaded, runtime state, rpc", () => {
  assert.deepEqual(parseGatewayStatus('{"service":{"loaded":true,"runtime":{"state":"failed"}},"rpc":{"ok":false}}'), { loaded: true, state: "failed", rpc: false });
  assert.deepEqual(parseGatewayStatus("garbage"), { loaded: false, state: "unknown", rpc: false });
});

test("config check: a valid config does not run doctor", async () => {
  let doctor = 0;
  const r = await configCheck({ run: () => valid, runLive: async () => { doctor++; return { code: 0 }; }, log: () => {} });
  assert.equal(r.status, "valid");
  assert.equal(doctor, 0);
});

test("config check: legacy keys → backup, doctor --fix without touching the service, valid again", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "aiwb-upg-"));
  try {
    const cfg = path.join(dir, "openclaw.json");
    writeFileSync(cfg, '{"agents":{"defaults":{"heartbeat":{}}}}');
    const replies = [invalid(cfg), valid];
    let doctorArgs, doctorEnv;
    const r = await configCheck({ run: () => replies.shift(), log: () => {}, now: () => new Date("2026-11-19T10:20:30Z"),
      runLive: async (args, { env }) => { doctorArgs = args; doctorEnv = env; return { code: 0, timedOut: false }; } });
    assert.equal(r.status, "repaired");
    assert.deepEqual(doctorArgs, ["doctor", "--fix", "--non-interactive"]);
    assert.equal(doctorEnv.OPENCLAW_SERVICE_REPAIR_POLICY, "external");
    assert.equal(r.backup, `${cfg}.pre-upgrade-20261119-102030`);
    assert.equal(readFileSync(r.backup, "utf8"), readFileSync(cfg, "utf8"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: doctor cut by the time limit is fine when the config is valid after it", async () => {
  const replies = [invalid("/nonexistent/openclaw.json"), valid];
  const r = await configCheck({ run: () => replies.shift(), log: () => {}, runLive: async () => ({ code: 143, timedOut: true }) });
  assert.equal(r.status, "repaired");
});

test("config check: still invalid after doctor is reported", async () => {
  const r = await configCheck({ run: () => invalid("/nonexistent/openclaw.json"), log: () => {}, runLive: async () => ({ code: 1 }) });
  assert.equal(r.status, "invalid");
  assert.equal(r.issues.length, 1);
});

const gw = (state, rpc = state === "active") => ({ code: 0, out: JSON.stringify({ service: { loaded: true, runtime: { state } }, rpc: { ok: rpc } }) });
const fakeRun = (states) => (args) => args[0] === "health" ? { code: 0, out: "Agents: main" } : gw(states.length > 1 ? states.shift() : states[0]);

test("wait for the Gateway: up after it starts, failed at once, stopped past the grace, time limit", async () => {
  let t = 0;
  const opts = { sleep: async (ms) => { t += ms; }, now: () => t, log: () => {}, pollMs: 1_000 };
  assert.equal((await waitGatewayUp({ ...opts, run: fakeRun(["activating", "activating", "active"]) })).status, "up");
  t = 0; assert.equal((await waitGatewayUp({ ...opts, run: fakeRun(["activating", "failed"]) })).status, "failed");
  t = 0; assert.equal((await waitGatewayUp({ ...opts, run: fakeRun(["inactive"]), inactiveGraceMs: 5_000 })).status, "failed");
  t = 0; assert.equal((await waitGatewayUp({ ...opts, run: fakeRun(["activating"]), waitMs: 10_000 })).status, "timeout");
  assert.equal((await waitGatewayUp({ ...opts, run: () => ({ code: 1, out: '{"service":{"loaded":false}}' }) })).status, "not-loaded");
});

test("maintenance file: state dir, else the config's folder; only the installer's state is cleared", () => {
  assert.equal(maintenanceFilePath({ env: { OPENCLAW_STATE_DIR: "/s" } }), "/s/gateway-maintenance.json");
  assert.equal(maintenanceFilePath({ env: {}, configPath: "/c/openclaw.json" }), "/c/gateway-maintenance.json");
  const dir = mkdtempSync(path.join(os.tmpdir(), "aiwb-upg-"));
  try {
    const f = path.join(dir, "gateway-maintenance.json");
    assert.equal(clearMaintenanceFile(f).status, "absent");
    writeFileSync(f, '{"since":1,"source":"control-ui"}');
    assert.equal(clearMaintenanceFile(f).status, "left");
    writeFileSync(f, '{"since":1,"source":"installer"}');
    assert.equal(clearMaintenanceFile(f).status, "cleared");
    assert.ok(!existsSync(f));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("maintenance exit: retries while the Gateway starts, clears the file when it never answers or is down", async () => {
  let t = 0, calls = 0;
  const down = () => { calls++; return { ok: false, kind: "no-gateway", message: "ECONNREFUSED" }; };
  const opts = { sleep: async (ms) => { t += ms; }, now: () => t, log: () => {}, pollMs: 5_000, file: "/f", clear: () => ({ status: "cleared" }) };
  // Starting: retried, then it answers.
  const replies = [down(), down(), { ok: true, result: { resumed: true } }];
  calls = 0;
  let r = await exitMaintenanceSafely({ ...opts, call: () => replies.shift(), gatewayExpected: () => true });
  assert.equal(r.status, "resumed");
  // Never answers: bounded, then the file.
  t = 0; calls = 0;
  r = await exitMaintenanceSafely({ ...opts, call: down, gatewayExpected: () => true, retryMs: 20_000 });
  assert.equal(r.status, "cleared");
  assert.equal(calls, 5);
  // Down (failed service): no waiting.
  t = 0; calls = 0;
  r = await exitMaintenanceSafely({ ...opts, call: down, gatewayExpected: () => false });
  assert.equal(r.status, "cleared");
  assert.equal(calls, 1);
});

// install.sh end to end with a fake `openclaw`, a fake install-cli.sh and a fake setup.mjs. The fake Gateway is a
// "service" whose state lives in files: install-cli.sh switches it to the "new" version, whose config check rejects
// a legacy key until doctor removes it, and whose start fails with an invalid config (as 2026.11.5 did).
function runUpgrade({ legacy = false, doctorFails = false, diesAfterStart = false, setupExit = 0 } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "aiwb-upg-"));
  try {
    const inst = path.join(dir, "repo", "installer");
    mkdirSync(inst, { recursive: true });
    mkdirSync(path.join(dir, "repo", "openclaw"));
    for (const f of ["install.sh", "maintenance.mjs", "upgrade.mjs"]) copyFileSync(path.join(here, "..", f), path.join(inst, f));
    copyFileSync(path.join(here, "..", "..", "openclaw", "workbench.config.mjs"), path.join(dir, "repo", "openclaw", "workbench.config.mjs"));
    const fake = path.join(dir, "fake");
    mkdirSync(fake);
    const log = path.join(dir, "calls.log");
    writeFileSync(path.join(fake, "openclaw.json"), legacy ? '{"agents":{"defaults":{"heartbeat":{"agentId":"main"}}}}\n' : "{}\n");
    if (legacy) writeFileSync(path.join(fake, "legacy"), "");
    if (doctorFails) writeFileSync(path.join(fake, "doctor-fails"), "");
    if (diesAfterStart) writeFileSync(path.join(fake, "dies"), "");
    writeFileSync(path.join(fake, "state"), "active");
    writeFileSync(path.join(inst, "setup.mjs"), `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(log)}, "setup\\n"); process.exit(${setupExit});\n`);
    const bin = path.join(dir, "prefix", "bin");
    mkdirSync(bin, { recursive: true });
    const F = JSON.stringify(fake), L = JSON.stringify(log);
    writeFileSync(path.join(bin, "openclaw"), `#!/usr/bin/env bash
F=${F}; L=${L}; st="$(cat $F/state)"; new=0; [[ -f $F/new ]] && new=1
bad() { (( new )) && [[ -f $F/legacy ]]; }
case "$1 $2" in
  "--version "*) (( new )) && echo "OpenClaw 2099.1.1" || echo "OpenClaw 2000.1.1";;
  "gateway status") echo "{\\"service\\":{\\"loaded\\":true,\\"runtime\\":{\\"state\\":\\"$st\\"}},\\"rpc\\":{\\"ok\\":$([[ $st == active ]] && echo true || echo false)}}";;
  "gateway stop") echo "gateway stop" >> $L; echo inactive > $F/state;;
  "gateway install"|"gateway start") echo "gateway $2" >> $L
     if bad || [[ -f $F/dies ]]; then echo failed > $F/state; else echo active > $F/state; fi;;
  "gateway call") echo "call $3" >> $L
     [[ $st == active ]] || { echo "Error: connect ECONNREFUSED 127.0.0.1:18789" >&2; exit 1; }
     case "$3" in
       gateway.maintenance.enter) echo '{"since":1,"source":"installer","reason":"OpenClaw update"}' > $F/gateway-maintenance.json
         echo '{"active":true,"activeWork":0,"activeTurns":0,"blockers":[]}';;
       gateway.maintenance.exit) r=false; [[ -f $F/gateway-maintenance.json ]] && r=true; rm -f $F/gateway-maintenance.json; echo "{\\"resumed\\":$r}";;
       *) echo '{"active":true,"activeWork":0,"activeTurns":0,"blockers":[]}';;
     esac;;
  "config validate") if bad; then echo "{\\"valid\\":false,\\"path\\":\\"$F/openclaw.json\\",\\"issues\\":[{\\"path\\":\\"agents.defaults\\",\\"message\\":\\"Unrecognized key: heartbeat\\"}]}"; exit 1
     else echo "{\\"valid\\":true,\\"path\\":\\"$F/openclaw.json\\"}"; fi;;
  "config file") echo "$F/openclaw.json";;
  "doctor "*) echo "doctor $2 $3 policy=$OPENCLAW_SERVICE_REPAIR_POLICY" >> $L; [[ -f $F/doctor-fails ]] && exit 1; rm -f $F/legacy; echo '{}' > $F/openclaw.json;;
  "health"*) [[ $st == active ]] && echo "Agents: main" || { echo "gateway closed" >&2; exit 1; };;
  *) echo '{}';;
esac
`);
    writeFileSync(path.join(bin, "journalctl"), `#!/usr/bin/env bash\necho "openclaw-gateway: OpenClaw config is invalid (fake journal)"\n`);
    for (const f of ["openclaw", "journalctl"]) chmodSync(path.join(bin, f), 0o755);
    const cli = path.join(dir, "install-cli.sh");
    writeFileSync(cli, `echo "install-cli $*" >> ${L}; touch ${F}/new\n`);
    const r = spawnSync("bash", [path.join(inst, "install.sh"), "--yes"], { encoding: "utf8",
      env: { PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: dir, OPENCLAW_PREFIX: path.join(dir, "prefix"),
        WORKBENCH_INSTALL_CLI: cli, WORKBENCH_MAINTENANCE_EXIT_WAIT_SEC: "0", WORKBENCH_GATEWAY_START_MIN: "0.05" } });
    let calls = [];
    try { calls = readFileSync(log, "utf8").trim().split("\n"); } catch { calls = []; }
    return { code: r.status, calls, out: r.stdout + r.stderr, maintenanceLeft: existsSync(path.join(fake, "gateway-maintenance.json")),
      state: readFileSync(path.join(fake, "state"), "utf8").trim(), backups: readdirSync(fake).filter((f) => f.includes("pre-upgrade")) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const strip = (calls) => calls.map((c) => c.replace(/^install-cli .*--runtime-only.*$/, "install-cli --runtime-only"));

test("install.sh upgrade: normal path — stop, replace without a service restart, start, setup, maintenance off", () => {
  const r = runUpgrade();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(strip(r.calls), ["call gateway.maintenance.enter", "gateway stop", "install-cli --runtime-only", "gateway install",
    "call gateway.maintenance.enter", "setup", "call gateway.maintenance.exit"]);
  assert.ok(!r.maintenanceLeft);
  assert.equal(r.state, "active");
  assert.deepEqual(r.backups, []);
});

test("install.sh upgrade: legacy config → backup, doctor, valid, Gateway up, setup runs", () => {
  const r = runUpgrade({ legacy: true });
  assert.equal(r.code, 0, r.out);
  const i = r.calls.indexOf("doctor --fix --non-interactive policy=external");
  assert.ok(i > 0 && i < r.calls.indexOf("gateway install"), r.calls.join("\n"));
  assert.ok(r.calls.includes("setup"));
  assert.equal(r.backups.length, 1);
  assert.ok(!r.maintenanceLeft);
  assert.equal(r.state, "active");
});

test("install.sh upgrade: doctor cannot repair → stop before the start, no setup, maintenance cleared", () => {
  const r = runUpgrade({ legacy: true, doctorFails: true });
  assert.equal(r.code, 1, r.out);
  assert.ok(!r.calls.includes("gateway install") && !r.calls.includes("gateway start"), r.calls.join("\n"));
  assert.ok(!r.calls.includes("setup"));
  assert.ok(!r.maintenanceLeft, r.out);
  assert.equal(r.state, "inactive");
  assert.match(r.out, /still invalid/);
  assert.match(r.out, /pre-upgrade/);
});

test("install.sh upgrade: Gateway dead after the restart → journal and fix steps, no setup, maintenance cleared", () => {
  const r = runUpgrade({ diesAfterStart: true });
  assert.equal(r.code, 1, r.out);
  assert.ok(!r.calls.includes("setup"));
  assert.ok(!r.maintenanceLeft, r.out);
  assert.match(r.out, /fake journal/);
  assert.match(r.out, /reset-failed openclaw-gateway/);
  assert.match(r.out, /Setup was NOT run/);
});
