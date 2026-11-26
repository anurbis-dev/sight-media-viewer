// Coreline in Sight's browser UI (docs/CORELINE.md), in Chromium against the fake Coreline (tests/cl_fake_server.cjs):
// Settings → Trackers → Connect a tracker… → Coreline (server + API key) → Save; Coreline under Sources → project
// Demo → its Versions as library tiles (thumbnails, the scrub sprite as a filmstrip, the status filter, the inspector);
// a double-click downloads the original and opens it; the review panel's CL ▾ shows the link, Sync now pulls a note
// written on Coreline and sends one written here. Then the same on a touch screen (taps, no keyboard).
// Run by tests/test_coreline.py:  node tests/cl_view_e2e.cjs <sightBase> <fakeSite>
const { chromium } = require("playwright");
const assert = require("assert");
const [base, site] = process.argv.slice(2);
const CL = ".trk-set[data-tracker=coreline]";
const KEY = "coreline:" + new URL(site).host;
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  const ids = () => p.$$eval(".card", (x) => x.map((e) => e.dataset.id));
  await p.goto(base + "/");
  await p.waitForSelector("#trkAdd", { state: "attached", timeout: 20000 });
  await p.waitForTimeout(500);
  assert.strictEqual(await p.locator(`.trk-src[data-tracker='${KEY}']`).count(), 0, "not connected yet (no key): no source");
  // connect through the settings form
  if (await p.locator("#settingsBody[hidden]").count()) await p.click("#settingsHead");
  await p.click("#trkAdd"); await p.click("#trkKinds [data-kind=coreline]");
  await p.waitForSelector(CL, { state: "visible" });
  const form = await p.$$eval(CL + " label", (ls) => ls.map((l) => { const i = l.querySelector("input"); return [l.firstChild.textContent.trim(), i.type, i.name]; }));
  assert.deepStrictEqual(form, [["Server", "url", "site"], ["API key", "password", "key"], ["Media cache limit (GB)", "number", "cacheLimitGB"]]);
  assert.strictEqual(await p.inputValue(CL + " [name=site]"), site, "the stored server is offered");
  await p.fill(CL + " [name=key]", "clkey");
  await p.click(CL + " [data-act=save]");
  await p.waitForSelector(`.trk-src[data-tracker='${KEY}']`, { timeout: 8000 });
  await p.waitForSelector(CL + " [data-act=disconnect]", { state: "visible" });
  assert.strictEqual(await p.inputValue(CL + " [name=key]"), "", "the key is never shown back");
  await p.click("#settingsHead");
  // the project's Versions
  await p.click(`.trk-src[data-tracker='${KEY}']`);
  await p.waitForSelector(`.trk-proj[data-tracker='${KEY}'][data-proj='1']`); await p.click(`.trk-proj[data-tracker='${KEY}'][data-proj='1']`);
  await p.waitForSelector(".card[data-id='trk:version:24:media']", { timeout: 10000 });
  assert.deepStrictEqual(await ids(), ["trk:version:23:media", "trk:version:22:media", "trk:version:21:media", "trk:version:24:media"]);
  await p.waitForFunction(() => { const i = document.querySelector(".card[data-id='trk:version:21:media'] img"); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 8000 });
  // the scrub sprite as a filmstrip under the pointer
  const t = await p.locator(".card[data-id='trk:version:22:media'] .thumb").boundingBox();
  await p.mouse.move(t.x + 5, t.y + t.height / 2); await p.waitForTimeout(600);
  await p.mouse.move(t.x + t.width * 0.95, t.y + t.height / 2, { steps: 3 });
  const scr = await p.evaluate(() => { const c = document.querySelector(".card[data-id='trk:version:22:media']"), s = c.querySelector(".trk-strip"); return [c.classList.contains("trk-scrub"), s && s.style.backgroundPosition, s && s.style.aspectRatio]; });
  assert.deepStrictEqual(scr, [true, "100% 0%", "240 / 136"]);
  await p.mouse.move(5, 5);
  // status filter, inspector
  await p.selectOption(".trkb-stat", "apr"); await p.waitForFunction(() => document.querySelectorAll(".card").length === 1, null, { timeout: 5000 });
  assert.deepStrictEqual(await ids(), ["trk:version:23:media"]);
  await p.selectOption(".trkb-stat", ""); await p.waitForFunction(() => document.querySelectorAll(".card").length === 4, null, { timeout: 5000 });
  await p.click(".card[data-id='trk:version:24:media']");
  await p.waitForFunction(() => /Coreline Version/.test(document.querySelector("#insp")?.textContent || ""), null, { timeout: 5000 });
  // a note written on Coreline by another reviewer
  const t0 = Date.now() - 5000;
  await fetch(site + "/__fake/merge/version/24/media", { method: "POST", body: JSON.stringify({ rows: [{ id: "c0ffee00000000aa", kind: "note", shape_kind: null, x: null, y: null, w: null, h: null,
    rotation: 0, z_index: 0, color: null, locked: 0, data: { text: "Hello from Coreline", author: "Ann Lee", created: t0, status: "open", status_at: t0, edited_at: t0, ctx: null, shots: [], replies: [] },
    created_at: t0, updated_at: t0 }] }) });
  // open it: the original downloads, the review panel's CL ▾ is linked
  await p.dblclick(".card[data-id='trk:version:24:media']");
  await p.waitForSelector(".light", { state: "attached", timeout: 15000 });
  await p.waitForTimeout(400);
  if (!(await p.locator(".an-panel:not([hidden])").count())) await p.keyboard.press("c");
  await p.waitForSelector(".an-panel [data-act=trk][data-kind=coreline]", { state: "visible", timeout: 8000 });
  assert.strictEqual((await p.textContent(".an-panel [data-act=trk][data-kind=coreline]")).trim(), "CL ▾");
  await p.click(".an-panel [data-act=trk][data-kind=coreline]");
  await p.waitForFunction(() => /Linked to sh030_light_v001/.test(document.querySelector(".an-panel .an-trk")?.textContent || ""), null, { timeout: 8000 });
  await p.click(".an-panel .an-trk [data-trk=sync]");
  await p.waitForFunction(() => /1 new from Coreline/.test(document.querySelector(".an-panel .an-trk")?.textContent || ""), null, { timeout: 15000 });
  await p.waitForFunction(() => /Hello from Coreline/.test(document.querySelector(".an-panel")?.textContent || ""), null, { timeout: 8000 });
  // a note written here goes to Coreline on the next sync
  assert.strictEqual(await p.getAttribute(".an-panel [data-act=trk][data-kind=coreline]", "data-tracker"), KEY);
  // (the file the lightbox shows: opening it again answers the same cached file)
  const asset = (await (await fetch(base + "/api/trackers/" + encodeURIComponent(KEY) + "/open/version:24:media", { method: "POST", headers: { "X-Sight": "1" } })).json()).asset;
  assert.ok(/sh030_light_v001__c24/.test(asset.name));
  const now = Date.now();
  const r = await fetch(base + "/api/annotations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "beef0000000000aa", kind: "note", scope: "asset", target_asset_id: asset.id,
    data: { text: "Reply from Sight", author: "Bob Smith", created: now, status: "open", status_at: now, edited_at: now, ctx: null, shots: [], replies: [] } }) });
  assert.ok(r.ok, "a note added here");
  await p.click(".an-panel .an-trk [data-trk=sync]");
  await p.waitForFunction(() => /1 sent/.test(document.querySelector(".an-panel .an-trk")?.textContent || ""), null, { timeout: 15000 });
  const db = await (await fetch(site + "/__fake/db")).json();
  assert.ok(db.reviews["version:24:media"].rows.some((x) => x.data && x.data.text === "Reply from Sight"), "on Coreline");
  await p.keyboard.press("Escape");

  // touch, no keyboard: the source, the project, a tile, the link popover and Sync by taps
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
  const m = await ctx.newPage(); m.on("pageerror", (e) => errs.push("touch: " + e.message));
  await m.goto(base + "/");
  await m.waitForSelector(`.trk-src[data-tracker='${KEY}']`, { timeout: 20000 });
  await m.tap(`.trk-src[data-tracker='${KEY}']`);
  await m.waitForSelector(`.trk-proj[data-tracker='${KEY}'][data-proj='1']`); await m.tap(`.trk-proj[data-tracker='${KEY}'][data-proj='1']`);
  await m.waitForSelector(".card[data-id='trk:version:24:media']", { timeout: 10000 });
  await m.tap(".card[data-id='trk:version:24:media']");
  await m.waitForFunction(() => /Coreline Version/.test(document.querySelector("#insp")?.textContent || ""), null, { timeout: 5000 });
  await m.tap(".card[data-id='trk:version:24:media']");   // (a tap on the selected tile opens it)
  await m.waitForSelector(".light", { state: "attached", timeout: 15000 });
  await m.waitForSelector(".an-panel [data-act=trk][data-kind=coreline]", { state: "visible", timeout: 8000 });
  await m.tap(".an-panel [data-act=trk][data-kind=coreline]");
  await m.waitForSelector(".an-panel .an-trk [data-trk=sync]", { state: "visible", timeout: 8000 });
  await m.tap(".an-panel .an-trk [data-trk=sync]");
  await m.waitForFunction(() => /Up to date|from Coreline|sent/.test(document.querySelector(".an-panel .an-trk")?.textContent || ""), null, { timeout: 15000 });
  assert.deepStrictEqual(errs, []);
  console.log(JSON.stringify({ ok: true }));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
