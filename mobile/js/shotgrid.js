// ShotGrid on the phone (docs/SHOTGRID.md): the connection (Settings → ShotGrid), linking the open review to a
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
function saveConfig(c){ try { localStorage.setItem(KEY, JSON.stringify(c)); } catch {} }
export const sgReady = (c = sgConfig()) => !!(c.site && c.script && c.key);
function client(c = sgConfig()){
  return SG().createClient({ site: c.site, script: c.script, key: c.key, via: c.proxy ? proxyPrefix(c.proxy) : "" });
}
// "https://sg-proxy.example.workers.dev" -> "https://sg-proxy.example.workers.dev/?url=" (a prefix ending in = is kept)
function proxyPrefix(p){ p = String(p).trim(); return /[=]$/.test(p) ? p : p.replace(/\/?$/, "/") + "?url="; }
const errText = (e) => (e && e.message) || String(e);
const corsHint = (e, c) => (!c.proxy && e instanceof TypeError) ? " — the site may not answer this app directly: set a proxy in Settings → ShotGrid" : "";

// ---- Settings → ShotGrid --------------------------------------------------------------------------
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
    a.appendChild(btn("btn", "Forget", () => { saveConfig({}); toast("ShotGrid connection removed"); close(); }));
    a.appendChild(btn("btn", "Test", async () => {
      const n = read();
      if (!sgReady(n)){ msg.textContent = "Site, script name and key are needed."; return; }
      msg.textContent = "Connecting…";
      try { const ps = await client(n).projects(); msg.textContent = `Connected — ${ps.length} project${ps.length === 1 ? "" : "s"}.`; }
      catch (e){ msg.textContent = errText(e) + corsHint(e, n); }
    }));
    const s = el("button", "btn primary", "Save"); s.type = "submit"; a.appendChild(s);
    f.appendChild(a);
    f.onsubmit = (e) => { e.preventDefault(); saveConfig(read()); toast("ShotGrid saved"); close(); };
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
