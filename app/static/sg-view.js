// Sight's ShotGrid view (docs/PLAN-trackers.md stage 2): a project's Versions in the main area, narrowed by entity type,
// entity, status and name, each tile showing the fields the user picks (Fields ▾, read from the site's schema).
// Video thumbnails scrub through ShotGrid's filmstrip as the pointer moves over them (a finger dragged sideways on a
// touch screen). Double-click (a tap on touch) opens the Version: Sight's server downloads its web proxy into its
// cache and the file opens in the lightbox, its review linked to the Version.
//
// Pictures come from /api/sg/thumb (cached on disk by the server, refreshed by the Version's updated_at); everything
// else through the shared core (shotgrid-core.js) over /api/sg/fetch. ES module, imported by index.html.

import { hotkey } from "/static/keys.js";

const SG = () => globalThis.SightShotGrid;
const FIELDS_KEY = "sight.sg.fields", FILTER_KEY = "sight.sg.filter";
const PAGE = 60;
const ENTITY_TYPES = [["", "All"], ["Shot", "Shots"], ["Asset", "Assets"], ["Sequence", "Sequences"]];
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const readJson = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch { return d; } };

// opts: { mount, client(): SightShotGrid client, host(): site host, openAsset(asset), toast(text), putSetting(k, v),
//         registerAutoClose(el, close, anchor), tileSize(): px }
export function createSgView(opts){
  const root = opts.mount;
  root.classList.add("sgv");
  let project = null, page = 0, seq = 0, loading = false, done = false, fieldsAll = null;
  let fields = readJson(FIELDS_KEY, null);
  if (!Array.isArray(fields)) fields = SG().DEFAULT_TILE_FIELDS.slice();
  const filter = Object.assign({ type: "", entity: "", status: "", q: "" }, readJson(FILTER_KEY, {}));
  const statuses = new Set();

  root.innerHTML = `
    <div class="sgv-bar">
      <b class="sgv-title"></b>
      <div class="sgv-seg">${ENTITY_TYPES.map(([t, l]) => `<button type="button" data-t="${t}">${l}</button>`).join("")}</div>
      <select class="sgv-ent" aria-label="Entity" hidden></select>
      <select class="sgv-stat" aria-label="Status"><option value="">Any status</option></select>
      <input class="sgv-q" type="search" placeholder="Version name contains…" spellcheck="false">
      <button type="button" class="btn ghost sgv-fields" title="Which fields the tiles show">Fields ▾</button>
      <button type="button" class="btn ghost sgv-refresh" title="Load again">↻</button>
    </div>
    <div class="sgv-fpop" hidden></div>
    <div class="sgv-msg"></div>
    <div class="sgv-grid"></div>
    <div class="sgv-end"></div>`;
  const $ = (s) => root.querySelector(s);
  const grid = $(".sgv-grid"), msg = $(".sgv-msg"), ent = $(".sgv-ent"), stat = $(".sgv-stat"), q = $(".sgv-q"), fpop = $(".sgv-fpop");
  q.value = filter.q || "";
  q.addEventListener("keydown", (e) => e.stopPropagation());
  const saveFilter = () => opts.putSetting(FILTER_KEY, JSON.stringify({ type: filter.type, status: filter.status, q: filter.q }));
  const paintSeg = () => root.querySelectorAll(".sgv-seg button").forEach((b) => b.classList.toggle("on", b.dataset.t === filter.type));
  root.querySelectorAll(".sgv-seg button").forEach((b) => { b.onclick = () => { filter.type = b.dataset.t; filter.entity = ""; saveFilter(); paintSeg(); loadEntities().then(reload); }; });
  ent.onchange = () => { filter.entity = ent.value; reload(); };
  stat.onchange = () => { filter.status = stat.value; saveFilter(); reload(); };
  let qt = 0;
  q.addEventListener("input", () => { opts.onQuery?.(q.value); clearTimeout(qt); qt = setTimeout(() => { filter.q = q.value.trim(); saveFilter(); reload(); }, 400); });
  $(".sgv-refresh").onclick = () => reload();

  // ---- Fields ▾: the Version fields of this site, ticked = shown on the tiles (in the order ticked)
  const fbtn = $(".sgv-fields");
  // touch has no pointer to move away: a tap outside the popover (and off its button) closes it
  document.addEventListener("pointerdown", (e) => { if (!fpop.hidden && !fpop.contains(e.target) && !fbtn.contains(e.target)) fpop.hidden = true; }, true);
  fbtn.onclick = async () => {
    if (!fpop.hidden){ fpop.hidden = true; return; }
    fpop.hidden = false;
    fpop.innerHTML = `<div class="sgv-fhint">Loading fields…</div>`;
    opts.registerAutoClose?.(fpop, () => { fpop.hidden = true; }, fbtn);
    try { fieldsAll = fieldsAll || await SG().versionFields(opts.client()); }
    catch (e){ fpop.innerHTML = `<div class="sgv-fhint">${esc(e.message)}</div>`; return; }
    paintFields("");
  };
  function paintFields(term){
    const t = term.toLowerCase();
    const list = fieldsAll.filter((f) => !t || f.label.toLowerCase().includes(t) || f.name.toLowerCase().includes(t));
    fpop.innerHTML = `<input class="sgv-ffind" type="search" placeholder="Find a field…" value="${esc(term)}" spellcheck="false">
      <div class="sgv-flist">${list.map((f) => `<label><input type="checkbox" data-f="${esc(f.name)}" ${fields.includes(f.name) ? "checked" : ""}> ${esc(f.label)} <small>${esc(f.name)}</small></label>`).join("")}</div>
      <div class="sgv-facts"><button type="button" class="btn ghost" data-act="def">Default</button></div>`;
    const find = fpop.querySelector(".sgv-ffind");
    find.addEventListener("keydown", (e) => { e.stopPropagation(); if (hotkey(e, "Escape")) fpop.hidden = true; });
    find.addEventListener("input", () => { const v = find.value; paintFields(v); const f2 = fpop.querySelector(".sgv-ffind"); f2.focus(); f2.setSelectionRange(v.length, v.length); });
    fpop.querySelectorAll("[data-f]").forEach((c) => {
      c.onchange = () => {
        const n = c.dataset.f;
        fields = c.checked ? fields.concat(fields.includes(n) ? [] : [n]) : fields.filter((x) => x !== n);
        setFields();
      };
    });
    fpop.querySelector("[data-act=def]").onclick = () => { fields = SG().DEFAULT_TILE_FIELDS.slice(); setFields(); paintFields(find.value); };
  }
  function setFields(){
    opts.putSetting(FIELDS_KEY, JSON.stringify(fields));
    // fields already loaded are shown at once; a field the loaded Versions lack makes a new load
    const have = grid.querySelector(".sgv-tile")?._v;
    if (have && fields.some((f) => !(f in have))) reload();
    else grid.querySelectorAll(".sgv-tile").forEach((t) => paintCaption(t));
  }

  // ---- loading
  const fillSel = (sel, items, cur, any) => {
    sel.innerHTML = `<option value="">${esc(any)}</option>` + items.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join("");
    sel.value = items.some(([v]) => String(v) === String(cur)) ? String(cur) : "";
  };
  let entSeq = 0;
  async function loadEntities(){
    const my = ++entSeq;   // (a slower answer for another type / project lands nowhere)
    ent.hidden = !filter.type;
    if (ent.hidden || !project) return;
    fillSel(ent, [], "", "Loading…");
    try {
      const list = await opts.client().search(filter.type, [["project", "is", { type: "Project", id: project.id }]], ["code"], { sort: "code", limit: 5000 });
      if (my !== entSeq) return;
      fillSel(ent, list.map((x) => [x.id, x.code || "#" + x.id]), filter.entity, "Every " + filter.type.toLowerCase());
      filter.entity = ent.value;   // an entity of another project is not kept behind a select that shows "Every …"
    } catch (e){ if (my === entSeq) fillSel(ent, [], "", e.message); }
  }
  const paintStatuses = () => {
    if (filter.status) statuses.add(filter.status);   // the status filtered on shows even when no Version has it
    fillSel(stat, [...statuses].sort().map((s) => [s, s]), filter.status, "Any status");
  };
  function reload(){ page = 0; done = false; seq++; grid.textContent = ""; loading = false; loadMore(); }
  async function loadMore(){
    if (!project || loading || done) return;
    loading = true;
    const my = seq;
    msg.textContent = page ? "" : "Loading…";
    try {
      const vs = await SG().browseVersions(opts.client(), Object.assign({ project: project.id }, filter), fields, page + 1, PAGE);
      if (my !== seq) return;
      page++;
      done = vs.length < PAGE;
      vs.forEach((v) => {
        if (v.sg_status_list && !statuses.has(v.sg_status_list)){ statuses.add(v.sg_status_list); paintStatuses(); }
        grid.appendChild(tile(v));
      });
      msg.textContent = grid.childNodes.length ? "" : "No Version matches.";
    } catch (e){ if (my === seq){ msg.textContent = e.message; done = true; } }
    finally { if (my === seq){ loading = false; if (!done && endVisible()) loadMore(); } }
  }
  const endEl = $(".sgv-end");
  // (hidden — another view on screen — nothing is "near the end": no loading in the background)
  const endVisible = () => { if (root.hidden || !root.offsetParent) return false; const r = endEl.getBoundingClientRect(), p = root.getBoundingClientRect(); return r.top < p.bottom + 400; };
  root.addEventListener("scroll", () => { if (!loading && !done && endVisible()) loadMore(); }, { passive: true });
  // the end coming into sight — also when the view is shown again after being hidden mid-load (a scroll alone would
  // never come if the tiles so far do not fill it)
  if (typeof IntersectionObserver === "function"){
    new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting) && !loading && !done) loadMore(); }, { root, rootMargin: "0px 0px 400px 0px" }).observe(endEl);
  }

  // ---- tiles
  function paintCaption(t){
    const v = t._v, cap = t.querySelector(".cap");
    cap.innerHTML = fields.map((f, i) => { const x = SG().fmtField(v, f); return x ? (i ? `<small>${esc(x)}</small>` : `<b>${esc(x)}</b>`) : ""; }).join("") || `<b>${esc(v.code || "#" + v.id)}</b>`;
  }
  function tile(v){
    const t = document.createElement("div");
    t.className = "sgv-tile"; t.tabIndex = 0; t._v = v; t.dataset.ver = String(v.id);
    t.title = v.code || "";
    const u = encodeURIComponent(v.updated_at || "");
    t.innerHTML = `<div class="th"><img alt="" loading="lazy" draggable="false" src="/api/sg/thumb/${v.id}?u=${u}"><div class="strip"></div></div><div class="cap"></div>`;
    const img = t.querySelector("img"), strip = t.querySelector(".strip");
    img.onerror = () => img.remove();
    paintCaption(t);
    // filmstrip: fetched on the first hover / touch, then the frame under the pointer
    let fs = null, frames = 0;
    const want = () => {
      if (fs || !v.filmstrip_image) return;
      fs = new Image();
      fs.onload = () => { frames = SG().filmstripFrames(fs.naturalWidth); if (frames > 1) strip.style.backgroundImage = `url("${fs.src}")`; };
      fs.src = `/api/sg/thumb/${v.id}?kind=filmstrip&u=${u}`;
    };
    const scrub = (clientX) => {
      if (frames < 2) return;
      const r = t.getBoundingClientRect(), c = SG().filmstripCss(frames, (clientX - r.left) / Math.max(1, r.width));
      strip.style.backgroundSize = c.size; strip.style.backgroundPosition = c.pos;
      t.classList.add("scrub");
    };
    const stop = () => t.classList.remove("scrub");
    let touch = null;
    t.addEventListener("pointerenter", want);
    t.addEventListener("pointermove", (e) => {
      if (e.pointerType === "mouse" || e.pointerType === "pen") scrub(e.clientX);
      else if (touch && Math.abs(e.clientX - touch.x) > 8){ touch.moved = true; scrub(e.clientX); }
    });
    t.addEventListener("pointerleave", stop);
    t.addEventListener("pointerdown", (e) => { want(); if (e.pointerType === "touch") touch = { x: e.clientX, moved: false }; });
    t.addEventListener("pointerup", (e) => {
      if (e.pointerType !== "touch" || !touch) return;
      const tap = !touch.moved; touch = null; stop();
      if (tap) open(v, t);   // touch: a tap opens (a sideways drag only scrubs)
    });
    t.addEventListener("pointercancel", () => { touch = null; stop(); });
    t.addEventListener("click", (e) => { if (e.pointerType !== "touch") select(t); });
    t.addEventListener("dblclick", () => open(v, t));
    t.addEventListener("keydown", (e) => { if (hotkey(e, "Enter")){ e.preventDefault(); open(v, t); } });
    return t;
  }
  function select(t){ grid.querySelectorAll(".sgv-tile.on").forEach((x) => x.classList.remove("on")); t.classList.add("on"); }
  let opening = false;
  async function open(v, t){
    if (opening) return;
    opening = true;
    t.classList.add("busy");
    opts.toast(`Downloading ${esc(v.code || "the Version")}…`, 120000);
    try {
      const r = await fetch(`/api/sg/open/${v.id}`, { method: "POST", headers: { "X-Sight": "1" } });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.errors?.[0]?.title || `HTTP ${r.status}`);
      const link = SG().linkOf(opts.host(), j.version);
      const cur = await (await fetch(`/api/sg/link/${j.asset.id}`)).json().catch(() => null);
      // a new link starts a fresh sync state; the same Version keeps it
      if (!cur?.link || Number(cur.link.version?.id) !== Number(v.id) || cur.link.site !== link.site){
        await fetch(`/api/sg/link/${j.asset.id}`, { method: "PUT", headers: { "content-type": "application/json", "X-Sight": "1" }, body: JSON.stringify({ link }) });
      }
      opts.toast(`${esc(v.code || "Version")} — open the review panel's SG ▾ to sync notes`, 2500);
      opts.onOpened?.();
      await opts.openAsset(j.asset);
    } catch (e){ opts.toast(`Could not open the Version: ${esc(e.message)}`, 5000); }
    finally { opening = false; t.classList.remove("busy"); }
  }

  return {
    async open(p){
      if (!project || project.id !== p.id){ filter.entity = ""; statuses.clear(); }   // another project: its own entities / statuses
      paintStatuses();
      project = p;
      $(".sgv-title").textContent = p.name || "Project";
      root.hidden = false;
      paintSeg();
      await loadEntities();
      reload();
    },
    get project(){ return project; },
    get query(){ return q.value; },
    setQuery(v){ q.value = v; filter.q = v.trim(); saveFilter(); clearTimeout(qt); qt = setTimeout(reload, 400); },
    setTile(px){ root.style.setProperty("--sgv-tile", px + "px"); },
  };
}
