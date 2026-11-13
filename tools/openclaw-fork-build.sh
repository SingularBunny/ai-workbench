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
#   tools/openclaw-fork-build.sh [--release] <fork folder> [<where to put the .tgz>]
# The fork folder can also come from WORKBENCH_OPENCLAW_SRC.
set -euo pipefail
build=build:ci-artifacts
[[ "${1:-}" == --release ]] && { build=build; shift; }
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
echo "Fork: $src ($branch, $rev) → $out; build: pnpm $build"
# tar.umask=0022: by default git archive leaves files group-writable, and OpenClaw rejects
# such package folders (browser extension install: "Refusing group/world-writable path").
# A proxy from the environment (HTTPS_PROXY/HTTP_PROXY) reaches the build: the container then shares the host
# network, so a proxy on the host's localhost works too.
net=()
[[ -n "${HTTPS_PROXY:-}${HTTP_PROXY:-}" ]] && net=(--network host -e HTTPS_PROXY -e HTTP_PROXY -e NO_PROXY)
# The packer resolves the package's npm lock against the registry (npm install --package-lock-only, 10-minute
# limit). The aiwb-openclaw-npm volume keeps npm's cache between builds, so a slow network or proxy does not
# stall that step; OPENCLAW_NPM_LOCK_COMMAND_TIMEOUT_MS and OPENCLAW_DOCKER_PACKAGE_INVENTORY_TIMEOUT_MS raise the limits.
for v in OPENCLAW_NPM_LOCK_COMMAND_TIMEOUT_MS OPENCLAW_DOCKER_PACKAGE_INVENTORY_TIMEOUT_MS; do
  [[ -n "${!v:-}" ]] && net+=(-e "$v")
done
git -C "$src" -c tar.umask=0022 archive --format=tar HEAD | docker run --rm -i "${net[@]}" \
  -e BUILD="$build" -e GIT_COMMIT="$commit" -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" -e HOME=/tmp/home -e OPENCLAW_CONTROL_UI_RELEASE_BUILD=1 -e CI=1 \
  -v aiwb-openclaw-pnpm:/pnpm-store -v aiwb-openclaw-npm:/tmp/home/.npm -v "$out":/out "$image" bash -euo pipefail -c '
    mkdir -p /tmp/home /tmp/b /tmp/bin && tar -x -C /tmp/b && cd /tmp/b
    corepack enable --install-directory /tmp/bin && export PATH=/tmp/bin:$PATH
    pnpm config set store-dir /pnpm-store
    pnpm install --frozen-lockfile
    pnpm "$BUILD"
    [[ -f dist/control-ui/index.html ]] || pnpm ui:build
    test -f dist/control-ui/index.html
    # Self-contained package: the root npm pack does not resolve @openclaw/ai from the workspace
    # (prepack refuses; in a release OpenClaw publishes it separately) — OpenClaw builds it this way too.
    node scripts/package-openclaw-for-docker.mjs --allow-unreleased-changelog --skip-build --output-dir /tmp/pack
    f=$(ls /tmp/pack/*.tgz); dst="/out/$(basename "$f" .tgz)-'"$rev"'.tgz"
    cp "$f" "$dst" && chown "$HOST_UID:$HOST_GID" "$dst"'
pkg=$(ls -t "$out"/*-"$rev".tgz | head -1)
echo "Package: $pkg"
echo "sha256: $(sha256sum "$pkg" | cut -d' ' -f1)"
