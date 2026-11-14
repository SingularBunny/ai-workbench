#!/usr/bin/env python3
"""Part of tools/validate_in_docker.sh --live-model: the same scenario on a real model, without Claude.

Runs inside the container with the Gateway running and a real OPENROUTER_API_KEY. Each step is a chat turn sent
through the Gateway (chat.send, the Control UI's own call) and read back from chat.history; it prints a marker
LIVE_<STEP>=0 when the answer or its effect is there, 1 when not. Free models are slow and sometimes rate limited,
so a turn waits up to TURN_TIMEOUT, a failed step is tried three times a minute apart, and steps are spaced out.

  python3 live_model_check.py <judge model>
"""
import base64
import glob
import json
import os
import subprocess
import sys
import time
import uuid

TURN_TIMEOUT = 300
HOME = os.path.expanduser("~")


def gateway(method, params, timeout=60):
    r = subprocess.run(["openclaw", "gateway", "call", method, "--params", json.dumps(params), "--json"],
                       capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(f"{method}: {(r.stderr or r.stdout).strip()[-300:]}")
    return json.loads(r.stdout)


def text_of(message):
    content = message.get("content")
    if isinstance(content, str):
        return content
    return " ".join(p.get("text", "") for p in content or [] if isinstance(p, dict) and p.get("type") == "text")


LAST_TOOLS = []


def turn(session, message, attachments=None):
    """Send one message and wait for the run to finish; returns the last assistant text ('' if none). The turn's
    tool results go to LAST_TOOLS, for the detail of a failed step."""
    before = len(gateway("chat.history", {"sessionKey": session, "limit": 200}).get("messages", []))
    params = {"sessionKey": session, "message": message, "idempotencyKey": str(uuid.uuid4())}
    if attachments:
        params["attachments"] = attachments
    run = gateway("chat.send", params)
    try:
        gateway("agent.wait", {"runId": run["runId"], "timeoutMs": TURN_TIMEOUT * 1000}, timeout=TURN_TIMEOUT + 30)
    except Exception:
        # Older Gateways without agent.wait: poll the history until an assistant message arrives.
        deadline = time.time() + TURN_TIMEOUT
        while time.time() < deadline:
            time.sleep(5)
            messages = gateway("chat.history", {"sessionKey": session, "limit": 200}).get("messages", [])
            if any(m.get("role") == "assistant" and text_of(m).strip() for m in messages[before:]):
                break
    messages = gateway("chat.history", {"sessionKey": session, "limit": 200}).get("messages", [])[before:]
    answers = [text_of(m) for m in messages if m.get("role") == "assistant" and text_of(m).strip()]
    LAST_TOOLS[:] = [f"{m.get('toolName') or m.get('name') or 'tool'}: {text_of(m)[:200]}" for m in messages if m.get("role") in ("toolResult", "tool")]
    return answers[-1] if answers else ""


def check(name, attempt):
    """attempt() → (ok, detail); three tries a minute apart, since a free model may be rate limited for a minute."""
    ok, detail = False, ""
    for n in range(3):
        try:
            ok, detail = attempt(n)
        except Exception as error:
            ok, detail = False, f"error: {error}"
        if ok:
            break
        time.sleep(60)
    print(f"LIVE_{name}={0 if ok else 1} ({str(detail).replace(chr(10), ' ')[:300]})", flush=True)
    if not ok and LAST_TOOLS:
        print(f"  tools of the last try: {' | '.join(LAST_TOOLS)[:800]}".replace(chr(10), " "), flush=True)
    time.sleep(10)
    return ok


def session(name, n, agent="main"):
    return f"agent:{agent}:live-{name}-{n}"


def chat(n):
    answer = turn(session("chat", n), "Reply with exactly the word: pong")
    return "pong" in answer.lower(), answer


def knowledge(n):
    # A fact no model can know: found only through the knowledge base (memory search over WORKBENCH_KNOWLEDGE).
    os.makedirs(f"{HOME}/knowledge/greenhouse", exist_ok=True)
    with open(f"{HOME}/knowledge/greenhouse/heater.md", "w") as f:
        f.write("# Greenhouse heater\n\nThe greenhouse heater service code is HX-4471.\n")
    answer = turn(session("knowledge", n), "Search your knowledge base (memory search) for the greenhouse heater service code "
                  "and tell me the code.")
    return "hx-4471" in answer.lower(), answer


def memory_files():
    found = []
    for path in glob.glob(f"{HOME}/.openclaw/**/*.md", recursive=True):
        if "/knowledge-text/" in path:
            continue
        try:
            if "medlar" in open(path, encoding="utf-8", errors="ignore").read().lower():
                found.append(path)
        except OSError:
            pass
    return found


def memory_save(n):
    answer = turn(session("memory-a", n), "Please remember for later chats: my favourite tree is the medlar. Save it to your memory now.")
    found = memory_files()
    return bool(found), f"saved in {found}" if found else f"no memory file mentions it; answer: {answer}"


def memory_recall(n):
    answer = turn(session("memory-b", n), "What is my favourite tree? Check your memory before answering.")
    return "medlar" in answer.lower(), answer


def attachment(n):
    work = f"/tmp/live-attach-{n}"
    os.makedirs(work, exist_ok=True)
    with open(f"{work}/notes.txt", "w") as f:
        f.write("Garden notes.\nThe code word for the greenhouse is quince-42.\n")
    subprocess.run(["soffice", f"-env:UserInstallation=file://{work}/lo", "--headless", "--convert-to", "docx",
                    "--outdir", work, f"{work}/notes.txt"], capture_output=True, timeout=120)
    path = f"{work}/notes.docx"
    if not os.path.exists(path):
        return False, "LibreOffice did not make the docx"
    content = base64.b64encode(open(path, "rb").read()).decode()
    answer = turn(session("attach", n), "What is the code word for the greenhouse in the attached document?", [{
        "type": "file", "fileName": "notes.docx", "origin": "file", "content": content,
        "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}])
    return "quince-42" in answer.lower(), answer


def automations():
    r = subprocess.run(["openclaw", "automations", "list", "--all", "--json"], capture_output=True, text=True, timeout=60)
    data = json.loads(r.stdout or "{}")
    return data.get("automations", data.get("jobs", data if isinstance(data, list) else []))


def owner_turn(session_key, message):
    """A turn as the owner: the local `openclaw agent` asks for operator.admin, as the Control UI of the owner does;
    chat.send from `gateway call` gets least-privilege scopes, and owner-only tools (automations) refuse it."""
    r = subprocess.run(["openclaw", "agent", "--agent", session_key.split(":")[1], "--session-key", session_key,
                        "--message", message, "--json", "--timeout", str(TURN_TIMEOUT)],
                       capture_output=True, text=True, timeout=TURN_TIMEOUT + 60)
    try:
        data = json.loads(r.stdout)
        payloads = data.get("result", data).get("payloads") or []
        return " ".join(p.get("text", "") for p in payloads) or r.stdout[-300:]
    except (ValueError, AttributeError):
        return (r.stdout + r.stderr)[-300:]


def schedule(n):
    before = {a.get("id") for a in automations()}
    answer = owner_turn(session("schedule", n), "Create a scheduled task that runs every day at 09:00 and asks: "
                        "'Say good morning to the garden.' Name it live-check-garden.")
    new = [a for a in automations() if a.get("id") not in before]
    if not new:
        return False, f"no new automation; answer: {answer}"
    task = new[0]
    r = subprocess.run(["openclaw", "automations", "run", str(task["id"]), "--wait"], capture_output=True, text=True,
                       timeout=TURN_TIMEOUT + 60)
    return r.returncode == 0, f"{task.get('name')}: run exit {r.returncode} {(r.stdout + r.stderr).strip()[-200:]}"


def project(n):
    r = subprocess.run(["openclaw", "agents", "list", "--json"], capture_output=True, text=True, timeout=60)
    data = json.loads(r.stdout or "[]")
    agents = [a.get("id") for a in (data.get("agents", data) if isinstance(data, dict) else data) if a.get("id") != "main"]
    if not agents:
        return False, "no project agent"
    answer = turn(session("project", n, agents[0]), "Reply with exactly the word: pong")
    return "pong" in answer.lower(), f"{agents[0]}: {answer}"


def judge(judge_model):
    def attempt(n):
        with open("/tmp/live-ex.json", "w") as f:
            json.dump({"question": "How many legs does a spider have?", "answer": "A spider has eight legs.",
                       "answer_model": os.environ.get("WORKBENCH_DEFAULT_MODEL", "")}, f)
        # The judge uses a proxy only when told (WORKBENCH_JUDGE_PROXY), not from HTTPS_PROXY.
        env = {**os.environ, "WORKBENCH_JUDGE_MODEL": judge_model, "WORKBENCH_JUDGE_PROXY": os.environ.get("HTTPS_PROXY", "")}
        if judge_model.startswith("groq/"):
            env.update(WORKBENCH_JUDGE_MODEL=judge_model[len("groq/"):], WORKBENCH_JUDGE_BASE_URL="https://api.groq.com/openai/v1",
                       WORKBENCH_JUDGE_API_KEY=env.get("GROQ_API_KEY", ""),
                       # Groq's free tier caps output tokens per minute (1000 for qwen3.8-27b).
                       WORKBENCH_JUDGE_MAX_TOKENS=env.get("WORKBENCH_JUDGE_MAX_TOKENS", "900"))
        r = subprocess.run(["python3", f"{HOME}/plugins/aiwb-plugins/judge/skills/judge/scripts/judge.py", "--input",
                            "/tmp/live-ex.json"], capture_output=True, text=True, timeout=TURN_TIMEOUT, env=env)
        out = r.stdout + r.stderr
        return r.returncode == 0 and "NOT EVALUATED" not in out, out.strip()[-300:]
    return attempt


def main():
    judge_model = sys.argv[1]
    print(f"==== live model {os.environ.get('WORKBENCH_DEFAULT_MODEL')}, judge {judge_model}", flush=True)
    check("CHAT", chat)
    check("KNOWLEDGE", knowledge)
    check("MEMORY_SAVED", memory_save)
    check("MEMORY_RECALL", memory_recall)
    check("ATTACHMENT", attachment)
    check("SCHEDULE", schedule)
    check("PROJECT", project)
    check("JUDGE", judge(judge_model))


if __name__ == "__main__":
    main()
