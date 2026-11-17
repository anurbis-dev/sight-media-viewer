"""The .srev bundle (several packages in one file; docs/FORMAT.md "Bundle"): parse_review_file,
import_review_file (POST /api/review/import) and POST /api/review/export/package-all.

    python -m unittest tests.test_review_bundle

(No HTTP client: the runtime has no httpx for Starlette's TestClient, so routes are called directly.)
"""
from __future__ import annotations

import asyncio
import json
import shutil
import tempfile
import time
import unittest
from pathlib import Path

from starlette.exceptions import HTTPException
from starlette.requests import Request

from app import review
from app.library import Library
from app.server import build_app


def add_asset(lib: Library, aid: str, name: str, size: int = 10) -> dict:
    lib.execute(
        "INSERT INTO assets(id, source_id, path, name, ext, kind, size, mtime, added_at, status) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (aid, "src", f"/clips/{name}", name, ".mp4", "video", size, 1.0, 1, "ready"),
    )
    return lib.get_asset(aid)


def note(rid: str, text: str, at: int = 1_790_000_000_000) -> dict:
    return {"id": rid, "kind": "note", "shape_kind": None, "x": None, "y": None, "w": None, "h": None,
            "rotation": 0, "z_index": 0, "color": None, "locked": 0, "created_at": at, "updated_at": at,
            "data": {"text": text, "author": "Ann", "created": at, "status": "open", "replies": []}}


def package(asset: dict, rows: list, **kw) -> dict:
    pkg = review.build_package(asset, [], Path("/nonexistent"), "Ann", "test")
    pkg["annotations"] = rows
    pkg.update(kw)
    return pkg


def raw(obj) -> bytes:
    return json.dumps(obj).encode("utf-8")


class ParseTest(unittest.TestCase):
    A = {"id": "a" * 16, "name": "a.mp4", "size": 1, "kind": "video"}

    def test_plain_package(self):
        head, entries = review.parse_review_file(raw(package(self.A, [])))
        self.assertIsNone(head)
        self.assertEqual(entries[0]["asset"]["name"], "a.mp4")

    def test_plain_package_errors_unchanged(self):
        for body, msg in ((b"nope", "Not a Sight review file"), (raw({"format": "x"}), "Not a Sight review file"),
                          (raw({**package(self.A, []), "version": 2}), "newer Sight"),
                          (raw({"format": "sight-review", "version": 1}), "incomplete")):
            with self.assertRaisesRegex(ValueError, msg):
                review.parse_review_file(body)
            with self.assertRaisesRegex(ValueError, msg):
                review.parse_package(body)

    def test_bundle(self):
        b = review.build_bundle([package(self.A, []), package({**self.A, "name": "b.mp4"}, [])], "Ann", "test", "T")
        head, entries = review.parse_review_file(raw(b))
        self.assertEqual((head["format"], head["title"], head["id"]), ("sight-review-bundle", "T", b["id"]))
        self.assertNotIn("packages", head)
        self.assertEqual([e["asset"]["name"] for e in entries], ["a.mp4", "b.mp4"])
        # A bundle is not a package: older readers reject it as before.
        with self.assertRaisesRegex(ValueError, "Not a Sight review file"):
            review.parse_package(raw(b))

    def test_bundle_errors(self):
        b = review.build_bundle([], "Ann", "test")
        with self.assertRaisesRegex(ValueError, "no clips"):
            review.parse_review_file(raw(b))
        with self.assertRaisesRegex(ValueError, "newer Sight"):
            review.parse_review_file(raw({**b, "version": 2, "packages": [package(self.A, [])]}))
        with self.assertRaisesRegex(ValueError, "incomplete"):
            review.parse_review_file(raw({**b, "packages": None}))

    def test_one_damaged_inner_package(self):
        b = review.build_bundle([package(self.A, []), {"format": "sight-review", "version": 1}, "junk",
                                 {**package(self.A, []), "version": 9}], "Ann", "test")
        _, entries = review.parse_review_file(raw(b))
        self.assertIsInstance(entries[0], dict)
        self.assertIn("incomplete", str(entries[1]))
        self.assertIn("Not a Sight review file", str(entries[2]))
        self.assertIn("newer Sight", str(entries[3]))


class ImportExportTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="sight-bundle-"))
        self.lib = Library(self.tmp / "home")
        self.a = add_asset(self.lib, "1" * 16, "a.mp4")
        self.b = add_asset(self.lib, "2" * 16, "b.mp4")
        self.c = add_asset(self.lib, "3" * 16, "c.mp4")

    def tearDown(self) -> None:
        self.lib.conn.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def route(self, path: str, body: bytes) -> tuple[int, object]:
        app = build_app(self.lib)
        for r in app.routes:
            if getattr(r, "path", "") == path and "POST" in (getattr(r, "methods", None) or ()):
                scope = {"type": "http", "method": "POST", "path": path, "path_params": {}, "query_string": b"",
                         "headers": [(b"content-type", b"application/json")]}
                sent = False

                async def receive():
                    nonlocal sent
                    if sent:
                        return {"type": "http.disconnect"}
                    sent = True
                    return {"type": "http.request", "body": body, "more_body": False}
                try:
                    res = asyncio.run(r.endpoint(Request(scope, receive)))
                except HTTPException as e:
                    return e.status_code, e.detail
                if isinstance(res, dict):
                    return 200, res
                return res.status_code, json.loads(res.body)
        self.fail(f"POST {path} not found")

    def test_plain_package_response_unchanged(self):
        st, res = self.route("/api/review/import", raw(package(self.a, [note("a1" * 8, "hi")])))
        self.assertEqual(st, 200)
        self.assertEqual(res, {"ok": True, "asset_id": self.a["id"], "added": 1, "updated": 0, "deleted": 0, "unchanged": 0,
                               "author": "Ann"})
        gone = {**self.a, "id": "9" * 16, "name": "gone.mp4"}
        st, res = self.route("/api/review/import", raw(package(gone, [])))
        self.assertEqual((st, res["ok"], res["missing"]), (404, False, "gone.mp4"))
        st, detail = self.route("/api/review/import", b"{}")
        self.assertEqual((st, detail), (400, "Not a Sight review file"))
        bad = package(self.a, [{"id": "b1" * 8, "kind": "note", "shape_kind": {"x": 1}, "data": {}}])
        st, detail = self.route("/api/review/import", raw(bad))
        self.assertEqual(st, 400)
        self.assertIn("damaged", detail)

    def test_bundle_with_missing_damaged_and_duplicate(self):
        gone = {**self.a, "id": "9" * 16, "name": "gone.mp4", "size": 99}
        # The same local file as the first entry, found by name + size (another machine's id).
        twin = {**self.a, "id": "8" * 16}
        b = review.build_bundle([
            package(self.a, [note("a1" * 8, "on a")]),
            package(gone, [note("a2" * 8, "on gone")]),
            {"format": "sight-review", "version": 1, "asset": {"name": "x.mp4"}},
            package(self.b, [{"id": "b1" * 8, "kind": "note", "shape_kind": {"x": 1}, "data": {}}]),
            package(twin, [note("a3" * 8, "twin")]),
            package(self.c, [note("c1" * 8, "on c")]),
            {**package(self.b, []), "version": 7},
            package({**self.b, "id": "7" * 16}, [note("b2" * 8, "b twin after a damaged b")]),
        ], "Bob", "test")
        st, res = self.route("/api/review/import", raw(b))
        self.assertEqual(st, 200)
        self.assertEqual((res["bundle"], res["id"], res["author"]), (True, b["id"], "Bob"))
        r = res["results"]
        self.assertEqual(len(r), 8)
        self.assertEqual((r[0]["ok"], r[0]["asset_id"], r[0]["added"], r[0]["name"]), (True, self.a["id"], 1, "a.mp4"))
        self.assertEqual((r[1]["ok"], r[1]["missing"]), (False, "gone.mp4"))
        self.assertFalse(r[2]["ok"])
        self.assertIn("incomplete", r[2]["error"])
        self.assertFalse(r[3]["ok"])
        self.assertIn("damaged", r[3]["error"])
        self.assertEqual((r[4]["ok"], r[4]["duplicate"]), (False, 0))
        self.assertEqual((r[5]["ok"], r[5]["asset_id"], r[5]["added"]), (True, self.c["id"], 1))
        self.assertEqual((r[6]["ok"], r[6]["name"]), (False, "b.mp4"))   # damaged, still named
        self.assertIn("newer Sight", r[6]["error"])
        self.assertEqual((r[7]["ok"], r[7]["duplicate"]), (False, 3))   # b's first package was damaged: still one try
        self.assertEqual([x["id"] for x in self.lib.annotations_for_asset(self.a["id"])], ["a1" * 8])
        self.assertEqual(self.lib.annotations_for_asset(self.b["id"]), [])   # the damaged package rolled back
        self.assertEqual(len(self.lib.annotations_for_asset(self.c["id"])), 1)
        # Importing it again changes nothing.
        _, res = self.route("/api/review/import", raw(b))
        self.assertEqual([x.get("added") for x in res["results"] if x["ok"]], [0, 0])

    def test_export_package_all(self):
        self.lib.add_annotation({"id": "a1" * 8, "scope": "asset", "target_asset_id": self.a["id"], **{k: v for k, v in note("a1" * 8, "on a").items() if k != "id"}})
        # b: its only note deleted since — still exported (the tombstone has to travel).
        self.lib.add_annotation({"id": "b1" * 8, "scope": "asset", "target_asset_id": self.b["id"], **{k: v for k, v in note("b1" * 8, "on b").items() if k != "id"}})
        self.lib.delete_annotation("b1" * 8)
        # c: nothing at all — left out.
        body = json.dumps({"asset_ids": [self.a["id"], self.c["id"], self.b["id"], self.a["id"]], "author": "Ann",
                           "reveal": False}).encode()
        st, res = self.route("/api/review/export/package-all", body)
        self.assertEqual((st, res["clips"]), (200, 2))
        self.assertTrue(res["name"].endswith(".srev"))
        bundle = json.loads(Path(res["path"]).read_text(encoding="utf-8"))
        self.assertEqual((bundle["format"], bundle["version"], bundle["author"]), ("sight-review-bundle", 1, "Ann"))
        self.assertRegex(bundle["id"], r"^[0-9a-f]{16}$")
        self.assertLessEqual(abs(bundle["exported_at"] - time.time() * 1000), 60_000)
        self.assertEqual([p["asset"]["id"] for p in bundle["packages"]], [self.a["id"], self.b["id"]])
        self.assertEqual([r["id"] for r in bundle["packages"][0]["annotations"]], ["a1" * 8])
        self.assertEqual([d["id"] for d in bundle["packages"][1]["deleted"]], ["b1" * 8])
        # Nothing to export.
        st, res = self.route("/api/review/export/package-all", json.dumps({"asset_ids": [self.c["id"]], "reveal": False}).encode())
        self.assertEqual((st, res), (200, {"ok": True, "clips": 0}))
        for bad in (b"{}", b'{"asset_ids": "abc"}', b'{"asset_ids": 5}'):
            st, _ = self.route("/api/review/export/package-all", bad)
            self.assertEqual(st, 400, bad)
        # It imports back (on this machine: onto the same assets, nothing new).
        _, imp = self.route("/api/review/import", raw(bundle))
        self.assertEqual([(x["ok"], x["asset_id"], x["added"]) for x in imp["results"]],
                         [(True, self.a["id"], 0), (True, self.b["id"], 0)])


if __name__ == "__main__":
    unittest.main()
