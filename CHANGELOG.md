# Changelog

All notable changes to ai-workbench. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html); each release is a git tag `vX.Y.Z`.
Changes of the OpenClaw fork are listed in its `FORK.md`, changes of the plugins in the
[aiwb-plugins](https://github.com/SingularBunny/aiwb-plugins) changelog.

## [Unreleased]

### Added

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
