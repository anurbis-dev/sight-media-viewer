"""The tracker-neutral layer (docs/ARCHITECTURE.md "Tracker adapters", docs/PLAN-trackers.md stage 5b): tracker keys
(app/trackers.py and app/static/trackers-core.js agree), the adapter registry on both sides, the generic routes
/api/trackers/{kind}/… with the /api/sg/… aliases, links per tracker key, smart collections filed under a tracker key,
and the migrations of pre-0.107 data (sg_links rows, collections.sg_site / sg_project). No network.

    python -m unittest tests.test_trackers
"""
from __future__ import annotations

import json
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.library import Library  # noqa: E402
from app.shotgrid import ShotGridService  # noqa: E402
from app.trackers import Trackers, host_of, split_key, tracker_key  # noqa: E402

NODE = shutil.which("node")
SITES = ["https://Studio.Example", "studio.example/", "https://studio.example:443", "http://127.0.0.1:8080",
         "https://studio.example:8443", "http://localhost:80", "http://[::1]:5000", "", "https://",
         # unusual spellings the browser canonicalises (review of 0.107.0): both sides must give the same host
         "http://[0:0:0:0:0:0:0:1]:5000", "https://[::FFFF:1.2.3.4]", "http://0x7f.1:8080", "https://127.1", "https://0177.0.0.1",
         "https://08.1", "https://bücher.example", "https://xn--bcher-kva.example", "a.b/c://d", "http://localhost:443",
         "https://localhost:80", "https://x:0443", "https://%41.example", "https://x.", "ftp://x", "HTTPS://Up.Example:8443",
         "https://u:p@studio.example", "http://[1:0:0:2:0:0:0:3]", "http://[fe80::1:0:0:1]:9"]


def insert_asset(lib: Library, aid: str) -> None:
    lib.execute("INSERT INTO assets(id, source_id, path, name, ext, kind, size, mtime, tags, status, added_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?)", (aid, "src", f"/m/{aid}.png", f"{aid}.png", ".png", "image", 1, 1, "[]", "ready", 1))


class KeyTest(unittest.TestCase):
    def test_keys(self):
        self.assertEqual(host_of("https://Studio.Example:443/"), "studio.example")
        self.assertEqual(host_of("studio.example:8443"), "studio.example:8443")
        self.assertEqual(tracker_key("shotgrid", "https://studio.example"), "shotgrid:studio.example")
        self.assertEqual(tracker_key("shotgrid", ""), "")
        self.assertEqual(split_key("shotgrid:studio.example:8443"), ("shotgrid", "studio.example:8443"))
        for bad in ("shotgrid", "shotgrid:", ":x", "Shot:x", "shotgrid:Upper.example", "shotgrid:a b", None, 7, "s:" + "h" * 400):
            self.assertIsNone(split_key(bad), bad)

    def test_stored_hosts_and_valid_sites(self):
        from app.shotgrid import valid_site
        from app.trackers import host_norm, tracker_key_of_host
        # a host stored without its scheme (a link's site, sg_site): its port is kept — http://localhost:443 is
        # "localhost:443" in URL.host, and the configured site gives the same key
        self.assertEqual(tracker_key_of_host("shotgrid", "localhost:443"), tracker_key("shotgrid", "http://localhost:443"))
        self.assertEqual(tracker_key_of_host("shotgrid", "Studio.Example"), tracker_key("shotgrid", "https://studio.example"))
        self.assertEqual(host_norm("[0:0:0:0:0:0:0:1]:5000"), "[::1]:5000")
        for bad in ("", "a/b", "a b", "h?x", "u@h", None):
            self.assertEqual(host_norm(bad), "", bad)
        # a site spelt so that the browser's URL.host would differ is refused (the key must be the same everywhere)
        for bad in ("http://[0:0:0:0:0:0:0:1]:5000", "https://0x7f.1", "https://127.1", "https://%41.example", "https://bücher.example"):
            self.assertFalse(valid_site(bad), bad)
        for ok in ("https://studio.example", "https://xn--bcher-kva.example", "http://127.0.0.1:8080", "http://[::1]:5000", "https://Up.Example"):
            self.assertTrue(valid_site(ok), ok)

    def test_same_rule_in_js(self):
        if not NODE:
            self.skipTest("node is not available")
        js = ("const T = require(process.argv[1]); const sites = JSON.parse(process.argv[2]);"
              "console.log(JSON.stringify(sites.map((s) => [T.hostOf(s), T.key('shotgrid', s), T.split(T.key('shotgrid', s))])));")
        r = subprocess.run([NODE, "-e", js, str(ROOT / "app" / "static" / "trackers-core.js"), json.dumps(SITES)],
                           capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        got = json.loads(r.stdout)
        for s, (h, k, sp) in zip(SITES, got):
            self.assertEqual(h, host_of(s), s)
            self.assertEqual(k, tracker_key("shotgrid", s), s)
            want = split_key(k)
            self.assertEqual(sp, {"kind": want[0], "host": want[1]} if want else None, s)

    def test_js_adapter_interface(self):
        # the ShotGrid adapter registers itself and has every member trackers-core.js lists (whatever the load order)
        if not NODE:
            self.skipTest("node is not available")
        doc = (ROOT / "app" / "static" / "trackers-core.js").read_text(encoding="utf-8")
        js = ("require(process.argv[2]); const T = require(process.argv[1]); const A = T.adapter('shotgrid');"
              "console.log(JSON.stringify({kinds: T.kinds(), keys: A ? Object.keys(A) : [], viaEntry: !!T.adapterOf({id: 'shotgrid'}),"
              " none: T.adapter('nope'), store: A.storeKey('fields')}));")
        r = subprocess.run([NODE, "-e", js, str(ROOT / "app" / "static" / "trackers-core.js"), str(ROOT / "app" / "static" / "shotgrid-core.js")],
                           capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        got = json.loads(r.stdout)
        self.assertEqual(got["kinds"], [{"id": "shotgrid", "name": "ShotGrid"}])
        self.assertTrue(got["viaEntry"])
        self.assertIsNone(got["none"])
        self.assertEqual(got["store"], "sight.sg.fields", "ShotGrid keeps its pre-0.107 setting names")
        want = ["id", "name", "short", "media", "entityTypes", "statusField", "defaultTileFields", "serverClient", "projects",
                "entities", "mediaFields", "filterFields", "toConditions", "browse", "recordId", "recordName", "recordStamp",
                "recordTime", "isVideo", "hasFilmstrip", "filmstripFrames", "filmstripCss", "fmtField", "hiddenDetailFields",
                "findMedia", "loadLink", "linkOf", "linkId", "linkLabel", "linkProject", "linkedIdOf", "sync", "storeKey"]
        for k in want:
            self.assertIn(k, got["keys"])
            self.assertIn(k, doc, f"{k} is documented in trackers-core.js")


class RegistryTest(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = Path(tempfile.mkdtemp(prefix="sight-trk-"))

    def tearDown(self) -> None:
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_old_non_canonical_site_still_saves(self):
        # a site saved before 0.107 in a spelling valid_site now refuses: a logins save / Disconnect (which send the
        # stored site back) rewrite it to the browser's spelling instead of failing; the key stays with it
        sg = ShotGridService(self.dir)
        for old, canon in (("https://[0:0:0:0:0:0:0:1]", "https://[::1]"), ("https://0x7f.1:8443", "https://127.0.0.1:8443"),
                           ("https://%41.Example", "https://a.example")):
            (self.dir / "shotgrid.json").write_text(json.dumps({"site": old, "script": "s", "key": "k"}), encoding="utf-8")
            self.assertTrue(sg.configure({"site": old, "script": "s", "logins": {"Ann": "ann"}}), old)
            st = sg.status()
            self.assertEqual((st["site"], st["hasKey"], st["logins"]), (canon, True, {"Ann": "ann"}), old)
            self.assertTrue(sg.configure({"site": old, "script": "s", "key": ""}), "Disconnect: " + old)
            self.assertEqual((sg.status()["site"], sg.status()["hasKey"]), (canon, False))
            self.assertEqual(sg.tracker(), None)

    def test_registry(self):
        t = Trackers(self.dir)
        self.assertEqual(t.kinds, [{"id": "shotgrid", "name": "ShotGrid"}])
        self.assertIsInstance(t.get("shotgrid"), ShotGridService)
        self.assertIsNone(t.get("ftrack"))
        self.assertEqual((t.connected(), t.key_of("shotgrid")), ([], ""))
        t.get("shotgrid").configure({"site": "Studio.Example", "script": "s"})
        self.assertEqual((t.connected(), t.key_of("shotgrid")), ([], "shotgrid:studio.example"), "a key without a connection")
        t.get("shotgrid").configure({"site": "Studio.Example", "script": "s", "key": "k", "sudo": True})
        self.assertEqual([(e["key"], e["note"]) for e in t.connected()], [("shotgrid:studio.example", "as reviewer")])
        with self.assertRaises(Exception):
            t.get("shotgrid").parse_media_id("12x")
        self.assertEqual(t.get("shotgrid").parse_media_id("12"), 12)


class MigrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="sight-trkmig-"))
        self.home = self.tmp / "home"

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _old_db(self) -> None:
        """A library as Sight 0.106 left it: ShotGrid links in sg_links, ShotGrid smart collections in sg_site /
        sg_project, no tracker columns, no tracker_links table."""
        lib = Library(self.home)
        insert_asset(lib, "a1")
        insert_asset(lib, "a2")
        lib.close()
        c = sqlite3.connect(self.home / "library.db")
        c.execute("DROP TABLE tracker_links")
        c.execute("DELETE FROM meta WHERE key='tracker_links_from_sg'")
        try:
            c.execute("ALTER TABLE collections DROP COLUMN tracker")
            c.execute("ALTER TABLE collections DROP COLUMN tracker_project")
        except sqlite3.OperationalError:   # (SQLite < 3.35: the columns stay, empty — the same migration path)
            c.execute("UPDATE collections SET tracker=NULL, tracker_project=NULL")
        link = {"site": "studio.example", "project": {"id": 70, "name": "Demo"}, "version": {"id": 78, "code": "sh020"},
                "task": None, "entity": None, "firstFrame": 1001}
        c.execute("INSERT INTO sg_links(asset_id, link, state, updated_at) VALUES (?,?,?,?)",
                  ("a1", json.dumps(link), json.dumps({"last": 5}), 9))
        c.execute("INSERT INTO sg_links(asset_id, link, state, updated_at) VALUES (?,?,?,?)", ("a2", "{broken", "{}", 9))
        c.execute("INSERT INTO sg_links(asset_id, link, state, updated_at) VALUES (?,?,?,?)",
                  ("a3", json.dumps(dict(link, site="localhost:443")), "{}", 9))   # (a site http://localhost:443)
        c.execute("INSERT INTO collections(id, name, created_at, sort_order, rule, sg_site, sg_project) VALUES (?,?,?,?,?,?,?)",
                  ("c1", "Approved", 1, 0, json.dumps({"op": "and", "c": []}), "studio.example", 70))
        c.execute("INSERT INTO collections(id, name, created_at, sort_order) VALUES (?,?,?,?)", ("c2", "Plain", 2, 1))
        c.commit()
        c.close()

    def test_migrates_links_and_smart_collections(self):
        self._old_db()
        lib = Library(self.home)
        try:
            got = lib.get_tracker_link("a1", "shotgrid:studio.example")
            self.assertEqual((got["link"]["version"]["code"], got["state"], got["updated_at"]), ("sh020", {"last": 5}, 9))
            self.assertIsNone(lib.get_tracker_link("a2", "shotgrid:studio.example"), "an unreadable old link is left behind")
            self.assertIsNotNone(lib.get_tracker_link("a3", tracker_key("shotgrid", "http://localhost:443")), "its port kept, no scheme guessed")
            by = {c["id"]: c for c in lib.collections()}
            self.assertEqual((by["c1"]["tracker"], by["c1"]["trackerProject"], by["c1"]["sgSite"], by["c1"]["sgProject"]),
                             ("shotgrid:studio.example", "70", "studio.example", 70))
            self.assertEqual((by["c2"]["tracker"], by["c2"]["trackerProject"]), (None, None))
            # a link dropped after the migration does not come back from the old table on the next launch
            lib.drop_tracker_link("a1", "shotgrid:studio.example")
            self.assertEqual(len(lib.query("SELECT * FROM sg_links")), 3, "the old table is left as it was (an older Sight reads it)")
        finally:
            lib.close()
        lib = Library(self.home)
        try:
            self.assertIsNone(lib.get_tracker_link("a1", "shotgrid:studio.example"))
        finally:
            lib.close()

    def test_links_per_tracker(self):
        lib = Library(self.home)
        try:
            insert_asset(lib, "a1")
            lib.set_tracker_link("a1", "shotgrid:one.example", {"site": "one.example", "version": {"id": 1}})
            lib.set_tracker_link("a1", "ftrack:two.example", {"site": "two.example", "version": {"id": 2}}, {"last": 3})
            lib.set_tracker_link("a1", "shotgrid:one.example", None, {"last": 4})
            self.assertEqual(lib.get_tracker_link("a1", "shotgrid:one.example")["state"], {"last": 4})
            self.assertEqual(lib.get_tracker_link("a1", "ftrack:two.example")["link"]["version"]["id"], 2)
            lib.set_tracker_link("a1", "shotgrid:one.example", {"site": "one.example", "version": {"id": 9}})
            self.assertEqual(lib.get_tracker_link("a1", "shotgrid:one.example")["state"], {}, "a new link starts a fresh state")
            lib.drop_tracker_link("a1", "shotgrid:one.example")
            self.assertIsNone(lib.get_tracker_link("a1", "shotgrid:one.example"))
            self.assertIsNotNone(lib.get_tracker_link("a1", "ftrack:two.example"), "the other tracker's link stays")
        finally:
            lib.close()

    def test_smart_collection_keys(self):
        lib = Library(self.home)
        try:
            rule = {"op": "and", "c": []}
            other = lib.add_collection("F", None, rule, "ftrack:two.example", "a1b2-c3")
            self.assertEqual((other["tracker"], other["trackerProject"], other["sgSite"]), ("ftrack:two.example", "a1b2-c3", None))
            sg = lib.add_collection("S", None, rule, "shotgrid:one.example", 70)
            self.assertEqual((sg["trackerProject"], sg["sgSite"], sg["sgProject"]), ("70", "one.example", 70))
            for key, proj in (("one.example", 70), ("shotgrid:one.example", None), ("shotgrid:one.example", "x7"),
                              ("shotgrid:one.example", True), ("ftrack:x", " pad"), ("ftrack:x", "")):
                with self.assertRaises(ValueError, msg=(key, proj)):
                    lib.add_collection("bad", None, rule, key, proj)
            plain = lib.add_collection("P", None, None, "shotgrid:one.example", 70)
            self.assertIsNone(plain["tracker"], "no rule: a plain collection, the tracker is dropped")
            lib.move_collection(sg["id"], plain["id"])
            self.assertIsNone({c["id"]: c for c in lib.collections()}[sg["id"]]["parentId"], "a tracker one stays at the top")
        finally:
            lib.close()


class RoutesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        try:
            from starlette.testclient import TestClient
            from app.server import build_app
        except Exception as e:  # noqa: BLE001
            raise unittest.SkipTest(f"no test client: {e}")
        cls.tmp = Path(tempfile.mkdtemp(prefix="sight-trkhttp-"))
        cls.lib = Library(cls.tmp / "home")
        insert_asset(cls.lib, "a1")
        ShotGridService(cls.lib.root).configure({"site": "https://studio.example", "script": "s", "key": "secret"})
        cls.c = TestClient(build_app(cls.lib), base_url="http://127.0.0.1")

    @classmethod
    def tearDownClass(cls) -> None:
        cls.lib.close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_list_and_status(self):
        got = self.c.get("/api/trackers").json()
        self.assertEqual([(t["id"], t["kind"], t["key"]) for t in got["trackers"]], [("shotgrid", "shotgrid", "shotgrid:studio.example")])
        self.assertEqual(got["kinds"], [{"id": "shotgrid", "name": "ShotGrid"}])
        self.assertIsInstance(got["cacheSources"], list)
        self.assertNotIn("secret", json.dumps(got))
        a, b = self.c.get("/api/trackers/shotgrid/status").json(), self.c.get("/api/sg/status").json()
        self.assertEqual(a, b, "the alias answers the same")
        self.assertEqual((a["key"], a["configured"]), ("shotgrid:studio.example", True))
        for path in ("/api/trackers/nope/status", "/api/trackers/nope/cache", "/api/trackers/nope/link/a1"):
            self.assertEqual(self.c.get(path).status_code, 404, path)
        self.assertEqual(self.c.get("/api/trackers/shotgrid/thumb/abc").status_code, 404, "not a Version id")
        self.assertEqual(self.c.get("/api/trackers/shotgrid/fetch?url=x").status_code, 403, "Sight's page only")

    def test_links_by_site(self):
        X = {"X-Sight": "1"}
        link = {"site": "studio.example", "version": {"id": 78, "code": "sh020"}}
        self.assertEqual(self.c.put("/api/trackers/shotgrid/link/a1", json={"link": link}, headers=X).status_code, 200)
        self.assertEqual(self.c.get("/api/sg/link/a1").json()["link"]["version"]["code"], "sh020", "the alias reads the same row")
        self.assertEqual(self.c.put("/api/sg/link/a1", json={"state": {"last": 1}}, headers=X).status_code, 200)
        self.assertEqual(self.c.get("/api/trackers/shotgrid/link/a1").json()["state"], {"last": 1})
        self.assertEqual(self.c.put("/api/trackers/shotgrid/link/a1", json={"link": link}).status_code, 403, "header needed")
        self.assertEqual(self.c.put("/api/trackers/shotgrid/link/nope", json={"link": link}, headers=X).status_code, 404)
        # another site: its own (empty) link; back: the first one again
        svc = ShotGridService(self.lib.root)
        try:
            svc.configure({"site": "https://other.example", "script": "s", "key": "k"})
            self.assertIsNone(self.c.get("/api/trackers/shotgrid/link/a1").json()["link"])
        finally:
            svc.configure({"site": "https://studio.example", "script": "s", "key": "secret"})
        self.assertEqual(self.c.get("/api/trackers/shotgrid/link/a1").json()["link"]["version"]["id"], 78)
        self.assertEqual(self.c.delete("/api/trackers/shotgrid/link/a1", headers=X).status_code, 200)
        self.assertIsNone(self.c.get("/api/sg/link/a1").json()["link"])

    def test_collections(self):
        tree = {"op": "and", "c": []}
        r = self.c.post("/api/collections", json={"name": "New", "rule": tree, "tracker": "shotgrid:studio.example", "trackerProject": 70})
        self.assertEqual((r.status_code, r.json()["tracker"], r.json()["sgSite"]), (200, "shotgrid:studio.example", "studio.example"))
        r = self.c.post("/api/collections", json={"name": "Old", "rule": tree, "sgSite": "Studio.Example", "sgProject": 71})
        self.assertEqual((r.status_code, r.json()["tracker"], r.json()["trackerProject"]), (200, "shotgrid:studio.example", "71"),
                         "the pre-0.107 form still works")
        r = self.c.post("/api/collections", json={"name": "Plain", "sgSite": "h"})
        self.assertEqual((r.status_code, r.json()["tracker"], r.json()["rule"]), (200, None, None), "no rule: a plain collection, as before")
        r = self.c.post("/api/collections", json={"name": "Port", "rule": tree, "sgSite": "localhost:443", "sgProject": 5})
        self.assertEqual(r.json()["tracker"], "shotgrid:localhost:443", "the old form's host keeps its port")
        self.assertNotIn("tracker_project", json.dumps(self.c.get("/api/collections").json()))
        for bad in ({"tracker": "nokind"}, {"tracker": "shotgrid:Upper"}, {"tracker": 7}, {"tracker": "ftrack:x", "trackerProject": [1]}):
            self.assertEqual(self.c.post("/api/collections", json={"name": "x", "rule": tree, "trackerProject": 1, **bad}).status_code, 400, bad)


if __name__ == "__main__":
    unittest.main()
