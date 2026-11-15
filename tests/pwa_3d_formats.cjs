// Opens each 3D file (or set of files, comma-separated: a model with the files it points at) in the
// built phone app and prints what the viewer made of it: error, mesh count, explode rig, world bounds.
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
    out[key] = await p.evaluate(() => { const R = window.__sightReview.R; return R ? { err: R.v3dError || null, meshes: R.v3d && R.v3d.meshCount, explode: R.v3d && R.v3d.canExplode, bounds: R.v3d && R.v3d.bounds(), textured: R.v3d && R.v3d.texturedMeshes(), centres: R.v3d && R.v3d.meshCentres(), colours: R.v3d && R.v3d.meshColours(), extras: R.extras.length } : null; });
    out[key].log = log;
    await ctx.close();
  }
  process.stdout.write(JSON.stringify(out));
  await b.close();
})();
