# OpenClaw from a fork

Linux, macOS: `WORKBENCH_OPENCLAW_PACKAGE` — an npm package (`.tgz`, a path or `https://`),
`WORKBENCH_OPENCLAW_PACKAGE_SHA256` — its sha256 (required; on mismatch the package is not
installed). The same `install-cli.sh` installs it (`--version <package>`) instead of the pinned
version; the same package is not reinstalled. To build the fork package, run
`tools/openclaw-fork-build.sh <fork folder>` (Docker, the committed tree; the package and its sha256
land in `dist/openclaw-fork/`). The default build takes about 5 minutes: the same JavaScript and Control UI
as a release, without the shared type declarations (`.d.ts`) that only plugin authors need for type
checking; this is enough to install and run. `--release` builds exactly like an OpenClaw release (~30
minutes). To check it, run `tools/validate_in_docker.sh --openclaw-package <.tgz>`. The installer does not
modify the fork's files (copies left from earlier patches are removed).

The installer keeps the installed package and the one before it in `~/.openclaw/workbench/`
(`openclaw-package.tgz`, `openclaw-package.previous.tgz`, about 110 MB each). So `dist/openclaw-fork/` can be
cleaned: if the package named in `WORKBENCH_OPENCLAW_PACKAGE` is gone, the installer takes the kept copy
with the same sha256. To roll back to the previous build, put its sha256 back into
`WORKBENCH_OPENCLAW_PACKAGE_SHA256` and re-run the installer. To install the same build on another machine,
copy `openclaw-package.tgz` there and point `WORKBENCH_OPENCLAW_PACKAGE` at it, or publish the package and
use its `https://` address. Uninstalling ai-workbench leaves these copies and the installed OpenClaw in place.

**Back to the official OpenClaw.** Remove `WORKBENCH_OPENCLAW_PACKAGE` and `WORKBENCH_OPENCLAW_PACKAGE_SHA256` from
`~/.openclaw/.env` and re-run the installer: it sees that the fork is installed and asks whether to replace it
with the official OpenClaw of the pinned version (`--yes` replaces it without asking; without a terminal and
without `--yes` the fork stays). The kept fork copies stay, so setting the variables again returns the fork.
Uninstalling ai-workbench does not touch OpenClaw and says when it stays installed from the fork.
Values hardcoded in OpenClaw are read by the fork from environment variables, which are set by
the `env.vars` setting (`openclaw config set`, Gateway method `config.patch`); without them it
behaves like OpenClaw:

| Variable | Default | What it sets |
|---|---|---|
| `OPENCLAW_WORKER_PENDING_TASKS` | 128 | worker task queue |
| `OPENCLAW_WORKER_PENDING_BYTES` | 268435456 (256 MB) | worker queue size |
| `OPENCLAW_WORKER_HEAP_MB` | 512 | memory (heap) of the state, transcript and SQLite workers |
| `OPENCLAW_CATALOG_CONTINUATION_MAX_ITEMS` | 200 | how many entries of the native chat "continue" carries over from the catalog |
| `OPENCLAW_CATALOG_CONTINUATION_MAX_BYTES` | 524288 (512 KB) | their size |
| `OPENCLAW_CATALOG_IMPORT_OWNER` | off | `1` — user messages from the catalog are marked as the owner's messages ([Shared memory](features/memory.md#old-chats-into-memory)) |
| `OPENCLAW_MEMORY_INDEX_ON_START` | off | `1` — every agent's memory index opens when the Gateway starts, not on its first search ([Shared memory](features/memory.md#local-semantic-search)); the installer sets it with the fork |
| `OPENCLAW_CLAUDE_CHROME` | off | `1` — Claude CLI agent turns get Claude in Chrome (`--chrome`); the installer sets it with `WORKBENCH_CLAUDE_CHROME=1` |
| `OPENCLAW_CLAUDE_PROMPT_SUGGESTIONS` | on | `0` or `false` — Claude CLI runs stop emitting next-prompt suggestions (composer ghost text) |
| `OPENCLAW_SESSION_OBSERVER_MIN_INTERVAL_MS` | 12000 | minimum gap, ms, between live progress digests of a running chat (each is a utility-model call, only while a Control UI tab is open) |
| `OPENCLAW_ACTIVITY_RECAP_MIN_INTERVAL_MS` | 90000 | minimum gap, ms, between Activity recaps while a run goes on; a run end still refreshes the recap at once |
| `OPENCLAW_RESTART_AGENT_RUN_WAIT_MS` | off | how long a restart or a stop of the Gateway waits for running agent turns: milliseconds above 300000, or `unlimited` — until no turn runs. Without it a restart is forced after 5 minutes and a stop (`systemctl --user stop`/`restart`, SIGTERM, Ctrl+C) after 20 seconds, aborting running turns; other work stays bounded by those budgets. See [Restarts and stops wait for agent turns](#restarts-and-stops-wait-for-agent-turns). The installer sets `1800000` (30 minutes) with the fork; for no bound, `openclaw config set env.vars.OPENCLAW_RESTART_AGENT_RUN_WAIT_MS '"unlimited"' --strict-json` |
| `OPENCLAW_PLUGIN_GATEWAY_METHODS` | none | Gateway methods a plugin outside OpenClaw may call in process: `<plugin id>=<method>,<method>;…`, exact names, `operator.write` at most. The installer grants the bridge its methods ([Chats](features/chats.md)) |
| `OPENCLAW_PROXY_ROUTES` | none | which hosts use the managed proxy (`proxy.proxyUrl`): `<host suffixes>=<proxy\|direct\|URL>;*=<proxy\|direct\|URL>`; a suffix matches the host and its subdomains, the most specific wins; without a `*` rule other hosts use the proxy. One proxy URL in process. Read on every connection. The installer sets it from `WORKBENCH_PROXY_URL`/`_HOSTS`/`_ROUTES` ([Network and proxy](install/network.md)) |
| `OPENCLAW_CLI_BACKEND_PROXY` | route of the backend's API host | proxy env of CLI agent backend children: `<backend id>=<proxy\|direct\|URL>;…`, e.g. `claude-cli=proxy`; a URL here may be any proxy. Without a rule, `claude-cli` follows the route of `api.anthropic.com`, other backends inherit the Gateway's env |
| `OPENCLAW_ASSISTANT_MEDIA_ROOTS` | none | extra folders whose files the chat previews and downloads (any type) in Full Access sessions: `*=<folders>;<agent id>=<folders>`, folders `:`-separated absolute or `~` paths; a chat gets the `*` folders plus its agent's; `/` and the home folder are refused. Read on every request. The installer sets it from `WORKBENCH_CHAT_FILE_FOLDERS` and the projects' `chatFileFolders` ([Chat files](features/chat-files.md)) |

The installer writes all the variables it sets in one `config set --batch-json` at the start of the
settings, right after the Gateway restart: one config reload covers them all.

`WORKBENCH_FORK_PRESETS` sets groups of these variables (`WORKBENCH_OPENCLAW_PATCHES` is its old name and still works):
`worker-limits` — 4096 tasks, 4 GB, 8192 MB; `catalog-owner` — the owner mark. Uninstall removes
what was set. For example:
`openclaw config set env.vars.OPENCLAW_CATALOG_CONTINUATION_MAX_ITEMS '"1000"' --strict-json`.
The value is read when used, and the fork applies a change of these variables without a restart: the
Gateway hot-reloads `env.vars.<NAME>` within seconds (fork builds before 09.11.2026 restarted the
Gateway for any `env.vars` change and, after 5 minutes, aborted turns still running). A change of any
other `env` variable still restarts the Gateway. `OPENCLAW_MEMORY_INDEX_ON_START` is read when the
memory service starts, so its change takes effect at the next Gateway start; `OPENCLAW_WORKER_HEAP_MB`
applies to workers started after the change. A value set in the process environment or in
`~/.openclaw/.env` takes precedence over the setting. An invalid value (not an integer greater than zero) silently falls back to the
default.
To see what is in effect in the Gateway right now, use the fork settings plugin
(`aiwb-fork-settings`): `openclaw gateway call aiwb-fork-settings.effective --json` — for each variable, its kind
(`int` with `unit`, `min`, `max`; `flag`; `grants`), value, default and where it comes from (`env.vars`, `environment` — the process environment or
`~/.openclaw/.env`, `default`); values the fork ignores are marked `invalid`, integers outside the
accepted range `outOfRange`; `fork` is the sha256 of the
fork package (without the fork the variables change nothing). The same summary appears as an
`aiwb-fork-settings:` line in the Gateway log at startup. `openclaw config get` masks `env.vars`
values, and `/proc/<pid>/environ` does not contain them — it holds the environment at startup.

The same plugin sets them (`operator.admin`, like `config.patch`). `set` checks the value against the
variable's kind and range, refuses unknown names, and writes `env.vars.<NAME>`; `unset` removes it, so
the default applies again:

```bash
openclaw gateway call aiwb-fork-settings.set --params '{"name":"OPENCLAW_SESSION_OBSERVER_MIN_INTERVAL_MS","value":90000}' --json
openclaw gateway call aiwb-fork-settings.set --params '{"name":"OPENCLAW_CLAUDE_CHROME","value":true}' --json
openclaw gateway call aiwb-fork-settings.unset --params '{"name":"OPENCLAW_SESSION_OBSERVER_MIN_INTERVAL_MS"}' --json
```

The answer names the written path; `overriddenByEnvironment` means the process environment or
`~/.openclaw/.env` holds another value, which keeps winning. The plugin writes the config file itself
(`api.runtime.config.mutateConfigFile`), so it needs no `OPENCLAW_PLUGIN_GATEWAY_METHODS` grant.

## Claude subscription limits

The sidebar of the Control UI shows the Claude subscription limits (5 hours, week, per model) — [Claude subscription limits](features/claude-usage.md).

## Restarts and stops wait for agent turns

With `OPENCLAW_RESTART_AGENT_RUN_WAIT_MS` the fork's Gateway does not abort a running agent turn when it
restarts or stops, up to that bound:

- a config change that needs a restart waits while turns run; new turns still start meanwhile;
- the restart itself (for example after an install replaced the package) and a stop
  (`systemctl --user stop` or `restart`, SIGTERM, Ctrl+C, also a `systemctl restart` that arrives during
  such a restart) keep draining while turns run; new messages get the restart error until the Gateway
  is back, so the wait ends when the running turns finish;
- a second SIGTERM or Ctrl+C, or `systemctl --user kill -s QUIT openclaw-gateway`, stops waiting: what still
  runs is aborted, as without the variable;
- the Control UI shows the wait at the top of the window: "Gateway restarting" or "Gateway stopping",
  the turns it waits for and the latest time;
- a turn that is aborted anyway (the bound ran out, or the stop was forced) is marked as interrupted by a
  Gateway restart; after the restart OpenClaw resumes it, and the chat shows "Gateway restarted.
  Resuming your interrupted request."

systemd kills a service that does not stop within its `TimeoutStopSec`; `openclaw gateway install` writes
330 s into the unit and rewrites the unit on every install. The installer therefore adds a drop-in
`~/.config/systemd/user/openclaw-gateway.service.d/aiwb-agent-turn-wait.conf` with
`TimeoutStopSec=1920` (the 30-minute wait plus 2 minutes for the Gateway's own cleanup) and runs
`systemctl --user daemon-reload`; reinstalls keep drop-ins. The Gateway reads the effective stop timeout
and never waits longer than it allows (it logs a warning at startup when the timeout is shorter than the
wait). After changing the wait by hand, change the drop-in too. Without the fork (switch to the official
OpenClaw) and on uninstall the installer removes the drop-in. `openclaw doctor` lists it as an operator
override of installer policy. Only Linux with the user service gets the drop-in; on macOS launchd's
330 s stop timeout bounds a stop.

With `systemctl --user restart` running while a turn goes on, the command itself returns only after the
Gateway has stopped, up to the wait.

## Without the fork

Chats with tens of thousands of messages do not fit into OpenClaw's worker queues (128 tasks,
256 MB — hardcoded): indexing fails with "worker task capacity reached". Upstream OpenClaw has no
setting for them, and the installer no longer patches its files: use the fork with
`WORKBENCH_FORK_PRESETS=worker-limits` (see above). An install made with the old file patches is
replaced cleanly when the fork package is installed. `openclaw memory forget --session <key>` removes archive copies and scheduled
runs from memory (the transcript stays but is no longer indexed).

Owner mark for imported chats (`catalog-owner`) — [Shared memory](features/memory.md#old-chats-into-memory).
