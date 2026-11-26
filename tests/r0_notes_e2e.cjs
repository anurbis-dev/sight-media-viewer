// R0-0 block 2: notes and the review state, as they behave before R0 (tests/test_r0_annotate.py).
//   - the reviewer name set in the You panel (the review panel's person button) -> stored (sight.reviewer, also on
//     the server), shown on the button; it signs notes, replies, state events and the review state;
//   - a picture (n_pic.png): a note with a drawing, a text-only note (Add), an empty Add refused; reply, reply
//     edited, note edited (pencil and double-click), In progress / Resolve / Reopen (each an event in the thread),
//     reply deleted (a tombstone), the filters (counts, what they list, kept as sight.annotate.filter), the review
//     state (its history, cleared), the clean picture after a note, a pick showing only its drawings (and again:
//     let go), the panel on / off (C, the notes button; it stays open while just watching), delete a note (its
//     drawings go too);
//   - a video (n_clip.mp4): notes on frames 25 and 60, their marks on the timeline, the card's frame label, a pick
//     goes to the note's frame (drawing and just watching);
//   - touch (a touch laptop): the notes button, a card's Resolve, a pick by tap.
"use strict";
const L = require("./r0_lib.cjs");

const NAME = "Rita Reviewer";

L.run(async (cfg, t) => {
  const id = cfg.ids, p = await L.newPage(t, cfg);
  const pic = id["n_pic.png"], clip = id["n_clip.mp4"];
  // Polls the server until fn(rows) is true (the write queue's debounce), then returns the rows.
  async function until(aid, fn, ms = 5000){
    const end = Date.now() + ms;
    let r = [];
    while (Date.now() < end){ r = await L.rows(cfg, aid); if (fn(r)) return r; await p.waitForTimeout(100); }
    return r;
  }
  const notes = (r) => r.filter((x) => x.kind === "note");
  const byText = (r, s) => notes(r).find((n) => n.data.text === s);
  const card = (text) => p.locator(".an-panel .an-note", { has: p.locator(".an-nt", { hasText: text }) });
  const cardId = async (text) => (await card(text).first().getAttribute("data-id"));
  const toPage = (x, y) => p.evaluate(([x, y]) => {
    const s = document.querySelector(".light .an-layer .an-doc"), pt = s.createSVGPoint();
    pt.x = x; pt.y = y;
    const q = pt.matrixTransform(s.getScreenCTM());
    return [q.x, q.y];
  }, [x, y]);
  async function drag(pts){
    const P = [];
    for (const [x, y] of pts) P.push(await toPage(x, y));
    await p.mouse.move(P[0][0], P[0][1]); await p.mouse.down();
    for (let i = 1; i < P.length; i++) await p.mouse.move(P[i][0], P[i][1], { steps: 6 });
    await p.mouse.up();
    await p.waitForTimeout(60);
  }
  // Which drawings (row ids) the layer shows now.
  const shown = () => p.$$eval(".light .an-layer .an-doc g[data-id]", (gs) => gs.filter((g) => g.style.display !== "none").map((g) => g.dataset.id).sort());
  const panelOn = () => p.$eval(".light .an-panel", (e) => !e.hidden).catch(() => false);
  // A card's buttons show on hover (a touch screen shows them always): the pointer goes to the card first.
  async function cardBtn(sel){
    await p.locator(".an-panel .an-rep, .an-panel .an-note", { has: p.locator(sel) }).last().hover();   // (a reply's: on the reply)
    await p.locator(".an-panel " + sel).click();
  }
  const typeNote = async (text) => { await p.click(".an-panel .an-input"); await p.keyboard.type(text); };

  // ---- the reviewer name ----------------------------------------------------------------------------------
  await L.openLight(p, pic);
  await L.waitMedia(p, "image");
  await p.keyboard.press("KeyA");
  await p.waitForSelector(".an-top:not([hidden])");
  if (!(await panelOn())) await p.keyboard.press("KeyC");
  t.ok("the review panel opens (C)", await panelOn());
  t.ok("no notes yet: the hint", /No notes yet/.test(await p.$eval(".an-panel .an-list", (e) => e.textContent)));
  await p.click(".an-panel .an-user");
  await p.waitForSelector("#userPop:not([hidden]) #userName");
  await p.fill("#userName", NAME);
  await p.keyboard.press("Enter");
  t.ok("the You panel closes on Enter", await p.$eval("#userPop", (e) => e.hidden));
  t.eq("reviewer name stored (sight.reviewer)", await p.evaluate(() => localStorage.getItem("sight.reviewer")), NAME);
  t.eq("…the person button shows the initials", (await p.$eval(".an-panel .an-user", (b) => b.textContent)).trim(), "RR");
  await p.waitForTimeout(1500);   // (the settings push is debounced)
  t.eq("…and the server keeps it (settings ui)", ((await L.api(cfg, "/api/settings")).ui || {})["sight.reviewer"], NAME);

  // ---- notes on a picture ----------------------------------------------------------------------------------
  await p.keyboard.press("KeyR");
  await drag([[200, 200], [500, 400]]);
  await typeNote("first note");
  t.ok("typing a note: the composer shows its drawing count", /\+1 drawing/.test(await p.$eval(".an-panel .an-ctx", (e) => e.textContent)), await p.$eval(".an-panel .an-ctx", (e) => e.textContent));
  await p.keyboard.press("Enter");
  let r = await until(pic, (r) => notes(r).length === 1 && r.some((x) => x.kind === "shape" && x.data.note));
  const n1 = byText(r, "first note"), rect = r.find((x) => x.kind === "shape");
  t.ok("Enter adds the note", !!n1, notes(r).map((n) => n.data.text));
  t.eq("…signed with the reviewer name, open, no frame on a picture", n1 && [n1.data.author, n1.data.status, n1.data.ctx], [NAME, "open", null]);
  t.eq("…its drawing belongs to it", rect && rect.data.note, n1 && n1.id);
  t.eq("…the composer is empty again", await p.$eval(".an-panel .an-input", (e) => e.value), "");
  t.ok("…the card shows the author", (await card("first note").locator(".an-nwho").textContent()).startsWith(NAME + " · "));
  t.eq("…the notes button counts it", await p.$eval("#notesBtn .an-badge", (b) => b.textContent), "1");
  t.eq("…the picture is clean after the note (its drawing is on its card)", await shown(), []);
  await p.click(".an-panel [data-act=add]");
  await p.waitForTimeout(400);
  t.eq("Add with nothing typed or drawn makes no note", notes(await L.rows(cfg, pic)).length, 1);
  t.ok("…and says so", await p.$eval(".light .an-toast", (e) => e.classList.contains("on") && /Type a note, draw, or take a screenshot first/.test(e.textContent)).catch(() => false));
  // undo of adding a note: the note goes, its words come back into the composer (composerBack), redo adds it again
  await typeNote("undone note");
  await p.keyboard.press("Enter");
  await until(pic, (r) => notes(r).length === 2);
  await p.keyboard.press("Control+KeyZ");
  r = await until(pic, (r) => notes(r).length === 1);
  t.eq("Ctrl+Z after adding a note removes it", notes(r).map((n) => n.data.text), ["first note"]);
  t.eq("…and puts its words back into the composer", await p.$eval(".an-panel .an-input", (e) => e.value), "undone note");
  await p.$eval(".an-panel .an-input", (e) => { e.value = ""; e.blur(); });
  await p.keyboard.press("Control+Shift+KeyZ");
  r = await until(pic, (r) => notes(r).length === 2);
  t.eq("…Ctrl+Shift+Z adds it again", notes(r).map((n) => n.data.text).sort(), ["first note", "undone note"]);
  await p.keyboard.press("Control+KeyZ");
  r = await until(pic, (r) => notes(r).length === 1);
  await p.$eval(".an-panel .an-input", (e) => { e.value = ""; e.dispatchEvent(new Event("input")); e.blur(); });
  await typeNote("second note");
  await p.click(".an-panel [data-act=add]");
  r = await until(pic, (r) => notes(r).length === 2);
  t.eq("the Add button adds a text-only note", byText(r, "second note")?.data.author, NAME);
  t.eq("cards are numbered in order", await p.$$eval(".an-panel .an-note .an-nn", (e) => e.map((x) => x.textContent)), ["1", "2"]);

  // ---- pick: only its drawings; again: let go ---------------------------------------------------------------
  await card("first note").locator(".an-nt").click();
  t.ok("a click on a card picks the note", await card("first note").evaluate((c) => c.classList.contains("on")));
  t.eq("…the picture shows its drawing", await shown(), [rect.id]);
  await card("first note").locator(".an-nt").click({ delay: 0 });
  await p.waitForTimeout(400);   // (not a double-click)
  t.ok("a second click lets it go", !(await card("first note").evaluate((c) => c.classList.contains("on"))));
  await card("second note").locator(".an-nt").click();
  t.eq("picking a note without drawings shows none", await shown(), []);
  await p.keyboard.press("Escape");   // lets go of the pick
  await p.waitForTimeout(200);

  // ---- reply, edit, states ----------------------------------------------------------------------------------
  const id1 = await cardId("first note");
  await cardBtn(`[data-reply="${id1}"]`);
  await p.waitForSelector(".an-panel .an-redit");
  await p.keyboard.type("a reply");
  await p.keyboard.press("Enter");
  r = await until(pic, (r) => (byText(r, "first note")?.data.replies || []).length === 1);
  let reps = byText(r, "first note")?.data.replies || [];
  t.eq("reply: stored with the reviewer name", reps.map((x) => [x.text, x.author]), [["a reply", NAME]]);
  t.ok("…shown under the note", /a reply/.test(await card("first note").locator(".an-replies").textContent()));
  await card("first note").locator(".an-rt").dblclick();
  await p.waitForSelector(".an-panel .an-redit");
  await p.fill(".an-panel .an-redit", "a reply, edited");
  await p.keyboard.press("Enter");
  r = await until(pic, (r) => (byText(r, "first note")?.data.replies || [])[0]?.text === "a reply, edited");
  reps = byText(r, "first note")?.data.replies || [];
  t.ok("reply edited (double-click): new text, marked edited", reps[0]?.text === "a reply, edited" && reps[0]?.edited > 0, reps);
  t.ok("…the card says edited", /· edited/.test(await card("first note").locator(".an-rep .an-rh").first().textContent()));
  await cardBtn(`[data-edit="${id1}"]`);
  await p.waitForSelector(".an-panel .an-nedit");
  await p.fill(".an-panel .an-nedit", "first note, edited");
  await p.keyboard.press("Enter");
  r = await until(pic, (r) => !!byText(r, "first note, edited"));
  t.ok("note edited (pencil): new text, edited_at set", byText(r, "first note, edited")?.data.edited_at > 0, notes(r).map((n) => n.data.text));
  await card("second note").locator(".an-nt").dblclick();
  await p.waitForSelector(".an-panel .an-nedit");
  await p.fill(".an-panel .an-nedit", "second note, edited");
  await p.keyboard.press("Enter");
  r = await until(pic, (r) => !!byText(r, "second note, edited"));
  t.ok("note edited (double-click)", !!byText(r, "second note, edited"));
  const id2 = byText(r, "second note, edited").id;
  await p.keyboard.press("Escape");

  await cardBtn(`[data-prog="${id1}"]`);
  r = await until(pic, (r) => byText(r, "first note, edited")?.data.status === "progress");
  let d1 = byText(r, "first note, edited").data;
  t.eq("In progress: the state", d1.status, "progress");
  t.eq("…an event in the thread, signed", d1.replies.filter((x) => x.event).map((x) => [x.event, x.author]), [["progress", NAME]]);
  t.ok("…the card is marked", await card("first note").evaluate((c) => c.classList.contains("prog")));
  await cardBtn(`[data-done="${id1}"]`);
  r = await until(pic, (r) => byText(r, "first note, edited")?.data.status === "done");
  d1 = byText(r, "first note, edited").data;
  t.eq("Resolve: done, a second event", d1.replies.filter((x) => x.event).map((x) => x.event), ["progress", "done"]);
  t.ok("…the thread shows who resolved it", (await card("first note").locator(".an-rev.done").textContent()).includes("Resolved by " + NAME));
  // ---- filters -------------------------------------------------------------------------------------------------
  const counts = () => p.$$eval(".an-panel .an-filt [data-filt]", (bs) => Object.fromEntries(bs.map((b) => [b.dataset.filt, b.querySelector(".an-fc").textContent])));
  t.eq("filter counts", await counts(), { all: "2", open: "1", progress: "0", done: "1" });
  const listed = () => p.$$eval(".an-panel .an-list .an-note .an-nt", (e) => e.map((x) => x.textContent));
  await p.click('.an-panel .an-filt [data-filt="done"]');
  t.eq("Resolved lists the resolved note", await listed(), ["first note, edited"]);
  await p.click('.an-panel .an-filt [data-filt="open"]');
  t.eq("Open lists the open one", await listed(), ["second note, edited"]);
  await p.click('.an-panel .an-filt [data-filt="progress"]');
  t.ok("In progress: none, and says so", (await listed()).length === 0 && /No in-progress notes/.test(await p.$eval(".an-panel .an-list", (e) => e.textContent)));
  t.eq("the filter is kept (sight.annotate.filter)", await p.evaluate(() => JSON.parse(localStorage.getItem("sight.annotate.filter"))), "progress");
  await p.click('.an-panel .an-filt [data-filt="all"]');
  t.eq("All lists both", (await listed()).length, 2);
  await cardBtn(`[data-done="${id1}"]`);
  r = await until(pic, (r) => byText(r, "first note, edited")?.data.status === "open");
  d1 = byText(r, "first note, edited").data;
  t.eq("Reopen: open again, an event 'open'", [d1.status, d1.replies.filter((x) => x.event).map((x) => x.event)], ["open", ["progress", "done", "open"]]);
  t.ok("…the thread says Reopened by", (await card("first note").locator(".an-rev").last().textContent()).includes("Reopened by " + NAME));
  // ---- reply deleted: a tombstone ------------------------------------------------------------------------------
  const rid = reps[0].id;
  await cardBtn(`[data-rdel="${rid}"]`);
  r = await until(pic, (r) => (byText(r, "first note, edited")?.data.replies || []).some((x) => x.id === rid && x.deleted));
  const tomb = (byText(r, "first note, edited")?.data.replies || []).find((x) => x.id === rid);
  t.ok("reply deleted: kept as a tombstone (id, created, deleted; no text)", tomb && tomb.deleted > 0 && !("text" in tomb) && tomb.created > 0, tomb);
  t.ok("…gone from the card", !/a reply, edited/.test(await card("first note").textContent()));

  // ---- the review state ------------------------------------------------------------------------------------------
  const statusRow = async () => (await L.rows(cfg, pic)).filter((x) => x.kind === "status").sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))[0];
  const stateIs = async (want, n) => { const end = Date.now() + 5000; let st; while (Date.now() < end){ st = await statusRow(); if (st && st.data.state === want && (st.data.history || []).length === n) break; await p.waitForTimeout(100); } await p.waitForTimeout(150); return st; };
  await p.click('.an-panel [data-rs="changes"]');
  let st = await stateIs("changes", 1);
  t.eq("review state Changes: stored", st && st.data.state, "changes");
  t.eq("…its history signed", st && (st.data.history || []).map((h) => [h.state, h.author]), [["changes", NAME]]);
  t.ok("…the switch shows it", await p.$eval('.an-panel [data-rs="changes"]', (b) => b.classList.contains("on")));
  t.ok("…the line under it says who", /^Changes requested by Rita Reviewer · /.test(await p.$eval(".an-panel .an-rsh", (e) => e.textContent)), await p.$eval(".an-panel .an-rsh", (e) => e.textContent));
  await p.click('.an-panel [data-rs="approved"]');
  st = await stateIs("approved", 2);
  t.eq("Approved: a second history entry", st && (st.data.history || []).map((h) => h.state), ["changes", "approved"]);
  t.ok("…History (2) offered", /History \(2\)/.test(await p.$eval(".an-panel .an-rsh", (e) => e.textContent)));
  await p.click(".an-panel .an-rsh-more");
  t.eq("…which lists both, newest first", await p.$$eval(".an-panel .an-rsh > div", (e) => e.map((x) => x.textContent.split(" by ")[0])), ["Approved", "Changes requested"]);
  await p.click('.an-panel [data-rs=""]');
  st = await stateIs(null, 3);
  t.eq("— clears it (state null, a third history entry)", st && [st.data.state, (st.data.history || []).length], [null, 3]);

  // ---- the panel on / off ------------------------------------------------------------------------------------------
  await p.keyboard.press("KeyC");
  t.ok("C hides the panel", !(await panelOn()));
  await p.click("#notesBtn");
  t.ok("the notes button shows it", await panelOn());
  t.ok("…and is marked on", await p.$eval("#notesBtn", (b) => b.classList.contains("on") && b.getAttribute("aria-pressed") === "true"));
  await p.keyboard.press("KeyA");   // leave the drawing mode
  await p.waitForTimeout(200);
  t.ok("leaving the drawing mode keeps the panel (reading)", await panelOn() && await p.$eval(".light .an-panel", (e) => e.classList.contains("an-read")));
  t.eq("just watching, every note's drawing shows", await shown(), [rect.id]);
  await card("second note").locator(".an-nt").click();
  t.eq("…a pick narrows it (to none here)", await shown(), []);
  await p.click("#notesBtn");
  t.ok("closing the panel while watching lets go of the pick", !(await panelOn()) && (await shown()).length === 1);
  await p.click("#notesBtn");
  await p.keyboard.press("KeyA");
  await p.waitForSelector(".an-top:not([hidden])");

  // ---- delete a note: its drawings go too --------------------------------------------------------------------------
  await cardBtn(`[data-del="${id2}"]`);
  r = await until(pic, (r) => notes(r).length === 1);
  t.eq("delete the text-only note", notes(r).map((n) => n.data.text), ["first note, edited"]);
  await cardBtn(`[data-del="${id1}"]`);
  r = await until(pic, (r) => !r.some((x) => x.kind !== "status"));
  t.eq("delete the first note: the note and its drawing are gone", r.filter((x) => x.kind !== "status").length, 0);
  t.ok("…the badge is cleared", await p.$eval("#notesBtn .an-badge", (b) => b.hidden));
  await p.keyboard.press("Escape"); await p.keyboard.press("Escape");
  await L.lightGone(p);

  // ---- a video: notes on frames -------------------------------------------------------------------------------------
  await L.openLight(p, clip);
  await L.waitMedia(p, "video");
  await p.evaluate(() => { const v = document.querySelector(".light video.view-media"); v.pause(); v.currentTime = 0; });
  await L.vsettled(p);
  await p.keyboard.press("KeyA");
  await p.waitForSelector(".an-top:not([hidden])");
  if (!(await panelOn())) await p.keyboard.press("KeyC");
  for (let i = 0; i < 25; i++) await p.keyboard.press("Period");
  await L.vsettled(p);
  await p.keyboard.press("KeyR");
  await drag([[40, 40], [160, 120]]);
  await typeNote("on 25"); await p.keyboard.press("Enter");
  await until(clip, (r) => notes(r).length === 1);
  for (let i = 0; i < 35; i++) await p.keyboard.press("Period");
  await L.vsettled(p);
  await p.keyboard.press("KeyB");
  await drag([[60, 180], [260, 190]]);
  await typeNote("on 60"); await p.keyboard.press("Enter");
  r = await until(clip, (r) => notes(r).length === 2 && r.filter((x) => x.kind !== "note" && x.data.note).length === 2);
  const vn = (s) => byText(r, s), dOf = (s) => r.find((x) => x.kind !== "note" && x.data.note === vn(s)?.id);
  t.eq("video notes: on the frame they were written (ctx.t)", [vn("on 25")?.data.ctx?.t, vn("on 60")?.data.ctx?.t], [1, 2.4]);
  t.eq("…their drawings on the same frames", [dOf("on 25")?.data.ctx?.t, dOf("on 60")?.data.ctx?.t], [1, 2.4]);
  const labels = await p.$$eval(".an-panel .an-note .an-nctx", (e) => e.map((x) => x.textContent));
  t.ok("…cards labelled with their frame numbers", labels.length === 2 && labels.every((s, i) => s.includes("f " + [25, 60][i])), labels);
  const mk = await L.bar(p);
  t.eq("…note marks on the timeline at 1 s and 2.4 s", mk.marks.filter((m) => m.note).map((m) => m.t), [1, 2.4]);
  await p.evaluate(() => { document.querySelector(".light video.view-media").currentTime = 3.5; });
  await L.vsettled(p);
  await card("on 25").locator(".an-nt").click();
  let vs = await L.vsettled(p);
  t.ok("picking a video note goes to its frame (paused)", L.near(vs.t, 1, 0.02) && vs.paused, vs);
  t.eq("…and shows its drawing", await shown(), [dOf("on 25").id]);
  await p.keyboard.press("Escape");
  await p.keyboard.press("KeyA");   // just watching
  await p.waitForTimeout(150);
  await card("on 60").locator(".an-nt").click();
  vs = await L.vsettled(p);
  t.ok("just watching: a pick goes to its frame too", L.near(vs.t, 2.4, 0.02) && vs.paused, vs);
  t.eq("…showing that frame's drawing", await shown(), [dOf("on 60").id]);
  await p.keyboard.press("Escape"); await p.keyboard.press("Escape");
  await L.lightGone(p);

  // ---- touch: the notes button, Resolve, a pick by tap ----------------------------------------------------------------
  const tp = await L.newPage(t, cfg, { touch: true, mobile: false, label: "touch" });
  await L.openLight(tp, clip, { touch: true });
  await L.waitMedia(tp, "video");
  await tp.evaluate(() => document.querySelector(".light video.view-media").pause());
  const tOn = () => tp.$eval(".light .an-panel", (e) => !e.hidden).catch(() => false);
  if (await tOn()) await tp.tap("#notesBtn");
  t.ok("touch: the panel is off", !(await tOn()));
  await tp.tap("#notesBtn");
  await tp.waitForSelector(".light .an-panel:not([hidden]) .an-note");
  t.ok("touch: a tap on the notes button opens the panel", await tOn());
  const tid = await tp.locator(".an-panel .an-note", { has: tp.locator(".an-nt", { hasText: "on 25" }) }).getAttribute("data-id");
  await tp.tap('.an-panel .an-note[data-id="' + tid + '"] .an-nt');
  vs = await L.vsettled(tp);
  t.ok("touch: a tap on a card picks it and goes to its frame", L.near(vs.t, 1, 0.02) && await tp.$eval(`.an-panel .an-note[data-id="${tid}"]`, (c) => c.classList.contains("on")), vs);
  // (a touch screen shows a card's buttons once it is picked: there is no hover)
  await tp.tap(`.an-panel [data-done="${tid}"]`);
  r = await until(clip, (r) => byText(r, "on 25")?.data.status === "done");
  t.eq("touch: Resolve by tap, signed", [byText(r, "on 25")?.data.status, byText(r, "on 25")?.data.replies?.[0]?.author], ["done", NAME]);
});
