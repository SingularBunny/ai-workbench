import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("env_reference", Path(__file__).resolve().parents[1] / "tools" / "env_reference.py")
env_reference = importlib.util.module_from_spec(spec)
spec.loader.exec_module(env_reference)

EXAMPLE = """# Header, skipped.
# Still the header.

# ## Models
# Default model; empty means openrouter/auto.
WORKBENCH_DEFAULT_MODEL=
# Judge endpoint.
WORKBENCH_JUDGE_BASE_URL=
WORKBENCH_JUDGE_API_KEY=

# ## Network
# Proxy (docs/install/network.md).
# WORKBENCH_PROXY_URL — <url>, may hold credentials.
# WORKBENCH_PROXY_HOSTS — empty, * or all.
WORKBENCH_PROXY_URL=
WORKBENCH_PROXY_HOSTS=
"""


def test_groups_sections_and_keys_without_own_comment():
    groups = env_reference.parse(EXAMPLE)
    assert groups[0] == {"section": "Models"}
    assert groups[1]["keys"] == ["WORKBENCH_DEFAULT_MODEL"]
    # A key line right after another joins its group; the header block is not a group.
    assert groups[2]["keys"] == ["WORKBENCH_JUDGE_BASE_URL", "WORKBENCH_JUDGE_API_KEY"]
    assert groups[3] == {"section": "Network"}
    assert groups[4]["keys"] == ["WORKBENCH_PROXY_URL", "WORKBENCH_PROXY_HOSTS"]


def test_render_escapes_markup_and_links_docs():
    page = env_reference.render(env_reference.parse(EXAMPLE))
    assert "### `WORKBENCH_PROXY_URL`, `WORKBENCH_PROXY_HOSTS`" in page
    assert "[install/network.md](../install/network.md)" in page
    assert "- `WORKBENCH_PROXY_URL` — &lt;url&gt;, may hold credentials." in page
    assert r"empty, \* or all." in page
    assert "Header" not in page


def test_key_read_by_code_but_undescribed_is_reported():
    groups = env_reference.parse(EXAMPLE)
    used = {"WORKBENCH_DEFAULT_MODEL", "WORKBENCH_NEW_SETTING", "WORKBENCH_PATH_HINT", "WORKBENCH_OPENCLAW_SRC"}
    assert [p.split(":")[0] for p in env_reference.problems(groups, used)] == ["WORKBENCH_NEW_SETTING"]


def test_repository_page_is_current():
    assert env_reference.main(["--check"]) == 0
