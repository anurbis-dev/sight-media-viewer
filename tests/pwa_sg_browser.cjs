// The phone's home screen with ShotGrid (docs/PLAN-trackers.md): the person button, a swipe to the ShotGrid page,
// the Versions grid narrowed by project / entity type / entity, thumbnails cached, a tap opens the Version linked.
// Called by tests/test_pwa.py:  node tests/pwa_sg_browser.cjs <appURL> <fakeSite> <outDir>
const { chromium } = require("playwright");
const assert = require("assert");
const [base, site, out] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(base);
  await p.evaluate((site) => { localStorage.setItem("sight-review:name", "Ann Lee"); localStorage.setItem("sight-review:fs", "0");
    localStorage.setItem("sight-review:sg", JSON.stringify({ site, script: "sight", key: "secret" })); }, site);
  await p.reload();
  await p.waitForSelector(".hometabs");
  assert.strictEqual(await p.textContent(".bar .you"), "AL");
  // swipe left on empty area → ShotGrid page
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i })) });
  await touch("touchStart", [[300, 600]]); for (let i = 1; i <= 8; i++){ await touch("touchMove", [[300 - 25 * i, 600]]); await p.waitForTimeout(16); } await touch("touchEnd", []);
  await p.waitForTimeout(300);
  assert.strictEqual(await p.evaluate(() => document.querySelector(".hometabs .on").dataset.p), "sg", "swipe left opens ShotGrid");
  await p.waitForSelector(".sgb-proj option[value='70']", { state: "attached" });
  await p.selectOption(".sgb-proj", "70");
  await p.waitForSelector(".sgb-tile");
  await p.waitForTimeout(800);
  assert.deepStrictEqual(await p.$$eval(".sgb-tile b", (x) => x.map((e) => e.textContent)), ["sh010_comp_v003", "robot_model_v002", "sh020_anim_v001"]);
  assert.strictEqual(await p.$$eval(".sgb-tile img", (x) => x.length), 3);
  await p.screenshot({ path: out + "/sgb1.png" });
  await p.tap(".sgb-types button[data-t='Shot']");
  await p.waitForTimeout(600);
  assert.deepStrictEqual(await p.$$eval(".sgb-tile b", (x) => x.map((e) => e.textContent)), ["sh010_comp_v003", "sh020_anim_v001"]);
  await p.selectOption(".sgb-ent", "502"); await p.waitForTimeout(600);
  assert.deepStrictEqual(await p.$$eval(".sgb-tile b", (x) => x.map((e) => e.textContent)), ["sh020_anim_v001"]);
  const cached = await p.evaluate(async () => (await (await caches.open("sight-review-sgthumbs")).keys()).length);
  assert.strictEqual(cached, 3, "thumbnails cached");
  await p.tap(".sgb-tile[data-ver='78']");
  await p.waitForFunction(() => window.__sightReview.R && window.__sightReview.R.meta.sg, null, { timeout: 15000 });
  assert.deepStrictEqual(await p.evaluate(() => [window.__sightReview.R.meta.asset.name, window.__sightReview.R.meta.sg.link.version.code]), ["sh020_anim_v001.png", "sh020_anim_v001"]);
  await p.waitForTimeout(500);
  await p.screenshot({ path: out + "/sgb2.png" });
  const key = await p.evaluate(() => window.__sightReview.R.meta.key);
  await p.waitForFunction(async (k) => !!(await window.__sightReview.DB.get("files", k)), key, { timeout: 10000 });  // autoKeep
  const count = () => p.evaluate(async () => (await window.__sightReview.DB.all("reviews")).length);
  const n0 = await count();
  // back home: the Version is outlined; a tap opens that review again (kept: no second review)
  const home = async () => { await p.goto(base); await p.waitForSelector(".sgb-tile[data-ver='78']"); };
  await home();
  assert.ok(await p.evaluate(() => document.querySelector(".sgb-tile[data-ver='78']").classList.contains("has")), "linked Version outlined");
  await p.tap(".sgb-tile[data-ver='78']");
  await p.waitForFunction((k) => window.__sightReview.R && window.__sightReview.R.meta.key === k, key, { timeout: 10000 });
  // its media forgotten on the device: the same review opens with the downloaded proxy (no second, empty review);
  // a double tap downloads once
  await p.evaluate(async (k) => { const D = window.__sightReview.DB; await D.del("files", k); const m = await D.get("reviews", k); m.kept = false; await D.put("reviews", m); }, key);
  await home();
  await p.evaluate(() => { const t = document.querySelector(".sgb-tile[data-ver='78']"); t.click(); t.click(); });
  await p.waitForFunction((k) => window.__sightReview.R && window.__sightReview.R.meta.key === k && window.__sightReview.R.file, key, { timeout: 15000 });
  assert.strictEqual(await count(), n0, "no second review for the same Version");
  assert.deepStrictEqual(errs, []);
  console.log(JSON.stringify({ ok: true }));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
