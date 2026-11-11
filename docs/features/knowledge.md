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

Writing goes through the agent's file tools, so the agent needs write access to the folder (OpenClaw's tool
settings, or the Claude CLI's own permissions for agents on a Claude subscription).
