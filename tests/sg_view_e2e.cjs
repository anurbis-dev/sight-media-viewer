// Sight's ShotGrid view (docs/PLAN-trackers.md stage 2) in Chromium: ShotGrid under Sources → a project → the Versions
// grid; Fields ▾ adds a field to the tiles; the filmstrip follows the pointer; Shots / entity filter; a double-click
// downloads the Version's media into the library, links its review and opens it; the media cache source stays hidden.
// Run by tests/test_shotgrid.py:  node tests/sg_view_e2e.cjs <sightBase> <fakeSite>
const { chromium } = require("playwright");
const assert = require("assert");
const [base, site] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
  await p.goto(base + "/");
  await p.waitForSelector(".sg-src", { timeout: 20000 });
  await p.click(".sg-src");
  await p.waitForSelector(".sg-proj[data-sgp='70']");
  await p.click(".sg-proj[data-sgp='70']");
  await p.waitForSelector(".sgv-tile");
  await p.waitForTimeout(800);
  assert.deepStrictEqual(await p.$$eval(".sgv-tile", (x) => x.map((e) => e.dataset.ver)), ["77", "79", "78"]);
  // Fields: add Description
  await p.click(".sgv-fields");
  await p.waitForSelector(".sgv-flist [data-f='description']");
  assert.ok((await p.$$eval(".sgv-flist [data-f]", (x) => x.map((e) => e.dataset.f))).includes("description"));
  await p.check(".sgv-flist [data-f='description']");
  await p.waitForTimeout(800);
  assert.match(await p.textContent(".sgv-tile[data-ver='78'] .cap"), /Blocking pass/);
  await p.click(".sgv-fields");
  // filmstrip scrub on v78
  const t = await p.locator(".sgv-tile[data-ver='78'] .th").boundingBox();
  await p.mouse.move(t.x + 5, t.y + t.height / 2); await p.waitForTimeout(500);
  await p.mouse.move(t.x + t.width * 0.9, t.y + t.height / 2, { steps: 3 }); await p.waitForTimeout(100);
  const scr = await p.evaluate(() => { const s = document.querySelector(".sgv-tile[data-ver='78'] .strip"); return [s.parentElement.parentElement.classList.contains("scrub"), s.style.backgroundPosition, s.style.backgroundSize]; });
  assert.deepStrictEqual(scr, [true, "100% 0%", "400% 100%"], "filmstrip under the pointer");
  
  // filter Shots → entity sh020
  await p.click(".sgv-seg button[data-t='Shot']"); await p.waitForTimeout(600);
  await p.selectOption(".sgv-ent", "502"); await p.waitForTimeout(600);
  assert.deepStrictEqual(await p.$$eval(".sgv-tile", (x) => x.map((e) => e.dataset.ver)), ["78"]);
  // open
  await p.dblclick(".sgv-tile[data-ver='78']");
  await p.waitForSelector(".an-panel, #light", { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const assets = await (await fetch(base + "/api/assets?limit=50")).json();
  const a = assets.items.find((x) => x.name.startsWith("sh020_anim_v001"));
  assert.ok(a, "the Version's media is a library file");
  assert.strictEqual((await (await fetch(base + "/api/sg/link/" + a.id)).json()).link.version.code, "sh020_anim_v001");
  // the cache source is not listed under Sources
  await p.keyboard.press("Escape"); await p.waitForTimeout(500);
  const rows = await p.$$eval(".src-row", (x) => x.map((e) => e.textContent));
  assert.ok(rows.some((r) => r.startsWith("ShotGrid")), "ShotGrid under Sources");
  assert.ok(!rows.some((r) => /^\s*media\b/.test(r)), "the media cache source (…/sg_cache/media) is not listed: " + rows.join(" | "));
  assert.ok(rows.some((r) => /clips/.test(r)), "the library's own source still listed");
  assert.deepStrictEqual(errs, []);
  console.log("sg_view: ok");
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
