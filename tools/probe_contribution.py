#!/usr/bin/env python3
"""How alive the candidate projects are: stars, active contributors, release pace.

Which of the compared platforms are maintained and developed, and whether a project
rests on a single person.

Sources:
- GitHub REST without a token (60 requests per hour): stars, forks, open issues+PRs,
  total contributors (from the Link header), releases within the window;
- `git log` of the default branch from a blobless clone (`--bare --filter=blob:none --shallow-since`):
  commits and authors over 30 and 90 days. Bots are dropped, authors are merged by e-mail.

The index is a weighted mean of each metric's share of the best candidate, on a log scale
(otherwise one project's stars dominate). The weights are the script author's choice, not a standard:
see WEIGHTS. Usage: `python3 tools/probe_contribution.py [--json out.json]`.
"""
from __future__ import annotations

import argparse
import datetime as dt
import http.client
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

REPOS = [
    "openclaw/openclaw",
    "NousResearch/hermes-agent",
    "aaif-goose/goose",
    "CherryHQ/cherry-studio",
    "open-webui/open-webui",
    "iOfficeAI/AionUi",
    "eigent-ai/eigent",
    "warpdotdev/warp",
    "openclaw/acpx",
]
WINDOW_DAYS = 90
WEIGHTS = {
    "authors_90d": 0.30,   # who actually writes code now
    "commits_90d": 0.15,
    "releases_90d": 0.15,
    "stars": 0.15,         # popularity, not maintenance
    "bus_factor": 0.25,    # how many authors produce half of the commits
}
BOT = re.compile(r"\[bot\]|bot@|^noreply@github\.com$|^(dependabot|renovate|github-actions)|roboclaw", re.I)
# The environment proxy is not used: only an explicitly set one.
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
NO_PROXY_ENV = {k: v for k, v in os.environ.items() if k.lower() not in ("http_proxy", "https_proxy", "all_proxy")}


def api(path: str, want_headers: bool = False):
    req = urllib.request.Request(f"https://api.github.com/{path}",
                                 headers={"Accept": "application/vnd.github+json", "User-Agent": "probe"})
    for attempt in range(4):         # TLS drops: retry with a pause; 404/403 are not retried
        try:
            with OPENER.open(req, timeout=30) as r:
                body = json.load(r)
                return (body, dict(r.headers)) if want_headers else body
        except urllib.error.HTTPError:
            raise
        except (OSError, http.client.HTTPException):  # URLError, ssl.SSLError, IncompleteRead
            if attempt == 3:
                raise
            time.sleep(5 * (attempt + 1))


def total_contributors(repo: str) -> int | None:
    body, headers = api(f"repos/{repo}/contributors?per_page=1&anon=true", want_headers=True)
    m = re.search(r'[?&]page=(\d+)>; rel="last"', headers.get("Link", ""))
    return int(m.group(1)) if m else len(body)


def releases_since(repo: str, since: dt.datetime) -> tuple[int, str | None]:
    rel = api(f"repos/{repo}/releases?per_page=100")
    dates = [dt.datetime.fromisoformat(r["published_at"].replace("Z", "+00:00"))
             for r in rel if r.get("published_at") and not r.get("draft")]
    latest = max(dates).date().isoformat() if dates else None
    return sum(d >= since for d in dates), latest


def git_activity(repo: str, since: dt.datetime, workdir: Path) -> dict:
    dst = workdir / repo.replace("/", "__")
    for attempt in range(3):         # TLS drops happen on large repositories
        subprocess.run(["rm", "-rf", str(dst)], check=True)
        done = subprocess.run(["git", "clone", "-q", "--bare", "--filter=blob:none",
                               f"--shallow-since={since.date().isoformat()}",
                               f"https://github.com/{repo}.git", str(dst)], env=NO_PROXY_ENV).returncode == 0
        if done:
            break
    else:
        raise RuntimeError(f"git clone {repo}: three attempts failed")
    out = subprocess.run(["git", "-C", str(dst), "log", "HEAD", "--no-merges",
                          f"--since={since.isoformat()}", "--format=%H%x09%aI%x09%ae%x09%an"],
                         check=True, capture_output=True, text=True).stdout
    now = dt.datetime.now(dt.timezone.utc)
    c90, c30 = Counter(), Counter()
    seen, names = set(), {}
    for line in out.splitlines():
        sha, when, email, name = line.split("\t", 3)
        if sha in seen or BOT.search(email) or BOT.search(name):
            continue
        seen.add(sha)
        key = email.lower()
        names[key] = name
        c90[key] += 1
        if now - dt.datetime.fromisoformat(when) <= dt.timedelta(days=30):
            c30[key] += 1
    total = sum(c90.values())
    acc, bus = 0, 0
    for _, n in c90.most_common():
        acc += n
        bus += 1
        if acc * 2 >= total:
            break
    top_share = c90.most_common(1)[0][1] / total if total else 0.0
    return {"commits_90d": total, "authors_90d": len(c90), "authors_30d": len(c30),
            "commits_30d": sum(c30.values()), "bus_factor": bus if total else 0,
            "top_author_share": round(top_share, 3),
            "top_authors": [f"{names[k]} {n / total:.0%}" for k, n in c90.most_common(3)] if total else []}


def index(rows: list[dict]) -> None:
    for metric, w in WEIGHTS.items():
        best = max(math.log1p(r[metric] or 0) for r in rows) or 1.0
        for r in rows:
            r.setdefault("_score", 0.0)
            r["_score"] += w * math.log1p(r[metric] or 0) / best
    for r in rows:
        r["index"] = round(100 * r.pop("_score"), 1)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", type=Path)
    ap.add_argument("--cache", type=Path, help="folder for finished rows: a rerun does not spend the API limit")
    args = ap.parse_args()
    now = dt.datetime.now(dt.timezone.utc)
    since = now - dt.timedelta(days=WINDOW_DAYS)
    rows = []
    with tempfile.TemporaryDirectory() as tmp:
        for repo in REPOS:
            cached = args.cache / f"{repo.replace('/', '__')}.json" if args.cache else None
            if cached and cached.exists():
                rows.append(json.loads(cached.read_text()))
                print(f"{repo}: from cache", file=sys.stderr)
                continue
            info = api(f"repos/{repo}")
            rel90, latest = releases_since(repo, since)
            row = {"repo": info["full_name"], "stars": info["stargazers_count"],
                   "forks": info["forks_count"], "open_issues_and_prs": info["open_issues_count"],
                   "license": (info.get("license") or {}).get("spdx_id"),
                   "created": info["created_at"][:10], "pushed": info["pushed_at"][:10],
                   "archived": info["archived"], "contributors_total": total_contributors(repo),
                   "releases_90d": rel90, "latest_release": latest}
            row.update(git_activity(info["full_name"], since, Path(tmp)))
            rows.append(row)
            if cached:
                cached.parent.mkdir(parents=True, exist_ok=True)
                cached.write_text(json.dumps(row, ensure_ascii=False))
            print(f"{repo}: ok", file=sys.stderr)
    index(rows)
    rows.sort(key=lambda r: -r["index"])
    result = {"measured_at": now.isoformat(timespec="seconds"), "window_days": WINDOW_DAYS,
              "weights": WEIGHTS, "rows": rows}
    if args.json:
        args.json.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    cols = ["repo", "index", "stars", "contributors_total", "authors_90d", "authors_30d",
            "commits_90d", "bus_factor", "top_author_share", "releases_90d", "latest_release", "pushed"]
    print("\t".join(cols))
    for r in rows:
        print("\t".join(str(r[c]) for c in cols))
    return 0


if __name__ == "__main__":
    sys.exit(main())
