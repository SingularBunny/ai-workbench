# Plan mode

Plan mode makes an agent research and present a plan before it changes anything, as Claude Code's plan mode does,
but for any model. It comes with the `aiwb-plan` plugin.

## Using it

1. Type `/plan` in a chat. The chat stays in plan mode until you approve a plan or type `/plan off`
   (`/plan status` tells whether it is on). A Gateway restart keeps it.
2. Ask your question. The agent reads, searches and thinks, but:
    - `write`, `edit` and `apply_patch` are refused;
    - each `exec` command and each subagent start (`sessions_spawn`) shows an approval card; allow the ones that
      only read.
3. When the plan is ready, the agent calls `exit_plan_mode`, and the chat shows an approval card with the plan.
    - **Allow** approves the plan: plan mode ends and the agent carries the plan out.
    - **Deny** keeps plan mode: tell the agent what to change, and it presents the plan again.

While the chat plans, the agent is told so at the start of every turn.

## Claude CLI sessions

Claude CLI chats have Claude Code's own plan mode in the composer's mode picker; use that one there. `/plan` in a
Claude CLI chat covers only OpenClaw's tools (on managed turns, all of them), not Claude Code's own `Write` and `Edit`
of unmanaged turns.

## Setup

The installer adds the plugin and sets `plugins.entries.aiwb-plan.hooks.allowConversationAccess`, which the plan-mode
note in the prompt needs. Which chats plan is kept in `~/.openclaw/workbench/plan-mode.json`.
