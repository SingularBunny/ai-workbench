// IDE integration over ACP. Part of installer/lib.mjs (pure functions, no I/O).
import path from "node:path";

/**
 * OpenClaw agent in JetBrains AI Assistant: an entry in ~/.jetbrains/acp.json (the schema lives in the IDE,
 * schemas/acp.schema.json of the intellij.ml.llm.agents.acp.json module). The `openclaw acp` bridge rejects
 * MCP servers passed by the IDE, so both MCP kinds are disabled for this agent.
 * Other entries in the file are left alone; an earlier entry with the same name goes into the manifest.
 */
export const ACP_AGENT = "OpenClaw";

/**
 * How the IDE should launch openclaw: started from the desktop, it does not know the shell PATH.
 * A script with an `env node` shebang (npm link in Node's bin) runs via the Node in the same folder,
 * otherwise via the Node that ran the installer (Docker 05.11.2026: without node the bridge stayed silent).
 * Anything else, the install-cli.sh wrapper (`exec <node> <entry.js>` by absolute paths) or a binary,
 * runs as is (verified 05.11.2026: Node with a bash wrapper as argument would not start).
 */
export function acpLaunch({ bin, real, firstLine, siblingNode, execPath }) {
  if (/^#!\s*\/usr\/bin\/env\s+node\b/.test(firstLine || "")) return { command: siblingNode || execPath, args: [real, "acp"] };
  return { command: bin, args: ["acp"] };
}

export const acpEntry = ({ command, args }) =>
  ({ type: "custom", command, args: [...args], env: {}, use_custom_mcp: false, use_idea_mcp: false });

/**
 * text: acp.json contents, "" if the file does not exist; ideDir: whether ~/.jetbrains exists (an IDE
 * with AI Assistant has run); openclaw: { command, args } from acpLaunch, or null.
 */
export function ideSteps({ acpFile, ideDir, text, openclaw }) {
  const id = `JetBrains ${ACP_AGENT}`;
  if (!ideDir) return [{ kind: "skip", id, reason: `no ${path.dirname(acpFile)}: JetBrains AI Assistant has not been run` }];
  if (!openclaw) return [{ kind: "skip", id, reason: "openclaw path not found (the entry is untested on Windows); add it manually" }];
  let cur = {};
  if (text.trim()) {
    try { cur = JSON.parse(text); } catch { return [{ kind: "skip", id, reason: `${acpFile} does not parse as JSON; leaving it` }]; }
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return [{ kind: "skip", id, reason: `${acpFile}: not an object; leaving it` }];
  }
  const want = acpEntry(openclaw);
  const was = cur.agent_servers?.[ACP_AGENT];
  if (JSON.stringify(was) === JSON.stringify(want)) return [{ kind: "ide", id, note: "already registered", file: acpFile }];
  const warn = was ? ["the entry with this name will be replaced; the old one is kept in the manifest and uninstall restores it"] : [];
  return [{ kind: "ide", id, note: `${acpFile} → ${[openclaw.command, ...openclaw.args].join(" ")}`, warn, file: acpFile, name: ACP_AGENT, entry: want }];
}

/** New acp.json text: entry name = entry, null removes it. Everything else stays as it was. */
export function applyAcp(text, name, entry) {
  const cur = text.trim() ? JSON.parse(text) : {};
  const servers = { ...(cur.agent_servers || {}) };
  if (entry === null) delete servers[name]; else servers[name] = entry;
  return JSON.stringify({ ...cur, agent_servers: servers }, null, 2) + "\n";
}
