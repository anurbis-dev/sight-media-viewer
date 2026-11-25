"""ShotGrid link (docs/SHOTGRID.md): app/shotgrid.py's config store, the sync core against a fake site
(tests/sg_unit.cjs) and the whole path through Sight's server (tests/sg_sight.cjs: /api/sg/fetch adds the token,
/api/review/import merges). Needs node; the fake ShotGrid is tests/sg_fake_server.cjs. No network.

    python -m unittest tests.test_shotgrid
"""
from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.library import Library  # noqa: E402
from app.shotgrid import ShotGridService, site_url, valid_site  # noqa: E402

NODE = shutil.which("node")


class ConfigTest(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = Path(tempfile.mkdtemp())
        self.sg = ShotGridService(self.dir)

    def tearDown(self) -> None:
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_store(self):
        self.assertFalse(self.sg.status()["configured"])
        self.assertFalse(self.sg.configure({"site": "http://studio.example"}))   # plain http only on this machine
        self.assertFalse(self.sg.configure({"site": "https://u:p@studio.example"}))
        self.assertFalse(self.sg.configure({"site": "https://studio.example/some/path"}))
        self.assertFalse(self.sg.configure({"site": "studio.example", "script": "s", "key": "has space"}))
        self.assertFalse(self.sg.configure({"site": "studio.example", "statusMap": {"weird": "x"}}))
        self.assertTrue(self.sg.configure({"site": "studio.example/", "script": "sight", "key": " k1 ",
                                           "statusMap": {"done": "fin", "open": " "}, "logins": {"Ann": "ann"}, "sudo": True}))
        st = self.sg.status()
        self.assertEqual((st["configured"], st["site"], st["script"], st["hasKey"], st["statusMap"], st["logins"], st["sudo"]),
                         (True, "https://studio.example", "sight", True, {"done": "fin"}, {"Ann": "ann"}, True))
        self.assertNotIn("k1", json.dumps(st))
        self.assertEqual(json.loads((self.dir / "shotgrid.json").read_text())["key"], "k1")
        # no "key": kept while site + script stay; another site drops it (the key never follows the address)
        self.assertTrue(self.sg.configure({"site": "https://studio.example", "script": "sight"}))
        self.assertTrue(self.sg.status()["hasKey"])
        self.assertTrue(self.sg.configure({"site": "https://evil.example", "script": "sight"}))
        self.assertFalse(self.sg.status()["hasKey"])
        self.assertTrue(self.sg.configure({}))
        self.assertFalse((self.dir / "shotgrid.json").exists())

    def test_tracker_entry_only_while_connected(self):
        # docs/PLAN-trackers.md decision 10: /api/trackers lists ShotGrid only while it is usable (site + script + key)
        self.assertIsNone(self.sg.tracker())
        self.assertTrue(self.sg.configure({"site": "studio.example:8443", "script": "sight"}))   # no key yet
        self.assertIsNone(self.sg.tracker())
        self.assertFalse(self.sg.status()["configured"])
        self.assertTrue(self.sg.configure({"site": "studio.example:8443", "script": "sight", "key": "k"}))
        self.assertEqual(self.sg.tracker(), {"id": "shotgrid", "kind": "shotgrid", "key": "shotgrid:studio.example:8443", "name": "ShotGrid",
                                             "site": "https://studio.example:8443", "host": "studio.example:8443", "note": ""})
        self.assertTrue(self.sg.configure({"site": "studio.example:8443", "script": "sight", "key": ""}))   # Disconnect
        self.assertIsNone(self.sg.tracker())
        self.assertEqual(self.sg.status()["site"], "https://studio.example:8443", "a disconnect keeps the site for the next connect")

    def test_sudo_only_when_on_and_no_token_path(self):
        from unittest import mock
        self.sg.configure({"site": "https://studio.example", "script": "s", "key": "k", "sudo": False})
        seen = []
        with mock.patch.object(ShotGridService, "_token", lambda self_, c, sudo, fresh=False: seen.append(sudo) or "T"), \
                mock.patch("app.shotgrid._opener_for") as op:
            op.return_value.open.return_value.__enter__.return_value = mock.Mock(status=200, headers={"Content-Type": "application/json"}, read=lambda n=0: b"{}")
            self.sg.forward("GET", "https://studio.example/api/v1.1/entity/projects", None, {}, sudo="boss")
            self.assertEqual(seen, [""], "sudo ignored while 'post as the reviewer' is off")
            from app.shotgrid import SgError
            for path in ("/API/V1.1/AUTH/ACCESS_TOKEN", "/api/v1.1/auth/access_toke%6E"):
                with self.assertRaises(SgError):
                    self.sg.forward("POST", "https://studio.example" + path, b"", {})

    def test_cache_limit_and_eviction(self):
        self.sg.configure({"site": "https://studio.example", "script": "s", "key": "k", "cacheLimitGB": 1})
        self.assertEqual(self.sg.status()["cacheLimitGB"], 1)
        self.assertTrue(self.sg.configure({"site": "https://studio.example", "script": "s"}))   # missing: kept
        self.assertEqual(self.sg.status()["cacheLimitGB"], 1)
        self.assertFalse(self.sg.configure({"site": "https://studio.example", "script": "s", "cacheLimitGB": -1}))
        d = self.sg.media_dir() / "studio.example"
        d.mkdir(parents=True)
        old, new = d / "old.mp4", d / "new.mp4"
        old.write_bytes(b"x" * 1000); new.write_bytes(b"y" * 1000)
        os.utime(old, (1, 1))
        gb = 1024 ** 3
        from unittest import mock
        roomy = mock.patch("app.shotgrid.shutil.disk_usage", return_value=mock.Mock(free=100 * gb))
        roomy.start(); self.addCleanup(roomy.stop)
        self.sg.make_room(gb - 1500)   # 2000 used + need > 1 GB: the oldest goes, the newer stays
        self.assertFalse(old.exists()); self.assertTrue(new.exists())
        from app.shotgrid import SgError
        with self.assertRaises(SgError):
            self.sg.make_room(2 * gb)  # more than the limit itself: refused, nothing deleted
        self.assertTrue(new.exists())
        # a download under way (.part) and a file opened a minute ago are never evicted; they still count
        part, recent = d / "x.mp4.part", d / "recent.mp4"
        part.write_bytes(b"p" * 1000); recent.write_bytes(b"r" * 1000)
        os.utime(part, (1, 1)); os.utime(recent, (time.time() - 60, 1))
        with self.assertRaises(SgError):
            self.sg.make_room(gb - 2500)   # only `new` (recent too) could go: refused before deleting
        self.assertTrue(part.exists() and recent.exists() and new.exists())
        self.assertTrue(self.sg.configure({"site": "https://studio.example", "script": "s", "cacheLimitGB": 0}))   # Auto
        self.sg.make_room(1000)        # room on the disk: nothing goes
        self.assertTrue(new.exists())

    def test_site_rules(self):
        self.assertEqual(site_url("x.shotgunstudio.com/api/v1.1"), "https://x.shotgunstudio.com")
        self.assertTrue(valid_site("http://127.0.0.1:9000"))
        self.assertFalse(valid_site("ftp://x"))


@unittest.skipUnless(NODE, "node is not installed")
class CoreTest(unittest.TestCase):
    def test_sync_core(self):
        r = subprocess.run([NODE, str(ROOT / "tests" / "sg_unit.cjs")], capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@unittest.skipUnless(NODE, "node is not installed")
class SightPathTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        import uvicorn
        from app.server import build_app

        cls.tmp = Path(tempfile.mkdtemp(prefix="sight-sg-"))
        cls.fake = subprocess.Popen([NODE, str(ROOT / "tests" / "sg_fake_server.cjs")], stdout=subprocess.PIPE, text=True)
        cls.site = json.loads(cls.fake.stdout.readline())["site"]
        cls.lib = Library(cls.tmp / "home")
        # a real file in a real source: the page's library scan (the browser test) must find it there
        clips = cls.tmp / "clips"
        clips.mkdir()
        (clips / "sh010.png").write_bytes(__import__("base64").b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="))
        sid = cls.lib.add_source(str(clips))["id"]
        deadline = time.time() + 20
        while time.time() < deadline and not cls.lib.query("SELECT id FROM assets WHERE source_id=? AND status='ready'", (sid,)):
            time.sleep(0.1)
        cls.aid = cls.lib.query("SELECT id FROM assets WHERE source_id=?", (sid,))[0]["id"]
        now = int(time.time() * 1000)
        cls.lib.add_annotation({"id": "a" * 16, "kind": "note", "scope": "asset", "target_asset_id": cls.aid,
                                "data": {"text": "Mine", "author": "Bob Smith", "created": now - 60000, "status": "open",
                                         "ctx": {"t": 1, "hold": 0}, "shots": [], "replies": []}})
        ShotGridService(cls.lib.root).configure({"site": cls.site, "script": "sight", "key": "secret",
                                                 "logins": {"Bob Smith": "bob"}, "sudo": True})
        # a note written on ShotGrid, with a picture
        req = urllib.request.Request(cls.site + "/__fake/add", method="POST", data=json.dumps(
            {"type": "Note", "content": "From ShotGrid", "subject": "s", "sg_status_list": "opn",
             "user": {"type": "HumanUser", "id": 7, "name": "Bob Smith"}, "note_links": [{"type": "Version", "id": 77}]}).encode())
        sgn = json.loads(urllib.request.urlopen(req).read())
        png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        req = urllib.request.Request(cls.site + "/__fake/add", method="POST", data=json.dumps(
            {"type": "Attachment", "note": sgn["id"], "filename": "ref.png", "file": {"name": "ref.png", "base64": png, "type": "image/png"}}).encode())
        urllib.request.urlopen(req).read()
        cls.port = free_port()
        cls.server = uvicorn.Server(uvicorn.Config(build_app(cls.lib), host="127.0.0.1", port=cls.port, log_level="warning"))
        cls.thread = threading.Thread(target=cls.server.run, daemon=True)
        cls.thread.start()
        for _ in range(100):
            if cls.server.started:
                break
            time.sleep(0.05)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.should_exit = True
        cls.thread.join(5)
        cls.fake.terminate()
        cls.fake.wait(5)
        cls.fake.stdout.close()
        for w in list(cls.lib._watchers.values()):  # the folder watchers would outlive the database
            w.stop()
            w.join(5)
        cls.lib.close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_guard(self):
        base = f"http://127.0.0.1:{self.port}/api/sg/fetch?url=" + urllib.parse.quote(self.site + "/api/v1.1/entity/projects")
        for headers, want in (({}, 403), ({"X-Sight": "1", "Host": "evil.example:80"}, 403), ({"X-Sight": "1"}, 404)):  # (passed the guard: the fake has no plain GET of a list)
            req = urllib.request.Request(base, headers=headers)
            try:
                code = urllib.request.urlopen(req).status
            except urllib.error.HTTPError as e:
                code = e.code
            self.assertEqual(code, want, headers)

    def test_sg_view_in_the_browser(self):
        if subprocess.run([NODE, "-e", "require('playwright')"], capture_output=True, cwd=ROOT / "tests").returncode:
            self.skipTest("Playwright is not available")
        r = subprocess.run([NODE, str(ROOT / "tests" / "sg_view_e2e.cjs"), f"http://127.0.0.1:{self.port}", self.site],
                           capture_output=True, text=True, timeout=180, cwd=ROOT / "tests")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_thumb_cache_and_open(self):
        base = f"http://127.0.0.1:{self.port}"
        r = urllib.request.urlopen(base + "/api/sg/thumb/78?u=a")
        self.assertEqual((r.status, r.headers.get("Content-Type")), (200, "image/png"))
        self.assertEqual(urllib.request.urlopen(base + "/api/sg/thumb/79?kind=filmstrip&u=a").status, 204, "no filmstrip: no content")
        meta = next((self.lib.root / "sg_cache" / "thumbs").rglob("78_image.json"))
        self.assertEqual(json.loads(meta.read_text())["u"], "a")
        post = lambda: json.loads(urllib.request.urlopen(urllib.request.Request(base + "/api/sg/open/78", method="POST", headers={"X-Sight": "1"})).read())
        a1 = post()
        f1 = Path(a1["asset"]["path"])
        m1 = f1.stat().st_mtime
        time.sleep(0.05)
        a2 = post()
        self.assertEqual(a1["asset"]["id"], a2["asset"]["id"], "opened twice: one file, one asset")
        self.assertEqual(f1.stat().st_mtime, m1, "a reopen touches only atime (no re-thumbnail)")
        req = urllib.request.Request(base + "/api/sg/thumb/78?u=a", headers={"Sec-Fetch-Site": "cross-site"})
        with self.assertRaises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(req)
        self.assertEqual(e.exception.code, 403, "another site cannot embed the thumbnails")
        st = json.loads(urllib.request.urlopen(base + "/api/sg/status").read())
        self.assertTrue(st["cacheSource"], "the media cache source is named (the sidebar hides it by id)")
        self.assertEqual(a1["version"]["code"], "sh020_anim_v001")
        a3 = json.loads(urllib.request.urlopen(urllib.request.Request(base + "/api/sg/open/79", method="POST", headers={"X-Sight": "1"})).read())
        self.assertTrue(a3["asset"]["name"].endswith(".jpg"), "no uploaded movie: the Version's picture")

    def test_tracker_ui_only_while_connected(self):
        # docs/PLAN-trackers.md stage 5a: the page starts with ShotGrid disconnected (no key), connects / disconnects live
        if subprocess.run([NODE, "-e", "require('playwright')"], capture_output=True, cwd=ROOT / "tests").returncode:
            self.skipTest("Playwright is not available")
        svc = ShotGridService(self.lib.root)
        svc.configure({"site": self.site, "script": "sight", "key": "", "logins": {"Bob Smith": "bob"}, "sudo": True})
        try:
            r = subprocess.run([NODE, str(ROOT / "tests" / "trackers_e2e.cjs"), f"http://127.0.0.1:{self.port}", self.site],
                               capture_output=True, text=True, timeout=180, cwd=ROOT / "tests")
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        finally:   # the other tests of this class need it connected
            svc.configure({"site": self.site, "script": "sight", "key": "secret", "logins": {"Bob Smith": "bob"}, "sudo": True})

    def test_two_sites_in_the_browser(self):
        # docs/PLAN-trackers.md 5b-2 (4): a second ShotGrid site connected beside the first, then the first disconnected
        if subprocess.run([NODE, "-e", "require('playwright')"], capture_output=True, cwd=ROOT / "tests").returncode:
            self.skipTest("Playwright is not available")
        fake2 = subprocess.Popen([NODE, str(ROOT / "tests" / "sg_fake_server.cjs")], stdout=subprocess.PIPE, text=True)
        try:
            site2 = json.loads(fake2.stdout.readline())["site"]
            r = subprocess.run([NODE, str(ROOT / "tests" / "trackers_multi_e2e.cjs"), f"http://127.0.0.1:{self.port}", self.site, site2, self.aid],
                               capture_output=True, text=True, timeout=180, cwd=ROOT / "tests")
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertEqual(ShotGridService.slots(self.lib.root), [1, 2], "the second site in shotgrid-2.json")
        finally:   # back to one site, connected (the other tests of this class)
            fake2.terminate()
            fake2.wait(5)
            fake2.stdout.close()
            (self.lib.root / "shotgrid-2.json").unlink(missing_ok=True)
            ShotGridService(self.lib.root).configure({"site": self.site, "script": "sight", "key": "secret",
                                                     "logins": {"Bob Smith": "bob"}, "sudo": True})
            self.lib.drop_tracker_link(self.aid, "shotgrid:" + urllib.parse.urlsplit(self.site).netloc)

    def test_trackers_endpoint(self):
        got = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{self.port}/api/trackers").read())
        self.assertEqual([(t["id"], t["site"]) for t in got["trackers"]], [("shotgrid", self.site)])
        self.assertNotIn("secret", json.dumps(got))

    def test_sync_through_sight(self):
        r = subprocess.run([NODE, str(ROOT / "tests" / "sg_sight.cjs"), f"http://127.0.0.1:{self.port}", self.aid, self.site],
                           capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
