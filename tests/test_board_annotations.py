"""Board annotations (scope='board'): Library.annotations_for_board, the GET /api/annotations filter,
board_full and the soft delete with the board.

    python -m unittest tests.test_board_annotations

(No HTTP client here: the runtime has no httpx for Starlette's TestClient, so the route function is
looked up on the app and called directly.)
"""
from __future__ import annotations

import asyncio
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from starlette.exceptions import HTTPException
from starlette.requests import Request

from app.library import Library
from app.server import build_app


def row(rid: str, **kw) -> dict:
    body = {"id": rid, "kind": "shape", "shape_kind": "rect", "z_index": 0, "data": {"x": 1, "y": 2, "w": 3, "h": 4}}
    body.update(kw)
    return body


class BoardAnnotationsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="sight-board-anno-"))
        self.lib = Library(self.tmp / "home")
        self.board = self.lib.add_board("A")["id"]
        self.other = self.lib.add_board("B")["id"]

    def tearDown(self) -> None:
        self.lib.conn.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get(self, query: str) -> tuple[int, object]:
        """GET /api/annotations?<query> through the route's own endpoint (no HTTP client needed)."""
        app = build_app(self.lib)
        for r in app.routes:
            if getattr(r, "path", "") == "/api/annotations" and "GET" in (getattr(r, "methods", None) or ()):
                scope = {"type": "http", "method": "GET", "path": "/api/annotations", "path_params": {},
                         "query_string": query.encode(), "headers": []}
                try:
                    res = asyncio.run(r.endpoint(Request(scope)))
                except HTTPException as e:  # the app's exception handler turns this into the status
                    return e.status_code, None
                return res.status_code, json.loads(res.body)
        self.fail("GET /api/annotations not found")

    def test_for_board_filters_scope_board_and_orders_by_z(self) -> None:
        self.lib.add_annotation(row("a" * 16, scope="board", board_id=self.board, z_index=2))
        self.lib.add_annotation(row("b" * 16, scope="board", board_id=self.board, z_index=1,
                                    kind="note", shape_kind=None, data={"text": "hi", "status": "open"}))
        self.lib.add_annotation(row("c" * 16, scope="board", board_id=self.other))
        self.lib.add_annotation(row("d" * 16, scope="asset", target_asset_id="0" * 16))
        got = self.lib.annotations_for_board(self.board)
        self.assertEqual([a["id"] for a in got], ["b" * 16, "a" * 16])
        self.assertTrue(all(a["scope"] == "board" and a["board_id"] == self.board for a in got))
        self.assertEqual(got[0]["data"]["text"], "hi")
        self.assertEqual(self.lib.annotations_for_board("nope"), [])

    def test_deleted_rows_are_left_out_and_revive_under_the_same_id(self) -> None:
        rid = "e" * 16
        self.lib.add_annotation(row(rid, scope="board", board_id=self.board))
        self.lib.delete_annotation(rid)
        self.assertEqual(self.lib.annotations_for_board(self.board), [])
        self.lib.add_annotation(row(rid, scope="board", board_id=self.board))  # undo of a delete
        self.assertEqual([a["id"] for a in self.lib.annotations_for_board(self.board)], [rid])

    def test_route_filter(self) -> None:
        self.lib.add_annotation(row("a" * 16, scope="board", board_id=self.board))
        self.lib.add_annotation(row("b" * 16, scope="board", board_id=self.other))
        code, got = self.get(f"board_id={self.board}")
        self.assertEqual((code, [a["id"] for a in got]), (200, ["a" * 16]))
        self.assertEqual(self.get("asset_id=" + "0" * 16), (200, []))
        self.assertEqual(self.get("")[0], 400)

    def test_board_full_and_board_delete(self) -> None:
        self.lib.add_annotation(row("a" * 16, scope="board", board_id=self.board))
        full = self.lib.board_full(self.board)
        self.assertEqual([a["id"] for a in full["annotations"]], ["a" * 16])
        self.lib.delete_board(self.board)
        self.assertEqual(self.lib.annotations_for_board(self.board), [])


if __name__ == "__main__":
    unittest.main()
