# ai-workbench

[![check](https://github.com/SingularBunny/ai-workbench/actions/workflows/check.yml/badge.svg)](https://github.com/SingularBunny/ai-workbench/actions/workflows/check.yml)
[![docker install](https://github.com/SingularBunny/ai-workbench/actions/workflows/docker.yml/badge.svg)](https://github.com/SingularBunny/ai-workbench/actions/workflows/docker.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

An AI-agnostic local alternative to Claude Desktop built on OpenClaw: any models
(OpenRouter, Anthropic, Ollama, models on a remote VM), your own plugins and skills
from their folders together with their dependencies, MCP, a Claude CLI agent on a VM and a judge
for evaluating answers.

- Documentation — [docs/](docs/index.md): installation, OpenClaw from a fork, features, integrations;
  as a site — `mkdocs serve` (Material theme, `pip install -r docs/requirements.txt`)
- ai-workbench plugins (judge, Claude Desktop & Code bridge, shared memory, fork settings status, document preview, scheduled
  tasks) — [aiwb-plugins](https://github.com/SingularBunny/aiwb-plugins)
- How to contribute — [CONTRIBUTING.md](CONTRIBUTING.md)
- Personal profile (your own plugins, projects, scheduled tasks) — a separate repository:
  `installer/install.sh --profile <folder or git URL>`

```bash
installer/install.sh --dry-run              # install plan
tools/check.sh                              # pre-commit gate
```
