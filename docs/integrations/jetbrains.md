# JetBrains IDE

If JetBrains AI Assistant has been run on the machine (`~/.jetbrains` exists), the installer adds
an **OpenClaw** agent to `~/.jetbrains/acp.json`: `openclaw acp` by absolute path. Other
entries in the file are left alone; uninstalling (`--uninstall`) removes only its own.

In the IDE: AI Assistant window → agent list → **OpenClaw**. The Gateway must be running.

Limitations of the `openclaw acp` bridge:

- MCP servers from the IDE are not passed to it (`use_custom_mcp: false`, `use_idea_mcp: false`): the bridge
  rejects such requests. The agent's tools are the ones configured in OpenClaw itself.
- No IDE diffs or terminal: edits go straight to disk; you can see them in file history and in git.
- The model cannot be chosen in the IDE; the OpenClaw agent's model is used.
- Each chat in the IDE is a new separate session. To write to another agent's session, add
  `"--session", "agent:<id>:main"` to `args`.

**After OpenClaw is replaced** (a new fork package, or a return to the official OpenClaw), the agent the IDE has
already started keeps running the old OpenClaw files. The installer finds such `openclaw acp` processes and
says so before and after the replacement; restart the agent in AI Assistant, or restart the IDE.
