# Backup

OpenClaw keeps its state in SQLite databases: one shared database and one per agent, with chat history,
memory, settings and keys (OpenClaw docs `install/backups.md`). With `WORKBENCH_BACKUP=<folder>` in
`~/.openclaw/.env` (for example `~/Backups/openclaw-git`), the installer sets up OpenClaw's own versioned
backup:

- creates a local Git repository in that folder (`openclaw backup git init`);
- schedules a daily backup in the Gateway (`openclaw backup enable --repository <folder> --every 24h`). This
  needs a running Gateway; if it is stopped, a schedule set up before keeps running, and the installer prints the
  command for creating or changing it later;
- before it replaces OpenClaw (a new fork package or a return to the official one), takes a snapshot
  (`openclaw backup git create --all`). A failed snapshot is reported but does not stop the install.

Each run dumps every database into text files and makes one commit; unchanged content makes no commit, so the
repository grows only by what changed. Every run still reads all databases: with 3 GB of databases a run takes
about 2 minutes, and the folder holds about 3 GB of text plus 1.4 GB of Git history at the start. There is no remote: the backup holds your keys and all chat history,
so keep the folder only on your machine (the installer leaves its permissions to OpenClaw, which requires
the folder to be private). It protects against a broken database or a bad update, not against a failed disk:
copy the folder elsewhere for that.

```bash
openclaw backup git log --repository ~/Backups/openclaw-git                # backups
openclaw backup git verify --repository ~/Backups/openclaw-git --global    # check the latest
openclaw backup git restore --repository ~/Backups/openclaw-git --ref <commit> --agent main --target ./restored.sqlite
openclaw backup disable --git                                               # stop the schedule
```

Restore writes a separate file and never overwrites a live database; putting it in place is a manual step
with the Gateway stopped (OpenClaw docs `install/backups.md`, "Restore").
