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
.canvas-view:not([hidden]) { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--bg); border-left: 1px solid var(--border); }
.canvas-viewport { position: relative; flex: 1; min-height: 0; overflow: hidden; cursor: default; background-color: var(--surface);
  background-image: radial-gradient(circle, var(--border-strong) 1px, transparent 1px); background-size: 24px 24px;
  user-select: none; -webkit-user-select: none; }
.canvas-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.citem { position: absolute; left: 0; top: 0; border-radius: 6px; overflow: visible; cursor: grab; touch-action: none; }
.citem .citem-box { position: absolute; inset: 0; border-radius: 6px; overflow: hidden; background: var(--card-bg); border: 1px solid var(--border); box-shadow: 0 1px 3px rgb(0 0 0 / .3); }
.citem img { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; user-select: none; -webkit-user-drag: none; }
.citem .citem-ph { width: 100%; height: 100%; display: grid; place-items: center; padding: 8px; text-align: center; font-size: 11px; color: var(--subtle); }
.citem .citem-label { position: absolute; inset: auto 0 0 0; padding: 4px 6px; font-size: 11px; color: #fff; background: linear-gradient(transparent, rgb(0 0 0 / .55)); pointer-events: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.citem.selected .citem-box { outline: 2px solid var(--accent); outline-offset: 1px; }
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
async function getAsset(aid){
  if (assetCache.has(aid)) return assetCache.get(aid);
  const p = api("/api/assets/" + aid).catch(() => null);
  assetCache.set(aid, p);
  const a = await p;
  assetCache.set(aid, a);
  return a;
}
function thumbUrl(a){
  return "/api/thumb/" + a.id + (a.thumb_v ? "?v=" + a.thumb_v : "");
}

export function createCanvasView({ mount, getZoomSettings }){
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

  function worldTransform(){
    worldEl.style.transform = `translate(${vx}px, ${vy}px) scale(${zoom})`;
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
    el.innerHTML = `<div class="citem-box"><div class="citem-ph">…</div></div><div class="citem-label"></div><div class="chandle" data-act="resize"></div><div class="crot" data-act="rotate"></div>`;
    el.querySelector('[data-act="resize"]').addEventListener("pointerdown", (e) => startResize(e, item.id));
    el.querySelector('[data-act="rotate"]').addEventListener("pointerdown", (e) => startRotate(e, item.id));
    el.addEventListener("pointerdown", (e) => {
      if (e.target.closest("[data-act]")) return;
      startMove(e, item.id);
    });
    worldEl.appendChild(el);
    getAsset(item.asset_id).then((a) => {
      if (!dom.has(item.id)) return; // item was removed before the fetch resolved
      const box = el.querySelector(".citem-box");
      const label = el.querySelector(".citem-label");
      label.textContent = a ? a.name : "";
      if (a && a.has_thumb){
        box.innerHTML = `<img src="${thumbUrl(a)}" draggable="false" alt="">`;
      } else {
        box.innerHTML = `<div class="citem-ph">${esc(a ? a.name : "?")}</div>`;
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
  // Mirrors applyMarquee()'s replace/add/toggle rules for the library grid's own box-select
  // (index.html, bound to the same modifier keys: plain drag = replace, Ctrl+drag = toggle,
  // Ctrl+Shift+drag = add) so box-select behaves identically in both places.
  function applyMarqueeSelection(mode, origin, hits){
    if (mode === "add") setSelection([...new Set([...origin, ...hits])]);
    else if (mode === "toggle"){
      const originSet = new Set(origin);
      const next = new Set(origin);
      for (const id of hits){
        if (originSet.has(id)) next.delete(id);
        else next.add(id);
      }
      setSelection([...next]);
    } else setSelection(hits);
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
    for (const s of snap){
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
    drag = { kind: "move", startWorld, starts, pointerId: e.pointerId, moved: false, before };
    el_setPointerCapture(e);
  }
  function startResize(e, id){
    e.stopPropagation();
    setSelection([id]);
    const item = items.get(id);
    const before = [{ ...item }];
    drag = { kind: "resize", id, startWorld: screenToWorld(e.clientX, e.clientY), startW: item.w, startH: item.h, pointerId: e.pointerId, moved: false, before };
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
        const dx = w.x - drag.startWorld.x, dy = w.y - drag.startWorld.y;
        for (const s of drag.starts){
          const it = items.get(s.id);
          it.x = s.x + dx; it.y = s.y + dy;
          layoutItemEl(it);
        }
      } else if (drag.kind === "resize"){
        const w = screenToWorld(e.clientX, e.clientY);
        const it = items.get(drag.id);
        it.w = Math.max(24, drag.startW + (w.x - drag.startWorld.x));
        it.h = Math.max(24, drag.startH + (w.y - drag.startWorld.y));
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
    if (e.target !== viewportEl && e.target !== worldEl) return; // clicked an item — its own handler deals with it
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl){
      e.preventDefault();
      drag = { kind: "marquee", startClient: { x: e.clientX, y: e.clientY }, mode: e.shiftKey ? "add" : "toggle", active: false, origin: [...selection] };
      el_setPointerCapture(e);
      return;
    }
    if (!e.shiftKey){
      e.preventDefault();
      drag = { kind: "marquee", startClient: { x: e.clientX, y: e.clientY }, mode: "replace", active: false, origin: [...selection] };
      el_setPointerCapture(e);
    }
  });
  window.addEventListener("pointermove", (e) => { if (isOpen) onPointerMove(e); });
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

  // ---- keyboard -------------------------------------------------------------------------------
  document.addEventListener("keydown", (e) => {
    if (!isOpen) return;
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
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
      const zs = [...items.values()].map((it) => it.z_index || 0);
      const target = e.key === "]" ? Math.max(0, ...zs) + 1 : Math.min(0, ...zs) - 1;
      for (const id of selection){
        const it = items.get(id);
        it.z_index = target;
        layoutItemEl(it);
        scheduleSave(id, { z_index: target });
      }
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

  return { open, close };
}
