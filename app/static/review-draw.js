// Review drawing canvas — the full-screen sheet a reviewer draws on, shared by the HTML reviewer
// page (app/review.py inlines it after review-core.js) and the mobile app (mobile/, loaded as a
// script). Needs review-core.js (`SightReviewCore`) loaded first. Defines one global,
// `SightReviewDraw`:
//
//   SightReviewDraw.open({ src, vb, base, items, numOf, onDone(items), onCancel() })
//     src    the picture (URL / data URL / blob URL)
//     vb     [x, y, w, h] — the doc box the picture covers (FORMAT.md doc units)
//     base   rows drawn underneath, not editable
//     items  editable drawings ({kind, shape_kind, z, data}, ids are kept); the eraser only
//            removes these
//     numOf  pin number for a drawing (optional)
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
  var CSS = [
    "body.rd-open { overflow: hidden; }",
    ".draw, .draw * { box-sizing: border-box; }",
    ".draw { position: fixed; inset: 0; z-index: 30; background: #0d0d10; color: #fff; display: flex; flex-direction: column; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; font: 14px/1.5 system-ui, -apple-system, \"Segoe UI\", sans-serif; }",
    ".draw .dtop, .draw .dbar { flex: none; display: flex; align-items: center; gap: 4px; padding: 6px 10px; background: #1c1c20; }",
    ".draw .dtop { padding-top: calc(6px + env(safe-area-inset-top)); }",
    ".draw .dtop .sp { flex: 1; }",
    ".draw .btn { border: 1px solid rgb(255 255 255 / .25); background: none; color: #fff; border-radius: 8px; padding: 5px 12px; font: inherit; font-size: 13px; cursor: pointer; }",
    ".draw .btn.primary { background: #0a84ff; border-color: #0a84ff; }",
    ".draw .dbar { flex-direction: column; gap: 6px; padding-bottom: calc(8px + env(safe-area-inset-bottom)); }",
    ".draw .dbar > div { display: flex; gap: 4px; justify-content: center; flex-wrap: wrap; }",
    ".draw .dview { flex: 1; position: relative; overflow: hidden; overflow: clip; touch-action: none; cursor: crosshair; }",
    ".draw .dbox { position: absolute; left: 0; top: 0; transform-origin: 0 0; }",
    ".draw .dbox img, .draw .dbox svg { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; pointer-events: none; }",
    ".draw .dbox img { -webkit-user-drag: none; }",
    ".draw .tb { width: 40px; height: 40px; border-radius: 10px; border: 0; background: none; color: #d8d8dc; display: grid; place-items: center; cursor: pointer; padding: 0; }",
    ".draw .tb.on { background: #0a84ff; color: #fff; }",
    ".draw .tb[disabled] { opacity: .3; cursor: default; }",
    ".draw [hidden] { display: none !important; }",
    ".draw .swc { width: 30px; height: 30px; margin: 3px 4px; border-radius: 15px; border: 2px solid rgb(255 255 255 / .3); cursor: pointer; padding: 0; }",
    ".draw .swc.on { border-color: #fff; box-shadow: 0 0 0 2px #0a84ff; }",
    ".draw .dtext { position: absolute; z-index: 1; margin: 0; border: 1px dashed #0a84ff; border-radius: 0; outline: none; resize: none; overflow: hidden; white-space: pre; background: rgb(0 0 0 / .6); box-sizing: content-box; min-width: 1em; -webkit-user-select: text; user-select: text; touch-action: auto; }",
  ].join("\n");
  var cssDone = false;
  function css(){
    if (cssDone) return;
    cssDone = true;
    var s = document.createElement("style"); s.textContent = CSS; document.head.appendChild(s);
  }

  // Full screen: brush (pen pressure), highlighter, arrow, rectangle, ellipse, eraser (whole
  // objects drawn here), five colours, undo / redo. Two fingers pinch-zoom / pan; once a pen has
  // touched it, the pen draws and one finger pans too. Mouse: left draws, wheel zooms, middle /
  // right drags. Items are FORMAT.md drawings in the doc units of `vb`; sizes are screen pixels at
  // the moment of drawing, turned into doc units by the zoom.
  function ico(p){ return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + p + "</svg>"; }
  var TOOLS = [
    ["brush", "Brush", '<path d="M19.5 3.5a2.1 2.1 0 0 1 3 3L13 16l-3-3z"/><path d="M10 13c-3 0-4.5 2-4.5 4.2 0 1.4-1 2.3-2.5 2.8 5 1.2 9.5-.2 9.5-4.3z"/>'],
    ["marker", "Highlighter", '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>'],
    ["arrow", "Arrow", '<path d="M5 19 19 5"/><path d="M10 5h9v9"/>'],
    ["rect", "Rectangle", '<rect x="4" y="6" width="16" height="12" rx="2"/>'],
    ["ellipse", "Ellipse", '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>'],
    ["text", "Text", '<path d="M5 7V5h14v2"/><path d="M12 5v14"/><path d="M9 19h6"/>'],
    ["eraser", "Eraser", '<path d="M8 20h12"/><path d="M5.2 14.8 14 6a2 2 0 0 1 2.8 0l2.8 2.8a2 2 0 0 1 0 2.8L11.2 20H8.4l-3.2-3.2a1.4 1.4 0 0 1 0-2z"/><path d="m9.5 10.5 5 5"/>'],
  ];
  var COLORS = ["#ff3b30", "#ffd60a", "#34c759", "#0a84ff", "#ffffff"];
  var SIZE = { brush: 6, marker: 24, shape: 4, eraser: 14, text: 24 };
  var pen = { tool: "brush", color: COLORS[0] };
  try {
    var ps = JSON.parse(localStorage.getItem("sight-review:pen"));
    if (ps && TOOLS.some(function(t){ return t[0] === ps.tool; })) pen.tool = ps.tool;
    if (ps && COLORS.indexOf(ps.color) >= 0) pen.color = ps.color;
  } catch (e) {}
  function savePen(){ try { localStorage.setItem("sight-review:pen", JSON.stringify(pen)); } catch (e) {} }
  var penSeen = false;  // a stylus has been used: it draws, fingers only pan / zoom
  // o: {src, vb: [x, y, w, h] doc box the picture covers, base: rows drawn underneath (not
  // editable), items: editable drawings, onDone(items)}.
  function drawSheet(o){
    RC = (typeof globalThis !== "undefined" ? globalThis : window).SightReviewCore;
    if (!RC) throw new Error("review-draw.js needs review-core.js (SightReviewCore)");
    css();
    var NUM = o.numOf || function(){ return ""; };
    var vb = o.vb, items = (o.items || []).map(clone), undo = [], redo = [], cur = null;
    var zc = items.reduce(function(m, it){ return Math.max(m, it.z || 0); }, 0);
    var root = el("div", "draw"), top = el("div", "dtop"), view = el("div", "dview"), box = el("div", "dbox"), bar = el("div", "dbar");
    var img = el("img"); img.src = o.src; img.alt = ""; img.draggable = false;
    var sv = document.createElementNS(SVGNS, "svg"); sv.setAttribute("viewBox", vb.join(" ")); sv.setAttribute("preserveAspectRatio", "none");
    var gBase = document.createElementNS(SVGNS, "g"), gMine = document.createElementNS(SVGNS, "g");
    gBase.innerHTML = RC.svgMarkup(o.base || [], NUM);
    sv.appendChild(gBase); sv.appendChild(gMine);
    box.appendChild(img); box.appendChild(sv); view.appendChild(box);
    function tbtn(title, html, fn){ var b = el("button", "tb"); b.type = "button"; b.title = title; b.setAttribute("aria-label", title); b.innerHTML = html; b.onclick = fn; return b; }
    var cancel = el("button", "btn", "Cancel"); cancel.type = "button";
    cancel.onclick = function(){
      if ((undo.length || (edit && edit.ta.value.trim())) && !confirm("Discard this drawing?")) return;
      if (edit) dropText();
      close(); if (o.onCancel) o.onCancel();
    };
    var ub = tbtn("Undo", ico('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'), doUndo);
    var rb = tbtn("Redo", ico('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'), doRedo);
    var fitB = tbtn("Fit to screen", ico('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'), function(){ fit(); });
    var done = el("button", "btn primary", "Done"); done.type = "button";
    done.onclick = function(){ if (stroke) finish(); if (edit) commitText(); close(); o.onDone(items); };
    [cancel, ub, rb, fitB, el("span", "sp"), done].forEach(function(b){ top.appendChild(b); });
    var tools = el("div"), cols = el("div");
    TOOLS.forEach(function(t){ var b = tbtn(t[1], ico(t[2]), function(){ if (edit) commitText(); pen.tool = t[0]; savePen(); paintBar(); }); b.dataset.t = t[0]; tools.appendChild(b); });
    COLORS.forEach(function(c){
      var b = el("button", "swc"); b.type = "button"; b.title = "Colour"; b.setAttribute("aria-label", "Colour " + c); b.style.background = c; b.dataset.c = c;
      b.onclick = function(){
        pen.color = c; if (pen.tool === "eraser") pen.tool = "brush"; savePen(); paintBar();
        if (edit){ edit.it.data.color = c; edit.ta.style.color = c; edit.ta.focus(); }  // recolours the text being typed
      };
      cols.appendChild(b);
    });
    bar.appendChild(tools); bar.appendChild(cols);
    root.appendChild(top); root.appendChild(view); root.appendChild(bar);
    function paintBar(){
      tools.querySelectorAll(".tb").forEach(function(b){ b.classList.toggle("on", b.dataset.t === pen.tool); });
      cols.querySelectorAll(".swc").forEach(function(b){ b.classList.toggle("on", b.dataset.c === pen.color && pen.tool !== "eraser"); });
      view.style.cursor = pen.tool === "eraser" ? "cell" : "crosshair";
    }
    function paint(){
      var shown = edit ? items.filter(function(it){ return it !== edit.it; }) : items;  // the text being typed shows in its field
      gMine.innerHTML = RC.svgMarkup(cur ? shown.concat([cur]) : shown, NUM);
      ub.disabled = !undo.length; rb.disabled = !redo.length;
    }
    function doUndo(){ if (edit) commitText(); if (stroke || !undo.length) return; redo.push(items); items = undo.pop(); paint(); }
    function doRedo(){ if (edit) commitText(); if (stroke || !redo.length) return; undo.push(items); items = redo.pop(); paint(); }

    // View: the picture fitted into the free area, then zoomed / panned (V, in screen px).
    var V = { z: 1, x: 0, y: 0 };
    function fit(){
      var r = view.getBoundingClientRect(), a = vb[2] / vb[3], pad = 10;
      var w = Math.max(1, r.width - pad * 2), h = Math.max(1, r.height - pad * 2);
      if (w / h > a) w = h * a; else h = w / a;
      box.style.width = w + "px"; box.style.height = h + "px";
      V = { z: 1, x: (r.width - w) / 2, y: (r.height - h) / 2 };
      apply(false);
    }
    function apply(moved){
      box.style.transform = "translate(" + V.x + "px," + V.y + "px) scale(" + V.z + ")"; fitB.hidden = !moved;
      if (edit){ edit.k = vb[2] / box.getBoundingClientRect().width; textField(); }  // the open text field follows the zoom
    }
    var refit = false;  // a resize while typing: fit once the text is done
    function onResize(){ if (edit){ refit = true; return; } if (!stroke && !gest) fit(); }
    function vpos(e){ var r = view.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    function toDoc(e, r){ return [vb[0] + (e.clientX - r.left) / r.width * vb[2], vb[1] + (e.clientY - r.top) / r.height * vb[3]]; }

    // Pointers: one draws (`stroke`), the navigating ones (fingers / middle / right mouse) pan and
    // pinch (`gest`, re-based whenever a finger comes or goes).
    var pts = new Map(), stroke = null, gest = null;
    function gestStart(){
      var ids = [];
      pts.forEach(function(p, id){ if (p.nav) ids.push(id); });
      if (!ids.length){ gest = null; return; }
      var a = pts.get(ids[0]), b = ids.length > 1 ? pts.get(ids[1]) : null;
      gest = { ids: ids.slice(0, 2), v: { z: V.z, x: V.x, y: V.y }, m: b ? [(a.x + b.x) / 2, (a.y + b.y) / 2] : [a.x, a.y], d: b ? RC.hyp(a.x - b.x, a.y - b.y) : 0 };
    }
    function gestMove(){
      var a = pts.get(gest.ids[0]), b = gest.ids.length > 1 ? pts.get(gest.ids[1]) : null;
      if (!a) return;
      var m = b ? [(a.x + b.x) / 2, (a.y + b.y) / 2] : [a.x, a.y];
      var z = b && gest.d > 0 ? RC.clamp(gest.v.z * RC.hyp(a.x - b.x, a.y - b.y) / gest.d, 0.5, 16) : gest.v.z;
      var lx = (gest.m[0] - gest.v.x) / gest.v.z, ly = (gest.m[1] - gest.v.y) / gest.v.z;
      V = { z: z, x: m[0] - lx * z, y: m[1] - ly * z };
      apply(true);
    }
    view.addEventListener("pointerdown", function(e){
      if (edit && e.target === edit.ta) return;  // placing the caret in the text field
      e.preventDefault();
      if (edit){
        // A tap elsewhere ends the typing; that finger (and a second one: a pinch) then only navigates.
        commitText();
        pts.set(e.pointerId, { x: vpos(e)[0], y: vpos(e)[1], nav: true });
        try { view.setPointerCapture(e.pointerId); } catch (_){}
        gestStart();
        return;
      }
      if (e.pointerType === "pen") penSeen = true;
      var p = vpos(e);
      var drawer = e.pointerType === "pen" || (e.pointerType === "mouse" && e.button === 0) || (e.pointerType === "touch" && !penSeen);
      try { view.setPointerCapture(e.pointerId); } catch (_){}
      if (drawer && !stroke && !gest){ pts.set(e.pointerId, { x: p[0], y: p[1], nav: false }); begin(e); return; }
      // A pen wins over a resting palm / finger: their stroke is dropped, their pan stops.
      if (e.pointerType === "pen"){
        if (stroke && stroke.type === "pen") return;
        if (stroke){ var pp = pts.get(stroke.id); abort(); if (pp) pp.nav = true; }
        gest = null;
        pts.set(e.pointerId, { x: p[0], y: p[1], nav: false }); begin(e);
        return;
      }
      // A second finger while one draws: that was the start of a pinch, not a stroke.
      if (stroke && stroke.type === "touch"){ var sp = pts.get(stroke.id); abort(); if (sp) sp.nav = true; }
      if (stroke) return;  // the pen is drawing; fingers wait
      pts.set(e.pointerId, { x: p[0], y: p[1], nav: true });
      gestStart();
    });
    view.addEventListener("pointermove", function(e){
      var q = pts.get(e.pointerId);
      if (!q) return;
      var p = vpos(e); q.x = p[0]; q.y = p[1];
      if (stroke && stroke.id === e.pointerId){ e.preventDefault(); extend(e); return; }
      if (gest && gest.ids.indexOf(e.pointerId) >= 0) gestMove();
    });
    // A cancelled pointer (e.g. a palm the system rejects) drops its stroke instead of keeping it.
    function up(e){
      if (!pts.has(e.pointerId)) return;
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
      var p = vpos(e), z = RC.clamp(V.z * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), 0.5, 16);
      var lx = (p[0] - V.x) / V.z, ly = (p[1] - V.y) / V.z;
      V = { z: z, x: p[0] - lx * z, y: p[1] - ly * z };
      apply(true);
    }, { passive: false });
    view.addEventListener("contextmenu", function(e){ e.preventDefault(); });
    // A focused text field near an edge would scroll the view (where overflow: clip is missing),
    // and every position here assumes it never scrolls.
    view.addEventListener("scroll", function(){ if (view.scrollLeft || view.scrollTop){ view.scrollLeft = 0; view.scrollTop = 0; if (edit) textField(); } });
    root.addEventListener("touchmove", function(e){ e.preventDefault(); }, { passive: false });

    function begin(e){
      var r = box.getBoundingClientRect(), p = toDoc(e, r), k = vb[2] / r.width, t = pen.tool, c = pen.color, isPen = e.pointerType === "pen";
      stroke = { id: e.pointerId, type: e.pointerType, t: t, k: k, x: p[0], y: p[1], sm: p.slice(), last: null };
      if (t === "eraser"){ stroke.before = items; eraseAt(p); return; }
      if (t === "text") return;  // the field opens on release (iOS shows the keyboard only then)
      var d;
      if (t === "brush" || t === "marker"){
        var pr = isPen ? RC.clamp(e.pressure || 0.5, 0, 1) : 0.5;
        d = { color: c, size: RC.r2(SIZE[t] * k), opacity: t === "marker" ? 0.4 : 1, pressure: true, pen: isPen, pts: [RC.r2(p[0]), RC.r2(p[1]), RC.r2(pr)] };
        cur = { kind: "stroke", shape_kind: t, z: ++zc, data: d };
      } else if (t === "arrow"){
        d = { color: c, width: RC.r2(SIZE.shape * k), opacity: 1, dash: "solid", head0: "none", head1: "triangle", body: "straight", headSize: 1, pts: [p[0], p[1], p[0], p[1]] };
        cur = { kind: "shape", shape_kind: "arrow", z: ++zc, data: d };
      } else {
        d = { color: c, strokeOn: true, width: RC.r2(SIZE.shape * k), dash: "solid", fillOn: false, fill: c, fillOpacity: 0.2, radius: 0, opacity: 1, x: p[0], y: p[1], w: 0, h: 0, rot: 0 };
        cur = { kind: "shape", shape_kind: t, z: ++zc, data: d };
      }
      d.created = Date.now();
      paint();
    }
    function extend(e){
      var S0 = stroke, r = box.getBoundingClientRect();
      if (S0.t === "eraser"){ eraseAt(toDoc(e, r)); return; }
      if (S0.t === "text") return;
      if (!cur) return;
      var d = cur.data;
      if (S0.t === "brush" || S0.t === "marker"){
        var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
        if (!evs.length) evs = [e];
        evs.forEach(function(ce){
          var q = toDoc(ce, r), a = 1 - 0.5 * 0.82;  // smoothing as Sight's brush default
          S0.sm = [S0.sm[0] + (q[0] - S0.sm[0]) * a, S0.sm[1] + (q[1] - S0.sm[1]) * a];
          var n = d.pts.length;
          if (RC.hyp(S0.sm[0] - d.pts[n - 3], S0.sm[1] - d.pts[n - 2]) < 0.75 * S0.k) return;
          d.pts.push(RC.r2(S0.sm[0]), RC.r2(S0.sm[1]), RC.r2(d.pen ? RC.clamp(ce.pressure || 0, 0, 1) : 0.5));
        });
        var l = toDoc(e, r);
        S0.last = [l[0], l[1], d.pen ? RC.clamp(e.pressure || 0, 0, 1) : 0.5];
      } else {
        var p = toDoc(e, r);
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
    function abort(){
      if (stroke && stroke.t === "eraser") items = stroke.before;
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
    // (white-ish on a dark box); the size is SIZE.text screen px at the current zoom.
    var edit = null;
    function textField(){
      var d = edit.it.data, k = edit.k, r = box.getBoundingClientRect(), vr = view.getBoundingClientRect();
      var L = RC.textLayout(Object.assign({}, d, { text: edit.ta.value || " " }));
      var pad = d.size * 0.3 / k, ta = edit.ta;
      ta.style.font = RC.textFont(Object.assign({}, d, { size: d.size / k }));
      ta.style.lineHeight = "1.25";
      ta.style.color = d.color;
      ta.style.padding = pad + "px";
      ta.style.left = (r.left - vr.left + (d.x - vb[0]) / k - pad - 1) + "px";
      ta.style.top = (r.top - vr.top + (d.y - vb[1]) / k - pad - 1) + "px";
      ta.style.width = Math.ceil(L.w / k + d.size / k * 0.6) + "px";
      ta.style.height = Math.ceil(L.h / k) + "px";
    }
    function openText(S0){
      var k = S0.k, tol = 4 * k, hit = null;
      for (var i = items.length - 1; i >= 0; i--){ if (RC.typeOf(items[i]) === "text" && RC.hitTest(items[i], S0.x, S0.y, tol)){ hit = items[i]; break; } }
      var it = hit || { kind: "text", shape_kind: null, z: ++zc, data: { text: "", x: RC.r2(S0.x), y: RC.r2(S0.y - SIZE.text * k * 0.6), font: "sans", size: RC.r2(SIZE.text * k),
        color: pen.color, bold: false, italic: false, underline: false, align: "left", bgOn: true, bg: "#000000", bgOpacity: 0.6, outline: 0, outlineColor: "#000000", opacity: 1, rot: 0, created: Date.now() } };
      var ta = el("textarea", "dtext");
      ta.value = it.data.text || ""; ta.rows = 1; ta.spellcheck = false; ta.setAttribute("autocapitalize", "sentences");
      edit = { it: it, isNew: !hit, before: hit ? clone(hit.data) : null, ta: ta, k: hit ? vb[2] / box.getBoundingClientRect().width : k };
      ta.oninput = textField;
      view.appendChild(ta);
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
    function afterText(){ view.scrollLeft = 0; view.scrollTop = 0; if (refit){ refit = false; fit(); } }
    function onKey(e){
      var mod = e.ctrlKey || e.metaKey;
      if (edit){  // typing: the field keeps its own keys (Enter = new line, Ctrl+Z = its undo); Esc ends it
        if (e.key === "Escape" && !mod && !e.altKey && !e.shiftKey && !e.isComposing){ commitText(); e.preventDefault(); e.stopPropagation(); }
        return;
      }
      if (e.key === "Escape" && !mod && !e.altKey && !e.shiftKey) cancel.onclick();
      else if (mod && !e.altKey && (e.key === "z" || e.key === "Z")){ if (e.shiftKey) doRedo(); else doUndo(); }
      else if (mod && !e.altKey && !e.shiftKey && e.key === "y") doRedo();
      else return;
      e.preventDefault(); e.stopPropagation();
    }
    function close(){
      root.remove(); document.body.classList.remove("rd-open");
      document.removeEventListener("keydown", onKey, true); window.removeEventListener("resize", onResize);
    }
    document.body.appendChild(root); document.body.classList.add("rd-open");
    document.addEventListener("keydown", onKey, true); window.addEventListener("resize", onResize);
    paintBar(); paint(); fit();
  }

  return { open: drawSheet, TOOLS: TOOLS, COLORS: COLORS, SIZE: SIZE };
})();
if (typeof globalThis !== "undefined") globalThis.SightReviewDraw = SightReviewDraw;
