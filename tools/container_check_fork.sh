#!/usr/bin/env bash
# OpenClaw from the fork inside the container, right after install: the fork package is installed; limits
# and the owner mark are env.vars settings read by the built code (PROJECTS_IMPORT_OWNER checks the mark
# in action); OpenClaw files are not patched, so there are no backup copies.
#   OC_SHA=<package sha256> bash container_check_fork.sh
echo "==== fork"
[[ $(cat ~/.openclaw/workbench/openclaw-package.sha256 2>/dev/null) == "$OC_SHA" ]]; echo "OPENCLAW_FORK_INSTALLED=$?"
grep -rq OPENCLAW_WORKER_PENDING_TASKS ~/.openclaw/tools/node/lib/node_modules/openclaw/dist; echo "OPENCLAW_FORK_READS_SETTINGS=$?"
# Values come from the config file: config get masks env.vars values.
python3 - <<'PY'
import json, os
v = json.load(open(os.path.expanduser("~/.openclaw/openclaw.json"))).get("env", {}).get("vars", {})
want = {"OPENCLAW_WORKER_PENDING_TASKS": "4096", "OPENCLAW_WORKER_PENDING_BYTES": "4294967296",
        "OPENCLAW_WORKER_HEAP_MB": "8192", "OPENCLAW_CATALOG_IMPORT_OWNER": "1"}
print("OPENCLAW_FORK_ENV_VARS", sorted(k for k in v if k.startswith("OPENCLAW_")))
print(f"OPENCLAW_FORK_SETTINGS={0 if all(v.get(k) == x for k, x in want.items()) else 1}")
PY
[[ ! -e ~/.openclaw/workbench/openclaw-patches ]]; echo "OPENCLAW_FORK_NO_PATCH_BACKUPS=$?"
