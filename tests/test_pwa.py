"""The phone app (mobile/, docs/PLAN-mobile.md stage 3): build, logic, and the round trip with Sight.

    python -m unittest tests.test_pwa

- build: tools/build_pwa.py fills every placeholder and the service worker caches every file.
- unit: tests/pwa_unit.cjs (node) — model, MP4 frame rate, PDF writer; the PDF opens in PyMuPDF.
- round trip (node + Playwright's Chromium; ffmpeg for the video part): the app reviews a picture
  and a video and exports .srev / PDF / HTML (tests/pwa_e2e.cjs make); Sight's own import
  (Library.import_annotations, as /api/review/import does it) finds the files by name + size and
  merges every note, reply, picture, drawing and the review state; Sight answers, and the app
  merges Sight's package back (tests/pwa_e2e.cjs merge). Everything runs on temp folders.
Skipped parts say why (no node / Playwright / ffmpeg).
"""
from __future__ import annotations

import functools
import http.server
import json
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))

import build_pwa  # noqa: E402
from app import review  # noqa: E402
from app.library import Library  # noqa: E402

NODE = shutil.which("node")


def has_playwright() -> bool:
    if not NODE:
        return False
    r = subprocess.run([NODE, "-e", "require('playwright')"], capture_output=True, cwd=ROOT / "tests")
    return r.returncode == 0


def sight_import(lib: Library, raw: bytes) -> tuple[dict, dict]:
    """What POST /api/review/import does with a package."""
    pkg = review.parse_package(raw)
    meta = pkg["asset"]
    rows = [r for r in pkg["annotations"] if isinstance(r, dict)]
    a = lib.get_asset(str(meta["id"])) if meta.get("id") else None
    a = a if a and a.get("status") == "ready" else None
    a = a or lib.asset_holding_annotations([str(r.get("id")) for r in rows]) or lib.match_review_asset(meta)
    if not a:
        raise AssertionError(f"Sight found no asset for {meta.get('name')}")
    shot_map = {}
    for sid, url in (pkg.get("shots") or {}).items():
        data = review.decode_data_url(url)
        if data:
            shot_map[str(sid)] = review.put_shot(lib.root, str(sid), data)
    return a, lib.import_annotations(a["id"], rows, pkg.get("deleted") or [], shot_map)


class Build(unittest.TestCase):
    def test_build(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "pwa"
            version = build_pwa.build(out)
            self.assertTrue(version.startswith(build_pwa.app_version() + "-"))
            sw = (out / "sw.js").read_text(encoding="utf-8")
            index = (out / "index.html").read_text(encoding="utf-8")
            self.assertNotIn("%%", sw + index)
            self.assertIn(version, sw)
            self.assertIn(version, index)
            files = json.loads(sw.split("var FILES = ", 1)[1].split(";\n", 1)[0])
            on_disk = {p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_file()} - {"sw.js", ".nojekyll"}
            self.assertEqual(set(files) - {"./"}, on_disk)
            for f in ("core/review-core.js", "core/review-draw.js", "core/keys.js", "manifest.webmanifest", "icons/icon-512.png"):
                self.assertIn(f, files)
            json.loads((out / "manifest.webmanifest").read_text(encoding="utf-8"))


@unittest.skipUnless(NODE, "node is not installed")
class Unit(unittest.TestCase):
    def test_unit(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            pdf = Path(tmp) / "unit.pdf"
            r = subprocess.run([NODE, str(ROOT / "tests" / "pwa_unit.cjs"), str(pdf)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
            import pymupdf

            doc = pymupdf.open(str(pdf))
            self.assertEqual(doc.page_count, 2)
            self.assertEqual(doc.metadata["title"], "Review — небо 空")
            self.assertEqual(len(doc[0].get_images()), 1)
            doc.close()


@unittest.skipUnless(has_playwright(), "node with Playwright is not available")
class RoundTrip(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = Path(tempfile.mkdtemp(prefix="sight-pwa-"))
        site, media = cls.tmp / "site", cls.tmp / "media"
        media.mkdir()
        build_pwa.build(site)
        from PIL import Image, ImageDraw

        im = Image.new("RGB", (1920, 1080), (60, 120, 200))
        ImageDraw.Draw(im).ellipse([700, 300, 1200, 800], fill=(250, 200, 40))
        im.save(media / "shot_v001.png")
        cls.video = bool(shutil.which("ffmpeg"))
        if cls.video:  # VP9: Playwright's Chromium has no H.264
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=24:duration=4",
                            "-c:v", "libvpx-vp9", "-b:v", "300k", str(media / "clip_v001.webm")], check=True)
        class Quiet(build_pwa._Handler):
            def log_message(self, *a) -> None:
                pass

        cls.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(site)))
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.srv.server_address[1]}/"
        cls.media = media
        cls.home = cls.tmp / "home"
        cls.home.mkdir()
        cls.lib = Library(cls.home)
        sid = cls.lib.add_source(str(media))["id"]
        deadline = time.time() + 30
        while time.time() < deadline:
            n = cls.lib.query("SELECT COUNT(*) AS n FROM assets WHERE source_id=? AND status='ready'", (sid,))[0]["n"]
            if n >= (2 if cls.video else 1):
                break
            time.sleep(0.2)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.srv.shutdown()
        for w in list(cls.lib._watchers.values()):  # the folder watcher would outlive the database
            w.stop()
            w.join(5)
        cls.lib.close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def e2e(self, *args: str) -> dict:
        r = subprocess.run([NODE, str(ROOT / "tests" / "pwa_e2e.cjs"), *args], capture_output=True, text=True, timeout=600, cwd=ROOT / "tests")
        self.assertEqual(r.returncode, 0, r.stderr[-4000:])
        res = json.loads(r.stdout)
        self.assertEqual(res.pop("log"), [])
        return res

    def test_round_trip(self) -> None:
        out = self.tmp / "out"
        out.mkdir()
        res = self.e2e("make", self.base, str(self.media), str(out))
        # The app's own state.
        rows = res["imageRows"]
        notes = [r for r in rows if r["kind"] == "note"]
        self.assertEqual(len(notes), 2)
        first = next(n for n in notes if n["data"]["text"].startswith("Sky"))
        self.assertEqual(first["data"]["status"], "done")
        reply = next(x for x in first["data"]["replies"] if not x.get("event"))
        self.assertEqual(reply["author"], "Phone Tester")
        self.assertEqual(len(reply["shots"]), 1)
        self.assertEqual(sum(1 for r in rows if r["kind"] == "shape"), 1)
        text = next(r for r in rows if r["kind"] == "text")
        self.assertEqual(text["data"]["text"], "Lift\nсюда")
        self.assertEqual(text["data"]["note"], next(n for n in notes if n["data"]["text"] == "Box this")["id"])
        self.assertEqual(res["reopenedNotes"], 2)
        self.assertEqual((res["reopenedFile"], res["reopenedPicker"]), (True, 0))
        if self.video:
            self.assertTrue(res["reopenedVideo"])
        self.assertEqual(res["listed"], 2 if self.video else 1)
        for f in ("app_image.pdf", "app_image.html", "app_image.srev"):
            self.assertGreater((out / f).stat().st_size, 1000, f)
        import pymupdf

        doc = pymupdf.open(str(out / "app_image.pdf"))
        self.assertGreaterEqual(doc.page_count, 1)
        self.assertGreaterEqual(len(doc[0].get_images()), 1)
        doc.close()
        page = (out / "app_image.html").read_text(encoding="utf-8")
        self.assertIn("Sky too dark — небо темнее", page)
        self.assertNotIn("<script", page)

        # Sight imports the picture review by name + size.
        a, stats = sight_import(self.lib, (out / "app_image.srev").read_bytes())
        self.assertEqual(a["name"], "shot_v001.png")
        self.assertEqual(stats["added"], len(rows))
        srows = self.lib.annotations_for_asset(a["id"])
        snote = next(r for r in srows if r["kind"] == "note" and r["data"]["text"].startswith("Sky"))
        self.assertEqual(snote["data"]["status"], "done")
        sid = next(x for x in snote["data"]["replies"] if not x.get("event"))["shots"][0]
        self.assertIsNotNone(review.shot_path(self.lib.root, sid))
        status = next(r for r in srows if r["kind"] == "status")
        self.assertEqual(status["data"]["state"], "changes")
        self.assertEqual(next(r for r in srows if r["kind"] == "text")["data"]["text"], "Lift\nсюда")
        rect = next(r for r in srows if r["kind"] == "shape")
        self.assertTrue(500 < rect["data"]["x"] < 960 < rect["data"]["x"] + rect["data"]["w"] < 1500, rect["data"])
        # Importing it again changes nothing.
        self.assertEqual(sight_import(self.lib, (out / "app_image.srev").read_bytes())[1]["added"], 0)

        if self.video:
            self.assertIn("f 5", res["tcAfter5"])
            self.assertAlmostEqual(res["fps"], 24, delta=0.05)
            self.assertGreater(res["scrubbed"][0], 0.6)  # on from 0.5 s, forward
            self.assertLess(res["scrubbed"][0], 4.0)
            self.assertTrue(res["scrubbed"][1])  # scrubbing pauses
            self.assertEqual((res["overlayAt1"] > 0, res["overlayAt3"]), (True, 0))
            vrows = res["videoRows"]
            vnote = next(r for r in vrows if r["kind"] == "note")
            self.assertEqual(vnote["data"]["ctx"], {"t": 1, "hold": 0})
            rdraw = next(r for r in vrows if r["kind"] == "shape" and r["data"].get("reply"))
            self.assertEqual(rdraw["data"]["ctx"], {"t": 1, "hold": 0})
            self.assertEqual(rdraw["data"]["note"], vnote["id"])
            va, vstats = sight_import(self.lib, (out / "app_video.srev").read_bytes())
            self.assertEqual(va["name"], "clip_v001.webm")
            self.assertEqual(vstats["added"], 3)
            doc = pymupdf.open(str(out / "app_video.pdf"))
            self.assertGreaterEqual(len(doc[0].get_images()), 1)
            doc.close()
            # The report: the note's frame without the reply's drawing, the reply with its own picture
            # of that frame (only its drawing).
            vpage = (out / "app_video.html").read_text(encoding="utf-8")
            self.assertEqual(vpage.count("<img"), 2, vpage.count("<img"))

        # Sight answers: a reply on the first note and a new note; the package goes to the phone.
        now = int(time.time() * 1000)
        cur = self.lib.annotations_for_asset(a["id"])
        n0 = next(r for r in cur if r["kind"] == "note" and r["data"]["text"].startswith("Sky"))
        d = dict(n0["data"])
        d["replies"] = list(d.get("replies") or []) + [{"id": "5e5e5e5e5e5e5e5e", "text": "From Sight", "author": "Desk", "created": now}]
        self.lib.update_annotation(n0["id"], {"data": d})
        self.lib.add_annotation({"scope": "asset", "target_asset_id": a["id"], "kind": "note",
                                 "data": {"text": "Sight note", "author": "Desk", "created": now, "status": "open", "ctx": None, "shots": []}})
        pkg = review.build_package(a, self.lib.annotations_for_asset(a["id"]), self.lib.root, "Desk", "test")
        sight_srev = out / "sight.srev"
        sight_srev.write_text(json.dumps(pkg), encoding="utf-8")
        back = self.e2e("merge", self.base, str(sight_srev), str(self.media))
        self.assertEqual(back["picker"], 1)
        self.assertIn("Merged the review from Desk", back["toast1"])
        self.assertIn("Already up to date", back["toast2"])
        self.assertEqual(back["listed"], 1)
        live = [r for r in back["rows"] if r.get("deleted_at") is None]
        texts = sorted(r["data"]["text"] for r in live if r["kind"] == "note")
        self.assertEqual(texts, ["Box this", "Local note on the phone", "Sight note", "Sky too dark — небо темнее"])
        bnote = next(r for r in live if r["kind"] == "note" and r["data"]["text"].startswith("Sky"))
        self.assertIn("From Sight", [x.get("text") for x in bnote["data"]["replies"]])


    def test_touch(self) -> None:
        if not self.video:
            self.skipTest("ffmpeg is not installed (no test clip)")
        r = subprocess.run([NODE, str(ROOT / "tests" / "pwa_touch.cjs"), self.base, str(self.media / "clip_v001.webm")],
                           capture_output=True, text=True, timeout=300, cwd=ROOT / "tests")
        self.assertEqual(r.returncode, 0, r.stderr[-4000:])
        res = json.loads(r.stdout)
        self.assertEqual(res["log"], [])
        self.assertEqual((res["newbarClosed"], res["stateControl"]), ("hidden", 0))
        # Play after a scrub / queued steps starts from the frame asked for, not the older position.
        self.assertFalse(res["playFrom"][1])
        self.assertGreaterEqual(res["playFrom"][0], res["scrubbedTo"] - 0.02)
        self.assertFalse(res["stepPlay"][1])
        self.assertGreaterEqual(res["stepPlay"][0], res["stepAsked"] - 0.02)
        self.assertGreater(res["pv"]["z"], 1.5)
        self.assertGreater(abs(res["pv"]["r"]), 5)
        self.assertTrue(res["fitShown"])
        self.assertLess(res["centreShift"], 2)
        self.assertAlmostEqual(res["canvasScale"], res["pv"]["z"], delta=0.01)
        # The canvas pinched below fit and turned a bit: back to fit, straight (Fit hidden).
        self.assertEqual((res["canvasSettle"][0] - round(res["canvasRot0"] / 90) * 90) % 360, 0)  # its nearest quarter
        self.assertEqual(res["canvasSettle"][2], "")  # the ease is over (no lag on the next gesture)
        self.assertTrue(res["canvasSettle"][1])
        self.assertTrue(res["preview"][0])
        self.assertGreater(res["brush"][1], res["brush"][0])
        self.assertEqual(res["itemsAfterHold"], 0)  # the hold's dot is dropped
        self.assertEqual(res["undoRedo"], [1, 0, 1])
        self.assertEqual(res["brushReset"], [6, True, 1])
        # Hold + drag sideways: the tool's opacity (not its size), shown in the preview; nothing drawn.
        self.assertEqual(res["opac"][0], 1)
        self.assertLess(res["opac"][1], 0.9)
        self.assertEqual(res["opac"][2:], [True, True, 0])
        # Tool down: a tap plays inside the canvas (live layer), a tap pauses on a later frame.
        self.assertTrue(res["toolOff"])
        self.assertEqual(res["livePlay"], [True, True])
        self.assertTrue(res["livePause"][0])
        self.assertFalse(res["livePause"][1])
        self.assertGreater(res["livePause"][2], 0.1)
        self.assertEqual(res["drawnFrames"], 2)
        self.assertEqual(res["atEnd"], [True, "", False])
        self.assertAlmostEqual(res["pvBack"]["z"], res["pv"]["z"], delta=1e-6)
        self.assertTrue(res["compose"])
        self.assertEqual(len(res["stroke"]), 2)
        self.assertLess(res["stroke"][0], 0.9)
        # A new note / drawing session: a clean timeline; the player shows the note's two frames.
        self.assertEqual(res["markersPlayer"], 2)
        self.assertEqual((res["markersCanvas"], res["markersCompose"]), (0, 0))
        self.assertTrue(res["panelPaused"])
        self.assertEqual(res["panel"], [True, "visible", False])
        # Viewer: sideways walks the note's frames, a swipe past the last keeps it open, Back closes.
        self.assertTrue(res["viewer"][0].endswith("1 / 2"), res["viewer"])
        self.assertTrue(res["viewer"][1].endswith("2 / 2"), res["viewer"])
        self.assertTrue(res["viewer"][2].endswith("2 / 2"), res["viewer"])
        self.assertFalse(res["viewer"][3])
        self.assertEqual(res["viewerFade"], [True, 1])
        # The viewer's caption: three lines of words, the rest scrolls in it (no note change).
        self.assertEqual(res["capText"], [3, True, True, True, True, "fit"])
        self.assertEqual(res["capPlace"], [True, True, True])
        # Notes list: a swipe left = the next filter (Open), right = back to All.
        self.assertEqual(res["filterSwipe"], ["open", "Open", "all"])
        # A note's pictures: equal squares, four to a row filling it.
        self.assertGreaterEqual(res["pics"][0], 1)
        self.assertEqual(res["pics"][1:], [True, True])
        self.assertEqual(res["replyOffNote"], [False, True])
        # Home groups: dropped onto another review → a group of both, named by their common start;
        # its header opens / closes it; taking one out dissolves a group of one.
        self.assertTrue(res["dropLit"])
        # The pencil right after a step / scrub: the canvas is up while the seek is on its way;
        # the player's own frame of that position then replaces the cached picture.
        self.assertEqual(res["penAfterScrub"], [True, True, True])  # up mid-seek; then the player's own frame
        # Tool rows: Shapes → 5, a pick folds it (the slot on, the ellipse in hand) and draws;
        # Arrows → 5, a touch on the picture folds it (the arrow kept); colour → 5, a pick sets it.
        self.assertEqual(res["fly"][:2], [6, [False, True, "ellipse"]])  # 5 shapes + the fill colour
        # Fill colour: a second row of 6 colours; blue → the shape drawn is filled blue.
        self.assertEqual(res["fill"], [6, ["#0a84ff", 4, False], True])  # the filled ellipse in hand stays
        self.assertGreaterEqual(res["fly"][2], 1)
        self.assertEqual(res["fly"][3:6], [5, [False, "arrow"], 5])
        self.assertEqual(res["fly"][6], ["rgb(255, 214, 10)", False])
        self.assertEqual(res["flyKey"], [False, "brush"])
        # The text slot's switches: 7, on the bar's look; Bold / centre on the pen and the new field;
        # Italic while typing; the text put down is bold, italic and centred.
        self.assertEqual(res["textFly"], [[7, True], [True, "Alignment: center", True], ["700", "center"], "italic", ["italic", "middle", "Hi"],
            {"bold": False, "italic": False, "underline": False, "bgOn": True, "bg": "#000000", "outline": False, "outlineColor": "#000000", "align": "left", "font": "sans"}])
        # Box / Font: the box is a switch (on → off: no row), switched on its 6 colours show above
        # the text row; the font row has 5; a pick sets the pen.
        self.assertEqual(res["textSub"], [[0, 6, True, True], 5, ["#ffffff", True, "serif", False, True], [False, False]])
        # Speed: dragged up → faster; a tap → a common frame rate; a hold → the clip's own.
        (r1, t1, fps), (r2, t2, _), (r3, t3, _) = res["speed"]
        self.assertGreater(r1, 1.1)
        common = [1, 2, 3, 4, 5, 6, 8, 10, 12, 12.5, 15, 20, 23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 72, 90, 100, 120]
        self.assertTrue(any(abs(r2 * fps - c) < 1e-6 for c in common), (r2, fps))
        self.assertEqual(r3, 1)
        self.assertNotEqual(t1, t3)
        self.assertEqual(res["sound"], [True, False])
        # The speaker: a tap mutes, the next gives full volume.
        self.assertEqual(res["mute"], [["0", True], ["1", False]])
        # Controls hidden: header, transport, Notes Panel bar gone, the round button shown; back again.
        self.assertEqual(res["clean"], [[True, "none", "none", "none", "grid"], [False, "block", "block", "flex", "none"]])
        # A tap on a note's card: selected (accent frame), the player on its first frame.
        self.assertEqual(res["select"], [True, True, True])
        self.assertEqual(res["loop"], [[False, False, None], [True, True, "1"], [False, False, "0"]])
        self.assertEqual(res["groupPlace"], ["g", "grp-c"])
        # Auto full screen on a plain tap, not a scrub / drag / hold (again after the reload);
        # Settings → Off leaves it.
        self.assertEqual(res["fullscreen"], [False, True, False, True, [False, "0"]])
        self.assertEqual(res["group"], [["shot", "grp-a,grp-b", False], ["shot", "grp-a,grp-b", True], None, 0])
        # Reply on a video note: over the player (panel closed, compose bar, 2 frame chips + ticks),
        # from the note's first frame; a chip goes to its frame; drawn on a new frame, sent, the
        # player stays there and the note stays lit; the reply's card shows that frame.
        self.assertEqual(res["reply"], [True, False, True, True, 2, 2, True])
        self.assertEqual(res["replyChip"], [True, True])
        self.assertEqual(res["replySent"][:6], [True, True, None, True, True, True])
        self.assertGreaterEqual(res["replySent"][6], 1)
        # The viewer walks the whole thread: the note's 2 frames, then the reply's (with its words).
        th = res["thread"]
        self.assertTrue(th[0].endswith("1 / 3"), th)
        self.assertTrue(th[1].endswith("2 / 3") and not th[1].startswith("↳"), th)
        self.assertTrue(th[5], th)  # Back: the player on the frame left on (the reply's)
        self.assertTrue(th[2].startswith("↳") and th[2].endswith("3 / 3"), th)
        self.assertEqual(th[3], th[2])  # the end: stays
        self.assertEqual(th[4], "Forgot this frame")
        # Edit text on a reply: the words change, the reply is marked edited (its merge key).
        self.assertEqual(res["replyEdit"], ["Forgot this frame — and the next", True, True, "Forgot this frame — and the next"])
        self.assertEqual(res["replyPencil"], [True, True])
        self.assertEqual(res["replyGone"], [None, False])
        self.assertTrue(res["home"])
        # Back by a swipe, the first tap on a review's picture opens it again (bug: it was lost).
        self.assertEqual(res["reopen"], [True, True])
        # Between groups: dropped on the other group's header (lit), it moves there; the group of one left goes.
        self.assertEqual(res["between"], ["g:g2", ["Two:grp-c,grp-d,grp-a"]])
        self.assertEqual(res["groupSum"], ["open1", "progress2", "done2"])
        # Taps pick (no review opens); Move to… → a new group of the picked two.
        self.assertEqual(res["pick"][:3], ["grp-b,grp-c", True, "2 selected"])
        self.assertEqual(sorted(res["pick"][3]), sorted(["Two:grp-d,grp-a", "Group:grp-b,grp-c"]))
        self.assertFalse(res["pick"][4])
        self.assertEqual(res["groupPic"], [True, "rgb(52, 199, 89)"])
        # Picked reviews slide together; the uncovered eye hides all of them.
        self.assertEqual(res["swipeAll"], [[True, True], ["grp-b", "grp-d"]])
        self.assertEqual((res["swipeLeft"], res["covered"]), ("row r", "row"))
        self.assertEqual(res["hidden"], [0, "1 hidden for now · Show"])


if __name__ == "__main__":
    unittest.main()
