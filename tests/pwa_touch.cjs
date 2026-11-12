// Touch gestures of the phone app (0.27.0), in headless Chromium with a touch screen (CDP touch
// events: several fingers at once). Called by tests/test_pwa.py; prints a JSON summary.
//
//   node tests/pwa_touch.cjs <baseURL> <video file>
//   player: a finger scrub, then Play — plays from the scrubbed frame; frame steps queued up, then
//   Space; two fingers zoom / turn the picture; the drawing canvas opens in the player's place and
//   view and hands it back. Canvas: hold + drag up = a bigger brush (preview on the left), two- /
//   three-finger taps undo / redo, the transform tool's hold + drag sideways = opacity, a hold on
//   a tool's button = its default size. Panel: swipe up opens it ("+ Note" shows), pulling the list
//   down closes it; a swipe down on the player goes back to the reviews.
"use strict";
const { chromium } = require("playwright");
const [base, clip] = process.argv.slice(2);
const out = {}, log = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => log.push("pageerror: " + e.message));
  p.on("console", (m) => { if (m.type() === "error") log.push("console: " + m.text()); });
  await p.goto(base);
  await p.evaluate(() => { localStorage.setItem("sight-review:name", "Touch Tester"); localStorage.removeItem("sight-review:pen"); });
  await p.reload();
  await p.waitForSelector(".opens");
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i })) });
  async function drag(from, to, steps = 10, dt = 16){
    await touch("touchStart", [from]);
    for (let i = 1; i <= steps; i++){ await touch("touchMove", [[from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps]]); await sleep(dt); }
    await touch("touchEnd", []);
  }
  async function tapN(pts){ await touch("touchStart", pts); await sleep(60); await touch("touchEnd", []); }
  async function holdDrag(at, dx, dy){
    await touch("touchStart", [at]); await sleep(600);
    for (let i = 1; i <= 8; i++){ await touch("touchMove", [[at[0] + dx * i / 8, at[1] + dy * i / 8]]); await sleep(16); }
  }
  const ev = (f) => p.evaluate(f);
  const R = "window.__sightReview.R";
  const val = (expr) => p.evaluate(expr);

  await p.setInputFiles(".opens label.main input", clip);
  await p.waitForSelector(".stage video");
  await p.waitForFunction(() => document.querySelector(".stage video").readyState >= 2);
  await sleep(500);
  const sb = await p.locator(".stage").boundingBox();
  const cx = sb.x + sb.width / 2, cy = sb.y + sb.height / 2;
  out.newbarClosed = await ev(() => getComputedStyle(document.querySelector(".newbar")).visibility);
  out.stateControl = await ev(() => document.querySelectorAll(".rstate").length);

  // A finger scrub, then (a human moment later) a tap: plays on from the scrubbed frame.
  await drag([cx - 100, cy], [cx + 40, cy], 30, 12);
  out.scrubbedTo = await val(`${R}.scrubT != null ? ${R}.scrubT : ${R}.video.currentTime`);
  await sleep(120);
  await tapN([[cx, cy]]);
  await p.waitForFunction(() => !window.__sightReview.R.video.paused, null, { timeout: 3000 }).catch(() => {});
  out.playFrom = await val(`[${R}.video.currentTime, ${R}.video.paused]`);
  await val(`${R}.video.pause()`);
  await sleep(300);
  // Frame steps queued up (their seeks still on the way), then Space at once.
  for (let i = 0; i < 12; i++) await p.keyboard.press("Period");
  out.stepAsked = await val(`${R}.want != null ? ${R}.want : ${R}.scrubT`);
  await p.keyboard.press("Space");
  await p.waitForFunction(() => !window.__sightReview.R.video.paused, null, { timeout: 3000 }).catch(() => {});
  out.stepPlay = await val(`[${R}.video.currentTime, ${R}.video.paused]`);
  await val(`${R}.video.pause()`);
  await sleep(300);

  // Two fingers apart and turned: the player zooms and turns; the Fit button shows.
  await touch("touchStart", [[cx - 50, cy], [cx + 50, cy]]);
  for (let i = 1; i <= 8; i++){ await touch("touchMove", [[cx - 50 - i * 10, cy - i * 4], [cx + 50 + i * 10, cy + i * 4]]); await sleep(16); }
  await touch("touchEnd", []);
  await sleep(300);
  out.pv = await val(`${R}.pv`);
  out.fitShown = await ev(() => !document.querySelector('button[title="Fit to screen"]').hidden);
  // The canvas shows the picture where the player did: the same box centre and the same size.
  const picOnStage = await ev(() => { const r = document.querySelector(".stage .sv").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await ev(() => document.querySelector('button[title="Draw a note on this picture / frame"]').click());
  await p.waitForSelector(".draw");
  await sleep(300);
  const picOnCanvas = await ev(() => { const r = document.querySelector(".draw .dbox").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  out.centreShift = Math.hypot(picOnStage[0] - picOnCanvas[0], picOnStage[1] - picOnCanvas[1]);
  out.canvasScale = await ev(() => { const m = new DOMMatrix(getComputedStyle(document.querySelector(".draw .dbox")).transform); return Math.hypot(m.a, m.b); });

  // Hold with the brush, drag up: a bigger brush, the preview on the left.
  await ev(() => { const x = document.querySelector('.draw button[title="Brush"]'); if (!x.classList.contains("on")) x.click(); });
  const s0 = await ev(() => window.SightReviewDraw.SIZE.brush);
  await holdDrag([cx, cy], 0, -200);
  out.preview = await ev(() => { const d = document.querySelector(".draw .dsize"); return d ? [d.getBoundingClientRect().left < 60, d.querySelector("span").textContent] : null; });
  await touch("touchEnd", []);
  out.brush = [s0, await ev(() => window.SightReviewDraw.SIZE.brush)];
  out.itemsAfterHold = await ev(() => document.querySelectorAll(".draw .dbox svg > g")[1].children.length);
  // A stroke; two fingers tap = undo, three = redo.
  await drag([cx - 60, cy + 30], [cx + 60, cy + 40], 8, 10);
  const nItems = () => ev(() => document.querySelectorAll(".draw .dbox svg > g")[1].children.length);
  out.undoRedo = [await nItems()];
  await tapN([[cx - 30, cy], [cx + 30, cy]]); await sleep(100);
  out.undoRedo.push(await nItems());
  await tapN([[cx - 30, cy], [cx + 30, cy], [cx, cy + 40]]); await sleep(100);
  out.undoRedo.push(await nItems());
  // The transform tool: hold on the stroke, drag left = more transparent.
  await ev(() => document.querySelector('.draw button[title="Select / transform"]').click());
  await tapN([[cx, cy + 35]]); await sleep(100);
  await holdDrag([cx, cy + 35], -160, 0);
  await touch("touchEnd", []);
  // A hold on the brush's button: back to its default size, brush in hand.
  const bb = await p.locator('.draw button[title="Brush"]').boundingBox();
  await touch("touchStart", [[bb.x + bb.width / 2, bb.y + bb.height / 2]]); await sleep(700); await touch("touchEnd", []);
  await sleep(50);
  out.brushReset = await ev(() => [window.SightReviewDraw.SIZE.brush, document.querySelector('.draw button[title="Brush"]').classList.contains("on")]);
  await ev(() => [...document.querySelectorAll(".draw .btn")].find((x) => x.textContent === "Done").click());
  await sleep(300);
  out.pvBack = await val(`${R}.pv`);
  out.compose = await ev(() => document.querySelector(".review").classList.contains("compose"));
  await p.fill(".newbar textarea", "Touch note");
  await p.click(".newbar .send");
  await sleep(300);
  out.stroke = await val(`${R}.rows.filter((r) => r.kind === "stroke").map((r) => r.data.opacity)`);

  // Swipe up: the Notes Panel and "+ Note"; pull the list down: back to the player.
  await ev(() => { window.__sightReview.R.pv = { z: 1, r: 0, o: [0, 0] }; });
  await drag([cx, cy + 80], [cx, cy - 80], 8, 16);
  await sleep(400);
  out.panel = [await val(`${R}.panel`), await ev(() => getComputedStyle(document.querySelector(".newbar")).visibility)];
  await drag([200, 300], [200, 420], 8, 16);
  await sleep(400);
  out.panel.push(await val(`${R}.panel`));
  // A swipe down on the player: the list of reviews.
  await drag([cx, cy - 60], [cx, cy + 100], 8, 16);
  await sleep(500);
  out.home = await ev(() => !!document.querySelector(".opens"));
  // Home: swipe left uncovers the bin, a tap elsewhere covers it; swipe right + the eye hides the
  // review for now (*Show* brings it back).
  await p.waitForSelector(".list .row");
  let rb = await p.locator(".list .row").first().boundingBox();
  await drag([rb.x + 300, rb.y + rb.height / 2], [rb.x + 150, rb.y + rb.height / 2]);
  await sleep(300);
  out.swipeLeft = await ev(() => document.querySelector(".list .row").className);
  await tapN([[200, 30]]); await sleep(300);
  out.covered = await ev(() => document.querySelector(".list .row").className);
  await drag([rb.x + 60, rb.y + rb.height / 2], [rb.x + 220, rb.y + rb.height / 2]);
  await sleep(300);
  const eye = await p.locator(".list .row .sw.hide").boundingBox();
  await tapN([[eye.x + 20, eye.y + eye.height / 2]]); await sleep(400);
  out.hidden = await ev(() => [document.querySelectorAll(".list .row").length, document.querySelector(".list .foot") && document.querySelector(".list .foot").textContent]);
  out.log = log;
  console.log(JSON.stringify(out));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
