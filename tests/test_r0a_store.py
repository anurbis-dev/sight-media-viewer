"""R0a (docs/PLAN-coreline.md): annotate.js under a host that is not Sight — a fake store in tests/r0a_host.html,
driven by tests/r0a_store_e2e.cjs (its header lists the checks). Sight's own behaviour stays pinned by the R0-0
tests (tests/test_r0_*.py).

    python -m unittest tests.test_r0a_store
"""
from __future__ import annotations

import unittest

from tests.r0_harness import LiveCase, needs, png


def media(folder):
    (folder / "r0a_pic.png").write_bytes(png(64, 64, (60, 70, 90)))


@needs()
class R0aStore(LiveCase):
    make_media = staticmethod(media)

    def test_fake_host_store(self) -> None:
        self.assertReport(self.run_page("r0a_store_e2e.cjs"), min_checks=10)


if __name__ == "__main__":
    unittest.main()
