// R0a (docs/PLAN-coreline.md): annotate.js under a host that is not Sight — tests/r0a_host.html, served at
// /__r0a/host.html on Sight's dev server (same origin as /static/annotate.js), with a fake store that records every
// call. Checks:
//   queue     the write queue is keyed by the store (`store.queue.prefix`): a failed write waits under that prefix,
//             never under Sight's `sight-annot-outbox:v2:`; a closed window's queue of the same prefix is adopted
//             and sent through the store; Sight's v1 / v2 keys and another user's prefix (also a longer one that
//             starts with this prefix) are left alone; a second annotator with another store object is refused;
//             no prefix = `annot-outbox:<store.kind>:`.
//   stamps    every put carries created_at / updated_at (a create: both now; a change: the first created_at kept,
//             updated_at the write's time), a delete carries its time (`at`); a loaded row keeps its created_at.
//   undo      with mergesOnServer an undone note is stamped now field by field, so the merge (review-core
//             mergeRows) keeps the undo: a text edit by edited_at (it wins over another reviewer's edit made in
//             between), Resolve by status_at (edited_at untouched), an added reply becomes a tombstone (redo brings it
//             back, edited later). Without it (Sight's rule) the old stamps come back, the other edit wins, a reply
//             is dropped. A create still queued across a reopen keeps its created_at.
//   apply     A.applyRows(rows) applies rows by id without a reload: a changed row is shown and its undo steps are
//             dropped (Ctrl+Z writes nothing old back over it), other undo steps stay; a new row comes in; a tombstone
//             removes it (also one with a patch queued here, which is dropped); a row with a write still queued here,
//             an older copy, a row of another asset or with no target are left alone; while a note editor is open the
//             rows wait and apply after it closes (the typed text kept); the review state (set, cleared, an older one
//             than this window's own write ignored).
//   tokens    the annotator's CSS reads the host's tokens through --an-* (falling back to Sight's names): a host that
//             sets --an-fg / --an-surface on its frame sees them on the panel; without them Sight's --fg / --surface.
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
  // ---- stamps in every put ----
  {
    const p = await hostPage("?prefix=" + encodeURIComponent("fakehost:st:"), null);
    const t0 = Date.now();
    await stroke(p, 100, 100, 300, 200);
    await p.waitForFunction(() => window.__log.some((x) => x.m === "writeRow" && x.a.req.op === "create"), null, { timeout: 5000 }).catch(() => {});
    let w = await writes(p);
    const cr = w.find((x) => x.req.op === "create")?.req.body || {};
    t.ok("a create carries created_at and updated_at (now)", cr.created_at >= t0 && cr.updated_at >= cr.created_at && cr.updated_at <= Date.now(), [cr.created_at, cr.updated_at, t0]);
    // a change: select it, nudge it
    const id = cr.id;
    await p.waitForTimeout(30);
    const t1 = Date.now();
    await p.evaluate(() => { document.activeElement?.blur?.(); });
    await p.keyboard.press("v");
    await p.mouse.click(200, 150);
    await p.keyboard.press("ArrowRight");
    await p.waitForFunction((id) => window.__log.some((x) => x.m === "writeRow" && (x.a.req.op === "patch" && x.a.req.id === id || x.a.req.op === "batch" && x.a.req.items.some((i) => i.id === id))), id, { timeout: 5000 }).catch(() => {});
    w = await writes(p);
    const ch = w.map((x) => x.req.op === "patch" && x.req.id === id ? x.req.body : x.req.op === "batch" ? x.req.items.find((i) => i.id === id) : null).filter(Boolean)[0] || {};
    t.ok("a change carries updated_at (the write's time)", ch.updated_at >= t1 && ch.updated_at <= Date.now(), [ch.updated_at, t1]);
    t.ok("…and a patch never sends created_at (only obFields)", !("created_at" in ch), Object.keys(ch));
    // reload: the loaded row's created_at is kept in the next full write (an undo revive is a create)
    await p.evaluate(() => { const r = window.__rows.values().next().value; r.created_at = 1000; });
    await p.evaluate(() => { window.A.setAsset({ id: "fake-asset-1", kind: "image", ext: ".png", name: "fake.png", width: 800, height: 500 }); window.A.bind2d({ wrap: document.getElementById("wrap"), media: document.getElementById("pic"), isVid: false, geom: () => ({ x0: 0, y0: 0, s: 1, w: 800, h: 500 }) }); });
    await p.waitForTimeout(300);
    await p.mouse.click(210, 150);
    await p.keyboard.press("Delete");
    await p.waitForFunction((id) => window.__log.some((x) => x.m === "writeRow" && x.a.req.op === "delete" && x.a.req.id === id), id, { timeout: 5000 }).catch(() => {});
    const t2 = Date.now();
    await p.keyboard.press("Control+z");
    await p.waitForFunction((id) => window.__log.filter((x) => x.m === "writeRow" && x.a.req.op === "create" && x.a.req.id === id).length >= 2, id, { timeout: 5000 }).catch(() => {});
    w = await writes(p);
    const del = w.find((x) => x.req.op === "delete" && x.req.id === id)?.req || {};
    t.ok("a delete carries its time (at)", del.at > t1 && del.at <= t2, [del.at, t1, t2]);
    const rv = w.filter((x) => x.req.op === "create" && x.req.id === id).map((x) => x.req.body)[1] || {};
    t.eq("the undone delete is a create keeping the loaded created_at", rv.created_at, 1000);
    t.ok("…stamped with the undo's time (later than the delete)", rv.updated_at >= t2 && rv.updated_at > del.at, [rv.updated_at, del.at]);
    await p.context().close();
  }
  // ---- a create still queued when the file is opened again keeps its created_at ----
  {
    const p = await hostPage("?prefix=" + encodeURIComponent("fakehost:ov:"), null);
    await p.evaluate(() => { window.__fail = true; });
    await stroke(p, 100, 100, 300, 200);
    await p.waitForFunction(() => window.__log.some((x) => x.m === "writeRow" && x.a.req.op === "create"), null, { timeout: 5000 }).catch(() => {});
    const first = (await writes(p)).find((x) => x.req.op === "create")?.req.body || {}, c0 = first.created_at;
    await p.waitForTimeout(40);
    await p.evaluate(() => { window.A.setAsset({ id: "fake-asset-1", kind: "image", ext: ".png", name: "fake.png", width: 800, height: 500 }); window.A.bind2d({ wrap: document.getElementById("wrap"), media: document.getElementById("pic"), isVid: false, geom: () => ({ x0: 0, y0: 0, s: 1, w: 800, h: 500 }) }); });
    await p.waitForFunction(() => window.__log.filter((x) => x.m === "loadRows").length >= 2, null, { timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(200);
    await p.keyboard.press("v");
    await p.mouse.click(200, 150);
    await p.keyboard.press("ArrowRight");
    await p.evaluate(() => { window.__fail = false; });
    await p.waitForFunction(() => window.__rows.size > 0, null, { timeout: 40000 }).catch(() => {});
    const row = await p.evaluate(() => structuredClone([...window.__rows.values()][0] || null));
    t.ok("a create queued across a reopen keeps its first created_at (obOverlay)", row && typeof c0 === "number" && row.created_at === c0 && row.x > first.x, [row?.created_at, c0, row?.x, first.x]);
    await p.context().close();
  }
  // ---- apply rows by id ----
  {
    const p = await hostPage("?prefix=" + encodeURIComponent("fakehost:ap:") + "&merges=1", null);
    await stroke(p, 100, 100, 300, 200);
    await stroke(p, 400, 300, 600, 400);
    await p.waitForFunction(() => window.__rows.size === 2, null, { timeout: 5000 }).catch(() => {});
    const [s1, s2] = await p.evaluate(() => [...window.__rows.values()].sort((a, b) => a.x - b.x).map((r) => structuredClone(r)));
    await p.keyboard.press("v");
    await p.mouse.click(200, 150); await p.keyboard.press("ArrowRight");
    await p.mouse.click(500, 350); await p.keyboard.press("ArrowRight");
    await p.waitForFunction(([a, b]) => window.__rows.get(a).x > b, [s2.id, s2.x], { timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(400);
    await p.mouse.click(700, 480);  // nothing selected
    // s1 changed elsewhere: moved down 100 px
    const moved = await p.evaluate((id) => { const r = structuredClone(window.__rows.get(id)); r.data.pts = r.data.pts.map((v, i) => (i % 3 === 1 ? v + 100 : v)); r.y += 100; r.updated_at = Date.now(); return r; }, s1.id);
    const n0 = (await writes(p)).length;
    let ret = await p.evaluate((r) => window.A.applyRows([r]), moved);
    t.eq("applyRows returns the ids it changed", ret, [s1.id]);
    await p.evaluate(() => document.activeElement?.blur?.());
    await p.keyboard.press("Control+z");
    await p.waitForTimeout(500);
    let w = (await writes(p)).slice(n0);
    const ids = (x) => x.req.op === "batch" ? x.req.items.map((i) => i.id) : [x.req.id];
    t.ok("Ctrl+Z undoes the other stroke's nudge (its step kept)", w.some((x) => ids(x).includes(s2.id)), w.map((x) => [x.req.op, ids(x)]));
    await p.keyboard.press("Control+z");   // (kept steps: s2's create, then its nudge; s1's nudge would come between)
    await p.waitForTimeout(500);
    w = (await writes(p)).slice(n0);
    t.ok("…and never writes the changed row's old copy back (its steps are dropped)", !w.some((x) => ids(x).includes(s1.id)), w.map((x) => [x.req.op, ids(x)]));
    // the changed row is what the annotator now holds: select-all + delete removes it (a delete write for it)
    const n1 = (await writes(p)).length;
    // a new row and a tombstone
    const fresh = { ...structuredClone(s1), id: "00000000000000f1", created_at: Date.now(), updated_at: Date.now() };
    ret = await p.evaluate((f) => window.A.applyRows([f, { ...f, id: "00000000000000f2", target_asset_id: "another-asset" }]), fresh);
    t.eq("a new row comes in, another asset's row is ignored", ret, [fresh.id]);
    ret = await p.evaluate((f) => window.A.applyRows([{ ...f, id: "00000000000000f3" }]), fresh);
    ret = await p.evaluate((f) => window.A.applyRows([{ ...f, id: "00000000000000f3", deleted_at: Date.now() }, { ...f, id: "00000000000000f4", deleted_at: Date.now() }]), fresh);
    t.eq("a tombstone removes the row (one not held: nothing)", ret, ["00000000000000f3"]);
    await p.mouse.click(200, 250);   // the moved s1 (down 100 px)
    await p.keyboard.press("Delete");
    await p.waitForTimeout(400);
    w = (await writes(p)).slice(n1);
    t.ok("the applied copy is the one on screen (a click where it moved to selects it)", w.some((x) => x.req.op === "delete" && x.req.id === s1.id), w.map((x) => [x.req.op, ids(x)]));
    t.ok("…and applying rows wrote nothing by itself", !w.some((x) => x.req.op !== "delete"), w.map((x) => x.req.op));
    // a row with a write still queued here is left alone
    await p.evaluate(() => { window.__fail = true; });
    await p.mouse.click(200, 150);   // the new row f1 sits where s1 was
    await p.keyboard.press("ArrowRight");
    await p.waitForTimeout(500);
    ret = await p.evaluate((f) => window.A.applyRows([{ ...f, z_index: 9 }]), fresh);
    t.eq("a row with a write of this window still queued is not applied", ret, []);
    // …but its tombstone is: the row goes, with the queued patch
    ret = await p.evaluate((f) => window.A.applyRows([{ ...f, deleted_at: Date.now(), updated_at: Date.now() }]), fresh);
    t.eq("a tombstone of a row with a queued patch removes it", ret, [fresh.id]);
    const left = await p.evaluate((id) => Object.keys(localStorage).filter((k) => k.startsWith("fakehost:ap:")).some((k) => localStorage.getItem(k).includes(id)), fresh.id);
    t.ok("…and drops the queued patch", !left, left);
    await p.evaluate(() => { window.__fail = false; });
    // (a note first: it takes the loose drawings, so the row below stays loose and unwritten)
    await p.fill(".an-panel .an-input", "a note");
    await p.press(".an-panel .an-input", "Enter");
    await p.waitForSelector(".an-panel .an-note .an-nt", { timeout: 5000 });
    await p.waitForTimeout(800);
    // an older copy than the one held is not applied; rows with no target are not this file's
    const g = { ...structuredClone(fresh), id: "00000000000000f5", updated_at: Date.now() };
    await p.evaluate((g) => window.A.applyRows([g]), g);
    ret = await p.evaluate((g) => window.A.applyRows([{ ...g, z_index: 3, updated_at: g.updated_at - 1000 }, { ...g, id: "00000000000000f6", target_asset_id: undefined }]), g);
    t.eq("an older copy and a row with no target are left alone", ret, []);
    // while a note editor is open the rows wait, then apply
    await p.dblclick(".an-panel .an-note .an-nt");
    await p.waitForSelector(".an-panel .an-nedit", { timeout: 3000 });
    ret = await p.evaluate((g) => window.A.applyRows([{ ...g, z_index: 5, updated_at: Date.now() }]), g);
    await p.waitForTimeout(400);
    const still = await p.evaluate(() => !!document.querySelector(".an-panel .an-nedit"));
    t.ok("an open note editor makes the rows wait (the editor stays)", ret.length === 0 && still, [ret, still]);
    await p.fill(".an-panel .an-nedit", "the note, typed on");
    await p.press(".an-panel .an-nedit", "Enter");
    await p.waitForTimeout(600);
    const typed = await p.evaluate(() => [...window.__rows.values()].some((r) => r.kind === "note" && r.data.text === "the note, typed on"));
    ret = await p.evaluate((g) => window.A.applyRows([{ ...g, z_index: 5, updated_at: Date.now() }]), g);
    t.ok("…the typed text is kept, and the waiting row was applied once the editor closed", typed && ret.length === 0, [typed, ret]);
    // a deleted status row clears the state
    // the review state
    await p.evaluate(() => window.A.applyRows([{ id: "00000000000000e1", kind: "status", target_asset_id: "fake-asset-1", updated_at: Date.now(), data: { state: "approved", history: [{ state: "approved", author: "Elsewhere", at: Date.now() }] } }]));
    const on = await p.evaluate(() => document.querySelector(".an-panel [data-rs=approved]")?.classList.contains("on"));
    t.ok("a status row sets the review state shown", on, on);
    await p.evaluate(() => window.A.applyRows([{ id: "00000000000000e1", kind: "status", target_asset_id: "fake-asset-1", updated_at: Date.now(), deleted_at: Date.now(), data: {} }]));
    const cleared = await p.evaluate(() => document.querySelector(".an-panel [data-rs='']")?.classList.contains("on"));
    t.ok("…a deleted one clears it", cleared, cleared);
    await p.click(".an-panel [data-rs=changes]");
    await p.waitForTimeout(300);
    await p.evaluate(() => window.A.applyRows([{ id: "00000000000000e1", kind: "status", target_asset_id: "fake-asset-1", updated_at: Date.now() - 5000, data: { state: "approved" } }]));
    const kept = await p.evaluate(() => document.querySelector(".an-panel [data-rs=changes]")?.classList.contains("on"));
    t.ok("…one older than this window's own state write is ignored", kept, kept);
    await p.context().close();
  }
  // ---- undo of a note edit: fresh edited_at only for a store that merges on the server ----
  for (const merges of [false, true]){
    const p = await hostPage("?prefix=" + encodeURIComponent(`fakehost:m${merges ? 1 : 0}:`) + (merges ? "&merges=1" : ""), null);
    const tag = merges ? "mergesOnServer" : "Sight's rule";
    await p.evaluate(() => window.A.toggle(true));
    await p.fill(".an-panel .an-input", "first words");
    await p.press(".an-panel .an-input", "Enter");
    await p.waitForSelector(".an-panel .an-note .an-nt", { timeout: 5000 });
    await p.dblclick(".an-panel .an-note .an-nt");
    await p.fill(".an-panel .an-nedit", "second words");
    await p.press(".an-panel .an-nedit", "Enter");
    await p.waitForFunction(() => [...window.__rows.values()].some((r) => r.kind === "note" && r.data.text === "second words"), null, { timeout: 5000 }).catch(() => {});
    const edited = await p.evaluate(() => [...window.__rows.values()].find((r) => r.kind === "note")?.data.edited_at || 0);
    t.ok(`${tag}: the edit stamps edited_at`, edited > 0, edited);
    // another reviewer edits the note after this edit, before the undo
    await p.waitForTimeout(40);
    const other = await p.evaluate(() => { const r = structuredClone([...window.__rows.values()].find((x) => x.kind === "note")); r.data.text = "their words"; r.data.edited_at = Date.now(); return r; });
    await p.waitForTimeout(40);
    const tu = Date.now();
    await p.evaluate(() => document.activeElement?.blur?.());
    await p.keyboard.press("Control+z");
    await p.waitForFunction(() => [...window.__rows.values()].some((r) => r.kind === "note" && r.data.text === "first words"), null, { timeout: 5000 }).catch(() => {});
    const undone = await p.evaluate(() => [...window.__rows.values()].find((r) => r.kind === "note"));
    t.eq(`${tag}: undo writes the old words`, undone?.data.text, "first words");
    if (merges) t.ok(`${tag}: …with edited_at = the undo's time`, undone?.data.edited_at >= tu, [undone?.data.edited_at, tu]);
    else t.ok(`${tag}: …with the old stamp (no edited_at, as before the edit)`, undone && undone.data.edited_at === undefined, undone?.data.edited_at);
    // the server's merge: the other reviewer's copy is there, ours comes in
    const won = await p.evaluate(([other, mine]) => globalThis.SightReviewCore.mergeRows([other], [mine]).rows.find((r) => r.id === mine.id).data.text, [other, undone]);
    t.eq(`${tag}: merged against the other reviewer's newer edit, ${merges ? "the undo wins" : "theirs wins"}`, won, merges ? "first words" : "their words");
    // the state: Resolve, then undo
    const note = () => p.evaluate(() => structuredClone([...window.__rows.values()].find((r) => r.kind === "note")));
    await p.click(".an-panel .an-note [data-done]");
    await p.waitForFunction(() => [...window.__rows.values()].some((r) => r.kind === "note" && r.data.status === "done"), null, { timeout: 5000 }).catch(() => {});
    const done = await note();
    await p.waitForTimeout(30);
    const ts = Date.now();
    await p.evaluate(() => document.activeElement?.blur?.());
    await p.keyboard.press("Control+z");
    await p.waitForFunction(() => [...window.__rows.values()].some((r) => r.kind === "note" && r.data.status !== "done"), null, { timeout: 5000 }).catch(() => {});
    const reopened = await note();
    t.ok(`${tag}: undoing Resolve writes the old state`, reopened.data.status !== "done", reopened.data.status);
    if (merges){
      t.ok(`${tag}: …with status_at = the undo's time`, reopened.data.status_at >= ts, [reopened.data.status_at, ts]);
      const st = await p.evaluate(([srv, mine]) => globalThis.SightReviewCore.mergeRows([srv], [mine]).rows[0].data.status || "", [done, reopened]);
      t.eq(`${tag}: …and it wins the merge over the resolved copy`, st, reopened.data.status || "");
      t.eq(`${tag}: …the content stamp is not moved by a state-only undo`, reopened.data.edited_at, done.data.edited_at);
    } else t.eq(`${tag}: …with the old status_at`, reopened.data.status_at ?? null, null);
    // a reply, then undo
    await p.click(".an-panel .an-note [data-reply]");
    await p.fill(".an-panel .an-redit", "a reply");
    await p.press(".an-panel .an-redit", "Enter");
    await p.waitForFunction(() => [...window.__rows.values()].some((r) => r.kind === "note" && (r.data.replies || []).some((x) => x.text === "a reply")), null, { timeout: 5000 }).catch(() => {});
    const replied = await note();
    const rid = (replied.data.replies || []).find((x) => x.text === "a reply")?.id;
    await p.waitForTimeout(30);
    const tr = Date.now();
    await p.evaluate(() => document.activeElement?.blur?.());
    await p.keyboard.press("Control+z");
    await p.waitForFunction((rid) => [...window.__rows.values()].some((r) => r.kind === "note" && !(r.data.replies || []).some((x) => x.id === rid && !x.deleted)), rid, { timeout: 5000 }).catch(() => {});
    const unreplied = await note();
    const gone = (unreplied.data.replies || []).find((x) => x.id === rid);
    if (merges){
      t.ok(`${tag}: undoing a reply writes it as a tombstone stamped now`, gone && gone.deleted >= tr && !gone.text, gone);
      const live = await p.evaluate(([srv, mine, rid]) => globalThis.SightReviewCore.mergeRows([srv], [mine]).rows[0].data.replies.filter((x) => x.id === rid && !x.deleted).length, [replied, unreplied, rid]);
      t.eq(`${tag}: …so the merge does not bring the reply back`, live, 0);
      // redo: the reply comes back, stamped later than its tombstone
      await p.keyboard.press("Control+Shift+z");
      await p.waitForFunction((rid) => [...window.__rows.values()].some((r) => r.kind === "note" && (r.data.replies || []).some((x) => x.id === rid && !x.deleted)), rid, { timeout: 5000 }).catch(() => {});
      const redone = await note();
      const back = (redone.data.replies || []).find((x) => x.id === rid);
      t.ok(`${tag}: redo brings the reply back, edited after its tombstone`, back && !back.deleted && back.edited >= gone?.deleted, back);
      const live2 = await p.evaluate(([srv, mine, rid]) => globalThis.SightReviewCore.mergeRows([srv], [mine]).rows[0].data.replies.filter((x) => x.id === rid && !x.deleted).length, [unreplied, redone, rid]);
      t.eq(`${tag}: …and wins the merge over the tombstone`, live2, 1);
    } else t.ok(`${tag}: undoing a reply drops it (as before)`, !gone, gone);
    await p.context().close();
  }
  // ---- CSS tokens through --an-* ----
  {
    const p = await hostPage("?prefix=" + encodeURIComponent("fakehost:css:"), null);
    const look = () => p.evaluate(() => { const cs = getComputedStyle(document.querySelector(".an-panel")); return [cs.color, cs.backgroundColor]; });
    await p.evaluate(() => { document.body.style.setProperty("--fg", "rgb(4, 5, 6)"); document.body.style.setProperty("--surface", "rgb(7, 8, 9)"); });
    t.eq("without --an-* the panel takes Sight's --fg / --surface", await look(), ["rgb(4, 5, 6)", "rgb(7, 8, 9)"]);
    await p.evaluate(() => { const l = document.getElementById("light"); l.style.setProperty("--an-fg", "rgb(1, 2, 3)"); l.style.setProperty("--an-surface", "rgb(10, 11, 12)"); });
    t.eq("a host's --an-fg / --an-surface win", await look(), ["rgb(1, 2, 3)", "rgb(10, 11, 12)"]);
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
