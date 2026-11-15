# JetBrains Junie

[Junie](https://junie.jetbrains.com/docs/junie-cli.html) is JetBrains' coding agent. Its CLI runs as an ACP agent
(`junie --acp=true`), and OpenClaw runs it through the `acpx` plugin. Junie's turns spend your JetBrains AI
credits (or your own provider key, if you set one in Junie); JetBrains has no API key for other tools, so this is
the way to use those credits from OpenClaw.

## Setup

1. Install Junie CLI: `npm install -g @jetbrains/junie` (its postinstall puts Junie into `~/.local/share/junie`
   and `~/.local/bin/junie`).
2. Log in: run `~/.local/bin/junie` once and sign in with your JetBrains account. Junie keeps the login itself.
3. Set `WORKBENCH_JUNIE` in `~/.openclaw/.env` to the full path of `junie` and run the installer again. It installs
   `acpx` and registers Junie as the ACP agent `junie`.

## Use

- **Hand a chat to Junie.** Type `/acp spawn junie --bind here` in a chat: the chat is bound to a Junie session, and
  every following message goes to Junie until you close it (`/acp close`). Owner-only: the Control UI owner can.
- **One task from an agent.** An agent can hand Junie a single task and get the result back in its own turn:
  `sessions_spawn({ runtime: "acp", agentId: "junie", task: "..." })`.

There is no separate "Junie" agent in the agent list: OpenClaw sends an agent's turns to an ACP harness only through
these two paths, so such an agent's ordinary chat would answer with the default model.

Junie works with its own permissions on the Gateway machine; OpenClaw's sandbox and read-only modes do not apply
to it. The model is Junie's (its own settings or `--model`), not the OpenClaw agent's.

**Claude rules and skills in Junie.** Junie offers to import Claude Code's rules, skills, commands and plugins
(it copies them). Links keep one copy instead: `~/.junie/AGENTS.md` → `~/.claude/CLAUDE.md`,
`~/.junie/skills/<name>` → `~/.claude/skills/<name>`, `~/.junie/commands` → `~/.claude/commands`. Claude Code's
plugins (hooks, MCP servers) are made for Claude Code and are better left out.
