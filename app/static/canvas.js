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

const MIN_ZOOM = 0.1, MAX_ZOOM = 4;
const DEFAULT_SIZE = 240;
const MIN_ITEM = 24; // smallest item side, world units
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
   worldTransform) so they stay the same on-screen thickness as the library's at any zoom. */
.citem { position: absolute; left: 0; top: 0; border-radius: var(--card-radius); overflow: visible; cursor: grab; touch-action: none; }
.citem .citem-box { position: absolute; inset: 0; display: flex; flex-direction: column; box-sizing: border-box; padding: var(--card-pad); border-radius: var(--card-radius); overflow: hidden; background: var(--card-bg); }
.citem .citem-box::after { content: ""; position: absolute; inset: 0; border: calc(var(--card-border-w) / var(--cz, 1)) solid var(--border); border-radius: inherit; pointer-events: none; z-index: 3; }
.citem:hover .citem-box::after { border-width: calc(var(--card-hover-border-w) / var(--cz, 1)); border-color: var(--card-hover-color); }
.citem.selected .citem-box { background: var(--surface-2); }
.citem.selected .citem-box::after { border-width: calc(var(--card-active-border-w) / var(--cz, 1)); border-color: var(--card-active-color); box-shadow: inset 0 0 0 calc(var(--card-active-border-w) / var(--cz, 1)) var(--card-active-color); }
.citem .citem-thumb { position: relative; flex: 1; min-height: 0; overflow: hidden; border-radius: var(--thumb-radius); background: var(--card-bg); }
.citem img { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; user-select: none; -webkit-user-drag: none; }
.citem .citem-ph { width: 100%; height: 100%; display: grid; place-items: center; padding: 8px; text-align: center; font-size: 11px; color: var(--subtle); }
.citem .citem-meta { flex: none; padding: 8px 2px 0; min-width: 0; }
.citem .citem-meta .n { font-size: calc(var(--text-size) - 2px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.canvas-no-names .citem .citem-meta { display: none; }
/* Ctrl held = box-select mode (Ctrl-drag draws a marquee even over an item): show a plain arrow instead of the grab hand. */
.canvas-viewport.ctrl-box, .canvas-viewport.ctrl-box .citem { cursor: default; }
.citem .chandle, .citem .crot { position: absolute; width: 12px; height: 12px; border-radius: 50%; background: var(--accent); border: 1.5px solid var(--bg); display: none; }
.citem.selected .chandle, .citem.selected .crot { display: block; }
.citem .chandle { right: -6px; bottom: -6px; cursor: nwse-resize; }
.citem .crot { left: 50%; top: -20px; margin-left: -6px; cursor: grab; }
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

  mount.innerHTML = `<div class="canvas-viewport" data-el="viewport"><div class="canvas-world" data-el="world"></div></div>`;
  const viewportEl = mount.querySelector('[data-el="viewport"]');
  const worldEl = mount.querySelector('[data-el="world"]');

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
    if (img) syncPixelation(img, { clientWidth: item.w * zoom, clientHeight: item.h * zoom });
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
  }

  function buildItemEl(item){
    const el = document.createElement("div");
    el.className = "citem";
    el.dataset.id = item.id;
    el.dataset.assetId = item.asset_id;
    el.innerHTML = `<div class="citem-box"><div class="citem-thumb"><div class="citem-ph">…</div></div><div class="citem-meta"><div class="n"></div></div></div><div class="chandle" data-act="resize"></div><div class="crot" data-act="rotate"></div>`;
    el.querySelector('[data-act="resize"]').addEventListener("pointerdown", (e) => startResize(e, item.id));
    el.querySelector('[data-act="rotate"]').addEventListener("pointerdown", (e) => startRotate(e, item.id));
    el.addEventListener("pointerdown", (e) => {
      if (e.target.closest("[data-act]")) return;
      if (e.ctrlKey || e.metaKey) return; // Ctrl+drag starts a box-select even over an item — see the viewport handler
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
    syncItemPixelation(item);
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
    updateEmptyState();
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
  async function recreateOnServer(entry){
    const fresh = [];
    for (const it of entry.items){
      try {
        const created = await api(`/api/boards/${boardId}/items`, jsonOpts("POST", {
          asset_id: it.asset_id, x: it.x, y: it.y, w: it.w, h: it.h, rotation: it.rotation, z_index: it.z_index,
        }));
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
    drag = { kind: "move", id, startWorld, starts, pointerId: e.pointerId, moved: false, before };
    el_setPointerCapture(e);
  }
  function startResize(e, id){
    e.stopPropagation();
    setSelection([id]);
    const item = items.get(id);
    const before = [{ ...item }];
    const a = assetResolved.get(item.asset_id);
    const ratio = a && a.width && a.height ? a.width / a.height : item.w / item.h;
    drag = { kind: "resize", id, ratio, startWorld: screenToWorld(e.clientX, e.clientY), startW: item.w, startH: item.h, pointerId: e.pointerId, moved: false, before };
    el_setPointerCapture(e);
  }
  function startRotate(e, id){
    e.stopPropagation();
    setSelection([id]);
    const item = items.get(id);
    const before = [{ ...item }];
    const cx = item.x + item.w / 2, cy = item.y + item.h / 2;
    const w0 = screenToWorld(e.clientX, e.clientY);
    const startAngle = Math.atan2(w0.y - cy, w0.x - cx) * 180 / Math.PI;
    drag = { kind: "rotate", id, cx, cy, startAngle, startRotation: item.rotation || 0, pointerId: e.pointerId, moved: false, before };
    el_setPointerCapture(e);
  }
  function el_setPointerCapture(e){
    try { e.target.setPointerCapture(e.pointerId); } catch {}
  }

  function onPointerMove(e){
    if (drag && (drag.kind === "move" || drag.kind === "resize" || drag.kind === "rotate")){
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
        let nw = drag.startW + (w.x - drag.startWorld.x), nh = drag.startH + (w.y - drag.startWorld.y);
        if (e.ctrlKey || e.metaKey){ // snap the bottom-right corner to the grid
          const step = gridStep();
          nw = snapTo(it.x + nw, step) - it.x;
          nh = snapTo(it.y + nh, step) - it.y;
        }
        if (e.shiftKey){
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
      }
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
    if ((drag.kind === "move" || drag.kind === "resize" || drag.kind === "rotate") && drag.moved){
      const affectedIds = drag.kind === "move" ? drag.starts.map((s) => s.id) : [drag.id];
      const after = affectedIds.map((id) => ({ ...items.get(id) }));
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
  window.addEventListener("pointermove", (e) => { if (isOpen){ setCtrlCursor(e.ctrlKey || e.metaKey); onPointerMove(e); } });
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
  // Runs `mutate` over the items, then repaints, saves and records ONE undo step (no-op if nothing moved).
  function commitLayout(list, mutate){
    const before = list.map((it) => ({ ...it }));
    mutate();
    const same = list.every((it, i) => Math.abs(it.x - before[i].x) < 0.01 && Math.abs(it.y - before[i].y) < 0.01 && Math.abs(it.w - before[i].w) < 0.01 && Math.abs(it.h - before[i].h) < 0.01);
    for (const it of list) layoutItemEl(it);
    if (same) return false;
    const after = list.map((it) => ({ ...it }));
    pushUndo({ type: "move", before, after });
    for (const it of after) scheduleSave(it.id, it);
    return true;
  }

  // Align left/right/top/bottom (Ctrl+arrows): push every item to that edge of the selection's box.
  function alignItems(dir){
    const list = arrangeTargets();
    if (list.length < 2) return;
    const u = unionOf(list);
    commitLayout(list, () => {
      for (const it of list){
        const b = boundsOf(it);
        if (dir === "left") it.x += u.l - b.l;
        else if (dir === "right") it.x += u.r - b.r;
        else if (dir === "top") it.y += u.t - b.t;
        else it.y += u.b - b.b;
      }
    });
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

  function reorderZ(toFront){
    const zs = [...items.values()].map((it) => it.z_index || 0);
    const target = toFront ? Math.max(0, ...zs) + 1 : Math.min(0, ...zs) - 1;
    for (const id of selection){
      const it = items.get(id);
      it.z_index = target;
      layoutItemEl(it);
      scheduleSave(id, { z_index: target });
    }
  }

  const ARROW_DIRS = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "top", ArrowDown: "bottom" };
  const NORMALIZE_BY_ARROW = { ArrowLeft: "height", ArrowRight: "width", ArrowUp: "size", ArrowDown: "scale" };
  const ARRANGE_BY_CODE = { KeyN: "name", KeyA: "addition", KeyO: "order", KeyD: "path", KeyR: "random" };
  // Returns true when the key combo was one of the arrange shortcuts (and was handled).
  function handleArrangeKey(e){
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.altKey){
      if (e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")){ distributeItems(e.key === "ArrowUp" ? "h" : "v"); return true; }
      if (!e.shiftKey && NORMALIZE_BY_ARROW[e.key]){ normalizeItems(NORMALIZE_BY_ARROW[e.key]); return true; }
      if (!e.shiftKey && ARRANGE_BY_CODE[e.code]){ arrangeItems(ARRANGE_BY_CODE[e.code]); return true; }
      if (!e.shiftKey && e.code === "KeyS"){ stackItems(); return true; }
      return false;
    }
    if (mod && !e.altKey && !e.shiftKey){
      if (ARROW_DIRS[e.key]){ alignItems(ARROW_DIRS[e.key]); return true; }
      if (e.code === "KeyP"){ arrangeItems("optimal"); return true; }
    }
    if (!mod && !e.altKey && !e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && selection.size){
      reorderZ(e.key === "ArrowUp");
      return true;
    }
    return false;
  }

  // ---- keyboard -------------------------------------------------------------------------------
  document.addEventListener("keydown", (e) => {
    if (!isOpen || (keysEnabled && !keysEnabled())) return;
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    // F = frame the selection, A = frame everything. By physical key (e.code) so they work on any
    // keyboard layout; bare keys only, so Ctrl+A (select all, handled by index.html) stays separate.
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (e.code === "KeyF" || e.code === "KeyA")){
      e.preventDefault();
      const list = e.code === "KeyF" && selection.size ? [...selection].map((id) => items.get(id)) : [...items.values()];
      frameItems(list);
      return;
    }
    if (handleArrangeKey(e)){ e.preventDefault(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z"){
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && selection.size){
      e.preventDefault();
      const removed = [...selection].map((id) => ({ ...items.get(id) }));
      for (const it of removed) removeItemLocal(it.id);
      api(`/api/boards/${boardId}/items/batch-delete`, jsonOpts("POST", { ids: removed.map((i) => i.id) })).catch(() => {});
      pushUndo({ type: "delete", items: removed });
      return;
    }
    if ((e.key === "]" || e.key === "[") && selection.size){
      e.preventDefault();
      reorderZ(e.key === "]");
      return;
    }
    if (e.key === "Escape") setSelection([]);
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
    persistCurrent();
  }

  // Asset record for an item's asset_id once loaded (null before) — lets index.html's Space
  // preview open the lightbox for whatever item is under the cursor, same as for a library card.
  function assetOf(aid){ return assetResolved.get(aid) || null; }

  return { open, close, selectAll, assetOf };
}
