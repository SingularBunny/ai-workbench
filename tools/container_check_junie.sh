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
for i in $(seq 1 45); do history | grep -qE 'FAKE_JUNIE_OK[^"]*Hello Junie' && break; sleep 2; done
grep -q '"session/prompt"' "$FAKE_JUNIE_LOG" 2>/dev/null; echo "JUNIE_PROMPT_SENT=$?"
history | grep -qE 'FAKE_JUNIE_OK[^"]*Hello Junie'; echo "JUNIE_REPLY_IN_CHAT=$?"
history | grep -q 'FAKE_JUNIE_OK' || { cat /tmp/junie-spawn.json | tail -c 800; history | tail -c 1500; }

# Shared chat context across switches (fork F72, acp.seedParentHistory): the chat starts on Claude CLI (the
# tools/fake_claude_cli.py stand-in), is handed to Junie and back. Junie's first prompt carries the chat so far, the
# next one does not repeat it, and back on Claude the turn gets Junie's reply.
if [[ "$(openclaw config get acp.seedParentHistory 2>/dev/null | tail -1)" == true ]]; then
  echo "==== shared context"
  export FAKE_CLAUDE_LOG=/tmp/fake-claude-shared; rm -rf "$FAKE_CLAUDE_LOG"; : > "$FAKE_JUNIE_LOG"
  cp /home/tester/bin/claude /tmp/claude-stub-shared.bak; install -m 755 /opt/ai-workbench/tools/fake_claude_cli.py /home/tester/bin/claude
  before=$(openclaw config get agents.defaults.model --json 2>/dev/null)
  openclaw config set agents.defaults.model '{"primary":"anthropic/claude-opus-5-5"}' --strict-json >/dev/null
  openclaw config set 'agents.defaults.models["anthropic/claude-opus-5-5"].agentRuntime' '{"id":"claude-cli"}' --strict-json >/dev/null
  restart() { pkill -u "$(id -u)" -f '^openclaw-gateway'; for i in $(seq 1 30); do openclaw health >/dev/null 2>&1 || break; sleep 1; done
    (FAKE_CLAUDE_LOG=$FAKE_CLAUDE_LOG FAKE_JUNIE_LOG=$FAKE_JUNIE_LOG openclaw gateway run > /tmp/gw.log 2>&1 &); for i in $(seq 1 45); do sleep 2; openclaw health >/dev/null 2>&1 && break; done; }
  restart
  key=agent:main:shared-check
  send() { "$node" /opt/ai-workbench/tools/chat_send_admin.mjs "$pkg" "$key" "$1" "$2" >> /tmp/shared.json 2>&1; }
  count() { history | grep -o "$1" | wc -l; }
  waitn() { for i in $(seq 1 45); do [[ $(count "$1") -ge $2 ]] && return; sleep 2; done; }
  send "Remember the word HERBARIUM" shared-1; waitn FAKE_CLAUDE_OK 1
  send "/acp spawn junie --bind here" shared-2; waitn 'Bound this conversation' 1
  send "Which word did I ask to remember?" shared-3; waitn FAKE_JUNIE_OK 1
  send "Second question" shared-4; waitn FAKE_JUNIE_OK 2
  python3 - <<'PY'
import json
ps = [json.loads(l)["params"] for l in open("/tmp/fake-junie.jsonl") if '"session/prompt"' in l]
text = [" ".join(b.get("text", "") for b in p.get("prompt", [])) for p in ps]
def ok(name, cond): print(f"{name}={0 if cond else 1}")
print("SHARED_JUNIE_PROMPTS", len(text))
ok("SHARED_JUNIE_GOT_HISTORY", len(text) >= 1 and "HERBARIUM" in text[0] and "FAKE_CLAUDE_OK" in text[0])
ok("SHARED_JUNIE_NO_REPEAT", len(text) >= 2 and "HERBARIUM" not in text[1] and "Second question" in text[1])
PY
  send "/acp close" shared-5; waitn 'Closed ACP session' 1
  send "What did Junie answer?" shared-6; waitn FAKE_CLAUDE_OK 2
  grep -l 'What did Junie answer' "$FAKE_CLAUDE_LOG"/call-*.json 2>/dev/null | xargs -r grep -q 'FAKE_JUNIE_OK'; echo "SHARED_CLAUDE_SEES_JUNIE=$?"
  # Restore: model, runtime, claude stub, Gateway.
  openclaw config set agents.defaults.model "$before" --strict-json >/dev/null
  openclaw config unset 'agents.defaults.models["anthropic/claude-opus-5-5"]' >/dev/null
  cp /tmp/claude-stub-shared.bak /home/tester/bin/claude
  restart
fi
