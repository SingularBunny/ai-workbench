#!/usr/bin/env bash
# Inside the tools/validate_in_docker.sh --reinstall container, after container_check_reinstall.sh: the
# plugin rename (openclaw/workbench.config.mjs, PLUGIN_RENAMES). An install made by the installer before the
# rename, with the plugins at their old folders and ids, then the current installer over it: one entry and
# one load path per plugin, no "duplicate plugin id", the old config and hooks carried over, the plugin's
# state files moved, a re-run with nothing left to move, and an uninstall that leaves no plugin entry.
# Both old versions are pinned commits of the public repositories (the last ones before the rename), taken
# from the mounted clones. Runs as tester with the Gateway stopped; $1 is the install.sh arguments.
# The result is the MIGRATION_* lines.
set -uo pipefail
export PATH=/home/tester/.openclaw/bin:/home/tester/bin:$PATH
cd /opt/ai-workbench || exit 1
cfg=~/.openclaw/openclaw.json
OLD_INSTALLER=7535d95b332cfad73666dac7db5c3901d05f2d85   # ai-workbench before the rename
OLD_PLUGINS=11653210c2957fa4c8d8877ef80792e8862219e9     # aiwb-plugins before the rename
old_root=/home/tester/old-layout
node=$(find ~/.openclaw -maxdepth 5 -type f -path "*/bin/node" | head -1); node=${node:-node}
gw_stop() { openclaw gateway stop >/dev/null 2>&1; pkill -f openclaw-gateway 2>/dev/null; for i in $(seq 1 20); do openclaw health >/dev/null 2>&1 || break; sleep 1; done; }
gw_start() { (set -a; . ~/.openclaw/.env; set +a; openclaw gateway run > /tmp/gw-migration.log 2>&1 &); for i in $(seq 1 45); do sleep 2; openclaw health >/dev/null 2>&1 && break; done; }
own() {
  openclaw plugins list --json 2>/dev/null | python3 -c '
import json, sys
s = sys.stdin.read()
try: l = json.loads(s[s.index("{"):])
except Exception: print("PLUGINS_LIST_FAILED"); sys.exit(2)
print(" ".join(sorted(p["id"] + ":" + str(p.get("status")) for p in l["plugins"] if p.get("origin") != "bundled")))'
}

echo "==== migration: install with the old plugin layout, then the current one"
gw_stop
installer/install.sh --uninstall --yes > /out/migration-uninstall-0.log 2>&1; echo "MIGRATION_START_CLEAN=$?"
rm -rf "$old_root" /tmp/old-installer
git clone -q /opt/ai-workbench /tmp/old-installer && git -C /tmp/old-installer checkout -q "$OLD_INSTALLER" &&
  mkdir -p "$old_root" && git clone -q /home/tester/plugins/aiwb-plugins "$old_root/aiwb-plugins" &&
  git -C "$old_root/aiwb-plugins" checkout -q "$OLD_PLUGINS"; echo "MIGRATION_OLD_SOURCES=$?"
$node /tmp/old-installer/installer/setup.mjs --yes --plugins-root "$old_root" > /out/migration-old.log 2>&1; echo "MIGRATION_OLD_INSTALL_EXIT=$?"
grep -E '^Done:|✗' /out/migration-old.log | head -5
# What a user has set on the old plugin by hand, and its state files.
openclaw config set plugins.entries.aiwb-projects.config.order '["Garden"]' --strict-json >/dev/null 2>&1 &&
  openclaw config set plugins.entries.aiwb-projects.config.defaultFolder '"_old"' --strict-json >/dev/null 2>&1 &&
  openclaw config set plugins.entries.aiwb-projects.hooks.allowPromptInjection true --strict-json >/dev/null 2>&1; echo "MIGRATION_OLD_CONFIG=$?"
mkdir -p ~/.openclaw/workbench
echo '{"folders":["Garden","Old"],"rows":{},"placedAt":{}}' > ~/.openclaw/workbench/aiwb-projects-order.json
echo '{"old-chat":{"agentId":"main","sessionKey":"agent:main:catalog-import:old"}}' > ~/.openclaw/workbench/aiwb-projects-adopted.json
cp "$cfg" /out/config-old-layout.json
before=$(own); echo "  own plugins, old layout: $before"
for id in ai-workbench aiwb-projects aiwb-memory aiwb-settings; do grep -q "$id:loaded" <<<"$before" || { echo "  not loaded: $id"; false; }; done; echo "MIGRATION_OLD_PLUGINS_LOADED=$?"

installer/install.sh $1 > /out/migration-new.log 2>&1; echo "MIGRATION_NEW_INSTALL_EXIT=$?"
grep -E '^Done:|✗|renamed plugins' /out/migration-new.log | head -8
cp "$cfg" /out/config-migrated.json
! grep -qi "duplicate plugin id" /out/migration-new.log; echo "MIGRATION_INSTALL_NO_DUPLICATE_ID=$?"
python3 - "$cfg" <<'PY'
import json, sys
c = json.load(open(sys.argv[1]))["plugins"]
entries, paths = c.get("entries", {}), c.get("load", {}).get("paths", [])
old_ids, new_ids = ["ai-workbench", "aiwb-projects", "aiwb-settings"], ["judge", "aiwb-claude-bridge", "aiwb-memory", "aiwb-fork-settings", "aiwb-office"]
old_dirs = ["/aiwb-plugins/ai-workbench", "/aiwb-plugins/projects", "/aiwb-plugins/memory", "/aiwb-plugins/settings"]
new_dirs = ["/aiwb-plugins/judge", "/aiwb-plugins/claude-bridge", "/aiwb-plugins/shared-memory", "/aiwb-plugins/fork-settings", "/aiwb-plugins/office"]
bad = [f"entry {i}" for i in old_ids if i in entries] + [f"no entry {i}" for i in new_ids if i not in entries]
bad += [f"old path {p}" for p in paths if any(p.rstrip("/").endswith(d) for d in old_dirs)]
bad += [f"{d} listed {n} times" for d in new_dirs if (n := sum(p.rstrip("/").endswith(d) for p in paths)) != 1]
bad += [f"{i} in {k}" for k in ("allow", "deny") for i in old_ids if i in (c.get(k) or [])]
print("  one entry and one load path per plugin:", "yes" if not bad else "; ".join(bad))
sys.exit(1 if bad else 0)
PY
echo "MIGRATION_ONE_ENTRY_PER_PLUGIN=$?"
python3 - "$cfg" <<'PY'
import json, sys
e = json.load(open(sys.argv[1]))["plugins"]["entries"].get("aiwb-claude-bridge", {})
want = {("config", "order"): ["Garden"], ("config", "defaultFolder"): "_old",
        ("hooks", "allowPromptInjection"): True, ("hooks", "allowConversationAccess"): True}
bad = [f"{a}.{b}={e.get(a, {}).get(b)!r}" for (a, b), v in want.items() if e.get(a, {}).get(b) != v]
print("  carried over to aiwb-claude-bridge:", "config.order, config.defaultFolder, hooks" if not bad else "MISSING " + " ".join(bad))
sys.exit(1 if bad else 0)
PY
echo "MIGRATION_CONFIG_CARRIED=$?"
after=$(own); echo "  own plugins after the migration: $after"
# The renamed plugins are loaded under their new ids; nothing is left under an old one.
for id in judge aiwb-claude-bridge aiwb-memory aiwb-fork-settings aiwb-office; do grep -qw "$id:loaded" <<<"$after" || { echo "  not loaded: $id"; false; }; done &&
  ! grep -qE '(^| )(ai-workbench|aiwb-projects|aiwb-settings):' <<<"$after"; echo "MIGRATION_PLUGINS_LOADED=$?"
openclaw config validate > /tmp/migration-validate.txt 2>&1; echo "MIGRATION_VALIDATE=$?"
grep -i "duplicate\|unavailable" /tmp/migration-validate.txt | head -3
python3 -c '
import json, sys
m = json.load(open(sys.argv[1])); old = ("ai-workbench", "aiwb-projects", "aiwb-settings")
left = [k for k in m["config"] if any(k == f"plugins.entries.{i}" or k.startswith(f"plugins.entries.{i}.") for i in old)] + [i for i in m["plugins"] if i in old]
print("  manifest under old ids:", left or "none"); sys.exit(1 if left else 0)' ~/.openclaw/workbench/install-manifest.json; echo "MIGRATION_MANIFEST_RENAMED=$?"

echo "==== migration: a re-run has nothing to move"
installer/install.sh $1 > /out/migration-rerun.log 2>&1; echo "MIGRATION_RERUN_EXIT=$?"
! grep -q "renamed plugins" /out/migration-rerun.log; echo "MIGRATION_RERUN_NOTHING_TO_MOVE=$?"

echo "==== migration: the Gateway with the renamed plugins"
gw_start
openclaw health >/dev/null 2>&1; echo "MIGRATION_HEALTH=$?"
wb=~/.openclaw/workbench
[[ ! -e $wb/aiwb-projects-order.json && "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["folders"])' $wb/aiwb-claude-bridge-order.json 2>/dev/null)" == "['Garden', 'Old']" ]] &&
  [[ ! -e $wb/aiwb-projects-adopted.json && -s $wb/aiwb-claude-bridge-adopted.json ]]; echo "MIGRATION_STATE_FILES_MOVED=$?"
openclaw gateway call aiwb-fork-settings.effective --json > /tmp/migration-settings.json 2>/dev/null &&
  python3 -c 'import json; assert json.load(open("/tmp/migration-settings.json"))["settings"]'; echo "MIGRATION_FORK_SETTINGS_METHOD=$?"
openclaw gateway call aiwb-claude-bridge.adopted --json > /tmp/migration-adopted.json 2>/dev/null &&
  python3 -c 'import json; assert "chats" in json.load(open("/tmp/migration-adopted.json"))'; echo "MIGRATION_BRIDGE_METHOD=$?"
! grep -qi "duplicate plugin id" /tmp/gw-migration.log; echo "MIGRATION_GATEWAY_NO_DUPLICATE_ID=$?"
grep -E "aiwb-fork-settings:" /tmp/gw-migration.log | head -1 | cut -c1-160
gw_stop

echo "==== migration: uninstall leaves no entry under an old or new id"
installer/install.sh --uninstall --yes > /out/migration-uninstall.log 2>&1; echo "MIGRATION_UNINSTALL_EXIT=$?"
grep -E '^Done:|✗' /out/migration-uninstall.log | head -5
python3 - "$cfg" <<'PY'
import json, sys
c = json.load(open(sys.argv[1])).get("plugins", {})
ids = ["ai-workbench", "aiwb-projects", "aiwb-settings", "judge", "aiwb-claude-bridge", "aiwb-memory", "aiwb-fork-settings", "aiwb-office"]
left = [i for i in ids if i in c.get("entries", {})] + [p for p in c.get("load", {}).get("paths", []) if "/aiwb-plugins/" in p]
print("  left after uninstall:", left or "nothing"); sys.exit(1 if left else 0)
PY
echo "MIGRATION_UNINSTALL_CLEAN=$?"
