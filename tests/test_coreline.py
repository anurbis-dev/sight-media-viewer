"""Coreline link (docs/CORELINE.md, docs/PLAN-coreline.md R4): app/coreline.py's config store and pass-through, the
registry, thumbnails / filmstrip / opening a Version through Sight's routes, the sync through Sight's server
(tests/cl_sight.cjs) and the browser (tests/cl_view_e2e.cjs). The fake Coreline is tests/cl_fake_server.cjs (shaped
as Coreline main's API, merging with review-core.js mergeRows). Needs node; no network.

    python -m unittest tests.test_coreline
"""
from __future__ import annotations

import io
import json
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.coreline import ClError, CorelineService  # noqa: E402
from app.library import Library  # noqa: E402
from app.trackers import Trackers  # noqa: E402

NODE = shutil.which("node")


class ConfigTest(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = Path(tempfile.mkdtemp())
        self.cl = CorelineService(self.dir)

    def tearDown(self) -> None:
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_store(self):
        self.assertFalse(self.cl.status()["configured"])
        self.assertIsNone(self.cl.tracker())
        self.assertFalse(self.cl.configure({"site": "http://studio.example"}))   # plain http only on this machine
        self.assertFalse(self.cl.configure({"site": "https://u:p@studio.example"}))
        self.assertFalse(self.cl.configure({"site": "https://studio.example/x"}))
        self.assertFalse(self.cl.configure({"site": "studio.example", "key": "has space"}))
        self.assertFalse(self.cl.configure({"site": "studio.example", "cacheLimitGB": -1}))
        self.assertTrue(self.cl.configure({"site": "Studio.Example/", "key": " k1 "}))
        st = self.cl.status()
        self.assertEqual((st["configured"], st["site"], st["hasKey"]), (True, "https://studio.example", True))
        self.assertNotIn("k1", json.dumps(st), "the key never reaches the page")
        self.assertEqual(self.cl.tracker()["key"], "coreline:studio.example")
        self.assertEqual(oct(self.cl.path.stat().st_mode & 0o777), "0o600")
        ident = st["ident"]
        self.assertTrue(self.cl.configure({"site": "https://studio.example"}))          # no key given: kept
        self.assertTrue(self.cl.status()["hasKey"])
        self.assertTrue(self.cl.configure({"site": "https://studio.example", "key": "k2"}))
        self.assertNotEqual(self.cl.status()["ident"], ident, "another key: another connection")
        self.assertTrue(self.cl.configure({"site": "https://other.example"}))           # another server: key dropped
        self.assertFalse(self.cl.status()["hasKey"])
        self.assertTrue(self.cl.configure({"site": "https://other.example", "key": ""}))
        self.assertFalse(self.cl.status()["configured"])
        with self.assertRaises(ClError):
            CorelineService(self.dir, 2).configure({"site": "", "key": "x"})   # a second slot needs a server
        with self.assertRaises(ClError) as e:
            self.cl.configure({"site": "https://studio.example", "key": "x"}, taken={"coreline:studio.example"})
        self.assertEqual(e.exception.status, 409)

    def test_media_ids_and_guards(self):
        self.assertEqual(CorelineService.parse_media_id("version:21:media"), ("version", 21, "media"))
        for bad in ("21", "version:0:media", "Version:1:media", "version:1:media/../x", "version:1:", "x" * 70 + ":1:m"):
            with self.assertRaises(ClError):
                CorelineService.parse_media_id(bad)
        with self.assertRaises(ClError) as e:
            self.cl.forward("GET", "https://studio.example/api/schema", None, {})
        self.assertEqual(e.exception.status, 412, "not connected")
        self.cl.configure({"site": "https://studio.example", "key": "k"})
        for m, url in (("POST", "https://studio.example/api/auth/api-keys"), ("GET", "https://studio.example/api/auth/api-keys"),
                       ("GET", "https://studio.example/api/%61uth/login"), ("POST", "https://studio.example/api/auth/me"),
                       ("GET", "https://studio.example/api/x/../auth/api-keys"), ("POST", "https://studio.example/api/schema/%2e%2e/auth/api-keys"),
                       ("GET", "https://studio.example/api//auth/api-keys"), ("GET", "https://studio.example/api/x/..%2fauth/api-keys"),
                       ("GET", "https://studio.example/API/Auth/api-keys"),
                       ("GET", "http://elsewhere.example/x")):
            with self.assertRaises(ClError) as e:
                self.cl.forward(m, url, None, {})
            self.assertEqual(e.exception.status, 400, (m, url))

    def test_registry(self):
        t = Trackers(self.dir)
        self.assertEqual(t.kinds, [{"id": "shotgrid", "name": "ShotGrid"}, {"id": "coreline", "name": "Coreline"}])
        self.assertIsInstance(t.get("coreline"), CorelineService)
        self.cl.configure({"site": "https://cl.example", "key": "k"})
        self.assertEqual([x["key"] for x in t.connected()], ["coreline:cl.example"])
        self.assertIs(t.by_key("coreline:cl.example").kind, "coreline")
        self.assertNotEqual(t.get("coreline").media_dir(), t.get("shotgrid").media_dir(), "a media cache of its own")

    def test_strip(self):
        from PIL import Image
        sprite = Image.new("RGB", (480, 272))
        for i, c in enumerate([(255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 0)]):
            sprite.paste(Image.new("RGB", (240, 136), c), ((i % 2) * 240, (i // 2) * 136))
        buf = io.BytesIO(); sprite.save(buf, "PNG")
        out = CorelineService._strip(buf.getvalue(), {"frames": 3, "columns": 2, "rows": 2, "tileWidth": 240, "tileHeight": 136})
        im = Image.open(io.BytesIO(out)).convert("RGB")
        self.assertEqual(im.size, (720, 136), "3 frames in one row (the 4th tile is unused)")
        self.assertEqual([tuple(round(v / 255) for v in im.getpixel((120 + 240 * i, 68))) for i in range(3)], [(1, 0, 0), (0, 1, 0), (0, 0, 1)])
        self.assertIsNone(CorelineService._strip(b"junk", {"columns": 2, "rows": 1}))


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

        cls.tmp = Path(tempfile.mkdtemp(prefix="sight-cl-"))
        cls.fake = subprocess.Popen([NODE, str(ROOT / "tests" / "cl_fake_server.cjs")], stdout=subprocess.PIPE, text=True)
        cls.site = json.loads(cls.fake.stdout.readline())["site"]
        cls.lib = Library(cls.tmp / "home")
        clips = cls.tmp / "clips"
        clips.mkdir()
        from PIL import Image
        Image.new("RGB", (64, 36), (200, 60, 60)).save(clips / "sh010_comp_v001.png")   # (the Version's original size)
        sid = cls.lib.add_source(str(clips))["id"]
        deadline = time.time() + 20
        while time.time() < deadline and not cls.lib.query("SELECT id FROM assets WHERE source_id=? AND status='ready'", (sid,)):
            time.sleep(0.1)
        cls.aid = cls.lib.query("SELECT id FROM assets WHERE source_id=?", (sid,))[0]["id"]
        now = int(time.time() * 1000)
        cls.lib.add_annotation({"id": "a" * 16, "kind": "note", "scope": "asset", "target_asset_id": cls.aid,
                                "data": {"text": "Mine", "author": "Bob Smith", "created": now - 60000, "status": "open", "status_at": now - 60000,
                                         "edited_at": now - 60000, "ctx": None, "shots": ["5ba7000000000001"], "replies": []}})
        CorelineService(cls.lib.root).configure({"site": cls.site, "key": "clkey"})
        cls.port = free_port()
        cls.server = uvicorn.Server(uvicorn.Config(build_app(cls.lib), host="127.0.0.1", port=cls.port, log_level="warning"))
        cls.thread = threading.Thread(target=cls.server.run, daemon=True)
        cls.thread.start()
        for _ in range(100):
            if cls.server.started:
                break
            time.sleep(0.05)
        cls.base = f"http://127.0.0.1:{cls.port}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.should_exit = True
        cls.thread.join(5)
        cls.fake.terminate()
        cls.fake.wait(5)
        cls.fake.stdout.close()
        for w in list(cls.lib._watchers.values()):
            w.stop()
            w.join(5)
        cls.lib.close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def _post(self, path: str) -> dict:
        return json.loads(urllib.request.urlopen(urllib.request.Request(self.base + path, method="POST", headers={"X-Sight": "1"})).read())

    def test_trackers_endpoint(self):
        got = json.loads(urllib.request.urlopen(self.base + "/api/trackers").read())
        self.assertIn(("coreline", self.site), [(t["kind"], t["site"]) for t in got["trackers"]])
        self.assertIn({"id": "coreline", "name": "Coreline"}, got["kinds"])
        self.assertNotIn("clkey", json.dumps(got))

    def test_thumbs_and_open(self):
        r = urllib.request.urlopen(self.base + "/api/trackers/coreline/thumb/version:21:media?u=a")
        self.assertEqual((r.status, r.headers.get("Content-Type")), (200, "image/webp"), "the thumb rendition")
        r = urllib.request.urlopen(self.base + "/api/trackers/coreline/thumb/version:22:media?pic=filmstrip&u=a")
        self.assertEqual((r.status, r.headers.get("Content-Type")), (200, "image/jpeg"))
        from PIL import Image
        self.assertEqual(Image.open(io.BytesIO(r.read())).size, (480, 136), "the scrub sprite as a 2-frame filmstrip")
        self.assertEqual(urllib.request.urlopen(self.base + "/api/trackers/coreline/thumb/version:21:media?pic=filmstrip&u=a").status, 204,
                         "an image has no scrub sprite")
        with self.assertRaises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(self.base + "/api/trackers/coreline/thumb/version:1:media/x")
        self.assertEqual(e.exception.code, 404)
        a1 = self._post("/api/trackers/coreline/open/version:21:media")
        self.assertEqual(Path(a1["asset"]["path"]).name, "sh010_comp_v001__c21.png", "the original, by its own name")
        self.assertEqual((a1["record"]["source"], a1["record"]["scaled"], a1["record"]["field"]), ("original", False, "media"))
        self.assertEqual(a1["record"]["fields"]["code"], "sh010_comp_v001")
        self.assertNotIn("urls", a1["record"]["file"], "no signed links in the answer")
        a2 = self._post("/api/trackers/coreline/open/version:21:media")
        self.assertEqual(a1["asset"]["id"], a2["asset"]["id"], "opened twice: one file, one asset")
        a3 = self._post("/api/trackers/coreline/open/version:23:media")
        self.assertEqual((a3["record"]["source"], a3["record"]["scaled"]), ("web", True), "no original: the scaled web preview")
        self.assertTrue(a3["asset"]["name"].endswith(".web.webp"))
        st = json.loads(urllib.request.urlopen(self.base + "/api/trackers/coreline/status").read())
        self.assertTrue(st["cacheSource"])
        self.assertTrue(Path(a1["asset"]["path"]).is_relative_to(Path(st["cacheDir"])))

    def test_sync_through_sight(self):
        r = subprocess.run([NODE, str(ROOT / "tests" / "cl_sight.cjs"), self.base, self.aid, self.site],
                           capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_browser(self):
        if subprocess.run([NODE, "-e", "require('playwright')"], capture_output=True, cwd=ROOT / "tests").returncode:
            self.skipTest("Playwright is not available")
        svc = CorelineService(self.lib.root)
        svc.configure({"site": self.site, "key": ""})   # the test connects it through Settings → Trackers
        try:
            r = subprocess.run([NODE, str(ROOT / "tests" / "cl_view_e2e.cjs"), self.base, self.site],
                               capture_output=True, text=True, timeout=240, cwd=ROOT / "tests")
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        finally:
            svc.configure({"site": self.site, "key": "clkey"})


if __name__ == "__main__":
    unittest.main()
