#!/usr/bin/env bash
# Inside the tools/validate_in_docker.sh container, with the Gateway running: the OpenClaw agent entry
# in ~/.jetbrains/acp.json and the agent itself, started the way JetBrains AI Assistant starts it.
set -uo pipefail
echo "==== JetBrains acp.json"
cp ~/.jetbrains/acp.json /out/acp-after.json 2>/dev/null
python3 - <<'PY'
import json
a = json.load(open("/out/acp-after.json"))["agent_servers"]
e = a.get("OpenClaw", {})
print("IDE_ENTRY", (e.get("args") or [""])[-1] == "acp" and e.get("use_custom_mcp") is False and e.get("use_idea_mcp") is False, e.get("command"), e.get("args"))
print("IDE_OTHER_KEPT", a.get("Other") == {"command": "/x"})
PY
python3 /opt/ai-workbench/tools/acp_smoke.py ~/.jetbrains/acp.json OpenClaw "$HOME"
grep -vi deprecat /tmp/acp-stderr.log | tail -5 | sed 's/^/ACP_STDERR /' 
# The second entry form is the install-cli.sh wrapper (~/.openclaw/bin/openclaw) as is: the installer
# picks it when it runs under the system Node (as on a machine with Node ≥ 24 in PATH).
echo '{"agent_servers":{"Wrapper":{"command":"'"$HOME"'/.openclaw/bin/openclaw","args":["acp"]}}}' > /tmp/acp-wrapper.json
python3 /opt/ai-workbench/tools/acp_smoke.py /tmp/acp-wrapper.json Wrapper "$HOME" | sed 's/^ACP_/ACP_WRAPPER_/'
