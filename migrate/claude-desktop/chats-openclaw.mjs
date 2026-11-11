#!/usr/bin/env node
// Claude Desktop chats → OpenClaw sessions in one command: stage into a temp folder
// (chats.mjs --openclaw-stage), run a temporary Gateway with CLAUDE_CONFIG_DIR pointing at it, run the
// stock import (chats-import.mjs), restore the Gateway to its previous state, delete the folder. Safe to
// repeat: the import does not create copies, it appends what is new.
//
//   node migrate/claude-desktop/chats-openclaw.mjs [--from <folder>] [--secrets <.env>]… [--claude-code '<glob>']…
//
// Gateway: as a service (systemd/launchd) it is stopped and started through the service; started by
// hand (`openclaw gateway run`) it is stopped and, after the import, started in the background with the
// log <state>/logs/gateway-run.log; if it was not running, it is not started after the import.
// Claude Code continuations are looked up in all of ~/.claude/projects/* by default (chats.mjs).
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, openSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const bin = process.env.OPENCLAW_BIN || "openclaw";
const stateDir = process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const oc = (argv) => spawnSync(bin, argv, { encoding: "utf8", stdio: "pipe" });
const up = () => oc(["health"]).status === 0;
const node = (script, argv) => spawnSync(process.execPath, [path.join(here, script), ...argv], { stdio: "inherit" }).status;

async function waitFor(want, sec) {
  for (let i = 0; i < sec; i++) { if (up() === want) return true; await sleep(1000); }
  return up() === want;
}

/** How the Gateway runs now: "service", "foreground" (pid), "none". */
function gatewayMode() {
  if (!up()) return { mode: "none" };
  const st = oc(["gateway", "status", "--json", "--no-probe"]);
  let svc = null;
  try { svc = JSON.parse(st.stdout.slice(st.stdout.indexOf("{"))).service; } catch { /* treated as manual below */ }
  if (svc?.runtime?.status === "running") return { mode: "service" };
  const pg = spawnSync("pgrep", ["-u", String(process.getuid()), "-f", "^openclaw-gateway"], { encoding: "utf8" });
  const pids = (pg.stdout || "").split(/\s+/).filter(Boolean).map(Number);
  return { mode: "foreground", pids };
}

async function stopGateway(g) {
  if (g.mode === "service") oc(["gateway", "stop"]);
  if (g.mode === "foreground") for (const p of g.pids) { try { process.kill(p, "SIGTERM"); } catch { /* already gone */ } }
  if (!(await waitFor(false, 30))) throw new Error("Gateway did not stop within 30 s");
}

function startDetached(env, log) {
  mkdirSync(path.dirname(log), { recursive: true });
  const out = openSync(log, "a");
  const child = spawn(bin, ["gateway", "run"], { env, detached: true, stdio: ["ignore", out, out] });
  child.unref();
  return child;
}

const before = gatewayMode();
const stage = mkdtempSync(path.join(os.tmpdir(), "aiwb-chats-"));     // 0700: it holds transcript copies
let temp = null, code = 1;
console.log(`Gateway now: ${{ service: "service", foreground: "started manually", none: "not running" }[before.mode]}\nStaging folder: ${stage}\n`);
try {
  if (node("chats.mjs", ["--openclaw-stage", stage, ...args]) !== 0) throw new Error("staging failed, see above");
  const set = oc(["config", "set", "plugins.entries.anthropic.config.sessionCatalog.enabled", "true", "--strict-json"]);
  if (set.status !== 0) throw new Error(`Claude catalog was not enabled: ${set.stdout}${set.stderr}`.trim());
  if (before.mode !== "none") { console.log("\n→ stopping the Gateway"); await stopGateway(before); }
  console.log("→ temporary Gateway on the staging folder");
  temp = startDetached({ ...process.env, CLAUDE_CONFIG_DIR: stage }, path.join(stage, "gateway.log"));
  if (!(await waitFor(true, 120))) throw new Error(`temporary Gateway did not come up within 120 s, log ${path.join(stage, "gateway.log")}`);
  console.log("→ import\n");
  code = node("chats-import.mjs", ["--plan", path.join(stage, "import-plan.json")]);
} catch (e) {
  console.error(`✗ ${e.message}`);
} finally {
  if (temp) {
    try { process.kill(-temp.pid, "SIGTERM"); } catch { try { process.kill(temp.pid, "SIGTERM"); } catch { /* already gone */ } }
    await waitFor(false, 30);
  }
  if (before.mode === "service") { oc(["gateway", "start"]); }
  if (before.mode === "foreground") {
    const log = path.join(stateDir, "logs", "gateway-run.log");
    const env = { ...process.env };
    delete env.CLAUDE_CONFIG_DIR;
    startDetached(env, log);
    console.log(`\nGateway was started manually; started again in the background, log ${log}`);
  }
  if (before.mode !== "none" && !(await waitFor(true, 120))) { console.error("✗ Gateway did not come back up; run `openclaw gateway run`"); code = 1; }
  rmSync(stage, { recursive: true, force: true });
  console.log("Staging folder deleted.");
}
process.exit(code);
