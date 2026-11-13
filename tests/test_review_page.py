"""The HTML reviewer page round trip: Sight exports a review page, a reviewer answers on it (a reply
with text, a picture and a drawing, a resolve, a new note drawn on the picture) and downloads the
reply; Sight merges it. Nothing may get lost on the way — the pictures above all.

    python -m unittest tests.test_review_page

Needs node with Playwright (tests/page_e2e.cjs); skipped otherwise. Runs on temp folders.
"""
from __future__ import annotations

import base64
import io
import json
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from app import review  # noqa: E402
from app.library import Library  # noqa: E402
from test_pwa import NODE, has_playwright, sight_import  # noqa: E402


@unittest.skipUnless(has_playwright(), "node with Playwright is not available")
class PageRoundTrip(unittest.TestCase):
    def test_round_trip(self) -> None:
        from PIL import Image, ImageDraw

        tmp = Path(tempfile.mkdtemp(prefix="sight-page-"))
        try:
            media = tmp / "media"
            media.mkdir()
            im = Image.new("RGB", (1200, 800), (40, 90, 160))
            ImageDraw.Draw(im).rectangle([200, 200, 500, 500], fill=(220, 180, 40))
            im.save(media / "plate_v001.png")
            att = tmp / "attach.png"
            Image.new("RGB", (300, 200), (200, 40, 40)).save(att)
            lib = Library(tmp / "home")
            try:
                self.run_trip(lib, media, att, tmp)
            finally:
                for w in list(lib._watchers.values()):
                    w.stop()
                    w.join(5)
                lib.close()
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def run_trip(self, lib: Library, media: Path, att: Path, tmp: Path) -> None:
        sid = lib.add_source(str(media))["id"]
        deadline = time.time() + 30
        while time.time() < deadline and not lib.query("SELECT 1 FROM assets WHERE source_id=? AND status='ready'", (sid,)):
            time.sleep(0.2)
        a = lib.get_asset(lib.query("SELECT id FROM assets WHERE source_id=?", (sid,))[0]["id"])
        png = (media / "plate_v001.png").read_bytes()
        shot = review.save_shot(lib.root, png)
        now = int(time.time() * 1000)
        note = lib.add_annotation({"scope": "asset", "target_asset_id": a["id"], "kind": "note",
                                   "data": {"text": "Box the square", "author": "Desk", "created": now, "status": "open", "ctx": None, "shots": [shot]}})
        lib.add_annotation({"scope": "asset", "target_asset_id": a["id"], "kind": "shape", "shape_kind": "rect",
                            "x": 200, "y": 200, "w": 300, "h": 300,
                            "data": {"color": "#ff3b30", "strokeOn": True, "width": 6, "dash": "solid", "fillOn": False, "fill": "#ff3b30", "fillOpacity": 0.2,
                                     "radius": 0, "opacity": 1, "x": 200, "y": 200, "w": 300, "h": 300, "rot": 0, "note": note["id"], "ctx": None}})
        pkg = review.build_package(a, lib.annotations_for_asset(a["id"]), lib.root, "Desk", "test")
        self.assertIn(shot, pkg["shots"])
        url = "data:image/png;base64," + base64.b64encode(png).decode()
        report = {"title": "Review", "cover": url, "coverSize": [1200, 800], "media": {"kind": "image", "w": 1200, "h": 800},
                  "notes": [{"id": note["id"], "num": 1, "text": "Box the square", "author": "Desk", "date": "", "ctx": "", "shots": [shot], "replies": []}]}
        page = tmp / "page.html"
        page.write_text(review.build_html(report, pkg), encoding="utf-8")
        out = tmp / "reply.srev"
        copy = tmp / "page copy.html"
        r = subprocess.run([NODE, str(ROOT / "tests" / "page_e2e.cjs"), str(page), str(out), str(att), str(copy)],
                           capture_output=True, text=True, timeout=300, cwd=ROOT / "tests")
        self.assertEqual(r.returncode, 0, r.stderr[-4000:])
        res = json.loads(r.stdout)
        self.assertEqual(res["log"], [])
        self.assertEqual(res["coverOverlay"], 0)   # the picture on top is the original
        self.assertEqual(res["canvasBase"], 0)     # new notes / replies are drawn on the clean picture
        self.assertEqual(res["replyPics"], 2)      # the attached picture and the drawing
        # The downloaded page opens with the same edits: the reply, its two pictures, the new note.
        self.assertEqual(res["copyReplies"], res["replyCount"])
        self.assertEqual(res["copyNew"], 1)
        self.assertEqual(res["copyReplyPics"], 2)

        got, stats = sight_import(lib, out.read_bytes())
        self.assertEqual(got["id"], a["id"])
        rows = lib.annotations_for_asset(a["id"])
        n0 = next(x for x in rows if x["id"] == note["id"])
        self.assertEqual(n0["data"]["status"], "done")
        self.assertEqual(n0["data"]["shots"], [shot])
        rep = next(x for x in n0["data"]["replies"] if x.get("text"))
        self.assertEqual(rep["author"], "Page Tester")
        self.assertEqual(len(rep["shots"]), 1)
        self.assertIsNotNone(review.shot_path(lib.root, rep["shots"][0]))
        rdraw = [x for x in rows if x["kind"] == "shape" and (x["data"] or {}).get("reply") == rep["id"]]
        self.assertEqual(len(rdraw), 1)
        self.assertEqual(rdraw[0]["data"]["note"], note["id"])
        new = next(x for x in rows if x["kind"] == "note" and x["data"]["text"] == "New from the page")
        self.assertTrue(any(x["kind"] == "shape" and x["shape_kind"] == "arrow" and x["data"]["note"] == new["id"] for x in rows))
        # Sight's next package carries every picture: the note's and the reply's.
        pkg2 = review.build_package(a, rows, lib.root, "Desk", "test")
        self.assertIn(shot, pkg2["shots"])
        self.assertIn(rep["shots"][0], pkg2["shots"])
        # Merging the same reply again changes nothing.
        self.assertEqual(sight_import(lib, out.read_bytes())[1]["added"], 0)
        # The reply file sent from the downloaded page merges the same way.
        self.assertEqual(sight_import(lib, Path(str(copy) + ".srev").read_bytes())[1]["added"], 0)


if __name__ == "__main__":
    unittest.main()
