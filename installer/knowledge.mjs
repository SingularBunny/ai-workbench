// Knowledge base: folders of notes (an Obsidian vault is one) that agents search and write to, for all agents
// and per project agent, like Claude Projects' project knowledge.
//
// From .env: WORKBENCH_KNOWLEDGE — folders for every agent, separated by `:`.
// From the profile: `knowledge: [...]` in a project's project.json — folders of that project's agent.
// Search: memory.search.extraPaths (all agents) and agents.entries.<id>.memory.search.extraPaths (one agent);
// OpenClaw's memory search indexes the Markdown files there. The aiwb-memory plugin tells each agent its folders
// and that it may save notes there (plugins.entries.aiwb-memory.config.knowledge).
import { chatFolder } from "./chat-files.mjs";

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
