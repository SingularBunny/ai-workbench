// Upgrade safety of install.sh: an OpenClaw that is replaced must not leave a Gateway that cannot start.
//
//   node installer/upgrade.mjs status           — one line: "<loaded 0|1> <state> <rpc 0|1>" of the Gateway service
//   node installer/upgrade.mjs config-check     — `openclaw config validate`; legacy keys or an invalid config:
//                                                  a timestamped backup of openclaw.json, `openclaw doctor --fix
//                                                  --non-interactive` (service untouched), validate again.
//                                                  Exit 0 valid (or this OpenClaw cannot validate), 1 still invalid.
//   node installer/upgrade.mjs wait-up [--min N] [--no-report] — wait until the Gateway service answers health
//                                                  (bounded); exit 0 up, 1 failed or not up in time (journal and fix
//                                                  steps printed, unless --no-report)
//   node installer/upgrade.mjs doctor            — `openclaw doctor --fix --non-interactive`, service untouched
//
// Functions take `run(args, opts)` so installer/test/upgrade.test.mjs checks them without OpenClaw.
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_DOCTOR_TIMEOUT_MIN = 20;
export const DEFAULT_GATEWAY_START_MIN = 10;
export const GATEWAY_UNIT = "openclaw-gateway";

const firstJson = (text) => {
  const s = String(text ?? "");
  const i = s.indexOf("{");
  if (i < 0) return null;
  try { return JSON.parse(s.slice(i)); } catch { return null; }
};

/** `openclaw config validate --json` → { status: "valid" | "invalid" | "unknown", path?, issues? }. */
export function parseValidate(code, out) {
  const j = firstJson(out);
  if (!j || typeof j.valid !== "boolean") return { status: "unknown", message: String(out ?? "").trim().split("\n").slice(-1)[0] };
  return { status: j.valid && code === 0 ? "valid" : "invalid", path: j.path, issues: Array.isArray(j.issues) ? j.issues : [] };
}

/** `openclaw gateway status --json` → { loaded, state, rpc }. state: active | activating | failed | inactive | unknown. */
export function parseGatewayStatus(out) {
  const j = firstJson(out);
  if (!j) return { loaded: false, state: "unknown", rpc: false };
  const rt = j.service?.runtime ?? {};
  return { loaded: j.service?.loaded === true, state: String(rt.state ?? rt.status ?? "unknown"), rpc: j.rpc?.ok === true };
}

export const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");

/** Runs openclaw synchronously, output captured. */
export function cliRun(args, { timeout = 60_000, env } = {}) {
  const r = spawnSync("openclaw", args, { encoding: "utf8", stdio: "pipe", timeout, env: env ?? process.env });
  return { code: r.status ?? 1, out: `${r.stdout || ""}\n${r.stderr || ""}` };
}

/** Runs openclaw with its output shown, a progress line every minute, killed after timeoutMs. */
export function cliRunLive(args, { timeoutMs, env, log = console.log, tickMs = 60_000 } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn("openclaw", args, { stdio: ["ignore", "inherit", "inherit"], env: env ?? process.env });
    const tick = setInterval(() => log(`… still running (${Math.round((Date.now() - started) / 60_000)} min)`), tickMs);
    let timedOut = false;
    const kill = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 10_000).unref(); }, timeoutMs);
    child.on("close", (code) => { clearInterval(tick); clearTimeout(kill); resolve({ code: code ?? 1, timedOut }); });
    child.on("error", () => { clearInterval(tick); clearTimeout(kill); resolve({ code: 127, timedOut: false }); });
  });
}

/** Doctor with the service left to the installer (OPENCLAW_SERVICE_REPAIR_POLICY=external). */
export async function runDoctor({ runLive = cliRunLive, log = console.log, doctorTimeoutMs = DEFAULT_DOCTOR_TIMEOUT_MIN * 60_000, env = process.env } = {}) {
  const d = await runLive(["doctor", "--fix", "--non-interactive"], { timeoutMs: doctorTimeoutMs,
    env: { ...env, OPENCLAW_SERVICE_REPAIR_POLICY: "external" } });
  if (d.timedOut) log("doctor hit the time limit; continuing (the Gateway finishes migrations on start).");
  else if (d.code !== 0) log(`doctor exited with code ${d.code}; continuing with the checks.`);
  return d;
}

/**
 * Validates the config of the installed OpenClaw and repairs legacy keys with doctor. Doctor runs with
 * OPENCLAW_SERVICE_REPAIR_POLICY=external: the installer owns the Gateway service, doctor must not start it.
 * A doctor cut by the time limit is fine when the config is valid afterwards: the Gateway finishes the
 * database migrations on start. Returns { status: "valid" | "repaired" | "unknown" | "invalid", backup?, issues? }.
 */
export async function configCheck({ run = cliRun, runLive = cliRunLive, copy = copyFileSync, log = console.log,
  now = () => new Date(), doctorTimeoutMs = DEFAULT_DOCTOR_TIMEOUT_MIN * 60_000, env = process.env } = {}) {
  const validate = () => { const r = run(["config", "validate", "--json"]); return parseValidate(r.code, r.out); };
  const first = validate();
  if (first.status !== "invalid") return { status: first.status };
  log("The OpenClaw config does not fit the new version:");
  for (const i of first.issues) log(`  - ${i.path}: ${i.message}`);
  let backup;
  if (first.path && existsSync(first.path)) {
    backup = `${first.path}.pre-upgrade-${stamp(now())}`;
    copy(first.path, backup);
    log(`Config backed up: ${backup}`);
  }
  log(`Repairing it: openclaw doctor --fix --non-interactive (the Gateway stays stopped; up to ${Math.round(doctorTimeoutMs / 60_000)} min, database migrations can take a while)…`);
  await runDoctor({ runLive, log, doctorTimeoutMs, env });
  const second = validate();
  if (second.status === "valid") { log("Config repaired and valid."); return { status: "repaired", backup }; }
  return { status: "invalid", backup, issues: second.issues ?? first.issues };
}

/** The last journal lines of the Gateway service, or null without journalctl. */
export function journalTail(lines = 40) {
  const r = spawnSync("journalctl", ["--user", "-u", GATEWAY_UNIT, "-n", String(lines), "--no-pager"], { encoding: "utf8", stdio: "pipe", timeout: 15_000 });
  return r.error ? null : `${r.stdout || ""}${r.stderr || ""}`.trim();
}

export function fixSteps() {
  return [
    "Fix steps:",
    "  1. See why it stops: journalctl --user -u openclaw-gateway -n 80",
    "  2. Config errors (\"Unrecognized key\", \"Legacy config keys\"): openclaw config validate, then",
    "     openclaw doctor --fix (back up openclaw.json first; the installer keeps openclaw.json.pre-upgrade-* copies)",
    "  3. systemctl --user reset-failed openclaw-gateway && systemctl --user start openclaw-gateway",
    "  4. openclaw health, then run installer/install.sh --yes again (it finishes the setup).",
    "  Chats: the installer turned maintenance mode off; if they stay paused: openclaw gateway call gateway.maintenance.exit",
  ];
}

/**
 * Waits until the Gateway service answers health. Fails at once when the service is in the failed state
 * (a crash loop that systemd gave up on), and when it stays stopped past a short grace. Returns { status: "up" | "failed" | "timeout" | "not-loaded", state }.
 */
export async function waitGatewayUp({ run = cliRun, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now,
  waitMs = DEFAULT_GATEWAY_START_MIN * 60_000, pollMs = 3_000, inactiveGraceMs = 45_000, log = console.log } = {}) {
  const started = now();
  let shown = false, first = true, inactiveSince = null;
  for (;;) {
    const st = parseGatewayStatus(run(["gateway", "status", "--json"], { timeout: 30_000 }).out);
    if (first && !st.loaded && !st.rpc) return { status: "not-loaded", state: st.state };
    first = false;
    if (st.state === "failed") return { status: "failed", state: st.state };
    // Stopped and not starting (no restart pending) for a while: it will not come up by waiting.
    inactiveSince = st.state === "inactive" && !st.rpc ? inactiveSince ?? now() : null;
    if (inactiveSince !== null && now() - inactiveSince >= inactiveGraceMs) return { status: "failed", state: st.state };
    if (st.rpc) {
      const h = run(["health"], { timeout: 30_000 }).out;
      if (h.includes("Agents:") && !h.includes("still starting")) return { status: "up", state: st.state };
    }
    if (now() - started >= waitMs) return { status: "timeout", state: st.state };
    if (!shown) { log("Waiting for the Gateway to start (database migrations on the first start can take minutes)…"); shown = true; }
    await sleep(pollMs);
  }
}

async function cli(argv) {
  const [cmd] = argv;
  const num = (flag, envName, dflt) => {
    const i = argv.indexOf(flag);
    const v = Number(i >= 0 ? argv[i + 1] : process.env[envName] ?? dflt);
    return Number.isFinite(v) && v > 0 ? v : dflt;
  };
  if (cmd === "status") {
    const s = parseGatewayStatus(cliRun(["gateway", "status", "--json"], { timeout: 30_000 }).out);
    console.log(`${s.loaded ? 1 : 0} ${s.state} ${s.rpc ? 1 : 0}`);
    return 0;
  }
  if (cmd === "config-check") {
    const r = await configCheck({ doctorTimeoutMs: num("--doctor-min", "WORKBENCH_DOCTOR_TIMEOUT_MIN", DEFAULT_DOCTOR_TIMEOUT_MIN) * 60_000 });
    if (r.status !== "invalid") return 0;
    console.error("✗ The OpenClaw config is still invalid after openclaw doctor --fix:");
    for (const i of r.issues ?? []) console.error(`  - ${i.path}: ${i.message}`);
    console.error("The Gateway is NOT started: with this config it would crash. OpenClaw is already replaced.");
    console.error("Fix the keys above (openclaw config validate; openclaw config schema), or restore the config:");
    if (r.backup) console.error(`  cp '${r.backup}' \"$(openclaw config file)\"`);
    console.error("then run installer/install.sh --yes again: it validates, starts the Gateway and finishes the setup.");
    return 1;
  }
  if (cmd === "wait-up") {
    const min = num("--min", "WORKBENCH_GATEWAY_START_MIN", DEFAULT_GATEWAY_START_MIN);
    const r = await waitGatewayUp({ waitMs: min * 60_000 });
    if (r.status === "up" || r.status === "not-loaded") { if (r.status === "up") console.log("Gateway is up."); return 0; }
    if (argv.includes("--no-report")) return 1;
    console.error(r.status === "failed"
      ? "✗ The Gateway service failed to start after the upgrade."
      : `✗ The Gateway did not become healthy in ${min} min (service state: ${r.state}).`);
    const j = journalTail();
    if (j) console.error(`--- journalctl --user -u ${GATEWAY_UNIT} -n 40 ---\n${j}\n---`);
    for (const l of fixSteps()) console.error(l);
    console.error("Setup was NOT run against a stopped Gateway.");
    return 1;
  }
  if (cmd === "doctor") {
    console.log("openclaw doctor --fix --non-interactive (the Gateway stays stopped)…");
    const d = await runDoctor({ doctorTimeoutMs: num("--doctor-min", "WORKBENCH_DOCTOR_TIMEOUT_MIN", DEFAULT_DOCTOR_TIMEOUT_MIN) * 60_000 });
    return d.code === 0 ? 0 : 1;
  }
  console.error("usage: upgrade.mjs status | config-check [--doctor-min N] | wait-up [--min N] [--no-report] | doctor");
  return 64;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
}
