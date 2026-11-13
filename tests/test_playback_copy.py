"""Playback copies for video the browser cannot decode (app/library.py, "playback copies").

    python -m unittest tests.test_playback_copy

Old MPEG-1/2 program streams, DivX, WMV ... are converted by ffmpeg to H.264 (MP4) once; the copy is
named after the source's size and mtime, so a changed source makes it stale. Everything runs in a
temporary folder; skipped when no ffmpeg is found.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
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

    def _convert(self, a: dict) -> dict:
        """Runs the conversion synchronously (the thread body) and returns the job's final state."""
        stamp = self.lib._play_stamp(a["path"])
        enc = self.lib._play_encoder(self.ffmpeg)
        self.assertIsNotNone(enc, "ffmpeg has neither libx264 nor libvpx-vp9 + libopus")
        job = {"stamp": stamp, "state": "working", "progress": 0.0, "error": ""}
        self.lib._play_jobs[a["id"]] = job
        self.lib._run_playback_copy(a["id"], a["path"], stamp, self.ffmpeg, enc, 0.0, job)
        return job

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


if __name__ == "__main__":
    unittest.main()
