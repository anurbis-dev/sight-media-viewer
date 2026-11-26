// ShotGrid sync unit test: shotgrid-core.js against the in-memory fake (tests/sg_fake.cjs), with a host made of
// review-core's merge (what the phone does). Run: node tests/sg_unit.cjs  (tests/test_shotgrid.py runs it too).
"use strict";
const assert = require("assert");
const RC = require("../app/static/review-core.js");
const SG = require("../app/static/shotgrid-core.js");
const { createFakeShotGrid } = require("./sg_fake.cjs");

const N1 = "00000000000000a1", N2 = "00000000000000a2", D1 = "00000000000000d1", R1 = "00000000000000e1";
const T0 = Date.parse("2026-11-19T10:00:00Z");

function note(id, text, extra){
  return { id, kind: "note", shape_kind: null, x: null, y: null, w: null, h: null, rotation: 0, z_index: 0, color: null, locked: 0,
    data: Object.assign({ text, author: "Ann", created: T0, status: "open", ctx: { t: 1, hold: 0 }, shots: [], replies: [] }, extra || {}),
    created_at: T0, updated_at: T0, deleted_at: null };
}
function stroke(id, noteId, upd){
  return { id, kind: "stroke", shape_kind: "brush", x: 0, y: 0, w: 10, h: 10, rotation: 0, z_index: 1, color: "#ff0000", locked: 0,
    data: { color: "#ff0000", size: 4, pts: [1, 1, .5, 9, 9, .5], note: noteId, ctx: { t: 1, hold: 0 }, created: T0 },
    created_at: T0, updated_at: upd, deleted_at: null };
}

function host(rows){
  const h = { rows, shots: {}, imports: 0, picCalls: [] };
  h.getRows = async () => h.rows;
  h.importPackage = async (pkg) => { h.imports++; Object.assign(h.shots, pkg.shots || {}); h.rows = RC.mergeRows(h.rows, pkg.annotations, { now: Date.now() }).rows; };
  h.pictures = async (ids) => { h.picCalls.push(ids.slice()); return new Map(ids.map((id) => [id, [{ blob: new Blob([Buffer.from("jpg-" + id)], { type: "image/jpeg" }), name: "f" }]])); };
  return h;
}

(async () => {
  const fake = createFakeShotGrid({ via: "/proxy?url=" });
  fake.add("HumanUser", { id: 7, login: "bob", name: "Bob Smith" });
  fake.add("Project", { id: 70, name: "Demo", archived: false });
  fake.add("Version", { id: 77, code: "sh010_comp_v003", project: { type: "Project", id: 70, name: "Demo" }, sg_task: { type: "Task", id: 55 }, sg_first_frame: 1001 });
  const client = SG.createClient({ site: fake.site, script: fake.script, key: fake.key, via: "/proxy?url=", fetch: fake.fetch });

  // wrong key
  await assert.rejects(SG.createClient({ site: fake.site, script: "sight", key: "bad", fetch: fake.fetch }).projects(), /refused/);
  assert.deepStrictEqual((await client.projects()).map((p) => p.name), ["Demo"]);
  assert.deepStrictEqual((await client.versions(70, "comp")).map((v) => v.code), ["sh010_comp_v003"]);

  const link = await SG.loadVersion(client, 77);
  assert.strictEqual(link.firstFrame, 1001);
  assert.strictEqual(link.site, "studio.shotgrid.example");

  // a note made on ShotGrid, with a reply and an annotation picture
  const sgn = fake.add("Note", { subject: "x", content: "Fix the edge", user: { type: "HumanUser", id: 7, name: "Bob Smith" }, note_links: [{ type: "Version", id: 77 }], sg_status_list: "opn", project: { type: "Project", id: 70 } });
  fake.add("Reply", { entity: { type: "Note", id: sgn.id }, content: "Agreed", user: { type: "HumanUser", id: 7, name: "Bob Smith" } });
  fake.add("Attachment", { note: sgn.id, filename: "annot_version_77.1025.png", this_file: fake.addFile("annot_version_77.1025.png", "PNGDATA") });

  const h = host([note(N1, "Too dark", { replies: [{ id: R1, text: "on it", author: "Bob Smith", created: T0 + 5 }] }), stroke(D1, N1, T0 + 1)]);
  const base = { client, link, asset: { id: "asset1", name: "sh010.mov", kind: "video" }, fps: 24, statusMap: {}, logins: { "Bob Smith": "bob" }, sudo: true,
    getRows: h.getRows, importPackage: h.importPackage, pictures: h.pictures };
  let r = await SG.sync(Object.assign({}, base, { state: {} }));
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.pulled.added, 1);
  assert.strictEqual(r.pushed.notes, 1);
  assert.strictEqual(r.pushed.replies, 1);
  assert.strictEqual(r.pushed.pictures, 1);
  // the pulled note: id from its ShotGrid id, text, author, reply, picture, frame 1025 → t = 1 s
  const pid = SG.idFor("studio.shotgrid.example:note:" + sgn.id);
  const pulled = h.rows.find((x) => x.id === pid);
  assert.ok(pulled, "pulled note");
  assert.strictEqual(pulled.data.text, "Fix the edge");
  assert.strictEqual(pulled.data.author, "Bob Smith");
  assert.strictEqual(pulled.data.replies[0].text, "Agreed");
  assert.strictEqual(pulled.data.shots.length, 1);
  assert.ok(h.shots[pulled.data.shots[0]].startsWith("data:image/png;base64,"));
  assert.strictEqual(pulled.data.ctx.t, 1);
  assert.deepStrictEqual(h.picCalls, [[N1]], "pictures only for the note sent from here");
  // the pushed note: ShotGrid has it with the version, task, status, subject; the row has data.sg; reply as Bob (sudo)
  const n1 = h.rows.find((x) => x.id === N1);
  assert.deepStrictEqual(n1.data.sg, { site: "studio.shotgrid.example", id: n1.data.sg.id, v: 77 });
  const sgN1 = fake.db.Note.get(n1.data.sg.id);
  assert.strictEqual(sgN1.content, "Too dark");
  assert.strictEqual(sgN1.subject, "Ann — sh010_comp_v003 · frame 1025");
  assert.deepStrictEqual(sgN1.tasks, [{ type: "Task", id: 55 }]);
  assert.strictEqual(sgN1.sg_status_list, "opn");
  const rep = [...fake.db.Reply.values()].find((x) => x.entity.id === sgN1.id);
  assert.strictEqual(rep.content, "on it");
  assert.strictEqual(rep.user.name, "Bob Smith");
  assert.strictEqual(n1.data.replies[0].sg, rep.id);
  const atts = [...fake.db.Attachment.values()].filter((a) => a.note === sgN1.id);
  assert.deepStrictEqual(atts.map((a) => a.filename), [SG.OUR_PREFIX + N1 + "-1.jpg"]);

  // second sync with nothing changed: no writes
  let state = r.state;
  fake.log.length = 0;
  r = await SG.sync(Object.assign({}, base, { state }));
  assert.deepStrictEqual(r.pulled, { added: 0, updated: 0 });
  assert.deepStrictEqual(r.pushed, { notes: 0, updated: 0, replies: 0, pictures: 0 });
  assert.ok(fake.log.every((l) => /_search|access_token/.test(l)), "only reads: " + fake.log.join(", "));
  state = r.state;

  // edits on both sides: text edited on ShotGrid, state + a drawing changed here, a new reply on ShotGrid
  sgN1.content = "Too dark (and noisy)"; sgN1.updated_at = fake.now();
  fake.add("Reply", { entity: { type: "Note", id: sgN1.id }, content: "Noise too", user: { type: "HumanUser", id: 7, name: "Bob Smith" } });
  h.rows = h.rows.map((x) => x.id === N1 ? Object.assign({}, x, { data: Object.assign({}, x.data, { status: "done", status_at: Date.now() }) })
    : x.id === D1 ? Object.assign({}, x, { updated_at: T0 + 99 }) : x);
  r = await SG.sync(Object.assign({}, base, { state }));
  assert.deepStrictEqual(r.errors, []);
  const n1b = h.rows.find((x) => x.id === N1);
  assert.strictEqual(n1b.data.text, "Too dark (and noisy)");
  assert.strictEqual(n1b.data.status, "done");
  assert.strictEqual(sgN1.sg_status_list, "clsd");
  assert.ok(n1b.data.replies.some((x) => x.text === "Noise too"));
  const atts2 = [...fake.db.Attachment.values()].filter((a) => a.note === sgN1.id);
  assert.strictEqual(atts2.length, 1, "old picture replaced");
  assert.notStrictEqual(atts2[0].id, atts[0].id);
  state = r.state;

  // a local edit of the text goes out; a state set on ShotGrid comes in
  h.rows = h.rows.map((x) => x.id === N1 ? Object.assign({}, x, { data: Object.assign({}, x.data, { text: "Darker please", edited_at: Date.now() + 5000 }) }) : x);
  const sgPulled = fake.db.Note.get(sgn.id); sgPulled.sg_status_list = "ip"; sgPulled.updated_at = fake.now();
  r = await SG.sync(Object.assign({}, base, { state }));
  assert.strictEqual(sgN1.content, "Darker please");
  assert.strictEqual(h.rows.find((x) => x.id === pid).data.status, "progress");
  state = r.state;

  // another client (the phone) holding the rows (with data.sg) but no state: no duplicates, no re-upload
  const h2 = host(JSON.parse(JSON.stringify(h.rows)));
  const notesBefore = fake.db.Note.size, attBefore = fake.db.Attachment.size;
  r = await SG.sync(Object.assign({}, base, { state: {}, getRows: h2.getRows, importPackage: h2.importPackage, pictures: h2.pictures }));
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(fake.db.Note.size, notesBefore);
  assert.strictEqual(fake.db.Attachment.size, attBefore);
  assert.strictEqual(r.pushed.notes + r.pushed.replies + r.pushed.pictures, 0);

  // without sudo: the author goes into the subject / reply text; a site that refuses our status code still gets the note
  const fake2 = createFakeShotGrid({ noteStatuses: ["wtg"] });
  fake2.add("Project", { id: 1, name: "P" });
  fake2.add("Version", { id: 2, code: "v1", project: { type: "Project", id: 1 } });
  const c2 = SG.createClient({ site: fake2.site, script: fake2.script, key: fake2.key, fetch: fake2.fetch });
  const h3 = host([note(N2, "Hello", { ctx: null, replies: [{ id: R1, text: "yo", author: "Cid", created: T0 + 1 }] })]);
  r = await SG.sync(Object.assign({}, base, { client: c2, link: await SG.loadVersion(c2, 2), state: {}, sudo: false, getRows: h3.getRows, importPackage: h3.importPackage, pictures: h3.pictures }));
  assert.deepStrictEqual(r.errors, []);
  const nn = [...fake2.db.Note.values()][0];
  assert.strictEqual(nn.subject, "Ann — v1");
  assert.strictEqual(nn.sg_status_list, undefined);
  assert.strictEqual([...fake2.db.Reply.values()][0].content, "Cid: yo");
  // and that reply text does not come back with the prefix
  r = await SG.sync(Object.assign({}, base, { client: c2, link: await SG.loadVersion(c2, 2), state: {}, sudo: false, getRows: h3.getRows, importPackage: h3.importPackage, pictures: h3.pictures }));
  assert.strictEqual(h3.rows[0].data.replies[0].text, "yo");

  // ---- review findings (0.99.0) ----
  {
    const f = createFakeShotGrid({ noteStatuses: ["rev", "fin", "wtg"], noteDefault: "wtg" });
    f.add("Project", { id: 1, name: "P" });
    f.add("Version", { id: 2, code: "v1", project: { type: "Project", id: 1 } });
    const c = SG.createClient({ site: f.site, script: f.script, key: f.key, fetch: f.fetch });
    const L = await SG.loadVersion(c, 2);
    const run = (hh, state, extra) => SG.sync(Object.assign({}, base, { client: c, link: L, state, sudo: false, getRows: hh.getRows, importPackage: hh.importPackage, pictures: hh.pictures }, extra || {}));
    // 1. a studio status we do not map is left alone (first sync and later)
    const sgRev = f.add("Note", { content: "Check", subject: "s", sg_status_list: "rev", user: { type: "HumanUser", id: 9, name: "Eve" }, note_links: [{ type: "Version", id: 2 }] });
    const hA = host([]);
    let rr = await run(hA, {});
    assert.strictEqual(sgRev.sg_status_list, "rev", "unmapped status kept");
    assert.strictEqual(rr.pushed.updated, 0);
    rr = await run(hA, rr.state);
    assert.strictEqual(sgRev.sg_status_list, "rev");
    // 2. a refused status code on update does not block the text / pictures; 11. create without a status keeps the site default as baseline
    const N3 = "00000000000000a3";
    hA.rows = hA.rows.concat([note(N3, "Mine", { ctx: null })]);
    rr = await run(hA, rr.state);
    const n3 = hA.rows.find((x) => x.id === N3), sg3 = f.db.Note.get(n3.data.sg.id);
    assert.strictEqual(sg3.sg_status_list, "wtg", "created without our code: the site default");
    let st2 = rr.state;
    rr = await run(hA, st2);
    assert.strictEqual(hA.rows.find((x) => x.id === N3).data.status, "open", "site default not taken as a change made there");
    hA.rows = hA.rows.map((x) => x.id === N3 ? Object.assign({}, x, { data: Object.assign({}, x.data, { text: "Mine v2", edited_at: Date.now(), status: "done", status_at: Date.now() }) }) : x);
    rr = await run(hA, rr.state);
    assert.strictEqual(sg3.content, "Mine v2", "text sent although the status was refused");
    assert.ok(rr.errors.some((e) => /refused the status code/.test(e)));
    // 4. a picture added on ShotGrid is pulled, not sent back; 10. removed here, it stays removed
    const ours3 = [...f.db.Attachment.values()].filter((x) => x.note === sg3.id).map((x) => x.id);
    f.add("Attachment", { note: sg3.id, filename: "ref.png", this_file: f.addFile("ref.png", "PNG2") });
    rr = await run(hA, rr.state);
    assert.strictEqual(rr.pushed.pictures, 0, "pulled picture does not trigger a re-upload");
    const shotsN3 = hA.rows.find((x) => x.id === N3).data.shots;
    assert.strictEqual(shotsN3.length, 1);
    assert.deepStrictEqual([...f.db.Attachment.values()].filter((x) => x.note === sg3.id && x.filename !== "ref.png").map((x) => x.id), ours3, "no sight-* copy of ref.png");
    hA.rows = hA.rows.map((x) => x.id === N3 ? Object.assign({}, x, { data: Object.assign({}, x.data, { shots: [], edited_at: Date.now() + 10000 }) }) : x);
    rr = await run(hA, rr.state);
    assert.strictEqual(rr.pulled.updated, 0, "removed picture not pulled again");
    assert.deepStrictEqual(hA.rows.find((x) => x.id === N3).data.shots, []);
    // 3. a sync that broke off after the create (ids never reached the rows): the note is known again by its pictures
    const N4 = "00000000000000a4";
    const hB = host([note(N4, "Lost ids", { ctx: null }), stroke("00000000000000d4", N4, T0 + 1)]);
    let fail = true;
    const brokenImport = async (p1) => { if (fail && p1.annotations.some((x) => x.id === N4 && x.data.sg)) throw new Error("tab closed"); return hB.importPackage(p1); };
    rr = await run(hB, {}, { importPackage: brokenImport });
    const before = f.db.Note.size;
    fail = false;
    rr = await run(hB, {});
    assert.strictEqual(f.db.Note.size, before, "not sent twice");
    assert.strictEqual(hB.rows.filter((x) => x.kind === "note" && x.deleted_at == null).length, f.db.Note.size, "not pulled back as a second note");
    assert.ok(hB.rows.find((x) => x.id === N4).data.sg, "ids recovered");
  }

  // first sync on a client with no state (the phone after Sight's .srev, a re-link): edits made here are kept
  {
    const f = createFakeShotGrid();
    f.add("Project", { id: 1, name: "P" });
    f.add("Version", { id: 2, code: "v1", project: { type: "Project", id: 1 } });
    const c = SG.createClient({ site: f.site, script: f.script, key: f.key, fetch: f.fetch });
    const L = await SG.loadVersion(c, 2);
    const N5 = "00000000000000a5";
    const hS = host([note(N5, "original", { ctx: null })]);
    const run = (hh, state) => SG.sync(Object.assign({}, base, { client: c, link: L, state, sudo: false, getRows: hh.getRows, importPackage: hh.importPackage, pictures: async () => new Map() }));
    await run(hS, {});
    const later = Date.now() + 60000;
    const hP = host(JSON.parse(JSON.stringify(hS.rows)).map((x) => x.id === N5 ? Object.assign({}, x, { data: Object.assign({}, x.data, { text: "edited on phone", edited_at: later, status: "done", status_at: later }) }) : x));
    const rr = await run(hP, {});
    assert.deepStrictEqual(rr.errors, []);
    const pn = hP.rows.find((x) => x.id === N5), sgn5 = f.db.Note.get(pn.data.sg.id);
    assert.deepStrictEqual([pn.data.text, pn.data.status], ["edited on phone", "done"]);
    assert.deepStrictEqual([sgn5.content, sgn5.sg_status_list], ["edited on phone", "clsd"]);
  }

  // the grid's point read: updated_at after a stamp, and retired rows on their own
  {
    const f = createFakeShotGrid();
    f.add("Project", { id: 1, name: "P" });
    f.add("Version", { id: 1, code: "old", project: { type: "Project", id: 1 }, created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z" });
    const gone = f.add("Version", { id: 2, code: "gone", project: { type: "Project", id: 1 }, created_at: "2026-11-02T00:00:00Z", updated_at: "2026-11-20T00:00:00Z" });
    gone.retired = true;
    f.add("Version", { id: 3, code: "fresh", project: { type: "Project", id: 1 }, created_at: "2026-11-03T00:00:00Z", updated_at: "2026-11-21T00:00:00Z" });
    const c = SG.createClient({ site: f.site, script: f.script, key: f.key, fetch: f.fetch });
    const A = SG.adapter;
    const names = (xs) => xs.map((v) => v.code);
    assert.deepStrictEqual(names(await A.browse(c, { project: 1 }, [], 1, 50)), ["fresh", "old"]);
    assert.deepStrictEqual(names(await A.browse(c, { project: 1, since: "2026-11-10T00:00:00Z" }, [], 1, 50)), ["fresh"]);
    assert.deepStrictEqual(names(await A.browseRetired(c, { project: 1, since: "2026-11-10T00:00:00Z" }, [], 1, 50)), ["gone"]);
  }

  // helpers
  assert.strictEqual(SG.siteUrl("studio.shotgrid.autodesk.com/"), "https://studio.shotgrid.autodesk.com");
  assert.strictEqual(SG.siteUrl("https://x.shotgunstudio.com/api/v1.1"), "https://x.shotgunstudio.com");
  assert.strictEqual(SG.statusFrom({}, "clsd"), "done");
  assert.strictEqual(SG.statusFrom({ done: "fin" }, "fin"), "done");
  assert.strictEqual(SG.statusFrom({}, "weird"), null);
  assert.match(SG.idFor("a"), /^[0-9a-f]{16}$/);
  assert.notStrictEqual(SG.idFor("a"), SG.idFor("b"));
  assert.strictEqual(SG.linkedVersionOf(h.rows, "studio.shotgrid.example"), 77);
  console.log("sg_unit: ok");
})().catch((e) => { console.error(e); process.exit(1); });
