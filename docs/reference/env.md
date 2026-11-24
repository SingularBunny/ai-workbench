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

### `WORKBENCH_PDF_MODEL`

PDF model — reads PDFs and scans for agents whose own model cannot (the pdf tool); empty leaves it off. anthropic/claude-haiku-5-5 with `WORKBENCH_DEFAULT_RUNTIME=claude-cli` reads them by Claude subscription (its limits).

### `WORKBENCH_AGENT_TARGETS`

Which agents an agent may work with: list every agent by name (agents_list) and start sub-agents in them. Empty means all agents; comma-separated ids narrow it; `self` keeps each agent to itself (OpenClaw's default).

### `WORKBENCH_IMAGE_MODEL`

Image model — looks at images for agents whose own model cannot (the image tool); empty leaves it off. The same anthropic/claude-haiku-5-5 with `WORKBENCH_DEFAULT_RUNTIME=claude-cli` works by Claude subscription.

### `WORKBENCH_LOCAL_EMBEDDINGS`

Semantic memory search with a local embedding model (llama-cpp plugin): cpu, or vulkan for the GPU (picks a discrete NVIDIA card by itself; vulkan:&lt;index from vulkaninfo&gt; — explicitly). The one-time server setup is interactive: openclaw models auth login --provider llama-cpp --method local.

### `WORKBENCH_OLLAMA_URL`

Ollama, local or on a VM via `ssh -L 11434:127.0.0.1:11434 <vm>`; without /v1.

## Free model providers

### `GEMINI_API_KEY`

Free tiers of model providers ([install/free-providers.md](../install/free-providers.md)): with a key, the provider's models appear in OpenClaw and count as free in Multi-model. Free tiers are rate-limited and change without notice; the limits below are the ones published by mid-2026. Google AI Studio (aistudio.google.com): Gemini/Gemma, 5–15 requests a minute; free only while billing is off for the project.

### `GROQ_API_KEY`

Groq (console.groq.com): about 30 requests a minute, 1,000 a day.

### `CEREBRAS_API_KEY`

Cerebras (cloud.cerebras.ai): paid — asked for a payment method before issuing a key (November 2026).

### `MISTRAL_API_KEY`

Mistral (console.mistral.ai): paid — asked for a payment method before issuing a key (November 2026).

### `NVIDIA_API_KEY`

NVIDIA (build.nvidia.com): paid — asked for a payment method before issuing a key (November 2026).

### `HF_TOKEN`

Hugging Face (huggingface.co/settings/tokens): paid — a new account's calls answer 402 without pre-paid credits (November 2026).

### `DEEPSEEK_API_KEY`

DeepSeek (platform.deepseek.com): paid from a pre-paid balance, no free tier — only the chat site is free; cheap (DeepSeek V4 Flash $0.14/$0.28 per million input/output tokens in OpenClaw's catalog, November 2026).

### `WORKBENCH_FREE_PROVIDERS`

Providers counted as free in Multi-model, comma-separated, instead of those with a key above; none — no provider.

## Profile and plugins

### `WORKBENCH_PROFILE`

Personal profile: a folder with profile.mjs — your own plugins, skills, MCP, tasks. Empty — public build.

### `WORKBENCH_PLUGINS_ROOT`

Where your own plugins are cloned; default ~/.local/share/ai-workbench/plugins.

### `GRAFANA_URL`, `GRAFANA_SERVICE_ACCOUNT_TOKEN`

Grafana MCP (if the profile defines it): installed only when the URL is set. A token, or login and password.

## Knowledge base

### `WORKBENCH_KNOWLEDGE`

Knowledge base folders for every agent, separated by ":" (an Obsidian vault is one; [features/knowledge.md](../features/knowledge.md)): agents search the Markdown notes there with memory search and may save notes there; PDF and Office files are searched through text copies kept by a timer (needs pdftotext and LibreOffice; scans and images need OCRmyPDF and Tesseract). Per project: "knowledge" in project.json. Not / or the home folder itself.

## Chat

### `WORKBENCH_DICTATION_MODEL`

Dictation (the chat microphone): speech-to-text model as provider/model, or none. Empty: the first provider with a key — Groq Whisper (free tier), OpenAI, OpenRouter's Whisper ([features/dictation.md](../features/dictation.md)). An existing tools.media.models setting is kept.

### `WORKBENCH_TTS`, `WORKBENCH_TTS_SPEAKER`

Tap to talk, spoken replies: silero — a local Russian Silero model through uv (about 1 GB, no key), or empty — none. `WORKBENCH_TTS_SPEAKER`: xenia (default), baya, kseniya, aidar, eugene ([features/dictation.md](../features/dictation.md)#tap-to-talk).

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

### `WORKBENCH_ACPX_PACKAGE`, `WORKBENCH_ACPX_PACKAGE_SHA256`

The ACPX plugin (ACP agents: Claude CLI on a VM, Junie) from the same fork instead of npm: an npm-pack .tgz (a path) and its sha256 (required). tools/openclaw-fork-build.sh builds it next to the OpenClaw package, from the same commit (openclaw-acpx-&lt;version&gt;-&lt;commit&gt;.tgz); see [openclaw-fork.md](../openclaw-fork.md). Used only when acpx is installed at all (`WORKBENCH_VM_SSH` or `WORKBENCH_JUNIE`); unset — npm again.

### `WORKBENCH_MAINTENANCE_WAIT_MIN`

Maintenance during an install (a fork Gateway with gateway.maintenance): chats pause and the installer waits for running agent turns at most this many minutes before replacing OpenClaw (default 30); see [install/run.md](../install/run.md).

### `WORKBENCH_MAINTENANCE_EXIT_WAIT_SEC`

Turning maintenance off at the end of an install whose Gateway does not answer (a failed upgrade): seconds to retry while the Gateway service is still starting (default 180); then the installer removes its own state file &lt;stateDir&gt;/gateway-maintenance.json, so chats run when the Gateway starts; see [install/run.md](../install/run.md).

### `WORKBENCH_DOCTOR_TIMEOUT_MIN`

Upgrade safety: a config the new OpenClaw rejects (retired keys) is repaired with `openclaw doctor --fix --non-interactive` before the Gateway starts; it may take this many minutes (default 20; it also migrates databases). See [install/run.md](../install/run.md)#upgrades.

### `WORKBENCH_GATEWAY_START_MIN`

How long the installer waits for the Gateway service to become healthy after a start (default 10 minutes: the first start of a new version migrates databases); a service that fails stops the install sooner.

### `WORKBENCH_NPM_PROBE_URL`, `WORKBENCH_NPM_PROBE_SEC`

Before OpenClaw is replaced (and only when `HTTPS_PROXY` is not set), the installer downloads a small file from the npm registry directly (default a 27 KB semver tarball, limit 20 s). If that fails and `WORKBENCH_PROXY_URL` answers, install-cli.sh and its npm go through that proxy, so a stalled direct route does not keep the Gateway stopped while npm hangs.

### `WORKBENCH_INSTALL_CLI`

A local install-cli.sh instead of the download from openclaw.ai (offline installs, installer tests).

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

## JetBrains Junie

### `WORKBENCH_JUNIE`

JetBrains Junie CLI as an ACP agent ([integrations/junie.md](../integrations/junie.md)): the full path to junie, for example /home/you/.local/bin/junie. Registers Junie as the ACP agent junie (/acp spawn junie in a chat); its turns spend JetBrains AI credits. Log in to Junie yourself first (run junie once). Installs the acpx plugin.

### `WORKBENCH_PROXY_POOL`

Any value: install the aiwb-proxy-pool plugin and run Junie through it. JetBrains answers 451 to some countries and 403 to some data-centre exits; the plugin keeps a pool of free proxies found by proxybroker2 and checked against JetBrains, and only Junie's process goes through it (its local proxy, 127.0.0.1:18795). Free proxies see host names, not HTTPS content. Needs proxybroker2: plugin config proxybrokerPython (and proxybrokerDir).

### `WORKBENCH_JUNIE_PROXY`

A proxy URL (`http://host:port`) for Junie alone, on Linux and macOS: the installer starts Junie as `/usr/bin/env HTTPS_PROXY=… <junie> --acp=true`, so only Junie's process uses it and the Gateway's traffic does not. Use it when a proxy of your own already reaches JetBrains (for example a VPN client whose server sends `jetbrains.com`, `jetbrains.ai` and `jb.gg` out through an exit JetBrains accepts; Junie's model requests go to `*.labs.jb.gg`). Wins over `WORKBENCH_PROXY_POOL` for Junie; the pool plugin stays installed.

## Judge and evals

### `WORKBENCH_JUDGE_MODEL`

Judge (judge skill of the ai-workbench plugin). Use a model from a DIFFERENT family than the one answering (Zheng et al., 2023); id as the provider names it. Without a model the judge writes "NOT EVALUATED". claude-cli/&lt;id&gt; (for example claude-cli/claude-haiku-5-5) — via the Claude CLI and subscription, no key.

### `WORKBENCH_JUDGE_BASE_URL`, `WORKBENCH_JUDGE_API_KEY`

Defaults to OpenRouter and `OPENROUTER_API_KEY`; for Ollama — http://127.0.0.1:11434/v1.

### `WORKBENCH_JUDGE_PANEL`

Panel of judges: up to two more judge models, comma-separated, from other families; majority per criterion, the third asked only when the first two disagree ([features/judge.md](../features/judge.md)).

### `WORKBENCH_JUDGE_CRITERIA`

Custom criteria: path to a JSON list of {"id","name","question"}.

### `WORKBENCH_JUDGE_MAX_TOKENS`

Upper limit of the judge's answer in tokens (default 4096); lower it for a provider that caps tokens per minute (Groq's free tier: 900).

### `WORKBENCH_JUDGE_PROXY`

Proxy for the judge only — if the provider is not reachable directly (OpenRouter returns 403 "Access denied by security policy", the Claude CLI returns 403 "Request not allowed" in some regions). The judge ignores the environment proxy.

### `WORKBENCH_EVAL_MODEL`, `WORKBENCH_EVAL_BASE_URL`, `WORKBENCH_EVAL_API_KEY`, `WORKBENCH_EVAL_PROXY`

Eval executor not on Claude (tools/eval-executor/claude): the model is `CLAUDE_EVAL_MODEL` when starting the runner, or set here; URL, key and proxy work as for the judge.

## Variables of single commands

Set in the shell for one command, not in `.env`.

- `WORKBENCH_OPENCLAW_SRC` — `tools/openclaw-fork-build.sh`: the fork checkout, when not given as the first argument.
- `WORKBENCH_FORK_BUILDS_KEEP` — `tools/openclaw-fork-build.sh`: how many latest commits keep their packages in the output folder; default 2.
- `WORKBENCH_EVAL_AGENT` — `tools/eval-executor/claude`: the OpenClaw agent that answers eval scenarios; default `main`.
