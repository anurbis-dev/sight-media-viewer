// Lightbox guides for the 2D picture (image, video, PSD). Not the 3D viewer.
// Positions are image pixels and follow attachViewer's geom ({x0, y0, s, w, h, turn})
// through pan, zoom, turn and mirror. One localStorage blob, keyed by asset id.
//
// Grid: rulers on the picture's top and left edges. Drag down from the top ruler for a
// vertical guide, right from the left ruler for a horizontal one. Drag a guide back onto
// its ruler to delete it. Perspective: one handle per vanishing point, lines through the
// picture toward that point.

const STORE_KEY = "sight.guides";
const MODES = ["", "grid", "1", "2", "3"];
const VP_COLOR = ["var(--accent)", "#e2a33a", "#3ec7b5"];

let hooks = {};
let bound = null;
let assetId = "";
let rec = blank();
let root = null;
let edit = null;
let menuOpen = false;
let drag = null;
let editGuide = null; // {kind, i, typing, origin}
let suppressEdit = false;

function blank(){
  return { mode: "", snap: 10, v: [], h: [], pts: {}, dens: [8, 8, 8] };
}
function clampSnap(v){
  const n = Math.round(Number(v));
  return n >= 1 && n <= 500 ? n : 10;
}
function clampDens(v){
  const n = Math.round(Number(v));
  return n >= 2 && n <= 40 ? n : 8;
}
function clampGuide(v, size){
  const s = Math.max(Number(size) || 1, 1);
  return Math.min(3 * s, Math.max(-2 * s, v));
}
function clampVp(v, w, h){
  const lim = 8 * Math.max(w, h, 1);
  return Math.min(lim, Math.max(-lim, v));
}
function parsePx(s){
  const v = Number(String(s).trim().replace(",", "."));
  return Number.isFinite(v) ? v : null;
}
function fmt(v){
  return String(Math.round(v * 100) / 100);
}
function round1(v){ return Math.round(v * 10) / 10; }

function readAll(){
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}
function nums(a){
  if (!Array.isArray(a)) return [];
  return a.filter((n) => Number.isFinite(Number(n))).map((n) => Number(n)).slice(0, 80);
}
function loadPts(raw){
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const k of ["1", "2", "3"]){
    if (!Array.isArray(raw[k])) continue;
    const pts = [];
    for (const p of raw[k]){
      if (Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]))) pts.push([Number(p[0]), Number(p[1])]);
    }
    if (pts.length) out[k] = pts.slice(0, 3);
  }
  return out;
}
function loadRec(id){
  const r = readAll()[String(id)] || {};
  const dens = [0, 1, 2].map((i) => clampDens(Array.isArray(r.dens) ? r.dens[i] : 8));
  return {
    mode: MODES.includes(r.mode) ? r.mode : "",
    snap: clampSnap(r.snap ?? 10),
    v: nums(r.v),
    h: nums(r.h),
    pts: loadPts(r.pts),
    dens,
  };
}
function save(){
  if (!assetId) return;
  const all = readAll();
  delete all[assetId];
  const keep = rec.mode || rec.v.length || rec.h.length || Object.keys(rec.pts).length
    || rec.snap !== 10 || rec.dens.some((d) => d !== 8);
  if (keep){
    all[assetId] = {
      mode: rec.mode, snap: rec.snap, v: rec.v, h: rec.h, pts: rec.pts, dens: rec.dens,
    };
  }
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - 400))) delete all[k];
  // putSetting writes localStorage and the server copy. A bare localStorage write is deleted on the
  // next start: hydrateSettings keeps only the keys settings.json has.
  const json = JSON.stringify(all);
  try {
    if (hooks.putSetting) hooks.putSetting(STORE_KEY, json);
    else localStorage.setItem(STORE_KEY, json);
  } catch { /* full or private mode */ }
}

function parseTurn(css){
  if (!css) return null;
  const m = /translate\((-?\d+(?:\.\d+)?)px,(-?\d+(?:\.\d+)?)px\) rotate\((-?\d+(?:\.\d+)?)deg\) scale\((-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\)/.exec(css);
  if (!m) return null;
  return { cx: +m[1], cy: +m[2], rot: +m[3], sx: +m[4], sy: +m[5] };
}
// Screen point of an image pixel. geom.turn is attachViewer's turnCss (rotate then mirror about the pivot).
export function imgToView(px, py, g){
  const ux = g.x0 + px * g.s, uy = g.y0 + py * g.s;
  const t = parseTurn(g.turn);
  if (!t) return [ux, uy];
  const th = t.rot * Math.PI / 180, c = Math.cos(th), sn = Math.sin(th);
  const vx = t.sx * (ux - t.cx), vy = t.sy * (uy - t.cy);
  return [t.cx + vx * c - vy * sn, t.cy + vx * sn + vy * c];
}
export function viewToImg(x, y, g){
  const t = parseTurn(g.turn);
  let ux = x, uy = y;
  if (t){
    const th = t.rot * Math.PI / 180, c = Math.cos(th), sn = Math.sin(th);
    const dx = x - t.cx, dy = y - t.cy;
    ux = t.cx + t.sx * (dx * c + dy * sn);
    uy = t.cy + t.sy * (-dx * sn + dy * c);
  }
  return [(ux - g.x0) / g.s, (uy - g.y0) / g.s];
}

// Lines from a vanishing point across the picture. Inside: `n` full lines. Outside: `n` lines
// across the angle the picture occupies, each drawn from the point through the far edge.
export function linesFromVp(vp, w, h, n){
  n = Math.max(2, Math.min(40, n | 0));
  const angs = [];
  const inside = vp.x >= -1e-6 && vp.x <= w + 1e-6 && vp.y >= -1e-6 && vp.y <= h + 1e-6;
  if (inside){
    for (let i = 0; i < n; i++) angs.push((Math.PI * i) / n);
  } else {
    const a = [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => Math.atan2(y - vp.y, x - vp.x)).sort((p, q) => p - q);
    const ext = [...a, a[0] + Math.PI * 2];
    let gap = -1, at = 0;
    for (let i = 0; i < 4; i++){
      const d = ext[i + 1] - ext[i];
      if (d > gap){ gap = d; at = i; }
    }
    const a0 = ext[at + 1], a1 = ext[at] + Math.PI * 2;
    for (let i = 0; i < n; i++) angs.push(a0 + (a1 - a0) * (i / (n - 1)));
  }
  const segs = [];
  for (const th of angs){
    const seg = chord(vp, th, w, h, inside);
    if (seg) segs.push(seg);
  }
  return segs;
}
function clipSegment(x0, y0, x1, y1, w, h){
  const L = 1, R = 2, B = 4, T = 8;
  const code = (x, y) => (x < 0 ? L : x > w ? R : 0) | (y < 0 ? T : y > h ? B : 0);
  let c0 = code(x0, y0), c1 = code(x1, y1);
  for (let i = 0; i < 16; i++){
    if (!(c0 | c1)) return [x0, y0, x1, y1];
    if (c0 & c1) return null;
    const c = c0 || c1;
    let x = x0, y = y0;
    if ((c & T) && y1 !== y0){ x = x0 + (x1 - x0) * (0 - y0) / (y1 - y0); y = 0; }
    else if ((c & B) && y1 !== y0){ x = x0 + (x1 - x0) * (h - y0) / (y1 - y0); y = h; }
    else if ((c & R) && x1 !== x0){ y = y0 + (y1 - y0) * (w - x0) / (x1 - x0); x = w; }
    else if ((c & L) && x1 !== x0){ y = y0 + (y1 - y0) * (0 - x0) / (x1 - x0); x = 0; }
    else return null;
    if (c === c0){ x0 = x; y0 = y; c0 = code(x0, y0); }
    else { x1 = x; y1 = y; c1 = code(x1, y1); }
  }
  return null;
}
function chord(vp, th, w, h, inside){
  const dx = Math.cos(th), dy = Math.sin(th), LEN = 1e6;
  const seg = clipSegment(vp.x - dx * LEN, vp.y - dy * LEN, vp.x + dx * LEN, vp.y + dy * LEN, w, h);
  if (!seg) return null;
  if (inside) return seg;
  const d0 = (seg[0] - vp.x) ** 2 + (seg[1] - vp.y) ** 2;
  const d1 = (seg[2] - vp.x) ** 2 + (seg[3] - vp.y) ** 2;
  return d0 > d1 ? [vp.x, vp.y, seg[0], seg[1]] : [vp.x, vp.y, seg[2], seg[3]];
}

function defaultPt(mode, i, w, h){
  if (mode === "1") return { x: w / 2, y: h / 2 };
  if (i === 0) return { x: w * 0.2, y: h * 0.42 };
  if (i === 1) return { x: w * 0.8, y: h * 0.42 };
  return { x: w * 0.5, y: h * 0.84 };
}
function pointsFor(g){
  const n = Number(rec.mode);
  const saved = rec.pts[rec.mode] || [];
  const out = [];
  for (let i = 0; i < n; i++){
    const p = saved[i];
    out.push(p ? { x: p[0], y: p[1] } : defaultPt(rec.mode, i, g.w, g.h));
  }
  return out;
}
function storePoints(list){
  rec.pts[rec.mode] = list.map((p) => [p.x, p.y]);
}

function geom(){
  const g = bound?.guideGeom?.();
  if (!g || !(g.s > 0) || !(g.w > 0) || !(g.h > 0)) return null;
  return g;
}
function pictureView(){
  return bound?.el?.querySelector(".light-frame > .view") || null;
}
function clientToView(e, view){
  const r = view.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}
function coarse(){ return window.matchMedia("(pointer: coarse)").matches; }
function rulerPx(g){
  const edge = Math.min(g.w, g.h) * g.s;
  const want = coarse() ? 32 : 22;
  return Math.min(want, Math.max(12, edge * 0.28));
}
function labelStep(s, size){
  const raw = 64 / Math.max(s, 1e-6);
  const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)));
  const n = raw / pow;
  let step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
  if (size / step > 40) step *= 2;
  return step;
}
function snapTo(v){
  const s = rec.snap || 10;
  return Math.round(v / s) * s;
}
function xml(s){
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}
const px = (v) => Math.round(v * 10) / 10;
function add(p, d, s){ return [p[0] + d[0] * s, p[1] + d[1] * s]; }
function dir(a, b){
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}
function readable(a){
  let x = a;
  if (x > 90 || x < -90) x += 180;
  while (x > 180) x -= 360;
  while (x < -180) x += 360;
  return x;
}

function overRuler(which, ix, iy, g, t){
  const band = t / g.s, slop = 10 / g.s;
  if (which === "top") return iy >= -slop && iy <= band && ix >= -slop && ix <= g.w + slop;
  return ix >= -slop && ix <= band && iy >= -slop && iy <= g.h + slop;
}

function injectCss(){
  if (document.getElementById("guidesCss")) return;
  const st = document.createElement("style");
  st.id = "guidesCss";
  st.textContent = `
.gd-anchor { position: relative; flex: none; display: flex; }
.gd-anchor[hidden] { display: none; }
.light-bar > .gd-anchor > .btn { zoom: var(--icon-k, 1); }
.gd-pop { left: auto; right: 0; min-width: 228px; z-index: 120; touch-action: none; }
.gd-pop[hidden] { display: none; }
.gd-pop button.on { color: var(--accent); }
.gd-field, .gd-dens { display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 2px 10px; color: var(--muted); font-size: 12px; }
.gd-field span, .gd-dens span { flex: none; }
.gd-field input[type=number], .gd-edit {
  height: 24px; padding: 0 6px; border-radius: 6px; border: 1px solid var(--border);
  background: var(--surface); color: var(--fg); font: 12px/1 var(--font, inherit); font-variant-numeric: tabular-nums;
}
.gd-field input[type=number] { width: 64px; }
.gd-field input:focus, .gd-edit:focus { border-color: var(--accent); outline: none; }
.gd-dens input[type=range] { flex: 1; min-width: 0; accent-color: var(--accent); touch-action: none; }
.gd-dens i { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.gd-dens b { width: 18px; text-align: right; color: var(--fg); font-weight: 500; font-variant-numeric: tabular-nums; }
.gd-root { position: absolute; inset: 0; z-index: 4; pointer-events: none; overflow: visible; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.gd-svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.gd-svg .gd-hit { touch-action: none; cursor: grab; }
.gd-svg .gd-hit[data-k="v"], .gd-svg .gd-hit[data-k="h"] { pointer-events: stroke; }
.gd-svg .gd-hit[data-k="vp"] { pointer-events: all; }
.gd-svg .gd-hit[data-k="top"], .gd-svg .gd-hit[data-k="left"] { pointer-events: all; cursor: crosshair; }
.gd-svg text, .gd-svg .gd-mark { pointer-events: none; }
.gd-edit {
  position: absolute; z-index: 2; width: 76px; pointer-events: auto; touch-action: none;
  border-color: var(--accent); background: var(--surface-2);
}
.gd-edit[hidden] { display: none; }
.gd-edit.gd-kill { border-color: #e35d5d; }
html.gd-dragging, html.gd-dragging * { cursor: grabbing !important; }
html.gd-dragging.gd-kill, html.gd-dragging.gd-kill * { cursor: not-allowed !important; }
@media (pointer: coarse) {
  .gd-edit { width: 92px; height: 36px; font-size: 16px; }
  .gd-field input[type=number] { height: 32px; font-size: 16px; }
}
`;
  document.head.appendChild(st);
}

function paintBtn(){
  const btn = bound?.el?.querySelector("#guidesBtn");
  if (btn) btn.classList.toggle("on", !!rec.mode);
}
function closeMenu(){
  menuOpen = false;
  const pop = bound?.el?.querySelector("#guidesPop");
  const btn = bound?.el?.querySelector("#guidesBtn");
  if (pop) pop.hidden = true;
  btn?.setAttribute("aria-expanded", "false");
}
function openMenu(){
  const pop = bound?.el?.querySelector("#guidesPop");
  const btn = bound?.el?.querySelector("#guidesBtn");
  const anchor = bound?.el?.querySelector(".gd-anchor");
  if (!pop || !btn || anchor?.hidden) return;
  menuOpen = true;
  paintMenu();
  pop.hidden = false;
  btn.setAttribute("aria-expanded", "true");
}
function paintMenu(){
  const pop = bound?.el?.querySelector("#guidesPop");
  if (!pop) return;
  const row = (mode, label) => {
    const on = rec.mode === mode;
    return `<button type="button" role="menuitemradio" aria-checked="${on ? "true" : "false"}" data-mode="${mode}" class="${on ? "on" : ""}"><span class="chk">${on ? "✓" : ""}</span>${label}</button>`;
  };
  const nVp = rec.mode === "1" || rec.mode === "2" || rec.mode === "3" ? Number(rec.mode) : 0;
  const dens = nVp ? Array.from({ length: nVp }, (_, i) =>
    `<label class="gd-dens"><i style="background:${VP_COLOR[i]}"></i><span>Point ${i + 1}</span><input type="range" min="2" max="40" step="1" data-dens="${i}" value="${rec.dens[i]}" aria-label="Point ${i + 1} lines"><b>${rec.dens[i]}</b></label>`
  ).join("") : "";
  pop.innerHTML = `
    ${row("", "Off")}
    ${row("grid", "Grid")}
    <label class="gd-field">Snap<input type="number" min="1" max="500" step="1" data-snap value="${rec.snap}" aria-label="Snap step in pixels">px</label>
    <div class="sep"></div>
    ${row("1", "1-point")}
    ${row("2", "2-point")}
    ${row("3", "3-point")}
    ${dens}`;
  pop.querySelectorAll("[data-mode]").forEach((b) => {
    b.onclick = () => {
      const m = b.dataset.mode;
      rec.mode = m && m === rec.mode ? "" : m;
      save();
      paintBtn();
      paintMenu();
      refresh();
    };
  });
  const snap = pop.querySelector("[data-snap]");
  const applySnap = () => {
    const n = Number(snap.value);
    if (n >= 1 && n <= 500){ rec.snap = Math.round(n); save(); refresh(); }
  };
  snap.addEventListener("input", applySnap);
  snap.addEventListener("change", () => { rec.snap = clampSnap(snap.value); snap.value = String(rec.snap); save(); refresh(); });
  snap.addEventListener("keydown", (e) => e.stopPropagation());
  pop.querySelectorAll("[data-dens]").forEach((inp) => {
    inp.addEventListener("input", () => {
      const i = Number(inp.dataset.dens);
      rec.dens[i] = clampDens(inp.value);
      inp.value = String(rec.dens[i]);
      const b = inp.parentElement?.querySelector("b");
      if (b) b.textContent = String(rec.dens[i]);
      save();
      refresh();
    });
    inp.addEventListener("keydown", (e) => e.stopPropagation());
  });
}
function toggleMenu(){
  if (menuOpen) closeMenu();
  else openMenu();
}

function detachRoot(){
  root?.remove();
  root = null;
  edit = null;
  editGuide = null;
}
function ensure(view){
  if (root?.isConnected && root.parentElement === view) return root;
  detachRoot();
  root = document.createElement("div");
  root.className = "gd-root";
  root.innerHTML = `<svg class="gd-svg" aria-hidden="true"></svg><input class="gd-edit" hidden type="text" inputmode="decimal" spellcheck="false" autocomplete="off" aria-label="Guide position in pixels">`;
  view.appendChild(root);
  edit = root.querySelector(".gd-edit");
  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("dblclick", (e) => e.stopPropagation());
  root.addEventListener("contextmenu", (e) => e.preventDefault());
  edit.addEventListener("pointerdown", (e) => e.stopPropagation());
  edit.addEventListener("keydown", onEditKey);
  edit.addEventListener("input", onEditInput);
  edit.addEventListener("blur", onEditBlur);
  return root;
}

function hideEdit(){
  if (!edit){ editGuide = null; return; }
  suppressEdit = true;
  edit.hidden = true;
  edit.classList.remove("gd-kill");
  edit.blur();
  suppressEdit = false;
  editGuide = null;
}
function showEdit(kind, i, focus){
  if (!edit) return;
  const v = kind === "v" ? rec.v[i] : rec.h[i];
  if (!Number.isFinite(v)){ hideEdit(); return; }
  editGuide = { kind, i, typing: false, origin: v };
  edit.hidden = false;
  edit.classList.remove("gd-kill");
  edit.placeholder = "";
  edit.value = fmt(v);
  if (focus){
    edit.focus({ preventScroll: true });
    edit.select();
  }
}
function placeEdit(view, g){
  if (!edit || edit.hidden || !editGuide) return;
  let x, y;
  if (drag?.vx != null){ x = drag.vx; y = drag.vy; }
  else {
    const v = editGuide.kind === "v" ? rec.v[editGuide.i] : rec.h[editGuide.i];
    if (!Number.isFinite(v)) return;
    const p = editGuide.kind === "v" ? imgToView(v, g.h / 2, g) : imgToView(g.w / 2, v, g);
    x = p[0]; y = p[1];
  }
  const w = edit.offsetWidth || 76, h = edit.offsetHeight || 24;
  edit.style.left = Math.max(4, Math.min(view.clientWidth - w - 4, x + 14)) + "px";
  edit.style.top = Math.max(4, Math.min(view.clientHeight - h - 4, y + 14)) + "px";
}
function writeGuide(kind, i, v, doSnap){
  const g = geom();
  if (!g) return;
  const size = kind === "v" ? g.w : g.h;
  let n = clampGuide(v, size);
  if (doSnap) n = clampGuide(snapTo(n), size);
  if (kind === "v") rec.v[i] = n;
  else rec.h[i] = n;
}
function onEditInput(){
  if (!editGuide) return;
  editGuide.typing = true;
  const v = parsePx(edit.value);
  if (v == null) return;
  writeGuide(editGuide.kind, editGuide.i, v, false);
  refresh();
}
function onEditKey(e){
  e.stopPropagation();
  if (e.key === "Enter"){
    e.preventDefault();
    // Enter commits the typed pixel. While a drag is still down, that ends it (and does not delete).
    if (drag){ if (editGuide) editGuide.typing = true; upGuide(); }
    else commitEdit();
  } else if (e.key === "Escape"){
    e.preventDefault();
    if (drag) cancelDrag();
    else cancelEdit();
  }
}
function onEditBlur(){
  if (suppressEdit || drag) return;
  commitEdit();
}
function commitEdit(){
  if (!editGuide){ hideEdit(); return; }
  const gde = editGuide;
  const v = parsePx(edit.value);
  if (v != null) writeGuide(gde.kind, gde.i, v, false);
  hideEdit();
  save();
  refresh();
}
function cancelEdit(){
  if (editGuide && Number.isFinite(editGuide.origin)){
    if (editGuide.kind === "v") rec.v[editGuide.i] = editGuide.origin;
    else rec.h[editGuide.i] = editGuide.origin;
  }
  hideEdit();
  refresh();
}

function setDragCursor(kill){
  document.documentElement.classList.add("gd-dragging");
  document.documentElement.classList.toggle("gd-kill", !!kill);
}
function clearDragCursor(){
  document.documentElement.classList.remove("gd-dragging", "gd-kill");
}

function snapshot(){
  return { v: rec.v.slice(), h: rec.h.slice(), pts: JSON.parse(JSON.stringify(rec.pts)) };
}
function restore(s){
  rec.v = s.v; rec.h = s.h; rec.pts = s.pts;
}
function cancelDrag(){
  if (!drag) return;
  const s = drag.snapshot;
  unlisten();
  drag = null;
  clearDragCursor();
  if (s) restore(s);
  hideEdit();
  refresh();
}
let listenOff = null;
function unlisten(){
  listenOff?.();
  listenOff = null;
}
function listen(pid, move, up){
  unlisten();
  const onMove = (e) => { if (e.pointerId === pid) move(e); };
  const onUp = (e) => { if (e.pointerId === pid) up(e); };
  const onOther = (e) => { if (e.pointerId !== pid) cancelDrag(); };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  window.addEventListener("pointerdown", onOther, true);
  listenOff = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    window.removeEventListener("pointerdown", onOther, true);
  };
}

function onPointerDown(e){
  if (e.button !== 0 || e.altKey) return;
  const hit = e.target.closest?.(".gd-hit");
  if (!hit || !root?.contains(hit)) return;
  const g = geom();
  const view = pictureView();
  if (!g || !view) return;
  e.preventDefault();
  e.stopPropagation();
  const k = hit.dataset.k;
  const snap = snapshot();
  const [vx, vy] = clientToView(e, view);
  const [ix, iy] = viewToImg(vx, vy, g);
  if (k === "top" || k === "left"){
    const vertical = k === "top";
    const arr = vertical ? rec.v : rec.h;
    if (arr.length >= 80) return;
    const raw = vertical ? ix : iy;
    const size = vertical ? g.w : g.h;
    arr.push(clampGuide(snapTo(raw), size));
    const i = arr.length - 1;
    beginGuideDrag(e, view, g, vertical ? "v" : "h", i, true, snap, vx, vy);
    return;
  }
  if (k === "v" || k === "h"){
    beginGuideDrag(e, view, g, k, Number(hit.dataset.i), false, snap, vx, vy);
    return;
  }
  if (k === "vp") beginVpDrag(e, view, g, Number(hit.dataset.i), snap, vx, vy);
}

function beginGuideDrag(e, view, g, kind, i, fresh, snap, vx, vy){
  hideEdit();
  drag = { kind, i, fresh, snapshot: snap, moved: false, typing: false, kill: !!fresh, pid: e.pointerId, x0: e.clientX, y0: e.clientY, vx, vy };
  setDragCursor(drag.kill);
  showEdit(kind, i, e.pointerType !== "touch");
  if (editGuide) editGuide.typing = false;
  placeEdit(view, g);
  markKill(drag.kill);
  listen(e.pointerId, (ev) => moveGuide(ev), (ev) => upGuide(ev));
  refresh();
}
function markKill(kill){
  edit?.classList.toggle("gd-kill", !!kill);
  if (!edit || edit.hidden) return;
  if (kill && !editGuide?.typing){ edit.value = ""; edit.placeholder = "Delete"; }
  else if (!editGuide?.typing){
    edit.placeholder = "";
    const v = editGuide.kind === "v" ? rec.v[editGuide.i] : rec.h[editGuide.i];
    if (Number.isFinite(v)) edit.value = fmt(v);
  }
}
function moveGuide(e){
  if (!drag) return;
  const g = geom();
  const view = pictureView();
  if (!g || !view) return;
  if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) >= 4) drag.moved = true;
  const [vx, vy] = clientToView(e, view);
  drag.vx = vx; drag.vy = vy;
  const [ix, iy] = viewToImg(vx, vy, g);
  const t = rulerPx(g);
  const which = drag.kind === "v" ? "top" : "left";
  drag.kill = overRuler(which, ix, iy, g, t);
  setDragCursor(drag.kill);
  if (!editGuide?.typing){
    const raw = drag.kind === "v" ? ix : iy;
    writeGuide(drag.kind, drag.i, raw, true);
    markKill(drag.kill);
  }
  refresh();
}
function upGuide(){
  if (!drag) return;
  const d = drag;
  const typing = !!editGuide?.typing;
  unlisten();
  drag = null;
  clearDragCursor();
  if (d.kill && !typing){
    const arr = d.kind === "v" ? rec.v : rec.h;
    arr.splice(d.i, 1);
    hideEdit();
    save();
    refresh();
    return;
  }
  if (d.fresh && !d.moved && !typing){
    const arr = d.kind === "v" ? rec.v : rec.h;
    arr.splice(d.i, 1);
    hideEdit();
    refresh();
    return;
  }
  if (typing){
    const v = parsePx(edit?.value);
    if (v != null) writeGuide(d.kind, d.i, v, false);
    hideEdit();
    save();
    refresh();
    return;
  }
  save();
  if (!d.moved && !d.fresh){
    showEdit(d.kind, d.i, true);
    refresh();
    return;
  }
  hideEdit();
  refresh();
}

function beginVpDrag(e, view, g, i, snap, vx, vy){
  hideEdit();
  const list = pointsFor(g);
  drag = { kind: "vp", i, snapshot: snap, moved: false, pid: e.pointerId, x0: e.clientX, y0: e.clientY, vx, vy, list };
  setDragCursor(false);
  listen(e.pointerId, (ev) => moveVp(ev), () => upVp());
}
function moveVp(e){
  if (!drag || drag.kind !== "vp") return;
  const g = geom();
  const view = pictureView();
  if (!g || !view) return;
  if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
  drag.moved = true;
  const [vx, vy] = clientToView(e, view);
  drag.vx = vx; drag.vy = vy;
  const [ix, iy] = viewToImg(vx, vy, g);
  drag.list[drag.i] = { x: clampVp(ix, g.w, g.h), y: clampVp(iy, g.w, g.h) };
  storePoints(drag.list);
  refresh();
}
function upVp(){
  if (!drag) return;
  const moved = drag.moved, list = drag.list, snap = drag.snapshot;
  unlisten();
  drag = null;
  clearDragCursor();
  if (!moved){ if (snap) restore(snap); refresh(); return; }
  if (list) storePoints(list.map((p) => ({ x: round1(p.x), y: round1(p.y) })));
  save();
  refresh();
}

function refresh(){
  if (!bound) return;
  const g = geom();
  const view = pictureView();
  if (!assetId || !rec.mode || !g || !view){
    if (!drag) detachRoot();
    return;
  }
  draw(view, g);
}
function draw(view, g){
  const host = ensure(view);
  const svg = host.querySelector(".gd-svg");
  const w = view.clientWidth, h = view.clientHeight;
  if (!w || !h) return;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  const parts = [];
  if (rec.mode === "grid") parts.push(...drawGrid(g));
  else if (rec.mode === "1" || rec.mode === "2" || rec.mode === "3") parts.push(...drawPersp(g));
  svg.innerHTML = parts.join("");
  placeEdit(view, g);
}

function drawGrid(g){
  const t = rulerPx(g);
  const p00 = imgToView(0, 0, g), p10 = imgToView(g.w, 0, g), p01 = imgToView(0, g.h, g);
  const down = dir(p00, p01), right = dir(p00, p10);
  const parts = [];
  parts.push(rulerPoly(p00, p10, down, t, "top"));
  parts.push(rulerPoly(p00, p01, right, t, "left"));
  parts.push(...rulerTicks(g, t, true, down));
  parts.push(...rulerTicks(g, t, false, right));
  const hit = coarse() ? 28 : 14;
  rec.v.forEach((x, i) => {
    const a = imgToView(x, 0, g), b = imgToView(x, g.h, g);
    if (![...a, ...b].every(Number.isFinite)) return;
    const kill = drag && drag.kind === "v" && drag.i === i && drag.kill;
    parts.push(`<line class="gd-mark" x1="${px(a[0])}" y1="${px(a[1])}" x2="${px(b[0])}" y2="${px(b[1])}" stroke="${kill ? "#e35d5d" : "var(--accent)"}" stroke-opacity="${kill ? ".4" : ".95"}" stroke-width="1"/>`);
    parts.push(`<line class="gd-hit" data-k="v" data-i="${i}" x1="${px(a[0])}" y1="${px(a[1])}" x2="${px(b[0])}" y2="${px(b[1])}" stroke="transparent" stroke-width="${hit}"/>`);
  });
  rec.h.forEach((y, i) => {
    const a = imgToView(0, y, g), b = imgToView(g.w, y, g);
    if (![...a, ...b].every(Number.isFinite)) return;
    const kill = drag && drag.kind === "h" && drag.i === i && drag.kill;
    parts.push(`<line class="gd-mark" x1="${px(a[0])}" y1="${px(a[1])}" x2="${px(b[0])}" y2="${px(b[1])}" stroke="${kill ? "#e35d5d" : "var(--accent)"}" stroke-opacity="${kill ? ".4" : ".95"}" stroke-width="1"/>`);
    parts.push(`<line class="gd-hit" data-k="h" data-i="${i}" x1="${px(a[0])}" y1="${px(a[1])}" x2="${px(b[0])}" y2="${px(b[1])}" stroke="transparent" stroke-width="${hit}"/>`);
  });
  return parts;
}
function rulerPoly(a, b, inward, t, k){
  const i0 = add(a, inward, 0), i1 = add(b, inward, 0);
  const o0 = add(a, inward, t), o1 = add(b, inward, t);
  const pts = [i0, i1, o1, o0].map((p) => px(p[0]) + "," + px(p[1])).join(" ");
  return `<polygon class="gd-hit" data-k="${k}" points="${pts}" fill="var(--surface-2)" fill-opacity=".9" stroke="var(--border)" stroke-width="1"/>`;
}
function rulerTicks(g, t, horizontal, inward){
  const size = horizontal ? g.w : g.h;
  const step = labelStep(g.s, size);
  const parts = [];
  const angBase = (() => {
    const a = horizontal ? imgToView(0, 0, g) : imgToView(0, 0, g);
    const b = horizontal ? imgToView(Math.min(size, 1) || 1, 0, g) : imgToView(0, Math.min(size, 1) || 1, g);
    return readable(Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI);
  })();
  const minors = rec.snap >= 1 && rec.snap < step - 0.01 && size / rec.snap <= 100;
  const majorAt = new Set();
  const emit = (v, major) => {
    if (v < -1e-6 || v > size + 1e-6) return;
    const p0 = horizontal ? imgToView(v, 0, g) : imgToView(0, v, g);
    if (!Number.isFinite(p0[0])) return;
    const p1 = add(p0, inward, major ? Math.min(t - 4, 11) : Math.min(t * 0.45, 6));
    parts.push(`<line class="gd-mark" x1="${px(p0[0])}" y1="${px(p0[1])}" x2="${px(p1[0])}" y2="${px(p1[1])}" stroke="${major ? "var(--fg)" : "var(--muted)"}" stroke-opacity="${major ? ".85" : ".55"}" stroke-width="1"/>`);
    if (!major) return;
    const at = add(p0, inward, t * 0.62);
    const label = fmt(Math.round(v * 100) / 100);
    parts.push(`<text class="gd-mark" x="${px(at[0])}" y="${px(at[1])}" fill="var(--fg)" font-size="10" font-family="var(--font, sans-serif)" text-anchor="middle" dominant-baseline="middle" transform="rotate(${px(angBase)} ${px(at[0])} ${px(at[1])})">${xml(label)}</text>`);
  };
  for (let i = 0; i < 48; i++){
    const v = i * step;
    if (v > size + 1e-6) break;
    majorAt.add(Math.round(v * 1000));
    emit(v, true);
  }
  if (minors){
    for (let i = 0; i < 120; i++){
      const v = i * rec.snap;
      if (v > size + 1e-6) break;
      if (!majorAt.has(Math.round(v * 1000))) emit(v, false);
    }
  }
  return parts;
}

function drawPersp(g){
  const list = drag?.kind === "vp" && drag.list ? drag.list : pointsFor(g);
  const parts = [];
  const n = list.length;
  for (let i = 0; i < n; i++){
    const vp = list[i];
    const col = VP_COLOR[i] || VP_COLOR[0];
    for (const seg of linesFromVp(vp, g.w, g.h, rec.dens[i] || 8)){
      const a = imgToView(seg[0], seg[1], g), b = imgToView(seg[2], seg[3], g);
      if (![...a, ...b].every(Number.isFinite)) continue;
      parts.push(`<line class="gd-mark" x1="${px(a[0])}" y1="${px(a[1])}" x2="${px(b[0])}" y2="${px(b[1])}" stroke="${col}" stroke-opacity=".72" stroke-width="1"/>`);
    }
  }
  const r = coarse() ? 16 : 9;
  for (let i = 0; i < n; i++){
    const p = imgToView(list[i].x, list[i].y, g);
    if (!Number.isFinite(p[0])) continue;
    const col = VP_COLOR[i] || VP_COLOR[0];
    parts.push(`<circle class="gd-hit" data-k="vp" data-i="${i}" cx="${px(p[0])}" cy="${px(p[1])}" r="${r}" fill="${col}" stroke="#fff" stroke-width="1.5"/>`);
    parts.push(`<text class="gd-mark" x="${px(p[0])}" y="${px(p[1])}" fill="#fff" stroke="rgb(0 0 0 / .7)" stroke-width="3" paint-order="stroke" font-size="${Math.max(11, r)}" font-family="var(--font, sans-serif)" font-weight="700" text-anchor="middle" dominant-baseline="central">${i + 1}</text>`);
  }
  return parts;
}

function wireBar(){
  const btn = bound?.el?.querySelector("#guidesBtn");
  const pop = bound?.el?.querySelector("#guidesPop");
  if (!btn || btn.dataset.gd) return;
  btn.dataset.gd = "1";
  btn.onclick = (e) => { e.stopPropagation(); toggleMenu(); };
  pop?.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape"){ e.preventDefault(); closeMenu(); }
  });
  if (pop && hooks.registerAutoClose) hooks.registerAutoClose(pop, () => closeMenu(), btn);
}

export function mountGuides(h = {}){
  hooks = h;
  injectCss();
  document.addEventListener("pointerdown", (e) => {
    if (!menuOpen) return;
    if (e.target.closest?.(".gd-anchor")) return;
    closeMenu();
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (document.querySelector(".kh")) return;
    if (drag){ e.preventDefault(); e.stopPropagation(); cancelDrag(); return; }
    if (edit && !edit.hidden && (document.activeElement === edit || editGuide)){
      e.preventDefault(); e.stopPropagation(); cancelEdit(); return;
    }
    if (menuOpen){ e.preventDefault(); e.stopPropagation(); closeMenu(); }
  }, true);
  return { bind, setAsset, close };
}
function bind(light){
  bound = light;
  light.onGuideView = () => refresh();
  wireBar();
  paintBtn();
}
function setAsset(id){
  cancelDrag();
  const next = id == null || id === "" ? "" : String(id);
  assetId = next;
  rec = next ? loadRec(next) : blank();
  detachRoot();
  if (!next) closeMenu();
  else if (menuOpen) paintMenu();
  paintBtn();
}
function close(){
  cancelDrag();
  closeMenu();
  detachRoot();
  if (bound){
    bound.onGuideView = null;
    bound.guideGeom = null;
  }
  bound = null;
  assetId = "";
  rec = blank();
}
