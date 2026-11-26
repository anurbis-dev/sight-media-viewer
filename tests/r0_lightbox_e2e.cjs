// R0-0 block 1: the 2D lightbox and the video transport, as they behave before R0 (tests/test_r0_lightbox.py).
// Opening / stepping / closing; fit, zoom (digits, double-click, wheel about the cursor, right-drag), pan, turn and
// mirror (kept per file); a PSD's layers; a video's play / pause, frame steps, edge jumps, the position field and
// its display menu, fps, the bar's scrub, the stage scrub (and Shift-fine), loop, sound, scrub sound, the
// timeline marks, the RAM bar, the scrub copy, playback conversion; then the same on a touch screen.
"use strict";
const L = require("./r0_lib.cjs");

L.run(async (cfg, t) => {
  const id = cfg.ids, p = await L.newPage(t, cfg);
  const order = await p.$$eval(".card[data-id]", (cs) => cs.map((c) => c.dataset.id));
  const nameOf = Object.fromEntries(Object.entries(id).map(([k, v]) => [v, k]));
  t.eq("grid lists every file", order.length, Object.keys(id).length);

  // ---- playback conversion: an MPEG-1 the browser cannot decode (first: stepping through it later converts it) ----
  const old = id["f_old.mpg"];
  // every text the HUD shows, with its loading mark (the conversion of a short clip may be quick)
  await p.evaluate(() => {
    window.__hud = [];
    new MutationObserver(() => {
      const h = document.querySelector(".light .view-hud");
      const s = h ? `${h.textContent}${h.classList.contains("ld") ? " [ld]" : ""}` : null;
      if (s != null && window.__hud[window.__hud.length - 1] !== s) window.__hud.push(s);
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class"] });
  });
  await L.openLight(p, old);
  await L.waitMedia(p, "video");
  const huds = await p.evaluate(() => window.__hud);
  t.ok("undecodable video: 'Converting for playback…' with the loading mark", huds.some((h) => /^Converting for playback…( \d+%)? \[ld\]$/.test(h)), huds);
  await L.vplaying(p);
  let v = await L.vstate(p);
  t.ok("…then plays the H.264 copy", /\/api\/file\/[0-9a-f]+\?copy=\d+/.test(v.src) && v.w === 320 && !v.paused, v);
  t.eq("…and the HUD is the zoom read-out again (no loading mark)", [await L.hud(p), await p.$eval(".light .view-hud", (h) => h.classList.contains("ld"))], ["100%", false]);
  await p.keyboard.press("Escape"); await L.lightGone(p);

  // ---- a picture: opening, fit ------------------------------------------------------------------------
  const quad = id["a_quad.png"];
  await L.openLight(p, quad);
  await L.waitMedia(p, "image");
  t.eq("image: title is the file name", await L.lightTitle(p), "a_quad.png");
  t.eq("image: media src is the original", await p.$eval(".light img.view-media", (m) => new URL(m.src).pathname), `/api/file/${quad}`);
  t.eq("image: opens fitted (HUD)", await L.hud(p), "Frame");
  const ui = await p.evaluate(() => ({
    vbar: document.querySelector(".light .vbar").hidden, mir: document.querySelector("#mirBtn").hidden,
    mirV: document.querySelector("#mirVBtn").hidden, anno: document.querySelector("#annoBtn").hidden,
    psd: document.querySelector("#psdBtn").hidden, gear: document.querySelector("#v3dGear").hidden }));
  t.eq("image: bar buttons (vbar, mirror, flip, annotate, psd, 3D gear hidden?)", ui, { vbar: true, mir: false, mirV: false, anno: false, psd: true, gear: true });
  const fit = await p.evaluate(() => {
    const v = document.querySelector(".light .view").getBoundingClientRect(), m = document.querySelector(".light img.view-media").getBoundingClientRect();
    return { vw: v.width, vh: v.height, vcx: v.left + v.width / 2, vcy: v.top + v.height / 2, mw: m.width, mh: m.height, mcx: m.left + m.width / 2, mcy: m.top + m.height / 2 };
  });
  const fitS = Math.min(fit.vw / 2400, fit.vh / 1600);
  t.near("image: fit scale = min(view / picture)", fit.mw / 2400, fitS, 0.002);
  t.near("image: fit keeps the aspect", fit.mw / fit.mh, 1.5, 0.003);
  t.near("image: fitted picture centred (x)", fit.mcx, fit.vcx, 1);
  t.near("image: fitted picture centred (y)", fit.mcy, fit.vcy, 1);

  // ---- zoom: digits, F, double-click ------------------------------------------------------------------
  await p.keyboard.press("Digit1");
  t.eq("Digit1: HUD 100%", await L.hud(p), "100%");
  t.near("Digit1: native size", (await L.mediaBox(p)).s, 1, 0.001);
  await p.keyboard.press("Digit3");
  t.eq("Digit3: HUD 300%", await L.hud(p), "300%");
  t.near("Digit3: 3x", (await L.mediaBox(p)).s, 3, 0.001);
  await p.keyboard.press("KeyF");
  t.eq("F: back to Frame", await L.hud(p), "Frame");
  const vc = [fit.vcx, fit.vcy];
  await p.mouse.dblclick(vc[0], vc[1]);
  t.eq("double-click on a fitted picture: 100%", await L.hud(p), "100%");
  await p.mouse.dblclick(vc[0], vc[1]);
  t.eq("double-click again: Frame", await L.hud(p), "Frame");

  // ---- wheel zoom keeps the picture point under the cursor --------------------------------------------
  const wx = fit.vcx + 150, wy = fit.vcy - 90;
  let box = await L.mediaBox(p);
  const before = L.pageToDoc(box, wx, wy);
  await p.mouse.move(wx, wy);
  await p.mouse.wheel(0, -240);
  await p.waitForTimeout(150);
  box = await L.mediaBox(p);
  const after = L.pageToDoc(box, wx, wy);
  t.ok("wheel up zooms in", box.s > fitS * 1.2, box.s, `> ${fitS * 1.2}`);
  t.near("wheel zoom: same picture x under the cursor", after[0], before[0], 0.75);
  t.near("wheel zoom: same picture y under the cursor", after[1], before[1], 0.75);
  t.ok("wheel zoom: HUD shows a percentage", /^\d+%$/.test(await L.hud(p)), await L.hud(p));
  // ---- left drag pans a picture by exactly the pointer's move -----------------------------------------
  const b0 = await L.mediaBox(p);
  await p.mouse.move(wx, wy); await p.mouse.down();
  await p.mouse.move(wx + 60, wy + 30, { steps: 6 }); await p.mouse.move(wx + 120, wy + 45, { steps: 6 });
  await p.mouse.up();
  const b1 = await L.mediaBox(p);
  t.near("pan: picture moved with the pointer (x)", b1.left - b0.left, 120, 0.5);
  t.near("pan: picture moved with the pointer (y)", b1.top - b0.top, 45, 0.5);
  t.near("pan: scale unchanged", b1.s, b0.s, 1e-6);
  // ---- right drag zooms (up = in) ---------------------------------------------------------------------
  await p.mouse.move(vc[0], vc[1]); await p.mouse.down({ button: "right" });
  await p.mouse.move(vc[0], vc[1] - 80, { steps: 8 }); await p.mouse.up({ button: "right" });
  const b2 = await L.mediaBox(p);
  t.ok("right-drag up zooms in", b2.s > b1.s * 1.5, b2.s, `> ${b1.s * 1.5}`);
  await p.keyboard.press("KeyF");

  // ---- turn / mirror, kept per file -------------------------------------------------------------------
  const turnOf = () => p.evaluate((k) => { try { return (JSON.parse(localStorage.getItem("sight.viewTurn")) || {})[k] || null; } catch { return "bad"; } }, quad);
  const xform = () => p.$eval(".light img.view-media", (m) => m.style.transform);
  await p.keyboard.press("Shift+KeyR");
  t.eq("Shift+R: turn 90° stored", await turnOf(), [90, 0]);
  t.ok("Shift+R: the picture is turned", /rotate\(90deg\)/.test(await xform()), await xform());
  const tb = await p.evaluate(() => document.querySelector(".light img.view-media").getBoundingClientRect().toJSON());
  t.near("turned picture is refitted (a 90° box: height = width · 1.5)", tb.height / tb.width, 1.5, 0.01);
  await p.keyboard.press("Shift+KeyM");
  t.eq("Shift+M: mirror stored", await turnOf(), [90, 1]);
  t.ok("Shift+M: mirror button on", await p.$eval("#mirBtn", (b) => b.classList.contains("on")));
  await p.click("#mirVBtn");
  t.eq("flip button: vertical mirror stored", await turnOf(), [90, 1, 1]);
  t.ok("flip button on", await p.$eval("#mirVBtn", (b) => b.classList.contains("on")));
  // ---- next / previous / row -------------------------------------------------------------------------
  const qi = order.indexOf(quad);
  await p.keyboard.press("ArrowRight");
  await p.waitForTimeout(300);
  t.eq("ArrowRight: the next file in the grid", await L.lightTitle(p), nameOf[order[qi + 1]]);
  t.ok("the next file opens unturned and unmirrored (the turn is kept per file)", await p.evaluate(() => {
    const m = document.querySelector(".light .view-media");
    return !!m && !/rotate\(|scale\(-1/.test(m.style.transform) && !document.querySelector("#mirBtn").classList.contains("on") && !document.querySelector("#mirVBtn").classList.contains("on");
  }), await p.evaluate(() => document.querySelector(".light .view-media")?.style.transform));
  await p.keyboard.press("ArrowLeft");
  await L.waitMedia(p, "image");
  t.eq("ArrowLeft: back", await L.lightTitle(p), "a_quad.png");
  t.ok("the turn came back with the file", /rotate\(90deg\)/.test(await xform()) && /scale\(-1,\s*-1\)/.test(await xform()), await xform());
  t.ok("mirror buttons repainted for it", await p.evaluate(() => document.querySelector("#mirBtn").classList.contains("on") && document.querySelector("#mirVBtn").classList.contains("on")));
  for (let i = 0; i < 3; i++) await p.keyboard.press("Shift+KeyR");
  await p.click("#mirBtn"); await p.keyboard.press("Shift+KeyV");
  t.eq("a full turn and both mirrors off: nothing stored", await turnOf(), null);
  const cols = await p.$$eval(".card[data-id]", (cs) => { const y = cs[0].getBoundingClientRect().top; return cs.filter((c) => Math.abs(c.getBoundingClientRect().top - y) < 2).length; });
  if (qi + cols < order.length){
    await p.keyboard.press("ArrowDown");
    await p.waitForTimeout(300);
    t.eq("ArrowDown: one grid row down", await L.lightTitle(p), nameOf[order[qi + cols]]);
    await p.keyboard.press("ArrowUp");
    await p.waitForTimeout(300);
    t.eq("ArrowUp: back up", await L.lightTitle(p), "a_quad.png");
  } else t.ok("ArrowDown: grid has a second row", false, { qi, cols, n: order.length });
  // ---- closing: Esc, the ✕ button, Space on a picture -------------------------------------------------
  await p.keyboard.press("Escape");
  t.ok("Esc closes", await L.lightGone(p));
  await L.openLight(p, quad); await L.waitMedia(p, "image");
  await p.click("#lightClose");
  t.ok("✕ closes", await L.lightGone(p));
  await L.openLight(p, quad); await L.waitMedia(p, "image");
  await p.keyboard.press("Space");
  t.ok("Space closes a picture", await L.lightGone(p));

  // ---- a small picture opens at 100 %, magnified it goes pixelated -----------------------------------
  await L.openLight(p, id["b_small.png"]); await L.waitMedia(p, "image");
  t.eq("small picture: opens at 100% (never upscaled)", await L.hud(p), "100%");
  t.ok("small picture at 100%: smooth", !(await p.$eval(".light img.view-media", (m) => m.classList.contains("pixelated"))));
  await p.keyboard.press("Digit4");
  t.ok("small picture at 400%: pixelated", await p.$eval(".light img.view-media", (m) => m.classList.contains("pixelated")));
  await p.keyboard.press("Escape"); await L.lightGone(p);

  // ---- a PSD: composite preview, layers panel, a layer, back ------------------------------------------
  const psd = id["c_layers.psd"];
  await L.openLight(p, psd); await L.waitMedia(p, "image");
  t.eq("psd: preview src", await p.$eval(".light img.view-media", (m) => new URL(m.src).pathname), `/api/psd/${psd}/preview`);
  t.eq("psd: layers button shown", await p.$eval("#psdBtn", (b) => b.hidden), false);
  const px = (x, y) => p.evaluate(([x, y]) => {
    const m = document.querySelector(".light img.view-media"), c = document.createElement("canvas");
    c.width = m.naturalWidth; c.height = m.naturalHeight; const g = c.getContext("2d"); g.drawImage(m, 0, 0);
    return [...g.getImageData(x, y, 1, 1).data.slice(0, 3)].map((v) => Math.round(v / 10) * 10);
  }, [x, y]);
  t.eq("psd composite: blue layer over red", [await px(100, 100), await px(10, 10)], [[30, 30, 200], [200, 30, 30]]);
  await p.keyboard.press("KeyD");
  await p.waitForSelector("#psdPanel button.layer[data-i]:not([data-i=''])", { timeout: 15000 });
  const layers = await p.$$eval("#psdPanel .layer", (ls) => ls.map((l) => l.textContent.trim()));
  t.eq("D: layers panel lists Composite + the layers with sizes", layers, ["Composite", "Red400×300", "Blue200×150"]);
  t.eq("layers panel shown, button on", await p.evaluate(() => [document.querySelector("#psdPanel").hidden, document.querySelector("#psdBtn").classList.contains("on")]), [false, true]);
  const blue = await p.$eval("#psdPanel button.layer:last-of-type", (b) => b.dataset.i);
  await p.click("#psdPanel button.layer:last-of-type");
  await p.waitForFunction(() => { const m = document.querySelector(".light img.view-media"); return m.complete && m.naturalWidth === 200; }, null, { timeout: 15000 });
  t.eq("a layer: its own render", await p.$eval(".light img.view-media", (m) => new URL(m.src).pathname), `/api/psd/${psd}/layer/${blue}`);
  await p.waitForTimeout(150);
  t.eq("a smaller layer refits (opens at 100%)", await L.hud(p), "100%");
  t.near("a layer: drawn at its size", (await L.mediaBox(p)).width, 200, 0.5);
  await p.click("#psdPanel button.layer[data-i='']");
  await p.waitForFunction(() => { const m = document.querySelector(".light img.view-media"); return m.complete && m.naturalWidth === 400; }, null, { timeout: 15000 });
  t.ok("Composite: back to the preview", (await p.$eval(".light img.view-media", (m) => m.src)).includes(`/api/psd/${psd}/preview`));
  await p.keyboard.press("KeyD");
  t.eq("D again hides the panel", await p.$eval("#psdPanel", (e) => e.hidden), true);
  await p.keyboard.press("Escape"); await L.lightGone(p);

  // ---- a video: autoplay, bar, play / pause ----------------------------------------------------------
  const clip = id["d_clip.mp4"], FPS = 25, frame = (s) => Math.floor(s.t * FPS + 1e-6);
  await L.openLight(p, clip); await L.waitMedia(p, "video");
  await p.waitForTimeout(400);
  v = await L.vstate(p);
  t.ok("video: plays on open", !v.paused && v.t > 0.1, v);
  t.eq("video: src is the original", new URL(v.src).pathname, `/api/file/${clip}`);
  t.eq("video: decoded size", [v.w, v.h], [320, 240]);
  let bb = await L.bar(p);
  t.eq("video: bar shown, duration", [bb.hidden, bb.dur], [false, "0:04"]);
  t.eq("video: mirror / annotate buttons shown", await p.evaluate(() => [document.querySelector("#mirBtn").hidden, document.querySelector("#annoBtn").hidden]), [false, false]);
  await p.keyboard.press("Space");
  v = await L.vstate(p);
  t.ok("Space pauses a video (the lightbox stays)", v.paused && !!(await p.$(".light")), v);
  await p.keyboard.press("Space");
  t.ok("Space plays again", !(await L.vstate(p)).paused);
  const view = await p.$eval(".light .view", (e) => e.getBoundingClientRect().toJSON());
  await p.mouse.click(view.x + view.width / 2, view.y + view.height / 2);
  await p.waitForTimeout(400);
  t.ok("a click on the video pauses it (after the click hold)", (await L.vstate(p)).paused);
  await p.mouse.click(view.x + view.width / 2, view.y + view.height / 2);
  await p.waitForTimeout(80);
  t.ok("…not before the 250 ms hold", (await L.vstate(p)).paused);
  await p.waitForTimeout(350);
  t.ok("a second click plays it", !(await L.vstate(p)).paused);
  await p.keyboard.press("Space");

  // ---- frame steps, edges -----------------------------------------------------------------------------
  await p.waitForFunction(() => document.querySelector(".light .vbar [data-dur]")); // (fps from the file's info)
  await p.keyboard.press("Shift+ArrowLeft");
  v = await L.vsettled(p);
  t.eq("Shift+←: first frame", frame(v), 0);
  for (let i = 0; i < 3; i++){ await p.keyboard.press("Period"); await L.vsettled(p); }
  v = await L.vstate(p);
  t.eq(". × 3: frame 3, paused", [frame(v), v.paused], [3, true]);
  await p.keyboard.press("Comma"); v = await L.vsettled(p);
  t.eq(",: frame 2", frame(v), 2);
  await p.keyboard.press("Shift+ArrowRight"); v = await L.vsettled(p);
  t.eq("Shift+→: last frame, paused", [frame(v), v.paused], [FPS * 4 - 1, true]);
  await p.keyboard.press("Period"); v = await L.vsettled(p);
  t.near(". at the last frame: lands on the clip's end (t = duration)", v.t, 4, 0.001);
  t.near("playhead at the end", (await L.bar(p)).head, 100 * (frame(v) + 0.5) / (FPS * 4), 1.5);

  // ---- the position field: typed jump, display menu ---------------------------------------------------
  await p.click(".light .vbar [data-cur]");
  await p.waitForSelector(".light .vbar input.vtime-in", { timeout: 3000 });
  await p.fill(".light .vbar input.vtime-in", "f50");
  await p.keyboard.press("Enter");
  v = await L.vsettled(p);
  t.eq("position field: f50 jumps to frame 50", frame(v), 50);
  t.eq("position field closed after Enter", await p.$(".light .vbar input.vtime-in"), null);
  await p.click(".light .vbar [data-cur]");
  await p.fill(".light .vbar input.vtime-in", "1:00:00x");
  await p.keyboard.press("Enter");
  t.ok("position field: a bad entry keeps the field open", !!(await p.$(".light .vbar input.vtime-in")));
  await p.keyboard.press("Escape");
  t.ok("position field: Esc cancels (the lightbox stays)", !(await p.$(".light .vbar input.vtime-in")) && !!(await p.$(".light.on")));
  await p.click(".light .vbar [data-cur]", { button: "right" });
  await p.waitForSelector(".light .vctx", { timeout: 3000 });
  t.eq("position menu: display + base choices", await p.$$eval(".light .vctx button", (bs) => bs.map((b) => b.textContent + (b.disabled ? " (off)" : ""))),
    ["Frame", "Time", "Frame + time", "This clip (local)", "The whole sequence (needs a sequence of 2+ clips) (off)"]);
  await p.click('.light .vctx button[data-v="frame"]');
  bb = await L.bar(p);
  t.eq("display Frame: position and length in frames", [bb.cur, bb.dur], ["f 50", "f 100"]);
  t.eq("display stored", await p.evaluate(() => JSON.parse(localStorage.getItem("sight.vpos")).disp), "frame");
  await p.click(".light .vbar [data-cur]", { button: "right" });
  await p.click('.light .vctx button[data-v="both"]');
  t.eq("display Frame + time", (await L.bar(p)).cur, "0:02 · f 50");
  await p.click(".light .vbar [data-cur]");
  await p.fill(".light .vbar input.vtime-in", "1.5s");
  await p.keyboard.press("Enter");
  v = await L.vsettled(p);
  t.near("position field: 1.5s jumps to 1.5 s", v.t, 1.5, 0.02);
  await p.keyboard.press("Escape"); await L.lightGone(p);
  // fps from the file: a 30 fps clip is 60 frames long
  await L.openLight(p, id["g_30.mp4"]); await L.waitMedia(p, "video");
  await p.waitForFunction(() => /^0:02 · f 60$/.test(document.querySelector(".light .vbar [data-dur]").textContent), null, { timeout: 8000 }).catch(() => {});
  t.eq("30 fps clip: its length in frames (fps read from the file)", (await L.bar(p)).dur, "0:02 · f 60");
  await p.keyboard.press("Escape"); await L.lightGone(p);
  await p.evaluate(() => localStorage.removeItem("sight.vpos"));

  // ---- scrubbing: the bar, the stage, Shift-fine ------------------------------------------------------
  await L.openLight(p, clip); await L.waitMedia(p, "video");
  t.ok("video plays on open (before the scrub section)", await L.vplaying(p));
  await p.keyboard.press("Space");
  t.ok("…Space paused it", (await L.vstate(p)).paused);
  const tr = await p.$eval(".light .vbar .vtrack", (e) => e.getBoundingClientRect().toJSON());
  // (clear of the seeded marks at 25 % and 50 %: a press on a mark is the mark's, see below)
  await p.mouse.click(tr.x + tr.width * 0.4, tr.y + tr.height / 2);
  v = await L.vsettled(p);
  t.near("bar click at 40%", v.t, 1.6, 0.06);
  t.ok("bar click: the video stays paused", v.paused);
  await p.mouse.move(tr.x + tr.width * 0.3, tr.y + tr.height / 2); await p.mouse.down();
  await p.mouse.move(tr.x + tr.width * 0.6, tr.y + tr.height / 2, { steps: 6 });
  await p.mouse.move(tr.x + tr.width * 0.8, tr.y + tr.height / 2, { steps: 6 });
  await p.mouse.up();
  v = await L.vsettled(p);
  t.near("bar drag to 80%", v.t, 3.2, 0.06);
  t.near("playhead follows", (await L.bar(p)).head, 80, 1.5);
  await p.keyboard.press("Shift+ArrowLeft"); await L.vsettled(p);
  // A stage drag counts from where it became a drag (4 px from the press): 1 px steps first, so that is ≤ 5 px.
  const vw = view.width, sx = view.x + vw * 0.3, sy = view.y + view.height / 2;
  const stageDrag = async (dx) => {
    await p.mouse.move(sx, sy); await p.mouse.down();
    for (let i = 1; i <= 6; i++) await p.mouse.move(sx + i, sy);
    await p.mouse.move(sx + dx / 2, sy, { steps: 6 }); await p.mouse.move(sx + dx, sy, { steps: 6 });
    await p.mouse.up();
  };
  await stageDrag(vw * 0.25);
  v = await L.vsettled(p);
  t.near("stage drag over a quarter of the window: a quarter of the clip", v.t, 1.0 - 4 * 5 / vw, 0.03);
  t.ok("stage drag does not start playback", v.paused);
  const t0 = v.t;
  await p.keyboard.down("Shift");
  await stageDrag(vw * 0.25);
  await p.keyboard.up("Shift");
  v = await L.vsettled(p);
  t.near("Shift + stage drag: a tenth as far", v.t - t0, 0.1, 0.02);

  // ---- loop -------------------------------------------------------------------------------------------
  const loopBefore = (await L.vstate(p)).loop;
  await p.click(".light .vbar [data-loop]");
  v = await L.vstate(p);
  t.eq("loop button toggles the video's loop", v.loop, !loopBefore);
  t.eq("loop stored", await p.evaluate(() => JSON.parse(localStorage.getItem("sight.vloop")).on), !loopBefore);
  if (!v.loop){ await p.click(".light .vbar [data-loop]"); }
  await p.click(".light .vbar [data-cur]");
  await p.fill(".light .vbar input.vtime-in", "3.7s"); await p.keyboard.press("Enter"); await L.vsettled(p);
  await p.keyboard.press("Space");
  const wrapped = await p.waitForFunction(() => { const v = document.querySelector(".light video.view-media"); return !v.paused && v.currentTime < 1.0; }, null, { timeout: 8000 }).then(() => true, () => false);
  v = await L.vstate(p);
  t.ok("loop on: wraps to the start and keeps playing", wrapped && !v.paused && v.t < 1.0, v);
  await p.click(".light .vbar [data-loop]");
  t.eq("loop off", (await L.vstate(p)).loop, false);
  await p.keyboard.press("Space");
  await p.click(".light .vbar [data-cur]");
  await p.fill(".light .vbar input.vtime-in", "3.7s"); await p.keyboard.press("Enter"); await L.vsettled(p);
  await p.keyboard.press("Space");
  await p.waitForFunction(() => document.querySelector(".light video.view-media").paused, null, { timeout: 8000 }).catch(() => {});
  v = await L.vstate(p);
  t.ok("loop off: stops at the end", v.paused && v.t > 3.9, v);

  // ---- sound: mute, volume drag, scrub sound ----------------------------------------------------------
  const snd = () => p.evaluate(() => JSON.parse(localStorage.getItem("sight.vsnd") || "{}"));
  await p.click(".light .vbar [data-snd]");
  t.eq("sound button mutes", [(await L.vstate(p)).muted, (await snd()).muted], [true, true]);
  await p.click(".light .vbar [data-snd]");
  t.eq("again: unmuted", [(await L.vstate(p)).muted, (await snd()).muted], [false, false]);
  const sb = await p.$eval(".light .vbar [data-snd]", (e) => e.getBoundingClientRect().toJSON());
  await p.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2); await p.mouse.down();
  await p.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2 + 30, { steps: 5 });
  await p.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2 + 55, { steps: 5 });
  await p.mouse.up();
  v = await L.vstate(p);
  t.near("drag down on the sound button: volume 1 - 55/110", v.vol, 0.5, 0.03);
  t.ok("volume pop-up shows the value", await p.evaluate(() => { const pop = document.querySelector(".light .vbar .vpop"); return !pop.hidden && Number(pop.querySelector("b").textContent) > 40; }));
  const scrubAudio = [];
  p.on("request", (r) => { if (/\/api\/video\/scrub-audio/.test(r.url())) scrubAudio.push(r.method() + " " + new URL(r.url()).pathname); });
  await p.click(".light .vbar [data-snd]", { button: "right" });
  t.eq("right-click on the sound button: scrub sound on (stored)", (await snd()).scrub, true);
  t.ok("scrub sound marks the button", await p.$eval(".light .vbar [data-snd]", (b) => b.classList.contains("scrub")));
  for (let i = 0; i < 60 && !scrubAudio.some((s) => s.startsWith("GET /api/video/scrub-audio/")); i++) await p.waitForTimeout(200);
  t.ok("scrub sound: the clip's sound is cached and fetched", scrubAudio.some((s) => s.startsWith("GET /api/video/scrub-audio/")), scrubAudio.slice(0, 6));
  await p.waitForTimeout(500);
  t.eq("scrub sound: nothing heard before a scrub", await p.evaluate(() => window.__abStarts), 0);
  await p.mouse.move(tr.x + tr.width * 0.2, tr.y + tr.height / 2); await p.mouse.down();
  for (let i = 1; i <= 15; i++){ await p.mouse.move(tr.x + tr.width * (0.2 + i * 0.02), tr.y + tr.height / 2); await p.waitForTimeout(40); }
  await p.mouse.up();
  await p.waitForTimeout(300);
  t.ok("scrub sound: scrubbing plays the clip's sound (Web Audio)", (await p.evaluate(() => window.__abStarts)) > 0, await p.evaluate(() => window.__abStarts));
  await p.click(".light .vbar [data-snd]", { button: "right" });
  t.eq("right-click again: scrub sound off", (await snd()).scrub, false);
  const ab1 = await p.evaluate(() => window.__abStarts);
  await p.mouse.move(tr.x + tr.width * 0.6, tr.y + tr.height / 2); await p.mouse.down();
  for (let i = 1; i <= 10; i++){ await p.mouse.move(tr.x + tr.width * (0.6 + i * 0.02), tr.y + tr.height / 2); await p.waitForTimeout(40); }
  await p.mouse.up();
  await p.waitForTimeout(300);
  t.eq("scrub sound off: a scrub plays nothing", (await p.evaluate(() => window.__abStarts)) - ab1, 0);
  await p.evaluate(() => { localStorage.removeItem("sight.vsnd"); localStorage.removeItem("sight.vloop"); });

  // ---- the RAM bar and the timeline marks (seeded: a note at 1.0 s, a loose drawing at 2.0 s) -----------
  await p.waitForFunction(() => /^RAM \d+ \/ \d+ MB$/.test(document.querySelector(".light .vbar [data-mem]").textContent), null, { timeout: 10000 }).catch(() => {});
  t.ok("RAM cache read-out", /^RAM \d+ \/ \d+ MB$/.test(await p.$eval(".light .vbar [data-mem]", (e) => e.textContent)), await p.$eval(".light .vbar [data-mem]", (e) => e.textContent));
  t.ok("RAM cache bar painted", await p.$$eval(".light .vbar .vcaches i", (is) => is.length > 0));
  bb = await L.bar(p);
  t.eq("timeline marks: the note's frame and the drawing's", bb.marks.map((m) => [Math.round(m.t * 100) / 100, m.note]).sort(), [[1, true], [2, false]]);
  const markLeft = await p.$eval(".light .vbar .an-mk.note", (m) => parseFloat(m.style.left));
  t.near("note mark at 25% of the track", markLeft, 25, 0.5);
  await p.keyboard.press("Shift+ArrowLeft"); await L.vsettled(p);
  await p.keyboard.press("Shift+Period"); v = await L.vsettled(p);
  t.eq("Shift+.: the next mark (the note's frame)", frame(v), 25);
  await p.keyboard.press("Shift+Period"); v = await L.vsettled(p);
  t.eq("Shift+. again: the drawing's frame", frame(v), 50);
  await p.keyboard.press("Shift+Comma"); v = await L.vsettled(p);
  t.eq("Shift+,: back to the note", frame(v), 25);
  // a press on a mark: annotation mode on, the video paused on the mark's frame
  await p.keyboard.press("Shift+ArrowRight"); await L.vsettled(p);
  t.ok("not annotating before the mark press", await p.$eval(".an-top", (e) => e.hidden).catch(() => true));
  await p.click(".light .vbar .an-mk:not(.note)");
  v = await L.vsettled(p);
  t.eq("a press on a drawing's mark: its frame, paused", [frame(v), v.paused], [50, true]);
  t.ok("…and annotation mode on", await p.$eval(".an-top", (e) => !e.hidden));
  await p.keyboard.press("Escape");
  t.ok("Esc first leaves annotation mode (the lightbox stays)", await p.$eval(".an-top", (e) => e.hidden) && !!(await p.$(".light.on")));
  await p.keyboard.press("Escape"); await L.lightGone(p);

  // ---- a video: zoom / fit / turn as a picture; → leaves it (and stops it); a resize refits ---------------
  await L.openLight(p, clip); await L.waitMedia(p, "video");
  t.eq("video: a 320 px clip opens at 100%", await L.hud(p), "100%");
  await p.keyboard.press("Digit2");
  t.near("video: Digit2 doubles it", (await L.mediaBox(p)).s, 2, 0.001);
  await p.keyboard.press("KeyF");
  const vfit = await p.evaluate(() => { const v = document.querySelector(".light .view").getBoundingClientRect(); return Math.min(v.width / 320, v.height / 240); });
  t.near("video: F fits it to the frame", (await L.mediaBox(p)).s, vfit, 0.002);
  await p.keyboard.press("Shift+KeyR");
  t.ok("video: Shift+R turns it", /rotate\(90deg\)/.test(await p.$eval(".light video.view-media", (m) => m.style.transform)));
  await p.keyboard.press("Shift+KeyR"); await p.keyboard.press("Shift+KeyR"); await p.keyboard.press("Shift+KeyR");
  t.eq("video: a full turn stores nothing", await p.evaluate((k) => (JSON.parse(localStorage.getItem("sight.viewTurn")) || {})[k] || null, clip), null);
  await p.setViewportSize({ width: 1000, height: 700 });
  await p.waitForTimeout(300);
  const vfit2 = await p.evaluate(() => { const v = document.querySelector(".light .view").getBoundingClientRect(); return Math.min(v.width / 320, v.height / 240); });
  t.near("a window resize refits a fitted view", (await L.mediaBox(p)).s, vfit2, 0.002);
  await p.setViewportSize({ width: 1400, height: 900 });
  await p.waitForTimeout(300);
  const ci = order.indexOf(clip);
  const oldVid = await p.$(".light video.view-media");
  await p.keyboard.press(ci + 1 < order.length ? "ArrowRight" : "ArrowLeft");
  await p.waitForTimeout(400);
  t.eq("→ from a video: the neighbour file", await L.lightTitle(p), nameOf[order[ci + 1 < order.length ? ci + 1 : ci - 1]]);
  const left0 = await oldVid.evaluate((v) => ({ paused: v.paused, t: v.currentTime }));
  await p.waitForTimeout(400);
  const left1 = await oldVid.evaluate((v) => ({ paused: v.paused, t: v.currentTime }));
  t.ok("…and the video left is stopped (paused, its time not moving)", left0.paused && left1.paused && left1.t === left0.t, [left0, left1]);
  await p.keyboard.press("Escape"); await L.lightGone(p);

  // ---- the scrub copy: slow seeks on a long-GOP clip ask the server for one -----------------------------
  const scrubReq = [];
  p.on("request", (r) => { if (/\/api\/video\/scrub(\?|\/|$)/.test(r.url())) scrubReq.push(r.method() + " " + new URL(r.url()).pathname); });
  await L.openLight(p, id["e_long.mp4"]); await L.waitMedia(p, "video");
  await L.vplaying(p);
  await p.keyboard.press("Space");
  const tr2 = await p.$eval(".light .vbar .vtrack", (e) => e.getBoundingClientRect().toJSON());
  await p.mouse.move(tr2.x + tr2.width * 0.1, tr2.y + tr2.height / 2); await p.mouse.down();
  for (let i = 1; i <= 40; i++){ await p.mouse.move(tr2.x + tr2.width * (0.1 + i * 0.02), tr2.y + tr2.height / 2); await p.waitForTimeout(40); }
  await p.mouse.up();
  for (let i = 0; i < 300 && !(await p.$(".light video.view-scrub")); i++) await p.waitForTimeout(200);   // (the server encodes it: up to a minute here)
  t.ok("slow scrub seeks: a scrub copy is asked for", scrubReq.includes("POST /api/video/scrub"), scrubReq.slice(0, 5));
  t.ok("…and loaded over the player", await p.$eval(".light video.view-scrub", (s) => new URL(s.src).pathname.startsWith("/api/video/scrub/") && s.previousElementSibling?.classList.contains("view-media")).catch(() => false));
  const hiddenCopy = () => p.waitForFunction(() => document.querySelector(".light video.view-scrub")?.hidden === true, null, { timeout: 10000 }).then(() => true, () => false);
  t.ok("…hidden while not scrubbing", await hiddenCopy());
  await p.mouse.move(tr2.x + tr2.width * 0.2, tr2.y + tr2.height / 2); await p.mouse.down();
  let shownCopy = false;
  for (let i = 1; i <= 20; i++){ await p.mouse.move(tr2.x + tr2.width * (0.2 + i * 0.03), tr2.y + tr2.height / 2); await p.waitForTimeout(50); shownCopy = shownCopy || await p.$eval(".light video.view-scrub", (s) => !s.hidden).catch(() => false); }
  await p.mouse.up();
  t.ok("the scrub copy shows while scrubbing", shownCopy);
  t.ok("…and hides once the player has landed", await hiddenCopy());
  await p.keyboard.press("Escape"); await L.lightGone(p);

  await p.close();

  // ---- a touch screen: open by two taps, pinch, drag, tap the video, the bar, close ---------------------
  // (a touch laptop / tablet: hasTouch without phone emulation — in phone emulation two taps zoom the page and
  //  never make the dblclick that opens a tile; see docs/PLAN.md)
  const m = await L.newPage(t, cfg, { touch: true, mobile: false });
  await L.openLight(m, quad, { touch: true }); await L.waitMedia(m, "image");
  t.eq("touch: opens fitted", await L.hud(m), "Frame");
  const mv = await m.$eval(".light .view", (e) => e.getBoundingClientRect().toJSON());
  const mcx = mv.x + mv.width / 2, mcy = mv.y + mv.height / 2;
  const s0 = (await L.mediaBox(m)).s;
  const pd0 = L.pageToDoc(await L.mediaBox(m), mcx, mcy);
  await L.pinch(m, mcx, mcy, 60, 180);
  await m.waitForTimeout(150);
  const mb = await L.mediaBox(m);
  t.near("touch: pinch apart zooms by the finger gap ratio", mb.s / s0, 3, 0.15);
  const pd1 = L.pageToDoc(mb, mcx, mcy);
  t.near("touch: pinch zooms about the fingers' middle", Math.hypot(pd1[0] - pd0[0], pd1[1] - pd0[1]), 0, 2);
  await L.touchDrag(m, mcx, mcy, mcx - 50, mcy + 40);
  await m.waitForTimeout(100);
  const mb2 = await L.mediaBox(m);
  t.near("touch: one finger pans (x)", mb2.left - mb.left, -50, 1);
  t.near("touch: one finger pans (y)", mb2.top - mb.top, 40, 1);
  await m.tap("#mirBtn");
  t.eq("touch: mirror button", await m.evaluate((k) => (JSON.parse(localStorage.getItem("sight.viewTurn")) || {})[k], quad), [0, 1]);
  await m.tap("#mirBtn");
  // a double tap on the picture: a zoomed one back to Frame, a fitted one to 100 %, again Frame (no keyboard)
  await m.tap(".light .view"); await m.waitForTimeout(60); await m.tap(".light .view");
  await m.waitForTimeout(150);
  t.eq("touch: a double tap on a zoomed picture: Frame", await L.hud(m), "Frame");
  await m.waitForTimeout(700);
  await m.tap(".light .view"); await m.waitForTimeout(60); await m.tap(".light .view");
  await m.waitForTimeout(150);
  t.eq("touch: a double tap on a fitted picture: 100%", await L.hud(m), "100%");
  await m.waitForTimeout(700);   // (a third tap right after would count as a triple)
  await m.tap(".light .view"); await m.waitForTimeout(60); await m.tap(".light .view");
  await m.waitForTimeout(150);
  t.eq("touch: a double tap again: Frame", await L.hud(m), "Frame");
  await m.tap("#lightClose");
  t.ok("touch: ✕ closes", await L.lightGone(m));
  // a PSD's layers by the button (no D key on a touch screen)
  await L.openLight(m, id["c_layers.psd"], { touch: true }); await L.waitMedia(m, "image");
  await m.tap("#psdBtn");
  await m.waitForSelector("#psdPanel button.layer[data-i]:not([data-i=''])", { timeout: 15000 });
  t.eq("touch: the layers button opens the panel", await m.evaluate(() => [document.querySelector("#psdPanel").hidden, document.querySelector("#psdBtn").classList.contains("on")]), [false, true]);
  await m.tap("#psdPanel button.layer:last-of-type");
  await m.waitForFunction(() => { const i = document.querySelector(".light img.view-media"); return i.complete && i.naturalWidth === 200; }, null, { timeout: 15000 }).catch(() => {});
  t.eq("touch: a tapped layer shows", await m.$eval(".light img.view-media", (i) => i.naturalWidth), 200);
  await m.tap("#psdBtn");
  t.eq("touch: the button hides the panel", await m.$eval("#psdPanel", (e) => e.hidden), true);
  await m.tap("#lightClose"); await L.lightGone(m);
  await L.openLight(m, clip, { touch: true }); await L.waitMedia(m, "video");
  t.ok("touch: the video plays on open", await L.vplaying(m));
  await m.tap(".light .view");
  await m.waitForTimeout(450);
  t.ok("touch: a tap on the video pauses it", (await L.vstate(m)).paused);
  const mt = await m.$eval(".light .vbar .vtrack", (e) => e.getBoundingClientRect().toJSON());
  await m.tap(".light .vbar .vtrack", { position: { x: mt.width * 0.75, y: mt.height / 2 } });
  v = await L.vsettled(m);
  t.near("touch: a tap on the bar seeks", v.t, 3.0, 0.08);
  const mvw = (await m.$eval(".light .view", (e) => e.getBoundingClientRect().toJSON()));
  await L.touchDrag(m, mvw.x + mvw.width * 0.6, mcy, mvw.x + mvw.width * 0.35, mcy, 64);
  v = await L.vsettled(m);
  t.near("touch: a finger drag on the video scrubs (back a quarter)", v.t, 2.0 + 4 * 5 / mvw.width, 0.04);
  const mloop = (await L.vstate(m)).loop;
  await m.tap(".light .vbar [data-loop]");
  t.eq("touch: loop button toggles", (await L.vstate(m)).loop, !mloop);
  const cb = await m.$eval(".light .vbar [data-cur]", (e) => e.getBoundingClientRect().toJSON());
  await L.touchDrag(m, cb.x + cb.width / 2, cb.y + cb.height / 2, cb.x + cb.width / 2, cb.y + cb.height / 2, 1, 650);
  t.ok("touch: a long press on the position opens its menu", !!(await m.$(".light .vctx")));
  await m.tap('.light .vctx button[data-v="frame"]');
  t.ok("touch: picked from the menu", /^≈?f \d+$/.test((await L.bar(m)).cur), (await L.bar(m)).cur);
  await m.tap(".light .vbar [data-cur]");
  t.ok("touch: a tap on the position opens the frame field", !!(await m.$(".light .vbar input.vtime-in")));
  await m.fill(".light .vbar input.vtime-in", "f10"); await m.keyboard.press("Enter");
  v = await L.vsettled(m);
  t.eq("touch: typed frame", frame(v), 10);
  await m.tap("#lightClose");
  t.ok("touch: ✕ closes the video", await L.lightGone(m));
});
