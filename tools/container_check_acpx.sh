#!/usr/bin/env bash
# Part of tools/validate_in_docker.sh with --acpx-package, runs inside the container with the Gateway running: the
# ACPX plugin built from the fork (WORKBENCH_ACPX_PACKAGE) replaced the npm one. The installer keeps the package in
# ~/.openclaw/workbench/acpx-package.tgz and installs it from there (npm-pack); the Gateway then answers the fork's
# own ACPX methods, which the npm build does not have ("unknown method").
#   ACPX_SHA=<package sha256> bash container_check_acpx.sh
echo "==== acpx from the fork"
kept=~/.openclaw/workbench/acpx-package.tgz
[[ "$(sha256sum "$kept" 2>/dev/null | cut -d' ' -f1)" == "$ACPX_SHA" ]]; echo "ACPX_FORK_KEPT=$?"
openclaw plugins inspect acpx --json 2>/dev/null > /tmp/acpx-inspect.json
KEPT=$kept python3 - <<'PY'
import json, os
t = open("/tmp/acpx-inspect.json").read()
try: i = json.loads(t[t.index("{"):]).get("install", {})
except ValueError: i = {}
print("ACPX_FORK_RECORD", i.get("artifactKind"), i.get("sourcePath"), i.get("version"))
print(f"ACPX_FORK_INSTALLED={0 if i.get('artifactKind') == 'npm-pack' and i.get('sourcePath') == os.environ['KEPT'] else 1}")
PY
openclaw gateway call acpx.chat.handoff.get --params '{"sessionKey":"agent:main:main"}' --json > /tmp/acpx-handoff.json 2>&1
echo "ACPX_FORK_HANDOFF_CALL=$?"
python3 - <<'PY'
import json
t = open("/tmp/acpx-handoff.json").read()
try: r = json.loads(t[t.index("{"):])
except ValueError: r = None
print(f"ACPX_FORK_HANDOFF={0 if isinstance(r, dict) and 'binding' in r and 'agents' in r else 1}")
if not (isinstance(r, dict) and 'agents' in r): print("ACPX_FORK_HANDOFF_OUT", t.strip()[-400:])
else: print("ACPX_FORK_HANDOFF_AGENTS", r["agents"])
PY
