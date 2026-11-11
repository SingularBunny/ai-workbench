# Skill evals on a non-Claude model

A runner that calls `claude -p --output-format json [--model …]` (prompt on stdin) can run on another model:
`tools/eval-executor/claude` at the front of PATH keeps the same contract and answers with the chosen
model, so the runner itself is not changed. The model is `CLAUDE_EVAL_MODEL`; the runner passes it to `--model`:

```bash
export PATH=<ai-workbench>/tools/eval-executor:$PATH
export CLAUDE_EVAL_MODEL=<OpenRouter id>            # or openai:<id> with WORKBENCH_EVAL_BASE_URL (Ollama)
# export CLAUDE_EVAL_MODEL=openclaw:<provider/model>  # via openclaw agent --local, one session per call
python3 <eval runner> …
```

The key is `WORKBENCH_EVAL_API_KEY` or `OPENROUTER_API_KEY` from `~/.openclaw/.env`; the environment proxy
is not used (`WORKBENCH_EVAL_PROXY` only when set explicitly). The shim reports failures with Claude CLI phrases:
fix the environment for "Request not allowed", "Invalid API key"; wait it out for "429", "503",
"Connection error". The shim does not provide tools (`--allowedTools`) and refuses such calls. Do not compare
measurements across different models: the difference between models is larger than the difference between edits.
