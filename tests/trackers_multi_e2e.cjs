// Two sites of ShotGrid connected at once (docs/PLAN-trackers.md 5b-2 (4), 0.110), in Chromium against Sight with
// site 1 connected: Settings → Trackers → Connect a tracker… still offers ShotGrid (another site); the same site again is
// refused; site 2 saved → two sidebar sources (each with its own projects), two Settings blocks, two link ▾ in the review
// panel ("SG · <host> ▾"); a link and a smart collection are filed per site; Disconnect on site 1's block leaves site 2
// (its source, block, and a plain "SG ▾"), and the old /api/sg/… alias then answers for site 2 (the first connected).
// Leaves site 1 disconnected and site 2 connected (tests/test_shotgrid.py removes site 2 and reconnects site 1).
// Run by tests/test_shotgrid.py:  node tests/trackers_multi_e2e.cjs <sightBase> <fakeSite1> <fakeSite2> <assetId>
const { chromium } = require("playwright");
const assert = require("assert");
const [base, site1, site2, aid] = process.argv.slice(2);
const K1 = "shotgrid:" + new URL(site1).host, K2 = "shotgrid:" + new URL(site2).host, H1 = new URL(site1).host, H2 = new URL(site2).host;
const enc = encodeURIComponent;
const j = async (path, opt) => { const r = await fetch(base + path, opt); assert.ok(r.ok, path + " → " + r.status); return r.json(); };
const X = { "X-Sight": "1", "content-type": "application/json" };
(async () => {
  await fetch(site2 + "/__fake/add", { method: "POST", body: JSON.stringify({ type: "Project", id: 71, name: "Second", archived: false }) });
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => { if (m.type() === "error" && !/409/.test(m.text())) errs.push("console: " + m.text()); });
  await p.goto(base + "/");
  await p.waitForSelector(".card[data-id]", { timeout: 20000 });
  await p.waitForSelector(".trk-src", { timeout: 5000 });
  assert.strictEqual(await p.locator(".trk-src").count(), 1);
  // Settings → Trackers: ShotGrid connected, Connect a tracker… still offers it (another site)
  if (await p.locator("#settingsBody[hidden]").count()) await p.click("#settingsHead");
  await p.waitForSelector(`.trk-set[data-key="${K1}"]`);
  assert.ok(await p.locator("#trkAddRow").isVisible(), "Connect a tracker… while ShotGrid is connected");
  await p.click("#trkAdd"); await p.click("#trkKinds [data-kind=shotgrid]");
  const NEW = '.trk-set[data-tracker=shotgrid]:not([data-key="' + K1 + '"])';
  await p.waitForSelector(NEW, { state: "visible" });
  assert.strictEqual(await p.inputValue(NEW + " [name=site]"), "", "another site starts empty");
  assert.ok(await p.locator("#trkAddRow").isHidden(), "nothing else to connect while its fields are open");
  // the same site again: refused, in words
  await p.fill(NEW + " [name=site]", site1); await p.fill(NEW + " [name=script]", "sight"); await p.fill(NEW + " [name=key]", "secret");
  await p.click(NEW + " [data-act=save]");
  await p.waitForFunction((s) => /already connected/.test(document.querySelector(s + " .trk-msg").textContent), NEW, { timeout: 5000 });
  assert.strictEqual((await j("/api/trackers")).trackers.length, 1);
  await p.fill(NEW + " [name=site]", site2); await p.fill(NEW + " [name=key]", "secret");
  await p.click(NEW + " [data-act=save]");
  await p.waitForSelector(`.trk-set[data-key="${K2}"] [data-act=disconnect]`, { state: "visible", timeout: 5000 });
  assert.strictEqual(await p.locator(".trk-set").count(), 2, "a block per site");
  assert.ok(/Saved/.test(await p.textContent(`.trk-set[data-key="${K2}"] .trk-msg`)), "the block that connected keeps its message");
  assert.ok(new RegExp(H2.replace(/\./g, "\\.") + " · connected").test(await p.textContent(`.trk-set[data-key="${K2}"] .trk-state`)));
  assert.deepStrictEqual((await j("/api/trackers")).trackers.map((t) => t.key), [K1, K2]);
  // two sources, each with its own projects
  await p.click("#settingsHead");
  await p.waitForFunction(() => document.querySelectorAll(".trk-src").length === 2);
  assert.deepStrictEqual(await p.$$eval(".trk-src", (x) => x.map((e) => e.dataset.tracker)), [K1, K2]);
  await p.click(`.trk-src[data-tracker="${K2}"]`);
  await p.waitForSelector(`.trk-proj[data-tracker="${K2}"][data-proj='71']`);
  await p.click(`.trk-src[data-tracker="${K1}"]`);
  await p.waitForSelector(`.trk-proj[data-tracker="${K1}"][data-proj='70']`);
  assert.strictEqual(await p.locator(`.trk-proj[data-tracker="${K1}"][data-proj='71']`).count(), 0, "site 1 lists its own projects");
  // site 2's project opens with its Versions (through its own key)
  await p.click(`.trk-proj[data-tracker="${K2}"][data-proj='71']`);
  await p.waitForSelector("#trkBar:not([hidden])");
  // a smart collection of site 2 sits under site 2's project only
  const col = await j("/api/collections", { method: "POST", headers: X, body: JSON.stringify({ name: "Site2 smart", rule: { op: "and", c: [] }, tracker: K2, trackerProject: 71 }) });
  await p.reload(); await p.waitForSelector(".trk-src");
  await p.click(`.trk-src[data-tracker="${K2}"]`); await p.click(`.trk-src[data-tracker="${K1}"]`);
  await p.waitForSelector(`.trk-smart[data-tracker="${K2}"][data-cid="${col.id}"]`);
  assert.strictEqual(await p.locator(`.trk-smart[data-tracker="${K1}"]`).count(), 0, "site 1 has none");
  // links per site: site 1's link is not site 2's; the old alias reads the primary (site 1)
  const link = { site: H1, project: { id: 70, name: "Demo" }, version: { id: 78, code: "sh020_anim_v001" } };
  await j(`/api/trackers/${enc(K1)}/link/${aid}`, { method: "PUT", headers: X, body: JSON.stringify({ link }) });
  assert.strictEqual((await j(`/api/trackers/${enc(K2)}/link/${aid}`)).link, null, "site 2 has no link");
  assert.strictEqual((await j(`/api/sg/link/${aid}`)).link.version.id, 78, "the alias = the first site");
  assert.strictEqual((await j(`/api/trackers/${K2}/status`)).key, K2, "a key unencoded works too");
  // the review panel: a link ▾ per site, named by its site
  await p.dblclick(`.card[data-id="${aid}"]`).catch(async () => { await p.click(".src-row:not(.trk-src)"); await p.dblclick(`.card[data-id="${aid}"]`); });
  await p.waitForSelector(".light", { state: "attached", timeout: 10000 });
  await p.waitForTimeout(400);
  if (!(await p.locator(".an-panel:not([hidden])").count())) await p.keyboard.press("c");
  await p.waitForSelector(".an-panel [data-act=trk]");
  assert.deepStrictEqual(await p.$$eval(".an-panel [data-act=trk]", (x) => x.map((e) => [e.dataset.tracker, e.textContent])),
    [[K1, `SG · ${H1} ▾`], [K2, `SG · ${H2} ▾`]]);
  await p.click(`.an-panel [data-act=trk][data-tracker="${K1}"]`);
  await p.waitForFunction(() => /Linked to/.test(document.querySelector(".an-panel .an-trk").textContent), null, { timeout: 5000 });
  await p.click(`.an-panel [data-act=trk][data-tracker="${K2}"]`);
  await p.waitForFunction(() => /Link .* to a ShotGrid Version/.test(document.querySelector(".an-panel .an-trk").textContent), null, { timeout: 5000 });
  await p.keyboard.press("Escape"); await p.waitForSelector(".light", { state: "detached", timeout: 5000 }).catch(() => {});
  // Disconnect site 1 (its block): site 2 stays — its source, its block, a plain "SG ▾"
  if (await p.locator("#settingsBody[hidden]").count()) await p.click("#settingsHead");
  await p.click(`.trk-set[data-key="${K1}"] [data-act=disconnect]`);
  await p.waitForSelector(`.trk-set[data-key="${K1}"]`, { state: "detached", timeout: 5000 });
  assert.ok(await p.locator(`.trk-set[data-key="${K2}"]`).isVisible());
  await p.click("#settingsHead");
  await p.waitForFunction(() => document.querySelectorAll(".trk-src").length === 1);
  assert.strictEqual(await p.getAttribute(".trk-src", "data-tracker"), K2);
  const st = await j("/api/sg/status");
  assert.deepStrictEqual([st.key, st.configured], [K2, true], "the alias answers for the first connected site now");
  assert.strictEqual((await j(`/api/trackers/${enc(K1)}/status`)).script, "sight", "site 1's settings are kept");
  // Connect a tracker… → ShotGrid now fills site 1's kept settings (the spare site)
  if (await p.locator("#settingsBody[hidden]").count()) await p.click("#settingsHead");
  await p.click("#trkAdd"); await p.click("#trkKinds [data-kind=shotgrid]");
  await p.waitForSelector(`.trk-set[data-key="${K1}"]`, { state: "visible" });
  assert.strictEqual(await p.inputValue(`.trk-set[data-key="${K1}"] [name=site]`), site1);
  await p.click(`.trk-set[data-key="${K1}"] [data-act=cancel]`);
  await p.waitForSelector(`.trk-set[data-key="${K1}"]`, { state: "detached" });
  await j(`/api/collections/${col.id}`, { method: "DELETE" }).catch(() => {});
  assert.deepStrictEqual(errs, []);
  console.log(JSON.stringify({ ok: true }));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
