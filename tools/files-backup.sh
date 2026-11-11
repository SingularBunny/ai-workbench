#!/usr/bin/env bash
# Chat attachments → cloud: files.mjs first updates the local folder, then rclone
# uploads only the difference. The cloud is an encrypted (crypt) rclone remote: attachments
# may contain keys and passwords, and they cannot be scrubbed from images and archives (docs/features/chat-archive.md, "Attachments").
# The encryption password lives only in ~/.config/rclone/rclone.conf: lose it and the copy is unreadable.
#
#   tools/files-backup.sh [--dry-run]
# From ~/.openclaw/.env: WORKBENCH_FILES_DIR (default ~/ai-workbench-files),
# WORKBENCH_FILES_REMOTE (e.g. gdrive-crypt:) — without it, local copy only.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
[[ -f ~/.openclaw/.env ]] && { set -a; . ~/.openclaw/.env; set +a; }
dir="${WORKBENCH_FILES_DIR:-$HOME/ai-workbench-files}"
dry=(); [[ "${1:-}" == "--dry-run" ]] && dry=(--dry-run)

node migrate/claude-desktop/files.mjs --to "$dir" "${dry[@]}" || exit 1
remote="${WORKBENCH_FILES_REMOTE:-}"
if [[ -z "$remote" ]]; then echo "WORKBENCH_FILES_REMOTE is not set — not uploading to the cloud"; exit 0; fi
command -v rclone >/dev/null || { echo "rclone not found — see docs/features/chat-archive.md, \"Attachments\""; exit 1; }
# The remote must encrypt: check that its type is crypt rather than trusting its name.
type=$(rclone config show "${remote%%:*}" 2>/dev/null | awk -F' = ' '$1=="type"{print $2}')
[[ "$type" == crypt ]] || { echo "${remote%%:*}: type \"${type:-no such remote}\", crypt required — not uploading without encryption"; exit 1; }
# copy, not sync: files deleted in Claude Desktop are not erased from the cloud.
rclone copy "$dir" "$remote" --update --stats-one-line --stats 30s "${dry[@]}"
