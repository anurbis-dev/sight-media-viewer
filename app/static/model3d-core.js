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

// A .ply is a Gaussian splat (not a mesh) when its header has per-splat opacity and SH / scale /
// rotation fields. `text`: the file's first bytes as ASCII (the header ends at "end_header").
export function plyHeaderIsSplat(text){
  const header = String(text).split("end_header")[0];
  const hasOpacity = /^property\s+\S+\s+opacity\s*$/m.test(header);
  const hasSplatField = /^property\s+\S+\s+(f_dc_0|scale_0|rot_0)\s*$/m.test(header);
  return hasOpacity && hasSplatField;
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
export function usdAsSight(THREE, group){
  group.scale.set(1, 1, 1);
  group.updateMatrixWorld(true);
  const root = new THREE.Group(), node = new THREE.Group();
  root.add(node);
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
    geo.applyMatrix4(m.matrixWorld);
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
    for (const [k, part] of [...parts].sort((a, b) => rank.get(a[0]) - rank.get(b[0]))){
      if (!part.ids.length) continue;
      const pg = new THREE.BufferGeometry();
      for (const [name, at] of Object.entries(geo.attributes)) pg.setAttribute(name, at);
      pg.setIndex(part.ids);
      const mesh = new THREE.Mesh(pg, part.mat);
      mesh.name = m.name;
      node.add(mesh);
    }
    m.geometry.dispose();
  }
  root.updateMatrixWorld(true);
  return root;
}
