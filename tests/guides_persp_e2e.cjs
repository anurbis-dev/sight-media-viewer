// Lightbox guides, perspective (tests/test_guides.py). One "Perspective" item with a 1 / 2 / 3 point count beside it;
// 2-point: both vanishing points on one horizon (dragging a point up / down or the horizon moves both); 3-point: a
// third point off the horizon; an old `sight.guides` entry (mode "2", points on different heights) still loads.
"use strict";
const L = require("./r0_lib.cjs");

const box = (p, sel) => p.evaluate((s) => {
  const e = document.querySelector(s);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 };
}, sel);
const stored = (p, id) => p.evaluate((aid) => {
  try { return (JSON.parse(localStorage.getItem("sight.guides") || "{}"))[aid] || null; } catch { return null; }
}, id);
const vps = (p) => p.$$eval('.gd-hit[data-k="vp"]', (es) => es.map((e) => {
  const r = e.getBoundingClientRect();
  return { i: Number(e.dataset.i), x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
}));
async function menu(p, touch){
  if (touch) await p.tap("#guidesBtn"); else await p.click("#guidesBtn");
  await p.waitForSelector("#guidesPop:not([hidden])");
}
async function closeMenu(p, touch){
  if (touch) await p.tap("#guidesBtn"); else await p.click("#guidesBtn");
  await p.waitForSelector("#guidesPop", { state: "hidden" });
}
async function drag(p, x0, y0, x1, y1){
  await p.mouse.move(x0, y0); await p.mouse.down();
  await p.mouse.move(x1, y1, { steps: 8 }); await p.mouse.up();
  await p.waitForTimeout(80);
}

L.run(async (cfg, t) => {
  const id = cfg.ids;
  const big = id["b_big.png"], old = id["c_old.png"];
  const p = await L.newPage(t, cfg);

  // ---- an entry written by 0.138 (mode "2", points at different heights) -----------------------------
  await L.openLight(p, old);
  await L.waitMedia(p, "image");
  await p.waitForSelector('.gd-hit[data-k="vp"]');
  let v = await vps(p);
  t.eq("old 2-point entry: two points", v.length, 2);
  t.near("old 2-point entry: the points share one horizon", v.length === 2 ? v[0].y - v[1].y : NaN, 0, 0.6);
  let m = await L.mediaBox(p);
  t.near("old 2-point entry: point 1 keeps its x", v[0] ? (v[0].x - m.left) / m.s : NaN, 200, 1);
  t.near("old 2-point entry: the horizon is the points' mean height", v[0] ? (v[0].y - m.top) / m.s : NaN, 150, 1);
  await menu(p);
  t.ok("old entry: the menu shows Perspective on", await p.$eval('#guidesPop [data-mode="persp"]', (b) => b.classList.contains("on")), null);
  t.ok("old entry: …with 2 points", await p.$eval('#guidesPop [data-np="2"]', (b) => b.classList.contains("on")), null);
  await closeMenu(p);
  await p.keyboard.press("Escape"); await L.lightGone(p);

  // ---- the menu ------------------------------------------------------------------------------------
  await L.openLight(p, big);
  await L.waitMedia(p, "image");
  await menu(p);
  t.eq("menu: no separate 1- / 2- / 3-point items", await p.$$eval('#guidesPop [data-mode="1"], #guidesPop [data-mode="2"], #guidesPop [data-mode="3"]', (e) => e.length), 0);
  const pb = await box(p, '#guidesPop [data-mode="persp"]'), nb = await box(p, '#guidesPop [data-np="3"]');
  t.ok("menu: the point count sits on the Perspective row, to its right", pb && nb && nb.left >= pb.right - 1 && nb.cy > pb.top && nb.cy < pb.bottom, { pb, nb });
  await p.click('#guidesPop [data-np="2"]');   // a count turns perspective on with that many points
  await p.waitForSelector('.gd-hit[data-k="vp"]');
  t.eq("count 2: two vanishing points", (await vps(p)).length, 2);
  t.ok("count 2: Perspective is on", await p.$eval('#guidesPop [data-mode="persp"]', (b) => b.classList.contains("on")), null);
  t.eq("count 2: one horizon handle", await p.$$eval('.gd-hit[data-k="hz"]', (e) => e.length), 1);
  const dens = await p.$$eval("#guidesPop [data-dens]", (e) => e.length);
  t.eq("count 2: a line-count slider per point", dens, 2);
  await closeMenu(p);

  // Default handles sit inside the picture. Their fans must meet there (a line of each point through the
  // other, and crossings that are not the parallel star linesFromVp used to draw).
  m = await L.mediaBox(p);
  const fans = await p.evaluate(() => {
    const svg = document.querySelector(".gd-svg");
    const ctm = svg.getScreenCTM();
    const pt = svg.createSVGPoint();
    const map = (x, y) => { pt.x = +x; pt.y = +y; const q = pt.matrixTransform(ctm); return [q.x, q.y]; };
    return [...svg.querySelectorAll("line.gd-mark")].filter((l) => !l.getAttribute("stroke-dasharray")).map((l) => ({
      stroke: l.getAttribute("stroke"),
      a: map(l.getAttribute("x1"), l.getAttribute("y1")),
      b: map(l.getAttribute("x2"), l.getAttribute("y2")),
    }));
  });
  const byStroke = new Map();
  for (const ln of fans){
    if (!byStroke.has(ln.stroke)) byStroke.set(ln.stroke, []);
    byStroke.get(ln.stroke).push(ln);
  }
  const groups = [...byStroke.values()];
  const crossAt = (A, B) => {
    const [x1, y1] = A.a, [x2, y2] = A.b, [x3, y3] = B.a, [x4, y4] = B.b;
    const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(den) < 1e-6) return null;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
    const u = ((x1 - x3) * (y1 - y2) - (y1 - y3) * (x1 - x2)) / den;
    if (t < -0.02 || t > 1.02 || u < -0.02 || u > 1.02) return null;
    return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
  };
  const inPic = (q) => q && q[0] > m.left + 4 && q[0] < m.left + m.width - 4 && q[1] > m.top + 4 && q[1] < m.top + m.height - 4;
  const handles = await vps(p);
  let joints = 0;
  if (groups.length >= 2){
    for (const A of groups[0]) for (const B of groups[1]){
      const q = crossAt(A, B);
      if (!inPic(q)) continue;
      if (handles.some((h) => Math.hypot(q[0] - h.x, q[1] - h.y) < 16)) continue;
      joints++;
    }
  }
  t.ok("2-point inside the picture: the two fans meet (not two parallel stars)", groups.length >= 2 && joints >= 4, { strokes: groups.map((g) => g.length), joints });

  // ---- 2-point: one horizon ------------------------------------------------------------------------
  m = await L.mediaBox(p);
  v = await vps(p);
  await drag(p, v[0].x, v[0].y, v[0].x + 40, v[0].y + 60);
  let r = await stored(p, big);
  const p2 = r && r.pts && r.pts["2"];
  t.ok("2-point: dragging point 1 down moves the horizon for both", p2 && Math.abs(p2[0][1] - p2[1][1]) < 0.01, r);
  t.near("2-point: …point 1 went down by the drag", p2 ? p2[0][1] - 1000 * 0.42 : NaN, 60 / m.s, 2);
  t.near("2-point: …point 2 keeps its x", p2 ? p2[1][0] : NaN, 1600 * 0.8, 0.2);
  let hz = await box(p, '.gd-hit[data-k="hz"]');
  v = await vps(p);
  t.near("2-point: the horizon handle sits on the horizon", hz.cy, v[0].y, 1);
  t.near("2-point: …halfway between the points", hz.cx, (v[0].x + v[1].x) / 2, 1);
  const free = await p.evaluate(([x, y]) => !document.elementFromPoint(x, y)?.closest?.(".gd-hit"), [m.left + m.width * 0.08, v[0].y]);
  t.ok("2-point: the horizon away from its handle does not catch presses (drawing / panning go through)", free, null);
  const hx = hz.cx;
  await drag(p, hx, hz.cy, hx, hz.cy - 90);
  r = await stored(p, big);
  const q2 = r && r.pts && r.pts["2"];
  t.ok("2-point: dragging the horizon moves both points", q2 && Math.abs(q2[0][1] - q2[1][1]) < 0.01 && Math.abs(q2[0][1] - (p2[0][1] - 90 / m.s)) < 2, { p2, q2 });
  t.ok("2-point: …and keeps their x", q2 && Math.abs(q2[0][0] - p2[0][0]) < 0.2 && Math.abs(q2[1][0] - p2[1][0]) < 0.2, { p2, q2 });
  const hzLine = await p.$$eval(".gd-svg line.gd-mark[stroke-dasharray]", (ls) => ls.map((l) => { const r = l.getBoundingClientRect(); return r.width; }));
  t.ok("2-point: the horizon line spans the window", hzLine.length === 1 && hzLine[0] > m.width * 0.9, hzLine);
  // Esc during a horizon drag puts it back
  v = await vps(p);
  hz = await box(p, '.gd-hit[data-k="hz"]');
  await p.mouse.move(hz.cx, hz.cy); await p.mouse.down(); await p.mouse.move(hz.cx, hz.cy + 50, { steps: 4 });
  const mid = await vps(p);
  t.ok("2-point: the points follow a horizon drag live", mid[0].y > v[0].y + 40, { v, mid });
  await p.keyboard.press("Escape"); await p.mouse.up();
  const esc = await vps(p);
  t.ok("2-point: Esc cancels a horizon drag (the points go back on screen)", Math.abs(esc[0].y - v[0].y) < 0.6 && Math.abs(esc[1].y - v[1].y) < 0.6, { v, esc });
  r = await stored(p, big);
  t.eq("2-point: …and nothing is saved", r && r.pts["2"], q2);

  // ---- 3-point ---------------------------------------------------------------------------------------
  await menu(p);
  await p.click('#guidesPop [data-np="3"]');
  await closeMenu(p);
  v = await vps(p);
  t.eq("3-point: three points", v.length, 3);
  t.near("3-point: points 1 and 2 on one horizon", v[0].y - v[1].y, 0, 0.6);
  t.ok("3-point: point 3 is off the horizon", Math.abs(v[2].y - v[0].y) > 20, v);
  const lines3 = await p.$$eval(".gd-svg line.gd-mark", (ls) => ls.filter((l) => l.getAttribute("stroke") === "#3ec7b5").length);
  t.ok("3-point: lines run from point 3", lines3 >= 4, lines3);
  const through = await p.evaluate(([x1, y1, x2, y2]) => {
    const svg = document.querySelector(".gd-svg");
    const ctm = svg.getScreenCTM();
    const pt = svg.createSVGPoint();
    const map = (x, y) => { pt.x = +x; pt.y = +y; const q = pt.matrixTransform(ctm); return [q.x, q.y]; };
    const dist = (px, py, a, b) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      return Math.abs((px - a[0]) * dy - (py - a[1]) * dx) / l;
    };
    const lines = [...svg.querySelectorAll("line.gd-mark")].filter((l) => l.getAttribute("stroke") === "#3ec7b5")
      .map((l) => [map(l.getAttribute("x1"), l.getAttribute("y1")), map(l.getAttribute("x2"), l.getAttribute("y2"))]);
    const near = (x, y) => lines.some(([a, b]) => dist(x, y, a, b) < 2.5);
    return [near(x1, y1), near(x2, y2)];
  }, [v[0].x, v[0].y, v[1].x, v[1].y]);
  t.ok("3-point inside: point 3's lines pass through points 1 and 2", through[0] && through[1], through);
  await L.shot(cfg, p, "guides-persp-3.png");
  // point 3 dragged onto the horizon stays off it
  await drag(p, v[2].x, v[2].y, v[2].x, v[0].y);
  r = await stored(p, big);
  const p3 = r && r.pts && r.pts["3"];
  t.ok("3-point: point 3 cannot sit on the horizon", p3 && Math.abs(p3[2][1] - p3[0][1]) >= 1000 * 0.05 - 0.5, p3);
  t.ok("3-point: points 1 and 2 still share the horizon", p3 && Math.abs(p3[0][1] - p3[1][1]) < 0.01, p3);
  // the 2-point layout is kept apart from the 3-point one
  await menu(p);
  await p.click('#guidesPop [data-np="2"]');
  await closeMenu(p);
  r = await stored(p, big);
  t.eq("back to 2 points: their own positions are kept", r && r.pts["2"], q2);
  const q2b = r && r.pts["2"];
  // 1-point: no horizon handle (its point moves the horizon)
  await menu(p);
  await p.click('#guidesPop [data-np="1"]');
  await closeMenu(p);
  t.eq("1-point: one point, no horizon handle", [(await vps(p)).length, await p.$$eval('.gd-hit[data-k="hz"]', (e) => e.length)], [1, 0]);
  // turned 90°: the horizon is upright on screen, its handle drags sideways and still moves both points
  await menu(p);
  await p.click('#guidesPop [data-np="2"]');
  await closeMenu(p);
  await p.keyboard.press("Shift+KeyR");
  await p.waitForTimeout(250);
  v = await vps(p);
  hz = await box(p, '.gd-hit[data-k="hz"]');
  t.near("turned 90°: points 1 and 2 share a screen x", v[0].x - v[1].x, 0, 0.6);
  t.ok("turned 90°: the handle's cursor is ew-resize", await p.$eval('.gd-hit[data-k="hz"]', (e) => e.style.cursor === "ew-resize"), null);
  const before90 = (await stored(p, big)).pts["2"];
  await drag(p, hz.cx, hz.cy, hz.cx - 60, hz.cy);
  const after90 = (await stored(p, big)).pts["2"];
  t.ok("turned 90°: dragging the handle sideways moves both points' height", after90 && Math.abs(after90[0][1] - after90[1][1]) < 0.01 && Math.abs(after90[0][1] - before90[0][1]) > 20 && Math.abs(after90[0][0] - before90[0][0]) < 0.2, { before90, after90 });
  for (let i = 0; i < 3; i++) await p.keyboard.press("Shift+KeyR");
  await p.waitForTimeout(250);
  await menu(p);
  await p.click('#guidesPop [data-np="2"]');
  await closeMenu(p);
  // Perspective off and on again keeps the count
  await menu(p);
  await p.click('#guidesPop [data-mode="persp"]');
  t.eq("Perspective off: no points", (await vps(p)).length, 0);
  await p.click('#guidesPop [data-mode="persp"]');
  t.eq("Perspective on again: the last count (2)", (await vps(p)).length, 2);
  await closeMenu(p);
  await p.keyboard.press("Escape"); await L.lightGone(p);

  // ---- handles outside the picture: lines join the points, not the file's corners -------------------
  await L.openLight(p, id["a_small.png"]);
  await L.waitMedia(p, "image");
  await menu(p);
  await p.click('#guidesPop [data-np="2"]');
  await closeMenu(p);
  m = await L.mediaBox(p);
  v = await vps(p);
  let h0 = v.find((q) => q.i === 0), h1 = v.find((q) => q.i === 1);
  await drag(p, h0.x, h0.y, m.left - 110, h0.y);
  v = await vps(p);
  h1 = v.find((q) => q.i === 1);
  await drag(p, h1.x, h1.y, m.left + m.width + 110, h1.y);
  v = await vps(p);
  h0 = v.find((q) => q.i === 0); h1 = v.find((q) => q.i === 1);
  t.ok("2-point outside the file: both handles sit outside the picture",
    h0 && h1 && h0.x < m.left - 30 && h1.x > m.left + m.width + 30, { h0, h1, m });
  const segDist = (px, py, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
    let u = ((px - a[0]) * dx + (py - a[1]) * dy) / l2;
    u = Math.max(0, Math.min(1, u));
    return Math.hypot(px - (a[0] + u * dx), py - (a[1] + u * dy));
  };
  const lineDist = (px, py, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return Math.abs((px - a[0]) * dy - (py - a[1]) * dx) / l;
  };
  const solid = await p.evaluate(() => {
    const svg = document.querySelector(".gd-svg");
    const ctm = svg.getScreenCTM();
    const pt = svg.createSVGPoint();
    const map = (x, y) => { pt.x = +x; pt.y = +y; const q = pt.matrixTransform(ctm); return [q.x, q.y]; };
    return [...svg.querySelectorAll("line.gd-mark")].filter((l) => !l.getAttribute("stroke-dasharray")).map((l) => ({
      stroke: l.getAttribute("stroke"),
      a: map(l.getAttribute("x1"), l.getAttribute("y1")),
      b: map(l.getAttribute("x2"), l.getAttribute("y2")),
    }));
  });
  const of = (color) => solid.filter((l) => l.stroke === color);
  const blue = of("var(--accent)"), amber = of("#e2a33a");
  t.ok("2-point outside: point 1's lines reach point 2", blue.some((l) => segDist(h1.x, h1.y, l.a, l.b) < 3), blue.length);
  t.ok("2-point outside: point 2's lines reach point 1", amber.some((l) => segDist(h0.x, h0.y, l.a, l.b) < 3), amber.length);
  const corners = [[m.left, m.top], [m.left + m.width, m.top], [m.left + m.width, m.top + m.height], [m.left, m.top + m.height]];
  const cornerHits = corners.filter((c) => solid.some((l) => lineDist(c[0], c[1], l.a, l.b) < 2.5)).length;
  t.ok("2-point outside: lines do not pass through the picture's corners", cornerHits === 0, { cornerHits, lines: solid.length });
  let outJoints = 0;
  const crossAt2 = (A, B) => {
    const [x1, y1] = A.a, [x2, y2] = A.b, [x3, y3] = B.a, [x4, y4] = B.b;
    const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(den) < 1e-6) return null;
    const tt = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
    const uu = ((x1 - x3) * (y1 - y2) - (y1 - y3) * (x1 - x2)) / den;
    if (tt < -0.02 || tt > 1.02 || uu < -0.02 || uu > 1.02) return null;
    return [x1 + tt * (x2 - x1), y1 + tt * (y2 - y1)];
  };
  for (const A of blue) for (const B of amber){
    const qj = crossAt2(A, B);
    if (!qj || qj[0] < m.left + 4 || qj[0] > m.left + m.width - 4 || qj[1] < m.top + 4 || qj[1] > m.top + m.height - 4) continue;
    outJoints++;
  }
  t.ok("2-point outside: the fans meet inside the picture", outJoints >= 4, outJoints);

  await menu(p);
  await p.click('#guidesPop [data-np="3"]');
  await closeMenu(p);
  v = await vps(p);
  h0 = v.find((q) => q.i === 0);
  await drag(p, h0.x, h0.y, m.left - 90, h0.y);
  v = await vps(p);
  h1 = v.find((q) => q.i === 1);
  await drag(p, h1.x, h1.y, m.left + m.width + 90, h1.y);
  v = await vps(p);
  const h2 = v.find((q) => q.i === 2);
  await drag(p, h2.x, h2.y, m.left + m.width / 2, m.top + m.height + 130);
  v = await vps(p);
  h0 = v.find((q) => q.i === 0); h1 = v.find((q) => q.i === 1);
  const h2b = v.find((q) => q.i === 2);
  t.ok("3-point outside the file: point 3 sits below the picture", h2b && h2b.y > m.top + m.height + 40, h2b);
  const solid3 = await p.evaluate(() => {
    const svg = document.querySelector(".gd-svg");
    const ctm = svg.getScreenCTM();
    const pt = svg.createSVGPoint();
    const map = (x, y) => { pt.x = +x; pt.y = +y; const q = pt.matrixTransform(ctm); return [q.x, q.y]; };
    return [...svg.querySelectorAll("line.gd-mark")].filter((l) => l.getAttribute("stroke") === "#3ec7b5").map((l) => ({
      a: map(l.getAttribute("x1"), l.getAttribute("y1")),
      b: map(l.getAttribute("x2"), l.getAttribute("y2")),
    }));
  });
  t.ok("3-point outside: point 3's lines reach points 1 and 2",
    solid3.some((l) => segDist(h0.x, h0.y, l.a, l.b) < 3) && solid3.some((l) => segDist(h1.x, h1.y, l.a, l.b) < 3), solid3.length);
  await p.keyboard.press("Escape"); await L.lightGone(p);

  // ---- touch -----------------------------------------------------------------------------------------
  const q = await L.newPage(t, cfg, { touch: true, mobile: false, label: "touch" });
  await L.openLight(q, big, { touch: true });
  await L.waitMedia(q, "image");
  await menu(q, true);
  await q.tap('#guidesPop [data-np="3"]');
  await closeMenu(q, true);
  await q.waitForSelector('.gd-hit[data-k="vp"]');
  v = await vps(q);
  t.eq("touch: a tap on the count shows 3 points", v.length, 3);
  const tz = await box(q, '.gd-hit[data-k="hz"]');
  // (this browser may show the file turned: drag across the horizon, whichever way it lies on screen)
  const ux = v[1].x - v[0].x, uy = v[1].y - v[0].y, ul = Math.hypot(ux, uy) || 1, nx = -uy / ul, ny = ux / ul;
  await L.touchDrag(q, tz.cx, tz.cy, tz.cx + nx * 70, tz.cy + ny * 70, 10);
  await q.waitForTimeout(120);
  const w2 = await vps(q);
  const across = (a, b) => (b.x - a.x) * nx + (b.y - a.y) * ny;
  t.ok("touch: a finger drags the horizon (both points)", w2.length === 3 && across(v[0], w2[0]) > 50 && Math.abs(across(v[0], w2[0]) - across(v[1], w2[1])) < 0.6, { v, w2 });
  t.ok("touch: …point 3 stays", w2.length === 3 && Math.hypot(w2[2].x - v[2].x, w2[2].y - v[2].y) < 0.6, { v, w2 });
  const after = (await stored(q, big) || {}).pts;
  t.ok("touch: …and it is saved", after && after["3"] && Math.abs(after["3"][0][1] - after["3"][1][1]) < 0.01, after);
});
