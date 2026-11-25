// Version compare: several images / videos (usually versions of one shot) side by side or stacked.
//
// Layouts: "stack" — every visible layer stacked in one view; "grid" (tiles), "row" (horizontal
// strip), "col" (vertical strip) — one cell per layer. Pan / zoom are shared by every cell.
// Stack options (P.swipe, P.blend; the bar shows them only in Stack):
//   The stack is always the chip order, the first visible chip on top, each layer on its own level.
//   Swipe on — N-1 draggable split lines; like an Open RV wipe, layer i keeps only the view before its
//   line (the bottom layer is never cut), so region i shows layer i over everything below it. Swipe
//   off — every layer whole. There is no "reference" layer (dropped in 0.114); the first visible chip
//   only sets the frame every layer is fitted to. A fresh compare puts the file it was opened from first.
//   Blend "over" — layers are drawn as they are; "difference" — mix-blend-mode: difference on every
//   layer but the bottom one: each layer against everything below it, i.e. the difference of the
//   whole visible stack (with Swipe: of the layers left in that region).
//   See-through (P.thru, off by default): off — every Stack layer is opaque over its whole box (black past
//   its picture and under its alpha), so a smaller / transparent file never shows the layer below. On — the
//   empty space and alpha show through, and a clip outside its span is not drawn (what is under it shows).
//   Outside its span a clip otherwise shows its edge frame at full strength (no dimmed ghost).
// A stored layout "swipe" (prefs, a note's FORMAT.md `compare`) is Stack with Swipe on; notes write
// "swipe" / "stack" for Stack with Swipe on / off, so an older Sight still opens the swipe look.
// Video: one timeline for all layers. Each layer has a start offset in frames (where its first
// frame sits on the timeline), so clips that start or run differently can be lined up. Playback
// runs on one clock that waits for the slowest clip: a clip still seeking / buffering holds the clock
// (every clip pauses on its frame) until all can play, then they start together; small drift is
// nudged with playbackRate. One decoder per clip. A scrub proxy is decoded only while a drag is showing it, so it
// does not take a hardware decoder away from playback. The server keeps a RAM window around each
// clip's playhead (/api/video/focus items — the budget split between the clips). A drag scrubs a
// short-GOP proxy per clip (made when the compare opens, up to a few at once): one seek in flight,
// the latest time
// waits for it, and the full file is sought once when the drag ends. Until that proxy can show a
// frame, the full file is not seeked while the pointer is down: a long-GOP seek per move lands the
// clips on different frames and can fail a decoder (the blocked-media mark), so the compare sticks.
// The picture stays put and every clip jumps to that frame together when the pointer goes up.
// One the playhead has not reached jumps to its first frame, and one it has left jumps to its last.
// The proxy stays over the full file until that frame is presented, then its decoder is dropped.
//
// Input on the picture is the viewer's: click plays / pauses, left drag scrubs (Shift a tenth), right drag zooms,
// middle drag pans, double-click / F fits; a swipe split is grabbed only by a press right on it. Shift slows every drag (scrub, zoom,
// pan, split, a clip's offset). Layer chips: click shows / hides, Ctrl+click solos that layer (again: every layer),
// middle-click removes, drag reorders; the offset field is dragged sideways (or clicked to type). Hiding a layer
// and Over / Difference only restyle the layers already on screen: the media elements stay, so a clip is not
// loaded and seeked again.
//
// createCompare(host) — host: { api, putSetting, openInLight(asset, layerFiles) (⤢), paintModes(box, layerFiles), versionsOf(id), and for annotating:
// onView(view) — the selected layer's viewer when its surface or its file changes (view: {asset, wrap, media,
// isVid, geom, unturn} or null). Hiding a layer, or Over / Difference, keeps that element, so onView is not
// called again. onPlaced() — pan / zoom / splits moved, onClose(), onAnnotButton() }.
// open(ids, focusId, session) / close() / isOpen() / onKey(e) (true when the key was used) / session() — the
// set to store with a note (FORMAT.md `compare`) / pause() / seekLayer(id, t) — the selected clip's local time.

import { hotkey, runHotkeys } from "/static/keys.js";
import { convertForPlayback } from "/static/video-playable.js";
import { attachViewerInput } from "/static/viewer-input.js";
import { setCursor } from "/static/cursors.js";
import { HELP_HINT } from "/static/key-help.js";

const COLORS = ["#4c9aff", "#ff9f0a", "#34c759", "#ff453a", "#af52de", "#32ade6", "#ffd60a", "#ff6482"];
const LAYOUTS = [["stack", "Stack", "Digit1"], ["grid", "Tile", "Digit2"], ["row", "Row", "Digit3"], ["col", "Column", "Digit4"]];
// A layout as stored (prefs, a note) → {layout, swipe}: "swipe" (before 0.112, and what a note writes for
// Stack with Swipe on) is Stack with Swipe on; "stack" in a note is Stack with Swipe off; swipe null = keep.
function readLayout(v){
  if (v === "swipe") return { layout: "stack", swipe: true };
  if (v === "stack") return { layout: "stack", swipe: false };
  if (LAYOUTS.some(([k]) => k === v)) return { layout: v, swipe: null };
  return null;
}
const PREF_KEY = "sight.compare";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isVideo = (a) => a.kind === "video";
const mediaSrc = (a) => (a.ext === ".psd" ? `/api/psd/${a.id}/preview` : `/api/file/${a.id}`);
// The top bar shows one line (HELP_HINT); the controls themselves are listed by helpGroups() in the "?" overlay.
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
  let P = { layout: "stack", swipe: true, blend: "over", dir: "x", loop: true, thru: false };
  try { P = { ...P, ...(JSON.parse(localStorage.getItem(PREF_KEY)) || {}) }; } catch {}
  {
    // (stored before 0.112: layout "swipe", no swipe key — that is Stack with Swipe on)
    const lay = P.layout === "stack" ? { layout: "stack", swipe: null } : readLayout(P.layout);
    P.layout = lay?.layout || "stack";
    P.swipe = lay?.swipe ?? (typeof P.swipe === "boolean" ? P.swipe : true);
  }
  // A comparison opened from a note shows the look it was made with (C.pBase = the preferences before it);
  // only what is changed here is saved, and the rest goes back when it closes.
  const PREF_LOOK = ["layout", "swipe", "blend", "dir"];
  const prefsToSave = () => {
    if (!C?.pBase) return { ...P };
    const out = { ...P };
    for (const k of PREF_LOOK) if (!C.userSet.has(k)) out[k] = C.pBase[k];
    return out;
  };
  const stacked = () => P.layout === "stack";
  const swiping = () => P.layout === "stack" && !!P.swipe; // the split lines are up
  const diffOn = () => P.layout === "stack" && P.blend === "difference"; // (Difference is a Stack option)
  // (Stack with Swipe on is stored as layout "swipe", as a note writes it, so an older Sight reading the same
  // settings still finds a layout it knows; readLayout maps it back.)
  const savePrefs = () => { try { const o = prefsToSave(); if (o.layout === "stack" && o.swipe) o.layout = "swipe"; host.putSetting(PREF_KEY, JSON.stringify(o)); } catch {} };
  let C = null; // the open session

  // ---- open / close ----------------------------------------------------------------------------
  // session (optional): a comparison stored with a note — {ids, ref, sel, layout, blend, dir, starts: {id: frames}} (`ref` is ignored).
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
    // The right end of the bar is the lightbox's (notes, eye, compare, annotate, close), so every viewer looks alike.
    el.innerHTML = `
      <div class="cmp-bar">
        <b>Compare</b>
        <div class="cmp-seg" data-g="layout">${LAYOUTS.map(([k, n], i) => `<button type="button" data-v="${k}" title="${n} (${i + 1})">${n}</button>`).join("")}</div>
        <button type="button" class="cmp-b" data-a="swipe" title="Swipe — cut the stack with split lines, one region per layer; off: the layers lie whole, the first chip on top (S)">Swipe</button>
        <button type="button" class="cmp-b" data-a="dir" title="Split direction (V)"></button>
        <button type="button" class="cmp-b" data-a="thru" title="See-through — a layer's alpha and the space past its picture show the layers below, and a clip past its end disappears; off: every layer covers the ones below it whole (T)">See-through</button>
        <div class="cmp-seg" data-g="blend"><button type="button" data-v="over" title="Layers as they are, the first chip on top (D toggles)">Over</button><button type="button" data-v="difference" title="Difference — each layer against all the layers below it: the difference of the whole visible stack (hide a layer to take it out) — equal pixels go black (D)">Difference</button></div>
        <span class="cmp-hint"></span>
        <button class="btn ghost cmp-helpb" data-a="help" type="button" style="width:40px;padding:0" title="Controls and shortcuts (?)" aria-label="Controls and shortcuts">?</button>
        <div class="vmodes cmp-modes" hidden></div>
        <button class="btn ghost an-btn cmp-notesb" type="button" style="width:40px;padding:0" title="Notes — read them, click a picture to go there (C)" aria-label="Notes" hidden><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/></svg><span class="an-badge" hidden></span></button>
        <button class="btn ghost cmp-eyeb" type="button" style="width:40px;padding:0" aria-label="Show / hide drawings" hidden></button>
        <button class="btn ghost cmp-lbtn on" data-a="close" type="button" style="width:40px;padding:0" title="Close the comparison (K)" aria-label="Close the comparison" aria-pressed="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="5" width="11" height="14" rx="1.5"/><path d="M14 8h5.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5H14"/><path d="M14 3v18" stroke-dasharray="2 2"/></svg></button>
        <button class="btn ghost an-btn cmp-annb" data-a="annot" type="button" style="width:40px;padding:0" title="Draw &amp; write notes on the selected layer (A) — notes go to its file and remember this comparison" aria-label="Annotate"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l1-4.5L16 4.5a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="M14 20h6"/></svg></button>
        <button class="btn ghost" data-a="close" type="button" style="width:40px;padding:0" title="Close (Esc)" aria-label="Close">✕</button>
      </div>
      <div class="cmp-stage"></div>
      <div class="cmp-foot">
        <div class="cmp-tl" hidden>
          <button type="button" class="cmp-b" data-a="start" title="To start (Home)">⏮</button>
          <button type="button" class="cmp-b" data-a="prev" title="Previous frame (,)">‹</button>
          <button type="button" class="cmp-b cmp-play" data-a="play" title="Play / pause (Space)">▶</button>
          <button type="button" class="cmp-b" data-a="next" title="Next frame (.)">›</button>
          <button type="button" class="cmp-b" data-a="loop" title="Loop (L — while annotating, L is the Lasso)">⟲</button>
          <span class="cmp-time"></span>
          <div class="cmp-track"><div class="cmp-spans"></div><i class="cmp-head"></i></div>
        </div>
        <div class="cmp-layers"></div>
      </div>
      <div class="cmp-menu" hidden></div>
      <div class="cmp-toast"></div>`;
    document.body.appendChild(el);
    window.sightTrackBarH?.(el, el.querySelector(".cmp-bar")); // (--bar-h: the annotate toolbar sits under the zoomed bar)
    C = {
      el, stage: el.querySelector(".cmp-stage"), layers: [], sel: null, sound: null, splits: [],
      view: { zoom: 1, cx: 0.5, cy: 0.5 }, T: 0, playing: false, last: 0, fps: 25, raf: 0,
      candidates: [], built: "", viewWrap: null, viewMedia: null, snaps: {}, focusDirty: true, // post the split windows on the first tick, paused or not
    };
    C.cacheTimer = setInterval(pollCaches, 500);
    host.onOpen?.(el); // (the annotator mounts on the overlay before the first rebuild reports a viewer)
    assets.forEach((a) => addLayer(a));
    const focus = C.layers.find((l) => l.a.id === focusId) || C.layers[0];
    C.sel = focus.a.id; C.sound = focus.a.id;
    // A fresh compare puts the file it was opened from first: it sets the frame and is the top of a Stack, so the picture you came from stays what you see. A note's session
    // keeps its stored order (an old note's `ref` is ignored: the order is what the user arranged).
    if (!session) C.layers = [focus, ...C.layers.filter((l) => l !== focus)];
    if (session){
      C.pBase = { ...P }; C.userSet = new Set();
      if (layer(session.sel)) C.sel = C.sound = session.sel;
      for (const l of C.layers){ const f = Number(session.starts?.[l.id]); if (Number.isFinite(f)) l.start = Math.round(f); }
      const lay = readLayout(session.layout);
      if (lay){ P = { ...P, layout: lay.layout }; if (lay.swipe != null) P.swipe = lay.swipe; }
      if (session.blend === "over" || session.blend === "difference") P = { ...P, blend: session.blend };
      if (session.dir === "x" || session.dir === "y") P = { ...P, dir: session.dir };
    }
    bindUi();
    build();
    ensureScrubs();
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
    cancelAnimationFrame(C.raf); // before onClose bumps the cache generation, so this tick cannot post the new one
    C.raf = 0;
    clearInterval(C.cacheTimer);
    // A drag registers window listeners that finish it. Drop them before C goes away, or the
    // release after a mid-drag close keeps the detached compare, and the next drag's listener leaks.
    C.input?.destroy(); // (ends a picture drag, forgets fingers still down: they never send a pointerup here)
    C.dropScrubListeners?.();
    C.scrub = null;
    host.onClose?.();
    C.ro?.disconnect();
    if (C.pBase) P = prefsToSave();
    if (C.onResize) window.removeEventListener("resize", C.onResize);
    for (const l of C.layers){ dropScrub(l); for (const m of l.media) releaseMedia(m); }
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
  // The first visible chip: its picture sets the frame every layer is fitted to.
  const frameLayer = () => visible()[0] || C.layers[0];
  function resetSplits(){
    const n = visible().length;
    C.splits = Array.from({ length: Math.max(0, n - 1) }, (_, i) => (i + 1) / n);
  }
  function mkMedia(l, primary){
    const a = l.a;
    let m;
    if (isVideo(a)){
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
      m.addEventListener("error", () => { if (m.getAttribute("src")) fallback(); });
      m.addEventListener("loadedmetadata", () => { if (!m.videoWidth) fallback(); });
      m.addEventListener("seeked", () => {
        pumpTime(m);
        if (m._primary && m._want == null && !m.seeking) settleScrub(m._layer, m);
      });
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
  // One seek in flight per element. A drag that moves again before "seeked" keeps the latest time
  // and sends it when the seek lands — it never restarts a seek, so the last painted frame stays.
  function pumpTime(m){
    if (!m || m._want == null || m.seeking || m.readyState < 1) return;
    const t = m._want;
    m._want = null;
    m._seekGen = m._wantGen;
    if (Math.abs(m.currentTime - t) > 0.001) m.currentTime = t;
    else if (m.classList.contains("cmp-scrub")) revealScrub(m);
    else if (m._primary) settleScrub(m._layer, m);
  }
  function wantTime(m, t, gen){
    const dur = m.duration;
    if (Number.isFinite(dur)) t = Math.min(Math.max(0, dur - 1e-3), Math.max(0, t));
    else t = Math.max(0, t);
    m._want = t;
    if (gen != null) m._wantGen = gen;
    pumpTime(m);
  }
  function revealScrub(v){
    if (!C?.scrub || v.seeking || v._want != null || v._seekGen !== C.scrubGen) return;
    v.hidden = false;
  }
  // Where this clip sits on the shared playhead: frame 0 before it starts, its last frame after it
  // ends, otherwise the playhead itself.
  function clipLocal(l){
    const local = C.T - l.start / C.fps;
    if (local < -1e-4) return 0;
    if (l.dur && local >= l.dur) return Math.max(0, l.dur - 1e-3);
    return local;
  }
  // True when the element is on the shared playhead (the 0.1 frame syncVideos adds is the same point).
  // Outside the span, the release parks on the same edge wantTime will clamp to, not the raw playhead.
  function atPlayhead(l, m){
    const tol = 0.5 / C.fps;
    const local = C.T - l.start / C.fps;
    const inside = local >= -1e-4 && (!l.dur || local < l.dur);
    if (inside){
      return Math.abs(m.currentTime - local) <= tol || Math.abs(m.currentTime - (local + 0.1 / C.fps)) <= tol;
    }
    let edge = clipLocal(l) + 0.1 / C.fps;
    const dur = m.duration;
    if (Number.isFinite(dur)) edge = Math.min(Math.max(0, dur - 1e-3), Math.max(0, edge));
    return Math.abs(m.currentTime - edge) <= tol;
  }
  // The proxy stays up until the full file has presented the frame the drag ended on.
  // A seek that was already in flight (queued before the proxy existed) must not count:
  // its "seeked" is an older frame, and hiding on it uncovers that frame for the real seek.
  function settleScrub(l, m){
    const sc = l?.scrub;
    if (!C || C.scrub || !sc || sc.hidden || sc._settle || l.br) return; // (a fast start hands over itself)
    if (m.seeking || m._want != null || !atPlayhead(l, m)) return;
    // A newer drag bumps the token, so this hand-off cannot hide the proxy the next drag is showing.
    const token = ++sc._settleToken;
    const armed = m.currentTime;
    sc._settle = true;
    let done = false;
    const hide = () => {
      if (done) return;
      done = true;
      if (sc._settleToken !== token) return;
      sc._settle = false;
      if (!C || C.scrub || m.seeking || m._want != null) return;
      // Playback may have moved a few frames. A paused jump to a different frame is another seek.
      const jumped = Math.abs(m.currentTime - armed) > Math.max(0.35, 8 / C.fps);
      if (jumped && m.paused) return;
      sc.hidden = true;
      releaseScrubDecoder(sc);
    };
    if (m.requestVideoFrameCallback) m.requestVideoFrameCallback(hide);
    setTimeout(hide, 250);
  }
  // Pointer-up: every clip remembers the release time, even if a seek is already in flight.
  // The playing path used to drop that time while `seeking`, then treat the old "seeked" as the hand-off.
  function queueRelease(){
    if (!C) return;
    for (const l of C.layers){
      // A hidden clip stays where it was. Seeking it here holds the visible ones on that seek,
      // and a decoder under display:none is a decoder the clips on screen do not get.
      if (!isVideo(l.a) || !l.vis) continue;
      // Before this clip: frame 0. Past it: the last frame. The drag already showed that edge.
      const want = clipLocal(l) + 0.1 / C.fps;
      for (const m of l.media){
        if (m.tagName !== "VIDEO" || m.readyState < 1 || m.error) continue;
        wantTime(m, want);
      }
    }
  }
  function dropScrub(l){
    const v = l?.scrub;
    if (!v) return;
    try { v.pause(); v.removeAttribute("src"); v.load(); } catch {}
    v.remove();
    l.scrub = null;
  }
  function mountScrubs(){
    if (!C) return;
    for (const l of C.layers){
      const sc = l.scrub;
      if (!sc) continue;
      const host = l.media.find((m) => m.tagName === "VIDEO" && m._primary);
      if (!host?.parentElement){ sc.remove(); continue; }
      if (sc.previousElementSibling !== host) host.after(sc);
    }
  }
  // A short-GOP proxy per clip, asked as soon as the compare opens (the server encodes a few at once).
  // Clips under 3 s seek from their own keyframes, as in the viewer.
  function ensureScrubs(){
    if (!C) return;
    for (const l of C.layers){
      if (!isVideo(l.a) || l.scrubAsked) continue;
      const known = l.a.duration || l.dur || 0;
      if (known > 0 && known < 3) continue;
      l.scrubAsked = true;
      const id = l.id;
      convertForPlayback(id, null, () => !!C && C.layers.some((x) => x.id === id), "scrub").then((res) => {
        if (!res.ok || !C) return;
        const layer = C.layers.find((x) => x.id === id);
        if (!layer || layer.scrub) return;
        const v = document.createElement("video");
        v.className = "cmp-m cmp-scrub";
        v.muted = true; v.playsInline = true; v.preload = "auto"; v.hidden = true;
        v.draggable = false;
        v._layer = layer;
        // No src yet. A hidden proxy that is already decoding holds a hardware decoder, and Windows
        // then stops painting one of the clips that are actually on screen (or fails that seek).
        v.addEventListener("seeked", () => { pumpTime(v); revealScrub(v); });
        v.addEventListener("error", () => {
          if (!v.getAttribute("src")) return; // dropping the decoder fires error too
          v.hidden = true;
          releaseScrubDecoder(v);
          if (layer.scrub === v) layer.scrub = null;
        });
        layer.scrubReady = true;
        layer.scrub = v;
        mountScrubs();
        place();
        if (C.scrub) armScrubs();
      });
    }
  }
  // Point the proxies at their files. Called when a drag starts (and when a copy finishes mid-drag).
  function armScrubs(){
    if (!C) return;
    for (const l of C.layers){
      const v = l.scrub;
      // A hidden layer is not on screen: giving its proxy a src keeps a hardware decoder for nothing.
      if (!v || !l.vis || !l.scrubReady || v.getAttribute("src")) continue;
      v.src = `/api/video/scrub/${l.id}`;
    }
  }
  // Playback needs those decoders. The proxy is no longer the picture: hide it first, then drop
  // its src. Clearing src alone leaves it on top (z-index 2) with no frame, covering the file.
  function releaseScrubDecoder(v){
    if (!v) return;
    v.hidden = true;
    v._want = null;
    if (!v.getAttribute("src")) return;
    try { v.pause(); v.removeAttribute("src"); v.load(); } catch {}
  }
  // What forces a new stage skeleton: the layout, whether Swipe is on, and the chip order. Visibility and
  // Over / Difference are painted onto that skeleton (applyLook) — they do not reload a clip.
  const structureKey = () => P.layout + ":" + (P.swipe ? 1 : 0) + ":" + C.layers.map((l) => l.id).join(",");
  const q = (root, sel, id) => root?.querySelector(`${sel}[data-id="${CSS.escape(String(id))}"]`) || null;
  // The layer's picture element, made once. Taken out of the stage and put back: its decoder and frame stay.
  function ensurePrimary(l){
    const m = l.media.find((x) => x._primary);
    if (m){ m.remove(); return m; }
    return mkMedia(l, true);
  }
  // Layout, Swipe or the chip order changed: a new skeleton. Every layer is mounted, hidden ones included,
  // so the next hide / show only toggles a class. Media nodes are moved, not recreated.
  function build(){
    for (const l of C.layers){
      // A fast start ends here: the copy is unmounted below, and a target queued for the parked full file is
      // dropped (the next tick seeks or bridges it again from the clock).
      // The copy stays up, paused on its frame (the full file is parked ahead, a frame the clock has not reached);
      // brJumped makes the next tick start a new bridge on it or hide it — never leave it frozen over a running clock.
      if (l.br){ endBridge(l, false); l.brJumped = true; for (const m of l.media) m._want = null; }
      if (l.scrub?.isConnected) l.scrub.remove();
    }
    const st = C.stage;
    const curs = [...st.classList].filter((c) => c.startsWith("cur-"));
    st.innerHTML = "";
    // (prefixed: a bare "row" is the sidebar's menu-row class, whose fixed height flattened the Row layout to nothing)
    st.className = "cmp-stage lay-" + P.layout + curs.map((c) => " " + c).join(""); // (cursors.js keeps its classes)
    setCursor(st, "base", vids().length ? null : "grab"); // pictures only: a left drag pans
    C.el.querySelector(".cmp-hint").textContent = HELP_HINT;
    host.paintModes?.(C.el.querySelector(".cmp-modes"), C.layers.map((l) => l.a)); // (One / Sequence / Compare)
    setCursor(st, "hover", null); // (the splits are rebuilt: the next pointer move finds one again)
    const name = (l) => `<i style="background:${l.color}"></i>${esc(l.a.name)}`;
    if (stacked()){
      // One stack, the last chip at the bottom and the first on top, each layer on its own level (as Open RV) —
      // the same DOM order with Swipe on or off. Over: a layer covers the ones below it (opaque unless See-through).
      // Difference: each layer is blended with everything below it, the bottom one plain — the difference of the
      // whole visible stack; hiding a layer takes it out. Swipe cuts layers, it does not change the stack: like an
      // RV wipe, layer i keeps only the part of the view before its split line, so region i shows layer i over
      // everything below it, and the bottom layer is never cut. The first (top) visible layer sets the frame.
      // Which layer is bottom / cut / blended is applyLook's (hiding a layer changes it without a rebuild).
      const box = document.createElement("div");
      box.className = "cmp-box" + (P.thru ? " thru" : "");
      const stack = document.createElement("div");
      stack.className = "cmp-stack"; // blend stays inside here; the annotation layer is a sibling, painted once
      box.appendChild(stack);
      st.appendChild(box);
      for (const l of [...C.layers].reverse()){
        const w = document.createElement("div");
        w.className = "cmp-ly";
        w.dataset.id = l.id;
        w.appendChild(ensurePrimary(l));
        stack.appendChild(w);
        const lb = document.createElement("div");
        lb.className = "cmp-lbl";
        lb.dataset.id = l.id;
        lb.innerHTML = name(l);
        box.appendChild(lb);
      }
    } else {
      // (no blend in cells: Over / Difference are Stack options)
      for (const l of C.layers){
        const cell = document.createElement("div");
        cell.className = "cmp-cell";
        cell.dataset.id = l.id;
        const w = document.createElement("div");
        w.className = "cmp-ly";
        w.dataset.id = l.id;
        w.appendChild(ensurePrimary(l));
        cell.appendChild(w);
        const lb = document.createElement("div");
        lb.className = "cmp-lbl";
        lb.innerHTML = name(l);
        cell.appendChild(lb);
        st.appendChild(cell);
      }
    }
    C.built = structureKey();
    // The surface node changed: the annotator must bind the new one (a later retune with the same node does not).
    C.viewWrap = null; C.viewMedia = null;
    mountScrubs();
    applyLook();
    C.syncNow = true;
    place();
    paintAll();
    reportView();
  }
  // Hide / show, Over / Difference, labels, swipe regions and the tile grid — on the skeleton build() left.
  // A hidden layer keeps its element (class off); showing it does not decode the file again.
  function applyLook(){
    const vis = visible(), diff = diffOn();
    const box = C.stage.querySelector(".cmp-box");
    if (stacked() && box){
      // The bottom is the last visible chip: never cut, never blended. Every other visible layer is blended in
      // Difference, and with Swipe cut at its split line (data-i = its region, place() sets the clip-path).
      const sw = !!P.swipe, idx = new Map(vis.map((l, i) => [l.id, i])), n = vis.length;
      for (const l of C.layers){
        const w = q(box, ".cmp-ly", l.id);
        if (!w) continue;
        const i = idx.get(l.id), on = i != null, bottom = on && i === n - 1;
        w.classList.toggle("off", !on);
        w.classList.toggle("base", bottom);
        w.style.mixBlendMode = diff && on && !bottom ? "difference" : "";
        if (sw && on && !bottom) w.dataset.i = String(i);
        else { delete w.dataset.i; w.style.clipPath = ""; }
      }
      // Names. Swipe: one per region (place() lays them out). Off: top layer first — Over shows only the one on
      // top (the one you see), Difference every visible one.
      let j = 0;
      for (const l of C.layers){
        const lb = q(box, ".cmp-lbl", l.id);
        if (!lb) continue;
        const i = idx.get(l.id);
        if (sw){
          lb.classList.toggle("off", i == null);
          if (i == null) delete lb.dataset.i; else lb.dataset.i = String(i);
        }
      }
      if (!sw){
        for (const l of C.layers) q(box, ".cmp-lbl", l.id)?.classList.add("off");
        for (const l of vis){
          const lb = q(box, ".cmp-lbl", l.id);
          if (!lb || !(diff || l === vis[0])) continue;
          lb.classList.remove("off");
          lb.style.top = `${10 + j * 26}px`;
          j++;
        }
        box.querySelectorAll(".cmp-split").forEach((h) => h.remove());
        return;
      }
      const need = Math.max(0, vis.length - 1);
      if (C.splits.length !== need) resetSplits();
      const handles = [...box.querySelectorAll(".cmp-split")];
      while (handles.length > need) handles.pop().remove();
      while (handles.length < need){
        const h = document.createElement("div");
        h.className = "cmp-split";
        h.innerHTML = "<b></b>";
        box.appendChild(h);
        handles.push(h);
      }
      handles.forEach((h, i) => { h.dataset.k = String(i); });
    } else {
      const n = Math.max(1, vis.length);
      let cols = n, rows = 1;
      if (P.layout === "col"){ cols = 1; rows = n; }
      else if (P.layout === "grid"){ cols = Math.ceil(Math.sqrt(n)); rows = Math.ceil(n / cols); }
      C.stage.style.setProperty("--cols", cols);
      C.stage.style.setProperty("--rows", rows);
      for (const l of C.layers){
        const cell = q(C.stage, ".cmp-cell", l.id);
        if (!cell) continue;
        cell.classList.toggle("off", !l.vis);
        cell.classList.toggle("sel", l.id === C.sel);
      }
    }
  }
  // Visibility or blend changed, or the skeleton is stale (layout, Swipe, order, a layer added or removed).
  function retune(){
    if (!C) return;
    if (C.built !== structureKey()){ build(); return; }
    applyLook();
    place();
    paintAll();
    reportView();
  }
  // The selected layer's viewer for the annotator: the box it is drawn in (Stack: the whole box — a drawing
  // anywhere maps into the selected layer's picture), its media element and its geometry (object-fit: contain
  // inside the element's box, so a layer of another shape is placed as it is shown). The same element in the
  // same box is not reported again: hiding another layer or switching Over / Difference must not rebuild it.
  function reportView(){
    if (!host.onView) return;
    const l = layer(C.sel);
    let wrap = null, media = null;
    if (l && l.vis){
      if (stacked()){
        wrap = C.stage.querySelector(".cmp-box");
        media = l.media.find((m) => m._primary && wrap?.contains(m)) || null;
      } else {
        wrap = q(C.stage, ".cmp-cell", l.id);
        media = l.media.find((m) => m._primary && wrap?.contains(m)) || null;
      }
    }
    if (wrap === C.viewWrap && media === C.viewMedia) return;
    C.viewWrap = wrap;
    C.viewMedia = media;
    if (!wrap || !media){ host.onView(null); return; }
    const geom = () => {
      const x = parseFloat(media.style.left) || 0, y = parseFloat(media.style.top) || 0;
      const w = parseFloat(media.style.width) || 1, h = parseFloat(media.style.height) || 1;
      const nw = l.nw || w, nh = l.nh || h, s = Math.min(w / nw, h / nh);
      return { x0: x + (w - nw * s) / 2, y0: y + (h - nh * s) / 2, s, w: nw, h: nh, turn: "" };
    };
    host.onView({ asset: l.a, wrap, media, isVid: isVideo(l.a), geom, unturn: (x, y) => [x, y] });
  }
  // Positions every media element (shared zoom / pan, the frame layer's size) and the swipe regions.
  function place(){
    if (!C) return;
    const ref = frameLayer();
    const rw = ref.nw || 1600, rh = ref.nh || 900;
    const boxes = stacked() ? [...C.stage.querySelectorAll(".cmp-box")] : [...C.stage.querySelectorAll(".cmp-cell")];
    for (const box of boxes){
      const W = box.clientWidth, H = box.clientHeight;
      const s = Math.min(W / rw, H / rh) * C.view.zoom;
      const w = rw * s, h = rh * s;
      const x = W / 2 - C.view.cx * w, y = H / 2 - C.view.cy * h;
      for (const m of box.querySelectorAll(".cmp-m")) Object.assign(m.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" });
    }
    host.onPlaced?.();
    if (!swiping()) return;
    const box = boxes[0];
    if (!box) return;
    const edges = [0, ...C.splits, 1], horiz = P.dir === "x";
    // An RV wipe: layer i keeps the view up to its split line (everything before it); what lies past the line
    // is the layers below.
    for (const w of box.querySelectorAll(".cmp-ly[data-i]")){
      const i = Number(w.dataset.i), b = (1 - edges[i + 1]) * 100;
      w.style.clipPath = horiz ? `inset(0 ${b}% 0 0)` : `inset(0 0 ${b}% 0)`;
    }
    for (const lb of box.querySelectorAll(".cmp-lbl:not(.off)")){
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
  // A click on the picture waiting out its 250 ms (a double-click may still come) is dropped by anything else
  // that plays, pauses or seeks first (Space, ▶, a pinch, the annotator), or it would undo that a moment later.
  function dropClick(){ C?.input?.dropClick(); }
  function togglePlay(){
    dropClick();
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
    pushFocus(now);
  }
  // Keeps every video element on the shared clock. Playing: a clip that is seeking, buffering or more than
  // 0.3 s off holds the clock — the others pause on their frame — and a far-off one is seeked to the clock,
  // which does not move meanwhile, so the seek lands where the others wait. (Seeking towards a clock that
  // ran on was the desync: a 4K / long-GOP clip took longer to seek than the 0.25 s it was allowed to lag,
  // landed behind again and was seeked again, forever.) When every clip can play they start together;
  // small drift is corrected with playbackRate. Paused or scrubbing: one seek per clip at a time, the
  // latest time queued behind it. A drag uses the short-GOP proxy when it is ready and leaves the full
  // file on its last frame until the pointer goes up.
  // Fast start (0.116): a jump while playing (a click / drag on the timeline, the loop wrapping, a stall) needs
  // a seek of every full file, and a long-GOP file decodes from its previous keyframe first — ~0.5 s for 1080p
  // with a 10 s GOP, seconds for 4K. The RAM cache does not help there: the bytes are in memory, the decode
  // is not. So playback starts on the clip's short-GOP scrub copy (960 px, it seeks in a frame or two) at once,
  // while the full file seeks to a point a little ahead (`lead`, from how long its last seek took) and waits
  // there, paused; when the clock reaches that point the full file plays and the copy is hidden. If the clock
  // gets there first, the full file is aimed further ahead (the lead grows). l.br = {target, t0} while it runs.
  // Clips without a copy (under 3 s, still encoding) keep the old way: the clock waits for their seek.
  const fullEnd = (l, m) => (Number.isFinite(m.duration) ? m.duration : l.dur) - 1e-3;
  function leadOf(l, miss){
    return Math.min(6, Math.max(0.3, (l.seekCost || 0.6) * 1.5 + 0.15) * 1.5 ** (miss || 0));
  }
  // Sends the full file to `local + lead` and parks it there, paused. A seek already in flight (the release's)
  // is not restarted: the target is queued behind it (one seek per element, pumpTime sends it on "seeked").
  function aimFull(l, m, local, now){
    const b = l.br;
    b.target = Math.max(0, Math.min(fullEnd(l, m), local + leadOf(l, b.miss)));
    b.t0 = now; b.landed = false;
    if (!m.paused) m.pause();
    wantTime(m, b.target);
    b.queued = m._want != null; // (behind a seek in flight: its time is not this seek's — timed from when it is sent)
  }
  function endBridge(l, hide){
    const sc = l.scrub;
    l.br = null;
    if (!sc) return;
    if (!sc.paused) sc.pause();
    if (hide){ sc.hidden = true; releaseScrubDecoder(sc); }
  }
  // Returns null when the clip plays the old way, "wait" while the copy is not ready to go, "go" otherwise.
  function bridge(l, m, local, now){
    let sc = l.scrub;
    // Back to the old way: a copy armed by the press but not used is dropped (its decoder is wanted), and a copy
    // left on screen is hidden (paused over a running clock it would freeze the picture).
    const giveBack = () => {
      if (l.br) endBridge(l, true);
      else if (sc && sc.getAttribute("src") && !C.scrub && (sc.hidden || l.brJumped)){ sc.hidden = true; releaseScrubDecoder(sc); }
      l.brJumped = false;
      return null;
    };
    // A bridge that cannot go on: its copy failed / is gone (the queued target is dropped too), or the clock
    // jumped (a click, the loop wrapping, a big offset change) — then it starts over from there. A tick moves the
    // clock at most 0.25 s, so a bigger step is a jump.
    if (l.br && (!sc || sc.error)){ m._want = null; endBridge(l, true); return null; }
    if (l.br && Math.abs(local - l.br.last) > 0.3){ endBridge(l, false); l.brJumped = true; } // (the copy stays up for a new bridge)
    if (!l.br){
      const far = m.seeking || m._want != null || Math.abs(m.currentTime - local) > 0.3;
      // (no bridge where the full file could not be parked ahead of the clock before the clip's end)
      if (!far || !sc || !l.scrubReady || sc.error || !(fullEnd(l, m) - local > leadOf(l, 0) + 0.3)) return giveBack();
      if (!sc.getAttribute("src")) sc.src = `/api/video/scrub/${l.id}`;
      sc._settle = false;
      sc._settleToken = (sc._settleToken || 0) + 1; // (a hide still waiting from a drag must not take it now)
      sc._want = null;
      l.brJumped = false;
      l.br = { target: 0, t0: now, landed: false, miss: 0, last: local };
      aimFull(l, m, local, now);
    }
    const b = l.br;
    b.last = local;
    if (b.queued && m._want == null){ b.queued = false; b.t0 = now; } // (pumpTime has just sent the target)
    // The full file: parked ahead, then it takes over.
    if (m.seeking || m._want != null){
      if (m.seeking && now - b.t0 > 8000){ b.t0 = now; m.currentTime = b.target; } // (a dropped seek, as below)
    } else {
      if (!b.landed){ b.landed = true; const c = Math.min(4, (now - b.t0) / 1000); l.seekCost = l.seekCost ? (l.seekCost + c) / 2 : c; }
      const roomAhead = fullEnd(l, m) - local > leadOf(l, b.miss + 1) + 0.3;
      if (m.paused && local > b.target + 0.25){
        // The clock got there first: aim further ahead, or near the end give the clip back to the old way.
        if (!roomAhead) return giveBack();
        b.miss++; aimFull(l, m, local, now);
      } else if (local >= b.target - 0.5 / C.fps){
        if (C.wait){ if (!m.paused) m.pause(); }
        else if (m.paused){ m.playbackRate = 1; m.play().catch(() => {}); }
        // Playing near the clock: it presents its own frames now — hand over (the normal path trims the drift).
        else if (m.currentTime > b.target + 0.5 / C.fps && Math.abs(m.currentTime - local) < 0.15){ endBridge(l, true); return "go"; }
        // Playing but late (a slow start after a paused seek): a bigger lead would not help — hand over, the normal
        // path closes the gap (playbackRate, or a seek that holds the clock). A full file that does not move: re-aim.
        else if (local > b.target + 1.5){
          if (m.currentTime > b.target + 0.5 / C.fps){ endBridge(l, true); return null; }
          m.pause(); if (!roomAhead) return giveBack(); b.miss++; aimFull(l, m, local, now);
        }
      } else if (!m.paused) m.pause();
    }
    // The copy follows the clock, as a full file would.
    sc = l.scrub;
    if (sc.readyState < 1 || sc.seeking) return "wait";
    const ds = sc.currentTime - local;
    if (Math.abs(ds) > 0.3){ sc.currentTime = local; return "wait"; }
    if (!canGo(sc, l, local)) return "wait";
    sc.hidden = false;
    if (C.wait){ if (!sc.paused) sc.pause(); return "go"; }
    sc.playbackRate = clamp(1 - ds * 2, 0.85, 1.15);
    if (sc.paused) sc.play().catch(() => {});
    return "go";
  }
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
      // A hidden layer stays loaded but does not play or seek: showing it again is one seek, not a new file.
      if (!l.vis){
        // Drop a queued seek and the scrub proxy's decoder. The file element stays loaded;
        // showing the layer seeks it once (_catch). A fast start in progress ends (its copy is not on screen).
        l.br = null; l.brJumped = false;
        if (l.scrub){ l.scrub._want = null; if (!l.scrub.paused) l.scrub.pause(); releaseScrubDecoder(l.scrub); }
        for (const m of l.media) if (m.tagName === "VIDEO"){ m._want = null; if (!m.paused) m.pause(); }
        continue;
      }
      // Shown again after being hidden: one seek onto the clock. Left set while the element is still
      // loading or a scrub is holding the picture, so a blend change (no _catch) does not seek anyone.
      let catchUp = !!l._catch;
      l._catch = false;
      const local = C.T - l.start / C.fps;
      const inside = local >= -1e-4 && (!l.dur || local < l.dur);
      // Keep a visible proxy paused. Do not hide it here once the drag has ended, including when
      // the playhead has left the clip. settleScrub hides it after the full file has presented the
      // edge (frame 0, the playhead, or the last frame) and then drops the decoder. Hiding first
      // uncovers the pre-drag picture and leaves that decoder running.
      if (l.scrub && !l.scrub.paused && !l.br) l.scrub.pause(); // (a fast start plays its copy)
      // A copy armed by a press but left hidden holds a decoder that playback needs: dropped (a clip in its span
      // while playing decides in bridge(), which may still use it).
      if (!C.scrub && !l.br && l.scrub?.hidden && l.scrub.getAttribute("src") && !(run && inside)) releaseScrubDecoder(l.scrub);
      for (const m of l.media){
        // (also mid-drag: `.out` changes only a clip-path (See-through hides the clip with inset(50%)), never the
        // opacity — an opacity going back to 1 promoted the clip to a hardware overlay and Windows cancelled the drag)
        m.parentElement?.classList.toggle("out", !inside);
        if (m.tagName !== "VIDEO") continue;
        if (!inside){
          catchUp = false; // the edge-frame park below owns this picture
          if (!m.paused) m.pause();
          if (l.br) endBridge(l, true); // (it ran past its end on the copy: the full file parks on its edge below)
          if (C.scrub){
            const sc = l.scrub;
            const edge = local < 0 ? 0 : Math.max(0, (l.dur || 0) - 1e-3);
            if (sc && sc.readyState >= 1 && !sc.error){
              m._want = null;
              wantTime(sc, edge + 0.1 / C.fps, C.scrubGen);
            } else m._want = null;
          } else if (m.readyState >= 1 && !m.error && !m.seeking && m._want == null && !atPlayhead(l, m)){
            // Parked on its edge frame (frame 0 before it starts, the last frame after it ends): a rebuilt element
            // starts at 0 and a jump (End, a key) does not play it there, and the layer is drawn opaque.
            wantTime(m, clipLocal(l) + 0.1 / C.fps);
          }
          continue;
        }
        // (no metadata yet — still loading, converting for playback or broken: nothing to wait for; it joins
        // with a seek once it can)
        if (m.readyState < 1 || m.error) continue;
        if (!run){
          m._low = 0;
          if (!m.paused) m.pause();
          // (stopped mid fast start: the copy stays on the frame until the full file has it — settleScrub)
          if (l.br){ endBridge(l, !!l.scrub?.hidden); m._want = null; }
          const sc = l.scrub;
          const want = local + 0.1 / C.fps;
          // The proxy follows the pointer. The full file is not seeked until the drag ends, so two
          // clips do not fight over the decoder on every move.
          if (C.scrub && sc && sc.readyState >= 1 && !sc.error){
            m._want = null;
            if (!sc.paused) sc.pause();
            wantTime(sc, want, C.scrubGen);
            continue;
          }
          if (sc && C.scrub){ sc.hidden = true; sc._want = null; }
          // No proxy yet. Seeking every full file on the way down lands them on different frames
          // (a long GOP cannot keep up) and can fail a decoder, which leaves the blocked-media
          // mark up and the compare stuck. Hold the current picture; the release seeks them once.
          if (C.scrub){ m._want = null; continue; } // _catch stays: the release seeks once
          if (force || catchUp || Math.abs(m.currentTime - want) > 0.45 / C.fps) wantTime(m, want);
          else if (l.scrub && !l.scrub.hidden) settleScrub(l, m); // (a copy left up by a fast start, already matched)
          catchUp = false;
          continue;
        }
        const br = bridge(l, m, local, now);
        // (a layer shown again while playing starts on its copy too; the bridge owns its catch-up, so a hand-over
        // a few frames off is not seeked again by the catch-up below)
        if (br){ catchUp = false; if (br === "wait") waiting = true; continue; }
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
        if (force || catchUp || Math.abs(d) > 0.3){
          if (Math.abs(d) > 0.5 / C.fps){ m.currentTime = local; m._low = 0; waiting = true; }
          m.playbackRate = 1;
          catchUp = false;
          if (waiting) continue;
        } else catchUp = false;
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
      if (catchUp) l._catch = true;
    }
    if (run){
      // After the seeks above: a proxy still showing the drag, and a clip already on that frame
      // (no "seeked" will fire), hands back now. A seek still in flight hands back from "seeked".
      for (const l of C.layers){
        if (!l.vis || !l.scrub || l.scrub.hidden) continue;
        const m = l.media.find((x) => x._primary && x.tagName === "VIDEO");
        if (m) settleScrub(l, m);
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
  // Tell the server where every clip's playhead is, so its RAM window (split between the clips) follows them.
  // Posted as soon as the comparison opens (paused too), again when a duration arrives or the playhead jumps,
  // and about once a second while playing. `gen` is this client's cache generation: a lightbox post already
  // in flight carries an older one and the server leaves these windows alone.
  function pushFocus(now){
    const v = vids().filter((l) => l.vis && l.dur > 0 && l.media.some((m) => m.tagName === "VIDEO"));
    if (!v.length) return;
    const due = C.focusDirty ? 150 : C.playing ? 1000 : Infinity;
    if (now - (C.focusAt || 0) < due) return;
    C.focusAt = now;
    C.focusDirty = false;
    const body = { items: v.map((l) => ({ id: l.id, t: clamp(C.T - l.start / C.fps, 0, l.dur), duration: l.dur })) };
    const mb = host.cacheMb?.(), ahead = host.cacheAhead?.();
    if (mb) body.mb = mb;
    if (ahead) body.ahead = ahead;
    if (host.cacheGen) body.gen = host.cacheGen();
    const gen = C;
    fetch("/api/video/focus", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => r.json())
      .then((j) => {
        if (C !== gen || !j?.clips) return;
        C.snaps = Object.assign(C.snaps || {}, j.clips);
        paintCmpCaches();
      }).catch(() => {});
  }
  // While the windows fill, each lane's green is re-read. A paused compare does not post again until the
  // playhead moves or a clip's duration arrives; the poll is what keeps the green growing meanwhile.
  function pollCaches(){
    if (!C) return;
    const gen = C;
    const ids = vids().map((l) => l.id);
    if (!ids.length) return;
    fetch(`/api/video/cache?aids=${ids.slice(0, 64).map(encodeURIComponent).join(",")}`)
      .then((r) => r.json())
      .then((j) => {
        if (C !== gen || !j?.files) return;
        C.snaps = j.files;
        paintCmpCaches();
      }).catch(() => {});
  }

  // ---- painting --------------------------------------------------------------------------------
  function paintAll(){ paintBar(); paintLayers(); paintTimeline(); }
  function paintBar(){
    const el = C.el;
    el.querySelectorAll(".cmp-seg[data-g=layout] button").forEach((b) => b.classList.toggle("on", b.dataset.v === P.layout));
    el.querySelectorAll(".cmp-seg[data-g=blend] button").forEach((b) => b.classList.toggle("on", b.dataset.v === P.blend));
    // Swipe and Over / Difference are Stack options: hidden in Tile / Row / Column (the blend is kept for Stack).
    el.querySelector(".cmp-seg[data-g=blend]").hidden = !stacked();
    const sw = el.querySelector("[data-a=swipe]");
    sw.hidden = !stacked();
    sw.classList.toggle("on", !!P.swipe);
    sw.setAttribute("aria-pressed", P.swipe ? "true" : "false");
    const th = el.querySelector("[data-a=thru]");
    th.hidden = !stacked();
    th.classList.toggle("on", !!P.thru);
    th.setAttribute("aria-pressed", P.thru ? "true" : "false");
    const dir = el.querySelector("[data-a=dir]");
    dir.hidden = !swiping();
    dir.textContent = P.dir === "x" ? "⇹ Side by side" : "⇳ Top / bottom";
  }
  function paintLayers(){
    const box = C.el.querySelector(".cmp-layers");
    const more = C.candidates.filter((a) => !C.layers.some((l) => l.id === a.id));
    box.innerHTML = C.layers.map((l) => {
      const v = isVideo(l.a);
      return `<div class="cmp-chip${l.id === C.sel ? " sel" : ""}${l.vis ? "" : " off"}" data-id="${l.id}" draggable="true" title="${esc(l.a.path || l.a.name)} — click shows / hides (H) · Ctrl+click solos this layer (again: all) · middle-click removes · drag to reorder">
        <i class="cmp-dot" style="background:${l.color}"></i>
        <span class="cmp-nm">${esc(l.a.name)}</span>
        ${v ? `<span class="cmp-off" title="Where this clip's first frame sits on the timeline — drag sideways to slide it (Shift slower), click to type · [ ] (Shift ×10)"><em data-a="ov">${l.start > 0 ? "+" : ""}${l.start}f</em></span>
          <button type="button" data-a="snd" class="${C.sound === l.id ? "on" : ""}" title="${C.sound === l.id ? "Sound from this clip" : "Play this clip's sound"}">${C.sound === l.id ? "🔊" : "🔈"}</button>` : ""}
        <button type="button" data-a="lb" title="Open in the viewer">⤢</button>
        <button type="button" data-a="rm" title="Remove from compare">×</button>
      </div>`;
    }).join("") + (more.length ? `<button type="button" class="cmp-b cmp-addb" data-a="add" title="Add another version">+ Add</button>` : "");
  }
  // Green on a lane: that file's blocks actually in RAM, as a fraction of the file, laid along the clip's span.
  // The faint colour is only where the clip sits. Bytes map like the playhead (size · t / duration).
  function cacheBarHtml(snap){
    if (!snap || !(snap.size > 0) || !Array.isArray(snap.spans)) return "";
    let html = "";
    for (const pair of snap.spans){
      const a = Number(pair[0]), b = Number(pair[1]);
      if (!(b > a)) continue;
      const l = Math.max(0, Math.min(100, a / snap.size * 100));
      const w = Math.max(0, Math.min(100, b / snap.size * 100) - l);
      if (w <= 0) continue;
      html += `<i style="left:${l.toFixed(3)}%;width:${w.toFixed(3)}%"></i>`;
    }
    return html;
  }
  function paintCmpCaches(){
    const box = C?.el.querySelector(".cmp-spans");
    if (!box) return;
    box.querySelectorAll(".cmp-lane").forEach((lane) => {
      const el = lane.querySelector(".cmp-caches");
      if (!el) return;
      const html = cacheBarHtml(C.snaps?.[lane.dataset.id]);
      if (el._html === html) return;
      el._html = html;
      el.innerHTML = html;
    });
  }
  function paintTimeline(){
    const tl = C.el.querySelector(".cmp-tl");
    const v = vids();
    tl.hidden = !v.length;
    if (!v.length) return;
    const [lo, hi] = range(), span = Math.max(1e-6, hi - lo);
    const shown = v.filter((l) => l.vis);
    let mks = "";
    // Frames with drawings / a note's picture (annotate.js marks()): a tick in the layer's colour where the frame
    // sits on the shared timeline (the layer's offset + the clip's own time); taller for a note's frame.
    for (const l of shown){
      if (l.marks === undefined) loadMarks(l);
      for (const m of l.marks || []){
        if (l.dur > 0 && m.t > l.dur + 1e-3) continue;
        const x = (l.start / C.fps + m.t - lo) / span * 100;
        if (x < -0.01 || x > 100.01) continue;
        mks += `<i class="cmp-mk${m.note ? " note" : ""}" data-id="${l.id}" data-t="${m.t}" style="left:${x.toFixed(4)}%;--mk:${l.color}" title="${esc(l.a.name)} — ${m.note ? "note" : "drawing"} at ${fmtT(m.t, C.fps)}"></i>`;
      }
    }
    C.el.querySelector(".cmp-spans").innerHTML = shown.map((l) => {
      const a = (l.start / C.fps - lo) / span * 100, w = (l.dur || 0) / span * 100;
      return `<span class="cmp-lane" data-id="${l.id}" style="left:${a}%;width:${Math.max(0, w)}%" title="${esc(l.a.name)} — green is the part in RAM"><i style="background:${l.color}"></i><span class="cmp-caches"></span></span>`;
    }).join("") + mks; // (marks after the lanes: the lanes' nth-child rows count from the first child)
    C.el.querySelector("[data-a=loop]").classList.toggle("on", P.loop);
    paintCmpCaches();
    paintTime();
  }
  // A layer's timeline marks from its rows (the rule of index.html seqLoadMarks: a drawing's `ctx.t`, a note's
  // "t:<s>" caption frames; note = a note's frame). The annotated layer's live marks replace them (setMarks).
  async function loadMarks(l){
    l.marks = null; // (asked: not again)
    let rows = [];
    try { rows = await host.api(`/api/annotations?asset_id=${encodeURIComponent(l.id)}`); } catch { return; }
    if (!C || !C.layers.includes(l) || l.marks) return; // closed, removed, or live marks came first
    const out = [];
    const add = (t, note) => {
      if (!(t >= 0)) return;
      const m = out.find((x) => Math.abs(x.t - t) < 0.0015);
      if (m) m.note = m.note || note; else out.push({ t, note });
    };
    for (const r of rows || []){
      if (r.kind === "status" || r.data?.deleted) continue;
      if (r.kind !== "note") add(Number(r.data?.ctx?.t), !!r.data?.note);
      else for (const key of Object.keys(r.data?.captions || {})) if (key.startsWith("t:")) add(Number(key.slice(2)), true);
    }
    l.marks = out;
    paintTimeline();
  }
  // The annotator's own marks for a layer's file ([{t, note}]), as they change.
  function setMarks(id, marks){
    if (!C) return;
    let hit = false;
    for (const l of C.layers) if (l.id === id && isVideo(l.a)){ l.marks = marks.map((m) => ({ t: m.t, note: !!m.note })); hit = true; }
    if (hit) paintTimeline();
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
  function toggleVis(id){
    const l = layer(id);
    if (!l) return;
    if (l.vis && visible().length === 1){ toast("At least one layer stays visible"); return; }
    l.vis = !l.vis;
    if (l.vis) l._catch = true; // it was not seeking while hidden: land on the clock once
    if (l.vis && C.scrub) armScrubs(); // shown mid-drag: its proxy follows the pointer too
    C.focusDirty = true;
    retune();
  }
  // Ctrl+click: this layer alone, or every layer when it already is. The clicked layer ends up selected.
  function solo(id){
    const l = layer(id);
    if (!l) return;
    const alone = l.vis && C.layers.every((x) => x === l || !x.vis);
    for (const x of C.layers){
      const on = alone || x === l;
      if (on && !x.vis) x._catch = true;
      x.vis = on;
    }
    C.sel = id; // before retune, so a layer that just became the only one stays the annotator's viewer
    if (C.scrub) armScrubs(); // (a layer shown mid-drag gets its proxy)
    C.focusDirty = true;
    retune();
  }
  function remove(id){
    if (C.layers.length <= 1){ close(); return; }
    const gone = layer(id);
    dropScrub(gone);
    for (const m of gone?.media || []) releaseMedia(m);
    C.layers = C.layers.filter((l) => l.id !== id);
    if (!visible().length) C.layers[0].vis = true;
    if (C.sel === id) C.sel = frameLayer().id; // (a visible one: the annotator keeps a viewer)
    if (C.sound === id) C.sound = frameLayer().id;
    C.focusDirty = true;
    retune();
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
    retune();
  }
  function setPref(k, v){
    P[k] = v;
    C?.userSet?.add(k);
    savePrefs();
    if (k === "loop"){ paintTimeline(); return; }
    if (k === "dir"){ paintBar(); place(); return; }
    if (k === "thru"){ paintBar(); C?.stage.querySelectorAll(".cmp-box").forEach((b) => b.classList.toggle("thru", !!P.thru)); return; } // (no rebuild: only the look)
    retune(); // blend / swipe / layout: blend only restyles; a real skeleton change goes through build()
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
  // Scrubbing (mouse, finger or pen), from the timeline or a drag on the picture: every clip shows the playhead's
  // frame while it moves; playback that was running goes on from where it is let go, all clips together (the clock
  // holds until each has landed there). timeAt(ev) — the playhead for this pointer position.
  // scrubBegin / scrubEnd: the shared part (the timeline's own drag below, the picture's through viewer-input).
  function scrubBegin(pid){
    if (!C || C.scrub) return false;
    C.scrubGen = (C.scrubGen || 0) + 1;
    armScrubs();
    for (const l of C.layers) if (l.scrub){
      // A fast start in progress: the drag takes its copy. A copy on screen stays up (the full file is parked
      // ahead, a frame the user has not reached) until the drag's first seek of it lands.
      const keep = !!l.br && !l.scrub.hidden;
      l.br = null;
      if (!keep) l.scrub.hidden = true;
      l.scrub._settle = false;
      l.scrub._settleToken = (l.scrub._settleToken || 0) + 1; // drops a hand-off still waiting to hide it
    }
    C.scrub = { pid };
    return true;
  }
  function scrubTo(t){
    setT(t, true);
    C.T = snapT(C.T);
  }
  function scrubEnd(){
    C.scrub = null;
    queueRelease();
    // Hold the clock while a clip still has the release time queued behind a seek already in flight.
    C.wait = false;
    for (const l of C.layers){
      // A hidden clip's seek must not hold the clock, and its proxy must not keep decoding.
      if (!l.vis){
        if (l.scrub) releaseScrubDecoder(l.scrub);
        for (const m of l.media) if (m.tagName === "VIDEO") m._want = null;
        continue;
      }
      // (playing: a copy armed by the press is kept — the fast start plays on it; bridge() drops it if unused)
      if (l.scrub && l.scrub.hidden && !C.playing) releaseScrubDecoder(l.scrub);
      for (const m of l.media){
        if (m.tagName === "VIDEO" && (m.seeking || m._want != null)) C.wait = true;
      }
    }
    C.last = performance.now();
    C.syncNow = true;
    paintTime();
  }
  // The timeline's drag (absolute: the playhead goes where the pointer is). The picture's goes through viewer-input.
  function startScrub(e, cap, timeAt){
    if (!scrubBegin(e.pointerId)) return false;
    try { cap.setPointerCapture(e.pointerId); } catch {}
    const scrub = (ev) => {
      if (!C || ev.pointerId !== C.scrub?.pid) return;
      scrubTo(timeAt(ev));
    };
    let onWin = null;
    const detach = () => {
      cap.removeEventListener("pointermove", scrub);
      cap.removeEventListener("pointerup", end);
      cap.removeEventListener("pointercancel", end);
      cap.removeEventListener("lostpointercapture", retake);
    };
    const dropWin = () => {
      detach();
      if (!onWin) return;
      window.removeEventListener("pointerup", onWin);
      window.removeEventListener("pointercancel", onWin);
      onWin = null;
      if (C && C.dropScrubListeners === dropWin) C.dropScrubListeners = null;
    };
    function end(ev){
      // Compare already closed: the listeners must still come off (close() usually did this).
      if (!C){ dropWin(); return; }
      if (ev.pointerId !== C.scrub?.pid) return;
      dropWin();
      scrubEnd();
    }
    // A hardware overlay drops capture while the button is still down (and reports no buttons).
    // That is not a release — the pointerup still comes. Take capture back so the drag follows.
    let took = 0;
    function retake(ev){
      if (!C?.scrub || ev.pointerId !== C.scrub.pid || took > 3) return;
      took++;
      try { cap.setPointerCapture(ev.pointerId); } catch {}
    }
    scrub(e);
    cap.addEventListener("pointermove", scrub);
    cap.addEventListener("pointerup", end);
    cap.addEventListener("pointercancel", end);
    cap.addEventListener("lostpointercapture", retake);
    onWin = (ev) => end(ev);
    C.dropScrubListeners = dropWin;
    window.addEventListener("pointerup", onWin);
    window.addEventListener("pointercancel", onWin);
    return true;
  }
  // A floating copy of a layer chip (the drag picture of a reorder), in the document so it keeps the chip's look.
  function chipGhost(chip){
    const r = chip.getBoundingClientRect();
    const g = chip.cloneNode(true);
    g.classList.remove("lift", "dnd-a", "dnd-b");
    g.classList.add("cmp-ghost");
    g.removeAttribute("draggable");
    g.style.width = r.width + "px";
    g.style.height = r.height + "px";
    C.el.appendChild(g);
    return g;
  }
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
      else if (a === "help") host.showHelp?.();
      else if (a === "swipe") setPref("swipe", !P.swipe);
      else if (a === "thru") setPref("thru", !P.thru);
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
    // The timeline: the playhead goes where the pointer is; with Shift held it moves a tenth as fast from there.
    track.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || C.scrub) return;
      // A mark: the playhead goes exactly to its frame (the layer's clip time).
      const mk = e.target.closest?.(".cmp-mk");
      if (mk){ e.preventDefault(); seekLayer(mk.dataset.id, Number(mk.dataset.t)); return; }
      const d = { x: 0, T0: 0, fine: false, rel: false };
      const abs = (ev) => { const r = track.getBoundingClientRect(), [lo, hi] = range(); return lo + clamp((ev.clientX - r.left) / r.width, 0, 1) * (hi - lo); };
      startScrub(e, track, (ev) => {
        // Once Shift has been used the drag stays relative (letting go of Shift must not jump to the pointer).
        if (ev.shiftKey !== d.fine){ d.fine = ev.shiftKey; d.x = ev.clientX; d.T0 = C.T; if (d.fine) d.rel = true; }
        if (!d.rel) return abs(ev);
        const [lo, hi] = range();
        return d.T0 + (ev.clientX - d.x) / Math.max(1, track.clientWidth) * (hi - lo) * (d.fine ? 0.1 : 1);
      });
    });
    const layers = el.querySelector(".cmp-layers");
    layers.addEventListener("click", (e) => {
      const b = e.target.closest("button, em");
      const chip = e.target.closest(".cmp-chip");
      if (b?.dataset.a === "add"){ showAddMenu(b); return; }
      if (!chip || performance.now() - offDragAt < 300) return; // (the click that ends an offset slide)
      const id = chip.dataset.id, a = b?.dataset.a;
      if (a === "ov") editOffset(id, b);
      else if (a === "snd") setSound(id);
      else if (a === "lb"){ const l = layer(id), files = C.layers.map((x) => x.a); close(); host.openInLight?.(l.a, files); }
      else if (a === "rm") remove(id);
      else {
        // A plain click on the clip shows / hides it; one it brings back becomes the selected layer.
        // While annotating a click picks the layer to draw on instead (the picture and ↑ / ↓ are the annotator's).
        const l = layer(id);
        if (!l) return;
        if (e.target.closest(".cmp-off")) return; // (the offset field's padding)
        if (e.ctrlKey || e.metaKey){ solo(id); return; }
        if (host.annotating?.()){ if (!l.vis) toggleVis(id); if (C && layer(id)?.vis) select(id); return; }
        toggleVis(id);
        if (C && layer(id)?.vis) select(id);
      }
    });
    // Middle-click on a clip removes it from the comparison (touch: its ×).
    layers.addEventListener("auxclick", (e) => {
      if (e.button !== 1) return;
      const chip = e.target.closest(".cmp-chip");
      if (!chip) return;
      e.preventDefault();
      remove(chip.dataset.id);
    });
    // The offset field: drag sideways slides the clip on the timeline frame by frame, live (Shift slower);
    // a click without a move types a number (click handler above).
    let offDragAt = -1e9;
    layers.addEventListener("pointerdown", (e) => {
      if (e.button === 1 && e.target.closest(".cmp-chip")){ e.preventDefault(); return; } // (no autoscroll: a middle-click removes)
      const em = e.target.closest("em[data-a=ov]");
      if (!em || e.button !== 0) return;
      const chip = em.closest(".cmp-chip"), l = layer(chip?.dataset.id);
      if (!l) return;
      e.preventDefault();
      e.stopPropagation(); // (not the chip's hold-to-reorder)
      chip.draggable = false;
      try { em.setPointerCapture(e.pointerId); } catch {}
      const d = { pid: e.pointerId, x: e.clientX, f0: l.start, fine: e.shiftKey, on: false };
      const PX = 6; // px per frame (Shift: five times that)
      const move = (ev) => {
        if (ev.pointerId !== d.pid || !C) return;
        if (ev.pointerType === "mouse" && !ev.buttons){ up(ev); return; } // released outside the window: no pointerup came
        if (!d.on){ if (Math.abs(ev.clientX - d.x) < 4) return; d.on = true; d.x = ev.clientX; em.classList.add("drag"); }
        if (ev.shiftKey !== d.fine){ d.fine = ev.shiftKey; d.x = ev.clientX; d.f0 = l.start; } // no jump when Shift changes
        const n = d.f0 + Math.round((ev.clientX - d.x) / (PX * (d.fine ? 5 : 1)));
        if (n === l.start) return;
        l.start = n;
        C.syncNow = true;
        em.textContent = `${n > 0 ? "+" : ""}${n}f`;
        paintTimeline();
      };
      const up = (ev) => {
        if (ev.pointerId !== d.pid) return;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        em.classList.remove("drag");
        if (d.on){ offDragAt = performance.now(); if (C) paintLayers(); }
      };
      // (on window: a repaint of the chips mid-drag detaches the field, and its own listeners would go quiet)
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    }, true);
    layers.addEventListener("dragstart", (e) => {
      const chip = e.target.closest(".cmp-chip");
      if (!chip) return;
      e.dataTransfer.setData("text/x-cmp", chip.dataset.id);
      e.dataTransfer.effectAllowed = "move";
      // The whole chip is the drag picture (the browser's own showed only its text).
      const r = chip.getBoundingClientRect();
      const g = chipGhost(chip); // (rendered over the chip itself for this one frame: an off-screen node can paint empty)
      g.style.left = r.left + "px"; g.style.top = r.top + "px";
      try { e.dataTransfer.setDragImage(g, e.clientX - r.left, e.clientY - r.top); } catch {}
      setTimeout(() => g.remove(), 0);
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
        // The chip follows the finger as a whole block.
        const r = chip.getBoundingClientRect();
        h.dx = h.x - r.left; h.dy = h.y - r.top;
        h.ghost = chipGhost(chip);
        h.ghost.style.left = r.left + "px"; h.ghost.style.top = r.top + "px";
        navigator.vibrate?.(15);
      }, 400);
      hold = h;
    });
    layers.addEventListener("pointermove", (e) => {
      const h = hold;
      if (!h || e.pointerId !== h.pid) return;
      if (!h.on){ if (Math.hypot(e.clientX - h.x, e.clientY - h.y) > 10){ clearTimeout(h.timer); hold = null; } return; }
      e.preventDefault();
      if (h.ghost){ h.ghost.style.left = (e.clientX - h.dx) + "px"; h.ghost.style.top = (e.clientY - h.dy) + "px"; }
      layers.querySelectorAll(".cmp-chip.dnd-b, .cmp-chip.dnd-a").forEach((c) => c.classList.remove("dnd-b", "dnd-a"));
      const d = dropAt(e.clientX, e.clientY, h.id);
      d.over?.classList.add(d.after ? "dnd-a" : "dnd-b");
    });
    const endHold = (e) => {
      const h = hold;
      if (!h || e.pointerId !== h.pid) return;
      clearTimeout(h.timer);
      hold = null;
      h.ghost?.remove();
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
      retune();
      ensureScrubs();
      loadFps();
    });
    el.addEventListener("pointerdown", (e) => { if (!menu.hidden && !e.target.closest(".cmp-menu, [data-a=add]")) menu.hidden = true; }, true);
    const st = C.stage;
    C.input = bindStageInput(st);
    st.addEventListener("pointermove", (e) => { if (C && !C.input.busy() && !C.scrub) hoverCursor(e); });
    st.addEventListener("contextmenu", (e) => e.preventDefault());
    C.onResize = () => place();
    window.addEventListener("resize", C.onResize);
  }
  function boxOf(e){ return e.target.closest(".cmp-box, .cmp-cell"); }
  // The split a press grabs: only one within reach of the pointer (a mouse needs to be close, a finger less so).
  // -1: none, the press is the picture's (scrub / play).
  function splitNear(e, anyDistance){
    if (!C || !swiping() || !C.splits.length) return -1;
    const box = C.stage.querySelector(".cmp-box");
    if (!box) return -1;
    const r = box.getBoundingClientRect(), horiz = P.dir === "x";
    const px = horiz ? e.clientX - r.left : e.clientY - r.top, span = horiz ? r.width : r.height;
    const reach = anyDistance ? Infinity : e.pointerType === "touch" || e.pointerType === "pen" ? 24 : 10;
    let k = -1, best = reach;
    C.splits.forEach((p, i) => { const d = Math.abs(p * span - px); if (d <= best){ best = d; k = i; } });
    return k;
  }
  // While annotating (the annotator asks first, host.passThrough): in swipe a mouse moves the nearest split with
  // Alt held (as Alt scrubs a video in the viewer), a finger or pen moves the split it lands on — drawing is
  // skipped then.
  function wantsPress(e){
    if (!C || !swiping() || !C.splits.length || e.button !== 0) return false;
    if (e.altKey) return true;
    if (e.pointerType !== "touch" && e.pointerType !== "pen") return false;
    return splitNear(e) >= 0;
  }
  // The layer a press lands on: a tile's own, or in swipe the region under the pointer. A stack without splits:
  // Over — the layer on top (the one you see); Difference — none (the selection stays: every layer is in view).
  function layerAt(e, box){
    if (box.classList.contains("cmp-cell")) return box.dataset.id;
    const vis = visible();
    if (!vis.length) return null;
    if (!swiping()) return P.blend === "difference" ? null : vis[0].id;
    const r = box.getBoundingClientRect(), horiz = P.dir === "x";
    const f = horiz ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height;
    const edges = [0, ...C.splits, 1];
    for (let i = 0; i < vis.length; i++) if (f < edges[i + 1] || i === vis.length - 1) return vis[i].id;
    return null;
  }
  // Pointer on the picture, the same as the viewer (viewer-input.js): a click plays / pauses, a left drag scrubs
  // every clip (the stage's width is the timeline, Shift a tenth; pictures only: it pans), a right drag zooms,
  // a middle drag (or Alt+left) pans; in swipe a left press right on a split moves that split. Two fingers
  // pinch-zoom and pan.
  // The box a gesture measures: the pressed one, or after a rebuild mid-drag (a layout / visibility key) any
  // (a detached box measures 0 and the view would go NaN).
  function liveBox(down){
    const b = down?.target?.closest?.(".cmp-box, .cmp-cell");
    return b && b.isConnected ? b : C.stage.querySelector(".cmp-box, .cmp-cell:not(.off)");
  }
  function bindStageInput(st){
    let s = null; // the picture scrub: the playhead it started from
    return attachViewerInput(st, {
      canStart: (e) => !!C && !!boxOf(e),
      claim: (e) => {
        const box = boxOf(e);
        // A left press picks the layer under it. Middle (pan) and right (zoom) must not: that rebinding
        // rebuilt the annotation layer and left a copy of every drawing, and the brush circle stuck.
        if (e.button === 0){
          const id = layerAt(e, box);
          if (id && id !== C.sel) select(id);
        }
        // A timeline scrub is running (another finger): this press does nothing, it must not pan the picture.
        if (C.scrub) return {};
        // (Alt+left pans, except while annotating: there Alt+left moves a split, see wantsPress.)
        if (e.button === 0 && e.altKey && !host.annotating?.()) return "pan";
        if (e.button !== 0) return null;
        // (annotating, Alt+left is the nearest split's wherever it is: the annotator let the press through for it)
        const k = splitNear(e, e.altKey && !!host.annotating?.());
        return k >= 0 ? splitDrag(e, box, k) : null;
      },
      click: () => { if (C) togglePlay(); },
      dblclick: () => { if (C) fit(); },
      scrub: {
        begin: (e) => {
          if (!C || !vids().length || !scrubBegin(e.pointerId)) return false;
          s = { T0: C.T };
          return true;
        },
        to: (frac) => {
          if (!C || !s) return;
          const [lo, hi] = range();
          scrubTo(s.T0 + frac * (hi - lo));
        },
        end: () => { s = null; if (C?.scrub) scrubEnd(); },
      },
      scrubWidth: () => C?.stage.clientWidth || 1,
      pan: (dx, dy, down) => {
        if (!C) return;
        const box = liveBox(down);
        if (!box) return;
        const ref = frameLayer(), rw = ref.nw || 1600, rh = ref.nh || 900;
        const sc = Math.min(box.clientWidth / rw, box.clientHeight / rh) * C.view.zoom;
        if (!(sc > 0)) return;
        C.view.cx -= dx / (rw * sc);
        C.view.cy -= dy / (rh * sc);
        place();
      },
      zoom: (f, x, y, down) => {
        if (!C) return;
        const box = liveBox(down);
        if (!box || !box.clientWidth) return;
        const r = box.getBoundingClientRect();
        zoomAt(box, C.view.zoom * f, x - r.left, y - r.top);
      },
      zoomSettings: () => host.getZoomSettings?.() || {},
      // (the gesture cursors — grabbing, zoom-in / -out, ew-resize, a split's resize — are viewer-input.js's)
      // A second finger: the annotator's stroke is dropped, a timeline scrub ends where it is.
      abortOthers: () => {
        host.abortAnnot?.();
        if (C?.scrub) window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: C.scrub.pid }));
      },
    });
  }
  // A split drag, relative to the press: the split does not jump to the pointer, and Shift moves it slower
  // from where it is.
  function splitDrag(e, box, k){
    const r = box.getBoundingClientRect(), horiz = P.dir === "x";
    const d = { p0: C.splits[k], at: horiz ? e.clientX : e.clientY, span: horiz ? r.width : r.height, fine: e.shiftKey };
    return {
      cursor: horiz ? "resize-x" : "resize-y",
      move: (ev) => {
        if (!C || !box.isConnected || k >= C.splits.length) return; // (rebuilt mid-drag: the split is gone)
        const at = P.dir === "x" ? ev.clientX : ev.clientY;
        if (ev.shiftKey !== d.fine){ d.fine = ev.shiftKey; d.p0 = C.splits[k]; d.at = at; }
        const lo = k ? C.splits[k - 1] : 0, hi = k < C.splits.length - 1 ? C.splits[k + 1] : 1;
        C.splits[k] = clamp(d.p0 + (at - d.at) / Math.max(1, d.span) * (d.fine ? 0.1 : 1), lo, hi);
        place();
      },
    };
  }
  // Zoom to z keeping the box point (mx, my) — px from the box's top-left — where it is.
  function zoomAt(box, z, mx, my, base){
    const ref = frameLayer(), W = box.clientWidth, H = box.clientHeight;
    const rw = ref.nw || 1600, rh = ref.nh || 900, s0 = Math.min(W / rw, H / rh);
    const b = base || C.view;
    const ox = mx - W / 2, oy = my - H / 2;
    const u = b.cx + ox / (rw * s0 * b.zoom), v = b.cy + oy / (rh * s0 * b.zoom);
    z = clamp(z, 0.1, 64);
    C.view.zoom = z;
    C.view.cx = u - ox / (rw * s0 * z);
    C.view.cy = v - oy / (rh * s0 * z);
    place();
  }
  function hoverCursor(e){
    const k = e.pointerType === "mouse" && !host.annotating?.() ? splitNear(e) : -1;
    setCursor(C.stage, "hover", k < 0 ? null : P.dir === "x" ? "resize-x" : "resize-y");
  }
  // 100 % of the frame layer's (first visible chip's) own pixels.
  function actual(){
    const ref = frameLayer(), box = C.stage.querySelector(".cmp-box, .cmp-cell:not(.off)"); // (a hidden cell measures 0)
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
      ["KeyD", () => { if (stacked()) setPref("blend", P.blend === "difference" ? "over" : "difference"); else toast("Over / Difference are Stack options (1)"); }],
      ["KeyS", () => { if (stacked()) setPref("swipe", !P.swipe); else toast("Swipe is a Stack option (1)"); }],
      ["KeyT", () => { if (stacked()) setPref("thru", !P.thru); else toast("See-through is a Stack option (1)"); }],
      ["KeyV", () => { if (swiping()) setPref("dir", P.dir === "x" ? "y" : "x"); }],
      ["KeyF", () => fit()], ["Digit0", () => actual()],
      ["KeyH", () => toggleVis(C.sel)],
      ["KeyL", () => setPref("loop", !P.loop)],
    ]);
    // Everything else stays inside the compare view (the library / lightbox keys underneath
    // must not fire while it is on top), except the command palette.
    return !hotkey(e, "Ctrl+KeyK");
  }

  // What a note made here remembers (FORMAT.md `compare`): the files, their order (the first is on top), selected layer,
  // look and each clip's offset.
  function session(){
    if (!C) return null;
    const starts = {};
    for (const l of C.layers) if (isVideo(l.a) && l.start) starts[l.id] = l.start;
    // (Stack is written as "swipe" / "stack" — Swipe on / off — so an older Sight still opens the swipe look)
    const layout = stacked() ? (P.swipe ? "swipe" : "stack") : P.layout;
    // (`ref` = the first id, read only by a Sight before 0.114, which still has a reference layer: there it
    // makes the same layer the frame; this Sight ignores it)
    const ids = C.layers.map((l) => l.id);
    return { ids, ref: ids[0], sel: C.sel, layout, blend: P.blend, dir: P.dir, starts };
  }
  // The annotator stops: on the frame the selected clip is showing (its drawing is stored at that element
  // time), not the clock's snapped / drifted one.
  function pause(){
    dropClick();
    if (!C || !C.playing) return;
    C.playing = false;
    const l = layer(C.sel);
    // (a fast start: the copy has the frame on screen; the full file is parked ahead)
    // (a hidden layer's element is parked where it was hidden: not the clock)
    const m = !l || !l.vis || !isVideo(l.a) ? null : l.br ? (l.scrub && !l.scrub.hidden ? l.scrub : null) : l.media.find((x) => x._primary);
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
    dropClick();
    const T = t + (isVideo(l.a) ? l.start / C.fps : 0);
    const [lo, hi] = range();
    C.playing = false;
    C.T = hi > lo ? clamp(T, lo, hi - 1e-3) : T; // (exactly at the end the clip counts as out and dims)
    C.syncNow = true;
    C.focusDirty = true;
    paintTime();
  }
  // (also on annotating on / off: a split's hover cursor is not the annotator's — the next move sets it again)
  function relayout(){ if (C){ setCursor(C.stage, "hover", null); requestAnimationFrame(() => place()); } }
  // The view on screen as a picture, for the annotator's screenshot: every visible layer where and how it is
  // shown (stacked layers or swipe regions, tiles, Difference, dimmed clips outside their span), split lines and
  // name labels. Stack: the box; tiles: the whole stage. ox / oy: the annotated surface's place in it (CSS px).
  function captureView(dpr){
    if (!C) return null;
    const root = stacked() ? C.stage.querySelector(".cmp-box") : C.stage;
    if (!root) return null;
    const R = root.getBoundingClientRect();
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(R.width * dpr)); cv.height = Math.max(1, Math.round(R.height * dpr));
    const cx = cv.getContext("2d");
    cx.fillStyle = "#000";
    cx.fillRect(0, 0, cv.width, cv.height);
    const rel = (el) => { const b = el.getBoundingClientRect(); return { x: b.left - R.left, y: b.top - R.top, w: b.width, h: b.height }; };
    const boxes = stacked() ? [root] : [...root.querySelectorAll(".cmp-cell")];
    for (const box of boxes){
      if (box.classList.contains("off")) continue;
      const B = rel(box);
      cx.save();
      cx.beginPath(); cx.rect(B.x * dpr, B.y * dpr, B.w * dpr, B.h * dpr); cx.clip();
      for (const ly of box.querySelectorAll(".cmp-ly")){
        if (ly.classList.contains("off")) continue;
        const m = ly.querySelector(".cmp-scrub:not([hidden])") || ly.querySelector(".cmp-m:not(.cmp-scrub)");
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
        const thru = box.classList.contains("thru");
        if (thru && ly.classList.contains("out")){ cx.restore(); continue; } // (not drawn, as on screen)
        const x = parseFloat(m.style.left) || 0, y = parseFloat(m.style.top) || 0, w = parseFloat(m.style.width) || 0, h = parseFloat(m.style.height) || 0;
        const nw = m.videoWidth || m.naturalWidth || w, nh = m.videoHeight || m.naturalHeight || h;
        // An opaque Stack layer is a group on screen: its picture over black, then blended. Drawn the same way
        // (a black layer first, then composited), so alpha pixels in Difference match the screen.
        let dst = cx, off = null;
        if (stacked() && !thru){
          off = document.createElement("canvas"); off.width = cv.width; off.height = cv.height;
          dst = off.getContext("2d");
          dst.fillStyle = "#000"; dst.fillRect(B.x * dpr, B.y * dpr, B.w * dpr, B.h * dpr);
        }
        if (nw && nh && w && h){
          const s = Math.min(w / nw, h / nh);
          try { dst.drawImage(m, (B.x + x + (w - nw * s) / 2) * dpr, (B.y + y + (h - nh * s) / 2) * dpr, nw * s * dpr, nh * s * dpr); } catch {}
        }
        if (off) cx.drawImage(off, 0, 0);
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
      if (lb.hidden || lb.classList.contains("off")) continue;
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
  // The "?" overlay's list (index.html shows it with key-help.js): the compare's own keys from onKey above, its mouse
  // and touch controls; with pictures only (no video) a left drag pans and the video rows are left out.
  function helpGroups(){
    const vid = !!C && vids().length > 0;
    return [
      { group: "Layout", rows: [
        ...LAYOUTS.map(([, n, combo]) => [[combo.replace("Digit", "")], n]),
        [["S"], "Swipe on / off (Stack): split lines cut the stack, one region per layer"],
        [["V"], "Split direction: side by side / top and bottom (Swipe)"],
        [["D"], "Over / Difference (Stack): equal pixels go black"],
        [["T"], "See-through (Stack): alpha and the space past a picture show the layers below"],
      ] },
      { group: "Layers", rows: [
        [["↑", "↓"], "Select the previous / next layer"],
        [["H"], "Hide / show the selected layer"],
        [["Click a chip"], "Hide / show that layer (while annotating: pick it to annotate)"],
        [["Ctrl+click a chip"], "Solo that layer (again: every layer)"],
        [["Middle-click a chip", "×"], "Remove the layer"],
        [["Drag a chip"], "Reorder the layers (touch: hold, then drag)"],
        [["⤢"], "Open the file in the viewer (the set is kept)"],
        [["+ Add"], "Bring in another version"],
      ] },
      { group: "View", rows: [
        [["Wheel", "Right-drag"], "Zoom around the cursor"],
        [vid ? ["Middle-drag", "Alt+drag"] : ["Drag", "Middle-drag"], "Pan"],
        [["Double-click", "F"], "Fit"],
        [["0"], "First visible layer at 100 %"],
        [["Drag a split line"], "Move that split (Swipe)"],
        [["Shift (held)"], "Slower drags: scrub, zoom, pan, a split, a clip's offset"],
        [["Pinch"], "Touch: zoom and pan with two fingers"],
      ] },
      ...(vid ? [{ group: "Video", rows: [
        [["Space", "Click"], "Play / pause every clip in sync (touch: tap)"],
        [["Drag"], "Scrub every clip (the view's width is the whole timeline; touch: one finger)"],
        [[",", "."], "Previous / next frame (also ← / →)"],
        [["Shift+,", "Shift+."], "10 frames back / on (also Shift+← / Shift+→)"],
        [["Home", "End"], "Start / end of the timeline"],
        [["L"], "Loop on / off"],
        [["[", "]"], "Shift the selected clip's first frame 1 frame (Shift: 10)"],
        [["Drag the offset"], "Slide a clip frame by frame on its chip (click it to type a number)"],
        [["Click a tick"], "Go to a frame with a drawing / note on the timeline"],
      ] }] : []),
      { group: "General", rows: [
        [["?"], "Show / hide this list"],
        [["A"], "Annotate the selected layer (its own ? lists the drawing keys)"],
        [["C"], "Notes of the selected layer"],
        [["Esc", "K"], "Close the comparison"],
        [["Ctrl+K"], "Command palette"],
      ] },
    ];
  }

  return { open, close, isOpen: () => !!C, onKey, helpGroups, session, pause, seekLayer, relayout, setMarks, selectedId: () => C?.sel || null, wantsPress, captureView,
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
.cmp-bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--surface, #1b1c20); flex: none; flex-wrap: wrap; }
/* (a narrow compare — beside the library — wraps its bar instead of squeezing the buttons' labels; --bar-h follows) */
.cmp-bar > * { flex-shrink: 0; }
.cmp-bar > .cmp-hint { flex-shrink: 1; }
.cmp-bar > b { font-size: 13px; margin-right: 4px; }
.cmp-hint { flex: 1; min-width: 0; color: var(--subtle); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: right; }
.cmp-seg { display: inline-flex; background: var(--surface-2); border-radius: 7px; padding: 2px; gap: 1px; }
.cmp-seg button { height: 24px; padding: 0 10px; border-radius: 5px; color: var(--muted); font-size: 12px; }
.cmp-seg button:hover { color: var(--fg); }
.cmp-seg button.on { background: var(--surface-3, #2a2b31); color: var(--accent); }
.cmp-b { height: 28px; min-width: 28px; padding: 0 9px; border-radius: 7px; color: var(--muted); background: var(--surface-2); font-size: 12px; white-space: nowrap; }
.cmp-b:hover { color: var(--fg); }
.cmp-b.on { color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.cmp-b[hidden], .cmp-seg[hidden] { display: none; }
.cmp-stage { flex: 1; min-height: 0; position: relative; overflow: hidden; display: grid; gap: 2px; background: #000; touch-action: none; user-select: none; }
.cmp-stage.lay-grid, .cmp-stage.lay-row, .cmp-stage.lay-col { grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); grid-template-rows: repeat(var(--rows), minmax(0, 1fr)); background: #19191c; }
.cmp-box, .cmp-cell { position: relative; overflow: hidden; background: #000; isolation: isolate; min-width: 0; min-height: 0; }
/* Blend stays in the stack. The annotation layer is a sibling of it, so it is painted once. */
.cmp-stack { position: absolute; inset: 0; isolation: isolate; z-index: 0; }
.cmp-ly.off, .cmp-cell.off, .cmp-lbl.off { display: none !important; }
.cmp-cell.sel { box-shadow: inset 0 0 0 1px var(--accent); }
/* isolation: the scrub proxy is z-index 2 so it paints over its own file. The bottom layer is not
   clipped. Without a stacking context here its proxy joins the box and covers every other swipe
   region, so a drag shows only the bottom layer. */
.cmp-ly { position: absolute; inset: 0; pointer-events: none; isolation: isolate; }
/* Stack: a layer covers the ones below it whole (black past its picture / under its alpha) unless See-through
   is on; then a clip outside its span is not drawn. Tile cells: an out clip just shows its edge frame. */
.cmp-box:not(.thru) .cmp-ly { background: #000; }
.cmp-box.thru .cmp-ly.out .cmp-m { clip-path: inset(50%); } /* (a clip-path, not opacity: see syncVideos) */
.cmp-m { position: absolute; object-fit: contain; max-width: none; image-rendering: auto;
  /* Windows promotes a plain <video> to a hardware overlay. Only a couple of those exist, so the
     clips that do not get one keep their old picture until playback stops. The overlay is also a
     window of its own: in Column it lands on the timeline and the drag is cancelled. A clip on the
     element keeps every clip on the normal compositor. */
  clip-path: inset(0); }
.cmp-scrub { z-index: 2; pointer-events: none; }
.cmp-lbl { position: absolute; left: 10px; top: 10px; z-index: 4; display: flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; background: rgb(0 0 0 / .62); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
.cmp-lbl[hidden] { display: none; }
.cmp-lbl i, .cmp-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; display: inline-block; }
.cmp-split { position: absolute; z-index: 5; pointer-events: none; }
.cmp-split.x { top: 0; bottom: 0; width: 0; border-left: 1.5px solid rgb(255 255 255 / .9); box-shadow: 0 0 0 .5px rgb(0 0 0 / .6); }
.cmp-split.y { left: 0; right: 0; height: 0; border-top: 1.5px solid rgb(255 255 255 / .9); box-shadow: 0 0 0 .5px rgb(0 0 0 / .6); }
.cmp-split b { position: absolute; width: 14px; height: 30px; border-radius: 7px; background: #fff; box-shadow: 0 1px 6px rgb(0 0 0 / .6); }
.cmp-split.x b { left: -8px; top: calc(50% - 15px); }
.cmp-split.y b { top: -8px; left: calc(50% - 15px); width: 30px; height: 14px; }
.cmp-stage.lay-stack { grid-template: minmax(0, 1fr) / minmax(0, 1fr); }
.cmp-empty { display: grid; place-items: center; color: var(--subtle); }
.cmp-foot { flex: none; border-top: 1px solid var(--border); background: var(--surface, #1b1c20); padding: 8px 12px; display: flex; flex-direction: column; gap: 8px; }
.cmp-tl { display: flex; align-items: center; gap: 6px; }
.cmp-tl[hidden] { display: none; }
.cmp-time { min-width: 150px; font-variant-numeric: tabular-nums; color: var(--muted); text-align: center; }
.cmp-track { flex: 1; position: relative; height: 26px; border-radius: 6px; background: var(--surface-2); cursor: pointer; overflow: hidden; touch-action: none; }
.cmp-spans .cmp-mk { position: absolute; top: 0; bottom: 0; width: 11px; margin-left: -5.5px; cursor: pointer; z-index: 1; }
.cmp-spans .cmp-mk::after { content: ""; position: absolute; left: 4.5px; width: 2px; top: 14px; bottom: 2px; border-radius: 1px; background: var(--mk, #f5c542); }
.cmp-spans .cmp-mk.note::after { top: 8px; }
.cmp-spans .cmp-lane { position: absolute; height: 4px; border-radius: 2px; overflow: hidden; pointer-events: none; }
.cmp-spans .cmp-lane:nth-child(1) { top: 3px; } .cmp-spans .cmp-lane:nth-child(2) { top: 8px; } .cmp-spans .cmp-lane:nth-child(3) { top: 13px; } .cmp-spans .cmp-lane:nth-child(4) { top: 18px; }
.cmp-spans .cmp-lane:nth-child(n+5) { top: 21px; height: 2px; }
.cmp-spans .cmp-lane > i { position: absolute; inset: 0; opacity: .35; }
.cmp-spans .cmp-caches { position: absolute; inset: 0; }
.cmp-spans .cmp-caches i { position: absolute; top: 0; bottom: 0; background: #2f9d5b; }
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
.cmp-off em { font-style: normal; min-width: 38px; padding: 0 3px; text-align: center; font-variant-numeric: tabular-nums; cursor: ew-resize; touch-action: none; }
.cmp-off em.drag { color: var(--accent); }
.cmp-bar .btn.on { color: var(--accent); border-color: var(--accent); }
.cmp-bar .an-btn { position: relative; }
.cmp-ghost { position: fixed; z-index: 70; pointer-events: none; opacity: .92; box-shadow: 0 8px 22px rgb(0 0 0 / .55); background: var(--surface-2, #26272c); border-color: var(--accent) !important; }
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
