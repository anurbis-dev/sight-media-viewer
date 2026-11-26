// R0-0 block 3: screenshots, reference images, note previews and dictation, as they behave before R0
// (tests/test_r0_review.py).
//   - screenshots: S (the view) and Shift+S (an area dragged out; Esc cancels) wait in the composer, a click
//     enlarges one, × drops one; the note keeps the rest (data.shots), stored on the server (/api/review/shots/<id>)
//     and shown on its card; a shot's picture is the area's size;
//   - reference images (kind "image", data.shot): the tool's click opens the file picker; a card dragged in from the
//     library split (Tab); the library's selected pictures (the properties' "add selected" button);
//   - note previews: a picture note's card shows the scaled-down still with its drawing; a video note's card shows
//     its frame, stored on the server (/api/review/nprev/<aid>, key f<t>) and loaded from there next time; deleting
//     the note prunes it;
//   - dictation (a stand-in SpeechRecognition): Alt+M starts it into the note field, words land there, Alt+M stops;
//     the mic button does the same; right-click on the mic opens the language list;
//   - touch: the composer's screenshot button, the mic, the add-selected button by tap.
"use strict";
const L = require("./r0_lib.cjs");

// A recogniser that hears what the test says (window.__say), logging start / stop.
const FAKE_SR = () => {
  window.__recLog = [];
  class FakeRec {
    constructor(){ window.__rec = this; }
    start(){ window.__recLog.push("start:" + this.lang); setTimeout(() => this.onstart && this.onstart(), 0); }
    stop(){ window.__recLog.push("stop"); setTimeout(() => this.onend && this.onend(), 0); }
    abort(){ window.__recLog.push("abort"); setTimeout(() => this.onend && this.onend(), 0); }
  }
  window.SpeechRecognition = FakeRec; window.webkitSpeechRecognition = FakeRec;
  window.__say = (txt) => { const res = [{ transcript: txt }]; res.isFinal = true; window.__rec.onresult({ resultIndex: 0, results: [res] }); };
};

L.run(async (cfg, t) => {
  const id = cfg.ids, b = await t.browser();
  const pic = id["s_pic.png"], ref = id["s_ref.png"], clip = id["s_clip.mp4"];
  const newCtx = async (opts = {}) => {
    const c = await b.newContext(opts.touch ? { viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: false } : { viewport: { width: 1400, height: 900 } });
    await c.addInitScript(FAKE_SR);
    const p = await c.newPage();
    t.watch(p, opts.label || "page");
    await p.goto(cfg.base + "/");
    await p.waitForSelector(".card[data-id]", { timeout: 30000 });
    return [c, p];
  };
  let [ctx, p] = await newCtx();
  async function until(fn, ms = 6000, pg = p){
    const end = Date.now() + ms;
    let v;
    while (Date.now() < end){ v = await fn(); if (v) return v; await pg.waitForTimeout(100); }
    return v;
  }
  const rowsOf = async (aid) => (await L.rows(cfg, aid)).filter((r) => r.kind !== "status");
  const toPage = (x, y, pg = p) => pg.evaluate(([x, y]) => {
    const s = document.querySelector(".light .an-layer .an-doc"), pt = s.createSVGPoint();
    pt.x = x; pt.y = y;
    const q = pt.matrixTransform(s.getScreenCTM());
    return [q.x, q.y];
  }, [x, y]);
  async function drag(a, c, pg = p){
    const [x0, y0] = await toPage(...a, pg), [x1, y1] = await toPage(...c, pg);
    await pg.mouse.move(x0, y0); await pg.mouse.down();
    await pg.mouse.move(x1, y1, { steps: 8 }); await pg.mouse.up();
    await pg.waitForTimeout(80);
  }
  const panelOn = (pg = p) => pg.$eval(".light .an-panel", (e) => !e.hidden).catch(() => false);
  async function annotate(aid, kind = "image", pg = p){
    await L.openLight(pg, aid);
    await L.waitMedia(pg, kind);
    await pg.keyboard.press("KeyA");
    await pg.waitForSelector(".an-top:not([hidden])");
    if (!(await panelOn(pg))) await pg.keyboard.press("KeyC");
  }
  async function close(pg = p){
    await pg.keyboard.press("Escape"); await pg.keyboard.press("Escape");
    if (!(await L.lightGone(pg))){ await pg.keyboard.press("Escape"); await L.lightGone(pg); }
  }
  const pending = (pg = p) => pg.$$eval(".an-panel .an-pend .an-pshot img", (is) => is.map((i) => i.getAttribute("src")));
  const shotInfo = (url) => p.evaluate(async (u) => {
    const r = await fetch(u);
    const blob = await r.blob(), bm = await createImageBitmap(blob);
    return { status: r.status, type: r.headers.get("content-type"), w: bm.width, h: bm.height };
  }, url);
  // The library beside the lightbox: a card is on top at its centre (the lightbox covers the grid otherwise).
  const libShown = (pg, aid) => pg.evaluate((sel) => { const c = document.querySelector(sel); if (!c) return false; c.scrollIntoView({ block: "nearest" }); const r = c.getBoundingClientRect(); return r.width > 0 && !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest(sel); }, `.card[data-id="${aid}"]`);
  const shotId = (url) => (/\/api\/review\/shots\/([0-9a-f]{16})$/.exec(url || "") || [])[1] || null;

  // ---- screenshots ------------------------------------------------------------------------------------------
  await annotate(pic);
  await p.keyboard.press("KeyS");
  let pend = await until(async () => { const x = await pending(); return x.length === 1 && x; });
  t.ok("S: a screenshot waits in the composer", !!pend, await pending());
  const sh1 = shotId(pend && pend[0]);
  t.ok("…stored on the server (/api/review/shots/<id>)", !!sh1, pend);
  let inf = await shotInfo(pend[0]);
  t.ok("…a picture of the view", inf.status === 200 && /image\//.test(inf.type) && inf.w > 600 && inf.h > 300, inf);
  await p.click(".an-panel .an-pend .an-pshot img");
  t.ok("a click enlarges it", !!(await p.waitForSelector(".an-shotview", { timeout: 3000 }).catch(() => null)));
  await p.keyboard.press("Escape");
  t.ok("…Esc closes it (and only it)", await until(async () => !(await p.$(".an-shotview"))) && !!(await p.$(".light.on")) && !!(await p.$(".an-top:not([hidden])")));
  // An area: Shift+S, drag (screen px), then Esc cancels a second one.
  await p.keyboard.press("Shift+KeyS");
  t.ok("Shift+S: the area mode", await p.$eval(".light", (e) => e.classList.contains("an-regioning")));
  const box = await L.mediaBox(p);
  const ax = box.left + 100, ay = box.top + 80;
  await p.mouse.move(ax, ay); await p.mouse.down(); await p.mouse.move(ax + 240, ay + 120, { steps: 8 }); await p.mouse.up();
  pend = await until(async () => { const x = await pending(); return x.length === 2 && x; });
  t.ok("…the area waits as a second screenshot", !!pend, await pending());
  t.ok("…the mode ends", !(await p.$eval(".light", (e) => e.classList.contains("an-regioning"))));
  inf = pend ? await shotInfo(pend[1]) : {};
  t.eq("…its picture is the area's size (240 × 120 at dpr 1)", [inf.w, inf.h], [240, 120]);
  await p.keyboard.press("Shift+KeyS");
  t.ok("a second Shift+S: the area mode again", await p.$eval(".light", (e) => e.classList.contains("an-regioning")));
  await p.keyboard.press("Escape");
  t.ok("Esc cancels an area", !(await p.$eval(".light", (e) => e.classList.contains("an-regioning"))) && (await pending()).length === 2);
  // A third one; the middle one (the area) dropped with ×.
  await p.click(".an-panel .an-compose [data-act=shot]");
  const three = await until(async () => { const x = await pending(); return x.length === 3 && x; });
  t.ok("the composer's button: a third screenshot", !!three);
  await p.locator(".an-panel .an-pend .an-pshot").nth(1).hover();
  await p.click(".an-panel .an-pend .an-pshot:nth-child(2) [data-rm]");
  pend = await pending();
  t.eq("× drops that screenshot (the middle one), the others stay in order", pend, three ? [three[0], three[2]] : null);
  await p.click(".an-panel .an-input");
  await p.keyboard.type("note with screenshots");
  await p.keyboard.press("Enter");
  let rs = await until(async () => { const r = (await rowsOf(pic)).filter((x) => x.kind === "note"); return r.length === 1 && r; });
  const n1 = rs && rs[0];
  t.eq("the note keeps the two screenshots (data.shots)", n1 ? n1.data.shots : null, pend.map(shotId));
  t.eq("…the composer is empty again", await pending(), []);
  const cardShots = await p.$$eval(".an-panel .an-note .an-shotw img", (is) => is.map((i) => i.getAttribute("src")));
  t.eq("…its card shows them", cardShots, pend);
  await p.click(".an-panel .an-note .an-shotw");
  t.ok("…a click on one enlarges it", !!(await p.waitForSelector(".an-shotview", { timeout: 3000 }).catch(() => null)));
  await p.keyboard.press("Escape");
  await until(async () => !(await p.$(".an-shotview")));

  // ---- note previews: a picture --------------------------------------------------------------------------------
  await p.keyboard.press("KeyR");
  await drag([300, 300], [700, 600]);
  await p.click(".an-panel .an-input");
  await p.keyboard.type("note with a drawing");
  await p.keyboard.press("Enter");
  await until(async () => (await rowsOf(pic)).filter((x) => x.kind === "note").length === 2);
  const card2 = p.locator(".an-panel .an-note", { has: p.locator(".an-nt", { hasText: "note with a drawing" }) });
  const prev = await until(async () => {
    const v = await card2.locator(".an-nprev").first().evaluate((e) => ({ src: e.querySelector("img")?.getAttribute("src") || "", still: e.querySelector("img")?.hasAttribute("data-still"), marks: e.querySelectorAll("svg > *").length, vb: e.querySelector("svg")?.getAttribute("viewBox") })).catch(() => null);
    return v && v.src.startsWith("blob:") && v;
  });
  t.ok("picture note: its card shows the scaled-down still (a blob)", !!prev, prev);
  t.ok("…with its drawing over it, in picture px", !!prev && prev.marks >= 1 && prev.vb === "0 0 1600 1000", prev);
  const stillSize = await card2.locator(".an-nprev img").first().evaluate((i) => [i.naturalWidth, i.naturalHeight]).catch(() => null);
  t.eq("…the still is 720 px on its short side", stillSize, [1152, 720]);
  t.eq("…the first note (screenshots only) has no drawing preview", await p.locator(".an-panel .an-note", { has: p.locator(".an-nt", { hasText: "note with screenshots" }) }).locator(".an-nprev").count(), 0);

  // ---- reference images ----------------------------------------------------------------------------------------
  const images = async () => (await rowsOf(pic)).filter((r) => r.kind === "image");
  await p.keyboard.press("Shift+KeyI");
  t.eq("Shift+I: the reference image tool", await p.evaluate(() => document.querySelector(".an-bar [data-tool].on")?.dataset.tool), "image");
  const [fc] = await Promise.all([p.waitForEvent("filechooser", { timeout: 5000 }), (async () => { const [x, y] = await toPage(1200, 300); await p.mouse.click(x, y); })()]);
  t.ok("…a click opens the file picker (pictures, several)", fc.isMultiple() && /image/.test(await fc.element().getAttribute("accept")));
  await fc.setFiles(require("path").join(cfg.media, "s_ref.png"));
  let im = await until(async () => { const r = await images(); return r.length === 1 && r; });
  t.ok("…the picked file becomes an image drawing", !!im, im && im.length);
  if (im){
    const d = im[0].data;
    t.eq("…at its own size (iw × ih)", [d.iw, d.ih], [300, 200]);
    t.ok("…centred where it was clicked", L.near(d.x + d.w / 2, 1200, 2) && L.near(d.y + d.h / 2, 300, 2), [d.x + d.w / 2, d.y + d.h / 2]);
    t.ok("…its picture stored as a shot", (await shotInfo("/api/review/shots/" + d.shot)).status === 200, d.shot);
  }
  t.eq("…the tool becomes Select, the image selected", await p.evaluate(() => document.querySelector(".an-bar [data-tool].on")?.dataset.tool), "select");
  // The library split (Tab): a card dragged onto the picture.
  await p.keyboard.press("Escape");
  await p.keyboard.press("Tab");
  const refCard = `.card[data-id="${ref}"]`;
  t.ok("Tab: the library beside the lightbox", await until(() => libShown(p, ref)));
  await p.locator(refCard).scrollIntoViewIfNeeded();
  await p.waitForTimeout(500);   // (the lightbox re-fits to its narrower pane)
  // A real HTML drag (the grid's dragstart sets application/x-sight-ids). The view re-lays out once the drag is
  // under way (the surface moved down by a bar's height here), so the drop point is aimed at during the drag.
  const cb = await p.locator(refCard).boundingBox();
  await p.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2); await p.mouse.down();
  let [dx, dy] = await toPage(400, 750);
  await p.mouse.move(dx, dy, { steps: 8 });
  await p.waitForTimeout(150);
  [dx, dy] = await toPage(400, 750);
  await p.mouse.move(dx, dy, { steps: 2 });
  await p.mouse.up();
  im = await until(async () => { const r = await images(); return r.length === 2 && r; });
  t.ok("a card dragged in from the library becomes an image drawing", !!im, (await images()).length);
  if (im){
    const d = im.find((r) => !(L.near(r.data.x + r.data.w / 2, 1200, 2))).data;
    t.eq("…the library file's size", [d.iw, d.ih], [300, 200]);
    t.ok("…where it was dropped", L.near(d.x + d.w / 2, 400, 6) && L.near(d.y + d.h / 2, 750, 6), [d.x + d.w / 2, d.y + d.h / 2]);
  }
  t.eq("…the lightbox still shows the picture", await L.lightTitle(p), "s_pic.png");
  // The selected ones: a Shift+click on the card in the library (a plain click shows the file), then the tool's
  // "add selected".
  await p.click(refCard, { modifiers: ["Shift"] });
  await p.waitForTimeout(200);
  const lt = await L.lightTitle(p);
  await p.click(".an-bar [data-tool=image]");   // (keys follow the pane under the pointer: the library now)
  const selBtn = await p.$(".an-props [data-cmd=refsel]");
  t.ok("the image tool offers the library's selected pictures", !!selBtn && (lt === "s_pic.png"), [!!selBtn, lt]);
  if (selBtn){
    await selBtn.click();
    // (the selection is a range from the open file, which opening selected, to the Shift-clicked one: both)
    im = await until(async () => { const r = await images(); return r.length === 4 && r; });
    t.ok("…its button adds them (the open file and the Shift-clicked one)", !!im, (await images()).length);
    if (im) t.eq("…at their own sizes", im.map((r) => [r.data.iw, r.data.ih]).sort(), [[1600, 1000], [300, 200], [300, 200], [300, 200]]);
  }
  const vb = await p.$eval(".light .view", (e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + 40]; });
  await p.mouse.move(vb[0], vb[1]);
  await p.keyboard.press("Escape");
  await p.keyboard.press("Tab");   // the library away again (the pointer over the lightbox)
  t.ok("Tab again: the library goes", await until(async () => !(await libShown(p, ref))));
  await close(p);

  // ---- note previews: a video frame, stored ------------------------------------------------------------------
  await annotate(clip, "video");
  await p.evaluate(() => { const v = document.querySelector(".light video.view-media"); v.pause(); v.currentTime = 1.0; });
  await L.vsettled(p);
  await p.keyboard.press("KeyR");
  await drag([40, 40], [200, 160]);
  await p.click(".an-panel .an-input");
  await p.keyboard.type("video note");
  await p.keyboard.press("Enter");
  const vn = await until(async () => { const r = (await rowsOf(clip)).filter((x) => x.kind === "note"); return r.length === 1 && r[0]; });
  t.ok("video note on frame 25", !!vn && L.near(vn.data.ctx?.t ?? -1, 1.0, 0.02), vn && vn.data.ctx);
  const fsrc = await until(async () => {
    const s = await p.$eval(".an-panel .an-note .an-nprev img", (i) => i.getAttribute("src") || "").catch(() => "");
    return s && s;
  }, 10000);
  t.ok("…its card shows the frame (made here)", !!fsrc && !/^\/api\/review\/nprev/.test(fsrc), fsrc);
  const tok = "f" + Number(vn?.data.ctx?.t ?? 1).toFixed(3);
  const keys = await until(async () => { const r = await L.api(cfg, `/api/review/nprev/${clip}`); return (r.keys || []).includes(tok) && r; }, 8000);
  t.ok(`…stored on the server (${tok})`, !!keys, await L.api(cfg, `/api/review/nprev/${clip}`));
  await close(p);
  await ctx.close();
  // A fresh browser: the card loads the stored frame.
  [ctx, p] = await newCtx({ label: "page 2" });
  await L.openLight(p, clip);
  await L.waitMedia(p, "video");
  if (!(await panelOn())) await p.keyboard.press("KeyC");
  const fsrc2 = await until(async () => { const s = await p.$eval(".an-panel .an-note .an-nprev img", (i) => i.getAttribute("src") || "").catch(() => ""); return s && s; }, 8000);
  t.ok("next time the card loads the stored frame", new RegExp(`^/api/review/nprev/${clip}/${tok.replace(".", "\\.")}\\.jpg\\?v=`).test(fsrc2 || ""), fsrc2);
  t.ok("…and it decodes", await until(() => p.$eval(".an-panel .an-note .an-nprev img", (i) => i.complete && i.naturalWidth > 0).catch(() => false)));
  // Deleting the note prunes the stored frame.
  await p.locator(".an-panel .an-note").first().hover();
  await p.click(".an-panel .an-note [data-del]");
  await until(async () => !(await rowsOf(clip)).some((x) => x.kind === "note"));
  const pruned = await until(async () => { const r = await L.api(cfg, `/api/review/nprev/${clip}`); return !(r.keys || []).length && r; }, 8000);
  t.ok("deleting the note prunes its stored frame", !!pruned, await L.api(cfg, `/api/review/nprev/${clip}`));
  await close(p);

  // ---- dictation ---------------------------------------------------------------------------------------------
  await annotate(pic);
  const log = () => p.evaluate(() => window.__recLog.slice());
  const micOn = () => p.$eval(".an-panel [data-act=dict]", (x) => x.classList.contains("on"));
  await p.click(".an-panel .an-input");
  await p.keyboard.press("Alt+KeyM");
  t.ok("Alt+M starts dictation", await until(async () => (await log()).some((x) => x.startsWith("start:"))), await log());
  t.ok("…the mic shows it", await until(micOn));
  await p.evaluate(() => window.__say("hello from dictation"));
  t.ok("…what is heard lands in the note field", await until(async () => /hello from dictation/.test(await p.$eval(".an-panel .an-input", (x) => x.value))), await p.$eval(".an-panel .an-input", (x) => x.value));
  await p.keyboard.press("Alt+KeyM");
  t.ok("Alt+M again stops it", await until(async () => (await log()).includes("stop") && !(await micOn())), await log());
  await p.click(".an-panel [data-act=dict]");
  t.ok("the mic button starts it", await until(async () => (await log()).filter((x) => x.startsWith("start:")).length === 2 && micOn()));
  await p.click(".an-panel [data-act=dict]");
  t.ok("…and stops it", await until(async () => !(await micOn())));
  await p.click(".an-panel [data-act=dict]", { button: "right" });
  t.ok("a right-click on the mic opens the language list", !!(await p.waitForSelector(".dict-pop", { timeout: 3000 }).catch(() => null)));
  await p.keyboard.press("Escape");
  await p.evaluate(() => { const x = document.querySelector(".an-panel .an-input"); x.value = ""; x.dispatchEvent(new Event("input")); });
  await close(p);
  await ctx.close();

  // ---- touch ---------------------------------------------------------------------------------------------------
  let tc, tp;
  [tc, tp] = await newCtx({ touch: true, label: "touch" });
  await L.openLight(tp, pic, { touch: true });
  await L.waitMedia(tp, "image");
  await tp.tap("#annoBtn");
  await tp.waitForSelector(".an-top:not([hidden])");
  if (!(await panelOn(tp))) await tp.tap(".an-bar [data-act=panel], #annoNotes").catch(() => {});
  await tp.tap(".an-panel .an-compose [data-act=shot]");
  t.ok("touch: the screenshot button", await until(async () => (await pending(tp)).length === 1, 6000, tp));
  await tp.tap(".an-panel [data-act=dict]");
  t.ok("touch: the mic starts dictation", await until(async () => (await tp.evaluate(() => window.__recLog)).some((x) => x.startsWith("start:")), 4000, tp));
  await tp.tap(".an-panel [data-act=dict]");
  t.ok("touch: a second tap stops it", await until(async () => (await tp.evaluate(() => window.__recLog)).includes("stop") && !(await tp.$eval(".an-panel [data-act=dict]", (x) => x.classList.contains("on"))), 4000, tp));
  await tp.tap(".an-bar [data-tool=image]");
  t.ok("touch: the library is not shown yet", !(await libShown(tp, ref)));
  await tp.tap(".an-props [data-cmd=reflib]");
  t.ok("touch: the library button shows the library", await until(() => libShown(tp, ref), 4000, tp));
  // A long press selects the card (touch selection; a tap would show that file in the lightbox).
  const rc = await tp.locator(`.card[data-id="${ref}"]`).boundingBox();
  await L.touchDrag(tp, rc.x + rc.width / 2, rc.y + rc.height / 2, rc.x + rc.width / 2, rc.y + rc.height / 2, 1, 900);
  await tp.waitForTimeout(300);
  t.eq("touch: a long press selects the card, the lightbox stays", await L.lightTitle(tp), "s_pic.png");
  const before = (await images()).length;
  await tp.tap(".an-props [data-cmd=refsel]");
  t.ok("touch: add selected adds the library's pick", await until(async () => (await images()).length === before + 1, 6000, tp), [(await images()).length, before]);
  await tc.close();
});
