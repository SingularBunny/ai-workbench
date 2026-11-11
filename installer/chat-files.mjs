// Chat file folders (OpenClaw fork): folders whose files the Control UI chat previews and
// downloads, any file type, in Full Access sessions — for all agents and per project agent, like
// Claude Desktop's global and per-project folders.
//
// From .env: WORKBENCH_CHAT_FILE_FOLDERS — folders for every agent, separated by `:`.
// From the profile: `chatFileFolders: [...]` in a project's project.json — folders of that project's agent.
// Both go into one fork setting, env.vars.OPENCLAW_ASSISTANT_MEDIA_ROOTS = `*=<folders>;<agent id>=<folders>`.
// Nothing set: the setting is not touched (upstream: only the session's folders, images from anywhere).
import path from "node:path";

export const CHAT_FILES_ENV = "OPENCLAW_ASSISTANT_MEDIA_ROOTS";
const ID = `env.vars.${CHAT_FILES_ENV}`;

/**
 * One folder: `~` expanded, trailing slashes dropped. Returns { dir } or { error }. `/`, the home
 * folder itself and folders containing it are refused, as the fork refuses them.
 */
export function chatFolder(raw, { home }) {
  const text = String(raw ?? "").trim();
  if (!text) return { error: "empty entry" };
  if (/[:;]/.test(text)) return { error: `${text}: a folder path cannot contain ":" or ";"` };
  const expanded = text === "~" ? home : text.startsWith("~/") ? path.join(home, text.slice(2)) : text;
  if (!path.isAbsolute(expanded)) return { error: `${text}: not an absolute or ~ path` };
  const dir = path.resolve(expanded);
  if (dir === path.parse(dir).root) return { error: `${text}: the filesystem root is not allowed` };
  const rel = path.relative(dir, path.resolve(home));
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    return { error: `${text}: the home folder (or a folder containing it) is not allowed` };
  }
  return { dir };
}

/**
 * The config step for OPENCLAW_ASSISTANT_MEDIA_ROOTS. global: the .env value; projects: [{ id, chatFileFolders }];
 * fork: whether OpenClaw is the fork; exists(dir) for the "does not exist" notice. Bad entries are skipped
 * with a warning; a missing folder is kept (it works once it exists) with a warning.
 */
export function chatFileFolderSteps({ global, projects = [], fork, home, exists = () => true }) {
  const warn = [];
  const scopes = [];
  const collect = (label, entries) => {
    const dirs = [];
    for (const entry of entries) {
      const folder = chatFolder(entry, { home });
      if (folder.error) { warn.push(`${label}: ${folder.error}; skipped`); continue; }
      if (!exists(folder.dir)) warn.push(`${label}: ${folder.dir} does not exist (yet); OpenClaw skips it until it does`);
      if (!dirs.includes(folder.dir)) dirs.push(folder.dir);
    }
    return dirs;
  };
  const globalEntries = String(global ?? "").split(":").map((e) => e.trim()).filter(Boolean);
  const all = collect("WORKBENCH_CHAT_FILE_FOLDERS", globalEntries);
  if (all.length) scopes.push(["*", all]);
  let declared = globalEntries.length > 0;
  for (const p of projects) {
    if (p.chatFileFolders === undefined) continue;
    declared = true;
    if (!Array.isArray(p.chatFileFolders) || p.chatFileFolders.some((e) => typeof e !== "string")) {
      warn.push(`project ${p.id}: chatFileFolders must be a list of folder paths; skipped`);
      continue;
    }
    const dirs = collect(`project ${p.id} chatFileFolders`, p.chatFileFolders);
    if (dirs.length) scopes.push([p.id, dirs]);
  }
  if (!declared) return [];
  if (!fork) {
    return [{ kind: "skip", id: ID, reason: "chat file folders need the OpenClaw fork (WORKBENCH_OPENCLAW_PACKAGE)" }];
  }
  const value = scopes.map(([scope, dirs]) => `${scope}=${dirs.join(":")}`).join(";");
  if (!value) return [{ kind: "skip", id: ID, reason: "no usable chat file folders", ...(warn.length ? { warn } : {}) }];
  return [{ kind: "config", id: ID, note: value, ...(warn.length ? { warn } : {}),
    argv: ["config", "set", ID, JSON.stringify(value), "--strict-json"] }];
}
