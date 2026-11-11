#!/usr/bin/env bash
# ai-workbench installer for Linux, macOS and WSL.
#   1. OpenClaw at the pinned version via the official install-cli.sh: Node and CLI in ~/.openclaw,
#      no root and no system packages (docs/install/installer.md). Skipped if the right version
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
    case "$k" in WORKBENCH_OPENCLAW_PACKAGE|WORKBENCH_OPENCLAW_PACKAGE_SHA256|WORKBENCH_BACKUP) [[ -n "${!k:-}" ]] || export "$k=$v" ;; esac
  done < "$prefix/.env"
fi
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
      curl -fsSL --proto '=https' --tlsv1.2 "$WORKBENCH_OPENCLAW_PACKAGE" -o "$ptmp/openclaw.tgz"
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
    wait_gateway_idle
    echo "Installing OpenClaw from the fork (sha256 $got) with the official install-cli.sh…"
    backup_before_replace
    ide_agents_note "and will keep the old OpenClaw files"
    curl -fsSL --proto '=https' --tlsv1.2 https://openclaw.ai/install-cli.sh -o "$ptmp/install-cli.sh"
    echo "install-cli.sh sha256: $( (sha256sum "$ptmp/install-cli.sh" 2>/dev/null || shasum -a 256 "$ptmp/install-cli.sh") | cut -d' ' -f1)"
    bash "$ptmp/install-cli.sh" --prefix "$prefix" --version "$ptmp/openclaw.tgz" --no-onboard
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
  wait_gateway_idle
  echo "Installing OpenClaw $version into $prefix (official install-cli.sh)…"
  backup_before_replace
  ide_agents_note "and will keep the old OpenClaw files"
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  curl -fsSL --proto '=https' --tlsv1.2 https://openclaw.ai/install-cli.sh -o "$tmp/install-cli.sh"
  # Download to a file, not `| bash`: an interrupted download will not run half a script.
  echo "install-cli.sh sha256: $( (sha256sum "$tmp/install-cli.sh" 2>/dev/null || shasum -a 256 "$tmp/install-cli.sh") | cut -d' ' -f1)"
  bash "$tmp/install-cli.sh" --prefix "$prefix" --version "$version" --no-onboard
  ide_agents_note "with the replaced OpenClaw files"
  # Now the official package: patches and settings treat it as such. The kept fork copies stay for a return.
  rm -f "$fork_mark"
fi

if ! command -v openclaw >/dev/null; then
  echo "openclaw not found after install. Add $prefix/bin to PATH and try again." >&2
  (( dry )) && exit 0 || exit 1
fi

# The official install-cli.sh restarts a Gateway that runs as a service. Settings below go through it,
# and during startup it refuses them ("admission closed"): wait until it is ready (at most 3 minutes).
if (( ! dry )) && openclaw gateway status --json 2>/dev/null | grep -q '"loaded": *true'; then
  for _ in $(seq 1 90); do
    h="$(openclaw health 2>&1 || true)"
    [[ "$h" == *"Agents:"* && "$h" != *"still starting"* ]] && break
    sleep 2
  done
fi

# Node: the system one if suitable, otherwise the private one from the OpenClaw prefix.
node_bin="$(command -v node || true)"
if [[ -z "$node_bin" ]] || ! "$node_bin" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>=24?0:1)'; then
  node_bin="$(find "$prefix" -maxdepth 5 -type f -path '*/bin/node' 2>/dev/null | head -1)"
fi
[[ -x "$node_bin" ]] || { echo "Node >= 24 not found in PATH or in $prefix." >&2; exit 1; }

exec "$node_bin" "$here/setup.mjs" "$@"
