// Pure installer functions: no commands run and nothing written to disk, so the tests in
// installer/test/*.test.mjs can check them. Only built-in Node modules, no dependencies:
// at this point Node comes from the official OpenClaw installer and nothing else.
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";

import { hasKnowledge, knowledgeScopes, knowledgeTextScopes } from "./knowledge.mjs";

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

/** .env lines without the given keys: drops lines appended by an earlier install (manifest.env).
 *  The env.vars setting now provides the same values, and a .env line would override it. */
export const removeEnvLines = (envText, keys) =>
  envText.split(/(?<=\n)/).filter((line) => !keys.some((k) => line.startsWith(`${k}=`))).join("");

/** Keys a profile may not set in ENV: secrets and proxy URLs (they may hold credentials) stay in .env. */
const SECRET_ENV_KEY = /TOKEN|KEY|SECRET|PASSWORD|_PROXY$|PROXY_URL|PACKAGE_SHA256/;

/**
 * Profile ENV: non-secret WORKBENCH_* values the profile keeps in git (models, proxy hosts, folders,
 * presets). Returns { values, error }: values as strings; a key outside WORKBENCH_* or one that looks
 * secret is an error (it belongs in .env only).
 */
export function profileEnv(env = {}) {
  const values = {};
  for (const [k, v] of Object.entries(env)) {
    if (!/^WORKBENCH_[A-Z0-9_]+$/.test(k)) return { error: `ENV ${k}: only WORKBENCH_* keys` };
    if (SECRET_ENV_KEY.test(k)) return { error: `ENV ${k}: secrets and proxy URLs stay in .env, not in the profile` };
    if (k === "WORKBENCH_PROFILE" || k === "WORKBENCH_PLUGINS_ROOT") return { error: `ENV ${k}: read before the profile, set it in .env` };
    values[k] = String(v);
  }
  return { values };
}

/** .env text with the given keys set: an existing line is replaced in place, a new key is appended. */
export function setEnvLines(envText, values) {
  let text = envText;
  for (const [k, v] of Object.entries(values)) {
    const line = `${k}=${v}`;
    const re = new RegExp(`^${k}=.*$`, "m");
    text = re.test(text) ? text.replace(re, () => line) : `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`;
  }
  return text;
}

/** .env lines: adds the Gateway token if missing; leaves existing values alone. */
export function ensureGatewayToken(envText, token = randomBytes(24).toString("hex")) {
  const has = /^OPENCLAW_GATEWAY_TOKEN=\S+/m.test(envText);
  if (has) return { text: envText, added: false };
  const sep = envText && !envText.endsWith("\n") ? "\n" : "";
  return { text: `${envText}${sep}OPENCLAW_GATEWAY_TOKEN=${token}\n`, added: true };
}

/**
 * Install plan: what will be done and in what order. Order matters: Anthropic base plugins
 * first (own plugins build on them), then runtime plugins, then own plugins, then settings
 * (acpx settings are only valid once acpx is installed).
 */
export function buildPlan({ settings, plugins, pluginsRoot, projectRoot, profileRoot, env, ownState, marketplaceDir, before = [], beforeConfig = [] }) {
  const steps = [...before];
  for (const [name, m] of Object.entries(plugins.marketplaces || {})) {
    // A marketplace with no base plugins in use is not cloned: the public build without a profile downloads nothing extra.
    if (!(plugins.bases || []).some((b) => b.marketplace === name)) continue;
    const where = marketplaceDir(name);
    steps.push(...marketplaceSteps(name, m, where));
  }
  for (const b of plugins.bases) {
    steps.push({ kind: "base", id: b.id, market: b.marketplace,
      argv: ["plugins", "install", b.id, "--marketplace", marketplaceDir(b.marketplace).dir,
        "--force", "--accept-capabilities"] });
  }
  for (const r of plugins.runtime) {
    if (r.when && !env[r.when]) continue;
    steps.push({ kind: "runtime", id: r.id, argv: ["plugins", "install", r.id, "--force"] });
  }
  for (const o of plugins.own) {
    const dir = path.join(o.root === "project" ? projectRoot : o.root === "profile" ? profileRoot : pluginsRoot, ...o.dir.split("/"));
    const state = ownState(o, dir);
    if (!state.present) { steps.push({ kind: "skip", id: o.id, reason: `no folder ${dir}` }); continue; }
    if (state.missing.length) {
      steps.push({ kind: "skip", id: o.id, reason: `missing required: ${state.missing.join("; ")}` });
      continue;
    }
    steps.push({ kind: "own", id: o.id, dir, pending: !!state.pending,
      warn: [o.warn, state.pending && "dependencies will be checked after the clone",
        ...state.optional.map((x) => `missing optional: ${x}`)].filter(Boolean),
      argv: ["plugins", "install", "--link", dir, "--force", "--accept-capabilities"] });
  }
  steps.push(...beforeConfig);
  for (const [key, value] of settings) {
    steps.push({ kind: "config", id: key, argv: ["config", "set", key, JSON.stringify(value), "--strict-json"] });
  }
  steps.push({ kind: "check", id: "config validate", argv: ["config", "validate"] });
  return steps;
}

/**
 * Own clone of a marketplace. With `commit`, exactly that commit: fetch by sha and
 * checkout --detach, then verify HEAD; a mismatch is an error, not a silently different version.
 * Without commit, the branch tip as before, with a warning. Only a full sha is accepted: a short
 * one is ambiguous (OpenSSF Scorecard, Pinned-Dependencies).
 */
export function marketplaceSteps(name, m, where) {
  if (m.commit && !/^[0-9a-f]{40}$/.test(m.commit)) throw new Error(`marketplace ${name}: commit must be a full 40-character sha, got ${JSON.stringify(m.commit)}`);
  if (!m.commit) {
    const warn = ["not pinned to a commit: base plugin versions drift with the branch tip"];
    return [where.present
      ? { kind: "marketplace", id: name, dir: where.dir, note: `git pull ${m.repo}`, warn, market: name,
          exec: "git", argv: ["-C", where.dir, "pull", "--ff-only", "--depth", "1"] }
      : { kind: "marketplace", id: name, dir: where.dir, note: `clone ${m.repo}`, warn, market: name,
          exec: "git", argv: ["clone", "--depth", "1", m.repo, where.dir] }];
  }
  const short = m.commit.slice(0, 12);
  return [
    ...(where.present ? [] : [{ kind: "marketplace", id: name, dir: where.dir, note: `clone ${m.repo}`, market: name,
      exec: "git", argv: ["clone", "--depth", "1", "--no-checkout", m.repo, where.dir] }]),
    { kind: "marketplace", id: `${name} @${short}`, dir: where.dir, note: `commit ${m.commit}`, market: name,
      exec: "git", argv: ["-C", where.dir, "fetch", "--depth", "1", "origin", m.commit] },
    { kind: "marketplace", id: `${name} @${short}`, dir: where.dir, note: "checkout", quiet: true, market: name,
      exec: "git", argv: ["-C", where.dir, "checkout", "--detach", "--force", m.commit] },
    { kind: "marketplace", id: `${name} @${short}`, dir: where.dir, note: "verify HEAD", quiet: true, market: name, expect: m.commit,
      exec: "git", argv: ["-C", where.dir, "rev-parse", "HEAD"] },
  ];
}

/**
 * Anthropic base plugins already installed from git at the commit their marketplace pins are kept, not
 * reinstalled: the reinstall clones the same commit again, and that clone often fails on the network.
 * pinOf(market, id) → { url, sha } or null; installedAt(url, sha) → whether an installed copy is at it.
 */
export function keepPinnedBases(steps, { pinOf, installedAt }) {
  return steps.map((s) => {
    if (s.kind !== "base") return s;
    const pin = pinOf(s.market, s.id);
    return pin && installedAt(pin.url, pin.sha)
      ? { kind: "keep", id: s.id, reason: `already at the pinned commit ${pin.sha.slice(0, 7)}` } : s;
  });
}

/**
 * Providers with a free tier (docs/install/free-providers.md): provider id → the .env keys OpenClaw reads for it.
 * A provider whose key is set counts as free for Multi-model (aiwb-compare freeProviders), so its models can be
 * answering models. WORKBENCH_FREE_PROVIDERS overrides the list: ids separated by commas, or "none".
 */
// Only providers whose calls are free with a plain key: in November 2026 Cerebras, NVIDIA and Mistral asked for a
// payment method before issuing a key, and Hugging Face answered 402 "purchase pre-paid credits" for a new account.
// A paid key counted as free would let Multi-model spend money; such models can be marked free with
// WORKBENCH_FREE_PROVIDERS.
export const FREE_TIER_PROVIDERS = {
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY"], groq: ["GROQ_API_KEY"],
};

export function freeProviderSteps(env) {
  const explicit = String(env.WORKBENCH_FREE_PROVIDERS ?? "").trim();
  const ids = explicit
    ? (explicit === "none" ? [] : explicit.split(",").map((s) => s.trim()).filter(Boolean))
    : Object.entries(FREE_TIER_PROVIDERS).filter(([, keys]) => keys.some((k) => String(env[k] ?? "").trim())).map(([id]) => id);
  if (!explicit && !ids.length) return [];
  return [{ kind: "config", id: "plugins.entries.aiwb-compare.config.freeProviders",
    note: ids.length ? `free model providers: ${ids.join(", ")}` : "no free model providers",
    argv: ["config", "set", "plugins.entries.aiwb-compare.config.freeProviders", JSON.stringify(ids), "--strict-json"] }];
}

/**
 * Own plugins OpenClaw already loads from the same folder are not linked again: `plugins install --link` of an
 * already linked plugin only repeats the record, and it fails outright for a plugin inside another plugin's folder
 * ("package owner … has conflicting child rows"). The step stays an own plugin (its skills still count) with
 * `linked` set; it is shown in the plan and skipped when run. linkedFrom: id → the folder or entry file OpenClaw
 * loads it from, or undefined.
 */
export function keepLinkedOwn(steps, linkedFrom) {
  return steps.map((s) => {
    if (s.kind !== "own" || s.pending) return s;
    const src = linkedFrom(s.id);
    return src && (src === s.dir || src.startsWith(s.dir + path.sep)) ? { ...s, linked: true } : s;
  });
}

/**
 * plugins.load.paths entries whose folder no longer exists (a plugin moved to another repository, a clone deleted):
 * one write that keeps the rest, before the own plugins are linked. OpenClaw only warns about them, on every start.
 */
export function staleLoadPathSteps(paths, { exists }) {
  if (!Array.isArray(paths)) return [];
  const missing = paths.filter((p) => typeof p === "string" && !exists(p));
  if (!missing.length) return [];
  return [{ kind: "config", id: "plugins.load.paths", note: `drop missing folder${missing.length > 1 ? "s" : ""} ${missing.join(", ")}`,
    argv: ["config", "set", "plugins.load.paths", JSON.stringify(paths.filter((p) => !missing.includes(p))), "--strict-json"] }];
}

export function formatPlan(steps) {
  const title = { clone: "repository clone", repo: "repository", "mcp-install": "MCP server", "mcp-download": "MCP server (release)",
    marketplace: "marketplace", base: "Anthropic base", runtime: "OpenClaw plugin", own: "own plugin (--link)",
    config: "setting", "config-batch": "settings, one write", check: "check", skip: "SKIP",
    "plugin-uninstall": "remove plugin", keep: "keep plugin", "config-unset": "unset setting",
    "config-restore": "restore setting", "remove-dir": "remove folder", "keep-config": "keep setting",
    hook: "profile git hook", profile: "profile from git", ide: "IDE agent", "ide-restore": "restore IDE agent",
    "ide-remove": "remove IDE agent", collision: "duplicate skill name", "skill-link": "project skill",
    unlink: "remove link", timer: "systemd timer", "timer-remove": "remove timer", "llama-download": "llama.cpp (release)",
    "env-remove": "remove from .env",
    "chrome-host": "Chrome extension host", "chrome-host-remove": "remove Chrome host", "plugin-rename": "renamed plugins",
    backup: "backup", "backup-schedule": "backup schedule", dropin: "systemd drop-in", "dropin-remove": "remove drop-in",
    "daemon-reload": "systemd reload", "claude-env": "Claude Code proxy" };
  return steps.filter((s) => !s.quiet).map((s) => {
    // An unknown step kind is printed as is: a plan that cannot be labelled is no reason to crash.
    const head = `  ${(title[s.kind] || s.kind).padEnd(22)} ${s.id}`;
    const tail = ["skip", "keep", "keep-config"].includes(s.kind) ? ` — ${s.reason}` : s.kind === "own" ? `  ← ${s.dir}${s.linked ? " (already linked)" : ""}`
      : ["marketplace", "clone", "repo"].includes(s.kind) ? `  ${s.note} → ${s.dir}`
      : s.note ? `  ${s.note}` : "";
    const warns = (s.warn || []).map((w) => `\n${" ".repeat(26)}⚠ ${w}`).join("");
    return head + tail + warns;
  }).join("\n");
}

/**
 * Argument for the Windows command line (`cmd.exe /d /s /c`, then parsed by the
 * CommandLineToArgvW rules): inside double quotes `^ & | < >` are literal to cmd, while `"` and
 * trailing `\` are escaped with a backslash. Otherwise settings JSON loses its quotes.
 */
export function winQuote(arg) {
  if (arg && !/[\s"^&|<>%]/.test(arg)) return arg;
  const body = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1");
  return `"${body}"`;
}

/** git@github.com:a/b.git and https://github.com/a/b(.git) are the same repository. */
export function sameRepo(a, b) {
  const norm = (u) => (u || "").trim().replace(/^git@([^:]+):/, "https://$1/").replace(/^ssh:\/\/git@/, "https://")
    .replace(/\/\/[^@/]+@/, "//").replace(/\.git$/, "").replace(/\/$/, "").toLowerCase();
  return !!a && !!b && norm(a) === norm(b);
}

/**
 * Own plugins and neighbours come from repositories. No folder: clone from origin. Folder
 * present: the clone is used as is (user edits are left alone), and every way it differs from
 * the repository is reported, since that state will not reproduce on another machine.
 * repoState(dir) → { exists, isGit, origin, dirty, ahead }.
 * canReach(repo) → { ok, reason }: repository access is checked before planning, so a private
 * repository without a key or without github.com in known_hosts becomes a skip with a reason
 * instead of failing the install at the clone step.
 */
export function repoSteps({ repos, pluginsRoot, repoState, which = () => true, canReach = () => ({ ok: true }) }) {
  const steps = [], planned = new Set();
  for (const r of repos) {
    const dir = path.join(pluginsRoot, ...r.dir.split("/"));
    const st = repoState(dir);
    if (!st.exists) {
      if (!r.repo) continue;
      if (/^(git@|ssh:\/\/)/.test(r.repo) && !which("ssh")) {
        steps.push({ kind: "skip", id: r.dir, reason: `SSH clone (${r.repo}), but ssh is not in PATH` });
        continue;
      }
      const reach = canReach(r.repo);
      if (!reach.ok) {
        steps.push({ kind: "skip", id: r.dir, reason: `no access to ${r.repo}: ${reach.reason}` });
        continue;
      }
      steps.push({ kind: "clone", id: r.dir, dir, note: r.repo, exec: "git", argv: ["clone", r.repo, dir] });
      planned.add(dir);
      continue;
    }
    const warn = [];
    if (!st.isGit) warn.push("not a git clone: its state cannot be reproduced from the repository");
    else if (!r.repo) warn.push("clone has no origin in the template: it will not install on another machine");
    else if (!sameRepo(st.origin, r.repo)) warn.push(`origin ${st.origin || "not set"}, expected ${r.repo}`);
    if (st.dirty) warn.push(`uncommitted files: ${st.dirty}; another machine will not have them`);
    if (st.ahead) warn.push(`unpushed commits: ${st.ahead}; another machine will not have them`);
    steps.push({ kind: "repo", id: r.dir, dir, note: "clone present", warn });
  }
  return { steps, planned };
}

/**
 * MCP servers come from a publishing channel at a pinned version: npm or a GitHub release.
 * They run by absolute path to the installed copy, without npx and without network at server start.
 */
export function mcpSteps({ mcp, env, stateDir, nodePath, npmCli, platform, arch, which, present, projectRoot, pluginsRoot = projectRoot, tasks = null, openclawBin = null }) {
  const steps = [];
  for (const m of mcp) {
    if (m.when && !env[m.when]) { steps.push({ kind: "skip", id: `mcp ${m.id}`, reason: `${m.when} is not set` }); continue; }
    if (m.needs === "TASKS" && !tasks) { steps.push({ kind: "skip", id: `mcp ${m.id}`, reason: "the profile defines no scheduled tasks" }); continue; }
    if (m.kind === "project") {
      // Server from a repository (this one, or the plugins one with root: "plugins"), run by the same Node; settings come from the profile as literals (not secrets).
      const e = {};
      if (m.needs === "TASKS") {
        e.WORKBENCH_TASKS_ALLOW = tasks.allow.join(",");
        if (tasks.tz) e.WORKBENCH_TASKS_TZ = tasks.tz;
        if (tasks.agent) e.WORKBENCH_TASKS_AGENT = tasks.agent;
        if (openclawBin) e.OPENCLAW_BIN = openclawBin;
      }
      steps.push({ kind: "config", id: `mcp.servers.${m.id}`, argv: ["config", "set", `mcp.servers.${m.id}`,
        JSON.stringify({ command: nodePath, args: [path.join(m.root === "plugins" ? pluginsRoot : projectRoot, ...m.entry.split("/"))], env: e }), "--strict-json"] });
      continue;
    }
    const dir = path.join(stateDir, "workbench", "mcp", m.id, m.version);
    const warn = [m.note, ...(m.requires || []).filter((t) => !which(t)).map((t) => `tool ${t} not in PATH`)].filter(Boolean);
    let server;
    if (m.kind === "npm") {
      const entry = path.join(dir, "node_modules", ...m.package.split("/"), ...m.bin.split("/"));
      if (!present(entry)) {
        // npm-cli.js with the same Node: the OpenClaw installer's private Node has no `node` in PATH
        // for npm's shebang, and npm.cmd on Windows would need a shell (verified in Docker).
        steps.push({ kind: "mcp-install", id: m.id, note: `npm ${m.package}@${m.version}`, exec: nodePath,
          argv: [npmCli, "install", "--prefix", dir, `${m.package}@${m.version}`, "--no-audit", "--no-fund", "--omit=dev"], warn });
      } else steps.push({ kind: "mcp-install", id: m.id, note: `${m.package}@${m.version} already installed`, warn });
      server = { command: nodePath, args: [entry] };
    } else if (m.kind === "github-release") {
      const os = m.asset[platform], a = m.arch[arch];
      if (!os || !a) { steps.push({ kind: "skip", id: `mcp ${m.id}`, reason: `no build for ${platform}/${arch}` }); continue; }
      const ext = platform === "win32" ? "zip" : "tar.gz";
      const asset = `${m.binary}_${os}_${a}.${ext}`;
      const base = `https://github.com/${m.repo}/releases/download/v${m.version}`;
      const bin = path.join(dir, m.binary + (platform === "win32" ? ".exe" : ""));
      if (!present(bin)) {
        steps.push({ kind: "mcp-download", id: m.id, note: `${m.repo} v${m.version} ${asset}`, warn, dir, bin,
          asset, url: `${base}/${asset}`, checksumsUrl: `${base}/${m.binary}_${m.version}_checksums.txt` });
      } else steps.push({ kind: "mcp-install", id: m.id, note: `${m.repo} v${m.version} already installed`, warn });
      const e = { ...(m.env || {}) };
      for (const k of m.optionalEnv || []) if (env[k]) e[k] = `\${${k}}`;
      server = { command: bin, args: [], env: e };
    } else throw new Error(`unknown MCP kind: ${m.kind}`);
    steps.push({ kind: "config", id: `mcp.servers.${m.id}`,
      argv: ["config", "set", `mcp.servers.${m.id}`, JSON.stringify(server), "--strict-json"] });
  }
  return steps;
}

/** A file's sha256 from a release checksums.txt (`<hex>  <name>`); null if there is no line. */
export function checksumFor(checksumsText, assetName) {
  for (const line of checksumsText.split(/\r?\n/)) {
    const m = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (m && m[2].trim() === assetName) return m[1].toLowerCase();
  }
  return null;
}

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
 * Shared memory: the main agent's workspace lives in the data repository, and its memory/ is
 * searched by memory_search of all agents (memory.search.extraPaths for shared notes, docs reference/memory-config.md).
 * The profile sets the whole extraPaths list. No evergreen: OpenClaw 2026.10.10 does not know it.
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

/**
 * Uninstall and re-runs. Installing changes four things: config keys (`config set`),
 * plugins (`plugins install`), its own folder `<state>/workbench` (marketplace clones, MCP)
 * and the agent entry in JetBrains acp.json.
 * So that uninstall restores exactly what was there before, the first install writes a manifest:
 * each key's previous value and whether each plugin was installed. A re-run does not overwrite
 * previous values, otherwise our own value would become "previous". To remove OpenClaw entirely, use `openclaw uninstall`.
 */
export const MANIFEST_VERSION = 1;

/** What an install plan changes: config keys and plugin ids (with their plugins.entries.<id> entry). */
export function touchedBy(plan) {
  const plugins = plan.filter((s) => ["base", "runtime", "own"].includes(s.kind)).map((s) => s.id);
  const config = plan.flatMap((s) => s.kind === "config" ? [s.id] : s.kind === "config-batch" ? s.keys : []);
  return { config: [...new Set([...config, ...plugins.map((id) => `plugins.entries.${id}`)])], plugins: [...new Set(plugins)] };
}

/**
 * New keys, plugins and IDE entries are recorded with their previous state; recorded ones stay as they were.
 * config: { key → {absent}|{value} }; ide: { "<file>#<agent name>" → {absent}|{value} };
 * links: { link → target }: our own symlinks; uninstall removes them if the target is unchanged.
 */
export function mergeManifest(prev, { config, plugins, ide = {}, links = {}, timers = {}, chromeHost, env = [], dropEnv = false, claudeEnv = {} }, { now }) {
  const m = prev ? structuredClone(prev) : { version: MANIFEST_VERSION, createdAt: now, config: {}, plugins: {} };
  m.ide ||= {};
  m.links ||= {};
  m.timers ||= {};
  // File patches of OpenClaw are gone: an older manifest's list means nothing to restore any more.
  delete m.patches;
  // Chrome extension native host: if it existed before us, it is not ours and uninstall leaves it.
  if (chromeHost && !m.chromeHost) m.chromeHost = chromeHost;
  // ~/.openclaw/.env lines appended by the install (lines set before it are not recorded).
  if (env.length) m.env = [...new Set([...(m.env || []), ...env])];
  if (dropEnv) delete m.env;
  // Claude Code settings keys written by the install: { file → { key → value hash } }; null drops a file's record.
  for (const [file, rec] of Object.entries(claudeEnv)) {
    m.claudeEnv ||= {};
    if (rec) m.claudeEnv[file] = rec;
    else delete m.claudeEnv[file];
    if (!Object.keys(m.claudeEnv).length) delete m.claudeEnv;
  }
  Object.assign(m.links, links);
  // Timer: our own unit files; an earlier timer with the same name is not ours and is not recorded.
  for (const [name, v] of Object.entries(timers)) if (!(name in m.timers)) m.timers[name] = v;
  for (const [k, v] of Object.entries(config)) if (!(k in m.config)) m.config[k] = v;
  for (const [id, v] of Object.entries(plugins)) if (!(id in m.plugins)) m.plugins[id] = v;
  for (const [f, v] of Object.entries(ide)) if (!(f in m.ide)) m.ide[f] = v;
  m.updatedAt = now;
  return m;
}

/** `openclaw config get <key> --json` output → the key's previous state; unparseable output is an error, not "absent". */
export function configBefore(code, out) {
  if (code === 0) {
    let value;
    try { value = JSON.parse(out.trim()); } catch { throw new Error(`config get: not JSON: ${out.slice(0, 120)}`); }
    // A sensitive key (proxy.proxyUrl, tokens) comes back masked: its previous value is unknown.
    return value === "__OPENCLAW_REDACTED__" ? { masked: true } : { value };
  }
  if (/valid but unset|Config path not found|Config file not found/i.test(out)) return { absent: true };
  throw new Error(`config get: ${out.trim().split("\n").slice(-1)[0].slice(0, 200)}`);
}

/**
 * Uninstall plan: plugins that were not there before us get `plugins uninstall` (OpenClaw leaves
 * linked folders alone); then keys get their previous value or `unset`, nested keys before their
 * parents; the workbench folder goes last. Repository clones, .env, sessions and memory are left alone.
 */
// Keys uninstall keeps on purpose: OpenClaw refuses to unset them, or unsetting takes user data
// with it (Docker 04.11.2026). A project agent owns its sessions and its workspace in the data repository:
// `agents delete` moves them to the trash; gateway.mode protects the OpenClaw config.
export const KEEP_ON_UNINSTALL = [
  [/^agents\.entries\.(?!main$)[^.]+$/, (k) => `agent with sessions and a workspace; to remove: openclaw agents delete ${k.split(".")[2]} (moves to trash)`],
  [/^gateway\.mode$/, () => "the local Gateway does not start without it; OpenClaw refuses to unset it"],
];

export function uninstallPlan(manifest, { workbenchDir, renames = [] }) {
  manifest = renameManifest(manifest, renames);
  const steps = [];
  for (const [id, was] of Object.entries(manifest.plugins)) {
    if (was.installed) steps.push({ kind: "keep", id, reason: "plugin was installed before ai-workbench" });
    else steps.push({ kind: "plugin-uninstall", id, argv: ["plugins", "uninstall", id, "--force"] });
  }
  // An install that the installer has not moved to the new plugin ids yet: whatever is left under an
  // old id goes too. Either may be gone already, so a failure is not an error (tolerant).
  for (const r of renames) {
    if (r.from === r.to || manifest.plugins[r.to]?.installed !== false) continue;
    steps.push({ kind: "plugin-uninstall", id: r.from, note: `old id of ${r.to}`, tolerant: true, argv: ["plugins", "uninstall", r.from, "--force"] },
      { kind: "config-unset", id: `plugins.entries.${r.from}`, note: `old id of ${r.to}`, tolerant: true, argv: ["config", "unset", `plugins.entries.${r.from}`] });
  }
  const keys = Object.keys(manifest.config).sort((a, b) => b.split(".").length - a.split(".").length || (a < b ? -1 : 1));
  for (const key of keys) {
    const was = manifest.config[key];
    const keep = was.absent && KEEP_ON_UNINSTALL.find(([re]) => re.test(key));
    if (keep) { steps.push({ kind: "keep-config", id: key, reason: keep[1](key) }); continue; }
    if (was.masked) { steps.push({ kind: "keep-config", id: key, reason: "it was set before ai-workbench to a secret value the installer could not read; check or unset it by hand" }); continue; }
    steps.push(was.absent
      ? { kind: "config-unset", id: key, argv: ["config", "unset", key] }
      : { kind: "config-restore", id: key, argv: ["config", "set", key, JSON.stringify(was.value), "--strict-json"] });
  }
  for (const [at, was] of Object.entries(manifest.ide || {})) {
    const i = at.lastIndexOf("#");
    const file = at.slice(0, i), name = at.slice(i + 1);
    steps.push(was.absent ? { kind: "ide-remove", id: `${name} in ${file}`, file, name, entry: null }
      : { kind: "ide-restore", id: `${name} in ${file}`, file, name, entry: was.value });
  }
  for (const [from, to] of Object.entries(manifest.links || {})) steps.push({ kind: "unlink", id: from, from, to });
  for (const [name, t] of Object.entries(manifest.timers || {})) {
    steps.push(t.absent ? { kind: "timer-remove", id: name, name, files: t.files } : { kind: "keep", id: `timer ${name}`, reason: "timer existed before ai-workbench" });
  }
  if (manifest.chromeHost?.absent) steps.push({ kind: "chrome-host-remove", id: "ai.openclaw.browser_bootstrap", argv: ["browser", "extension", "uninstall-host"] });
  else if (manifest.chromeHost?.existed) steps.push({ kind: "keep", id: "Chrome extension host", reason: "existed before ai-workbench" });
  if ((manifest.env || []).length) steps.push({ kind: "env-remove", id: manifest.env.join(", "), keys: manifest.env });
  // Claude Code proxy keys the installer wrote: removed only while they hold the value written (hash).
  for (const [file, hashes] of Object.entries(manifest.claudeEnv || {})) {
    steps.push({ kind: "claude-env", id: `${file} env`, file, remove: Object.keys(hashes), hashes, recorded: null,
      note: `remove ${Object.keys(hashes).join(", ")} if unchanged` });
  }
  steps.push({ kind: "remove-dir", id: workbenchDir, dir: workbenchDir });
  steps.push({ kind: "check", id: "config validate", argv: ["config", "validate"] });
  return steps;
}

/**
 * Own plugins renamed (workbench.config.mjs, PLUGIN_RENAMES: { from, to, fromDir } — old id, new id, old
 * folder under --plugins-root). An install made before the rename has plugins.entries.<from> (config,
 * hooks), a load path to the old folder and maybe <from> in plugins.allow/deny. Listing both the old and the
 * new folder of one id makes OpenClaw fail with "duplicate plugin id". So, before the own plugins are
 * installed: `plugins uninstall <from>` drops its install record and load path, then one `config patch`
 * carries the old entry's keys that the new entry does not have yet over to plugins.entries.<to> (config
 * and hooks key by key), deletes plugins.entries.<from>, puts the new folder in place of the old one in
 * plugins.load.paths and the new id in place of the old one in allow/deny. Nothing to move — no steps, so
 * a re-run changes nothing. A load path to an own plugin's folder under another root (same <repository>/<folder>,
 * e.g. an earlier --plugins-root) is replaced by the planned folder as well: two paths of one id are a duplicate too.
 * Only renames whose new plugin is installed by this plan (own: { id → dir }):
 * with the plugins clone not updated yet, the old plugins stay as they are.
 * current: { entries: { id → plugins.entries.<id> or undefined }, paths, allow, deny } — `config get` values.
 * `config get` masks values of secret-looking keys; such a value cannot be carried and is reported instead.
 */
export const REDACTED_SENTINEL = "__OPENCLAW_REDACTED__";

export function pluginRenameSteps({ renames, own, current }) {
  const active = renames.filter((r) => own[r.to]);
  const slash = (p) => String(p).replace(/\\/g, "/").replace(/\/+$/, "");
  const renameOf = (p) => active.find((r) => slash(p).endsWith(`/${r.fromDir}`));
  const masked = (v) => v === REDACTED_SENTINEL || (v && typeof v === "object" && Object.values(v).some(masked));
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const steps = [], patch = {}, notes = [], warn = [];
  const plugins = () => (patch.plugins ||= {});

  const paths = Array.isArray(current.paths) ? current.paths : [];
  // The same plugin folder (<repository>/<folder>) under another root, e.g. an earlier --plugins-root: two paths
  // of one id are just as much a "duplicate plugin id", so that path moves to the planned folder too.
  const tail = (p) => slash(p).split("/").slice(-2).join("/");
  const ownDirs = Object.values(own);
  const nextPaths = [];
  for (const p of paths) {
    const r = renameOf(p);
    const moved = !r && ownDirs.find((d) => slash(d) !== slash(p) && tail(d) === tail(p));
    if (moved) notes.push(`${tail(p)}: ${p} → ${moved}`);
    const q = r ? own[r.to] : moved || p;
    if (!nextPaths.some((x) => slash(x) === slash(q))) nextPaths.push(q);
  }
  if (JSON.stringify(nextPaths) !== JSON.stringify(paths)) plugins().load = { paths: nextPaths };

  for (const r of active) {
    const old = current.entries?.[r.from];
    const hadPath = paths.some((p) => renameOf(p) === r);
    if (r.from === r.to) { if (hadPath) notes.push(`${r.to}: ${r.fromDir} → ${r.toDir}`); continue; }
    if (old === undefined && !hadPath && ![current.allow, current.deny].some((l) => Array.isArray(l) && l.includes(r.from))) continue;
    notes.push(`${r.from} → ${r.to}`);
    if (old !== undefined || hadPath) steps.push({ kind: "plugin-uninstall", id: r.from, note: `renamed to ${r.to}`, tolerant: true, argv: ["plugins", "uninstall", r.from, "--force"] });
    if (old === undefined) continue;
    const now = isObj(current.entries?.[r.to]) ? current.entries[r.to] : {};
    const carry = {};
    for (const [k, v] of Object.entries(isObj(old) ? old : {})) {
      if ((k === "config" || k === "hooks") && isObj(v)) {
        const have = isObj(now[k]) ? now[k] : {};
        const add = {};
        for (const [kk, vv] of Object.entries(v)) {
          if (kk in have) continue;
          if (masked(vv)) { warn.push(`plugins.entries.${r.from}.${k}.${kk} is masked by OpenClaw and was not carried over: set plugins.entries.${r.to}.${k}.${kk} again`); continue; }
          add[kk] = vv;
        }
        if (Object.keys(add).length) carry[k] = add;
      } else if (!(k in now) && !masked(v)) carry[k] = v;
    }
    plugins().entries ||= {};
    if (Object.keys(carry).length) plugins().entries[r.to] = carry;
    plugins().entries[r.from] = null;
  }
  for (const key of ["allow", "deny"]) {
    const list = current[key];
    if (!Array.isArray(list)) continue;
    const next = [...new Set(list.map((id) => active.find((r) => r.from === id)?.to ?? id))];
    if (JSON.stringify(next) !== JSON.stringify(list)) plugins()[key] = next;
  }
  if (!patch.plugins) return steps;
  return [...steps, { kind: "plugin-rename", id: notes.join(", ") || "plugins.allow/deny", patch, warn,
    argv: ["config", "patch", "--file", "<patch file>"] }];
}

/** Manifest of an install made before the rename: old plugin ids and plugins.entries.<old>… keys under the new
 *  id, so uninstall restores and removes the plugins as they are named now. A key already recorded for the
 *  new id wins. */
export function renameManifest(manifest, renames = []) {
  if (!manifest) return manifest;
  const m = structuredClone(manifest);
  m.config ||= {};
  m.plugins ||= {};
  for (const r of renames) {
    if (r.from === r.to) continue;
    const pre = `plugins.entries.${r.from}`;
    for (const k of Object.keys(m.config)) {
      if (k !== pre && !k.startsWith(`${pre}.`)) continue;
      const nk = `plugins.entries.${r.to}${k.slice(pre.length)}`;
      if (!(nk in m.config)) m.config[nk] = m.config[k];
      delete m.config[k];
    }
    if (r.from in m.plugins) {
      if (!(r.to in m.plugins)) m.plugins[r.to] = m.plugins[r.from];
      delete m.plugins[r.from];
    }
  }
  return m;
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

/** OpenClaw fork: the bridge adopts old chats in the Gateway and reads the live turn status of the tree rows;
 *  the fork lets it call these Gateway methods in process (the list in aiwb-plugins claude-bridge/adopt.js,
 *  GATEWAY_METHODS). Without the fork
 *  claude-code-catalog.mjs adopts from the timer. The value replaces grants for other plugins, if any. */
export const BRIDGE_GATEWAY_METHODS = ["sessions.catalog.list", "sessions.catalog.import", "sessions.patch", "session.visibility.set",
  // The live turn status of the Projects tree rows (the spinner of long Claude CLI turns).
  "sessions.list"];
/** How long the fork's Gateway waits for running agent turns on restart and stop (OPENCLAW_RESTART_AGENT_RUN_WAIT_MS). */
export const RESTART_AGENT_RUN_WAIT_MS = 30 * 60_000;
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
  // Claude in Chrome for agents on Claude CLI (WORKBENCH_CLAUDE_CHROME=1): browser control, so only on request.
  ...(chrome ? [{ kind: "config", id: "env.vars.OPENCLAW_CLAUDE_CHROME", note: "Claude in Chrome for Claude CLI agents",
    argv: ["config", "set", "env.vars.OPENCLAW_CLAUDE_CHROME", JSON.stringify("1"), "--strict-json"] }] : [])];
}

/** OpenClaw fork settings (env.vars.*) go in one `config set --batch-json` write at the front of the plan:
 *  right after install-cli.sh restarted the Gateway (install.sh waits for it), before plugins and other settings.
 *  One write is one config reload. A fork that applies its env.vars without restart takes them hot; an older
 *  build restarts once for all of them instead of once per key, and does so while the restarted Gateway has
 *  no agent turns running yet (09.11.2026: separate writes later in the plan forced a restart over a running
 *  turn after 5 minutes). The values are strings, so they do not depend on the plugins installed after them. */
export function batchEnvVarSteps(plan) {
  const env = plan.filter((s) => s.kind === "config" && s.id.startsWith("env.vars."));
  if (!env.length) return plan;
  const keys = env.map((s) => s.id);
  const ops = env.map((s) => ({ path: s.id, value: JSON.parse(s.argv[3]) }));
  const batch = { kind: "config-batch", id: keys.map((k) => k.slice("env.vars.".length)).join(", "), keys,
    note: "env.vars", argv: ["config", "set", "--batch-json", JSON.stringify(ops)] };
  return [batch, ...plan.filter((s) => !env.includes(s))];
}

/** What the plan shows instead of a proxy URL: it may hold credentials. */
export const REDACTED_PROXY_URL = "<proxy URL>";
const HOST_SUFFIX = /^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)*$/;

const httpUrl = (text) => {
  try { const u = new URL(text); return u.protocol === "http:" || u.protocol === "https:" ? u : null; } catch { return null; }
};

function proxyHostList(raw) {
  const hosts = [];
  for (const h of raw.split(",").map((x) => x.trim()).filter(Boolean)) {
    const norm = h.toLowerCase().replace(/^\*?\./, "").replace(/\.$/, "");
    if (!HOST_SUFFIX.test(norm)) return { error: "a host is not a host name (use e.g. api.example.com)" };
    hosts.push(norm);
  }
  return hosts.length ? { hosts } : { error: "no hosts" };
}

/**
 * Network proxy of OpenClaw (`proxy.proxyUrl`) and, with the fork, which hosts use it
 * (`env.vars.OPENCLAW_PROXY_ROUTES`). From .env:
 * - WORKBENCH_PROXY_URL — http(s) proxy URL; WORKBENCH_PROXY_HOSTS — comma-separated host suffixes through
 *   the proxy, everything else direct; unset, `*` or `all` — everything through it, as with HTTPS_PROXY;
 * - WORKBENCH_PROXY_ROUTES — the full form, wins if set: `<hosts>=<proxy|direct|URL>;*=<proxy|direct|URL>`.
 *   The fork routes in-process traffic through one proxy, so every URL in it must be the same one; the
 *   installer stores it in proxy.proxyUrl and writes `proxy` in its place.
 * Without a proxy URL nothing is touched (an existing proxy config stays). The URL never appears in the plan:
 * the step shows REDACTED_PROXY_URL and is marked secret (its command output is not printed).
 */
export function proxySteps({ url, hosts, routes, fork }) {
  const id = "network proxy";
  const fail = (reason) => [{ kind: "skip", id, reason }];
  url = (url || "").trim();
  hosts = (hosts || "").trim();
  routes = (routes || "").trim();
  let proxyUrl = url || null;
  let value = null; // OPENCLAW_PROXY_ROUTES; "" = everything through the proxy
  if (routes) {
    const out = [];
    let star = false, usesProxy = false;
    for (const [i, rule] of routes.split(";").map((r) => r.trim()).filter(Boolean).entries()) {
      const eq = rule.indexOf("=");
      const target = eq > 0 ? rule.slice(eq + 1).trim() : "";
      const keys = eq > 0 ? rule.slice(0, eq).split(",").map((k) => k.trim()).filter(Boolean) : [];
      if (!keys.length || !target) return fail(`WORKBENCH_PROXY_ROUTES rule ${i + 1} is not <hosts>=<proxy|direct|URL>`);
      const names = [];
      for (const k of keys) {
        if (k === "*") { if (star) return fail("WORKBENCH_PROXY_ROUTES has more than one * rule"); star = true; names.push("*"); continue; }
        const h = proxyHostList(k);
        if (h.error) return fail(`WORKBENCH_PROXY_ROUTES rule ${i + 1}: ${h.error}`);
        names.push(h.hosts[0]);
      }
      let to = target.toLowerCase();
      if (to !== "proxy" && to !== "direct") {
        if (!httpUrl(target)) return fail(`WORKBENCH_PROXY_ROUTES rule ${i + 1}: the target is not proxy, direct or an http(s) URL`);
        if (proxyUrl && httpUrl(proxyUrl)?.href !== httpUrl(target).href) {
          return fail("WORKBENCH_PROXY_ROUTES names more than one proxy URL (or one other than WORKBENCH_PROXY_URL); OpenClaw routes its own traffic through one proxy");
        }
        proxyUrl = target;
        to = "proxy";
      }
      if (to === "proxy") usesProxy = true;
      out.push(`${names.join(",")}=${to}`);
    }
    if (!out.length) return fail("WORKBENCH_PROXY_ROUTES has no rules");
    if (!usesProxy) return fail("WORKBENCH_PROXY_ROUTES sends nothing through a proxy; the proxy config is left as it is");
    if (!proxyUrl) return fail("WORKBENCH_PROXY_ROUTES uses proxy but no proxy URL is set (WORKBENCH_PROXY_URL or a URL in a rule)");
    value = out.join(";");
  } else if (proxyUrl) {
    if (!hosts || /^(\*|all)$/i.test(hosts)) value = "";
    else {
      const h = proxyHostList(hosts);
      if (h.error) return fail(`WORKBENCH_PROXY_HOSTS: ${h.error}`);
      value = `${[...new Set(h.hosts)].join(",")}=proxy;*=direct`;
    }
  } else {
    return [];
  }
  if (!httpUrl(proxyUrl)) return fail("WORKBENCH_PROXY_URL is not an http(s) URL");
  const steps = [{ kind: "config", id: "proxy.proxyUrl", note: REDACTED_PROXY_URL, secret: true,
    argv: ["config", "set", "proxy.proxyUrl", JSON.stringify(proxyUrl), "--strict-json"] }];
  if (fork) {
    steps.push({ kind: "config", id: "env.vars.OPENCLAW_PROXY_ROUTES", note: value || "everything through the proxy",
      argv: ["config", "set", "env.vars.OPENCLAW_PROXY_ROUTES", JSON.stringify(value), "--strict-json"] });
  } else if (value) {
    steps[0].warn = ["per-host routes need the OpenClaw fork (WORKBENCH_OPENCLAW_PACKAGE): all OpenClaw traffic goes through the proxy"];
  }
  return steps;
}

/** Claude Code proxy keys the installer writes into the `env` block of ~/.claude/settings.json. */
export const CLAUDE_CODE_PROXY_KEYS = ["HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"];
export const CLAUDE_CODE_NO_PROXY = "localhost,127.0.0.1,::1";
/** The manifest keeps a hash of each written value, not the value: a proxy URL may hold credentials. */
export const valueHash = (v) => createHash("sha256").update(String(v)).digest("hex").slice(0, 32);

/**
 * Claude Code's own proxy (WORKBENCH_CLAUDE_CODE_PROXY): `<url>` puts HTTPS_PROXY/HTTP_PROXY = url and
 * NO_PROXY = loopback into the `env` block of ~/.claude/settings.json, other keys untouched; `direct` removes
 * the keys the installer wrote (recorded: { key → hash }) if they still hold that value; unset — nothing.
 * text: the current file (null if missing).
 */
export function claudeCodeProxySteps({ value, file, text, recorded = null }) {
  const id = `${file} env`;
  value = (value || "").trim();
  if (!value) return [];
  let json;
  try { json = text && text.trim() ? JSON.parse(text) : {}; } catch { return [{ kind: "skip", id, reason: "the file is not valid JSON; not touching it" }]; }
  const env = json && typeof json.env === "object" && json.env ? json.env : {};
  if (/^direct$/i.test(value)) {
    const ours = Object.entries(recorded || {}).filter(([k, h]) => typeof env[k] === "string" && valueHash(env[k]) === h).map(([k]) => k);
    if (!ours.length) return [];
    return [{ kind: "claude-env", id, file, remove: ours, hashes: recorded, recorded: null, note: `remove ${ours.join(", ")} (written by ai-workbench)` }];
  }
  if (!httpUrl(value)) return [{ kind: "skip", id, reason: "WORKBENCH_CLAUDE_CODE_PROXY is not an http(s) URL or direct" }];
  const set = { HTTPS_PROXY: value, HTTP_PROXY: value, NO_PROXY: CLAUDE_CODE_NO_PROXY };
  const record = Object.fromEntries(Object.entries(set).map(([k, v]) => [k, valueHash(v)]));
  if (Object.entries(set).every(([k, v]) => env[k] === v) && JSON.stringify(recorded) === JSON.stringify(record)) return [];
  const replaced = Object.keys(set).filter((k) => k in env && env[k] !== set[k] && !(recorded && recorded[k] === valueHash(env[k])));
  return [{ kind: "claude-env", id, file, set, recorded: record,
    note: `HTTPS_PROXY, HTTP_PROXY = ${REDACTED_PROXY_URL}; NO_PROXY = ${CLAUDE_CODE_NO_PROXY}`,
    ...(replaced.length ? { warn: [`replaces your own ${replaced.join(", ")}; uninstall removes them, it does not restore the old values`] } : {}) }];
}

/** Applies a claude-env step to the settings text; returns the new text (2-space JSON, other keys kept). */
export function applyClaudeEnv(text, step) {
  const json = text && text.trim() ? JSON.parse(text) : {};
  const env = json.env && typeof json.env === "object" ? json.env : {};
  for (const k of step.remove || []) {
    if (!step.hashes || (typeof env[k] === "string" && valueHash(env[k]) === step.hashes[k])) delete env[k];
  }
  Object.assign(env, step.set || {});
  if (Object.keys(env).length) json.env = env;
  else delete json.env;
  return JSON.stringify(json, null, 2) + "\n";
}

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

/** `vulkaninfo --summary` → [{ index, type, name }] in Vulkan order, which is how llama.cpp numbers them too. */
export function parseVulkanDevices(text) {
  const out = [];
  for (const block of String(text).split(/^GPU(?=\d+:)/m).slice(1)) {
    const index = Number(block.match(/^(\d+):/)?.[1]);
    const type = block.match(/deviceType\s*=\s*(\S+)/)?.[1] || "";
    const name = block.match(/deviceName\s*=\s*(.+)/)?.[1]?.trim() || "";
    if (Number.isInteger(index)) out.push({ index, type, name });
  }
  return out;
}

/** GPU for embeddings: the explicit index; otherwise a discrete NVIDIA; otherwise any discrete GPU. */
export function pickVulkanDevice(devices, wanted) {
  if (wanted !== undefined && wanted !== "") return devices.find((d) => d.index === Number(wanted)) || null;
  const discrete = devices.filter((d) => /DISCRETE/.test(d.type));
  return discrete.find((d) => /NVIDIA/i.test(d.name)) || discrete[0] || null;
}

/**
 * Memory embedding server (llama-cpp plugin) on the GPU via Vulkan: a pinned llama.cpp build
 * in <workbench>/llama.cpp/ with localService switched to it; it sees only the chosen GPU
 * (GGML_VK_VISIBLE_DEVICES). mode is WORKBENCH_LOCAL_EMBEDDINGS: "vulkan" or "vulkan:<index>".
 * The one-time server setup (openclaw models auth login --provider llama-cpp --method local)
 * is interactive; without it (no localService.command) the step is skipped with a hint.
 */
export function gpuEmbeddingsSteps({ mode, managedCommand, workbenchDir, build, devices, platform }) {
  const m = /^vulkan(?::(\d+))?$/.exec(mode || "");
  if (!m) return [];
  const id = "GPU embedding server";
  if (platform !== "linux") return [{ kind: "skip", id, reason: "the Vulkan build is pinned for Linux x64 only" }];
  if (!managedCommand) return [{ kind: "skip", id, reason: "one-time setup first: openclaw models auth login --provider llama-cpp --method local (with the Gateway stopped), then re-run the installer" }];
  const device = pickVulkanDevice(devices, m[1]);
  if (!device) return [{ kind: "skip", id, reason: devices.length ? `no ${m[1] !== undefined ? `GPU ${m[1]}` : "discrete GPU"} in vulkaninfo` : "vulkaninfo found no GPUs" }];
  const dir = path.join(workbenchDir, "llama.cpp", `${build.tag}-vulkan`);
  const bin = path.join(dir, ...build.binary.split("/"));
  return [
    { kind: "llama-download", id: build.asset, note: `llama.cpp ${build.tag}, Vulkan`, dir, bin, asset: build.asset, sha256: build.sha256,
      url: `https://github.com/ggml-org/llama.cpp/releases/download/${build.tag}/${build.asset}` },
    { kind: "config", id: "models.providers.llama-cpp.localService.command", note: bin,
      argv: ["config", "set", "models.providers.llama-cpp.localService.command", JSON.stringify(bin), "--strict-json"] },
    { kind: "config", id: "models.providers.llama-cpp.localService.env", note: `GPU ${device.index}: ${device.name}`,
      argv: ["config", "set", "models.providers.llama-cpp.localService.env", JSON.stringify({ GGML_VK_VISIBLE_DEVICES: String(device.index) }), "--strict-json"] },
  ];
}

// OpenClaw fork: values hard-coded upstream become environment variables the fork reads when used;
// they are set via the env.vars setting (`openclaw config set`, Gateway method config.patch); without them it behaves like OpenClaw.
// Presets (WORKBENCH_FORK_PRESETS): worker-limits — worker queues and heap (one heap shared by all: a
// ceiling, not memory in use); catalog-owner — user messages imported from the catalog get the owner mark.
export const FORK_SETTINGS = {
  "worker-limits": {
    OPENCLAW_WORKER_PENDING_TASKS: "4096",
    OPENCLAW_WORKER_PENDING_BYTES: String(4 * 1024 ** 3),
    OPENCLAW_WORKER_HEAP_MB: "8192",
  },
  "catalog-owner": { OPENCLAW_CATALOG_IMPORT_OWNER: "1" },
};

/** Fork presets: WORKBENCH_FORK_PRESETS is a comma-separated list of FORK_SETTINGS names, set as env.vars.
 *  They need the OpenClaw fork (fork); legacy: the old name of the key, WORKBENCH_OPENCLAW_PATCHES, was used. */
export function forkPresetSteps(value, { fork = false, legacy = false } = {}) {
  const names = String(value || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!names.length) return [];
  const renamed = legacy ? [{ kind: "skip", id: "WORKBENCH_OPENCLAW_PATCHES", reason: "renamed to WORKBENCH_FORK_PRESETS; rename it in .env" }] : [];
  if (!fork) return [...renamed, { kind: "skip", id: `fork presets ${names.join(", ")}`, reason: "need the OpenClaw fork (WORKBENCH_OPENCLAW_PACKAGE)" }];
  return [...renamed, ...names.flatMap((n) => FORK_SETTINGS[n]
    ? Object.entries(FORK_SETTINGS[n]).map(([k, v]) => ({ kind: "config", id: `env.vars.${k}`, note: `${n}: ${v}`,
      argv: ["config", "set", `env.vars.${k}`, JSON.stringify(v), "--strict-json"] }))
    : [{ kind: "skip", id: `fork preset ${n}`, reason: `no such preset (available: ${Object.keys(FORK_SETTINGS).join(", ")})` }])];
}

export const chromeHostFile = (dataDir) => path.join(dataDir, "NativeMessagingHosts", "ai.openclaw.browser_bootstrap.json");

/** Browser data folders for which OpenClaw registers the extension's native host. */
export function chromeDataDirs(platform, home) {
  if (platform === "darwin") return ["Google/Chrome", "Google/Chrome for Testing", "Chromium"].map((d) => path.join(home, "Library", "Application Support", d));
  return ["google-chrome", "google-chrome-for-testing", "chromium"].map((d) => path.join(home, ".config", d));
}

/**
 * The OpenClaw Chrome extension finds the local OpenClaw through a native host
 * (ai.openclaw.browser_bootstrap); without it, the extension reports that no local install was found.
 * `openclaw browser extension install` registers the host for browsers that have already run. The
 * extension itself comes from the Chrome Web Store; OpenClaw does not install it for the user.
 * WORKBENCH_CHROME_EXTENSION=0 skips this step.
 */
/**
 * Daily versioned backup of OpenClaw databases (WORKBENCH_BACKUP=<folder>, OpenClaw docs install/backups.md):
 * a local Git repository of `openclaw backup git` and the Gateway-owned 24h schedule, without a remote.
 * The schedule needs a running Gateway; without one the step only prints the command to run later.
 */
export function backupSteps({ dir, exists }) {
  if (!dir) return [];
  return [
    ...(exists(path.join(dir, ".git")) ? [] : [{ kind: "backup", id: `git repository ${dir}`, argv: ["backup", "git", "init", "--repository", dir] }]),
    { kind: "backup-schedule", id: "daily, local", note: dir, argv: ["backup", "enable", "--repository", dir, "--every", "24h"] },
  ];
}

export function chromeHostSteps({ value, platform, home, exists }) {
  if (String(value ?? "").trim() === "0") return [];
  const id = "ai.openclaw.browser_bootstrap";
  if (platform === "win32") return [{ kind: "skip", id: `Chrome extension host`, reason: "Windows uses a separate OpenClaw executable that the installer does not set up" }];
  if (!chromeDataDirs(platform, home).some(exists)) return [{ kind: "skip", id: "Chrome extension host", reason: "Chrome or Chromium has not been run yet; start it and re-run the install" }];
  // Exit code 1 and "Setup needs attention" while the extension is not in Chrome, yet the host is installed:
  // the step succeeds when the host file exists (chromeHostFile), not by the command's exit code.
  return [{ kind: "chrome-host", id, argv: ["browser", "extension", "install", "--wait-ms", "1000"] }];
}
