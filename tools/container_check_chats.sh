#!/usr/bin/env bash
# Part of tools/validate_in_docker.sh, runs inside the container with the Gateway started manually:
# one-command chat import (migrate/claude-desktop/chats-openclaw.mjs) on a made-up Claude Desktop
# export of two chats, one of them continued in Claude Code (~/.claude/projects).
# Checked: both chats became sessions, the continuation is in the session, a rerun makes no copies and
# adds what is new, the Gateway is back as it was (running — running without CLAUDE_CONFIG_DIR; not running —
# not running), the staging folder is removed.
echo "==== chats"
mig=/opt/ai-workbench/migrate/claude-desktop
# Node is the one OpenClaw installed: the container has none of its own.
node=$(command -v node || find ~/.openclaw -maxdepth 5 -type f -path "*/bin/node" | head -1)
ex=$(mktemp -d); trap 'rm -rf "$ex"' EXIT
python3 - "$ex" <<'PY'
import json, os, sys
ex = sys.argv[1]
def rec(sid, n, role, text, parent):
    m = {"role": role, "content": text} if role == "user" else {"role": role, "model": "claude-x", "content": [{"type": "text", "text": text}]}
    return {"type": role, "uuid": f"00000000-0000-4000-8000-{sid[-4:]}{n:08d}", "parentUuid": parent, "sessionId": sid,
            "timestamp": f"2026-01-0{n}T10:00:00.000Z", "cwd": "/home/tester", "message": m}
def chat(sid, cli, title, texts):
    d = os.path.join(ex, "sessions", "space-1", sid); os.makedirs(d)
    json.dump({"sessionId": f"local_{sid}", "cliSessionId": cli, "createdAt": 1767261600000, "lastActivityAt": 1767348000000, "title": title}, open(f"{d}/metadata.json", "w"))
    rs, p = [], None
    for i, (role, t) in enumerate(texts, 1):
        r = rec(cli, i, role, t, p); rs.append(r); p = r["uuid"]
    open(f"{d}/part.jsonl", "w").write("".join(json.dumps(r) + "\n" for r in rs))
    return rs
a = chat("s1", "11111111-1111-4111-8111-111111111111", "Сад: полив", [("user", "Как поливать?"), ("assistant", "Утром.")])
chat("s2", "22222222-2222-4222-8222-222222222222", "Сад: обрезка", [("user", "Когда обрезать?"), ("assistant", "Весной.")])
# The first chat continued in Claude Code: the same records plus a new message.
cc = os.path.expanduser("~/.claude/projects/-home-tester-garden"); os.makedirs(cc, exist_ok=True)
a.append(rec(a[0]["sessionId"], 3, "user", "CONT_MARK_ONE", a[-1]["uuid"]))
open(f"{cc}/11111111-1111-4111-8111-111111111111.jsonl", "w").write("".join(json.dumps(r) + "\n" for r in a))
PY

# Import sessions and the first chat's history go to files for the checks below.
sessions() { openclaw gateway call sessions.list --params '{"limit":100}' --json 2>/dev/null > /tmp/chats-list.json
  python3 -c 'import json,sys; d=json.load(open("/tmp/chats-list.json")); s=[x for x in d.get("sessions",[]) if "catalog" in x.get("key","")]; print(len(s)); [print(x["key"], file=sys.stderr) for x in s]' 2>/tmp/chats-keys.txt; }
history_has() { local k; for k in $(cat /tmp/chats-keys.txt); do
    openclaw gateway call chat.history --params "{\"sessionKey\":\"$k\",\"limit\":200}" --json 2>/dev/null | grep -q "$1" && return 0; done; return 1; }
gw_env_clean() { local p; for p in $(pgrep -u "$(id -u)" -f '^openclaw-gateway'); do tr '\0' '\n' < /proc/$p/environ | grep -q '^CLAUDE_CONFIG_DIR=' && return 1; done; return 0; }
run() { "$node" $mig/chats-openclaw.mjs --from "$ex" > /tmp/chats-run$1.log 2>&1; local c=$?; grep -E 'Gateway now|Claude Code continuations|Done:|✗|started again' /tmp/chats-run$1.log; return $c; }

run 1; echo "CHATS_RUN1_EXIT=$?"
grep -q 'created 2, updated 0; errors 0' /tmp/chats-run1.log; echo "CHATS_RUN1_CREATED=$?"
openclaw health >/dev/null 2>&1; echo "CHATS_GATEWAY_BACK=$?"
gw_env_clean; echo "CHATS_GATEWAY_ENV_CLEAN=$?"
ls -d /tmp/aiwb-chats-* 2>/dev/null | grep -q .; echo "CHATS_STAGE_REMOVED=$(( ! $? ))"
n=$(sessions); echo "CHATS_SESSIONS $n"; [[ "$n" == 2 ]]; echo "CHATS_SESSIONS_TWO=$?"
history_has CONT_MARK_ONE; echo "CHATS_CONTINUATION=$?"

# A rerun without changes makes no copies; a new message in Claude Code is added.
run 2; echo "CHATS_RUN2_EXIT=$?"
grep -q 'created 0, updated 2; errors 0' /tmp/chats-run2.log; echo "CHATS_RUN2_UPDATED=$?"
[[ "$(sessions)" == 2 ]]; echo "CHATS_RUN2_NO_DUPLICATES=$?"
python3 - <<'PY'
import json, os
f = os.path.expanduser("~/.claude/projects/-home-tester-garden/11111111-1111-4111-8111-111111111111.jsonl")
last = json.loads(open(f).read().splitlines()[-1])
new = {**last, "uuid": last["uuid"][:-1] + "9", "parentUuid": last["uuid"], "timestamp": "2026-01-05T10:00:00.000Z",
       "type": "assistant", "message": {"role": "assistant", "model": "claude-x", "content": [{"type": "text", "text": "CONT_MARK_TWO"}]}}
open(f, "a").write(json.dumps(new) + "\n")
PY
run 3; echo "CHATS_RUN3_EXIT=$?"
history_has CONT_MARK_TWO; echo "CHATS_CONTINUATION_NEW=$?"
[[ "$(sessions)" == 2 ]]; echo "CHATS_RUN3_NO_DUPLICATES=$?"

# Gateway not running: it is not started after the import.
pkill -u "$(id -u)" -f '^openclaw-gateway'; for i in $(seq 1 30); do openclaw health >/dev/null 2>&1 || break; sleep 1; done
run 4; echo "CHATS_RUN4_EXIT=$?"
openclaw health >/dev/null 2>&1; echo "CHATS_NONE_STAYS_DOWN=$(( ! $? ))"
# Gateway back as before the check: the reinstall checks expect it next.
(openclaw gateway run > /tmp/gw.log 2>&1 &); for i in $(seq 1 45); do sleep 2; openclaw health >/dev/null 2>&1 && break; done
