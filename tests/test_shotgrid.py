"""ShotGrid link (docs/SHOTGRID.md): app/shotgrid.py's config store, the sync core against a fake site
(tests/sg_unit.cjs) and the whole path through Sight's server (tests/sg_sight.cjs: /api/sg/fetch adds the token,
/api/review/import merges). Needs node; the fake ShotGrid is tests/sg_fake_server.cjs. No network.

    python -m unittest tests.test_shotgrid
"""
from __future__ import annotations

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
        cls.aid = "5" * 16
        cls.lib.execute(
            "INSERT INTO assets(id, source_id, path, name, ext, kind, size, mtime, added_at, status) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (cls.aid, "src", "/clips/sh010.mp4", "sh010.mp4", ".mp4", "video", 10, 1.0, 1, "ready"),
        )
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
        cls.lib.conn.close()
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

    def test_sync_through_sight(self):
        r = subprocess.run([NODE, str(ROOT / "tests" / "sg_sight.cjs"), f"http://127.0.0.1:{self.port}", self.aid, self.site],
                           capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
