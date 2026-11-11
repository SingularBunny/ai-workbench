# Judge

The `judge` skill of the `judge` plugin (folder `judge/` of aiwb-plugins) is installed by the installer. In `~/.openclaw/.env` set
a judge model from a **different family** than the one answering:

```bash
WORKBENCH_JUDGE_MODEL=<model id at the provider>     # without it: "NOT EVALUATED"
# the default provider is OpenRouter with OPENROUTER_API_KEY; otherwise:
WORKBENCH_JUDGE_BASE_URL=http://127.0.0.1:11434/v1  # e.g. Ollama
```

Free OpenRouter models work (`…:free`, a key without payment), for example
`nvidia/nemotron-3-ultra-550b-a55b:free` or `google/gemma-4-26b-a4b-it:free`. Free models
sometimes return "temporarily rate-limited upstream" (429); the judge then honestly reports "NOT EVALUATED",
so retry later or pick another one. If OpenRouter answers 403 "Access denied by security
policy" (some regions), you need your own proxy: `WORKBENCH_JUDGE_PROXY=http://…`, used only by the judge.
The verdict is capped at 4,096 tokens (`WORKBENCH_JUDGE_MAX_TOKENS` changes it): without a cap OpenRouter
reserves the model's whole output window and refuses a key with a smaller credit limit (HTTP 402).

**Judge on a Claude subscription**: no key, via Claude CLI: `WORKBENCH_JUDGE_MODEL=claude-cli/<id>`,
for example `claude-cli/claude-haiku-5-5`. One `claude -p` turn without tools, MCP, hooks or
session persistence; it uses your subscription limits. The environment proxy is not passed on; if Anthropic
answers 403 "Request not allowed" from here, use the same `WORKBENCH_JUDGE_PROXY`. With agents on Claude
the report warns about bias: the judge and the answering model are from the same family.

The judge runs only on request; it does not run on every answer by itself. In chat: "evaluate your
answer with the judge". An agent on Claude CLI does not retype its answer: the script takes the question and answer from
the Claude Code transcript of this working folder (`--from-session`); otherwise the agent builds the file.
By hand (the judge lives in the `aiwb-plugins` clone next to your own plugins): `python3 <plugins root>/aiwb-plugins/judge/skills/judge/scripts/judge.py --input exchange.json`
(`{"question", "answer", "answer_model"}`). Exit code 0 means there is a verdict, 2 means not evaluated. To remove the judge from an
agent entirely, use the agent's skill list (`agents.entries.<id>.skills`, OpenClaw docs
`tools/skills-config.md`).

**Own criteria.** `WORKBENCH_JUDGE_CRITERIA=<file.json>` replaces the built-in criteria with yours (a list of
`{id, name, question}` with the same ids: `answers`, `format`, `security`, `tone`), for example rules that fit
how you work: links in reports, what counts as unsafe in your own questions, which friendly phrases are fine.

**How far to trust it.** The judge was checked against a person's own verdicts on 39 real answers. With
criteria tuned to that person it rarely raises false alarms on safety and tone, but it misses most
substance problems: those usually show only in the user's next message ("you misunderstood", "that did
not work"), which the judge does not see. Treat its report as a second opinion on the answer text, not as a
measure of quality.

Skill evals on a non-Claude model: [Evals](evals.md).
