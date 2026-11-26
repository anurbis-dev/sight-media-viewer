// Coreline sync through Sight's own server: coreline-core.js with every request through /api/trackers/coreline/fetch
// (the API key stays in Sight), rows from /api/annotations, merges through /api/review/import, the link / state in
// /api/trackers/coreline/link — what annotate.js does, without the browser. The fake Coreline merges with the same
// review-core.js mergeRows Coreline vendors. Run by tests/test_coreline.py:
//   node tests/cl_sight.cjs <sightBase> <assetId> <fakeSite>
"use strict";
const assert = require("assert");
require("../app/static/filter-core.js");   // (globalThis.SightFilter: Filter ▾'s conditions)
const CL = require("../app/static/coreline-core.js");

const [base, aid, fakeSite] = process.argv.slice(2);
const X = { "X-Sight": "1" };
const j = async (r) => { if (!r.ok) throw new Error(r.status + " " + await r.text()); return r.json(); };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const via = base + "/api/trackers/coreline/fetch?url=";

(async () => {
  // the pass-through: Sight's page only, never the account routes, https only elsewhere
  let r = await fetch(via + encodeURIComponent(fakeSite + "/api/schema"));
  assert.strictEqual(r.status, 403, "no X-Sight: refused");
  for (const [m, p] of [["POST", "/api/auth/api-keys"], ["GET", "/api/auth/api-keys"], ["POST", "/api/auth/login"], ["DELETE", "/api/auth/api-keys/1"], ["GET", "/api/%61uth/api-keys"],
    ["GET", "/api/x/../auth/api-keys"], ["POST", "/api/schema/%2e%2e/auth/api-keys"], ["GET", "/api//auth/api-keys"]]){
    r = await fetch(via + encodeURIComponent(fakeSite + p), { method: m, headers: X });
    assert.strictEqual(r.status, 400, m + " " + p + " refused");
    assert.ok(!(await r.text()).includes("LEAKED"));
  }
  r = await fetch(via + encodeURIComponent(fakeSite + "/api/auth/me"), { headers: X });
  assert.strictEqual(r.status, 200, "who the key is: allowed (Test)");
  r = await fetch(via + encodeURIComponent("http://example.com/x"), { headers: X });
  assert.strictEqual(r.status, 400, "plain http elsewhere refused");

  const st = await j(await fetch(base + "/api/trackers/coreline/status"));
  assert.strictEqual(st.configured, true);
  assert.ok(!JSON.stringify(st).includes("clkey"), "the key never reaches the page");
  const client = CL.createClient({ site: st.site, via, headers: X });
  assert.deepStrictEqual((await CL.adapter.projects(client)).map((p) => p.name), ["Demo"]);

  // browsing: newest first, the quick filters, Filter ▾ conditions, display columns, paging by cursor
  const names = (vs) => vs.map((v) => CL.adapter.recordName(v));
  assert.deepStrictEqual(names(await CL.browseVersions(client, { project: 1 }, ["code", "status", "artist"], 1, 100)), ["robot_v003", "sh020_anim_v002", "sh010_comp_v001", "sh030_light_v001"]);
  assert.deepStrictEqual(names(await CL.browseVersions(client, { project: 1, status: "rev" }, [], 1, 100)), ["sh010_comp_v001", "sh030_light_v001"]);
  assert.deepStrictEqual(names(await CL.browseVersions(client, { project: 1, type: "asset" }, [], 1, 100)), ["robot_v003"]);
  assert.deepStrictEqual(names(await CL.browseVersions(client, { project: 1, type: "shot", entity: "11" }, [], 1, 100)), ["sh020_anim_v002", "sh010_comp_v001", "sh030_light_v001"]);
  assert.deepStrictEqual(names(await CL.browseVersions(client, { project: 1, q: "anim" }, [], 1, 100)), ["sh020_anim_v002"]);
  assert.deepStrictEqual((await CL.adapter.entities(client, 1, "shot")).map((e) => e.name), ["sh010"]);
  const fields = await CL.adapter.mediaFields(client);
  assert.ok(!fields.some((f) => f.name === "media" || f.name === "thumbnail"), "file / picture fields are not tile captions");
  const status = fields.find((f) => f.name === "status");
  assert.deepStrictEqual(status.values, ["pend", "rev", "rtk", "apr"]);
  const ff = CL.adapter.filterFields(fields, {});
  const cond = CL.adapter.toConditions({ op: "or", c: [{ f: "entity", o: "contains", v: "robot" }, { f: "status", o: "is", v: "pend" }] }, ff);
  assert.deepStrictEqual(names(await CL.browseVersions(client, { project: 1 }, [], 1, 100, cond)), ["robot_v003", "sh020_anim_v002"]);
  const p1 = await CL.browseVersions(client, { project: 1 }, ["artist"], 1, 2), p2 = await CL.browseVersions(client, { project: 1 }, ["artist"], 2, 2);
  assert.deepStrictEqual([names(p1), names(p2)], [["robot_v003", "sh020_anim_v002"], ["sh010_comp_v001", "sh030_light_v001"]]);
  assert.deepStrictEqual(await CL.browseVersions(client, { project: 1 }, ["artist"], 3, 2), [], "past the last page: nothing");
  assert.strictEqual(CL.adapter.fmtField(p2[0], "artist"), "Ann Lee", "a link field shows its display column");
  assert.strictEqual(CL.adapter.recordId(p2[0]), "version:21:media");
  assert.ok(CL.adapter.isVideo(p1[1]) && !CL.adapter.isVideo(p2[0]));

  // link this file to Version 21's media field
  const link = await CL.adapter.loadLink(client, "version:21:media");
  assert.deepStrictEqual([link.type, link.id, link.field, link.code, link.site], ["version", 21, "media", "sh010_comp_v001", CL.siteHost(st.site)]);
  await j(await fetch(base + "/api/trackers/coreline/link/" + aid, { method: "PUT", headers: Object.assign({ "Content-Type": "application/json" }, X), body: JSON.stringify({ link }) }));
  const asset = await j(await fetch(base + "/api/assets/" + aid));
  let saved = await j(await fetch(base + "/api/trackers/coreline/link/" + aid));
  assert.strictEqual(saved.link.code, "sh010_comp_v001");

  // another reviewer's note already on Coreline
  const t0 = Date.now() - 30000;
  await j(await fetch(fakeSite + "/__fake/merge/version/21/media", { method: "POST", body: JSON.stringify({ rows: [
    { id: "c0ffee0000000001", kind: "note", shape_kind: null, x: null, y: null, w: null, h: null, rotation: 0, z_index: 0, color: null, locked: 0,
      data: { text: "From Coreline", author: "Ann Lee", created: t0, status: "open", status_at: t0, edited_at: t0, ctx: { t: 0.5, hold: 0 }, shots: [], replies: [] },
      created_at: t0, updated_at: t0 },
    { id: "c0ffee0000000002", kind: "stroke", shape_kind: "brush", x: 10, y: 10, w: 20, h: 5, rotation: 0, z_index: 1, color: "#ff0000", locked: 0,
      data: { note: "c0ffee0000000001", color: "#ff0000", size: 4, pts: [10, 10, 1, 30, 15, 1], ctx: { t: 0.5, hold: 0 } }, created_at: t0, updated_at: t0 },
  ] }) }));

  const getRows = async () => j(await fetch(base + "/api/annotations?asset_id=" + aid + "&deleted=1"));
  const importPackage = async (pkg) => j(await fetch(base + "/api/review/import", { method: "POST", body: JSON.stringify(pkg) }));
  // Sight's pictures: the local note's attached picture (Sight's own /api/review/shots in the page)
  const localShot = async (id) => id === "5ba7000000000001" ? new Blob([PNG], { type: "image/png" }) : null;
  const opts = (state) => ({ client, link: saved.link, asset, fps: 24, state, settings: st, getRows, importPackage, localShot });

  const res = await CL.adapter.sync(opts(saved.state));
  assert.deepStrictEqual(res.errors, []);
  assert.strictEqual(res.pulled.added, 2, "Coreline's note + its drawing");
  assert.strictEqual(res.pushed.notes, 1, "our note sent");
  assert.strictEqual(res.pushed.pictures, 1, "its picture uploaded");
  await j(await fetch(base + "/api/trackers/coreline/link/" + aid, { method: "PUT", headers: Object.assign({ "Content-Type": "application/json" }, X), body: JSON.stringify({ state: res.state }) }));

  let rows = await getRows();
  const pulled = rows.find((x) => x.id === "c0ffee0000000001");
  assert.ok(pulled && pulled.data.text === "From Coreline" && pulled.data.author === "Ann Lee", "Coreline's note in Sight, author kept");
  assert.deepStrictEqual(rows.find((x) => x.id === "c0ffee0000000002").data.pts, [10, 10, 1, 30, 15, 1], "drawings travel as rows, geometry unchanged");
  let db = await j(await fetch(fakeSite + "/__fake/db"));
  let rv = db.reviews["version:21:media"];
  const mine = rv.rows.find((x) => x.id === "a".repeat(16));
  assert.ok(mine && mine.data.text === "Mine" && mine.data.author === "Bob Smith", "our note on Coreline with its author");
  assert.ok(rv.shots["5ba7000000000001"], "the picture is a Coreline shot under our shot id");
  assert.ok(db.uploads.length === 1 && db.uploads[0].done && db.uploads[0].got === PNG.length, "uploaded in Content-Range chunks");
  const lg = await j(await fetch(fakeSite + "/__fake/log"));
  assert.ok(lg.filter((x) => x.path.startsWith("/api/review/")).every((x) => x.auth === "Bearer clkey"), "Sight's server adds the key");
  assert.ok(lg.filter((x) => x.path.startsWith("/api/uploads/") && x.method === "PUT").length > 1 && lg.some((x) => x.range), "chunks with Content-Range");
  assert.ok(!lg.some((x) => x.path.startsWith("/api/auth/") && x.path !== "/api/auth/me"), "no account route reached Coreline");

  // second sync: nothing to do either way
  saved = await j(await fetch(base + "/api/trackers/coreline/link/" + aid));
  const again = await CL.adapter.sync(opts(saved.state));
  assert.deepStrictEqual(again.errors, []);
  assert.deepStrictEqual([again.pulled, again.pushed], [{ added: 0, updated: 0 }, { notes: 0, updated: 0, replies: 0, pictures: 0 }]);

  // a reply written on Coreline, our note's text edited here: both land
  const later = Date.now();
  await j(await fetch(fakeSite + "/__fake/merge/version/21/media", { method: "POST", body: JSON.stringify({ rows: [Object.assign({}, rv.rows.find((x) => x.id === "c0ffee0000000001"),
    { data: Object.assign({}, rv.rows.find((x) => x.id === "c0ffee0000000001").data, { replies: [{ id: "abcabc0000000001", text: "Agreed", author: "Ann Lee", created: later }] }) })] }) }));
  await j(await fetch(base + "/api/annotations/" + "a".repeat(16), { method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: Object.assign({}, rows.find((x) => x.id === "a".repeat(16)).data, { text: "Mine, edited", edited_at: later + 5 }) }) }));
  const third = await CL.adapter.sync(opts(again.state));
  assert.deepStrictEqual(third.errors, []);
  assert.strictEqual(third.pulled.updated, 1, "the reply came");
  assert.strictEqual(third.pushed.updated, 1, "the edit went");
  rows = await getRows();
  assert.strictEqual(rows.find((x) => x.id === "c0ffee0000000001").data.replies[0].text, "Agreed");
  db = await j(await fetch(fakeSite + "/__fake/db"));
  assert.strictEqual(db.reviews["version:21:media"].rows.find((x) => x.id === "a".repeat(16)).data.text, "Mine, edited");

  // a delete here travels as a tombstone, and is not brought back
  await j(await fetch(base + "/api/annotations/" + "c0ffee0000000002", { method: "DELETE" }));
  const fourth = await CL.adapter.sync(opts(third.state));
  assert.deepStrictEqual(fourth.errors, []);
  assert.strictEqual(fourth.pushed.updated, 1, "the delete went");
  db = await j(await fetch(fakeSite + "/__fake/db"));
  assert.ok(db.reviews["version:21:media"].rows.find((x) => x.id === "c0ffee0000000002").deleted_at, "deleted on Coreline too");
  assert.ok((await getRows()).find((x) => x.id === "c0ffee0000000002").deleted_at, "still deleted here");
  const fifth = await CL.adapter.sync(opts(fourth.state));
  assert.deepStrictEqual([fifth.pulled, fifth.pushed], [{ added: 0, updated: 0 }, { notes: 0, updated: 0, replies: 0, pictures: 0 }]);

  // a picture this machine did not have at first is uploaded on a later sync, the note itself unchanged
  rows = await getRows();
  const mineRow = rows.find((x) => x.id === "a".repeat(16));
  await j(await fetch(base + "/api/annotations/" + mineRow.id, { method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: Object.assign({}, mineRow.data, { shots: mineRow.data.shots.concat(["5ba7000000000002"]), edited_at: Date.now() }) }) }));
  const sixth = await CL.adapter.sync(opts(fifth.state));
  assert.ok(sixth.errors.some((e) => /5ba7000000000002 is not on this machine/.test(e)), "told: " + sixth.errors);
  assert.strictEqual(sixth.pushed.updated, 1, "the note went");
  const localShot2 = async (id) => id === "5ba7000000000002" ? new Blob([PNG], { type: "image/png" }) : localShot(id);
  const seventh = await CL.adapter.sync(Object.assign(opts(sixth.state), { localShot: localShot2 }));
  assert.deepStrictEqual(seventh.errors, []);
  assert.deepStrictEqual([seventh.pushed.pictures, seventh.pushed.updated], [1, 0], "the picture alone, retried");
  assert.ok((await j(await fetch(fakeSite + "/__fake/db"))).reviews["version:21:media"].shots["5ba7000000000002"]);

  // a file whose size is not the original's is never synced (doc units are the original's pixels)
  await assert.rejects(CL.adapter.sync(Object.assign(opts(seventh.state), { link: Object.assign({}, saved.link, { file: { width: 128, height: 72 } }) })), /64 × 36, the Version's original 128 × 72/);
  assert.deepStrictEqual([saved.link.file.width, saved.link.file.height], [64, 36], "the link carries the original's size");

  // a scaled web preview (no original on Coreline) is never synced: drawings would land in the wrong units
  await assert.rejects(CL.adapter.sync(Object.assign(opts(seventh.state), { link: Object.assign({}, saved.link, { scaled: true }) })), /scaled web preview/);

  // the same Version linked to a second file (the copy opened from Coreline): Coreline's rows are copied there under
  // derived ids (Sight's import) and never sent back as duplicates
  const opened = await j(await fetch(base + "/api/trackers/coreline/open/version:21:media", { method: "POST", headers: X }));
  const aid2 = opened.asset.id;
  assert.notStrictEqual(aid2, aid);
  await j(await fetch(base + "/api/trackers/coreline/link/" + aid2, { method: "PUT", headers: Object.assign({ "Content-Type": "application/json" }, X), body: JSON.stringify({ link: CL.adapter.linkOf(CL.siteHost(st.site), opened.record) }) }));
  const before = (await j(await fetch(fakeSite + "/__fake/db"))).reviews["version:21:media"].rows.length;
  const asset2 = await j(await fetch(base + "/api/assets/" + aid2));
  const getRows2 = async () => j(await fetch(base + "/api/annotations?asset_id=" + aid2 + "&deleted=1"));
  const o2 = { client, link: (await j(await fetch(base + "/api/trackers/coreline/link/" + aid2))).link, asset: asset2, state: {}, getRows: getRows2, importPackage, localShot };
  const dup = await CL.adapter.sync(o2);
  assert.ok(dup.errors.some((e) => /another file in Sight/.test(e)), "told why");
  assert.strictEqual(dup.pushed.notes, 0);
  const dup2 = await CL.adapter.sync(Object.assign(o2, { state: dup.state }));
  assert.strictEqual(dup2.pushed.notes + dup2.pushed.updated, 0, "not on a later sync either");
  assert.strictEqual((await j(await fetch(fakeSite + "/__fake/db"))).reviews["version:21:media"].rows.length, before, "no duplicates on Coreline");
  console.log("cl_sight: ok");
})().catch((e) => { console.error(e); process.exit(1); });
