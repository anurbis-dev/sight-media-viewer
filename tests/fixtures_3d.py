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


def make_glb(path: Path, anim: bool = False) -> Path:
    """anim: also two UV sets on both boxes (TEXCOORD_0: each side the whole square, TEXCOORD_1: the lower left
    quarter) and a 2 s clip "Lift" that moves Box 2 up by 1 and back (linear, keys at 0 / 1 / 2 s)."""
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
    extra = {}
    if anim:
        for k, uv in enumerate((struct.pack("<48f", *([0, 0, 1, 0, 1, 1, 0, 1] * 6)),
                                struct.pack("<48f", *([0, 0, 0.5, 0, 0.5, 0.5, 0, 0.5] * 6)))):
            for i in range(2):
                views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(uv), "target": 34962})
                accs.append({"bufferView": len(views) - 1, "componentType": 5126, "count": 24, "type": "VEC2"})
                meshes[i]["primitives"][0]["attributes"][f"TEXCOORD_{k}"] = len(accs) - 1
                bufs.append(uv)
                offset += len(uv)
        tb = struct.pack("<3f", 0, 1, 2)
        vb = struct.pack("<9f", 0, 0, 0, 0, 1, 0, 0, 0, 0)
        for b, typ, cnt, mm in ((tb, "SCALAR", 3, ([0], [2])), (vb, "VEC3", 3, None)):
            views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(b)})
            a = {"bufferView": len(views) - 1, "componentType": 5126, "count": cnt, "type": typ}
            if mm:
                a["min"], a["max"] = mm
            accs.append(a)
            bufs.append(b)
            offset += len(b)
        n = len(accs)
        extra["animations"] = [{"name": "Lift", "samplers": [{"input": n - 2, "output": n - 1, "interpolation": "LINEAR"}],
                                "channels": [{"sampler": 0, "target": {"node": 1, "path": "translation"}}]}]
    blob = b"".join(bufs)
    gltf = {"asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": [0, 1]}],
            "nodes": [{"mesh": 0, "name": "Box 1"}, {"mesh": 1, "name": "Box 2"}], "meshes": meshes, **extra,
            "materials": [{"doubleSided": True, "pbrMetallicRoughness": {"baseColorFactor": c, "metallicFactor": 0.1, "roughnessFactor": 0.6}}
                          for c in ([0.9, 0.3, 0.2, 1], [0.2, 0.5, 0.9, 1])],
            "accessors": accs, "bufferViews": views, "buffers": [{"byteLength": len(blob)}]}
    js = json.dumps(gltf).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    body = struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(blob), 0x004E4942) + blob
    path.write_bytes(struct.pack("<III", 0x46546C67, 2, 12 + len(body)) + body)
    return path


def make_splat(path: Path, dy: float = 0.0) -> Path:
    """A Gaussian splat (.splat: 32 bytes per splat — position, scale as float32 ×3 each, RGBA and a rotation
    quaternion as uint8 ×4 each): two balls of 400 splats, red at x = -1 and blue at x = +1 (radius 0.5), in the
    splat's own Y-down frame (both viewers turn it half round X). `dy`: both balls moved by that along the file's
    Y (so a quarter turn about X changes the bounds)."""
    import math

    out = bytearray()
    for cx, rgba in ((-1.0, (230, 40, 40, 255)), (1.0, (40, 80, 230, 255))):
        for i in range(400):
            # a Fibonacci sphere, three shells
            k = i % 133
            r = 0.5 * (1, 0.75, 0.5)[i // 133 % 3]
            y = 1 - 2 * (k + 0.5) / 133
            a = math.pi * (3 - math.sqrt(5)) * k
            rr = math.sqrt(max(0.0, 1 - y * y))
            out += struct.pack("<3f3f4B4B", cx + r * rr * math.cos(a), dy + r * y, r * rr * math.sin(a),
                               0.06, 0.06, 0.06, *rgba, 255, 128, 128, 128)
    path.write_bytes(bytes(out))
    return path


def make_splat_ply(path: Path) -> Path:
    """The same two balls as make_splat, as a 3DGS .ply (what a splat .ply's header has: opacity, f_dc_*,
    scale_*, rot_*; colours as SH degree 0, opacity and scales as stored by 3DGS — logit and log)."""
    import math

    src = make_splat(path.with_suffix(".tmp.splat")).read_bytes()
    path.with_suffix(".tmp.splat").unlink()
    props = ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"]
    n = len(src) // 32
    head = "ply\nformat binary_little_endian 1.0\nelement vertex %d\n" % n + "".join(f"property float {p}\n" for p in props) + "end_header\n"
    out = bytearray(head.encode("ascii"))
    sh0 = 0.28209479177387814
    for i in range(n):
        x, y, z, sx, sy, sz, r, g, b, a, *_ = struct.unpack_from("<3f3f4B4B", src, i * 32)
        out += struct.pack("<14f", x, y, z, (r / 255 - 0.5) / sh0, (g / 255 - 0.5) / sh0, (b / 255 - 0.5) / sh0,
                           8.0, math.log(sx), math.log(sy), math.log(sz), 1.0, 0.0, 0.0, 0.0)
    path.write_bytes(bytes(out))
    return path


def make_splat_spz(path: Path, version: int = 2) -> Path:
    """The same two balls as make_splat, as Niantic's SPZ (gzip of a 16-byte header — magic "NGSP", version,
    count, SH degree, fractional bits, flags, reserved — then every attribute in its own block: 24-bit fixed-point
    positions, alpha, colour (SH degree 0 scaled by 0.15), log scale, rotation). The rotation block differs by
    version: v2 stores x, y, z as bytes (w >= 0 implied), v3 the "smallest three" packed in 32 bits."""
    import gzip
    import math

    src = make_splat(path.with_suffix(".tmp.splat")).read_bytes()
    path.with_suffix(".tmp.splat").unlink()
    n, frac = len(src) // 32, 12
    pos, alpha, col, scale, rot = bytearray(), bytearray(), bytearray(), bytearray(), bytearray()
    sh0 = 0.28209479177387814
    for i in range(n):
        x, y, z, sx, sy, sz, r, g, b, a, *_ = struct.unpack_from("<3f3f4B4B", src, i * 32)
        for v in (x, y, z):
            pos += (round(v * (1 << frac)) & 0xFFFFFF).to_bytes(3, "little")
        alpha.append(a)
        for c in (r, g, b):  # (c/255 - 0.5)/sh0 is the SH dc term; SPZ stores dc * 0.15 + 0.5 as a byte
            col.append(max(0, min(255, round(((c / 255 - 0.5) / sh0 * 0.15 + 0.5) * 255))))
        for s_ in (sx, sy, sz):
            scale.append(max(0, min(255, round((math.log(s_) + 10) * 16))))
        rot += bytes((128, 128, 128)) if version < 3 else (3 << 30).to_bytes(4, "little")  # identity (w largest)
    body = struct.pack("<3I4B", 0x5053474E, version, n, 0, frac, 0, 0) + pos + alpha + col + scale + rot
    path.write_bytes(gzip.compress(body))
    return path


def make_big_splat(path: Path, n: int = 700_000) -> Path:
    """A big .splat (generated, never committed): `n` small splats in two balls, red at x = -1 and blue at x = +1
    (radius 0.5), like make_splat's — over the phone app's LoD budget (SPLAT_LOD_PHONE, 600k)."""
    import math
    import random

    rnd = random.Random(1)
    pack = struct.Struct("<3f3f4B4B").pack
    out = bytearray()
    for i in range(n):
        cx, rgba = (-1.0, (230, 40, 40, 255)) if i < n // 2 else (1.0, (40, 80, 230, 255))
        z, a, r = rnd.uniform(-1, 1), rnd.uniform(0, 2 * math.pi), 0.5 * rnd.random() ** (1 / 3)
        q = math.sqrt(1 - z * z)
        out += pack(cx + r * q * math.cos(a), r * z, r * q * math.sin(a), 0.012, 0.012, 0.012, *rgba, 255, 128, 128, 128)
    path.write_bytes(bytes(out))
    return path


if __name__ == "__main__":
    import sys
    d = Path(sys.argv[1])
    for f in (make_glb(d / "boxes_v001.glb"), make_obj(d / "boxes.obj"), make_stl(d / "boxes.stl"), make_fbx(d / "boxes.fbx"),
              make_gltf_with_bin(d / "boxes.gltf"), make_glb(d / "lift_v001.glb", anim=True)):
        print(f)
