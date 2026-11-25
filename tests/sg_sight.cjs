// ShotGrid sync through Sight's own server: shotgrid-core.js with serverAuth (the key stays in Sight), rows from
// /api/annotations, merges through /api/review/import, the link / state in /api/sg/link — what annotate.js does,
// without the browser. Run by tests/test_shotgrid.py:  node tests/sg_sight.cjs <sightBase> <assetId> <fakeSite>
"use strict";
const assert = require("assert");
const SG = require("../app/static/shotgrid-core.js");

const [base, aid, fakeSite] = process.argv.slice(2);
const X = { "X-Sight": "1" };
const j = async (r) => { if (!r.ok) throw new Error(r.status + " " + await r.text()); return r.json(); };

(async () => {
  // the proxy refuses calls without Sight's header, and never hands out a token
  let r = await fetch(base + "/api/sg/fetch?url=" + encodeURIComponent(fakeSite + "/api/v1.1/entity/projects"));
  assert.strictEqual(r.status, 403);
  r = await fetch(base + "/api/sg/fetch?url=" + encodeURIComponent(fakeSite + "/api/v1.1/auth/access_token"), { method: "POST", headers: X, body: "grant_type=client_credentials" });
  assert.strictEqual(r.status, 400);
  r = await fetch(base + "/api/sg/fetch?url=" + encodeURIComponent("http://example.com/x"), { headers: X });
  assert.strictEqual(r.status, 400, "plain http elsewhere refused");

  const st = await j(await fetch(base + "/api/sg/status"));
  assert.strictEqual(st.configured, true);
  assert.ok(!JSON.stringify(st).includes("secret"));
  const client = SG.createClient({ site: st.site, via: base + "/api/sg/fetch?url=", serverAuth: true, headers: X });
  assert.deepStrictEqual((await client.projects()).map((p) => p.name), ["Demo"]);

  const link = await SG.loadVersion(client, 77);
  await j(await fetch(base + "/api/sg/link/" + aid, { method: "PUT", headers: Object.assign({ "Content-Type": "application/json" }, X), body: JSON.stringify({ link }) }));
  const asset = await j(await fetch(base + "/api/assets/" + aid));
  const saved = await j(await fetch(base + "/api/sg/link/" + aid));
  assert.strictEqual(saved.link.version.code, "sh010_comp_v003");

  const getRows = async () => j(await fetch(base + "/api/annotations?asset_id=" + aid + "&deleted=1"));
  const importPackage = async (pkg) => j(await fetch(base + "/api/review/import", { method: "POST", body: JSON.stringify(pkg) }));
  const pictures = async (ids) => new Map(ids.map((id) => [id, [{ blob: new Blob([Buffer.from("JPEGDATA")], { type: "image/jpeg" }), name: "f" }]]));
  const res = await SG.sync({ client, link: saved.link, asset, fps: 24, state: saved.state, statusMap: st.statusMap, logins: st.logins, sudo: st.sudo,
    getRows, importPackage, pictures });
  assert.deepStrictEqual(res.errors, []);
  assert.strictEqual(res.pulled.added, 1);
  assert.strictEqual(res.pushed.notes, 1);
  assert.strictEqual(res.pushed.pictures, 1);
  await j(await fetch(base + "/api/sg/link/" + aid, { method: "PUT", headers: Object.assign({ "Content-Type": "application/json" }, X), body: JSON.stringify({ state: res.state }) }));

  const rows = await getRows();
  const pulled = rows.find((x) => x.data && x.data.text === "From ShotGrid");
  assert.ok(pulled, "pulled note in Sight");
  assert.strictEqual(pulled.data.shots.length, 1);
  r = await fetch(base + "/api/review/shots/" + pulled.data.shots[0]);
  assert.strictEqual(r.status, 200, "pulled picture saved as a review shot");
  const mine = rows.find((x) => x.data && x.data.text === "Mine");
  assert.strictEqual(mine.data.sg.v, 77);
  const db = await j(await fetch(fakeSite + "/__fake/db"));
  const sgMine = db.Note.find((n) => n.id === mine.data.sg.id);
  assert.strictEqual(sgMine.content, "Mine");
  assert.strictEqual(sgMine.user.name, "Bob Smith", "posted as the reviewer's login (sudo)");
  assert.ok(db.Attachment.some((a) => a.note === sgMine.id && a.filename.startsWith("sight-")));

  // second sync: nothing to do
  const again = await SG.sync({ client, link: saved.link, asset, fps: 24, state: res.state, statusMap: st.statusMap, logins: st.logins, sudo: st.sudo, getRows, importPackage, pictures });
  assert.deepStrictEqual([again.pulled, again.pushed], [{ added: 0, updated: 0 }, { notes: 0, updated: 0, replies: 0, pictures: 0 }]);

  // a note deleted here (sent before, or pulled) is not brought back or sent again
  await j(await fetch(base + "/api/annotations/" + mine.id, { method: "DELETE" }));
  await j(await fetch(base + "/api/annotations/" + pulled.id, { method: "DELETE" }));
  const third = await SG.sync({ client, link: saved.link, asset, fps: 24, state: again.state, statusMap: st.statusMap, logins: st.logins, sudo: st.sudo, getRows, importPackage, pictures });
  assert.deepStrictEqual(third.errors, []);
  const liveNow = (await getRows()).filter((x) => x.deleted_at == null && x.kind === "note");
  assert.deepStrictEqual(liveNow, [], "deleted notes stay deleted");
  assert.strictEqual((await j(await fetch(fakeSite + "/__fake/db"))).Note.length, db.Note.length, "nothing new on ShotGrid");
  console.log("sg_sight: ok");
})().catch((e) => { console.error(e); process.exit(1); });
