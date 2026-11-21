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
import re
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




@unittest.skipUnless(has_playwright(), "node with Playwright is not available")
class MultiClipPage(unittest.TestCase):
    """A page for two clips (review.build_html_all): replies on both come back as one bundle that
    lands on the right assets; one clip changed → a bundle of one; a clip's own reply is a package."""

    def test_two_clips(self) -> None:
        from PIL import Image

        tmp = Path(tempfile.mkdtemp(prefix="sight-mpage-"))
        try:
            media = tmp / "media"
            media.mkdir()
            Image.new("RGB", (640, 360), (40, 90, 160)).save(media / "sh010.png")
            Image.new("RGB", (640, 360), (160, 90, 40)).save(media / "sh020.png")
            lib = Library(tmp / "home")
            try:
                self.run_page(lib, media, tmp)
            finally:
                for w in list(lib._watchers.values()):
                    w.stop()
                    w.join(5)
                lib.close()
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def run_page(self, lib: Library, media: Path, tmp: Path) -> None:
        sid = lib.add_source(str(media))["id"]
        deadline = time.time() + 30
        while time.time() < deadline and len(lib.query("SELECT 1 FROM assets WHERE source_id=? AND status='ready'", (sid,))) < 2:
            time.sleep(0.2)
        assets = sorted((lib.get_asset(r["id"]) for r in lib.query("SELECT id FROM assets WHERE source_id=?", (sid,))),
                        key=lambda a: a["name"])
        self.assertEqual(len(assets), 2)
        now = int(time.time() * 1000)
        clips, notes = [], []
        for i, a in enumerate(assets):
            n = lib.add_annotation({"scope": "asset", "target_asset_id": a["id"], "kind": "note",
                                    "data": {"text": f"Fix clip {i + 1}", "author": "Desk", "created": now, "status": "open", "ctx": None}})
            notes.append(n)
            pkg = review.build_package(a, lib.annotations_for_asset(a["id"]), lib.root, "Desk", "test")
            png = (media / a["name"]).read_bytes()
            report = {"title": a["name"], "cover": "data:image/png;base64," + base64.b64encode(png).decode(), "coverSize": [640, 360],
                      "media": {"kind": "image", "w": 640, "h": 360},
                      "notes": [{"id": n["id"], "num": 1, "text": f"Fix clip {i + 1}", "author": "Desk", "date": "", "ctx": "", "shots": [], "replies": []}]}
            clips.append((report, pkg))
        page = tmp / "seq.html"
        page.write_text(review.build_html_all(clips, "test", "Sequence review — 2 clips"), encoding="utf-8")
        out = tmp / "out"
        out.mkdir()
        r = subprocess.run([NODE, str(ROOT / "tests" / "page_multi_e2e.cjs"), str(page), str(out)],
                           capture_output=True, text=True, timeout=300, cwd=ROOT / "tests")
        self.assertEqual(r.returncode, 0, r.stderr[-4000:])
        res = json.loads(r.stdout)
        self.assertEqual(res["log"], [])
        self.assertEqual(res["strip"], 2)
        self.assertEqual((res["title1"], res["title2"], res["titleBack"]), ("sh010.png", "sh020.png", "sh010.png"))
        self.assertEqual(res["mineOn2"], 0)                  # clip one's reply stays on clip one
        self.assertEqual((res["prevEnabled"], res["nextEnabled"]), (True, False))
        self.assertEqual(res["titleAfterFieldKey"], "sh020.png")  # an arrow key in a text field does not switch
        self.assertEqual(res["status2"], "3 changes · 2 clips")   # clip one: a reply + a resolve
        self.assertEqual(res["changedMarks"], 2)
        self.assertEqual(res["replyName"], "Sequence review — 2 clips - Page Tester.srev")
        self.assertEqual((res["status1"], res["mineAfterDiscard"]), ("2 changes · 1 clip", 0))  # reply + resolve on clip one
        self.assertEqual(res["mineBack"], 2)
        self.assertEqual((res["copyStrip"], res["copyMine"], res["copyStatus"]), (2, 2, "2 changes · 1 clip"))
        self.assertEqual((res["statusEnd"], res["dlEnd"], res["mineReload"]), ("No changes yet", True, 0))

        both = json.loads((out / "both.srev").read_text(encoding="utf-8"))
        self.assertEqual(both["format"], "sight-review-bundle")
        self.assertEqual(len(both["packages"]), 2)
        page_id = json.loads(re.search(r'<script id="data" type="application/json">(.*?)</script>', page.read_text(encoding="utf-8"), re.S).group(1))["bundle"]["id"]
        self.assertEqual(both["id"], page_id)               # the reply keeps the page's bundle id
        res1 = review.import_review_file(lib, (out / "both.srev").read_bytes())
        self.assertTrue(res1.get("bundle"))
        self.assertEqual([x.get("asset_id") for x in res1["results"]], [a["id"] for a in assets])
        for a, n, text in zip(assets, notes, ("Clip one answered", "Clip two answered")):
            n0 = next(x for x in lib.annotations_for_asset(a["id"]) if x["id"] == n["id"])
            self.assertEqual([x.get("text") for x in n0["data"]["replies"] if x.get("text")], [text])
        n1 = next(x for x in lib.annotations_for_asset(assets[0]["id"]) if x["id"] == notes[0]["id"])
        self.assertEqual(n1["data"]["status"], "done")
        one = json.loads((out / "one.srev").read_text(encoding="utf-8"))
        self.assertEqual([p["asset"]["id"] for p in one["packages"]], [assets[0]["id"]])
        clip = json.loads((out / "clip.srev").read_text(encoding="utf-8"))
        self.assertNotEqual(clip.get("format"), "sight-review-bundle")
        self.assertEqual(clip["asset"]["id"], assets[0]["id"])
        # Every later file re-sends what already landed: nothing new.
        for f in ("one.srev", "copy.srev"):
            rr = review.import_review_file(lib, (out / f).read_bytes())
            self.assertEqual([x["added"] for x in rr["results"]], [0], f)
        self.assertEqual(review.import_review_file(lib, (out / "clip.srev").read_bytes())["added"], 0)
        # One clip → a plain one-clip page (its reply must stay a package).
        self.assertNotIn('"bundle"', review.build_html_all(clips[:1], "test", "x").split('<script id="data"')[1].split("</script>")[0])


@unittest.skipUnless(has_playwright(), "node with Playwright is not available")
class DrawClipboard(unittest.TestCase):
    """Ctrl+C / Ctrl+X / Ctrl+V on the selected drawings of the shared drawing canvas (review-draw.js)."""

    def test_cut_copy_paste(self) -> None:
        r = subprocess.run([NODE, str(ROOT / "tests" / "draw_clip.cjs"), str(ROOT)],
                           capture_output=True, text=True, timeout=120, cwd=ROOT / "tests")
        self.assertEqual(r.returncode, 0, r.stderr[-4000:])
        res = json.loads(r.stdout)
        self.assertEqual(res["log"], [])
        self.assertEqual(res["drawn"], 1)
        self.assertTrue(res["selected"])
        self.assertEqual(res["afterShiftV"], 1)    # Ctrl+Shift+V is not a paste
        self.assertEqual(res["pasteEmpty"], 1)     # nothing copied yet
        self.assertEqual(res["afterPaste"], 2)
        self.assertEqual(res["afterPaste2"], 3)    # repeated pastes
        self.assertEqual(res["afterCut"], 2)
        self.assertEqual(res["afterCutPaste"], 3)
        self.assertEqual((res["undoPaste"], res["undoCut"], res["redone"]), (2, 3, 3))  # one undo step each
        # Cut, undo (the drawing is back), paste: a copy beside it, not an unseen twin on top.
        self.assertEqual((res["cutUndoPaste"], res["twinOff"]), (5, True))
        items = res["items"]
        self.assertEqual(len(items), 5)
        self.assertTrue(all("id" not in it for it in items))
        xs = [it["data"]["pts"][0] for it in items]
        self.assertEqual(xs, sorted(set(xs)))      # every paste steps down-right (none on top of another)
        self.assertEqual(len({it["z"] for it in items}), 5)
        # The clipboard outlives the canvas: another open pastes it, stepped on from the last paste.
        self.assertEqual(res["secondOpen"], 1)
        self.assertGreater(res["items2"][0]["data"]["pts"][0], items[4]["data"]["pts"][0])
        # The buttons (fingers): shown with the select tool only, Copy / Paste / Cut work as the keys.
        self.assertEqual((res["barSelect"], res["barBrush"]), (True, False))
        self.assertEqual((res["btnPaste"], res["btnCut"]), (2, 1))


@unittest.skipUnless(has_playwright(), "node with Playwright is not available")
class DrawLasso(unittest.TestCase):
    """0.109: the lasso's hatch width in review-core's renderer (old data unchanged) and the drawing canvas (the HTML
    page, the phone): L / Shift+W, the shared pattern icons, the hatch switch."""

    def test_lasso_and_stroke_arrows(self) -> None:
        r = subprocess.run([NODE, str(ROOT / "tests" / "draw_lasso.cjs"), str(ROOT)],
                           capture_output=True, text=True, timeout=120, cwd=ROOT / "tests")
        self.assertEqual(r.returncode, 0, r.stderr[-4000:])
        res = json.loads(r.stdout)
        self.assertEqual(res["log"], [])
        g = res["render"]
        self.assertAlmostEqual(g["oldSw"], 1.8)       # no hatchWidth: 0.18 · gap, as before
        self.assertAlmostEqual(g["zeroSw"], 1.8)      # 0 = auto
        self.assertEqual((g["newSw"], g["gridSw"]), (3, 1.5))
        self.assertEqual((g["oldDot"], g["newDot"]), (2, 3))   # dots: 0.2 · gap radius / hatchWidth diameter
        self.assertEqual((g["scaled"], g["gapScaled"]), (6, 20))  # transformItem scales it like gap
        self.assertTrue(g["icons"] and g["toolIcons"])
        self.assertGreater(g["capped"][0], 1.8)               # capped spacing → wider auto lines
        self.assertAlmostEqual(g["capped"][0], g["capped"][1])
        self.assertAlmostEqual(g["noPts"], 4)                  # dots: auto diameter 0.4 · gap
        self.assertTrue(res["lassoIcon"] and res["arrowsIcon"])
        self.assertEqual(res["patRow"], 11)           # none, solid, 8 patterns, random
        self.assertEqual((res["hatchShown"], res["hatchSolid"], res["hatchGrid"]), (True, False, True))
        self.assertEqual(res["hatchTitle"], "Hatch lines: thick")
        lasso, arrows = res["items"]
        self.assertEqual((lasso["shape_kind"], lasso["data"]["close"], lasso["data"]["pattern"]), ("brush", True, "grid"))
        self.assertAlmostEqual(lasso["data"]["hatchWidth"], lasso["data"]["gap"] * 0.18 * 2, delta=0.02)
        self.assertEqual(arrows["shape_kind"], "arrows")


if __name__ == "__main__":
    unittest.main()
