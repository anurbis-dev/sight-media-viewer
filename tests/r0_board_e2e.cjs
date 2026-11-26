// R0-0 block 5: a board's annotations and the library split beside a board, as they behave before R0
// (tests/test_r0_views.py). The board ("R0 board") holds b_pic1.png at (0, 0) and b_pic2.png at (480, 0), 400 x 300.
//   - the board's annotator: Shift+A and the top bar's button switch it on / off (an-on on #canvasView, its bar);
//     it starts with the brush;
//   - (page px are worked out from b_pic1's card, not from the annotation layer)
//   - a stroke is a board row (scope "board", board_id, no target asset) whose points are world units (the board's
//     own coordinates, where the items are), whatever the camera; the camera's pan / zoom moves the drawing with the
//     items, the mode on or off;
//   - while drawing, the board's item keys are held back (X / Delete delete no card); with it off, plain A frames
//     everything and leaves the annotator off;
//   - a note typed in the board's panel is a board row; the stroke drawn before it joins it (data.note);
//   - off again (Shift+A / Esc): the drawing stays shown, the bar goes;
//   - the board's panel button (#boardNotesBtn) shows / hides the notes panel;
//   - Ctrl+Z takes the last stroke back (its row deleted on the server), Ctrl+Shift+Z brings it again;
//   - the library split: a board opens with the library grid beside it (a card reachable on screen); Tab and the ◧
//     button hide it and show it again;
//   - touch (a touch laptop, no keyboard): the board opens by tap, the annotate button by tap, a finger stroke is a
//     board row (drawn after two fingers pan and pinch-zoom without drawing), the split button by tap.
"use strict";
const L = require("./r0_lib.cjs");

L.run(async (cfg, t) => {
  const bid = cfg.board;
  let p = await L.newPage(t, cfg);
  const boardRows = async () => (await L.api(cfg, "/api/annotations?board_id=" + bid)).filter((r) => r.kind !== "status");
  async function until(fn, ms = 6000, pg = p){
    const end = Date.now() + ms;
    let v;
    while (Date.now() < end){ v = await fn(); if (v) return v; await pg.waitForTimeout(100); }
    return v;
  }
  // world (board) units -> page px, from b_pic1's card (world (0, 0), 400 x 300) — not from the annotation layer's
  // own transform, which would turn any mapping it used back into the expected numbers
  const toPage = async (x, y, pg = p) => { const b = await itemBox(pg); return [b.x + x * b.w / 400, b.y + y * b.w / 400]; };
  // the first card's box on the page (the board's cards in their DOM order)
  const itemBox = (pg = p) => pg.evaluate(() => {
    const r = document.querySelector("#canvasView .citem").getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  const annOn = (pg = p) => pg.$eval("#canvasView", (v) => v.classList.contains("an-on"));
  const barShown = (pg = p) => pg.evaluate(() => !!document.querySelector("#canvasView .an-top:not([hidden])"));
  const tool = (pg = p) => pg.evaluate(() => document.querySelector("#canvasView .an-bar [data-tool].on")?.dataset.tool || null);
  const itemCount = (pg = p) => pg.$$eval("#canvasView .citem", (x) => x.length);
  // the drawn path's box on the page (the first stroke's element in the layer)
  const strokeBox = (pg = p) => pg.evaluate(() => {
    const e = document.querySelector("#canvasView .an-layer .an-doc [data-id]");
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  async function stroke(pts, pg = p){
    const [x0, y0] = await toPage(...pts[0], pg);
    await pg.mouse.move(x0, y0); await pg.mouse.down();
    for (const q of pts.slice(1)){ const [x, y] = await toPage(...q, pg); await pg.mouse.move(x, y, { steps: 6 }); }
    await pg.mouse.up();
    await pg.waitForTimeout(80);
  }

  // ---- open the board ----------------------------------------------------------------------------------------
  await p.click(`.board-row[data-bid="${bid}"]`);
  await p.waitForSelector("#canvasView .citem", { timeout: 10000 });
  t.eq("the board opens with its two cards", await itemCount(), 2);
  t.ok("…b_pic1's card first, b_pic2's 480 world units to its right", await p.evaluate(() => { const [a, b] = [...document.querySelectorAll("#canvasView .citem")].map((e) => e.getBoundingClientRect()); return a.left < b.left && Math.abs(b.left - a.left - 480 * a.width / 400) < 2; }));
  t.ok("the annotate button is in the top bar", await p.isVisible("#boardAnnoBtn"));
  const vr = await p.$eval("#canvasView .canvas-viewport", (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await p.mouse.move(vr.x + vr.w / 2, vr.y + vr.h - 40);   // (the board's keys follow the pane under the pointer)
  t.ok("the annotator is off at first", !(await annOn()));

  // ---- Shift+A on, a stroke ---------------------------------------------------------------------------------
  await p.keyboard.press("Shift+KeyA");
  t.ok("Shift+A switches the board's annotator on", await until(() => annOn()));
  t.ok("…its bar shows", await barShown());
  t.eq("…it starts with the brush", await tool(), "brush");
  t.ok("…the button shows it", await p.$eval("#boardAnnoBtn", (b) => b.classList.contains("on")));
  // (a camera other than the opening one — zoomed and moved — so world units and viewport px differ)
  await p.mouse.move(vr.x + vr.w / 2, vr.y + vr.h / 2);
  await p.mouse.wheel(0, 80);
  await p.keyboard.down("Control"); await p.mouse.wheel(0, -240); await p.keyboard.up("Control");
  await p.waitForTimeout(300);
  const ibz = await itemBox();
  t.ok("Ctrl+wheel zooms the board, the wheel pans it", Math.abs(ibz.w - 400) > 40 && Math.abs(ibz.y - vr.y) > 10, [ibz, vr]);
  await p.mouse.move(vr.x + vr.w / 2, vr.y + vr.h - 40);
  const S1 = [[100, 400], [200, 450], [300, 420]];
  await stroke(S1);
  let rs = await until(async () => { const r = await boardRows(); return r.length === 1 && r; });
  t.ok("a stroke is stored as one row", !!rs, (await boardRows()).length);
  if (rs){
    const r = rs[0];
    t.eq("…a board row", [r.scope, r.board_id, r.target_asset_id || null], ["board", bid, null]);
    const pts = r.data.pts || [];   // (flat: x, y, pressure, …)
    const first = pts.slice(0, 2), last = pts.slice(-3, -1);
    t.ok("…its points in world units (first)", !!first && L.near(first[0], 100, 3) && L.near(first[1], 400, 3), first);
    t.ok("…its points in world units (last)", !!last && L.near(last[0], 300, 3) && L.near(last[1], 420, 3), last);
  }
  // the camera: the drawing and the cards move together
  const ib0 = await itemBox(), sb0 = await strokeBox();
  await p.mouse.move(vr.x + vr.w / 2, vr.y + vr.h / 2);
  await p.mouse.wheel(0, 120);
  await p.waitForTimeout(300);
  const ib1 = await itemBox(), sb1 = await strokeBox();
  t.ok("the wheel moves the board", !!ib1 && Math.hypot(ib1.x - ib0.x, ib1.y - ib0.y) > 20, [ib0, ib1]);
  t.ok("…and the drawing with it", !!sb0 && !!sb1 && L.near(sb1.x - sb0.x, ib1.x - ib0.x, 2) && L.near(sb1.y - sb0.y, ib1.y - ib0.y, 2), [sb0, sb1, ib0, ib1]);
  rs = await boardRows();
  t.ok("…the row stays in world units", rs.length === 1 && L.near(rs[0].data.pts[0], 100, 3), rs.map((r) => r.data.pts.slice(0, 2)));
  // the item keys are held back while drawing
  await p.mouse.move(vr.x + vr.w / 2, vr.y + vr.h - 40);
  await p.keyboard.press("KeyX");
  await p.keyboard.press("Delete");
  await p.waitForTimeout(300);
  t.eq("X / Delete delete no card while annotating", await itemCount(), 2);
  t.eq("…and no card on the server", ((await L.api(cfg, `/api/boards/${bid}/full`)).items || []).length, 2);
  // undo / redo of the stroke
  await p.keyboard.press("Control+KeyZ");
  t.ok("Ctrl+Z takes the stroke back (its row deleted)", await until(async () => (await boardRows()).length === 0));
  await p.keyboard.press("Control+Shift+KeyZ");
  t.ok("Ctrl+Shift+Z brings it again", await until(async () => (await boardRows()).length === 1));
  // a note in the board's panel takes the stroke
  if (!(await p.isVisible("#canvasView .an-panel"))) await p.click("#boardNotesBtn");
  t.ok("the board's notes panel shows", await until(() => p.isVisible("#canvasView .an-panel")));
  await p.fill("#canvasView .an-panel .an-input", "Board note R0");
  await p.press("#canvasView .an-panel .an-input", "Enter");
  rs = await until(async () => { const r = await boardRows(); const n = r.find((x) => x.kind === "note"); return n && r.find((x) => x.kind !== "note")?.data.note === n.id && r; });
  t.ok("a note typed in the board's panel is a board row, the stroke joins it", !!rs, await boardRows());
  if (rs){
    const n = rs.find((x) => x.kind === "note");
    t.eq("…the note's row", [n.scope, n.board_id, n.data.text], ["board", bid, "Board note R0"]);
  }
  t.ok("…its card in the panel", await until(() => p.evaluate(() => /Board note R0/.test(document.querySelector("#canvasView .an-panel .an-list")?.textContent || ""))));
  await p.click("#boardNotesBtn");
  t.ok("the panel button hides the panel", await until(async () => !(await p.isVisible("#canvasView .an-panel"))));
  // off again: the drawing stays
  await p.mouse.move(vr.x + vr.w / 2, vr.y + vr.h - 40);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(150);
  if (await annOn()) await p.keyboard.press("Escape");
  t.ok("Esc switches the annotator off", await until(async () => !(await annOn())));
  t.ok("…its bar goes", !(await barShown()));
  t.ok("…the drawing stays on the board", !!(await strokeBox()));
  await p.click("#boardAnnoBtn");
  t.ok("the button switches it on", await until(() => annOn()));
  await p.click("#boardAnnoBtn");
  t.ok("…and off", await until(async () => !(await annOn())));
  // plain A frames everything (Shift+A is the annotator's)
  await p.mouse.move(vr.x + vr.w / 2, vr.y + vr.h / 2);
  await p.mouse.wheel(0, 300);
  await p.waitForTimeout(300);
  const ibp = await itemBox();
  await p.mouse.move(vr.x + vr.w / 2, vr.y + vr.h - 40);
  await p.keyboard.press("KeyA");
  const iba = await until(async () => { const b = await itemBox(); return Math.hypot(b.x - ibp.x, b.y - ibp.y) > 20 && b; }, 3000);
  t.ok("plain A frames everything (the cards move back into view)", !!iba && iba.y >= vr.y - 1 && iba.x >= vr.x - 1, [ibp, iba, vr]);
  t.ok("…and leaves the annotator off", !(await annOn()));
  // with the annotator off, X deletes the selected card again (the keys are the board's) — then undone
  await p.click("#canvasView .citem >> nth=1");
  await p.keyboard.press("KeyX");
  t.ok("with the annotator off X deletes the selected card", await until(async () => (await itemCount()) === 1));
  await p.keyboard.press("Control+KeyZ");
  t.ok("…Ctrl+Z brings it back", await until(async () => (await itemCount()) === 2));

  // ---- the library split beside the board -------------------------------------------------------------------
  const pic = cfg.ids["c_a.png"];
  const libShown = (pg = p) => pg.evaluate((sel) => { const c = document.querySelector(sel); if (!c) return false; c.scrollIntoView({ block: "nearest" }); const r = c.getBoundingClientRect(); return r.width > 0 && !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest(sel); }, `.card[data-id="${pic}"]`);
  // (a board opens with the library beside it: sight.layout's canvasSplit defaults to on)
  t.ok("the library shows beside the board at first", await until(() => libShown()));
  await p.mouse.move(vr.x + vr.w / 2, vr.y + vr.h - 40);
  await p.keyboard.press("Tab");
  t.ok("Tab hides the library (the board fills the pane)", await until(async () => !(await libShown())));
  t.ok("…the board stays", await p.isVisible("#canvasView .canvas-viewport"));
  await p.keyboard.press("Tab");
  t.ok("Tab again shows it", await until(() => libShown()));
  await p.click("#splitBtn");
  t.ok("the ◧ button hides it", await until(async () => !(await libShown())));
  await p.click("#splitBtn");
  t.ok("…and shows it", await until(() => libShown()));
  await p.context().close();

  // ---- touch ------------------------------------------------------------------------------------------------
  p = await L.newPage(t, cfg, { touch: true, mobile: false, label: "touch" });
  const n0 = (await boardRows()).length;
  await p.tap(`.board-row[data-bid="${bid}"]`);
  await p.waitForSelector("#canvasView .citem", { timeout: 10000 });
  await p.tap("#boardAnnoBtn");
  t.ok("touch: the annotate button by tap", await until(() => annOn()));
  // two fingers pan and pinch: the board moves and zooms, nothing is drawn (then the stroke is drawn on a camera
  // where world units and viewport px differ)
  const ib2 = await itemBox();
  const c = await p.$eval("#canvasView .canvas-viewport", (e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  const cdp = await p.context().newCDPSession(p);
  const two = (i) => [{ x: c[0] - 60 - i * 5 + i * 10, y: c[1], id: 1 }, { x: c[0] + 60 + i * 5 + i * 10, y: c[1], id: 2 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: two(0) });
  for (let i = 1; i <= 8; i++){ await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: two(i) }); await p.waitForTimeout(16); }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
  await p.waitForTimeout(500);
  const ib3 = await itemBox();
  t.ok("touch: two fingers pan and pinch-zoom the board", Math.abs(ib3.x - ib2.x) > 20 && ib3.w / ib2.w > 1.15, [ib2, ib3]);
  t.eq("…and draw nothing", (await boardRows()).length, n0);
  const a0 = await toPage(150, 600), a1 = await toPage(350, 650);
  await L.touchDrag(p, a0[0], a0[1], a1[0], a1[1], 10);
  rs = await until(async () => { const r = await boardRows(); return r.length === n0 + 1 && r; }, 6000);
  t.ok("touch: a finger stroke is a board row", !!rs, (await boardRows()).length);
  if (rs){
    const r = rs.find((x) => x.kind !== "note" && L.near((x.data.pts || [0, 0])[1], 600, 6));
    t.ok("…in world units", !!r && L.near(r.data.pts[0], 150, 6), rs.map((x) => (x.data.pts || []).slice(0, 2)));
  }
  await p.waitForTimeout(600);   // (a tap at once after the finger stroke brings no click: docs/PLAN.md "Found by the R0-0 regression tests" item 6)
  await p.tap("#boardAnnoBtn");
  t.ok("touch: the button switches it off", await until(async () => !(await annOn())));
  t.ok("touch: the library beside the board", await until(() => libShown()));
  await p.tap("#splitBtn");
  t.ok("touch: the ◧ button hides it", await until(async () => !(await libShown())));
  await p.tap("#splitBtn");
  t.ok("…and shows it", await until(() => libShown()));
  await p.context().close();
});
