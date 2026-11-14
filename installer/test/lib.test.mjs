// node --test 'installer/test/*.test.mjs' (no dependencies).
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { acpLaunch, skillCollisions, skillLinkSteps, ACP_AGENT, acpEntry, applyAcp, buildPlan, checkPluginDeps, formatPlan, checksumFor, ensureGatewayToken, configBefore, hookSteps, ideSteps, isGitUrl, mainSteps, makeWhich, marketplaceSteps, profileSource, profileTarget, mcpSteps, mergeManifest, staleVersions, touchedBy, uninstallPlan, mergeProfile, parseDependencies, projectSteps, repoSteps, sameRepo, winQuote } from "../lib.mjs";
import * as REAL from "../../openclaw/workbench.config.mjs";

const DEPS = `# header
tools:
  - name: claude
    why: runs the evaluations
    required: true
  - name: pueue
    required: false
    note: >-
      without pueue, the runner falls back to the old way.
      required: true
siblings:
  - path: ../core-lib
    why: rules core
    required: true
    role: body-source
  - path: ../plugin-a
    required: false
sources:
  - url: https://code.claude.com/docs/en/plugins
`;
test("dependencies.yml: neighbours and tools with required flags", () => {
  const d = parseDependencies(DEPS);
  assert.deepEqual(d.tools, [{ name: "claude", required: true }, { name: "pueue", required: false }]);
  assert.deepEqual(d.neighbours, [
    { path: "../core-lib", role: "body-source", required: true },
    { path: "../plugin-a", role: null, required: false },
  ]);
});

test("text inside `>-` does not override entry fields", () => {
  // The pueue note contains the line "required: true": it is text, not a field.
  assert.equal(parseDependencies(DEPS).tools[1].required, false);
});

test("a field after multi-line text is read, the text is not", () => {
  const d = parseDependencies(`tools:
  - name: sshpass
    note: >-
      used to be required:
      required: true
    required: false
`);
  assert.equal(d.tools[0].required, false);
});

test("a profile sets its own dependency file format", () => {
  const format = { siblings: "needs", tools: "cli", path: "dir", name: "bin", required: "must", yes: ["ja"] };
  const d = parseDependencies("needs:\n  - dir: ../core-lib\n    must: ja\ncli:\n  - bin: jq\n    must: nein\n", format);
  assert.deepEqual(d.neighbours, [{ path: "../core-lib", role: null, required: true }]);
  assert.deepEqual(d.tools, [{ name: "jq", required: false }]);
});

const root = "/home/u/src";
const disk = new Set([`${root}/plugin-a`, `${root}/core-lib`, "/usr/bin/claude"]);
const exists = (p) => disk.has(p);
const which = makeWhich({ envPath: "/usr/bin", platform: "linux", exists, delimiter: ":" });

test("missing required neighbour: plugin is skipped with a reason", () => {
  const deps = parseDependencies(DEPS);
  const r = checkPluginDeps({ pluginDir: `${root}/plugin-a`, deps, home: "/home/u", exists: () => false, which });
  assert.ok(r.missing.some((m) => m.includes("../core-lib")));
});

test("missing optional dependency: a warning, not a skip", () => {
  const deps = parseDependencies(DEPS);
  const r = checkPluginDeps({ pluginDir: `${root}/plugin-a`, deps, home: "/home/u", exists, which });
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.optional, ["tool pueue"]);
});

test("~/ neighbour path is relative to home", () => {
  const deps = { neighbours: [{ path: "~/src/core-lib", required: true }], tools: [] };
  const r = checkPluginDeps({ pluginDir: "/elsewhere/p", deps, home: "/home/u", exists, which });
  assert.deepEqual(r.missing, []);
});

test("which on Windows searches with PATHEXT", () => {
  const w = makeWhich({ envPath: "C:\\bin", pathExt: ".EXE;.CMD", platform: "win32",
    exists: (p) => p === path.join("C:\\bin", "openclaw.cmd"), delimiter: ";" });
  assert.equal(w("openclaw"), true);
  assert.equal(w("node"), false);
});

test("Gateway token: created if missing; an existing one is not overwritten", () => {
  const a = ensureGatewayToken("OPENROUTER_API_KEY=x", "t1");
  assert.equal(a.added, true);
  assert.equal(a.text, "OPENROUTER_API_KEY=x\nOPENCLAW_GATEWAY_TOKEN=t1\n");
  const b = ensureGatewayToken(a.text, "t2");
  assert.equal(b.added, false);
  assert.equal(b.text, a.text);
});

const PLUGINS = {
  own: [{ id: "aw", dir: "plugins/aw", root: "project" }, { id: "plugin-a", dir: "plugin-a" }, { id: "gone", dir: "gone-plugin" }],
  marketplaces: { cpo: { repo: "https://example.invalid/cpo.git" } },
  bases: [{ id: "superpowers", marketplace: "cpo" }],
  runtime: [{ id: "@openclaw/acpx", when: "WORKBENCH_VM_SSH" }],
};
const local = () => ({ present: true, dir: "/m/cpo" });
const remote = () => ({ present: false, dir: "/s/cpo" });
const ownState = (o, dir) => (o.id === "gone" ? { present: false, missing: [], optional: [] }
  : { present: true, missing: [], optional: [] });

test("plan: base plugins before own plugins, settings after plugins, check last", () => {
  const plan = buildPlan({ settings: [["gateway.bind", "loopback"]], plugins: PLUGINS, pluginsRoot: root, projectRoot: "/repo", env: {}, ownState, marketplaceDir: local });
  const kinds = plan.map((s) => s.kind);
  assert.ok(kinds.indexOf("base") < kinds.indexOf("own"));
  assert.ok(kinds.indexOf("own") < kinds.indexOf("config"));
  assert.equal(kinds.at(-1), "check");
  const own = plan.find((s) => s.id === "plugin-a");
  assert.deepEqual(own.argv, ["plugins", "install", "--link", path.join(root, "plugin-a"), "--force", "--accept-capabilities"]);
  assert.equal(plan.find((s) => s.id === "gone").kind, "skip");
  // A project plugin comes from the repository, not from the own plugins folder.
  assert.equal(plan.find((s) => s.id === "aw").dir, path.join("/repo", "plugins", "aw"));
});

test("acpx is installed only when a VM is configured", () => {
  const without = buildPlan({ settings: [], plugins: PLUGINS, pluginsRoot: root, projectRoot: "/repo", env: {}, ownState, marketplaceDir: local });
  const withVm = buildPlan({ settings: [], plugins: PLUGINS, pluginsRoot: root, projectRoot: "/repo", env: { WORKBENCH_VM_SSH: "u@vm" }, ownState, marketplaceDir: local });
  assert.equal(without.some((s) => s.id === "@openclaw/acpx"), false);
  assert.equal(withVm.some((s) => s.id === "@openclaw/acpx"), true);
});

test("marketplace: always its own clone; existing copy: git pull, none: clone, and before base plugins", () => {
  const withLocal = buildPlan({ settings: [], plugins: PLUGINS, pluginsRoot: root, projectRoot: "/repo", env: {}, ownState, marketplaceDir: local });
  assert.deepEqual(withLocal.find((s) => s.kind === "marketplace").argv.slice(0, 4), ["-C", "/m/cpo", "pull", "--ff-only"]);
  assert.deepEqual(withLocal.find((s) => s.kind === "base").argv.slice(0, 5), ["plugins", "install", "superpowers", "--marketplace", "/m/cpo"]);
  const clean = buildPlan({ settings: [], plugins: PLUGINS, pluginsRoot: root, projectRoot: "/repo", env: {}, ownState, marketplaceDir: remote });
  const kinds = clean.map((s) => s.kind);
  assert.equal(clean.find((s) => s.kind === "marketplace").argv[0], "clone");
  assert.ok(kinds.indexOf("marketplace") < kinds.indexOf("base"));
});

test("sameRepo: ssh and https of one repository match, different ones do not", () => {
  assert.equal(sameRepo("git@github.com:A/b.git", "https://github.com/a/b"), true);
  assert.equal(sameRepo("https://user:tok@github.com/a/b.git", "https://github.com/a/b.git"), true);
  assert.equal(sameRepo("https://github.com/a/b", "https://github.com/a/c"), false);
  assert.equal(sameRepo("", "https://github.com/a/b"), false);
});

test("repositories: no folder means clone from origin; existing one is used and differences are reported", () => {
  const repos = [
    { dir: "gone", repo: "git@github.com:o/gone.git" },
    { dir: "clean", repo: "git@github.com:o/clean.git" },
    { dir: "dirty", repo: "git@github.com:o/dirty.git" },
    { dir: "local-only", repo: null },
    { dir: "no-repo-no-dir", repo: null },
  ];
  const state = {
    [path.join(root, "clean")]: { exists: true, isGit: true, origin: "https://github.com/o/clean", dirty: 0, ahead: 0 },
    [path.join(root, "dirty")]: { exists: true, isGit: true, origin: "git@github.com:o/other.git", dirty: 3, ahead: 2 },
    [path.join(root, "local-only")]: { exists: true, isGit: true, origin: "", dirty: 0, ahead: 0 },
  };
  const { steps, planned } = repoSteps({ repos, pluginsRoot: root, repoState: (d) => state[d] || { exists: false } });
  const by = Object.fromEntries(steps.map((s) => [s.id, s]));
  assert.deepEqual(by.gone.argv, ["clone", "git@github.com:o/gone.git", path.join(root, "gone")]);
  assert.ok(planned.has(path.join(root, "gone")));
  assert.equal(by.clean.argv, undefined);           // the clone is left alone
  assert.deepEqual(by.clean.warn, []);
  assert.equal(by.dirty.warn.length, 3);            // foreign origin, uncommitted, unpushed
  assert.match(by["local-only"].warn[0], /no origin/);
  assert.equal(by["no-repo-no-dir"], undefined);    // nothing to clone from; the plugin itself reports the skip
});

test("SSH clone without ssh: skip with a reason in the plan; https: clone", () => {
  const repos = [{ dir: "priv", repo: "git@github.com:o/priv.git" }, { dir: "pub", repo: "https://github.com/o/pub.git" }];
  const { steps } = repoSteps({ repos, pluginsRoot: root, repoState: () => ({ exists: false }), which: (t) => t !== "ssh" });
  assert.equal(steps.find((s) => s.id === "priv").kind, "skip");
  assert.match(steps.find((s) => s.id === "priv").reason, /ssh/);
  assert.equal(steps.find((s) => s.id === "pub").kind, "clone");
});

test("no repository access: skip with a reason; reachable: clone", () => {
  const repos = [{ dir: "priv", repo: "git@github.com:o/priv.git" }, { dir: "pub", repo: "https://github.com/o/pub.git" }];
  const canReach = (u) => (u.includes("priv") ? { ok: false, reason: "Permission denied (publickey)" } : { ok: true });
  const { steps, planned } = repoSteps({ repos, pluginsRoot: root, repoState: () => ({ exists: false }), canReach });
  const priv = steps.find((s) => s.id === "priv");
  assert.equal(priv.kind, "skip");
  assert.match(priv.reason, /no access.*Permission denied/);
  assert.equal(planned.has(path.join(root, "priv")), false);  // dependent plugins do not wait for the clone
  assert.equal(steps.find((s) => s.id === "pub").kind, "clone");
});

const MCP = [
  { id: "k8s", kind: "npm", package: "@s/k8s", version: "1.2.3", bin: "dist/index.js", requires: ["kubectl"] },
  { id: "graf", kind: "github-release", repo: "g/mcp-graf", version: "1.5.1", binary: "mcp-graf",
    asset: { linux: "Linux", win32: "Windows" }, arch: { x64: "x86_64" }, when: "GRAFANA_URL",
    env: { GRAFANA_URL: "${GRAFANA_URL}" }, optionalEnv: ["GRAFANA_SERVICE_ACCOUNT_TOKEN", "GRAFANA_PASSWORD"] },
];
const mcpCtx = { mcp: MCP, stateDir: "/s", nodePath: "/n/node", npmCli: "/n/npm-cli.js", arch: "x64", which: () => false, present: () => false };

test("MCP from npm: pinned version, launched by absolute path, no npx", () => {
  const steps = mcpSteps({ ...mcpCtx, env: {}, platform: "linux" });
  const inst = steps.find((s) => s.id === "k8s");
  assert.ok(inst.argv.includes("@s/k8s@1.2.3"));
  assert.equal(inst.exec, "/n/node");                 // npm-cli.js with the same Node, not npm's shebang
  assert.equal(inst.argv[0], "/n/npm-cli.js");
  assert.match(inst.warn.join(), /kubectl/);
  const cfg = JSON.parse(steps.find((s) => s.id === "mcp.servers.k8s").argv[3]);
  assert.deepEqual(cfg, { command: "/n/node", args: [path.join("/s", "workbench", "mcp", "k8s", "1.2.3", "node_modules", "@s", "k8s", "dist", "index.js")] });
  assert.equal(JSON.stringify(steps).includes("npx"), false);
});

test("MCP from a release: only when the variable is set; secrets as references, only those set", () => {
  assert.equal(mcpSteps({ ...mcpCtx, env: {}, platform: "linux" }).find((s) => s.id === "mcp graf").kind, "skip");
  const steps = mcpSteps({ ...mcpCtx, env: { GRAFANA_URL: "http://g", GRAFANA_SERVICE_ACCOUNT_TOKEN: "sekret" }, platform: "linux" });
  const dl = steps.find((s) => s.kind === "mcp-download");
  assert.equal(dl.url, "https://github.com/g/mcp-graf/releases/download/v1.5.1/mcp-graf_Linux_x86_64.tar.gz");
  assert.equal(dl.checksumsUrl, "https://github.com/g/mcp-graf/releases/download/v1.5.1/mcp-graf_1.5.1_checksums.txt");
  const cfgText = steps.find((s) => s.id === "mcp.servers.graf").argv[3];
  assert.equal(cfgText.includes("sekret"), false);
  assert.deepEqual(JSON.parse(cfgText).env, { GRAFANA_URL: "${GRAFANA_URL}", GRAFANA_SERVICE_ACCOUNT_TOKEN: "${GRAFANA_SERVICE_ACCOUNT_TOKEN}" });
  const win = mcpSteps({ ...mcpCtx, env: { GRAFANA_URL: "x" }, platform: "win32" }).find((s) => s.kind === "mcp-download");
  assert.match(win.url, /_Windows_x86_64\.zip$/);
  assert.match(win.bin, /mcp-graf\.exe$/);
  assert.equal(mcpSteps({ ...mcpCtx, env: { GRAFANA_URL: "x" }, platform: "darwin" }).find((s) => s.id === "mcp graf").kind, "skip");
});

test("checksumFor: release line by file name, null if missing", () => {
  const sums = `${"a".repeat(64)}  mcp-graf_Linux_x86_64.tar.gz\n${"b".repeat(64)}  mcp-graf_Windows_x86_64.zip\n`;
  assert.equal(checksumFor(sums, "mcp-graf_Windows_x86_64.zip"), "b".repeat(64));
  assert.equal(checksumFor(sums, "other.tar.gz"), null);
});

test("winQuote: JSON reaches the program with its quotes", () => {
  assert.equal(winQuote("loopback"), "loopback");
  assert.equal(winQuote('{"mode":"token"}'), '"{\\"mode\\":\\"token\\"}"');
  assert.equal(winQuote("C:\\a b\\"), '"C:\\a b\\\\"');
});

const PUB = {
  REPOS: [], MCP: [],
  PLUGINS: { own: [{ id: "ai-workbench", dir: "plugins/ai-workbench", root: "project" }],
    marketplaces: { cpo: { repo: "https://github.com/a/cpo.git" } }, bases: [], runtime: [] },
  settings: () => [["gateway.bind", "loopback"]],
};

test("the profile adds to the public build instead of replacing it", () => {
  const m = mergeProfile(PUB, {
    REPOS: [{ dir: "mine", repo: "git@github.com:o/mine.git" }],
    PLUGINS: { own: [{ id: "mine", dir: "mine" }], bases: [{ id: "sp", marketplace: "cpo" }] },
    MCP: [{ id: "k8s" }],
    settings: () => [["skills.load.extraDirs", ["/h/.claude/skills"]]],
  });
  assert.deepEqual(m.PLUGINS.own.map((o) => o.id), ["ai-workbench", "mine"]);
  assert.deepEqual(m.settings({}).map(([k]) => k), ["gateway.bind", "skills.load.extraDirs"]);
  assert.equal(m.REPOS.length, 1); assert.equal(m.MCP.length, 1);
  assert.deepEqual(mergeProfile(PUB, {}).PLUGINS.own.map((o) => o.id), ["ai-workbench"]); // without a profile: the public build
});

test("the profile cannot override a plugin, MCP or marketplace, nor touch the Gateway", () => {
  assert.throws(() => mergeProfile(PUB, { PLUGINS: { own: [{ id: "ai-workbench", dir: "x" }] } }), /plugin ai-workbench/);
  assert.throws(() => mergeProfile({ ...PUB, MCP: [{ id: "k8s" }] }, { MCP: [{ id: "k8s" }] }), /MCP server k8s/);
  assert.throws(() => mergeProfile(PUB, { PLUGINS: { marketplaces: { cpo: { repo: "https://evil/cpo.git" } } } }), /marketplace cpo/);
  const m = mergeProfile(PUB, { settings: () => [["gateway.bind", "lan"]] });
  assert.throws(() => m.settings({}), /gateway\.bind/);
});

test("a marketplace with no base plugins in use is not cloned", () => {
  const args = { settings: [], pluginsRoot: root, projectRoot: root, env: {}, ownState: () => ({ present: true, missing: [], optional: [] }),
    marketplaceDir: () => ({ present: false, dir: "/m" }) };
  const none = buildPlan({ ...args, plugins: PUB.PLUGINS });
  assert.equal(none.filter((s) => s.kind === "marketplace").length, 0);
  const some = buildPlan({ ...args, plugins: { ...PUB.PLUGINS, bases: [{ id: "sp", marketplace: "cpo" }] } });
  assert.equal(some.filter((s) => s.kind === "marketplace").length, 1);
});

test("MCP from the repository: task settings from the profile; without TASKS, skip", () => {
  const mcp = [{ id: "scheduled-tasks", kind: "project", root: "project", entry: "mcp/st/server.mjs", needs: "TASKS" }];
  const base = { mcp, env: {}, stateDir: "/s", nodePath: "/n/node", which: () => true, present: () => true, projectRoot: "/p" };
  assert.match(mcpSteps(base)[0].reason, /profile defines no/);
  const [step] = mcpSteps({ ...base, tasks: { allow: ["report-*", "digest-*"], tz: "Europe/Istanbul" }, openclawBin: "/o/openclaw" });
  const server = JSON.parse(step.argv[3]);
  assert.deepEqual(server.args, [path.join("/p", "mcp", "st", "server.mjs")]);
  assert.equal(server.command, "/n/node");
  assert.deepEqual(server.env, { WORKBENCH_TASKS_ALLOW: "report-*,digest-*", WORKBENCH_TASKS_TZ: "Europe/Istanbul", OPENCLAW_BIN: "/o/openclaw" });
  assert.equal(mergeProfile(PUB, {}).TASKS, null);
});

test("projects → agents with a workspace; main and duplicates are refused", () => {
  const [s] = projectSteps([{ id: "sad", name: "Сад", dir: "/d/projects/sad" }]);
  assert.equal(s.id, "agents.entries.sad");
  assert.deepEqual(JSON.parse(s.argv[3]), { workspace: "/d/projects/sad", identity: { name: "Сад" } });
  assert.throws(() => projectSteps([{ id: "main", name: "M", dir: "/d" }]), /main is taken/);
  assert.throws(() => projectSteps([{ id: "a", name: "A", dir: "/1" }, { id: "a", name: "B", dir: "/2" }]), /two projects/);
  assert.throws(() => projectSteps([{ id: "Сад", name: "Сад", dir: "/d" }]), /kebab-case/);
  assert.equal(mergeProfile(PUB, {}).PROJECTS, null);
});

test("shared memory: main in the data repository folder, its memory/ searched by all agents", () => {
  const [ws, extra] = mainSteps({ dir: "/d/main" });
  assert.deepEqual(ws.argv, ["config", "set", "agents.entries.main.workspace", '"/d/main"', "--strict-json"]);
  assert.deepEqual(JSON.parse(extra.argv[3]), [path.join("/d/main", "memory")]);
  assert.equal(mergeProfile(PUB, {}).MAIN, null);
});

test("uninstall manifest: the previous value comes from the first install; a re-run does not overwrite it", () => {
  const plan = [{ kind: "config", id: "gateway.mode" }, { kind: "own", id: "plugin-b" }, { kind: "skip", id: "x" }, { kind: "base", id: "superpowers" }];
  const t = touchedBy(plan);
  assert.deepEqual(t.plugins, ["plugin-b", "superpowers"]);
  assert.deepEqual(t.config, ["gateway.mode", "plugins.entries.plugin-b", "plugins.entries.superpowers"]);
  const first = mergeManifest(null, { config: { "gateway.mode": { value: "remote" } }, plugins: { "plugin-b": { installed: false } } }, { now: "t1" });
  // The second run sees our own value, which must not become the "previous" one.
  const again = mergeManifest(first, { config: { "gateway.mode": { value: "local" }, "mcp.servers.k": { absent: true } }, plugins: { "plugin-b": { installed: true } } }, { now: "t2" });
  assert.deepEqual(again.config["gateway.mode"], { value: "remote" });
  assert.deepEqual(again.config["mcp.servers.k"], { absent: true });
  assert.deepEqual(again.plugins["plugin-b"], { installed: false });
  assert.equal(again.createdAt, "t1");
  assert.equal(again.updatedAt, "t2");
  assert.equal(first.config["mcp.servers.k"], undefined);
});

test("previous key state: value, absent, and an error on unclear output", () => {
  assert.deepEqual(configBefore(0, '"local"\n'), { value: "local" });
  assert.deepEqual(configBefore(0, '{"a":1}'), { value: { a: 1 } });
  assert.deepEqual(configBefore(1, "Config path is valid but unset: agents.defaults.model."), { absent: true });
  assert.deepEqual(configBefore(1, "Config path not found: nope.key. Nothing was changed."), { absent: true });
  assert.throws(() => configBefore(1, "Gateway not reachable"), /config get/);
  assert.throws(() => configBefore(0, "not json"), /not JSON/);
});

test("uninstall plan: our plugins get uninstall, others are left; keys get the previous value or unset, nested first", () => {
  const manifest = { config: { "agents.entries.main": { absent: true }, "agents.entries.main.workspace": { absent: true },
    "gateway.mode": { value: "remote" } }, plugins: { "plugin-b": { installed: false }, mine: { installed: true } } };
  const steps = uninstallPlan(manifest, { workbenchDir: "/s/workbench" });
  assert.deepEqual(steps.map((s) => `${s.kind} ${s.id}`), [
    "plugin-uninstall plugin-b", "keep mine",
    "config-unset agents.entries.main.workspace", "config-unset agents.entries.main", "config-restore gateway.mode",
    "remove-dir /s/workbench", "check config validate"]);
  assert.deepEqual(steps.find((s) => s.id === "gateway.mode").argv, ["config", "set", "gateway.mode", '"remote"', "--strict-json"]);
  assert.deepEqual(staleVersions(["1.0.0", "1.2.0"], "1.2.0"), ["1.0.0"]);
  // The uninstall plan is shown in full, every step kind with a label (Docker 04.11.2026 crashed here).
  const shown = formatPlan(steps);
  for (const s of steps) assert.ok(shown.includes(s.id), s.id);
  assert.doesNotMatch(shown, /undefined/);
  assert.match(shown, /remove plugin\s+plugin-b/);
  assert.match(shown, /keep plugin\s+mine — plugin was installed before ai-workbench/);
});

test("uninstall keeps project agents and gateway.mode with a reason; removes main and the rest", () => {
  const manifest = { config: { "agents.entries.sad": { absent: true }, "agents.entries.main.workspace": { absent: true },
    "gateway.mode": { absent: true }, "gateway.port": { absent: true }, "agents.entries.main": { absent: true } }, plugins: {} };
  const steps = uninstallPlan(manifest, { workbenchDir: "/w" });
  const kind = Object.fromEntries(steps.map((s) => [s.id, s.kind]));
  assert.equal(kind["agents.entries.sad"], "keep-config");
  assert.match(steps.find((s) => s.id === "agents.entries.sad").reason, /openclaw agents delete sad/);
  assert.equal(kind["gateway.mode"], "keep-config");
  assert.equal(kind["gateway.port"], "config-unset");
  assert.equal(kind["agents.entries.main"], "config-unset");
  assert.equal(kind["agents.entries.main.workspace"], "config-unset");
  // A value that existed before us is restored, even for kept classes.
  assert.equal(uninstallPlan({ config: { "gateway.mode": { value: "remote" } }, plugins: {} }, { workbenchDir: "/w" })[0].kind, "config-restore");
  assert.match(formatPlan(steps), /keep setting\s+gateway\.mode — the local Gateway does not start without it/);
});

const SHA = "fa4eb54397ee2faccb6940512a19c017cb1337f3";
test("marketplace with commit: fetch by sha, checkout, verify HEAD, and clone if there is no copy", () => {
  const m = { repo: "https://example.invalid/cpo.git", commit: SHA };
  const have = marketplaceSteps("cpo", m, { present: true, dir: "/m/cpo" });
  assert.deepEqual(have.map((s) => s.argv.slice(2, 4).join(" ")), [`fetch --depth`, "checkout --detach", "rev-parse HEAD"]);
  assert.deepEqual(have[0].argv, ["-C", "/m/cpo", "fetch", "--depth", "1", "origin", SHA]);
  assert.equal(have.at(-1).expect, SHA);
  assert.ok(have.every((s) => s.market === "cpo"));
  const fresh = marketplaceSteps("cpo", m, { present: false, dir: "/m/cpo" });
  assert.deepEqual(fresh[0].argv, ["clone", "--depth", "1", "--no-checkout", m.repo, "/m/cpo"]);
  assert.equal(fresh.length, 4);
  // The plan shows the commit; internal steps (checkout, verification) are hidden.
  const shown = formatPlan(fresh);
  assert.match(shown, new RegExp(`commit ${SHA}`));
  assert.doesNotMatch(shown, /verify HEAD|checkout/);
});

test("marketplace: short sha is refused; without commit, the branch tip with a warning", () => {
  assert.throws(() => marketplaceSteps("cpo", { repo: "r", commit: "fa4eb54" }, { present: true, dir: "/m" }), /40-character/);
  const [loose] = marketplaceSteps("cpo", { repo: "r" }, { present: true, dir: "/m" });
  assert.deepEqual(loose.argv.slice(2, 4), ["pull", "--ff-only"]);
  assert.match(loose.warn.join(), /not pinned/);
});

test("public build: the Anthropic marketplace is pinned to a full sha", () => {
  const m = REAL.PLUGINS.marketplaces["claude-plugins-official"];
  assert.match(m.commit, /^[0-9a-f]{40}$/);
});

test("profile from git: URL, folder named after the repository, refusal on a foreign origin or non-git", () => {
  assert.ok(isGitUrl("git@github.com:me/my-profile.git") && isGitUrl("https://x/y.git") && isGitUrl("file:///mnt/p"));
  assert.ok(!isGitUrl("~/src/my-profile") && !isGitUrl("/abs/dir"));
  assert.equal(profileTarget("git@github.com:me/my-profile.git", { pluginsRoot: "/h/P" }), path.join("/h/P", "my-profile"));
  assert.equal(profileTarget("https://github.com/me/prof/", { pluginsRoot: "/h/P" }), path.join("/h/P", "prof"));
  assert.equal(profileTarget("file:///mnt/p", { profileDir: "/x", pluginsRoot: "/h/P" }), "/x");
  const url = "git@github.com:me/prof.git";
  assert.deepEqual(profileSource(url, "/d", { exists: false }), { action: "clone", dir: "/d" });
  assert.equal(profileSource(url, "/d", { exists: true, isGit: false }).action, "refuse");
  assert.match(profileSource(url, "/d", { exists: true, isGit: true, origin: "git@github.com:other/prof.git" }).reason, /origin/);
  const use = profileSource(url, "/d", { exists: true, isGit: true, origin: "https://github.com/me/prof", dirty: 2, ahead: 0 });
  assert.equal(use.action, "use");
  assert.match(use.warn.join(), /uncommitted files: 2/);
});

test("profile hooks: none means symlink; ours means already linked; foreign is left alone", () => {
  const hooks = { "pre-commit": "tools/check-secrets.sh" };
  const hook = path.join("/p", ".git", "hooks", "pre-commit"), script = path.join("/p", "tools", "check-secrets.sh");
  const [fresh] = hookSteps("/p", hooks, { linkTarget: () => null, isGit: true });
  assert.deepEqual(fresh.link, { from: hook, to: script });
  assert.equal(hookSteps("/p", hooks, { linkTarget: () => script, isGit: true })[0].note, "already linked");
  assert.equal(hookSteps("/p", hooks, { linkTarget: () => "(file)", isGit: true })[0].kind, "skip");
  assert.deepEqual(hookSteps("/p", hooks, { linkTarget: () => null, isGit: false }), []);
  assert.throws(() => hookSteps("/p", { "../x": "a" }, { linkTarget: () => null, isGit: true }), /bad name/);
  assert.equal(mergeProfile(PUB, {}).GIT_HOOKS, null);
});

test("JetBrains agent: acp.json entry without IDE MCP; other entries and keys stay", () => {
  const file = "/h/.jetbrains/acp.json";
  const text = JSON.stringify({ default_mcp_settings: { use_idea_mcp: true }, agent_servers: { "Other": { command: "/x" } } });
  const [step] = ideSteps({ acpFile: file, ideDir: true, text, openclaw: { command: "/h/node", args: ["/h/oc/openclaw.mjs", "acp"] } });
  assert.equal(step.kind, "ide");
  assert.deepEqual(step.entry, { type: "custom", command: "/h/node", args: ["/h/oc/openclaw.mjs", "acp"], env: {}, use_custom_mcp: false, use_idea_mcp: false });
  const out = JSON.parse(applyAcp(text, step.name, step.entry));
  assert.deepEqual(out.agent_servers.Other, { command: "/x" });
  assert.deepEqual(out.default_mcp_settings, { use_idea_mcp: true });
  assert.deepEqual(out.agent_servers[ACP_AGENT], step.entry);
  // Re-run: the entry is already the same, nothing to write.
  const [again] = ideSteps({ acpFile: file, ideDir: true, text: JSON.stringify(out), openclaw: { command: "/h/node", args: ["/h/oc/openclaw.mjs", "acp"] } });
  assert.equal(again.entry, undefined);
  assert.match(formatPlan([again]), /IDE agent\s+JetBrains OpenClaw\s+already registered/);
  // No file yet: it is created; removing leaves the other entries.
  assert.deepEqual(JSON.parse(applyAcp("", ACP_AGENT, acpEntry({ command: "/n", args: ["/s", "acp"] }))).agent_servers[ACP_AGENT].args, ["/s", "acp"]);
  assert.deepEqual(JSON.parse(applyAcp(JSON.stringify(out), ACP_AGENT, null)).agent_servers, { Other: { command: "/x" } });
});

test("JetBrains agent: skip without IDE, without an openclaw path, or on an unparseable file; replacement warns", () => {
  const f = "/h/.jetbrains/acp.json";
  assert.match(ideSteps({ acpFile: f, ideDir: false, text: "", openclaw: { command: "/n", args: ["/s", "acp"] } })[0].reason, /has not been run/);
  assert.match(ideSteps({ acpFile: f, ideDir: true, text: "", openclaw: null })[0].reason, /manually/);
  assert.match(ideSteps({ acpFile: f, ideDir: true, text: "{ broken", openclaw: { command: "/n", args: ["/s", "acp"] } })[0].reason, /does not parse/);
  assert.match(ideSteps({ acpFile: f, ideDir: true, text: "[]", openclaw: { command: "/n", args: ["/s", "acp"] } })[0].reason, /not an object/);
  const [s] = ideSteps({ acpFile: f, ideDir: true, text: JSON.stringify({ agent_servers: { [ACP_AGENT]: { command: "/old" } } }), openclaw: { command: "/n", args: ["/s", "acp"] } });
  assert.equal(s.warn.length, 1);
});

test("manifest and IDE agent uninstall: absent before means remove, present means restore", () => {
  const m = mergeManifest(null, { config: {}, plugins: {}, ide: { "/h/.jetbrains/acp.json#OpenClaw": { absent: true } } }, { now: "t1" });
  const again = mergeManifest(m, { config: {}, plugins: {}, ide: { "/h/.jetbrains/acp.json#OpenClaw": { value: { command: "/ours" } } } }, { now: "t2" });
  assert.deepEqual(again.ide["/h/.jetbrains/acp.json#OpenClaw"], { absent: true });
  // An old manifest version has no ide field.
  assert.deepEqual(mergeManifest({ config: {}, plugins: {} }, { config: {}, plugins: {} }, { now: "t" }).ide, {});
  const steps = uninstallPlan({ config: {}, plugins: {}, ide: { "/h/.jetbrains/acp.json#OpenClaw": { absent: true },
    "/g/acp.json#OpenClaw": { value: { command: "/old" } } } }, { workbenchDir: "/w" });
  const rm = steps.find((s) => s.kind === "ide-remove"), back = steps.find((s) => s.kind === "ide-restore");
  assert.deepEqual([rm.file, rm.name, rm.entry], ["/h/.jetbrains/acp.json", "OpenClaw", null]);
  assert.deepEqual(back.entry, { command: "/old" });
  assert.match(formatPlan(steps), /remove IDE agent\s+OpenClaw in \/h\/\.jetbrains\/acp\.json/);
  assert.equal(uninstallPlan({ config: {}, plugins: {} }, { workbenchDir: "/w" }).some((s) => s.kind.startsWith("ide")), false);
});

test("one skill name in two plugins: a collision only with different content; the version is the first installed or the current link", () => {
  const skills = {
    "plugin-a": [{ name: "shared", dir: "/p/a/skills/shared", sha: "1" }, { name: "same", dir: "/p/a/skills/same", sha: "s" }],
    "plugin-b": [{ name: "shared", dir: "/p/b/skills/shared", sha: "2" }, { name: "same", dir: "/p/b/skills/same", sha: "s" }],
    "plugin-c": null,
  };
  const [c, ...rest] = skillCollisions(skills);
  assert.equal(rest.length, 0);
  assert.equal(c.id, "shared");
  assert.match(c.note, /plugin-a, plugin-b: agents get the plugin-a version \(installed first\)/);
  const [now] = skillCollisions(skills, (n) => (n === "shared" ? "/p/b/skills/shared" : null));
  assert.match(now.note, /plugin-b version$/);
  assert.match(formatPlan([c]), /duplicate skill name\s+shared/);
  const [fork] = skillCollisions(skills, () => null, { namespaced: true });
  assert.match(fork.note, /available as plugin-a:shared, plugin-b:shared/);
});

test("project skill: link in the workspace to the plugin version; a foreign file is left alone", () => {
  const skills = { "plugin-a": [{ name: "shared", dir: "/p/a/skills/shared", sha: "1" }], "plugin-c": null };
  const projects = [
    { id: "sad", dir: "/w/sad", skills: { shared: "plugin-a" } },
    { id: "dom", dir: "/w/dom", skills: { shared: "plugin-a", nope: "plugin-a", x: "plugin-z", y: "plugin-c" } },
    { id: "ogorod", dir: "/w/ogorod" },
  ];
  const at = { "/w/sad/skills/shared": null, "/w/dom/skills/shared": "(file)" };
  const steps = skillLinkSteps(projects, skills, { linkTarget: (p) => at[p] ?? null });
  const k = Object.fromEntries(steps.map((s) => [s.id, s]));
  assert.deepEqual(k["sad: shared ← plugin-a"].link, { from: path.join("/w/sad", "skills", "shared"), to: "/p/a/skills/shared" });
  assert.equal(k["dom: shared ← plugin-a"].kind, "skip");
  assert.match(k["dom: nope ← plugin-a"].reason, /no skill nope/);
  assert.match(k["dom: x ← plugin-z"].reason, /not being installed/);
  assert.match(k["dom: y ← plugin-c"].reason, /next install/);
  assert.equal(steps.length, 6);
  // OpenClaw follows an outward link only if its target is in allowSymlinkTargets; earlier targets stay.
  const allow = steps.find((s) => s.id === "skills.load.allowSymlinkTargets");
  assert.deepEqual(JSON.parse(allow.argv[3]), ["/p/a/skills/shared"]);
  const kept = skillLinkSteps([projects[0]], skills, { linkTarget: () => null, allowed: ["/mine"] }).at(-1);
  assert.deepEqual(JSON.parse(kept.argv[3]), ["/mine", "/p/a/skills/shared"]);
  // Target already listed: the key is left alone.
  assert.equal(skillLinkSteps([projects[0]], skills, { linkTarget: () => null, allowed: ["/p/a/skills/shared"] }).length, 1);
  // Link already in place: nothing to write; an old link elsewhere is replaced.
  assert.equal(skillLinkSteps([projects[0]], skills, { linkTarget: () => "/p/a/skills/shared" })[0].link, undefined);
  assert.equal(skillLinkSteps([projects[0]], skills, { linkTarget: () => "/old" })[0].replace, true);
});

test("manifest: our skill links are removed on uninstall", () => {
  const m = mergeManifest(null, { config: {}, plugins: {}, links: { "/w/sad/skills/shared": "/p/a/skills/shared" } }, { now: "t" });
  const steps = uninstallPlan(m, { workbenchDir: "/w" });
  assert.deepEqual(steps.filter((s) => s.kind === "unlink").map((s) => [s.from, s.to]), [["/w/sad/skills/shared", "/p/a/skills/shared"]]);
  assert.match(formatPlan(steps), /remove link\s+\/w\/sad\/skills\/shared/);
});

test("how the IDE launches openclaw: env-node script via the adjacent Node; wrapper and binary as is", () => {
  const npm = { bin: "/n/bin/openclaw", real: "/n/lib/node_modules/openclaw/openclaw.mjs", firstLine: "#!/usr/bin/env node", execPath: "/usr/bin/node" };
  assert.deepEqual(acpLaunch({ ...npm, siblingNode: "/n/bin/node" }), { command: "/n/bin/node", args: [npm.real, "acp"] });
  assert.deepEqual(acpLaunch(npm), { command: "/usr/bin/node", args: [npm.real, "acp"] });
  // The install-cli.sh wrapper calls its own Node by absolute path, so it needs no PATH.
  const wrap = { bin: "/h/.openclaw/bin/openclaw", real: "/h/.openclaw/bin/openclaw", firstLine: "#!/usr/bin/env bash", execPath: "/usr/bin/node" };
  assert.deepEqual(acpLaunch(wrap), { command: "/h/.openclaw/bin/openclaw", args: ["acp"] });
  assert.deepEqual(acpLaunch({ ...wrap, firstLine: "\u007fELF" }).args, ["acp"]);
});

test("Claude CLI turns: unmanaged only with the fork package, background agents on managed turns", () => {
  const get = (env) => Object.fromEntries(REAL.settings({ home: "/h", sep: "/", env }));
  const plain = get({});
  assert.ok(!("plugins.entries.anthropic.config.managedTurns" in plain));
  assert.deepEqual(plain["plugins.entries.anthropic.config.managedNativeTools.default"], ["Agent", "Workflow"]);
  assert.equal(get({ WORKBENCH_OPENCLAW_PACKAGE: "/p/openclaw.tgz" })["plugins.entries.anthropic.config.managedTurns"], false);
});

test("default model: runtime and fallbacks only when set", () => {
  const get = (env) => Object.fromEntries(REAL.settings({ home: "/h", sep: "/", env }));
  const plain = get({});
  assert.deepEqual(plain["agents.defaults.model"], { primary: "openrouter/auto" });
  assert.ok(!Object.keys(plain).some((k) => k.includes("agentRuntime")));
  const cli = get({ WORKBENCH_DEFAULT_MODEL: "anthropic/model-x", WORKBENCH_DEFAULT_RUNTIME: "claude-cli", WORKBENCH_FALLBACK_MODELS: "a/one, b/two" });
  assert.deepEqual(cli["agents.defaults.model"], { primary: "anthropic/model-x", fallbacks: ["a/one", "b/two"] });
  assert.deepEqual(cli['agents.defaults.models["anthropic/model-x"].agentRuntime'], { id: "claude-cli" });
});

test("chats by project: project folder → agent, timer only on Linux with systemd", async () => {
  const { chatsProjectsStep, chatsTimerSteps, uninstallPlan, mergeManifest } = await import("../lib.mjs");
  const step = chatsProjectsStep([{ id: "alpha", name: "Alpha" }, { id: "beta", name: "Бета" }]);
  assert.equal(step.id, "plugins.entries.aiwb-claude-bridge.config.projects");
  assert.deepEqual(JSON.parse(step.argv[3]), { Alpha: "alpha", "Бета": "beta" });
  assert.deepEqual(JSON.parse(chatsProjectsStep([]).argv[3]), {});
  const args = { root: "/h/cd", systemctl: "/usr/bin/systemctl", unitDir: "/h/.config/systemd/user", node: "/n/node", script: "/r/c.mjs", pathDirs: ["/oc/bin", "/usr/bin"] };
  assert.deepEqual(chatsTimerSteps({ ...args, root: null, platform: "linux" }), []);
  const arch = chatsTimerSteps({ ...args, root: null, archive: { to: "/p/chats", secrets: ["/s/a.env", "/s/b env"], tz: "UTC" }, platform: "linux" })[0];
  assert.match(Object.values(arch.files)[0], /^ExecStart=\/n\/node \/r\/c\.mjs --to \/p\/chats --secrets \/s\/a\.env --secrets "\/s\/b env" --tz UTC$/m);
  const withCommit = chatsTimerSteps({ ...args, root: null, archive: { to: "/p/chats", commit: ["/p/chats", "/p/main"] }, platform: "linux" })[0];
  assert.match(Object.values(withCommit.files)[0], /^ExecStart=\/n\/node \/r\/c\.mjs --to \/p\/chats --commit \/p\/chats --commit \/p\/main$/m);
  assert.match(withCommit.note, /local commit of 2 folder/);
  assert.equal(chatsTimerSteps({ ...args, platform: "darwin" })[0].kind, "skip");
  assert.equal(chatsTimerSteps({ ...args, platform: "linux", systemctl: null })[0].kind, "skip");
  const [t] = chatsTimerSteps({ ...args, platform: "linux" });
  assert.equal(t.kind, "timer");
  const service = t.files["/h/.config/systemd/user/aiwb-claude-catalog.service"];
  assert.match(service, /^Environment=PATH=\/oc\/bin:\/usr\/bin$/m);
  assert.match(service, /^ExecStart=\/n\/node \/r\/c\.mjs --root \/h\/cd$/m);
  assert.match(t.files["/h/.config/systemd/user/aiwb-claude-catalog.timer"], /^OnUnitActiveSec=10min$/m);
  // Uninstall: remove our timer; keep one that existed before us.
  const files = Object.keys(t.files);
  const m = mergeManifest(null, { config: {}, plugins: {}, timers: { "aiwb-claude-catalog": { absent: true, files } } }, { now: "x" });
  assert.deepEqual(uninstallPlan(m, { workbenchDir: "/w" }).find((s) => s.kind === "timer-remove").files, files);
  const kept = mergeManifest(null, { config: {}, plugins: {}, timers: { "aiwb-claude-catalog": { existed: true } } }, { now: "x" });
  assert.ok(uninstallPlan(kept, { workbenchDir: "/w" }).some((s) => s.kind === "keep" && s.id === "timer aiwb-claude-catalog"));
});

test("agent run working directory is the Claude Desktop project folder; no folder means skip", async () => {
  const { chatsCwdSteps } = await import("../lib.mjs");
  const have = new Set(["/h/cd/Alpha", "/h/cd/_no_space"]);
  const steps = chatsCwdSteps({ projects: [{ id: "alpha", name: "Alpha" }, { id: "beta", name: "Бета" }], root: "/h/cd", exists: (d) => have.has(d) });
  assert.deepEqual(steps.map((s) => [s.kind, s.id]), [["config", "agents.entries.alpha.cwd"], ["skip", "agents.entries.beta.cwd"], ["config", "agents.entries.main.cwd"]]);
  assert.equal(JSON.parse(steps[0].argv[3]), "/h/cd/Alpha");
  assert.deepEqual(chatsCwdSteps({ projects: [{ id: "alpha", name: "Alpha" }], root: null, exists: () => true }), []);
});

test("Dreaming model: its own model and permission, through the agent runtime", () => {
  const get = (env) => Object.fromEntries(REAL.settings({ home: "/h", sep: "/", env }));
  assert.ok(!Object.keys(get({})).some((k) => k.includes("memory-core")));
  const d = get({ WORKBENCH_DEFAULT_MODEL: "anthropic/big", WORKBENCH_DEFAULT_RUNTIME: "claude-cli", WORKBENCH_DREAMING_MODEL: "anthropic/small" });
  assert.equal(d["plugins.entries.memory-core.config.dreaming.model"], "anthropic/small");
  assert.equal(d["plugins.entries.memory-core.subagent.allowModelOverride"], true);
  assert.deepEqual(d['agents.defaults.models["anthropic/small"].agentRuntime'], { id: "claude-cli" });
});

test("default agent name: the model family, not the id", () => {
  const get = (env) => Object.fromEntries(REAL.settings({ home: "/h", sep: "/", env }));
  assert.equal(get({ WORKBENCH_DEFAULT_MODEL: "anthropic/claude-opus-5-5" })["agents.entries.main.identity.name"], "Claude");
  assert.ok(!("agents.entries.main.identity.name" in get({})));
});

test("base plugins at the pinned commit are kept, others reinstalled", async () => {
  const { keepPinnedBases } = await import("../lib.mjs");
  const steps = [{ kind: "base", id: "a", market: "m", argv: ["x"] }, { kind: "base", id: "b", market: "m", argv: ["x"] }, { kind: "runtime", id: "c" }];
  const pins = { a: { url: "https://g/a", sha: "a".repeat(40) }, b: { url: "https://g/b", sha: "b".repeat(40) } };
  const out = keepPinnedBases(steps, { pinOf: (_m, id) => pins[id] || null, installedAt: (url) => url === "https://g/a" });
  assert.deepEqual(out.map((s) => s.kind), ["keep", "base", "runtime"]);
  assert.match(out[0].reason, /pinned commit aaaaaaa/);
});

test("MCP Apps: enabled or disabled only on request", () => {
  const get = (env) => Object.fromEntries(REAL.settings({ home: "/h", sep: "/", env }));
  assert.ok(!("mcp.apps.enabled" in get({})));
  assert.equal(get({ WORKBENCH_MCP_APPS: "1" })["mcp.apps.enabled"], true);
  assert.equal(get({ WORKBENCH_MCP_APPS: "0" })["mcp.apps.enabled"], false);
  assert.ok(!("mcp.apps.enabled" in get({ WORKBENCH_MCP_APPS: "yes" })));
});

test("backup: Git repository once, daily schedule each run; nothing without WORKBENCH_BACKUP", async () => {
  const { backupSteps } = await import("../lib.mjs");
  assert.deepEqual(backupSteps({ dir: "", exists: () => false }), []);
  const fresh = backupSteps({ dir: "/b", exists: () => false });
  assert.deepEqual(fresh.map((s) => s.kind), ["backup", "backup-schedule"]);
  assert.deepEqual(fresh[0].argv, ["backup", "git", "init", "--repository", "/b"]);
  assert.deepEqual(fresh[1].argv, ["backup", "enable", "--repository", "/b", "--every", "24h"]);
  assert.deepEqual(backupSteps({ dir: "/b", exists: (p) => p === "/b/.git" }).map((s) => s.kind), ["backup-schedule"]);
});

test("GPU embeddings: device from vulkaninfo; skip without the one-time setup", async () => {
  const { parseVulkanDevices, pickVulkanDevice, gpuEmbeddingsSteps } = await import("../lib.mjs");
  const devices = parseVulkanDevices("Devices:\n========\nGPU0:\n\tdeviceType         = PHYSICAL_DEVICE_TYPE_INTEGRATED_GPU\n\tdeviceName         = Intel(R) UHD\nGPU1:\n\tdeviceType         = PHYSICAL_DEVICE_TYPE_DISCRETE_GPU\n\tdeviceName         = NVIDIA Card X\n");
  assert.deepEqual(devices.map((d) => [d.index, d.name]), [[0, "Intel(R) UHD"], [1, "NVIDIA Card X"]]);
  assert.equal(pickVulkanDevice(devices).index, 1);
  assert.equal(pickVulkanDevice(devices, "0").index, 0);
  assert.equal(pickVulkanDevice(devices, "5"), null);
  const build = { tag: "b1", asset: "a-vulkan.tar.gz", sha256: "abc", binary: "a/llama-server" };
  const base = { managedCommand: "/cpu/llama-server", workbenchDir: "/w", build, devices, platform: "linux" };
  assert.deepEqual(gpuEmbeddingsSteps({ ...base, mode: "cpu" }), []);
  assert.equal(gpuEmbeddingsSteps({ ...base, mode: "vulkan", managedCommand: undefined })[0].kind, "skip");
  assert.equal(gpuEmbeddingsSteps({ ...base, mode: "vulkan", devices: [] })[0].kind, "skip");
  const s = gpuEmbeddingsSteps({ ...base, mode: "vulkan" });
  assert.deepEqual(s.map((x) => x.kind), ["llama-download", "config", "config"]);
  assert.equal(s[0].bin, "/w/llama.cpp/b1-vulkan/a/llama-server");
  assert.equal(s[0].url, "https://github.com/ggml-org/llama.cpp/releases/download/b1/a-vulkan.tar.gz");
  assert.equal(JSON.parse(s[1].argv[3]), "/w/llama.cpp/b1-vulkan/a/llama-server");
  assert.deepEqual(JSON.parse(s[2].argv[3]), { GGML_VK_VISIBLE_DEVICES: "1" });
});

test("fork presets: env.vars settings of the fork; without the fork or with an unknown name, a skip", async () => {
  const { forkPresetSteps, uninstallPlan, mergeManifest } = await import("../lib.mjs");
  assert.deepEqual(forkPresetSteps("", { fork: true }), []);
  const fork = forkPresetSteps("worker-limits, catalog-owner", { fork: true });
  assert.ok(fork.every((s) => s.kind === "config"));
  assert.deepEqual(fork.map((s) => s.id), ["env.vars.OPENCLAW_WORKER_PENDING_TASKS", "env.vars.OPENCLAW_WORKER_PENDING_BYTES",
    "env.vars.OPENCLAW_WORKER_HEAP_MB", "env.vars.OPENCLAW_CATALOG_IMPORT_OWNER"]);
  assert.deepEqual(fork[3].argv, ["config", "set", "env.vars.OPENCLAW_CATALOG_IMPORT_OWNER", '"1"', "--strict-json"]);
  assert.equal(forkPresetSteps("nope", { fork: true })[0].kind, "skip");
  const plain = forkPresetSteps("worker-limits", { fork: false });
  assert.deepEqual(plain.map((s) => s.kind), ["skip"]);
  assert.match(plain[0].reason, /WORKBENCH_OPENCLAW_PACKAGE/);
  // The old key name still works, with a note to rename it.
  const legacy = forkPresetSteps("catalog-owner", { fork: true, legacy: true });
  assert.equal(legacy[0].kind, "skip");
  assert.match(legacy[0].reason, /WORKBENCH_FORK_PRESETS/);
  assert.equal(legacy[1].id, "env.vars.OPENCLAW_CATALOG_IMPORT_OWNER");
  // A manifest from the file-patch days: nothing is reverted any more.
  const m = mergeManifest({ version: 1, config: {}, plugins: {}, patches: ["worker-limits"] }, { config: {}, plugins: {} }, { now: "x" });
  assert.equal(m.patches, undefined);
  assert.ok(!uninstallPlan({ config: {}, plugins: {}, patches: ["worker-limits"] }, { workbenchDir: "/w" }).some((s) => /revert/.test(s.kind)));
});

test("Chrome extension host: installed if the browser has run; uninstall removes only ours", async () => {
  const { chromeHostSteps, chromeDataDirs, mergeManifest, uninstallPlan } = await import("../lib.mjs");
  const home = "/h";
  const dirs = chromeDataDirs("linux", home);
  assert.ok(dirs.includes("/h/.config/chromium"));
  const s = chromeHostSteps({ value: "", platform: "linux", home, exists: (d) => d === "/h/.config/chromium" });
  assert.deepEqual(s[0].argv, ["browser", "extension", "install", "--wait-ms", "1000"]);
  assert.equal(chromeHostSteps({ value: "", platform: "linux", home, exists: () => false })[0].kind, "skip");
  assert.deepEqual(chromeHostSteps({ value: "0", platform: "linux", home, exists: () => true }), []);
  assert.equal(chromeHostSteps({ value: "", platform: "win32", home, exists: () => true })[0].kind, "skip");
  const kinds = (chromeHost) => uninstallPlan(mergeManifest(null, { config: {}, plugins: {}, chromeHost }, { now: "x" }), { workbenchDir: "/w" }).map((x) => x.kind);
  assert.ok(kinds({ absent: true }).includes("chrome-host-remove"));
  assert.ok(!kinds({ existed: true }).includes("chrome-host-remove"));
  // A re-install does not overwrite "absent before us".
  const m = mergeManifest(mergeManifest(null, { config: {}, plugins: {}, chromeHost: { absent: true } }, { now: "x" }), { config: {}, plugins: {}, chromeHost: { existed: true } }, { now: "y" });
  assert.deepEqual(m.chromeHost, { absent: true });
});

test("shared memory: search over memory/, aiwb-memory plugin allowed to append to the prompt", async () => {
  const { mainSteps, sharedMemorySteps } = await import("../lib.mjs");
  const s = sharedMemorySteps({ dir: "/p/shared" });
  assert.deepEqual(s.map((x) => x.id), ["memory.search.extraPaths", "plugins.entries.aiwb-memory.config", "plugins.entries.aiwb-memory.hooks"]);
  assert.deepEqual(JSON.parse(s[0].argv[3]), ["/p/shared/memory"]);
  assert.deepEqual(JSON.parse(s[1].argv[3]), { dir: "/p/shared" });
  assert.deepEqual(JSON.parse(s[2].argv[3]), { allowConversationAccess: true, allowPromptInjection: true });
  // With a shared folder, main's memory/ search is not set: there is a single extraPaths list.
  assert.deepEqual(mainSteps({ dir: "/p/main", sharedSearch: false }).map((x) => x.id), ["agents.entries.main.workspace"]);
});

test(".env lines of an earlier install: only ours are removed and the manifest forgets them", async () => {
  const { removeEnvLines, mergeManifest, uninstallPlan } = await import("../lib.mjs");
  const text = "OPENCLAW_GATEWAY_TOKEN=x\nOPENCLAW_WORKER_HEAP_MB=8192\nOPENCLAW_WORKER_PENDING_TASKS=4096\n";
  assert.equal(removeEnvLines(text, ["OPENCLAW_WORKER_HEAP_MB", "OPENCLAW_WORKER_PENDING_TASKS"]), "OPENCLAW_GATEWAY_TOKEN=x\n");
  const old = { version: 1, config: {}, plugins: {}, env: ["OPENCLAW_WORKER_HEAP_MB"] };
  assert.deepEqual(uninstallPlan(old, { workbenchDir: "/w" }).find((s) => s.kind === "env-remove").keys, ["OPENCLAW_WORKER_HEAP_MB"]);
  assert.equal(mergeManifest(old, { config: {}, plugins: {}, dropEnv: true }, { now: "x" }).env, undefined);
});

// Renamed plugins: an install made with the old ids moves to the new ones (openclaw/workbench.config.mjs, PLUGIN_RENAMES).
const OWN_NEW = { judge: "/p/aiwb-plugins/judge", "aiwb-claude-bridge": "/p/aiwb-plugins/claude-bridge",
  "aiwb-memory": "/p/aiwb-plugins/shared-memory", "aiwb-fork-settings": "/p/aiwb-plugins/fork-settings", "aiwb-office": "/p/aiwb-plugins/office" };
const OLD_INSTALL = {
  entries: {
    "ai-workbench": { enabled: true },
    "aiwb-projects": { enabled: true, hooks: { allowConversationAccess: true, allowPromptInjection: true },
      config: { projects: { Garden: "main" }, order: ["Garden"], defaultFolder: "_x", memorySync: { enabled: true, secretsFiles: "__OPENCLAW_REDACTED__" } } },
    "aiwb-memory": { enabled: true, config: { dir: "/d/shared" } },
    "aiwb-settings": { enabled: true },
  },
  paths: ["/u/other-plugin", "/p/aiwb-plugins/ai-workbench", "/p/aiwb-plugins/projects", "/p/aiwb-plugins/memory", "/p/aiwb-plugins/settings", "/p/aiwb-plugins/office"],
  allow: ["other", "aiwb-projects", "aiwb-settings", "aiwb-office"],
};

test("renamed plugins: old entries, load paths and allow move to the new ids in one patch", async () => {
  const { pluginRenameSteps } = await import("../lib.mjs");
  const renames = REAL.PLUGIN_RENAMES;
  // The table matches the build: every new id is an own plugin of the public build at the new folder.
  for (const r of renames) assert.equal(REAL.PLUGINS.own.find((o) => o.id === r.to)?.dir, r.toDir);
  const steps = pluginRenameSteps({ renames, own: OWN_NEW, current: structuredClone(OLD_INSTALL) });
  // The old plugins are uninstalled first (install record, load path), tolerating one already gone;
  // aiwb-memory keeps its id: only its path changes.
  assert.deepEqual(steps.filter((s) => s.kind === "plugin-uninstall").map((s) => [s.id, s.tolerant, s.argv.join(" ")]),
    [["ai-workbench", true, "plugins uninstall ai-workbench --force"], ["aiwb-projects", true, "plugins uninstall aiwb-projects --force"],
      ["aiwb-settings", true, "plugins uninstall aiwb-settings --force"]]);
  const patchStep = steps.at(-1);
  assert.equal(patchStep.kind, "plugin-rename");
  assert.equal(steps.length, 4);
  const { plugins } = patchStep.patch;
  // Old entries are deleted (null in a merge patch), their keys carried over; a masked value is not carried but reported.
  assert.deepEqual(plugins.entries, {
    "ai-workbench": null, judge: { enabled: true },
    "aiwb-projects": null, "aiwb-claude-bridge": { enabled: true, hooks: { allowConversationAccess: true, allowPromptInjection: true },
      config: { projects: { Garden: "main" }, order: ["Garden"], defaultFolder: "_x" } },
    "aiwb-settings": null, "aiwb-fork-settings": { enabled: true },
  });
  assert.match(patchStep.warn.join("\n"), /plugins\.entries\.aiwb-projects\.config\.memorySync is masked/);
  // New folders in place of the old ones, order kept, nothing listed twice.
  assert.deepEqual(plugins.load.paths, ["/u/other-plugin", "/p/aiwb-plugins/judge", "/p/aiwb-plugins/claude-bridge",
    "/p/aiwb-plugins/shared-memory", "/p/aiwb-plugins/fork-settings", "/p/aiwb-plugins/office"]);
  assert.deepEqual(plugins.allow, ["other", "aiwb-claude-bridge", "aiwb-fork-settings", "aiwb-office"]);
  assert.equal("deny" in plugins, false);
  assert.match(formatPlan(steps), /renamed plugins +ai-workbench → judge, aiwb-projects → aiwb-claude-bridge, aiwb-memory: aiwb-plugins\/memory → aiwb-plugins\/shared-memory, aiwb-settings → aiwb-fork-settings/);
});

test("renamed plugins: only keys the new entry lacks; idempotent; nothing without the new plugin", async () => {
  const { pluginRenameSteps } = await import("../lib.mjs");
  const renames = REAL.PLUGIN_RENAMES;
  // The new entry already has some keys (an earlier partial run, or the user): those stay.
  const cur = structuredClone(OLD_INSTALL);
  cur.entries["aiwb-claude-bridge"] = { enabled: false, hooks: { allowConversationAccess: true }, config: { order: ["Mine"] } };
  cur.paths.push("/p/aiwb-plugins/claude-bridge/");
  const { plugins } = pluginRenameSteps({ renames, own: OWN_NEW, current: cur }).at(-1).patch;
  assert.deepEqual(plugins.entries["aiwb-claude-bridge"], { hooks: { allowPromptInjection: true }, config: { projects: { Garden: "main" }, defaultFolder: "_x" } });
  assert.equal(plugins.load.paths.filter((p) => p.includes("claude-bridge")).length, 1);
  // After the migration: the new state yields no steps (a re-run changes nothing).
  const after = { entries: { judge: { enabled: true }, "aiwb-claude-bridge": { enabled: true }, "aiwb-memory": { enabled: true }, "aiwb-fork-settings": { enabled: true } },
    paths: Object.values(OWN_NEW), allow: ["aiwb-claude-bridge"] };
  assert.deepEqual(pluginRenameSteps({ renames, own: OWN_NEW, current: after }), []);
  assert.deepEqual(pluginRenameSteps({ renames, own: OWN_NEW, current: { entries: {}, paths: undefined, allow: undefined, deny: undefined } }), []);
  // The plugins clone is not updated yet (no new folders): the old install is left as it is.
  assert.deepEqual(pluginRenameSteps({ renames, own: { "aiwb-office": "/p/aiwb-plugins/office" }, current: structuredClone(OLD_INSTALL) }), []);
  // Only one old id in deny, nothing else: just the list changes.
  const deny = pluginRenameSteps({ renames, own: OWN_NEW, current: { entries: {}, paths: [], deny: ["aiwb-settings"] } });
  assert.deepEqual(deny.map((s) => s.kind), ["plugin-rename"]);
  assert.deepEqual(deny[0].patch, { plugins: { deny: ["aiwb-fork-settings"] } });
  // An own plugin folder under another root (an earlier --plugins-root) moves too: one path per plugin id.
  const moved = pluginRenameSteps({ renames, own: OWN_NEW, current: { entries: {}, paths: ["/old/aiwb-plugins/projects", "/old/aiwb-plugins/office", "/p/aiwb-plugins/office"] } });
  assert.deepEqual(moved.at(-1).patch.plugins.load.paths, ["/p/aiwb-plugins/claude-bridge", "/p/aiwb-plugins/office"]);
  assert.match(moved.at(-1).id, /aiwb-plugins\/office: \/old\/aiwb-plugins\/office → \/p\/aiwb-plugins\/office/);
  // A Windows path to an old folder is recognized too.
  const win = pluginRenameSteps({ renames, own: { ...OWN_NEW, "aiwb-memory": "C:\\p\\aiwb-plugins\\shared-memory" }, current: { entries: {}, paths: ["C:\\p\\aiwb-plugins\\memory"] } });
  assert.deepEqual(win.at(-1).patch.plugins.load.paths, ["C:\\p\\aiwb-plugins\\shared-memory"]);
});

test("renamed plugins: an old manifest is read under the new ids; uninstall also clears the old ids", async () => {
  const { renameManifest } = await import("../lib.mjs");
  const renames = REAL.PLUGIN_RENAMES;
  const old = { version: 1, config: {
    "plugins.entries.aiwb-projects": { value: { enabled: true } },
    "plugins.entries.aiwb-projects.config.projects": { absent: true },
    "plugins.entries.aiwb-projects.hooks": { absent: true },
    "plugins.entries.aiwb-projects-extra": { absent: true },          // another plugin whose id only starts the same
    "plugins.entries.ai-workbench": { absent: true },
    "plugins.entries.judge": { value: { enabled: false } },            // already recorded for the new id: wins
    "plugins.entries.aiwb-memory.config": { absent: true },
  }, plugins: { "aiwb-projects": { installed: true }, "ai-workbench": { installed: false }, "aiwb-settings": { installed: false }, "aiwb-memory": { installed: false } } };
  const m = renameManifest(old, renames);
  assert.deepEqual(Object.keys(m.config).sort(), ["plugins.entries.aiwb-claude-bridge", "plugins.entries.aiwb-claude-bridge.config.projects",
    "plugins.entries.aiwb-claude-bridge.hooks", "plugins.entries.aiwb-memory.config", "plugins.entries.aiwb-projects-extra", "plugins.entries.judge"]);
  assert.deepEqual(m.config["plugins.entries.judge"], { value: { enabled: false } });
  assert.deepEqual(m.plugins, { "aiwb-claude-bridge": { installed: true }, judge: { installed: false }, "aiwb-fork-settings": { installed: false }, "aiwb-memory": { installed: false } });
  assert.deepEqual(renameManifest(m, renames), m);                    // idempotent
  assert.ok(old.plugins["aiwb-projects"]);                             // the input is not changed
  assert.equal(renameManifest(null, renames), null);

  const steps = uninstallPlan(old, { workbenchDir: "/w", renames });
  const ids = (kind) => steps.filter((s) => s.kind === kind).map((s) => s.id);
  // New ids are uninstalled; the bridge was there before ai-workbench (kept); leftovers under the old ids go, tolerantly.
  assert.deepEqual(ids("plugin-uninstall"), ["aiwb-memory", "judge", "aiwb-fork-settings", "ai-workbench", "aiwb-settings"]);
  assert.deepEqual(ids("keep"), ["aiwb-claude-bridge"]);
  assert.ok(steps.filter((s) => ["ai-workbench", "aiwb-settings", "plugins.entries.ai-workbench", "plugins.entries.aiwb-settings"].includes(s.id)).every((s) => s.tolerant));
  assert.ok(ids("config-unset").includes("plugins.entries.aiwb-claude-bridge.hooks"));
  assert.ok(!steps.some((s) => s.id === "aiwb-projects"));             // kept plugin: its old id is not removed either
  // Without renames the plan is as before.
  assert.ok(!uninstallPlan(old, { workbenchDir: "/w" }).some((s) => s.tolerant));
});

test("bridge adoption in the Gateway: the fork grants the bridge exactly its Gateway methods", async () => {
  const { bridgeAdoptionSteps } = await import("../lib.mjs");
  assert.deepEqual(bridgeAdoptionSteps({ fork: false }), []);
  const [step] = bridgeAdoptionSteps({ fork: true });
  assert.equal(step.id, "env.vars.OPENCLAW_PLUGIN_GATEWAY_METHODS");
  assert.deepEqual(step.argv.slice(0, 3), ["config", "set", "env.vars.OPENCLAW_PLUGIN_GATEWAY_METHODS"]);
  assert.equal(JSON.parse(step.argv[3]), "aiwb-claude-bridge=sessions.catalog.list,sessions.catalog.import,sessions.patch,session.visibility.set,sessions.list");
  const memory = bridgeAdoptionSteps({ fork: true })[1];
  assert.deepEqual(memory.argv, ["config", "set", "env.vars.OPENCLAW_MEMORY_INDEX_ON_START", "\"1\"", "--strict-json"]);
  assert.equal(bridgeAdoptionSteps({ fork: true }).length, 5);
  assert.equal(bridgeAdoptionSteps({ fork: true })[2].id, "env.vars.OPENCLAW_SESSION_OBSERVER_MIN_INTERVAL_MS");
  // Restarts wait up to 30 minutes for running agent turns (a string, as the fork reads env.vars).
  const wait = bridgeAdoptionSteps({ fork: true })[4];
  assert.deepEqual(wait.argv, ["config", "set", "env.vars.OPENCLAW_RESTART_AGENT_RUN_WAIT_MS", "\"1800000\"", "--strict-json"]);
  assert.equal(bridgeAdoptionSteps({ fork: true, chrome: true })[5].id, "env.vars.OPENCLAW_CLAUDE_CHROME");
});

test("fork env.vars settings: one batch write at the front of the plan, recorded key by key", async () => {
  const { batchEnvVarSteps, bridgeAdoptionSteps, forkPresetSteps } = await import("../lib.mjs");
  const plugin = { kind: "own", id: "aiwb-claude-bridge", dir: "/p", argv: ["plugins", "install", "--link", "/p"] };
  const other = { kind: "config", id: "plugins.entries.aiwb-memory.config", argv: ["config", "set", "plugins.entries.aiwb-memory.config", "{}", "--strict-json"] };
  const plan = [...forkPresetSteps("worker-limits", { fork: true }), plugin, ...bridgeAdoptionSteps({ fork: true }), other,
    { kind: "check", id: "config validate", argv: ["config", "validate"] }];
  const batched = batchEnvVarSteps(plan);
  const [batch, ...rest] = batched;
  assert.equal(batch.kind, "config-batch");
  assert.deepEqual(batch.argv.slice(0, 3), ["config", "set", "--batch-json"]);
  const ops = JSON.parse(batch.argv[3]);
  assert.deepEqual(ops.map((o) => o.path), batch.keys);
  assert.deepEqual(batch.keys, ["env.vars.OPENCLAW_WORKER_PENDING_TASKS", "env.vars.OPENCLAW_WORKER_PENDING_BYTES", "env.vars.OPENCLAW_WORKER_HEAP_MB",
    "env.vars.OPENCLAW_PLUGIN_GATEWAY_METHODS", "env.vars.OPENCLAW_MEMORY_INDEX_ON_START",
    "env.vars.OPENCLAW_SESSION_OBSERVER_MIN_INTERVAL_MS", "env.vars.OPENCLAW_ACTIVITY_RECAP_MIN_INTERVAL_MS",
    "env.vars.OPENCLAW_RESTART_AGENT_RUN_WAIT_MS"]);
  assert.equal(ops.find((o) => o.path === "env.vars.OPENCLAW_RESTART_AGENT_RUN_WAIT_MS").value, "1800000");
  // Values stay the JSON values of the single writes (strings), not re-encoded.
  assert.deepEqual(ops.find((o) => o.path === "env.vars.OPENCLAW_ACTIVITY_RECAP_MIN_INTERVAL_MS").value, "600000");
  assert.deepEqual(ops.find((o) => o.path === "env.vars.OPENCLAW_MEMORY_INDEX_ON_START").value, "1");
  // Other steps keep their order; no single env.vars write is left.
  assert.deepEqual(rest, [plugin, other, plan.at(-1)]);
  // The uninstall manifest still records every key.
  assert.deepEqual(touchedBy(batched).config, touchedBy(plan).config);
  assert.match(formatPlan([batch]), /settings, one write\s+OPENCLAW_WORKER_PENDING_TASKS, .*OPENCLAW_RESTART_AGENT_RUN_WAIT_MS {2}env\.vars/);
  // Without the fork there is nothing to batch: the plan is unchanged.
  const official = [plugin, other];
  assert.equal(batchEnvVarSteps(official), official);
});

test("bridge hooks step sets only its own key: a carried allowPromptInjection survives a re-install", async () => {
  const { projectsHooksStep } = await import("../lib.mjs");
  const step = projectsHooksStep();
  assert.equal(step.id, "plugins.entries.aiwb-claude-bridge.hooks.allowConversationAccess");
  assert.deepEqual(step.argv, ["config", "set", "plugins.entries.aiwb-claude-bridge.hooks.allowConversationAccess", "true", "--strict-json"]);
});

test("Gateway stop timeout: with the fork, a drop-in lets systemd wait as long as the Gateway waits for turns", async () => {
  const { gatewayStopTimeoutSteps, gatewayStopTimeoutDropIn, RESTART_AGENT_RUN_WAIT_MS } = await import("../lib.mjs");
  const unitDir = "/h/.config/systemd/user";
  const unit = path.join(unitDir, "openclaw-gateway.service");
  const dropIn = path.join(unitDir, "openclaw-gateway.service.d", "aiwb-agent-turn-wait.conf");
  const args = { fork: true, platform: "linux", systemctl: "/usr/bin/systemctl", unitDir, exists: (f) => f === unit };
  const [write, reload] = gatewayStopTimeoutSteps(args);
  assert.equal(write.kind, "dropin");
  // 30 minutes of waiting plus 2 for the Gateway's own cleanup.
  assert.equal(RESTART_AGENT_RUN_WAIT_MS, 1_800_000);
  assert.equal(write.files[dropIn], gatewayStopTimeoutDropIn());
  assert.match(write.files[dropIn], /^\[Service\]\nTimeoutStopSec=1920\n$/m);
  assert.equal(write.note, "TimeoutStopSec=1920");
  assert.deepEqual(reload, { kind: "daemon-reload", id: "systemctl --user daemon-reload", exec: "systemctl", argv: ["--user", "daemon-reload"] });
  assert.match(formatPlan([write, reload]), /systemd drop-in\s+openclaw-gateway\.service\.d\/aiwb-agent-turn-wait\.conf {2}TimeoutStopSec=1920\n {2}systemd reload/);
  // Already in place: nothing to do, no reload.
  assert.deepEqual(gatewayStopTimeoutSteps({ ...args, read: (f) => (f === dropIn ? gatewayStopTimeoutDropIn() : null) }), []);
  // An older value is rewritten.
  assert.equal(gatewayStopTimeoutSteps({ ...args, read: () => "[Service]\nTimeoutStopSec=600\n" }).length, 2);
  // Not Linux, no systemctl, no service unit: a skip with a reason, nothing written.
  for (const other of [{ platform: "darwin" }, { systemctl: null }, { exists: () => false }]) {
    const steps = gatewayStopTimeoutSteps({ ...args, ...other });
    assert.deepEqual(steps.map((s) => s.kind), ["skip"]);
  }
});

test("Gateway stop timeout: the official OpenClaw and uninstall remove our drop-in", async () => {
  const { gatewayStopTimeoutSteps } = await import("../lib.mjs");
  const unitDir = "/h/.config/systemd/user";
  const dropIn = path.join(unitDir, "openclaw-gateway.service.d", "aiwb-agent-turn-wait.conf");
  const args = { fork: false, platform: "linux", systemctl: "/usr/bin/systemctl", unitDir };
  assert.deepEqual(gatewayStopTimeoutSteps({ ...args, exists: () => false }), []);
  const [remove, reload] = gatewayStopTimeoutSteps({ ...args, exists: (f) => f === dropIn });
  assert.deepEqual(remove, { kind: "dropin-remove", id: "openclaw-gateway.service.d/aiwb-agent-turn-wait.conf", files: [dropIn] });
  assert.equal(reload.kind, "daemon-reload");
  // Without systemctl the file still goes; there is no manager to reload.
  assert.deepEqual(gatewayStopTimeoutSteps({ ...args, systemctl: null, exists: (f) => f === dropIn }).map((s) => s.kind), ["dropin-remove"]);
});

test("running Gateway sessions: only status running counts, queued and finished ones do not", async () => {
  const { runningSessions } = await import("../lib.mjs");
  const result = { count: 4, sessions: [{ key: "agent:main:a", status: "running" }, { key: "agent:main:b", status: "queued" },
    { key: "agent:x:c", status: "done" }, { key: "agent:x:d", status: "running" }, { key: "agent:x:e" }] };
  assert.deepEqual(runningSessions(result), ["agent:main:a", "agent:x:d"]);
  assert.deepEqual(runningSessions({ sessions: [] }), []);
  assert.deepEqual(runningSessions(null), []);
});

test("upcoming automations: running or starting soon blocks a replacement; heartbeats and far runs do not", async () => {
  const { upcomingAutomations } = await import("../lib.mjs");
  const now = 1_000_000_000_000;
  const job = (name, state, extra = {}) => ({ name, enabled: true, payload: { kind: "agentTurn" }, state, ...extra });
  const result = { jobs: [
    job("soon", { nextRunAtMs: now + 5 * 60_000 }),
    job("later", { nextRunAtMs: now + 60 * 60_000 }),
    job("running", { runningAtMs: now - 1000, nextRunAtMs: now + 86_400_000 }),
    job("beat", { nextRunAtMs: now + 60_000 }, { payload: { kind: "heartbeat" } }),
    job("off", { nextRunAtMs: now + 60_000 }, { enabled: false }),
    job("due", { nextRunAtMs: now - 30_000 }),
  ] };
  assert.deepEqual(upcomingAutomations(result, now), ["soon (in 5 min)", "running (running)", "due (in 0 min)"]);
  assert.deepEqual(upcomingAutomations(null, now), []);
});

test("pluginUiSteps turns on Custom plugin UI only with a plugin that has a page", async () => {
  const { pluginUiSteps } = await import("../lib.mjs");
  assert.deepEqual(pluginUiSteps([{ id: "aiwb-memory" }]), []);
  const [step] = pluginUiSteps([{ id: "aiwb-memory" }, { id: "aiwb-fork-settings", ui: "Proxy" }]);
  assert.equal(step.id, "gateway.controlUi.experimental.customPlugins");
  assert.deepEqual(step.argv.slice(-2), ["true", "--strict-json"]);
  assert.equal(step.note, "Custom plugin UI (Proxy page)");
  // A profile plugin with its own page adds to the same single switch.
  const both = pluginUiSteps([{ id: "aiwb-fork-settings", ui: "Proxy" }, { id: "board", ui: "Board" }]);
  assert.equal(both.length, 1);
  assert.equal(both[0].note, "Custom plugin UI (Proxy, Board pages)");
});

test("network proxy: without hosts everything goes through it, as with HTTPS_PROXY; URL never in the plan", async () => {
  const { proxySteps, batchEnvVarSteps, formatPlan, REDACTED_PROXY_URL } = await import("../lib.mjs");
  const url = "http://user:s3cret@127.0.0.1:3128";
  const steps = proxySteps({ url, fork: true });
  assert.deepEqual(steps.map((s) => s.id), ["proxy.proxyUrl", "env.vars.OPENCLAW_PROXY_ROUTES"]);
  assert.deepEqual(steps[0].argv, ["config", "set", "proxy.proxyUrl", JSON.stringify(url), "--strict-json"]);
  assert.equal(steps[0].secret, true);
  assert.equal(JSON.parse(steps[1].argv[3]), "");
  // The routes go into the one env.vars write; the URL stays a separate, redacted setting.
  const plan = batchEnvVarSteps(steps);
  assert.equal(plan[0].kind, "config-batch");
  assert.deepEqual(JSON.parse(plan[0].argv[3]), [{ path: "env.vars.OPENCLAW_PROXY_ROUTES", value: "" }]);
  const text = formatPlan(plan);
  assert.ok(text.includes(REDACTED_PROXY_URL));
  assert.ok(!text.includes("s3cret") && !text.includes("3128"), text);
});

test("network proxy: hosts, * and all, the full routes form, and no URL leaves the config alone", async () => {
  const { proxySteps } = await import("../lib.mjs");
  const url = "http://127.0.0.1:3128";
  const routesOf = (p) => { const s = proxySteps(p).find((x) => x.id === "env.vars.OPENCLAW_PROXY_ROUTES"); return s && JSON.parse(s.argv[3]); };
  assert.deepEqual(proxySteps({}), []);
  assert.deepEqual(proxySteps({ hosts: "openai.com", routes: "" }), []);
  assert.equal(routesOf({ url, hosts: " OpenAI.com, .chatgpt.com ", fork: true }), "openai.com,chatgpt.com=proxy;*=direct");
  // Everything through the proxy: an empty value clears earlier routes (the fork reads blank as unset).
  assert.equal(routesOf({ url, hosts: "*", fork: true }), "");
  assert.equal(routesOf({ url, hosts: "ALL", fork: true }), "");
  // Full form wins; a URL in a rule becomes proxy.proxyUrl and `proxy` in the routes.
  const full = proxySteps({ url: "", hosts: "x.com", routes: `api.example.com,example.org=${url};*=direct`, fork: true });
  assert.equal(JSON.parse(full[0].argv[3]), url);
  assert.equal(JSON.parse(full[1].argv[3]), "api.example.com,example.org=proxy;*=direct");
  assert.equal(JSON.stringify(full.map((s) => s.note)).includes("3128"), false);
  assert.equal(routesOf({ url, routes: "*=proxy;intranet.example=direct", fork: true }), "*=proxy;intranet.example=direct");
  // Without the fork: only proxy.proxyUrl; per-host routes cannot apply, so a host list gets a warning.
  const official = proxySteps({ url, hosts: "api.example.com", fork: false });
  assert.deepEqual(official.map((s) => s.id), ["proxy.proxyUrl"]);
  assert.match(official[0].warn[0], /fork/);
  assert.deepEqual(proxySteps({ url, fork: false }).map((s) => s.warn), [undefined]);
  assert.deepEqual(proxySteps({ url, hosts: "*", fork: false }).map((s) => s.warn), [undefined]);
});

test("network proxy: invalid input is skipped with a reason that does not show the URL", async () => {
  const { proxySteps } = await import("../lib.mjs");
  const secret = "http://u:pw0rd@10.0.0.1:8080";
  for (const p of [
    { url: "socks5://127.0.0.1:1080" },
    { url: secret, hosts: "api.anthropic.com/v1" },
    { routes: `a.com=${secret};b.com=http://10.0.0.2:8080` },
    { url: "http://127.0.0.1:1", routes: `a.com=${secret}` },
    { routes: "a.com=proxy" },
    { routes: "a.com=direct" },
    { routes: `a.com=${secret};*=maybe` },
    { routes: "*=proxy;*=direct", url: secret },
  ]) {
    const steps = proxySteps({ ...p, fork: true });
    assert.equal(steps.length, 1, JSON.stringify(p));
    assert.equal(steps[0].kind, "skip");
    assert.ok(!steps[0].reason.includes("pw0rd") && !steps[0].reason.includes("10.0.0"), steps[0].reason);
  }
});

test("manifest: a masked secret is recorded as masked and kept on uninstall", async () => {
  const { configBefore, uninstallPlan } = await import("../lib.mjs");
  assert.deepEqual(configBefore(0, '"__OPENCLAW_REDACTED__"\n'), { masked: true });
  const plan = uninstallPlan({ config: { "proxy.proxyUrl": { masked: true }, "env.vars.OPENCLAW_PROXY_ROUTES": { absent: true } }, plugins: {} }, { workbenchDir: "/w" });
  assert.equal(plan.find((s) => s.id === "proxy.proxyUrl").kind, "keep-config");
  assert.equal(plan.find((s) => s.id === "env.vars.OPENCLAW_PROXY_ROUTES").kind, "config-unset");
});

test("Claude Code proxy: merges into settings env, records hashes, direct and uninstall remove only unchanged keys", async () => {
  const { claudeCodeProxySteps, applyClaudeEnv, mergeManifest, uninstallPlan, formatPlan, valueHash } = await import("../lib.mjs");
  const { mkdtempSync, readFileSync, writeFileSync } = await import("node:fs");
  const os = await import("node:os");
  const home = mkdtempSync(path.join(os.tmpdir(), "aiwb-claude-home-"));
  const file = path.join(home, ".claude", "settings.json");
  const url = "http://user:pw@127.0.0.1:3128";
  assert.deepEqual(claudeCodeProxySteps({ value: "", file, text: null }), []);
  assert.equal(claudeCodeProxySteps({ value: "ftp://x", file, text: null })[0].kind, "skip");
  assert.equal(claudeCodeProxySteps({ value: url, file, text: "{oops" })[0].kind, "skip");

  const before = JSON.stringify({ model: "opus", env: { FOO: "1" }, permissions: { allow: ["Bash(ls)"] } }, null, 2);
  const [step] = claudeCodeProxySteps({ value: url, file, text: before });
  assert.equal(step.kind, "claude-env");
  assert.ok(!formatPlan([step]).includes("pw@") && !formatPlan([step]).includes("3128"));
  assert.deepEqual(step.recorded, { HTTPS_PROXY: valueHash(url), HTTP_PROXY: valueHash(url), NO_PROXY: valueHash("localhost,127.0.0.1,::1") });
  assert.ok(!JSON.stringify(step.recorded).includes("3128"));
  const after = applyClaudeEnv(before, step);
  const json = JSON.parse(after);
  assert.deepEqual(json.env, { FOO: "1", HTTPS_PROXY: url, HTTP_PROXY: url, NO_PROXY: "localhost,127.0.0.1,::1" });
  assert.deepEqual([json.model, json.permissions], ["opus", { allow: ["Bash(ls)"] }]);
  // A re-run with the same value and record is a no-op.
  assert.deepEqual(claudeCodeProxySteps({ value: url, file, text: after, recorded: step.recorded }), []);

  // Manifest keeps the hashes per file; the user then changes NO_PROXY by hand.
  const m = mergeManifest(null, { config: {}, plugins: {}, claudeEnv: { [file]: step.recorded } }, { now: "t" });
  assert.deepEqual(m.claudeEnv, { [file]: step.recorded });
  const edited = JSON.stringify({ ...json, env: { ...json.env, NO_PROXY: "localhost,corp.example" } });
  const [direct] = claudeCodeProxySteps({ value: "direct", file, text: edited, recorded: m.claudeEnv[file] });
  assert.deepEqual(direct.remove, ["HTTPS_PROXY", "HTTP_PROXY"]);
  assert.deepEqual(JSON.parse(applyClaudeEnv(edited, direct)).env, { FOO: "1", NO_PROXY: "localhost,corp.example" });
  assert.equal(mergeManifest(m, { config: {}, plugins: {}, claudeEnv: { [file]: direct.recorded } }, { now: "t" }).claudeEnv, undefined);

  // Uninstall: same rule, applied to the file on disk.
  writeFileSync(path.join(home, "s.json"), edited);
  const un = uninstallPlan(m, { workbenchDir: "/w" }).find((s) => s.kind === "claude-env");
  assert.equal(un.file, file);
  const out = JSON.parse(applyClaudeEnv(readFileSync(path.join(home, "s.json"), "utf8"), un));
  assert.deepEqual(out.env, { FOO: "1", NO_PROXY: "localhost,corp.example" });
  // A file with only our keys loses the env block entirely.
  const only = applyClaudeEnv(null, step);
  assert.deepEqual(JSON.parse(applyClaudeEnv(only, un)), {});
});

test("bridge tree root: set from WORKBENCH_CLAUDE_DESKTOP_ROOT, nothing without it", async () => {
  const { bridgeRootSteps } = await import("../lib.mjs");
  assert.deepEqual(bridgeRootSteps(null), []);
  const [step] = bridgeRootSteps("/home/u/projects");
  assert.deepEqual(step.argv, ["config", "set", "plugins.entries.aiwb-claude-bridge.config.memorySync.root", "\"/home/u/projects\"", "--strict-json"]);
});

test("profile ENV: non-secret WORKBENCH_* values only; written into .env in place", async () => {
  const { profileEnv, setEnvLines, mergeProfile } = await import("../lib.mjs");
  assert.deepEqual(profileEnv({ WORKBENCH_PROXY_HOSTS: "api.example.com", WORKBENCH_CLAUDE_CHROME: 1 }).values,
    { WORKBENCH_PROXY_HOSTS: "api.example.com", WORKBENCH_CLAUDE_CHROME: "1" });
  for (const bad of ["OPENROUTER_API_KEY", "WORKBENCH_PROXY_URL", "WORKBENCH_CLAUDE_CODE_PROXY", "WORKBENCH_JUDGE_API_KEY",
    "WORKBENCH_OPENCLAW_PACKAGE_SHA256", "WORKBENCH_PLUGINS_ROOT", "WORKBENCH_PROFILE"]) {
    assert.ok(profileEnv({ [bad]: "x" }).error, bad);
  }
  assert.equal(setEnvLines("A=1\nWORKBENCH_X=old\n", { WORKBENCH_X: "new", WORKBENCH_Y: "y" }), "A=1\nWORKBENCH_X=new\nWORKBENCH_Y=y\n");
  assert.equal(setEnvLines("A=1", { WORKBENCH_Y: "$1 y" }), "A=1\nWORKBENCH_Y=$1 y\n");
  assert.deepEqual(mergeProfile({ REPOS: [], PLUGINS: { own: [], marketplaces: {}, bases: [], runtime: [] }, MCP: [], settings: () => [] },
    { ENV: { WORKBENCH_FORK_PRESETS: "worker-limits" } }).ENV, { WORKBENCH_FORK_PRESETS: "worker-limits" });
});

test("dictation: Groq first, then OpenAI and OpenRouter; an explicit model or none; an authored setting is kept", async () => {
  const { dictationSteps } = await import("../lib.mjs");
  const model = (steps) => steps.length ? JSON.parse(steps[0].argv[3])[0] : null;
  assert.deepEqual(model(dictationSteps({ GROQ_API_KEY: "k", OPENROUTER_API_KEY: "k" }, undefined)),
    { provider: "groq", model: "whisper-large-v3-turbo", capabilities: ["audio"] });
  assert.equal(model(dictationSteps({ OPENROUTER_API_KEY: "k" }, undefined)).provider, "openrouter");
  assert.deepEqual(model(dictationSteps({ WORKBENCH_DICTATION_MODEL: "openai/gpt-4o-transcribe" }, undefined)),
    { provider: "openai", model: "gpt-4o-transcribe", capabilities: ["audio"] });
  assert.deepEqual(dictationSteps({ GROQ_API_KEY: "k", WORKBENCH_DICTATION_MODEL: "none" }, undefined), []);
  assert.deepEqual(dictationSteps({ GROQ_API_KEY: "k" }, [{ provider: "deepgram", model: "nova-3" }]), []);
  assert.deepEqual(dictationSteps({}, undefined), []);
  assert.equal(dictationSteps({ GROQ_API_KEY: "k" }, undefined)[1].id, "tools.media.audio.enabled");
});

test("default model: providers outside the built-in catalog are refreshed before the model is written", async () => {
  const { modelProvidersToRefresh } = await import("../lib.mjs");
  const step = (value) => ({ kind: "config", id: "agents.defaults.model", argv: ["config", "set", "agents.defaults.model", JSON.stringify(value), "--strict-json"] });
  assert.deepEqual(modelProvidersToRefresh(step({ primary: "groq/openai/gpt-oss-120b", fallbacks: ["openrouter/auto", "google/gemini-x"] })), ["groq", "google"]);
  assert.deepEqual(modelProvidersToRefresh(step({ primary: "anthropic/claude-opus-5-5" })), []);
  assert.deepEqual(modelProvidersToRefresh({ kind: "config", id: "gateway.port", argv: [] }), []);
});
