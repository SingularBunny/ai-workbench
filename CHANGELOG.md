# Changelog

All notable changes to ai-workbench. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html); each release is a git tag `vX.Y.Z`.
Changes of the OpenClaw fork are listed in its `FORK.md`, changes of the plugins in the
[aiwb-plugins](https://github.com/SingularBunny/aiwb-plugins) changelog.

## [Unreleased]

### Added

- Chat tools (`aiwb-chat-tools`): **Forget a topic…**, **New chat**, **Learn a skill from this chat** and **Reset chat…**
  in a chat's ⋯ menu come from a plugin instead of the OpenClaw fork ([Chats](docs/features/chats.md#chat-menu-items)).
- Safe OpenClaw upgrades ([Upgrades](docs/install/run.md#upgrades)): the installer pauses chats in Gateway maintenance
  mode for the whole install and never leaves it on; before the restart it stops the Gateway (`gateway stop --force`,
  verified), runs `config validate` and repairs retired keys with `doctor --fix --non-interactive` (backup
  `openclaw.json.pre-upgrade-*`), retries the repair once after a failed start and waits for a healthy Gateway before
  setup. New variables `WORKBENCH_MAINTENANCE_WAIT_MIN`, `WORKBENCH_MAINTENANCE_EXIT_WAIT_SEC`,
  `WORKBENCH_DOCTOR_TIMEOUT_MIN`, `WORKBENCH_GATEWAY_START_MIN`. The Docker check `--upgrade-from` installs an old fork
  package with a legacy key and a dead Gateway, then upgrades over it. Linux and macOS (`install.sh`) only.
- Documentation site on GitHub Pages (MkDocs).
- Group chat in a chat (OpenClaw fork, `aiwb-groups` 0.2.0): agents, ACP agents and models added to any chat answer
  when named (`@Junie …`, **Ask Junie**), their replies in the chat under their own name
  ([Groups](docs/features/groups.md#group-chat-in-a-chat)). The Docker check `tools/container_check_groups.sh` adds the
  stand-in Junie to a chat, asks it twice and checks its replies land in the chat as Junie rows (skipped with an
  `aiwb-groups` without group chats).
- ACPX from the OpenClaw fork: `tools/openclaw-fork-build.sh` also packs the ACPX plugin from the same commit
  (`openclaw-acpx-<version>-<commit>.tgz`), and with `WORKBENCH_ACPX_PACKAGE` and `WORKBENCH_ACPX_PACKAGE_SHA256` the
  installer installs it instead of the npm copy, so the fork's ACPX Gateway methods are available. The Docker check
  takes it with `--acpx-package`. Documentation: OpenClaw from a fork.
- Dictation in the chat: the installer sets a speech-to-text model for the composer microphone — Groq Whisper
  (free tier) when `GROQ_API_KEY` is set, else OpenAI or OpenRouter's Whisper; `WORKBENCH_DICTATION_MODEL` picks one or
  turns it off. Documentation: Dictation.
- GPU use (`aiwb-gpu`): load and memory of NVIDIA GPUs in the chat header, and a GPU side panel with the models
  and processes that hold GPU memory (Ollama models, local embeddings, llama.cpp, LM Studio). Documentation: GPU use.
- Install plan: the system programs missing for the features in use (Python, LibreOffice, poppler, OCRmyPDF and
  Tesseract with the locale's language, Vulkan tools), with one install command for apt, dnf, pacman (AUR for
  ocrmypdf) or brew; an interactive install offers to run it. Documentation: System programs.
- Knowledge base scans: PDF pages without a text layer and images are recognized with OCRmyPDF and Tesseract
  (needs `aiwb-office` 0.3.0).
- Fork packages from the OpenClaw fork's releases page, built on GitHub-hosted runners with signed build
  provenance (`gh attestation verify`).
- Documentation: a first-run page (from a clean machine to the first chat) and a settings reference of every
  `~/.openclaw/.env` key, generated from `.env.example`; the gate fails when a key the code reads is undescribed.
- Knowledge base: folders of notes (an Obsidian vault is one) for every agent (`WORKBENCH_KNOWLEDGE`) and per
  project (`knowledge` in `project.json`), searched by memory search and named in each agent's context, with
  permission to save notes there after an approval card for every write (needs `aiwb-memory` 0.2.0).
- Knowledge base PDF and Office files are searched through Markdown text copies kept by the `aiwb-knowledge-text`
  timer (pdftotext, LibreOffice), outside the knowledge folders.
- Multi-model page (`aiwb-compare`): several models answer one question side by side; a judge of another family
  picks the most consistent answer (chosen twice in two orders), or one model merges them. Roles default to the
  top free models by Arena rating and the strongest rated model of another family.
- Multi-model in the chat: **Ask several models** under a chat message (OpenClaw fork) opens it as a panel beside the
  chat with that message as the question, and the chosen or merged answer can be sent to that chat.
- Groups page (`aiwb-groups`): several agents in one conversation; a manager picks who speaks next, an @mention
  wins, at most 3 agent turns per message; each agent answers with a full turn of its own.
- Free model providers: with a key in `.env` the installer installs the Groq, Cerebras and Mistral provider packages,
  and Google AI Studio and Groq count as free in Multi-model (Cerebras, NVIDIA, Mistral and Hugging Face now
  charge)
  (`WORKBENCH_FREE_PROVIDERS` overrides).

### Fixed

- Installer: a Gateway that is still starting is waited for before chats are paused (it was read as "no Gateway" and
  OpenClaw was replaced without the pause or the wait for turns); setup stopped by running turns no longer says
  "Nothing has been changed" after OpenClaw was already replaced; a stalled direct npm registry is detected before
  the Gateway stops, and npm then goes through `WORKBENCH_PROXY_URL` (`WORKBENCH_NPM_PROBE_URL`, `WORKBENCH_NPM_PROBE_SEC`);
  npm takes dependencies from its cache without revalidating them (`npm_config_prefer_offline=true`).

- A marketplace fetch that fails on a network blip no longer skips its base plugins and fails the install when a
  later step finds HEAD at the pinned commit; the installer prints a warning instead.
- Re-running the installer no longer fails on a plugin that lives inside another plugin's folder: own plugins
  OpenClaw already loads from the same folder are not linked again ("already linked" in the plan).
- Load paths of plugin folders that no longer exist are dropped from `plugins.load.paths`.

## [0.1.0] - 2026-11-11

First public release.

### Added

- Installer for Linux (and `install.ps1` for Windows): a pinned OpenClaw version or a package built from a fork,
  own plugins connected from their folders with their dependencies, Anthropic base plugins at pinned commits,
  MCP servers, settings in one write, config validation, a manifest for exact uninstall and re-runs.
- Personal profile from a folder or a git repository (`--profile`): own plugins and repositories, MCP servers,
  scheduled tasks, projects, shared memory, the chat archive and git hooks; a profile can only add.
- Moving from Claude Desktop: projects become OpenClaw agents with their instructions and memory, shared memory
  goes to the main agent, chats are imported with their full history and continue in the same Claude CLI chat.
- Chats by project in the Control UI, a 10-minute timer for the tree, adoption and a text chat archive with
  secrets redacted; the timer can commit its folders of the data repository locally.
- Network proxy per host (`WORKBENCH_PROXY_*`), chat-file folders (`WORKBENCH_CHAT_FILE_FOLDERS`), fork presets
  (`WORKBENCH_FORK_PRESETS`), notifications, document preview, interactive widgets, backups.
- Judge for evaluating answers and an eval executor for runs on models other than Claude.
- Docker checks of the whole installer on several Linux distributions, with a `RESULT` line and a non-zero exit
  when anything is red; continuous integration (the gate on every push, a clean Docker install daily).
- No machine-specific defaults: a proxy without a host list carries everything (as `HTTPS_PROXY`), own plugins
  are cloned to `~/.local/share/ai-workbench/plugins` unless `WORKBENCH_PLUGINS_ROOT` says otherwise, and the
  Claude projects folder is always set explicitly (`WORKBENCH_CLAUDE_DESKTOP_ROOT`).
- MIT license.

[Unreleased]: https://github.com/SingularBunny/ai-workbench/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/SingularBunny/ai-workbench/releases/tag/v0.1.0
