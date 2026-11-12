// Drives the HTML reviewer page (review.build_html) in headless Chromium: the reviewer replies to
// the note with text, a picture and a drawing, resolves it, adds a new note drawn on the picture,
// and downloads the reply file. Called by tests/test_review_page.py.
//   node tests/page_e2e.cjs <page.html> <out.srev> <picture>
"use strict";
const { chromium } = require("playwright");
const [page, out, picture] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 900, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const log = [], res = {};
  p.on("pageerror", (e) => log.push("pageerror: " + e.message));
  await p.goto("file://" + page);
  await p.fill("#gname", "Page Tester"); await p.click('#gform button[type="submit"]');
  res.coverOverlay = await p.locator(".cover-w .ov").count();
  const draw = async (tool, a, z) => {
    await p.waitForSelector(".draw");
    res.canvasBase = (res.canvasBase || 0) + await p.evaluate(() => document.querySelector(".draw .dbox svg g").childNodes.length);
    // Arrows and shapes sit in their slot's row (a tap on the slot shows it).
    const slot = { Arrow: "Arrows and lines", Rectangle: "Shapes", Ellipse: "Shapes" }[tool];
    if (slot){
      await p.click(`.draw .dtools button[title="${slot}"]`);
      if (!await p.locator(".draw .dfly:not([hidden])").count()) await p.click(`.draw .dtools button[title="${slot}"]`);
      await p.click(`.draw .dfly button[title="${tool}"]`);
    } else await p.click(`.draw button[title="${tool}"]`);
    const vb = await p.locator(".draw .dview").boundingBox();
    const cx = vb.x + vb.width / 2, cy = vb.y + vb.height / 2;
    await p.mouse.move(cx + a[0], cy + a[1]); await p.mouse.down(); await p.mouse.move(cx + z[0], cy + z[1], { steps: 6 }); await p.mouse.up();
    await p.click(".draw .btn.primary");
  };
  // Reply: text, a picture, a drawing, and resolve.
  const note = p.locator(".note").first();
  await note.locator('button:has-text("Reply")').click();
  await note.locator("textarea").fill("Fixed — see the picture");
  await note.locator('.cmp input[type="file"]').setInputFiles(picture);
  await p.waitForSelector(".note .field .atts img");
  await note.locator(".pen").click();
  await draw("Rectangle", [-80, -50], [80, 50]);
  await note.locator(".opt.done").click();
  await note.locator(".send").click();
  await p.waitForSelector(".rep.mine");
  // A new note drawn on the picture.
  await p.click("#add");
  await p.locator('.compose .pen').click();
  await draw("Arrow", [-100, 60], [0, 0]);
  await p.fill(".compose textarea", "New from the page");
  await p.click(".compose .send");
  await p.waitForSelector('.note:has-text("New from the page")');
  res.replyPics = await p.evaluate(() => [...document.querySelectorAll(".rep.mine .shots img, .rep.mine .fw img")].length);
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#dl")]);
  await dl.saveAs(out);
  res.log = log;
  process.stdout.write(JSON.stringify(res));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
