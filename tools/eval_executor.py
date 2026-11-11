"""Eval executor not running on Claude: the pure part of the `claude -p` stand-in.

Eval runners call the model with `claude -p --output-format json [--model M]`, the prompt on
stdin, the reply is JSON with `result` and `is_error`. The stand-in `tools/eval-executor/claude` on PATH
keeps the same contract and answers with another model; the runner is not changed. The model comes
from `--model` (the runner usually passes `CLAUDE_EVAL_MODEL` there) or `WORKBENCH_EVAL_MODEL`:

    openai:<id> or just <id>      — OpenAI-compatible provider (OpenRouter, Ollama, …)
    openclaw:<provider/model>     — `openclaw agent --local` with that model; openclaw — its default model

Failures use the Claude CLI phrases runners classify errors by:
fix the environment — "Request not allowed" / "Invalid API key" / "credit balance is too low",
wait it out — "429", "503", "timeout", "Connection error".
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Optional


class ExecError(Exception):
    """Call failure; the text goes into the reply's result and is read by the runner."""


@dataclass
class Call:
    prompt: Optional[str] = None
    output_json: bool = False
    model: str = ""
    tools: str = ""
    unknown: list = field(default_factory=list)


def parse_args(argv: list[str]) -> Call:
    """`claude` arguments: -p/--print [prompt], --output-format, --model, --allowedTools."""
    c, i = Call(), 0
    while i < len(argv):
        a = argv[i]
        if a in ("-p", "--print"):
            if i + 1 < len(argv) and not argv[i + 1].startswith("-"):
                c.prompt, i = argv[i + 1], i + 1
        elif a == "--output-format":
            c.output_json, i = argv[i + 1] == "json", i + 1
        elif a == "--model":
            c.model, i = argv[i + 1], i + 1
        elif a in ("--allowedTools", "--allowed-tools"):
            c.tools, i = argv[i + 1], i + 1
        elif c.prompt is None and not a.startswith("-"):
            c.prompt = a
        else:
            c.unknown.append(a)
        i += 1
    return c


def resolve(model: str, env: dict) -> tuple[str, str]:
    """(executor, model): openai or openclaw. No model means refusal, not a default model:
    otherwise the run JSON records "default" and there is no telling whose measurement it is."""
    m = (model or env.get("WORKBENCH_EVAL_MODEL", "")).strip()
    if m == "openclaw" or m.startswith("openclaw:"):
        return "openclaw", m.partition(":")[2]
    if not m:
        raise ExecError("Request not allowed: executor model is not set — CLAUDE_EVAL_MODEL "
                        "(the runner passes it as --model) or WORKBENCH_EVAL_MODEL")
    return "openai", m.removeprefix("openai:")


def http_error(code: int, body: str) -> ExecError:
    """Provider code → phrase the runner uses to tell fatal from "wait it out"."""
    tail = f"(HTTP {code}): {body[:300]}"
    if code in (401, 403):
        return ExecError(f"Invalid API key {tail}")
    if code == 402:
        return ExecError(f"credit balance is too low {tail}")
    if code == 429:
        return ExecError(f"429 rate limit {tail}")
    if code >= 500:
        return ExecError(f"HTTP {code} {tail}")
    return ExecError(f"Request not allowed {tail}")


def openai_text(data: dict) -> str:
    try:
        text = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ExecError(f"provider reply has no choices[0].message.content: {str(data)[:200]}") from exc
    if not (text or "").strip():
        raise ExecError("empty model reply — timeout or provider refusal")
    return text


def openclaw_text(stdout: str) -> str:
    """`openclaw agent --json` reply: payloads[].text (`--local`) or result.payloads[].text (via the
    Gateway); status notices are skipped."""
    try:
        data = json.loads(stdout[stdout.index("{"):])
    except (ValueError, json.JSONDecodeError) as exc:
        raise ExecError(f"openclaw agent replied with non-JSON: {stdout[:200]}") from exc
    if data.get("ok") is False or data.get("status") not in (None, "ok"):
        raise ExecError(f"openclaw agent: {json.dumps(data.get('error') or data, ensure_ascii=False)[:300]}")
    payloads = data.get("payloads") or (data.get("result") or {}).get("payloads") or []
    parts = [p.get("text", "") for p in payloads if not p.get("isStatusNotice")]
    text = "\n".join(t for t in parts if t)
    if not text.strip():
        raise ExecError("empty openclaw agent reply — timeout or model refusal")
    return text


def cli_output(text: str, error: Optional[str], model: str, as_json: bool) -> tuple[str, int]:
    """Reply shaped like `claude -p`: JSON {type, is_error, result} or plain text."""
    if not as_json:
        return (error or text), (1 if error else 0)
    body = {"type": "result", "subtype": "error" if error else "success", "is_error": bool(error),
            "result": error or text, "model": model, "executor": "ai-workbench eval-executor"}
    return json.dumps(body, ensure_ascii=False), (1 if error else 0)
