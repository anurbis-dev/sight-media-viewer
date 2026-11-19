"""Playback copies for video the browser cannot decode (app/library.py, "playback copies").

    python -m unittest tests.test_playback_copy

Old MPEG-1/2 program streams, DivX, WMV ... are converted by ffmpeg to H.264 (MP4) once; the copy is
named after the source's size and mtime, so a changed source makes it stale. Everything runs in a
temporary folder; skipped when no ffmpeg is found.
"""
from __future__ import annotations

import array
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path

from app.library import Library, find_ffmpeg


class PlaybackCopyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.ffmpeg = find_ffmpeg()
        if not cls.ffmpeg:
            raise unittest.SkipTest("no ffmpeg")

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="sight-play-"))
        self.lib = Library(self.tmp / "home")
        self.media = self.tmp / "media"
        self.media.mkdir()

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _make_mpeg1(self, name: str, seconds: int = 1) -> Path:
        out = self.media / name
        subprocess.run(
            [self.ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
             "-f", "lavfi", "-i", f"testsrc=size=320x240:rate=25:duration={seconds}",
             "-c:v", "mpeg1video", "-b:v", "800k", "-f", "mpeg", str(out)],
            check=True, timeout=120,
        )
        return out

    def _asset(self, aid: str, path: Path) -> dict:
        return {"id": aid, "kind": "video", "path": str(path)}

    def _convert(self, a: dict, tag: str = "") -> dict:
        """Runs the conversion synchronously (the thread body) and returns the job's final state."""
        stamp = self.lib._play_stamp(a["path"])
        enc = self.lib._copy_encoder(self.ffmpeg, tag)
        self.assertIsNotNone(enc, "ffmpeg has neither libx264 nor libvpx-vp9 + libopus")
        job = {"stamp": stamp, "state": "working", "progress": 0.0, "error": ""}
        self.lib._play_jobs[a["id"] + tag] = job
        self.lib._run_playback_copy(a["id"], a["path"], stamp, self.ffmpeg, enc, 0.0, job, tag)
        return job

    def _keyframes(self, path: Path) -> list[bool]:
        out = subprocess.run(
            [self.ffmpeg, "-hide_banner", "-nostdin", "-i", str(path), "-vf", "showinfo", "-f", "null", "-"],
            capture_output=True, text=True, timeout=120,
        ).stderr
        return [m == "1" for m in re.findall(r"iskey:([01])", out)]

    def test_scrub_copy_has_a_short_gop_and_lives_beside_the_playback_copy(self) -> None:
        # A long-GOP H.264 clip (one keyframe in 4 s): slow to seek in the browser mid-GOP.
        src = self.media / "long_gop.mp4"
        subprocess.run(
            [self.ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
             "-f", "lavfi", "-i", "testsrc=size=320x640:rate=25:duration=4",
             "-c:v", "libx264", "-g", "250", "-pix_fmt", "yuv420p", str(src)],
            check=True, timeout=120,
        )
        a = self._asset("cccccccccccccccc", src)
        tag = self.lib.SCRUB_TAG
        self.assertEqual(self._convert(a, tag)["state"], "ready")
        scrub = self.lib._play_copy(a["id"], self.lib._play_stamp(str(src)), tag)
        self.assertIsNotNone(scrub)
        self.assertTrue(scrub.name.endswith(".scrub" + scrub.suffix))
        self.assertEqual(self.lib.playback_path(a), str(src), "a scrub copy is never what the player plays")
        keys = self._keyframes(scrub)
        self.assertGreaterEqual(len(keys), 90)
        gaps = [i for i, k in enumerate(keys) if k]
        self.assertLessEqual(max(b - a for a, b in zip(gaps, gaps[1:])), 4, "a keyframe every 4 frames at most")

        # A playback copy made afterwards keeps the scrub copy, and the other way round.
        self.assertEqual(self._convert(a)["state"], "ready")
        play = Path(self.lib.playback_path(a))
        self.assertTrue(scrub.exists() and play.exists())
        self.assertEqual(self._convert(a, tag)["state"], "ready")
        self.assertTrue(scrub.exists() and play.exists())

    def test_mpeg1_program_stream_gets_a_copy_the_player_reads(self) -> None:
        src = self._make_mpeg1("old.mpg")
        a = self._asset("0123456789abcdef", src)
        self.assertEqual(self.lib.playback_path(a), str(src), "no copy yet: the source is served")

        job = self._convert(a)
        self.assertEqual(job["state"], "ready", job["error"])
        copy = Path(self.lib.playback_path(a))
        self.assertNotEqual(copy, src)
        self.assertIn(copy.suffix, (".mp4", ".webm"))
        self.assertTrue(copy.name.startswith("0123456789abcdef_"))

        try:  # ffprobe ships with ffmpeg on most installs; without it the codec check is skipped
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name",
                 "-of", "json", str(copy)],
                capture_output=True, text=True, timeout=60,
            )
        except FileNotFoundError:
            return
        if probe.returncode == 0:
            streams = json.loads(probe.stdout or "{}").get("streams", [])
            self.assertEqual([s["codec_name"] for s in streams], ["h264" if copy.suffix == ".mp4" else "vp9"])

    def test_a_changed_source_makes_the_copy_stale_and_old_copies_are_removed(self) -> None:
        src = self._make_mpeg1("old.mpg")
        a = self._asset("aaaaaaaaaaaaaaaa", src)
        self.assertEqual(self._convert(a)["state"], "ready")
        first = Path(self.lib.playback_path(a))
        self.assertTrue(first.exists())

        # Same name, new content: a different size / mtime means a different stamp.
        self._make_mpeg1("old.mpg", seconds=2)
        self.assertEqual(self.lib.playback_path(a), str(src), "stale copy must not be served")
        self.assertEqual(self._convert(a)["state"], "ready")
        second = Path(self.lib.playback_path(a))
        self.assertNotEqual(second, first)
        self.assertTrue(second.exists())
        self.assertFalse(first.exists(), "copies of earlier versions are removed")

    def test_scrub_copies_are_capped_oldest_first_never_the_new_one(self) -> None:
        d = self.lib.thumbs / "video"
        d.mkdir(parents=True, exist_ok=True)
        old = []
        for i in range(4):
            p = d / f"{i:016x}_1_{i}.scrub.mp4"
            p.write_bytes(b"x" * 100)
            os.utime(p, (1000 + i, 1000 + i))
            old.append(p)
        part = d / "ffffffffffffffff_1_1.scrub.part"
        part.write_bytes(b"x" * 10_000)
        new = d / "eeeeeeeeeeeeeeee_1_1.scrub.mp4"
        new.write_bytes(b"x" * 500)
        os.utime(new, (10, 10))  # older mtime than all, still kept: it is the one just made
        self.lib.SCRUB_KEEP_FILES = 3
        self.lib.SCRUB_KEEP_BYTES = 10_000
        self.lib._prune_scrub_copies(new)
        self.assertTrue(new.exists() and part.exists())
        self.assertEqual([p.exists() for p in old], [False, False, True, True], "the two newest others stay")
        self.lib.SCRUB_KEEP_FILES = 20
        self.lib.SCRUB_KEEP_BYTES = 50  # below the new copy alone: everything else goes, the new one stays
        self.lib._prune_scrub_copies(new)
        self.assertTrue(new.exists())
        self.assertFalse(any(p.exists() for p in old))

    def test_no_scrub_copy_until_one_is_made(self) -> None:
        # What GET /api/video/scrub/{id} (404 without a copy) and GET /api/video/scrub stand on.
        # (No HTTP client here: the runtime has no httpx for Starlette's TestClient.)
        self._make_mpeg1("clip.mpg")
        sid = self.lib.add_source(str(self.media))["id"]
        deadline, rows = time.time() + 30, []
        while time.time() < deadline and not rows:
            rows = self.lib.query("SELECT id FROM assets WHERE source_id=? AND status='ready'", (sid,))
            time.sleep(0.2)
        try:
            self.assertTrue(rows, "the clip was not scanned")
            aid = rows[0]["id"]
            self.assertIsNone(self.lib.scrub_copy_path(aid))
            self.assertIsNone(self.lib.scrub_copy_path("0000000000000000"))
            self.assertEqual(self.lib.scrub_status(aid)["state"], "none")
            self.assertEqual(self.lib.scrub_status("0000000000000000")["state"], "missing")
        finally:
            for w in list(self.lib._watchers.values()):  # the folder watcher would outlive the folder
                w.stop()
                w.join(5)
            self.lib.close()

    def test_a_playback_copy_does_not_wait_for_a_running_scrub_encode(self) -> None:
        # A scrub encode of a long clip holds the one-at-a-time slot; a playback copy asked after it
        # (the user waits on "Converting…") stops it and runs at once; the scrub job is told to start over.
        lavfi = lambda secs: [self.ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-f", "lavfi",
                              "-i", f"testsrc=size=1280x720:rate=25:duration={secs}", "-f", "null", "-"]
        log_dir = self.tmp / "logs"
        log_dir.mkdir()
        got = {}
        scrub = threading.Thread(target=lambda: got.setdefault("scrub", self.lib._encode_copy(
            lavfi(3600), log_dir / "s.log", 0.0, {"progress": 0}, True)))
        scrub.start()
        deadline = time.time() + 20
        while self.lib._scrub_proc is None and time.time() < deadline:
            time.sleep(0.05)
        self.assertIsNotNone(self.lib._scrub_proc, "the scrub encode did not start")
        t0 = time.time()
        rc = self.lib._encode_copy(lavfi(1), log_dir / "p.log", 0.0, {"progress": 0}, False)
        took = time.time() - t0
        scrub.join(20)
        self.assertEqual(rc, 0)
        self.assertLess(took, 15, "the playback copy waited for the scrub encode")
        self.assertFalse(scrub.is_alive())
        self.assertIsNone(got.get("scrub", "unset"), "a stopped scrub encode returns None (start over)")
        self.assertIsNone(self.lib._scrub_proc)
        self.assertEqual(self.lib._play_waiting, 0)
        self.assertEqual(self.lib._play_active, 0)

    def test_scrub_encodes_of_several_clips_overlap(self) -> None:
        # A compare asks for every clip's scrub copy at once. Two encodes must be inside ffmpeg
        # together — a single slot would make the second wait until the first finished.
        lavfi = lambda secs: [self.ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-f", "lavfi",
                              "-i", f"testsrc=size=320x180:rate=25:duration={secs}", "-f", "null", "-"]
        log_dir = self.tmp / "logs"
        log_dir.mkdir()
        overlapped = threading.Event()

        def watch() -> None:
            deadline = time.time() + 20
            while time.time() < deadline:
                if len(self.lib._scrub_procs) >= 2:
                    overlapped.set()
                    return
                time.sleep(0.02)

        threading.Thread(target=watch, daemon=True).start()
        done: dict[str, int | None] = {}

        def run(name: str) -> None:
            done[name] = self.lib._encode_copy(lavfi(3), log_dir / f"{name}.log", 0.0, {"progress": 0}, True)

        threads = [threading.Thread(target=run, args=(n,)) for n in ("a", "b")]
        for t in threads:
            t.start()
        self.assertTrue(overlapped.wait(20), "the two scrub encodes never ran together")
        for t in threads:
            t.join(30)
        self.assertEqual(done.get("a"), 0)
        self.assertEqual(done.get("b"), 0)
        self.assertEqual(len(self.lib._scrub_procs), 0)
        self.assertIsNone(self.lib._scrub_proc)

    def test_a_playback_copy_stops_every_running_scrub_encode(self) -> None:
        lavfi = lambda secs: [self.ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-f", "lavfi",
                              "-i", f"testsrc=size=320x180:rate=25:duration={secs}", "-f", "null", "-"]
        log_dir = self.tmp / "logs2"
        log_dir.mkdir()
        got: dict[str, int | None] = {}

        def run(name: str) -> None:
            got[name] = self.lib._encode_copy(lavfi(3600), log_dir / f"{name}.log", 0.0, {"progress": 0}, True)

        threads = [threading.Thread(target=run, args=(n,)) for n in ("a", "b")]
        for t in threads:
            t.start()
        deadline = time.time() + 20
        while len(self.lib._scrub_procs) < 2 and time.time() < deadline:
            time.sleep(0.05)
        self.assertGreaterEqual(len(self.lib._scrub_procs), 2, "both scrub encodes did not start")
        t0 = time.time()
        rc = self.lib._encode_copy(lavfi(1), log_dir / "p.log", 0.0, {"progress": 0}, False)
        took = time.time() - t0
        for t in threads:
            t.join(20)
        self.assertEqual(rc, 0)
        self.assertLess(took, 15, "the playback copy waited for a scrub encode")
        self.assertIsNone(got.get("a", "unset"))
        self.assertIsNone(got.get("b", "unset"))
        self.assertEqual(len(self.lib._scrub_procs), 0)
        self.assertEqual(self.lib._play_waiting, 0)
        self.assertEqual(self.lib._play_active, 0)

    def test_a_stopped_scrub_encode_starts_over_and_finishes(self) -> None:
        src = self._make_mpeg1("clip.mpg")
        a = self._asset("dddddddddddddddd", src)
        real, calls = self.lib._encode_copy, []
        def once_stopped(*args):
            calls.append(args[-1])
            return None if len(calls) == 1 else real(*args)
        self.lib._encode_copy = once_stopped
        self.assertEqual(self._convert(a, self.lib.SCRUB_TAG)["state"], "ready")
        self.assertEqual(calls, [True, True])
        leftovers = sorted(p.suffix for p in (self.lib.thumbs / "video").iterdir())
        self.assertIn(leftovers, ([".mp4"], [".webm"]), "the copy only, no .part / .log left")

    def test_undecodable_file_reports_the_ffmpeg_error(self) -> None:
        junk = self.media / "junk.mpg"
        junk.write_bytes(b"this is not a video at all" * 100)
        a = self._asset("bbbbbbbbbbbbbbbb", junk)
        job = self._convert(a)
        self.assertEqual(job["state"], "failed")
        self.assertTrue(job["error"])
        self.assertEqual(self.lib.playback_path(a), str(junk))
        leftovers = [p.name for p in (self.lib.thumbs / "video").iterdir()] if (self.lib.thumbs / "video").exists() else []
        self.assertEqual(leftovers, [], "partial output and logs are cleaned up")

    def _add_video(self, aid: str, path: Path) -> None:
        st = path.stat()
        self.lib.execute(
            "INSERT INTO assets(id, source_id, path, name, ext, kind, size, mtime, added_at, status) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (aid, "src", str(path), path.name, path.suffix, "video", st.st_size, st.st_mtime, 1, "ready"),
        )

    def _wait_audio(self, aid: str) -> dict:
        last = None
        deadline = time.time() + 90
        while time.time() < deadline:
            last = self.lib.scrub_audio_status(aid)
            if last["state"] not in ("working", "none"):
                return last
            time.sleep(0.05)
        self.fail(f"scrub audio did not finish: {last}")

    def test_scrub_audio_is_a_pcm_cache_and_a_silent_clip_is_not(self) -> None:
        tone = self.media / "tone.mp4"
        subprocess.run(
            [self.ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
             "-f", "lavfi", "-i", "testsrc=size=160x120:rate=25:duration=2",
             "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2",
             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(tone)],
            check=True, timeout=120,
        )
        self._add_video("eeeeeeeeeeeeeeee", tone)
        self.assertEqual(self.lib.start_scrub_audio("eeeeeeeeeeeeeeee")["state"], "working")
        st = self._wait_audio("eeeeeeeeeeeeeeee")
        self.assertEqual(st["state"], "ready", st.get("error"))
        self.assertEqual(st["sr"], self.lib.SCRUB_AUDIO_SR)
        self.assertGreater(st["duration"], 1.2)
        self.assertLess(st["duration"], 2.8)
        pcm = self.lib.scrub_audio_path("eeeeeeeeeeeeeeee")
        self.assertIsNotNone(pcm)
        self.assertTrue(pcm.name.endswith(".scruba.pcm"))
        samples = array.array("h")
        raw = pcm.read_bytes()
        samples.frombytes(raw[: len(raw) - (len(raw) % 2)])
        step = samples[::40]
        energy = sum(abs(s) for s in step) / len(step)
        self.assertGreater(energy, 200, "the cached sound is silence")
        self.assertEqual(self.lib.start_scrub_audio("eeeeeeeeeeeeeeee")["state"], "ready")

        # A changed source drops the previous pcm (the stamp is in the name).
        time.sleep(0.02)
        os.utime(tone, None)
        self.lib.execute("UPDATE assets SET mtime=? WHERE id=?", (tone.stat().st_mtime, "eeeeeeeeeeeeeeee"))
        self.assertEqual(self.lib.start_scrub_audio("eeeeeeeeeeeeeeee")["state"], "working")
        st = self._wait_audio("eeeeeeeeeeeeeeee")
        self.assertEqual(st["state"], "ready", st.get("error"))
        left = [p.name for p in (self.lib.thumbs / "video").glob("eeeeeeeeeeeeeeee_*.scruba.pcm")]
        self.assertEqual(len(left), 1, left)

        silent = self.media / "silent.mp4"
        subprocess.run(
            [self.ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
             "-f", "lavfi", "-i", "testsrc=size=160x120:rate=25:duration=1",
             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", str(silent)],
            check=True, timeout=120,
        )
        self._add_video("ffffffffffffffff", silent)
        self.assertEqual(self.lib.start_scrub_audio("ffffffffffffffff")["state"], "working")
        st = self._wait_audio("ffffffffffffffff")
        self.assertEqual(st["state"], "silent", st)
        self.assertIsNone(self.lib.scrub_audio_path("ffffffffffffffff"))
        self.assertEqual(self.lib.start_scrub_audio("ffffffffffffffff")["state"], "silent")

    def test_playback_copy_does_not_delete_scrub_audio(self) -> None:
        src = self._make_mpeg1("with_pcm.mpg")
        aid = "abcdabcdabcdabcd"
        a = self._asset(aid, src)
        d = self.lib.thumbs / "video"
        d.mkdir(parents=True, exist_ok=True)
        pcm = d / f"{aid}_9_9.scruba.pcm"
        part = d / f"{aid}_9_9.scruba.part"
        pcm.write_bytes(b"\x01\x02" * 30)
        part.write_bytes(b"\x03\x04")
        self.assertEqual(self._convert(a)["state"], "ready")
        self.assertTrue(pcm.exists() and part.exists(), "a playback copy must leave scrub audio alone")
        self.assertTrue(self.lib.playback_path(a) != str(src))

    def test_scrub_audio_banner_without_a_listing_is_not_silent(self) -> None:
        kind = self.lib._scrub_audio_banner
        self.assertEqual(kind("x.mp4: Permission denied\n"), "failed")
        self.assertEqual(kind("Invalid data found when processing input\n"), "failed")
        self.assertEqual(kind("Input #0, mov, from 'a.mp4':\n  Stream #0:0: Video: h264\n"), "silent")
        self.assertEqual(kind("Input #0, mov, from 'a.mp4':\n  Stream #0:1: Audio: aac\n"), "audio")

    def test_scrub_audio_prune_keeps_the_newest(self) -> None:
        d = self.lib.thumbs / "video"
        d.mkdir(parents=True, exist_ok=True)
        keep = d / "keep_1.scruba.pcm"
        keep.write_bytes(b"\x00\x01" * 10)
        for i in range(24):
            p = d / f"old{i:02d}_1.scruba.pcm"
            p.write_bytes(b"\x00\x02" * 10)
            os.utime(p, (1, 1_000 + i))
        os.utime(keep, None)
        self.lib._prune_scrub_audio(keep)
        left = list(d.glob("*.scruba.pcm"))
        self.assertTrue(keep.exists())
        self.assertEqual(len(left), self.lib.SCRUB_AUDIO_KEEP_FILES)


if __name__ == "__main__":
    unittest.main()
