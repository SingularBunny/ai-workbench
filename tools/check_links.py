"""Links in the public guides (README, CONTRIBUTING, docs/*.md) point to files that exist
in the repository: a guide that points nowhere is a breakage, not a nit."""

import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LINK = re.compile(r"\]\(<?([^)\s>]+)>?\)")


def main() -> int:
    tracked = set(subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True).stdout.split())
    docs = [p for p in tracked if p in ("README.md", "CONTRIBUTING.md") or (p.startswith("docs/") and p.endswith(".md"))]
    errors = []
    for doc in sorted(docs):
        for target in LINK.findall((ROOT / doc).read_text(encoding="utf-8")):
            if re.match(r"^[a-z]+:", target) or target.startswith("#"):
                continue
            rel = (Path(doc).parent / target.split("#")[0]).as_posix()
            # A link from a subfolder (../page.md) becomes a repo-root path without "..".
            norm = os.path.normpath(rel).replace("\\", "/")
            if norm not in tracked and not any(t.startswith(norm.rstrip("/") + "/") for t in tracked):
                errors.append(f"{doc}: link to {target} — no such file in the repository")
    print("\n".join(errors) or f"links checked in {len(docs)} files")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
