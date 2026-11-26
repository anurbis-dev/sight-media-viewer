// R0-0 block 2: the stored geometry, golden (tests/test_r0_annotate.py). Known drawings made with real pointer input
// on known files must store exactly the rows in tests/fixtures/r0_geometry_golden.json — x / y / w / h, the data's
// points and sizes, the frame (ctx.t) — in the decoded picture's pixels:
//   - g_pic.png (1600 x 1000, drawn on at fit): brush, pencil, marker, lasso, arrow, stroke arrows, rectangle, ellipse,
//     text, pin, colour correction; then a note that takes them;
//   - g_small.png (decoded 400 x 300, its asset row says 800 x 600): a rectangle and a brush stroke at 100 %;
//   - g_clip.mp4 (320 x 240) on frame 25: a rectangle and a brush stroke;
//   - g_sar.mp4 (stored 320 x 240 with a 2:1 pixel aspect, shown 640 x 240): a rectangle.
// Each drawing is also checked against the doc point it was aimed at (the golden itself is in the right units).
"use strict";
const L = require("./r0_lib.cjs");

// Doc units (the picture's pixels) -> page px, through the drawing layer's own transform.
const toPage = (p, x, y) => p.evaluate(([x, y]) => {
  const s = document.querySelector(".light .an-layer .an-doc"), pt = s.createSVGPoint();
  pt.x = x; pt.y = y;
  const q = pt.matrixTransform(s.getScreenCTM());
  return [q.x, q.y];
}, [x, y]);
// The row as stored, without what changes from run to run (ids, times, the asset id). A drawing's note becomes the
// note's text. A text's own box (x / y / w / h columns) is measured with the system's fonts (RC.textLayout), so it
// is left out (its data — place, size, words — stays); everything else is kept.
const VOLATILE = new Set(["id", "target_asset_id", "board_id", "created_at", "updated_at", "deleted_at", "revision"]);   // (revision counts writes, which the queue may coalesce)
function normAll(rows){
  const text = new Map(rows.filter((r) => r.kind === "note").map((r) => [r.id, r.data?.text]));
  return rows.map((r) => {
    const out = {};
    for (const [k, v] of Object.entries(r)) if (!VOLATILE.has(k)) out[k] = v;
    const d = out.data = { ...(r.data || {}) };
    delete d.created; delete d.edited_at; delete d.status_at;
    if (d.note) d.note = text.has(d.note) ? `<note: ${text.get(d.note)}>` : "<another note>";
    if (r.kind === "text"){ for (const k of ["x", "y", "w", "h"]) out[k] = "<font>"; }
    return out;
  }).sort((a, b) => key(a).localeCompare(key(b)));
}
const key = (r) => `${r.kind}/${r.shape_kind || ""}/${r.z_index}`;

L.run(async (cfg, t) => {
  const id = cfg.ids, p = await L.newPage(t, cfg);
  const out = {};
  async function enter(aid, kind){
    await L.openLight(p, aid);
    await L.waitMedia(p, kind);
    await p.keyboard.press("KeyA");
    await p.waitForSelector(".an-top:not([hidden])", { timeout: 5000 });
    await p.waitForSelector(".light .an-layer .an-doc", { state: "attached", timeout: 5000 });
    await p.waitForTimeout(150);
  }
  async function drag(pts, steps = 6){
    const P = [];
    for (const [x, y] of pts) P.push(await toPage(p, x, y));
    // (every point on the picture itself, not under a bar)
    const free = await p.evaluate((P) => P.every(([x, y]) => !!document.elementFromPoint(x, y)?.closest(".light .view") && !document.elementFromPoint(x, y).closest(".an-top, .an-props, .an-panel, .vbar")), P);
    t.ok(`drag at ${JSON.stringify(pts[0])} lands on the picture`, free, P);
    await p.mouse.move(P[0][0], P[0][1]); await p.mouse.down();
    for (let i = 1; i < P.length; i++) await p.mouse.move(P[i][0], P[i][1], { steps });
    await p.mouse.up();
    await p.waitForTimeout(60);
  }
  async function click(x, y){ const [a, b] = await toPage(p, x, y); await p.mouse.click(a, b); await p.waitForTimeout(80); }
  async function leave(){
    await p.keyboard.press("Escape"); await p.keyboard.press("Escape");
    await p.keyboard.press("Escape");
    await L.lightGone(p);
  }
  // The rows once the write queue has sent them all: n rows, each settled (a drawing in its note, when there is one).
  async function stored(aid, n){
    const end = Date.now() + 10000;
    let r = [];
    while (Date.now() < end){
      r = await L.rows(cfg, aid);
      const note = r.find((x) => x.kind === "note");
      if (r.length === n && (!note || r.every((x) => x.kind === "note" || x.data?.note === note.id))) break;
      await p.waitForTimeout(100);
    }
    await p.waitForTimeout(300);
    return L.rows(cfg, aid);
  }
  // The decoded size, and the page box the layer maps (0, 0) - (decoded size) to: it must be the media's own box.
  async function layerUnits(){
    const b = await L.mediaBox(p), a = await toPage(p, 0, 0), z = await toPage(p, b.w, b.h);
    const fits = L.near(a[0], b.left, 1) && L.near(a[1], b.top, 1) && L.near(z[0], b.left + b.width, 1) && L.near(z[1], b.top + b.height, 1);
    return { size: [b.w, b.h], fits };
  }
  // A stored drawing is where it was aimed (doc px): the golden itself is in the decoded picture's units.
  const aimed = (name, rowsOf, sub, got, want, tol = 1.5) => {
    const r = rowsOf.find((x) => (x.shape_kind || x.kind) === sub);
    const v = r ? got(r) : null;
    t.ok(`${name}: ${sub} stored where it was drawn`, !!v && v.every((n, i) => L.near(n, want[i], tol)), v, want);
  };

  // ---- g_pic.png at fit ---------------------------------------------------------------------------------
  await enter(id["g_pic.png"], "image");
  const fitS = (await L.mediaBox(p)).s;
  t.ok("g_pic: drawn on at fit (scale < 1)", fitS < 0.95, fitS, "< 0.95");
  t.eq("g_pic: the drawing layer is in the decoded picture's pixels", await layerUnits(), { size: [1600, 1000], fits: true });
  await p.keyboard.press("KeyB"); await drag([[100, 100], [300, 140], [500, 100]]);
  await p.keyboard.press("KeyP"); await drag([[100, 250], [400, 300]]);
  await p.keyboard.press("KeyM"); await drag([[100, 400], [400, 400]]);
  await p.keyboard.press("KeyL"); await drag([[700, 250], [900, 250], [900, 450], [700, 450], [700, 260]]);
  await p.keyboard.press("KeyW"); await drag([[1000, 200], [1300, 300]]);
  await p.keyboard.press("Shift+KeyW"); await drag([[1000, 400], [1200, 450], [1400, 400]]);
  await p.keyboard.press("KeyR"); await drag([[100, 550], [400, 750]]);
  await p.keyboard.press("KeyO"); await drag([[500, 550], [800, 750]]);
  await p.keyboard.press("KeyG"); await drag([[1000, 600], [1300, 600], [1300, 850], [1000, 850], [1000, 610]]);
  await p.keyboard.press("Escape");   // the new correction area stays selected
  await p.keyboard.press("KeyT"); await click(150, 900);
  await p.keyboard.type("Golden"); await p.keyboard.press("Escape");
  await p.keyboard.press("KeyN"); await click(600, 900);
  await p.keyboard.type("7"); await p.keyboard.press("Enter");
  await p.keyboard.press("Enter");   // into the note field (focused on the next frame: wait, or keys go to the tools)
  await p.waitForFunction(() => document.activeElement?.matches?.(".an-panel .an-input"), null, { timeout: 5000 });
  await p.keyboard.type("golden note"); await p.keyboard.press("Enter");
  out.g_pic = normAll(await stored(id["g_pic.png"], 12));
  const P0 = (r) => r.data.pts.slice(0, 2), PN = (r) => r.data.pts.slice(-3, -1);
  aimed("g_pic", out.g_pic, "brush", (r) => [...P0(r), ...PN(r)], [100, 100, 500, 100]);
  aimed("g_pic", out.g_pic, "pencil", (r) => [...P0(r), ...PN(r)], [100, 250, 400, 300]);
  aimed("g_pic", out.g_pic, "marker", (r) => [...P0(r), ...PN(r)], [100, 400, 400, 400]);
  aimed("g_pic", out.g_pic, "arrow", (r) => r.data.pts, [1000, 200, 1300, 300]);
  aimed("g_pic", out.g_pic, "arrows", (r) => [...P0(r), ...PN(r)], [1000, 400, 1400, 400]);
  aimed("g_pic", out.g_pic, "rect", (r) => [r.data.x, r.data.y, r.data.w, r.data.h], [100, 550, 300, 200]);
  aimed("g_pic", out.g_pic, "ellipse", (r) => [r.data.x, r.data.y, r.data.w, r.data.h], [500, 550, 300, 200]);
  aimed("g_pic", out.g_pic, "grade", (r) => [r.x, r.y], [1000, 600]);
  aimed("g_pic", out.g_pic, "pin", (r) => [r.data.x, r.data.y], [600, 900]);
  aimed("g_pic", out.g_pic, "text", (r) => [r.data.x], [150]);
  t.ok("g_pic: the lasso is a closed brush stroke", out.g_pic.some((r) => r.shape_kind === "brush" && r.data.close === true && r.data.pattern === "diag"), out.g_pic.map((r) => r.shape_kind));
  t.near("g_pic: a size is screen px at the scale drawn (brush: 8 px / fit scale)", out.g_pic.find((r) => r.shape_kind === "brush" && !r.data.close)?.data.size, 8 / fitS, 0.01);
  t.eq("g_pic: every drawing went into the note", out.g_pic.filter((r) => r.kind !== "note").map((r) => r.data.note), Array(11).fill("<note: golden note>"));
  await leave();

  // ---- g_small.png: decoded 400 x 300, its row says 800 x 600 -------------------------------------------
  await enter(id["g_small.png"], "image");
  t.eq("g_small: the layer is the decoded size, not the asset row's", await layerUnits(), { size: [400, 300], fits: true });
  await p.keyboard.press("KeyR"); await drag([[50, 40], [250, 190]]);
  await p.keyboard.press("KeyB"); await drag([[60, 250], [340, 260]]);
  out.g_small = normAll(await stored(id["g_small.png"], 2));
  aimed("g_small", out.g_small, "rect", (r) => [r.data.x, r.data.y, r.data.w, r.data.h], [50, 40, 200, 150]);
  aimed("g_small", out.g_small, "brush", (r) => r.data.pts.slice(0, 2), [60, 250]);
  await leave();

  // ---- g_clip.mp4 on frame 25 ---------------------------------------------------------------------------
  await enter(id["g_clip.mp4"], "video");
  await p.evaluate(() => { const v = document.querySelector(".light video.view-media"); v.pause(); v.currentTime = 0; });
  await L.vsettled(p);
  for (let i = 0; i < 25; i++) await p.keyboard.press("Period");
  await L.vsettled(p);
  t.eq("g_clip: the layer is the video's size", await layerUnits(), { size: [320, 240], fits: true });
  await p.keyboard.press("KeyR"); await drag([[40, 30], [200, 150]]);
  await p.keyboard.press("KeyB"); await drag([[30, 200], [290, 210]]);
  out.g_clip = normAll(await stored(id["g_clip.mp4"], 2));
  aimed("g_clip", out.g_clip, "rect", (r) => [r.data.x, r.data.y, r.data.w, r.data.h], [40, 30, 160, 120]);
  t.eq("g_clip: both drawings on frame 25 (t = 1 s)", out.g_clip.map((r) => r.data.ctx), [{ t: 1, hold: 0 }, { t: 1, hold: 0 }]);
  await leave();

  // ---- g_sar.mp4: stored 320 x 240, a 2:1 pixel aspect ------------------------------------------------------
  await enter(id["g_sar.mp4"], "video");
  await p.evaluate(() => { const v = document.querySelector(".light video.view-media"); v.pause(); v.currentTime = 0; });
  await L.vsettled(p);
  t.eq("g_sar: the layer is the shown size (the pixel aspect applied)", await layerUnits(), { size: [640, 240], fits: true });
  await p.keyboard.press("KeyR"); await drag([[100, 40], [500, 200]]);
  out.g_sar = normAll(await stored(id["g_sar.mp4"], 1));
  aimed("g_sar", out.g_sar, "rect", (r) => [r.data.x, r.data.y, r.data.w, r.data.h], [100, 40, 400, 160]);
  await leave();

  t.data = out;
  // ---- the golden: every stored number the same (to 0.001: they are made here from the same input) ------------
  const diff = (a, b, at) => {
    if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-3 ? [] : [`${at}: ${a} != ${b}`];
    if (Array.isArray(a) && Array.isArray(b)) return a.length !== b.length ? [`${at}: length ${a.length} != ${b.length}`] : a.flatMap((x, i) => diff(x, b[i], `${at}[${i}]`));
    if (a && b && typeof a === "object" && typeof b === "object"){
      const ks = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
      return ks.flatMap((k) => (k in a && k in b ? diff(a[k], b[k], `${at}.${k}`) : [`${at}.${k}: ${k in a ? "not in the golden" : "missing"}`]));
    }
    return JSON.stringify(a) === JSON.stringify(b) ? [] : [`${at}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`];
  };
  if (cfg.golden) for (const f of Object.keys({ ...cfg.golden, ...out })){
    const d = diff(out[f], cfg.golden[f], f);
    t.ok(`${f}: rows match the golden`, !d.length, d.slice(0, 12), "no difference");
  }
});
