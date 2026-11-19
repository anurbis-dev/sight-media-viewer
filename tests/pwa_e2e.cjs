// Drives the built phone app (tools/build_pwa.py) in headless Chromium at phone size. Called by
// tests/test_pwa.py, which serves the build, prepares the media and checks the results in Sight.
//
//   node tests/pwa_e2e.cjs make  <baseURL> <mediaDir> <outDir>
//     image: a note, a drawn note, a reply with a picture + resolve, review state; video (if
//     clip_v001.webm is there): stepping, a drawn note on a frame, a reply drawing, playback fps.
//     Exports .srev / PDF / HTML of each into outDir; prints a JSON summary.
//   node tests/pwa_e2e.cjs merge <baseURL> <srevFile> <mediaDir>
//     a fresh app (new profile) opens the .srev Sight made, is given the picture, gets a local
//     note, then opens the .srev again; prints the merged rows.
//   node tests/pwa_e2e.cjs bundle <baseURL> <bundleFile> <mediaDir> <outFile>
//     a fresh app opens a bundle of several clips (one damaged): one group, clips without media greyed;
//     a note on one clip, the group's reply → outFile (only the changed clip); a second reply finds
//     nothing changed.
//   node tests/pwa_e2e.cjs seqbar <baseURL> <dir with seq_a.webm, seq_b.webm>
//     two clips grouped: the sequence bar, tap / drag across the cut, play on past the end, title swipe, scrub.
"use strict";
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const [mode, base, a1, a2] = process.argv.slice(2);
const log = [];

async function page(ctx){
  const p = await ctx.newPage();
  p.on("pageerror", (e) => log.push("pageerror: " + e.message));
  p.on("console", (m) => { if (m.type() === "error") log.push("console: " + m.text()); });
  await p.goto(base);
  await p.evaluate(() => localStorage.setItem("sight-review:name", "Phone Tester"));
  await p.reload();
  await p.waitForSelector("label.pick-media");
  return p;
}
// Click by script: the player / the notes may be slid off screen (Notes Panel open or not).
const tap = (loc) => loc.evaluate((e) => e.click());
// The Notes Panel (and with it the "+ Note" bar): a tap on its bar, unless it is open already (then
// the bar holds the filters).
async function openPanel(p){
  if (!await p.evaluate(() => window.__sightReview.R.panel)){ await p.click(".pbar"); await p.waitForTimeout(350); }
}
// Takes a tool up (a tap on the tool already in hand would put it down).
// A tool by its name: a plain one from the bar; an arrow / line or a shape from its slot's row.
const SLOT_OF = { "Arrow": "Arrows and lines", "Line": "Arrows and lines", "Rectangle": "Shapes", "Ellipse": "Shapes" };
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
async function drawOn(p, tool, from, to, keep){
  await p.waitForSelector(".draw");
  await pick(p, tool);
  const b = await p.locator(".draw .dview").boundingBox();
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  await p.mouse.move(cx + from[0], cy + from[1]); await p.mouse.down();
  await p.mouse.move(cx + to[0], cy + to[1], { steps: 8 }); await p.mouse.up();
  if (!keep) await p.click(".draw .btn.primary");
}
// The Text tool: a tap opens a field there; a tap elsewhere puts the text on the picture.
async function typeText(p, at, text){
  await pick(p, "Text");
  const b = await p.locator(".draw .dview").boundingBox();
  await p.mouse.click(b.x + b.width / 2 + at[0], b.y + b.height / 2 + at[1]);
  await p.waitForSelector(".draw .dtext");
  await p.keyboard.type(text);
  await p.mouse.click(b.x + 12, b.y + b.height * 0.4);  // clear of the floating bars
  await p.waitForSelector(".draw .dtext", { state: "detached" });
}
async function save(p, label, file){
  await tap(p.locator('button[title="Export and more"]'));  // the header may be off screen (Notes Panel open)
  await p.click(`.menu button:has-text("${label}")`);
  await p.waitForSelector('.sheet button:has-text("Download")', { timeout: 90000 });
  const info = await p.textContent(".sheet p");
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click('.sheet button:has-text("Download")')]);
  await dl.saveAs(file);
  await p.click('.sheet button:has-text("Close")');
  return info;
}
const rowsOf = (p) => p.evaluate(() => window.__sightReview.R.rows);

async function make(){
  const media = a1, out = a2, res = {};
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const p = await page(ctx);
  // ---- picture ----
  await p.setInputFiles("label.pick-media input", path.join(media, "shot_v001.png"));
  await p.waitForSelector(".stage img");
  await openPanel(p);
  await p.click(".newbar .add");
  await p.fill(".newbar textarea", "Sky too dark — небо темнее");
  await p.click(".newbar .send");
  await p.waitForSelector(".note");
  await tap(p.locator('button[title="Draw a note on this picture / frame"]'));
  await drawOn(p, "Rectangle", [-50, -25], [50, 25], true);
  await typeText(p, [-40, 40], "Lift\nсюда");
  await p.click(".draw .btn.primary");
  await p.waitForSelector(".newbar .atts .fw");
  await p.fill(".newbar textarea", "Box this");
  await p.click(".newbar .send");
  await p.waitForFunction(() => document.querySelectorAll(".note").length === 2);
  await openPanel(p);
  const first = p.locator(".note").first();
  await tap(first.locator('button:has-text("Reply")'));
  await first.locator("textarea").fill("Lifted it");
  await first.locator('.cmp input[type="file"]').setInputFiles(path.join(media, "shot_v001.png"));
  await p.waitForSelector(".note .atts img");
  await tap(first.locator(".opt.done"));
  await tap(first.locator(".send"));
  await p.waitForFunction(() => document.querySelector(".note .rep.ev.done"));
  // The review state has no control on the phone any more (0.27.0); the rows still carry one
  // (from Sight) and export it — set here through the model.
  await p.evaluate(() => { const S = window.__sightReview; S.M.setReviewState(S.R.rows, "changes", "Phone Tester"); });
  await p.waitForTimeout(400);
  res.imageRows = await rowsOf(p);
  res.imageSrev = await save(p, "Review file for Sight", path.join(out, "app_image.srev"));
  res.imagePdf = await save(p, "PDF report", path.join(out, "app_image.pdf"));
  res.imageHtml = await save(p, "Web page", path.join(out, "app_image.html"));
  // ---- video ----
  const clip = path.join(media, "clip_v001.webm");
  if (fs.existsSync(clip)){
    await p.goto(base);
    await p.waitForSelector("label.pick-media");
    await p.setInputFiles("label.pick-media input", clip);
    await p.waitForSelector(".stage video");
    await p.waitForFunction(() => document.querySelector(".stage video").readyState >= 2);
    for (let i = 0; i < 5; i++) await p.click('button[title="Next frame"]');
    await p.waitForTimeout(300);
    res.tcAfter5 = await p.textContent(".tc");
    await p.evaluate(() => window.__sightReview.R.video.play()); await p.waitForTimeout(2500); await p.evaluate(() => window.__sightReview.R.video.pause());
    res.fps = await p.evaluate(() => window.__sightReview.R.fps);
    // Drag sideways on the picture: the clip runs on from where it is (a fixed pace, not the width).
    await p.evaluate(() => { window.__sightReview.R.video.currentTime = 0.5; });
    await p.waitForTimeout(300);
    const sb = await p.locator(".stage").boundingBox();
    await p.mouse.move(sb.x + sb.width * 0.25, sb.y + sb.height / 2); await p.mouse.down();
    await p.mouse.move(sb.x + sb.width * 0.75, sb.y + sb.height / 2, { steps: 12 }); await p.mouse.up();
    await p.waitForTimeout(600);
    res.scrubbed = await p.evaluate(() => [window.__sightReview.R.video.currentTime, window.__sightReview.R.video.paused]);
    await p.evaluate(() => { window.__sightReview.R.video.currentTime = 1.0; });
    await p.waitForTimeout(400);
    await p.click('button[title="Draw a note on this picture / frame"]');
    await drawOn(p, "Ellipse", [-40, -30], [40, 30]);
    await p.waitForSelector(".newbar .atts .fw");
    await p.fill(".newbar textarea", "Ring at one second");
    await p.click(".newbar .send");
    await p.waitForSelector(".note");
    await openPanel(p);
    const n = p.locator(".note").first();
    // A reply on a video note is written over the player, on the note's frame (the frame on screen).
    await tap(n.locator('button:has-text("Reply")'));
    await p.waitForSelector(".review.compose .newbar .cmp");
    await p.waitForTimeout(400);
    await tap(p.locator(".newbar .cmp .pen"));
    await drawOn(p, "Arrow", [-60, 40], [0, 0]);
    await tap(p.locator(".newbar .send"));
    await p.waitForFunction(() => window.__sightReview.R.rows.length === 3);
    await p.evaluate(() => { window.__sightReview.R.video.currentTime = 1.0; });
    await p.waitForTimeout(400);
    res.overlayAt1 = await p.evaluate(() => document.querySelector(".stage svg").children.length);
    await p.evaluate(() => { window.__sightReview.R.video.currentTime = 3.0; });
    await p.waitForTimeout(400);
    res.overlayAt3 = await p.evaluate(() => document.querySelector(".stage svg").children.length);
    res.videoRows = await rowsOf(p);
    res.videoSrev = await save(p, "Review file for Sight", path.join(out, "app_video.srev"));
    res.videoPdf = await save(p, "PDF report", path.join(out, "app_video.pdf"));
    res.videoHtml = await save(p, "Web page", path.join(out, "app_video.html"));
  }
  // ---- persistence: reload, the reviews open with the files kept on the device ----
  await p.goto(base);
  await p.waitForSelector(".item");
  res.listed = await p.locator(".item").count();
  await p.locator('.item:has-text("shot_v001.png") .th').click();
  await p.waitForSelector(".stage img");
  res.reopenedNotes = await p.locator(".note").count();
  // The picked file was kept on the device: the review opens with it, no picker.
  res.reopenedFile = await p.evaluate(() => !!window.__sightReview.R.file);
  res.reopenedPicker = await p.locator(".stage .none").count();
  if (fs.existsSync(clip)){
    await p.goto(base);
    await p.locator('.item:has-text("clip_v001.webm") .th').click();
    await p.waitForSelector(".stage video");
    res.reopenedVideo = await p.evaluate(() => !!window.__sightReview.R.file);
  }
  await b.close();
  return res;
}

async function merge(){
  const srev = a1, media = a2, res = {};
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await page(ctx);
  // A .srev for a file the app has never seen: a review is made from the package's identity and
  // asks for the file.
  await p.setInputFiles("label.pick-file input", srev);
  await p.waitForSelector(".review .note");
  res.toast1 = await p.textContent(".toast");
  res.picker = await p.locator(".stage .none label").count();
  // Picking the same file (name + size) binds it to that review; a local note, then the same
  // .srev again: nothing new, the local note stays.
  await p.setInputFiles(".stage .none input", path.join(media, "shot_v001.png"));
  await p.waitForSelector(".stage img");
  await openPanel(p);
  await p.click(".newbar .add");
  await p.fill(".newbar textarea", "Local note on the phone");
  await p.click(".newbar .send");
  await p.waitForTimeout(400);
  await p.goto(base);
  await p.waitForSelector("label.pick-media");
  await p.setInputFiles("label.pick-file input", srev);
  await p.waitForSelector(".review .note");
  await p.waitForTimeout(300);
  res.toast2 = await p.textContent(".toast");
  res.listed = await p.evaluate(async () => (await window.__sightReview.DB.all("reviews")).length);
  res.rows = await rowsOf(p);
  await b.close();
  return res;
}

async function bundle(){
  const [srev, media, outFile] = [a1, a2, process.argv[6]], res = {};
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const p = await page(ctx);
  await p.setInputFiles("label.pick-file input", srev);
  await p.waitForSelector(".list .row.group");
  res.toast = await p.textContent(".toast");
  res.groups = await p.evaluate(() => window.__sightReview.loadGroups());
  res.groupRows = await p.locator(".list .row.group").count();
  res.nomedia = await p.locator(".list .row.nomedia").count();
  res.metas = await p.evaluate(async () => (await window.__sightReview.DB.all("reviews")).map((m) => ({ name: m.asset.name, groups: m.groups, changed: m.changed, nomedia: !!m.nomedia })));
  // A note on the picture's clip (its file given: no longer greyed).
  await p.locator('.item:has-text("shot_v001.png") .th').click();
  await p.waitForSelector(".review .note");
  await p.setInputFiles(".stage .none input", path.join(media, "shot_v001.png"));
  await p.waitForSelector(".stage img");
  await openPanel(p);
  await p.click(".newbar .add");
  await p.fill(".newbar textarea", "Phone note in the bundle");
  await p.click(".newbar .send");
  await p.waitForTimeout(400);
  await p.goto(base);
  await p.waitForSelector(".list .row.group");
  res.nomediaAfter = await p.locator(".list .row.nomedia").count();
  // The group's reply (its menu item calls exportBundle).
  await p.evaluate(() => { const g = window.__sightReview.loadGroups()[0]; window.__sightReview.exportBundle(g); });
  await p.waitForSelector('.sheet button:has-text("Download")', { timeout: 90000 });
  res.sheet = await p.textContent(".sheet h2");
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click('.sheet button:has-text("Download")')]);
  await dl.saveAs(outFile);
  await p.click('.sheet button:has-text("Close")');
  await p.waitForTimeout(300);
  res.changedAfter = await p.evaluate(async () => (await window.__sightReview.DB.all("reviews")).map((m) => m.changed));
  // Nothing changed since: asked before sending all.
  await p.evaluate(() => { const g = window.__sightReview.loadGroups()[0]; window.__sightReview.exportBundle(g); });
  await p.waitForSelector(".sheet h2");
  res.second = await p.textContent(".sheet h2");
  await p.click('.sheet button:has-text("Cancel")');
  // The group's picture opens its sequence on the first clip; › / Page Down walk it, Back leaves it.
  const hist0 = await p.evaluate(() => history.length);
  await p.locator(".list .row.group > .item .th").click();
  await p.waitForSelector(".review .hdr .seqb");
  const name = () => p.evaluate(() => window.__sightReview.R.meta.asset.name);
  res.seq = [await name(), await p.locator('.hdr .seqb[title^="Previous"]').isDisabled(), await p.textContent(".hdr .ttl span")];
  await tap(p.locator('.hdr .seqb[title^="Next"]'));
  await p.waitForFunction(() => window.__sightReview.R.meta.asset.name === "boxes_v001.glb");
  res.seq.push(await p.locator('.hdr .seqb[title^="Next"]').isDisabled());
  await p.keyboard.press("PageUp");
  await p.waitForFunction(() => window.__sightReview.R.meta.asset.name === "shot_v001.png");
  await p.keyboard.press("PageDown");
  await p.waitForFunction(() => window.__sightReview.R.meta.asset.name === "boxes_v001.glb");
  res.seqHist = (await p.evaluate(() => history.length)) - hist0;
  await tap(p.locator('button[title="All reviews"]'));
  await p.waitForSelector(".list .row.group");
  // Back on the group's picture: the clip last seen.
  await p.locator(".list .row.group > .item .th").click();
  await p.waitForSelector(".review .hdr .seqb");
  res.seqResume = await name();
  await b.close();
  return res;
}

// Two clips of a group as one sequence: the bar over the timeline, a tap / drag on it across the cut, play on
// past a clip's end, a scrub on the picture past the end, a swipe on the header's title.
async function seqbar(){
  const dir = a1, res = {};
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const p = await page(ctx);
  for (const f of ["seq_a.webm", "seq_b.webm"]){
    await p.setInputFiles("label.pick-file input", path.join(dir, f));
    await p.waitForFunction((n) => { const R = window.__sightReview.R; return R && R.meta.asset.name === n && R.video && R.video.readyState >= 1; }, f);
    await tap(p.locator('button[title="All reviews"]'));
    await p.waitForSelector(".list .row");
  }
  const keys = await p.evaluate(async () => { const ms = await window.__sightReview.DB.all("reviews"); return ["seq_a.webm", "seq_b.webm"].map((n) => ms.find((m) => m.asset.name === n).key); });
  await p.evaluate((ks) => localStorage.setItem("sight-review:groups", JSON.stringify([{ id: "gseq", name: "Seq", keys: ks, open: true }])), keys);
  await p.reload();
  await p.waitForSelector(".list .row.group");
  await p.locator(".list .row.group > .item .th").click();
  const name = () => p.evaluate(() => window.__sightReview.R.meta.asset.name);
  const ready = (n) => p.waitForFunction((n) => { const R = window.__sightReview.R; return R && R.meta.asset.name === n && R.video && R.video.readyState >= 2 && !R.video.seeking && R.want == null; }, n);
  await ready("seq_a.webm");
  await p.waitForSelector(".sqb:not([hidden]) .sqs + .sqs");
  res.segs = await p.$$eval(".sqb .sqs", (xs) => xs.map((x) => [x.textContent, x.classList.contains("cur")]));
  // The scrub cache: the playhead near clip a's end → the window runs on into clip b's start (b's own
  // cache, from its first frame), and the cut below takes that cache over.
  await p.evaluate(() => { window.__sightReview.R.video.currentTime = 1.8; });
  await p.waitForFunction((kb) => { const c = window.__sightReview.scrubPool.get(kb), s = window.__sightReview.R.scrub.span(1.8); return !!c && c.mts.length > 5 && c.mts[0] === 0 && !!s && s[0] <= 1.2 && s[1] >= 1.9; }, keys[1], { timeout: 15000 }).catch(() => {});
  res.cacheDbg = await p.evaluate(() => { const sc = window.__sightReview.R.scrub; return { mts: sc.mts.slice(-12).map((x) => Math.round(x * 1000)), d: sc.d, ranges: sc.ranges, dead: [...sc.dead.entries()], next: sc.next(), v: !!sc.v, running: sc.running, broken: sc.broken }; });
  res.cacheSpan = await p.evaluate(() => window.__sightReview.R.scrub.span(1.8));
  await p.evaluate(() => { window.__sightReview.R.video.currentTime = 0; });
  await ready("seq_a.webm");
  const hist0 = await p.evaluate(() => history.length);
  const bar = async () => p.locator(".sqb").boundingBox();
  // A tap at 3/4 of the bar (two 2 s clips): the second clip, 1 s in.
  let bb = await bar();
  await p.mouse.click(bb.x + bb.width * 0.75, bb.y + bb.height / 2);
  await ready("seq_b.webm");
  res.tap = await p.evaluate(() => [window.__sightReview.R.video.currentTime, document.querySelector(".sqb .sqs.cur").textContent]);
  res.adopted = await p.evaluate((kb) => !window.__sightReview.scrubPool.has(kb) && window.__sightReview.R.scrub.mts[0] === 0, keys[1]);
  // A drag back across the cut to 1/4: the first clip, 1 s in.
  bb = await bar();
  await p.mouse.move(bb.x + bb.width * 0.75, bb.y + bb.height / 2);
  await p.mouse.down();
  await p.mouse.move(bb.x + bb.width * 0.25, bb.y + bb.height / 2, { steps: 12 });
  await p.mouse.up();
  await ready("seq_a.webm");
  res.drag = await p.evaluate(() => [window.__sightReview.R.video.currentTime, window.__sightReview.R.dragging]);
  // Played to its end: on into the second clip, still playing.
  await p.evaluate(() => { const v = window.__sightReview.R.video; v.currentTime = v.duration - 0.2; v.play(); });
  await p.waitForFunction(() => { const R = window.__sightReview.R; return R.meta.asset.name === "seq_b.webm" && R.video && !R.video.paused && R.video.currentTime > 0.05; }, null, { timeout: 15000 });
  res.played = true;
  await p.evaluate(() => window.__sightReview.R.video.pause());
  // A swipe right on the title: the previous clip; left: the next.
  const swipe = async (dx) => {
    const t = await p.locator(".hdr .ttl").boundingBox(), y = t.y + t.height / 2, x = t.x + t.width / 2;
    await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + dx, y, { steps: 8 }); await p.mouse.up();
  };
  await swipe(120);
  await ready("seq_a.webm");
  res.swipe = [await name()];
  await swipe(-120);
  await ready("seq_b.webm");
  res.swipe.push(await name());
  await swipe(120);
  await ready("seq_a.webm");
  // A scrub on the picture from near the first clip's end on past it: into the second clip.
  await p.evaluate(() => { const v = window.__sightReview.R.video; v.currentTime = v.duration - 0.1; });
  await ready("seq_a.webm");
  const st = await p.locator(".stage").boundingBox(), y = st.y + st.height * 0.3;
  await p.mouse.move(st.x + 40, y); await p.mouse.down();
  await p.mouse.move(st.x + st.width - 40, y, { steps: 20 });
  await p.mouse.up();
  await ready("seq_b.webm");
  res.scrub = await p.evaluate(() => window.__sightReview.R.dragging);
  // A touch tap on the bar across the cut (CDP touch events): it lands, the drag ends, play still runs on.
  const cdp = await ctx.newCDPSession(p);
  bb = await bar();
  const tp = { x: bb.x + bb.width * 0.4, y: bb.y + bb.height / 2 };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [tp] });
  await ready("seq_a.webm");
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await p.waitForTimeout(200);
  res.touch = await p.evaluate(() => [window.__sightReview.R.video.currentTime, window.__sightReview.R.dragging]);
  await p.evaluate(() => { const v = window.__sightReview.R.video; v.currentTime = v.duration - 0.2; v.play(); });
  await p.waitForFunction(() => { const R = window.__sightReview.R; return R.meta.asset.name === "seq_b.webm" && R.video && !R.video.paused; }, null, { timeout: 15000 });
  await p.evaluate(() => window.__sightReview.R.video.pause());
  // A seek to the very end while paused is no play-on (loop on: it would go to the first clip).
  await tap(p.locator(".tp .loopb"));
  await p.evaluate(() => { const v = window.__sightReview.R.video; v.currentTime = 0.5; });
  await ready("seq_b.webm");
  await p.evaluate(() => { window.__sightReview.R.playOn = false; const v = window.__sightReview.R.video; v.currentTime = v.duration; });
  await p.waitForTimeout(800);
  res.endSeek = await name();
  await tap(p.locator(".tp .loopb"));
  res.hist = (await p.evaluate(() => history.length)) - hist0;
  await p.waitForTimeout(400);
  res.hold = await p.locator(".seqhold").count();
  // The drawing canvas on a narrow screen: the tools row (over the transport) scrolls by a finger drag.
  await p.evaluate(() => document.fullscreenElement ? document.exitFullscreen() : null);  // (the app's auto full screen)
  await p.waitForTimeout(300);
  await p.setViewportSize({ width: 300, height: 700 });
  await tap(p.locator(".fab.pencil"));
  await p.waitForSelector(".draw .dtrow");
  res.toolsAbove = await p.evaluate(() => document.querySelector(".draw .dtools").getBoundingClientRect().bottom <= document.querySelector(".draw .dfoot").getBoundingClientRect().top + 1);
  const rb = await p.locator(".draw .dtrow").boundingBox(), ry = rb.y + rb.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: rb.x + rb.width - 30, y: ry }] });
  for (let i = 1; i <= 10; i++){ await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: rb.x + rb.width - 30 - i * 8, y: ry }] }); await p.waitForTimeout(16); }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  res.rowScroll = await p.evaluate(() => { const r = document.querySelector(".draw .dtrow"); return [r.scrollLeft, r.scrollWidth - r.clientWidth]; });
  await p.click(".draw .btn:has-text('Cancel')");
  await b.close();
  return res;
}

(mode === "make" ? make() : mode === "bundle" ? bundle() : mode === "seqbar" ? seqbar() : merge()).then((res) => {
  res.log = log;
  process.stdout.write(JSON.stringify(res));
}).catch((e) => { console.error(e); console.error(log.join("\n")); process.exit(1); });
