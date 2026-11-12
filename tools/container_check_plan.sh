#!/usr/bin/env bash
# Plan mode (aiwb-plugins/plan) inside the container with the Gateway running: the plugin registered its /plan
# command (register() ran: the command comes first, then the hooks and the tool), the Gateway log has no error from
# it, and the installer granted it conversation access (the plan-mode note in the prompt).
# `openclaw plugins inspect` reads manifests only, so commands, hooks and tools are read from the running Gateway.
echo "==== plan"
openclaw gateway call commands.list --params '{"agentId":"main"}' --json 2>/dev/null > /tmp/plan-commands.json
python3 - <<'PY'
import json
try:
    d = json.load(open("/tmp/plan-commands.json"))
    names = [c.get("name") for c in (d.get("commands", d) if isinstance(d, dict) else d)]
except Exception as e:
    names = []; print(f"plan: commands.list unreadable ({e})")
print(f"PLAN_COMMAND={0 if 'plan' in names else 1} ({len(names)} commands)")
PY
! grep -iE "aiwb-plan.*(error|fail)" /tmp/gw.log; echo "PLAN_NO_LOAD_ERROR=$?"
access=$(openclaw config get plugins.entries.aiwb-plan.hooks.allowConversationAccess 2>/dev/null | tr -d '[:space:]')
[[ $access == true ]]; echo "PLAN_CONVERSATION_ACCESS=$? ($access)"
