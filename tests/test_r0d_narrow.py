"""R0d (docs/PLAN-coreline.md decision 6): the narrow layout — below 600 px of the host's own width the notes panel
goes under the player; wide stays as it was. tests/r0d_narrow_e2e.cjs drives the page; the checks are listed there.

    python -m unittest tests.test_r0d_narrow
"""
from __future__ import annotations

import unittest

from tests.r0_harness import LiveCase, make_video, needs, png_quadrants


def media(folder):
    (folder / "n_pic.png").write_bytes(png_quadrants(1600, 1000))
    make_video(folder / "n_clip.mp4", 320, 240, 25, 2)


@needs(ffmpeg=True)
class R0dNarrow(LiveCase):
    make_media = staticmethod(media)

    def test_narrow_layout(self) -> None:
        self.assertReport(self.run_page("r0d_narrow_e2e.cjs", timeout=300), min_checks=40)


if __name__ == "__main__":
    unittest.main()
