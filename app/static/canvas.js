// Canvas boards — an infinite moodboard-style view for arranging library assets freely.
// Self-contained ES module: no imports from index.html (an inline <script type="module"> has no
// URL of its own to import from), so this file owns its own tiny api()/esc() helpers and asset
// metadata cache instead of receiving them by dependency injection. index.html hands it a mount
// element and a getZoomSettings() accessor (state.theme.zoomAxis/zoomSpeed/zoomInvert), so the
// right-drag/wheel zoom feel matches the lightbox's image zoom exactly — see createCanvasView().
//
// The view is always shown split alongside the library grid (index.html's #mainBody puts them
// side by side; a header button toggles whether the grid pane is visible) — there is no back
// button or toolbar here, and no separate "add files" UI, because the grid itself is the source
// for the existing card drag (application/x-sight-ids), same as dropping onto a Collection.

import { runHotkeys } from "/static/keys.js";

const MIN_ZOOM = 0.1, MAX_ZOOM = 4;
const DEFAULT_SIZE = 240;
const MIN_ITEM = 24; // smallest item side, world units
const TRACKED = ["x", "y", "w", "h", "z_index", "rotation", "flip_x", "flip_y", "crop_x", "crop_y", "crop_w", "crop_h"]; // fields a layout command may change
const GRID = 24; // world units between snap-grid points (Ctrl while moving/resizing)

async function api(path, opts){
  const r = await fetch(path, opts);
  if (!r.ok && r.status !== 202) throw new Error(await r.text());
  const ct = r.headers.get("content-type") || "";
  return ct.includes("json") ? r.json() : r;
}
function jsonOpts(method, body){
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
function esc(s){
  return String(s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

let stylesInjected = false;
function injectStyles(){
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
/* :not([hidden]) rather than a bare display:flex here: a same-specificity class rule declared
   after the UA [hidden]{display:none} rule would otherwise win the cascade by source order and
   defeat "hidden" entirely — this way the rule simply doesn't match while hidden is set. */
.canvas-view:not([hidden]) { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--bg); }
.canvas-viewport { position: relative; flex: 1; min-height: 0; overflow: hidden; cursor: default; background-color: var(--surface);
  background-image: radial-gradient(circle, var(--border-strong) 1px, transparent 1px); background-size: 24px 24px;
  user-select: none; -webkit-user-select: none; }
.canvas-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
/* An item is styled exactly like a library card (same theme variables: radius, padding, background,
   frame, hover and active frame). Frame widths are divided by the board zoom (--cz, set in
   worldTransform) so they stay the same on-screen thickness as the library's at any zoom.
   The thumbnail block padding (--card-pad) is divided by the zoom the same way. The frame is an inset box-shadow, not a border: browsers snap border widths to whole layout pixels
   (anything under 1px becomes 1px), so a border divided by the zoom grew back to full size when zoomed
   in; a shadow spread keeps its fractional width. The selected frame is drawn 2x wide because a library
   card's active frame is its border plus an inset shadow of the same width. */
.citem { position: absolute; left: 0; top: 0; border-radius: var(--card-radius); overflow: visible; cursor: grab; touch-action: none; }
.citem .citem-box { position: absolute; inset: 0; display: flex; flex-direction: column; box-sizing: border-box; padding: calc(var(--card-pad) / var(--cz, 1)); border-radius: var(--card-radius); overflow: hidden; background: var(--card-bg); }
.citem .citem-box::after { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; z-index: 3; box-shadow: inset 0 0 0 calc(var(--card-border-w) / var(--cz, 1)) var(--border); }
.citem:hover .citem-box::after { box-shadow: inset 0 0 0 calc(var(--card-hover-border-w) / var(--cz, 1)) var(--card-hover-color); }
.citem.selected .citem-box { background: var(--surface-2); }
.citem.selected .citem-box::after { box-shadow: inset 0 0 0 calc(2 * var(--card-active-border-w) / var(--cz, 1)) var(--card-active-color); }
.citem .citem-thumb { position: relative; flex: 1; min-height: 0; overflow: hidden; border-radius: var(--thumb-radius); background: var(--card-bg); }
.citem img { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; user-select: none; -webkit-user-drag: none; }
.citem .citem-ph { width: 100%; height: 100%; display: grid; place-items: center; padding: 8px; text-align: center; font-size: 11px; color: var(--subtle); }
/* The name is laid over the bottom of the thumbnail (like the library cards), not stacked under it. */
.citem .citem-meta { position: absolute; left: calc(var(--card-pad) / var(--cz, 1)); right: calc(var(--card-pad) / var(--cz, 1)); bottom: calc(var(--card-pad) / var(--cz, 1)); z-index: 2; min-width: 0; padding: 14px 8px 5px; border-radius: 0 0 var(--thumb-radius) var(--thumb-radius); background: linear-gradient(to top, rgb(0 0 0 / .72), rgb(0 0 0 / .4) 62%, transparent); color: #fff; pointer-events: none; text-shadow: 0 1px 2px rgb(0 0 0 / .5); }
.citem .citem-meta .n { font-size: calc(var(--text-size) - 2px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.canvas-no-names .citem .citem-meta { display: none; }
/* Ctrl held = box-select mode (Ctrl-drag draws a marquee even over an item): show a plain arrow instead of the grab hand. */
.canvas-viewport.ctrl-box, .canvas-viewport.ctrl-box .citem { cursor: default; }
/* The transform frame lives in screen space (a sibling of the world, not inside it), so its handles
   keep the same pixel size at any board zoom. One frame: the item's own rotated box when a single item
   is selected, the common bounding box when several are. */
.cframe { position: absolute; left: 0; top: 0; pointer-events: none; transform-origin: 50% 50%; }
.cframe.group { outline: 1px dashed var(--card-active-color); }
.cframe .chandle, .cframe .crot { position: absolute; box-sizing: border-box; width: 12px; height: 12px; border-radius: 50%; background: var(--card-active-color); border: 1.5px solid var(--bg); pointer-events: auto; }
.cframe .chandle { right: -6px; bottom: -6px; cursor: nwse-resize; }
.cframe .crot { left: 50%; top: -22px; margin-left: -6px; cursor: grab; }
/* Crop grips (Alt held over an item): screen-space like the transform frame, so they stay the same size at any zoom. */
.ccrop { position: absolute; left: 0; top: 0; pointer-events: none; transform-origin: 50% 50%; outline: 1px solid var(--card-active-color); }
.ccrop i { position: absolute; pointer-events: auto; background: var(--card-active-color); border: 1px solid var(--bg); box-sizing: border-box; }
.ccrop i[data-edge="l"], .ccrop i[data-edge="r"] { top: 50%; margin-top: -14px; height: 28px; width: 8px; border-radius: 4px; cursor: ew-resize; }
.ccrop i[data-edge="t"], .ccrop i[data-edge="b"] { left: 50%; margin-left: -14px; width: 28px; height: 8px; border-radius: 4px; cursor: ns-resize; }
.ccrop i[data-edge="l"] { left: -4px; } .ccrop i[data-edge="r"] { right: -4px; }
.ccrop i[data-edge="t"] { top: -4px; } .ccrop i[data-edge="b"] { bottom: -4px; }
.ccrop i[data-edge="tl"], .ccrop i[data-edge="tr"], .ccrop i[data-edge="bl"], .ccrop i[data-edge="br"] { width: 14px; height: 14px; border-radius: 3px; }
.canvas-viewport.alt-crop .citem { cursor: move; }
.ccrop i[data-edge="tl"] { left: -7px; top: -7px; cursor: nwse-resize; } .ccrop i[data-edge="br"] { right: -7px; bottom: -7px; cursor: nwse-resize; }
.ccrop i[data-edge="tr"] { right: -7px; top: -7px; cursor: nesw-resize; } .ccrop i[data-edge="bl"] { left: -7px; bottom: -7px; cursor: nesw-resize; }
.canvas-empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--subtle); font-size: 13px; pointer-events: none; text-align: center; padding: 24px; }
`;
  document.head.appendChild(style);
}

// asset_id -> asset record (name/kind/has_thumb/thumb_v/width/height), fetched on demand and
// reused for the lifetime of the page — assets don't change kind/size once indexed.
const assetCache = new Map();
const assetResolved = new Map(); // same records once fetched, readable synchronously (Space preview)
async function getAsset(aid){
  if (assetCache.has(aid)) return assetCache.get(aid);
  const p = api("/api/assets/" + aid).catch(() => null);
  assetCache.set(aid, p);
  const a = await p;
  assetCache.set(aid, a);
  if (a) assetResolved.set(aid, a);
  return a;
}
function thumbUrl(a){
  return "/api/thumb/" + a.id + (a.thumb_v ? "?v=" + a.thumb_v : "");
}

export function createCanvasView({ mount, getZoomSettings, combineSelection, markSmallSrc, syncPixelation, keysEnabled }){
  injectStyles();
  const zoomSettings = getZoomSettings || (() => ({ zoomAxis: "y", zoomSpeed: 1, zoomInvert: false }));

  mount.innerHTML = `<div class="canvas-viewport" data-el="viewport"><div class="canvas-world" data-el="world"></div><div class="cframe" data-el="frame" hidden><div class="chandle" data-act="resize"></div><div class="crot" data-act="rotate"></div></div><div class="ccrop" data-el="crop" hidden><i data-edge="l"></i><i data-edge="r"></i><i data-edge="t"></i><i data-edge="b"></i><i data-edge="tl"></i><i data-edge="tr"></i><i data-edge="bl"></i><i data-edge="br"></i></div></div>`;
  const viewportEl = mount.querySelector('[data-el="viewport"]');
  const worldEl = mount.querySelector('[data-el="world"]');
  const frameEl = mount.querySelector('[data-el="frame"]');
  const cropEl = mount.querySelector('[data-el="crop"]');

  let isOpen = false;
  let boardId = null;
  const items = new Map(); // id -> item record
  const dom = new Map(); // id -> element
  let vx = 0, vy = 0, zoom = 1;
  const selection = new Set();
  let undoStack = [], redoStack = [];
  let drag = null; // active pointer interaction, see pointerdown handlers below
  let emptyMsg = null;

  // Same nearest-neighbour switch as the library thumbnails (index.html's syncPixelation): the
  // on-screen box size is item size * zoom, so it flips as the board is zoomed.
  function syncItemPixelation(item){
    const img = dom.get(item.id)?.querySelector("img");
    if (!img) return;
    if (item.crop_w == null || !img.naturalWidth){ syncPixelation(img, { clientWidth: item.w * zoom, clientHeight: item.h * zoom }); return; }
    const W = item.w * zoom / item.crop_w; // the whole image's on-screen size when cropped
    syncPixelation(img, { clientWidth: W, clientHeight: W * img.naturalHeight / img.naturalWidth });
  }
  function syncAllPixelation(){
    for (const item of items.values()) syncItemPixelation(item);
  }
  // Snap grid, in world units. The background dots are drawn on the same lattice (and follow pan and
  // zoom), so what Ctrl-snap lands on is what the dots show; the step doubles when zoomed far out
  // so the dots never get denser than ~12px on screen.
  function gridStep(){
    let step = GRID;
    while (step * zoom < 12) step *= 2;
    return step;
  }
  const snapTo = (v, step) => Math.round(v / step) * step;
  function worldTransform(){
    worldEl.style.transform = `translate(${vx}px, ${vy}px) scale(${zoom})`;
    worldEl.style.setProperty("--cz", String(zoom));
    const g = gridStep() * zoom;
    viewportEl.style.backgroundSize = `${g}px ${g}px`;
    viewportEl.style.backgroundPosition = `${vx}px ${vy}px`;
    syncAllPixelation();
    updateFrame();
  }
  function screenToWorld(clientX, clientY){
    const r = viewportEl.getBoundingClientRect();
    return { x: (clientX - r.left - vx) / zoom, y: (clientY - r.top - vy) / zoom };
  }
  function zoomAt(px, py, targetZoom){
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, targetZoom));
    const wx = (px - vx) / zoom, wy = (py - vy) / zoom;
    zoom = newZoom;
    vx = px - wx * zoom;
    vy = py - wy * zoom;
    worldTransform();
  }

  function clearWorld(){
    worldEl.innerHTML = "";
    dom.clear();
    items.clear();
    selection.clear();
    updateFrame();
  }

  function buildItemEl(item){
    const el = document.createElement("div");
    el.className = "citem";
    el.dataset.id = item.id;
    el.dataset.assetId = item.asset_id;
    el.innerHTML = `<div class="citem-box"><div class="citem-thumb"><div class="citem-ph">…</div></div><div class="citem-meta"><div class="n"></div></div></div>`;
    el.addEventListener("pointerdown", (e) => {
      if (e.ctrlKey || e.metaKey) return; // Ctrl+drag starts a box-select even over an item — see the viewport handler
      if (e.altKey && e.button === 0){ startCropPan(e, item.id); return; }
      startMove(e, item.id);
    });
    worldEl.appendChild(el);
    getAsset(item.asset_id).then((a) => {
      if (!dom.has(item.id)) return; // item was removed before the fetch resolved
      const thumb = el.querySelector(".citem-thumb");
      el.querySelector(".citem-meta .n").textContent = a ? a.name : "";
      if (a && a.has_thumb){
        thumb.innerHTML = `<img src="${thumbUrl(a)}" draggable="false" alt="">`;
        const img = thumb.querySelector("img");
        img.addEventListener("load", () => { markSmallSrc(img); syncItemPixelation(items.get(item.id) || item); }, { once: true });
        applyCropFlip(items.get(item.id) || item);
      } else {
        thumb.innerHTML = `<div class="citem-ph">${esc(a ? a.name : "?")}</div>`;
      }
    });
    return el;
  }

  function layoutItemEl(item){
    const el = dom.get(item.id);
    if (!el) return;
    el.style.width = item.w + "px";
    el.style.height = item.h + "px";
    el.style.transform = `translate(${item.x}px, ${item.y}px) rotate(${item.rotation || 0}deg)`;
    el.style.zIndex = String(item.z_index || 0);
    el.style.opacity = item.opacity == null ? "1" : String(item.opacity);
    el.classList.toggle("selected", selection.has(item.id));
    applyCropFlip(item);
    syncItemPixelation(item);
    scheduleFrame();
  }

  // Crop is stored as a normalized rectangle of the source image (crop_x/y/w/h, null = uncropped):
  // the image is drawn oversized and offset inside the thumb area, which clips it. Mirroring flips the
  // thumb area as a whole, so the crop rectangle stays in un-mirrored source coordinates.
  function applyCropFlip(item){
    const el = dom.get(item.id);
    if (!el) return;
    const thumb = el.querySelector(".citem-thumb");
    thumb.style.transform = item.flip_x || item.flip_y ? `scale(${item.flip_x ? -1 : 1}, ${item.flip_y ? -1 : 1})` : "";
    const img = thumb.querySelector("img");
    if (!img) return;
    if (item.crop_w == null || item.crop_h == null){ img.style.cssText = ""; return; }
    const cx = item.crop_x || 0, cy = item.crop_y || 0, cw = item.crop_w, ch = item.crop_h;
    // Width alone sets the scale and the height follows the image's own aspect, so the picture can never be stretched,
    // whatever shape the box ends up (the crop window's vertical extent simply follows the box).
    img.style.cssText = `position:absolute;left:0;top:0;max-width:none;width:${100 / cw}%;height:auto;transform:translate(${-cx * 100}%, ${-cy * 100}%)`;
  }

  // ---- crop mode: hold Alt over an item to get grips on its edges and corners -----------------------
  let altDown = false, cropItemId = null, lastPtr = null;
  function updateCrop(){
    const it = cropItemId && items.get(cropItemId);
    viewportEl.classList.toggle("alt-crop", isOpen && altDown);
    if (!isOpen || !it || !(altDown || drag?.kind === "crop")){ cropEl.hidden = true; return; }
    const sw = it.w * zoom, sh = it.h * zoom;
    cropEl.style.width = sw + "px";
    cropEl.style.height = sh + "px";
    cropEl.style.transform = `translate(${vx + (it.x + it.w / 2) * zoom - sw / 2}px, ${vy + (it.y + it.h / 2) * zoom - sh / 2}px) rotate(${it.rotation || 0}deg)`;
    cropEl.hidden = false;
  }
  // Which item the Alt-crop grips belong to: the one under the pointer (or the current one while the
  // pointer is on its grips, which sit on top of the item).
  function refreshCropTarget(){
    if (!lastPtr || drag?.kind === "crop" || drag?.kind === "croppan") return;
    const under = document.elementFromPoint(lastPtr.x, lastPtr.y);
    if (under?.closest?.(".ccrop")) return;
    cropItemId = under?.closest?.(".citem")?.dataset.id || null;
    updateCrop();
  }
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Alt" || !isOpen) return;
    e.preventDefault(); // a bare Alt tap would otherwise focus the browser menu
    altDown = true;
    refreshCropTarget();
    updateCrop();
  });
  window.addEventListener("keyup", (e) => {
    if (e.key !== "Alt") return;
    if (isOpen) e.preventDefault();
    altDown = false;
    updateCrop();
  });
  window.addEventListener("blur", () => { altDown = false; updateCrop(); });

  // Dragging a grip moves that edge of the item's box and the matching edge of the crop rectangle by the
  // same amount, so the image itself stays where it is. Deltas are taken along the item's own (possibly
  // rotated) axes; edges can also be dragged back out until the full image shows again.
  // basis: the item's thumb area and the whole image's on-screen size (S = px per full image, per axis), plus the
  // crop window as it is drawn right now (an uncropped item shows the cover-fitted window, so cropping never jumps).
  function cropBasis(it){
    const thumb = dom.get(it.id).querySelector(".citem-thumb"), img = thumb.querySelector("img");
    const tw = Math.max(8, thumb.clientWidth), th = Math.max(8, thumb.clientHeight);
    const a = assetResolved.get(it.asset_id);
    const R = img && img.naturalWidth ? img.naturalWidth / img.naturalHeight : (a && a.width && a.height ? a.width / a.height : tw / th);
    let Sx, x, y, w;
    if (it.crop_w == null){ Sx = Math.max(tw, th * R); w = tw / Sx; x = (1 - w) / 2; y = null; }
    else { Sx = tw / it.crop_w; w = it.crop_w; x = it.crop_x || 0; y = it.crop_y || 0; }
    const Sy = Sx / R, h = Math.min(1, th / Sy);
    if (y == null) y = (1 - h) / 2;
    y = Math.max(0, Math.min(y, 1 - h));
    return { tw, th, Sx, Sy, k: { x, y, w, h } };
  }
  const sameCrop = (cx, cy, cw, ch) => cw > 0.9999 && ch > 0.9999 && cx < 0.0001 && cy < 0.0001;
  // Dragging a grip moves that edge of the item's box and the matching edge of the crop window by the same
  // amount, so the image itself stays where it is. Deltas are taken along the item's own (possibly rotated)
  // axes; an edge can also be dragged back out until the full image shows again.
  function cropAxis(edgeIsLow, m, size0, S, pos0, len0, flipped){
    const t0 = len0 * S;
    const srcLow = edgeIsLow !== flipped; // does this screen edge sit at the low end of the source image?
    const lmax = srcLow ? pos0 + len0 : 1 - pos0; // longest the window may become without leaving the image
    let lo, hi;
    if (edgeIsLow){ hi = Math.min(size0 - MIN_ITEM, t0 - 4); lo = (len0 - lmax) * S; }
    else { lo = Math.max(MIN_ITEM - size0, 4 - t0); hi = (lmax - len0) * S; }
    m = Math.min(hi, Math.max(lo, m));
    const len = edgeIsLow ? len0 - m / S : len0 + m / S;
    const pos = srcLow ? pos0 + len0 - len : pos0;
    return { m, size: edgeIsLow ? size0 - m : size0 + m, pos, len };
  }
  function startCrop(e){
    if (e.button !== 0) return;
    const it = cropItemId && items.get(cropItemId);
    if (!it) return;
    e.stopPropagation();
    e.preventDefault();
    const basis = cropBasis(it);
    drag = { kind: "crop", id: it.id, ids: [it.id], edge: e.currentTarget.dataset.edge, basis, crop0: basis.k, start: { ...it }, startWorld: screenToWorld(e.clientX, e.clientY), moved: false, before: [{ ...it }] };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  }
  // Alt + drag on the picture itself: pan the image inside its crop window (the box stays put).
  function startCropPan(e, id){
    e.stopPropagation();
    e.preventDefault();
    const it = items.get(id);
    const basis = cropBasis(it);
    drag = { kind: "croppan", id, ids: [id], basis, crop0: basis.k, start: { ...it }, startWorld: screenToWorld(e.clientX, e.clientY), moved: false, before: [{ ...it }] };
    el_setPointerCapture(e);
  }
  for (const grip of cropEl.querySelectorAll("i")) grip.addEventListener("pointerdown", startCrop);

  // ---- transform frame (screen space) --------------------------------------------------------
  let frameRAF = 0;
  function scheduleFrame(){
    if (!frameRAF) frameRAF = requestAnimationFrame(() => { frameRAF = 0; updateFrame(); });
  }
  function updateFrame(){
    updateSelectionFrame();
    updateCrop();
  }
  function updateSelectionFrame(){
    const list = [...selection].map((id) => items.get(id)).filter(Boolean);
    if (!isOpen || !list.length){ frameEl.hidden = true; return; }
    let cx, cy, w, h, rot = 0;
    if (list.length === 1){
      const it = list[0];
      cx = it.x + it.w / 2; cy = it.y + it.h / 2; w = it.w; h = it.h; rot = it.rotation || 0;
    } else {
      const u = unionOf(list);
      w = u.r - u.l; h = u.b - u.t; cx = (u.l + u.r) / 2; cy = (u.t + u.b) / 2;
    }
    const sw = w * zoom, sh = h * zoom;
    frameEl.style.width = sw + "px";
    frameEl.style.height = sh + "px";
    frameEl.style.transform = `translate(${vx + cx * zoom - sw / 2}px, ${vy + cy * zoom - sh / 2}px) rotate(${rot}deg)`;
    frameEl.classList.toggle("group", list.length > 1);
    frameEl.hidden = false;
  }

  function addItemLocal(item){
    items.set(item.id, item);
    dom.set(item.id, buildItemEl(item));
    layoutItemEl(item);
    updateEmptyState();
  }
  function removeItemLocal(id){
    const el = dom.get(id);
    if (el) el.remove();
    dom.delete(id);
    items.delete(id);
    selection.delete(id);
    if (cropItemId === id) cropItemId = null;
    updateEmptyState();
    updateFrame();
  }
  function updateEmptyState(){
    if (emptyMsg) { emptyMsg.remove(); emptyMsg = null; }
    if (items.size === 0){
      emptyMsg = document.createElement("div");
      emptyMsg.className = "canvas-empty";
      emptyMsg.textContent = "Drag files here from the library to place them on this board.";
      viewportEl.appendChild(emptyMsg);
    }
  }

  function setSelection(ids){
    selection.clear();
    for (const id of ids) selection.add(id);
    for (const item of items.values()) layoutItemEl(item);
    updateFrame();
  }
  function applyMarqueeSelection(mode, origin, hits){
    setSelection(combineSelection(mode, origin, hits)); // same rules as the library grid's box-select
  }
  function selectAll(){ setSelection([...items.keys()]); }
  function toggleInSelection(id){
    setSelection(selection.has(id) ? [...selection].filter((x) => x !== id) : [...selection, id]);
  }

  // Fit the given items (or all) into the viewport. Rotated items count by their rotated corners.
  function frameItems(list){
    if (!list.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const it of list){
      const cx = it.x + it.w / 2, cy = it.y + it.h / 2, rad = (it.rotation || 0) * Math.PI / 180;
      const c = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad));
      const hw = (it.w * c + it.h * s) / 2, hh = (it.w * s + it.h * c) / 2;
      minX = Math.min(minX, cx - hw); maxX = Math.max(maxX, cx + hw);
      minY = Math.min(minY, cy - hh); maxY = Math.max(maxY, cy + hh);
    }
    const r = viewportEl.getBoundingClientRect();
    const pad = 48;
    const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((r.width - pad * 2) / bw, (r.height - pad * 2) / bh)));
    vx = r.width / 2 - (minX + bw / 2) * zoom;
    vy = r.height / 2 - (minY + bh / 2) * zoom;
    worldTransform();
  }

  // ---- persistence -------------------------------------------------------------------------
  let saveTimer = 0;
  const dirty = new Map(); // id -> partial fields pending a batch PATCH
  function scheduleSave(id, fields){
    dirty.set(id, { ...(dirty.get(id) || {}), ...fields });
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 300);
  }
  async function flushSave(){
    if (!dirty.size) return;
    const rows = [...dirty.entries()].map(([id, fields]) => ({ id, ...fields }));
    dirty.clear();
    try { await api(`/api/boards/${boardId}/items/batch`, jsonOpts("POST", { items: rows })); } catch {}
  }

  // ---- undo/redo ----------------------------------------------------------------------------
  // Each entry knows how to undo() and redo() itself against local state + the server. Kept
  // deliberately simple (whole-item snapshots) rather than a generic diff/patch engine.
  function pushUndo(entry){
    undoStack.push(entry);
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
  }
  function applyItemsSnapshot(snap){
    for (const snapItem of snap){
      const s = { ...snapItem }; // copy: later edits must not mutate the undo entry itself
      items.set(s.id, s);
      if (!dom.has(s.id)) addItemLocal(s);
      else layoutItemEl(s);
      scheduleSave(s.id, s);
    }
  }
  function deleteOnServer(itemList){
    return api(`/api/boards/${boardId}/items/batch-delete`, jsonOpts("POST", { ids: itemList.map((i) => i.id) })).catch(() => {});
  }
  // Undo of a delete (and redo of an add) recreates the rows server-side rather than restoring
  // the old ones — board_items ids are content-hashed with a creation timestamp, so there's no
  // "undelete" endpoint. The fresh ids are written back onto `entry.items` so a *later* undo/redo
  // of this same entry deletes/recreates the right server rows instead of drifting out of sync.
  const createBody = (it, extra = {}) => ({
    asset_id: it.asset_id, x: it.x, y: it.y, w: it.w, h: it.h, rotation: it.rotation, z_index: it.z_index, opacity: it.opacity,
    crop_x: it.crop_x, crop_y: it.crop_y, crop_w: it.crop_w, crop_h: it.crop_h, flip_x: it.flip_x, flip_y: it.flip_y, ...extra,
  });
  async function recreateOnServer(entry){
    const fresh = [];
    for (const it of entry.items){
      try {
        const created = await api(`/api/boards/${boardId}/items`, jsonOpts("POST", createBody(it)));
        addItemLocal(created);
        fresh.push(created);
      } catch {}
    }
    entry.items = fresh;
  }
  function undo(){
    const entry = undoStack.pop();
    if (!entry) return;
    redoStack.push(entry);
    if (entry.type === "move"){ applyItemsSnapshot(entry.before); }
    else if (entry.type === "add"){ for (const it of entry.items) removeItemLocal(it.id); deleteOnServer(entry.items); }
    else if (entry.type === "delete"){ recreateOnServer(entry); }
  }
  function redo(){
    const entry = redoStack.pop();
    if (!entry) return;
    undoStack.push(entry);
    if (entry.type === "move"){ applyItemsSnapshot(entry.after); }
    else if (entry.type === "add"){ recreateOnServer(entry); }
    else if (entry.type === "delete"){ for (const it of entry.items) removeItemLocal(it.id); deleteOnServer(entry.items); }
  }

  // ---- move / resize / rotate ---------------------------------------------------------------
  function startMove(e, id){
    if (e.button !== undefined && e.button !== 0) return;
    e.stopPropagation();
    if (!selection.has(id)) setSelection(e.shiftKey ? [...selection, id] : [id]);
    const startWorld = screenToWorld(e.clientX, e.clientY);
    const starts = [...selection].map((sid) => ({ id: sid, x: items.get(sid).x, y: items.get(sid).y }));
    const before = starts.map((s) => ({ ...items.get(s.id) }));
    drag = { kind: "move", id, ids: starts.map((s) => s.id), startWorld, starts, pointerId: e.pointerId, moved: false, before };
    el_setPointerCapture(e);
  }
  // The frame's handles act on the whole selection: one item resizes/rotates by itself, several are
  // scaled (uniformly, from the frame's top-left) or rotated (about its centre) together.
  function startResize(e){
    if (e.button !== 0) return;
    const list = [...selection].map((id) => items.get(id)).filter(Boolean);
    if (!list.length) return;
    e.stopPropagation();
    const before = list.map((it) => ({ ...it }));
    const startWorld = screenToWorld(e.clientX, e.clientY);
    if (list.length === 1){
      const item = list[0];
      const a = assetResolved.get(item.asset_id);
      const ratio = a && a.width && a.height ? a.width / a.height : item.w / item.h;
      let cropInfo = null;
      if (item.crop_w != null){
        const b = cropBasis(item);
        cropInfo = { tw: b.tw, th: b.th, padW: item.w - b.tw, padH: item.h - b.th };
      }
      drag = { kind: "resize", id: item.id, ids: [item.id], ratio, startWorld, startW: item.w, startH: item.h, moved: false, before, cropInfo };
    } else {
      const u = unionOf(list);
      drag = { kind: "gresize", ids: list.map((it) => it.id), l: u.l, t: u.t, w: u.r - u.l, h: u.b - u.t, starts: before, moved: false, before };
    }
    el_setPointerCapture(e);
  }
  function startRotate(e){
    if (e.button !== 0) return;
    const list = [...selection].map((id) => items.get(id)).filter(Boolean);
    if (!list.length) return;
    e.stopPropagation();
    const before = list.map((it) => ({ ...it }));
    const w0 = screenToWorld(e.clientX, e.clientY);
    if (list.length === 1){
      const item = list[0];
      const cx = item.x + item.w / 2, cy = item.y + item.h / 2;
      const startAngle = Math.atan2(w0.y - cy, w0.x - cx) * 180 / Math.PI;
      drag = { kind: "rotate", id: item.id, ids: [item.id], cx, cy, startAngle, startRotation: item.rotation || 0, moved: false, before };
    } else {
      const u = unionOf(list);
      const cx = (u.l + u.r) / 2, cy = (u.t + u.b) / 2;
      drag = { kind: "grotate", ids: list.map((it) => it.id), cx, cy, startAngle: Math.atan2(w0.y - cy, w0.x - cx) * 180 / Math.PI, starts: before, moved: false, before };
    }
    el_setPointerCapture(e);
  }
  frameEl.querySelector('[data-act="resize"]').addEventListener("pointerdown", startResize);
  frameEl.querySelector('[data-act="rotate"]').addEventListener("pointerdown", startRotate);
  function el_setPointerCapture(e){
    try { e.target.setPointerCapture(e.pointerId); } catch {}
  }

  // Un-crops an item mid-resize: the box grows outward to the full image at the same scale (the picture stays
  // put), then the resize carries on from that box.
  function uncropForResize(it, d, pointerWorld){
    const B = cropBasis(it), k = B.k;
    const fx = !!it.flip_x, fy = !!it.flip_y;
    const lowX = k.x * B.Sx, highX = (1 - k.x - k.w) * B.Sx, lowY = k.y * B.Sy, highY = (1 - k.y - k.h) * B.Sy;
    const extL = fx ? highX : lowX, extR = fx ? lowX : highX, extT = fy ? highY : lowY, extB = fy ? lowY : highY;
    const rad = (it.rotation || 0) * Math.PI / 180, c = Math.cos(rad), sn = Math.sin(rad);
    const ax = (extR - extL) / 2, ay = (extB - extT) / 2;
    const ncx = it.x + it.w / 2 + ax * c - ay * sn, ncy = it.y + it.h / 2 + ax * sn + ay * c;
    it.w += extL + extR; it.h += extT + extB;
    it.x = ncx - it.w / 2; it.y = ncy - it.h / 2;
    it.crop_x = it.crop_y = it.crop_w = it.crop_h = null;
    d.cropInfo = null;
    d.startW = it.w; d.startH = it.h;
    d.startWorld = pointerWorld;
    layoutItemEl(it);
  }

  function onPointerMove(e){
    if (drag && (drag.kind === "move" || drag.kind === "resize" || drag.kind === "rotate" || drag.kind === "gresize" || drag.kind === "grotate" || drag.kind === "crop" || drag.kind === "croppan")){
      drag.moved = true;
      if (drag.kind === "move"){
        const w = screenToWorld(e.clientX, e.clientY);
        let dx = w.x - drag.startWorld.x, dy = w.y - drag.startWorld.y;
        // Ctrl held once the drag is under way (Ctrl at press would start a box-select instead):
        // snap the grabbed item's corner to the grid, the rest of the selection keeps its offsets.
        if (e.ctrlKey || e.metaKey){
          const anchor = drag.starts.find((s) => s.id === drag.id) || drag.starts[0];
          const step = gridStep();
          dx = snapTo(anchor.x + dx, step) - anchor.x;
          dy = snapTo(anchor.y + dy, step) - anchor.y;
        }
        for (const s of drag.starts){
          const it = items.get(s.id);
          it.x = s.x + dx; it.y = s.y + dy;
          layoutItemEl(it);
        }
      } else if (drag.kind === "resize"){
        const w = screenToWorld(e.clientX, e.clientY);
        const it = items.get(drag.id);
        if (drag.cropInfo && e.shiftKey){ // Shift while resizing: drop the crop, showing the whole image again
          uncropForResize(it, drag, w);
        }
        let nw = drag.startW + (w.x - drag.startWorld.x), nh = drag.startH + (w.y - drag.startWorld.y);
        if (e.ctrlKey || e.metaKey){ // snap the bottom-right corner to the grid
          const step = gridStep();
          nw = snapTo(it.x + nw, step) - it.x;
          nh = snapTo(it.y + nh, step) - it.y;
        }
        if (drag.cropInfo){
          // A cropped picture keeps its proportions: the thumb area scales uniformly, the card padding stays fixed.
          const ci = drag.cropInfo;
          const kMin = Math.max((MIN_ITEM - ci.padW) / ci.tw, (MIN_ITEM - ci.padH) / ci.th, 0.02);
          const k = Math.max(kMin, (nw - ci.padW) / ci.tw, (nh - ci.padH) / ci.th);
          nw = ci.padW + ci.tw * k;
          nh = ci.padH + ci.th * k;
        } else if (e.shiftKey){
          // Lock the asset's original proportions (the item's own if the asset size is unknown);
          // the larger of the two requested dimensions wins so the corner always follows the cursor.
          const ar = drag.ratio;
          const wFromH = nh * ar;
          nw = Math.max(nw, wFromH, MIN_ITEM, MIN_ITEM * ar);
          nh = nw / ar;
        } else {
          nw = Math.max(MIN_ITEM, nw);
          nh = Math.max(MIN_ITEM, nh);
        }
        it.w = nw;
        it.h = nh;
        layoutItemEl(it);
      } else if (drag.kind === "rotate"){
        const w = screenToWorld(e.clientX, e.clientY);
        const angle = Math.atan2(w.y - drag.cy, w.x - drag.cx) * 180 / Math.PI;
        const it = items.get(drag.id);
        let rotation = drag.startRotation + (angle - drag.startAngle);
        if (e.shiftKey) rotation = Math.round(rotation / 15) * 15; // snap to absolute 15° steps
        it.rotation = Math.round(rotation);
        layoutItemEl(it);
      } else if (drag.kind === "crop" || drag.kind === "croppan"){
        const w = screenToWorld(e.clientX, e.clientY);
        const dxw = w.x - drag.startWorld.x, dyw = w.y - drag.startWorld.y;
        const rad = (drag.start.rotation || 0) * Math.PI / 180, c = Math.cos(rad), sn = Math.sin(rad);
        const dx = dxw * c + dyw * sn, dy = -dxw * sn + dyw * c; // pointer movement along the item's own axes
        const st = drag.start, k = drag.crop0, B = drag.basis, it = items.get(drag.id);
        const fx = !!st.flip_x, fy = !!st.flip_y;
        let cx = k.x, cw = k.w, cy = k.y, ch = k.h;
        if (drag.kind === "croppan"){
          cx = Math.max(0, Math.min(1 - k.w, k.x - (fx ? -1 : 1) * dx / B.Sx));
          cy = Math.max(0, Math.min(1 - k.h, k.y - (fy ? -1 : 1) * dy / B.Sy));
        } else {
          const edge = drag.edge;
          const horiz = edge.includes("l") || edge.includes("r"), vert = edge.includes("t") || edge.includes("b");
          let mx = 0, my = 0, nw = st.w, nh = st.h;
          if (horiz){ const r = cropAxis(edge.includes("l"), dx, st.w, B.Sx, k.x, k.w, fx); mx = r.m; nw = r.size; cx = r.pos; cw = r.len; }
          if (vert){ const r = cropAxis(edge.includes("t"), dy, st.h, B.Sy, k.y, k.h, fy); my = r.m; nh = r.size; cy = r.pos; ch = r.len; }
          // The box's centre moves by half of each edge's movement, along the item's own axes.
          const ax = horiz ? mx / 2 : 0, ay = vert ? my / 2 : 0;
          const ncx = st.x + st.w / 2 + ax * c - ay * sn, ncy = st.y + st.h / 2 + ax * sn + ay * c;
          it.w = nw; it.h = nh; it.x = ncx - nw / 2; it.y = ncy - nh / 2;
        }
        const full = sameCrop(cx, cy, cw, ch);
        it.crop_x = full ? null : cx; it.crop_y = full ? null : cy; it.crop_w = full ? null : cw; it.crop_h = full ? null : ch;
        layoutItemEl(it);
      } else if (drag.kind === "gresize"){
        const w = screenToWorld(e.clientX, e.clientY);
        const minScale = Math.max(...drag.starts.map((st) => MIN_ITEM / Math.min(st.w, st.h)));
        const scale = Math.max(minScale, (w.x - drag.l) / drag.w, (w.y - drag.t) / drag.h);
        for (const st of drag.starts){
          const it = items.get(st.id);
          const cx = drag.l + (st.x + st.w / 2 - drag.l) * scale, cy = drag.t + (st.y + st.h / 2 - drag.t) * scale;
          it.w = st.w * scale; it.h = st.h * scale;
          it.x = cx - it.w / 2; it.y = cy - it.h / 2;
          layoutItemEl(it);
        }
      } else if (drag.kind === "grotate"){
        const w = screenToWorld(e.clientX, e.clientY);
        let delta = Math.atan2(w.y - drag.cy, w.x - drag.cx) * 180 / Math.PI - drag.startAngle;
        delta = e.shiftKey ? Math.round(delta / 15) * 15 : Math.round(delta);
        const rad = delta * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
        for (const st of drag.starts){
          const it = items.get(st.id);
          const dx = st.x + st.w / 2 - drag.cx, dy = st.y + st.h / 2 - drag.cy;
          it.x = drag.cx + dx * cos - dy * sin - it.w / 2;
          it.y = drag.cy + dx * sin + dy * cos - it.h / 2;
          it.rotation = (st.rotation || 0) + delta;
          layoutItemEl(it);
        }
      }
      updateFrame();
      return;
    }
    if (drag && drag.kind === "marquee"){
      const w = e.clientX - drag.startClient.x, h = e.clientY - drag.startClient.y;
      if (!drag.active && Math.hypot(w, h) > 4){
        drag.active = true;
        drag.el = document.createElement("div");
        drag.el.className = "marquee";
        document.body.appendChild(drag.el);
      }
      if (drag.active){
        const x = Math.min(drag.startClient.x, e.clientX), y = Math.min(drag.startClient.y, e.clientY);
        Object.assign(drag.el.style, { left: x + "px", top: y + "px", width: Math.abs(w) + "px", height: Math.abs(h) + "px" });
        const a = screenToWorld(x, y), b = screenToWorld(x + Math.abs(w), y + Math.abs(h));
        const hits = [...items.values()].filter((it) => it.x < b.x && it.x + it.w > a.x && it.y < b.y && it.y + it.h > a.y).map((it) => it.id);
        applyMarqueeSelection(drag.mode, drag.origin, hits);
      }
      return;
    }
    if (drag && drag.kind === "pan"){
      vx = drag.startVx + (e.clientX - drag.startClient.x);
      vy = drag.startVy + (e.clientY - drag.startClient.y);
      worldTransform();
      return;
    }
    if (drag && drag.kind === "zoomdrag"){
      // Right-drag zoom: same formula, and the same theme axis/speed/invert knobs, as the
      // lightbox's image zoom (bindStageDrag in index.html) — one zoom control everywhere.
      const zs = zoomSettings();
      const raw = zs.zoomAxis === "x" ? (e.clientX - drag.x) : (drag.y - e.clientY);
      const d = (zs.zoomInvert ? -raw : raw) * 0.012 * (zs.zoomSpeed ?? 1);
      zoomAt(drag.mx, drag.my, drag.scale * Math.exp(d));
    }
  }
  function onPointerUp(){
    if (!drag) return;
    if (drag.ids && drag.moved){
      const after = drag.ids.map((id) => ({ ...items.get(id) }));
      pushUndo({ type: "move", before: drag.before, after });
      for (const it of after) scheduleSave(it.id, it);
    } else if (drag.kind === "marquee"){
      if (drag.el) drag.el.remove();
      if (!drag.active && drag.mode === "replace") setSelection([]);
      else if (!drag.active && drag.itemId && items.has(drag.itemId)) toggleInSelection(drag.itemId);
    }
    drag = null;
  }

  // ---- background: pan (middle button, or Alt+left), right-drag zoom, marquee-select --------
  // Middle/right-button handling is checked before the "did we actually click the background"
  // gate below so pan/zoom work with the cursor over an item too, not just over empty canvas.
  viewportEl.addEventListener("pointerdown", (e) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)){
      e.preventDefault();
      drag = { kind: "pan", startClient: { x: e.clientX, y: e.clientY }, startVx: vx, startVy: vy };
      viewportEl.style.cursor = "grabbing";
      el_setPointerCapture(e);
      return;
    }
    if (e.button === 2){
      e.preventDefault();
      const r = viewportEl.getBoundingClientRect();
      drag = { kind: "zoomdrag", x: e.clientX, y: e.clientY, mx: e.clientX - r.left, my: e.clientY - r.top, scale: zoom };
      el_setPointerCapture(e);
      return;
    }
    if (e.button !== 0) return;
    // Same as the grid: Ctrl starts a box-select anywhere, including over an item; a Ctrl-click
    // that never grows into a box toggles the item under the cursor (see onPointerUp).
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl){
      e.preventDefault();
      const hit = e.target.closest?.(".citem");
      drag = { kind: "marquee", startClient: { x: e.clientX, y: e.clientY }, mode: e.shiftKey ? "add" : "toggle", active: false, origin: [...selection], itemId: hit?.dataset.id || null };
      el_setPointerCapture(e);
      return;
    }
    if (e.target !== viewportEl && e.target !== worldEl) return; // clicked an item — its own handler deals with it
    if (!e.shiftKey){
      e.preventDefault();
      drag = { kind: "marquee", startClient: { x: e.clientX, y: e.clientY }, mode: "replace", active: false, origin: [...selection] };
      el_setPointerCapture(e);
    }
  });
  // Ctrl (or Cmd) held: arrow cursor, so it is clear the box-select mode is armed. Tracked from the
  // key events, and re-synced from pointer events in case the key went up while the window was unfocused.
  const setCtrlCursor = (on) => viewportEl.classList.toggle("ctrl-box", on);
  window.addEventListener("keydown", (e) => { if (e.key === "Control" || e.key === "Meta") setCtrlCursor(true); });
  window.addEventListener("keyup", (e) => { if (e.key === "Control" || e.key === "Meta") setCtrlCursor(false); });
  window.addEventListener("blur", () => setCtrlCursor(false));
  window.addEventListener("pointermove", (e) => {
    if (!isOpen) return;
    setCtrlCursor(e.ctrlKey || e.metaKey);
    lastPtr = { x: e.clientX, y: e.clientY };
    if (altDown !== e.altKey){ altDown = e.altKey; updateCrop(); }
    onPointerMove(e);
    if (altDown) refreshCropTarget();
  });
  window.addEventListener("pointerup", () => {
    if (!isOpen) return;
    if (drag && drag.kind === "pan") viewportEl.style.cursor = "default";
    onPointerUp();
  });
  viewportEl.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = viewportEl.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    if (e.ctrlKey || e.metaKey){
      const zs = zoomSettings();
      const d = (zs.zoomInvert ? e.deltaY : -e.deltaY) * 0.0016 * (zs.zoomSpeed ?? 1);
      zoomAt(px, py, zoom * Math.exp(d));
    } else {
      vx -= e.deltaX; vy -= e.deltaY;
      worldTransform();
    }
  }, { passive: false });

  // ---- placing assets: drag a card in from the library grid (now shown side by side, see
  // index.html's split view) the same way dropping onto a Collection already works. ----------
  async function placeAssetsAt(ids, anchor){
    const created = [];
    let i = 0;
    for (const aid of ids){
      const a = await getAsset(aid);
      let w = DEFAULT_SIZE, h = DEFAULT_SIZE;
      if (a && a.width && a.height){
        const ar = a.width / a.height;
        if (ar >= 1) { w = DEFAULT_SIZE; h = Math.round(DEFAULT_SIZE / ar); }
        else { h = DEFAULT_SIZE; w = Math.round(DEFAULT_SIZE * ar); }
      }
      const x = anchor.x - w / 2 + i * 24, y = anchor.y - h / 2 + i * 24;
      const maxZ = Math.max(0, ...[...items.values()].map((it) => it.z_index || 0));
      try {
        const item = await api(`/api/boards/${boardId}/items`, jsonOpts("POST", { asset_id: aid, x, y, w, h, z_index: maxZ + 1 }));
        addItemLocal(item);
        created.push(item);
      } catch {}
      i++;
    }
    if (created.length) pushUndo({ type: "add", items: created });
    return created;
  }
  viewportEl.addEventListener("dragover", (e) => {
    if (!e.dataTransfer.types.includes("application/x-sight-ids")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  viewportEl.addEventListener("drop", (e) => {
    if (!e.dataTransfer.types.includes("application/x-sight-ids")) return;
    e.preventDefault();
    let ids = [];
    try { ids = JSON.parse(e.dataTransfer.getData("application/x-sight-ids")); } catch { return; }
    if (Array.isArray(ids) && ids.length) placeAssetsAt(ids, screenToWorld(e.clientX, e.clientY));
  });

  // ---- arrange / align / normalize --------------------------------------------------------------
  // Mirrors PureRef's Arrange menu and shortcuts. Like PureRef, each command acts on the selected
  // items, or on every item when nothing is selected. Layout works on each item's rotated bounding
  // box; the only setting PureRef exposes here, "alignment padding", is its default of 10.
  const PAD = 10;
  const arrangeTargets = () => (selection.size ? [...selection] : [...items.keys()]).map((id) => items.get(id)).filter(Boolean);
  function boundsOf(it){
    const rad = (it.rotation || 0) * Math.PI / 180;
    const c = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad));
    const hw = (it.w * c + it.h * s) / 2, hh = (it.w * s + it.h * c) / 2;
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
    return { l: cx - hw, r: cx + hw, t: cy - hh, b: cy + hh };
  }
  function unionOf(list){
    const u = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity };
    for (const it of list){
      const b = boundsOf(it);
      u.l = Math.min(u.l, b.l); u.t = Math.min(u.t, b.t); u.r = Math.max(u.r, b.r); u.b = Math.max(u.b, b.b);
    }
    return u;
  }
  function moveBoundsTo(it, l, t){
    const b = boundsOf(it);
    it.x += l - b.l;
    it.y += t - b.t;
  }
  // Runs `mutate` over the items, then repaints, saves and records ONE undo step (no-op if nothing changed).
  function commitLayout(list, mutate){
    const before = list.map((it) => ({ ...it }));
    mutate();
    const same = list.every((it, i) => TRACKED.every((f) => (Number(it[f]) || 0) === (Number(before[i][f]) || 0) || Math.abs((Number(it[f]) || 0) - (Number(before[i][f]) || 0)) < 0.01));
    for (const it of list) layoutItemEl(it);
    if (same) return false;
    const after = list.map((it) => ({ ...it }));
    pushUndo({ type: "move", before, after });
    for (const it of after) scheduleSave(it.id, it);
    return true;
  }

  // Align left/right/top/bottom (Ctrl+arrows), like PureRef: items are pushed toward that edge of the
  // selection's box and stop against each other (with the padding) instead of piling up, so they end up
  // lined up along their edges. Items that share no rows/columns slide all the way to the edge.
  function gravity(list, axis, sign){
    const x = axis === "x";
    const lo = (b) => (x ? b.l : b.t), hi = (b) => (x ? b.r : b.b);
    const plo = (b) => (x ? b.t : b.l), phi = (b) => (x ? b.b : b.r);
    const u = unionOf(list);
    const sorted = [...list].sort((a, b) => (sign < 0 ? lo(boundsOf(a)) - lo(boundsOf(b)) : hi(boundsOf(b)) - hi(boundsOf(a))));
    const placed = [];
    for (const it of sorted){
      const b = boundsOf(it);
      let newLo;
      if (sign < 0){
        newLo = lo(u);
        for (const p of placed){ const pb = boundsOf(p); if (plo(pb) < phi(b) && phi(pb) > plo(b)) newLo = Math.max(newLo, hi(pb) + PAD); }
      } else {
        let newHi = hi(u);
        for (const p of placed){ const pb = boundsOf(p); if (plo(pb) < phi(b) && phi(pb) > plo(b)) newHi = Math.min(newHi, lo(pb) - PAD); }
        newLo = newHi - (hi(b) - lo(b));
      }
      if (x) moveBoundsTo(it, newLo, b.t); else moveBoundsTo(it, b.l, newLo);
      placed.push(it);
    }
  }
  function alignItems(dir){
    const list = arrangeTargets();
    if (list.length < 2) return;
    commitLayout(list, () => gravity(list, dir === "left" || dir === "right" ? "x" : "y", dir === "left" || dir === "top" ? -1 : 1));
  }

  // Pushes overlapping items apart (along the axis with the smaller overlap, half each) until every
  // pair is clear of each other by the padding. Used after Normalize, which can make items collide.
  function separateItems(list){
    for (let pass = 0; pass < 200; pass++){
      let moved = false;
      for (let i = 0; i < list.length; i++){
        for (let j = i + 1; j < list.length; j++){
          const a = boundsOf(list[i]), b = boundsOf(list[j]);
          const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l) + PAD, oy = Math.min(a.b, b.b) - Math.max(a.t, b.t) + PAD;
          if (ox <= 0 || oy <= 0) continue;
          moved = true;
          if (ox < oy){
            const d = ox / 2 + 0.01, dir = (a.l + a.r) / 2 <= (b.l + b.r) / 2 ? -1 : 1;
            list[i].x += dir * d; list[j].x -= dir * d;
          } else {
            const d = oy / 2 + 0.01, dir = (a.t + a.b) / 2 <= (b.t + b.b) / 2 ? -1 : 1;
            list[i].y += dir * d; list[j].y -= dir * d;
          }
        }
      }
      if (!moved) break;
    }
  }

  // Normalize height/width/size/scale (Ctrl+Alt+arrows): resize proportionally, about each item's
  // centre, to the average of the selection. "Size" matches the on-screen area; "scale" matches the
  // zoom relative to each image's native pixels (items whose asset has no pixel size are left alone).
  function nativeSize(it){
    const a = assetResolved.get(it.asset_id);
    return a && a.width && a.height ? a : null;
  }
  function normalizeItems(kind){
    const list = arrangeTargets();
    if (list.length < 2) return;
    const mean = (f, arr = list) => arr.reduce((s, it) => s + f(it), 0) / arr.length;
    let factor;
    if (kind === "height"){ const t = mean((it) => it.h); factor = (it) => t / it.h; }
    else if (kind === "width"){ const t = mean((it) => it.w); factor = (it) => t / it.w; }
    else if (kind === "size"){ const t = mean((it) => Math.sqrt(it.w * it.h)); factor = (it) => t / Math.sqrt(it.w * it.h); }
    else {
      const known = list.filter(nativeSize);
      if (known.length < 2) return;
      const s = mean((it) => it.w / nativeSize(it).width, known);
      factor = (it) => { const n = nativeSize(it); return n ? (n.width * s) / it.w : 1; };
    }
    commitLayout(list, () => {
      for (const it of list){
        const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
        const k = Math.max(factor(it), MIN_ITEM / Math.min(it.w, it.h));
        it.w *= k; it.h *= k;
        it.x = cx - it.w / 2; it.y = cy - it.h / 2;
      }
      separateItems(list); // like PureRef, normalized items line up along their edges instead of overlapping
    });
  }

  // Distribute horizontal/vertical (Ctrl+Alt+Shift+Up/Down): one neat row (or column), in the items'
  // current left-to-right (top-to-bottom) order, starting at the selection's top-left.
  function distributeItems(axis){
    const list = arrangeTargets();
    if (list.length < 2) return;
    const u = unionOf(list);
    const key = axis === "h" ? (it) => boundsOf(it).l : (it) => boundsOf(it).t;
    const ordered = [...list].sort((a, b) => key(a) - key(b));
    commitLayout(list, () => {
      let cursor = axis === "h" ? u.l : u.t;
      for (const it of ordered){
        const b = boundsOf(it);
        if (axis === "h"){ moveBoundsTo(it, cursor, u.t); cursor += (b.r - b.l) + PAD; }
        else { moveBoundsTo(it, u.l, cursor); cursor += (b.b - b.t) + PAD; }
      }
    });
  }

  // Row packing (shelf algorithm) for the Arrange commands: tries a range of row widths and keeps
  // the one whose overall shape is closest to the visible area's aspect ratio without wasting space.
  function packRows(sizes, aspect){
    const totalArea = sizes.reduce((s, z) => s + z.w * z.h, 0);
    const maxW = Math.max(...sizes.map((z) => z.w));
    const sumW = sizes.reduce((s, z) => s + z.w + PAD, 0);
    let best = null;
    for (let i = 0; i <= 40; i++){
      const rowW = maxW + (Math.max(sumW, maxW) - maxW) * (i / 40) ** 2;
      let x = 0, y = 0, rowH = 0, usedW = 0;
      const pos = [];
      for (const z of sizes){
        if (x > 0 && x + z.w > rowW){ y += rowH + PAD; x = 0; rowH = 0; }
        pos.push({ x, y });
        x += z.w + PAD;
        usedW = Math.max(usedW, x - PAD);
        rowH = Math.max(rowH, z.h);
      }
      const w = usedW, h = y + rowH;
      const score = Math.abs(Math.log((w / h) / aspect)) + 0.4 * (1 - totalArea / (w * h));
      if (!best || score < best.score) best = { score, pos, w, h };
    }
    return best;
  }
  const assetName = (it) => (assetResolved.get(it.asset_id)?.name || "").toLowerCase();
  const assetPath = (it) => (assetResolved.get(it.asset_id)?.path || assetResolved.get(it.asset_id)?.name || "").toLowerCase();
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const SORTERS = {
    optimal: null, // current order
    name: (a, b) => collator.compare(assetName(a), assetName(b)),
    addition: (a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""), undefined, { numeric: true }),
    order: (a, b) => (a.z_index || 0) - (b.z_index || 0),
    path: (a, b) => collator.compare(assetPath(a), assetPath(b)),
    random: () => Math.random() - 0.5,
  };
  let lastArrange = { kind: null, reversed: false };
  // Ctrl+P (optimal) and Ctrl+Alt+N/A/O/D/R. Repeating the same sorted command reverses its order,
  // like PureRef's toggling commands. The result keeps the selection's centre and is framed in view.
  function arrangeItems(kind){
    const list = arrangeTargets();
    if (!list.length) return;
    const reversed = lastArrange.kind === kind && !lastArrange.reversed && kind !== "optimal" && kind !== "random";
    lastArrange = { kind, reversed };
    const sorter = SORTERS[kind];
    const ordered = sorter ? [...list].sort(sorter) : [...list];
    if (reversed) ordered.reverse();
    const u = unionOf(list);
    const vp = viewportEl.getBoundingClientRect();
    const sizes = ordered.map((it) => { const b = boundsOf(it); return { w: b.r - b.l, h: b.b - b.t }; });
    const packed = packRows(sizes, Math.max(0.2, vp.width / Math.max(1, vp.height)));
    const l0 = (u.l + u.r) / 2 - packed.w / 2, t0 = (u.t + u.b) / 2 - packed.h / 2;
    commitLayout(list, () => ordered.forEach((it, i) => moveBoundsTo(it, l0 + packed.pos[i].x, t0 + packed.pos[i].y)));
    frameItems(list);
  }

  // Ctrl+Alt+S: pile the items on top of each other, centred on the selection, in layer order.
  function stackItems(){
    const list = arrangeTargets();
    if (list.length < 2) return;
    const u = unionOf(list);
    const cx = (u.l + u.r) / 2, cy = (u.t + u.b) / 2;
    commitLayout(list, () => {
      for (const it of list){ it.x = cx - it.w / 2; it.y = cy - it.h / 2; }
    });
  }

  // Layer order: "up"/"down" move the selection one layer, "front"/"back" to the very top/bottom.
  // Layers are renumbered 0..n-1 as they change, so each step is exactly one visible position.
  function restack(kind){
    if (!selection.size) return;
    const all = [...items.values()].sort((a, b) => (a.z_index || 0) - (b.z_index || 0) || String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""), undefined, { numeric: true }) || a.id.localeCompare(b.id));
    const sel = (it) => selection.has(it.id);
    let order = all;
    if (kind === "front") order = [...all.filter((it) => !sel(it)), ...all.filter(sel)];
    else if (kind === "back") order = [...all.filter(sel), ...all.filter((it) => !sel(it))];
    else if (kind === "up"){
      order = [...all];
      for (let i = order.length - 2; i >= 0; i--) if (sel(order[i]) && !sel(order[i + 1])) [order[i], order[i + 1]] = [order[i + 1], order[i]];
    } else {
      order = [...all];
      for (let i = 1; i < order.length; i++) if (sel(order[i]) && !sel(order[i - 1])) [order[i], order[i - 1]] = [order[i - 1], order[i]];
    }
    const rank = new Map(order.map((it, i) => [it.id, i]));
    const changed = order.filter((it) => (it.z_index || 0) !== rank.get(it.id));
    if (changed.length) commitLayout(changed, () => { for (const it of changed) it.z_index = rank.get(it.id); });
  }

  // Alt+X / Alt+V: mirror each selected image horizontally / vertically, in place.
  function mirrorItems(axis){
    const list = arrangeTargets();
    if (!selection.size || !list.length) return;
    const f = axis === "x" ? "flip_x" : "flip_y";
    commitLayout(list, () => { for (const it of list) it[f] = it[f] ? 0 : 1; });
  }

  // Ctrl+D: a new instance of each selected item (same asset, same transform/crop) nudged down-right and
  // selected, so it can be dragged away right away. Items are separate placements of one library asset.
  async function duplicateSelection(){
    const src = [...selection].map((id) => items.get(id)).filter(Boolean).sort((a, b) => (a.z_index || 0) - (b.z_index || 0));
    if (!src.length) return;
    let z = Math.max(0, ...[...items.values()].map((it) => it.z_index || 0));
    const created = [];
    for (const it of src){
      try {
        const copy = await api(`/api/boards/${boardId}/items`, jsonOpts("POST", createBody(it, { x: it.x + 24, y: it.y + 24, z_index: ++z })));
        addItemLocal(copy);
        created.push(copy);
      } catch {}
    }
    if (!created.length) return;
    pushUndo({ type: "add", items: created });
    setSelection(created.map((it) => it.id));
  }
  function deleteSelection(){
    if (!selection.size) return;
    const removed = [...selection].map((id) => ({ ...items.get(id) }));
    for (const it of removed) removeItemLocal(it.id);
    api(`/api/boards/${boardId}/items/batch-delete`, jsonOpts("POST", { ids: removed.map((i) => i.id) })).catch(() => {});
    pushUndo({ type: "delete", items: removed });
  }

  // Every canvas shortcut lives in this table and goes through runHotkeys() (keys.js): a combo fires only
  // when exactly its modifiers are held, so adding a command here can never be triggered by a longer combo.
  const allItems = () => [...items.values()];
  const selectedItems = () => [...selection].map((id) => items.get(id)).filter(Boolean);
  const ifSelected = (fn) => () => (selection.size ? fn() : false);
  const KEYMAP = [
    ["KeyF", () => frameItems(selection.size ? selectedItems() : allItems())], // frame the selection (all if none)
    ["KeyA", () => frameItems(allItems())], // frame everything (Ctrl+A, select all, is index.html's)
    // Align, normalize, distribute, arrange — the same shortcuts PureRef uses.
    ["Ctrl+ArrowLeft", () => alignItems("left")], ["Ctrl+ArrowRight", () => alignItems("right")],
    ["Ctrl+ArrowUp", () => alignItems("top")], ["Ctrl+ArrowDown", () => alignItems("bottom")],
    ["Ctrl+Alt+ArrowLeft", () => normalizeItems("height")], ["Ctrl+Alt+ArrowRight", () => normalizeItems("width")],
    ["Ctrl+Alt+ArrowUp", () => normalizeItems("size")], ["Ctrl+Alt+ArrowDown", () => normalizeItems("scale")],
    ["Ctrl+Alt+Shift+ArrowUp", () => distributeItems("h")], ["Ctrl+Alt+Shift+ArrowDown", () => distributeItems("v")],
    ["Ctrl+KeyP", () => arrangeItems("optimal")],
    ["Ctrl+Alt+KeyN", () => arrangeItems("name")], ["Ctrl+Alt+KeyA", () => arrangeItems("addition")],
    ["Ctrl+Alt+KeyO", () => arrangeItems("order")], ["Ctrl+Alt+KeyD", () => arrangeItems("path")],
    ["Ctrl+Alt+KeyR", () => arrangeItems("random")], ["Ctrl+Alt+KeyS", () => stackItems()],
    ["Ctrl+KeyD", ifSelected(duplicateSelection)], // new instance of the selected items
    ["Alt+KeyX", ifSelected(() => mirrorItems("x"))], ["Alt+KeyV", ifSelected(() => mirrorItems("y"))],
    ["ArrowUp", ifSelected(() => restack("front"))], ["ArrowDown", ifSelected(() => restack("back"))],
    ["BracketRight", ifSelected(() => restack("up"))], ["BracketLeft", ifSelected(() => restack("down"))], // one layer
    ["Ctrl+KeyZ", () => undo()], ["Ctrl+Shift+KeyZ", () => redo()],
    ["KeyX", ifSelected(deleteSelection)], ["Delete", ifSelected(deleteSelection)], ["Backspace", ifSelected(deleteSelection)],
    ["Escape", () => { setSelection([]); return false; }], // clears the selection but leaves Esc to the rest of the app
  ];

  // ---- keyboard -------------------------------------------------------------------------------
  document.addEventListener("keydown", (e) => {
    if (!isOpen || (keysEnabled && !keysEnabled())) return;
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    runHotkeys(e, KEYMAP);
  });

  // ---- open/close ------------------------------------------------------------------------------
  // persistCurrent() flushes pending item edits and saves the camera position for whichever board
  // is currently loaded — shared by open() (switching board without leaving the canvas view) and
  // close() (leaving the canvas view entirely), so neither path can skip it.
  async function persistCurrent(){
    await flushSave();
    if (boardId){
      try { await api(`/api/boards/${boardId}`, jsonOpts("PATCH", { viewport_x: vx, viewport_y: vy, viewport_zoom: zoom })); } catch {}
    }
  }
  async function open(id){
    await persistCurrent();
    isOpen = true;
    boardId = id;
    clearWorld();
    const full = await api(`/api/boards/${id}/full`);
    boardId = id; // guard against a stale response if the user switched boards mid-fetch
    vx = full.board.viewport_x || 0;
    vy = full.board.viewport_y || 0;
    zoom = full.board.viewport_zoom || 1;
    worldTransform();
    for (const item of full.items) addItemLocal(item);
    updateEmptyState();
  }
  function close(){
    isOpen = false;
    updateFrame();
    persistCurrent();
  }

  // Asset record for an item's asset_id once loaded (null before) — lets index.html's Space
  // preview open the lightbox for whatever item is under the cursor, same as for a library card.
  function assetOf(aid){ return assetResolved.get(aid) || null; }

  return { open, close, selectAll, assetOf };
}
