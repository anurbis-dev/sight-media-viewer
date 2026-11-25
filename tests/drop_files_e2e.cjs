// Drop-file overlay zones + POST /api/files/drop library / view.
//   node tests/drop_files_e2e.cjs http://127.0.0.1:PORT /abs/path/to/file.png
"use strict";
const assert = require("assert");
const { chromium } = require("playwright");

const BASE = process.argv[2];
const FILE = process.argv[3];

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await p.goto(BASE);
    await p.waitForSelector("#add");
    const el = p.locator("#srcDrop");
    assert.ok(await el.isHidden());
    await p.evaluate(() => {
      const n = document.getElementById("srcDrop");
      n.hidden = false;
      n.dataset.kind = "file";
      n.dataset.hot = "view";
    });
    assert.ok(await el.isVisible());
    assert.match(await p.locator(".src-drop-lib").innerText(), /Add to library/);
    assert.match(await p.locator(".src-drop-view").innerText(), /Open to view/);
    const libW = await p.evaluate(() => document.querySelector(".src-drop-lib").getBoundingClientRect().width);
    assert.ok(libW >= 160, "library zone should match the sidebar width, got " + libW);
    await p.evaluate(() => { document.getElementById("srcDrop").hidden = true; });

    const viewed = await p.evaluate(async (path) => {
      const r = await fetch("/api/files/drop", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ paths: [path], names: [], mode: "view" }),
      });
      return r.json();
    }, FILE);
    assert.strictEqual(viewed.items.length, 1, JSON.stringify(viewed));
    assert.strictEqual(viewed.items[0].ephemeral, true);

    const added = await p.evaluate(async (path) => {
      const r = await fetch("/api/files/drop", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ paths: [path], names: [], mode: "library" }),
      });
      return r.json();
    }, FILE);
    assert.strictEqual(added.items.length, 1, JSON.stringify(added));
    assert.strictEqual(added.items[0].new, true);
    await p.reload();
    await p.waitForSelector("#add");
    const n = await p.locator(".src-row", { hasText: "Dropped files" }).count();
    assert.ok(n >= 1, "Dropped files source missing after library drop");
    process.stdout.write(JSON.stringify({ ok: true, name: added.items[0].name, id: added.items[0].id }));
  } finally {
    await b.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
