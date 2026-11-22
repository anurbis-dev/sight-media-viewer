// Two sites of one tracker kind on the phone (docs/PLAN-trackers.md 5b-2 (4), 0.110): the connection a pre-0.110 app
// kept (sight-review:sg) still counts; Connect a tracker… → ShotGrid — another site adds a second connection (a list,
// sight-review:sg.connections); the home screen gets a tab per site ("ShotGrid · <host>"), each page lists its own
// site's projects; the same site again is refused; disconnecting one leaves the other (its tab plain "ShotGrid" again).
// Called by tests/test_pwa.py:  node tests/pwa_sg_multi.cjs <appURL> <fakeSite1> <fakeSite2>
const { chromium } = require("playwright");
const assert = require("assert");
const [base, site1, site2] = process.argv.slice(2);
const H1 = new URL(site1).host, H2 = new URL(site2).host;
(async () => {
  await fetch(site2 + "/__fake/add", { method: "POST", body: JSON.stringify({ type: "Project", id: 71, name: "Second", archived: false }) });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(base);
  // a connection as the app kept it before 0.110: one object under sight-review:sg
  await p.evaluate((s) => { localStorage.clear(); localStorage.setItem("sight-review:fs", "0");
    localStorage.setItem("sight-review:sg", JSON.stringify({ site: s, script: "sight", key: "secret", sudo: false, logins: {}, statusMap: {} })); }, site1);
  await p.reload();
  await p.waitForSelector(".hometabs");
  const tabs = () => p.$$eval(".hometabs button", (x) => x.map((t) => [t.dataset.p, t.textContent]));
  assert.deepStrictEqual(await tabs(), [["reviews", "Reviews"], ["shotgrid:" + H1, "ShotGrid"]], "the old connection still counts");
  // Settings → Connect a tracker… offers ShotGrid again (another site); its form is empty (the one stored is connected)
  const settings = async () => { await p.tap('.bar button[title="Settings"]'); await p.waitForSelector('.sheet button:has-text("Connect a tracker…")'); };
  const closeSheet = async () => { await p.evaluate(() => document.querySelector(".back")?.click()); await p.waitForSelector(".sheet", { state: "detached" }); };
  await settings();
  await p.tap('.sheet button:has-text("Connect a tracker…")');
  await p.tap('.sheet .menu button:has-text("ShotGrid — another site")');
  await p.waitForSelector(".sheet form.trkform");
  assert.strictEqual(await p.inputValue(".trkform input[name=site]"), "", "a new site starts empty");
  // the same site again: refused
  await p.fill(".trkform input[name=site]", site1); await p.fill(".trkform input[name=script]", "sight"); await p.fill(".trkform input[name=key]", "secret");
  await p.tap('.trkform button:has-text("Save")');
  await p.waitForFunction(() => /already connected/.test(document.querySelector(".trkmsg").textContent));
  await p.fill(".trkform input[name=site]", site2);
  await p.tap('.trkform button:has-text("Save")');
  await p.waitForSelector(".sheet", { state: "detached" });
  await p.waitForFunction(() => document.querySelectorAll(".hometabs button").length === 3);
  assert.deepStrictEqual(await tabs(), [["reviews", "Reviews"], ["shotgrid:" + H1, "SG · " + H1], ["shotgrid:" + H2, "SG · " + H2]], "a tab per site (short name + site)");
  assert.strictEqual(await p.getAttribute(`.hometabs button[data-p="shotgrid:${H2}"]`, "title"), "ShotGrid · " + H2);
  const fit = await p.$$eval(".hometabs button", (x) => x.map((t) => t.getBoundingClientRect()).every((r, i, a) => r.right <= innerWidth && (!i || r.left >= a[i - 1].right - 1)));
  assert.ok(fit, "the tabs fit the bar without overlapping");
  const stored = await p.evaluate(() => JSON.parse(localStorage.getItem("sight-review:sg.connections")).map((c) => c.site));
  assert.deepStrictEqual(stored, [site1, site2], "both kept, the old one first");
  // each page lists its own site's projects
  const projects = async (key) => {
    await p.tap(`.hometabs button[data-p="${key}"]`);
    const sel = `main.sgb[data-tracker="${key}"] .sgb-proj`;
    await p.waitForFunction((s) => { const o = [...document.querySelectorAll(s + " option")]; return o.some((x) => x.value === "70"); }, sel, { timeout: 10000 });
    return p.$$eval(sel + " option", (x) => x.map((o) => o.value).filter(Boolean));
  };
  assert.deepStrictEqual(await projects("shotgrid:" + H1), ["70"]);
  assert.deepStrictEqual((await projects("shotgrid:" + H2)).sort(), ["70", "71"]);
  // the person sheet: a row per site
  await p.tap(".hometabs button[data-p=reviews]");
  await p.tap(".bar .you"); await p.waitForSelector(".sheet .kv");
  const names = await p.$$eval(".sheet .kv b", (x) => x.map((e) => e.textContent));
  assert.ok(names.includes("ShotGrid · " + H1) && names.includes("ShotGrid · " + H2), names.join(","));
  await closeSheet();
  // disconnect the first: the second stays (its tab plain "ShotGrid" again), the first's settings are kept
  await settings();
  await p.tap(`.sheet button:has-text("Disconnect ShotGrid · ${H1}")`);
  await p.waitForFunction(() => document.querySelectorAll(".hometabs button").length === 2);
  assert.deepStrictEqual(await tabs(), [["reviews", "Reviews"], ["shotgrid:" + H2, "ShotGrid"]], "the other site stays");
  const after = await p.evaluate(() => JSON.parse(localStorage.getItem("sight-review:sg.connections")).map((c) => [c.site, !!c.key]));
  assert.deepStrictEqual(after, [[site1, false], [site2, true]]);
  // Connect a tracker… → ShotGrid again: the disconnected site's settings come back in the form
  await settings();
  await p.tap('.sheet button:has-text("Connect a tracker…")');
  await p.tap('.sheet .menu button:has-text("ShotGrid — another site")');
  await p.waitForSelector(".sheet form.trkform");
  assert.strictEqual(await p.inputValue(".trkform input[name=site]"), site1, "the kept settings fill the form");
  await p.fill(".trkform input[name=key]", "secret");
  await p.tap('.trkform button:has-text("Save")');
  await p.waitForFunction(() => document.querySelectorAll(".hometabs button").length === 3);
  assert.strictEqual(await p.evaluate(() => JSON.parse(localStorage.getItem("sight-review:sg.connections")).length), 2, "reconnected in place, no third entry");
  assert.deepStrictEqual(errs, []);
  console.log(JSON.stringify({ ok: true }));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
