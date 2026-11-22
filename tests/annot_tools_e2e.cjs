// Sight's annotation toolbar (0.109) in Chromium: the Lasso (L) and Stroke arrows (Shift+W) tools, the lasso's
// pattern icon row and hatch line width ("Lines", Auto = 0), and drawings made before (a closed brush stroke, an
// arrows stroke: seeded by tests/test_annot_tools.py) selected with those tools' props. Then a phone-size touch
// screen: the same icon row, big enough for a finger. Prints a JSON report; the drawings are read from the server.
//   node tests/annot_tools_e2e.cjs <sightBase> <assetId> [screenshot dir]
"use strict";
const path = require("path");
const { chromium } = require("playwright");
const [base, aid, shots] = process.argv.slice(2);
const res = { errors: [] };
const rows = async () => (await (await fetch(base + "/api/annotations?asset_id=" + aid)).json());
const shot = async (p, name) => { if (shots) await p.screenshot({ path: path.join(shots, name) }); };

async function openAnnot(p, touch){
  await p.goto(base + "/");
  await p.waitForSelector(".card[data-id]", { timeout: 20000 });
  if (touch){ await p.tap(".card[data-id]"); await p.waitForTimeout(150); await p.tap(".card[data-id]"); }
  else await p.dblclick(".card[data-id]");
  await p.waitForSelector(".light", { state: "attached", timeout: 10000 });
  await p.waitForTimeout(600);
  if (touch) await p.tap("#annoBtn"); else await p.keyboard.press("KeyA");
  await p.waitForSelector(".an-top:not([hidden])", { timeout: 5000 });
  await p.waitForTimeout(200);
}
// Doc units (the picture's pixels) → page px, through the drawing layer's own transform.
const toPage = (p, x, y) => p.evaluate(([x, y]) => {
  const s = document.querySelector(".an-layer .an-doc"), pt = s.createSVGPoint();
  pt.x = x; pt.y = y;
  const q = pt.matrixTransform(s.getScreenCTM());
  return [q.x, q.y];
}, [x, y]);
const propsState = (p) => p.evaluate(() => {
  const el = document.querySelector(".an-props");
  return {
    label: el.querySelector(".an-pl")?.textContent || "",
    icons: el.querySelectorAll(".an-seg.ico button").length,
    lines: el.querySelector('.an-num[data-k="hatchWidth"] em')?.textContent ?? null,
    step: !!el.querySelector('.an-num[data-k="step"]'),
  };
});
async function typeNum(p, key, v){
  await p.click(`.an-props .an-num[data-k="${key}"]`);
  await p.fill(".an-props .an-numedit", String(v));
  await p.keyboard.press("Enter");
  await p.waitForTimeout(100);
}

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  p.on("pageerror", (e) => res.errors.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/favicon|404/.test(m.text())) res.errors.push("console: " + m.text()); });
  await openAnnot(p, false);
  res.toolTitles = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll(".an-bar [data-tool]")].map((b) => [b.dataset.tool, b.title])));
  // the brush / arrow tools: no Close / Stroke switches any more
  await p.keyboard.press("KeyB");
  res.brushProps = await p.evaluate(() => ({ seg: document.querySelectorAll(".an-props .an-seg.ico").length, close: document.querySelectorAll('.an-props [data-k="close"]').length }));
  await p.keyboard.press("KeyW");
  res.arrowProps = await p.evaluate(() => ({ mode: document.querySelectorAll('.an-props [data-k="mode"]').length, step: document.querySelectorAll('.an-props [data-k="step"]').length }));
  // the lasso tool
  await p.keyboard.press("KeyL");
  const lt = await propsState(p);
  await p.click('.an-props .an-seg.ico button[data-v="solid"]');
  lt.linesSolid = (await propsState(p)).lines !== null;
  await p.click('.an-props .an-seg.ico button[data-v="grid"]');
  lt.on = await p.getAttribute('.an-props .an-seg.ico button[data-v="grid"]', "aria-pressed");
  res.lassoTool = lt;
  await typeNum(p, "size", 4);
  await typeNum(p, "hatchWidth", 3);
  await shot(p, "sight-lasso-tool.png");
  const [cx, cy] = await toPage(p, 600, 420);
  await p.mouse.move(cx + 110, cy); await p.mouse.down();
  for (let a = 0.25; a <= 6.4; a += 0.25) await p.mouse.move(cx + 110 * Math.cos(a), cy + 80 * Math.sin(a));
  await p.mouse.up();
  // stroke arrows
  await p.keyboard.press("Shift+KeyW");
  res.arrowsTool = await propsState(p);
  const [ax, ay] = await toPage(p, 300, 650);
  await p.mouse.move(ax, ay); await p.mouse.down(); await p.mouse.move(ax + 220, ay + 30, { steps: 12 }); await p.mouse.up();
  // a plain brush stroke
  await p.keyboard.press("KeyB");
  const [bx, by] = await toPage(p, 900, 200);
  await p.mouse.move(bx, by); await p.mouse.down(); await p.mouse.move(bx + 120, by + 40, { steps: 8 }); await p.mouse.up();
  await p.waitForTimeout(700);
  await shot(p, "sight-drawn.png");
  // the old closed brush: the lasso's props; a pattern picked, the width typed, then right-click → Auto
  await p.keyboard.press("KeyV");
  const [ox, oy] = await toPage(p, 330, 260);   // inside the old lasso (its fill)
  await p.mouse.click(ox, oy);
  await p.waitForTimeout(200);
  res.oldLasso = await propsState(p);
  await shot(p, "sight-old-lasso.png");
  await p.click('.an-props .an-seg.ico button[data-v="dots"]');
  await typeNum(p, "hatchWidth", 2);
  await p.waitForTimeout(500);
  res.oldLassoHw = ((await rows()).find((r) => r.id === "1".repeat(16)) || {}).data?.hatchWidth || 0;
  await p.click('.an-props .an-num[data-k="hatchWidth"]', { button: "right" });
  await p.waitForTimeout(500);
  // the old arrows stroke
  await p.keyboard.press("Escape");
  const [qx, qy] = await toPage(p, 800, 640);
  await p.mouse.click(qx, qy);
  await p.waitForTimeout(200);
  res.oldArrows = await propsState(p);
  await p.waitForTimeout(600);
  // a lasso + a plain brush selected together: the props both have (Size), and ] makes both bigger
  await p.keyboard.press("Escape");
  const sizes = async () => { const all = await rows(); return [all.find((r) => r.id === "1".repeat(16)).data.size, all.find((r) => r.shape_kind === "brush" && !r.data.close).data.size]; };
  const before = await sizes();
  await p.mouse.click(ox, oy);
  await p.keyboard.down("Shift"); await p.mouse.click(bx + 60, by + 20); await p.keyboard.up("Shift");
  await p.waitForTimeout(200);
  res.mixed = await p.evaluate(() => ({ label: document.querySelector(".an-props .an-pl")?.textContent || "", size: !!document.querySelector('.an-props .an-num[data-k="size"]'), pressure: !!document.querySelector('.an-props [data-k="pressure"]') }));
  await p.keyboard.press("BracketRight");
  await p.waitForTimeout(600);
  const after = await sizes();
  res.mixed.grew = after.map((v, i) => Math.round(v / before[i] * 100) / 100);  // each from its own size
  // right-click Size: each back to its own type's default (lasso 4 px, brush 8 px)
  await p.click('.an-props .an-num[data-k="size"]', { button: "right" });
  await p.waitForTimeout(600);
  const reset = await sizes();
  res.mixed.resetRatio = Math.round(reset[0] / reset[1] * 100) / 100;
  res.rows = await rows();
  // ---- a phone-size touch screen: the tools by tap, the icon row ----
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const t = await ctx.newPage();
  t.on("pageerror", (e) => res.errors.push("touch: " + e.message));
  await openAnnot(t, true);
  await t.tap('.an-bar [data-tool="lasso"]');
  await t.waitForSelector(".an-props .an-seg.ico button");
  await t.tap('.an-props .an-seg.ico button[data-v="cross"]');
  res.touch = await t.evaluate(() => {
    const bs = document.querySelectorAll(".an-props .an-seg.ico button");
    return { icons: bs.length, iconSize: Math.round(bs[0].getBoundingClientRect().width), on: document.querySelector('.an-props .an-seg.ico button[data-v="cross"]').classList.contains("on") };
  });
  await shot(t, "touch-lasso.png");
  await t.tap('.an-bar [data-tool="arrows"]');
  await t.waitForTimeout(150);
  await shot(t, "touch-arrows.png");
  await b.close();
  process.stdout.write(JSON.stringify(res));
})().catch((e) => { console.error(e); process.stdout.write(JSON.stringify(res)); process.exit(1); });
