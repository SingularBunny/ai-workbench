// Proxy routes for OpenClaw and Claude Code. Part of installer/lib.mjs (pure functions, no I/O).
import { createHash } from "node:crypto";

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
