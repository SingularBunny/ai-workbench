#!/usr/bin/env bash
# The Claude Desktop & Code bridge plugin ("Projects" tree, aiwb-plugins/claude-bridge) inside the container with the Gateway running, after
# container_check_catalog.sh (its made-up Garden and Сад chats form the project tree).
# Checked: the "Projects" catalog is visible; tree chats are in project folders; a project agent session
# is a row in its folder linked to the session; continuing an old chat goes to its project's agent,
# not the selected one; repeating the continuation gives the same session; a chat adopted into main before its
# folder had an agent moves there when untouched, and is offered the move when used.
# Settings are restored with retries: a write may hit a Gateway reload.
retry() { for i in 1 2 3 4 5 6; do "$@" >/dev/null 2>&1 && return 0; sleep 3; done; echo "✗ failed: $*"; return 1; }
echo "==== projects"
openclaw agents add sad --workspace "$HOME/ws-sad" --non-interactive >/tmp/projects-agent.log 2>&1 || openclaw agents add sad --workspace "$HOME/ws-sad" >>/tmp/projects-agent.log 2>&1 </dev/null
openclaw agents list --json 2>/dev/null | grep -q '"id": "sad"'; echo "PROJECTS_AGENT_ADDED=$?"
openclaw plugins install --link /home/tester/plugins/aiwb-plugins/claude-bridge --force >/tmp/projects-install.log 2>&1; echo "PROJECTS_PLUGIN_INSTALL=$?"
plugin_before=$(openclaw config get plugins.entries.aiwb-claude-bridge.config --json 2>/dev/null)
openclaw config set plugins.entries.aiwb-claude-bridge.config '{"projects":{"Garden":"main","Сад":"sad"},"memorySync":{"root":"/home/tester/claude-projects"}}' --strict-json >/dev/null 2>&1; echo "PROJECTS_CONFIG=$?"
restart() { pkill -u "$(id -u)" -f '^openclaw-gateway'; for i in $(seq 1 30); do openclaw health >/dev/null 2>&1 || break; sleep 1; done
  (AIWB_CLAUDE_BRIDGE_DEBUG=1 openclaw gateway run > /tmp/gw.log 2>&1 &); for i in $(seq 1 45); do sleep 2; openclaw health >/dev/null 2>&1 && break; done; }
restart
# A session of the Сад project agent: a normal agent turn (the model does not matter — the row appears at once).
openclaw agent --agent sad -m "Hello" --json >/tmp/projects-turn.json 2>&1
list() { openclaw gateway call sessions.catalog.list --params '{"catalogId":"projects","limitPerHost":100}' --json 2>/dev/null > /tmp/projects-list.json; }
list
python3 - <<'PY'
import json
ids = json.load(open("/tmp/catalog-ids.json"))
d = json.load(open("/tmp/projects-list.json"))
cat = (d.get("catalogs") or [{}])[0]
ss = cat.get("hosts", [{}])[0].get("sessions", []) if cat else []
by = {s["threadId"]: s for s in ss}
def ok(name, cond): print(f"{name}={0 if cond else 1}")
print("PROJECTS_ROWS", len(ss), sorted({s.get("customGroup") for s in ss}))
ok("PROJECTS_CATALOG", cat.get("id") == "projects")
agent_rows = [s for s in ss if s.get("sessionKey", "").startswith("agent:sad:")]
ok("PROJECTS_AGENT_SESSION_ROW", bool(agent_rows) and all(s.get("customGroup") == "Сад" for s in agent_rows))
for s in ss: print("PROJECTS_ROW", s.get("customGroup"), "|", s.get("name"), "|", s.get("sessionKey", "-")[:50])
PY
# A long chat in the Сад folder: 300 messages — more than a catalog continuation takes (200).
python3 - <<'PY2'
import json, os
home = os.path.expanduser("~"); sid = "99999999-0000-4000-8000-000000000000"; cwd = f"{home}/claude-projects/Сад"
d = os.path.join(home, ".claude/projects", "".join(c if c.isascii() and c.isalnum() else "-" for c in cwd))
rs = [{"type": "user" if i % 2 == 0 else "assistant", "uuid": f"99999999-0000-4000-8000-{i:012d}", "parentUuid": None, "sessionId": sid,
       "timestamp": f"2026-02-01T10:{i // 60:02d}:{i % 60:02d}.000Z", "cwd": cwd, "entrypoint": "local-agent",
       "message": {"role": "user", "content": f"LONG_{i} question about the garden"} if i % 2 == 0 else {"role": "assistant", "model": "claude-x", "content": [{"type": "text", "text": f"LONG_{i} answer about the garden"}]}}
      for i in range(300)]
rs.append({"type": "custom-title", "customTitle": "Длинный чат", "sessionId": sid})
open(f"{d}/{sid}.jsonl", "w").write("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rs))
ids = json.load(open("/tmp/catalog-ids.json")); ids["long"] = sid; json.dump(ids, open("/tmp/catalog-ids.json", "w"))
PY2
# Tree chats are adopted by project agents via the tree script; the Сад folder chat goes to the sad agent.
node=$(command -v node || find ~/.openclaw -maxdepth 5 -type f -path "*/bin/node" | head -1)
# The projects folder of the made-up Claude Code chats (the tree scripts have no default).
export WORKBENCH_CLAUDE_DESKTOP_ROOT="$HOME/claude-projects"
# A tree script run and how many chats it adopted: "adopted N, errors M". With the fork the plugin adopts in
# the Gateway and the script only says so; then N is the count of imported sessions that appeared after the
# plugin's pass (it adopts a few seconds after the tree changes).
imported() { openclaw gateway call sessions.list --params '{"limit":1000}' --json 2>/dev/null | python3 -c 'import json,sys; print("\n".join(sorted(s["key"] for s in json.load(sys.stdin)["sessions"] if ":catalog-import:" in s["key"])))'; }
adopt_run() {
  local before after out
  before=$(imported)
  out=$("$node" /opt/ai-workbench/migrate/claude-desktop/claude-code-catalog.mjs "$@" 2>&1); echo "$out" > /tmp/projects-adopt-run.log
  if grep -q 'done by the plugin in the Gateway' <<<"$out"; then
    sleep 30; after=$(imported)
    echo "adopted $(comm -13 <(echo "$before") <(echo "$after") | sed '/^$/d' | wc -l), errors 0"
  else grep -oE 'adopted [0-9]+, errors [0-9]+' <<<"$out" | tail -1; fi
}
for i in 1 2 3 4 5 6; do "$node" /opt/ai-workbench/migrate/claude-desktop/claude-code-catalog.mjs > /tmp/projects-adopt.log 2>&1; code=$?
  grep -qE 'adopted [0-9]+, errors 0' /tmp/projects-adopt.log && break; sleep 15; done; echo "PROJECTS_ADOPT_EXIT=$code"
grep -E 'Adoption by agents|✗' /tmp/projects-adopt.log
# The plugin moves an already imported chat to its folder's agent on its own pass: wait for the Сад chat.
orchard_moved() { python3 -c '
import hashlib, json
t = json.load(open("/tmp/catalog-ids.json"))["orchard"]
d = hashlib.sha256(json.dumps(["claude", "gateway:local", None, t], separators=(",", ":")).encode()).hexdigest()
ss = json.load(open("/tmp/projects-list.json"))["catalogs"][0]["hosts"][0]["sessions"]
raise SystemExit(0 if any(s.get("sessionKey", "").startswith("agent:sad:") and s["sessionKey"].endswith(d) for s in ss) else 1)' 2>/dev/null; }
for i in $(seq 1 30); do list; orchard_moved && break; sleep 3; done
python3 - <<'PY2'
import json
ids = json.load(open("/tmp/catalog-ids.json"))
ss = json.load(open("/tmp/projects-list.json"))["catalogs"][0]["hosts"][0]["sessions"]
def ok(name, cond): print(f"{name}={0 if cond else 1}")
# The tree after adoption: a Gateway restart before this check may already have imported the chats under main;
# the plugin then moves a project folder's chat to its agent. An imported chat is listed by its session, whose
# key is a hash of the Claude thread (buildSessionCatalogImportKey), so a thread finds its row either way.
import hashlib
by = {s["threadId"]: s for s in ss}
for t in ids.values():
    digest = hashlib.sha256(json.dumps(["claude", "gateway:local", None, t], separators=(",", ":")).encode()).hexdigest()
    # Right after adoption the old copy under main may still be listed: the adopted one is the newest.
    rows = [s for s in ss if s.get("sessionKey", "").endswith(f":catalog-import:{digest}")]
    if rows: by[t] = max(rows, key=lambda s: s.get("updatedAt") or 0)
ok("PROJECTS_TREE_GARDEN", by.get(ids["base"], {}).get("customGroup") == "Garden")
ok("PROJECTS_TREE_SAD", by.get(ids["orchard"], {}).get("customGroup") == "Сад")
orchard = [s for s in ss if s["threadId"] == ids["orchard"]]
adopted = [s for s in ss if "catalog-import" in s.get("sessionKey", "") and s["threadId"].startswith("s:")]
ok("PROJECTS_ADOPTED_PROJECT_AGENT", any(s["sessionKey"].startswith("agent:sad:") and s.get("customGroup") == "Сад" for s in adopted))
ok("PROJECTS_ADOPTED_GARDEN_MAIN", any(s["sessionKey"].startswith("agent:main:") and s.get("customGroup") == "Garden" for s in adopted))
ok("PROJECTS_NO_DUPLICATE", not orchard)
ok("PROJECTS_ALL_BOUND", all(s.get("sessionKey") for s in ss))
open("/tmp/projects-imported-keys", "w").write("\n".join(s["sessionKey"] for s in adopted))
open("/tmp/projects-adopted-key", "w").write(next((s["threadId"] for s in adopted if s["sessionKey"].startswith("agent:sad:")), ""))
long = [s for s in adopted if s.get("name") == "Длинный чат"]
open("/tmp/projects-long-key", "w").write(long[0]["sessionKey"] if long else "")
PY2
# Adopted sessions are shared, not drafts (a draft shows as a ghost in the panel).
openclaw gateway call sessions.list --params '{"limit":500}' --json 2>/dev/null | python3 -c '
import json, sys
keys = set(open("/tmp/projects-imported-keys").read().split())
vis = {s["key"]: s.get("visibility") for s in json.load(sys.stdin)["sessions"]}
print("PROJECTS_IMPORTED_VISIBILITY", sorted({str(vis.get(k)) for k in keys}), len(keys))
print(f"PROJECTS_IMPORTED_SHARED={0 if keys and all(vis.get(k) == "shared" for k in keys) else 1}")'
# Clicking a row opens the same session; adopting again creates nothing.
t=$(cat /tmp/projects-adopted-key)
openclaw gateway call sessions.catalog.continue --params "{\"catalogId\":\"projects\",\"hostId\":\"gateway:local\",\"threadId\":\"$t\",\"agentId\":\"main\"}" --json 2>&1 | grep -q "\"sessionKey\": \"${t#s:}\""; echo "PROJECTS_CLICK_OPENS_SESSION=$?"
[[ "$(adopt_run)" == "adopted 0, errors 0" ]]; echo "PROJECTS_ADOPT_IDEMPOTENT=$?"

# Full history: all 300 messages of the long chat are in the session.
lk=$(cat /tmp/projects-long-key)
openclaw gateway call chat.history --params "{\"sessionKey\":\"$lk\",\"limit\":1}" --json 2>/dev/null | python3 -c 'import json,sys; t=json.load(sys.stdin).get("totalMessages",0); print("PROJECTS_LONG_MESSAGES", t); print(f"PROJECTS_FULL_HISTORY={0 if t >= 300 else 1}")'
# Own chats carry the owner mark, as in Claude Code: no "imported — untrusted" note and no
# external content wrappers (in the fork; without the fork OpenClaw writes them — informational only).
openclaw gateway call chat.history --params "{\"sessionKey\":\"$lk\",\"limit\":20}" --json 2>/dev/null > /tmp/projects-long-history.json
openclaw gateway call aiwb-fork-settings.effective --json 2>/dev/null > /tmp/projects-fork.json
python3 - <<'PY2'
import json
t = open("/tmp/projects-long-history.json").read()
try: fork = json.load(open("/tmp/projects-fork.json")).get("fork")
except Exception: fork = None
marks = ("EXTERNAL_UNTRUSTED_CONTENT" in t, "imported transcript content" in t)
print("PROJECTS_IMPORT_PLAIN_MARKS wrappers, note:", marks, "fork:", bool(fork))
ok = "LONG_" in t and not any(marks)
if fork: print("PROJECTS_IMPORT_PLAIN=" + ("0" if ok else "1"))
PY2
# The catalog-owner preset (fork only): messages of an adopted chat belong to the owner, and session-backfill picks
# them up (without the mark OpenClaw treats the adopted transcript as someone else's).
python3 - <<'PY3'
import json, os, sqlite3, sys
try: fork = json.load(open("/tmp/projects-fork.json")).get("fork")
except Exception: fork = None
if not fork: print("PROJECTS_IMPORT_OWNER=skip (no fork)"); sys.exit(0)
db = os.path.expanduser("~/.openclaw/agents/sad/agent/openclaw-agent.sqlite")
c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
q = "select count(*) from transcript_events where event_json like '%catalog-import%' and event_json like '%\"role\":\"user\"%'"
n, owner = c.execute(q).fetchone()[0], c.execute(q + " and event_json like '%senderIsOwner\":true%'").fetchone()[0]
print("PROJECTS_IMPORT_USER_ROWS", n, "owner", owner)
print(f"PROJECTS_IMPORT_OWNER={0 if n and owner == n else 1}")
PY3
openclaw memory session-backfill --agent sad --json 2>/dev/null > /tmp/projects-backfill.json
# Without the fork there is no owner mark, and backfill rightly skips the imported messages.
python3 - <<'PY4' || echo "PROJECTS_BACKFILL_SEES_IMPORT=1"
import json
d = json.load(open("/tmp/projects-backfill.json"))
print("PROJECTS_BACKFILL", len(d["days"]), "days", d["candidateCount"], "candidates", d["applied"])
try: fork = json.load(open("/tmp/projects-fork.json")).get("fork")
except Exception: fork = None
if fork: print(f"PROJECTS_BACKFILL_SEES_IMPORT={0 if d['candidateCount'] and not d['applied'] else 1}")
else: print("PROJECTS_BACKFILL_SEES_IMPORT=skip (no fork: no owner mark)")
PY4
# Continuation uses the same Claude CLI chat: a turn through the stand-in, --resume <chat id> with a fork.
export FAKE_CLAUDE_LOG=/tmp/fake-claude-projects; rm -rf "$FAKE_CLAUDE_LOG"
cp /home/tester/bin/claude /tmp/claude-stub.bak; install -m 755 /opt/ai-workbench/tools/fake_claude_cli.py /home/tester/bin/claude
before=$(openclaw config get agents.defaults.model --json 2>/dev/null)
openclaw config set agents.defaults.model '{"primary":"anthropic/claude-opus-5-5"}' --strict-json >/dev/null
openclaw config set 'agents.defaults.models["anthropic/claude-opus-5-5"].agentRuntime' '{"id":"claude-cli"}' --strict-json >/dev/null
restart
openclaw agent --session-key "$lk" -m "Let's continue" --json > /tmp/projects-cont.json 2>&1
grep -q FAKE_CLAUDE_OK /tmp/projects-cont.json; echo "PROJECTS_CONTINUE_REPLY=$?"
python3 - <<'PY2'
import glob, json
ids = json.load(open("/tmp/catalog-ids.json"))
calls = [json.load(open(f)) for f in glob.glob("/tmp/fake-claude-projects/call-*.json")]
turn = [c["argv"] for c in calls if "--replay-user-messages" in c["argv"]]
a = turn[-1] if turn else []
print("PROJECTS_TURN_FLAGS", " ".join(x for x in a if x.startswith("--")))
ok = "--resume" in a and a[a.index("--resume") + 1] == ids["long"] and "--fork-session" in a
print(f"PROJECTS_RESUMES_SAME_CHAT={0 if ok else 1}")
PY2
# After the fork: adopting again creates nothing, the second turn goes to the fork without a new one.
[[ "$(adopt_run)" == "adopted 0, errors 0" ]]; echo "PROJECTS_AFTER_FORK_NO_REIMPORT=$?"
rm -rf "$FAKE_CLAUDE_LOG"; openclaw agent --session-key "$lk" -m "More" --json > /tmp/projects-cont2.json 2>&1
python3 - <<'PY2'
import glob, json
ids = json.load(open("/tmp/catalog-ids.json"))
turn = [c["argv"] for c in (json.load(open(f)) for f in glob.glob("/tmp/fake-claude-projects/call-*.json")) if "--replay-user-messages" in c["argv"]]
a = turn[-1] if turn else []
ok = "--resume" in a and a[a.index("--resume") + 1] != ids["long"] and "--fork-session" not in a
print(f"PROJECTS_SECOND_TURN_IN_FORK={0 if ok else 1}")
PY2
# Re-homing (aiwb-claude-bridge rehome.js): chats adopted into main while their folder had no agent. Three made-up chats
# of the folder Огород, which has no project agent yet, are adopted into main: one stays untouched (pinned, renamed and
# read: metadata, not turns), one gets a turn in main, one is archived. Then the folder gets its agent: the untouched
# chat moves there by itself, the used one stays and is offered the move (the chat menu button calls
# sessions.catalog.move), the archived one stays archived.
python3 - <<'PY2'
import json, os
home = os.path.expanduser("~"); cwd = f"{home}/claude-projects/Огород"; os.makedirs(cwd, exist_ok=True)
d = os.path.join(home, ".claude/projects", "".join(c if c.isascii() and c.isalnum() else "-" for c in cwd)); os.makedirs(d, exist_ok=True)
ids = {"beds": "c1c1c1c1-0000-4000-8000-000000000000", "water": "c2c2c2c2-0000-4000-8000-000000000000", "compost": "c3c3c3c3-0000-4000-8000-000000000000"}
for k, title in [("beds", "Грядки"), ("water", "Полив огорода"), ("compost", "Компост")]:
    sid = ids[k]
    rs = [{"type": r, "uuid": f"{sid[:8]}-0000-4000-8000-00000000000{i}", "parentUuid": None, "sessionId": sid, "entrypoint": "local-agent",
           "timestamp": f"2026-03-0{i + 1}T10:00:00.000Z", "cwd": cwd,
           "message": {"role": r, "content": t} if r == "user" else {"role": r, "model": "claude-x", "content": [{"type": "text", "text": t}]}}
          for i, (r, t) in enumerate([("user", f"REHOME_{k.upper()} question"), ("assistant", f"REHOME_{k.upper()} answer")])]
    rs.append({"type": "custom-title", "customTitle": title, "sessionId": sid})
    open(f"{d}/{sid}.jsonl", "w").write("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rs))
json.dump(ids, open("/tmp/rehome-ids.json", "w"))
PY2
# Session key of a made-up chat imported into an agent (buildSessionCatalogImportKey).
rk() { python3 -c 'import hashlib, json, sys
t = json.load(open("/tmp/rehome-ids.json"))[sys.argv[2]]
print(f"agent:{sys.argv[1]}:catalog-import:" + hashlib.sha256(json.dumps(["claude", "gateway:local", None, t], separators=(",", ":")).encode()).hexdigest())' "$1" "$2"; }
rsid() { openclaw gateway call sessions.list --params '{"limit":1000}' --json 2>/dev/null | python3 -c 'import json,sys; print(next((s["sessionId"] for s in json.load(sys.stdin)["sessions"] if s["key"]==sys.argv[1]), ""))' "$1"; }
mb=$(rk main beds); mw=$(rk main water); mc=$(rk main compost); ob=$(rk ogorod beds)
adopt_run >/dev/null
for i in $(seq 1 20); do list; grep -q "\"$mb\"" /tmp/projects-list.json && grep -q "\"$mw\"" /tmp/projects-list.json && grep -q "\"$mc\"" /tmp/projects-list.json && break; sleep 3; done
grep -q "\"$mb\"" /tmp/projects-list.json && grep -q "\"$mw\"" /tmp/projects-list.json && grep -q "\"$mc\"" /tmp/projects-list.json; echo "PROJECTS_REHOME_ADOPTED_MAIN=$?"
openclaw gateway call sessions.patch --params "{\"key\":\"$mb\",\"pinned\":true}" --json > /tmp/rehome-patch.log 2>&1
openclaw gateway call sessions.patch --params "{\"key\":\"$mb\",\"label\":\"Грядки весной\"}" --json >> /tmp/rehome-patch.log 2>&1
openclaw gateway call sessions.patch --params "{\"key\":\"$mb\",\"unread\":false}" --json >> /tmp/rehome-patch.log 2>&1
openclaw agent --session-key "$mw" -m "REHOME_USED_MARK water the beds" --json > /tmp/rehome-turn.json 2>&1
grep -q FAKE_CLAUDE_OK /tmp/rehome-turn.json; echo "PROJECTS_REHOME_USED_TURN=$?"
openclaw gateway call sessions.patch --params "{\"key\":\"$mc\",\"expectedSessionId\":\"$(rsid "$mc")\",\"archived\":true}" --json >> /tmp/rehome-patch.log 2>&1
# The folder gets its agent.
openclaw agents add ogorod --workspace "$HOME/ws-ogorod" --non-interactive >/tmp/rehome-agent.log 2>&1 || openclaw agents add ogorod --workspace "$HOME/ws-ogorod" >>/tmp/rehome-agent.log 2>&1 </dev/null
retry openclaw config set plugins.entries.aiwb-claude-bridge.config '{"projects":{"Garden":"main","Сад":"sad","Огород":"ogorod"},"memorySync":{"root":"/home/tester/claude-projects"}}' --strict-json
for i in $(seq 1 60); do list; grep -q "\"$ob\"" /tmp/projects-list.json && break; sleep 3; done
grep -E "aiwb-claude-bridge (moved untouched|untouched chats|adoption by agents)|  ✗ " /tmp/gw.log | tail -8 | sed "s/^/PROJECTS_REHOME_LOG /"
rehome_state() {
  list
  openclaw gateway call sessions.list --params '{"limit":1000}' --json > /tmp/rehome-live.json 2>/dev/null
  openclaw gateway call sessions.list --params '{"limit":1000,"archived":true}' --json > /tmp/rehome-arch.json 2>/dev/null
  openclaw gateway call aiwb-claude-bridge.rehome.offers --params '{}' --json > /tmp/rehome-offers.json 2>/dev/null
}
rehome_state
openclaw gateway call chat.history --params "{\"sessionKey\":\"$ob\",\"limit\":20}" --json > /tmp/rehome-history.json 2>/dev/null
MB=$mb MW=$mw MC=$mc OB=$ob python3 - <<'PY2'
import json, os
mb, mw, mc, ob = (os.environ[k] for k in ("MB", "MW", "MC", "OB"))
# Moving chats between agents relies on the fork's catalog methods (sessions.catalog.move, grants).
try: fork = json.load(open("/tmp/projects-fork.json")).get("fork")
except Exception: fork = None
def ok(name, cond): print(f"{name}={0 if cond else 1}" if fork else f"{name}=skip (no fork)")
def load(f, key):
    try: return json.load(open(f)).get(key) or []
    except Exception: return []
rows = json.load(open("/tmp/projects-list.json"))["catalogs"][0]["hosts"][0]["sessions"]
live = {s["key"]: s for s in load("/tmp/rehome-live.json", "sessions")}
arch = {s["key"]: s for s in load("/tmp/rehome-arch.json", "sessions") if s.get("archived") or s.get("archivedAt")}
offers = load("/tmp/rehome-offers.json", "offers")
by = {s.get("sessionKey"): s for s in rows}
print("PROJECTS_REHOME_ROWS", [(s.get("customGroup"), s.get("name")) for s in rows if "catalog-import" in s.get("sessionKey", "") and s.get("customGroup") in ("Огород", "_no_space")])
print("PROJECTS_REHOME_OFFERS", [(o.get("sessionKey", "")[:30], o.get("folder"), o.get("untouched")) for o in offers])
n = live.get(ob, {})
print("PROJECTS_REHOME_NEW_STATE", {k: n.get(k) for k in ("pinned", "label", "displayName", "lastReadAt", "unread", "visibility")})
ok("PROJECTS_REHOME_AUTO", by.get(ob, {}).get("customGroup") == "Огород" and mb not in by)
ok("PROJECTS_REHOME_OLD_ARCHIVED", mb not in live or bool(live[mb].get("archived")) or mb in arch)
ok("PROJECTS_REHOME_KEEPS_STATE", n.get("pinned") is True and "Грядки весной" in (n.get("label"), n.get("displayName")) and bool(n.get("lastReadAt")) and n.get("visibility") == "shared")
ok("PROJECTS_REHOME_HISTORY", "REHOME_BEDS answer" in open("/tmp/rehome-history.json").read())
ok("PROJECTS_REHOME_USED_STAYS", mw in by and not any(k.startswith("agent:ogorod:") and k.endswith(mw.rsplit(":", 1)[1]) for k in live))
ok("PROJECTS_REHOME_OFFERED", any(o.get("sessionKey") == mw and o.get("folder") == "Огород" and o.get("agentId") == "ogorod" and o.get("untouched") is False for o in offers)
   and not any(o.get("sessionKey") == mb for o in offers))
ok("PROJECTS_REHOME_ARCHIVED_STAYS", mc not in by and not any(k.startswith("agent:ogorod:") and k.endswith(mc.rsplit(":", 1)[1]) for k in list(live) + list(arch)))
PY2
[[ "$(adopt_run)" == "adopted 0, errors 0" ]]; echo "PROJECTS_REHOME_NO_REIMPORT=$?"
# The menu button's request: the used chat moves to the folder's agent with the turn made in main.
openclaw gateway call sessions.catalog.move --params "{\"catalogId\":\"projects\",\"hostId\":\"gateway:local\",\"threadId\":\"s:$mw\",\"group\":\"Огород\"}" --json > /tmp/rehome-move.json 2>&1
nw=$(python3 -c 'import json; print(json.load(open("/tmp/rehome-move.json")).get("sessionKey", ""))' 2>/dev/null)
echo "PROJECTS_REHOME_BUTTON_RESULT $(tr -d '\n' < /tmp/rehome-move.json | cut -c1-300)"
rehome_state
openclaw gateway call chat.history --params "{\"sessionKey\":\"$nw\",\"limit\":20}" --json > /tmp/rehome-history2.json 2>/dev/null
MW=$mw NW=$nw python3 - <<'PY2'
import json, os
mw, nw = os.environ["MW"], os.environ["NW"]
# Moving chats between agents relies on the fork's catalog methods (sessions.catalog.move, grants).
try: fork = json.load(open("/tmp/projects-fork.json")).get("fork")
except Exception: fork = None
def ok(name, cond): print(f"{name}={0 if cond else 1}" if fork else f"{name}=skip (no fork)")
rows = json.load(open("/tmp/projects-list.json"))["catalogs"][0]["hosts"][0]["sessions"]
by = {s.get("sessionKey"): s for s in rows}
live = {s["key"]: s for s in json.load(open("/tmp/rehome-live.json")).get("sessions", [])}
offers = json.load(open("/tmp/rehome-offers.json")).get("offers", [])
ok("PROJECTS_REHOME_BUTTON_MOVED", nw.startswith("agent:ogorod:") and by.get(nw, {}).get("customGroup") == "Огород" and mw not in by
   and (mw not in live or bool(live[mw].get("archived"))) and not any(o.get("sessionKey") == mw for o in offers))
ok("PROJECTS_REHOME_BUTTON_HISTORY", "REHOME_USED_MARK" in open("/tmp/rehome-history2.json").read())
PY2
[[ "$(adopt_run)" == "adopted 0, errors 0" ]]; echo "PROJECTS_REHOME_BUTTON_NO_REIMPORT=$?"
retry openclaw config set plugins.entries.aiwb-claude-bridge.config '{"projects":{"Garden":"main","Сад":"sad"},"memorySync":{"root":"/home/tester/claude-projects"}}' --strict-json
# A new agent chat lives in the Claude Desktop project folder (agents.entries.<id>.cwd), instructions come
# from the agent's working folder; in the tree it is a single row, not adopted.
echo "CWD_KEEPS_MARK: sad agent instructions" >> "$HOME/ws-sad/AGENTS.md"
openclaw config set agents.entries.sad.cwd "\"$HOME/claude-projects/Сад\"" --strict-json >/dev/null; echo "PROJECTS_CWD_SET=$?"
restart; rm -rf "$FAKE_CLAUDE_LOG"
nk="agent:sad:dashboard:cwd-check"
openclaw agent --session-key "$nk" -m "New chat" --json > /tmp/projects-new.json 2>&1
grep -q FAKE_CLAUDE_OK /tmp/projects-new.json; echo "PROJECTS_NEW_CHAT_REPLY=$?"
python3 - <<'PY2'
import glob, json, os
home = os.path.expanduser("~"); cwd = f"{home}/claude-projects/Сад"
d = os.path.join(home, ".claude/projects", "".join(c if c.isascii() and c.isalnum() else "-" for c in cwd))
calls = [json.load(open(f)) for f in glob.glob("/tmp/fake-claude-projects/call-*.json")]
turn = [c for c in calls if "--replay-user-messages" in c["argv"]]
c = turn[-1] if turn else {}
print(f"PROJECTS_NEW_CHAT_CWD={0 if c.get('cwd') == cwd else 1}")
print(f"PROJECTS_CWD_KEEPS_INSTRUCTIONS={0 if 'CWD_KEEPS_MARK' in json.dumps(c.get('initialize', {}), ensure_ascii=False) else 1}")
# The chat is found by its content: by modification time another file written in the same second could win.
files = sorted(glob.glob(f"{d}/*.jsonl"), key=os.path.getmtime)
newest = next((f for f in reversed(files) if "New chat" in open(f).read()), "")
print(f"PROJECTS_NEW_CHAT_IN_PROJECT_FOLDER={0 if newest else 1}")
open("/tmp/projects-new-thread", "w").write(os.path.basename(newest)[:-6] if newest else "")
PY2
[[ "$(adopt_run)" == "adopted 0, errors 0" ]]; echo "PROJECTS_NEW_CHAT_NOT_IMPORTED=$?"
list
python3 - <<'PY2'
import json
t = open("/tmp/projects-new-thread").read().strip()
ss = json.load(open("/tmp/projects-list.json"))["catalogs"][0]["hosts"][0]["sessions"]
mine = [s for s in ss if s.get("sessionKey") == "agent:sad:dashboard:cwd-check"]
print(f"PROJECTS_NEW_CHAT_ONCE={0 if len(mine) == 1 and mine[0].get('customGroup') == 'Сад' and not any(s['threadId'] == t for s in ss) else 1}")
PY2
# A transcript OpenClaw created itself and bound to nothing (recovering an interrupted turn:
# sdk-cli, a history recap) is not a new chat: it goes neither to the tree nor to adoption.
python3 - <<'PY2'
import json, os
home = os.path.expanduser("~"); cwd = f"{home}/claude-projects/Сад"; sid = "abababab-0000-4000-8000-000000000000"
d = os.path.join(home, ".claude/projects", "".join(c if c.isascii() and c.isalnum() else "-" for c in cwd))
rs = [{"type": r, "uuid": f"abababab-0000-4000-8000-00000000000{i}", "sessionId": sid, "cwd": cwd, "entrypoint": "sdk-cli",
       "timestamp": f"2026-02-02T10:00:0{i}.000Z", "message": {"role": r, "content": t}}
      for i, (r, t) in enumerate([("user", "[OpenClaw: 12 earlier messages in this chat …] Continue"), ("assistant", "Continuing.")])]
open(f"{d}/{sid}.jsonl", "w").write("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rs))
PY2
[[ "$(adopt_run)" == "adopted 0, errors 0" ]] && grep -q 'programmatic Claude CLI runs [1-9]' /tmp/projects-adopt-run.log; echo "PROJECTS_OPENCLAW_TRANSCRIPT_NOT_ADOPTED=$?"
list
python3 - <<'PY2'
import json
ss = json.load(open("/tmp/projects-list.json"))["catalogs"][0]["hosts"][0]["sessions"]
print(f"PROJECTS_OPENCLAW_TRANSCRIPT_NOT_IN_TREE={0 if not any(s['threadId'].startswith('abababab') for s in ss) else 1}")
PY2
# Folder order is custom (order), not by recency; without it, alphabetical.
folders() { list; python3 -c 'import json; ss=json.load(open("/tmp/projects-list.json"))["catalogs"][0]["hosts"][0]["sessions"]; print(" ".join(dict.fromkeys(s.get("customGroup") for s in ss)))'; }
plain=$(folders)
retry openclaw config set plugins.entries.aiwb-claude-bridge.config '{"projects":{"Garden":"main","Сад":"sad"},"order":["Garden"],"memorySync":{"root":"/home/tester/claude-projects"}}' --strict-json
sleep 3; ordered=$(folders)
echo "PROJECTS_FOLDERS alphabetical: $plain | order Garden: $ordered"
# Alphabetically Сад comes before Garden (Cyrillic before Latin); with order, Garden is first.
[[ "$plain" == *"Сад"*"Garden"* && "$ordered" == "Garden "* ]]; echo "PROJECTS_FOLDER_ORDER=$?"
# Whether a turn is running: the session row has status running while the stand-in thinks; stored after the reply.
row_status() { list; python3 -c 'import json,sys; ss=json.load(open("/tmp/projects-list.json"))["catalogs"][0]["hosts"][0]["sessions"]; print(next((s.get("status") for s in ss if s.get("sessionKey") == sys.argv[1]), "-"))' "$1"; }
rk="agent:sad:dashboard:status-check"
openclaw agent --session-key "$rk" -m "Start" --json > /dev/null 2>&1
echo 20 > /tmp/fake-claude-delay
(openclaw agent --session-key "$rk" -m "Think for a long time" --json > /tmp/projects-slow.json 2>&1 &)
sleep 8; during=$(row_status "$rk")
for i in $(seq 1 30); do grep -q FAKE_CLAUDE_OK /tmp/projects-slow.json 2>/dev/null && break; sleep 2; done
rm -f /tmp/fake-claude-delay; sleep 2; after=$(row_status "$rk")
echo "PROJECTS_RUN_STATUS during the turn: $during, after: $after"
[[ "$during" == running && "$after" == stored ]]; echo "PROJECTS_RUN_STATUS=$?"
grep -E "aiwb-claude-bridge (run|list)" /tmp/gw.log | tail -10 | sed 's/^/PROJECTS_RUN_HOOK /'
# Shared memory (aiwb-memory): USER.md and the shared folder index are in the system prompt of any
# agent's turn; for Claude CLI, in initialize (appendSystemPrompt).
mem="$HOME/shared-memory"; mkdir -p "$mem/memory"
echo "SHARED_USER_MARK: the user writes in English" > "$mem/USER.md"
echo "- [Time zone](memory/tz.md) — SHARED_INDEX_MARK" > "$mem/MEMORY.md"
retry openclaw config set plugins.entries.aiwb-memory.config "{\"dir\":\"$mem\"}" --strict-json
retry openclaw config set plugins.entries.aiwb-memory.hooks '{"allowConversationAccess":true,"allowPromptInjection":true}' --strict-json
restart; rm -rf "$FAKE_CLAUDE_LOG"
openclaw agent --session-key "agent:sad:dashboard:memory-check" -m "What do you know about me?" --json > /tmp/projects-mem.json 2>&1
openclaw agent --session-key "agent:main:dashboard:memory-check" -m "What do you know about me?" --json > /tmp/projects-mem-main.json 2>&1
python3 - <<'PY2'
import glob, json
calls = [json.load(open(f)) for f in glob.glob("/tmp/fake-claude-projects/call-*.json")]
inits = [json.dumps(c.get("initialize", {}), ensure_ascii=False) for c in calls if "--replay-user-messages" in c["argv"]]
print("PROJECTS_MEMORY_TURNS", len(inits))
ok = len(inits) >= 2 and all("SHARED_USER_MARK" in i and "SHARED_INDEX_MARK" in i for i in inits)
print(f"PROJECTS_SHARED_MEMORY_IN_PROMPT={0 if ok else 1}")
if not ok and calls:
    sp = (calls[-1].get("initialize") or {}).get("appendSystemPrompt") or ""
    print("PROJECTS_MEMORY_PROMPT_TAIL", len(sp), repr(sp[-300:]))
PY2
grep -iE "aiwb-memory|before_prompt_build|prompt injection" /tmp/gw.log | tail -5
retry openclaw config unset plugins.entries.aiwb-memory.config
retry openclaw config unset plugins.entries.aiwb-memory.hooks
openclaw config unset agents.entries.sad.cwd >/dev/null 2>&1
retry openclaw config set agents.defaults.model "$before" --strict-json
retry openclaw config unset 'agents.defaults.models["anthropic/claude-opus-5-5"]'
cp /tmp/claude-stub.bak /home/tester/bin/claude
# Archive and delete in OpenClaw: an adopted chat does not come back to the tree and is not adopted again;
# "Restore" brings it back; the transcript file is intact; --readopt adopts it again.
catalog_run() { adopt_run "$@" | grep -oE 'adopted [0-9]+'; }
row_of() { list; python3 -c 'import json,sys; ss=json.load(open("/tmp/projects-list.json"))["catalogs"][0]["hosts"][0]["sessions"]; r=[s for s in ss if s["name"]==sys.argv[1]]; print(r[0].get("sessionKey","-") if r else "")' "$1"; }
sid_of() { openclaw gateway call sessions.list --params '{"limit":500}' --json 2>/dev/null | python3 -c 'import json,sys; print(next((s["sessionId"] for s in json.load(sys.stdin)["sessions"] if s["key"]==sys.argv[1]), ""))' "$1"; }
ck=$(row_of "Обрезка сада"); csid=$(sid_of "$ck")
openclaw gateway call sessions.patch --params "{\"key\":\"$ck\",\"expectedSessionId\":\"$csid\",\"archived\":true}" --json >/dev/null 2>&1
[[ "$(catalog_run)" == "adopted 0" && -z "$(row_of "Обрезка сада")" ]]; echo "PROJECTS_ARCHIVED_STAYS_HIDDEN=$?"
openclaw gateway call sessions.patch --params "{\"key\":\"$ck\",\"expectedSessionId\":\"$csid\",\"archived\":false}" --json >/dev/null 2>&1
[[ "$(row_of "Обрезка сада")" == "$ck" ]]; echo "PROJECTS_RESTORED_VISIBLE=$?"
openclaw gateway call sessions.patch --params "{\"key\":\"$ck\",\"expectedSessionId\":\"$csid\",\"archived\":true}" --json >/dev/null 2>&1
openclaw gateway call sessions.delete --params "{\"key\":\"$ck\",\"expectedSessionId\":\"$csid\",\"archivedOnly\":true}" --json > /tmp/projects-del.json 2>&1
grep -q '"ok": true' /tmp/projects-del.json; echo "PROJECTS_DELETED=$?"
[[ "$(catalog_run)" == "adopted 0" && -z "$(row_of "Обрезка сада")" ]]; echo "PROJECTS_DELETED_STAYS_DELETED=$?"
orchard=$(python3 -c 'import json;print(json.load(open("/tmp/catalog-ids.json"))["orchard"])')
ls ~/.claude/projects/*/"$orchard.jsonl" >/dev/null 2>&1; echo "PROJECTS_DELETED_FILES_KEPT=$?"
[[ "$(catalog_run --readopt "Обрезка сада")" == "adopted 1" && -n "$(row_of "Обрезка сада")" ]]; echo "PROJECTS_READOPT=$?"
# Fork settings status (aiwb-fork-settings): a Gateway method returning effective values and their source. With the
# fork package the installer sets them via env.vars; without the fork everything is default.
settings() { openclaw gateway call aiwb-fork-settings.effective --json 2>/dev/null > /tmp/settings.json; }
settings
python3 - <<'PY2'
import json
try: d = json.load(open("/tmp/settings.json"))
except Exception: d = {}
rows = {r["name"]: r for r in d.get("settings", [])}
print("SETTINGS_FORK", bool(d.get("fork")), {k[9:]: (r["value"], r["source"]) for k, r in rows.items()})
if d.get("fork"):
    ok = (rows.get("OPENCLAW_WORKER_PENDING_TASKS", {}).get("value") == 4096 and rows["OPENCLAW_WORKER_PENDING_TASKS"]["source"] == "env.vars"
          and rows.get("OPENCLAW_CATALOG_IMPORT_OWNER", {}).get("value") is True)
else:
    ok = bool(rows) and all(r["source"] == "default" for r in rows.values())
print(f"SETTINGS_EFFECTIVE={0 if ok else 1}")
PY2
# Whether the Gateway picks up an env.vars change without a restart — informational, not a check.
# The Gateway may restart itself on an env.vars edit: wait up to a minute for a reply; pid shows whether it restarted.
pid0=$(python3 -c 'import json; print(json.load(open("/tmp/settings.json")).get("pid", ""))' 2>/dev/null)
retry openclaw config set env.vars.OPENCLAW_CATALOG_CONTINUATION_MAX_ITEMS '"777"' --strict-json
for i in $(seq 1 30); do sleep 2; settings
  python3 -c 'import json,sys; d=json.load(open("/tmp/settings.json")); r={x["name"]: x for x in d["settings"]}["OPENCLAW_CATALOG_CONTINUATION_MAX_ITEMS"]; sys.exit(0 if r["value"] == 777 else 1)' 2>/dev/null && break; done
python3 -c 'import json,sys; d=json.load(open("/tmp/settings.json")); r={x["name"]: x for x in d["settings"]}["OPENCLAW_CATALOG_CONTINUATION_MAX_ITEMS"]; print("SETTINGS_HOT_RELOAD after", sys.argv[1], "2 s attempts:", r["value"], r["source"], "| Gateway", "same" if str(d.get("pid")) == sys.argv[2] else "restarted")' "$i" "$pid0" 2>/dev/null || echo "SETTINGS_HOT_RELOAD no reply within a minute"
retry openclaw config unset env.vars.OPENCLAW_CATALOG_CONTINUATION_MAX_ITEMS
# Plugin settings back as the installer set them: the reinstall check compares them next.
[[ -n "$plugin_before" ]] && retry openclaw config set plugins.entries.aiwb-claude-bridge.config "$plugin_before" --strict-json
restart
