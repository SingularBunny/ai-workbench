#!/usr/bin/env python3
"""Stand-in for `junie --acp=true` in tools/validate_in_docker.sh: a minimal ACP agent over stdio.
initialize and session/new answer as Junie does; session/prompt streams one message
"FAKE_JUNIE_OK <prompt text>" and ends the turn. Every request goes to $FAKE_JUNIE_LOG (default
/tmp/fake-junie.jsonl), so a check sees which methods OpenClaw called and with what."""
import json
import os
import sys
import uuid

LOG = os.environ.get("FAKE_JUNIE_LOG", "/tmp/fake-junie.jsonl")
if "--acp=true" not in sys.argv[1:]:
    print("fake junie: only --acp=true is supported", file=sys.stderr)
    sys.exit(2)


def send(msg):
    sys.stdout.write(json.dumps({"jsonrpc": "2.0", **msg}) + "\n")
    sys.stdout.flush()


for line in sys.stdin:
    try:
        msg = json.loads(line)
    except ValueError:
        continue
    method, params, mid = msg.get("method"), msg.get("params") or {}, msg.get("id")
    if method:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps({"method": method, "params": params}, ensure_ascii=False) + "\n")
    if mid is None or not method:
        continue  # a notification (session/cancel) or a reply to us
    if method == "initialize":
        result = {"protocolVersion": 1, "agentInfo": {"name": "@jetbrains/junie", "title": "Junie", "version": "fake"},
                  "agentCapabilities": {"loadSession": False, "promptCapabilities": {"image": False, "embeddedContext": True}},
                  "authMethods": []}
    elif method == "session/new":
        result = {"sessionId": f"session-fake-{uuid.uuid4().hex[:8]}"}
    elif method == "session/prompt":
        text = " ".join(b.get("text", "") for b in params.get("prompt", []) if b.get("type") == "text")
        send({"method": "session/update", "params": {"sessionId": params.get("sessionId"), "update": {
            "sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": f"FAKE_JUNIE_OK {text[:200]}"}}}})
        result = {"stopReason": "end_turn"}
    else:
        result = {}
    send({"id": mid, "result": result})
