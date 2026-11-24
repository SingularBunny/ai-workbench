#!/usr/bin/env bash
# ai-workbench installer for Linux, macOS and WSL.
#   1. OpenClaw at the pinned version via the official install-cli.sh: Node and CLI in ~/.openclaw,
#      no root and no system packages (OpenClaw's docs/install/installer.md). Skipped if the right version
#      is already installed. With WORKBENCH_OPENCLAW_PACKAGE, the fork package is installed instead;
#      without it, an installed fork is replaced with the official version after a question.
#   2. installer/setup.mjs: config, plugins with dependencies, checks. Shows the install plan
#      and asks for consent.
#
#   installer/install.sh [--dry-run] [--yes] [--plugins-root <dir>]
#   installer/install.sh --uninstall [--dry-run] [--yes]   — restore config and plugins to their state before ai-workbench
set -euo pipefail
trap 'echo "=== INSTALL ABORTED at step: $BASH_COMMAND (exit code $?) ===" >&2' ERR

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
version="$(sed -n 's/^export const OPENCLAW_VERSION = "\(.*\)";$/\1/p' "$here/../openclaw/workbench.config.mjs")"
prefix="${OPENCLAW_PREFIX:-$HOME/.openclaw}"
dry=0; uninstall=0; yes=0
for a in "$@"; do [[ "$a" == "--dry-run" ]] && dry=1; [[ "$a" == "--uninstall" ]] && uninstall=1; [[ "$a" == "--yes" ]] && yes=1; done

case "$(uname -s)" in
  Linux|Darwin) ;;
  *) echo "This OS is not supported by install.sh. Windows: installer/install.ps1" >&2; exit 1 ;;
esac

# Was openclaw on the user's PATH before us: install-cli.sh with --no-onboard does not edit shell
# rc files, so after install a new terminal cannot find `openclaw`.
command -v openclaw >/dev/null || export WORKBENCH_PATH_HINT="$prefix/bin"
export PATH="$prefix/bin:$PATH"
# OpenClaw from the fork: WORKBENCH_OPENCLAW_PACKAGE is an npm package (.tgz, path or https://),
# WORKBENCH_OPENCLAW_PACKAGE_SHA256 is its sha256 (required). The same official install-cli.sh
# installs it (--version <package>), allowing the package install scripts for npm 11 and checking
# that the package is valid. The same package is not reinstalled. Also read from ~/.openclaw/.env.
# The installed package and the one before it are kept in <prefix>/workbench/: the build folder can be
# cleaned, and a package that is no longer there is taken from these copies by its sha256 (rollback).
if [[ -f "$prefix/.env" ]]; then
  while IFS='=' read -r k v; do
    case "$k" in WORKBENCH_OPENCLAW_PACKAGE|WORKBENCH_OPENCLAW_PACKAGE_SHA256|WORKBENCH_BACKUP|WORKBENCH_PROXY_URL|WORKBENCH_PROXY_HOSTS|WORKBENCH_MAINTENANCE_WAIT_MIN|WORKBENCH_MAINTENANCE_EXIT_WAIT_SEC|WORKBENCH_DOCTOR_TIMEOUT_MIN|WORKBENCH_GATEWAY_START_MIN|WORKBENCH_INSTALL_CLI) [[ -n "${!k:-}" ]] || export "$k=$v" ;; esac
  done < "$prefix/.env"
fi
# Downloads of this script (install-cli.sh, an https:// fork package) follow the optional network proxy of .env:
# with WORKBENCH_PROXY_URL set, a host matching WORKBENCH_PROXY_HOSTS (comma-separated suffixes; unset, `*` or
# `all` — every host) goes through it, everything else direct. No proxy URL — everything direct, as before.
# WORKBENCH_PROXY_ROUTES is not read here. install-cli.sh itself downloads Node and npm packages and follows
# HTTPS_PROXY from the environment.
proxy_for() {
  # tr, not ${x,,}: macOS ships bash 3.2, which has no case conversion.
  local url="${WORKBENCH_PROXY_URL:-}" hosts="${WORKBENCH_PROXY_HOSTS:-}" host h
  host="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  [[ -n "$url" ]] || return 0
  hosts="$(printf '%s' "${hosts// /}" | tr '[:upper:]' '[:lower:]')"
  if [[ -z "$hosts" || "$hosts" == "*" || "$hosts" == "all" ]]; then echo "$url"; return 0; fi
  IFS=',' read -ra list <<< "$hosts"
  for h in "${list[@]}"; do
    h="${h#.}"; [[ -n "$h" ]] || continue
    [[ "$host" == "$h" || "$host" == *".$h" ]] && { echo "$url"; return 0; }
  done
}
fetch() {
  local src="$1" out="$2" host proxy
  host="${src#https://}"; host="${host%%/*}"; host="${host%%:*}"
  proxy="$(proxy_for "$host")"
  # The route that fails falls back to the other one: the proxy is preferred for its hosts, never required.
  if [[ -n "$proxy" ]]; then
    echo "Downloading from $host through the proxy in WORKBENCH_PROXY_URL…"
    curl -fsSL --proto '=https' --tlsv1.2 --proxy "$proxy" "$src" -o "$out" && return 0
    echo "The proxy failed for $host; trying directly…"
    curl -fsSL --proto '=https' --tlsv1.2 "$src" -o "$out"
  else
    curl -fsSL --proto '=https' --tlsv1.2 "$src" -o "$out" && return 0
    [[ -n "${WORKBENCH_PROXY_URL:-}" ]] || return 1
    echo "The direct download from $host failed; trying through the proxy in WORKBENCH_PROXY_URL…"
    curl -fsSL --proto '=https' --tlsv1.2 --proxy "$WORKBENCH_PROXY_URL" "$src" -o "$out"
  fi
}
# install-cli.sh downloads Node and npm packages and follows HTTPS_PROXY. Without one in the environment the
# npm registry is probed directly first; when that fails (24.11.2026: direct requests stalled for 20 s and broke
# mid-body, the Gateway stayed stopped ~1 h) and WORKBENCH_PROXY_URL answers, the replacement goes through it.
# Prints the proxy to use, or nothing for direct.
npm_route() {
  [[ -n "${HTTPS_PROXY:-${https_proxy:-}}" ]] && return 0
  local probe="${WORKBENCH_NPM_PROBE_URL:-https://registry.npmjs.org/semver/-/semver-7.6.3.tgz}"
  curl -fsS -o /dev/null --max-time "${WORKBENCH_NPM_PROBE_SEC:-20}" "$probe" 2>/dev/null && return 0
  [[ -n "${WORKBENCH_PROXY_URL:-}" ]] || return 0
  curl -fsS -o /dev/null --max-time "${WORKBENCH_NPM_PROBE_SEC:-20}" --proxy "$WORKBENCH_PROXY_URL" "$probe" 2>/dev/null \
    && echo "$WORKBENCH_PROXY_URL"
}
# WORKBENCH_INSTALL_CLI: a local install-cli.sh instead of the download (offline installs, installer tests).
get_install_cli() {
  if [[ -n "${WORKBENCH_INSTALL_CLI:-}" ]]; then cp "$WORKBENCH_INSTALL_CLI" "$1"; else fetch https://openclaw.ai/install-cli.sh "$1"; fi
}
# OpenClaw agents started by an IDE (`openclaw acp`, JetBrains AI Assistant) keep running the files of the
# package they started from: after OpenClaw is replaced they must be restarted, the installer cannot do it.
ide_agents() { ps -eo pid=,args= 2>/dev/null | awk '/openclaw/ { for (i = 3; i <= NF; i++) if ($i == "acp") { print $1; break } }' | paste -sd, -; }
# With WORKBENCH_BACKUP, a snapshot of the OpenClaw databases goes to its Git repository before OpenClaw is
# replaced (incremental: only changed content is committed). A failed snapshot does not stop the install.
backup_before_replace() {
  local dir="${WORKBENCH_BACKUP:-}"; dir="${dir/#\~/$HOME}"
  [[ -n "$dir" && -d "$dir/.git" ]] && command -v openclaw >/dev/null || return 0
  echo "Backing up the OpenClaw databases to $dir before the replacement…"
  openclaw backup git create --repository "$dir" --all >/dev/null 2>&1 || echo "⚠ backup before the replacement failed; continuing. Check: openclaw backup git create --repository $dir --all" >&2
}
# Replacing OpenClaw restarts the Gateway (install-cli.sh restarts the service; a running Gateway also restarts when
# it sees its files replaced). Rule: never restart it in the middle of an agent turn. Wait until no Gateway session
# has a running turn (sessions.list, status running; queued ones do not count). No Gateway: nothing to wait for.
wait_gateway_idle() {
  command -v openclaw >/dev/null || return 0
  local node_q; node_q="$(command -v node || find "$prefix" -maxdepth 5 -type f -path '*/bin/node' 2>/dev/null | head -1)"
  [[ -x "$node_q" ]] || return 0
  local count_js='const { pathToFileURL } = await import("node:url");
const { runningSessions } = await import(pathToFileURL(process.argv[1]).href); let t = ""; for await (const c of process.stdin) t += c;
const i = t.indexOf("{"); if (i < 0) process.exit(3); const keys = runningSessions(JSON.parse(t.slice(i)));
console.log(keys.length ? `${keys.length} ${keys.join(", ")}` : "0");'
  local jobs_js='const { pathToFileURL } = await import("node:url");
const { upcomingAutomations } = await import(pathToFileURL(process.argv[1]).href); let t = ""; for await (const c of process.stdin) t += c;
const i = t.indexOf("{"); if (i < 0) process.exit(3); console.log(upcomingAutomations(JSON.parse(t.slice(i))).join(", "));'
  local out jobs shown=0 jshown=0 since=$SECONDS
  while :; do
    out="$(openclaw gateway call sessions.list --params '{"activeOnly":true,"limit":500}' --json 2>/dev/null \
      | "$node_q" --input-type=module -e "$count_js" "$here/lib.mjs" 2>/dev/null)" || out=""
    if [[ -z "$out" || "$out" == "0" ]]; then
      jobs="$(openclaw cron list --json 2>/dev/null | "$node_q" --input-type=module -e "$jobs_js" "$here/lib.mjs" 2>/dev/null)" || jobs=""
      [[ -n "$jobs" ]] || { (( shown )) && echo "No agent turns or scheduled runs are due any more; continuing."; return 0; }
      if (( ! jshown )); then
        echo "Scheduled automations run or start within 15 minutes: $jobs. Waiting so OpenClaw is not replaced under them."
        echo "Ctrl+C stops the install; nothing has been changed yet."
        jshown=1 shown=1
      fi
      sleep 15
      continue
    fi
    if (( ! shown )) || (( (SECONDS - since) % 300 < 15 && SECONDS - since >= 300 )); then
      echo "Gateway: ${out%% *} agent turn(s) running (${out#* }). Waiting for them to finish before OpenClaw is replaced"
      echo "(the replacement restarts the Gateway). Ctrl+C stops the install; nothing has been changed yet."
      shown=1
    fi
    sleep 15
  done
}
# Maintenance mode (fork: gateway.maintenance.*, installer/maintenance.mjs): from before OpenClaw is replaced until
# setup.mjs ends, the Gateway starts no chat turn: Control UI messages wait in its outbox and send themselves after,
# durable channel messages stay queued, automations and heartbeats are deferred, config and plugin writes go on.
# The state is on disk, so it survives the restart of the replacement; it ends on every exit of this script
# (trap), and on its own after 2 hours if the script is killed. A Gateway without it: wait_gateway_idle as before.
# If the Gateway cannot be reached at the end (a failed upgrade), `maint exit` retries while it is still starting and
# then clears the installer's state file directly: a failed install never leaves chats paused.
maintenance_on=0 replaced=0
run_node() {
  local n; n="$(command -v node || find "$prefix" -maxdepth 5 -type f -path '*/bin/node' 2>/dev/null | head -1)"
  [[ -x "$n" ]] && command -v openclaw >/dev/null || return 2
  "$n" "$@"
}
maint() { run_node "$here/maintenance.mjs" "$@"; }
upg() { run_node "$here/upgrade.mjs" "$@"; }
resume_chats() {
  (( maintenance_on )) || return 0
  maintenance_on=0
  maint exit || true
}
# Upgrade safety (installer/upgrade.mjs). A Gateway service is stopped before OpenClaw is replaced and started by the
# installer only after `openclaw config validate` passes for the new version: legacy keys a new version retired are
# repaired by `openclaw doctor --fix --non-interactive` (openclaw.json backed up first). A config that stays invalid
# leaves the Gateway stopped with restore steps, instead of a Gateway that crashes on start. After the start the
# installer waits for the Gateway's health and runs no setup against a Gateway that is down.
gw_stopped=0 gw_leave_down=0
# rc 2 of upg: no Node or no openclaw to run the check with — nothing to check.
wait_up() { local rc=0; upg wait-up || rc=$?; (( rc == 0 || rc == 2 )) && return 0; gw_leave_down=1; exit 1; }
# Running: the service is active or starting, or its Gateway answers. $1: the line of `upg status`.
gw_running() { local l=($1); [[ "${l[2]:-0}" == 1 || "${l[1]:-}" =~ ^(active|activating|reloading|deactivating)$ ]]; }
stop_gateway_service() {
  echo "Stopping the Gateway service for the replacement; it starts again once the config is checked for the new version…"
  gw_stopped=1
  # --force: a non-interactive stop (without it OpenClaw refuses to stop the operator's service).
  openclaw gateway stop --force >/dev/null 2>&1 || true
  local st i
  for ((i = 0; i < 120; i++)); do   # the fork waits for agent turns on stop; maintenance has drained them
    st="$(upg status 2>/dev/null)" || st=""
    gw_running "$st" || return 0
    (( i == 3 )) && command -v systemctl >/dev/null && systemctl --user stop openclaw-gateway >/dev/null 2>&1 || true
    sleep 3
  done
  echo "✗ The Gateway service did not stop (state: ${st:-unknown}); OpenClaw was not replaced. Stop it" >&2
  echo "  (systemctl --user stop openclaw-gateway) and run the install again." >&2
  exit 1
}
start_gateway_service() {
  command -v systemctl >/dev/null && systemctl --user reset-failed openclaw-gateway >/dev/null 2>&1 || true
  openclaw gateway install --force || openclaw gateway start || echo "⚠ the Gateway service did not start; checking…" >&2
}
replace_openclaw() {   # $1: install-cli.sh, $2: its --version argument
  local st; st="$(upg status 2>/dev/null)" || st=""
  local loaded=0; [[ "${st%% *}" == 1 ]] && loaded=1
  local npm_proxy; npm_proxy="$(npm_route)"
  [[ -n "$npm_proxy" ]] && echo "The npm registry does not answer directly; npm goes through the proxy in WORKBENCH_PROXY_URL."
  (( loaded )) && stop_gateway_service
  if [[ -n "$npm_proxy" ]]; then
    HTTPS_PROXY="$npm_proxy" HTTP_PROXY="$npm_proxy" https_proxy="$npm_proxy" http_proxy="$npm_proxy" \
      npm_config_fetch_timeout=600000 npm_config_fetch_retries=5 \
      bash "$1" --prefix "$prefix" --version "$2" --no-onboard --runtime-only
  else
    bash "$1" --prefix "$prefix" --version "$2" --no-onboard --runtime-only
  fi
  replaced=1
  local rc=0; upg config-check || rc=$?
  (( rc == 0 || rc == 2 )) || { gw_leave_down=1; exit 1; }
  if (( loaded )); then
    echo "Starting the Gateway service of the new OpenClaw…"
    start_gateway_service
    gw_stopped=0
    rc=0; upg wait-up --no-report || rc=$?
    if (( rc == 1 )); then
      # A new version can refuse to start until doctor migrates its databases ("schema version … run openclaw
      # doctor --fix"): one repair with the service stopped, then one more start.
      echo "The Gateway did not start; running openclaw doctor --fix once and starting it again…"
      command -v systemctl >/dev/null && systemctl --user stop openclaw-gateway >/dev/null 2>&1 || openclaw gateway stop --force >/dev/null 2>&1 || true
      upg doctor || true
      start_gateway_service
      wait_up
    fi
    gateway_checked=1
  fi
}
# Exit in the middle of a replacement (download failed, Ctrl+C): the Gateway stopped for it starts again.
restart_stopped_gateway() {
  (( gw_stopped && ! gw_leave_down )) || return 0
  gw_stopped=0
  echo "Starting the Gateway service again (the install stopped before it finished)…" >&2
  start_gateway_service >/dev/null 2>&1 || echo "⚠ Start it: systemctl --user start openclaw-gateway (or openclaw gateway start)" >&2
}
gateway_checked=0
cleanup_dirs=()
on_exit() { restart_stopped_gateway; resume_chats; (( ${#cleanup_dirs[@]} )) && rm -rf "${cleanup_dirs[@]}"; return 0; }
trap on_exit EXIT
trap 'exit 130' INT TERM
# Pauses chats and waits for running turns. $1: what follows, for the messages.
pause_chats() {
  (( dry )) && return 0
  local rc=0
  if (( maintenance_on )); then maint ensure >/dev/null || true; return 0; fi
  # A Gateway service that is starting does not answer yet: `maint enter` would read it as "no Gateway" and the
  # replacement would go on without pausing chats or waiting for turns (24.11.2026). Wait for it first.
  local st; st="$(upg status 2>/dev/null)" || st=""
  if gw_running "$st" && [[ "$(echo "$st" | cut -d' ' -f3)" != 1 ]]; then
    echo "The Gateway is starting; waiting for it before pausing chats…"
    upg wait-up --no-report >/dev/null || true
  fi
  maint enter || rc=$?
  case "$rc" in
    0) maintenance_on=1 ;;
    3) maint exit >/dev/null || true
       if (( replaced )); then
         echo "Not continuing: agent turns still run, so $1 would break them. OpenClaw IS already replaced and the" >&2
         echo "Gateway runs the new version; only $1 (config, plugins, skills) was not run. Chats are resumed." >&2
         echo "Run installer/install.sh --yes again later to finish it (the same package is not reinstalled), or raise" >&2
         echo "WORKBENCH_MAINTENANCE_WAIT_MIN (minutes, default 30)." >&2
       else
         echo "Not continuing: agent turns still run, so $1 would break them. Nothing has been changed;" >&2
         echo "chats are resumed. Run the install again later, or raise WORKBENCH_MAINTENANCE_WAIT_MIN (minutes, default 30)." >&2
       fi
       exit 1 ;;
    *) st="$(upg status 2>/dev/null)" || st=""
       # Answers but has no maintenance mode (the official OpenClaw): the idle wait below covers it.
       if gw_running "$st" && [[ "$(echo "$st" | cut -d' ' -f3)" != 1 ]]; then
         echo "Not continuing: the Gateway service runs but does not answer, so chats cannot be paused and running" >&2
         echo "turns cannot be checked. $( (( replaced )) && echo "OpenClaw IS already replaced; " )Check openclaw health and run the install again." >&2
         exit 1
       fi
       if [[ "$1" == "the replacement" ]]; then wait_gateway_idle; fi ;;
  esac
}
ide_agents_note() {
  local pids; pids="$(ide_agents)"
  [[ -n "$pids" ]] || return 0
  echo "OpenClaw agent in the IDE is running (pid $pids) $1: restart the agent in the IDE AI Assistant, or restart the IDE."
}
if (( ! uninstall )) && [[ -n "${WORKBENCH_OPENCLAW_PACKAGE:-}" ]]; then
  want="${WORKBENCH_OPENCLAW_PACKAGE_SHA256:-}"
  [[ "$want" =~ ^[0-9a-f]{64}$ ]] || { echo "WORKBENCH_OPENCLAW_PACKAGE is set, but WORKBENCH_OPENCLAW_PACKAGE_SHA256 is missing or not a sha256." >&2; exit 1; }
  mark="$prefix/workbench/openclaw-package.sha256"
  kept="$prefix/workbench/openclaw-package.tgz" previous="$prefix/workbench/openclaw-package.previous.tgz"
  sha() { (sha256sum "$1" 2>/dev/null || shasum -a 256 "$1") | cut -d' ' -f1; }
  if [[ "$(cat "$mark" 2>/dev/null)" == "$want" ]]; then
    echo "OpenClaw from the fork is already installed ($want)."
    # Installed before the copies were kept: keep it now, if the package is still at hand.
    if (( ! dry )) && [[ ! -f "$kept" && -f "$WORKBENCH_OPENCLAW_PACKAGE" && "$(sha "$WORKBENCH_OPENCLAW_PACKAGE")" == "$want" ]]; then
      cp "$WORKBENCH_OPENCLAW_PACKAGE" "$kept"
    fi
  elif (( dry )); then
    echo "[dry-run] would install OpenClaw from the fork: $WORKBENCH_OPENCLAW_PACKAGE"
  else
    ptmp="$(mktemp -d)"
    if [[ "$WORKBENCH_OPENCLAW_PACKAGE" =~ ^https:// ]]; then
      fetch "$WORKBENCH_OPENCLAW_PACKAGE" "$ptmp/openclaw.tgz"
    elif [[ -f "$WORKBENCH_OPENCLAW_PACKAGE" ]]; then
      cp "$WORKBENCH_OPENCLAW_PACKAGE" "$ptmp/openclaw.tgz"
    else
      for k in "$kept" "$previous"; do
        [[ -f "$k" && "$(sha "$k")" == "$want" ]] && { echo "Fork package $WORKBENCH_OPENCLAW_PACKAGE not found; using the kept copy $k."; cp "$k" "$ptmp/openclaw.tgz"; break; }
      done
      [[ -f "$ptmp/openclaw.tgz" ]] || { echo "Fork package not found: $WORKBENCH_OPENCLAW_PACKAGE (no kept copy with sha256 $want)." >&2; rm -rf "$ptmp"; exit 1; }
    fi
    got="$(sha "$ptmp/openclaw.tgz")"
    [[ "$got" == "$want" ]] || { echo "Fork package: sha256 $got, expected $want — not installing." >&2; rm -rf "$ptmp"; exit 1; }
    pause_chats "the replacement"
    echo "Installing OpenClaw from the fork (sha256 $got) with the official install-cli.sh…"
    backup_before_replace
    ide_agents_note "and will keep the old OpenClaw files"
    get_install_cli "$ptmp/install-cli.sh"
    echo "install-cli.sh sha256: $( (sha256sum "$ptmp/install-cli.sh" 2>/dev/null || shasum -a 256 "$ptmp/install-cli.sh") | cut -d' ' -f1)"
    replace_openclaw "$ptmp/install-cli.sh" "$ptmp/openclaw.tgz"
    mkdir -p "$(dirname "$mark")" && echo "$want" > "$mark"
    if [[ ! -f "$kept" || "$(sha "$kept")" != "$want" ]]; then
      [[ -f "$kept" ]] && mv -f "$kept" "$previous"
      cp "$ptmp/openclaw.tgz" "$kept"
    fi
    ide_agents_note "with the replaced OpenClaw files"
    # Backups left by the old file patches of OpenClaw (removed) do not fit the fork.
    rm -rf "$prefix/workbench/openclaw-patches"
    rm -rf "$ptmp"
  fi
fi
# OpenClaw from the fork is installed (its mark), but WORKBENCH_OPENCLAW_PACKAGE is no longer set. The fork
# has the same version string, so the version check alone would never bring the official package back.
fork_mark="$prefix/workbench/openclaw-package.sha256" to_official=0
if [[ -f "$fork_mark" ]] && { (( uninstall )) || [[ -z "${WORKBENCH_OPENCLAW_PACKAGE:-}" ]]; }; then
  if (( uninstall )); then
    echo "OpenClaw stays installed from the fork ($(cat "$fork_mark")). To return to the official one, run the official"
    echo "install-cli.sh with --prefix $prefix --version $version, then delete $fork_mark."
  else
    echo "OpenClaw from the fork is installed ($(cat "$fork_mark")), but WORKBENCH_OPENCLAW_PACKAGE is not set."
    if (( dry )); then
      echo "[dry-run] would ask whether to replace it with the official OpenClaw $version"
    elif (( yes )); then
      to_official=1
    elif [[ -t 0 ]]; then
      read -r -p "Replace it with the official OpenClaw $version? [y/N] " answer
      [[ "$answer" =~ ^[yY] ]] && to_official=1
    fi
    (( to_official )) || (( dry )) || echo "Keeping OpenClaw from the fork. Set WORKBENCH_OPENCLAW_PACKAGE again to update it, or re-run with --yes to replace it."
  fi
fi
if (( uninstall )); then
  : # uninstall does not install OpenClaw: it removes only our own changes (setup.mjs --uninstall)
elif [[ -n "${WORKBENCH_OPENCLAW_PACKAGE:-}" ]]; then
  : # OpenClaw from the fork was installed above
elif (( ! to_official )) && command -v openclaw >/dev/null && openclaw --version 2>/dev/null | grep -qF "$version"; then
  echo "OpenClaw $version is already installed."
elif (( dry )); then
  echo "[dry-run] would install OpenClaw $version into $prefix with the official install-cli.sh"
else
  pause_chats "the replacement"
  echo "Installing OpenClaw $version into $prefix (official install-cli.sh)…"
  backup_before_replace
  ide_agents_note "and will keep the old OpenClaw files"
  tmp="$(mktemp -d)"; cleanup_dirs+=("$tmp")
  get_install_cli "$tmp/install-cli.sh"
  # Download to a file, not `| bash`: an interrupted download will not run half a script.
  echo "install-cli.sh sha256: $( (sha256sum "$tmp/install-cli.sh" 2>/dev/null || shasum -a 256 "$tmp/install-cli.sh") | cut -d' ' -f1)"
  replace_openclaw "$tmp/install-cli.sh" "$version"
  ide_agents_note "with the replaced OpenClaw files"
  # Now the official package: patches and settings treat it as such. The kept fork copies stay for a return.
  rm -f "$fork_mark"
fi

if ! command -v openclaw >/dev/null; then
  echo "openclaw not found after install. Add $prefix/bin to PATH and try again." >&2
  (( dry )) && exit 0 || exit 1
fi

# Settings below go through a Gateway that runs as a service, and during startup it refuses them ("admission
# closed"): wait until it is ready (WORKBENCH_GATEWAY_START_MIN, default 10). A Gateway service that failed or does
# not come up: the install stops here with its journal and fix steps, setup is not run against it.
if (( ! dry && ! gateway_checked )); then
  wait_up
fi

# Node: the system one if suitable, otherwise the private one from the OpenClaw prefix.
node_bin="$(command -v node || true)"
if [[ -z "$node_bin" ]] || ! "$node_bin" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>=24?0:1)'; then
  node_bin="$(find "$prefix" -maxdepth 5 -type f -path '*/bin/node' 2>/dev/null | head -1)"
fi
[[ -x "$node_bin" ]] || { echo "Node >= 24 not found in PATH or in $prefix." >&2; exit 1; }

# Setup rewrites config, plugins and skills through the Gateway: chats stay paused until it ends. Maintenance from
# before the replacement survived the restart (on disk); `ensure` also covers a Gateway that gained it only now.
pause_chats "the setup"
rc=0
"$node_bin" "$here/setup.mjs" "$@" || rc=$?
resume_chats
exit "$rc"
