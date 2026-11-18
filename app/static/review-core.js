// Review core — the part of a review that every client shares: drawing primitives (build, SVG and
// canvas rendering, bounds, hit tests, transforms) and the merge rules for review rows. Sight's
// annotate.js imports it; app/review.py inlines it into the HTML page for reviewers; the planned
// mobile app (docs/PLAN-mobile.md) uses it as is. The data it works on is specified in
// docs/FORMAT.md — keep the two in step.
//
// Plain script, no build step and no imports, so it can be inlined into a <script> tag. It defines
// one global, `SightReviewCore` (also `module.exports` under Node, for the merge parity test).
//   - annotate.js:   import "/static/review-core.js"; const RC = globalThis.SightReviewCore;
//   - HTML page:     inlined before the page script (review.build_html), then `SightReviewCore`.
// Never write a closing script tag or an HTML comment opener anywhere in this file, not even in
// a comment or a string: the page inlines it verbatim (review.core_js refuses to build otherwise).
//
// The merge (mergeRows / mergeReplies / mergeHistory) is a port of Library.import_annotations,
// Library.merge_replies, Library.merge_history and Library._content_at in app/library.py. Change
// both sides together; tests/test_merge_parity.py runs both on the same fixtures.

var SightReviewCore = (function(){
  "use strict";

  var FORMAT = "sight-review";
  var FORMAT_VERSION = 1;

  var STROKE_TOOLS = new Set(["brush", "pencil", "marker", "arrows"]);
  var SHAPE_TOOLS = new Set(["rect", "ellipse", "line", "arrow"]);
  // [id, label, CSS font stack] — text drawings store the id (data.font).
  var FONTS = [
    ["sans", "Sans", '"Segoe UI", system-ui, -apple-system, Arial, sans-serif'],
    ["serif", "Serif", 'Georgia, "Times New Roman", serif'],
    ["mono", "Mono", 'Consolas, "SF Mono", ui-monospace, monospace'],
    ["hand", "Hand", '"Segoe Print", "Comic Sans MS", "Bradley Hand", cursive'],
    ["impact", "Impact", 'Impact, "Arial Black", sans-serif'],
  ];

  // ---- small helpers ---------------------------------------------------------------------------
  // 16 hex chars — the id shape every client makes (rows, replies, events, shots).
  function uid(){
    var a = new Uint8Array(8);
    crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function(b){ return b.toString(16).padStart(2, "0"); }).join("");
  }
  var clamp = function(v, a, b){ return Math.min(b, Math.max(a, v)); };
  var r2 = function(v){ return Math.round(v * 100) / 100; };
  var hyp = function(x, y){ return Math.sqrt(x * x + y * y); };
  // A drawing's type: the editor's `sub`, a table row's `shape_kind`, else its kind (text / pin / note).
  var typeOf = function(it){ return it.sub || it.shape_kind || it.kind; };
  var ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  var esc = function(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return ESC[c]; }); };
  var fontStack = function(id){ return (FONTS.find(function(f){ return f[0] === id; }) || FONTS[0])[2]; };
  function segDist(px, py, ax, ay, bx, by){
    var dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
    var t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
    t = clamp(t, 0, 1);
    return hyp(px - ax - t * dx, py - ay - t * dy);
  }
  function rotPt(x, y, cx, cy, deg){
    if (!deg) return [x, y];
    var a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
  }

  // ---- geometry → primitives -------------------------------------------------------------------
  // Every object is turned into a list of primitives, which both the SVG overlay and the canvas
  // compositor (screenshots, PDF frames) draw, so they always look the same.
  //   { d, fill, stroke, sw, op, dash, cap, join, rot:[deg,cx,cy] }    path
  //   { text: [...lines], x, y, font, size, lh, align, w, fill, stroke, sw, op, underline, rot }

  function smoothPath(pts, closed){
    // Quadratic curves through the midpoints of consecutive points (points: [[x,y],...]).
    var n = pts.length;
    if (!n) return "";
    if (n < 3) return "M" + pts.map(function(p){ return r2(p[0]) + " " + r2(p[1]); }).join("L") + (closed ? "Z" : "");
    var d = "M" + r2(pts[0][0]) + " " + r2(pts[0][1]);
    for (var i = 1; i < n - 1; i++){
      var mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      d += "Q" + r2(pts[i][0]) + " " + r2(pts[i][1]) + " " + r2(mx) + " " + r2(my);
    }
    d += "L" + r2(pts[n - 1][0]) + " " + r2(pts[n - 1][1]);
    return d + (closed ? "Z" : "");
  }

  // Per-point radius of a brush / pencil stroke: pen pressure (data.pen, unless data.pressure is
  // false), or for a mouse brush a short taper at both ends.
  function strokeRadii(it){
    var d = it.data, pts = d.pts, n = pts.length / 3, base = d.size / 2;
    var pen = !!d.pen && d.pressure !== false;
    var lo = typeOf(it) === "pencil" ? 0.45 : 0.12;
    var rs = new Array(n);
    var acc = 0, total = 0, i;
    for (i = 3; i < pts.length; i += 3) total += hyp(pts[i] - pts[i - 3], pts[i + 1] - pts[i - 2]);
    for (i = 0; i < n; i++){
      if (i) acc += hyp(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 1] - pts[i * 3 - 2]);
      var r = base;
      if (pen) r = base * (lo + (1 - lo) * clamp(pts[i * 3 + 2], 0, 1));
      else if (typeOf(it) === "brush" && !d.close){
        // Mouse strokes have no pressure — taper the ends a little so they still read as a brush.
        var t = Math.min(1, acc / (base * 4 + 1e-6), (total - acc) / (base * 4 + 1e-6));
        r = base * (0.4 + 0.6 * Math.sqrt(clamp(t, 0, 1)));
      }
      rs[i] = Math.max(r, 0.05);
    }
    return rs;
  }

  // The filled outline of a brush / pencil stroke from its per-point radii.
  function strokeOutline(it){
    // A closed stroke (data.close, the brush's lasso) runs back to its first point.
    if (it.data.close && it.data.pts.length >= 9 && !it._closed){
      var cd = Object.assign({}, it.data, { pts: it.data.pts.concat(it.data.pts.slice(0, 3)) });
      return strokeOutline({ sub: typeOf(it), data: cd, _closed: true });
    }
    var pts = it.data.pts, n = pts.length / 3;
    var rs = strokeRadii(it);
    if (n === 1 || (n === 2 && hyp(pts[3] - pts[0], pts[4] - pts[1]) < 0.01)){
      var r0 = rs[0], x0 = pts[0], y0 = pts[1];
      return "M" + r2(x0 - r0) + " " + r2(y0) + "a" + r2(r0) + " " + r2(r0) + " 0 1 0 " + r2(r0 * 2) + " 0a" + r2(r0) + " " + r2(r0) + " 0 1 0 " + r2(-r0 * 2) + " 0Z";
    }
    var L = [], R = [];
    for (var i = 0; i < n; i++){
      var a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      var tx = pts[b * 3] - pts[a * 3], ty = pts[b * 3 + 1] - pts[a * 3 + 1];
      var l = hyp(tx, ty) || 1;
      tx /= l; ty /= l;
      var x = pts[i * 3], y = pts[i * 3 + 1], r = rs[i];
      L.push([x - ty * r, y + tx * r]);
      R.push([x + ty * r, y - tx * r]);
    }
    var re = rs[n - 1], rb = rs[0];
    var d = smoothPath(L, false);
    // The end cap bulges forward (sweep 0): L → R turns through the stroke's direction of travel.
    d += "A" + r2(re) + " " + r2(re) + " 0 0 0 " + r2(R[n - 1][0]) + " " + r2(R[n - 1][1]);
    d += smoothPath(R.slice().reverse(), false).replace(/^M/, "L");
    d += "A" + r2(rb) + " " + r2(rb) + " 0 0 0 " + r2(L[0][0]) + " " + r2(L[0][1]) + "Z";  // start cap, bulging backward
    return d;
  }

  function dashArray(dash, w){
    if (dash === "dashed") return [w * 3, w * 2.2];
    if (dash === "dotted") return [0.01, w * 2];
    return null;
  }

  function rectPath(x, y, w, h, r){
    r = clamp(r || 0, 0, Math.min(Math.abs(w), Math.abs(h)) / 2);
    if (w < 0){ x += w; w = -w; }
    if (h < 0){ y += h; h = -h; }
    if (!r) return "M" + r2(x) + " " + r2(y) + "h" + r2(w) + "v" + r2(h) + "h" + r2(-w) + "Z";
    var a = r2(r) + " " + r2(r) + " 0 0 1 ";
    return "M" + r2(x + r) + " " + r2(y) + "h" + r2(w - 2 * r) + "a" + a + r2(r) + " " + r2(r) + "v" + r2(h - 2 * r) + "a" + a + r2(-r) + " " + r2(r)
      + "h" + r2(-(w - 2 * r)) + "a" + a + r2(-r) + " " + r2(-r) + "v" + r2(-(h - 2 * r)) + "a" + a + r2(r) + " " + r2(-r) + "Z";
  }
  function ellipsePath(cx, cy, rx, ry){
    rx = Math.abs(rx); ry = Math.abs(ry);
    return "M" + r2(cx - rx) + " " + r2(cy) + "a" + r2(rx) + " " + r2(ry) + " 0 1 0 " + r2(rx * 2) + " 0a" + r2(rx) + " " + r2(ry) + " 0 1 0 " + r2(-rx * 2) + " 0Z";
  }

  // Points along a line/arrow body: straight, curved (quadratic, data.bend = signed offset of the
  // control point from the chord's midpoint) or elbow (one right-angle corner).
  function linePoints(d){
    var x1 = d.pts[0], y1 = d.pts[1], x2 = d.pts[2], y2 = d.pts[3];
    if (d.body === "curve"){
      var c = bendCtrl(d), out = [];
      for (var i = 0; i <= 24; i++){
        var t = i / 24, u = 1 - t;
        out.push([u * u * x1 + 2 * u * t * c[0] + t * t * x2, u * u * y1 + 2 * u * t * c[1] + t * t * y2]);
      }
      return out;
    }
    if (d.body === "elbow"){
      var horiz = Math.abs(x2 - x1) >= Math.abs(y2 - y1);
      return horiz ? [[x1, y1], [(x1 + x2) / 2, y1], [(x1 + x2) / 2, y2], [x2, y2]] : [[x1, y1], [x1, (y1 + y2) / 2], [x2, (y1 + y2) / 2], [x2, y2]];
    }
    return [[x1, y1], [x2, y2]];
  }
  function bendCtrl(d){
    var x1 = d.pts[0], y1 = d.pts[1], x2 = d.pts[2], y2 = d.pts[3];
    var mx = (x1 + x2) / 2, my = (y1 + y2) / 2, l = hyp(x2 - x1, y2 - y1) || 1;
    var b = d.bend != null ? d.bend : l * 0.25;
    // Control point so that the curve's apex (t = .5) sits `b` away from the chord midpoint.
    return [mx - (y2 - y1) / l * b * 2, my + (x2 - x1) / l * b * 2];
  }
  function bendHandle(d){
    var x1 = d.pts[0], y1 = d.pts[1], x2 = d.pts[2], y2 = d.pts[3];
    var mx = (x1 + x2) / 2, my = (y1 + y2) / 2, l = hyp(x2 - x1, y2 - y1) || 1;
    var b = d.bend != null ? d.bend : l * 0.25;
    return [mx - (y2 - y1) / l * b, my + (x2 - x1) / l * b];
  }

  function headPrims(kind, tip, from, w, size, color, op){
    if (kind === "none") return { prims: [], trim: 0 };
    var h = Math.max(w * 4.5, w + 9) * (size || 1);
    var ux = tip[0] - from[0], uy = tip[1] - from[1];
    var l = hyp(ux, uy) || 1;
    ux /= l; uy /= l;
    var nx = -uy, ny = ux, tx = tip[0], ty = tip[1];
    var P = function(a, b){ return [tx - ux * a + nx * b, ty - uy * a + ny * b]; };
    var path = function(pts, close){ return "M" + pts.map(function(p){ return r2(p[0]) + " " + r2(p[1]); }).join("L") + (close ? "Z" : ""); };
    if (kind === "triangle") return { prims: [{ d: path([P(0, 0), P(h, h * 0.5), P(h, -h * 0.5)], true), fill: color, op: op, join: "round", stroke: color, sw: w * 0.5 }], trim: h * 0.85 };
    if (kind === "diamond") return { prims: [{ d: path([P(0, 0), P(h * 0.55, h * 0.4), P(h * 1.1, 0), P(h * 0.55, -h * 0.4)], true), fill: color, op: op }], trim: h * 1.0 };
    if (kind === "open") return { prims: [{ d: path([P(h, h * 0.55), P(0, 0), P(h, -h * 0.55)], false), stroke: color, sw: w, op: op, cap: "round", join: "round" }], trim: 0 };
    if (kind === "dot") return { prims: [{ d: ellipsePath(tx, ty, h * 0.38, h * 0.38), fill: color, op: op }], trim: h * 0.3 };
    if (kind === "bar") return { prims: [{ d: path([P(0, h * 0.55), P(0, -h * 0.55)], false), stroke: color, sw: w, op: op, cap: "round" }], trim: 0 };
    return { prims: [], trim: 0 };
  }

  function trimPolyline(pts, atStart, amount){
    if (!amount || pts.length < 2) return pts;
    var out = pts.map(function(p){ return p.slice(); });
    if (atStart) out.reverse();
    var left = amount;
    while (out.length >= 2){
      var a = out[out.length - 1], b = out[out.length - 2];
      var l = hyp(a[0] - b[0], a[1] - b[1]);
      if (l > left){ var t = left / l; a[0] += (b[0] - a[0]) * t; a[1] += (b[1] - a[1]) * t; break; }
      left -= l;
      if (out.length === 2){ out[1] = out[0].slice(); break; }
      out.pop();
    }
    if (atStart) out.reverse();
    return out;
  }

  // Text is measured with a canvas when there is a document; elsewhere (Node) widths are estimated.
  var measureCtx = null;
  function measure(font, s){
    if (measureCtx === null) measureCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : false;
    if (!measureCtx){ var m = /(\d+(?:\.\d+)?)px/.exec(font); return (m ? Number(m[1]) : 16) * 0.55 * s.length; }
    measureCtx.font = font;
    return measureCtx.measureText(s).width;
  }
  function textFont(d){ return (d.italic ? "italic " : "") + (d.bold ? "700 " : "400 ") + d.size + "px " + fontStack(d.font); }
  function textLayout(d){
    var font = textFont(d);
    var lines = String(d.text || "").split("\n");
    var widths = lines.map(function(l){ return measure(font, l || " "); });
    var w = Math.max.apply(null, [d.size * 0.5].concat(widths)), lh = d.size * 1.25;
    var pad = d.bgOn ? d.size * 0.3 : 0;
    return { lines: lines, widths: widths, w: w, h: lh * lines.length, lh: lh, pad: pad, box: [d.x - pad, d.y - pad, w + pad * 2, lh * lines.length + pad * 2] };
  }

  // ---- reference images (kind "image", FORMAT.md) -------------------------------------------------
  // A reference image's picture is a shot (data.shot); each client says where its shots live:
  // Sight → /api/review/shots/<id>, the HTML page / phone app → the package's data URLs.
  var imgSrc = function(){ return ""; };
  function setImageSource(fn){ imgSrc = typeof fn === "function" ? fn : function(){ return ""; }; if (imgCache) imgCache.clear(); }
  function imageUrl(shot){ return shot ? String(imgSrc(shot) || "") : ""; }
  // Decoded pictures for canvas drawing (exports), one per URL. Not loaded yet → drawCanvas paints a
  // placeholder; await imagesReady(items) before drawing a picture that must be complete.
  var imgCache = typeof Map !== "undefined" ? new Map() : null;
  function imageEl(shot){
    var u = imageUrl(shot);
    if (!u || !imgCache || typeof Image === "undefined") return null;
    var im = imgCache.get(u);
    if (!im){ im = new Image(); im.decoding = "async"; im.src = u; imgCache.set(u, im); }
    return im;
  }
  function imagesReady(items){
    return Promise.all((items || []).filter(function(it){ return typeOf(it) === "image"; }).map(function(it){
      var im = imageEl(it.data.shot);
      if (!im || im.complete) return null;
      return new Promise(function(res){
        im.addEventListener("load", res, { once: true });
        im.addEventListener("error", res, { once: true });
        setTimeout(res, 15000);
      });
    }));
  }
  // The crop window of a reference image: [x, y, w, h] of the source picture, 0…1 (null = all of it).
  function imgCrop(d){
    var c = d.crop;
    if (!Array.isArray(c) || c.length !== 4 || !c.every(Number.isFinite) || c[2] <= 0 || c[3] <= 0) return [0, 0, 1, 1];
    return c;
  }

  // ---- closed strokes: pattern fill (brush data.close, FORMAT.md) ---------------------------------
  // Patterns are plain geometry clipped to the stroke's polygon (no SVG <pattern> / clip ids, which differ
  // between clients), so the SVG overlay and the canvas compositor draw the same thing.
  var PATTERNS = ["none", "solid", "diag", "diag2", "horiz", "vert", "grid", "cross", "dots", "dashes"];
  var PATTERN_ANGLES = { diag: [-45], diag2: [45], horiz: [0], vert: [90], grid: [0, 90], cross: [45, -45], dashes: [0] };
  function polyOf(pts){
    var out = [];
    for (var i = 0; i + 1 < pts.length; i += 3) out.push([pts[i], pts[i + 1]]);
    return out;
  }
  // Nonzero winding (as SVG / canvas fill a path by default): a lasso drawn round twice stays filled.
  function inPoly(poly, x, y){
    var wn = 0;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++){
      var a = poly[j], b = poly[i];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) wn += b[1] > a[1] ? 1 : -1;
    }
    return wn !== 0;
  }
  // Parallel lines at `deg`, `gap` apart, clipped to the polygon (nonzero): "M x y L x y" segments.
  function hatchPath(poly, deg, gap){
    var a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    // Rotate by -deg: the lines become horizontal (y' = const).
    var rp = poly.map(function(p){ return [p[0] * c + p[1] * s, -p[0] * s + p[1] * c]; });
    var y0 = Infinity, y1 = -Infinity, i;
    for (i = 0; i < rp.length; i++){ y0 = Math.min(y0, rp[i][1]); y1 = Math.max(y1, rp[i][1]); }
    if (!(y1 > y0)) return "";
    var g = Math.max(gap, (y1 - y0) / 300), d = "";
    var seg = function(xa, xb, y){ d += "M" + r2(xa * c - y * s) + " " + r2(xa * s + y * c) + "L" + r2(xb * c - y * s) + " " + r2(xb * s + y * c); };
    for (var y = y0 + g / 2; y < y1; y += g){
      var xs = [];
      for (i = 0; i < rp.length; i++){
        var p = rp[i], q = rp[(i + 1) % rp.length];
        if ((p[1] > y) !== (q[1] > y)) xs.push([p[0] + (y - p[1]) * (q[0] - p[0]) / (q[1] - p[1]), q[1] > p[1] ? 1 : -1]);
      }
      xs.sort(function(u, v){ return u[0] - v[0]; });
      var wn = 0, from = 0;
      for (i = 0; i < xs.length; i++){
        var was = wn;
        wn += xs[i][1];
        if (!was && wn) from = xs[i][0];
        else if (was && !wn && xs[i][0] - from > 1e-6) seg(from, xs[i][0], y);
      }
    }
    return d;
  }
  // Staggered dots inside the polygon, `gap` apart.
  function dotsPath(poly, gap, rad){
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, i;
    for (i = 0; i < poly.length; i++){ x0 = Math.min(x0, poly[i][0]); y0 = Math.min(y0, poly[i][1]); x1 = Math.max(x1, poly[i][0]); y1 = Math.max(y1, poly[i][1]); }
    var g = Math.max(gap, Math.sqrt((x1 - x0) * (y1 - y0) / 4000) || 0), d = "", row = 0;
    if (!(g > 0)) return "";
    for (var y = y0 + g / 2; y < y1; y += g * 0.866, row++){
      for (var x = x0 + (row % 2 ? g : g / 2); x < x1; x += g){
        if (inPoly(poly, x, y)) d += "M" + r2(x - rad) + " " + r2(y) + "a" + r2(rad) + " " + r2(rad) + " 0 1 0 " + r2(rad * 2) + " 0a" + r2(rad) + " " + r2(rad) + " 0 1 0 " + r2(-rad * 2) + " 0Z";
      }
    }
    return d;
  }
  // The fill of a closed stroke: solid (the smoothed centre line) or a pattern; [] when there is none.
  function fillPrims(d){
    var pat = d.pattern || "none";
    if (!d.close || pat === "none" || !Array.isArray(d.pts) || d.pts.length < 9) return [];
    var poly = polyOf(d.pts), color = d.fill || d.color;
    var op = (d.opacity != null ? d.opacity : 1) * (d.fillOpacity != null ? d.fillOpacity : 0.5);
    if (pat === "solid") return [{ d: smoothPath(poly, true), fill: color, op: op }];
    // The spacing actually used (capped for huge areas, as hatchPath / dotsPath do), so widths / dots follow it.
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    poly.forEach(function(p){ x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
    var gap = Math.max(0.5, Number(d.gap) || d.size || 8);
    if (pat === "dots"){
      gap = Math.max(gap, Math.sqrt((x1 - x0) * (y1 - y0) / 4000) || 0);
      var dp = dotsPath(poly, gap, gap * 0.2);
      return dp ? [{ d: dp, fill: color, op: op }] : [];
    }
    var angles = PATTERN_ANGLES[pat];
    if (!angles) return [];
    gap = Math.max(gap, hyp(x1 - x0, y1 - y0) / 300);  // (the diagonal ≥ the extent across any line direction)
    var lw = Math.max(0.3, gap * 0.18);
    var path = angles.map(function(a){ return hatchPath(poly, a, gap); }).join("");
    return path ? [{ d: path, stroke: color, sw: lw, op: op, cap: "butt", dash: pat === "dashes" ? [gap * 0.9, gap * 0.6] : null }] : [];
  }

  // ---- arrows along a stroke (kind stroke, shape_kind "arrows", FORMAT.md) ------------------------
  // Arrows spread evenly along the stroke (about data.step apart), each data.len long along the stroke's
  // normal, pointing away from it (dir "out") or at it ("in"), on one side ("left" / "right" of the
  // direction it was drawn in) or both.
  function arrowsGeom(d){
    var poly = polyOf(d.pts), n = poly.length, cum = [0], i;
    for (i = 1; i < n; i++) cum.push(cum[i - 1] + hyp(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]));
    var total = cum[n - 1] || 0, out = [];
    if (total < 1e-6) return out;
    var step = Math.max(Number(d.step) || 0, total / 400, 1e-3), cnt = Math.max(1, Math.round(total / step));
    var w = d.width || 2, len = Math.max(Number(d.len) || w * 6, w), gap0 = w * 1.2 + (d.guide !== false ? w / 2 : 0);
    var at = function(s){
      // Point at arc length s; the tangent from a window around it (steadier than one segment of a shaky stroke).
      var j = 1;
      while (j < n - 1 && cum[j] < s) j++;
      var t = (s - cum[j - 1]) / ((cum[j] - cum[j - 1]) || 1);
      var p = [poly[j - 1][0] + (poly[j][0] - poly[j - 1][0]) * t, poly[j - 1][1] + (poly[j][1] - poly[j - 1][1]) * t];
      var win = Math.min(step / 2, total / 2, len), a = ptAt(Math.max(0, s - win)), b = ptAt(Math.min(total, s + win));
      var tx = b[0] - a[0], ty = b[1] - a[1], l = hyp(tx, ty);
      if (l < 1e-9){ tx = poly[j][0] - poly[j - 1][0]; ty = poly[j][1] - poly[j - 1][1]; l = hyp(tx, ty) || 1; }
      return { p: p, t: [tx / l, ty / l] };
    };
    var ptAt = function(s){
      var j = 1;
      while (j < n - 1 && cum[j] < s) j++;
      var t = (s - cum[j - 1]) / ((cum[j] - cum[j - 1]) || 1);
      return [poly[j - 1][0] + (poly[j][0] - poly[j - 1][0]) * t, poly[j - 1][1] + (poly[j][1] - poly[j - 1][1]) * t];
    };
    var sides = d.side === "right" ? [-1] : d.side === "both" ? [1, -1] : [1];
    for (i = 0; i < cnt; i++){
      var g = at((i + 0.5) * total / cnt);
      // "left" of the drawing direction on screen (y down): the tangent turned a quarter anticlockwise.
      var nx = g.t[1], ny = -g.t[0];
      sides.forEach(function(sg){
        var near = [g.p[0] + nx * sg * gap0, g.p[1] + ny * sg * gap0], far = [g.p[0] + nx * sg * (gap0 + len), g.p[1] + ny * sg * (gap0 + len)];
        out.push(d.dir === "in" ? { tail: far, tip: near } : { tail: near, tip: far });
      });
    }
    return out;
  }
  function arrowsPrims(d){
    var w = d.width || 2, op = d.opacity != null ? d.opacity : 1, out = [], body = "", heads = {};
    if (d.guide !== false){
      var gp = polyOf(d.pts);
      if (gp.length === 1) gp.push([gp[0][0] + 0.01, gp[0][1]]);
      out.push({ d: smoothPath(gp, false), stroke: d.color, sw: w, op: op, dash: dashArray(d.dash, w), cap: "round", join: "round" });
    }
    arrowsGeom(d).forEach(function(a){
      var h = headPrims(d.head1 || "triangle", a.tip, a.tail, w, d.headSize, d.color, op);
      var b = trimPolyline([a.tail, a.tip], false, h.trim);
      body += "M" + r2(b[0][0]) + " " + r2(b[0][1]) + "L" + r2(b[1][0]) + " " + r2(b[1][1]);
      // Heads of one kind share a path (one element per kind, not per arrow).
      h.prims.forEach(function(p, k){
        var key = k + "|" + (p.fill ? "f" : "") + (p.stroke ? "s" : "");
        if (heads[key]) heads[key].d += p.d; else heads[key] = Object.assign({}, p);
      });
    });
    if (body) out.push({ d: body, stroke: d.color, sw: w, op: op, cap: "round", join: "round" });
    return out.concat(Object.keys(heads).map(function(k){ return heads[k]; }));
  }
  // How far an arrows drawing reaches from its stroke (bounds, hit tests).
  function arrowsReach(d){
    var w = d.width || 2;
    return w * 1.7 + Math.max(Number(d.len) || w * 6, w) + Math.max(w * 4.5, w + 9) * (d.headSize || 1) * 0.6;
  }

  // A pin's leader line: present when its start (ax, ay) lies outside the circle.
  function pinLeader(d){ return Number.isFinite(d.ax) && Number.isFinite(d.ay) && hyp(d.x - d.ax, d.y - d.ay) > d.size / 2 + 0.5; }
  function pinLineW(d){ return Math.max(1.5, d.size * 0.07); }

  // Primitives of one drawing. `numOf(it)` gives a pin its number (the note's position), if known; a pin with
  // its own `label` shows that instead.
  function primsOf(it, numOf){
    var d = it.data, t = typeOf(it), op, rot, out, path;
    if (t === "brush" || t === "pencil") return fillPrims(d).concat([{ d: strokeOutline(it), fill: d.color, op: d.opacity != null ? d.opacity : 1 }]);
    if (t === "arrows") return arrowsPrims(d);
    if (t === "marker"){
      var mp = [];
      for (var i = 0; i < d.pts.length; i += 3) mp.push([d.pts[i], d.pts[i + 1]]);
      if (mp.length === 1) mp.push([mp[0][0] + 0.01, mp[0][1]]);
      return [{ d: smoothPath(mp, false), stroke: d.color, sw: d.size, op: d.opacity != null ? d.opacity : 0.4, cap: "round", join: "round" }];
    }
    if (t === "rect" || t === "ellipse"){
      out = []; rot = d.rot ? [d.rot, d.x + d.w / 2, d.y + d.h / 2] : null;
      path = t === "rect" ? rectPath(d.x, d.y, d.w, d.h, d.radius) : ellipsePath(d.x + d.w / 2, d.y + d.h / 2, d.w / 2, d.h / 2);
      op = d.opacity != null ? d.opacity : 1;
      if (d.fillOn) out.push({ d: path, fill: d.fill, op: op * (d.fillOpacity != null ? d.fillOpacity : 1), rot: rot });
      if (d.strokeOn !== false) out.push({ d: path, stroke: d.color, sw: d.width, op: op, dash: dashArray(d.dash, d.width), cap: d.dash === "dotted" ? "round" : "butt", join: "round", rot: rot });
      if (!out.length) out.push({ d: path, stroke: d.color, sw: d.width, op: 0.25, dash: [d.width * 2, d.width * 2], rot: rot });
      return out;
    }
    if (t === "line" || t === "arrow"){
      var pts = linePoints(d), w = d.width, n = pts.length;
      op = d.opacity != null ? d.opacity : 1;
      var h1 = headPrims(d.head1 || "none", pts[n - 1], pts[n - 2], w, d.headSize, d.color, op);
      var h0 = headPrims(d.head0 || "none", pts[0], pts[1], w, d.headSize, d.color, op);
      pts = trimPolyline(trimPolyline(pts, false, h1.trim), true, h0.trim);
      var body = { d: "M" + pts.map(function(p){ return r2(p[0]) + " " + r2(p[1]); }).join("L"), stroke: d.color, sw: w, op: op, dash: dashArray(d.dash, w), cap: "round", join: "round" };
      return [body].concat(h0.prims, h1.prims);
    }
    if (t === "text"){
      var L = textLayout(d);
      op = d.opacity != null ? d.opacity : 1;
      rot = d.rot ? [d.rot, L.box[0] + L.box[2] / 2, L.box[1] + L.box[3] / 2] : null;
      out = [];
      if (d.bgOn) out.push({ d: rectPath(L.box[0], L.box[1], L.box[2], L.box[3], d.size * 0.18), fill: d.bg, op: op * (d.bgOpacity != null ? d.bgOpacity : 0.6), rot: rot });
      out.push({ text: L.lines, widths: L.widths, x: d.x, y: d.y, w: L.w, lh: L.lh, font: textFont(d), family: fontStack(d.font), size: d.size, bold: d.bold, italic: d.italic, underline: d.underline, align: d.align || "left", fill: d.color, stroke: d.outline ? d.outlineColor : null, sw: d.outline ? d.outline * 2 : 0, op: op, rot: rot });
      return out;
    }
    if (t === "image"){
      op = d.opacity != null ? d.opacity : 1;
      var bw = Math.max(0, d.border || 0), ix = d.x, iy = d.y, iw = d.w, ih = d.h;
      rot = d.rot ? [d.rot, ix + iw / 2, iy + ih / 2] : null;
      out = [];
      // The shadow: stacked translucent rounded boxes (no blur filter — SVG ids and canvas filters differ
      // between clients; this looks the same everywhere), offset down-right in the picture's own axes.
      var sh = clamp(Number(d.shadow) || 0, 0, 1);
      if (sh > 0 && !(bw > 0)){
        // No border: the shadow follows the picture's alpha (PNG/WebP with transparency), not its box. A blurred
        // black silhouette of the picture itself (SVG filter / canvas shadowBlur), offset in the picture's own axes.
        var sp = Math.max(1, Math.min(Math.abs(iw), Math.abs(ih)) * 0.05);
        out.push({ img: d.shot, x: ix, y: iy, w: iw, h: ih, crop: imgCrop(d), op: op, rot: rot, shadow: { dx: sp * 0.45, dy: sp * 0.7, blur: sp * 0.45, a: Math.min(1, sh * 0.7) } });
      } else if (sh > 0){
        var spread = Math.max(1, Math.min(iw, ih) * 0.05 + bw), N = 6;
        var ux = rot ? Math.cos(d.rot * Math.PI / 180) : 1, uy = rot ? Math.sin(d.rot * Math.PI / 180) : 0;
        var offx = spread * 0.45, offy = spread * 0.7, dx = offx * ux - offy * uy, dy = offx * uy + offy * ux;
        for (var si = N; si >= 1; si--){
          var e = spread * si / N, sx0 = ix - bw - e + dx, sy0 = iy - bw - e + dy;
          var sr = rot ? [d.rot, ix + iw / 2 + dx, iy + ih / 2 + dy] : null;
          out.push({ d: rectPath(sx0, sy0, iw + 2 * bw + 2 * e, ih + 2 * bw + 2 * e, e), fill: "#000000", op: op * sh * 0.32, rot: sr });
        }
      }
      out.push({ img: d.shot, x: ix, y: iy, w: iw, h: ih, crop: imgCrop(d), op: op, rot: rot });
      if (bw > 0) out.push({ d: rectPath(ix - bw / 2, iy - bw / 2, iw + bw, ih + bw, 0), stroke: d.borderColor || "#ffffff", sw: bw, op: op, join: "miter", rot: rot });
      return out;
    }
    if (t === "pin"){
      // 0.84+: `label` = the number typed for it (else, older pins: the note's number); `ax, ay` = the leader
      // line's start (the point pinned), drawn from there to the circle's edge with a dot at the start.
      var r = d.size / 2, lab = d.label != null && d.label !== "" ? String(d.label) : String((numOf ? numOf(it) : "") || "\u2022");
      var fs = r * 1.05 * (lab.length >= 3 ? 0.62 : lab.length === 2 ? 0.82 : 1);
      out = [];
      if (pinLeader(d)){
        var lw = pinLineW(d), ll = hyp(d.x - d.ax, d.y - d.ay);
        var ex = d.x - (d.x - d.ax) / ll * r, ey = d.y - (d.y - d.ay) / ll * r;
        out.push({ d: "M" + r2(d.ax) + " " + r2(d.ay) + "L" + r2(ex) + " " + r2(ey), stroke: d.color, sw: lw, op: 1, cap: "round", join: "round" });
        out.push({ d: ellipsePath(d.ax, d.ay, lw * 1.3, lw * 1.3), fill: d.color, op: 1 });
      }
      out.push({ d: ellipsePath(d.x, d.y, r, r), fill: d.color, stroke: "#ffffff", sw: Math.max(1, r * 0.14), op: 1 });
      out.push({ text: [lab], widths: null, x: d.x, y: d.y - fs * 0.59, w: 0, lh: fs * 1.18, font: "700 " + fs + "px " + fontStack("sans"), family: fontStack("sans"), size: fs, bold: true, align: "center", fill: "#ffffff", op: 1, center: true });
      return out;
    }
    return [];
  }

  var shadowSeq = 0;
  function primSvg(p){
    var tf = p.rot ? ' transform="rotate(' + r2(p.rot[0]) + " " + r2(p.rot[1]) + " " + r2(p.rot[2]) + ')"' : "";
    var op = p.op != null && p.op < 1 ? ' opacity="' + r2(p.op) + '"' : "";
    var st;
    if (p.img !== undefined){
      var u = imageUrl(p.img), c = p.crop || [0, 0, 1, 1];
      if (p.shadow){
        // Shadow-only prim: the picture turned black, scaled to the shadow alpha, blurred, then moved. Ids are unique per page.
        if (!u) return "";
        var fid = "rcsh" + (++shadowSeq), s = p.shadow, k = r2(s.a);
        var sw2 = r2(Math.max(0, p.w)), sh2 = r2(Math.max(0, p.h)), fm = s.blur * 3 + 1;
        return "<g" + tf + op + '><g transform="translate(' + r2(s.dx) + " " + r2(s.dy) + ')"><defs><filter id="' + fid + '" filterUnits="userSpaceOnUse" x="' + r2(p.x - fm) + '" y="' + r2(p.y - fm) + '" width="' + r2(sw2 + 2 * fm) + '" height="' + r2(sh2 + 2 * fm) + '" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ' + k + ' 0"/><feGaussianBlur stdDeviation="' + r2(s.blur) + '"/></filter></defs><g filter="url(#' + fid + ')"><svg x="' + r2(p.x) + '" y="' + r2(p.y) + '" width="' + sw2 + '" height="' + sh2 + '" style="width:' + sw2 + 'px;height:' + sh2 + 'px;overflow:hidden" viewBox="' + c.map(function(v){ return Math.round(v * 1e5) / 1e5; }).join(" ") + '" preserveAspectRatio="none" overflow="hidden"><image href="' + esc(u) + '" x="0" y="0" width="1" height="1" preserveAspectRatio="none"/></svg></g></g></g>';
      }
      if (!u) return "<g" + tf + op + '><rect x="' + r2(p.x) + '" y="' + r2(p.y) + '" width="' + r2(p.w) + '" height="' + r2(p.h) + '" fill="#808080" fill-opacity="0.35"/></g>';
      // A nested viewport clips to the crop window; the picture is 1 × 1 units inside it, so the crop needs no pixel size.
      // The size is also an inline style: host pages size their own <svg>s by CSS (`.x svg { width: 100% }`),
      // which would hit this nested one too (CSS beats the attribute) and stretch the cropped picture.
      var iw = r2(Math.max(0, p.w)), ih = r2(Math.max(0, p.h));
      return "<g" + tf + op + '><svg x="' + r2(p.x) + '" y="' + r2(p.y) + '" width="' + iw + '" height="' + ih + '" style="width:' + iw + 'px;height:' + ih + 'px;overflow:hidden" viewBox="' + c.map(function(v){ return Math.round(v * 1e5) / 1e5; }).join(" ") + '" preserveAspectRatio="none" overflow="hidden"><image href="' + esc(u) + '" x="0" y="0" width="1" height="1" preserveAspectRatio="none"/></svg></g>';
    }
    if (p.text){
      var anchor = p.align === "center" ? "middle" : p.align === "right" ? "end" : "start";
      var x0 = p.center ? p.x : p.align === "center" ? p.x + p.w / 2 : p.align === "right" ? p.x + p.w : p.x;
      st = p.stroke ? ' stroke="' + esc(p.stroke) + '" stroke-width="' + r2(p.sw) + '" stroke-linejoin="round" paint-order="stroke"' : "";
      var lines = p.text.map(function(l, i){ return '<text x="' + r2(x0) + '" y="' + r2(p.y + i * p.lh + p.size * 0.92) + '"' + (l ? "" : ' opacity="0"') + ">" + esc(l || " ") + "</text>"; }).join("");
      return "<g" + tf + op + ' font-family="' + esc(p.family) + '" font-size="' + r2(p.size) + '" font-weight="' + (p.bold ? 700 : 400) + '" font-style="' + (p.italic ? "italic" : "normal") + '" text-anchor="' + anchor + '" fill="' + esc(p.fill) + '"' + (p.underline ? ' text-decoration="underline"' : "") + st + ' style="white-space:pre">' + lines + "</g>";
    }
    var fill = p.fill ? ' fill="' + esc(p.fill) + '"' : ' fill="none"';
    st = p.stroke ? ' stroke="' + esc(p.stroke) + '" stroke-width="' + r2(p.sw) + '" stroke-linecap="' + (p.cap || "butt") + '" stroke-linejoin="' + (p.join || "miter") + '"' + (p.dash ? ' stroke-dasharray="' + p.dash.map(r2).join(" ") + '"' : "") : "";
    return '<path d="' + p.d + '"' + fill + st + op + tf + "/>";
  }

  function primCanvas(cx, p){
    cx.save();
    if (p.rot){ cx.translate(p.rot[1], p.rot[2]); cx.rotate(p.rot[0] * Math.PI / 180); cx.translate(-p.rot[1], -p.rot[2]); }
    cx.globalAlpha = p.op != null ? p.op : 1;
    if (p.img !== undefined){
      var im = imageEl(p.img), c = p.crop || [0, 0, 1, 1];
      if (im && im.complete && im.naturalWidth){
        var nw = im.naturalWidth, nh = im.naturalHeight;
        if (p.shadow){
          // shadowOffset/shadowBlur ignore the transform, so they are converted from doc units. The picture itself is
          // drawn shifted left in device space until it is fully off-canvas; the offset compensates, so only the shadow lands.
          var s = p.shadow;
          if (!cx.getTransform){
            cx.fillStyle = "rgba(0,0,0," + s.a * 0.6 + ")"; cx.fillRect(Math.min(p.x, p.x + p.w) + s.dx, Math.min(p.y, p.y + p.h) + s.dy, Math.abs(p.w), Math.abs(p.h));
            cx.restore(); return;
          }
          var m = cx.getTransform(), sc = Math.hypot(m.a, m.b) || 1;
          var xs = [p.x, p.x + p.w], ys = [p.y, p.y + p.h], x0 = 1e30, x1 = -1e30, y0 = 1e30, y1 = -1e30;
          for (var ci = 0; ci < 4; ci++){
            var qx = xs[ci & 1], qy = ys[ci >> 1], dx = m.a * qx + m.c * qy + m.e, dy = m.b * qx + m.d * qy + m.f;
            x0 = Math.min(x0, dx); x1 = Math.max(x1, dx); y0 = Math.min(y0, dy); y1 = Math.max(y1, dy);
          }
          var ox = m.a * s.dx + m.c * s.dy, oy = m.b * s.dx + m.d * s.dy, mg = 3 * s.blur * sc + 2;
          var cw = cx.canvas.width, ch = cx.canvas.height;
          if (x1 + ox + mg < 0 || x0 + ox - mg > cw || y1 + oy + mg < 0 || y0 + oy - mg > ch){ cx.restore(); return; }
          var D = x1 + mg + 1;
          cx.setTransform(m.a, m.b, m.c, m.d, m.e - D, m.f);
          cx.shadowColor = "rgba(0,0,0," + s.a + ")";
          cx.shadowBlur = 2 * s.blur * sc;
          cx.shadowOffsetX = ox + D;
          cx.shadowOffsetY = oy;
          try { cx.drawImage(im, c[0] * nw, c[1] * nh, c[2] * nw, c[3] * nh, p.x, p.y, p.w, p.h); } catch (_){}
          cx.restore();
          return;
        }
        try { cx.drawImage(im, c[0] * nw, c[1] * nh, c[2] * nw, c[3] * nh, p.x, p.y, p.w, p.h); } catch (_){}
      } else if (!p.shadow){
        cx.globalAlpha *= 0.35; cx.fillStyle = "#808080"; cx.fillRect(p.x, p.y, p.w, p.h);
      }
      cx.restore();
      return;
    }
    if (p.text){
      cx.font = p.font;
      cx.textBaseline = "alphabetic";
      cx.textAlign = p.align === "center" ? "center" : p.align === "right" ? "right" : "left";
      var x0 = p.center ? p.x : p.align === "center" ? p.x + p.w / 2 : p.align === "right" ? p.x + p.w : p.x;
      p.text.forEach(function(l, i){
        var y = p.y + i * p.lh + p.size * 0.92;
        if (p.stroke && p.sw){ cx.lineJoin = "round"; cx.lineWidth = p.sw; cx.strokeStyle = p.stroke; cx.strokeText(l, x0, y); }
        cx.fillStyle = p.fill;
        cx.fillText(l, x0, y);
        if (p.underline && l){
          var lw = cx.measureText(l).width, ux = p.align === "center" ? x0 - lw / 2 : p.align === "right" ? x0 - lw : x0;
          cx.fillRect(ux, y + p.size * 0.1, lw, Math.max(1, p.size * 0.06));
        }
      });
      cx.restore();
      return;
    }
    var path = new Path2D(p.d);
    if (p.fill){ cx.fillStyle = p.fill; cx.fill(path); }
    if (p.stroke){
      cx.strokeStyle = p.stroke;
      cx.lineWidth = p.sw;
      cx.lineCap = p.cap || "butt";
      cx.lineJoin = p.join || "miter";
      if (p.dash) cx.setLineDash(p.dash);
      cx.stroke(path);
    }
    cx.restore();
  }

  var zOf = function(it){ return (it.z != null ? it.z : it.z_index) || 0; };
  // All drawings of a list onto a canvas whose transform maps doc units, lowest z first.
  function drawCanvas(cx, items, numOf){
    items.slice().sort(function(a, b){ return zOf(a) - zOf(b); }).forEach(function(it){
      primsOf(it, numOf).forEach(function(p){ primCanvas(cx, p); });
    });
  }
  // SVG markup (no <svg> wrapper) for a list of drawings, lowest z first.
  function svgMarkup(items, numOf){
    return items.slice().sort(function(a, b){ return zOf(a) - zOf(b); }).map(function(it){ return primsOf(it, numOf).map(primSvg).join(""); }).join("");
  }

  // ---- bounds / hit testing / transforms --------------------------------------------------------

  function boundsOf(it){
    var d = it.data, t = typeOf(it), i;
    if (STROKE_TOOLS.has(t)){
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (i = 0; i < d.pts.length; i += 3){ x0 = Math.min(x0, d.pts[i]); y0 = Math.min(y0, d.pts[i + 1]); x1 = Math.max(x1, d.pts[i]); y1 = Math.max(y1, d.pts[i + 1]); }
      var rr = t === "arrows" ? arrowsReach(d) : d.size / 2;
      return [x0 - rr, y0 - rr, x1 + rr, y1 + rr];
    }
    if (t === "line" || t === "arrow"){
      var pts = linePoints(d), r = d.width * 2.5 * (d.headSize || 1);
      var xs = pts.map(function(p){ return p[0]; }), ys = pts.map(function(p){ return p[1]; });
      return [Math.min.apply(null, xs) - r, Math.min.apply(null, ys) - r, Math.max.apply(null, xs) + r, Math.max.apply(null, ys) + r];
    }
    var box, rot = d.rot || 0;
    if (t === "rect" || t === "ellipse" || t === "image") box = [Math.min(d.x, d.x + d.w), Math.min(d.y, d.y + d.h), Math.abs(d.w), Math.abs(d.h)];
    else if (t === "text") box = textLayout(d).box;
    else if (t === "pin"){
      var pr = d.size / 2, pb = [d.x - pr, d.y - pr, d.x + pr, d.y + pr];
      if (pinLeader(d)){ var pl = pinLineW(d) * 1.3; pb = [Math.min(pb[0], d.ax - pl), Math.min(pb[1], d.ay - pl), Math.max(pb[2], d.ax + pl), Math.max(pb[3], d.ay + pl)]; }
      return pb;
    }
    else return [0, 0, 0, 0];
    var x = box[0], y = box[1], w = box[2], h = box[3], cx = x + w / 2, cy = y + h / 2;
    var pad = t === "text" ? 0 : t === "image" ? Math.max(0, d.border || 0) : (d.strokeOn !== false ? d.width / 2 : 0);
    var cs = [[x - pad, y - pad], [x + w + pad, y - pad], [x + w + pad, y + h + pad], [x - pad, y + h + pad]].map(function(p){ return rotPt(p[0], p[1], cx, cy, rot); });
    var cxs = cs.map(function(c){ return c[0]; }), cys = cs.map(function(c){ return c[1]; });
    return [Math.min.apply(null, cxs), Math.min.apply(null, cys), Math.max.apply(null, cxs), Math.max.apply(null, cys)];
  }

  function hitTest(it, x, y, tol){
    var d = it.data, t = typeOf(it), i;
    var b = boundsOf(it);
    if (x < b[0] - tol || y < b[1] - tol || x > b[2] + tol || y > b[3] + tol) return false;
    if (t === "arrows"){
      // The guide's width all along; the arrows' reach only on their side(s) of the stroke.
      var reach = arrowsReach(d), np = d.pts.length / 3, near = (d.width || 2) / 2 + tol;
      if (np === 1) return hyp(x - d.pts[0], y - d.pts[1]) <= near;
      for (i = 1; i < np; i++){
        var ax = d.pts[i * 3 - 3], ay = d.pts[i * 3 - 2], bx2 = d.pts[i * 3], by2 = d.pts[i * 3 + 1];
        var dd = segDist(x, y, ax, ay, bx2, by2);
        if (dd <= near) return true;
        if (dd > reach + tol) continue;
        // Left of the drawing direction (screen, y down): a negative cross product of the segment and the point.
        var left = (bx2 - ax) * (y - ay) - (by2 - ay) * (x - ax) < 0;
        if (d.side === "both" || (d.side === "right" ? !left : left)) return true;
      }
      return false;
    }
    if (STROKE_TOOLS.has(t)){
      if (d.close && d.pattern && d.pattern !== "none" && d.pts.length >= 9 && inPoly(polyOf(d.pts), x, y)) return true;
      var rs = t === "marker" ? null : strokeRadii(it);
      var n = d.pts.length / 3;
      if (n === 1) return hyp(x - d.pts[0], y - d.pts[1]) <= (rs ? rs[0] : d.size / 2) + tol;
      for (i = 1; i < n; i++){
        var r = rs ? Math.max(rs[i], rs[i - 1]) : d.size / 2;
        if (segDist(x, y, d.pts[i * 3 - 3], d.pts[i * 3 - 2], d.pts[i * 3], d.pts[i * 3 + 1]) <= r + tol) return true;
      }
      // A closed stroke's seam: from its last point back to the first.
      if (d.close && n >= 3 && segDist(x, y, d.pts[n * 3 - 3], d.pts[n * 3 - 2], d.pts[0], d.pts[1]) <= (rs ? Math.max(rs[n - 1], rs[0]) : d.size / 2) + tol) return true;
      return false;
    }
    if (t === "line" || t === "arrow"){
      var pts = linePoints(d);
      for (i = 1; i < pts.length; i++) if (segDist(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= d.width / 2 + tol) return true;
      return false;
    }
    if (t === "pin") return hyp(x - d.x, y - d.y) <= d.size / 2 + tol || (pinLeader(d) && segDist(x, y, d.ax, d.ay, d.x, d.y) <= pinLineW(d) * 1.3 + tol);
    var box;
    if (t === "text") box = textLayout(d).box;
    else box = [Math.min(d.x, d.x + d.w), Math.min(d.y, d.y + d.h), Math.abs(d.w), Math.abs(d.h)];
    var bx = box[0], by = box[1], bw = box[2], bh = box[3], cx = bx + bw / 2, cy = by + bh / 2;
    var lp = rotPt(x, y, cx, cy, -(d.rot || 0)), lx = lp[0], ly = lp[1];
    if (t === "image"){ var ib = Math.max(0, d.border || 0) + tol; return lx >= bx - ib && lx <= bx + bw + ib && ly >= by - ib && ly <= by + bh + ib; }
    if (t === "text" || d.fillOn) return lx >= bx - tol && lx <= bx + bw + tol && ly >= by - tol && ly <= by + bh + tol;
    var sw = d.width / 2 + tol;
    if (t === "rect"){
      var inOuter = lx >= bx - sw && lx <= bx + bw + sw && ly >= by - sw && ly <= by + bh + sw;
      var inInner = lx > bx + sw && lx < bx + bw - sw && ly > by + sw && ly < by + bh - sw;
      return inOuter && !inInner;
    }
    var rx = bw / 2, ry = bh / 2;
    if (rx < 1e-6 || ry < 1e-6) return false;
    var k = hyp((lx - cx) / rx, (ly - cy) / ry);
    return Math.abs(k - 1) * Math.min(rx, ry) <= sw;
  }

  // Applies an affine map to an object, using `src` (a snapshot) as the starting point.
  //   map(x, y) → [x, y]   k: uniform scale (for widths/sizes)   da: rotation added (degrees)
  //   sx, sy: axis scales (rect/ellipse boxes when unrotated)
  function transformItem(it, src, map, opts){
    var o = opts || {}, k = o.k != null ? o.k : 1, da = o.da || 0, sx = o.sx != null ? o.sx : 1, sy = o.sy != null ? o.sy : 1;
    var d = it.data, s = src.data, t = typeOf(it), c;
    if (STROKE_TOOLS.has(t)){
      for (var i = 0; i < s.pts.length; i += 3){ c = map(s.pts[i], s.pts[i + 1]); d.pts[i] = c[0]; d.pts[i + 1] = c[1]; }
      if (s.size != null) d.size = s.size * k;
      if (s.width != null) d.width = s.width * k;
      if (s.gap != null) d.gap = s.gap * k;
      if (s.step != null) d.step = s.step * k;
      if (s.len != null) d.len = s.len * k;
      // A mirror (one negative axis) swaps an arrows drawing's left and right.
      if (t === "arrows" && sx * sy < 0 && (s.side === "left" || s.side === "right")) d.side = s.side === "left" ? "right" : "left";
    } else if (t === "line" || t === "arrow"){
      var a = map(s.pts[0], s.pts[1]), b = map(s.pts[2], s.pts[3]);
      d.pts = [a[0], a[1], b[0], b[1]];
      d.width = s.width * k;
      if (s.bend != null) d.bend = s.bend * k * (sx * sy < 0 ? -1 : 1);
    } else if (t === "rect" || t === "ellipse"){
      c = map(s.x + s.w / 2, s.y + s.h / 2);
      var rotd = !!s.rot || !!da;
      var w = Math.abs(s.w) * (rotd ? k : Math.abs(sx)), h = Math.abs(s.h) * (rotd ? k : Math.abs(sy));
      d.x = c[0] - w / 2; d.y = c[1] - h / 2; d.w = w; d.h = h;
      d.rot = ((s.rot || 0) + da) % 360;
      d.width = s.width * k;
      if (s.radius) d.radius = s.radius * k;
    } else if (t === "text"){
      var Lb = textLayout(s).box;
      c = map(Lb[0] + Lb[2] / 2, Lb[1] + Lb[3] / 2);
      d.size = s.size * k;
      if (s.outline) d.outline = s.outline * k;
      var N = textLayout(d);
      d.x = c[0] - N.box[2] / 2 + N.pad; d.y = c[1] - N.box[3] / 2 + N.pad;
      d.rot = ((s.rot || 0) + da) % 360;
    } else if (t === "image"){
      // Always uniform (a picture never stretches): a corner / rotation passes k; an edge of a mixed selection
      // passes axis scales, whose mean scale is used.
      var q = k !== 1 ? k : Math.sqrt(Math.abs(sx * sy));
      c = map(s.x + s.w / 2, s.y + s.h / 2);
      d.w = Math.abs(s.w) * q; d.h = Math.abs(s.h) * q;
      d.x = c[0] - d.w / 2; d.y = c[1] - d.h / 2;
      d.rot = ((s.rot || 0) + da) % 360;
      if (s.border) d.border = s.border * q;
    } else if (t === "pin"){
      c = map(s.x, s.y); d.x = c[0]; d.y = c[1];
      if (Number.isFinite(s.ax) && Number.isFinite(s.ay)){ c = map(s.ax, s.ay); d.ax = c[0]; d.ay = c[1]; }
    }
  }

  // ---- transform: the select tool's box and handles ----------------------------------------------
  // Shared by Sight's editor (annotate.js) and the drawing canvas (review-draw.js), so both move,
  // scale and rotate alike. Positions are doc units; `px` = doc units per screen pixel (handles keep
  // their screen size). The rotate handle sits above the box; while it is dragged it follows the
  // pointer out from the box's centre (the pivot), so a longer arm turns more finely.
  function cloneItem(v){ return JSON.parse(JSON.stringify(v)); }
  function xfBox(list){
    var b = null;
    list.forEach(function(it){
      var q = boundsOf(it);
      b = b ? [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])] : q.slice();
    });
    return b;
  }
  function xfLine(list){
    if (list.length !== 1) return null;
    var t = typeOf(list[0]);
    return t === "line" || t === "arrow" ? list[0] : null;
  }
  // [[id, x, y]]: p0 / p1 / bend | mid for one line or arrow, else the eight scale handles + rot.
  // D: the drag in progress (a rotation shows only its own handle, at the pointer).
  function xfHandles(list, px, D){
    var ln = xfLine(list);
    if (ln){
      var d = ln.data, out = [["p0", d.pts[0], d.pts[1]], ["p1", d.pts[2], d.pts[3]]];
      if (d.body === "curve"){ var bh = bendHandle(d); out.push(["bend", bh[0], bh[1]]); }
      else out.push(["mid", (d.pts[0] + d.pts[2]) / 2, (d.pts[1] + d.pts[3]) / 2]);
      return out;
    }
    if (!list.length || list.every(function(it){ return typeOf(it) === "pin"; })) return [];
    if (D && D.handle === "rot" && D.at) return [["rot", D.at[0], D.at[1]]];
    var b = xfBox(list), mx = (b[0] + b[2]) / 2, my = (b[1] + b[3]) / 2;
    return [["nw", b[0], b[1]], ["n", mx, b[1]], ["ne", b[2], b[1]], ["e", b[2], my], ["se", b[2], b[3]], ["s", mx, b[3]], ["sw", b[0], b[3]], ["w", b[0], my], ["rot", mx, b[1] - 22 * px]];
  }
  // The handle nearest to (x, y) within tol, or null.
  function xfAt(hs, x, y, tol){
    var best = null, bd = tol;
    hs.forEach(function(h){ var dd = hyp(x - h[1], y - h[2]); if (dd <= bd){ bd = dd; best = h[0]; } });
    return best;
  }
  // Starts a drag of handle h ("move" = the objects themselves) at (x, y) on the live items.
  function xfStart(h, items, x, y){
    return { handle: h, x: x, y: y, items: items, src: items.map(cloneItem), box: xfBox(items), moved: false, at: null };
  }
  // Shift while drawing: keeps the end on the horizontal or the vertical through (x0, y0), whichever is nearer.
  function snapHV(x0, y0, x, y){ return Math.abs(x - x0) >= Math.abs(y - y0) ? [x, y0] : [x0, y]; }
  function snap15(x0, y0, x, y){
    var a = Math.atan2(y - y0, x - x0), l = hyp(x - x0, y - y0), s = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
    return [x0 + Math.cos(s) * l, y0 + Math.sin(s) * l];
  }
  // Moves the drag to (x, y). m: {shift, alt} — move: Shift keeps one axis; line ends: Shift keeps the line
  // horizontal / vertical; rotate: Shift snaps to 15°; corners: Shift keeps the ratio; Alt scales about the centre.
  function xfDrag(D, x, y, m){
    m = m || {};
    D.moved = true;
    var h = D.handle, its = D.items, src = D.src, i;
    if (h === "move"){
      var dx = x - D.x, dy = y - D.y;
      if (m.shift){ if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      for (i = 0; i < its.length; i++) transformItem(its[i], src[i], function(px, py){ return [px + dx, py + dy]; });
      return;
    }
    if (h === "p0" || h === "p1" || h === "bend" || h === "mid"){
      var d = its[0].data, s = src[0].data;
      if (h === "p0" || h === "p1"){
        var fx = h === "p0" ? s.pts[2] : s.pts[0], fy = h === "p0" ? s.pts[3] : s.pts[1];
        var p = m.shift ? snapHV(fx, fy, x, y) : [x, y];
        d.pts = h === "p0" ? [p[0], p[1], s.pts[2], s.pts[3]] : [s.pts[0], s.pts[1], p[0], p[1]];
      } else {
        // Dragging the middle bends the line (a straight one turns into a curve).
        var x1 = s.pts[0], y1 = s.pts[1], x2 = s.pts[2], y2 = s.pts[3], l = hyp(x2 - x1, y2 - y1) || 1;
        d.body = "curve";
        d.bend = ((x - (x1 + x2) / 2) * -(y2 - y1) + (y - (y1 + y2) / 2) * (x2 - x1)) / l;
      }
      return;
    }
    var bx0 = D.box[0], by0 = D.box[1], bx1 = D.box[2], by1 = D.box[3], cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
    if (h === "rot"){
      D.at = [x, y];
      var deg = (Math.atan2(y - cy, x - cx) - Math.atan2(D.y - cy, D.x - cx)) * 180 / Math.PI;
      if (m.shift) deg = Math.round(deg / 15) * 15;
      D.deg = deg;
      for (i = 0; i < its.length; i++) transformItem(its[i], src[i], function(px, py){ return rotPt(px, py, cx, cy, deg); }, { da: deg });
      return;
    }
    // Scale about the opposite edge / corner (Alt: the centre). Edges scale one axis.
    var ax = h.indexOf("w") >= 0 ? bx1 : h.indexOf("e") >= 0 ? bx0 : cx;
    var ay = h.indexOf("n") >= 0 ? by1 : h.indexOf("s") >= 0 ? by0 : cy;
    var ox = m.alt ? cx : ax, oy = m.alt ? cy : ay;
    var horiz = h.indexOf("w") >= 0 || h.indexOf("e") >= 0, vert = h.indexOf("n") >= 0 || h.indexOf("s") >= 0;
    var w0 = horiz ? D.x - ox : 1, h0 = vert ? D.y - oy : 1;
    var sx = horiz ? (x - ox) / (Math.abs(w0) < 1e-6 ? 1e-6 : w0) : 1;
    var sy = vert ? (y - oy) / (Math.abs(h0) < 1e-6 ? 1e-6 : h0) : 1;
    var corner = h.length === 2;
    var onlyText = its.every(function(it){ var t = typeOf(it); return t === "text" || t === "pin" || t === "image"; });
    if ((corner && m.shift) || onlyText){
      var mm = corner ? Math.max(Math.abs(sx), Math.abs(sy)) : Math.abs(h === "n" || h === "s" ? sy : sx);
      sx = Math.sign(sx || 1) * mm; sy = Math.sign(sy || 1) * mm;
    }
    sx = Math.abs(sx) < 0.01 ? 0.01 * Math.sign(sx || 1) : sx;
    sy = Math.abs(sy) < 0.01 ? 0.01 * Math.sign(sy || 1) : sy;
    var kk = Math.sqrt(Math.abs(sx * sy));
    // Corners scale widths with the object; edges stretch the geometry and keep line widths.
    for (i = 0; i < its.length; i++) transformItem(its[i], src[i], function(px, py){ return [ox + (px - ox) * sx, oy + (py - oy) * sy]; }, { k: corner || onlyText ? kk : 1, sx: sx, sy: sy });
  }
  // SVG markup of the selection: a dashed box per object, the group's box, the handles and, while
  // rotating, the arm from the pivot to the pointer. o: {px (doc units per screen px), D (drag),
  // map(x, y) → output space (default: doc units), u (output units per screen px, default px),
  // hs (handle size factor, e.g. bigger for fingers)}.
  function xfSvg(list, o){
    if (!list.length) return "";
    var px = o.px, u = o.u != null ? o.u : px, z = (o.hs || 1) * u, D = o.D;
    var mp = o.map || function(x, y){ return [x, y]; }, C = "#4c9aff", out = "";
    var rect = function(b, extra){
      var a = mp(b[0], b[1]), c = mp(b[2], b[3]);
      return '<rect x="' + r2(Math.min(a[0], c[0])) + '" y="' + r2(Math.min(a[1], c[1])) + '" width="' + r2(Math.abs(c[0] - a[0])) + '" height="' + r2(Math.abs(c[1] - a[1])) + '" fill="none" stroke="' + C + '" stroke-width="' + r2(u) + '"' + (extra || "") + "/>";
    };
    var rotating = D && D.handle === "rot" && D.at;
    if (!rotating) list.forEach(function(it){ out += rect(boundsOf(it), ' stroke-dasharray="' + r2(3 * u) + " " + r2(3 * u) + '"'); });
    var ln = xfLine(list);
    if (!ln && list.length > 1 && !rotating) out += rect(xfBox(list));
    var hs = xfHandles(list, px, D), b = rotating ? D.box : xfBox(list);
    hs.forEach(function(hh){
      var p = mp(hh[1], hh[2]), id = hh[0];
      if (id === "rot"){
        // The arm: from the top of the box, or from the pivot (centre) while rotating.
        var from = rotating ? mp((b[0] + b[2]) / 2, (b[1] + b[3]) / 2) : mp((b[0] + b[2]) / 2, b[1]);
        out += '<line x1="' + r2(from[0]) + '" y1="' + r2(from[1]) + '" x2="' + r2(p[0]) + '" y2="' + r2(p[1]) + '" stroke="' + C + '" stroke-width="' + r2(u) + '"/>';
        if (rotating) out += '<circle cx="' + r2(from[0]) + '" cy="' + r2(from[1]) + '" r="' + r2(3 * z) + '" fill="#fff" stroke="' + C + '" stroke-width="' + r2(1.5 * u) + '"/>';
      }
      if (id === "rot" || id === "bend" || id === "mid") out += '<circle cx="' + r2(p[0]) + '" cy="' + r2(p[1]) + '" r="' + r2(5 * z) + '" fill="' + C + '" stroke="#fff" stroke-width="' + r2(1.5 * u) + '"/>';
      else out += '<rect x="' + r2(p[0] - 4.5 * z) + '" y="' + r2(p[1] - 4.5 * z) + '" width="' + r2(9 * z) + '" height="' + r2(9 * z) + '" fill="#fff" stroke="' + C + '" stroke-width="' + r2(1.5 * u) + '"/>';
    });
    return out;
  }
  // The cursor for a handle (desktop).
  var XF_CURSOR = { rot: "grab", p0: "move", p1: "move", bend: "move", mid: "move", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize" };

  // Whether a row / item carries geometry a client can draw (notes always pass; status rows and
  // unknown kinds do not).
  function validItem(it){
    var d = it.data || {}, t = typeOf(it);
    if (it.kind === "note") return true;
    if (STROKE_TOOLS.has(t)) return Array.isArray(d.pts) && d.pts.length >= 3;
    if (t === "line" || t === "arrow") return Array.isArray(d.pts) && d.pts.length === 4;
    if (t === "rect" || t === "ellipse") return [d.x, d.y, d.w, d.h].every(Number.isFinite);
    if (t === "text" || t === "pin") return Number.isFinite(d.x) && Number.isFinite(d.y);
    if (t === "image") return typeof d.shot === "string" && !!d.shot && [d.x, d.y, d.w, d.h].every(Number.isFinite);
    return false;
  }

  // Whether a drawing with context `c` (data.ctx) shows on a frame `at`: {t, fps} = the video frame
  // at t seconds, {vk} = the 3D view vk (null vk: no saved view), null = a picture / no frame
  // context (always shown). Video: from t for max(hold, one frame), hold -1 = the whole clip.
  function ctxVisible(c, at){
    if (!c || !at) return true;
    if (at.t != null){
      if (c.t == null || c.hold === -1) return true;
      var fd = 1 / (at.fps || 25);
      return at.t >= c.t - fd * 0.5 - 1e-3 && at.t < c.t + Math.max(c.hold || 0, fd) - fd * 0.5 + 1e-3;
    }
    if (Object.prototype.hasOwnProperty.call(at, "vk")) return !!c.vk && c.vk === at.vk;  // {vk: undefined} = no view
    return true;
  }

  // A view's animation pose ({clip, t}, FORMAT.md 3D ctx `anim`) and the live one are the same: the same
  // clip and times within 1.5 ms (stored to 3 dp). A view with none (a static model, an older file) matches
  // any pose; so does a model shown without animation (live null: a viewer that found no clips — Sight's
  // server conversion and the phone's loader may differ — still shows the view's drawings).
  function animMatch(view, live){
    if (!view || !live) return true;
    return (view.clip | 0) === (live.clip | 0) && Math.abs((Number(view.t) || 0) - (Number(live.t) || 0)) < 0.0015;
  }

  // Two 3D cameras ({p, t, fov, turns}, FORMAT.md 3D ctx) are one view: position and target within
  // 0.4 % of a's camera distance, the same fov (0.5°) and quarter-turn count.
  function camMatch(a, b){
    if (!a || !b || !a.p || !b.p || !a.t || !b.t) return false;
    var d = hyp(hyp(a.p[0] - a.t[0], a.p[1] - a.t[1]), a.p[2] - a.t[2]) || 1, tol = d * 0.004;
    var dp = hyp(hyp(a.p[0] - b.p[0], a.p[1] - b.p[1]), a.p[2] - b.p[2]);
    var dt = hyp(hyp(a.t[0] - b.t[0], a.t[1] - b.t[1]), a.t[2] - b.t[2]);
    return dp < tol && dt < tol && Math.abs((a.fov || 50) - (b.fov || 50)) < 0.5 && (a.turns || 0) === (b.turns || 0);
  }

  // ---- picture texts (FORMAT.md "note", `captions`) -------------------------------------------
  // A note's text is the topic; each of its pictures may carry a text of its own, kept in the note's
  // data.captions = {key: text}. A picture is {} (the image / PSD itself), {t} (a video frame),
  // {vk} (a 3D view) or {shot: id} (an attached picture). Keys: "pic", "t:<seconds, 3 dp>",
  // "vk:<view key>", "shot:<id>". A frame matches by `same(a, b)` (the client's own frame rule;
  // default: within half a millisecond), so a frame time written by another client still finds it.
  function picKey(p){
    if (!p) return "pic";
    if (p.shot != null) return "shot:" + String(p.shot);
    if (p.vk) return "vk:" + p.vk;
    if (p.t != null && Number.isFinite(Number(p.t))) return "t:" + Number(p.t).toFixed(3);
    return "pic";
  }
  var sameT = function(a, b){ return Math.abs(a - b) < 5e-4; };
  // The keys of `caps` that stand for picture p (an exact key, or a frame key on the same frame).
  function capKeys(caps, p, same){
    var k = picKey(p), out = [];
    if (!isObj(caps)) return out;
    var isT = p && p.shot == null && !p.vk && p.t != null && Number.isFinite(Number(p.t));
    Object.keys(caps).forEach(function(x){
      if (x === k) out.push(x);
      else if (isT && x.indexOf("t:") === 0 && Number.isFinite(Number(x.slice(2))) && (same || sameT)(Number(x.slice(2)), Number(p.t))) out.push(x);
    });
    return out;
  }
  function captionOf(data, p, same){
    var caps = data && data.captions, ks = capKeys(caps, p, same);
    for (var i = 0; i < ks.length; i++){ var v = caps[ks[i]]; if (typeof v === "string" && v.trim()) return v; }
    return "";
  }
  // The note's captions with picture p's text set to `text` (empty: removed). Returns a new object,
  // or null when nothing is left (the caller then drops data.captions).
  function withCaption(data, p, text, same){
    var caps = isObj(data && data.captions) ? Object.assign({}, data.captions) : {};
    capKeys(caps, p, same).forEach(function(k){ delete caps[k]; });
    var v = String(text == null ? "" : text).trim();
    if (v) caps[picKey(p)] = v;
    return Object.keys(caps).length ? caps : null;
  }

  // A video frame's short label: "f<frame> / <m:ss>" and "+<frames>" when it is not on a full second
  // ("f128 / 0:05+3" at 25 fps; "f125 / 0:05"; an hour on: "h:mm:ss").
  function frameLabel(t, fps){
    var r = Math.max(1, Math.round(fps || 25)), F = Math.max(0, Math.round(Number(t) * (fps || 25)));
    if (!Number.isFinite(F)) return "";
    var sec = Math.floor(F / r), fr = F % r, s = sec % 60, m = Math.floor(sec / 60) % 60, h = Math.floor(sec / 3600);
    var p = function(n){ return (n < 10 ? "0" : "") + n; };
    return "f" + F + " / " + (h ? h + ":" + p(m) : m) + ":" + p(s) + (fr ? "+" + fr : "");
  }
  // A picture's caption title ("clip.mp4 · f128 / 0:05+3") as a file name that every system takes
  // ("clip.mp4 · f128 · 0.05+3.jpg"): what the reviewer page's downloads and the desktop's notes ZIP
  // call a picture. ext: ".jpg" by default.
  function picFileName(title, ext){
    var s = String(title == null ? "" : title).replace(/ \/ /g, " · ").replace(/:/g, ".").replace(/[\\/*?"<>|\u0000-\u001f]+/g, "_");
    s = s.replace(/\s+/g, " ").trim();
    // Too long: the file's name gives way, not the frame after it (pictures of one note must differ).
    var cut = s.indexOf(" · ");
    if (s.length > 150 && cut > 0 && s.length - cut < 120) s = s.slice(0, cut - (s.length - 150)).trim() + s.slice(cut);
    s = s.slice(0, 150).trim().replace(/^[. ]+|[. ]+$/g, "") || "picture";
    return s + (ext == null ? ".jpg" : ext);
  }
  // The frames a video note stands on (0.47+: there is no "note's own frame" any more): the frames its
  // drawings are on (`times`: the caller's pick of drawing times — e.g. without replies') and the
  // frames that carry a picture text of it (captions "t:" keys), one per frame (`same`), in time
  // order. `fallback`: a note with none of those (text only) gets the frame it was written on, so it
  // still has a place on the timeline.
  function noteTimes(data, times, same, fallback){
    var eq = same || sameT, out = [];
    function add(t){ t = Number(t); if (Number.isFinite(t) && !out.some(function(x){ return eq(x, t); })) out.push(t); }
    (times || []).forEach(function(t){ if (t != null) add(t); });
    var caps = data && data.captions;
    if (isObj(caps)) Object.keys(caps).forEach(function(k){ if (k.slice(0, 2) === "t:" && typeof caps[k] === "string" && caps[k].trim()) add(k.slice(2)); });
    out.sort(function(a, b){ return a - b; });
    var c = data && data.ctx;
    if (!out.length && fallback && c && c.t != null && Number.isFinite(Number(c.t))) out.push(Number(c.t));
    return out;
  }

  // A drawing as a review row (FORMAT.md "Rows"): `it` = {id, kind, sub | shape_kind, z | z_index,
  // data}; the bounding box columns come from its geometry. `at` = created / updated stamp.
  function drawingRow(it, at){
    var b = boundsOf(it), t = at != null ? at : Date.now();
    return {
      id: it.id, kind: it.kind, shape_kind: it.sub || it.shape_kind || null,
      x: r2(b[0]), y: r2(b[1]), w: r2(b[2] - b[0]), h: r2(b[3] - b[1]),
      rotation: 0, z_index: zOf(it) | 0, color: it.data.color || null, locked: 0,
      data: it.data, created_at: t, updated_at: t,
    };
  }

  // ---- merge ---------------------------------------------------------------------------------
  // Port of Library.import_annotations and friends (app/library.py). The Python side is the
  // reference; every rule here mirrors a line there. Values are coerced the way Python does
  // (int() / float() / str()) for the shapes the clients write; exotic values (non-hex ids, NaN,
  // "1_000"-style strings) are not guaranteed to match.

  var isObj = function(v){ return v !== null && typeof v === "object" && !Array.isArray(v); };
  // Python truthiness and `a or b` (empty lists / objects are false there).
  function pyTrue(v){
    if (Array.isArray(v)) return v.length > 0;
    if (isObj(v)) return Object.keys(v).length > 0;
    return !!v;
  }
  var pyOr = function(a, b){ return pyTrue(a) ? a : b; };
  var pyStr = function(v){ return v === null || v === undefined ? "None" : v === true ? "True" : v === false ? "False" : String(v); };
  // Library._stamp: int(v or 0), 0 when it is not a number.
  function stamp(v){
    if (!v) return 0;
    if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : 0;
    if (v === true) return 1;
    if (typeof v === "string" && /^\s*[+-]?\d+\s*$/.test(v)) return parseInt(v, 10);
    return 0;
  }
  // float(v) or None.
  function num(v){
    if (v === null || v === undefined) return null;
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "string" && /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/.test(v)) return Number(v);
    return null;
  }
  // When a row's own content last changed (Library._content_at). Notes: data.edited_at, else
  // data.created — replies and the open / done state carry their own stamps. Drawings: updated_at.
  function contentAt(kind, data, created, updated){
    if (kind === "note") return stamp(pyOr(pyOr(data.edited_at, data.created), created));
    return stamp(pyOr(updated, created));
  }
  // Union of two reply lists by id; for the same id the later edit (or delete) wins. Oldest first.
  function mergeReplies(a, b){
    var st = function(x){ return Math.max(stamp(pyOr(x.edited, x.created)), stamp(x.deleted)); };
    var out = new Map();
    [].concat(Array.isArray(a) ? a : [], Array.isArray(b) ? b : []).forEach(function(x){
      if (!isObj(x) || !pyTrue(x.id)) return;
      var k = pyStr(x.id);
      if (!out.has(k) || st(x) > st(out.get(k))) out.set(k, x);
    });
    return Array.from(out.values()).sort(function(x, y){ return stamp(x.created) - stamp(y.created); });
  }
  // Union of two review-state histories ([{state, author, at}]), oldest first; ties keep order.
  function mergeHistory(a, b){
    var out = new Map();
    [].concat(Array.isArray(a) ? a : [], Array.isArray(b) ? b : []).forEach(function(x){
      if (!isObj(x)) return;
      var k = stamp(x.at) + "\u0000" + pyStr(pyOr(x.state, "")) + "\u0000" + pyStr(pyOr(x.author, ""));
      if (!out.has(k)) out.set(k, x);
    });
    return Array.from(out.values()).sort(function(x, y){ return stamp(x.at) - stamp(y.at); });
  }
  // Deep equality of JSON values (Python's == on parsed JSON).
  function same(a, b){
    if (a === b) return true;
    if (Array.isArray(a)){
      if (!Array.isArray(b) || a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
      return true;
    }
    if (isObj(a) && isObj(b)){
      var ka = Object.keys(a).filter(function(k){ return a[k] !== undefined; });
      var kb = Object.keys(b).filter(function(k){ return b[k] !== undefined; });
      if (ka.length !== kb.length) return false;
      return ka.every(function(k){ return Object.prototype.hasOwnProperty.call(b, k) && same(a[k], b[k]); });
    }
    return false;
  }
  var clone = function(v){ return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };
  var HEX_ID = /^[0-9a-f]{16}$/;

  // Merges incoming rows (a package's `annotations`, plus its `deleted` tombstones) into the rows
  // one client holds for the asset — the same result Sight's import gives. Inputs are not changed.
  //   local     rows of this asset, deleted ones included (deleted_at set)
  //   incoming  rows to merge in
  //   opts      { deleted: [{id, deleted_at}], now: ms (default Date.now()),
  //               shotMap: {old: new} screenshot id renames }
  // Returns { rows, stats: {added, updated, deleted, unchanged} }: `rows` = every local row
  // (updated in place of the old ones) followed by the added ones. Ids are lower-cased hex as in
  // Sight; Sight also re-derives non-hex ids and ids owned by another asset, which needs the
  // whole library and is not done here.
  function mergeRows(local, incoming, opts){
    var o = opts || {};
    var now = o.now != null ? o.now : Date.now();
    var shotMap = o.shotMap || {};
    var stats = { added: 0, updated: 0, deleted: 0, unchanged: 0 };
    var byId = new Map();
    (local || []).forEach(function(r){ var c = clone(r); byId.set(String(c.id), c); });
    var localId = function(rid){ var l = rid.toLowerCase(); return HEX_ID.test(l) ? l : rid; };
    var rows = (incoming || []).filter(function(r){ return isObj(r) && pyTrue(r.id); });
    var ids = {};
    rows.forEach(function(r){ ids[pyStr(r.id)] = localId(pyStr(r.id)); });
    var tombs = (o.deleted || []).filter(function(t){ return isObj(t) && pyTrue(t.id) && stamp(t.deleted_at); })
      .map(function(t){ return [ids[pyStr(t.id)] || localId(pyStr(t.id)), stamp(t.deleted_at)]; });
    var mapShot = function(x){ var s = pyStr(x); return Object.prototype.hasOwnProperty.call(shotMap, s) ? shotMap[s] : s; };

    rows.forEach(function(r){
      var rid = ids[pyStr(r.id)];
      var data = isObj(r.data) ? clone(r.data) : {};
      if (typeof data.note === "string" && Object.prototype.hasOwnProperty.call(ids, data.note)) data.note = ids[data.note];
      if (Array.isArray(data.shots)) data.shots = data.shots.map(mapShot);
      if (typeof data.shot === "string") data.shot = mapShot(data.shot);  // a reference image's picture
      if (data.replies !== undefined && data.replies !== null && !Array.isArray(data.replies)) data.replies = [];
      if (pyTrue(data.replies)){  // pictures attached to replies (web page / Sight)
        data.replies = data.replies.map(function(x){ return isObj(x) && Array.isArray(x.shots) ? Object.assign({}, x, { shots: x.shots.map(mapShot) }) : x; });
      }
      var kind = pyStr(pyOr(r.kind, "shape"));
      var upd = stamp(pyOr(r.updated_at, r.created_at)) || now;
      var vals = {
        kind: kind, shape_kind: r.shape_kind === undefined ? null : r.shape_kind,
        x: num(r.x), y: num(r.y), w: num(r.w), h: num(r.h),
        rotation: num(r.rotation) || 0, z_index: Math.trunc(num(r.z_index) || 0),
        color: typeof r.color === "string" ? r.color : null, locked: pyTrue(r.locked) ? 1 : 0,
      };
      var cur = byId.get(rid);
      if (!cur){
        byId.set(rid, Object.assign({ id: rid }, vals, { data: data, created_at: stamp(r.created_at) || upd, updated_at: upd, deleted_at: null }));
        stats.added++;
        return;
      }
      var have = isObj(cur.data) ? cur.data : {};
      var incAt = contentAt(kind, data, r.created_at, upd), newer;
      if (cur.deleted_at !== null && cur.deleted_at !== undefined){
        // Deleted here: only content edited after the delete brings it back.
        if (incAt <= stamp(cur.deleted_at)){ stats.unchanged++; return; }
        newer = true;
      } else {
        newer = incAt > contentAt(kind, have, cur.created_at, cur.updated_at);
      }
      var merged = Object.assign({}, newer ? data : have);
      if (kind === "note"){
        if (pyTrue(have.replies) || pyTrue(data.replies)){
          merged.replies = mergeReplies(have.replies, data.replies);
        }
        var aAt = stamp(have.status_at), bAt = stamp(data.status_at);
        if (bAt > aAt){ merged.status = data.status === undefined ? null : data.status; merged.status_at = bAt; }
        else if (aAt > bAt){ merged.status = have.status === undefined ? null : have.status; merged.status_at = aAt; }
      } else if (kind === "status" && (pyTrue(have.history) || pyTrue(data.history))){
        merged.history = mergeHistory(have.history, data.history);
      }
      if (!newer && same(merged, have)){ stats.unchanged++; return; }
      if (newer){
        Object.assign(cur, vals, { data: merged, updated_at: Math.max(upd, kind === "note" ? now : upd), deleted_at: null });
      } else {
        cur.data = merged;
        cur.updated_at = Math.max(now, stamp(cur.updated_at));
      }
      stats.updated++;
    });

    tombs.forEach(function(tb){
      var cur = byId.get(tb[0]);
      if (!cur || (cur.deleted_at !== null && cur.deleted_at !== undefined)) return;
      var have = isObj(cur.data) ? cur.data : {};
      if (tb[1] > contentAt(cur.kind, have, cur.created_at, cur.updated_at)){
        cur.deleted_at = tb[1]; cur.updated_at = tb[1];
        stats.deleted++;
      }
    });
    return { rows: Array.from(byId.values()), stats: stats };
  }

  return {
    FORMAT: FORMAT, FORMAT_VERSION: FORMAT_VERSION,
    STROKE_TOOLS: STROKE_TOOLS, PATTERNS: PATTERNS, SHAPE_TOOLS: SHAPE_TOOLS, FONTS: FONTS,
    uid: uid, clamp: clamp, r2: r2, hyp: hyp, typeOf: typeOf, esc: esc, fontStack: fontStack, segDist: segDist, rotPt: rotPt,
    smoothPath: smoothPath, strokeRadii: strokeRadii, strokeOutline: strokeOutline, dashArray: dashArray,
    rectPath: rectPath, ellipsePath: ellipsePath, linePoints: linePoints, bendCtrl: bendCtrl, bendHandle: bendHandle,
    headPrims: headPrims, trimPolyline: trimPolyline, textFont: textFont, textLayout: textLayout,
    setImageSource: setImageSource, imageUrl: imageUrl, imageEl: imageEl, imagesReady: imagesReady, imgCrop: imgCrop,
    primsOf: primsOf, primSvg: primSvg, primCanvas: primCanvas, drawCanvas: drawCanvas, svgMarkup: svgMarkup,
    boundsOf: boundsOf, hitTest: hitTest, transformItem: transformItem, validItem: validItem,
    xfBox: xfBox, xfLine: xfLine, xfHandles: xfHandles, xfAt: xfAt, xfStart: xfStart, xfDrag: xfDrag, xfSvg: xfSvg, XF_CURSOR: XF_CURSOR, snap15: snap15, snapHV: snapHV,
    ctxVisible: ctxVisible, camMatch: camMatch, animMatch: animMatch, drawingRow: drawingRow,
    picKey: picKey, captionOf: captionOf, withCaption: withCaption, noteTimes: noteTimes, frameLabel: frameLabel, picFileName: picFileName,
    stamp: stamp, contentAt: contentAt, mergeReplies: mergeReplies, mergeHistory: mergeHistory, mergeRows: mergeRows, same: same,
  };
})();
if (typeof globalThis !== "undefined") globalThis.SightReviewCore = SightReviewCore;
if (typeof module === "object" && module && module.exports) module.exports = SightReviewCore;
