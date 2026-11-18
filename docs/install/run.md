# Running

The OpenClaw installer puts `openclaw` in `~/.openclaw/bin` but does not add it to PATH.
Once, in `~/.bashrc` or `~/.zshrc`:

```bash
export PATH="$HOME/.openclaw/bin:$PATH"
```

```bash
openclaw gateway run          # Gateway on 127.0.0.1:18789
openclaw health               # is it alive
openclaw tui                  # terminal UI
```

To keep the Gateway running in the background and start it again after a reboot, install it as a service
(systemd user service on Linux, launchd on macOS; OpenClaw docs `cli/gateway.md`):

```bash
openclaw gateway install      # service openclaw-gateway, starts it now
systemctl --user restart openclaw-gateway    # restart (Linux)
journalctl --user -u openclaw-gateway -f     # its log (Linux)
```

On Linux the user service runs without an open session only with lingering on (`sudo loginctl enable-linger $(whoami)`, OpenClaw docs `gateway/index.md`).
When the installer replaces OpenClaw, it stops the service first and starts it again itself, only after the
config passes the checks of the new version (see [Upgrades](#upgrades)); then it waits for the Gateway before
writing settings. Before replacing OpenClaw the installer waits until no
Gateway session has a running agent turn (`sessions.list`, status `running`; queued turns do not count),
printing what it waits for every 5 minutes; Ctrl+C stops the install before anything is changed. With the
OpenClaw fork a restart or stop that comes anyway waits for running turns up to 30 minutes, and the
installer adds a systemd drop-in so that systemd does not kill the Gateway sooner
([OpenClaw fork](../openclaw-fork.md#restarts-and-stops-wait-for-agent-turns)). A few settings are read only when the Gateway starts (for
example `OPENCLAW_MEMORY_INDEX_ON_START`), so after an install that adds them, restart the service once more.
Do not also run `openclaw gateway run` while the service is active.

**Maintenance during an install.** With the OpenClaw fork (`gateway.maintenance.*`) the installer puts the
Gateway into maintenance mode before it replaces OpenClaw and keeps it there through the restart and the whole
setup; it turns it off when setup ends, also when setup fails or the install is stopped (Ctrl+C). Meanwhile no
chat turn starts:

- a message sent in the Control UI stays in its queue ("Chats are paused for maintenance…") and goes out by
  itself when maintenance ends; a channel with a durable queue keeps its messages and delivers them after;
  another channel answers "OpenClaw is under maintenance… send it again";
- scheduled automations that fall due wait and run right after (they are not skipped); heartbeats wait too;
- settings, plugins and skills are written as usual.

The Control UI shows "Maintenance: chats paused" with a **Resume chats** button. Turning it on, the installer
first waits for running agent turns, at most 30 minutes (`WORKBENCH_MAINTENANCE_WAIT_MIN`); if they still run,
it stops without changing anything and resumes chats. If the Gateway does not answer at the end (a failed
upgrade), the installer retries for up to 3 minutes while the service is still starting
(`WORKBENCH_MAINTENANCE_EXIT_WAIT_SEC`), then removes its own state file `~/.openclaw/gateway-maintenance.json`
(`$OPENCLAW_STATE_DIR` if set), so chats run as soon as the Gateway starts. If the installer is killed outright,
maintenance ends by itself after 2 hours (the limit is stored with the state and holds across Gateway
restarts), or press **Resume chats**. An official OpenClaw without maintenance mode: the installer
waits for idle chats before the replacement as described above, and nothing pauses chats during setup.
Maintenance can also be turned on by hand: account menu (bottom left) → **Pause chats (maintenance)**.

![Maintenance banner in the Control UI: chats paused, Resume chats](../assets/readme/maintenance.png)

Control UI — `http://127.0.0.1:18789`; the **Gateway secret** field takes `OPENCLAW_GATEWAY_TOKEN`
from `~/.openclaw/.env`.

## Upgrades

A new OpenClaw version can retire config keys (2026.11.5 retired `agents.defaults.heartbeat`); a Gateway that
finds one refuses to start ("OpenClaw config is invalid … Unrecognized key … run `openclaw doctor --fix`",
exit code 78), and systemd leaves the service failed. The installer guards against that when it replaces
OpenClaw:

1. the Gateway service is stopped, OpenClaw is replaced (`install-cli.sh --runtime-only`: no service restart);
2. `openclaw config validate`. If the new version rejects the config, `openclaw.json` is copied to
   `openclaw.json.pre-upgrade-<date>-<time>` and `openclaw doctor --fix --non-interactive` repairs it (for
   example, the old heartbeat becomes an automation `heartbeat-main`). Doctor runs with
   `OPENCLAW_SERVICE_REPAIR_POLICY=external`, so it does not touch the service; it also migrates agent databases,
   which can take minutes: progress is printed every minute, the limit is 20 minutes
   (`WORKBENCH_DOCTOR_TIMEOUT_MIN`). A doctor cut by the limit is fine when the config is valid after it — the
   Gateway finishes the migrations on start. Then the config is validated again;
3. still invalid: the install stops here with the keys at fault and the backup to restore. **The Gateway stays
   stopped** — with that config it would only crash;
4. valid: the service is started (`openclaw gateway install --force`) and the installer waits for its health, up
   to 10 minutes (`WORKBENCH_GATEWAY_START_MIN`; the first start migrates databases). A service that fails, or
   does not become healthy in time, stops the install: the last 40 lines of its journal and the fix steps are
   printed, and setup is **not** run against a Gateway that is down.

In every failed case maintenance mode is turned off (see above), so chats do not stay paused.

**Recovering by hand** (a Gateway that does not start after an upgrade):

```bash
journalctl --user -u openclaw-gateway -n 80                # why it stops
openclaw config validate                                    # which keys are at fault
cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.bak  # backup first
openclaw doctor --fix                                       # migrates retired keys (and databases: can be slow)
systemctl --user reset-failed openclaw-gateway && systemctl --user start openclaw-gateway
openclaw health
installer/install.sh --yes                                  # finishes the setup
openclaw gateway call gateway.maintenance.exit              # only if chats are still paused
```

To return to the config from before the install: `cp ~/.openclaw/openclaw.json.pre-upgrade-<date>-<time>
~/.openclaw/openclaw.json` — it fits the old OpenClaw, so reinstall the old package too
(`WORKBENCH_OPENCLAW_PACKAGE`; the previous one is kept in `~/.openclaw/workbench/`).

The upgrade path is checked in Docker with systemd and the Gateway as a user service:
`tools/validate_in_docker.sh --upgrade-from <old.tgz> --openclaw-package <new.tgz>`.
