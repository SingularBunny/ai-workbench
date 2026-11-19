// Repositories and MCP servers the profile adds. Part of installer/lib.mjs (pure functions, no I/O).
import path from "node:path";

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
