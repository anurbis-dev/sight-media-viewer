// Drives the built phone app (tools/build_pwa.py) on a 3D model (PLAN-mobile stage 4) in headless
// Chromium at phone size (WebGL through SwiftShader). Called by tests/test_pwa.py.
//
//   node tests/pwa_3d.cjs <baseURL> <model.glb> <outDir>
//     a drawn note on the opening view, a text note on an orbited view, a drawn note on the same
//     camera exploded (its own view), going back to view 1 (its drawing shows, explode back to 0), a
//     reply drawn over the model on view 1, the full-screen viewer, a quarter turn, .srev / PDF / HTML
//     exports, and reopening the review (the file kept on the device). Prints a JSON summary.
"use strict";
const path = require("path");
const { chromium } = require("playwright");

const [base, glb, out] = process.argv.slice(2);
const log = [];
let P = null;  // the page, for the failure dump
const tap = (loc) => loc.evaluate((e) => e.click());
const S = (p, fn, arg) => p.evaluate(fn, arg);
// (By script: a click on the bar while the slide is still moving could land on a filter once it opened.)
async function openPanel(p){
  if (!await S(p, () => window.__sightReview.R.panel)){ await p.evaluate(() => window.__sightReview.setPanel(true)); await p.waitForTimeout(350); }
}
const SLOT_OF = { "Arrow": "Arrows and lines", "Rectangle": "Shapes", "Ellipse": "Shapes" };
async function pick(p, tool){
  if (SLOT_OF[tool]){
    await p.click(`.draw .dtools button[title="${SLOT_OF[tool]}"]`);
    if (!await p.locator(".draw .dfly:not([hidden])").count()) await p.click(`.draw .dtools button[title="${SLOT_OF[tool]}"]`);
    await p.click(`.draw .dfly button[title="${tool}"]`);
    return;
  }
  const b = p.locator(`.draw button[title="${tool}"]`);
  if (!await b.evaluate((e) => e.classList.contains("on"))) await b.click();
}
async function drawOn(p, tool, from, to){
  await p.waitForSelector(".draw");
  await pick(p, tool);
  const b = await p.locator(".draw .dview").boundingBox();
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  await p.mouse.move(cx + from[0], cy + from[1]); await p.mouse.down();
  await p.mouse.move(cx + to[0], cy + to[1], { steps: 8 }); await p.mouse.up();
  await p.click(".draw .btn.primary");
  await p.waitForSelector(".draw", { state: "detached" });
}
async function save(p, label, file){
  await tap(p.locator('button[title="Export and more"]'));
  await p.click(`.menu button:has-text("${label}")`);
  await p.waitForSelector('.sheet button:has-text("Download")', { timeout: 90000 });
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click('.sheet button:has-text("Download")')]);
  await dl.saveAs(file);
  await p.click('.sheet button:has-text("Close")');
}
const rowsOf = (p) => S(p, () => window.__sightReview.R.rows);
const live = (rows) => rows.filter((r) => r.deleted_at == null);
const overlayCount = (p) => S(p, () => document.querySelector(".stage svg").children.length);

(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const p = P = await ctx.newPage();
  p.on("pageerror", (e) => log.push("pageerror: " + e.message));
  p.on("console", (m) => { if (m.type() === "error") log.push("console: " + m.text()); });
  const res = {};
  await p.goto(base);
  await S(p, () => localStorage.setItem("sight-review:name", "Phone Tester"));
  await p.reload();
  await p.waitForSelector("label.pick-file");
  await p.setInputFiles("label.pick-file input", glb);
  await p.waitForFunction(() => window.__sightReview.R && window.__sightReview.R.v3d, null, { timeout: 60000 });
  res.kind = await S(p, () => window.__sightReview.R.meta.asset.kind);
  res.canExplode = await S(p, () => window.__sightReview.R.v3d.canExplode);
  // 1. A drawn note on the opening view.
  await tap(p.locator('button[title="Draw a note on this picture / frame"]'));
  await drawOn(p, "Rectangle", [-60, -40], [60, 40]);
  await p.waitForSelector(".newbar .atts .fw");
  res.newLabel1 = await p.textContent(".newbar .row span");
  await p.fill(".newbar textarea", "Box the cubes");
  await p.click(".newbar .send");
  await p.waitForFunction(() => window.__sightReview.R.rows.length === 2);
  await p.waitForTimeout(200);
  res.overlayView1 = await overlayCount(p);
  // 2. Orbit (a drag on the model), then a note with words only: a new view.
  const cb = await p.locator(".stage canvas").boundingBox();
  await p.mouse.move(cb.x + cb.width * 0.3, cb.y + cb.height * 0.5); await p.mouse.down();
  await p.mouse.move(cb.x + cb.width * 0.7, cb.y + cb.height * 0.45, { steps: 10 }); await p.mouse.up();
  await p.waitForTimeout(900);  // damping settles
  res.overlayOrbited = await overlayCount(p);
  res.curVkOrbited = await S(p, () => window.__sightReview.R.curVk);
  await openPanel(p);
  await p.click(".newbar .add");
  await p.fill(".newbar textarea", "Seen from the side");
  await p.click(".newbar .send");
  await p.waitForFunction(() => window.__sightReview.R.rows.length === 3);
  // 3. The same camera exploded: a drawing there is another view (Sight 0.44.2).
  await p.evaluate(() => window.__sightReview.setPanel(false));
  await p.waitForTimeout(350);
  await S(p, () => { const R = window.__sightReview.R; R.v3d.setExplode(0.6); });
  await p.waitForTimeout(200);
  await tap(p.locator('button[title="Draw a note on this picture / frame"]'));
  await drawOn(p, "Ellipse", [-40, -30], [40, 30]);
  await p.waitForSelector(".newbar .atts .fw");
  await p.fill(".newbar textarea", "Apart");
  await p.click(".newbar .send");
  await p.waitForFunction(() => window.__sightReview.R.rows.length === 5);
  // 4. Back to note 1 by its card's view button: its drawing shows, the explode goes back to 0.
  await openPanel(p);
  await tap(p.locator(".note").first().locator("button.ctx"));
  await p.waitForTimeout(500);
  res.ctxButton = await p.locator(".note").first().locator("button.ctx").textContent();
  res.backOnView1 = await S(p, () => { const R = window.__sightReview.R, n = R.rows.find((r) => r.kind === "note" && r.data.text === "Box the cubes"); return R.curVk === n.data.ctx.vk; });
  res.explodeBack = await S(p, () => window.__sightReview.R.v3d.explode);
  res.overlayBack = await overlayCount(p);
  // 5. A reply on note 1 drawn over the model.
  await openPanel(p);
  await tap(p.locator(".note").first().locator('button:has-text("Reply")'));
  await p.waitForSelector(".review.compose .newbar .cmp");
  await p.waitForTimeout(300);
  res.replyLabel = await p.textContent(".newbar .row span");
  await tap(p.locator(".newbar .cmp .pen"));
  await drawOn(p, "Arrow", [-60, 50], [0, 0]);
  await p.fill(".newbar textarea", "Arrow here");
  await tap(p.locator(".newbar .send"));
  await p.waitForFunction(() => window.__sightReview.R.rows.length === 6);
  // 6. Card pictures (rendered views) and the full-screen viewer.
  await openPanel(p);
  await p.waitForFunction(() => document.querySelectorAll(".note .pics .fw img").length >= 3, null, { timeout: 30000 });
  res.cardPics = await p.locator(".note .pics .fw img").count();
  res.cardTags = await p.locator(".note .pics .fw .fno").allTextContents();
  await tap(p.locator(".note").first().locator(".pics .fw").first());
  await p.waitForSelector(".view .vb img");
  await p.waitForTimeout(300);
  res.viewerLabel = await p.evaluate(() => document.querySelector(".view").innerText);
  res.viewerOverlay = await p.evaluate(() => { const s = document.querySelector(".view .vb svg"); return s ? s.children.length : 0; });
  await tap(p.locator(".view .fab.back"));
  await p.waitForSelector(".view", { state: "detached" });
  // 7. A quarter turn: a note made after it carries turns 1.
  await p.evaluate(() => window.__sightReview.setPanel(false));
  await p.waitForTimeout(300);
  await tap(p.locator('button[title="Turn the model a quarter (which way is up)"]'));
  await p.waitForTimeout(300);
  await openPanel(p);
  await p.click(".newbar .add");
  await p.fill(".newbar textarea", "Turned");
  await p.click(".newbar .send");
  await p.waitForFunction(() => window.__sightReview.R.rows.length === 7);
  res.turns = await S(p, () => window.__sightReview.R.meta.turns);
  res.rows = live(await rowsOf(p));
  res.subtitle = await p.textContent(".hdr .ttl span");
  await save(p, "Review file for Sight", path.join(out, "app_model.srev"));
  await save(p, "PDF report", path.join(out, "app_model.pdf"));
  await save(p, "Web page", path.join(out, "app_model.html"));
  // 8. Reopen: the model was kept on the device, the views are back.
  await p.goto(base);
  await p.waitForSelector(".item");
  await p.locator('.item:has-text(".glb") .th').click();
  await p.waitForFunction(() => window.__sightReview.R && window.__sightReview.R.v3d, null, { timeout: 60000 });
  res.reopenedNotes = await p.locator(".note").count();
  res.reopenedViews = await S(p, () => window.__sightReview.R.views.size);
  res.thumb = await S(p, () => !!window.__sightReview.R.meta.thumb);
  await b.close();
  res.log = log;
  process.stdout.write(JSON.stringify(res));
})().catch(async (e) => {
  console.error(e && e.stack || e);
  console.error(log.join("\n"));
  if (P) console.error(await P.evaluate(() => JSON.stringify({ filter: window.__sightReview.R.filter, panel: window.__sightReview.R.panel, rows: window.__sightReview.R.rows.length, html: document.querySelector(".notes").innerHTML.slice(0, 1500) })).catch((x) => String(x)));
  process.exit(1);
});
