# Projects

Claude Desktop projects are moved into OpenClaw agent workspaces in the profile; the source is only
read, and existing files are not overwritten without `--force`:

```bash
node migrate/claude-desktop/projects.mjs --to <profile>/projects --dry-run
```

Memory is carried over as is, so it may contain secrets once written down in Claude
Desktop. Catch them with a secret-checking hook (`GIT_HOOKS`) before committing the profile.

`projects/<id>/`: `project.json` (name, folders), `AGENTS.md` (project instructions and folders),
`MEMORY.md` and `memory/` (memory). For a profile with `PROJECTS = { dir: "projects" }` the installer
creates one agent per project. Pick a project in the agents menu of the Control UI, or with Ctrl+G in the TUI.
On the first conversation OpenClaw adds `SOUL.md` and `IDENTITY.md` to the folder (and `USER.md` if
it is missing, see [Shared memory](memory.md)); you can keep them in git with the project. OpenClaw sessions and keys live
outside the folder, in SQLite, so they do not end up in git.

A project's chats are its folder in the "Projects" section of the sidebar. A chat can be moved to another
project by dragging it onto that project's folder: it then continues with that project's agent, see
[Chats](chats.md).

## Duplicate skill names

**Duplicate skill names.** With OpenClaw from the fork, skills that two plugins ship under the same name
are both available, named after their plugin as in Claude Code: `alpha:review` and
`beta:review`. If one of the two is OpenClaw's own bundled skill, that one keeps the plain name.
Without the fork, skill names are shared by all plugins and all agents see the version from the plugin
installed first. The install plan shows such names with a "duplicate skill name" line. A project agent can
be given one version under the plain name in `project.json`:

```json
"skills": { "<skill name>": "<plugin id>" }
```

The installer creates a link `projects/<id>/skills/<name>` to the skill folder in the plugin and adds that
folder to `skills.load.allowSymlinkTargets` (without it OpenClaw skips links pointing outside). Workspace skills
take precedence over plugin skills, so the project agent sees the chosen version and the other agents see the
shared one. The links are paths on this machine: add `projects/*/skills/` to the profile's `.gitignore`.
Uninstalling removes its own links.

## Chat file folders

`project.json` can also list folders whose files the project's chats open and download, any file type
(OpenClaw from the fork): `"chatFileFolders": ["~/Projects/reports"]`. See [Chat files](chat-files.md).

## Knowledge base

`"knowledge": ["~/Projects/garden/notes"]` in `project.json` gives the project's agent its own knowledge base
folders, searched and written to like the folders for every agent. See [Knowledge base](knowledge.md).
