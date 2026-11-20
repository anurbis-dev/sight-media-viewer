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
//   node tests/pwa_e2e.cjs wcache <baseURL> <dir with wc_a.mp4, wc_b.mp4 (3 s, 24 fps)>
//     the scrub cache decoded with WebCodecs (every frame of both clips), a timeline drag over cached frames does
//     not seek the player until the release, a drag across the cut shows the next clip's cached frame at once.
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

// The scrub cache on MP4s (WebCodecs): both clips of a sequence cached frame by frame; a drag over cached frames
// leaves the player alone until the release; a drag across the cut shows the next clip's own cached frame.
async function wcache(){
  const dir = a1, res = {}, names = ["wc_a.mp4", "wc_b.mp4"];
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const p = await page(ctx);
  for (const f of names){
    await p.setInputFiles("label.pick-file input", path.join(dir, f));
    await p.waitForFunction((n) => { const R = window.__sightReview.R; return R && R.meta.asset.name === n && R.video && R.video.readyState >= 1; }, f);
    await tap(p.locator('button[title="All reviews"]'));
    await p.waitForSelector(".list .row");
  }
  const keys = await p.evaluate(async (ns) => { const ms = await window.__sightReview.DB.all("reviews"); return ns.map((n) => ms.find((m) => m.asset.name === n).key); }, names);
  await p.evaluate((ks) => localStorage.setItem("sight-review:groups", JSON.stringify([{ id: "gwc", name: "WC", keys: ks, open: true }])), keys);
  await p.reload();
  await p.waitForSelector(".list .row.group");
  await p.locator(".list .row.group > .item .th").click();
  const ready = (n) => p.waitForFunction((n) => { const R = window.__sightReview.R; return R && R.meta.asset.name === n && R.video && R.video.readyState >= 2 && !R.video.seeking && R.want == null; }, n);
  await ready(names[0]);
  await p.waitForFunction((kb) => { const S = window.__sightReview, a = S.R.scrub, c = S.scrubPool.get(kb); return !!(a && a.wc && a.mts.length >= 72 && c && c.wc && c.mts.length >= 72); }, keys[1], { timeout: 20000 }).catch(() => {});
  res.cache = await p.evaluate((kb) => { const S = window.__sightReview, a = S.R.scrub, c = S.scrubPool.get(kb); return [a.mts.length, !!a.wc, c ? c.mts.length : null, !!(c && c.wc), a.mts[0]]; }, keys[1]);
  // A timeline drag over cached frames: the cached picture, no seek; one seek on the release.
  await p.evaluate(() => { const v = window.__sightReview.R.video; window.__seeks = 0; v.addEventListener("seeking", () => window.__seeks++); });
  const tl = await p.locator(".tp .tl").first().boundingBox(), y = tl.y + tl.height / 2;
  await p.mouse.move(tl.x + tl.width * 0.2, y); await p.mouse.down();
  for (let i = 1; i <= 10; i++) await p.mouse.move(tl.x + tl.width * (0.2 + i * 0.05), y);
  res.during = await p.evaluate(() => { const R = window.__sightReview.R; return [window.__seeks, R.want != null, !document.querySelector(".stage .scrubimg").hidden]; });
  // The finger resting on a frame: the player seeks there after a moment (its own picture replaces the cached one).
  await p.waitForTimeout(600);
  res.rest = await p.evaluate(() => { const R = window.__sightReview.R; return [window.__seeks, R.want == null]; });
  await p.mouse.up();
  await ready(names[0]);
  res.after = await p.evaluate(() => [window.__seeks, window.__sightReview.R.video.currentTime]);
  // A drag across the cut on the sequence bar: the held picture is the next clip's cached frame (an <img>).
  await p.evaluate(() => { window.__holds = []; new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.classList && n.classList.contains("seqhold")) window.__holds.push(n.tagName + (n.tagName === "IMG" && String(n.src).startsWith("blob:") ? ":blob" : "")); }))).observe(document.body, { childList: true, subtree: true }); });
  let bb = await p.locator(".sqb").boundingBox();
  const by = bb.y + bb.height / 2;
  await p.mouse.move(bb.x + bb.width * 0.3, by); await p.mouse.down();
  await p.mouse.move(bb.x + bb.width * 0.75, by, { steps: 6 });
  await p.waitForFunction((n) => { const R = window.__sightReview.R; return R && R.meta.asset.name === n && R.video && R.video.readyState >= 1; }, names[1]);
  await p.mouse.up();
  await ready(names[1]);
  res.holds = await p.evaluate(() => window.__holds);
  res.landed = await p.evaluate(() => [window.__sightReview.R.meta.asset.name, window.__sightReview.R.video.currentTime, !!(window.__sightReview.R.scrub && window.__sightReview.R.scrub.mts.length >= 72)]);
  // Play from a frame the player is not on yet (a seek on its way), seeks made costly: the cache plays from there and
  // the player, sought to the next keyframe (1 s: -g 24), takes over when the clock gets there.
  await p.waitForFunction(() => window.__sightReview.R.scrub.mts.length >= 72, null, { timeout: 15000 }).catch(() => {});
  await p.evaluate(() => {
    const S = window.__sightReview;
    Object.assign(S.seekCost, { a: 0.2, b: 0.02, s: 0.6, o: 0 }); S.setLag(0.1);
    window.__br = []; window.__sk = [];
    const si = document.querySelector(".stage .scrubimg");
    const f = () => { const R = S.R; if (R && R.video) window.__br.push([R.meta.asset.name, R.bridge ? R.bridge.x : null, R.scrubT, !si.isConnected || si.hidden, R.video.currentTime, R.video.paused, R.video.playbackRate, R.video.muted || R.video.volume < 0.01, R.bridge ? (R.bridge.tail ? "tail" : R.bridge.stay ? "stay" : "seek") : null, R.video.muted, R.video.volume, performance.now()]); window.__brRaf = requestAnimationFrame(f); };
    f();
    // Every time the player is sent to (its "seeking" event reads only the last one).
    const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime");
    Object.defineProperty(S.R.video, "currentTime", { configurable: true, get(){ return d.get.call(this); }, set(x){ window.__sk.push(+x.toFixed(3)); d.set.call(this, x); } });
    // (A slow start, as a phone's — playing, not yet moving off its frame for 0.3 s: the cached picture must stay.)
    const v = S.R.video;
    v.play = function (){ delete this.play; const r = this.playbackRate; this.playbackRate = 0.0625; setTimeout(() => { this.playbackRate = r; }, 300); return this.play(); };
    S.seekTo(0.3); S.togglePlay();
  });
  await p.waitForFunction(() => { const R = window.__sightReview.R; return !R.bridge && !R.video.paused && R.video.currentTime > 1.2; }, null, { timeout: 10000 });
  await p.waitForTimeout(100);  // (the sampler's last frame after the handover)
  res.bridge = await p.evaluate(() => {
    const br = window.__br, on = br.filter((x) => x[1] != null), last = br[br.length - 1];
    let back = 0;
    for (let i = 1; i < on.length; i++) if (on[i][2] != null && on[i - 1][2] != null && on[i][2] < on[i - 1][2] - 1e-6) back++;
    // Handed over while the player still stood on the frame it was sought to (1 s): the picture would freeze there.
    const i0 = br.findIndex((x) => x[1] != null), early = br.slice(i0).filter((x) => x[1] == null && x[4] < 1 + 0.75 / 24).length;
    return { t1: [...new Set(on.map((x) => x[1]))], seeks: window.__sk, shown: on.length ? [on[0][2], on[on.length - 1][2]] : null, back, early, cached: on.filter((x) => !x[3]).length, end: [last[3], last[5], last[6], last[7]], elMuted: on.length > 0 && on.every((x) => x[9]) };
  });
  await p.evaluate(() => window.__sightReview.togglePlay());
  // A tap during the bridge: paused on the frame shown, and the player sought to that frame.
  await ready(names[1]);
  await p.evaluate(() => { const S = window.__sightReview; Object.assign(S.seekCost, { a: 0.2, b: 0.02, s: 0.6, o: 0 }); S.setLag(0.1); S.seekTo(0.3); S.togglePlay(); });
  await p.waitForFunction(() => { const R = window.__sightReview.R; return R.bridge && R.scrubT > 0.35; });
  res.halt = await p.evaluate(() => { const S = window.__sightReview, R = S.R, on = !!R.bridge, T = R.scrubT; S.togglePlay(); return [on, T, R.bridge == null, R.video.paused]; });
  await ready(names[1]);
  res.halt.push(await p.evaluate(() => window.__sightReview.R.video.currentTime));
  // Play from the frame the player stands on, its start slow (an HEVC clip's ~0.25 s, faked): the cache plays at once,
  // the player — not sought — plays at its own rate with its sound from its start, and the cached picture slows
  // (BRIDGE_SLOW) until the player has caught it up. (A clip with sound: no mute, no rate change.)
  await p.evaluate(() => window.__sightReview.seekTo(1.5));
  await ready(names[1]);
  await p.waitForFunction(() => { const R = window.__sightReview.R; return R.scrubT == null && !R.video.seeking; });
  await p.evaluate(() => {
    const S = window.__sightReview, v = S.R.video;
    S.R.hasAudio = true; S.setLag(0.3); window.__br.length = 0; window.__sk.length = 0;
    v.play = function (){ delete this.play; return new Promise((ok, no) => setTimeout(() => this.play().then(ok, no), 300)); };  // (a slow start)
    S.togglePlay();
  });
  // A level set during the catch-up: applied to the player at once (the bridge leaves its sound alone).
  await p.waitForFunction(() => { const R = window.__sightReview.R; return R.bridge && R.bridge.played; }, null, { timeout: 10000 });
  const midVol = await p.evaluate(() => { const S = window.__sightReview, v = S.R.video; S.setVol(0.5); return [v.muted, v.volume, !!S.R.bridge]; });
  await p.waitForFunction(() => { const R = window.__sightReview.R; return !R.bridge && !R.video.paused && R.video.currentTime > 2; }, null, { timeout: 10000 });
  res.stay = await p.evaluate(() => {
    const br = window.__br, on = br.filter((x) => x[1] != null), last = br[br.length - 1];
    let back = 0;
    for (let i = 1; i < on.length; i++) if (on[i][2] != null && on[i - 1][2] != null && on[i][2] < on[i - 1][2] - 1e-6) back++;
    return { modes: [...new Set(on.map((x) => x[8]))], seeks: window.__sk.slice(), first: on.length ? on[0][2] : null, back, fast: Math.max(...on.map((x) => x[6])),
      speed: on.length > 1 ? (on[on.length - 1][2] - on[0][2]) / ((on[on.length - 1][11] - on[0][11]) / 1000) : null,
      muted: on.some((x) => x[7]), elMuted: on.some((x) => x[9]), cached: on.filter((x) => !x[3]).length, end: [last[3], last[5], last[6], last[7]], vol: [last[9], last[10]] };
  });
  res.stay.midVol = midVol;
  await p.evaluate(() => window.__sightReview.setVol(1));
  // Paused after a play with sound: the next play starts from the frame shown, not past the sound Android still had
  // in its output.
  res.stay.last = await p.evaluate(() => window.__sightReview.bridgeLast);
  // (Android only — faked here: S.androidAudio.) The pause notes the frame (no seek then); the next play first sends
  // the player to that frame's middle. A muted pause notes nothing.
  res.pauseSeek = await p.evaluate(async () => {
    const S = window.__sightReview, v = S.R.video, wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
    S.androidAudio = true; window.__sk.length = 0;
    S.togglePlay();
    const t = v.currentTime;
    await wait(300);
    const atPause = { sk: window.__sk.slice(), padT: S.R.padT, paused: v.paused };
    S.togglePlay();
    const sk = window.__sk.slice();
    for (let i = 0; i < 60 && (S.R.bridge || v.paused); i++) await wait(50);
    await wait(200);
    S.togglePlay();
    await wait(300);
    S.seekTo(0.5); await wait(400);
    S.setVol(0); S.togglePlay();
    for (let i = 0; i < 60 && (S.R.bridge || v.paused); i++) await wait(50);
    await wait(200);
    S.togglePlay();
    await wait(300);
    const muted = { padT: S.R.padT, paused: v.paused };
    S.setVol(1); S.androidAudio = false;
    return { t, atPause, sk, muted };
  });
  // Played on past clip a's end: clip b opens with its cached frames already running, then the bridge, then its player.
  bb = await p.locator(".sqb").boundingBox();
  await p.mouse.click(bb.x + bb.width * 0.42, bb.y + bb.height / 2);
  await ready(names[0]);
  await p.evaluate(() => { window.__br.length = 0; window.__ended = 0; window.__sightReview.R.video.addEventListener("ended", () => window.__ended++); window.__sightReview.setLag(0.03); window.__sightReview.togglePlay(); });
  await p.waitForFunction((n) => { const R = window.__sightReview.R; return R.meta.asset.name === n && !R.bridge && R.video && !R.video.paused && R.video.currentTime > 0.5; }, names[1], { timeout: 15000 });
  res.cut = await p.evaluate((n) => {
    const br = window.__br.filter((x) => x[0] === n), on = br.filter((x) => x[1] != null), last = br[br.length - 1];
    let back = 0;
    for (let i = 1; i < on.length; i++) if (on[i][2] != null && on[i - 1][2] != null && on[i][2] < on[i - 1][2] - 1e-6) back++;
    return { t1: [...new Set(on.map((x) => x[1]))], modes: [...new Set(on.map((x) => x[8]))], first: on.length ? on[0][2] : null, back, end: [last[3], last[5], last[6], last[7]],
      aModes: [...new Set(window.__br.filter((x) => x[0] !== n && x[8]).map((x) => x[8]))], ended: window.__ended, last: window.__sightReview.bridgeLast };
  }, names[1]);
  await p.evaluate(() => window.__sightReview.togglePlay());
  // Near clip a's end with no time for the player to catch up: the cache plays the tail alone (the player left where
  // it stands) and the clip ends as if played: on into clip b.
  bb = await p.locator(".sqb").boundingBox();
  await p.mouse.click(bb.x + bb.width * 0.42, bb.y + bb.height / 2);
  await ready(names[0]);
  await p.evaluate(() => window.__sightReview.seekTo(2.85));
  await p.waitForFunction(() => { const R = window.__sightReview.R; return R.scrubT == null && !R.video.seeking; });
  await p.evaluate(() => {
    const S = window.__sightReview, d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime");
    Object.assign(S.seekCost, { a: 0.2, b: 0.02, s: 0.6, o: 0 }); S.setLag(0.3);
    window.__br.length = 0; window.__sk = [];
    Object.defineProperty(S.R.video, "currentTime", { configurable: true, get(){ return d.get.call(this); }, set(x){ window.__sk.push(+x.toFixed(3)); d.set.call(this, x); } });
    S.togglePlay();
  });
  await p.waitForFunction((n) => { const R = window.__sightReview.R; return R.meta.asset.name === n && !R.bridge && R.video && !R.video.paused && R.video.currentTime > 0.3; }, names[1], { timeout: 15000 });
  res.tail = await p.evaluate((n) => {
    const a = window.__br.filter((x) => x[0] !== n && x[1] != null);
    return { modes: [...new Set(a.map((x) => x[8]))], seeks: window.__sk, last: a.length ? a[a.length - 1][2] : null, paused: a.every((x) => x[5]) };
  }, names[1]);
  // Played to the end of the last clip (loop off): a tap plays it from the start again.
  await p.waitForFunction(() => { const R = window.__sightReview.R; return R.video.ended; }, null, { timeout: 15000 });
  await p.evaluate(() => window.__sightReview.togglePlay());
  await p.waitForFunction(() => { const R = window.__sightReview.R; return !R.bridge && !R.video.paused && R.video.currentTime > 0.2 && R.video.currentTime < 2; }, null, { timeout: 10000 })
    .then(() => { res.again = true; }, () => { res.again = false; });
  await p.evaluate(() => { cancelAnimationFrame(window.__brRaf); window.__sightReview.togglePlay(); });
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
  // (While the finger is down over cached frames the player is not sought: it seeks once on release.)
  await p.waitForFunction(() => { const R = window.__sightReview.R; return R && R.meta.asset.name === "seq_a.webm" && R.video && R.video.readyState >= 1 && R.scrubT != null; });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await ready("seq_a.webm");
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

(mode === "make" ? make() : mode === "bundle" ? bundle() : mode === "seqbar" ? seqbar() : mode === "wcache" ? wcache() : merge()).then((res) => {
  res.log = log;
  process.stdout.write(JSON.stringify(res));
}).catch((e) => { console.error(e); console.error(log.join("\n")); process.exit(1); });
