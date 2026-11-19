// What the install touched: the manifest, uninstall and plugin renames. Part of installer/lib.mjs (pure functions, no I/O).

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
  const text = String(out ?? "").trim();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = undefined; }
  // `--json` reports a failure as {"ok": false, "error": {"message": …}}, with any exit code.
  const failure = parsed && typeof parsed === "object" && parsed.ok === false && parsed.error
    ? String(parsed.error.message ?? parsed.error) : undefined;
  if (code === 0 && failure === undefined) {
    if (parsed === undefined) throw new Error(`config get: not JSON: ${text.slice(0, 120)}`);
    // A sensitive key (proxy.proxyUrl, tokens) comes back masked: its previous value is unknown.
    return parsed === "__OPENCLAW_REDACTED__" ? { masked: true } : { value: parsed };
  }
  const message = failure ?? text;
  // "Unknown config path": an older OpenClaw has no such key yet, so it had no value.
  if (/valid but unset|Config path not found|Config file not found|Unknown config path/i.test(message)) return { absent: true };
  throw new Error(`config get: ${message.split("\n").slice(-1)[0].slice(0, 200)}`);
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
