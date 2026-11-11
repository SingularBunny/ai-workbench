"""Builds docs/reference/env.md, the reference of ~/.openclaw/.env keys, from .env.example, and checks that
every WORKBENCH_* key the installer, migrations and tools read is described there.

  python3 tools/env_reference.py          # write docs/reference/env.md
  python3 tools/env_reference.py --check  # exit 1 if the page is stale or a key is undescribed

.env.example format: a block of "# " comment lines followed by one or more KEY= lines describes those keys;
"# ## Title" starts a section; the header block before the first blank line is skipped. A comment line that
starts with a key name ("# KEY — ...") starts a list item."""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = ROOT / ".env.example"
PAGE = ROOT / "docs" / "reference" / "env.md"
KEY = re.compile(r"^([A-Z][A-Z0-9_]*)=(.*)$")
NAME = re.compile(r"\b[A-Z][A-Z0-9]*_[A-Z0-9_]*(?:[A-Z0-9]\b(?:=[^\s,;)]*[^\s,;).])?|_\*)")
DOC_PATH = re.compile(r"\bdocs/([\w/-]+\.md)\b")

# WORKBENCH_* names in the code that are not settings of ~/.openclaw/.env.
NOT_SETTINGS = {
    "WORKBENCH_PATH_HINT": "passed from install.sh to setup.mjs",
    "WORKBENCH_TASKS_ALLOW": "environment of the scheduled-tasks MCP server, written by the installer",
    "WORKBENCH_TASKS_TZ": "environment of the scheduled-tasks MCP server, written by the installer",
    "WORKBENCH_TASKS_AGENT": "environment of the scheduled-tasks MCP server, written by the installer",
    "WORKBENCH_OPENCLAW_PATCHES": "old name of WORKBENCH_FORK_PRESETS, still read",
}
# Variables of single commands, set in the shell when running them.
COMMAND_VARS = {
    "WORKBENCH_OPENCLAW_SRC": "`tools/openclaw-fork-build.sh`: the fork checkout, when not given as the first argument.",
    "WORKBENCH_EVAL_AGENT": "`tools/eval-executor/claude`: the OpenClaw agent that answers eval scenarios; default `main`.",
}


def parse(text: str) -> list[dict]:
    """Groups of the example: {"section": str} or {"keys": [...], "lines": [comment lines]}."""
    out, comments, group = [], [], None
    body = text.split("\n\n", 1)[1] if "\n\n" in text else ""
    for line in body.splitlines():
        if line.startswith("# ## "):
            out.append({"section": line[5:].strip()})
            comments, group = [], None
        elif line.startswith("#"):
            group = None
            comments.append(line[1:].strip())
        elif m := KEY.match(line):
            if group is None:
                group = {"keys": [], "lines": comments}
                out.append(group)
                comments = []
            group["keys"].append(m.group(1))
        else:
            comments, group = [], None
    return out


def inline(text: str) -> str:
    """Markdown for a comment fragment: names and paths in code spans, <, > and * escaped outside them."""
    parts = re.split(r"(`[^`]*`)", text)
    for i, part in enumerate(parts):
        if i % 2:
            continue
        # Names first: a code span keeps its text as is, the rest is escaped.
        pieces = re.split(f"({NAME.pattern})", part)
        for j, piece in enumerate(pieces):
            if j % 2:
                pieces[j] = f"`{piece}`"
            else:
                piece = piece.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("*", r"\*")
                pieces[j] = DOC_PATH.sub(lambda m: f"[{m.group(1)}](../{m.group(1)})", piece)
        parts[i] = "".join(pieces)
    return "".join(parts)


def describe(lines: list[str], keys: list[str]) -> str:
    paras, items = [], []
    for line in lines:
        head = line.split(" ", 1)[0]
        if head in keys and len(keys) > 1:
            items.append(line)
        elif items:
            items[-1] += " " + line
        else:
            paras.append(line)
    out = inline(" ".join(paras)) if paras else ""
    if items:
        out += ("\n\n" if out else "") + "\n".join(f"- {inline(i)}" for i in items)
    return out


def render(groups: list[dict]) -> str:
    out = [
        "# Settings reference",
        "",
        "Keys of `~/.openclaw/.env`, the file OpenClaw and the installer read. Set a key there and run the installer",
        "again; OpenClaw reads its own keys (model API keys, the Gateway token) when the Gateway starts. Empty or",
        "missing means the default described here. Generated from `.env.example` by `tools/env_reference.py`.",
    ]
    for g in groups:
        if "section" in g:
            out += ["", f"## {g['section']}"]
            continue
        out += ["", "### " + ", ".join(f"`{k}`" for k in g["keys"])]
        text = describe(g["lines"], g["keys"])
        if text:
            out += ["", text]
    out += ["", "## Variables of single commands", "", "Set in the shell for one command, not in `.env`.", ""]
    out += [f"- `{k}` — {v}" for k, v in COMMAND_VARS.items()]
    return "\n".join(out) + "\n"


def code_keys() -> set[str]:
    files = subprocess.run(["git", "ls-files", "installer", "migrate", "tools", "openclaw"], cwd=ROOT,
                           capture_output=True, text=True).stdout.split()
    keys = set()
    for f in files:
        if "/test/" in f or f.startswith("tools/env_reference"):
            continue
        p = ROOT / f
        if p.is_file():
            keys |= set(re.findall(r"\bWORKBENCH_[A-Z0-9_]*[A-Z0-9]\b", p.read_text(encoding="utf-8", errors="ignore")))
    return keys


def problems(groups: list[dict], used: set[str]) -> list[str]:
    described = {k for g in groups for k in g.get("keys", [])}
    return [f"{k}: read by the code, but not in .env.example (describe it there or list it in tools/env_reference.py)"
            for k in sorted(used - described - set(NOT_SETTINGS) - set(COMMAND_VARS))]


def main(argv: list[str]) -> int:
    groups = parse(EXAMPLE.read_text(encoding="utf-8"))
    page = render(groups)
    errors = problems(groups, code_keys())
    if "--check" in argv:
        if not PAGE.exists() or PAGE.read_text(encoding="utf-8") != page:
            errors.append(f"{PAGE.relative_to(ROOT)} is stale: run python3 tools/env_reference.py")
        print("\n".join(errors) or f"settings reference is up to date ({sum('keys' in g for g in groups)} entries)")
        return 1 if errors else 0
    PAGE.write_text(page, encoding="utf-8")
    print("\n".join(errors) or f"wrote {PAGE.relative_to(ROOT)}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
