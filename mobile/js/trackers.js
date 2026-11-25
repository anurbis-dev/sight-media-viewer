// Trackers on the phone (docs/PLAN-trackers.md decisions 10, 11; docs/ARCHITECTURE.md "Tracker adapters"; ShotGrid:
// docs/SHOTGRID.md). Generic over the tracker adapters (core/trackers-core.js registry; ShotGrid's is in
// core/shotgrid-core.js): nothing here names a tracker. Per connected tracker the app has a home page (its media
// entities — ShotGrid: Versions — as a grid, `trackerBrowser`), a row in the person sheet, an item in a review's ⋯ menu
// (`trackerSheet`: link the review to a media entity, Sync — the adapter's sync with this app's merge, app.js
// mergeInto, and report pictures, report.js gatherReport) and its settings in Settings → Trackers (the adapter's
// declarative form, rendered by SightTrackers.mountForm like Sight's Settings → Trackers). The app talks to the
// tracker itself with the credentials kept on this device (adapter.deviceClient; ShotGrid: the script key, or a
// pass-through proxy, tools/sg-proxy-worker.js, when the site does not answer browser requests from this app — CORS).
//
// Storage, per kind (adapter.storeKey(name, "phone"); ShotGrid keeps its pre-0.108 names — sight-review:sg,
// sgfilter, sgfields, sgwhere, sg.project, the Cache Storage "sight-review-sgthumbs"): the connections (0.110: a list,
// one per site — several sites of one kind can be connected at once — under storeKey("connections"); before that the
// one connection under storeKey("connection"), still read while no list is stored, never written), the browser's quick
// filters, tile fields, last project (per site since 0.110: storeName(…, host), falling back to the per-kind name),
// Filter conditions (per "<host> <project>" already). A review's links:
// reviews.meta.trk = {"<tracker key>": {link, state}} — a review made before 0.108 has ShotGrid's in meta.sg, read
// as the link under "shotgrid:<its host>" (reviewLinks) and moved into meta.trk at the next change of a link.

const TRK = () => globalThis.SightTrackers;
const SF = () => globalThis.SightFilter;
const adapterOf = (kind) => TRK()?.adapter(kind) || null;
const errText = (e) => (e && e.message) || String(e);
const escHtml = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[x]);
const cap1 = (s) => String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1);

// ---- the connection kept on this device, per kind ----------------------------------------------------------------
// TRACKER_KINDS: the kinds this app can connect — an adapter (registry) with a device client and a phone settings form.
// (core/trackers-core.js missing — a half-updated install — must not blank the app: no kinds, no trackers then)
export const TRACKER_KINDS = (TRK()?.kinds() || []).filter((k) => {
  const A = adapterOf(k.id);
  return !!(A && A.deviceClient && A.settings && TRK().formFields(A, "phone").length);
});
const connKey = (A) => A.storeKey("connection", "phone");     // (the one connection before 0.110: read, never written)
const listKey = (A) => A.storeKey("connections", "phone");
const isObj = (c) => !!c && typeof c === "object" && !Array.isArray(c);
// A kind's connections on this device, in order (each the settings form's values).
export function trackerConnections(kind){
  const A = adapterOf(kind);
  if (!A) return [];
  try {
    const raw = localStorage.getItem(listKey(A));
    if (raw !== null){ const l = JSON.parse(raw); return Array.isArray(l) ? l.filter(isObj) : []; }
    const c = JSON.parse(localStorage.getItem(connKey(A)) || "null");
    return isObj(c) && Object.keys(c).length ? [c] : [];
  } catch { return []; }
}
// The owner of a kind's pre-0.110 settings (filter, fields, project): the host of the one connection kept then —
// recorded once, at start, never by which page opens first (SightTrackers.claimLegacy / readStored).
TRACKER_KINDS.forEach((k) => {
  const A = adapterOf(k.id), get = (x) => localStorage.getItem(x);
  try { TRK().claimLegacy(get, (x, v) => localStorage.setItem(x, v), A, "phone", [TRK().legacyConnectionHost(get, A)]); } catch {}
});
const ready = (A, c) => TRK().formReady(A, c);
const keyOfConn = (kind, c) => (c && c.site ? TRK().key(kind, c.site) : "");
// One connection: by tracker key (connected or not), or by kind — its first connected one, else its first (the one
// connection every pre-0.110 caller knew).
export function trackerConfig(ref){
  const sk = TRK()?.split(ref), kind = sk ? sk.kind : ref, A = adapterOf(kind), list = trackerConnections(kind);
  if (!A) return {};
  if (sk) return list.find((c) => keyOfConn(kind, c) === ref) || {};
  return list.find((c) => ready(A, c)) || list[0] || {};
}
// A save that connects / disconnects (or changes the site) tells the app: its tracker controls come / go live.
function saveConnections(kind, list){
  const A = adapterOf(kind);
  if (!A) return;
  try { localStorage.setItem(listKey(A), JSON.stringify(list.filter((c) => isObj(c) && Object.keys(c).length))); } catch {}
  checkTrackers();
}
const clientOf = (A, c) => A.deviceClient(c);
const hintOf = (A, e, c) => (A.deviceHint ? A.deviceHint(e, c) : "");

// The ones connected on this device: [{id, kind, key, name, site, host, note}] — the same entry as Sight's
// /api/trackers (id = kind, key = the tracker key "<kind>:<host>", SightTrackers.key); connected = configured and
// usable (every field the adapter's form requires saved — ShotGrid: site, script name and key). The app shows a
// tracker's controls only for a tracker listed here; a change fires "sight-trackers" on window (also when another tab
// of the app changes a connection).
export function trackers(){
  if (!TRK()) return [];
  const out = [];
  TRACKER_KINDS.forEach((k) => {
    const A = adapterOf(k.id);
    trackerConnections(k.id).forEach((c) => {
      const key = keyOfConn(k.id, c);
      if (!ready(A, c) || !key || out.some((t) => t.key === key)) return;   // (the same site twice: the first counts)
      out.push({ id: k.id, kind: k.id, key, name: A.name, site: c.site, host: TRK().hostOf(c.site) || c.site,
        note: A.deviceNote ? A.deviceNote(c) : "" });
    });
  });
  return out;
}
export const trackerOn = (id) => trackers().some((t) => t.kind === id || t.key === id);
// A tracker's name as a tab / menu item shows it: its kind's name, plus its site while another site of the kind is on.
// short: the adapter's short name with a site ("SG · studio-b": a home tab, where room is scarce).
export const trackerLabel = (t, list, short) => {
  const s = TRK()?.siteLabel(t, list || trackers()), A = adapterOf(t.kind);
  return (s && short && A && A.short ? A.short : t.name) + (s ? " · " + s : "");
};
const trackersKey = () => JSON.stringify(trackers());
// "sight-trackers" only when the list really changed (not on every write of a connection: logins, statuses…):
// after a save here, a write by another tab (storage event) and when the app comes back to the screen.
let lastTrackers = trackersKey();
function checkTrackers(){
  const k = trackersKey();
  if (k === lastTrackers) return;
  lastTrackers = k;
  window.dispatchEvent(new CustomEvent("sight-trackers", { detail: trackers() }));
}
window.addEventListener("storage", (e) => { if (e.key === null || TRACKER_KINDS.some((k) => [connKey(adapterOf(k.id)), listKey(adapterOf(k.id))].includes(e.key))) checkTrackers(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkTrackers(); });
// Disconnect: the secret goes (ShotGrid: the key; the site, script name, proxy and logins stay for the next connect).
// (key: the tracker key; a kind: its first connected site, as before 0.110)
export function trackerDisconnect(key){
  const sk = TRK()?.split(key), kind = sk ? sk.kind : key, A = adapterOf(kind), sec = A && TRK().secretOf(A, "phone");
  if (!sec) return;
  const list = trackerConnections(kind), cur = trackerConfig(key), i = list.indexOf(list.find((c) => JSON.stringify(c) === JSON.stringify(cur)));
  if (i < 0) return;
  list[i] = { ...list[i], [sec.name]: "" };
  saveConnections(kind, list);
}
// Connect a tracker…: every kind (a connected one too: another site of it); a pick opens a connection form — the
// kind's first stored connection that is not connected (its settings kept from a Disconnect), else a new one.
export function connectTracker(ui){
  const { sheet, el, btn } = ui;
  const left = TRACKER_KINDS;
  sheet((sh, close) => {
    sh.appendChild(el("h2", "", "Connect a tracker"));
    if (!left.length){ sh.appendChild(el("p", "", "Sight Review has no tracker it can link to.")); return; }
    sh.appendChild(el("p", "", "Link reviews to a production tracker: browse its Versions on the home screen and sync notes both ways. A tracker already connected can be connected again for another site."));
    const m = el("div", "menu");
    left.forEach((k) => m.appendChild(btn("", trackerOn(k.id) ? `${k.name} — another site` : k.name, () => { close(); trackerSettings(k.id, ui); })));
    sh.appendChild(m);
  });
}

// ---- Settings → Trackers → <tracker>: the adapter's settings form ---------------------------------------------------
// ui: {sheet, el, btn, toast}; key: the connection to edit (its tracker key) — none: the kind's spare connection (the
// first stored one not connected, else a new one: Connect a tracker…)
export function trackerSettings(kind, ui, key){
  const A = adapterOf(kind);
  if (!A || !A.settings) return;
  const { sheet, el, btn, toast } = ui, F = A.settings;
  const sec = TRK().secretOf(A, "phone"), needs = F.needs || "its settings";
  const list0 = trackerConnections(kind);
  const orig = key ? list0.find((c) => keyOfConn(kind, c) === key) || null : list0.find((c) => !ready(A, c)) || null;
  const c = orig || {};
  // the connection this sheet edits, in the list as it is at the save (another tab may have changed it meanwhile)
  const at = (list) => orig ? list.findIndex((x) => JSON.stringify(x) === JSON.stringify(orig)) : -1;
  sheet((sh, close) => {
    const t0 = key ? trackers().find((t) => t.key === key) : null;
    sh.appendChild(el("h2", "", t0 ? trackerLabel(t0) : A.name));
    const intro = TRK().pick(F.intro, "phone");
    if (intro) sh.appendChild(el("p", "", intro));
    const f = el("form", "trkform");
    f.dataset.tracker = kind;
    const form = TRK().mountForm(f, A, "phone");
    form.fill(c);
    const msg = el("p", "trkmsg", ready(A, c) ? "Set up." : "Not set up.");
    f.appendChild(msg);
    const read = () => {
      const n = form.read();
      TRK().formFields(A, "phone").forEach((x) => { if (x.clean && typeof n[x.name] === "string") n[x.name] = x.clean(n[x.name]); });
      // the secret goes with the fields it was given for (ShotGrid: the key with the site + script): another value
      // without a new secret drops it
      if (sec && !n[sec.name]) n[sec.name] = (sec.keptWith || []).every((k) => n[k] === c[k]) ? c[sec.name] || "" : "";
      return n;
    };
    const a = el("div", "acts");
    if ((F.required || []).some((k) => c[k])) a.appendChild(btn("btn", "Forget", () => {
      const list = trackerConnections(kind), i = at(list);
      if (i >= 0) list.splice(i, 1);
      saveConnections(kind, list); toast(A.name + " connection removed"); close();
    }));
    a.appendChild(btn("btn", "Test", async () => {
      const n = read();
      if (!ready(A, n)){ msg.textContent = cap1(needs) + " are needed."; return; }
      msg.textContent = "Connecting…";
      try { const ps = await A.projects(clientOf(A, n)); msg.textContent = `Connected — ${ps.length} project${ps.length === 1 ? "" : "s"}.`; }
      catch (e){ msg.textContent = errText(e) + hintOf(A, e, n); }
    }));
    const s = el("button", "btn primary", "Save"); s.type = "submit"; a.appendChild(s);
    f.appendChild(a);
    f.onsubmit = (e) => {
      e.preventDefault();
      const n = read(), ok = ready(A, n), list = trackerConnections(kind), i = at(list), k = keyOfConn(kind, n);
      // the same site twice: refused while the other one is connected; a stored one not connected gives way to this
      if (k && list.some((x, j) => j !== i && ready(A, x) && keyOfConn(kind, x) === k)){ msg.textContent = `${TRK().hostOf(n.site)} is already connected.`; return; }
      const mine = i >= 0 ? list[i] : null;
      const rest = list.filter((x, j) => j !== i && !(k && keyOfConn(kind, x) === k));
      const pos = mine ? rest.indexOf(list.slice(0, i).reverse().find((x) => rest.includes(x))) + 1 : rest.length;
      rest.splice(pos, 0, n);
      saveConnections(kind, rest);
      toast(ok ? A.name + " connected" : `${A.name} saved — not connected: ${needs} are needed`, ok ? 2000 : 4000);
      close();
    };
    sh.appendChild(f);
  });
}

// ---- a review's links, one per tracker key ----------------------------------------------------------------------
// reviews.meta.trk = {"<tracker key>": {link, state}}. A review saved before 0.108 holds ShotGrid's link in
// meta.sg = {link, state} (link.site = the site's host): read as the link under "shotgrid:<host>" — the key the
// server's own sg_links migration uses (port kept, no scheme guessed) — and moved into meta.trk, meta.sg removed, by
// the next setReviewLink (a link, an unlink, a sync), never dropped. A key in meta.trk wins over meta.sg.
function legacyKey(meta){
  const L = meta && meta.sg && typeof meta.sg === "object" ? meta.sg.link : null;
  if (!L || typeof L.site !== "string" || !L.site) return "";
  const k = "shotgrid:" + L.site.trim().toLowerCase();
  return TRK()?.split(k) ? k : "";
}
export function reviewLinks(meta){
  const out = {}, lk = legacyKey(meta), t = meta && meta.trk;
  if (lk) out[lk] = meta.sg;
  if (t && typeof t === "object" && !Array.isArray(t)) Object.keys(t).forEach((k) => { if (t[k] && typeof t[k] === "object" && t[k].link) out[k] = t[k]; });
  return out;
}
export const reviewLink = (meta, key) => (key && reviewLinks(meta)[key]) || null;
// entry {link, state} or null (unlink)
export function setReviewLink(meta, key, entry){
  const all = reviewLinks(meta);
  if (entry && entry.link) all[key] = entry; else delete all[key];
  meta.trk = all;
  // (a meta.sg that could not be read as a link — no site — stays where it is: never dropped unread)
  if (legacyKey(meta) || !(meta.sg && meta.sg.link)) delete meta.sg;
}
// A review opened from a tracker page is tied to that media entity; the same one again keeps its sync state.
export function linkReview(meta, key, link){
  const cur = reviewLink(meta, key), A = adapterOf(TRK()?.split(key)?.kind);
  const same = !!(cur && A && String(A.linkId(cur.link)) === String(A.linkId(link)));
  setReviewLink(meta, key, { link, state: same ? cur.state || {} : {} });
}
// The ⋯ menu's note for a tracker: the linked media entity's name, else what the item does.
export function reviewLinkLabel(meta, t){
  const e = reviewLink(meta, t.key), A = adapterOf(t.kind);
  return e && A ? A.linkLabel(e.link) : "";
}

// ---- the open review: link / sync ---------------------------------------------------------------------------------
// ctx: {sheet, el, btn, toast, busy, R: () => the open review, flush, mergeInto(key, pkg), pictures(ids) -> Map, save()}
// t: the tracker (an entry of trackers())
export function trackerSheet(ctx, t){
  const { sheet, el, btn, toast } = ctx;
  const A = adapterOf(t.kind), c = trackerConfig(t.key);
  if (!A) return;
  if (!ready(A, c)){ trackerSettings(t.kind, ctx, t.key); return; }
  const R = ctx.R();
  const cur = reviewLink(R.meta, t.key);
  if (!cur){ pick(ctx, t); return; }
  sheet((sh, close) => {
    sh.appendChild(el("h2", "", trackerLabel(t)));
    const L = cur.link, proj = A.linkProject(L);
    sh.appendChild(el("p", "", `Linked to ${A.linkLabel(L)}${proj ? " · " + proj : ""}. Last sync: ${cur.state && cur.state.last ? new Date(cur.state.last).toLocaleString() : "never"}.`));
    const m = el("div", "menu");
    m.appendChild(btn("", "Sync now", () => { close(); trackerSync(ctx, t); }));
    m.appendChild(btn("", `Link to another ${A.media.one}…`, () => { close(); pick(ctx, t); }));
    m.appendChild(btn("danger", "Unlink", () => { close(); setReviewLink(R.meta, t.key, null); ctx.save(); toast("Unlinked from " + A.name); }));
    m.appendChild(btn("", "Connection settings…", () => { close(); trackerSettings(t.kind, ctx, t.key); }));
    sh.appendChild(m);
  });
}

function pick(ctx, t){
  const { sheet, el, btn, toast } = ctx;
  const A = adapterOf(t.kind), c = trackerConfig(t.key), R = ctx.R(), one = A.media.one;
  const projKey = TRK().storeName(A, "project", "phone", t.host);
  const known = A.linkedIdOf(R.rows, A.siteHost(c.site));
  sheet((sh, close) => {
    sh.appendChild(el("h2", "", `Link to a ${A.name} ${one}`));
    sh.appendChild(el("p", "", R.meta.asset.name));
    const m = el("div", "menu");
    if (known) m.appendChild(btn("", `${one} #${known} (from the notes)`, () => { close(); link(ctx, t, known); }));
    sh.appendChild(m);
    const proj = el("select", "sgproj"); proj.innerHTML = "<option value=''>Loading projects…</option>";
    const q = el("input"); q.type = "text"; q.placeholder = one + " name contains…"; q.value = (R.meta.asset.name || "").replace(/\.[^.]+$/, ""); q.spellcheck = false;
    const list = el("div", "menu sglist");
    sh.appendChild(el("b", "lab", "Project")); sh.appendChild(proj);
    sh.appendChild(el("b", "lab", one)); sh.appendChild(q); sh.appendChild(list);
    let timer = 0;
    const find = async () => {
      list.innerHTML = "";
      if (!proj.value) return;
      list.appendChild(el("p", "", "Searching…"));
      try {
        const cl = clientOf(A, c);
        let vs = await A.findMedia(cl, proj.value, q.value.trim());
        if (!vs.length && q.value.trim()){ const short = q.value.trim().replace(/[_. -]*v\d+$/i, ""); if (short !== q.value.trim()) vs = await A.findMedia(cl, proj.value, short); }
        list.innerHTML = "";
        if (!vs.length) list.appendChild(el("p", "", `No ${one} found`));
        vs.forEach((v) => {
          const b = btn("", A.recordName(v), () => { close(); link(ctx, t, A.recordId(v)); });
          b.dataset.ver = String(A.recordId(v));
          const sub = A.recordSub ? A.recordSub(v) : "";
          if (sub) b.appendChild(el("small", "", sub));
          list.appendChild(b);
        });
      } catch (e){ list.innerHTML = ""; list.appendChild(el("p", "", errText(e) + hintOf(A, e, c))); }
    };
    q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(find, 450); });
    proj.onchange = () => { try { localStorage.setItem(projKey, proj.value); } catch {} find(); };
    (async () => {
      try {
        const ps = await A.projects(clientOf(A, c));
        const want = TRK().readStored((k) => localStorage.getItem(k), A, "project", "phone", t.host) || "";
        proj.innerHTML = "<option value=''>Project…</option>" + ps.map((p) => `<option value="${escHtml(p.id)}">${escHtml(p.name || "#" + p.id)}</option>`).join("");
        if (ps.some((p) => String(p.id) === want)){ proj.value = want; find(); }
      } catch (e){ proj.innerHTML = ""; const o = el("option", "", errText(e)); proj.appendChild(o); toast(errText(e) + hintOf(A, e, c), 5000); }
    })();
  });
}

async function link(ctx, t, id){
  const R = ctx.R(), A = adapterOf(t.kind);
  const b = ctx.busy("Linking…");
  try {
    const L = await A.loadLink(clientOf(A, trackerConfig(t.key)), id);
    setReviewLink(R.meta, t.key, { link: L, state: {} });
    ctx.save();
    ctx.toast(`Linked to ${A.linkLabel(L)} — Sync to exchange notes`, 3500);
  } catch (e){ ctx.toast(errText(e), 5000); }
  finally { b.done(); }
}

let syncing = false;
export async function trackerSync(ctx, t){
  if (syncing) return;
  const R = ctx.R(), A = adapterOf(t.kind), c = trackerConfig(t.key);
  const cur = reviewLink(R.meta, t.key);
  if (!cur){ pick(ctx, t); return; }
  syncing = true;
  const b = ctx.busy(`Syncing with ${A.name}…`);
  const key = R.meta.key;
  try {
    await ctx.flush();
    const a = R.meta.asset;
    const res = await A.sync({
      client: clientOf(A, c), link: cur.link, asset: Object.assign({}, a), fps: R.fps || 24, state: cur.state || {}, settings: c,
      getRows: async () => ctx.R().rows,
      importPackage: (pkg) => ctx.mergeInto(key, pkg),
      pictures: (ids, opt) => ctx.pictures(ids, opt),
      progress: (x) => b.set(x),
    });
    const R2 = ctx.R(), now = R2 && R2.meta.key === key ? reviewLink(R2.meta, t.key) : null;
    if (now){ setReviewLink(R2.meta, t.key, Object.assign({}, now, { state: res.state })); ctx.save(); }   // (unlinked meanwhile: stays unlinked)
    const p = res.pulled, q = res.pushed;
    const parts = [p.added && `${p.added} new from ${A.name}`, p.updated && `${p.updated} updated`, q.notes && `${q.notes} sent`, q.updated && `${q.updated} updated there`,
      q.replies && `${q.replies} repl${q.replies === 1 ? "y" : "ies"} sent`, q.pictures && `${q.pictures} picture${q.pictures === 1 ? "" : "s"}`,
      res.skipped && `${res.skipped} linked to another ${A.media.one} (not sent)`].filter(Boolean);
    ctx.toast((parts.join(" · ") || "Up to date with " + A.name) + (res.errors.length ? ` — ${res.errors.length} problem${res.errors.length === 1 ? "" : "s"}: ${res.errors[0]}` : ""), res.errors.length ? 7000 : 3500);
  } catch (e){
    ctx.toast(`${A.name} sync failed: ` + errText(e) + hintOf(A, e, c), 6000);
  } finally { syncing = false; b.done(); }
}

// ---- a tracker's home page: its media entities (ShotGrid: Versions) -----------------------------------------------
// A filter (project · entity type · entity · status · name, and Filter: the filter builder's conditions on the media
// entity's fields — core/filter-core.js, the same as Sight's Filter ▾, the fields and the tracker's filter form from the
// adapter) over the project's media entities, newest first, as a grid of thumbnails. Thumbnails are cached in Cache
// Storage by record id + its "changed" stamp (a newer record replaces it), so the grid draws again without downloading.
// A tap opens the record: its review on this device if there is one with the media kept, else its playable media (the
// adapter's mediaSource) is downloaded and opened as a review linked to it.
// ctx: {el, btn, toast, busy, sheet, reviews(): [meta], openReview(key), openFile(file, {key, link})}; t: the tracker
const PAGE = 60;
function loadJson(k, ok){ try { const v = JSON.parse(localStorage.getItem(k) || "null"); return ok(v) ? v : null; } catch { return null; } }
function saveJson(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

// One thumbnail: from the cache, else downloaded (at most 4 at a time, every tracker together) and put there.
const thumbQ = [];
let thumbRun = 0;
// alive(): the grid still on screen (a browser re-made or closed drops its waiting thumbnails)
// kind: "img" (the thumbnail) or "strip" (the filmstrip of a video, frames side by side)
function thumbUrl(src, v, alive, kind = "img"){
  return new Promise((ok) => { thumbQ.push({ src, v, ok, alive, kind }); pumpThumbs(); });
}
// One cache entry per record (its stamp in a header: a changed record replaces it in place); each kind's cache is
// trimmed to the newest MAX_THUMBS entries when its page opens.
const MAX_THUMBS = 3000;
async function trimThumbs(name){
  try {
    if (!globalThis.caches) return;
    const cache = await caches.open(name), keys = await cache.keys();
    for (let i = 0; i < keys.length - MAX_THUMBS; i++) await cache.delete(keys[i]);  // (oldest first: insertion order)
  } catch {}
}
async function pumpThumbs(){
  while (thumbRun < 4 && thumbQ.length){
    const { src, v, ok, alive, kind } = thumbQ.shift();
    if (alive && !alive()){ ok(null); continue; }
    thumbRun++;
    (async () => {
      const { A, cl, host, cacheName, prefix } = src;
      const key = `${prefix}${encodeURIComponent(host)}/${A.recordId(v)}${kind === "strip" ? "/strip" : ""}`, upd = String(A.recordStamp(v) || "");
      const url = A.pictureUrl(v, kind === "strip" ? "filmstrip" : "image");
      try {
        const cache = globalThis.caches ? await caches.open(cacheName) : null;
        let hit = cache ? await cache.match(key) : null;
        if (hit && hit.headers.get("X-Updated") !== upd) hit = null;
        if (!hit){
          if (!url) return ok(null);
          const blob = await A.download(cl, url);
          hit = new Response(blob, { headers: { "Content-Type": blob.type || "image/jpeg", "X-Updated": upd } });
          if (cache){ await cache.delete(key); await cache.put(key, hit.clone()); }  // (re-put: the newest at the end)
        }
        ok(URL.createObjectURL(await hit.blob()));
      } catch { ok(null); }
    })().finally(() => { thumbRun--; pumpThumbs(); });
  }
}

export function trackerBrowser(ctx, box, t){
  const { el, btn, toast } = ctx;
  box.textContent = "";
  const A = adapterOf(t.kind), c = trackerConfig(t.key);
  if (!A || !ready(A, c)){
    const e = el("div", "sgb-empty");
    e.appendChild(el("p", "", `Connect ${t.name} to browse your projects here, open one and review it — the notes sync back.`));
    e.appendChild(btn("btn primary", `Connect ${t.name}…`, () => trackerSettings(t.kind, ctx, t.key)));
    box.appendChild(e);
    return { refresh(){}, dispose(){} };
  }
  const one = A.media.one, many = A.media.many, statusField = A.statusField;
  // (quick filters and tile fields per site — "<name>@<host>", read falling back to the per-kind name; the conditions
  // are kept per "<host> <project>" in one per-kind map already)
  const FILTER_KEY = TRK().storeName(A, "filter", "phone", t.host), FIELDS_KEY = TRK().storeName(A, "fields", "phone", t.host), WHERE_KEY = A.storeKey("where", "phone");
  const loadSite = (name, ok) => { try { const v = JSON.parse(TRK().readStored((k) => localStorage.getItem(k), A, name, "phone", t.host) || "null"); return ok(v) ? v : null; } catch { return null; } };
  const cl = clientOf(A, c), host = A.siteHost(c.site), urls = [];
  const thumbSrc = { A, cl, host, cacheName: A.storeKey("thumbs", "phone"), prefix: A.storeKey("thumb", "phone") };
  const hint = (e) => hintOf(A, e, c);
  const f = loadSite("filter", (x) => x && typeof x === "object") || {};
  const saveFilter = () => saveJson(FILTER_KEY, f);
  let fields = loadSite("fields", Array.isArray) || A.defaultTileFields.slice();
  // The filter builder's conditions, one tree per project ("<site host> <project id>" → tree), the newest 100 kept.
  const loadWheres = () => loadJson(WHERE_KEY, (w) => w && typeof w === "object" && !Array.isArray(w)) || {};
  const loadWhere = (k) => SF().sanitize(loadWheres()[k]);
  const saveWhere = (k, tree) => {
    const all = loadWheres();
    delete all[k];   // (re-added last: the newest at the end)
    if (tree.c.length) all[k] = tree;
    const keys = Object.keys(all);
    keys.slice(0, Math.max(0, keys.length - 100)).forEach((x) => { delete all[x]; });
    saveJson(WHERE_KEY, all);
  };
  let gone = false, opening = false, loading = false;
  trimThumbs(thumbSrc.cacheName);
  const bar = el("div", "sgb-filter");
  const proj = el("select", "sgb-proj"); proj.setAttribute("aria-label", "Project");
  const types = el("div", "seg sgb-types");
  const ent = el("select", "sgb-ent"); ent.setAttribute("aria-label", "Entity");
  const stat = el("select", "sgb-stat"); stat.setAttribute("aria-label", "Status");
  const q = el("input", "sgb-q"); q.type = "search"; q.placeholder = one + " name contains…"; q.spellcheck = false; q.value = f.q || "";
  bar.appendChild(proj); bar.appendChild(types); bar.appendChild(ent);
  const fbtn = btn("btn sgb-fields", "Fields", () => pickFields(), "Which fields the tiles show");
  const wbtn = btn("btn sgb-where", "Filter", () => openWhere(), `Conditions on the ${one} fields`);
  const row = el("div", "sgb-row"); row.appendChild(stat); row.appendChild(q); bar.appendChild(row);
  const row2 = el("div", "sgb-row sgb-acts"); row2.appendChild(wbtn); row2.appendChild(fbtn); bar.appendChild(row2);
  box.appendChild(bar);
  const grid = el("div", "sgb-grid"), more = btn("btn sgb-more", "More", () => { if (!loading) load(true); });
  more.hidden = true;
  const msg = el("p", "sgb-msg");
  box.appendChild(msg); box.appendChild(grid); box.appendChild(more);

  (A.entityTypes || [["", "All"]]).forEach(([ty, label]) => { const b = btn("", label, () => { f.type = ty; f.entity = ""; saveFilter(); paintTypes(); loadEntities().then(() => load()); }); b.dataset.t = ty; types.appendChild(b); });
  const paintTypes = () => types.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.t === (f.type || "")));
  paintTypes();
  const fillSel = (sel, items, cur, any) => {
    sel.innerHTML = `<option value="">${escHtml(any)}</option>` + items.map(([v, x]) => `<option value="${escHtml(v)}">${escHtml(x)}</option>`).join("");
    sel.value = items.some(([v]) => String(v) === String(cur)) ? String(cur) : "";
  };
  async function loadEntities(){
    ent.hidden = !f.type || !f.project;
    if (ent.hidden) return;
    fillSel(ent, [], "", "Loading…");
    try {
      const list = await A.entities(cl, f.project, f.type);
      fillSel(ent, list.map((x) => [x.id, x.name]), f.entity, "Every " + f.type.toLowerCase());
    } catch (e){ fillSel(ent, [], "", errText(e)); }
  }
  const statuses = new Set(f.status ? [f.status] : []);
  const paintStat = () => fillSel(stat, [...statuses].sort().map((s) => [s, s]), f.status || "", "Any status");
  paintStat();
  // ---- Filter: the filter builder's conditions on the media entity's fields (per project, kept on the device), sent
  // with every page in the tracker's own filter form (the adapter's toConditions), ANDed with the quick filters above
  let fieldsAll = null, fieldsP = null;
  const loadFields = () => fieldsAll ? Promise.resolve(fieldsAll)
    : (fieldsP = fieldsP || A.mediaFields(cl).then((x) => { fieldsAll = x; return x; }).finally(() => { fieldsP = null; }));
  const whereKey = () => host + " " + (f.project || "");
  let where = loadWhere(whereKey());
  // (a status field with no listed choices offers the statuses seen and the ones the conditions name)
  const whereFields = () => fieldsAll ? A.filterFields(fieldsAll, { seen: { [statusField]: statuses }, tree: where }) : null;
  const paintWhere = () => {
    const wf = whereFields(), n = wf ? SF().count(where, wf) : (where.c.length ? 1 : 0);
    wbtn.textContent = n ? "Filter · " + n : "Filter";
    wbtn.classList.toggle("on", !!n);
  };
  paintWhere();
  async function openWhere(){
    if (!f.project){ toast("Pick a project first", 2500); return; }
    const b = ctx.busy("Reading the fields…");
    let err = null;
    try { await loadFields(); }
    catch (e){ err = e; }
    finally { b.done(); }
    if (gone) return;
    const key = whereKey();
    if (err){
      if (!where.c.length){ toast(errText(err) + hint(err), 5000); return; }
      // conditions kept but no fields to show them with: they can still be cleared
      ctx.sheet((sh, close) => {
        sh.appendChild(el("h2", "", "Filter"));
        sh.appendChild(el("p", "", `Could not read the ${one} fields, so the conditions cannot be shown or applied: ` + errText(err) + hint(err)));
        const a = el("div", "acts");
        a.appendChild(btn("btn danger", "Clear the filter", () => {
          close();
          if (gone || key !== whereKey()) return;
          where = SF().empty(); saveWhere(key, where); paintWhere(); load();
        }));
        a.appendChild(btn("btn primary", "Close", close));
        sh.appendChild(a);
      });
      return;
    }
    ctx.sheet((sh, close) => {
      sh.classList.add("flt-sheet");
      sh.appendChild(el("h2", "", "Filter"));
      sh.appendChild(el("p", "", (proj.selectedOptions[0] ? proj.selectedOptions[0].textContent + ": " : "") + `${many} matching these conditions (and the filters above).`));
      const fh = el("div", "flt");
      sh.appendChild(fh);
      // (an edit that leaves the conditions in effect as they were — a new empty row, All / Any over one row — only
      // saves; each tree cleaned with its own fields: a status field without schema choices offers the values its tree
      // names, so the new tree's fields can differ from the old one's)
      const effective = () => JSON.stringify(SF().clean(where, whereFields() || []));
      const builder = SF().mountBuilder(fh, { fields: whereFields(), tree: where, onChange: (tr) => {
        if (gone || key !== whereKey()) return;   // (a value typed just before the page went / the project changed)
        const was = effective();
        where = SF().sanitize(tr);
        saveWhere(key, where); paintWhere();
        if (effective() !== was) load();
      } });
      const a = el("div", "acts");
      a.appendChild(btn("btn primary", "Done", () => { builder.flush(); close(); }));
      sh.appendChild(a);
    });
  }
  let page = 0, seq = 0, gridGen = 0, unfiltered = "";  // unfiltered: the warning while the grid holds pages loaded without the conditions
  async function load(append){
    if (!f.project){ ++seq; loading = false; grid.textContent = ""; msg.textContent = "Pick a project."; more.hidden = true; return; }  // (a load in flight lands nowhere)
    const my = ++seq;
    loading = true;
    if (!append){ gridGen++; page = 0; grid.textContent = ""; urls.splice(0).forEach((u) => URL.revokeObjectURL(u)); }
    msg.textContent = "Loading…";
    try {
      // (a condition needs its field's type; the schema not readable: the page loads without the conditions, says so,
      // and Filter offers to clear them)
      let cond = null, warn = "";
      if (!append) unfiltered = "";
      if (append && unfiltered) warn = unfiltered;  // (More keeps appending the same unfiltered set, not a filtered page 2)
      else if (where.c.length){
        try {
          if (!fieldsAll){ await loadFields(); if (my !== seq) return; paintWhere(); }
          cond = A.toConditions(where, whereFields());
        } catch (e){ if (my !== seq) return; warn = `Filter not applied — could not read the ${one} fields: ` + errText(e) + hint(e); }
      }
      const vs = await A.browse(cl, f, fields, page + 1, PAGE, cond);
      if (my !== seq) return;
      if (!append) unfiltered = warn;
      page++;
      vs.forEach((v) => { const s = v[statusField]; if (s && !statuses.has(s)){ statuses.add(s); paintStat(); } grid.appendChild(tile(v)); });
      msg.textContent = [warn, grid.childNodes.length ? "" : `No ${one} matches.`].filter(Boolean).join(" · ");
      more.hidden = vs.length < PAGE;
    } catch (e){ if (my === seq){ msg.textContent = errText(e) + hint(e); more.hidden = true; } }
    finally { if (my === seq) loading = false; }
  }
  // ---- Fields: which fields the tiles show (read from the tracker's schema), kept on the device
  function paintCap(tl, cap){
    cap = cap || tl.querySelector(".cap");
    cap.textContent = "";
    fields.forEach((k, i) => { const x = A.fmtField(tl._v, k); if (x) cap.appendChild(el(i ? "small" : "b", "", x)); });
    if (!cap.childNodes.length) cap.appendChild(el("b", "", A.recordName(tl._v)));
  }
  async function pickFields(){
    const b = ctx.busy("Reading the fields…");
    try { await loadFields(); }
    catch (e){ toast(errText(e) + hint(e), 5000); return; }
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
      a.appendChild(btn("btn", "Default", () => { fields = A.defaultTileFields.slice(); saveFields(); close(); }));
      a.appendChild(btn("btn primary", "Done", close));
      sh.appendChild(a);
    });
  }
  function saveFields(){
    saveJson(FIELDS_KEY, fields);
    const have = grid.querySelector(".sgb-tile");
    if (have && fields.some((k) => !(k in have._v))) load();   // a field the loaded records lack: load again
    else grid.querySelectorAll(".sgb-tile").forEach((x) => paintCap(x));
  }
  function linkedReview(v){
    const id = String(A.recordId(v));
    return ctx.reviews().find((m) => { const e = reviewLink(m, t.key); return !!e && String(A.linkId(e.link)) === id; });
  }
  function tile(v){
    const tl = btn("sgb-tile", "", () => open(v)), gen = gridGen;  // (a new grid drops this tile's waiting thumbnail; "More" keeps it)
    tl.dataset.ver = String(A.recordId(v));
    const th = el("div", "th"), cap = el("div", "cap"), strip = el("div", "strip");
    tl._v = v;
    paintCap(tl, cap);
    if (linkedReview(v)) tl.classList.add("has");
    th.appendChild(strip);
    tl.appendChild(th); tl.appendChild(cap);
    const alive = () => !gone && gen === gridGen;
    thumbUrl(thumbSrc, v, alive).then((u) => { if (!u) return; if (gone){ URL.revokeObjectURL(u); return; } urls.push(u); const im = el("img"); im.alt = ""; im.src = u; th.insertBefore(im, strip); });
    // Filmstrip (a video's frames side by side): a finger dragged sideways over the picture (or a mouse over it)
    // shows the frame under it; a drag does not open the record, a tap does.
    let frames = 0, asked = false, down = null;
    const want = () => {
      if (asked || !A.hasFilmstrip(v)) return;
      asked = true;
      thumbUrl(thumbSrc, v, alive, "strip").then((u) => {
        if (!u) return; if (gone){ URL.revokeObjectURL(u); return; }
        urls.push(u);
        const im = new Image();
        im.onload = () => { frames = A.filmstripFrames(im.naturalWidth); if (frames > 1) strip.style.backgroundImage = `url("${u}")`; };
        im.src = u;
      });
    };
    const scrub = (x) => {
      if (frames < 2) return;
      const r = th.getBoundingClientRect(), c2 = A.filmstripCss(frames, (x - r.left) / Math.max(1, r.width));
      strip.style.backgroundSize = c2.size; strip.style.backgroundPosition = c2.pos; tl.classList.add("scrub");
    };
    th.addEventListener("pointerdown", (e) => { want(); down = { x: e.clientX, moved: false, touch: e.pointerType !== "mouse" }; });
    th.addEventListener("pointermove", (e) => {
      if (e.pointerType === "mouse"){ want(); scrub(e.clientX); return; }
      if (down && Math.abs(e.clientX - down.x) > 8){ down.moved = true; scrub(e.clientX); }
    });
    const end = () => { if (down && down.moved) tl._dragged = performance.now(); down = null; tl.classList.remove("scrub"); };
    th.addEventListener("pointerup", end); th.addEventListener("pointercancel", end);
    th.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") tl.classList.remove("scrub"); });
    return tl;
  }
  async function open(v){
    if (v && grid.querySelector(`.sgb-tile[data-ver="${CSS.escape(String(A.recordId(v)))}"]`)?._dragged > performance.now() - 400) return;  // the end of a filmstrip drag
    if (opening) return;  // (a double tap: one download)
    opening = true;
    try { await open1(v); } finally { opening = false; }
  }
  async function open1(v){
    const m = linkedReview(v);
    if (m && m.kept){ await ctx.openReview(m.key); return; }
    // a linked review of a still takes the record's picture when its upload is a movie (an uploaded still is kept)
    const src = A.mediaSource(v, { still: !!(m && m.asset && m.asset.kind === "image") });
    const name0 = A.recordName(v);
    if (!src){ toast(`This ${one} has no media to play on the phone`, 4000); return; }
    const b = ctx.busy("Downloading " + (name0 || "the " + one) + "…");
    try {
      const blob = await A.download(cl, src.url);
      let name = src.name;
      if (!/\.[a-z0-9]{2,5}$/i.test(name)) name += /video/.test(blob.type || src.type) ? ".mp4" : ".jpg";
      const file = new File([blob], name, { type: blob.type || src.type });
      b.done();
      // the review this record already has (its media not on the device): that one, not a second empty one
      if (m) await ctx.openReview(m.key, file);
      else await ctx.openFile(file, { key: t.key, link: A.linkOf(host, v) });
    } catch (e){ b.done(); toast(`Could not download the ${one}: ` + errText(e) + hint(e), 6000); }
  }

  proj.onchange = () => { f.project = proj.value; f.entity = ""; saveFilter(); where = loadWhere(whereKey()); paintWhere(); loadEntities().then(() => load()); };
  ent.onchange = () => { f.entity = ent.value; saveFilter(); load(); };
  stat.onchange = () => { f.status = stat.value; saveFilter(); load(); };
  let qt = 0;
  q.addEventListener("input", () => { clearTimeout(qt); qt = setTimeout(() => { f.q = q.value.trim(); saveFilter(); load(); }, 450); });
  (async () => {
    fillSel(proj, [], "", "Loading projects…");
    try {
      const ps = await A.projects(cl);
      fillSel(proj, ps.map((p) => [p.id, p.name || "#" + p.id]), f.project, "Project…");
      if (!proj.value){ f.project = ""; where = loadWhere(whereKey()); paintWhere(); }
      await loadEntities();
      await load();
    } catch (e){ fillSel(proj, [], "", "No projects"); msg.textContent = errText(e) + hint(e); }
  })();
  return { refresh(){ load(); }, dispose(){ gone = true; seq++; urls.splice(0).forEach((u) => URL.revokeObjectURL(u)); } };
}

// The user sheet (the home screen's person button): the reviewer name and a row per connected tracker (none
// connected: no tracker part at all — Settings → Trackers is where one is connected).
// ui: {sheet, el, btn, toast, who(): name, setName(): Promise<bool>}
export function userSheet(ui){
  const { sheet, el, btn } = ui;
  const list = trackers();
  sheet((sh, close) => {
    sh.appendChild(el("h2", "", "You"));
    const kv = el("div", "kv");
    kv.appendChild(el("b", "", "Reviewer name"));
    const nm = kv.appendChild(btn("tapedit", ui.who() || "—", async () => { if (await ui.setName()) nm.textContent = ui.who(); }));
    nm.title = "Tap to change your name";
    list.forEach((t) => {
      kv.appendChild(el("b", "", trackerLabel(t, list)));
      kv.appendChild(el("span", "", "connected · " + t.host + (t.note ? " · " + t.note : "")));
    });
    sh.appendChild(kv);
    if (list.length){
      const a = el("div", "acts");
      list.forEach((t) => a.appendChild(btn("btn", trackerLabel(t, list) + " connection…", () => { close(); trackerSettings(t.kind, ui, t.key); })));
      sh.appendChild(a);
    }
  });
}
