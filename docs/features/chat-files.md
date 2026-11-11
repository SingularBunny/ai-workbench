# Chat files

When an assistant attaches a file it keeps outside its project folder (a plugin it built on the
Desktop, a report in Downloads), the chat shows it as **Unavailable · Not an image**: OpenClaw opens
files from outside the session's own folders only when they are images. Chat file folders work like
the folders you give Claude Desktop, globally and per project: any file in them opens and downloads
from the chat, whatever its type.

This needs [OpenClaw from the fork](../openclaw-fork.md). The folders apply to chats with Full Access
(the session is not limited to its workspace). Chats limited to their workspace keep the usual rule,
and the agent's own tools get no extra file access from these folders: they only decide what the chat
may show you.

## Setting the folders

**For all agents** — in `~/.openclaw/.env`, folders separated by `:`:

```bash
WORKBENCH_CHAT_FILE_FOLDERS=~/Desktop:~/Downloads:~/Projects
```

**For one project** — in the project's `project.json` in the profile (see [Projects](projects.md)):

```json
"chatFileFolders": ["~/Projects/reports", "/srv/shared"]
```

A chat gets the folders for all agents plus the folders of its own project. One project's folders
stay closed to the chats of another project.

Run the installer to apply them. Rules:

- Folders are absolute paths or start with `~/`. A path cannot contain `:` or `;`.
- `/`, your home folder itself and any folder containing it are refused: list the folders you mean
  (`~/Desktop`, `~/Downloads`), not the whole home.
- A folder that does not exist yet is kept with a warning in the install plan; it starts working once
  it exists.
- Without the key and without `chatFileFolders` the installer leaves the setting alone. With them, each
  install writes it again, replacing changes made elsewhere.
- Symlinks are followed to where they really point: a link inside a chat folder that points outside it
  does not open the outside file.

## Changing them in the Control UI

The **Chat files** page (from the `aiwb-fork-settings` plugin) shows the folders for all agents and,
with an agent picker, each agent's own folders. Type a folder and choose **Add**: the Gateway checks
that it exists, is a folder and is not `/` or your home folder. **Save…** shows the result and asks for
confirmation; the chat uses the new folders on the next file you open, without a restart. Saving needs
an administrator connection.

If `WORKBENCH_CHAT_FILE_FOLDERS` is set in `~/.openclaw/.env`, the page warns that the next install
writes the folders again from the `.env` key and the projects' `chatFileFolders`: change them there
too to keep a page edit.

The setting behind both is `OPENCLAW_ASSISTANT_MEDIA_ROOTS` (`*=<folders>;<agent id>=<folders>`), see
[OpenClaw fork](../openclaw-fork.md).
