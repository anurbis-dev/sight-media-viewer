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

  // ShotGrid… (no connection yet → the connection form)
  const more = async () => { await p.locator('button[title="Export and more"]').first().evaluate((e) => e.click()); await p.waitForSelector(".sheet .menu"); };
  await more();
  await p.tap('.sheet .menu button:has-text("ShotGrid…")');
  await p.waitForSelector(".sheet form.sgform");
  await p.fill(".sgform input[name=site]", site);
  await p.fill(".sgform input[name=script]", "sight");
  await p.fill(".sgform input[name=key]", "secret");
  await p.tap('.sgform button:has-text("Test")');
  await p.waitForFunction(() => /Connected/.test(document.querySelector(".sgform .sgmsg").textContent), null, { timeout: 10000 });
  await p.tap('.sgform button:has-text("Save")');
  await p.waitForSelector(".sheet form.sgform", { state: "detached" });
  // link: project + Version
  await more();
  await p.tap('.sheet .menu button:has-text("ShotGrid…")');
  await p.waitForSelector(".sheet select.sgproj option[value='70']", { state: "attached" });
  await p.selectOption(".sheet select.sgproj", "70");
  await p.fill(".sheet input[placeholder^='Version name']", "sh010");
  await p.waitForSelector(".sheet .sglist button[data-ver='77']");
  await p.tap(".sheet .sglist button[data-ver='77']");
  await p.waitForFunction(() => window.__sightReview.R.meta.sg && window.__sightReview.R.meta.sg.link);
  // sync
  await more();
  await p.tap('.sheet .menu button:has-text("ShotGrid…")');
  await p.tap('.sheet .menu button:has-text("Sync now")');
  await p.waitForFunction(() => window.__sightReview.R.meta.sg.state && window.__sightReview.R.meta.sg.state.last, null, { timeout: 20000 });
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
  const saved = await p.evaluate(async () => (await window.__sightReview.DB.get("reviews", window.__sightReview.R.meta.key)).sg.link.version.code);
  assert.strictEqual(saved, "sh010_comp_v003");
  assert.deepStrictEqual(errs, []);
  console.log(JSON.stringify({ ok: true, rows: rows.length, attachments: atts.length }));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
