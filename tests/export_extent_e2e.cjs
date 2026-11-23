// Drives tests/test_export_extent.py's server: exports the picture's notes as a ZIP (the payload is caught, not
// written) with the export backdrop on Auto and on a colour, then opens the clip's review panel twice (the frame
// made, then read from the store) and deletes its note. Prints a JSON report.
//   node tests/export_extent_e2e.cjs <sightBase> <imageId> <videoId>
"use strict";
const { chromium } = require("playwright");
const [base, img, vid] = process.argv.slice(2);
const res = { errors: [] };
const stored = async () => (await (await fetch(`${base}/api/review/nprev/${vid}`)).json()).keys;

async function openAsset(p, id){
  await p.goto(base + "/");
  await p.waitForSelector(`.card[data-id="${id}"]`, { timeout: 20000 });
  await p.dblclick(`.card[data-id="${id}"]`);
  await p.waitForSelector(".light", { state: "attached", timeout: 10000 });
  await p.waitForTimeout(800);
  await p.keyboard.press("KeyA");
  await p.waitForSelector(".an-top:not([hidden])", { timeout: 5000 });
  if (!(await p.$(".an-panel:not([hidden])"))) await p.keyboard.press("KeyC");
  await p.waitForSelector(".an-panel:not([hidden])", { timeout: 5000 });
  await p.waitForTimeout(300);
}
// Opens / closes the Export menu.
async function menu(p, open){
  const shown = await p.$eval(".an-menu:not(.an-trk)", (m) => !m.hidden);
  if (shown !== open) await p.click(".an-panel [data-act=export]");
}
// The cover picture of a ZIP export: its size, the colour at the left margin and inside the frame.
async function exportCover(p){
  let body = null;
  await p.route("**/api/review/export/zip", async (r) => { body = r.request().postDataJSON(); await r.fulfill({ json: { ok: true, path: "x", name: "x" } }); });
  await menu(p, true);
  await p.click('.an-menu [data-ex="zip"]');
  for (let i = 0; i < 100 && !body; i++) await p.waitForTimeout(100);
  await p.unroute("**/api/review/export/zip");
  return p.evaluate(async (url) => {
    const im = new Image(); im.src = url; await im.decode();
    const c = document.createElement("canvas"); c.width = im.width; c.height = im.height;
    const cx = c.getContext("2d"); cx.drawImage(im, 0, 0);
    const px = (x, y) => [...cx.getImageData(x, y, 1, 1).data.slice(0, 3)];
    const near = (a) => a.map((v) => Math.round(v / 5) * 5);  // JPEG
    return { size: [im.width, im.height], margin: near(px(10, 40)), frame: near(px(im.width - 10, 700)) };
  }, body.cover);
}

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  p.on("pageerror", (e) => res.errors.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/favicon|404/.test(m.text())) res.errors.push("console: " + m.text()); });
  await openAsset(p, img);
  await menu(p, true);
  await p.click('.an-menu [data-xbg="auto"]');
  res.autoOn = await p.$eval('.an-menu [data-xbg="auto"]', (b) => b.classList.contains("on"));
  res.auto = await exportCover(p);
  await menu(p, true);
  await p.$eval(".an-xbgc", (el) => { el.value = "#00ff00"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  res.colorOn = await p.$eval('.an-menu [data-xbg="color"]', (b) => b.classList.contains("on"));
  res.color = await exportCover(p);
  await p.evaluate(() => localStorage.removeItem("sight.annotate.exportBg"));

  await openAsset(p, vid);
  for (let i = 0; i < 100 && !(await stored()).length; i++) await p.waitForTimeout(100);
  res.stored = await stored();
  res.first = await p.$eval(".an-nprev img", (im) => im.getAttribute("src")?.slice(0, 30) || "");
  await openAsset(p, vid);
  await p.waitForFunction(() => document.querySelector(".an-nprev img")?.complete && document.querySelector(".an-nprev img").naturalWidth > 0, null, { timeout: 10000 });
  res.second = await p.$eval(".an-nprev img", (im) => im.getAttribute("src") || "");
  res.previewSize = await p.$eval(".an-nprev img", (im) => [im.naturalWidth, im.naturalHeight]);
  // The stored file deleted behind the page's back (another window's prune): the picture is made and stored again.
  await fetch(`${base}/api/review/nprev/${vid}/prune`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ keep: [] }) });
  await p.evaluate(() => { const im = document.querySelector(".an-nprev img"); im.src = im.getAttribute("src") + "&gone=1"; });
  for (let i = 0; i < 100 && !(await stored()).length; i++) await p.waitForTimeout(100);
  res.regen = await stored();
  await p.hover(".an-note"); await p.click(".an-note [data-del]", { force: true });
  await p.waitForTimeout(2500);
  res.afterDelete = await stored();
  await b.close();
  console.log(JSON.stringify(res));
})().catch((e) => { console.log(JSON.stringify({ ...res, fatal: String(e.stack || e) })); process.exit(1); });
