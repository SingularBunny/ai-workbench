#!/usr/bin/env bash
# Installer check in Docker; the host is not touched.
#
# Linux: a clean container (no Node) → the whole installer/install.sh --yes:
#   the official install-cli.sh installs Node and the pinned OpenClaw version, setup.mjs
#   installs bases, own plugins (--link) and settings, then `openclaw config validate`,
#   `plugins list`, `skills list`, Gateway start and `health`.
#   Own plugins and ~/.claude/skills are mounted READ-ONLY.
#   `claude` in the container is a stub for the "is in PATH" check; it is never run.
# Windows: install.ps1 is parsed by the PowerShell parser (syntax, not behavior).
#
#   tools/validate_in_docker.sh [--clean] [--keep] [--distro <name>|--matrix]
#     --distro     — one distro from DISTROS below; debian by default;
#     --matrix     — all first-release distros in parallel, plus a summary;
#     without --clean — developer machine: own plugin clones are mounted (read-only);
#     --clean      — clean machine: no clones, the installer downloads them from the repositories.
#                    SSH keys are not passed into the container: private repositories will not
#                    download, and that is a check too — a skip with a reason, not a failure.
#     --keep       — do not remove the container
#     --profile <dir> — personal profile, $WORKBENCH_PROFILE by default; with neither, the
#                    public build; mounted read-only, clones follow its REPOS;
#     --public     — no profile: the public build, as an outside user gets it
#     --profile-git <dir> — the profile is installed from git: the repository folder is mounted
#                    read-only and cloned over file:// into /home/tester/plugins/profile in the container
#     --openclaw-package <.tgz> — OpenClaw from the fork (tools/openclaw-fork-build.sh) over the pinned version
#     --reinstall  — after the check: reinstall, uninstall by manifest, install again
#                    after uninstall (tools/container_check_reinstall.sh); then an install with the
#                    plugin layout before the rename and the current one over it (container_check_migration.sh)
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
keep=0; clean=0; matrix=0; distro=debian; public=0; reinstall=0; profile_git=""; oc_package=""
profile="${WORKBENCH_PROFILE:-}"
args=("$@")
for ((i=0; i<${#args[@]}; i++)); do
  case "${args[i]}" in
    --keep) keep=1 ;; --clean) clean=1 ;; --matrix) matrix=1 ;;
    --distro) distro="${args[i+1]:-}"; i=$((i+1)) ;;
    --profile) profile="${args[i+1]:-}"; i=$((i+1)) ;;
    --public) public=1 ;;
    --reinstall) reinstall=1 ;;
    --profile-git) profile_git="${args[i+1]:-}"; i=$((i+1)) ;;
    --openclaw-package) oc_package="$(realpath "${args[i+1]:-}")"; i=$((i+1)) ;;
  esac
done
out_root="${VALIDATE_OUT:-$PWD/dist/validate}"; mkdir -p "$out_root"

# First-release matrix: current stable releases as of 2026-11-04.
# Preparation installs only what the test bench itself cannot do without and what a minimal
# image lacks but any workstation has: curl, git, python3 (judge), ps, su, useradd.
# Anything else the installer needs must surface as an error, not be supplied here.
declare -A IMAGE PREP
IMAGE[debian]=debian:trixie-slim;  PREP[debian]="apt-get update -qq && apt-get install -y -qq --no-install-recommends curl ca-certificates git python3 procps >/dev/null"
IMAGE[ubuntu-24.04]=ubuntu:24.04;  PREP[ubuntu-24.04]="${PREP[debian]}"
IMAGE[ubuntu-26.04]=ubuntu:26.04;  PREP[ubuntu-26.04]="${PREP[debian]}"
IMAGE[fedora]=fedora:45;           PREP[fedora]="dnf install -y -q git python3 procps-ng util-linux shadow-utils >/dev/null"
IMAGE[arch]=archlinux:base;        PREP[arch]="pacman -Sy --noconfirm --needed -q git python >/dev/null"
# Document preview (aiwb-plugins/office) runs on a machine with LibreOffice: a plugin dependency,
# not an installer one; other images lack it, so the 503 refusal is checked there.
PREP[debian]+=" && apt-get install -y -qq --no-install-recommends libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui >/dev/null"
DISTROS=(debian ubuntu-24.04 ubuntu-26.04 fedora arch)

mounts=(-v "$PWD:/opt/ai-workbench:ro")
# Own repositories of the public build (aiwb-plugins): on a developer machine the clone already exists and
# is mounted read-only, as for a user; with --clean the installer clones it from the repository.
base_repos=$(node --input-type=module -e 'const m = await import(process.argv[1]); for (const r of m.REPOS || []) console.log(r.dir.split("/")[0])' "$PWD/openclaw/workbench.config.mjs")
# OpenClaw from the fork: the package is read-only; the installer installs it over the pinned version.
oc_sha=""
if [[ -n "$oc_package" ]]; then
  [[ -f "$oc_package" ]] || { echo "no package $oc_package" >&2; exit 1; }
  mounts+=(-v "$oc_package:/mnt/openclaw.tgz:ro"); oc_sha="$(sha256sum "$oc_package" | cut -d' ' -f1)"
fi
# Own plugin clones: on this machine where the installer takes them from (WORKBENCH_PLUGINS_ROOT in the
# environment or ~/.openclaw/.env, else its default); in the container always /home/tester/plugins.
host_root="${WORKBENCH_PLUGINS_ROOT:-$(sed -n 's/^WORKBENCH_PLUGINS_ROOT=//p' "$HOME/.openclaw/.env" 2>/dev/null | tail -1)}"
host_root="${host_root:-${XDG_DATA_HOME:-$HOME/.local/share}/ai-workbench/plugins}"; host_root="${host_root/#\~/$HOME}"
install_args="--yes --plugins-root /home/tester/plugins"; profile_in=""
if [[ -n "$profile_git" ]]; then
  # Profile from git: a file:// clone, the same folder as the user's but taken from the repository.
  profile="$(cd "$profile_git" && pwd)"
  mounts+=(-v "$profile:/mnt/profile-src:ro")
  profile_in=/home/tester/plugins/profile
  install_args+=" --profile file:///mnt/profile-src --profile-dir $profile_in"
  if (( ! clean )); then
    while read -r d; do
      [[ -n "$d" && -d "$host_root/$d" ]] && mounts+=(-v "$host_root/$d:/home/tester/plugins/$d:ro")
    done < <(node --input-type=module -e 'const m = await import(process.argv[1]); for (const r of m.REPOS || []) console.log(r.dir.split("/")[0])' "$profile/profile.mjs")
  fi
  [[ -d "$HOME/.claude/skills" ]] && mounts+=(-v "$HOME/.claude/skills:/home/tester/.claude/skills:ro")
  build="profile from git $profile"
elif (( ! public )) && [[ -n "$profile" && -f "$profile/profile.mjs" ]]; then
  profile="$(cd "$profile" && pwd)"
  # The source is read-only; the container gets a copy: the installer writes into project working folders.
  mounts+=(-v "$profile:/mnt/profile-ro:ro")
  profile_in=/home/tester/plugins/profile
  install_args+=" --profile $profile_in"
  if (( ! clean )); then
    # Clones the profile downloads from repositories: on a developer machine they already exist.
    while read -r d; do
      [[ -n "$d" && -d "$host_root/$d" ]] && mounts+=(-v "$host_root/$d:/home/tester/plugins/$d:ro")
    done < <(node --input-type=module -e 'const m = await import(process.argv[1]); for (const r of m.REPOS || []) console.log(r.dir.split("/")[0])' "$profile/profile.mjs")
  fi
  [[ -d "$HOME/.claude/skills" ]] && mounts+=(-v "$HOME/.claude/skills:/home/tester/.claude/skills:ro")
  build="profile $profile"
else
  (( public )) || echo "No profile set (--profile or WORKBENCH_PROFILE) — checking the public build" >&2
  public=1; build="public build"
fi
# Clones of the public build's own repositories; a profile clone with the same name is already mounted — do not duplicate.
if (( ! clean )); then
  for d in $base_repos; do
    [[ -d "$host_root/$d" && " ${mounts[*]} " != *":/home/tester/plugins/$d:ro "* ]] && mounts+=(-v "$host_root/$d:/home/tester/plugins/$d:ro")
  done
fi
suffix="$( (( clean )) && echo -clean)$( (( public )) && echo -public)"

script='
# tester gets the uid of the owner of the clones: they are mounted with 700/600 permissions, and in Ubuntu
# images uid 1000 is already taken by the ubuntu user, so tester would get a different uid.
getent passwd "$HOST_UID" | cut -d: -f1 | xargs -r userdel -r 2>/dev/null
useradd -m -u "$HOST_UID" -d /home/tester -s /bin/bash tester 2>/dev/null || true
mkdir -p /home/tester/bin && printf "#!/bin/sh\necho \"claude stub: not executed\" >&2; exit 0\n" > /home/tester/bin/claude
[[ -d /mnt/profile-ro ]] && mkdir -p /home/tester/plugins && cp -a /mnt/profile-ro /home/tester/plugins/profile
chmod +x /home/tester/bin/claude && chown -R tester /home/tester/bin /home/tester 2>/dev/null || true
# Clones are mounted under another uid — without safe.directory git does not trust them.
su - tester -c "git config --global --add safe.directory \"*\""
# Dummy Grafana URL: enables the release download and sha256 check; Grafana itself is not needed.
# The state folder is private, as install-cli.sh makes it: OpenClaw rejects a group-writable one
# (browser extension install: "Refusing group/world-writable path").
su - tester -c "mkdir -p -m 700 ~/.openclaw && chmod 700 ~/.openclaw && echo GRAFANA_URL=http://127.0.0.1:3000 >> ~/.openclaw/.env"
# Dummy model key: `automations add` requires the default model to have a key;
# the tasks themselves do not run here and the model is never called.
su - tester -c "echo OPENROUTER_API_KEY=dummy-validate-only >> ~/.openclaw/.env"
# A profile names its own models (ENV); the container has no account for them, so these keep the defaults
# of the public build: an explicit environment variable, even empty, wins over the profile.
echo "export WORKBENCH_DEFAULT_MODEL= WORKBENCH_DEFAULT_RUNTIME= WORKBENCH_FALLBACK_MODELS= WORKBENCH_DREAMING_MODEL= WORKBENCH_JUDGE_MODEL= WORKBENCH_JUDGE_CRITERIA=" >> /home/tester/.profile
# The projects folder of the made-up Claude Code chats (container_check_catalog.sh): the installer passes it to the bridge.
su - tester -c "echo WORKBENCH_CLAUDE_DESKTOP_ROOT=/home/tester/claude-projects >> ~/.openclaw/.env"
# Knowledge base for every agent: a folder of notes, the note in a subfolder as in an Obsidian vault.
su - tester -c "mkdir -p ~/knowledge/garden && echo The orchard quince is pruned in late February. > ~/knowledge/garden/pruning.md && echo WORKBENCH_KNOWLEDGE=~/knowledge >> ~/.openclaw/.env"
# Fork presets: with the fork package catalog-owner is checked by container_check_projects.sh; without it the
# installer skips them and the owner-mark check is skipped too.
su - tester -c "echo WORKBENCH_FORK_PRESETS=worker-limits,catalog-owner >> ~/.openclaw/.env"
[[ -n "$OC_SHA" ]] && su - tester -c "printf \"WORKBENCH_OPENCLAW_PACKAGE=/mnt/openclaw.tgz\nWORKBENCH_OPENCLAW_PACKAGE_SHA256=$OC_SHA\n\" >> ~/.openclaw/.env"
# As after the first Chromium run: the browser data folder exists, so the installer registers the extension host.
# Private, as Chromium itself creates it: OpenClaw rejects a group-writable one.
su - tester -c "mkdir -p ~/.config/chromium/Default && chmod go-w ~/.config && chmod 700 ~/.config/chromium && echo {} > ~/.config/chromium/Default/Preferences"
# As after running JetBrains AI Assistant: the folder and acp.json with a foreign entry, which must survive.
su - tester -c "mkdir -p ~/.jetbrains && echo {\\\"agent_servers\\\":{\\\"Other\\\":{\\\"command\\\":\\\"/x\\\"}}} > ~/.jetbrains/acp.json && cp ~/.jetbrains/acp.json /out/acp-before.json"
su - tester -c "export PATH=/home/tester/bin:\$PATH; cd /opt/ai-workbench && installer/install.sh $INSTALL_ARGS" ; echo "INSTALL_EXIT=$?"
su - tester -c "export PATH=/home/tester/.openclaw/bin:/home/tester/bin:\$PATH
  test -f ~/.config/chromium/NativeMessagingHosts/ai.openclaw.browser_bootstrap.json; echo CHROME_HOST_REGISTERED=\$?
  [[ -n \"$OC_SHA\" ]] && OC_SHA=$OC_SHA bash /opt/ai-workbench/tools/container_check_fork.sh
  echo ==== config validate; openclaw config validate
  echo ==== mcp; openclaw mcp list 2>&1 | grep -vi deprecat; openclaw mcp doctor --probe --json 2>/dev/null > /out/mcp-doctor.json; echo MCP_DOCTOR_EXIT=\$?
  echo ==== plugins list; openclaw plugins list 2>&1 | grep -vi deprecat
  echo ==== skills; openclaw skills list --agent main --json 2>/dev/null > /out/skills.json; echo SKILLS_JSON_EXIT=\$?
  bash /opt/ai-workbench/tools/container_check_agents.sh
  for m in ~/.openclaw/workbench/marketplaces/*/; do [[ -d \$m ]] && echo \"MARKETPLACE_HEAD \$(basename \$m) \$(git -C \$m rev-parse HEAD)\"; done
  openclaw plugins list --json 2>/dev/null > /out/plugins.json
  bash /opt/ai-workbench/tools/container_check_judge.sh
  echo ==== gateway; set -a; . ~/.openclaw/.env; set +a
  (openclaw gateway run > /tmp/gw.log 2>&1 &) ; for i in \$(seq 1 45); do sleep 2; openclaw health >/dev/null 2>&1 && break; done
  # The exit code of health itself, not of the last command in the pipeline.
  openclaw health > /tmp/health.txt 2>&1; echo HEALTH_EXIT=\$?; grep -vi deprecat /tmp/health.txt | head -12
  bash /opt/ai-workbench/tools/container_check_ide.sh
  bash /opt/ai-workbench/tools/container_check_chats.sh
  bash /opt/ai-workbench/tools/container_check_catalog.sh
  bash /opt/ai-workbench/tools/container_check_claude_cli.sh
  bash /opt/ai-workbench/tools/container_check_projects.sh
  bash /opt/ai-workbench/tools/container_check_office.sh
  bash /opt/ai-workbench/tools/container_check_plan.sh
  if [[ -n \"$PROFILE_DIR\" ]]; then
    echo ==== tasks; node=\$(find ~/.openclaw -maxdepth 5 -type f -path \"*/bin/node\" | head -1)
    \$node /home/tester/plugins/aiwb-plugins/mcp/scheduled-tasks/sync.mjs --profile $PROFILE_DIR; echo SYNC_EXIT=\$?
    \$node /home/tester/plugins/aiwb-plugins/mcp/scheduled-tasks/sync.mjs --profile $PROFILE_DIR; echo SYNC2_EXIT=\$?
    openclaw automations list --all --json 2>/dev/null > /out/automations.json
  fi
  echo ==== gateway log tail; grep -vi deprecat /tmp/gw.log | tail -15"
[[ "$REINSTALL" == 1 ]] && su - tester -c "OC_SHA=$OC_SHA bash /opt/ai-workbench/tools/container_check_reinstall.sh \"$INSTALL_ARGS\""
# Plugin rename: an install with the old plugin layout, then the current installer over it (after the reinstall check).
[[ "$REINSTALL" == 1 ]] && su - tester -c "bash /opt/ai-workbench/tools/container_check_migration.sh \"$INSTALL_ARGS\""
'
# Log lines the result is read from; shared by a single run and the summary.
KEY='MIGRATION_[A-Z_]+=|PLAN_[A-Z_]+=|PROJECTS_[A-Z_]+=|OFFICE_[A-Z_]+|SETTINGS_[A-Z_]+|OPENCLAW_FORK_[A-Z_]+|OpenClaw from the fork|PROJECTS_RUN_HOOK|PROJECTS_RUN_STATUS |PROJECTS_MEMORY_PROMPT_TAIL|PROJECTS_FOLDERS |aiwb-memory|CHROME_HOST_[A-Z_]+=|PROJECTS_IMPORT_USER_ROWS|PROJECTS_BACKFILL |Applied: [0-9]+ replacements|Adoption by agents|CLI_|CHATS_|CATALOG_|In tree|Gateway now|Claude Code continuations|PROJECT_SKILL|duplicate skill name|project skill|ACP_|IDE_|PROFILE_ORIGIN|PROFILE_HOOK_LINKED|MARKETPLACE_HEAD|REINSTALL_|UNINSTALL_|INSTALL_AFTER_|keys [0-9]|own plugins after|config after reinstall|SKILLS_AGENT_|MAIN_WORKSPACE|MEMORY_|KNOWLEDGE_|SYNC_EXIT|SYNC2_EXIT|  task |⚠|MCP_DOCTOR_EXIT|sha256 .* matches|✗ |INSTALL_EXIT|HEALTH_EXIT|SKILLS_JSON_EXIT|JUDGE_SKILL|JUDGE_EXIT|JUDGE_CLI_|Judge verdict|Done:|SKIP|✗|Config valid|ABORTED'

run_linux() {  # $1 — a name from DISTROS; log and artifacts go to $out_root/<name><-clean>/
  local d=$1 name="aiwb-install-check-$1" out="$out_root/$1$suffix"
  mkdir -p "$out"; docker rm -f "$name" >/dev/null 2>&1
  { echo "IMAGE=${IMAGE[$d]} $(docker image inspect -f '{{index .RepoDigests 0}}' "${IMAGE[$d]}" 2>/dev/null)"
    docker run --name "$name" -e HOST_UID="$(id -u)" -e INSTALL_ARGS="$install_args" -e PROFILE_DIR="$profile_in" -e REINSTALL="$reinstall" -e OC_SHA="$oc_sha" "${mounts[@]}" -v "$out:/out" "${IMAGE[$d]}" bash -c "${PREP[$d]} || echo PREP_FAILED; $script"
  } >"$out/install.log" 2>&1
  (( keep )) || docker rm -f "$name" >/dev/null 2>&1
}

# Verdict of one log: a marker line NAME=<number> is red when the number is not 0 (NAME=skip is skipped);
# PREP_FAILED and ABORTED are red too. Prints one line and returns the number of red markers.
verdict() {  # $1 — log, $2 — label
  local red skip
  red=$(grep -oE '^[A-Z][A-Z0-9_]+=[0-9]+' "$1" | grep -vE '=0$' | sort -u)
  red=$(printf '%s\n%s' "$red" "$(grep -oE 'PREP_FAILED|ABORTED' "$1" | sort -u)" | sed '/^$/d')
  skip=$(grep -cE '^[A-Z][A-Z0-9_]+=skip' "$1")
  if [[ -n "$red" ]]; then
    echo "RESULT $2: $(wc -l <<<"$red") red, $skip skipped — $(tr '\n' ' ' <<<"$red")"
  else
    echo "RESULT $2: 0 red, $skip skipped"
  fi
  [[ -z "$red" ]] && return 0 || return "$(wc -l <<<"$red")"
}
red_total=0

# One summary cell: ok if the marker line is present and its code is zero.
cell() { local v; v=$(grep -oE "$2=[0-9]+" "$1" | tail -1 | cut -d= -f2); [[ "$v" == 0 ]] && echo ok || echo "✗${v:+ $v}"; }

if (( matrix )); then
  echo "== Linux matrix: ${DISTROS[*]}, $( (( clean )) && echo 'clean machine' || echo 'developer machine'), $build, in parallel"
  for d in "${DISTROS[@]}"; do run_linux "$d" & done; wait
  printf '\n| Distro | Image | Install | config validate | MCP | Judge | Gateway health | ⚠ |\n|---|---|---|---|---|---|---|---|\n'
  for d in "${DISTROS[@]}"; do
    l="$out_root/$d$suffix/install.log"
    v=$(grep -q "Config valid" "$l" && echo ok || echo ✗)
    printf '| %s | %s | %s | %s | %s | %s | %s | %s |\n' "$d" "${IMAGE[$d]}" "$(cell "$l" INSTALL_EXIT)" "$v" \
      "$(cell "$l" MCP_DOCTOR_EXIT)" "$(cell "$l" JUDGE_EXIT)" "$(cell "$l" HEALTH_EXIT)" "$(grep -c '⚠' "$l")"
  done
  echo; echo "Logs: $out_root/<distro>$suffix/install.log"
  for d in "${DISTROS[@]}"; do verdict "$out_root/$d$suffix/install.log" "$d"; red_total=$((red_total + $?)); done
else
  [[ -n "${IMAGE[$distro]:-}" ]] || { echo "Unknown distro: $distro (available: ${DISTROS[*]})" >&2; exit 1; }
  echo "== Linux ($distro, ${IMAGE[$distro]}): install.sh in a container, $( (( clean )) && echo 'clean machine' || echo 'developer machine'), $build (log: $out_root/$distro$suffix/install.log)"
  run_linux "$distro"
  l="$out_root/$distro$suffix/install.log"
  grep -E "$KEY|PREP_FAILED" "$l"
  grep -oE "plugin skill name collision: \"[^\"]+\"" "$l" | sort -u
  verdict "$l" "$distro"; red_total=$?
fi

echo "== Windows: parsing install.ps1 with the PowerShell parser"
docker run --rm -v "$PWD/installer:/i:ro" mcr.microsoft.com/powershell:7.4-debian-12 pwsh -NoProfile -Command '
  $e = $null; $null = [System.Management.Automation.Language.Parser]::ParseFile("/i/install.ps1", [ref]$null, [ref]$e)
  if ($e.Count) { $e | ForEach-Object { "{0}:{1} {2}" -f $_.Extent.StartLineNumber, $_.Extent.StartColumnNumber, $_.Message }; exit 1 } else { "install.ps1: syntax OK" }'
(( $? == 0 )) || red_total=$((red_total + 1))  # install.ps1 does not parse

# Non-zero exit when anything is red: an automatic run must fail, not print and pass.
echo "RESULT total: $red_total red"
(( red_total == 0 ))
