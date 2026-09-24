"""In-place library: fast metadata scan, viewport-first thumbnails."""

from __future__ import annotations

import fnmatch
import heapq
import json
import os
import queue
import re
import shutil
import sqlite3
import subprocess
import threading
import time
from pathlib import Path

from .fileinfo import file_info, obj_is_binary

IMAGE_EXT = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff",
    ".avif", ".heic", ".heif", ".svg", ".jxl", ".ico",
}
VIDEO_EXT = {".mp4", ".m4v", ".mov", ".mkv", ".webm", ".avi", ".wmv", ".mpg", ".mpeg"}
AUDIO_EXT = {".mp3", ".wav", ".flac", ".aac", ".m4a", ".ogg", ".opus", ".aiff"}
MODEL_EXT = {
    ".gltf", ".glb", ".fbx", ".obj", ".stl", ".usdz", ".ply",
    ".splat", ".spz", ".ksplat", ".sog",  # Gaussian splat formats (.ply overlaps with mesh PLY —
    # disambiguated client-side by sniffing the header, see isSplatAsset() in index.html)
}
# Files a model may reference by relative name (textures, glTF .bin) — see resolve_model_resource().
MODEL_RES_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tga", ".tif", ".tiff", ".dds", ".jp2", ".bin"}
MODEL_RES_CONVERT = {".tga", ".tif", ".tiff", ".dds", ".jp2"}  # not browser-decodable -> served as PNG
FONT_EXT = {".ttf", ".otf", ".woff", ".woff2"}
DOC_EXT = {".pdf", ".epub"}
TEXT_EXT = {
    ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".xml", ".yaml", ".yml",
    ".log", ".ini", ".cfg", ".toml",
}
DESIGN_EXT = {".psd", ".ai", ".sketch", ".fig", ".blend", ".indd"}
SKIP_DIRS = {
    ".git", "node_modules", "__pycache__", ".sight", ".svn", ".hg",
    ".Trash", ".trashes", "System Volume Information",
}
KIND_LABEL = {
    "image": "Images",
    "video": "Video",
    "audio": "Audio",
    "model3d": "3D",
    "document": "Documents",
    "font": "Fonts",
    "design": "Design",
}

# Bump when how models get rendered/thumbnailed changes enough that existing model thumbnails
# are wrong (see Library._drop_stale_model_thumbs). 3: studio env + single key light (all models).
MODEL_THUMB_VERSION = 3

PRI_VISIBLE = 0
PRI_PREFETCH = 1
THUMB_SIZE = 360
BATCH = 200


def kind_of(name: str) -> str | None:
    ext = Path(name).suffix.lower()
    if ext in IMAGE_EXT:
        return "image"
    if ext in VIDEO_EXT:
        return "video"
    if ext in AUDIO_EXT:
        return "audio"
    if ext in MODEL_EXT:
        return "model3d"
    if ext in FONT_EXT:
        return "font"
    if ext in DOC_EXT or ext in TEXT_EXT:
        return "document"
    if ext in DESIGN_EXT:
        return "design"
    return None


def asset_id(path: str) -> str:
    import hashlib

    return hashlib.sha1(path.encode("utf-8", "surrogateescape")).hexdigest()[:16]


def normpath(p: object) -> str:
    """Case/separator-normalized form of a filesystem path, for cross-platform prefix and
    equality checks (excluded-subfolder matching, source-boundary checks) without hitting disk."""
    return os.path.normcase(os.path.normpath(str(p)))


class IgnoreRules:
    """The user's scan ignore list (Settings → Scanning), one pattern per line, gitignore-like:
    `*.meta` / `Thumbs.db` match a file or folder name anywhere; a trailing `/` (`Library/`)
    matches folders only; a pattern with a `/` inside (`Library/PackageCache`) matches that run of
    names anywhere in the tree. `*`, `?` and `[..]` globs, case-insensitive; `#` starts a comment.
    Paths are taken relative to the source root, so the root's own name never matches."""

    def __init__(self, text: str = "") -> None:
        self.text = text or ""
        self.rules: list[tuple[list[str], bool]] = []
        for line in self.text.splitlines():
            line = line.strip().replace("\\", "/")
            if not line or line.startswith("#"):
                continue
            dir_only = line.endswith("/")
            parts = [x.lower() for x in line.strip("/").split("/") if x]
            if parts:
                self.rules.append((parts, dir_only))

    def leaf(self, parts: list[str], is_dir: bool) -> bool:
        """Does a rule match the last name in `parts` (a relative path split into names)?"""
        low = [x.lower() for x in parts]
        for pat, dir_only in self.rules:
            if dir_only and not is_dir:
                continue
            n = len(pat)
            if n <= len(low) and all(fnmatch.fnmatchcase(low[-n + i], pat[i]) for i in range(n)):
                return True
        return False

    def path(self, parts: list[str]) -> bool:
        """Is a file hidden by a rule on it or on any folder above it?"""
        if not self.rules:
            return False
        return any(self.leaf(parts[: i + 1], i < len(parts) - 1) for i in range(len(parts)))


def rel_parts(root: str | Path, p: str | Path) -> list[str] | None:
    try:
        rel = os.path.relpath(str(p), str(root))
    except ValueError:  # another drive
        return None
    if rel.startswith(".."):
        return None
    return [x for x in re.split(r"[\\/]+", rel) if x and x != "."]


ANIMATABLE_EXT = {".gif", ".webp", ".png"}
_ANIM_READ_BUDGET = 16 * 1024 * 1024

_TEXTURE_SUFFIX_SLOT: list[tuple[re.Pattern, str]] = [
    (re.compile(r"_(basecolor|albedo|diffuse|color|col)$", re.I), "map"),
    (re.compile(r"_(normal|nrm|norm)$", re.I), "normalMap"),
    (re.compile(r"_(roughness|rough)$", re.I), "roughnessMap"),
    (re.compile(r"_(metallic|metalness|metal)$", re.I), "metalnessMap"),
    (re.compile(r"_(ao|occlusion)$", re.I), "aoMap"),
    (re.compile(r"_(emissive|emission|emit)$", re.I), "emissiveMap"),
    (re.compile(r"_(opacity|alpha)$", re.I), "alphaMap"),
    (re.compile(r"_(height|bump|disp|displacement)$", re.I), "bumpMap"),
]


def is_animated(path: Path, ext: str) -> bool:
    """Cheap header sniff — no full decode. GIF: >=2 image descriptors (0x2C).
    WebP: ANIM flag in the extended VP8X header. PNG: an acTL chunk before the first IDAT."""
    ext = ext.lower()
    if ext not in ANIMATABLE_EXT:
        return False
    try:
        with open(path, "rb") as fh:
            if ext == ".gif":
                return _gif_animated(fh)
            if ext == ".webp":
                return _webp_animated(fh)
            return _png_animated(fh)
    except OSError:
        return False


def _gif_animated(fh) -> bool:
    head = fh.read(6)
    if head[:3] != b"GIF":
        return False
    lsd = fh.read(7)
    if len(lsd) < 7:
        return False
    packed = lsd[4]
    if packed & 0x80:
        fh.seek(3 * (2 ** ((packed & 0x07) + 1)), 1)
    images = 0
    budget = _ANIM_READ_BUDGET
    while budget > 0:
        intro = fh.read(1)
        budget -= 1
        if not intro or intro == b"\x3b":
            break
        if intro == b"\x21":
            fh.read(1)
            _skip_gif_subblocks(fh)
            continue
        if intro == b"\x2c":
            images += 1
            if images >= 2:
                return True
            desc = fh.read(9)
            if len(desc) < 9:
                return False
            lct_packed = desc[8]
            if lct_packed & 0x80:
                fh.seek(3 * (2 ** ((lct_packed & 0x07) + 1)), 1)
            fh.read(1)  # LZW min code size
            _skip_gif_subblocks(fh)
            continue
        break
    return False


def _skip_gif_subblocks(fh) -> None:
    while True:
        size = fh.read(1)
        if not size:
            return
        n = size[0]
        if n == 0:
            return
        fh.read(n)


def _webp_animated(fh) -> bool:
    head = fh.read(21)
    if len(head) < 21:
        return False
    if head[0:4] != b"RIFF" or head[8:12] != b"WEBP" or head[12:16] != b"VP8X":
        return False
    return bool(head[20] & 0x02)


def _png_animated(fh) -> bool:
    sig = fh.read(8)
    if sig != b"\x89PNG\r\n\x1a\n":
        return False
    budget = _ANIM_READ_BUDGET
    while budget > 0:
        head = fh.read(8)
        if len(head) < 8:
            return False
        length = int.from_bytes(head[0:4], "big")
        ctype = head[4:8]
        if ctype == b"acTL":
            return True
        if ctype == b"IDAT":
            return False
        fh.seek(length + 4, 1)  # data + CRC
        budget -= 8 + length + 4
    return False


def find_ffmpeg() -> str | None:
    for name in ("ffmpeg", "ffmpeg.exe"):
        hit = shutil.which(name)
        if hit:
            return hit
    for cand in (
        Path("/opt/homebrew/bin/ffmpeg"),
        Path("/usr/local/bin/ffmpeg"),
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "ffmpeg" / "bin" / "ffmpeg.exe",
    ):
        if cand.exists():
            return str(cand)
    try:
        import imageio_ffmpeg

        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and Path(exe).exists():
            return exe
    except Exception:
        pass
    return None


_MONO_FONT_CANDIDATES = (
    r"C:\Windows\Fonts\consola.ttf",
    "/System/Library/Fonts/Menlo.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/dejavu/DejaVuSansMono.ttf",
)
_mono_font_cache: dict[int, object] = {}


def _mono_font(size: int):
    if size in _mono_font_cache:
        return _mono_font_cache[size]
    from PIL import ImageFont

    font = None
    for cand in _MONO_FONT_CANDIDATES:
        if Path(cand).exists():
            try:
                font = ImageFont.truetype(cand, size)
                break
            except Exception:
                continue
    if font is None:
        font = ImageFont.load_default()
    _mono_font_cache[size] = font
    return font


def _thumb_resample(width: int, height: int):
    """Pillow's thumbnail() defaults to bicubic, which smooths icons/pixel art into mush on the
    way down — those are small to begin with, so nearest-neighbor keeps their edges crisp.
    Real photos are almost always well above this size and keep the smooth resample they need."""
    from PIL import Image

    return Image.Resampling.NEAREST if width and height and min(width, height) <= 768 else Image.Resampling.BICUBIC


def _save_thumb_image(im, dest: Path) -> None:
    """Writes `im` as the asset's thumbnail: JPEG, unless it really has transparent pixels — then
    a PNG next to it (thumb_path looks for both), so alpha isn't flattened onto black. Whichever
    format isn't used is removed so a stale one can't shadow the fresh one."""
    png = dest.with_suffix(".png")
    rgba = im.convert("RGBA") if im.mode in ("RGBA", "LA", "PA", "P") else None
    if rgba is not None and rgba.getchannel("A").getextrema()[0] < 255:
        rgba.save(png, "PNG")
        dest.unlink(missing_ok=True)
    else:
        im.convert("RGB").save(dest, "JPEG", quality=80, optimize=False)
        png.unlink(missing_ok=True)


def _read_blend_thumb(path: Path) -> tuple[int, int, bytes] | None:
    """Parses the .blend file-block format just enough to pull out the 'TEST' block, which
    is the thumbnail Blender itself embeds (raw RGBA, bottom-up rows). Handles the plain and
    gzip-compressed forms every Blender version writes, plus zstd (Blender 3.0+ default) when
    the optional `zstandard` package is present. No bpy/Blender install needed."""
    import gzip
    import struct

    with open(path, "rb") as fh:
        head = fh.read(4)
        data: bytes | None = None
        if head == b"BLEN":
            fh.seek(0)
            data = fh.read(4 * 1024 * 1024)
        elif head[:2] == b"\x1f\x8b":
            fh.seek(0)
            with gzip.GzipFile(fileobj=fh) as gz:
                data = gz.read(4 * 1024 * 1024)
        elif head == b"\x28\xb5\x2f\xfd":
            try:
                import zstandard  # type: ignore
            except Exception:
                return None
            fh.seek(0)
            dctx = zstandard.ZstdDecompressor()
            with dctx.stream_reader(fh) as reader:
                data = reader.read(4 * 1024 * 1024)
        else:
            return None
    if not data or data[:7] != b"BLENDER":
        return None
    ptr_size = 8 if data[7:8] == b"-" else 4
    endian = "<" if data[8:9] == b"v" else ">"
    off = 12
    header_size = 4 + 4 + ptr_size + 4 + 4
    while off + header_size <= len(data):
        code = data[off:off + 4]
        size = struct.unpack_from(endian + "I", data, off + 4)[0]
        body = off + header_size
        if code == b"ENDB":
            break
        if body + size > len(data):
            break
        if code == b"TEST" and size >= 8:
            w, h = struct.unpack_from(endian + "II", data, body)
            px = data[body + 8: body + 8 + w * h * 4]
            if w > 0 and h > 0 and len(px) == w * h * 4:
                return w, h, px
            return None
        off = body + size
    return None


class Bus:
    """Fan-out of small JSON events to SSE subscribers."""

    def __init__(self) -> None:
        self._subs: list[queue.Queue[dict]] = []
        self._lock = threading.Lock()

    def subscribe(self) -> queue.Queue[dict]:
        q: queue.Queue[dict] = queue.Queue(maxsize=512)
        with self._lock:
            self._subs.append(q)
        return q

    def unsubscribe(self, q: queue.Queue[dict]) -> None:
        with self._lock:
            if q in self._subs:
                self._subs.remove(q)

    def publish(self, event: dict) -> None:
        with self._lock:
            subs = list(self._subs)
        for q in subs:
            try:
                q.put_nowait(event)
            except queue.Full:
                try:
                    q.get_nowait()
                    q.put_nowait(event)
                except queue.Empty:
                    pass


class SlidingVideoCache:
    """RAM window over one video file that follows the playhead.

    The file is held as fixed 1 MiB blocks. ``focus`` (fed from the player's current time) decides
    which blocks belong in the window — most of the budget ahead of the playhead, the rest behind
    it for scrubbing backwards — and a background thread evicts what fell out of it and loads what
    is missing, nearest to the playhead first. Blocks that stay inside the window are never
    re-read, so the window slides instead of being rebuilt. ``stream`` serves HTTP range requests
    from the blocks and falls back to disk for anything outside the window: always correct, only
    ever faster.
    """

    CHUNK = 1024 * 1024
    AHEAD = 0.72  # share of the budget kept in front of the playhead

    def __init__(self, budget_mb: int = 128) -> None:
        self.lock = threading.Lock()
        self.cv = threading.Condition(self.lock)
        self.budget = self._clamp(budget_mb) * 1024 * 1024
        self.path = ""
        self.size = 0
        self.stamp: tuple[int, int] | None = None  # (size, mtime_ns) the blocks were read at
        self.blocks: dict[int, bytes] = {}
        self.head = 0  # block under the playhead
        self.pending = 0  # blocks the loader still has to fetch
        self._gen = 0  # bumped whenever the window moves; the loader re-plans when it changes
        self._stop = False
        self._thread = threading.Thread(target=self._loop, name="video-cache", daemon=True)
        self._thread.start()

    @staticmethod
    def _clamp(mb: int) -> int:
        return max(32, min(2048, int(mb)))

    @property
    def budget_mb(self) -> int:
        return max(1, self.budget // (1024 * 1024))

    def _window(self) -> tuple[int, int]:
        """Inclusive block range that belongs in RAM around the playhead (caller holds the lock)."""
        if not self.path or self.size <= 0:
            return 0, -1
        last = (self.size - 1) // self.CHUNK
        n = max(1, self.budget // self.CHUNK)
        head = min(self.head, last)
        ahead = min(max(1, int(n * self.AHEAD)), last - head + 1)
        behind = min(n - ahead, head)
        ahead = min(n - behind, last - head + 1)  # little behind (start of file) -> read further ahead
        return head - behind, head + ahead - 1

    def _replan(self) -> None:
        """Evict everything outside the window and wake the loader (caller holds the lock)."""
        lo, hi = self._window()
        for k in [k for k in self.blocks if k < lo or k > hi]:
            del self.blocks[k]
        self.pending = len(self._missing())  # set here, not by the loader, so "busy" is true from the first instant
        self._gen += 1
        self.cv.notify_all()

    def snapshot(self, path: str | None = None) -> dict:
        with self.lock:
            if path and self.path != str(path):
                return {"start": 0, "end": 0, "size": 0, "bytes": 0, "mb": self.budget_mb, "busy": False}
            start = end = 0
            if self.path and self.size > 0:
                k = min(self.head, (self.size - 1) // self.CHUNK)
                start = end = k * self.CHUNK
                if k in self.blocks:  # the run of cached blocks that contains the playhead
                    lo = hi = k
                    while lo - 1 in self.blocks:
                        lo -= 1
                    while hi + 1 in self.blocks:
                        hi += 1
                    start, end = lo * self.CHUNK, min(self.size, (hi + 1) * self.CHUNK)
            return {
                "start": start,
                "end": end,
                "size": self.size,
                "bytes": sum(len(b) for b in self.blocks.values()),
                "mb": self.budget_mb,
                "busy": self.pending > 0,
            }

    def configure(self, mb: int) -> None:
        nxt = self._clamp(mb) * 1024 * 1024
        with self.cv:
            if nxt == self.budget:
                return
            self.budget = nxt
            self._replan()  # shrinking evicts right away, growing starts filling the extra room

    def release(self) -> None:
        """Drop the window (the player closed) so a 2 GB budget doesn't stay resident."""
        with self.cv:
            self.path = ""
            self.size = 0
            self.stamp = None
            self.head = 0
            self.blocks = {}
            self.pending = 0
            self._gen += 1
            self.cv.notify_all()

    def close(self) -> None:
        with self.cv:
            self._stop = True
            self.path = ""
            self.blocks = {}
            self.cv.notify_all()

    def focus(self, path: str, pos: int) -> None:
        """Move the window so byte ``pos`` of ``path`` (the playhead) sits inside it."""
        path = str(path)
        try:
            st = os.stat(path)
        except OSError:
            return
        stamp = (st.st_size, st.st_mtime_ns)
        with self.cv:
            if self.path != path or self.stamp != stamp:  # other video, or the file changed underneath us
                self.path, self.size, self.stamp = path, st.st_size, stamp
                self.blocks = {}
            self.head = max(0, min(st.st_size, int(pos))) // self.CHUNK
            self._replan()

    def _missing(self) -> list[int]:
        """Blocks still to load, ordered so ``pop()`` yields the one nearest the playhead first
        (forward before backward). Caller holds the lock."""
        lo, hi = self._window()
        if hi < lo:
            return []
        head = min(max(self.head, lo), hi)
        order = list(range(head, hi + 1)) + list(range(head - 1, lo - 1, -1))
        return [k for k in reversed(order) if k not in self.blocks]

    def _loop(self) -> None:
        gen, todo = -1, []
        while True:
            with self.cv:
                while not self._stop and self._gen == gen and not todo:
                    self.cv.wait()
                if self._stop:
                    return
                if self._gen != gen:
                    gen = self._gen
                    todo = self._missing()
                if not todo:
                    self.pending = 0
                    continue
                k = todo.pop()
                if k in self.blocks:  # a range request already pulled it in
                    self.pending = len(todo)
                    continue
                self.pending = len(todo) + 1  # +1: the block being read right now
                path, stamp = self.path, self.stamp
            try:
                with open(path, "rb") as fh:
                    fh.seek(k * self.CHUNK)
                    data = fh.read(self.CHUNK)
            except OSError:
                data = b""
            with self.lock:
                lo, hi = self._window()
                if data and self.path == path and self.stamp == stamp and lo <= k <= hi:
                    self.blocks[k] = data
                if self._gen == gen:  # otherwise the window moved and _replan already counted afresh
                    self.pending = len(todo)

    def stream(self, path: str, start: int, end: int):
        """Yield bytes [start, end) of ``path`` — from RAM where the window holds them, else from disk
        (keeping the block when it belongs in the window, so the loader needn't fetch it again)."""
        path = str(path)
        pos = max(0, int(start))
        fh = None
        try:
            while pos < end:
                k, off = divmod(pos, self.CHUNK)
                with self.lock:
                    mine = self.path == path
                    block = self.blocks.get(k) if mine else None
                    lo, hi = self._window() if mine else (0, -1)
                if block is None:
                    if fh is None:
                        fh = open(path, "rb")
                    if lo <= k <= hi:
                        fh.seek(k * self.CHUNK)
                        block = fh.read(self.CHUNK)
                        if block:
                            with self.lock:
                                if self.path == path:
                                    self.blocks[k] = block
                    else:
                        fh.seek(pos)
                        block, off = fh.read(min(self.CHUNK - off, end - pos)), 0
                piece = block[off : off + (end - pos)]
                if not piece:
                    return
                yield piece
                pos += len(piece)
        finally:
            if fh is not None:
                fh.close()


class Library:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.thumbs = root / "thumbs"
        self.thumbs.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.conn = sqlite3.connect(str(root / "library.db"), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self.conn.execute("PRAGMA busy_timeout=4000")
        self.conn.execute("PRAGMA temp_store=MEMORY")
        self._migrate()
        row = self.conn.execute("SELECT value FROM meta WHERE key='scan_ignore'").fetchone()
        self.ignore = IgnoreRules(row["value"] if row else "")
        self.bus = Bus()
        self.ffmpeg = find_ffmpeg()
        self._scan_lock = threading.Lock()
        self._usdz_lock = threading.Lock()
        self.scanning = 0
        self.scanned = 0
        self._watchers: dict[str, object] = {}
        self._stop = threading.Event()
        self._heap: list[tuple[int, int, str]] = []
        self._heap_lock = threading.Lock()
        self._seq = 0
        self._inflight: set[str] = set()
        self._have_thumb: set[str] = set()
        self._info_cache: dict[str, tuple[tuple, list[dict]]] = {}
        self._wake = threading.Condition(self._heap_lock)
        try:
            import pillow_heif

            pillow_heif.register_heif_opener()
        except Exception:
            pass
        self._drop_stale_model_thumbs()
        self._load_thumb_cache()
        self.video_cache = SlidingVideoCache()
        workers = max(2, min(4, os.cpu_count() or 2))
        for _ in range(workers):
            threading.Thread(target=self._worker, daemon=True).start()
        threading.Thread(target=self._load_legacy_thumb_cache, daemon=True).start()

    def _drop_stale_model_thumbs(self) -> None:
        """One-time cleanup when model rendering changes. FBX thumbnails made before external
        textures were resolved are black/blank, and USDZ ones (plus the .glb they were rendered
        from) predate the up-axis/texture fixes in usdz_convert — drop them so the client
        re-renders each the next time it scrolls into view."""
        try:
            from .usdz_convert import CONVERTER_VERSION
        except Exception:
            CONVERTER_VERSION = 0
        stamp = f"{MODEL_THUMB_VERSION}.{CONVERTER_VERSION}"
        marker = self.thumbs / "model_version"
        try:
            if marker.read_text(encoding="utf-8").strip() == stamp:
                return
        except OSError:
            pass
        try:
            old_model_ver = marker.read_text(encoding="utf-8").strip().split(".")[0]
        except OSError:
            old_model_ver = ""
        for p in (self.thumbs / "usdz").glob("*.glb"):
            p.unlink(missing_ok=True)
        # A MODEL_THUMB_VERSION bump means the client-side render itself changed, so every model
        # re-renders; a converter-only bump only affects FBX/USDZ.
        where = ("kind = 'model3d'" if old_model_ver != str(MODEL_THUMB_VERSION)
                 else "ext IN ('.fbx', '.usdz')")
        for r in self.query(f"SELECT id FROM assets WHERE {where}"):
            for e in (".jpg", ".png"):
                (self.thumbs / f"{r['id']}{e}").unlink(missing_ok=True)
        self.execute(f"UPDATE assets SET has_thumb=0 WHERE {where}")
        try:
            marker.write_text(stamp, encoding="utf-8")
        except OSError:
            pass

    def _migrate(self) -> None:
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS sources (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              path TEXT NOT NULL UNIQUE,
              added_at INTEGER NOT NULL,
              sort_order INTEGER NOT NULL DEFAULT 0,
              excluded TEXT NOT NULL DEFAULT '[]'
            );
            CREATE TABLE IF NOT EXISTS assets (
              id TEXT PRIMARY KEY,
              source_id TEXT NOT NULL,
              path TEXT NOT NULL UNIQUE,
              name TEXT NOT NULL,
              ext TEXT NOT NULL,
              kind TEXT NOT NULL,
              size INTEGER NOT NULL,
              mtime REAL NOT NULL,
              width INTEGER,
              height INTEGER,
              duration REAL,
              tags TEXT NOT NULL DEFAULT '[]',
              note TEXT NOT NULL DEFAULT '',
              rating INTEGER NOT NULL DEFAULT 0,
              status TEXT NOT NULL DEFAULT 'ready',
              has_thumb INTEGER NOT NULL DEFAULT 0,
              animated INTEGER NOT NULL DEFAULT 0,
              added_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_assets_kind ON assets(kind);
            CREATE INDEX IF NOT EXISTS idx_assets_source ON assets(source_id);
            CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
            CREATE TABLE IF NOT EXISTS collections (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              parent_id TEXT,
              created_at INTEGER NOT NULL,
              sort_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS collection_assets (
              collection_id TEXT NOT NULL,
              asset_id TEXT NOT NULL,
              PRIMARY KEY (collection_id, asset_id)
            );
            CREATE TABLE IF NOT EXISTS boards (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              sort_order INTEGER NOT NULL DEFAULT 0,
              color TEXT,
              icon TEXT,
              bg_color TEXT,
              viewport_x REAL NOT NULL DEFAULT 0,
              viewport_y REAL NOT NULL DEFAULT 0,
              viewport_zoom REAL NOT NULL DEFAULT 1,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              revision INTEGER NOT NULL DEFAULT 1,
              deleted_at INTEGER
            );
            CREATE TABLE IF NOT EXISTS board_groups (
              id TEXT PRIMARY KEY,
              board_id TEXT NOT NULL,
              parent_group_id TEXT,
              name TEXT,
              collapsed INTEGER NOT NULL DEFAULT 0,
              x REAL, y REAL, w REAL, h REAL,
              rotation REAL NOT NULL DEFAULT 0,
              z_index INTEGER NOT NULL DEFAULT 0,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              revision INTEGER NOT NULL DEFAULT 1,
              deleted_at INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_board_groups_board ON board_groups(board_id);
            -- A placement of one library asset onto one board. Kept separate from `assets` so the
            -- same asset can be placed on a board more than once, each with its own transform/crop.
            CREATE TABLE IF NOT EXISTS board_items (
              id TEXT PRIMARY KEY,
              board_id TEXT NOT NULL,
              asset_id TEXT NOT NULL,
              group_id TEXT,
              x REAL NOT NULL,
              y REAL NOT NULL,
              w REAL NOT NULL,
              h REAL NOT NULL,
              rotation REAL NOT NULL DEFAULT 0,
              z_index INTEGER NOT NULL DEFAULT 0,
              opacity REAL NOT NULL DEFAULT 1,
              desaturate INTEGER NOT NULL DEFAULT 0,
              always_on_top INTEGER NOT NULL DEFAULT 0,
              crop_x REAL, crop_y REAL, crop_w REAL, crop_h REAL,
              color_label TEXT,
              locked INTEGER NOT NULL DEFAULT 0,
              playback_state TEXT,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              revision INTEGER NOT NULL DEFAULT 1,
              deleted_at INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_board_items_board ON board_items(board_id);
            CREATE INDEX IF NOT EXISTS idx_board_items_updated ON board_items(updated_at);
            -- Universal annotation: a text note / freehand drawing / sticker / shape (incl. frames
            -- and connector arrows via kind='shape'), living either free on a board (scope='board')
            -- or attached to a single bare asset so it also shows in the lightbox (scope='asset').
            CREATE TABLE IF NOT EXISTS annotations (
              id TEXT PRIMARY KEY,
              kind TEXT NOT NULL,
              shape_kind TEXT,
              scope TEXT NOT NULL,
              target_asset_id TEXT,
              target_board_item_id TEXT,
              board_id TEXT,
              group_id TEXT,
              x REAL, y REAL, w REAL, h REAL,
              rotation REAL NOT NULL DEFAULT 0,
              z_index INTEGER NOT NULL DEFAULT 0,
              color TEXT,
              data TEXT NOT NULL DEFAULT '{}',
              locked INTEGER NOT NULL DEFAULT 0,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              revision INTEGER NOT NULL DEFAULT 1,
              deleted_at INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_annotations_board ON annotations(board_id);
            CREATE INDEX IF NOT EXISTS idx_annotations_asset ON annotations(target_asset_id);
            CREATE TABLE IF NOT EXISTS tag_order (
              name TEXT PRIMARY KEY,
              sort_order INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tag_meta (
              name TEXT PRIMARY KEY,
              icon TEXT,
              color TEXT
            );
            CREATE TABLE IF NOT EXISTS meta (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            """
        )
        cols = {r[1] for r in self.conn.execute("PRAGMA table_info(assets)")}
        if "has_thumb" not in cols:
            self.conn.execute("ALTER TABLE assets ADD COLUMN has_thumb INTEGER NOT NULL DEFAULT 0")
        if "animated" not in cols:
            self.conn.execute("ALTER TABLE assets ADD COLUMN animated INTEGER NOT NULL DEFAULT 0")
        scols = {r[1] for r in self.conn.execute("PRAGMA table_info(sources)")}
        if "sort_order" not in scols:
            self.conn.execute("ALTER TABLE sources ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
            # Backfill from insertion order so existing sources keep their current order on upgrade.
            self.conn.execute(
                """
                UPDATE sources SET sort_order = (
                  SELECT COUNT(*) FROM sources s2
                  WHERE s2.added_at < sources.added_at
                     OR (s2.added_at = sources.added_at AND s2.rowid < sources.rowid)
                )
                """
            )
        if "excluded" not in scols:
            self.conn.execute("ALTER TABLE sources ADD COLUMN excluded TEXT NOT NULL DEFAULT '[]'")
        ccols = {r[1] for r in self.conn.execute("PRAGMA table_info(collections)")}
        if "icon" not in ccols:
            self.conn.execute("ALTER TABLE collections ADD COLUMN icon TEXT")
        if "color" not in ccols:
            self.conn.execute("ALTER TABLE collections ADD COLUMN color TEXT")
        if "sort_order" not in ccols:
            self.conn.execute("ALTER TABLE collections ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
            # Backfill from creation order so existing collections keep their current order on upgrade.
            self.conn.execute(
                """
                UPDATE collections SET sort_order = (
                  SELECT COUNT(*) FROM collections c2
                  WHERE c2.created_at < collections.created_at
                     OR (c2.created_at = collections.created_at AND c2.rowid < collections.rowid)
                )
                """
            )
        bicols = {r[1] for r in self.conn.execute("PRAGMA table_info(board_items)")}
        if "flip_x" not in bicols:
            self.conn.execute("ALTER TABLE board_items ADD COLUMN flip_x INTEGER NOT NULL DEFAULT 0")
        if "flip_y" not in bicols:
            self.conn.execute("ALTER TABLE board_items ADD COLUMN flip_y INTEGER NOT NULL DEFAULT 0")
        self.conn.commit()

    def _load_thumb_cache(self) -> None:
        for row in self.conn.execute("SELECT id FROM assets WHERE has_thumb=1"):
            self._have_thumb.add(row["id"])

    def _load_legacy_thumb_cache(self) -> None:
        """Disk thumbs from older runs whose DB row predates has_thumb. Listing the whole thumbs
        folder can take seconds once a library has accumulated a lot of them, so this runs in the
        background instead of delaying startup — anything not yet indexed here just looks
        momentarily unthumbed and gets queued for a (harmless, self-correcting) regen."""
        for p in self.thumbs.glob("*.jpg"):
            self._have_thumb.add(p.stem)

    def close(self) -> None:
        self._stop.set()
        with self._wake:
            self._wake.notify_all()
        self.video_cache.close()
        with self.lock:
            self.conn.close()

    def execute(self, sql: str, args: tuple = ()) -> sqlite3.Cursor:
        with self.lock:
            cur = self.conn.execute(sql, args)
            self.conn.commit()
            return cur

    def executemany(self, sql: str, rows: list[tuple]) -> None:
        if not rows:
            return
        with self.lock:
            self.conn.executemany(sql, rows)
            self.conn.commit()

    def query(self, sql: str, args: tuple = ()) -> list[sqlite3.Row]:
        with self.lock:
            return list(self.conn.execute(sql, args))

    def pending_thumbs(self) -> int:
        with self._heap_lock:
            return len(self._heap) + len(self._inflight)

    def counts(self) -> dict:
        out = {k: 0 for k in KIND_LABEL}
        out["all"] = 0
        out["missing"] = 0
        for row in self.query("SELECT kind, status, COUNT(*) c FROM assets GROUP BY kind, status"):
            if row["status"] == "excluded":
                continue
            n = int(row["c"])
            out["all"] += n
            out[row["kind"]] = out.get(row["kind"], 0) + n
            if row["status"] == "missing":
                out["missing"] += n
        return out

    def sources(self) -> list[dict]:
        rows = self.query(
            """
            SELECT s.id, s.name, s.path, COUNT(a.id) AS count
            FROM sources s LEFT JOIN assets a ON a.source_id = s.id AND a.status != 'excluded'
            GROUP BY s.id ORDER BY s.sort_order, s.added_at
            """
        )
        return [dict(r) for r in rows]

    def source_root(self, sid: str) -> str | None:
        rows = self.query("SELECT path FROM sources WHERE id=?", (sid,))
        return rows[0]["path"] if rows else None

    def hidden(self, root: str, fp: str) -> bool:
        """A file the scanner leaves out even though its extension is supported: matched by the
        ignore list, or an .obj that is compiler output rather than a mesh."""
        parts = rel_parts(root, fp)
        if parts and self.ignore.path(parts):
            return True
        return fp.lower().endswith(".obj") and obj_is_binary(Path(fp))

    def set_ignore(self, text: str) -> dict:
        """Replace the scan ignore list. Indexed files it now matches flip to status='excluded'
        (tags/ratings survive, like an excluded folder); ones it no longer matches come back,
        unless they sit in an excluded folder. Then every source is rescanned for files that were
        never indexed because of the old list."""
        text = (text or "").replace("\r\n", "\n")
        self.ignore = IgnoreRules(text)
        roots = {r["id"]: (r["path"], self.excluded_set(r["id"])) for r in self.query("SELECT id, path FROM sources")}
        hide: list[tuple[str]] = []
        show: list[tuple[str]] = []
        for r in self.query("SELECT id, source_id, path, status FROM assets"):
            src = roots.get(r["source_id"])
            if not src:
                continue
            root, exc = src
            parts = rel_parts(root, r["path"])
            ignored = bool(parts) and self.ignore.path(parts)
            if r["status"] == "excluded":
                p_n = normpath(r["path"])
                in_exc = any(p_n == e or p_n.startswith(e + os.sep) for e in exc)
                if not ignored and not in_exc and not self.hidden(root, r["path"]):
                    show.append((r["id"],))
            elif ignored:
                hide.append((r["id"],))
        with self.lock:
            self.conn.execute(
                "INSERT INTO meta(key, value) VALUES ('scan_ignore', ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (text,),
            )
            self.conn.executemany("UPDATE assets SET status='excluded' WHERE id=?", hide)
            self.conn.executemany("UPDATE assets SET status='ready' WHERE id=?", show)
            self.conn.commit()
        for sid in roots:
            threading.Thread(target=self.scan_source, args=(sid,), daemon=True).start()
        self.bus.publish({"type": "source", "id": ""})
        return {"text": text, "hidden": len(hide), "restored": len(show)}

    def excluded_set(self, sid: str) -> set[str]:
        rows = self.query("SELECT excluded FROM sources WHERE id=?", (sid,))
        if not rows:
            return set()
        try:
            return {normpath(x) for x in json.loads(rows[0]["excluded"] or "[]")}
        except Exception:
            return set()

    def set_excluded(self, sid: str, path: str, excluded: bool) -> dict:
        """Toggle a subfolder out of (or back into) scanning/display. Matching assets are
        flipped to/from status='excluded' rather than deleted, so tags/ratings/notes survive
        a round trip — re-including a folder restores them instantly instead of losing them
        to a fresh re-scan."""
        rows = self.query("SELECT excluded FROM sources WHERE id=?", (sid,))
        if not rows:
            raise ValueError("unknown source")
        try:
            cur = json.loads(rows[0]["excluded"] or "[]")
        except Exception:
            cur = []
        target_n = normpath(path)
        cur = [x for x in cur if normpath(x) != target_n]
        if excluded:
            cur.append(path)
        # Excluding a folder excludes its whole subtree, so re-including it must not revive assets
        # under a subfolder that is still excluded in its own right.
        still_excluded = [normpath(x) for x in cur] if not excluded else []
        src_root = self.source_root(sid) or ""
        with self.lock:
            prefix = target_n + os.sep
            rows2 = self.conn.execute("SELECT id, path FROM assets WHERE source_id=?", (sid,)).fetchall()
            match_ids = []
            for r in rows2:
                p_n = normpath(r["path"])
                if p_n != target_n and not p_n.startswith(prefix):
                    continue
                if any(p_n == e or p_n.startswith(e + os.sep) for e in still_excluded):
                    continue
                if not excluded and self.hidden(src_root, r["path"]):
                    continue  # still left out by the ignore list
                match_ids.append(r["id"])
            if match_ids:
                new_status = "excluded" if excluded else "ready"
                self.conn.executemany(
                    "UPDATE assets SET status=? WHERE id=?",
                    [(new_status, i) for i in match_ids],
                )
            self.conn.execute("UPDATE sources SET excluded=? WHERE id=?", (json.dumps(cur), sid))
            self.conn.commit()
        if not excluded:
            threading.Thread(target=self.scan_source, args=(sid,), daemon=True).start()
        self.bus.publish({"type": "source", "id": sid})
        return {"excluded": cur}

    def reorder_sources(self, ids: list[str]) -> None:
        if not ids:
            return
        with self.lock:
            for i, sid in enumerate(ids):
                self.conn.execute("UPDATE sources SET sort_order=? WHERE id=?", (i, sid))
            self.conn.commit()
        self.bus.publish({"type": "source", "id": "*"})

    def tags(self) -> list[dict]:
        bag: dict[str, int] = {}
        for row in self.query("SELECT tags FROM assets WHERE tags != '[]' AND status != 'excluded'"):
            try:
                for t in json.loads(row["tags"]):
                    bag[t] = bag.get(t, 0) + 1
            except json.JSONDecodeError:
                pass
        # Tags aren't rows of their own (just aggregated out of assets.tags), so custom order lives
        # in a side table; anything not dragged yet falls back to alphabetical, after the ordered ones.
        order = {r["name"]: r["sort_order"] for r in self.query("SELECT name, sort_order FROM tag_order")}
        # Same story for a chosen icon/color: not every tag has one, so it's a side table too,
        # keyed independently of tag_order so picking an icon never disturbs the tag's position.
        meta = {r["name"]: (r["icon"], r["color"]) for r in self.query("SELECT name, icon, color FROM tag_meta")}
        items = sorted(bag.items(), key=lambda x: (order.get(x[0], len(order)), x[0].lower()))
        out = []
        for k, v in items:
            icon, color = meta.get(k, (None, None))
            out.append({"name": k, "count": v, "icon": icon, "color": color})
        return out

    def reorder_tags(self, names: list[str]) -> None:
        if not names:
            return
        self.executemany(
            "INSERT INTO tag_order(name, sort_order) VALUES (?,?) "
            "ON CONFLICT(name) DO UPDATE SET sort_order=excluded.sort_order",
            [(n, i) for i, n in enumerate(names)],
        )

    def set_tag_icon(self, name: str, icon: str | None, color: str | None) -> None:
        key = name.strip()
        if not key:
            return
        self.execute(
            "INSERT INTO tag_meta(name, icon, color) VALUES (?,?,?) "
            "ON CONFLICT(name) DO UPDATE SET icon=excluded.icon, color=excluded.color",
            (key, icon or None, color or None),
        )

    def add_source(self, path: str) -> dict:
        p = Path(path).expanduser().resolve()
        if not p.is_dir():
            raise ValueError("Not a folder")
        sid = asset_id(str(p))
        now = int(time.time() * 1000)
        next_order = self.query("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM sources")[0]["n"]
        self.execute(
            "INSERT OR IGNORE INTO sources(id, name, path, added_at, sort_order) VALUES (?,?,?,?,?)",
            (sid, p.name or str(p), str(p), now, next_order),
        )
        self.execute("UPDATE sources SET name=?, path=? WHERE id=?", (p.name or str(p), str(p), sid))
        self._watch(sid, str(p))
        threading.Thread(target=self.scan_source, args=(sid,), daemon=True).start()
        self.bus.publish({"type": "source", "id": sid})
        return {"id": sid, "name": p.name or str(p), "path": str(p)}

    def rescan_source(self, sid: str) -> bool:
        """Force-rescan: same walk `resume_watchers` does at startup, on demand — for catching up
        after changes the live watcher missed (network share, external edits) or reconciling a
        move (see _reconcile_moved) without needing an app restart."""
        if not self.query("SELECT 1 FROM sources WHERE id=?", (sid,)):
            return False
        threading.Thread(target=self.scan_source, args=(sid,), daemon=True).start()
        return True

    def remove_source(self, sid: str) -> None:
        self.execute("DELETE FROM assets WHERE source_id=?", (sid,))
        self.execute("DELETE FROM sources WHERE id=?", (sid,))
        w = self._watchers.pop(sid, None)
        if w is not None:
            try:
                w.stop()  # type: ignore[attr-defined]
            except Exception:
                pass
        self.bus.publish({"type": "source", "id": sid})

    def _migrate_asset(self, old_id: str, new_id: str) -> None:
        """A file was moved/renamed: `old_id` (now missing) and `new_id` (a fresh 'ready' row at
        the new path) are the same file, matched by _reconcile_moved. Carries the old row's tags/
        rating/note/added_at and, if the cached thumbnail can be moved to the new id, its cached
        derivatives too (so a move doesn't cost a re-thumbnail) — then drops the old row."""
        old_rows = self.query("SELECT * FROM assets WHERE id=?", (old_id,))
        if not old_rows:
            return
        old = old_rows[0]
        moved_thumb = False
        for ext in (".jpg", ".png"):
            src = self.thumbs / f"{old_id}{ext}"
            if src.exists():
                try:
                    src.replace(self.thumbs / f"{new_id}{ext}")
                    moved_thumb = True
                except OSError:
                    pass
        for sub, old_name, new_name in (
            ("wave", f"{old_id}.json", f"{new_id}.json"),
            ("usdz", f"{old_id}.glb", f"{new_id}.glb"),
        ):
            src = self.thumbs / sub / old_name
            if src.exists():
                try:
                    src.replace(self.thumbs / sub / new_name)
                except OSError:
                    pass
        for src in (self.thumbs / "psd").glob(f"{old_id}_*.png"):
            try:
                src.replace(self.thumbs / "psd" / (new_id + src.name[len(old_id):]))
            except OSError:
                pass
        self.execute(
            """
            UPDATE assets SET tags=?, note=?, rating=?, added_at=MIN(added_at, ?),
              width=COALESCE(?, width), height=COALESCE(?, height), duration=COALESCE(?, duration),
              animated=?, has_thumb=? WHERE id=?
            """,
            (
                old["tags"], old["note"], old["rating"], old["added_at"],
                old["width"], old["height"], old["duration"],
                old["animated"], 1 if moved_thumb else 0, new_id,
            ),
        )
        cols = self.query("SELECT collection_id FROM collection_assets WHERE asset_id=?", (old_id,))
        if cols:
            self.executemany(
                "INSERT OR IGNORE INTO collection_assets(collection_id, asset_id) VALUES (?,?)",
                [(c["collection_id"], new_id) for c in cols],
            )
        self.execute("DELETE FROM collection_assets WHERE asset_id=?", (old_id,))
        self.execute("DELETE FROM assets WHERE id=?", (old_id,))
        self._have_thumb.discard(old_id)
        if moved_thumb:
            self._have_thumb.add(new_id)

    def _reconcile_moved(self) -> int:
        """Pairs each status='missing' row with a 'ready' row elsewhere in the library that has
        the same name and size — almost certainly the same file, moved to another folder (a
        rename, which changes the name, is deliberately not matched — too easy to confuse with an
        unrelated file of the same size). Only pairs that are unique in both directions are
        migrated, so an ambiguous name+size collision is left alone rather than guessed at. Runs
        after every scan and before every missing-files clean-up, so a move is recognized whether
        it's caught live (same source, watched) or only found on the next look (moved across
        sources, or while Sight wasn't running)."""
        missing_rows = self.query("SELECT id, name, size FROM assets WHERE status='missing'")
        if not missing_rows:
            return 0
        missing_by_key: dict[tuple[str, int], list[str]] = {}
        for r in missing_rows:
            missing_by_key.setdefault((r["name"].lower(), r["size"]), []).append(r["id"])
        ready_by_key: dict[tuple[str, int], list[str]] = {}
        for r in self.query("SELECT id, name, size FROM assets WHERE status='ready'"):
            key = (r["name"].lower(), r["size"])
            if key in missing_by_key:
                ready_by_key.setdefault(key, []).append(r["id"])
        n = 0
        for key, old_ids in missing_by_key.items():
            new_ids = ready_by_key.get(key)
            if len(old_ids) == 1 and new_ids and len(new_ids) == 1 and old_ids[0] != new_ids[0]:
                self._migrate_asset(old_ids[0], new_ids[0])
                n += 1
        return n

    def purge_missing(
        self,
        q: str = "",
        kind: str = "",
        source_id: str = "",
        tag: str = "",
        collection_id: str = "",
        folder: str = "",
    ) -> dict:
        """Drops the index entries of files that are gone (moved or deleted) — status='missing'.
        Only the index is touched, never anything on disk. Each entry is re-checked first: a file
        that's back at its path is revived instead, entries that match a 'ready' file elsewhere by
        name+size are treated as moved (see _reconcile_moved) instead of dropped, and entries
        whose whole source folder is unreachable (unplugged drive, offline share) are left alone —
        everything in it looks missing, and wiping it would throw away the tags/ratings/notes of
        files that still exist. Passing any of the filter args (mirrors list_assets/count_filtered)
        scopes the drop to missing entries matching them, e.g. the current view's filter — moves are
        still reconciled library-wide regardless, since that's never destructive."""
        moved = self._reconcile_moved()
        usable = {r["id"]: Path(r["path"]).is_dir() for r in self.query("SELECT id, path FROM sources")}
        clause, args = self._clause(q, kind, source_id, tag, True, collection_id, folder)
        gone: list[str] = []
        revived: list[tuple[str]] = []
        skipped = 0
        for r in self.query(f"SELECT id, path, source_id FROM assets WHERE {clause}", tuple(args)):
            if not usable.get(r["source_id"]):
                skipped += 1
            elif os.path.exists(r["path"]):
                revived.append((r["id"],))
            else:
                gone.append(r["id"])
        self.executemany("UPDATE assets SET status='ready' WHERE id=?", revived)
        self.executemany("DELETE FROM collection_assets WHERE asset_id=?", [(a,) for a in gone])
        self.executemany("DELETE FROM assets WHERE id=?", [(a,) for a in gone])
        for aid in gone:
            self._have_thumb.discard(aid)
            for p in (
                self.thumbs / f"{aid}.jpg", self.thumbs / f"{aid}.png",
                self.thumbs / "wave" / f"{aid}.json", self.thumbs / "usdz" / f"{aid}.glb",
                *(self.thumbs / "psd").glob(f"{aid}_*.png"),
            ):
                try:
                    p.unlink(missing_ok=True)
                except OSError:
                    pass
        return {"removed": len(gone), "revived": len(revived), "moved": moved, "skipped": skipped, "ids": gone}

    def scan_source(self, sid: str) -> None:
        rows = self.query("SELECT path FROM sources WHERE id=?", (sid,))
        if not rows:
            return
        root = Path(rows[0]["path"])
        if not root.is_dir():
            return
        excluded_n = self.excluded_set(sid)
        with self._scan_lock:
            self.scanning += 1
        self.bus.publish({"type": "scan", "scanning": True, "scanned": self.scanned})
        # Excluded assets are left out of the diff entirely — os.walk never visits their dirs
        # (see the dirnames filter below), so if they stayed in `existing` they'd look "gone"
        # and get flipped to status='missing', clobbering the exclusion on every rescan.
        existing = {
            r["path"]: (r["mtime"], r["size"], r["id"])
            for r in self.query("SELECT id, path, mtime, size, status FROM assets WHERE source_id=?", (sid,))
            if r["status"] != "excluded"
        }
        ignore = self.ignore
        seen: set[str] = set()
        hide: list[tuple[str]] = []  # indexed files the ignore list / COFF check now leaves out
        inserts: list[tuple] = []
        now = int(time.time() * 1000)

        def flush() -> None:
            nonlocal inserts, now
            if not inserts:
                return
            self.executemany(
                """
                INSERT OR IGNORE INTO assets(
                  id, source_id, path, name, ext, kind, size, mtime, status, has_thumb, added_at
                ) VALUES (?,?,?,?,?,?,?,?,'ready',0,?)
                """,
                inserts,
            )
            n = len(inserts)
            self.scanned += n
            inserts = []
            now = int(time.time() * 1000)
            self.bus.publish({"type": "batch", "n": n, "scanned": self.scanned, "source": sid})

        try:
            for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
                if self._stop.is_set():
                    break
                base = rel_parts(root, dirpath) or []
                dirnames[:] = [
                    d for d in dirnames
                    if d not in SKIP_DIRS and not d.startswith(".")
                    and normpath(Path(dirpath) / d) not in excluded_n
                    and not ignore.leaf(base + [d], True)
                ]
                for name in filenames:
                    if name.startswith("."):
                        continue
                    kind = kind_of(name)
                    if not kind:
                        continue
                    fp = str(Path(dirpath) / name)
                    seen.add(fp)
                    if ignore.leaf(base + [name], False) or (name.lower().endswith(".obj") and obj_is_binary(Path(fp))):
                        if fp in existing:
                            hide.append((existing[fp][2],))
                        continue
                    try:
                        st = os.stat(fp)
                    except OSError:
                        continue
                    prev = existing.get(fp)
                    if prev and abs(prev[0] - st.st_mtime) < 0.01 and prev[1] == st.st_size:
                        continue
                    if prev:
                        self.execute(
                            """
                            UPDATE assets SET size=?, mtime=?, name=?, ext=?, kind=?,
                              status='ready', has_thumb=0 WHERE id=?
                            """,
                            (st.st_size, st.st_mtime, name, Path(fp).suffix.lower(), kind, prev[2]),
                        )
                        self._have_thumb.discard(prev[2])
                        continue
                    inserts.append(
                        (
                            asset_id(fp),
                            sid,
                            fp,
                            name,
                            Path(fp).suffix.lower(),
                            kind,
                            st.st_size,
                            st.st_mtime,
                            now,
                        )
                    )
                    if len(inserts) >= BATCH:
                        flush()
            flush()
            if hide:
                self.executemany("UPDATE assets SET status='excluded' WHERE id=?", hide)
                self.bus.publish({"type": "batch", "n": 0, "scanned": self.scanned, "source": sid})
            gone = set(existing) - seen
            if gone:
                with self.lock:
                    self.conn.executemany(
                        "UPDATE assets SET status='missing' WHERE path=?",
                        [(p,) for p in gone],
                    )
                    self.conn.commit()
                self.bus.publish({"type": "batch", "n": 0, "scanned": self.scanned, "source": sid})
            # Catches files moved/renamed-into-place since the last scan — including moves the
            # live watcher couldn't pair up itself (a different source's tree, or Sight wasn't
            # running) — so their tags/rating/note/thumbnail carry over instead of looking like a
            # delete + a brand new file. See _reconcile_moved.
            if self._reconcile_moved():
                self.bus.publish({"type": "batch", "n": 0, "scanned": self.scanned, "source": sid})
        finally:
            with self._scan_lock:
                self.scanning = max(0, self.scanning - 1)
                scanning = self.scanning > 0
            self.bus.publish({"type": "scan", "scanning": scanning, "scanned": self.scanned})

    def prioritize(self, ids: list[str], priority: int = PRI_VISIBLE) -> None:
        if not ids:
            return
        with self._wake:
            for aid in ids:
                if aid in self._have_thumb or aid in self._inflight:
                    continue
                if (self.thumbs / f"{aid}.jpg").exists() or (self.thumbs / f"{aid}.png").exists():
                    self._have_thumb.add(aid)
                    continue
                self._seq += 1
                heapq.heappush(self._heap, (priority, self._seq, aid))
            self._wake.notify_all()

    def thumb_path(self, aid: str) -> Path | None:
        for ext in (".jpg", ".png"):
            p = self.thumbs / f"{aid}{ext}"
            if p.exists():
                if aid not in self._have_thumb:
                    self._have_thumb.add(aid)
                    self.execute("UPDATE assets SET has_thumb=1 WHERE id=?", (aid,))
                return p
        return None

    def _worker(self) -> None:
        while not self._stop.is_set():
            with self._wake:
                while not self._heap and not self._stop.is_set():
                    self._wake.wait(timeout=0.5)
                if self._stop.is_set():
                    return
                if not self._heap:
                    continue
                _pri, _seq, aid = heapq.heappop(self._heap)
                if aid in self._have_thumb or aid in self._inflight:
                    continue
                self._inflight.add(aid)
            try:
                self._make_thumb(aid)
            except Exception:
                pass
            finally:
                with self._wake:
                    self._inflight.discard(aid)

    def _make_thumb(self, aid: str) -> None:
        if self.thumb_path(aid):
            return
        rows = self.query("SELECT path, kind, ext FROM assets WHERE id=?", (aid,))
        if not rows:
            return
        path = Path(rows[0]["path"])
        kind = rows[0]["kind"]
        ext = rows[0]["ext"]
        if not path.exists():
            self.execute("UPDATE assets SET status='missing' WHERE id=?", (aid,))
            return
        dest = self.thumbs / f"{aid}.jpg"
        wh: tuple[int, int] | None = None
        if ext == ".psd":
            wh = self._thumb_psd(path, dest)
        elif kind == "image":
            wh = self._thumb_image(path, dest)
        elif kind == "video":
            wh = self._thumb_video(path, dest)
        elif kind == "document" and ext == ".pdf":
            wh = self._thumb_pdf(path, dest)
        elif kind == "document" and ext in TEXT_EXT:
            wh = self._thumb_text(path, dest)
        elif kind == "font":
            wh = self._thumb_font(path, dest)
        elif kind == "audio":
            wh = self._thumb_audio(path, dest)
        elif ext == ".blend":
            wh = self._thumb_blend(path, dest)
        animated = None
        if kind == "image" and ext in ANIMATABLE_EXT:
            animated = is_animated(path, ext)
            self.execute("UPDATE assets SET animated=? WHERE id=?", (1 if animated else 0, aid))
        thumb_ok = self.thumb_path(aid) is not None
        if thumb_ok:
            self._have_thumb.add(aid)
            if wh:
                self.execute(
                    "UPDATE assets SET has_thumb=1, width=?, height=? WHERE id=?",
                    (wh[0], wh[1], aid),
                )
            else:
                self.execute("UPDATE assets SET has_thumb=1 WHERE id=?", (aid,))
        # Publish even when the thumbnail itself failed, as long as we learned the animated
        # flag — otherwise a client that already fetched the asset list never finds out.
        if thumb_ok or animated is not None:
            ev = {
                "type": "thumb", "id": aid, "hasThumb": thumb_ok, "animated": animated,
                "v": self.thumb_version(aid),
            }
            # width/height are only just now known (the client's copy of this asset predates
            # thumbnailing) — carried on the same event rather than making every card wait on
            # the next full resync, since the grid's masonry layout needs them to size a card.
            if thumb_ok and wh:
                ev["width"], ev["height"] = wh
            self.bus.publish(ev)

    def save_uploaded_thumb(self, aid: str, data: bytes) -> bool:
        """Accepts a client-rendered thumbnail (used for kinds the server can't thumbnail
        itself, e.g. 3D models — no headless GL here) and caches it like any other thumb.
        3D thumbnails are rendered as PNG so they can carry transparency; sniff the magic
        bytes rather than trusting a client-supplied extension/content-type."""
        row = self.query("SELECT id FROM assets WHERE id=?", (aid,))
        if not row or not data:
            return False
        is_png = data[:8] == b"\x89PNG\r\n\x1a\n"
        dest = self.thumbs / f"{aid}.png" if is_png else self.thumbs / f"{aid}.jpg"
        other = self.thumbs / f"{aid}.jpg" if is_png else self.thumbs / f"{aid}.png"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        if other.exists():
            try:
                other.unlink()
            except OSError:
                pass
        self._have_thumb.add(aid)
        self.execute("UPDATE assets SET has_thumb=1 WHERE id=?", (aid,))
        self.bus.publish({
            "type": "thumb", "id": aid, "hasThumb": True, "animated": None,
            "v": self.thumb_version(aid),
        })
        return True

    def thumb_version(self, aid: str) -> int:
        """Changes whenever the cached thumbnail is rewritten. The client puts it in the thumb URL
        (?v=), which the server serves as immutable — without it a regenerated thumbnail would
        keep being shown from the browser cache."""
        for ext in (".jpg", ".png"):
            try:
                return (self.thumbs / f"{aid}{ext}").stat().st_mtime_ns // 1_000_000
            except OSError:
                continue
        return 0

    def refresh_thumbs(self, ids: list[str]) -> list[str]:
        """Drops the cached thumbnails of `ids` and rebuilds them. Server-made kinds are requeued
        at visible priority (a 'thumb' event follows for each); 3D models are rendered by the
        client, which re-renders them once this returns. Returns the ids that were reset."""
        done: list[str] = []
        queue: list[str] = []
        for aid in ids:
            rows = self.query("SELECT kind FROM assets WHERE id=?", (aid,))
            if not rows:
                continue
            try:
                for ext in (".jpg", ".png"):
                    (self.thumbs / f"{aid}{ext}").unlink(missing_ok=True)
            except OSError:
                continue  # still being served/written — leave it, the user can retry
            self._have_thumb.discard(aid)
            done.append(aid)
            if rows[0]["kind"] != "model3d":
                queue.append(aid)
        self.executemany("UPDATE assets SET has_thumb=0 WHERE id=?", [(aid,) for aid in done])
        self.prioritize(queue, PRI_VISIBLE)
        return done

    def _thumb_image(self, path: Path, dest: Path) -> tuple[int, int] | None:
        from PIL import Image

        try:
            with Image.open(path) as im:
                width, height = im.size
                try:
                    im.draft("RGB", (THUMB_SIZE, THUMB_SIZE))
                except Exception:
                    pass
                im.thumbnail((THUMB_SIZE, THUMB_SIZE), resample=_thumb_resample(width, height))
                dest.parent.mkdir(parents=True, exist_ok=True)
                _save_thumb_image(im, dest)
                return width, height
        except Exception:
            return None

    def _thumb_video(self, path: Path, dest: Path) -> tuple[int, int] | None:
        if not self.ffmpeg:
            self.ffmpeg = find_ffmpeg()
        if not self.ffmpeg:
            return None
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(".tmp.jpg")
        cmd = [
            self.ffmpeg, "-hide_banner", "-loglevel", "error",
            "-y", "-ss", "0.8", "-i", str(path),
            "-frames:v", "1", "-vf", f"scale={THUMB_SIZE}:-2", "-q:v", "5", str(tmp),
        ]
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=20)
            if tmp.exists():
                tmp.replace(dest)
                from PIL import Image

                with Image.open(dest) as im:
                    return im.size
        except Exception:
            if tmp.exists():
                tmp.unlink(missing_ok=True)
        return None

    def _thumb_psd(self, path: Path, dest: Path) -> tuple[int, int] | None:
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            from psd_tools import PSDImage

            psd = PSDImage.open(path)
            im = psd.composite()
            if im is None:
                return None
            width, height = im.size
            im.thumbnail((THUMB_SIZE, THUMB_SIZE))
            _save_thumb_image(im, dest)
            return width, height
        except Exception:
            pass
        try:
            from PIL import Image

            with Image.open(path) as im:
                width, height = im.size
                im.thumbnail((THUMB_SIZE, THUMB_SIZE))
                _save_thumb_image(im, dest)
                return width, height
        except Exception:
            return None

    def psd_layers(self, aid: str) -> list[dict] | None:
        a = self.get_asset(aid)
        if not a or a.get("ext") != ".psd":
            return None
        path = Path(a["path"])
        if not path.exists():
            return None
        try:
            from psd_tools import PSDImage

            psd = PSDImage.open(path)
        except Exception:
            return []
        out: list[dict] = []
        for i, layer in enumerate(psd.descendants()):
            kind = "group" if layer.is_group() else "layer"
            name = layer.name or f"Layer {i}"
            vis = bool(getattr(layer, "visible", True))
            w = getattr(layer, "width", 0) or 0
            h = getattr(layer, "height", 0) or 0
            out.append({"index": i, "name": name, "kind": kind, "visible": vis, "width": w, "height": h})
        return out

    def psd_layer_image(self, aid: str, index: int) -> Path | None:
        a = self.get_asset(aid)
        if not a or a.get("ext") != ".psd":
            return None
        cache = self.thumbs / "psd"
        cache.mkdir(parents=True, exist_ok=True)
        dest = cache / f"{aid}_{index}.png"
        if dest.exists():
            return dest
        path = Path(a["path"])
        try:
            from psd_tools import PSDImage

            psd = PSDImage.open(path)
            layers = list(psd.descendants())
            if index < 0 or index >= len(layers):
                return None
            layer = layers[index]
            im = layer.composite() if not layer.is_group() else None
            if im is None:
                return None
            if im.mode != "RGBA":
                im = im.convert("RGBA")
            im.save(dest, "PNG")
            return dest
        except Exception:
            return None

    def psd_composite(self, aid: str) -> Path | None:
        """Full-resolution flattened render for the lightbox, cached as thumbs/psd/<id>_full.png
        (the `<id>_*.png` cleanup globs cover it) and re-rendered when the PSD is newer. Falls back
        to the card thumbnail only if the full render fails."""
        a = self.get_asset(aid)
        if not a or a.get("ext") != ".psd":
            return None
        path = Path(a["path"])
        dest = self.thumbs / "psd" / f"{aid}_full.png"
        try:
            if dest.exists() and dest.stat().st_mtime >= path.stat().st_mtime:
                return dest
        except OSError:
            pass
        im = None
        try:
            from psd_tools import PSDImage

            im = PSDImage.open(path).composite()
        except Exception:
            im = None
        if im is None:
            try:
                from PIL import Image

                with Image.open(path) as src:
                    im = src.copy()
            except Exception:
                im = None
        if im is not None:
            try:
                dest.parent.mkdir(parents=True, exist_ok=True)
                if im.mode not in ("RGB", "RGBA"):
                    im = im.convert("RGBA")
                im.save(dest, "PNG", compress_level=1)
                return dest
            except Exception:
                pass
        p = self.thumb_path(aid)
        if p:
            return p
        wh = self._thumb_psd(path, self.thumbs / f"{aid}.jpg")
        p = self.thumb_path(aid)
        if p and wh:
            self.execute(
                "UPDATE assets SET has_thumb=1, width=?, height=? WHERE id=?",
                (wh[0], wh[1], aid),
            )
        return p

    def _thumb_pdf(self, path: Path, dest: Path) -> tuple[int, int] | None:
        # ffmpeg has no PDF demuxer in stock builds (confirmed: it just errors on any real
        # PDF), so rendering the first page needs an actual PDF library — PyMuPDF, no system
        # poppler/ghostscript install required.
        try:
            import pymupdf as fitz

            doc = fitz.open(str(path))
            if doc.page_count < 1:
                return None
            page = doc.load_page(0)
            scale = THUMB_SIZE / max(page.rect.width, page.rect.height, 1)
            pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
            from PIL import Image

            im = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            dest.parent.mkdir(parents=True, exist_ok=True)
            im.save(dest, "JPEG", quality=85)
            return im.size
        except Exception:
            return None

    def _thumb_text(self, path: Path, dest: Path) -> tuple[int, int] | None:
        from PIL import Image, ImageDraw

        try:
            raw = path.open("rb").read(8192)
        except OSError:
            return None
        text = raw.decode("utf-8", "replace")
        lines = text.splitlines()[:24] or [""]
        w, h = 280, THUMB_SIZE
        try:
            im = Image.new("RGB", (w, h), "#f2efe6")
            draw = ImageDraw.Draw(im)
            font = _mono_font(11)
            y = 16
            for line in lines:
                draw.text((16, y), line[:44], fill="#33322c", font=font)
                y += 14
                if y > h - 16:
                    break
            dest.parent.mkdir(parents=True, exist_ok=True)
            im.save(dest, "JPEG", quality=82)
            return w, h
        except Exception:
            return None

    def read_text_preview(self, aid: str, limit: int = 200_000) -> dict | None:
        a = self.get_asset(aid)
        if not a or a.get("kind") != "document" or a.get("ext") not in TEXT_EXT:
            return None
        path = Path(a["path"])
        if not path.exists():
            return None
        try:
            size = path.stat().st_size
            with path.open("rb") as fh:
                raw = fh.read(limit + 1)
        except OSError:
            return None
        truncated = len(raw) > limit or size > limit
        text = raw[:limit].decode("utf-8", "replace")
        return {"text": text, "truncated": truncated}

    def _thumb_font(self, path: Path, dest: Path) -> tuple[int, int] | None:
        from PIL import Image, ImageDraw, ImageFont

        w, h = THUMB_SIZE, THUMB_SIZE
        try:
            big = ImageFont.truetype(str(path), 104)
            small = ImageFont.truetype(str(path), 20)
        except Exception:
            return None
        im = Image.new("RGB", (w, h), "#121214")
        draw = ImageDraw.Draw(im)
        sample = "Aa"
        bbox = draw.textbbox((0, 0), sample, font=big)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        draw.text(((w - tw) / 2 - bbox[0], (h - th) / 2 - bbox[1] - 16), sample, font=big, fill="#eceef2")
        label = path.stem[:22]
        lb = draw.textbbox((0, 0), label, font=small)
        draw.text(((w - (lb[2] - lb[0])) / 2, h - 40), label, font=small, fill="#8d8d96")
        dest.parent.mkdir(parents=True, exist_ok=True)
        im.save(dest, "JPEG", quality=85)
        return w, h

    def _thumb_audio(self, path: Path, dest: Path) -> tuple[int, int] | None:
        from PIL import Image, ImageDraw

        peaks = self._decode_peaks(path, bars=48)
        if not peaks:
            return None
        bar_peaks, _duration_ms = peaks
        w, h = THUMB_SIZE, THUMB_SIZE
        im = Image.new("RGB", (w, h), "#14151a")
        draw = ImageDraw.Draw(im)
        n = len(bar_peaks)
        gap = 3.0
        bw = max(1.0, (w - gap * (n + 1)) / n)
        cy = h / 2
        for i, p in enumerate(bar_peaks):
            bh = max(3.0, (p / 255) * (h * 0.62))
            x0 = gap + i * (bw + gap)
            draw.rounded_rectangle(
                [x0, cy - bh / 2, x0 + bw, cy + bh / 2], radius=bw / 2, fill="#5b8cff"
            )
        dest.parent.mkdir(parents=True, exist_ok=True)
        im.save(dest, "JPEG", quality=82)
        return w, h

    def _decode_peaks(self, path: Path, bars: int = 96) -> tuple[list[int], int] | None:
        """Shared ffmpeg PCM decode + peak bucketing, used by both the interactive waveform
        (§make_waveform) and the audio thumbnail."""
        if not self.ffmpeg:
            self.ffmpeg = find_ffmpeg()
        if not self.ffmpeg:
            return None
        sr = 8000
        cmd = [
            self.ffmpeg, "-hide_banner", "-loglevel", "error",
            "-i", str(path), "-ac", "1", "-ar", str(sr), "-f", "s16le", "-",
        ]
        try:
            proc = subprocess.run(cmd, capture_output=True, timeout=60, check=True)
        except Exception:
            return None
        raw = proc.stdout
        if len(raw) < 2:
            return None
        import array

        samples = array.array("h")
        samples.frombytes(raw[: len(raw) - (len(raw) % 2)])
        n = len(samples)
        if n == 0:
            return None
        block = max(1, n // bars)
        peaks: list[int] = []
        mx = 1
        for b in range(bars):
            start = b * block
            end = min(start + block, n)
            if start >= n:
                peaks.append(0)
                continue
            seg = samples[start:end]
            peak = max(-min(seg), max(seg), 0)
            peaks.append(peak)
            if peak > mx:
                mx = peak
        scale = 255 / mx if mx > 0 else 0
        peaks = [int(round(p * scale)) for p in peaks]
        duration_ms = int(n / sr * 1000)
        return peaks, duration_ms

    def _thumb_blend(self, path: Path, dest: Path) -> tuple[int, int] | None:
        """Extracts the thumbnail Blender embeds in its own .blend files (the 'TEST' file
        block) — no bpy/Blender install needed, same trick used by desktop-shell thumbnailers."""
        from PIL import Image

        try:
            found = _read_blend_thumb(path)
        except Exception:
            return None
        if not found:
            return None
        w, h, pixels = found
        try:
            im = Image.frombytes("RGBA", (w, h), pixels).transpose(Image.FLIP_TOP_BOTTOM)
            im.thumbnail((THUMB_SIZE, THUMB_SIZE))
            dest.parent.mkdir(parents=True, exist_ok=True)
            im.convert("RGB").save(dest, "JPEG", quality=85)
            return im.size
        except Exception:
            return None

    def file_info(self, aid: str) -> list[dict] | None:
        """Per-type details for the lightbox info overlay (see app/fileinfo.py). Cached per file
        version, since some readers (ffmpeg, PSD, OBJ line counts) take a moment."""
        a = self.get_asset(aid)
        if not a:
            return None
        path = Path(a["path"])
        try:
            st = path.stat()
        except OSError:
            return []
        key = (aid, st.st_mtime, st.st_size)
        hit = self._info_cache.get(aid)
        if hit and hit[0] == key:
            return hit[1]
        if not self.ffmpeg and a["kind"] in ("video", "audio"):
            self.ffmpeg = find_ffmpeg()
        info = file_info(path, a["kind"], a["ext"], self.ffmpeg)
        if len(self._info_cache) > 256:
            self._info_cache.clear()
        self._info_cache[aid] = (key, info)
        return info

    def companions(self, aid: str) -> list[dict]:
        """Filename-heuristic model<->texture pairing for models that reference external
        textures (no material-file parsing here, same fallback AssetsBoss itself uses)."""
        a = self.get_asset(aid)
        if not a or a.get("kind") != "model3d":
            return []
        folder = Path(a["path"]).parent
        model_base = Path(a["name"]).stem.lower()
        prefix = str(folder) + os.sep
        esc_prefix = prefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        rows = self.query(
            "SELECT id, name, path FROM assets WHERE kind='image' AND path LIKE ? ESCAPE '\\' AND id != ?",
            (esc_prefix + "%", aid),
        )
        out: list[dict] = []
        for r in rows:
            if Path(r["path"]).parent != folder:
                continue
            base = Path(r["name"]).stem.lower()
            if base == model_base:
                out.append({"id": r["id"], "name": r["name"], "slot": "map"})
                continue
            for pat, slot in _TEXTURE_SUFFIX_SLOT:
                m = pat.search(base)
                if m and base[: m.start()] == model_base:
                    out.append({"id": r["id"], "name": r["name"], "slot": slot})
                    break
        return out

    def resolve_model_resource(self, aid: str, name: str) -> Path | None:
        """Finds a file a model references by (relative) name — an FBX texture, a glTF's
        .bin/textures. The viewer's own /api/file/{id} URLs carry no directory, so the
        loaders' relative lookups all land here instead. Looks beside the model and in the
        usual texture folders first, then falls back to any indexed image with that name,
        preferring the one nearest the model."""
        a = self.get_asset(aid)
        if not a or a.get("kind") != "model3d":
            return None
        parts = [p for p in re.split(r"[\\/]+", name or "") if p and p != "."]
        if not parts:
            return None
        base = parts[-1]
        ext = Path(base).suffix.lower()
        if ext not in MODEL_RES_EXT:
            return None
        model = Path(a["path"])
        folder = model.parent
        found: Path | None = None
        direct = Path(os.path.normpath(str(folder.joinpath(*parts))))
        if direct.is_file():
            found = direct
        if found is None:
            probes = [folder, folder.parent]
            for root in (folder, folder.parent):
                for sub in ("textures", "Textures", "tex", "maps", "images", "materials", model.stem + ".fbm"):
                    probes.append(root / sub)
            want = base.lower()
            for d in probes:
                try:
                    for entry in os.scandir(d):
                        if entry.name.lower() == want and entry.is_file():
                            found = Path(entry.path)
                            break
                except OSError:
                    continue
                if found:
                    break
        if found is None:
            rows = self.query("SELECT path FROM assets WHERE kind='image' AND name = ? COLLATE NOCASE", (base,))
            best = -1
            for r in rows:
                p = Path(r["path"])
                score = len(os.path.commonpath([str(p.parent), str(folder)])) if p.anchor == folder.anchor else 0
                if score > best and p.is_file():
                    best, found = score, p
        if found is None:
            return None
        if ext not in MODEL_RES_CONVERT:
            return found
        # Browsers can't decode these — hand back a PNG (cached) instead.
        from PIL import Image

        cache = self.thumbs / "modelres" / f"{asset_id(str(found))}_{int(found.stat().st_mtime)}.png"
        if not cache.exists():
            cache.parent.mkdir(parents=True, exist_ok=True)
            try:
                with Image.open(found) as im:
                    im.load()
                    im.convert("RGBA" if "A" in im.getbands() else "RGB").save(cache, "PNG")
            except Exception:
                cache.unlink(missing_ok=True)
                return None
        return cache

    def waveform_path(self, aid: str) -> Path | None:
        p = self.thumbs / "wave" / f"{aid}.json"
        return p if p.exists() else None

    def usdz_glb_path(self, aid: str) -> Path | None:
        p = self.thumbs / "usdz" / f"{aid}.glb"
        return p if p.exists() else None

    def make_usdz_glb(self, aid: str) -> Path | None:
        """Convert a .usdz asset to .glb on first request so the existing
        GLTFLoader path can view/thumbnail it — three.js has no USD loader
        of its own. Requires the optional `usd-core` dependency; returns
        None (caller falls back to the "open externally" placeholder) if
        that isn't installed or the conversion fails for any reason."""
        a = self.get_asset(aid)
        if not a or a.get("ext") != ".usdz":
            return None
        path = Path(a["path"])
        if not path.exists():
            return None

        def fresh(p: Path | None) -> bool:
            return bool(p) and p.stat().st_mtime >= path.stat().st_mtime

        cached = self.usdz_glb_path(aid)
        if fresh(cached):
            return cached
        # The viewer and the thumbnailer can both ask for the same file at once — serialise, so
        # the second caller reuses the first one's result instead of converting (and writing) again.
        with self._usdz_lock:
            cached = self.usdz_glb_path(aid)
            if fresh(cached):
                return cached
            from .usdz_convert import convert

            dest = self.thumbs / "usdz" / f"{aid}.glb"
            dest.parent.mkdir(parents=True, exist_ok=True)
            try:
                ok = convert(path, dest)
            except Exception:
                ok = False
            if not ok:
                dest.unlink(missing_ok=True)
                return None
            return dest

    def make_waveform(self, aid: str) -> Path | None:
        cached = self.waveform_path(aid)
        if cached:
            return cached
        a = self.get_asset(aid)
        if not a or a.get("kind") != "audio":
            return None
        path = Path(a["path"])
        if not path.exists():
            return None
        # 160 bars (up from 96) gives the client-side progress fill finer granularity to
        # step through, which combined with the rAF-driven paint loop is what actually
        # fixes the "jumps in batches" look — coarse bars were the bulk of the jumpiness.
        found = self._decode_peaks(path, bars=160)
        if not found:
            return None
        peaks, duration_ms = found
        dest = self.thumbs / "wave" / f"{aid}.json"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps({"durationMs": duration_ms, "peaks": peaks}), encoding="utf-8")
        return dest

    def _watch(self, sid: str, path: str) -> None:
        if sid in self._watchers:
            return
        try:
            from watchdog.events import FileSystemEventHandler
            from watchdog.observers import Observer
        except Exception:
            return

        lib = self

        class H(FileSystemEventHandler):
            def on_created(self, event):  # type: ignore[no-untyped-def]
                if event.is_directory:
                    return
                kind = kind_of(event.src_path)
                if kind:
                    lib._touch_one(sid, event.src_path, kind)

            def on_deleted(self, event):  # type: ignore[no-untyped-def]
                lib._mark_gone(event.src_path)

            def on_moved(self, event):  # type: ignore[no-untyped-def]
                kind = kind_of(event.dest_path)
                if kind and not event.is_directory:
                    # watchdog pairs the two paths itself here, so unlike _reconcile_moved's
                    # name+size guess this move is known for certain — carry the old row's tags/
                    # rating/note/thumbnail over even when the new name differs (an actual rename).
                    old_id = asset_id(event.src_path)
                    had = bool(lib.query("SELECT 1 FROM assets WHERE id=?", (old_id,)))
                    lib._touch_one(sid, event.dest_path, kind)
                    if had:
                        new_id = asset_id(event.dest_path)
                        if new_id != old_id:
                            lib._migrate_asset(old_id, new_id)
                        return
                if not event.is_directory:
                    lib._mark_gone(event.src_path)

            def on_modified(self, event):  # type: ignore[no-untyped-def]
                if event.is_directory:
                    return
                kind = kind_of(event.src_path)
                if kind:
                    lib._touch_one(sid, event.src_path, kind)

        obs = Observer()
        obs.schedule(H(), path, recursive=True)
        obs.daemon = True
        obs.start()
        self._watchers[sid] = obs

    def _mark_gone(self, fp: str) -> None:
        """Flags `fp` and everything indexed under it as missing. A folder sent to the Recycle
        Bin or moved out of the watched tree arrives from watchdog as ONE deleted event for the
        folder itself (with is_directory=False on Windows — the path no longer exists to stat),
        not one per file inside, so matching the exact path alone left its contents 'ready'
        forever. Excluded rows are left alone, same as scan_source does."""
        prefix = fp.rstrip("\\/") + os.sep
        cur = self.execute(
            "UPDATE assets SET status='missing' WHERE status NOT IN ('missing','excluded') "
            "AND (path=? OR substr(path, 1, ?)=?)",
            (fp, len(prefix), prefix),
        )
        if cur.rowcount:
            self.bus.publish({"type": "batch", "n": 0})

    def _touch_one(self, sid: str, fp: str, kind: str) -> None:
        excluded_n = self.excluded_set(sid)
        if excluded_n:
            n = normpath(fp)
            if any(n == e or n.startswith(e + os.sep) for e in excluded_n):
                return
        root = self.source_root(sid)
        if root and self.hidden(root, fp):
            self.execute("UPDATE assets SET status='excluded' WHERE path=? AND status!='excluded'", (fp,))
            return
        try:
            st = os.stat(fp)
        except OSError:
            self.execute("UPDATE assets SET status='missing' WHERE path=?", (fp,))
            return
        aid = asset_id(fp)
        name = Path(fp).name
        ext = Path(fp).suffix.lower()
        row = self.query("SELECT mtime, size, status FROM assets WHERE id=?", (aid,))
        unchanged = row and abs(row[0]["mtime"] - st.st_mtime) < 0.01 and row[0]["size"] == st.st_size
        if unchanged and row[0]["status"] != "missing":
            return
        if unchanged:
            # Same content as what's indexed (e.g. restored from the recycle bin, which keeps the
            # original mtime) but the row was sitting at status='missing' from when the file was
            # gone — the cached thumbnail is still valid, just flip the row back to 'ready'.
            self.execute("UPDATE assets SET status='ready' WHERE id=?", (aid,))
            self.bus.publish({"type": "batch", "n": 1, "source": sid})
            return
        now = int(time.time() * 1000)
        if row:
            # size/mtime differ from what's indexed — the file at this path was replaced (e.g.
            # deleted and a different file put back under the same name) or edited in place, so
            # any cached thumbnail was rendered from the old content and must not survive: without
            # this, thumb_path()/_make_thumb() find the stale file still sitting on disk and treat
            # it as current, and the new content's thumbnail is never generated.
            for p in (
                self.thumbs / f"{aid}.jpg", self.thumbs / f"{aid}.png",
                self.thumbs / "wave" / f"{aid}.json", self.thumbs / "usdz" / f"{aid}.glb",
                *(self.thumbs / "psd").glob(f"{aid}_*.png"),
            ):
                try:
                    p.unlink(missing_ok=True)
                except OSError:
                    pass
            self.execute(
                """
                UPDATE assets SET size=?, mtime=?, name=?, ext=?, kind=?, status='ready', has_thumb=0
                WHERE id=?
                """,
                (st.st_size, st.st_mtime, name, ext, kind, aid),
            )
            self._have_thumb.discard(aid)
        else:
            self.execute(
                """
                INSERT INTO assets(id, source_id, path, name, ext, kind, size, mtime, status, has_thumb, added_at)
                VALUES (?,?,?,?,?,?,?,?,'ready',0,?)
                """,
                (aid, sid, fp, name, ext, kind, st.st_size, st.st_mtime, now),
            )
        self.bus.publish({"type": "batch", "n": 1, "source": sid})

    def resume_watchers(self) -> None:
        sids = []
        for row in self.query("SELECT id, path FROM sources"):
            if Path(row["path"]).is_dir():
                self._watch(row["id"], row["path"])
                sids.append(row["id"])
        if not sids:
            return

        def run_all() -> None:
            threads = [threading.Thread(target=self.scan_source, args=(sid,)) for sid in sids]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            # Each scan already reconciles moves at its own end (see _reconcile_moved), but a file
            # moved between two sources needs BOTH scans done first — an unlucky interleaving of two
            # near-instant scans could otherwise have each one look too early and miss the other's
            # side. One more pass here, after every startup scan has genuinely finished, closes that.
            self._reconcile_moved()

        threading.Thread(target=run_all, daemon=True).start()

    def _clause(
        self,
        q: str = "",
        kind: str = "",
        source_id: str = "",
        tag: str = "",
        missing: bool = False,
        collection_id: str = "",
        folder: str = "",
    ) -> tuple[str, list[object]]:
        where = ["status != 'excluded'"]
        args: list[object] = []
        for tok in [t for t in q.replace(",", " ").split() if t]:
            needle = tok.lower()
            where.append("(instr(lower(name), ?) OR instr(lower(note), ?) OR instr(lower(tags), ?))")
            args.extend([needle, needle, needle])
        if kind:
            where.append("kind=?")
            args.append(kind)
        if source_id:
            where.append("source_id=?")
            args.append(source_id)
        if tag:
            where.append("tags LIKE ?")
            args.append(f"%{tag}%")
        if missing:
            where.append("status='missing'")
        if collection_id:
            where.append("id IN (SELECT asset_id FROM collection_assets WHERE collection_id=?)")
            args.append(collection_id)
        if folder:
            prefix = os.path.normpath(folder).rstrip("\\/") + os.sep
            where.append("substr(path, 1, ?) = ?")
            args.extend([len(prefix), prefix])
        return " AND ".join(where), args

    # Sort keys the UI can request, mapped to their SQL expression. "tag" sorts by each asset's
    # first tag (tags are stored as a JSON array with no separate table to join on).
    _SORT_EXPR = {
        "name": "name COLLATE NOCASE",
        "kind": "kind",
        "added": "added_at",
        "modified": "mtime",
        "size": "size",
        "res": "(width * height)",
        "rating": "rating",
        "tag": "lower(json_extract(tags, '$[0]'))",
    }

    def _order_by(self, sort: str, order: str) -> str:
        expr = self._SORT_EXPR.get(sort)
        if not expr:
            return "ORDER BY rowid"
        direction = "DESC" if order == "desc" else "ASC"
        # Assets missing the sorted field (no tag, no rating, unknown resolution…) always sort
        # last, whichever direction is picked — otherwise DESC would put them first, which reads
        # as "unrated stuff is best".
        return f"ORDER BY ({expr}) IS NULL, {expr} {direction}, rowid"

    def list_assets(
        self,
        q: str = "",
        kind: str = "",
        source_id: str = "",
        tag: str = "",
        missing: bool = False,
        collection_id: str = "",
        offset: int = 0,
        limit: int = 400,
        folder: str = "",
        sort: str = "",
        order: str = "asc",
    ) -> list[dict]:
        clause, args = self._clause(q, kind, source_id, tag, missing, collection_id, folder)
        order_sql = self._order_by(sort, order)
        sql = (
            f"SELECT id, source_id, path, name, ext, kind, size, mtime, width, height, "
            f"duration, tags, note, rating, status, has_thumb, animated, added_at "
            f"FROM assets WHERE {clause} {order_sql} LIMIT ? OFFSET ?"
        )
        args.extend([limit, offset])
        out = []
        for r in self.query(sql, tuple(args)):
            item = dict(r)
            raw_tags = item.get("tags") or "[]"
            try:
                item["tags"] = json.loads(raw_tags)
            except json.JSONDecodeError:
                item["tags"] = []
            if item["id"] in self._have_thumb:
                item["has_thumb"] = 1
            if item["has_thumb"]:
                item["thumb_v"] = self.thumb_version(item["id"])
            out.append(item)
        return out

    def count_filtered(
        self,
        q: str = "",
        kind: str = "",
        source_id: str = "",
        tag: str = "",
        missing: bool = False,
        collection_id: str = "",
        folder: str = "",
    ) -> int:
        clause, args = self._clause(q, kind, source_id, tag, missing, collection_id, folder)
        row = self.query(f"SELECT COUNT(*) c FROM assets WHERE {clause}", tuple(args))
        return int(row[0]["c"]) if row else 0

    def collections(self) -> list[dict]:
        cols = [dict(r) for r in self.query("SELECT id, name, parent_id, created_at, icon, color FROM collections ORDER BY sort_order, created_at")]
        counts = {
            r["collection_id"]: int(r["c"])
            for r in self.query("SELECT collection_id, COUNT(*) c FROM collection_assets GROUP BY collection_id")
        }
        members: dict[str, list[str]] = {}
        for r in self.query("SELECT collection_id, asset_id FROM collection_assets"):
            members.setdefault(r["collection_id"], []).append(r["asset_id"])
        for c in cols:
            c["count"] = counts.get(c["id"], 0)
            c["assetIds"] = members.get(c["id"], [])
            c["parentId"] = c.pop("parent_id")
        return cols

    def add_collection(self, name: str, parent_id: str | None = None) -> dict:
        cid = asset_id(f"col:{time.time_ns()}:{name}")
        nxt = self.query("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM collections")[0]["n"]
        self.execute(
            "INSERT INTO collections(id, name, parent_id, created_at, sort_order) VALUES (?,?,?,?,?)",
            (cid, name.strip() or "Untitled", parent_id or None, int(time.time() * 1000), nxt),
        )
        return {"id": cid, "name": name.strip() or "Untitled", "parentId": parent_id, "assetIds": [], "count": 0, "icon": None, "color": None}

    def set_collection_icon(self, cid: str, icon: str | None, color: str | None) -> None:
        self.execute("UPDATE collections SET icon=?, color=? WHERE id=?", (icon or None, color or None, cid))

    def rename_collection(self, cid: str, name: str) -> None:
        self.execute("UPDATE collections SET name=? WHERE id=?", (name.strip() or "Untitled", cid))

    def move_collection(self, cid: str, parent_id: str | None) -> None:
        if parent_id == cid:
            return
        # Walking up from the proposed parent must never reach cid, or the move would turn cid
        # into its own ancestor.
        if parent_id:
            by_id = {r["id"]: r["parent_id"] for r in self.query("SELECT id, parent_id FROM collections")}
            cur = parent_id
            seen = set()
            while cur is not None:
                if cur == cid or cur in seen:
                    return
                seen.add(cur)
                cur = by_id.get(cur)
        self.execute("UPDATE collections SET parent_id=? WHERE id=?", (parent_id, cid))

    def reorder_collections(self, ids: list[str]) -> None:
        if not ids:
            return
        with self.lock:
            for i, cid in enumerate(ids):
                self.conn.execute("UPDATE collections SET sort_order=? WHERE id=?", (i, cid))
            self.conn.commit()

    def delete_collection(self, cid: str) -> None:
        drop = [cid]
        changed = True
        while changed:
            changed = False
            rows = self.query("SELECT id, parent_id FROM collections")
            have = {r["id"] for r in rows if r["id"] in drop}
            for r in rows:
                if r["parent_id"] in have and r["id"] not in drop:
                    drop.append(r["id"])
                    changed = True
        with self.lock:
            for i in drop:
                self.conn.execute("DELETE FROM collection_assets WHERE collection_id=?", (i,))
                self.conn.execute("DELETE FROM collections WHERE id=?", (i,))
            self.conn.commit()

    def add_to_collection(self, cid: str, ids: list[str]) -> None:
        rows = [(cid, i) for i in ids if i]
        self.executemany(
            "INSERT OR IGNORE INTO collection_assets(collection_id, asset_id) VALUES (?,?)",
            rows,
        )

    def remove_from_collection(self, cid: str, ids: list[str]) -> None:
        self.executemany(
            "DELETE FROM collection_assets WHERE collection_id=? AND asset_id=?",
            [(cid, i) for i in ids],
        )

    # ---- Canvas boards ----------------------------------------------------------------
    # boards / board_groups / board_items / annotations all carry revision/updated_at/
    # deleted_at so a future sync layer can diff by timestamp and learn about a remote
    # deletion from the tombstone, without a schema change. See app/static/canvas.js.

    def boards(self) -> list[dict]:
        rows = [dict(r) for r in self.query(
            "SELECT id, name, sort_order, color, icon, bg_color, viewport_x, viewport_y, "
            "viewport_zoom, created_at, updated_at FROM boards WHERE deleted_at IS NULL "
            "ORDER BY sort_order, created_at"
        )]
        counts = {
            r["board_id"]: int(r["c"])
            for r in self.query(
                "SELECT board_id, COUNT(*) c FROM board_items WHERE deleted_at IS NULL GROUP BY board_id"
            )
        }
        for b in rows:
            b["itemCount"] = counts.get(b["id"], 0)
        return rows

    def add_board(self, name: str) -> dict:
        bid = asset_id(f"board:{time.time_ns()}:{name}")
        now = int(time.time() * 1000)
        nxt = self.query("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM boards")[0]["n"]
        name = name.strip() or "Untitled"
        self.execute(
            "INSERT INTO boards(id, name, sort_order, created_at, updated_at, revision) VALUES (?,?,?,?,?,1)",
            (bid, name, nxt, now, now),
        )
        return {
            "id": bid, "name": name, "sort_order": nxt, "color": None, "icon": None, "bg_color": None,
            "viewport_x": 0.0, "viewport_y": 0.0, "viewport_zoom": 1.0,
            "created_at": now, "updated_at": now, "itemCount": 0,
        }

    def update_board(self, bid: str, body: dict) -> dict | None:
        rows = self.query("SELECT * FROM boards WHERE id=? AND deleted_at IS NULL", (bid,))
        if not rows:
            return None
        cur = dict(rows[0])
        name = str(body.get("name", cur["name"])).strip() or "Untitled"
        color = body.get("color", cur["color"])
        icon = body.get("icon", cur["icon"])
        bg_color = body.get("bg_color", cur["bg_color"])
        vx = float(body.get("viewport_x", cur["viewport_x"]))
        vy = float(body.get("viewport_y", cur["viewport_y"]))
        vz = float(body.get("viewport_zoom", cur["viewport_zoom"]))
        now = int(time.time() * 1000)
        self.execute(
            "UPDATE boards SET name=?, color=?, icon=?, bg_color=?, viewport_x=?, viewport_y=?, "
            "viewport_zoom=?, updated_at=?, revision=revision+1 WHERE id=?",
            (name, color, icon, bg_color, vx, vy, vz, now, bid),
        )
        rows = self.query("SELECT id, name, sort_order, color, icon, bg_color, viewport_x, viewport_y, "
                           "viewport_zoom, created_at, updated_at FROM boards WHERE id=?", (bid,))
        return dict(rows[0]) if rows else None

    def reorder_boards(self, ids: list[str]) -> None:
        if not ids:
            return
        with self.lock:
            for i, bid in enumerate(ids):
                self.conn.execute("UPDATE boards SET sort_order=? WHERE id=?", (i, bid))
            self.conn.commit()

    def delete_board(self, bid: str) -> None:
        now = int(time.time() * 1000)
        with self.lock:
            self.conn.execute("UPDATE annotations SET deleted_at=?, updated_at=? WHERE board_id=?", (now, now, bid))
            self.conn.execute("UPDATE board_items SET deleted_at=?, updated_at=? WHERE board_id=?", (now, now, bid))
            self.conn.execute("UPDATE board_groups SET deleted_at=?, updated_at=? WHERE board_id=?", (now, now, bid))
            self.conn.execute("UPDATE boards SET deleted_at=?, updated_at=? WHERE id=?", (now, now, bid))
            self.conn.commit()

    def board_full(self, bid: str) -> dict | None:
        rows = self.query("SELECT id, name, sort_order, color, icon, bg_color, viewport_x, viewport_y, "
                           "viewport_zoom, created_at, updated_at FROM boards WHERE id=? AND deleted_at IS NULL", (bid,))
        if not rows:
            return None
        board = dict(rows[0])
        items = [dict(r) for r in self.query(
            "SELECT * FROM board_items WHERE board_id=? AND deleted_at IS NULL ORDER BY z_index", (bid,)
        )]
        groups = [dict(r) for r in self.query(
            "SELECT * FROM board_groups WHERE board_id=? AND deleted_at IS NULL ORDER BY z_index", (bid,)
        )]
        annotations = [self._annotation_out(r) for r in self.query(
            "SELECT * FROM annotations WHERE board_id=? AND deleted_at IS NULL ORDER BY z_index", (bid,)
        )]
        return {"board": board, "items": items, "groups": groups, "annotations": annotations}

    def add_board_item(self, bid: str, body: dict) -> dict:
        iid = asset_id(f"bitem:{time.time_ns()}:{body.get('asset_id', '')}")
        now = int(time.time() * 1000)
        playback = body.get("playback_state")
        self.execute(
            "INSERT INTO board_items(id, board_id, asset_id, group_id, x, y, w, h, rotation, "
            "z_index, opacity, desaturate, always_on_top, crop_x, crop_y, crop_w, crop_h, "
            "color_label, locked, playback_state, flip_x, flip_y, created_at, updated_at, revision) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)",
            (
                iid, bid, str(body.get("asset_id") or ""), body.get("group_id"),
                float(body.get("x", 0)), float(body.get("y", 0)),
                float(body.get("w", 240)), float(body.get("h", 240)),
                float(body.get("rotation", 0)), int(body.get("z_index", 0)),
                float(body.get("opacity", 1)), 1 if body.get("desaturate") else 0,
                1 if body.get("always_on_top") else 0,
                body.get("crop_x"), body.get("crop_y"), body.get("crop_w"), body.get("crop_h"),
                body.get("color_label"), 1 if body.get("locked") else 0,
                json.dumps(playback) if playback is not None else None,
                1 if body.get("flip_x") else 0, 1 if body.get("flip_y") else 0,
                now, now,
            ),
        )
        rows = self.query("SELECT * FROM board_items WHERE id=?", (iid,))
        return dict(rows[0])

    _BOARD_ITEM_FIELDS = (
        "group_id", "x", "y", "w", "h", "rotation", "z_index", "opacity", "desaturate",
        "always_on_top", "crop_x", "crop_y", "crop_w", "crop_h", "color_label", "locked",
        "playback_state", "flip_x", "flip_y",
    )

    def _board_item_values(self, body: dict) -> dict:
        vals = {f: body[f] for f in self._BOARD_ITEM_FIELDS if f in body}
        if "playback_state" in vals and vals["playback_state"] is not None:
            vals["playback_state"] = json.dumps(vals["playback_state"])
        return vals

    def update_board_item(self, item_id: str, body: dict) -> dict | None:
        rows = self.query("SELECT id FROM board_items WHERE id=? AND deleted_at IS NULL", (item_id,))
        if not rows:
            return None
        vals = self._board_item_values(body)
        if vals:
            now = int(time.time() * 1000)
            set_sql = ", ".join(f"{k}=?" for k in vals) + ", updated_at=?, revision=revision+1"
            self.execute(f"UPDATE board_items SET {set_sql} WHERE id=?", (*vals.values(), now, item_id))
        rows = self.query("SELECT * FROM board_items WHERE id=?", (item_id,))
        return dict(rows[0]) if rows else None

    def batch_update_board_items(self, updates: list[dict]) -> None:
        now = int(time.time() * 1000)
        with self.lock:
            for u in updates:
                iid = u.get("id")
                if not iid:
                    continue
                vals = self._board_item_values(u)
                if not vals:
                    continue
                set_sql = ", ".join(f"{k}=?" for k in vals) + ", updated_at=?, revision=revision+1"
                self.conn.execute(f"UPDATE board_items SET {set_sql} WHERE id=?", (*vals.values(), now, iid))
            self.conn.commit()

    def delete_board_items(self, ids: list[str]) -> None:
        if not ids:
            return
        now = int(time.time() * 1000)
        with self.lock:
            self.conn.executemany(
                "UPDATE board_items SET deleted_at=?, updated_at=? WHERE id=?",
                [(now, now, i) for i in ids],
            )
            self.conn.commit()

    def add_board_group(self, bid: str, item_ids: list[str], annotation_ids: list[str], name: str = "") -> dict:
        gid = asset_id(f"bgroup:{time.time_ns()}:{bid}")
        now = int(time.time() * 1000)
        self.execute(
            "INSERT INTO board_groups(id, board_id, name, created_at, updated_at, revision) VALUES (?,?,?,?,?,1)",
            (gid, bid, name or None, now, now),
        )
        with self.lock:
            if item_ids:
                self.conn.executemany(
                    "UPDATE board_items SET group_id=?, updated_at=? WHERE id=?",
                    [(gid, now, i) for i in item_ids],
                )
            if annotation_ids:
                self.conn.executemany(
                    "UPDATE annotations SET group_id=?, updated_at=? WHERE id=?",
                    [(gid, now, i) for i in annotation_ids],
                )
            self.conn.commit()
        rows = self.query("SELECT * FROM board_groups WHERE id=?", (gid,))
        return dict(rows[0])

    _BOARD_GROUP_FIELDS = ("name", "collapsed", "x", "y", "w", "h", "rotation", "z_index", "parent_group_id")

    def update_board_group(self, gid: str, body: dict) -> dict | None:
        rows = self.query("SELECT id FROM board_groups WHERE id=? AND deleted_at IS NULL", (gid,))
        if not rows:
            return None
        vals = {f: body[f] for f in self._BOARD_GROUP_FIELDS if f in body}
        if vals:
            now = int(time.time() * 1000)
            set_sql = ", ".join(f"{k}=?" for k in vals) + ", updated_at=?, revision=revision+1"
            self.execute(f"UPDATE board_groups SET {set_sql} WHERE id=?", (*vals.values(), now, gid))
        rows = self.query("SELECT * FROM board_groups WHERE id=?", (gid,))
        return dict(rows[0]) if rows else None

    def ungroup_board_group(self, gid: str) -> None:
        now = int(time.time() * 1000)
        with self.lock:
            self.conn.execute("UPDATE board_items SET group_id=NULL, updated_at=? WHERE group_id=?", (now, gid))
            self.conn.execute("UPDATE annotations SET group_id=NULL, updated_at=? WHERE group_id=?", (now, gid))
            self.conn.execute("UPDATE board_groups SET deleted_at=?, updated_at=? WHERE id=?", (now, now, gid))
            self.conn.commit()

    def delete_board_group(self, gid: str) -> None:
        now = int(time.time() * 1000)
        with self.lock:
            self.conn.execute("UPDATE board_items SET deleted_at=?, updated_at=? WHERE group_id=?", (now, now, gid))
            self.conn.execute("UPDATE annotations SET deleted_at=?, updated_at=? WHERE group_id=?", (now, now, gid))
            self.conn.execute("UPDATE board_groups SET deleted_at=?, updated_at=? WHERE id=?", (now, now, gid))
            self.conn.commit()

    def _annotation_out(self, row: sqlite3.Row | dict) -> dict:
        d = dict(row)
        try:
            d["data"] = json.loads(d.get("data") or "{}")
        except json.JSONDecodeError:
            d["data"] = {}
        return d

    def annotations_for_asset(self, aid: str) -> list[dict]:
        rows = self.query(
            "SELECT * FROM annotations WHERE scope='asset' AND target_asset_id=? AND deleted_at IS NULL "
            "ORDER BY z_index",
            (aid,),
        )
        return [self._annotation_out(r) for r in rows]

    def add_annotation(self, body: dict) -> dict:
        scope = str(body.get("scope") or "").strip()
        if scope not in ("asset", "board"):
            raise ValueError("scope must be 'asset' or 'board'")
        aid = asset_id(f"anno:{time.time_ns()}:{scope}")
        now = int(time.time() * 1000)
        self.execute(
            "INSERT INTO annotations(id, kind, shape_kind, scope, target_asset_id, target_board_item_id, "
            "board_id, group_id, x, y, w, h, rotation, z_index, color, data, locked, "
            "created_at, updated_at, revision) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)",
            (
                aid, str(body.get("kind") or "shape"), body.get("shape_kind"), scope,
                body.get("target_asset_id") if scope == "asset" else None,
                body.get("target_board_item_id"),
                body.get("board_id") if scope == "board" else None,
                body.get("group_id"),
                body.get("x"), body.get("y"), body.get("w"), body.get("h"),
                float(body.get("rotation", 0)), int(body.get("z_index", 0)),
                body.get("color"), json.dumps(body.get("data") or {}),
                1 if body.get("locked") else 0, now, now,
            ),
        )
        rows = self.query("SELECT * FROM annotations WHERE id=?", (aid,))
        return self._annotation_out(rows[0])

    _ANNOTATION_FIELDS = (
        "shape_kind", "target_board_item_id", "group_id", "x", "y", "w", "h", "rotation",
        "z_index", "color", "data", "locked",
    )

    def _annotation_values(self, body: dict) -> dict:
        vals = {f: body[f] for f in self._ANNOTATION_FIELDS if f in body}
        if "data" in vals:
            vals["data"] = json.dumps(vals["data"] or {})
        return vals

    def update_annotation(self, aid: str, body: dict) -> dict | None:
        rows = self.query("SELECT id FROM annotations WHERE id=? AND deleted_at IS NULL", (aid,))
        if not rows:
            return None
        vals = self._annotation_values(body)
        if vals:
            now = int(time.time() * 1000)
            set_sql = ", ".join(f"{k}=?" for k in vals) + ", updated_at=?, revision=revision+1"
            self.execute(f"UPDATE annotations SET {set_sql} WHERE id=?", (*vals.values(), now, aid))
        rows = self.query("SELECT * FROM annotations WHERE id=?", (aid,))
        return self._annotation_out(rows[0]) if rows else None

    def batch_update_annotations(self, updates: list[dict]) -> None:
        now = int(time.time() * 1000)
        with self.lock:
            for u in updates:
                aid = u.get("id")
                if not aid:
                    continue
                vals = self._annotation_values(u)
                if not vals:
                    continue
                set_sql = ", ".join(f"{k}=?" for k in vals) + ", updated_at=?, revision=revision+1"
                self.conn.execute(f"UPDATE annotations SET {set_sql} WHERE id=?", (*vals.values(), now, aid))
            self.conn.commit()

    def delete_annotation(self, aid: str) -> None:
        now = int(time.time() * 1000)
        self.execute("UPDATE annotations SET deleted_at=?, updated_at=? WHERE id=?", (now, now, aid))

    def strip_tag(self, name: str) -> int:
        want = name.strip().lower()
        if not want:
            return 0
        n = 0
        for r in self.query("SELECT id, tags FROM assets"):
            try:
                tags = json.loads(r["tags"] or "[]")
            except json.JSONDecodeError:
                continue
            nxt = [t for t in tags if str(t).lower() != want]
            if len(nxt) == len(tags):
                continue
            self.execute("UPDATE assets SET tags=? WHERE id=?", (json.dumps(nxt), r["id"]))
            n += 1
        if n:
            self.execute("DELETE FROM tag_order WHERE lower(name)=?", (want,))
            self.execute("DELETE FROM tag_meta WHERE lower(name)=?", (want,))
        return n

    def rename_tag(self, old: str, new: str) -> int:
        want = old.strip().lower()
        new_name = new.strip()
        if not want or not new_name:
            return 0
        n = 0
        for r in self.query("SELECT id, tags FROM assets"):
            try:
                tags = json.loads(r["tags"] or "[]")
            except json.JSONDecodeError:
                continue
            if not any(str(t).lower() == want for t in tags):
                continue
            nxt = []
            seen = set()
            for t in tags:
                name = new_name if str(t).lower() == want else str(t)
                key = name.lower()
                if key in seen:
                    continue
                seen.add(key)
                nxt.append(name)
            self.execute("UPDATE assets SET tags=? WHERE id=?", (json.dumps(nxt), r["id"]))
            n += 1
        if n:
            self.execute("UPDATE OR IGNORE tag_order SET name=? WHERE lower(name)=?", (new_name, want))
            self.execute("UPDATE OR IGNORE tag_meta SET name=? WHERE lower(name)=?", (new_name, want))
        return n

    def get_asset(self, aid: str) -> dict | None:
        rows = self.query("SELECT * FROM assets WHERE id=?", (aid,))
        if not rows:
            return None
        item = dict(rows[0])
        try:
            item["tags"] = json.loads(item["tags"] or "[]")
        except json.JSONDecodeError:
            item["tags"] = []
        item["has_thumb"] = 1 if aid in self._have_thumb else item.get("has_thumb", 0)
        if item["has_thumb"]:
            item["thumb_v"] = self.thumb_version(aid)
        return item

    def patch_asset(self, aid: str, body: dict) -> dict | None:
        cur = self.get_asset(aid)
        if not cur:
            return None
        tags = body.get("tags", cur["tags"])
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",") if t.strip()]
        note = body.get("note", cur["note"])
        rating = int(body.get("rating", cur["rating"]) or 0)
        self.execute(
            "UPDATE assets SET tags=?, note=?, rating=? WHERE id=?",
            (json.dumps(tags), note, rating, aid),
        )
        return self.get_asset(aid)

    def copy_asset(self, aid: str, dest_dir: str) -> str:
        a = self.get_asset(aid)
        if not a:
            raise ValueError("Missing asset")
        dest = Path(dest_dir).expanduser()
        dest.mkdir(parents=True, exist_ok=True)
        target = dest / a["name"]
        shutil.copy2(a["path"], target)
        return str(target)
