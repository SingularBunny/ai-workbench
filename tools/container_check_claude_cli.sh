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
# The fork's managedTurns: false (F62) must give an unmanaged turn; otherwise OpenClaw manages it (2026.11+).
unmanaged=$(openclaw config get plugins.entries.anthropic.config.managedTurns 2>/dev/null | tail -1)
check_turn() {
UNMANAGED=$([[ "$unmanaged" == false && -z "$FORK_MANAGED" ]] && echo 1 || echo 0) python3 - <<'PY'
import glob, json, os
calls = [json.load(open(f)) for f in glob.glob("/tmp/fake-claude/call-*.json")]
print("CLI_CALLS", len(calls))
# The agent turn is the conversation call (--replay-user-messages), managed or not; the rest are internal.
turn = [x for x in calls if "--replay-user-messages" in x["argv"]]
c = turn[-1] if turn else {"argv": []}
a = c["argv"]
prompt = c.get("systemPrompt", "") + json.dumps(c.get("initialize", {}), ensure_ascii=False)
print("CLI_TURN_FLAGS", " ".join(x for x in a if x.startswith("--")))
def ok(name, cond): print(f"{name}={0 if cond else 1}")
ok("CLI_PRINT_MODE", ("-p" in a or "--print" in a) and "stream-json" in a)
ok("CLI_MODEL_OPUS", "--model" in a and "opus" in a[a.index("--model") + 1])
ok("CLI_WORKSPACE_IN_PROMPT", "CLI_WORKSPACE_MARK" in prompt)
# Unmanaged: skills as a Claude plugin; managed: OpenClaw lists them in the prompt, Claude Code gets no slash
# commands and only the native tools OpenClaw allows (the installer's managedNativeTools: Agent, Workflow).
managed = "--disable-slash-commands" in a
tools = a[a.index("--tools") + 1].split(",") if "--tools" in a else []
print("CLI_TURN_MODE", "managed" if managed else "unmanaged", "tools:", ",".join(tools))
ok("CLI_SKILLS_PLUGIN", "--plugin-dir" in a if not managed else "<available_skills>" in prompt)
if managed: ok("CLI_MANAGED_BACKGROUND_AGENTS", {"Agent", "Workflow"} <= set(tools))
if os.environ.get("UNMANAGED") == "1": ok("CLI_UNMANAGED_WITH_FORK", not managed and "--plugin-dir" in a)
# The fork with the switch on (C10): managed, and Claude keeps its todo list (F60) and plan mode (F49).
if os.environ.get("FORK_MANAGED") == "1":
    ok("CLI_FORK_MANAGED", managed)
    ok("CLI_FORK_MANAGED_TODO_PLAN", {"TodoWrite", "TaskCreate", "EnterPlanMode", "ExitPlanMode"} <= set(tools))
ok("CLI_GATEWAY_MCP", "--mcp-config" in a)
PY
}
check_turn
[[ -s /tmp/cli-turn.json ]] && ! grep -q FAKE_CLAUDE_OK /tmp/cli-turn.json && head -c 1500 /tmp/cli-turn.json

# With the fork, the same turn once more with the switch on (managed turns).
if [[ "$unmanaged" == false ]]; then
  retry openclaw config set plugins.entries.anthropic.config.managedTurns true --strict-json
  rm -rf "$FAKE_CLAUDE_LOG"; restart
  openclaw agent --agent main -m "Hello again" --json > /tmp/cli-turn.json 2>&1; echo "CLI_FORK_MANAGED_TURN_EXIT=$?"
  FORK_MANAGED=1 check_turn
  retry openclaw config set plugins.entries.anthropic.config.managedTurns false --strict-json
fi

# Restore: model, runtime, claude stub, Gateway.
retry openclaw config set agents.defaults.model "$before" --strict-json
retry openclaw config unset 'agents.defaults.models["anthropic/claude-opus-5-5"]'
cp /tmp/claude-stub.bak /home/tester/bin/claude
restart
