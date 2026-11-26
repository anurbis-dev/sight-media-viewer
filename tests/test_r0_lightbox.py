"""R0-0 block 1 (docs/PLAN-coreline.md, "R0-0 first — a safety net"): the 2D lightbox and the video transport as
they behave before the R0 refactor. tests/r0_lightbox_e2e.cjs drives the page; the checks are listed there.

    python -m unittest tests.test_r0_lightbox
"""
from __future__ import annotations

import time
import unittest

from tests.r0_harness import LiveCase, make_psd, make_video, needs, png, png_quadrants


def media(folder):
    (folder / "a_quad.png").write_bytes(png_quadrants(2400, 1600))   # bigger than the window: opens fitted
    for i in range(6):   # a second grid row (↑ / ↓ in the lightbox)
        (folder / f"h_fill{i}.png").write_bytes(png(160, 120, (60 + 20 * i, 80, 90)))
    (folder / "b_small.png").write_bytes(png(200, 100, (90, 90, 90)))
    make_psd(folder / "c_layers.psd")
    make_video(folder / "d_clip.mp4", 320, 240, 25, 4, audio=True)
    make_video(folder / "e_long.mp4", 1920, 1080, 25, 10, gop=250)   # one keyframe: slow seeks (the scrub copy)
    make_video(folder / "f_old.mpg", 320, 240, 25, 1, codec="mpeg1")  # not decodable: playback conversion
    make_video(folder / "g_30.mp4", 320, 240, 30, 2)


@needs(ffmpeg=True, psd=True)
class R0Lightbox(LiveCase):
    make_media = staticmethod(media)

    @classmethod
    def seed(cls) -> None:
        # d_clip.mp4: a note on 1.0 s (frame 25) and a loose drawing on 2.0 s (frame 50) — the timeline marks.
        now = int(time.time() * 1000)
        clip = cls.ids["d_clip.mp4"]
        cls.lib.add_annotation({"id": "a1" * 8, "kind": "note", "scope": "asset", "target_asset_id": clip,
                                "data": {"text": "on one second", "status": "open", "created": now, "ctx": {"t": 1.0}}})
        cls.lib.add_annotation({"id": "a2" * 8, "kind": "shape", "shape_kind": "rect", "scope": "asset", "target_asset_id": clip,
                                "data": {"color": "#ff3b30", "strokeOn": True, "width": 4, "fillOn": False, "opacity": 1,
                                         "x": 20, "y": 20, "w": 80, "h": 60, "note": None, "ctx": {"t": 2.0}, "created": now}})

    def test_lightbox_and_transport(self) -> None:
        self.assertReport(self.run_page("r0_lightbox_e2e.cjs", timeout=400), min_checks=156)


if __name__ == "__main__":
    unittest.main()
