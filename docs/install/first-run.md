# First run

From a clean machine to the first answer in the chat. Linux, macOS or WSL; you
need `git` and `curl`, but neither Node nor root. Some features use programs from your package manager
(LibreOffice, poppler, OCR); the plan lists the missing ones, see [System programs](system-programs.md). Windows: the same steps with `installer\install.ps1`
([Installation](index.md)).

1. **Get ai-workbench.**

    ```bash
    git clone https://github.com/SingularBunny/ai-workbench.git
    cd ai-workbench
    ```

2. **Look at the plan, then install.** `--dry-run` prints what will be installed and changes nothing.
   The install itself shows the same plan and waits for `y`.

    ```bash
    installer/install.sh --dry-run
    installer/install.sh
    ```

    It ends with `Done: errors 0, skipped N.` Skipped steps are listed with their reasons: without a
    profile, the personal parts are skipped, and that is expected.

3. **Put `openclaw` on PATH**, if the installer says it is not there. Once, in `~/.bashrc` or `~/.zshrc`,
   then open a new terminal:

    ```bash
    export PATH="$HOME/.openclaw/bin:$PATH"
    ```

4. **Add a model key** to `~/.openclaw/.env`, the file the installer created with the Gateway token:

    ```bash
    $EDITOR ~/.openclaw/.env      # OPENROUTER_API_KEY=…
    ```

    With an OpenRouter key the default model is `openrouter/auto`, nothing else to set. With only an
    Anthropic key, also set `WORKBENCH_DEFAULT_MODEL` (for example `anthropic/claude-sonnet-5-5`) and run
    `installer/install.sh` again. A Claude subscription instead of a key: [Keys](keys.md#claude-subscription).
    All the keys of this file: [Settings reference](../reference/env.md).

5. **Start the Gateway** and check that it is alive:

    ```bash
    openclaw gateway run          # keep this terminal open
    openclaw health               # in another terminal
    ```

    To run it in the background and after a reboot, install it as a service: [Running](run.md).

6. **Open the chat.** Go to `http://127.0.0.1:18789` and paste `OPENCLAW_GATEWAY_TOKEN` from
   `~/.openclaw/.env` into the **Gateway secret** field; or run `openclaw tui` in the terminal. Write a
   message: the answer comes from the default model.

## If something is off

- **`openclaw: command not found`** — step 3.
- **`openclaw health` fails** — the Gateway is not running (step 5), or another program holds port 18789.
- **The chat answers with an authentication or "no API key" error** — the key is missing or misspelled
  in `~/.openclaw/.env`; fix it and restart the Gateway (OpenClaw reads the file when it starts).
- **No connection to the model provider** — a proxy may be needed: [Network and proxy](network.md).
- **Settings changed** — run `installer/install.sh` again: it rewrites only its own settings and validates
  the config.

Next: your own plugins and projects from a personal profile ([Home](../index.md)), moving over from
Claude Desktop ([Projects](../features/projects.md), [Chats](../features/chats.md)), and
[backups](backup.md).
