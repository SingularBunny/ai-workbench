# Installation

| OS | Command from the project root |
|---|---|
| Linux, macOS, WSL | `installer/install.sh` |
| Windows (PowerShell) | `powershell -ExecutionPolicy Bypass -File installer\install.ps1` |

Options for both: `--dry-run` — only show the install plan; `--yes` — do not ask for confirmation;
`--plugins-root <folder>` — where your own plugins live (also `WORKBENCH_PLUGINS_ROOT`; default `~/.local/share/ai-workbench/plugins`);
`--profile <folder or git URL>` — personal profile. Given a URL (`git@…`, `https://…`, `file://…`),
the profile is cloned in a separate step with its own prompt into `--profile-dir` (default
`<plugins root>/<repository name>`). If a clone with the same origin exists, it is used; a clone
with a different origin is refused. `--dry-run` clones into a temporary folder and deletes it.
The profile's git hooks (`GIT_HOOKS`, for example a pre-commit secret check) are linked into
`.git/hooks` with a symlink.

What happens:

1. **OpenClaw** — via the official installer from openclaw.ai (Linux/macOS: `install-cli.sh`,
   Node and the CLI in `~/.openclaw`, no root; Windows: `install.ps1`). The script is downloaded
   to a file and its sha256 is printed. If the required version is already installed, the step is
   skipped. To use **OpenClaw from a fork** instead of the pinned version, see
   [OpenClaw from a fork](../openclaw-fork.md).
2. **Install plan** (`installer/setup.mjs`): marketplace, base plugins, your own plugins with a
   dependency check, settings, and the [system programs](system-programs.md) missing for the features you use
   (offered at the end of an interactive install). Nothing is done until you answer `y`.
3. **Anthropic marketplace** — a dedicated shallow clone of the repository in
   `~/.openclaw/workbench/marketplaces/` at the commit pinned in
   `openclaw/workbench.config.mjs` (`commit`, full sha): fetch by sha, checkout, then `HEAD` is
   verified — on mismatch, no base plugins are installed from it. The Claude Code clone is not
   used. OpenClaw does not accept this marketplace as a remote URL (it contains `git-subdir`
   entries).
4. **Base plugins** (for example superpowers, data-engineering, skill-creator) — from the
   marketplace, at the commits pinned in it; the profile decides which ones are needed. A base plugin already
   installed from git at its pinned commit is kept as is ("keep plugin … already at the pinned commit"): a
   reinstall would clone the same commit again.
5. **ai-workbench plugins** (judge, Claude Desktop & Code bridge, shared memory, fork settings status, document preview,
   scheduled-tasks MCP) — from the [aiwb-plugins](https://github.com/SingularBunny/aiwb-plugins)
   repository: cloned next to your own plugins (`--plugins-root`) and connected with `--link`.
   **Your own plugins come from your own repositories.** If the folder is missing, it is cloned
   with `git clone` from origin (`REPOS` in the profile); if a clone exists, it is connected with
   `openclaw plugins install --link`, and differences from origin (uncommitted or unpushed
   changes, a different origin) are printed in the plan. A plugin is skipped, with the reason,
   if a required sibling (`../<folder>`) or a required tool from the plugin's `dependencies.yml` is missing:
   ```yaml
   siblings:
     - path: ../core-lib
       required: true
   tools:
     - name: jq
       required: false
   ```
   A profile whose plugins use other key names sets them in `DEPENDENCIES` (see `installer/lib.mjs`,
   `DEPENDENCIES_FORMAT`).
   Plugins renamed in November 2026 (`ai-workbench` → `judge`, `aiwb-projects` → `aiwb-claude-bridge`,
   `aiwb-settings` → `aiwb-fork-settings`, folder `memory/` → `shared-memory/`) are moved over on a
   re-install: before the plugins are connected, the old entry is removed (`plugins uninstall`) and one
   `openclaw config patch` carries its config and hooks to the new id (keys the new entry does not have
   yet), drops `plugins.entries.<old id>`, puts the new folder in place of the old one in
   `plugins.load.paths` and the new id in `plugins.allow`/`deny`. Pull the aiwb-plugins clone first.
6. **Profile MCP servers** — at a pinned version, from their release channel: npm or a GitHub
   release with a sha256 check; optional ones only when a variable is set in `.env` (for example
   `GRAFANA_URL`). They are installed into `~/.openclaw/workbench/mcp/`, with absolute paths in
   `mcp.servers`. Check: `openclaw mcp doctor --probe` (with the Gateway stopped).
7. **Settings** — `openclaw config set` from the `openclaw/workbench.config.mjs` template,
   followed by `openclaw config validate`.

Requirements: `git` (to clone the marketplace and base plugins), `curl` (Linux/macOS). Tested on
Debian 13, Ubuntu 24.04 and 26.04, Fedora 45, Arch: neither Node nor root is required.

Private plugin repositories are cloned over SSH: you need a GitHub key and `github.com` in
`~/.ssh/known_hosts` (once: `ssh -T git@github.com`). Without access the installer does not fail;
it skips the repository and states the reason in the plan.

Updating and uninstalling — [Update and uninstall](update-uninstall.md).
