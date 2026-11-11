# Update and uninstall

**Running it again is an update.** Run the same `installer/install.sh` over an existing install:
the marketplace moves to the pinned commit, plugins are reinstalled (`--force`), and settings are
written again — if nothing changed, OpenClaw replies "No change". Your edits to keys that the build
sets are overwritten on a rerun; keys the build does not touch are left alone. Old MCP versions are
removed after an update. Plugins renamed since the previous install are moved to their new ids (see
[Installation](index.md), step 5), and the manifest of an older install is read under the new ids.

**Uninstall** — restore the config and plugins to what they were before ai-workbench:

```bash
installer/install.sh --uninstall --dry-run   # plan
openclaw gateway stop                        # or Ctrl+C in the `openclaw gateway run` window
installer/install.sh --uninstall
```

The first install writes the uninstall manifest `~/.openclaw/workbench/install-manifest.json`: the
previous value of every key it changes, and whether each plugin was installed before it (a rerun
does not overwrite the previous values). Using it, uninstall restores the previous values or
removes the keys, removes the plugins the installer installed (keeps the ones that were there
before; does not touch linked plugin folders; anything still under a renamed plugin's old id goes
too) and deletes `~/.openclaw/workbench`. **Left
untouched:** OpenClaw, `~/.openclaw/.env`, sessions, memory, agent workspaces, repository clones,
scheduled tasks (remove your own with `openclaw automations rm <id>`). Project agents and
`gateway.mode` are kept on purpose: OpenClaw deletes an agent only together with its workspace and
sessions (`openclaw agents delete <id>`, to the trash), and without `gateway.mode` the local Gateway
does not start. While the Gateway is running, uninstall refuses and changes nothing — just like
`openclaw uninstall --state`. To remove OpenClaw entirely: `openclaw backup create`, then
`openclaw uninstall --all`.
