#!/usr/bin/env bash
# Inside the tools/validate_in_docker.sh --upgrade-from container (systemd as PID 1, the Gateway as a systemd user
# service, as on a workstation). Runs as tester; $1 is the install.sh arguments.
#   1. install.sh with the OLD OpenClaw package (/mnt/openclaw-old.tgz), the Gateway as a user service;
#   2. a config key the new version retired (agents.defaults.heartbeat) that the old one accepts;
#   3. install.sh with the NEW package (/mnt/openclaw.tgz): the Gateway must come up healthy, the legacy key
#      repaired by doctor with a backup of openclaw.json, maintenance mode off;
#   4. a Gateway that cannot start (an invalid key, service failed): install.sh stops before setup with the
#      journal, and leaves no maintenance mode on.
# The result is the UPGRADE_* lines (NAME=0 is green).
set -uo pipefail
export PATH=/home/tester/.openclaw/bin:/home/tester/.openclaw/tools/node/bin:/home/tester/bin:$PATH
cd /opt/ai-workbench || exit 1
args="$1"
cfg=~/.openclaw/openclaw.json
mfile=~/.openclaw/gateway-maintenance.json
mark() { echo "$1=$2"; }
set_pkg() {  # $1: package path in the container
  sed -i '/^WORKBENCH_OPENCLAW_PACKAGE/d' ~/.openclaw/.env
  printf 'WORKBENCH_OPENCLAW_PACKAGE=%s\nWORKBENCH_OPENCLAW_PACKAGE_SHA256=%s\n' "$1" "$(sha256sum "$1" | cut -d' ' -f1)" >> ~/.openclaw/.env
}
healthy() {  # up to $1 seconds
  local i; for ((i = 0; i < $1; i += 3)); do
    h="$(openclaw health 2>&1)" && [[ "$h" == *"Agents:"* && "$h" != *"still starting"* ]] && return 0; sleep 3
  done; return 1
}
json_get() { node -e 'const j=require(process.argv[1]); let v=j; for (const k of process.argv[2].split(".")) v=v?.[k]; console.log(JSON.stringify(v ?? null))' "$cfg" "$1"; }
json_set() { node -e 'const fs=require("fs");const p=process.argv[1];const j=JSON.parse(fs.readFileSync(p,"utf8"));const ks=process.argv[2].split(".");let o=j;for(const k of ks.slice(0,-1))o=o[k]??={};o[ks.at(-1)]=JSON.parse(process.argv[3]);fs.writeFileSync(p,JSON.stringify(j,null,2)+"\n")' "$cfg" "$1" "$2"; }

echo "==== upgrade: install with the old OpenClaw"
set_pkg /mnt/openclaw-old.tgz
installer/install.sh $args > /tmp/old-install.log 2>&1; mark UPGRADE_OLD_INSTALL_EXIT $?
tail -5 /tmp/old-install.log
old_version="$(openclaw --version 2>/dev/null)"; echo "old: $old_version"
openclaw gateway install --force > /tmp/gw-install.log 2>&1 || tail -20 /tmp/gw-install.log
healthy 240; mark UPGRADE_OLD_GATEWAY_UP $?

echo "==== upgrade: a key the new version retired"
systemctl --user stop openclaw-gateway
json_set agents.defaults.heartbeat '{"agentId":"main"}'
openclaw config validate >/dev/null 2>&1; mark UPGRADE_OLD_ACCEPTS_LEGACY $?
systemctl --user start openclaw-gateway; healthy 240; mark UPGRADE_OLD_GATEWAY_RESTARTED $?

echo "==== upgrade: install.sh with the new OpenClaw"
set_pkg /mnt/openclaw.tgz
installer/install.sh $args > /tmp/upgrade.log 2>&1; rc=$?
grep -E "config does not fit|Unrecognized|backed up|doctor|Config repaired|Stopping the Gateway|Starting the Gateway|Gateway is up|still invalid|✗|Maintenance mode" /tmp/upgrade.log | head -30
mark UPGRADE_INSTALL_EXIT $rc
new_version="$(openclaw --version 2>/dev/null)"; echo "new: $new_version"
[[ "$new_version" != "$old_version" ]]; mark UPGRADE_VERSION_CHANGED $?
[[ "$(systemctl --user is-active openclaw-gateway)" == active ]]; mark UPGRADE_SERVICE_ACTIVE $?
healthy 60; mark UPGRADE_HEALTH $?
openclaw config validate; mark UPGRADE_CONFIG_VALID $?
[[ "$(json_get agents.defaults.heartbeat)" == null ]]; mark UPGRADE_LEGACY_REPAIRED $?
ls ~/.openclaw/openclaw.json.pre-upgrade-* >/dev/null 2>&1; mark UPGRADE_CONFIG_BACKUP $?
st="$(openclaw gateway call gateway.maintenance.status --params '{}' --json 2>/dev/null)"
[[ ! -f "$mfile" && "$st" == *'"active": false'* || ! -f "$mfile" && "$st" == *'"active":false'* ]]; mark UPGRADE_MAINTENANCE_OFF $?
echo "  maintenance status: $(tr -d '\n ' <<<"$st" | head -c 200)"

echo "==== upgrade: a Gateway that cannot start"
systemctl --user stop openclaw-gateway
json_set gateway.aiwbUpgradeCheckBogusKey 1
systemctl --user start openclaw-gateway
for _ in $(seq 1 40); do [[ "$(systemctl --user is-active openclaw-gateway)" == failed ]] && break; sleep 3; done
echo "  service before the install: $(systemctl --user is-active openclaw-gateway)"
WORKBENCH_GATEWAY_START_MIN=3 installer/install.sh $args > /tmp/dead.log 2>&1; rc=$?
grep -E "✗|Setup was NOT run|journalctl|Maintenance mode" /tmp/dead.log | head -12
(( rc != 0 )) && grep -q "Setup was NOT run" /tmp/dead.log; mark UPGRADE_DEAD_GATEWAY_STOPS $?
[[ ! -f "$mfile" ]]; mark UPGRADE_DEAD_MAINTENANCE_OFF $?
