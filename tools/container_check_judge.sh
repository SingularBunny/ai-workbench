#!/usr/bin/env bash
# Part of tools/validate_in_docker.sh, runs inside the container after install:
# the judge skill is visible to OpenClaw and ready; the plugin script builds a report through a fake
# OpenAI-compatible judge — no keys, no network.
echo "==== judge"
python3 - <<'PY'
import json
d = json.load(open("/out/skills.json"))
j = [s for s in d["skills"] if s["name"] == "judge"]
print("JUDGE_SKILL", (j[0]["eligible"] and not j[0]["disabled"], j[0]["source"]) if j else "none")
PY
python3 /opt/ai-workbench/tools/fake_judge_server.py 18999 & srv=$!
sleep 1
echo '{"question":"2+2?","answer":"4","answer_model":"anthropic/claude-x"}' > /tmp/ex.json
WORKBENCH_JUDGE_MODEL=openai/fake WORKBENCH_JUDGE_BASE_URL=http://127.0.0.1:18999/v1 WORKBENCH_JUDGE_API_KEY=x \
  python3 /home/tester/plugins/aiwb-plugins/judge/skills/judge/scripts/judge.py --input /tmp/ex.json
echo "JUDGE_EXIT=$?"
kill $srv 2>/dev/null
# Judge via Claude CLI (claude-cli/<id>) with input from a Claude Code transcript (--from-session):
# a Claude CLI stand-in instead of the real one, a made-up transcript in the project folder.
mkdir -p /tmp/judge-bin && install -m 755 /opt/ai-workbench/tools/fake_claude_cli.py /tmp/judge-bin/claude
proj=/tmp/judge-proj; mkdir -p "$proj"
python3 - "$proj" <<'PY'
import json, os, re, sys
proj = sys.argv[1]
d = os.path.join(os.path.expanduser("~/.claude/projects"), re.sub(r"[^A-Za-z0-9]", "-", proj))
os.makedirs(d, exist_ok=True)
def rec(role, text):
    m = {"role": role, "content": text if role == "user" else [{"type": "text", "text": text}]}
    if role == "assistant":
        m["model"] = "claude-opus-x"
    return {"type": role, "message": m}
with open(f"{d}/chat.jsonl", "w") as f:
    for r in (rec("user", "2+2?"), rec("assistant", "4"), rec("user", "Send to the judge")):
        f.write(json.dumps(r, ensure_ascii=False) + "\n")
PY
(cd "$proj" && PATH=/tmp/judge-bin:$PATH WORKBENCH_JUDGE_MODEL=claude-cli/claude-haiku-x \
  python3 /home/tester/plugins/aiwb-plugins/judge/skills/judge/scripts/judge.py --from-session > /tmp/judge-cli.txt 2>&1); echo "JUDGE_CLI_EXIT=$?"
grep -q "PASS" /tmp/judge-cli.txt && grep -q "same family" /tmp/judge-cli.txt; echo "JUDGE_CLI_FROM_SESSION=$?"
