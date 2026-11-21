"""The filter builder (docs/PLAN-trackers.md stage 3b): the library's side (Library.where_sql through list_assets /
count_filtered / purge_missing and GET /api/assets?where=) and the shared JS core (tests/filter_unit.cjs:
the model, the library wire form, ShotGrid hash filters)."""
from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

from app.library import Library, where_sql

ROOT = Path(__file__).resolve().parent.parent
NODE = shutil.which("node")
DAY = 86400


class WhereSqlTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = Path(tempfile.mkdtemp(prefix="sight-flt-"))
        cls.lib = Library(cls.tmp / "home")
        now = time.time()
        cls.now = now
        rows = [
            # id, name, ext, kind, tags, rating, mtime, added_at (ms), note, status
            ("a1", "Shot_010_comp_v003.mov", ".mov", "video", ["comp", "Hero"], 4, now - 2 * DAY, 1_000, "fix the sky", "ready"),
            ("a2", "shot_020_light.exr", ".exr", "image", ["light"], 0, now - 40 * DAY, 2_000, "", "ready"),
            ("a3", "Logo.PNG", ".PNG", "image", [], 5, now - 400 * DAY, 3_000, "", "ready"),
            ("a4", "model.fbx", ".fbx", "model3d", ["prop", "comp"], 2, now - 1 * DAY, 4_000, "", "missing"),
            ("a5", "broken.png", ".png", "image", None, 1, now - 3 * DAY, 5_000, "", "ready"),
            ("a6", "Фон_Неба.JPG", ".JPG", "image", ["Фон"], 0, now - 3 * DAY, 6_000, "", "excluded"),
        ]
        for aid, name, ext, kind, tags, rating, mtime, added, note, status in rows:
            cls.lib.execute(
                "INSERT INTO assets(id, source_id, path, name, ext, kind, size, mtime, tags, note, rating, status, added_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (aid, "src", f"/media/{kind}/{name}", name, ext, kind, 10, mtime,
                 "not json" if tags is None else json.dumps(tags), note, rating, status, added))
        cls.lib.add_annotation({"id": "s" * 16, "kind": "status", "scope": "asset", "target_asset_id": "a2",
                                "data": {"state": "approved"}})

    @classmethod
    def tearDownClass(cls) -> None:
        cls.lib.close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def ids(self, tree, **kw) -> set[str]:
        return {a["id"] for a in self.lib.list_assets(cond=tree, limit=100, **kw)}

    def one(self, f, o, v=None) -> set[str]:
        c = {"f": f, "o": o}
        if v is not None:
            c["v"] = v
        return self.ids({"op": "and", "c": [c]})

    def test_text(self):
        self.assertEqual(self.one("name", "contains", "SHOT"), {"a1", "a2"})
        self.assertEqual(self.one("name", "not_contains", "shot"), {"a3", "a4", "a5"})
        self.assertEqual(self.one("name", "is", "logo.png"), {"a3"})
        self.assertEqual(self.one("name", "starts_with", "shot_0"), {"a1", "a2"})
        self.assertEqual(self.one("name", "ends_with", ".png"), {"a3", "a5"})
        self.assertEqual(self.one("ext", "is", "png"), {"a3", "a5"}, "with or without the dot, any case")
        self.assertEqual(self.one("ext", "is", ".PNG"), {"a3", "a5"})
        self.assertEqual(self.one("note", "not_empty"), {"a1"})
        self.assertEqual(self.one("path", "contains", "/image/"), {"a2", "a3", "a5"})

    def test_unicode_case(self):
        self.lib.execute("UPDATE assets SET status='ready' WHERE id='a6'")
        try:
            self.assertEqual(self.one("name", "contains", "фон"), {"a6"})
            self.assertEqual(self.one("name", "is", "ФОН_НЕБА.jpg"), {"a6"})
            self.assertEqual(self.one("tags", "has", "фон"), {"a6"})
        finally:
            self.lib.execute("UPDATE assets SET status='excluded' WHERE id='a6'")

    def test_enum_tags_rating_dates(self):
        self.assertEqual(self.one("kind", "is", "image"), {"a2", "a3", "a5"})
        self.assertEqual(self.one("kind", "is_not", "image"), {"a1", "a4"})
        self.assertEqual(self.one("tags", "has", "hero"), {"a1"})
        self.assertEqual(self.one("tags", "not_has", "comp"), {"a2", "a3", "a5"}, "a broken tags column counts as no tags")
        self.assertEqual(self.one("tags", "contains", "o"), {"a1", "a4"})
        self.assertEqual(self.one("tags", "empty"), {"a3", "a5"})
        self.assertEqual(self.one("rating", "gt", 3), {"a1", "a3"})
        self.assertEqual(self.one("rating", "is", 0), {"a2"})
        self.assertEqual(self.one("mtime", "gte", (self.now - 7 * DAY) * 1000), {"a1", "a4", "a5"})
        self.assertEqual(self.one("mtime", "lt", (self.now - 30 * DAY) * 1000), {"a2", "a3"})
        self.assertEqual(self.one("added", "between", [2_000, 4_000]), {"a2", "a3"})
        self.assertEqual(self.one("review", "is", "approved"), {"a2"})
        self.assertEqual(self.one("review", "is", "none"), {"a1", "a3", "a4", "a5"})

    def test_groups_and_other_filters(self):
        tree = {"op": "or", "c": [
            {"f": "kind", "o": "is", "v": "video"},
            {"op": "and", "c": [{"f": "kind", "o": "is", "v": "image"}, {"f": "rating", "o": "gt", "v": 4}]},
        ]}
        self.assertEqual(self.ids(tree), {"a1", "a3"})
        self.assertEqual(self.ids(tree, kind="image"), {"a3"}, "ANDed with the sidebar's filters")
        self.assertEqual(self.lib.count_filtered(cond=tree), 2)
        self.assertEqual(self.ids({"op": "or", "c": [{"op": "and", "c": []}]}), {"a1", "a2", "a3", "a4", "a5"}, "empty groups filter nothing")
        self.assertIsNone(where_sql({"op": "and", "c": []}))

    def test_rejects(self):
        bad = [
            {"op": "xor", "c": []},
            {"op": "and", "c": [{"f": "name; DROP TABLE assets", "o": "is", "v": "x"}]},
            {"op": "and", "c": [{"f": "name", "o": "like", "v": "x"}]},
            {"op": "and", "c": [{"f": "rating", "o": "gt", "v": "3"}]},
            {"op": "and", "c": [{"f": "kind", "o": "is", "v": "virus"}]},
            {"op": "and", "c": [{"f": "added", "o": "between", "v": [1]}]},
            {"op": "and", "c": [{"op": "and", "c": [{"op": "and", "c": [{"op": "and", "c": [{"op": "and", "c": []}]}]}]}]},
            {"op": "and", "c": [{"f": "name", "o": "is", "v": "x"}] * 101},
            {"op": "and", "c": [{"f": "ext", "o": "contains", "v": ".."}]},
            {"op": "and", "c": [{"f": "rating", "o": "gt", "v": 10 ** 400}]},
            {"op": "and", "c": [{"f": "name", "o": "is", "v": "x" * 501}]},
        ]
        for t in bad:
            with self.assertRaises(ValueError, msg=json.dumps(t)[:80]):
                where_sql(t)

    def test_purge_scoped_by_conditions(self):
        tree = {"op": "and", "c": [{"f": "kind", "o": "is", "v": "image"}]}
        self.assertEqual(self.lib.purge_missing(cond=tree)["removed"], 0, "a4 is missing but not an image")
        with self.assertRaises(ValueError):
            self.lib.purge_missing(cond={"op": "nope", "c": []})

    def test_http(self):
        try:
            from starlette.testclient import TestClient
            from app.server import build_app
        except Exception as e:  # noqa: BLE001 (the server's deps / httpx missing)
            self.skipTest(f"no test client: {e}")
        c = TestClient(build_app(self.lib))
        tree = {"op": "and", "c": [{"f": "tags", "o": "has", "v": "comp"}]}
        r = c.get("/api/assets", params={"where": json.dumps(tree)})
        self.assertEqual(r.status_code, 200)
        self.assertEqual({a["id"] for a in r.json()["items"]}, {"a1", "a4"})
        self.assertEqual(r.json()["total"], 2)
        self.assertEqual(c.get("/api/assets", params={"where": "{nope"}).status_code, 400)
        from app.server import _where_param
        with self.assertRaises(Exception) as cm:
            _where_param("[" * 100000)  # too deep for json: a 400, not a crash
        self.assertEqual(getattr(cm.exception, "status_code", None), 400)
        self.assertEqual(c.get("/api/assets", params={"where": json.dumps({"op": "and", "c": [{"f": "x", "o": "is", "v": 1}]})}).status_code, 400)


class SmartCollectionTest(unittest.TestCase):
    """Smart collections (stage 3c): a collection row holding a saved Filter ▾ tree, no members."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="sight-smart-"))
        self.lib = Library(self.tmp / "home")

    def tearDown(self) -> None:
        self.lib.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_store_and_rules(self):
        tree = {"op": "and", "c": [{"f": "kind", "o": "is", "v": "image"}]}
        plain = self.lib.add_collection("Plain")
        sm = self.lib.add_collection("Images", rule=tree)
        self.assertEqual(sm["rule"], tree)
        sg = self.lib.add_collection("Approved", plain["id"], {"op": "or", "c": []}, "x.shotgrid.autodesk.com", 70)
        self.assertIsNone(sg["parentId"], "a ShotGrid one is never nested")
        by = {c["id"]: c for c in self.lib.collections()}
        self.assertEqual(by[sm["id"]]["rule"], tree)
        self.assertIsNone(by[plain["id"]]["rule"])
        self.assertEqual((by[sg["id"]]["sgSite"], by[sg["id"]]["sgProject"]), ("x.shotgrid.autodesk.com", 70))
        # nothing nests in a smart collection; a ShotGrid one stays at the top; a smart one takes no members
        self.lib.move_collection(plain["id"], sm["id"])
        self.lib.move_collection(sg["id"], plain["id"])
        child = self.lib.add_collection("Child", sm["id"])
        self.lib.add_to_collection(sm["id"], ["a1"])
        by = {c["id"]: c for c in self.lib.collections()}
        self.assertIsNone(by[plain["id"]]["parentId"])
        self.assertIsNone(by[sg["id"]]["parentId"])
        self.assertIsNone(by[child["id"]]["parentId"])
        self.assertEqual(by[sm["id"]]["assetIds"], [])
        # the rule changes; a plain collection does not become a smart one
        t2 = {"op": "or", "c": [{"f": "name", "o": "contains", "v": "Фон"}]}
        self.lib.set_collection_rule(sm["id"], t2)
        self.lib.set_collection_rule(plain["id"], t2)
        by = {c["id"]: c for c in self.lib.collections()}
        self.assertEqual(by[sm["id"]]["rule"], t2)
        self.assertIsNone(by[plain["id"]]["rule"])
        for bad in ([1], "x", {"c": "x" * 70_000}):
            with self.assertRaises(ValueError):
                self.lib.set_collection_rule(sm["id"], bad)
        with self.assertRaises(ValueError):
            self.lib.add_collection("No project", rule=tree, sg_site="x", sg_project=None)
        # a corrupt stored rule reads as an empty smart collection, not a crash
        self.lib.execute("UPDATE collections SET rule='{nope' WHERE id=?", (sm["id"],))
        self.assertEqual({c["id"]: c for c in self.lib.collections()}[sm["id"]]["rule"], {"op": "and", "c": []})
        self.lib.delete_collection(sm["id"])
        self.assertNotIn(sm["id"], {c["id"] for c in self.lib.collections()})

    def test_http(self):
        try:
            from starlette.testclient import TestClient
            from app.server import build_app
        except Exception as e:  # noqa: BLE001
            self.skipTest(f"no test client: {e}")
        c = TestClient(build_app(self.lib))
        tree = {"op": "and", "c": [{"f": "tags", "o": "has", "v": "comp"}]}
        r = c.post("/api/collections", json={"name": "Comp", "rule": tree})
        self.assertEqual(r.status_code, 200)
        cid = r.json()["id"]
        self.assertEqual(c.patch(f"/api/collections/{cid}", json={"rule": {"op": "or", "c": []}}).status_code, 200)
        self.assertEqual(c.patch(f"/api/collections/{cid}", json={"rule": [1]}).status_code, 400)
        self.assertEqual(c.post("/api/collections", json={"name": "x", "rule": "nope"}).status_code, 400)
        self.assertEqual(c.post("/api/collections", json={"name": "x", "rule": tree, "sgSite": "h", "sgProject": "7"}).status_code, 400)
        for bad in ({"sgSite": ["h"], "sgProject": 7}, {"sgSite": "h", "sgProject": 2 ** 70}, {"sgSite": "h" * 300, "sgProject": 7}):
            self.assertEqual(c.post("/api/collections", json={"name": "x", "rule": tree, **bad}).status_code, 400, bad)
        self.assertEqual(c.post("/api/collections", content='{"name":"x","rule":{"v":"\\ud800"}}',
                                headers={"content-type": "application/json"}).status_code, 400, "a lone surrogate")
        self.assertEqual(c.patch(f"/api/collections/{cid}", json={"name": "Renamed", "rule": [1]}).status_code, 400)
        self.assertNotEqual({x["id"]: x for x in c.get("/api/state").json()["collections"]}[cid]["name"], "Renamed",
                            "a refused rule changes nothing else")
        r = c.post("/api/collections", json={"name": "SG", "rule": tree, "sgSite": "h", "sgProject": 7})
        self.assertEqual((r.json()["sgSite"], r.json()["sgProject"]), ("h", 7))
        st = {x["id"]: x for x in c.get("/api/state").json()["collections"]}
        self.assertEqual(st[cid]["rule"], {"op": "or", "c": []})


class FilterCoreJsTest(unittest.TestCase):
    def test_unit(self):
        if not NODE:
            self.skipTest("node is not available")
        r = subprocess.run([NODE, str(ROOT / "tests" / "filter_unit.cjs")], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
