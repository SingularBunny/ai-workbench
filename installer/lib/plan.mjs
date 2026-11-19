// The install plan: plugins, marketplaces and their order. Part of installer/lib.mjs (pure functions, no I/O).
import path from "node:path";

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
    // when: a .env key, or several keys of which any one is enough.
    if (r.when && ![].concat(r.when).some((k) => env[k])) continue;
    // package: a .env key naming a local npm-pack .tgz of the plugin (built from the fork), with its sha256 in
    // <key>_SHA256; set, it replaces the registry copy. A local copy needs capability consent, as own plugins do.
    const local = r.package && String(env[r.package] || "").trim();
    if (local) {
      const sha256 = String(env[`${r.package}_SHA256`] || "").trim().toLowerCase();
      const error = /^[0-9a-f]{64}$/.test(sha256) ? null : `${r.package} is set, but ${r.package}_SHA256 is missing or not a sha256`;
      steps.push({ kind: "runtime", id: r.id, note: `from ${local}`, package: { env: r.package, file: local, sha256 },
        ...(error ? { error, warn: [error] } : {}),
        argv: ["plugins", "install", `npm-pack:${local}`, "--force", "--accept-capabilities"] });
      continue;
    }
    // spec: where it comes from when that is not its id (a ClawHub plugin, `clawhub:<name>`).
    steps.push({ kind: "runtime", id: r.id, argv: ["plugins", "install", r.spec || r.id, "--force"], ...(r.optional ? { optional: r.optional } : {}) });
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
 * The archive a runtime plugin step with `package` installs from (buildPlan). The file named in .env is checked
 * against its sha256 and copied to `kept` (<state>/workbench/<plugin>-package.tgz), which is what gets installed:
 * the install record keeps pointing at a file that outlives the build folder. A file that is gone falls back to
 * the kept copy with the same sha256. Returns { from, copy } (copy: whether to copy `from` to `kept` first) or { error }.
 */
export function localPluginPackage(pkg, kept, { home, exists, sha256 }) {
  const file = pkg.file.replace(/^~(?=$|[\\/])/, home);
  if (exists(file)) {
    const got = sha256(file);
    if (got !== pkg.sha256) return { error: `${pkg.env}: sha256 ${got}, expected ${pkg.sha256} — not installing` };
    return { from: file, copy: path.resolve(file) !== path.resolve(kept) };
  }
  if (exists(kept) && sha256(kept) === pkg.sha256) return { from: kept, copy: false, fallback: true };
  return { error: `${pkg.env}: no file ${file} (and no kept copy with sha256 ${pkg.sha256})` };
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
    "tts-env": "speech environment", "file-download": "download", "file-copy": "copy file",
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
