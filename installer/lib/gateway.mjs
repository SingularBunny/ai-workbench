// The Gateway service: stop timeout, running turns and automations. Part of installer/lib.mjs (pure functions, no I/O).
import path from "node:path";

/** How long the fork's Gateway waits for running agent turns on restart and stop (OPENCLAW_RESTART_AGENT_RUN_WAIT_MS). */
export const RESTART_AGENT_RUN_WAIT_MS = 30 * 60_000;

export const GATEWAY_UNIT = "openclaw-gateway.service";

export const GATEWAY_STOP_DROPIN = "aiwb-agent-turn-wait.conf";

/** Time the Gateway keeps for its own cleanup after the wait, before systemd may kill it. */
const GATEWAY_STOP_MARGIN_MS = 2 * 60_000;

/** The drop-in: systemd waits for the Gateway's stop as long as the Gateway waits for agent turns, plus a margin. */
export function gatewayStopTimeoutDropIn(waitMs = RESTART_AGENT_RUN_WAIT_MS) {
  return ["# ai-workbench: the OpenClaw fork waits for running agent turns on stop and restart",
    "# (OPENCLAW_RESTART_AGENT_RUN_WAIT_MS); systemd must not kill it before that wait ends.",
    "[Service]", `TimeoutStopSec=${Math.ceil((waitMs + GATEWAY_STOP_MARGIN_MS) / 1000)}`, ""].join("\n");
}

/**
 * Stop timeout of the Gateway service with the fork. `openclaw gateway install` writes TimeoutStopSec=330 into
 * the unit (fixed installer policy, no option) and rewrites the unit on every install; drop-ins it never
 * rewrites, and the running Gateway reads the merged TimeoutStopUSec, so a drop-in raises the stop timeout and
 * survives reinstalls. Linux with the user service only. Without the fork, or on uninstall, our drop-in goes.
 * The reload is its own step: a running Gateway sees the new timeout at its next stop.
 */
export function gatewayStopTimeoutSteps({ fork, platform, systemctl, unitDir, exists, read = () => null, waitMs = RESTART_AGENT_RUN_WAIT_MS }) {
  const dropIn = path.join(unitDir, `${GATEWAY_UNIT}.d`, GATEWAY_STOP_DROPIN);
  const id = `${GATEWAY_UNIT}.d/${GATEWAY_STOP_DROPIN}`;
  const reload = { kind: "daemon-reload", id: "systemctl --user daemon-reload", exec: "systemctl", argv: ["--user", "daemon-reload"] };
  if (!fork) return exists(dropIn) ? [{ kind: "dropin-remove", id, files: [dropIn] }, ...(systemctl ? [reload] : [])] : [];
  if (platform !== "linux" || !systemctl) {
    return [{ kind: "skip", id: "Gateway stop timeout", reason: "systemd only; a stop waits for agent turns as long as the service manager allows" }];
  }
  if (!exists(path.join(unitDir, GATEWAY_UNIT))) {
    return [{ kind: "skip", id: "Gateway stop timeout", reason: `no user service ${GATEWAY_UNIT} (openclaw gateway install); a stop of a Gateway run by hand is not limited` }];
  }
  const text = gatewayStopTimeoutDropIn(waitMs);
  if (read(dropIn) === text) return [];
  return [{ kind: "dropin", id, note: text.match(/TimeoutStopSec=\d+/)[0], files: { [dropIn]: text } }, reload];
}

/** `sessions.list` result → Gateway sessions with a running turn (status running; queued ones do not run yet). */
export function runningSessions(result) {
  return (Array.isArray(result?.sessions) ? result.sessions : []).filter((s) => s?.status === "running").map((s) => s.key || s.sessionKey || "?");
}

/**
 * Scheduled automations that run now or start within `windowMs` (`openclaw cron list --json`): replacing
 * OpenClaw under a starting run breaks it (its modules vanish mid-import). Heartbeats are left out: they
 * only nudge an existing session and come every few minutes.
 */
export function upcomingAutomations(result, now = Date.now(), windowMs = 15 * 60 * 1000) {
  const jobs = Array.isArray(result?.jobs) ? result.jobs : [];
  return jobs.filter((job) => job && job.enabled !== false && job.payload?.kind !== "heartbeat").flatMap((job) => {
    const state = job.state || {};
    const name = job.name || job.id || "?";
    if (Number.isFinite(state.runningAtMs)) return [`${name} (running)`];
    const next = state.nextRunAtMs;
    if (!Number.isFinite(next) || next < now - 60_000 || next > now + windowMs) return [];
    return [`${name} (in ${Math.max(0, Math.round((next - now) / 60_000))} min)`];
  });
}
