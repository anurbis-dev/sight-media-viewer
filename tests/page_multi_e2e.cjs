// Drives a multi-clip HTML reviewer page (review.build_html_all) in headless Chromium: replies on
// two clips (switching by the → key and the strip / prev button), downloads the reply (a bundle of
// both), discards one clip (a bundle of one), downloads one clip's reply (a plain package), the page
// copy (its reply), and finally discards all. Called by tests/test_review_page.py.
//   node tests/page_multi_e2e.cjs <page.html> <outdir>
"use strict";
const { chromium } = require("playwright");
const path = require("path");
const [page, outDir] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 900, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const log = [], res = {};
  p.on("pageerror", (e) => log.push("pageerror: " + e.message));
  p.on("dialog", (d) => { log.push("dialog: " + d.message()); d.dismiss(); });
  await p.goto("file://" + page);
  await p.fill("#gname", "Page Tester"); await p.click('#gform button[type="submit"]');
  const save = async (sel, name) => {
    const [dl] = await Promise.all([p.waitForEvent("download"), p.click(sel)]);
    const f = path.join(outDir, name); await dl.saveAs(f); return dl.suggestedFilename();
  };
  const reply = async (text, resolve) => {
    const note = p.locator(".note").first();
    await note.locator('button:has-text("Reply")').click();
    await note.locator("textarea").fill(text);
    if (resolve) await note.locator(".opt.done").click();
    await note.locator(".send").click();
    await p.waitForSelector(`.rep.mine:has-text("${text}")`);
  };
  res.strip = await p.locator("#strip .clipb").count();
  res.title1 = await p.textContent("#ttl");
  await reply("Clip one answered", true);
  await p.click("body", { position: { x: 5, y: 990 } });
  // → goes to the next clip (not from a text field); its own notes, none of clip one's replies.
  await p.evaluate(() => document.activeElement && document.activeElement.blur());
  await p.keyboard.press("ArrowRight");
  res.title2 = await p.textContent("#ttl");
  res.mineOn2 = await p.locator(".rep.mine").count();
  res.prevEnabled = await p.locator("#cprev").isEnabled();
  res.nextEnabled = await p.locator("#cnext").isEnabled();
  await reply("Clip two answered", false);
  // Typing → in a field does not switch clips.
  await p.locator(".note").first().locator('button:has-text("Reply")').click();
  await p.locator(".note textarea").first().press("ArrowLeft");
  res.titleAfterFieldKey = await p.textContent("#ttl");
  await p.click("body", { position: { x: 5, y: 990 } });
  res.status2 = await p.textContent("#status");
  res.changedMarks = await p.locator("#strip .clipb.ch").count();
  res.replyName = await save("#dl", "both.srev");
  // Discard this clip (clip two) only.
  await p.click("#reset");
  await p.click('.gate .btn:has-text("This clip")');
  res.status1 = await p.textContent("#status");
  res.mineAfterDiscard = await p.locator(".rep.mine").count();
  await save("#dl", "one.srev");
  // Back to clip one with the button: its reply is still there.
  await p.click("#cprev");
  res.titleBack = await p.textContent("#ttl");
  res.mineBack = await p.locator(".rep.mine").count();
  // This clip's reply (a plain package), from the clip's details.
  await p.click("#hd");
  await save("#dlclip", "clip.srev");
  // The page copy keeps clip one's reply and replies with a bundle of it.
  await save("#dlpage", "copy.html");
  const c = await ctx.newPage();
  c.on("pageerror", (e) => log.push("copy pageerror: " + e.message));
  await c.goto("file://" + path.join(outDir, "copy.html"));
  if (await c.locator("#gate").isVisible()){ await c.fill("#gname", "Page Tester"); await c.click('#gform button[type="submit"]'); }
  res.copyStrip = await c.locator("#strip .clipb").count();
  res.copyMine = await c.locator(".rep.mine").count();
  res.copyStatus = await c.textContent("#status");
  const [cd] = await Promise.all([c.waitForEvent("download"), c.click("#dl")]);
  await cd.saveAs(path.join(outDir, "copy.srev"));
  // Discard all.
  await p.click("#reset");
  await p.click('.gate .btn:has-text("All clips")');
  res.statusEnd = await p.textContent("#status");
  res.dlEnd = await p.locator("#dl").isDisabled();
  await p.reload();
  res.mineReload = await p.locator(".rep.mine").count();
  res.log = log;
  process.stdout.write(JSON.stringify(res));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
