# Chat archive

Claude Desktop and OpenClaw chats as text in the profile.

Claude Desktop chats → Markdown in `chats/`, one file per chat, with a table of contents in
`chats/INDEX.md`. User and assistant messages are kept in full, tool calls as one line with
collapsed arguments, tool results up to 1000 characters; model thinking and images are not
carried over. Secrets are scrubbed (`‹secret›`): values of secret keys (`*PASS*`, `*TOKEN*`,
`*SECRET*`, `*KEY*`) from `~/.openclaw/.env` and the `--secrets` files, plus patterns of provider
keys, passwords and private keys. When [gitleaks](https://github.com/gitleaks/gitleaks) is installed, the timer
also replaces whatever its rules find that these missed (cloud keys, VPN keys, webhook URLs), using the
profile's `.gitleaks.toml` if there is one. A repeat run rewrites only the files that changed:

```bash
node migrate/claude-desktop/chats.mjs --to <profile>/chats --secrets <.env> --dry-run
```

## New OpenClaw chats → text

Backup: the same `chats/`, the same layout, secret scrubbing and shared table of contents;
the header has `source: openclaw`. Chats are read through the running Gateway
(`sessions.list` including archived ones, `chat.history`), not from the agent's SQLite, which
also holds the keys. Only sessions with a new `updatedAt` are re-read, like rsync's quick check by
file time; an edit that does not move it is seen only with `--all`. For sessions imported from
Claude Desktop, only what was added in OpenClaw is exported, with a `continues:` field (id of the
original chat); sessions with no text of their own are remembered in `chats/.openclaw-skip.json`
(keep it out of git) so they are not read every time. Scheduled runs (`agent:<id>:cron:…`) get a
⏰ and the task prompt in a collapsed block:

```bash
node migrate/openclaw/chats.mjs --to <profile>/chats --secrets <.env> --dry-run
```

`/new` and `/reset` keep the same `sessionId` for the key, and after them `chat.history` returns
only the new part, so a file is a segment of history (field `segment:`, id of the first message):
after a reset a new file is written and the previous one is left alone. Compaction
(`openclaw sessions compact`) does not trim the history in `chat.history`; the file gets a
"context compacted" note. Pass `--secrets` on every run: without it values from `.env` stay in the
text.

## Attachments

Files sent to a chat (`uploads/`) and produced in it (`outputs/`) go not to git but to the local
folder `~/ai-workbench-files/<agent>/<YYYY-MM>/<chat>/` (the same layout as `chats/`; its path is in
the `files:` field of the chat header) and, optionally, to a cloud copy. Attachments may contain
keys and passwords, and these cannot be scrubbed from images and archives, so the cloud copy goes
only through an encrypting rclone remote (`crypt`): the provider sees ciphertext and encrypted
names. The script first updates the local folder, then uploads only the difference and never
deletes anything in the cloud; a remote that is not of type `crypt` is refused. Example with
Google Drive:

```bash
# install rclone 1.60+ from your distribution's packages or rclone.org
rclone config create gdrive drive scope=drive.file     # opens a browser to sign in to Google
rclone config create gdrive-crypt crypt remote=gdrive:ai-workbench-files password=$(rclone obscure '<password>')
echo WORKBENCH_FILES_REMOTE=gdrive-crypt: >> ~/.openclaw/.env
tools/files-backup.sh --dry-run             # then without --dry-run
rclone cryptcheck ~/ai-workbench-files gdrive-crypt:    # verify the copy
```

The encryption password is stored only in `~/.config/rclone/rclone.conf`; save it in a password
manager: without it the copy cannot be read. Names longer than ~143 bytes (≈70 Cyrillic
characters) exceed 255 bytes after encryption; Google Drive allows this, a regular disk does not.
