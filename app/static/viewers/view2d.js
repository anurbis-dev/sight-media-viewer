// The 2D viewer core shared by the image and video viewers (viewers/viewer.js has the interface): the picture's
// element, its doc box, zoom / pan / fit through viewer-input.js, the view's turn / mirror, the thumbnail placeholder
// and fade-in of a picture. The video's own parts (seeking, the scrub copy, the transport) are viewers/video.js.
//
// host (the frame; Sight's lightbox in index.html):
//   ctl()            the frame's state object while this viewer may claim it (Sight: `light`, or null once closed).
//                    The viewer writes its controls there (video, setZoom, fit, vctl, turn, mirror, mirrorV,
//                    guideGeom) and reads the transport state (scrubbing, scrubT, seq, seqDrag) — as before R0b.
//   annot            the annotator (viewChanged, bind, restoreTool, abortGesture, snapTime through scrubSnap)
//   theme()          the zoom settings (viewer-input.js zoomSettings)
//   thumbSrc(a)      the placeholder picture shown while a picture loads
//   loadTurn(id) / saveTurn(id, t)   the view's turn / mirror per file
//   rotHeld() / takeRotTool()        R held (a drag turns the view); the tool R replaced (handed back, cleared)
//   video hooks: see viewers/video.js
import { attachViewerInput } from "../viewer-input.js";
import { setCursor } from "../cursors.js";

export function mount2d(stage, a, src, opts, host, makeVideo){
  const L = () => host.ctl();
  const annot = host.annot;
  // Guides follow this picture only. The embedded UV pane must not replace the lightbox geom.
  if (L() && !opts.embedded) L().guideGeom = null;
  const isVid = a.kind === "video";
  // Images open on their thumbnail (.view-ph), already framed, and the full file stays hidden
  // (.loading) until it is loaded and decoded — otherwise a big file paints top-down at native size
  // before the fit kicks in. A full image already in the memory cache (a probe Image reports it
  // complete synchronously) is drawn straight away, with no thumbnail and no fade.
  let cached = false;
  if (!isVid && src){
    const probe = new Image();
    probe.src = src;
    cached = probe.complete && probe.naturalWidth > 0;
  }
  const ph = isVid || cached || opts.embedded ? "" : host.thumbSrc(a);
  stage.innerHTML = `<div class="view" id="view">${ph ? `<img class="view-ph" alt="" decoding="sync" src="${ph}" draggable="false" />` : ""}<${isVid ? "video" : "img"} class="view-media${isVid || cached ? "" : " loading"}" ${isVid ? 'autoplay playsinline preload="auto"' : `alt="" ${cached ? 'decoding="sync" ' : ""}src="${src}"`} draggable="false" /><div class="view-hud" id="viewHud"></div></div>`;
  const wrap = stage.querySelector(".view");
  wrap.classList.toggle("vid", isVid);
  // Sequence: the next clip was preloaded in a hidden <video> (seqPreload); it takes the new element's place
  // in this same task, so it never leaves the document and keeps its decoded first frame — a seamless cut.
  if (isVid && opts.adopt){
    const ad = opts.adopt;
    ad.className = "view-media"; ad.removeAttribute("style"); ad.draggable = false;
    // `<video … />` is not self-closing in HTML: the HUD after it was parsed as its child — keep it with the element.
    const made = stage.querySelector(".view-media");
    while (made.firstChild) ad.appendChild(made.firstChild);
    made.replaceWith(ad);
  }
  const el = stage.querySelector(".view-media");
  // A sequence jump that lands paused (frame step, scrub) must not start playing before it is placed.
  if (isVid && !opts.adopt && L()?.seq?.pendPlay === false) el.autoplay = false;
  let phEl = stage.querySelector(".view-ph");
  const hud = stage.querySelector(".view-hud");
  // The doc box: the host's native size when it gives one (opts.docSize: a scaled rendition is drawn into it),
  // else the asset's size until the decoded element reports its own (onReady).
  const fixedDoc = !!(opts.docSize && opts.docSize.w > 0 && opts.docSize.h > 0);
  const vs = { scale: 1, pan: { x: 0, y: 0 }, nat: fixedDoc ? { w: opts.docSize.w, h: opts.docSize.h } : { w: a.width || 0, h: a.height || 0 }, mode: "fit" };
  // Turn / mirror about the picture's own centre C (the window's centre moved by the pan), in front of the
  // picture's translate + scale. Pan and zoom are screen moves of C, so a panned picture turns in place.
  const turn = opts.embedded ? { rot: 0, mir: false, mirV: false } : host.loadTurn(a.id);
  // (the drawings' layer takes this same transform from geom().turn, and unturn is its exact inverse:
  // screen = C + R(rot)·S(mir, mirV)·(p − C), so p = C + S·R(−rot)·(screen − C))
  const pivot = () => [wrap.clientWidth / 2 + vs.pan.x, wrap.clientHeight / 2 + vs.pan.y];
  function turnCss(){
    if (!turn.rot && !turn.mir && !turn.mirV) return "";
    const [cx, cy] = pivot();
    return `translate(${cx}px,${cy}px) rotate(${turn.rot}deg) scale(${turn.mir ? -1 : 1},${turn.mirV ? -1 : 1}) translate(${-cx}px,${-cy}px) `;
  }
  function unturn(x, y){
    if (!turn.rot && !turn.mir && !turn.mirV) return [x, y];
    const [cx, cy] = pivot(), r = -turn.rot * Math.PI / 180;
    const dx = x - cx, dy = y - cy;
    let ux = dx * Math.cos(r) - dy * Math.sin(r);
    let uy = dx * Math.sin(r) + dy * Math.cos(r);
    if (turn.mir) ux = -ux;
    if (turn.mirV) uy = -uy;
    return [cx + ux, cy + uy];
  }
  const paintMirBtns = () => {
    L()?.el.querySelector("#mirBtn")?.classList.toggle("on", turn.mir);
    L()?.el.querySelector("#mirVBtn")?.classList.toggle("on", turn.mirV);
  };
  function setTurn(t){
    turn.rot = ((t.rot % 360) + 360) % 360; turn.mir = !!t.mir; turn.mirV = !!t.mirV;
    host.saveTurn(a.id, turn);
    if (vs.mode === "fit") toFit(); else apply();
    paintMirBtns();
  }
  const vid = isVid ? makeVideo({ el, wrap, a, opts, host, L, apply: () => apply() }) : null;
  if (L() && !opts.embedded){
    const lt = L();
    lt.video = isVid ? el : null; lt.setZoom = (n) => toScale(n); lt.fit = () => toFit();
    lt.vctl = isVid ? vid.transport : null;
    if (isVid && !opts.adopt){ host.vApplySnd(el); host.vApplyLoop(el); } else if (isVid) host.vApplyLoop(el);
    lt.turn = () => setTurn({ ...turn, rot: turn.rot + 90 });
    lt.mirror = () => setTurn({ ...turn, mir: !turn.mir });
    lt.mirrorV = () => setTurn({ ...turn, mirV: !turn.mirV });
    paintMirBtns();
  }
  vid?.listenEarly();
  function fitS(){
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!vs.nat.w || !w) return 1;
    // The picture's bounding box after a turn of any angle (for 90° it is the swapped box, as before).
    const th = turn.rot * Math.PI / 180, c = Math.abs(Math.cos(th)), s = Math.abs(Math.sin(th));
    return Math.min(w / (vs.nat.w * c + vs.nat.h * s), h / (vs.nat.w * s + vs.nat.h * c));
  }
  function geom(){
    const w = wrap.clientWidth, h = wrap.clientHeight;
    return { x0: (w - vs.nat.w * vs.scale) / 2 + vs.pan.x, y0: (h - vs.nat.h * vs.scale) / 2 + vs.pan.y, s: vs.scale, w: vs.nat.w, h: vs.nat.h, turn: turnCss() };
  }
  function apply(){
    const w = wrap.clientWidth, h = wrap.clientHeight;
    const x = (w - vs.nat.w * vs.scale) / 2 + vs.pan.x;
    const y = (h - vs.nat.h * vs.scale) / 2 + vs.pan.y;
    el.style.width = vs.nat.w + "px";
    el.style.height = vs.nat.h + "px";
    el.style.transform = `${turnCss()}translate(${x}px,${y}px) scale(${vs.scale})`;
    if (phEl){
      phEl.style.width = el.style.width;
      phEl.style.height = el.style.height;
      phEl.style.transform = el.style.transform;
    }
    vid?.follow(el.style); // the scrub copy over a video takes the same geometry
    // Same icon/pixel-art heuristic as thumbnails: only go crisp once we're actually magnifying
    // a small source past its native pixels, so ordinary photos keep smooth upscaling.
    if (!isVid) el.classList.toggle("pixelated", vs.scale > 1.001 && vs.nat.w > 0 && (vs.nat.w <= 768 || vs.nat.h <= 768));
    const f = fitS();
    hud.textContent = Math.abs(vs.scale - f) < 0.012 ? "Frame" : Math.abs(vs.scale - 1) < 0.012 ? "100%" : Math.round(vs.scale * 100) + "%";
    if (!opts.embedded) annot.viewChanged();
    // Guides (guides.js) stick to this picture: same geom the drawings use, including turnCss.
    if (L() && !opts.embedded){ L().guideGeom = geom; L().onGuideView?.(); }
  }
  // Zoom toward a screen point (mx,my, relative to `wrap`) instead of the viewport center —
  // keeps whatever content is under the cursor/anchor fixed in place as scale changes.
  function zoomAt(newScale, mx, my){
    newScale = Math.min(16, Math.max(0.05, newScale));
    // screen = C + scale·M·(q − centre) for a picture pixel q (M = the turn), so keeping q under (mx, my)
    // only moves C toward the point: C' = m − k·(m − C), turned or not.
    const [cx, cy] = pivot(), k = newScale / vs.scale;
    vs.scale = newScale;
    vs.pan.x = mx - k * (mx - cx) - wrap.clientWidth / 2;
    vs.pan.y = my - k * (my - cy) - wrap.clientHeight / 2;
    vs.mode = "free";
    apply();
  }
  function toFit(){
    vs.scale = fitS();
    vs.pan = { x: 0, y: 0 };
    vs.mode = "fit";
    apply();
  }
  function toOne(){
    toScale(1);
  }
  // Digit keys 1–9 in the lightbox jump straight to that multiple of native size (1 = 100%).
  function toScale(n){
    vs.scale = n;
    vs.pan = { x: 0, y: 0 };
    vs.mode = n === 1 ? "one" : "free";
    apply();
  }
  function openMode(){
    // A wrap not laid out yet (embedded pane) cannot tell fit from 100 %: the size observer picks once
    // the wrap gets its size ("open" = still to choose).
    if (!wrap.clientWidth || !wrap.clientHeight){ vs.mode = "open"; return; }
    const f = fitS();
    if (f < 0.999) toFit();
    else toOne();
  }
  function onReady(){
    const nw = isVid ? el.videoWidth : el.naturalWidth;
    const nh = isVid ? el.videoHeight : el.naturalHeight;
    if (nw && nh && !fixedDoc) vs.nat = { w: nw, h: nh };
    openMode();
    if (isVid) vid.onReady();
    else reveal();
  }
  // Fade the full image in over the thumbnail once it is decoded; the thumbnail stays fully opaque
  // underneath and is simply removed once the fade is over. (Cross-fading both dipped to the dark
  // backdrop mid-way, visible when flipping through images quickly.) Runs once; later loads (PSD
  // layer swaps) only re-fit.
  function reveal(){
    if (!el.classList.contains("loading")) return;
    const show = () => {
      if (!el.isConnected || !el.classList.contains("loading")) return;
      el.classList.add("reveal");
      el.classList.remove("loading");
      if (!phEl) return;
      const old = phEl;
      setTimeout(() => { old.remove(); if (phEl === old) phEl = null; }, 300);
    };
    (el.decode ? el.decode() : Promise.resolve()).then(show, show);
  }
  // Frame the placeholder right away. Without stored dimensions, borrow the thumbnail's aspect
  // until the full image reports its real size.
  if (!isVid){
    if (vs.nat.w && vs.nat.h){ if (wrap.clientWidth) openMode(); }
    else if (phEl) phEl.addEventListener("load", () => {
      if (!el.classList.contains("loading") || !phEl) return;
      vs.nat = { w: phEl.naturalWidth, h: phEl.naturalHeight };
      toFit();
    }, { once: true });
    // A file that fails to load keeps its thumbnail; with no thumbnail, show the broken image.
    el.addEventListener("error", () => { if (!phEl) el.classList.remove("loading"); });
  }
  el.addEventListener(isVid ? "loadedmetadata" : "load", onReady);
  if ((isVid && el.readyState >= 1) || (!isVid && el.complete && el.naturalWidth)) onReady();
  // Keep the picture framed when the viewport changes underneath it (window resize, or the
  // lightbox mask / corner-radius popover reshaping the frame, the library split from Tab). Only a
  // real size change counts: the initial observation is skipped by comparing with the size at attach —
  // not by dropping the first callback, which already carries the new size when Tab is pressed before
  // the observer's first delivery (the picture then stayed fitted to the old width).
  let seenW = wrap.clientWidth, seenH = wrap.clientHeight;
  new ResizeObserver(() => {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h){ seenW = seenH = 0; return; }  // closing / hidden: whatever size it comes back at is reframed
    if (w === seenW && h === seenH) return;
    seenW = w; seenH = h;
    if (!vs.nat.w || !vs.nat.h) return;  // size unknown yet: onReady / the thumbnail's load frames it
    if (vs.mode === "open") openMode(); else if (vs.mode === "fit") toFit(); else apply();
  }).observe(wrap);
  vid?.wire();
  // Pointer input (viewer-input.js, the same module as Compare): a click on a video plays / pauses (held 250 ms,
  // so a double-click — frame / 100 % — does not toggle), a left drag scrubs a video (the window's width is the
  // clip, Shift a tenth; a sequence hands the drag to seqScrubBegin) and pans a picture, middle drag pans,
  // right drag / wheel zoom, two fingers pinch-zoom and pan. A drag with R held turns a picture or a video about
  // its centre, to any angle (rotHeld, the key tracker near the keyup handler); Shift snaps the angle to absolute
  // 15° steps. On a video Alt-drag scrubs too (Ctrl held: snapped to the annotated frames, scrubSnap). Alt over a
  // drawing tool hands the press to the viewer (annotate.js altCam), so while annotating R + Alt-drag turns.
  stage._vinput?.destroy(); // (the viewer this stage held before: its window listeners, a held click)
  const input = attachViewerInput(wrap, {
    claim: (e) => {
      if (!(e.button === 0 && host.rotHeld() && !(e.ctrlKey || e.metaKey))) return null;
      if (!opts.embedded){ const rt = host.takeRotTool(); if (rt) annot.restoreTool(rt); } // (R picked the rectangle tool)
      const r = wrap.getBoundingClientRect(), [px, py] = pivot(), cx = r.left + px, cy = r.top + py; // the picture's centre
      const d = { a0: Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI, rot0: turn.rot };
      return {
        cursor: "rotate",
        move: (ev) => {
          let delta = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI - d.a0;
          delta = ((delta + 540) % 360) - 180; // -180 … 180: the way the pointer went round
          let rot = d.rot0 + delta;
          if (ev.shiftKey) rot = Math.round(rot / 15) * 15;
          turn.rot = ((rot % 360) + 360) % 360;
          if (vs.mode === "fit") toFit(); else apply();
        },
        end: () => {
          if (!opts.embedded) host.saveTurn(a.id, turn); // kept once the drag ends
        },
      };
    },
    click: isVid ? () => { if (!el.isConnected) return; if (el.paused) el.play(); else el.pause(); } : null,
    dblclick: (e) => { e.preventDefault(); if (vs.mode === "fit") toOne(); else toFit(); },
    scrub: isVid ? vid.dragScrub : null,
    pan: (dx, dy) => {
      vs.pan = { x: vs.pan.x + dx, y: vs.pan.y + dy }; // (a screen move of the picture's centre, turned or not)
      vs.mode = "free";
      apply();
    },
    zoom: (f, x, y) => {
      const r = wrap.getBoundingClientRect();
      zoomAt(vs.scale * f, x - r.left, y - r.top);
    },
    zoomSettings: () => host.theme(),
    // (the gesture cursors — grabbing, zoom-in / -out, ew-resize, the Alt turn — are viewer-input.js's, cursors.js)
    // A second finger: a stroke the first one began is dropped (the pinch never leaves a mark).
    abortOthers: () => { if (L() && !opts.embedded){ annot.abortGesture(); L().seqDrag?.end(); } },
  });
  stage._vinput = input;
  setCursor(wrap, "base", isVid ? null : "grab"); // a picture: a left drag pans (a video: it scrubs)
  wrap.addEventListener("contextmenu", (e) => e.preventDefault());
  wrap.addEventListener("auxclick", (e) => { if (e.button === 1) e.preventDefault(); });
  const viewer = {
    kind: isVid ? "video" : "image",
    asset: a,
    surface: wrap,
    media: el,
    docBox: () => ({ w: vs.nat.w, h: vs.nat.h }),
    geom,
    unturn,
    place: () => (isVid ? { t: el.currentTime || 0 } : {}),
    goTo: (p) => {
      if (!isVid || !p || !Number.isFinite(p.t)) return;
      el.pause();
      const dur = Number.isFinite(el.duration) ? el.duration : 0;
      el.currentTime = dur ? Math.min(dur, Math.max(0, p.t)) : Math.max(0, p.t);
    },
    capture: (maxW) => {
      const w = vs.nat.w, h = vs.nat.h;
      if (!w || !h) return null;
      const k = maxW > 0 ? Math.min(1, maxW / w) : 1;
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
      try { c.getContext("2d").drawImage(el, 0, 0, c.width, c.height); } catch { return null; }
      return c;
    },
    fit: toFit,
    zoom: toScale,
    transport: isVid ? vid.transport : null,
    destroy: () => input.destroy(),
  };
  // Annotations draw over this picture (its listeners go in first, in the capture phase, so a
  // drawing gesture never reaches the pan / scrub / play handlers above; the input's second-finger
  // hook is a capture listener on the same element, added before, so a pinch still aborts a stroke).
  if (L() && !opts.embedded) annot.bind(viewer);
  return viewer;
}
