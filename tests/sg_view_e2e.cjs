// ShotGrid Versions in the library grid (docs/PLAN-trackers.md stage 3a), in Chromium: ShotGrid under Sources → a
// project → its Versions as library tiles; Fields ▾ adds a field to the captions; the filmstrip follows the pointer
// (letterboxed to the frame's aspect); the inspector shows a Version's fields; the top search box filters by name;
// a double-click downloads the Version's media as a library file, links its review and opens it; the lightbox's
// arrows step through the Versions (each downloaded in turn); a library row returns to the library. Filter ▾ (stage
// 3b): conditions on Version fields (sent to ShotGrid as hash filters) and on library fields (the server's). Smart
// collections (stage 3c): conditions saved under the project / under Collections, opened, edited, renamed, deleted.
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
  // Filter ▾ (stage 3b): Status is Approved → 79; Any + Link contains sh020 → 78, 79; Clear → all three
  const cards = (n) => p.waitForFunction((k) => document.querySelectorAll(".card").length === k, n, { timeout: 8000 });
  await p.click("#filterBtn"); await p.waitForSelector("#filterPop [data-act=add]");
  await p.click("#filterPop [data-act=add]");
  await p.selectOption("#filterPop .flt-row .flt-f", "sg_status_list");
  assert.strictEqual(await p.$eval("#filterPop .flt-row .flt-o", (e) => e.value), "is");
  assert.ok((await p.$$eval("#filterPop .flt-row .flt-v option", (x) => x.map((o) => o.textContent))).includes("Approved"), "the schema's status labels");
  await p.selectOption("#filterPop .flt-row .flt-v", "apr");
  await cards(1);
  assert.deepStrictEqual(await ids(), ["sg:79"]);
  assert.strictEqual((await p.textContent("#filterBtn")).replace("›", "").trim(), "Filter · 1");
  await p.selectOption("#filterPop .flt-join", "or");
  await p.click("#filterPop .flt-group.root > .flt-gacts [data-act=add]");
  const row2 = p.locator("#filterPop .flt-row").nth(1);
  await row2.locator(".flt-f").selectOption("entity");
  await row2.locator(".flt-v").fill("sh020");
  await cards(2);
  assert.deepStrictEqual((await ids()).sort(), ["sg:78", "sg:79"]);
  await p.$eval(".card[data-id='sg:78']", (e) => { e.dataset.keep = "1"; });
  await p.click("#filterPop .flt-group.root > .flt-gacts [data-act=addg]");   // a group of two empty rows: nothing changes
  assert.strictEqual(await p.$$eval("#filterPop .flt-group:not(.root) .flt-row.incomplete", (x) => x.length), 2);
  await p.waitForTimeout(400);
  assert.strictEqual((await ids()).length, 2);
  assert.ok(await p.$(".card[data-id='sg:78'][data-keep='1']"), "no reload for rows that filter nothing yet");
  await p.click("#filterPop .flt-group.root > .flt-gacts [data-act=clear]");
  await cards(3);
  await p.keyboard.press("Escape");
  assert.ok(await p.isHidden("#filterPop"));
  // a ShotGrid smart collection: Status is Approved saved under the project
  const btnText = async () => (await p.textContent("#filterBtn")).replace("›", "").trim();
  const smartOf = async (name) => (await (await fetch(base + "/api/collections")).json()).find((c) => c.name === name);
  await p.click("#filterBtn"); await p.waitForSelector("#filterPop [data-act=add]");
  assert.ok(await p.isDisabled("#filterPop [data-act=smart]"), "nothing to save yet");
  await p.click("#filterPop [data-act=add]");
  await p.selectOption("#filterPop .flt-row .flt-f", "sg_status_list");
  await p.selectOption("#filterPop .flt-row .flt-v", "apr");
  await cards(1);
  await p.click("#filterPop [data-act=smart]");
  await p.fill("#filterPop .flt-name", "Approved");
  await p.press("#filterPop .flt-name", "Enter");
  await p.waitForSelector(".sg-smart.on", { timeout: 5000 });
  assert.ok(await p.isHidden("#filterPop"));
  assert.strictEqual((await p.textContent(".sg-smart.on")).replace("×", "").trim(), "Approved");
  assert.ok(!(await p.$(".sg-proj[data-sgp='70'].on")), "the smart row is the current one, not the project");
  const sgs = await smartOf("Approved");
  assert.deepStrictEqual([sgs.sgProject, sgs.rule.c[0].v], [70, "apr"]);
  assert.ok(!(await p.$(`.col-row[data-cid='${sgs.id}']`)), "not under Collections");
  assert.strictEqual(await btnText(), "Filter · 1");
  // the project itself: its own conditions (cleared by the save) → all three; the smart row again → one
  await p.click(".sg-proj[data-sgp='70']"); await cards(3);
  assert.strictEqual(await btnText(), "Filter");
  await p.click(".sg-smart"); await cards(1);
  assert.deepStrictEqual(await ids(), ["sg:79"]);
  // Filter ▾ edits the smart collection while it is open
  await p.click("#filterBtn"); await p.waitForSelector("#filterPop .flt-smart");
  assert.ok(/Approved/.test(await p.textContent("#filterPop .flt-smart")));
  await p.selectOption("#filterPop .flt-row .flt-o", "is_not");
  await cards(2);
  for (let k = 0; k < 20 && (await smartOf("Approved")).rule.c[0].o !== "is_not"; k++) await p.waitForTimeout(150);
  assert.strictEqual((await smartOf("Approved")).rule.c[0].o, "is_not", "saved with the collection");
  await p.keyboard.press("Escape");
  // rename by double-click, then delete: the project's own conditions again
  await p.dblclick(".sg-smart");
  await p.waitForSelector(".sg-smart input");
  await p.fill(".sg-smart input", "Not approved"); await p.press(".sg-smart input", "Enter");
  await p.waitForFunction(() => /Not approved/.test(document.querySelector(".sg-smart")?.textContent || ""), null, { timeout: 5000 });
  await p.click(".sg-smart [data-act=del]");
  await p.waitForFunction(() => !document.querySelector(".sg-smart"), null, { timeout: 5000 });
  await cards(3);
  assert.strictEqual(await btnText(), "Filter");
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
  // the library's own conditions (evaluated by Sight's server): Name contains sh0 → sh010.png; doesn't contain → none
  await p.waitForFunction(() => document.querySelectorAll(".card").length === 1, null, { timeout: 8000 });
  await p.click("#filterBtn"); await p.waitForSelector("#filterPop [data-act=add]");
  assert.strictEqual(await p.$$eval("#filterPop .flt-row", (x) => x.length), 0, "the ShotGrid conditions stay with ShotGrid");
  await p.click("#filterPop [data-act=add]");
  await p.selectOption("#filterPop .flt-row .flt-f", "name");
  await p.fill("#filterPop .flt-row .flt-v", "sh0");
  await p.waitForTimeout(700);
  assert.strictEqual(await p.$$eval(".card", (x) => x.length), 1);
  await p.selectOption("#filterPop .flt-row .flt-o", "not_contains");
  await cards(0);
  assert.strictEqual(await p.$eval("#filterPop .flt-row .flt-v", (e) => e.value), "sh0", "the value stays when the operator takes the same kind");
  await p.click("#filterPop [data-act=add]");
  await p.selectOption("#filterPop .flt-join", "or");
  const r2 = p.locator("#filterPop .flt-row").nth(1);
  await r2.locator(".flt-f").selectOption("kind");
  await r2.locator(".flt-v").selectOption("image");
  await cards(1);
  await p.click("#filterPop [data-act=clear]");
  await cards(1);
  assert.strictEqual((await p.textContent("#filterBtn")).replace("›", "").trim(), "Filter");
  // a library smart collection: Name contains "no such name" saved under Collections (the downloaded Versions are
  // library files too: "All" shows more than one)
  const some = () => p.waitForFunction(() => document.querySelectorAll(".card").length > 0, null, { timeout: 8000 });
  await p.click("#filterPop [data-act=add]");
  await p.selectOption("#filterPop .flt-row .flt-f", "name");
  await p.fill("#filterPop .flt-row .flt-v", "no such name");
  await cards(0);
  await p.click("#filterPop [data-act=smart]");
  await p.click("#filterPop [data-act=save]");   // (no name typed: a default one)
  await p.waitForSelector(".col-row.smart-row.on", { timeout: 5000 });
  assert.strictEqual((await p.textContent(".col-row.smart-row.on")).replace("×", "").trim(), "Smart collection");
  assert.strictEqual(await p.$$eval(".col-row.smart-row [data-act=add], .col-row.smart-row .badge", (x) => x.length), 0, "no members, nothing nests");
  await cards(0);
  await p.click("#nav .row:has-text('All')"); await some();
  assert.strictEqual((await p.textContent("#filterBtn")).replace("›", "").trim(), "Filter", "leaving it: the free conditions (none)");
  await p.click("#filterBtn"); await p.waitForSelector("#filterPop [data-act=add]");
  assert.strictEqual(await p.$$eval("#filterPop .flt-row", (x) => x.length), 0, "the free conditions went into the smart collection");
  await p.keyboard.press("Escape");
  await p.click(".col-row.smart-row"); await cards(0);
  assert.strictEqual((await p.textContent("#filterBtn")).replace("›", "").trim(), "Filter · 1");
  await p.click(".col-row.smart-row [data-act=del]");
  await p.waitForFunction(() => !document.querySelector(".col-row.smart-row"), null, { timeout: 5000 });
  await some();   // (back to All)
  assert.ok(await p.$("#nav .row.on:has-text('All')"));
  assert.strictEqual((await p.textContent("#filterBtn")).replace("›", "").trim(), "Filter");
  assert.deepStrictEqual(errs, []);
  console.log("sg_view: ok");
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
