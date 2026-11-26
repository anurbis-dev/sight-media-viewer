"""R0-0 block 2 (docs/PLAN-coreline.md, "R0-0 first — a safety net"): the annotator as it behaves before the R0
refactor — the stored geometry (golden rows), notes and the review state, every drawing tool, select / transform,
undo / redo, the eye and onion skin. The page scripts list their checks:

  tests/r0_geometry_e2e.cjs   known drawings on known files -> exactly these rows (tests/fixtures/r0_geometry_golden.json)
  tests/r0_notes_e2e.cjs      notes, replies, states, delete, filters, the panel, picking, the reviewer name
  tests/r0_tools_e2e.cjs      each tool, select / move / resize / turn, undo / redo, the eye, onion skin, touch

    python -m unittest tests.test_r0_annotate
    SIGHT_R0_GOLDEN=update python -m unittest tests.test_r0_annotate.R0Annotate.test_geometry_golden   # rewrite it
"""
from __future__ import annotations

import json
import os
import unittest

from tests.r0_harness import ROOT, LiveCase, make_video, needs, png, png_quadrants

GOLDEN = ROOT / "tests" / "fixtures" / "r0_geometry_golden.json"


def media(folder):
    (folder / "g_pic.png").write_bytes(png_quadrants(1600, 1000))      # bigger than the window: drawn on at fit
    (folder / "g_small.png").write_bytes(png_quadrants(400, 300))      # its asset row says 800 x 600 (seed)
    make_video(folder / "g_clip.mp4", 320, 240, 25, 4)
    make_video(folder / "g_sar.mp4", 320, 240, 25, 2, sar="2:1")       # stored 320 x 240, shown 640 x 240
    (folder / "n_pic.png").write_bytes(png(1200, 800, (50, 70, 100)))
    make_video(folder / "n_clip.mp4", 320, 240, 25, 4)
    (folder / "t_pic.png").write_bytes(png(2000, 1300, (60, 60, 70)))       # fit < 1: screen px != picture px
    make_video(folder / "t_clip.mp4", 320, 240, 25, 4)
    (folder / "u_touch.png").write_bytes(png(1200, 800, (70, 60, 60)))


@needs(ffmpeg=True)
class R0Annotate(LiveCase):
    make_media = staticmethod(media)

    @classmethod
    def seed(cls) -> None:
        # A file whose decoded size differs from its asset row (a stale / wrong width, height): the drawings are
        # stored in the decoded picture's pixels, not the row's.
        # (Its thumbnail first: rendering one writes the real size into the row, has_thumb=1 keeps it from running again.)
        aid = cls.ids["g_small.png"]
        cls.lib._make_thumb(aid)
        cls.lib.execute("UPDATE assets SET width=800, height=600 WHERE id=?", (aid,))

    def test_geometry_golden(self) -> None:
        files = {"g_pic", "g_small", "g_clip", "g_sar"}
        update = os.environ.get("SIGHT_R0_GOLDEN") == "update"
        golden = None if update else json.loads(GOLDEN.read_text()) if GOLDEN.exists() else None
        if not update:
            self.assertTrue(isinstance(golden, dict) and set(golden) == files and all(golden.values()),
                            f"{GOLDEN.name} missing or incomplete: run with SIGHT_R0_GOLDEN=update once")
        res = self.run_page("r0_geometry_e2e.cjs", golden=golden)
        self.assertReport(res, min_checks=30)
        self.assertEqual(set(res["data"]), files)
        if update:   # only from a clean run
            GOLDEN.parent.mkdir(exist_ok=True)
            GOLDEN.write_text(json.dumps(res["data"], indent=1, sort_keys=True) + "\n")
            return
        for f in files:
            self.assertIn(f"{f}: rows match the golden", res["checks"])
        # The page saw the wrong row: nothing rewrote it while the lightbox was open.
        row = self.lib.query("SELECT width, height FROM assets WHERE id=?", (self.ids["g_small.png"],))[0]
        self.assertEqual((row["width"], row["height"]), (800, 600))

    def test_notes(self) -> None:
        self.assertReport(self.run_page("r0_notes_e2e.cjs"), min_checks=60)

    def test_tools(self) -> None:
        self.assertReport(self.run_page("r0_tools_e2e.cjs"), min_checks=50)


if __name__ == "__main__":
    unittest.main()
