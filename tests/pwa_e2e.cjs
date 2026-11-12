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
  await p.waitForSelector(".opens");
  return p;
}
// The media panel is sticky: click by script so it is not "covered" while Playwright scrolls.
const tap = (loc) => loc.evaluate((e) => e.click());
async function drawOn(p, tool, from, to, keep){
  await p.waitForSelector(".draw");
  await p.click(`.draw button[title="${tool}"]`);
  const b = await p.locator(".draw .dview").boundingBox();
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  await p.mouse.move(cx + from[0], cy + from[1]); await p.mouse.down();
  await p.mouse.move(cx + to[0], cy + to[1], { steps: 8 }); await p.mouse.up();
  if (!keep) await p.click(".draw .btn.primary");
}
// The Text tool: a tap opens a field there; a tap elsewhere puts the text on the picture.
async function typeText(p, at, text){
  await p.click('.draw button[title="Text"]');
  const b = await p.locator(".draw .dview").boundingBox();
  await p.mouse.click(b.x + b.width / 2 + at[0], b.y + b.height / 2 + at[1]);
  await p.waitForSelector(".draw .dtext");
  await p.keyboard.type(text);
  await p.mouse.click(b.x + 8, b.y + 8);
  await p.waitForSelector(".draw .dtext", { state: "detached" });
}
async function save(p, label, file){
  await p.click('button[title="Export and more"]');
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
  await p.setInputFiles(".opens label.main input", path.join(media, "shot_v001.png"));
  await p.waitForSelector(".stage img");
  await p.click(".newbar .add");
  await p.fill(".newbar textarea", "Sky too dark — небо темнее");
  await p.click(".newbar .send");
  await p.waitForSelector(".note");
  await p.click("text=✎ Draw a note");
  await drawOn(p, "Rectangle", [-50, -25], [50, 25], true);
  await typeText(p, [-40, 40], "Lift\nсюда");
  await p.click(".draw .btn.primary");
  await p.waitForSelector(".newbar .atts .fw");
  await p.fill(".newbar textarea", "Box this");
  await p.click(".newbar .send");
  await p.waitForFunction(() => document.querySelectorAll(".note").length === 2);
  const first = p.locator(".note").first();
  await tap(first.locator('button:has-text("Reply")'));
  await first.locator("textarea").fill("Lifted it");
  await first.locator('.cmp input[type="file"]').setInputFiles(path.join(media, "shot_v001.png"));
  await p.waitForSelector(".note .atts img");
  await tap(first.locator(".opt.done"));
  await tap(first.locator(".send"));
  await p.waitForFunction(() => document.querySelector(".note .rep.ev.done"));
  await p.click(".rstate");
  await p.click('.menu button:has-text("Changes requested")');
  await p.waitForTimeout(400);
  res.imageRows = await rowsOf(p);
  res.imageSrev = await save(p, "Review file for Sight", path.join(out, "app_image.srev"));
  res.imagePdf = await save(p, "PDF report", path.join(out, "app_image.pdf"));
  res.imageHtml = await save(p, "Web page", path.join(out, "app_image.html"));
  // ---- video ----
  const clip = path.join(media, "clip_v001.webm");
  if (fs.existsSync(clip)){
    await p.goto(base);
    await p.waitForSelector(".opens");
    await p.setInputFiles(".opens label.main input", clip);
    await p.waitForSelector(".stage video");
    await p.waitForFunction(() => document.querySelector(".stage video").readyState >= 2);
    for (let i = 0; i < 5; i++) await p.click('button[title="Next frame"]');
    await p.waitForTimeout(300);
    res.tcAfter5 = await p.textContent(".tc");
    await p.click('button[title="Play / pause"]'); await p.waitForTimeout(2500); await p.click('button[title="Play / pause"]');
    res.fps = await p.evaluate(() => window.__sightReview.R.fps);
    // Drag sideways on the picture: half the stage's width = half the clip.
    await p.evaluate(() => { window.__sightReview.R.video.currentTime = 0.5; });
    await p.waitForTimeout(300);
    const sb = await p.locator(".stage").boundingBox();
    await p.mouse.move(sb.x + sb.width * 0.25, sb.y + sb.height / 2); await p.mouse.down();
    await p.mouse.move(sb.x + sb.width * 0.75, sb.y + sb.height / 2, { steps: 12 }); await p.mouse.up();
    await p.waitForTimeout(600);
    res.scrubbed = await p.evaluate(() => [window.__sightReview.R.video.currentTime, window.__sightReview.R.video.paused]);
    await p.evaluate(() => { window.__sightReview.R.video.currentTime = 1.0; });
    await p.waitForTimeout(400);
    await p.click("text=✎ Draw a note");
    await drawOn(p, "Ellipse", [-40, -30], [40, 30]);
    await p.waitForSelector(".newbar .atts .fw");
    await p.fill(".newbar textarea", "Ring at one second");
    await p.click(".newbar .send");
    await p.waitForSelector(".note");
    const n = p.locator(".note").first();
    await tap(n.locator('button:has-text("Reply")'));
    await tap(n.locator(".pen"));
    await drawOn(p, "Arrow", [-60, 40], [0, 0]);
    await tap(n.locator(".send"));
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
  }
  // ---- persistence: reload, the reviews open with the files kept on the device ----
  await p.goto(base);
  await p.waitForSelector(".item");
  res.listed = await p.locator(".item").count();
  await p.locator('.item:has-text("shot_v001.png")').click();
  await p.waitForSelector(".stage img");
  res.reopenedNotes = await p.locator(".note").count();
  // The picked file was kept on the device: the review opens with it, no picker.
  res.reopenedFile = await p.evaluate(() => !!window.__sightReview.R.file);
  res.reopenedPicker = await p.locator(".stage .none").count();
  if (fs.existsSync(clip)){
    await p.goto(base);
    await p.locator('.item:has-text("clip_v001.webm")').click();
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
  await p.setInputFiles(".opens label:not(.main) input", srev);
  await p.waitForSelector(".review .note");
  res.toast1 = await p.textContent(".toast");
  res.picker = await p.locator(".stage .none label").count();
  // Picking the same file (name + size) binds it to that review; a local note, then the same
  // .srev again: nothing new, the local note stays.
  await p.setInputFiles(".stage .none input", path.join(media, "shot_v001.png"));
  await p.waitForSelector(".stage img");
  await p.click(".newbar .add");
  await p.fill(".newbar textarea", "Local note on the phone");
  await p.click(".newbar .send");
  await p.waitForTimeout(400);
  await p.goto(base);
  await p.waitForSelector(".opens");
  await p.setInputFiles(".opens label:not(.main) input", srev);
  await p.waitForSelector(".review .note");
  await p.waitForTimeout(300);
  res.toast2 = await p.textContent(".toast");
  res.listed = await p.evaluate(async () => (await window.__sightReview.DB.all("reviews")).length);
  res.rows = await rowsOf(p);
  await b.close();
  return res;
}

(mode === "make" ? make() : merge()).then((res) => {
  res.log = log;
  process.stdout.write(JSON.stringify(res));
}).catch((e) => { console.error(e); console.error(log.join("\n")); process.exit(1); });
