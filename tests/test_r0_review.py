"""R0-0 block 3 (docs/PLAN-coreline.md, "R0-0 first — a safety net"): the annotator's plumbing as it behaves before
the R0 refactor — the durable write queue, the settings round trip through the server, screenshots / reference
images, note previews and dictation. The page scripts list their checks:

  tests/r0_queue_e2e.cjs      offline -> kept -> online -> saved; a stale window's outbox adopted; the pagehide
                              keepalive beacon; sight.annotate.* settings through the server and back, hydrateSettings
  tests/r0_shots_e2e.cjs      screenshots (whole view, an area), reference images (file picker, a drop from the library
                              split, the selected ones), note previews (pictures, stored video frames), dictation

    python -m unittest tests.test_r0_review
"""
from __future__ import annotations

import unittest

from tests.r0_harness import LiveCase, make_video, needs, png, png_quadrants


def media(folder):
    (folder / "q_pic.png").write_bytes(png(1200, 800, (60, 70, 90)))
    (folder / "q_pic2.png").write_bytes(png(1200, 800, (90, 70, 60)))
    (folder / "q_pic3.png").write_bytes(png(1200, 800, (70, 90, 60)))
    make_video(folder / "q_clip.mp4", 320, 240, 25, 4)
    (folder / "s_pic.png").write_bytes(png_quadrants(1600, 1000))      # previews: bigger than a card's still
    (folder / "s_ref.png").write_bytes(png_quadrants(300, 200))        # a picture to bring in as a reference
    make_video(folder / "s_clip.mp4", 320, 240, 25, 4)


@needs(ffmpeg=True)
class R0Review(LiveCase):
    make_media = staticmethod(media)

    def test_queue_and_settings(self) -> None:
        self.assertReport(self.run_page("r0_queue_e2e.cjs"), min_checks=50)

    def test_shots_refs_previews_dictation(self) -> None:
        self.assertReport(self.run_page("r0_shots_e2e.cjs", media=str(self.tmp / "media")), min_checks=40)


if __name__ == "__main__":
    unittest.main()
