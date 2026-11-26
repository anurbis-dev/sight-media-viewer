// R0a (docs/PLAN-coreline.md): annotate.js under a host that is not Sight — tests/r0a_host.html, served at
// /__r0a/host.html on Sight's dev server (same origin as /static/annotate.js), with a fake store that records every
// call. Checks:
//   queue     the write queue is keyed by the store (`store.queue.prefix`): a failed write waits under that prefix,
//             never under Sight's `sight-annot-outbox:v2:`; a closed window's queue of the same prefix is adopted
//             and sent through the store; Sight's v1 / v2 keys and another user's prefix (also a longer one that
//             starts with this prefix) are left alone; a second annotator with another store object is refused;
//             no prefix = `annot-outbox:<store.kind>:`.
"use strict";
const fs = require("fs");
const path = require("path");
const { run } = require("./r0_lib.cjs");

const HOST_HTML = fs.readFileSync(path.join(__dirname, "r0a_host.html"), "utf8");
const ID = (n) => n.toString(16).padStart(16, "0");

run(async (cfg, t) => {
  const b = await t.browser();
  async function hostPage(query, storage){
    const ctx = await b.newContext({ viewport: { width: 1200, height: 800 } });
    await ctx.route(cfg.base + "/__r0a/host.html*", (r) => r.fulfill({ status: 200, contentType: "text/html", body: HOST_HTML }));
    if (storage) await ctx.addInitScript((kv) => { if (!sessionStorage.getItem("__seeded")){ sessionStorage.setItem("__seeded", "1"); for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); } }, storage);
    const p = await ctx.newPage();
    t.watch(p, "host" + (query || ""));
    await p.goto(cfg.base + "/__r0a/host.html" + (query || ""));
    await p.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
    return p;
  }
  const keys = (p) => p.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; });
  async function stroke(p, x0, y0, x1, y1){
    await p.evaluate(() => { if (!window.A.isOn()) window.A.toggle(true); });
    await p.mouse.move(x0, y0); await p.mouse.down();
    for (let i = 1; i <= 8; i++) await p.mouse.move(x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8);
    await p.mouse.up();
  }
  const writes = (p) => p.evaluate(() => window.__log.filter((x) => x.m === "writeRow").map((x) => x.a));

  // ---- queue keyed by the store ----
  {
    const P = "fakehost:u1:outbox:";
    const sightV2 = JSON.stringify({ ts: 0, entries: [[ID(0xa1), { op: "put", create: true, at: 1, key: "s", body: { id: ID(0xa1), scope: "asset", target_asset_id: "s", kind: "stroke", data: {} } }]] });
    const sightV1 = JSON.stringify([[ID(0xa2), { op: "del", key: "s" }]]);
    const mine = JSON.stringify({ ts: 0, entries: [[ID(0xb1), { op: "put", create: true, at: 2, key: "fake-asset-1", body: { id: ID(0xb1), scope: "asset", target_asset_id: "fake-asset-1", kind: "stroke", shape_kind: "brush", z_index: 0, data: { pts: [1, 1, 0.5, 9, 9, 0.5], color: "#ff0000", size: 4 } } }]] });
    const other = JSON.stringify({ ts: 0, entries: [[ID(0xc1), { op: "del", key: "x" }]] });
    const p = await hostPage("?prefix=" + encodeURIComponent(P), {
      "sight-annot-outbox:v2:oldwin": sightV2, "sight-annot-outbox:v1": sightV1,
      [P + "closedwin"]: mine, "fakehost:u2:outbox:closedwin": other, [P + "x:closedwin"]: other,
    });
    // adopted at the start, sent 1.5 s later through the store
    await p.waitForFunction(() => window.__log.some((x) => x.m === "writeRow"), null, { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(400);
    const w = await writes(p);
    t.eq("the closed window's queue of this prefix is sent through store.writeRow (one create)", w.map((x) => [x.req.op, x.req.id]), [["create", ID(0xb1)]]);
    let k = await keys(p);
    t.ok("…and its key is gone", !((P + "closedwin") in k), Object.keys(k));
    t.eq("Sight's v2 and v1 keys are left alone", [k["sight-annot-outbox:v2:oldwin"], k["sight-annot-outbox:v1"]], [sightV2, sightV1]);
    t.eq("another user's prefix is left alone", k["fakehost:u2:outbox:closedwin"], other);
    t.eq("…also one that starts with this prefix (a user \"u1:x\")", k[P + "x:closedwin"], other);
    // a failed write waits under this prefix
    await p.evaluate(() => { window.__fail = true; });
    await stroke(p, 100, 100, 300, 200);
    await p.waitForFunction(() => window.__log.filter((x) => x.m === "writeRow").length >= 2, null, { timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(300);
    k = await keys(p);
    const ours = (x) => x.startsWith(P) && !x.slice(P.length).includes(":");   // this store's window keys
    const mineNow = Object.keys(k).filter(ours);
    t.eq("a failed write is kept under the store's prefix (one window key)", mineNow.length, 1);
    const ent = mineNow.length ? JSON.parse(k[mineNow[0]]).entries : [];
    t.ok("…holding the new stroke (a create)", ent.length === 1 && ent[0][1].create === true && ent[0][1].body.kind === "stroke", ent);
    t.eq("…and no new Sight outbox key", Object.keys(k).filter((x) => x.startsWith("sight-annot-outbox:")).sort(), ["sight-annot-outbox:v1", "sight-annot-outbox:v2:oldwin"]);
    await p.evaluate(() => { window.__fail = false; });
    await p.waitForFunction((P) => !Object.keys(localStorage).some((x) => x.startsWith(P) && !x.slice(P.length).includes(":")), P, { timeout: 40000 }).catch(() => {});
    k = await keys(p);
    t.ok("back online: it is sent and the key goes", !Object.keys(k).some(ours), Object.keys(k));
    // one queue per page
    const second = await p.evaluate(async () => {
      const { createAnnotator } = await import("/static/annotate.js");
      const res = {};
      try { createAnnotator({ store: { ...window.__store, queue: { prefix: "fakehost:u9:outbox:" } }, getSetting: () => null, putSetting(){}, author: () => "" }); res.other = "made"; } catch (e){ res.other = String(e.message); }
      try { createAnnotator({ store: { ...window.__store }, getSetting: () => null, putSetting(){}, author: () => "" }); res.copy = "made"; } catch (e){ res.copy = String(e.message); }
      try { createAnnotator({ store: window.__store, getSetting: () => null, putSetting(){}, author: () => "" }); res.same = "made"; } catch (e){ res.same = String(e.message); }
      return res;
    });
    t.ok("a second annotator with another store (another queue prefix) is refused", /one write queue per page/.test(second.other), second.other);
    t.ok("…so is another store object with the same prefix", /one write queue per page/.test(second.copy), second.copy);
    t.eq("…one with the same store is made", second.same, "made");
    await p.context().close();
  }
  {
    // no queue prefix: annot-outbox:<kind>:
    const p = await hostPage("", null);
    await p.evaluate(() => { window.__fail = true; });
    await stroke(p, 100, 100, 300, 200);
    await p.waitForFunction(() => Object.keys(localStorage).some((x) => x.startsWith("annot-outbox:fake:")), null, { timeout: 5000 }).catch(() => {});
    const k = await keys(p);
    t.eq("no store.queue: the key prefix is annot-outbox:<store.kind>:", Object.keys(k).filter((x) => x.includes("outbox")).map((x) => x.replace(/[0-9a-f]+$/, "")), ["annot-outbox:fake:"]);
    await p.context().close();
  }
});
