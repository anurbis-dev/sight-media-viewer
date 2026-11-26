// Shared helpers of the R0-0 regression page scripts (tests/r0_harness.py runs them). A script calls
// run(async (cfg, t) => { ... }): cfg is the JSON argument ({base, ids, shots, ...}); t collects checks and page
// errors and prints the report ({checks, errors, done, fatal, data}) as the last line of stdout; t.data (any JSON)
// carries what a script hands back to its Python test (e.g. rows for a golden file).
// The selectors used here are the user-facing contract the R0 refactor must keep (docs/PLAN-coreline.md).
"use strict";
const path = require("path");
const { chromium } = require("playwright");

const near = (a, b, tol) => Math.abs(a - b) <= tol;
// The browser: Playwright's own Chromium, except on Windows, where that build has no H.264 (every MP4 test clip
// would stay black) and Sight itself opens in Edge (Sight.py) — so Edge there. SIGHT_PW_CHANNEL overrides it
// ("" = Playwright's Chromium, "chrome", "msedge").
const CHANNEL = process.env.SIGHT_PW_CHANNEL ?? (process.platform === "win32" ? "msedge" : "");

function tracker(){
  const t = { checks: {}, errors: [], done: false };
  // ok(name, cond, got, want): one named check; the same name twice keeps the first failure.
  t.ok = (name, cond, got, want) => {
    const prev = t.checks[name];
    if (prev && !prev.ok) return !!cond;
    t.checks[name] = { ok: !!cond, got: got === undefined ? null : got, want: want === undefined ? null : want };
    return !!cond;
  };
  t.eq = (name, got, want) => t.ok(name, JSON.stringify(got) === JSON.stringify(want), got, want);
  t.near = (name, got, want, tol) => t.ok(name, typeof got === "number" && near(got, want, tol), got, `${want} ± ${tol}`);
  t.watch = (p, label) => {
    p.on("pageerror", (e) => t.errors.push(`${label || "page"}: ${e.message}`));
    p.on("console", (m) => {
      if (m.type() === "error" && !/favicon|status of 404/.test(m.text())) t.errors.push(`${label || "page"} console: ${m.text()}`);
    });
  };
  return t;
}

function run(body){
  const cfg = JSON.parse(process.argv[2] || "{}");
  const t = tracker();
  let browser = null;
  t.browser = async () => (browser = browser || await chromium.launch(CHANNEL ? { channel: CHANNEL } : {}));
  (async () => {
    await body(cfg, t);
    t.done = true;
  })().catch((e) => { t.fatal = String(e && e.stack || e); })
    .finally(async () => {
      try { if (browser) await browser.close(); } catch {}
      delete t.browser;
      process.stdout.write("\n" + JSON.stringify({ checks: t.checks, errors: t.errors, done: t.done, fatal: t.fatal || null, data: t.data ?? null }) + "\n");
      process.exit(0);
    });
}

// A fresh page: desktop (1400 x 900) or a phone-size touch screen (390 x 844, hasTouch, isMobile).
async function newPage(t, cfg, { touch = false, mobile = true, viewport, label, storage } = {}){
  const b = await t.browser();
  const ctx = await b.newContext(touch
    ? { viewport: viewport || (mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }), hasTouch: true, isMobile: mobile, deviceScaleFactor: 1 }
    : { viewport: viewport || { width: 1400, height: 900 } });
  if (storage) await ctx.addInitScript((kv) => { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); }, storage);
  // Sound actually played through Web Audio (scrub sound): window.__abStarts counts AudioBufferSourceNode starts.
  await ctx.addInitScript(() => {
    window.__abStarts = 0;
    const st = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...a){ window.__abStarts++; return st.apply(this, a); };
  });
  const p = await ctx.newPage();
  t.watch(p, label || (touch ? "touch" : "page"));
  await p.goto(cfg.base + "/");
  await p.waitForSelector(".card[data-id]", { timeout: 30000 });
  return p;
}

async function shot(cfg, p, name){ if (cfg.shots) await p.screenshot({ path: path.join(cfg.shots, name) }); }

// Opens an asset in the lightbox the way a person does: a double-click on its card (touch: two taps).
async function openLight(p, id, { touch = false } = {}){
  const sel = `.card[data-id="${id}"]`;
  await p.waitForSelector(sel, { timeout: 20000 });
  await p.locator(sel).scrollIntoViewIfNeeded();
  if (touch){ await p.tap(sel); await p.waitForTimeout(120); await p.tap(sel); }
  else await p.dblclick(sel);
  await p.waitForSelector(".light.on", { timeout: 10000 });
}
// Waits until the lightbox's picture / video is ready: an image decoded and faded in, a video with metadata.
async function waitMedia(p, kind){
  if (kind === "video") await p.waitForFunction(() => { const v = document.querySelector(".light .view-media"); return v && v.tagName === "VIDEO" && v.readyState >= 2 && v.videoWidth > 0; }, null, { timeout: 30000 });
  else await p.waitForFunction(() => { const m = document.querySelector(".light img.view-media"); return m && m.complete && m.naturalWidth > 0 && !m.classList.contains("loading"); }, null, { timeout: 20000 });
  await p.waitForTimeout(150);
}
const lightTitle = (p) => p.$eval(".light .light-bar .t", (e) => e.textContent);
const lightGone = (p) => p.waitForFunction(() => !document.querySelector(".light"), null, { timeout: 5000 }).then(() => true, () => false);
const hud = (p) => p.$eval(".light .view-hud", (e) => e.textContent);

// The lightbox media's box on the page and its native size: doc (picture px) -> page px, for an unturned view.
async function mediaBox(p){
  return p.evaluate(() => {
    const m = document.querySelector(".light .view-media");
    const r = m.getBoundingClientRect();
    const w = m.tagName === "VIDEO" ? m.videoWidth : m.naturalWidth, h = m.tagName === "VIDEO" ? m.videoHeight : m.naturalHeight;
    return { left: r.left, top: r.top, width: r.width, height: r.height, w, h, s: r.width / w };
  });
}
const docToPage = (box, x, y) => [box.left + x * box.width / box.w, box.top + y * box.height / box.h];
const pageToDoc = (box, x, y) => [(x - box.left) * box.w / box.width, (y - box.top) * box.h / box.height];

// The lightbox video's state.
const vstate = (p) => p.evaluate(() => {
  const v = document.querySelector(".light video.view-media");
  if (!v) return null;
  return { t: v.currentTime, paused: v.paused, dur: v.duration, loop: v.loop, muted: v.muted, vol: v.volume, w: v.videoWidth, h: v.videoHeight, src: v.currentSrc || v.src, seeking: v.seeking };
});
// Waits until the lightbox video plays (autoplay may start a moment after the first frame).
const vplaying = (p) => p.waitForFunction(() => { const v = document.querySelector(".light video.view-media"); return v && !v.paused && v.currentTime > 0; }, null, { timeout: 10000 }).then(() => true, () => false);
// Waits for the video to settle (not seeking) and returns its state.
async function vsettled(p){
  await p.waitForFunction(() => { const v = document.querySelector(".light video.view-media"); return v && !v.seeking && v.readyState >= 2; }, null, { timeout: 10000 });
  await p.waitForTimeout(80);
  return vstate(p);
}
const bar = (p) => p.evaluate(() => {
  const b = document.querySelector(".light .vbar");
  if (!b) return null;
  return { hidden: b.hidden, cur: b.querySelector("[data-cur]").textContent, dur: b.querySelector("[data-dur]").textContent,
    head: parseFloat(b.querySelector(".vplay").style.left), marks: [...b.querySelectorAll(".an-mk")].map((m) => ({ t: Number(m.dataset.t), note: m.classList.contains("note") })) };
});
async function api(cfg, p, opts){
  const r = await fetch(cfg.base + p, opts && opts.body !== undefined ? { method: opts.method || "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(opts.body) } : opts);
  const txt = await r.text();
  try { return JSON.parse(txt); } catch { return txt; }
}
const rows = (cfg, aid) => api(cfg, "/api/annotations?asset_id=" + aid);

// Two fingers on the page through the DevTools protocol (real touch input; Playwright has no multi-touch API).
async function pinch(p, cx, cy, d0, d1, steps = 8){
  const cdp = await p.context().newCDPSession(p);
  const pts = (d) => [{ x: cx - d / 2, y: cy, id: 1 }, { x: cx + d / 2, y: cy, id: 2 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(d0) });
  for (let i = 1; i <= steps; i++){
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(d0 + (d1 - d0) * i / steps) });
    await p.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}
// One finger dragged through the DevTools protocol (a touch pointer, not a mouse).
async function touchDrag(p, x0, y0, x1, y1, steps = 10, holdMs = 0){
  const cdp = await p.context().newCDPSession(p);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0, id: 1 }] });
  if (holdMs) await p.waitForTimeout(holdMs);
  for (let i = 1; i <= steps; i++){
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps, id: 1 }] });
    await p.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

module.exports = { run, newPage, shot, openLight, waitMedia, lightTitle, lightGone, hud, mediaBox, docToPage, pageToDoc,
  vstate, vsettled, vplaying, bar, api, rows, pinch, touchDrag, near };
