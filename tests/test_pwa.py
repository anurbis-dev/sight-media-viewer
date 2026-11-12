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
            self.assertAlmostEqual(res["scrubbed"][0], 2.5, delta=0.25)  # 0.5 s + half of 4 s
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


if __name__ == "__main__":
    unittest.main()
