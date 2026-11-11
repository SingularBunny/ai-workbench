#!/usr/bin/env bash
# Inside the tools/validate_in_docker.sh container: OpenClaw agents and the skills of each.
# Project agents must see the same plugin skills as main.
set -uo pipefail
openclaw agents list --json 2>/dev/null > /out/agents.json
for a in $(grep -oE '"id": "[a-z0-9-]+"' /out/agents.json | cut -d'"' -f4); do
  openclaw skills list --agent "$a" --json 2>/dev/null > "/out/skills-$a.json"; echo "SKILLS_AGENT_$a=$?"
done
# Shared memory: the folder in memory.search.extraPaths (the profile's SHARED_MEMORY, else main's memory/);
# a project agent's search by a fact's description finds that fact file from the shared folder, not its own copy.
if ws=$(openclaw config get agents.entries.main.workspace 2>/dev/null | tr -d '"'); then
  echo "MAIN_WORKSPACE=$ws"
  shared=$(openclaw config get memory.search.extraPaths --json 2>/dev/null | python3 -c 'import json,sys; v=json.load(sys.stdin); print(v[0] if v else "")' 2>/dev/null)
  shared=${shared:-$ws/memory}; echo "MEMORY_SHARED_DIR=$shared"
  fact=$(grep -l '^description:' "$shared"/*.md 2>/dev/null | head -1 | xargs -r basename)  # a fact with frontmatter, not an index file
  agent=$(grep -oE '"id": "[a-z0-9-]+"' /out/agents.json | cut -d'"' -f4 | grep -vx main | head -1)
  query=$(grep -m1 '^description:' "$shared/$fact" | cut -d: -f2- | tr -d '"')
  openclaw memory index --agent "$agent" >/out/memory-index.log 2>&1; echo "MEMORY_INDEX=$?"
  openclaw memory search --agent "$agent" --query "$query" --max-results 20 --json 2>/dev/null >/out/memory-search.json; echo "MEMORY_SEARCH=$?"
  # The shared file shows as a path outside the agent's workspace: ../../<shared folder>/memory/<fact>.
  grep -qE "\"path\": \"\.\./[^\"]*/$(basename "$(dirname "$shared")")/memory/$fact\"" /out/memory-search.json; echo "MEMORY_GLOBAL_FOUND=$?"
fi
# Project skills (project.json "skills"): the agent sees the version from its own working folder, not the shared one.
python3 - <<'PY'
import glob, json, subprocess
for f in sorted(glob.glob("/home/tester/plugins/profile/projects/*/project.json")):
    m = json.load(open(f))
    for name, plugin in (m.get("skills") or {}).items():
        r = subprocess.run(["openclaw", "skills", "info", name, "--agent", m["id"], "--json"], capture_output=True, text=True)
        try: d = json.loads(r.stdout[r.stdout.index("{"):])
        except ValueError: d = {}
        print(f"PROJECT_SKILL {m['id']} {name} ← {plugin}: {d.get('source')} {d.get('filePath')}")
PY
# Profile from git: the clone is in place and the secrets hook is linked.
p=/home/tester/plugins/profile
if [[ -d $p/.git ]]; then
  echo "PROFILE_ORIGIN $(git -C $p remote get-url origin)"
  [[ "$(readlink -f $p/.git/hooks/pre-commit)" == "$(readlink -f $p/tools/check-secrets.sh)" ]]; echo "PROFILE_HOOK_LINKED=$?"
fi
