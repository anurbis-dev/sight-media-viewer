// Drives the built phone app on an animated model (fixtures_3d.make_glb(anim=True): two boxes, a 2 s clip
// lifting Box 2) at phone size: a tap picks a mesh (a tap on nothing lets it go), Hide / Only this / Show
// all, the UV picture, the bottom bar's Shading / Light / Grid rows (kept on the device), play / pause,
// and a note on the clip at 1 s — its view keeps the pose (ctx.anim), another pose leaves the view, going
// back to it puts the pose back. Called by tests/test_pwa.py.
//
//   node tests/pwa_3d_tools.cjs <baseURL> <lift.glb>
"use strict";
const { chromium } = require("playwright");

const [base, glb] = process.argv.slice(2);
const log = [];
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => log.push("pageerror: " + e.message));
  p.on("console", (m) => { if (m.type() === "error") log.push("console: " + m.text()); });
  const res = { log };
  await p.goto(base);
  await p.waitForSelector("label.pick-file");
  res.openButtons = await p.locator("label.pick-file").count();
  await p.setInputFiles("label.pick-file input", glb);
  await p.waitForFunction(() => window.__sightReview && window.__sightReview.R && window.__sightReview.R.v3d, null, { timeout: 60000 });
  await p.waitForTimeout(400);
  const st = () => p.evaluate(() => { const R = window.__sightReview.R, V = R.v3d; return { sel: V.selected, hidden: V.getHidden(), anim: V.anim && V.anim.state(), playing: !!(V.anim && V.anim.playing), vk: R.curVk, shading: V.shading, grid: V.grid, light: V.light, selRow: !document.querySelector(".hdr .sel3d").hidden }; });
  res.clips = await p.evaluate(() => window.__sightReview.R.v3d.anim.clips);
  // A tap on a box picks it; a tap on empty space lets it go.
  const cb = await p.locator(".m3d canvas").boundingBox();
  let picked = null;
  for (let x = 0.2; x <= 0.8 && !picked; x += 0.1){
    await p.mouse.click(cb.x + cb.width * x, cb.y + cb.height * 0.45); await p.waitForTimeout(120);
    const s = await st(); if (s.sel >= 0) picked = s;
  }
  res.picked = picked;
  await p.mouse.click(cb.x + 10, cb.y + cb.height - 200); await p.waitForTimeout(120);
  res.afterEmptyTap = await st();
  await p.mouse.click(cb.x + cb.width * 0.5, cb.y + cb.height * 0.45); await p.waitForTimeout(120);
  for (let x = 0.2; x <= 0.8 && (await st()).sel < 0; x += 0.1){ await p.mouse.click(cb.x + cb.width * x, cb.y + cb.height * 0.45); await p.waitForTimeout(120); }
  // UV of the picked mesh: the full-screen viewer with a picture.
  await p.click('.hdr .sel3d button[title="Show this mesh\'s UVs"]');
  await p.waitForSelector(".view .vb img");
  res.uvShown = await p.evaluate(() => { const i = document.querySelector(".view .vb img"); return new Promise((r) => (i.complete ? r(i.naturalWidth) : i.onload = () => r(i.naturalWidth))); });
  // Its set named at the top, no note plate; a swipe to the left shows the next set, at the last one nothing.
  const uvState = () => p.evaluate(() => ({ title: (document.querySelector(".view .vtitle") || {}).textContent || null, src: [...document.querySelectorAll(".view .vb img")].pop().src, plate: !!document.querySelector(".view .scp-plate, .view .scp-icon") }));
  res.uv1 = await uvState();
  const swipe = async (dx) => { await p.mouse.move(195, 420); await p.mouse.down(); for (let k = 1; k <= 6; k++) await p.mouse.move(195 + dx * k / 6, 422); await p.mouse.up(); await p.waitForTimeout(700); };
  await swipe(-160);
  res.uv2 = await uvState();
  await swipe(-160);
  res.uvEnd = await uvState();
  await swipe(160);
  res.uvBack = await uvState();
  await p.click(".view .fab.back");
  await p.click('.hdr .sel3d button[title="Show only this mesh (hide the others)"]');
  res.solo = await st();
  await p.click('.hdr .sel3d button[title^="Show all"]');
  await p.click('.hdr .sel3d button[title="Hide this mesh"]');
  res.hid = await st();
  await p.click('.hdr .sel3d button[title^="Show all"]');
  res.shown = await st();
  // The bottom bar's rows.
  await p.click('.b3d .icons button[title="Shading"]');
  await p.click('.b3d .chip3:has-text("Solid")');
  await p.click('.b3d .chip3:has-text("Wire")');
  await p.click('.b3d .icons button[title="Light"]');
  await p.click('.b3d .chip3:has-text("Headlight")');
  await p.click('.b3d .icons button[title="Grid"]');
  await p.click('.b3d .chip3:has-text("Grid + axes")');
  res.look = await st();
  res.stored = await p.evaluate(() => JSON.parse(localStorage.getItem("sight-review:v3d")));
  await p.click('.b3d .icons button[title="Grid"]');
  res.rowClosed = await p.locator(".b3d .row.opts").count();
  // The grid's cell slider (the grid is on: Grid + axes): two steps finer.
  await p.click('.b3d .icons button[title="Grid"]');
  res.cell0 = await p.evaluate(() => window.__sightReview.R.v3d.cellSize);
  await p.evaluate(() => { const r = document.querySelector(".b3d input.cell"); r.value = "-2"; r.dispatchEvent(new Event("input")); r.dispatchEvent(new Event("change")); });
  res.cell = await p.evaluate(() => ({ size: window.__sightReview.R.v3d.cellSize, label: [...document.querySelectorAll(".b3d .row.cells .val3")].pop().textContent, stored: JSON.parse(localStorage.getItem("sight-review:v3d")).gridCell }));
  await p.click('.b3d .icons button[title="Grid"]');
  // The background: white; the grid turns dark on it.
  await p.click('.b3d .icons button[title="Background colour"]');
  await p.click('.b3d .swatch[title="Background #ffffff"]');
  res.bg = await p.evaluate(() => ({ bg: window.__sightReview.R.v3d.bg, stored: JSON.parse(localStorage.getItem("sight-review:v3d")).bg, on: document.querySelector(".b3d .swatch.on").title }));
  await p.click('.b3d .swatch[title="Default background"]');
  await p.click('.b3d .icons button[title="Background colour"]');
  // Play / pause.
  await p.click('.b3d .anim button[title="Play / pause the animation"]');
  await p.waitForTimeout(500);
  res.played = await st();
  await p.click('.b3d .anim button[title="Play / pause the animation"]');
  res.paused = await st();
  // A note at 1 s: its view keeps the pose.
  await p.evaluate(() => { window.__sightReview.R.v3d.anim.seek(1); });
  await p.evaluate(() => window.__sightReview.setPanel(true)); await p.waitForTimeout(400);
  await p.click(".newbar .add");
  await p.fill(".newbar textarea", "Lifted");
  await p.click(".newbar .send");
  await p.fill(".sheet input", "Tester"); await p.click('.sheet button:has-text("Continue")');
  await p.waitForFunction(() => window.__sightReview.R.rows.some((r) => r.kind === "note"));
  await p.evaluate(() => window.__sightReview.setPanel(false)); await p.waitForTimeout(400);
  res.noteCtx = await p.evaluate(() => window.__sightReview.R.rows.find((r) => r.kind === "note").data.ctx);
  res.onNote = await st();
  await p.evaluate(() => window.__sightReview.R.v3d.anim.seek(0.3)); await p.waitForTimeout(150);
  res.away = await st();
  await p.evaluate(() => { const R = window.__sightReview.R; window.__sightReview.goView([...R.views.keys()][0]); });
  res.back = await st();
  // The note keeps its look (ctx.v3d, Sight's shape); another look, then the note opened: its look comes back
  // (as Sight's goNote restores it) — shown, not saved over this phone's own choice.
  await p.evaluate(() => { const V = window.__sightReview.R.v3d; V.setShading({ base: "normal", wire: false }); V.setLight("sunset"); });
  await p.evaluate(() => localStorage.setItem("sight-review:v3d", JSON.stringify({ base: "vertex", wire: false, xray: true, grid: "off", light: "flat" })));
  await p.evaluate(() => { const S = window.__sightReview, R = S.R; S.showNote(R.rows.find((r) => r.kind === "note")); });
  res.noteLook = await st();
  res.storedAfterNote = await p.evaluate(() => JSON.parse(localStorage.getItem("sight-review:v3d")));
  console.log(JSON.stringify(res));
  await b.close();
})().catch((e) => { console.error(e, log); process.exit(1); });
