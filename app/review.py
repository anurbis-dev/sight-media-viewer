"""Review sessions on top of the per-asset annotations (see app/static/annotate.js).

- Screenshots: PNG/JPEG files in <SIGHT_HOME>/review_shots/<id>.<ext>, referenced from a note's
  data.shots list by id.
- PDF report: built here with PyMuPDF's Story (HTML layout -> paginated PDF), so any script the
  notes are written in (Cyrillic, CJK ...) renders with MuPDF's bundled fallback fonts.
- .srev package (legacy extension .sightreview): one JSON file holding the media's identity,
  every annotation row and the screenshots (base64), so a review can be mailed / sent by messenger
  and opened on another machine that has the same media file in its library.
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
PACKAGE_EXT = ".srev"  # files exported before 0.16.2 used ".sightreview"; both import
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


def put_shot(root: Path, sid: str, data: bytes) -> str:
    """Stores an imported screenshot under its original id (ids are random 64-bit, so the same id
    is the same picture): importing a package again does not copy its screenshots again. A
    package that uses other ids gets one derived from the picture's bytes — still stable across
    imports; the caller remaps data.shots with the returned id."""
    if not SHOT_ID.match(sid or ""):
        import hashlib

        sid = hashlib.sha1(data).hexdigest()[:16]
    if shot_path(root, sid) is None:
        ext = ".jpg" if data[:3] == b"\xff\xd8\xff" else ".png"
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
.prog { color: #c77c02; font-weight: bold; }
.reply { font-size: 9.5pt; margin: 0 0 4pt 10pt; padding: 0 0 0 6pt; border-left: 1.5pt solid #c7c7cc; }
.revent { font-size: 8.5pt; color: #6e6e73; margin: 0 0 4pt 10pt; padding: 0 0 0 6pt; border-left: 1.5pt solid #c7c7cc; }
img { display: block; margin: 4pt 0 2pt 0; }
.cap { color: #8e8e93; font-size: 7.5pt; margin: 0 0 4pt 0; }
"""

# Thread entries that record a note state change (see annotate.js statusEvent).
EVENT_LABEL = {"done": "Resolved", "progress": "In progress", "open": "Reopened"}

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
    text, status (open|progress|done), frame, shots: [id], frameCaption, replies: [{author, date, text,
    event, shots: [id]}]}]} — images
    are data URLs (cover/frame) or shot ids. Returns the page count."""
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
        elif n.get("status") == "progress":
            head.append('<span class="prog">In progress</span>')
        parts.append(f'<div class="note{" done" if done else ""}"><p class="head">{" &#160; ".join(head)}</p>')
        if n.get("text"):
            parts.append(f'<p class="text">{esc(n["text"])}</p>')
        for r in n.get("replies") or []:
            if r.get("event"):  # resolve / in progress / reopen entry in the thread
                label = EVENT_LABEL.get(r["event"], "Reopened")
                by = f" by {esc(r.get('author'))}" if r.get("author") else ""
                parts.append(f'<p class="revent">{label}{by} &#183; {esc(r.get("date"))}</p>')
                continue
            who = " &#183; ".join(esc(x) for x in (r.get("author"), r.get("date")) if x)
            text = f"<br/>{esc(r.get('text'))}" if r.get("text") else ""
            parts.append(f'<p class="reply"><span class="who">{who}</span>{text}</p>')
            for sid in r.get("shots") or []:
                shot = put_image(shot_bytes(str(sid)))
                if shot:
                    parts.append(_img_tag(*shot, max_h=200))
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


# ---- .srev package ----------------------------------------------------------------------------

_ROW_KEYS = ("id", "kind", "shape_kind", "x", "y", "w", "h", "rotation", "z_index", "color", "data",
             "locked", "created_at", "updated_at")


def build_package(asset: dict, rows: list[dict], root: Path, author: str, app_version: str,
                  deleted: list[dict] | None = None) -> dict:
    shots: dict[str, str] = {}
    def row_shots(d: dict) -> list:
        out = list(d.get("shots") or [])
        for x in d.get("replies") or []:  # pictures attached to replies
            if isinstance(x, dict) and not x.get("deleted"):
                out += list(x.get("shots") or [])
        return out

    for r in rows:
        for sid in row_shots(r.get("data") or {}):
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
        # Rows deleted since: merging the package deletes them on the other side too (unless
        # they were edited there after the delete). Older Sight versions ignore this key.
        "deleted": list(deleted or []),
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


# ---- HTML page for reviewers without Sight ------------------------------------------------------

def build_html(report: dict, pkg: dict) -> str:
    """One self-contained page: the report (cover, per-note frames, notes, replies, screenshots)
    plus the .srev package it came from. After giving their name the reviewer can reply (with
    pictures), mark notes in progress / resolved / reopened and add notes in the browser (kept in
    localStorage), then download an updated .srev that merges back in Sight
    (see Library.import_annotations). Everything is inline — no network access needed."""
    # "<" only occurs inside JSON strings, so \u003c is the same data and nothing in it can close
    # the <script> block or open a comment there.
    data = json.dumps({"report": report, "package": pkg}, ensure_ascii=False).replace("<", "\\u003c")
    title = html.escape(str(report.get("title") or "Review"))
    return _HTML_TEMPLATE.replace("%%TITLE%%", title).replace("%%DATA%%", data)


_HTML_TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>%%TITLE%%</title>
<style>
:root { --bg: #f5f5f7; --card: #fff; --fg: #1d1d1f; --muted: #6e6e73; --line: #d9d9de; --accent: #0a84ff; --red: #d0342c; --green: #2f9d5b; --amber: #d98200; --chip: #ececf0; }
@media (prefers-color-scheme: dark) { :root { --bg: #141416; --card: #1f1f23; --fg: #f2f2f0; --muted: #9a9aa2; --line: #34343a; --accent: #4c9aff; --amber: #f0a020; --chip: #2a2a30; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
[hidden] { display: none !important; }
.top { position: sticky; top: 0; z-index: 5; background: color-mix(in srgb, var(--bg) 90%, transparent); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); }
.top .in { max-width: 980px; margin: 0 auto; padding: 0 16px; }
.hd { display: flex; align-items: center; gap: 8px; width: 100%; border: 0; background: none; color: var(--fg); font: inherit; padding: 10px 0 4px; cursor: pointer; text-align: left; }
.hd h1 { flex: 1; min-width: 0; font-size: 17px; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hd .chev { flex: none; width: 28px; height: 28px; border-radius: 14px; display: grid; place-items: center; background: var(--chip); transition: transform .15s; }
.hd[aria-expanded="true"] .chev { transform: rotate(180deg); }
.details { padding: 4px 0 6px; max-height: 50vh; overflow: auto; }
.hist { margin-top: 10px; font-size: 12px; color: var(--muted); line-height: 1.6; }
.hist-h { font-weight: 600; color: var(--fg); }
.people { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); min-height: 24px; }
.people .from { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.people b { color: var(--fg); font-weight: 600; }
.me { flex: none; max-width: 55%; display: inline-flex; align-items: center; gap: 4px; border: 0; background: var(--chip); color: var(--muted); border-radius: 999px; padding: 2px 10px; font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.me b { overflow: hidden; text-overflow: ellipsis; }
.frow { display: flex; align-items: center; gap: 8px; padding: 12px 0 8px; }
.seg { flex: 1; min-width: 0; display: flex; background: var(--chip); border-radius: 9px; padding: 2px; }
.seg button { position: relative; flex: 1 1 auto; border: 0; background: none; color: var(--muted); padding: 5px 4px; border-radius: 7px; font: inherit; font-size: 13px; cursor: pointer; white-space: nowrap; }
.seg button.on { background: var(--card); color: var(--fg); box-shadow: 0 1px 2px rgb(0 0 0 / .15); }
.seg .cnt { position: absolute; top: -9px; right: 2px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: var(--muted); color: #fff; font-size: 10.5px; font-weight: 700; line-height: 18px; font-style: normal; text-align: center; box-shadow: 0 0 0 2px var(--bg); }
.seg .cnt.open { background: var(--red); }
.seg .cnt.progress { background: var(--amber); }
.seg .cnt.done { background: var(--green); }
.seg .cnt.zero { opacity: .45; }
.ib { flex: none; width: 34px; height: 34px; border-radius: 9px; border: 0; background: var(--chip); color: var(--fg); display: grid; place-items: center; cursor: pointer; }
.ib.on { background: var(--accent); color: #fff; }
.q { width: 100%; margin: 0 0 8px; }
main { max-width: 980px; margin: 0 auto; padding: 14px 16px 90px; }
.sub { color: var(--muted); font-size: 12px; word-break: break-all; margin: 0 0 8px; }
.meta { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; }
.meta span { background: var(--chip); border-radius: 999px; padding: 2px 10px; font-size: 12px; }
.meta b { font-weight: 600; color: var(--muted); margin-right: 4px; }
.cover { width: 100%; border-radius: 10px; display: block; cursor: zoom-in; background: #000; margin-bottom: 4px; }
input, textarea { font: inherit; color: var(--fg); background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; outline: none; }
input:focus, textarea:focus { border-color: var(--accent); }
.note { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; margin: 10px 0; }
.note.done { opacity: .7; }
.note.done .text { text-decoration: line-through; text-decoration-color: var(--muted); }
.nh { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; color: var(--muted); }
.num { min-width: 22px; height: 22px; border-radius: 11px; background: var(--red); color: #fff; display: inline-grid; place-items: center; font-weight: 700; font-size: 11px; padding: 0 6px; }
.progress .num { background: var(--amber); }
.done .num { background: var(--green); }
.ctx { color: var(--accent); font-weight: 600; font-variant-numeric: tabular-nums; }
.state { margin-left: auto; border-radius: 999px; padding: 1px 9px; background: var(--chip); font-weight: 600; }
.state.progress { color: var(--amber); }
.state.done { color: var(--green); }
.text { white-space: pre-wrap; word-break: break-word; margin: 6px 0; font-size: 15px; }
.frame { max-width: 100%; border-radius: 8px; display: block; margin: 8px 0 2px; cursor: zoom-in; }
.cap { font-size: 11px; color: var(--muted); }
.shots { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.shots img { height: 80px; max-width: 100%; border-radius: 6px; border: 1px solid var(--line); cursor: zoom-in; object-fit: cover; }
.replies { margin: 10px 0 0; padding-left: 12px; border-left: 2px solid var(--line); }
.rep { margin: 6px 0; position: relative; }
.rep .rh { font-size: 11px; color: var(--muted); }
.rep .rt { white-space: pre-wrap; word-break: break-word; }
.rep.mine .rh::after, .rep.ev.mine .el::after { content: " · not sent yet"; color: var(--accent); }
.rep.ev { font-size: 12px; color: var(--muted); }
.rep.ev.progress { color: var(--amber); }
.rep.ev.done { color: var(--green); }
.rep .x { position: absolute; right: -4px; top: -2px; width: 24px; height: 24px; border: 0; background: none; color: var(--muted); font-size: 16px; line-height: 1; cursor: pointer; border-radius: 12px; }
.rep.mine { padding-right: 22px; }
.acts { display: flex; gap: 6px; margin-top: 10px; }
.btn { border: 1px solid var(--line); background: var(--card); color: var(--fg); border-radius: 8px; padding: 5px 12px; font: inherit; font-size: 13px; cursor: pointer; }
.btn:hover { border-color: var(--accent); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn[disabled] { opacity: .45; cursor: default; }
/* Message field: full width, attach on the left and send (paper plane) in the bottom-right corner. */
.cmp { margin-top: 10px; }
.opts { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; font-size: 12px; color: var(--muted); }
.opt { border: 1px solid var(--line); background: var(--card); color: var(--fg); border-radius: 999px; padding: 3px 11px; font: inherit; font-size: 12px; cursor: pointer; }
.opt.on.progress { background: var(--amber); border-color: var(--amber); color: #fff; }
.opt.on.done { background: var(--green); border-color: var(--green); color: #fff; }
.opt.on.open { background: var(--accent); border-color: var(--accent); color: #fff; }
.field { position: relative; background: var(--card); border: 1px solid var(--line); border-radius: 18px; }
.field:focus-within { border-color: var(--accent); }
.field textarea { display: block; width: 100%; border: 0; background: none; resize: none; min-height: 40px; max-height: 40vh; padding: 9px 46px 9px 42px; border-radius: 18px; }
.field .atts { display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 10px 0; }
.field .atts span { position: relative; }
.field .atts img { height: 56px; border-radius: 8px; display: block; border: 1px solid var(--line); }
.field .atts button { position: absolute; right: -6px; top: -6px; width: 20px; height: 20px; border-radius: 10px; border: 0; background: #000; color: #fff; font-size: 13px; line-height: 20px; padding: 0; cursor: pointer; }
.clip, .send { position: absolute; bottom: 4px; width: 32px; height: 32px; border-radius: 16px; border: 0; display: grid; place-items: center; cursor: pointer; padding: 0; }
.clip { left: 5px; background: none; color: var(--muted); }
.send { right: 4px; background: var(--accent); color: #fff; }
.send[disabled] { background: var(--chip); color: var(--muted); cursor: default; }
.compose { background: var(--card); border: 1px dashed var(--line); border-radius: 12px; padding: 10px 12px 12px; margin: 16px 0; }
.compose .cmp { margin: 0; }
.compose h3 { display: flex; align-items: center; font-size: 13px; margin: 0 0 6px; color: var(--muted); font-weight: 600; }
.compose h3 span { flex: 1; }
.compose h3 button { width: 26px; height: 26px; border: 0; border-radius: 13px; background: none; color: var(--muted); font-size: 18px; line-height: 1; cursor: pointer; padding: 0; }
.add { flex: none; width: 36px; height: 36px; border-radius: 18px; border: 0; background: var(--accent); color: #fff; display: grid; place-items: center; cursor: pointer; padding: 0; }
.add.on { background: var(--chip); color: var(--accent); }
.foot { position: fixed; left: 0; right: 0; bottom: 0; z-index: 5; background: color-mix(in srgb, var(--card) 92%, transparent); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border-top: 1px solid var(--line); }
.foot div { max-width: 980px; margin: 0 auto; padding: 8px 16px calc(8px + env(safe-area-inset-bottom)); display: flex; align-items: center; gap: 8px; }
.foot span { flex: 1; min-width: 0; color: var(--muted); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.foot .btn { white-space: nowrap; }
.zoom { position: fixed; inset: 0; background: rgb(0 0 0 / .88); display: grid; place-items: center; cursor: zoom-out; z-index: 10; }
.zoom img { max-width: 96vw; max-height: 96vh; }
.gate { position: fixed; inset: 0; z-index: 20; background: rgb(0 0 0 / .55); display: grid; place-items: center; padding: 16px; }
.sheet { width: 100%; max-width: 360px; background: var(--card); border-radius: 16px; padding: 18px; box-shadow: 0 20px 60px rgb(0 0 0 / .35); }
.sheet h2 { font-size: 17px; margin: 0 0 4px; }
.sheet p { color: var(--muted); font-size: 13px; margin: 0 0 12px; }
.sheet input { width: 100%; font-size: 16px; padding: 9px 12px; margin-bottom: 12px; }
.sheet .acts { justify-content: flex-end; margin: 0; }
.empty { color: var(--muted); padding: 20px 0; }
.gen { font-size: 11px; color: var(--muted); text-align: center; margin-top: 30px; }
</style>
</head>
<body>
<header class="top"><div class="in">
<button class="hd" id="hd" type="button" aria-expanded="false" aria-controls="details" title="File and review details"><h1 id="ttl"></h1><span class="chev" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></span></button>
<div class="details" id="details" hidden></div>
<div class="people"><span class="from" id="from"></span><button class="me" id="me" type="button" title="Change your name">You: <b id="myname"></b> ✎</button></div>
<div class="frow"><div class="seg" id="seg"></div><button class="ib" id="sbtn" type="button" title="Search notes" aria-label="Search notes"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg></button></div>
<input class="q" id="q" type="search" placeholder="Search notes" hidden>
</div></header>
<main id="app"></main>
<div class="foot"><div><button class="add" id="add" type="button" title="New note" aria-label="New note"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button><span id="status"></span><button class="btn" id="reset" type="button">Discard</button><button class="btn primary" id="dl" type="button">Download reply</button></div></div>
<div class="gate" id="gate" hidden><form class="sheet" id="gform"><h2>Who is reviewing?</h2><p>Your name goes on every reply, picture and status change you make on this page.</p><input id="gname" autocomplete="name" placeholder="Your name" maxlength="80" required><div class="acts"><button class="btn" id="gcancel" type="button">Cancel</button><button class="btn primary" type="submit">Continue</button></div></form></div>
<script id="data" type="application/json">%%DATA%%</script>
<script>
(function(){
  "use strict";
  var D = JSON.parse(document.getElementById("data").textContent);
  var R = D.report, PKG = D.package;
  var KEY = "sight-review:" + (PKG.asset && PKG.asset.id) + ":" + PKG.exported_at;
  var rows = {};
  PKG.annotations.forEach(function(r){ rows[r.id] = r; });
  // Local edits, kept in localStorage until downloaded: {replies: {noteId: [entry]}, notes: [row],
  // att: {shotId: dataURL}}. An entry is a reply ({id, text, author, created, shots?}) or a state
  // change ({id, event: "progress"|"done"|"open", author, created}) — the shapes Sight writes, so
  // the thread keeps who did what and when. A note's state here is its last local change, else
  // the exported one.
  var E = { replies: {}, notes: [], att: {} };
  try { var saved = JSON.parse(localStorage.getItem(KEY)); if (saved && saved.replies) E = saved; } catch (e) {}
  E.att = E.att || {};
  var filter = "all", query = "", searchOn = false;
  var drafts = {}, openReply = {};  // unsent text / pictures / state per field (survive re-render)
  var newOpen = false, opening = null;  // the new-note form (one at a time); a field opened by this click
  var who = "";
  try { who = localStorage.getItem("sight-review:name") || ""; } catch (e) {}
  var STATES = { open: "Open", progress: "In progress", done: "Resolved" };
  var EV = { done: ["✓", "Resolved"], progress: ["▸", "In progress"], open: ["↺", "Reopened"] };
  var warned = false;
  function save(){
    try { localStorage.setItem(KEY, JSON.stringify(E)); }
    catch (e) { if (!warned){ warned = true; alert("This browser cannot keep that many pictures on the page. Download the reply now so nothing is lost."); } }
    paintFoot(); paintSeg();
  }
  function uid(){ var a = new Uint8Array(8); crypto.getRandomValues(a); return Array.prototype.map.call(a, function(b){ return ("0" + b.toString(16)).slice(-2); }).join(""); }
  function el(tag, cls, text){ var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function svg(path, w){ var s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("width", w || 18); s.setAttribute("height", w || 18); s.setAttribute("viewBox", "0 0 24 24"); s.innerHTML = path; return s; }
  function fmt(ms){ try { return new Date(ms).toLocaleString(); } catch (e) { return ""; } }
  function changes(){
    var n = E.notes.length;
    Object.keys(E.replies).forEach(function(k){ n += E.replies[k].length; });
    return n;
  }
  function origStatus(id){ return (rows[id] && rows[id].data.status) || "open"; }
  function statusOf(id){
    var L = E.replies[id] || [];
    for (var i = L.length - 1; i >= 0; i--) if (L[i].event) return L[i].event;
    return origStatus(id);
  }
  function zoom(src){
    var z = el("div", "zoom"); var i = el("img"); i.src = src; z.appendChild(i);
    z.onclick = function(){ z.remove(); };
    document.body.appendChild(z);
  }
  function shotSrc(sid){ return (PKG.shots || {})[sid] || E.att[sid] || ""; }
  function thumbs(list){
    var srcs = (list || []).map(shotSrc).filter(Boolean);
    if (!srcs.length) return null;
    var sh = el("div", "shots");
    srcs.forEach(function(s){ var i = el("img"); i.src = s; i.alt = ""; i.onclick = function(){ zoom(s); }; sh.appendChild(i); });
    return sh;
  }
  // Pictures are scaled down to 1600 px JPEG so the reply file and the page's storage stay small.
  function readImage(file){
    return new Promise(function(ok){
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function(){
        var k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
        var g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); ok(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = function(){ URL.revokeObjectURL(url); ok(null); };
      img.src = url;
    });
  }
  var coarse = window.matchMedia && matchMedia("(pointer: coarse)").matches;
  // One message field: text, pictures and (for a note) a state to set with it.
  // opts: {key, placeholder, status (current state, or null for a new note), onSend(text, shots, state)}.
  function composer(opts){
    var dr = drafts[opts.key] = drafts[opts.key] || { text: "", shots: [], state: "" };
    var box = el("div", "cmp"); box.dataset.key = opts.key;
    var send = el("button", "send"); send.type = "button"; send.title = "Send"; send.setAttribute("aria-label", "Send");
    send.appendChild(svg('<path d="M3.4 20.4 21 12 3.4 3.6 3.4 10.2 15 12 3.4 13.8z" fill="currentColor"/>', 17));
    function can(){ return !!(dr.text.trim() || dr.shots.length || dr.state); }
    function paint(){ send.disabled = !can(); }
    if (opts.status){
      var o = el("div", "opts"); o.appendChild(el("span", "", "Mark as"));
      ["progress", "done", "open"].forEach(function(s){
        if (s === opts.status) return;
        var b = el("button", "opt " + s + (dr.state === s ? " on" : ""), s === "open" ? "Reopen" : STATES[s]); b.type = "button";
        b.onclick = function(){ dr.state = dr.state === s ? "" : s; o.querySelectorAll(".opt").forEach(function(x){ x.classList.remove("on"); }); if (dr.state) b.classList.add("on"); paint(); };
        o.appendChild(b);
      });
      box.appendChild(o);
    }
    var f = el("div", "field");
    var atts = el("div", "atts");
    function paintAtts(){
      atts.textContent = ""; atts.hidden = !dr.shots.length;
      dr.shots.forEach(function(a, i){
        var s = el("span"), im = el("img"); im.src = a.src; im.alt = ""; s.appendChild(im);
        var x = el("button", "", "×"); x.type = "button"; x.title = "Remove picture";
        x.onclick = function(){ dr.shots.splice(i, 1); paintAtts(); paint(); };
        s.appendChild(x); atts.appendChild(s);
      });
    }
    var ta = el("textarea"); ta.rows = 1; ta.placeholder = opts.placeholder; ta.value = dr.text;
    function grow(){ ta.style.height = "auto"; ta.style.height = ta.scrollHeight + 2 + "px"; }
    ta.oninput = function(){ dr.text = ta.value; grow(); paint(); };
    ta.addEventListener("keydown", function(e){
      if (!coarse && e.key === "Enter" && !e.shiftKey && !e.isComposing){ e.preventDefault(); send.onclick(); }
      else if (e.key === "Escape" && !can()) closeEmpty(null);
    });
    var file = el("input"); file.type = "file"; file.accept = "image/*"; file.multiple = true; file.hidden = true;
    file.onchange = function(){
      var fs = Array.prototype.slice.call(file.files || []); file.value = "";
      Promise.all(fs.map(readImage)).then(function(list){
        list.forEach(function(src){ if (src) dr.shots.push({ id: uid(), src: src }); });
        paintAtts(); paint();
      });
    };
    var clip = el("button", "clip"); clip.type = "button"; clip.title = "Attach pictures"; clip.setAttribute("aria-label", "Attach pictures");
    clip.appendChild(svg('<path d="m20.5 11.5-8.3 8.3a5.2 5.2 0 0 1-7.4-7.4l8.6-8.6a3.5 3.5 0 0 1 4.9 4.9l-8.6 8.6a1.7 1.7 0 0 1-2.5-2.5l7.9-7.9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>', 19));
    clip.onclick = function(){ file.click(); };
    send.onclick = function(){
      if (!can()) return;
      dr.shots.forEach(function(a){ E.att[a.id] = a.src; });
      delete drafts[opts.key];  // before onSend: it re-renders, which would bring the draft back
      opts.onSend(dr.text.trim(), dr.shots.map(function(a){ return a.id; }), dr.state);
    };
    f.appendChild(atts); f.appendChild(ta); f.appendChild(clip); f.appendChild(send); f.appendChild(file);
    box.appendChild(f);
    paintAtts(); paint();
    requestAnimationFrame(grow);
    return box;
  }
  function entry(r){
    var mine = r.mine;
    if (r.event){
      var ev = EV[r.event] || EV.open;
      var d = el("div", "rep ev " + r.event + (mine ? " mine" : ""));
      d.appendChild(el("span", "el", ev[0] + " " + ev[1] + (r.author ? " by " + r.author : "") + (r.date ? " · " + r.date : "")));
      return d;
    }
    var d2 = el("div", "rep" + (mine ? " mine" : ""));
    d2.appendChild(el("div", "rh", [r.author, r.date].filter(Boolean).join(" · ")));
    if (r.text) d2.appendChild(el("div", "rt", r.text));
    var sh = thumbs(r.shots); if (sh) d2.appendChild(sh);
    return d2;
  }
  function noteCard(n, local){
    var id = n.id, st = local ? "open" : statusOf(id);
    var c = el("div", "note " + st);
    var h = el("div", "nh");
    h.appendChild(el("span", "num", local ? "+" : String(n.num)));
    if (n.ctx) h.appendChild(el("span", "ctx", n.ctx));
    h.appendChild(el("span", "", [n.author, n.date].filter(Boolean).join(" · ")));
    h.appendChild(el("span", "state " + st, local ? "New · not sent yet" : STATES[st] || "Open"));
    c.appendChild(h);
    if (n.text) c.appendChild(el("div", "text", n.text));
    if (n.frame){ var f = el("img", "frame"); f.src = n.frame; f.alt = ""; f.onclick = function(){ zoom(n.frame); }; c.appendChild(f); }
    if (n.frameCaption) c.appendChild(el("div", "cap", n.frameCaption));
    var sh = thumbs(n.shots); if (sh) c.appendChild(sh);
    var mineL = E.replies[id] || [];
    var reps = (n.replies || []).concat(mineL.map(function(r){ return { id: r.id, author: r.author, date: fmt(r.created), text: r.text, event: r.event, shots: r.shots, mine: true }; }));
    if (reps.length){
      var rb = el("div", "replies");
      reps.forEach(function(r){
        var d = entry(r);
        if (r.mine){
          var x = el("button", "x", "×"); x.type = "button"; x.title = "Remove (not sent yet)";
          x.onclick = function(){ E.replies[id] = mineL.filter(function(y){ return y.id !== r.id; }); if (!E.replies[id].length) delete E.replies[id]; save(); render(); };
          d.appendChild(x);
        }
        rb.appendChild(d);
      });
      c.appendChild(rb);
    }
    if (local){
      var del = el("button", "btn", "Remove");
      del.onclick = function(){ E.notes = E.notes.filter(function(x){ return x.id !== id; }); save(); render(); };
      var a0 = el("div", "acts"); a0.appendChild(del); c.appendChild(a0);
      return c;
    }
    if (openReply[id]){
      var cmp = composer({ key: id, placeholder: "Reply", status: st, onSend: function(text, shots, state){
        var L = E.replies[id] = E.replies[id] || [], now = Date.now();
        if (text || shots.length){ var r = { id: uid(), text: text, author: who, created: now }; if (shots.length) r.shots = shots; L.push(r); }
        if (state) L.push({ id: uid(), event: state, author: who, created: now + 1 });
        delete openReply[id];
        save(); render();
      } });
      c.appendChild(cmp);
      if (openReply[id] === "focus") focusLater(id, function(){ openReply[id] = true; });
    } else {
      var acts = el("div", "acts");
      var rbtn = el("button", "btn", "Reply");
      rbtn.onclick = function(){ opening = id; openReply[id] = "focus"; render(); };
      acts.appendChild(rbtn); c.appendChild(acts);
    }
    return c;
  }
  function render(){
    var app = document.getElementById("app");
    var keepY = window.scrollY;
    app.textContent = "";
    if (R.cover){ var cv = el("img", "cover"); cv.src = R.cover; cv.alt = ""; cv.onclick = function(){ zoom(R.cover); }; app.appendChild(cv); }
    var list = el("div", ""); list.id = "list"; app.appendChild(list);
    if (newOpen){
      var comp = el("div", "compose"), h3 = el("h3"), x = el("button", "", "×");
      h3.appendChild(el("span", "", "New note")); x.type = "button"; x.title = "Discard this note";
      x.onclick = function(){ newOpen = false; delete drafts["+new"]; render(); };
      h3.appendChild(x); comp.appendChild(h3);
      var nc = composer({ key: "+new", placeholder: "Add a new note…", status: null, onSend: function(text, shots){
        E.notes.push({ id: uid(), text: text, author: who, created: Date.now(), shots: shots });
        newOpen = false; save(); render();
      } });
      comp.appendChild(nc); app.appendChild(comp);
      if (newOpen === "focus") focusLater("+new", function(){ newOpen = true; });
    }
    document.getElementById("add").classList.toggle("on", !!newOpen);
    app.appendChild(el("p", "gen", "Made with " + (PKG.app || "Sight") + ". Download the reply and send the .srev file back — it opens on the same media in Sight."));
    renderList();
    paintFoot(); paintSeg();
    window.scrollTo(0, keepY);
  }
  // Focus a field once the current click is over: closing an empty field re-renders the page
  // again, so look the field up when it is time, not when it was built.
  function focusLater(key, done){
    requestAnimationFrame(function(){
      var ta = document.querySelector('.cmp[data-key="' + key + '"] textarea');
      if (ta){ ta.scrollIntoView({ block: "center" }); ta.focus(); }
      done();
    });
  }
  function stateOfShown(n){ return n.local ? "open" : statusOf(n.id); }
  function allNotes(){
    return (R.notes || []).concat(E.notes.map(function(n){ return { id: n.id, text: n.text, author: n.author, date: fmt(n.created), shots: n.shots, local: true }; }));
  }
  function renderList(){
    var list = document.getElementById("list");
    list.textContent = "";
    var ql = query.trim().toLowerCase();
    allNotes().filter(function(n){
      if (filter !== "all" && stateOfShown(n) !== filter) return false;
      if (!ql) return true;
      var hay = [n.text, n.author, n.ctx].concat((n.replies || []).map(function(r){ return r.text || ""; }), (E.replies[n.id] || []).map(function(r){ return r.text || ""; })).join(" ").toLowerCase();
      return hay.indexOf(ql) >= 0;
    }).forEach(function(n){ list.appendChild(noteCard(n, !!n.local)); });
    if (!list.childNodes.length) list.appendChild(el("p", "empty", "No notes here."));
  }
  function paintSeg(){
    var seg = document.getElementById("seg"), cnt = { all: 0, open: 0, progress: 0, done: 0 };
    allNotes().forEach(function(n){ cnt.all++; cnt[stateOfShown(n)] = (cnt[stateOfShown(n)] || 0) + 1; });
    seg.textContent = "";
    [["all", "All"], ["open", "Open"], ["progress", "In progress"], ["done", "Resolved"]].forEach(function(f){
      var b = el("button", filter === f[0] ? "on" : "", f[1]); b.type = "button";
      b.appendChild(el("i", "cnt " + f[0] + (cnt[f[0]] ? "" : " zero"), String(cnt[f[0]] || 0)));
      b.onclick = function(){ filter = f[0]; paintSeg(); renderList(); };
      seg.appendChild(b);
    });
  }
  function paintFoot(){
    var n = changes();
    document.getElementById("status").textContent = n ? n + " change" + (n > 1 ? "s" : "") : "No changes yet";
    document.getElementById("dl").disabled = !n;
    document.getElementById("reset").hidden = !n;
  }
  function download(){
    var now = Date.now(), used = {};
    var out = JSON.parse(JSON.stringify(PKG));
    out.author = who; out.exported_at = now; out.app = (PKG.app || "Sight") + " (web reply)";
    out.shots = out.shots || {};
    function keep(list){ (list || []).forEach(function(s){ if (E.att[s]){ out.shots[s] = E.att[s]; used[s] = 1; } }); }
    // Replies and the note state carry their own stamps (merged on their own in Sight), so the
    // note's updated_at stays as exported: answering must not make this copy of the note's text
    // win over edits made in Sight since.
    out.annotations.forEach(function(r){
      if (r.kind !== "note") return;
      var L = E.replies[r.id];
      if (!L || !L.length) return;
      r.data.replies = (r.data.replies || []).concat(L);
      L.forEach(function(x){ keep(x.shots); });
      var evs = L.filter(function(x){ return x.event; });
      if (evs.length){ var last = evs[evs.length - 1]; r.data.status = last.event; r.data.status_at = last.created; }
    });
    E.notes.forEach(function(n){
      keep(n.shots);
      out.annotations.push({ id: n.id, kind: "note", shape_kind: null, x: null, y: null, w: null, h: null, rotation: 0, z_index: 0, color: null,
        data: { text: n.text, author: n.author, created: n.created, status: "open", ctx: null, shots: n.shots || [] }, locked: 0, created_at: n.created, updated_at: n.created });
    });
    var name = ((PKG.asset && PKG.asset.name) || "review").replace(/\.[^.]+$/, "") + " review" + (who ? " - " + who : "") + ".srev";
    var blob = new Blob([JSON.stringify(out)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name.replace(/[\\/:*?"<>|]+/g, "_");
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 5000);
  }
  function header(){
    document.getElementById("ttl").textContent = R.title || "Review";
    var det = document.getElementById("details"), hd = document.getElementById("hd");
    if (R.subtitle) det.appendChild(el("p", "sub", R.subtitle));
    var meta = el("div", "meta"), sender = PKG.author || "";
    (R.meta || []).forEach(function(m){
      if (m[0] === "Reviewer"){ sender = sender || m[1] || ""; return; }  // shown under the title instead
      if (m[1] === "" || m[1] == null) return;
      var s = el("span"); s.appendChild(el("b", "", m[0])); s.appendChild(document.createTextNode(m[1])); meta.appendChild(s);
    });
    det.appendChild(meta);
    var from = document.getElementById("from");
    if (sender){ from.appendChild(document.createTextNode("From ")); from.appendChild(el("b", "", sender)); }
    var day = ""; try { day = new Date(PKG.exported_at).toLocaleDateString(undefined, { day: "numeric", month: "short" }); } catch (e) {}
    if (day) from.appendChild(document.createTextNode((sender ? " · " : "Sent ") + day));
    // Who set the review state and when (Library.set_review_status keeps the history), newest first.
    var st = PKG.annotations.filter(function(r){ return r.kind === "status"; }).sort(function(a, b){ return (b.updated_at || 0) - (a.updated_at || 0); })[0];
    var hist = (st && st.data && Array.isArray(st.data.history)) ? st.data.history.slice().reverse()
      : (st && st.data && st.data.state) ? [{ state: st.data.state, author: st.data.author, at: st.data.at || st.updated_at }] : [];
    if (hist.length){
      var hb = el("div", "hist");
      hb.appendChild(el("div", "hist-h", "Review state history"));
      var names = { review: "Needs review", changes: "Changes requested", approved: "Approved" };
      hist.forEach(function(h){ hb.appendChild(el("div", "", (names[h.state] || "Cleared") + (h.author ? " by " + h.author : "") + " · " + fmt(h.at))); });
      det.appendChild(hb);
    }
    hd.onclick = function(){ var open = det.hidden; det.hidden = !open; hd.setAttribute("aria-expanded", String(open)); };
  }
  // Nothing can be done on the page until the reviewer has said who they are.
  function paintMe(){ document.getElementById("myname").textContent = who || "—"; }
  function askName(){
    var g = document.getElementById("gate"), inp = document.getElementById("gname");
    inp.value = who; g.hidden = false;
    document.getElementById("gcancel").hidden = !who;
    setTimeout(function(){ inp.focus(); }, 30);
  }
  document.getElementById("gform").onsubmit = function(e){
    e.preventDefault();
    var v = document.getElementById("gname").value.trim();
    if (!v) return;
    who = v; try { localStorage.setItem("sight-review:name", who); } catch (x) {}
    document.getElementById("gate").hidden = true; paintMe();
  };
  document.getElementById("gcancel").onclick = function(){ if (who) document.getElementById("gate").hidden = true; };
  document.getElementById("me").onclick = askName;
  var sb = document.getElementById("sbtn"), q = document.getElementById("q");
  sb.onclick = function(){
    searchOn = !searchOn; q.hidden = !searchOn; sb.classList.toggle("on", searchOn);
    if (searchOn) q.focus(); else if (query){ query = ""; q.value = ""; renderList(); }
  };
  q.oninput = function(){ query = q.value; renderList(); };
  header();
  paintMe();
  document.getElementById("dl").onclick = download;
  // The new-note form shows only after the + in the bottom bar (one at a time; + again jumps to it).
  document.getElementById("add").onclick = function(){ opening = "+new"; newOpen = "focus"; render(); };
  // An empty field (no text, picture or state) is a cancel: a tap anywhere else closes it. Runs
  // after the tap's own handler, so a field that tap just opened (`opening`) stays.
  function isEmpty(k){ var d = drafts[k]; return !d || !(d.text.trim() || d.shots.length || d.state); }
  function closeEmpty(target){
    var changed = false;
    function inside(k){ var b = document.querySelector('.cmp[data-key="' + k + '"]'); var w = b && (b.closest(".compose") || b); return !!(target && w && w.contains(target)); }
    Object.keys(openReply).forEach(function(k){
      if (k === opening || inside(k) || !isEmpty(k)) return;
      delete openReply[k]; delete drafts[k]; changed = true;
    });
    if (newOpen && opening !== "+new" && !inside("+new") && isEmpty("+new")){ newOpen = false; delete drafts["+new"]; changed = true; }
    opening = null;
    if (changed) render();
  }
  document.addEventListener("click", function(e){
    if (!document.getElementById("gate").hidden || e.target.closest(".zoom")){ opening = null; return; }
    closeEmpty(e.target);
  });
  document.getElementById("reset").onclick = function(){ if (confirm("Discard your replies, pictures, status changes and new notes on this page?")){ E = { replies: {}, notes: [], att: {} }; drafts = {}; openReply = {}; newOpen = false; save(); render(); } };
  render();
  if (!who) askName();
})();
</script>
</body>
</html>
"""
