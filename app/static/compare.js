// Version compare: several images / videos (usually versions of one shot) side by side or stacked.
//
// Layouts: "swipe" — every visible layer stacked in one view, cut into regions by N-1 draggable
// split lines (each layer shows in its own region); "grid" (tiles), "row" (horizontal strip),
// "col" (vertical strip) — one cell per layer. Pan / zoom are shared by every cell.
// Blend: "over" — layers are drawn as they are; "difference" — each layer is drawn with
// mix-blend-mode: difference over the reference layer (★), so identical pixels go black.
// Video: one timeline for all layers. Each layer has a start offset in frames (where its first
// frame sits on the timeline), so clips that start or run differently can be lined up. Playback
// runs on one clock that waits for the slowest clip: a clip still seeking / buffering holds the clock
// (every clip pauses on its frame) until all can play, then they start together; small drift is
// nudged with playbackRate. One decoder per clip: the reference's copies under Difference tiles are
// canvases painted from its video. The server keeps a RAM window around each clip's playhead
// (/api/video/focus items — the budget split between the clips).
//
// createCompare(host) — host: { api, putSetting, openInLight(id), versionsOf(id), and for annotating:
// onView(view) — the selected layer's viewer after every rebuild / selection (view: {asset, wrap, media, isVid,
// geom, unturn} or null), onPlaced() — pan / zoom / splits moved, onClose(), onAnnotButton() }.
// open(ids, focusId, session) / close() / isOpen() / onKey(e) (true when the key was used) / session() — the
// set to store with a note (FORMAT.md `compare`) / pause() / seekLayer(id, t) — the selected clip's local time.

import { hotkey, runHotkeys } from "/static/keys.js";
import { convertForPlayback } from "/static/video-playable.js";

const COLORS = ["#4c9aff", "#ff9f0a", "#34c759", "#ff453a", "#af52de", "#32ade6", "#ffd60a", "#ff6482"];
const LAYOUTS = [["swipe", "Swipe", "Digit1"], ["grid", "Tile", "Digit2"], ["row", "Row", "Digit3"], ["col", "Column", "Digit4"]];
const PREF_KEY = "sight.compare";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isVideo = (a) => a.kind === "video";
const mediaSrc = (a) => (a.ext === ".psd" ? `/api/psd/${a.id}/preview` : `/api/file/${a.id}`);
export const comparable = (a) => !!a && a.status !== "missing" && (a.kind === "image" || a.kind === "video" || a.ext === ".psd");

function fmtT(t, fps){
  const neg = t < 0;
  t = Math.abs(t);
  const m = Math.floor(t / 60), s = Math.floor(t % 60), f = Math.floor((t % 1) * fps + 1e-6);
  return `${neg ? "-" : ""}${m}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}

// A short message for places that have no toast of their own (the library grid).
let flashEl = null, flashT = 0;
export function flash(text, ms = 2400){
  if (!flashEl){
    injectStyles();
    flashEl = document.createElement("div");
    flashEl.className = "cmp-toast";
    document.body.appendChild(flashEl);
  }
  flashEl.textContent = text;
  flashEl.classList.add("on");
  clearTimeout(flashT);
  flashT = setTimeout(() => flashEl.classList.remove("on"), ms);
}

export function createCompare(host){
  injectStyles();
  let P = { layout: "swipe", blend: "over", dir: "x", loop: true };
  try { P = { ...P, ...(JSON.parse(localStorage.getItem(PREF_KEY)) || {}) }; } catch {}
  // A comparison opened from a note shows the look it was made with (C.pBase = the preferences before it);
  // only what is changed here is saved, and the rest goes back when it closes.
  const prefsToSave = () => {
    if (!C?.pBase) return { ...P };
    const out = { ...P };
    for (const k of ["layout", "blend", "dir"]) if (!C.userSet.has(k)) out[k] = C.pBase[k];
    return out;
  };
  const savePrefs = () => { try { host.putSetting(PREF_KEY, JSON.stringify(prefsToSave())); } catch {} };
  let C = null; // the open session

  // ---- open / close ----------------------------------------------------------------------------
  // session (optional): a comparison stored with a note — {ids, ref, sel, layout, blend, dir, starts: {id: frames}}.
  async function open(ids, focusId, session){
    const assets = [];
    for (const id of ids){
      let a = host.assetById?.(id);
      if (!a){ try { a = await host.api(`/api/assets/${id}`); } catch { a = null; } }
      if (comparable(a) && !assets.some((x) => x.id === a.id)) assets.push(a);
    }
    if (assets.length < 1) return false;
    if (session && assets.length < 2) return false; // a stored comparison with one file left is no comparison
    if (C) close();
    const el = document.createElement("div");
    el.className = "cmp";
    el.innerHTML = `
      <div class="cmp-bar">
        <b>Compare</b>
        <div class="cmp-seg" data-g="layout">${LAYOUTS.map(([k, n], i) => `<button type="button" data-v="${k}" title="${n} (${i + 1})">${n}</button>`).join("")}</div>
        <div class="cmp-seg" data-g="blend"><button type="button" data-v="over" title="Layers as they are (D toggles)">Over</button><button type="button" data-v="difference" title="Difference against the reference ★ — equal pixels go black (D)">Difference</button></div>
        <button type="button" class="cmp-b" data-a="dir" title="Split direction (V)"></button>
        <button type="button" class="cmp-b" data-a="fit" title="Fit (F) · wheel zooms · right / middle drag pans">Fit</button>
        <button type="button" class="cmp-b cmp-annb" data-a="annot" title="Annotate the selected layer (A) — notes go to its file and remember this comparison">✎ Annotate</button>
        <span class="cmp-hint">Drag splits · [ ] shift layer · ↑↓ layer · R reference · H hide · A annotate · Space play · , . frame · Esc</span>
        <button type="button" class="cmp-b" data-a="close" title="Close (Esc)">✕</button>
      </div>
      <div class="cmp-stage"></div>
      <div class="cmp-foot">
        <div class="cmp-tl" hidden>
          <button type="button" class="cmp-b" data-a="start" title="To start (Home)">⏮</button>
          <button type="button" class="cmp-b" data-a="prev" title="Previous frame (,)">‹</button>
          <button type="button" class="cmp-b cmp-play" data-a="play" title="Play / pause (Space)">▶</button>
          <button type="button" class="cmp-b" data-a="next" title="Next frame (.)">›</button>
          <button type="button" class="cmp-b" data-a="loop" title="Loop (L)">⟲</button>
          <span class="cmp-time"></span>
          <div class="cmp-track"><div class="cmp-spans"></div><i class="cmp-head"></i></div>
        </div>
        <div class="cmp-layers"></div>
      </div>
      <div class="cmp-menu" hidden></div>
      <div class="cmp-toast"></div>`;
    document.body.appendChild(el);
    C = {
      el, stage: el.querySelector(".cmp-stage"), layers: [], ref: null, sel: null, sound: null, splits: [],
      view: { zoom: 1, cx: 0.5, cy: 0.5 }, T: 0, playing: false, last: 0, fps: 25, raf: 0, drag: null,
      candidates: [], built: "",
    };
    host.onOpen?.(el); // (the annotator mounts on the overlay before the first rebuild reports a viewer)
    assets.forEach((a) => addLayer(a));
    const focus = C.layers.find((l) => l.a.id === focusId) || C.layers[0];
    C.ref = focus.a.id; C.sel = focus.a.id; C.sound = focus.a.id;
    if (session){
      C.pBase = { ...P }; C.userSet = new Set();
      if (layer(session.ref)) C.ref = session.ref;
      if (layer(session.sel)) C.sel = C.sound = session.sel;
      for (const l of C.layers){ const f = Number(session.starts?.[l.id]); if (Number.isFinite(f)) l.start = Math.round(f); }
      if (LAYOUTS.some(([k]) => k === session.layout)) P = { ...P, layout: session.layout };
      if (session.blend === "over" || session.blend === "difference") P = { ...P, blend: session.blend };
      if (session.dir === "x" || session.dir === "y") P = { ...P, dir: session.dir };
    }
    bindUi();
    build();
    requestAnimationFrame(() => el.classList.add("on"));
    C.raf = requestAnimationFrame(tick);
    C.fpsReady = loadFps();
    loadCandidates(focus.a.id);
    // The panel opening / closing (annotating) or anything else that resizes the stage re-places the media.
    C.ro = new ResizeObserver(() => place());
    C.ro.observe(C.stage);
    return true;
  }
  function close(){
    if (!C) return;
    host.onClose?.();
    C.ro?.disconnect();
    if (C.pBase) P = prefsToSave();
    cancelAnimationFrame(C.raf);
    if (C.onResize) window.removeEventListener("resize", C.onResize);
    for (const l of C.layers) for (const m of l.media) releaseMedia(m);
    C.el.remove();
    C = null;
  }
  function releaseMedia(m){
    if (m.tagName === "VIDEO"){ try { m.pause(); m.removeAttribute("src"); m.load(); } catch {} }
  }
  function addLayer(a){
    const used = new Set(C.layers.map((l) => l.color));
    const color = COLORS.find((c) => !used.has(c)) || COLORS[C.layers.length % COLORS.length];
    C.layers.push({ a, id: a.id, color, vis: true, start: 0, media: [], dur: isVideo(a) ? a.duration || 0 : 0, nw: a.width || 0, nh: a.height || 0 });
  }
  async function loadFps(){
    const v = C.layers.find((l) => isVideo(l.a));
    if (!v) return;
    try {
      const info = await host.api(`/api/assets/${v.a.id}/info`);
      for (const sec of info.sections || []) for (const row of sec.rows || []){
        if (/frame rate/i.test(row[0] || "")){ const f = parseFloat(row[1]); if (C && f > 0) C.fps = f; }
      }
    } catch {}
    paintTime();
  }
  // Versions of the focused asset that are not in the compare yet — the "+ Add" menu.
  async function loadCandidates(id){
    let list = [];
    try { list = (await host.versionsOf?.(id)) || []; } catch {}
    if (!C) return;
    C.candidates = list.filter(comparable);
    paintLayers();
  }

  // ---- layout ----------------------------------------------------------------------------------
  const visible = () => C.layers.filter((l) => l.vis);
  const refLayer = () => C.layers.find((l) => l.id === C.ref) || C.layers[0];
  function resetSplits(){
    const n = visible().length;
    C.splits = Array.from({ length: Math.max(0, n - 1) }, (_, i) => (i + 1) / n);
  }
  function mkMedia(l, primary, mirror){
    const a = l.a;
    let m;
    if (mirror){
      // A copy of a clip that already has a <video> on the stage: painted from it every frame (paintMirrors), so
      // the clip is decoded once and the copy can never drift from it.
      m = document.createElement("canvas");
      m.width = m.height = 0;
    } else if (isVideo(a)){
      m = document.createElement("video");
      m.preload = "auto";
      m.playsInline = true;
      m.muted = !(primary && C.sound === l.id);
      m.loop = false;
      m.src = mediaSrc(a);
      m.addEventListener("loadedmetadata", () => {
        if (!C) return;
        C.focusDirty = true;
        if (primary){ l.nw = m.videoWidth || l.nw; l.nh = m.videoHeight || l.nh; if (Number.isFinite(m.duration)) l.dur = m.duration; }
        else if (Number.isFinite(m.duration) && !l.media.some((x) => x._primary)) l.dur = m.duration; // (a hidden ★'s copy)
        place(); paintTimeline();
      });
      // No picture from the file itself (a codec the browser cannot decode): play the server's copy.
      let asked = false;
      const fallback = async () => {
        if (asked || !C) return;
        asked = true;
        const res = await convertForPlayback(a.id, null, () => !!C);
        if (res.ok && C) m.src = `/api/file/${a.id}?copy=${Date.now()}`;
      };
      m.addEventListener("error", fallback);
      m.addEventListener("loadedmetadata", () => { if (!m.videoWidth) fallback(); });
    } else {
      m = document.createElement("img");
      m.decoding = "async";
      m.src = mediaSrc(a);
      m.addEventListener("load", () => { if (!C) return; if (primary){ l.nw = m.naturalWidth || l.nw; l.nh = m.naturalHeight || l.nh; } place(); });
    }
    m.className = "cmp-m";
    m.draggable = false;
    m._layer = l;
    m._primary = primary;
    l.media.push(m);
    return m;
  }
  // Rebuilds the stage DOM (layout, visibility, reference or blend changed). Media elements are
  // recreated, so video positions are restored from the shared clock on the next tick.
  function build(){
    for (const l of C.layers){ for (const m of l.media) releaseMedia(m); l.media = []; }
    const st = C.stage;
    st.innerHTML = "";
    st.className = "cmp-stage " + P.layout;
    const vis = visible(), ref = refLayer(), diff = P.blend === "difference";
    if (!vis.length){ st.innerHTML = `<div class="cmp-empty">All layers are hidden</div>`; paintAll(); return; }
    if (P.layout === "swipe"){
      if (C.splits.length !== vis.length - 1) resetSplits();
      const box = document.createElement("div");
      box.className = "cmp-box";
      st.appendChild(box);
      // The reference sits underneath, whole; the others are cut to their regions on top of it.
      const base = document.createElement("div");
      base.className = "cmp-ly base";
      base.appendChild(mkMedia(ref, true));
      box.appendChild(base);
      vis.forEach((l, i) => {
        if (l === ref) return;
        const w = document.createElement("div");
        w.className = "cmp-ly";
        w.dataset.i = String(i);
        if (diff) w.style.mixBlendMode = "difference";
        w.appendChild(mkMedia(l, true));
        box.appendChild(w);
      });
      vis.forEach((l, i) => {
        const lb = document.createElement("div");
        lb.className = "cmp-lbl";
        lb.dataset.i = String(i);
        lb.innerHTML = `<i style="background:${l.color}"></i>${esc(l.a.name)}${l === ref ? " ★" : ""}`;
        box.appendChild(lb);
      });
      C.splits.forEach((p, i) => {
        const h = document.createElement("div");
        h.className = "cmp-split";
        h.dataset.k = String(i);
        h.innerHTML = "<b></b>";
        box.appendChild(h);
      });
    } else {
      const n = vis.length;
      // The reference's copies under the other cells: a canvas painted from its video when the reference has a
      // cell of its own (or one copy already decodes it), so it is decoded once.
      const refCopy = () => mkMedia(ref, false, isVideo(ref.a) && (vis.includes(ref) || ref.media.some((m) => m.tagName === "VIDEO")));
      let cols = n, rows = 1;
      if (P.layout === "col"){ cols = 1; rows = n; }
      else if (P.layout === "grid"){ cols = Math.ceil(Math.sqrt(n)); rows = Math.ceil(n / cols); }
      st.style.setProperty("--cols", cols);
      st.style.setProperty("--rows", rows);
      for (const l of vis){
        const cell = document.createElement("div");
        cell.className = "cmp-cell" + (l.id === C.sel ? " sel" : "");
        cell.dataset.id = l.id;
        if (diff && l !== ref){
          const b = document.createElement("div");
          b.className = "cmp-ly base";
          b.appendChild(refCopy());
          cell.appendChild(b);
        }
        const w = document.createElement("div");
        w.className = "cmp-ly";
        if (diff && l !== ref) w.style.mixBlendMode = "difference";
        w.appendChild(mkMedia(l, true));
        cell.appendChild(w);
        const lb = document.createElement("div");
        lb.className = "cmp-lbl";
        lb.innerHTML = `<i style="background:${l.color}"></i>${esc(l.a.name)}${l === ref ? " ★" : ""}`;
        cell.appendChild(lb);
        st.appendChild(cell);
      }
    }
    C.syncNow = true;
    place();
    paintAll();
    reportView();
  }
  // The selected layer's viewer for the annotator: the box it is drawn in (swipe: the whole box — a drawing
  // anywhere maps into the selected layer's picture), its media element and its geometry (object-fit: contain
  // inside the element's box, so a layer of another shape is placed as it is shown).
  function reportView(){
    if (!host.onView) return;
    const l = layer(C.sel);
    let wrap = null, media = null;
    if (l && l.vis){
      if (P.layout === "swipe"){
        wrap = C.stage.querySelector(".cmp-box");
        media = l.media.find((m) => m._primary && wrap?.contains(m)) || null;
      } else {
        wrap = [...C.stage.querySelectorAll(".cmp-cell")].find((c) => c.dataset.id === l.id) || null;
        media = l.media.find((m) => m._primary && wrap?.contains(m)) || null;
      }
    }
    C.viewWrap = wrap;
    if (!wrap || !media){ host.onView(null); return; }
    const geom = () => {
      const x = parseFloat(media.style.left) || 0, y = parseFloat(media.style.top) || 0;
      const w = parseFloat(media.style.width) || 1, h = parseFloat(media.style.height) || 1;
      const nw = l.nw || w, nh = l.nh || h, s = Math.min(w / nw, h / nh);
      return { x0: x + (w - nw * s) / 2, y0: y + (h - nh * s) / 2, s, w: nw, h: nh, turn: "" };
    };
    host.onView({ asset: l.a, wrap, media, isVid: isVideo(l.a), geom, unturn: (x, y) => [x, y] });
  }
  // Positions every media element (shared zoom / pan, reference size) and the swipe regions.
  function place(){
    if (!C) return;
    const ref = refLayer();
    const rw = ref.nw || 1600, rh = ref.nh || 900;
    const boxes = P.layout === "swipe" ? [...C.stage.querySelectorAll(".cmp-box")] : [...C.stage.querySelectorAll(".cmp-cell")];
    for (const box of boxes){
      const W = box.clientWidth, H = box.clientHeight;
      const s = Math.min(W / rw, H / rh) * C.view.zoom;
      const w = rw * s, h = rh * s;
      const x = W / 2 - C.view.cx * w, y = H / 2 - C.view.cy * h;
      for (const m of box.querySelectorAll(".cmp-m")) Object.assign(m.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" });
    }
    host.onPlaced?.();
    if (P.layout !== "swipe") return;
    const box = boxes[0];
    if (!box) return;
    const edges = [0, ...C.splits, 1], horiz = P.dir === "x";
    for (const w of box.querySelectorAll(".cmp-ly[data-i]")){
      const i = Number(w.dataset.i), a = edges[i] * 100, b = (1 - edges[i + 1]) * 100;
      w.style.clipPath = horiz ? `inset(0 ${b}% 0 ${a}%)` : `inset(${a}% 0 ${b}% 0)`;
    }
    for (const lb of box.querySelectorAll(".cmp-lbl")){
      const i = Number(lb.dataset.i);
      if (horiz){ lb.style.left = `calc(${edges[i] * 100}% + 10px)`; lb.style.top = "10px"; lb.style.maxWidth = `calc(${(edges[i + 1] - edges[i]) * 100}% - 20px)`; }
      else { lb.style.left = "10px"; lb.style.top = `calc(${edges[i] * 100}% + 10px)`; lb.style.maxWidth = ""; }
      lb.hidden = edges[i + 1] - edges[i] < 0.02;
    }
    for (const h of box.querySelectorAll(".cmp-split")){
      const p = C.splits[Number(h.dataset.k)] * 100;
      h.className = "cmp-split " + (horiz ? "x" : "y");
      h.style.left = horiz ? p + "%" : "0";
      h.style.top = horiz ? "0" : p + "%";
    }
  }

  // ---- time ------------------------------------------------------------------------------------
  const vids = () => C.layers.filter((l) => isVideo(l.a));
  function range(){
    const v = vids().filter((l) => l.vis);
    if (!v.length) return [0, 0];
    const lo = Math.min(...v.map((l) => l.start / C.fps));
    const hi = Math.max(...v.map((l) => l.start / C.fps + (l.dur || 0)));
    return [lo, Math.max(lo, hi)];
  }
  const snapT = (t) => Math.round(t * C.fps) / C.fps;
  function setT(t, keepPlaying){
    const [lo, hi] = range();
    C.T = clamp(t, lo, Math.max(lo, hi - 1 / C.fps));
    if (!keepPlaying){ C.playing = false; C.T = snapT(C.T); }
    C.syncNow = true;
    C.focusDirty = true;
    paintTime();
  }
  function step(n){ setT(snapT(C.T) + n / C.fps); }
  function togglePlay(){
    if (!vids().length) return;
    const [lo, hi] = range();
    if (!C.playing && C.T >= hi - 1.5 / C.fps) C.T = lo;
    C.playing = !C.playing;
    C.last = performance.now();
    if (!C.playing) C.T = snapT(C.T);
    C.wait = false;
    C.syncNow = true;
    C.focusDirty = true;
    paintTime();
  }
  function tick(now){
    if (!C) return;
    C.raf = requestAnimationFrame(tick);
    // The clock stands while a clip is still seeking / buffering (C.wait) or the playhead is being dragged.
    if (C.playing && !C.wait && !C.scrub){
      const dt = Math.min(0.25, (now - C.last) / 1000);
      C.T += dt;
      const [lo, hi] = range();
      if (C.T >= hi){
        if (P.loop) C.T = lo;
        else { C.T = snapT(hi - 1 / C.fps); C.playing = false; }
        C.syncNow = true;
      }
      paintTime(true);
    }
    C.last = now;
    syncVideos(now);
    paintMirrors();
    pushFocus(now);
  }
  // Keeps every video element on the shared clock. Playing: a clip that is seeking, buffering or more than
  // 0.3 s off holds the clock — the others pause on their frame — and a far-off one is seeked to the clock,
  // which does not move meanwhile, so the seek lands where the others wait. (Seeking towards a clock that
  // ran on was the desync: a 4K / long-GOP clip took longer to seek than the 0.25 s it was allowed to lag,
  // landed behind again and was seeked again, forever.) When every clip can play they start together;
  // small drift is corrected with playbackRate. Paused or scrubbing: each shows exactly the playhead's frame.
  function canGo(m, l, local){
    if (m.readyState >= 3) return true; // HAVE_FUTURE_DATA
    if (m.readyState < 2 || !m.paused) return false;
    const t = m.currentTime, need = Math.min(0.4, Math.max(0, (l.dur || Infinity) - local - 0.05));
    const b = m.buffered;
    for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 1e-3 && b.end(i) >= t + need) return true;
    return false;
  }
  function syncVideos(now){
    const force = C.syncNow;
    C.syncNow = false;
    const run = C.playing && !C.scrub;
    let waiting = false;
    for (const l of C.layers){
      if (!isVideo(l.a)) continue;
      const local = C.T - l.start / C.fps;
      const inside = local >= -1e-4 && (!l.dur || local < l.dur);
      for (const m of l.media){
        m.parentElement?.classList.toggle("out", !inside);
        if (m.tagName !== "VIDEO") continue;
        if (!inside){ if (!m.paused) m.pause(); continue; }
        // (no metadata yet — still loading, converting for playback or broken: nothing to wait for; it joins
        // with a seek once it can)
        if (m.readyState < 1 || m.error) continue;
        if (!run){
          m._low = 0;
          if (!m.paused) m.pause();
          const want = local + 0.1 / C.fps;
          if ((force || Math.abs(m.currentTime - want) > 0.45 / C.fps) && !m.seeking) m.currentTime = want;
          continue;
        }
        // A seek in flight: wait for it to land, never restart it — unless it has hung for 8 s (an overloaded
        // decoder can drop one): asked again. (Sooner would restart honest slow seeks: 4K, long GOP.)
        if (m.seeking){
          waiting = true;
          m._low = 0; // (the held-without-data timer starts when the seek has landed)
          m._stuck = m._stuck || now;
          if (now - m._stuck > 8000){ m._stuck = now; m.currentTime = local; }
          continue;
        }
        m._stuck = 0;
        const d = m.currentTime - local;
        if (force || Math.abs(d) > 0.3){
          if (Math.abs(d) > 0.5 / C.fps){ m.currentTime = local; m._low = 0; waiting = true; }
          m.playbackRate = 1;
          if (waiting) continue;
        }
        // At its own end (a clip running a little ahead, or one a hair shorter than its listed length): it stays
        // on its last frame — play() would restart it from 0 — and holds nobody.
        if (m.ended || (Number.isFinite(m.duration) && m.currentTime >= m.duration - 1e-3)){ m._low = 0; continue; }
        // Not enough data to go on: held, unless it is a momentary dip while playing (< 150 ms). A paused clip is
        // ready with its frame decoded and 0.4 s buffered ahead (or up to its end): a paused element need not
        // report "future data" (Chromium can stay at HAVE_CURRENT_DATA until it plays).
        if (!canGo(m, l, local)){
          m._low = m._low || now;
          if (!m.paused){ if (now - m._low > 150) waiting = true; }
          else {
            waiting = true;
            // Held on a frame that does not fill up (a paused element may stop loading / decoding): a seek to
            // the clock restarts its pipeline.
            if (now - m._low > 1500){ m._low = now; m.currentTime = local; }
          }
          continue;
        }
        m._low = 0;
        if (C.wait){ if (!m.paused) m.pause(); continue; } // ready: waits for the others
        m.playbackRate = clamp(1 - d * 2, 0.85, 1.15);
        if (m.paused) m.play().catch(() => {});
      }
    }
    const was = !!C.wait;
    if (!run) C.wait = false;
    else if (waiting && !was){
      C.wait = true;
      for (const l of C.layers) for (const m of l.media) if (m.tagName === "VIDEO" && !m.paused) m.pause();
    } else if (!waiting && was){
      C.wait = false; // every clip can play: they start together on the next frame
      C.last = now;
    }
    if (was !== !!C.wait) paintTime();
  }
  // The copies (canvases) take their clip's current picture.
  function paintMirrors(){
    for (const l of C.layers){
      if (!isVideo(l.a)) continue;
      let src = null;
      for (const m of l.media){
        if (m.tagName !== "CANVAS") continue;
        src = src || l.media.find((x) => x.tagName === "VIDEO" && x.readyState >= 2 && x.videoWidth);
        if (!src || src.seeking) continue; // (mid-seek, currentTime already reads the target over the old frame)
        const k = `${src.currentTime}|${src.videoWidth}x${src.videoHeight}`;
        if (m._k === k) continue;
        m._k = k;
        const s = Math.min(1, 4096 / src.videoWidth); // (full size: Difference against a softened copy would show edges)
        const w = Math.max(1, Math.round(src.videoWidth * s)), h = Math.max(1, Math.round(src.videoHeight * s));
        if (m.width !== w || m.height !== h){ m.width = w; m.height = h; }
        try { m.getContext("2d").drawImage(src, 0, 0, w, h); } catch {}
      }
    }
  }
  // Tell the server where every clip's playhead is, so its RAM window (split between the clips) follows them:
  // about once a second while playing, soon after a jump.
  function pushFocus(now){
    const v = vids().filter((l) => l.dur > 0 && l.media.some((m) => m.tagName === "VIDEO")); // (a hidden ★ can decode under tiles)
    if (!v.length) return;
    const due = C.focusDirty ? 150 : C.playing ? 1000 : Infinity;
    if (now - (C.focusAt || 0) < due) return;
    C.focusAt = now;
    C.focusDirty = false;
    const body = { items: v.map((l) => ({ id: l.id, t: clamp(C.T - l.start / C.fps, 0, l.dur), duration: l.dur })) };
    const mb = host.cacheMb?.(), ahead = host.cacheAhead?.();
    if (mb) body.mb = mb;
    if (ahead) body.ahead = ahead;
    fetch("/api/video/focus", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
  }

  // ---- painting --------------------------------------------------------------------------------
  function paintAll(){ paintBar(); paintLayers(); paintTimeline(); }
  function paintBar(){
    const el = C.el;
    el.querySelectorAll(".cmp-seg[data-g=layout] button").forEach((b) => b.classList.toggle("on", b.dataset.v === P.layout));
    el.querySelectorAll(".cmp-seg[data-g=blend] button").forEach((b) => b.classList.toggle("on", b.dataset.v === P.blend));
    const dir = el.querySelector("[data-a=dir]");
    dir.hidden = P.layout !== "swipe";
    dir.textContent = P.dir === "x" ? "⇹ Side by side" : "⇳ Top / bottom";
  }
  function paintLayers(){
    const box = C.el.querySelector(".cmp-layers");
    const ref = refLayer();
    const more = C.candidates.filter((a) => !C.layers.some((l) => l.id === a.id));
    box.innerHTML = C.layers.map((l) => {
      const v = isVideo(l.a);
      return `<div class="cmp-chip${l.id === C.sel ? " sel" : ""}${l.vis ? "" : " off"}" data-id="${l.id}" draggable="true" title="${esc(l.a.path || l.a.name)}">
        <i class="cmp-dot" style="background:${l.color}"></i>
        <span class="cmp-nm">${esc(l.a.name)}</span>
        <button type="button" data-a="ref" class="${l === ref ? "on" : ""}" title="${l === ref ? "Reference" : "Make reference (R)"} — the base the others are compared against">${l === ref ? "★" : "☆"}</button>
        <button type="button" data-a="vis" title="${l.vis ? "Hide (H)" : "Show (H)"}">${l.vis ? "◉" : "○"}</button>
        ${v ? `<span class="cmp-off" title="Where this clip's first frame sits on the timeline — [ ] (Shift ×10), drag or click to type"><button type="button" data-a="om">−</button><em data-a="ov">${l.start > 0 ? "+" : ""}${l.start}f</em><button type="button" data-a="op">+</button></span>
          <button type="button" data-a="snd" class="${C.sound === l.id ? "on" : ""}" title="${C.sound === l.id ? "Sound from this clip" : "Play this clip's sound"}">${C.sound === l.id ? "🔊" : "🔈"}</button>` : ""}
        <button type="button" data-a="lb" title="Open in the viewer">⤢</button>
        <button type="button" data-a="rm" title="Remove from compare">×</button>
      </div>`;
    }).join("") + (more.length ? `<button type="button" class="cmp-b cmp-addb" data-a="add" title="Add another version">+ Add</button>` : "");
  }
  function paintTimeline(){
    const tl = C.el.querySelector(".cmp-tl");
    const v = vids();
    tl.hidden = !v.length;
    if (!v.length) return;
    const [lo, hi] = range(), span = Math.max(1e-6, hi - lo);
    C.el.querySelector(".cmp-spans").innerHTML = v.filter((l) => l.vis).map((l) => {
      const a = (l.start / C.fps - lo) / span * 100, w = (l.dur || 0) / span * 100;
      return `<i style="left:${a}%;width:${w}%;background:${l.color}" title="${esc(l.a.name)}"></i>`;
    }).join("");
    C.el.querySelector("[data-a=loop]").classList.toggle("on", P.loop);
    paintTime();
  }
  function paintTime(fast){
    if (!C) return;
    const [lo, hi] = range(), span = Math.max(1e-6, hi - lo);
    const head = C.el.querySelector(".cmp-head");
    if (head) head.style.left = ((C.T - lo) / span * 100) + "%";
    const t = C.el.querySelector(".cmp-time");
    if (t) t.textContent = `${fmtT(C.T, C.fps)}  ·  f ${Math.round(C.T * C.fps)}${C.wait ? "  ·  loading" : ""}`;
    if (fast) return;
    C.el.querySelector(".cmp-play").textContent = C.playing ? "❚❚" : "▶";
  }
  let toastT = 0;
  function toast(text){
    const el = C?.el.querySelector(".cmp-toast");
    if (!el) return;
    el.textContent = text;
    el.classList.add("on");
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove("on"), 1600);
  }

  // ---- layer operations ------------------------------------------------------------------------
  const layer = (id) => C.layers.find((l) => l.id === id);
  function shift(id, n){
    const l = layer(id);
    if (!l || !isVideo(l.a)){ toast("Offsets are for video layers"); return; }
    l.start += n;
    C.syncNow = true;
    paintLayers(); paintTimeline();
  }
  function setRef(id){ if (!layer(id)) return; C.ref = id; build(); }
  function toggleVis(id){
    const l = layer(id);
    if (!l) return;
    if (l.vis && visible().length === 1){ toast("At least one layer stays visible"); return; }
    l.vis = !l.vis;
    resetSplits();
    build();
  }
  function remove(id){
    if (C.layers.length <= 1){ close(); return; }
    for (const m of layer(id)?.media || []) releaseMedia(m);
    C.layers = C.layers.filter((l) => l.id !== id);
    if (C.ref === id) C.ref = C.layers[0].id;
    if (C.sel === id) C.sel = C.ref;
    if (C.sound === id) C.sound = C.ref;
    if (!visible().length) C.layers[0].vis = true;
    resetSplits();
    build();
  }
  function setSound(id){
    C.sound = C.sound === id ? null : id;
    for (const l of C.layers) for (const m of l.media) if (m.tagName === "VIDEO") m.muted = !(m._primary && l.id === C.sound);
    paintLayers();
  }
  function select(id){
    const changed = C.sel !== id;
    C.sel = id;
    C.stage.querySelectorAll(".cmp-cell").forEach((c) => c.classList.toggle("sel", c.dataset.id === id));
    paintLayers();
    if (changed) reportView();
  }
  function selectStep(d){
    const i = C.layers.findIndex((l) => l.id === C.sel);
    const n = C.layers[(i + d + C.layers.length) % C.layers.length];
    if (n) select(n.id);
  }
  function moveLayer(id, beforeId){
    const from = C.layers.findIndex((l) => l.id === id);
    if (from < 0 || id === beforeId) return;
    const [l] = C.layers.splice(from, 1);
    const to = beforeId ? C.layers.findIndex((x) => x.id === beforeId) : -1;
    if (to < 0) C.layers.push(l); else C.layers.splice(to, 0, l);
    build();
  }
  function setPref(k, v){
    P[k] = v;
    C?.userSet?.add(k);
    savePrefs();
    if (k === "loop"){ paintTimeline(); return; }
    if (k === "dir"){ paintBar(); place(); return; }
    build();
  }
  function fit(){ C.view = { zoom: 1, cx: 0.5, cy: 0.5 }; place(); }
  function editOffset(id, em){
    const l = layer(id);
    if (!l) return;
    const inp = document.createElement("input");
    inp.className = "cmp-offin";
    inp.value = String(l.start);
    em.replaceWith(inp);
    inp.focus(); inp.select();
    let ended = false;
    const done = (ok) => {
      if (ended || !inp.isConnected) return;
      ended = true;
      const n = parseInt(inp.value, 10);
      if (ok && Number.isFinite(n)){ l.start = n; C.syncNow = true; }
      paintLayers(); paintTimeline();
    };
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (hotkey(e, "Enter")){ e.preventDefault(); done(true); }
      else if (hotkey(e, "Escape")){ e.preventDefault(); done(false); }
    });
    inp.addEventListener("blur", () => done(true));
  }
  function showAddMenu(btn){
    const menu = C.el.querySelector(".cmp-menu");
    const more = C.candidates.filter((a) => !C.layers.some((l) => l.id === a.id));
    if (!more.length){ menu.hidden = true; return; }
    menu.innerHTML = more.map((a) => `<button type="button" data-id="${a.id}">${esc(a.name)}</button>`).join("");
    const r = btn.getBoundingClientRect();
    menu.style.left = r.left + "px";
    menu.style.bottom = (innerHeight - r.top + 6) + "px";
    menu.hidden = false;
  }

  // ---- input -----------------------------------------------------------------------------------
  function bindUi(){
    const el = C.el;
    el.querySelector(".cmp-bar").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const g = b.closest(".cmp-seg")?.dataset.g;
      if (g){ setPref(g, b.dataset.v); return; }
      const a = b.dataset.a;
      if (a === "close") close();
      else if (a === "annot") host.onAnnotButton?.();
      else if (a === "fit") fit();
      else if (a === "dir") setPref("dir", P.dir === "x" ? "y" : "x");
    });
    el.querySelector(".cmp-tl").addEventListener("click", (e) => {
      const a = e.target.closest("button")?.dataset.a;
      if (a === "play") togglePlay();
      else if (a === "prev") step(-1);
      else if (a === "next") step(1);
      else if (a === "start") setT(range()[0]);
      else if (a === "loop") setPref("loop", !P.loop);
    });
    const track = el.querySelector(".cmp-track");
    // Scrubbing (mouse, finger or pen): every clip shows the playhead's frame while it moves; playback that was
    // running goes on from where it is let go, all clips together (the clock holds until each has landed there).
    track.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || C.scrub) return;
      track.setPointerCapture(e.pointerId);
      C.scrub = { pid: e.pointerId };
      const scrub = (ev) => {
        if (!C || ev.pointerId !== C.scrub?.pid) return;
        const r = track.getBoundingClientRect(), [lo, hi] = range();
        setT(lo + clamp((ev.clientX - r.left) / r.width, 0, 1) * (hi - lo), true);
        C.T = snapT(C.T);
      };
      const end = (ev) => {
        if (!C || ev.pointerId !== C.scrub?.pid) return;
        C.scrub = null;
        track.onpointermove = track.onpointerup = track.onpointercancel = track.onlostpointercapture = null;
        C.wait = false;
        C.last = performance.now();
        C.syncNow = true;
        paintTime();
      };
      scrub(e);
      track.onpointermove = scrub;
      track.onpointerup = track.onpointercancel = track.onlostpointercapture = end;
    });
    const layers = el.querySelector(".cmp-layers");
    layers.addEventListener("click", (e) => {
      const b = e.target.closest("button, em");
      const chip = e.target.closest(".cmp-chip");
      if (b?.dataset.a === "add"){ showAddMenu(b); return; }
      if (!chip) return;
      const id = chip.dataset.id, a = b?.dataset.a;
      if (a === "ref") setRef(id);
      else if (a === "vis") toggleVis(id);
      else if (a === "om") shift(id, e.shiftKey ? -10 : -1);
      else if (a === "op") shift(id, e.shiftKey ? 10 : 1);
      else if (a === "ov") editOffset(id, b);
      else if (a === "snd") setSound(id);
      else if (a === "lb"){ const l = layer(id); close(); host.openInLight?.(l.a); }
      else if (a === "rm") remove(id);
      else select(id);
    });
    layers.addEventListener("dragstart", (e) => {
      const chip = e.target.closest(".cmp-chip");
      if (!chip) return;
      e.dataTransfer.setData("text/x-cmp", chip.dataset.id);
      e.dataTransfer.effectAllowed = "move";
    });
    layers.addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("text/x-cmp")) e.preventDefault(); });
    layers.addEventListener("drop", (e) => {
      const id = e.dataTransfer.getData("text/x-cmp");
      if (!id) return;
      e.preventDefault();
      const chip = e.target.closest(".cmp-chip");
      let before = chip?.dataset.id || null;
      if (chip){
        const r = chip.getBoundingClientRect();
        if (e.clientX > r.left + r.width / 2){
          const i = C.layers.findIndex((l) => l.id === before);
          before = C.layers[i + 1]?.id || null;
          if (before === id) before = C.layers[i + 2]?.id || null;
        }
      }
      moveLayer(id, before);
    });
    // Touch / pen: hold a chip (400 ms), then drag it to its new place — the same reorder as the mouse's drag and
    // drop (which stays the browser's: chips are draggable only under a mouse).
    let hold = null, heldAt = -1e9;
    const dropAt = (x, y, id) => {
      const over = document.elementFromPoint(x, y)?.closest(".cmp-chip");
      if (!over || over.dataset.id === id) return { over: null, before: undefined };
      const r = over.getBoundingClientRect(), after = x > r.left + r.width / 2;
      const i = C.layers.findIndex((l) => l.id === over.dataset.id);
      let before = after ? C.layers[i + 1]?.id || null : over.dataset.id;
      if (before === id) before = C.layers[i + 2]?.id || null;
      return { over, after, before };
    };
    const clearMarks = () => layers.querySelectorAll(".cmp-chip.dnd-b, .cmp-chip.dnd-a, .cmp-chip.lift").forEach((c) => c.classList.remove("dnd-b", "dnd-a", "lift"));
    layers.addEventListener("pointerdown", (e) => {
      const chip = e.target.closest(".cmp-chip");
      if (!chip) return;
      chip.draggable = e.pointerType === "mouse";
      if (e.pointerType === "mouse" || hold) return;
      const h = { id: chip.dataset.id, pid: e.pointerId, x: e.clientX, y: e.clientY, on: false, chip };
      h.timer = setTimeout(() => {
        if (hold !== h || !C) return;
        h.on = true;
        try { layers.setPointerCapture(h.pid); } catch {}
        chip.classList.add("lift");
        navigator.vibrate?.(15);
      }, 400);
      hold = h;
    });
    layers.addEventListener("pointermove", (e) => {
      const h = hold;
      if (!h || e.pointerId !== h.pid) return;
      if (!h.on){ if (Math.hypot(e.clientX - h.x, e.clientY - h.y) > 10){ clearTimeout(h.timer); hold = null; } return; }
      e.preventDefault();
      layers.querySelectorAll(".cmp-chip.dnd-b, .cmp-chip.dnd-a").forEach((c) => c.classList.remove("dnd-b", "dnd-a"));
      const d = dropAt(e.clientX, e.clientY, h.id);
      d.over?.classList.add(d.after ? "dnd-a" : "dnd-b");
    });
    const endHold = (e) => {
      const h = hold;
      if (!h || e.pointerId !== h.pid) return;
      clearTimeout(h.timer);
      hold = null;
      if (!h.on) return;
      heldAt = performance.now();
      clearMarks();
      // (the click that follows the release must not also select / toggle what is under the finger)
      const eat = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      layers.addEventListener("click", eat, { capture: true, once: true });
      setTimeout(() => layers.removeEventListener("click", eat, { capture: true }), 400);
      if (e.type === "pointerup"){ const d = dropAt(e.clientX, e.clientY, h.id); if (d.before !== undefined) moveLayer(h.id, d.before); }
    };
    layers.addEventListener("pointerup", endHold);
    layers.addEventListener("pointercancel", endHold);
    // (a long press is ours — Windows touch sends its press-and-hold menu after the release)
    layers.addEventListener("contextmenu", (e) => { if (hold || performance.now() - heldAt < 800) e.preventDefault(); });
    const menu = el.querySelector(".cmp-menu");
    menu.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-id]");
      menu.hidden = true;
      const a = b && C.candidates.find((x) => x.id === b.dataset.id);
      if (!a) return;
      addLayer(a);
      resetSplits();
      build();
      loadFps();
    });
    el.addEventListener("pointerdown", (e) => { if (!menu.hidden && !e.target.closest(".cmp-menu, [data-a=add]")) menu.hidden = true; }, true);
    const st = C.stage;
    st.addEventListener("pointerdown", onDown);
    st.addEventListener("pointermove", onMove);
    st.addEventListener("pointerup", onUp);
    st.addEventListener("pointercancel", onUp);
    st.addEventListener("contextmenu", (e) => e.preventDefault());
    st.addEventListener("dblclick", () => fit());
    st.addEventListener("wheel", onWheel, { passive: false });
    C.onResize = () => place();
    window.addEventListener("resize", C.onResize);
  }
  function boxOf(e){ return e.target.closest(".cmp-box, .cmp-cell"); }
  // While annotating (the annotator asks first, host.passThrough): in swipe a mouse moves a split with Alt held
  // (as Alt scrubs a video in the viewer), a finger or pen moves the split it lands on — drawing is skipped then.
  function wantsPress(e){
    if (!C || P.layout !== "swipe" || !C.splits.length || e.button !== 0) return false;
    if (e.altKey) return true;
    if (e.pointerType !== "touch" && e.pointerType !== "pen") return false;
    const box = C.stage.querySelector(".cmp-box");
    if (!box) return false;
    const r = box.getBoundingClientRect(), horiz = P.dir === "x";
    const px = horiz ? e.clientX - r.left : e.clientY - r.top, span = horiz ? r.width : r.height;
    return C.splits.some((p) => Math.abs(p * span - px) <= 24);
  }
  function onDown(e){
    const box = boxOf(e);
    if (!box) return;
    if (box.classList.contains("cmp-cell")) select(box.dataset.id);
    // (Alt+left pans in swipe, except while annotating: there Alt+left moves a split, see wantsPress.)
    const altPan = e.altKey && !host.annotating?.();
    const pan = e.button === 1 || e.button === 2 || (e.button === 0 && (P.layout !== "swipe" || altPan || !C.splits.length));
    if (!pan && e.button !== 0) return;
    e.preventDefault();
    C.stage.setPointerCapture(e.pointerId);
    if (pan){
      C.drag = { kind: "pan", x: e.clientX, y: e.clientY, cx: C.view.cx, cy: C.view.cy, box, pid: e.pointerId };
      return;
    }
    // Swipe: grab the split nearest to the pointer and move it there.
    const r = box.getBoundingClientRect(), horiz = P.dir === "x";
    const f = horiz ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height;
    let k = 0, best = Infinity;
    C.splits.forEach((p, i) => { const d = Math.abs(p - f); if (d < best){ best = d; k = i; } });
    C.drag = { kind: "split", k, box, pid: e.pointerId }; // (only this pointer moves it: a pen drawing meanwhile must not)
    moveSplit(e);
  }
  function moveSplit(e){
    const { k, box } = C.drag, r = box.getBoundingClientRect(), horiz = P.dir === "x";
    const f = horiz ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height;
    const lo = k ? C.splits[k - 1] : 0, hi = k < C.splits.length - 1 ? C.splits[k + 1] : 1;
    C.splits[k] = clamp(f, lo, hi);
    place();
  }
  function onMove(e){
    const d = C?.drag;
    if (!d || e.pointerId !== d.pid) return;
    if (d.kind === "split"){ moveSplit(e); return; }
    const ref = refLayer(), W = d.box.clientWidth, H = d.box.clientHeight;
    const rw = ref.nw || 1600, rh = ref.nh || 900, s = Math.min(W / rw, H / rh) * C.view.zoom;
    C.view.cx = d.cx - (e.clientX - d.x) / (rw * s);
    C.view.cy = d.cy - (e.clientY - d.y) / (rh * s);
    place();
  }
  function onUp(e){ if (C && (!C.drag || e.pointerId === C.drag.pid)) C.drag = null; }
  function onWheel(e){
    const box = boxOf(e);
    if (!box) return;
    e.preventDefault();
    const ref = refLayer(), r = box.getBoundingClientRect(), W = r.width, H = r.height;
    const rw = ref.nw || 1600, rh = ref.nh || 900;
    const s0 = Math.min(W / rw, H / rh), w0 = rw * s0 * C.view.zoom, h0 = rh * s0 * C.view.zoom;
    const mx = e.clientX - r.left - W / 2, my = e.clientY - r.top - H / 2;
    const u = C.view.cx + mx / w0, v = C.view.cy + my / h0;
    // The viewer-wide zoom settings (Speed, Invert) as the other viewers use them; the axis is not
    // a wheel setting, so the wheel is the same for both drag axes.
    const zs = host.getZoomSettings?.() || {};
    const z = clamp(C.view.zoom * Math.exp((zs.zoomInvert ? e.deltaY : -e.deltaY) * 0.0016 * (zs.zoomSpeed ?? 1)), 0.1, 64);
    C.view.zoom = z;
    C.view.cx = u - mx / (rw * s0 * z);
    C.view.cy = v - my / (rh * s0 * z);
    place();
  }
  // 100 % of the reference's own pixels.
  function actual(){
    const ref = refLayer(), box = C.stage.querySelector(".cmp-box, .cmp-cell");
    if (!box || !ref.nw) return;
    C.view.zoom = 1 / Math.min(box.clientWidth / ref.nw, box.clientHeight / ref.nh);
    place();
  }

  function onKey(e){
    if (!C) return false;
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return true;
    runHotkeys(e, [
      ["Escape", () => close()], ["KeyK", () => close()],
      ["Space", () => { if (!e.repeat) togglePlay(); }],
      ["Comma", () => step(-1)], ["Period", () => step(1)], ["ArrowLeft", () => step(-1)], ["ArrowRight", () => step(1)],
      ["Shift+Comma", () => step(-10)], ["Shift+Period", () => step(10)], ["Shift+ArrowLeft", () => step(-10)], ["Shift+ArrowRight", () => step(10)],
      ["Home", () => setT(range()[0])], ["End", () => setT(range()[1])],
      ["BracketLeft", () => shift(C.sel, -1)], ["BracketRight", () => shift(C.sel, 1)],
      ["Shift+BracketLeft", () => shift(C.sel, -10)], ["Shift+BracketRight", () => shift(C.sel, 10)],
      ["ArrowUp", () => selectStep(-1)], ["ArrowDown", () => selectStep(1)],
      ...LAYOUTS.map(([k, , combo]) => [combo, () => setPref("layout", k)]),
      ["KeyD", () => setPref("blend", P.blend === "difference" ? "over" : "difference")],
      ["KeyV", () => { if (P.layout === "swipe") setPref("dir", P.dir === "x" ? "y" : "x"); }],
      ["KeyF", () => fit()], ["Digit0", () => actual()],
      ["KeyH", () => toggleVis(C.sel)], ["KeyR", () => setRef(C.sel)],
      ["KeyL", () => setPref("loop", !P.loop)],
    ]);
    // Everything else stays inside the compare view (the library / lightbox keys underneath
    // must not fire while it is on top), except the command palette.
    return !hotkey(e, "Ctrl+KeyK");
  }

  // What a note made here remembers (FORMAT.md `compare`): the files, their order, reference, selected layer,
  // look and each clip's offset.
  function session(){
    if (!C) return null;
    const starts = {};
    for (const l of C.layers) if (isVideo(l.a) && l.start) starts[l.id] = l.start;
    return { ids: C.layers.map((l) => l.id), ref: C.ref, sel: C.sel, layout: P.layout, blend: P.blend, dir: P.dir, starts };
  }
  // The annotator stops: on the frame the selected clip is showing (its drawing is stored at that element
  // time), not the clock's snapped / drifted one.
  function pause(){
    if (!C || !C.playing) return;
    C.playing = false;
    const l = layer(C.sel), m = l && isVideo(l.a) ? l.media.find((x) => x._primary) : null;
    // (minus the 0.1 frame syncVideos adds back, so a stop late in a frame does not move on to the next one)
    if (m && m.readyState >= 1 && !m.parentElement?.classList.contains("out")) C.T = l.start / C.fps + Math.max(0, m.currentTime - 0.1 / C.fps);
    else C.T = snapT(C.T);
    C.wait = false;
    C.syncNow = true;
    C.focusDirty = true;
    paintTime();
  }
  // The annotator moves the selected clip to its local time t (a note's frame, a frame step): the shared clock
  // follows, unsnapped (the clip's own frame grid can differ from compare's fps). Not clamped while the clips'
  // lengths are still unknown (a comparison just opened from a note).
  function seekLayer(id, t){
    const l = C && layer(id);
    if (!l) return;
    const T = t + (isVideo(l.a) ? l.start / C.fps : 0);
    const [lo, hi] = range();
    C.playing = false;
    C.T = hi > lo ? clamp(T, lo, hi - 1e-3) : T; // (exactly at the end the clip counts as out and dims)
    C.syncNow = true;
    C.focusDirty = true;
    paintTime();
  }
  function relayout(){ if (C) requestAnimationFrame(() => place()); }
  // The view on screen as a picture, for the annotator's screenshot: every visible layer where and how it is
  // shown (swipe regions, tiles, Difference, dimmed clips outside their span), split lines and name labels.
  // Swipe: the box; tiles: the whole stage. ox / oy: the annotated surface's place in it (CSS px).
  function captureView(dpr){
    if (!C) return null;
    const root = P.layout === "swipe" ? C.stage.querySelector(".cmp-box") : C.stage;
    if (!root) return null;
    const R = root.getBoundingClientRect();
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(R.width * dpr)); cv.height = Math.max(1, Math.round(R.height * dpr));
    const cx = cv.getContext("2d");
    cx.fillStyle = "#000";
    cx.fillRect(0, 0, cv.width, cv.height);
    const rel = (el) => { const b = el.getBoundingClientRect(); return { x: b.left - R.left, y: b.top - R.top, w: b.width, h: b.height }; };
    const boxes = P.layout === "swipe" ? [root] : [...root.querySelectorAll(".cmp-cell")];
    for (const box of boxes){
      const B = rel(box);
      cx.save();
      cx.beginPath(); cx.rect(B.x * dpr, B.y * dpr, B.w * dpr, B.h * dpr); cx.clip();
      for (const ly of box.querySelectorAll(".cmp-ly")){
        const m = ly.querySelector(".cmp-m");
        if (!m) continue;
        cx.save();
        const cp = /inset\(([^)]*)\)/.exec(ly.style.clipPath || "");
        if (cp){
          const v = cp[1].trim().split(/\s+/).map((x) => parseFloat(x) / 100 || 0); // top right bottom left, in %
          const [t, r, b, l] = v.length === 4 ? v : [v[0], v[1] ?? v[0], v[2] ?? v[0], v[3] ?? v[1] ?? v[0]];
          cx.beginPath();
          cx.rect((B.x + l * B.w) * dpr, (B.y + t * B.h) * dpr, (1 - l - r) * B.w * dpr, (1 - t - b) * B.h * dpr);
          cx.clip();
        }
        if (ly.style.mixBlendMode === "difference") cx.globalCompositeOperation = "difference";
        if (ly.classList.contains("out")) cx.globalAlpha = 0.12;
        const x = parseFloat(m.style.left) || 0, y = parseFloat(m.style.top) || 0, w = parseFloat(m.style.width) || 0, h = parseFloat(m.style.height) || 0;
        const cvs = m.tagName === "CANVAS"; // (a clip's copy under a Difference tile, see paintMirrors)
        const nw = m.videoWidth || m.naturalWidth || (cvs ? m.width : w), nh = m.videoHeight || m.naturalHeight || (cvs ? m.height : h);
        if (nw && nh && w && h){
          const s = Math.min(w / nw, h / nh);
          try { cx.drawImage(m, (B.x + x + (w - nw * s) / 2) * dpr, (B.y + y + (h - nh * s) / 2) * dpr, nw * s * dpr, nh * s * dpr); } catch {}
        }
        cx.restore();
      }
      cx.restore();
    }
    cx.fillStyle = "rgba(255,255,255,.85)";
    for (const sp of root.querySelectorAll(".cmp-split")){
      const S = rel(sp), horiz = sp.classList.contains("x");
      if (horiz) cx.fillRect((S.x + S.w / 2 - 1) * dpr, 0, 2 * dpr, cv.height);
      else cx.fillRect(0, (S.y + S.h / 2 - 1) * dpr, cv.width, 2 * dpr);
    }
    cx.font = `${11 * dpr}px system-ui, sans-serif`;
    cx.textBaseline = "middle";
    for (const lb of root.querySelectorAll(".cmp-lbl")){
      if (lb.hidden) continue;
      const L = rel(lb), text = lb.textContent.trim();
      if (!L.w || !text) continue;
      cx.fillStyle = "rgba(0,0,0,.6)";
      cx.fillRect(L.x * dpr, L.y * dpr, L.w * dpr, L.h * dpr);
      const dot = lb.querySelector("i");
      if (dot){ const D = rel(dot); cx.fillStyle = dot.style.background || "#fff"; cx.beginPath(); cx.arc((D.x + D.w / 2) * dpr, (D.y + D.h / 2) * dpr, D.w / 2 * dpr, 0, Math.PI * 2); cx.fill(); }
      cx.fillStyle = "#fff";
      cx.fillText(text, (L.x + (dot ? rel(dot).w + 12 : 8)) * dpr, (L.y + L.h / 2) * dpr, Math.max(1, L.w - 20) * dpr);
    }
    const W = C.viewWrap ? rel(C.viewWrap) : { x: 0, y: 0 };
    return { cv, ox: W.x, oy: W.y };
  }
  return { open, close, isOpen: () => !!C, onKey, session, pause, seekLayer, relayout, selectedId: () => C?.sel || null, wantsPress, captureView,
    ready: () => C?.fpsReady || Promise.resolve() };
}

let injected = false;
function injectStyles(){
  if (injected) return;
  injected = true;
  const st = document.createElement("style");
  st.textContent = `
.cmp { position: fixed; inset: 0; z-index: 60; display: flex; flex-direction: column; background: #050506; color: var(--fg); opacity: 0; transition: opacity 140ms ease; font-size: 12px; }
.cmp.on { opacity: 1; }
.cmp-bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--surface, #1b1c20); flex: none; }
.cmp-bar > b { font-size: 13px; margin-right: 4px; }
.cmp-hint { flex: 1; min-width: 0; color: var(--subtle); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: right; }
.cmp-seg { display: inline-flex; background: var(--surface-2); border-radius: 7px; padding: 2px; gap: 1px; }
.cmp-seg button { height: 24px; padding: 0 10px; border-radius: 5px; color: var(--muted); font-size: 12px; }
.cmp-seg button:hover { color: var(--fg); }
.cmp-seg button.on { background: var(--surface-3, #2a2b31); color: var(--accent); }
.cmp-b { height: 28px; min-width: 28px; padding: 0 9px; border-radius: 7px; color: var(--muted); background: var(--surface-2); font-size: 12px; white-space: nowrap; }
.cmp-b:hover { color: var(--fg); }
.cmp-b.on { color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.cmp-b[hidden] { display: none; }
.cmp-stage { flex: 1; min-height: 0; position: relative; overflow: hidden; display: grid; gap: 2px; background: #000; touch-action: none; user-select: none; }
.cmp-stage.grid, .cmp-stage.row, .cmp-stage.col { grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); grid-template-rows: repeat(var(--rows), minmax(0, 1fr)); background: #19191c; }
.cmp-box, .cmp-cell { position: relative; overflow: hidden; background: #000; isolation: isolate; min-width: 0; min-height: 0; }
.cmp-cell.sel { box-shadow: inset 0 0 0 1px var(--accent); }
.cmp-ly { position: absolute; inset: 0; pointer-events: none; }
.cmp-ly.out .cmp-m { opacity: .12; }
.cmp-m { position: absolute; object-fit: contain; max-width: none; image-rendering: auto; }
.cmp-lbl { position: absolute; left: 10px; top: 10px; z-index: 4; display: flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; background: rgb(0 0 0 / .62); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
.cmp-lbl[hidden] { display: none; }
.cmp-lbl i, .cmp-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; display: inline-block; }
.cmp-split { position: absolute; z-index: 5; pointer-events: none; }
.cmp-split.x { top: 0; bottom: 0; width: 0; border-left: 1.5px solid rgb(255 255 255 / .9); box-shadow: 0 0 0 .5px rgb(0 0 0 / .6); }
.cmp-split.y { left: 0; right: 0; height: 0; border-top: 1.5px solid rgb(255 255 255 / .9); box-shadow: 0 0 0 .5px rgb(0 0 0 / .6); }
.cmp-split b { position: absolute; width: 14px; height: 30px; border-radius: 7px; background: #fff; box-shadow: 0 1px 6px rgb(0 0 0 / .6); }
.cmp-split.x b { left: -8px; top: calc(50% - 15px); }
.cmp-split.y b { top: -8px; left: calc(50% - 15px); width: 30px; height: 14px; }
.cmp-stage.swipe { grid-template: minmax(0, 1fr) / minmax(0, 1fr); cursor: ew-resize; }
.cmp-empty { display: grid; place-items: center; color: var(--subtle); }
.cmp-foot { flex: none; border-top: 1px solid var(--border); background: var(--surface, #1b1c20); padding: 8px 12px; display: flex; flex-direction: column; gap: 8px; }
.cmp-tl { display: flex; align-items: center; gap: 6px; }
.cmp-tl[hidden] { display: none; }
.cmp-time { min-width: 150px; font-variant-numeric: tabular-nums; color: var(--muted); text-align: center; }
.cmp-track { flex: 1; position: relative; height: 26px; border-radius: 6px; background: var(--surface-2); cursor: pointer; overflow: hidden; touch-action: none; }
.cmp-spans i { position: absolute; height: 4px; border-radius: 2px; opacity: .85; }
.cmp-spans i:nth-child(1) { top: 3px; } .cmp-spans i:nth-child(2) { top: 8px; } .cmp-spans i:nth-child(3) { top: 13px; } .cmp-spans i:nth-child(4) { top: 18px; }
.cmp-spans i:nth-child(n+5) { top: 21px; height: 2px; }
.cmp-head { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: #fff; box-shadow: 0 0 3px rgb(0 0 0 / .8); }
.cmp-layers { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.cmp-chip { display: inline-flex; align-items: center; gap: 4px; height: 30px; padding: 0 6px 0 9px; border-radius: 8px; background: var(--surface-2); border: 1px solid transparent; cursor: pointer; max-width: 420px; }
.cmp-chip.sel { border-color: var(--accent); }
.cmp-chip { touch-action: none; -webkit-touch-callout: none; user-select: none; }
.cmp-chip.lift { opacity: .7; transform: scale(1.04); box-shadow: 0 6px 18px rgb(0 0 0 / .5); }
.cmp-chip.dnd-b { box-shadow: inset 3px 0 0 var(--accent); }
.cmp-chip.dnd-a { box-shadow: inset -3px 0 0 var(--accent); }
.cmp-chip.off { opacity: .5; }
.cmp-nm { min-width: 0; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 2px; }
.cmp-chip button { height: 22px; min-width: 20px; padding: 0 3px; border-radius: 5px; color: var(--muted); font-size: 12px; }
.cmp-chip button:hover { color: var(--fg); background: var(--surface-3, #2a2b31); }
.cmp-chip button.on { color: #ffd60a; }
.cmp-off { display: inline-flex; align-items: center; gap: 1px; padding: 0 2px; border-radius: 5px; background: rgb(0 0 0 / .25); }
.cmp-off em { font-style: normal; min-width: 34px; text-align: center; font-variant-numeric: tabular-nums; cursor: text; }
.cmp-offin { width: 44px; font: inherit; color: var(--fg); background: var(--bg, #111); border: 1px solid var(--accent); border-radius: 4px; padding: 0 3px; outline: none; }
.cmp-menu { position: fixed; z-index: 61; display: flex; flex-direction: column; padding: 4px; min-width: 220px; max-height: 50vh; overflow: auto; border-radius: 10px; background: rgb(22 22 25 / .97); border: 1px solid var(--border); box-shadow: 0 20px 50px rgb(0 0 0 / .5); }
.cmp-menu[hidden] { display: none; }
.cmp-menu button { text-align: left; padding: 7px 10px; border-radius: 6px; color: var(--fg); font-size: 12px; }
.cmp-menu button:hover { background: var(--surface-2); }
.cmp-toast { position: fixed; left: 50%; bottom: 120px; transform: translateX(-50%); z-index: 62; padding: 7px 14px; border-radius: 999px; background: rgb(10 10 11 / .85); border: 1px solid var(--border); pointer-events: none; opacity: 0; transition: opacity 160ms ease; }
.cmp-toast.on { opacity: 1; }
`;
  document.head.appendChild(st);
}
