#!/usr/bin/env bash
# Part of tools/validate_in_docker.sh, runs inside the container with the Gateway running: JetBrains Junie as an
# ACP agent (WORKBENCH_JUNIE). The real Junie is not run here — the tools/fake_junie_acp.py stand-in replaces it.
# Checked: the installer installed acpx and registered junie; in a chat `/acp spawn junie --bind here` (sent as the
# Control UI owner sends it, with operator.admin) binds the chat to Junie, the next message goes to
# `junie --acp=true` and Junie's reply lands in the same chat.
echo "==== junie"
export FAKE_JUNIE_LOG=/tmp/fake-junie.jsonl; rm -f "$FAKE_JUNIE_LOG"
set -a; . ~/.openclaw/.env; set +a
python3 - <<'PY'
import json, os
c = json.load(open(os.path.expanduser("~/.openclaw/openclaw.json")))
plugins = c.get("plugins", {}).get("entries", {})
acpx = plugins.get("acpx", {}).get("config", {}).get("agents", {}).get("junie", {})
print(f"JUNIE_ACPX_ENABLED={0 if 'acpx' in plugins and plugins['acpx'].get('enabled', True) else 1}")
print(f"JUNIE_ACPX_COMMAND={0 if acpx.get('args') == ['--acp=true'] and 'WORKBENCH_JUNIE' in acpx.get('command', '') else 1}")
print(f"JUNIE_ACP_ALLOWED={0 if 'junie' in c.get('acp', {}).get('allowedAgents', []) else 1}")
PY
pkg=$(dirname "$(dirname "$(readlink -f "$(command -v openclaw)")")")
[[ -f "$pkg/package.json" ]] || pkg=$(find ~/.openclaw/tools -maxdepth 5 -type d -path '*node_modules/openclaw' | head -1)
node=$(find ~/.openclaw/tools -maxdepth 4 -type f -path '*/bin/node' | head -1)
key=agent:main:junie-check
"$node" /opt/ai-workbench/tools/chat_send_admin.mjs "$pkg" "$key" "/acp spawn junie --bind here" junie-spawn > /tmp/junie-spawn.json 2>&1
history() { openclaw gateway call chat.history --json --params "{\"sessionKey\":\"$key\"}" 2>/dev/null; }
for i in $(seq 1 30); do history | grep -q 'Bound this conversation' && break; sleep 2; done
history | grep -q 'Bound this conversation'; echo "JUNIE_SPAWN_BOUND=$?"
"$node" /opt/ai-workbench/tools/chat_send_admin.mjs "$pkg" "$key" "Hello Junie" junie-hello >> /tmp/junie-spawn.json 2>&1
for i in $(seq 1 45); do history | grep -q 'FAKE_JUNIE_OK Hello Junie' && break; sleep 2; done
grep -q '"session/prompt"' "$FAKE_JUNIE_LOG" 2>/dev/null; echo "JUNIE_PROMPT_SENT=$?"
history | grep -q 'FAKE_JUNIE_OK Hello Junie'; echo "JUNIE_REPLY_IN_CHAT=$?"
history | grep -q 'FAKE_JUNIE_OK' || { cat /tmp/junie-spawn.json | tail -c 800; history | tail -c 1500; }
