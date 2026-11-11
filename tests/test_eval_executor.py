"""Tests for the `claude -p` stand-in for eval runners: the reply contract, executor choice, and that
a failure is named with the phrase the runner uses to tell "fix the environment" from "wait it out".
Core: tools/eval_executor.py."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import eval_executor as ex  # noqa: E402

# Phrases eval runners use to classify Claude CLI failures: fatal stops, transient retries.
FATAL = ("Not logged in", "Failed to authenticate", "Request not allowed", "Invalid API key",
         "credit balance is too low", "spend limit", "usage limit", "quota exceeded")
TRANSIENT = ("ECONNRESET", "ETIMEDOUT", "socket hang up", "network", "timeout", "Connection error",
             "fetch failed", "EAI_AGAIN", "502", "503", "504", "429", "Overloaded", "rate limit")


def test_arguments_as_passed_by_ext_forge_runners():
    c = ex.parse_args(["-p", "--output-format", "json", "--model", "openai/gpt-x"])
    assert (c.prompt, c.output_json, c.model, c.tools) == (None, True, "openai/gpt-x", "")
    assert ex.parse_args(["-p", "answer in one word: ok"]).prompt == "answer in one word: ok"
    assert ex.parse_args(["-p", "--output-format", "json", "--allowedTools", "Bash,Read"]).tools == "Bash,Read"


def test_executor_by_model_and_refusal_without_model():
    assert ex.resolve("openai/gpt-x", {}) == ("openai", "openai/gpt-x")
    assert ex.resolve("openai:qwen3:1.7b", {}) == ("openai", "qwen3:1.7b")
    assert ex.resolve("openclaw:fake/echo", {}) == ("openclaw", "fake/echo")
    assert ex.resolve("openclaw", {}) == ("openclaw", "")
    assert ex.resolve("", {"WORKBENCH_EVAL_MODEL": "z-ai/glm-x"}) == ("openai", "z-ai/glm-x")
    with pytest.raises(ex.ExecError) as e:
        ex.resolve("", {})
    assert any(f in str(e.value) for f in FATAL)


@pytest.mark.parametrize("code,kind", [(401, "fatal"), (403, "fatal"), (402, "fatal"), (400, "fatal"),
                                       (429, "transient"), (502, "transient"), (503, "transient")])
def test_provider_codes_classified_correctly_by_ext_forge(code, kind):
    msg = str(ex.http_error(code, "body"))
    fatal = any(f in msg for f in FATAL)
    assert fatal == (kind == "fatal")
    if kind == "transient":
        assert any(t.lower() in msg.lower() for t in TRANSIENT)


def test_reply_shaped_like_claude_p():
    out, code = ex.cli_output("ok", None, "openai/gpt-x", True)
    data = json.loads(out)
    assert code == 0 and data["is_error"] is False and data["result"] == "ok" and data["model"] == "openai/gpt-x"
    out, code = ex.cli_output("", "Invalid API key (HTTP 401)", "m", True)
    assert code == 1 and json.loads(out)["is_error"] is True
    assert ex.cli_output("ok", None, "m", False) == ("ok", 0)


def test_empty_model_reply_is_not_success():
    with pytest.raises(ex.ExecError):
        ex.openai_text({"choices": [{"message": {"content": "  "}}]})
    with pytest.raises(ex.ExecError):
        ex.openai_text({"error": "x"})
    assert ex.openai_text({"choices": [{"message": {"content": "yes"}}]}) == "yes"


def test_openclaw_agent_reply():
    stdout = json.dumps({"status": "ok", "result": {"payloads": [{"text": "✅ New session started.", "isStatusNotice": True}, {"text": "YES"}]}})
    assert ex.openclaw_text("[openclaw] noise\n" + stdout) == "YES"
    # --local returns payloads at the top level (OpenClaw 2026.10.10).
    assert ex.openclaw_text(json.dumps({"payloads": [{"text": "ok", "mediaUrl": None}], "meta": {}})) == "ok"
    with pytest.raises(ex.ExecError):
        ex.openclaw_text(json.dumps({"ok": False, "error": {"message": "Unknown agent id"}}))
    with pytest.raises(ex.ExecError):
        ex.openclaw_text("not json")


def test_full_stand_in_refuses_live_and_no_model(tmp_path):
    """End-to-end script call: tools and an empty model give fatal phrases, exit code 1, JSON."""
    shim = ROOT / "tools" / "eval-executor" / "claude"
    env = {"PATH": "/usr/bin:/bin", "HOME": str(tmp_path)}
    for args in (["-p", "--output-format", "json", "--allowedTools", "Bash"], ["-p", "--output-format", "json"]):
        r = subprocess.run([sys.executable, str(shim), *args], input="hello", capture_output=True, text=True, env=env)
        data = json.loads(r.stdout)
        assert r.returncode == 1 and data["is_error"] is True
        assert any(f in data["result"] for f in FATAL)
