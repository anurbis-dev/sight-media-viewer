// Lightbox guides (tests/test_guides.py). Grid: the snap field sits right of the Grid item; both rulers lie just
// outside the picture's edges; a guide dragged past the picture stretches its ruler to it; zoomed in, the rulers
// stay inside the window; Ctrl+click deletes a guide; Shift+H and the eye hide / show the guides (no drawings
// needed); on a touch screen a guide is made by dragging off the ruler and a long press deletes it.
"use strict";
const L = require("./r0_lib.cjs");

const box = (p, sel) => p.evaluate((s) => {
  const e = document.querySelector(s);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}, sel);
const stored = (p, id) => p.evaluate((aid) => {
  try { return (JSON.parse(localStorage.getItem("sight.guides") || "{}"))[aid] || null; } catch { return null; }
}, id);
const guideX = (p, i) => p.evaluate((n) => {
  const e = document.querySelector(`.gd-hit[data-k="v"][data-i="${n}"]`);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { x: (r.left + r.right) / 2, top: r.top, bottom: r.bottom };
}, i);

async function pickMode(p, mode, { touch = false } = {}){
  if (touch) await p.tap("#guidesBtn"); else await p.click("#guidesBtn");
  await p.waitForSelector("#guidesPop:not([hidden])");
  const sel = `#guidesPop [data-mode="${mode}"]`;
  if (touch) await p.tap(sel); else await p.click(sel);
  if (touch) await p.tap("#guidesBtn"); else await p.click("#guidesBtn");   // close the menu
}

L.run(async (cfg, t) => {
  const id = cfg.ids;
  const small = id["a_small.png"], big = id["b_big.png"];
  const p = await L.newPage(t, cfg);

  // ---- the menu: Snap right of Grid -------------------------------------------------------------------
  await L.openLight(p, small);
  await L.waitMedia(p, "image");
  await p.keyboard.press("Digit1");   // 100 %: the picture has room all round
  await p.waitForTimeout(200);
  await p.click("#guidesBtn");
  await p.waitForSelector("#guidesPop:not([hidden])");
  const gb = await box(p, '#guidesPop [data-mode="grid"]'), sb = await box(p, "#guidesPop [data-snap]");
  t.ok("menu: the snap field is on the Grid item's row", gb && sb && sb.top >= gb.top - 2 && sb.bottom <= gb.bottom + 2, { gb, sb });
  t.ok("menu: …to its right", gb && sb && sb.left >= gb.right - 1, { gb, sb });
  await p.click('#guidesPop [data-mode="grid"]');
  await p.click("#guidesBtn");
  await p.waitForSelector(".gd-hit[data-k=top]");

  // ---- rulers outside the picture -------------------------------------------------------------------
  let m = await L.mediaBox(p);
  let top = await box(p, ".gd-hit[data-k=top]"), left = await box(p, ".gd-hit[data-k=left]");
  t.near("top ruler: its lower edge is the picture's top edge", top.bottom, m.top, 1.5);
  t.ok("top ruler: above the picture (does not cover it)", top.top < m.top - 10, { top, m });
  t.near("top ruler: spans the picture's width", top.width, m.width, 2);
  t.near("left ruler: its right edge is the picture's left edge", left.right, m.left, 1.5);
  t.ok("left ruler: left of the picture", left.left < m.left - 10, { left, m });
  t.near("left ruler: spans the picture's height", left.height, m.height, 2);

  // ---- a guide from the top ruler, then dragged past the picture ------------------------------------
  const s = m.s;
  await p.mouse.move(m.left + 100 * s, top.top + top.height / 2);
  await p.mouse.down();
  await p.mouse.move(m.left + 100 * s, m.top + 150, { steps: 6 });
  await p.mouse.up();
  let rec = await stored(p, small);
  t.eq("drag from the top ruler: one vertical guide at 100 px", rec && rec.v, [100]);
  let gx = await guideX(p, 0);
  await p.mouse.move(gx.x, m.top + 150);
  await p.mouse.down();
  await p.mouse.move(m.left + m.width + 80, m.top + 150, { steps: 8 });
  await p.mouse.up();
  rec = await stored(p, small);
  const far = rec && rec.v[0];
  t.ok("guide dragged past the right edge: stored beyond the width", far > 600 + 40, rec);
  top = await box(p, ".gd-hit[data-k=top]");
  gx = await guideX(p, 0);
  t.near("top ruler stretches to the far guide", top.right, gx.x, 2);
  t.near("…and still starts at the picture's left edge", top.left, m.left, 2);
  await L.shot(cfg, p, "guides-grid-outside.png");

  // ---- a second guide, Ctrl+click deletes it --------------------------------------------------------
  await p.mouse.move(m.left + 300 * s, top.top + top.height / 2);
  await p.mouse.down();
  await p.mouse.move(m.left + 300 * s, m.top + 120, { steps: 6 });
  await p.mouse.up();
  rec = await stored(p, small);
  t.eq("a second guide at 300 px", rec && rec.v.length, 2);
  gx = await guideX(p, 1);
  await p.keyboard.down("Control");
  await p.mouse.click(gx.x, m.top + 200);
  await p.keyboard.up("Control");
  rec = await stored(p, small);
  t.eq("Ctrl+click deletes that guide only", rec && rec.v, [far]);
  t.ok("…and no position field is left open", await p.$eval(".gd-edit", (e) => e.hidden), null);

  // ---- the left ruler stretches too; drag-back and a fast flick past the old ruler end delete --------
  left = await box(p, ".gd-hit[data-k=left]");
  await p.mouse.move(left.left + left.width / 2, m.top + 100 * s);
  await p.mouse.down();
  await p.mouse.move(m.left + 200, m.top + m.height + 60, { steps: 8 });
  await p.mouse.up();
  rec = await stored(p, small);
  t.ok("a horizontal guide dragged below the picture", rec && rec.h.length === 1 && rec.h[0] > 400 + 30, rec);
  left = await box(p, ".gd-hit[data-k=left]");
  t.ok("left ruler stretches down to it", left.bottom >= m.top + rec.h[0] * s - 2, { left, h: rec.h });
  // drag that horizontal guide back onto the left ruler: deleted
  const hy = m.top + rec.h[0] * s;
  await p.mouse.move(m.left + 200, hy);
  await p.mouse.down();
  await p.mouse.move(left.left + left.width / 2, hy, { steps: 8 });
  await p.mouse.up();
  rec = await stored(p, small);
  t.eq("drag back onto its ruler deletes the guide", rec && rec.h, []);
  // a new vertical guide at 300, flicked in one move onto the top ruler past where the ruler ended
  top = await box(p, ".gd-hit[data-k=top]");
  await p.mouse.move(m.left + 300 * s, top.top + top.height / 2);
  await p.mouse.down();
  await p.mouse.move(m.left + 300 * s, m.top + 120, { steps: 4 });
  await p.mouse.up();
  rec = await stored(p, small);
  t.eq("another guide at 300 px", rec && rec.v.length, 2);
  gx = await guideX(p, 1);
  await p.mouse.move(gx.x, m.top + 120);
  await p.mouse.down();
  await p.mouse.move(top.right + 60, top.top + top.height / 2, { steps: 1 });
  await p.mouse.up();
  rec = await stored(p, small);
  t.eq("a flick onto the ruler past its old end deletes the guide", rec && rec.v, [far]);

  // ---- zoomed in: the rulers stay in the window -----------------------------------------------------
  await p.keyboard.press("Digit4");
  await p.waitForTimeout(250);
  const view = await box(p, ".light .view");
  m = await L.mediaBox(p);
  top = await box(p, ".gd-hit[data-k=top]"); left = await box(p, ".gd-hit[data-k=left]");
  t.ok("zoomed: the picture's top edge is off the window", m.top < view.top - 30, { m, view });
  t.ok("zoomed: the top ruler sticks to the window's top", top && top.top >= view.top - 1 && top.top <= view.top + 2, { top, view });
  t.ok("zoomed: the left ruler sticks to the window's left", left && left.left >= view.left - 1 && left.left <= view.left + 2, { left, view });
  await L.shot(cfg, p, "guides-grid-zoomed.png");
  t.ok("zoomed: the rulers do not run far past the window", top.right <= view.right + 40 && left.bottom <= view.bottom + 40, { top, left, view });
  await p.keyboard.press("Digit1");
  await p.waitForTimeout(250);

  // ---- turned 90°: the rulers still sit outside the picture ----------------------------------------
  await p.keyboard.press("Shift+KeyR");
  await p.waitForTimeout(250);
  const tb = await box(p, ".light .view-media");   // the turned picture's box on the page
  const tops = await p.$$eval(".gd-hit[data-k=top], .gd-hit[data-k=left]", (es) => es.map((e) => {
    const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }));
  const outside = (r) => r.right <= tb.left + 1.5 || r.left >= tb.right - 1.5 || r.bottom <= tb.top + 1.5 || r.top >= tb.bottom - 1.5;
  t.ok("turned 90°: both rulers lie outside the picture", tops.length === 2 && tops.every(outside), { tops, tb });
  await p.keyboard.press("Shift+KeyR"); await p.keyboard.press("Shift+KeyR"); await p.keyboard.press("Shift+KeyR");
  await p.waitForTimeout(250);

  // ---- Shift+H and the eye -------------------------------------------------------------------------
  const eyeShown = () => p.$eval("#drawEyeBtn", (e) => !e.hidden);
  t.ok("eye button shows with guides on and no drawings", await eyeShown(), null);
  await p.mouse.move(5, 5);
  await p.keyboard.press("Shift+KeyH");
  await p.waitForTimeout(150);
  t.eq("Shift+H hides the guides", await p.$$eval(".gd-root", (r) => r.length), 0);
  await p.keyboard.press("KeyH");
  await p.waitForTimeout(100);
  t.eq("plain H does not bring them back", await p.$$eval(".gd-root", (r) => r.length), 0);
  await p.keyboard.press("Shift+KeyH");
  await p.waitForTimeout(150);
  t.eq("Shift+H again shows them", await p.$$eval(".gd-hit[data-k=top]", (r) => r.length), 1);
  await p.click("#drawEyeBtn");
  await p.waitForTimeout(150);
  t.eq("the eye button hides them too", await p.$$eval(".gd-root", (r) => r.length), 0);
  await p.click("#drawEyeBtn");
  await p.waitForTimeout(150);
  t.eq("…and shows them", await p.$$eval(".gd-hit[data-k=top]", (r) => r.length), 1);
  // hidden, then a guide mode is picked: the guides show again
  await p.keyboard.press("Shift+KeyH");
  await p.waitForTimeout(100);
  await pickMode(p, "grid");   // grid off
  await pickMode(p, "grid");   // grid on while hidden
  t.eq("picking a mode while hidden shows the guides", await p.$$eval(".gd-hit[data-k=top]", (r) => r.length), 1);
  await pickMode(p, "");
  t.ok("guides off, no drawings: the eye goes", !(await eyeShown()), null);
  await p.keyboard.press("Escape"); await L.lightGone(p);

  // ---- touch: drag a guide off the ruler, long-press deletes it ------------------------------------
  const q = await L.newPage(t, cfg, { touch: true, mobile: false, label: "touch" });
  await L.openLight(q, big, { touch: true });
  await L.waitMedia(q, "image");
  await pickMode(q, "grid", { touch: true });
  await q.waitForSelector(".gd-hit[data-k=top]");
  const tm = await L.mediaBox(q);
  const tt = await box(q, ".gd-hit[data-k=top]");
  t.ok("touch: the top ruler is on screen", tt && tt.height > 10 && tt.top >= 0, tt);
  const x0 = tm.left + tm.width * 0.4, y0 = tt.top + tt.height / 2;
  await L.touchDrag(q, x0, y0, x0, tm.top + tm.height * 0.5, 10);
  await q.waitForTimeout(150);
  let tr = await stored(q, big);
  t.eq("touch: a drag off the top ruler makes a guide", tr && tr.v.length, 1);
  const tg = await guideX(q, 0);
  const cdp = await q.context().newCDPSession(q);
  const ty = tm.top + tm.height * 0.6;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: tg.x, y: ty, id: 1 }] });
  await q.waitForTimeout(800);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
  await q.waitForTimeout(150);
  tr = await stored(q, big);
  t.eq("touch: a long press deletes the guide", tr && tr.v, []);
  t.ok("touch: no position field is left open", await q.$eval(".gd-edit", (e) => e.hidden).catch(() => true), null);
  // a short tap still opens the position field (not a delete)
  await L.touchDrag(q, x0, y0, x0, tm.top + tm.height * 0.5, 10);
  await q.waitForTimeout(150);
  const tg2 = await guideX(q, 0);
  await q.touchscreen.tap(tg2.x, ty);
  await q.waitForTimeout(300);
  tr = await stored(q, big);
  t.eq("touch: a tap keeps the guide", tr && tr.v.length, 1);
  t.ok("touch: …and opens its position field", await q.$eval(".gd-edit", (e) => !e.hidden), null);
});
