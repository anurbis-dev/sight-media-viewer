"""Merge parity: Library.import_annotations (Python, the reference) and review-core.js mergeRows
(JS: the HTML page and the mobile app) must give the same rows on the same fixtures.

    python -m unittest tests.test_merge_parity        (needs `node` on PATH; skipped without it)

Fixtures: tests/fixtures/merge_cases.json (made by tests/fixtures/make_merge_cases.py). Each case
has the rows one side holds (deleted ones carry deleted_at), an incoming package's rows and
tombstones, a screenshot id map and the merge clock `now`.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app import review  # noqa: E402
from app.library import Library  # noqa: E402

FIXTURES = ROOT / "tests" / "fixtures" / "merge_cases.json"
TARGET = "0123456789abcdef"
FIELDS = ("kind", "shape_kind", "x", "y", "w", "h", "rotation", "z_index", "color", "locked", "data",
          "created_at", "updated_at", "deleted_at")


def py_merge(lib: Library, case: dict) -> tuple[dict, dict]:
    lib.conn.execute("DELETE FROM annotations")
    for r in case["local"]:
        lib.conn.execute(
            "INSERT INTO annotations(id, kind, shape_kind, scope, target_asset_id, x, y, w, h, rotation, "
            "z_index, color, data, locked, created_at, updated_at, revision, deleted_at) "
            "VALUES (?,?,?,'asset',?,?,?,?,?,?,?,?,?,?,?,?,1,?)",
            (r["id"], r["kind"], r.get("shape_kind"), TARGET, r.get("x"), r.get("y"), r.get("w"), r.get("h"),
             r.get("rotation") or 0, r.get("z_index") or 0, r.get("color"), json.dumps(r.get("data") or {}),
             1 if r.get("locked") else 0, r["created_at"], r["updated_at"], r.get("deleted_at")),
        )
    lib.conn.commit()
    with mock.patch.object(time, "time", return_value=case["now"] / 1000):
        stats = lib.import_annotations(TARGET, json.loads(json.dumps(case["incoming"])),
                                       case["deleted"], case["shot_map"])
    rows = {}
    for r in lib.query("SELECT * FROM annotations WHERE target_asset_id=?", (TARGET,)):
        d = dict(r)
        d["data"] = json.loads(d["data"])
        rows[d["id"]] = {k: d[k] for k in FIELDS}
    return stats, rows


def js_merge() -> list[dict]:
    node = shutil.which("node")
    if not node:
        raise unittest.SkipTest("node is not installed")
    out = subprocess.run([node, str(ROOT / "tests" / "merge_js.cjs"), str(FIXTURES)],
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


class MergeParity(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.mkdtemp(prefix="sight-merge-")
        cls.lib = Library(Path(cls.tmp))
        cls.cases = json.loads(FIXTURES.read_text(encoding="utf-8"))
        cls.js = {c["name"]: c for c in js_merge()}

    @classmethod
    def tearDownClass(cls) -> None:
        cls.lib.conn.close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_cases(self) -> None:
        self.assertGreaterEqual(len(self.cases), 10)
        for case in self.cases:
            with self.subTest(case=case["name"]):
                stats, rows = py_merge(self.lib, case)
                js = self.js[case["name"]]
                self.assertTrue(js["untouched"], "mergeRows changed its inputs")
                self.assertEqual(js["stats"], stats)
                js_rows = {r["id"]: {k: r.get(k) for k in FIELDS} for r in js["rows"]}
                self.assertEqual(sorted(js_rows), sorted(rows))
                for rid, want in rows.items():
                    self.assertEqual(js_rows[rid], want, f"row {rid}")

    def test_expected_outcomes(self) -> None:
        """A few results spelled out, so a bug made on both sides at once still shows."""
        by = {c["name"]: c for c in self.cases}
        _, rows = py_merge(self.lib, by["stale text loses, new reply and state win"])
        d = next(iter(rows.values()))["data"]
        self.assertEqual(d["text"], "Edited in Sight")
        self.assertEqual(d["status"], "done")
        self.assertEqual([r["id"] for r in d["replies"]], ["00000000000000a7", "00000000000000aa"])
        stats, rows = py_merge(self.lib, by["tombstones"])
        self.assertEqual(stats["deleted"], 2)  # the note and the stroke; the rect and N2 were edited later
        stats, _ = py_merge(self.lib, by["identical import is unchanged"])
        self.assertEqual(stats, {"added": 0, "updated": 0, "deleted": 0, "unchanged": 2})
        stats, rows = py_merge(self.lib, by["new rows are added"])
        self.assertEqual(stats["added"], 3)
        self.assertEqual(rows["00000000000000a4"]["data"]["reply"], "00000000000000a7")


class PageInlinesCore(unittest.TestCase):
    def test_core_is_inlined(self) -> None:
        page = review.build_html({"title": "T %%DATA%% %%CORE%% %%DRAW%%", "notes": [{"text": "%%CORE%% %%DRAW%%"}]},
                                 {"format": "sight-review", "version": 1, "asset": {}, "annotations": []})
        self.assertIn("var SightReviewCore", page)
        self.assertEqual(page.count("var SightReviewCore"), 1)  # placeholders in user text stay text
        self.assertEqual(page.count("var SightReviewDraw"), 1)  # the drawing canvas (review-draw.js)
        self.assertIn("T %%DATA%% %%CORE%% %%DRAW%%", page)


if __name__ == "__main__":
    unittest.main()
