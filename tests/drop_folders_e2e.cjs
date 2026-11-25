// Drop-folder sources: overlay markup, POST /api/sources/drop, sidebar row.
//   node tests/drop_folders_e2e.cjs http://127.0.0.1:PORT /abs/path/to/folder FolderName
"use strict";
const assert = require("assert");
const { chromium } = require("playwright");

const BASE = process.argv[2];
const FOLDER = process.argv[3];
const NAME = process.argv[4];

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await p.goto(BASE);
    await p.waitForSelector("#add");
    assert.ok(await p.locator("#srcDrop").isHidden());
    await p.evaluate(() => { document.getElementById("srcDrop").hidden = false; });
    assert.ok(await p.locator("#srcDrop").isVisible());
    assert.match(await p.locator("#srcDrop").innerText(), /Drop folders to add them as sources/);
    await p.evaluate(() => { document.getElementById("srcDrop").hidden = true; });

    const body = await p.evaluate(async ({ path, name }) => {
      const r = await fetch("/api/sources/drop", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ paths: [path], names: [name] }),
      });
      return r.json();
    }, { path: FOLDER, name: NAME });
    assert.strictEqual(body.added.length, 1, JSON.stringify(body));
    assert.strictEqual(body.added[0].new, true);
    await p.reload();
    await p.waitForSelector("#add");
    const n = await p.locator(".src-row", { hasText: NAME }).count();
    assert.ok(n >= 1, "source row missing after drop");
    const empty = await p.locator(".empty").textContent().catch(() => "");
    process.stdout.write(JSON.stringify({ ok: true, name: body.added[0].name, empty: empty || null }));
  } finally {
    await b.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
