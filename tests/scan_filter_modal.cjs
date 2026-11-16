// Settings → Scan Filtering → "Default filters" modal. Run against a dev server with a scratch SIGHT_HOME:
//   node tests/scan_filter_modal.cjs http://127.0.0.1:8632
"use strict";
const assert = require("assert");
const { chromium } = require("playwright");

const BASE = process.argv[2] || "http://127.0.0.1:8632";
const get = async (p) => (await fetch(BASE + p)).json();

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    const shipped = (await get("/api/scan/defaults")).text;
    assert.ok(shipped.includes("Thumbs.db"));
    await p.goto(BASE);
    await p.waitForSelector("#settingsHead");
    if (await p.locator("#settingsBody[hidden]").count()) await p.click("#settingsHead");
    assert.ok((await p.locator(".settings-sub", { hasText: "Scan Filtering" }).count()) === 1);

    // Open: the text is there, Restore is hidden (no user copy yet).
    await p.click("#scanDefaults"); await p.waitForSelector("#dfOverlay:not([hidden])");
    await p.waitForSelector("#dfOverlay:not([hidden])");
    assert.strictEqual(await p.inputValue("#dfText"), shipped);
    assert.ok(await p.locator("#dfRestore").isHidden());

    // Esc, backdrop and the X close it.
    await p.keyboard.press("Escape");
    assert.ok(await p.locator("#dfOverlay").isHidden());
    await p.click("#scanDefaults"); await p.waitForSelector("#dfOverlay:not([hidden])");
    await p.mouse.click(5, 5);
    assert.ok(await p.locator("#dfOverlay").isHidden());
    await p.click("#scanDefaults"); await p.waitForSelector("#dfOverlay:not([hidden])");
    await p.click("#dfClose");
    assert.ok(await p.locator("#dfOverlay").isHidden());

    // Edit + Save: GET returns the edit, Restore becomes available.
    await p.click("#scanDefaults"); await p.waitForSelector("#dfOverlay:not([hidden])");
    await p.fill("#dfText", shipped + "\n*.zzz\n");
    await p.click("#dfSave");
    await p.waitForSelector("#dfOverlay", { state: "hidden" });
    assert.match(await p.textContent("#scanIgnoreMsg"), /rescanning/);
    const saved = await get("/api/scan/defaults");
    assert.strictEqual(saved.custom, true);
    assert.ok(saved.text.includes("*.zzz"));

    // Restore (confirm) returns the shipped text.
    await p.click("#scanDefaults"); await p.waitForSelector("#dfOverlay:not([hidden])");
    await p.waitForSelector("#dfRestore:not([hidden])");
    p.once("dialog", (d) => d.accept());
    await p.click("#dfRestore");
    await p.waitForSelector("#dfOverlay", { state: "hidden" });
    const back = await get("/api/scan/defaults");
    assert.strictEqual(back.custom, false);
    assert.strictEqual(back.text, shipped);
    console.log("scan_filter_modal: OK");
  } finally {
    await b.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
