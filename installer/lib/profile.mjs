// Merging a profile, projects, main agent, knowledge and shared memory. Part of installer/lib.mjs (pure functions, no I/O).
import path from "node:path";

import { hasKnowledge, knowledgeScopes, knowledgeTextScopes } from "../knowledge.mjs";
import { DEPENDENCIES_FORMAT } from "./dependencies.mjs";
import { sameRepo } from "./repos.mjs";

/**
 * Public build plus the user's personal profile. A profile is a folder with profile.mjs that
 * exports the same as openclaw/workbench.config.mjs: REPOS, PLUGINS, MCP, settings(ctx), all
 * optional. A profile only adds: the same plugin, MCP or marketplace id with a different address
 * is an error, not a silent override; the profile cannot touch Gateway settings (`gateway.*`),
 * so loopback and the token cannot be weakened from someone else's file.
 */
export function mergeProfile(base, profile = {}) {
  const fail = (m) => { throw new Error(`profile: ${m}`); };
  const pl = profile.PLUGINS || {};
  const dup = (items, what) => {
    const seen = new Set();
    for (const x of items) { if (seen.has(x.id)) fail(`${what} ${x.id} already exists in the build`); seen.add(x.id); }
    return items;
  };
  const marketplaces = { ...base.PLUGINS.marketplaces };
  for (const [name, m] of Object.entries(pl.marketplaces || {})) {
    if (marketplaces[name] && !sameRepo(marketplaces[name].repo, m.repo)) fail(`marketplace ${name} with a different address`);
    marketplaces[name] = m;
  }
  const extra = typeof profile.settings === "function" ? profile.settings : () => [];
  return {
    REPOS: [...base.REPOS, ...(profile.REPOS || [])],
    PLUGINS: {
      own: dup([...base.PLUGINS.own, ...(pl.own || [])], "plugin"),
      marketplaces,
      bases: dup([...base.PLUGINS.bases, ...(pl.bases || [])], "base"),
      runtime: dup([...base.PLUGINS.runtime, ...(pl.runtime || [])], "runtime plugin"),
    },
    MCP: dup([...base.MCP, ...(profile.MCP || [])], "MCP server"),
    // Scheduled tasks come only from the profile: the public build has none.
    TASKS: profile.TASKS || null,
    // Projects come only from the profile: a folder with projects/<id>/project.json.
    PROJECTS: profile.PROJECTS || null,
    // The main agent's folder comes only from the profile.
    MAIN: profile.MAIN || null,
    // Shared memory of all agents (aiwb-memory plugin) comes only from the profile: { dir }.
    SHARED_MEMORY: profile.SHARED_MEMORY || null,
    // The text chat archive comes only from the profile: { dir, secrets, tz, learnedSkills }.
    CHATS: profile.CHATS || null,
    GIT_HOOKS: profile.GIT_HOOKS || null,
    // Non-secret WORKBENCH_* values kept in the profile (profileEnv validates them).
    ENV: profile.ENV || {},
    // Format of the plugins' dependency files, if the profile's plugins use another one.
    DEPENDENCIES: { ...DEPENDENCIES_FORMAT, ...(profile.DEPENDENCIES || {}) },
    settings: (ctx) => {
      const own = extra(ctx);
      const bad = own.find(([k]) => /^gateway(\.|$)/.test(k));
      if (bad) fail(`the profile cannot change setting ${bad[0]}: only the public build configures the Gateway`);
      return [...base.settings(ctx), ...own];
    },
  };
}

/**
 * Profile projects → OpenClaw agents, each with its own workspace in the data repository
 * (AGENTS.md, MEMORY.md, memory/). projects: [{ id, name, dir }] from project.json.
 * main is OpenClaw's default agent; a project does not replace it.
 */
export function projectSteps(projects) {
  const seen = new Set();
  return projects.map((p) => {
    if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(p.id || "")) throw new Error(`project ${p.dir}: agent id must be kebab-case, got ${JSON.stringify(p.id)}`);
    if (p.id === "main") throw new Error(`project ${p.dir}: id main is taken by OpenClaw's default agent`);
    if (seen.has(p.id)) throw new Error(`two projects with id ${p.id}`);
    seen.add(p.id);
    // Project knowledge folders (installer/knowledge.mjs) are added to this agent's memory search only.
    const memory = p.knowledgeDirs?.length ? { memory: { search: { extraPaths: p.knowledgeDirs } } } : {};
    return { kind: "config", id: `agents.entries.${p.id}`, note: `${p.name} → ${p.dir}${p.knowledgeDirs?.length ? ` (knowledge: ${p.knowledgeDirs.join(", ")})` : ""}`,
      argv: ["config", "set", `agents.entries.${p.id}`, JSON.stringify({ workspace: p.dir, identity: { name: p.name }, ...memory }), "--strict-json"] };
  });
}

/**
 * Working folder of the ACP sessions a project agent spawns (OpenClaw fork, agents.entries.<id>.acp.cwd):
 * `"acpCwd": "~/code/project"` in project.json. An ACP agent the chat is handed to (`/acp spawn <agent> --bind here`)
 * starts there, in the project's code, instead of the agent workspace with its instructions and memory.
 * Stock OpenClaw rejects the key, so without the fork it is skipped; so are a relative path and a missing folder.
 */
export function acpCwdSteps({ projects, fork, home, exists = () => true }) {
  return projects.filter((p) => p.acpCwd !== undefined).map((p) => {
    const id = `agents.entries.${p.id}.acp.cwd`;
    const skip = (reason) => ({ kind: "skip", id, reason });
    if (typeof p.acpCwd !== "string" || !/^(~(?=\/|$)|\/|[A-Za-z]:[\\/])/.test(p.acpCwd.trim())) {
      return skip(`acpCwd of project ${p.id} must be an absolute path or start with ~`);
    }
    if (!fork) return skip("the ACP working folder needs the OpenClaw fork (WORKBENCH_OPENCLAW_PACKAGE)");
    const dir = path.resolve(p.acpCwd.trim().replace(/^~(?=\/|$)/, home));
    if (!exists(dir)) return skip(`no folder ${dir}`);
    return { kind: "config", id, note: `${p.id}: ACP agents work in ${dir}`,
      argv: ["config", "set", id, JSON.stringify(dir), "--strict-json"] };
  });
}

/**
 * Shared memory: the main agent's workspace lives in the data repository, and its memory/ is
 * searched by memory_search of all agents (memory.search.extraPaths for shared notes, docs reference/memory-config.md).
 * The profile sets the whole extraPaths list. No evergreen yet: OpenClaw 2026.10.10 rejected it; 2026.11.x accepts it (memorySearch extraPaths evergreen).
 */
export function mainSteps({ dir, sharedSearch = true, knowledge }) {
  return [
    { kind: "config", id: "agents.entries.main.workspace", note: `main → ${dir}`,
      argv: ["config", "set", "agents.entries.main.workspace", JSON.stringify(dir), "--strict-json"] },
    ...(sharedSearch ? [extraPathsStep([path.join(dir, "memory")], knowledge)] : []),
  ];
}

/** memory.search.extraPaths of all agents: the shared memory folder plus the knowledge folders for everyone. */
function extraPathsStep(memoryDirs, knowledge) {
  const text = knowledge?.textAll ? [knowledge.textAll] : [];
  const dirs = [...memoryDirs, ...(knowledge?.all ?? []), ...text];
  const note = [...memoryDirs.map((d) => `shared memory → ${d}`), ...(knowledge?.all ?? []).map((d) => `knowledge → ${d}`),
    ...text.map((d) => `knowledge text copies → ${d}`)].join(", ");
  return { kind: "config", id: "memory.search.extraPaths", note,
    argv: ["config", "set", "memory.search.extraPaths", JSON.stringify(dirs), "--strict-json"] };
}

/** aiwb-memory adds to the system prompt (before_prompt_build); OpenClaw calls this hook only with both permissions. */
const memoryHooksStep = () => ({ kind: "config", id: "plugins.entries.aiwb-memory.hooks",
  argv: ["config", "set", "plugins.entries.aiwb-memory.hooks", JSON.stringify({ allowConversationAccess: true, allowPromptInjection: true }), "--strict-json"] });

/**
 * Knowledge folders without a shared memory folder (installer/knowledge.mjs): the folders for everyone go into
 * memory.search.extraPaths unless the main agent's memory step already carries them (searchSet), and aiwb-memory
 * tells each agent its folders.
 */
export function knowledgeSteps({ knowledge, searchSet = false }) {
  if (!hasKnowledge(knowledge)) return [];
  return [
    ...(!searchSet && knowledge.all.length ? [extraPathsStep([], knowledge)] : []),
    { kind: "config", id: "plugins.entries.aiwb-memory.config", note: "knowledge base folders in the agents' context",
      ...(knowledge.warn.length ? { warn: knowledge.warn } : {}),
      argv: ["config", "set", "plugins.entries.aiwb-memory.config", JSON.stringify(memoryConfig({ knowledge })), "--strict-json"] },
    memoryHooksStep(),
  ];
}

/**
 * Shared memory of all agents, as in Claude Desktop (profile SHARED_MEMORY, aiwb-memory plugin):
 * the folder's USER.md and MEMORY.md index go into every agent's context, memory/*.md facts into
 * memory_search of all agents. The folder is not an agent workspace: OpenClaw stops putting an
 * agent's root MEMORY.md and USER.md into context once someone other than the agent edits them.
 */
/** plugins.entries.aiwb-memory.config: the shared memory folder, the knowledge folders and their text copy roots. */
function memoryConfig({ dir, knowledge }) {
  const text = hasKnowledge(knowledge) ? knowledgeTextScopes(knowledge) : null;
  return { ...(dir ? { dir } : {}), ...(hasKnowledge(knowledge) ? { knowledge: knowledgeScopes(knowledge) } : {}), ...(text ? { knowledgeText: text } : {}) };
}

export function sharedMemorySteps({ dir, knowledge }) {
  const config = memoryConfig({ dir, knowledge });
  return [
    extraPathsStep([path.join(dir, "memory")], knowledge),
    { kind: "config", id: "plugins.entries.aiwb-memory.config", note: `shared memory → ${dir}`,
      ...(knowledge?.warn.length ? { warn: knowledge.warn } : {}),
      argv: ["config", "set", "plugins.entries.aiwb-memory.config", JSON.stringify(config), "--strict-json"] },
    // The plugin appends text to the system prompt (before_prompt_build): OpenClaw calls this hook
    // only with both permissions, although the plugin does not read the conversation (docs plugins/agent-guidance.md).
    memoryHooksStep(),
  ];
}

/**
 * Own plugins with a Control UI page (entry field `ui`: the page name, e.g. the Proxy page of fork
 * settings) need Custom plugin UI. It is one switch for every installed plugin, so it is turned on only
 * when such a plugin is in the plan.
 */
export function pluginUiSteps(ownPlugins) {
  const pages = ownPlugins.filter((p) => p.ui).map((p) => p.ui);
  if (!pages.length) return [];
  return [{ kind: "config", id: "gateway.controlUi.experimental.customPlugins", note: `Custom plugin UI (${pages.join(", ")} page${pages.length > 1 ? "s" : ""})`,
    argv: ["config", "set", "gateway.controlUi.experimental.customPlugins", "true", "--strict-json"] }];
}

/** Old MCP versions next to the current one (`<…>/mcp/<id>/<version>`) are garbage after an update. */
export const staleVersions = (versions, current) => versions.filter((v) => v !== current);

/** Profile from git: a URL instead of a folder. The folder is --profile-dir or <plugins-root>/<repository name>. */
export const isGitUrl = (s) => /^(https?:\/\/|git@|ssh:\/\/|file:\/\/)/.test(String(s || ""));

export function profileTarget(url, { profileDir = null, pluginsRoot }) {
  if (profileDir) return profileDir;
  const name = String(url).replace(/[?#].*$/, "").replace(/\/+$/, "").split(/[/:]/).pop().replace(/\.git$/, "");
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name === "." || name === "..") throw new Error(`cannot derive a folder name from the profile URL: ${url}; set --profile-dir`);
  return path.join(pluginsRoot, name);
}

/** What to do with the profile folder: clone, use the existing clone, or refuse (foreign origin, not git). */
export function profileSource(url, target, st) {
  if (!st.exists) return { action: "clone", dir: target };
  if (!st.isGit) return { action: "refuse", reason: `${target} exists but is not a git clone; set a different --profile-dir` };
  if (!sameRepo(st.origin, url)) return { action: "refuse", reason: `${target}: origin ${st.origin || "not set"}, but the profile is ${url}` };
  const warn = [];
  if (st.dirty) warn.push(`uncommitted files: ${st.dirty}`);
  if (st.ahead) warn.push(`unpushed commits: ${st.ahead}`);
  return { action: "use", dir: target, warn };
}

/**
 * Profile git hooks (GIT_HOOKS = { "pre-commit": "tools/check-secrets.sh" }): a symlink in
 * .git/hooks, so after a clone on a new machine the secrets check works without a manual step.
 * A foreign hook in the same place is not overwritten.
 */
export function hookSteps(profileRoot, hooks, { linkTarget, isGit }) {
  if (!hooks || !isGit) return [];
  return Object.entries(hooks).map(([name, rel]) => {
    if (!/^[a-z-]+$/.test(name)) throw new Error(`profile hook: bad name ${JSON.stringify(name)}`);
    const hook = path.join(profileRoot, ".git", "hooks", name);
    const script = path.join(profileRoot, ...rel.split("/"));
    const now = linkTarget(hook);
    if (now === script) return { kind: "hook", id: name, note: "already linked" };
    if (now !== null) return { kind: "skip", id: `hook ${name}`, reason: `${hook} already holds another hook; leaving it` };
    return { kind: "hook", id: name, note: `→ ${rel}`, link: { from: hook, to: script } };
  });
}

/**
 * One skill name in several own plugins. Skill names are global in OpenClaw: plugin skills are
 * symlinks in <state>/plugin-skills/<name>, and the plugin installed first takes the slot
 * (Docker 05.11.2026: changing the install order changed the version too). Identical files
 * (same sha) are not a collision. skills: { pluginId → [{ name, dir, sha }] | null if not
 * cloned yet } in install order; current: name → folder the link points to now (or null).
 */
export function skillCollisions(skills, current = () => null, { namespaced = false } = {}) {
  const by = new Map();
  for (const [id, list] of Object.entries(skills)) for (const s of list || []) {
    if (!by.has(s.name)) by.set(s.name, []);
    by.get(s.name).push({ id, ...s });
  }
  const out = [];
  for (const [name, all] of by) {
    if (new Set(all.map((s) => s.sha)).size < 2) continue;
    // The fork names plugin skills that share a name <plugin>:<name>, as Claude Code does; otherwise
    // the plugin linked first takes the plain name.
    if (namespaced) {
      out.push({ kind: "collision", id: name, note: `available as ${all.map((s) => `${s.id}:${name}`).join(", ")}; the plain name only where a project picks a version`,
        warn: ["to give a project agent the plain name, use project.json: \"skills\": { \"" + name + "\": \"<plugin>\" }"] });
      continue;
    }
    const now = current(name);
    const winner = all.find((s) => s.dir === now) || all[0];
    out.push({ kind: "collision", id: name, note: `${all.map((s) => s.id).join(", ")}: agents get the ${winner.id} version${winner.dir === now ? "" : " (installed first)"}`,
      warn: ["to give a project agent another version, use project.json: \"skills\": { \"" + name + "\": \"<plugin>\" }"] });
  }
  return out;
}

/**
 * Skill version for a project agent: project.json "skills": { "<name>": "<plugin id>" } becomes
 * a symlink <workspace>/skills/<name> to the plugin's skill folder. In OpenClaw workspace skills
 * take precedence over plugin skills (docs tools/skills.md, "Loading order"), so the agent sees this version.
 * A foreign file or folder in the link's place is left alone. allowed is the current skills.load.allowSymlinkTargets.
 */
export function skillLinkSteps(projects, skills, { linkTarget, allowed = [] }) {
  const steps = [];
  for (const p of projects) for (const [name, plugin] of Object.entries(p.skills || {})) {
    const id = `${p.id}: ${name} ← ${plugin}`;
    const s = (skills[plugin] || []).find((x) => x.name === name);
    if (skills[plugin] === null) { steps.push({ kind: "skip", id, reason: `plugin ${plugin} is not cloned yet; the link will appear on the next install` }); continue; }
    if (!skills[plugin]) { steps.push({ kind: "skip", id, reason: `plugin ${plugin} is not being installed` }); continue; }
    if (!s) { steps.push({ kind: "skip", id, reason: `plugin ${plugin} has no skill ${name}` }); continue; }
    const from = path.join(p.dir, "skills", name);
    const now = linkTarget(from);
    if (now === s.dir) { steps.push({ kind: "skill-link", id, note: "already linked", target: s.dir }); continue; }
    if (now === "(file)") { steps.push({ kind: "skip", id, reason: `${from} is not a link; leaving it` }); continue; }
    steps.push({ kind: "skill-link", id, note: `→ ${s.dir}`, link: { from, to: s.dir }, replace: now !== null, target: s.dir });
  }
  // Without this OpenClaw ignores a link from the workspace to outside it (docs tools/skills-config.md,
  // "Symlinked skill roots"; Docker 05.11.2026: without the key the agent saw the plugin version).
  // The list gets exactly the linked skill folders, added to what it already had.
  const targets = steps.filter((x) => x.target).map((x) => x.target);
  const have = Array.isArray(allowed) ? allowed : [];
  const want = [...new Set([...have, ...targets])];
  if (targets.length && want.length !== have.length) {
    steps.push({ kind: "config", id: "skills.load.allowSymlinkTargets", note: `+${want.length - have.length} project skill folders`,
      argv: ["config", "set", "skills.load.allowSymlinkTargets", JSON.stringify(want), "--strict-json"] });
  }
  return steps;
}
