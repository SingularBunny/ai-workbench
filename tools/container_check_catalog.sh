#!/usr/bin/env bash
# Part of tools/validate_in_docker.sh, runs inside the container with the Gateway running:
# the "Claude Code" section as a ~/claude-projects folder tree (migrate/claude-desktop/claude-code-catalog.mjs)
# on made-up chats. Unrelated sessions exhaust the OpenClaw catalog scan limit (64 MB), yet the
# wanted ones are still visible: with titles, by folder, in full; scheduled runs and archived are hidden;
# of the parts of one chat ("<chat> (N)") one is visible — the one with the latest message, without the number.
echo "==== catalog"
node=$(command -v node || find ~/.openclaw -maxdepth 5 -type f -path "*/bin/node" | head -1)
# The projects folder of the made-up Claude Code chats (the tree scripts have no default).
export WORKBENCH_CLAUDE_DESKTOP_ROOT="$HOME/claude-projects"
openclaw config set plugins.entries.anthropic.config.sessionCatalog.enabled true --strict-json >/dev/null 2>&1
python3 - <<'PY'
import json, os
home = os.path.expanduser("~")
def rec(sid, n, role, text, cwd):
    m = {"role": role, "content": text} if role == "user" else {"role": role, "model": "claude-x", "content": [{"type": "text", "text": text}]}
    return {"type": role, "uuid": f"{sid[:8]}-0000-4000-8000-{n:012d}", "parentUuid": None, "sessionId": sid, "entrypoint": "local-agent",
            "timestamp": f"2026-01-0{n}T10:00:00.000Z", "cwd": cwd, "message": m}
def cc(folder, sid, texts, title=None):
    cwd = f"{home}/claude-projects/{folder}"
    os.makedirs(cwd, exist_ok=True)
    d = os.path.join(home, ".claude/projects", "".join(c if c.isascii() and c.isalnum() else "-" for c in cwd))
    os.makedirs(d, exist_ok=True)
    rs = [rec(sid, i, r, t, cwd) for i, (r, t) in enumerate(texts, 1)]
    if title: rs.append({"type": "custom-title", "customTitle": title, "sessionId": sid})
    open(f"{d}/{sid}.jsonl", "w").write("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rs))
ids = {k: f"{n}{n}{n}{n}{n}{n}{n}{n}-0000-4000-8000-000000000000" for k, n in
       [("base", 1), ("part", 2), ("sched", 3), ("arch", 4), ("orchard", 5), ("alone", 6), ("old", 7), ("fresh", 8)]}
cc("Garden", ids["base"], [("user", "CAT_FIRST_MARK"), ("assistant", "Утром."), ("user", "Спасибо")], title="Полив (2)")
cc("Garden", ids["part"], [("user", "Ещё?"), ("assistant", "Вечером.")], title="Полив (1)")
cc("Garden", ids["alone"], [("user", "Записать"), ("assistant", "Записал.")], title="Заметки (1)")
# A Claude Desktop chat and its part written to later: the part is visible.
cc("Garden", ids["old"], [("user", "Сажать?"), ("assistant", "Да.")], title="Посадка (1)")
cc("Garden", ids["fresh"], [("user", "Что дальше?"), ("assistant", "Полить."), ("user", "Хорошо")], title="Посадка (2)")
cc("Garden", ids["sched"], [("user", "Утренний обзор"), ("assistant", "Готово.")])
cc("Garden", ids["arch"], [("user", "Старое"), ("assistant", "Да.")])
cc("Сад", ids["orchard"], [("user", "Обрезка"), ("assistant", "Весной.")])
# Claude Desktop: titles, a scheduled run, an archived chat.
acc = os.path.join(home, ".config/Claude/local-agent-mode-sessions/acc-1/ws-1"); os.makedirs(acc, exist_ok=True)
json.dump({"spaces": []}, open(f"{acc}/spaces.json", "w"))
for k, extra in [("base", {"title": "Полив"}), ("sched", {"title": "Обзор", "scheduledTaskId": "t1"}),
                 ("arch", {"title": "Архивный", "isArchived": True}), ("orchard", {"title": "Обрезка сада"}), ("old", {"title": "Посадка"})]:
    json.dump({"sessionId": f"local_{k}", "cliSessionId": ids[k], "createdAt": 1767261600000, "lastActivityAt": 1767348000000, **extra},
              open(f"{acc}/local_{k}.json", "w"), ensure_ascii=False)
# Unrelated sessions without metadata: the catalog reads 2 MB of each and hits the limit.
f = os.path.join(home, ".claude/projects/-home-tester-filler"); os.makedirs(f, exist_ok=True)
pad = json.dumps({"type": "x", "pad": "z" * 1000}) + "\n"
for i in range(36):
    open(f"{f}/f{i:04d}0000-0000-4000-8000-000000000000.jsonl", "w").write(pad * 2200)
json.dump(ids, open("/tmp/catalog-ids.json", "w"))
PY
"$node" /opt/ai-workbench/migrate/claude-desktop/claude-code-catalog.mjs --no-adopt > /tmp/catalog-run.log 2>&1; echo "CATALOG_RUN_EXIT=$?"
grep -E 'In tree|Files:' /tmp/catalog-run.log
# The catalog rereads Desktop metadata once a minute.
for i in $(seq 1 20); do
  openclaw gateway call sessions.catalog.list --params '{"catalogId":"claude","limitPerHost":100}' --json > /tmp/catalog-list.json 2>/dev/null
  grep -q 'Заметки' /tmp/catalog-list.json && break; sleep 6
done
python3 - <<'PY'
import json, os
ids = json.load(open("/tmp/catalog-ids.json")); home = os.path.expanduser("~")
d = json.load(open("/tmp/catalog-list.json"))
host = d["catalogs"][0]["hosts"][0]; ss = {s["threadId"]: s for s in host["sessions"]}
print("CATALOG_SESSIONS", len(ss), (host.get("error") or {}).get("code"))
def ok(name, cond): print(f"{name}={0 if cond else 1}")
ok("CATALOG_SCAN_LIMIT_HIT", (host.get("error") or {}).get("code") == "DISCOVERY_TRUNCATED")
ok("CATALOG_BASE", ss.get(ids["base"], {}).get("name") == "Полив" and ss[ids["base"]].get("cwd") == f"{home}/claude-projects/Garden")
ok("CATALOG_PART_HIDDEN", ids["part"] not in ss)
ok("CATALOG_FRESH_PART_WINS", ids["old"] not in ss and ss.get(ids["fresh"], {}).get("name") == "Посадка")
ok("CATALOG_ALONE_NO_INDEX", ss.get(ids["alone"], {}).get("name") == "Заметки")
ok("CATALOG_CYRILLIC_FOLDER", ss.get(ids["orchard"], {}).get("cwd") == f"{home}/claude-projects/Сад")
ok("CATALOG_SCHEDULED_HIDDEN", ids["sched"] not in ss)
ok("CATALOG_ARCHIVED_HIDDEN", ids["arch"] not in ss)
ok("CATALOG_RESUMABLE", ss.get(ids["base"], {}).get("canContinue") is True)
PY
# The chat is read in full: the first message is there.
openclaw gateway call sessions.catalog.read --params "{\"catalogId\":\"claude\",\"hostId\":\"gateway:local\",\"threadId\":\"$(python3 -c 'import json;print(json.load(open("/tmp/catalog-ids.json"))["base"])')\",\"limit\":50}" --json 2>/dev/null | grep -q CAT_FIRST_MARK
echo "CATALOG_READ_FULL=$?"
# Rerun: no changes.
"$node" /opt/ai-workbench/migrate/claude-desktop/claude-code-catalog.mjs --no-adopt | grep -q 'written 0, unchanged 8, removed 0'; echo "CATALOG_RERUN_SAME=$?"
