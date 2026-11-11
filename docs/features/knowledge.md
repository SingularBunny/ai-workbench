# Knowledge base

Folders of notes that agents look things up in and add to, like the project knowledge of Claude Projects. An
Obsidian vault is such a folder: edit the notes in Obsidian, and agents find and update them in the chat.

**For every agent** — in `~/.openclaw/.env` (or the profile's `ENV`), folders separated by `:`:

```bash
WORKBENCH_KNOWLEDGE=~/Documents/Vault
```

**For one project** — in the project's `project.json` ([Projects](projects.md)):

```json
"knowledge": ["~/Projects/garden/notes"]
```

A project agent gets both its own folders and the folders for every agent. Run the installer again after a change.

**After adding or removing folders, rebuild the memory indexes.** The set of searched folders is part of each
agent's index identity: OpenClaw marks the existing index incompatible (`openclaw memory search --json` answers
`"stale": true` with code `scope`) and returns no results until it is rebuilt, which needs the Gateway stopped:

```bash
systemctl --user stop openclaw-gateway            # or stop `openclaw gateway run`
openclaw memory index --agent <id> --force        # for every agent: openclaw agents list
systemctl --user start openclaw-gateway
```

The rebuild also re-reads chat transcripts of agents that search their history; with a cloud embedding provider
it is billed.

What the installer sets:

- the folders for every agent go into `memory.search.extraPaths`, next to the [shared memory](memory.md) folder, and a
  project's folders into that agent's `agents.entries.<id>.memory.search.extraPaths`: OpenClaw's memory search
  (`memory_search`) indexes the notes there, with all subfolders;
- the `aiwb-memory` plugin names each agent's folders in its context on every turn and tells it to look things
  up there and that it may save new notes, summaries and conclusions there as Markdown, following the folder's
  structure.

Memory search indexes Markdown (`.md`) files only. Other files in the folder (PDF, Word, images) are not found by
search; the agent can still read them when it knows the path. Symbolic links inside the folder are skipped: list
the real folder instead. To search with a local model instead of a cloud embedding service, see
`WORKBENCH_LOCAL_EMBEDDINGS` in the [settings reference](../reference/env.md).

## Changes are approved first

Agents keep the knowledge base together with you: before changing anything there, an agent says in the chat which
notes it will create, edit, move or delete and what changes, and waits for your yes. On top of that, every file
write inside a knowledge folder stops the turn with an approval card in the chat: which file, and what it becomes
(the new text, or the replaced and new fragments). **Allow once** lets this write through, **Allow always** stops
asking for this chat until the Gateway restarts, **Deny** refuses it and the agent is told so.

The card covers writes through file tools: OpenClaw's `write`, `edit` and `apply_patch`, and the Claude CLI's
Write and Edit. Two limits:

- A Claude CLI session in the `bypassPermissions` mode does not ask OpenClaw before its own Write and Edit, so
  there is no card; the agent's rule to ask in the chat still applies. Use the `default` or `acceptEdits` mode for
  chats that edit the knowledge base.
- A shell command that writes a file (`sed -i`, `echo >`) cannot be checked in advance; agents are told to write
  notes only with file tools.

The agent needs write access to the folder: OpenClaw's tool settings, or the Claude CLI's own permissions for
agents on a Claude subscription.
