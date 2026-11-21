// Tracker UI only for a connected tracker (docs/PLAN-trackers.md stage 5a, decision 10), in Chromium against Sight
// with ShotGrid NOT connected (site + script saved, no key): no ShotGrid source, no tracker row in the You panel, no
// SG ▾ in the review panel; Settings → Trackers offers only Connect a tracker…. Connecting (the API, then the You
// panel's re-check) brings SG ▾ in the open lightbox at once; Settings → Trackers → Connect a tracker… → ShotGrid →
// Save brings the sidebar source live; a project open → Disconnect closes it and every control goes; a phone-size
// window shows none either. Leaves ShotGrid disconnected (tests/test_shotgrid.py restores it).
// Run by tests/test_shotgrid.py:  node tests/trackers_e2e.cjs <sightBase> <fakeSite>
const { chromium } = require("playwright");
const assert = require("assert");
const [base, site] = process.argv.slice(2);
const put = (body) => fetch(base + "/api/sg/config", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  .then((r) => { assert.strictEqual(r.status, 200); });
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
  await p.goto(base + "/");
  await p.waitForSelector(".card[data-id]", { timeout: 20000 });
  await p.waitForSelector("#trkAdd", { state: "attached" });
  await p.waitForTimeout(500);   // (refreshTrackers' first answer)
  assert.strictEqual(await p.locator(".sg-src").count(), 0, "no ShotGrid source while not connected");
  // You panel: the name, no Trackers part
  await p.click("#userBtn"); await p.waitForSelector("#userPop:not([hidden])");
  assert.strictEqual(await p.locator("#userPop .trk").count(), 0);
  assert.ok(!/ShotGrid|Trackers/.test(await p.textContent("#userPop")), "the You panel names no tracker");
  await p.click("#userBtn"); await p.waitForSelector("#userPop", { state: "hidden" });
  // the lightbox's review panel: no SG ▾
  await p.dblclick(".card[data-id]");
  await p.waitForSelector(".light", { state: "attached", timeout: 10000 });
  await p.waitForTimeout(400);
  if (!(await p.locator(".an-panel:not([hidden])").count())){ await p.keyboard.press("c"); }
  await p.waitForSelector(".an-panel:not([hidden])");
  assert.ok(await p.locator(".an-panel [data-act=sg]").isHidden(), "no SG ▾ while not connected");
  // connected elsewhere (the API) → the You panel's re-check → SG ▾ comes live, the You panel lists ShotGrid
  await put({ site, script: "sight", key: "secret", logins: { "Bob Smith": "bob" }, sudo: true });
  await p.click(".an-panel .an-user");
  await p.waitForSelector(".an-panel [data-act=sg]", { state: "visible", timeout: 5000 });
  await p.waitForSelector("#userPop .trk[data-tracker='shotgrid']");
  assert.ok(/as reviewer/.test(await p.textContent("#userPop .trk")));
  await p.click(".an-panel .an-user"); await p.waitForSelector("#userPop", { state: "hidden" });
  // the SG ▾ popover open, then disconnected → both go
  await p.click(".an-panel [data-act=sg]"); await p.waitForSelector(".an-panel .an-sg:not([hidden])");
  await put({ site, script: "sight", key: "", logins: { "Bob Smith": "bob" }, sudo: true });
  await p.click(".an-panel .an-user");
  await p.waitForSelector(".an-panel [data-act=sg]", { state: "hidden", timeout: 5000 });
  assert.ok(await p.locator(".an-panel .an-sg").isHidden());
  await p.click(".an-panel .an-user"); await p.waitForSelector("#userPop", { state: "hidden" });
  await p.keyboard.press("Escape"); await p.waitForSelector(".light", { state: "detached", timeout: 5000 }).catch(() => {});
  // Settings → Trackers: none connected, Connect a tracker… → ShotGrid → its fields → Save → the source comes live
  if (await p.locator("#settingsBody[hidden]").count()) await p.click("#settingsHead");
  await p.waitForSelector("#trkAdd", { state: "visible" });
  assert.ok(await p.locator("#trkSg").isHidden(), "no ShotGrid block while not connected");
  assert.ok(await p.locator("#trkNone").isVisible());
  await p.click("#trkAdd"); await p.click("#trkKinds [data-kind=shotgrid]");
  await p.waitForSelector("#trkSg", { state: "visible" });
  assert.ok(await p.locator("#sgCancel").isVisible() && await p.locator("#sgDisconnect").isHidden() && await p.locator("#sgCacheSet").isHidden());
  assert.ok(await p.locator("#trkAddRow").isHidden(), "nothing else to connect while ShotGrid's fields are open");
  assert.strictEqual(await p.inputValue("#sgSite"), site, "a disconnect kept the site");
  await p.fill("#sgKey", "secret");
  await p.click("#sgSave");
  await p.waitForSelector(".sg-src", { timeout: 5000 });
  await p.waitForSelector("#sgDisconnect", { state: "visible" });
  assert.ok(/connected/.test(await p.textContent("#sgState")) && await p.locator("#sgCacheSet").isVisible());
  // saving only the logins keeps the sidebar's open tree (the projects are not dropped)
  await p.click("#settingsHead");   // (the open Settings cover the sources)
  await p.click(".sg-src"); await p.waitForSelector(".sg-proj[data-sgp='70']");
  await p.click("#settingsHead"); await p.waitForSelector("#sgSave", { state: "visible" });
  await p.fill("#sgLogins", "Bob Smith = bob\nAnn Lee = ann");
  await p.click("#sgSave");
  await p.waitForFunction(() => /Saved/.test(document.querySelector("#sgMsg").textContent), null, { timeout: 5000 });
  assert.strictEqual(await p.locator(".sg-proj[data-sgp='70']").count(), 1, "a logins-only save keeps the projects listed");
  // a Version downloaded (the tracker media cache), a project open → Disconnect → back to the library, no source,
  // Filter ▾ on library fields; an unsaved form edit is not saved by the Disconnect
  const opened = await fetch(base + "/api/sg/open/78", { method: "POST", headers: { "X-Sight": "1" } });
  assert.strictEqual(opened.status, 200);
  await p.click("#settingsHead");
  await p.click(".sg-proj[data-sgp='70']");
  await p.waitForSelector(".card[data-id^='sg:']", { timeout: 10000 });
  await p.click("#settingsHead"); await p.waitForSelector("#sgDisconnect", { state: "visible" });
  assert.ok(await p.locator("#trkCacheRow").isHidden(), "connected: the cache is in ShotGrid's block");
  await p.fill("#sgScript", "not-saved");
  await p.click("#sgDisconnect");
  await p.waitForSelector(".sg-src", { state: "detached", timeout: 5000 });
  await p.waitForFunction(() => !document.querySelector(".card[data-id^='sg:']") && document.querySelectorAll(".card[data-id]").length > 0, null, { timeout: 8000 });
  assert.ok(await p.locator("#sgBar").isHidden());
  assert.ok(await p.locator("#trkSg").isHidden() && await p.locator("#trkAdd").isVisible());
  const st = await (await fetch(base + "/api/sg/status")).json();
  assert.deepStrictEqual([st.configured, st.script, st.logins["Ann Lee"]], [false, "sight", "ann"], "Disconnect kept the stored settings, not the form's edit");
  // disconnected: the downloaded media can still be cleared
  await p.waitForSelector("#trkCacheRow", { state: "visible", timeout: 5000 });
  assert.ok(/Tracker media cache/.test(await p.textContent("#trkCacheInfo")));
  await p.click("#trkCacheClear");
  await p.waitForSelector("#trkCacheRow", { state: "hidden", timeout: 5000 });
  assert.strictEqual((await (await fetch(base + "/api/sg/cache")).json()).files, 0);
  await p.click("#settingsHead");
  await p.click("#filterBtn"); await p.waitForSelector("#filterPop [data-act=add]");
  await p.click("#filterPop [data-act=add]");
  const fields = await p.$$eval("#filterPop .flt-row .flt-f option", (x) => x.map((o) => o.value));
  assert.ok(fields.includes("name") && !fields.includes("sg_status_list"), "library fields only: " + fields.join(","));
  await p.click("#filterPop .flt-group.root > .flt-gacts [data-act=clear]");
  await p.keyboard.press("Escape");
  // a connect / disconnect made elsewhere shows when the window comes back (visibilitychange / focus)
  await put({ site, script: "sight", key: "secret", logins: { "Bob Smith": "bob" }, sudo: true });
  await p.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await p.waitForSelector(".sg-src", { timeout: 5000 });
  await put({ site, script: "sight", key: "", logins: { "Bob Smith": "bob" }, sudo: true });
  await p.evaluate(() => window.dispatchEvent(new Event("focus")));
  await p.waitForSelector(".sg-src", { state: "detached", timeout: 5000 });
  // a phone-size window: none of it either
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const m = await ctx.newPage(); m.on("pageerror", (e) => errs.push("phone: " + e.message));
  await m.goto(base + "/");
  await m.waitForSelector("#trkAdd", { state: "attached", timeout: 20000 });
  await m.waitForTimeout(500);
  assert.strictEqual(await m.locator(".sg-src").count(), 0);
  assert.ok(await m.locator("#trkSg").isHidden());
  assert.deepStrictEqual(errs, []);
  console.log(JSON.stringify({ ok: true }));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
