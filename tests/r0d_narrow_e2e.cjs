// R0d (docs/PLAN-coreline.md decision 6): the narrow layout — below 600 px of the HOST's width the notes panel goes
// under the player; wide stays as it was (tests/test_r0d_narrow.py).
//   - desktop (1400 x 900): the panel on the right, 320 px, full height, no .an-narrow; the stage left of it;
//   - the same window, the lightbox made 500 px wide (its container, not the window): the panel goes under the
//     player; back to full width: the right-hand panel exactly as before (same box);
//   - a phone (390 x 844, touch): the lightbox opens by taps, the notes button opens the panel under the player
//     (full width, 45 % of the height), the picture and the video bar above it, the drawing bar centred; a drawing
//     by finger and a note typed and added there land on the server; the top edge's grabber dragged by finger sets
//     the height (kept as sight.annotate.panelh), a double tap resets it; the panel off: the player takes the room;
//   - a touch laptop (1280 x 800, touch): wide;
//   - a host page that is not Sight (tests/r0a_host.html): its own frame 500 px wide in a 1200 px window is narrow;
//     host.narrowAt = 0 keeps it wide.
"use strict";
const fs = require("fs");
const path = require("path");
const L = require("./r0_lib.cjs");

const HOST_HTML = fs.readFileSync(path.join(__dirname, "r0a_host.html"), "utf8");
const NAME = "Phone Reviewer";

L.run(async (cfg, t) => {
  const id = cfg.ids, pic = id["n_pic.png"], clip = id["n_clip.mp4"];
  const notes = (r) => r.filter((x) => x.kind === "note");
  async function until(p, aid, fn, ms = 6000){
    const end = Date.now() + ms;
    let r = [];
    while (Date.now() < end){ r = await L.rows(cfg, aid); if (fn(r)) return r; await p.waitForTimeout(100); }
    return r;
  }
  const box = (p, sel) => p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }).catch(() => null);
  const narrow = (p) => p.$eval(".light", (e) => e.classList.contains("an-narrow"));
  const panelOn = (p) => p.$eval(".light .an-panel", (e) => !e.hidden).catch(() => false);
  const media = (p) => box(p, ".light .view-media");

  // ---- desktop: wide, as before ------------------------------------------------------------------------------------
  const p = await L.newPage(t, cfg, { storage: { "sight.reviewer": NAME } });
  await L.openLight(p, pic);
  await L.waitMedia(p, "image");
  if (!(await panelOn(p))) await p.click("#notesBtn");
  await p.waitForSelector(".light .an-panel:not([hidden])");
  t.ok("desktop: not narrow", !(await narrow(p)));
  const wide = await box(p, ".light .an-panel");
  t.eq("desktop: the panel on the right, 320 px, full height", wide && [wide.r, wide.w, wide.t, wide.b], [1400, 320, 0, 900]);
  const stage = await box(p, ".light .light-stage");
  t.eq("desktop: the stage left of it", stage && stage.r, 1080);
  await L.shot(cfg, p, "r0d_desktop.png");

  // the lightbox's own width (its container), not the window
  await p.evaluate(() => { document.querySelector(".light").style.left = "900px"; });
  await p.waitForFunction(() => document.querySelector(".light").classList.contains("an-narrow"), null, { timeout: 3000 }).catch(() => {});
  t.ok("a 500 px lightbox in a 1400 px window: narrow", await narrow(p));
  let pb = await box(p, ".light .an-panel");
  t.eq("…the panel under the player, across the lightbox", pb && [pb.l, pb.r, pb.b], [900, 1400, 900]);
  t.near("…45 % of the height", pb && pb.h, 405, 2);
  let sb = await box(p, ".light .light-stage");
  t.ok("…the stage above it", sb && sb.b <= pb.t + 0.5 && sb.r === 1400, [sb, pb]);
  const top = await box(p, ".light .an-top");
  await p.evaluate(() => { document.querySelector(".light").style.left = ""; });
  await p.waitForFunction(() => !document.querySelector(".light").classList.contains("an-narrow"), null, { timeout: 3000 }).catch(() => {});
  t.ok("…back to full width: wide again", !(await narrow(p)));
  t.eq("…the panel's box exactly as before", await box(p, ".light .an-panel"), wide);
  t.eq("…the stage's too", await box(p, ".light .light-stage"), stage);
  t.ok("…no --an-ph left on the lightbox", await p.$eval(".light", (e) => !e.style.getPropertyValue("--an-ph")));
  // narrow again, then many resizes: no "ResizeObserver loop" error (t.watch collects page errors)
  for (const left of ["900px", "880px", "860px", "", "900px"]){ await p.evaluate((l) => { document.querySelector(".light").style.left = l; }, left); await p.waitForTimeout(60); }
  for (const [w, h] of [[1400, 700], [1400, 600], [1300, 900]]){ await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(80); }
  t.ok("…narrow while resized", await narrow(p));
  // closing: the panel stays under the player while the lightbox fades out (no jump to the right)
  await p.keyboard.press("Escape");
  await p.waitForTimeout(40);
  t.ok("…closing a narrow lightbox keeps it narrow while it fades", await p.$eval(".light", (e) => e.classList.contains("an-narrow")).catch(() => true));
  await L.lightGone(p);
  t.ok("(the drawing bar was hidden or inside the narrow lightbox)", !top || top.w === 0 || (top.l >= 900 - 0.5 && top.r <= 1400.5), top);
  await p.context().close();

  // ---- a phone ---------------------------------------------------------------------------------------------------
  // (hasTouch without phone emulation, where two taps zoom the page and never open a tile — r0_lightbox_e2e.cjs;
  //  the library's inspector covers the grid at a phone's width, so the tile is opened wide and the window then
  //  turned into a phone's: the resize path too)
  const tp = await L.newPage(t, cfg, { touch: true, mobile: false, label: "phone", storage: { "sight.reviewer": NAME } });
  const phone = async () => { await tp.setViewportSize({ width: 390, height: 844 }); await tp.waitForTimeout(250); };
  await L.openLight(tp, pic, { touch: true });
  await L.waitMedia(tp, "image");
  await phone();
  t.ok("phone: the lightbox is narrow", await narrow(tp));
  const before = await media(tp);
  if (await panelOn(tp)) await tp.tap("#notesBtn");
  await tp.tap("#notesBtn");
  await tp.waitForSelector(".light .an-panel:not([hidden])");
  t.ok("phone: a tap on the notes button opens the panel", await panelOn(tp));
  pb = await box(tp, ".light .an-panel");
  t.eq("phone: the panel under the player, full width, at the bottom", pb && [pb.l, pb.r, pb.b], [0, 390, 844]);
  t.near("…45 % of the height", pb && pb.h, 380, 2);
  sb = await box(tp, ".light .light-stage");
  t.ok("…the stage above it", sb && sb.b <= pb.t + 0.5, [sb, pb]);
  let mb = await media(tp);
  t.ok("…the picture fits above it (smaller than without the panel)", mb && mb.b <= pb.t + 0.5 && mb.h < before.h + 0.5, [mb, before, pb]);
  t.eq("…the stage keeps the full width", sb && [sb.l, sb.r], [0, 390]);
  t.ok("…the edge is a grabber across the top", await tp.$eval(".light .an-panel .an-edge", (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width >= 389 && r.height >= 16 && s.cursor === "ns-resize"; }));
  t.ok("…and stays off the header's buttons", await tp.$eval(".light .an-panel", (pn) => { const e = pn.querySelector(".an-edge").getBoundingClientRect().bottom; return [...pn.querySelectorAll(".an-ph button")].filter((b) => b.offsetWidth).every((b) => b.getBoundingClientRect().top >= e - 0.5); }));
  await L.shot(cfg, tp, "r0d_phone_panel.png");

  // drawing by finger, then a note
  await tp.tap("#annoBtn");
  await tp.waitForSelector(".light .an-top:not([hidden])");
  const tb = await box(tp, ".light .an-top");
  t.ok("phone: the drawing bar inside the screen, centred, above the panel", tb && tb.l >= -0.5 && tb.r <= 390.5 && Math.abs((tb.l + tb.r) / 2 - 195) <= 2 && tb.b <= pb.t, tb);
  await tp.tap('.an-bar [data-tool="pencil"]');
  mb = await media(tp);
  // (below the drawing bar, which covers the picture's top on a phone)
  t.ok("…it leaves the lower half of the picture free", tb.b < mb.t + mb.h * 0.5, [tb, mb]);
  await L.touchDrag(tp, mb.l + mb.w * 0.3, mb.t + mb.h * 0.7, mb.l + mb.w * 0.7, mb.t + mb.h * 0.9, 12);
  await L.shot(cfg, tp, "r0d_phone_draw.png");
  await tp.waitForTimeout(700);   // (a tap right after a finger stroke brings no click in this emulation: r0_tools_e2e.cjs)
  await tp.tap(".an-panel .an-input");
  await tp.keyboard.type("from the phone");
  await tp.tap(".an-panel [data-act=add]");
  let r = await until(tp, pic, (r) => notes(r).some((n) => n.data.text === "from the phone") && r.some((x) => x.kind !== "note" && x.data && x.data.note));
  const n = notes(r).find((x) => x.data.text === "from the phone");
  t.ok("phone: a note typed under the player is added", !!n, notes(r).map((x) => x.data.text));
  t.ok("…with the finger drawing", !!n && r.some((x) => x.kind !== "note" && x.data && x.data.note === n.id), r.map((x) => [x.kind, x.data && x.data.note]));
  await tp.waitForSelector(".an-panel .an-note");
  t.ok("…its card shows in the panel", await tp.$eval(".an-panel .an-list", (e) => /from the phone/.test(e.textContent)));

  // the top edge: a finger drag sets the height, kept; a double tap resets
  pb = await box(tp, ".light .an-panel");
  const ey = pb.t + 1;
  await L.touchDrag(tp, 195, ey, 195, ey - 120, 10);
  await tp.waitForTimeout(100);
  let pb2 = await box(tp, ".light .an-panel");
  t.near("phone: dragging the top edge up 120 px makes the panel taller", pb2 && pb2.h, pb.h + 120, 3);
  t.near("…kept as sight.annotate.panelh (a share of the height)", Number(await tp.evaluate(() => localStorage.getItem("sight.annotate.panelh"))), (pb.h + 120) / 844, 0.005);
  sb = await box(tp, ".light .light-stage");
  t.ok("…the stage shrinks with it", sb && sb.b <= pb2.t + 0.5, [sb, pb2]);
  await L.touchDrag(tp, 195, pb2.t + 1, 195, 20, 10);
  await tp.waitForTimeout(100);
  t.near("…at most 75 % of the height", (await box(tp, ".light .an-panel")).h, 633, 2);
  await L.touchDrag(tp, 195, (await box(tp, ".light .an-panel")).t + 1, 195, 840, 10);
  await tp.waitForTimeout(100);
  t.near("…at least 20 %", (await box(tp, ".light .an-panel")).h, 169, 2);
  const et = (await box(tp, ".light .an-panel")).t;
  await tp.touchscreen.tap(195, et + 1); await tp.waitForTimeout(120); await tp.touchscreen.tap(195, et + 1);
  await tp.waitForTimeout(150);
  t.near("…a double tap on the edge resets it to 45 %", (await box(tp, ".light .an-panel")).h, 380, 2);
  t.eq("…and forgets the height", Number(await tp.evaluate(() => localStorage.getItem("sight.annotate.panelh"))), 0);
  t.eq("…the width setting untouched", await tp.evaluate(() => localStorage.getItem("sight.annotate.panelw")), null);

  // the panel off: the player takes the room back
  await tp.tap("#annoBtn");
  await tp.waitForTimeout(100);
  if (await panelOn(tp)) await tp.tap("#notesBtn");
  await tp.waitForTimeout(150);
  t.ok("phone: the panel closes", !(await panelOn(tp)));
  t.eq("…the stage reaches the bottom again", (await box(tp, ".light .light-stage")).b, 844);
  t.ok("…no padding left", await tp.$eval(".light", (e) => getComputedStyle(e).paddingBottom === "0px" && getComputedStyle(e).paddingRight === "0px"));
  await tp.tap("#lightClose").catch(() => {});
  await L.lightGone(tp);

  // a video: the transport under the picture, above the panel
  await tp.setViewportSize({ width: 1280, height: 800 });
  await L.openLight(tp, clip, { touch: true });
  await L.waitMedia(tp, "video");
  await phone();
  await tp.evaluate(() => document.querySelector(".light video.view-media").pause());
  if (!(await panelOn(tp))) await tp.tap("#notesBtn");
  await tp.waitForSelector(".light .an-panel:not([hidden])");
  pb = await box(tp, ".light .an-panel");
  const vb = await box(tp, ".light .vbar");
  t.ok("phone video: the transport bar shows, above the panel", vb && vb.h > 0 && vb.b <= pb.t + 0.5 && vb.l === 0 && vb.r === 390, [vb, pb]);
  mb = await media(tp);
  t.ok("…the video above the transport", mb && mb.b <= vb.t + 0.5, [mb, vb]);
  await L.shot(cfg, tp, "r0d_phone_video.png");
  await tp.context().close();

  // ---- a touch laptop: wide ----------------------------------------------------------------------------------------
  const lp = await L.newPage(t, cfg, { touch: true, mobile: false, label: "touch laptop" });
  await L.openLight(lp, pic, { touch: true });
  await L.waitMedia(lp, "image");
  await lp.waitForTimeout(300);   // (the lightbox's open transition: scale .985 -> 1)
  if (!(await panelOn(lp))) await lp.tap("#notesBtn");
  await lp.waitForSelector(".light .an-panel:not([hidden])");
  t.ok("touch laptop: not narrow", !(await narrow(lp)));
  pb = await box(lp, ".light .an-panel");
  t.eq("…the panel on the right", pb && [pb.r, pb.w, pb.t, pb.b], [1280, 320, 0, 800]);
  await lp.context().close();

  // ---- a host page that is not Sight: its container decides --------------------------------------------------------
  const b = await t.browser();
  async function hostPage(query){
    const ctx = await b.newContext({ viewport: { width: 1200, height: 800 } });
    await ctx.route(cfg.base + "/__r0a/host.html*", (r) => r.fulfill({ status: 200, contentType: "text/html", body: HOST_HTML }));
    const hp = await ctx.newPage();
    t.watch(hp, "host" + query);
    await hp.goto(cfg.base + "/__r0a/host.html" + query);
    await hp.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
    return hp;
  }
  let hp = await hostPage("?frame=500");
  await hp.waitForSelector("#light .an-panel:not([hidden])");
  t.ok("host page: a 500 px frame in a 1200 px window is narrow", await hp.$eval("#light", (e) => e.classList.contains("an-narrow")));
  pb = await box(hp, "#light .an-panel");
  t.eq("…the panel at the frame's bottom, across it", pb && [pb.l, pb.r, pb.b], [0, 500, 800]);
  t.near("…45 % of its height", pb && pb.h, 360, 2);
  await hp.evaluate(() => { document.getElementById("light").style.width = "900px"; });
  await hp.waitForFunction(() => !document.getElementById("light").classList.contains("an-narrow"), null, { timeout: 3000 }).catch(() => {});
  pb = await box(hp, "#light .an-panel");
  t.ok("…the frame widened to 900 px: the panel on the right again", pb && pb.r === 900 && pb.w === 320 && pb.t === 0, pb);
  await hp.context().close();
  hp = await hostPage("?frame=500&narrowAt=0");
  await hp.waitForSelector("#light .an-panel:not([hidden])");
  t.ok("host page: narrowAt = 0 keeps a 500 px frame wide", !(await hp.$eval("#light", (e) => e.classList.contains("an-narrow"))));
  await hp.context().close();
});
