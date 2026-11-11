# Chats

**By project, as in Claude Desktop**: the "Projects" section of the sidebar (the Claude Desktop & Code bridge
plugin `aiwb-claude-bridge`, folder `claude-bridge/` of the
[aiwb-plugins](https://github.com/SingularBunny/aiwb-plugins) repository, installed by the installer). A project folder holds all its chats: old ones from Claude Desktop and
Claude Code (with a working folder in `<projects folder>/<project>`) and new sessions of that project's agent.
A project folder is its agent: the project name in `project.json` matches the Claude Desktop folder; folders
without a project (`_no_space` and others) go to the main agent. An old chat is imported to the agent with its full history
and bound to the Claude CLI chat itself: the first message continues it as a fork, with full
context, and the original file is not changed. Parts of one chat ("<chat> (1)", "<chat> (2)"…) are merged into
one, under the name of the most recent part without a number; scheduled runs and archived chats are hidden. Transcripts of
programmatic Claude CLI runs (`sdk-cli`) are not imported either: OpenClaw itself creates them for
its own sessions, and when restoring an interrupted turn it also creates chats that retell the history.
Folder order is `plugins.entries.aiwb-claude-bridge.config.order` (folder names top to bottom; unlisted ones
come after, alphabetically); without it, alphabetical. Within a folder the newest chats are on top.

**Drag-and-drop** (OpenClaw from the fork): drag a folder by its header to reorder folders, and a chat within its
folder to reorder chats. The order is kept by the plugin (`~/.openclaw/workbench/aiwb-claude-bridge-order.json`)
and wins over `config.order`; in a folder you arranged, chats that get new activity afterwards (and new chats) go
on top, the arranged ones keep their order below them.

**Archive and delete** (OpenClaw from the fork): in a folder of the project that is open, a chat has the
usual session menu (archive with Undo, delete with confirmation); in other folders, "Delete session" in the
chat's menu archives it ("Restore" in OpenClaw brings it back). A project's main chat ("<project>: main chat")
cannot be archived or deleted, as everywhere in OpenClaw; start it over with `/new` or `/reset` in the chat.

**Moving a chat to another project**, as in Claude Desktop: drop it on a chat of another folder (it lands there)
or on another folder's header (also a collapsed one). The chat then belongs to that project's agent: its
instructions, files and memory, and its working folder `<projects folder>/<project>`. What you see:

- the chat disappears from the old folder at once and appears in the new one under the same title, with its whole
  history;
- the next message continues the same Claude conversation, now in the new project's folder: the Claude Code
  transcript is copied into that folder's Claude Code project (`~/.claude/projects/<folder>/`) as a new
  conversation (new id; the original file is not changed), and the chat continues in that copy;
- the session it had in the old project is archived, not deleted ("Restore" in OpenClaw brings it back; then the
  chat is in both projects);
- Claude Desktop itself still lists the chat in its old project: Claude Desktop files are not changed.

A chat not imported yet moves the same way: it is imported straight into the new project's agent. Not moved: the
main chat of a project, a chat that is answering right now (wait for the turn to end), and chats without a Claude
Code transcript; the sidebar puts such a chat back and shows why. Moving needs the same Gateway grant as importing
in the Gateway (below).

A chat with a turn in progress shows a spinning ring in "Projects" too: the plugin marks the start and end of a turn with hooks
(`plugins.entries.aiwb-claude-bridge.hooks.allowConversationAccess`, set by the installer; the plugin does not
read the conversation). The sidebar re-reads the catalog every ~2 minutes, so the ring lags by up to
two minutes after a turn starts and after it ends. The OpenClaw fork has no delay, and with it the plugin takes
the ring from the Gateway's own session status (`sessions.list`, granted by the installer), so a turn longer than
30 minutes keeps it; without that grant the ring goes out 30 minutes after the turn started.

New agent chats live in the same place as that project's Claude Desktop chats: the installer sets the agent's
run working folder `agents.entries.<id>.cwd` = `<projects folder>/<project name>` (for main,
`_no_space`), and Claude CLI writes the transcript to `~/.claude/projects/<that folder>`; the agent's instructions, memory and
skills stay in its agent workspace in the data repository.

Everything happens automatically if `~/.openclaw/.env` has:

```bash
WORKBENCH_CLAUDE_DESKTOP_ROOT=~/claude-projects
```

and the text chat archive ([Chat archive](chat-archive.md)) if the profile declares it in `profile.mjs`:

```js
export const CHATS = { dir: "chats", secrets: ["~/.config/<project>/.env"], tz: "Europe/Berlin",
  learnedSkills: "learned-skills",     // copy of the agents' learned skills, see "Shared memory"
  commit: ["chats", "learned-skills", "main", "projects", "shared"] };   // committed after each run
```

The installer sets up the systemd user timer `aiwb-claude-catalog` (Linux): every 10 minutes
`migrate/chats-sync.mjs` updates the tree and appends to the text archive: Claude Desktop chats and
OpenClaw sessions. New chats and parts are imported to the agents (already imported ones are left alone)
by the plugin in the Gateway: at Gateway start, a few seconds after the tree changes, and every 10
minutes. With an OpenClaw that does not let the plugin do it (see below), the timer script imports them
instead. With `commit`, each run ends with a local
commit of those folders of the data repository ("Sync: chat archive, agent memory and learned skills"):
only they are committed, so your own edits elsewhere in the repository stay yours; the repository's hooks
(secret checks) run as for any commit, and a refused commit fails the run and leaves nothing staged; a
repository in the middle of a commit, merge or rebase is skipped until the next run. Nothing is pushed:
push when you want the commits on the remote. Without `commit`, commit the archive yourself. Without systemd, run it by hand:

```bash
node migrate/chats-sync.mjs --root ~/claude-projects --to <profile>/chats --secrets <.env>
node migrate/claude-desktop/claude-code-catalog.mjs --root ~/claude-projects --dry-run   # tree only, to preview
```

The first pass over OpenClaw sessions takes a while (hundreds of sessions take minutes); after that only
changed ones are re-read.

How it works: the script puts titles, folders and chat archive state where OpenClaw looks for
Claude Desktop metadata (`~/Library/Application Support/Claude/claude-code-sessions/`, in its own subfolder
`ai-workbench/`), so the Claude catalog sees them even when there are more Claude Code sessions than it
manages to scan; the import is a Claude catalog import (`sessions.catalog.import`) plus binding to the
Claude Code chat itself.

**Where the import runs.** The plugin calls the Gateway methods it needs (`sessions.catalog.list`,
`sessions.catalog.import`, `sessions.patch`, `session.visibility.set`, and `sessions.list` for the turn status)
inside the Gateway. OpenClaw allows
that only to its own plugins; [OpenClaw from the fork](../openclaw-fork.md) lets the operator grant a plugin
exact methods, and the installer sets the grant for the bridge (`env.vars.OPENCLAW_PLUGIN_GATEWAY_METHODS`,
only with `WORKBENCH_OPENCLAW_PACKAGE`). Check where it runs:

```bash
openclaw gateway call aiwb-claude-bridge.adoption --json   # {"inGateway": true} or the reason it cannot
```

Without the grant (OpenClaw without the fork, an older Gateway or plugin), or with
`plugins.entries.aiwb-claude-bridge.config.adoption.enabled: false`, the timer script
(`claude-code-catalog.mjs`) imports the chats itself through `openclaw gateway call` and the plugin method
`aiwb-claude-bridge.bind`, as before. Results and errors of the plugin's imports are in the Gateway log
(`aiwb-claude-bridge adoption by agents: …`). Archiving and deleting a chat in OpenClaw apply in "Projects" too: an archived chat
is hidden ("Restore" brings it back), a deleted one is gone for good; the Claude Code transcript and the file in `chats/`
remain. A chat is not imported a second time by itself; the list of imported chats is in
`~/.openclaw/workbench/aiwb-claude-bridge-adopted.json`; to import again, run
`claude-code-catalog.mjs --readopt "<chat title or id>"` (it passes the request to the plugin when the plugin
imports), or call the plugin directly:
`openclaw gateway call aiwb-claude-bridge.readopt --params '{"chats":["<chat title or id>"]}' --json`. The "Claude Code" section then duplicates "Projects"; you
can hide it: right-click its header → Hide from sidebar. Uninstalling (`installer/install.sh --uninstall`)
removes the timer and the plugin; imported sessions stay with the agents.

Until November 2026 this plugin was `aiwb-projects` (folder `projects/`). Re-running the installer moves an
existing install to the new id: the config and hooks of `plugins.entries.aiwb-projects`, the load path and
`plugins.allow`/`deny`; the plugin moves its files `~/.openclaw/workbench/aiwb-projects-*.json` to
`aiwb-claude-bridge-*.json` when it starts. The section stays "Projects" (catalog id `projects`).

## As OpenClaw sessions

**As OpenClaw sessions**, so that an old chat opens in the Control UI under its project's agent.
The built-in `claude` catalog does not see Claude Desktop chats: each chat has its own `.claude` folder, and
its records are marked `entrypoint: "local-agent"`. So a single command does everything: it lays out the
chats in a temporary folder in the Claude Code layout (chat parts merged, secrets scrubbed, titles
in `sessions-index.json`), enables the catalog, restarts the Gateway for the duration of the import with
`CLAUDE_CONFIG_DIR` pointing at that folder, imports the standard way (`sessions.catalog.import`), restores the
Gateway as it was and deletes the folder:

```bash
node migrate/claude-desktop/chats-openclaw.mjs --secrets <.env>
```

A Gateway running as a service is stopped and started through the service; one started by hand (`openclaw gateway run`)
keeps running in the background after the import, with its log in `~/.openclaw/logs/gateway-run.log`; one that was not running
is not started.

## Chats continued in Claude Code

**Chats continued in Claude Code** (`claude --resume` of a Claude Desktop chat): their transcript is in
`~/.claude/projects/<folder>/<id>.jsonl`. Both commands (`chats.mjs` and `chats-openclaw.mjs`) by
default look for continuations in all `~/.claude/projects/*` and append them to the chat without duplicates: only the chat's own
transcript belongs to it (by session id and shared records); other Claude Code sessions are not
imported. Claude Desktop only: `--no-claude-code`; your own folders: `--claude-code '<pattern>'`.

The copies are drafts (visible only to you), and repeating the import does not create duplicates. The import takes up to 50,000
records and 64 MiB; from a longer chat OpenClaw takes the last part; the full history is in `chats/` and in the
"Claude Code" section. "Continue" on a chat from the "Claude Code" section brings less into the OpenClaw window,
the last 200 records and no more than 512 KiB, but Claude CLI continues it with full
context. Imported sessions go to "Other", not by project.

## claude.ai cloud chats

Chats in Claude Desktop's regular **Chat** mode live on claude.ai servers, not on disk, so the
migration above does not see them. Bring them over from the official data export (claude.ai →
Settings → Privacy → **Export data**; the link arrives by email):

```bash
node migrate/claude-ai/import.mjs --from ~/Downloads --dry-run     # folder with conversations-*.zip
node migrate/claude-ai/import.mjs --from ~/Downloads --to <profile>/chats --secrets <.env>
```

Each cloud chat becomes a Claude Code session in the Claude Desktop folder of its project (if that
folder exists) or in `_no_space` (`--folder`): `~/.claude/projects/<folder>/<chat uuid>.jsonl`, titled
like the chat. From there the chat tree, adoption by agents and `claude --resume` treat it like a
local chat; the chats timer picks it up within 10 minutes. Only text is carried over: web search and
other tool calls become short notes, thinking is dropped. Chats without any text are skipped. With
`--to`, the chat is also written to the text archive (`source: claude-ai`).

The import never overwrites local chats: it writes a session file only if it is new or was written by
the import before (records marked `entrypoint: "claude-ai-export"`); any other file is left as is and
reported. Re-running with a newer export updates only the chats that changed. The chats also appear
in Claude Code's own `claude --resume` list, since they live in its folder.
