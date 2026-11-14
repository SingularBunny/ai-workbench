# Scheduled tasks

If the profile sets `TASKS`, the installer connects the `scheduled-tasks` MCP server: the same
tools as in Claude Desktop (`list/create/update/delete_scheduled_task`), on top of
`openclaw automations`. It sees and changes only tasks from the profile's `TASKS.allow` list
that it created itself; OpenClaw system tasks are not available to it.

The profile's starter tasks are created through the Gateway. If the Gateway is running during installation, the installer
creates them itself; if not, run after `openclaw gateway run`:

```bash
node <plugins root>/aiwb-plugins/mcp/scheduled-tasks/sync.mjs --profile <profile folder> [--dry-run]
```

`sync` leaves existing tasks alone. Results are in the Control UI, Automations →
run → transcript; they are not delivered anywhere else. To check a task right away:
`openclaw automations run <id> --wait`.

## Run the model only when there is work

The installer adds [cronhook](https://clawhub.ai/plugins/cronhook) from ClawHub (MIT). It does nothing until it has
rules. A rule ties a scheduled task to a script that runs before the model: in `gate` mode the script's exit code
decides — `0` runs the task's turn, `10` skips it without waking the model; in `task` mode the script is the whole job
and the model never runs. The rules go to `plugins.entries.cronhook.config.rules`, matched by the task's `jobId`:

```json5
{ rules: [{ mode: "gate", match: { trigger: "cron", jobId: "<task id>" },
            file: "~/bin/has-new-mail.sh", timeoutSeconds: 30 }] }
```

The task id is in `openclaw automations list --json`. The full rule schema is in the plugin's README on ClawHub.
