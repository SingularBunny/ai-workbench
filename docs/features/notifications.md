# Notifications

OpenClaw can notify you in the browser when an agent finishes its reply or asks you a question, as Claude
Desktop does. This is OpenClaw's own Web Push (OpenClaw docs `web/notifications.md`); nothing extra is
installed. It works with any model, including Claude CLI: a Claude question (`AskUserQuestion`) arrives as
an agent question.

## Turn it on

1. Open the Control UI → **Settings → Notifications** → **Enable notifications**, and allow notifications
   when the browser asks.
2. Under **Account defaults**, turn on **Agent finished** and **Agent question**. **Approval requested** is
   on by default; the others are off.
3. Select **Send test**: a notification should arrive within a few seconds.

- A finished reply is not announced while that chat is open in front of you.
- Notifications carry generic text ("An agent completed its response"); **Lock-screen detail** adds names.
- **Quiet hours** and **Only these agents** limit what arrives; **This browser or app** overrides the
  account defaults for one browser.
- The Gateway sends notifications through the browser's push service (for Chrome, Google). With
  [proxy routes](../install/network.md) only the hosts you list go through the proxy; push goes direct.

With [OpenClaw from the fork](../openclaw-fork.md), the page shows its status after a reload and keeps
every switch you change in a row; in the official OpenClaw, open the page from a chat and change one
switch at a time.
