"""Lightbox guides (app/static/guides.js): the grid's rulers outside the picture, Ctrl+click / long-press delete,
Shift+H with the drawings, the menu; perspective. tests/guides_e2e.cjs drives the page; the checks are listed there.

    SIGHT_REQUIRE_E2E=1 python -m unittest tests.test_guides
"""
from __future__ import annotations

import unittest

from tests.r0_harness import LiveCase, needs, png, png_quadrants


def media(folder):
    (folder / "a_small.png").write_bytes(png(600, 400, (90, 110, 130)))      # zoomed to 100 %: margins all round
    (folder / "b_big.png").write_bytes(png_quadrants(1600, 1000))


@needs()
class Guides(LiveCase):
    make_media = staticmethod(media)

    def test_guides(self) -> None:
        self.assertReport(self.run_page("guides_e2e.cjs", timeout=300), min_checks=20)


if __name__ == "__main__":
    unittest.main()
