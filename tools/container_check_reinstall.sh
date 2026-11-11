#!/usr/bin/env bash
# Inside the tools/validate_in_docker.sh --reinstall container: reinstall over the existing
# install, uninstall by manifest, and install after uninstall. Runs as tester after the main
# check; $1 is the install.sh arguments. The result is the REINSTALL_*/UNINSTALL_* lines.
# Every check is able to fail: a read error is a failure, not a "no"; before uninstall the
# key comparison must find differences (control) — otherwise it measures nothing.
set -uo pipefail
export PATH=/home/tester/.openclaw/bin:/home/tester/bin:$PATH
cd /opt/ai-workbench || exit 1
cfg=~/.openclaw/openclaw.json

# Own (non-bundled) plugins, ids separated by spaces; if the list cannot be parsed — exit code 2.
mine() {
  openclaw plugins list --json 2>/dev/null | python3 -c '
import json, sys
s = sys.stdin.read()
try: l = json.loads(s[s.index("{"):])
except Exception: print("PLUGINS_LIST_FAILED", file=sys.stderr); sys.exit(2)
print(" ".join(sorted(p["id"] for p in l["plugins"] if p.get("origin") != "bundled")))'
}

# Manifest keys against the current config: 0 — all as before install, 1 — differences, 2 — read error.
keys_vs_before() {
  python3 - "$1" <<'PY'
import json, subprocess, sys
m = json.load(open(sys.argv[1])); bad, err = [], []
for k, was in m["config"].items():
    r = subprocess.run(["openclaw", "config", "get", k, "--json"], capture_output=True, text=True)
    out = r.stdout + r.stderr
    if r.returncode == 0:
        try: now = {"value": json.loads(r.stdout.strip())}
        except ValueError: err.append(k); continue
    elif "valid but unset" in out or "Config path not found" in out: now = {"absent": True}
    else: err.append(k); continue
    if now != was: bad.append(k)
print(f"  keys {len(m['config'])}: differ from pre-install {len(bad)}, read errors {len(err)} {(' '.join(err))[:200]}")
sys.exit(2 if err else 1 if bad else 0)
PY
}

cp "$cfg" /out/config-1.json; plugins1=$(mine); echo "  own plugins after install: $(wc -w <<<"$plugins1")"
[[ -n "$plugins1" ]]; echo "REINSTALL_PLUGINS_SEEN=$?"
echo "==== reinstall"
installer/install.sh $1 > /out/reinstall.log 2>&1; echo "REINSTALL_EXIT=$?"
grep -E '^Done:|✗' /out/reinstall.log | head -5
cp "$cfg" /out/config-2.json; plugins2=$(mine)
echo "MARKETPLACE_HEAD after reinstall: $(git -C ~/.openclaw/workbench/marketplaces/claude-plugins-official rev-parse HEAD 2>&1)"
python3 - <<'PY'
import json
a, b = json.load(open("/out/config-1.json")), json.load(open("/out/config-2.json"))
def flat(x, p=""):
    if isinstance(x, dict):
        for k, v in x.items(): yield from flat(v, f"{p}.{k}" if p else k)
    else: yield p, json.dumps(x, sort_keys=True)
fa, fb = dict(flat(a)), dict(flat(b))
diff = sorted(k for k in fa.keys() | fb.keys() if fa.get(k) != fb.get(k))
print(f"  config after reinstall: differences {len(diff)}" + (": " + " ".join(diff)[:600] if diff else ""))
open("/out/config-diff.txt", "w").write("\n".join(f"{k}: {fa.get(k)} → {fb.get(k)}" for k in diff))
PY
# The criterion is semantic equality: --force reorders plugins.entries entries, the values are the same.
[[ ! -s /out/config-diff.txt ]]; echo "REINSTALL_CONFIG_SAME=$?"
cmp -s /out/config-1.json /out/config-2.json && echo "  byte for byte: yes" || echo "  byte for byte: no (key order)"
[[ "$plugins1" == "$plugins2" ]]; echo "REINSTALL_PLUGINS_SAME=$?"
cp ~/.openclaw/workbench/install-manifest.json /out/install-manifest.json
# Project skill links (if the profile defines them) are in place before uninstall — otherwise the check below is empty.
python3 -c 'import json,os,sys; l=json.load(open("/out/install-manifest.json")).get("links",{}); sys.exit(2 if not l else 0 if all(os.path.islink(f) for f in l) else 1)'
rc=$?; [[ $rc != 2 ]] && echo "UNINSTALL_LINKS_CONTROL=$rc"

echo "==== control: before uninstall the comparison must see differences"
keys_vs_before /out/install-manifest.json; [[ $? == 1 ]]; echo "UNINSTALL_CONTROL_DIFFERS=$?"

echo "==== uninstall with the Gateway running — refused, nothing changes"
openclaw health >/dev/null 2>&1; echo "  Gateway running: $([[ $? == 0 ]] && echo yes || echo NO)"
installer/install.sh --uninstall --yes > /out/uninstall-running.log 2>&1; rc=$?
[[ $rc == 2 ]]; echo "UNINSTALL_REFUSED_WHILE_RUNNING=$? (code $rc)"
keys_vs_before /out/install-manifest.json; [[ $? == 1 ]]; echo "UNINSTALL_REFUSED_CHANGED_NOTHING=$?"
[[ -e ~/.openclaw/workbench/install-manifest.json ]]; echo "UNINSTALL_REFUSED_MANIFEST_KEPT=$?"

echo "==== uninstall: Gateway stopped"
openclaw gateway stop >/dev/null 2>&1; pkill -f openclaw-gateway 2>/dev/null
for i in $(seq 1 20); do openclaw health >/dev/null 2>&1 || break; sleep 1; done
openclaw health >/dev/null 2>&1; echo "  Gateway stopped: $([[ $? != 0 ]] && echo yes || echo NO)"
installer/install.sh --uninstall --yes > /out/uninstall.log 2>&1; echo "UNINSTALL_EXIT=$?"
[[ ! -e ~/.config/chromium/NativeMessagingHosts/ai.openclaw.browser_bootstrap.json ]]; echo "CHROME_HOST_REMOVED=$?"
# Fork settings (env.vars) are keys set by the install: uninstall removes them.
[[ -n "${OC_SHA:-}" ]] && { python3 -c 'import json,sys; v=json.load(open(sys.argv[1])).get("env",{}).get("vars",{}); sys.exit(any(k.startswith("OPENCLAW_") for k in v))' "$cfg"; echo "UNINSTALL_FORK_SETTINGS_REMOVED=$?"; }
grep -E '^Done:|✗|Error' /out/uninstall.log | head -8
# Only keys the uninstall plan keeps on purpose may differ from before.
kept_keys=$(grep -oE 'keep setting +[^ ]+' /out/uninstall.log | awk '{print $3}' | sort | tr '\n' ' ')
echo "  kept on purpose: ${kept_keys:-none}"
python3 - /out/install-manifest.json "$kept_keys" <<'PY'
import json, subprocess, sys
m = json.load(open(sys.argv[1])); kept = set(sys.argv[2].split()); bad, err = [], []
for k, was in m["config"].items():
    if k in kept: continue
    r = subprocess.run(["openclaw", "config", "get", k, "--json"], capture_output=True, text=True); out = r.stdout + r.stderr
    if r.returncode == 0:
        try: now = {"value": json.loads(r.stdout.strip())}
        except ValueError: err.append(k); continue
    elif "valid but unset" in out or "Config path not found" in out: now = {"absent": True}
    else: err.append(k); continue
    if now != was: bad.append(k)
print(f"  keys {len(m['config'])}, kept {len(kept)}: others differ from pre-install {len(bad)} {' '.join(bad)[:200]}, read errors {len(err)}")
sys.exit(2 if err else 1 if bad else 0)
PY
echo "UNINSTALL_CONFIG_RESTORED=$?"
after=$(mine); rc=$?; echo "  own plugins after uninstall: ${after:-none}"
kept=$(python3 -c 'import json;m=json.load(open("/out/install-manifest.json"));print(" ".join(sorted(k for k,v in m["plugins"].items() if v["installed"])))')
[[ $rc == 0 && "$after" == "$kept" ]]; echo "UNINSTALL_PLUGINS_REMOVED=$?"
[[ ! -e ~/.openclaw/workbench ]]; echo "UNINSTALL_DIR_REMOVED=$?"
# The IDE agent is removed, the other acp.json entry stays — the file is as before install (semantically).
python3 -c 'import json,sys; sys.exit(json.load(open("/out/acp-before.json")) != json.load(open(sys.argv[1])))' ~/.jetbrains/acp.json; echo "UNINSTALL_IDE_RESTORED=$?"
# Own project skill links are removed (control: before uninstall the manifest listed them and they existed).
python3 -c 'import json,os,sys; l=json.load(open("/out/install-manifest.json")).get("links",{}); print("  links in manifest:", len(l)); sys.exit(any(os.path.lexists(f) for f in l))'; echo "UNINSTALL_LINKS_REMOVED=$?"
openclaw config validate > /dev/null 2>&1; echo "UNINSTALL_VALIDATE=$?"
# Uninstall does not touch the sources of plugins installed by link.
[[ -f /home/tester/plugins/aiwb-plugins/judge/.claude-plugin/plugin.json ]]; echo "UNINSTALL_SOURCES_KEPT=$?"

echo "==== install after uninstall"
installer/install.sh $1 > /out/install3.log 2>&1; echo "INSTALL_AFTER_UNINSTALL_EXIT=$?"
grep -E '^Done:|✗' /out/install3.log | head -3
[[ "$(mine)" == "$plugins1" ]]; echo "INSTALL_AFTER_UNINSTALL_PLUGINS_SAME=$?"
