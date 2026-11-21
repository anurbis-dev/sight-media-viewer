// ShotGrid Versions in the library grid (docs/PLAN-trackers.md stage 3a), in Chromium: ShotGrid under Sources → a
// project → its Versions as library tiles; Fields ▾ adds a field to the captions; the filmstrip follows the pointer
// (letterboxed to the frame's aspect); the inspector shows a Version's fields; the top search box filters by name;
// a double-click downloads the Version's media as a library file, links its review and opens it; the lightbox's
// arrows step through the Versions (each downloaded in turn); a library row returns to the library.
// Run by tests/test_shotgrid.py:  node tests/sg_view_e2e.cjs <sightBase> <fakeSite>
const { chromium } = require("playwright");
const assert = require("assert");
const [base] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
  const ids = () => p.$$eval(".card", (x) => x.map((e) => e.dataset.id));
  await p.goto(base + "/");
  await p.waitForSelector(".sg-src", { timeout: 20000 });
  await p.click(".sg-src"); await p.waitForSelector(".sg-proj[data-sgp='70']"); await p.click(".sg-proj[data-sgp='70']");
  await p.waitForSelector(".card[data-id='sg:78']", { timeout: 10000 });
  assert.deepStrictEqual(await ids(), ["sg:77", "sg:79", "sg:78"]);
  assert.ok(await p.isVisible("#sgBar"));
  // Fields: Description on the captions
  await p.click(".sgb-fields");
  await p.waitForSelector(".sgb-flist [data-f='description']");
  await p.check(".sgb-flist [data-f='description']");
  await p.waitForFunction(() => /Blocking pass/.test(document.querySelector(".card[data-id='sg:78'] .meta")?.textContent || ""), null, { timeout: 8000 });
  await p.click(".sgb-fields");
  // inspector
  await p.click(".card[data-id='sg:78']");
  await p.waitForFunction(() => /ShotGrid Version/.test(document.querySelector("#insp")?.textContent || "") && /Status/.test(document.querySelector("#insp")?.textContent || ""), null, { timeout: 5000 });
  // filmstrip under the pointer
  const t = await p.locator(".card[data-id='sg:78'] .thumb").boundingBox();
  await p.mouse.move(t.x + 5, t.y + t.height / 2); await p.waitForTimeout(500);
  await p.mouse.move(t.x + t.width * 0.95, t.y + t.height / 2, { steps: 3 });
  const scr = await p.evaluate(() => { const c = document.querySelector(".card[data-id='sg:78']"), s = c.querySelector(".sg-strip"); return [c.classList.contains("sg-scrub"), s.style.backgroundPosition, s.style.aspectRatio]; });
  assert.deepStrictEqual(scr, [true, "100% 0%", "240 / 135"]);
  // the top search box filters by name
  await p.fill("#q", "robot"); await p.waitForFunction(() => document.querySelectorAll(".card").length === 1, null, { timeout: 5000 });
  assert.deepStrictEqual(await ids(), ["sg:79"]);
  await p.fill("#q", ""); await p.waitForFunction(() => document.querySelectorAll(".card").length === 3, null, { timeout: 5000 });
  // Shots → sh020
  await p.click(".sgb-seg button[data-t='Shot']"); await p.waitForFunction(() => document.querySelectorAll(".card").length === 2);
  await p.selectOption(".sgb-ent", "502"); await p.waitForFunction(() => document.querySelectorAll(".card").length === 1);
  assert.deepStrictEqual(await ids(), ["sg:78"]);
  await p.click(".sgb-seg button[data-t='']"); await p.waitForFunction(() => document.querySelectorAll(".card").length === 3);
  // open the middle one, then → steps to the next Version
  const names = async () => (await (await fetch(base + "/api/assets?limit=50")).json()).items.map((x) => x.name);
  await p.dblclick(".card[data-id='sg:79']");
  await p.waitForFunction(async () => !!document.querySelector("#light"), null, { timeout: 15000 });
  await p.waitForTimeout(800);
  assert.ok((await names()).some((n) => n.startsWith("robot_model_v002")), "79 downloaded");
  await p.keyboard.press("ArrowRight");
  for (let k = 0; k < 30 && !(await names()).some((n) => n.startsWith("sh020_anim_v001")); k++) await p.waitForTimeout(300);
  const a = (await (await fetch(base + "/api/assets?limit=50")).json()).items.find((x) => x.name.startsWith("sh020_anim_v001"));
  assert.ok(a, "→ in the lightbox opened the next Version (78)");
  assert.strictEqual((await (await fetch(base + "/api/sg/link/" + a.id)).json()).link.version.code, "sh020_anim_v001");
  await p.keyboard.press("Escape"); await p.waitForTimeout(600);
  // a library row: back to the library
  const rows = await p.$$eval(".src-row", (x) => x.map((e) => e.textContent));
  assert.ok(!rows.some((r) => /^\s*media\b/.test(r)), "the media cache source is not listed: " + rows.join(" | "));
  await p.click(".src-row:not(.sg-src)");
  await p.waitForFunction(() => !document.querySelector(".card[data-id^='sg:']"), null, { timeout: 5000 });
  assert.ok(await p.isHidden("#sgBar"));
  assert.deepStrictEqual(errs, []);
  console.log("sg_view: ok");
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
