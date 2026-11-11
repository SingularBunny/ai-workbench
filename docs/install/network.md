# Network and proxy

Some providers are reachable only through a proxy (for example a region block on `api.anthropic.com`).
The installer configures one forward proxy for OpenClaw and, separately, for Claude Code. Proxy URLs may
hold credentials (`http://user:password@host:port`): the installer never prints them; the plan shows
`<proxy URL>`.

## `.env` keys

| Key | Value | Effect |
|---|---|---|
| `WORKBENCH_PROXY_URL` | `http://…` or `https://…` | `openclaw config set proxy.proxyUrl …`: OpenClaw's managed proxy. Empty: an existing proxy config is left as is |
| `WORKBENCH_PROXY_HOSTS` | host suffixes, comma-separated | with the [fork](../openclaw-fork.md): these hosts and their subdomains go through the proxy, everything else connects directly (`env.vars.OPENCLAW_PROXY_ROUTES = <hosts>=proxy;*=direct`). Empty, `*` or `all`: everything through the proxy, as with `HTTPS_PROXY` |
| `WORKBENCH_PROXY_ROUTES` | `<hosts>=<proxy\|direct\|URL>;…;*=<proxy\|direct\|URL>` | the full form; wins over `WORKBENCH_PROXY_HOSTS` |
| `WORKBENCH_CLAUDE_CODE_PROXY` | URL, `direct`, or empty | Claude Code's own proxy, see below |

Without the fork, OpenClaw sends all of its traffic through `proxy.proxyUrl` (the plan warns about it).
The proxy settings are applied with the other settings; `env.vars.OPENCLAW_PROXY_ROUTES` goes into the
single `env.vars` write and takes effect without a Gateway restart, while a changed `proxy.proxyUrl`
restarts the Gateway.

### Rules

- A host suffix matches the host itself and every subdomain (`example.com` → `api.example.com`),
  case-insensitively and on any port. `*` is every other host. The most specific match wins.
- `proxy` is the proxy URL; `direct` connects without a proxy. A URL in a rule is stored as
  `proxy.proxyUrl` and written as `proxy`, so the routes in the config hold no credentials.
- OpenClaw routes its own traffic (providers, updates, plugins, web fetch, channels) through **one**
  proxy URL. Rules that name two different URLs are refused with a reason in the plan.
- Loopback (`localhost`, `127.0.0.1`) follows `proxy.loopbackMode` (default: direct).

### Examples

```bash
# Everything through a local proxy (the default when only the URL is set).
WORKBENCH_PROXY_URL=http://127.0.0.1:3128

# Only some hosts through the proxy, the rest direct.
WORKBENCH_PROXY_URL=http://127.0.0.1:3128
WORKBENCH_PROXY_HOSTS=api.example.com,models.example.org

# Everything through the proxy except an internal host.
WORKBENCH_PROXY_ROUTES=*=http://127.0.0.1:3128;intranet.example.com=direct
```

## CLI agent backends

Agents on Claude CLI or another CLI backend run it as a child process with proxy environment
variables. With routes, `claude-cli` follows the rule for `api.anthropic.com` (with the defaults:
through the proxy); a backend whose API host is routed `direct` gets no proxy variables. To choose
per backend, including a second proxy that only that child uses:

```bash
openclaw config set env.vars.OPENCLAW_CLI_BACKEND_PROXY '"claude-cli=proxy;google-gemini-cli=http://10.0.0.5:8080"' --strict-json
```

Other programs started by OpenClaw get `HTTP(S)_PROXY` with a loopback-only `NO_PROXY` and send
everything through the proxy: a `NO_PROXY` list cannot say "only these hosts".

## Claude Code

Claude Code reads `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` from its environment or from the `env`
block of `~/.claude/settings.json`; a value in settings overrides the same variable exported in the shell.

- `WORKBENCH_CLAUDE_CODE_PROXY=<url>` — the installer merges `HTTPS_PROXY` and `HTTP_PROXY` = the URL
  and `NO_PROXY=localhost,127.0.0.1,::1` into that `env` block; other keys stay. The uninstall manifest
  records a hash of each value (not the value).
- `WORKBENCH_CLAUDE_CODE_PROXY=direct` — removes the keys the installer wrote, if they still hold the
  value it wrote; keys you changed by hand stay. A proxy exported in your session environment still
  applies; to cancel it for Claude Code, set the variable to `""` in the settings `env` block yourself.
- Empty — the file is not touched, even with proxy routes set.
- Uninstall removes the recorded keys under the same rule.

OpenClaw runs Claude CLI agents with user settings loaded (`--setting-sources user`), so these keys
apply to them too, and they override the proxy variables OpenClaw passes (`OPENCLAW_CLI_BACKEND_PROXY`
or the route default). For Claude Code and OpenClaw's Claude CLI agents to differ, leave
`WORKBENCH_CLAUDE_CODE_PROXY` empty and set the proxy for interactive Claude Code in your shell.

## Proxy page

With the [fork](../openclaw-fork.md), the Control UI has a **Proxy** tab (plugin `aiwb-fork-settings`;
the installer turns on Custom plugin UI for it). Anyone connected can view it; saving and the check need
an admin connection.

- **Managed proxy** — the proxy address as `scheme://host:port` (never the password), whether it is
  enabled and active in the running Gateway, and the state of the routes: *active*, *invalid* with the
  reason (then everything goes through the proxy), or *unset* (everything through the proxy).
- **Proxy routes** — the hosts that go through the proxy. Add a host (it covers its subdomains), switch
  it between `proxy` and `direct`, remove it, and choose what happens to every other host. **Save…**
  shows the resulting `OPENCLAW_PROXY_ROUTES` value and writes it after **Confirm**; it takes effect
  without a restart.
- **CLI backends** — which proxy each CLI agent backend gets now (`claude-cli` follows the route of
  `api.anthropic.com`), and a list to set it per backend (`OPENCLAW_CLI_BACKEND_PROXY`).
- **Check** — requests each listed host and common provider hosts directly and through the proxy and
  shows the HTTP status or error and the time. *Blocked directly, works via proxy → add to proxy list*
  means the host needs the proxy; **Add to list** puts it into the routes list (save to apply).
- **Claude Code** — whether `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` are set in `~/.claude/settings.json`.
  The page does not change them; use `WORKBENCH_CLAUDE_CODE_PROXY`.

The installer writes the routes on every run when `WORKBENCH_PROXY_URL` or `WORKBENCH_PROXY_ROUTES` is
set in `~/.openclaw/.env`. A change made on the page is then replaced by the next install: put the same
hosts into `WORKBENCH_PROXY_HOSTS` (or `WORKBENCH_PROXY_ROUTES`) to keep it. The page shows a notice when
this applies.

## Typical setup

```bash
WORKBENCH_PROXY_URL=http://127.0.0.1:3128
WORKBENCH_CLAUDE_CODE_PROXY=http://127.0.0.1:3128
```

OpenClaw sends everything through the proxy (with the fork, `WORKBENCH_PROXY_HOSTS` narrows it to the hosts
that need it); interactive Claude Code uses the proxy as well.
