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
  fake.add("Version", { id: 77, code: "sh010_comp_v003", project: { type: "Project", id: 70, name: "Demo" }, sg_task: { type: "Task", id: 55 }, sg_first_frame: 1001 });
  console.log(JSON.stringify({ site }));
});
