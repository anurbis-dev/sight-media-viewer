#!/usr/bin/env python3
"""Keep docs/RECENT.md short: move entries beyond the newest N into docs/archive/CHANGES-YYYY-MM.md.

Entries start with a heading `## <version> — <YYYY-MM-DD> — <title>` (newest first). Archived months
are append-only history: entries moved here go on top of that month's file (still newest first).

    python tools/archive_changes.py            # keep the newest 15
    python tools/archive_changes.py --keep 10
    python tools/archive_changes.py --dry-run
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "docs"
HEADING = re.compile(r"^## .+?—\s*(\d{4})-(\d{2})-\d{2}\s*—", re.M)


def split_entries(text: str) -> tuple[str, list[str]]:
    """Split into (preamble, entries). Headings inside ``` fences (format examples) are not entries."""
    lines = text.splitlines(keepends=True)
    starts, in_fence, pos = [], False, 0
    for line in lines:
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
        elif not in_fence and line.startswith("## "):
            starts.append(pos)
        pos += len(line)
    if not starts:
        return text, []
    bounds = starts + [len(text)]
    return text[: starts[0]], [text[bounds[i]:bounds[i + 1]].strip("\n") + "\n" for i in range(len(starts))]


def month_of(entry: str) -> str:
    m = HEADING.match(entry)
    return f"{m.group(1)}-{m.group(2)}" if m else "undated"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--keep", type=int, default=15, help="entries to keep in RECENT.md (default 15)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--docs", type=Path, default=DOCS, help="docs folder (default: ./docs of this repo)")
    args = ap.parse_args()
    recent, archive = args.docs / "RECENT.md", args.docs / "archive"

    head, entries = split_entries(recent.read_text(encoding="utf-8"))
    if len(entries) <= args.keep:
        print(f"{len(entries)} entries in RECENT.md (limit {args.keep}) - nothing to archive.")
        return 0
    keep, old = entries[: args.keep], entries[args.keep:]

    by_month: dict[str, list[str]] = {}
    for e in old:
        by_month.setdefault(month_of(e), []).append(e)

    for month, moved in by_month.items():
        path = archive / f"CHANGES-{month}.md"
        existing = ""
        if path.exists():
            _, prior = split_entries(path.read_text(encoding="utf-8"))
            existing = "\n".join(prior)
        header = f"# Archived changes — {month}\n\nOlder entries moved out of RECENT.md; newest first. Append-only history.\n\n"
        body = "\n".join(moved) + ("\n" + existing if existing else "")
        print(f"{'would move' if args.dry_run else 'moving'} {len(moved)} entr{'y' if len(moved) == 1 else 'ies'} -> {path}")
        if not args.dry_run:
            archive.mkdir(parents=True, exist_ok=True)
            path.write_text(header + body, encoding="utf-8", newline="\n")

    if not args.dry_run:
        recent.write_text(head + "\n".join(keep), encoding="utf-8", newline="\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
