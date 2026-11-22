// Lasso / stroke arrows / hatch width (0.109): review-core's renderer and the shared drawing canvas
// (review-draw.js: the HTML page, the phone app) in headless Chromium, on a phone-size touch screen.
//   - renderer: a lasso without hatchWidth draws as before (lines 0.18·gap wide, dots 0.2·gap in radius);
//     with it, its width / the dots' diameter; transformItem scales it; the shared pattern icons / labels.
//   - canvas: L takes the lasso (brush slot), its row has the pattern icons (review-core's) and the hatch
//     switch (hidden for solid / none); thick → a stroke with hatchWidth; Shift+W draws arrows along a stroke.
// Called by tests/test_review_page.py.  node tests/draw_lasso.cjs <repo root> [screenshot dir]
"use strict";
const fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const root = process.argv[2], shots = process.argv[3] || "";
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const log = [], res = {};
  p.on("pageerror", (e) => log.push("pageerror: " + e.message));
  const js = ["review-core.js", "review-draw.js"].map((f) => fs.readFileSync(path.join(root, "app/static", f), "utf8")).join("\n;\n");
  const svg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#246"/></svg>');
  await p.setContent(`<!doctype html><meta name="viewport" content="width=device-width"><body style="margin:0"><script>${js}</script></body>`);
  // ---- renderer ----
  res.render = await p.evaluate(() => {
    const RC = SightReviewCore;
    const sq = [100, 100, 0.5, 300, 100, 0.5, 300, 300, 0.5, 100, 300, 0.5];
    const lasso = (extra) => ({ kind: "stroke", shape_kind: "brush", data: Object.assign({ color: "#f00", size: 4, opacity: 1, pts: sq.slice(), close: true, pattern: "diag", fill: "#0f0", fillOpacity: 0.5, gap: 10 }, extra) });
    const hatch = (it) => RC.primsOf(it).find((q) => q.stroke && q.cap === "butt");
    const dots = (it) => { const q = RC.primsOf(it).find((x) => x.fill && /a[\d.]+ [\d.]+ 0 1 0/.test(x.d)); return q ? Number(/a([\d.]+) /.exec(q.d)[1]) : null; };
    const big = lasso({ hatchWidth: 3 }), moved = JSON.parse(JSON.stringify(big));
    RC.transformItem(moved, big, (x, y) => [x * 2, y * 2], { k: 2 });
    return {
      oldSw: hatch(lasso({})).sw, newSw: hatch(lasso({ hatchWidth: 3 })).sw, zeroSw: hatch(lasso({ hatchWidth: 0 })).sw,
      gridSw: hatch(lasso({ pattern: "grid", hatchWidth: 1.5 })).sw,
      oldDot: dots(lasso({ pattern: "dots" })), newDot: dots(lasso({ pattern: "dots", hatchWidth: 6 })),
      scaled: moved.data.hatchWidth, gapScaled: moved.data.gap,
      // hatchMetrics (Sight's Lines drag starts from it) = what is drawn, also where a huge area caps the spacing
      capped: (() => { const h = lasso({ pts: [0, 0, .5, 9000, 0, .5, 9000, 9000, .5, 0, 9000, .5] }); return [RC.hatchMetrics(h.data).width, hatch(h).sw]; })(),
      noPts: RC.hatchMetrics({ pattern: "dots", gap: 10 }).auto,
      // Sight's Lines drag from Auto starts at autoStored: stored as hatchWidth it draws exactly Auto, under the cap too
      // (a 3840 × 2160 lasso, gap 10: lines and dots)
      storedIsAuto: ["diag", "dots"].map((pat) => {
        const big = (extra) => lasso(Object.assign({ pattern: pat, pts: [0, 0, .5, 3840, 0, .5, 3840, 2160, .5, 0, 2160, .5] }, extra));
        const drawn = (it) => pat === "dots" ? dots(it) * 2 : hatch(it).sw;
        const m = RC.hatchMetrics(big({}).data);
        return [m.gap > m.gap0, Math.abs(drawn(big({ hatchWidth: m.autoStored })) - drawn(big({}))) < 0.02, Math.abs(drawn(big({})) - m.auto) < 0.02];
      }),
      icons: RC.PATTERNS.concat(["random"]).every((id) => typeof RC.patternIcon(id) === "string" && RC.patternIcon(id).length > 20 && !!RC.PATTERN_LABELS[id]),
      toolIcons: !!(RC.TOOL_ICONS.lasso && RC.TOOL_ICONS.arrows),
    };
  });
  // ---- the drawing canvas ----
  await p.evaluate((src) => { window.__res = null; SightReviewDraw.open({ src, vb: [0, 0, 1200, 800], base: [], items: [], onDone: (its) => { window.__res = its; }, onCancel: () => {} }); }, svg);
  await p.waitForSelector(".draw");
  await p.waitForFunction(() => document.querySelector(".draw img").complete);
  await p.waitForTimeout(200);
  await p.keyboard.press("KeyL");
  res.lassoIcon = await p.evaluate(() => document.querySelector('.draw .tb[data-t="brush"]').innerHTML.includes("M7.5 15c"));
  await p.tap('.draw .tb[data-t="brush"]');   // the row: brush / lasso, the pattern button, the hatch switch
  await p.waitForSelector(".draw .dfly [data-pat]");
  res.hatchShown = await p.isVisible(".draw .dfly [data-hatch]");
  await p.tap(".draw .dfly [data-pat]");
  res.patRow = await p.evaluate(() => [...document.querySelectorAll(".draw .dfly")].pop().querySelectorAll(".tb").length);
  if (shots) await p.screenshot({ path: path.join(shots, "phone-lasso-patterns.png") });
  await p.tap('.draw .dfly .tb[title="Solid"]');
  res.hatchSolid = await p.isVisible(".draw .dfly [data-hatch]");
  await p.tap(".draw .dfly [data-pat]");
  await p.tap('.draw .dfly .tb[title="Grid"]');
  res.hatchGrid = await p.isVisible(".draw .dfly [data-hatch]");
  await p.tap(".draw .dfly [data-hatch]"); await p.tap(".draw .dfly [data-hatch]");  // auto → thin → thick
  res.hatchTitle = await p.getAttribute(".draw .dfly [data-hatch]", "title");
  if (shots) await p.screenshot({ path: path.join(shots, "phone-lasso-row.png") });
  const vb = await p.locator(".draw .dview").boundingBox();
  const cx = vb.x + vb.width / 2, cy = vb.y + vb.height / 2;
  const loop = async (r) => {
    await p.mouse.move(cx + r, cy); await p.mouse.down();
    for (let a = 0.3; a <= 6.3; a += 0.3) await p.mouse.move(cx + r * Math.cos(a), cy + r * 0.7 * Math.sin(a));
    await p.mouse.up();
  };
  await loop(90);
  await p.keyboard.press("Shift+KeyW");
  res.arrowsIcon = await p.evaluate(() => document.querySelector('.draw .tb[data-t="arrows"]').innerHTML.includes("M3 17c3-5"));
  await p.mouse.move(cx - 120, cy + 150); await p.mouse.down(); await p.mouse.move(cx + 120, cy + 170, { steps: 10 }); await p.mouse.up();
  if (shots) await p.screenshot({ path: path.join(shots, "phone-drawn.png") });
  await p.click(".draw .btn.primary");
  res.items = await p.evaluate(() => window.__res);
  res.log = log;
  process.stdout.write(JSON.stringify(res));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
