// The fake ShotGrid (tests/sg_fake.cjs) as an HTTP server on 127.0.0.1 — for tests/test_shotgrid.py (Sight's
// /api/sg/fetch) and the Playwright tests. Prints {"site": "http://127.0.0.1:<port>"} once listening.
// Seeds: HumanUser bob, Project 70 "Demo", Version 77 "sh010_comp_v003" (first frame 1001, task 55).
// GET <site>/__fake/db -> every record (for assertions); POST <site>/__fake/add {type, ...fields} -> adds one.
"use strict";
const http = require("http");
const { createFakeShotGrid } = require("./sg_fake.cjs");

const srv = http.createServer();
let fake;
srv.on("request", async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const buf = Buffer.concat(chunks);
  try {
    if (req.method === "OPTIONS"){  // a site that answers browsers from any origin (the phone app's direct mode)
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE" });
      res.end(); return;
    }
    if (req.url === "/__fake/db"){
      const out = {}; for (const [k, m] of Object.entries(fake.db)) out[k] = [...m.values()];
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(out)); return;
    }
    if (req.url === "/__fake/add" && req.method === "POST"){
      const b = JSON.parse(buf.toString()); const type = b.type; delete b.type;
      if (b.file){ b.this_file = fake.addFile(b.file.name, Buffer.from(b.file.base64, "base64"), b.file.type); delete b.file; }
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(fake.add(type, b))); return;
    }
    const headers = {}; for (const [k, v] of Object.entries(req.headers)) headers[k] = v;
    const init = { method: req.method, headers };
    if (buf.length) init.body = /json|form-urlencoded/.test(headers["content-type"] || "") ? buf.toString() : new Blob([buf], { type: headers["content-type"] || "" });
    const r = await fake.fetch(fake.site + req.url, init);
    const body = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, { "Content-Type": r.headers.get("content-type") || "application/octet-stream", "Access-Control-Allow-Origin": "*" });
    res.end(body);
  } catch (e){ res.writeHead(500); res.end(String(e && e.stack || e)); }
});
srv.listen(Number(process.argv[2] || 0), "127.0.0.1", () => {
  const site = "http://127.0.0.1:" + srv.address().port;
  fake = createFakeShotGrid({ site, storage: site + "/storage/" });
  fake.add("HumanUser", { id: 7, login: "bob", name: "Bob Smith" });
  fake.add("Project", { id: 70, name: "Demo", archived: false });
  // a project tree for the browser: Shots sh010 / sh020, an Asset, Versions with pictures (PNG thumbnails, a proxy)
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  fake.add("Shot", { id: 501, code: "sh010", project: { type: "Project", id: 70 } });
  fake.add("Shot", { id: 502, code: "sh020", project: { type: "Project", id: 70 } });
  fake.add("Asset", { id: 601, code: "robot", project: { type: "Project", id: 70 } });
  const thumb = () => fake.addFile("t.png", png, "image/png").url;
  // a filmstrip of 4 frames, 240 px each (ShotGrid's layout), in four colours
  const zlib = require("zlib");
  const crc = (b) => { let c = ~0; for (const x of b){ c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const W = 960, H = 135, cols = [[220, 40, 40], [40, 200, 60], [40, 80, 220], [230, 200, 40]];
  const rows = []; for (let y = 0; y < H; y++){ const r = Buffer.alloc(1 + W * 3); for (let x = 0; x < W; x++){ const c = cols[Math.floor(x / 240)]; r[1 + x * 3] = c[0]; r[2 + x * 3] = c[1]; r[3 + x * 3] = c[2]; } rows.push(r); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  const stripPng = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
  const strip = () => fake.addFile("strip.png", stripPng, "image/png").url;
  fake.add("Version", { id: 78, code: "sh020_anim_v001", project: { type: "Project", id: 70, name: "Demo" }, entity: { type: "Shot", id: 502, name: "sh020" }, sg_status_list: "rev", image: thumb(), filmstrip_image: strip(), description: "Blocking pass",
    sg_uploaded_movie: Object.assign(fake.addFile("sh020_anim_v001.png", png, "image/png"), { name: "sh020_anim_v001.png" }) });
  fake.add("Version", { id: 79, code: "robot_model_v002", project: { type: "Project", id: 70, name: "Demo" }, entity: { type: "Asset", id: 601, name: "robot" }, sg_status_list: "apr", image: thumb() });
  fake.add("Version", { id: 77, code: "sh010_comp_v003", entity: { type: "Shot", id: 501, name: "sh010" }, sg_status_list: "rev", image: thumb(), project: { type: "Project", id: 70, name: "Demo" }, sg_task: { type: "Task", id: 55 }, sg_first_frame: 1001 });
  console.log(JSON.stringify({ site }));
});
