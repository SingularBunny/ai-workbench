# JetBrains Junie

[Junie](https://junie.jetbrains.com/docs/junie-cli.html) is JetBrains' coding agent. Its CLI runs as an ACP agent
(`junie --acp=true`), and OpenClaw runs it through the `acpx` plugin. Junie's turns spend your JetBrains AI
credits (or your own provider key, if you set one in Junie); JetBrains has no API key for other tools, so this is
the way to use those credits from OpenClaw.

## Setup

1. Install Junie CLI: `npm install -g @jetbrains/junie` (its postinstall puts Junie into `~/.local/share/junie`
   and `~/.local/bin/junie`).
2. Log in: run `~/.local/bin/junie` once and sign in with your JetBrains account. Junie keeps the login itself.
3. Set `WORKBENCH_JUNIE` in `~/.openclaw/.env` to the full path of `junie` and run the installer again. It installs
   `acpx` and registers Junie as the ACP agent `junie`. With the OpenClaw fork, install `acpx` from the same fork
   too ([ACPX from the fork](../openclaw-fork.md#acpx-from-the-fork)).

## Use

- **Hand a chat to Junie.** Type `/acp spawn junie --bind here` in a chat: the chat is bound to a Junie session, and
  every following message goes to Junie until you close it (`/acp close`). Owner-only: the Control UI owner can.
- **One task from an agent.** An agent can hand Junie a single task and get the result back in its own turn:
  `sessions_spawn({ runtime: "acp", agentId: "junie", task: "..." })`.

There is no separate "Junie" agent in the agent list: OpenClaw sends an agent's turns to an ACP harness only through
these two paths, so such an agent's ordinary chat would answer with the default model.

**Credit balance.** With `acpx` from the fork, the installer adds `usage: { command: "stats" }` to Junie's entry:
the Usage page (provider plans and billing) and **Plan limits** on the Models page show **Junie** with its licence and
"Balance left" in credits. The fork reads it by sending Junie's own `/stats` in a throwaway session (no model call,
no credits spent), at most every 10 minutes, and shows how old the value is. With your own provider key in Junie
there is no balance, only the licence.

Junie works with its own permissions on the Gateway machine; OpenClaw's sandbox and read-only modes do not apply
to it. The model is Junie's (its own settings or `--model`), not the OpenClaw agent's.

**Claude rules and skills in Junie.** Junie offers to import Claude Code's rules, skills, commands and plugins
(it copies them). Links keep one copy instead: `~/.junie/AGENTS.md` → `~/.claude/CLAUDE.md`,
`~/.junie/skills/<name>` → `~/.claude/skills/<name>`, `~/.junie/commands` → `~/.claude/commands`. Claude Code's
plugins (hooks, MCP servers) are made for Claude Code and are better left out.

## When JetBrains refuses the connection

JetBrains AI answers **451** to some countries and **403** to some data-centre addresses (a shared VPN or proxy
exit); Junie then fails with `403 Forbidden` although the account and its subscription are fine. Junie's model
requests go to `*.labs.jb.gg`, its login and site to `jetbrains.com` and `jetbrains.ai`.

If a proxy of your own already reaches JetBrains on all three (for example a VPN client whose server sends these
domains out through an exit JetBrains accepts), set `WORKBENCH_JUNIE_PROXY=http://host:port` in `~/.openclaw/.env`
and re-run the installer (Linux, macOS): only Junie's process is pointed at it.

Otherwise the `aiwb-proxy-pool` plugin sends only Junie through other exits:

1. Install [proxybroker2](https://github.com/bluet/proxybroker2) (Python 3.10+).
2. In `~/.openclaw/.env` set `WORKBENCH_PROXY_POOL=1` (next to `WORKBENCH_JUNIE`) and re-run the installer. It
   installs the plugin and registers Junie as `bin/junie-via-pool --junie <your junie> --acp=true`: the wrapper
   points only Junie's process at the plugin's local proxy.
3. Point the plugin at proxybroker2 in its settings (`plugins.entries.aiwb-proxy-pool.config`):
   `proxybrokerPython` (a Python with proxybroker2) and, for a source checkout, `proxybrokerDir`.

The Gateway then keeps a pool of free proxies: proxybroker2 lists candidates, and each one must open an HTTPS
tunnel to `checkUrl` (`https://api.jetbrains.ai/` by default; certificate verified) without a 451; Russian
exits are skipped (`excludeCountries`). The plugin listens on `127.0.0.1:18795` (`port`); each connection goes
through a pool proxy, and the next one is tried when a tunnel fails. A proxy that fails twice in a row leaves
the pool; the pool is refreshed every `refreshMinutes` (60) and whenever fewer than `minPool` (5) are left.
The **Proxy pool** page in the Control UI shows the pool and has a **Refresh pool** button.

For `junie --task` from a terminal or Claude Code, run `junie-via-pool` (in the plugin's `bin/`) the same way.

Free proxies see the host names Junie connects to, not the content: HTTPS goes end to end through the tunnel
and Junie verifies the certificate. Only Junie uses the pool; the Gateway and other programs do not.

The local proxy accepts any program on this computer that is pointed at it. To keep it for Junie alone, set
`requireAuth: true` in the plugin's settings (off by default): the plugin then makes a password in
`~/.openclaw/workbench/proxy-pool.secret` (readable by you only), `junie-via-pool` reads it from there, and any
other program gets **407**. The password stays on this computer; the free proxies never see it.
