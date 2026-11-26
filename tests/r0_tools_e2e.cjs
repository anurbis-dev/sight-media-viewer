// R0-0 block 2: the drawing tools, select / transform, undo / redo, the eye and onion skin, as they behave before R0
// (tests/test_r0_annotate.py). Stored geometry of each tool is pinned by r0_geometry_e2e.cjs; here:
//   - each tool's key and its toolbar button (the mode starts with the brush; R / O the shape kind);
//   - select (click on a drawing, Shift+click adds, a marquee, Ctrl+A), the handles, move by drag, resize by a corner,
//     turn by the round handle, nudge (← → with Shift), Delete, duplicate (Ctrl+D), copy / paste, cut / paste in place,
//     bring forward (Ctrl+]); undo / redo by keys (Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y) and by the toolbar's buttons;
//   - the eraser: a whole drawing, then Partial (a stroke cut in two); the bin (Shift+Delete) and its undo;
//   - the eye: Shift+H / a click hide and show; onion skin (the eye's right-click) on a video: the ghosts' opacity
//     between two annotated frames, kept as sight.annotate.onion; off again;
//   - touch (a touch laptop): a tool by tap, a finger stroke, undo / redo by tap, onion skin by a long press.
"use strict";
const L = require("./r0_lib.cjs");

L.run(async (cfg, t) => {
  const id = cfg.ids, p = await L.newPage(t, cfg);
  const pic = id["t_pic.png"], clip = id["t_clip.mp4"];
  async function until(aid, fn, ms = 5000){
    const end = Date.now() + ms;
    let r = [];
    while (Date.now() < end){ r = (await L.rows(cfg, aid)).filter((x) => x.kind !== "status"); if (fn(r)) return r; await p.waitForTimeout(100); }
    return r;
  }
  const toPageOn = (pg, x, y) => pg.evaluate(([x, y]) => {
    const s = document.querySelector(".light .an-layer .an-doc"), pt = s.createSVGPoint();
    pt.x = x; pt.y = y;
    const q = pt.matrixTransform(s.getScreenCTM());
    return [q.x, q.y];
  }, [x, y]);
  const toPage = (x, y) => toPageOn(p, x, y);
  async function drag(pts, opts = {}){
    const P = [];
    for (const [x, y] of pts) P.push(await toPage(x, y));
    // (every point on the picture itself, not under a bar)
    const free = await p.evaluate((P) => P.every(([x, y]) => !!document.elementFromPoint(x, y)?.closest(".light .view") && !document.elementFromPoint(x, y).closest(".an-top, .an-props, .an-panel, .vbar")), P);
    t.ok(`drag at ${JSON.stringify(pts[0])} lands on the picture`, free, P);
    await p.mouse.move(P[0][0], P[0][1]); await p.mouse.down();
    for (let i = 1; i < P.length; i++) await p.mouse.move(P[i][0], P[i][1], { steps: opts.steps || 6 });
    await p.mouse.up();
    await p.waitForTimeout(60);
  }
  async function click(x, y, mods = []){
    const [a, b] = await toPage(x, y);
    for (const m of mods) await p.keyboard.down(m);
    await p.mouse.click(a, b);
    for (const m of mods) await p.keyboard.up(m);
    await p.waitForTimeout(80);
  }
  const tool = (pg = p) => pg.evaluate(() => document.querySelector(".an-bar [data-tool].on")?.dataset.tool || null);
  // The selection's handles on the page, by name (RC.xfHandles order: corners / sides, then the round turn handle).
  const handles = () => p.evaluate(() => {
    const ui = document.querySelector(".light .an-layer .an-ui");
    const sq = [...ui.querySelectorAll('rect[fill="#fff"]')], rot = ui.querySelector('circle[fill="#4c9aff"]');
    const c = (e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
    const names = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
    const out = {};
    sq.forEach((e, i) => { out[names[i]] = c(e); });
    if (rot) out.rot = c(rot);
    return out;
  });
  const shownIds = (pg = p) => pg.$$eval(".light .an-layer .an-doc g[data-id]", (gs) => gs.filter((g) => g.style.display !== "none").map((g) => g.dataset.id));
  const opacities = () => p.$$eval(".light .an-layer .an-doc g[data-id]", (gs) => Object.fromEntries(gs.map((g) => [g.dataset.id, g.style.display === "none" ? 0 : g.style.opacity === "" ? 1 : Number(g.style.opacity)])));
  const selCount = () => p.$$eval(".light .an-layer .an-ui rect[stroke-dasharray]", (e) => e.length);
  // Esc drops a selection, but with nothing selected it leaves the drawing mode: only pressed when there is one.
  const deselect = async () => { if (await selCount()) await p.keyboard.press("Escape"); };
  const rectAt = (r, x0) => r.find((x) => x.shape_kind === "rect" && L.near(x.data.x, x0, 3));

  // ---- tools: keys and buttons -------------------------------------------------------------------------------------
  await L.openLight(p, pic);
  await L.waitMedia(p, "image");
  await p.keyboard.press("KeyA");
  await p.waitForSelector(".an-top:not([hidden])");
  t.eq("the drawing mode starts with the brush", await tool(), "brush");
  t.ok("the picture is shown smaller than its pixels (fit), so screen px and picture px differ", (await L.mediaBox(p)).s < 0.95, (await L.mediaBox(p)).s, "< 0.95");
  const keys = [["KeyV", "select"], ["KeyP", "pencil"], ["KeyM", "marker"], ["KeyL", "lasso"], ["KeyE", "eraser"], ["KeyG", "grade"],
    ["KeyW", "arrow"], ["Shift+KeyW", "arrows"], ["KeyR", "rect"], ["KeyT", "text"], ["KeyN", "pin"], ["Shift+KeyI", "image"], ["KeyB", "brush"]];
  const gotKeys = [];
  for (const [k] of keys){ await p.keyboard.press(k); gotKeys.push(await tool()); }
  t.eq("each tool's key picks it", gotKeys, keys.map((k) => k[1]));
  await p.keyboard.press("KeyO");
  t.eq("O: the shape tool, as an ellipse (its button's icon)", [await tool(), await p.$eval('.an-bar [data-tool="rect"]', (b) => b.dataset.shape)], ["rect", "ellipse"]);
  await p.keyboard.press("KeyR");
  t.eq("R: back to a rectangle", await p.$eval('.an-bar [data-tool="rect"]', (b) => b.dataset.shape), "rect");
  const gotBtns = [];
  for (const tl of ["pencil", "select", "arrows", "brush"]){ await p.click(`.an-bar [data-tool="${tl}"]`); gotBtns.push(await tool()); }
  t.eq("a toolbar button picks its tool", gotBtns, ["pencil", "select", "arrows", "brush"]);
  t.ok("the brush shows its props (Size)", !!(await p.$('.an-props .an-num[data-k="size"]')));

  // ---- two rectangles, select, handles --------------------------------------------------------------------------------
  await p.keyboard.press("KeyR");
  await drag([[100, 300], [300, 450]]);
  await drag([[500, 300], [700, 450]]);
  let r = await until(pic, (r) => r.length === 2);
  const A0 = rectAt(r, 100), B0 = rectAt(r, 500);
  t.ok("two rectangles drawn", !!A0 && !!B0, r.map((x) => [x.shape_kind, x.data.x]));
  await p.keyboard.press("KeyV");
  await click(100, 330);   // on A's outline (not where a grip will be: its west grip is at (100, 375))
  let h = await handles();
  t.eq("a click on a drawing selects it: eight grips and the turn handle", Object.keys(h).sort(), ["e", "n", "ne", "nw", "rot", "s", "se", "sw", "w"]);
  t.ok("…the props bar is the shape's", !!(await p.$('.an-props .an-num[data-k="width"]')));
  // move by drag
  const [ax, ay] = await toPage(100, 330), [bx, by] = await toPage(150, 360);
  await p.mouse.move(ax, ay); await p.mouse.down(); await p.mouse.move(bx, by, { steps: 8 }); await p.mouse.up();
  r = await until(pic, (r) => !L.near(r.find((x) => x.id === A0.id)?.data.x, A0.data.x, 0.01));
  let A = r.find((x) => x.id === A0.id);
  t.ok("drag moves it (50, 30 in picture px)", L.near(A.data.x - A0.data.x, 50, 1) && L.near(A.data.y - A0.data.y, 30, 1) && L.near(A.data.w, A0.data.w, 0.01), [A.data.x, A.data.y, A.data.w]);
  // undo / redo by keys
  await p.keyboard.press("Control+KeyZ");
  r = await until(pic, (r) => L.near(r.find((x) => x.id === A0.id)?.data.x, A0.data.x, 0.01));
  t.ok("Ctrl+Z puts it back", L.near(r.find((x) => x.id === A0.id)?.data.x, A0.data.x, 0.01), r.find((x) => x.id === A0.id)?.data.x);
  await p.keyboard.press("Control+Shift+KeyZ");
  r = await until(pic, (r) => L.near(r.find((x) => x.id === A0.id)?.data.x, A.data.x, 0.01));
  t.ok("Ctrl+Shift+Z redoes the move", L.near(r.find((x) => x.id === A0.id)?.data.x, A.data.x, 0.01));
  await p.click('.an-bar [data-act="undo"]');
  r = await until(pic, (r) => L.near(r.find((x) => x.id === A0.id)?.data.x, A0.data.x, 0.01));
  t.ok("the undo button", L.near(r.find((x) => x.id === A0.id)?.data.x, A0.data.x, 0.01));
  await p.keyboard.press("Control+KeyY");
  r = await until(pic, (r) => L.near(r.find((x) => x.id === A0.id)?.data.x, A.data.x, 0.01));
  t.ok("Ctrl+Y redoes too", L.near(r.find((x) => x.id === A0.id)?.data.x, A.data.x, 0.01));
  await p.click('.an-bar [data-act="undo"]');
  await p.click('.an-bar [data-act="redo"]');
  r = await until(pic, (r) => L.near(r.find((x) => x.id === A0.id)?.data.x, A.data.x, 0.01));
  t.ok("the redo button", L.near(r.find((x) => x.id === A0.id)?.data.x, A.data.x, 0.01));
  await p.keyboard.press("Control+Shift+KeyZ");
  await p.waitForTimeout(300);
  t.ok("nothing left to redo: says so", await p.$eval(".light .an-toast", (e) => e.classList.contains("on") && /Nothing to redo/.test(e.textContent)).catch(() => false));
  // resize by the south-east grip
  await click(150, 360);
  h = await handles();
  const s = (await L.mediaBox(p)).s;
  await p.mouse.move(h.se[0], h.se[1]); await p.mouse.down(); await p.mouse.move(h.se[0] + 100 * s, h.se[1] + 50 * s, { steps: 8 }); await p.mouse.up();
  r = await until(pic, (r) => r.find((x) => x.id === A0.id)?.data.w > A0.data.w + 50);
  let A2 = r.find((x) => x.id === A0.id);
  t.ok("the corner grip resizes (w + 100, h + 50, the top-left stays)", L.near(A2.data.w - A0.data.w, 100, 6) && L.near(A2.data.h - A0.data.h, 50, 6) && L.near(A2.data.x, A.data.x, 3) && L.near(A2.data.y, A.data.y, 3), [A2.data.x, A2.data.y, A2.data.w, A2.data.h]);
  // turn by the round handle: dragged to the box's right, level with its centre -> a quarter turn
  h = await handles();
  const cx = (h.nw[0] + h.se[0]) / 2, cy = (h.nw[1] + h.se[1]) / 2, arm = cy - h.rot[1];
  await p.mouse.move(h.rot[0], h.rot[1]); await p.mouse.down();
  await p.mouse.move(cx + arm * 0.7, cy - arm * 0.7, { steps: 6 }); await p.mouse.move(cx + arm, cy, { steps: 6 }); await p.mouse.up();
  r = await until(pic, (r) => Math.abs(r.find((x) => x.id === A0.id)?.data.rot || 0) > 1);
  const rot = r.find((x) => x.id === A0.id)?.data.rot;
  t.ok("the turn handle turns it (a quarter turn)", L.near(((rot % 360) + 360) % 360, 90, 3), rot);
  await p.keyboard.press("Control+KeyZ");
  r = await until(pic, (r) => !r.find((x) => x.id === A0.id)?.data.rot);
  t.eq("…undone", r.find((x) => x.id === A0.id)?.data.rot, 0);
  // nudge
  A = r.find((x) => x.id === A0.id);
  await p.keyboard.press("ArrowRight");
  await p.keyboard.press("Shift+ArrowDown");
  r = await until(pic, (r) => !L.near(r.find((x) => x.id === A0.id)?.data.y, A.data.y, 0.01));
  const An = r.find((x) => x.id === A0.id);
  t.ok("← → nudge 1 screen px, Shift 10 (in picture px: / scale)", L.near(An.data.x - A.data.x, 1 / s, 0.02) && L.near(An.data.y - A.data.y, 10 / s, 0.05), [An.data.x - A.data.x, An.data.y - A.data.y, 1 / s]);
  // Shift+click adds, Delete, undo brings both back (one step)
  await click(500, 330, ["Shift"]);
  t.eq("Shift+click adds to the selection (a box round both)", await selCount(), 2);
  await p.keyboard.press("Delete");
  r = await until(pic, (r) => r.length === 0);
  t.eq("Delete removes the selection", r.length, 0);
  await p.keyboard.press("Control+KeyZ");
  r = await until(pic, (r) => r.length === 2);
  t.eq("…one undo brings both back (same ids)", r.map((x) => x.id).sort(), [A0.id, B0.id].sort());
  // marquee, Ctrl+A
  await deselect();
  await drag([[950, 700], [60, 280]]);
  t.eq("a marquee on the empty picture selects what it touches", await selCount(), 2);
  await deselect();
  await p.keyboard.press("Control+KeyA");
  t.eq("Ctrl+A selects every drawing on screen", await selCount(), 2);
  // duplicate, copy / paste, cut / paste in place, bring forward
  await deselect();
  await click(500, 330);
  await p.keyboard.press("Control+KeyD");
  r = await until(pic, (r) => r.length === 3);
  const dup = r.find((x) => x.id !== A0.id && x.id !== B0.id);
  t.ok("Ctrl+D duplicates, 16 screen px down-right", !!dup && L.near(dup.data.x - B0.data.x, 16 / s, 0.05) && L.near(dup.data.y - B0.data.y, 16 / s, 0.05), dup && [dup.data.x - B0.data.x, 16 / s]);
  await p.keyboard.press("Control+KeyC");
  await p.keyboard.press("Control+KeyV");
  r = await until(pic, (r) => r.length === 4);
  const pasted = r.find((x) => ![A0.id, B0.id, dup.id].includes(x.id));
  t.ok("Ctrl+C, Ctrl+V: a copy 20 screen px on", !!pasted && L.near(pasted.data.x - dup.data.x, 20 / s, 0.05), pasted && [pasted.data.x - dup.data.x, 20 / s]);
  await p.keyboard.press("Control+KeyX");
  r = await until(pic, (r) => r.length === 3);
  t.ok("Ctrl+X cuts", !r.some((x) => x.id === pasted.id));
  await p.keyboard.press("Control+KeyV");
  r = await until(pic, (r) => r.length === 4);
  const back = r.find((x) => ![A0.id, B0.id, dup.id].includes(x.id));
  t.ok("…Ctrl+V after a cut pastes in place (a new id)", !!back && back.id !== pasted.id && L.near(back.data.x, pasted.data.x, 0.01) && L.near(back.data.y, pasted.data.y, 0.01), back && [back.data.x, pasted.data.x]);
  await deselect();
  await click(100 + (An.data.x - A0.data.x), 330 + (An.data.y - A0.data.y));
  const zTop = Math.max(...r.map((x) => x.z_index));
  await p.keyboard.press("Control+BracketRight");
  r = await until(pic, (r) => r.find((x) => x.id === A0.id)?.z_index > zTop);
  t.ok("Ctrl+] brings it above every drawing", r.find((x) => x.id === A0.id)?.z_index > zTop, r.map((x) => x.z_index));
  // the bin: Shift+Delete clears what is on screen; undo
  await deselect();
  await p.keyboard.press("Shift+Delete");
  r = await until(pic, (r) => r.length === 0);
  t.eq("Shift+Delete clears the drawings on screen", r.length, 0);
  await p.keyboard.press("Control+KeyZ");
  r = await until(pic, (r) => r.length === 4);
  t.eq("…undone in one step", r.length, 4);
  await p.click('.an-bar [data-act="clear"]');
  r = await until(pic, (r) => r.length === 0);
  t.eq("the bin button clears them too", r.length, 0);

  // ---- the eraser ---------------------------------------------------------------------------------------------------------
  await p.keyboard.press("KeyB");
  await drag([[100, 600], [1100, 600]], { steps: 100 });   // (points every 10 px: Partial cuts at a point)
  await drag([[100, 700], [1100, 700]], { steps: 100 });
  r = await until(pic, (r) => r.length === 2);
  const lo = r.find((x) => L.near(x.data.pts[1], 700, 2));
  await p.keyboard.press("KeyE");
  t.eq("the eraser starts in Object mode", await p.$eval('.an-props button[data-k="mode"].on', (b) => b.dataset.v).catch(() => null), "object");
  await drag([[600, 560], [600, 640]]);
  r = await until(pic, (r) => r.length === 1);
  t.eq("Object: a stroke touched is deleted whole", r.map((x) => x.id), [lo.id]);
  await p.click('.an-props button[data-k="mode"][data-v="partial"]');
  await drag([[600, 660], [600, 740]]);
  r = await until(pic, (r) => r.length === 2 && r.every((x) => { const xs = x.data.pts.filter((_, i) => i % 3 === 0); return Math.max(...xs) < 600 || Math.min(...xs) > 600; }));
  const halves = r.map((x) => [Math.min(...x.data.pts.filter((_, i) => i % 3 === 0)), Math.max(...x.data.pts.filter((_, i) => i % 3 === 0))]).sort((a, b) => a[0] - b[0]);
  t.ok("Partial: the stroke is cut in two where it was rubbed", r.length === 2 && halves[0][1] < 600 && halves[1][0] > 600, halves);
  await p.keyboard.press("Control+KeyZ");
  r = await until(pic, (r) => r.length === 1);
  t.eq("…undo makes it one stroke again", r.map((x) => x.id), [lo.id]);

  // ---- the eye ------------------------------------------------------------------------------------------------------------------
  const eye = () => p.evaluate(() => { const e = document.querySelector("#drawEyeBtn"); return { hidden: e.hidden, off: e.classList.contains("off"), pressed: e.getAttribute("aria-pressed") }; });
  t.eq("the eye shows while there are drawings", await eye(), { hidden: false, off: false, pressed: "false" });
  t.eq("…and they show", (await shownIds()).length, 1);
  await p.keyboard.press("Shift+KeyH");
  t.eq("Shift+H hides the drawings", [(await shownIds()).length, (await eye()).off, (await eye()).pressed], [0, true, "true"]);
  await p.click("#drawEyeBtn");
  t.eq("a click on the eye shows them again", [(await shownIds()).length, (await eye()).off], [1, false]);
  await p.keyboard.press("Escape"); await p.keyboard.press("Escape"); await p.keyboard.press("Escape");
  await L.lightGone(p);

  // ---- onion skin on a video ----------------------------------------------------------------------------------------------------------
  await L.openLight(p, clip);
  await L.waitMedia(p, "video");
  await p.evaluate(() => { const v = document.querySelector(".light video.view-media"); v.pause(); v.currentTime = 0; });
  await L.vsettled(p);
  await p.keyboard.press("KeyA");
  await p.waitForSelector(".an-top:not([hidden])");
  for (let i = 0; i < 10; i++) await p.keyboard.press("Period");
  await L.vsettled(p);
  await p.keyboard.press("KeyR");
  await drag([[30, 30], [120, 100]]);
  for (let i = 0; i < 20; i++) await p.keyboard.press("Period");
  await L.vsettled(p);
  await drag([[180, 130], [290, 210]]);
  r = await until(clip, (r) => r.length === 2);
  const f10 = r.find((x) => L.near(x.data.ctx?.t, 0.4, 0.001)), f30 = r.find((x) => L.near(x.data.ctx?.t, 1.2, 0.001));
  t.ok("drawings on frames 10 and 30", !!f10 && !!f30, r.map((x) => x.data.ctx));
  for (let i = 0; i < 10; i++) await p.keyboard.press("Comma");
  await L.vsettled(p);   // frame 20, half way
  let op = await opacities();
  t.eq("frame 20, onion skin off: neither shows", [op[f10.id], op[f30.id]], [0, 0]);
  await p.click("#drawEyeBtn", { button: "right" });
  await p.waitForTimeout(150);
  op = await opacities();
  t.ok("onion skin (the eye's right-click): half way, frame 10's ghost fading out, frame 30's in (0.5 each)", L.near(op[f10.id], 0.5, 0.02) && L.near(op[f30.id], 0.5, 0.02), op);
  t.ok("…the eye shows the onion", await p.$eval("#drawEyeBtn", (e) => e.classList.contains("onion")));
  t.eq("…kept (sight.annotate.onion)", await p.evaluate(() => JSON.parse(localStorage.getItem("sight.annotate.onion"))), true);
  for (let i = 0; i < 5; i++) await p.keyboard.press("Period");
  await L.vsettled(p);   // frame 25
  op = await opacities();
  t.ok("frame 25: frame 10's ghost at 0.25, frame 30's at 0.75", L.near(op[f10.id], 0.25, 0.02) && L.near(op[f30.id], 0.75, 0.02), op);
  for (let i = 0; i < 5; i++) await p.keyboard.press("Period");
  await L.vsettled(p);   // frame 30: its own drawing, the earlier one gone
  op = await opacities();
  t.eq("frame 30: its drawing in full, the earlier one gone", [op[f10.id], op[f30.id]], [0, 1]);
  await p.click("#drawEyeBtn", { button: "right" });
  await p.waitForTimeout(150);
  t.eq("right-click again: onion skin off", [await p.$eval("#drawEyeBtn", (e) => e.classList.contains("onion")), await p.evaluate(() => JSON.parse(localStorage.getItem("sight.annotate.onion")))], [false, false]);
  await p.keyboard.press("Escape"); await p.keyboard.press("Escape"); await p.keyboard.press("Escape");
  await L.lightGone(p);

  // ---- touch -----------------------------------------------------------------------------------------------------------------------------
  const tp = await L.newPage(t, cfg, { touch: true, mobile: false, label: "touch" });
  const tpic = id["u_touch.png"];
  await L.openLight(tp, tpic, { touch: true });
  await L.waitMedia(tp, "image");
  await tp.tap("#annoBtn");
  t.ok("touch: the annotate button enters the drawing mode", await tp.waitForSelector(".an-top:not([hidden])", { timeout: 5000 }).then(() => true, () => false));
  await tp.tap('.an-bar [data-tool="pencil"]');
  t.eq("touch: a tool by tap", await tool(tp), "pencil");
  const [t0x, t0y] = await toPageOn(tp, 200, 300), [t1x, t1y] = await toPageOn(tp, 700, 350);
  await L.touchDrag(tp, t0x, t0y, t1x, t1y, 12);
  await tp.waitForTimeout(100);
  r = await until(tpic, (r) => r.length === 1);
  t.ok("touch: a finger stroke is a pencil stroke where it was drawn", r.length === 1 && r[0].shape_kind === "pencil" && L.near(r[0].data.pts[0], 200, 3) && L.near(r[0].data.pts[1], 300, 3), r.map((x) => [x.shape_kind, x.data.pts.slice(0, 2)]));
  // (A tap within ~0.5 s of a finger stroke brings no click in this emulation: docs/PLAN.md, "Found by the R0-0
  // regression tests" 6. A person's next tap comes later than that.)
  await tp.waitForTimeout(700);
  await tp.tap('.an-bar [data-act="undo"]');
  r = await until(tpic, (r) => r.length === 0);
  t.eq("touch: undo by tap", r.length, 0);
  await tp.tap('.an-bar [data-act="redo"]');
  r = await until(tpic, (r) => r.length === 1);
  t.eq("touch: redo by tap", r.length, 1);
  const st0 = r[0];
  await tp.waitForTimeout(700);
  await tp.tap('.an-bar [data-tool="select"]');
  const sT = (await L.mediaBox(tp)).s;
  const [p0x, p0y] = await toPageOn(tp, st0.data.pts[3], st0.data.pts[4]);
  await L.touchDrag(tp, p0x, p0y, p0x + 60 * sT, p0y + 40 * sT, 10);
  r = await until(tpic, (r) => r.length === 1 && !L.near(r[0].data.pts[0], st0.data.pts[0], 0.5));
  t.ok("touch: the select tool drags a drawing with a finger (60, 40 picture px)", L.near(r[0].data.pts[0] - st0.data.pts[0], 60, 2) && L.near(r[0].data.pts[1] - st0.data.pts[1], 40, 2), r[0] && [r[0].data.pts[0] - st0.data.pts[0], r[0].data.pts[1] - st0.data.pts[1]]);
  await tp.waitForTimeout(700);
  await tp.tap("#drawEyeBtn");
  t.eq("touch: a tap on the eye hides the drawings", (await shownIds(tp)).length, 0);
  await tp.tap("#drawEyeBtn");
  t.eq("…and shows them", (await shownIds(tp)).length, 1);
  await tp.keyboard.press("Escape"); await tp.keyboard.press("Escape"); await tp.keyboard.press("Escape");
  await L.lightGone(tp);
  await L.openLight(tp, clip, { touch: true });
  await L.waitMedia(tp, "video");
  await tp.evaluate(() => document.querySelector(".light video.view-media").pause());
  const eb = await tp.$eval("#drawEyeBtn", (e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, e.hidden]; });
  t.ok("touch: the eye shows on a video with drawings, just watching", !eb[2]);
  await L.touchDrag(tp, eb[0], eb[1], eb[0], eb[1], 1, 700);
  await tp.waitForTimeout(150);
  t.ok("touch: a long press on the eye turns onion skin on", await tp.$eval("#drawEyeBtn", (e) => e.classList.contains("onion")));
  await L.touchDrag(tp, eb[0], eb[1], eb[0], eb[1], 1, 700);
  await tp.waitForTimeout(150);
  t.ok("…and off", !(await tp.$eval("#drawEyeBtn", (e) => e.classList.contains("onion"))));
});
