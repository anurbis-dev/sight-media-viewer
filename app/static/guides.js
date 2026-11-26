// Lightbox guides for the 2D picture (image, video, PSD). Not the 3D viewer.
// Positions are image pixels and follow attachViewer's geom ({x0, y0, s, w, h, turn})
// through pan, zoom, turn and mirror. One localStorage blob, keyed by asset id.
//
// Grid: rulers just outside the picture's top and left edges (they reach out to the farthest
// guide, and stay inside the lightbox window when the edge is scrolled off). Drag down from
// the top ruler for a vertical guide, right from the left ruler for a horizontal one. Drag a
// guide back onto its ruler, Ctrl+click it or long-press it (touch) to delete it.
// Perspective (one menu item, 1 / 2 / 3 points; stored as mode "1" / "2" / "3", as 0.138 did): one handle per
// vanishing point, lines through the picture toward it. A horizon line runs through points 1 and 2, which always
// share it (2- and 3-point): dragging either point up / down, or the horizon, moves both. Point 3 (3-point) is the
// zenith / nadir: free, but kept off the horizon. 2- and 3-point lines are drawn between the vanishing
// points (through each other and through station rows they share). They are not fanned across the
// corners of the picture. 1-point still is: a star inside the picture, the picture's corner angle outside.
// Guides hide with the drawings (the eye, Shift+H: hooks.hidden).

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
  return { mode: "", snap: 10, v: [], h: [], pts: {}, dens: [8, 8, 8], np: 1 };
}
const isPersp = (m) => m === "1" || m === "2" || m === "3";
function clampNp(v){
  const n = Math.round(Number(v));
  return n >= 1 && n <= 3 ? n : 1;
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
  const mode = MODES.includes(r.mode) ? r.mode : "";
  return {
    mode,
    np: isPersp(mode) ? Number(mode) : clampNp(r.np ?? 1),
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
    || rec.snap !== 10 || rec.dens.some((d) => d !== 8) || rec.np !== 1;
  if (keep){
    all[assetId] = {
      mode: rec.mode, snap: rec.snap, v: rec.v, h: rec.h, pts: rec.pts, dens: rec.dens, np: rec.np,
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

function pointInside(vp, w, h){
  return vp.x >= -1e-6 && vp.x <= w + 1e-6 && vp.y >= -1e-6 && vp.y <= h + 1e-6;
}
// Undirected line angle in [0, π).
function lineAng(dx, dy){
  let a = Math.atan2(dy, dx) % Math.PI;
  if (a < 0) a += Math.PI;
  return a;
}
function takeEven(arr, k){
  if (k <= 0 || !arr.length) return [];
  if (k >= arr.length) return arr.slice();
  if (k === 1) return [arr[Math.floor((arr.length - 1) / 2)]];
  const out = [];
  for (let i = 0; i < k; i++) out.push(arr[Math.round(i * (arr.length - 1) / (k - 1))]);
  return out;
}
// Two horizontal station lines inside the picture, off the horizon and off every handle.
// Every vanishing point of a 2- or 3-point guide draws through the same samples, so the fans meet
// there. The picture's corners are not samples.
function stationRows(points, w, h){
  const hy = points[0].y;
  let yA = h * 0.18, yB = h * 0.82;
  const place = (y, side) => {
    let v = y;
    if (Math.abs(v - hy) < h * 0.07) v = hy + side * h * 0.14;
    for (const p of points){
      if (Math.abs(v - p.y) < h * 0.045) v = p.y + side * h * 0.1;
    }
    return Math.min(h * 0.94, Math.max(h * 0.06, v));
  };
  yA = place(yA, -1);
  yB = place(yB, 1);
  if (yB - yA < h * 0.16){
    yA = Math.max(h * 0.06, hy - h * 0.28);
    yB = Math.min(h * 0.94, hy + h * 0.28);
  }
  const master = 81;
  // Inside the picture, clear of the corners. A ray that would still pass through a corner is skipped later.
  const lo = w * 0.08, hi = w * 0.92;
  const xs = [];
  for (let i = 0; i < master; i++) xs.push(lo + (hi - lo) * i / (master - 1));
  return {
    upper: xs.map((x) => ({ x, y: yA })),
    lower: xs.map((x) => ({ x, y: yB })),
  };
}
// Push p onto an end of the chord only when p lies past that end (an outside handle). A point
// already on the chord, or between the ends, stays where it is. The margin is half a pixel, so a
// handle just outside the picture is still joined (a fraction of the chord length would miss it).
function extendOut(seg, p){
  const beyond = (ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    if (l2 < 1e-8) return false;
    const t = ((p.x - ax) * dx + (p.y - ay) * dy) / l2;
    if ((t - 1) * Math.sqrt(l2) <= 0.5) return false;
    const cx = ax + t * dx, cy = ay + t * dy;
    return Math.hypot(p.x - cx, p.y - cy) < 1.25;
  };
  if (beyond(seg[2], seg[3], seg[0], seg[1])) return [p.x, p.y, seg[2], seg[3]];
  if (beyond(seg[0], seg[1], seg[2], seg[3])) return [seg[0], seg[1], p.x, p.y];
  return seg;
}
// True when the line through vp and (x, y) is aimed at a corner of the picture (within about a degree).
// Distance-to-the-line is not enough: a handle near a corner makes every line look close to it.
function nearCorner(vp, x, y, w, h){
  const dx = x - vp.x, dy = y - vp.y, l = Math.hypot(dx, dy);
  if (l < 1e-6) return false;
  for (const [cx, cy] of [[0, 0], [w, 0], [w, h], [0, h]]){
    const cl = Math.hypot(cx - vp.x, cy - vp.y);
    if (cl < 1e-6) continue;
    const sin = Math.abs(dx * (cy - vp.y) - dy * (cx - vp.x)) / (l * cl);
    if (sin < 0.015) return true;
  }
  return false;
}
// Same line already drawn (float noise, or a sample that lands on a vanishing-point line).
function tooClose(a, angs){
  for (const b of angs){
    const d = Math.abs(a - b);
    if (Math.min(d, Math.PI - d) < 5e-4) return true;
  }
  return false;
}
function stationOrder(rows, need){
  const seq = [];
  const m = Math.max(rows.upper.length, rows.lower.length);
  for (let i = 0; i < m; i++){
    if (i < rows.upper.length) seq.push(rows.upper[i]);
    if (i < rows.lower.length) seq.push(rows.lower[i]);
  }
  const order = takeEven(seq, Math.min(Math.max(need, 1), seq.length));
  const seen = new Set(order);
  for (const s of seq) if (!seen.has(s)) order.push(s);
  return order;
}
function sampleAngle(vp, s, angs, w, h){
  if (nearCorner(vp, s.x, s.y, w, h)) return null;
  const a = lineAng(s.x - vp.x, s.y - vp.y);
  if (tooClose(a, angs)) return null;
  return a;
}
// Shared samples first (every point that still needs a line can use them, so the fans meet), then
// each point fills its own count from what it can use. One point running out of spread does not
// shorten the others.
function stationPicks(points, rows, spares, w, h){
  const need = Math.max(0, ...spares);
  const lists = points.map(() => []);
  if (!need) return lists;
  const angs = points.map((vp, i) => {
    const list = [];
    for (let j = 0; j < points.length; j++){
      if (j === i) continue;
      list.push(lineAng(points[j].x - vp.x, points[j].y - vp.y));
    }
    return list;
  });
  const order = stationOrder(rows, need);
  const shared = [];
  for (const s of order){
    if (shared.length >= need) break;
    const add = [];
    let ok = true;
    for (let i = 0; i < points.length; i++){
      if (spares[i] <= shared.length) continue;
      const a = sampleAngle(points[i], s, angs[i], w, h);
      if (a == null){ ok = false; break; }
      add[i] = a;
    }
    if (!ok) continue;
    shared.push(s);
    for (let i = 0; i < points.length; i++){
      if (add[i] == null) continue;
      angs[i].push(add[i]);
      lists[i].push(s);
    }
  }
  for (let i = 0; i < points.length; i++){
    if (lists[i].length >= spares[i]) continue;
    const have = new Set(lists[i]);
    for (const s of order){
      if (lists[i].length >= spares[i]) break;
      if (have.has(s)) continue;
      const a = sampleAngle(points[i], s, angs[i], w, h);
      if (a == null) continue;
      angs[i].push(a);
      lists[i].push(s);
      have.add(s);
    }
  }
  return lists;
}
// Lines of one vanishing point in a 2- or 3-point guide. One line through each other vanishing point
// (never merged, even when the two handles are almost in line), then the shared station samples.
// A handle outside the picture is joined onto its own lines.
function linkedLines(vp, others, samples, w, h, n){
  const segs = [];
  const add = (x, y, cornerOk) => {
    if (segs.length >= n) return;
    const dx = x - vp.x, dy = y - vp.y;
    if (dx * dx + dy * dy < 1e-8) return;
    let seg = chord(vp, lineAng(dx, dy), w, h, true);
    if (seg){
      seg = extendOut(seg, vp);
      for (const o of others) seg = extendOut(seg, o);
    } else if (cornerOk){
      // The two handles' own line misses the picture (both above it, for example). Draw it anyway.
      seg = [vp.x, vp.y, x, y];
    } else return;
    segs.push(seg);
  };
  for (const o of others) add(o.x, o.y, true);
  for (const s of samples) add(s.x, s.y, false);
  return segs;
}
// One segment list per vanishing point. 1-point keeps linesFromVp (a star inside the picture,
// the picture's corner angle outside). 2- and 3-point are linkedLines, inside or outside.
export function linesForPoints(points, w, h, counts){
  const ns = points.map((_, i) => Math.max(2, Math.min(40, (counts && counts[i]) | 0 || 8)));
  const rows = points.length >= 2 ? stationRows(points, w, h) : null;
  if (!rows) return points.map((vp, i) => linesFromVp(vp, w, h, ns[i]));
  const othersN = points.length - 1;
  const spares = ns.map((n) => Math.max(0, n - othersN));
  const picks = stationPicks(points, rows, spares, w, h);
  return points.map((vp, i) => {
    const others = [];
    for (let j = 0; j < points.length; j++) if (j !== i) others.push(points[j]);
    return linkedLines(vp, others, picks[i], w, h, ns[i]);
  });
}
// 1-point only. Inside: `n` full lines. Outside: `n` lines across the angle the picture's
// corners occupy, each drawn from the point through the far edge. 2- and 3-point use linesForPoints.
export function linesFromVp(vp, w, h, n){
  n = Math.max(2, Math.min(40, n | 0));
  const angs = [];
  const inside = pointInside(vp, w, h);
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
  // 0.138 kept 2- / 3-point points at any height: they now share one horizon (their mean height).
  if (n >= 2 && out[0].y !== out[1].y){
    const hy = (out[0].y + out[1].y) / 2;
    out[0].y = hy; out[1].y = hy;
  }
  keepOffHorizon(out, g, 2);
  return out;
}
// The zenith / nadir point is kept at least 5 % of the picture's height off the horizon. `moved`: which one the
// person moves (2 = point 3; otherwise the horizon gives way).
function keepOffHorizon(list, g, moved){
  if (list.length < 3) return;
  const min = 0.05 * g.h, hy = list[0].y, p3 = list[2];
  if (Math.abs(p3.y - hy) >= min) return;
  if (moved === 2){
    const side = p3.y >= hy ? 1 : -1;
    p3.y = hy + side * min;
  } else {
    const side = hy >= p3.y ? 1 : -1;
    list[0].y = list[1].y = p3.y + side * min;
  }
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
function rulerPx(){
  return coarse() ? 32 : 22;
}
// The two rulers in view px. Each lies along a picture edge (top: image y = 0, left: x = 0), on its
// outer side, and runs from min(0, guides) to max(size, guides) in image px along that edge.
// o: the view point of image coordinate 0 on the ruler's inner line; a: unit along the edge (one
// image px = g.s view px); n: unit normal pointing away from the picture; off: the inner line's
// distance from the edge along n (0 = touching the picture; less when the edge is off screen, so
// the band stays in the window); t: the band's depth; lo / hi: the drawn span in image px.
let rulers = null;
function rulerFrames(g, W, H){
  const t = rulerPx();
  const p00 = imgToView(0, 0, g), p10 = imgToView(g.w, 0, g), p01 = imgToView(0, g.h, g);
  const right = dir(p00, p10), down = dir(p00, p01);
  const corners = [[0, 0], [W, 0], [0, H], [W, H]];
  const vis = corners.map(([x, y]) => viewToImg(x, y, g));
  const frame = (k, a, n, size, list, axis) => {
    const ds = corners.map(([x, y]) => (x - p00[0]) * n[0] + (y - p00[1]) * n[1]);
    const dmax = Math.max(...ds), dmin = Math.min(...ds);
    const off = Math.max(dmin, Math.min(0, dmax - t));
    let lo = 0, hi = size;
    for (const v of list){ if (Number.isFinite(v)){ lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    // Only what can be on screen: the window's corners in image px bound the visible span.
    const vs = vis.map((p) => p[axis]);
    const pad = t / g.s;
    lo = Math.max(lo, Math.min(...vs) - pad);
    hi = Math.min(hi, Math.max(...vs) + pad);
    return { k, o: add(p00, n, off), a, n, off, t, lo, hi, s: g.s };
  };
  return {
    top: frame("top", right, [-down[0], -down[1]], g.w, rec.v, 0),
    left: frame("left", down, [-right[0], -right[1]], g.h, rec.h, 1),
  };
}
function rulerAt(f, v, depth){
  return add(add(f.o, f.a, v * f.s), f.n, depth);
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

// Is the view point (vx, vy) on that ruler's band (with a little slop)?
function overRuler(which, vx, vy){
  const f = rulers?.[which];
  if (!f || !(f.hi >= f.lo)) return false;
  const dx = vx - f.o[0], dy = vy - f.o[1], slop = 10;
  const u = (dx * f.a[0] + dy * f.a[1]) / f.s, w = dx * f.n[0] + dy * f.n[1];
  return w >= -slop && w <= f.t + slop && u >= f.lo - slop / f.s && u <= f.hi + slop / f.s;
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
.gd-row { display: flex; align-items: center; }
.gd-row > button { flex: 1 1 auto; width: auto; min-width: 0; }
.gd-row > .gd-field { flex: none; padding-left: 4px; }
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
.gd-svg .gd-hit[data-k="hz"] { pointer-events: all; }
.gd-np { display: flex; gap: 2px; padding: 0 6px 0 4px; flex: none; }
.gd-pop .gd-np button { width: 30px; height: 28px; padding: 0; justify-content: center; border: 1px solid var(--border); font-variant-numeric: tabular-nums; }
.gd-pop .gd-np button.on { border-color: var(--accent); }
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
  const nVp = isPersp(rec.mode) ? Number(rec.mode) : 0;
  const dens = nVp ? Array.from({ length: nVp }, (_, i) =>
    `<label class="gd-dens"><i style="background:${VP_COLOR[i]}"></i><span>Point ${i + 1}</span><input type="range" min="2" max="40" step="1" data-dens="${i}" value="${rec.dens[i]}" aria-label="Point ${i + 1} lines"><b>${rec.dens[i]}</b></label>`
  ).join("") : "";
  pop.innerHTML = `
    ${row("", "Off")}
    <div class="gd-row">${row("grid", "Grid")}<label class="gd-field">Snap<input type="number" min="1" max="500" step="1" data-snap value="${rec.snap}" aria-label="Snap step in pixels">px</label></div>
    <div class="sep"></div>
    <div class="gd-row"><button type="button" role="menuitemradio" aria-checked="${nVp ? "true" : "false"}" data-mode="persp" class="${nVp ? "on" : ""}"><span class="chk">${nVp ? "✓" : ""}</span>Perspective</button><span class="gd-np" role="group" aria-label="Vanishing points">${[1, 2, 3].map((n) =>
      `<button type="button" role="menuitemradio" data-np="${n}" class="${rec.np === n ? "on" : ""}" aria-checked="${nVp && rec.np === n ? "true" : "false"}" title="${n}-point perspective">${n}</button>`).join("")}</span></div>
    ${dens}`;
  pop.querySelectorAll("[data-mode]").forEach((b) => {
    b.onclick = () => {
      const m = b.dataset.mode;
      if (m === "persp") rec.mode = isPersp(rec.mode) ? "" : String(rec.np);
      else rec.mode = m && m === rec.mode ? "" : m;
      pickedMode();
    };
  });
  // The point count: picks it and turns perspective on with it.
  pop.querySelectorAll("[data-np]").forEach((b) => {
    b.onclick = () => {
      rec.np = clampNp(b.dataset.np);
      rec.mode = String(rec.np);
      pickedMode();
    };
  });
  function pickedMode(){
    save();
    // Picking guides while the eye hides them shows them (and the drawings: one state).
    if (rec.mode && hooks.hidden?.()) hooks.reveal?.();
    paintBtn();
    paintMenu();
    refresh();
    hooks.onModeChange?.();
  }
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
  clearTimeout(drag.lp);
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
    // Ctrl+click (Cmd on a Mac) deletes the guide at once; a finger long-presses it (beginGuideDrag).
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey){
      deleteGuide(k, Number(hit.dataset.i));
      return;
    }
    beginGuideDrag(e, view, g, k, Number(hit.dataset.i), false, snap, vx, vy);
    return;
  }
  if (k === "vp") beginVpDrag(e, view, g, Number(hit.dataset.i), snap, vx, vy);
  else if (k === "hz") beginVpDrag(e, view, g, -1, snap, vx, vy);
}

function deleteGuide(kind, i){
  const arr = kind === "v" ? rec.v : rec.h;
  if (!(i >= 0 && i < arr.length)) return;
  if (drag) cancelDrag();
  arr.splice(i, 1);
  hideEdit();
  save();
  refresh();
}
const LONG_PRESS_MS = 550;
function beginGuideDrag(e, view, g, kind, i, fresh, snap, vx, vy){
  hideEdit();
  drag = { kind, i, fresh, snapshot: snap, moved: false, typing: false, kill: !!fresh, pid: e.pointerId, pType: e.pointerType || "mouse", x0: e.clientX, y0: e.clientY, vx, vy };
  // Touch / pen: holding an existing guide still deletes it (the finger's Ctrl+click).
  if (!fresh && e.pointerType && e.pointerType !== "mouse"){
    const d = drag;
    d.lp = setTimeout(() => {
      if (drag !== d || d.moved || editGuide?.typing) return;
      unlisten();
      drag = null;
      clearDragCursor();
      deleteGuide(kind, i);
    }, LONG_PRESS_MS);
  }
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
  // A resting finger wanders: touch / pen get a wider still zone (the long press needs it).
  const still = drag.pType && drag.pType !== "mouse" ? 10 : 4;
  if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) >= still){ drag.moved = true; clearTimeout(drag.lp); }
  const [vx, vy] = clientToView(e, view);
  drag.vx = vx; drag.vy = vy;
  const [ix, iy] = viewToImg(vx, vy, g);
  const which = drag.kind === "v" ? "top" : "left";
  // Within the still zone a tap / hold does not move (or re-snap) the guide.
  if (!editGuide?.typing && drag.moved){
    const raw = drag.kind === "v" ? ix : iy;
    writeGuide(drag.kind, drag.i, raw, true);
  }
  // The ruler reaches out to the dragged guide: test against the rulers as they are now, not as last drawn.
  rulers = rulerFrames(g, view.clientWidth, view.clientHeight);
  // A tap on a guide where it crosses a ruler (zoomed in, the ruler is pinned over the picture) opens its field.
  drag.kill = (drag.moved || drag.fresh) && overRuler(which, vx, vy);
  setDragCursor(drag.kill);
  if (!editGuide?.typing) markKill(drag.kill);
  refresh();
}
function upGuide(){
  if (!drag) return;
  const d = drag;
  clearTimeout(d.lp);
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
  const list = drag.list, n = list.length;
  const x = clampVp(ix, g.w, g.h), y = clampVp(iy, g.w, g.h);
  if (drag.i < 0){
    // The horizon: the points on it move up / down with it (the 1-point one too), x stays.
    for (let i = 0; i < Math.min(n, 2); i++) list[i] = { x: list[i].x, y };
  } else if (drag.i < 2 && n >= 2){
    list[drag.i] = { x, y };
    const o = 1 - drag.i;
    list[o] = { x: list[o].x, y };
  } else {
    list[drag.i] = { x, y };
  }
  keepOffHorizon(list, g, drag.i);
  storePoints(list);
  refresh();
}
function upVp(){
  if (!drag) return;
  const moved = drag.moved, list = drag.list, snap = drag.snapshot;
  unlisten();
  drag = null;
  clearDragCursor();
  if (!moved){ if (snap) restore(snap); refresh(); return; }
  if (list) storePoints(list.map((p) => ({ x: round1(p.x), y: round1(p.y) })));   // (points 1 and 2 round alike)
  save();
  refresh();
}

function refresh(){
  if (!bound) return;
  const g = geom();
  const view = pictureView();
  if (!assetId || !rec.mode || !g || !view || (hooks.hidden?.() && !drag)){
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
  if (rec.mode === "grid") parts.push(...drawGrid(g, w, h));
  else if (isPersp(rec.mode)) parts.push(...drawPersp(g, w, h));
  svg.innerHTML = parts.join("");
  placeEdit(view, g);
}

function drawGrid(g, W, H){
  rulers = rulerFrames(g, W, H);
  const parts = [];
  for (const f of [rulers.top, rulers.left]){
    if (!(f.hi > f.lo)) continue;
    parts.push(rulerPoly(f));
    parts.push(...rulerTicks(f, g));
  }
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
function rulerPoly(f){
  const pts = [rulerAt(f, f.lo, 0), rulerAt(f, f.hi, 0), rulerAt(f, f.hi, f.t), rulerAt(f, f.lo, f.t)]
    .map((p) => px(p[0]) + "," + px(p[1])).join(" ");
  return `<polygon class="gd-hit" data-k="${f.k}" points="${pts}" fill="var(--surface-2)" fill-opacity=".9" stroke="var(--border)" stroke-width="1"/>`;
}
// Ticks grow from the side next to the picture; labels sit toward the outer side.
function rulerTicks(f, g){
  const t = f.t;
  const step = labelStep(g.s, f.hi - f.lo);
  const parts = [];
  const angBase = readable(Math.atan2(f.a[1], f.a[0]) * 180 / Math.PI);
  const minors = rec.snap >= 1 && rec.snap < step - 0.01 && (f.hi - f.lo) / rec.snap <= 100;
  const majorAt = new Set();
  const emit = (v, major) => {
    if (v < f.lo - 1e-6 || v > f.hi + 1e-6) return;
    const p0 = rulerAt(f, v, 0);
    if (!Number.isFinite(p0[0])) return;
    const p1 = add(p0, f.n, major ? Math.min(t - 4, 11) : Math.min(t * 0.45, 6));
    parts.push(`<line class="gd-mark" x1="${px(p0[0])}" y1="${px(p0[1])}" x2="${px(p1[0])}" y2="${px(p1[1])}" stroke="${major ? "var(--fg)" : "var(--muted)"}" stroke-opacity="${major ? ".85" : ".55"}" stroke-width="1"/>`);
    if (!major) return;
    const at = add(p0, f.n, t * 0.62);
    const label = fmt(Math.round(v * 100) / 100);
    parts.push(`<text class="gd-mark" x="${px(at[0])}" y="${px(at[1])}" fill="var(--fg)" font-size="10" font-family="var(--font, sans-serif)" text-anchor="middle" dominant-baseline="middle" transform="rotate(${px(angBase)} ${px(at[0])} ${px(at[1])})">${xml(label)}</text>`);
  };
  const first = Math.ceil((f.lo - 1e-6) / step);
  for (let i = first, c = 0; c < 60; i++, c++){
    const v = i * step;
    if (v > f.hi + 1e-6) break;
    majorAt.add(Math.round(v * 1000));
    emit(v, true);
  }
  if (minors){
    const s0 = Math.ceil((f.lo - 1e-6) / rec.snap);
    for (let i = s0, c = 0; c < 120; i++, c++){
      const v = i * rec.snap;
      if (v > f.hi + 1e-6) break;
      if (!majorAt.has(Math.round(v * 1000))) emit(v, false);
    }
  }
  return parts;
}

function drawPersp(g, W, H){
  const list = drag?.kind === "vp" && drag.list ? drag.list : pointsFor(g);
  const parts = [];
  const n = list.length;
  // The horizon through point 1 (and 2), across the window: image y = hy from the window's leftmost to rightmost x.
  if (n){
    const hy = list[0].y;
    const xs = [[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => viewToImg(x, y, g)[0]);
    const pad = 40 / g.s;
    const a = imgToView(Math.min(...xs, 0) - pad, hy, g), b = imgToView(Math.max(...xs, g.w) + pad, hy, g);
    if ([...a, ...b].every(Number.isFinite)){
      const on = drag?.kind === "vp" && drag.i < 0;
      parts.push(`<line class="gd-mark" x1="${px(a[0])}" y1="${px(a[1])}" x2="${px(b[0])}" y2="${px(b[1])}" stroke="var(--fg)" stroke-opacity="${on ? ".95" : ".6"}" stroke-width="${on ? 1.5 : 1}" stroke-dasharray="6 4"/>`);
      // Only a small tab grabs the horizon (a band across the window would eat strokes, pans and pinches): halfway
      // between points 1 and 2, kept in the window. 1-point has none: its point moves the horizon.
      if (n >= 2){
        const p1 = imgToView(list[0].x, hy, g), p2 = imgToView(list[1].x, hy, g);
        const u = dir(a, b), r = coarse() ? 14 : 8, m = r + 6;
        let c = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
        // Slide it along the horizon into the window if the midpoint is off screen.
        const inside = (q) => q[0] >= m - 0.01 && q[0] <= W - m + 0.01 && q[1] >= m - 0.01 && q[1] <= H - m + 0.01;
        if (!inside(c)){
          let best = null;
          for (const [k, lim] of [[0, m], [0, W - m], [1, m], [1, H - m]]){
            if (Math.abs(u[k]) < 1e-9) continue;
            const tt = (lim - c[k]) / u[k];
            if (inside(add(c, u, tt)) && (best == null || Math.abs(tt) < Math.abs(best))) best = tt;
          }
          if (best != null) c = add(c, u, best);
        }
        if (c.every(Number.isFinite)){
          // The drag runs across the horizon: ns-resize when it lies flat on screen, ew-resize when it is turned upright.
          const cur = Math.abs(u[0]) >= Math.abs(u[1]) ? "ns-resize" : "ew-resize";
          const pts = [add(c, u, -r * 1.6), add(c, [-u[1], u[0]], r), add(c, u, r * 1.6), add(c, [u[1], -u[0]], r)]
            .map((q) => px(q[0]) + "," + px(q[1])).join(" ");
          parts.push(`<polygon class="gd-hit" data-k="hz" points="${pts}" fill="var(--surface-2)" fill-opacity=".92" stroke="var(--fg)" stroke-opacity=".8" stroke-width="1" style="cursor:${cur}"><title>Horizon — drag to move points 1 and 2 up or down</title></polygon>`);
        }
      }
    }
  }
  const packs = linesForPoints(list, g.w, g.h, list.map((_, i) => rec.dens[i] || 8));
  for (let i = 0; i < n; i++){
    const vp = list[i];
    const col = VP_COLOR[i] || VP_COLOR[0];
    for (const seg of packs[i]){
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
  return { bind, setAsset, close, refresh: () => refresh(), active: () => !!(assetId && rec.mode && bound) };
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
  hooks.onModeChange?.();
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
