// Drives the shared drawing canvas (app/static/review-draw.js) alone in headless Chromium: draws a
// brush stroke, selects it, and checks Ctrl+C / Ctrl+V / Ctrl+X (exact modifiers, one undo step
// each, the first paste after a cut in place unless an undo brought it back, a copy across two
// opens) and the Cut / Copy / Paste buttons. Called by
// tests/test_review_page.py.  node tests/draw_clip.cjs <repo root>
"use strict";
const fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const root = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 900, height: 700 } });
  const log = [], res = {};
  p.on("pageerror", (e) => log.push("pageerror: " + e.message));
  const js = ["review-core.js", "review-draw.js"].map((f) => fs.readFileSync(path.join(root, "app/static", f), "utf8")).join("\n;\n");
  const svg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#246"/></svg>');
  await p.setContent(`<!doctype html><body><script>${js}</script></body>`);
  const count = () => p.evaluate(() => document.querySelectorAll(".draw .dbox svg g")[1].childElementCount);
  // onDone's drawings land in window.__res.
  await p.evaluate((src) => { window.__res = null; window.__h = SightReviewDraw.open({ src, vb: [0, 0, 1200, 800], base: [], items: [], onDone: (its) => { window.__res = its; }, onCancel: () => {} }); }, svg);
  await p.waitForSelector(".draw");
  await p.waitForFunction(() => document.querySelector(".draw img").complete);
  await p.waitForTimeout(200);
  await p.keyboard.press("KeyB");  // (a click on the tool in hand would put it down)
  const vb = await p.locator(".draw .dview").boundingBox();
  const cx = vb.x + vb.width / 2, cy = vb.y + vb.height / 2;
  await p.mouse.move(cx - 60, cy); await p.mouse.down(); await p.mouse.move(cx + 60, cy + 20, { steps: 8 }); await p.mouse.up();
  res.drawn = await count();
  await p.keyboard.press("KeyV");  // select tool
  await p.mouse.move(cx - 120, cy - 80); await p.mouse.down(); await p.mouse.move(cx + 120, cy + 90, { steps: 6 }); await p.mouse.up();  // marquee
  res.selected = await p.evaluate(() => !!document.querySelector(".draw .dbox svg g:last-child").childElementCount);
  await p.keyboard.press("Control+Shift+KeyV"); res.afterShiftV = await count();  // not a paste
  await p.keyboard.press("Control+KeyV"); res.pasteEmpty = await count();        // nothing copied yet
  await p.keyboard.press("Control+KeyC"); await p.keyboard.press("Control+KeyV"); res.afterPaste = await count();
  await p.keyboard.press("Control+KeyV"); res.afterPaste2 = await count();
  await p.keyboard.press("Control+KeyX"); res.afterCut = await count();
  await p.keyboard.press("Control+KeyV"); res.afterCutPaste = await count();  // in place
  await p.keyboard.press("Control+KeyZ"); res.undoPaste = await count();
  await p.keyboard.press("Control+KeyZ"); res.undoCut = await count();
  await p.keyboard.press("Control+KeyY"); await p.keyboard.press("Control+KeyY"); res.redone = await count();
  const lastX = () => p.evaluate(() => { const g = document.querySelectorAll(".draw .dbox svg g")[1]; return g.lastElementChild.getBoundingClientRect().x; });
  await p.keyboard.press("Control+KeyV");  // (undo / redo drop the selection; a paste selects)
  const x0 = await lastX();
  await p.keyboard.press("Control+KeyX"); await p.keyboard.press("Control+KeyZ"); await p.keyboard.press("Control+KeyV");
  res.cutUndoPaste = await count(); res.twinOff = (await lastX()) > x0 + 5;
  await p.click(".draw .btn.primary");
  res.items = await p.evaluate(() => window.__res);
  // A second canvas (another picture) pastes the clipboard too.
  await p.evaluate((src) => { window.__res = null; SightReviewDraw.open({ src, vb: [0, 0, 1200, 800], base: [], items: [], onDone: (its) => { window.__res = its; }, onCancel: () => {} }); }, svg);
  await p.waitForSelector(".draw");
  await p.keyboard.press("Control+KeyV"); res.secondOpen = await count();
  const bar = () => p.evaluate(() => !document.querySelector(".draw .dclip").hidden);
  res.barSelect = await bar();
  await p.click('.draw .dclip button[title="Copy"]'); await p.click('.draw .dclip button[title="Paste"]'); res.btnPaste = await count();
  await p.click('.draw .dclip button[title="Cut"]'); res.btnCut = await count();
  await p.click('.draw .dclip button[title="Paste"]'); await p.keyboard.press("Control+KeyZ");  // back to one
  await p.keyboard.press("KeyB"); res.barBrush = await bar();
  await p.click(".draw .btn.primary");
  res.items2 = await p.evaluate(() => window.__res);
  res.log = log;
  process.stdout.write(JSON.stringify(res));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
