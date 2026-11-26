"""Shared set-up of the R0-0 regression tests (docs/PLAN-coreline.md, "R0-0 first — a safety net").

They pin Sight desktop's lightbox / annotator behaviour as it is *before* the R0 refactor, so each R0 step can
prove it changed nothing. Every test runs Sight's server in-process on a temporary library (never the user's
live one) with media made here, and drives the page with a node script (Playwright, Chromium) that prints a JSON
report: `checks` (name -> {ok, got, want}), page `errors`, and `done` once it ran to the end.

    python -m unittest tests.test_r0_lightbox            # one block
    SIGHT_REQUIRE_E2E=1 python -m unittest tests.test_r0_lightbox   # a missing node / Playwright / ffmpeg fails

Without node + Playwright (or ffmpeg where a test needs video) the tests skip, like the older e2e tests; with
SIGHT_REQUIRE_E2E=1 a missing tool is a failure instead, so "green" cannot hide a test that never ran.
"""
from __future__ import annotations

import json
import os
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.library import Library  # noqa: E402

NODE = shutil.which("node")
FFMPEG = shutil.which("ffmpeg")


def _has_playwright() -> bool:
    return bool(NODE) and subprocess.run([NODE, "-e", "require('playwright')"], capture_output=True,
                                         cwd=ROOT / "tests").returncode == 0


HAS_PLAYWRIGHT = _has_playwright()


def needs(ffmpeg: bool = False, psd: bool = False, usd: bool = False):
    """Class decorator: skip (or, with SIGHT_REQUIRE_E2E=1, fail) when a tool the test needs is missing."""
    missing = []
    if not HAS_PLAYWRIGHT:
        missing.append("node with Playwright")
    if ffmpeg and not FFMPEG:
        missing.append("ffmpeg")
    if psd:
        try:
            import psd_tools  # noqa: F401
        except ImportError:
            missing.append("psd-tools")
    if usd:
        try:
            import pxr  # noqa: F401  (usd-core: the server's .usdz -> GLB conversion)
        except ImportError:
            missing.append("usd-core")

    def wrap(cls):
        if not missing:
            return cls
        why = "R0-0 test needs " + ", ".join(missing)
        if os.environ.get("SIGHT_REQUIRE_E2E") == "1":
            def fail(self):  # noqa: ANN001
                self.fail(why)
            cls.setUpClass = classmethod(lambda c: None)
            cls.tearDownClass = classmethod(lambda c: None)
            for name in [n for n in dir(cls) if n.startswith("test")]:
                setattr(cls, name, fail)
            return cls
        return unittest.skip(why)(cls)
    return wrap


# ---- media made here (no imaging library needed for PNGs) -----------------------------------------------
def png(w: int, h: int, rgb: tuple[int, int, int]) -> bytes:
    """A plain one-colour PNG."""
    return png_rows(w, h, lambda y: bytes(rgb) * w)


def png_quadrants(w: int, h: int) -> bytes:
    """A PNG in four colour quadrants (red, green / blue, white), so a pixel read tells where it came from."""
    def row(y: int) -> bytes:
        top = y < h // 2
        left, right = ((220, 40, 40), (40, 200, 60)) if top else ((40, 60, 220), (240, 240, 240))
        return bytes(left) * (w // 2) + bytes(right) * (w - w // 2)
    return png_rows(w, h, row)


def png_rows(w: int, h: int, row) -> bytes:
    def chunk(t: bytes, d: bytes) -> bytes:
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    raw = b"".join(b"\x00" + row(y) for y in range(h))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def make_psd(path: Path) -> None:
    """A 400 x 300 PSD: a full red layer "Red" and a 200 x 150 blue layer "Blue" at (60, 50)."""
    from PIL import Image
    from psd_tools import PSDImage
    from psd_tools.api.layers import PixelLayer
    psd = PSDImage.new("RGB", (400, 300), color=(255, 255, 255))
    psd.append(PixelLayer.frompil(Image.new("RGB", (400, 300), (200, 30, 30)), psd, "Red"))
    psd.append(PixelLayer.frompil(Image.new("RGBA", (200, 150), (30, 30, 200, 255)), psd, "Blue", top=50, left=60))
    psd.save(str(path))


def make_video(path: Path, w: int = 320, h: int = 240, fps: int = 25, secs: float = 2.0, *, codec: str = "h264",
               gop: int | None = None, audio: bool = False, sar: str | None = None) -> None:
    """A test-pattern clip (ffmpeg's testsrc: a frame counter is drawn on it). codec: h264 (MP4), mpeg1 (an
    MPEG program stream the browser cannot decode). sar: a sample aspect ratio ("2:1") for a clip whose display
    size differs from its stored pixels."""
    vf = f"testsrc=size={w}x{h}:rate={fps}:duration={secs}"
    cmd = [FFMPEG, "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-f", "lavfi", "-i", vf]
    if audio:
        cmd += ["-f", "lavfi", "-i", f"sine=frequency=440:sample_rate=48000:duration={secs}"]
    if codec == "mpeg1":
        cmd += ["-c:v", "mpeg1video", "-b:v", "800k"] + (["-c:a", "mp2"] if audio else []) + ["-f", "mpeg"]
    else:
        cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p"] + (["-g", str(gop)] if gop else [])
        if sar:
            cmd += ["-vf", "setsar=" + sar.replace(":", "/")]   # ("2:1" would read as sar=2, max=1)
        cmd += (["-c:a", "aac", "-b:a", "96k"] if audio else []) + ["-movflags", "+faststart"]
    subprocess.run(cmd + [str(path)], check=True, timeout=180)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


# ---- the server ----------------------------------------------------------------------------------------
class LiveCase(unittest.TestCase):
    """Base class: a temporary library holding the files `make_media(folder)` writes, served on a free port.

    Subclasses set `make_media` (a staticmethod writing files into the folder) and may override `seed()` (rows,
    boards … through self.lib). `cls.ids` maps file name -> asset id. `run_page(script, **cfg)` runs a node
    script with {"base": url, "ids": ids, **cfg} as its JSON argument and returns its parsed report."""

    make_media = None
    expect_files = 0  # how many assets must be ready before the server starts (0 = all files written)
    # UI settings the temporary library starts with (its settings.json; the page's server copy wins over
    # localStorage). The grid's default order is the scan order, i.e. the file system's readdir order
    # (alphabetical on NTFS, hashed on ext4, reverse creation on tmpfs), so tests pin it to Name.
    ui_settings = {"sight.sort": json.dumps({"key": "name", "dir": "asc"})}

    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = Path(tempfile.mkdtemp(prefix="sight-r0-"))
        cls.lib = None
        cls.server = None
        try:
            cls._start()
        except BaseException:
            cls.tearDownClass()
            raise

    @classmethod
    def _start(cls) -> None:
        import uvicorn
        from app.server import build_app

        home = cls.tmp / "home"
        home.mkdir()
        (home / "settings.json").write_text(json.dumps({"ui": dict(cls.ui_settings), "window": None}), encoding="utf-8")
        cls.lib = Library(home)
        media = cls.tmp / "media"
        media.mkdir()
        cls.make_media(media)
        want = cls.expect_files or len([p for p in media.rglob("*") if p.is_file()])
        sid = cls.lib.add_source(str(media))["id"]
        ready = lambda: len(cls.lib.query("SELECT id FROM assets WHERE source_id=? AND status='ready'", (sid,)))  # noqa: E731
        deadline = time.time() + 90
        while time.time() < deadline and ready() < want:
            time.sleep(0.1)
        if ready() < want:
            raise RuntimeError(f"only {ready()} of {want} files were scanned and ready")
        cls.ids = {r["name"]: r["id"] for r in cls.lib.query("SELECT id, name FROM assets WHERE source_id=?", (sid,))}
        cls.seed()
        cls.port = free_port()
        cls.server = uvicorn.Server(uvicorn.Config(build_app(cls.lib), host="127.0.0.1", port=cls.port, log_level="warning"))
        cls.thread = threading.Thread(target=cls.server.run, daemon=True)
        cls.thread.start()
        for _ in range(400):
            if cls.server.started:
                break
            time.sleep(0.05)
        if not cls.server.started:
            raise RuntimeError("Sight's server did not start")

    @classmethod
    def seed(cls) -> None:
        pass

    @classmethod
    def tearDownClass(cls) -> None:
        if getattr(cls, "server", None):
            cls.server.should_exit = True
            cls.thread.join(5)
        if getattr(cls, "lib", None):
            for w in list(cls.lib._watchers.values()):  # (the folder watcher would see the clean-up after the close)
                w.stop()
            cls.lib.close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def run_page(self, script: str, timeout: int = 300, **cfg) -> dict:
        # Every script starts from the class's UI settings: one script's synced settings (the notes panel left
        # open, a filter) must not change the next one's layout (a golden's fit scale) or behaviour.
        import urllib.request
        req = urllib.request.Request(self.base + "/api/settings/ui", data=json.dumps(dict(self.ui_settings)).encode(),
                                     method="PUT", headers={"content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            self.assertEqual(resp.status, 200)
        arg = json.dumps({"base": self.base, "ids": self.ids, "shots": os.environ.get("SIGHT_TEST_SHOTS", ""), **cfg})
        # (utf-8: node writes UTF-8, and on Windows text=True alone decodes with the ANSI code page)
        r = subprocess.run([NODE, str(ROOT / "tests" / script), arg], capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=timeout, cwd=ROOT / "tests")
        try:
            res = json.loads(r.stdout.strip().splitlines()[-1])
        except (ValueError, IndexError):
            self.fail(f"{script}: no report (exit {r.returncode})\n{r.stdout[-3000:]}\n{r.stderr[-3000:]}")
        if os.environ.get("SIGHT_R0_REPORT"):  # a folder: the whole report is written there (debugging)
            Path(os.environ["SIGHT_R0_REPORT"], Path(script).stem + ".json").write_text(json.dumps(res, indent=1), encoding="utf-8")
        return res

    def assertReport(self, res: dict, min_checks: int) -> None:
        """The script ran to its end, the page threw nothing, every check held, and enough of them ran."""
        bad = {k: v for k, v in res.get("checks", {}).items() if not v.get("ok")}
        self.assertFalse(res.get("fatal"), f"{res.get('fatal')}\nfailed checks so far: {json.dumps(bad, indent=1)[:4000]}"
                                           f"\npage errors: {res.get('errors')}")
        self.assertEqual(bad, {}, json.dumps(bad, indent=1)[:6000])
        self.assertEqual(res.get("errors"), [], res.get("errors"))
        self.assertTrue(res.get("done"), "the page script did not run to its end")
        self.assertGreaterEqual(len(res.get("checks", {})), min_checks, sorted(res.get("checks", {})))
