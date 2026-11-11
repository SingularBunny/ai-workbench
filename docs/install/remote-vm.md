# Model and Claude CLI on a VM

- **Model**: `ssh -N -L 11434:127.0.0.1:11434 <vm>`, then `WORKBENCH_OLLAMA_URL=http://127.0.0.1:11434`.
- **Claude CLI**: on the VM — `npm i -g @agentclientprotocol/claude-agent-acp`, log in to the
  Claude CLI, put `tools/remote-vm/acp-reaper` from this repository on PATH, and keep the project at the
  same absolute path. Locally — set `WORKBENCH_VM_SSH=user@vm`, run the installer again (it installs
  the acpx plugin), and in chat run `/acp spawn claude`. Tested with the real Claude CLI on a test
  bench: commands run on the VM, a session continues after an ssh drop, and
  `acp-reaper` leaves no processes behind. The ACP adapter accepts model aliases (`opus`, `sonnet`,
  `haiku`), not full model ids. On the VM the Claude CLI needs the same network access as locally
  (for example a wrapper script on PATH that sets `HTTPS_PROXY` and runs `claude-agent-acp`).
