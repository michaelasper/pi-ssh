#!/usr/bin/env python3
"""Check relative links and anchors in the repo markdown. Exits 1 on any miss."""
import re
import sys
import unicodedata
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent.parent
FILES = sorted(
    [ROOT / "README.md"]
    + list((ROOT / "docs").rglob("*.md"))
    + list((ROOT / ".pi/skills").rglob("*.md"))
)
LINK = re.compile(r"\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+\"[^\"]*\")?\)")
HEADING = re.compile(r"^#{1,6}\s+(.*?)\s*#*\s*$", re.MULTILINE)


def slug(text: str) -> str:
    text = re.sub(r"`([^`]*)`", r"\1", text).strip().lower()
    kept = "".join(c for c in text if unicodedata.category(c)[0] in "LMN" or c in " -_")
    return kept.replace(" ", "-")


def anchors(path: Path) -> set:
    seen = {}
    result = set()
    for heading in HEADING.findall(path.read_text(encoding="utf8")):
        base = slug(heading)
        count = seen.get(base, 0)
        seen[base] = count + 1
        result.add(base if count == 0 else f"{base}-{count}")
    return result


errors = []
checked = 0
for source in FILES:
    for lineno, line in enumerate(source.read_text(encoding="utf8").splitlines(), 1):
        for raw in LINK.findall(line):
            target = raw[1:-1] if raw.startswith("<") else raw
            if target.startswith(("http://", "https://", "mailto:")):
                continue
            checked += 1
            path_part, _, anchor = target.partition("#")
            dest = source if not path_part else (source.parent / unquote(path_part)).resolve()
            where = f"{source.relative_to(ROOT)}:{lineno}"
            if not dest.exists():
                errors.append(f"{where}: missing file {target}")
            elif anchor and dest.suffix == ".md" and unquote(anchor) not in anchors(dest):
                errors.append(f"{where}: missing anchor {target}")

for error in errors:
    print(error)
print(f"check-links: {checked} relative links checked, {len(errors)} broken")
sys.exit(1 if errors else 0)
