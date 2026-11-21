#!/usr/bin/env bash
# Build OpenClaw from the fork in Docker: an npm package (.tgz) and its sha256, as in the OpenClaw release
# (.github/workflows/openclaw-npm-preflight.yml): pnpm install --frozen-lockfile, pnpm build with
# OPENCLAW_CONTROL_UI_RELEASE_BUILD=1, Control UI, a self-contained package (scripts/package-openclaw-for-docker.mjs).
# The committed tree is built (git archive HEAD): uncommitted changes do not get into the package. The host is
# not touched except for the package folder; the pnpm store is the Docker volume aiwb-openclaw-pnpm (rebuilds do
# not re-download). The container runs as root (it owns the volume); the package is handed to the fork owner.
#
# Fast build (default) — OpenClaw's own ciArtifacts profile: the same JS, Control UI and plugin-sdk entry
# types, but without the shared .d.ts declarations — they take ~95% of tsdown time and run single-threaded.
# OpenClaw and JS plugins do not need them to run. --release — full build, like a release (~30 minutes).
#
# The same run also packs the ACPX plugin (@openclaw/acpx, extensions/acpx) from the same commit: it is a separate
# runtime plugin, not part of the core package, so the fork's ACPX changes reach the workbench only through it.
# It is packed as the plugin npm release packs it (.github/workflows/plugin-npm-release.yml:
# scripts/plugin-npm-publish.sh --pack) and lands next to the core package as openclaw-acpx-<version>-<commit>.tgz.
# --acpx-only — pack only ACPX (a minute; the core package of that commit is already built).
#
#   tools/openclaw-fork-build.sh [--release] [--acpx-only] <fork folder> [<where to put the .tgz>]
# The fork folder can also come from WORKBENCH_OPENCLAW_SRC.
set -euo pipefail
build=build:ci-artifacts core=1
while [[ "${1:-}" == --* ]]; do
  case "$1" in
    --release) build=build ;;
    --acpx-only) core=0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done
src=$(realpath "${1:-${WORKBENCH_OPENCLAW_SRC:?pass the OpenClaw fork checkout as the first argument or set WORKBENCH_OPENCLAW_SRC}}")
out=$(realpath -m "${2:-$(dirname "$(realpath "$0")")/../dist/openclaw-fork}")
image=node:24.22.1-bookworm
mkdir -p "$out"
rev=$(git -C "$src" rev-parse --short=12 HEAD)
# git archive carries no .git: the commit goes to the build as GIT_COMMIT (scripts/write-build-info.ts),
# so dist/build-info.json and `openclaw --version` name the fork commit: "OpenClaw <version> (<commit>)".
commit=$(git -C "$src" rev-parse HEAD)
branch=$(git -C "$src" rev-parse --abbrev-ref HEAD)
[[ -z "$(git -C "$src" status --porcelain --untracked-files=no)" ]] || echo "⚠ the fork has uncommitted changes — they will not get into the package" >&2
echo "Fork: $src ($branch, $rev) → $out; build: $( ((core)) && echo "pnpm $build + " )ACPX"
# tar.umask=0022: by default git archive leaves files group-writable, and OpenClaw rejects
# such package folders (browser extension install: "Refusing group/world-writable path").
# A proxy from the environment (HTTPS_PROXY/HTTP_PROXY) reaches the build: the container then shares the host
# network, so a proxy on the host's localhost works too. Node's own fetch (build plugins) honors it with NODE_USE_ENV_PROXY=1.
net=()
[[ -n "${HTTPS_PROXY:-}${HTTP_PROXY:-}" ]] && net=(--network host -e HTTPS_PROXY -e HTTP_PROXY -e NO_PROXY -e NODE_USE_ENV_PROXY=1)
# The packer resolves the package's npm lock against the registry (npm install --package-lock-only, 10-minute
# limit). The aiwb-openclaw-npm volume keeps npm's cache between builds, so a slow network or proxy does not
# stall that step; OPENCLAW_NPM_LOCK_COMMAND_TIMEOUT_MS and OPENCLAW_DOCKER_PACKAGE_INVENTORY_TIMEOUT_MS raise the limits.
for v in OPENCLAW_NPM_LOCK_COMMAND_TIMEOUT_MS OPENCLAW_DOCKER_PACKAGE_INVENTORY_TIMEOUT_MS; do
  [[ -n "${!v:-}" ]] && net+=(-e "$v")
done
git -C "$src" -c tar.umask=0022 archive --format=tar HEAD | docker run --rm -i "${net[@]}" \
  -e BUILD="$build" -e CORE="$core" -e REV="$rev" -e GIT_COMMIT="$commit" -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" -e HOME=/tmp/home -e OPENCLAW_CONTROL_UI_RELEASE_BUILD=1 -e CI=1 \
  -v aiwb-openclaw-pnpm:/pnpm-store -v aiwb-openclaw-npm:/tmp/home/.npm -v "$out":/out "$image" bash -euo pipefail -c '
    mkdir -p /tmp/home /tmp/b /tmp/bin && tar -x -C /tmp/b && cd /tmp/b
    corepack enable --install-directory /tmp/bin && export PATH=/tmp/bin:$PATH
    pnpm config set store-dir /pnpm-store
    pnpm install --frozen-lockfile
    # ACPX first: it needs only the install (the plugin release packs it from a fresh checkout too), so a
    # broken core build does not hide it. The package-local runtime build and npm lock check run inside; the
    # runtime build output is removed afterwards, so the core build starts from the archived tree.
    mkdir -p /tmp/acpx
    OPENCLAW_PLUGIN_NPM_PACK_OUTPUT_DIR=/tmp/acpx bash scripts/plugin-npm-publish.sh --pack extensions/acpx >/dev/null
    rm -rf extensions/acpx/dist
    f=$(ls /tmp/acpx/*.tgz); dst="/out/$(basename "$f" .tgz)-$REV.tgz"
    cp "$f" "$dst" && chown "$HOST_UID:$HOST_GID" "$dst"
    [[ "$CORE" == 1 ]] || exit 0
    pnpm "$BUILD"
    [[ -f dist/control-ui/index.html ]] || pnpm ui:build
    test -f dist/control-ui/index.html
    # Self-contained package: the root npm pack does not resolve @openclaw/ai from the workspace
    # (prepack refuses; in a release OpenClaw publishes it separately) — OpenClaw builds it this way too.
    node scripts/package-openclaw-for-docker.mjs --allow-unreleased-changelog --skip-build --output-dir /tmp/pack
    f=$(ls /tmp/pack/*.tgz); dst="/out/$(basename "$f" .tgz)-$REV.tgz"
    cp "$f" "$dst" && chown "$HOST_UID:$HOST_GID" "$dst"'
# openclaw-<version>-<commit>.tgz is the core, openclaw-acpx-<version>-<commit>.tgz the ACPX plugin.
if ((core)); then
  pkg=$(ls -t "$out"/openclaw-[0-9]*-"$rev".tgz | head -1)
  echo "Package: $pkg"
  echo "sha256: $(sha256sum "$pkg" | cut -d' ' -f1)"
fi
acpx=$(ls -t "$out"/openclaw-acpx-*-"$rev".tgz | head -1)
echo "ACPX package: $acpx"
echo "ACPX sha256: $(sha256sum "$acpx" | cut -d' ' -f1)"
# Old builds pile up (about 115 MB each): keep the packages of the newest WORKBENCH_FORK_BUILDS_KEEP commits
# (default 2: this build and the previous one to roll back to) and the package named in the environment.
keep=${WORKBENCH_FORK_BUILDS_KEEP:-2}
# The installed package is named in the OpenClaw .env, not only in this shell's environment.
env_file="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}/.env"
installed_pkg=$(sed -n 's/^WORKBENCH_OPENCLAW_PACKAGE=//p' "$env_file" 2>/dev/null | tail -1)
installed_acpx=$(sed -n 's/^WORKBENCH_ACPX_PACKAGE=//p' "$env_file" 2>/dev/null | tail -1)
mapfile -t revs < <(ls -t "$out"/openclaw-*.tgz 2>/dev/null | sed -E 's/.*-([0-9a-f]{12})\.tgz$/\1/' | awk '!seen[$0]++' | head -n "$keep")
for f in "$out"/openclaw-*.tgz; do
  r=$(basename "$f" .tgz); r=${r##*-}
  [[ " ${revs[*]} " == *" $r "* || "$f" == "${WORKBENCH_OPENCLAW_PACKAGE:-}" || "$f" == "${WORKBENCH_ACPX_PACKAGE:-}" ||
     "$f" == "$installed_pkg" || "$f" == "$installed_acpx" ]] || rm -f -- "$f"
done
