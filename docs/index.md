# ai-workbench

A local replacement for Claude Desktop built on OpenClaw. The installer sets up a pinned version
of OpenClaw (or one built from a fork), connects your own plugins from their folders together with
their dependencies and the Anthropic base plugins, writes the settings and validates the config. It
also imports projects, memory and chats from Claude Desktop.

**Two builds.** Without a profile you get the public build: OpenClaw, the Gateway, models and the
judge. Your own plugins, skills, MCP servers, projects and tasks come from a personal profile — a
folder or git repository with a `profile.mjs` in the same format as `openclaw/workbench.config.mjs`:

```bash
installer/install.sh --profile <profile folder or git URL>
# or once: echo WORKBENCH_PROFILE=<profile folder> >> ~/.openclaw/.env
```

A profile can only add. The installer rejects a plugin, MCP server or marketplace whose id is
already taken, as well as any Gateway settings (`gateway.*`). A profile installs your own plugins
and MCP servers ([Installation](install/index.md), steps 5–6), plus
[scheduled tasks](features/scheduled-tasks.md), [projects](features/projects.md),
[shared memory](features/memory.md) and [chats](features/chats.md).

Your own non-secret settings (models, proxy hosts, chat-file folders, fork presets, …) can live in the profile
too, so that they are versioned with it: `export const ENV = { WORKBENCH_PROXY_HOSTS: "api.example.com" }`.
The installer writes them into `~/.openclaw/.env` on every run (the profile wins over an older value there; an
environment variable wins over both). Secrets, proxy URLs, `WORKBENCH_PROFILE` and `WORKBENCH_PLUGINS_ROOT`
stay in `.env`: the installer refuses them in a profile.

The ai-workbench plugins themselves (judge, Claude Desktop & Code bridge, shared memory, fork settings status, document
preview, scheduled-tasks MCP) live in the public repository
[aiwb-plugins](https://github.com/SingularBunny/aiwb-plugins).

## Getting started

1. [First run](install/first-run.md): from a clean machine to the first chat. In detail: [Installation](install/index.md) → [keys](install/keys.md) → [running](install/run.md) → [backup](install/backup.md).
2. A Claude subscription instead of an API key — [Keys](install/keys.md#claude-subscription).
3. Moving from Claude Desktop — [Projects](features/projects.md), [Shared memory](features/memory.md), [Knowledge base](features/knowledge.md),
   [Chats](features/chats.md).
4. Your own OpenClaw with changes — [OpenClaw from a fork](openclaw-fork.md).
5. Artifacts in chat — [Interactive widgets](features/widgets.md), [Document preview](features/document-preview.md),
   [Chat files](features/chat-files.md).
6. Notifications when an agent finishes or asks — [Notifications](features/notifications.md).
