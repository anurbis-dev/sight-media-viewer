// ShotGrid Versions as an item source for the library grid (docs/PLAN-trackers.md stage 3a). The grid, its tiles,
// selection, keys and lightbox stay the library's (index.html); this module gives it:
//   - a filter bar (entity type · entity · status · Fields ▾ · ↻) shown above the grid while a project is open,
//   - pages of Versions mapped to grid items {id: "sg:<id>", sg: version, name, kind: "sgversion", has_thumb},
//   - each tile's caption lines (the fields the user ticked in Fields ▾, read from the site's schema),
//   - the filmstrip scrub on a tile (pointer over it / a finger dragged sideways),
//   - opening a Version: Sight's server downloads its web proxy into the media cache (a library file), the review is
//     linked to the Version, and the real file opens in the lightbox.
// The name filter is the top search box. ES module, imported by index.html.

import { hotkey } from "/static/keys.js";

const SG = () => globalThis.SightShotGrid;
const FIELDS_KEY = "sight.sg.fields", FILTER_KEY = "sight.sg.filter", WHERE_KEY = "sight.sg.where";
const SF = () => globalThis.SightFilter;
export const SG_PAGE = 100;
const ENTITY_TYPES = [["", "All"], ["Shot", "Shots"], ["Asset", "Assets"], ["Sequence", "Sequences"]];
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const readJson = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch { return d; } };

// opts: { bar: element, client(), host(), putSetting(k, v), registerAutoClose(el, close, anchor), onChange() — the
//         filter or the fields changed (the grid reloads / repaints) }
export function createSgSource(opts){
  const bar = opts.bar;
  let project = null, fieldsAll = null, entSeq = 0;
  let fields = readJson(FIELDS_KEY, null);
  if (!Array.isArray(fields)) fields = SG().DEFAULT_TILE_FIELDS.slice();
  const filter = Object.assign({ type: "", entity: "", status: "", q: "" }, readJson(FILTER_KEY, {}));
  filter.entity = "";
  const statuses = new Set();
  // the filter builder's conditions on Version fields (Filter ▾ in the top bar), sent with every page
  let where = SF().sanitize(readJson(WHERE_KEY, null));
  let smart = null;   // a ShotGrid smart collection's rule in effect instead of `where` (stage 3c; null: the free conditions)
  let fieldsPromise = null;
  const loadFields = () => fieldsAll ? Promise.resolve(fieldsAll)
    : (fieldsPromise = fieldsPromise || SG().versionFields(opts.client()).then((f) => { fieldsAll = f; return f; }).finally(() => { fieldsPromise = null; }));

  bar.innerHTML = `
    <b class="sgb-title"></b>
    <div class="sgb-seg">${ENTITY_TYPES.map(([t, l]) => `<button type="button" data-t="${t}">${l}</button>`).join("")}</div>
    <select class="sgb-ent" aria-label="Entity" hidden></select>
    <select class="sgb-stat" aria-label="Status"><option value="">Any status</option></select>
    <button type="button" class="btn ghost sgb-fields" title="Which fields the tiles show">Fields ▾</button>
    <button type="button" class="btn ghost sgb-refresh" title="Load again">↻</button>
    <div class="sgb-fpop" hidden></div>`;
  const $ = (s) => bar.querySelector(s);
  const ent = $(".sgb-ent"), stat = $(".sgb-stat"), fpop = $(".sgb-fpop"), fbtn = $(".sgb-fields");
  const saveFilter = () => opts.putSetting(FILTER_KEY, JSON.stringify({ type: filter.type, status: filter.status }));
  const paintSeg = () => bar.querySelectorAll(".sgb-seg button").forEach((b) => b.classList.toggle("on", b.dataset.t === filter.type));
  bar.querySelectorAll(".sgb-seg button").forEach((b) => { b.onclick = () => { filter.type = b.dataset.t; filter.entity = ""; saveFilter(); paintSeg(); loadEntities(); opts.onChange("filter"); }; });
  ent.onchange = () => { filter.entity = ent.value; opts.onChange("filter"); };
  stat.onchange = () => { filter.status = stat.value; saveFilter(); opts.onChange("filter"); };
  $(".sgb-refresh").onclick = () => opts.onChange("filter");

  const fillSel = (sel, items, cur, any) => {
    sel.innerHTML = `<option value="">${esc(any)}</option>` + items.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join("");
    sel.value = items.some(([v]) => String(v) === String(cur)) ? String(cur) : "";
  };
  const paintStatuses = () => {
    if (filter.status) statuses.add(filter.status);   // the status filtered on shows even when no Version has it
    fillSel(stat, [...statuses].sort().map((s) => [s, s]), filter.status, "Any status");
  };
  async function loadEntities(){
    const my = ++entSeq;   // (a slower answer for another type / project lands nowhere)
    ent.hidden = !filter.type;
    if (ent.hidden || !project) return;
    fillSel(ent, [], "", "Loading…");
    try {
      const list = await opts.client().search(filter.type, [["project", "is", { type: "Project", id: project.id }]], ["code"], { sort: "code", limit: 5000 });
      if (my !== entSeq) return;
      fillSel(ent, list.map((x) => [x.id, x.code || "#" + x.id]), filter.entity, "Every " + filter.type.toLowerCase());
      filter.entity = ent.value;
    } catch (e){ if (my === entSeq) fillSel(ent, [], "", e.message); }
  }

  // ---- Fields ▾
  fbtn.onclick = async () => {
    if (!fpop.hidden){ fpop.hidden = true; return; }
    fpop.hidden = false;
    fpop.innerHTML = `<div class="sgb-fhint">Loading fields…</div>`;
    const e = opts.registerAutoClose?.(fpop, () => { fpop.hidden = true; }, fbtn);
    if (e){ e.anchor = fbtn; e.armed = false; }
    try { await loadFields(); }
    catch (err){ fpop.innerHTML = `<div class="sgb-fhint">${esc(err.message)}</div>`; return; }
    paintFields("");
  };
  // touch has no pointer to move away: a tap outside the popover (and off its button) closes it
  document.addEventListener("pointerdown", (e) => { if (!fpop.hidden && !fpop.contains(e.target) && !fbtn.contains(e.target)) fpop.hidden = true; }, true);
  function paintFields(term){
    const t = term.toLowerCase();
    const list = fieldsAll.filter((f) => !t || f.label.toLowerCase().includes(t) || f.name.toLowerCase().includes(t));
    fpop.innerHTML = `<input class="sgb-ffind" type="search" placeholder="Find a field…" value="${esc(term)}" spellcheck="false">
      <div class="sgb-flist">${list.map((f) => `<label><input type="checkbox" data-f="${esc(f.name)}" ${fields.includes(f.name) ? "checked" : ""}> ${esc(f.label)} <small>${esc(f.name)}</small></label>`).join("")}</div>
      <div class="sgb-facts"><button type="button" class="btn ghost" data-act="def">Default</button></div>`;
    const find = fpop.querySelector(".sgb-ffind");
    find.addEventListener("keydown", (e) => { e.stopPropagation(); if (hotkey(e, "Escape")) fpop.hidden = true; });
    find.addEventListener("input", () => { const v = find.value; paintFields(v); const f2 = fpop.querySelector(".sgb-ffind"); f2.focus(); f2.setSelectionRange(v.length, v.length); });
    fpop.querySelectorAll("[data-f]").forEach((c) => {
      c.onchange = () => {
        const n = c.dataset.f;
        fields = c.checked ? fields.concat(fields.includes(n) ? [] : [n]) : fields.filter((x) => x !== n);
        setFields();
      };
    });
    fpop.querySelector("[data-act=def]").onclick = () => { fields = SG().DEFAULT_TILE_FIELDS.slice(); setFields(); paintFields(find.value); };
  }
  // The schema's fields as the builder's; a status field with no listed choices offers the statuses seen so far and
  // the ones the conditions name (a status filtered out never shows on a Version, yet its condition must hold).
  function filterFields(){
    return fieldsAll ? SF().sgFields(fieldsAll, { seen: { sg_status_list: statuses }, tree: smart || where }) : null;
  }
  function setFields(){
    opts.putSetting(FIELDS_KEY, JSON.stringify(fields));
    opts.onChange("fields");
  }

  return {
    get project(){ return project; },
    get query(){ return filter.q; },
    setQuery(v){ filter.q = String(v || "").trim(); },
    // A project opens: its own entities / statuses.
    async open(p){
      if (!project || project.id !== p.id){ filter.entity = ""; statuses.clear(); }
      project = p;
      $(".sgb-title").textContent = p.name || "Project";
      paintSeg(); paintStatuses();
      if (!fieldsAll) loadFields().then(() => opts.onChange("labels"), () => {});   // the inspector's field names
      await loadEntities();
    },
    // The filter builder: the Version fields it offers (null until read), the conditions, and setting them.
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
    // One page of Versions (1-based) as grid items; `more` = there may be further pages.
    async page(n){
      const w = smart || where;
      if (w.c.length && !fieldsAll){ await loadFields(); opts.onChange("labels"); }   // a condition needs its field's type (an error shows)
      const cond = w.c.length ? SF().toSgConditions(w, filterFields()) : null;
      const vs = await SG().browseVersions(opts.client(), Object.assign({ project: project.id }, filter), fields, n, SG_PAGE, cond);
      vs.forEach((v) => { if (v.sg_status_list && !statuses.has(v.sg_status_list)){ statuses.add(v.sg_status_list); paintStatuses(); } });
      return { items: vs.map(toItem), more: vs.length === SG_PAGE };
    },
    // a field the loaded Versions lack: the grid loads again
    needsReload(items){ const v = items.find((x) => x.sg)?.sg; return !!v && fields.some((f) => !(f in v)); },
    caption(a){
      const lines = fields.map((f) => SG().fmtField(a.sg, f)).filter(Boolean);
      return lines.length ? lines : [a.sg.code || "#" + a.sg.id];
    },
    // The inspector's rows for one Version: the ticked fields first, then whatever else was read.
    details(a){
      const v = a.sg, label = (k) => (fieldsAll || []).find((f) => f.name === k)?.label || k;
      const keys = fields.concat(Object.keys(v).filter((k) => !fields.includes(k) && !["type", "id", "image", "filmstrip_image", "project", "sg_uploaded_movie"].includes(k)));
      return keys.map((k) => [label(k), SG().fmtField(v, k)]).filter(([, x]) => x);
    },
    thumbUrl(a){ return `/api/sg/thumb/${a.sg.id}?u=${encodeURIComponent(a.sg.updated_at || "")}`; },
    // Filmstrip on a tile's picture host: fetched on the first hover / touch, then the frame under the pointer.
    bindFilmstrip(card, host, getItem){
      let strip = null, fs = null, frames = 0, down = null, forId = "";
      const want = () => {
        const a = getItem();
        if (!a || !a.sg || !a.sg.filmstrip_image) return;
        if (fs && forId === a.id) return;
        forId = a.id; frames = 0;
        if (!strip){ strip = document.createElement("div"); strip.className = "sg-strip"; }
        if (strip.parentNode !== host) host.appendChild(strip);
        strip.style.backgroundImage = "";
        fs = new Image();
        const img = fs;
        img.onload = () => { if (fs !== img) return; frames = SG().filmstripFrames(img.naturalWidth); if (frames > 1){ strip.style.backgroundImage = `url("${img.src}")`; strip.style.aspectRatio = `${img.naturalWidth / frames} / ${img.naturalHeight}`; } };
        img.src = `/api/sg/thumb/${a.sg.id}?kind=filmstrip&u=${encodeURIComponent(a.sg.updated_at || "")}`;
      };
      const scrub = (x) => {
        if (frames < 2 || !strip) return;
        const r = host.getBoundingClientRect(), c = SG().filmstripCss(frames, (x - r.left) / Math.max(1, r.width));
        strip.style.backgroundSize = c.size; strip.style.backgroundPosition = c.pos;
        card.classList.add("sg-scrub");
      };
      const stop = () => card.classList.remove("sg-scrub");
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
    // Opens a Version: {asset, version} once its media is a library file and its review is linked.
    async open1(a){
      const r = await fetch(`/api/sg/open/${a.sg.id}`, { method: "POST", headers: { "X-Sight": "1" } });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.errors?.[0]?.title || `HTTP ${r.status}`);
      const link = SG().linkOf(opts.host(), j.version);
      const cur = await (await fetch(`/api/sg/link/${j.asset.id}`)).json().catch(() => null);
      // a new link starts a fresh sync state; the same Version keeps it
      if (!cur?.link || Number(cur.link.version?.id) !== Number(a.sg.id) || cur.link.site !== link.site){
        await fetch(`/api/sg/link/${j.asset.id}`, { method: "PUT", headers: { "content-type": "application/json", "X-Sight": "1" }, body: JSON.stringify({ link }) });
      }
      return j;
    },
  };
}

function toItem(v){
  const up = v.sg_uploaded_movie && typeof v.sg_uploaded_movie === "object" ? v.sg_uploaded_movie : null;
  const video = !!v.filmstrip_image || (up && (/^video\//.test(up.content_type || "") || /\.(mov|mp4|m4v|webm|mkv|avi)$/i.test(up.name || "")));
  return { id: "sg:" + v.id, sg: v, name: v.code || "#" + v.id, kind: "sgversion", sgVideo: !!video, has_thumb: 1, status: "ready",
    mtime: Date.parse(v.created_at || "") / 1000 || null, width: null, height: null, size: null, ext: "" };
}
