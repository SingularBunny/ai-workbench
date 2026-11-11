#!/usr/bin/env bash
# Pre-commit gate. Three outcomes:
#   0 — green; 2 — yellow: a check cannot run on this machine, the reason is printed,
#   the commit goes through; 1 — red: something is broken, the commit is blocked.
# Deliberately without set -e: one failed check does not hide the results of the others.
#
#   tools/check.sh                 all checks
#   tools/check.sh --install-hook  install the pre-commit hook

cd "$(dirname "$0")/.." || exit 1

if [[ "$1" == "--install-hook" ]]; then
  git rev-parse --git-dir >/dev/null 2>&1 || { echo "not a git repository"; exit 1; }
  printf '#!/usr/bin/env bash\ntools/check.sh; rc=$?\n[ $rc -eq 1 ] && exit 1\nexit 0\n' > "$(git rev-parse --git-dir)/hooks/pre-commit"
  chmod +x "$(git rev-parse --git-dir)/hooks/pre-commit"
  echo "hook installed"; exit 0
fi

red=0; yellow=0
ok()   { echo "✅ $1"; }
fail() { echo -e "❌ $1"; red=1; }
warn() { echo "🟡 $1"; yellow=1; }
UVPY=(uv run --quiet --no-project --with pytest python)

if command -v node >/dev/null; then
  out=$(for f in installer/*.mjs openclaw/*.mjs migrate/*/*.mjs; do node --check "$f" || echo "syntax: $f"; done 2>&1)
  [[ -z "$out" ]] && ok "node --check of the installer and template" || fail "node --check:\n$out"
  out=$(node --test 'installer/test/*.test.mjs' 'migrate/test/*.test.mjs' 'migrate/*/test/*.test.mjs' 2>&1) && ok "node --test: $(echo "$out" | grep -E '^ℹ pass' | sed 's/ℹ //')" || fail "node --test:\n$(echo "$out" | grep -E '^(✖|ℹ fail)')"
  # Template: Gateway on loopback only, token as a ${…} reference, exact OpenClaw version.
  out=$(node --input-type=module -e '
    const m = await import("./openclaw/workbench.config.mjs");
    const s = new Map(m.settings({ home: "/h", sep: "/", env: { WORKBENCH_VM_SSH: "u@vm", WORKBENCH_OLLAMA_URL: "http://127.0.0.1:11434" } }));
    const bad = [];
    if (!/^\d+\.\d+\.\d+$/.test(m.OPENCLAW_VERSION)) bad.push("OpenClaw version is not exact: " + m.OPENCLAW_VERSION);
    if (s.get("gateway.bind") !== "loopback") bad.push("gateway.bind is not loopback");
    if (!/^\$\{[A-Z_]+\}$/.test(s.get("gateway.auth")?.token ?? "")) bad.push("Gateway token is not a ${…} reference");
    const text = JSON.stringify([...s]);
    if (/sk-[A-Za-z0-9]{8,}|sk-or-|AKIA[0-9A-Z]{12}/.test(text)) bad.push("template contains something that looks like a key");
    if (bad.length) { console.log(bad.join("\n")); process.exit(1); }' 2>&1) && ok "template: loopback, token by reference, exact version, no keys" || fail "template:\n$out"
  # Public build has nothing personal: the user's own plugins, repositories, bases, MCP and skills live in the profile.
  out=$(node --input-type=module -e '
    const m = await import("./openclaw/workbench.config.mjs");
    const bad = [];
    // Only the (public) ai-workbench plugins repository is built in; other repositories come from the profile.
    const P = m.PLUGINS_REPO;
    if (!/^https:\/\//.test(P?.repo ?? "")) bad.push("plugins repository is not https: " + P?.repo);
    for (const r of m.REPOS) if (r !== P) bad.push("repository other than the ai-workbench plugins: " + r.dir);
    const fromPlugins = (d) => d.startsWith(P.dir + "/");
    for (const o of m.PLUGINS.own) if (o.root !== "project" && !(o.root === undefined && fromPlugins(o.dir))) bad.push("plugin not from ai-workbench or its plugins repository: " + o.id);
    if (m.PLUGINS.bases.length) bad.push("bases: " + m.PLUGINS.bases.map((b) => b.id).join(", "));
    for (const x of m.MCP) if (x.root !== "project" && !(x.root === "plugins" && fromPlugins(x.entry))) bad.push("MCP not from ai-workbench or its plugins repository: " + x.id);
    const keys = m.settings({ home: "/h", sep: "/", env: {} }).map(([k]) => k);
    if (keys.some((k) => k.startsWith("skills."))) bad.push("skills are set in the template: " + keys.filter((k) => k.startsWith("skills.")));
    if (bad.length) { console.log(bad.join("\n")); process.exit(1); }' 2>&1) && ok "public build has nothing personal: own plugins and MCP from aiwb-plugins, the rest from the profile" || fail "public build:\n$out"
else
  fail "no node — installer not checked"
fi

out=$(for f in installer/install.sh tools/*.sh; do bash -n "$f" || echo "$f"; done 2>&1)
[[ -z "$out" ]] && ok "bash -n of the wrappers" || fail "bash -n:\n$out"
if command -v pwsh >/dev/null; then
  out=$(pwsh -NoProfile -Command '$e=$null; $null=[System.Management.Automation.Language.Parser]::ParseFile("installer/install.ps1",[ref]$null,[ref]$e); if($e.Count){$e|%{$_.Message}; exit 1}' 2>&1) && ok "install.ps1 syntax" || fail "install.ps1:\n$out"
else
  warn "no pwsh — install.ps1 is checked in tools/validate_in_docker.sh"
fi

if command -v uv >/dev/null; then
  out=$("${UVPY[@]}" -c '
import json
import subprocess
for f in subprocess.run(["git", "ls-files", "*.json"], capture_output=True, text=True).stdout.split():
    json.load(open(f, encoding="utf-8"))
' 2>&1) && ok "project JSON" || fail "JSON: $out"
  # The judge and the tasks MCP live in the aiwb-plugins repository, and so do their checks.
  out=$("${UVPY[@]}" -m pytest -q tests 2>&1) && ok "pytest: $(echo "$out" | tail -1)" || fail "pytest:\n$out"
else
  fail "no uv — tests not run"
fi

out=$(python3 tools/check_links.py 2>&1) && ok "links in the docs" || fail "links:\n$out"

if git rev-parse --git-dir >/dev/null 2>&1; then
  tracked=$(git ls-files .env "*/.env" "*.pem" "*id_ed25519*" "*id_rsa*")
  [[ -z "$tracked" ]] && ok "no secrets in git" || fail "secrets got into git: $tracked"
else
  warn "not a git repository — secrets check skipped"
fi

echo
if (( red )); then echo "Result: RED — commit blocked"; exit 1
elif (( yellow )); then echo "Result: YELLOW — the 🟡 checks above did not run on this machine"; exit 2
else echo "Result: all green"; exit 0; fi
