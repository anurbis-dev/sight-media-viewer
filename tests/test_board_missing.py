"""Board cards keep a name / path snapshot of their asset (board_items.asset_name / asset_path), so a card whose
file is gone (source removed) can still say which file it was.

    python -m unittest tests.test_board_missing
"""
from __future__ import annotations

import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path

from app.library import Library


def add_asset(lib: Library, aid: str, path: str) -> None:
    lib.execute(
        "INSERT INTO assets(id, source_id, path, name, ext, kind, size, mtime, added_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (aid, "src", path, Path(path).name, ".png", "image", 10, 1.0, 1),
    )


class BoardMissingTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="sight-board-missing-"))
        self.home = self.tmp / "home"
        self.lib = Library(self.home)
        self.board = self.lib.add_board("A")["id"]

    def tearDown(self) -> None:
        self.lib.conn.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_snapshot_on_create_survives_asset_delete(self) -> None:
        add_asset(self.lib, "a1", "/pics/cat.png")
        item = self.lib.add_board_item(self.board, {"asset_id": "a1"})
        self.assertEqual((item["asset_name"], item["asset_path"]), ("cat.png", "/pics/cat.png"))
        self.lib.execute("DELETE FROM assets WHERE id='a1'")
        full = self.lib.board_full(self.board)["items"]
        self.assertEqual((full[0]["asset_name"], full[0]["asset_path"]), ("cat.png", "/pics/cat.png"))

    def test_create_for_unknown_asset_uses_body_fallback_or_none(self) -> None:
        item = self.lib.add_board_item(self.board, {"asset_id": "nope"})
        self.assertIsNone(item["asset_name"])
        copy = self.lib.add_board_item(self.board, {"asset_id": "nope", "asset_name": "x.png", "asset_path": "/a/x.png"})
        self.assertEqual((copy["asset_name"], copy["asset_path"]), ("x.png", "/a/x.png"))

    def test_snapshot_is_not_patchable(self) -> None:
        add_asset(self.lib, "a1", "/pics/cat.png")
        item = self.lib.add_board_item(self.board, {"asset_id": "a1"})
        out = self.lib.update_board_item(item["id"], {"asset_name": "hacked", "x": 5})
        self.assertEqual(out["asset_name"], "cat.png")
        self.assertEqual(out["x"], 5)

    def test_migration_adds_columns_and_backfills(self) -> None:
        add_asset(self.lib, "a1", "/pics/cat.png")
        item = self.lib.add_board_item(self.board, {"asset_id": "a1"})
        add_asset(self.lib, "a2", "/pics/dog.png")
        gone = self.lib.add_board_item(self.board, {"asset_id": "a2"})
        self.lib.execute("DELETE FROM assets WHERE id='a2'")
        self.lib.conn.close()
        # Back to the pre-0.64 schema: no snapshot columns.
        con = sqlite3.connect(str(next(self.home.rglob("*.db"))))
        con.execute("ALTER TABLE board_items DROP COLUMN asset_name")
        con.execute("ALTER TABLE board_items DROP COLUMN asset_path")
        con.commit()
        con.close()
        self.lib = Library(self.home)
        rows = {r["id"]: r for r in self.lib.board_full(self.board)["items"]}
        self.assertEqual((rows[item["id"]]["asset_name"], rows[item["id"]]["asset_path"]), ("cat.png", "/pics/cat.png"))
        self.assertIsNone(rows[gone["id"]]["asset_name"])  # nothing left to copy from
        Library(self.home).conn.close()  # reopening again is a no-op

    def test_move_rewrites_item_asset_and_snapshot(self) -> None:
        add_asset(self.lib, "old", "/pics/cat.png")
        item = self.lib.add_board_item(self.board, {"asset_id": "old"})
        self.lib.execute("UPDATE assets SET status='missing' WHERE id='old'")
        add_asset(self.lib, "new", "/other/cat.png")
        self.lib._migrate_asset("old", "new")
        got = self.lib.board_full(self.board)["items"][0]
        self.assertEqual(got["id"], item["id"])
        self.assertEqual((got["asset_id"], got["asset_name"], got["asset_path"]), ("new", "cat.png", "/other/cat.png"))
        self.assertGreater(got["revision"], item["revision"])


if __name__ == "__main__":
    unittest.main()
