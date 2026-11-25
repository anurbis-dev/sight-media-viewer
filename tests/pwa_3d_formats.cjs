// Opens each 3D file (or set of files, comma-separated: a model with the files it points at) in the
// built phone app and prints what the viewer made of it: error, mesh count, explode rig, world bounds, animation (clips, bounds at the last pose).
// Called by tests/test_pwa.py (formats: glTF + .bin, FBX, OBJ, STL, USDZ / USDA / USDC).
//   node tests/pwa_3d_formats.cjs <baseURL> <file[,companion…]>…
"use strict";
const { chromium } = require("playwright");
const [base, ...sets] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const out = {};
  for (const set of sets){
    const files = set.split(",");
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    const log = [];
    p.on("pageerror", (e) => log.push("pageerror: " + e.message));
    p.on("console", (m) => { if (m.type() === "error") log.push("console: " + m.text()); });
    await p.goto(base);
    await p.evaluate(() => localStorage.setItem("sight-review:name", "T"));
    await p.reload();
    await p.waitForSelector("label.pick-file");
    await p.setInputFiles("label.pick-file input", files);
    await p.waitForFunction(() => { const R = window.__sightReview.R; return R && (R.v3d || R.v3dError); }, null, { timeout: 60000 }).catch(() => {});
    const key = require("path").basename(files[0]) + (files.length > 1 ? "+" : "");
    out[key] = await p.evaluate(async () => { const R = window.__sightReview.R; return R ? { splat: await splatOf(R.v3d), err: R.v3dError || null, meshes: R.v3d && R.v3d.meshCount, explode: R.v3d && R.v3d.canExplode, bounds: R.v3d && R.v3d.bounds(), textured: R.v3d && R.v3d.texturedMeshes(), centres: R.v3d && R.v3d.meshCentres(), colours: R.v3d && R.v3d.meshColours(), extras: R.extras.length, anim: animOf(R.v3d) } : null;
      // The clips, and the bounds / mesh centres at the last pose (then back to time 0).
      // A splat: its count, and how many pixels of its still (taken once Spark sorted it) are red / blue.
      async function splatOf(V){
        if (!V || !V.isSplat) return null;
        const count = async (cam) => {
          const c = await V.still(cam, { aspect: 1, max: 96 }), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
          let red = 0, blue = 0;
          for (let i = 0; i < d.length; i += 4){ if (d[i] > 150 && d[i + 2] < 100) red++; if (d[i + 2] > 150 && d[i] < 100) blue++; }
          return { red, blue };
        };
        const live = await count(null), v0 = V.getView();
        // A still at a view that is not the live camera (a note's view): the camera moved to the other side, then
        // the opening view's picture — and one taken right after a move (a sort may be under way).
        V.setView({ p: [-v0.p[0], v0.p[1], -v0.p[2]], t: v0.t, fov: v0.fov });
        await new Promise((r) => setTimeout(r, 300));
        const other = await count(v0);
        V.setView(v0); await new Promise(requestAnimationFrame);
        const racing = await count({ p: [-v0.p[0], v0.p[1], -v0.p[2]], t: v0.t, fov: v0.fov });
        // A view of the red ball alone (x = -1) taken while the live camera looks at the blue one: only red.
        V.setView({ p: [1, 0, 1.2], t: [1, 0, 0], fov: 50 }); await new Promise(requestAnimationFrame);
        const onlyRed = await count({ p: [-1, 0, 1.2], t: [-1, 0, 0], fov: 50 });
        V.setView(v0);
        // Turned (a file whose balls sit off the X axis: bounds per turn; the live still after each turn; a still of a
        // view written at turn 0 — close to the red ball — taken while the splat is turned once: only red).
        let turned = null;
        if (/_up\./.test(window.__sightReview.R.meta.asset.name)){
          const b = [V.bounds()], pics = [], near = { p: [-1, -1, 1.2], t: [-1, -1, 0], fov: 50, turns: 0 };
          for (let i = 1; i <= 2; i++){ V.turn(); b.push(V.bounds()); await new Promise(requestAnimationFrame); pics.push(await count(null)); }
          V.setView(Object.assign({}, v0, { turns: 1 })); V.home();
          const t1 = V.getView().turns, liveNear = await count({ ...near, turns: 1 }), atTurn0 = await count(near), after = V.getView().turns;
          V.setView(v0);
          turned = { bounds: b, pics, t1, liveNear, atTurn0, after, back: V.getView().turns };
        }
        return { count: V.splatCount, lod: V.lod, ...live, other, racing, onlyRed, turned };
      }
      function animOf(V){ const A = V && V.anim; if (!A) return null; A.seek(A.duration); const r = { clips: A.clips.length, duration: A.duration, bounds: V.bounds(), centres: V.meshCentres() }; A.seek(0);
        // (a skinned mesh's bounds are cached by three: the pictures of the two poses tell it moved)
        const pic = (t) => V.still(null, { anim: { clip: 0, t }, max: 96, aspect: 1 }).toDataURL();
        r.moves = pic(0) !== pic(A.duration); return r; } });
    out[key].log = log;
    await ctx.close();
  }
  process.stdout.write(JSON.stringify(out));
  await b.close();
})();
