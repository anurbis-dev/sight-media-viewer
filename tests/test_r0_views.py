"""R0-0 block 5 (docs/PLAN-coreline.md, "R0-0 first — a safety net"): the other two annotators (board, compare),
sequences, the library split, the exports / imports, the tracker link and the look (scale, theme, strings) as they
behave before the R0 refactor. The page scripts list their checks:

  tests/r0_board_e2e.cjs      a board's annotations (Shift+A / the button, a stroke and a note stored as board rows in
                              world units, the camera moves them, the item keys held back while drawing, Esc), the
                              library split beside a board (Tab, the button), touch
  tests/r0_compare_e2e.cjs    compare (K / the Compare button, the layouts 1-4, Swipe / Difference, a layer hidden, a
                              note written in compare with its session), files dropped on the lightbox to compare, the
                              sequence (the bar, the clips, ← / →, Shift+L), touch
  tests/r0_export_e2e.cjs     PDF / web page / .srev from the Export menu (files written, their contents), a .srev
                              imported back, the ShotGrid link ▾ (pick, link, sync, unlink) against the fake ShotGrid
  tests/r0_ui_e2e.cjs         Interface Scale 0.75x / 1.75x and the Light theme: the bars, panel and toolbar placed on
                              screen; a text snapshot of the bars, the review panel and every mode's ? list
                              (tests/r0_ui_snapshot.json), touch

    python -m unittest tests.test_r0_views
    SIGHT_R0_UPDATE_SNAPSHOT=1 python -m unittest tests.test_r0_views.R0Look   # rewrite the text snapshot (R0e: never)
"""
from __future__ import annotations

import json
import os
import subprocess
import unittest
from pathlib import Path
from unittest import mock

from tests.r0_harness import NODE, ROOT, LiveCase, make_video, needs, png, png_quadrants

SNAPSHOT = ROOT / "tests" / "r0_ui_snapshot.json"


def media(folder: Path) -> None:
    (folder / "b_pic1.png").write_bytes(png_quadrants(800, 600))
    (folder / "b_pic2.png").write_bytes(png(800, 600, (40, 120, 200)))
    (folder / "c_a.png").write_bytes(png_quadrants(640, 480))
    (folder / "c_b.png").write_bytes(png(640, 480, (220, 40, 40)))
    (folder / "c_c.png").write_bytes(png(640, 480, (40, 200, 60)))
    make_video(folder / "v_1.mp4", 320, 240, 25, 2)
    make_video(folder / "v_2.mp4", 320, 240, 25, 3)
    (folder / "e_pic.png").write_bytes(png_quadrants(900, 600))
    (folder / "sh010.png").write_bytes(png(400, 300, (90, 90, 90)))


class _Views(LiveCase):
    make_media = staticmethod(media)

    @classmethod
    def seed(cls) -> None:
        b = cls.lib.add_board("R0 board")
        cls.board = b["id"]
        cls.lib.add_board_item(cls.board, {"asset_id": cls.ids["b_pic1.png"], "x": 0, "y": 0, "w": 400, "h": 300})
        cls.lib.add_board_item(cls.board, {"asset_id": cls.ids["b_pic2.png"], "x": 480, "y": 0, "w": 400, "h": 300})


@needs(ffmpeg=True)
class R0Board(_Views):
    def test_board_annotations_and_split(self) -> None:
        self.assertReport(self.run_page("r0_board_e2e.cjs", board=self.board), min_checks=25)


@needs(ffmpeg=True)
class R0Compare(_Views):
    def test_compare_drop_and_sequence(self) -> None:
        self.assertReport(self.run_page("r0_compare_e2e.cjs"), min_checks=35)


@needs(ffmpeg=True)
class R0Export(_Views):
    """Exports land in a folder of this test (never the user's Downloads) and open no file manager."""
    ui_settings = {**LiveCase.ui_settings, "sight.reviewer": "R0 Reviewer"}   # (the fake ShotGrid's login "bob")

    @classmethod
    def _start(cls) -> None:
        cls.out = cls.tmp / "exports"
        cls.out.mkdir()
        cls.patches = [mock.patch("app.review.export_dir", lambda root: cls.out),
                       mock.patch("app.server.reveal_paths", lambda paths: 0)]
        for p in cls.patches:   # (class cleanups run even when setUpClass fails half way; tearDownClass does not)
            p.start()
            cls.addClassCleanup(p.stop)
        cls.fake = subprocess.Popen([NODE, str(ROOT / "tests" / "sg_fake_server.cjs")], stdout=subprocess.PIPE, text=True)
        cls.addClassCleanup(cls._stop_fake)
        cls.site = json.loads(cls.fake.stdout.readline())["site"]
        super()._start()
        from app.shotgrid import ShotGridService
        ShotGridService(cls.lib.root).configure({"site": cls.site, "script": "sight", "key": "secret",
                                                 "logins": {"R0 Reviewer": "bob"}, "sudo": True})

    @classmethod
    def _stop_fake(cls) -> None:
        cls.fake.terminate()
        cls.fake.wait(5)
        cls.fake.stdout.close()

    def test_exports_import_and_tracker_link(self) -> None:
        res = self.run_page("r0_export_e2e.cjs", out=str(self.out), site=self.site)
        self.assertReport(res, min_checks=30)


@needs(ffmpeg=True)
class R0Look(_Views):
    def test_scale_theme_and_text_snapshot(self) -> None:
        res = self.run_page("r0_ui_e2e.cjs", board=self.board)
        snap = (res.get("data") or {}).get("snapshot")
        if os.environ.get("SIGHT_R0_UPDATE_SNAPSHOT") == "1" and snap:
            SNAPSHOT.write_text(json.dumps(snap, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        self.assertReport(res, min_checks=30)
        self.assertTrue(SNAPSHOT.exists(), "no text snapshot yet: run once with SIGHT_R0_UPDATE_SNAPSHOT=1")
        want = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
        self.assertEqual(sorted(snap), sorted(want), "the snapshot's parts")
        for k in want:
            self.assertEqual(snap[k], want[k], f"the text of {k!r} changed")


if __name__ == "__main__":
    unittest.main()
