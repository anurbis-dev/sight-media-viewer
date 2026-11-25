// Colour correction areas (0.119): Shift + drag from inside an area adds to it, Ctrl + drag cuts out of it; the
// strokes are baked into the area's outline (data.pts / data.rings), never stored. Ctrl + drag outside is the eraser.
// The + / − bar buttons do the same on touch. Prints a JSON report; the areas are read from the server.
//   node tests/grade_parts_e2e.cjs <sightBase> <assetId> [screenshot dir]
"use strict";
const path = require("path");
const { chromium } = require("playwright");
const [base, aid, shots] = process.argv.slice(2);
const res = { errors: [] };
const rows = async () => (await (await fetch(base + "/api/annotations?asset_id=" + aid)).json()).filter((r) => r.kind === "grade" && !r.deleted_at);
const shot = async (p, name) => { if (shots) await p.screenshot({ path: path.join(shots, name) }); };
const toPage = (p, x, y) => p.evaluate(([x, y]) => {
  const s = document.querySelector(".an-layer .an-doc"), pt = s.createSVGPoint();
  pt.x = x; pt.y = y;
  const q = pt.matrixTransform(s.getScreenCTM());
  return [q.x, q.y];
}, [x, y]);
// A closed loop through doc points, drawn with the mouse.
async function loop(p, pts){
  const q = [];
  for (let i = 0; i < pts.length; i++){
    const a = pts[i], b = pts[(i + 1) % pts.length];
    for (let t = 0; t < 8; t++) q.push(await toPage(p, a[0] + (b[0] - a[0]) * t / 8, a[1] + (b[1] - a[1]) * t / 8));
  }
  await p.mouse.move(q[0][0], q[0][1]);
  await p.mouse.down();
  for (const pt of q.slice(1)) await p.mouse.move(pt[0], pt[1]);
  await p.mouse.move(q[0][0], q[0][1]);
  await p.mouse.up();
  await p.waitForTimeout(900);
}
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const summary = (r) => { const d = r.data, all = (d.rings || [d.pts]).flatMap((g) => g.filter((_, i) => i % 3 === 0)); return { mode: d.mode, rings: d.rings ? d.rings.length : 1, parts: "parts" in d, size: "size" in d, x0: Math.min(...all), x1: Math.max(...all), hue: d.hue }; };

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  p.on("pageerror", (e) => res.errors.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/favicon|404/.test(m.text())) res.errors.push("console: " + m.text()); });
  await p.goto(base + "/");
  await p.waitForSelector(".card[data-id]", { timeout: 20000 });
  await p.dblclick(".card[data-id]");
  await p.waitForSelector(".light", { state: "attached", timeout: 10000 });
  await p.waitForTimeout(600);
  await p.keyboard.press("KeyA");
  await p.waitForSelector(".an-top:not([hidden])", { timeout: 5000 });
  await p.keyboard.press("KeyG");
  await p.waitForTimeout(150);
  await loop(p, rect(200, 200, 500, 500));
  // tune it: hue +60 (typed into the selected area's bar)
  await p.click('.an-props .an-num[data-k="hue"]');
  await p.fill(".an-props .an-numedit", "60");
  await p.keyboard.press("Enter");
  await p.waitForTimeout(700);
  res.first = (await rows()).map(summary);
  // Shift + drag from inside: add a box reaching to x 750
  await p.keyboard.down("Shift");
  await loop(p, rect(400, 260, 750, 440));
  await p.keyboard.up("Shift");
  res.added = (await rows()).map(summary);
  // Ctrl + drag from inside: a hole
  await p.keyboard.down("Control");
  await loop(p, rect(260, 300, 340, 380));
  await p.keyboard.up("Control");
  res.cut = (await rows()).map(summary);
  res.holeHit = await p.evaluate(() => { const L = document.querySelector(".an-layer .an-grades"); return L ? L.children.length : -1; });
  await shot(p, "grade-parts.png");
  // undo the cut: one ring again
  await p.keyboard.press("Control+KeyZ");
  await p.waitForTimeout(900);
  res.undone = (await rows()).map(summary);
  await p.keyboard.press("Control+Shift+KeyZ");
  await p.waitForTimeout(900);
  // Ctrl + drag outside every area (not touching it): the eraser — no new area, the area stays
  await p.keyboard.down("Control");
  await loop(p, rect(900, 600, 1000, 700));
  await p.keyboard.up("Control");
  res.outside = (await rows()).map(summary);
  // touch: the bar's − cuts without Ctrl
  res.bar = await p.evaluate(() => ({ add: !!document.querySelector(".an-props [data-cmd=gadd]"), sub: !!document.querySelector(".an-props [data-cmd=gsub]") }));
  await p.click(".an-props [data-cmd=gsub]");
  await loop(p, rect(600, 280, 700, 420));
  res.barCut = (await rows()).map(summary);
  await b.close();
  console.log(JSON.stringify(res));
})().catch((e) => { console.log(JSON.stringify({ ...res, fatal: String(e && e.stack || e) })); process.exit(1); });
