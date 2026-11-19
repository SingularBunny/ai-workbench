// Plugin dependency files and tool lookup. Part of installer/lib.mjs (pure functions, no I/O).
import path from "node:path";

/**
 * A plugin's dependency file: sibling plugins (`../<folder>`, `~/<path>`) and tools it needs. The key
 * names are the file's format; a profile with plugins in another format sets its own (DEPENDENCIES).
 * yes: the values of `required` that mean required.
 */
export const DEPENDENCIES_FORMAT = { file: "dependencies.yml", siblings: "siblings", tools: "tools",
  path: "path", name: "name", role: "role", required: "required", yes: ["true", "yes"] };

/**
 * Parses a plugin's flat dependency file (`- name: …` opens a section entry, nested
 * `key: value` lines extend it, `>-` starts multi-line text, which is skipped).
 */
export function parseDependencies(text, format = DEPENDENCIES_FORMAT) {
  const f = { ...DEPENDENCIES_FORMAT, ...format };
  const sections = { [f.siblings]: [], [f.tools]: [] };
  // blockIndent is the indent of the key that opened `>-`; deeper lines are text, not fields.
  let current = null, cur = null, blockIndent = -1;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "");
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)[0].length;
    if (blockIndent >= 0 && indent > blockIndent) continue;
    blockIndent = -1;
    if (indent === 0) {
      const name = line.split(":")[0];
      current = name in sections ? name : null;
      cur = null;
      continue;
    }
    if (!current) continue;
    let m = line.match(/^(\s*-\s+)([^:\s]+):\s*(.*)$/);
    if (m) {
      cur = { [m[2]]: m[3].trim() };
      sections[current].push(cur);
      if (m[3].trim().startsWith(">")) blockIndent = m[1].length;
      continue;
    }
    m = line.match(/^\s+([^\s:][^:]*):\s*(.*)$/);
    if (m && cur) {
      const value = m[2].trim();
      if (value.startsWith(">")) { blockIndent = indent; continue; }
      if (!(m[1].trim() in cur)) cur[m[1].trim()] = value;
    }
  }
  return {
    neighbours: sections[f.siblings].filter((r) => r[f.path]).map((r) => ({
      path: r[f.path], role: r[f.role] ?? null, required: f.yes.includes(r[f.required]),
    })),
    tools: sections[f.tools].filter((r) => r[f.name]).map((r) => ({
      name: r[f.name], required: f.yes.includes(r[f.required]),
    })),
  };
}

/** Default folder for own plugin clones: <XDG data dir>/ai-workbench/plugins (~/.local/share/… by default). */
export function defaultPluginsRoot(home, env = {}) {
  return path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "ai-workbench", "plugins");
}

/** Neighbour path: `../x` is relative to the plugin folder, `~/x` to the home folder. */
export function resolveNeighbour(pluginDir, rel, home) {
  if (rel.startsWith("~/") || rel.startsWith("~\\")) return path.join(home, rel.slice(2));
  return path.resolve(pluginDir, rel);
}

/**
 * Checks one plugin's dependencies. Runs nothing: tools are looked up in PATH (`which`),
 * neighbours on disk (`exists`). Check commands in the plugin's file are not executed:
 * that is third-party text.
 */
export function checkPluginDeps({ pluginDir, deps, home, exists, which }) {
  const missing = [], optional = [];
  for (const n of deps.neighbours) {
    const p = resolveNeighbour(pluginDir, n.path, home);
    if (!exists(p)) (n.required ? missing : optional).push(`neighbour ${n.path} → ${p}`);
  }
  for (const t of deps.tools) {
    if (!which(t.name)) (t.required ? missing : optional).push(`tool ${t.name}`);
  }
  return { missing, optional };
}

/** Finds an executable in PATH, honouring PATHEXT on Windows. */
export function makeWhich({ envPath, pathExt, platform, exists, delimiter }) {
  const dirs = (envPath || "").split(delimiter).filter(Boolean);
  const exts = platform === "win32" ? (pathExt || ".EXE;.CMD;.BAT").split(";") : [""];
  return (name) => dirs.some((d) => exts.some((e) => exists(path.join(d, name + e.toLowerCase())) ||
    (e && exists(path.join(d, name + e)))));
}
