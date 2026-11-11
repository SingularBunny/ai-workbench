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
