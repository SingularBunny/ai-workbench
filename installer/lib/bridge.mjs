// The Claude bridge: chat adoption, hooks and the chats timer. Part of installer/lib.mjs (pure functions, no I/O).
import path from "node:path";

import { RESTART_AGENT_RUN_WAIT_MS } from "./gateway.mjs";

/**
 * Chats by project (Claude Desktop & Code bridge, aiwb-plugins/claude-bridge): Claude Desktop tree folder → agent.
 * The project name in project.json matches the folder in WORKBENCH_CLAUDE_DESKTOP_ROOT: Claude Desktop names
 * a project's working folder after the project. Folders without a project go to the main agent.
 */
/** The bridge's projects tree root (WORKBENCH_CLAUDE_DESKTOP_ROOT): no root, no step — the plugin has no default. */
export function bridgeRootSteps(root) {
  return root ? [{ kind: "config", id: "plugins.entries.aiwb-claude-bridge.config.memorySync.root", note: root,
    argv: ["config", "set", "plugins.entries.aiwb-claude-bridge.config.memorySync.root", JSON.stringify(root), "--strict-json"] }] : [];
}

export function chatsProjectsStep(projects) {
  const map = Object.fromEntries(projects.filter((p) => p.name).map((p) => [p.name, p.id]));
  // Only config.projects: the user sets the plugin's other keys (order: folder order),
  // and a re-install does not erase them.
  return { kind: "config", id: "plugins.entries.aiwb-claude-bridge.config.projects",
    note: Object.keys(map).length ? Object.entries(map).map(([f, a]) => `${f}→${a}`).join(", ") : "all folders → main",
    argv: ["config", "set", "plugins.entries.aiwb-claude-bridge.config.projects", JSON.stringify(map), "--strict-json"] };
}

/** The bridge marks a running turn with turn start and end hooks, which need conversation access (the conversation is not read).
 *  Only this key: allowPromptInjection (memory sync) is the user's and a re-install keeps it. */
export function projectsHooksStep() {
  return { kind: "config", id: "plugins.entries.aiwb-claude-bridge.hooks.allowConversationAccess", note: "\"thinking\" status on rows",
    argv: ["config", "set", "plugins.entries.aiwb-claude-bridge.hooks.allowConversationAccess", "true", "--strict-json"] };
}

/** aiwb-groups reads each member's reply from the agent_end hook, which needs conversation access.
 *  Only this key, and only when the profile installs the plugin. */
export function groupsHooksStep() {
  return { kind: "config", id: "plugins.entries.aiwb-groups.hooks.allowConversationAccess", note: "member replies in group chats",
    argv: ["config", "set", "plugins.entries.aiwb-groups.hooks.allowConversationAccess", "true", "--strict-json"] };
}

/** OpenClaw fork: the bridge adopts old chats in the Gateway and reads the live turn status of the tree rows;
 *  the fork lets it call these Gateway methods in process (the list in aiwb-plugins claude-bridge/adopt.js,
 *  GATEWAY_METHODS). Without the fork
 *  claude-code-catalog.mjs adopts from the timer. The value replaces grants for other plugins, if any. */
export const BRIDGE_GATEWAY_METHODS = ["sessions.catalog.list", "sessions.catalog.import", "sessions.patch", "session.visibility.set",
  // The live turn status of the Projects tree rows (the spinner of long Claude CLI turns).
  "sessions.list"];

export function bridgeAdoptionSteps({ fork, chrome = false }) {
  if (!fork) return [];
  const value = `aiwb-claude-bridge=${BRIDGE_GATEWAY_METHODS.join(",")}`;
  return [{ kind: "config", id: "env.vars.OPENCLAW_PLUGIN_GATEWAY_METHODS", note: "chat adoption in the Gateway",
    argv: ["config", "set", "env.vars.OPENCLAW_PLUGIN_GATEWAY_METHODS", JSON.stringify(value), "--strict-json"] },
  // OpenClaw opens an agent's memory index on its first memory search after a start; chats on Claude CLI
  // rarely search, so new chats and memory files stayed unindexed for days. The fork opens them at start.
  { kind: "config", id: "env.vars.OPENCLAW_MEMORY_INDEX_ON_START", note: "memory indexing from Gateway start",
    argv: ["config", "set", "env.vars.OPENCLAW_MEMORY_INDEX_ON_START", JSON.stringify("1"), "--strict-json"] },
  // Utility-model calls (session observer, activity recaps) share the subscription with the agents: at most one
  // observer digest per 1.5 minutes and one recap per 10 minutes while a run lasts (upstream: 12 s and 90 s).
  { kind: "config", id: "env.vars.OPENCLAW_SESSION_OBSERVER_MIN_INTERVAL_MS", note: "fewer utility-model calls",
    argv: ["config", "set", "env.vars.OPENCLAW_SESSION_OBSERVER_MIN_INTERVAL_MS", JSON.stringify("90000"), "--strict-json"] },
  { kind: "config", id: "env.vars.OPENCLAW_ACTIVITY_RECAP_MIN_INTERVAL_MS", note: "fewer utility-model calls",
    argv: ["config", "set", "env.vars.OPENCLAW_ACTIVITY_RECAP_MIN_INTERVAL_MS", JSON.stringify("600000"), "--strict-json"] },
  // A restart required by a config change, an in-process restart and a stop (systemctl stop/restart, SIGTERM) wait up
  // to 30 minutes for running agent turns instead of aborting them after 5 or 20 s (the owner's choice; other work
  // stays bounded by upstream's budgets). The systemd stop timeout follows it: gatewayStopTimeoutSteps.
  { kind: "config", id: "env.vars.OPENCLAW_RESTART_AGENT_RUN_WAIT_MS", note: "restarts and stops wait for running agent turns",
    argv: ["config", "set", "env.vars.OPENCLAW_RESTART_AGENT_RUN_WAIT_MS", JSON.stringify(String(RESTART_AGENT_RUN_WAIT_MS)), "--strict-json"] },
  // The image and pdf tools answer with the configured model only: upstream lets the agent name any model there,
  // paid ones included (15.11.2026, a free agent sent a scan to a paid Gemini). The owner sets the model in config.
  { kind: "config", id: "env.vars.OPENCLAW_MEDIA_MODEL_OVERRIDE", note: "image and pdf tools use the configured model",
    argv: ["config", "set", "env.vars.OPENCLAW_MEDIA_MODEL_OVERRIDE", JSON.stringify("0"), "--strict-json"] },
  // Claude in Chrome for agents on Claude CLI (WORKBENCH_CLAUDE_CHROME=1): browser control, so only on request.
  ...(chrome ? [{ kind: "config", id: "env.vars.OPENCLAW_CLAUDE_CHROME", note: "Claude in Chrome for Claude CLI agents",
    argv: ["config", "set", "env.vars.OPENCLAW_CLAUDE_CHROME", JSON.stringify("1"), "--strict-json"] }] : [])];
}

export const CHATS_TIMER = "aiwb-claude-catalog";

/** User systemd timer units: chats every 10 minutes (migrate/chats-sync.mjs with argv). */
export function chatsTimerUnits({ node, script, argv, pathDirs }) {
  const q = (s) => (/[\s"\\]/.test(s) ? JSON.stringify(s) : s);
  return {
    service: ["[Unit]", "Description=ai-workbench: chats by project and text archive", "", "[Service]", "Type=oneshot",
      `Environment=PATH=${pathDirs.join(":")}`, `ExecStart=${[node, script, ...argv].map(q).join(" ")}`,
      "Nice=10", "IOSchedulingClass=idle", ""].join("\n"),
    timer: ["[Unit]", "Description=ai-workbench: chats every 10 minutes", "", "[Timer]",
      "OnBootSec=2min", "OnUnitActiveSec=10min", "Persistent=true", "", "[Install]", "WantedBy=timers.target", ""].join("\n"),
  };
}

/**
 * Chats timer: the Projects tree (root: WORKBENCH_CLAUDE_DESKTOP_ROOT) and the text chat archive
 * (archive: profile CHATS, { to, secrets, tz, skillsTo, commit }; commit: folders committed locally after each run). Linux with user systemd only; otherwise a skip
 * with a reason (run migrate/chats-sync.mjs by hand). Neither configured: no step.
 */
export function chatsTimerSteps({ root, archive, platform, systemctl, unitDir, node, script, pathDirs }) {
  if (!root && !archive) return [];
  if (platform !== "linux" || !systemctl) return [{ kind: "skip", id: `timer ${CHATS_TIMER}`, reason: "needs Linux with user systemd; run migrate/chats-sync.mjs by hand" }];
  const argv = [...(root ? ["--root", root] : []), ...(archive ? ["--to", archive.to, ...(archive.secrets || []).flatMap((f) => ["--secrets", f]),
    ...(archive.tz ? ["--tz", archive.tz] : []), ...(archive.skillsTo ? ["--skills-to", archive.skillsTo] : []),
    ...(archive.commit || []).flatMap((d) => ["--commit", d])] : [])];
  const units = chatsTimerUnits({ node, script, argv, pathDirs });
  return [{ kind: "timer", id: CHATS_TIMER, note: [root && `tree ${root}`, archive && `archive → ${archive.to}`, archive?.commit?.length && `local commit of ${archive.commit.length} folder(s)`].filter(Boolean).join(", ") + ", every 10 minutes",
    files: { [path.join(unitDir, `${CHATS_TIMER}.service`)]: units.service, [path.join(unitDir, `${CHATS_TIMER}.timer`)]: units.timer } }];
}

/**
 * Working directory of agent runs (agents.entries.<id>.cwd) is the Claude Desktop project folder:
 * Claude CLI writes new chats next to that project's Claude Desktop chats
 * (~/.claude/projects/<folder>), while instructions and memory stay in the agent workspace in the data repository
 * (docs gateway/config-agents/workspace-and-bootstrap.md). main gets the folder of chats without a project. No folder: skip.
 */
export function chatsCwdSteps({ projects, root, exists, noProject = "_no_space" }) {
  if (!root) return [];
  return [...projects.filter((p) => p.name).map((p) => [p.id, p.name]), ["main", noProject]].map(([id, folder]) => {
    const dir = path.join(root, folder);
    return exists(dir)
      ? { kind: "config", id: `agents.entries.${id}.cwd`, note: `chats → ${dir}`, argv: ["config", "set", `agents.entries.${id}.cwd`, JSON.stringify(dir), "--strict-json"] }
      : { kind: "skip", id: `agents.entries.${id}.cwd`, reason: `no folder ${dir}` };
  });
}
