"""SlidingVideoCache (library.py): the RAM window around a playhead — the ahead share (Settings), loading outwards
from the playhead, and a sequence's neighbours taking the part past the clip's end / start.

    python -m unittest tests.test_video_cache
"""
from __future__ import annotations

import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.library import SlidingVideoCache  # noqa: E402

MB = SlidingVideoCache.CHUNK


class VideoCache(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        d = Path(self.tmp.name)
        self.files = {}
        for name, blocks in (("a", 100), ("b", 100), ("c", 100)):
            p = d / f"{name}.mp4"
            p.write_bytes(bytes([ord(name)]) * (blocks * MB))
            self.files[name] = str(p)
        self.c = SlidingVideoCache(32)  # 32 blocks

    def tearDown(self) -> None:
        self.c.close()
        self.tmp.cleanup()

    def ranges(self, name: str) -> list[tuple[int, int]]:
        with self.c.lock:
            w = self.c.wins.get(self.files[name])
            return [(lo, hi) for lo, hi, _, _ in w.ranges] if w else []

    def wait(self) -> None:
        deadline = time.time() + 20
        while time.time() < deadline:
            with self.c.lock:
                if not self.c._missing():
                    return
            time.sleep(0.02)
        self.fail("the loader did not finish")

    def test_ahead_share(self) -> None:
        self.c.focus(self.files["a"], 50 * MB)
        self.assertEqual(self.ranges("a"), [(40, 71)])  # 70 % default: 22 ahead (50..71), 10 behind
        self.c.configure(ahead=60)
        self.assertEqual(self.ranges("a"), [(37, 68)])
        self.c.configure(ahead=999)  # clamped to 90 %
        self.assertEqual(self.ranges("a"), [(47, 78)])

    def test_order_outwards(self) -> None:
        self.c.focus(self.files["a"], 50 * MB)
        with self.c.lock:
            order = [k for _, k in reversed(self.c._missing())]
        self.assertEqual(order[0], 50)
        # Behind costs 7/3 of ahead: after 7 blocks ahead, about 3 behind — both ends are reached together.
        first10 = order[:10]
        self.assertEqual(sum(1 for k in first10 if k < 50), 3)
        self.assertEqual(set(order[-2:]) & {40, 71}, set(order[-2:]))

    def test_no_neighbour_other_side(self) -> None:
        self.c.focus(self.files["a"], 98 * MB)
        self.assertEqual(self.ranges("a"), [(68, 99)])
        self.c.focus(self.files["a"], 1 * MB)
        self.assertEqual(self.ranges("a"), [(0, 31)])

    def test_sequence_neighbours(self) -> None:
        # Near the end: the rest of the ahead part is the next clip's start.
        self.c.focus(self.files["a"], 95 * MB, self.files["b"], self.files["c"])
        self.assertEqual(self.ranges("a"), [(85, 99)])
        self.assertEqual(self.ranges("b"), [(0, 16)])
        self.assertEqual(self.ranges("c"), [])
        self.wait()
        # The cut: b plays from its start, its blocks stay, a (now previous) keeps its end.
        with self.c.lock:
            kept = set(self.c.wins[self.files["b"]].blocks)
        self.c.focus(self.files["b"], 0, self.files["c"], self.files["a"])
        self.assertEqual(self.ranges("b"), [(0, 21)])
        self.assertEqual(self.ranges("a"), [(90, 99)])
        with self.c.lock:
            self.assertTrue(kept <= set(self.c.wins[self.files["b"]].blocks))
            self.assertTrue({90, 99} <= set(self.c.wins[self.files["a"]].blocks))
        # Two clips looping: next and previous are the same file, one window with both ranges.
        self.c.focus(self.files["a"], 2 * MB, self.files["b"], self.files["b"])
        self.assertEqual(self.ranges("a"), [(0, 23)])
        self.assertEqual(self.ranges("b"), [(92, 99)])
        self.c.focus(self.files["a"], 99 * MB, self.files["b"], self.files["b"])
        self.assertEqual(sorted(self.ranges("b")), [(0, 20)])

    def test_short_neighbour(self) -> None:
        # A 5-block next clip holds 5 of the 12 blocks past the end; the other 7 go behind the playhead.
        p = Path(self.tmp.name) / "short.mp4"
        p.write_bytes(b"s" * (5 * MB))
        self.c.focus(self.files["a"], 99 * MB, str(p))
        self.assertEqual(self.ranges("a"), [(73, 99)])
        with self.c.lock:
            self.assertEqual([(lo, hi) for lo, hi, _, _ in self.c.wins[str(p)].ranges], [(0, 4)])
        # A short 2-clip loop partner: both ends share its blocks, none counted twice.
        self.c.focus(self.files["a"], 5 * MB, str(p), str(p))
        with self.c.lock:
            r = sorted((lo, hi) for lo, hi, _, _ in self.c.wins[str(p)].ranges)
            missing = self.c._missing()
        self.assertEqual(r, [(0, 4)] if len(r) == 1 else r)
        self.assertEqual(len(missing), len(set(missing)))
        self.assertLessEqual(sum(hi - lo + 1 for lo, hi in r), 5)

    def test_stream_from_neighbour(self) -> None:
        self.c.focus(self.files["a"], 95 * MB, self.files["b"])
        self.wait()
        data = b"".join(self.c.stream(self.files["b"], 0, 3 * MB))
        self.assertEqual(data, b"b" * (3 * MB))


if __name__ == "__main__":
    unittest.main()
