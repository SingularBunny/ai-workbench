# Validating the installer in Docker

Without installing on the host:

```bash
tools/validate_in_docker.sh                   # Debian: full install.sh, plugins read-only; install.ps1 parse check
tools/validate_in_docker.sh --distro fedora   # one distro: debian, ubuntu-24.04, ubuntu-26.04, fedora, arch
tools/validate_in_docker.sh --matrix          # all five in parallel plus a summary table (~5 min)
tools/validate_in_docker.sh --matrix --clean  # same on a clean machine: clones are fetched from the repositories
tools/validate_in_docker.sh --public          # public build without a profile, as an outsider would get it
tools/validate_in_docker.sh --reinstall       # plus a rerun, uninstall, and install after uninstall
```

With a fork package — `--openclaw-package <.tgz>` ([OpenClaw from a fork](../openclaw-fork.md)).

**Without Claude, on a real model:** `--live-model <OpenRouter id>` (for example
`nvidia/nemotron-3-ultra-550b-a55b:free`) makes the model the default and, after the usual checks, runs
`tools/live_model_check.py`: real chat turns through the Gateway — a reply, the knowledge base, saving to memory and
recalling it in another chat, a docx attachment, a scheduled task created by the agent and run once, a project agent,
and the judge on a model of another family (`--live-judge`, `google/gemma-4-31b-it:free` by default). Markers
`LIVE_*`. It takes `OPENROUTER_API_KEY` from the environment or `~/.openclaw/.env` and never prints it; free models
cost nothing but use the key's daily request limit: about twenty turns per run, and OpenRouter allows 50 free
requests a day without credits. Where OpenRouter is reachable only through a proxy on the host's loopback, add
`--live-proxy 127.0.0.1:<port>`: a relay (`tools/tcp_relay.py`) on the Docker bridge address makes it reachable
from the container for the run's duration.
A Groq model works as the judge (`--live-judge groq/qwen/qwen3.8-27b`, `GROQ_API_KEY`): its free tier allows
many requests a day, and judge requests are small. Not as the agent model: the free tier caps a request at about
8,000 tokens a minute, less than an OpenClaw agent prompt with its tools, so every turn fails with "Request too large".
The first step checks which model a turn really ran on and stops the run when it is another one; with a Groq agent
model the OpenRouter key in the container stays a dummy, so nothing can fall back to a paid model.

## Secret check before a commit

`tools/check-secrets.sh` runs [gitleaks](https://github.com/gitleaks/gitleaks) over the staged changes and
prints findings with values redacted. Enable it once per clone:

```bash
ln -s ../../tools/check-secrets.sh .git/hooks/pre-commit
```

A line that only looks like a secret (a test token on a bench) is skipped with a `gitleaks:allow` comment on
that line; a finding in text that cannot change goes to `.gitleaksignore` by its fingerprint.
