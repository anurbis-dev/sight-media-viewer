"""Lightbox guides (app/static/guides.js): the grid's rulers outside the picture, Ctrl+click / long-press delete,
Shift+H with the drawings, the menu (tests/guides_e2e.cjs); perspective with one horizon and an old entry loading
(tests/guides_persp_e2e.cjs). The checks are listed in the scripts.

    SIGHT_REQUIRE_E2E=1 python -m unittest tests.test_guides
"""
from __future__ import annotations

import json
import unittest

from tests.r0_harness import LiveCase, needs, png, png_quadrants


def media(folder):
    (folder / "a_small.png").write_bytes(png(600, 400, (90, 110, 130)))      # zoomed to 100 %: margins all round
    (folder / "b_big.png").write_bytes(png_quadrants(1600, 1000))
    (folder / "c_old.png").write_bytes(png(1200, 800, (120, 100, 90)))   # carries a 0.138 guides entry (seed)


@needs()
class Guides(LiveCase):
    make_media = staticmethod(media)

    @classmethod
    def seed(cls) -> None:
        # What 0.138 wrote for a 2-point file: mode "2", the two points at different heights.
        old = {cls.ids["c_old.png"]: {"mode": "2", "snap": 10, "v": [], "h": [], "pts": {"2": [[200, 100], [1000, 200]]},
                                      "dens": [8, 8, 8]}}
        cls.ui_settings = {**LiveCase.ui_settings, "sight.guides": json.dumps(old)}

    def test_grid(self) -> None:
        self.assertReport(self.run_page("guides_e2e.cjs", timeout=300), min_checks=20)

    def test_perspective(self) -> None:
        self.assertReport(self.run_page("guides_persp_e2e.cjs", timeout=300), min_checks=25)


if __name__ == "__main__":
    unittest.main()
