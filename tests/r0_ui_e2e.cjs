// R0-0 block 5: the look — Interface Scale, the theme — and a text snapshot of the chrome, as before R0
// (tests/test_r0_views.py; the snapshot is tests/r0_ui_snapshot.json, which R0e must leave unchanged).
//   - Interface Scale (Settings → Interface, sight.theme.uiScale → --ui-k) at 0.75×, 1× and 1.75×: --ui-k; the
//     library's top bar and side bar and the lightbox's bar scale with it (their height / width against 1×, ±12 %);
//     the annotator's toolbar and the compare bar too at 0.75× (at 1.75× they wrap: at least scaled); the review
//     panel keeps its width (it is not zoomed); everything stays on screen: the toolbar below the lightbox bar and
//     left of the panel, the panel the window's height at the right edge with the bar stopping at it, the picture
//     left of the panel, the board's annotator bar inside the board, every visible bar button inside the window;
//   - the theme: Settings → Theme → Light makes the page, the lightbox bar and the review panel light (their
//     backgrounds), kept after a reload (the server's settings); Graphite makes them dark again;
//   - the text snapshot (data.snapshot): each part's titles, aria-labels, placeholders and own texts in DOM order —
//     the library's top bar, the board's top bar, the lightbox bar (picture, video), the video bar, the sequence bar,
//     the annotator's bar, the review panel (head, Export menu, state, composer), the compare bar — and every mode's
//     ? list (library, picture, video, sequence, 3D-less modes, compare, the annotator, the board, the board's
//     annotator); names of files, times, counts, the RAM figure and the dictation language (the browser's) are left
//     out;
//   - touch (a touch laptop at 1.75×): the ? button opens the library's list, its ✕ closes it; the lightbox's
//     buttons stay on screen.
"use strict";
const L = require("./r0_lib.cjs");

L.run(async (cfg, t) => {
  const id = cfg.ids, pic = id["c_a.png"], pic2 = id["c_b.png"], V1 = id["v_1.mp4"], V2 = id["v_2.mp4"], bid = cfg.board;
  const b = await t.browser();
  const SORT = JSON.stringify({ key: "name", dir: "asc" });
  const setUi = (extra) => L.api(cfg, "/api/settings/ui", { method: "PUT", body: { "sight.sort": SORT, ...extra } });
  async function page(opts = {}){
    const ctx = await b.newContext(opts.touch ? { viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: false } : { viewport: { width: 1400, height: 900 } });
    const p = await ctx.newPage();
    t.watch(p, opts.label || "page");
    await p.goto(cfg.base + "/");
    await p.waitForSelector(".card[data-id]", { timeout: 30000 });
    await p.waitForTimeout(300);
    return p;
  }
  async function until(p, fn, ms = 6000){
    const end = Date.now() + ms;
    let v;
    while (Date.now() < end){ v = await fn(); if (v) return v; await p.waitForTimeout(100); }
    return v;
  }
  const rect = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel);
  const vw = (p) => p.evaluate(() => [innerWidth, innerHeight]);
  async function closeLight(p){
    for (let i = 0; i < 3 && !(await L.lightGone(p)); i++) await p.keyboard.press("Escape");
  }
  async function annotateOn(p){
    await p.keyboard.press("KeyA");
    await p.waitForSelector(".light .an-top:not([hidden])");
    if (!(await p.$eval(".light .an-panel", (e) => !e.hidden))) await p.keyboard.press("KeyC");
    await p.waitForSelector(".light .an-panel:not([hidden])");
    await p.waitForTimeout(300);
  }

  // ---- Interface Scale ---------------------------------------------------------------------------------------
  const sizes = {};
  for (const k of [1, 0.75, 1.75]){
    await setUi({ "sight.theme": JSON.stringify({ uiScale: k }) });
    const p = await page({ label: "scale " + k });
    const [W, H] = await vw(p);
    const m = {};
    m.uik = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ui-k").trim());
    m.top = await rect(p, ".main > .top");
    m.side = await rect(p, ".side");
    m.topBtnsOut = await p.evaluate((W) => [...document.querySelectorAll(".main > .top button")].filter((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && (r.right > W + 1 || r.left < -1); }).map((x) => x.id || x.className), W);
    await L.openLight(p, pic);
    await L.waitMedia(p, "image");
    await annotateOn(p);
    m.lbar = await rect(p, ".light .light-bar");
    m.antop = await rect(p, ".light .an-top");
    m.panel = await rect(p, ".light .an-panel");
    m.media = await rect(p, ".light .view-media");
    m.lbarOut = await p.evaluate((W) => [...document.querySelectorAll(".light .light-bar button, .light .an-top button")].filter((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && (r.right > W + 1 || r.left < -1); }).map((x) => x.id || x.dataset.tool || x.className), W);
    await p.keyboard.press("KeyA");
    await closeLight(p);
    // compare
    await p.click(`.card[data-id="${pic}"]`);
    await p.click(`.card[data-id="${pic2}"]`, { modifiers: ["Control"] });
    await p.keyboard.press("KeyK");
    await p.waitForSelector(".cmp .cmp-bar");
    await p.waitForTimeout(300);
    m.cbar = await rect(p, ".cmp .cmp-bar");
    m.cbarOut = await p.evaluate((W) => [...document.querySelectorAll(".cmp .cmp-bar button")].filter((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && (r.right > W + 1 || r.left < -1); }).length, W);
    await p.keyboard.press("Escape");
    await p.keyboard.press("Escape");
    // the board's annotator bar
    await p.click(`.board-row[data-bid="${bid}"]`);
    await p.waitForSelector("#canvasView .citem");
    await p.click("#boardAnnoBtn");
    await p.waitForSelector("#canvasView .an-top:not([hidden])");
    m.btop = await rect(p, "#canvasView .an-top");
    m.bview = await rect(p, "#canvasView");
    await p.click("#boardAnnoBtn");
    sizes[k] = m;
    const tag = `${k}×`;
    t.eq(`${tag}: --ui-k`, m.uik, String(k));
    t.eq(`${tag}: every top-bar button inside the window`, m.topBtnsOut, []);
    t.eq(`${tag}: every lightbox / toolbar button inside the window`, m.lbarOut, []);
    t.eq(`${tag}: every compare-bar button inside the window`, m.cbarOut, 0);
    t.ok(`${tag}: the annotator's toolbar below the lightbox bar`, m.antop.t >= m.lbar.b - 1, [m.lbar, m.antop]);
    t.ok(`${tag}: the review panel the window's height at its right edge, the bar stopping at it`, L.near(m.panel.r, W, 2) && L.near(m.panel.t, 0, 1) && L.near(m.panel.b, H, 1) && L.near(m.lbar.r, m.panel.l, 1), [m.panel, m.lbar, W, H]);
    t.ok(`${tag}: the toolbar within the picture's area (left of the panel)`, m.antop.l >= -1 && m.antop.r <= m.panel.l + 1, [m.antop, m.panel]);
    t.ok(`${tag}: the picture left of the panel`, m.media.r <= m.panel.l + 1 && m.media.l >= -1, [m.media, m.panel]);
    t.ok(`${tag}: the board's annotator bar inside the board`, m.btop.l >= m.bview.l - 1 && m.btop.r <= m.bview.r + 1 && m.btop.t >= m.bview.t - 1, [m.btop, m.bview]);
    await p.context().close();
  }
  for (const k of [0.75, 1.75]){
    const a = sizes[k], o = sizes[1], tag = `${k}×`;
    const ratio = (x, y) => Math.round(x / y * 100) / 100;
    const scaled = (name, x, y) => t.ok(`${tag}: ${name} scales with it`, Math.abs(x / y - k) <= 0.12 * k, [ratio(x, y), k]);
    // (a bar that no longer fits on one line wraps at 1.75×: at least scaled, maybe taller)
    const atLeast = (name, x, y) => k < 1 ? scaled(name, x, y) : t.ok(`${tag}: ${name} scales with it (or wraps)`, x / y >= k * 0.88, [ratio(x, y), k]);
    scaled("the top bar's height", a.top.h, o.top.h);
    scaled("the side bar's width", a.side.w, o.side.w);
    scaled("the lightbox bar's height", a.lbar.h, o.lbar.h);
    atLeast("the annotator toolbar's height", a.antop.h, o.antop.h);
    atLeast("the compare bar's height", a.cbar.h, o.cbar.h);
    // (the review panel is not part of the zoomed chrome: --an-pw, docs/ARCHITECTURE.md "Interface scale")
    t.eq(`${tag}: the review panel keeps its width`, a.panel.w, o.panel.w);
  }
  await setUi({});

  // ---- the theme -----------------------------------------------------------------------------------------------
  let p = await page({ label: "theme" });
  const luma = (c) => { const m = /rgba?\((\d+), (\d+), (\d+)/.exec(c || ""); return m ? Math.round(0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3]) : -1; };
  const bgOf = (sel) => p.evaluate((s) => { let e = document.querySelector(s); while (e){ const c = getComputedStyle(e).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c; e = e.parentElement; } return null; }, sel);
  const looks = async () => {
    const out = { page: luma(await bgOf("body")), fg: luma(await p.evaluate(() => getComputedStyle(document.body).color)) };
    await L.openLight(p, pic);
    await L.waitMedia(p, "image");
    await annotateOn(p);
    out.lbar = luma(await bgOf(".light .light-bar"));
    out.panel = luma(await bgOf(".light .an-panel"));
    await p.keyboard.press("KeyA");
    await closeLight(p);
    return out;
  };
  const dark0 = await looks();
  t.ok("Graphite (the default): dark page, bar and panel, light text", dark0.page < 60 && dark0.lbar < 80 && dark0.panel < 80 && dark0.fg > 180, dark0);
  const pickTheme = async (v) => {
    if (await p.$("#settingsBody[hidden]")) await p.click("#settingsHead");
    await p.waitForSelector("#themeSel", { state: "visible" });
    await p.selectOption("#themeSel", v);
    await p.waitForTimeout(400);
  };
  await pickTheme("b2");
  t.eq("Settings → Theme → Light: --bg", await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim()), "#f1f2ef");
  const light1 = await looks();
  t.ok("…a light page, bar and panel, dark text", light1.page > 200 && light1.lbar > 190 && light1.panel > 190 && light1.fg < 80, light1);
  await until(p, async () => /f1f2ef/i.test(((await L.api(cfg, "/api/settings")).ui || {})["sight.theme"] || ""));
  await p.context().close();
  p = await page({ label: "theme reload" });
  const light2 = await looks();
  t.ok("…kept in a fresh window (the server's settings)", light2.page > 200 && light2.lbar > 190, light2);
  await pickTheme("b0");
  const dark1 = await looks();
  t.ok("Graphite again: dark", dark1.page < 60 && dark1.lbar < 80 && dark1.panel < 80, dark1);
  await p.context().close();
  await setUi({});

  // ---- the text snapshot ---------------------------------------------------------------------------------------
  p = await page({ label: "snapshot" });
  // Titles, aria-labels, placeholders and own text of every element under `sel`, in DOM order, leaving out `skip`
  // (file names, times, counts — what changes with the data, not with the code).
  const texts = (sel, skip = []) => p.evaluate(([sel, skip]) => {
    const root = document.querySelector(sel);
    if (!root) return null;
    const out = [];
    const walk = (e) => {
      if (skip.some((s) => e.matches(s))) return;
      for (const a of ["title", "aria-label", "placeholder"]){ const v = e.getAttribute(a); if (v) out.push(`${a}: ${v}`); }
      if (e.tagName === "OPTION" || e.tagName === "OPTGROUP") out.push("option: " + (e.label || e.textContent).trim());
      let own = "";
      for (const n of e.childNodes) if (n.nodeType === 3) own += n.textContent;
      own = own.replace(/\s+/g, " ").trim();
      if (own && e.tagName !== "STYLE" && e.tagName !== "SCRIPT" && e.tagName !== "OPTION") out.push("text: " + own);
      for (const c of e.children) walk(c);
    };
    walk(root);
    return out;
  }, [sel, skip]);
  const help = async () => {
    const card = await p.waitForSelector(".kh .kh-card", { timeout: 4000 }).catch(() => null);
    if (!card) return null;
    const v = await p.evaluate(() => { const c = [...document.querySelectorAll(".kh .kh-card")].pop(); return [c.querySelector(".kh-hh b").textContent, ...[...c.querySelectorAll("section")].map((s) => s.querySelector("h4").textContent + " | " + [...s.querySelectorAll(".kh-row")].map((r) => [...r.querySelectorAll("kbd")].map((k) => k.textContent).join(" / ") + " = " + r.lastElementChild.textContent).join(" | ")), c.querySelector(".kh-foot")?.textContent || ""]; });
    await p.keyboard.press("Escape");
    await until(p, async () => !(await p.$(".kh .kh-card")), 3000);
    return v;
  };
  const snap = {};
  const TOP_SKIP = [".count", "#count", ".crumbs", ".crumb", "#crumbs", ".badge", "#searchInp[value]"];
  snap["library.top"] = await texts(".main > .top", TOP_SKIP);
  await p.mouse.move(700, 450);
  await p.keyboard.press("Shift+Slash");
  snap["help.library"] = await help();
  // the lightbox, a picture
  await L.openLight(p, pic);
  await L.waitMedia(p, "image");
  snap["lightbox.bar.picture"] = await texts(".light .light-bar", [".t", "#lightHint", ".vmodes"]);
  await p.keyboard.press("Shift+Slash");
  snap["help.lightbox.picture"] = await help();
  await annotateOn(p);
  snap["annotator.top"] = await texts(".light .an-top");
  snap["review.panel"] = await texts(".light .an-panel", [".an-list", ".an-trks", ".an-ctx", ".an-pend", ".an-views", ".an-rsh", ".an-vers", ".an-filt", ".an-trk", "[data-act=user]", "[data-act=dict]", ".dict-lang"]);
  await p.keyboard.press("Shift+Slash");
  snap["help.annotator"] = await help();
  await p.keyboard.press("KeyA");
  await closeLight(p);
  // a video
  await L.openLight(p, V1);
  await L.waitMedia(p, "video");
  snap["lightbox.bar.video"] = await texts(".light .light-bar", [".t", "#lightHint", ".vmodes"]);
  snap["video.bar"] = await texts(".light .vbar", ["[data-cur]", "[data-dur]", ".vcaches", ".an-mk", ".vpop", "[data-mem]"]);
  await p.keyboard.press("Shift+Slash");
  snap["help.lightbox.video"] = await help();
  await closeLight(p);
  // the sequence
  await p.click(`.card[data-id="${V1}"]`);
  await p.click(`.card[data-id="${V2}"]`, { modifiers: ["Control"] });
  await p.click("#seqBtn");
  await p.waitForSelector(".light.on .seqbar:not([hidden])");
  await L.waitMedia(p, "video");
  snap["sequence.bar"] = await texts(".light .seqbar", [".seq-segs", ".seq-marks", "[data-gt]"]);
  await p.keyboard.press("Shift+Slash");
  snap["help.sequence"] = await help();
  await closeLight(p);
  // compare
  await p.click(`.card[data-id="${pic}"]`);
  await p.click(`.card[data-id="${pic2}"]`, { modifiers: ["Control"] });
  await p.keyboard.press("KeyK");
  await p.waitForSelector(".cmp .cmp-bar");
  snap["compare.bar"] = await texts(".cmp .cmp-bar", [".vmodes"]);
  await p.keyboard.press("Shift+Slash");
  snap["help.compare"] = await help();
  await p.keyboard.press("Escape");
  await p.keyboard.press("Escape");
  // the board
  await p.click(`.board-row[data-bid="${bid}"]`);
  await p.waitForSelector("#canvasView .citem");
  snap["board.top"] = await texts(".main > .top", TOP_SKIP);
  const vr = await rect(p, "#canvasView .canvas-viewport");
  await p.mouse.move(vr.l + vr.w / 2, vr.b - 30);
  await p.keyboard.press("Shift+Slash");
  snap["help.board"] = await help();
  await p.click("#boardAnnoBtn");
  await p.waitForSelector("#canvasView .an-top:not([hidden])");
  await p.mouse.move(vr.l + vr.w / 2, vr.b - 30);
  await p.keyboard.press("Shift+Slash");
  snap["help.board.annotator"] = await help();
  await p.click("#boardAnnoBtn");
  for (const [k, v] of Object.entries(snap)) t.ok(`snapshot: ${k} read`, Array.isArray(v) && v.length > 1, v && v.length);
  t.data = { snapshot: snap };
  await p.context().close();

  // ---- touch --------------------------------------------------------------------------------------------------
  await setUi({ "sight.theme": JSON.stringify({ uiScale: 1.75 }) });
  p = await page({ touch: true, label: "touch" });
  await p.tap("#helpBtn");
  t.ok("touch 1.75×: the ? button opens the library's list", !!(await p.waitForSelector(".kh .kh-card", { timeout: 4000 }).catch(() => null)));
  await p.tap(".kh .kh-x");
  t.ok("…its ✕ closes it", await until(p, async () => !(await p.$(".kh .kh-card"))));
  await L.openLight(p, pic, { touch: true });
  await L.waitMedia(p, "image");
  const [W] = await vw(p);
  t.eq("touch 1.75×: the lightbox's buttons on screen", await p.evaluate((W) => [...document.querySelectorAll(".light .light-bar button")].filter((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && (r.right > W + 1 || r.left < -1); }).length, W), 0);
  await p.context().close();
  await setUi({});
});
