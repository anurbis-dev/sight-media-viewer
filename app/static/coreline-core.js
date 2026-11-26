// Coreline core — the Coreline tracker adapter of Sight's page (docs/CORELINE.md, docs/PLAN-coreline.md R4): browse a
// Coreline project's Versions in the library grid, link a file's review to a Version's file field, and sync the
// review rows both ways. Coreline stores Sight's own FORMAT.md v1 rows (its ADR-0037 review layer) and merges them on
// its server with Sight's review-core.js mergeRows, so the sync moves rows, not flat pictures:
//   pull = GET /api/review/:type/:id/:field (rows, tombstones, shots with signed URLs) → the host's own .srev import;
//   push = the rows changed here since the last sync → POST …/merge (+ pictures Coreline lacks: an upload + PUT …/shots).
//
// Plain script, no imports: one global `SightCoreline` (also module.exports under Node, for the tests); registers its
// adapter on globalThis.SightTrackerAdapters (trackers-core.js lists the interface). Sight only: Coreline sends no CORS
// headers and the API key stays in Sight's server (app/coreline.py), so every request goes through
// /api/trackers/<tracker key>/fetch?url=…. The phone app does not load it.

var SightCoreline = (function(){
  "use strict";

  var FILMSTRIP_W = 240;   // the server re-tiles the scrub sprite into frames this wide (app/coreline.py STRIP_W)
  var ROW_KEYS = ["id", "kind", "shape_kind", "x", "y", "w", "h", "rotation", "z_index", "color", "data", "locked", "created_at", "updated_at"];
  var BATCH_ROWS = 1000, BATCH_BYTES = 8 * 1048576;   // per merge request (Coreline: 10,000 rows / 16 MiB a write)

  // ---- small helpers -------------------------------------------------------------------------------------------
  function siteUrl(s){
    s = String(s || "").trim().replace(/\/+$/, "");
    if (!s) return "";
    if (!/^https?:\/\//i.test(s)) s = "https://" + s;
    return s.replace(/\/api(\/v[\d.]+)?$/i, "");
  }
  function siteHost(s){ try { return new URL(siteUrl(s)).host.toLowerCase(); } catch (e){ return ""; } }
  function err(msg, status, body){ var e = new Error(msg); e.status = status || 0; e.body = body; return e; }
  function errText(j, status){
    if (j && j.error && typeof j.error === "object" && j.error.message) return String(j.error.message);
    if (j && Array.isArray(j.errors) && j.errors[0] && j.errors[0].title) return String(j.errors[0].title);   // (Sight's own refusals)
    if (j && typeof j.detail === "string") return j.detail;
    return "Coreline answered " + status;
  }
  function clone(v){ return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  // JSON with sorted keys: a row read back from Coreline (jsonb reorders keys) compares equal to Sight's copy
  function stable(v){
    if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
    if (v && typeof v === "object") return "{" + Object.keys(v).sort().filter(function(k){ return v[k] !== undefined; }).map(function(k){ return JSON.stringify(k) + ":" + stable(v[k]); }).join(",") + "}";
    return JSON.stringify(v === undefined ? null : v);
  }
  function fnv(str){
    var s = String(str), h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
    for (var i = 0; i < s.length; i++){
      var c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ c, 0x01000193 + 0x2f) >>> 0;
      h2 = (h2 ^ (h2 >>> 13)) >>> 0;
    }
    return ("0000000" + h1.toString(16)).slice(-8) + ("0000000" + h2.toString(16)).slice(-8);
  }
  var num = function(v){ var n = Number(v); return v == null || v === "" || !isFinite(n) ? null : n; };
  // A row's content (what a merge would change), stamps left out: Sight's import stamps rows itself, so the copy here
  // and Coreline's differ in stamps only after a pull — that is not a change to send back.
  function rowSig(r){
    return fnv(stable({ k: r.kind, s: r.shape_kind == null ? null : r.shape_kind, x: num(r.x), y: num(r.y), w: num(r.w), h: num(r.h),
      r: num(r.rotation) || 0, z: Math.trunc(num(r.z_index) || 0), c: r.color == null ? null : r.color, l: r.locked ? 1 : 0, d: r.data == null ? {} : r.data }));
  }
  function pickRow(r){ var o = {}; ROW_KEYS.forEach(function(k){ o[k] = r[k] === undefined ? null : r[k]; }); if (o.locked == null) o.locked = 0; return o; }
  function stampOf(v){ if (typeof v === "number") return v; var t = Date.parse(v || ""); return isFinite(t) ? t : 0; }
  // the shot ids a row refers to (a note's / a reply's pictures, a reference image's picture)
  function shotsOf(r){
    var d = r && r.data, out = [];
    if (!d || typeof d !== "object") return out;
    (Array.isArray(d.shots) ? d.shots : []).forEach(function(s){ if (typeof s === "string") out.push(s); });
    if (typeof d.shot === "string") out.push(d.shot);
    (Array.isArray(d.replies) ? d.replies : []).forEach(function(x){ (x && Array.isArray(x.shots) ? x.shots : []).forEach(function(s){ if (typeof s === "string") out.push(s); }); });
    return out;
  }
  function blobToDataUrl(blob){
    if (typeof FileReader !== "undefined"){
      return new Promise(function(ok, no){ var fr = new FileReader(); fr.onload = function(){ ok(fr.result); }; fr.onerror = function(){ no(fr.error); }; fr.readAsDataURL(blob); });
    }
    return blob.arrayBuffer().then(function(b){ return "data:" + (blob.type || "image/jpeg") + ";base64," + Buffer.from(b).toString("base64"); });
  }

  // ---- the client: every request through Sight's server (the key stays there) -----------------------------------
  // createClient({site, via, headers, fetch}) — via: the pass-through prefix ("/api/trackers/<key>/fetch?url=").
  function createClient(opts){
    var site = siteUrl(opts.site), via = opts.via || "", extra = opts.headers || {}, f = opts.fetch || function(u, i){ return fetch(u, i); };
    function full(p){ return /^https?:\/\//i.test(p) ? p : site + (p.charAt(0) === "/" ? p : "/" + p); }
    function raw(method, path, body, headers){
      var h = {}; Object.keys(extra).forEach(function(k){ h[k] = extra[k]; }); Object.keys(headers || {}).forEach(function(k){ h[k] = headers[k]; });
      return f(via + encodeURIComponent(full(path)), { method: method, headers: h, body: body });
    }
    async function api(method, path, body){
      var r = await raw(method, path, body === undefined ? undefined : JSON.stringify(body),
        body === undefined ? { Accept: "application/json" } : { "Content-Type": "application/json", Accept: "application/json" });
      var text = await r.text(), j = null;
      try { j = text ? JSON.parse(text) : {}; } catch (e){ j = null; }
      if (!r.ok) throw err(errText(j, r.status), r.status, j);
      return j || {};
    }
    async function download(u){
      var r = await raw("GET", u, undefined, {});
      if (!r.ok) throw err("Download failed (" + r.status + ")", r.status);
      return r.blob();
    }
    return { site: site, host: siteHost(site), via: via, api: api, raw: raw, download: download };
  }

  // ---- the schema (Coreline's schema is data: keys are read from it, the defaults are only a fallback) ------------
  var schemaCache = new Map();   // site → {at, p}
  function schemaOf(client){
    var c = schemaCache.get(client.site);
    if (c && Date.now() - c.at < 120000) return c.p;
    var p = client.api("GET", "/api/schema").then(parseSchema);
    schemaCache.set(client.site, { at: Date.now(), p: p });
    p.catch(function(){ if (schemaCache.get(client.site) && schemaCache.get(client.site).p === p) schemaCache.delete(client.site); });
    return p;
  }
  function statusListsOf(j){
    // the statuses of a status field come from the schema's status lists (shape read defensively)
    var out = {}, sl = j && (j.statusLists || j.status_lists || j.statuses);
    var put = function(k, list){ if (k && Array.isArray(list)) out[k] = list.filter(function(s){ return s && s.key != null; }).map(function(s){ return { key: String(s.key), label: s.label || String(s.key) }; }); };
    if (Array.isArray(sl)) sl.forEach(function(x){ if (x) put(x.key, x.statuses || x.values || x.items); });
    else if (sl && typeof sl === "object") Object.keys(sl).forEach(function(k){ var v = sl[k]; put(k, Array.isArray(v) ? v : v && (v.statuses || v.values || v.items)); });
    return out;
  }
  function parseSchema(j){
    var types = (j && Array.isArray(j.entityTypes) ? j.entityTypes : []).filter(function(t){ return t && t.key; });
    var lists = statusListsOf(j);
    var byKey = {}; types.forEach(function(t){ byKey[t.key] = t; });
    var fieldsOf = function(t){ return (t && Array.isArray(t.fields) ? t.fields : []).filter(function(f){ return f && f.key; }); };
    var dispOf = function(k){
      var t = byKey[k], fs = fieldsOf(t);
      if (t && t.displayField) return t.displayField;
      var hit = ["code", "name", "title"].filter(function(n){ return fs.some(function(f){ return f.key === n; }); })[0];
      return hit || "code";
    };
    var media = byKey.version || types.filter(function(t){ return /version/i.test(t.label || ""); })[0]
      || types.filter(function(t){ return fieldsOf(t).some(function(f){ return f.type === "file"; }); })[0] || null;
    var mf = fieldsOf(media);
    var field = (mf.filter(function(f){ return f.key === "media" && (f.type === "file" || f.type === "image"); })[0]
      || mf.filter(function(f){ return f.type === "file"; })[0] || mf.filter(function(f){ return f.type === "image" && f.key !== "thumbnail"; })[0] || {}).key || "";
    var status = (mf.filter(function(f){ return f.key === "status" && f.type === "status"; })[0] || mf.filter(function(f){ return f.type === "status"; })[0] || {}).key || "status";
    return { raw: j, types: types, byKey: byKey, lists: lists, dispOf: dispOf, fieldsOf: fieldsOf,
      mediaType: media ? media.key : "version", mediaField: field, statusField: status, disp: media ? dispOf(media.key) : "code" };
  }

  // ---- browsing (the library grid's Coreline source, tracker-source.js) -------------------------------------------
  var NO_TILE_TYPE = { file: 1, image: 1 };
  var DEFAULT_TILE_FIELDS = ["code", "status", "artist"];
  async function versionFields(client){
    var S = await schemaOf(client), out = [];
    S.fieldsOf(S.byKey[S.mediaType]).forEach(function(f){
      if (NO_TILE_TYPE[f.type]) return;
      var x = { name: f.key, label: f.label || f.key, type: f.type };
      var st = f.settings || {};
      if (f.type === "status"){
        var l = S.lists[st.statusList] || [];
        x.values = l.map(function(s){ return s.key; });
        x.labels = {}; l.forEach(function(s){ x.labels[s.key] = s.label; });
      } else if (f.type === "enum" && Array.isArray(st.values)){
        var vs = st.values.filter(function(v){ return v && v.key != null && !v.hidden; });
        x.values = vs.map(function(v){ return String(v.key); });
        x.labels = {}; vs.forEach(function(v){ x.labels[String(v.key)] = v.label || String(v.key); });
      } else if (f.type === "entity"){
        var tg = Array.isArray(st.targets) ? st.targets.filter(function(t){ return typeof t === "string"; }) : [];
        x.paths = tg.map(function(t){ return f.key + (tg.length > 1 ? ":" + t : "") + "." + S.dispOf(t); });   // (name filters)
      }
      out.push(x);
    });
    out.sort(function(a, b){ return a.label.localeCompare(b.label); });
    return out;
  }
  // a record as the grid keeps it: its fields at the top level, beside its id / type / project / stamps
  var META = ["id", "type", "projectId", "createdAt", "updatedAt"];
  function flat(rec, S){
    if (!rec || typeof rec !== "object") return rec;
    var out = {}, f = rec.fields && typeof rec.fields === "object" ? rec.fields : {};
    Object.keys(f).forEach(function(k){ if (META.indexOf(k) < 0 && k.charAt(0) !== "$") out[k] = f[k]; });
    META.forEach(function(k){ out[k] = rec[k]; });
    out.$mf = S.mediaField; out.$name = f[S.disp] != null && f[S.disp] !== "" ? String(f[S.disp]) : "";
    if (rec.columns && typeof rec.columns === "object") out.$cols = rec.columns;
    return out;
  }
  function projectCond(id){ return { field: "project", op: "is", value: { type: "project", id: Number(id) } }; }
  function browseFilter(S, f){
    var and = [projectCond(f.project)];
    if (f.entity && f.type) and.push({ field: "entity", op: "is", value: { type: f.type, id: Number(f.entity) } });
    else if (f.type) and.push({ field: "entity:" + f.type + "." + S.dispOf(f.type), op: "is_not_null" });
    if (f.status) and.push({ field: S.statusField, op: "is", value: f.status });
    if (f.q) and.push({ field: S.disp, op: "contains", value: f.q });
    return and;
  }
  // POST /api/query is cursor-paged; the grid asks for page n: the cursors are kept per query (and per server)
  var cursors = new Map(), plain = new Set();   // plain: servers that refused the optional sort / columns once
  async function query(client, body){
    var opt = !plain.has(client.site);
    var b = Object.assign({}, body);
    if (!opt){ delete b.sort; delete b.columns; }
    try { return await client.api("POST", "/api/query", b); }
    catch (e){
      if (!(opt && e.status === 400 && (body.sort || body.columns))) throw e;
      var b2 = Object.assign({}, body); delete b2.sort; delete b2.columns;
      var j2;
      try { j2 = await client.api("POST", "/api/query", b2); } catch (e2){ throw e; }   // (refused for another reason: that error)
      plain.add(client.site);   // (the sort / columns were what it refused: plain queries for this server from now on)
      return j2;
    }
  }
  async function browseVersions(client, f, fields, page, size, where){
    var S = await schemaOf(client);
    var and = browseFilter(S, f);
    if (where) and.push(where);
    var cols = (fields || []).filter(function(k){ return typeof k === "string"; });
    var body = { type: S.mediaType, filter: { and: and }, sort: [{ field: "createdAt", dir: "desc" }], limit: size || 60 };
    if (cols.length) body.columns = cols;
    var key = client.site + " " + stable(body);
    var list = cursors.get(key) || [];
    page = page || 1;
    if (page === 1) list = [];
    var cur = page > 1 ? list[page - 2] : undefined;
    if (page > 1 && cur === undefined){
      // (a page asked without the one before: walked from the start)
      for (var p = 1; p < page; p++){ await browseVersions(client, f, fields, p, size, where); }
      list = cursors.get(key) || []; cur = list[page - 2];
      if (!cur) return [];
    }
    if (page > 1 && cur === null) return [];   // (the last page was reached)
    // a page is filled up to `size` (an answer shorter than asked — deleted records left out, a server's own cap — would
    // read as the last page to the grid while more are there)
    var out = [], want = body.limit, next = cur;
    for (var guard = 0; guard < 50 && out.length < want; guard++){
      var b = Object.assign({}, body, { limit: want - out.length }); if (next) b.cursor = next;
      var j = await query(client, b);
      (Array.isArray(j.records) ? j.records : []).forEach(function(r){ if (r && !r.deleted) out.push(flat(r, S)); });
      next = j.nextCursor || null;
      if (!next) break;
    }
    list[page - 1] = next;
    cursors.set(key, list);
    if (cursors.size > 200) cursors.delete(cursors.keys().next().value);
    return out;
  }
  function fmtField(v, name){
    if (!v) return "";
    var c = v.$cols && v.$cols[name];
    if (typeof c === "string" || typeof c === "number") return String(c);
    var x = v[name];
    if (x == null || x === "") return "";
    var one = function(e){ return e && typeof e === "object" ? (e.display || e.name || e.label || (e.type ? e.type + " #" + e.id : "")) : String(e); };
    if (Array.isArray(x)) return x.map(one).join(", ");
    if (typeof x === "object") return one(x);
    if (typeof x === "boolean") return x ? "Yes" : "No";
    if (typeof x === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(x)){ var t = Date.parse(x); if (isFinite(t)) return new Date(t).toLocaleString(); }
    return String(x);
  }
  function filmstripFrames(stripWidth){ return Math.max(1, Math.round((stripWidth || 0) / FILMSTRIP_W)); }
  function filmstripCss(frames, fx){
    var i = Math.min(frames - 1, Math.max(0, Math.floor(fx * frames)));
    return { size: (frames * 100) + "% 100%", pos: (frames > 1 ? (i / (frames - 1)) * 100 : 0) + "% 0%", frame: i };
  }
  function fileOf(v){ var m = v && v[v.$mf || "media"]; return m && typeof m === "object" ? m : null; }

  // ---- Filter ▾ over Version fields --------------------------------------------------------------------------------
  var SF = function(){ return globalThis.SightFilter; };
  var FILTER_TYPE = { text: "text", longtext: "text", url: "text", email: "text", entity: "entity", status: "enum", enum: "enum",
    date: "date", datetime: "date", number: "number", percent: "number", duration: "number", currency: "number", timecode: "number", checkbox: "bool" };
  function filterFields(schema, opts){
    var F = SF(), out = [], seen = (opts && opts.seen) || {};
    (schema || []).forEach(function(f){
      var t = FILTER_TYPE[f.type];
      if (!t) return;
      if (t === "entity" && !(f.paths && f.paths.length)) return;
      var x = { name: f.name, label: f.label, type: t, srcType: f.type, paths: f.paths };
      if (t === "enum"){
        var vals = f.values || [];
        if (!vals.length && seen[f.name]){
          var have = Object.create(null);
          Array.from(seen[f.name]).forEach(function(v){ if (v != null && v !== "") have[String(v)] = 1; });
          vals = Object.keys(F.namedIn(opts.tree, f.name, have)).sort();
        }
        x.values = vals.map(function(v){ return [v, (f.labels && f.labels[v]) || v]; });
        if (!x.values.length) x.type = "text";
        x.ops = ["is", "is_not", "empty", "not_empty"];
      }
      if (t !== "bool" && t !== "enum") x.ops = F.opsOf(x).concat(t === "date" || t === "number" ? ["empty", "not_empty"] : []);
      out.push(x);
    });
    return out;
  }
  function isoOf(ms){ return new Date(ms).toISOString().replace(/\.\d+Z$/, "Z"); }
  // A Filter ▾ tree as Coreline's filter (ADR-0006: {and|or: [...]}, {not: …}, {field, op, value}); null: nothing left.
  function toConditions(tree, fields){
    var F = SF(), t = F.clean(tree, fields);
    if (!t) return null;
    return (function conv(g){
      var list = g.c.map(function(x){
        if (F.isGroup(x)) return conv(x);
        var f = F.fieldOf(fields, x.f), p = x.f, o = x.o, v = x.v;
        var c = function(op, val){ var n = { field: p, op: op }; if (val !== undefined) n.value = val; return n; };
        if (o === "empty") return c("is_null");
        if (o === "not_empty") return c("is_not_null");
        if (f.type === "bool") return c("is", o === "yes");
        if (f.type === "entity"){
          var s = String(v).trim(), op = { contains: "contains", not_contains: "not_contains", is: "is" }[o];
          var each = f.paths.map(function(path){ return { field: path, op: op, value: s }; });
          if (each.length === 1) return each[0];
          return o === "not_contains" ? { and: each } : { or: each };
        }
        if (f.type === "number") return c(o, Number(v));
        if (f.type === "date"){
          if (o === "in_last") return c("in_last", { n: Number(v), unit: "day" });
          if (f.srcType === "date") return c({ on: "is", before: "lt", after: "gt" }[o], v);
          if (o === "before") return c("lt", isoOf(F.dayStart(v)));
          if (o === "after") return c("gte", isoOf(F.dayStart(v, 1)));
          return c("between", [isoOf(F.dayStart(v)), isoOf(F.dayStart(v, 1) - 1000)]);
        }
        return c(o, f.type === "enum" ? v : String(v).trim());
      });
      var n = {}; n[g.op === "or" ? "or" : "and"] = list; return n;
    })(t);
  }

  // ---- the link (what a review is tied to): a record's file field ---------------------------------------------------
  function parseRecId(s){
    var m = /^([a-z][a-z0-9_]{0,63}):([1-9][0-9]{0,18}):([a-z][a-z0-9_]{0,63})$/.exec(String(s || ""));
    return m ? { type: m[1], id: Number(m[2]), field: m[3] } : null;
  }
  // A record (flat from the grid, as /api/records gives it, or app/coreline.py's open answer) → the link.
  function linkOf(host, rec){
    var f = rec && rec.fields && typeof rec.fields === "object" ? rec.fields : rec || {};
    var name = rec.$name || f.code || f.name || f.title || "";
    var file = rec.file && typeof rec.file === "object" ? rec.file : null;
    var out = { site: host, type: rec.type, id: Number(rec.id), field: rec.field || rec.$mf || "media", code: String(name || ""),
      project: rec.projectId != null ? { id: rec.projectId, name: "" } : null };
    if (rec.source) out.source = rec.source;
    if (rec.scaled) out.scaled = true;
    if (file) out.file = { id: file.id, name: file.name, width: file.width, height: file.height };
    return out;
  }
  async function loadLink(client, id){
    var r = parseRecId(id);
    if (!r) throw err("Not a Coreline Version: " + id);
    var rec = await client.api("GET", "/api/records/" + r.type + "/" + r.id);
    if (!rec || rec.id == null || rec.deleted) throw err("Version " + r.id + " not found on Coreline");
    var file = null;   // (the original's size: Sync checks the linked file against it — doc units are its pixels)
    try { file = await client.api("GET", "/api/records/" + r.type + "/" + r.id + "/files/" + r.field); } catch (e){ if (e.status !== 404 && e.status !== 403) throw e; }
    return linkOf(client.host, Object.assign({}, rec, { field: r.field, file: file && file.id != null ? file : null }));
  }
  function reviewPath(link){ return "/api/review/" + encodeURIComponent(link.type) + "/" + Number(link.id) + "/" + encodeURIComponent(link.field); }

  // The id Sight's import gives a row whose id another file holds: sha1("anno-import:<asset id>:<row id>")[:16]
  // (app/library.py import_annotations / asset_id). "" when this runtime has no SHA-1.
  async function derivedId(aid, rid){
    var c = typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle;
    if (!c || !aid) return "";
    var buf = await c.digest("SHA-1", new TextEncoder().encode("anno-import:" + aid + ":" + rid.toLowerCase()));
    return Array.from(new Uint8Array(buf)).map(function(b){ return ("0" + b.toString(16)).slice(-2); }).join("").slice(0, 16);
  }

  // ---- pictures to Coreline: a resumable upload, then the shot id linked to it --------------------------------------
  async function uploadShot(client, base, sid, blob){
    var type = blob.type || "image/jpeg";
    if (!/^image\/(jpeg|png)$/.test(type)) throw err("picture " + sid + ": only JPEG / PNG go to Coreline");
    var up = await client.api("POST", "/api/uploads", { name: sid + (type === "image/png" ? ".png" : ".jpg"), size: blob.size, mime: type });
    var off = Number(up.received) || 0, cs = Number(up.chunkSize) || 4 * 1048576;
    while (off < blob.size){
      var end = Math.min(blob.size, off + cs);
      var r = await client.raw("PUT", "/api/uploads/" + encodeURIComponent(up.id), blob.slice(off, end),
        { "Content-Type": "application/octet-stream", "Content-Range": "bytes " + off + "-" + (end - 1) + "/" + blob.size });
      if (!r.ok){ var t = null; try { t = await r.json(); } catch (e){} throw err(errText(t, r.status), r.status, t); }
      off = end;
    }
    var done = await client.api("POST", "/api/uploads/" + encodeURIComponent(up.id) + "/complete", {});
    var fid = (done && done.file && done.file.id) || (done && done.fileId) || (done && done.id) || up.id;
    try { await client.api("PUT", base + "/shots/" + encodeURIComponent(sid), { file: fid }); }
    catch (e){ if (e.status === 409) e.taken = true; throw e; }   // (409 here: another picture holds this id there)
  }

  // ---- sync ---------------------------------------------------------------------------------------------------------
  // The host gives (annotate.js, the same as for ShotGrid): client, link, asset (FORMAT.md identity for the packages it
  // imports), state (kept per file by the host: {} the first time), getRows() (tombstones included),
  // importPackage(pkg) (the host's own .srev import), progress(text), and optionally localShot(id) -> Blob|null (a
  // picture kept here; default Sight's /api/review/shots/<id>), now.
  // Returns {state, pulled: {added, updated}, pushed: {notes, updated, replies, pictures}, skipped, errors}.
  async function sync(o){
    var client = o.client, link = o.link, prog = o.progress || function(){};
    if (!link || !link.type || !link.id || !link.field) throw err("Not linked to a Coreline Version");
    if (link.scaled) throw err("This file is Coreline's scaled web preview (the original is not kept there): drawings are in the original's pixels, so it cannot be synced — link the original file instead");
    // any file whose size is not the original's (a scaled preview, a proxy linked by hand): drawings would land in
    // the wrong units on Coreline
    var lf = link.file || {}, a = o.asset || {};
    var same = function(w, h){ return Number(lf.width) === Number(w) && Number(lf.height) === Number(h); };
    // (swapped sizes pass: a rotated phone video / an EXIF-rotated picture can be stored coded one way, shown the other)
    if (lf.width && lf.height && a.width && a.height && !same(a.width, a.height) && !same(a.height, a.width))
      throw err("This file is " + a.width + " × " + a.height + ", the Version's original " + lf.width + " × " + lf.height + ": drawings are in the original's pixels, so it cannot be synced — link the original file instead");
    var now = o.now || Date.now();
    var st = clone(o.state) || {}; st.sent = st.sent || {}; st.shots = st.shots || {};
    var res = { pulled: { added: 0, updated: 0 }, pushed: { notes: 0, updated: 0, replies: 0, pictures: 0 }, skipped: 0, errors: [] };
    var base = reviewPath(link);
    var localShot = o.localShot || async function(id){
      var r = await fetch("/api/review/shots/" + encodeURIComponent(id));
      return r.ok ? r.blob() : null;
    };

    // ---- read Coreline
    prog("Reading the review from Coreline…");
    var rv = await client.api("GET", base);
    var rrows = Array.isArray(rv.rows) ? rv.rows.filter(function(r){ return r && r.id; }) : [];
    var rdel = Array.isArray(rv.deleted) ? rv.deleted.filter(function(t){ return t && t.id && t.deleted_at; }) : [];
    var rshots = rv.shots && typeof rv.shots === "object" ? rv.shots : {};
    var remote = new Map(rrows.map(function(r){ return [String(r.id).toLowerCase(), r]; }));   // (Sight keeps ids lower-case)
    var remoteDel = new Map(rdel.map(function(t){ return [String(t.id).toLowerCase(), stampOf(t.deleted_at)]; }));

    // ---- pull: Coreline's rows + tombstones through the host's import (its merge rules decide), pictures this machine
    // lacks downloaded once
    var pics = {};
    var want = new Set(); rrows.forEach(function(r){ shotsOf(r).forEach(function(s){ if (rshots[s] && st.shots[s] !== "got" && st.shots[s] !== "up") want.add(s); }); });
    for (var sid of want){
      try {
        var have = await localShot(sid);
        if (!have){
          prog("Downloading picture " + sid + "…");
          var u = rshots[sid] && rshots[sid].url;
          if (!u) continue;
          pics[sid] = await blobToDataUrl(await client.download(u));
        }
        st.shots[sid] = "got";
      } catch (e){ res.errors.push("Picture " + sid + ": " + e.message); }
    }
    if (rrows.length || rdel.length){
      prog("Merging the Coreline review…");
      var got = await o.importPackage({ format: "sight-review", version: 1, app: "Coreline sync", exported_at: now, author: "", asset: o.asset,
        annotations: rrows.map(pickRow), deleted: rdel.map(function(t){ return { id: t.id, deleted_at: stampOf(t.deleted_at) }; }), shots: pics });
      res.pulled.added = (got && got.added) || 0;
      res.pulled.updated = ((got && got.updated) || 0) + ((got && got.deleted) || 0);
    }

    // ---- push: what differs here from Coreline's copy and was not sent as it is
    var local = await o.getRows();
    // Coreline's rows that are not here under their own ids: another file in Sight holds those ids (the same Version
    // linked to two files: a local copy and the one opened from Coreline), so the import copied them here under ids
    // derived for this file (Library.import_annotations). Those copies are never sent: they would be duplicates there.
    st.foreign = st.foreign || {};
    var here = new Set((local || []).map(function(r){ return r && String(r.id).toLowerCase(); }));
    var moved = rrows.filter(function(r){ return !here.has(String(r.id).toLowerCase()); });
    if (moved.length){
      var ok = true;
      for (var mi = 0; mi < moved.length; mi++){
        var did = await derivedId(o.asset && o.asset.id, String(moved[mi].id));
        if (did) st.foreign[did] = 1; else ok = false;
      }
      res.errors.push(moved.length + " of Coreline's rows are on another file in Sight already (this Version is linked there too): copied here, not sent back — sync that file instead");
      if (!ok){ res.state = st; st.last = now; return res; }   // (no SHA-1 here: nothing is sent rather than duplicates)
    }
    var rows = [], dels = [], sigs = {};
    (local || []).forEach(function(r){
      if (!r || !r.id) return;
      var id = String(r.id).toLowerCase();
      if (st.foreign[id]) return;
      if (r.deleted_at != null){
        var at = stampOf(r.deleted_at);
        if ((remoteDel.get(id) || 0) >= at || st.sent["d:" + id] === at) return;
        if (!remote.has(id) && !remoteDel.has(id) && st.sent[id] === undefined) return;   // (never on Coreline: nothing to delete there)
        dels.push({ id: id, deleted_at: at }); sigs["d:" + id] = at;
        return;
      }
      var s = rowSig(r);
      var rr = remote.get(id);
      if (rr && rowSig(rr) === s){ st.sent[id] = s; return; }
      if (st.sent[id] === s && rr) return;
      rows.push(pickRow(r)); sigs[id] = s;
    });
    // pictures the rows here name that Coreline lacks (every live row, not only the ones sent now: a picture whose
    // upload failed is tried again on the next sync)
    var upShots = new Set();
    (local || []).forEach(function(r){
      if (!r || !r.id || r.deleted_at != null || st.foreign[String(r.id)]) return;
      shotsOf(r).forEach(function(s){ if (!rshots[s] && st.shots[s] !== "up" && st.shots[s] !== "taken") upShots.add(s); });
    });
    for (var us of upShots){
      try {
        var blob = await localShot(us);
        if (!blob){
          // (said once: a picture neither side has would make every later sync report a problem; still looked for)
          if (st.shots[us] !== "missing") res.errors.push("Picture " + us + " is not on this machine");
          st.shots[us] = "missing";
          continue;
        }
        prog("Uploading picture " + (res.pushed.pictures + 1) + " of " + upShots.size + "…");
        await uploadShot(client, base, us, blob);
        st.shots[us] = "up"; res.pushed.pictures++;
      } catch (e){
        // 409: Coreline holds another picture under this id — not uploaded again on every sync
        if (e.taken) st.shots[us] = "taken";
        res.errors.push("Picture " + us + ": " + e.message);
      }
    }
    // the rows, in batches the server takes
    var batches = [], cur = { rows: [], deleted: [], bytes: 0 };
    var flush = function(){ if (cur.rows.length || cur.deleted.length) batches.push(cur); cur = { rows: [], deleted: [], bytes: 0 }; };
    rows.forEach(function(r){ var n = JSON.stringify(r).length; if (cur.rows.length >= BATCH_ROWS || (cur.bytes + n > BATCH_BYTES && cur.rows.length)) flush(); cur.rows.push(r); cur.bytes += n; });
    dels.forEach(function(t){ if (cur.rows.length + cur.deleted.length >= BATCH_ROWS) flush(); cur.deleted.push(t); });
    flush();
    for (var b = 0; b < batches.length; b++){
      prog(batches.length > 1 ? "Sending to Coreline (" + (b + 1) + " of " + batches.length + ")…" : "Sending to Coreline…");
      try {
        var m = await client.api("POST", base + "/merge", { rows: batches[b].rows, deleted: batches[b].deleted });
        var s2 = (m && m.stats) || {};
        res.pushed.notes += s2.added || 0;
        res.pushed.updated += (s2.updated || 0) + (s2.deleted || 0);
        batches[b].rows.forEach(function(r){ st.sent[r.id] = sigs[r.id]; });
        batches[b].deleted.forEach(function(t){ st.sent["d:" + t.id] = t.deleted_at; });
        if (m && m.seq != null) st.seq = m.seq;
      } catch (e){ res.errors.push("Sending: " + e.message); }
    }
    if (rv.seq != null && (st.seq == null || rv.seq > st.seq)) st.seq = rv.seq;
    st.last = now;
    res.state = st;
    return res;
  }

  // ---- the settings form (trackers-core.js mountForm renders it in Settings → Trackers) -----------------------------
  var SETTINGS = {
    required: ["site", "key"],
    needs: "server address and API key",
    disconnectTitle: "Remove the saved API key: Coreline's controls go until it is connected again (the address stays for that)",
    testTitle: "Connect and list the projects",
    saveError: "Check the server address (https://…) and the API key",
    cache: { clearTitle: "Delete the downloaded Version media (they download again when opened)" },
    fields: [
      { name: "site", label: "Server", type: "text", input: { sight: "url" }, placeholder: "coreline.mystudio.com", clean: siteUrl,
        title: "Your Coreline server's address, e.g. coreline.mystudio.com" },
      { name: "key", label: "API key", type: "secret", placeholder: "none", has: "hasKey", keptWith: ["site"],
        lostText: "The key was removed with the old server — enter it again",
        title: "An API key made in Coreline (your account → API keys). Kept by the Sight server only (coreline.json in Sight's own data folder), never shown again. Sight acts with that user's permissions. Changing the server drops the saved key." },
      { name: "cacheLimitGB", label: "Media cache limit (GB)", type: "number", part: "cache", min: 0, step: 1, placeholder: "Auto",
        title: "Disk space for the media of Versions opened from Coreline (their originals). Empty = Auto: as much as the disk holds, keeping 2 GB free. Oldest opened go first." },
    ],
  };

  var adapter = {
    id: "coreline", name: "Coreline", short: "CL",
    media: { one: "Version", many: "Versions" },
    entityTypes: [["", "All"], ["shot", "Shots"], ["asset", "Assets"]],
    statusField: "status",
    defaultTileFields: DEFAULT_TILE_FIELDS,
    hiddenDetailFields: ["type", "id", "projectId", "thumbnail", "media", "$mf", "$name", "$cols"],
    serverClient: function(site, ref){
      return createClient({ site: site || "x", via: "/api/trackers/" + encodeURIComponent(ref || "coreline") + "/fetch?url=", headers: { "X-Sight": "1" } });
    },
    siteHost: siteHost,
    projects: async function(client){
      var j = await client.api("GET", "/api/me/projects");
      return (Array.isArray(j.projects) ? j.projects : []).filter(function(p){ return p && p.id != null; })
        .map(function(p){ var f = p.fields || {}; return { id: p.id, name: String(p.display || f.name || f.code || "#" + p.id) }; });
    },
    entities: async function(client, projectId, type){
      var S = await schemaOf(client), d = S.dispOf(type);
      var out = [], cur = null;
      for (var n = 0; n < 20; n++){   // (≤ 20 pages of 500: the bar's pick list)
        var b = { type: type, filter: { and: [projectCond(projectId)] }, sort: [{ field: d, dir: "asc" }], limit: 500 };
        if (cur) b.cursor = cur;
        var j = await query(client, b);
        (Array.isArray(j.records) ? j.records : []).forEach(function(r){ if (r && !r.deleted){ var f = r.fields || {}; out.push({ id: r.id, name: String(f[d] != null && f[d] !== "" ? f[d] : "#" + r.id) }); } });
        cur = j.nextCursor || null;
        if (!cur) break;
      }
      return out;
    },
    mediaFields: versionFields,
    filterFields: filterFields,
    toConditions: toConditions,
    browse: browseVersions,
    recordId: function(v){ return v.type + ":" + v.id + ":" + (v.$mf || "media"); },
    recordName: function(v){ return v.$name || "#" + v.id; },
    recordStamp: function(v){ return String(v.updatedAt || ""); },
    recordTime: function(v){ return stampOf(v.createdAt); },
    isVideo: function(v){ var m = fileOf(v); return !!(m && /^video\//.test(m.mime || "")); },
    hasFilmstrip: function(v){ var m = fileOf(v); return !!(m && /^video\//.test(m.mime || "")); },
    filmstripFrames: filmstripFrames, filmstripCss: filmstripCss,
    fmtField: fmtField,
    findMedia: function(client, projectId, text){ return browseVersions(client, { project: projectId, q: text }, [], 1, 50); },
    loadLink: loadLink,
    linkOf: linkOf,
    linkId: function(l){ return l && l.type ? l.type + ":" + l.id + ":" + l.field : null; },
    linkLabel: function(l){ return l ? l.code || (l.type + " #" + l.id) : ""; },
    linkProject: function(l){ return l && l.project ? l.project.name || "" : ""; },
    // (Coreline's rows carry no per-note link: the review is the record's own, so nothing to find in the notes)
    linkedIdOf: function(){ return null; },
    recordSub: function(v){ return v ? fmtField(v, "entity") : ""; },
    sync: function(o){ return sync(o); },
    storeKey: function(n, app){ return app === "phone" ? "sight-review:coreline." + n : "sight.coreline." + n; },
    settings: SETTINGS,
  };
  if (typeof globalThis !== "undefined"){
    var reg = globalThis.SightTrackerAdapters = globalThis.SightTrackerAdapters || [];
    if (!reg.some(function(a){ return a && a.id === adapter.id; })) reg.push(adapter);
  }

  return { adapter: adapter, siteUrl: siteUrl, siteHost: siteHost, createClient: createClient, parseSchema: parseSchema,
    versionFields: versionFields, browseVersions: browseVersions, filterFields: filterFields, toConditions: toConditions,
    linkOf: linkOf, loadLink: loadLink, parseRecId: parseRecId, rowSig: rowSig, shotsOf: shotsOf, sync: sync,
    FILMSTRIP_W: FILMSTRIP_W, _reset: function(){ schemaCache.clear(); cursors.clear(); plain.clear(); } };
})();
if (typeof globalThis !== "undefined") globalThis.SightCoreline = SightCoreline;
if (typeof module === "object" && module && module.exports) module.exports = SightCoreline;
