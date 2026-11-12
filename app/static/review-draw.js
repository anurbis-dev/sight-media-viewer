// Review drawing canvas — the full-screen sheet a reviewer draws on, shared by the HTML reviewer
// page (app/review.py inlines it after review-core.js) and the mobile app (mobile/, loaded as a
// script). Needs review-core.js (`SightReviewCore`) loaded first. Defines one global,
// `SightReviewDraw`:
//
//   SightReviewDraw.open({ src, vb, base, items, numOf, onDone(items, frames), onCancel() }) → handle
//     src    the picture (URL / data URL / blob URL)
//     vb     [x, y, w, h] — the doc box the picture covers (FORMAT.md doc units)
//     base   rows drawn underneath, not editable
//     items  editable drawings ({kind, shape_kind, z, data}, ids are kept); the eraser only
//            removes these
//     numOf  pin number for a drawing (optional)
//   Video (several frames): frameKey (the frame shown), frames {key: items} (the others'),
//   footer (an element shown above the tools: the host's timeline), onScrub({phase, dx, dt, fine})
//   (one finger with no tool), onFrames(keys) (the frames that hold drawings), onKey(e) → true if
//   the host took it; handle.setFrame(key, src, pending) switches the frame (its drawings, undo).
//   onDone then gets every frame's drawings: [{key, items}].
//   Placed as the host shows it (the phone's player): fitBox() → a viewport rect {left, top,
//   width, height} the picture is fitted into (no padding, the floating bars ignored; null: the
//   whole screen), nav {z, r, o: [dx, dy]} the host's own zoom / extra turn (degrees) / offset from
//   that fit to open with, onNav(nav) when the canvas closes (the view it was left in, same terms).
//
//   SightReviewDraw.pinch(g, a, b, zmin, zmax) → {z, r}: the two-finger zoom / turn from the view at
//   the start of a pinch (g: {z, r, d (finger distance), a (finger angle)}), a quarter turn snapping
//   within 6° — shared with the phone's player so both feel the same.
//
// Same rules as review-core.js: plain script, no imports, and never a closing script tag or an
// HTML comment opener anywhere in this file (the page inlines it verbatim; review._inline_js refuses
// to build otherwise). Its CSS is injected on first use, scoped to `.draw`.

var SightReviewDraw = (function(){
  "use strict";
  var RC = null;  // review-core, looked up on open so the load order of the two scripts does not matter
  var SVGNS = "http://www.w3.org/2000/svg";
  function el(tag, cls, text){ var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function clone(v){ return JSON.parse(JSON.stringify(v)); }
  // Everything floats over the picture (no bars taking room). Colours follow the host's theme when
  // it sets --rd-bg / --rd-ov / --rd-fg / --rd-line (the phone app does), dark otherwise.
  var CSS = [
    "body.rd-open { overflow: hidden; }",
    ".draw, .draw * { box-sizing: border-box; }",
    ".draw { position: fixed; inset: 0; z-index: 30; background: var(--rd-bg, #0d0d10); color: var(--rd-fg, #fff); user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; font: 14px/1.5 system-ui, -apple-system, \"Segoe UI\", sans-serif; }",
    ".draw .dtop, .draw .dbar { position: absolute; z-index: 2; left: 8px; right: 8px; display: flex; align-items: center; gap: 2px; padding: 4px 6px; border-radius: 16px; background: var(--rd-ov, rgb(28 28 32 / .74)); border: 1px solid var(--rd-line, rgb(255 255 255 / .14)); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); box-shadow: 0 6px 24px rgb(0 0 0 / .22); }",
    ".draw .dtop { top: calc(8px + env(safe-area-inset-top)); }",
    ".draw .dtop .sp { flex: 1; }",
    ".draw .btn { border: 1px solid var(--rd-line, rgb(255 255 255 / .25)); background: none; color: inherit; border-radius: 10px; padding: 5px 12px; font: inherit; font-size: 13px; cursor: pointer; }",
    ".draw .btn.primary { background: #0a84ff; border-color: #0a84ff; color: #fff; }",
    ".draw .dbar { bottom: calc(8px + env(safe-area-inset-bottom)); flex-direction: column; gap: 2px; padding: 4px 6px 6px; }",
    ".draw .dbar > div { display: flex; gap: 2px; justify-content: center; flex-wrap: wrap; width: 100%; }",
    ".draw .dbar > .dfoot { display: block; }",
    ".draw .dview { position: absolute; inset: 0; overflow: hidden; overflow: clip; touch-action: none; cursor: crosshair; }",
    ".draw .dbox { position: absolute; left: 0; top: 0; transform-origin: 0 0; }",
    ".draw .dbox img, .draw .dbox svg { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; pointer-events: none; }",
    ".draw .dbox img { -webkit-user-drag: none; transition: opacity .12s; }",
    ".draw .tb { width: 38px; height: 38px; border-radius: 11px; border: 0; background: none; color: inherit; opacity: .9; display: grid; place-items: center; cursor: pointer; padding: 0; }",
    ".draw .tb.on { background: #0a84ff; color: #fff; opacity: 1; }",
    ".draw .tb[disabled] { opacity: .3; cursor: default; }",
    ".draw [hidden] { display: none !important; }",
    ".draw .swc { width: 28px; height: 28px; margin: 3px 4px; border-radius: 14px; border: 2px solid var(--rd-line, rgb(255 255 255 / .3)); cursor: pointer; padding: 0; }",
    ".draw .swc.on { border-color: var(--rd-fg, #fff); box-shadow: 0 0 0 2px #0a84ff; }",
    ".draw .dsize { position: absolute; z-index: 3; left: 18px; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; align-items: flex-start; gap: 8px; pointer-events: none; }",
    ".draw .dsize i { display: block; border-radius: 50%; box-shadow: 0 0 0 1.5px rgb(255 255 255 / .9), 0 0 0 3px rgb(0 0 0 / .4); }",
    ".draw .dsize span { font-size: 12px; font-variant-numeric: tabular-nums; padding: 1px 8px; border-radius: 9px; background: var(--rd-ov, rgb(28 28 32 / .74)); border: 1px solid var(--rd-line, rgb(255 255 255 / .14)); white-space: nowrap; }",
    ".draw .dtext { position: absolute; z-index: 1; margin: 0; border: 1px dashed #0a84ff; border-radius: 0; outline: none; resize: none; overflow: hidden; white-space: pre; background: rgb(0 0 0 / .6); box-sizing: content-box; min-width: 1em; -webkit-user-select: text; user-select: text; touch-action: auto; }",
  ].join("\n");
  var cssDone = false;
  function css(){
    if (cssDone) return;
    cssDone = true;
    var s = document.createElement("style"); s.textContent = CSS; document.head.appendChild(s);
  }

  // Full screen: select / transform (V), brush (pen pressure), highlighter, arrow, rectangle,
  // ellipse, text, eraser (whole objects drawn here; Ctrl held = eraser for a moment), five colours,
  // undo / redo, clear. Two fingers pinch-zoom / pan / turn the view; a quick tap of two fingers
  // undoes, of three redoes. Press and hold with a tool, then drag up / down: its size (a preview
  // circle on the left; the screen's height spans the tool's whole range); with the transform tool
  // and a selection, up / down scales the selection's line width, sideways its opacity. Press and
  // hold a tool's button: that tool's size back to its default. Once a pen has touched it, the
  // pen draws and one finger pans too. Mouse: left draws, wheel / right-drag zoom (the pen's side
  // button too), middle drags. Top
  // bar: turn 90°, mirror, back to fit. Items are FORMAT.md drawings in the doc units of `vb`;
  // sizes are screen pixels at the moment of drawing, turned into doc units by the zoom.
  function ico(p){ return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + p + "</svg>"; }
  var TOOLS = [
    ["select", "Select / transform", '<path d="M5 3l13 7.5-5.6 1.6L9.6 18z"/><path d="M12.4 12.1 17 19"/>', "KeyV"],
    ["brush", "Brush", '<path d="M19.5 3.5a2.1 2.1 0 0 1 3 3L13 16l-3-3z"/><path d="M10 13c-3 0-4.5 2-4.5 4.2 0 1.4-1 2.3-2.5 2.8 5 1.2 9.5-.2 9.5-4.3z"/>', "KeyB"],
    ["marker", "Highlighter", '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>', "KeyM"],
    ["arrow", "Arrow", '<path d="M5 19 19 5"/><path d="M10 5h9v9"/>', "KeyW"],
    ["rect", "Rectangle", '<rect x="4" y="6" width="16" height="12" rx="2"/>', "KeyR"],
    ["ellipse", "Ellipse", '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>', "KeyO"],
    ["text", "Text", '<path d="M5 7V5h14v2"/><path d="M12 5v14"/><path d="M9 19h6"/>', "KeyT"],
    ["eraser", "Eraser — or hold Ctrl", '<path d="M8 20h12"/><path d="M5.2 14.8 14 6a2 2 0 0 1 2.8 0l2.8 2.8a2 2 0 0 1 0 2.8L11.2 20H8.4l-3.2-3.2a1.4 1.4 0 0 1 0-2z"/><path d="m9.5 10.5 5 5"/>', "KeyE"],
  ];
  var COLORS = ["#ff3b30", "#ffd60a", "#34c759", "#0a84ff", "#ffffff"];
  // Sizes in screen px at the moment of drawing (turned into doc units by the zoom), per tool; a
  // press-and-hold drag changes them within SIZE_RANGE, kept with the pen.
  var SIZE0 = { brush: 6, marker: 24, arrow: 4, rect: 4, ellipse: 4, text: 24, eraser: 14 };
  var SIZE_RANGE = { brush: [1, 80], marker: [4, 140], arrow: [1, 40], rect: [1, 40], ellipse: [1, 40], text: [8, 160], eraser: [4, 120] };
  var SIZE = clone(SIZE0);
  var pen = { tool: "brush", color: COLORS[0] }, lastTool = "brush";  // tool null: none (tap the active one)
  try {
    var ps = JSON.parse(localStorage.getItem("sight-review:pen"));
    if (ps && TOOLS.some(function(t){ return t[0] === ps.tool; })) pen.tool = lastTool = ps.tool;
    if (ps && COLORS.indexOf(ps.color) >= 0) pen.color = ps.color;
    if (ps && ps.sizes) Object.keys(SIZE0).forEach(function(k){ var v = Number(ps.sizes[k]); if (v >= SIZE_RANGE[k][0] && v <= SIZE_RANGE[k][1]) SIZE[k] = v; });
  } catch (e) {}
  function savePen(){ if (pen.tool) lastTool = pen.tool; try { localStorage.setItem("sight-review:pen", JSON.stringify({ tool: lastTool, color: pen.color, sizes: SIZE })); } catch (e) {} }
  // Two fingers: zoom by their distance and turn by their angle from the view at the start of the
  // pinch (g: {z, r, d, a}); a quarter turn snaps within 6°.
  function pinch(g, a, b, zmin, zmax){
    var z = Math.min(zmax, Math.max(zmin, g.z * Math.hypot(a.x - b.x, a.y - b.y) / g.d));
    var r = g.r + (Math.atan2(b.y - a.y, b.x - a.x) - g.a) * 180 / Math.PI, q90 = Math.round(r / 90) * 90;
    return { z: z, r: Math.abs(r - q90) < 6 ? q90 : r };
  }
  var penSeen = false;  // a stylus has been used: it draws, fingers only pan / zoom
  // A key with no modifier at all (the exact-match rule of Sight's keys.js, which this plain script
  // cannot import).
  function plain(e, code){ return e.code === code && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey; }
  // o: {src, vb: [x, y, w, h] doc box the picture covers, base: rows drawn underneath (not
  // editable), items: editable drawings, onDone(items), onCancel(), view: {rot (degrees), mirror}
  // to open with, onView({rot, mirror}) when the turn / mirror buttons change it}.
  function drawSheet(o){
    RC = (typeof globalThis !== "undefined" ? globalThis : window).SightReviewCore;
    if (!RC) throw new Error("review-draw.js needs review-core.js (SightReviewCore)");
    css();
    var NUM = o.numOf || function(){ return ""; };
    if (!pen.tool) pen.tool = lastTool;  // each canvas opens with a tool in hand
    // Video: the frame on screen (fkey) and the others drawn on in this session (store).
    var multi = o.frameKey != null, fkey = multi ? String(o.frameKey) : null, store = new Map(), lastSig = null;
    if (multi) Object.keys(o.frames || {}).forEach(function(k){ store.set(k, { items: o.frames[k].map(clone), undo: [], redo: [] }); });
    var vb = o.vb, items = (o.items || []).map(clone), undo = [], redo = [], cur = null, sel = [];
    if (multi && store.has(fkey)){ items = store.get(fkey).items; store.delete(fkey); }
    var zc = items.reduce(function(m, it){ return Math.max(m, it.z || 0); }, 0);
    var root = el("div", "draw"), top = el("div", "dtop"), view = el("div", "dview"), box = el("div", "dbox"), bar = el("div", "dbar");
    var img = el("img"); img.src = o.src; img.alt = ""; img.draggable = false;
    var sv = document.createElementNS(SVGNS, "svg"); sv.setAttribute("viewBox", vb.join(" ")); sv.setAttribute("preserveAspectRatio", "none");
    var gBase = document.createElementNS(SVGNS, "g"), gMine = document.createElementNS(SVGNS, "g"), gUi = document.createElementNS(SVGNS, "g");
    gBase.innerHTML = RC.svgMarkup(o.base || [], NUM);
    sv.appendChild(gBase); sv.appendChild(gMine); sv.appendChild(gUi);
    sv.style.overflow = "visible";
    box.appendChild(img); box.appendChild(sv); view.appendChild(box);
    function tbtn(title, html, fn){ var b = el("button", "tb"); b.type = "button"; b.title = title; b.setAttribute("aria-label", title); b.innerHTML = html; b.onclick = fn; return b; }
    var cancel = el("button", "btn", "Cancel"); cancel.type = "button";
    cancel.onclick = function(){
      var touched = undo.length || (edit && edit.ta.value.trim());
      store.forEach(function(st){ if (st.undo.length) touched = true; });
      if (touched && !confirm("Discard this drawing?")) return;
      if (edit) dropText();
      close(); if (o.onCancel) o.onCancel();
    };
    var ub = tbtn("Undo", ico('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'), doUndo);
    var rb = tbtn("Redo", ico('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'), doRedo);
    var clr = tbtn("Clear all drawings", ico('<path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13"/>'), clearOrDelete);
    var turnB = tbtn("Turn 90°", ico('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'), function(){ V.r = Math.round(V.r / 90) * 90 + 90; afterView(); });
    var mirB = tbtn("Mirror", ico('<path d="M12 3v18"/><path d="M8 7 3 17h5z"/><path d="M16 7l5 10h-5z"/>'), function(){ V.m = -V.m; afterView(); });
    var fitB = tbtn("Fit to screen", ico('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'), function(){ fit(true); });
    var done = el("button", "btn primary", "Done"); done.type = "button";
    done.onclick = function(){ if (stroke) finish(); if (edit) commitText(); endScrub(); close(); o.onDone(items, multi ? allFrames() : null); };
    [cancel, ub, rb, clr, el("span", "sp"), turnB, mirB, fitB, el("span", "sp"), done].forEach(function(b){ top.appendChild(b); });
    var tools = el("div"), cols = el("div");
    // A tap on the tool in hand puts it down: then one finger scrubs the video (onScrub) or pans.
    TOOLS.forEach(function(t){
      var b = tbtn(t[1], ico(t[2]), function(){ if (b.dataset.held){ delete b.dataset.held; return; } setTool(t[0] === pen.tool ? null : t[0]); });
      b.dataset.t = t[0]; tools.appendChild(b);
      // Press and hold: the tool in hand, at its default size (the preview shows it).
      var ht = null;
      b.addEventListener("pointerdown", function(){
        clearTimeout(ht); delete b.dataset.held;
        ht = setTimeout(function(){
          b.dataset.held = "1";
          if (SIZE0[t[0]] != null) SIZE[t[0]] = SIZE0[t[0]];
          setTool(t[0]);
          if (SIZE0[t[0]] != null){ showSize(t[0]); hideSize(); }
        }, 550);
      });
      ["pointerup", "pointercancel", "pointerleave"].forEach(function(ev){ b.addEventListener(ev, function(){ clearTimeout(ht); }); });
    });
    function setTool(t){ stopAdj(); if (edit) commitText(); pen.tool = t; if (t !== "select") sel = []; savePen(); paintBar(); paint(); }
    COLORS.forEach(function(c){
      var b = el("button", "swc"); b.type = "button"; b.title = "Colour"; b.setAttribute("aria-label", "Colour " + c); b.style.background = c; b.dataset.c = c;
      b.onclick = function(){
        if (edit){ pen.color = c; savePen(); paintBar(); edit.it.data.color = c; edit.ta.style.color = c; edit.ta.focus(); return; }  // recolours the text being typed
        if (pen.tool === "select" && sel.length){ recolour(c); return; }
        pen.color = c; if (!pen.tool || pen.tool === "eraser" || pen.tool === "select") pen.tool = "brush"; savePen(); paintBar(); paint();
      };
      cols.appendChild(b);
    });
    if (o.footer){ var foot = el("div", "dfoot"); foot.appendChild(o.footer); bar.appendChild(foot); }
    bar.appendChild(tools); bar.appendChild(cols);
    root.appendChild(top); root.appendChild(view); root.appendChild(bar);
    var ctrlHeld = false;
    function paintBar(){
      tools.querySelectorAll(".tb").forEach(function(b){ b.classList.toggle("on", b.dataset.t === pen.tool); });
      cols.querySelectorAll(".swc").forEach(function(b){ b.classList.toggle("on", b.dataset.c === pen.color && pen.tool !== "eraser" && pen.tool !== "select"); });
      view.style.cursor = pen.tool === "eraser" || ctrlHeld ? "cell" : !pen.tool ? (o.onScrub ? "ew-resize" : "grab") : pen.tool === "select" ? "default" : "crosshair";
    }
    function paint(){
      sel = sel.filter(function(it){ return items.indexOf(it) >= 0; });
      var shown = edit ? items.filter(function(it){ return it !== edit.it; }) : items;  // the text being typed shows in its field
      gMine.innerHTML = RC.svgMarkup(cur ? shown.concat([cur]) : shown, NUM);
      var k = kNow(), ui = "";
      if (pen.tool === "select" && sel.length) ui = RC.xfSvg(sel, { px: k, D: stroke && stroke.xf, hs: penSeen || coarse ? 1.5 : 1 });
      if (stroke && stroke.t === "marquee"){
        var m = stroke.m;
        ui += '<rect x="' + Math.min(m[0], m[2]) + '" y="' + Math.min(m[1], m[3]) + '" width="' + Math.abs(m[2] - m[0]) + '" height="' + Math.abs(m[3] - m[1]) + '" fill="rgb(76 154 255 / .12)" stroke="#4c9aff" stroke-width="' + k + '"/>';
      }
      gUi.innerHTML = ui;
      ub.disabled = !undo.length; rb.disabled = !redo.length;
      clr.disabled = !items.length;
      clr.title = pen.tool === "select" && sel.length ? "Delete the selected drawings" : multi ? "Clear this frame's drawings" : "Clear all drawings";
      if (multi && o.onFrames){
        var ks = framesDrawn(), sg = ks.join(",");
        if (sg !== lastSig){ lastSig = sg; o.onFrames(ks); }
      }
    }
    // Video frames: the ones holding drawings, every frame's drawings, switching the frame.
    function framesDrawn(){
      var ks = [];
      store.forEach(function(st, k){ if (st.items.length) ks.push(k); });
      if (items.length && ks.indexOf(fkey) < 0) ks.push(fkey);
      return ks.sort();
    }
    function allFrames(){
      var out = [];
      store.forEach(function(st, k){ if (k !== fkey && st.items.length) out.push({ key: k, items: st.items }); });
      if (items.length) out.push({ key: fkey, items: items });
      return out;
    }
    function setFrame(key, src, pending){
      key = String(key);
      if (key !== fkey){
        stopAdj();
        if (edit) commitText();
        if (stroke) abort();
        store.set(fkey, { items: items, undo: undo, redo: redo });
        var st = store.get(key) || { items: [], undo: [], redo: [] };
        store.delete(key);
        fkey = key; items = st.items; undo = st.undo; redo = st.redo; sel = [];
      }
      if (src && img.getAttribute("src") !== src) img.src = src;
      img.style.opacity = pending ? ".55" : "";
      paint();
    }
    var coarse = !!(window.matchMedia && matchMedia("(pointer: coarse)").matches);
    // Anything else that changes the drawings ends a size / opacity hold first (cancelled), so its
    // copies never land in another undo state or frame.
    function stopAdj(){ if (adj) adjEnd(true); }
    function doUndo(){ stopAdj(); if (edit) commitText(); if (stroke || !undo.length) return; redo.push(items); items = undo.pop(); paint(); }
    function doRedo(){ stopAdj(); if (edit) commitText(); if (stroke || !redo.length) return; undo.push(items); items = redo.pop(); paint(); }
    function change(next){ undo.push(items); redo.length = 0; items = next; paint(); }
    // Trash: the selection (select tool), else every drawing made here (one undo step).
    function clearOrDelete(){
      stopAdj();
      if (edit) commitText();
      if (stroke || !items.length) return;
      if (pen.tool === "select" && sel.length){ var gone = sel; change(items.filter(function(it){ return gone.indexOf(it) < 0; })); return; }
      change([]);
    }
    function recolour(c){
      stopAdj();
      var map = new Map();
      sel.forEach(function(it){ var n = clone(it); n.data.color = c; if (n.data.fill != null) n.data.fill = c; map.set(it, n); });
      sel = sel.map(function(x){ return map.get(x); });  // before change(): its paint() keeps only what is in items
      change(items.map(function(x){ return map.get(x) || x; }));
    }

    // View: the picture fitted into the free area (box BW × BH local px), then zoomed, panned,
    // turned and mirrored: screen = V.o + Rot(V.r) · diag(V.z · V.m, V.z) · (local − box centre).
    var BW = 1, BH = 1, V = { z: 1, r: 0, m: 1, o: [0, 0] };
    if (o.view){ V.r = Math.round((o.view.rot || 0) / 90) * 90; V.m = o.view.mirror ? -1 : 1; }
    function fwd0(q, v){  // local → screen, without the offset
      var a = v.r * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), x = (q[0] - BW / 2) * v.z * v.m, y = (q[1] - BH / 2) * v.z;
      return [x * c - y * s, x * s + y * c];
    }
    function inv(p, v){  // screen (view px) → local
      v = v || V;
      var a = -v.r * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), x = p[0] - v.o[0], y = p[1] - v.o[1];
      return [BW / 2 + (x * c - y * s) / (v.z * v.m), BH / 2 + (x * s + y * c) / v.z];
    }
    function docOf(p){ var q = inv(p); return [vb[0] + q[0] / BW * vb[2], vb[1] + q[1] / BH * vb[3]]; }
    function kNow(){ return vb[2] / (BW * V.z); }  // doc units per screen px
    // Puts local point q under screen point p (zoom / pan / turn about a point).
    function pin(q, p){ var f = fwd0(q, V); V.o = [p[0] - f[0], p[1] - f[1]]; }
    var fitted = true;
    // The picture box's width (local px) a fit into the host's box would give at turn rot.
    function boxAt(rot){
      var fb = o.fitBox ? o.fitBox() : null;
      if (!fb || !(fb.width > 0 && fb.height > 0)) return 0;
      var a = vb[2] / vb[3], side = (((Math.round(rot / 90) * 90) % 360) + 360) % 180 !== 0;
      var w = fb.width, h = fb.height, ra = side ? 1 / a : a;
      if (w / h > ra) w = h * ra; else h = w / ra;
      return side ? h : w;
    }
    // The fit's centre and the quarter turn the host keeps (o.view, onView): o.nav / onNav are
    // relative to these.
    var fitC = [0, 0], viewR = ((V.r % 360) + 360) % 360;
    // Fit: zoom and pan reset, the turn straightened to the nearest quarter (mirror kept).
    function fit(user){
      var r = view.getBoundingClientRect(), a = vb[2] / vb[3], fb = o.fitBox ? o.fitBox() : null, pad = fb ? 0 : 10;
      if (fb && !(fb.width > 0 && fb.height > 0)) fb = null;
      V.r = ((Math.round(V.r / 90) * 90) % 360 + 360) % 360;
      var side = V.r % 180 !== 0;
      var bw = fb ? fb.width : r.width, bh = fb ? fb.height : r.height;
      var w = Math.max(1, bw - pad * 2), h = Math.max(1, bh - pad * 2), ra = side ? 1 / a : a;
      if (w / h > ra) w = h * ra; else h = w / ra;
      BW = side ? h : w; BH = side ? w : h;
      V.z = 1;
      if (fb) V.o = [fb.left - r.left + bw / 2, fb.top - r.top + bh / 2];  // where the host shows it, bars over it
      else {
        // The bars float over the picture: one that fits between them sits there, a taller one uses
        // the whole screen.
        var t0 = top.getBoundingClientRect().bottom - r.top, b0 = bar.getBoundingClientRect().top - r.top, cy = r.height / 2;
        if (b0 > t0 && h + pad <= b0 - t0) cy = (t0 + b0) / 2;
        V.o = [r.width / 2, cy];
      }
      fitC = V.o.slice();
      fitted = true;
      apply();
      if (user && edit) textField();
    }
    function apply(){
      box.style.width = BW + "px"; box.style.height = BH + "px";
      box.style.transform = "translate(" + V.o[0] + "px," + V.o[1] + "px) rotate(" + V.r + "deg) scale(" + (V.z * V.m) + "," + V.z + ") translate(" + (-BW / 2) + "px," + (-BH / 2) + "px)";
      fitB.hidden = fitted; mirB.classList.toggle("on", V.m < 0);
      paint();
    }
    function moved(){ fitted = false; apply(); }
    function afterView(){
      if (edit) commitText();
      fit(false);
      viewR = V.r;
      if (o.onView) o.onView({ rot: ((Math.round(V.r / 90) * 90) % 360 + 360) % 360, mirror: V.m < 0 });
    }
    var refit = false;  // a resize while typing: fit once the text is done
    function onResize(){ if (edit){ refit = true; return; } if (!stroke && !gest){ if (fitted) fit(false); else apply(); } }
    function vpos(e){ var r = view.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    function toDoc(e){ return docOf(vpos(e)); }

    // Pointers: one draws (`stroke`), the navigating ones (fingers / middle / right mouse) pan,
    // pinch and turn (`gest`, re-based whenever a finger comes or goes).
    var pts = new Map(), stroke = null, gest = null, zdrag = null, scr = null;
    // Press and hold (hold → adj), and quick taps of two / three fingers (tap).
    var hold = null, adj = null, tap = null, touches = new Set(), lastPen = -1e9;
    // The size preview on the left (a circle as big as the line, the value under it).
    var sizeEl = null, sizeT = null;
    function showSize(t, info){
      clearTimeout(sizeT);
      if (!sizeEl){ sizeEl = el("div", "dsize"); var ring = el("i"); ring.appendChild(el("b")); sizeEl.appendChild(ring); sizeEl.appendChild(el("span")); root.appendChild(sizeEl); }
      if (t) info = { d: SIZE[t] * (t === "eraser" ? 2 : 1), color: t === "eraser" ? "transparent" : pen.color, op: t === "marker" ? 0.4 : 1, label: (Math.round(SIZE[t] * 10) / 10) + " px" };
      var ring2 = sizeEl.firstChild, fill = ring2.firstChild, dd = Math.max(2, Math.min(240, info.d));
      ring2.style.width = ring2.style.height = dd + "px";
      fill.style.cssText = "display:block;width:100%;height:100%;border-radius:50%;background:" + info.color + ";opacity:" + info.op;
      sizeEl.lastChild.textContent = info.label;
    }
    function hideSize(now){
      clearTimeout(sizeT);
      var gone = function(){ if (sizeEl){ sizeEl.remove(); sizeEl = null; } };
      if (now) gone(); else sizeT = setTimeout(gone, 700);
    }
    function startHold(e, sel0){
      endHold();
      if (e.pointerType === "mouse" || !pen.tool) return;
      hold = { id: e.pointerId, x: e.clientX, y: e.clientY, tol: e.pointerType === "pen" ? 4 : 8, sel0: sel0 || [] };
      hold.timer = setTimeout(holdFire, 450);
    }
    function endHold(){ if (hold){ clearTimeout(hold.timer); hold = null; } }
    // The finger has stayed put: what it started (a dot, an erase, a move) is undone and its drag
    // now sets the tool's size — or, with the transform tool, the selection's width / opacity.
    function holdFire(){
      var h = hold;
      hold = null;
      if (!h || !pts.has(h.id) || pts.size !== 1 || edit || adj || scr || zdrag) return;
      var tool = pen.tool;
      if (!tool) return;
      if (stroke) abort();
      gest = null;
      var q = pts.get(h.id);
      q.nav = false;
      if (tool === "select"){
        if (!sel.length) sel = h.sel0.filter(function(it){ return items.indexOf(it) >= 0; });
        if (!sel.length){ q.nav = true; gestStart(); return; }
        var map = new Map();
        sel.forEach(function(it){ map.set(it, clone(it)); });
        adj = { id: h.id, x: h.x, y: h.y, axis: null, prev: items, prevSel: sel, base: sel.map(function(it){ return it.data; }), changed: false };
        items = items.map(function(x){ return map.get(x) || x; });
        sel = sel.map(function(x){ return map.get(x); });
        showSelSize();
      } else if (SIZE0[tool] != null){
        adj = { id: h.id, x: h.x, y: h.y, tool: tool, s0: SIZE[tool] };
        showSize(tool);
      }
      paint();
    }
    var WKEY = { stroke: "size", text: "size", shape: "width" };
    function showSelSize(){
      if (!sel.length) return;
      var it = sel[0], d = it.data, w = d[WKEY[it.kind]] || 0;
      showSize(null, { d: w / kNow(), color: d.color || "#fff", op: d.opacity != null ? d.opacity : 1,
        label: (Math.round(w / kNow() * 10) / 10) + " px · " + Math.round((d.opacity != null ? d.opacity : 1) * 100) + " %" });
    }
    // The screen's height spans the tool's whole range (a ratio, so small sizes move as finely as
    // big ones), from the size it had; up = bigger.
    function adjMove(e){
      var r = view.getBoundingClientRect(), dy = e.clientY - adj.y, dx = e.clientX - adj.x;
      if (adj.tool){
        var rg = SIZE_RANGE[adj.tool];
        SIZE[adj.tool] = Math.round(RC.clamp(adj.s0 * Math.pow(rg[1] / rg[0], -dy / Math.max(1, r.height)), rg[0], rg[1]) * 10) / 10;
        showSize(adj.tool);
        return;
      }
      // The selection: one axis per hold (up / down the width, sideways the opacity), set by the
      // first 10 px.
      if (!adj.axis){ if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return; adj.axis = Math.abs(dy) >= Math.abs(dx) ? "y" : "x"; }
      var k = kNow(), f = Math.pow(16, -dy / Math.max(1, r.height)), dOp = dx / Math.max(1, r.width * 0.8);
      sel.forEach(function(it, i){
        var b = adj.base[i], d = it.data, key = WKEY[it.kind];
        if (adj.axis === "y" && key && typeof b[key] === "number") d[key] = RC.clamp(b[key] * f, 0.5 * k, vb[2] * 0.5);
        if (adj.axis === "x") d.opacity = Math.round(RC.clamp((b.opacity != null ? b.opacity : 1) + dOp, 0.05, 1) * 100) / 100;
      });
      adj.changed = true;
      showSelSize();
      paint();
    }
    function adjEnd(cancel){
      var a = adj;
      adj = null;
      if (a.tool){ if (cancel) SIZE[a.tool] = a.s0; else savePen(); }
      else if (a.changed && !cancel){ sel.forEach(roundItem); undo.push(a.prev); redo.length = 0; }
      else { items = a.prev; sel = a.prevSel; }
      hideSize(); paint();
    }
    // Two / three fingers down and up again quickly without moving: undo / redo (the view goes back
    // to where it was before the fingers came down).
    function tapDown(e){
      if (e.pointerType === "pen") lastPen = e.timeStamp;
      if (e.pointerType !== "touch") return;
      if (!touches.size) tap = edit || adj ? null : { t0: e.timeStamp, n: 0, moved: false, at: new Map(), v: { z: V.z, r: V.r, m: V.m, o: V.o.slice() }, fitted: fitted };
      touches.add(e.pointerId);
      if (tap){ tap.n = Math.max(tap.n, touches.size); tap.at.set(e.pointerId, [e.clientX, e.clientY]); }
    }
    function tapMove(e){
      var a0 = tap && tap.at.get(e.pointerId);
      if (a0 && RC.hyp(e.clientX - a0[0], e.clientY - a0[1]) > 14) tap.moved = true;
    }
    function tapUp(e){
      if (!touches.has(e.pointerId)) return null;
      touches.delete(e.pointerId);
      if (touches.size || !tap) return null;
      var t0 = tap;
      tap = null;
      // Not a resting palm while a pen is drawing (or just was).
      var pen0 = (stroke && stroke.type === "pen") || t0.t0 - lastPen < 600;
      return e.type === "pointerup" && !pen0 && !t0.moved && t0.n >= 2 && t0.n <= 3 && e.timeStamp - t0.t0 < 400 ? t0 : null;
    }
    function tapAct(t0){
      V = t0.v; fitted = t0.fitted; apply();
      if (t0.n === 2) doUndo(); else doRedo();
    }
    // No tool in hand: one finger (or the left button) scrubs the video through the host.
    function endScrub(){ if (!scr) return; var id = scr.id; scr = null; if (o.onScrub) o.onScrub({ phase: "end" }); var q = pts.get(id); if (q) q.nav = true; }
    function gestStart(){
      var ids = [];
      pts.forEach(function(p, id){ if (p.nav) ids.push(id); });
      if (!ids.length){ gest = null; return; }
      var a = pts.get(ids[0]), b = ids.length > 1 ? pts.get(ids[1]) : null;
      var m = b ? [(a.x + b.x) / 2, (a.y + b.y) / 2] : [a.x, a.y];
      gest = { ids: ids.slice(0, 2), v: { z: V.z, r: V.r, m: V.m, o: V.o.slice() }, q: inv(m), d: b ? RC.hyp(a.x - b.x, a.y - b.y) : 0, a: b ? Math.atan2(b.y - a.y, b.x - a.x) : 0 };
    }
    function gestMove(){
      var a = pts.get(gest.ids[0]), b = gest.ids.length > 1 ? pts.get(gest.ids[1]) : null;
      if (!a) return;
      var m = b ? [(a.x + b.x) / 2, (a.y + b.y) / 2] : [a.x, a.y];
      if (b && gest.d > 0){
        var k = pinch({ z: gest.v.z, r: gest.v.r, d: gest.d, a: gest.a }, a, b, 0.5, 16);
        V.z = k.z; V.r = k.r;
      }
      pin(gest.q, m);
      moved();
    }
    view.addEventListener("pointerdown", function(e){
      if (edit && e.target === edit.ta) return;  // placing the caret in the text field
      e.preventDefault();
      tapDown(e);
      endHold();  // a second pointer: no hold
      if (adj) return;  // the size drag keeps the screen to itself
      if (edit){
        // A tap elsewhere ends the typing; that finger (and a second one: a pinch) then only navigates.
        commitText();
        pts.set(e.pointerId, { x: vpos(e)[0], y: vpos(e)[1], nav: true });
        try { view.setPointerCapture(e.pointerId); } catch (_){}
        gestStart();
        return;
      }
      var p = vpos(e);
      if ((e.pointerType === "mouse" || e.pointerType === "pen") && e.button === 2){
        // Right-drag (the pen's side button too) zooms about where it started, as in Sight's viewer.
        try { view.setPointerCapture(e.pointerId); } catch (_){}
        zdrag = { id: e.pointerId, y: e.clientY, p: p, q: inv(p), z0: V.z };
        return;
      }
      if (e.pointerType === "pen") penSeen = true;
      var drawer = e.pointerType === "pen" || (e.pointerType === "mouse" && e.button === 0) || (e.pointerType === "touch" && !penSeen);
      try { view.setPointerCapture(e.pointerId); } catch (_){}
      // (A finger scrubs too once a pen has been used: with no tool there is nothing to keep it from.)
      if ((drawer || (e.pointerType === "touch" && !pts.size)) && !stroke && !gest && !scr && !pen.tool && !(e.ctrlKey && !e.metaKey) && o.onScrub){
        pts.set(e.pointerId, { x: p[0], y: p[1], nav: false });
        scr = { id: e.pointerId, x: e.clientX, t: e.timeStamp };
        o.onScrub({ phase: "start" });
        return;
      }
      var sel0 = sel.slice();  // a hold on empty space keeps adjusting the selection a tap there would drop
      if (drawer && !stroke && !gest && !scr){
        pts.set(e.pointerId, { x: p[0], y: p[1], nav: false }); begin(e);
        if (!stroke){ pts.get(e.pointerId).nav = true; gestStart(); }  // select tool on empty space: the finger pans
        if (pts.size === 1) startHold(e, sel0);
        return;
      }
      // A pen wins over a resting palm / finger: their stroke is dropped, their pan stops.
      if (e.pointerType === "pen"){
        if (stroke && stroke.type === "pen") return;
        if (stroke){ var pp = pts.get(stroke.id); abort(); if (pp) pp.nav = true; }
        gest = null;
        pts.set(e.pointerId, { x: p[0], y: p[1], nav: false }); begin(e);
        if (!stroke){ pts.get(e.pointerId).nav = true; gestStart(); }
        if (pts.size === 1) startHold(e, sel0);
        return;
      }
      // A second finger while one draws: that was the start of a pinch, not a stroke.
      if (stroke && stroke.type === "touch"){ var sp = pts.get(stroke.id); abort(); if (sp) sp.nav = true; }
      if (stroke) return;  // the pen is drawing; fingers wait
      if (scr && e.pointerType !== "mouse") endScrub();  // a second finger: a pinch, not a scrub
      if (scr) return;
      pts.set(e.pointerId, { x: p[0], y: p[1], nav: true });
      gestStart();
    });
    view.addEventListener("pointermove", function(e){
      if (e.pointerType === "mouse" && ctrlHeld !== e.ctrlKey){ ctrlHeld = e.ctrlKey; paintBar(); }
      if (zdrag && e.pointerId === zdrag.id){
        V.z = RC.clamp(zdrag.z0 * Math.exp((zdrag.y - e.clientY) * 0.012), 0.5, 16);
        pin(zdrag.q, zdrag.p);
        moved();
        return;
      }
      tapMove(e);
      var q = pts.get(e.pointerId);
      if (!q) return;
      var p = vpos(e); q.x = p[0]; q.y = p[1];
      if (hold && hold.id === e.pointerId && RC.hyp(e.clientX - hold.x, e.clientY - hold.y) > hold.tol) endHold();
      if (adj && adj.id === e.pointerId){ e.preventDefault(); adjMove(e); return; }
      if (scr && scr.id === e.pointerId){
        var dx = e.clientX - scr.x, dt = e.timeStamp - scr.t;
        scr.x = e.clientX; scr.t = e.timeStamp;
        if (dx) o.onScrub({ phase: "move", dx: dx, dt: dt, fine: e.shiftKey });
        return;
      }
      if (stroke && stroke.id === e.pointerId){ e.preventDefault(); extend(e); return; }
      if (gest && gest.ids.indexOf(e.pointerId) >= 0) gestMove();
    });
    // A cancelled pointer (e.g. a palm the system rejects) drops its stroke instead of keeping it.
    function up(e){
      if (e.pointerType === "pen") lastPen = e.timeStamp;
      var t0 = tapUp(e);
      up0(e);
      if (t0) tapAct(t0);
    }
    function up0(e){
      if (zdrag && e.pointerId === zdrag.id){ zdrag = null; return; }
      if (hold && hold.id === e.pointerId) endHold();
      if (adj && adj.id === e.pointerId){ pts.delete(e.pointerId); adjEnd(e.type === "pointercancel"); return; }
      if (!pts.has(e.pointerId)) return;
      if (scr && scr.id === e.pointerId) endScrub();
      pts.delete(e.pointerId);
      if (stroke && stroke.id === e.pointerId){
        if (e.type === "pointercancel") abort(); else finish();
        gestStart();  // fingers still down (after a pen stroke) pan from here
        return;
      }
      if (gest && gest.ids.indexOf(e.pointerId) >= 0) gestStart();
    }
    view.addEventListener("pointerup", up);
    view.addEventListener("pointercancel", up);
    view.addEventListener("wheel", function(e){
      e.preventDefault();
      var p = vpos(e), q = inv(p);
      V.z = RC.clamp(V.z * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), 0.5, 16);
      pin(q, p);
      moved();
    }, { passive: false });
    view.addEventListener("contextmenu", function(e){ e.preventDefault(); });
    // A focused text field near an edge would scroll the view (where overflow: clip is missing),
    // and every position here assumes it never scrolls.
    view.addEventListener("scroll", function(){ if (view.scrollLeft || view.scrollTop){ view.scrollLeft = 0; view.scrollTop = 0; } });
    root.addEventListener("touchmove", function(e){ e.preventDefault(); }, { passive: false });
    root.addEventListener("contextmenu", function(e){ e.preventDefault(); });  // a long press on a button

    // The topmost drawing made here under p (doc units), within tol.
    function itemAt(p, tol){
      var best = null;
      items.forEach(function(it){ if (RC.hitTest(it, p[0], p[1], tol) && (!best || (it.z || 0) >= (best.z || 0))) best = it; });
      return best;
    }
    function begin(e){
      var p = toDoc(e), k = kNow(), isPen = e.pointerType === "pen", c = pen.color;
      var t = e.ctrlKey && !e.metaKey ? "eraser" : pen.tool;  // Ctrl held: the eraser for this stroke
      if (!t){ stroke = null; return; }  // no tool: the finger pans
      var fine = e.pointerType === "mouse";
      stroke = { id: e.pointerId, type: e.pointerType, t: t, k: k, x: p[0], y: p[1], sm: p.slice(), last: null, cx: e.clientX, cy: e.clientY };
      if (t === "eraser"){ stroke.before = items; eraseAt(p); return; }
      if (t === "text") return;  // the field opens on release (iOS shows the keyboard only then)
      if (t === "select"){
        var hs = sel.length ? RC.xfHandles(sel, k, null) : [], h = RC.xfAt(hs, p[0], p[1], (fine ? 9 : 22) * k);
        // A finger's wide reach must not turn every press on a small object into a handle: on the
        // body of a selected object, a press more than 8 px from any handle moves it.
        if (h && !fine){
          var near = Math.min.apply(null, hs.map(function(q){ return RC.hyp(q[1] - p[0], q[2] - p[1]); }));
          var body = itemAt(p, 6 * k);
          if (near > 8 * k && body && sel.indexOf(body) >= 0) h = null;
        }
        if (!h){
          var hit = itemAt(p, (fine ? 5 : 12) * k);
          if (!hit){
            if (!e.shiftKey) sel = [];
            if (fine){ stroke.t = "marquee"; stroke.m = [p[0], p[1], p[0], p[1]]; stroke.base = sel.slice(); }
            else stroke = null;  // a finger on empty space pans
            paint();
            return;
          }
          if (e.shiftKey){
            var at = sel.indexOf(hit);
            if (at >= 0) sel.splice(at, 1); else sel.push(hit);
            stroke.t = "none"; paint();
            return;
          }
          if (sel.indexOf(hit) < 0) sel = [hit];
          h = "move";
        }
        // The drag works on copies, so the undo step keeps the untouched objects.
        var map = new Map();
        sel.forEach(function(it){ map.set(it, clone(it)); });
        stroke.t = "xf"; stroke.prev = items; stroke.prevSel = sel;
        items = items.map(function(x){ return map.get(x) || x; });
        sel = sel.map(function(x){ return map.get(x); });
        stroke.xf = RC.xfStart(h, sel, p[0], p[1]);
        paint();
        return;
      }
      var d;
      if (t === "brush" || t === "marker"){
        var pr = isPen ? RC.clamp(e.pressure || 0.5, 0, 1) : 0.5;
        d = { color: c, size: RC.r2(SIZE[t] * k), opacity: t === "marker" ? 0.4 : 1, pressure: true, pen: isPen, pts: [RC.r2(p[0]), RC.r2(p[1]), RC.r2(pr)] };
        cur = { kind: "stroke", shape_kind: t, z: ++zc, data: d };
      } else if (t === "arrow"){
        d = { color: c, width: RC.r2(SIZE.arrow * k), opacity: 1, dash: "solid", head0: "none", head1: "triangle", body: "straight", headSize: 1, pts: [p[0], p[1], p[0], p[1]] };
        cur = { kind: "shape", shape_kind: "arrow", z: ++zc, data: d };
      } else {
        d = { color: c, strokeOn: true, width: RC.r2(SIZE[t] * k), dash: "solid", fillOn: false, fill: c, fillOpacity: 0.2, radius: 0, opacity: 1, x: p[0], y: p[1], w: 0, h: 0, rot: 0 };
        cur = { kind: "shape", shape_kind: t, z: ++zc, data: d };
      }
      d.created = Date.now();
      paint();
    }
    function extend(e){
      var S0 = stroke;
      if (S0.t === "eraser"){ eraseAt(toDoc(e)); return; }
      if (S0.t === "text" || S0.t === "none") return;
      if (S0.t === "xf"){
        if (!S0.xf.moved && RC.hyp(e.clientX - S0.cx, e.clientY - S0.cy) < 3) return;
        var q = toDoc(e);
        RC.xfDrag(S0.xf, q[0], q[1], { shift: e.shiftKey, alt: e.altKey });
        paint();
        return;
      }
      if (S0.t === "marquee"){
        var mq = toDoc(e), m = S0.m;
        m[2] = mq[0]; m[3] = mq[1];
        var x0 = Math.min(m[0], m[2]), x1 = Math.max(m[0], m[2]), y0 = Math.min(m[1], m[3]), y1 = Math.max(m[1], m[3]);
        sel = S0.base.concat(items.filter(function(it){ var b = RC.boundsOf(it); return S0.base.indexOf(it) < 0 && b[0] <= x1 && b[2] >= x0 && b[1] <= y1 && b[3] >= y0; }));
        paint();
        return;
      }
      if (!cur) return;
      var d = cur.data;
      if (S0.t === "brush" || S0.t === "marker"){
        var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
        if (!evs.length) evs = [e];
        evs.forEach(function(ce){
          var q = toDoc(ce), a = 1 - 0.5 * 0.82;  // smoothing as Sight's brush default
          S0.sm = [S0.sm[0] + (q[0] - S0.sm[0]) * a, S0.sm[1] + (q[1] - S0.sm[1]) * a];
          var n = d.pts.length;
          if (RC.hyp(S0.sm[0] - d.pts[n - 3], S0.sm[1] - d.pts[n - 2]) < 0.75 * S0.k) return;
          d.pts.push(RC.r2(S0.sm[0]), RC.r2(S0.sm[1]), RC.r2(d.pen ? RC.clamp(ce.pressure || 0, 0, 1) : 0.5));
        });
        var l = toDoc(e);
        S0.last = [l[0], l[1], d.pen ? RC.clamp(e.pressure || 0, 0, 1) : 0.5];
      } else {
        var p = toDoc(e);
        if (S0.t === "arrow") d.pts = [S0.x, S0.y, p[0], p[1]];
        else { d.x = S0.x; d.y = S0.y; d.w = p[0] - S0.x; d.h = p[1] - S0.y; }
      }
      paint();
    }
    function finish(){
      var S0 = stroke, it = cur;
      stroke = null; cur = null;
      if (S0.t === "eraser"){ if (S0.before !== items){ undo.push(S0.before); redo.length = 0; } paint(); return; }
      if (S0.t === "text"){ openText(S0); return; }
      if (S0.t === "none" || S0.t === "marquee"){ paint(); return; }
      if (S0.t === "xf"){
        if (S0.xf.moved){
          items.forEach(function(x){ if (sel.indexOf(x) >= 0) roundItem(x); });
          undo.push(S0.prev); redo.length = 0;
        } else {
          items = S0.prev;
          // A plain tap on one of several selected objects selects just that one.
          sel = S0.prevSel.length > 1 && S0.xf.handle === "move" ? S0.prevSel.filter(function(x){ return RC.hitTest(x, S0.x, S0.y, 12 * S0.k); }).slice(-1) : S0.prevSel;
        }
        paint();
        return;
      }
      if (!it){ paint(); return; }
      var d = it.data, t = S0.t, k = S0.k;
      if (t === "brush" || t === "marker"){
        var n = d.pts.length;
        if (S0.last && RC.hyp(S0.last[0] - d.pts[n - 3], S0.last[1] - d.pts[n - 2]) > 0.01) d.pts.push(RC.r2(S0.last[0]), RC.r2(S0.last[1]), RC.r2(S0.last[2]));
      } else if (t === "arrow"){
        if (RC.hyp(d.pts[2] - d.pts[0], d.pts[3] - d.pts[1]) / k < 3){ paint(); return; }
        d.pts = d.pts.map(RC.r2);
      } else {
        if (Math.abs(d.w) / k < 3 && Math.abs(d.h) / k < 3){ paint(); return; }
        if (d.w < 0){ d.x += d.w; d.w = -d.w; }
        if (d.h < 0){ d.y += d.h; d.h = -d.h; }
        ["x", "y", "w", "h"].forEach(function(key){ d[key] = RC.r2(d[key]); });
      }
      undo.push(items); redo.length = 0;
      items = items.concat([it]);
      paint();
    }
    // Two decimals, as everything else is stored.
    function roundItem(it){
      var d = it.data;
      if (Array.isArray(d.pts)) d.pts = d.pts.map(RC.r2);
      ["x", "y", "w", "h", "size", "width", "rot", "bend", "radius", "outline"].forEach(function(key){ if (typeof d[key] === "number") d[key] = RC.r2(d[key]); });
    }
    function abort(){
      if (stroke && stroke.t === "eraser") items = stroke.before;
      if (stroke && stroke.t === "xf"){ items = stroke.prev; sel = stroke.prevSel; }
      stroke = null; cur = null; paint();
    }
    // Removes the objects drawn here that the eraser touches (others' drawings stay).
    function eraseAt(p){
      var tol = SIZE.eraser * stroke.k;
      var left = items.filter(function(it){ return !RC.hitTest(it, p[0], p[1], tol); });
      if (left.length !== items.length){ items = left; paint(); }
    }
    // Text: a tap opens a field there (on one of the texts drawn here: edits it); typing shows in
    // the field, a tap elsewhere / Done / Esc puts it on the picture. Sight's text defaults
    // (white-ish on a dark box); the size is SIZE.text screen px at the current zoom. The field
    // lives in the picture's box, so it zooms, turns and mirrors with it.
    var edit = null;
    function textField(){
      var d = edit.it.data, kb = vb[2] / BW;  // doc units per box px
      var L = RC.textLayout(Object.assign({}, d, { text: edit.ta.value || " " }));
      var pad = d.size * 0.3 / kb, ta = edit.ta;
      ta.style.font = RC.textFont(Object.assign({}, d, { size: d.size / kb }));
      ta.style.lineHeight = "1.25";
      ta.style.color = d.color;
      ta.style.padding = pad + "px";
      ta.style.left = ((d.x - vb[0]) / kb - pad - 1) + "px";
      ta.style.top = ((d.y - vb[1]) / kb - pad - 1) + "px";
      ta.style.width = Math.ceil(L.w / kb + d.size / kb * 0.6) + "px";
      ta.style.height = Math.ceil(L.h / kb) + "px";
      ta.style.borderWidth = (1 / V.z) + "px";
    }
    function openText(S0){
      var k = S0.k, tol = 4 * k, hit = null;
      for (var i = items.length - 1; i >= 0; i--){ if (RC.typeOf(items[i]) === "text" && RC.hitTest(items[i], S0.x, S0.y, tol)){ hit = items[i]; break; } }
      var it = hit || { kind: "text", shape_kind: null, z: ++zc, data: { text: "", x: RC.r2(S0.x), y: RC.r2(S0.y - SIZE.text * k * 0.6), font: "sans", size: RC.r2(SIZE.text * k),
        color: pen.color, bold: false, italic: false, underline: false, align: "left", bgOn: true, bg: "#000000", bgOpacity: 0.6, outline: 0, outlineColor: "#000000", opacity: 1, rot: 0, created: Date.now() } };
      if (hit) sel = [];
      var ta = el("textarea", "dtext");
      ta.value = it.data.text || ""; ta.rows = 1; ta.spellcheck = false; ta.setAttribute("autocapitalize", "sentences");
      edit = { it: it, isNew: !hit, before: hit ? clone(hit.data) : null, ta: ta };
      ta.oninput = textField;
      box.appendChild(ta);
      textField(); paint();
      try { ta.focus({ preventScroll: true }); } catch (_){ ta.focus(); }
      try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (_){}
    }
    function commitText(){
      var e0 = edit, text = e0.ta.value.replace(/\s+$/, "");
      edit = null; e0.ta.remove();
      if (e0.isNew){
        if (text){ undo.push(items); redo.length = 0; e0.it.data.text = text; items = items.concat([e0.it]); }
      } else if (!text){
        undo.push(items); redo.length = 0; items = items.filter(function(x){ return x !== e0.it; });
      } else if (text !== e0.before.text || e0.it.data.color !== e0.before.color){
        // The edited copy replaces the item, so undo gets the untouched one back.
        var nu = Object.assign({}, e0.it, { data: Object.assign({}, e0.it.data, { text: text }) });
        e0.it.data = e0.before;  // older undo states hold this object: give it its data back
        var old = e0.it;
        undo.push(items.map(function(x){ return x === e0.it ? old : x; })); redo.length = 0;
        items = items.map(function(x){ return x === e0.it ? nu : x; });
      } else e0.it.data = e0.before;
      paint(); afterText();
    }
    function dropText(){ var e0 = edit; edit = null; e0.ta.remove(); if (!e0.isNew) e0.it.data = e0.before; paint(); afterText(); }
    function afterText(){ view.scrollLeft = 0; view.scrollTop = 0; if (refit){ refit = false; if (fitted) fit(false); else apply(); } }
    function onKey(e){
      var mod = e.ctrlKey || e.metaKey;
      if (edit){  // typing: the field keeps its own keys (Enter = new line, Ctrl+Z = its undo); Esc ends it
        if (e.key === "Escape" && !mod && !e.altKey && !e.shiftKey && !e.isComposing){ commitText(); e.preventDefault(); e.stopPropagation(); }
        return;
      }
      if (e.key === "Control" && !ctrlHeld){ ctrlHeld = true; paintBar(); return; }
      stopAdj();
      if (o.onKey && !stroke && o.onKey(e)){ e.preventDefault(); e.stopPropagation(); return; }
      if (e.key === "Escape" && !mod && !e.altKey && !e.shiftKey){ if (pen.tool === "select" && sel.length){ sel = []; paint(); } else cancel.onclick(); }
      else if (mod && !e.altKey && (e.key === "z" || e.key === "Z")){ if (e.shiftKey) doRedo(); else doUndo(); }
      else if (mod && !e.altKey && !e.shiftKey && e.key === "y") doRedo();
      else if ((plain(e, "Delete") || plain(e, "Backspace")) && pen.tool === "select" && sel.length) clearOrDelete();
      else {
        var tl = TOOLS.find(function(x){ return plain(e, x[3]); });
        if (!tl) return;
        setTool(tl[0]);
      }
      e.preventDefault(); e.stopPropagation();
    }
    function onKeyUp(e){ if (e.key === "Control" && ctrlHeld){ ctrlHeld = false; paintBar(); } }
    function onBlur(){ if (ctrlHeld){ ctrlHeld = false; paintBar(); } }
    function close(){
      endScrub();
      endHold(); hideSize(true);
      if (o.onNav){
        // In the host's terms: its zoom is relative to its own fit at its quarter turn (viewR),
        // whose box differs from this one when the canvas was turned / fitted at another quarter.
        var cb = o.onNav, bh = boxAt(viewR), zr = bh ? BW / bh : 1;
        o.onNav = null;
        cb({ z: V.z * zr, r: V.r - viewR, o: [V.o[0] - fitC[0], V.o[1] - fitC[1]] });
      }
      root.remove(); document.body.classList.remove("rd-open");
      document.removeEventListener("keydown", onKey, true); document.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("resize", onResize); window.removeEventListener("blur", onBlur);
    }
    document.body.appendChild(root); document.body.classList.add("rd-open");
    document.addEventListener("keydown", onKey, true); document.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("resize", onResize); window.addEventListener("blur", onBlur);
    paintBar(); fit(false);
    if (o.nav && (Math.abs(o.nav.z - 1) > 1e-3 || o.nav.r || o.nav.o[0] || o.nav.o[1])){
      V.z = RC.clamp(o.nav.z, 0.5, 16); V.r = viewR + o.nav.r; V.o = [fitC[0] + o.nav.o[0], fitC[1] + o.nav.o[1]];
      moved();
    }
    requestAnimationFrame(function(){ if (root.isConnected && fitted && !edit) fit(false); });  // the bars' real size
    return { setFrame: setFrame, close: close, frameKey: function(){ return fkey; } };
  }

  return { open: drawSheet, pinch: pinch, TOOLS: TOOLS, COLORS: COLORS, SIZE: SIZE };
})();
if (typeof globalThis !== "undefined") globalThis.SightReviewDraw = SightReviewDraw;
