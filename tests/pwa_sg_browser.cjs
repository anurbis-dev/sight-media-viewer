// The phone's home screen with ShotGrid (docs/PLAN-trackers.md): the person button, a swipe to the ShotGrid page,
// the Versions grid narrowed by project / entity type / entity, thumbnails cached, a tap opens the Version linked.
// Called by tests/test_pwa.py:  node tests/pwa_sg_browser.cjs <appURL> <fakeSite> <outDir>
const { chromium } = require("playwright");
const assert = require("assert");
const [base, site, out] = process.argv.slice(2);
const KEY = "shotgrid:" + new URL(site).host;   // ShotGrid's page = its tracker key (a page per connected tracker)
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(base);
  await p.evaluate(() => { localStorage.setItem("sight-review:name", "Ann Lee"); localStorage.setItem("sight-review:fs", "0"); });
  await p.reload();
  // not connected: no ShotGrid page / tab, no tracker row in the person sheet (docs/PLAN-trackers.md decision 10)
  await p.waitForSelector(".bar .you");
  assert.strictEqual(await p.locator(".hometabs").count(), 0, "no tabs while no tracker is connected");
  assert.strictEqual(await p.textContent(".bar .ttl b"), "Sight Review");
  await p.tap(".bar .you"); await p.waitForSelector(".sheet .kv");
  assert.ok(!/ShotGrid/.test(await p.textContent(".sheet")), "the person sheet has no ShotGrid part");
  await p.evaluate(() => document.querySelector(".back")?.click()); await p.waitForSelector(".sheet", { state: "detached" });
  // Settings → Trackers → Connect a tracker… → ShotGrid: the tab comes at once (no reload)
  await p.tap('.bar button[title="Settings"]');
  await p.waitForSelector('.sheet button:has-text("Connect a tracker…")');
  assert.ok(/None connected/.test(await p.textContent(".sheet")));
  await p.tap('.sheet button:has-text("Connect a tracker…")');
  await p.tap('.sheet .menu button:has-text("ShotGrid")');
  await p.waitForSelector(".sheet form.trkform");
  await p.fill(".trkform input[name=site]", site); await p.fill(".trkform input[name=script]", "sight"); await p.fill(".trkform input[name=key]", "secret");
  await p.tap('.trkform button:has-text("Save")');
  await p.waitForSelector(".hometabs");
  assert.strictEqual(await p.textContent(".bar .you"), "AL");
  // swipe left on empty area → ShotGrid page
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i })) });
  await touch("touchStart", [[300, 600]]); for (let i = 1; i <= 8; i++){ await touch("touchMove", [[300 - 25 * i, 600]]); await p.waitForTimeout(16); } await touch("touchEnd", []);
  await p.waitForTimeout(300);
  assert.strictEqual(await p.evaluate(() => document.querySelector(".hometabs .on").dataset.p), KEY, "swipe left opens ShotGrid");
  assert.deepStrictEqual(await p.$$eval(".hometabs button", (x) => x.map((b) => b.textContent)), ["Reviews", "ShotGrid"], "a tab per connected tracker");
  await p.waitForSelector(".sgb-proj option[value='70']", { state: "attached" });
  await p.selectOption(".sgb-proj", "70");
  await p.waitForSelector(".sgb-tile");
  await p.waitForTimeout(800);
  assert.deepStrictEqual(await p.$$eval(".sgb-tile b", (x) => x.map((e) => e.textContent)), ["sh010_comp_v003", "robot_model_v002", "sh020_anim_v001"]);
  assert.strictEqual(await p.$$eval(".sgb-tile img", (x) => x.length), 3);
  await p.screenshot({ path: out + "/sgb1.png" });
  // Fields: the site's Version fields; ticking Description shows it on the tiles
  await p.tap(".sgb-fields");
  await p.waitForSelector(".sheet .sgb-flist input[data-f='description']");
  await p.tap(".sheet .sgb-flist input[data-f='description']");
  await p.tap('.sheet button:has-text("Done")');
  await p.waitForFunction(() => /Blocking pass/.test(document.querySelector(".sgb-tile[data-ver='78'] .cap").textContent), null, { timeout: 8000 });
  // Filter: the filter builder in a bottom sheet (core/filter-core.js, as Sight's Filter ▾); its conditions go to
  // ShotGrid as hash filters ANDed with the quick filters, kept per project across a reload (docs/PLAN-trackers.md 3d)
  const searches = [];
  p.on("request", (r) => { if (/\/entity\/versions\/_search/.test(r.url())) searches.push(JSON.parse(r.postData() || "null")); });
  const tiles = () => p.$$eval(".sgb-tile b", (x) => x.map((e) => e.textContent));
  const waitTiles = async (want, why) => {
    await p.waitForFunction((w) => JSON.stringify([...document.querySelectorAll(".sgb-tile b")].map((e) => e.textContent)) === w && !/Loading/.test(document.querySelector(".sgb-msg").textContent), JSON.stringify(want), { timeout: 8000 })
      .catch(async () => assert.deepStrictEqual(await tiles(), want, why));
  };
  assert.strictEqual(await p.textContent(".sgb-where"), "Filter");
  await p.tap(".sgb-where");
  await p.waitForSelector(".sheet.flt-sheet .flt-none");
  await p.tap('.flt-sheet .flt-gacts button[data-act="add"]');
  await p.selectOption('.flt-sheet .flt-row[data-path="0"] .flt-f', "sg_status_list");
  assert.deepStrictEqual(await p.$$eval('.flt-sheet .flt-row[data-path="0"] .flt-v option', (x) => x.map((o) => o.textContent)), ["—", "Pending Review", "Approved", "N/A"], "the schema's status choices");
  await p.selectOption('.flt-sheet .flt-row[data-path="0"] .flt-v', "apr");
  await waitTiles(["robot_model_v002"], "status is Approved");
  assert.deepStrictEqual(searches[searches.length - 1].filters, { logical_operator: "and", conditions: [
    { path: "project", relation: "is", values: [{ type: "Project", id: 70 }] },
    { logical_operator: "and", conditions: [{ path: "sg_status_list", relation: "is", values: ["apr"] }] }] }, "hash filters: the project ANDed with the conditions");
  await p.selectOption('.flt-sheet .flt-row[data-path="0"] .flt-v', "rev");
  await waitTiles(["sh010_comp_v003", "sh020_anim_v001"], "status is Pending Review");
  // a nested group (Any): Version Name contains "zzz" or Link is sh020
  await p.tap('.flt-sheet .flt-group.root > .flt-gacts button[data-act="addg"]');
  assert.strictEqual(await p.$eval('.flt-sheet .flt-group[data-path="1"] > .flt-ghead .flt-join', (x) => x.value), "or", "a group under All starts as Any");
  await p.selectOption('.flt-sheet .flt-row[data-path="1.0"] .flt-f', "code");
  await p.fill('.flt-sheet .flt-row[data-path="1.0"] .flt-v', "zzz");
  await p.selectOption('.flt-sheet .flt-row[data-path="1.1"] .flt-f', "entity");
  await p.selectOption('.flt-sheet .flt-row[data-path="1.1"] .flt-o', "is");
  await p.fill('.flt-sheet .flt-row[data-path="1.1"] .flt-v', "sh020");
  await waitTiles(["sh020_anim_v001"], "status and (name or link)");
  assert.deepStrictEqual(searches[searches.length - 1].filters.conditions[1], { logical_operator: "and", conditions: [
    { path: "sg_status_list", relation: "is", values: ["rev"] },
    { logical_operator: "or", conditions: [{ path: "code", relation: "contains", values: ["zzz"] }, { path: "entity", relation: "name_is", values: ["sh020"] }] }] });
  assert.strictEqual(await p.textContent(".sgb-where"), "Filter · 3");
  await p.screenshot({ path: out + "/sgb-filter.png" });
  // an edit that changes nothing in effect (a new empty row) loads nothing
  const before = searches.length;
  await p.tap('.flt-sheet .flt-group.root > .flt-gacts button[data-act="add"]');
  await p.waitForTimeout(500);
  assert.strictEqual(searches.length, before, "an incomplete row does not reload");
  await p.tap('.flt-sheet button:has-text("Done")');
  await p.waitForSelector(".flt-sheet", { state: "detached" });
  // kept across a reload (per project); the quick filters AND with it
  await p.reload();
  await p.waitForSelector(".sgb-tile");
  await waitTiles(["sh020_anim_v001"], "the conditions survive a reload");
  assert.strictEqual(await p.textContent(".sgb-where"), "Filter · 3");
  assert.ok(await p.evaluate((s) => !!JSON.parse(localStorage.getItem("sight-review:sgwhere"))[new URL(s).host + " 70"], site), "stored per project");
  await p.tap(".sgb-types button[data-t='Asset']");
  await p.waitForFunction(() => /No Version matches/.test(document.querySelector(".sgb-msg").textContent), null, { timeout: 8000 });
  await p.tap(".sgb-types button[data-t='']");
  await waitTiles(["sh020_anim_v001"], "back to all types");
  await p.tap(".sgb-where");
  await p.waitForSelector('.flt-sheet .flt-row[data-path="1.1"]');
  await p.tap('.flt-sheet button[data-act="clear"]');
  await waitTiles(["sh010_comp_v003", "robot_model_v002", "sh020_anim_v001"], "Clear: every Version");
  assert.ok(Array.isArray(searches[searches.length - 1].filters), "no conditions: the array format again");
  await p.evaluate(() => document.querySelector(".back")?.click()); await p.waitForSelector(".sheet", { state: "detached" });
  assert.strictEqual(await p.textContent(".sgb-where"), "Filter");
  // a finger dragged sideways over a video tile scrubs its filmstrip and does not open it
  await p.waitForTimeout(300);
  const th = await p.locator(".sgb-tile[data-ver='78'] .th").boundingBox();
  const y = th.y + th.height / 2;
  await touch("touchStart", [[th.x + 5, y]]); await p.waitForTimeout(400);
  for (let i = 1; i <= 8; i++){ await touch("touchMove", [[th.x + 5 + (th.width - 15) * i / 8, y]]); await p.waitForTimeout(40); }
  const scr = await p.evaluate(() => { const t = document.querySelector(".sgb-tile[data-ver='78']"); return [t.classList.contains("scrub"), t.querySelector(".strip").style.backgroundPosition]; });
  await touch("touchEnd", []);
  await p.waitForTimeout(500);
  assert.deepStrictEqual(scr, [true, "100% 0%"], "filmstrip scrubbed to its last frame");
  assert.strictEqual(await p.evaluate(() => !!(window.__sightReview.R)), false, "a drag does not open the Version");
  assert.strictEqual(await p.evaluate(() => document.querySelector(".hometabs .on").dataset.p), KEY, "a drag on a tile does not switch the page");
  await p.tap(".sgb-types button[data-t='Shot']");
  await p.waitForTimeout(600);
  assert.deepStrictEqual(await p.$$eval(".sgb-tile b", (x) => x.map((e) => e.textContent)), ["sh010_comp_v003", "sh020_anim_v001"]);
  await p.selectOption(".sgb-ent", "502"); await p.waitForTimeout(600);
  assert.deepStrictEqual(await p.$$eval(".sgb-tile b", (x) => x.map((e) => e.textContent)), ["sh020_anim_v001"]);
  const cached = await p.evaluate(async () => (await (await caches.open("sight-review-sgthumbs")).keys()).length);
  assert.strictEqual(cached, 4, "3 thumbnails + the filmstrip cached");
  await p.tap(".sgb-tile[data-ver='78']");
  await p.waitForFunction((k) => window.__sightReview.R && window.__sightReview.R.meta.trk && window.__sightReview.R.meta.trk[k], KEY, { timeout: 15000 });
  assert.deepStrictEqual(await p.evaluate((k) => [window.__sightReview.R.meta.asset.name, window.__sightReview.R.meta.trk[k].link.version.code, "sg" in window.__sightReview.R.meta], KEY), ["sh020_anim_v001.png", "sh020_anim_v001", false]);
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
  // Filter when the Version schema cannot be read: the page loads without the conditions and says so; Filter offers
  // to clear them (they cannot be shown)
  const fieldsUrl = site + "/api/v1.1/schema/versions/fields", hostKey = new URL(site).host + " 70";
  const msgText = () => p.textContent(".sgb-msg");
  await p.evaluate((k) => { localStorage.setItem("sight-review:sgwhere", JSON.stringify({ [k]: { op: "and", c: [{ f: "sg_status_list", o: "is", v: "apr" }] } }));
    localStorage.setItem("sight-review:sgfilter", JSON.stringify({ project: "70" })); sessionStorage.setItem("sight-review:page", "shotgrid:" + k.split(" ")[0]); }, hostKey);
  await p.route(fieldsUrl, (r) => r.fulfill({ status: 500, headers: { "Access-Control-Allow-Origin": "*" }, contentType: "application/json", body: JSON.stringify({ errors: [{ title: "schema down" }] }) }));
  await p.goto(base);
  await waitTiles(["sh010_comp_v003", "robot_model_v002", "sh020_anim_v001"], "no schema: loaded without the conditions");
  assert.ok(/Filter not applied.*schema down/.test(await msgText()), "the page says the filter is not applied: " + await msgText());
  await p.tap(".sgb-where");
  await p.tap('.sheet button:has-text("Clear the filter")');
  await p.waitForSelector(".sheet", { state: "detached" });
  await p.waitForFunction(() => document.querySelector(".sgb-where").textContent === "Filter" && !/Filter not applied|Loading/.test(document.querySelector(".sgb-msg").textContent), null, { timeout: 8000 });
  assert.strictEqual(await p.evaluate((k) => k in JSON.parse(localStorage.getItem("sight-review:sgwhere")), hostKey), false, "cleared");
  await p.unroute(fieldsUrl);
  // a status field without schema choices and no Version seen: typed; a second typed status still reloads (each tree
  // is compared with the fields its own values give)
  await p.route(fieldsUrl, async (r) => { const res = await r.fetch(); const j = await res.json(); delete j.data.sg_status_list.properties; await r.fulfill({ response: res, json: j }); });
  await p.evaluate(() => localStorage.setItem("sight-review:sgfilter", JSON.stringify({ project: "70", q: "zzz" })));
  await p.goto(base);
  await p.waitForFunction(() => /No Version matches/.test(document.querySelector(".sgb-msg").textContent), null, { timeout: 8000 });
  const until = async (fn, why) => { for (let i = 0; i < 80; i++){ if (fn()) return; await p.waitForTimeout(100); } assert.fail(why); };
  const lastWhere = () => { const x = searches[searches.length - 1].filters; return Array.isArray(x) ? null : x.conditions[x.conditions.length - 1]; };
  await p.tap(".sgb-where");
  await p.tap('.flt-sheet .flt-gacts button[data-act="add"]');
  await p.selectOption('.flt-sheet .flt-row[data-path="0"] .flt-f', "sg_status_list");
  assert.strictEqual(await p.$eval('.flt-sheet .flt-row[data-path="0"] .flt-v', (x) => x.tagName + ":" + x.type), "INPUT:text", "no choices, none seen: typed");
  await p.fill('.flt-sheet .flt-row[data-path="0"] .flt-v', "rev");
  await until(() => JSON.stringify(lastWhere()) === JSON.stringify({ logical_operator: "and", conditions: [{ path: "sg_status_list", relation: "is", values: ["rev"] }] }), "first typed status sent");
  await p.tap('.flt-sheet .flt-group.root > .flt-gacts button[data-act="add"]');
  await p.selectOption('.flt-sheet .flt-row[data-path="1"] .flt-f', "sg_status_list");
  await p.fill('.flt-sheet .flt-row[data-path="1"] .flt-v', "apr");
  await until(() => (lastWhere() || { conditions: [] }).conditions.length === 2, "the second typed status reloads: " + JSON.stringify(lastWhere()));
  assert.strictEqual(await p.textContent(".sgb-where"), "Filter · 2");
  await p.tap('.flt-sheet button[data-act="clear"]');
  await p.tap('.flt-sheet button:has-text("Done")');
  await p.unroute(fieldsUrl);
  await p.evaluate(() => localStorage.setItem("sight-review:sgfilter", JSON.stringify({ project: "70" })));
  // Disconnect (Settings → Trackers) on the home screen: the ShotGrid tab goes at once, the swipe does nothing
  await p.goto(base); await p.waitForSelector(".hometabs");
  await p.tap('.bar button[title="Settings"]');
  await p.tap('.sheet button:has-text("Disconnect ShotGrid")');
  await p.waitForSelector(".hometabs", { state: "detached" });
  assert.strictEqual(await p.locator("main.sgb").count(), 0, "the ShotGrid page is gone");
  await touch("touchStart", [[300, 600]]); for (let i = 1; i <= 8; i++){ await touch("touchMove", [[300 - 25 * i, 600]]); await p.waitForTimeout(16); } await touch("touchEnd", []);
  await p.waitForTimeout(300);
  assert.ok(await p.evaluate(() => !document.querySelector("main.sgb") && !document.querySelector("main:not(.sgb)").hidden), "no swipe to ShotGrid");
  assert.strictEqual(await p.evaluate(() => JSON.parse(localStorage.getItem("sight-review:sg")).site), site, "a disconnect keeps the site");
  assert.deepStrictEqual(errs, []);
  console.log(JSON.stringify({ ok: true }));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
