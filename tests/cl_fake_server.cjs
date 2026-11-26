// A fake Coreline server (the routes Sight's Coreline adapter uses, shaped as Coreline main 9cffd42's docs/API.md and
// ADR-0037 describe them) on 127.0.0.1 — for tests/test_coreline.py and the browser test. In memory. The review merge
// is Sight's own review-core.js mergeRows, which Coreline vendors byte-for-byte. Prints {"site": …} once listening.
//   node tests/cl_fake_server.cjs [port]           API key: "clkey" (Authorization: Bearer clkey)
// Seeds: project 1 "Demo"; shot 11 "sh010"; Versions 21 "sh010_comp_v001" (a PNG original, a web rendition),
// 22 "sh020_anim_v002" (video: poster + a 2 × 1 scrub sprite, a fake original), 23 "robot_v003" (an image whose
// original was deleted: only its scaled web rendition), 24 "sh030_light_v001" (a PNG original: the browser test's).
// Test hooks: GET /__fake/db (reviews, uploads), GET /__fake/log (requests: method, path, auth),
// POST /__fake/merge/<type>/<id>/<field> {rows, deleted} (another reviewer's write).
"use strict";
const http = require("http");
const zlib = require("zlib");
const RC = require("../app/static/review-core.js");

const KEY = process.env.CL_KEY || "clkey";
const log = [];
let seq = 100, nextFile = 500;
const T0 = Date.parse("2026-11-20T10:00:00Z");

// ---- tiny PNGs (solid colours) -----------------------------------------------------------------------------------
const crc = (b) => { let c = ~0; for (const x of b){ c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png(W, H, colourAt){
  const rows = []; for (let y = 0; y < H; y++){ const r = Buffer.alloc(1 + W * 3); for (let x = 0; x < W; x++){ const c = colourAt(x, y); r[1 + x * 3] = c[0]; r[2 + x * 3] = c[1]; r[3 + x * 3] = c[2]; } rows.push(r); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}
const orig21 = png(64, 36, () => [200, 60, 60]);
const web21 = png(64, 36, () => [200, 60, 60]);
const thumb = png(32, 18, () => [60, 160, 220]);
const sprite = png(480, 136, (x) => x < 240 ? [220, 40, 40] : [40, 200, 60]);   // 2 tiles of 240 × 136
const web23 = png(48, 27, () => [90, 90, 200]);

// ---- schema + records ----------------------------------------------------------------------------------------------
const schema = { version: 7, entityTypes: [
  { key: "project", label: "Project", labelPlural: "Projects", projectScoped: false, displayField: "name", fields: [{ key: "name", label: "Name", type: "text" }] },
  { key: "shot", label: "Shot", labelPlural: "Shots", projectScoped: true, displayField: "code", fields: [{ key: "code", label: "Code", type: "text" }] },
  { key: "asset", label: "Asset", labelPlural: "Assets", projectScoped: true, displayField: "code", fields: [{ key: "code", label: "Code", type: "text" }] },
  { key: "person", label: "Person", labelPlural: "People", projectScoped: false, displayField: "name", fields: [{ key: "name", label: "Name", type: "text" }] },
  { key: "version", label: "Version", labelPlural: "Versions", projectScoped: true, displayField: "code", fields: [
    { key: "thumbnail", label: "Thumbnail", type: "image" },
    { key: "code", label: "Code", type: "text", required: true },
    { key: "entity", label: "Link", type: "entity", settings: { targets: ["shot", "asset"] } },
    { key: "status", label: "Status", type: "status", settings: { statusList: "version_status", default: "pend" } },
    { key: "artist", label: "Artist", type: "entity", settings: { targets: ["person"] } },
    { key: "media", label: "Media", type: "file" },
    { key: "description", label: "Description", type: "longtext" },
    { key: "first_frame", label: "First frame", type: "number", settings: { decimals: 0 } },
    { key: "fps", label: "FPS", type: "number", settings: { decimals: 3 } },
  ] },
], statusLists: [{ key: "version_status", statuses: [
  { key: "pend", label: "Pending review", color: "#9c27b0" }, { key: "rev", label: "In review", color: "#ff9800" },
  { key: "rtk", label: "Retake", color: "#f44336" }, { key: "apr", label: "Approved", color: "#4caf50" }] }] };

const files = new Map();   // id -> {meta, bytes: {original?, web?, thumb?, poster?, scrub?}}
function addFile(meta, bytes){ const id = nextFile++; files.set(id, { meta: Object.assign({ id, status: "ready", sha256: "s" + id, error: null, skipped: null, originalDeleted: false }, meta), bytes }); return id; }
const f21 = addFile({ name: "sh010_comp_v001.png", size: orig21.length, mime: "image/png", kind: "image", width: 64, height: 36, duration: null, fps: null,
  renditions: { web: { mime: "image/webp", size: web21.length, width: 64, height: 36 }, thumb: { mime: "image/webp", size: thumb.length, width: 32, height: 18 } } },
  { original: orig21, web: web21, thumb });
const f22 = addFile({ name: "sh020_anim_v002.mov", size: 999, mime: "video/quicktime", kind: "video", width: 3840, height: 2160, duration: 2, fps: 24,
  renditions: { web: { mime: "video/mp4", size: 10, width: 1920, height: 1080 }, poster: { mime: "image/jpeg", size: thumb.length, width: 1920, height: 1080 },
    scrub: { mime: "image/jpeg", size: sprite.length, width: 480, height: 136, frames: 2, columns: 2, rows: 1, tileWidth: 240, tileHeight: 136, interval: 1 } } },
  { original: Buffer.from("not really a movie"), web: Buffer.from("nor this"), poster: thumb, scrub: sprite });
const f23 = addFile({ name: "robot_v003.exr", size: 12345, mime: "image/x-exr", kind: "image", width: 4096, height: 2304, duration: null, fps: null, originalDeleted: true,
  renditions: { web: { mime: "image/webp", size: web23.length, width: 2048, height: 1152 }, thumb: { mime: "image/webp", size: thumb.length, width: 480, height: 270 } } },
  { web: web23, thumb });

const recs = new Map();   // "type:id" -> record
function addRec(type, id, fields, projectId, at){ const r = { type, id, version: 1, projectId: projectId == null ? null : projectId, createdAt: new Date(T0 + at * 1000).toISOString(), updatedAt: new Date(T0 + at * 1000 + 500).toISOString(), deleted: false, fields }; recs.set(type + ":" + id, r); return r; }
addRec("project", 1, { name: "Demo" }, null, 0);
addRec("shot", 11, { code: "sh010" }, 1, 1);
addRec("asset", 12, { code: "robot" }, 1, 2);
addRec("person", 5, { name: "Ann Lee" }, null, 3);
const fileVal = (id) => { const m = files.get(id).meta; return { id, name: m.name, size: m.size, mime: m.mime }; };
addRec("version", 21, { code: "sh010_comp_v001", entity: { type: "shot", id: 11 }, status: "rev", artist: { type: "person", id: 5 }, media: fileVal(f21), first_frame: 1001, fps: 24, description: "Comp pass" }, 1, 10);
addRec("version", 22, { code: "sh020_anim_v002", entity: { type: "shot", id: 11 }, status: "pend", media: fileVal(f22), fps: 24 }, 1, 20);
const f24 = addFile({ name: "sh030_light_v001.png", size: orig21.length, mime: "image/png", kind: "image", width: 64, height: 36, duration: null, fps: null,
  renditions: { web: { mime: "image/webp", size: web21.length, width: 64, height: 36 }, thumb: { mime: "image/webp", size: thumb.length, width: 32, height: 18 } } },
  { original: orig21, web: web21, thumb });
addRec("version", 24, { code: "sh030_light_v001", entity: { type: "shot", id: 11 }, status: "rev", media: fileVal(f24) }, 1, 5);
addRec("version", 23, { code: "robot_v003", entity: { type: "asset", id: 12 }, status: "apr", media: fileVal(f23) }, 1, 30);

// ---- the filter language (ADR-0006, the part the adapter sends) ---------------------------------------------------
function valueAt(rec, path){
  let cur = rec;
  const segs = path.split(".");
  for (let i = 0; i < segs.length; i++){
    if (!cur) return null;
    const [key, want] = segs[i].split(":");
    let v = key === "project" ? (cur.projectId != null ? { type: "project", id: cur.projectId } : null) : cur.fields[key];
    if (i === segs.length - 1) return v === undefined ? null : v;
    if (!v || typeof v !== "object" || (want && v.type !== want)) return null;
    cur = recs.get(v.type + ":" + v.id) || null;
  }
  return null;
}
const sameRef = (a, b) => a && b && typeof a === "object" && a.type === b.type && Number(a.id) === Number(b.id);
function test(rec, n){
  if (Array.isArray(n.and)) return n.and.every((x) => test(rec, x));
  if (Array.isArray(n.or)) return n.or.some((x) => test(rec, x));
  if (n.not) return !test(rec, n.not);
  const v = valueAt(rec, n.field), w = n.value;
  const s = (x) => x == null ? "" : String(x).toLowerCase();
  switch (n.op){
    case "is_null": return v == null || v === "";
    case "is_not_null": return !(v == null || v === "");
    case "is": return typeof w === "object" && w ? sameRef(v, w) : v === w;
    case "is_not": return !(typeof w === "object" && w ? sameRef(v, w) : v === w);
    case "in": return w && w.myProjects ? true : (w || []).some((x) => typeof x === "object" ? sameRef(v, x) : v === x);
    case "not_in": return !(w || []).some((x) => typeof x === "object" ? sameRef(v, x) : v === x);
    case "contains": return v != null && s(v).includes(s(w));
    case "not_contains": return v == null || !s(v).includes(s(w));
    case "starts_with": return typeof v === "string" && v.startsWith(w);
    case "ends_with": return typeof v === "string" && v.endsWith(w);
    case "gt": return v != null && v > w;
    case "gte": return v != null && v >= w;
    case "lt": return v != null && v < w;
    case "lte": return v != null && v <= w;
    case "between": return v != null && v >= w[0] && v <= w[1];
    default: throw Object.assign(new Error("unknown op " + n.op), { status: 400 });
  }
}

// ---- reviews -------------------------------------------------------------------------------------------------------
const reviews = new Map();   // "type:id:field" -> {rows: Map id -> row (tombstones with deleted_at), shots: {sid: fileId}, seq}
const review = (k) => { if (!reviews.has(k)) reviews.set(k, { rows: new Map(), shots: {}, seq: 0 }); return reviews.get(k); };
const uploads = new Map();   // id -> {name, size, mime, buf, done}
function signed(fid, kind){ return `/api/media/${fid}/${kind}?exp=9999999999&sig=sig${fid}${kind}`; }
function shotsOut(rv){ const o = {}; for (const [sid, fid] of Object.entries(rv.shots)){ const f = files.get(fid); o[sid] = { file: fid, url: signed(fid, "original"), mime: f.meta.mime, width: null, height: null }; } return o; }
function merge(k, rows, deleted){
  const rv = review(k);
  const before = new Map([...rv.rows].map(([id, r]) => [id, JSON.stringify(r)]));
  const m = RC.mergeRows([...rv.rows.values()], rows || [], { deleted: deleted || [], now: Date.now() });
  const changed = [];
  m.rows.forEach((r) => { if (before.get(r.id) !== JSON.stringify(r)){ rv.rows.set(r.id, r); changed.push(r); } });
  if (changed.length) rv.seq = ++seq;
  return { changed, stats: m.stats, seq: changed.length ? rv.seq : null };
}

function describe(rec, field){
  const v = rec.fields[field];
  if (!v || typeof v !== "object" || !files.has(v.id)) return null;
  const f = files.get(v.id), urls = {};
  for (const k of Object.keys(f.bytes)) urls[k] = signed(v.id, k);
  return Object.assign({}, f.meta, { urls, expiresAt: new Date(Date.now() + 6 * 3600e3).toISOString() });
}

const srv = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const buf = Buffer.concat(chunks);
  const u = new URL(req.url, "http://x");
  const p = u.pathname;
  const send = (status, body, type) => { res.writeHead(status, { "Content-Type": type || "application/json" }); res.end(type ? body : JSON.stringify(body)); };
  const fail = (status, code, message) => send(status, { error: { code, message } });
  const auth = req.headers.authorization || "";
  log.push({ method: req.method, path: p, auth, range: req.headers["content-range"] || "" });
  try {
    if (p === "/__fake/db") return send(200, { reviews: Object.fromEntries([...reviews].map(([k, rv]) => [k, { rows: [...rv.rows.values()], shots: rv.shots, seq: rv.seq }])),
      uploads: [...uploads.values()].map((x) => ({ name: x.name, size: x.size, got: x.buf.length, done: x.done })) });
    if (p === "/__fake/log") return send(200, log);
    let m = /^\/__fake\/merge\/([a-z_]+)\/(\d+)\/([a-z_]+)$/.exec(p);
    if (m && req.method === "POST"){ const b = JSON.parse(buf.toString() || "{}"); return send(200, merge(`${m[1]}:${m[2]}:${m[3]}`, b.rows, b.deleted)); }
    // signed media: no Bearer needed (nor read)
    m = /^\/api\/media\/(\d+)\/([a-z]+)$/.exec(p);
    if (m){
      const f = files.get(Number(m[1]));
      if (!f || u.searchParams.get("sig") !== `sig${m[1]}${m[2]}` || !f.bytes[m[2]]) return fail(403, "forbidden", "bad signature");
      const mime = m[2] === "original" ? f.meta.mime : ((f.meta.renditions || {})[m[2]] || {}).mime || "application/octet-stream";
      return send(200, f.bytes[m[2]], mime);
    }
    if (auth !== "Bearer " + KEY) return fail(401, "unauthorized", "Sign in first");
    if (p === "/api/auth/me") return send(200, { user: { id: 3, login: "bob", display: "Bob Smith" }, via: "api_key" });
    if (p.startsWith("/api/auth/")) return send(200, { token: "LEAKED" });   // (Sight must never forward these)
    if (p === "/api/schema") return send(200, schema);
    if (p === "/api/me/projects") return send(200, { projects: [{ id: 1, display: "Demo", fields: { name: "Demo" } }] });
    if (p === "/api/query" && req.method === "POST"){
      const b = JSON.parse(buf.toString() || "{}");
      if (b.sort && !Array.isArray(b.sort)) return fail(400, "invalid", "sort");
      let list = [...recs.values()].filter((r) => r.type === b.type && !r.deleted && (!b.filter || test(r, b.filter)));
      list.sort((a, c) => c.createdAt.localeCompare(a.createdAt));
      if (Array.isArray(b.sort) && b.sort[0] && b.sort[0].field !== "createdAt"){ const k = b.sort[0].field; list.sort((a, c) => String(a.fields[k]).localeCompare(String(c.fields[k]))); }
      const off = Number(b.cursor || 0), lim = Math.min(Number(b.limit) || 100, 500);
      const page = list.slice(off, off + lim).map((r) => {
        if (!Array.isArray(b.columns)) return r;
        const columns = {};
        b.columns.forEach((k) => { const v = r.fields[k]; columns[k] = v && typeof v === "object" && v.type ? ((recs.get(v.type + ":" + v.id) || {}).fields || {}).code || ((recs.get(v.type + ":" + v.id) || {}).fields || {}).name || null : v == null ? null : v; });
        return Object.assign({}, r, { columns });
      });
      return send(200, { records: page, nextCursor: off + lim < list.length ? String(off + lim) : null });
    }
    m = /^\/api\/records\/([a-z_]+)\/(\d+)(?:\/files\/([a-z_]+))?$/.exec(p);
    if (m && req.method === "GET"){
      const rec = recs.get(m[1] + ":" + m[2]);
      if (!rec) return fail(404, "not_found", "No such record");
      if (!m[3]) return send(200, rec);
      const d = describe(rec, m[3]);
      return d ? send(200, d) : fail(404, "not_found", "No file");
    }
    if (p === "/api/uploads" && req.method === "POST"){
      const b = JSON.parse(buf.toString() || "{}");
      const id = "up" + (uploads.size + 1);
      uploads.set(id, { name: b.name, size: b.size, mime: b.mime, buf: Buffer.alloc(0), done: false });
      return send(200, { id, received: 0, size: b.size, chunkSize: 64 });   // (tiny chunks: the test sees several PUTs)
    }
    m = /^\/api\/uploads\/([a-z0-9]+)(\/complete)?$/.exec(p);
    if (m){
      const up = uploads.get(m[1]);
      if (!up) return fail(404, "not_found", "No such upload");
      if (!m[2] && req.method === "PUT"){
        const cr = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(req.headers["content-range"] || "");
        if (!cr || Number(cr[1]) !== up.buf.length || Number(cr[2]) - Number(cr[1]) + 1 !== buf.length) return fail(400, "invalid", "Content-Range");
        up.buf = Buffer.concat([up.buf, buf]);
        return send(200, { id: m[1], received: up.buf.length, size: up.size });
      }
      if (m[2] && req.method === "POST"){
        if (up.buf.length !== up.size) return fail(400, "invalid", "incomplete");
        up.done = true;
        up.fileId = addFile({ name: up.name, size: up.size, mime: up.mime, kind: "image", width: null, height: null, renditions: {} }, { original: up.buf });
        return send(200, { id: up.fileId, status: "ready" });
      }
    }
    m = /^\/api\/review\/([a-z_]+)\/(\d+)\/([a-z_]+)(\/merge|\/shots\/([0-9a-f]{16}))?$/.exec(p);
    if (m){
      const rec = recs.get(m[1] + ":" + m[2]);
      if (!rec || !(m[3] in rec.fields)) return fail(404, "not_found", "No such review");
      const k = `${m[1]}:${m[2]}:${m[3]}`, rv = review(k);
      if (!m[4] && req.method === "GET"){
        const all = [...rv.rows.values()];
        return send(200, { target: { type: m[1], id: Number(m[2]), field: m[3] }, file: describe(rec, m[3]),
          rows: all.filter((r) => r.deleted_at == null), deleted: all.filter((r) => r.deleted_at != null).map((r) => ({ id: r.id, deleted_at: r.deleted_at })),
          shots: shotsOut(rv), seq: rv.seq });
      }
      if (m[4] === "/merge" && req.method === "POST"){
        const b = JSON.parse(buf.toString() || "{}");
        if ((b.rows || []).some((r) => !/^[0-9a-f]{16}$/.test(String(r.id)))) return fail(400, "invalid", "ids");
        return send(200, merge(k, b.rows, b.deleted));
      }
      if (m[5] && req.method === "PUT"){
        const b = JSON.parse(buf.toString() || "{}");
        const f = files.get(Number(b.file));
        if (!f || !/^image\/(jpeg|png)$/.test(f.meta.mime)) return fail(400, "invalid", "JPEG / PNG only");
        if (rv.shots[m[5]] !== undefined) return rv.shots[m[5]] === Number(b.file) ? send(200, { created: false, seq: rv.seq }) : fail(409, "conflict", "another picture");
        rv.shots[m[5]] = Number(b.file); rv.seq = ++seq;
        return send(201, { created: true, seq: rv.seq });
      }
    }
    return fail(404, "not_found", "No route " + req.method + " " + p);
  } catch (e){ return fail(e.status || 500, e.status ? "invalid" : "internal", String(e && e.message || e)); }
});
srv.listen(Number(process.argv[2] || 0), "127.0.0.1", () => {
  console.log(JSON.stringify({ site: "http://127.0.0.1:" + srv.address().port }));
});
