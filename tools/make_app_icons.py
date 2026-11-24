"""Builds the app icons from the Sight mark (app/static/favicon.svg, the one on the splash and in the
sidebar): app/sight.ico for Windows (the exe, the Start Menu shortcut) and app/sight.icns for the macOS
bundle. Run after changing the mark:  python tools/make_app_icons.py

The mark is drawn here with the same numbers as favicon.svg (viewBox 64): a dark rounded tile, a light
ring, a blue focus dot. Drawn at 4x and scaled down, so the edges stay clean at every size.

- Windows: the tile fills the whole icon (the usual Windows look). Sizes 16..256 in one .ico.
- macOS: the tile sits on the standard Big Sur grid (824 px tile on a 1024 px canvas, 100 px margin)
  with a soft shadow, so it sits with the other Dock icons. The .icns holds the PNG sizes Apple reads.
"""

from __future__ import annotations

import struct
import sys
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"

# favicon.svg, viewBox 0 0 64 64
TILE = (0x17, 0x18, 0x1B)
RING = (0xE9, 0xEA, 0xEC)
DOT = (0x5B, 0x8C, 0xFF)
SVG = 64.0
SS = 4  # supersampling factor


def draw_mark(size: int, tile_rx_ratio: float = 14 / 64, full_bleed_inset: float = 0.0) -> Image.Image:
    """The mark as an RGBA image of `size` px. `full_bleed_inset` (0..1 of size) shrinks the tile for
    the macOS grid; the mark is scaled with the tile."""
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    inset = full_bleed_inset * big
    span = big - 2 * inset
    k = span / SVG

    def p(x: float, y: float) -> tuple[float, float]:
        return inset + x * k, inset + y * k

    x0, y0 = p(0, 0)
    x1, y1 = p(64, 64)
    d.rounded_rectangle((x0, y0, x1, y1), radius=tile_rx_ratio * span, fill=TILE + (255,))
    cx, cy = p(32, 32)
    r_out, r_in = 25 * k, 19 * k
    d.ellipse((cx - r_out, cy - r_out, cx + r_out, cy + r_out), fill=RING + (255,))
    d.ellipse((cx - r_in, cy - r_in, cx + r_in, cy + r_in), fill=TILE + (255,))
    dx, dy = p(38, 27)
    r_dot = 9 * k
    d.ellipse((dx - r_dot, dy - r_dot, dx + r_dot, dy + r_dot), fill=DOT + (255,))
    return img.resize((size, size), Image.LANCZOS)


def build_windows_ico(path: Path) -> None:
    base = draw_mark(256)
    base.save(path, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])


def build_macos_master() -> Image.Image:
    """1024 px canvas: the tile at 824 px centred (100 px margin), with a soft drop shadow."""
    canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    tile = draw_mark(1024, tile_rx_ratio=185 / 824, full_bleed_inset=100 / 1024)
    shadow_alpha = tile.getchannel("A").filter(ImageFilter.GaussianBlur(18))
    shadow = Image.new("RGBA", tile.size, (0, 0, 0, 0))
    shadow.putalpha(shadow_alpha.point(lambda a: int(a * 0.35)))
    offset = Image.new("RGBA", tile.size, (0, 0, 0, 0))
    offset.alpha_composite(shadow, (0, 12))  # alpha_composite, not paste with a mask: paste squares the alpha
    canvas.alpha_composite(offset)
    canvas.alpha_composite(tile)
    return canvas


# icns element types for PNG data, by pixel size (the @2x ones carry the size of the double)
ICNS_TYPES = [
    ("icp4", 16), ("icp5", 32), ("icp6", 64), ("ic07", 128), ("ic08", 256),
    ("ic09", 512), ("ic10", 1024), ("ic11", 32), ("ic12", 64), ("ic13", 256), ("ic14", 512),
]


def build_macos_icns(path: Path) -> None:
    master = build_macos_master()
    chunks = []
    for code, px in ICNS_TYPES:
        img = master.resize((px, px), Image.LANCZOS) if px != 1024 else master
        buf = BytesIO()
        img.save(buf, format="PNG")
        data = buf.getvalue()
        chunks.append(code.encode("ascii") + struct.pack(">I", len(data) + 8) + data)
    body = b"".join(chunks)
    path.write_bytes(b"icns" + struct.pack(">I", len(body) + 8) + body)


def main() -> int:
    APP.mkdir(exist_ok=True)
    build_windows_ico(APP / "sight.ico")
    build_macos_icns(APP / "sight.icns")
    print("wrote", APP / "sight.ico", "and", APP / "sight.icns")
    return 0


if __name__ == "__main__":
    sys.exit(main())
