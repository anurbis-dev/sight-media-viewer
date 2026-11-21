// ShotGrid in the phone app (docs/SHOTGRID.md), headless Chromium as a phone (touch, no keyboard needed):
// Settings → ShotGrid connection, a note drawn on a picture, "Export and more" → ShotGrid… → project → Version →
// Sync now; the fake site (tests/sg_fake_server.cjs, answers any origin) gets the note with its picture, the review
// gets ShotGrid's note. Called by tests/test_pwa.py.
//
//   node tests/pwa_sg.cjs <appURL> <picture file> <fakeSite>
"use strict";
const assert = require("assert");
const { chromium } = require("playwright");
const [base, pic, site] = process.argv.slice(2);
const KEY = "shotgrid:" + new URL(site).host;   // the tracker key the review's link is filed under (reviews.meta.trk)

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await fetch(site + "/__fake/add", { method: "POST", body: JSON.stringify({ type: "Note", content: "Warmer please", subject: "s", sg_status_list: "opn",
    user: { type: "HumanUser", id: 7, name: "Bob Smith" }, note_links: [{ type: "Version", id: 77 }] }) });
  await p.goto(base);
  await p.evaluate(() => { localStorage.setItem("sight-review:name", "Ann"); localStorage.setItem("sight-review:fs", "0"); });
  await p.reload();
  await p.waitForSelector("label.pick-media");
  await p.setInputFiles("label.pick-media input", pic);
  await p.waitForSelector(".stage img, .stage canvas");
  await p.waitForTimeout(500);
  // a note with a drawing, written by touch
  await p.tap('button[title="Draw a note on this picture / frame"]');
  await p.waitForSelector(".draw");
  const r = await p.locator(".draw .dview").boundingBox();
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i })) });
  await touch("touchStart", [[cx - 40, cy - 20]]);
  for (let i = 1; i <= 10; i++){ await touch("touchMove", [[cx - 40 + 8 * i, cy - 20 + 4 * i]]); await p.waitForTimeout(16); }
  await touch("touchEnd", []);
  await p.waitForTimeout(200);
  await p.tap(".draw .btn.primary");
  await p.waitForSelector(".newbar .atts .fw");
  await p.fill(".newbar textarea", "Too bright here");
  await p.tap(".newbar .send");
  await p.waitForFunction(() => window.__sightReview.R.rows.some((x) => x.kind === "note"));

  // No connection yet: no "ShotGrid…" in the menu (docs/PLAN-trackers.md decision 10); Settings → Trackers →
  // Connect a tracker… → ShotGrid → the connection form
  const more = async () => { await p.locator('button[title="Export and more"]').first().evaluate((e) => e.click()); await p.waitForSelector(".sheet .menu"); };
  await more();
  assert.strictEqual(await p.locator('.sheet .menu button:has-text("ShotGrid…")').count(), 0, "no ShotGrid item while not connected");
  await p.tap('.sheet .menu button:has-text("Settings")');
  await p.waitForSelector('.sheet button:has-text("Connect a tracker…")');
  await p.tap('.sheet button:has-text("Connect a tracker…")');
  await p.waitForSelector('.sheet .menu button:has-text("ShotGrid")');
  await p.tap('.sheet .menu button:has-text("ShotGrid")');
  await p.waitForSelector(".sheet form.trkform");
  await p.fill(".trkform input[name=site]", site);
  await p.fill(".trkform input[name=script]", "sight");
  await p.fill(".trkform input[name=key]", "secret");
  await p.tap('.trkform button:has-text("Test")');
  await p.waitForFunction(() => /Connected/.test(document.querySelector(".trkform .trkmsg").textContent), null, { timeout: 10000 });
  await p.tap('.trkform button:has-text("Save")');
  await p.waitForSelector(".sheet form.trkform", { state: "detached" });
  // link: project + Version
  await more();
  await p.tap('.sheet .menu button:has-text("ShotGrid…")');
  await p.waitForSelector(".sheet select.sgproj option[value='70']", { state: "attached" });
  await p.selectOption(".sheet select.sgproj", "70");
  await p.fill(".sheet input[placeholder^='Version name']", "sh010");
  await p.waitForSelector(".sheet .sglist button[data-ver='77']");
  await p.tap(".sheet .sglist button[data-ver='77']");
  await p.waitForFunction((k) => { const m = window.__sightReview.R.meta; return m.trk && m.trk[k] && m.trk[k].link && !("sg" in m); }, KEY);
  // sync
  await more();
  await p.tap('.sheet .menu button:has-text("ShotGrid…")');
  await p.tap('.sheet .menu button:has-text("Sync now")');
  await p.waitForFunction((k) => { const e = window.__sightReview.R.meta.trk[k]; return e.state && e.state.last; }, KEY, { timeout: 20000 });
  const rows = await p.evaluate(() => window.__sightReview.R.rows.filter((x) => x.kind === "note").map((x) => ({ text: x.data.text, sg: x.data.sg })));
  const db = await (await fetch(site + "/__fake/db")).json();
  const sent = db.Note.find((n) => n.content === "Too bright here");
  assert.ok(sent, "note sent to ShotGrid");
  assert.ok(rows.some((x) => x.text === "Warmer please"), "ShotGrid's note in the review");
  assert.ok(rows.find((x) => x.text === "Too bright here").sg.id === sent.id, "ShotGrid id stamped on the row");
  const atts = db.Attachment.filter((a) => a.note === sent.id);
  assert.strictEqual(atts.length, 1, "the picture with the drawing uploaded");
  // persisted with the review
  await p.evaluate(() => window.__sightReview.flush());
  const saved = await p.evaluate(async (k) => (await window.__sightReview.DB.get("reviews", window.__sightReview.R.meta.key)).trk[k].link.version.code, KEY);
  assert.strictEqual(saved, "sh010_comp_v003");
  // A review saved before 0.108 keeps ShotGrid's link in meta.sg: it still reads as linked (the ⋯ menu, the sheet) and
  // syncs; the next change of its link state (the sync) moves it into meta.trk under the tracker key, nothing lost
  const legacy = await p.evaluate(async (k) => {
    const S = window.__sightReview, D = S.DB, key = S.R.meta.key;
    await S.flush();
    const m = await D.get("reviews", key);
    m.sg = { link: m.trk[k].link, state: { last: 1, notes: m.trk[k].state.notes, replies: m.trk[k].state.replies } };
    delete m.trk;
    await D.put("reviews", m);
    return { key, last: m.sg.state.last };
  }, KEY);
  await p.goto(base);
  await p.waitForSelector(".item");
  await p.locator(".item .th").first().click();
  await p.waitForFunction((key) => window.__sightReview.R && window.__sightReview.R.meta.key === key, legacy.key, { timeout: 10000 });
  assert.ok(await p.evaluate(() => !!window.__sightReview.R.meta.sg && !window.__sightReview.R.meta.trk), "opened as stored (meta.sg)");
  await more();
  assert.ok(/sh010_comp_v003/.test(await p.textContent('.sheet .menu button:has-text("ShotGrid…")')), "the menu names the Version linked in meta.sg");
  await p.tap('.sheet .menu button:has-text("ShotGrid…")');
  await p.waitForSelector('.sheet .menu button:has-text("Sync now")');
  assert.ok(/Linked to sh010_comp_v003 · .*Last sync: (?!never)/.test(await p.textContent(".sheet p")), "the sheet shows the old link and its last sync");
  await p.tap('.sheet .menu button:has-text("Sync now")');
  await p.waitForFunction((k) => { const m = window.__sightReview.R.meta; return m.trk && m.trk[k] && m.trk[k].state.last > 1 && !("sg" in m); }, KEY, { timeout: 20000 });
  await p.evaluate(() => window.__sightReview.flush());
  const moved = await p.evaluate(async (k) => { const m = await window.__sightReview.DB.get("reviews", window.__sightReview.R.meta.key); return { sg: "sg" in m, code: m.trk[k].link.version.code, site: m.trk[k].link.site }; }, KEY);
  assert.deepStrictEqual(moved, { sg: false, code: "sh010_comp_v003", site: new URL(site).host }, "moved into meta.trk");
  const db2 = await (await fetch(site + "/__fake/db")).json();
  assert.strictEqual(db2.Note.filter((n) => n.content === "Too bright here").length, 1, "the old sync state kept: the note was not sent twice");
  // Unlink removes it (no meta.sg left to bring it back)
  await more();
  await p.tap('.sheet .menu button:has-text("ShotGrid…")');
  await p.tap('.sheet .menu button:has-text("Unlink")');
  await p.evaluate(() => window.__sightReview.flush());
  assert.deepStrictEqual(await p.evaluate(async () => { const m = await window.__sightReview.DB.get("reviews", window.__sightReview.R.meta.key); return [m.trk, "sg" in m]; }), [{}, false], "unlinked");
  await more();
  assert.ok(/link & sync/.test(await p.textContent('.sheet .menu button:has-text("ShotGrid…")')));
  assert.deepStrictEqual(errs, []);
  console.log(JSON.stringify({ ok: true, rows: rows.length, attachments: atts.length }));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
