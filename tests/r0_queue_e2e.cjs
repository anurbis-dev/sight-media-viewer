// R0-0 block 3: the durable write queue and the settings round trip, as they behave before R0
// (tests/test_r0_review.py).
//   - offline (the server unreachable for writes): new drawings, a change and a delete are kept in this window's
//     outbox (localStorage "sight-annot-outbox:v2:<window>"), the badge says how many, the server has none of them;
//     a reload while offline keeps them (the layer still shows them); back online (the badge clicked) they land once
//     each: no duplicate, the deleted one never created, nothing left in the outbox, the badge gone;
//   - nothing revived: a change queued while offline for a row deleted meanwhile on the server (another window)
//     does not bring the row back;
//   - a second window: a live window's outbox is left alone; one that stopped refreshing it (frozen) is adopted by
//     the next window that starts, which sends it; the frozen window, woken, drops its copy (never sends it again)
//     and its next write of that row still lands;
//   - the pagehide keepalive beacon: a window closed with writes queued sends them with keepalive; a window closed
//     while even that fails leaves its outbox marked gone (ts 0), and the next start sends it at once;
//   - settings: sight.annotate.styles (a brush colour), .filter, .stamp (mode / position), .stamp.videos (the stamp
//     off on one clip) go to the server (putSetting) and come back in a fresh browser (hydrateSettings); a
//     sight.* key the server lacks is dropped at the start, a key outside sight.* is kept;
//   - touch: the badge's tap retries.
"use strict";
const L = require("./r0_lib.cjs");

const OBP = "sight-annot-outbox:v2:";

L.run(async (cfg, t) => {
  const id = cfg.ids, b = await t.browser();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  // "Offline" for annotation writes, per tab (sessionStorage, so it survives a reload): "1" = every write fails as a
  // network error would (keepalive ones too), "keep" = only writes sent with keepalive go through. Reads always go
  // through. Keepalive writes are logged (localStorage "__r0_beacon"), and every write in "__r0_writes" ("METHOD path",
  // " keepalive", " x" when failed here). (page.route cannot stand in: a keepalive request of a page being unloaded
  // escapes it.)
  const NET = () => {
    const f = window.fetch;
    window.fetch = function (u, o){
      const url = String(u && u.url || u), m = (o && o.method) || "GET", off = sessionStorage.getItem("__r0_off");
      if (url.includes("/api/annotations") && m !== "GET"){
        if (o && o.keepalive){
          try { const l = JSON.parse(localStorage.getItem("__r0_beacon") || "[]"); l.push(m + " " + url.replace(/^https?:\/\/[^/]+/, "")); localStorage.setItem("__r0_beacon", JSON.stringify(l)); } catch {}
        }
        const fail = off === "1" || (off === "keep" && !(o && o.keepalive));
        try { const l = JSON.parse(localStorage.getItem("__r0_writes") || "[]"); l.push(m + " " + url.replace(/^https?:\/\/[^/]+/, "") + (o && o.keepalive ? " keepalive" : "") + (fail ? " x" : "")); localStorage.setItem("__r0_writes", JSON.stringify(l)); } catch {}
        if (fail) return Promise.reject(new TypeError("Failed to fetch"));
        // "keep": the keepalive write goes out, but the closing page never sees the answer (a fast local server could
        // answer before the page is torn down, and obDone would clear the key the test checks).
        if (off === "keep"){ f.apply(this, arguments); return new Promise(() => {}); }
      }
      return f.apply(this, arguments);
    };
  };
  await ctx.addInitScript(NET);
  const page = async (label) => {
    const p = await ctx.newPage();
    t.watch(p, label);
    return p;
  };
  const start = async (p) => { await p.goto(cfg.base + "/"); await p.waitForSelector(".card[data-id]", { timeout: 30000 }); };
  const shapes = async (aid, deleted) => (await L.api(cfg, "/api/annotations?asset_id=" + aid + (deleted ? "&deleted=1" : ""))).filter((r) => r.kind === "shape");
  async function until(fn, ms = 6000, p){
    const end = Date.now() + ms;
    let v;
    while (Date.now() < end){ v = await fn(); if (v) return v; await (p || pX).waitForTimeout(100); }
    return v;
  }
  const toPage = (p, x, y) => p.evaluate(([x, y]) => {
    const s = document.querySelector(".light .an-layer .an-doc"), pt = s.createSVGPoint();
    pt.x = x; pt.y = y;
    const q = pt.matrixTransform(s.getScreenCTM());
    return [q.x, q.y];
  }, [x, y]);
  async function drag(p, a, c){
    const [x0, y0] = await toPage(p, ...a), [x1, y1] = await toPage(p, ...c);
    await p.mouse.move(x0, y0); await p.mouse.down();
    await p.mouse.move(x1, y1, { steps: 8 }); await p.mouse.up();
    await p.waitForTimeout(80);
  }
  async function clickAt(p, x, y){ const [a, c] = await toPage(p, x, y); await p.mouse.click(a, c); await p.waitForTimeout(80); }
  async function annotate(p, aid){
    await L.openLight(p, aid);
    await L.waitMedia(p, "image");
    await p.keyboard.press("KeyA");
    await p.waitForSelector(".an-top:not([hidden])");
  }
  // This context's outboxes: {key: {ts, ids}}.
  const outboxes = (p) => p.evaluate((pre) => {
    const o = {};
    for (let i = 0; i < localStorage.length; i++){
      const k = localStorage.key(i);
      if (!k.startsWith(pre)) continue;
      const v = JSON.parse(localStorage.getItem(k));
      o[k] = { ts: v.ts, ids: v.entries.map(([id, e]) => id + ":" + e.op + (e.create ? "+" : "")).sort() };
    }
    return o;
  }, OBP);
  const badge = (p) => p.evaluate(() => { const b = document.querySelector(".an-outbox"); return b && !b.hidden ? b.textContent : null; });
  const layerIds = (p) => p.$$eval(".light .an-layer .an-doc g[data-id]", (gs) => gs.map((g) => g.dataset.id).sort());
  const offline = (p, how = "1") => p.evaluate((h) => sessionStorage.setItem("__r0_off", h), how);
  const online = (p) => p.evaluate(() => sessionStorage.removeItem("__r0_off"));
  // Reads of this context's storage go through a same-origin page that is not the app (no outbox timers of its own).
  const pX = await page("probe");
  await pX.goto(cfg.base + "/api/settings");
  const beaconLog = () => pX.evaluate(() => JSON.parse(localStorage.getItem("__r0_beacon") || "[]"));
  const writes = () => pX.evaluate(() => JSON.parse(localStorage.getItem("__r0_writes") || "[]"));
  const writesSince = async (n) => (await writes()).slice(n);

  // ---- offline -> kept -> online -> saved ------------------------------------------------------------------
  const pic = id["q_pic.png"], pic2 = id["q_pic2.png"], pic3 = id["q_pic3.png"];
  const pA = await page("A");
  await start(pA);
  await annotate(pA, pic);
  await pA.keyboard.press("KeyR");
  await drag(pA, [100, 100], [300, 250]);
  let rs = await until(async () => { const r = await shapes(pic); return r.length === 1 && r; });
  t.ok("online: the first drawing lands", rs && rs.length === 1, rs && rs.length);
  const s1 = rs[0].id, s1x = rs[0].data.x;
  t.eq("…and nothing is left in the outbox", await outboxes(pA), {});

  await offline(pA);
  await drag(pA, [500, 100], [700, 250]);    // s2: created offline
  await drag(pA, [500, 400], [700, 550]);    // s3: created, then deleted, offline
  const lay = await layerIds(pA);
  const [s2, s3] = lay.filter((x) => x !== s1).length === 2 ? await pA.evaluate(([a, b]) => {
    // (which new one is which: s2 is the upper one)
    const gs = [...document.querySelectorAll(".light .an-layer .an-doc g[data-id]")].filter((g) => g.dataset.id !== a);
    gs.sort((x, y) => x.getBoundingClientRect().top - y.getBoundingClientRect().top);
    return gs.map((g) => g.dataset.id);
  }, [s1]) : [null, null];
  t.ok("offline: both new drawings show", !!s2 && !!s3, lay);
  await pA.keyboard.press("KeyV");
  await clickAt(pA, 500, 475);   // (on its outline: a rect is not filled)
  await pA.keyboard.press("Delete");
  await clickAt(pA, 100, 175);
  await pA.keyboard.press("Shift+ArrowRight");   // s1 moved: a change of a row the server has
  await pA.keyboard.press("Escape");
  // (a change of a saved row is queued after a 300 ms debounce: polled for, not waited)
  await until(async () => Object.values(await outboxes(pA)).some((v) => v.ids.length === 3), 4000);
  let ob = await outboxes(pA);
  const want = [`${s1}:put`, `${s2}:put+`, `${s3}:del`].sort();
  t.eq("offline: one outbox, an entry per row (s1 change, s2 create, s3 delete)", Object.values(ob).map((v) => v.ids), [want]);
  t.ok("…kept with a live stamp", Object.values(ob).every((v) => Date.now() - v.ts < 10000), ob);
  t.ok("…the badge counts them", /3 unsaved annotation changes/.test(await until(() => badge(pA), 5000) || ""), await badge(pA));
  rs = await shapes(pic);
  t.eq("…the server has none of them", rs.map((r) => [r.id, r.data.x]), [[s1, s1x]]);

  // A reload while offline: the new page adopts its own old outbox (marked gone at pagehide) and shows it.
  await pA.reload();
  await pA.waitForSelector(".card[data-id]");
  t.eq("reload offline: the pagehide beacon tried all three (and failed)", (await beaconLog()).map((x) => x.split(" ")[0]).sort(), ["DELETE", "PATCH", "POST"]);
  await pX.evaluate(() => localStorage.removeItem("__r0_beacon"));
  ob = await outboxes(pA);
  t.eq("reload offline: the entries are kept (under the new window's key)", Object.values(ob).map((v) => v.ids), [want]);
  await annotate(pA, pic);
  await pA.waitForTimeout(300);
  t.eq("…the layer shows the queued state (s1, s2; not s3)", await layerIds(pA), [s1, s2].sort());
  const s1xNow = await pA.evaluate((s) => { const g = document.querySelector(`.light .an-layer .an-doc g[data-id="${s}"]`); return g.getBBox().x; }, s1);
  t.ok("…s1 where it was moved to", s1xNow > s1x + 5, s1xNow, `> ${s1x}`);
  t.eq("…still nothing on the server", (await shapes(pic)).length, 1);

  await online(pA);
  await until(() => badge(pA), 8000);
  await pA.click(".an-outbox", { timeout: 2000 }).catch(() => {});   // retry now (the queue's own retry may beat the click)
  rs = await until(async () => { const r = await shapes(pic); return r.length === 2 && r.find((x) => x.id === s1)?.data.x > s1x + 5 && r; }, 8000);
  t.eq("online: the server has s1 (moved) and s2", rs ? rs.map((r) => r.id).sort() : null, [s1, s2].sort());
  await pA.waitForTimeout(1500);
  const all = await shapes(pic, true);
  t.eq("…no duplicate, and s3 was never created", all.map((r) => r.id).sort(), [s1, s2].sort());
  t.eq("…the outbox is empty", await outboxes(pA), {});
  t.eq("…the badge is gone", await badge(pA), null);
  t.eq("…the layer agrees", await layerIds(pA), [s1, s2].sort());

  // ---- nothing revived -------------------------------------------------------------------------------------
  // (a) Through the batch: another window deleted s2, then a change of it here goes out in /api/annotations/batch,
  // which skips a gone row.
  await L.api(cfg, "/api/annotations/" + s2, { method: "DELETE" });
  let mark = (await writes()).length;
  await pA.keyboard.press("KeyV");
  await clickAt(pA, 500, 175);
  await pA.keyboard.press("Shift+ArrowDown");
  await pA.keyboard.press("Escape");
  await until(async () => (await writesSince(mark)).length && !Object.keys(await outboxes(pA)).length, 5000);
  t.eq("revive (batch): the change goes in one batch", await writesSince(mark), ["POST /api/annotations/batch"]);
  t.eq("…s2 stays deleted on the server", (await shapes(pic)).map((r) => r.id), [s1]);
  let tomb = (await shapes(pic, true)).find((r) => r.id === s2);
  t.ok("…its tombstone stays", !!tomb && !!tomb.deleted_at, tomb);
  t.ok("…no refused-write note", !/refused/.test(await badge(pA) || ""), await badge(pA));
  // (b) Queued offline long enough that the batch failed twice: the entry goes alone (PATCH /api/annotations/<id>),
  // after another window deleted the row meanwhile; the PATCH never revives it.
  await pA.keyboard.press("KeyR");
  await drag(pA, [100, 500], [300, 650]);
  rs = await until(async () => { const r = await shapes(pic); return r.length === 2 && r; });
  const s4 = rs && rs.find((r) => r.id !== s1).id;
  t.ok("revive (single): s4 lands", !!s4);
  await offline(pA);
  mark = (await writes()).length;
  await pA.keyboard.press("KeyV");
  await clickAt(pA, 100, 575);
  await pA.keyboard.press("Shift+ArrowRight");
  await pA.keyboard.press("Escape");
  await until(async () => (await writesSince(mark)).filter((w) => w === "POST /api/annotations/batch x").length >= 2, 6000);
  await pA.waitForTimeout(300);
  t.eq("…offline, the batch fails twice", (await writesSince(mark)).slice(0, 2), ["POST /api/annotations/batch x", "POST /api/annotations/batch x"]);
  t.eq("…s4 queued as a change", Object.values(await outboxes(pA)).map((v) => v.ids), [[`${s4}:put`]]);
  await L.api(cfg, "/api/annotations/" + s4, { method: "DELETE" });   // another window deletes it
  await online(pA);
  mark = (await writes()).length;
  await until(() => badge(pA), 8000);
  await pA.click(".an-outbox", { timeout: 2000 }).catch(() => {});
  await until(async () => !Object.keys(await outboxes(pA)).length, 8000);
  t.eq("…back online it goes alone, as a PATCH", await writesSince(mark), [`PATCH /api/annotations/${s4}`]);
  t.eq("…the outbox empties", await outboxes(pA), {});
  t.eq("…s4 stays deleted on the server", (await shapes(pic)).map((r) => r.id), [s1]);
  tomb = (await shapes(pic, true)).find((r) => r.id === s4);
  t.ok("…its tombstone stays", !!tomb && !!tomb.deleted_at, tomb);
  t.ok("…the refused PATCH (404) shows the refused note", /refused/.test(await until(() => badge(pA), 3000) || ""), await badge(pA));
  await pA.keyboard.press("Escape");
  await pA.keyboard.press("Escape");
  await pA.waitForSelector(".light", { state: "detached" }).catch(() => {});

  // ---- a second window --------------------------------------------------------------------------------------
  const pB = await page("B");
  await start(pB);
  await offline(pB);
  await annotate(pB, pic2);
  await pB.keyboard.press("KeyR");
  await drag(pB, [100, 100], [300, 250]);
  const b1 = (await layerIds(pB))[0];
  await pB.waitForTimeout(300);
  const keyB = Object.keys(await outboxes(pB))[0];
  t.eq("window B: its drawing waits in its outbox", keyB ? (await outboxes(pB))[keyB].ids : null, [`${b1}:put+`]);
  // A window that starts while B is alive leaves B's outbox alone.
  const pC = await page("C");
  await start(pC);
  await pC.waitForTimeout(2500);
  t.ok("window C (B alive): B's outbox is left alone", !!(await outboxes(pC))[keyB], Object.keys(await outboxes(pC)));
  t.eq("…and nothing is sent", (await shapes(pic2)).length, 0);
  await pC.close();
  // B freezes (a suspended tab: its timers stop) and its stamp goes stale; the next window adopts its outbox.
  const cdpB = await ctx.newCDPSession(pB);
  // (Page.setWebLifecycleState "frozen" does not stop a visible headless page's timers; a debugger pause does)
  await cdpB.send("Debugger.enable");
  await cdpB.send("Debugger.pause");
  // (B has its own renderer process, as Playwright's pages do here: the pause stops only B)
  await pX.waitForTimeout(5500);
  await pX.evaluate((k) => { const v = JSON.parse(localStorage.getItem(k)); v.ts = Date.now() - 200000; localStorage.setItem(k, JSON.stringify(v)); }, keyB);
  await pX.waitForTimeout(5500);
  t.ok("B frozen: its stamp stays stale", await pX.evaluate((k) => Date.now() - JSON.parse(localStorage.getItem(k)).ts > 190000, keyB));
  const pD = await page("D");
  await start(pD);
  rs = await until(async () => { const r = await shapes(pic2); return r.length && r; }, 8000, pD);
  t.eq("window D adopts the stale outbox and sends it", rs ? rs.map((r) => r.id) : null, [b1]);
  t.eq("…B's outbox key is gone", Object.keys(await outboxes(pD)), []);
  await cdpB.send("Debugger.resume");
  await cdpB.send("Debugger.disable");
  await pB.waitForTimeout(6500);   // B's refresh timer (5 s) finds its key gone: B lets go of its copy
  t.eq("B woken: it drops its copy (no key comes back)", Object.keys(await outboxes(pB)), []);
  t.eq("…no badge in B", await badge(pB), null);
  await online(pB);
  mark = (await writes()).length;
  await pB.keyboard.press("KeyV");
  await clickAt(pB, 100, 175);
  await pB.keyboard.press("Shift+ArrowRight");   // B writes the handed-off row again: it lands (an upsert)
  await pB.keyboard.press("Escape");
  rs = await until(async () => { const r = await shapes(pic2); return r.length === 1 && r[0].data.x > 105 && r; }, 6000, pB);
  t.ok("…B's next write of that row lands", !!rs, await shapes(pic2));
  t.eq("…as an upsert (POST), not a PATCH", await writesSince(mark), ["POST /api/annotations"]);
  await pB.waitForTimeout(1000);
  t.eq("…one row, no duplicate", (await shapes(pic2, true)).map((r) => r.id), [b1]);
  await pD.close();
  await pB.close();
  await pA.close();   // (no other app page from here on: their 60 s re-adopt timers would take the keys below)

  // ---- the pagehide keepalive beacon ------------------------------------------------------------------------
  const pE = await page("E");
  await start(pE);
  await offline(pE, "keep");
  await annotate(pE, pic3);
  await pE.keyboard.press("KeyR");
  await drag(pE, [100, 100], [300, 250]);
  const e1 = (await layerIds(pE))[0];
  await pE.waitForTimeout(400);
  t.eq("beacon: the drawing waits (writes fail)", (await shapes(pic3)).length, 0);
  await pE.close({ runBeforeUnload: false });
  rs = await until(async () => { const r = await shapes(pic3); return r.length && r; }, 6000);
  t.eq("…closing the window sends it (keepalive)", rs ? rs.map((r) => r.id) : null, [e1]);
  t.eq("…as one keepalive POST", await beaconLog(), ["POST /api/annotations"]);
  // Its outbox (marked gone, ts 0) is still there — it never saw the answer — and the next start sends it again
  // as an upsert: still one row.
  const left = await outboxes(pX);
  t.ok("…its outbox stays marked gone (ts 0)", Object.values(left).length === 1 && Object.values(left)[0].ts === 0, left);
  mark = (await writes()).length;
  const pE2 = await page("E2");
  await start(pE2);
  await until(async () => !Object.keys(await outboxes(pX)).length, 6000);
  t.eq("…the next start sends it again (POST: an upsert) and clears it", [await outboxes(pX), await writesSince(mark)], [{}, ["POST /api/annotations"]]);
  await pE2.close();
  t.eq("…still one row", (await shapes(pic3, true)).map((r) => r.id), [e1]);

  // Closed while even the beacon fails: the next start sends it at once.
  await pX.evaluate(() => localStorage.removeItem("__r0_beacon"));
  const pF = await page("F");
  await start(pF);
  await offline(pF);
  await annotate(pF, pic3);
  await pF.keyboard.press("KeyR");
  await drag(pF, [500, 100], [700, 250]);
  const f1 = (await layerIds(pF)).find((x) => x !== e1);
  await pF.waitForTimeout(300);
  await pF.close({ runBeforeUnload: false });
  await pX.waitForTimeout(500);
  const gone = await outboxes(pX);
  t.eq("closed offline: the beacon was tried", await beaconLog(), ["POST /api/annotations"]);
  t.ok("…the outbox is left marked gone (ts 0)", Object.values(gone).length === 1 && Object.values(gone)[0].ts === 0 && Object.values(gone)[0].ids[0] === `${f1}:put+`, gone);
  t.eq("…the server lacks it", (await shapes(pic3)).length, 1);
  const pG = await page("G");
  await start(pG);
  rs = await until(async () => { const r = await shapes(pic3); return r.length === 2 && r; }, 6000, pG);
  t.ok("…the next window sends it straight away", !!rs && rs.some((r) => r.id === f1), rs && rs.map((r) => r.id));
  await until(async () => !Object.keys(await outboxes(pG)).length, 4000, pG);
  t.eq("…and clears it", await outboxes(pG), {});
  await pG.close();

  // ---- outboxes left by the old version (0.135.x's format, frozen here: R0 must still send them) --------------
  // Written from the probe page while no app page is open: a v2 key of a closed window (ts 0) holding a create, a
  // change, a delete and a create without `at`; the v1 single key (a bare array); a live window's v2 key (left alone).
  const oid = (n) => "0dd0000000000" + String(n).padStart(3, "0");
  const body = (i, x) => ({ id: i, scope: "asset", target_asset_id: pic2, kind: "shape", shape_kind: "rect", z_index: 1, color: "#ff3b30", x: x - 2, y: 398, w: 104, h: 84,
    data: { color: "#ff3b30", strokeOn: true, width: 4, dash: "solid", fillOn: false, fill: "#ff3b30", fillOpacity: 0.5, radius: 0, opacity: 1, x, y: 400, w: 100, h: 80, rot: 0, ctx: null, note: null, created: 1795000000000 } });
  const [oA, oB, oC, oD, oE, oF] = [1, 2, 3, 4, 5, 6].map(oid);
  await L.api(cfg, "/api/annotations", { body: body(oB, 100) });
  await L.api(cfg, "/api/annotations", { body: body(oC, 300) });
  const at = Date.now() - 600000;
  await pX.evaluate(([OLD, V1, LIVE]) => {
    localStorage.setItem("sight-annot-outbox:v2:0ld0window", JSON.stringify(OLD));
    localStorage.setItem("sight-annot-outbox:v1", JSON.stringify(V1));
    localStorage.setItem("sight-annot-outbox:v2:1ivewindow", JSON.stringify({ ts: Date.now(), entries: LIVE }));
  }, [
    { ts: 0, entries: [[oA, { op: "put", body: body(oA, 500), create: true, key: pic2, at }], [oB, { op: "put", body: body(oB, 150), create: false, key: pic2, at }],
      [oC, { op: "del", key: pic2, at }], [oD, { op: "put", body: body(oD, 700), create: true, key: pic2 }]] },
    [[oE, { op: "put", body: body(oE, 900), create: true, key: pic2 }]],
    [[oF, { op: "put", body: body(oF, 1000), create: true, key: pic2, at }]],
  ]);
  mark = (await writes()).length;
  const pH = await page("H");
  await start(pH);
  await until(async () => Object.keys(await outboxes(pX)).length === 1 && (await shapes(pic2)).length === 5, 8000, pH);
  await pH.waitForTimeout(800);
  const old = Object.fromEntries((await shapes(pic2, true)).filter((r) => r.id.startsWith("0dd0")).sort((a, c) => a.id < c.id ? -1 : 1).map((r) => [r.id, [r.data.x, !!r.deleted_at]]));
  t.eq("old outboxes: each entry lands (A, D, E created; B changed; C deleted; F not sent)", old,
    { [oA]: [500, false], [oB]: [150, false], [oC]: [300, true], [oD]: [700, false], [oE]: [900, false] });
  t.eq("…each once, as the old version sent it", (await writesSince(mark)).sort(),
    ["DELETE /api/annotations/" + oC, "POST /api/annotations", "POST /api/annotations", "POST /api/annotations", "POST /api/annotations/batch"].sort());
  t.eq("…the closed window's keys are gone, the live one kept", Object.keys(await outboxes(pX)).concat(await pX.evaluate(() => localStorage.getItem("sight-annot-outbox:v1") === null ? [] : ["v1"])), ["sight-annot-outbox:v2:1ivewindow"]);
  await pX.evaluate(() => localStorage.removeItem("sight-annot-outbox:v2:1ivewindow"));
  await pH.close();
  await ctx.close();

  // ---- touch: the badge's tap retries ----------------------------------------------------------------------
  const tctx = await b.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: false });
  await tctx.addInitScript(NET);
  const pT = await tctx.newPage();
  t.watch(pT, "touch");
  await start(pT);
  await offline(pT);
  await L.openLight(pT, pic, { touch: true });
  await L.waitMedia(pT, "image");
  await pT.tap("#annoBtn");
  await pT.waitForSelector(".an-top:not([hidden])");
  await pT.tap(".an-bar [data-tool=rect]");
  const [tx0, ty0] = await toPage(pT, 300, 500), [tx1, ty1] = await toPage(pT, 450, 650);
  await L.touchDrag(pT, tx0, ty0, tx1, ty1);
  await pT.waitForTimeout(200);
  const tb = await until(() => badge(pT), 8000, pT);
  t.ok("touch offline: the badge shows", /1 unsaved annotation change\b/.test(tb || ""), tb);
  await online(pT);
  await pT.tap(".an-outbox", { timeout: 2000 }).catch(() => {});   // (the queue's own retry may beat the tap)
  rs = await until(async () => { const r = await shapes(pic); return r.length === 2 && r; }, 6000, pT);
  t.ok("…back online (the tap, or the queue's retry) the drawing lands", !!rs, rs && rs.length);
  t.ok("…and the badge goes", await until(async () => (await badge(pT)) === null, 3000, pT));
  await tctx.close();

  // ---- settings round trip ---------------------------------------------------------------------------------
  const clip = id["q_clip.mp4"];
  const c1 = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const p1 = await c1.newPage();
  t.watch(p1, "settings");
  await start(p1);
  await annotate(p1, pic);
  await p1.keyboard.press("KeyB");
  await p1.waitForSelector(".an-props:not([hidden]) .an-sw i[data-sw]");
  const sw = await p1.$$eval(".an-props .an-sw i[data-sw]", (is) => is.map((i) => i.dataset.sw));
  const color = sw.find((c) => c.toLowerCase() !== "#ff3b30");
  await p1.click(`.an-props .an-sw i[data-sw="${color}"]`);
  if (!(await p1.$eval(".an-panel", (e) => !e.hidden).catch(() => false))) await p1.keyboard.press("KeyC");
  await p1.click(".an-panel .an-input"); await p1.keyboard.type("a note, so the filters show"); await p1.keyboard.press("Enter");
  await p1.click('.an-panel .an-filt [data-filt="done"]');
  await p1.keyboard.press("Escape");
  await p1.keyboard.press("Escape");
  await L.lightGone(p1);
  await L.openLight(p1, clip);
  await L.waitMedia(p1, "video");
  await p1.keyboard.press("KeyA");
  await p1.waitForSelector(".an-top:not([hidden])");
  await p1.click(".an-bar [data-act=stampset]");
  await p1.waitForSelector(".an-stampop:not([hidden])");
  await p1.click('.an-stampop [data-sk="mode"][data-sv="frame"]');
  const pos = await p1.$$eval('.an-stampop [data-sk="pos"]', (bs) => bs.map((x) => x.dataset.sv));
  const newPos = pos.find((x) => !x.endsWith("l") || x === "tr") || pos[0];
  await p1.click(`.an-stampop [data-sk="pos"][data-sv="${newPos}"]`);
  await p1.click(".an-stampop [data-sx=close]");
  t.ok("the stamp is on for the clip (opening its settings switched it on)", await p1.$eval(".an-bar [data-act=stamp]", (x) => x.classList.contains("on")));
  await p1.click(".an-bar [data-act=stamp]");
  t.ok("…switched off", !(await p1.$eval(".an-bar [data-act=stamp]", (x) => x.classList.contains("on"))));
  await p1.waitForTimeout(1500);   // (the 300-400 ms setting timers, then the 400 ms push)
  const loc = await p1.evaluate(() => Object.fromEntries(["sight.annotate.styles", "sight.annotate.filter", "sight.annotate.stamp", "sight.annotate.stamp.videos"].map((k) => [k, localStorage.getItem(k)])));
  const srv = (await L.api(cfg, "/api/settings")).ui || {};
  const J = (s) => { try { return JSON.parse(s); } catch { return undefined; } };
  t.eq("styles: the brush colour is stored", J(loc["sight.annotate.styles"])?.brush?.color, color);
  t.eq("filter stored", J(loc["sight.annotate.filter"]), "done");
  t.eq("stamp: mode and position stored", [J(loc["sight.annotate.stamp"])?.mode, J(loc["sight.annotate.stamp"])?.pos], ["frame", newPos]);
  t.eq("stamp.videos: off for this clip", J(loc["sight.annotate.stamp.videos"]), { [clip]: false });
  for (const k of Object.keys(loc)) t.eq(`the server has ${k} as stored here`, srv[k], loc[k]);
  await c1.close();

  // A fresh browser (empty localStorage): hydrateSettings brings them back, and the annotator shows them.
  const c2 = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const p2 = await c2.newPage();
  t.watch(p2, "settings 2");
  await start(p2);
  const loc2 = await p2.evaluate((ks) => Object.fromEntries(ks.map((k) => [k, localStorage.getItem(k)])), Object.keys(loc));
  t.eq("a fresh browser: every key comes back from the server", loc2, loc);
  await annotate(p2, pic);
  await p2.keyboard.press("KeyB");
  await p2.waitForSelector(".an-props:not([hidden])");
  t.eq("…the brush colour shows in the properties", (await p2.$eval('.an-props input[type=color]', (i) => i.value)).toLowerCase(), color.toLowerCase());
  if (!(await p2.$eval(".an-panel", (e) => !e.hidden).catch(() => false))) await p2.keyboard.press("KeyC");
  t.eq("…the filter shows", await p2.$eval(".an-panel .an-filt button.on", (x) => x.dataset.filt), "done");
  await p2.keyboard.press("Escape");
  await p2.keyboard.press("Escape");
  await L.lightGone(p2);
  await L.openLight(p2, clip);
  await L.waitMedia(p2, "video");
  await p2.keyboard.press("KeyA");
  await p2.waitForSelector(".an-top:not([hidden])");
  t.ok("…the stamp is off for the clip", !(await p2.$eval(".an-bar [data-act=stamp]", (x) => x.classList.contains("on"))));
  t.eq("…no stamp shows", await p2.$$eval(".light .an-stamp", (s) => s.filter((e) => !e.hidden && e.offsetParent).length).catch(() => 0), 0);
  await p2.click(".an-bar [data-act=stampset]");
  await p2.waitForSelector(".an-stampop:not([hidden])");
  t.eq("…its settings show the stored mode and position", await p2.$$eval(".an-stampop [data-sk].on", (bs) => bs.map((x) => x.dataset.sk + "=" + x.dataset.sv).sort()),
    [`font=${J(loc["sight.annotate.stamp"]).font}`, "mode=frame", `pos=${newPos}`].sort());

  // hydrateSettings: a sight.* key the server lacks is dropped; a key outside sight.* (the outbox's) stays.
  // (Set from a page of the same origin that is not the app: the app's pagehide pushes every sight.* key it holds.)
  await p2.goto(cfg.base + "/api/settings");
  await p2.evaluate(() => { localStorage.setItem("sight.annotate.r0bogus", "1"); localStorage.setItem("r0.outside", "1"); });
  t.eq("(the server lacks the key)", ((await L.api(cfg, "/api/settings")).ui || {})["sight.annotate.r0bogus"], undefined);
  await p2.goto(cfg.base + "/");
  await p2.waitForSelector(".card[data-id]");
  t.eq("a reload: the sight.* key the server lacks is dropped", await p2.evaluate(() => localStorage.getItem("sight.annotate.r0bogus")), null);
  t.eq("…a key outside sight.* is kept", await p2.evaluate(() => localStorage.getItem("r0.outside")), "1");
  // (opening the stamp's settings above switched it on again for the clip: stamp.videos is {} now)
  t.eq("…the stored ones stay", await p2.evaluate((ks) => Object.fromEntries(ks.map((k) => [k, localStorage.getItem(k)])), Object.keys(loc)),
    { ...loc, "sight.annotate.stamp.videos": "{}" });
  await c2.close();
});
