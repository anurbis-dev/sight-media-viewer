// R0-0 block 5: the review exports and import from the Export ▾ menu, and the tracker link ▾ against the fake ShotGrid,
// as they behave before R0 (tests/test_r0_views.py). The server writes exports into cfg.out (the test's own folder)
// and reveals nothing. Media: e_pic.png (900 x 600 quadrants), sh010.png.
//   - a note with a drawing on e_pic.png (made in the UI), then from Export ▾:
//     - PDF report…: a .pdf in the export folder (a PDF, the toast's page count);
//     - Web page for reviewers (.html)…: a .html holding the note's text and the file's name, which opens in a browser
//       and lists the note;
//     - Review file (.srev)…: a .srev, sight-review version 1, the asset's identity, the note and the stroke (the
//       stroke's points), the reviewer as author;
//     - Copy notes as text: the clipboard's lines;
//   - Import review file…: the .srev with a reply and a new note added elsewhere merges in (the server's rows, the
//     panel's cards), nothing doubled; importing the same file again changes nothing;
//   - the ShotGrid link ▾ (SG ▾ in the panel's head): not linked → the pick view (the project list, a search by the
//     file's name, the Version found), a pick links it ("Linked to sh010_comp_v003"), Sync now sends the note, Unlink
//     goes back to the pick view;
//   - touch: Export ▾ and SG ▾ open by tap, an export by tap.
"use strict";
const fs = require("fs");
const path = require("path");
const L = require("./r0_lib.cjs");

L.run(async (cfg, t) => {
  const id = cfg.ids, pic = id["e_pic.png"], sh = id["sh010.png"];
  const b = await t.browser();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: cfg.base });
  let p = await ctx.newPage();
  t.watch(p, "page");
  await p.goto(cfg.base + "/");
  await p.waitForSelector(".card[data-id]", { timeout: 30000 });
  async function until(fn, ms = 8000, pg = p){
    const end = Date.now() + ms;
    let v;
    while (Date.now() < end){ v = await fn(); if (v) return v; await pg.waitForTimeout(100); }
    return v;
  }
  const rowsOf = async (aid) => (await L.rows(cfg, aid)).filter((r) => r.kind !== "status");
  const outFiles = (ext) => fs.readdirSync(cfg.out).filter((f) => f.toLowerCase().endsWith(ext));
  // picture px -> page px, from the lightbox picture's box (not from the annotation layer), once it holds still (the
  // picture re-fits when the panel opens)
  async function toPage(x, y, pg = p){
    // (still = the same box for 0.6 s: the re-fit can start a moment after the panel shows)
    let a = await L.mediaBox(pg), same = 0;
    for (let i = 0; i < 60 && same < 6; i++){ await pg.waitForTimeout(100); const b = await L.mediaBox(pg); same = b.left === a.left && b.top === a.top && b.width === a.width ? same + 1 : 0; a = b; }
    return L.docToPage(a, x, y);
  }
  async function closeLight(pg = p){ for (let i = 0; i < 4 && !(await L.lightGone(pg)); i++) await pg.keyboard.press("Escape"); }
  const panelOn = (pg = p) => pg.$eval(".light .an-panel", (e) => !e.hidden).catch(() => false);
  const toastText = (pg = p) => pg.evaluate(() => [...document.querySelectorAll(".light .an-toast")].map((e) => e.textContent).join(" | "));
  async function menu(x, pg = p, tap = false){
    if (tap) await pg.tap('.light .an-panel [data-act="export"]'); else await pg.click('.light .an-panel [data-act="export"]');
    await pg.waitForSelector(".light .an-panel .an-menu:not(.an-trk):not([hidden])", { timeout: 4000 });
    if (tap) await pg.tap(`.light .an-panel .an-menu [data-ex="${x}"]`); else await pg.click(`.light .an-panel .an-menu [data-ex="${x}"]`);
  }

  // ---- a note to export -------------------------------------------------------------------------------------
  await L.openLight(p, pic);
  await L.waitMedia(p, "image");
  await p.keyboard.press("KeyA");
  await p.waitForSelector(".an-top:not([hidden])");
  if (!(await panelOn())) await p.keyboard.press("KeyC");
  const [x1, y1] = await toPage(450, 300), [x0, y0] = await toPage(150, 150);
  t.eq("…the picture held still while the stroke was aimed", (await toPage(450, 300)).map(Math.round), [x1, y1].map(Math.round));
  await p.mouse.move(x0, y0); await p.mouse.down(); await p.mouse.move(x1, y1, { steps: 8 }); await p.mouse.up();
  await p.fill(".light .an-panel .an-input", "Export note R0");
  await p.press(".light .an-panel .an-input", "Enter");
  // (the stroke's link to the note is a debounced change of its row: polled)
  let rs = await until(async () => { const r = await rowsOf(pic); const n = r.find((x) => x.kind === "note"); return r.length === 2 && n && r.find((x) => x.kind !== "note").data.note === n.id && r; });
  t.ok("the note and its stroke are stored", !!rs, await rowsOf(pic));
  const note = rs && rs.find((x) => x.kind === "note"), strokeRow = rs && rs.find((x) => x.kind !== "note");
  t.eq("…the stroke belongs to the note", strokeRow && strokeRow.data.note, note && note.id);

  // ---- PDF ---------------------------------------------------------------------------------------------------
  await menu("pdf");
  const pdfs = await until(() => { const f = outFiles(".pdf"); return f.length === 1 && f; }, 30000);
  t.ok("PDF report…: a .pdf in the export folder", !!pdfs, fs.readdirSync(cfg.out));
  if (pdfs){
    const buf = fs.readFileSync(path.join(cfg.out, pdfs[0]));
    t.eq("…a PDF", buf.slice(0, 5).toString("latin1"), "%PDF-");
    t.ok("…named after the file", /e_pic/.test(pdfs[0]), pdfs[0]);
  }
  t.ok("…the toast names it and counts the pages", !!(await until(async () => /Saved .*\.pdf · \d+ pages?/.test(await toastText()), 8000)), await toastText());

  // ---- web page ------------------------------------------------------------------------------------------------
  await menu("html");
  const htmls = await until(() => { const f = outFiles(".html"); return f.length === 1 && f; }, 30000);
  t.ok("Web page…: a .html in the export folder", !!htmls, fs.readdirSync(cfg.out));
  if (htmls){
    const fp = path.join(cfg.out, htmls[0]);
    const txt = fs.readFileSync(fp, "utf8");
    t.ok("…it holds the note's text and the file's name", txt.includes("Export note R0") && txt.includes("e_pic.png"));
    const hp = await ctx.newPage();
    await hp.goto("file:///" + fp.replace(/\\/g, "/"));
    t.ok("…it opens in a browser and lists the note", !!(await until(() => hp.evaluate(() => /Export note R0/.test(document.body.innerText)), 10000, hp)));
    await hp.close();
  }
  t.ok("…the toast", !!(await until(async () => /Saved .*\.html — opens in any browser/.test(await toastText()))), await toastText());

  // ---- .srev ---------------------------------------------------------------------------------------------------
  await menu("pkg");
  const srevs = await until(() => { const f = outFiles(".srev"); return f.length === 1 && f; }, 20000);
  t.ok("Review file (.srev)…: a .srev in the export folder", !!srevs, fs.readdirSync(cfg.out));
  let pkg = null;
  if (srevs){
    pkg = JSON.parse(fs.readFileSync(path.join(cfg.out, srevs[0]), "utf8").replace(/^﻿/, ""));
    t.eq("…sight-review, version 1", [pkg.format, pkg.version], ["sight-review", 1]);
    t.ok("…the asset's identity (its id and name)", !!pkg.asset && pkg.asset.id === pic && pkg.asset.name === "e_pic.png", pkg.asset);
    t.eq("…the reviewer as author", pkg.author, "R0 Reviewer");
    const ids = (pkg.annotations || []).map((r) => r.id).sort();
    t.eq("…its rows: the note and the stroke", ids, [note.id, strokeRow.id].sort());
    const ps = (pkg.annotations || []).find((r) => r.id === strokeRow.id);
    t.eq("…the stroke's points as stored", ps && ps.data.pts, strokeRow.data.pts);
    t.ok("…in picture px (where it was drawn)", !!ps && L.near(ps.data.pts[0], 150, 3) && L.near(ps.data.pts[1], 150, 3) && L.near(ps.data.pts.at(-3), 450, 3) && L.near(ps.data.pts.at(-2), 300, 3), ps && ps.data.pts);
    t.eq("…no Sight-only columns", ps && ["scope", "target_asset_id", "revision", "deleted_at"].filter((k) => k in ps), []);
  }
  t.ok("…the toast", !!(await until(async () => /Saved .*\.srev — send it/.test(await toastText()))), await toastText());

  // ---- copy as text ----------------------------------------------------------------------------------------------
  await menu("text");
  const clip = await until(async () => { const c = await p.evaluate(() => navigator.clipboard.readText()).catch(() => ""); return /Export note R0/.test(c) && c; });
  t.ok("Copy notes as text: the clipboard's lines", !!clip && /^Review — e_pic\.png/.test(clip) && /\n1\. Export note R0/.test(clip), clip);

  // ---- import ---------------------------------------------------------------------------------------------------
  if (pkg){
    const now = Date.now();
    const back = JSON.parse(JSON.stringify(pkg));
    back.app = "Sight R0 (web reply)";
    back.author = "Other Reviewer";
    const n = back.annotations.find((r) => r.id === note.id);
    n.data.replies = [...(n.data.replies || []), { id: "rp" + now.toString(16), author: "Other Reviewer", created: now, text: "Reply from the page" }];
    n.updated_at = now;
    const newId = "f00dfeed" + (now % 0xffffffff).toString(16).padStart(8, "0");
    back.annotations.push({ id: newId, kind: "note", shape_kind: null, x: null, y: null, w: null, h: null, rotation: 0, z_index: 0, color: null, locked: 0,
      data: { text: "New note from the page", author: "Other Reviewer", created: now, status: "open", ctx: null, shots: [], replies: [] }, created_at: now, updated_at: now });
    const fp = path.join(cfg.out, "reply.srev");
    fs.writeFileSync(fp, JSON.stringify(back));
    // (the menu's item clicks this input: the file picker)
    await p.setInputFiles(".light .an-panel .an-file", fp);
    rs = await until(async () => { const r = await rowsOf(pic); return r.length === 3 && r; });
    t.ok("Import review file…: the new note merges in", !!rs && rs.some((r) => r.id === newId && r.data.text === "New note from the page"), (await rowsOf(pic)).map((r) => r.id));
    const n2 = rs && rs.find((r) => r.id === note.id);
    t.ok("…the reply joins the note's thread", !!n2 && (n2.data.replies || []).some((r) => r.text === "Reply from the page"), n2 && n2.data.replies);
    t.ok("…the panel shows both", !!(await until(() => p.evaluate(() => { const s = document.querySelector(".light .an-panel .an-list").textContent; return /New note from the page/.test(s) && /Reply from the page/.test(s); }))));
    const again = p.waitForResponse((r) => r.url().includes("/api/review/import"), { timeout: 15000 });
    await p.setInputFiles(".light .an-panel .an-file", fp);
    t.eq("…the second import answers", (await again).status(), 200);
    rs = await rowsOf(pic);
    t.eq("…importing it again changes nothing (no row doubled)", [rs.length, (rs.find((r) => r.id === note.id).data.replies || []).length], [3, 1]);
  }
  await closeLight();
  t.ok("the lightbox closes", await L.lightGone(p));

  // ---- the ShotGrid link ▾ -------------------------------------------------------------------------------------
  await L.openLight(p, sh);
  await L.waitMedia(p, "image");
  await p.keyboard.press("KeyA");
  await p.waitForSelector(".an-top:not([hidden])");
  if (!(await panelOn())) await p.keyboard.press("KeyC");
  await p.fill(".light .an-panel .an-input", "Note for ShotGrid R0");
  await p.press(".light .an-panel .an-input", "Enter");
  await until(async () => (await rowsOf(sh)).length === 1);
  const trkBtn = '.light .an-panel [data-act="trk"]';
  t.ok("the panel's head has SG ▾", !!(await p.waitForSelector(trkBtn, { timeout: 8000 }).catch(() => null)) && /^SG ▾$/.test((await p.textContent(trkBtn)).trim()), await p.textContent(trkBtn).catch(() => null));
  await p.click(trkBtn);
  const pop = ".light .an-panel .an-trk";
  t.ok("SG ▾: not linked yet, the pick view", !!(await until(() => p.evaluate((s) => /Link sh010\.png to a ShotGrid Version/.test(document.querySelector(s)?.textContent || ""), pop))), await p.textContent(pop));
  t.eq("…the search starts with the file's name", await p.inputValue(pop + " .an-trkq"), "sh010");
  await until(() => p.evaluate((s) => [...document.querySelectorAll(s + " .an-trkproj option")].some((o) => o.value === "70"), pop));
  t.eq("…the projects", await p.$$eval(pop + " .an-trkproj option", (os) => os.map((o) => o.textContent)), ["Project…", "Demo"]);
  await p.selectOption(pop + " .an-trkproj", "70");
  const found = await until(async () => { const x = await p.$$eval(pop + " .an-trklist [data-rec]", (bs) => bs.map((b) => [b.dataset.rec, b.textContent.trim()])); return x.length && x; });
  t.ok("…the Version found by name", !!found && found.some(([r, n]) => r === "77" && /^sh010_comp_v003/.test(n)), found);
  await p.click(pop + ' .an-trklist [data-rec="77"]');
  t.ok("a pick links it", !!(await until(() => p.evaluate((s) => /Linked to sh010_comp_v003/.test(document.querySelector(s)?.textContent || ""), pop))), await p.textContent(pop));
  t.ok("…the server keeps the link", !!(await until(async () => { const key = await p.$eval(trkBtn, (b) => b.dataset.tracker); const r = await L.api(cfg, `/api/trackers/${encodeURIComponent(key)}/link/${sh}`).catch(() => null); return r && r.link; })));
  t.eq("…the linked view's buttons", await p.$$eval(pop + " [data-trk]", (bs) => bs.map((b) => b.textContent.trim())), ["Sync now", "Link to another Version…", "Unlink"]);
  await p.click(pop + ' [data-trk="sync"]');
  t.ok("Sync now sends the note", !!(await until(() => p.evaluate((s) => /1 sent/.test(document.querySelector(s)?.textContent || ""), pop), 20000)), await p.textContent(pop));
  t.ok("…the note carries its ShotGrid id", !!(await until(async () => (await rowsOf(sh))[0]?.data.sg)), (await rowsOf(sh))[0]?.data);
  await p.click(pop + ' [data-trk="unlink"]');
  t.ok("Unlink goes back to the pick view", !!(await until(() => p.evaluate((s) => /Link sh010\.png to a ShotGrid Version/.test(document.querySelector(s)?.textContent || ""), pop))), await p.textContent(pop));
  await p.click(trkBtn);
  t.ok("SG ▾ again closes it", await until(() => p.$eval(pop, (e) => e.hidden)));
  await ctx.close();

  // ---- touch ----------------------------------------------------------------------------------------------------
  p = await L.newPage(t, cfg, { touch: true, mobile: false, label: "touch" });
  await L.openLight(p, pic, { touch: true });
  await L.waitMedia(p, "image");
  if (!(await panelOn())) await p.tap("#notesBtn");
  t.ok("touch: the notes button opens the panel", await until(() => panelOn()));
  const n0 = outFiles(".srev").length;
  await menu("pkg", p, true);
  t.ok("touch: Export ▾ and an export by tap", !!(await until(() => outFiles(".srev").length === n0 + 1, 20000)), fs.readdirSync(cfg.out));
  await p.tap(trkBtn);
  t.ok("touch: SG ▾ by tap", !!(await until(() => p.evaluate((s) => { const e = document.querySelector(s); return !!e && !e.hidden && /ShotGrid/.test(e.textContent); }, pop))));
  await p.context().close();
});
