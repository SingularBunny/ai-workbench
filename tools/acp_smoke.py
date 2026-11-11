#!/usr/bin/env python3
"""Launch an agent from acp.json the way JetBrains AI Assistant does: the entry's command, args and
env, with an almost empty environment (an IDE started from the desktop does not know the shell PATH).
Checks initialize and session/new with an empty MCP list (our entry disables IDE MCP) and a non-empty one.

  acp_smoke.py <acp.json> <agent name> <cwd>
"""
import json
import os
import subprocess
import sys
import threading

acp_file, name, cwd = sys.argv[1:4]
entry = json.load(open(acp_file))["agent_servers"][name]
env = {"HOME": os.environ["HOME"], "PATH": "/usr/bin:/bin", **entry.get("env", {})}
p = subprocess.Popen([entry["command"], *entry.get("args", [])], cwd=cwd, env=env, text=True,
                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=open("/tmp/acp-stderr.log", "w"))
answers, ready = {}, threading.Condition()


def reader():
    for line in p.stdout:
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        if "id" in msg and ("result" in msg or "error" in msg):
            with ready:
                answers[msg["id"]] = msg
                ready.notify_all()


threading.Thread(target=reader, daemon=True).start()


def call(i, method, params, timeout=60):
    try:
        p.stdin.write(json.dumps({"jsonrpc": "2.0", "id": i, "method": method, "params": params}) + "\n")
        p.stdin.flush()
    except BrokenPipeError:
        return {"error": {"message": f"agent exited, code {p.poll()}"}}
    with ready:
        ready.wait_for(lambda: i in answers, timeout)
    return answers.get(i, {"error": {"message": "no reply"}})


init = call(1, "initialize", {"protocolVersion": 1, "clientCapabilities": {}})
print("ACP_INIT", "ok" if "result" in init else init["error"].get("message"))
new = call(2, "session/new", {"cwd": cwd, "mcpServers": []})
print("ACP_SESSION", new["result"].get("sessionId", "?") if "result" in new else "✗ " + new["error"].get("message", ""))
mcp = call(3, "session/new", {"cwd": cwd, "mcpServers": [{"name": "x", "command": "/bin/true", "args": [], "env": []}]})
print("ACP_MCP_REJECTED", "error" in mcp)
p.terminate()
