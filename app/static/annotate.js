// Annotations / review session for the lightbox — vector drawings on top of an image, a video frame
// or a 3D view, plus a side panel of review notes with screenshots, exportable as PDF or as a
// .srev review package (see app/review.py).
//
// Self-contained ES module (zero-build): index.html creates one annotator with createAnnotator()
// and drives it from the lightbox (mount/unmount, setAsset, bind2d/bind3d, onKey).
//
// Data: one row of the `annotations` table per object (scope='asset', target_asset_id = the asset),
// written through /api/annotations. Client ids are 16 hex chars so undo can revive a deleted row
// under the same id and drawings can point at their note (data.note).
//   kind 'stroke'  shape_kind brush | pencil | marker   data.pts = [x, y, pressure, ...]
//   kind 'shape'   shape_kind rect | ellipse | line | arrow
//   kind 'text', kind 'pin' (numbered callout), kind 'note' (the review comment itself)
// Geometry lives in "doc" units: image/video pixels; for 3D, screen space normalised to a viewport
// 1000 units high, centred (a perspective camera keeps its vertical fov, so this survives resizes).
// Context (data.ctx): video {t, hold} — visible around time t; 3D {vk, cam} — visible while the
// camera matches that view; images: none (always visible).

import { hotkey, runHotkeys } from "/static/keys.js";
// Primitives, rendering, hit tests and the merge rules are shared with the HTML page and the
// mobile app (review-core.js, a plain script that sets globalThis.SightReviewCore; docs/FORMAT.md).
import "/static/review-core.js";
const RC = globalThis.SightReviewCore;
const { STROKE_TOOLS, FONTS, uid, clamp, r2, hyp, typeOf, esc, fontStack, textLayout,
  primsOf, primSvg, boundsOf, hitTest, transformItem, validItem } = RC;

const SVGNS = "http://www.w3.org/2000/svg";
const ico = (body) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICON = {
  select: ico(`<path d="M5 3l13 7.5-5.6 1.6L9.6 18z"/><path d="M12.4 12.1 17 19"/>`),
  brush: ico(`<path d="M19.5 3.5a2.1 2.1 0 0 1 3 3L13 16l-3-3z"/><path d="M10 13c-3 0-4.5 2-4.5 4.2 0 1.4-1 2.3-2.5 2.8 5 1.2 9.5-.2 9.5-4.3z"/>`),
  pencil: ico(`<path d="M4 20l1-4.5L16 4.5a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="M14 6.5l3 3"/>`),
  marker: ico(`<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>`),
  eraser: ico(`<path d="M8 20h12"/><path d="M5.2 14.8 14 6a2 2 0 0 1 2.8 0l2.8 2.8a2 2 0 0 1 0 2.8L11.2 20H8.4l-3.2-3.2a1.4 1.4 0 0 1 0-2z"/><path d="m9.5 10.5 5 5"/>`),
  line: ico(`<path d="M5 19 19 5"/>`),
  arrow: ico(`<path d="M5 19 19 5"/><path d="M10 5h9v9"/>`),
  rect: ico(`<rect x="4" y="6" width="16" height="12" rx="2"/>`),
  ellipse: ico(`<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>`),
  text: ico(`<path d="M5 7V5h14v2"/><path d="M12 5v14"/><path d="M9 19h6"/>`),
  pin: ico(`<path d="M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z"/><path d="M11 8h1.5v5"/>`),
  undo: ico(`<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>`),
  redo: ico(`<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>`),
  shot: ico(`<path d="M14.5 5h-5L8 7H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.5"/>`),
  region: ico(`<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><rect x="8" y="8" width="8" height="8" rx="1" stroke-dasharray="2 2"/>`),
  eye: ico(`<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>`),
  eyeOff: ico(`<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>`),
  panel: ico(`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/><path d="M17.5 8h1M17.5 11h1"/>`),
  onion: ico(`<circle cx="8" cy="12" r="5" opacity=".45"/><circle cx="16" cy="12" r="5" opacity=".45"/><circle cx="12" cy="12" r="5"/>`),
  annotate: ico(`<path d="M4 20l1-4.5L16 4.5a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="M14 20h6"/>`),
  close: ico(`<path d="M6 6l12 12M18 6 6 18"/>`),
  check: ico(`<path d="m5 12.5 4.5 4.5L19 7.5"/>`),
  prog: ico(`<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>`),
  trash: ico(`<path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13"/>`),
  reply: ico(`<path d="M10 8 5 12.5l5 4.5"/><path d="M5 12.5h9a5 5 0 0 1 5 5V19"/>`),
  view: ico(`<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/><circle cx="12" cy="12" r="3"/>`),
};

// [id, combo, label, icon]
const TOOLS = [
  ["select", "KeyV", "Select / move", ICON.select],
  ["brush", "KeyB", "Brush — pen pressure", ICON.brush],
  ["pencil", "KeyP", "Pencil", ICON.pencil],
  ["marker", "KeyM", "Highlighter", ICON.marker],
  ["eraser", "KeyE", "Eraser — or hold Ctrl with any tool", ICON.eraser],
  null,
  ["line", "KeyL", "Line — Shift snaps to 15°", ICON.line],
  ["arrow", "KeyW", "Arrow — Shift snaps to 15°", ICON.arrow],
  ["rect", "KeyR", "Rectangle — Shift square, Alt from centre", ICON.rect],
  ["ellipse", "KeyO", "Ellipse — Shift circle, Alt from centre", ICON.ellipse],
  ["text", "KeyT", "Text", ICON.text],
  ["pin", "KeyN", "Numbered pin", ICON.pin],
];
const SWATCHES = ["#ff3b30", "#ff9500", "#ffd60a", "#34c759", "#32ade6", "#3478f6", "#af52de", "#ffffff", "#111111"];
const HEADS = [["none", "—"], ["triangle", "▶"], ["open", "›"], ["diamond", "◆"], ["dot", "●"], ["bar", "|"]];
const BODIES = [["straight", "Straight"], ["curve", "Curve"], ["elbow", "Elbow"]];
const DASHES = [["solid", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"]];
const HOLDS = [[0, "1 frame"], [0.5, "0.5 s"], [1, "1 s"], [2, "2 s"], [-1, "Whole clip"]];

// Sizes in tool styles are screen pixels at the moment of drawing (what you see is what you get);
// they are converted to doc units when an object is created.
const DEFAULT_STYLES = {
  brush: { color: "#ff3b30", size: 8, opacity: 1, pressure: true, smooth: 0.5 },
  pencil: { color: "#ff3b30", size: 2.5, opacity: 1, pressure: true, smooth: 0.15 },
  marker: { color: "#ffd60a", size: 26, opacity: 0.4, smooth: 0.5 },
  eraser: { size: 26, mode: "object" },
  line: { color: "#ff3b30", width: 4, opacity: 1, dash: "solid", head0: "none", head1: "none", body: "straight", headSize: 1 },
  arrow: { color: "#ff3b30", width: 4, opacity: 1, dash: "solid", head0: "none", head1: "triangle", body: "straight", headSize: 1 },
  rect: { color: "#ff3b30", strokeOn: true, width: 4, dash: "solid", fillOn: false, fill: "#ff3b30", fillOpacity: 0.2, radius: 0, opacity: 1 },
  ellipse: { color: "#ff3b30", strokeOn: true, width: 4, dash: "solid", fillOn: false, fill: "#ff3b30", fillOpacity: 0.2, opacity: 1 },
  text: { font: "sans", size: 28, color: "#ffffff", bold: false, italic: false, underline: false, align: "left", bgOn: true, bg: "#000000", bgOpacity: 0.6, outline: 0, outlineColor: "#000000", opacity: 1 },
  pin: { color: "#ff3b30", size: 30 },
};
// Keys whose value is a length (converted between screen px and doc units).
const LEN_KEYS = new Set(["size", "width", "radius", "outline"]);

// Props bar descriptors per object type.
//   t: color | num | toggle | select | seg   create: only while drawing (hidden for a selection)
const P = {
  color: { k: "color", t: "color", label: "Colour" },
  size: { k: "size", t: "num", label: "Size", min: 0.5, max: 400, exp: true, unit: "px" },
  opacity: { k: "opacity", t: "num", label: "Opacity", min: 0.05, max: 1, pct: true },
  pressure: { k: "pressure", t: "toggle", label: "Pressure", title: "Pen pressure changes the width" },
  smooth: { k: "smooth", t: "num", label: "Smooth", min: 0, max: 1, pct: true, create: true },
  width: { k: "width", t: "num", label: "Width", min: 0.5, max: 200, exp: true, unit: "px" },
  dash: { k: "dash", t: "select", label: "Dash", options: DASHES },
  head0: { k: "head0", t: "select", label: "Start", options: HEADS },
  head1: { k: "head1", t: "select", label: "End", options: HEADS },
  body: { k: "body", t: "select", label: "Shape", options: BODIES },
  headSize: { k: "headSize", t: "num", label: "Head", min: 0.3, max: 4, exp: true, unit: "×" },
  strokeOn: { k: "strokeOn", t: "toggle", label: "Stroke" },
  fillOn: { k: "fillOn", t: "toggle", label: "Fill" },
  fill: { k: "fill", t: "color", label: "Fill colour" },
  fillOpacity: { k: "fillOpacity", t: "num", label: "Fill α", min: 0, max: 1, pct: true },
  radius: { k: "radius", t: "num", label: "Radius", min: 0, max: 400, exp: false, unit: "px" },
  font: { k: "font", t: "select", label: "Font", options: FONTS.map(([id, n]) => [id, n]) },
  tsize: { k: "size", t: "num", label: "Size", min: 4, max: 600, exp: true, unit: "px" },
  bold: { k: "bold", t: "toggle", label: "B", title: "Bold", cls: "b" },
  italic: { k: "italic", t: "toggle", label: "I", title: "Italic", cls: "i" },
  underline: { k: "underline", t: "toggle", label: "U", title: "Underline", cls: "u" },
  align: { k: "align", t: "seg", label: "Align", options: [["left", "⇤"], ["center", "↔"], ["right", "⇥"]] },
  bgOn: { k: "bgOn", t: "toggle", label: "Box", title: "Background box" },
  bg: { k: "bg", t: "color", label: "Box colour" },
  bgOpacity: { k: "bgOpacity", t: "num", label: "Box α", min: 0, max: 1, pct: true },
  outline: { k: "outline", t: "num", label: "Outline", min: 0, max: 40, exp: false, unit: "px" },
  outlineColor: { k: "outlineColor", t: "color", label: "Outline colour" },
  psize: { k: "size", t: "num", label: "Size", min: 10, max: 200, exp: true, unit: "px" },
  esize: { k: "size", t: "num", label: "Size", min: 2, max: 400, exp: true, unit: "px" },
  emode: { k: "mode", t: "seg", label: "Erase", options: [["object", "Object"], ["partial", "Partial"]] },
};
const PROPS = {
  brush: [P.color, P.size, P.opacity, P.pressure, P.smooth],
  pencil: [P.color, P.size, P.opacity, P.pressure, P.smooth],
  marker: [P.color, P.size, P.opacity, P.smooth],
  eraser: [P.esize, P.emode],
  line: [P.color, P.width, P.opacity, P.dash, P.head0, P.head1, P.body, P.headSize],
  arrow: [P.color, P.width, P.opacity, P.dash, P.head0, P.head1, P.body, P.headSize],
  rect: [P.strokeOn, P.color, P.width, P.dash, P.fillOn, P.fill, P.fillOpacity, P.radius, P.opacity],
  ellipse: [P.strokeOn, P.color, P.width, P.dash, P.fillOn, P.fill, P.fillOpacity, P.opacity],
  text: [P.font, P.tsize, P.color, P.bold, P.italic, P.underline, P.align, P.bgOn, P.bg, P.bgOpacity, P.outline, P.outlineColor, P.opacity],
  pin: [P.color, P.psize],
  select: [],
};

const isDrawing = (it) => it.kind !== "note";

function fmtTime(t, fps){
  if (!Number.isFinite(t)) return "";
  const f = Math.round((t % 1) * (fps || 25));
  const s = Math.floor(t) % 60, m = Math.floor(t / 60) % 60, h = Math.floor(t / 3600);
  const p = (n) => String(n).padStart(2, "0");
  return (h ? h + ":" + p(m) : m) + ":" + p(s) + "." + p(Math.min(f, Math.round(fps || 25) - 1));
}
function fmtDate(ms){
  try { return new Date(ms).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
}

// =================================================================================================

export function createAnnotator(host){
  injectStyles();
  const S = {
    on: false, panelOn: readJSON("sight.annotate.panel", true), hidden: false, onion: false, hiddenReplies: new Set(),
    tool: "brush", styles: loadStyles(), hold: readJSON("sight.annotate.hold", 0),
    asset: null, kind: null, items: new Map(), saved: new Set(), loading: null,
    sel: new Set(), undo: [], redo: [], clip: null,
    light: null, bar: null, ui: null, b2: null, b3: null, layer: null,
    drag: null, hover: null, edit: null, region: null, pending: [], focusNote: null,
    fps: 25, raf: 0, lastSig: "", dirty: new Set(), creating: new Map(), saveTimer: 0, views: new Map(), curVk: null,
    status: "", versions: [], prevOpen: null, filter: readJSON("sight.annotate.filter", "all"),
  };

  function readJSON(k, dflt){ try { const v = JSON.parse(localStorage.getItem(k)); return v ?? dflt; } catch { return dflt; } }
  function writeJSON(k, v){ try { host.putSetting(k, JSON.stringify(v)); } catch {} }
  function loadStyles(){
    const saved = readJSON("sight.annotate.styles", {}) || {};
    const out = {};
    for (const [k, v] of Object.entries(DEFAULT_STYLES)) out[k] = { ...v, ...(saved[k] || {}) };
    return out;
  }
  let styleTimer = 0;
  function saveStyles(){ clearTimeout(styleTimer); styleTimer = setTimeout(() => writeJSON("sight.annotate.styles", S.styles), 400); }
  const reviewer = () => localStorage.getItem("sight.reviewer") || "";

  // ---- toast ---------------------------------------------------------------------------------
  let toastTimer = 0;
  function toast(text, ms = 1800){
    const el = S.light?.querySelector(".an-toast");
    if (!el){ host.toast?.(text); return; }
    el.innerHTML = text;
    el.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("on"), ms);
  }

  // ---- persistence ---------------------------------------------------------------------------
  function rowBody(it){
    const b = boundsOf(it);
    return {
      id: it.id, scope: "asset", target_asset_id: S.asset.id, kind: it.kind, shape_kind: it.sub || null,
      z_index: it.z | 0, data: it.data, color: it.data.color || null,
      x: isDrawing(it) ? r2(b[0]) : null, y: isDrawing(it) ? r2(b[1]) : null,
      w: isDrawing(it) ? r2(b[2] - b[0]) : null, h: isDrawing(it) ? r2(b[3] - b[1]) : null,
    };
  }
  function serverCreate(it){
    S.saved.add(it.id);
    const p = host.api("/api/annotations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rowBody(it)) })
      .catch((e) => { S.saved.delete(it.id); console.warn(e); toast("Could not save the annotation"); })
      .finally(() => { if (S.creating.get(it.id) === p) S.creating.delete(it.id); });
    S.creating.set(it.id, p);
    return p;
  }
  function serverUpdate(id){ S.dirty.add(id); clearTimeout(S.saveTimer); S.saveTimer = setTimeout(flush, 300); }
  async function flush(){
    clearTimeout(S.saveTimer);
    if (!S.dirty.size || !S.asset) return;
    const ids = [...S.dirty];
    S.dirty.clear();
    await Promise.all(ids.map((id) => S.creating.get(id)).filter(Boolean));
    const items = [];
    for (const id of ids){
      const it = S.items.get(id);
      if (!it) continue;
      if (!S.saved.has(id)){ serverCreate(it); continue; }
      const b = rowBody(it);
      items.push({ id, data: b.data, z_index: b.z_index, color: b.color, x: b.x, y: b.y, w: b.w, h: b.h, shape_kind: b.shape_kind });
    }
    if (items.length) await host.api("/api/annotations/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items }) }).catch((e) => console.warn(e));
  }
  function serverDelete(id){
    S.dirty.delete(id);
    if (!S.saved.has(id)) return;
    S.saved.delete(id);
    Promise.resolve(S.creating.get(id)).then(() => host.api(`/api/annotations/${id}`, { method: "DELETE" })).catch((e) => console.warn(e));
  }

  async function load(a){
    const token = {};
    S.loading = token;
    let rows = [];
    try { rows = await host.api(`/api/annotations?asset_id=${encodeURIComponent(a.id)}`); } catch (e){ console.warn(e); }
    if (S.loading !== token || S.asset?.id !== a.id) return;
    S.loading = null;
    S.items.clear(); S.saved.clear();
    // The review state is a row of its own (kind 'status', newest wins) — not an editable item.
    const st = rows.filter((r) => r.kind === "status").sort((x, y) => (y.updated_at || 0) - (x.updated_at || 0))[0];
    S.status = st?.data?.state || "";
    // Rows from 0.17.0 have no history: their current state is the one entry.
    S.statusHist = Array.isArray(st?.data?.history) ? st.data.history
      : st?.data?.state ? [{ state: st.data.state, author: st.data.author || "", at: st.data.at || st.updated_at }] : [];
    for (const r of rows){
      if (r.kind === "status") continue;
      const it = { id: r.id, kind: r.kind, sub: r.shape_kind || null, z: r.z_index || 0, data: r.data || {} };
      if (!validItem(it)) continue;
      S.items.set(it.id, it);
      S.saved.add(it.id);
    }
    rebuildViews();
    renderAll();
    renderPanel();
    renderMarks();
    paintBadge();
    loadVersions(a);
  }
  // ---- versions / review state ------------------------------------------------------------------
  async function loadVersions(a){
    S.versions = []; S.prevOpen = null;
    if (S.kind === "model3d"){ renderVersions(); return; }
    let list = [];
    try { list = (await host.api(`/api/assets/${a.id}/versions`)).items || []; } catch {}
    if (S.asset?.id !== a.id) return;
    S.versions = list;
    const i = list.findIndex((x) => x.id === a.id);
    const prev = i > 0 ? list[i - 1] : null;
    if (prev){
      try {
        const rows = await host.api(`/api/annotations?asset_id=${encodeURIComponent(prev.id)}`);
        if (S.asset?.id !== a.id) return;
        S.prevOpen = { asset: prev, rows };
      } catch {}
    }
    renderVersions();
  }
  // Open notes of the previous version that have not been brought over yet.
  function carryCandidates(){
    const p = S.prevOpen;
    if (!p) return [];
    const have = new Set([...S.items.values()].map((it) => it.data.from?.id).filter(Boolean));
    return p.rows.filter((r) => r.kind === "note" && r.data?.status !== "done" && !have.has(r.id));
  }
  function renderVersions(){
    const el = S.ui?.querySelector(".an-vers");
    if (!el) return;
    const list = S.versions, i = list.findIndex((x) => x.id === S.asset?.id);
    if (list.length < 2 || i < 0){ el.hidden = true; el.innerHTML = ""; return; }
    const cand = carryCandidates();
    el.hidden = false;
    el.innerHTML = `<div class="an-vrow"><span>Version <b>${i + 1}</b> of ${list.length}</span>
        <button type="button" class="an-ib sm" data-ver="-1" title="Previous version"${i ? "" : " disabled"}>‹</button>
        <button type="button" class="an-ib sm" data-ver="1" title="Next version"${i < list.length - 1 ? "" : " disabled"}>›</button>
        <button type="button" class="an-ib" data-act="compare" title="Compare versions (K)">Compare</button></div>
      ${cand.length ? `<div class="an-vrow carry"><span><b>${esc(S.prevOpen.asset.name)}</b> has ${cand.length} open note${cand.length > 1 ? "s" : ""}</span><button type="button" class="an-ib" data-act="carry" title="Copy them (with their drawings) onto this version">Copy here</button></div>` : ""}`;
    el.querySelectorAll("[data-ver]").forEach((b) => { b.onclick = () => { const t = list[i + Number(b.dataset.ver)]; if (t) host.openAsset?.(t.id); }; });
    el.querySelector("[data-act=compare]").onclick = () => host.openCompare?.(list.map((x) => x.id), S.asset.id);
    const cb = el.querySelector("[data-act=carry]");
    if (cb) cb.onclick = () => carryOver();
  }
  // Copies the previous version's open notes and their drawings here (new ids, data.from points
  // at the original), scaled when the two versions differ in size. Video times and 3D views are
  // kept as they are.
  function carryOver(){
    const p = S.prevOpen, notes = carryCandidates();
    if (!p || !notes.length) return;
    const g = geom();
    const fx = g?.nw && p.asset.width ? g.nw / p.asset.width : 1;
    const fy = g?.nh && p.asset.height ? g.nh / p.asset.height : 1;
    const noteIds = new Set(notes.map((n) => n.id)), map = new Map();
    const src = p.rows.filter((r) => noteIds.has(r.id) || (r.kind !== "note" && r.kind !== "status" && noteIds.has(r.data?.note)));
    for (const r of src) map.set(r.id, uid());
    const made = [];
    for (const r of src){
      const it = { id: map.get(r.id), kind: r.kind, sub: r.shape_kind || null, z: r.z_index || 0, data: structuredClone(r.data || {}) };
      if (it.kind === "note"){
        it.data.from = { id: r.id, asset: p.asset.id, name: p.asset.name };
        it.data.shots = it.data.shots || [];
      } else {
        it.data.note = map.get(r.data.note);
        if (!validItem(it)) continue;
        if (Math.abs(fx - 1) > 1e-3 || Math.abs(fy - 1) > 1e-3){
          const snapIt = structuredClone(it);
          transformItem(it, snapIt, (x, y) => [x * fx, y * fy], { k: Math.sqrt(fx * fy), sx: fx, sy: fy });
        }
      }
      made.push(it);
    }
    commit(made.map((it) => it.id), () => { for (const it of made) S.items.set(it.id, it); });
    toast(`Copied ${notes.length} open note${notes.length > 1 ? "s" : ""} from <b>${esc(p.asset.name)}</b>`, 3000);
    renderVersions();
  }
  async function setStatus(state){
    if (!S.asset) return;
    const a = S.asset, was = S.status;
    S.status = state;
    paintStatus();
    try {
      const res = await host.api(`/api/assets/${a.id}/review-status`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ state, author: reviewer() }) });
      if (S.asset?.id === a.id && Array.isArray(res?.history)){ S.statusHist = res.history; paintStatus(); }
      host.onReviewChanged?.(a.id);
    } catch (e){
      console.warn(e);
      if (S.asset?.id === a.id){ S.status = was; paintStatus(); }
      toast("Could not save the review state");
    }
  }
  const STATE_LABEL = { review: "Needs review", changes: "Changes requested", approved: "Approved" };
  const histLine = (h) => `${STATE_LABEL[h.state] || "Cleared"}${h.author ? " by " + h.author : ""} · ${fmtDate(h.at)}`;
  // The review state's history ({state, author, at} per change, see Library.set_review_status):
  // the latest change under the switch, the whole list on click.
  function paintStatus(){
    S.ui?.querySelectorAll("[data-rs]").forEach((b) => b.classList.toggle("on", b.dataset.rs === S.status));
    const el = S.ui?.querySelector(".an-rsh");
    if (!el) return;
    const h = S.statusHist || [];
    el.hidden = !h.length;
    if (!h.length) return;
    const list = S.histOpen ? [...h].reverse() : [h[h.length - 1]];
    el.innerHTML = list.map((x) => `<div>${esc(histLine(x))}</div>`).join("")
      + (h.length > 1 ? `<button type="button" class="an-rsh-more">${S.histOpen ? "Less" : `History (${h.length})`}</button>` : "");
    el.querySelector(".an-rsh-more")?.addEventListener("click", () => { S.histOpen = !S.histOpen; paintStatus(); });
  }
  // ---- undo ----------------------------------------------------------------------------------
  const snap = (it) => (it ? structuredClone(it) : null);
  // Runs `mutate` and records one undo step for the objects in `ids` (new objects created inside
  // mutate must be listed too). `merge`: a key — consecutive commits with the same key within
  // 700 ms fold into one step (slider drags, nudges).
  function commit(ids, mutate, merge){
    const before = new Map(ids.map((id) => [id, snap(S.items.get(id))]));
    mutate();
    const after = new Map(ids.map((id) => [id, snap(S.items.get(id))]));
    const last = S.undo[S.undo.length - 1];
    const now = performance.now();
    if (merge && last && last.merge === merge && now - last.at < 700 && ids.every((id) => last.after.has(id))){
      for (const [id, v] of after) last.after.set(id, v);
      last.at = now;
    } else {
      S.undo.push({ before, after, merge, at: now });
      if (S.undo.length > 200) S.undo.shift();
    }
    S.redo.length = 0;
    for (const id of ids) persist(id, before.get(id), after.get(id));
    afterChange();
  }
  function persist(id, before, after){
    if (!after){ S.items.delete(id); S.sel.delete(id); serverDelete(id); return; }
    if (!before || !S.saved.has(id)) serverCreate(S.items.get(id));
    else serverUpdate(id);
  }
  function applyStates(states){
    for (const [id, v] of states){
      const had = S.items.has(id);
      if (!v){ if (had){ S.items.delete(id); S.sel.delete(id); serverDelete(id); } continue; }
      S.items.set(id, structuredClone(v));
      if (!S.saved.has(id)) serverCreate(S.items.get(id));
      else serverUpdate(id);
    }
  }
  function undo(){
    const e = S.undo.pop();
    if (!e){ toast("Nothing to undo"); return; }
    applyStates(e.before);
    S.redo.push(e);
    afterChange();
  }
  function redo(){
    const e = S.redo.pop();
    if (!e){ toast("Nothing to redo"); return; }
    applyStates(e.after);
    S.undo.push(e);
    afterChange();
  }
  let notesSig = "", notesTimer = 0;
  function afterChange(){
    modeCache = null;
    const sig = [...S.items.values()].filter((it) => it.kind === "note").map((n) => n.id + (n.data.status || "")).join();
    if (sig !== notesSig){
      notesSig = sig;
      const id = S.asset?.id;
      clearTimeout(notesTimer);
      notesTimer = setTimeout(() => { flush().then(() => host.onReviewChanged?.(id)); }, 600);
    }
    rebuildViews();
    renderAll();
    renderSel();
    renderPanel();
    renderMarks();
    renderProps();
    paintBadge();
  }

  // ---- context (video time / 3D view) ---------------------------------------------------------
  const video = () => S.b2?.isVid ? S.b2.media : null;
  const frameDur = () => 1 / (S.fps || 25);
  // The frame on screen at time t is the one that started at or before it. A note / drawing made
  // there is stored at that frame's start + a hair (where stepping lands), so ctxVisible shows it on
  // exactly that frame and every client numbers it the same (same rule in mobile/js/app.js). With
  // the frame rate not known yet, the raw time is kept rather than snapped to a guessed rate.
  const frameStart = (t) => {
    if (!S.fpsKnown) return Math.round(t * 1000) / 1000;
    const fd = frameDur();
    return Math.round((Math.floor(t / fd + 1e-6) + 0.01) * fd * 1000) / 1000;
  };
  function camMatch(a, b){
    if (!a || !b) return false;
    const d = hyp(hyp(a.p[0] - a.t[0], a.p[1] - a.t[1]), a.p[2] - a.t[2]) || 1, tol = d * 0.004;
    const dp = hyp(hyp(a.p[0] - b.p[0], a.p[1] - b.p[1]), a.p[2] - b.p[2]);
    const dt = hyp(hyp(a.t[0] - b.t[0], a.t[1] - b.t[1]), a.t[2] - b.t[2]);
    return dp < tol && dt < tol && Math.abs((a.fov || 50) - (b.fov || 50)) < 0.5 && (a.turns || 0) === (b.turns || 0);
  }
  function rebuildViews(){
    S.views.clear();
    for (const it of S.items.values()){
      const c = it.data.ctx;
      if (c && c.vk && c.cam && !S.views.has(c.vk)) S.views.set(c.vk, { vk: c.vk, cam: c.cam, v3d: it.kind === "note" ? c.v3d : null });
    }
    for (const it of S.items.values()){ // a note's display settings win over a drawing's bare camera
      const c = it.data.ctx;
      if (it.kind === "note" && c?.vk && c.v3d) S.views.get(c.vk).v3d = c.v3d;
    }
  }
  function curCam(){ return S.b3?.getCam?.() || null; }
  function findVk(cam){
    if (!cam) return null;
    for (const v of S.views.values()) if (camMatch(cam, v.cam)) return v.vk;
    return null;
  }
  // The context a new object gets right now.
  function ctxNow(forNote){
    if (S.kind === "video"){
      const v = video();
      if (!v) return null;
      return { t: frameStart(v.currentTime), hold: S.hold };
    }
    if (S.kind === "model3d"){
      const cam = curCam();
      if (!cam) return null;
      let vk = S.curVk || findVk(cam);
      if (!vk){ vk = uid(); S.views.set(vk, { vk, cam, v3d: null }); S.curVk = vk; }
      const c = { vk, cam: S.views.get(vk).cam };
      if (forNote) c.v3d = host.getV3D?.() || null;
      return c;
    }
    return null;
  }
  // A drawing made on a reply (data.reply, FORMAT.md) goes with that reply: it disappears when the
  // reply is deleted (here or in a merged review file) and while its eye toggle is off.
  function replyGone(it){
    const rid = it.data.reply;
    if (!rid) return false;
    const r = (S.items.get(it.data.note)?.data.replies || []).find((x) => x.id === rid);
    return !!r?.deleted;
  }
  // The base rule: the drawing's frame / view is on screen, its reply is neither hidden nor
  // deleted, and its note (if it has one) still exists — a drawing of a deleted note never shows.
  function ctxShown(it){
    if (it.data.reply && (S.hiddenReplies.has(it.data.reply) || replyGone(it))) return false;
    if (it.data.note && S.items.get(it.data.note)?.kind !== "note") return false;
    return RC.ctxVisible(it.data.ctx, frameNow());
  }
  // What the media shows besides that (viewMode, worked out once per change):
  //   compose — a new note is being made (its field focused or filled, a drawing being drawn, or
  //             drawings / screenshots waiting for it): only what goes with the new note, a clean
  //             picture otherwise;
  //   pin     — a note picked in the panel: only its drawings;
  //   hover   — a note under the pointer in the panel: the others dimmed.
  let modeCache = null;
  function viewMode(){
    if (modeCache) return modeCache;
    const inp = S.ui && !S.ui.hidden ? S.ui.querySelector(".an-input") : null, D = S.drag;
    const compose = !!(inp && (document.activeElement === inp || inp.value.trim())) || !!(D && (D.stroke || D.shape)) || !!(S.edit && S.edit.isNew)
      || S.pending.length > 0 || [...S.items.values()].some((it) => isDrawing(it) && !it.data.note && ctxShown(it));
    const note = (id) => (id && S.items.get(id)?.kind === "note" ? id : null);
    modeCache = { compose, pin: note(S.pinFocus), hover: note(S.focusNote) };
    queueMicrotask(() => { modeCache = null; });
    return modeCache;
  }
  function modeAllows(it){
    if (!it.data.note) return true;
    const m = viewMode();
    return !m.compose && (!m.pin || it.data.note === m.pin);
  }
  function visibleNow(it){ return ctxShown(it) && modeAllows(it); }
  // The view mode may have changed (typing started, a note picked): repaint what shows.
  function modeChanged(){ modeCache = null; if (!S.layer) return; paintVisibility(); renderSel(); renderPending(); }
  // The frame on screen, as review-core's ctxVisible takes it.
  function frameNow(){
    if (S.kind === "video"){ const v = video(); return v ? { t: v.currentTime, fps: S.fps } : null; }
    if (S.kind === "model3d") return { vk: S.curVk || null };
    return null;
  }
  function ghostNow(it){
    if (!S.onion || S.kind !== "video") return false;
    if (it.data.reply && (S.hiddenReplies.has(it.data.reply) || replyGone(it))) return false;
    if (it.data.note && S.items.get(it.data.note)?.kind !== "note") return false;
    if (!modeAllows(it)) return false;
    const c = it.data.ctx, v = video();
    return !!(c && v && c.t != null && Math.abs(v.currentTime - c.t) <= 1.0);
  }
  function ctxLabel(c){
    if (!c) return "";
    if (c.t != null) return fmtTime(c.t, S.fps) + "  ·  f " + Math.round(c.t * S.fps);
    if (c.vk) return "View " + (viewNumber(c.vk) || "");
    return "";
  }
  function viewNumber(vk){ return [...S.views.keys()].indexOf(vk) + 1; }

  function notesSorted(){
    const notes = [...S.items.values()].filter((it) => it.kind === "note");
    if (S.kind === "video") notes.sort((a, b) => (a.data.ctx?.t ?? 0) - (b.data.ctx?.t ?? 0) || (a.data.created || 0) - (b.data.created || 0));
    else notes.sort((a, b) => (a.data.created || 0) - (b.data.created || 0));
    return notes;
  }
  function numOf(it){
    if (!it.data.note) return "";
    const i = notesSorted().findIndex((n) => n.id === it.data.note);
    return i >= 0 ? i + 1 : "";
  }

  // ---- surface (doc <-> screen) --------------------------------------------------------------
  function geom(){
    if (S.b2){
      const g = S.b2.geom();
      return { ox: g.x0, oy: g.y0, s: g.s || 1, w: S.b2.wrap.clientWidth, h: S.b2.wrap.clientHeight, nw: g.w, nh: g.h };
    }
    if (S.b3){
      const w = S.b3.host.clientWidth, h = S.b3.host.clientHeight;
      return { ox: w / 2, oy: h / 2, s: h / 1000 || 1, w, h };
    }
    return null;
  }
  const surfaceEl = () => S.b2?.wrap || S.b3?.host || null;
  // The pointer in the surface's px, in the viewer's unturned frame (the lightbox can turn /
  // mirror the view; the layer turns with the picture, so everything below works unturned).
  function local(e){
    const r = surfaceEl().getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    return S.b2?.unturn ? S.b2.unturn(x, y) : [x, y];
  }
  function toDoc(e){
    const g = geom(), [x, y] = local(e);
    return [(x - g.ox) / g.s, (y - g.oy) / g.s];
  }
  function toScreen(x, y){ const g = geom(); return [g.ox + x * g.s, g.oy + y * g.s]; }
  const k = () => 1 / (geom()?.s || 1); // doc units per screen px

  // ---- layers ---------------------------------------------------------------------------------
  function ensureLayer(){
    const el = surfaceEl();
    if (!el) return null;
    if (S.layer && S.layer.root.parentNode === el) return S.layer;
    S.layer?.root.remove();
    const root = document.createElement("div");
    root.className = "an-layer";
    root.innerHTML = `<svg class="an-doc" xmlns="${SVGNS}"></svg><svg class="an-ui" xmlns="${SVGNS}"></svg>`;
    el.appendChild(root);
    S.layer = { root, doc: root.firstElementChild, ui: root.lastElementChild, els: new Map() };
    return S.layer;
  }
  function syncViewBox(){
    const L = S.layer, g = geom();
    if (!L || !g) return;
    L.doc.setAttribute("viewBox", `${r2(-g.ox / g.s)} ${r2(-g.oy / g.s)} ${r2(g.w / g.s)} ${r2(g.h / g.s)}`);
    L.ui.setAttribute("viewBox", `0 0 ${g.w} ${g.h}`);
    const tc = S.b2 ? S.b2.geom().turn || "" : "";
    if (L.root.style.transform !== tc){ L.root.style.transformOrigin = "0 0"; L.root.style.transform = tc; }
  }
  function renderItem(it){
    const L = S.layer;
    if (!L) return;
    let g = L.els.get(it.id);
    if (!g){ g = document.createElementNS(SVGNS, "g"); g.dataset.id = it.id; L.els.set(it.id, g); }
    g.innerHTML = primsOf(it, numOf).map(primSvg).join("");
    g.__z = it.z;
  }
  function renderAll(){
    const L = S.on ? ensureLayer() : S.layer;
    if (!L) return;
    syncViewBox();
    const list = [...S.items.values()].filter(isDrawing).sort((a, b) => a.z - b.z);
    const keep = new Set(list.map((it) => it.id));
    for (const [id, g] of L.els) if (!keep.has(id)){ g.remove(); L.els.delete(id); }
    for (const it of list){ renderItem(it); L.doc.appendChild(L.els.get(it.id)); }
    paintVisibility();
    L.root.hidden = !S.on;
  }
  function paintVisibility(){
    const L = S.layer;
    if (!L) return;
    modeCache = null;
    const m = viewMode(), focus = !m.compose && !m.pin ? m.hover : null;
    for (const [id, g] of L.els){
      const it = S.items.get(id);
      if (!it) continue;
      const vis = !S.hidden && visibleNow(it);
      const ghost = !S.hidden && !vis && ghostNow(it);
      g.style.display = vis || ghost ? "" : "none";
      g.classList.toggle("ghost", ghost);
      g.classList.toggle("dim", !!focus && vis && it.data.note !== focus);
    }
  }
  const visibleDrawings = () => [...S.items.values()].filter((it) => isDrawing(it) && visibleNow(it));

  // ---- selection overlay ----------------------------------------------------------------------
  // The selected objects on screen now: the ones the handles (review-core xf*) work on.
  const selVisible = () => [...S.sel].map((id) => S.items.get(id)).filter((it) => it && visibleNow(it));
  // Handles in screen px: [id, x, y] (review-core xfHandles, mapped from doc units).
  function handles(){
    return RC.xfHandles(selVisible(), k(), S.drag?.xf).map(([id, x, y]) => [id, ...toScreen(x, y)]);
  }
  function renderSel(){
    const L = S.layer;
    if (!L) return;
    syncViewBox();
    let html = RC.xfSvg(selVisible(), { px: k(), u: 1, map: toScreen, D: S.drag?.xf });
    if (S.drag?.marquee){
      const m = S.drag.marquee;
      html += `<rect class="an-marquee" x="${r2(Math.min(m[0], m[2]))}" y="${r2(Math.min(m[1], m[3]))}" width="${r2(Math.abs(m[2] - m[0]))}" height="${r2(Math.abs(m[3] - m[1]))}"/>`;
    }
    if (S.region?.rect){
      const m = S.region.rect, g = geom();
      const x = Math.min(m[0], m[2]), y = Math.min(m[1], m[3]), w = Math.abs(m[2] - m[0]), h = Math.abs(m[3] - m[1]);
      html += `<path class="an-regionshade" d="M0 0H${g.w}V${g.h}H0Z M${x} ${y}v${h}h${w}v${-h}Z"/><rect class="an-region" x="${x}" y="${y}" width="${w}" height="${h}"/><text class="an-regionlbl" x="${x + 4}" y="${y - 6}">${Math.round(w)} × ${Math.round(h)}</text>`;
    }
    if (S.hover && !S.drag && !S.region){
      const t = effTool(), st = S.styles[t];
      if (STROKE_TOOLS.has(t) || t === "eraser"){
        const r = Math.max(1, st.size / 2);
        html += `<circle class="an-cursor${t === "eraser" ? " er" : ""}" cx="${r2(S.hover[0])}" cy="${r2(S.hover[1])}" r="${r2(r)}"/>`;
      }
    } else if (S.drag?.eraser && S.hover){
      html += `<circle class="an-cursor er" cx="${r2(S.hover[0])}" cy="${r2(S.hover[1])}" r="${r2(Math.max(1, S.styles.eraser.size / 2))}"/>`;
    }
    L.ui.innerHTML = html;
  }

  // ---- pointer input --------------------------------------------------------------------------
  function hitAt(x, y, tolPx = 6){
    const tol = tolPx * k();
    const list = visibleDrawings().sort((a, b) => b.z - a.z);
    return list.find((it) => hitTest(it, x, y, tol)) || null;
  }
  function handleAt(sx, sy){
    for (const [id, x, y] of handles()) if (hyp(sx - x, sy - y) <= 8) return id;
    return null;
  }
  const nextZ = () => Math.max(0, ...[...S.items.values()].map((it) => it.z || 0)) + 1;

  function newItem(kind, sub, data){
    return { id: uid(), kind, sub, z: nextZ(), data: { ...data, ctx: ctxNow(false), note: null, created: Date.now() } };
  }
  function styleDoc(t){
    // Tool style converted to doc units.
    const st = { ...S.styles[t] }, kk = k();
    for (const key of LEN_KEYS) if (key in st) st[key] = st[key] * kk;
    return st;
  }

  let suppressClick = false;
  function onDown(e){
    if (!S.on) return;
    if (S.edit){ if (e.button === 0){ finishEdit(); release(e); } return; }
    const pen = e.pointerType === "pen";
    const penEraser = pen && (e.buttons & 32 || e.button === 5);
    if (e.button !== 0 && !penEraser) return; // middle / right: the viewer's pan / zoom
    if (S.kind === "video"){ const v = video(); if (v && !v.paused) v.pause(); }
    const el = surfaceEl();
    const [x, y] = toDoc(e);
    const [sx, sy] = local(e);
    // Ctrl held: the eraser for this stroke (the select tool keeps Ctrl+click for the selection).
    const tool = penEraser || (e.ctrlKey && !e.metaKey && S.tool !== "select" && !S.region) ? "eraser" : S.tool;

    if (S.region){
      grab(e);
      S.region.rect = [sx, sy, sx, sy];
      S.drag = { region: true };
      renderSel();
      return;
    }
    if (tool === "select"){
      const h = S.sel.size ? handleAt(sx, sy) : null;
      if (h){ grab(e); startHandleDrag(h, x, y, e); return; }
      const hit = hitAt(x, y);
      if (hit){
        grab(e);
        if (e.shiftKey || e.ctrlKey || e.metaKey){
          if (S.sel.has(hit.id)) S.sel.delete(hit.id); else S.sel.add(hit.id);
        } else if (!S.sel.has(hit.id)){ S.sel.clear(); S.sel.add(hit.id); }
        if (e.altKey && S.sel.has(hit.id)) duplicateSelection(0, true);
        const ids = [...S.sel];
        S.drag = { move: true, x, y, ids, src: new Map(ids.map((id) => [id, snap(S.items.get(id))])), moved: false, hit: hit.id, plain: !(e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) };
        renderSel(); renderProps();
        return;
      }
      if (S.kind === "model3d"){ // empty space in 3D: let the orbit controls have it
        if (S.sel.size){ S.sel.clear(); renderSel(); renderProps(); }
        return;
      }
      grab(e);
      if (!(e.shiftKey || e.ctrlKey || e.metaKey)) S.sel.clear();
      S.drag = { marquee: [sx, sy, sx, sy], base: new Set(S.sel), toggle: e.ctrlKey || e.metaKey };
      renderSel(); renderProps();
      return;
    }
    grab(e);
    if (S.sel.size){ S.sel.clear(); renderProps(); }
    if (tool === "eraser"){
      S.drag = { eraser: true, before: new Map(), partial: S.styles.eraser.mode === "partial" };
      eraseAt(x, y);
      return;
    }
    // Drawing starts a new note: a note picked in the panel lets go (the media shows the new one).
    if (S.pinFocus){ S.pinFocus = S.focusNote = null; renderPanel(); }
    if (STROKE_TOOLS.has(tool)){
      const st = styleDoc(tool);
      const p = pen ? clamp(e.pressure || 0.5, 0, 1) : 0.5;
      const it = newItem("stroke", tool, { color: st.color, size: st.size, opacity: st.opacity, pressure: st.pressure !== false, pen, pts: [r2(x), r2(y), r2(p)] });
      S.items.set(it.id, it);
      S.drag = { stroke: it, sm: [x, y], smooth: st.smooth ?? 0, start: [x, y], minStep: 0.75 * k() };
      renderAll();
      return;
    }
    if (tool === "line" || tool === "arrow"){
      const st = styleDoc(tool);
      const it = newItem("shape", tool, { color: st.color, width: st.width, opacity: st.opacity, dash: st.dash, head0: st.head0, head1: st.head1, body: st.body, headSize: st.headSize, pts: [x, y, x, y] });
      S.items.set(it.id, it);
      S.drag = { shape: it, x, y };
      renderAll();
      return;
    }
    if (tool === "rect" || tool === "ellipse"){
      const st = styleDoc(tool);
      const it = newItem("shape", tool, { color: st.color, strokeOn: st.strokeOn, width: st.width, dash: st.dash, fillOn: st.fillOn, fill: st.fill, fillOpacity: st.fillOpacity, radius: st.radius || 0, opacity: st.opacity, x, y, w: 0, h: 0, rot: 0 });
      S.items.set(it.id, it);
      S.drag = { shape: it, x, y };
      renderAll();
      return;
    }
    if (tool === "text"){
      const hit = hitAt(x, y);
      if (hit && typeOf(hit) === "text"){ release(e); editText(hit); return; }
      release(e);
      const st = styleDoc("text");
      const it = newItem("text", null, { ...st, text: "", x, y: y - st.size * 0.6, rot: 0 });
      editText(it, true);
      return;
    }
    if (tool === "pin"){
      const st = styleDoc("pin");
      const it = newItem("pin", null, { color: st.color, size: st.size, x, y });
      commit([it.id], () => S.items.set(it.id, it));
      release(e);
      focusComposer();
      return;
    }
  }
  function grab(e){
    e.preventDefault();
    e.stopImmediatePropagation();
    suppressClick = true;
    try { surfaceEl().setPointerCapture(e.pointerId); } catch {}
  }
  function release(e){
    e.preventDefault();
    e.stopImmediatePropagation();
    suppressClick = true;
  }

  function onMove(e){
    if (!S.on) return;
    const el = surfaceEl();
    if (!el) return;
    const [sx, sy] = local(e);
    S.hover = [sx, sy];
    if (S.ctrlHeld !== e.ctrlKey && !S.drag) S.ctrlHeld = e.ctrlKey;
    const D = S.drag;
    if (!D){ updateCursor(sx, sy); renderSel(); return; }
    e.preventDefault();
    if (D.region){ S.region.rect[2] = sx; S.region.rect[3] = sy; renderSel(); return; }
    const [x, y] = toDoc(e);
    if (D.stroke){
      const it = D.stroke, d = it.data;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      if (e.shiftKey){
        // Shift: straight stroke from where it started, snapped to 15°.
        const [ex, ey] = snapAngle(D.start[0], D.start[1], x, y);
        const n = Math.max(2, Math.ceil(hyp(ex - D.start[0], ey - D.start[1]) / Math.max(D.minStep * 4, d.size / 3)));
        d.pts = [];
        for (let i = 0; i <= n; i++) d.pts.push(r2(D.start[0] + (ex - D.start[0]) * i / n), r2(D.start[1] + (ey - D.start[1]) * i / n), 1);
        D.straight = true;
      } else {
        if (D.straight){ d.pts = d.pts.slice(0, 3); D.sm = D.start.slice(); D.straight = false; }
        for (const ce of evs.length ? evs : [e]){
          const [cx, cy] = toDoc(ce);
          const a = 1 - D.smooth * 0.82;
          D.sm = [D.sm[0] + (cx - D.sm[0]) * a, D.sm[1] + (cy - D.sm[1]) * a];
          const n = d.pts.length;
          if (hyp(D.sm[0] - d.pts[n - 3], D.sm[1] - d.pts[n - 2]) < D.minStep) continue;
          const p = d.pen ? clamp(ce.pressure || 0, 0, 1) : 0.5;
          d.pts.push(r2(D.sm[0]), r2(D.sm[1]), r2(p));
        }
        D.last = [x, y, d.pen ? clamp(e.pressure || 0, 0, 1) : 0.5];
      }
      renderItem(it);
      return;
    }
    if (D.shape){
      const it = D.shape, d = it.data, t = typeOf(it);
      if (t === "line" || t === "arrow"){
        const [ex, ey] = e.shiftKey ? snapAngle(D.x, D.y, x, y) : [x, y];
        d.pts = [D.x, D.y, ex, ey];
      } else {
        let w = x - D.x, h = y - D.y;
        if (e.shiftKey){ const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
        if (e.altKey){ d.x = D.x - w; d.y = D.y - h; d.w = w * 2; d.h = h * 2; }
        else { d.x = D.x; d.y = D.y; d.w = w; d.h = h; }
      }
      renderItem(it);
      return;
    }
    if (D.eraser){ eraseAt(x, y); renderSel(); return; }
    if (D.marquee){
      D.marquee[2] = sx; D.marquee[3] = sy;
      const [ax, ay] = toDocS(Math.min(D.marquee[0], sx), Math.min(D.marquee[1], sy));
      const [bx, by] = toDocS(Math.max(D.marquee[0], sx), Math.max(D.marquee[1], sy));
      const inBox = new Set(visibleDrawings().filter((it) => { const b = boundsOf(it); return b[0] <= bx && b[2] >= ax && b[1] <= by && b[3] >= ay; }).map((it) => it.id));
      S.sel = new Set(D.base);
      for (const id of inBox){ if (D.toggle && D.base.has(id)) S.sel.delete(id); else S.sel.add(id); }
      renderSel();
      return;
    }
    if (D.move){
      let dx = x - D.x, dy = y - D.y;
      if (e.shiftKey){ if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      if (!D.moved && hyp(dx, dy) / k() < 2) return;
      D.moved = true;
      for (const id of D.ids){
        const it = S.items.get(id), src = D.src.get(id);
        if (it && src) transformItem(it, src, (px, py) => [px + dx, py + dy]);
        renderItem(it);
      }
      renderSel();
      return;
    }
    if (D.handle){ dragHandle(D, x, y, e); return; }
  }
  const toDocS = (sx, sy) => { const g = geom(); return [(sx - g.ox) / g.s, (sy - g.oy) / g.s]; };

  function onUp(e){
    const D = S.drag;
    if (!D) return;
    S.drag = null;
    try { surfaceEl()?.releasePointerCapture(e.pointerId); } catch {}
    if (D.region){ finishRegion(); return; }
    if (D.stroke){
      const it = D.stroke;
      if (D.last && !D.straight){
        const d = it.data, n = d.pts.length;
        if (hyp(D.last[0] - d.pts[n - 3], D.last[1] - d.pts[n - 2]) > 0.01) d.pts.push(r2(D.last[0]), r2(D.last[1]), r2(D.last[2]));
      }
      S.items.delete(it.id);
      commit([it.id], () => S.items.set(it.id, it));
      return;
    }
    if (D.shape){
      const it = D.shape, d = it.data, t = typeOf(it);
      S.items.delete(it.id);
      const tiny = t === "line" || t === "arrow" ? hyp(d.pts[2] - d.pts[0], d.pts[3] - d.pts[1]) / k() < 3 : Math.abs(d.w) / k() < 3 && Math.abs(d.h) / k() < 3;
      if (tiny){ renderAll(); return; }
      if (t === "rect" || t === "ellipse"){ if (d.w < 0){ d.x += d.w; d.w = -d.w; } if (d.h < 0){ d.y += d.h; d.h = -d.h; } }
      commit([it.id], () => S.items.set(it.id, it));
      return;
    }
    if (D.eraser){
      if (D.before.size){
        const after = new Map([...D.before.keys()].map((id) => [id, snap(S.items.get(id))]));
        // Items were already changed live; record the step and persist.
        S.undo.push({ before: D.before, after, at: performance.now() });
        S.redo.length = 0;
        for (const [id, b] of D.before) persist(id, b, after.get(id));
        afterChange();
      }
      return;
    }
    if (D.marquee){ renderSel(); renderProps(); return; }
    if (D.move || D.handle){
      if (!D.moved){
        if (D.move && D.plain && S.sel.size > 1){ S.sel = new Set([D.hit]); renderProps(); }
        renderSel();
        return;
      }
      const ids = D.ids;
      const after = new Map(ids.map((id) => [id, snap(S.items.get(id))]));
      S.undo.push({ before: D.src, after, at: performance.now() });
      S.redo.length = 0;
      for (const id of ids) serverUpdate(id);
      afterChange();
    }
  }

  const snapAngle = RC.snap15;


  function eraseAt(x, y){
    const D = S.drag, rad = S.styles.eraser.size / 2 * k();
    for (const it of visibleDrawings()){
      if (!hitTest(it, x, y, rad)) continue;
      const t = typeOf(it);
      if (D.partial && STROKE_TOOLS.has(t)){
        if (!D.before.has(it.id)) D.before.set(it.id, snap(it));
        const pts = it.data.pts, keep = [];
        let cur = [];
        for (let i = 0; i < pts.length; i += 3){
          if (hyp(pts[i] - x, pts[i + 1] - y) <= rad + it.data.size * 0.25){ if (cur.length) keep.push(cur); cur = []; }
          else cur.push(pts[i], pts[i + 1], pts[i + 2]);
        }
        if (cur.length) keep.push(cur);
        if (!keep.length){ S.items.delete(it.id); S.layer?.els.get(it.id)?.remove(); S.layer?.els.delete(it.id); continue; }
        it.data.pts = keep[0];
        renderItem(it);
        for (const piece of keep.slice(1)){
          const n = { ...structuredClone(it), id: uid(), z: nextZ() };
          n.data.pts = piece;
          S.items.set(n.id, n);
          D.before.set(n.id, null);
          renderItem(n);
          S.layer?.doc.appendChild(S.layer.els.get(n.id));
        }
      } else {
        if (!D.before.has(it.id)) D.before.set(it.id, snap(it));
        S.items.delete(it.id);
        S.layer?.els.get(it.id)?.remove();
        S.layer?.els.delete(it.id);
      }
    }
  }

  // Scale / rotate / line-end handles: review-core xfStart / xfDrag (shared with the HTML page's
  // and the phone app's drawing canvas). The rotate handle follows the pointer out from the pivot.
  function startHandleDrag(h, x, y, e){
    const list = selVisible(), ids = list.map((it) => it.id);
    S.drag = { handle: h, xf: RC.xfStart(h, list, x, y), ids, src: new Map(ids.map((id) => [id, snap(S.items.get(id))])), moved: false };
  }
  function dragHandle(D, x, y, e){
    D.moved = true;
    RC.xfDrag(D.xf, x, y, { shift: e.shiftKey, alt: e.altKey });
    for (const it of D.xf.items) renderItem(it);
    renderSel();
  }

  function updateCursor(sx, sy){
    const el = surfaceEl();
    if (!el) return;
    let c = "crosshair";
    if (S.region) c = "crosshair";
    else if (S.tool === "select"){
      const h = S.sel.size ? handleAt(sx, sy) : null;
      if (h) c = RC.XF_CURSOR[h];
      else {
        const [x, y] = toDocS(sx, sy);
        c = hitAt(x, y) ? "move" : S.kind === "model3d" ? "" : "default";
      }
    } else if (STROKE_TOOLS.has(effTool()) || effTool() === "eraser") c = "none";
    else if (S.tool === "text") c = "text";
    el.style.cursor = c;
  }
  // The tool a press would use now: Ctrl held turns any drawing tool into the eraser.
  const effTool = () => S.ctrlHeld && S.tool !== "select" && !S.region ? "eraser" : S.tool;
  function ctrlChanged(on){
    if (S.ctrlHeld === on) return;
    S.ctrlHeld = on;
    if (S.on && S.hover && !S.drag){ updateCursor(...S.hover); renderSel(); }
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Control") ctrlChanged(true); }, true);
  document.addEventListener("keyup", (e) => { if (e.key === "Control") ctrlChanged(false); }, true);
  window.addEventListener("blur", () => ctrlChanged(false));

  // ---- text editing ---------------------------------------------------------------------------
  function editText(it, isNew){
    finishEdit();
    const el = surfaceEl();
    if (!el) return;
    const ta = document.createElement("textarea");
    ta.className = "an-textedit";
    ta.spellcheck = false;
    ta.value = it.data.text || "";
    // In the layer, so it turns / mirrors with the picture.
    (S.b2 && S.layer ? S.layer.root : el).appendChild(ta);
    ta.style.pointerEvents = "auto";
    S.edit = { it, ta, isNew, before: isNew ? null : snap(it) };
    if (!isNew){ S.items.set(it.id, it); S.layer?.els.get(it.id)?.setAttribute("opacity", "0"); }
    const place = () => {
      const d = it.data, g = geom(), L = textLayout({ ...d, text: ta.value || " " });
      const [sx, sy] = toScreen(d.x, d.y);
      const fs = d.size * g.s;
      Object.assign(ta.style, {
        left: sx + "px", top: sy + "px", width: Math.max(fs * 2, L.w * g.s + fs) + "px", height: (L.h * g.s + 4) + "px",
        font: `${d.italic ? "italic " : ""}${d.bold ? 700 : 400} ${fs}px/${1.25} ${fontStack(d.font)}`,
        color: d.color, textAlign: d.align || "left", textDecoration: d.underline ? "underline" : "none",
        transform: d.rot ? `rotate(${d.rot}deg)` : "", transformOrigin: "0 0",
        background: d.bgOn ? hexA(d.bg, d.bgOpacity ?? 0.6) : "rgb(0 0 0 / .25)",
        WebkitTextStroke: d.outline ? `${d.outline * g.s}px ${d.outlineColor}` : "",
      });
    };
    S.edit.place = place;
    place();
    ta.addEventListener("input", () => { it.data.text = ta.value; place(); });
    ta.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (hotkey(e, "Escape") || hotkey(e, "Ctrl+Enter")){ e.preventDefault(); finishEdit(); }
    });
    ta.addEventListener("blur", (e) => {
      // Styling the text from the props bar keeps the editor open (focus comes back to it).
      if (e.relatedTarget && S.bar?.contains(e.relatedTarget)) return;
      setTimeout(() => { if (S.edit?.ta === ta && document.activeElement !== ta && !S.bar?.contains(document.activeElement)) finishEdit(); }, 0);
    });
    ta.addEventListener("pointerdown", (e) => e.stopPropagation());
    // Focus at once: keys typed before the next frame would otherwise hit the tool shortcuts.
    // (pointerdown was preventDefault-ed, so no mousedown comes along to move the focus away.)
    ta.focus();
    ta.select();
    requestAnimationFrame(() => { if (S.edit?.ta === ta && document.activeElement !== ta) ta.focus(); });
    renderProps();
  }
  function finishEdit(){
    const E = S.edit;
    if (!E) return;
    S.edit = null;
    E.ta.remove();
    const it = E.it;
    S.layer?.els.get(it.id)?.removeAttribute("opacity"); // hidden under the editor while it was open
    it.data.text = E.ta.value.replace(/\s+$/, "");
    if (!it.data.text){
      if (!E.isNew) commit([it.id], () => S.items.delete(it.id));
      else S.items.delete(it.id);
      afterChange();
      return;
    }
    if (E.isNew) commit([it.id], () => S.items.set(it.id, it));
    else {
      const after = snap(it);
      S.items.set(it.id, structuredClone(E.before));
      commit([it.id], () => S.items.set(it.id, after));
    }
    S.sel = new Set([it.id]);
    afterChange();
  }
  function hexA(hex, a){
    const n = parseInt(String(hex || "#000000").slice(1), 16);
    return `rgb(${n >> 16 & 255} ${n >> 8 & 255} ${n & 255} / ${a})`;
  }

  // ---- selection commands ---------------------------------------------------------------------
  // Removes every drawing on screen now, in one undo step: while a new note is being made that is
  // its drawings, with a note picked that note's, else all on this frame / picture / view.
  function clearShown(){
    if (S.hidden){ toast("Drawings are hidden (Shift+H)"); return; }
    finishEdit();
    const ids = visibleDrawings().map((it) => it.id);
    if (!ids.length){ toast("No drawings on screen"); return; }
    commit(ids, () => { for (const id of ids) S.items.delete(id); });
    toast(`Cleared ${ids.length} drawing${ids.length > 1 ? "s" : ""} · Ctrl+Z brings ${ids.length > 1 ? "them" : "it"} back`, 2600);
  }
  function deleteSelection(){
    const ids = [...S.sel].filter((id) => S.items.has(id));
    if (!ids.length) return false;
    commit(ids, () => { for (const id of ids) S.items.delete(id); });
    S.sel.clear();
    afterChange();
    return true;
  }
  function duplicateSelection(offset = 16, inPlace){
    const src = [...S.sel].map((id) => S.items.get(id)).filter(Boolean);
    if (!src.length) return false;
    const off = offset * k();
    const fresh = src.map((it) => {
      const n = structuredClone(it);
      n.id = uid(); n.z = nextZ() + src.indexOf(it);
      transformItem(n, it, (x, y) => [x + off, y + off]);
      n.data.note = null; n.data.created = Date.now(); n.data.ctx = ctxNow(false) || n.data.ctx;
      return n;
    });
    commit(fresh.map((n) => n.id), () => { for (const n of fresh) S.items.set(n.id, n); });
    if (inPlace){
      // Alt+drag: the originals stay put, the copies are the ones being dragged.
      S.sel = new Set(fresh.map((n) => n.id));
    } else S.sel = new Set(fresh.map((n) => n.id));
    afterChange();
    return true;
  }
  function copySelection(){
    const src = [...S.sel].map((id) => S.items.get(id)).filter(Boolean);
    if (!src.length) return false;
    S.clip = src.map(snap);
    toast(`Copied ${src.length}`);
    return true;
  }
  function paste(){
    if (!S.clip?.length) return false;
    const off = 20 * k();
    const fresh = S.clip.map((it, i) => {
      const n = structuredClone(it);
      n.id = uid(); n.z = nextZ() + i;
      transformItem(n, it, (x, y) => [x + off, y + off]);
      n.data.note = null; n.data.ctx = ctxNow(false); n.data.created = Date.now();
      return n;
    });
    S.clip = fresh.map(snap);
    commit(fresh.map((n) => n.id), () => { for (const n of fresh) S.items.set(n.id, n); });
    S.sel = new Set(fresh.map((n) => n.id));
    afterChange();
    return true;
  }
  function nudge(dx, dy){
    const ids = [...S.sel];
    if (!ids.length) return false;
    const kk = k();
    commit(ids, () => {
      for (const id of ids){ const it = S.items.get(id), src = snap(it); transformItem(it, src, (x, y) => [x + dx * kk, y + dy * kk]); }
    }, "nudge");
    return true;
  }
  function reorder(dir){
    const ids = [...S.sel];
    if (!ids.length) return false;
    const all = [...S.items.values()].filter(isDrawing).sort((a, b) => a.z - b.z);
    const sel = all.filter((it) => S.sel.has(it.id)), rest = all.filter((it) => !S.sel.has(it.id));
    const order = dir > 0 ? [...rest, ...sel] : [...sel, ...rest];
    commit(order.map((it) => it.id), () => order.forEach((it, i) => { it.z = i + 1; }));
    return true;
  }
  function selectAll(){
    S.sel = new Set(visibleDrawings().map((it) => it.id));
    renderSel(); renderProps();
    return true;
  }

  // ---- toolbar / props ------------------------------------------------------------------------
  function buildBar(lightEl){
    const bar = document.createElement("div");
    bar.className = "an-top";
    bar.hidden = true;
    bar.innerHTML = `
      <div class="an-bar">
        ${TOOLS.map((t) => t ? `<button type="button" class="an-tool" data-tool="${t[0]}" title="${esc(t[2])} (${t[1].replace("Key", "")})">${t[3]}</button>` : `<span class="an-sep"></span>`).join("")}
        <span class="an-sep"></span>
        <button type="button" class="an-tool" data-act="shot" title="Screenshot to the note (S)">${ICON.shot}</button>
        <button type="button" class="an-tool" data-act="region" title="Screenshot of an area (Shift+S)">${ICON.region}</button>
        <span class="an-sep"></span>
        <button type="button" class="an-tool" data-act="undo" title="Undo (Ctrl+Z)">${ICON.undo}</button>
        <button type="button" class="an-tool" data-act="redo" title="Redo (Ctrl+Shift+Z)">${ICON.redo}</button>
        <button type="button" class="an-tool" data-act="clear" title="Clear the drawings on screen (Shift+Delete)">${ICON.trash}</button>
        <span class="an-sep"></span>
        <button type="button" class="an-tool" data-act="onion" data-only="video" title="Onion skin — drawings within ±1 s, faded">${ICON.onion}</button>
        <button type="button" class="an-tool" data-act="hide" title="Hide / show drawings (Shift+H)">${ICON.eye}</button>
        <button type="button" class="an-tool" data-act="panel" title="Review notes panel (C)">${ICON.panel}</button>
        <button type="button" class="an-tool" data-act="exit" title="Leave annotation mode (A / Esc)">${ICON.close}</button>
      </div>
      <div class="an-props"></div>`;
    bar.addEventListener("pointerdown", (e) => e.stopPropagation());
    // While a text is being edited, the bar's buttons must not take the focus from it.
    bar.addEventListener("mousedown", (e) => { if (S.edit && !e.target.closest("input, select")) e.preventDefault(); });
    bar.querySelectorAll("[data-tool]").forEach((b) => { b.onclick = () => setTool(b.dataset.tool); });
    bar.querySelector("[data-act=undo]").onclick = () => undo();
    bar.querySelector("[data-act=redo]").onclick = () => redo();
    bar.querySelector("[data-act=clear]").onclick = () => clearShown();
    bar.querySelector("[data-act=shot]").onclick = () => screenshot(false);
    bar.querySelector("[data-act=region]").onclick = () => screenshot(true);
    bar.querySelector("[data-act=onion]").onclick = () => { S.onion = !S.onion; paintBar(); paintVisibility(); };
    bar.querySelector("[data-act=hide]").onclick = () => toggleHidden();
    bar.querySelector("[data-act=panel]").onclick = () => togglePanel();
    bar.querySelector("[data-act=exit]").onclick = () => toggle(false);
    lightEl.appendChild(bar);
    return bar;
  }
  function paintBar(){
    const bar = S.bar;
    if (!bar) return;
    bar.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === S.tool));
    bar.querySelector("[data-act=onion]").classList.toggle("on", S.onion);
    bar.querySelector("[data-act=onion]").hidden = S.kind !== "video";
    const hide = bar.querySelector("[data-act=hide]");
    hide.classList.toggle("on", S.hidden);
    hide.innerHTML = S.hidden ? ICON.eyeOff : ICON.eye;
    bar.querySelector("[data-act=panel]").classList.toggle("on", S.panelOn);
  }
  function setTool(t){
    if (!PROPS[t]) return;
    finishEdit();
    S.tool = t;
    if (t !== "select" && S.sel.size){ S.sel.clear(); renderSel(); }
    paintBar();
    renderProps();
    if (S.hover) updateCursor(...S.hover);
    renderSel();
  }

  // The props bar shows the selection's properties when something is selected, else the tool's.
  function propsTarget(){
    const sel = [...S.sel].map((id) => S.items.get(id)).filter(Boolean);
    if (S.edit) return { items: [S.edit.it], type: "text" };
    if (sel.length){
      const types = [...new Set(sel.map(typeOf))];
      return { items: sel, type: types.length === 1 ? types[0] : null, types };
    }
    return { items: null, type: S.tool };
  }
  function propValue(tg, p){
    if (!tg.items) return S.styles[tg.type][p.k];
    const v = tg.items[0].data[p.k];
    return LEN_KEYS.has(p.k) && typeof v === "number" ? v / k() : v;
  }
  function renderProps(){
    const el = S.bar?.querySelector(".an-props");
    if (!el) return;
    const tg = propsTarget();
    let list = tg.type ? PROPS[tg.type] || [] : [P.color, P.opacity].filter((p) => tg.types.every((t) => PROPS[t]?.some((q) => q.k === p.k)));
    if (tg.items) list = list.filter((p) => !p.create);
    let html = "";
    if (tg.items) html += `<span class="an-pl">${tg.items.length > 1 ? tg.items.length + " selected" : (tg.type || "")}</span>`;
    for (const p of list){
      const v = propValue(tg, p);
      if (p.t === "color"){
        html += `<label class="an-pc" title="${esc(p.label)}"><input type="color" data-k="${p.k}" value="${esc(v || "#000000")}"></label>`;
        if (p.k === "color") html += `<span class="an-sw">${SWATCHES.map((c) => `<i data-sw="${c}" style="background:${c}" title="${c}"></i>`).join("")}</span>`;
      } else if (p.t === "num"){
        html += `<span class="an-num" data-k="${p.k}" data-p="${list.indexOf(p)}" title="Drag, scroll or click to type"><b>${esc(p.label)}</b><em>${fmtNum(p, v)}</em></span>`;
      } else if (p.t === "toggle"){
        html += `<button type="button" class="an-tg${p.cls ? " " + p.cls : ""}${v ? " on" : ""}" data-k="${p.k}" title="${esc(p.title || p.label)}">${esc(p.label)}</button>`;
      } else if (p.t === "select"){
        html += `<label class="an-psel" title="${esc(p.label)}"><span>${esc(p.label)}</span><select data-k="${p.k}">${p.options.map(([id, n]) => `<option value="${id}"${id === v ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></label>`;
      } else if (p.t === "seg"){
        html += `<span class="an-seg" title="${esc(p.label)}">${p.options.map(([id, n]) => `<button type="button" data-k="${p.k}" data-v="${id}" class="${id === v ? "on" : ""}">${esc(n)}</button>`).join("")}</span>`;
      }
    }
    if (S.kind === "video" && !tg.items && S.tool !== "select" && S.tool !== "eraser"){
      html += `<label class="an-psel" title="How long new drawings stay on screen"><span>Hold</span><select data-hold>${HOLDS.map(([v, n]) => `<option value="${v}"${v === S.hold ? " selected" : ""}>${n}</option>`).join("")}</select></label>`;
    }
    if (tg.items && tg.items.some((it) => S.kind === "video" && it.data.ctx?.t != null)){
      const h = tg.items[0].data.ctx?.hold ?? 0;
      html += `<label class="an-psel" title="How long the selection stays on screen"><span>Hold</span><select data-shold>${HOLDS.map(([v, n]) => `<option value="${v}"${v === h ? " selected" : ""}>${n}</option>`).join("")}</select></label>`;
    }
    if (tg.items){
      html += `<span class="an-sep"></span><button type="button" class="an-tg" data-cmd="front" title="Bring to front (Ctrl+])">Front</button><button type="button" class="an-tg" data-cmd="back" title="Send to back (Ctrl+[)">Back</button><button type="button" class="an-tg" data-cmd="del" title="Delete (Del)">${ICON.trash}</button>`;
    }
    if (!html) html = `<span class="an-pl">${S.tool === "select" ? (S.kind === "model3d" ? "Click a drawing to select · drag empty space to orbit" : "Click or drag to select · Alt+drag duplicates") : ""}</span>`;
    el.innerHTML = html;
    el.hidden = !html;
    bindProps(el, tg, list);
  }
  function fmtNum(p, v){
    if (v == null || Number.isNaN(v)) return "—";
    if (p.pct) return Math.round(v * 100) + "%";
    if (p.unit === "×") return (Math.round(v * 10) / 10) + "×";
    return (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10) + (p.unit === "px" ? "" : p.unit || "");
  }
  function setProp(p, v, merge){
    const tg = propsTarget();
    if (!tg.items){
      S.styles[tg.type][p.k] = v;
      saveStyles();
      return;
    }
    const ids = tg.items.map((it) => it.id).filter((id) => S.items.has(id));
    const dv = LEN_KEYS.has(p.k) && typeof v === "number" ? v * k() : v;
    if (S.edit){ S.edit.it.data[p.k] = dv; S.edit.place(); if (p.t !== "color") S.edit.ta.focus(); return; }
    commit(ids, () => { for (const id of ids){ const it = S.items.get(id); if (PROPS[typeOf(it)]?.some((q) => q.k === p.k)) it.data[p.k] = dv; } }, merge ? "prop:" + p.k : null);
  }
  function bindProps(el, tg, list){
    el.querySelectorAll("input[type=color][data-k]").forEach((inp) => {
      const p = list.find((q) => q.k === inp.dataset.k && q.t === "color");
      inp.addEventListener("input", () => setProp(p, inp.value, true));
    });
    el.querySelectorAll("[data-sw]").forEach((sw) => {
      sw.onclick = () => { setProp(P.color, sw.dataset.sw, false); renderProps(); };
    });
    el.querySelectorAll("button[data-k]:not([data-v])").forEach((b) => {
      const p = list.find((q) => q.k === b.dataset.k);
      b.onclick = () => { setProp(p, !propValue(propsTarget(), p), false); renderProps(); };
    });
    el.querySelectorAll("button[data-v]").forEach((b) => {
      const p = list.find((q) => q.k === b.dataset.k);
      b.onclick = () => { setProp(p, b.dataset.v, false); renderProps(); };
    });
    el.querySelectorAll("select[data-k]").forEach((s) => {
      const p = list.find((q) => q.k === s.dataset.k);
      s.addEventListener("change", () => { setProp(p, s.value, false); renderProps(); });
    });
    el.querySelector("select[data-hold]")?.addEventListener("change", (e) => { S.hold = Number(e.target.value); writeJSON("sight.annotate.hold", S.hold); });
    el.querySelector("select[data-shold]")?.addEventListener("change", (e) => {
      const v = Number(e.target.value), ids = tg.items.map((it) => it.id);
      commit(ids, () => { for (const id of ids){ const c = S.items.get(id).data.ctx; if (c && c.t != null) c.hold = v; } });
    });
    el.querySelector("[data-cmd=front]")?.addEventListener("click", () => reorder(1));
    el.querySelector("[data-cmd=back]")?.addEventListener("click", () => reorder(-1));
    el.querySelector("[data-cmd=del]")?.addEventListener("click", () => deleteSelection());
    el.querySelectorAll(".an-num").forEach((n) => bindNum(n, list[Number(n.dataset.p)]));
  }
  // Compact number control: drag sideways, scroll, or click to type.
  function bindNum(el, p){
    const em = el.querySelector("em");
    const get = () => Number(propValue(propsTarget(), p)) || 0;
    const set = (v, merge) => {
      v = clamp(v, p.min, p.max);
      if (!p.pct && p.unit !== "×") v = v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
      else if (p.pct) v = Math.round(v * 100) / 100;
      setProp(p, v, merge);
      em.textContent = fmtNum(p, v);
    };
    const stepBy = (v, n) => p.exp ? v * Math.exp(n * 0.012) : v + n * (p.pct ? 0.005 : (p.max - p.min) / 300);
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const x0 = e.clientX, v0 = get();
      let moved = false;
      const mv = (ev) => {
        const dx = ev.clientX - x0;
        if (!moved && Math.abs(dx) < 3) return;
        moved = true;
        set(stepBy(v0 || (p.exp ? p.min : 0), dx * (ev.shiftKey ? 0.2 : 1)), true);
      };
      const up = () => {
        el.removeEventListener("pointermove", mv);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
        if (!moved) typeNum(el, p, get(), (v) => set(v, false));
      };
      el.addEventListener("pointermove", mv);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    });
    el.addEventListener("wheel", (e) => { e.preventDefault(); e.stopPropagation(); set(stepBy(get(), (e.deltaY < 0 ? 8 : -8)), true); }, { passive: false });
    el.addEventListener("contextmenu", (e) => { e.preventDefault(); const dflt = (DEFAULT_STYLES[propsTarget().type] || {})[p.k]; if (dflt != null) set(dflt, false); });
  }
  function typeNum(el, p, v, done){
    const em = el.querySelector("em");
    const inp = document.createElement("input");
    inp.className = "an-numedit";
    inp.value = p.pct ? Math.round(v * 100) : Math.round(v * 10) / 10;
    em.replaceWith(inp);
    inp.focus(); inp.select();
    const end = (ok) => {
      if (!inp.isConnected) return;
      const n = parseFloat(inp.value.replace(",", "."));
      inp.replaceWith(em);
      if (ok && Number.isFinite(n)) done(p.pct ? n / 100 : n);
    };
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (hotkey(e, "Enter")){ e.preventDefault(); end(true); }
      else if (hotkey(e, "Escape")){ e.preventDefault(); end(false); }
    });
    inp.addEventListener("blur", () => end(true));
  }

  // ---- review panel ---------------------------------------------------------------------------
  function buildPanel(lightEl){
    const el = document.createElement("aside");
    el.className = "an-panel";
    el.hidden = true;
    el.innerHTML = `
      <div class="an-ph">
        <b>Review</b>
        <input class="an-who" placeholder="Your name" spellcheck="false" title="Reviewer name stored with every note">
        <button type="button" class="an-ib" data-act="export" title="Export / import">Export ▾</button>
        <button type="button" class="an-ib" data-act="close" title="Hide panel (C)">${ICON.close}</button>
      </div>
      <div class="an-menu" hidden>
        <button type="button" data-ex="pdf">PDF report…</button>
        <button type="button" data-ex="html" title="One file that opens in any browser — the reviewer can reply, resolve and add notes, then send back a .srev">Web page for reviewers (.html)…</button>
        <button type="button" data-ex="pkg">Review file (.srev)…</button>
        <button type="button" data-ex="text">Copy notes as text</button>
        <hr>
        <button type="button" data-ex="import">Import review file…</button>
      </div>
      <div class="an-rs"><span>State</span><div class="an-seg">
        <button type="button" data-rs="" title="No review state">—</button>
        <button type="button" data-rs="review" title="Waiting for review">Needs review</button>
        <button type="button" data-rs="changes" title="Changes requested">Changes</button>
        <button type="button" data-rs="approved" title="Approved">Approved</button></div></div>
      <div class="an-rsh" hidden></div>
      <div class="an-vers" hidden></div>
      <div class="an-views"></div>
      <div class="an-filt an-seg"></div>
      <div class="an-list"></div>
      <div class="an-compose">
        <div class="an-pend"></div>
        <textarea class="an-input" rows="2" placeholder="Add a note…  Enter adds · Shift+Enter new line"></textarea>
        <div class="an-crow">
          <button type="button" class="an-ib" data-act="shot" title="Screenshot (S)">${ICON.shot}</button>
          <button type="button" class="an-ib" data-act="region" title="Screenshot of an area (Shift+S)">${ICON.region}</button>
          <span class="an-ctx"></span>
          <button type="button" class="btn an-add" data-act="add">Add</button>
        </div>
      </div>
      <input type="file" class="an-file" accept=".srev,.sightreview,application/json" hidden>`;
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
    const who = el.querySelector(".an-who");
    who.value = reviewer();
    who.addEventListener("change", () => { try { host.putSetting("sight.reviewer", who.value.trim()); } catch {} });
    who.addEventListener("keydown", (e) => { e.stopPropagation(); if (hotkey(e, "Enter") || hotkey(e, "Escape")) who.blur(); });
    const menu = el.querySelector(".an-menu"), exBtn = el.querySelector("[data-act=export]");
    exBtn.onclick = () => { menu.hidden = !menu.hidden; };
    host.registerAutoClose?.(menu, () => { menu.hidden = true; }, exBtn);
    menu.querySelectorAll("[data-ex]").forEach((b) => {
      b.onclick = () => {
        menu.hidden = true;
        const x = b.dataset.ex;
        if (x === "pdf") exportPdf();
        else if (x === "html") exportHtml();
        else if (x === "pkg") exportPackage();
        else if (x === "text") copyText();
        else if (x === "import") el.querySelector(".an-file").click();
      };
    });
    el.querySelector(".an-file").addEventListener("change", (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importFile(f); });
    el.querySelector("[data-act=close]").onclick = () => togglePanel(false);
    el.querySelectorAll("[data-rs]").forEach((b) => { b.onclick = () => setStatus(b.dataset.rs); });
    el.querySelector(".an-compose [data-act=shot]").onclick = () => screenshot(false);
    el.querySelector(".an-compose [data-act=region]").onclick = () => screenshot(true);
    el.querySelector("[data-act=add]").onclick = () => addNote();
    const inp = el.querySelector(".an-input");
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (hotkey(e, "Enter")){ e.preventDefault(); addNote(); }
      else if (hotkey(e, "Escape")){ e.preventDefault(); inp.blur(); }
    });
    inp.addEventListener("input", () => { inp.style.height = "auto"; inp.style.height = Math.min(160, inp.scrollHeight + 2) + "px"; modeChanged(); });
    // Typing a new note shows the clean picture (with only the new note's drawings).
    inp.addEventListener("focus", modeChanged);
    inp.addEventListener("blur", modeChanged);
    el.querySelector(".an-filt").addEventListener("click", (e) => {
      const b = e.target.closest?.("[data-filt]");
      if (!b) return;
      S.filter = b.dataset.filt;
      writeJSON("sight.annotate.filter", S.filter);
      renderPanel();
    });
    el.querySelector(".an-list").addEventListener("click", onListClick);
    el.querySelector(".an-list").addEventListener("dblclick", onListDblClick);
    el.querySelector(".an-list").addEventListener("pointerover", (e) => {
      const card = e.target.closest?.(".an-note");
      const id = card?.dataset.id || null;
      if (S.focusNote !== id && !S.pinFocus){ S.focusNote = id; paintVisibility(); }
    });
    el.querySelector(".an-list").addEventListener("pointerleave", () => { if (!S.pinFocus){ S.focusNote = null; paintVisibility(); } });
    el.querySelector(".an-pend").addEventListener("click", (e) => {
      const x = e.target.closest?.("[data-rm]");
      if (x){ S.pending.splice(Number(x.dataset.rm), 1); renderPending(); return; }
      const im = e.target.closest?.("img[data-src]");
      if (im) showShot(im.dataset.src);
    });
    lightEl.appendChild(el);
    return el;
  }
  function focusComposer(){
    if (!S.panelOn) togglePanel(true);
    requestAnimationFrame(() => S.ui?.querySelector(".an-input")?.focus());
  }
  function togglePanel(force){
    S.panelOn = force ?? !S.panelOn;
    writeJSON("sight.annotate.panel", S.panelOn);
    syncPanel();
  }
  function syncPanel(){
    const show = S.on && S.panelOn && !!S.ui;
    if (S.ui) S.ui.hidden = !show;
    S.light?.classList.toggle("an-panel-on", show);
    paintBar();
    if (show) renderPanel();
  }
  // Drawings a new note picks up: not attached to a note yet and on screen right now.
  const pendingDrawings = () => [...S.items.values()].filter((it) => isDrawing(it) && !it.data.note && ctxShown(it));
  function renderPanel(){
    const el = S.ui;
    if (!el || el.hidden) return;
    // The cards are rebuilt under the pointer: a hover on a card that is gone must not stay.
    if (S.focusNote && S.focusNote !== S.pinFocus){ S.focusNote = S.pinFocus; queueMicrotask(() => paintVisibility()); }
    const all = notesSorted(), num = new Map(all.map((n, i) => [n.id, i + 1]));
    const stOf = (n) => n.data.status === "done" ? "done" : n.data.status === "progress" ? "progress" : "open";
    const tally = { all: all.length, open: 0, progress: 0, done: 0 };
    for (const n of all) tally[stOf(n)]++;
    if (!(S.filter in tally)) S.filter = "all";
    const filt = el.querySelector(".an-filt");
    filt.hidden = !all.length;
    filt.innerHTML = [["all", "All"], ["open", "Open"], ["progress", "In progress"], ["done", "Resolved"]].map(([k, l]) =>
      `<button type="button" data-filt="${k}" class="${S.filter === k ? "on" : ""}">${l}<i class="an-fc ${k}${tally[k] ? "" : " zero"}">${tally[k]}</i></button>`).join("");
    const notes = S.filter === "all" ? all : all.filter((n) => stOf(n) === S.filter);
    const list = el.querySelector(".an-list");
    const scroll = list.scrollTop;
    const counts = new Map();
    for (const it of S.items.values()) if (isDrawing(it) && it.data.note) counts.set(it.data.note, (counts.get(it.data.note) || 0) + 1);
    list.innerHTML = !all.length ? "" : !notes.length ? `<div class="an-hint"><p>No ${S.filter === "done" ? "resolved" : S.filter === "progress" ? "in-progress" : "open"} notes.</p></div>` : notes.map((n) => {
      const i = num.get(n.id) - 1;
      const d = n.data, done = d.status === "done", prog = d.status === "progress";
      const shots = (d.shots || []).map((sid) => `<img src="/api/review/shots/${sid}" data-src="/api/review/shots/${sid}" data-shot="${sid}" alt="" loading="lazy">`).join("");
      const ctx = ctxLabel(d.ctx);
      return `<div class="an-note${done ? " done" : prog ? " prog" : ""}${S.pinFocus === n.id ? " on" : ""}" data-id="${n.id}">
        <div class="an-nh"><span class="an-nn">${i + 1}</span>${ctx ? `<button type="button" class="an-nctx" data-go="${n.id}" title="Go to">${S.kind === "model3d" ? ICON.view : ""}${esc(ctx)}</button>` : ""}<span class="an-nwho">${esc(d.author || "")}${d.author ? " · " : ""}${esc(fmtDate(d.created))}</span>
          <button type="button" class="an-ib sm" data-reply="${n.id}" title="Reply">${ICON.reply}</button>
          <button type="button" class="an-ib sm${prog ? " on" : ""}" data-prog="${n.id}" title="${prog ? "Not in progress" : "In progress — someone is working on it"}">${ICON.prog}</button>
          <button type="button" class="an-ib sm${done ? " on" : ""}" data-done="${n.id}" title="${done ? "Reopen" : "Resolve"}">${ICON.check}</button>
          <button type="button" class="an-ib sm" data-del="${n.id}" title="Delete note and its drawings">${ICON.trash}</button></div>
        <div class="an-nt" title="Double-click to edit">${esc(d.text || "") || '<i class="an-empty">No text</i>'}</div>
        ${notePreview(n)}
        ${shots ? `<div class="an-shots">${shots}</div>` : ""}
        ${counts.get(n.id) || d.from ? `<div class="an-nmeta">${[counts.get(n.id) ? `${counts.get(n.id)} drawing${counts.get(n.id) > 1 ? "s" : ""}` : "", d.from ? `from ${esc(d.from.name || "previous version")}` : ""].filter(Boolean).join(" · ")}</div>` : ""}
        ${repliesHtml(n)}
      </div>`;
    }).join("");
    if (!all.length) list.innerHTML = `<div class="an-hint"><p>No notes yet.</p><p>Draw on the ${S.kind === "model3d" ? "view" : S.kind === "video" ? "frame" : "picture"}, then type a note below — the drawings are attached to it.${S.kind === "video" ? " Notes are pinned to the current frame and show as markers on the timeline." : S.kind === "model3d" ? " The camera, shading and lights are saved with the note." : ""}</p><p><b>S</b> screenshot · <b>Shift+S</b> area</p></div>`;
    list.scrollTop = scroll;
    renderViews();
    renderPending();
    renderVersions();
    paintStatus();
  }
  // ---- note previews: the clean picture / video frame with the note's drawings over it (vector,
  // nothing burned in) ---------------------------------------------------------------------------
  function notePreview(n){
    if (!S.b2 || (S.kind !== "image" && S.kind !== "psd" && S.kind !== "video")) return "";
    return previewBox(n, [...S.items.values()].filter((it) => isDrawing(it) && it.data.note === n.id && !it.data.reply), "");
  }
  // A reply's drawings (made on the HTML page or the phone) on the note's picture, under the reply.
  function replyPreview(n, r){
    if (S.hiddenReplies.has(r.id)) return "";
    return previewBox(n, replyDrawings(n.id, r.id), " sm");
  }
  function previewBox(n, list, cls){
    if (!S.b2 || (S.kind !== "image" && S.kind !== "psd" && S.kind !== "video")) return "";
    const g = geom();
    if (!list.length || !g?.nw || !g?.nh) return "";
    let img;
    if (S.kind === "video"){
      const t = n.data.ctx?.t;
      if (t == null) return "";
      const url = previewFrame(t);
      img = url ? `<img src="${url}" alt="">` : `<img data-ft="${Number(t).toFixed(3)}" alt="">`;
    } else img = `<img src="${esc(S.b2.media.currentSrc || S.b2.media.src || "")}" alt="">`;
    return `<div class="an-nprev${cls}" style="aspect-ratio:${g.nw} / ${g.nh}" title="Show this note's drawings">${img}<svg viewBox="0 0 ${g.nw} ${g.nh}" preserveAspectRatio="none">${RC.svgMarkup(list, numOf)}</svg></div>`;
  }
  // Video frames for the previews: a second, hidden player of the same file, one seek at a time,
  // kept per time for the open asset.
  const PF = { aid: null, v: null, cache: new Map(), want: [], busy: false };
  function resetPF(){
    if (PF.v){ PF.v.removeAttribute("src"); PF.v.load(); }
    PF.v = null; PF.aid = null; PF.cache.clear(); PF.want = []; PF.busy = false;
  }
  function previewFrame(t){
    const key = Number(t).toFixed(3);
    if (PF.aid !== S.asset?.id){ resetPF(); PF.aid = S.asset?.id || null; }
    const hit = PF.cache.get(key);
    if (hit) return hit;
    if (!PF.want.includes(key)) PF.want.push(key);
    queueMicrotask(pumpPF);
    return null;
  }
  async function pumpPF(){
    if (PF.busy || !PF.want.length || !PF.aid) return;
    PF.busy = true;
    const aid = PF.aid;
    try {
      if (!PF.v){
        const v = document.createElement("video");
        v.muted = true; v.preload = "auto"; v.playsInline = true; v.src = `/api/file/${aid}`;
        PF.v = v;
        await new Promise((ok, no) => { v.addEventListener("loadeddata", ok, { once: true }); v.addEventListener("error", () => no(new Error("video")), { once: true }); });
      }
      while (PF.want.length && PF.aid === aid){
        const key = PF.want.shift(), v = PF.v;
        await new Promise((ok) => {
          let to = 0;
          const done = () => { clearTimeout(to); v.removeEventListener("seeked", done); ok(); };
          v.addEventListener("seeked", done);
          to = setTimeout(done, 4000);
          v.currentTime = Number(key);
        });
        if (PF.aid !== aid || !v.videoWidth) break;
        const w = Math.min(480, v.videoWidth), h = Math.max(1, Math.round(w * v.videoHeight / v.videoWidth));
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(v, 0, 0, w, h);
        const url = c.toDataURL("image/jpeg", 0.8);
        PF.cache.set(key, url);
        S.ui?.querySelectorAll(`img[data-ft="${key}"]`).forEach((im) => { im.src = url; im.removeAttribute("data-ft"); });
      }
    } catch (e){ console.warn("note frame", e); }
    finally { if (PF.aid === aid) PF.busy = false; }
  }
  const liveReplies = (n) => (n.data.replies || []).filter((r) => !r.deleted);
  // A note is open, in progress (someone took it) or done. Every change also leaves an entry in
  // the note's thread (`{id, event: "done"|"progress"|"open", author, created}`), so the history
  // shows who changed the state and when. These entries merge like replies (by id) and are never
  // edited or deleted. Replies may carry pictures (`shots: [id]`, review_shots like a note's).
  const statusEvent = (state) => ({ id: uid(), event: state, author: reviewer(), created: Date.now() });
  const EVENT = { done: ["✓", "Resolved"], progress: ["▸", "In progress"], open: ["↺", "Reopened"] };
  const eventLabel = (r) => (EVENT[r.event] || EVENT.open)[1];
  const eventIcon = (r) => (EVENT[r.event] || EVENT.open)[0];
  // Eye + count for a reply that carries drawings: shows / hides them on the picture.
  function rdrawChip(n, r){
    const c = replyDrawings(n.id, r.id).length;
    if (!c) return "";
    const off = S.hiddenReplies.has(r.id);
    return `<button type="button" class="an-rdraw${off ? " off" : ""}" data-rdraw="${esc(r.id)}" title="${off ? "Show" : "Hide"} this reply's drawing${c > 1 ? "s" : ""}">${off ? ICON.eyeOff : ICON.eye}${c}</button>`;
  }
  function repliesHtml(n){
    const list = liveReplies(n);
    if (!list.length) return "";
    return `<div class="an-replies">${list.map((r) => r.event ? `<div class="an-rep an-rev ${r.event === "done" ? "done" : r.event === "progress" ? "prog" : ""}" data-rid="${esc(r.id)}">
      <span>${eventIcon(r)} ${eventLabel(r)}${r.author ? " by " + esc(r.author) : ""} · ${esc(fmtDate(r.created))}</span></div>` : `<div class="an-rep" data-rid="${esc(r.id)}">
      <div class="an-rh"><span>${esc(r.author || "")}${r.author ? " · " : ""}${esc(fmtDate(r.created))}${r.edited ? " · edited" : ""}</span>${rdrawChip(n, r)}<button type="button" class="an-ib sm" data-rdel="${esc(r.id)}" title="Delete reply">${ICON.close}</button></div>
      ${r.text ? `<div class="an-rt" title="Double-click to edit">${esc(r.text)}</div>` : ""}
      ${replyPreview(n, r)}
      ${r.shots?.length ? `<div class="an-shots">${r.shots.map((sid) => `<img src="/api/review/shots/${esc(sid)}" data-rshot="/api/review/shots/${esc(sid)}" alt="" loading="lazy">`).join("")}</div>` : ""}</div>`).join("")}</div>`;
  }
  // Inline editor under a note card (new reply) or in place of a reply's text (edit).
  function replyEditor(card, anchor, initial, done){
    const ta = document.createElement("textarea");
    ta.className = "an-input an-redit";
    ta.rows = 1;
    ta.placeholder = "Reply…  Enter sends · Esc cancels";
    ta.value = initial;
    if (anchor) anchor.replaceWith(ta); else card.appendChild(ta);
    ta.style.height = Math.min(160, ta.scrollHeight + 2) + "px";
    ta.focus();
    ta.addEventListener("click", (e) => e.stopPropagation());
    ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(160, ta.scrollHeight + 2) + "px"; });
    let ended = false; // removing the field blurs it, which calls end() a second time
    const end = (ok) => {
      if (ended || !ta.isConnected) return;
      ended = true;
      const v = ta.value.trim();
      ta.remove();
      if (ok && v && v !== initial) done(v); else renderPanel();
    };
    ta.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (hotkey(ev, "Enter")){ ev.preventDefault(); end(true); }
      else if (hotkey(ev, "Escape")){ ev.preventDefault(); end(false); }
    });
    ta.addEventListener("blur", () => end(true));
  }
  function startReply(id){
    const card = S.ui?.querySelector(`.an-note[data-id="${id}"]`);
    if (!card || card.querySelector(".an-redit")) return;
    replyEditor(card, null, "", (text) => {
      commit([id], () => {
        const d = S.items.get(id).data;
        d.replies = [...(d.replies || []), { id: uid(), text, author: reviewer(), created: Date.now() }];
      });
    });
  }
  function editReply(id, rid, el){
    const r = (S.items.get(id)?.data.replies || []).find((x) => x.id === rid);
    if (!r) return;
    replyEditor(el.closest(".an-note"), el, r.text || "", (text) => {
      commit([id], () => {
        const d = S.items.get(id).data;
        d.replies = d.replies.map((x) => (x.id === rid ? { ...x, text, edited: Date.now() } : x));
      });
    });
  }
  // A deleted reply stays as a tombstone so merging a review file from before the delete
  // does not bring it back (see Library.merge_replies).
  // Its drawings (data.reply) go with it, in the same undo step.
  function deleteReply(id, rid){
    const drawn = replyDrawings(id, rid).map((it) => it.id);
    commit([id, ...drawn], () => {
      const d = S.items.get(id).data;
      d.replies = (d.replies || []).map((x) => (x.id === rid ? { id: x.id, created: x.created, deleted: Date.now() } : x));
      for (const x of drawn) S.items.delete(x);
    });
    S.hiddenReplies.delete(rid);
  }
  const replyDrawings = (id, rid) => [...S.items.values()].filter((it) => isDrawing(it) && it.data.note === id && it.data.reply === rid);
  function renderPending(){
    const el = S.ui;
    if (!el) return;
    const pend = el.querySelector(".an-pend");
    pend.innerHTML = S.pending.map((p, i) => `<span class="an-pshot"><img src="${p.url}" data-src="${p.url}" alt=""><button type="button" data-rm="${i}" title="Remove">×</button></span>`).join("");
    pend.hidden = !S.pending.length;
    const n = pendingDrawings().length;
    const c = ctxLabel(ctxNow(false));
    el.querySelector(".an-ctx").textContent = [c, n ? `+${n} drawing${n > 1 ? "s" : ""}` : ""].filter(Boolean).join("  ·  ");
  }
  function renderViews(){
    const el = S.ui?.querySelector(".an-views");
    if (!el) return;
    if (S.kind !== "model3d" || !S.views.size){ el.innerHTML = ""; el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `<span>Views</span>` + [...S.views.values()].map((v, i) => `<button type="button" class="an-vchip${v.vk === S.curVk ? " on" : ""}" data-vk="${v.vk}" title="Restore this camera${v.v3d ? ", shading and lights" : ""}">${i + 1}</button>`).join("");
    el.querySelectorAll("[data-vk]").forEach((b) => { b.onclick = () => goView(b.dataset.vk); });
  }
  function onListClick(e){
    const t = e.target.closest?.("[data-go],[data-done],[data-prog],[data-del],[data-reply],[data-rdel],[data-rdraw],img[data-shot],img[data-rshot],.an-rep,.an-note");
    if (!t) return;
    if (t.dataset.rdraw){
      const rid = t.dataset.rdraw;
      if (S.hiddenReplies.has(rid)) S.hiddenReplies.delete(rid);
      else {
        S.hiddenReplies.add(rid);
        // Hidden drawings must not stay selected: Delete would remove them unseen.
        for (const it of S.items.values()) if (it.data.reply === rid) S.sel.delete(it.id);
        renderProps();
      }
      paintVisibility(); renderSel(); renderPanel();
      return;
    }
    if (t.dataset.reply){ startReply(t.dataset.reply); return; }
    if (t.dataset.rdel){ deleteReply(t.closest(".an-note").dataset.id, t.dataset.rdel); return; }
    if (t.dataset.rshot){ showShot(t.dataset.rshot); return; }
    if (t.classList.contains("an-rep")) return;
    if (t.dataset.done || t.dataset.prog){
      const id = t.dataset.done || t.dataset.prog, want = t.dataset.done ? "done" : "progress";
      commit([id], () => {
        const d = S.items.get(id).data;
        d.status = d.status === want ? "open" : want;
        d.status_at = Date.now();
        d.replies = [...(d.replies || []), statusEvent(d.status)];
      });
      return;
    }
    if (t.dataset.del){
      const id = t.dataset.del;
      const ids = [id, ...[...S.items.values()].filter((it) => it.data.note === id).map((it) => it.id)];
      commit(ids, () => { for (const x of ids) S.items.delete(x); });
      if (S.pinFocus === id) S.pinFocus = null;
      return;
    }
    if (t.dataset.shot){
      if (e.altKey){
        const card = t.closest(".an-note"), id = card.dataset.id, sid = t.dataset.shot;
        commit([id], () => { const d = S.items.get(id).data; d.shots = (d.shots || []).filter((x) => x !== sid); d.edited_at = Date.now(); });
        return;
      }
      showShot(t.dataset.src);
      return;
    }
    const card = t.closest(".an-note");
    if (card) goNote(card.dataset.id);
  }
  function onListDblClick(e){
    const rt = e.target.closest?.(".an-rt");
    if (rt){ editReply(rt.closest(".an-note").dataset.id, rt.closest(".an-rep").dataset.rid, rt); return; }
    const nt = e.target.closest?.(".an-nt");
    if (!nt) return;
    const id = nt.closest(".an-note").dataset.id, it = S.items.get(id);
    if (!it) return;
    const ta = document.createElement("textarea");
    ta.className = "an-input an-nedit";
    ta.value = it.data.text || "";
    nt.replaceWith(ta);
    ta.style.height = Math.min(220, ta.scrollHeight + 4) + "px";
    ta.focus();
    let ended = false;
    const end = (ok) => {
      if (ended || !ta.isConnected) return;
      ended = true;
      const v = ta.value.trim();
      ta.remove();
      // edited_at: the note's content stamp — merging a review file compares it, not the row's
      // updated_at (which replies and resolving also move; see Library._content_at).
      if (ok && v !== (it.data.text || "")) commit([id], () => { const d = S.items.get(id).data; d.text = v; d.edited_at = Date.now(); });
      else renderPanel();
    };
    ta.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (hotkey(ev, "Enter")){ ev.preventDefault(); end(true); }
      else if (hotkey(ev, "Escape")){ ev.preventDefault(); end(false); }
    });
    ta.addEventListener("blur", () => end(true));
  }
  function goNote(id){
    const n = S.items.get(id);
    if (!n) return;
    S.pinFocus = S.pinFocus === id ? null : id;
    S.focusNote = S.pinFocus;
    const c = n.data.ctx;
    if (c?.t != null){ const v = video(); if (v){ v.pause(); v.currentTime = c.t; } }
    if (c?.vk) goView(c.vk, c.v3d);
    S.sel = new Set();
    renderSel(); renderProps(); renderPanel(); paintVisibility();
  }
  function goView(vk, v3d){
    const v = S.views.get(vk);
    if (!v || !S.b3) return;
    const look = v3d || v.v3d;
    if (look) host.setV3D?.(look);
    S.b3.setCam(v.cam);
    S.curVk = vk;
    afterChange();
  }
  function showShot(src){
    const ov = document.createElement("div");
    ov.className = "an-shotview";
    ov.innerHTML = `<img src="${src}" alt="">`;
    ov.onclick = () => ov.remove();
    ov.addEventListener("pointerdown", (e) => e.stopPropagation());
    S.light?.appendChild(ov);
  }

  async function addNote(){
    const inp = S.ui?.querySelector(".an-input");
    const text = (inp?.value || "").trim();
    if (!text && !S.pending.length && !pendingDrawings().length){ toast("Type a note, draw, or take a screenshot first"); return; }
    const ctx = ctxNow(true);
    const note = { id: uid(), kind: "note", sub: null, z: 0, data: { text, author: reviewer(), created: Date.now(), status: "open", ctx, shots: S.pending.map((p) => p.id) } };
    const linked = pendingDrawings();
    commit([note.id, ...linked.map((it) => it.id)], () => {
      S.items.set(note.id, note);
      for (const it of linked) it.data.note = note.id;
    });
    S.pending = [];
    // Leave the field so S / Shift+S / tool keys work again straight away.
    if (inp){ inp.value = ""; inp.style.height = ""; inp.blur(); }
    S.sel.clear();
    afterChange();
    const list = S.ui?.querySelector(".an-list");
    requestAnimationFrame(() => list?.querySelector(`[data-id="${note.id}"]`)?.scrollIntoView({ block: "nearest" }));
  }

  // ---- timeline markers -----------------------------------------------------------------------
  function renderMarks(){
    const track = S.bar && S.light?.querySelector(".vbar .vtrack");
    if (!track) return;
    let box = track.querySelector(".an-marks");
    const v = S.kind === "video" ? video() : null;
    const dur = v && Number.isFinite(v.duration) ? v.duration : (S.asset?.duration || 0);
    if (!v || !dur){ box?.remove(); return; }
    if (!box){
      box = document.createElement("div");
      box.className = "an-marks";
      track.appendChild(box);
      box.addEventListener("pointerdown", (e) => {
        const m = e.target.closest?.("[data-t]");
        if (!m) return;
        e.stopPropagation(); e.preventDefault();
        const vid = video();
        if (vid){ vid.pause(); vid.currentTime = Number(m.dataset.t); }
        if (!S.on) toggle(true);
        if (m.dataset.note) goNote(m.dataset.note);
      });
    }
    const notes = notesSorted();
    const seen = new Set();
    let html = "";
    notes.forEach((n, i) => {
      const t = n.data.ctx?.t;
      if (t == null) return;
      seen.add(t);
      html += `<i class="an-mk note${n.data.status === "done" ? " done" : n.data.status === "progress" ? " prog" : ""}" data-t="${t}" data-note="${n.id}" style="left:${(t / dur * 100).toFixed(3)}%" title="${esc(i + 1 + ". " + (n.data.text || "").slice(0, 80))}"></i>`;
    });
    for (const it of S.items.values()){
      const t = it.data.ctx?.t;
      if (!isDrawing(it) || t == null || seen.has(t)) continue;
      seen.add(t);
      html += `<i class="an-mk" data-t="${t}" style="left:${(t / dur * 100).toFixed(3)}%" title="Drawing at ${fmtTime(t, S.fps)}"></i>`;
    }
    box.innerHTML = html;
  }
  function markerTimes(){
    const ts = new Set();
    for (const it of S.items.values()){ const t = it.data.ctx?.t; if (t != null) ts.add(t); }
    return [...ts].sort((a, b) => a - b);
  }
  function stepFrame(n){
    const v = video();
    if (!v) return false;
    v.pause();
    const fd = frameDur();
    // From the frame on screen (floor): rounding skipped a frame from its second half.
    v.currentTime = clamp((Math.floor(v.currentTime / fd + 1e-6) + n) * fd + fd * 0.01, 0, v.duration || 0);
    return true;
  }
  function jumpMarker(dir){
    const v = video();
    if (!v) return false;
    const ts = markerTimes(), cur = v.currentTime, eps = frameDur() * 0.5;
    const t = dir > 0 ? ts.find((x) => x > cur + eps) : [...ts].reverse().find((x) => x < cur - eps);
    if (t == null){ toast(dir > 0 ? "No later marker" : "No earlier marker"); return true; }
    v.pause();
    v.currentTime = t;
    return true;
  }

  // ---- tick: follow video time / camera / viewport --------------------------------------------
  function tick(){
    S.raf = 0;
    if (!S.light) return;
    const g = geom();
    let sig = g ? `${r2(g.ox)},${r2(g.oy)},${r2(g.s)},${g.w},${g.h}` : "";
    const v = video();
    if (v) sig += "|" + v.currentTime.toFixed(3);
    if (S.b3){
      const cam = curCam();
      const vk = S.drag ? S.curVk : findVk(cam);
      if (vk !== S.curVk && !S.drag){ S.curVk = vk; renderViews(); }
      if (cam) sig += "|" + cam.p.map((x) => x.toFixed(4)).join(",") + "|" + cam.t.map((x) => x.toFixed(4)).join(",");
    }
    if (sig !== S.lastSig){
      S.lastSig = sig;
      if (S.on){
        syncViewBox();
        paintVisibility();
        renderSel();
        if (S.edit) S.edit.place();
        if (S.ui && !S.ui.hidden) renderPending();
      }
    }
    if (S.on) S.raf = requestAnimationFrame(tick);
  }
  function startTick(){ if (!S.raf) S.raf = requestAnimationFrame(tick); }

  // ---- screenshots / compositing --------------------------------------------------------------
  const drawItems = (cx, items) => RC.drawCanvas(cx, items, numOf);
  // What is on screen right now (picture + visible drawings), at device resolution.
  async function composeView(){
    const g = geom();
    if (!g) return null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cv = document.createElement("canvas");
    cv.width = Math.round(g.w * dpr); cv.height = Math.round(g.h * dpr);
    const cx = cv.getContext("2d");
    const bg = getComputedStyle(surfaceEl()).backgroundColor;
    cx.fillStyle = bg && bg !== "rgba(0, 0, 0, 0)" ? bg : getComputedStyle(document.body).getPropertyValue("--bg").trim() || "#151619";
    cx.fillRect(0, 0, cv.width, cv.height);
    if (S.b2){
      const m = S.b2.media;
      cx.setTransform(dpr * g.s, 0, 0, dpr * g.s, dpr * g.ox, dpr * g.oy);
      try { cx.drawImage(m, 0, 0, g.nw, g.nh); } catch {}
    } else if (S.b3){
      const c3 = S.b3.capture();
      if (c3) cx.drawImage(c3, 0, 0, cv.width, cv.height);
      cx.setTransform(dpr * g.s, 0, 0, dpr * g.s, dpr * g.ox, dpr * g.oy);
    }
    if (!S.hidden) drawItems(cx, visibleDrawings());
    cx.setTransform(1, 0, 0, 1, 0, 0);
    return { cv, dpr };
  }
  // The full frame at native resolution (images / video), or the 3D view as rendered — used for
  // the PDF. `filter(it)` picks the drawings.
  function composeNative(filter, maxSide = 2000){
    const g = geom();
    if (!g) return null;
    if (S.b2){
      const m = S.b2.media, nw = g.nw, nh = g.nh;
      if (!nw || !nh) return null;
      const s = Math.min(1, maxSide / Math.max(nw, nh));
      const cv = document.createElement("canvas");
      cv.width = Math.round(nw * s); cv.height = Math.round(nh * s);
      const cx = cv.getContext("2d");
      cx.setTransform(s, 0, 0, s, 0, 0);
      try { cx.drawImage(m, 0, 0, nw, nh); } catch { return null; }
      drawItems(cx, [...S.items.values()].filter((it) => isDrawing(it) && filter(it)));
      return cv;
    }
    if (S.b3){
      const c3 = S.b3.capture();
      if (!c3) return null;
      const cv = document.createElement("canvas");
      cv.width = c3.width; cv.height = c3.height;
      const cx = cv.getContext("2d");
      cx.drawImage(c3, 0, 0);
      const sc = c3.height / 1000;
      cx.setTransform(sc, 0, 0, sc, c3.width / 2, c3.height / 2);
      drawItems(cx, [...S.items.values()].filter((it) => isDrawing(it) && filter(it)));
      return cv;
    }
    return null;
  }
  async function uploadCanvas(cv){
    const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
    if (!blob) throw new Error("encode failed");
    const r = await host.api("/api/review/shots", { method: "POST", headers: { "content-type": "image/png" }, body: blob });
    return r;
  }
  async function screenshot(region){
    if (!S.on) toggle(true);
    if (!surfaceEl()){ toast("Nothing to capture"); return; }
    if (region){
      finishEdit();
      S.region = { rect: null };
      S.light.classList.add("an-regioning");
      toast("Drag over the area to capture · Esc cancels", 2600);
      if (S.hover) updateCursor(...S.hover);
      renderSel();
      return;
    }
    await capture(null);
  }
  async function finishRegion(){
    const R = S.region;
    S.region = null;
    S.light?.classList.remove("an-regioning");
    renderSel();
    if (!R?.rect) return;
    const [a, b, c, d] = R.rect;
    const rect = [Math.min(a, c), Math.min(b, d), Math.abs(c - a), Math.abs(d - b)];
    if (rect[2] < 6 || rect[3] < 6){ toast("Area too small"); return; }
    await capture(rect);
  }
  function cancelRegion(){
    if (!S.region) return false;
    S.region = null;
    S.light?.classList.remove("an-regioning");
    renderSel();
    return true;
  }
  async function capture(rect){
    try {
      const res = await composeView();
      if (!res) return;
      let cv = res.cv;
      if (rect){
        const c2 = document.createElement("canvas"), dpr = res.dpr;
        c2.width = Math.round(rect[2] * dpr); c2.height = Math.round(rect[3] * dpr);
        c2.getContext("2d").drawImage(cv, rect[0] * dpr, rect[1] * dpr, c2.width, c2.height, 0, 0, c2.width, c2.height);
        cv = c2;
      }
      const r = await uploadCanvas(cv);
      S.pending.push({ id: r.id, url: r.url });
      S.light?.querySelector(".an-flash")?.classList.remove("go");
      const fl = S.light?.querySelector(".an-flash");
      if (fl){ void fl.offsetWidth; fl.classList.add("go"); }
      if (!S.panelOn) togglePanel(true);
      renderPending();
      toast("Screenshot added to the note");
    } catch (e){
      console.warn(e);
      toast("Screenshot failed");
    }
  }

  // ---- export / import ------------------------------------------------------------------------
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
  function seekTo(v, t){
    return new Promise((res) => {
      if (Math.abs(v.currentTime - t) < 1e-4 && v.readyState >= 2){ res(); return; }
      const done = () => { v.removeEventListener("seeked", done); setTimeout(res, 30); };
      v.addEventListener("seeked", done);
      v.currentTime = t;
      setTimeout(done, 3000);
    });
  }
  // Renders what a report needs: the cover (picture with every drawing) and per note its frame /
  // view with the drawings burned in (PDF). `forPage` (the HTML reviewer page): the pictures are
  // clean — the page draws the drawings itself from the package rows with review-core (and lets the
  // reviewer draw on them), so it gets the cover / frames without drawings, their pixel sizes and
  // `media` (how pictures map to doc units); picture notes get no frame of their own (the page
  // shows the cover with the note's drawings).
  async function gatherReport(forPage){
    const a = S.asset, notes = notesSorted();
    const toJpeg = (cv) => cv ? cv.toDataURL("image/jpeg", 0.9) : null;
    const out = [];
    const v = video();
    const keep = { t: v?.currentTime, playing: !!v && !v.paused, cam: curCam(), v3d: host.getV3D?.(), vk: S.curVk, hidden: S.hidden, hiddenReplies: S.hiddenReplies };
    S.hidden = false; S.hiddenReplies = new Set();
    // A playing clip runs on after each seek: the frame would land late and miss its drawings.
    if (keep.playing) v.pause();
    let cover = null, coverSize = null;
    try {
      const pick = (f) => forPage ? () => false : f;
      let cv = S.b2 && !S.b2.isVid ? composeNative(pick((it) => !replyGone(it))) : null;
      cover = toJpeg(cv);
      if (cv) coverSize = [cv.width, cv.height];
      for (const [i, n] of notes.entries()){
        const d = n.data, c = d.ctx || null;
        let frame = null, cap = "";
        cv = null;
        const own = (it) => it.data.note === n.id && !replyGone(it);
        if (S.b2 && !S.b2.isVid){
          // One note on a picture: its frame would just repeat the cover.
          if (!forPage && notes.length > 1 && [...S.items.values()].some(own)) cv = composeNative(own, 1600);
        } else if (v && c?.t != null){
          await seekTo(v, c.t);
          cv = composeNative(pick((it) => ctxShown(it)), 1600);  // every drawing on that frame, whatever the panel shows
          cap = "Frame " + Math.round(c.t * S.fps) + " · " + fmtTime(c.t, S.fps);
        } else if (S.b3 && c?.vk){
          const view = S.views.get(c.vk);
          if (view){
            if (c.v3d || view.v3d) host.setV3D?.(c.v3d || view.v3d);
            S.b3.setCam(view.cam);
            S.curVk = c.vk;
            await nextFrame(); await nextFrame(); await nextFrame();
            cv = composeNative(pick((it) => it.data.ctx?.vk === c.vk && !replyGone(it)));
          }
        }
        frame = toJpeg(cv);
        out.push({ id: n.id, num: i + 1, ctx: ctxLabel(c), author: d.author || "", date: fmtDate(d.created), text: d.text || "", status: d.status, frame, size: cv ? [cv.width, cv.height] : null, frameCaption: cap, shots: d.shots || [],
          replies: liveReplies(n).map((r) => ({ id: r.id, author: r.author || "", date: fmtDate(r.created), text: r.text || "", event: r.event || "", shots: r.shots || [] })) });
      }
    } finally {
      if (v && keep.t != null) await seekTo(v, keep.t);
      if (keep.playing) v.play().catch(() => {});
      if (S.b3 && keep.cam){ if (keep.v3d) host.setV3D?.(keep.v3d); S.b3.setCam(keep.cam); }
      S.hidden = keep.hidden; S.hiddenReplies = keep.hiddenReplies;
      paintVisibility();
    }
    const g = geom(), nw = g?.nw || a.width, nh = g?.nh || a.height;
    const dims = nw && nh ? `${nw} × ${nh}` : "";
    const stateLabel = STATE_LABEL[S.status] || "";
    return {
      asset_id: a.id,
      title: `Review — ${a.name}`,
      subtitle: a.path || "",
      meta: [["Type", (a.ext || "").replace(".", "").toUpperCase()], ["Size", dims], ["Duration", a.duration ? fmtTime(a.duration, S.fps) : ""], ["State", stateLabel], ["Reviewer", reviewer()], ["Notes", String(notes.length)], ["Open", String(notes.filter((n) => n.data.status !== "done").length)], ["In progress", String(notes.filter((n) => n.data.status === "progress").length || "")], ["Exported", fmtDate(Date.now())]],
      cover, coverSize, notes: out,
      media: { kind: S.b3 ? "model3d" : S.b2?.isVid ? "video" : S.b2 ? "image" : null, w: nw || null, h: nh || null, fps: S.fps },
      footer: `Sight ${host.appVersion?.() || ""}`.trim(), reveal: true, author: reviewer(),
    };
  }
  async function exportPdf(){
    if (!S.asset) return;
    await flush();
    toast("Building PDF…", 60000);
    const payload = await gatherReport(false);
    try {
      const r = await host.api("/api/review/export/pdf", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      toast(`Saved <b>${esc(r.name)}</b> · ${r.pages} page${r.pages > 1 ? "s" : ""}`, 4000);
    } catch (e){
      console.warn(e);
      toast("PDF export failed", 3000);
    }
  }
  async function exportHtml(){
    if (!S.asset) return;
    await flush();
    toast("Building the web page…", 60000);
    const payload = await gatherReport(true);
    try {
      const r = await host.api("/api/review/export/html", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      toast(`Saved <b>${esc(r.name)}</b> — opens in any browser; replies come back as a .srev file`, 5000);
    } catch (e){
      console.warn(e);
      toast("Export failed", 3000);
    }
  }
  async function exportPackage(){
    if (!S.asset) return;
    await flush();
    try {
      const r = await host.api("/api/review/export/package", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ asset_id: S.asset.id, author: reviewer(), reveal: true }) });
      toast(`Saved <b>${esc(r.name)}</b> — send it; Sight opens it on the same file`, 4500);
    } catch (e){
      console.warn(e);
      toast("Export failed", 3000);
    }
  }
  async function copyText(){
    const a = S.asset, notes = notesSorted();
    const lines = [`Review — ${a.name}`, a.path || "", ""];
    notes.forEach((n, i) => {
      const d = n.data, c = ctxLabel(d.ctx);
      lines.push(`${i + 1}.${c ? " [" + c + "]" : ""} ${d.text || "(no text)"}${d.status === "done" ? "  ✓ resolved" : d.status === "progress" ? "  ▸ in progress" : ""}`);
      const by = [d.author, fmtDate(d.created)].filter(Boolean).join(", ");
      if (by) lines.push("   — " + by);
      for (const r of liveReplies(n)){
        lines.push(r.event ? `   ${eventIcon(r)} ${eventLabel(r)}${r.author ? " by " + r.author : ""}, ${fmtDate(r.created)}`
          : `   ↳ ${r.author ? r.author + ": " : ""}${r.text || ""}${r.shots?.length ? ` [${r.shots.length} picture${r.shots.length > 1 ? "s" : ""}]` : ""}`);
      }
    });
    try { await navigator.clipboard.writeText(lines.join("\n")); toast(`Copied ${notes.length} note${notes.length === 1 ? "" : "s"}`); }
    catch { toast("Clipboard not available"); }
  }
  async function importFile(file){
    let r;
    await flush();
    try {
      const res = await fetch("/api/review/import", { method: "POST", body: await file.arrayBuffer() });
      r = await res.json().catch(() => ({}));
      if (res.status === 404){ toast(`The media is not in your library: <b>${esc(r.missing || "?")}</b> — add its folder and import again`, 5000); return; }
      if (!res.ok){ toast(esc(r.detail || "Import failed"), 3500); return; }
    } catch (e){
      console.warn(e);
      toast("Import failed", 3000);
      return;
    }
    const parts = [["new", r.added], ["updated", r.updated], ["deleted", r.deleted]].filter(([, n]) => n).map(([w, n]) => `${n} ${w}`);
    toast(parts.length ? `Merged review${r.author ? " from <b>" + esc(r.author) + "</b>" : ""}: ${parts.join(" · ")}` : "Already up to date — nothing new in this review file", 3500);
    await host.openAsset?.(r.asset_id);
    if (S.asset?.id === r.asset_id){
      // The rows changed underneath the undo history; it would restore pre-merge states.
      S.undo = []; S.redo = [];
      await load(S.asset); toggle(true); togglePanel(true);
    }
    host.onReviewChanged?.(r.asset_id);
  }

  // ---- mode -----------------------------------------------------------------------------------
  const supported = () => S.kind === "image" || S.kind === "video" || S.kind === "psd" || S.kind === "model3d";
  function toggle(force){
    const want = force ?? !S.on;
    if (want && !supported()){ toast("Annotations work on images, video and 3D models"); return false; }
    if (want === S.on) return true;
    S.on = want;
    if (!want){ finishEdit(); cancelRegion(); S.sel.clear(); S.drag = null; S.focusNote = S.pinFocus = null; flush(); }
    S.light?.classList.toggle("an-on", S.on);
    S.b3?.annotating?.(S.on);
    if (S.bar) S.bar.hidden = !S.on;
    const el = surfaceEl();
    if (el){ el.style.cursor = ""; el.classList.toggle("an-active", S.on); }
    if (S.on && S.kind === "video" && !S.fpsKnown) loadFps();
    renderAll();
    renderSel();
    paintBar();
    renderProps();
    syncPanel();
    paintBadge();
    host.onModeChange?.(S.on);
    startTick();
    return true;
  }
  function toggleHidden(){ S.hidden = !S.hidden; paintBar(); paintVisibility(); renderSel(); toast(S.hidden ? "Drawings hidden" : "Drawings shown"); }
  function paintBadge(){
    const b = S.light?.querySelector("#annoBtn");
    if (!b) return;
    b.classList.toggle("on", S.on);
    b.hidden = !supported();
    const n = [...S.items.values()].filter((it) => it.kind === "note").length;
    const badge = b.querySelector(".an-badge");
    if (badge){ badge.textContent = n || ""; badge.hidden = !n; }
  }
  async function loadFps(){
    const a = S.asset;
    try {
      const info = await host.api(`/api/assets/${a.id}/info`);
      for (const sec of info.sections || []) for (const row of sec.rows || []){
        if (/frame rate/i.test(row[0] || "")){ const f = parseFloat(row[1]); if (f > 0 && S.asset?.id === a.id){ S.fps = f; S.fpsKnown = true; } }
      }
    } catch {}
    renderPanel();
  }

  // ---- keyboard -------------------------------------------------------------------------------
  function onKey(e){
    if (!S.light) return false;
    const tag = e.target?.tagName;
    const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable;
    if (!S.on){
      if (typing) return false;
      // Frame stepping works in any video, annotating or not.
      if (S.kind === "video") return runHotkeys(e, [
        ["Comma", () => stepFrame(-1)], ["Period", () => stepFrame(1)],
        ["Shift+Comma", () => jumpMarker(-1)], ["Shift+Period", () => jumpMarker(1)],
      ]);
      return false;
    }
    if (typing) return false;
    if (S.region && hotkey(e, "Escape")){ e.preventDefault(); cancelRegion(); return true; }
    const table = [
      ["Escape", () => { if (S.sel.size){ S.sel.clear(); renderSel(); renderProps(); return; } if (S.pinFocus){ S.pinFocus = S.focusNote = null; paintVisibility(); renderPanel(); return; } toggle(false); }],
      ["KeyA", () => toggle(false)], ["Shift+KeyA", () => toggle(false)],
      ["Ctrl+KeyZ", () => undo()], ["Ctrl+Shift+KeyZ", () => redo()], ["Ctrl+KeyY", () => redo()],
      ["Delete", () => deleteSelection()], ["Shift+Delete", () => clearShown()], ["Backspace", () => deleteSelection()], ["KeyX", () => deleteSelection()],
      ["Ctrl+KeyC", () => copySelection()], ["Ctrl+KeyV", () => paste()], ["Ctrl+KeyD", () => duplicateSelection()],
      ["Ctrl+KeyA", () => selectAll()],
      ["Ctrl+BracketRight", () => reorder(1)], ["Ctrl+BracketLeft", () => reorder(-1)],
      ["BracketLeft", () => resizeTool(1 / 1.2)], ["BracketRight", () => resizeTool(1.2)],
      ["KeyS", () => { screenshot(false); }], ["Shift+KeyS", () => { screenshot(true); }],
      ["KeyC", () => togglePanel()], ["Shift+KeyH", () => toggleHidden()],
      ["Enter", () => focusComposer()],
      ["ArrowLeft", () => nudge(-1, 0)], ["ArrowRight", () => nudge(1, 0)], ["ArrowUp", () => nudge(0, -1)], ["ArrowDown", () => nudge(0, 1)],
      ["Shift+ArrowLeft", () => nudge(-10, 0)], ["Shift+ArrowRight", () => nudge(10, 0)], ["Shift+ArrowUp", () => nudge(0, -10)], ["Shift+ArrowDown", () => nudge(0, 10)],
      ["Comma", () => stepFrame(-1)], ["Period", () => stepFrame(1)],
      ["Shift+Comma", () => jumpMarker(-1)], ["Shift+Period", () => jumpMarker(1)],
      ...TOOLS.filter(Boolean).map(([id, combo]) => [combo, () => setTool(id)]),
      // 3D: D would still fly the camera (W/A/S are taken above) and move it off the drawings.
      ["KeyD", () => S.kind === "model3d"],
    ];
    return runHotkeys(e, table);
  }
  function resizeTool(f){
    const tg = propsTarget();
    const list = (tg.type && PROPS[tg.type]) || [];
    const p = list.find((q) => q.k === "size" || q.k === "width");
    if (!p) return false;
    const v = Number(propValue(tg, p)) || 1;
    setProp(p, clamp(Math.round(v * f * 10) / 10, p.min, p.max), true);
    renderProps(); renderSel();
    return true;
  }

  // ---- lifecycle ------------------------------------------------------------------------------
  function mount(lightEl){
    S.light = lightEl;
    S.bar = buildBar(lightEl);
    S.ui = buildPanel(lightEl);
    const t = document.createElement("div");
    t.className = "an-toast";
    lightEl.appendChild(t);
    const fl = document.createElement("div");
    fl.className = "an-flash";
    lightEl.appendChild(fl);
    paintBar();
  }
  function unmount(){
    flush();
    finishEdit();
    cancelAnimationFrame(S.raf);
    S.raf = 0;
    S.on = false;
    S.light = S.bar = S.ui = null;
    S.b2 = S.b3 = null;
    S.layer = null;
    S.asset = null;
    S.items.clear(); S.saved.clear(); S.sel.clear();
    S.undo = []; S.redo = []; S.pending = [];
    resetPF();
    host.onModeChange?.(false);
  }
  function setAsset(a){
    flush();
    finishEdit();
    cancelRegion();
    S.asset = a;
    S.kind = a.ext === ".psd" ? "psd" : a.kind;
    S.b2 = S.b3 = null;
    S.layer = null;
    S.items.clear(); S.saved.clear(); S.sel.clear();
    S.undo = []; S.redo = []; S.pending = [];
    S.views.clear(); S.curVk = null;
    S.focusNote = S.pinFocus = null; S.hiddenReplies.clear();
    resetPF();
    S.status = ""; S.statusHist = []; S.versions = []; S.prevOpen = null;
    notesSig = "";
    S.fps = 25; S.fpsKnown = false;
    S.lastSig = "";
    if (!supported() && S.on) toggle(false);
    paintBadge();
    paintBar();
    renderProps();
    if (supported()) load(a);
    else { renderPanel(); }
    // Frame stepping (`,` / `.`) works without annotating too: it needs the clip's real rate.
    if (S.kind === "video") loadFps();
    if (S.on && S.kind === "video") loadFps();
    syncPanel();
  }
  function attachInput(el){
    el.addEventListener("pointerdown", onDown, true);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("pointerleave", () => { S.hover = null; if (S.on && !S.drag) renderSel(); });
    // A drawing gesture must not also count as the viewer's click (video play/pause) or
    // double-click (frame / 100%).
    el.addEventListener("click", (e) => { if (suppressClick){ suppressClick = false; e.stopImmediatePropagation(); } }, true);
    el.addEventListener("dblclick", (e) => {
      if (!S.on) return;
      const [x, y] = toDoc(e);
      const hit = hitAt(x, y);
      if (hit && typeOf(hit) === "text"){ e.stopImmediatePropagation(); e.preventDefault(); editText(hit); return; }
      if (S.tool !== "select"){ e.stopImmediatePropagation(); e.preventDefault(); }
    }, true);
  }
  // Images / video: the viewer's wrap, media element and geometry (x0, y0, scale, natural size).
  function bind2d(view){
    if (!S.light || !S.asset) return;
    S.b2 = view;
    S.b3 = null;
    S.layer = null;
    attachInput(view.wrap);
    if (S.on) view.wrap.classList.add("an-active");
    if (view.isVid){
      const v = view.media;
      v.addEventListener("loadedmetadata", () => renderMarks());
      v.addEventListener("durationchange", () => renderMarks());
    }
    renderAll();
    renderMarks();
    renderPanel();  // the note previews need the picture
    startTick();
  }
  function viewChanged(){ if (S.on && S.layer){ syncViewBox(); renderSel(); if (S.edit) S.edit.place(); } }
  // 3D: host element, camera get/set, synchronous capture of the rendered frame.
  function bind3d(r){
    if (!S.light || !S.asset || S.asset.id !== r.aid) return;
    S.b3 = r;
    S.b2 = null;
    S.layer = null;
    attachInput(r.host);
    if (S.on){ r.host.classList.add("an-active"); r.annotating?.(true); }
    renderAll();
    startTick();
  }

  return {
    mount, unmount, setAsset, bind2d, bind3d, viewChanged, toggle, onKey, importFile,
    isOn: () => S.on,
    supports: () => supported(),
  };
}

// ---- styles -----------------------------------------------------------------------------------
let stylesInjected = false;
function injectStyles(){
  if (stylesInjected) return;
  stylesInjected = true;
  const st = document.createElement("style");
  st.textContent = `
.an-layer { position: absolute; inset: 0; pointer-events: none; z-index: 3; }
.an-layer[hidden] { display: none; }
.an-layer svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.an-doc g.ghost { opacity: .22; }
.an-doc g.dim { opacity: .25; }
.an-active { touch-action: none; }
.an-ui .an-selbox { fill: none; stroke: #4c9aff; stroke-width: 1; stroke-dasharray: 3 3; }
.an-ui .an-selall { fill: none; stroke: #4c9aff; stroke-width: 1; }
.an-ui .an-handle { fill: #fff; stroke: #4c9aff; stroke-width: 1.5; }
.an-ui .an-handle.rot, .an-ui .an-handle.bend { fill: #4c9aff; stroke: #fff; }
.an-ui .an-rotline { stroke: #4c9aff; stroke-width: 1; }
.an-ui .an-marquee { fill: rgb(76 154 255 / .12); stroke: #4c9aff; stroke-width: 1; }
.an-ui .an-cursor { fill: none; stroke: #fff; stroke-width: 1; filter: drop-shadow(0 0 1px #000) drop-shadow(0 0 1px #000); }
.an-ui .an-cursor.er { stroke-dasharray: 3 2; }
.an-ui .an-regionshade { fill: rgb(0 0 0 / .45); fill-rule: evenodd; }
.an-ui .an-region { fill: none; stroke: #fff; stroke-width: 1; stroke-dasharray: 4 3; }
.an-ui .an-regionlbl { fill: #fff; font: 11px system-ui, sans-serif; paint-order: stroke; stroke: rgb(0 0 0 / .7); stroke-width: 3; }
.an-textedit { position: absolute; z-index: 6; margin: 0; padding: 0; border: 1px dashed #4c9aff; outline: none; resize: none; overflow: hidden; white-space: pre; min-width: 24px; box-sizing: content-box; }
.an-top { position: absolute; left: 50%; top: 58px; transform: translateX(-50%); z-index: 13; display: flex; flex-direction: column; align-items: center; gap: 6px; pointer-events: none; max-width: calc(100% - 140px); }
.an-top[hidden] { display: none; }
.light.an-panel-on .an-top { left: calc(50% - 160px); max-width: calc(100% - 460px); }
.an-bar, .an-props { pointer-events: auto; display: flex; align-items: center; gap: 2px; padding: 4px; border-radius: 10px; background: rgb(14 14 16 / .78); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border: 1px solid var(--border); box-shadow: 0 10px 30px rgb(0 0 0 / .35); flex-wrap: wrap; justify-content: center; }
.an-props { padding: 3px 6px; gap: 6px; font-size: 11px; color: var(--muted); min-height: 28px; box-sizing: border-box; }
.an-props[hidden] { display: none; }
.an-tool { width: 30px; height: 30px; border-radius: 7px; display: grid; place-items: center; color: var(--muted); }
.an-tool[hidden] { display: none; }
.an-tool:hover { background: var(--surface-2); color: var(--fg); }
.an-tool.on { background: var(--surface-3, #2a2b31); color: var(--accent); box-shadow: inset 0 0 0 1px var(--border-strong); }
.an-sep { width: 1px; height: 18px; background: var(--border); margin: 0 3px; flex: none; }
.an-pl { color: var(--subtle); padding: 0 4px; text-transform: capitalize; white-space: nowrap; }
.an-pc { display: inline-flex; }
.an-pc input[type=color] { width: 22px; height: 22px; padding: 0; border: 1px solid var(--border-strong); border-radius: 6px; background: none; cursor: pointer; }
.an-pc input[type=color]::-webkit-color-swatch-wrapper { padding: 0; }
.an-pc input[type=color]::-webkit-color-swatch { border: none; border-radius: 5px; }
.an-sw { display: inline-flex; gap: 3px; }
.an-sw i { width: 12px; height: 12px; border-radius: 50%; cursor: pointer; box-shadow: inset 0 0 0 1px rgb(255 255 255 / .25); }
.an-sw i:hover { transform: scale(1.25); }
.an-num { display: inline-flex; align-items: baseline; gap: 4px; padding: 3px 7px; border-radius: 6px; background: var(--surface-2); cursor: ew-resize; user-select: none; white-space: nowrap; }
.an-num:hover { background: var(--surface-3, #2a2b31); }
.an-num b { font-weight: 500; color: var(--subtle); }
.an-num em { font-style: normal; color: var(--fg); font-variant-numeric: tabular-nums; min-width: 22px; text-align: right; }
.an-numedit { width: 44px; font: inherit; color: var(--fg); background: var(--bg); border: 1px solid var(--accent); border-radius: 4px; padding: 0 3px; outline: none; }
.an-tg { height: 24px; min-width: 24px; padding: 0 7px; border-radius: 6px; color: var(--muted); background: var(--surface-2); font-size: 11px; display: inline-grid; place-items: center; }
.an-tg svg { width: 14px; height: 14px; }
.an-tg:hover { color: var(--fg); }
.an-tg.on { color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.an-tg.b { font-weight: 700; } .an-tg.i { font-style: italic; font-family: Georgia, serif; } .an-tg.u { text-decoration: underline; }
.an-psel { display: inline-flex; align-items: center; gap: 4px; }
.an-psel span { color: var(--subtle); }
.an-psel select { height: 24px; font-size: 11px; color: var(--fg); background: var(--surface-2); border: none; border-radius: 6px; padding: 0 4px; }
.an-seg { display: inline-flex; background: var(--surface-2); border-radius: 6px; padding: 2px; gap: 1px; }
.an-seg button { height: 20px; padding: 0 7px; border-radius: 4px; color: var(--muted); font-size: 11px; }
.an-seg button.on { background: var(--surface-3, #2a2b31); color: var(--accent); }
.an-toast { position: absolute; left: 50%; bottom: 84px; transform: translateX(-50%); z-index: 30; padding: 7px 14px; border-radius: 999px; font-size: 12px; color: var(--fg); background: rgb(10 10 11 / .82); border: 1px solid var(--border); pointer-events: none; opacity: 0; transition: opacity 160ms ease; white-space: nowrap; max-width: 80%; overflow: hidden; text-overflow: ellipsis; }
.an-toast.on { opacity: 1; }
.light.an-panel-on .an-toast { left: calc(50% - 160px); }
.an-flash { position: absolute; inset: 0; z-index: 29; background: #fff; opacity: 0; pointer-events: none; }
.an-flash.go { animation: an-flash .35s ease-out; }
@keyframes an-flash { 0% { opacity: .35; } 100% { opacity: 0; } }
.light.an-panel-on { padding-right: 320px; }
.light.an-panel-on .v3d-gear, .light.an-panel-on .v3d-panel, .light.an-panel-on .frame-pop { right: 336px; }
.an-panel { position: absolute; right: 0; top: 0; bottom: 0; width: 320px; z-index: 20; display: flex; flex-direction: column; background: var(--surface, #1b1c20); border-left: 1px solid var(--border); box-sizing: border-box; font-size: 12px; color: var(--fg); }
.an-panel[hidden] { display: none; }
.an-ph { display: flex; align-items: center; gap: 6px; padding: 10px 10px 8px 14px; border-bottom: 1px solid var(--border); }
.an-ph b { font-size: 13px; font-weight: 600; }
.an-who { flex: 1; min-width: 0; height: 26px; padding: 0 8px; font: inherit; color: var(--fg); background: var(--surface-2); border: 1px solid transparent; border-radius: 6px; outline: none; }
.an-who:focus { border-color: var(--border-strong); }
.an-ib { height: 26px; min-width: 26px; padding: 0 6px; border-radius: 6px; color: var(--muted); display: inline-grid; place-items: center; font-size: 11px; white-space: nowrap; }
.an-ib:hover { background: var(--surface-2); color: var(--fg); }
.an-ib.on { color: #34c759; }
.an-ib.sm { height: 22px; min-width: 22px; padding: 0; }
.an-ib.sm svg { width: 14px; height: 14px; }
.an-menu { position: absolute; right: 40px; top: 42px; z-index: 22; display: flex; flex-direction: column; padding: 4px; min-width: 210px; border-radius: 10px; background: rgb(22 22 25 / .97); border: 1px solid var(--border); box-shadow: 0 20px 50px rgb(0 0 0 / .5); }
.an-menu[hidden] { display: none; }
.an-menu button { text-align: left; padding: 7px 10px; border-radius: 6px; color: var(--fg); font-size: 12px; }
.an-menu button:hover { background: var(--surface-2); }
.an-menu hr { border: none; border-top: 1px solid var(--border); margin: 4px 2px; }
.an-rs { display: flex; align-items: center; gap: 8px; padding: 8px 14px 0; color: var(--subtle); font-size: 11px; }
.an-rs .an-seg { flex: 1; display: flex; }
.an-rs .an-seg button { flex: 1; padding: 0 4px; white-space: nowrap; }
.an-rsh { padding: 4px 14px 0 50px; color: var(--subtle); font-size: 10px; line-height: 1.5; }
.an-rsh-more { border: 0; background: none; color: var(--accent, #4c9aff); font: inherit; padding: 0; cursor: pointer; }
.an-rs [data-rs=review].on { color: #ff9f0a; } .an-rs [data-rs=changes].on { color: #ff453a; } .an-rs [data-rs=approved].on { color: #34c759; }
.an-vers { padding: 6px 14px 0; display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--subtle); }
.an-vers[hidden] { display: none; }
.an-vrow { display: flex; align-items: center; gap: 4px; }
.an-vrow > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-vrow b { color: var(--fg); font-weight: 600; }
.an-vrow .an-ib[disabled] { opacity: .35; pointer-events: none; }
.an-vrow.carry { padding: 5px 4px 5px 8px; border-radius: 8px; background: rgb(255 159 10 / .12); color: var(--fg); }
.an-views { display: flex; align-items: center; gap: 4px; padding: 8px 14px 0; flex-wrap: wrap; color: var(--subtle); font-size: 11px; }
.an-views[hidden] { display: none; }
.an-views span { margin-right: 4px; }
.an-vchip { min-width: 24px; height: 22px; border-radius: 6px; background: var(--surface-2); color: var(--muted); font-size: 11px; }
.an-vchip.on { color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.an-filt { display: flex; margin: 8px 14px 0; }
.an-filt[hidden] { display: none; }
.an-filt button { flex: 1; padding: 0 4px; white-space: nowrap; display: inline-flex; align-items: center; justify-content: center; gap: 4px; }
.an-fc { font-style: normal; min-width: 15px; height: 15px; padding: 0 4px; border-radius: 8px; background: var(--muted); color: #fff; font-size: 9.5px; font-weight: 700; line-height: 15px; }
.an-fc.open { background: #ff453a; } .an-fc.progress { background: #ff9f0a; } .an-fc.done { background: #34c759; } .an-fc.zero { opacity: .4; }
.an-nprev { position: relative; width: 100%; margin: 6px 0 2px; border-radius: 6px; overflow: hidden; background: #000; }
.an-nprev.sm { margin-top: 4px; }
.an-nprev img, .an-nprev svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.an-list { flex: 1; min-height: 0; overflow: auto; padding: 8px 8px 12px; display: flex; flex-direction: column; gap: 6px; }
.an-hint { color: var(--subtle); padding: 10px 8px; line-height: 1.5; }
.an-hint p { margin: 0 0 8px; }
.an-note { padding: 8px 10px; border-radius: 10px; background: var(--surface-2); border: 1px solid transparent; cursor: pointer; }
.an-note:hover { border-color: var(--border-strong); }
.an-note.on { border-color: var(--accent); }
.an-note.done { opacity: .6; }
.an-note.done .an-nt { text-decoration: line-through; text-decoration-color: rgb(255 255 255 / .35); }
.an-nh { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.an-nn { flex: none; min-width: 18px; height: 18px; padding: 0 4px; box-sizing: border-box; border-radius: 9px; background: #d0342c; color: #fff; font-size: 10px; font-weight: 700; display: grid; place-items: center; }
.an-note.done .an-nn { background: #2f9d5b; }
.an-note.prog .an-nn { background: #e08a00; }
.an-nctx { display: inline-flex; align-items: center; gap: 3px; height: 18px; padding: 0 6px; border-radius: 5px; background: var(--surface-3, #2a2b31); color: var(--accent); font-size: 10px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.an-nctx svg { width: 12px; height: 12px; }
.an-nwho { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--subtle); font-size: 10px; }
.an-nt { white-space: pre-wrap; word-break: break-word; line-height: 1.45; user-select: text; }
.an-empty { color: var(--subtle); }
.an-shots { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; }
.an-shots img { height: 54px; max-width: 100%; border-radius: 5px; object-fit: cover; border: 1px solid var(--border); cursor: zoom-in; }
.an-nmeta { margin-top: 4px; color: var(--subtle); font-size: 10px; }
.an-replies { margin-top: 6px; padding-left: 8px; border-left: 2px solid var(--border-strong); display: flex; flex-direction: column; gap: 5px; }
.an-rep { cursor: default; }
.an-rh { display: flex; align-items: center; gap: 4px; color: var(--subtle); font-size: 10px; }
.an-rh span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-rh .an-ib { visibility: hidden; height: 16px; min-width: 16px; }
.an-rep:hover .an-rh .an-ib { visibility: visible; }
.an-rdraw { flex: none; display: inline-flex; align-items: center; gap: 2px; height: 16px; padding: 0 5px 0 3px; border: 0; border-radius: 8px; background: none; color: var(--subtle); font: inherit; font-size: 10px; cursor: pointer; }
.an-rdraw svg { width: 12px; height: 12px; }
.an-rdraw:hover { color: var(--fg); background: rgb(127 127 127 / .18); }
.an-rdraw.off { opacity: .55; }
.an-rev { color: var(--subtle); font-size: 10px; }
.an-rev.done { color: var(--ok, #2f9d5b); }
.an-rev.prog { color: #e0a030; }
.an-rt { white-space: pre-wrap; word-break: break-word; line-height: 1.4; user-select: text; }
.an-redit { margin-top: 6px; min-height: 30px; }
.an-compose { border-top: 1px solid var(--border); padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 6px; }
.an-pend { display: flex; gap: 4px; flex-wrap: wrap; }
.an-pend[hidden] { display: none; }
.an-pshot { position: relative; }
.an-pshot img { height: 46px; border-radius: 5px; border: 1px solid var(--border); display: block; cursor: zoom-in; }
.an-pshot button { position: absolute; right: -5px; top: -5px; width: 16px; height: 16px; border-radius: 50%; background: #000; color: #fff; font-size: 11px; line-height: 1; border: 1px solid var(--border-strong); }
.an-input { width: 100%; box-sizing: border-box; resize: none; font: 12px/1.45 var(--font, system-ui); color: var(--fg); background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 7px 9px; outline: none; min-height: 40px; }
.an-input:focus { border-color: var(--border-strong); }
.an-nedit { margin: 2px 0; }
.an-crow { display: flex; align-items: center; gap: 4px; }
.an-ctx { flex: 1; min-width: 0; color: var(--subtle); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
.an-add { height: 28px; padding: 0 14px; }
.an-shotview { position: absolute; inset: 0; z-index: 40; display: grid; place-items: center; background: rgb(0 0 0 / .82); cursor: zoom-out; }
.an-shotview img { max-width: 92%; max-height: 92%; border-radius: 6px; box-shadow: 0 20px 60px rgb(0 0 0 / .6); }
.vtrack .an-marks { position: absolute; inset: 0; pointer-events: none; }
.an-mk { position: absolute; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%; background: #ffd60a; box-shadow: 0 0 0 1px rgb(0 0 0 / .5); pointer-events: auto; cursor: pointer; }
.an-mk.note { width: 10px; height: 10px; margin: -5px 0 0 -5px; background: #ff453a; box-shadow: 0 0 0 1.5px #fff; }
.an-mk.note.done { background: #34c759; }
.an-mk.note.prog { background: #ff9f0a; }
.an-mk:hover { transform: scale(1.35); }
.light-bar .an-btn { position: relative; }
.light-bar .an-btn.on { color: var(--accent); }
.an-badge { position: absolute; right: 2px; top: 2px; min-width: 14px; height: 14px; padding: 0 3px; box-sizing: border-box; border-radius: 7px; background: #d0342c; color: #fff; font-size: 9px; font-weight: 700; line-height: 14px; text-align: center; }
.an-badge[hidden] { display: none; }
.light.an-regioning .an-top { opacity: .3; pointer-events: none; }
`;
  document.head.appendChild(st);
}
