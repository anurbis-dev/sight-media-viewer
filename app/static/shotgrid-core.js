// ShotGrid core — the ShotGrid (Autodesk Flow Production Tracking) link shared by Sight and the phone app:
// a REST API client (script-key auth, search / create / update / delete, attachment upload / download) and the
// two-way sync of one review (a Sight asset / a phone review) with one ShotGrid Version. docs/SHOTGRID.md
// describes the mapping; the review rows are docs/FORMAT.md (`data.sg` on notes, `sg` on replies).
//
// Plain script, no build step, no imports: one global `SightShotGrid` (also `module.exports` under Node, for
// tests/sg_unit.cjs). Sight: `import "/static/shotgrid-core.js"`; the phone app: <script src="core/shotgrid-core.js">.
//
// Transport: every request can go through a pass-through proxy, `via + encodeURIComponent(targetUrl)` — Sight's
// own server (`/api/sg/fetch?url=`, no CORS for a desktop app) or, for the phone, a tiny worker
// (tools/sg-proxy-worker.js) when the studio's site does not answer browser requests from another origin.
// Both forward the method, the body and the Authorization / Content-Type / Accept headers, nothing else.

var SightShotGrid = (function(){
  "use strict";

  var API = "/api/v1.1";
  var ARRAY_JSON = "application/vnd+shotgun.api3_array+json";
  var OUR_PREFIX = "sight-";            // attachments Sight / the phone uploaded: never pulled back as pictures
  var DEFAULT_STATUS = { open: "opn", progress: "ip", done: "clsd" };

  // ---- small helpers -----------------------------------------------------------------------------
  function siteUrl(s){
    s = String(s || "").trim().replace(/\/+$/, "");
    if (!s) return "";
    if (!/^https?:\/\//i.test(s)) s = "https://" + s;
    return s.replace(/\/api(\/v[\d.]+)?$/i, "");
  }
  function siteHost(s){ try { return new URL(siteUrl(s)).host.toLowerCase(); } catch (e){ return ""; } }
  // A stable 16-hex id from a string (FORMAT.md id shape): rows / replies / shots made from ShotGrid records
  // get the same id on every client and every pull (two FNV-1a 32-bit hashes with different seeds).
  function idFor(str){
    var s = String(str), h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
    for (var i = 0; i < s.length; i++){
      var c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ c, 0x01000193 + 0x2f) >>> 0;
      h2 = (h2 ^ (h2 >>> 13)) >>> 0;
    }
    return ("0000000" + h1.toString(16)).slice(-8) + ("0000000" + h2.toString(16)).slice(-8);
  }
  function hashOf(v){ return idFor(JSON.stringify(v === undefined ? null : v)); }
  function stampOf(iso){ var t = Date.parse(iso || ""); return isFinite(t) ? t : 0; }
  function clone(v){ return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function flat(rec){
    // REST records: {type, id, attributes: {...}, relationships: {f: {data}}} -> {type, id, ...fields}
    if (!rec || typeof rec !== "object") return rec;
    var out = { type: rec.type, id: rec.id };
    var a = rec.attributes || {}, r = rec.relationships || {};
    Object.keys(a).forEach(function(k){ out[k] = a[k]; });
    Object.keys(r).forEach(function(k){ out[k] = r[k] && r[k].data !== undefined ? r[k].data : r[k]; });
    return out;
  }
  function statusMap(m){
    var o = Object.assign({}, DEFAULT_STATUS);
    Object.keys(m || {}).forEach(function(k){ if (m[k]) o[k] = String(m[k]).trim(); });
    return o;
  }
  function statusTo(m, ours){ m = statusMap(m); return m[ours === "done" || ours === "progress" ? ours : "open"]; }
  function statusFrom(m, code){
    m = statusMap(m);
    if (code == null || code === "") return null;
    if (code === m.done) return "done";
    if (code === m.progress) return "progress";
    if (code === m.open) return "open";
    return null;  // a studio status we have no state for: the note keeps its own
  }
  function err(msg, status, body){ var e = new Error(msg); e.status = status || 0; e.body = body; return e; }
  function errText(j, status){
    var e = j && j.errors && j.errors[0];
    if (e) return (e.title || "") + (e.detail ? (e.title ? ": " : "") + (typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail)) : "");
    if (j && (j.error_description || j.error)) return j.error_description || j.error;
    return "ShotGrid answered " + status;
  }

  // ---- the client --------------------------------------------------------------------------------
  // opts: { site, script, key, via: "" | proxy prefix, fetch: fetch-like (default globalThis.fetch),
  //         serverAuth: true = the proxy holds the key and adds the token itself (Sight: the page never sees the key;
  //         the sudo login goes as &sudo=), headers: extra headers for every request (Sight's X-Sight) }
  function createClient(opts){
    var site = siteUrl(opts.site), via = opts.via || "", fx = opts.fetch || globalThis.fetch.bind(globalThis);
    var serverAuth = !!opts.serverAuth, extra = opts.headers || {};
    if (!site) throw err("No ShotGrid site set");
    if (serverAuth && !via) throw err("serverAuth needs a proxy");
    if (!serverAuth && (!opts.script || !opts.key)) throw err("No ShotGrid script name / key set");
    var tokens = {};  // sudo login ("" = the script itself) -> {access, refresh, until}

    function url(u, sudo){ return via ? via + encodeURIComponent(u) + (serverAuth && sudo ? "&sudo=" + encodeURIComponent(sudo) : "") : u; }
    function hdr(h){ Object.keys(extra).forEach(function(k){ h[k] = extra[k]; }); return h; }
    async function authHeader(h, sudo){ if (!serverAuth) h.Authorization = "Bearer " + await token(sudo); return h; }
    function full(path){ return /^https?:\/\//i.test(path) ? path : site + (path.indexOf("/api/") === 0 ? path : API + path); }

    async function token(sudo){
      var k = sudo || "", t = tokens[k];
      if (t && t.until > Date.now() + 30000) return t.access;
      var form = new URLSearchParams();
      if (t && t.refresh){ form.set("grant_type", "refresh_token"); form.set("refresh_token", t.refresh); }
      else {
        form.set("grant_type", "client_credentials"); form.set("client_id", opts.script); form.set("client_secret", opts.key);
        if (k) form.set("sudo_as_login", k);
      }
      var r = await fx(url(site + API + "/auth/access_token"), {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: form.toString(),
      });
      var j = null; try { j = await r.json(); } catch (e){}
      if (!r.ok || !j || !j.access_token){
        if (t && t.refresh){ delete tokens[k]; return token(sudo); }  // refresh refused: log in again
        throw err(r.status === 400 || r.status === 401 ? "ShotGrid refused the script name / key" + (k ? " (or acting as " + k + ")" : "") + " — " + errText(j, r.status) : errText(j, r.status), r.status, j);
      }
      tokens[k] = { access: j.access_token, refresh: j.refresh_token || "", until: Date.now() + 1000 * (Number(j.expires_in) || 600) };
      return j.access_token;
    }

    // One API call; json body (array filters need ARRAY_JSON). Returns the parsed answer (null for 204).
    async function api(method, path, body, o){
      o = o || {};
      var h = hdr(await authHeader({ Accept: "application/json" }, o.sudo));
      if (body !== undefined) h["Content-Type"] = o.contentType || "application/json";
      var r = await fx(url(full(path), o.sudo), { method: method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
      if (r.status === 401 && !o.retried && !serverAuth){ delete tokens[o.sudo || ""]; return api(method, path, body, Object.assign({}, o, { retried: true })); }
      if (r.status === 204) return null;
      var j = null, txt = "";
      try { txt = await r.text(); j = txt ? JSON.parse(txt) : null; } catch (e){}
      if (!r.ok) throw err(errText(j, r.status), r.status, j || txt);
      return j;
    }
    function plural(type){
      var t = String(type);
      var map = { Version: "versions", Note: "notes", Reply: "replies", Attachment: "attachments", Project: "projects", HumanUser: "human_users", Task: "tasks", Shot: "shots", Asset: "assets" };
      return map[t] || (t.toLowerCase() + "s");
    }
    // Every page of a search (up to `limit` records), flattened.
    async function search(type, filters, fields, o){
      o = o || {};
      var out = [], size = Math.min(500, o.limit || 500);
      for (var n = 1; n < 100; n++){
        var j = await api("POST", "/entity/" + plural(type) + "/_search",
          { filters: filters || [], fields: fields || [], sort: o.sort, page: { size: size, number: n } },
          { contentType: ARRAY_JSON, sudo: o.sudo });
        var d = (j && j.data) || [];
        d.forEach(function(x){ out.push(flat(x)); });
        if (d.length < size || (o.limit && out.length >= o.limit) || !(j.links && j.links.next)) break;
      }
      return o.limit ? out.slice(0, o.limit) : out;
    }
    async function get(type, id, fields){
      var j = await api("GET", "/entity/" + plural(type) + "/" + id + (fields ? "?fields=" + encodeURIComponent(fields.join(",")) : ""));
      return flat(j && j.data);
    }
    async function create(type, data, o){
      var j = await api("POST", "/entity/" + plural(type) + (o && o.fields ? "?options[fields]=" + encodeURIComponent(o.fields.join(",")) : ""), data, o);
      return flat(j && j.data);
    }
    async function update(type, id, data, o){
      var j = await api("PUT", "/entity/" + plural(type) + "/" + id + (o && o.fields ? "?options[fields]=" + encodeURIComponent(o.fields.join(",")) : ""), data, o);
      return flat(j && j.data);
    }
    function remove(type, id, o){ return api("DELETE", "/entity/" + plural(type) + "/" + id, undefined, o); }

    // Attach a file to a record (a Note's attachments): ask for an upload link, PUT the bytes there (a signed
    // storage URL needs no token; the site's own storage does), then complete the upload.
    async function upload(type, id, blob, filename, o){
      o = o || {};
      var path = "/entity/" + plural(type) + "/" + id + (o.field ? "/" + o.field : "") + "/_upload";
      var info = await api("GET", path + "?filename=" + encodeURIComponent(filename), undefined, o);
      var link = info && info.links && info.links.upload;
      if (!link) throw err("ShotGrid gave no upload link");
      var up = full(link), h = hdr({ "Content-Type": blob.type || "application/octet-stream" });
      if (up.indexOf(site + "/") === 0) await authHeader(h, o.sudo);
      var r = await fx(url(up, o.sudo), { method: "PUT", headers: h, body: blob });
      if (!r.ok) throw err("Upload of " + filename + " failed (" + r.status + ")", r.status);
      var done = await api("POST", (info.links.complete_upload || path), { upload_info: info.data, upload_data: { display_name: filename } }, o);
      return done && done.data ? flat(done.data) : done;
    }
    async function download(u){
      var full1 = full(u), h = hdr({});
      if (full1.indexOf(site + "/") === 0) await authHeader(h);
      var r = await fx(url(full1), { headers: h });
      if (!r.ok) throw err("Download failed (" + r.status + ")", r.status);
      return r.blob();
    }

    return {
      site: site, host: siteHost(site), api: api, search: search, get: get, create: create, update: update, remove: remove,
      upload: upload, download: download, token: token,
      projects: function(){ return search("Project", [["archived", "is", false]], ["name"], { sort: "name" }); },
      versions: function(projectId, text){
        var f = [["project", "is", { type: "Project", id: Number(projectId) }]];
        if (text) f.push(["code", "contains", text]);
        return search("Version", f, ["code", "entity", "sg_task", "sg_status_list", "created_at", "sg_first_frame", "frame_range"], { sort: "-created_at", limit: 50 });
      },
    };
  }

  // A link = {site: host, project: {id, name}, version: {id, code}, task: {id}|null, firstFrame} — what a review is tied to.
  var VERSION_FIELDS = ["code", "project", "entity", "sg_task", "sg_first_frame", "frame_range", "sg_status_list"];
  async function loadVersion(client, id){
    var v = await client.get("Version", id, VERSION_FIELDS);
    if (!v || !v.id) throw err("Version " + id + " not found on ShotGrid");
    return linkOf(client.host, v);
  }
  // The link of a Version record already read (its VERSION_FIELDS at least): what a review is tied to.
  function linkOf(host, v){
    var first = Number(v.sg_first_frame);
    if (!isFinite(first)){ var m = /^\s*(-?\d+)/.exec(v.frame_range || ""); first = m ? Number(m[1]) : null; }
    return {
      site: host, project: v.project ? { id: v.project.id, name: v.project.name || "" } : null,
      version: { id: v.id, code: v.code || "" }, task: v.sg_task ? { id: v.sg_task.id } : null,
      entity: v.entity ? { type: v.entity.type, id: v.entity.id } : null, firstFrame: first,
    };
  }
  // The version a review is already tied to by its notes (a note pushed / pulled by another client carries data.sg.v).
  function linkedVersionOf(rows, host){
    for (var i = 0; i < (rows || []).length; i++){
      var r = rows[i], sg = r && r.kind === "note" && r.data && r.data.sg;
      if (sg && sg.v && (!host || sg.site === host)) return Number(sg.v);
    }
    return null;
  }

  // ---- sync ---------------------------------------------------------------------------------------
  var live = function(rows){ return (rows || []).filter(function(r){ return r && r.deleted_at == null; }); };
  // What a note's pictures depend on: its place, its own drawings (id + last change) and attached pictures / texts.
  function picSig(rows, note, skip){
    var d = note.data || {};
    var mine = live(rows).filter(function(r){ return r.kind !== "note" && r.kind !== "status" && r.data && r.data.note === note.id && !r.data.reply; })
      .map(function(r){ return [r.id, r.updated_at || r.created_at || 0]; }).sort();
    var own = (d.shots || []).filter(function(x){ return !(skip && skip.has(x)); });  // (pictures pulled from ShotGrid left out)
    return hashOf([d.ctx || null, mine, own, d.captions || null]);
  }
  // A reply sent without acting as its author reads "Author: text" on ShotGrid.
  function stripAuthor(t, author){ var p = author ? author + ": " : ""; return p && t.indexOf(p) === 0 ? t.slice(p.length) : t; }
  function frameOf(t, fps, first){ return Math.round((Number(t) || 0) * (fps || 24)) + (isFinite(first) && first != null ? first : 0); }
  function subjectOf(link, note, fps, author){
    var c = (note.data || {}).ctx || {}, where = "";
    if (c.t != null) where = " · frame " + frameOf(c.t, fps, link.firstFrame);
    return (author ? author + " — " : "") + (link.version.code || "Version") + where;
  }
  // A ShotGrid annotation picture's frame (the review tools name them like annot_version_<id>[...].<frame>.jpg).
  function annotFrame(name){
    var m = /^annot.*\.(\d+)\.(png|jpe?g)$/i.exec(name || "");
    return m ? Number(m[1]) : null;
  }
  function blobToDataUrl(blob){
    if (typeof FileReader !== "undefined"){
      return new Promise(function(ok, no){ var fr = new FileReader(); fr.onload = function(){ ok(fr.result); }; fr.onerror = function(){ no(fr.error); }; fr.readAsDataURL(blob); });
    }
    return blob.arrayBuffer().then(function(b){ return "data:" + (blob.type || "image/jpeg") + ";base64," + Buffer.from(b).toString("base64"); });
  }

  // Two-way sync of one review with one Version. The host gives:
  //   client, link (loadVersion), asset (FORMAT.md identity for the packages it imports), fps,
  //   state (what this client last saw / sent, kept by the host per review; {} the first time),
  //   statusMap {open, progress, done} -> studio codes, logins {reviewer name -> ShotGrid login}, sudo: bool,
  //   getRows(): rows (tombstones included), importPackage(pkg): merges a package (the host's own .srev import),
  //   pictures(noteIds): Map noteId -> [{blob, name}] (the note's frames / views with drawings burned in + its pictures),
  //   progress(text), now (ms, tests).
  // Pull first (ShotGrid notes / replies / pictures → rows, merged by the host's import), then push what changed
  // here, then one more import that only stamps the ShotGrid ids (data.sg / reply.sg) on the rows.
  // Returns {state, pulled: {added, updated}, pushed: {notes, updated, replies, pictures}, errors: [text]}.
  async function sync(o){
    var client = o.client, link = o.link, host = link.site, vid = link.version.id, fps = o.fps || 24;
    var st = clone(o.state) || {}; st.notes = st.notes || {}; st.replies = st.replies || {}; st.atts = st.atts || {};
    var prog = o.progress || function(){};
    var res = { pulled: { added: 0, updated: 0 }, pushed: { notes: 0, updated: 0, replies: 0, pictures: 0 }, skipped: 0, errors: [] };
    var smap = statusMap(o.statusMap);
    var now = o.now || Date.now();
    var mineSg = function(sg){ return sg && sg.site === host && Number(sg.v) === Number(vid); };
    var pkg = function(rows1, shots1){ return { format: "sight-review", version: 1, app: "ShotGrid sync", exported_at: now, author: "", asset: o.asset, annotations: rows1, shots: shots1 || {} }; };
    // pictures that came from ShotGrid (shot ids): never sent back, and not part of a note's own pictures (picSig)
    var pulled = function(){ var out = new Set(); Object.keys(st.atts).forEach(function(k){ if (st.atts[k]) out.add(st.atts[k]); }); return out; };
    var sigOf = function(rows1, n){ return picSig(rows1, n, pulled()); };
    var nameOf = function(att, ref){ return (att && att.this_file && att.this_file.name) || (att && att.filename) || (ref && ref.name) || ""; };

    // ---- read ShotGrid
    prog("Reading notes from ShotGrid…");
    var verRef = { type: "Version", id: vid };
    var sgNotes = await client.search("Note", [["note_links", "is", verRef]],
      ["subject", "content", "user", "created_at", "updated_at", "sg_status_list", "attachments"], { sort: "created_at" });
    var noteIds = sgNotes.map(function(n){ return n.id; });
    var sgReplies = noteIds.length ? await client.search("Reply", [["entity", "in", noteIds.map(function(id){ return { type: "Note", id: id }; })]],
      ["content", "user", "created_at", "updated_at", "entity"], { sort: "created_at" }) : [];
    var attIds = [];
    sgNotes.forEach(function(n){ (n.attachments || []).forEach(function(a){ if (a && a.id) attIds.push(a.id); }); });
    var sgAtt = attIds.length ? await client.search("Attachment", [["id", "in", attIds]], ["this_file", "filename", "created_at", "image"]) : [];
    var attById = new Map(sgAtt.map(function(a){ return [a.id, a]; }));
    var repliesOf = new Map();
    sgReplies.forEach(function(r){ var k = r.entity && r.entity.id; if (!repliesOf.has(k)) repliesOf.set(k, []); repliesOf.get(k).push(r); });

    // ---- pull
    var rows = await o.getRows();
    var rowById = new Map(rows.map(function(r){ return [r.id, r]; }));
    var bySg = new Map();  // ShotGrid note id -> local note row (tombstones too: a note deleted here is not re-created or re-sent)
    rows.forEach(function(r){
      if (!(r && r.kind === "note" && r.data && mineSg(r.data.sg))) return;
      var k = Number(r.data.sg.id), had = bySg.get(k);
      // two rows bound to one ShotGrid note (two clients synced before exchanging a .srev): the one written here wins
      if (!had || had.id === idFor(host + ":note:" + k)) bySg.set(k, r);
    });
    var pkgRows = [], shots = {};
    var userName = function(u){ return (u && (u.name || u.login)) || "ShotGrid"; };

    for (var i = 0; i < sgNotes.length; i++){
      var sn = sgNotes[i], upd = stampOf(sn.updated_at) || stampOf(sn.created_at);
      var loc = bySg.get(sn.id) || rowById.get(idFor(host + ":note:" + sn.id));
      if (!loc){
        // ours, sent by a sync whose ids never reached the rows (it broke off after the create): known by its pictures
        (sn.attachments || []).some(function(x){
          var m = new RegExp("^" + OUR_PREFIX + "([0-9a-f]{16})-").exec(nameOf(attById.get(x.id), x));
          var r = m && rowById.get(m[1]);
          if (r && r.kind === "note" && !(r.data && r.data.sg)){ loc = r; return true; }
          return false;
        });
      }
      var key = loc ? loc.id : idFor(host + ":note:" + sn.id), seen = Object.assign({}, st.notes[key] || {});
      var text = sn.content || "", txtH = hashOf(text), code = sn.sg_status_list, sgState = statusFrom(smap, code);
      // replies made on ShotGrid (or changed there since this client last saw them)
      var lrep = loc ? (loc.data.replies || []) : [], bySgReply = new Map();
      lrep.forEach(function(x){ if (x && x.sg) bySgReply.set(Number(x.sg), x); });
      var newReplies = [];
      (repliesOf.get(sn.id) || []).forEach(function(sr){
        var rid = idFor(host + ":reply:" + sr.id), have = bySgReply.get(sr.id) || lrep.find(function(x){ return x && x.id === rid; });
        var rupd = stampOf(sr.updated_at) || stampOf(sr.created_at), rseen = st.replies["sg" + sr.id] || {};
        if (!have) newReplies.push({ id: rid, text: sr.content || "", author: userName(sr.user), created: stampOf(sr.created_at) || now, sg: sr.id });
        else {
          var rt = stripAuthor(sr.content || "", have.author);
          if (!have.deleted && rt !== (have.text || "") && rupd > (rseen.at || 0)) newReplies.push(Object.assign({}, have, { text: rt, edited: rupd, sg: sr.id }));
        }
        st.replies["sg" + sr.id] = Object.assign({}, rseen, { at: Math.max(rupd, rseen.at || 0) });
      });
      // pictures added on ShotGrid (not ours, not pulled before — one removed here stays removed)
      var newShots = [], frame = null;
      for (var a = 0; a < (sn.attachments || []).length; a++){
        var att = attById.get(sn.attachments[a].id);
        if (!att || st.atts[att.id] !== undefined) continue;
        var fname = nameOf(att, sn.attachments[a]);
        if (fname.indexOf(OUR_PREFIX) === 0){ st.atts[att.id] = ""; continue; }
        var ct = (att.this_file && att.this_file.content_type) || "";
        if ((ct && ct.indexOf("image/") !== 0) || (!ct && !/\.(png|jpe?g|webp|gif)$/i.test(fname))){ st.atts[att.id] = ""; continue; }
        var sid = idFor(host + ":att:" + att.id);
        if (loc && (loc.data.shots || []).indexOf(sid) >= 0){ st.atts[att.id] = sid; continue; }
        var fu = att.this_file && att.this_file.url;
        if (!fu) continue;
        try {
          prog("Downloading " + fname + "…");
          shots[sid] = await blobToDataUrl(await client.download(fu));
          newShots.push(sid);
          st.atts[att.id] = sid;
          var fr = annotFrame(fname);
          if (fr != null && frame == null) frame = fr;
        } catch (e){ res.errors.push(fname + ": " + e.message); }
      }
      var ctx = null;
      if (frame != null) ctx = { t: Math.max(0, frame - (link.firstFrame != null && isFinite(link.firstFrame) ? link.firstFrame : 0)) / fps, hold: 0 };

      if (!loc){
        // a note written on ShotGrid: a new row with an id made from its ShotGrid id (the same on every client)
        var nr = {
          id: key, kind: "note", shape_kind: null, x: null, y: null, w: null, h: null, rotation: 0, z_index: 0, color: null, locked: 0,
          data: { text: text, author: userName(sn.user), created: stampOf(sn.created_at) || now, status: sgState || "open", status_at: upd,
            edited_at: upd, ctx: ctx, shots: newShots, replies: newReplies, sg: { site: host, id: sn.id, v: vid } },
          created_at: stampOf(sn.created_at) || now, updated_at: upd,
        };
        pkgRows.push(nr);
        res.pulled.added++;
        // pictures from here only once it is drawn on here
        seen = { sg: sn.id, txt: txtH, sgst: code, st: upd, pics: picSig([], nr, new Set(newShots)) };
      } else if (loc.deleted_at == null){
        var d = clone(loc.data), changed = false, ld = loc.data;
        // Text: changed on ShotGrid since this client last saw it (hash of the text, not stamps of two clocks). With a
        // baseline that shows the text here unchanged, ShotGrid's copy wins outright; edited here too, or no baseline
        // yet (first sync on this client, after a re-link), the content stamps decide (merge rule 3).
        var sgChanged = seen.txt !== undefined ? txtH !== seen.txt : text !== (ld.text || "");
        var localAt = ld.edited_at || ld.created || 0, takeText = false, forceText = false;
        if (sgChanged && text !== (ld.text || "")){
          forceText = seen.txt !== undefined && hashOf(ld.text || "") === seen.txt;
          takeText = forceText || upd > localAt;
          if (!newShots.length || takeText){ d.text = text; d.edited_at = forceText ? Math.max(upd, localAt + 1) : upd; changed = true; }
        }
        // new pictures from ShotGrid always land (their row wins by one ms); the text goes with it only when it won above
        if (newShots.length){
          d.shots = (d.shots || []).concat(newShots);
          if (!takeText) d.text = ld.text;
          d.edited_at = Math.max(d.edited_at || 0, upd, localAt + 1); changed = true;
        }
        // State: only a code we map, only when it changed on ShotGrid since last seen (a studio-only code is left alone);
        // forced only with a baseline that shows the state here unchanged, else the status stamps decide
        var codeChanged = seen.sgst !== undefined ? code !== seen.sgst : true;
        if (sgState && sgState !== (ld.status || "open") && codeChanged){
          var forceSt = seen.sgst !== undefined && seen.st !== undefined && (ld.status_at || 0) <= seen.st;
          d.status = sgState; d.status_at = forceSt ? Math.max(upd, (ld.status_at || 0) + 1) : upd; changed = true;
        }
        if (newReplies.length){ d.replies = newReplies; changed = true; }
        if (!d.sg){ d.sg = { site: host, id: sn.id, v: vid }; changed = true; }
        if (changed){
          if (!newShots.length && d.text === ld.text) d.edited_at = ld.edited_at;  // only replies / state / ids: content stamp unchanged
          pkgRows.push(Object.assign({}, loc, { data: d }));
          res.pulled.updated++;
        }
        seen.sg = sn.id; seen.txt = txtH; seen.sgst = code;
        if (seen.st === undefined || d.status !== ld.status) seen.st = d.status_at || 0;
      }
      seen.at = Math.max(upd, seen.at || 0);
      st.notes[key] = seen;
    }
    if (pkgRows.length){
      prog("Merging ShotGrid notes…");
      await o.importPackage(pkg(pkgRows, shots));
    }

    // ---- push
    rows = await o.getRows();
    var sgById = new Map(sgNotes.map(function(n){ return [n.id, n]; }));
    var sgReplyById = new Map(sgReplies.map(function(r){ return [r.id, r]; }));
    var notes = live(rows).filter(function(r){
      if (!(r.kind === "note" && r.data)) return false;
      if (r.data.sg && !mineSg(r.data.sg)){ res.skipped++; return false; }  // bound to another Version / site
      return true;
    }).sort(function(a, b){ return (a.data.created || 0) - (b.data.created || 0); });
    var oursOn = function(sgid, nid){  // pictures this note already has on ShotGrid from Sight / the phone
      var sn1 = sgById.get(sgid);
      return ((sn1 && sn1.attachments) || []).filter(function(x){ return nameOf(attById.get(x.id), x).indexOf(OUR_PREFIX + nid + "-") === 0; });
    };
    notes.forEach(function(n){
      var s0 = st.notes[n.id];
      if (!n.data.sg || (s0 && s0.pics != null)) return;
      // sent by another client (its pictures are there): taken as up to date until drawn on here
      if (oursOn(Number(n.data.sg.id), n.id).length) st.notes[n.id] = Object.assign({}, s0 || {}, { pics: sigOf(rows, n) });
      // written on ShotGrid (pulled by another client): pictures from here only for drawings made here
      else if (n.id === idFor(host + ":note:" + n.data.sg.id)) st.notes[n.id] = Object.assign({}, s0 || {}, { pics: picSig([], n, pulled()) });
    });
    var needPics = notes.filter(function(n){ var s = st.notes[n.id] || {}; return !n.data.sg || s.pics !== sigOf(rows, n); }).map(function(n){ return n.id; });
    var pics = new Map();
    if (needPics.length){ prog("Rendering pictures…"); pics = (await o.pictures(needPics, { skipShots: pulled() })) || new Map(); }
    var sudoOf = function(author){ var l = o.sudo && o.logins && author ? o.logins[author] : ""; return l || undefined; };
    var refused = function(e){ return e && e.status === 400 && /status/i.test(e.message + JSON.stringify(e.body || "")); };

    for (var j = 0; j < notes.length; j++){
      var n = notes[j], nd = n.data, s = Object.assign({}, st.notes[n.id] || {}), sgid = nd.sg ? Number(nd.sg.id) : null, dirty = false;
      var mark = clone(n), md = mark.data;
      try {
        var sudo = sudoOf(nd.author);
        var subj = subjectOf(link, n, fps, sudo ? "" : nd.author);
        if (!sgid){
          prog("Sending note " + (j + 1) + " of " + notes.length + "…");
          var body = { project: { type: "Project", id: link.project.id }, subject: subj, content: nd.text || "",
            note_links: [{ type: "Version", id: vid }], sg_status_list: statusTo(smap, nd.status) };
          if (link.task) body.tasks = [{ type: "Task", id: link.task.id }];
          var made, mf = { sudo: sudo, fields: ["updated_at", "sg_status_list"] };
          try { made = await client.create("Note", body, mf); }
          catch (e){
            if (!refused(e)) throw e;  // a site whose notes have no such status: sent without one
            delete body.sg_status_list;
            made = await client.create("Note", body, mf);
          }
          sgid = made.id; md.sg = { site: host, id: sgid, v: vid }; dirty = true;
          s.sg = sgid; s.at = stampOf(made.updated_at) || now; s.txt = hashOf(nd.text || ""); s.st = nd.status_at || 0;
          s.sgst = made.sg_status_list !== undefined ? made.sg_status_list : body.sg_status_list;
          res.pushed.notes++;
        } else {
          var cur = sgById.get(sgid);
          if (!cur){ continue; }  // gone on ShotGrid (deleted there): left as it is here
          if (s.txt === undefined) s.txt = hashOf(cur.content || "");
          if (s.st === undefined) s.st = nd.status_at || 0;
          var did = false;
          if ((nd.text || "") !== (cur.content || "") && hashOf(nd.text || "") !== s.txt){
            prog("Updating note " + (j + 1) + " of " + notes.length + "…");
            var up = await client.update("Note", sgid, { content: nd.text || "" }, { sudo: sudo, fields: ["updated_at"] });
            s.at = Math.max(s.at || 0, stampOf(up && up.updated_at) || now); did = true;
          }
          s.txt = hashOf(nd.text || "");
          var want = statusTo(smap, nd.status);
          if (want !== cur.sg_status_list && (nd.status_at || 0) > (s.st || 0) && statusFrom(smap, cur.sg_status_list) !== (nd.status || "open")){
            try {
              await client.update("Note", sgid, { sg_status_list: want }, { sudo: sudo });
              s.sgst = want; did = true;
            } catch (e){
              if (!refused(e)) throw e;
              res.errors.push("Note " + (j + 1) + ": ShotGrid refused the status code “" + want + "” — set the note status codes in the ShotGrid settings");
            }
          }
          s.st = Math.max(s.st || 0, nd.status_at || 0);
          if (did) res.pushed.updated++;
        }
        // pictures: replace the ones we sent before when the drawings / pictures changed
        var sig = sigOf(rows, n);
        if (s.pics !== sig && pics.has(n.id)){
          var old = oursOn(sgid, n.id);
          for (var q = 0; q < old.length; q++){
            try { await client.remove("Attachment", old[q].id); } catch (e){ res.errors.push("Old picture: " + e.message); }
          }
          var list = pics.get(n.id) || [];
          for (var p = 0; p < list.length; p++){
            prog("Uploading picture " + (p + 1) + " of note " + (j + 1) + "…");
            var ext = /png/.test(list[p].blob.type || "") ? ".png" : ".jpg";
            await client.upload("Note", sgid, list[p].blob, OUR_PREFIX + n.id + "-" + (p + 1) + ext, { sudo: sudo });
            res.pushed.pictures++;
          }
          s.pics = sig;
        }
        // The ids reach the rows now, before the replies: a sync that breaks off later must not send this note
        // again. (One that breaks off between the create and here is recognised by its pictures, sight-<id>-n.)
        if (dirty){ await o.importPackage(pkg([mark])); dirty = false; }
        // replies
        var reps = md.replies || [];
        for (var k = 0; k < reps.length; k++){
          var rp = reps[k];
          if (!rp || rp.event || rp.deleted) continue;
          var rs = st.replies[rp.id] || {}, rsudo = sudoOf(rp.author);
          var rtext = (rsudo || !rp.author ? "" : rp.author + ": ") + (rp.text || "");
          if (!rp.sg){
            if (!(rp.text || "").trim()) continue;
            var mr = await client.create("Reply", { entity: { type: "Note", id: sgid }, content: rtext }, { sudo: rsudo });
            reps[k] = Object.assign({}, rp, { sg: mr.id }); dirty = true;
            st.replies[rp.id] = { pushed: rp.edited || rp.created || 0 };
            st.replies["sg" + mr.id] = { at: now };
            res.pushed.replies++;
          } else {
            var sr = sgReplyById.get(Number(rp.sg)), rat = rp.edited || rp.created || 0;
            if (sr && (sr.content || "") !== rtext && (sr.content || "") !== (rp.text || "") && rat > (rs.pushed || 0)){
              await client.update("Reply", rp.sg, { content: rtext }, { sudo: rsudo });
              st.replies["sg" + rp.sg] = { at: now };
              res.pushed.replies++;
            }
            st.replies[rp.id] = { pushed: Math.max(rs.pushed || 0, rat) };
          }
        }
      } catch (e){
        res.errors.push("Note " + (j + 1) + ": " + e.message);
      } finally {
        st.notes[n.id] = s;
        if (dirty){
          try { await o.importPackage(pkg([mark])); } catch (e){ res.errors.push("Saving ShotGrid ids: " + e.message); }
        }
      }
    }
    st.last = now;
    res.state = st;
    return res;
  }

  return {
    DEFAULT_STATUS: DEFAULT_STATUS, OUR_PREFIX: OUR_PREFIX,
    siteUrl: siteUrl, siteHost: siteHost, idFor: idFor, flat: flat, statusTo: statusTo, statusFrom: statusFrom, statusMap: statusMap,
    createClient: createClient, loadVersion: loadVersion, linkOf: linkOf, VERSION_FIELDS: VERSION_FIELDS, linkedVersionOf: linkedVersionOf, picSig: picSig, annotFrame: annotFrame,
    frameOf: frameOf, sync: sync,
  };
})();
if (typeof globalThis !== "undefined") globalThis.SightShotGrid = SightShotGrid;
if (typeof module === "object" && module && module.exports) module.exports = SightShotGrid;
