// ShotGrid on the phone (docs/SHOTGRID.md): the connection (Settings → Trackers → ShotGrid), linking the open review to a
// Version, and Sync — the same SightShotGrid.sync as Sight (core/shotgrid-core.js), with this app's merge
// (app.js mergeInto) and report pictures (report.js gatherReport). The app talks to the studio's site itself
// (script key on this device) or through a pass-through proxy (tools/sg-proxy-worker.js) when the site does not
// answer browser requests from this app's address (CORS).
//
// Storage: the connection in localStorage "sight-review:sg" ({site, script, key, proxy, sudo, logins, statusMap});
// the link and the sync state on the review itself (reviews.meta.sg = {link, state}).

const SG = () => globalThis.SightShotGrid;
const KEY = "sight-review:sg";

export function sgConfig(){
  try { const c = JSON.parse(localStorage.getItem(KEY) || "null"); return c && typeof c === "object" ? c : {}; } catch { return {}; }
}
export const sgReady = (c = sgConfig()) => !!(c.site && c.script && c.key);
// A save that connects / disconnects (or changes the site) tells the app: its tracker controls come / go live.
function saveConfig(c){
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch {}
  checkTrackers();
}

// ---- the trackers (docs/PLAN-trackers.md decisions 10, 11) -------------------------------------------------------
// The ones connected on this device: [{id, name, site, host}]; connected = configured and usable (ShotGrid: site,
// script name and key saved — sgReady). The app shows a tracker's controls (the home screen's ShotGrid page and its
// swipe, the person sheet's row, the review's "ShotGrid…") only for a tracker listed here; a change fires
// "sight-trackers" on window (also when another tab of the app changes the connection).
export const TRACKER_KINDS = [{ id: "shotgrid", name: "ShotGrid" }];
const hostOf = (site) => { try { return new URL(site).host; } catch { return site || ""; } };
export function trackers(){
  const c = sgConfig();
  return sgReady(c) ? [{ id: "shotgrid", name: "ShotGrid", site: c.site, host: hostOf(c.site) }] : [];
}
export const trackerOn = (id) => trackers().some((t) => t.id === id);
const trackersKey = () => JSON.stringify(trackers());
// "sight-trackers" only when the list really changed (not on every write of the connection: logins, statuses…):
// after a save here, a write by another tab (storage event) and when the app comes back to the screen.
let lastTrackers = trackersKey();
function checkTrackers(){
  const k = trackersKey();
  if (k === lastTrackers) return;
  lastTrackers = k;
  window.dispatchEvent(new CustomEvent("sight-trackers", { detail: trackers() }));
}
window.addEventListener("storage", (e) => { if (e.key === KEY || e.key === null) checkTrackers(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkTrackers(); });
// Disconnect: the key goes (the site, script name, proxy and logins stay for the next connect).
export function trackerDisconnect(id){
  if (id === "shotgrid") saveConfig({ ...sgConfig(), key: "" });
}
// Connect a tracker…: the kinds not connected yet; a pick opens that tracker's connection form.
export function connectTracker(ui){
  const { sheet, el, btn } = ui;
  const left = TRACKER_KINDS.filter((k) => !trackerOn(k.id));
  sheet((sh, close) => {
    sh.appendChild(el("h2", "", "Connect a tracker"));
    if (!left.length){ sh.appendChild(el("p", "", "Every tracker Sight Review can link to is connected.")); return; }
    sh.appendChild(el("p", "", "Link reviews to a production tracker: browse its Versions on the home screen and sync notes both ways."));
    const m = el("div", "menu");
    left.forEach((k) => m.appendChild(btn("", k.name, () => { close(); if (k.id === "shotgrid") sgSettings(ui); })));
    sh.appendChild(m);
  });
}
function client(c = sgConfig()){
  return SG().createClient({ site: c.site, script: c.script, key: c.key, via: c.proxy ? proxyPrefix(c.proxy) : "" });
}
// "https://sg-proxy.example.workers.dev" -> "https://sg-proxy.example.workers.dev/?url=" (a prefix ending in = is kept)
function proxyPrefix(p){ p = String(p).trim(); return /[=]$/.test(p) ? p : p.replace(/\/?$/, "/") + "?url="; }
const errText = (e) => (e && e.message) || String(e);
const corsHint = (e, c) => (!c.proxy && e instanceof TypeError) ? " — the site may not answer this app directly: set a proxy in Settings → Trackers → ShotGrid" : "";

// ---- Settings → Trackers → ShotGrid: the connection form -----------------------------------------------------------
// ui: {sheet, el, btn, toast}
export function sgSettings(ui){
  const { sheet, el, btn, toast } = ui;
  const c = sgConfig();
  sheet((sh, close) => {
    sh.appendChild(el("h2", "", "ShotGrid"));
    sh.appendChild(el("p", "", "Link reviews to ShotGrid Versions and sync notes both ways. A ShotGrid admin makes an API script (Admin → Scripts): its name and key go here and stay on this device."));
    const f = el("form", "sgform");
    const field = (label, name, type, ph, val) => {
      f.appendChild(el("b", "lab", label));
      const i = el("input"); i.type = type; i.name = name; i.placeholder = ph || ""; i.value = val || ""; i.autocomplete = "off"; i.spellcheck = false;
      if (type === "password" && val) { i.value = ""; i.placeholder = "saved (leave empty to keep)"; }
      f.appendChild(i); return i;
    };
    const site = field("Site", "site", "text", "mystudio.shotgrid.autodesk.com", c.site);
    const script = field("Script name", "script", "text", "sight", c.script);
    const key = field("Script key", "key", "password", "", c.key);
    const proxy = field("Proxy (only if the site does not answer the app)", "proxy", "text", "https://sg-proxy.example.workers.dev", c.proxy);
    f.appendChild(el("b", "lab", "Reviewer logins (Name = login, one per line)"));
    const logins = el("textarea"); logins.name = "logins"; logins.placeholder = "Ann Lee = ann.lee@studio.com";
    logins.value = Object.entries(c.logins || {}).map(([k, v]) => `${k} = ${v}`).join("\n");
    f.appendChild(logins);
    const sudoL = el("label", "chk"); const sudo = el("input"); sudo.type = "checkbox"; sudo.checked = !!c.sudo; sudoL.appendChild(sudo);
    sudoL.appendChild(document.createTextNode(" Post as the reviewer (needs the script to be allowed to act as users)"));
    f.appendChild(sudoL);
    f.appendChild(el("b", "lab", "Note statuses: open / in progress / done"));
    const codes = el("div", "sgcodes");
    const st = ["open", "progress", "done"].map((k, i) => { const x = el("input"); x.type = "text"; x.placeholder = ["opn", "ip", "clsd"][i]; x.value = (c.statusMap || {})[k] || ""; x.setAttribute("aria-label", k); codes.appendChild(x); return x; });
    f.appendChild(codes);
    const msg = el("p", "sgmsg", sgReady(c) ? "Set up." : "Not set up.");
    f.appendChild(msg);
    const read = () => {
      const lg = {};
      logins.value.split(/\r?\n/).forEach((l) => { const m = /^(.+?)\s*=\s*(.+)$/.exec(l.trim()); if (m) lg[m[1].trim()] = m[2].trim(); });
      const n = { site: SG().siteUrl(site.value), script: script.value.trim(), proxy: proxy.value.trim(), sudo: sudo.checked, logins: lg,
        statusMap: { open: st[0].value.trim(), progress: st[1].value.trim(), done: st[2].value.trim() } };
      // the key goes with the site + script it was given for: a new site / script without a new key drops it
      n.key = key.value.trim() || ((n.site === c.site && n.script === c.script) ? c.key || "" : "");
      return n;
    };
    const a = el("div", "acts");
    if (c.site || c.script || c.key) a.appendChild(btn("btn", "Forget", () => { saveConfig({}); toast("ShotGrid connection removed"); close(); }));
    a.appendChild(btn("btn", "Test", async () => {
      const n = read();
      if (!sgReady(n)){ msg.textContent = "Site, script name and key are needed."; return; }
      msg.textContent = "Connecting…";
      try { const ps = await client(n).projects(); msg.textContent = `Connected — ${ps.length} project${ps.length === 1 ? "" : "s"}.`; }
      catch (e){ msg.textContent = errText(e) + corsHint(e, n); }
    }));
    const s = el("button", "btn primary", "Save"); s.type = "submit"; a.appendChild(s);
    f.appendChild(a);
    f.onsubmit = (e) => { e.preventDefault(); const n = read(); saveConfig(n); toast(sgReady(n) ? "ShotGrid connected" : "ShotGrid saved — not connected: site, script name and key are needed", sgReady(n) ? 2000 : 4000); close(); };
    sh.appendChild(f);
  });
}

// ---- the open review: link / sync ----------------------------------------------------------------
// ctx: {sheet, el, btn, toast, busy, R: () => the open review, flush, mergeInto(key, pkg), pictures(ids) -> Map, save(), settings()}
export function sgSheet(ctx){
  const { sheet, el, btn, toast } = ctx;
  const c = sgConfig();
  if (!sgReady(c)){ sgSettings(ctx); return; }
  const R = ctx.R();
  const sg = R.meta.sg || null;
  if (!sg || !sg.link){ pick(ctx); return; }
  sheet((sh, close) => {
    sh.appendChild(el("h2", "", "ShotGrid"));
    {
      const L = sg.link;
      sh.appendChild(el("p", "", `Linked to ${L.version.code}${L.project && L.project.name ? " · " + L.project.name : ""}. Last sync: ${sg.state && sg.state.last ? new Date(sg.state.last).toLocaleString() : "never"}.`));
      const m = el("div", "menu");
      m.appendChild(btn("", "Sync now", () => { close(); sgSync(ctx); }));
      m.appendChild(btn("", "Link to another Version…", () => { close(); pick(ctx); }));
      m.appendChild(btn("danger", "Unlink", () => { close(); R.meta.sg = null; ctx.save(); toast("Unlinked from ShotGrid"); }));
      m.appendChild(btn("", "Connection settings…", () => { close(); sgSettings(ctx); }));
      sh.appendChild(m);
    }
  });
}

function pick(ctx){
  const { sheet, el, btn, toast } = ctx;
  const c = sgConfig(), R = ctx.R();
  const known = SG().linkedVersionOf(R.rows, SG().siteHost(c.site));
  sheet((sh, close) => {
    sh.appendChild(el("h2", "", "Link to a ShotGrid Version"));
    sh.appendChild(el("p", "", R.meta.asset.name));
    const m = el("div", "menu");
    if (known) m.appendChild(btn("", `Version #${known} (from the notes)`, () => { close(); link(ctx, known); }));
    sh.appendChild(m);
    const proj = el("select", "sgproj"); proj.innerHTML = "<option value=''>Loading projects…</option>";
    const q = el("input"); q.type = "text"; q.placeholder = "Version name contains…"; q.value = (R.meta.asset.name || "").replace(/\.[^.]+$/, ""); q.spellcheck = false;
    const list = el("div", "menu sglist");
    sh.appendChild(el("b", "lab", "Project")); sh.appendChild(proj);
    sh.appendChild(el("b", "lab", "Version")); sh.appendChild(q); sh.appendChild(list);
    let timer = 0;
    const find = async () => {
      list.innerHTML = "";
      if (!proj.value) return;
      list.appendChild(el("p", "", "Searching…"));
      try {
        const cl = client(c);
        let vs = await cl.versions(proj.value, q.value.trim());
        if (!vs.length && q.value.trim()){ const short = q.value.trim().replace(/[_. -]*v\d+$/i, ""); if (short !== q.value.trim()) vs = await cl.versions(proj.value, short); }
        list.innerHTML = "";
        if (!vs.length) list.appendChild(el("p", "", "No Version found"));
        vs.forEach((v) => {
          const b = btn("", v.code || "#" + v.id, () => { close(); link(ctx, v.id); });
          b.dataset.ver = String(v.id);
          if (v.entity && v.entity.name) b.appendChild(el("small", "", v.entity.name));
          list.appendChild(b);
        });
      } catch (e){ list.innerHTML = ""; list.appendChild(el("p", "", errText(e) + corsHint(e, c))); }
    };
    q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(find, 450); });
    proj.onchange = () => { try { localStorage.setItem("sight-review:sg.project", proj.value); } catch {} find(); };
    (async () => {
      try {
        const ps = await client(c).projects();
        let want = ""; try { want = localStorage.getItem("sight-review:sg.project") || ""; } catch {}
        proj.innerHTML = "<option value=''>Project…</option>" + ps.map((p) => `<option value="${p.id}">${String(p.name || "#" + p.id).replace(/[&<>"]/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[x])}</option>`).join("");
        if (ps.some((p) => String(p.id) === want)){ proj.value = want; find(); }
      } catch (e){ proj.innerHTML = ""; const o = el("option", "", errText(e)); proj.appendChild(o); toast(errText(e) + corsHint(e, c), 5000); }
    })();
  });
}

async function link(ctx, vid){
  const R = ctx.R();
  const b = ctx.busy("Linking…");
  try {
    const L = await SG().loadVersion(client(), vid);
    R.meta.sg = { link: L, state: {} };
    ctx.save();
    ctx.toast(`Linked to ${L.version.code} — Sync to exchange notes`, 3500);
  } catch (e){ ctx.toast(errText(e), 5000); }
  finally { b.done(); }
}

let syncing = false;
export async function sgSync(ctx){
  if (syncing) return;
  const R = ctx.R(), c = sgConfig();
  if (!R.meta.sg || !R.meta.sg.link){ pick(ctx); return; }
  syncing = true;
  const b = ctx.busy("Syncing with ShotGrid…");
  const key = R.meta.key;
  try {
    await ctx.flush();
    const a = R.meta.asset;
    const res = await SG().sync({
      client: client(c), link: R.meta.sg.link, asset: Object.assign({}, a), fps: R.fps || 24, state: R.meta.sg.state || {},
      statusMap: c.statusMap, logins: c.logins, sudo: !!c.sudo,
      getRows: async () => ctx.R().rows,
      importPackage: (pkg) => ctx.mergeInto(key, pkg),
      pictures: (ids, opt) => ctx.pictures(ids, opt),
      progress: (t) => b.set(t),
    });
    const R2 = ctx.R();
    if (R2 && R2.meta.key === key){ R2.meta.sg = Object.assign({}, R2.meta.sg, { state: res.state }); ctx.save(); }
    const p = res.pulled, q = res.pushed;
    const parts = [p.added && `${p.added} new from ShotGrid`, p.updated && `${p.updated} updated`, q.notes && `${q.notes} sent`, q.updated && `${q.updated} updated there`,
      q.replies && `${q.replies} repl${q.replies === 1 ? "y" : "ies"} sent`, q.pictures && `${q.pictures} picture${q.pictures === 1 ? "" : "s"}`,
      res.skipped && `${res.skipped} linked to another Version (not sent)`].filter(Boolean);
    ctx.toast((parts.join(" · ") || "Up to date with ShotGrid") + (res.errors.length ? ` — ${res.errors.length} problem${res.errors.length === 1 ? "" : "s"}: ${res.errors[0]}` : ""), res.errors.length ? 7000 : 3500);
  } catch (e){
    ctx.toast("ShotGrid sync failed: " + errText(e) + corsHint(e, c), 6000);
  } finally { syncing = false; b.done(); }
}

// ---- the Versions browser (the home screen's second page, docs/PLAN-trackers.md) ------------------------------
// A filter (project · entity type · entity · status) over the project's Versions, newest first, as a grid of
// thumbnails. Thumbnails are cached in Cache Storage by Version id + its updated_at (a newer Version replaces it), so
// the grid draws again without downloading. A tap opens the Version: its review on this device if there is one with
// the media kept, else its web proxy (the uploaded movie / picture) is downloaded and opened as a review linked to it.
// ctx: {el, btn, toast, busy, settings(), reviews(): [meta], openReview(key), openFile(file, link)}
const FILTER_KEY = "sight-review:sgfilter", FIELDS_KEY = "sight-review:sgfields";
const THUMBS = "sight-review-sgthumbs";
const PAGE = 60;
const ENTITY_TYPES = [["", "All"], ["Shot", "Shots"], ["Asset", "Assets"], ["Sequence", "Sequences"]];
function loadFilter(){ try { const f = JSON.parse(localStorage.getItem(FILTER_KEY) || "null"); return f && typeof f === "object" ? f : {}; } catch { return {}; } }
function saveFilter(f){ try { localStorage.setItem(FILTER_KEY, JSON.stringify(f)); } catch {} }
const escHtml = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[x]);

// One thumbnail: from the cache, else downloaded (at most 4 at a time) and put there.
const thumbQ = [];
let thumbRun = 0;
// alive(): the grid still on screen (a browser re-made or closed drops its waiting thumbnails)
// kind: "img" (the thumbnail) or "strip" (the filmstrip of a video, frames side by side)
function thumbUrl(cl, v, alive, kind = "img"){
  return new Promise((ok) => { thumbQ.push({ cl, v, ok, alive, kind }); pumpThumbs(); });
}
// One cache entry per Version (its updated_at in a header: a changed Version replaces it in place); the cache is
// trimmed to the newest MAX_THUMBS entries when a browser opens.
const MAX_THUMBS = 3000;
async function trimThumbs(){
  try {
    if (!globalThis.caches) return;
    const cache = await caches.open(THUMBS), keys = await cache.keys();
    for (let i = 0; i < keys.length - MAX_THUMBS; i++) await cache.delete(keys[i]);  // (oldest first: insertion order)
  } catch {}
}
async function pumpThumbs(){
  while (thumbRun < 4 && thumbQ.length){
    const { cl, v, ok, alive, kind } = thumbQ.shift();
    if (alive && !alive()){ ok(null); continue; }
    thumbRun++;
    (async () => {
      const key = `https://sg-thumb.invalid/${encodeURIComponent(cl.host)}/${v.id}${kind === "strip" ? "/strip" : ""}`, upd = String(v.updated_at || "");
      const src = kind === "strip" ? v.filmstrip_image : v.image;
      try {
        const cache = globalThis.caches ? await caches.open(THUMBS) : null;
        let hit = cache ? await cache.match(key) : null;
        if (hit && hit.headers.get("X-Updated") !== upd) hit = null;
        if (!hit){
          if (!src || typeof src !== "string") return ok(null);
          const blob = await cl.download(src);
          hit = new Response(blob, { headers: { "Content-Type": blob.type || "image/jpeg", "X-Updated": upd } });
          if (cache){ await cache.delete(key); await cache.put(key, hit.clone()); }  // (re-put: the newest at the end)
        }
        ok(URL.createObjectURL(await hit.blob()));
      } catch { ok(null); }
    })().finally(() => { thumbRun--; pumpThumbs(); });
  }
}

export function sgBrowser(ctx, box){
  const { el, btn, toast } = ctx;
  box.textContent = "";
  const c = sgConfig();
  if (!sgReady(c)){
    const e = el("div", "sgb-empty");
    e.appendChild(el("p", "", "Connect ShotGrid to browse your projects' Versions here, open one and review it — the notes sync back."));
    e.appendChild(btn("btn primary", "Connect ShotGrid…", () => ctx.settings()));
    box.appendChild(e);
    return { refresh(){}, dispose(){} };
  }
  const cl = client(c), f = loadFilter(), urls = [];
  let fields = (() => { try { const x = JSON.parse(localStorage.getItem(FIELDS_KEY) || "null"); return Array.isArray(x) ? x : null; } catch { return null; } })() || SG().DEFAULT_TILE_FIELDS.slice();
  let gone = false, opening = false, loading = false;
  trimThumbs();
  const bar = el("div", "sgb-filter");
  const proj = el("select", "sgb-proj"); proj.setAttribute("aria-label", "Project");
  const types = el("div", "seg sgb-types");
  const ent = el("select", "sgb-ent"); ent.setAttribute("aria-label", "Entity");
  const stat = el("select", "sgb-stat"); stat.setAttribute("aria-label", "Status");
  const q = el("input", "sgb-q"); q.type = "search"; q.placeholder = "Version name contains…"; q.spellcheck = false; q.value = f.q || "";
  bar.appendChild(proj); bar.appendChild(types); bar.appendChild(ent);
  const fbtn = btn("btn sgb-fields", "Fields", () => pickFields(), "Which fields the tiles show");
  const row = el("div", "sgb-row"); row.appendChild(stat); row.appendChild(q); row.appendChild(fbtn); bar.appendChild(row);
  box.appendChild(bar);
  const grid = el("div", "sgb-grid"), more = btn("btn sgb-more", "More", () => { if (!loading) load(true); });
  more.hidden = true;
  const msg = el("p", "sgb-msg");
  box.appendChild(msg); box.appendChild(grid); box.appendChild(more);

  ENTITY_TYPES.forEach(([t, label]) => { const b = btn("", label, () => { f.type = t; f.entity = ""; saveFilter(f); paintTypes(); loadEntities().then(() => load()); }); b.dataset.t = t; types.appendChild(b); });
  const paintTypes = () => types.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.t === (f.type || "")));
  paintTypes();
  const fillSel = (sel, items, cur, any) => {
    sel.innerHTML = `<option value="">${escHtml(any)}</option>` + items.map(([v, t]) => `<option value="${escHtml(v)}">${escHtml(t)}</option>`).join("");
    sel.value = items.some(([v]) => String(v) === String(cur)) ? String(cur) : "";
  };
  async function loadEntities(){
    ent.hidden = !f.type || !f.project;
    if (ent.hidden) return;
    fillSel(ent, [], "", "Loading…");
    try {
      const list = await cl.search(f.type, [["project", "is", { type: "Project", id: Number(f.project) }]], ["code"], { sort: "code", limit: 2000 });
      fillSel(ent, list.map((x) => [x.id, x.code || "#" + x.id]), f.entity, "Every " + f.type.toLowerCase());
    } catch (e){ fillSel(ent, [], "", errText(e)); }
  }
  const statuses = new Set(f.status ? [f.status] : []);
  const paintStat = () => fillSel(stat, [...statuses].sort().map((s) => [s, s]), f.status || "", "Any status");
  paintStat();
  let page = 0, seq = 0, gridGen = 0;
  async function load(append){
    if (!f.project){ ++seq; loading = false; grid.textContent = ""; msg.textContent = "Pick a project."; more.hidden = true; return; }  // (a load in flight lands nowhere)
    const my = ++seq;
    loading = true;
    if (!append){ gridGen++; page = 0; grid.textContent = ""; urls.splice(0).forEach((u) => URL.revokeObjectURL(u)); }
    msg.textContent = "Loading…";
    try {
      const vs = await SG().browseVersions(cl, f, fields, page + 1, PAGE);
      if (my !== seq) return;
      page++;
      vs.forEach((v) => { if (v.sg_status_list && !statuses.has(v.sg_status_list)){ statuses.add(v.sg_status_list); paintStat(); } grid.appendChild(tile(v)); });
      msg.textContent = grid.childNodes.length ? "" : "No Version matches.";
      more.hidden = vs.length < PAGE;
    } catch (e){ if (my === seq){ msg.textContent = errText(e) + corsHint(e, c); more.hidden = true; } }
    finally { if (my === seq) loading = false; }
  }
  // ---- Fields: which Version fields the tiles show (read from the site's schema), kept on the device
  function paintCap(t, cap){
    cap = cap || t.querySelector(".cap");
    cap.textContent = "";
    fields.forEach((k, i) => { const x = SG().fmtField(t._v, k); if (x) cap.appendChild(el(i ? "small" : "b", "", x)); });
    if (!cap.childNodes.length) cap.appendChild(el("b", "", t._v.code || "#" + t._v.id));
  }
  let fieldsAll = null;
  async function pickFields(){
    const b = ctx.busy("Reading the fields…");
    try { fieldsAll = fieldsAll || await SG().versionFields(cl); }
    catch (e){ toast(errText(e) + corsHint(e, c), 5000); return; }
    finally { b.done(); }
    ctx.sheet((sh, close) => {
      sh.appendChild(el("h2", "", "Fields on the tiles"));
      const list = el("div", "sgb-flist");
      fieldsAll.forEach((fd) => {
        const l = el("label", "chk"), x = el("input"); x.type = "checkbox"; x.checked = fields.includes(fd.name); x.dataset.f = fd.name;
        x.onchange = () => {
          fields = x.checked ? fields.concat(fields.includes(fd.name) ? [] : [fd.name]) : fields.filter((k) => k !== fd.name);
          saveFields();
        };
        l.appendChild(x); l.appendChild(document.createTextNode(" " + fd.label));
        list.appendChild(l);
      });
      sh.appendChild(list);
      const a = el("div", "acts");
      a.appendChild(btn("btn", "Default", () => { fields = SG().DEFAULT_TILE_FIELDS.slice(); saveFields(); close(); }));
      a.appendChild(btn("btn primary", "Done", close));
      sh.appendChild(a);
    });
  }
  function saveFields(){
    try { localStorage.setItem(FIELDS_KEY, JSON.stringify(fields)); } catch {}
    const have = grid.querySelector(".sgb-tile");
    if (have && fields.some((k) => !(k in have._v))) load();   // a field the loaded Versions lack: load again
    else grid.querySelectorAll(".sgb-tile").forEach((t) => paintCap(t));
  }
  function linkedReview(v){
    return ctx.reviews().find((m) => m.sg && m.sg.link && m.sg.link.site === cl.host && Number(m.sg.link.version.id) === Number(v.id));
  }
  function tile(v){
    const t = btn("sgb-tile", "", () => open(v)), gen = gridGen;  // (a new grid drops this tile's waiting thumbnail; "More" keeps it)
    t.dataset.ver = String(v.id);
    const th = el("div", "th"), cap = el("div", "cap"), strip = el("div", "strip");
    t._v = v;
    paintCap(t, cap);
    if (linkedReview(v)) t.classList.add("has");
    th.appendChild(strip);
    t.appendChild(th); t.appendChild(cap);
    const alive = () => !gone && gen === gridGen;
    thumbUrl(cl, v, alive).then((u) => { if (!u) return; if (gone){ URL.revokeObjectURL(u); return; } urls.push(u); const im = el("img"); im.alt = ""; im.src = u; th.insertBefore(im, strip); });
    // Filmstrip (a video's frames side by side): a finger dragged sideways over the picture (or a mouse over it)
    // shows the frame under it; a drag does not open the Version, a tap does.
    let frames = 0, asked = false, down = null;
    const want = () => {
      if (asked || !v.filmstrip_image) return;
      asked = true;
      thumbUrl(cl, v, alive, "strip").then((u) => {
        if (!u) return; if (gone){ URL.revokeObjectURL(u); return; }
        urls.push(u);
        const im = new Image();
        im.onload = () => { frames = SG().filmstripFrames(im.naturalWidth); if (frames > 1) strip.style.backgroundImage = `url("${u}")`; };
        im.src = u;
      });
    };
    const scrub = (x) => {
      if (frames < 2) return;
      const r = th.getBoundingClientRect(), c2 = SG().filmstripCss(frames, (x - r.left) / Math.max(1, r.width));
      strip.style.backgroundSize = c2.size; strip.style.backgroundPosition = c2.pos; t.classList.add("scrub");
    };
    th.addEventListener("pointerdown", (e) => { want(); down = { x: e.clientX, moved: false, touch: e.pointerType !== "mouse" }; });
    th.addEventListener("pointermove", (e) => {
      if (e.pointerType === "mouse"){ want(); scrub(e.clientX); return; }
      if (down && Math.abs(e.clientX - down.x) > 8){ down.moved = true; scrub(e.clientX); }
    });
    const end = () => { if (down && down.moved) t._dragged = performance.now(); down = null; t.classList.remove("scrub"); };
    th.addEventListener("pointerup", end); th.addEventListener("pointercancel", end);
    th.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") t.classList.remove("scrub"); });
    return t;
  }
  async function open(v){
    if (v && grid.querySelector(`.sgb-tile[data-ver="${v.id}"]`)?._dragged > performance.now() - 400) return;  // the end of a filmstrip drag
    if (opening) return;  // (a double tap: one download)
    opening = true;
    try { await open1(v); } finally { opening = false; }
  }
  async function open1(v){
    const m = linkedReview(v);
    if (m && m.kept){ await ctx.openReview(m.key); return; }
    // a linked review of a still takes the Version's picture when the upload is a movie (an uploaded still is kept)
    const up = v.sg_uploaded_movie && typeof v.sg_uploaded_movie === "object" ? v.sg_uploaded_movie : null;
    const upVideo = up && (/^video\//.test(up.content_type || "") || /\.(mov|mp4|m4v|webm|mkv|avi)$/i.test(up.name || ""));
    const mov = up && !(m && m.asset && m.asset.kind === "image" && upVideo) ? up : null;
    const src = mov && mov.url ? { url: mov.url, name: mov.name || (v.code + ".mp4"), type: mov.content_type || "video/mp4" }
      : typeof v.image === "string" && v.image ? { url: v.image, name: (v.code || "version") + ".jpg", type: "image/jpeg" } : null;
    if (!src){ toast("This Version has no media to play on the phone", 4000); return; }
    const b = ctx.busy("Downloading " + (v.code || "the Version") + "…");
    try {
      const blob = await cl.download(src.url);
      let name = src.name;
      if (!/\.[a-z0-9]{2,5}$/i.test(name)) name += /video/.test(blob.type || src.type) ? ".mp4" : ".jpg";
      const file = new File([blob], name, { type: blob.type || src.type });
      b.done();
      // the review this Version already has (its media not on the device): that one, not a second empty one
      if (m) await ctx.openReview(m.key, file);
      else await ctx.openFile(file, SG().linkOf(cl.host, v));
    } catch (e){ b.done(); toast("Could not download the Version: " + errText(e) + corsHint(e, c), 6000); }
  }

  proj.onchange = () => { f.project = proj.value; f.entity = ""; saveFilter(f); loadEntities().then(() => load()); };
  ent.onchange = () => { f.entity = ent.value; saveFilter(f); load(); };
  stat.onchange = () => { f.status = stat.value; saveFilter(f); load(); };
  let qt = 0;
  q.addEventListener("input", () => { clearTimeout(qt); qt = setTimeout(() => { f.q = q.value.trim(); saveFilter(f); load(); }, 450); });
  (async () => {
    fillSel(proj, [], "", "Loading projects…");
    try {
      const ps = await cl.projects();
      fillSel(proj, ps.map((p) => [p.id, p.name || "#" + p.id]), f.project, "Project…");
      if (!proj.value) f.project = "";
      await loadEntities();
      await load();
    } catch (e){ fillSel(proj, [], "", "No projects"); msg.textContent = errText(e) + corsHint(e, c); }
  })();
  return { refresh(){ load(); }, dispose(){ gone = true; seq++; urls.splice(0).forEach((u) => URL.revokeObjectURL(u)); } };
}

// The user sheet (the home screen's person button): the reviewer name and a row per connected tracker (none
// connected: no tracker part at all — Settings → Trackers is where one is connected).
// ui: {sheet, el, btn, toast, who(): name, setName(): Promise<bool>, settings()}
export function userSheet(ui){
  const { sheet, el, btn } = ui;
  const c = sgConfig(), list = trackers();
  sheet((sh, close) => {
    sh.appendChild(el("h2", "", "You"));
    const kv = el("div", "kv");
    kv.appendChild(el("b", "", "Reviewer name"));
    const nm = kv.appendChild(btn("tapedit", ui.who() || "—", async () => { if (await ui.setName()) nm.textContent = ui.who(); }));
    nm.title = "Tap to change your name";
    list.forEach((t) => {
      kv.appendChild(el("b", "", t.name));
      kv.appendChild(el("span", "", "connected · " + t.host + (t.id === "shotgrid" && c.sudo ? " · as reviewer" : "")));
    });
    sh.appendChild(kv);
    if (list.some((t) => t.id === "shotgrid")){
      const a = el("div", "acts");
      a.appendChild(btn("btn", "ShotGrid connection…", () => { close(); ui.settings(); }));
      sh.appendChild(a);
    }
  });
}
