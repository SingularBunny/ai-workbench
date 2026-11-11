#!/usr/bin/env node
// Cross-platform part of the installer. Run by the install.sh / install.ps1 wrapper
// after the official OpenClaw installer, once Node and `openclaw` are available.
//
//   node installer/setup.mjs [--profile <dir>] [--plugins-root <dir>] [--dry-run] [--yes]
//   node installer/setup.mjs --uninstall [--dry-run] [--yes] [--without-manifest]
//
// Without a profile, the public build is installed; a personal profile adds own plugins,
// skills, MCP servers and tasks. Profile dir: --profile or WORKBENCH_PROFILE (also read from ~/.openclaw/.env).
//
// Shows the install plan and changes nothing without consent (or --yes). Never prints secrets.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createHash } from "node:crypto";
import { acpLaunch, applyAcp, defaultPluginsRoot, applyClaudeEnv, batchEnvVarSteps, claudeCodeProxySteps, proxySteps, bridgeAdoptionSteps, buildPlan, pluginUiSteps, keepPinnedBases, chatsCwdSteps, chromeDataDirs, backupSteps, chromeHostFile, chromeHostSteps, gatewayStopTimeoutSteps, gpuEmbeddingsSteps, forkPresetSteps, parseVulkanDevices, chatsProjectsStep, bridgeRootSteps, profileEnv, setEnvLines, projectsHooksStep, chatsTimerSteps, skillCollisions, skillLinkSteps, checkPluginDeps, checksumFor, configBefore, ensureGatewayToken, formatPlan, hookSteps, ideSteps, isGitUrl, profileSource, profileTarget, mainSteps, sharedMemorySteps, makeWhich, mcpSteps, mergeManifest, mergeProfile, parseDependencies, pluginRenameSteps, projectSteps, knowledgeSteps, removeEnvLines, renameManifest, repoSteps, staleVersions, touchedBy, uninstallPlan, winQuote } from "./lib.mjs";
import { knowledgeFolders, knowledgeTextTimerSteps, projectKnowledgeDirs, withTextCopies } from "./knowledge.mjs";
import { chatFileFolderSteps } from "./chat-files.mjs";
import * as PUBLIC from "../openclaw/workbench.config.mjs";
const { OPENCLAW_VERSION, PLUGIN_RENAMES } = PUBLIC;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const home = os.homedir();
const stateDir = process.env.OPENCLAW_STATE_DIR || path.join(home, ".openclaw");
// Where own plugins are cloned: --plugins-root, then WORKBENCH_PLUGINS_ROOT (environment or .env),
// default defaultPluginsRoot() under the user's data folder.
const pluginsRoot = path.resolve((opt("--plugins-root", process.env.WORKBENCH_PLUGINS_ROOT
  || loadEnvFile(path.join(stateDir, ".env")).WORKBENCH_PLUGINS_ROOT || "") || defaultPluginsRoot(home, process.env))
  .replace(/^~(?=$|[\\/])/, home));
const isWin = process.platform === "win32";
// Everything we put on disk lives in one folder of the OpenClaw state dir; uninstall removes it entirely.
const workbenchDir = path.join(stateDir, "workbench");
const manifestFile = path.join(workbenchDir, "install-manifest.json");
const envFile = path.join(stateDir, ".env");
// JetBrains AI Assistant agents: the IDE creates this file, we add our own entry to it.
const acpFile = path.join(home, ".jetbrains", "acp.json");
const readText = (f) => (existsSync(f) ? readFileSync(f, "utf8") : "");

/** Plugin skills: SKILL.md under skills/ (up to 4 levels) → { name, dir, sha }; name comes from frontmatter. */
function pluginSkills(root) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 4 || !existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isFile() && e.name === "SKILL.md") {
        const text = readFileSync(p, "utf8");
        const name = text.match(/^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m)?.[1];
        if (name) out.push({ name, dir: realpathSync(dir), sha: createHash("sha1").update(text).digest("hex") });
      } else if (e.isDirectory() || e.isSymbolicLink()) walk(p, depth + 1);
    }
  };
  walk(path.join(root, "skills"), 0);
  return out;
}

function openclaw(argv, { capture = false } = {}) {
  // On Windows npm installs openclaw.cmd, which only a shell can run.
  const r = isWin
    ? spawnSync(["openclaw", ...argv].map(winQuote).join(" "), { encoding: "utf8", shell: true, stdio: capture ? "pipe" : "inherit" })
    : spawnSync("openclaw", argv, { encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  return { code: r.status ?? 1, out: (r.stdout || "") + (r.stderr || "") };
}

function run(cmd, argv, { capture = false } = {}) {
  // On Windows npm.cmd runs only through a shell, with the same quoting.
  const r = isWin && /\.cmd$/i.test(cmd)
    ? spawnSync([cmd, ...argv].map(winQuote).join(" "), { encoding: "utf8", shell: true, stdio: capture ? "pipe" : "inherit" })
    : spawnSync(cmd, argv, { encoding: "utf8", stdio: capture ? "pipe" : "inherit", shell: false });
  return { code: r.status ?? 1, out: (r.stdout || "") + (r.stderr || "") + (r.error ? String(r.error.message) : "") };
}

// Repository access check without cloning. git must not prompt: a password, a key or an
// unknown host key is a reason to skip, not a hung installer.
function canReach(repo) {
  const r = spawnSync("git", ["ls-remote", "--heads", repo], { encoding: "utf8", stdio: "pipe", timeout: 30000 });
  if (r.status === 0) return { ok: true };
  const err = (r.stderr || String(r.error?.message || "")).split("\n").map((l) => l.trim()).filter(Boolean);
  const reason = err.find((l) => /Host key verification failed/i.test(l))
    ? "github.com is not in ~/.ssh/known_hosts — run `ssh -T git@github.com` and accept the host key"
    : err.find((l) => /Permission denied|could not read Username|Authentication failed/i.test(l))
      || err.find((l) => /^fatal:/.test(l)) || err.at(-1) || (r.error ? "timeout" : `exit code ${r.status}`);
  return { ok: false, reason };
}

function gitState(dir) {
  if (!existsSync(dir)) return { exists: false };
  const g = (...a) => run("git", ["-C", dir, ...a], { capture: true });
  if (g("rev-parse", "--is-inside-work-tree").code !== 0) return { exists: true, isGit: false };
  const origin = g("remote", "get-url", "origin");
  const ahead = g("rev-list", "--count", "@{u}..HEAD");
  return { exists: true, isGit: true, origin: origin.code === 0 ? origin.out.trim() : "",
    dirty: g("status", "--porcelain").out.split("\n").filter(Boolean).length,
    ahead: ahead.code === 0 ? Number(ahead.out.trim()) || 0 : 0 };
}

/** Current value of a config key; undefined if the key is missing or on error. */
function configValue(key) {
  const r = openclaw(["config", "get", key, "--json"], { capture: true });
  try { return r.code === 0 ? JSON.parse(r.out.trim()) : undefined; } catch { return undefined; }
}

// A manifest written before the plugin rename names the plugins by their old ids: read under the new ones.
const readManifest = () => (existsSync(manifestFile) ? renameManifest(JSON.parse(readFileSync(manifestFile, "utf8")), PLUGIN_RENAMES) : null);

/** Records the prior state of everything the plan changes, before the first change: if the install is interrupted, it can still be uninstalled. */
function recordManifest(plan) {
  const prev = readManifest();
  const t = touchedBy(plan);
  const config = {};
  for (const key of t.config.filter((k) => !prev || !(k in prev.config))) {
    const r = openclaw(["config", "get", key, "--json"], { capture: true });
    config[key] = configBefore(r.code, r.out);
  }
  const plugins = {};
  const fresh = t.plugins.filter((id) => !prev || !(id in prev.plugins));
  if (fresh.length) {
    const r = openclaw(["plugins", "list", "--json"], { capture: true });
    let list;
    try { list = JSON.parse(r.out.slice(r.out.indexOf("{"))).plugins; } catch { throw new Error("plugins list --json: not JSON — cannot determine previously installed plugins"); }
    const installed = new Set(list.filter((x) => x.origin !== "bundled").map((x) => x.id));
    for (const id of fresh) plugins[id] = { installed: installed.has(id) };
  }
  const links = Object.fromEntries(plan.filter((s) => s.kind === "skill-link" && s.link).map((s) => [s.link.from, s.link.to]));
  const ide = {};
  for (const step of plan.filter((s) => s.kind === "ide" && s.entry)) {
    const text = readText(step.file);
    const was = text.trim() ? JSON.parse(text).agent_servers?.[step.name] : undefined;
    ide[`${step.file}#${step.name}`] = was === undefined ? { absent: true } : { value: was };
  }
  // Timer: if the unit files already existed, it is not ours and uninstall leaves it alone.
  const dropEnv = plan.some((s) => s.kind === "env-remove");
  const timers = Object.fromEntries(plan.filter((s) => s.kind === "timer").map((s) => [s.id,
    Object.keys(s.files).some(existsSync) ? { existed: true } : { absent: true, files: Object.keys(s.files) }]));
  const claudeEnv = Object.fromEntries(plan.filter((s) => s.kind === "claude-env").map((s) => [s.file, s.recorded]));
  const chromeHost = plan.some((s) => s.kind === "chrome-host")
    ? (chromeDataDirs(process.platform, home).some((d) => existsSync(chromeHostFile(d))) ? { existed: true } : { absent: true }) : undefined;
  mkdirSync(workbenchDir, { recursive: true });
  writeFileSync(manifestFile, JSON.stringify(mergeManifest(prev, { config, plugins, ide, links, timers, chromeHost, dropEnv, claudeEnv }, { now: new Date().toISOString() }), null, 2) + "\n");
}

/** Claude Code settings: merges or removes the proxy keys of a claude-env step, keeping the file's mode and other keys. */
function writeClaudeEnv(step) {
  const before = existsSync(step.file) ? readFileSync(step.file, "utf8") : null;
  const text = applyClaudeEnv(before, step);
  if (text === before) return;
  mkdirSync(path.dirname(step.file), { recursive: true });
  writeFileSync(step.file, text, before === null ? { mode: 0o600 } : undefined);
}

/** After an MCP update, old versions are garbage: the config already points to the new one. */
function pruneMcp(plan) {
  for (const step of plan.filter((s) => (s.kind === "mcp-install" || s.kind === "mcp-download") && s.dir)) {
    const parent = path.dirname(step.dir);
    if (!existsSync(parent)) continue;
    for (const v of staleVersions(readdirSync(parent), path.basename(step.dir))) {
      rmSync(path.join(parent, v), { recursive: true, force: true });
      console.log(`  removed old MCP version ${step.id} ${v}`);
    }
  }
}

/** Uninstall by manifest: restores config and plugins to their state before ai-workbench. */
async function uninstall() {
  let manifest = readManifest();
  if (!manifest) {
    if (!flag("--without-manifest")) {
      console.error(`No uninstall manifest ${manifestFile}: the install was made by an older installer or is already removed.\n` +
        "Without it, the previous values are unknown. --without-manifest removes the keys and plugins that the\n" +
        "current public build installs, as if they had not existed before it.");
      return 1;
    }
    const t = touchedBy(buildPlan({ settings: PUBLIC.settings({ home, sep: path.sep, env: {} }), plugins: PUBLIC.PLUGINS, pluginsRoot,
      projectRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), profileRoot: null, env: {},
      ownState: () => ({ present: true, missing: [], optional: [] }), marketplaceDir: (n) => ({ present: true, dir: path.join(workbenchDir, "marketplaces", n) }) }));
    manifest = { config: Object.fromEntries(t.config.map((k) => [k, { absent: true }])), plugins: Object.fromEntries(t.plugins.map((id) => [id, { installed: false }])) };
  }
  const plan = uninstallPlan(manifest, { workbenchDir, renames: PLUGIN_RENAMES });
  // Our Gateway stop-timeout drop-in (installed with the fork) goes with the install.
  const which = makeWhich({ envPath: process.env.PATH, pathExt: process.env.PATHEXT, platform: process.platform,
    exists: existsSync, delimiter: path.delimiter });
  plan.push(...gatewayStopTimeoutSteps({ fork: false, platform: process.platform, systemctl: which("systemctl"),
    unitDir: path.join(home, ".config", "systemd", "user"), exists: existsSync }));
  console.log(`ai-workbench: uninstall${manifest.createdAt ? ` of the install from ${manifest.createdAt}` : " without manifest"}\nPlan:\n` + formatPlan(plan));
  console.log("\nLeft untouched: OpenClaw, ~/.openclaw/.env, sessions, memory, agent workspaces, repository clones,\n" +
    "scheduled tasks (`openclaw automations list`; remove yours with `openclaw automations rm <id>`).");
  // With the Gateway running, writes go through it, and unsetting gateway.* restarts it; after that
  // OpenClaw rejects writes ("No local mutation was attempted") and the uninstall is left half done
  // (Docker run, 04.11.2026). `openclaw uninstall --state` does the same: it asks to stop the Gateway.
  const running = openclaw(["health"], { capture: true }).code === 0;
  const stopHint = "The Gateway is running — stop it: `openclaw gateway stop` (service) or Ctrl+C in the `openclaw gateway run` window,\nthen run the uninstall again.";
  if (flag("--dry-run")) { if (running) console.log(`\n⚠ ${stopHint}`); return 0; }
  if (running) { console.error(`\n✗ ${stopHint}\nNothing was changed.`); return 2; }
  if (!flag("--yes")) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question("\nUninstall? [y/N] ")).trim().toLowerCase();
    rl.close();
    if (!["y", "yes", "д", "да"].includes(answer)) { console.log("Cancelled, nothing was changed."); return 0; }
  }
  let failed = 0;
  for (const step of plan) {
    if (step.kind === "keep" || step.kind === "keep-config") continue;
    process.stdout.write(`\n→ ${step.kind} ${step.id}\n`);
    if (step.kind === "remove-dir") { rmSync(step.dir, { recursive: true, force: true }); continue; }
    if (step.kind === "unlink") {
      try { if (path.resolve(path.dirname(step.from), readlinkSync(step.from)) === step.to) unlinkSync(step.from); } catch { /* link already gone */ }
      continue;
    }
    if (step.kind === "env-remove") {
      if (existsSync(envFile)) writeFileSync(envFile, removeEnvLines(readFileSync(envFile, "utf8"), step.keys));
      continue;
    }
    if (step.kind === "timer-remove") {
      spawnSync("systemctl", ["--user", "disable", "--now", `${step.name}.timer`], { encoding: "utf8" });
      for (const f of step.files || []) rmSync(f, { force: true });
      spawnSync("systemctl", ["--user", "daemon-reload"], { encoding: "utf8" });
      continue;
    }
    if (step.kind === "ide-remove" || step.kind === "ide-restore") {
      if (step.kind === "ide-remove" && !existsSync(step.file)) continue;
      try { writeFileSync(step.file, applyAcp(readText(step.file), step.name, step.entry)); }
      catch (e) { failed++; console.error(`✗ ${step.id}: ${e.message}`); }
      continue;
    }
    if (step.kind === "dropin-remove") { for (const f of step.files) rmSync(f, { force: true }); continue; }
    if (step.kind === "claude-env") {
      try { if (existsSync(step.file)) writeClaudeEnv(step); } catch (e) { failed++; console.error(`✗ claude-env ${step.file}: ${e instanceof SyntaxError ? "not valid JSON; left as is" : e.code || "write failed"}`); }
      continue;
    }
    const r = step.exec ? run(step.exec, step.argv, { capture: true }) : openclaw(step.argv, { capture: true });
    // Key already gone (removed by plugins uninstall or by hand): goal reached.
    if (r.code !== 0 && !step.tolerant && !(step.kind === "config-unset" && /not found|valid but unset/i.test(r.out))) {
      failed++;
      console.error(`✗ ${step.kind} ${step.id} (exit code ${r.code})\n${r.out.trim().split("\n").slice(-3).join("\n")}`);
    }
  }
  console.log(`\nDone: errors ${failed}.\nTo remove OpenClaw entirely: \`openclaw backup create\`, then \`openclaw uninstall --all\` (docs: install/uninstall).`);
  return failed ? 1 : 0;
}

async function download(step) {
  // GitHub release: the archive and checksums.txt from the same release; a sha256 mismatch aborts.
  mkdirSync(step.dir, { recursive: true });
  const get = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return Buffer.from(await r.arrayBuffer()); };
  // sha256 is pinned in the build (step.sha256) or taken from the release's checksums.txt.
  const [archive, sums] = await Promise.all([get(step.url), step.sha256 ? null : get(step.checksumsUrl)]);
  const want = step.sha256 || checksumFor(sums.toString("utf8"), step.asset);
  const got = createHash("sha256").update(archive).digest("hex");
  if (!want) throw new Error(`checksums.txt has no line for ${step.asset}`);
  if (want !== got) throw new Error(`sha256 mismatch: got ${got}, expected ${want}`);
  const file = path.join(step.dir, step.asset);
  writeFileSync(file, archive);
  const r = run("tar", ["-xf", file, "-C", step.dir]);
  if (r.code !== 0 || !existsSync(step.bin)) throw new Error(`extracting ${step.asset} did not produce ${step.bin}`);
  if (!isWin) chmodSync(step.bin, 0o755);
  console.log(`  sha256 ${got} — matches the release`);
}

function loadEnvFile(file) {
  const env = {};
  if (!existsSync(file)) return env;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

async function main() {
  // Put the Node running the installer first in child processes' PATH: npm and package install
  // scripts call `node` via the shebang (OpenClaw's private Node is not on PATH).
  process.env.PATH = path.dirname(process.execPath) + path.delimiter + (process.env.PATH || "");
  if (flag("--uninstall")) return uninstall();
  process.env.GIT_TERMINAL_PROMPT = "0";
  if (!process.env.GIT_SSH_COMMAND && run("git", ["config", "core.sshCommand"], { capture: true }).out.trim() === "") {
    process.env.GIT_SSH_COMMAND = "ssh -o BatchMode=yes";
  }
  const version = openclaw(["--version"], { capture: true });
  if (version.code !== 0) {
    console.error("openclaw not found in PATH. Run installer/install.sh (or install.ps1) first.");
    return 1;
  }
  if (!version.out.includes(OPENCLAW_VERSION)) {
    console.error(`⚠ Installed: ${version.out.trim()}; the project is tested with ${OPENCLAW_VERSION}.`);
  }

  // .env: the Gateway token is created if missing; the user fills in the other keys.
  // The state dir is created only on install: --dry-run writes nothing.
  const before = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  const { text: envText, added } = ensureGatewayToken(before);
  const env = { ...loadEnvFile(envFile), ...process.env };

  const profileArg = opt("--profile", env.WORKBENCH_PROFILE);
  const untilde = (p) => path.resolve(p.replace(/^~(?=$|[\\/])/, home));
  let profileRoot = null, profileTemp = null, profileWarn = [];
  if (profileArg && isGitUrl(profileArg)) {
    // Profile from git: cloning is a separate step with its own prompt, before the plan (the plan is built from the profile).
    let target, src;
    try {
      target = untilde(profileTarget(profileArg, { profileDir: opt("--profile-dir") || null, pluginsRoot }));
      src = profileSource(profileArg, target, gitState(target));
    } catch (e) { console.error(String(e.message)); return 1; }
    if (src.action === "refuse") { console.error(`Profile: ${src.reason}`); return 1; }
    if (src.action === "use") { profileRoot = target; profileWarn = src.warn; }
    else {
      const reach = canReach(profileArg);
      if (!reach.ok) { console.error(`Profile: no access to ${profileArg}: ${reach.reason}`); return 1; }
      let dir = target;
      if (flag("--dry-run")) dir = profileTemp = mkdtempSync(path.join(os.tmpdir(), "aiwb-profile-"));
      else if (!flag("--yes")) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = (await rl.question(`Clone profile ${profileArg} into ${target}? [y/N] `)).trim().toLowerCase();
        rl.close();
        if (!["y", "yes", "д", "да"].includes(answer)) { console.log("Cancelled, nothing was changed."); return 0; }
      }
      if (!profileTemp) mkdirSync(path.dirname(target), { recursive: true });
      const r = run("git", ["clone", ...(profileTemp ? ["--depth", "1"] : []), profileArg, profileTemp ? path.join(dir, "p") : dir], { capture: true });
      if (r.code !== 0) { console.error(`Profile: git clone ${profileArg} — exit code ${r.code}\n${r.out.trim().split("\n").slice(-3).join("\n")}`); return 1; }
      profileRoot = profileTemp ? path.join(dir, "p") : dir;
      console.log(profileTemp ? `Profile cloned into a temporary folder for the plan; on install it goes to ${target}.`
        : `Profile cloned: ${target}`);
    }
  } else if (profileArg) profileRoot = untilde(profileArg);
  let profile = {};
  if (profileRoot) {
    const file = path.join(profileRoot, "profile.mjs");
    if (!existsSync(file)) { console.error(`Profile not found: ${file}`); return 1; }
    profile = await import(pathToFileURL(file).href);
  }
  let cfg;
  try { cfg = mergeProfile(PUBLIC, profile); } catch (e) { console.error(String(e.message)); return 1; }
  const { CHATS, DEPENDENCIES, ENV, GIT_HOOKS, MAIN, MCP, PLUGINS, PROJECTS, REPOS, SHARED_MEMORY, TASKS, settings } = cfg;
  // Profile ENV: the profile is the source of these values; they win over .env (written there on install,
  // where the judge and the settings pages read them), an explicit environment variable wins over both.
  const pe = profileEnv(ENV);
  if (pe.error) { console.error(`profile: ${pe.error}`); return 1; }
  for (const [k, v] of Object.entries(pe.values)) if (process.env[k] === undefined) env[k] = v;
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  // Absolute path to openclaw, for MCP servers the Gateway launches with its own PATH.
  const openclawBin = isWin ? null : (process.env.PATH || "").split(path.delimiter).map((d) => path.join(d, "openclaw")).find(existsSync) || null;

  const which = makeWhich({ envPath: process.env.PATH, pathExt: process.env.PATHEXT, platform: process.platform,
    exists: existsSync, delimiter: path.delimiter });
  const repos = repoSteps({ repos: REPOS, pluginsRoot, repoState: gitState, which, canReach });
  const willClone = (p) => [...repos.planned].some((d) => p === d || p.startsWith(d + path.sep));
  const ownState = (o, dir, { afterClone = false } = {}) => {
    if (!existsSync(dir)) {
      return !afterClone && willClone(dir) ? { present: true, pending: true, missing: [], optional: [] }
        : { present: false, missing: [], optional: [] };
    }
    // For plugins with `strict: false` in the marketplace, the dependency file is in the plugin folder.
    const depsFile = [path.join(dir, DEPENDENCIES.file), path.join(dir, "..", DEPENDENCIES.file)].find(existsSync);
    const deps = depsFile ? parseDependencies(readFileSync(depsFile, "utf8"), DEPENDENCIES) : { neighbours: [], tools: [] };
    const exists = (p) => existsSync(p) || (!afterClone && willClone(p));
    return { present: true, ...checkPluginDeps({ pluginDir: dir, deps, home, exists, which }) };
  };
  // The marketplace is always our own clone in the OpenClaw state dir, not Claude Code's clone.
  const marketplaceDir = (name) => {
    const own = path.join(stateDir, "workbench", "marketplaces", name);
    return { present: existsSync(path.join(own, ".claude-plugin", "marketplace.json")), dir: own };
  };
  const nodeDir = path.dirname(process.execPath);
  const npmCli = [path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),            // Windows
    path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")].find(existsSync) // Linux, macOS
    || path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js");
  const mcp = mcpSteps({ mcp: MCP, pluginsRoot, env, stateDir, nodePath: process.execPath, npmCli,
    platform: process.platform, arch: process.arch, which, present: existsSync, projectRoot, tasks: TASKS, openclawBin });
  // Projects: each subfolder with project.json is an agent with its own workspace.
  let projects = [], projectMeta = [];
  if (PROJECTS) {
    const dir = path.resolve(profileRoot, PROJECTS.dir);
    const found = existsSync(dir) ? readdirSync(dir).filter((d) => existsSync(path.join(dir, d, "project.json"))) : [];
    try {
      projectMeta = found.map((d) => {
        const meta = JSON.parse(readFileSync(path.join(dir, d, "project.json"), "utf8"));
        return { id: meta.id, name: meta.name, dir: path.join(dir, d), skills: meta.skills, chatFileFolders: meta.chatFileFolders,
          knowledge: meta.knowledge };
      });
    } catch (e) { console.error(String(e.message)); return 1; }
  }
  // Knowledge base (WORKBENCH_KNOWLEDGE, per project knowledge): folders in memory search, named in each agent's context.
  // Text copies of PDF and Office files come from the aiwb-office plugin; without it there are none.
  const officeEntry = (PLUGINS.own || []).find((p) => p.id === "aiwb-office");
  const officeDir = officeEntry && path.join(pluginsRoot, officeEntry.dir);
  const knowledge = withTextCopies(knowledgeFolders({ global: env.WORKBENCH_KNOWLEDGE, projects: projectMeta, home, exists: existsSync }),
    { root: officeDir ? path.join(stateDir, "workbench", "knowledge-text") : null });
  if (PROJECTS) {
    try {
      projects = projectSteps(projectMeta.map((p) => ({ ...p, knowledgeDirs: projectKnowledgeDirs(knowledge, p.id) })));
    } catch (e) { console.error(String(e.message)); return 1; }
  }
  // Shared memory: the main agent's folder in the data repository, if moved there (memory.mjs).
  const mainDir = MAIN && path.resolve(profileRoot, MAIN.dir);
  // Shared memory of all agents (SHARED_MEMORY) has its own folder; without it, the main agent's memory/ stays shared.
  const sharedDir = SHARED_MEMORY && path.resolve(profileRoot, SHARED_MEMORY.dir);
  const shared = sharedDir && existsSync(sharedDir) ? sharedMemorySteps({ dir: sharedDir, knowledge }) : [];
  const mainOwn = mainDir && existsSync(mainDir) ? mainSteps({ dir: mainDir, sharedSearch: !shared.length, knowledge }) : [];
  const main = [...mainOwn, ...shared,
    ...(shared.length ? [] : knowledgeSteps({ knowledge, searchSet: mainOwn.some((s) => s.id === "memory.search.extraPaths") }))];
  // Profile hooks (GIT_HOOKS): a symlink in .git/hooks, so the secrets check works on a new machine too.
  const linkTarget = (p) => {
    try { const st = lstatSync(p); return st.isSymbolicLink() ? path.resolve(path.dirname(p), readlinkSync(p)) : "(file)"; } catch { return null; }
  };
  let hooks = [];
  try { hooks = profileRoot ? hookSteps(profileRoot, GIT_HOOKS, { linkTarget, isGit: existsSync(path.join(profileRoot, ".git")) }) : []; }
  catch (e) { console.error(String(e.message)); return 1; }
  // New agent chats go into Claude Desktop project folders (WORKBENCH_CLAUDE_DESKTOP_ROOT).
  const tilde = (p) => path.resolve(p.replace(/^~(?=\/|$)/, home));
  const chatsRoot = env.WORKBENCH_CLAUDE_DESKTOP_ROOT && tilde(env.WORKBENCH_CLAUDE_DESKTOP_ROOT);
  const cwds = chatsCwdSteps({ projects: projectMeta, root: chatsRoot, exists: existsSync });
  // A base plugin pin is trusted only from a marketplace clone already at its own pinned commit.
  const gitOut = (dir, ...argv) => spawnSync("git", ["-C", dir, ...argv], { encoding: "utf8" }).stdout?.trim() || "";
  const normUrl = (u) => (u || "").replace(/\.git$/, "").replace(/\/+$/, "").toLowerCase();
  const pinOf = (market, id) => {
    const dir = marketplaceDir(market).dir;
    if (!PLUGINS.marketplaces?.[market]?.commit || gitOut(dir, "rev-parse", "HEAD") !== PLUGINS.marketplaces[market].commit) return null;
    try {
      const entry = JSON.parse(readFileSync(path.join(dir, ".claude-plugin", "marketplace.json"), "utf8")).plugins?.find((p) => p.name === id);
      const src = entry?.source;
      const url = src?.url || (src?.repo ? `https://github.com/${src.repo}` : null);
      return url && /^[0-9a-f]{40}$/.test(src?.sha || "") ? { url, sha: src.sha } : null;
    } catch { return null; }
  };
  const extensions = path.join(stateDir, "extensions");
  const installedAt = (url, sha) => (existsSync(extensions) ? readdirSync(extensions) : []).some((n) => {
    const dir = path.join(extensions, n);
    return existsSync(path.join(dir, ".git")) && normUrl(gitOut(dir, "remote", "get-url", "origin")) === normUrl(url)
      && gitOut(dir, "rev-parse", "HEAD") === sha;
  });
  const plan = buildPlan({ settings: settings({ home, sep: path.sep, env }), plugins: PLUGINS, pluginsRoot,
    projectRoot, profileRoot, env, ownState, marketplaceDir,
    before: [...repos.steps, ...hooks], beforeConfig: [...mcp, ...projects, ...main, ...cwds, chatsProjectsStep(projectMeta), ...bridgeRootSteps(chatsRoot), projectsHooksStep(),
      ...bridgeAdoptionSteps({ fork: Boolean(env.WORKBENCH_OPENCLAW_PACKAGE), chrome: String(env.WORKBENCH_CLAUDE_CHROME ?? "").trim() === "1" }),
      ...pluginUiSteps(PLUGINS.own || []),
      // Network proxy (WORKBENCH_PROXY_URL / _HOSTS / _ROUTES): proxy.proxyUrl and, with the fork, per-host routes.
      ...proxySteps({ url: env.WORKBENCH_PROXY_URL, hosts: env.WORKBENCH_PROXY_HOSTS, routes: env.WORKBENCH_PROXY_ROUTES,
        fork: Boolean(env.WORKBENCH_OPENCLAW_PACKAGE) }),
      // Chat file folders (WORKBENCH_CHAT_FILE_FOLDERS, per project chatFileFolders): with the fork, any file type there opens in the chat.
      ...chatFileFolderSteps({ global: env.WORKBENCH_CHAT_FILE_FOLDERS, projects: projectMeta, fork: Boolean(env.WORKBENCH_OPENCLAW_PACKAGE),
        home, exists: existsSync })] });
  plan.splice(0, plan.length, ...keepPinnedBases(plan, { pinOf, installedAt }));
  // Plugins renamed since an earlier install: old entries, load paths and allow/deny ids move to the new
  // ones before the own plugins are installed (no "duplicate plugin id" from an old and a new path).
  const own = Object.fromEntries(plan.filter((s) => s.kind === "own").map((s) => [s.id, s.dir]));
  const renaming = PLUGIN_RENAMES.filter((r) => own[r.to]);
  if (renaming.length) {
    const ids = [...new Set(renaming.flatMap((r) => [r.from, r.to]))];
    const renameSteps = pluginRenameSteps({ renames: PLUGIN_RENAMES, own, current: {
      entries: Object.fromEntries(ids.map((id) => [id, configValue(`plugins.entries.${id}`)])),
      paths: configValue("plugins.load.paths"), allow: configValue("plugins.allow"), deny: configValue("plugins.deny") } });
    plan.splice(plan.findIndex((s) => s.kind === "own"), 0, ...renameSteps);
  }
  // Own plugins' skills, in install order: on a name clash, the first one wins.
  const skillsByPlugin = Object.fromEntries(plan.filter((s) => s.kind === "own").map((s) => [s.id, s.pending ? null : pluginSkills(s.dir)]));
  const linkNow = (name) => { const t = linkTarget(path.join(stateDir, "plugin-skills", name)); try { return t && realpathSync(t); } catch { return null; } };
  // GPU memory embeddings server (WORKBENCH_LOCAL_EMBEDDINGS=vulkan[:N]), before the final check.
  const gpu = gpuEmbeddingsSteps({ mode: env.WORKBENCH_LOCAL_EMBEDDINGS, platform: process.platform,
    managedCommand: /^vulkan/.test(env.WORKBENCH_LOCAL_EMBEDDINGS || "") ? configValue("models.providers.llama-cpp.localService.command") : null,
    workbenchDir, build: PUBLIC.LLAMA_CPP_VULKAN,
    devices: which("vulkaninfo") ? parseVulkanDevices(run("vulkaninfo", ["--summary"], { capture: true }).out) : [] });
  plan.splice(plan.findLastIndex((s) => s.kind === "check"), 0, ...gpu);
  // Fork presets (WORKBENCH_FORK_PRESETS; the key used to be WORKBENCH_OPENCLAW_PATCHES).
  const fork = Boolean(env.WORKBENCH_OPENCLAW_PACKAGE);
  const legacy = !env.WORKBENCH_FORK_PRESETS?.trim() && Boolean(env.WORKBENCH_OPENCLAW_PATCHES?.trim());
  plan.unshift(...forkPresetSteps(legacy ? env.WORKBENCH_OPENCLAW_PATCHES : env.WORKBENCH_FORK_PRESETS, { fork, legacy }));
  // Fork env.vars settings: one write at the front of the plan, after the .env cleanup below (batchEnvVarSteps).
  plan.splice(0, plan.length, ...batchEnvVarSteps(plan));
  // Remove .env lines left by an older install: they would override the env.vars settings.
  const oldEnv = readManifest()?.env || [];
  if (oldEnv.length) plan.unshift({ kind: "env-remove", id: oldEnv.join(", "), keys: oldEnv });
  // Before the final `config validate`: allowSymlinkTargets is a setting too.
  plan.splice(plan.findLastIndex((s) => s.kind === "check"), 0, ...skillCollisions(skillsByPlugin, linkNow, { namespaced: Boolean(env.WORKBENCH_OPENCLAW_PACKAGE) }), ...skillLinkSteps(projectMeta, skillsByPlugin, { linkTarget,
    allowed: projectMeta.some((p) => p.skills) ? configValue("skills.load.allowSymlinkTargets") : [] }));
  plan.push(...ideSteps({ acpFile, ideDir: existsSync(path.dirname(acpFile)), text: readText(acpFile),
    openclaw: openclawBin && acpLaunch({ bin: openclawBin, real: realpathSync(openclawBin),
      firstLine: readText(realpathSync(openclawBin)).split("\n", 1)[0], execPath: process.execPath,
      siblingNode: [path.join(path.dirname(openclawBin), "node")].find(existsSync) }) }));
  // Claude Code's own proxy (WORKBENCH_CLAUDE_CODE_PROXY): the env block of ~/.claude/settings.json.
  const claudeSettings = path.join(home, ".claude", "settings.json");
  plan.push(...claudeCodeProxySteps({ value: env.WORKBENCH_CLAUDE_CODE_PROXY, file: claudeSettings,
    text: existsSync(claudeSettings) ? readText(claudeSettings) : null, recorded: readManifest()?.claudeEnv?.[claudeSettings] || null }));
  // OpenClaw Chrome extension: the native host through which it finds the local OpenClaw.
  plan.push(...chromeHostSteps({ value: env.WORKBENCH_CHROME_EXTENSION, platform: process.platform, home, exists: existsSync }));
  // Daily backup of the OpenClaw databases into a local Git repository (WORKBENCH_BACKUP).
  plan.push(...backupSteps({ dir: env.WORKBENCH_BACKUP?.trim() && untilde(env.WORKBENCH_BACKUP.trim()), exists: existsSync }));
  // Chats every 10 minutes: the Claude Desktop tree with adoption into agents (WORKBENCH_CLAUDE_DESKTOP_ROOT)
  // and the text chat archive in the data repository (profile CHATS).
  const archive = CHATS && profileRoot && { to: path.resolve(profileRoot, CHATS.dir), secrets: (CHATS.secrets || []).map(tilde), tz: CHATS.tz,
    ...(CHATS.learnedSkills ? { skillsTo: path.resolve(profileRoot, CHATS.learnedSkills) } : {}),
    ...(CHATS.commit?.length ? { commit: CHATS.commit.map((d) => path.resolve(profileRoot, d)) } : {}) };
  // With the fork, systemd waits for the Gateway's stop as long as the Gateway waits for agent turns (a drop-in).
  plan.push(...gatewayStopTimeoutSteps({ fork, platform: process.platform, systemctl: which("systemctl"),
    unitDir: path.join(home, ".config", "systemd", "user"), exists: existsSync, read: (f) => (existsSync(f) ? readText(f) : null) }));
  plan.push(...chatsTimerSteps({ root: chatsRoot, archive, platform: process.platform, systemctl: which("systemctl"),
    // The Node installed by OpenClaw (install-cli.sh), not the system one: that may be removed or upgraded.
    unitDir: path.join(home, ".config", "systemd", "user"),
    node: [path.join(stateDir, "tools", "node", "bin", "node")].find(existsSync) || process.execPath,
    script: path.join(projectRoot, "migrate", "chats-sync.mjs"),
    pathDirs: [...(openclawBin ? [path.dirname(openclawBin)] : []), "/usr/local/bin", "/usr/bin", "/bin"] }));
  plan.push(...knowledgeTextTimerSteps({ knowledge, platform: process.platform, systemctl: which("systemctl"),
    unitDir: path.join(home, ".config", "systemd", "user"),
    node: [path.join(stateDir, "tools", "node", "bin", "node")].find(existsSync) || process.execPath,
    script: officeDir ? path.join(officeDir, "bin", "knowledge-text.mjs") : "", pathDirs: ["/usr/local/bin", "/usr/bin", "/bin"] }));

  console.log(`ai-workbench → OpenClaw ${OPENCLAW_VERSION}\nBuild: ${profileRoot ? `public + profile ${profileRoot}` : "public, no profile"}\nPlugins root: ${pluginsRoot}\nState: ${stateDir}\n`);
  for (const w of profileWarn) console.log(`⚠ profile: ${w}`);
  if (profileTemp) console.log("⚠ profile paths in the plan point to a temporary copy (--dry-run); on install, to the clone folder.");
  console.log("Plan:\n" + formatPlan(plan));
  if (added) console.log(`\n  Gateway token           will be created in ${envFile}`);
  console.log(`  uninstall manifest      ${existsSync(manifestFile) ? "exists — only new keys and plugins will be added" : "will be written"}: ${manifestFile}`);
  if (flag("--dry-run")) { if (profileTemp) rmSync(profileTemp, { recursive: true, force: true }); return 0; }

  if (!flag("--yes")) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question("\nProceed? Plugins will get the capabilities they request (--accept-capabilities);\nbase plugins are downloaded from GitHub at the commits pinned in the Anthropic marketplace. [y/N] ")).trim().toLowerCase();
    rl.close();
    if (!["y", "yes", "д", "да"].includes(answer)) { console.log("Cancelled, nothing was changed."); return 0; }
  }

  const profileValues = Object.fromEntries(Object.entries(pe.values).filter(([k]) => process.env[k] === undefined));
  const envOut = setEnvLines(envText, profileValues);
  if (added || envOut !== before) {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(envFile, envOut);
    if (!isWin) chmodSync(envFile, 0o600);
  }
  try { recordManifest(plan); } catch (e) {
    console.error(`✗ uninstall manifest not written: ${e.message}\nStopping: without it, uninstall cannot restore the previous state.`);
    return 1;
  }
  let failed = 0;
  const brokenMarkets = new Set();
  for (const step of plan) {
    if (step.kind === "skip") continue;
    process.stdout.write(`\n→ ${step.kind} ${step.id}\n`);
    if (step.kind === "hook") {
      if (step.link) {
        try { mkdirSync(path.dirname(step.link.from), { recursive: true }); symlinkSync(step.link.to, step.link.from); }
        catch (e) { failed++; console.error(`✗ hook ${step.id}: ${e.message}`); }
      }
      continue;
    }
    if (step.kind === "collision") continue;
    if (step.kind === "skill-link") {
      if (step.link) {
        try {
          mkdirSync(path.dirname(step.link.from), { recursive: true });
          if (step.replace) unlinkSync(step.link.from);
          symlinkSync(step.link.to, step.link.from);
        } catch (e) { failed++; console.error(`✗ project skill ${step.id}: ${e.message}`); }
      }
      continue;
    }
    if (step.kind === "chrome-host") {
      const r = openclaw(step.argv, { capture: true });
      if (!chromeDataDirs(process.platform, home).some((d) => existsSync(chromeHostFile(d)))) {
        failed++; console.error(`✗ Chrome extension host not registered (exit code ${r.code})\n${r.out.trim().split("\n").slice(-3).join("\n")}`);
      } else if (r.code !== 0) {
        console.log("Host registered. Get the extension from the Chrome Web Store:\n  https://chromewebstore.google.com/detail/openclaw/kcdjddhmeafeomebliikmbpblkmkfoig\n" +
          "  If it was installed before the host, fully restart Chrome. Check: openclaw browser extension status");
      }
      continue;
    }
    if (step.kind === "backup-schedule") {
      const r = openclaw(step.argv, { capture: true });
      // The schedule lives in the Gateway: one made before stays, only creating or changing it needs the Gateway.
      if (r.code !== 0) console.log(`  not updated (the Gateway must be running): ${r.out.trim().split("\n").slice(-1)[0] || `exit code ${r.code}`}\n` +
        `  A schedule set up before keeps running. To create or change it, start the Gateway and run: openclaw ${step.argv.join(" ")}`);
      continue;
    }
    if (step.kind === "env-remove") {
      if (existsSync(envFile)) writeFileSync(envFile, removeEnvLines(readFileSync(envFile, "utf8"), step.keys));
      console.log(`Removed from ${envFile}: ${step.keys.join(", ")}`);
      continue;
    }
    if (step.kind === "plugin-rename") {
      // One `config patch`: the old entries go and the new ones get their keys in the same write.
      const dir = mkdtempSync(path.join(os.tmpdir(), "aiwb-rename-"));
      const file = path.join(dir, "plugins.patch.json");
      try {
        writeFileSync(file, JSON.stringify(step.patch, null, 2) + "\n", { mode: 0o600 });
        const r = openclaw(["config", "patch", "--file", file], { capture: true });
        if (r.code !== 0) { failed++; console.error(`✗ renamed plugins (exit code ${r.code})\n${r.out.trim().split("\n").slice(-5).join("\n")}`); }
      } finally { rmSync(dir, { recursive: true, force: true }); }
      continue;
    }
    if (step.kind === "claude-env") {
      try { writeClaudeEnv(step); } catch (e) { failed++; console.error(`✗ claude-env ${step.file}: ${e instanceof SyntaxError ? "not valid JSON; left as is" : e.code || "write failed"}`); }
      continue;
    }
    if (step.kind === "dropin" || step.kind === "dropin-remove") {
      try {
        if (step.kind === "dropin") for (const [f, text] of Object.entries(step.files)) { mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, text); }
        else for (const f of step.files) rmSync(f, { force: true });
      } catch (e) { failed++; console.error(`✗ ${step.id}: ${e.message}`); }
      continue;
    }
    if (step.kind === "timer") {
      try {
        for (const [f, text] of Object.entries(step.files)) { mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, text); }
        for (const argv of [["--user", "daemon-reload"], ["--user", "enable", "--now", `${step.id}.timer`]]) {
          const r = spawnSync("systemctl", argv, { encoding: "utf8" });
          if (r.status !== 0) throw new Error(`systemctl ${argv.join(" ")}: ${(r.stderr || "").trim()}`);
        }
      } catch (e) { failed++; console.error(`✗ timer ${step.id}: ${e.message}`); }
      continue;
    }
    if (step.kind === "ide") {
      if (step.entry) {
        try { writeFileSync(step.file, applyAcp(readText(step.file), step.name, step.entry)); }
        catch (e) { failed++; console.error(`✗ ${step.id}: ${e.message}`); }
      }
      continue;
    }
    if (!step.argv && step.kind !== "mcp-download" && step.kind !== "llama-download") continue;     // repo, already installed MCP: info only
    if (step.kind === "own" && step.pending) {
      const st = ownState({ id: step.id }, step.dir, { afterClone: true });
      if (!st.present || st.missing.length) {
        console.error(`✗ own ${step.id}: missing after clone: ${st.missing.join("; ") || "plugin folder"}`);
        failed++; continue;
      }
    }
    if (step.kind === "mcp-download") {
      try { await download(step); } catch (e) { failed++; console.error(`✗ mcp ${step.id}: ${e.message}`); }
      continue;
    }
    if (step.kind === "llama-download") {
      if (existsSync(step.bin)) { console.log("  already downloaded"); continue; }
      try { await download(step); } catch (e) { failed++; console.error(`✗ ${step.id}: ${e.message}`); }
      continue;
    }
    // Marketplace is not at its pinned commit: skip its base plugins, otherwise a different version is silently installed.
    if (step.kind === "base" && brokenMarkets.has(step.market)) {
      failed++; console.error(`✗ base ${step.id}: marketplace ${step.market} is not at the pinned commit — not installing`); continue;
    }
    if (step.exec === "git" && step.argv[0] === "clone") mkdirSync(path.dirname(step.argv.at(-1)), { recursive: true });
    const r = step.exec ? run(step.exec, step.argv, { capture: !!step.expect }) : openclaw(step.argv, { capture: step.kind === "config" || step.kind === "config-batch" || !!step.tolerant });
    const mismatch = step.expect && r.code === 0 && r.out.trim() !== step.expect;
    // A tolerant step may find nothing to do (an old plugin id already gone).
    if (step.tolerant && r.code !== 0) { console.log(`  nothing to remove: ${r.out.trim().split("\n").slice(-1)[0] || `exit code ${r.code}`}`); continue; }
    if (r.code !== 0 || mismatch) {
      failed++;
      // A failure of the base plugin itself (network, cloning its source) does not taint the marketplace: other base plugins still install.
      if (step.kind === "marketplace") brokenMarkets.add(step.market);
      console.error(mismatch ? `✗ ${step.id}: HEAD ${r.out.trim().slice(0, 12)}, pinned ${step.expect.slice(0, 12)}`
        // A secret step (proxy URL) prints no command output: it may echo the value.
        : `✗ ${step.kind} ${step.id} (exit code ${r.code})${r.out && !step.secret ? "\n" + r.out.trim().split("\n").slice(-5).join("\n") : ""}`);
    }
  }
  pruneMcp(plan);
  // The profile's initial tasks are created through the Gateway, so it must be running.
  // The task sync script sits next to the scheduled-tasks MCP server (plugins repository).
  const tasksMcp = MCP.find((m) => m.id === "scheduled-tasks");
  const syncScript = tasksMcp && path.join(tasksMcp.root === "plugins" ? pluginsRoot : projectRoot, ...path.posix.dirname(tasksMcp.entry).split("/"), "sync.mjs");
  const syncCmd = TASKS && syncScript && `node ${syncScript} --profile ${profileRoot}`;
  if (TASKS) {
    process.stdout.write("\n→ scheduled tasks\n");
    if (openclaw(["health"], { capture: true }).code === 0) {
      const r = run(process.execPath, [syncScript, "--profile", profileRoot]);
      if (r.code !== 0) { failed++; console.error("✗ scheduled tasks — see above"); }
    } else console.log(`  Gateway is not running — after \`openclaw gateway run\`, create the tasks with:\n  ${syncCmd}`);
  }
  const skipped = plan.filter((s) => s.kind === "skip");
  console.log(`\nDone: errors ${failed}, skipped ${skipped.length}.`);
  console.log("Next: add your keys to " + envFile + " (OPENROUTER_API_KEY / ANTHROPIC_API_KEY),\n" +
    "run `openclaw gateway run` and open http://127.0.0.1:18789 or `openclaw tui`.");
  if (process.env.WORKBENCH_PATH_HINT) {
    console.log(`\n⚠ ${process.env.WORKBENCH_PATH_HINT} is not in PATH — a new terminal will not find \`openclaw\`. Add to ~/.bashrc or ~/.zshrc:\n` +
      `  export PATH="${process.env.WORKBENCH_PATH_HINT}:$PATH"`);
  }
  if (plan.some((s) => s.kind === "ide")) console.log("In JetBrains IDEs: AI Assistant → agent picker → OpenClaw (requires a running Gateway).");
  return failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
}
