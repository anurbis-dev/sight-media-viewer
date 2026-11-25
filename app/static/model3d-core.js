// 3D model helpers shared by Sight's lightbox (index.html) and the phone app (mobile/js/model3d.js), so a
// camera view, a quarter turn, the mesh order of a view's hidden list and the explode of a view mean the
// same thing in both. Plain ES module, no imports: every function takes the THREE namespace.

// Turns a model `n` quarter turns about X (first turn = Z-up -> Y-up), from its loaded pose (base: {q, p}).
export function applyTurns(THREE, obj, base, n){
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -n * Math.PI / 2);
  obj.quaternion.copy(base.q).premultiply(q);
  obj.position.copy(base.p).applyQuaternion(q);
  obj.updateMatrixWorld(true);
}

// The meshes in the order a view's `hidden` list counts them (FORMAT.md 3D ctx): the lightbox
// inspector's mesh list — every Mesh with a position attribute, in traverse order (points skipped).
export function meshOrder(obj){
  const out = [];
  obj.traverse((c) => { const g = c.geometry; if (g && g.attributes && g.attributes.position && !c.isPoints && c.isMesh) out.push(c); });
  return out;
}

// The opening framing: target on the box centre, the camera up and to the side.
export function frameObject3d(THREE, obj, scene, camera, target){
  scene.add(obj);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3()).length() || 1;
  const center = box.getCenter(new THREE.Vector3());
  target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(size*0.7, size*0.45, size*0.7));
  camera.near = size/100; camera.far = size*20; camera.updateProjectionMatrix();
  return size;
}

// ---- Exploded view ------------------------------------------------------------------------------
// The explosion-graph method of Li, Agrawala, Curless & Salesin, "Automated Generation of
// Interactive 3D Exploded View Diagrams" (SIGGRAPH 2008), which is also how CAD auto-explode
// behaves (grounded component, one straight move per part, sub-assemblies exploded per level):
// - Every node of the scene graph with 2+ geometric children is an assembly; its children are
//   atomic parts at that level and nested assemblies explode inside their own parent's move.
// - Per assembly, parts are removed one at a time: of the parts not blocked in at least one of the
//   six model axes by the parts still in place, the one with the shortest escape (distance to
//   clear the box of the remaining parts it touches) goes next, along that axis. Blocking and
//   contact are tested on precise bounding boxes (an approximation of the paper's geometry tests).
// - The largest part of each assembly is grounded and never moves; if everything left is
//   interlocked, the part with the fewest blockers goes, still along one axis.
// - A part rides along with the largest part it was resting on (its graph parent), so stacks
//   spread out in sequence and screws leave together with their cover.
// - The slider is staged: top-level assemblies before their insides, and within an assembly the
//   parts in removal order, each easing over part of the range.
// Guards (a model split into one mesh per face must not hang the page): the graph costs O(n²) per
// assembly, so an assembly above EXPLODE_GRAPH_MAX parts, or any assembly solved after the time
// budget ran out, falls back to the O(n) axial mode (each part along the dominant axis of its
// offset from the assembly center, no blocking); above EXPLODE_MAX_MESHES meshes in total there is
// no explode at all. Nothing here recurses per part or spreads per-part arrays into arguments.
const EXPLODE_GRAPH_MAX = 1000, EXPLODE_MAX_MESHES = 50000, EXPLODE_BUDGET_MS = 400;
export function buildExplodeRig(THREE, obj){
  // Nodes with a mesh in their subtree, in one post-order pass (traverse is pre-order).
  const nodes = [];
  obj.traverse((c) => nodes.push(c));
  const meshCount = nodes.reduce((k, c) => k + (c.isMesh ? 1 : 0), 0);
  if (meshCount < 2 || meshCount > EXPLODE_MAX_MESHES) return null;
  const geo = new Set();
  for (let k = nodes.length - 1; k >= 0; k--){
    const c = nodes[k];
    if (c.isMesh || c.children.some((ch) => geo.has(ch))) geo.add(c);
  }
  const hasMesh = (o) => geo.has(o);
  const deadline = performance.now() + EXPLODE_BUDGET_MS;
  // Solve in the model's own frame (its axes are the canonical explosion directions).
  const saved = { p: obj.position.clone(), q: obj.quaternion.clone(), s: obj.scale.clone() };
  const upM = new THREE.Vector3(0, 1, 0).applyQuaternion(saved.q.clone().invert());
  const upAxis = [0, 1, 2].reduce((a, i) => (Math.abs(upM.getComponent(i)) > Math.abs(upM.getComponent(a)) ? i : a), 0);
  const upSign = Math.sign(upM.getComponent(upAxis)) || 1;
  obj.position.set(0, 0, 0); obj.quaternion.identity(); obj.scale.set(1, 1, 1);
  obj.updateMatrixWorld(true);
  const items = new Map(), levels = [];
  const DIRS = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];
  const place = (c, v, carry) => {
    const w0 = c.getWorldPosition(new THREE.Vector3());
    const vec = c.parent.worldToLocal(w0.clone().add(v)).sub(c.parent.worldToLocal(w0.clone()));
    items.set(c, { pos: c.position.clone(), vec, carry, start: 0, span: 1, off: new THREE.Vector3() });
  };
  const pushAll = (depth, list) => { const l = (levels[depth] ||= []); for (const c of list) l.push(c); };
  const largest = (vol) => { let m = 0; for (const x of vol) if (x > m) m = x; return m; };
  // O(n) fallback for huge or late assemblies: grounded largest part stays, the rest move along the
  // dominant axis of their offset from the assembly center, twice as far out plus a gap.
  function solveAxial(parts, depth){
    const boxes = parts.map((c) => new THREE.Box3().setFromObject(c));
    const all = new THREE.Box3();
    boxes.forEach((b) => all.union(b));
    const mid = all.getCenter(new THREE.Vector3()), size = all.getSize(new THREE.Vector3());
    const gap = size.length() * 0.03;
    const vol = boxes.map((b) => { const z = b.getSize(new THREE.Vector3()); return z.x * z.y * z.z; });
    const grounded = vol.indexOf(largest(vol));
    const order = [];
    parts.forEach((c, i) => {
      if (i === grounded) return;
      const d = boxes[i].getCenter(new THREE.Vector3()).sub(mid);
      let a = 0;
      for (let k = 1; k < 3; k++) if (Math.abs(d.getComponent(k)) / (size.getComponent(k) || 1) > Math.abs(d.getComponent(a)) / (size.getComponent(a) || 1)) a = k;
      const x = d.getComponent(a);
      if (Math.abs(x) < 1e-9) return;
      place(c, new THREE.Vector3().setComponent(a, x + Math.sign(x) * gap), null);
      order.push(c);
    });
    pushAll(depth, order);
  }
  function solve(parts, depth){
    const n = parts.length;
    if (n > EXPLODE_GRAPH_MAX || performance.now() > deadline) return solveAxial(parts, depth);
    const boxes = parts.map((c) => new THREE.Box3().setFromObject(c, true));
    const all = new THREE.Box3();
    boxes.forEach((b) => all.union(b));
    const diag = all.getSize(new THREE.Vector3()).length() || 1;
    const eps = diag * 0.002, gap = diag * 0.06;
    const lo = (b, a) => b.min.getComponent(a), hi = (b, a) => b.max.getComponent(a);
    const vol = boxes.map((b) => { const z = b.getSize(new THREE.Vector3()); return (z.x + eps) * (z.y + eps) * (z.z + eps); });
    // Grounded: the largest part; among near-equal ones, the one nearest the assembly's center.
    const vmax = largest(vol), mid = all.getCenter(new THREE.Vector3());
    let grounded = -1, gd = Infinity;
    boxes.forEach((b, i) => {
      if (vol[i] < vmax * 0.99) return;
      const dist = b.getCenter(new THREE.Vector3()).distanceToSquared(mid);
      if (dist < gd){ gd = dist; grounded = i; }
    });
    // Projections on the plane across axis a overlap (touching faces do not count).
    const across = (b1, b2, a) => [0, 1, 2].every((k) => k === a || Math.min(hi(b1, k), hi(b2, k)) - Math.max(lo(b1, k), lo(b2, k)) > eps);
    const blockCount = new Int32Array(n * 6);
    const blocks = parts.map(() => []); // q -> [p * 6 + d] that q blocks
    const contacts = parts.map(() => []);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++){
      if (i === j) continue;
      const bi = boxes[i], bj = boxes[j];
      if (i < j && [0, 1, 2].every((k) => hi(bi, k) + eps >= lo(bj, k) && hi(bj, k) + eps >= lo(bi, k))){
        contacts[i].push(j); contacts[j].push(i);
      }
      // j blocks i along +a if it overlaps i across a and reaches past i's leading face.
      for (let d = 0; d < 6; d++){
        const [a, sg] = DIRS[d];
        if (!across(bi, bj, a)) continue;
        if (sg > 0 ? hi(bj, a) > hi(bi, a) + eps && hi(bj, a) > lo(bi, a) + eps : lo(bj, a) < lo(bi, a) - eps && lo(bj, a) < hi(bi, a) - eps){
          blockCount[i * 6 + d]++; blocks[j].push(i * 6 + d);
        }
      }
    }
    const active = new Array(n).fill(true);
    const bias = (d) => (DIRS[d][0] === upAxis ? (DIRS[d][1] === upSign ? 1 : 1.25) : 1.1);
    // Escape distances only change when a touching part leaves, so they are cached per part.
    const escCache = new Float64Array(n * 6).fill(NaN);
    const escape = (i, d) => {
      if (!Number.isNaN(escCache[i * 6 + d])) return escCache[i * 6 + d];
      const [a, sg] = DIRS[d], u = boxes[i].clone();
      for (const j of contacts[i]) if (active[j]) u.union(boxes[j]);
      return (escCache[i * 6 + d] = sg > 0 ? hi(u, a) - lo(boxes[i], a) : hi(boxes[i], a) - lo(u, a));
    };
    const order = [];
    for (let left = n; left > 1; left--){
      let best = null;
      for (let pass = 0; pass < 2 && !best; pass++){
        for (let i = 0; i < n; i++){
          if (!active[i] || i === grounded) continue;
          for (let d = 0; d < 6; d++){
            const blocked = blockCount[i * 6 + d];
            if (pass === 0 && blocked) continue;
            const e = escape(i, d);
            const score = blocked * 1e12 + e * bias(d);
            if (!best || score < best.score) best = { i, d, e, score };
          }
        }
      }
      const { i, d, e } = best;
      active[i] = false;
      for (const k of blocks[i]) blockCount[k]--;
      for (const j of contacts[i]) escCache.fill(NaN, j * 6, j * 6 + 6);
      let carry = -1;
      for (const j of contacts[i]) if (active[j] && (carry < 0 || vol[j] > vol[carry])) carry = j;
      const c = parts[i], [a, sg] = DIRS[d];
      place(c, new THREE.Vector3().setComponent(a, sg * (e + gap)), carry >= 0 ? parts[carry] : null);
      order.push(c);
    }
    pushAll(depth, order);
  }
  // Breadth-first over assemblies (a queue, not recursion: hierarchies can be very deep).
  const queue = [[obj, 0]];
  for (let q = 0; q < queue.length; q++){
    const [node, depth] = queue[q];
    let parts = node.children.filter(hasMesh);
    while (parts.length === 1 && !parts[0].isMesh) parts = parts[0].children.filter(hasMesh);
    if (parts.length < 2) continue;
    solve(parts, depth);
    for (const c of parts) if (!c.isMesh) queue.push([c, depth + 1]);
  }
  obj.position.copy(saved.p); obj.quaternion.copy(saved.q); obj.scale.copy(saved.s);
  obj.updateMatrixWorld(true);
  if (!items.size) return null;
  const m = items.size, span = m > 1 ? 0.4 : 1;
  let k = 0;
  for (const l of levels) if (l) for (const c of l){ const it = items.get(c); it.start = m > 1 ? (1 - span) * k++ / (m - 1) : 0; it.span = span; }
  // A part's carry is always placed after it (it left later), so walking the list backwards
  // computes every carry before the parts that ride on it.
  return { items, list: [...items].reverse() };
}
// Moves every exploded part to its place for slider value t (0 = assembled, 1 = fully exploded).
export function applyExplode(rig, t){
  if (!rig) return;
  for (const [c, it] of rig.list){
    let u = Math.min(1, Math.max(0, (t - it.start) / it.span));
    u = u * u * (3 - 2 * u);
    it.off.copy(it.vec).multiplyScalar(u);
    const pc = it.carry && rig.items.get(it.carry);
    if (pc) it.off.add(pc.off);
    c.position.copy(it.pos).add(it.off);
  }
}

// A vertical gradient sky ({top, horizon, bottom} colours) baked through PMREMGenerator into a prefiltered
// environment map. null if anything fails (the caller then lights without it).
export function buildEnvTexture(THREE, renderer, colors){
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const geo = new THREE.SphereGeometry(50, 32, 16);
    const pos = geo.attributes.position;
    const buf = new Float32Array(pos.count * 3);
    const top = new THREE.Color(colors.top), horizon = new THREE.Color(colors.horizon), bottom = new THREE.Color(colors.bottom);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++){
      const y = pos.getY(i) / 50;
      tmp.copy(horizon).lerp(y >= 0 ? top : bottom, Math.min(1, Math.abs(y) * 1.6));
      buf[i * 3] = tmp.r; buf[i * 3 + 1] = tmp.g; buf[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(buf, 3));
    const mat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true });
    envScene.add(new THREE.Mesh(geo, mat));
    const rt = pmrem.fromScene(envScene, 0.02);
    pmrem.dispose();
    geo.dispose();
    mat.dispose();
    return rt.texture;
  } catch (err) {
    console.warn("environment map build failed", err);
    return null;
  }
}

// ---- loading (the per-format parts of the lightbox's loadModel, shared with the phone) ----------

// How long an FBX may take to load the textures it asks for before the model is shown without them.
export const FBX_TEXTURE_WAIT_MS = 20000;

// A texture whose file could not be found stays image-less — sampled as black, which paints the
// model solid black (map) or fully invisible (alphaMap). Drop those slots so the flat material
// colour shows instead (and Sight's applyCompanions() may still fill them from a sibling file).
const TEXTURE_SLOTS = ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap", "alphaMap", "bumpMap", "specularMap", "lightMap", "displacementMap"];
export function dropDeadTextures(obj){
  obj.traverse((c) => {
    const mats = Array.isArray(c.material) ? c.material : (c.material ? [c.material] : []);
    for (const m of mats){
      for (const slot of TEXTURE_SLOTS){
        const t = m[slot];
        if (t && t.isTexture && !t.image){ m[slot] = null; m.needsUpdate = true; }
      }
    }
  });
}

// STL / PLY carry geometry only: the same plain grey material everywhere (PLY: its vertex colours).
export function stlMesh(THREE, geometry){
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xc5cdd8, metalness: 0.25, roughness: 0.55 }));
}
export function plyMesh(THREE, geometry){
  geometry.computeVertexNormals();
  const hasColor = !!geometry.getAttribute("color");
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xc5cdd8, vertexColors: hasColor, metalness: 0.2, roughness: 0.6 }));
}

// Gaussian splats (Spark's SplatMesh; the lightbox and the phone app). These extensions are always splats;
// a .ply is one only when its header says so (plyHeaderIsSplat). Spark does not sniff a format from a URL or
// bytes the way its own examples load them — it is told the file type.
export const SPLAT_EXT = [".splat", ".spz", ".ksplat", ".sog"];
export const SPLAT_FILE_TYPE_BY_EXT = { ".ply": "ply", ".spz": "spz", ".splat": "splat", ".ksplat": "ksplat", ".sog": "pcsogszip" };
// Most splat exporters (COLMAP / 3DGS) use a Y-down, Z-forward frame: a half turn about X makes it three's
// Y-up, as Spark's own examples do. Both viewers place a splat this way, so a view's camera means the same.
export const SPLAT_QUATERNION = [1, 0, 0, 0];
// A splat turned `n` quarter turns about X on top of SPLAT_QUATERNION — the mesh viewers' turn (applyTurns), so a
// view's camera + turns (FORMAT.md 3D ctx) mean the same for a splat on the phone and in the lightbox. Its bounds
// change with the turn: take splatBox / splatHome again afterwards (a quarter turn keeps the size, moves the centre).
export function turnSplat(THREE, mesh, n){
  applyTurns(THREE, mesh, { q: new THREE.Quaternion().fromArray(SPLAT_QUATERNION), p: new THREE.Vector3() }, (n | 0) & 3);
}
// The opening camera of a splat (both viewers): from its bounds (Box3), off the corner, as the lightbox
// frames one. {p, t, near, far}.
export function splatHome(THREE, box){
  const size = box.getSize(new THREE.Vector3()).length() || 1, c = box.getCenter(new THREE.Vector3());
  return { p: c.clone().add(new THREE.Vector3(size * 0.7, size * 0.45, size * 0.7)), t: c, near: size / 100, far: size * 20, size };
}
// Level of detail for big splats (Spark's LoD tree): the phone app's budget of splats drawn per frame (Spark's
// own default for Android is 1e6, too much for a mid-range Mali GPU); the lightbox uses Spark's per-device default.
export const SPLAT_LOD_PHONE = 600000;
// SplatMesh options: a file with more splats than `budget` gets an LoD tree, built in Spark's worker while it
// loads (the original splats are not kept: `nonLod` off, so a phone does not hold both); a file at or under the
// budget loads as before (no tree), so it looks exactly the same.
export function splatLodOptions(budget){ return { lod: true, lodAbove: Math.max(1, Math.round(budget)) + 1 }; }
// How many splats a file has, from its first bytes (`head`: 64 KB or the whole file) and its size, so LoD is asked
// for only when the file is likely over the budget (asking sends any file, small ones too, through Spark's other
// decoder). {n, exact}: exact for .splat (32 bytes each), a .ply (its header) and an .spz (count in the gzipped
// header); otherwise a generous upper bound (4 bytes per splat — .ksplat, .sog, an unreadable header).
export async function splatCountHint(ext, head, size){
  ext = String(ext || "").toLowerCase();
  if (ext === ".splat" && size > 0) return { n: Math.floor(size / 32), exact: true };
  try {
    if (ext === ".ply"){
      const m = /element\s+vertex\s+(\d+)/.exec(new TextDecoder("latin1").decode(head).split("end_header")[0]);
      if (m) return { n: Number(m[1]), exact: true };
    }
    if (ext === ".spz" && typeof DecompressionStream !== "undefined"){
      const ds = new DecompressionStream("gzip"), w = ds.writable.getWriter(), r = ds.readable.getReader();
      w.write(head).catch(() => {}); w.close().catch(() => {});  // (a truncated stream errors at its end, after the header)
      let buf = new Uint8Array(0);
      try {
        while (buf.length < 16){
          const { done, value } = await r.read();
          if (done) break;
          const nb = new Uint8Array(buf.length + value.length); nb.set(buf); nb.set(value, buf.length); buf = nb;
        }
      } finally { r.cancel().catch(() => {}); }
      const dv = buf.length >= 16 ? new DataView(buf.buffer, 0, 16) : null;
      if (dv && dv.getUint32(0, true) === 0x5053474E) return { n: dv.getUint32(8, true), exact: true };
    }
  } catch {}
  return { n: Math.ceil((size || 0) / 4), exact: false };
}
// The SplatMesh options for a file of `hint` (splatCountHint) under `budget`: LoD only if it may be over it
// (lodAbove then decides on the real count); none at all otherwise, so the file loads exactly as before.
export function splatLodFor(hint, budget){ return hint && hint.n > budget ? splatLodOptions(budget) : {}; }
// The mesh's splats as loaded: the plain ones, or the LoD tree's (originals and merged nodes) for a big file.
export function splatSource(mesh){
  const p = mesh.packedSplats || mesh.extSplats;
  if (!p) return null;
  return p.numSplats ? p : (p.lodSplats || p);
}
// Its world bounds (splat centres), as SplatMesh.getBoundingBox(true), which only reads the plain splats (empty
// for an LoD-only mesh) and unpacks every field of every splat. Here only the centres (float16 in a packed
// splat's words 1 and 2), through a lookup table. Anything else falls back to Spark's own.
let halfTable = null;
export function splatBox(THREE, mesh){
  const s = splatSource(mesh), a = s && s.packedArray, n = s ? s.numSplats || 0 : 0;
  if (!a || !n || !(a instanceof Uint32Array)) return mesh.getBoundingBox(true).applyMatrix4(mesh.matrixWorld);
  if (!halfTable){
    halfTable = new Float32Array(65536);
    for (let h = 0; h < 65536; h++){
      const e = (h >> 10) & 31, m = h & 1023, sg = h & 32768 ? -1 : 1;
      halfTable[h] = e === 0 ? sg * m * 2 ** -24 : e === 31 ? (m ? NaN : sg * Infinity) : sg * (1 + m / 1024) * 2 ** (e - 15);
    }
  }
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0, i4 = 0; i < n; i++, i4 += 4){
    const w1 = a[i4 + 1], x = halfTable[w1 & 65535], y = halfTable[w1 >>> 16], z = halfTable[a[i4 + 2] & 65535];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)).applyMatrix4(mesh.matrixWorld);
}

// A .ply is a Gaussian splat (not a mesh) when its header has per-splat opacity and SH / scale /
// rotation fields. `text`: the file's first bytes as ASCII (the header ends at "end_header").
export function plyHeaderIsSplat(text){
  const header = String(text).split("end_header")[0];
  const hasOpacity = /^property\s+\S+\s+opacity\s*$/m.test(header);
  const hasSplatField = /^property\s+\S+\s+(f_dc_0|scale_0|rot_0)\s*$/m.test(header);
  return hasOpacity && hasSplatField;
}

// A USD file (bytes) read with three's USDLoader and laid out by usdAsSight — the lightbox (.usd / .usda /
// .usdc, and a .usdz its server does not convert) and the phone app both read USD this way. Its textures
// (inside a .usdz) load as plain images, not through the manager: the loader's own onLoad says when they are
// all in (bounded, as an FBX's); a standalone layer's textures go through `manager` by base name (its URL
// modifier finds them). settle(): waits for what the manager itself loads (optional).
export async function parseUsd(THREE, USDLoader, buf, manager, settle = null){
  let g = null;
  await Promise.race([new Promise((ok) => { g = new USDLoader(manager).parse(buf, "", ok, (e) => { console.warn("USD textures", e); ok(); }); }),
    new Promise((r) => setTimeout(r, FBX_TEXTURE_WAIT_MS))]);
  if (settle) await settle();
  if (!g) throw new Error("No model in this USD file");
  dropDeadTextures(g);
  return usdAsSight(THREE, g);
}

// A USD stage from three's USDLoader laid out as Sight's USDZ → GLB conversion (app/usdz_convert.py)
// gives it, so a view's camera, its hidden-mesh list and its explode mean the same in both:
// - units: the Z-up turn is kept (the conversion turns Z-up to Y-up too), the loader's metersPerUnit scale
//   is taken off (the conversion does not scale);
// - layout: the conversion writes one glTF mesh with a primitive per material of each USD mesh (faces of one
//   material merged, ordered by the material's number), in prim order, positions in world space — GLTFLoader
//   makes that a node with one Mesh per primitive. So every mesh here is baked into world space and split the
//   same way, under one node.
// Not matched: the conversion leaves out invisible and proxy / guide meshes; the loader keeps them.
// A stage with animation (the loader's clips: SkelAnimation, time-sampled xformOps — `group.animations`)
// cannot be baked: its nodes and skeletons are kept (the clips animate them by prim name), each mesh is split
// in place (a node with the mesh's name and transform holding one mesh per material, as a glTF node with
// primitives). Mesh order and the meshes' rest-pose bounds stay the static layout's; the explode rig sees the
// stage's hierarchy, so an explode differs from the conversion's (which has no animation: Sight's lightbox reads
// an animated .usdz on the client too, so Sight and the phone agree).
export function usdAsSight(THREE, group){
  const animated = modelClips(group).length > 0;
  group.scale.set(1, 1, 1);
  group.updateMatrixWorld(true);
  const root = new THREE.Group(), node = animated ? group : new THREE.Group();
  root.add(node);
  if (animated){
    root.animations = group.animations;
    // The loader exposes a single skeleton on its root so PropertyBinding finds bones before same-named prims
    // (the mixer's root is ours now).
    if (group.skeleton) root.skeleton = group.skeleton;
  }
  const meshes = [];
  group.traverse((c) => { if (c.isMesh && c.geometry && c.geometry.attributes && c.geometry.attributes.position) meshes.push(c); });
  // The conversion's material numbers: registered in traverse order, per mesh its own material first, then
  // its subsets' (usdz_convert _Materials.add, keyed by the USD material path; vendored USDComposer tags
  // every material with userData.usdMaterial). A mesh's primitives come in that order, one per material.
  const rank = new Map();
  const keyOf = (mat) => (mat && mat.userData && typeof mat.userData.usdMaterial === "string" ? mat.userData.usdMaterial : "");
  const reg = (k) => { if (!rank.has(k)) rank.set(k, rank.size); };
  for (const m of meshes){
    // As a glTF primitive: the part's whole vertex buffer (baked to world space) with its material's indices —
    // so a primitive's bounds are its part's, as in Sight (the explode rig measures them).
    const geo = m.geometry.clone();
    if (!animated) geo.applyMatrix4(m.matrixWorld);
    const n = geo.attributes.position.count, idx = geo.index ? geo.index.array : null;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const own = mats.find((x) => x && x.userData && x.userData.usdMeshMaterial) || mats[0];
    reg(keyOf(own));
    mats.forEach((x) => reg(keyOf(x)));
    const groups = Array.isArray(m.material) && geo.groups.length ? geo.groups : [{ start: 0, count: idx ? idx.length : n, materialIndex: 0 }];
    const parts = new Map();  // material key -> {mat, ids}
    for (const g of groups){
      const mat = mats[g.materialIndex] || mats[0], k = keyOf(mat);
      let part = parts.get(k);
      if (!part){ part = { mat, ids: [] }; parts.set(k, part); }
      for (let i = g.start, end = Math.min(g.start + g.count, idx ? idx.length : n); i < end; i++) part.ids.push(idx ? idx[i] : i);
    }
    // Animated: the mesh's place in the stage becomes a node (same name, transform and children) holding the parts.
    let holder = node;
    if (animated){
      holder = new THREE.Group();
      holder.name = m.name;
      holder.position.copy(m.position); holder.quaternion.copy(m.quaternion); holder.scale.copy(m.scale);
      holder.visible = m.visible;
      const parent = m.parent;
      parent.children[parent.children.indexOf(m)] = holder;
      holder.parent = parent;
      m.parent = null;
    }
    for (const [k, part] of [...parts].sort((a, b) => rank.get(a[0]) - rank.get(b[0]))){
      if (!part.ids.length) continue;
      const pg = new THREE.BufferGeometry();
      for (const [name, at] of Object.entries(geo.attributes)) pg.setAttribute(name, at);
      if (animated && geo.morphAttributes) for (const [name, list] of Object.entries(geo.morphAttributes)) pg.morphAttributes[name] = list;
      pg.setIndex(part.ids);
      let mesh;
      if (animated && m.isSkinnedMesh){
        mesh = new THREE.SkinnedMesh(pg, part.mat);
        mesh.bind(m.skeleton, m.bindMatrix);
        mesh.bindMode = m.bindMode;
      } else mesh = new THREE.Mesh(pg, part.mat);
      if (animated && m.morphTargetInfluences){ mesh.morphTargetInfluences = m.morphTargetInfluences; mesh.morphTargetDictionary = m.morphTargetDictionary; }
      mesh.name = m.name;
      holder.add(mesh);
    }
    // (after the parts: a mesh's own parts come before its descendants' in traverse order, as in the static layout)
    if (animated) for (const ch of [...m.children]) holder.add(ch);
    m.geometry.dispose();
  }
  root.updateMatrixWorld(true);
  return root;
}

// ---- Floor grid (the lightbox's and the phone's) --------------------------------------------------
// The grid's two line colours for a background (a hex string or number): the background moved toward white on a
// dark one, toward black on a light one — the centre lines more (0.25), the others less (0.12), and at least 50 /
// 28 (of 255) away in brightness, so a mid grey still shows them. On Sight's default #0a0a0b that is about its old
// fixed 0x4a4a54 / 0x26262c.
export function gridColors(bg){
  const n = typeof bg === "number" ? bg : parseInt(String(bg || "#0a0a0b").replace("#", ""), 16) || 0;
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  const to = lum < 0.5 ? 255 : 0, room = Math.max(1, Math.abs(to - lum * 255));
  const mix = (k, least) => { k = Math.min(1, Math.max(k, least / room)); return rgb.reduce((acc, c) => (acc << 8) | Math.round(c + (to - c) * k), 0); };
  return [mix(0.25, 50), mix(0.12, 28)];
}
// Recolours a THREE.GridHelper for background `bg` (its vertex colours: 4 per division line, the centre one first
// colour). Cheap; skipped when the grid already has that background's colours.
export function tintGrid(THREE, grid, bg){
  if (!grid || grid.userData.bg === bg) return;
  const at = grid.geometry.getAttribute("color");
  if (!at) return;
  const [c1, c2] = gridColors(bg).map((x) => new THREE.Color(x));
  const lines = at.count / 4, centre = (lines - 1) / 2;
  for (let j = 0; j < at.count; j++){ const c = Math.floor(j / 4) === centre ? c1 : c2; at.setXYZ(j, c.r, c.g, c.b); }
  at.needsUpdate = true;
  grid.userData.bg = bg;
}
// The 1-2-5 step nearest x (… 0.1, 0.2, 0.5, 1, 2, 5, 10 …), `shift` steps along that sequence from it.
export function niceStep(x, shift = 0){
  if (!(x > 0)) return 1;
  const e = Math.floor(Math.log10(x)), m = x / 10 ** e;
  let k = 3 * e + (m < 1.5 ? 0 : m < 3.5 ? 1 : m < 7.5 ? 2 : 3);
  k += shift | 0;
  const d = Math.floor(k / 3);
  return [1, 2, 5][k - 3 * d] * 10 ** d;
}
// The phone's grid under a model of bounds `box`: cells of a round size (a tenth of the model's diagonal, moved
// `cellShift` 1-2-5 steps, -4…4), over about twice the model's diagonal (an even count so a centre line runs under
// the model; at most 600 cells across, which still covers the diagonal at the finest step). → {grid, cell}.
export function modelGrid(THREE, box, cellShift = 0, bg = "#0a0a0b"){
  const size = box.getSize(new THREE.Vector3()).length() || 1, c = box.getCenter(new THREE.Vector3());
  const cell = niceStep(size / 10, cellShift);
  let div = Math.ceil(size * 2 / cell / 2) * 2;
  div = Math.max(2, Math.min(600, div));
  const grid = new THREE.GridHelper(cell * div, div, 0xffffff, 0xffffff);
  tintGrid(THREE, grid, bg);
  grid.position.set(c.x, box.min.y + Math.max(0.001, size * 0.002), c.z);
  grid.raycast = () => {};
  return { grid, cell };
}

// ---- Shading (the lightbox's Shade bar and the phone's shading row) ------------------------------

// The environment gradients of the lightbox's "Environment light" presets (buildEnvTexture bakes one).
export const ENV_PRESETS = {
  studio:   { top: 0xcfe0ff, horizon: 0x8a8f9a, bottom: 0x1c1c20 },
  sunset:   { top: 0xffb37a, horizon: 0xff8a5c, bottom: 0x1a1420 },
  overcast: { top: 0xc7cdd6, horizon: 0xaeb4bd, bottom: 0x6b7078 },
  night:    { top: 0x0c1830, horizon: 0x101828, bottom: 0x02050c },
};

// Base shading swap (Blender-style: solid / vertex color / textured / normal), always starting
// from `origMats` (Map mesh -> the materials the model actually loaded with) so repeated switches never
// compound. Wireframe and x-ray are separate overlay passes below — they layer on top of
// whichever base is active instead of being mutually exclusive with it. solid: {color, rough, metal}
// of the Solid mode's material.
export function applyBaseMaterial(THREE, obj, origMats, mode, solid = {}){
  if (!obj || !origMats) return;
  obj.traverse((c) => {
    if (!c.isMesh || !origMats.has(c)) return;
    const cur = c.material;
    if (cur && cur.userData && cur.userData._v3dTemp) cur.dispose();
    let mat;
    if (mode === "solid"){
      mat = new THREE.MeshStandardMaterial({ color: solid.color ?? "#b7bdc7", roughness: solid.rough ?? 0.85, metalness: solid.metal ?? 0.05 });
      mat.userData._v3dSolid = true;
    }
    else if (mode === "vertex"){
      const hasColor = !!c.geometry.attributes.color;
      mat = new THREE.MeshBasicMaterial({ vertexColors: hasColor, color: hasColor ? 0xffffff : 0x555555 });
    } else if (mode === "normal") mat = new THREE.MeshNormalMaterial();
    else mat = origMats.get(c); // "textured"
    if (mat !== origMats.get(c)){
      mat.userData._v3dTemp = true;
      // A double-sided original stays double-sided (an open shell or inward faces must not vanish).
      const o0 = [].concat(origMats.get(c))[0];
      if (o0 && o0.side != null) mat.side = o0.side;
    }
    c.material = mat;
  });
}
// Mutates the *current* material's transparency in place (instead of swapping to a dedicated
// x-ray material) so it layers over whatever base mode is active; the original opacity is
// stashed on first use and restored when toggled back off. Multi-material meshes carry an array
// (textured mode restores it from origMats) — every entry is handled.
export function applyXray(obj, on){
  if (!obj) return;
  obj.traverse((c) => {
    if (!c.isMesh || !c.material) return;
    for (const m of Array.isArray(c.material) ? c.material : [c.material]) xrayMaterial(m, on);
  });
}
function xrayMaterial(m, on){
  if (!m) return;
  if (on){
    if (m.userData._xraySaved === undefined){
      m.userData._xraySaved = { opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite };
    }
    m.transparent = true;
    m.opacity = 0.3;
    m.depthWrite = false;
  } else if (m.userData._xraySaved !== undefined){
    Object.assign(m, m.userData._xraySaved);
    delete m.userData._xraySaved;
  }
  m.needsUpdate = true;
}
// A sibling LineSegments per mesh — toggling `.wireframe` on the base material would *replace*
// its solid fill instead of drawing edges on top of it, so this adds a real overlay mesh.
export function setWireOverlay(THREE, obj, on){
  if (!obj) return;
  const list = [];
  obj.traverse((c) => { if (c.isMesh && !c.userData._uvOverlay) list.push(c); });
  for (const c of list){
    let ov = c.userData._wireOverlay;
    if (on){
      if (!ov){
        const wg = new THREE.WireframeGeometry(c.geometry);
        ov = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x9fb4c7, transparent: true, opacity: 0.55 }));
        ov.raycast = () => {};
        c.add(ov);
        c.userData._wireOverlay = ov;
      }
      ov.visible = true;
    } else if (ov) ov.visible = false;
  }
}

// ---- Selection highlight (the lightbox's inspector and the phone's mesh pick) --------------------
// Blender's selection orange: a theme accent can be near-white and vanish on light textures.
export const HIGHLIGHT_COLOR = 0xff8a1f;
// The highlight's two layers (a fill and a faint wire), to be disposed by the caller.
export function highlightMaterials(THREE){
  return [
    new THREE.MeshBasicMaterial({ color: HIGHLIGHT_COLOR, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    new THREE.MeshBasicMaterial({ color: HIGHLIGHT_COLOR, wireframe: true, transparent: true, opacity: 0.18, depthWrite: false }),
  ];
}
// An overlay mesh drawing `c`'s geometry with `mat` (a material or an array, one per group), to be added
// to the *scene* (not the model: the shading modes traverse the model and would restyle it). It copies
// c's world matrix every frame, so explode, turns and animation carry it along; a skinned mesh binds to
// the same skeleton, morph targets follow.
export function meshHighlight(THREE, c, mat){
  const h = c.isSkinnedMesh ? new THREE.SkinnedMesh(c.geometry, mat) : new THREE.Mesh(c.geometry, mat);
  if (c.isSkinnedMesh){ h.bind(c.skeleton, c.bindMatrix); h.bindMode = c.bindMode; }
  if (c.morphTargetInfluences){ h.morphTargetInfluences = c.morphTargetInfluences; h.morphTargetDictionary = c.morphTargetDictionary; }
  h.matrixAutoUpdate = false;
  h.frustumCulled = false;
  h.renderOrder = 10;
  h.raycast = () => {};
  h.updateMatrixWorld = () => {
    h.visible = c.visible;  // a hidden mesh takes its highlight with it
    h.matrixWorld.copy(c.matrixWorld);
    if (h.isSkinnedMesh) h.bindMatrixInverse.copy(c.bindMatrixInverse);
  };
  h.updateWorldMatrix = h.updateMatrixWorld;
  return h;
}

// ---- UV picture (the lightbox's UV pane and the phone's UV sheet) ---------------------------------
// The geometry drawn with gl_Position = uv (wireframe + faint fill), over a texture on a quad, read back
// from a render target. Render targets come out linear without tone mapping, so sRGB is encoded here by
// hand (skipped for non-color textures such as normal maps, which are shown raw). glTF puts v = 0 at the
// image top (flipY false); other loaders at the bottom.

const UV_NAMES = ["uv", "uv1", "uv2", "uv3"];
export const uvSetCount = (g) => { let k = 0; while (k < UV_NAMES.length && g && g.attributes[UV_NAMES[k]]) k++; return k; };
let srgbLut = null;
// Renders `sc` with `cam` into `target` (W × H) and returns a 2D canvas of it (encode: linear → sRGB).
export function readbackCanvas(THREE, renderer, sc, cam, target, W, H, encode){
  if (!srgbLut){
    srgbLut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++){ const c = i / 255; srgbLut[i] = Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)); }
  }
  const lut = srgbLut;
  const prevRT = renderer.getRenderTarget(), prevColor = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
  const prevShadow = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(sc, cam);
  const px = new Uint8Array(W * H * 4);
  renderer.readRenderTargetPixels(target, 0, 0, W, H, px);
  renderer.setRenderTarget(prevRT);
  renderer.setClearColor(prevColor, prevAlpha);
  renderer.shadowMap.autoUpdate = prevShadow;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d");
  const data = ctx.createImageData(W, H), out = data.data;
  for (let y = 0; y < H; y++){
    let si = (H - 1 - y) * W * 4, di = y * W * 4; // GL rows are bottom-up
    for (let x = 0; x < W; x++, si += 4, di += 4){
      out[di] = encode ? lut[px[si]] : px[si];
      out[di + 1] = encode ? lut[px[si + 1]] : px[si + 1];
      out[di + 2] = encode ? lut[px[si + 2]] : px[si + 2];
      out[di + 3] = px[si + 3];
    }
  }
  ctx.putImageData(data, 0, 0);
  return cv;
}
// A quad filling a W × H picture with `tex` (its own aspect kept, its flipY honoured).
export function textureQuad(THREE, tex, W, H){
  const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  const ar = W / H, iar = tex.image && tex.image.width && tex.image.height ? tex.image.width / tex.image.height : ar;
  q.scale.set(Math.min(1, iar / ar), Math.min(1, ar / iar) * (tex.flipY ? 1 : -1), 1);
  return q;
}
const uvShader = (THREE, color, alpha, wire) => new THREE.ShaderMaterial({
  wireframe: wire, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  uniforms: { uFlip: { value: 1 }, uColor: { value: new THREE.Color(color) }, uAlpha: { value: alpha } },
  vertexShader: "attribute vec2 uvSel; uniform float uFlip; void main(){ vec2 p = uvSel * 2.0 - 1.0; p.y *= uFlip; gl_Position = vec4(p, 0.0, 1.0); }",
  fragmentShader: "uniform vec3 uColor; uniform float uAlpha; void main(){ gl_FragColor = vec4(uColor, uAlpha); }",
});
// Texture under the UVs, one channel at a time. sRGB textures arrive linear from the sampler and
// the readback encodes back to sRGB, so R/G/B show the stored values; alpha is not colour-managed,
// so it is pre-decoded here to survive that encode. RGBA composites over a checker.
const UV_CHAN = { rgb: 0, rgba: 1, r: 2, g: 3, b: 4, a: 5 };
const uvBgShader = (THREE, tex, chan, srgb, W) => new THREE.ShaderMaterial({
  depthTest: false, depthWrite: false,
  uniforms: { map: { value: tex }, uChan: { value: UV_CHAN[chan] ?? 0 }, uSrgb: { value: srgb ? 1 : 0 }, uCell: { value: Math.max(8, Math.round(W / 32)) } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `uniform sampler2D map; uniform int uChan; uniform float uSrgb; uniform float uCell; varying vec2 vUv;
    float lin(float c){ return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4); }
    void main(){
      vec4 t = texture2D(map, vUv);
      float a = uSrgb > 0.5 ? lin(t.a) : t.a;
      vec2 q = floor(gl_FragCoord.xy / uCell);
      float ck = mod(q.x + q.y, 2.0) > 0.5 ? 0.18 : 0.06;
      vec3 c = t.rgb;
      if (uChan == 1) c = mix(vec3(uSrgb > 0.5 ? ck : sqrt(ck)), t.rgb, t.a);
      else if (uChan == 2) c = vec3(t.r);
      else if (uChan == 3) c = vec3(t.g);
      else if (uChan == 4) c = vec3(t.b);
      else if (uChan == 5) c = vec3(a);
      gl_FragColor = vec4(c, 1.0);
    }`,
});
// One painter per renderer: a light geometry per (mesh, UV set) that shares the mesh's buffers but exposes
// the chosen set as "uvSel", cached for the painter's lifetime and never disposed (disposing a geometry frees
// the GL buffers of its attributes, which the model itself still uses; the context goes with the viewer).
// paint(list, o) → {canvas, w, h, sets, set} | null. list: [{c: mesh, om: its original material(s), mats:
// Set of the material instances whose groups count, or null = the whole mesh}]. o: {bg: texture | null,
// set: the UV set wanted, chan: "rgb" | "rgba" | "r" | "g" | "b" | "a", color, fillA, wireA, gltf: the model is
// a glTF (v = 0 at the top when there is no texture to say), max: the long side when there is no texture}.
export function createUvPainter(THREE, renderer){
  const uvGeo = new Map();
  function uvGeometry(c, set){
    const key = c.uuid + ":" + set;
    let g = uvGeo.get(key);
    if (!g){
      const src = c.geometry;
      g = new THREE.BufferGeometry();
      if (src.index) g.setIndex(src.index);
      g.setAttribute("position", src.attributes.position);
      g.setAttribute("uvSel", src.attributes[UV_NAMES[set]]);
      for (const gr of src.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
      uvGeo.set(key, g);
    }
    return g;
  }
  const camQ = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  camQ.position.z = 1;
  const pick = (om, mats, layer, hiddenMat) => Array.isArray(om) ? om.map((m) => (!mats || mats.has(m) ? layer : hiddenMat)) : layer;
  function paint(list, o = {}){
    list = list.filter((t) => t.c.geometry && t.c.geometry.attributes.uv);
    if (!list.length) return null;
    const sets = Math.max(...list.map((t) => uvSetCount(t.c.geometry)));
    const set = Math.min(o.set || 0, sets - 1);
    const bg = o.bg || null;
    const iw = bg?.image?.width || 0, ih = bg?.image?.height || 0;
    const big = Math.min(4096, Math.max(o.max || 2048, iw, ih));
    const W = iw && ih ? Math.round(iw >= ih ? big : big * iw / ih) : big;
    const H = iw && ih ? Math.round(ih >= iw ? big : big * ih / iw) : big;
    const target = new THREE.WebGLRenderTarget(W, H);
    const sc = new THREE.Scene();
    sc.background = null;
    const tmp = [];
    const srgb = !bg || bg.colorSpace === THREE.SRGBColorSpace;
    if (bg){
      const q = textureQuad(THREE, bg, W, H);
      q.material.dispose();
      q.material = uvBgShader(THREE, bg, o.chan || "rgb", srgb, W);
      q.renderOrder = 0;
      sc.add(q);
      tmp.push(q);
    } else {
      const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ color: 0x2a2a30 }));
      sc.add(q);
      tmp.push(q);
    }
    const vTop = bg ? !bg.flipY : !!o.gltf;
    const color = o.color ?? 0xffffff;
    const fill = uvShader(THREE, color, o.fillA ?? 0.06, false), wire = uvShader(THREE, color, o.wireA ?? 0.55, true);
    for (const m of [fill, wire]) m.uniforms.uFlip.value = vTop ? -1 : 1;
    const hiddenUV = new THREE.MeshBasicMaterial({ visible: false });
    for (const { c, om, mats } of list){
      if (uvSetCount(c.geometry) <= set) continue; // this mesh has no such set
      for (const [layer, order] of [[fill, 1], [wire, 2]]){
        const me = new THREE.Mesh(uvGeometry(c, set), pick(om || c.material, mats || null, layer, hiddenUV));
        me.frustumCulled = false;
        me.renderOrder = order;
        sc.add(me);
      }
    }
    let cv;
    try { cv = readbackCanvas(THREE, renderer, sc, camQ, target, W, H, srgb); }
    finally {
      target.dispose();
      fill.dispose(); wire.dispose(); hiddenUV.dispose();
      for (const q of tmp){ q.geometry.dispose(); q.material.dispose(); }
    }
    return { canvas: cv, w: W, h: H, sets, set };
  }
  return { paint };
}

// ---- Animation (both viewers) ---------------------------------------------------------------------
// A model's animation clips (glTF / FBX; the loaders put them on the root as `animations`) played by one
// AnimationMixer on the model root. A review view keeps the clip and the time it was made at (FORMAT.md
// 3D ctx `anim` {clip, t}), so a drawing on a moving model shows on the pose it was drawn on.
// Explode: the explode rig moves its parts from their positions (it.pos); an animated part's position is
// the animation's at each moment, so every apply puts the rig's parts back at their rest positions, lets
// the mixer pose the model, takes those positions as the rig's bases and explodes from there.

// Clips worth playing: some length and at least one track.
export const modelClips = (obj) => ((obj && obj.animations) || []).filter((c) => c && c.duration > 0 && c.tracks && c.tracks.length);
// (A view's anim matches a live pose by review-core.js animMatch.)
// null when the model has no clip. o: {rig: () => the explode rig or null, explode: () => its amount now,
// onChange()}. The model is put at the first clip's time 0 at once.
export function createAnimator(THREE, obj, o = {}){
  const clips = modelClips(obj);
  if (!clips.length) return null;
  const mixer = new THREE.AnimationMixer(obj);
  let ci = 0, t = 0, playing = false, action = null, restRig = null;
  const rig = () => (o.rig ? o.rig() : null);
  // The rig's rest positions, taken the first time (before the mixer moves anything).
  const rigRest = () => {
    const r = rig();
    if (!r) return null;
    if (!restRig || restRig.rig !== r){
      restRig = { rig: r, pos: new Map() };
      for (const [c, it] of r.list) restRig.pos.set(c, it.pos.clone());
    }
    return restRig;
  };
  const toRest = () => { const rr = rigRest(); if (rr) for (const [c, p] of rr.pos) c.position.copy(p); };
  const apply = () => {
    const r = rig();
    toRest();
    mixer.setTime(t);
    if (r){
      for (const [c, it] of r.list) it.pos.copy(c.position);
      applyExplode(r, o.explode ? o.explode() : 0);
    }
    obj.updateMatrixWorld(true);
  };
  const use = (i) => {
    toRest();
    if (action) action.stop();
    ci = Math.min(clips.length - 1, Math.max(0, i | 0));
    action = mixer.clipAction(clips[ci]);
    action.play();
  };
  // The last pose is just before the clip's end (a looping action at exactly its duration shows time 0);
  // on the 3 dp grid a view stores.
  const tMax = () => Math.max(0, Math.floor((clips[ci].duration - 0.001) * 1000) / 1000);
  const clampT = (x) => { x = Number(x) || 0; return x < 0 ? 0 : Math.min(x, tMax()); };
  use(0);
  apply();
  const api = {
    clips: clips.map((c, i) => ({ name: c.name || `Animation ${i + 1}`, duration: c.duration })),
    get clip(){ return ci; }, get time(){ return t; }, get playing(){ return playing; },
    get duration(){ return tMax(); },
    // The pose now, as a view stores it.
    state: () => ({ clip: ci, t: Math.round(t * 1000) / 1000 }),
    // Puts the model at {clip, t} (stops playing). Returns true when the pose changed.
    set(s){
      if (!s) return false;
      const want = Math.min(clips.length - 1, Math.max(0, s.clip | 0)), was = playing;
      playing = false;
      let moved = false;
      if (want !== ci){ use(want); moved = true; }
      const nt = clampT(s.t);
      if (moved || Math.abs(nt - t) > 1e-9){ t = nt; apply(); moved = true; }
      if ((moved || was) && o.onChange) o.onChange();
      return moved;
    },
    seek(x){ t = clampT(x); apply(); if (o.onChange) o.onChange(); },
    setClip(i){ if ((i | 0) === ci) return; use(i); t = 0; apply(); if (o.onChange) o.onChange(); },
    play(){ if (playing) return; if (t >= tMax() - 1e-4) t = 0; playing = true; if (o.onChange) o.onChange(); },
    pause(){ if (!playing) return; playing = false; if (o.onChange) o.onChange(); },
    toggle(){ if (playing) api.pause(); else api.play(); },
    // Advances a playing clip by dt seconds (looping). true when the model moved.
    tick(dt){
      if (!playing || !(dt > 0)) return false;
      const d = clips[ci].duration;
      t += Math.min(dt, 0.25);
      if (t >= d) t = t % d;
      apply();
      return true;
    },
    // Re-applies the pose (after the explode amount changed).
    refresh: apply,
    dispose(){ playing = false; try { mixer.stopAllAction(); mixer.uncacheRoot(obj); } catch {} },
  };
  return api;
}
