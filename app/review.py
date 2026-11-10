"""Review sessions on top of the per-asset annotations (see app/static/annotate.js).

- Screenshots: PNG/JPEG files in <SIGHT_HOME>/review_shots/<id>.<ext>, referenced from a note's
  data.shots list by id.
- PDF report: built here with PyMuPDF's Story (HTML layout -> paginated PDF), so any script the
  notes are written in (Cyrillic, CJK ...) renders with MuPDF's bundled fallback fonts.
- .sightreview package: one JSON file holding the media's identity, every annotation row and the
  screenshots (base64), so a review can be mailed / sent by messenger and opened on another machine
  that has the same media file in its library.
"""

from __future__ import annotations

import base64
import html
import io
import json
import os
import re
import tempfile
import time
from pathlib import Path

PACKAGE_FORMAT = "sight-review"
PACKAGE_VERSION = 1
SHOT_ID = re.compile(r"^[0-9a-f]{16}$")


def shots_dir(root: Path) -> Path:
    d = root / "review_shots"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _new_id() -> str:
    return os.urandom(8).hex()


def save_shot(root: Path, data: bytes) -> str:
    ext = ".jpg" if data[:3] == b"\xff\xd8\xff" else ".png"
    sid = _new_id()
    (shots_dir(root) / f"{sid}{ext}").write_bytes(data)
    return sid


def shot_path(root: Path, sid: str) -> Path | None:
    if not SHOT_ID.match(sid or ""):
        return None
    for ext in (".png", ".jpg"):
        p = shots_dir(root) / f"{sid}{ext}"
        if p.exists():
            return p
    return None


def decode_data_url(s: str) -> bytes | None:
    if not isinstance(s, str) or not s.startswith("data:"):
        return None
    try:
        return base64.b64decode(s.split(",", 1)[1])
    except Exception:
        return None


def export_dir(root: Path) -> Path:
    """Where exported reports/packages land: the user's Downloads folder when there is one."""
    dl = Path.home() / "Downloads"
    d = dl if dl.is_dir() else root / "exports"
    d.mkdir(parents=True, exist_ok=True)
    return d


def safe_name(name: str) -> str:
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", name).strip(" .")
    return name[:120] or "review"


def unique_path(folder: Path, stem: str, ext: str) -> Path:
    p = folder / f"{stem}{ext}"
    n = 2
    while p.exists():
        p = folder / f"{stem} ({n}){ext}"
        n += 1
    return p


# ---- PDF -------------------------------------------------------------------------------------

_PDF_CSS = """
body { font-family: sans-serif; font-size: 9.5pt; color: #1d1d1f; }
h1 { font-size: 17pt; margin: 0 0 2pt 0; }
.sub { color: #6e6e73; font-size: 8.5pt; margin: 0 0 8pt 0; }
.meta { font-size: 8.5pt; color: #3a3a3c; margin: 0 0 10pt 0; }
.note { margin: 12pt 0 0 0; padding: 8pt 0 0 0; border-top: 0.6pt solid #c7c7cc; }
.head { font-size: 9pt; color: #3a3a3c; margin: 0 0 3pt 0; }
.num { font-weight: bold; color: #ffffff; background-color: #d0342c; padding: 0 3pt; }
.done .num { background-color: #34a853; }
.ctx { font-weight: bold; }
.who { color: #6e6e73; }
.text { font-size: 10.5pt; margin: 2pt 0 4pt 0; }
.status { color: #34a853; font-weight: bold; }
img { display: block; margin: 4pt 0 2pt 0; }
.cap { color: #8e8e93; font-size: 7.5pt; margin: 0 0 4pt 0; }
"""

PAGE = (595.0, 842.0)  # A4, points
MARGIN = 40.0


def _img_tag(name: str, w: int, h: int, max_h: float) -> str:
    cw = PAGE[0] - 2 * MARGIN
    if not w or not h:
        return f'<img src="{name}" style="width:{cw:.0f}pt"/>'
    width = min(cw, max_h * w / h)
    return f'<img src="{name}" style="width:{width:.0f}pt"/>'


def build_pdf(payload: dict, root: Path, out: Path) -> int:
    """payload: {title, subtitle, meta: [[label, value]], cover, notes: [{num, ctx, author, date,
    text, status, frame, shots: [id], frameCaption}]} — images are data URLs (cover/frame) or shot
    ids. Returns the page count."""
    import pymupdf
    from PIL import Image

    tmp = tempfile.mkdtemp(prefix="sight-pdf-")
    counter = [0]

    def put_image(data: bytes | None) -> tuple[str, int, int] | None:
        if not data:
            return None
        try:
            im = Image.open(io.BytesIO(data))
            im.load()
        except Exception:
            return None
        if im.mode not in ("RGB", "L"):
            bg = Image.new("RGB", im.size, (255, 255, 255))
            bg.paste(im, mask=im.convert("RGBA").split()[-1])
            im = bg
        im.thumbnail((2000, 2000))
        counter[0] += 1
        name = f"i{counter[0]}.jpg"
        im.save(os.path.join(tmp, name), "JPEG", quality=88)
        return name, im.width, im.height

    def shot_bytes(sid: str) -> bytes | None:
        p = shot_path(root, sid)
        return p.read_bytes() if p else None

    esc = lambda s: html.escape(str(s or "")).replace("\n", "<br/>")
    parts = [f"<h1>{esc(payload.get('title') or 'Review')}</h1>"]
    if payload.get("subtitle"):
        parts.append(f'<p class="sub">{esc(payload["subtitle"])}</p>')
    meta = payload.get("meta") or []
    if meta:
        parts.append('<p class="meta">' + " &#183; ".join(
            f"<b>{esc(k)}</b> {esc(v)}" for k, v in meta if v not in (None, "")) + "</p>")
    cover = put_image(decode_data_url(payload.get("cover") or ""))
    if cover:
        parts.append(_img_tag(*cover, max_h=380))
    for n in payload.get("notes") or []:
        done = n.get("status") == "done"
        head = [f'<span class="num">&#160;{esc(n.get("num"))}&#160;</span>']
        if n.get("ctx"):
            head.append(f'<span class="ctx">{esc(n["ctx"])}</span>')
        who = " &#183; ".join(esc(x) for x in (n.get("author"), n.get("date")) if x)
        if who:
            head.append(f'<span class="who">{who}</span>')
        if done:
            head.append('<span class="status">Resolved</span>')
        parts.append(f'<div class="note{" done" if done else ""}"><p class="head">{" &#160; ".join(head)}</p>')
        if n.get("text"):
            parts.append(f'<p class="text">{esc(n["text"])}</p>')
        frame = put_image(decode_data_url(n.get("frame") or ""))
        if frame:
            parts.append(_img_tag(*frame, max_h=300))
            if n.get("frameCaption"):
                parts.append(f'<p class="cap">{esc(n["frameCaption"])}</p>')
        for sid in n.get("shots") or []:
            shot = put_image(shot_bytes(str(sid)))
            if shot:
                parts.append(_img_tag(*shot, max_h=300))
        parts.append("</div>")
    story = pymupdf.Story(html="".join(parts), user_css=_PDF_CSS, archive=pymupdf.Archive(tmp))
    mediabox = pymupdf.Rect(0, 0, *PAGE)
    where = mediabox + (MARGIN, MARGIN, -MARGIN, -MARGIN - 10)
    buf = io.BytesIO()
    writer = pymupdf.DocumentWriter(buf)
    more = 1
    while more:
        dev = writer.begin_page(mediabox)
        more, _ = story.place(where)
        story.draw(dev)
        writer.end_page()
    writer.close()
    doc = pymupdf.open("pdf", buf.getvalue())
    total = doc.page_count
    footer = str(payload.get("footer") or "")
    for i, page in enumerate(doc):
        label = f"{i + 1} / {total}"
        page.insert_text((PAGE[0] - MARGIN - 30, PAGE[1] - 22), label, fontsize=7.5, color=(0.55, 0.55, 0.58))
        if footer and footer.isascii():
            page.insert_text((MARGIN, PAGE[1] - 22), footer, fontsize=7.5, color=(0.55, 0.55, 0.58))
    doc.set_metadata({"title": str(payload.get("title") or "Review"), "creator": "Sight"})
    doc.save(str(out), garbage=3, deflate=True)
    doc.close()
    for f in os.listdir(tmp):
        try:
            os.remove(os.path.join(tmp, f))
        except OSError:
            pass
    try:
        os.rmdir(tmp)
    except OSError:
        pass
    return total


# ---- .sightreview package ----------------------------------------------------------------------

_ROW_KEYS = ("id", "kind", "shape_kind", "x", "y", "w", "h", "rotation", "z_index", "color", "data",
             "locked", "created_at", "updated_at")


def build_package(asset: dict, rows: list[dict], root: Path, author: str, app_version: str) -> dict:
    shots: dict[str, str] = {}
    for r in rows:
        for sid in (r.get("data") or {}).get("shots") or []:
            p = shot_path(root, str(sid))
            if p and sid not in shots:
                mime = "image/jpeg" if p.suffix == ".jpg" else "image/png"
                shots[sid] = f"data:{mime};base64," + base64.b64encode(p.read_bytes()).decode("ascii")
    return {
        "format": PACKAGE_FORMAT,
        "version": PACKAGE_VERSION,
        "app": f"Sight {app_version}",
        "exported_at": int(time.time() * 1000),
        "author": author,
        "asset": {k: asset.get(k) for k in ("id", "name", "path", "ext", "kind", "size", "mtime", "width", "height", "duration")},
        "annotations": [{k: r.get(k) for k in _ROW_KEYS} for r in rows],
        "shots": shots,
    }


def parse_package(raw: bytes) -> dict:
    try:
        pkg = json.loads(raw.decode("utf-8-sig"))
    except Exception as e:
        raise ValueError("Not a Sight review file") from e
    if not isinstance(pkg, dict) or pkg.get("format") != PACKAGE_FORMAT:
        raise ValueError("Not a Sight review file")
    if int(pkg.get("version") or 0) > PACKAGE_VERSION:
        raise ValueError("This review file was made by a newer Sight")
    if not isinstance(pkg.get("annotations"), list) or not isinstance(pkg.get("asset"), dict):
        raise ValueError("Review file is incomplete")
    return pkg
