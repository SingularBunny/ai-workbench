// Maintenance mode of the Gateway during an install (fork method gateway.maintenance.*): new chat turns,
// automations and heartbeats wait while OpenClaw, plugins, skills and config are replaced; config and
// plugin writes stay open. The state is kept on disk and survives the Gateway restart of the replacement.
//
//   node installer/maintenance.mjs enter [--wait-min N]   — turn on, wait for running turns (exit 0 ready,
//                                                           2 no Gateway / not supported, 3 turns still running)
//   node installer/maintenance.mjs ensure                 — turn on without waiting (after the restart)
//   node installer/maintenance.mjs exit [--retry-sec N]   — turn off. A Gateway that is still starting is retried
//                                                           (WORKBENCH_MAINTENANCE_EXIT_WAIT_SEC, default 180 s);
//                                                           one that is down or never answers: the installer's
//                                                           state file <stateDir>/gateway-maintenance.json is removed
//                                                           (exit 0 also when off; 1 when it could not be turned off)
//
// Functions take `call(method, params)` so installer/test/maintenance.test.mjs checks them without a Gateway.
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MAINTENANCE_SOURCE = "installer";
export const MAINTENANCE_REASON = "OpenClaw update";
/** A killed installer must not pause chats for ever: the Gateway ends maintenance on its own after this. */
export const MAINTENANCE_TTL_MS = 2 * 60 * 60 * 1000;
export const DEFAULT_WAIT_MIN = 30;
export const DEFAULT_EXIT_WAIT_SEC = 180;
export const MAINTENANCE_FILE = "gateway-maintenance.json";

/** Result of `openclaw gateway call … --json`: the JSON after any banner lines. */
export function parseCallOutput(code, out) {
  const text = String(out ?? "");
  const i = text.indexOf("{");
  let json = null;
  if (i >= 0) { try { json = JSON.parse(text.slice(i)); } catch { json = null; } }
  if (code === 0 && json) return { ok: true, result: json };
  const message = (json && (json.error?.message || json.message)) || text.trim().split("\n").slice(-1)[0] || `exit code ${code}`;
  if (/unknown method/i.test(text)) return { ok: false, kind: "unsupported", message };
  if (/ECONNREFUSED|not running|could not connect|connect failed|gateway closed|no gateway|timed? ?out/i.test(text)) return { ok: false, kind: "no-gateway", message };
  return { ok: false, kind: "error", message };
}

/** `openclaw gateway call` as the installer runs it. */
export function cliCall(method, params = {}) {
  const r = spawnSync("openclaw", ["gateway", "call", method, "--params", JSON.stringify(params), "--json"],
    { encoding: "utf8", stdio: "pipe", timeout: 60_000 });
  return parseCallOutput(r.status ?? 1, `${r.stdout || ""}\n${r.stderr || ""}`);
}

const describeWork = (s) => `${s.activeTurns} agent turn(s), ${s.activeWork - s.activeTurns} queued turn(s) or reply delivery(ies)` +
  (s.blockers?.length ? `: ${s.blockers.join("; ")}` : "");

/**
 * Turns maintenance on and waits until no agent turn runs. Returns
 * { status: "ready" | "unsupported" | "no-gateway" | "error" | "timeout", status? }.
 */
export async function enterMaintenance({ call = cliCall, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now, log = console.log, waitMs = DEFAULT_WAIT_MIN * 60_000, pollMs = 5_000, wait = true } = {}) {
  const entered = call("gateway.maintenance.enter", { source: MAINTENANCE_SOURCE, reason: MAINTENANCE_REASON, ttlMs: MAINTENANCE_TTL_MS });
  if (!entered.ok) return { status: entered.kind, message: entered.message };
  log("Maintenance mode on: chats are paused until the install finishes (new messages wait, automations are deferred).");
  if (!wait) return { status: "ready", state: entered.result };
  const started = now();
  let state = entered.result;
  let shown = false;
  while ((state.activeWork ?? 0) > 0) {
    if (now() - started >= waitMs) return { status: "timeout", state };
    if (!shown) { log(`Waiting for running work to finish before OpenClaw is replaced: ${describeWork(state)}.`); shown = true; }
    await sleep(pollMs);
    const polled = call("gateway.maintenance.status", {});
    if (!polled.ok) return { status: polled.kind, message: polled.message };
    state = polled.result;
  }
  if (shown) log("No agent turns are running any more; continuing.");
  return { status: "ready", state };
}

/** Turns maintenance off. Returns { status: "resumed" | "already-off" | "unsupported" | "no-gateway" | "error" }. */
export function exitMaintenance({ call = cliCall, log = console.log } = {}) {
  const r = call("gateway.maintenance.exit", {});
  if (!r.ok) return { status: r.kind, message: r.message };
  if (r.result?.resumed) log("Maintenance mode off: chats resume; waiting messages and deferred automations run now.");
  return { status: r.result?.resumed ? "resumed" : "already-off" };
}

/** Where the fork keeps the state: <stateDir>/gateway-maintenance.json (stateDir: OPENCLAW_STATE_DIR, else the config's folder). */
export function maintenanceFilePath({ env = process.env, configPath = null, home = os.homedir() } = {}) {
  const sd = env.OPENCLAW_STATE_DIR?.trim();
  if (sd) return path.join(sd.startsWith("~") ? path.join(home, sd.slice(1)) : path.resolve(sd), MAINTENANCE_FILE);
  return path.join(configPath ? path.dirname(configPath) : path.join(home, ".openclaw"), MAINTENANCE_FILE);
}

/** Removes the state file when the installer wrote it. Returns "cleared" | "absent" | "left" (another source's). */
export function clearMaintenanceFile(file) {
  let state;
  try { state = JSON.parse(readFileSync(file, "utf8")); } catch (e) { if (e.code === "ENOENT") return { status: "absent" }; state = null; }
  if (state && state.source && state.source !== MAINTENANCE_SOURCE) return { status: "left", source: state.source };
  rmSync(file, { force: true });
  return { status: "cleared" };
}

/**
 * Maintenance must never outlive a failed install. Turns it off through the Gateway, retrying while the Gateway
 * is expected to come up (bounded); a Gateway that is down or never answers: the state file is cleared directly,
 * so the next Gateway start runs chats. Returns { status: "resumed" | "already-off" | "unsupported" | "cleared" |
 * "absent" | "left" | "error" }.
 */
export async function exitMaintenanceSafely({ call = cliCall, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now,
  retryMs = DEFAULT_EXIT_WAIT_SEC * 1000, pollMs = 5_000, gatewayExpected = () => false, file, clear = clearMaintenanceFile,
  log = console.log } = {}) {
  const started = now();
  let shown = false, last;
  for (;;) {
    last = exitMaintenance({ call, log });
    if (["resumed", "already-off", "unsupported"].includes(last.status)) return last;
    if (now() - started >= retryMs || !gatewayExpected()) break;
    if (!shown) { log("Gateway not reachable yet; retrying to turn maintenance mode off…"); shown = true; }
    await sleep(pollMs);
  }
  if (!file) return last;
  const c = clear(file);
  if (c.status === "cleared") log(`Maintenance mode cleared in ${file}: chats run when the Gateway starts.`);
  return c;
}

async function cli(argv) {
  const [cmd] = argv;
  const i = argv.indexOf("--wait-min");
  const waitMin = Number(i >= 0 ? argv[i + 1] : process.env.WORKBENCH_MAINTENANCE_WAIT_MIN ?? DEFAULT_WAIT_MIN);
  if (cmd === "enter" || cmd === "ensure") {
    const r = await enterMaintenance({ wait: cmd === "enter", waitMs: (Number.isFinite(waitMin) && waitMin > 0 ? waitMin : DEFAULT_WAIT_MIN) * 60_000 });
    if (r.status === "ready") return 0;
    if (r.status === "unsupported") { console.log("This OpenClaw has no maintenance mode (gateway.maintenance.*); chats are not paused."); return 2; }
    if (r.status === "no-gateway") return 2;
    if (r.status === "timeout") {
      console.error(`Agent turns still run after ${waitMin} min: ${describeWork(r.state)}.`);
      return 3;
    }
    console.error(`Maintenance mode not turned on: ${r.message}`);
    return 2;
  }
  if (cmd === "exit") {
    const j = argv.indexOf("--retry-sec");
    const sec = Number(j >= 0 ? argv[j + 1] : process.env.WORKBENCH_MAINTENANCE_EXIT_WAIT_SEC ?? DEFAULT_EXIT_WAIT_SEC);
    const { cliRun, parseGatewayStatus } = await import("./upgrade.mjs");
    const gatewayExpected = () => {
      const s = parseGatewayStatus(cliRun(["gateway", "status", "--json"], { timeout: 30_000 }).out);
      return s.rpc || (s.loaded && !["failed", "inactive", "unknown"].includes(s.state));
    };
    const cf = cliRun(["config", "file"], { timeout: 30_000 }).out.trim().split("\n").filter((l) => l.startsWith("/")).at(-1) ?? null;
    const file = maintenanceFilePath({ configPath: cf });
    const r = await exitMaintenanceSafely({ retryMs: (Number.isFinite(sec) && sec >= 0 ? sec : DEFAULT_EXIT_WAIT_SEC) * 1000, gatewayExpected, file });
    if (["resumed", "already-off", "unsupported", "cleared", "absent"].includes(r.status)) return 0;
    console.error(`⚠ Maintenance mode not turned off${r.message ? `: ${r.message}` : r.source ? ` (it was turned on by ${r.source}, not the installer)` : ""}.`);
    console.error("  When the Gateway runs: the Resume chats button in the Control UI, or openclaw gateway call gateway.maintenance.exit");
    console.error(`  Gateway down: delete ${file}, then start it.`);
    return 1;
  }
  console.error("usage: maintenance.mjs enter [--wait-min N] | ensure | exit");
  return 64;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
}
