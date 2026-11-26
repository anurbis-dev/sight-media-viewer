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

    // A file drag with no directory entry must stay a file drag — even when the MIME type is
    // empty or application/octet-stream, which is how WebView2 delivers plenty of real files.
    // dropKind() lives in index.html's module script (not on window), so drive the real capture
    // dragenter / dragover handler with a fake DataTransfer and read what it did to the overlay.
    const kinds = await p.evaluate(() => {
      const n = document.getElementById("srcDrop");
      const fake = (items, files, types) => ({ types: types || ["Files"], items, files: files || [] });
      const file = (type, entry) => ({ kind: "file", type, webkitGetAsEntry: () => entry });
      const probe = (type, dt, x, target) => {
        n.hidden = true; delete n.dataset.kind; delete n.dataset.hot;
        const ev = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(ev, "dataTransfer", { value: dt });
        Object.defineProperty(ev, "clientX", { value: x });
        Object.defineProperty(ev, "clientY", { value: 400 });
        (target || document.body).dispatchEvent(ev);
        const r = { shown: !n.hidden, kind: n.hidden ? "" : (n.dataset.kind || ""), hot: n.dataset.hot || "",
                    accepted: ev.defaultPrevented };
        n.hidden = true; delete n.dataset.kind; delete n.dataset.hot;
        return r;
      };
      return {
        octet: probe("dragover", fake([file("application/octet-stream", null)], [{}]), 900),
        emptyType: probe("dragenter", fake([file("", null)], [{}]), 900),
        image: probe("dragover", fake([file("image/png", null)], [{}]), 900),
        realFile: probe("dragover", fake([file("", { isFile: true, isDirectory: false })]), 40),
        folder: probe("dragover", fake([file("", { isFile: false, isDirectory: true })]), 900),
        noItems: probe("dragenter", fake([], []), 900),
        sight: probe("dragover", fake([], [], ["Files", "application/x-sight-ids"]), 900),
        // The window listener is a capture one, so a child that stops the event cannot block it.
        stopped: (() => {
          const c = document.body.appendChild(document.createElement("div"));
          c.addEventListener("dragover", (e) => e.stopPropagation());
          try { return probe("dragover", fake([file("", null)], [{}]), 900, c); } finally { c.remove(); }
        })(),
      };
    });
    const k = (o) => JSON.stringify(kinds[o]);
    for (const o of ["octet", "emptyType", "image", "noItems", "stopped"]){
      assert.deepStrictEqual(kinds[o], { shown: true, kind: "file", hot: "view", accepted: true }, o + " " + k(o));
    }
    assert.deepStrictEqual(kinds.realFile, { shown: true, kind: "file", hot: "library", accepted: true }, k("realFile"));
    assert.deepStrictEqual(kinds.folder, { shown: true, kind: "folder", hot: "", accepted: true }, k("folder"));
    assert.deepStrictEqual(kinds.sight, { shown: false, kind: "", hot: "", accepted: false }, k("sight"));

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
