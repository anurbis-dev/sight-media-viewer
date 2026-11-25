"""In-place library: fast metadata scan, viewport-first thumbnails."""

from __future__ import annotations

import fnmatch
import heapq
import logging
import math
import json
import os
import queue
import re
import shutil
import sqlite3
import subprocess
import threading
import secrets
import time
import unicodedata
from contextlib import nullcontext
from pathlib import Path

from .fileinfo import NO_WINDOW, _ffprobe_text, file_info, obj_is_binary

IMAGE_EXT = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff",
    ".avif", ".heic", ".heif", ".svg", ".jxl", ".ico",
}
VIDEO_EXT = {".mp4", ".m4v", ".mov", ".mkv", ".webm", ".avi", ".wmv", ".mpg", ".mpeg"}
AUDIO_EXT = {".mp3", ".wav", ".flac", ".aac", ".m4a", ".ogg", ".opus", ".aiff"}
MODEL_EXT = {
    ".gltf", ".glb", ".fbx", ".obj", ".stl", ".usdz", ".usd", ".usda", ".usdc", ".ply",
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
# Built-in scan filter (see IgnoreRules): shipped next to this file, replaced by <SIGHT_HOME>/<same name>
# when the user edits it (the app folder may be read-only in a frozen build).
FILTER_INI = "initial_filtering.ini"
SHIPPED_FILTER = Path(__file__).resolve().parent / FILTER_INI
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

# Bump when usdz_convert's output changes in a way that makes previously cached .glb files (and the
# thumbnails rendered from them) wrong; Library wipes both on a mismatch. Kept here, not in
# usdz_convert, so the startup check does not import that module (numpy alone costs ~160 ms).
USDZ_CONVERTER_VERSION = 3  # 3: animated stages are not converted (read in the browser)

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


# Review state of an asset: the newest kind='status' annotation row (data.state). Kept as an
# annotation so it travels in .srev packages and merges like the notes do.
REVIEW_STATES = ("review", "changes", "approved")
_REVIEW_SQL = (
    "(SELECT json_extract(an.data, '$.state') FROM annotations an WHERE an.scope='asset' "
    "AND an.kind='status' AND an.target_asset_id=assets.id AND an.deleted_at IS NULL "
    "ORDER BY an.updated_at DESC LIMIT 1)"
)
_OPEN_NOTES_SQL = (
    "(SELECT COUNT(*) FROM annotations an WHERE an.scope='asset' AND an.kind='note' "
    "AND an.target_asset_id=assets.id AND an.deleted_at IS NULL "
    "AND COALESCE(json_extract(an.data, '$.status'), 'open') != 'done')"
)
# Drawings left on the file and never added to a note (annotate.js pendingDrawings: a drawing
# with no data.note). Notes and the review-state row are not drawings.
_LOOSE_DRAW_SQL = (
    "(SELECT COUNT(*) FROM annotations an WHERE an.scope='asset' "
    "AND an.target_asset_id=assets.id AND an.deleted_at IS NULL "
    "AND an.kind NOT IN ('note', 'status') "
    "AND COALESCE(json_extract(an.data, '$.note'), '') = '')"
)

# The filter builder's conditions (docs/PLAN-trackers.md stage 3b): a tree {"op": "and"|"or", "c": [cond | group]},
# cond {"f": field, "o": op, "v": value}, as app/static/filter-core.js sends it (`toLibWire`: dates already resolved
# to epoch ms in the viewer's time zone). Fields and ops are whitelisted here; anything else is a ValueError (400).
_WHERE_TEXT = {"name": "name", "ext": "ltrim(ext, '.')", "path": "path", "note": "note"}
_WHERE_DATE = {"mtime": "(mtime * 1000)", "added": "added_at"}
_WHERE_MAX_DEPTH = 4
_WHERE_MAX_CONDS = 100
_TAGS_JSON = "(CASE WHEN json_valid(assets.tags) THEN assets.tags ELSE '[]' END)"


MAX_RULE_CHARS = 64_000


def _rule_json(rule: object) -> str:
    """A smart collection's rule as stored: a JSON object (the client's Filter ▾ tree, sanitized there), bounded."""
    if not isinstance(rule, dict):
        raise ValueError("a smart collection's rule must be an object")
    try:
        s = json.dumps(rule, ensure_ascii=False, separators=(",", ":"))
        s.encode("utf-8")   # (a lone surrogate would fail in SQLite instead)
    except (RecursionError, TypeError, ValueError):
        raise ValueError("the smart collection's rule is not valid") from None
    if len(s) > MAX_RULE_CHARS:
        raise ValueError("the smart collection's rule is too long")
    return s


def where_sql(tree: object) -> tuple[str, list[object]] | None:
    """SQL (and its arguments) for a filter-builder tree; None when it has no condition."""
    count = [0]

    def num(v: object) -> float:
        try:
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
                raise ValueError
            return float(v)
        except (ValueError, OverflowError):
            raise ValueError("filter: a number is expected") from None

    def text(v: object) -> str:
        if not isinstance(v, str) or len(v) > 500:
            raise ValueError("filter: a text value is expected")
        return v.lower()

    def cond(c: dict) -> tuple[str, list[object]]:
        count[0] += 1
        if count[0] > _WHERE_MAX_CONDS:
            raise ValueError("filter: too many conditions")
        f, o, v = c.get("f"), c.get("o"), c.get("v")
        if f in _WHERE_TEXT:
            col = f"ulower(COALESCE({_WHERE_TEXT[f]}, ''))"
            if o == "empty":
                return f"{col} = ''", []
            if o == "not_empty":
                return f"{col} != ''", []
            t = text(v)
            if f == "ext":
                t = t.lstrip(".")
                if not t:
                    raise ValueError("filter: an extension is expected")
            if o == "contains":
                return f"instr({col}, ?) > 0", [t]
            if o == "not_contains":
                return f"instr({col}, ?) = 0", [t]
            if o == "is":
                return f"{col} = ?", [t]
            if o == "is_not":
                return f"{col} != ?", [t]
            if o == "starts_with":
                return f"substr({col}, 1, ?) = ?", [len(t), t]
            if o == "ends_with":
                return (f"substr({col}, -?) = ?", [len(t), t]) if t else ("1", [])
        elif f in ("kind", "review"):
            col = "kind" if f == "kind" else f"COALESCE({_REVIEW_SQL}, 'none')"
            allowed = KIND_LABEL if f == "kind" else REVIEW_STATES + ("none",)
            if o in ("is", "is_not"):
                if v not in allowed:
                    raise ValueError(f"filter: unknown {f} {v!r}")
                return f"{col} {'=' if o == 'is' else '!='} ?", [v]
        elif f == "tags":
            each = f"SELECT 1 FROM json_each({_TAGS_JSON})"
            if o == "empty":
                return f"json_array_length({_TAGS_JSON}) = 0", []
            if o == "not_empty":
                return f"json_array_length({_TAGS_JSON}) > 0", []
            if o == "has":
                return f"EXISTS ({each} WHERE ulower(value) = ?)", [text(v)]
            if o == "not_has":
                return f"NOT EXISTS ({each} WHERE ulower(value) = ?)", [text(v)]
            if o == "contains":
                return f"EXISTS ({each} WHERE instr(ulower(value), ?) > 0)", [text(v)]
        elif f == "rating":
            sql_op = {"is": "=", "is_not": "!=", "gt": ">", "lt": "<"}.get(str(o))
            if sql_op:
                return f"COALESCE(rating, 0) {sql_op} ?", [num(v)]
        elif f in _WHERE_DATE:
            col = _WHERE_DATE[f]
            if o == "gte":
                return f"{col} >= ?", [num(v)]
            if o == "lt":
                return f"{col} < ?", [num(v)]
            if o == "between":
                if not isinstance(v, list) or len(v) != 2:
                    raise ValueError("filter: between takes two numbers")
                return f"({col} >= ? AND {col} < ?)", [num(v[0]), num(v[1])]
        else:
            raise ValueError(f"filter: unknown field {f!r}")
        raise ValueError(f"filter: {f} has no operator {o!r}")

    def group(g: object, depth: int) -> tuple[str, list[object]] | None:
        if not isinstance(g, dict) or g.get("op") not in ("and", "or") or not isinstance(g.get("c"), list):
            raise ValueError("filter: a group is {op: and|or, c: [...]}")
        if depth > _WHERE_MAX_DEPTH:
            raise ValueError("filter: groups nested too deep")
        parts: list[str] = []
        args: list[object] = []
        for c in g["c"]:
            if not isinstance(c, dict):
                raise ValueError("filter: a condition is an object")
            r = group(c, depth + 1) if "op" in c else cond(c)
            if r:
                parts.append(f"({r[0]})")
                args.extend(r[1])
        if not parts:
            return None
        return (" AND " if g["op"] == "and" else " OR ").join(parts), args

    return group(tree, 1)


# A version token in a file name: shot_v003, shot.v3, shot-ver2, shot_rev12, shot_r4 (the last
# such token wins). Files in one folder whose names are equal once it is cut out are versions of
# each other; a name without a token counts as version 0 of that group.
_VERSION_RE = re.compile(r"(?i)(?:^|(?<=[ ._-]))(?:v|ver|version|rev|r)[ ._-]?(\d{1,4})(?=$|[ ._-])")


def version_key(name: str) -> tuple[str, int]:
    stem = os.path.splitext(name)[0]
    m = None
    for m in _VERSION_RE.finditer(stem):
        pass
    if not m:
        return stem.lower() + "|", 0
    key = (stem[: m.start()].rstrip(" ._-") + "|" + stem[m.end():].lstrip(" ._-")).lower()
    return key, int(m.group(1))


def normpath(p: object) -> str:
    """Case/separator-normalized form of a filesystem path, for cross-platform prefix and
    equality checks (excluded-subfolder matching, source-boundary checks) without hitting disk.
    Unicode is composed (NFC): macOS hands out decomposed names ("Й" as "И" + breve) where a
    typed or pasted path is composed, and both name the same folder there."""
    s = os.path.normcase(os.path.normpath(str(p)))
    return s if s.isascii() or unicodedata.is_normalized("NFC", s) else unicodedata.normalize("NFC", s)


def path_under(child_n: str, parent_n: str) -> bool:
    """`child_n` lies strictly inside `parent_n` (both normpath()ed). A drive root such as
    'c:\\' already ends with the separator."""
    prefix = parent_n if parent_n.endswith(os.sep) else parent_n + os.sep
    return child_n != parent_n and child_n.startswith(prefix)


def disk_spelling(p: Path) -> Path:
    """`p` with each non-ASCII component spelled the way its folder listing spells it (Unicode
    form; on Windows resolve() already fixes case). A source root must match the paths an outer
    source's walk produces for the same folder, or prefix checks between them miss."""
    if str(p).isascii():
        return p
    cur = Path(p.anchor)
    for name in p.parts[1:] if p.anchor else p.parts:
        if not name.isascii():
            want = unicodedata.normalize("NFC", name)
            try:
                with os.scandir(cur) as it:
                    names = [e.name for e in it]
                if name not in names:
                    name = next((n for n in names if unicodedata.normalize("NFC", n) == want), name)
            except OSError:
                pass
        cur = cur / name
    return cur


def fallback_filter_text() -> str:
    """The built-in filter when the ini cannot be read: the hard-coded folder list."""
    return "\n".join(sorted(f"{d}/" for d in SKIP_DIRS))


def read_default_filter(home: Path) -> tuple[str, bool]:
    """(text, custom): the user's copy in SIGHT_HOME if present, else the shipped ini, else the
    hard-coded fallback. Never raises."""
    for path, custom in ((Path(home) / FILTER_INI, True), (SHIPPED_FILTER, False)):
        try:
            return path.read_text(encoding="utf-8-sig").replace("\r\n", "\n"), custom
        except (OSError, UnicodeDecodeError) as e:
            if not custom:
                logging.getLogger("sight").warning("default scan filter %s unreadable (%s): using the built-in folder list", path, e)
            continue
    return fallback_filter_text(), False


class IgnoreRules:
    """The scan ignore rules: the built-in filter (initial_filtering.ini) plus the user's list
    (Settings → Scan Filtering), one pattern per line, gitignore-like:
    `*.meta` / `Thumbs.db` match a file or folder name anywhere; a trailing `/` (`Library/`)
    matches folders only; a pattern with a `/` inside (`Library/PackageCache`) matches that run of
    names anywhere in the tree. `*`, `?` and `[..]` globs, case-insensitive; `#` starts a comment.
    Paths are taken relative to the source root, so the root's own name never matches."""

    def __init__(self, text: str = "", default_text: str = "") -> None:
        self.text = text or ""  # the user's list only (what the DB and the settings field hold)
        self.rules: list[tuple[list[str], bool]] = []
        for line in (default_text or "").splitlines() + self.text.splitlines():
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

    # Delivered by close(): an /api/events stream ends on it (compared by identity).
    CLOSE: dict = {"type": "close"}

    def __init__(self) -> None:
        self._subs: list[queue.Queue[dict]] = []
        self._lock = threading.Lock()
        self.closed = False

    def close(self) -> None:
        """Ends every open event stream (and any opened later), so a server shutdown does not wait
        for them. Used by the macOS Quit (Sight.py); a stream otherwise only ends with its tab."""
        self.closed = True
        self.publish(self.CLOSE)

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


class _Window:
    """One file's part of the sliding cache: its blocks, the block under its playhead and the block ranges planned
    for it (``ranges``: (lo, hi, head, base) — blocks from ``head`` on cost ``base + distance``, blocks before it
    ``(base + distance) * behind_weight``, so the part behind a playhead fills alongside the part ahead)."""

    __slots__ = ("size", "stamp", "head", "blocks", "ranges")

    def __init__(self, size: int, stamp: tuple[int, int]) -> None:
        self.size = size
        self.stamp = stamp  # (size, mtime_ns) the blocks were read at
        self.head = 0
        self.blocks: dict[int, bytes] = {}
        self.ranges: list[tuple[int, int, int, int]] = []

    @property
    def last(self) -> int:
        return (self.size - 1) // SlidingVideoCache.CHUNK if self.size > 0 else -1

    def wants(self, k: int) -> bool:
        return any(lo <= k <= hi for lo, hi, _, _ in self.ranges)


class SlidingVideoCache:
    """RAM windows over the playing video files that follow their playheads.

    Each file is held as fixed 1 MiB blocks. ``focus`` (the lightbox: one file, plus the sequence's neighbours) /
    ``focus_many`` (the version compare: every clip on screen) decide which blocks belong in RAM — the budget is
    split evenly between the playing files, so the more clips play, the smaller each one's window; inside a window
    the share ``ahead`` (Settings, 70 % by default) lies ahead of the playhead, the rest behind it. Missing blocks
    load outwards from the playhead, a block behind it costing ``ahead / (1 - ahead)`` blocks ahead, so both ends
    of the window are reached at the same time. In a sequence the part of the window past the clip's end goes to
    the next clip's start, the part before its start to the previous clip's end (a cut, either way, finds its blocks
    in RAM); with no neighbour it goes to the other side of the playhead. A background thread evicts what fell out
    and loads what is missing, cheapest first, taking the files in turn. Blocks that stay inside their window are
    never re-read, so the windows slide instead of being rebuilt. ``stream`` serves HTTP range requests from the
    blocks and falls back to disk for anything outside the windows: always correct, only ever faster.
    """

    CHUNK = 1024 * 1024
    AHEAD = 0.7  # default share of a window kept in front of its playhead

    def __init__(self, budget_mb: int = 128) -> None:
        self.lock = threading.Lock()
        self.cv = threading.Condition(self.lock)
        self.budget = self._clamp(budget_mb) * 1024 * 1024
        self.ahead = self.AHEAD
        self.wins: dict[str, _Window] = {}  # path -> window, in focus order
        self.heads: list[str] = []  # the files whose playheads the windows follow (the rest: sequence neighbours)
        self.seq: tuple[str, str] = ("", "")  # (next, previous) file of the lightbox's sequence
        self.pending = 0  # blocks the loader still has to fetch
        self.focus_gen = 0  # newest applied client generation; a lower one does not move the windows
        self._weight = 1.0  # cost of a block behind a playhead, in blocks ahead (_plan)
        self._gen = 0  # bumped whenever a window moves; the loader re-plans when it changes
        self._stop = False
        self._thread = threading.Thread(target=self._loop, name="video-cache", daemon=True)
        self._thread.start()

    @staticmethod
    def _clamp(mb: int) -> int:
        return max(32, min(2048, int(mb)))

    @staticmethod
    def clamp_ahead(pct) -> float:
        """Settings' percent (50-90) as a share; anything unreadable gives the default."""
        try:
            v = float(pct)
        except (TypeError, ValueError):
            return SlidingVideoCache.AHEAD
        if not math.isfinite(v):
            return SlidingVideoCache.AHEAD
        return max(0.5, min(0.9, v / 100.0))

    @property
    def budget_mb(self) -> int:
        return max(1, self.budget // (1024 * 1024))

    @property
    def path(self) -> str:
        """The first (lightbox: the playing) file with a window, "" when none."""
        return self.heads[0] if self.heads else next(iter(self.wins), "")

    def _plan(self) -> None:
        """Block ranges of every window from the playheads, the budget, ``ahead`` and the sequence (caller holds
        the lock)."""
        n = max(1, self.budget // self.CHUNK // max(1, len(self.heads)))
        weight = self.ahead / max(1e-6, 1.0 - self.ahead)
        nxt, prv = self.seq
        for w in self.wins.values():
            w.ranges = []
        for path in self.heads:
            w = self.wins[path]
            last = w.last
            if last < 0:
                continue
            head = min(w.head, last)
            ahead = max(1, int(round(n * self.ahead)))
            behind = n - ahead
            lo, hi = head - behind, head + ahead - 1
            nw = self.wins.get(nxt) if len(self.heads) == 1 and nxt else None
            pw = self.wins.get(prv) if len(self.heads) == 1 and prv else None
            cap_n = nw.last + 1 if nw is not None else 0
            cap_p = pw.last + 1 if pw is not None else 0
            over, under = max(0, hi - last), max(0, -lo)
            take_n = min(over, cap_n)
            take_p = min(under, cap_p - take_n if pw is nw else cap_p)  # a 2-clip loop: one file for both ends
            left_o, left_u = over - take_n, under - take_p
            lo, hi = max(0, lo), min(last, hi)
            # What a neighbour cannot hold (none there, or a short one) goes to the other side of the playhead,
            # then to the neighbours' spare room.
            g = min(left_o, lo); lo -= g; left_o -= g
            g = min(left_u, last - hi); hi += g; left_u -= g
            left = left_o + left_u
            g = min(left, lo); lo -= g; left -= g
            g = min(left, last - hi); hi += g; left -= g
            g = min(left, cap_n - take_n - (take_p if pw is nw else 0)); take_n += max(0, g); left -= max(0, g)
            g = min(left, cap_p - take_p - (take_n if pw is nw else 0)); take_p += max(0, g)
            w.ranges.append((lo, hi, head, 0))
            if take_n > 0:
                nw.ranges.append((0, take_n - 1, 0, last - head + 1))
            if take_p > 0:
                pw.ranges.append((pw.last + 1 - take_p, pw.last, pw.last + 1, head))
        self._weight = weight

    def _replan(self) -> None:
        """Plan, evict everything outside the windows and wake the loader (caller holds the lock)."""
        self._plan()
        for w in self.wins.values():
            for k in [k for k in w.blocks if not w.wants(k)]:
                del w.blocks[k]
        self.pending = len(self._missing())  # set here, not by the loader, so "busy" is true from the first instant
        self._gen += 1
        self.cv.notify_all()

    def _totals(self) -> tuple[int, int, bool]:
        """(bytes held, budget MB, loader still fetching). Caller holds the lock."""
        total = sum(len(b) for w in self.wins.values() for b in w.blocks.values())
        return total, self.budget_mb, self.pending > 0

    def _spans(self, w: _Window) -> list[list[int]]:
        """Half-open byte ranges of the blocks actually in RAM, contiguous runs merged, in order.
        The planned window (``ranges``) is not included: a block counts only once it has been read."""
        if w.size <= 0 or not w.blocks:
            return []
        last = w.last
        ks = sorted(k for k in w.blocks if 0 <= k <= last)
        if not ks:
            return []
        out: list[list[int]] = []
        lo = hi = ks[0]
        for k in ks[1:]:
            if k == hi + 1:
                hi = k
                continue
            out.append([lo * self.CHUNK, min(w.size, (hi + 1) * self.CHUNK)])
            lo = hi = k
        out.append([lo * self.CHUNK, min(w.size, (hi + 1) * self.CHUNK)])
        return out

    def _one(self, w: _Window | None, total: int, mb: int, busy: bool) -> dict:
        """One file's snapshot. ``start``/``end`` stay the cached run that contains the playhead (a point,
        ``start == end``, when that block is not loaded yet) so older clients keep their meaning; ``spans``
        is every cached run."""
        if w is None:
            return {"start": 0, "end": 0, "size": 0, "bytes": total, "mb": mb, "busy": busy, "spans": []}
        spans = self._spans(w)
        start = end = 0
        if w.size > 0:
            start = end = min(w.head, (w.size - 1) // self.CHUNK) * self.CHUNK
            for a, b in spans:
                if a <= start < b:
                    start, end = a, b
                    break
        return {
            "start": start,
            "end": end,
            "size": w.size,
            "bytes": total,
            "mb": mb,
            "busy": busy,
            "spans": spans,
        }

    def snapshot(self, path: str | None = None) -> dict:
        with self.lock:
            total, mb, busy = self._totals()
            w = self.wins.get(str(path)) if path else self.wins.get(self.path)
            return self._one(w, total, mb, busy)

    def snapshots(self, paths: list[str]) -> dict[str, dict]:
        """``path -> snapshot`` for each path, one lock. A path with no window still gets an empty snapshot
        (``size`` 0, ``spans`` []), and every snapshot's ``bytes`` is the total held across all windows."""
        with self.lock:
            total, mb, busy = self._totals()
            return {str(p): self._one(self.wins.get(str(p)), total, mb, busy) for p in paths}

    def configure(self, mb: int | None = None, ahead=None) -> None:
        """Budget in MB and / or the ahead share (percent, 50-90); a change re-plans the windows at once."""
        with self.cv:
            nxt = self.budget if mb is None else self._clamp(mb) * 1024 * 1024
            share = self.ahead if ahead is None else self.clamp_ahead(ahead)
            if nxt == self.budget and abs(share - self.ahead) < 1e-9:
                return
            self.budget, self.ahead = nxt, share
            self._replan()  # shrinking evicts right away, growing starts filling the extra room

    def _claim(self, gen: int | None) -> bool:
        """Caller holds the lock. ``None`` always applies (a post with no generation). A generation
        lower than the newest applied one is a late post from a player that no longer owns the windows."""
        if gen is None:
            return True
        if gen < self.focus_gen:
            return False
        self.focus_gen = gen
        return True

    def release(self, gen: int | None = None) -> bool:
        """Drop every window (the player closed) so a 2 GB budget doesn't stay resident.
        False when ``gen`` is older than the windows' owner: they stay."""
        with self.cv:
            if not self._claim(gen):
                return False
            self.wins = {}
            self.heads = []
            self.seq = ("", "")
            self.pending = 0
            self._gen += 1
            self.cv.notify_all()
            return True

    def close(self) -> None:
        with self.cv:
            self._stop = True
            self.wins = {}
            self.heads = []
            self.cv.notify_all()

    def focus(self, path: str, pos: int, next_path: str = "", prev_path: str = "", gen: int | None = None) -> bool:
        """One playing file: move its window so byte ``pos`` (the playhead) sits inside it; ``next_path`` /
        ``prev_path``: the sequence's neighbours, which take the part of the window past the clip's end / start.
        Other files' windows go. False when ``gen`` is older than the current owner: the windows stay."""
        return self.focus_many([(path, pos)], str(next_path or ""), str(prev_path or ""), gen)

    def focus_many(self, items: list[tuple[str, int]], next_path: str = "", prev_path: str = "", gen: int | None = None) -> bool:
        """Windows for exactly these files, each with its playhead at byte ``pos``; the budget is split between
        them. A file already held keeps the blocks that stay inside its (possibly smaller) window. Neighbours are
        used with one file only (the lightbox). False when ``gen`` is older than the current owner."""
        stats = []
        for path, pos in items:
            path = str(path)
            try:
                st = os.stat(path)
            except OSError:
                continue
            stats.append((path, int(pos), (st.st_size, st.st_mtime_ns)))
        extra = []
        if len(stats) == 1:
            for p in dict.fromkeys(x for x in (next_path, prev_path) if x and x != stats[0][0]):
                try:
                    st = os.stat(p)
                except OSError:
                    continue
                extra.append((p, (st.st_size, st.st_mtime_ns)))
        with self.cv:
            if not self._claim(gen):
                return False
            wins: dict[str, _Window] = {}
            for path, stamp in [(p, s) for p, _, s in stats] + extra:
                w = wins.get(path) or self.wins.get(path)
                if w is None or w.stamp != stamp:  # new file, or the file changed underneath us
                    w = _Window(stamp[0], stamp)
                wins[path] = w
            for path, pos, _ in stats:
                wins[path].head = max(0, min(wins[path].size, pos)) // self.CHUNK
            self.wins = wins
            self.heads = list(dict.fromkeys(p for p, _, _ in stats))
            have = {p for p, _ in extra}
            self.seq = (next_path if next_path in have else "", prev_path if prev_path in have else "")
            self._replan()
            return True

    def _missing(self) -> list[tuple[str, int]]:
        """(path, block) still to load, ordered so ``pop()`` yields the cheapest first: outwards from a playhead,
        a block behind it costing ``ahead / (1 - ahead)`` ahead (see ``_plan``), the files taken in turn on a tie.
        Caller holds the lock."""
        weight = self._weight
        ranked = []
        for i, (path, w) in enumerate(self.wins.items()):
            for lo, hi, head, base in w.ranges:
                for k in range(lo, hi + 1):
                    if k in w.blocks:
                        continue
                    cost = base + (k - head) if k >= head else (base + (head - k)) * weight
                    ranked.append((cost, i, path, k))
        ranked.sort()
        seen: set[tuple[str, int]] = set()  # a block in two ranges (a 2-clip loop) is listed once, at its lowest cost
        out = []
        for _, _, path, k in ranked:
            if (path, k) not in seen:
                seen.add((path, k))
                out.append((path, k))
        return out[::-1]

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
                path, k = todo.pop()
                w = self.wins.get(path)
                if w is None or k in w.blocks:  # a range request already pulled it in
                    self.pending = len(todo)
                    continue
                self.pending = len(todo) + 1  # +1: the block being read right now
                stamp = w.stamp
            try:
                with open(path, "rb") as fh:
                    fh.seek(k * self.CHUNK)
                    data = fh.read(self.CHUNK)
            except OSError:
                data = b""
            with self.lock:
                w = self.wins.get(path)
                if data and w is not None and w.stamp == stamp and w.wants(k):
                    w.blocks[k] = data
                if self._gen == gen:  # otherwise a window moved and _replan already counted afresh
                    self.pending = len(todo)

    def stream(self, path: str, start: int, end: int):
        """Yield bytes [start, end) of ``path`` — from RAM where its window holds them, else from disk
        (keeping the block when it belongs in the window, so the loader needn't fetch it again)."""
        path = str(path)
        pos = max(0, int(start))
        fh = None
        try:
            while pos < end:
                k, off = divmod(pos, self.CHUNK)
                with self.lock:
                    w = self.wins.get(path)
                    block = w.blocks.get(k) if w is not None else None
                    wanted = w is not None and w.wants(k)
                if block is None:
                    if fh is None:
                        fh = open(path, "rb")
                    if wanted:
                        fh.seek(k * self.CHUNK)
                        block = fh.read(self.CHUNK)
                        if block:
                            with self.lock:
                                if self.wins.get(path) is w and w is not None and w.wants(k):
                                    w.blocks[k] = block
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


# ---- heavy thumbnails, rendered in worker processes -------------------------------------------
# psd_tools' compositing and MuPDF's rendering hold the GIL, so 2-4 thumbnail threads busy with PSD /
# PDF files made the whole server sluggish (1,000-file import: /api/assets median 61 ms, max 241 ms
# instead of 1 ms). Library._heavy() runs these in a small process pool. Module-level functions with
# str arguments, so they pickle into a spawned child.

def render_psd_thumb(path: str, dest: str) -> tuple[int, int] | None:
    path, dest = Path(path), Path(dest)
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


def render_pdf_thumb(path: str, dest: str) -> tuple[int, int] | None:
    path, dest = Path(path), Path(dest)
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


_HEAVY_FNS = {"psd": render_psd_thumb, "pdf": render_pdf_thumb}


def _heavy_child(conn) -> None:
    """A worker process: renders jobs sent over the pipe until the pipe closes."""
    while True:
        try:
            job = conn.recv()
        except (EOFError, OSError):
            return
        if job is None:
            return
        kind, path, dest = job
        try:
            res = _HEAVY_FNS[kind](path, dest)
        except Exception:
            res = None
        try:
            conn.send(res)
        except (OSError, ValueError):
            return


class _NoWorkers(Exception):
    """Worker processes cannot be started here: render in the thread instead."""


class _JobFailed(Exception):
    """The job timed out or its worker died: the file is skipped, never re-run in the server."""


class HeavyWorkers:
    """`n` killable worker processes (spawn context — never fork this multi-threaded server) for
    renderers that hold the GIL. Not a ProcessPoolExecutor on purpose: a running executor job cannot
    be cancelled or killed, and Python's exit hook waits for it, so one hung PSD kept the process
    alive after the window closed. Here a timed-out or crashed job kills its worker (a fresh one is
    started for the next job), workers are daemonic (killed at exit) and `close()` kills them all.
    The timeout counts from when a worker takes the job, not the wait for a free one. Workers idle
    for `idle` seconds are stopped (each holds ~100 MB of imports)."""

    def __init__(self, n: int = 2, idle: float = 60.0) -> None:
        self._slots = [{"proc": None, "conn": None, "busy": False, "last": 0.0} for _ in range(n)]
        self._free: queue.Queue = queue.Queue()
        for s in self._slots:
            self._free.put(s)
        self._lock = threading.Lock()
        self._closed = False
        self._idle = idle
        self._reaper: threading.Timer | None = None

    def _start(self, slot: dict) -> None:
        try:
            import multiprocessing

            ctx = multiprocessing.get_context("spawn")
            mine, theirs = ctx.Pipe()
            proc = ctx.Process(target=_heavy_child, args=(theirs,), daemon=True)
            proc.start()
            theirs.close()
        except Exception as e:
            raise _NoWorkers() from e
        slot["proc"], slot["conn"] = proc, mine

    @staticmethod
    def _kill(slot: dict) -> None:
        proc, conn = slot["proc"], slot["conn"]
        slot["proc"] = slot["conn"] = None
        if proc is not None:
            try:
                proc.kill()
                proc.join(2)
            except Exception:
                pass
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass

    def run(self, kind: str, path: str, dest: str, timeout: float):
        slot = self._free.get()
        try:
            with self._lock:
                if self._closed:
                    raise _JobFailed()
                slot["busy"] = True
                if slot["proc"] is None or not slot["proc"].is_alive():
                    self._kill(slot)
                    self._start(slot)
                conn = slot["conn"]
            try:
                conn.send((kind, path, dest))
                if conn.poll(timeout):
                    return conn.recv()
            except (EOFError, OSError, ValueError):
                pass  # the worker died on this file (or close() killed it)
            with self._lock:
                self._kill(slot)
            raise _JobFailed()
        finally:
            with self._lock:
                slot["busy"] = False
                slot["last"] = time.monotonic()
                self._arm_reaper()
            self._free.put(slot)

    def _arm_reaper(self, delay: float | None = None) -> None:
        if self._reaper is None and not self._closed:
            self._reaper = threading.Timer(self._idle if delay is None else delay, self._reap)
            self._reaper.daemon = True
            self._reaper.start()

    def _reap(self) -> None:
        with self._lock:
            self._reaper = None
            now, wait = time.monotonic(), None
            for s in self._slots:
                if s["proc"] is None:
                    continue
                left = self._idle if s["busy"] else self._idle - (now - s["last"])
                if left <= 0:
                    self._kill(s)
                else:
                    wait = left if wait is None else min(wait, left)
            if wait is not None:
                self._arm_reaper(wait + 0.05)

    def close(self) -> None:
        with self._lock:
            self._closed = True
            if self._reaper:
                self._reaper.cancel()
            for s in self._slots:
                self._kill(s)


class Library:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.thumbs = root / "thumbs"
        self.thumbs.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self._first_page = threading.Event()  # set by first_page_served(); gates the startup scan
        # Worker processes for PSD / PDF thumbnails (_heavy).
        self._heavy_workers = HeavyWorkers(2)
        self._heavy_off = False  # worker processes cannot start here: render in the thread
        self._heavy_failed: set[tuple[str, int]] = set()  # (path, mtime) that timed out / crashed
        self.conn = sqlite3.connect(str(root / "library.db"), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        # Unicode lower case for the filter builder (SQLite's own lower() folds ASCII only: "Фон" ≠ "фон")
        self.conn.create_function("ulower", 1, lambda s: s.lower() if isinstance(s, str) else s, deterministic=True)
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self.conn.execute("PRAGMA busy_timeout=4000")
        self.conn.execute("PRAGMA temp_store=MEMORY")
        self._migrate()
        row = self.conn.execute("SELECT value FROM meta WHERE key='scan_ignore'").fetchone()
        self.default_filter, self.default_custom = read_default_filter(root)
        self.ignore = IgnoreRules(row["value"] if row else "", self.default_filter)
        self.bus = Bus()
        # find_ffmpeg() can take ~150 ms (imageio-ffmpeg runs `ffmpeg -version`), so it runs off the
        # startup path. Readers go through ffmpeg_exe(), which waits for it.
        self.ffmpeg: str | None = None
        self._ffmpeg_searched = threading.Event()
        threading.Thread(target=self._search_ffmpeg, daemon=True).start()
        self._scan_lock = threading.Lock()
        self._usdz_lock = threading.Lock()
        self.scanning = 0
        self.scanned = 0
        self._watchers: dict[str, object] = {}
        # Bumped when a source is removed (or absorbed by a folder that contains it): a scan of it
        # still walking sees the change and stops (see scan_source).
        self._src_gen: dict[str, int] = {}
        self._scans_running: dict[str, int] = {}  # sid -> scans walking it now (under _scan_lock)
        self._stop = threading.Event()
        self._heap: list[tuple[int, int, str]] = []
        self._heap_lock = threading.Lock()
        self._seq = 0
        self._inflight: set[str] = set()
        self._have_thumb: set[str] = set()
        # thumb_version() per asset, so listing a page of 400 assets does not stat 400-800 thumbnail
        # files (that was ~80% of /api/assets time on Windows). Re-read whenever a thumbnail is
        # written, dropped by _forget_thumb() whenever one is deleted or invalidated.
        self._thumb_v: dict[str, int] = {}
        self._thumb_miss: dict[str, float] = {}  # when thumb_version last found no file
        self._info_cache: dict[str, tuple[tuple, list[dict]]] = {}
        self._wake = threading.Condition(self._heap_lock)
        try:
            import pillow_heif

            pillow_heif.register_heif_opener()
        except Exception:
            pass
        self._drop_stale_model_thumbs()
        self._untrust_dimless_thumbs()
        self._load_thumb_cache()
        self.video_cache = SlidingVideoCache()
        self._play_lock = threading.Lock()
        self._play_jobs: dict[str, dict] = {}  # asset id -> state of its playback copy (see start_play_copy)
        self._play_slot = threading.Semaphore(1)  # one playback copy at a time: it takes every core
        # Playback copies (someone waits on "Converting…") go before scrub copies: see _encode_copy.
        # Several scrub copies may encode at once (a compare of N clips); a playback copy stops all of them.
        self._play_cv = threading.Condition()
        self._play_waiting = 0  # playback copies waiting for the slot
        self._play_active = 0  # playback copies holding the slot
        self._scrub_slots = threading.Semaphore(self.SCRUB_PARALLEL)
        self._scrub_procs: set[subprocess.Popen] = set()
        self._scrub_proc: subprocess.Popen | None = None  # one of them (tests, and "is a scrub running")
        self._scrub_audio_slot = threading.Semaphore(1)  # one scrub-audio extract at a time, beside the video slot
        self._play_enc: dict[str, tuple[str, list[str], str] | None] = {}
        workers = max(2, min(4, os.cpu_count() or 2))
        for _ in range(workers):
            threading.Thread(target=self._worker, daemon=True).start()

    def _search_ffmpeg(self) -> None:
        try:
            self.ffmpeg = find_ffmpeg()
        finally:
            self._ffmpeg_searched.set()

    def ffmpeg_exe(self) -> str | None:
        """The ffmpeg to run, or None. Waits for the startup search, and searches again when that
        found none, so an ffmpeg installed while Sight runs is picked up."""
        self._ffmpeg_searched.wait(15)
        if not self.ffmpeg:
            self.ffmpeg = find_ffmpeg()
        return self.ffmpeg

    def _drop_stale_model_thumbs(self) -> None:
        """One-time cleanup when model rendering changes. FBX thumbnails made before external
        textures were resolved are black/blank, and USDZ ones (plus the .glb they were rendered
        from) predate the up-axis/texture fixes in usdz_convert — drop them so the client
        re-renders each the next time it scrolls into view."""
        stamp = f"{MODEL_THUMB_VERSION}.{USDZ_CONVERTER_VERSION}"
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
        for p in [*(self.thumbs / "usdz").glob("*.glb"), *(self.thumbs / "usdz").glob("*.anim")]:
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
            -- ShotGrid link of an asset (docs/SHOTGRID.md): the Version it syncs with (link JSON) and what
            -- this machine last saw / sent (state JSON, SightShotGrid.sync's own bookkeeping).
            CREATE TABLE IF NOT EXISTS sg_links (
              asset_id TEXT PRIMARY KEY,
              link TEXT NOT NULL,
              state TEXT NOT NULL DEFAULT '{}',
              updated_at INTEGER NOT NULL
            );
            -- 0.107+: an asset's link to a tracker's media entity (docs/ARCHITECTURE.md "Tracker adapters"), one per
            -- tracker key "<kind>:<host>". sg_links (above) is the pre-0.107 ShotGrid-only table: copied in once
            -- (_migrate_tracker_links), then left as it was (never written again; an older Sight still reads it).
            CREATE TABLE IF NOT EXISTS tracker_links (
              asset_id TEXT NOT NULL,
              tracker TEXT NOT NULL,
              link TEXT NOT NULL,
              state TEXT NOT NULL DEFAULT '{}',
              updated_at INTEGER NOT NULL,
              PRIMARY KEY (asset_id, tracker)
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
        # Smart collections (docs/PLAN-trackers.md stage 3c): `rule` holds a saved Filter ▾ tree (JSON, the client's
        # model); a ShotGrid one also names its site (host) and project.
        if "rule" not in ccols:
            self.conn.execute("ALTER TABLE collections ADD COLUMN rule TEXT")
        if "sg_site" not in ccols:
            self.conn.execute("ALTER TABLE collections ADD COLUMN sg_site TEXT")
        if "sg_project" not in ccols:
            self.conn.execute("ALTER TABLE collections ADD COLUMN sg_project INTEGER")
        # 0.107+ (stage 5b): a tracker project's smart collection is filed under its tracker key ("<kind>:<host>") and
        # project id (text: not every tracker's ids are numbers). A ShotGrid one still writes sg_site / sg_project too
        # (an older Sight reads those); rows from before 0.107 are given their key here (idempotent: only rows with
        # sg_site and no tracker yet — every launch, so a row an older Sight added meanwhile is picked up too; a row whose
        # host cannot be read stays without a key: the page keeps it out of Collections all the same).
        if "tracker" not in ccols:
            self.conn.execute("ALTER TABLE collections ADD COLUMN tracker TEXT")
        if "tracker_project" not in ccols:
            self.conn.execute("ALTER TABLE collections ADD COLUMN tracker_project TEXT")
        from .trackers import tracker_key_of_host
        for r in self.conn.execute("SELECT id, sg_site, sg_project FROM collections WHERE sg_site IS NOT NULL AND tracker IS NULL").fetchall():
            key = tracker_key_of_host("shotgrid", r["sg_site"])   # (a host as URL.host gave it: its port kept)
            if key:
                self.conn.execute("UPDATE collections SET tracker=?, tracker_project=? WHERE id=?",
                                  (key, None if r["sg_project"] is None else str(r["sg_project"]), r["id"]))
        self._migrate_tracker_links()
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
        if "asset_name" not in bicols:
            # Snapshot of the asset's name / path (see add_board_item): the asset row is deleted with its source,
            # and a board card must still say which file it was. Backfilled once from the live rows.
            self.conn.execute("ALTER TABLE board_items ADD COLUMN asset_name TEXT")
            self.conn.execute("ALTER TABLE board_items ADD COLUMN asset_path TEXT")
        # Idempotent (also repairs a crash between the ALTER and the commit): rows that still lack a snapshot whose asset exists.
        self.conn.execute(
            "UPDATE board_items SET asset_name=(SELECT name FROM assets WHERE assets.id=board_items.asset_id), "
            "asset_path=(SELECT path FROM assets WHERE assets.id=board_items.asset_id) "
            "WHERE asset_name IS NULL AND asset_id IN (SELECT id FROM assets)"
        )
        self.conn.commit()

    def _load_thumb_cache(self) -> None:
        for row in self.conn.execute("SELECT id FROM assets WHERE has_thumb=1"):
            self._mark_thumb(row["id"])

    def _untrust_dimless_thumbs(self) -> None:
        """One-time repair (marker file). Before 0.53.2 a thumbnail file found on disk was adopted
        whatever its row said — files left behind by a removed and re-added source (same path, so
        the same id) or by a file changed while Sight was closed. Such rows got has_thumb=1 with no
        width/height, so masonry drew them square, and the thumbnail could be of old content. Every
        server renderer returns a size, so a row (other than a client-rendered model) that has a
        thumbnail but no size can only come from that: untrust it, so it is rendered again (and
        sized) the next time it is on screen."""
        marker = self.thumbs / "trust_v1"
        if marker.exists():
            return
        self.execute(
            "UPDATE assets SET has_thumb=0 WHERE has_thumb=1 AND kind != 'model3d' "
            "AND (width IS NULL OR height IS NULL OR width=0 OR height=0)"
        )
        try:
            self.thumbs.mkdir(parents=True, exist_ok=True)
            marker.write_text("1", encoding="utf-8")
        except OSError:
            pass

    def _heavy(self, kind: str, path: Path, dest: Path) -> tuple[int, int] | None:
        """Renders a PSD / PDF thumbnail in a worker process (HeavyWorkers). A file that timed out
        or crashed its worker is remembered (by path + mtime) and not tried again this session —
        and never re-rendered in the server process, where the same crash would take Sight down.
        Only when worker processes cannot be started at all does it render in this thread."""
        try:
            key = (str(path), path.stat().st_mtime_ns)
        except OSError:
            return None
        if key in self._heavy_failed:
            return None
        if not self._heavy_off:
            try:
                return self._heavy_workers.run(kind, str(path), str(dest), timeout=120.0)
            except _JobFailed:
                self._heavy_failed.add(key)
                return None
            except _NoWorkers:
                self._heavy_off = True
        return _HEAVY_FNS[kind](str(path), str(dest))

    def close(self) -> None:
        self._stop.set()
        with self._wake:
            self._wake.notify_all()
        self._heavy_workers.close()
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
        out.update(self.review_counts())
        return out

    def review_counts(self) -> dict:
        """Assets per review state and with open notes — the sidebar's Review rows."""
        out = {f"review_{k}": 0 for k in (*REVIEW_STATES, "open")}
        rows = self.query(
            f"SELECT {_REVIEW_SQL} st, {_OPEN_NOTES_SQL} n FROM assets WHERE status != 'excluded' "
            "AND id IN (SELECT target_asset_id FROM annotations WHERE scope='asset' AND deleted_at IS NULL "
            "AND kind IN ('status', 'note'))"
        )
        for r in rows:
            if r["st"] in REVIEW_STATES:
                out[f"review_{r['st']}"] += 1
            if r["n"]:
                out["review_open"] += 1
        return out

    def sources(self) -> list[dict]:
        rows = [dict(r) for r in self.query("SELECT id, name, path FROM sources ORDER BY sort_order, added_at")]
        own = {r["source_id"]: r["c"] for r in self.query(
            "SELECT source_id, COUNT(*) c FROM assets WHERE status != 'excluded' GROUP BY source_id")}
        for r in rows:
            # "own": what removing it forgets; "count" adds the files of sources nested inside it.
            r["own"] = own.get(r["id"], 0)
            if self._nested_ids(r["id"]):
                clause, args = self._source_scope(r["id"])
                r["count"] = self.query(f"SELECT COUNT(*) c FROM assets WHERE status != 'excluded' AND {clause}", tuple(args))[0]["c"]
            else:
                r["count"] = r["own"]
        return rows

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
        return self._apply_ignore(text, persist_user=True)

    def set_default_filter(self, text: str | None) -> dict:
        """Write (text) or remove (None) the user's copy of initial_filtering.ini, then re-apply the
        rules exactly like set_ignore does."""
        user = self.root / FILTER_INI
        if text is not None:
            text = text.replace("\r\n", "\n")
            shipped, _ = read_default_filter(SHIPPED_FILTER.parent / "no-user-copy")
            if text == shipped:
                text = None  # same as the shipped list: no user copy, so shipped updates still reach the user
        if text is None:
            user.unlink(missing_ok=True)
        else:
            tmp = user.with_name(FILTER_INI + ".tmp")
            tmp.write_text(text, encoding="utf-8")
            os.replace(tmp, user)
        self.default_filter, self.default_custom = read_default_filter(self.root)
        return self._apply_ignore(self.ignore.text, persist_user=False)

    def _apply_ignore(self, text: str, persist_user: bool) -> dict:
        self.ignore = IgnoreRules(text, self.default_filter)
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
            if persist_user:
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
        """Adds a folder (idempotent for one already added). Sources may nest (a project folder
        added on its own while its parent is a source too): a file row belongs to the innermost
        source holding it (asset ids are path hashes, one row per file), a source's view and count
        go by path (see _source_scope), and the outer source's scan skips the inner one's root."""
        p = disk_spelling(Path(path).expanduser().resolve())
        if not p.is_dir():
            raise ValueError("Not a folder")
        sid = asset_id(str(p))
        p_n = normpath(p)
        roots: dict[str, str] = {}
        srcs = self.query("SELECT id, name, path FROM sources")
        for r in srcs:
            if r["id"] != sid and normpath(r["path"]) == p_n:  # the same folder, spelled differently
                return {"id": r["id"], "name": r["name"], "path": r["path"]}
        # Inside a source: spelled from that source's stored root down, so it is a plain string
        # prefix of the rows the outer source's walk made (its root may be stored in another
        # Unicode form than the disk's — then the moves below would miss and every file double).
        outer = [r for r in srcs if path_under(p_n, normpath(r["path"]))]
        if outer:
            best = max(outer, key=lambda r: len(normpath(r["path"])))
            base = Path(best["path"])
            p = base.joinpath(*p.parts[len(base.parts):])
            sid = asset_id(str(p))
        for r in srcs:
            roots[r["id"]] = normpath(r["path"])
        now = int(time.time() * 1000)
        with self.lock:
            next_order = self.conn.execute("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM sources").fetchone()[0]
            self.conn.execute(
                "INSERT OR IGNORE INTO sources(id, name, path, added_at, sort_order) VALUES (?,?,?,?,?)",
                (sid, p.name or str(p), str(p), now, next_order),
            )
            self.conn.execute("UPDATE sources SET name=?, path=? WHERE id=?", (p.name or str(p), str(p), sid))
            # Inside another source: the rows it already has under this folder move here (tags,
            # ratings, notes kept). Before, the new source stayed empty (its scan's inserts were
            # ignored as duplicates) and removing the outer source took these files with it.
            prefix = str(p).rstrip("\\/") + os.sep
            moved = []
            for r in self.conn.execute(
                "SELECT id, source_id, path, status FROM assets WHERE substr(path, 1, ?) = ? AND source_id != ?",
                (len(prefix), prefix, sid),
            ).fetchall():
                owner = roots.get(r["source_id"])
                if owner is None or path_under(p_n, owner):  # never take rows of a deeper source
                    moved.append(r)
            self._reassign(moved, sid, str(p))
            # A scan of an outer source still walking would go on indexing this folder under its
            # own id (it took its nested roots at the start): stop it and walk again.
            restart = [r["id"] for r in outer if self._scans_running.get(r["id"])]
            for oid in restart:
                self._src_gen[oid] = self._src_gen.get(oid, 0) + 1
            self.conn.commit()
        self._watch(sid, str(p))
        for oid in restart:
            threading.Thread(target=self.scan_source, args=(oid,), daemon=True).start()
        threading.Thread(target=self.scan_source, args=(sid,), daemon=True).start()
        self.bus.publish({"type": "source", "id": sid})
        return {"id": sid, "name": p.name or str(p), "path": str(p)}

    def _reassign(self, rows: list, sid: str, root: str) -> None:
        """Moves asset rows to source `sid` (the caller holds self.lock). Their excluded status is
        decided again by that source's own excluded folders and the ignore list."""
        if not rows:
            return
        row = self.conn.execute("SELECT excluded FROM sources WHERE id=?", (sid,)).fetchone()
        try:
            exc = {normpath(x) for x in json.loads((row[0] if row else None) or "[]")}
        except Exception:
            exc = set()
        upd = []
        for r in rows:
            p_n = normpath(r["path"])
            off = any(p_n == e or path_under(p_n, e) for e in exc) or self.hidden(root, r["path"])
            status = "excluded" if off else ("ready" if r["status"] == "excluded" else r["status"])
            upd.append((sid, status, r["id"]))
        self.conn.executemany("UPDATE assets SET source_id=?, status=? WHERE id=?", upd)

    def _source_scope(self, sid: str) -> tuple[str, list[object]]:
        """SQL for "in this source's view": its rows and those of the sources nested inside it
        (rows belong to the innermost source), minus what lies in its own excluded folders."""
        rows = self.query("SELECT path, excluded FROM sources WHERE id=?", (sid,))
        if not rows:
            return "0", []
        nested = self._nested_ids(sid)
        if not nested:
            return "source_id=?", [sid]
        ids = [sid, *nested]
        sql = [f"source_id IN ({','.join('?' * len(ids))})"]
        args: list[object] = list(ids)
        try:
            exc = [x for x in json.loads(rows[0]["excluded"] or "[]") if isinstance(x, str)]
        except Exception:
            exc = []
        for e in exc:
            ep = e.rstrip("\\/") + os.sep
            sql.append("substr(path, 1, ?) != ?")
            args.extend([len(ep), ep])
        return "(" + " AND ".join(sql) + ")", args

    def _nested(self, sid: str) -> dict[str, str]:
        """{id: normpath(root)} of the other sources lying inside source `sid`."""
        root = self.source_root(sid)
        if not root:
            return {}
        root_n = normpath(root)
        return {r["id"]: normpath(r["path"]) for r in self.query("SELECT id, path FROM sources WHERE id != ?", (sid,))
                if path_under(normpath(r["path"]), root_n)}

    def _nested_ids(self, sid: str) -> list[str]:
        return list(self._nested(sid))

    def _nested_roots(self, sid: str) -> set[str]:
        """Roots of the sources nested in `sid`: its scan leaves those folders to them."""
        return set(self._nested(sid).values())

    def rescan_source(self, sid: str) -> bool:
        """Force-rescan: same walk `resume_watchers` does at startup, on demand — for catching up
        after changes the live watcher missed (network share, external edits) or reconciling a
        move (see _reconcile_moved) without needing an app restart."""
        if not self.query("SELECT 1 FROM sources WHERE id=?", (sid,)):
            return False
        threading.Thread(target=self.scan_source, args=(sid,), daemon=True).start()
        return True

    def remove_source(self, sid: str) -> None:
        # Thumbnail files stay on disk; forgetting them here makes them orphans (see thumb_path),
        # so adding the same folder again (same paths, same ids) renders and sizes them anew.
        # Order matters: the watcher stops and a running scan is told to stop first, and the source
        # row goes in the same transaction as its assets — the scan's and the watcher's inserts
        # check that the source still exists (see scan_source / _touch_one), so nothing can add a
        # row for it afterwards (such rows showed in All forever, with no source to remove).
        # Collection membership goes too (a collection would keep counting files it cannot show);
        # board cards and annotations stay — a card keeps its name / path snapshot.
        # Files that still lie inside another source (nested sources, either way round) are not
        # dropped: they move to the innermost remaining source holding them, which is rescanned.
        self._src_gen[sid] = self._src_gen.get(sid, 0) + 1
        self._unwatch(sid)
        rescan: set[str] = set()
        with self.lock:
            src = self.conn.execute("SELECT path FROM sources WHERE id=?", (sid,)).fetchone()
            others = [(r["id"], r["path"], normpath(r["path"]))
                      for r in self.conn.execute("SELECT id, path FROM sources WHERE id != ?", (sid,))]

            def holder(p_n: str) -> tuple[str, str, str] | None:
                best = None
                for o in others:
                    if path_under(p_n, o[2]) and (best is None or len(o[2]) > len(best[2])):
                        best = o
                return best

            if src is not None:
                h = holder(normpath(src[0]))  # the outer source now walks this folder itself
                if h:
                    rescan.add(h[0])
            gone: list[str] = []
            moves: dict[str, list] = {}
            for r in self.conn.execute("SELECT id, path, status FROM assets WHERE source_id=?", (sid,)).fetchall():
                h = holder(normpath(r["path"]))
                if h:
                    moves.setdefault(h[0], []).append(r)
                else:
                    gone.append(r["id"])
            for oid, rows in moves.items():
                self._reassign(rows, oid, next(o[1] for o in others if o[0] == oid))
                rescan.add(oid)
            self.conn.execute("DELETE FROM sources WHERE id=?", (sid,))
            self.conn.executemany("DELETE FROM collection_assets WHERE asset_id=?", [(a,) for a in gone])
            self.conn.execute("DELETE FROM assets WHERE source_id=?", (sid,))
            self.conn.commit()
        for aid in gone:
            self._forget_thumb(aid)
        for oid in rescan:
            threading.Thread(target=self.scan_source, args=(oid,), daemon=True).start()
        self.bus.publish({"type": "source", "id": sid})

    def _unwatch(self, sid: str) -> None:
        w = self._watchers.pop(sid, None)
        if w is not None:
            try:
                w.stop()  # type: ignore[attr-defined]
            except Exception:
                pass

    def _migrate_asset(self, old_id: str, new_id: str) -> None:
        """A file was moved/renamed: `old_id` (now missing) and `new_id` (a fresh 'ready' row at
        the new path) are the same file, matched by _reconcile_moved. Carries the old row's tags/
        rating/note/added_at and, if the cached thumbnail can be moved to the new id, its cached
        derivatives too (so a move doesn't cost a re-thumbnail) and its lightbox annotations — then
        drops the old row."""
        old_rows = self.query("SELECT * FROM assets WHERE id=?", (old_id,))
        if not old_rows:
            return
        old = old_rows[0]
        moved_thumb = False
        # Only a known thumbnail moves with the file; an orphan one (see thumb_path) stays behind.
        trusted = bool(old["has_thumb"]) or old_id in self._have_thumb
        for ext in (".jpg", ".png"):
            src = self.thumbs / f"{old_id}{ext}"
            if trusted and src.exists():
                try:
                    src.replace(self.thumbs / f"{new_id}{ext}")
                    moved_thumb = True
                except OSError:
                    pass
        for sub, old_name, new_name in (
            ("wave", f"{old_id}.json", f"{new_id}.json"),
            ("usdz", f"{old_id}.glb", f"{new_id}.glb"),
            ("usdz", f"{old_id}.anim", f"{new_id}.anim"),
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
        for src in (self.thumbs / "video").glob(f"{old_id}_*"):
            try:
                src.replace(self.thumbs / "video" / (new_id + src.name[len(old_id):]))
            except OSError:
                pass
        for src in (self.thumbs / "nprev").glob(f"{old_id}_*"):
            try:
                src.replace(self.thumbs / "nprev" / (new_id + src.name[len(old_id):]))
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
        # Board cards follow the file too (and their name / path snapshot with it).
        new_rows = self.query("SELECT name, path FROM assets WHERE id=?", (new_id,))
        if new_rows:
            self.execute(
                "UPDATE board_items SET asset_id=?, asset_name=?, asset_path=?, updated_at=?, revision=revision+1 "
                "WHERE asset_id=?",
                (new_id, new_rows[0]["name"], new_rows[0]["path"], int(time.time() * 1000), old_id),
            )
        # Lightbox annotations / review notes belong to the file, not to its old path.
        self.execute(
            "UPDATE annotations SET target_asset_id=? WHERE scope='asset' AND target_asset_id=?",
            (new_id, old_id),
        )
        self.execute("DELETE FROM assets WHERE id=?", (old_id,))
        self._forget_thumb(old_id)
        if moved_thumb:
            self._mark_thumb(new_id)

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
        review: str = "",
        cond: object = None,
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
        clause, args = self._clause(q, kind, source_id, tag, True, collection_id, folder, review, cond)  # (a bad filter fails first)
        moved = self._reconcile_moved()
        usable = {r["id"]: Path(r["path"]).is_dir() for r in self.query("SELECT id, path FROM sources")}
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
            self._forget_thumb(aid)
            for p in (
                self.thumbs / f"{aid}.jpg", self.thumbs / f"{aid}.png",
                self.thumbs / "wave" / f"{aid}.json", self.thumbs / "usdz" / f"{aid}.glb", self.thumbs / "usdz" / f"{aid}.anim",
                *(self.thumbs / "psd").glob(f"{aid}_*.png"),
                *(self.thumbs / "video").glob(f"{aid}_*"),
                *(self.thumbs / "nprev").glob(f"{aid}_*"),
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
        # Registered as running BEFORE the generation and the nested roots are read: an add_source
        # inside this folder either sees it running (and bumps the generation) or commits its
        # source before the nested-roots query below.
        with self._scan_lock:
            self.scanning += 1
            self._scans_running[sid] = self._scans_running.get(sid, 0) + 1
        gen = self._src_gen.get(sid, 0)
        # A source nested inside this one indexes its own folder; walking it here as well would
        # only collide with its rows (one row per file).
        excluded_n = self.excluded_set(sid) | self._nested_roots(sid)
        self.bus.publish({"type": "scan", "scanning": True, "scanned": self.scanned})
        # Excluded assets are left out of the diff entirely — os.walk never visits their dirs
        # (see the dirnames filter below), so if they stayed in `existing` they'd look "gone"
        # and get flipped to status='missing', clobbering the exclusion on every rescan.
        existing = {
            r["path"]: (r["mtime"], r["size"], r["id"])
            for r in self.query("SELECT id, path, mtime, size, status FROM assets WHERE source_id=?", (sid,))
            if r["status"] != "excluded"
            and not any(path_under(normpath(r["path"]), e) for e in excluded_n)
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
            # Checked under the lock that add_source / remove_source hold while they bump the
            # generation: removed, or a source added inside it meanwhile -> a fresh walk follows.
            # And only while the source exists: nothing more may land under a removed id.
            with self.lock:
                if cancelled():
                    inserts = []
                    return
                self.conn.executemany(
                    """
                    INSERT OR IGNORE INTO assets(
                      id, source_id, path, name, ext, kind, size, mtime, status, has_thumb, added_at
                    ) SELECT ?,?,?,?,?,?,?,?,'ready',0,? WHERE EXISTS (SELECT 1 FROM sources WHERE id=?)
                    """,
                    [t + (sid,) for t in inserts],
                )
                self.conn.commit()
            n = len(inserts)
            self.scanned += n
            inserts = []
            now = int(time.time() * 1000)
            self.bus.publish({"type": "batch", "n": n, "scanned": self.scanned, "source": sid})

        def cancelled() -> bool:
            return self._stop.is_set() or self._src_gen.get(sid, 0) != gen

        try:
            for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
                if cancelled():
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
                        self._forget_thumb(prev[2])
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
            if cancelled():
                # Removed / absorbed (or Sight is closing): the walk is partial, so the files it did
                # not reach are not gone — the old code flagged them all 'missing' on shutdown.
                return
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
                left = self._scans_running.get(sid, 0) - 1
                if left > 0:
                    self._scans_running[sid] = left
                else:
                    self._scans_running.pop(sid, None)
                scanning = self.scanning > 0
            self.bus.publish({"type": "scan", "scanning": scanning, "scanned": self.scanned})

    def prioritize(self, ids: list[str], priority: int = PRI_VISIBLE) -> None:
        if not ids:
            return
        with self._wake:
            for aid in ids:
                if aid in self._have_thumb and self._thumb_v.get(aid) == 0:
                    # has_thumb=1 but thumb_version found no file (deleted by hand, a cleaner):
                    # make it again instead of skipping it forever; or the file is there after all.
                    if self.thumb_file(aid):
                        self._thumb_v.pop(aid, None)
                    else:
                        self._forget_thumb(aid)
                if aid in self._have_thumb or aid in self._inflight:
                    continue
                # A file on disk whose row does not say has_thumb is not adopted here (that left
                # the client waiting for a "thumb" event that never came, and the row without a
                # size): the worker renders it again — see _make_thumb.
                self._seq += 1
                heapq.heappush(self._heap, (priority, self._seq, aid))
            self._wake.notify_all()

    def thumb_path(self, aid: str) -> Path | None:
        """The asset's thumbnail, only if it is a known one (has_thumb=1 at startup, or written /
        moved here this session). A file the row does not know about is an orphan — left by a
        removed source whose folder was added again (ids are path hashes), or by a file changed
        while Sight was closed — and may show old content with no size in the row: it is not
        served or adopted, the worker renders it again."""
        return self.thumb_file(aid) if aid in self._have_thumb else None

    def thumb_file(self, aid: str) -> Path | None:
        """The thumbnail file on disk, trusted or not."""
        for ext in (".jpg", ".png"):
            p = self.thumbs / f"{aid}{ext}"
            if p.exists():
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
        if kind == "model3d":
            return  # rendered and uploaded by the client (save_uploaded_thumb), never here
        orphan_left = False
        for e in (".jpg", ".png"):  # an orphan (see thumb_path): never mistaken for the new render
            try:
                (self.thumbs / f"{aid}{e}").unlink(missing_ok=True)
            except OSError:
                orphan_left = True  # held open (Windows): the render below overwrites it where it can
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
        # With an orphan still on disk, a file there proves nothing: only a render that returned
        # a size (every server renderer does on success) counts.
        thumb_ok = self.thumb_file(aid) is not None and (bool(wh) or not orphan_left)
        if thumb_ok:
            # Marked before the row is updated, and forgotten again if the row is gone: a
            # remove_source() during the render must not leave the id trusted in memory (a re-added
            # folder would then list it as thumbnailed with no size).
            self._mark_thumb(aid)
            if wh:
                cur = self.execute(
                    "UPDATE assets SET has_thumb=1, width=?, height=? WHERE id=?",
                    (wh[0], wh[1], aid),
                )
            else:
                cur = self.execute("UPDATE assets SET has_thumb=1 WHERE id=?", (aid,))
            if cur.rowcount == 0:
                self._forget_thumb(aid)
                return
        # Publish even when the thumbnail itself failed, as long as we learned the animated
        # flag — otherwise a client that already fetched the asset list never finds out.
        if thumb_ok or animated is not None:
            ev = {
                "type": "thumb", "id": aid, "hasThumb": thumb_ok, "animated": animated,
                "v": self.thumb_version(aid, fresh=True),
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
        self._mark_thumb(aid)
        self.execute("UPDATE assets SET has_thumb=1 WHERE id=?", (aid,))
        self.bus.publish({
            "type": "thumb", "id": aid, "hasThumb": True, "animated": None,
            "v": self.thumb_version(aid, fresh=True),
        })
        return True

    def thumb_version(self, aid: str, fresh: bool = False) -> int:
        """Changes whenever the cached thumbnail is rewritten. The client puts it in the thumb URL
        (?v=), which the server serves as immutable — without it a regenerated thumbnail would
        keep being shown from the browser cache. Cached in memory; `fresh` re-reads the file, which
        every code path that writes a thumbnail must ask for."""
        if not fresh:
            v = self._thumb_v.get(aid)
            # A cached "no file" is re-checked after 30 s: a listing that stat'ed just before a
            # write could otherwise store its 0 after the writer's fresh=True, for good.
            if v or (v == 0 and time.monotonic() - self._thumb_miss.get(aid, 0.0) < 30.0):
                return v
        v = 0
        for ext in (".jpg", ".png"):
            try:
                v = (self.thumbs / f"{aid}{ext}").stat().st_mtime_ns // 1_000_000
                break
            except OSError:
                continue
        # 0 (no file — e.g. has_thumb=1 rows whose file was deleted) is cached too, so listing
        # them does not stat two files per row each time; _mark_thumb() drops it when one appears.
        self._thumb_v[aid] = v
        if not v:
            self._thumb_miss[aid] = time.monotonic()
        return v

    def _mark_thumb(self, aid: str) -> None:
        """The asset has a thumbnail file (found or just written)."""
        self._have_thumb.add(aid)
        if self._thumb_v.get(aid) == 0:
            self._thumb_v.pop(aid, None)

    def _forget_thumb(self, aid: str) -> None:
        """The asset's thumbnail is gone or stale: drop what is known about it in memory."""
        self._have_thumb.discard(aid)
        self._thumb_v.pop(aid, None)

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
            self._forget_thumb(aid)
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
        if not self.ffmpeg_exe():
            return None
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(".tmp.jpg")
        cmd = [
            self.ffmpeg, "-hide_banner", "-loglevel", "error",
            "-y", "-ss", "0.8", "-i", str(path),
            "-frames:v", "1", "-vf", f"scale={THUMB_SIZE}:-2", "-q:v", "5", str(tmp),
        ]
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=20, creationflags=NO_WINDOW)
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
        return self._heavy("psd", path, dest)

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
        # The card thumbnail, made the worker's way (marks it, stores the size, publishes the
        # "thumb" event the grid waits for); not while a worker is rendering the same one.
        with self._wake:
            busy = aid in self._inflight
            if not busy:
                self._inflight.add(aid)
        if not busy:
            try:
                self._make_thumb(aid)
            finally:
                with self._wake:
                    self._inflight.discard(aid)
        return self.thumb_path(aid)

    def _thumb_pdf(self, path: Path, dest: Path) -> tuple[int, int] | None:
        return self._heavy("pdf", path, dest)

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

    # ---- playback copies: video the browser cannot decode -------------------------------------------
    # A browser plays a few codecs only. Old MPEG-1/2 program streams (.mpg / .mpeg / .vob), MPEG-4
    # Part 2 (DivX / Xvid), MS-MPEG4, WMV, FLV, H.263, Cinepak, MJPEG, DV ... give no picture there.
    # For those, ffmpeg (which decodes all of them) converts a copy to H.264 in MP4 (WebM VP9 when
    # this ffmpeg has no x264), and /api/file serves the copy from then on. The copy is named
    # "<aid>_<size>_<mtime_ns><ext>": a changed source makes it stale without any bookkeeping.

    PLAY_EXT = (".mp4", ".webm")
    PLAY_VF = "yadif=deint=interlaced,scale=trunc(iw/2)*2:trunc(ih/2)*2"  # DVD / camcorder fields; even size

    @staticmethod
    def _play_stamp(path: str) -> str | None:
        try:
            st = os.stat(path)
        except OSError:
            return None
        return f"{st.st_size}_{st.st_mtime_ns}"

    # Scrub copies: a clip with a long GOP (a keyframe every few seconds) seeks slowly in the browser,
    # since every seek decodes from the keyframe before it — ~0.9 ms a frame for 416x960 H.264, so
    # ~230 ms just before the next keyframe of a 250-frame GOP. The lightbox asks for this small copy
    # (≤ 960 px, no audio, a keyframe every 4 frames, no B-frames) once a seek of the clip is slow,
    # and the compare view asks for one per clip as soon as it opens. Shown over the picture while a
    # drag scrubs; the player itself keeps the original.
    # Named "<aid>_<stamp>.scrub<ext>" next to the playback copies, so the rename / delete / stale
    # cleanups of "<aid>_*" cover it too.
    SCRUB_TAG = ".scrub"
    SCRUB_VF = "scale=w='min(960,iw)':h='min(960,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2"
    SCRUB_ENC = {
        "mp4": ["-c:v", "libx264", "-preset", "veryfast", "-tune", "fastdecode", "-crf", "26", "-g", "4",
                "-bf", "0", "-pix_fmt", "yuv420p", "-threads", "2", "-movflags", "+faststart"],
        "webm": ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "40", "-deadline", "realtime", "-cpu-used", "8",
                 "-g", "4", "-pix_fmt", "yuv420p", "-threads", "2"],
    }
    SCRUB_PARALLEL = 3  # scrub encodes at once (a compare asks for every clip together)

    def _play_copy(self, aid: str, stamp: str | None, tag: str = "") -> Path | None:
        if not stamp:
            return None
        for ext in self.PLAY_EXT:
            p = self.thumbs / "video" / f"{aid}_{stamp}{tag}{ext}"
            if p.exists():
                return p
        return None

    SCRUB_KEEP_BYTES = 1 << 30  # scrub copies kept in all (newest first); the one just made always stays
    SCRUB_KEEP_FILES = 20

    def _prune_scrub_copies(self, keep: Path) -> None:
        """Deletes the oldest scrub copies beyond SCRUB_KEEP_FILES / SCRUB_KEEP_BYTES, never ``keep``.
        They are made again on demand (the next slow scrub of that clip)."""
        found = []
        for p in (self.thumbs / "video").glob(f"*{self.SCRUB_TAG}.*"):
            if p.suffix not in self.PLAY_EXT:
                continue  # a .part / .log of a running job
            try:
                st = p.stat()
            except OSError:
                continue
            found.append((p == keep, st.st_mtime, st.st_size, p))
        found.sort(key=lambda f: (f[0], f[1]), reverse=True)  # the new copy, then newest first
        total = 0
        for n, (is_keep, _mtime, size, p) in enumerate(found):
            total += size
            if not is_keep and (n >= self.SCRUB_KEEP_FILES or total > self.SCRUB_KEEP_BYTES):
                try:
                    p.unlink(missing_ok=True)
                except OSError:
                    pass

    def scrub_copy_path(self, aid: str) -> Path | None:
        """Asset ``aid``'s current scrub copy, or None."""
        a = self.get_asset(aid)
        if not a or a.get("kind") != "video":
            return None
        return self._play_copy(aid, self._play_stamp(a["path"]), self.SCRUB_TAG)

    def playback_path(self, a: dict) -> str:
        """The file the player reads for asset ``a``: its current playback copy when there is one."""
        if a.get("kind") != "video":
            return a["path"]
        copy = self._play_copy(a["id"], self._play_stamp(a["path"]))
        return str(copy) if copy else a["path"]

    def _play_encoder(self, ffmpeg: str) -> tuple[str, list[str], str] | None:
        """(extension, encoder arguments, container) for the copy, or None when this ffmpeg can make
        neither an H.264 nor a VP9 + Opus file."""
        if ffmpeg in self._play_enc:
            return self._play_enc[ffmpeg]
        try:
            listing = subprocess.run(
                [ffmpeg, "-hide_banner", "-encoders"], capture_output=True, text=True, timeout=20,
                creationflags=NO_WINDOW,
            ).stdout
        except Exception:
            listing = ""
        found = None
        if " libx264 " in listing:
            found = (".mp4", ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
                              "-g", "48", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"], "mp4")
        elif " libvpx-vp9 " in listing and " libopus " in listing:
            found = (".webm", ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "34", "-deadline", "realtime",
                               "-cpu-used", "6", "-pix_fmt", "yuv420p", "-g", "48", "-c:a", "libopus",
                               "-b:a", "128k"], "webm")
        self._play_enc[ffmpeg] = found
        return found

    def _copy_encoder(self, ffmpeg: str, tag: str = "") -> tuple[str, list[str], str] | None:
        """_play_encoder's choice; for a scrub copy (``tag``) the same container with the scrub settings."""
        enc = self._play_encoder(ffmpeg)
        if enc and tag == self.SCRUB_TAG:
            enc = (enc[0], ["-an", "-vf", self.SCRUB_VF, *self.SCRUB_ENC[enc[2]]], enc[2])
        return enc

    def playback_status(self, aid: str, tag: str = "") -> dict:
        """{state, progress, error} of asset ``aid``'s playback copy (``tag`` SCRUB_TAG: its scrub
        copy): ready / working / failed / none."""
        a = self.get_asset(aid)
        if not a or a.get("kind") != "video" or not Path(a["path"]).exists():
            return {"state": "missing", "progress": 0, "error": "not a video in the library"}
        stamp = self._play_stamp(a["path"])
        if self._play_copy(aid, stamp, tag):
            return {"state": "ready", "progress": 1, "error": ""}
        with self._play_lock:
            job = self._play_jobs.get(aid + tag)
            if job and job["stamp"] == stamp:
                return {"state": job["state"], "progress": job["progress"], "error": job["error"]}
        return {"state": "none", "progress": 0, "error": ""}

    def scrub_status(self, aid: str) -> dict:
        return self.playback_status(aid, self.SCRUB_TAG)

    def start_scrub_copy(self, aid: str) -> dict:
        return self.start_playback_copy(aid, self.SCRUB_TAG)

    # Scrub audio: the picture scrub seeks the <video>, and a play() blip at each position waits on that
    # seek, so the sound stutters. This is a separate mono s16le PCM of the first audio track (no video
    # decode), named "<aid>_<stamp>.scruba.pcm" next to the scrub copy. The lightbox plays slices from it
    # with Web Audio, so a drag does not seek the player for sound. The name contains ".scruba.", which
    # playback-copy cleanup treats as its own kind (not a playback file). Rename / delete of "<aid>_*" cover them.
    SCRUB_AUDIO_SR = 22050
    SCRUB_AUDIO_TAG = ".scruba"
    SCRUB_AUDIO_KEEP_FILES = 20
    SCRUB_AUDIO_KEEP_BYTES = 1 << 30

    @classmethod
    def _video_cache_kind(cls, name: str) -> str:
        """Which cache a file in thumbs/video is: 'audio' (.scruba), 'scrub' (.scrub.) or 'play'."""
        if (cls.SCRUB_AUDIO_TAG + ".") in name:
            return "audio"
        if (cls.SCRUB_TAG + ".") in name:
            return "scrub"
        return "play"

    @staticmethod
    def _scrub_audio_banner(text: str) -> str:
        """'audio' / 'silent' when ffmpeg listed the file, 'failed' when it did not (missing, locked, junk)."""
        if "Input #" not in text:
            return "failed"
        return "silent" if "Audio:" not in text else "audio"

    def _scrub_audio_file(self, aid: str, stamp: str | None) -> Path | None:
        if not stamp:
            return None
        return self.thumbs / "video" / f"{aid}_{stamp}{self.SCRUB_AUDIO_TAG}.pcm"

    def scrub_audio_path(self, aid: str) -> Path | None:
        """Asset ``aid``'s current scrub-audio PCM, or None."""
        a = self.get_asset(aid)
        if not a or a.get("kind") != "video":
            return None
        p = self._scrub_audio_file(aid, self._play_stamp(a["path"]))
        try:
            if p and p.stat().st_size >= 2:
                return p
        except OSError:
            return None
        return None

    def _scrub_audio_view(self, state: str, *, progress: float = 0, error: str = "",
                          samples: int = 0, rev: str = "") -> dict:
        sr = self.SCRUB_AUDIO_SR
        return {
            "state": state, "progress": progress, "error": error, "sr": sr,
            "samples": samples, "duration": (samples / sr) if samples else 0, "rev": rev,
        }

    def scrub_audio_status(self, aid: str) -> dict:
        """{state, progress, error, sr, samples, duration, rev} of asset ``aid``'s scrub audio.
        state is ready / working / silent (no audio track) / failed / missing / none (not started)."""
        a = self.get_asset(aid)
        if not a or a.get("kind") != "video" or not Path(a["path"]).exists():
            return self._scrub_audio_view("missing")
        stamp = self._play_stamp(a["path"]) or ""
        p = self._scrub_audio_file(aid, stamp)
        try:
            size = p.stat().st_size if p else 0
        except OSError:
            size = 0
        if p and size >= 2:
            return self._scrub_audio_view("ready", progress=1, samples=size // 2, rev=stamp)
        with self._play_lock:
            job = self._play_jobs.get(aid + self.SCRUB_AUDIO_TAG)
            if job and job["stamp"] == stamp:
                return self._scrub_audio_view(
                    job["state"], progress=job["progress"], error=job["error"],
                    samples=job.get("samples") or 0, rev=stamp,
                )
        return self._scrub_audio_view("none")

    def start_scrub_audio(self, aid: str) -> dict:
        """Starts extracting asset ``aid``'s scrub audio unless it is current, running, or already known
        silent. A failed attempt is tried again when asked."""
        a = self.get_asset(aid)
        if not a or a.get("kind") != "video" or not Path(a["path"]).exists():
            return self._scrub_audio_view("missing")
        stamp = self._play_stamp(a["path"]) or ""
        p = self._scrub_audio_file(aid, stamp)
        try:
            size = p.stat().st_size if p else 0
        except OSError:
            size = 0
        if p and size >= 2:
            return self._scrub_audio_view("ready", progress=1, samples=size // 2, rev=stamp)
        ffmpeg = self.ffmpeg_exe()
        key = aid + self.SCRUB_AUDIO_TAG
        with self._play_lock:
            job = self._play_jobs.get(key)
            if job and job["stamp"] == stamp and job["state"] in ("working", "silent"):
                return self._scrub_audio_view(
                    job["state"], progress=job["progress"], error=job["error"],
                    samples=job.get("samples") or 0, rev=stamp,
                )
            if not ffmpeg:
                self._play_jobs[key] = {
                    "stamp": stamp, "state": "failed", "progress": 0, "error": "ffmpeg not found", "samples": 0,
                }
                return self._scrub_audio_view("failed", error="ffmpeg not found", rev=stamp)
            job = {"stamp": stamp, "state": "working", "progress": 0.0, "error": "", "samples": 0}
            self._play_jobs[key] = job
        threading.Thread(
            target=self._run_scrub_audio, args=(aid, a["path"], stamp, ffmpeg, job),
            name=f"scrub-audio-{aid}", daemon=True,
        ).start()
        return self._scrub_audio_view("working", rev=stamp)

    def _prune_scrub_audio(self, keep: Path) -> None:
        """Deletes the oldest scrub-audio files beyond SCRUB_AUDIO_KEEP_FILES / _BYTES, never ``keep``."""
        found = []
        for p in (self.thumbs / "video").glob(f"*{self.SCRUB_AUDIO_TAG}.pcm"):
            try:
                st = p.stat()
            except OSError:
                continue
            found.append((p == keep, st.st_mtime, st.st_size, p))
        found.sort(key=lambda f: (f[0], f[1]), reverse=True)
        total = 0
        for n, (is_keep, _mtime, size, p) in enumerate(found):
            total += size
            if not is_keep and (n >= self.SCRUB_AUDIO_KEEP_FILES or total > self.SCRUB_AUDIO_KEEP_BYTES):
                try:
                    p.unlink(missing_ok=True)
                except OSError:
                    pass

    def _run_scrub_audio(self, aid: str, src: str, stamp: str, ffmpeg: str, job: dict) -> None:
        state, error, samples = "failed", "", 0
        d = self.thumbs / "video"
        d.mkdir(parents=True, exist_ok=True)
        final = d / f"{aid}_{stamp}{self.SCRUB_AUDIO_TAG}.pcm"
        tmp = d / f"{aid}_{stamp}{self.SCRUB_AUDIO_TAG}.part"
        try:
            heard = self._scrub_audio_banner(_ffprobe_text(ffmpeg, Path(src)))
            if heard == "failed":
                error = "could not read the file"
            elif heard == "silent":
                state = "silent"
            else:
                cmd = [
                    ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                    "-i", src, "-vn", "-map", "0:a:0", "-ac", "1", "-ar", str(self.SCRUB_AUDIO_SR),
                    "-f", "s16le", str(tmp),
                ]
                with self._scrub_audio_slot:
                    proc = subprocess.run(
                        cmd, capture_output=True, timeout=900, creationflags=NO_WINDOW,
                    )
                err = proc.stderr.decode("utf-8", "replace")
                size = tmp.stat().st_size if tmp.exists() else 0
                if proc.returncode == 0 and size >= 2:
                    for old in d.glob(f"{aid}_*{self.SCRUB_AUDIO_TAG}.pcm"):
                        if old != final:
                            try:
                                old.unlink(missing_ok=True)
                            except OSError:
                                pass
                    tmp.replace(final)
                    self._prune_scrub_audio(final)
                    samples = final.stat().st_size // 2
                    state = "ready"
                elif "matches no streams" in err or "Stream map" in err or "does not contain any stream" in err:
                    state = "silent"
                else:
                    lines = [ln for ln in err.splitlines() if ln.strip()]
                    error = lines[-1][:300] if lines else f"ffmpeg exited with code {proc.returncode}"
        except Exception as e:
            error = str(e)[:300] or type(e).__name__
        finally:
            tmp.unlink(missing_ok=True)
            with self._play_lock:
                job["state"] = state
                job["progress"] = 1.0 if state in ("ready", "silent") else job["progress"]
                job["error"] = error
                job["samples"] = samples
                # A ready file answers from disk; a silent job stays, so the next ask does not probe again
                # until the source's stamp changes. A failure stays too and is replaced when asked again
                # (start_scrub_audio only keeps working / silent).
                if state == "ready" and self._play_jobs.get(aid + self.SCRUB_AUDIO_TAG) is job:
                    del self._play_jobs[aid + self.SCRUB_AUDIO_TAG]

    def start_playback_copy(self, aid: str, tag: str = "") -> dict:
        """Starts converting asset ``aid`` for playback (``tag`` SCRUB_TAG: its scrub copy) unless the
        copy is current or running. A failed attempt is tried again when asked; the caller polls
        playback_status for the outcome."""
        a = self.get_asset(aid)
        if not a or a.get("kind") != "video" or not Path(a["path"]).exists():
            return {"state": "missing", "progress": 0, "error": "not a video in the library"}
        stamp = self._play_stamp(a["path"])
        if self._play_copy(aid, stamp, tag):
            return {"state": "ready", "progress": 1, "error": ""}
        key = aid + tag
        with self._play_lock:
            job = self._play_jobs.get(key)
            if job and job["stamp"] == stamp and job["state"] == "working":
                return {"state": "working", "progress": job["progress"], "error": ""}
        ffmpeg = self.ffmpeg_exe()
        enc = self._copy_encoder(ffmpeg, tag) if ffmpeg else None
        if not enc:
            why = "ffmpeg not found" if not ffmpeg else "ffmpeg has no H.264 or VP9 encoder"
            with self._play_lock:
                self._play_jobs[key] = {"stamp": stamp, "state": "failed", "progress": 0, "error": why}
            return {"state": "failed", "progress": 0, "error": why}
        job = {"stamp": stamp, "state": "working", "progress": 0.0, "error": ""}
        with self._play_lock:
            self._play_jobs[key] = job
        threading.Thread(
            target=self._run_playback_copy,
            args=(aid, a["path"], stamp, ffmpeg, enc, float(a.get("duration") or 0), job, tag),
            name=f"play-copy-{key}", daemon=True,
        ).start()
        return {"state": "working", "progress": 0, "error": ""}

    def _run_playback_copy(self, aid: str, src: str, stamp: str, ffmpeg: str,
                           enc: tuple[str, list[str], str], duration: float, job: dict, tag: str = "") -> None:
        ext, enc_args, container = enc
        d = self.thumbs / "video"
        d.mkdir(parents=True, exist_ok=True)
        stem = f"{aid}_{stamp}{tag}"
        tmp = d / f"{stem}.part"  # no media extension, so no lookup ever picks it up
        log = d / f"{stem}.log"
        # A scrub copy's enc_args carry their own -an / -vf (start_playback_copy).
        # -threads before -i caps the decoder; -filter_threads caps scale. The encoder's own
        # -threads (SCRUB_ENC) does not cover either, and three compares would otherwise take every core.
        streams = ["-map", "0:v:0"] if tag else ["-map", "0:v:0", "-map", "0:a:0?", "-vf", self.PLAY_VF]
        scrub_in = ["-threads", "2", "-filter_threads", "2"] if tag else []
        cmd = [
            ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y", *scrub_in, "-i", src,
            *streams, *enc_args, *([] if tag else ["-ac", "2"]),
            "-progress", "pipe:1", "-nostats", "-f", container, str(tmp),
        ]
        state, error = "failed", ""
        try:
            if duration <= 0:  # not in the library yet: the banner gives it, for the progress figure
                m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", _ffprobe_text(ffmpeg, Path(src)))
                if m:
                    duration = int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])
            rc = None
            while rc is None:  # a scrub encode stopped for a playback copy starts over after it
                rc = self._encode_copy(cmd, log, duration, job, bool(tag))
            if rc == 0 and tmp.exists() and tmp.stat().st_size > 0:
                final = d / f"{stem}{ext}"
                for old in d.glob(f"{aid}_*"):  # earlier copies of this file, of this kind only
                    # playback, scrub-video and scrub-audio are three kinds; a locked file must not fail the job
                    if self._video_cache_kind(old.name) != ("scrub" if tag else "play"):
                        continue
                    if old.name in (final.name, log.name, tmp.name):
                        continue
                    try:
                        old.unlink(missing_ok=True)
                    except OSError:
                        pass
                tmp.replace(final)
                if tag:
                    self._prune_scrub_copies(final)
                state = "ready"
            else:
                lines = [ln for ln in log.read_text(encoding="utf-8", errors="replace").splitlines() if ln.strip()]
                error = lines[-1][:300] if lines else f"ffmpeg exited with code {rc}"
        except Exception as e:  # ffmpeg vanished, disk full, ...
            error = str(e)[:300] or type(e).__name__
        finally:
            tmp.unlink(missing_ok=True)
            log.unlink(missing_ok=True)
            with self._play_lock:
                job["state"] = state
                job["progress"] = 1.0 if state == "ready" else job["progress"]
                job["error"] = error
                if state == "ready" and self._play_jobs.get(aid + tag) is job:
                    del self._play_jobs[aid + tag]  # the copy itself answers from now on

    def _stop_scrub_procs(self) -> None:
        """Caller holds ``_play_cv``. Stops every running scrub encode; each returns None and starts over."""
        for proc in list(self._scrub_procs):
            proc.sight_stopped = True
            try:
                proc.terminate()
            except OSError:
                pass

    def _encode_copy(self, cmd: list[str], log: Path, duration: float, job: dict, scrub: bool) -> int | None:
        """Runs one copy's ffmpeg and returns its exit code. Up to ``SCRUB_PARALLEL`` scrub encodes run
        at once. A playback copy is alone: while one waits or runs, scrub jobs hold back, and its arrival
        stops every running scrub encode. A stopped scrub returns None; the caller runs it again once
        playback is done, so a playback copy never waits out a long scrub encode."""
        counted = False
        held = False
        active = False
        with self._play_cv:
            if scrub:
                while self._play_waiting or self._play_active:
                    self._play_cv.wait()
            else:
                self._play_waiting += 1
                counted = True
                self._stop_scrub_procs()
        try:
            if scrub:
                self._scrub_slots.acquire()
                held = True
                with self._play_cv:
                    if self._play_waiting or self._play_active:
                        return None  # a playback copy arrived while this scrub job waited for a slot
            with self._play_slot if not scrub else nullcontext():
                with self._play_cv:
                    if scrub:
                        if self._play_waiting or self._play_active:
                            return None
                    else:
                        if counted:
                            self._play_waiting -= 1
                            counted = False
                        self._play_active += 1
                        active = True
                        self._play_cv.notify_all()
                # stderr goes to a file: a damaged stream can print more than a pipe buffer holds, and
                # nothing reads the pipe while the progress lines are read.
                try:
                    with open(log, "w", encoding="utf-8", errors="replace") as errf:
                        proc = subprocess.Popen(
                            cmd, stdout=subprocess.PIPE, stderr=errf, text=True, encoding="utf-8",
                            errors="replace", creationflags=NO_WINDOW,
                        )
                        if scrub:
                            with self._play_cv:
                                self._scrub_procs.add(proc)
                                self._scrub_proc = proc
                                if self._play_waiting or self._play_active:  # arrived between the check and here
                                    proc.sight_stopped = True
                                    try:
                                        proc.terminate()
                                    except OSError:  # died on its own already
                                        pass
                        try:
                            for line in proc.stdout:
                                if line.startswith("out_time_us=") and duration > 0:
                                    try:
                                        done = int(line.split("=", 1)[1]) / 1e6 / duration
                                    except ValueError:
                                        continue
                                    with self._play_lock:
                                        job["progress"] = round(min(0.99, max(0.0, done)), 3)
                            proc.stdout.close()
                            rc = proc.wait()
                        finally:
                            if scrub:
                                with self._play_cv:
                                    self._scrub_procs.discard(proc)
                                    if self._scrub_proc is proc:
                                        self._scrub_proc = next(iter(self._scrub_procs), None)
                    return None if getattr(proc, "sight_stopped", False) else rc
                finally:
                    if active:
                        with self._play_cv:
                            self._play_active -= 1
                            self._play_cv.notify_all()
        finally:
            if held:
                self._scrub_slots.release()
            if counted:  # only when taking the playback slot failed
                with self._play_cv:
                    self._play_waiting -= 1
                    self._play_cv.notify_all()

    def _decode_peaks(self, path: Path, bars: int = 96) -> tuple[list[int], int] | None:
        """Shared ffmpeg PCM decode + peak bucketing, used by both the interactive waveform
        (§make_waveform) and the audio thumbnail."""
        if not self.ffmpeg_exe():
            return None
        sr = 8000
        cmd = [
            self.ffmpeg, "-hide_banner", "-loglevel", "error",
            "-i", str(path), "-ac", "1", "-ar", str(sr), "-f", "s16le", "-",
        ]
        try:
            proc = subprocess.run(cmd, capture_output=True, timeout=60, check=True, creationflags=NO_WINDOW)
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
        ffmpeg = self.ffmpeg_exe() if a["kind"] in ("video", "audio") else self.ffmpeg
        info = file_info(path, a["kind"], a["ext"], ffmpeg)
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

    def usdz_is_animated(self, aid: str) -> bool:
        """make_usdz_glb found the .usdz animated (and did not convert it) — the viewer reads it itself."""
        a = self.get_asset(aid)
        p = self.thumbs / "usdz" / f"{aid}.anim"
        try:
            return bool(a) and p.exists() and p.stat().st_mtime >= Path(a["path"]).stat().st_mtime
        except OSError:
            return False

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
            try:  # (a file removed meanwhile by another request is not fresh)
                return bool(p) and p.stat().st_mtime >= path.stat().st_mtime
            except OSError:
                return False

        cached = self.usdz_glb_path(aid)
        if fresh(cached):
            return cached
        anim = self.thumbs / "usdz" / f"{aid}.anim"
        if fresh(anim):
            return None
        # The viewer and the thumbnailer can both ask for the same file at once — serialise, so
        # the second caller reuses the first one's result instead of converting (and writing) again.
        with self._usdz_lock:
            cached = self.usdz_glb_path(aid)
            if fresh(cached):
                return cached
            if fresh(anim):
                return None
            from .usdz_convert import convert

            dest = self.thumbs / "usdz" / f"{aid}.glb"
            dest.parent.mkdir(parents=True, exist_ok=True)
            # An animated stage is not converted (the conversion keeps no animation): the viewer reads the file
            # itself. The marker remembers that until the file changes.
            anim.unlink(missing_ok=True)
            animated: list = []
            try:
                ok = convert(path, dest, animated)
            except Exception:
                ok = False
            if animated:
                dest.unlink(missing_ok=True)
                try:
                    anim.write_bytes(b"")
                except OSError:
                    pass
                return None
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
                if kind and not event.is_directory and lib._owner(event.dest_path) != sid:
                    # Into a nested source: its watcher indexes the new path (and pairs the move
                    # when it sees both ends); here the old row is only flagged missing.
                    if lib._owner(event.src_path) == sid:
                        lib._mark_gone(event.src_path)
                    return
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

    def _owner(self, fp: str) -> str | None:
        """The innermost source holding `fp` (sources may nest), or None."""
        fp_n = normpath(fp)
        best, best_n = None, ""
        for r in self.query("SELECT id, path FROM sources"):
            r_n = normpath(r["path"])
            if path_under(fp_n, r_n) and len(r_n) > len(best_n):
                best, best_n = r["id"], r_n
        return best

    def _touch_one(self, sid: str, fp: str, kind: str) -> None:
        # The outer source's watcher sees a nested source's files too; that source's own watcher
        # handles them, with its own excluded folders and ignore root. A late event of a removed
        # source finds no owner and adds nothing.
        if self._owner(fp) != sid:
            return
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
                self.thumbs / "wave" / f"{aid}.json", self.thumbs / "usdz" / f"{aid}.glb", self.thumbs / "usdz" / f"{aid}.anim",
                *(self.thumbs / "psd").glob(f"{aid}_*.png"),
                *(self.thumbs / "video").glob(f"{aid}_*"),
                *(self.thumbs / "nprev").glob(f"{aid}_*"),
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
            self._forget_thumb(aid)
        else:
            # A late watcher event of a source removed meanwhile must not add a row for it.
            cur = self.execute(
                """
                INSERT OR IGNORE INTO assets(id, source_id, path, name, ext, kind, size, mtime, status, has_thumb, added_at)
                SELECT ?,?,?,?,?,?,?,?,'ready',0,? WHERE EXISTS (SELECT 1 FROM sources WHERE id=?)
                """,
                (aid, sid, fp, name, ext, kind, st.st_size, st.st_mtime, now, sid),
            )
            if not cur.rowcount:
                return
        self.bus.publish({"type": "batch", "n": 1, "source": sid})

    def first_page_served(self) -> None:
        """The UI got its first /api/assets page: the startup scan may begin (resume_watchers)."""
        self._first_page.set()

    def resume_watchers(self) -> None:
        # Rows left behind by a source removed while it was being scanned / watched (before
        # remove_source guarded against that) showed in All with no source to remove them by.
        with self.lock:
            stray = [r[0] for r in self.conn.execute(
                "SELECT id FROM assets WHERE source_id NOT IN (SELECT id FROM sources)")]
            if stray:
                self.conn.execute("DELETE FROM assets WHERE source_id NOT IN (SELECT id FROM sources)")
            self.conn.execute("DELETE FROM collection_assets WHERE asset_id NOT IN (SELECT id FROM assets)")
            # A source added inside another one used to stay empty, its files owned by the outer
            # source (see add_source): hand them to the innermost source, deepest first.
            srcs = [(r["id"], r["path"], normpath(r["path"])) for r in self.conn.execute("SELECT id, path FROM sources")]
            for cid, cpath, c_n in sorted(srcs, key=lambda s: -len(s[2])):
                outer = [s[0] for s in srcs if path_under(c_n, s[2])]
                if not outer:
                    continue
                prefix = cpath.rstrip("\\/") + os.sep
                marks = ",".join("?" * len(outer))
                rows = self.conn.execute(
                    f"SELECT id, path, status FROM assets WHERE source_id IN ({marks}) AND substr(path, 1, ?) = ?",
                    (*outer, len(prefix), prefix),
                ).fetchall()
                self._reassign(rows, cid, cpath)
            self.conn.commit()
        for aid in stray:
            self._forget_thumb(aid)  # as remove_source does: a re-added folder renders them anew
        sids = []
        for row in self.query("SELECT id, path FROM sources"):
            if Path(row["path"]).is_dir():
                self._watch(row["id"], row["path"])
                sids.append(row["id"])
        if not sids:
            return

        def run_all() -> None:
            # The catch-up walk of every source competes with the first paint (disk, GIL, the
            # thumbnail queue), so it waits until the page has its first page of assets — the
            # server calls first_page_served() — or 3 s at most (a launch without a page).
            self._first_page.wait(timeout=3.0)
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
        review: str = "",
        cond: object = None,
    ) -> tuple[str, list[object]]:
        where = ["status != 'excluded'"]
        args: list[object] = []
        built = where_sql(cond) if cond else None  # the filter builder's tree (ValueError when malformed)
        if built:
            where.append(f"({built[0]})")
            args.extend(built[1])
        for tok in [t for t in q.replace(",", " ").split() if t]:
            needle = tok.lower()
            where.append("(instr(lower(name), ?) OR instr(lower(note), ?) OR instr(lower(tags), ?))")
            args.extend([needle, needle, needle])
        if kind:
            where.append("kind=?")
            args.append(kind)
        if source_id:
            scope, scope_args = self._source_scope(source_id)
            where.append(scope)
            args.extend(scope_args)
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
        if review in REVIEW_STATES:
            where.append(f"{_REVIEW_SQL} = ?")
            args.append(review)
        elif review == "open":
            where.append(f"{_OPEN_NOTES_SQL} > 0")
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
        review: str = "",
        cond: object = None,
    ) -> list[dict]:
        clause, args = self._clause(q, kind, source_id, tag, missing, collection_id, folder, review, cond)
        order_sql = self._order_by(sort, order)
        sql = f"SELECT {self._LIST_COLS} FROM assets WHERE {clause} {order_sql} LIMIT ? OFFSET ?"
        args.extend([limit, offset])
        return [self._list_item(r) for r in self.query(sql, tuple(args))]

    # The columns a grid card needs (list_assets and assets_by_ids return the same shape).
    _LIST_COLS = (
        "id, source_id, path, name, ext, kind, size, mtime, width, height, "
        "duration, tags, note, rating, status, has_thumb, animated, added_at, "
        f"{_REVIEW_SQL} AS review, {_OPEN_NOTES_SQL} AS open_notes, {_LOOSE_DRAW_SQL} AS loose_draw"
    )

    def _list_item(self, r) -> dict:
        item = dict(r)
        try:
            item["tags"] = json.loads(item.get("tags") or "[]")
        except json.JSONDecodeError:
            item["tags"] = []
        if item["id"] in self._have_thumb:
            item["has_thumb"] = 1
        if item["has_thumb"]:
            item["thumb_v"] = self.thumb_version(item["id"])
        return item

    def assets_by_ids(self, ids: list[str]) -> list[dict]:
        """The grid rows of these assets (any order; unknown ids are skipped) — lets the client
        refresh exactly the cards it shows instead of re-reading the first N of the list."""
        out: list[dict] = []
        ids = list(dict.fromkeys(str(i) for i in ids if i))
        for k in range(0, len(ids), 500):  # well under SQLite's bound-parameter limit
            chunk = ids[k:k + 500]
            sql = f"SELECT {self._LIST_COLS} FROM assets WHERE id IN ({','.join('?' * len(chunk))})"
            out.extend(self._list_item(r) for r in self.query(sql, tuple(chunk)))
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
        review: str = "",
        cond: object = None,
    ) -> int:
        clause, args = self._clause(q, kind, source_id, tag, missing, collection_id, folder, review, cond)
        row = self.query(f"SELECT COUNT(*) c FROM assets WHERE {clause}", tuple(args))
        return int(row[0]["c"]) if row else 0

    def collections(self) -> list[dict]:
        cols = [dict(r) for r in self.query(
            "SELECT id, name, parent_id, created_at, icon, color, rule, sg_site, sg_project, tracker, tracker_project"
            " FROM collections ORDER BY sort_order, created_at")]
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
            rule = c.pop("rule")
            try:
                c["rule"] = json.loads(rule) if rule else None
            except ValueError:
                c["rule"] = {"op": "and", "c": []}   # (a smart collection stays one: its rule is just empty)
            c["tracker"] = c["tracker"] or None
            proj = c.pop("tracker_project")
            c["trackerProject"] = proj if c["tracker"] else None
            # (pre-0.107 names, still sent for an older page: a ShotGrid one's host and project)
            c["sgSite"] = c.pop("sg_site")
            c["sgProject"] = c.pop("sg_project")
        return cols

    def add_collection(self, name: str, parent_id: str | None = None, rule: object = None,
                       tracker: str | None = None, tracker_project: object = None) -> dict:
        """A collection; with `rule` a smart one (a saved filter, no members). A tracker project's smart collection
        (`tracker` = the tracker key "<kind>:<host>" + `tracker_project` = the project's id, a positive integer or a
        short id string) lives under its project in Sources, never nested in a collection."""
        from .trackers import split_key
        rule_s = _rule_json(rule) if rule is not None else None
        if rule_s is None:
            tracker, tracker_project = None, None
        sg_site, sg_project, proj = None, None, None
        if tracker or tracker_project is not None:
            ok_proj = ((isinstance(tracker_project, int) and not isinstance(tracker_project, bool) and 0 < tracker_project < 2 ** 53)
                       or (isinstance(tracker_project, str) and 0 < len(tracker_project) <= 200 and tracker_project.isprintable()
                           and tracker_project.strip() == tracker_project))
            parts = split_key(tracker)
            if not parts or not ok_proj:
                raise ValueError("a tracker smart collection needs its tracker and project")
            proj = str(tracker_project)
            if parts[0] == "shotgrid":   # (also the pre-0.107 columns: an older Sight lists it under its project)
                if not re.fullmatch(r"[1-9]\d{0,15}", proj) or int(proj) >= 2 ** 53:
                    raise ValueError("a ShotGrid project id is a number")
                sg_site, sg_project = parts[1], int(proj)
            parent_id = None
        if parent_id and self.query("SELECT 1 FROM collections WHERE id=? AND (rule IS NOT NULL OR sg_site IS NOT NULL OR tracker IS NOT NULL)", (parent_id,)):
            parent_id = None   # (nothing nests inside a smart collection)
        cid = asset_id(f"col:{time.time_ns()}:{secrets.token_hex(8)}:{name}")
        nxt = self.query("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM collections")[0]["n"]
        self.execute(
            "INSERT INTO collections(id, name, parent_id, created_at, sort_order, rule, sg_site, sg_project, tracker, tracker_project)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            (cid, name.strip() or "Untitled", parent_id or None, int(time.time() * 1000), nxt, rule_s, sg_site, sg_project,
             tracker or None, proj),
        )
        return {"id": cid, "name": name.strip() or "Untitled", "parentId": parent_id or None, "assetIds": [], "count": 0,
                "icon": None, "color": None, "rule": json.loads(rule_s) if rule_s else None,
                "tracker": tracker or None, "trackerProject": proj, "sgSite": sg_site, "sgProject": sg_project}

    def set_collection_rule(self, cid: str, rule: object) -> None:
        """A smart collection's saved filter (a plain collection never becomes a smart one this way)."""
        self.execute("UPDATE collections SET rule=? WHERE id=? AND rule IS NOT NULL", (_rule_json(rule), cid))

    def set_collection_icon(self, cid: str, icon: str | None, color: str | None) -> None:
        self.execute("UPDATE collections SET icon=?, color=? WHERE id=?", (icon or None, color or None, cid))

    def rename_collection(self, cid: str, name: str) -> None:
        self.execute("UPDATE collections SET name=? WHERE id=?", (name.strip() or "Untitled", cid))

    def move_collection(self, cid: str, parent_id: str | None) -> None:
        if parent_id == cid:
            return
        if parent_id:
            # nothing nests inside a smart collection, and a ShotGrid one stays at the top (under its project)
            bad = self.query("SELECT 1 FROM collections WHERE (id=? AND (rule IS NOT NULL OR sg_site IS NOT NULL OR tracker IS NOT NULL))"
                             " OR (id=? AND (sg_site IS NOT NULL OR tracker IS NOT NULL))", (parent_id, cid))
            if bad:
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
        if self.query("SELECT 1 FROM collections WHERE id=? AND rule IS NOT NULL", (cid,)):
            return   # a smart collection has no members: its filter decides
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
        bid = asset_id(f"board:{time.time_ns()}:{secrets.token_hex(8)}:{name}")
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
        annotations = self.annotations_for_board(bid)
        return {"board": board, "items": items, "groups": groups, "annotations": annotations}

    def add_board_item(self, bid: str, body: dict) -> dict:
        iid = asset_id(f"bitem:{time.time_ns()}:{secrets.token_hex(8)}:{body.get('asset_id', '')}")
        now = int(time.time() * 1000)
        playback = body.get("playback_state")
        aid = str(body.get("asset_id") or "")
        arow = self.query("SELECT name, path FROM assets WHERE id=?", (aid,))  # snapshot; the body's copy is only a fallback (duplicate / undo of a card whose file is gone)
        self.execute(
            "INSERT INTO board_items(id, board_id, asset_id, group_id, x, y, w, h, rotation, "
            "z_index, opacity, desaturate, always_on_top, crop_x, crop_y, crop_w, crop_h, "
            "color_label, locked, playback_state, flip_x, flip_y, asset_name, asset_path, created_at, updated_at, revision) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)",
            (
                iid, bid, aid, body.get("group_id"),
                float(body.get("x", 0)), float(body.get("y", 0)),
                float(body.get("w", 240)), float(body.get("h", 240)),
                float(body.get("rotation", 0)), int(body.get("z_index", 0)),
                float(body.get("opacity", 1)), 1 if body.get("desaturate") else 0,
                1 if body.get("always_on_top") else 0,
                body.get("crop_x"), body.get("crop_y"), body.get("crop_w"), body.get("crop_h"),
                body.get("color_label"), 1 if body.get("locked") else 0,
                json.dumps(playback) if playback is not None else None,
                1 if body.get("flip_x") else 0, 1 if body.get("flip_y") else 0,
                arow[0]["name"] if arow else (str(body["asset_name"])[:1000] if body.get("asset_name") else None),
                arow[0]["path"] if arow else (str(body["asset_path"])[:1000] if body.get("asset_path") else None),
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
        gid = asset_id(f"bgroup:{time.time_ns()}:{secrets.token_hex(8)}:{bid}")
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

    def annotations_for_asset(self, aid: str, with_deleted: bool = False) -> list[dict]:
        # with_deleted: tombstones too (deleted_at set) — the ShotGrid sync must see notes deleted here.
        rows = self.query(
            "SELECT * FROM annotations WHERE scope='asset' AND target_asset_id=? "
            + ("" if with_deleted else "AND deleted_at IS NULL ") + "ORDER BY z_index",
            (aid,),
        )
        return [self._annotation_out(r) for r in rows]

    def annotations_for_board(self, bid: str) -> list[dict]:
        """Free drawings and review notes of a canvas board (scope='board'), bottom to top."""
        rows = self.query(
            "SELECT * FROM annotations WHERE scope='board' AND board_id=? AND deleted_at IS NULL "
            "ORDER BY z_index",
            (bid,),
        )
        return [self._annotation_out(r) for r in rows]

    def add_annotation(self, body: dict) -> dict:
        scope = str(body.get("scope") or "").strip()
        if scope not in ("asset", "board"):
            raise ValueError("scope must be 'asset' or 'board'")
        # The client may supply its own id (16 hex chars): the annotation editor needs stable ids
        # for undo/redo (a deleted row is revived under the same id) and for note <-> drawing links.
        want = str(body.get("id") or "").lower()
        if re.fullmatch(r"[0-9a-f]{16}", want):
            if self.query("SELECT id FROM annotations WHERE id=?", (want,)):
                now = int(time.time() * 1000)
                self.execute(
                    "UPDATE annotations SET deleted_at=NULL, updated_at=?, revision=revision+1 WHERE id=?",
                    (now, want),
                )
                return self.update_annotation(want, body) or {}
            aid = want
        else:
            aid = asset_id(f"anno:{time.time_ns()}:{secrets.token_hex(8)}:{scope}")
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

    def match_review_asset(self, meta: dict) -> dict | None:
        """Finds the library asset a .srev package was made on: the same id (same path on
        this machine), else the same file name and size, else the same name and kind."""
        aid = str(meta.get("id") or "")
        if aid:
            a = self.get_asset(aid)
            if a and a.get("status") == "ready":
                return a
        name = str(meta.get("name") or "").lower()
        if not name:
            return None
        rows = self.query(
            "SELECT id, size, kind FROM assets WHERE lower(name)=? AND status='ready' ORDER BY added_at DESC",
            (name,),
        )
        try:  # (the file's value may be anything; a library row may have no size)
            size = int(meta.get("size"))
        except (TypeError, ValueError):
            size = None
        for r in rows:
            if size is not None and r["size"] is not None and int(r["size"]) == size:
                return self.get_asset(r["id"])
        for r in rows:
            if r["kind"] == meta.get("kind"):
                return self.get_asset(r["id"])
        return None

    def set_review_status(self, aid: str, state: str, author: str = "") -> dict:
        """Sets (or with an empty state clears) an asset's review state. Updates the newest status
        row in place so one row keeps travelling between machines instead of piling up. Every change
        is appended to `data.history` ([{state, author, at}], state "" = cleared), so who changed the
        state and when survives; clearing keeps the row with state null (reads as no state)."""
        if state and state not in REVIEW_STATES:
            raise ValueError("unknown review state")
        cur = self.query(
            "SELECT id, data FROM annotations WHERE scope='asset' AND kind='status' AND target_asset_id=? "
            "AND deleted_at IS NULL ORDER BY updated_at DESC",
            (aid,),
        )
        if not cur and not state:
            return {"state": "", "history": []}
        history: list = []
        for r in cur:
            try:
                d = json.loads(r["data"] or "{}") or {}
                # Rows from 0.17.0 carry no history yet: their current state is its first entry.
                past = d.get("history") or ([{"state": d.get("state"), "author": d.get("author") or "", "at": d.get("at")}]
                                            if d.get("state") else [])
                history = self.merge_history(history, past)
            except (json.JSONDecodeError, AttributeError, TypeError):
                pass
        # A merge can leave several live status rows (one set on each machine); setting the state
        # retires all but the one kept, so an older state can't resurface.
        for r in cur[1:]:
            self.delete_annotation(r["id"])
        now = int(time.time() * 1000)
        history.append({"state": state, "author": author, "at": now})
        data = {"state": state or None, "author": author, "at": now, "history": history}
        if cur:
            self.update_annotation(cur[0]["id"], {"data": data})
        else:
            self.add_annotation({"scope": "asset", "target_asset_id": aid, "kind": "status", "data": data})
        return data

    def asset_versions(self, aid: str) -> list[dict]:
        """Other versions of an asset: images / PSDs / videos in the same folder whose names only
        differ in the version token (see version_key), oldest first; includes the asset itself."""
        a = self.get_asset(aid)
        if not a:
            return []
        folder = os.path.dirname(a["path"])
        prefix = folder.rstrip("\\/") + os.sep
        key = version_key(a["name"])[0]
        rows = self.query(
            "SELECT id, name, path, kind, ext FROM assets WHERE status='ready' AND substr(path, 1, ?) = ? "
            "AND instr(substr(path, ?), ?) = 0 AND (kind IN ('image', 'video') OR ext='.psd')",
            (len(prefix), prefix, len(prefix) + 1, os.sep),
        )
        out = []
        for r in rows:
            if os.path.dirname(r["path"]) != folder:
                continue
            k, v = version_key(r["name"])
            if k == key:
                out.append((v, r["name"].lower(), r["id"]))
        out.sort()
        return [x for x in (self.get_asset(i) for _, _, i in out) if x]

    def annotation_tombstones(self, aid: str) -> list[dict]:
        """Deleted rows of an asset's annotations ({id, deleted_at}) — a review package carries
        them so a delete on one machine also removes the row where the package is merged."""
        rows = self.query(
            "SELECT id, deleted_at FROM annotations WHERE scope='asset' AND target_asset_id=? "
            "AND deleted_at IS NOT NULL",
            (aid,),
        )
        return [{"id": r["id"], "deleted_at": r["deleted_at"]} for r in rows]

    # ---- tracker links (app/trackers.py; ShotGrid: docs/SHOTGRID.md) -----------------------------------
    # An asset's link to a tracker's media entity (a ShotGrid Version) and the sync state, one per tracker key
    # "<kind>:<host>". The link JSON is the adapter's own (ShotGrid: {site, project, version, task, entity, firstFrame}).
    def _migrate_tracker_links(self) -> None:
        """Once: the pre-0.107 ShotGrid links (sg_links, one per asset) become tracker_links rows under
        "shotgrid:<the link's site>" (`host_norm`: no scheme guessed, its port kept). Run once only (a meta mark): a link dropped later must not come back from the
        old table, which stays as it was for an older Sight."""
        if self.conn.execute("SELECT 1 FROM meta WHERE key='tracker_links_from_sg'").fetchone():
            return
        from .trackers import tracker_key_of_host
        for r in self.conn.execute("SELECT asset_id, link, state, updated_at FROM sg_links").fetchall():
            try:
                link = json.loads(r["link"])
            except (TypeError, ValueError):
                continue
            # link.site is a host as the page's URL.host gave it (no scheme): its port is kept as it is
            key = tracker_key_of_host("shotgrid", link["site"]) if isinstance(link, dict) and isinstance(link.get("site"), str) else ""
            if key:
                self.conn.execute("INSERT OR IGNORE INTO tracker_links(asset_id, tracker, link, state, updated_at) VALUES (?,?,?,?,?)",
                                  (r["asset_id"], key, r["link"], r["state"] or "{}", r["updated_at"]))
        self.conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('tracker_links_from_sg', '1')")

    def get_tracker_link(self, aid: str, tracker: str) -> dict | None:
        rows = self.query("SELECT link, state, updated_at FROM tracker_links WHERE asset_id=? AND tracker=?", (aid, tracker))
        if not rows:
            return None
        try:
            return {"link": json.loads(rows[0]["link"]), "state": json.loads(rows[0]["state"] or "{}"), "updated_at": rows[0]["updated_at"]}
        except json.JSONDecodeError:
            return None

    def set_tracker_link(self, aid: str, tracker: str, link: dict | None = None, state: dict | None = None) -> None:
        """Store the link and / or the sync state (None keeps what is there; a new link starts a fresh state)."""
        now = int(time.time() * 1000)
        with self.lock:
            cur = self.conn.execute("SELECT link, state FROM tracker_links WHERE asset_id=? AND tracker=?", (aid, tracker)).fetchone()
            if cur is None and link is None:
                return
            new_link = json.dumps(link) if link is not None else cur["link"]
            if state is not None:
                new_state = json.dumps(state)
            elif cur is None or (link is not None and cur["link"] != new_link):
                new_state = "{}"
            else:
                new_state = cur["state"]
            self.conn.execute(
                "INSERT INTO tracker_links(asset_id, tracker, link, state, updated_at) VALUES (?,?,?,?,?) "
                "ON CONFLICT(asset_id, tracker) DO UPDATE SET link=excluded.link, state=excluded.state, updated_at=excluded.updated_at",
                (aid, tracker, new_link, new_state, now),
            )
            self.conn.commit()

    def drop_tracker_link(self, aid: str, tracker: str) -> None:
        with self.lock:
            self.conn.execute("DELETE FROM tracker_links WHERE asset_id=? AND tracker=?", (aid, tracker))
            self.conn.commit()

    @staticmethod
    def merge_replies(a: list | None, b: list | None) -> list[dict]:
        """Union of two reply lists by id; for the same id the later edit (or delete) wins."""
        def stamp(x: dict) -> int:
            return max(Library._stamp(x.get("edited") or x.get("created")), Library._stamp(x.get("deleted")))

        out: dict[str, dict] = {}
        for x in [*(a or []), *(b or [])]:
            if not isinstance(x, dict) or not x.get("id"):
                continue
            k = str(x["id"])
            prev = out.get(k)
            # A ShotGrid reply id (FORMAT.md `sg`) is kept from either copy: only one client sent the reply.
            if prev is None or stamp(x) > stamp(prev):
                out[k] = {**x, "sg": prev["sg"]} if prev is not None and not x.get("sg") and prev.get("sg") else x
            elif not prev.get("sg") and x.get("sg"):
                out[k] = {**prev, "sg": x["sg"]}
        return sorted(out.values(), key=lambda x: Library._stamp(x.get("created")))

    @staticmethod
    def merge_history(a: list | None, b: list | None) -> list[dict]:
        """Union of two review-state histories ([{state, author, at}]), oldest first."""
        out: dict[tuple, dict] = {}
        for x in [*(a or []), *(b or [])]:
            if isinstance(x, dict):
                out.setdefault((Library._stamp(x.get("at")), str(x.get("state") or ""), str(x.get("author") or "")), x)
        return sorted(out.values(), key=lambda x: Library._stamp(x.get("at")))  # stable: ties keep their order

    @staticmethod
    def _stamp(v: object) -> int:
        try:
            return int(v or 0)
        except (TypeError, ValueError):
            return 0

    @classmethod
    def _content_at(cls, kind: str, data: dict, created: object, updated: object) -> int:
        """When a row's own content last changed. For a note that is its text / shots
        (`data.edited_at`, else when it was written) — replies and the resolved state carry their
        own stamps and are merged separately, so answering a note never makes a stale copy of the
        rest of it win. Drawings: the row's updated_at."""
        if kind == "note":
            return cls._stamp(data.get("edited_at") or data.get("created") or created)
        return cls._stamp(updated or created)

    def import_annotations(self, target: str, rows: list[dict], deleted: list[dict] | None = None,
                           shot_map: dict[str, str] | None = None, restore: bool = False,
                           kept_deleted: list[str] | None = None, restore_before: int | None = None) -> dict:
        """Merges the annotation rows of a review package into asset `target`.

        Rows keep their ids, so importing the same file twice — or a file that went to a reviewer
        and came back with answers — updates what is there instead of duplicating it. An id that
        already belongs to another asset is replaced by a stable derived one (same result on every
        import). Per row the later content stamp wins (`_content_at`); a local delete wins over
        an incoming row that was not edited after it; package tombstones delete local rows that
        were not edited after the delete. A note's replies are always unioned (merge_replies) and
        its open/done state goes by `data.status_at`, whichever side is newer otherwise.
        `shot_map` renames screenshot ids (see review.put_shot). The whole merge is one
        transaction: a malformed row rolls everything back. Returns counts
        {added, updated, deleted, unchanged}.

        Sight only (not in the JS port): `restore=True` brings back rows deleted here that the
        package holds even when the delete is later than their content (the user asked to restore
        them from the file); `kept_deleted`, when given, collects the ids of such rows that stayed
        deleted, so the caller can offer that restore. `restore_before` (ms): restore only rows deleted
        at or before it — the time of the first pass, so a row deleted here after the offer stays deleted."""
        stats = {"added": 0, "updated": 0, "deleted": 0, "unchanged": 0}
        id_re = re.compile(r"[0-9a-f]{16}")
        shot_map = shot_map or {}
        st = self._stamp

        def local_id(rid: str) -> str:
            rid = rid.lower()
            if not id_re.fullmatch(rid):
                return asset_id(f"anno-import:{target}:{rid}")
            cur = self.query("SELECT target_asset_id FROM annotations WHERE id=?", (rid,))
            if cur and cur[0]["target_asset_id"] != target:
                return asset_id(f"anno-import:{target}:{rid}")
            return rid

        rows = [r for r in rows if isinstance(r, dict) and r.get("id")]
        ids = {str(r["id"]): local_id(str(r["id"])) for r in rows}
        tombs = [
            (ids.get(str(t["id"])) or local_id(str(t["id"])), st(t["deleted_at"]))
            for t in deleted or []
            if isinstance(t, dict) and t.get("id") and st(t.get("deleted_at"))
        ]

        def num(v: object) -> float | None:
            try:
                return None if v is None else float(v)
            except (TypeError, ValueError):
                return None

        now = int(time.time() * 1000)
        with self.lock:
            try:
                for r in rows:
                    rid = ids[str(r["id"])]
                    data = dict(r.get("data")) if isinstance(r.get("data"), dict) else {}
                    if isinstance(data.get("note"), str) and data["note"] in ids:
                        data["note"] = ids[data["note"]]
                    if isinstance(data.get("shots"), list):
                        data["shots"] = [shot_map.get(str(x), str(x)) for x in data["shots"]]
                    if isinstance(data.get("shot"), str):  # a reference image's picture (kind "image")
                        data["shot"] = shot_map.get(data["shot"], data["shot"])
                    if not isinstance(data.get("replies"), (list, type(None))):
                        data["replies"] = []
                    if data.get("replies"):  # pictures attached to replies (web page / Sight)
                        data["replies"] = [
                            {**x, "shots": [shot_map.get(str(y), str(y)) for y in x["shots"]]}
                            if isinstance(x, dict) and isinstance(x.get("shots"), list) else x
                            for x in data["replies"]
                        ]
                    kind = str(r.get("kind") or "shape")
                    upd = st(r.get("updated_at") or r.get("created_at")) or now
                    vals = (
                        kind, r.get("shape_kind"), num(r.get("x")), num(r.get("y")), num(r.get("w")),
                        num(r.get("h")), num(r.get("rotation")) or 0.0, int(num(r.get("z_index")) or 0),
                        r.get("color") if isinstance(r.get("color"), str) else None,
                        1 if r.get("locked") else 0,
                    )
                    cur = self.conn.execute(
                        "SELECT data, created_at, updated_at, deleted_at FROM annotations WHERE id=?", (rid,)
                    ).fetchone()
                    if cur is None:
                        self.conn.execute(
                            "INSERT INTO annotations(id, kind, shape_kind, scope, target_asset_id, x, y, w, h, "
                            "rotation, z_index, color, locked, data, created_at, updated_at, revision) "
                            "VALUES (?,?,?,'asset',?,?,?,?,?,?,?,?,?,?,?,?,1)",
                            (rid, vals[0], vals[1], target, *vals[2:], json.dumps(data),
                             st(r.get("created_at")) or upd, upd),
                        )
                        stats["added"] += 1
                        continue
                    try:
                        have = json.loads(cur["data"] or "{}")
                    except json.JSONDecodeError:
                        have = {}
                    inc_at = self._content_at(kind, data, r.get("created_at"), upd)
                    revived = False
                    if cur["deleted_at"] is not None:
                        # Deleted here: only content edited after the delete brings it back.
                        if inc_at <= st(cur["deleted_at"]):
                            if not restore or (restore_before is not None and st(cur["deleted_at"]) > restore_before):
                                if kept_deleted is not None:
                                    kept_deleted.append(rid)
                                stats["unchanged"] += 1
                                continue
                            revived = True  # restored on request: stamped as edited now (below)
                            # Undelete: the local copy's content stays when it is the newer one.
                            newer = inc_at > self._content_at(kind, have, cur["created_at"], cur["updated_at"])
                        else:
                            newer = True
                    else:
                        newer = inc_at > self._content_at(kind, have, cur["created_at"], cur["updated_at"])
                    merged = dict(data if newer else have)
                    if kind == "note":
                        if have.get("replies") or data.get("replies"):
                            merged["replies"] = self.merge_replies(have.get("replies"), data.get("replies"))
                        a_at, b_at = st(have.get("status_at")), st(data.get("status_at"))
                        if b_at > a_at:
                            merged["status"], merged["status_at"] = data.get("status"), b_at
                        elif a_at > b_at:
                            merged["status"], merged["status_at"] = have.get("status"), a_at
                        # The ShotGrid link (FORMAT.md `data.sg`) is kept from either side, whichever content won.
                        other = have if newer else data
                        if not merged.get("sg") and other.get("sg"):
                            merged["sg"] = other["sg"]
                    elif kind == "status" and (have.get("history") or data.get("history")):
                        merged["history"] = self.merge_history(have.get("history"), data.get("history"))
                    if not newer and not revived and merged == have:
                        stats["unchanged"] += 1
                        continue
                    if revived:
                        # A deliberate restore is an edit made now: an old tombstone of this row (in a
                        # later package) must not delete it again, and other copies revive it on merge.
                        if kind == "note":
                            merged["edited_at"] = now
                        upd = max(upd, now)
                    if newer:
                        self.conn.execute(
                            "UPDATE annotations SET kind=?, shape_kind=?, x=?, y=?, w=?, h=?, rotation=?, "
                            "z_index=?, color=?, locked=?, data=?, updated_at=?, deleted_at=NULL, "
                            "revision=revision+1 WHERE id=?",
                            (*vals, json.dumps(merged), max(upd, now if kind == "note" else upd), rid),
                        )
                    else:
                        self.conn.execute(
                            "UPDATE annotations SET data=?, updated_at=?, deleted_at=NULL, revision=revision+1 "
                            "WHERE id=?",  # (deleted_at is set here only on a restore)
                            (json.dumps(merged), max(now, st(cur["updated_at"])), rid),
                        )
                    stats["updated"] += 1
                for rid, when in tombs:
                    cur = self.conn.execute(
                        "SELECT kind, data, created_at, updated_at FROM annotations WHERE id=? "
                        "AND target_asset_id=? AND deleted_at IS NULL",
                        (rid, target),
                    ).fetchone()
                    if not cur:
                        continue
                    try:
                        have = json.loads(cur["data"] or "{}")
                    except json.JSONDecodeError:
                        have = {}
                    if when > self._content_at(cur["kind"], have, cur["created_at"], cur["updated_at"]):
                        self.conn.execute(
                            "UPDATE annotations SET deleted_at=?, updated_at=? WHERE id=?", (when, when, rid)
                        )
                        stats["deleted"] += 1
                self.conn.commit()
            except Exception:
                self.conn.rollback()
                raise
        return stats

    def asset_holding_annotations(self, ids: list[str]) -> dict | None:
        """The ready asset that already holds most of these annotation ids — where an earlier
        import of the same review (or the review itself) lives, so a merge goes back there."""
        want = [i.lower() for i in ids if isinstance(i, str)][:900]
        if not want:
            return None
        rows = self.query(
            f"SELECT target_asset_id t, COUNT(*) c FROM annotations WHERE scope='asset' AND id IN "
            f"({','.join('?' * len(want))}) GROUP BY target_asset_id ORDER BY c DESC LIMIT 1",
            tuple(want),
        )
        if not rows or not rows[0]["t"]:
            return None
        a = self.get_asset(rows[0]["t"])
        return a if a and a.get("status") == "ready" else None

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

    # ---- Review panel previews (annotate.js previewFrame / view3dPic) ------------------------------
    # The review panel's note pictures (a video frame, a 3D still) are made in the browser, which is slow (a
    # seek or a render each); it stores each one here so the next opening of the panel only loads files.
    # "thumbs/nprev/<aid>_<size>_<mtime_ns>_<key>.jpg": a changed source file makes them stale (dropped on the
    # next listing); the asset delete / rename / changed-file paths cover "<aid>_*" too. The browser prunes
    # them when notes go (prune_note_previews with the keys its live notes still show).
    NPREV_KEY = re.compile(r"^[A-Za-z0-9.-]{1,64}$")
    NPREV_AID = re.compile(r"^[0-9a-f]{16}$")  # asset_id(): also keeps glob characters out of the patterns below
    NPREV_MAX_BYTES = 4 * 1048576

    def _nprev_prefix(self, aid: str) -> str | None:
        if not self.NPREV_AID.match(aid or ""):
            return None
        a = self.get_asset(aid)
        stamp = self._play_stamp(a["path"]) if a else None
        return f"{aid}_{stamp}_" if stamp else None

    def note_previews(self, aid: str) -> dict:
        """The keys stored for asset ``aid`` (its current file only; stale ones are deleted) and the stamp
        that versions their URLs."""
        prefix = self._nprev_prefix(aid)
        if not prefix:  # no such asset, or its file is offline: nothing listed, nothing deleted
            return {"keys": [], "v": ""}
        keys = []
        for p in (self.thumbs / "nprev").glob(f"{aid}_*.jpg"):
            if p.name.startswith(prefix):
                keys.append(p.name[len(prefix):-4])
            else:
                try:
                    p.unlink(missing_ok=True)
                except OSError:
                    pass
        return {"keys": sorted(keys), "v": prefix[len(aid) + 1:-1]}

    def note_preview_path(self, aid: str, key: str) -> Path | None:
        if not self.NPREV_KEY.match(key or ""):
            return None
        prefix = self._nprev_prefix(aid)
        p = self.thumbs / "nprev" / f"{prefix}{key}.jpg" if prefix else None
        return p if p and p.is_file() else None

    def save_note_preview(self, aid: str, key: str, data: bytes, version: str = "") -> bool:
        """Stores one preview. ``version``: the stamp the browser listed (note_previews "v") — a preview made
        from an older version of the file than the one there now is refused, not stored as current."""
        if not self.NPREV_KEY.match(key or "") or not data or len(data) > self.NPREV_MAX_BYTES or data[:2] != b"\xff\xd8":
            return False
        prefix = self._nprev_prefix(aid)
        if not prefix or prefix != f"{aid}_{version}_":
            return False
        d = self.thumbs / "nprev"
        d.mkdir(parents=True, exist_ok=True)
        final = d / f"{prefix}{key}.jpg"
        tmp = d / f"{prefix}{key}.{secrets.token_hex(4)}.part"
        try:
            tmp.write_bytes(data)
            tmp.replace(final)
        except OSError:
            tmp.unlink(missing_ok=True)
            return False
        return True

    def prune_note_previews(self, aid: str, keep: list[str]) -> int:
        """Deletes asset ``aid``'s stored previews whose key is not in ``keep``; returns how many went."""
        keep_set = {k for k in keep if isinstance(k, str)}
        prefix = self._nprev_prefix(aid)
        if not prefix:  # no such asset / its file offline: leave everything alone
            return 0
        gone = 0
        for p in (self.thumbs / "nprev").glob(f"{aid}_*.jpg"):
            if p.name.startswith(prefix) and p.name[len(prefix):-4] in keep_set:
                continue
            try:
                p.unlink(missing_ok=True)
                gone += 1
            except OSError:
                pass
        return gone

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
