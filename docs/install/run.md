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
When the installer replaces OpenClaw, the official `install-cli.sh` restarts the service by itself, and the
installer waits for it before writing settings. Before replacing OpenClaw the installer waits until no
Gateway session has a running agent turn (`sessions.list`, status `running`; queued turns do not count),
printing what it waits for every 5 minutes; Ctrl+C stops the install before anything is changed. With the
OpenClaw fork a restart or stop that comes anyway waits for running turns up to 30 minutes, and the
installer adds a systemd drop-in so that systemd does not kill the Gateway sooner
([OpenClaw fork](../openclaw-fork.md#restarts-and-stops-wait-for-agent-turns)). A few settings are read only when the Gateway starts (for
example `OPENCLAW_MEMORY_INDEX_ON_START`), so after an install that adds them, restart the service once more.
Do not also run `openclaw gateway run` while the service is active.

Control UI — `http://127.0.0.1:18789`; the **Gateway secret** field takes `OPENCLAW_GATEWAY_TOKEN`
from `~/.openclaw/.env`.
