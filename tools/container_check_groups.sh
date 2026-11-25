#!/usr/bin/env bash
# Part of tools/validate_in_docker.sh, runs inside the container with the Gateway running, after
# container_check_junie.sh: group chat in an ordinary chat (aiwb-plugins groups 0.2.0 or later, with an OpenClaw fork
# that fires agent_end for ACP turns). The tools/fake_junie_acp.py stand-in answers as Junie.
# Checked: Junie joins a chat as a member (aiwb-groups.chat.add); a message naming it (aiwb-groups.chat.ask, as the
# Control UI sends "@Junie …") is written into the chat, Junie answers in its own ACP session and its reply lands in
# the same chat as a Junie row (provider acp, model junie, the participant marker); the second question gives Junie
# only what is new. Skipped when the installed aiwb-groups has no group chats.
echo "==== groups"
key=agent:main:groups-check
call() { openclaw gateway call "$1" --json --params "$2" 2>/dev/null; }
if ! call aiwb-groups.chat.get "{\"sessionKey\":\"$key\"}" | grep -q '"members"'; then
  echo "GROUPS=skip (aiwb-groups without group chats)"; exit 0
fi
# Replies of ACP members land in the chat through the fork's agent_end for ACP turns.
if ! call aiwb-fork-settings.effective '{}' | grep -qE '"fork": *"[0-9a-f]+"'; then  # fork is the installed package's sha256, null without the fork
  echo "GROUPS=skip (no OpenClaw fork: no agent_end for ACP turns)"; exit 0
fi
# The member's reply comes through the agent_end hook, which needs conversation access for the plugin.
if [[ "$(openclaw config get plugins.entries.aiwb-groups.hooks.allowConversationAccess 2>/dev/null | tail -1)" != true ]]; then
  echo "groups: granting plugins.entries.aiwb-groups.hooks.allowConversationAccess for the check"
  pkill -u "$(id -u)" -f '^openclaw-gateway'; for i in $(seq 1 60); do pgrep -u "$(id -u)" -f '^openclaw-gateway' >/dev/null || break; sleep 1; done
  openclaw config set plugins.entries.aiwb-groups.hooks.allowConversationAccess true --strict-json >/dev/null
  (openclaw gateway run > /tmp/gw.log 2>&1 &); for i in $(seq 1 45); do sleep 2; openclaw health >/dev/null 2>&1 && break; done
fi
pkg=$(dirname "$(dirname "$(readlink -f "$(command -v openclaw)")")")
[[ -f "$pkg/package.json" ]] || pkg=$(find ~/.openclaw/tools -maxdepth 5 -type d -path '*node_modules/openclaw' | head -1)
node=$(find ~/.openclaw/tools -maxdepth 4 -type f -path '*/bin/node' | head -1)
# The chat must exist before a member's row can be written into it.
"$node" /opt/ai-workbench/tools/chat_send_admin.mjs "$pkg" "$key" "/status" groups-start > /tmp/groups.json 2>&1
history() { openclaw gateway call chat.history --json --params "{\"sessionKey\":\"$key\"}" 2>/dev/null; }
for i in $(seq 1 20); do history | grep -q '"role"' && break; sleep 2; done
call aiwb-groups.chat.add "{\"sessionKey\":\"$key\",\"member\":{\"kind\":\"acp\",\"id\":\"junie\"}}" >> /tmp/groups.json
call aiwb-groups.chat.get "{\"sessionKey\":\"$key\"}" | grep -q '"key": *"acp:junie"'; echo "GROUPS_MEMBER_ADDED=$?"
call aiwb-groups.chat.ask "{\"sessionKey\":\"$key\",\"text\":\"@Junie first group question\"}" >> /tmp/groups.json
for i in $(seq 1 45); do history | grep -qE 'FAKE_JUNIE_OK[^"]*first group question' && break; sleep 2; done
for i in $(seq 1 15); do call aiwb-groups.chat.get "{\"sessionKey\":\"$key\"}" | grep -q '"running": *null' && break; sleep 2; done
call aiwb-groups.chat.ask "{\"sessionKey\":\"$key\",\"member\":\"acp:junie\",\"text\":\"second group question\"}" >> /tmp/groups.json
for i in $(seq 1 45); do history | grep -qE 'FAKE_JUNIE_OK[^"]*second group question' && break; sleep 2; done
history > /tmp/groups-history.json
python3 - <<'PY'
import json
def ok(name, cond): print(f"{name}={0 if cond else 1}")
try:
    msgs = json.load(open("/tmp/groups-history.json")).get("messages", [])
except Exception as e:
    msgs = []; print(f"groups: chat.history unreadable ({e})")
def text(m):
    c = m.get("content")
    return c if isinstance(c, str) else " ".join(p.get("text", "") for p in c or [] if isinstance(p, dict))
users = [m for m in msgs if m.get("role") == "user" and "first group question" in text(m)]
replies = [m for m in msgs if m.get("role") == "assistant" and "FAKE_JUNIE_OK" in text(m)]
ok("GROUPS_QUESTION_IN_CHAT", len(users) == 1)
ok("GROUPS_JUNIE_REPLY_IN_CHAT", len(replies) >= 1)
first = replies[0] if replies else {}
ok("GROUPS_REPLY_AUTHOR", first.get("provider") == "acp" and first.get("model") == "junie"
   and (first.get("__openclaw") or {}).get("participant", {}).get("key") == "acp:junie")
ok("GROUPS_SECOND_REPLY", len(replies) >= 2 and "second group question" in text(replies[1]))
PY
prompts=$(grep -c '"session/prompt"' "${FAKE_JUNIE_LOG:-/tmp/fake-junie.jsonl}" 2>/dev/null)
grep '"session/prompt"' "${FAKE_JUNIE_LOG:-/tmp/fake-junie.jsonl}" 2>/dev/null | tail -1 | grep -q 'New messages in the group chat'
echo "GROUPS_SECOND_PROMPT_ONLY_NEW=$? ($prompts prompts)"
history | grep -q 'FAKE_JUNIE_OK' || { tail -c 800 /tmp/groups.json; grep -iE "aiwb-groups" /tmp/gw.log | tail -5; }
