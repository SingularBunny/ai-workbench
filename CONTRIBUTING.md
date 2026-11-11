# Contributing

**Pre-commit gate** — `tools/check.sh` (hook: `tools/check.sh --install-hook`): 0 — green,
2 — yellow (a check cannot run on this machine; the reason is printed), 1 — red.

**The installer is validated in Docker, not on your own machine:** `tools/validate_in_docker.sh`
(`--matrix` — all distros, `--public` — without a profile, `--reinstall` — rerun and uninstall,
`--profile-git <repository>` — profile from git).

**Tests are anonymized.** No names or logic from anyone's personal plugins and skills: examples use
neutral names (`plugin-a`, `report-*`, the Cyrillic "Сад").

**Nothing personal here.** Your own plugins, projects, scheduled tasks, chats, memory, plans and
the rules of your development environment live in the personal profile (`--profile`; structure —
`profile.mjs` with `REPOS`, `PLUGINS`, `MCP`, `TASKS`, `PROJECTS`, `MAIN`, `GIT_HOOKS`). Secrets
go only in `~/.openclaw/.env` and never into git (`tools/check.sh` checks this).
