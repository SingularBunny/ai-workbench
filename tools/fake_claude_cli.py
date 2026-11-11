#!/usr/bin/env python3
"""Claude CLI stand-in for the Docker validation: the real `claude` is not run in the container.

Replies the way OpenClaw expects from `claude -p --input-format stream-json --output-format
stream-json`: acknowledges `initialize`, answers each user message with `system/init`, an
assistant reply and `result`, and writes the conversation to ~/.claude/projects like Claude CLI.
Each call logs to $FAKE_CLAUDE_LOG (default /tmp/fake-claude): arguments, the text of the
--append-system-prompt-file file and the `initialize` request.
"""
import json
import time
import os
import sys
import uuid

LOG = os.environ.get("FAKE_CLAUDE_LOG", "/tmp/fake-claude")
argv = sys.argv[1:]


def opt(name):
    return argv[argv.index(name) + 1] if name in argv and argv.index(name) + 1 < len(argv) else None


if argv[:1] == ["--version"] or argv[:1] == ["-v"]:
    print("2.1.302 (Claude Code)")
    sys.exit(0)
if argv[:2] == ["auth", "status"]:
    print(json.dumps({"loggedIn": True, "authMethod": "claude.ai", "apiProvider": "firstParty"}))
    sys.exit(0)
if "-p" not in argv and "--print" not in argv:
    sys.exit(0)
# A single turn with the whole reply (`--output-format json`, as the ai-workbench judge calls it): verdict PASS
# for every criterion in the request.
if opt("--output-format") == "json":
    import re
    ids = re.findall(r'- id "([^"]+)"', sys.stdin.read())
    verdict = {"criteria": [{"id": i, "critique": "Claude CLI stand-in", "verdict": "PASS"} for i in ids]}
    print(json.dumps({"type": "result", "subtype": "success", "is_error": False, "result": json.dumps(verdict, ensure_ascii=False)}))
    sys.exit(0)

os.makedirs(LOG, exist_ok=True)
call = {"argv": argv, "cwd": os.getcwd()}
prompt_file = opt("--append-system-prompt-file")
if prompt_file and os.path.exists(prompt_file):
    call["systemPrompt"] = open(prompt_file, encoding="utf-8").read()
with open(os.path.join(LOG, f"call-{os.getpid()}.json"), "w", encoding="utf-8") as f:
    json.dump(call, f, ensure_ascii=False)

# A fork (--fork-session) is a new session, as with the real Claude CLI.
session = str(uuid.uuid4()) if "--fork-session" in argv else opt("--session-id") or opt("--resume") or str(uuid.uuid4())
model = opt("--model") or "default"


def send(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


for line in sys.stdin:
    try:
        msg = json.loads(line)
    except ValueError:
        continue
    if msg.get("type") == "control_request":
        req = msg.get("request") or {}
        if req.get("subtype") == "initialize":
            call["initialize"] = req
            with open(os.path.join(LOG, f"call-{os.getpid()}.json"), "w", encoding="utf-8") as f:
                json.dump(call, f, ensure_ascii=False)
        send({"type": "control_response", "response": {"subtype": "success", "request_id": msg.get("request_id"),
                                                       "response": {"commands": [], "models": []} if req.get("subtype") == "initialize" else {}}})
    elif msg.get("type") == "user":
        # A long turn for "is the turn running" checks: delay seconds come from a file.
        try:
            time.sleep(float(open("/tmp/fake-claude-delay").read().strip() or 0))
        except (OSError, ValueError):
            pass
        text = f"FAKE_CLAUDE_OK model={model}"
        # The conversation goes where Claude CLI writes it: OpenClaw checks the file after a fork.
        proj = os.path.join(os.path.expanduser("~"), ".claude", "projects", "".join(c if c.isascii() and c.isalnum() else "-" for c in os.getcwd()))
        os.makedirs(proj, exist_ok=True)
        with open(os.path.join(proj, f"{session}.jsonl"), "a", encoding="utf-8") as f:
            for role, content in (("user", msg.get("message", {}).get("content", "")), ("assistant", [{"type": "text", "text": text}])):
                f.write(json.dumps({"type": role, "uuid": str(uuid.uuid4()), "sessionId": session, "cwd": os.getcwd(), "entrypoint": "sdk-cli",
                                    "timestamp": "2026-01-01T00:00:00.000Z", "message": {"role": role, "content": content}}, ensure_ascii=False) + "\n")
        send({"type": "system", "subtype": "init", "session_id": session, "model": model, "cwd": os.getcwd(), "tools": []})
        send({"type": "assistant", "session_id": session, "parent_tool_use_id": None, "uuid": str(uuid.uuid4()),
              "message": {"id": "msg_fake", "type": "message", "role": "assistant", "model": model,
                          "content": [{"type": "text", "text": text}], "stop_reason": "end_turn",
                          "usage": {"input_tokens": 1, "output_tokens": 1}}})
        send({"type": "result", "subtype": "success", "is_error": False, "result": text, "session_id": session,
              "num_turns": 1, "stop_reason": "end_turn", "duration_ms": 1, "total_cost_usd": 0,
              "usage": {"input_tokens": 1, "output_tokens": 1}})
