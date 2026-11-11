#!/usr/bin/env bash
# Part of tools/validate_in_docker.sh, runs inside the container with the Gateway running:
# agents on Claude CLI (WORKBENCH_DEFAULT_RUNTIME=claude-cli). The real `claude` is not run
# here — the tools/fake_claude_cli.py stand-in replaces it. Checked: the agent turn goes to
# `claude -p` with the right model, the system prompt has the agent's working folder instructions,
# the reply reaches OpenClaw. After the check the model is restored.
# Settings are restored with retries: a write may hit a Gateway reload.
retry() { for i in 1 2 3 4 5 6; do "$@" >/dev/null 2>&1 && return 0; sleep 3; done; echo "✗ failed: $*"; return 1; }
echo "==== claude-cli"
export FAKE_CLAUDE_LOG=/tmp/fake-claude; rm -rf "$FAKE_CLAUDE_LOG"
cp /home/tester/bin/claude /tmp/claude-stub.bak
install -m 755 /opt/ai-workbench/tools/fake_claude_cli.py /home/tester/bin/claude
before=$(openclaw config get agents.defaults.model --json 2>/dev/null)
ws=$(openclaw agents list --json 2>/dev/null | python3 -c 'import json,sys; print([a for a in json.load(sys.stdin) if a["id"]=="main"][0]["workspace"])')
mkdir -p "$ws" && echo "CLI_WORKSPACE_MARK: working folder instructions" >> "$ws/AGENTS.md"

# The same keys the installer writes (openclaw/workbench.config.mjs).
openclaw config set agents.defaults.model '{"primary":"anthropic/claude-opus-5-5","fallbacks":["openrouter/auto"]}' --strict-json >/dev/null; echo "CLI_SET_MODEL=$?"
openclaw config set 'agents.defaults.models["anthropic/claude-opus-5-5"].agentRuntime' '{"id":"claude-cli"}' --strict-json >/dev/null; echo "CLI_SET_RUNTIME=$?"
openclaw config validate >/dev/null 2>&1; echo "CLI_CONFIG_VALID=$?"

restart() { pkill -u "$(id -u)" -f '^openclaw-gateway'; for i in $(seq 1 30); do openclaw health >/dev/null 2>&1 || break; sleep 1; done
  (FAKE_CLAUDE_LOG=$FAKE_CLAUDE_LOG openclaw gateway run > /tmp/gw.log 2>&1 &); for i in $(seq 1 45); do sleep 2; openclaw health >/dev/null 2>&1 && break; done; }
restart
openclaw agent --agent main -m "Hello" --json > /tmp/cli-turn.json 2>&1; echo "CLI_TURN_EXIT=$?"
grep -q FAKE_CLAUDE_OK /tmp/cli-turn.json; echo "CLI_REPLY_FROM_CLAUDE=$?"
python3 - <<'PY'
import glob, json
calls = [json.load(open(f)) for f in glob.glob("/tmp/fake-claude/call-*.json")]
print("CLI_CALLS", len(calls))
# The agent turn is the call with the agent's skills (--plugin-dir); the rest are internal.
turn = [x for x in calls if "--plugin-dir" in x["argv"]]
c = turn[-1] if turn else {"argv": []}
a = c["argv"]
prompt = c.get("systemPrompt", "") + json.dumps(c.get("initialize", {}), ensure_ascii=False)
print("CLI_TURN_FLAGS", " ".join(x for x in a if x.startswith("--")))
def ok(name, cond): print(f"{name}={0 if cond else 1}")
ok("CLI_PRINT_MODE", ("-p" in a or "--print" in a) and "stream-json" in a)
ok("CLI_MODEL_OPUS", "--model" in a and "opus" in a[a.index("--model") + 1])
ok("CLI_WORKSPACE_IN_PROMPT", "CLI_WORKSPACE_MARK" in prompt)
ok("CLI_SKILLS_PLUGIN", "--plugin-dir" in a)
ok("CLI_GATEWAY_MCP", "--mcp-config" in a)
PY
[[ -s /tmp/cli-turn.json ]] && ! grep -q FAKE_CLAUDE_OK /tmp/cli-turn.json && head -c 1500 /tmp/cli-turn.json

# Restore: model, runtime, claude stub, Gateway.
retry openclaw config set agents.defaults.model "$before" --strict-json
retry openclaw config unset 'agents.defaults.models["anthropic/claude-opus-5-5"]'
cp /tmp/claude-stub.bak /home/tester/bin/claude
restart
