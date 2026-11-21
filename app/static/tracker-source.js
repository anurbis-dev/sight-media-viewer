// A tracker project's media entities (ShotGrid Versions, …) as an item source for the library grid
// (docs/PLAN-trackers.md stages 3a, 5b). Tracker-neutral: it talks to the tracker only through its adapter
// (trackers-core.js lists the interface) and Sight's generic routes /api/trackers/<kind>/…. The grid, its tiles,
// selection, keys and lightbox stay the library's (index.html); this module gives it:
//   - a filter bar (entity type · entity · status · Fields ▾ · ↻) shown above the grid while a project is open,
//   - pages of records mapped to grid items {id: "trk:<id>", trk: record, name, kind: "trkmedia", has_thumb},
//   - each tile's caption lines (the fields the user ticked in Fields ▾, read from the tracker's schema),
//   - the filmstrip scrub on a tile (pointer over it / a finger dragged sideways),
//   - opening one: Sight's server downloads its viewable media into the tracker's media cache (a library file), the
//     review is linked to it (per tracker key), and the real file opens in the lightbox.
// The name filter is the top search box. ES module, imported by index.html; one source per tracker (key).

import { hotkey } from "/static/keys.js";

const SF = () => globalThis.SightFilter;
export const TRK_PAGE = 100;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const readJson = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch { return d; } };

// opts: { adapter, tracker: {kind, key, site, host}, bar: element, putSetting(k, v), registerAutoClose(el, close,
//         anchor), onChange(what) — the filter or the fields changed (the grid reloads / repaints) }
export function createTrackerSource(opts){
  const A = opts.adapter, T = opts.tracker, bar = opts.bar;
  const base = `/api/trackers/${encodeURIComponent(T.kind)}`;
  const client = () => A.serverClient(T.site, T.kind);
  const FIELDS_KEY = A.storeKey("fields"), FILTER_KEY = A.storeKey("filter"), WHERE_KEY = A.storeKey("where");
  let project = null, fieldsAll = null, entSeq = 0;
  let fields = readJson(FIELDS_KEY, null);
  if (!Array.isArray(fields)) fields = A.defaultTileFields.slice();
  const filter = Object.assign({ type: "", entity: "", status: "", q: "" }, readJson(FILTER_KEY, {}));
  filter.entity = "";
  const statuses = new Set();
  // the filter builder's conditions on the media entity's fields (Filter ▾ in the top bar), sent with every page
  let where = SF().sanitize(readJson(WHERE_KEY, null));
  let smart = null;   // a tracker smart collection's rule in effect instead of `where` (stage 3c; null: the free conditions)
  let fieldsPromise = null;
  const loadFields = () => fieldsAll ? Promise.resolve(fieldsAll)
    : (fieldsPromise = fieldsPromise || A.mediaFields(client()).then((f) => { fieldsAll = f; return f; }).finally(() => { fieldsPromise = null; }));

  const paint = () => {
    bar.innerHTML = `
    <b class="trkb-title"></b>
    <div class="trkb-seg">${A.entityTypes.map(([t, l]) => `<button type="button" data-t="${esc(t)}">${esc(l)}</button>`).join("")}</div>
    <select class="trkb-ent" aria-label="Entity" hidden></select>
    <select class="trkb-stat" aria-label="Status"><option value="">Any status</option></select>
    <button type="button" class="btn ghost trkb-fields" title="Which fields the tiles show">Fields ▾</button>
    <button type="button" class="btn ghost trkb-refresh" title="Load again">↻</button>
    <div class="trkb-fpop" hidden></div>`;
  };
  paint();
  const $ = (s) => bar.querySelector(s);
  let ent, stat, fpop, fbtn;
  const saveFilter = () => opts.putSetting(FILTER_KEY, JSON.stringify({ type: filter.type, status: filter.status }));
  const paintSeg = () => bar.querySelectorAll(".trkb-seg button").forEach((b) => b.classList.toggle("on", b.dataset.t === filter.type));
  // (the bar is shared by every tracker's source: the one opening a project binds it to itself)
  function bindBar(){
    paint();
    ent = $(".trkb-ent"); stat = $(".trkb-stat"); fpop = $(".trkb-fpop"); fbtn = $(".trkb-fields");
    bar.querySelectorAll(".trkb-seg button").forEach((b) => { b.onclick = () => { filter.type = b.dataset.t; filter.entity = ""; saveFilter(); paintSeg(); loadEntities(); opts.onChange("filter"); }; });
    ent.onchange = () => { filter.entity = ent.value; opts.onChange("filter"); };
    stat.onchange = () => { filter.status = stat.value; saveFilter(); opts.onChange("filter"); };
    $(".trkb-refresh").onclick = () => opts.onChange("filter");
    fbtn.onclick = openFields;
  }

  const fillSel = (sel, items, cur, any) => {
    sel.innerHTML = `<option value="">${esc(any)}</option>` + items.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join("");
    sel.value = items.some(([v]) => String(v) === String(cur)) ? String(cur) : "";
  };
  const paintStatuses = () => {
    if (!stat) return;
    if (filter.status) statuses.add(filter.status);   // the status filtered on shows even when no record has it
    fillSel(stat, [...statuses].sort().map((s) => [s, s]), filter.status, "Any status");
  };
  async function loadEntities(){
    const my = ++entSeq;   // (a slower answer for another type / project lands nowhere)
    ent.hidden = !filter.type;
    if (ent.hidden || !project) return;
    fillSel(ent, [], "", "Loading…");
    try {
      const list = await A.entities(client(), project.id, filter.type);
      if (my !== entSeq) return;
      fillSel(ent, list.map((x) => [x.id, x.name]), filter.entity, "Every " + filter.type.toLowerCase());
      filter.entity = ent.value;
    } catch (e){ if (my === entSeq) fillSel(ent, [], "", e.message); }
  }

  // ---- Fields ▾
  async function openFields(){
    if (!fpop.hidden){ fpop.hidden = true; return; }
    fpop.hidden = false;
    fpop.innerHTML = `<div class="trkb-fhint">Loading fields…</div>`;
    const e = opts.registerAutoClose?.(fpop, () => { fpop.hidden = true; }, fbtn);
    if (e){ e.anchor = fbtn; e.armed = false; }
    try { await loadFields(); }
    catch (err){ fpop.innerHTML = `<div class="trkb-fhint">${esc(err.message)}</div>`; return; }
    paintFields("");
  }
  // touch has no pointer to move away: a tap outside the popover (and off its button) closes it (removed by dispose())
  const onDown = (e) => { if (fpop && !fpop.hidden && !fpop.contains(e.target) && !fbtn.contains(e.target)) fpop.hidden = true; };
  document.addEventListener("pointerdown", onDown, true);
  function paintFields(term){
    const t = term.toLowerCase();
    const list = fieldsAll.filter((f) => !t || f.label.toLowerCase().includes(t) || f.name.toLowerCase().includes(t));
    fpop.innerHTML = `<input class="trkb-ffind" type="search" placeholder="Find a field…" value="${esc(term)}" spellcheck="false">
      <div class="trkb-flist">${list.map((f) => `<label><input type="checkbox" data-f="${esc(f.name)}" ${fields.includes(f.name) ? "checked" : ""}> ${esc(f.label)} <small>${esc(f.name)}</small></label>`).join("")}</div>
      <div class="trkb-facts"><button type="button" class="btn ghost" data-act="def">Default</button></div>`;
    const find = fpop.querySelector(".trkb-ffind");
    find.addEventListener("keydown", (e) => { e.stopPropagation(); if (hotkey(e, "Escape")) fpop.hidden = true; });
    find.addEventListener("input", () => { const v = find.value; paintFields(v); const f2 = fpop.querySelector(".trkb-ffind"); f2.focus(); f2.setSelectionRange(v.length, v.length); });
    fpop.querySelectorAll("[data-f]").forEach((c) => {
      c.onchange = () => {
        const n = c.dataset.f;
        fields = c.checked ? fields.concat(fields.includes(n) ? [] : [n]) : fields.filter((x) => x !== n);
        setFields();
      };
    });
    fpop.querySelector("[data-act=def]").onclick = () => { fields = A.defaultTileFields.slice(); setFields(); paintFields(find.value); };
  }
  // The schema's fields as the builder's; a status field with no listed choices offers the statuses seen so far and
  // the ones the conditions name (a status filtered out never shows on a record, yet its condition must hold).
  function filterFields(){
    return fieldsAll ? A.filterFields(fieldsAll, { seen: { [A.statusField]: statuses }, tree: smart || where }) : null;
  }
  function setFields(){
    opts.putSetting(FIELDS_KEY, JSON.stringify(fields));
    opts.onChange("fields");
  }
  const thumb = (rec, pic) => `${base}/thumb/${encodeURIComponent(A.recordId(rec))}?${pic ? "pic=" + pic + "&" : ""}u=${encodeURIComponent(A.recordStamp(rec))}`;

  return {
    adapter: A, tracker: T,
    // a source replaced by another for its tracker key: its document listener goes
    dispose(){ document.removeEventListener("pointerdown", onDown, true); },
    get project(){ return project; },
    get query(){ return filter.q; },
    setQuery(v){ filter.q = String(v || "").trim(); },
    // A project opens: its own entities / statuses (the shared bar is bound to this source).
    async open(p){
      if (!project || project.id !== p.id){ filter.entity = ""; statuses.clear(); }
      project = p;
      bindBar();
      $(".trkb-title").textContent = p.name || "Project";
      paintSeg(); paintStatuses();
      if (!fieldsAll) loadFields().then(() => opts.onChange("labels"), () => {});   // the inspector's field names
      await loadEntities();
    },
    // The filter builder: the fields it offers (null until read), the conditions, and setting them.
    filterFields,
    loadFilterFields(){ return loadFields().then(filterFields); },
    // (while a smart collection is on, its rule: the builder edits that one; the caller stores it with the collection)
    get where(){ return smart || where; },
    setWhere(t){
      if (smart){ smart = SF().sanitize(t); return; }
      where = SF().sanitize(t); opts.putSetting(WHERE_KEY, JSON.stringify(where));
    },
    get smartOn(){ return !!smart; },
    setSmart(t){ smart = t ? SF().sanitize(t) : null; },
    // One page of records (1-based) as grid items; `more` = there may be further pages.
    async page(n){
      const w = smart || where;
      if (w.c.length && !fieldsAll){ await loadFields(); opts.onChange("labels"); }   // a condition needs its field's type (an error shows)
      const cond = w.c.length ? A.toConditions(w, filterFields()) : null;
      const vs = await A.browse(client(), Object.assign({ project: project.id }, filter), fields, n, TRK_PAGE, cond);
      vs.forEach((v) => { const s = v[A.statusField]; if (s && typeof s === "string" && !statuses.has(s)){ statuses.add(s); paintStatuses(); } });
      return { items: vs.map(toItem), more: vs.length === TRK_PAGE };
    },
    // a field the loaded records lack: the grid loads again
    needsReload(items){ const v = items.find((x) => x.trk)?.trk; return !!v && fields.some((f) => !(f in v)); },
    caption(a){
      const lines = fields.map((f) => A.fmtField(a.trk, f)).filter(Boolean);
      return lines.length ? lines : [A.recordName(a.trk)];
    },
    // The inspector's rows for one record: the ticked fields first, then whatever else was read.
    details(a){
      const v = a.trk, label = (k) => (fieldsAll || []).find((f) => f.name === k)?.label || k;
      const keys = fields.concat(Object.keys(v).filter((k) => !fields.includes(k) && !A.hiddenDetailFields.includes(k)));
      return keys.map((k) => [label(k), A.fmtField(v, k)]).filter(([, x]) => x);
    },
    thumbUrl(a){ return thumb(a.trk, ""); },
    // Filmstrip on a tile's picture host: fetched on the first hover / touch, then the frame under the pointer.
    bindFilmstrip(card, host, getItem){
      let strip = null, fs = null, frames = 0, down = null, forId = "";
      const want = () => {
        const a = getItem();
        if (!a || !a.trk || !A.hasFilmstrip(a.trk)) return;
        if (fs && forId === a.id) return;
        forId = a.id; frames = 0;
        if (!strip){ strip = document.createElement("div"); strip.className = "trk-strip"; }
        if (strip.parentNode !== host) host.appendChild(strip);
        strip.style.backgroundImage = "";
        fs = new Image();
        const img = fs;
        img.onload = () => { if (fs !== img) return; frames = A.filmstripFrames(img.naturalWidth); if (frames > 1){ strip.style.backgroundImage = `url("${img.src}")`; strip.style.aspectRatio = `${img.naturalWidth / frames} / ${img.naturalHeight}`; } };
        img.src = thumb(a.trk, "filmstrip");
      };
      const scrub = (x) => {
        if (frames < 2 || !strip) return;
        const r = host.getBoundingClientRect(), c = A.filmstripCss(frames, (x - r.left) / Math.max(1, r.width));
        strip.style.backgroundSize = c.size; strip.style.backgroundPosition = c.pos;
        card.classList.add("trk-scrub");
      };
      const stop = () => card.classList.remove("trk-scrub");
      host.addEventListener("pointerenter", want);
      host.addEventListener("pointermove", (e) => {
        if (e.pointerType === "mouse" || e.pointerType === "pen"){ want(); scrub(e.clientX); }
        else if (down && Math.abs(e.clientX - down.x) > 8){ down.moved = true; scrub(e.clientX); }
      });
      host.addEventListener("pointerleave", stop);
      host.addEventListener("pointerdown", (e) => { want(); if (e.pointerType === "touch") down = { x: e.clientX, moved: false }; });
      const end = () => { down = null; stop(); };
      host.addEventListener("pointerup", end); host.addEventListener("pointercancel", end);
    },
    // Opens a record: {asset, record} once its media is a library file and its review is linked (to this tracker).
    async open1(a){
      const id = A.recordId(a.trk);
      const r = await fetch(`${base}/open/${encodeURIComponent(id)}`, { method: "POST", headers: { "X-Sight": "1" } });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.errors?.[0]?.title || `HTTP ${r.status}`);
      const rec = j.record || j.version;
      const link = A.linkOf(A.siteHost(T.site), rec);   // (the same host as the review panel's links: no re-link, no lost sync state)
      const cur = await (await fetch(`${base}/link/${encodeURIComponent(j.asset.id)}`)).json().catch(() => null);
      // a new link starts a fresh sync state; the same record keeps it
      if (!cur?.link || String(A.linkId(cur.link)) !== String(id) || cur.link.site !== link.site){
        await fetch(`${base}/link/${encodeURIComponent(j.asset.id)}`, { method: "PUT", headers: { "content-type": "application/json", "X-Sight": "1" }, body: JSON.stringify({ link }) });
      }
      return { asset: j.asset, record: rec };
    },
  };

  function toItem(v){
    return { id: "trk:" + A.recordId(v), trk: v, name: A.recordName(v), kind: "trkmedia", trkVideo: A.isVideo(v), has_thumb: 1, status: "ready",
      mtime: A.recordTime(v) / 1000 || null, width: null, height: null, size: null, ext: "" };
  }
}
