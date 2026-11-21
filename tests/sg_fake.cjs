// A fake ShotGrid REST API (the part shotgrid-core.js uses), as a fetch-like function — for tests/sg_unit.cjs
// and, through tests/sg_fake_server.cjs, for Sight / phone end-to-end tests. In memory; nothing is checked
// beyond what a real site would refuse in our use (bad key, unknown record).
"use strict";

function createFakeShotGrid(opts){
  opts = opts || {};
  const site = (opts.site || "https://studio.shotgrid.example").replace(/\/+$/, "");
  const script = opts.script || "sight", key = opts.key || "secret";
  const db = { Project: new Map(), Version: new Map(), Note: new Map(), Reply: new Map(), Attachment: new Map(), HumanUser: new Map(), Shot: new Map(), Asset: new Map(), Sequence: new Map() };
  const storage = opts.storage || "https://storage.example/";  // where upload / download links point
  const files = new Map();  // upload id -> {bytes, type}
  const log = [];
  let nextId = 1000, clock = opts.clock || Date.parse("2026-11-20T10:00:00Z");
  const now = () => new Date(clock += 1000).toISOString().replace(/\.\d+Z$/, "Z");
  const tokens = new Map();  // token -> sudo login
  const plural = { projects: "Project", versions: "Version", notes: "Note", replies: "Reply", attachments: "Attachment", human_users: "HumanUser", shots: "Shot", assets: "Asset", sequences: "Sequence" };
  const ENTITY_FIELDS = new Set(["project", "entity", "sg_task", "user", "note_links", "tasks", "attachments"]);

  function add(type, f){ const id = f.id || nextId++; const r = Object.assign({ type, id, created_at: now(), updated_at: now() }, f, { id }); db[type].set(id, r); return r; }
  function userFor(login){
    if (!login) return { type: "ApiUser", id: 1, name: script };
    for (const u of db.HumanUser.values()) if (u.login === login) return { type: "HumanUser", id: u.id, name: u.name };
    return null;
  }
  function out(r, fields){
    const attributes = {}, relationships = {};
    const keys = fields && fields.length ? fields : Object.keys(r).filter((k) => k !== "type" && k !== "id");
    keys.forEach((k) => {
      if (k === "attachments" && r.type === "Note"){
        relationships.attachments = { data: [...db.Attachment.values()].filter((a) => a.note === r.id).map((a) => ({ type: "Attachment", id: a.id, name: a.this_file.name })) };
      } else if (ENTITY_FIELDS.has(k)) relationships[k] = { data: r[k] === undefined ? null : r[k] };
      else attributes[k] = r[k] === undefined ? null : r[k];
    });
    return { type: r.type, id: r.id, attributes, relationships, links: { self: "/x" } };
  }
  const same = (a, b) => a && b && a.type === b.type && Number(a.id) === Number(b.id);
  function match(r, [field, op, val]){
    let v = r[field];
    if (field === "attachments") v = [...db.Attachment.values()].filter((a) => a.note === r.id).map((a) => ({ type: "Attachment", id: a.id }));
    if (op === "is"){
      if (Array.isArray(v)) return v.some((x) => same(x, val));
      if (val && typeof val === "object") return same(v, val);
      return v === val;
    }
    if (op === "in"){
      return val.some((x) => (x && typeof x === "object") ? (Array.isArray(v) ? v.some((y) => same(y, x)) : same(v, x)) : v === x);
    }
    if (op === "type_is") return !!(v && v.type === val);
    if (op === "contains") return String(v || "").toLowerCase().includes(String(val).toLowerCase());
    throw new Error("fake: op " + op);
  }
  const json = (status, body) => new Response(body == null ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  async function fetchFn(input, init){
    init = init || {};
    let u = String(input);
    if (opts.via && u.startsWith(opts.via)) u = decodeURIComponent(u.slice(opts.via.length));
    const method = (init.method || "GET").toUpperCase();
    const h = {}; Object.entries(init.headers || {}).forEach(([k, v]) => { h[k.toLowerCase()] = v; });
    log.push(method + " " + u.replace(site, ""));
    if (u.startsWith(storage)){
      const id = u.split("/").pop().split("?")[0];
      if (method === "PUT"){ const b = init.body; files.set(id, { bytes: Buffer.from(await b.arrayBuffer()), type: h["content-type"] }); return new Response(null, { status: 200 }); }
      const f = files.get(id); if (!f) return new Response("no", { status: 404 });
      return new Response(f.bytes, { status: 200, headers: { "Content-Type": f.type || "image/jpeg" } });
    }
    if (!u.startsWith(site + "/api/v1.1/")) return json(404, { errors: [{ title: "not found " + u }] });
    const path = u.slice((site + "/api/v1.1").length);
    if (path === "/auth/access_token"){
      const f = new URLSearchParams(init.body);
      if (f.get("grant_type") === "refresh_token"){
        const t = "t" + nextId++; tokens.set(t, tokens.get(f.get("refresh_token").slice(1))); return json(200, { token_type: "Bearer", access_token: t, expires_in: 600, refresh_token: "r" + t });
      }
      if (f.get("client_id") !== script || f.get("client_secret") !== key) return json(400, { errors: [{ title: "Invalid credentials" }] });
      const sudo = f.get("sudo_as_login") || "";
      if (sudo && !userFor(sudo)) return json(400, { errors: [{ title: "Cannot sudo as " + sudo }] });
      const t = "t" + nextId++; tokens.set(t, sudo);
      return json(200, { token_type: "Bearer", access_token: t, expires_in: 600, refresh_token: "r" + t });
    }
    const auth = (h.authorization || "").replace(/^Bearer /, "");
    if (!tokens.has(auth)) return json(401, { errors: [{ title: "Unauthorized" }] });
    if (path.startsWith("/schema/versions/fields")){
      const fld = (name, data_type) => ({ name: { value: name }, data_type: { value: data_type }, visible: { value: true } });
      return json(200, { data: { code: fld("Version Name", "text"), sg_status_list: fld("Status", "status_list"), user: fld("Artist", "entity"),
        entity: fld("Link", "entity"), description: fld("Description", "text"), created_at: fld("Date Created", "date_time"),
        image: fld("Thumbnail", "image"), filmstrip_image: fld("Filmstrip Thumbnail", "image"), sg_uploaded_movie: fld("Uploaded Movie", "url"), id: fld("Id", "number") } });
    }
    const actor = userFor(tokens.get(auth));
    const body = init.body && typeof init.body === "string" ? JSON.parse(init.body) : null;
    const parts = path.split("?")[0].split("/").filter(Boolean);  // entity, <type>, <id|_search>, [_upload]
    const qs = new URLSearchParams(path.split("?")[1] || "");
    const type = plural[parts[1]];
    if (!type) return json(404, { errors: [{ title: "Unknown entity " + parts[1] }] });
    const fieldsOpt = (qs.get("options[fields]") || qs.get("fields") || "").split(",").filter(Boolean);
    if (parts[2] === "_search" && method === "POST"){
      let list = [...db[type].values()].filter((r) => (body.filters || []).every((f) => match(r, f)));
      if (body.sort){ const desc = body.sort[0] === "-", k = body.sort.replace(/^-/, ""); list.sort((x, y) => (x[k] > y[k] ? 1 : x[k] < y[k] ? -1 : 0) * (desc ? -1 : 1)); }
      const size = (body.page && body.page.size) || 500, num = (body.page && body.page.number) || 1;
      const page = list.slice((num - 1) * size, num * size);
      return json(200, { data: page.map((r) => out(r, body.fields)), links: { self: "/x", next: list.length > num * size ? "/next" : undefined } });
    }
    if (!parts[2] && method === "POST"){
      if (type === "Note" && body.sg_status_list && opts.noteStatuses && !opts.noteStatuses.includes(body.sg_status_list)) return json(400, { errors: [{ title: "Invalid value for sg_status_list" }] });
      const r = add(type, Object.assign({}, body, { user: actor, created_by: actor }));
      if (type === "Note" && r.sg_status_list === undefined && opts.noteDefault) r.sg_status_list = opts.noteDefault;
      if (type === "Reply"){ const n = db.Note.get(body.entity.id); if (n) n.updated_at = now(); }
      return json(201, { data: out(r, fieldsOpt.length ? fieldsOpt : null) });
    }
    const id = Number(parts[2]), rec = db[type].get(id);
    if (!rec) return json(404, { errors: [{ title: "Record not found" }] });
    if (parts[3] === "_upload"){
      if (method === "GET"){
        const up = "u" + nextId++;
        return json(200, { data: { upload_id: up, original_filename: qs.get("filename"), upload_type: "Attachment" }, links: { upload: storage + up, complete_upload: "/api/v1.1/entity/" + parts[1] + "/" + id + "/_upload" } });
      }
      const f = files.get(body.upload_info.upload_id);
      if (!f) return json(400, { errors: [{ title: "nothing uploaded" }] });
      const att = add("Attachment", { note: id, filename: body.upload_info.original_filename, this_file: { name: body.upload_info.original_filename, url: storage + body.upload_info.upload_id, content_type: f.type, link_type: "upload" } });
      return json(201, { data: out(att, ["filename"]) });
    }
    if (method === "GET") return json(200, { data: out(rec, fieldsOpt.length ? fieldsOpt : null) });
    if (method === "PUT" && type === "Note" && body.sg_status_list && opts.noteStatuses && !opts.noteStatuses.includes(body.sg_status_list)) return json(400, { errors: [{ title: "Invalid value for sg_status_list" }] });
    if (opts.failPut && opts.failPut(type, body)) return json(500, { errors: [{ title: "boom" }] });
    if (method === "PUT"){ Object.assign(rec, body, { updated_at: now() }); return json(200, { data: out(rec, fieldsOpt.length ? fieldsOpt : null) }); }
    if (method === "DELETE"){ db[type].delete(id); return new Response(null, { status: 204 }); }
    return json(405, { errors: [{ title: "method" }] });
  }

  // a picture on the fake storage, for notes made "on ShotGrid" in tests
  function addFile(name, bytes, type){
    const up = "f" + nextId++; files.set(up, { bytes: Buffer.from(bytes), type: type || "image/png" });
    return { name, url: storage + up, content_type: type || "image/png", link_type: "upload" };
  }
  return { site, script, key, db, add, addFile, fetch: fetchFn, log, files, now };
}
module.exports = { createFakeShotGrid };
