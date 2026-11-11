# Differences from Claude Code

- **Skill names are global**, with no plugin namespace: if two plugins provide a skill with the
  same name, only one is visible; built-in OpenClaw skills override plugin skills of the same name.
- OpenClaw does not run **plugin hooks** (`hooks/hooks.json`).
- Plugin scripts that look for other plugins in `~/.claude/…` will not find them in OpenClaw.
