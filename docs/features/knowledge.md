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

**After the first setup and after adding or removing folders, rebuild the memory indexes.** The text copy folders
are listed once per scope, so adding a folder later changes the copies, not the list; adding the first project
knowledge folder does change it. The set of searched folders is part of each
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

## PDF and Office files

Memory search indexes Markdown (`.md`) files only. For PDF, Word, Excel and PowerPoint files (also `.doc`, `.xls`,
`.ppt` and OpenDocument) in the knowledge folders, a timer keeps Markdown text copies under
`~/.openclaw/workbench/knowledge-text/` (`all/` for the folders of every agent, `agent-<id>/` for a project's), and
those folders are searched too. A copy starts with its original's path; agents are told to read and cite the original
and never to edit the copies. The copies are made outside the knowledge folders, so the Obsidian vault stays as it is.

- The timer `aiwb-knowledge-text` (systemd user timer, Linux) runs every 15 minutes and re-reads only files whose
  size or date changed; copies of deleted files are removed. Run it now with
  `systemctl --user start aiwb-knowledge-text`; its log: `journalctl --user -u aiwb-knowledge-text`.
- PDF text comes from `pdftotext` (poppler), Office text from local LibreOffice, as for Office attachments in chat
  (the `aiwb-office` plugin). Without one of them its files get no copy and the run says so.
- Scans: PDF pages without a text layer are recognized with [OCRmyPDF](https://ocrmypdf.readthedocs.io/) (pages that
  have any text are left as they are, its `--skip-text` rule), images (`.png`, `.jpg`, `.jpeg`, `.tif`, `.tiff`) with
  Tesseract. Install both (Debian/Ubuntu: `apt install ocrmypdf`; Arch: `ocrmypdf` from the AUR, e.g. `yay -S ocrmypdf`, plus `pacman -S tesseract`) and the Tesseract
  language packs for your documents (`tesseract-ocr-rus`, `tesseract-data-rus`, …); every installed language is used,
  except `osd` and `equ`. Without OCR a PDF copy keeps the text pages and is redone once OCR is installed; images get
  no copy. A file is recognized at most 10 minutes. The install plan lists what is missing:
  [System programs](../install/system-programs.md).
- Files over 64 MB are skipped; a copy keeps at most 2 million characters.
- Hidden folders (`.obsidian`, `.trash`, `.git`), Office lock files (`~$…`) and symbolic links are skipped.

Symbolic links inside a knowledge folder are skipped by memory search too: list the real folder instead. To search with a local model instead of a cloud embedding service, see
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
