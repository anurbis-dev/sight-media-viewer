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
.reply { font-size: 9.5pt; margin: 0 0 4pt 10pt; padding: 0 0 0 6pt; border-left: 1.5pt solid #c7c7cc; }
.revent { font-size: 8.5pt; color: #6e6e73; margin: 0 0 4pt 10pt; padding: 0 0 0 6pt; border-left: 1.5pt solid #c7c7cc; }
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
    text, status, frame, shots: [id], frameCaption, replies: [{author, date, text, event}]}]} — images
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
        parts.append(f'<div class="note{" done" if done else ""}"><p class="head">{" &#160; ".join(head)}</p>')
        if n.get("text"):
            parts.append(f'<p class="text">{esc(n["text"])}</p>')
        for r in n.get("replies") or []:
            if r.get("event"):  # resolve / reopen entry in the thread
                label = "Resolved" if r["event"] == "done" else "Reopened"
                by = f" by {esc(r.get('author'))}" if r.get("author") else ""
                parts.append(f'<p class="revent">{label}{by} &#183; {esc(r.get("date"))}</p>')
                continue
            who = " &#183; ".join(esc(x) for x in (r.get("author"), r.get("date")) if x)
            parts.append(f'<p class="reply"><span class="who">{who}</span><br/>{esc(r.get("text"))}</p>')
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
    plus the .srev package it came from. The reviewer can reply, resolve / reopen and add notes in
    the browser (kept in localStorage), then download an updated .srev that merges back in Sight
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
:root { --bg: #f5f5f7; --card: #fff; --fg: #1d1d1f; --muted: #6e6e73; --line: #d9d9de; --accent: #0a84ff; --red: #d0342c; --green: #2f9d5b; --chip: #ececf0; }
@media (prefers-color-scheme: dark) { :root { --bg: #141416; --card: #1f1f23; --fg: #f2f2f0; --muted: #9a9aa2; --line: #34343a; --accent: #4c9aff; --chip: #2a2a30; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
.top { position: sticky; top: 0; z-index: 5; background: color-mix(in srgb, var(--bg) 90%, transparent); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); }
.top .in { max-width: 980px; margin: 0 auto; padding: 0 16px; }
.hd { display: flex; align-items: center; gap: 8px; width: 100%; border: 0; background: none; color: var(--fg); font: inherit; padding: 10px 0; cursor: pointer; text-align: left; }
.hd h1 { flex: 1; min-width: 0; font-size: 17px; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hd .chev { flex: none; width: 28px; height: 28px; border-radius: 14px; display: grid; place-items: center; background: var(--chip); transition: transform .15s; }
.hd[aria-expanded="true"] .chev { transform: rotate(180deg); }
.details { padding: 0 0 10px; max-height: 55vh; overflow: auto; }
.details[hidden] { display: none; }
.hist { margin-top: 10px; font-size: 12px; color: var(--muted); line-height: 1.6; }
.hist-h { font-weight: 600; color: var(--fg); }
main { max-width: 980px; margin: 0 auto; padding: 14px 16px 90px; }
.sub { color: var(--muted); font-size: 12px; word-break: break-all; margin: 0 0 8px; }
.meta { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; }
.meta span { background: var(--chip); border-radius: 999px; padding: 2px 10px; font-size: 12px; }
.meta b { font-weight: 600; color: var(--muted); margin-right: 4px; }
.cover { width: 100%; border-radius: 10px; display: block; cursor: zoom-in; background: #000; }
.bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 18px 0 10px; }
.seg { display: inline-flex; background: var(--chip); border-radius: 8px; padding: 2px; }
.seg button { border: 0; background: none; color: var(--muted); padding: 4px 12px; border-radius: 6px; font: inherit; font-size: 13px; cursor: pointer; }
.seg button.on { background: var(--card); color: var(--fg); box-shadow: 0 1px 2px rgb(0 0 0 / .15); }
input, textarea { font: inherit; color: var(--fg); background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; outline: none; }
input:focus, textarea:focus { border-color: var(--accent); }
.who { width: 180px; }
.q { flex: 1; min-width: 140px; }
.note { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; margin: 10px 0; }
.note.done { opacity: .7; }
.note.done .text { text-decoration: line-through; text-decoration-color: var(--muted); }
.nh { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; color: var(--muted); }
.num { min-width: 22px; height: 22px; border-radius: 11px; background: var(--red); color: #fff; display: inline-grid; place-items: center; font-weight: 700; font-size: 11px; padding: 0 6px; }
.done .num { background: var(--green); }
.ctx { color: var(--accent); font-weight: 600; font-variant-numeric: tabular-nums; }
.state { margin-left: auto; }
.text { white-space: pre-wrap; word-break: break-word; margin: 6px 0; font-size: 15px; }
.frame { max-width: 100%; border-radius: 8px; display: block; margin: 8px 0 2px; cursor: zoom-in; }
.cap { font-size: 11px; color: var(--muted); }
.shots { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.shots img { height: 80px; border-radius: 6px; border: 1px solid var(--line); cursor: zoom-in; }
.replies { margin: 10px 0 0; padding-left: 12px; border-left: 2px solid var(--line); }
.rep { margin: 6px 0; }
.rep .rh { font-size: 11px; color: var(--muted); }
.rep .rt { white-space: pre-wrap; word-break: break-word; }
.rep.mine .rh::after, .rep.ev.mine::after { content: " · not sent yet"; color: var(--accent); }
.rep.ev { font-size: 12px; color: var(--muted); }
.rep.ev.done { color: var(--green); }
.acts { display: flex; gap: 6px; margin-top: 10px; }
.btn { border: 1px solid var(--line); background: var(--card); color: var(--fg); border-radius: 8px; padding: 5px 12px; font: inherit; font-size: 13px; cursor: pointer; }
.btn:hover { border-color: var(--accent); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn[disabled] { opacity: .45; cursor: default; }
.rbox { display: flex; gap: 6px; margin-top: 8px; }
.rbox textarea { flex: 1; min-height: 38px; resize: vertical; }
.compose { background: var(--card); border: 1px dashed var(--line); border-radius: 12px; padding: 12px 14px; margin: 16px 0; }
.compose textarea { width: 100%; min-height: 60px; resize: vertical; }
.compose .acts { justify-content: flex-end; }
.foot { position: fixed; left: 0; right: 0; bottom: 0; background: color-mix(in srgb, var(--card) 92%, transparent); backdrop-filter: blur(10px); border-top: 1px solid var(--line); }
.foot div { max-width: 980px; margin: 0 auto; padding: 8px 16px calc(8px + env(safe-area-inset-bottom)); display: flex; align-items: center; gap: 8px; }
.foot span { flex: 1; min-width: 0; color: var(--muted); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.foot .btn { white-space: nowrap; }
.zoom { position: fixed; inset: 0; background: rgb(0 0 0 / .88); display: grid; place-items: center; cursor: zoom-out; z-index: 10; }
.zoom img { max-width: 96vw; max-height: 96vh; }
.empty { color: var(--muted); padding: 20px 0; }
.gen { font-size: 11px; color: var(--muted); text-align: center; margin-top: 30px; }
</style>
</head>
<body>
<header class="top"><div class="in">
<button class="hd" id="hd" type="button" aria-expanded="false" aria-controls="details" title="File and review details"><h1 id="ttl"></h1><span class="chev" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></span></button>
<div class="details" id="details" hidden></div>
</div></header>
<main id="app"></main>
<div class="foot"><div><span id="status"></span><button class="btn" id="reset" type="button">Discard</button><button class="btn primary" id="dl" type="button">Download reply</button></div></div>
<script id="data" type="application/json">%%DATA%%</script>
<script>
(function(){
  "use strict";
  var D = JSON.parse(document.getElementById("data").textContent);
  var R = D.report, PKG = D.package;
  var KEY = "sight-review:" + (PKG.asset && PKG.asset.id) + ":" + PKG.exported_at;
  var rows = {};
  PKG.annotations.forEach(function(r){ rows[r.id] = r; });
  // Local edits: {replies: {noteId: [reply | status event]}, status: {noteId: "open"|"done"}, notes: [row]}.
  // Resolve / reopen is also kept as an entry in the note's thread ({id, event, author, created}),
  // the same shape Sight writes, so the history says who changed the state and when.
  var E = { replies: {}, status: {}, notes: [] };
  try { var saved = JSON.parse(localStorage.getItem(KEY)); if (saved) E = saved; } catch (e) {}
  var filter = "all", query = "";
  var who = localStorage.getItem("sight-review:name") || "";
  function save(){ try { localStorage.setItem(KEY, JSON.stringify(E)); } catch (e) {} paintFoot(); }
  function uid(){ var a = new Uint8Array(8); crypto.getRandomValues(a); return Array.prototype.map.call(a, function(b){ return ("0" + b.toString(16)).slice(-2); }).join(""); }
  function el(tag, cls, text){ var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function fmt(ms){ try { return new Date(ms).toLocaleString(); } catch (e) { return ""; } }
  function hasEvent(k){ return (E.replies[k] || []).some(function(r){ return r.event; }); }
  function changes(){
    var n = E.notes.length;
    Object.keys(E.replies).forEach(function(k){ n += E.replies[k].length; });
    Object.keys(E.status).forEach(function(k){ if (rows[k] && (rows[k].data.status || "open") !== E.status[k] && !hasEvent(k)) n++; });
    return n;
  }
  function statusOf(id){ return E.status[id] || (rows[id] && rows[id].data.status) || "open"; }
  function zoom(src){
    var z = el("div", "zoom"); var i = el("img"); i.src = src; z.appendChild(i);
    z.onclick = function(){ z.remove(); };
    document.body.appendChild(z);
  }
  function shotSrc(sid){ return (PKG.shots || {})[sid] || ""; }
  function noteCard(n, local){
    var id = n.id, st = local ? "open" : statusOf(id);
    var c = el("div", "note" + (st === "done" ? " done" : ""));
    var h = el("div", "nh");
    h.appendChild(el("span", "num", local ? "+" : String(n.num)));
    if (n.ctx) h.appendChild(el("span", "ctx", n.ctx));
    h.appendChild(el("span", "", [n.author, n.date].filter(Boolean).join(" · ")));
    if (!local) h.appendChild(el("span", "state", st === "done" ? "Resolved" : "Open"));
    else h.appendChild(el("span", "state", "New · not sent yet"));
    c.appendChild(h);
    if (n.text) c.appendChild(el("div", "text", n.text));
    if (n.frame){ var f = el("img", "frame"); f.src = n.frame; f.alt = ""; f.onclick = function(){ zoom(n.frame); }; c.appendChild(f); }
    if (n.frameCaption) c.appendChild(el("div", "cap", n.frameCaption));
    var shots = (n.shots || []).map(shotSrc).filter(Boolean);
    if (shots.length){
      var sh = el("div", "shots");
      shots.forEach(function(s){ var i = el("img"); i.src = s; i.alt = ""; i.onclick = function(){ zoom(s); }; sh.appendChild(i); });
      c.appendChild(sh);
    }
    var reps = (n.replies || []).concat((E.replies[id] || []).map(function(r){ return { author: r.author, date: fmt(r.created), text: r.text, event: r.event, mine: true }; }));
    if (reps.length){
      var rb = el("div", "replies");
      reps.forEach(function(r){
        if (r.event){
          var label = (r.event === "done" ? "✓ Resolved" : "↺ Reopened") + (r.author ? " by " + r.author : "") + (r.date ? " · " + r.date : "");
          rb.appendChild(el("div", "rep ev" + (r.event === "done" ? " done" : "") + (r.mine ? " mine" : ""), label));
          return;
        }
        var d = el("div", "rep" + (r.mine ? " mine" : ""));
        d.appendChild(el("div", "rh", [r.author, r.date].filter(Boolean).join(" · ")));
        d.appendChild(el("div", "rt", r.text));
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
    var acts = el("div", "acts");
    var rbtn = el("button", "btn", "Reply");
    var sbtn = el("button", "btn", st === "done" ? "Reopen" : "Resolve");
    sbtn.onclick = function(){
      var orig = (rows[id] && rows[id].data.status) || "open", next = st === "done" ? "open" : "done";
      var L = E.replies[id] = E.replies[id] || [], last = L[L.length - 1];
      // Undoing an unsent toggle drops its entry instead of logging a second one.
      if (next === orig && last && last.event) L.pop();
      else L.push({ id: uid(), event: next, author: who, created: Date.now() });
      if (!L.length) delete E.replies[id];
      if (next === orig) delete E.status[id]; else E.status[id] = next;
      save(); render();
    };
    rbtn.onclick = function(){
      if (c.querySelector(".rbox")) return;
      var box = el("div", "rbox"), ta = el("textarea"); ta.placeholder = "Your reply";
      var send = el("button", "btn primary", "Add");
      send.onclick = function(){
        var t = ta.value.trim(); if (!t) return;
        (E.replies[id] = E.replies[id] || []).push({ id: uid(), text: t, author: who, created: Date.now() });
        save(); render();
      };
      ta.addEventListener("keydown", function(e){ if (e.key === "Enter" && !e.shiftKey){ e.preventDefault(); send.onclick(); } });
      box.appendChild(ta); box.appendChild(send); c.appendChild(box); ta.focus();
    };
    acts.appendChild(rbtn); acts.appendChild(sbtn); c.appendChild(acts);
    return c;
  }
  function render(){
    var app = document.getElementById("app");
    var keepY = window.scrollY;
    app.textContent = "";
    if (R.cover){ var cv = el("img", "cover"); cv.src = R.cover; cv.alt = ""; cv.onclick = function(){ zoom(R.cover); }; app.appendChild(cv); }
    var bar = el("div", "bar");
    var seg = el("div", "seg");
    [["all", "All"], ["open", "Open"], ["done", "Resolved"]].forEach(function(f){
      var b = el("button", filter === f[0] ? "on" : "", f[1]);
      b.onclick = function(){ filter = f[0]; render(); };
      seg.appendChild(b);
    });
    bar.appendChild(seg);
    var q = el("input", "q"); q.placeholder = "Search notes"; q.value = query;
    q.oninput = function(){ query = q.value; renderList(); };
    bar.appendChild(q);
    var w = el("input", "who"); w.placeholder = "Your name"; w.value = who;
    w.onchange = function(){ who = w.value.trim(); try { localStorage.setItem("sight-review:name", who); } catch (e) {} };
    bar.appendChild(w);
    app.appendChild(bar);
    var list = el("div", ""); list.id = "list"; app.appendChild(list);
    var comp = el("div", "compose");
    var ta = el("textarea"); ta.placeholder = "Add a new note…";
    var add = el("button", "btn primary", "Add note");
    add.onclick = function(){
      var t = ta.value.trim(); if (!t) return;
      E.notes.push({ id: uid(), text: t, author: who, created: Date.now() });
      save(); render();
    };
    var ca = el("div", "acts"); ca.appendChild(add);
    comp.appendChild(ta); comp.appendChild(ca);
    app.appendChild(comp);
    app.appendChild(el("p", "gen", "Made with " + (PKG.app || "Sight") + ". Download the reply and send the .srev file back — it opens on the same media in Sight."));
    renderList();
    paintFoot();
    window.scrollTo(0, keepY);
  }
  function renderList(){
    var list = document.getElementById("list");
    list.textContent = "";
    var ql = query.toLowerCase();
    var shown = (R.notes || []).filter(function(n){
      var st = statusOf(n.id);
      if (filter !== "all" && st !== filter) return false;
      if (!ql) return true;
      var hay = [n.text, n.author, n.ctx].concat((n.replies || []).map(function(r){ return r.text || ""; })).join(" ").toLowerCase();
      return hay.indexOf(ql) >= 0;
    });
    shown.forEach(function(n){ list.appendChild(noteCard(n, false)); });
    if (filter !== "done") E.notes.forEach(function(n){ list.appendChild(noteCard({ id: n.id, text: n.text, author: n.author, date: fmt(n.created) }, true)); });
    if (!list.childNodes.length) list.appendChild(el("p", "empty", "No notes here."));
  }
  function paintFoot(){
    var n = changes();
    document.getElementById("status").textContent = n ? n + " change" + (n > 1 ? "s" : "") : "No changes yet";
    document.getElementById("dl").disabled = !n;
    document.getElementById("reset").hidden = !n;
  }
  function download(){
    var now = Date.now();
    var out = JSON.parse(JSON.stringify(PKG));
    out.author = who; out.exported_at = now; out.app = (PKG.app || "Sight") + " (web reply)";
    // Replies and the open/done state carry their own stamps (merged on their own in Sight), so
    // the note's updated_at stays as exported: answering must not make this copy of the note's
    // text win over edits made in Sight since.
    out.annotations.forEach(function(r){
      if (r.kind !== "note") return;
      if (E.replies[r.id] && E.replies[r.id].length) r.data.replies = (r.data.replies || []).concat(E.replies[r.id]);
      if (E.status[r.id] && E.status[r.id] !== (r.data.status || "open")){ r.data.status = E.status[r.id]; r.data.status_at = now; }
    });
    E.notes.forEach(function(n){
      out.annotations.push({ id: n.id, kind: "note", shape_kind: null, x: null, y: null, w: null, h: null, rotation: 0, z_index: 0, color: null,
        data: { text: n.text, author: n.author, created: n.created, status: "open", ctx: null, shots: [] }, locked: 0, created_at: n.created, updated_at: n.created });
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
    var meta = el("div", "meta");
    (R.meta || []).forEach(function(m){ if (m[1] === "" || m[1] == null) return; var s = el("span"); s.appendChild(el("b", "", m[0])); s.appendChild(document.createTextNode(m[1])); meta.appendChild(s); });
    det.appendChild(meta);
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
  header();
  document.getElementById("dl").onclick = download;
  document.getElementById("reset").onclick = function(){ if (confirm("Discard your replies, status changes and new notes on this page?")){ E = { replies: {}, status: {}, notes: [] }; save(); render(); } };
  render();
})();
</script>
</body>
</html>
"""
