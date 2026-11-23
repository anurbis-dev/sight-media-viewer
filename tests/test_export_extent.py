"""Exported pictures widen to drawings past the frame (0.113), over the export backdrop (Auto = the frame's edge
colour, or a set colour); the review panel's video frames are stored on the server (Library.note_previews), read
back on the next opening and dropped with their note. Runs Sight's server in-process on a temporary library with a
picture and a short clip; tests/export_extent_e2e.cjs drives the page (Chromium, Playwright).

    python -m unittest tests.test_export_extent
"""
from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path

from tests.test_annot_tools import NODE, ROOT, free_port, has_playwright, png
from app.library import Library


@unittest.skipUnless(has_playwright() and shutil.which("ffmpeg"), "node with Playwright / ffmpeg not available")
class ExportExtent(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        import uvicorn
        from app.server import build_app

        cls.tmp = Path(tempfile.mkdtemp(prefix="sight-extent-"))
        cls.lib = Library(cls.tmp / "home")
        media = cls.tmp / "media"
        media.mkdir()
        (media / "a_plate.png").write_bytes(png(1200, 800, (40, 70, 110)))
        subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=25:duration=2",
                        "-pix_fmt", "yuv420p", str(media / "b_clip.mp4")], check=True)
        sid = cls.lib.add_source(str(media))["id"]
        deadline = time.time() + 30
        while time.time() < deadline and len(cls.lib.query("SELECT id FROM assets WHERE source_id=? AND status='ready'", (sid,))) < 2:
            time.sleep(0.1)
        ids = {r["name"]: r["id"] for r in cls.lib.query("SELECT id, name FROM assets WHERE source_id=?", (sid,))}
        cls.img, cls.vid = ids["a_plate.png"], ids["b_clip.mp4"]
        now = int(time.time() * 1000)
        rect = {"color": "#ff3b30", "strokeOn": True, "width": 6, "fillOn": False, "opacity": 1, "radius": 0, "rot": 0}
        add = cls.lib.add_annotation
        # The picture: a note whose rectangle reaches 200 px past the left edge.
        add({"id": "n" * 16, "kind": "note", "scope": "asset", "target_asset_id": cls.img,
             "data": {"text": "past the edge", "status": "open", "created": now, "ctx": None}})
        add({"id": "r" * 16, "kind": "shape", "shape_kind": "rect", "scope": "asset", "target_asset_id": cls.img,
             "data": {**rect, "x": -200, "y": 100, "w": 500, "h": 300, "note": "n" * 16, "ctx": None, "created": now}})
        # The clip: a note on 0.5 s with a rectangle inside the frame.
        add({"id": "m" * 16, "kind": "note", "scope": "asset", "target_asset_id": cls.vid,
             "data": {"text": "frame note", "status": "open", "created": now, "ctx": {"t": 0.5}}})
        add({"id": "s" * 16, "kind": "shape", "shape_kind": "rect", "scope": "asset", "target_asset_id": cls.vid,
             "data": {**rect, "x": 100, "y": 100, "w": 200, "h": 100, "note": "m" * 16, "ctx": {"t": 0.5}, "created": now}})
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

    def test_library_store(self) -> None:
        lib = self.lib
        v = lib.note_previews(self.img)["v"]
        self.assertTrue(v)
        self.assertFalse(lib.save_note_preview(self.img, "bad_key", b"\xff\xd8x", v))   # "_" is not a key character
        self.assertFalse(lib.save_note_preview(self.img, "k1", b"not a jpeg", v))
        self.assertFalse(lib.save_note_preview(self.img, "k1", b"\xff\xd8one", "1_2"))  # made from another version
        self.assertTrue(lib.save_note_preview(self.img, "k1", b"\xff\xd8one", v))
        self.assertTrue(lib.save_note_preview(self.img, "k2", b"\xff\xd8two", v))
        self.assertEqual(lib.note_previews(self.img)["keys"], ["k1", "k2"])
        self.assertEqual(lib.note_preview_path(self.img, "k1").read_bytes(), b"\xff\xd8one")
        # an id that is no asset (or a glob) prunes nothing
        self.assertEqual(lib.prune_note_previews("*", []), 0)
        self.assertEqual(lib.prune_note_previews("0" * 16, []), 0)
        self.assertEqual(lib.prune_note_previews(self.img, ["k2"]), 1)
        self.assertEqual(lib.note_previews(self.img)["keys"], ["k2"])
        # a stored preview of an older version of the file is stale: dropped by the next listing
        stale = lib.thumbs / "nprev" / f"{self.img}_1_2_k9.jpg"
        stale.write_bytes(b"\xff\xd8old")
        self.assertEqual(lib.note_previews(self.img)["keys"], ["k2"])
        self.assertFalse(stale.exists())
        lib.prune_note_previews(self.img, [])

    def test_page(self) -> None:
        r = subprocess.run([NODE, str(ROOT / "tests" / "export_extent_e2e.cjs"), f"http://127.0.0.1:{self.port}", self.img, self.vid],
                           capture_output=True, text=True, timeout=240, cwd=ROOT / "tests")
        self.assertEqual(r.returncode, 0, r.stdout[-4000:] + r.stderr[-4000:])
        res = json.loads(r.stdout)
        self.assertEqual(res["errors"], [])
        # 1200 x 800 frame, rectangle from x = -203 (half its 6 px line): 203 + 3% of 1200 (36) added on the left only
        self.assertEqual(res["auto"]["size"], [1439, 800])
        self.assertEqual(res["auto"]["margin"], [40, 70, 110])     # Auto: the frame's edge colour
        self.assertEqual(res["auto"]["frame"], [40, 70, 110])
        self.assertEqual(res["color"]["margin"], [0, 255, 0])      # a set colour
        self.assertTrue(res["autoOn"] and res["colorOn"])
        # the clip's frame: made once and stored, then read back from the store; gone with its note
        self.assertEqual(res["stored"], ["f0.500"])
        self.assertTrue(res["second"].startswith("/api/review/nprev/"), res["second"])
        self.assertLessEqual(max(res["previewSize"]), 360)
        self.assertTrue(res["first"].startswith("data:image/jpeg"))   # made here the first time
        self.assertEqual(res["regen"], ["f0.500"])                    # a stored file gone: made and stored again
        self.assertEqual(res["afterDelete"], [])


if __name__ == "__main__":
    unittest.main()
