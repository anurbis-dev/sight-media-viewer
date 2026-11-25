"""Colour correction areas: Shift / Ctrl + drag from inside an area adds to / cuts from it (0.119), in Chromium."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path

from tests.test_annot_tools import NODE, ROOT, free_port, has_playwright, png
from app.library import Library


@unittest.skipUnless(has_playwright(), "node with Playwright is not available")
class GradeParts(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        import uvicorn
        from app.server import build_app

        cls.tmp = Path(tempfile.mkdtemp(prefix="sight-grade-"))
        cls.lib = Library(cls.tmp / "home")
        pics = cls.tmp / "pics"
        pics.mkdir()
        (pics / "plate.png").write_bytes(png(1200, 800, (40, 200, 60)))
        sid = cls.lib.add_source(str(pics))["id"]
        deadline = time.time() + 20
        while time.time() < deadline and not cls.lib.query("SELECT id FROM assets WHERE source_id=? AND status='ready'", (sid,)):
            time.sleep(0.1)
        cls.aid = cls.lib.query("SELECT id FROM assets WHERE source_id=?", (sid,))[0]["id"]
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
        for w in list(cls.lib._watchers.values()):
            w.stop()
        cls.lib.close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_add_cut(self) -> None:
        shots = os.environ.get("SIGHT_TEST_SHOTS", "")
        r = subprocess.run([NODE, str(ROOT / "tests" / "grade_parts_e2e.cjs"), f"http://127.0.0.1:{self.port}", self.aid, shots],
                           capture_output=True, text=True, timeout=240, cwd=ROOT / "tests")
        self.assertEqual(r.returncode, 0, r.stdout[-4000:] + r.stderr[-4000:])
        res = json.loads(r.stdout)
        self.assertEqual(res["errors"], [])
        self.assertEqual(len(res["first"]), 1)
        self.assertAlmostEqual(res["first"][0]["x1"], 500, delta=6)
        # added: still one area, one ring reaching the added box, no stored strokes, the correction kept
        a = res["added"]
        self.assertEqual(len(a), 1)
        self.assertEqual((a[0]["rings"], a[0]["parts"], a[0]["mode"], a[0]["hue"]), (1, False, "lasso", 60))
        self.assertAlmostEqual(a[0]["x1"], 750, delta=6)
        self.assertAlmostEqual(a[0]["x0"], 200, delta=6)
        # cut: a hole = a second ring
        c = res["cut"]
        self.assertEqual(len(c), 1)
        self.assertEqual((c[0]["rings"], c[0]["parts"]), (2, False))
        self.assertEqual(res["undone"][0]["rings"], 1)
        # Ctrl outside: the eraser, nothing new, the area stays
        self.assertEqual(len(res["outside"]), 1)
        self.assertEqual(res["outside"][0]["rings"], 2)
        # the bar's − (touch): a notch cut into the right part, still one area
        self.assertEqual(res["bar"], {"add": True, "sub": True})
        self.assertEqual(len(res["barCut"]), 1)
        self.assertFalse(res["barCut"][0]["parts"])


if __name__ == "__main__":
    unittest.main()
