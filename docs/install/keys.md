# Keys

`~/.openclaw/.env` is created with the Gateway token. Add at least one model key — see
`.env.example` for a template and the [Settings reference](../reference/env.md) for every key:

```bash
$EDITOR ~/.openclaw/.env      # OPENROUTER_API_KEY=… and/or ANTHROPIC_API_KEY=…
```

Optional settings go in the same file: `WORKBENCH_DEFAULT_MODEL`, `WORKBENCH_CLAUDE_DESKTOP_ROOT`
(chats by project, see [Chats](../features/chats.md)), `WORKBENCH_OLLAMA_URL`, `WORKBENCH_VM_SSH`,
`WORKBENCH_PLUGINS_ROOT`, and the profile's MCP variables. After editing, run the installer again:
it overwrites only its own settings.

## Claude subscription

**Agents on a Claude subscription** run through Claude Code and its login, without an API key
(`claude` must be installed and logged in):

```bash
WORKBENCH_DEFAULT_MODEL=anthropic/claude-opus-5-5
WORKBENCH_DEFAULT_RUNTIME=claude-cli
WORKBENCH_FALLBACK_MODELS=openrouter/auto      # when subscription limits are hit
```

This applies to all agents and their scheduled tasks. The agent passes Claude Code its
instructions and memory, skills (as a separate plugin) and OpenClaw tools (via an MCP bridge).
Anthropic treats such calls as programmatic: they count against the subscription limits.
