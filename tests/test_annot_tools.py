"""Sight's annotation tools in the browser (0.109): the Lasso and Stroke arrows tools, the lasso's pattern icons and
hatch line width, and drawings made before them (a brush with close = true, an arrows stroke) still selectable with
those tools' props. Runs Sight's server in-process on a temporary library with one picture; tests/annot_tools_e2e.cjs
drives the page (Chromium, Playwright).

    python -m unittest tests.test_annot_tools
"""
from __future__ import annotations

import json
import os
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.library import Library  # noqa: E402

NODE = shutil.which("node")


def has_playwright() -> bool:
    return bool(NODE) and subprocess.run([NODE, "-e", "require('playwright')"], capture_output=True,
                                         cwd=ROOT / "tests").returncode == 0


def png(w: int, h: int, rgb: tuple[int, int, int]) -> bytes:
    """A plain one-colour PNG (no imaging library needed)."""
    def chunk(t: bytes, d: bytes) -> bytes:
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@unittest.skipUnless(has_playwright(), "node with Playwright is not available")
class AnnotTools(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        import uvicorn
        from app.server import build_app

        cls.tmp = Path(tempfile.mkdtemp(prefix="sight-annot-"))
        cls.lib = Library(cls.tmp / "home")
        pics = cls.tmp / "pics"
        pics.mkdir()
        (pics / "plate.png").write_bytes(png(1200, 800, (40, 70, 110)))
        sid = cls.lib.add_source(str(pics))["id"]
        deadline = time.time() + 20
        while time.time() < deadline and not cls.lib.query("SELECT id FROM assets WHERE source_id=? AND status='ready'", (sid,)):
            time.sleep(0.1)
        cls.aid = cls.lib.query("SELECT id FROM assets WHERE source_id=?", (sid,))[0]["id"]
        now = int(time.time() * 1000)
        import math
        loop = [v for i in range(48) for v in (round(330 + 140 * math.cos(i / 48 * 6.283), 2), round(260 + 110 * math.sin(i / 48 * 6.283), 2), .5)]
        # Made before 0.109: a closed brush stroke (the old Close switch) without hatchWidth, an arrows stroke.
        for rid, sub, data in (
            ("1" * 16, "brush", {"color": "#ffd60a", "size": 4, "opacity": 1, "pressure": True, "pen": False, "pts": loop,
                                 "close": True, "pattern": "diag", "fill": "#ffd60a", "fillOpacity": 0.5, "gap": 12}),
            ("2" * 16, "arrows", {"color": "#34c759", "width": 4, "opacity": 1, "dash": "solid", "head1": "triangle", "headSize": 1,
                                  "step": 40, "len": 24, "dir": "out", "side": "left", "guide": True,
                                  "pts": [700, 600, .5, 800, 640, .5, 900, 600, .5, 1000, 640, .5]}),
        ):
            data.update({"ctx": None, "note": None, "created": now})
            cls.lib.add_annotation({"id": rid, "kind": "stroke", "shape_kind": sub, "scope": "asset", "target_asset_id": cls.aid,
                                    "data": data})
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
        for w in list(cls.lib._watchers.values()):  # (the folder watcher would see the clean-up after the close)
            w.stop()
        cls.lib.close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_tools(self) -> None:
        shots = os.environ.get("SIGHT_TEST_SHOTS", "")
        r = subprocess.run([NODE, str(ROOT / "tests" / "annot_tools_e2e.cjs"), f"http://127.0.0.1:{self.port}", self.aid, shots],
                           capture_output=True, text=True, timeout=240, cwd=ROOT / "tests")
        self.assertEqual(r.returncode, 0, r.stdout[-4000:] + r.stderr[-4000:])
        res = json.loads(r.stdout)
        self.assertEqual(res["errors"], [])
        # the toolbar: own buttons, hotkeys in the tooltip; the old Close / Stroke switches are gone
        self.assertEqual(res["toolTitles"]["lasso"][-3:], "(L)")
        self.assertTrue(res["toolTitles"]["arrows"].endswith("(Shift+W)"))
        self.assertEqual(res["brushProps"], {"seg": 0, "close": 0})
        self.assertEqual(res["arrowProps"], {"mode": 0, "step": 0})
        # the lasso tool: an icon row of patterns with Random, Lines = Auto, hidden for Solid
        self.assertEqual(res["lassoTool"]["icons"], 11)
        self.assertEqual(res["lassoTool"]["lines"], "Auto")
        self.assertFalse(res["lassoTool"]["linesSolid"])
        rows = {r["id"]: r for r in res["rows"]}
        made = [r for r in res["rows"] if r["id"] not in ("1" * 16, "2" * 16)]
        lasso = [r for r in made if r["shape_kind"] == "brush" and r["data"].get("close")]
        self.assertEqual(len(lasso), 1)
        d = lasso[0]["data"]
        self.assertEqual(d["pattern"], "grid")
        self.assertGreater(d["hatchWidth"], 0)
        self.assertAlmostEqual(d["hatchWidth"] / d["size"], 3 / 4, places=2)   # 3 px lines on a 4 px lasso, same zoom
        self.assertEqual(len([r for r in made if r["shape_kind"] == "arrows"]), 1)
        brush = [r for r in made if r["shape_kind"] == "brush" and not r["data"].get("close")]
        self.assertEqual(len(brush), 1)
        self.assertNotIn("pattern", brush[0]["data"])
        # old drawings: a closed brush shows the lasso's props, an arrows stroke the stroke arrows' props
        self.assertEqual(res["oldLasso"]["label"], "lasso")
        self.assertEqual(res["oldLasso"]["icons"], 10)          # no Random for a drawn one
        self.assertEqual(res["oldLasso"]["lines"], "Auto")
        self.assertEqual(res["oldArrows"]["label"], "arrows")
        self.assertTrue(res["oldArrows"]["step"])
        old = rows["1" * 16]["data"]
        self.assertEqual(old["pattern"], "dots")                # picked from the icon row
        self.assertNotIn("hatchWidth", old)                     # right-click → Auto removes the field
        self.assertEqual(res["oldLassoHw"] > 0, True)           # (typed before the reset)
        # a lasso + a brush selected together keep Size / Pressure; ] grows each by 1.2 from its own size, a
        # right-click resets each to its own type's default (lasso 4 px, brush 8 px)
        self.assertEqual(res["mixed"]["label"], "2 selected")
        self.assertTrue(res["mixed"]["size"] and res["mixed"]["pressure"])
        self.assertEqual(res["mixed"]["grew"], [1.2, 1.2])
        self.assertEqual(res["mixed"]["resetRatio"], 0.5)
        self.assertEqual(res["touch"]["icons"], 11)
        self.assertGreaterEqual(res["touch"]["iconSize"], 34)


if __name__ == "__main__":
    unittest.main()
