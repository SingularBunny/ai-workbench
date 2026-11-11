# Settings reference

Keys of `~/.openclaw/.env`, the file OpenClaw and the installer read. Set a key there and run the installer
again; OpenClaw reads its own keys (model API keys, the Gateway token) when the Gateway starts. Empty or
missing means the default described here. Generated from `.env.example` by `tools/env_reference.py`.

## Gateway

### `OPENCLAW_GATEWAY_TOKEN`

Created by the installer if missing: Gateway login token (Control UI, TUI).

## Model keys

### `OPENROUTER_API_KEY`

OpenRouter key: many models through one key. At least one model key is needed, or a Claude subscription through the Claude CLI (`WORKBENCH_DEFAULT_RUNTIME`).

### `ANTHROPIC_API_KEY`

Key from the Anthropic Console.

## Models

### `WORKBENCH_DEFAULT_MODEL`

Default model; empty means openrouter/auto.

### `WORKBENCH_FALLBACK_MODELS`

Comma-separated fallback models — used when the primary one fails (subscription limits, network).

### `WORKBENCH_DEFAULT_RUNTIME`

Default model runtime: claude-cli — through Claude Code and its login (Claude subscription), with `WORKBENCH_DEFAULT_MODEL=anthropic/claude-opus-5-5`. Requires `claude` installed and logged in.

### `WORKBENCH_DREAMING_MODEL`

Dreaming model — the nightly move of notes into MEMORY.md; empty means the agent's model. A light model saves limits: anthropic/claude-haiku-5-5 (with `WORKBENCH_DEFAULT_RUNTIME` — via the same Claude CLI).

### `WORKBENCH_LOCAL_EMBEDDINGS`

Semantic memory search with a local embedding model (llama-cpp plugin): cpu, or vulkan for the GPU (picks a discrete NVIDIA card by itself; vulkan:&lt;index from vulkaninfo&gt; — explicitly). The one-time server setup is interactive: openclaw models auth login --provider llama-cpp --method local.

### `WORKBENCH_OLLAMA_URL`

Ollama, local or on a VM via `ssh -L 11434:127.0.0.1:11434 <vm>`; without /v1.

## Profile and plugins

### `WORKBENCH_PROFILE`

Personal profile: a folder with profile.mjs — your own plugins, skills, MCP, tasks. Empty — public build.

### `WORKBENCH_PLUGINS_ROOT`

Where your own plugins are cloned; default ~/.local/share/ai-workbench/plugins.

### `GRAFANA_URL`, `GRAFANA_SERVICE_ACCOUNT_TOKEN`

Grafana MCP (if the profile defines it): installed only when the URL is set. A token, or login and password.

## Chat

### `WORKBENCH_MCP_APPS`

MCP Apps: interactive views from MCP servers in the chat (a sandbox on the Gateway port + 1, 18790 by default). 1 — enable, 0 — disable, empty — leave as is. Enable only for MCP servers you trust: the view HTML comes from the server. Restart the Gateway after the change.

### `WORKBENCH_CHAT_FILE_FOLDERS`

Chat file folders ([features/chat-files.md](../features/chat-files.md), needs the fork): folders, separated by ":", whose files the chat opens and downloads whatever their type, for all agents (e.g. ~/Desktop:~/Downloads). Per project: "chatFileFolders" in project.json. Not / or the home folder itself. Empty: the setting is not touched.

### `WORKBENCH_CHROME_EXTENSION`

OpenClaw Chrome extension: the installer registers a native host through which the extension finds the local OpenClaw (if Chrome or Chromium has been launched before). 0 — do not register.

### `WORKBENCH_CLAUDE_CHROME`

Claude in Chrome for agents on Claude CLI (OpenClaw from the fork): 1 — agents can drive Chrome through the Claude in Chrome extension, as Claude Code does. Browser control, so off unless set.

## OpenClaw from a fork

### `WORKBENCH_OPENCLAW_PACKAGE`, `WORKBENCH_OPENCLAW_PACKAGE_SHA256`

OpenClaw from your own fork instead of the pinned version: an npm package (.tgz — path or https://) and its sha256 (required). Ready packages: the fork's releases page ([openclaw-fork.md](../openclaw-fork.md)); or build one with tools/openclaw-fork-build.sh.

### `WORKBENCH_FORK_PRESETS`

Presets of the OpenClaw fork (needs `WORKBENCH_OPENCLAW_PACKAGE`), comma-separated; set as env.vars settings, see [openclaw-fork.md](../openclaw-fork.md). worker-limits — wider worker queues (`OPENCLAW_WORKER_*`): otherwise the memory index with transcripts of large chats fails with "worker task capacity reached". catalog-owner — user messages imported from the catalog are marked as the owner's (`OPENCLAW_CATALOG_IMPORT_OWNER`): without the mark Dreaming and session-backfill skip them.

## Network and proxy

### `WORKBENCH_PROXY_URL`, `WORKBENCH_PROXY_HOSTS`, `WORKBENCH_PROXY_ROUTES`

Network proxy ([install/network.md](../install/network.md)). The URL may hold credentials: the installer never prints it.

- `WORKBENCH_PROXY_URL` — http(s) forward proxy for OpenClaw (proxy.proxyUrl). Empty: proxy config is not touched.
- `WORKBENCH_PROXY_HOSTS` — with the fork, host suffixes that go through it, everything else direct; empty, \* or all — everything through the proxy (as with `HTTPS_PROXY`).
- `WORKBENCH_PROXY_ROUTES` — full form, wins over HOSTS: &lt;hosts&gt;=&lt;proxy|direct|URL&gt;;\*=&lt;proxy|direct|URL&gt; (one proxy URL for OpenClaw's own traffic).

### `WORKBENCH_CLAUDE_CODE_PROXY`

Claude Code's own proxy (~/.claude/settings.json env): a URL, or direct to remove what the installer wrote. Empty: not touched.

## Claude Desktop chats, backups and files

### `WORKBENCH_CLAUDE_DESKTOP_ROOT`

Claude Desktop chats by project: the folder where Claude Desktop kept project working folders (for example ~/claude-projects). The installer sets up a systemd user timer: every 10 minutes it builds the chat tree and imports new chats into project agents (migrate/claude-desktop/claude-code-catalog.mjs).

### `WORKBENCH_BACKUP`

Daily backup of the OpenClaw databases (shared state and every agent, with chat history and keys) into a local Git repository: a folder, e.g. ~/Backups/openclaw-git. The installer creates the repository and the Gateway-owned 24h schedule (the Gateway must be running), and takes a snapshot before replacing OpenClaw.

### `WORKBENCH_FILES_DIR`, `WORKBENCH_FILES_REMOTE`

Chat attachments (tools/files-backup.sh): a local folder and an rclone remote of type crypt (for example gdrive-crypt: on top of Google Drive). Without a remote — local copy only.

## Claude CLI on a VM

### `WORKBENCH_VM_SSH`

Claude CLI on a VM: user@host from ~/.ssh/config. The VM needs claude-agent-acp, acp-reaper (tools/remote-vm/acp-reaper) and the project at the same absolute path.

## Judge and evals

### `WORKBENCH_JUDGE_MODEL`

Judge (judge skill of the ai-workbench plugin). Use a model from a DIFFERENT family than the one answering (Zheng et al., 2023); id as the provider names it. Without a model the judge writes "NOT EVALUATED". claude-cli/&lt;id&gt; (for example claude-cli/claude-haiku-5-5) — via the Claude CLI and subscription, no key.

### `WORKBENCH_JUDGE_BASE_URL`, `WORKBENCH_JUDGE_API_KEY`

Defaults to OpenRouter and `OPENROUTER_API_KEY`; for Ollama — http://127.0.0.1:11434/v1.

### `WORKBENCH_JUDGE_CRITERIA`

Custom criteria: path to a JSON list of {"id","name","question"}.

### `WORKBENCH_JUDGE_PROXY`

Proxy for the judge only — if the provider is not reachable directly (OpenRouter returns 403 "Access denied by security policy", the Claude CLI returns 403 "Request not allowed" in some regions). The judge ignores the environment proxy.

### `WORKBENCH_EVAL_MODEL`, `WORKBENCH_EVAL_BASE_URL`, `WORKBENCH_EVAL_API_KEY`, `WORKBENCH_EVAL_PROXY`

Eval executor not on Claude (tools/eval-executor/claude): the model is `CLAUDE_EVAL_MODEL` when starting the runner, or set here; URL, key and proxy work as for the judge.

## Variables of single commands

Set in the shell for one command, not in `.env`.

- `WORKBENCH_OPENCLAW_SRC` — `tools/openclaw-fork-build.sh`: the fork checkout, when not given as the first argument.
- `WORKBENCH_EVAL_AGENT` — `tools/eval-executor/claude`: the OpenClaw agent that answers eval scenarios; default `main`.
