// Maintenance mode of the Gateway during an install (fork method gateway.maintenance.*): new chat turns,
// automations and heartbeats wait while OpenClaw, plugins, skills and config are replaced; config and
// plugin writes stay open. The state is kept on disk and survives the Gateway restart of the replacement.
//
//   node installer/maintenance.mjs enter [--wait-min N]   — turn on, wait for running turns (exit 0 ready,
//                                                           2 no Gateway / not supported, 3 turns still running)
//   node installer/maintenance.mjs ensure                 — turn on without waiting (after the restart)
//   node installer/maintenance.mjs exit                   — turn off (exit 0 also when off or no Gateway)
//
// Functions take `call(method, params)` so installer/test/maintenance.test.mjs checks them without a Gateway.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MAINTENANCE_SOURCE = "installer";
export const MAINTENANCE_REASON = "OpenClaw update";
/** A killed installer must not pause chats for ever: the Gateway ends maintenance on its own after this. */
export const MAINTENANCE_TTL_MS = 2 * 60 * 60 * 1000;
export const DEFAULT_WAIT_MIN = 30;

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
    const r = exitMaintenance();
    if (r.status === "error") { console.error(`⚠ Maintenance mode not turned off: ${r.message}\n  Turn it off with the Resume chats button in the Control UI, or: openclaw gateway call gateway.maintenance.exit`); return 1; }
    return 0;
  }
  console.error("usage: maintenance.mjs enter [--wait-min N] | ensure | exit");
  return 64;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
}
