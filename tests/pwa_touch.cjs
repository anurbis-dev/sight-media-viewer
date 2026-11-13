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
  await p.waitForSelector("label.pick-media");
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

  await p.setInputFiles("label.pick-media input", clip);
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
  const fsAfterDrag = await ev(() => !!document.fullscreenElement);  // a scrub is no tap: not yet
  await sleep(120);
  await tapN([[cx, cy]]);
  await p.waitForFunction(() => !window.__sightReview.R.video.paused, null, { timeout: 3000 }).catch(() => {});
  out.playFrom = await val(`[${R}.video.currentTime, ${R}.video.paused]`);
  // Auto full screen (the default): that first tap took the page full screen.
  await p.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 2000 }).catch(() => {});  // it takes a moment
  out.fullscreen = [fsAfterDrag, await ev(() => !!document.fullscreenElement)];
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
  // The frame rate left of the time: drag up = faster (the number with it), a tap = the nearest
  // common rate, a hold = the clip's own. The sound icon: grey, the test clip has no sound (Chrome
  // tells after some play).
  const fb = await p.locator(".tpi .fps").first().boundingBox(), fc = [fb.x + fb.width / 2, fb.y + fb.height / 2];
  await drag(fc, [fc[0], fc[1] - 40], 8, 16); await sleep(100);
  const sp = () => ev(() => [window.__sightReview.R.video.playbackRate, document.querySelector(".tpi .fps").textContent, window.__sightReview.R.fps]);
  out.speed = [await sp()];
  await tapN([fc]); await sleep(100);
  out.speed.push(await sp());
  await touch("touchStart", [fc]); await sleep(700); await touch("touchEnd", []); await sleep(100);
  out.speed.push(await sp());
  // The speaker: a tap mutes, another gives full volume (a drag sets it from where it is).
  await val(`${R}.hasAudio = null`);
  const snb = await p.locator(".tpi .snd").first().boundingBox(), sc = [snb.x + snb.width / 2, snb.y + snb.height / 2];
  await tapN([sc]); await sleep(100);
  out.mute = [await ev(() => [localStorage.getItem("sight-review:vol"), window.__sightReview.R.video.muted])];
  await tapN([sc]); await sleep(100);
  out.mute.push(await ev(() => [localStorage.getItem("sight-review:vol"), window.__sightReview.R.video.muted]));
  // The header's left button hides every control; the round one in the top left brings them back.
  await ev(() => document.querySelector(".hdr .uib").click()); await sleep(100);
  const ui = () => ev(() => [document.querySelector(".review").classList.contains("clean"), getComputedStyle(document.querySelector(".hdr")).display, getComputedStyle(document.querySelector(".player .tp")).display,
    getComputedStyle(document.querySelector(".pbar")).display, getComputedStyle(document.querySelector(".player .fab.showui")).display]);
  out.clean = [await ui()];
  await ev(() => document.querySelector(".player .fab.showui").click()); await sleep(100);
  out.clean.push(await ui());
  // Right of the sound: once (the default) / loop — the player's loop follows, kept on the device.
  const lp = () => ev(() => [window.__sightReview.R.video.loop, document.querySelector(".tpi .loopb").classList.contains("on"), localStorage.getItem("sight-review:loop")]);
  out.loop = [await lp()];
  await ev(() => document.querySelector(".tpi .loopb").click()); await sleep(100);
  out.loop.push(await lp());
  await ev(() => document.querySelector(".tpi .loopb").click()); await sleep(100);
  out.loop.push(await lp());


  // Pencil right after a scrub: the canvas opens at once on the scrubbed frame (the cached picture),
  // and the player's own frame replaces it once the seek has landed — no waiting, no stale frame.
  await drag([cx + 60, cy], [cx - 80, cy], 20, 12);
  await sleep(600);
  // A frame step and the pencil in one go: the canvas is up while that step's seek is still on its way.
  out.penAfterScrub = [await ev(async () => {
    const R = window.__sightReview.R;
    document.querySelector('.player button[title="Next frame"]').click();
    document.querySelector('button[title="Draw a note on this picture / frame"]').click();
    for (let i = 0; i < 20 && !document.querySelector(".draw"); i++) await Promise.resolve();
    return !!document.querySelector(".draw") && (R.scrubT != null || R.video.seeking);
  })];
  await p.waitForSelector(".draw");
  await p.waitForFunction(() => { const R = window.__sightReview.R, i = document.querySelector(".draw .dbox > img");
    return i && [...R.frames.values()].some((f) => f.url === i.getAttribute("src")); }, null, { timeout: 4000 }).then(() => true, () => false).then((x) => out.penAfterScrub.push(x));
  out.penAfterScrub.push(await ev(() => { const R = window.__sightReview.R, i = document.querySelector(".draw .dbox > img");
    const k = [...R.frames.entries()].find(([, f]) => f.url === i.getAttribute("src")); return k ? Math.abs(Number(k[0].slice(2)) - R.video.currentTime) < 1 / R.fps : false; }));
  await ev(() => [...document.querySelectorAll(".draw .btn")].find((x) => x.textContent === "Cancel").click());
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
  // Hold, drag left: the brush gets more transparent (the size stays), the preview says by how much.
  const o0 = await ev(() => [window.SightReviewDraw.OPAC.brush, window.SightReviewDraw.SIZE.brush]);
  await holdDrag([cx, cy], -150, 4);
  const lab = await ev(() => { const d = document.querySelector(".draw .dsize"); return d ? d.querySelector("span").textContent : ""; });
  await touch("touchEnd", []);
  out.opac = [o0[0], await ev(() => window.SightReviewDraw.OPAC.brush), / %$/.test(lab), (await ev(() => window.SightReviewDraw.SIZE.brush)) === o0[1],
    await ev(() => document.querySelectorAll(".draw .dbox svg > g")[1].children.length)];
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
  out.brushReset = await ev(() => [window.SightReviewDraw.SIZE.brush, document.querySelector('.draw button[title="Brush"]').classList.contains("on"), window.SightReviewDraw.OPAC.brush]);
  // No tool in hand (a tap on the tool held puts it down): a tap plays inside the canvas (the clip
  // painted in the picture's place), another pauses there; a stroke then goes on the frame reached.
  await ev(() => { const x = document.querySelector('.draw button[title="Brush"]'); delete x.dataset.held; x.click(); });
  out.toolOff = await ev(() => !document.querySelector(".draw .tb.on"));
  const t0 = await val(`${R}.video.currentTime`);
  await tapN([[cx, cy]]);
  await p.waitForFunction(() => !window.__sightReview.R.video.paused, null, { timeout: 3000 }).catch(() => {});
  await sleep(150);
  out.livePlay = [await val(`!${R}.video.paused`), await ev(() => !!document.querySelector(".draw .dbox.live canvas"))];
  await sleep(400);
  await tapN([[cx, cy]]);
  await sleep(400);
  out.livePause = [await val(`${R}.video.paused`), await ev(() => !!document.querySelector(".draw .dbox.live")), (await val(`${R}.video.currentTime`)) - t0];
  await ev(() => document.querySelector('.draw button[title="Brush"]').click());
  await drag([cx - 60, cy - 60], [cx + 60, cy - 50], 8, 10);
  await sleep(100);
  out.drawnFrames = await val(`${R}.drawS.times().length`);
  // Played to its end inside the canvas: it stops on the last frame, that frame's own picture (not
  // a dimmed stand-in under a key past the end).
  await ev(() => { const x = document.querySelector('.draw button[title="Brush"]'); delete x.dataset.held; x.click(); });
  await val(`new Promise((ok) => { const v = ${R}.video; v.addEventListener("seeked", ok, { once: true }); v.currentTime = Math.max(0, v.duration - 0.3); })`);
  await sleep(200);
  await tapN([[cx, cy]]);
  await p.waitForFunction(() => window.__sightReview.R.video.ended, null, { timeout: 4000 }).catch(() => {});
  await sleep(800);
  out.atEnd = await ev(() => { const i = document.querySelector(".draw .dbox > img"); return [window.__sightReview.R.video.ended, i.style.opacity, !!document.querySelector(".draw .dbox.live")]; });
  await ev(() => [...document.querySelectorAll(".draw .btn")].find((x) => x.textContent === "Done").click());
  await sleep(300);
  out.pvBack = await val(`${R}.pv`);
  out.compose = await ev(() => document.querySelector(".review").classList.contains("compose"));
  await p.fill(".newbar textarea", "Touch note");
  await p.click(".newbar .send");
  await sleep(300);
  out.stroke = await val(`${R}.rows.filter((r) => r.kind === "stroke").map((r) => r.data.opacity)`);
  // A new drawing session: a clean timeline (not the note just made).
  out.markersPlayer = await ev(() => document.querySelectorAll(".player .tl .mk").length);
  await ev(() => document.querySelector('button[title="Draw a note on this picture / frame"]').click());
  await p.waitForSelector(".draw");
  await sleep(300);
  out.markersCanvas = await ev(() => document.querySelectorAll(".draw .tl .mk").length);
  // Tool rows: a tap on Shapes shows its five above the bar; a pick folds it and is the tool (the
  // slot shows it). A tap on Arrows shows its row; touching the picture folds it, the arrow kept.
  // The colour at the bar's end: a tap shows the colours, a pick sets it.
  await ev(() => document.querySelector('.draw .dtools button[title="Shapes"]').click()); await sleep(100);
  out.fly = [await ev(() => document.querySelectorAll(".draw .dfly:not([hidden]) button").length)];
  await ev(() => document.querySelector('.draw .dfly button[title="Filled ellipse"]').click()); await sleep(100);
  out.fly.push(await ev(() => [!!document.querySelector(".draw .dfly:not([hidden])"), document.querySelector('.draw .dtools button[title="Shapes"]').classList.contains("on"),
    JSON.parse(localStorage.getItem("sight-review:pen")).tool]));
  await drag([cx - 40, cy - 30], [cx + 40, cy + 30], 6, 16); await sleep(100);
  out.fly.push(await ev(() => { const g = document.querySelectorAll(".draw .dbox svg > g")[1]; return g.children.length; }));
  // The Shapes row's last button: the fill colour — a second row (the line's own + 6); blue, then a
  // rectangle drawn is filled blue; back to the line's own.
  await ev(() => document.querySelector('.draw .dtools button[title="Shapes"]').click()); await sleep(80);
  await ev(() => document.querySelector('.draw .dfly button[title="Fill colour"]').click()); await sleep(80);
  out.fill = [await ev(() => { const r = document.querySelector(".draw .dsub:not([hidden])"); return r ? r.querySelectorAll("button").length : 0; })];
  await ev(() => document.querySelector('.draw .dsub .swc[data-c="#0a84ff"]').click()); await sleep(80);
  await drag([cx - 50, cy - 40], [cx + 30, cy + 20], 6, 16); await sleep(100);
  out.fill.push(await ev(() => { const P = JSON.parse(localStorage.getItem("sight-review:pen")); return [P.fill, P.shape, !!document.querySelector(".draw .dfly:not([hidden])")]; }));
  out.fill.push(await ev(() => { const g = document.querySelectorAll(".draw .dbox svg > g")[1]; return [...g.querySelectorAll("path")].some((x) => x.getAttribute("fill") === "#0a84ff"); }));
  await ev(() => document.querySelector('.draw button[title="Undo"]').click());
  await ev(() => document.querySelector('.draw .dtools button[title="Shapes"]').click()); await sleep(80);
  await ev(() => document.querySelector('.draw .dfly button[title="Fill colour"]').click()); await sleep(80);
  await ev(() => document.querySelector('.draw .dsub button[title^="Fill: the line"]').click()); await sleep(80);
  out.fill.push(await ev(() => JSON.parse(localStorage.getItem("sight-review:pen")).fill));
  // A key takes a tool: the open row folds (it would show a stale pick).
  await ev(() => document.querySelector('.draw .dtools button[title="Shapes"]').click()); await sleep(80);
  await p.keyboard.press("KeyB"); await sleep(80);
  out.flyKey = await ev(() => [!!document.querySelector(".draw .dfly:not([hidden])"), JSON.parse(localStorage.getItem("sight-review:pen")).tool]);
  await ev(() => document.querySelector('.draw button[title="Undo"]').click());
  await ev(() => document.querySelector('.draw .dtools button[title="Arrows and lines"]').click()); await sleep(100);
  out.fly.push(await ev(() => document.querySelectorAll(".draw .dfly:not([hidden]) button").length));
  await touch("touchStart", [[cx, cy]]); await sleep(50);
  out.fly.push(await ev(() => [!!document.querySelector(".draw .dfly:not([hidden])"), JSON.parse(localStorage.getItem("sight-review:pen")).tool]));
  await touch("touchEnd", []); await sleep(100);
  await ev(() => { const u = document.querySelector('.draw button[title="Undo"]'); if (!u.disabled) u.click(); });
  await ev(() => document.querySelector(".draw .dtools .dcol").click()); await sleep(100);
  out.fly.push(await ev(() => document.querySelectorAll(".draw .dfly:not([hidden]) .swc").length));
  await ev(() => document.querySelector('.draw .dfly .swc[data-c="#ffd60a"]').click()); await sleep(100);
  out.fly.push(await ev(() => [getComputedStyle(document.querySelector(".draw .dtools .dcol i")).backgroundColor, !!document.querySelector(".draw .dbar .swc")]));
  // The text slot: its row of switches (the bar's own see-through look); Bold and the alignment
  // go to the pen; a tap on the picture opens a bold, centred field; Italic while typing styles it;
  // the text put down carries all three.
  await ev(() => document.querySelector('.draw .dtools button[title="Text"]').click()); await sleep(100);
  out.textFly = [await ev(() => [document.querySelectorAll(".draw .dfly:not([hidden]) .tb").length, document.querySelector(".draw .dfly").classList.contains("rd-panel")])];
  await ev(() => document.querySelector('.draw .dfly button[title="Bold"]').click());
  await ev(() => document.querySelector('.draw .dfly button[title^="Alignment"]').click()); await sleep(50);
  out.textFly.push(await ev(() => [document.querySelector('.draw .dfly button[title="Bold"]').classList.contains("on"), document.querySelector('.draw .dfly button[title^="Alignment"]').title,
    JSON.parse(localStorage.getItem("sight-review:pen")).text.bold]));
  await tapN([[cx, cy - 60]]); await sleep(150);
  out.textFly.push(await ev(() => { const t = document.querySelector(".draw .dtext"); return t ? [getComputedStyle(t).fontWeight, t.style.textAlign] : null; }));
  await p.keyboard.type("Hi");
  await ev(() => document.querySelector('.draw .dtools button[title="Text"]').click()); await sleep(80);
  await ev(() => document.querySelector('.draw .dfly button[title="Italic"]').click()); await sleep(50);
  out.textFly.push(await ev(() => { const t = document.querySelector(".draw .dtext"); return t ? getComputedStyle(t).fontStyle : null; }));
  await tapN([[cx + 120, cy + 120]]); await sleep(150);
  out.textFly.push(await ev(() => { const g = document.querySelectorAll(".draw .dbox svg > g")[1].querySelector('g[font-weight="700"]');
    return g ? [g.getAttribute("font-style"), g.getAttribute("text-anchor"), g.textContent] : null; }));
  await ev(() => { const u = document.querySelector('.draw button[title="Undo"]'); if (!u.disabled) u.click(); });
  // The pen's switches back to plain (bold, italic off; the alignment round to left), the brush in hand.
  await ev(() => { document.querySelector('.draw .dtools button[title="Text"]').click(); });
  await sleep(50);
  await ev(() => { for (const t of ["Bold", "Italic"]) document.querySelector('.draw .dfly button[title="' + t + '"]').click();
    for (let i = 0; i < 2; i++) document.querySelector('.draw .dfly button[title^="Alignment"]').click(); });
  // Box / Font: a second row above — the box's colours (the box switched on; a tap switches it off,
  // the row goes), the fonts; a pick sets it and folds that row.
  await ev(() => document.querySelector('.draw .dfly button[title="Box behind the text"]').click()); await sleep(80);
  const boxOff = await ev(() => [JSON.parse(localStorage.getItem("sight-review:pen")).text.bgOn, !!document.querySelector(".draw .dsub:not([hidden])")]);
  await ev(() => document.querySelector('.draw .dfly button[title="Box behind the text"]').click()); await sleep(80);
  out.textSub = [await ev(() => { const r = document.querySelector(".draw .dsub:not([hidden])"); return r ? [r.querySelectorAll(".tb").length, r.querySelectorAll(".swc").length, r.classList.contains("rd-panel"),
    r.getBoundingClientRect().bottom <= document.querySelector(".draw .dfly:not(.dsub)").getBoundingClientRect().top] : null; })];
  await ev(() => document.querySelector('.draw .dsub .swc[data-c="#ffffff"]').click()); await sleep(80);
  await ev(() => document.querySelector('.draw .dfly button[title^="Font"]').click()); await sleep(80);
  out.textSub.push(await ev(() => document.querySelectorAll(".draw .dsub:not([hidden]) .tb").length));
  await ev(() => document.querySelector('.draw .dsub button[title="Font: serif"]').click()); await sleep(80);
  out.textSub.push(await ev(() => { const t = JSON.parse(localStorage.getItem("sight-review:pen")).text; return [t.bg, t.bgOn, t.font, !!document.querySelector(".draw .dsub:not([hidden])"), !!document.querySelector(".draw .dfly:not([hidden])")]; }), boxOff);
  // Back to the defaults: a black box (off, on: the colours), sans.
  await ev(() => document.querySelector('.draw .dfly button[title="Box behind the text"]').click()); await sleep(80);
  await ev(() => document.querySelector('.draw .dfly button[title="Box behind the text"]').click()); await sleep(80);
  await ev(() => document.querySelector('.draw .dsub .swc[data-c="#000000"]').click()); await sleep(80);
  await ev(() => document.querySelector('.draw .dfly button[title^="Font"]').click()); await sleep(80);
  await ev(() => document.querySelector('.draw .dsub button[title="Font: sans"]').click()); await sleep(80);
  out.textFly.push(await ev(() => JSON.parse(localStorage.getItem("sight-review:pen")).text));
  await ev(() => document.querySelector('.draw .dtools button[title="Brush"]').click()); await sleep(50);
  out.canvasRot0 = await ev(() => { const m = new DOMMatrix(getComputedStyle(document.querySelector(".draw .dbox")).transform); return Math.round(Math.atan2(m.b, m.a) * 180 / Math.PI); });
  // Pinched smaller than fit and turned a little, let go: back to fit, the turn straight (as the
  // player does).
  await touch("touchStart", [[cx - 120, cy], [cx + 120, cy]]);
  for (let i = 1; i <= 8; i++){ await touch("touchMove", [[cx - 120 + i * 11, cy - i], [cx + 120 - i * 11, cy + i]]); await sleep(16); }
  await touch("touchEnd", []);
  await sleep(400);
  out.canvasSettle = await ev(() => { const m = new DOMMatrix(getComputedStyle(document.querySelector(".draw .dbox")).transform);
    const fb = document.querySelector(".draw .dtop button[title^='Fit']") || [...document.querySelectorAll(".draw button")].find((b) => /fit/i.test(b.title));
    return [Math.round(Math.atan2(m.b, m.a) * 180 / Math.PI), fb ? fb.hidden : null, document.querySelector(".draw .dbox").style.transition]; });
  await ev(() => [...document.querySelectorAll(".draw .btn")].find((x) => x.textContent === "Cancel").click());
  await sleep(200);
  // Playing, then the Notes Panel opens: the clip pauses where it was. (Meanwhile Chrome finds the
  // test clip has no sound: the speaker goes grey.)
  await val(`${R}.video.play()`);
  await sleep(200);
  await p.waitForFunction(() => window.__sightReview.R.hasAudio === false, null, { timeout: 3000 }).catch(() => {});
  out.sound = await ev(() => [!!document.querySelector(".tpi .snd.none"), window.__sightReview.R.hasAudio]);
  if (await val(`${R}.video.paused`)) await val(`${R}.video.play()`);

  // Swipe up: the Notes Panel and "+ Note"; pull the list down: back to the player.
  await ev(() => { window.__sightReview.R.pv = { z: 1, r: 0, o: [0, 0] }; });
  await drag([cx, cy + 80], [cx, cy - 80], 8, 16);
  await sleep(400);
  out.panel = [await val(`${R}.panel`), await ev(() => getComputedStyle(document.querySelector(".newbar")).visibility)];
  out.panelPaused = await val(`${R}.video.paused`);
  // "+ Note": the player's timeline is clean while the note is written.
  await ev(() => document.querySelector(".newbar .add").click());
  await sleep(100);
  out.markersCompose = await ev(() => document.querySelectorAll(".player .tl .mk").length);
  await ev(() => document.querySelector('.newbar button[title="Close"]').click());
  await sleep(100);
  // A swipe sideways on the list: the next status filter (left), back again (right).
  const pl = await p.locator(".plist").boundingBox(), py = pl.y + Math.min(200, pl.height / 2);
  await drag([pl.x + pl.width - 40, py], [pl.x + 40, py], 8, 16); await sleep(250);
  out.filterSwipe = [await val(`${R}.filter`), await ev(() => document.querySelector(".pbar .seg button.on").textContent.replace(/\d+$/, ""))];
  await drag([pl.x + 40, py], [pl.x + pl.width - 40, py], 8, 16); await sleep(250);
  out.filterSwipe.push(await val(`${R}.filter`));
  // A tap on a note's card selects it (the accent frame) and puts the player on its first frame.
  await val(`(${R}.curNote = null, ${R}.video.currentTime = Math.max(0, ${R}.video.duration - 0.5))`); await sleep(300);
  const selId = await ev(() => { const c = [...document.querySelectorAll(".note")].find((x) => x.querySelector(".text")); c.querySelector(".text").click(); return c.dataset.id; }); await sleep(500);
  out.select = await ev(`(() => { const R = window.__sightReview.R, n = R.rows.find((r) => r.id === ${JSON.stringify(selId)});
    const ts = [n.data.ctx.t].concat(R.rows.filter((r) => r.kind === "stroke" && r.data.note === n.id && !r.data.reply).map((r) => r.data.ctx.t));
    return [R.curNote === n.id, document.querySelector('.note[data-id="' + n.id + '"]').classList.contains("cur"), Math.abs(R.video.currentTime - Math.min(...ts)) < 1 / R.fps]; })()`);
  // The note's pictures: equal squares in one grid (4 to a row by default).
  out.pics = await ev(() => { const c = [...document.querySelectorAll(".note .pics > .fw")]; const w = c.map((x) => Math.round(x.getBoundingClientRect().width)), h = c.map((x) => Math.round(x.getBoundingClientRect().height));
    const g = document.querySelector(".note .pics"); return [c.length, w.every((x, i) => x === w[0] && Math.abs(h[i] - x) <= 1), Math.abs(w[0] * 4 + 12 - g.getBoundingClientRect().width) <= 2]; });
  // The note's pictures full screen: sideways = its other frame (the caption says which); a swipe
  // never closes it, only Back does.
  await p.waitForSelector(".note .fw:not(.wait):not(.sm):not(.shot)", { timeout: 10000 });
  await ev(() => document.querySelector(".note .fw:not(.wait):not(.sm):not(.shot)").click());
  await p.waitForSelector(".view");
  const capNow = () => ev(() => { const c = document.querySelector(".view .cap .fr"); return c ? c.textContent : null; });
  out.viewer = [await capNow()];
  // The caption's words: up to three lines, more scroll inside it (a drag there scrolls the words,
  // it does not go to another note).
  const capTx = await ev(() => { const t = document.querySelector(".view .cap .tx"); t.textContent = Array.from({ length: 12 }, (_, i) => "Line " + (i + 1) + " of a long note").join("\n");
    const r = t.getBoundingClientRect(), lh = parseFloat(getComputedStyle(t).lineHeight); return [Math.round(r.height / lh), t.scrollHeight > t.clientHeight + 10, r.x + r.width / 2, r.y + r.height / 2]; });
  // (A finger scrolls them natively: the viewer leaves touches on the words alone — no pointer
  // capture, no preventDefault; the wheel there does not zoom the picture. They take the
  // caption's full width, under the number and the frame.)
  const scrolls = await ev(() => { const t = document.querySelector(".view .cap .tx"), r = t.getBoundingClientRect(), h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    t.scrollTop = 30; return h === t && t.scrollTop > 0 && r.width > innerWidth * 0.5; });
  // The caption spans the width; the pencil sits over it.
  out.capPlace = await ev(() => { const c = document.querySelector(".view .cap").getBoundingClientRect(), pn = document.querySelector(".view .fab.pencil").getBoundingClientRect();
    return [Math.round(c.width) === innerWidth - 24, pn.bottom <= c.top, pn.right > innerWidth - 40]; });
  const notCaught = await ev(() => { const t = document.querySelector(".view .cap .tx"); const e = new TouchEvent("touchmove", { bubbles: true, cancelable: true }); t.dispatchEvent(e); return !e.defaultPrevented; });
  out.capText = [capTx[0], capTx[1], scrolls, await capNow() === out.viewer[0], notCaught,
    await ev(() => { const b = document.querySelector(".view .vb"); return !b.style.transform.includes("scale(1)") ? b.style.transform : "fit"; })];
  await drag([320, 420], [60, 420], 8, 16);
  // A strip: the old picture goes on to the left, fading out, the new one comes in from the right, fading in.
  out.viewerFade = [await p.waitForFunction(() => { const b = document.querySelectorAll(".view .vb"); if (b.length !== 2) return false;
    const r0 = b[0].getBoundingClientRect(), r1 = b[1].getBoundingClientRect(); return r0.left < r1.left && Number(getComputedStyle(b[0]).opacity) < 1 && Number(getComputedStyle(b[1]).opacity) < 1; }, null, { timeout: 2000, polling: 16 }).then(() => true, () => false)];
  await sleep(800);
  out.viewerFade.push(await ev(() => document.querySelectorAll(".view .vb").length));
  out.viewer.push(await capNow());
  await drag([320, 420], [60, 420], 8, 16); await sleep(500);
  out.viewer.push(await capNow());
  await ev(() => document.querySelector(".view .fab.back").click()); await sleep(300);
  out.viewer.push(await ev(() => !!document.querySelector(".view")));
  await drag([200, 300], [200, 420], 8, 16);
  await sleep(400);
  out.panel.push(await val(`${R}.panel`));
  // Reply on the video note: over the player, on the note's first frame, its frames on the timeline
  // and as chips; a chip goes to that frame; the reply draws on a frame the note missed; leaving
  // keeps that frame and the note lit.
  const noteT = await ev(() => { const R = window.__sightReview.R, n = R.rows.find((r) => r.kind === "note");
    return [n.id, [...new Set(R.rows.filter((r) => r.kind === "stroke" && r.data.note === n.id).map((r) => r.data.ctx.t))].sort((a, b) => a - b)]; });
  const [nid, nts] = noteT;
  await ev(() => [...document.querySelectorAll(".note .acts .btn")].find((x) => x.textContent === "Reply").click());
  await sleep(700);
  const onT = (t) => ev(`Math.abs(window.__sightReview.R.video.currentTime - ${t}) < 1 / window.__sightReview.R.fps`);
  out.reply = [await val(`${R}.replyTo === ${JSON.stringify(nid)}`), await val(`${R}.panel`), await ev(() => document.querySelector(".review").classList.contains("compose")),
    await ev(() => document.querySelector(".newbar .row span").textContent.startsWith("Reply to note")), await ev(() => document.querySelectorAll(".newbar .frs button").length),
    await ev(() => document.querySelectorAll(".player .tl .mk").length), await onT(nts[0])];
  await ev(() => document.querySelectorAll(".newbar .frs button")[1].click());
  await sleep(700);
  out.replyChip = [await onT(nts[1]), await ev(() => document.querySelectorAll(".newbar .frs button")[1].classList.contains("on"))];
  const newT = await ev(`(() => { const R = window.__sightReview.R, fd = 1 / R.fps, ts = ${JSON.stringify(nts)};
    return [0.2, 0.6, 1.0, 1.4, 1.8].find((t) => t < R.video.duration - 0.2 && ts.every((x) => Math.abs(x - t) > 3 * fd)); })()`);
  await val(`new Promise((ok) => { const v = ${R}.video; v.addEventListener("seeked", ok, { once: true }); v.currentTime = ${newT}; })`);
  await sleep(300);
  await ev(() => document.querySelector(".newbar .cmp .pen").click());
  await p.waitForSelector(".draw");
  await sleep(400);
  await ev(() => { const x = document.querySelector('.draw button[title="Brush"]'); if (!x.classList.contains("on")) x.click(); });
  await drag([cx - 50, cy + 20], [cx + 50, cy + 30], 8, 10);
  await sleep(100);
  await ev(() => [...document.querySelectorAll(".draw .btn")].find((x) => x.textContent === "Done").click());
  await sleep(300);
  await p.fill(".newbar textarea", "Forgot this frame");
  await p.click(".newbar .send");
  await p.waitForFunction(() => document.querySelector(".note .rep .pics .fw:not(.wait)"), null, { timeout: 5000 }).catch(() => {});
  out.replySent = await ev(`(() => { const R = window.__sightReview.R, n = R.rows.find((r) => r.id === ${JSON.stringify(nid)});
    const rep = (n.data.replies || []).find((x) => x.text === "Forgot this frame");
    const ds = rep ? R.rows.filter((r) => r.data.reply === rep.id) : [];
    return [!!rep, ds.length > 0 && ds.every((r) => Math.abs(r.data.ctx.t - ${newT}) < 1 / R.fps), R.replyTo, R.curNote === n.id,
      document.querySelector('.note[data-id="' + n.id + '"]').classList.contains("cur"), Math.abs(R.video.currentTime - ${newT}) < 1 / R.fps,
      document.querySelectorAll('.note[data-id="' + n.id + '"] .rep .pics .fw:not(.wait)').length]; })()`);
  // A reply's drawing on the note's own frame stays off the note's picture (only the reply's).
  out.replyOffNote = await ev(`(() => { const S = window.__sightReview, R = S.R, n = R.rows.find((r) => r.id === ${JSON.stringify(nid)});
    const rep = n.data.replies.find((x) => x.text === "Forgot this frame"), t = n.data.ctx.t;
    R.rows.push({ id: "rq" + Date.now(), kind: "stroke", shape_kind: "brush", z_index: 99, created_at: Date.now(), updated_at: Date.now(), deleted_at: null,
      data: { note: n.id, reply: rep.id, ctx: n.data.ctx, tool: "brush", color: "#fff", width: 4, pts: [1, 1, 0.5, 9, 9, 0.5] } });
    const f = { at: { t, fps: R.fps } };
    const r = [S.drawingsOn(f).some((x) => x.data.reply), S.drawingsOn(f, { reply: rep.id }).some((x) => x.data.reply === rep.id)];
    R.rows.pop(); return r; })()`);
  // The note's viewer walks the whole thread: its two frames, then the reply's frame ("↳ …"); Back
  // leaves the player on the reply's frame.
  await p.waitForSelector(`.note[data-id="${nid}"] .fw:not(.wait):not(.sm):not(.shot)`, { timeout: 10000 });
  await ev(`document.querySelector('.note[data-id="${nid}"] .fw:not(.wait):not(.sm):not(.shot)').click()`);
  await p.waitForSelector(".view");
  await sleep(300);
  out.thread = [await capNow()];
  for (let k = 0; k < 3; k++){ await drag([320, 420], [60, 420], 8, 16); await sleep(700); out.thread.push(await capNow()); }
  out.thread.push(await ev(() => { const c = document.querySelectorAll(".view .cap span"); return c.length ? c[c.length - 1].textContent : null; }));
  await ev(() => document.querySelector(".view .fab.back").click()); await sleep(600);
  out.thread.push(await onT(newT));
  // A reply's menu: Edit text — the new words, marked edited.
  await ev(() => document.querySelector('.note .rep button[title="Reply actions"]').click()); await sleep(250);
  await ev(() => [...document.querySelectorAll(".sheet .menu button")].find((b) => b.textContent === "Edit text").click()); await sleep(250);
  await p.fill(".sheet textarea", "Forgot this frame — and the next");
  await ev(() => document.querySelector(".sheet .btn.primary").click()); await sleep(300);
  out.replyEdit = await ev(`(() => { const R = window.__sightReview.R, n = R.rows.find((r) => r.id === ${JSON.stringify(nid)});
    const rep = n.data.replies.find((x) => x.text && x.text.startsWith("Forgot"));
    const q = (sel) => document.querySelector('.note[data-id="' + n.id + '"] ' + sel);
    return [rep.text, !!rep.edited, q(".rep .rh").textContent.endsWith("edited"), q(".rep .rt").textContent]; })()`);
  // Replying again: the player's pencil draws the reply (not a hidden new note); the note deleted
  // meanwhile ends the reply.
  await ev(() => [...document.querySelectorAll(".note .acts .btn")].find((x) => x.textContent === "Reply").click());
  await sleep(500);
  await ev(() => document.querySelector('button[title="Draw a note on this picture / frame"]').click());
  await p.waitForSelector(".draw");
  await sleep(300);
  out.replyPencil = [await val(`${R}.replyTo === ${JSON.stringify(nid)}`), await val(`!${R}.newOpen && !${R}.drafts["+new"]`)];
  await ev(() => [...document.querySelectorAll(".draw .btn")].find((x) => x.textContent === "Cancel").click());
  await sleep(200);
  await ev(() => document.querySelector('.note button[title="Note actions"]').click()); await sleep(250);
  await ev(() => [...document.querySelectorAll(".sheet .menu button")].find((b) => b.textContent.startsWith("Delete note")).click()); await sleep(250);
  await ev(() => document.querySelector(".sheet .btn.primary").click()); await sleep(400);
  out.replyGone = [await val(`${R}.replyTo`), await ev(() => document.querySelector(".review").classList.contains("compose"))];
  // A swipe down on the player: the list of reviews.
  await drag([cx, cy - 60], [cx, cy + 100], 8, 16);
  await sleep(500);
  out.home = await ev(() => document.getElementById("app").classList.contains("home"));
  // Right after that swipe back, the first tap on a review's picture opens it (that tap also
  // takes the page full screen); a tap on the card itself only picks it.
  await p.waitForSelector(".list .row .th");
  const th0 = await p.locator(".list .row > .item .th").first().boundingBox();
  await tapN([[th0.x + 30, th0.y + 30]]);
  out.reopen = [await p.waitForSelector(".review .stage", { timeout: 4000 }).then(() => true, () => false)];
  await sleep(600);
  await drag([cx, cy - 60], [cx, cy + 100], 8, 16);
  await sleep(500);
  out.reopen.push(await ev(() => document.getElementById("app").classList.contains("home")));
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
  // Groups: two more reviews; hold one, drag it onto the middle of another, let go: a group of the
  // two ("shot", their names' common start) in its place, open; a tap on its header closes it; a
  // member's menu takes it out, and the group of one left dissolves.
  await ev(async () => {
    const D = window.__sightReview.DB, t = Date.now();
    for (const [k, n, i] of [["grp-a", "shot_v001.png", 0], ["grp-b", "shot_v002.png", 1], ["grp-c", "other.png", 2]])
      await D.saveReview({ key: k, asset: { name: n, kind: "image", size: 1000, width: 10, height: 10 }, counts: { notes: 0 }, updated: t, opened: t - i }, []);
  });
  await p.reload();
  await p.waitForFunction(() => document.querySelectorAll(".list .row").length >= 2);
  const rowBox = (k) => p.locator(`.list .row[data-key="${k}"] > .item`).boundingBox();
  const ra = await rowBox("grp-a"), rbx = await rowBox("grp-b");
  const from = [ra.x + 120, ra.y + ra.height / 2], to = [rbx.x + 120, rbx.y + rbx.height / 2];
  await touch("touchStart", [from]); await sleep(600);
  for (let i = 1; i <= 12; i++){ await touch("touchMove", [[from[0], from[1] + (to[1] - from[1]) * i / 12]]); await sleep(20); }
  await sleep(150);
  out.dropLit = await ev(() => !!document.querySelector(".list .row.drop"));
  await touch("touchEnd", []);
  await sleep(500);
  const grp = () => ev(() => { const g = document.querySelector(".list .row.group");
    return g ? [g.querySelector(".tx b").textContent, [...g.querySelectorAll(".gm > .row")].map((r) => r.dataset.key).sort().join(","), g.classList.contains("shut")] : null; });
  out.group = [await grp()];
  // In the target's place: the group, then the review that was after it.
  out.groupPlace = await ev(() => [...document.querySelectorAll(".list > .row")].map((r) => r.dataset.key.startsWith("g:") ? "g" : r.dataset.key));
  await ev(() => document.querySelector(".list .row.group > .item").click()); await sleep(200);
  out.group.push(await grp());
  await ev(() => document.querySelector(".list .row.group > .item").click()); await sleep(200);
  // A hold let go on a member: its menu; "Take out of the group".
  const mb = await rowBox("grp-a");
  await touch("touchStart", [[mb.x + 120, mb.y + mb.height / 2]]); await sleep(600); await touch("touchEnd", []);
  await sleep(500);
  await ev(() => [...document.querySelectorAll(".sheet .menu button")].find((b) => b.textContent.startsWith("Take out")).click());
  await sleep(500);
  out.group.push(await grp(), await ev(() => JSON.parse(localStorage.getItem("sight-review:groups")).length));
  // Settings → Full screen: Off leaves it, and stays off (a tap does not go back in).
  // After the reload: the drops and holds above were no taps; a tap on the bar's title is.
  out.fullscreen.push(await ev(() => !!document.fullscreenElement));
  await tapN([[200, 30]]);
  await p.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 2000 }).catch(() => {});
  out.fullscreen.push(await ev(() => !!document.fullscreenElement));
  await ev(() => document.querySelector('.bar button[title="Settings"]').click());
  await p.waitForSelector(".sheet .seg.fs");
  await ev(() => [...document.querySelectorAll(".sheet .seg.fs button")].find((b) => b.textContent === "Off").click()); await sleep(300);
  await ev(() => [...document.querySelectorAll(".sheet .btn")].find((b) => b.textContent === "Done").click()); await sleep(300);
  await tapN([[200, 30]]); await sleep(300);
  out.fullscreen.push(await ev(() => [!!document.fullscreenElement, localStorage.getItem("sight-review:fs")]));
  // Between groups: two groups (a+b, c+d); a held and dropped on the second group's header moves
  // there (the first, left with one, dissolves). Taps pick b and c (no review opens); Move to… →
  // a new group of the two. The group's row sums every state; its picture can be a colour.
  await ev(async () => {
    const D = window.__sightReview.DB, t = Date.now();
    await D.saveReview({ key: "grp-d", asset: { name: "dd.png", kind: "image", size: 1000, width: 10, height: 10 }, counts: { notes: 3, open: 1, progress: 1, done: 1 }, updated: t, opened: t - 3 }, []);
    const c = await D.get("reviews", "grp-c"); c.counts = { notes: 2, open: 0, progress: 1, done: 1 }; await D.put("reviews", c);
    localStorage.setItem("sight-review:groups", JSON.stringify([{ id: "g1", name: "One", keys: ["grp-a", "grp-b"], open: true }, { id: "g2", name: "Two", keys: ["grp-c", "grp-d"], open: true }]));
    localStorage.setItem("sight-review:order", JSON.stringify(["g:g1", "g:g2"]));
  });
  await p.reload();
  await p.waitForSelector('.list .row[data-key="g:g2"]');
  const ga = await rowBox("grp-a"), g2 = await p.locator('.list .row[data-key="g:g2"] > .item').boundingBox();
  const fa = [ga.x + 150, ga.y + ga.height / 2], tg = [g2.x + 150, g2.y + g2.height / 2];
  await touch("touchStart", [fa]); await sleep(600);
  for (let i = 1; i <= 14; i++){ await touch("touchMove", [[fa[0], fa[1] + (tg[1] - fa[1]) * i / 14]]); await sleep(20); }
  await sleep(150);
  out.between = [await ev(() => { const d = document.querySelector(".list .row.drop"); return d ? d.dataset.key : null; })];
  await touch("touchEnd", []); await sleep(500);
  const groups = () => ev(() => JSON.parse(localStorage.getItem("sight-review:groups")).map((g) => g.name + ":" + g.keys.join(",")));
  out.between.push(await groups());
  out.groupSum = await ev(() => [...document.querySelectorAll('.list .row[data-key="g:g2"] > .item .dot')].map((d) => d.className.replace("dot ", "") + d.textContent));
  for (const k of ["grp-b", "grp-c"]){ const bx = await rowBox(k); await tapN([[bx.x + bx.width - 40, bx.y + bx.height / 2]]); await sleep(150); }
  out.pick = [await ev(() => [...document.querySelectorAll(".list .row.sel")].map((r) => r.dataset.key).sort().join(",")), await ev(() => document.getElementById("app").classList.contains("home")),
    await ev(() => { const b = document.querySelector(".selbar span"); return b ? b.textContent : null; })];
  await ev(() => [...document.querySelectorAll(".selbar .btn")].find((b) => b.textContent === "Move to…").click()); await sleep(250);
  await ev(() => [...document.querySelectorAll(".sheet .menu button")].find((b) => b.textContent.startsWith("Into a new group")).click()); await sleep(400);
  out.pick.push(await groups(), await ev(() => !!document.querySelector(".selbar")));
  // The new group's picture: a colour.
  const ng = await ev(() => JSON.parse(localStorage.getItem("sight-review:groups")).find((g) => g.keys.includes("grp-b")).id);
  const nb = await p.locator(`.list .row[data-key="g:${ng}"] > .item`).boundingBox();
  await touch("touchStart", [[nb.x + 150, nb.y + nb.height / 2]]); await sleep(600); await touch("touchEnd", []); await sleep(500);
  await ev(() => [...document.querySelectorAll(".sheet .menu button")].find((b) => b.textContent.startsWith("Picture")).click()); await sleep(300);
  await ev(() => document.querySelector('.sheet .gcol[data-c="#34c759"]').click()); await sleep(400);
  out.groupPic = await p.evaluate((id) => { const t = document.querySelector(`.list .row[data-key="g:${id}"] > .item .th`); return [t.classList.contains("tint"), getComputedStyle(t).backgroundColor]; }, ng);
  // Picked reviews slide together: two picked, one swiped right — both uncover the eye; the eye
  // hides both.
  for (const k of ["grp-d", "grp-b"]){ const bx = await rowBox(k); await tapN([[bx.x + bx.width - 40, bx.y + bx.height / 2]]); await sleep(150); }
  const bd = await rowBox("grp-d");
  await drag([bd.x + 90, bd.y + bd.height / 2], [bd.x + 250, bd.y + bd.height / 2]); await sleep(300);
  out.swipeAll = [await ev(() => ["grp-d", "grp-b"].map((k) => document.querySelector(`.list .row[data-key="${k}"]`).classList.contains("l")))];
  const eye2 = await p.locator('.list .row[data-key="grp-d"] .sw.hide').boundingBox();
  await tapN([[eye2.x + 20, eye2.y + eye2.height / 2]]); await sleep(400);
  out.swipeAll.push(await ev(() => (JSON.parse(sessionStorage.getItem("sight-review:hidden")) || []).filter((k) => k.startsWith("grp-")).sort()));
  out.log = log;
  console.log(JSON.stringify(out));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
