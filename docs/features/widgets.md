# Interactive widgets in chat

The OpenClaw counterpart of Claude Desktop artifacts. Ask the agent to "show a widget": it calls
`show_widget`, and the HTML page appears right in the chat of the Control UI, in a sandbox with its own
origin. Buttons in the widget can send messages to the chat (`sendPrompt`), and a widget can be pinned
to the session board. This works with any model, including Claude CLI (OpenClaw docs
`tools/show-widget.md`).

## Widget state

With [OpenClaw from the fork](../openclaw-fork.md), a widget keeps its state across page reloads, as an
artifact with storage does. The widget code uses `window.storage` (`get`, `set`, `delete`, `list`; values
are strings) — the same calls as in Claude artifacts, personal storage only. State is kept on the Gateway,
separately for each widget in each session:

- a rewind or a branch switch in the chat keeps it; forking into a new chat copies it, then the copies
  diverge;
- limits: 256 KB per value, 1 MB and 1,000 keys per widget. Claude allows 20 MB per artifact; a widget
  holds the state of its interface (a counter, a tab, a filter), not working data;
- if the state could not be saved or loaded, a line with the reason appears under the widget;
- widgets shown before the fork was installed, and widgets pinned to the board, have no storage: ask the
  agent to show the widget again.

## MCP Apps

[MCP Apps](https://modelcontextprotocol.io/extensions/apps) is the standard for interactive views from
MCP servers, also used by Claude Desktop and ChatGPT. OpenClaw renders them in the chat, but the
setting is off: the view HTML comes from the MCP server. To enable it, set `WORKBENCH_MCP_APPS=1` in
`~/.openclaw/.env` and re-run the installer, then restart the Gateway; `0` turns it off again. The views
open from a separate sandbox on the Gateway port + 1 (18790 by default), and `openclaw security audit`
warns while they are on. Enable it only for MCP servers you trust (OpenClaw docs `cli/mcp/apps.md`).

## What artifacts have and widgets do not

- **Versions and editing.** An artifact is updated in place and keeps versions; a changed widget is a new
  `show_widget` call with a new widget, and its state starts empty.
- **Publishing and sharing.** Widgets live only in your chat; there is no link for other people and no
  shared storage.
