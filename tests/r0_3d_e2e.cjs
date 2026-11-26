// R0-0 block 4: the lightbox's 3D viewer, as it behaves before R0 (tests/test_r0_3d.py). R0c moves it into a module.
//   - a GLB of two boxes (red left, blue right): opens with the shading bar, gear and explode slider; F frames it
//     (from the current side: after an orbit F keeps that side); the wheel zooms, right-drag dollies, middle-drag
//     pans, left-drag orbits;
//   - explode: the slider and Ctrl+right-drag (kept in sight.viewer3d);
//   - shading: Shift+1…4, the wire / X-ray overlays (Shift+5 / 6), the bar's buttons;
//   - per asset: the quarter turn (Shift+7, sight.v3dRot) and saved views (Alt+1 / 1, sight.v3dCams with the turn
//     count), another model's own (empty) ones, both kept on the server and back in a fresh browser;
//   - a .usdz through the server's GLB (usd-core) and, with that route answering 404, read in the page;
//   - an FBX whose texture is beside it, asked for through /api/model-res;
//   - a Gaussian splat (.splat): both balls, zoom, F, no UV / explode;
//   - a note on a 3D view: it and its drawing keep the view (ctx.vk), picking the note goes back to it;
//   - touch: pinch zoom, one-finger orbit, the shading and turn buttons by tap.
// WebGL is SwiftShader here: the checks read the picture back from a screenshot (where the red / blue / green pixels
// are), never exact pixels.
"use strict";
const L = require("./r0_lib.cjs");

L.run(async (cfg, t) => {
  const id = cfg.ids;
  const p = await L.newPage(t, cfg);
  // The rendered 3D view, read back from a screenshot: where the red / blue / green pixels are (bounding boxes in
  // canvas px, counts) against the background (the top-left corner's colour).
  // (Only above the shading bar: its buttons are coloured too.)
  async function frame(pg = p){
    const box = await pg.$eval("#light3d canvas", (c) => {
      const r = c.getBoundingClientRect(), bar = document.querySelector("#v3dShade:not([hidden])")?.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: Math.min(r.bottom, bar && bar.height ? bar.top - 4 : r.bottom) - r.top };
    });
    const buf = await pg.screenshot({ clip: box });
    return pg.evaluate(async (b64) => {
      const im = new Image(); im.src = "data:image/png;base64," + b64; await im.decode();
      const c = document.createElement("canvas"); c.width = im.width; c.height = im.height;
      const x = c.getContext("2d"); x.drawImage(im, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data, W = c.width, H = c.height;
      const out = { w: W, h: H };
      const acc = (k, px, py) => { const o = out[k] || (out[k] = { n: 0, x0: 1e9, y0: 1e9, x1: -1, y1: -1 }); o.n++; o.x0 = Math.min(o.x0, px); o.y0 = Math.min(o.y0, py); o.x1 = Math.max(o.x1, px); o.y1 = Math.max(o.y1, py); };
      for (let py = 0; py < H; py += 2) for (let px = 0; px < W; px += 2){
        const i = (py * W + px) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
        if (Math.abs(r - d[8]) + Math.abs(g - d[9]) + Math.abs(b - d[10]) > 60 && px > 60 && py > 60 && px < W - 60) acc("any", px, py);   // (vs the corner; not the corner controls)
        if (r > g + 25 && r > b + 25) acc("red", px, py);
        else if (b > r + 25 && b > g + 10) acc("blue", px, py);
        else if (g > r + 25 && g > b + 25) acc("green", px, py);
      }
      for (const k of ["red", "blue", "green", "any"]) if (out[k]){ const o = out[k]; o.cx = (o.x0 + o.x1) / 2; o.cy = (o.y0 + o.y1) / 2; o.bw = o.x1 - o.x0; o.bh = o.y1 - o.y0; }
      return out;
    }, buf.toString("base64"));
  }
  const loaded = (pg = p) => pg.waitForFunction(() => { const l = document.querySelector(".light"); return l && !l.classList.contains("v3d-loading") && document.querySelector("#light3d canvas"); }, null, { timeout: 60000 });
  // Waits until two frames 300 ms apart agree (camera moves ease in), and returns the last.
  async function still(pg = p){
    let a = await frame(pg);
    for (let i = 0; i < 20; i++){
      await pg.waitForTimeout(300);
      const b = await frame(pg);
      if (JSON.stringify(a) === JSON.stringify(b)) return b;
      a = b;
    }
    return a;
  }
  async function open3d(aid, pg = p){
    await L.openLight(pg, aid);
    await loaded(pg);
    return still(pg);
  }
  const center = async (pg = p) => pg.$eval("#light3d canvas", (c) => { const r = c.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });

  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const sameView = (a, b, tol = 6) => !!(a && b && a.red && b.red && near(a.red.cx, b.red.cx, tol) && near(a.red.cy, b.red.cy, tol) && near(a.red.bw, b.red.bw, tol) && near(a.red.bh, b.red.bh, tol));
  const ls = (k, pg = p) => pg.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, k);
  const shadeOn = (pg = p) => pg.$$eval("#v3dShade .on", (bs) => bs.map((b) => b.dataset.base || b.dataset.toggle || b.dataset.act).sort());
  const toast = (pg = p) => pg.$eval("#v3dToast", (e) => e.classList.contains("on") ? e.textContent : "");
  async function drag(button, dx, dy, mods = [], pg = p){
    const [cx, cy] = await center(pg);
    for (const m of mods) await pg.keyboard.down(m);
    await pg.mouse.move(cx, cy); await pg.mouse.down({ button }); await pg.mouse.move(cx + dx, cy + dy, { steps: 10 }); await pg.mouse.up({ button });
    for (const m of mods) await pg.keyboard.up(m);
    return still(pg);
  }
  async function fit(pg = p){ await pg.keyboard.press("KeyF"); return still(pg); }
  async function close(pg = p){ await pg.keyboard.press("Escape"); if (!(await L.lightGone(pg))){ await pg.keyboard.press("Escape"); await L.lightGone(pg); } }
  const gap = (f) => f.blue && f.red ? f.blue.cx - f.red.cx : null;

  // ---- a GLB: open, fit, zoom / pan / orbit --------------------------------------------------------------------
  const boxes = id["m_boxes.glb"], other = id["m_other.glb"];
  const f0 = await open3d(boxes);
  t.ok("GLB: both boxes show, red left of blue", !!(f0.red && f0.blue && f0.red.n > 500 && f0.blue.n > 500 && f0.red.cx < f0.blue.cx), f0);
  t.ok("…the shading bar, the gear and the explode slider show", await p.evaluate(() => !document.querySelector("#v3dShade").hidden && !document.querySelector("#v3dGear").hidden && !document.querySelector("#v3dExplode").hidden));
  t.eq("…textured shading by default", await shadeOn(), ["textured"]);
  const home = await fit();
  t.ok("F frames the model (both boxes, red left of blue)", !!(home.red && home.blue && home.red.cx < home.blue.cx));
  t.ok("…the same view again on a second F", sameView(home, await fit(), 2));
  t.data = { open: f0, home };
  const [cx, cy] = await center();
  await p.mouse.move(cx, cy);
  await p.mouse.wheel(0, -400);
  const zin = await still();
  t.ok("the wheel zooms in about the cursor", zin.red && zin.red.bw > home.red.bw * 1.3, [zin.red && zin.red.bw, home.red.bw]);
  t.ok("…F frames all again", sameView(await fit(), home), await frame());
  const dol = await drag("right", 0, 150);
  t.ok("right-drag dollies (the view changes size)", dol.red && !near(dol.red.bw, home.red.bw, 15), [dol.red && dol.red.bw, home.red.bw]);
  await fit();
  const pan = await drag("middle", 120, 60);
  t.ok("middle-drag pans with the pointer", pan.red && near(pan.red.cx - home.red.cx, 120, 30) && near(pan.red.cy - home.red.cy, 60, 30), [pan.red && pan.red.cx - home.red.cx, pan.red && pan.red.cy - home.red.cy]);
  t.ok("…F frames all again", sameView(await fit(), home), await frame());
  const orb = await drag("left", 200, 0);
  t.ok("left-drag orbits (the boxes' places change)", orb.red && orb.blue && !sameView(orb, home, 30) && Math.abs(gap(orb) - gap(home)) > 8, [orb.red, home.red, gap(orb), gap(home)]);   // (a pan keeps the gap)
  await p.keyboard.press("KeyF");
  t.eq("…F: Frame all", await toast(), "Frame all");
  const fo = await still();
  t.ok("…which frames the model from the orbited side (not the opening side)", !!(fo.red && fo.blue) && !sameView(fo, home, 30) && sameView(fo, await fit(), 2), [fo.red, home.red]);
  // Reopened, the model is seen from the opening side again.
  await close();
  await open3d(boxes);
  t.ok("reopened: F frames it as before", sameView(await fit(), home, 4), await frame());

  // ---- explode ---------------------------------------------------------------------------------------------
  const ex = await p.$eval("#v3dExplode", (e) => { const r = e.getBoundingClientRect(); return [r.left, r.right, r.top + r.height / 2]; });
  await p.mouse.move(ex[0] + 6, ex[2]); await p.mouse.down(); await p.mouse.move(ex[1] - 2, ex[2], { steps: 10 }); await p.mouse.up();
  const exp = await still();
  t.ok("the explode slider pulls the boxes apart", gap(exp) > gap(home) + 10, [gap(exp), gap(home), exp.red, exp.blue]);
  t.ok("…its fill is full", await p.$eval("#v3dExplode i", (i) => parseFloat(i.style.width)) > 95);
  await p.waitForTimeout(800);
  t.ok("…kept in sight.viewer3d (explode ≈ 1)", near((await ls("sight.viewer3d"))?.explode ?? -1, 1, 0.02), await ls("sight.viewer3d"));
  const back = await drag("right", -250, 250, ["Control"]);
  t.ok("Ctrl+right-drag back: the boxes come together", gap(back) < gap(exp) - 10, [gap(back), gap(exp)]);
  t.ok("…the slider follows", await p.$eval("#v3dExplode i", (i) => parseFloat(i.style.width)) < 5);
  t.ok("…the view is home again", sameView(await still(), home, 8));

  // ---- shading -------------------------------------------------------------------------------------------
  await p.keyboard.press("Shift+Digit1");
  const solid = await still();
  t.eq("Shift+1: Solid", await shadeOn(), ["solid"]);
  t.ok("…the boxes lose their colours", !(solid.red && solid.red.n > 200) && !(solid.blue && solid.blue.n > 200), solid);
  // (each mode changes the picture: the red / blue counts move by more than a fifth against the textured view)
  const moved = (f) => !f.red || !f.blue || Math.abs(f.red.n - home.red.n) > home.red.n / 5 || Math.abs(f.blue.n - home.blue.n) > home.blue.n / 5;
  await p.keyboard.press("Shift+Digit4");
  t.eq("Shift+4: Normal", await shadeOn(), ["normal"]);
  const nrm = await still();
  t.ok("…the picture changes", moved(nrm), [nrm.red, nrm.blue]);
  await p.keyboard.press("Shift+Digit2");
  t.eq("Shift+2: Vertex Color", await shadeOn(), ["vertex"]);
  const vtx = await still();
  t.ok("…the picture changes (and differs from Normal)", moved(vtx) && JSON.stringify(vtx) !== JSON.stringify(nrm), [vtx.red, vtx.blue]);
  await p.keyboard.press("Shift+Digit3");
  const tex = await still();
  t.eq("Shift+3: Textured", await shadeOn(), ["textured"]);
  t.ok("…the colours are back", sameView(tex, home, 4) && tex.blue.n > 500);
  await p.keyboard.press("Shift+Digit5");
  t.eq("Shift+5: the wireframe overlay", await shadeOn(), ["textured", "wireOn"]);
  const wire = await still();
  t.ok("…lines over the boxes (the picture changes)", JSON.stringify(wire) !== JSON.stringify(tex), [wire.red, tex.red]);
  await p.keyboard.press("Shift+Digit6");
  t.eq("Shift+6: X-Ray too", await shadeOn(), ["textured", "wireOn", "xrayOn"]);
  const xr = await still();
  t.ok("…the picture changes again", JSON.stringify(xr) !== JSON.stringify(wire), [xr.red, wire.red]);
  await p.keyboard.press("Shift+Digit5"); await p.keyboard.press("Shift+Digit6");
  t.eq("…both off again", await shadeOn(), ["textured"]);
  await p.click("#v3dShade [data-base=solid]");
  t.eq("the bar's buttons do the same (Solid)", await shadeOn(), ["solid"]);
  await p.click("#v3dShade [data-base=textured]");
  await p.waitForTimeout(800);
  t.eq("…kept in sight.viewer3d", (await ls("sight.viewer3d"))?.shadeBase, "textured");

  // ---- turns and saved cameras, per asset ---------------------------------------------------------------------
  // (on m_step: its blue box is raised, so a quarter turn about X shows)
  await close();
  const step = id["m_step.glb"];
  await open3d(step);
  const sHome = await fit();
  await p.keyboard.press("Shift+Digit7");
  const turned = await still();
  t.eq("Shift+7 turns the model a quarter (sight.v3dRot)", await ls("sight.v3dRot"), { [step]: 1 });
  t.ok("…the picture changes (blue no longer above red)", !!(turned.red && turned.blue) && !near(turned.blue.cy - turned.red.cy, sHome.blue.cy - sHome.red.cy, 40), [turned.blue && turned.blue.cy - turned.red.cy, sHome.blue.cy - sHome.red.cy]);
  const fitTurned = await fit();
  const orb2 = await drag("left", -150, 80);
  await p.keyboard.press("Alt+Digit1");
  await p.waitForTimeout(200);
  t.ok("Alt+1 saves the view", /View 1 saved/.test(await toast()), await toast());
  const cam = (await ls("sight.v3dCams"))?.[step]?.["1"];
  t.ok("…in sight.v3dCams (position, target, the turn count)", !!cam && cam.p?.length === 3 && cam.t?.length === 3 && cam.turns === 1, cam);
  const away = await drag("left", 220, -40);
  t.ok("…orbited away from it", !sameView(away, orb2, 20));
  await p.keyboard.press("Digit1");
  t.ok("1 recalls it", sameView(await still(), orb2, 6), [await frame(), orb2]);
  // A view saved at one turn, recalled at another: the turn comes back with it.
  for (let i = 0; i < 3; i++) await p.keyboard.press("Shift+Digit7");
  await still();
  t.eq("three more quarter turns: back to none", (await ls("sight.v3dRot"))?.[step], undefined);
  await p.keyboard.press("Digit1");
  const rec = await still();
  t.eq("…1 recalls the view with its turn", (await ls("sight.v3dRot"))?.[step], 1);
  t.ok("…and the same picture", sameView(rec, orb2, 6), [rec.red, orb2.red]);
  await close();
  // Another model: its own turns and views.
  const o0 = await open3d(other);
  t.eq("another model: not turned", (await ls("sight.v3dRot"))?.[other], undefined);
  await p.keyboard.press("Digit1");
  await p.waitForTimeout(150);
  t.ok("…its view 1 is empty", /View 1 is empty/.test(await toast()), await toast());
  t.ok("…and the view stays", sameView(await still(), o0, 4));
  for (let i = 0; i < 4; i++) await p.keyboard.press("Shift+Digit7");
  await p.waitForTimeout(300);
  t.eq("four quarter turns: back to none (its key goes)", await ls("sight.v3dRot"), { [step]: 1 });
  await close();
  await p.waitForTimeout(1200);   // (the settings push)
  const srv = (await L.api(cfg, "/api/settings")).ui || {};
  t.eq("the server keeps the turns", JSON.parse(srv["sight.v3dRot"] || "null"), { [step]: 1 });
  t.ok("…and the views", !!JSON.parse(srv["sight.v3dCams"] || "{}")?.[step]?.["1"]);
  // A fresh browser: the turn and the view come back with the settings.
  const p2 = await L.newPage(t, cfg, { label: "page 2" });
  await open3d(step, p2);
  t.ok("a fresh browser: the model opens turned", sameView(await fit(p2), fitTurned, 6), [await frame(p2), fitTurned]);
  await p2.keyboard.press("Digit1");
  t.ok("…and view 1 recalls", sameView(await still(p2), orb2, 6));
  await close(p2);
  await p2.context().close();

  // ---- .usdz: through the server's conversion (usd-core), and without it (three's USDLoader) ----------------------
  const usdz = id["m_parts.usdz"];
  const seen = [];
  p.on("response", (r) => { const u = new URL(r.url()); if (/^\/api\/(model-glb|model-res|file)\//.test(u.pathname)) seen.push(u.pathname + u.search + " " + r.status()); });
  const uz = await open3d(usdz);
  t.ok(".usdz: the server's GLB is used", seen.includes(`/api/model-glb/${usdz} 200`), seen);
  t.ok("…the model shows", !!uz.any && uz.any.n > 2000, uz.any);
  await close();
  const p3 = await L.newPage(t, cfg, { label: "no conversion" });
  const seen3 = [];
  p3.on("response", (r) => { const u = new URL(r.url()); if (/^\/api\/(model-glb|file)\//.test(u.pathname)) seen3.push(u.pathname + " " + r.status()); });
  await p3.route(`**/api/model-glb/${usdz}`, (r) => r.fulfill({ status: 404, contentType: "application/json", body: '{"detail":"usd-core is not installed"}' }));
  const uz3 = await open3d(usdz, p3);
  t.ok("without the conversion (404): the file itself is read", seen3.includes(`/api/model-glb/${usdz} 404`) && seen3.includes(`/api/file/${usdz} 200`), seen3);
  t.ok("…and the model still shows, framed alike", !!uz3.any && uz3.any.n > 2000 && near(uz3.any.cx, uz.any.cx, 60) && near(uz3.any.cy, uz.any.cy, 60), [uz3.any, uz.any]);
  await close(p3);
  await p3.context().close();

  // ---- an FBX with its texture beside it (/api/model-res) ----------------------------------------------------------
  // (In a fresh page: a page that has the model cached already from its grid thumbnail may not ask again.)
  const fbx = id["m_quad.fbx"];
  const p4 = await L.newPage(t, cfg, { label: "fbx" });
  const seen4 = [];
  p4.on("request", (r) => { const u = new URL(r.url()); if (/^\/api\/model-res\//.test(u.pathname)) seen4.push(u.pathname + u.search); });
  const fq = await open3d(fbx, p4);
  t.ok("FBX: its texture is asked for by name (/api/model-res)", seen4.includes(`/api/model-res/${fbx}?name=m_green.png`), seen4);
  t.eq("…and found beside it", (await fetch(`${cfg.base}/api/model-res/${fbx}?name=m_green.png`)).status, 200);
  t.ok("…the quad shows it (green)", !!fq.green && fq.green.n > 2000, fq.green);
  await close(p4);
  await p4.context().close();

  // ---- a Gaussian splat -------------------------------------------------------------------------------------------
  const splat = id["m_balls.splat"];
  const sp = await open3d(splat);
  t.ok("splat: both balls show, red left of blue", !!(sp.red && sp.blue && sp.red.n > 300 && sp.blue.n > 300 && sp.red.cx < sp.blue.cx), sp);
  t.eq("…no UV editor nor explode for a splat", await p.evaluate(() => [document.querySelector("#v3dShade [data-act=uv]")?.offsetParent === null, document.querySelector("#v3dExplode").offsetParent === null]), [true, true]);
  await p.mouse.move(...await center());
  await p.mouse.wheel(0, -300);
  const spz = await still();
  t.ok("…the wheel zooms it", spz.red && spz.blue && gap(spz) > gap(sp) * 1.2, [gap(spz), gap(sp)]);
  t.ok("…F frames it again", sameView(await fit(), await fit(), 2) && near(gap(await frame()), gap(sp), 40), [gap(await frame()), gap(sp)]);
  await close();

  // ---- a note on a 3D view: stored with its view, a pick goes back to it --------------------------------------------
  await open3d(boxes);
  const nv = await drag("left", 120, -60);
  await p.click("#annoBtn");   // (in 3D, A flies left: the button)
  await p.waitForSelector(".an-top:not([hidden])");
  if (!(await p.$eval(".light .an-panel", (e) => !e.hidden).catch(() => false))) await p.keyboard.press("KeyC");
  await p.keyboard.press("KeyR");
  const [qx, qy] = await center();
  await p.mouse.move(qx - 80, qy - 60); await p.mouse.down(); await p.mouse.move(qx + 80, qy + 60, { steps: 8 }); await p.mouse.up();
  await p.click(".an-panel .an-input");
  await p.keyboard.type("a note on this view");
  await p.keyboard.press("Enter");
  const note = await (async () => { for (let i = 0; i < 60; i++){ const r = (await L.rows(cfg, boxes)).find((x) => x.kind === "note"); if (r) return r; await p.waitForTimeout(100); } return null; })();
  t.ok("3D note: stored with its view (ctx.vk, the camera)", !!note && !!note.data.ctx?.vk, note && note.data.ctx);
  const shape = (await L.rows(cfg, boxes)).find((x) => x.kind === "shape");
  t.ok("…its drawing too, on the same view", !!shape && shape.data.ctx?.vk === note?.data.ctx?.vk, shape && shape.data.ctx);
  await p.click("#annoBtn");   // (drawing off: the orbit is free again)
  const nref = await still();   // (the note's view as shown with the panel open)
  await drag("left", -250, 100);
  await p.click(".an-panel .an-note .an-nt");
  await p.waitForTimeout(300);
  const back3 = await still();
  t.ok("…picking the note goes back to its view", sameView(back3, nref, 10), [back3.red, nref.red]);
  await close();

  // ---- touch -------------------------------------------------------------------------------------------------------
  const tp = await L.newPage(t, cfg, { touch: true, mobile: false, label: "touch" });
  await L.openLight(tp, boxes, { touch: true });
  await loaded(tp);
  const th = await fit(tp);
  const [tx, ty] = await center(tp);
  await L.pinch(tp, tx, ty, 100, 260);
  const tz = await still(tp);
  t.ok("touch: a pinch zooms", tz.red && tz.red.bw > th.red.bw * 1.2, [tz.red && tz.red.bw, th.red.bw]);
  await fit(tp);
  await L.touchDrag(tp, tx, ty, tx + 180, ty, 10);
  const to = await still(tp);
  t.ok("touch: one finger orbits", !sameView(to, th, 30) && Math.abs(gap(to) - gap(th)) > 5, [to.red, th.red, gap(to), gap(th)]);
  await tp.tap("#v3dShade [data-base=solid]");
  t.eq("touch: the shading buttons by tap", await shadeOn(tp), ["solid"]);
  await tp.tap("#v3dShade [data-base=textured]");
  await tp.tap("#v3dShade [data-act=rotate]");
  await tp.waitForTimeout(300);
  t.eq("touch: the turn button", (await ls("sight.v3dRot", tp))?.[boxes], 1);
  await tp.tap("#v3dShade [data-act=rotate]"); await tp.tap("#v3dShade [data-act=rotate]"); await tp.tap("#v3dShade [data-act=rotate]");
  await tp.context().close();
});
