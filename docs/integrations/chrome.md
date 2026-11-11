# Chrome extension

The OpenClaw Chrome extension finds the local OpenClaw through a native host
(`ai.openclaw.browser_bootstrap`); without it the extension window says it could not find a local installation.
The installer registers the host (`openclaw browser extension install`) for Google Chrome, Chrome for
Testing and Chromium, if the browser has been launched at least once; otherwise the step is skipped with a reason.
`WORKBENCH_CHROME_EXTENSION=0` skips this step; uninstalling removes the host if the installer added it.

Get the extension itself from the [Chrome Web Store](https://chromewebstore.google.com/detail/openclaw/kcdjddhmeafeomebliikmbpblkmkfoig):
OpenClaw does not install it on Linux. If the extension was installed before the host, fully restart
Chrome (it remembers that the host was missing). Check: the extension window shows **Connected**, and
`openclaw browser extension status` prints "automatic bootstrap ready".

## Claude in Chrome for agents on Claude CLI

Claude Code drives Chrome through its own extension, Claude in Chrome. OpenClaw starts Claude CLI with
`--no-chrome` unless told otherwise, so agents lose it after moving from Claude Code. With OpenClaw from the
fork, set `WORKBENCH_CLAUDE_CHROME=1` in `~/.openclaw/.env` and re-run the installer: it sets
`env.vars.OPENCLAW_CLAUDE_CHROME=1`, and agent turns on Claude CLI start with `--chrome` (side questions and
runs with a restricted tool policy stay without it). The Claude in Chrome extension must be installed and signed
in in Chrome on this machine. Agents then control that browser, which is why the setting is off by default.
