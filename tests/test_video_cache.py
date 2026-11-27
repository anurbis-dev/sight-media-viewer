"""SlidingVideoCache (library.py): the RAM window around a playhead — the ahead share (Settings), loading outwards
from the playhead, and a sequence's neighbours taking the part past the clip's end / start.

    python -m unittest tests.test_video_cache
"""
from __future__ import annotations

import json
import shutil
import subprocess
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
        self.c._thread.join(timeout=5)  # the loader may still hold a file open (Windows cannot delete it then)
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

    def _halt_loader(self) -> None:
        """Stop the background loader so a test can plant blocks and read them back unchanged."""
        with self.c.cv:
            self.c._stop = True
            self.c.cv.notify_all()
        self.c._thread.join(timeout=5)

    def test_older_generation_keeps_the_windows(self) -> None:
        a, b, c = self.files["a"], self.files["b"], self.files["c"]
        self.assertTrue(self.c.focus_many([(a, 10 * MB), (b, 10 * MB)], gen=2))
        self.assertEqual(set(self.c.wins), {a, b})
        self.assertFalse(self.c.focus(a, 10 * MB, gen=1))  # a late lightbox post
        self.assertFalse(self.c.release(1))
        self.assertEqual(set(self.c.wins), {a, b})
        self.assertTrue(self.c.focus(c, 0, gen=2))  # the same generation still follows the playhead
        self.assertEqual(set(self.c.wins), {c})
        self.assertTrue(self.c.release(3))
        self.assertEqual(self.c.wins, {})
        self.assertTrue(self.c.focus(a, 0))  # no generation (older client, a settings post) still applies
        self.assertEqual(set(self.c.wins), {a})

    def test_snapshot_spans_are_loaded_blocks(self) -> None:
        # The green on a timeline is these spans. The planned window must not show up before the bytes are in RAM,
        # and a hole between runs must stay a hole. start/end remains the one run that contains the playhead.
        self._halt_loader()
        self.c.focus(self.files["a"], 50 * MB, self.files["b"])
        self.assertTrue(self.ranges("a"))  # a window is planned
        empty = self.c.snapshot(self.files["a"])
        self.assertEqual(empty["spans"], [])
        self.assertEqual(empty["start"], empty["end"])
        self.assertGreater(empty["size"], 0)
        with self.c.lock:
            w = self.c.wins[self.files["a"]]
            for k in (10, 48, 49, 50, 52):
                w.blocks[k] = b"a"
        many = self.c.snapshots([self.files["a"], self.files["b"], self.files["c"]])
        self.assertEqual(many[self.files["a"]]["spans"], [
            [10 * MB, 11 * MB],
            [48 * MB, 51 * MB],
            [52 * MB, 53 * MB],
        ])
        self.assertEqual((many[self.files["a"]]["start"], many[self.files["a"]]["end"]), (48 * MB, 51 * MB))
        self.assertEqual(many[self.files["b"]]["spans"], [])  # neighbour slot, nothing read yet
        self.assertGreater(many[self.files["b"]]["size"], 0)
        self.assertEqual(many[self.files["c"]]["spans"], [])
        self.assertEqual(many[self.files["c"]]["size"], 0)  # no window: nothing to draw
        self.assertEqual(many[self.files["a"]]["bytes"], many[self.files["c"]]["bytes"])
        self.assertEqual(many[self.files["a"]]["bytes"], 5)

    def test_auto_budget_and_no_cap(self) -> None:
        # 0 = Auto: available RAM minus 2 GB (ShotGrid / Coreline media cache). A typed size is the cap;
        # 32 MB at least, no 2048 MB ceiling.
        orig = SlidingVideoCache.available_bytes
        SlidingVideoCache.available_bytes = staticmethod(lambda: 10 * 1024 ** 3)
        try:
            self.c.configure(0)
            self.assertEqual(self.c.limit_mb, 0)
            self.assertEqual(self.c.budget_mb, 10 * 1024 - 2048)
            self.c.configure(4096)
            self.assertEqual(self.c.limit_mb, 4096)
            self.assertEqual(self.c.budget_mb, 4096)
            self.c.configure(16)
            self.assertEqual(self.c.budget_mb, 32)
            self.c.configure("nope")
            self.assertEqual(self.c.limit_mb, 0)
            self.assertEqual(self.c.budget_mb, 10 * 1024 - 2048)
            SlidingVideoCache.available_bytes = staticmethod(lambda: 512 * 1024 * 1024)
            self.c.configure(0)
            self.assertEqual(self.c.budget_mb, 32)
        finally:
            SlidingVideoCache.available_bytes = orig
        self.assertGreater(SlidingVideoCache.available_bytes(), 0)

    def test_stream_from_neighbour(self) -> None:
        self.c.focus(self.files["a"], 95 * MB, self.files["b"])
        self.wait()
        data = b"".join(self.c.stream(self.files["b"], 0, 3 * MB))
        self.assertEqual(data, b"b" * (3 * MB))


class CacheBarHtml(unittest.TestCase):
    """The shared painter (video-cache-bar.js): loaded spans only, same for the lightbox and compare."""

    def test_spans_paint_and_start_end_does_not(self) -> None:
        node = shutil.which("node")
        if not node:
            self.skipTest("node is not installed")
        script = Path(__file__).resolve().parent / "cache_bar_unit.mjs"
        r = subprocess.run([node, str(script)], capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr or r.stdout)
        out = json.loads(r.stdout)
        self.assertTrue(out["ok"])
        self.assertIn("width:10.000%", out["partial"])
        self.assertEqual(out["nostart"], "")
        self.assertEqual(out["empty"], "")
        self.assertIn("width:100.000%", out["full"])


if __name__ == "__main__":
    unittest.main()
