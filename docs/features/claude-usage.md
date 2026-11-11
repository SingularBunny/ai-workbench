# Claude subscription limits

With [OpenClaw from the fork](../openclaw-fork.md), the bottom of the expanded sidebar in the Control UI
shows your Claude subscription limits, the same as claude.ai/settings/usage: a bar each for the 5-hour
window, the week and the per-model weekly limit (Sonnet/Opus), with the percentage used and the time to
reset. Hover a bar for the exact local reset time. The bars turn amber at 70% and red at 90%. When a turn
hits a limit, the line "5h limit reached · resets in …" appears straight away.

- The numbers come from your Claude CLI login. OpenClaw reads it read-only and never refreshes the
  token: if the token has expired, the block appears after Claude CLI's next run.
- Anthropic is asked at most once a minute; after an HTTP 429 the wait grows from 2 to 15 minutes while
  the last values stay on screen.
- Without a Claude subscription (an API key only), or with the sidebar collapsed, the block is hidden.
