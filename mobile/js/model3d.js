// The phone app's 3D viewer (docs/PLAN-mobile.md stage 4): a model picked on the device (glTF / GLB,
// FBX, OBJ, STL, PLY, USD — see parseModel), shown
// with three.js (the same vendored build as Sight, published by tools/build_pwa.py under three/ and
// loaded only when a model is opened). The camera, quarter turns, the mesh order of a view's hidden
// list and the explode come from core/model3d-core.js — shared with Sight's lightbox — so a view
// ({vk, cam: {p, t, fov, turns}, hidden, explode}, FORMAT.md 3D ctx) shows the same picture in both.
// One finger orbits, two fingers zoom and pan (OrbitControls), a mouse wheel zooms.

import { applyTurns, frameObject3d, meshOrder, buildExplodeRig, applyExplode, buildEnvTexture,
  dropDeadTextures, stlMesh, plyMesh, plyHeaderIsSplat, parseUsd, FBX_TEXTURE_WAIT_MS, ENV_PRESETS,
  applyBaseMaterial, applyXray, setWireOverlay, createUvPainter, createAnimator, highlightMaterials, meshHighlight,
  SPLAT_EXT, SPLAT_FILE_TYPE_BY_EXT, turnSplat, splatHome, SPLAT_LOD_PHONE, splatCountHint, splatLodFor, splatSource, splatBox, modelGrid, tintGrid } from "../core/model3d-core.js";

const BG = "#0a0a0b";  // Sight's lightbox 3D default background (setBg: this phone's choice; stills keep this one)
const hexBg = (x) => (/^#[0-9a-f]{6}$/i.test(String(x || "")) ? String(x).toLowerCase() : BG);
const KEY = { az: 5, el: 50, i: 1.8 };  // Sight's thumbnail key light
// The light choices of the phone's Light row: an environment preset of Sight's (with the key light that
// follows the camera), the key light alone, or flat (ambient only, no shading from a direction).
export const LIGHTS = ["studio", "sunset", "overcast", "night", "head", "flat"];
// The shading choices (Sight's Shade bar): a base, plus the wireframe / x-ray overlays.
export const SHADES = ["solid", "vertex", "textured", "normal"];

let libs = null;
async function load(){
  if (!libs){
    libs = (async () => {
      const THREE = await import("three");
      const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
      return { THREE, OrbitControls };
    })();
    libs.catch(() => { libs = null; });
  }
  return libs;
}
let gltfDecoders = null;
async function gltfLoader(manager){
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  if (!gltfDecoders){
    const { DRACOLoader } = await import("three/addons/loaders/DRACOLoader.js");
    const { MeshoptDecoder } = await import("three/addons/libs/meshopt_decoder.module.js");
    const draco = new DRACOLoader();
    draco.setDecoderPath(new URL("../three/jsm/libs/draco/gltf/", import.meta.url).href);
    gltfDecoders = { draco, MeshoptDecoder };
  }
  const l = new GLTFLoader(manager);
  l.setDRACOLoader(gltfDecoders.draco);
  l.setMeshoptDecoder(gltfDecoders.MeshoptDecoder);
  return l;
}

const extOf = (name) => { const m = /\.[^.\\/]+$/.exec(name || ""); return m ? m[0].toLowerCase() : ""; };
const baseName = (u) => { let b = String(u).split(/[?#]/)[0].split(/[\\/]/).pop() || ""; try { b = decodeURIComponent(b); } catch {} return b.toLowerCase(); };

// The model in a picked file, as Sight's lightbox loads it (loadModel in index.html; the shared parts
// come from model3d-core.js): glTF / GLB (Draco, meshopt), FBX, OBJ, STL, PLY (a mesh; a Gaussian splat
// is refused), USD (.usdz / .usd / .usda / .usdc — read here with three's USDLoader, where Sight converts
// on its server; usdAsSight keeps Sight's units). extras: [{name, blob}] picked with it — the files it
// points at (a .gltf's .bin, textures), found by name whatever folder the model names.
export async function parseModel(blob, name, extras = []){
  const { THREE } = await load();
  const ext = extOf(name);
  const urls = new Map();
  (extras || []).forEach((x) => { if (x && x.blob && x.name) urls.set(baseName(x.name), URL.createObjectURL(x.blob)); });
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((u) => (/^(blob|data):/i.test(u) ? u : urls.get(baseName(u)) || u));
  let started = false;
  manager.onStart = () => { started = true; };
  const idle = new Promise((ok) => { manager.onLoad = ok; manager.onError = () => {}; });
  // Waits (bounded) for the textures a loader asked the manager for; at once when it asked for none.
  const settle = () => started ? Promise.race([idle, new Promise((r) => setTimeout(r, FBX_TEXTURE_WAIT_MS))]) : Promise.resolve();
  try {
    if (await isSplat(blob, name)) throw new Error("This is a Gaussian splat, not a mesh");
    const buf = await blob.arrayBuffer();
    if (ext === ".glb" || ext === ".gltf"){
      if (ext === ".gltf"){
        let json = null;
        try { json = JSON.parse(new TextDecoder().decode(buf)); } catch { throw new Error("This .gltf file cannot be read"); }
        const missing = [...(json.buffers || []), ...(json.images || [])].map((x) => x && x.uri).filter((u) => typeof u === "string" && !/^data:/i.test(u) && !urls.has(baseName(u)));
        if (missing.length) throw new Error(`This .gltf needs ${missing.map(baseName).join(", ")} — pick it together with the model (or export one .glb)`);
      }
      const g = await (await gltfLoader(manager)).parseAsync(buf, "");
      if (!g || !g.scene) throw new Error("No model in this file");
      g.scene.animations = g.animations || [];  // (as Sight's loadModel: the clips go with the model)
      return g.scene;
    }
    if (ext === ".fbx"){
      const { FBXLoader } = await import("three/addons/loaders/FBXLoader.js");
      const obj = new FBXLoader(manager).parse(buf, "");
      await settle();
      dropDeadTextures(obj);
      return obj;
    }
    if (ext === ".obj"){
      const { OBJLoader } = await import("three/addons/loaders/OBJLoader.js");
      return new OBJLoader(manager).parse(new TextDecoder().decode(buf));
    }
    if (ext === ".stl"){
      const { STLLoader } = await import("three/addons/loaders/STLLoader.js");
      return stlMesh(THREE, new STLLoader().parse(buf));
    }
    if (ext === ".ply"){
      const { PLYLoader } = await import("three/addons/loaders/PLYLoader.js");
      return plyMesh(THREE, new PLYLoader().parse(buf));
    }
    if (ext === ".usdz" || ext === ".usd" || ext === ".usda" || ext === ".usdc"){
      // (model3d-core.js parseUsd, as Sight's lightbox reads USD; textures picked with it come through the manager)
      const { USDLoader } = await import("three/addons/loaders/USDLoader.js");
      return await parseUsd(THREE, USDLoader, buf, manager, settle);
    }
    throw new Error(`The app does not open ${ext || "this"} files`);
  } finally {
    // Textures still on their way keep their URLs a while; then they go.
    setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 60000);
  }
}

// A Gaussian splat (shown by createViewer with Spark, as Sight's lightbox shows one): .splat / .spz / .ksplat /
// .sog, or a .ply whose header says so — told by its first 8 KB alone, as Sight (it may be hundreds of MB).
export async function isSplat(blob, name){
  const ext = extOf(name);
  if (SPLAT_EXT.includes(ext)) return true;
  return ext === ".ply" && plyHeaderIsSplat(new TextDecoder("ascii").decode(await blob.slice(0, 8192).arrayBuffer()));
}

// host: the element the canvas fills. o: {name, extras, turns, onMove(), onTap(x, y) (a short one-finger tap on
// the model, client px), onAnim() (the animation played / paused / moved)} → the viewer, or throws (not a
// model, no WebGL).
export async function createViewer(host, blob, o = {}){
  if (await isSplat(blob, o.name)) return await createSplatViewer(host, blob, o);
  let hostEl = host;
  const L = await load(), THREE = L.THREE;
  const obj = await parseModel(blob, o.name, o.extras);
  let renderer = null;
  try { return build(); }
  catch (e){
    // (no WebGL, a model the explode rig cannot take…): nothing is left behind
    obj.traverse((c) => { if (c.geometry) c.geometry.dispose(); });
    if (renderer){ try { renderer.dispose(); renderer.forceContextLoss(); } catch {} renderer.domElement.remove(); }
    throw e;
  }
  function build(){
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  const dpr = Math.min(devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  // Lights (setLight): an environment map baked per preset (kept once built), the key light, an ambient.
  const envs = new Map();
  const ambient = new THREE.AmbientLight(0xffffff, 0);
  scene.add(ambient);
  let light = "studio";
  const key = new THREE.DirectionalLight(0xffffff, KEY.i), D2R = Math.PI / 180;
  key.position.set(Math.sin(KEY.az * D2R) * Math.cos(KEY.el * D2R), Math.sin(KEY.el * D2R), Math.cos(KEY.az * D2R) * Math.cos(KEY.el * D2R)).multiplyScalar(5);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 2000);
  camera.add(key);  // the key light follows the camera: every side of the model is lit as it turns
  scene.add(camera);
  const cv = renderer.domElement;
  cv.className = "c3d";
  cv.style.touchAction = "none";
  hostEl.appendChild(cv);
  const controls = new L.OrbitControls(camera, cv);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.zoomToCursor = true;
  const base = { q: obj.quaternion.clone(), p: obj.position.clone() };
  let turns = (o.turns | 0) & 3, explode = 0, need = true, live = true, w = 0, h = 0;
  // Sight's opening framing, moved back along the same line until the whole model is in the picture
  // across too (a phone held upright is narrow: the lightbox's framing would cut the sides off).
  const frame = () => {
    frameObject3d(THREE, obj, scene, camera, controls.target);
    const box = new THREE.Box3().setFromObject(obj), r = (box.getSize(new THREE.Vector3()).length() || 1) / 2;
    const a = hostEl.clientWidth && hostEl.clientHeight ? hostEl.clientWidth / hostEl.clientHeight : 1;
    const vf = camera.fov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * a);
    const dir = camera.position.clone().sub(controls.target), need = r / Math.sin(Math.min(vf, hf) / 2) * 1.05;
    if (dir.length() < need) camera.position.copy(controls.target).addScaledVector(dir.normalize(), need);
  };
  applyTurns(THREE, obj, base, turns);
  frame();
  controls.update();
  const rig = buildExplodeRig(THREE, obj);
  const meshes = meshOrder(obj);
  // The materials the model loaded with (the shading modes start from them every time).
  const origMats = new Map();
  obj.traverse((c) => { if (c.isMesh) origMats.set(c, c.material); });
  let shade = { base: "textured", wire: false, xray: false };
  // Grid under the model ("grid"; "axes": with the axes through the model's centre): round cells (a tenth of the
  // model, moved gridCell 1-2-5 steps), its colours from the background (core modelGrid / tintGrid).
  let gridMode = "off", grid = null, axes = null, gridCell = 0, cellSize = 0, bg = BG;
  const placeGrid = () => {
    if (grid){ scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); grid = null; }
    if (axes){ scene.remove(axes); axes.geometry.dispose(); axes.material.dispose(); axes = null; }
    if (gridMode === "off") return;
    if (rig) applyExplode(rig, 0);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    if (rig) applyExplode(rig, explode);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3()).length() || 1;
    ({ grid, cell: cellSize } = modelGrid(THREE, box, gridCell, bg));
    scene.add(grid);
    if (gridMode === "axes"){
      axes = new THREE.AxesHelper(size * 0.75);
      axes.position.copy(grid.position);
      axes.raycast = () => {};
      scene.add(axes);
    }
  };
  const setLightNow = (k) => {
    light = LIGHTS.includes(k) ? k : "studio";
    let env = null;
    if (ENV_PRESETS[light]){
      env = envs.get(light);
      if (env === undefined){ env = buildEnvTexture(THREE, renderer, ENV_PRESETS[light]); envs.set(light, env); }
    }
    scene.environment = env;
    scene.environmentIntensity = 1.2;
    key.visible = light !== "flat";
    key.intensity = light === "night" ? 1.2 : KEY.i;
    ambient.intensity = light === "flat" ? 2.6 : light === "head" ? 0.35 : env ? 0 : 0.8;
  };
  setLightNow("studio");
  // The selected mesh (index in the hidden-list order, or -1) and its highlight overlays.
  let sel = -1, hl = [];
  const hlMats = highlightMaterials(THREE);
  const clearHl = () => { hl.forEach((h) => h.removeFromParent()); hl = []; };
  const highlight = () => {
    clearHl();
    const m = meshes[sel];
    if (!m) return;
    for (const mat of hlMats){
      const h = meshHighlight(THREE, m, Array.isArray(m.material) ? m.material.map(() => mat) : mat);
      scene.add(h);
      hl.push(h);
    }
  };
  let uvPainter = null;
  // Animation clips (glTF / FBX): Sight's animator (model3d-core.js), after the rig as in Sight.
  let quiet = false;  // (still(): the pose moves and comes back unseen)
  const anim = createAnimator(THREE, obj, { rig: () => rig, explode: () => explode, onChange: () => { need = true; if (!quiet && o.onAnim) o.onAnim(); } });
  const size = () => {
    const cw = hostEl.clientWidth, ch = hostEl.clientHeight;
    if (cw < 2 || ch < 2 || (cw === w && ch === h)) return;
    w = cw; h = ch;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    need = true;
  };
  controls.addEventListener("change", () => { need = true; });
  // A short one-finger tap (not an orbit): picks a mesh (o.onTap).
  // (Pointers down by id: an up that never reached the canvas must not leave a "second finger" behind.)
  let tap = null;
  const down = new Set();
  cv.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") down.clear();
    down.add(e.pointerId);
    tap = down.size === 1 && (e.pointerType !== "mouse" || e.button === 0) ? { id: e.pointerId, x: e.clientX, y: e.clientY, at: performance.now() } : null;
  });
  cv.addEventListener("pointermove", (e) => { if (tap && tap.id === e.pointerId && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8) tap = null; });
  cv.addEventListener("lostpointercapture", (e) => { down.delete(e.pointerId); });
  const up = (e) => {
    down.delete(e.pointerId);
    const t = tap;
    tap = null;
    if (e.type !== "pointerup" || !t || t.id !== e.pointerId || performance.now() - t.at > 450) return;
    if (o.onTap) o.onTap(e.clientX, e.clientY);
  };
  cv.addEventListener("pointerup", up);
  cv.addEventListener("pointercancel", up);
  let lastT = performance.now();
  const tick = () => {
    if (!live) return;
    requestAnimationFrame(tick);
    size();
    const now = performance.now(), dt = (now - lastT) / 1000;
    lastT = now;
    if (anim && anim.tick(dt)){ need = true; if (o.onAnim) o.onAnim(); }
    controls.update();
    if (!need || !w) return;
    need = false;
    renderer.render(scene, camera);
    if (o.onMove) o.onMove();
  };
  // The camera set exactly (a view): no damping momentum may carry it on.
  const place = (p, t) => {
    const damp = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    camera.position.fromArray(p);
    controls.target.fromArray(t);
    controls.update();
    controls.enableDamping = damp;
    need = true;
  };
  const setTurns = (n) => {
    n = (n | 0) & 3;
    if (n === turns) return false;
    turns = n;
    applyTurns(THREE, obj, base, turns);
    if (gridMode !== "off") placeGrid();
    need = true;
    return true;
  };
  const setFov = (f) => { if (f && Math.abs(camera.fov - f) > 1e-6){ camera.fov = f; camera.updateProjectionMatrix(); } };
  const getHidden = () => meshes.flatMap((m, i) => (m.visible ? [] : [i]));
  const setHidden = (list) => { const s = new Set(list || []); meshes.forEach((m, i) => { m.visible = !s.has(i); }); need = true; };
  // The amount is kept without a rig too (a single-part model): a view written at another amount — Sight
  // keeps one slider for every model — must still match once the camera goes there.
  const setExplode = (x) => { x = Math.min(1, Math.max(0, Number(x) || 0)); explode = x; if (rig){ applyExplode(rig, x); need = true; } };
  const raycaster = new THREE.Raycaster();
  const api = {
    THREE, canvas: cv, meshCount: meshes.length, canExplode: !!rig,
    // The animation (model3d-core.js createAnimator: clips, state(), set({clip, t}), seek, play, pause,
    // toggle, setClip), null for a model without clips.
    anim,
    get turns(){ return turns; }, get explode(){ return explode; },
    aspect: () => { size(); return w && h ? w / h : (hostEl.clientWidth || 1) / (hostEl.clientHeight || 1); },
    // Moves the canvas into another element (the review screen was rebuilt).
    attach(el){ hostEl = el; el.appendChild(cv); w = 0; h = 0; size(); need = true; },
    getView: () => ({ p: camera.position.toArray(), t: controls.target.toArray(), fov: camera.fov, turns }),
    setView(v){
      if (!v || !v.p || !v.t) return;
      setTurns(v.turns || 0);
      setFov(v.fov || 50);
      place(v.p, v.t);
    },
    // A quarter turn about X (Z-up → Y-up first), framed again — as Sight's turn button.
    turn(){ setTurns(turns + 1); api.home(); return turns; },
    home(){ setFov(50); frame(); place(camera.position.toArray(), controls.target.toArray()); },
    getHidden, setHidden, setExplode,
    // The mesh under client point (x, y) (index in the hidden-list order), -1 for none.
    pick(x, y){
      const r = cv.getBoundingClientRect();
      if (!r.width || !r.height) return -1;
      raycaster.setFromCamera(new THREE.Vector2((x - r.left) / r.width * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camera);
      obj.updateMatrixWorld(true);
      const hit = raycaster.intersectObjects(meshes.filter((m) => m.visible), false)[0];
      return hit ? meshes.indexOf(hit.object) : -1;
    },
    get selected(){ return sel; },
    select(i){ sel = meshes[i] ? i : -1; highlight(); need = true; },
    meshName: (i) => { const m = meshes[i]; return m ? m.name || (m.parent && m.parent.name) || `Mesh ${i + 1}` : ""; },
    // Mesh i's UV set `set` (0 = uv, 1 = uv1…) over its base-colour texture (Sight's UV pane), {canvas, w, h,
    // sets, set} or null (no UVs).
    uvPicture(i, max = 1024, set = 0){
      const m = meshes[i];
      if (!m) return null;
      if (!uvPainter) uvPainter = createUvPainter(THREE, renderer);
      const om = origMats.get(m) || m.material, bg = [].concat(om).find((x) => x && x.map && x.map.image);
      const r = uvPainter.paint([{ c: m, om, mats: null }], { bg: bg ? bg.map : null, max, set, gltf: /\.gl(b|tf)$/i.test(o.name || ""), color: 0xff8a1f, fillA: 0.14, wireA: 0.9 });
      need = true;
      return r;
    },
    get shading(){ return { ...shade }; },
    setShading(v){
      const n = { ...shade, ...v };
      if (!SHADES.includes(n.base)) n.base = "textured";
      if (n.base !== shade.base){ applyBaseMaterial(THREE, obj, origMats, n.base); applyXray(obj, false); applyXray(obj, n.xray); }
      else if (!!n.xray !== !!shade.xray) applyXray(obj, n.xray);
      if (!!n.wire !== !!shade.wire) setWireOverlay(THREE, obj, n.wire);
      shade = { base: n.base, wire: !!n.wire, xray: !!n.xray };
      need = true;
    },
    get grid(){ return gridMode; },
    setGrid(m){ gridMode = m === "grid" || m === "axes" ? m : "off"; placeGrid(); need = true; },
    // The grid's cell: steps along 1-2-5 from a tenth of the model (-4…4), and its size in model units now.
    get gridCell(){ return gridCell; }, get cellSize(){ return cellSize; },
    setGridCell(n){ n = Math.max(-4, Math.min(4, Math.round(Number(n) || 0))); if (n === gridCell) return; gridCell = n; if (gridMode !== "off") placeGrid(); need = true; },
    // The background (a #rrggbb colour); the grid takes its colours from it.
    get bg(){ return bg; },
    setBg(c){ bg = hexBg(c); scene.background.set(bg); if (grid) tintGrid(THREE, grid, bg); need = true; },
    get light(){ return light; },
    setLight(k){ setLightNow(k); need = true; },
    // The model seen from `cam` with `hidden` meshes hidden and parts at `explode`, as a canvas
    // `aspect` wide per 1 high (≤ max px on its long side); the live view is put back right after,
    // in the same task (nothing on screen moves).
    still(cam, { hidden = null, explode: ex = null, anim: pose = null, aspect = api.aspect(), max = 1600 } = {}){
      const keep = { v: api.getView(), hidden: getHidden(), explode, w, h, anim: anim ? { clip: anim.clip, t: anim.time, playing: anim.playing } : null, shade: { ...shade }, light };
      const W = aspect >= 1 ? max : Math.round(max * aspect), H = aspect >= 1 ? Math.round(max / aspect) : max;
      const out = document.createElement("canvas");
      out.width = Math.max(1, W); out.height = Math.max(1, H);
      try {
        if (cam) api.setView(cam);
        if (hidden) setHidden(hidden);
        // Pictures of views are cached: the default look (Textured, no wire / x-ray, Studio light), not this
        // phone's choice.
        if (shade.base !== "textured" || shade.wire || shade.xray) api.setShading({ base: "textured", wire: false, xray: false });
        if (light !== "studio") setLightNow("studio");
        scene.background.set(BG);
        quiet = true;
        if (pose && anim) anim.set(pose);  // (before the explode: the animator puts the rig on the pose at the live amount)
        if (ex != null && rig) applyExplode(rig, ex);
        // No selection, grid or axes in a picture (a view's picture is cached: it must not depend on them).
        hl.forEach((x) => x.removeFromParent());
        if (grid) grid.visible = false;
        if (axes) axes.visible = false;
        renderer.setPixelRatio(1);
        renderer.setSize(out.width, out.height, false);
        camera.aspect = out.width / out.height;
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);
        out.getContext("2d").drawImage(cv, 0, 0, out.width, out.height);
      } finally {
        hl.forEach((x) => scene.add(x));
        if (keep.shade) api.setShading(keep.shade);
        if (keep.light !== light) setLightNow(keep.light);
        scene.background.set(bg);
        if (grid) grid.visible = true;
        if (axes) axes.visible = true;
        if (keep.anim && pose){ anim.set(keep.anim); if (keep.anim.playing) anim.play(); }
        quiet = false;
        if (rig) applyExplode(rig, keep.explode);
        setHidden(keep.hidden);
        api.setView(keep.v);
        renderer.setPixelRatio(dpr);
        w = 0; h = 0;  // size() sets the canvas back to the host
        size();
        if (w){ renderer.render(scene, camera); }
        need = true;
      }
      return out;
    },
    refresh(){ need = true; },
    // Meshes with a base-colour texture that loaded (tests: a model's textures arrived).
    // Each mesh's world-space centre, in the hidden-list order (tests: two loaders lay a model out alike).
    meshCentres(){ return meshes.map((m) => new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3()).toArray()); },
    // Each mesh's base colour (hex; a texture counts as "tex"), in the hidden-list order (tests).
    meshColours(){ return meshes.map((m) => { const x = [].concat(m.material)[0]; return x && x.map ? "tex" : x && x.color ? x.color.getHexString() : ""; }); },
    texturedMeshes(){ return meshes.filter((m) => [].concat(m.material).some((x) => x && x.map && x.map.image)).length; },
    // The model's world bounds now ({min, max} arrays; tests compare loaders with it).
    bounds(){ const b = new THREE.Box3().setFromObject(obj); return { min: b.min.toArray(), max: b.max.toArray() }; },
    dispose(){
      live = false;
      if (anim) anim.dispose();
      clearHl();
      hlMats.forEach((m) => m.dispose());
      if (grid){ grid.geometry.dispose(); grid.material.dispose(); }
      if (axes){ axes.geometry.dispose(); axes.material.dispose(); }
      controls.dispose();
      obj.traverse((c) => {
        if (c.geometry) c.geometry.dispose();
        (Array.isArray(c.material) ? c.material : c.material ? [c.material] : []).forEach((m) => {
          for (const k in m){ const t = m[k]; if (t && t.isTexture) t.dispose(); }
          m.dispose();
        });
      });
      envs.forEach((e) => { if (e) e.dispose(); });
      origMats.forEach((om) => [].concat(om).forEach((m) => { if (m) m.dispose(); }));
      try { renderer.dispose(); } catch {}
      try { renderer.forceContextLoss(); } catch {}
      cv.remove();
    },
  };
  size();
  tick();
  return api;
  }
}

// A Gaussian splat (Spark's SplatMesh, the lightbox's splat viewer): placed and framed as Sight places it
// (SPLAT_QUATERNION, splatHome) and turned as Sight turns one (turnSplat: the mesh viewers' quarter turn about X,
// framed again from the turned bounds), so a view's camera + turns mean the same. A splat has no meshes, materials,
// lights or explode: those parts of the viewer's API do nothing (meshCount 0, canExplode false, anim null; isSplat says which). Spark sorts the splats for the camera
// in a worker after each render, so the canvas renders on for a while after every change, and still() waits
// for the sort at its camera (it returns a Promise here).
// A big splat (over SPLAT_LOD_PHONE splats) gets Spark's LoD tree: at most that many splats are drawn, picked
// for the camera (coarser out of view and behind it). Pixel ratio at most 1.5, and 1 while the camera moves.
const SPLAT_DPR = 1.5, SPLAT_DPR_MOVING = 1, SPLAT_SETTLE_MS = 250;
async function createSplatViewer(host, blob, o = {}){
  let hostEl = host;
  const L = await load(), THREE = L.THREE;
  const { SparkRenderer, SplatMesh } = await import("@sparkjsdev/spark");
  const fileBytes = new Uint8Array(await blob.arrayBuffer());
  // (LoD only for a file likely over the budget: see splatLodFor)
  const hint = await splatCountHint(extOf(o.name), fileBytes.subarray(0, 65536), fileBytes.length);
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
  const cv = renderer.domElement;
  let spark = null, mesh = null;
  const scrap = () => {
    try { if (mesh) mesh.dispose(); } catch {}
    try { if (spark){ clearTimeout(spark.updateTimeoutId); spark.updateTimeoutId = -1; spark.dispose(); } } catch {}  // (a deferred update would recreate its workers)
    try { renderer.dispose(); renderer.forceContextLoss(); } catch {}
    cv.remove();
  };
  const dpr = Math.min(devicePixelRatio || 1, SPLAT_DPR), dprMoving = Math.min(dpr, SPLAT_DPR_MOVING);
  let ratio = dpr, moved = -Infinity, seenLod = null;
  renderer.setPixelRatio(dpr);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 2000);
  try {
    spark = new SparkRenderer({ renderer, lodSplatCount: SPLAT_LOD_PHONE });
    scene.add(spark);
    mesh = new SplatMesh({ fileBytes, fileType: SPLAT_FILE_TYPE_BY_EXT[extOf(o.name)] || "ply", ...splatLodFor(hint, SPLAT_LOD_PHONE) });
    scene.add(mesh);
    await mesh.initialized;
  } catch (e){ scrap(); throw e; }
  let turns = (o.turns | 0) & 3;
  turnSplat(THREE, mesh, turns);
  const lod = !!(mesh.packedSplats && mesh.packedSplats.lodSplats);
  // (a big one: smaller footprints — less overdraw, hardly visible at that density)
  if (lod) spark.maxStdDev = Math.sqrt(5);
  let home0 = splatHome(THREE, splatBox(THREE, mesh));
  camera.near = home0.near; camera.far = home0.far;
  camera.updateProjectionMatrix();
  cv.className = "c3d";
  cv.style.touchAction = "none";
  hostEl.appendChild(cv);
  const controls = new L.OrbitControls(camera, cv);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.zoomToCursor = true;
  let live = true, w = 0, h = 0, explode = 0, busy = Promise.resolve(), stilling = false, bg = BG;
  let stillTurns = null;  // the turn the mesh is at for a still under way (null: none)
  // Frames still to render (Spark's sort for the last camera lands a few frames after it moved).
  let warm = 90;
  const kick = () => { warm = 90; };
  // Sight's opening framing, moved back along the same line until the splat fits across a narrow screen too.
  const frame = () => {
    camera.position.copy(home0.p);
    controls.target.copy(home0.t);
    const r = home0.size / 2;
    const a = hostEl.clientWidth && hostEl.clientHeight ? hostEl.clientWidth / hostEl.clientHeight : 1;
    const vf = camera.fov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * a);
    const dir = camera.position.clone().sub(controls.target), need = r / Math.sin(Math.min(vf, hf) / 2) * 1.05;
    if (dir.length() < need) camera.position.copy(controls.target).addScaledVector(dir.normalize(), need);
  };
  frame();
  controls.update();
  const size = () => {
    const cw = hostEl.clientWidth, ch = hostEl.clientHeight;
    if (cw < 2 || ch < 2 || (cw === w && ch === h)) return;
    w = cw; h = ch;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    kick();
  };
  controls.addEventListener("change", () => { moved = performance.now(); kick(); });
  // Spark is still at work: a sort under way, or its LoD worker picking splats for the last camera.
  const sparkBusy = () => !!(spark.sorting || (spark.lodWorker && spark.lodWorker.queue != null));
  const tick = () => {
    if (!live) return;
    requestAnimationFrame(tick);
    if (stilling) return;
    size();
    controls.update();
    if (!w) return;
    // A lower pixel ratio while the camera moves, the full one once it has settled.
    const r = performance.now() - moved < SPLAT_SETTLE_MS ? dprMoving : dpr;
    if (r !== ratio){ ratio = r; renderer.setPixelRatio(r); renderer.setSize(w, h); warm = Math.max(warm, 90); }
    // A new LoD pick lands asynchronously, maybe after the tail: render on until it is drawn and sorted.
    if (spark.currentLod !== seenLod){ seenLod = spark.currentLod; warm = Math.max(warm, 30); }
    else if (warm <= 0 && sparkBusy()) warm = 1;
    if (warm <= 0) return;
    warm--;
    renderer.render(scene, camera);
    if (o.onMove) o.onMove();
  };
  const place = (p, t) => {
    const damp = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    camera.position.fromArray(p);
    controls.target.fromArray(t);
    controls.update();
    controls.enableDamping = damp;
    kick();
  };
  const setFov = (f) => { if (f && Math.abs(camera.fov - f) > 1e-6){ camera.fov = f; camera.updateProjectionMatrix(); } };
  // A quarter turn about X (as a mesh viewer's setTurns); the bounds and the opening camera follow it.
  const setTurns = (n) => {
    n = (n | 0) & 3;
    if (n === turns) return false;
    turns = n;
    turnSplat(THREE, mesh, turns);
    home0 = splatHome(THREE, splatBox(THREE, mesh));
    // (during a still the mesh stays at the still's turn — measured at the new one, put back at once; the
    // still's finally turns it to `turns`)
    if (stillTurns !== null) turnSplat(THREE, mesh, stillTurns);
    camera.near = home0.near; camera.far = home0.far;
    camera.updateProjectionMatrix();
    kick();
    return true;
  };
  const api = {
    THREE, canvas: cv, isSplat: true, meshCount: 0, canExplode: false, anim: null,
    get turns(){ return turns; }, get explode(){ return explode; },
    aspect: () => { size(); return w && h ? w / h : (hostEl.clientWidth || 1) / (hostEl.clientHeight || 1); },
    attach(el){ hostEl = el; el.appendChild(cv); w = 0; h = 0; size(); kick(); },
    getView: () => ({ p: camera.position.toArray(), t: controls.target.toArray(), fov: camera.fov, turns }),
    setView(v){
      if (!v || !v.p || !v.t) return;
      setTurns(v.turns || 0);
      setFov(v.fov || 50);
      place(v.p, v.t);
    },
    // A quarter turn about X (Z-up → Y-up first), framed again — as Sight's turn button.
    turn(){ setTurns(turns + 1); api.home(); return turns; },
    home(){ setFov(50); frame(); place(camera.position.toArray(), controls.target.toArray()); },
    getHidden: () => [], setHidden(){},
    // Kept (a view from a mesh-shaped review may carry one); nothing moves.
    setExplode(x){ explode = Math.min(1, Math.max(0, Number(x) || 0)); },
    pick: () => -1, get selected(){ return -1; }, select(){}, meshName: () => "", uvPicture: () => null,
    get shading(){ return { base: "textured", wire: false, xray: false }; }, setShading(){},
    get grid(){ return "off"; }, setGrid(){}, get light(){ return "studio"; }, setLight(){},
    get gridCell(){ return 0; }, get cellSize(){ return 0; }, setGridCell(){},
    // The background, as a mesh viewer's (stills keep the default one).
    get bg(){ return bg; }, setBg(c){ bg = hexBg(c); scene.background.set(bg); kick(); },
    // The splat seen from `cam` (null: the live camera) as a canvas `aspect` wide per 1 high (≤ max px), once
    // Spark has sorted it for that camera: drawn off screen (a render target, a camera of its own), so nothing on
    // screen moves; the live canvas does not render meanwhile (its own sort would replace this one). Stills run
    // one at a time.
    still(cam, { aspect = api.aspect(), max = 1600 } = {}){
      const run = busy.then(async () => {
        const W = Math.max(1, aspect >= 1 ? max : Math.round(max * aspect)), H = Math.max(1, aspect >= 1 ? Math.round(max / aspect) : max);
        const out = document.createElement("canvas");
        out.width = W; out.height = H;
        const v = cam && cam.p && cam.t ? cam : api.getView();
        // (at the camera's own turn: the splat turns for the still and back, unseen — the live canvas waits)
        const vt = (v.turns | 0) & 3;
        const sc = new THREE.PerspectiveCamera(v.fov || 50, W / H, camera.near, camera.far);
        sc.position.fromArray(v.p);
        sc.lookAt(new THREE.Vector3().fromArray(v.t));
        sc.updateMatrixWorld();
        const rt = new THREE.WebGLRenderTarget(W, H, { colorSpace: THREE.SRGBColorSpace });
        stilling = true;
        stillTurns = vt;
        if (vt !== turns) turnSplat(THREE, mesh, vt);
        // Spark sorts on its own after every render (autoUpdate): that sort reads back asynchronously with a pixel
        // buffer bound, which makes the synchronous read below fail (an empty picture), and a sort under way makes
        // update() skip this camera. So: no sorting of its own meanwhile, wait for one under way, sort for this
        // camera, then render and read.
        // A big splat's LoD pick (worker, asynchronous) is for the camera of the update that started it, at the
        // render size of the last render: so the still's size first, then update until the pick for this camera has
        // landed and been drawn and sorted (a pick under way would skip this camera: wait it out first).
        spark.autoUpdate = false;
        // (a deferred live update — Spark's non-preUpdate path — would sort for the live camera meanwhile)
        if (spark.updateTimeoutId !== -1 && spark.updateTimeoutId != null){ clearTimeout(spark.updateTimeoutId); spark.updateTimeoutId = -1; }
        try {
          const idle = async () => { while (sparkBusy() && live) await new Promise((r) => setTimeout(r, 10)); };
          if (spark.renderSize) spark.renderSize.set(W, H);
          for (let i = 0; i < 6 && live; i++){
            await idle();
            const lod0 = spark.currentLod;
            if (live) await spark.update({ scene, camera: sc });
            await idle();
            if (spark.currentLod === lod0) break;
          }
          if (!live) throw new Error("The viewer was closed");
          const prev = renderer.getRenderTarget();
          renderer.setRenderTarget(rt);
          scene.background.set(BG);  // (cached pictures: the default background)
          renderer.render(scene, sc);
          scene.background.set(bg);
          const px = new Uint8Array(W * H * 4);
          renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
          renderer.setRenderTarget(prev);
          const img = new ImageData(W, H), row = W * 4;
          for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * row, (H - y) * row), y * row);  // (GL rows go up)
          out.getContext("2d").putImageData(img, 0, 0);
        } finally {
          rt.dispose();
          // (back to the live turn — the one now, should a turn have come in meanwhile)
          stillTurns = null;
          if (vt !== turns) turnSplat(THREE, mesh, turns);
          spark.autoUpdate = true;
          stilling = false;
          kick();
        }
        return out;
      });
      busy = run.catch(() => {});
      return run;
    },
    refresh: kick,
    meshCentres: () => [], meshColours: () => [], texturedMeshes: () => 0,
    // Splats in the file (a big file's from its header; if unknown, its LoD tree's — originals and merged nodes);
    // `lod`: whether it has the tree, the budget, how many Spark draws now (≤ budget), the pixel ratio, the count hint.
    get splatCount(){
      if (lod && hint.exact) return hint.n;
      const s = splatSource(mesh); return (s && s.numSplats) || mesh.numSplats || 0;
    },
    get lod(){ return { on: lod, budget: SPLAT_LOD_PHONE, drawn: spark.activeSplats || 0, ratio, hint }; },
    // The world bounds (splat centres) at the current turn.
    bounds(){ const box = splatBox(THREE, mesh); return { min: box.min.toArray(), max: box.max.toArray() }; },
    dispose(){
      live = false;
      controls.dispose();
      scrap();
    },
  };
  size();
  // Spark builds what it draws in the first render and sorts after it: until then a still comes out empty.
  // Warm it up off screen at the opening camera (bounded) before the viewer is handed out.
  stilling = true;
  try {
    const until = performance.now() + (lod ? 10000 : 3000);
    renderer.render(scene, camera);
    await spark.update({ scene, camera });
    while (!(spark.activeSplats > 0) && performance.now() < until && live){
      renderer.render(scene, camera);
      await new Promise((r) => setTimeout(r, 30));
      await spark.update({ scene, camera });
    }
  } catch (e){ api.dispose(); throw e; }
  finally { stilling = false; }
  tick();
  return api;
}
