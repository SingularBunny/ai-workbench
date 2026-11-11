// Knowledge base: folders of notes (an Obsidian vault is one) that agents search and write to, for all agents
// and per project agent, like Claude Projects' project knowledge.
//
// From .env: WORKBENCH_KNOWLEDGE — folders for every agent, separated by `:`.
// From the profile: `knowledge: [...]` in a project's project.json — folders of that project's agent.
// Search: memory.search.extraPaths (all agents) and agents.entries.<id>.memory.search.extraPaths (one agent);
// OpenClaw's memory search indexes the Markdown files there. The aiwb-memory plugin tells each agent its folders
// and that it may save notes there (plugins.entries.aiwb-memory.config.knowledge).
//
// PDF and Office files: memory search reads Markdown only, so a timer (aiwb-office's bin/knowledge-text.mjs) keeps
// Markdown text copies under <state>/workbench/knowledge-text/: `all` for the folders of every agent, `agent-<id>` for
// a project's. Those roots, not the copies' folders, are in extraPaths, so adding a folder later does not change
// the memory index scope.
import path from "node:path";

import { chatFolder } from "./chat-files.mjs";

export const KNOWLEDGE_TIMER = "aiwb-knowledge-text";

/**
 * Resolved knowledge folders. global: the .env value; projects: [{ id, knowledge }]. Returns
 * { all: [dirs], byProject: { <id>: [dirs] }, warn }. Bad entries are skipped with a warning; a missing folder
 * is kept (it is indexed once it exists) with a warning.
 */
export function knowledgeFolders({ global, projects = [], home, exists = () => true }) {
  const warn = [];
  const collect = (label, entries) => {
    const dirs = [];
    for (const entry of entries) {
      const folder = chatFolder(entry, { home });
      if (folder.error) { warn.push(`${label}: ${folder.error}; skipped`); continue; }
      if (!exists(folder.dir)) warn.push(`${label}: ${folder.dir} does not exist (yet); memory search skips it until it does`);
      if (!dirs.includes(folder.dir)) dirs.push(folder.dir);
    }
    return dirs;
  };
  const all = collect("WORKBENCH_KNOWLEDGE", String(global ?? "").split(":").map((e) => e.trim()).filter(Boolean));
  const byProject = {};
  for (const p of projects) {
    if (p.knowledge === undefined) continue;
    if (!Array.isArray(p.knowledge) || p.knowledge.some((e) => typeof e !== "string")) {
      warn.push(`project ${p.id}: knowledge must be a list of folder paths; skipped`);
      continue;
    }
    const dirs = collect(`project ${p.id} knowledge`, p.knowledge);
    if (dirs.length) byProject[p.id] = dirs;
  }
  return { all, byProject, warn };
}

/** True when there is any knowledge folder. */
export const hasKnowledge = (k) => Boolean(k && (k.all.length || Object.keys(k.byProject).length));

/** The aiwb-memory config value for the folders: { "*": [...], <agent id>: [...] }. */
export const knowledgeScopes = (k) => ({ ...(k.all.length ? { "*": k.all } : {}), ...k.byProject });

/** The text copy roots: textAll for the folders of every agent, textByProject per project agent. root: none, no copies. */
export function withTextCopies(k, { root }) {
  if (!root || !hasKnowledge(k)) return k;
  return { ...k, textAll: k.all.length ? path.join(root, "all") : null,
    textByProject: Object.fromEntries(Object.keys(k.byProject).map((id) => [id, path.join(root, `agent-${id}`)])) };
}

/** The aiwb-memory config value for the copy roots, by agent id like knowledgeScopes; null without copies. */
export function knowledgeTextScopes(k) {
  if (!k.textAll && !Object.keys(k.textByProject || {}).length) return null;
  return { ...(k.textAll ? { "*": [k.textAll] } : {}), ...Object.fromEntries(Object.entries(k.textByProject || {}).map(([id, d]) => [id, [d]])) };
}

/** A project agent's own memory search folders: its knowledge folders and its copy root. */
export const projectKnowledgeDirs = (k, id) => [...(k.byProject[id] || []), ...(k.textByProject?.[id] ? [k.textByProject[id]] : [])];

/**
 * Timer that refreshes the text copies every 15 minutes. Linux with user systemd only; otherwise a skip with the
 * command to run by hand. No copies (no folders, or no aiwb-office): no step.
 */
export function knowledgeTextTimerSteps({ knowledge, platform, systemctl, unitDir, node, script, pathDirs }) {
  if (!knowledge?.textAll && !Object.keys(knowledge?.textByProject || {}).length) return [];
  const argv = [
    ...(knowledge.textAll ? ["--scope", `${knowledge.textAll}=${knowledge.all.join(":")}`] : []),
    ...Object.entries(knowledge.textByProject).flatMap(([id, root]) => ["--scope", `${root}=${knowledge.byProject[id].join(":")}`]),
  ];
  if (platform !== "linux" || !systemctl) {
    return [{ kind: "skip", id: `timer ${KNOWLEDGE_TIMER}`, reason: `needs Linux with user systemd; run by hand: node ${script} ${argv.join(" ")}` }];
  }
  const q = (s) => (/[\s"\\]/.test(s) ? JSON.stringify(s) : s);
  const service = ["[Unit]", "Description=ai-workbench: text copies of knowledge base PDF and Office files", "", "[Service]", "Type=oneshot",
    `Environment=PATH=${pathDirs.join(":")}`, `ExecStart=${[node, script, ...argv].map(q).join(" ")}`,
    "Nice=10", "IOSchedulingClass=idle", ""].join("\n");
  const timer = ["[Unit]", "Description=ai-workbench: knowledge base text copies every 15 minutes", "", "[Timer]",
    "OnBootSec=3min", "OnUnitActiveSec=15min", "Persistent=true", "", "[Install]", "WantedBy=timers.target", ""].join("\n");
  return [{ kind: "timer", id: KNOWLEDGE_TIMER, note: "text copies of PDF and Office files in the knowledge folders, every 15 minutes",
    files: { [path.join(unitDir, `${KNOWLEDGE_TIMER}.service`)]: service, [path.join(unitDir, `${KNOWLEDGE_TIMER}.timer`)]: timer } }];
}
