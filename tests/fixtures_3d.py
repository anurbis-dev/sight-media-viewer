"""Tiny 3D models for the phone app's 3D tests (no dependencies): two boxes side by side, one mesh
each (an explode rig of two parts, a hidden-mesh order of two) — as GLB, as a .gltf with its .bin beside
it, as OBJ, STL and ASCII FBX. The USD fixtures are tests/fixtures/parts_v001.usdz and parts.usdc (made with
usd-core: a Z-up stage, metersPerUnit 0.01, one box under a translated Xform — its translate (60, 0, 50)
is stored inline in the binary .usdc) and mats_v001.usdz (a strip with two materials by GeomSubset, one
textured with the red.png inside the package, a textured quad, and a row of four quads — mesh material blue,
subsets green / red / green, one face in no subset)."""
from __future__ import annotations

import json
import struct
from pathlib import Path


def box(cx: float, cy: float, cz: float, s: float) -> tuple[list[float], list[int]]:
    pos, idx = [], []
    for axis in range(3):
        for sign in (-1, 1):
            base = len(pos) // 3
            u, v = [(a) for a in range(3) if a != axis]
            for du, dv in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                p = [0.0, 0.0, 0.0]
                p[axis] = sign * s
                p[u] = du * s
                p[v] = dv * s
                pos += [cx + p[0], cy + p[1], cz + p[2]]
            quad = [0, 1, 2, 0, 2, 3] if sign > 0 else [0, 2, 1, 0, 3, 2]
            idx += [base + q for q in quad]
    return pos, idx


def _two_boxes() -> list[tuple[list[float], list[int]]]:
    return [box(-0.6, 0.0, 0.0, 0.45), box(0.6, 0.0, 0.0, 0.45)]


def make_obj(path: Path) -> Path:
    lines, base = [], 1
    for i, (pos, idx) in enumerate(_two_boxes()):
        lines.append(f"o Box{i + 1}")
        lines += [f"v {pos[k]} {pos[k + 1]} {pos[k + 2]}" for k in range(0, len(pos), 3)]
        lines += [f"f {idx[k] + base} {idx[k + 1] + base} {idx[k + 2] + base}" for k in range(0, len(idx), 3)]
        base += len(pos) // 3
    path.write_text("\n".join(lines) + "\n")
    return path


def make_stl(path: Path) -> Path:
    out = ["solid boxes"]
    for pos, idx in _two_boxes():
        for k in range(0, len(idx), 3):
            out.append("facet normal 0 0 0\nouter loop")
            out += [f"vertex {pos[3 * v]} {pos[3 * v + 1]} {pos[3 * v + 2]}" for v in idx[k:k + 3]]
            out.append("endloop\nendfacet")
    out.append("endsolid boxes")
    path.write_text("\n".join(out) + "\n")
    return path


def make_fbx(path: Path) -> Path:
    """ASCII FBX 7.4: two Model + Geometry pairs, connected to the scene root."""
    objs, conns = [], []
    for i, (pos, idx) in enumerate(_two_boxes()):
        gid, mid = 1000 + i, 2000 + i
        pv = []
        for k in range(0, len(idx), 3):
            pv += [idx[k], idx[k + 1], -idx[k + 2] - 1]  # the last index of a polygon is stored as -(i + 1)
        objs.append(f'''	Geometry: {gid}, "Geometry::Box{i + 1}", "Mesh" {{
		Vertices: *{len(pos)} {{
			a: {",".join(map(str, pos))}
		}}
		PolygonVertexIndex: *{len(pv)} {{
			a: {",".join(map(str, pv))}
		}}
		GeometryVersion: 124
	}}
	Model: {mid}, "Model::Box{i + 1}", "Mesh" {{
		Version: 232
	}}''')
        conns.append(f'''	C: "OO",{gid},{mid}\n\tC: "OO",{mid},0''')
    text = f'''; FBX 7.4.0 project file
FBXHeaderExtension:  {{
	FBXHeaderVersion: 1003
	FBXVersion: 7400
}}
GlobalSettings:  {{
	Version: 1000
	Properties70:  {{
		P: "UpAxis", "int", "Integer", "",1
		P: "UnitScaleFactor", "double", "Number", "",1
	}}
}}
Objects:  {{
{chr(10).join(objs)}
}}
Connections:  {{
{chr(10).join(conns)}
}}
'''
    path.write_text(text)
    return path


def make_gltf_with_bin(path: Path) -> Path:
    """A .gltf pointing at <stem>.bin beside it (the phone must be given both)."""
    glb = make_glb(path.with_suffix(".tmp.glb"))
    raw = glb.read_bytes()
    glb.unlink()
    jlen = struct.unpack_from("<I", raw, 12)[0]
    gltf = json.loads(raw[20:20 + jlen])
    blen = struct.unpack_from("<I", raw, 20 + jlen)[0]
    blob = raw[28 + jlen:28 + jlen + blen]
    binp = path.with_suffix(".bin")
    binp.write_bytes(blob)
    gltf["buffers"] = [{"byteLength": len(blob), "uri": binp.name}]
    path.write_text(json.dumps(gltf))
    return path


def make_glb(path: Path) -> Path:
    meshes, bufs, views, accs, offset = [], [], [], [], 0
    for i, (cx, col) in enumerate(((-0.6, [0.9, 0.3, 0.2, 1]), (0.6, [0.2, 0.5, 0.9, 1]))):
        pos, idx = box(cx, 0.0, 0.0, 0.45)
        pb = struct.pack(f"<{len(pos)}f", *pos)
        ib = struct.pack(f"<{len(idx)}H", *idx)
        ib += b"\0" * ((4 - len(ib) % 4) % 4)
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(pb), "target": 34962})
        views.append({"buffer": 0, "byteOffset": offset + len(pb), "byteLength": len(ib), "target": 34963})
        xs, ys, zs = pos[0::3], pos[1::3], pos[2::3]
        accs.append({"bufferView": 2 * i, "componentType": 5126, "count": len(pos) // 3, "type": "VEC3",
                     "min": [min(xs), min(ys), min(zs)], "max": [max(xs), max(ys), max(zs)]})
        accs.append({"bufferView": 2 * i + 1, "componentType": 5123, "count": len(idx), "type": "SCALAR"})
        meshes.append({"name": f"Box {i + 1}", "primitives": [{"attributes": {"POSITION": 2 * i}, "indices": 2 * i + 1, "material": i}]})
        bufs.append(pb + ib)
        offset += len(pb) + len(ib)
    blob = b"".join(bufs)
    gltf = {"asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": [0, 1]}],
            "nodes": [{"mesh": 0, "name": "Box 1"}, {"mesh": 1, "name": "Box 2"}], "meshes": meshes,
            "materials": [{"doubleSided": True, "pbrMetallicRoughness": {"baseColorFactor": c, "metallicFactor": 0.1, "roughnessFactor": 0.6}}
                          for c in ([0.9, 0.3, 0.2, 1], [0.2, 0.5, 0.9, 1])],
            "accessors": accs, "bufferViews": views, "buffers": [{"byteLength": len(blob)}]}
    js = json.dumps(gltf).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    body = struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(blob), 0x004E4942) + blob
    path.write_bytes(struct.pack("<III", 0x46546C67, 2, 12 + len(body)) + body)
    return path


if __name__ == "__main__":
    import sys
    d = Path(sys.argv[1])
    for f in (make_glb(d / "boxes_v001.glb"), make_obj(d / "boxes.obj"), make_stl(d / "boxes.stl"), make_fbx(d / "boxes.fbx"),
              make_gltf_with_bin(d / "boxes.gltf")):
        print(f)
