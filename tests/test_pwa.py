"""The phone app (mobile/, docs/PLAN-mobile.md stage 3): build, logic, and the round trip with Sight.

    python -m unittest tests.test_pwa

- build: tools/build_pwa.py fills every placeholder and the service worker caches every file.
- unit: tests/pwa_unit.cjs (node) — model, MP4 frame rate, PDF writer; the PDF opens in PyMuPDF.
- 3D (tests/pwa_3d.cjs, WebGL through SwiftShader): notes on views of a GLB, explode, a reply drawn on a
  view, a quarter turn, exports; Sight imports the .srev by name + size.
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
from tests.fixtures_3d import make_fbx, make_glb, make_gltf_with_bin, make_obj, make_splat, make_splat_ply, make_stl  # noqa: E402
from app import review  # noqa: E402
from app.library import Library  # noqa: E402

NODE = shutil.which("node")


def has_playwright() -> bool:
    if not NODE:
        return False
    r = subprocess.run([NODE, "-e", "require('playwright')"], capture_output=True, cwd=ROOT / "tests")
    return r.returncode == 0


def sight_import(lib: Library, raw: bytes) -> tuple[dict, dict]:
    """What POST /api/review/import does with a package (the same function)."""
    res = review.import_review_file(lib, raw)
    if not res.get("ok"):
        raise AssertionError(f"Sight found no asset for {res.get('missing')}")
    return lib.get_asset(res["asset_id"]), res


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
            for f in ("core/review-core.js", "core/review-draw.js", "core/keys.js", "core/caption-plate.js", "core/model3d-core.js",
                      "three/three.module.js", "three/jsm/loaders/GLTFLoader.js", "three/jsm/libs/draco/gltf/draco_decoder.wasm",
                      "manifest.webmanifest", "icons/icon-512.png"):
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


    @unittest.skipUnless(NODE and shutil.which("ffmpeg") and shutil.which("ffprobe"), "needs node, ffmpeg and ffprobe")
    def test_mp4_track(self) -> None:
        """mp4.js trackFromMoov (0.96.1, the phone's WebCodecs scrub cache): every frame's presentation time as the
        player has it (ctts + edit list), sync samples, the codec string and the display turn — against ffprobe, on
        H.264 with B-frames, a 90° turn and a variable frame rate."""
        with tempfile.TemporaryDirectory() as tmp:
            src, rot = Path(tmp) / "vfr.mp4", Path(tmp) / "rot.mp4"
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=3",
                            "-vf", "select='lt(t,1.5)+not(mod(n,2))'", "-fps_mode", "vfr", "-c:v", "libx264", "-g", "20", "-bf", "2",
                            "-pix_fmt", "yuv420p", str(src)], check=True)
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-display_rotation", "90", "-i", str(src), "-c", "copy", str(rot)], check=True)
            js = ("import('" + (ROOT / "mobile" / "js" / "mp4.js").as_uri() + "').then(async (m) => { const fs = require('fs');"
                  " const t = await m.videoTrack(new Blob([fs.readFileSync(process.argv[1])]));"
                  " console.log(JSON.stringify({ codec: t.codec, rot: t.rot, n: t.n, pts: Array.from(t.sorted), keys: Array.from(t.key).reduce((a, k, i) => k ? a.concat(i) : a, []) })); })")
            for path, want_rot in ((src, 0), (rot, 270)):
                r = subprocess.run([NODE, "-e", js, str(path)], capture_output=True, text=True)
                self.assertEqual(r.returncode, 0, r.stderr)
                got = json.loads(r.stdout)
                pr = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "frame=best_effort_timestamp_time,key_frame",
                                     "-of", "json", str(path)], capture_output=True, text=True, check=True)
                frames = json.loads(pr.stdout)["frames"]
                want = sorted(float(f["best_effort_timestamp_time"]) for f in frames)
                self.assertEqual(len(got["pts"]), len(want))
                for a, b in zip(got["pts"], want):
                    self.assertAlmostEqual(a, b, delta=1e-3)
                self.assertTrue(got["codec"].startswith("avc1.64"), got["codec"])
                self.assertEqual(got["rot"], want_rot)
                self.assertEqual(got["keys"][0], 0)
                self.assertGreater(len(got["keys"]), 1)


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
        make_glb(media / "boxes_v001.glb")
        make_glb(media / "lift_v001.glb", anim=True)
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
            if n >= (3 if cls.video else 2):
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


    def test_seq_bar(self) -> None:
        """Phone sequences (0.88): a group's videos end to end under the timeline; a tap / drag on the bar, play
        past a clip's end and a scrub on the picture go on into the next clip; a swipe on the title switches."""
        if not (self.video and has_playwright()):
            self.skipTest("needs ffmpeg, node and Playwright")
        d = self.tmp / "seqbar"
        d.mkdir()
        for name, color in (("seq_a.webm", "red"), ("seq_b.webm", "blue")):
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"color=c={color}:size=320x180:rate=24:duration=2",
                            "-c:v", "libvpx-vp9", "-b:v", "100k", str(d / name)], check=True)
        res = self.e2e("seqbar", self.base, str(d))
        self.assertEqual(res["segs"], [["seq_a.webm", True], ["seq_b.webm", False]])
        self.assertLessEqual(res["cacheSpan"][0], 1.2)  # the open clip's cache runs around the playhead...
        self.assertGreaterEqual(res["cacheSpan"][1], 1.9, res.get("cacheDbg"))
        self.assertTrue(res["adopted"])  # ...and clip b's (filled as the neighbour) is taken over at the cut
        self.assertAlmostEqual(res["tap"][0], 1.0, delta=0.1)
        self.assertEqual(res["tap"][1], "seq_b.webm")
        self.assertAlmostEqual(res["drag"][0], 1.0, delta=0.1)
        self.assertFalse(res["drag"][1])
        self.assertTrue(res["played"])
        self.assertEqual(res["swipe"], ["seq_a.webm", "seq_b.webm"])
        self.assertFalse(res["scrub"])  # landed in the second clip (ready), the drag over
        self.assertAlmostEqual(res["touch"][0], 1.6, delta=0.1)
        self.assertFalse(res["touch"][1])
        self.assertEqual(res["endSeek"], "seq_b.webm")  # last clip, loop on: a paused seek to the end stays
        self.assertEqual(res["hist"], 0)  # every move replaces the history entry
        self.assertEqual(res["hold"], 0)  # the held frame is gone once the clip shows
        self.assertTrue(res["toolsAbove"])  # drawing canvas: the tools over the transport
        self.assertGreater(res["rowScroll"][1], 0)  # 300 px wide: the row does not fit...
        self.assertEqual(res["rowScroll"][0], min(80, res["rowScroll"][1]))  # ...and an 80 px finger drag scrolls it all the way

    def test_wcache(self) -> None:
        """Phone scrub cache on MP4s (0.96.1): decoded with WebCodecs — every frame of both clips of a sequence;
        a timeline drag over cached frames does not seek the player until it is let go; a drag across the cut shows
        the next clip's own cached frame (not the last clip's) while that clip opens. 0.96.2: a play from a frame the
        player is not on yet, and a play on across the cut, start from the cache (the bridge). VP9 in MP4 (vpcC): Chromium
        builds without H.264 decode it too."""
        if not (self.video and has_playwright()):
            self.skipTest("needs ffmpeg, node and Playwright")
        d = self.tmp / "wcache"
        d.mkdir()
        for name, src in (("wc_a.mp4", "testsrc2"), ("wc_b.mp4", "rgbtestsrc")):
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"{src}=size=320x180:rate=24:duration=3",
                            "-c:v", "libvpx-vp9", "-b:v", "200k", "-g", "24", "-pix_fmt", "yuv420p", str(d / name)], check=True)
        res = self.e2e("wcache", self.base, str(d))
        self.assertEqual(res["cache"], [72, True, 72, True, 0])  # every frame of the open clip and of its neighbour
        self.assertEqual(res["during"], [0, True, True])  # dragging: the cached picture, the player not sought
        self.assertEqual(res["rest"], [1, True])  # a finger resting on a frame: one seek there
        self.assertEqual(res["after"][0], 1)  # let go on that frame: no other seek...
        self.assertAlmostEqual(res["after"][1], 2.1, delta=0.1)  # ...to where the drag ended (70 % of 3 s)
        self.assertIn("IMG:blob", res["holds"])  # across the cut: the next clip's cached frame
        self.assertEqual(res["landed"][0], "wc_b.mp4")
        self.assertTrue(res["landed"][2])  # its cache taken over
        # Play from a frame the player is still seeking to (seeks made costly): the cache plays from that frame, the
        # player is sent to the next keyframe (1 s) and takes over there; the picture never goes back.
        br = res["bridge"]
        self.assertEqual(br["t1"], [1])
        self.assertEqual(len(br["seeks"]), 2, br)  # the tap's seek (0.3 s, a quarter into its frame), then the keyframe
        self.assertAlmostEqual(br["seeks"][0], 0.302, delta=0.002)
        self.assertAlmostEqual(br["seeks"][1], 1.01, delta=0.002)
        self.assertAlmostEqual(br["shown"][0], 0.292, delta=0.002)
        self.assertGreater(br["shown"][1], br["shown"][0])
        self.assertEqual(br["back"], 0)
        self.assertEqual(br["early"], 0, br)  # (a faked slow start) the cache until the player has moved off 1 s
        self.assertGreater(br["cached"], 3)
        self.assertEqual(br["end"], [True, False, 1, False])  # the player's own picture, playing, its rate and sound back
        self.assertFalse(br["elMuted"])  # 0.96.5: the bridge mutes nothing (a clip with no sound catches up at 2x)
        # Played on past the clip's end: the next clip starts from its cached frames (the bridge), then its player.
        # (A player that starts at once hands over within a frame or two: the bridge may be too short to be sampled.)
        last = res["cut"]["last"]
        self.assertEqual(last["name"], "wc_b.mp4", res["cut"])
        self.assertLess(last["t"], 0.5)
        self.assertEqual(res["cut"]["end"], [True, False, 1, False])  # rate and sound back
        self.assertEqual(res["cut"]["back"], 0)
        self.assertEqual(res["cut"]["aModes"], [])  # clip a (fast start) played plainly...
        self.assertEqual(res["cut"]["ended"], 1)  # ...to its end
        # 0.96.3: from the frame the player stands on, its start slow (faked 0.3 s): the cache plays at once, the
        # player (not sought) plays at its own rate with sound while the picture slows until it has caught up.
        st = res["stay"]
        self.assertEqual(st["modes"], ["stay"], st)
        self.assertEqual(st["seeks"], [])
        self.assertAlmostEqual(st["first"], 1.5, delta=0.05)
        self.assertEqual(st["back"], 0)
        # 0.96.5, a clip with sound: the player at its own rate with its sound all along, the picture slowed.
        self.assertEqual(st["fast"], 1)
        self.assertFalse(st["muted"])
        self.assertLess(st["speed"], 0.85, st)
        self.assertEqual(st["midVol"], [False, 0.5, True])  # a level set mid-bridge applies at once
        self.assertEqual(st["vol"], [False, 0.5])
        self.assertEqual(st["last"]["why"], "player", st["last"])  # handed over by the player...
        self.assertLess(st["last"]["ms"], (st["last"]["h"] + 0.35) * 1000, st["last"])  # ...on time
        ps = res["pauseSeek"]
        self.assertEqual(ps["atPause"]["sk"], [], ps)  # no seek at the pause...
        self.assertTrue(ps["atPause"]["paused"], ps)
        self.assertAlmostEqual(ps["atPause"]["padT"], ps["t"], delta=1e-6)  # ...the frame noted
        self.assertEqual(ps["sk"], [], ps)  # the next play: no seek (0.96.6)...
        self.assertEqual(ps["last"]["mode"], "stay", ps)  # ...a bridge from the paused frame...
        self.assertAlmostEqual(ps["last"]["pad"], ps["t"], delta=1e-6)
        self.assertAlmostEqual(ps["last"]["x"], ps["t"] + 0.2, delta=1e-3)  # ...expecting the player padJ (0.2) ahead
        self.assertEqual(ps["last"]["why"], "player", ps)  # handed over by the player (no jump here: it is behind)
        self.assertLess(ps["last"]["ms"], (ps["last"]["h"] + 0.8) * 1000, ps)
        self.assertIsNone(ps["muted"]["padT"], ps)  # a muted pause notes nothing
        self.assertTrue(ps["muted"]["paused"], ps)
        self.assertIsNotNone(ps["noCache"]["padT"], ps)  # noted, but no cached frames there:
        self.assertEqual(ps["noCache"]["sk"], [], ps)  # a plain play
        self.assertFalse(ps["noCache"]["bridge"], ps)
        self.assertGreater(st["cached"], 3)
        self.assertEqual(st["end"], [True, False, 1, False])
        # Near the clip's end with no time to catch up: the cache plays the tail alone, then on into the next clip.
        tl = res["tail"]
        self.assertEqual(tl["modes"], ["tail"], tl)
        self.assertEqual(tl["seeks"], [])  # the player is left where it stands
        self.assertTrue(tl["paused"])
        self.assertGreater(tl["last"], 2.9)
        self.assertTrue(res["again"])  # played to the end of the last clip: a tap plays it from the start
        # A tap during the bridge: paused on the frame shown; the player lands on that frame.
        on, T, ended, paused, ct = res["halt"]
        self.assertTrue(on and ended and paused, res["halt"])
        self.assertGreater(T, 0.3)
        self.assertEqual(int(ct * 24 + 1e-6), int(T * 24 + 1e-6), res["halt"])

    def test_bundle(self) -> None:
        """Multi-clip stage 3: the phone opens a Sight bundle (one group, a damaged clip reported), a note
        on one clip goes back as a bundle of that clip only, with the same bundle id, and Sight merges it."""
        home = self.tmp / "home_bundle"
        home.mkdir()
        lib = Library(home)
        try:
            sid = lib.add_source(str(self.media))["id"]
            deadline = time.time() + 30
            while time.time() < deadline and lib.query("SELECT COUNT(*) AS n FROM assets WHERE source_id=? AND status='ready'", (sid,))[0]["n"] < 2:
                time.sleep(0.2)
            assets = {a["name"]: a for a in lib.query("SELECT * FROM assets WHERE source_id=?", (sid,))}
            now = int(time.time() * 1000)
            pkgs = []
            for name in ("shot_v001.png", "boxes_v001.glb"):
                a = lib.get_asset(assets[name]["id"])
                lib.add_annotation({"scope": "asset", "target_asset_id": a["id"], "kind": "note",
                                    "data": {"text": "Desk on " + name, "author": "Desk", "created": now, "status": "open", "ctx": None, "shots": []}})
                pkgs.append(review.build_package(a, lib.annotations_for_asset(a["id"]), lib.root, "Desk", "test"))
            broken = {"format": "sight-review", "version": 1, "asset": {"name": "broken.mov"}}
            bundle = review.build_bundle(pkgs + [broken], "Desk", "test", "Sequence review — 2 clips", "b0b0b0b0b0b0b0b0")
            src, out = self.tmp / "seq.srev", self.tmp / "seq_reply.srev"
            src.write_text(json.dumps(bundle), encoding="utf-8")
            res = self.e2e("bundle", self.base, str(src), str(self.media), str(out))
            self.assertIn("Merged 2 clips from Desk", res["toast"])
            self.assertIn("1 damaged: broken.mov", res["toast"])
            self.assertEqual(res["groupRows"], 1)
            self.assertEqual(len(res["groups"]), 1)
            g = res["groups"][0]
            self.assertEqual((g["bundle"], g["name"], len(g["keys"])), ("b0b0b0b0b0b0b0b0", "Sequence review — 2 clips", 2))
            self.assertEqual(res["nomedia"], 2)
            self.assertEqual(res["nomediaAfter"], 1)
            for m in res["metas"]:
                self.assertEqual((m["groups"], m["changed"], m["nomedia"]), (["b0b0b0b0b0b0b0b0"], False, True))
            self.assertIn("1 clip", res["sheet"])
            self.assertEqual(res["changedAfter"], [False, False])
            self.assertEqual(res["second"], "Nothing changed")
            # The sequence: opened from the group's picture, clip by clip, Back leaves it, reopens where left.
            self.assertEqual(res["seq"][:2], ["shot_v001.png", True])
            self.assertIn("Sequence review — 2 clips · 1 / 2", res["seq"][2])
            self.assertTrue(res["seq"][3])
            self.assertEqual(res["seqHist"], 1)  # one entry for the whole sequence
            self.assertEqual(res["seqResume"], "boxes_v001.glb")
            reply = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual((reply["format"], reply["id"], reply["author"]), ("sight-review-bundle", "b0b0b0b0b0b0b0b0", "Phone Tester"))
            self.assertEqual([p["asset"]["name"] for p in reply["packages"]], ["shot_v001.png"])
            back = review.import_review_file(lib, out.read_bytes())
            self.assertTrue(back.get("bundle"))
            self.assertEqual([(r["ok"], r.get("added")) for r in back["results"]], [(True, 1)])
            texts = sorted(r["data"]["text"] for r in lib.annotations_for_asset(assets["shot_v001.png"]["id"]) if r["kind"] == "note")
            self.assertEqual(texts, ["Desk on shot_v001.png", "Phone note in the bundle"])
        finally:
            for w in list(lib._watchers.values()):
                w.stop()
                w.join(5)
            lib.close()

    def test_model3d(self) -> None:
        out = self.tmp / "out3d"
        out.mkdir()
        r = subprocess.run([NODE, str(ROOT / "tests" / "pwa_3d.cjs"), self.base, str(self.media / "boxes_v001.glb"), str(out)],
                           capture_output=True, text=True, timeout=600, cwd=ROOT / "tests")
        self.assertEqual(r.returncode, 0, r.stderr[-4000:])
        res = json.loads(r.stdout)
        self.assertEqual(res["log"], [])
        self.assertEqual((res["kind"], res["canExplode"]), ("model3d", True))
        rows = res["rows"]
        notes = {n["data"]["text"]: n for n in rows if n["kind"] == "note"}
        self.assertEqual(sorted(notes), ["Apart", "Box the cubes", "Seen from the side", "Turned"])
        c1, c2, c3, c4 = (notes[k]["data"]["ctx"] for k in ("Box the cubes", "Seen from the side", "Apart", "Turned"))
        self.assertEqual(len({c1["vk"], c2["vk"], c3["vk"], c4["vk"]}), 4)
        self.assertEqual((c1["hidden"], c1["explode"], c3["explode"], c4["cam"]["turns"]), ([], 0, 0.6, 1))
        self.assertEqual(c1["cam"]["fov"], 50)
        rect = next(x for x in rows if x["kind"] == "shape" and x["shape_kind"] == "rect")
        self.assertEqual(rect["data"]["ctx"]["vk"], c1["vk"])
        self.assertLess(abs(rect["data"]["x"] + rect["data"]["w"] / 2), 30, rect["data"])  # drawn about the centre (doc origin)
        arrow = next(x for x in rows if x["kind"] == "shape" and x["data"].get("reply"))
        self.assertEqual((arrow["data"]["note"], arrow["data"]["ctx"]["vk"]), (notes["Box the cubes"]["id"], c1["vk"]))
        self.assertEqual((res["overlayView1"], res["overlayOrbited"], res["curVkOrbited"]), (1, 0, None))
        self.assertEqual((res["backOnView1"], res["explodeBack"], res["overlayBack"], res["ctxButton"]), (True, 0, 1, "View 1"))
        self.assertIn("View 1", res["replyLabel"])
        self.assertEqual(res["cardTags"], ["V1", "V1", "V2", "V3"])
        self.assertIn("View 1", res["viewerLabel"])
        self.assertEqual((res["viewerOverlay"], res["turns"]), (1, 1))
        self.assertEqual((res["reopenedNotes"], res["reopenedViews"], res["thumb"]), (4, 4, True))
        import pymupdf

        doc = pymupdf.open(str(out / "app_model.pdf"))
        self.assertGreaterEqual(sum(len(pg.get_images()) for pg in doc), 3)
        doc.close()
        page = (out / "app_model.html").read_text(encoding="utf-8")
        for v in ("View 1", "View 2", "View 3", "View 4"):
            self.assertIn(v, page)
        a, stats = sight_import(self.lib, (out / "app_model.srev").read_bytes())
        self.assertEqual((a["name"], a["kind"]), ("boxes_v001.glb", "model3d"))
        self.assertEqual(stats["added"], len(rows))
        srect = next(x for x in self.lib.annotations_for_asset(a["id"]) if x["kind"] == "shape" and x["shape_kind"] == "rect")
        self.assertEqual(srect["data"]["ctx"], rect["data"]["ctx"])

    def test_model_tools(self) -> None:
        """Phone 3D tools: mesh pick / hide / solo / UV, shading / light / grid rows, animation and its view pose."""
        r = subprocess.run([NODE, str(ROOT / "tests" / "pwa_3d_tools.cjs"), self.base, str(self.media / "lift_v001.glb")],
                           capture_output=True, text=True, timeout=600, cwd=ROOT / "tests")
        self.assertEqual(r.returncode, 0, r.stderr[-4000:])
        res = json.loads(r.stdout)
        self.assertEqual(res["log"], [])
        self.assertEqual(res["openButtons"], 1)
        self.assertEqual([c["name"] for c in res["clips"]], ["Lift"])
        self.assertIsNotNone(res["picked"])
        self.assertTrue(res["picked"]["selRow"])
        self.assertEqual(res["afterEmptyTap"]["sel"], -1)
        self.assertGreater(res["uvShown"], 0)
        # The UV viewer: the set at the top (two sets here), no note plate; sideways walks the sets.
        self.assertRegex(res["uv1"]["title"], r"^UV1 · 1 / 2 · ")
        self.assertFalse(res["uv1"]["plate"])
        self.assertRegex(res["uv2"]["title"], r"^UV2 · 2 / 2 · ")
        self.assertRegex(res["uvEnd"]["title"], r"^UV2 · 2 / 2 · ")
        self.assertRegex(res["uvBack"]["title"], r"^UV1 · 1 / 2 · ")
        self.assertNotEqual(res["uv1"]["src"], res["uv2"]["src"])
        self.assertEqual(res["uv1"]["src"], res["uvBack"]["src"])  # (made once per set)
        self.assertEqual(len(res["solo"]["hidden"]), 1)
        self.assertEqual(len(res["hid"]["hidden"]), 1)
        self.assertEqual(res["hid"]["sel"], -1)
        self.assertEqual(res["shown"]["hidden"], [])
        self.assertEqual((res["look"]["shading"], res["look"]["light"], res["look"]["grid"]),
                         ({"base": "solid", "wire": True, "xray": False}, "head", "axes"))
        self.assertEqual(res["stored"], {"base": "solid", "wire": True, "xray": False, "grid": "axes", "gridCell": 0, "light": "head", "bg": "#0a0a0b"})
        self.assertEqual(res["rowClosed"], 0)
        # Grid cells: round sizes, two 1-2-5 steps finer; the background colour (kept on the device).
        self.assertEqual(res["cell0"], 0.2)  # (the boxes' diagonal ≈ 2.6: a tenth rounds to 0.2)
        self.assertEqual((res["cell"]["size"], res["cell"]["label"], res["cell"]["stored"]), (0.05, "0.05", -2))
        self.assertEqual(res["bg"], {"bg": "#ffffff", "stored": "#ffffff", "on": "Background #ffffff"})
        self.assertTrue(res["played"]["playing"])
        self.assertGreater(res["played"]["anim"]["t"], 0)
        self.assertFalse(res["paused"]["playing"])
        self.assertEqual(res["noteCtx"]["anim"], {"clip": 0, "t": 1})
        self.assertEqual(res["onNote"]["vk"], res["noteCtx"]["vk"])
        self.assertIsNone(res["away"]["vk"])
        self.assertEqual((res["back"]["vk"], res["back"]["anim"]), (res["noteCtx"]["vk"], {"clip": 0, "t": 1}))
        # The note carries the look it was written with, in Sight's v3d shape; opening it puts the look back.
        self.assertEqual(res["noteCtx"]["v3d"], {"shadeBase": "solid", "wireOn": True, "xrayOn": False, "env": False, "explode": 0})
        self.assertEqual((res["noteLook"]["shading"], res["noteLook"]["light"]), ({"base": "solid", "wire": True, "xray": False}, "head"))
        self.assertEqual(res["storedAfterNote"], {"base": "vertex", "wire": False, "xray": True, "grid": "off", "light": "flat"})

    def test_model_formats(self) -> None:
        d = self.tmp / "fmt"
        d.mkdir()
        gltf = make_gltf_with_bin(d / "boxes.gltf")
        files = [make_obj(d / "boxes.obj"), make_stl(d / "boxes.stl"), make_fbx(d / "boxes.fbx")]
        usdz = d / "parts_v001.usdz"
        shutil.copyfile(ROOT / "tests" / "fixtures" / "parts_v001.usdz", usdz)
        usdc = d / "parts.usdc"  # the same stage as binary USD (crate): small double vectors are stored inline
        shutil.copyfile(ROOT / "tests" / "fixtures" / "parts.usdc", usdc)
        # A strip with two materials (GeomSubsets), a textured quad (red.png inside), and a row of four quads:
        # mesh material blue, subsets green / red / green, one face in no subset (Sight: red, blue, green).
        mats = d / "mats_v001.usdz"
        shutil.copyfile(ROOT / "tests" / "fixtures" / "mats_v001.usdz", mats)
        # Animated USD (tests/fixtures/make_anim_usd.py): an Xform's translate (text and packaged), a skeleton.
        anim = [d / n for n in ("anim.usda", "anim_v001.usdz", "skel.usda")]
        for f in anim:
            shutil.copyfile(ROOT / "tests" / "fixtures" / f.name, f)
        # Gaussian splats (Spark): a .splat and a 3DGS .ply (told from a mesh .ply by its header)
        splats = [make_splat(d / "balls.splat"), make_splat_ply(d / "balls.ply")]
        args = [str(f) for f in files] + [str(gltf), f"{gltf},{gltf.with_suffix('.bin')}", str(usdz), str(usdc), str(mats)] + [str(f) for f in anim + splats]
        sight = {}
        try:  # Sight's own USDZ conversion (optional usd-core): the phone must lay the model out the same way
            from app import usdz_convert

            for f in (usdz, mats):
                if usdz_convert.convert(f, d / (f.stem + "_sight.glb")):
                    sight[f.name] = d / (f.stem + "_sight.glb")
        except Exception:
            pass
        args += [str(g) for g in sight.values()]
        r = subprocess.run([NODE, str(ROOT / "tests" / "pwa_3d_formats.cjs"), self.base, *args],
                           capture_output=True, text=True, timeout=600, cwd=ROOT / "tests")
        self.assertEqual(r.returncode, 0, r.stderr[-4000:])
        res = json.loads(r.stdout)
        boxes = [[-1.05, -0.45, -0.45], [1.05, 0.45, 0.45]]
        for name, meshes in (("boxes.obj", 2), ("boxes.stl", 1), ("boxes.fbx", 2), ("boxes.gltf+", 2)):
            got = res[name]
            self.assertEqual((got["err"], got["meshes"], got["log"]), (None, meshes, []), name)
            for a, b in zip(got["bounds"]["min"] + got["bounds"]["max"], boxes[0] + boxes[1]):
                self.assertAlmostEqual(a, b, places=4, msg=name)
        self.assertEqual(res["boxes.gltf+"]["extras"], 1)
        self.assertIn("boxes.bin", res["boxes.gltf"]["err"])  # the .gltf alone says what it needs
        # USDZ: Z-up turned to Y-up, centimetres not scaled (as Sight's conversion): x ±100, y -40…90, z ±40.
        for name in ("parts_v001.usdz", "parts.usdc"):
            u = res[name]
            self.assertEqual((u["err"], u["meshes"]), (None, 2), name)
            for a, b in zip(u["bounds"]["min"] + u["bounds"]["max"], [-100, -40, -40, 100, 90, 40]):
                self.assertAlmostEqual(a, b, places=4, msg=name)
        # Its texture arrives (inside the .usdz); one mesh per material, a primitive's bounds its part's (as glTF).
        m = res["mats_v001.usdz"]
        self.assertEqual((m["err"], m["meshes"], m["textured"]), (None, 6, 3))
        self.assertEqual(m["centres"], [[0, 0.5, 0], [0, 0.5, 0], [0, 2.5, 0], [0, 4.5, 0], [0, 4.5, 0], [0, 4.5, 0]])

        def pattern(cols: list[str]) -> list[str]:  # which meshes share a material (colours differ: see ARCHITECTURE)
            first: dict[str, int] = {}
            return [c if c == "tex" else str(first.setdefault(c, len(first))) for c in cols]

        self.assertEqual(pattern(m["colours"]), ["tex", "0", "tex", "tex", "0", "1"])
        # Animated USD keeps its clip: the box under "Arm" (split per material in place, the static mesh order)
        # rises 2 over 2 s; the skeleton's tip turns (its picture changes). Static USD has no clip.
        for name in ("anim.usda", "anim_v001.usdz"):
            u = res[name]
            self.assertEqual((u["err"], u["meshes"], u["log"]), (None, 3, []), name)
            self.assertEqual(u["centres"], [[0, 0, 0], [2, 0, 0], [2, 0, 0]], name)
            self.assertEqual((u["anim"]["clips"], u["anim"]["duration"], u["anim"]["moves"]), (1, 1.999, True), name)
            for a, b in zip(sum(u["anim"]["centres"], []), [0, 0, 0, 2, 1.999, 0, 2, 1.999, 0]):
                self.assertAlmostEqual(a, b, places=3, msg=name)
        sk = res["skel.usda"]
        self.assertEqual((sk["err"], sk["meshes"], sk["log"]), (None, 1, []))
        self.assertEqual((sk["anim"]["clips"], sk["anim"]["duration"], sk["anim"]["moves"]), (1, 0.999, True))
        self.assertIsNone(res["parts_v001.usdz"]["anim"])
        # Splats: no meshes, both balls in the still (it waits for Spark's sort), placed as Sight places them
        # (half a turn about X: the balls at x ±1, radius 0.5).
        for name in ("balls.splat", "balls.ply"):
            u = res[name]
            self.assertEqual((u["err"], u["meshes"], u["explode"], u["anim"], u["log"]), (None, 0, False, None, []), name)
            self.assertEqual(u["splat"]["count"], 800, name)
            self.assertGreater(u["splat"]["red"], 50, name)
            self.assertGreater(u["splat"]["blue"], 50, name)
            for k in ("other", "racing"):  # stills of views that are not the live camera
                self.assertGreater(u["splat"][k]["red"], 50, (name, k))
                self.assertGreater(u["splat"][k]["blue"], 50, (name, k))
            self.assertGreater(u["splat"]["onlyRed"]["red"], 500, name)
            self.assertEqual(u["splat"]["onlyRed"]["blue"], 0, name)
            for a, b in zip(u["bounds"]["min"] + u["bounds"]["max"], [-1.5, -0.5, -0.5, 1.5, 0.5, 0.5]):
                self.assertAlmostEqual(a, b, delta=0.01, msg=name)
        self.assertIsNone(res["boxes.obj"]["splat"])
        for name, glb in sight.items():  # Sight's converted GLB: the same meshes in the same order, at the same place
            u, s = res[name], res[glb.name]
            self.assertEqual((u["meshes"], u["textured"], pattern(u["colours"])), (s["meshes"], s["textured"], pattern(s["colours"])), name)
            for a, b in zip(sum(u["centres"], []) + u["bounds"]["min"] + u["bounds"]["max"], sum(s["centres"], []) + s["bounds"]["min"] + s["bounds"]["max"]):
                self.assertAlmostEqual(a, b, places=4, msg=name)

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
        # Hold + drag down: the tool's opacity (not its size), shown in the preview; nothing drawn.
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
        # The viewer's text plate: five lines of words, the rest scrolls in it (no note change).
        self.assertEqual(res["capText"], [5, True, True, True, True, "fit"])
        self.assertEqual(res["capPlace"], [True, True, True])
        # A tap folds it into the icon at the foot, a tap on the icon opens it.
        self.assertEqual(res["plateFold"], [True, True, False, True])
        # Dragged to the left it sticks there 25 % wide, 80 % high (its icon too); dragged back to the foot.
        self.assertEqual(res["plateSide"], ["l", True, True, True, True, "b", False, True])
        self.assertEqual(res["plateRight"], ["r", True])
        # The picture's own text, written from the plate: shown there, stored in the note (frame key, content stamp).
        self.assertEqual(res["plateText"], ["Look at the left edge here", "Look at the left edge here", True, True, True])
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
        # Fill colour: a second row (the line's + 6); blue → the shape drawn is filled blue; back to the line's.
        self.assertEqual(res["fill"], [7, ["#0a84ff", 4, False], True, None])  # the filled ellipse in hand stays
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
        # Settings: no Done / Change name buttons, the name is tappable, a swipe down closes it.
        self.assertEqual(res["settingsUi"], [True, True, True])
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
