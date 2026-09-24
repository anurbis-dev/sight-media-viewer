"""Per-type file details for the lightbox info overlay (I).

file_info() returns sections of (label, value) rows that only make sense for that kind of file:
EXIF for photos, codecs for video, name-table fields for fonts, page data for PDFs, header counts
for 3D files and so on. Every reader is best-effort — a field that can't be read is simply left
out, and a reader that fails returns nothing rather than raising. Generic facts every asset has
(name, size, modified, path) are added by the frontend from the asset row, not here.
"""

from __future__ import annotations

import json
import re
import struct
import subprocess
import zipfile
import zlib
from pathlib import Path

Rows = list[list[str]]


def _sec(title: str, rows: Rows) -> dict | None:
    rows = [[k, str(v)] for k, v in rows if v not in (None, "", [])]
    return {"title": title, "rows": rows} if rows else None


def _num(n: float, digits: int = 2) -> str:
    return f"{n:.{digits}f}".rstrip("0").rstrip(".")


def _dur(sec: float) -> str:
    sec = max(0.0, sec)
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h)}:{int(m):02d}:{s:06.3f}" if h else f"{int(m)}:{s:06.3f}"


# ---- images ----------------------------------------------------------------------------------

_MODE = {
    "1": ("Bitmap", 1), "L": ("Grayscale", 8), "LA": ("Grayscale + alpha", 8), "P": ("Indexed", 8),
    "PA": ("Indexed + alpha", 8), "RGB": ("RGB", 8), "RGBA": ("RGBA", 8), "RGBX": ("RGB", 8),
    "CMYK": ("CMYK", 8), "YCbCr": ("YCbCr", 8), "LAB": ("Lab", 8), "HSV": ("HSV", 8),
    "I": ("Grayscale", 32), "F": ("Grayscale float", 32), "I;16": ("Grayscale", 16),
    "I;16B": ("Grayscale", 16), "I;16L": ("Grayscale", 16),
}
_EXIF_ORIENT = {
    1: "Normal", 2: "Mirrored", 3: "Rotated 180°", 4: "Flipped", 5: "Mirrored, rotated 90° CCW",
    6: "Rotated 90° CW", 7: "Mirrored, rotated 90° CW", 8: "Rotated 90° CCW",
}


def _ratio(v) -> float | None:
    try:
        return float(v)
    except Exception:
        try:
            return v[0] / v[1]
        except Exception:
            return None


def _exposure(v) -> str | None:
    t = _ratio(v)
    if not t:
        return None
    return f"1/{round(1 / t)} s" if t < 0.5 else f"{_num(t, 1)} s"


def _image(path: Path, ext: str) -> list[dict]:
    if ext == ".svg":
        return _svg(path)
    from PIL import Image

    out: list[dict] = []
    with Image.open(path) as im:
        mode_name, depth = _MODE.get(im.mode, (im.mode, None))
        bits = im.info.get("bits")
        if isinstance(bits, int) and bits:
            depth = bits
        if im.format == "PNG" and im.mode.startswith("I;16"):
            depth = 16
        frames = getattr(im, "n_frames", 1) or 1
        dpi = im.info.get("dpi")
        icc = im.info.get("icc_profile")
        profile = None
        if icc:
            try:
                from io import BytesIO
                from PIL import ImageCms

                profile = ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(BytesIO(icc))).strip()
            except Exception:
                profile = "Embedded"
        has_alpha = "A" in im.getbands() or "transparency" in im.info
        rows: Rows = [
            ["Format", im.format_description or im.format],
            ["Color", mode_name],
            ["Bit depth", f"{depth} bit / channel" if depth else None],
            ["Alpha", "Yes" if has_alpha else "No"],
            ["Color profile", profile],
            ["DPI", f"{_num(_ratio(dpi[0]) or 0, 1)} × {_num(_ratio(dpi[1]) or 0, 1)}" if dpi else None],
        ]
        if frames > 1:
            rows.append(["Frames", frames])
            try:
                total = 0
                for i in range(frames):
                    im.seek(i)
                    total += im.info.get("duration", 0) or 0
                if total:
                    rows.append(["Animation length", _dur(total / 1000)])
                loop = im.info.get("loop")
                if loop is not None:
                    rows.append(["Loop", "Forever" if loop == 0 else f"{loop}×"])
                im.seek(0)
            except Exception:
                pass
        if im.format == "JPEG":
            rows.append(["Encoding", "Progressive" if im.info.get("progressive") or im.info.get("progression") else "Baseline"])
            try:
                from PIL import JpegImagePlugin

                ss = JpegImagePlugin.get_sampling(im)
                rows.append(["Chroma subsampling", {0: "4:4:4", 1: "4:2:2", 2: "4:2:0"}.get(ss)])
            except Exception:
                pass
        if im.format == "TIFF":
            rows.append(["Compression", im.info.get("compression")])
        if im.format == "PNG" and im.info.get("interlace"):
            rows.append(["Interlaced", "Yes"])
        out.append(_sec("Image", rows))
        try:
            out.append(_exif(im.getexif()))
        except Exception:
            pass
        text = {k: v for k, v in im.info.items() if k in ("parameters", "Software", "Comment", "Description", "Author", "Title", "prompt") and isinstance(v, str)}
        if text:
            out.append(_sec("Embedded text", [[k.capitalize(), v[:400]] for k, v in text.items()]))
    return out


def _exif(exif) -> dict | None:
    if not exif:
        return None
    try:
        sub = exif.get_ifd(0x8769)
    except Exception:
        sub = {}
    g = lambda tag: sub.get(tag, exif.get(tag))  # noqa: E731
    make, model = (g(0x010F) or "").strip(), (g(0x0110) or "").strip()
    camera = model if make and model.lower().startswith(make.lower().split()[0]) else f"{make} {model}".strip()
    fnum = _ratio(g(0x829D))
    focal = _ratio(g(0x920A))
    f35 = g(0xA405)
    bias = _ratio(g(0x9204))
    flash = g(0x9209)
    iso = g(0x8827)
    if isinstance(iso, tuple):
        iso = iso[0] if iso else None
    rows: Rows = [
        ["Camera", camera],
        ["Lens", (g(0xA434) or "").strip() or None],
        ["Taken", g(0x9003) or g(0x0132)],
        ["Exposure", _exposure(g(0x829A))],
        ["Aperture", f"f/{_num(fnum, 1)}" if fnum else None],
        ["ISO", iso],
        ["Focal length", (f"{_num(focal, 1)} mm" + (f" ({f35} mm eq.)" if f35 else "")) if focal else None],
        ["Exposure bias", f"{bias:+.1f} EV" if bias else None],
        ["Flash", ("Fired" if flash & 1 else "Off") if isinstance(flash, int) else None],
        ["Orientation", _EXIF_ORIENT.get(exif.get(0x0112)) if exif.get(0x0112, 1) != 1 else None],
        ["Software", (exif.get(0x0131) or "").strip() or None],
        ["Artist", (exif.get(0x013B) or "").strip() or None],
        ["GPS", "Yes" if 0x8825 in exif else None],
    ]
    return _sec("Camera", rows)


def _svg(path: Path) -> list[dict]:
    with path.open("rb") as fh:
        head = fh.read(65536).decode("utf-8", "replace")
    m = re.search(r"<svg\b[^>]*>", head, re.S)
    tag = m.group(0) if m else ""
    attr = lambda n: (re.search(rf'\b{n}\s*=\s*["\']([^"\']*)', tag) or [None, None])[1]  # noqa: E731
    elements = len(re.findall(r"<[a-zA-Z]", head))
    rows: Rows = [
        ["Format", "SVG (vector)"],
        ["Width", attr("width")],
        ["Height", attr("height")],
        ["viewBox", attr("viewBox")],
        ["Elements", f"{elements}+" if len(head) >= 65536 else elements],
        ["Editor", "Inkscape" if "inkscape" in head else "Illustrator" if "Illustrator" in head else "Figma" if "figma" in head.lower() else None],
    ]
    return [_sec("Image", rows)]


# ---- video / audio (ffmpeg -i banner) --------------------------------------------------------

def _ffprobe_text(ffmpeg: str, path: Path) -> str:
    r = subprocess.run(
        [ffmpeg, "-hide_banner", "-i", str(path)],
        capture_output=True, timeout=20,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    return r.stderr.decode("utf-8", "replace")


def _parse_ff(text: str) -> dict:
    info: dict = {"meta": {}, "streams": [], "text": text}
    in_input_meta = False
    for line in text.splitlines():
        s = line.strip()
        if line.startswith("Input #"):
            continue
        if s == "Metadata:" and line.startswith("  ") and not line.startswith("    "):
            in_input_meta = not info["streams"]
            continue
        m = re.match(r"^\s{4}(\w[\w.\- ]*?)\s*:\s(.*)$", line)
        if m and in_input_meta and not line.startswith("      "):
            info["meta"].setdefault(m.group(1).lower(), m.group(2).strip())
            continue
        m = re.match(r"^\s*Duration: ([\d:.]+|N/A)(?:, start: [^,]+)?(?:, bitrate: (\d+) kb/s)?", line)
        if m:
            if m.group(1) != "N/A":
                h, mi, se = m.group(1).split(":")
                info["duration"] = int(h) * 3600 + int(mi) * 60 + float(se)
            if m.group(2):
                info["bitrate"] = int(m.group(2))
            in_input_meta = False
            continue
        m = re.match(r"^\s*Stream #\d+:\d+.*?: (Video|Audio|Subtitle|Data): (.*)$", line)
        if m:
            in_input_meta = False
            info["streams"].append({"type": m.group(1), "desc": m.group(2), "lang": (re.search(r"\((\w{3})\)", line.split(":")[1] if ":" in line else "") or [None, None])[1]})
    return info


def _split_top(desc: str) -> list[str]:
    """Split an ffmpeg stream description on commas that are not inside parentheses."""
    parts, depth, cur = [], 0, ""
    for ch in desc:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        parts.append(cur.strip())
    return parts


def _codec(first: str) -> tuple[str, str | None]:
    name = first.split(" ")[0]
    prof = re.match(r"^\S+ \(([^)/]+)\)", first)
    pretty = {
        "h264": "H.264 / AVC", "hevc": "H.265 / HEVC", "av1": "AV1", "vp9": "VP9", "vp8": "VP8",
        "prores": "Apple ProRes", "mpeg4": "MPEG-4 Part 2", "mpeg2video": "MPEG-2", "dnxhd": "Avid DNxHD/HR",
        "mjpeg": "Motion JPEG", "aac": "AAC", "mp3": "MP3", "mp3float": "MP3", "opus": "Opus", "vorbis": "Vorbis",
        "flac": "FLAC", "alac": "Apple Lossless", "ac3": "Dolby Digital (AC-3)", "eac3": "Dolby Digital Plus",
        "wmav2": "WMA", "wmv3": "WMV 9", "png": "PNG", "cfhd": "GoPro CineForm",
    }.get(name, name)
    if name.startswith("pcm_"):
        pretty = "PCM " + name[4:]
    profile = prof.group(1).strip() if prof else None
    if profile and profile.startswith(name):  # decoder name ("mp3float"), not a profile
        profile = None
    return pretty, profile


_PIX_DEPTH = re.compile(r"p(\d{2})(?:le|be)?$")
_PRIMARIES = {
    "bt709": "Rec. 709", "bt2020": "Rec. 2020", "bt470bg": "Rec. 601 (PAL)", "smpte170m": "Rec. 601 (NTSC)",
    "bt470m": "Rec. 601 (NTSC)", "smpte432": "Display P3", "smpte431": "DCI-P3", "film": "Film",
    "smpte240m": "SMPTE 240M",
}
_TRANSFER = {
    "smpte2084": "PQ (HDR10)", "arib-std-b67": "HLG (HDR)", "iec61966-2-1": "sRGB", "linear": "Linear",
    "bt709": "Rec. 709 gamma", "bt2020-10": "Rec. 709 gamma", "bt2020-12": "Rec. 709 gamma",
    "smpte170m": "Rec. 601 gamma", "gamma22": "Gamma 2.2", "gamma28": "Gamma 2.8",
}
_UNSET = ("unknown", "reserved", "unspecified", "")


def _color_profile(color: str | None) -> Rows:
    """ffmpeg prints the stream's color tags in the pixel-format parens: "tv, bt709" when matrix,
    primaries and transfer agree, "tv, bt2020nc/bt2020/smpte2084" when they don't (matrix/primaries/transfer)."""
    if not color:
        return [["Color profile", "Not tagged (players assume Rec. 709)"]]
    parts = [p.strip() for p in color.split(",")]
    rng = next((p for p in parts if p in ("tv", "pc")), None)
    spec = next((p for p in parts if p not in ("tv", "pc", "progressive") and "first" not in p and not p.startswith("top") and not p.startswith("bottom")), "")
    if "/" in spec:
        matrix, prim, trc = (spec.split("/") + ["", "", ""])[:3]
    else:
        matrix = prim = trc = spec
    rows: Rows = []
    if prim in _UNSET and trc in _UNSET:
        rows.append(["Color profile", "Not tagged (players assume Rec. 709)"])
    else:
        name = _PRIMARIES.get(prim, prim if prim not in _UNSET else "Untagged primaries")
        tf = _TRANSFER.get(trc)
        rows.append(["Color profile", name + (f" · {tf}" if tf and not (tf.startswith("Rec.") and name.startswith("Rec.")) else "")])
        if "/" in spec:
            rows.append(["Matrix / prim. / transfer", " / ".join(x or "?" for x in (matrix, prim, trc))])
    rows.append(["Color range", {"tv": "Limited (16–235)", "pc": "Full (0–255)"}.get(rng)])
    rows.append(["Dynamic range", "HDR10 / PQ" if trc == "smpte2084" else "HLG" if trc == "arib-std-b67" else "SDR"])
    return rows


def _count_frames(ffmpeg: str, path: Path) -> int | None:
    """Exact frame count by remuxing the first video stream to nowhere (no decoding, so it runs at
    disk speed). Skipped for huge files; None if it doesn't finish in time."""
    try:
        if path.stat().st_size > 6 * 1024**3:
            return None
        r = subprocess.run(
            [ffmpeg, "-hide_banner", "-i", str(path), "-map", "0:v:0", "-c", "copy", "-f", "null", "-"],
            capture_output=True, timeout=15,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        found = re.findall(r"frame=\s*(\d+)", r.stderr.decode("utf-8", "replace"))
        return int(found[-1]) if found else None
    except Exception:
        return None


def _video_rows(st: dict, duration: float | None, frames: int | None) -> Rows:
    parts = _split_top(st["desc"])
    codec, profile = _codec(parts[0])
    pix, color = None, None
    size = fps = br = None
    for p in parts[1:]:
        m = re.match(r"^(\d+)x(\d+)", p)
        if m and not size:
            size = f"{m.group(1)} × {m.group(2)}"
            dar = re.search(r"DAR (\d+:\d+)", p)
            if dar and dar.group(1) != "1:1":
                size += f" (DAR {dar.group(1)})"
            continue
        m = re.match(r"^([\d.]+)(k?) fps", p)
        if m:
            fps = float(m.group(1)) * (1000 if m.group(2) else 1)
            continue
        m = re.match(r"^(\d+) kb/s", p)
        if m:
            br = int(m.group(1))
            continue
        m = re.match(r"^([a-z0-9_]+)(?:\((.*)\))?$", p)
        if m and pix is None and any(k in m.group(1) for k in ("yuv", "rgb", "gbr", "gray", "nv12", "p010", "bgr", "ya")):
            pix, color = m.group(1), m.group(2)
    depth = None
    if pix:
        d = _PIX_DEPTH.search(pix)
        depth = int(d.group(1)) if d else 8
    chroma = None
    if pix and pix.startswith(("yuv", "yuvj")):
        m = re.match(r"yuvj?a?(4\d\d)", pix)
        chroma = f"{m.group(1)[0]}:{m.group(1)[1]}:{m.group(1)[2]}" if m else None
    if frames is None and fps and duration:
        frames_txt = f"≈ {round(fps * duration):,}"
    else:
        frames_txt = f"{frames:,}" if frames else None
    return [
        ["Duration", (_dur(duration) + (f" · {frames_txt} frames" if frames_txt else "")) if duration else None],
        ["Frame rate", f"{_num(fps, 3)} fps" if fps else None],
        ["Frame size", size],
        ["Video codec", codec + (f" ({profile})" if profile else "")],
        *_color_profile(color),
        ["Bit depth", f"{depth} bit" if depth else None],
        ["Chroma subsampling", chroma],
        ["Pixel format", pix],
        ["Scan", "Interlaced" if color and ("top first" in color or "bottom first" in color) else "Progressive" if pix else None],
        ["Video bitrate", f"{br:,} kb/s" if br else None],
    ]


def _audio_rows(st: dict) -> Rows:
    parts = _split_top(st["desc"])
    codec, profile = _codec(parts[0])
    rate = ch = fmt = br = None
    for p in parts[1:]:
        m = re.match(r"^(\d+) Hz", p)
        if m:
            rate = int(m.group(1))
            continue
        m = re.match(r"^(\d+) kb/s", p)
        if m:
            br = int(m.group(1))
            continue
        if p in ("mono", "stereo") or re.match(r"^\d\.\d", p) or "channels" in p or p in ("quad", "hexagonal", "octagonal"):
            ch = p
            continue
        if p.startswith(("s16", "s32", "s24", "flt", "dbl", "u8", "s64")):
            fmt = p
    depth = None
    if fmt:
        m = re.search(r"\((\d+) bit\)", fmt)
        base = fmt.split(" ")[0].rstrip("p")
        depth = int(m.group(1)) if m else {"s16": 16, "s32": 32, "flt": 32, "dbl": 64, "u8": 8, "s64": 64}.get(base)
        # Lossy decoders always report float samples — that says nothing about the file.
        lossless = parts[0].startswith(("pcm", "flac", "alac", "wavpack", "ape", "tta", "truehd", "mlp"))
        if not lossless and not m:
            depth = None
        elif base in ("flt", "dbl") and depth:
            depth = f"{depth} bit float"
    return [
        ["Audio codec", codec + (f" ({profile})" if profile else "")],
        ["Sample rate", f"{rate / 1000:g} kHz" if rate else None],
        ["Channels", ch],
        ["Bit depth", f"{depth} bit" if isinstance(depth, int) else depth],
        ["Audio bitrate", f"{br:,} kb/s" if br else None],
    ]


def _av(path: Path, kind: str, ffmpeg: str | None) -> list[dict]:
    if not ffmpeg:
        return [_sec("Media", [["Details", "ffmpeg not found"]])]
    info = _parse_ff(_ffprobe_text(ffmpeg, path))
    streams = info["streams"]
    video = [s for s in streams if s["type"] == "Video" and "attached pic" not in s["desc"]]
    audio = [s for s in streams if s["type"] == "Audio"]
    subs = [s for s in streams if s["type"] == "Subtitle"]
    cover = any(s["type"] == "Video" and "attached pic" in s["desc"] for s in streams)
    dur = info.get("duration")
    meta = info["meta"]
    out: list[dict] = []
    total_br: Rows = [["Overall bitrate", f"{info['bitrate']:,} kb/s" if info.get("bitrate") else None]]
    if kind == "video":
        frames = _count_frames(ffmpeg, path) if video else None
        v_rows = _video_rows(video[0], dur, frames) if video else [["Duration", _dur(dur) if dur else None]]
        tc = re.search(r"^\s*timecode\s*:\s*(\S+)", info.get("text", ""), re.M)
        out.append(_sec("Video", v_rows + [["Start timecode", tc.group(1) if tc else None]] + total_br))
        if audio:
            a_rows = _audio_rows(audio[0])
            if len(audio) > 1:
                a_rows.append(["Audio tracks", f"{len(audio)} ({', '.join(s['lang'] or '?' for s in audio)})"])
            out.append(_sec("Audio", a_rows))
        else:
            out.append(_sec("Audio", [["Audio", "None"]]))
        if subs:
            out.append(_sec("Subtitles", [["Tracks", f"{len(subs)} ({', '.join(s['lang'] or '?' for s in subs)})"]]))
    else:
        head: Rows = [["Duration", _dur(dur) if dur else None]]
        out.append(_sec("Audio", head + (_audio_rows(audio[0]) if audio else []) + total_br + [["Cover art", "Yes" if cover else None]]))
    tags: Rows = [[k.replace("_", " ").capitalize(), meta.get(k)] for k in (
        "title", "artist", "album_artist", "album", "track", "date", "genre", "composer", "comment",
        "encoder", "creation_time", "com.apple.quicktime.make", "com.apple.quicktime.model",
        "com.apple.quicktime.software", "handler_name", "major_brand",
    ) if meta.get(k)]
    for r in tags:
        r[0] = {"Com.apple.quicktime.make": "Device make", "Com.apple.quicktime.model": "Device model",
                "Com.apple.quicktime.software": "Device software", "Creation time": "Created",
                "Major brand": "Container brand"}.get(r[0], r[0])
    out.append(_sec("Tags", tags))
    return out


# ---- fonts (sfnt tables, WOFF1 too) ----------------------------------------------------------

def _sfnt_tables(data: bytes) -> dict[str, bytes]:
    tables: dict[str, bytes] = {}
    if data[:4] == b"wOFF":
        num = struct.unpack(">H", data[12:14])[0]
        for i in range(num):
            tag, off, clen, olen, _ = struct.unpack(">4sIIII", data[44 + i * 20: 64 + i * 20])
            raw = data[off: off + clen]
            tables[tag.decode("latin-1")] = zlib.decompress(raw) if clen < olen else raw
        return tables
    num = struct.unpack(">H", data[4:6])[0]
    for i in range(num):
        tag, _, off, length = struct.unpack(">4sIII", data[12 + i * 16: 28 + i * 16])
        tables[tag.decode("latin-1")] = data[off: off + length]
    return tables


def _name_table(t: bytes) -> dict[int, str]:
    out: dict[int, tuple[int, str]] = {}
    count, str_off = struct.unpack(">HH", t[2:6])
    for i in range(count):
        pid, eid, lid, nid, ln, off = struct.unpack(">6H", t[6 + i * 12: 18 + i * 12])
        raw = t[str_off + off: str_off + off + ln]
        if pid == 3 or pid == 0:
            s, score = raw.decode("utf-16-be", "replace"), 3 if lid in (0x409, 0) else 1
        elif pid == 1:
            s, score = raw.decode("mac_roman", "replace"), 2 if lid == 0 else 0
        else:
            continue
        if nid not in out or score > out[nid][0]:
            out[nid] = (score, s.strip())
    return {k: v for k, (_, v) in out.items()}


_WEIGHT = {100: "Thin", 200: "Extra Light", 300: "Light", 400: "Regular", 500: "Medium",
           600: "Semi Bold", 700: "Bold", 800: "Extra Bold", 900: "Black"}


def _font(path: Path, ext: str) -> list[dict]:
    data = path.read_bytes()
    if data[:4] == b"wOF2":
        from PIL import ImageFont

        fam, style = ImageFont.truetype(str(path), 12).getname()
        return [_sec("Font", [["Family", fam], ["Style", style], ["Container", "WOFF2"]])]
    t = _sfnt_tables(data)
    names = _name_table(t["name"]) if "name" in t else {}
    rows: Rows = [
        ["Family", names.get(16) or names.get(1)],
        ["Style", names.get(17) or names.get(2)],
        ["Full name", names.get(4)],
        ["Version", names.get(5)],
    ]
    if "OS/2" in t and len(t["OS/2"]) >= 6:
        w = struct.unpack(">H", t["OS/2"][4:6])[0]
        rows.append(["Weight", f"{w} ({_WEIGHT.get(round(w / 100) * 100, '')})".replace(" ()", "")])
    if "maxp" in t:
        rows.append(["Glyphs", f"{struct.unpack('>H', t['maxp'][4:6])[0]:,}"])
    if "head" in t:
        rows.append(["Units per em", struct.unpack(">H", t["head"][18:20])[0]])
    rows.append(["Outlines", "PostScript (CFF2)" if "CFF2" in t else "PostScript (CFF)" if "CFF " in t else "TrueType" if "glyf" in t else None])
    if "fvar" in t:
        fv = t["fvar"]
        off, _, count, size = struct.unpack(">4H", fv[4:12])
        axes = []
        for i in range(count):
            tag, mn, df, mx = struct.unpack(">4siii", fv[off + i * size: off + i * size + 16])
            axes.append(f"{tag.decode('latin-1').strip()} {_num(mn / 65536, 1)}–{_num(mx / 65536, 1)}")
        rows.append(["Variable axes", ", ".join(axes)])
    color = [n for tag, n in (("COLR", "COLR"), ("SVG ", "SVG"), ("sbix", "sbix"), ("CBDT", "CBDT")) if tag in t]
    rows.append(["Color font", ", ".join(color) if color else None])
    rows.append(["Kerning", "GPOS" if "GPOS" in t else "kern" if "kern" in t else None])
    rows.append(["Container", "WOFF" if data[:4] == b"wOFF" else "OpenType" if data[:4] == b"OTTO" else "TrueType"])
    meta: Rows = [
        ["Designer", names.get(9)],
        ["Foundry", names.get(8)],
        ["Copyright", (names.get(0) or "")[:200] or None],
        ["License", (names.get(13) or "")[:200] or None],
    ]
    return [_sec("Font", rows), _sec("Credits", meta)]


# ---- documents -------------------------------------------------------------------------------

def _pdf_date(s: str | None) -> str | None:
    m = re.match(r"D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?", s or "")
    if not m:
        return s or None
    y, mo, d, h, mi = (g or "00" for g in m.groups())
    return f"{y}-{mo}-{d} {h}:{mi}"


def _pdf(path: Path, ext: str) -> list[dict]:
    import pymupdf as fitz

    doc = fitz.open(str(path))
    try:
        md = doc.metadata or {}
        rows: Rows = [["Format", md.get("format")]]
        if ext != ".epub":
            rows.append(["Pages", doc.page_count])
            if doc.page_count:
                r = doc.load_page(0).rect
                mm = lambda pt: round(pt / 72 * 25.4)  # noqa: E731
                rows.append(["Page size", f"{mm(r.width)} × {mm(r.height)} mm ({_num(r.width, 0)} × {_num(r.height, 0)} pt)"])
        try:
            toc = doc.get_toc()
            rows.append(["Outline entries", len(toc) or None])
        except Exception:
            pass
        rows.append(["Encrypted", "Yes" if doc.is_encrypted or md.get("encryption") else None])
        rows.append(["Form fields", "Yes" if getattr(doc, "is_form_pdf", False) else None])
        meta: Rows = [
            ["Title", md.get("title")], ["Author", md.get("author")], ["Subject", md.get("subject")],
            ["Keywords", md.get("keywords")], ["Creator", md.get("creator")], ["Producer", md.get("producer")],
            ["Created", _pdf_date(md.get("creationDate"))], ["Modified", _pdf_date(md.get("modDate"))],
        ]
        return [_sec("Document", rows), _sec("Metadata", meta)]
    finally:
        doc.close()


TEXT_LIMIT = 32 * 1024 * 1024


def _text(path: Path, ext: str) -> list[dict]:
    with path.open("rb") as fh:
        raw = fh.read(TEXT_LIMIT + 1)
    partial = len(raw) > TEXT_LIMIT
    raw = raw[:TEXT_LIMIT]
    enc = None
    for bom, name in ((b"\xef\xbb\xbf", "UTF-8 (BOM)"), (b"\xff\xfe", "UTF-16 LE"), (b"\xfe\xff", "UTF-16 BE")):
        if raw.startswith(bom):
            enc = name
    if enc and enc.startswith("UTF-16"):
        text = raw.decode("utf-16", "replace")
    else:
        try:
            text = raw.decode("utf-8")
            enc = enc or ("ASCII" if raw.isascii() else "UTF-8")
        except UnicodeDecodeError:
            text = raw.decode("utf-8", "replace")
            enc = "Legacy 8-bit (not UTF-8)" if b"\x00" not in raw[:4096] else "Binary"
    crlf = text.count("\r\n")
    lf = text.count("\n") - crlf
    cr = text.count("\r") - crlf
    endings = [n for n, c in (("CRLF", crlf), ("LF", lf), ("CR", cr)) if c]
    lines = text.splitlines()
    plus = "+" if partial else ""
    rows: Rows = [
        ["Encoding", enc],
        ["Line endings", " + ".join(endings) + (" (mixed)" if len(endings) > 1 else "") if endings else "None"],
        ["Lines", f"{len(lines):,}{plus}"],
        ["Words", f"{len(text.split()):,}{plus}"],
        ["Characters", f"{len(text):,}{plus}"],
        ["Longest line", f"{max((len(l) for l in lines), default=0):,} chars"],
        ["Indent", ("Tabs" if sum(l.startswith("\t") for l in lines) > sum(l.startswith("  ") for l in lines) else "Spaces") if any(l[:1] in (" ", "\t") for l in lines) else None],
    ]
    if ext in (".csv", ".tsv") and lines:
        import csv

        delim = "\t" if ext == ".tsv" else max(",;|\t", key=lines[0].count)
        head = next(csv.reader([lines[0]], delimiter=delim), [])
        rows += [["Delimiter", {"\t": "Tab", ",": "Comma", ";": "Semicolon", "|": "Pipe"}[delim]],
                 ["Columns", len(head)], ["Rows", f"{max(0, len(lines) - 1):,}{plus} (+ header)"],
                 ["Header", ", ".join(head)[:300]]]
    elif ext == ".json" and not partial:
        try:
            obj = json.loads(text.lstrip("﻿"))
            kind = type(obj).__name__.replace("dict", "object").replace("list", "array")
            size = f" ({len(obj):,} {'keys' if isinstance(obj, dict) else 'items'})" if isinstance(obj, (dict, list)) else ""
            rows += [["JSON", "Valid"], ["Top level", kind + size]]
            if isinstance(obj, dict):
                rows.append(["Keys", ", ".join(list(obj)[:20]) + (" …" if len(obj) > 20 else "")])
        except ValueError as e:
            rows.append(["JSON", f"Invalid: {e}"[:200]])
    elif ext in (".md", ".markdown"):
        heads = [l for l in lines if l.startswith("#")]
        rows += [["Headings", len(heads)], ["Links", len(re.findall(r"\]\(", text))],
                 ["Code blocks", text.count("```") // 2 or None]]
    return [_sec("Text", rows)]


# ---- design ----------------------------------------------------------------------------------

def _psd(path: Path) -> list[dict]:
    from psd_tools import PSDImage

    psd = PSDImage.open(path)
    layers = groups = hidden = 0
    kinds: dict[str, int] = {}
    for layer in psd.descendants():
        if layer.is_group():
            groups += 1
        else:
            layers += 1
            kinds[layer.kind] = kinds.get(layer.kind, 0) + 1
        if not layer.visible:
            hidden += 1
    mode = getattr(psd.color_mode, "name", str(psd.color_mode)).replace("_", " ").title().replace("Rgb", "RGB").replace("Cmyk", "CMYK")
    special = ", ".join(f"{n} {k}" for k, n in kinds.items() if k not in ("pixel",))
    rows: Rows = [
        ["Format", "PSB (large document)" if psd.version == 2 else "PSD"],
        ["Color", mode],
        ["Bit depth", f"{psd.depth} bit / channel"],
        ["Channels", psd.channels],
        ["Layers", f"{layers} ({groups} groups)" if groups else layers],
        ["Layer types", special or None],
        ["Hidden layers", hidden or None],
    ]
    try:
        icc = psd.image_resources.get_data(1039)
        if icc:
            from io import BytesIO
            from PIL import ImageCms

            rows.append(["Color profile", ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(BytesIO(icc))).strip()])
    except Exception:
        pass
    return [_sec("Photoshop", rows)]


def _blend(path: Path) -> list[dict]:
    with path.open("rb") as fh:
        head = fh.read(32)
    comp = None
    if head[:2] == b"\x1f\x8b":
        import gzip

        with gzip.open(path, "rb") as g:
            head, comp = g.read(32), "gzip"
    elif head[:4] == b"\x28\xb5\x2f\xfd":
        comp = "Zstandard"
    rows: Rows = [["Compression", comp or "None"]]
    if head.startswith(b"BLENDER"):
        # Old header "BLENDER-v405" (pointer size, endianness, 3-digit version); 5.0+ "BLENDER17-01v0500".
        m = re.match(rb"BLENDER(?:([_-])|\d\d-\d\d)[vV](\d{3,4})", head)
        if m:
            v = m.group(2).decode()
            ver = f"{v[0]}.{int(v[1:])}" if len(v) == 3 else f"{int(v[:2])}.{int(v[2:])}"
            rows = [["Saved with", f"Blender {ver}"], ["Pointer size", "32 bit" if m.group(1) == b"_" else "64 bit"]] + rows
    elif comp == "Zstandard":
        rows.append(["Saved with", "Blender 3.0+ (version inside compressed data)"])
    return [_sec("Blender", rows)]


def _sketch(path: Path) -> list[dict]:
    with zipfile.ZipFile(path) as z:
        meta = json.loads(z.read("meta.json"))
    pages = meta.get("pagesAndArtboards", {})
    boards = sum(len(p.get("artboards", {})) for p in pages.values())
    return [_sec("Sketch", [["App version", meta.get("appVersion")], ["Pages", len(pages)], ["Artboards", boards]])]


def _ai(path: Path) -> list[dict]:
    with path.open("rb") as fh:
        head = fh.read(8)
    if not head.startswith(b"%PDF"):
        return [_sec("Illustrator", [["Format", "Legacy PostScript .ai (no PDF compatibility)"]])]
    out = _pdf(path, ".pdf")
    if out and out[0]:
        out[0]["title"] = "Illustrator"
        out[0]["rows"] = [r if r[0] != "Pages" else ["Artboards", r[1]] for r in out[0]["rows"]]
    return out


# ---- 3D --------------------------------------------------------------------------------------

def _gltf_json(path: Path, ext: str) -> dict | None:
    with path.open("rb") as fh:
        if ext == ".glb":
            magic, ver, _ = struct.unpack("<4sII", fh.read(12))
            if magic != b"glTF":
                return None
            clen, ctype = struct.unpack("<II", fh.read(8))
            return json.loads(fh.read(clen))
        return json.loads(fh.read())


def _gltf(path: Path, ext: str) -> list[dict]:
    g = _gltf_json(path, ext)
    if not g:
        return []
    n = lambda k: len(g.get(k, []))  # noqa: E731
    asset = g.get("asset", {})
    ext_used = g.get("extensionsUsed", [])
    anims = g.get("animations", [])
    rows: Rows = [
        ["Format", f"glTF {asset.get('version', '')} ({'binary' if ext == '.glb' else 'JSON'})"],
        ["Generator", asset.get("generator")],
        ["Scenes", n("scenes") if n("scenes") > 1 else None],
        ["Nodes", n("nodes")],
        ["Meshes", n("meshes")],
        ["Materials", n("materials")],
        ["Textures", n("textures")],
        ["Images", n("images")],
        ["Skins", n("skins") or None],
        ["Animations", (f"{len(anims)}: " + ", ".join(a.get("name") or "?" for a in anims[:8]) + (" …" if len(anims) > 8 else "")) if anims else None],
        ["Cameras", n("cameras") or None],
        ["Draco compressed", "Yes" if "KHR_draco_mesh_compression" in ext_used else None],
        ["Meshopt compressed", "Yes" if "EXT_meshopt_compression" in ext_used else None],
        ["KTX2 textures", "Yes" if "KHR_texture_basisu" in ext_used else None],
        ["Extensions", ", ".join(e for e in ext_used if e not in ("KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu")) or None],
    ]
    if ext == ".gltf":
        rows.append(["External files", len({b.get("uri") for b in g.get("buffers", []) + g.get("images", []) if b.get("uri") and not str(b.get("uri")).startswith("data:")}) or None])
    return [_sec("Model", rows)]


def obj_is_binary(path: Path) -> bool:
    """True for an .obj that is compiler output (MSVC/COFF — Unity BurstCache, VS build folders),
    not a Wavefront mesh. Wavefront OBJ is plain text, so a NUL byte in the head settles it."""
    try:
        with open(path, "rb") as fh:
            head = fh.read(256)
    except OSError:
        return False
    return head[:2] in (b"d\x86", b"L\x01", b"d\xaa") or b"\0" in head


def _obj(path: Path) -> list[dict]:
    if obj_is_binary(path):
        return [_sec("Model", [["Format", "Compiled object file (COFF), not a 3D mesh"]])]
    counts = {b"v": 0, b"vt": 0, b"vn": 0, b"f": 0, b"o": 0, b"g": 0, b"usemtl": 0}
    mtl = []
    with path.open("rb") as fh:
        for line in fh:
            key = line.split(b" ", 1)[0].strip()
            if key in counts:
                counts[key] += 1
            elif key == b"mtllib":
                mtl.append(line[7:].strip().decode("utf-8", "replace"))
    return [_sec("Model", [
        ["Format", "Wavefront OBJ"],
        ["Vertices (file)", f"{counts[b'v']:,}"], ["UVs", f"{counts[b'vt']:,}" if counts[b"vt"] else "None"],
        ["Normals", f"{counts[b'vn']:,}" if counts[b"vn"] else "None"], ["Faces (file)", f"{counts[b'f']:,}"],
        ["Objects / groups", f"{counts[b'o']} / {counts[b'g']}"], ["Material switches", counts[b"usemtl"] or None],
        ["Material library", ", ".join(mtl) or "None"],
    ])]


def _stl(path: Path) -> list[dict]:
    size = path.stat().st_size
    with path.open("rb") as fh:
        head = fh.read(84)
    if len(head) == 84:
        n = struct.unpack("<I", head[80:84])[0]
        if 84 + n * 50 == size:
            name = head[:80].split(b"\x00")[0].decode("latin-1", "replace").strip()
            return [_sec("Model", [["Format", "STL (binary)"], ["Triangles (file)", f"{n:,}"], ["Header", name or None]])]
    facets = 0
    with path.open("rb") as fh:
        for line in fh:
            if line.lstrip().startswith(b"facet"):
                facets += 1
    return [_sec("Model", [["Format", "STL (ASCII)"], ["Triangles (file)", f"{facets:,}"]])]


def _ply(path: Path) -> list[dict]:
    header = []
    with path.open("rb") as fh:
        for _ in range(400):
            line = fh.readline()
            if not line:
                break
            s = line.decode("latin-1").strip()
            header.append(s)
            if s == "end_header":
                break
    fmt = next((l.split()[1] for l in header if l.startswith("format ")), None)
    elems, props = {}, []
    for l in header:
        p = l.split()
        if p[:1] == ["element"] and len(p) >= 3:
            elems[p[1]] = int(p[2])
        elif p[:1] == ["property"]:
            props.append(p[-1])
    splat = "f_dc_0" in props or "scale_0" in props
    rest = [p for p in props if p.startswith("f_rest_")]
    sh = {0: 0, 9: 1, 24: 2, 45: 3}.get(len(rest))
    rows: Rows = [
        ["Format", f"PLY ({fmt})" if fmt else "PLY"],
        ["Content", "Gaussian splat" if splat else "Mesh / point cloud"],
        ["Splats" if splat else "Vertices (file)", f"{elems.get('vertex', 0):,}"],
        ["Faces (file)", f"{elems['face']:,}" if "face" in elems else None],
        ["SH degree", sh if splat and sh is not None else None],
        ["Vertex colors", "Yes" if not splat and {"red", "diffuse_red"} & set(props) else None],
        ["Properties", len(props)],
    ]
    return [_sec("Model", rows)]


def _fbx(path: Path) -> list[dict]:
    with path.open("rb") as fh:
        head = fh.read(27)
    if head.startswith(b"Kaydara FBX Binary"):
        v = struct.unpack("<I", head[23:27])[0]
        return [_sec("Model", [["Format", f"FBX {v // 1000}.{v % 1000 // 100} (binary)"]])]
    with path.open("rb") as fh:
        txt = fh.read(2048).decode("latin-1")
    m = re.search(r"FBX (\d+\.\d+)", txt)
    return [_sec("Model", [["Format", f"FBX {m.group(1)} (ASCII)" if m else "FBX (ASCII)"]])]


def _usdz(path: Path) -> list[dict]:
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
    exts: dict[str, int] = {}
    for n in names:
        e = Path(n).suffix.lower()
        exts[e] = exts.get(e, 0) + 1
    textures = sum(v for k, v in exts.items() if k in (".png", ".jpg", ".jpeg", ".exr", ".avif"))
    return [_sec("Model", [
        ["Format", "USDZ package"], ["Root layer", names[0] if names else None],
        ["USD layers", sum(v for k, v in exts.items() if k in (".usdc", ".usda", ".usd"))],
        ["Textures", textures], ["Files", len(names)],
    ])]


def _splat(path: Path, ext: str) -> list[dict]:
    rows: Rows = [["Content", "Gaussian splat"]]
    if ext == ".splat":
        rows.append(["Splats", f"{path.stat().st_size // 32:,}"])
    elif ext == ".spz":
        import gzip

        try:
            with gzip.open(path, "rb") as g:
                magic, ver, n, sh = struct.unpack("<IIIB", g.read(13))
            rows += [["Format", f"SPZ v{ver}"], ["Splats", f"{n:,}"], ["SH degree", sh]]
        except Exception:
            pass
    return [_sec("Model", rows)]


# ---- dispatch --------------------------------------------------------------------------------

def file_info(path: Path, kind: str, ext: str, ffmpeg: str | None) -> list[dict]:
    ext = ext.lower()
    try:
        if kind == "image":
            out = _image(path, ext)
        elif kind in ("video", "audio"):
            out = _av(path, kind, ffmpeg)
        elif kind == "font":
            out = _font(path, ext)
        elif kind == "document":
            out = _pdf(path, ext) if ext in (".pdf", ".epub") else _text(path, ext)
        elif kind == "model3d":
            out = (
                _gltf(path, ext) if ext in (".gltf", ".glb") else _obj(path) if ext == ".obj"
                else _stl(path) if ext == ".stl" else _ply(path) if ext == ".ply" else _fbx(path) if ext == ".fbx"
                else _usdz(path) if ext == ".usdz" else _splat(path, ext)
            )
        elif ext == ".psd":
            out = _psd(path)
        elif ext == ".blend":
            out = _blend(path)
        elif ext == ".sketch":
            out = _sketch(path)
        elif ext == ".ai":
            out = _ai(path)
        else:
            out = []
    except Exception as e:  # a damaged or unusual file just gets fewer details
        out = [_sec("Details", [["Error", f"{type(e).__name__}: {e}"[:200]]])]
    return [s for s in out if s]
