// R0-0 block 5: compare (and its annotator), files dropped on the lightbox to compare, and the sequence, as they
// behave before R0 (tests/test_r0_views.py). Media: c_a.png (quadrants), c_b.png (red), c_c.png (green), 640 x 480;
// v_1.mp4 (2 s), v_2.mp4 (3 s).
//   - compare from the library: two cards selected (Ctrl+click), the top bar's Compare button and K open it with a
//     chip per file (name order); K / Esc close it;
//   - its controls by key and by button: the layouts 1-4 (the stage's lay-* class, the segment's button), Swipe (S),
//     Difference (D), a layer hidden (H, a chip click), ↑ / ↓ select a layer, F fits;
//   - annotating in compare: A on (its bar), a stroke on the selected layer is a row of that layer's file, a note
//     written there keeps the comparison (data.compare: the files, the selected one, the layout), A off; reopening
//     the comparison from the file (K in the lightbox) brings that session back (its layout);
//   - dropped to compare: in the lightbox with the library beside it (Tab), a card dragged onto the picture joins the
//     lightbox's set (the ⧉ button counts 2), the button opens the comparison of both;
//   - the sequence: two videos selected, the top bar's Sequence button opens the lightbox with the sequence bar (a
//     segment per clip, the title "Clip 1/2 · …"), → / ← and the bar's buttons move between clips, Shift+L and the
//     loop button toggle the loop, a click on the bar's track lands in the clip under it;
//   - touch (a touch laptop): a long press starts selecting, a tap adds, the touch bar's Compare and Play in sequence
//     open them; the compare's buttons by tap (a layout, close); the sequence's next button by tap.
"use strict";
const L = require("./r0_lib.cjs");

L.run(async (cfg, t) => {
  const id = cfg.ids, A = id["c_a.png"], B = id["c_b.png"], C3 = id["c_c.png"], V1 = id["v_1.mp4"], V2 = id["v_2.mp4"];
  let p = await L.newPage(t, cfg);
  async function until(fn, ms = 6000, pg = p){
    const end = Date.now() + ms;
    let v;
    while (Date.now() < end){ v = await fn(); if (v) return v; await pg.waitForTimeout(100); }
    return v;
  }
  const rowsOf = async (aid) => (await L.rows(cfg, aid)).filter((r) => r.kind !== "status");
  const cmpOpen = (pg = p) => pg.evaluate(() => !!document.querySelector(".cmp .cmp-stage"));
  const chips = (pg = p) => pg.$$eval(".cmp .cmp-chip", (x) => x.map((c) => ({ id: c.dataset.id, sel: c.classList.contains("sel"), off: c.classList.contains("off") })));
  const layout = (pg = p) => pg.$eval(".cmp .cmp-stage", (s) => (/\blay-(\w+)/.exec(s.className) || [])[1] || null);
  const segOn = (g, pg = p) => pg.evaluate((g) => [...document.querySelectorAll(`.cmp .cmp-seg[data-g="${g}"] button`)].filter((b) => b.classList.contains("on")).map((b) => b.dataset.v), g);
  const btnOn = (a, pg = p) => pg.$eval(`.cmp .cmp-bar [data-a="${a}"]`, (b) => b.classList.contains("on"));
  const select = async (ids) => {
    await p.click(`.card[data-id="${ids[0]}"]`);
    for (const x of ids.slice(1)) await p.click(`.card[data-id="${x}"]`, { modifiers: ["Control"] });
    await p.waitForTimeout(150);
  };
  const clearSel = async () => { await p.keyboard.press("Escape"); await p.waitForTimeout(100); };

  // ---- compare from the library -----------------------------------------------------------------------------
  t.ok("no Compare button with nothing selected", await p.$eval("#cmpSelBtn", (b) => b.hidden));
  await select([B, A]);
  t.ok("two pictures selected: the top bar's Compare button", await p.isVisible("#cmpSelBtn"));
  await p.click("#cmpSelBtn");
  t.ok("the Compare button opens the comparison", await until(() => cmpOpen()));
  t.eq("…a chip per file, in name order, the first selected", (await chips()).map((c) => [c.id, c.sel]), [[A, true], [B, false]]);
  t.eq("…Stack at first", await layout(), "stack");
  await p.keyboard.press("KeyK");
  t.ok("K closes it", await until(async () => !(await cmpOpen())));
  await p.mouse.move(700, 400);
  await p.keyboard.press("KeyK");
  t.ok("K opens it from the selection", await until(() => cmpOpen()));
  // layouts
  const lays = [];
  for (const k of ["Digit2", "Digit3", "Digit4", "Digit1"]){ await p.keyboard.press(k); await p.waitForTimeout(150); lays.push([await layout(), (await segOn("layout"))[0]]); }
  t.eq("1-4: Tile, Row, Column, Stack (the stage and the segment)", lays, [["grid", "grid"], ["row", "row"], ["col", "col"], ["stack", "stack"]]);
  await p.click('.cmp .cmp-seg[data-g="layout"] [data-v="row"]');
  t.eq("the Row button", await layout(), "row");
  await p.keyboard.press("KeyS");
  await p.waitForTimeout(150);
  t.eq("S on Row: still Row (Swipe is a Stack option)", await layout(), "row");
  await p.keyboard.press("Digit1");
  const sw0 = await btnOn("swipe");
  await p.keyboard.press("KeyS");
  t.ok("S toggles Swipe", await until(async () => (await btnOn("swipe")) !== sw0), [sw0]);
  await p.click('.cmp .cmp-bar [data-a="swipe"]');
  t.ok("…the Swipe button toggles it back", await until(async () => (await btnOn("swipe")) === sw0));
  await p.keyboard.press("KeyD");
  t.eq("D: Difference", await until(async () => { const v = await segOn("blend"); return v[0] === "difference" && v; }), ["difference"]);
  await p.click('.cmp .cmp-seg[data-g="blend"] [data-v="over"]');
  t.eq("…the Over button", await segOn("blend"), ["over"]);
  // layers
  await p.keyboard.press("ArrowDown");
  t.eq("↓ selects the next layer", (await chips()).map((c) => c.sel), [false, true]);
  await p.keyboard.press("ArrowUp");
  t.eq("↑ the previous one", (await chips()).map((c) => c.sel), [true, false]);
  await p.keyboard.press("KeyH");
  t.eq("H hides the selected layer", (await chips()).map((c) => c.off), [true, false]);
  await p.click(`.cmp .cmp-chip[data-id="${A}"]`);
  t.eq("…a click on its chip shows it again", (await chips()).map((c) => c.off), [false, false]);
  // annotating in compare
  await p.keyboard.press("KeyA");
  t.ok("A: annotating in compare (its bar)", await until(() => p.evaluate(() => !!document.querySelector(".cmp .an-top:not([hidden])"))));
  // c_a.png's picture px -> page px, from its own <img> (object-fit: contain), not from the annotation layer
  const toPage = (x, y) => p.evaluate(([x, y, aid]) => {
    const m = [...document.querySelectorAll(".cmp img")].find((i) => (i.currentSrc || i.src).includes(aid) && i.getBoundingClientRect().width > 0);
    const r = m.getBoundingClientRect(), s = Math.min(r.width / m.naturalWidth, r.height / m.naturalHeight);
    return [r.left + (r.width - m.naturalWidth * s) / 2 + x * s, r.top + (r.height - m.naturalHeight * s) / 2 + y * s];
  }, [x, y, A]);
  const [x0, y0] = await toPage(100, 100), [x1, y1] = await toPage(300, 200);
  await p.mouse.move(x0, y0); await p.mouse.down(); await p.mouse.move(x1, y1, { steps: 8 }); await p.mouse.up();
  let ra = await until(async () => { const r = await rowsOf(A); return r.length === 1 && r; });
  t.ok("a stroke in compare is a row of the selected layer's file", !!ra, (await rowsOf(A)).length);
  if (ra) t.ok("…in its picture px", L.near(ra[0].data.pts[0], 100, 3) && L.near(ra[0].data.pts[1], 100, 3), ra[0].data.pts.slice(0, 2));
  t.eq("…none on the other file", (await rowsOf(B)).length, 0);
  if (!(await p.isVisible(".cmp .an-panel"))) await p.keyboard.press("KeyC");
  await p.waitForSelector(".cmp .an-panel .an-input", { state: "visible", timeout: 5000 });
  await p.fill(".cmp .an-panel .an-input", "Compare note R0");
  await p.press(".cmp .an-panel .an-input", "Enter");
  ra = await until(async () => { const r = await rowsOf(A); return r.find((x) => x.kind === "note") && r; });
  const note = ra && ra.find((x) => x.kind === "note");
  t.ok("a note written in compare is the selected file's note", !!note, await rowsOf(A));
  if (note){
    const c = note.data.compare || {};
    // (Stack with Swipe on — the default — is written "swipe", FORMAT.md `compare`)
    t.eq("…it keeps the comparison (files, selected, layout)", [c.ids, c.sel, c.layout, c.blend], [[A, B], A, "swipe", "over"]);
  }
  await p.keyboard.press("Escape");
  await p.waitForTimeout(100);
  if (await p.evaluate(() => !!document.querySelector(".cmp .an-top:not([hidden])"))) await p.keyboard.press("KeyA");
  t.ok("A / Esc: annotating off, the comparison stays", await until(async () => !(await p.evaluate(() => !!document.querySelector(".cmp .an-top:not([hidden])")))) && await cmpOpen());
  await p.click('.cmp .cmp-bar [data-a="close"][aria-label="Close"]');
  t.ok("the ✕ button closes it", await until(async () => !(await cmpOpen())));
  // the session comes back from the file
  await clearSel();
  await L.openLight(p, A);
  await L.waitMedia(p, "image");
  await p.keyboard.press("KeyK");
  t.ok("K in the lightbox reopens the comparison its note was written in", await until(() => cmpOpen()));
  t.eq("…with its files", (await chips()).map((c) => c.id), [A, B]);
  await p.keyboard.press("Escape");
  await until(async () => !(await cmpOpen()));

  // ---- files dropped on the lightbox to compare -------------------------------------------------------------
  await L.openLight(p, C3).catch(() => {});
  if ((await L.lightTitle(p)) !== "c_c.png"){ await p.keyboard.press("Escape"); await L.lightGone(p); await L.openLight(p, C3); }
  await L.waitMedia(p, "image");
  t.eq("the lightbox shows c_c.png", await L.lightTitle(p), "c_c.png");
  t.ok("…its ⧉ button is there but has nothing to compare yet", await p.$eval("#cmpBtn", (b) => !b.hidden && (b.disabled || !b.dataset.n)));
  await p.keyboard.press("Tab");
  const libShown = (aid) => p.evaluate((sel) => { const c = document.querySelector(sel); if (!c) return false; c.scrollIntoView({ block: "nearest" }); const r = c.getBoundingClientRect(); return r.width > 0 && !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest(sel); }, `.card[data-id="${aid}"]`);
  t.ok("Tab: the library beside the lightbox", await until(() => libShown(B)));
  await p.waitForTimeout(500);
  const cb = await p.locator(`.card[data-id="${B}"]`).boundingBox();
  const mb = async () => L.mediaBox(p);
  await p.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2); await p.mouse.down();
  let m = await mb();
  await p.mouse.move(m.left + m.width / 2, m.top + m.height / 2, { steps: 8 });
  await p.waitForTimeout(150);
  m = await mb();
  await p.mouse.move(m.left + m.width / 2 + 2, m.top + m.height / 2, { steps: 2 });
  await p.mouse.up();
  t.eq("a card dropped on the picture joins the set (the ⧉ button counts 2)", await until(() => p.$eval("#cmpBtn", (b) => b.dataset.n || null)), "2");
  t.eq("…no drawing is made of it", (await rowsOf(C3)).length, 0);
  await p.click("#cmpBtn");
  t.ok("the ⧉ button opens the comparison", await until(() => cmpOpen()));
  t.eq("…of the open file and the dropped one", (await chips()).map((c) => c.id).sort(), [B, C3].sort());
  await p.keyboard.press("Escape");
  await until(async () => !(await cmpOpen()));
  await p.keyboard.press("Escape"); await p.keyboard.press("Escape");
  await L.lightGone(p);

  // ---- the sequence -----------------------------------------------------------------------------------------
  await clearSel();
  t.ok("no Sequence button with one video", await p.$eval("#seqBtn", (b) => b.hidden));
  await select([V1, V2]);
  t.ok("two videos selected: the Sequence button", await p.isVisible("#seqBtn"));
  await p.click("#seqBtn");
  await p.waitForSelector(".light.on .seqbar:not([hidden])", { timeout: 10000 });
  await L.waitMedia(p, "video");
  const seq = () => p.evaluate(() => {
    const b = document.querySelector(".light .seqbar");
    return { title: document.querySelector(".light .light-bar .t").textContent, segs: [...b.querySelectorAll(".seq-seg")].map((s) => s.textContent.trim()),
      cur: [...b.querySelectorAll(".seq-seg")].findIndex((s) => s.classList.contains("cur")), loop: b.querySelector("[data-seq=loop]").classList.contains("on") };
  });
  let s = await seq();
  t.eq("the sequence bar: a segment per clip", s.segs, ["v_1.mp4", "v_2.mp4"]);
  t.eq("…the title names the clip", s.title, "Clip 1/2 · v_1.mp4");
  await p.mouse.move(700, 300);
  await p.keyboard.press("ArrowRight");
  t.ok("→: the next clip", await until(async () => /^Clip 2\/2 · v_2\.mp4$/.test((await seq()).title)), (await seq()).title);
  t.eq("…its segment is current", (await seq()).cur, 1);
  await p.keyboard.press("ArrowLeft");
  t.ok("←: back to the first", await until(async () => /^Clip 1\/2/.test((await seq()).title)), (await seq()).title);
  await p.click('.light .seqbar [data-seq="next"]');
  t.ok("the ⏭ button: the next clip", await until(async () => /^Clip 2\/2/.test((await seq()).title)));
  await p.click('.light .seqbar [data-seq="prev"]');
  t.ok("the ⏮ button: the previous one", await until(async () => /^Clip 1\/2/.test((await seq()).title)));
  await p.keyboard.press("Shift+KeyL");
  t.ok("Shift+L: the sequence loops", await until(async () => (await seq()).loop));
  await p.click('.light .seqbar [data-seq="loop"]');
  t.ok("…the loop button turns it off", await until(async () => !(await seq()).loop));
  const tr = await p.locator(".light .seqbar .seq-track").boundingBox();
  await p.mouse.click(tr.x + tr.width * 0.8, tr.y + tr.height / 2);   // (2 s + 3 s: 80 % is 4 s, in clip 2)
  t.ok("a click on the track lands in the clip under it", await until(async () => /^Clip 2\/2/.test((await seq()).title)), (await seq()).title);
  await p.keyboard.press("Escape"); await p.keyboard.press("Escape");
  await L.lightGone(p);
  await p.context().close();

  // ---- touch ------------------------------------------------------------------------------------------------
  p = await L.newPage(t, cfg, { touch: true, mobile: false, label: "touch" });
  const longPress = async (aid) => {
    const r = await p.locator(`.card[data-id="${aid}"]`).boundingBox();
    await L.touchDrag(p, r.x + r.width / 2, r.y + r.height / 2, r.x + r.width / 2, r.y + r.height / 2, 1, 700);
    await p.waitForTimeout(200);
  };
  await longPress(A);
  t.ok("touch: a long press starts selecting (the touch bar)", await until(() => p.isVisible("#touchSelBar")));
  await p.tap(`.card[data-id="${B}"]`);
  t.ok("…a tap adds: Compare in the touch bar", await until(() => p.isVisible("#tsCmp")));
  await p.tap("#tsCmp");
  t.ok("touch: Compare opens the comparison", await until(() => cmpOpen()));
  await p.tap('.cmp .cmp-seg[data-g="layout"] [data-v="grid"]');
  t.eq("touch: a layout by tap", await layout(), "grid");
  await p.tap('.cmp .cmp-bar [data-a="close"][aria-label="Close"]');
  t.ok("touch: ✕ closes it", await until(async () => !(await cmpOpen())));
  if (await p.isVisible("#touchSelBar")) await p.tap("#touchSelBar button:last-of-type").catch(() => {});
  await p.waitForTimeout(200);
  await longPress(V1);
  await p.tap(`.card[data-id="${V2}"]`);
  t.ok("touch: two videos: Play in sequence", await until(() => p.isVisible("#tsSeq")));
  await p.tap("#tsSeq");
  t.ok("touch: the sequence opens", !!(await p.waitForSelector(".light.on .seqbar:not([hidden])", { timeout: 10000 }).catch(() => null)));
  await p.tap('.light .seqbar [data-seq="next"]');
  t.ok("touch: ⏭ by tap", await until(async () => /^Clip 2\/2/.test(await L.lightTitle(p))), await L.lightTitle(p));
  await p.context().close();
});
