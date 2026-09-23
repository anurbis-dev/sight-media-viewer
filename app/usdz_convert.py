"""Server-side USDZ -> glTF (binary .glb) conversion.

USDZ packages Pixar's binary USD format inside a zip container. three.js ships
no loader for that format, so instead of teaching the client to parse USD we
convert once on the server (using `pxr`, Pixar's own USD Python bindings —
the `usd-core` PyPI package) into a plain GLB, which the existing GLTFLoader
path already knows how to render.

This intentionally throws away everything a viewer doesn't need (skeletons,
animation, shaders beyond base color / normal / emissive / opacity) — the goal is
an accurate static preview, not a full USD renderer.

What it does keep faithful:
  * the stage's up axis (Z-up stages are rotated to glTF's Y-up),
  * per-mesh transforms, instanced (`instanceable`) prims and per-face GeomSubset materials,
  * UVs read from whichever primvar the material's texture reader names (`st`, `st0`,
    `UVMap`, ...), textures embedded once per image (not once per mesh),
  * `displayColor` for meshes with no material (scans, vertex-colored exports).
"""
from __future__ import annotations

import io
import json
import posixpath
import re
import struct
import zipfile
from pathlib import Path

import numpy as np

# Bump when the output changes in a way that makes previously cached .glb files (and the
# thumbnails rendered from them) wrong — Library wipes both on a mismatch.
CONVERTER_VERSION = 2

_GLTF_FLOAT = 5126
_GLTF_UINT = 5125
_GLTF_USHORT = 5123
_ARRAY_BUFFER = 34962
_ELEMENT_ARRAY_BUFFER = 34963
_TRIANGLES = 4
_MAX_TEXTURE = 4096  # longest side; bigger textures are downscaled (GPU memory + load time)

# Y-up correction for Z-up stages, in pxr's row-vector convention (p' = p * M): -90 degrees about X
# takes +Z to +Y.
_Z_UP_TO_Y_UP = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=np.float64)
_UV_FALLBACKS = ("st", "st0", "UVMap", "uv", "UV", "map1", "texCoords", "uvset0")


class _Package:
    """Read access to the files inside a .usdz (textures are referenced by relative path)."""

    def __init__(self, path: Path) -> None:
        self.zip = zipfile.ZipFile(path)
        self.names = {n.lower(): n for n in self.zip.namelist()}

    def close(self) -> None:
        self.zip.close()

    def read(self, asset_path) -> bytes | None:
        """Bytes of the file an SdfAssetPath (e.g. a texture `file` input) points at."""
        candidates = []
        resolved = getattr(asset_path, "resolvedPath", "") or ""
        m = re.match(r"^.*\[(.*)\]$", resolved)
        if m:
            candidates.append(m.group(1))
        raw = getattr(asset_path, "path", "") or str(asset_path)
        candidates.append(raw)
        for cand in candidates:
            name = posixpath.normpath(cand.replace("\\", "/")).lstrip("/")
            hit = self.names.get(name.lower())
            if hit is None:  # some exporters nest differently than the reference says
                tail = "/" + name.lower()
                hit = next((orig for low, orig in self.names.items() if low.endswith(tail)), None)
            if hit is not None:
                try:
                    return self.zip.read(hit)
                except Exception:
                    return None
        return None


def _prepare_image(data: bytes) -> tuple[bytes, str] | None:
    """PNG/JPEG bytes for glTF: passes small PNG/JPEG through untouched, downscales huge ones,
    converts anything else the browser couldn't decode."""
    try:
        from PIL import Image

        with Image.open(io.BytesIO(data)) as im:
            w, h = im.size
            fmt = im.format
            if fmt in ("PNG", "JPEG") and max(w, h) <= _MAX_TEXTURE:
                return data, "image/png" if fmt == "PNG" else "image/jpeg"
            im.load()
            if max(w, h) > _MAX_TEXTURE:
                s = _MAX_TEXTURE / max(w, h)
                im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
            has_alpha = im.mode in ("RGBA", "LA", "PA") or "transparency" in im.info
            buf = io.BytesIO()
            if has_alpha:
                im.convert("RGBA").save(buf, "PNG", compress_level=3)
                return buf.getvalue(), "image/png"
            im.convert("RGB").save(buf, "JPEG", quality=92)
            return buf.getvalue(), "image/jpeg"
    except Exception:
        pass
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return data, "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return data, "image/jpeg"
    return None


# --- material extraction -------------------------------------------------------------------


def _resolve_input(inp):
    """Follows an input through connections. Returns ("const", value), ("tex", shader, output
    name) for a UsdUVTexture, or None when there is nothing usable."""
    from pxr import UsdShade

    if inp is None:
        return None
    try:
        attrs = UsdShade.Utils.GetValueProducingAttributes(inp)
    except Exception:
        attrs = []
    if not attrs:
        try:
            val = inp.Get()
        except Exception:
            val = None
        return ("const", val) if val is not None else None
    attr = attrs[0]
    name = attr.GetName()
    if name.startswith("outputs:"):
        shader = UsdShade.Shader(attr.GetPrim())
        try:
            sid = shader.GetIdAttr().Get()
        except Exception:
            sid = None
        if sid == "UsdUVTexture":
            return ("tex", shader, name.split(":", 1)[1])
        return None
    val = attr.Get()
    return ("const", val) if val is not None else None


def _tuple(val, n: int, fallback):
    try:
        t = tuple(float(x) for x in val)
        return t if len(t) >= n else fallback
    except TypeError:
        return fallback


def _scalar(val, fallback: float) -> float:
    try:
        return float(val)
    except (TypeError, ValueError):
        return fallback


class _Materials:
    """Builds glTF materials from UsdPreviewSurface networks, deduping both the materials
    (one per bound Material prim) and the embedded images (one per source file)."""

    def __init__(self, pkg: _Package) -> None:
        self.pkg = pkg
        self.materials: list[dict] = []
        self.images: list[tuple[bytes, str]] = []
        self._by_key: dict[str, int] = {}
        self._image_by_path: dict[str, int | None] = {}

    def _image(self, asset) -> int | None:
        key = getattr(asset, "path", "") or str(asset)
        if key not in self._image_by_path:
            idx = None
            data = self.pkg.read(asset)
            prepared = _prepare_image(data) if data else None
            if prepared:
                self.images.append(prepared)
                idx = len(self.images) - 1
            self._image_by_path[key] = idx
        return self._image_by_path[key]

    def _texture(self, res) -> int | None:
        _, shader, _out = res
        res_file = _resolve_input(shader.GetInput("file"))
        if not res_file or res_file[0] != "const":
            return None
        return self._image(res_file[1])

    def _uv_name(self, res) -> str | None:
        """Name of the primvar the texture's `st` input reads (through a UsdTransform2d if any)."""
        from pxr import UsdShade

        shader = res[1]
        for _ in range(4):
            attrs = None
            try:
                attrs = UsdShade.Utils.GetValueProducingAttributes(shader.GetInput("st"))
            except Exception:
                pass
            if not attrs:
                return None
            node = UsdShade.Shader(attrs[0].GetPrim())
            var = node.GetInput("varname")
            if var is not None:
                r = _resolve_input(var)
                if r and r[0] == "const" and r[1]:
                    return str(r[1])
            if node.GetInput("in") is not None:  # UsdTransform2d: keep walking towards the reader
                shader = _InputProxy(node)
                continue
            return None
        return None

    def add_default(self, color=None) -> int:
        key = "default" if color is None else "default:%.4f,%.4f,%.4f" % tuple(color)
        if key not in self._by_key:
            self.materials.append({"color": tuple(color) if color else (0.8, 0.8, 0.8), "metallic": 0.0, "roughness": 0.6})
            self._by_key[key] = len(self.materials) - 1
        return self._by_key[key]

    def add(self, mat_prim) -> int:
        """Index of the glTF material for a bound USD Material prim."""
        from pxr import UsdShade

        key = str(mat_prim.GetPath())
        if key in self._by_key:
            return self._by_key[key]
        out: dict = {"color": (0.8, 0.8, 0.8), "metallic": 0.0, "roughness": 0.6}
        try:
            surf = UsdShade.Material(mat_prim).ComputeSurfaceSource()[0]
        except Exception:
            surf = None
        if surf and surf.GetPrim().IsValid():
            self._fill(out, surf)
        self.materials.append(out)
        self._by_key[key] = len(self.materials) - 1
        return self._by_key[key]

    def _fill(self, out: dict, surf) -> None:
        base = _resolve_input(surf.GetInput("diffuseColor"))
        if base and base[0] == "const":
            out["color"] = _tuple(base[1], 3, out["color"])[:3]
        elif base and base[0] == "tex":
            out["base_tex"] = self._texture(base)
            out["uv_name"] = self._uv_name(base)
            if out["base_tex"] is not None:
                out["color"] = (1.0, 1.0, 1.0)
                sc, bs = base[1].GetInput("scale"), base[1].GetInput("bias")
                scale = _tuple(sc.Get(), 3, (1, 1, 1)) if sc else (1, 1, 1)
                bias = _tuple(bs.Get(), 3, (0, 0, 0)) if bs else (0, 0, 0)
                if not any(abs(b) > 1e-6 for b in bias):  # a plain multiplier maps onto baseColorFactor
                    out["color"] = tuple(min(max(c, 0.0), 4.0) for c in scale[:3])
            else:
                out["color"] = (0.8, 0.8, 0.8)

        metallic = _resolve_input(surf.GetInput("metallic"))
        if metallic and metallic[0] == "const":
            out["metallic"] = _scalar(metallic[1], 0.0)
        rough = _resolve_input(surf.GetInput("roughness"))
        if rough and rough[0] == "const":
            out["roughness"] = _scalar(rough[1], 0.6)
        elif rough and rough[0] == "tex":
            out["roughness"] = 0.7  # a roughness *map* isn't a glTF slot on its own — use a matte default

        normal = _resolve_input(surf.GetInput("normal"))
        if normal and normal[0] == "tex":
            sc = normal[1].GetInput("scale")
            bs = normal[1].GetInput("bias")
            scale = _tuple(sc.Get(), 3, (2, 2, 2)) if sc else (2, 2, 2)
            bias = _tuple(bs.Get(), 3, (-1, -1, -1)) if bs else (-1, -1, -1)
            if abs(scale[0] - 2) < 0.01 and abs(bias[0] + 1) < 0.01:  # the standard tangent-space encoding
                out["normal_tex"] = self._texture(normal)
                if out.get("uv_name") is None:
                    out["uv_name"] = self._uv_name(normal)

        emissive = _resolve_input(surf.GetInput("emissiveColor"))
        if emissive and emissive[0] == "const":
            e = _tuple(emissive[1], 3, (0, 0, 0))[:3]
            if any(c > 1e-4 for c in e):
                out["emissive"] = e
        elif emissive and emissive[0] == "tex":
            out["emissive_tex"] = self._texture(emissive)
            if out["emissive_tex"] is not None:
                out["emissive"] = (1.0, 1.0, 1.0)

        opacity = _resolve_input(surf.GetInput("opacity"))
        if opacity and opacity[0] == "const":
            a = _scalar(opacity[1], 1.0)
            if a < 0.999:
                out["alpha"] = max(0.0, a)
                out["alpha_mode"] = "BLEND"
        elif opacity and opacity[0] == "tex":
            cut = _resolve_input(surf.GetInput("opacityThreshold"))
            cutoff = _scalar(cut[1], 0.0) if cut and cut[0] == "const" else 0.0
            out["alpha_mode"] = "MASK"
            out["alpha_cutoff"] = cutoff if cutoff > 0 else 0.5


class _InputProxy:
    """Lets _uv_name() keep walking `st` connections through a chain of shader nodes."""

    def __init__(self, node) -> None:
        self._node = node

    def GetInput(self, name: str):
        return self._node.GetInput("in" if name == "st" else name)


# --- mesh extraction -----------------------------------------------------------------------


def _np(vt, cols: int, dtype=np.float32) -> np.ndarray:
    return np.asarray(vt, dtype=dtype).reshape(-1, cols)


def _per_corner(values: np.ndarray, interp: str, idxs: np.ndarray, corner_face: np.ndarray) -> np.ndarray:
    if interp == "faceVarying":
        return values
    if interp in ("vertex", "varying"):
        return values[idxs]
    if interp == "uniform":
        return values[corner_face]
    return np.broadcast_to(values[:1], (len(idxs), values.shape[1])).copy()  # constant


def _find_uv(prim, preferred: str | None):
    from pxr import UsdGeom

    api = UsdGeom.PrimvarsAPI(prim)
    for name in ([preferred] if preferred else []) + list(_UV_FALLBACKS):
        pv = api.GetPrimvar(name)
        if pv and pv.HasValue():
            return pv
    for pv in api.GetPrimvars():
        if pv.HasValue() and ("float2" in str(pv.GetTypeName()) or "texCoord2" in str(pv.GetTypeName())):
            return pv
    return None


def _mesh_to_arrays(prim, world: np.ndarray, mats: _Materials) -> list[dict] | None:
    """One USD mesh -> {positions, normals?, uvs?, colors?, prims:[(material, indices)]}."""
    from pxr import UsdGeom, UsdShade

    mesh = UsdGeom.Mesh(prim)
    pts_raw = mesh.GetPointsAttr().Get()
    counts_raw = mesh.GetFaceVertexCountsAttr().Get()
    idx_raw = mesh.GetFaceVertexIndicesAttr().Get()
    if not pts_raw or not counts_raw or not idx_raw:
        return None
    pts = _np(pts_raw, 3, np.float64)
    counts = np.asarray(counts_raw, dtype=np.int64)
    idxs = np.asarray(idx_raw, dtype=np.int64)
    nfaces = len(counts)
    corner_face = np.repeat(np.arange(nfaces), counts)

    # --- material(s): mesh-level binding plus per-face GeomSubset overrides
    mat_prim = None
    try:
        bound = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()[0]
        if bound and bound.GetPrim().IsValid():
            mat_prim = bound.GetPrim()
    except Exception:
        pass

    display_color = None
    if mat_prim is None:
        try:
            dc = mesh.GetDisplayColorPrimvar()
            if dc and dc.HasValue():
                display_color = (np.asarray(dc.ComputeFlattened(), dtype=np.float32).reshape(-1, 3), str(dc.GetInterpolation()))
        except Exception:
            display_color = None

    face_mat = np.full(nfaces, -1, dtype=np.int64)
    if mat_prim is not None:
        default_mat = mats.add(mat_prim)
    elif display_color is not None and display_color[1] == "constant" and len(display_color[0]):
        default_mat = mats.add_default(tuple(float(c) for c in display_color[0][0]))
        display_color = None  # already baked into the material
    else:
        default_mat = mats.add_default()
    face_mat[:] = default_mat
    try:
        for sub in UsdGeom.Subset.GetAllGeomSubsets(mesh):
            sub_mat = UsdShade.MaterialBindingAPI(sub.GetPrim()).ComputeBoundMaterial()[0]
            if not sub_mat or not sub_mat.GetPrim().IsValid():
                continue
            sub_idx = np.asarray(sub.GetIndicesAttr().Get(), dtype=np.int64)
            sub_idx = sub_idx[(sub_idx >= 0) & (sub_idx < nfaces)]
            face_mat[sub_idx] = mats.add(sub_mat.GetPrim())
    except Exception:
        pass

    # --- attributes
    normals = None
    n_interp = "vertex"
    try:
        raw = mesh.GetNormalsAttr().Get()
        if raw is not None and len(raw):
            normals = _np(raw, 3)
            n_interp = str(mesh.GetNormalsInterpolation())
    except Exception:
        normals = None

    uv_pv = None
    try:
        first_mat = mats.materials[default_mat] if 0 <= default_mat < len(mats.materials) else {}
        uv_pv = _find_uv(prim, first_mat.get("uv_name"))
    except Exception:
        uv_pv = None
    uvs = uv_interp = None
    if uv_pv is not None:
        try:
            uvs = _np(uv_pv.ComputeFlattened(), 2)
            uv_interp = str(uv_pv.GetInterpolation())
        except Exception:
            uvs = None

    # --- triangulation (fan), vectorised
    ntri = np.maximum(counts - 2, 0)
    total = int(ntri.sum())
    if total == 0:
        return None
    face_of_tri = np.repeat(np.arange(nfaces), ntri)
    k = np.arange(total) - np.repeat(np.cumsum(ntri) - ntri, ntri)
    c0 = (np.cumsum(counts) - counts)[face_of_tri]
    corners = np.stack([c0, c0 + k + 1, c0 + k + 2], axis=1)  # (T, 3) into the per-corner arrays

    # Share vertices by point index when every attribute is per-vertex; otherwise one vertex per
    # face corner (the only way to keep faceVarying UVs / hard normals intact in an indexed mesh).
    vertex_level = {"vertex", "varying"}
    shared = (normals is None or n_interp in vertex_level) and (uvs is None or uv_interp in vertex_level) \
        and (display_color is None or display_color[1] in vertex_level)
    if shared:
        positions = pts
        tri_index = idxs[corners]

        def pick(vals, interp):
            return vals  # already one value per point
    else:
        positions = pts[idxs]
        tri_index = corners

        def pick(vals, interp):
            return _per_corner(vals, interp, idxs, corner_face)

    out_normals = out_uvs = out_colors = None
    if normals is not None:
        out_normals = pick(normals, n_interp)
    if uvs is not None:
        out_uvs = pick(uvs, uv_interp).astype(np.float32, copy=True)
        out_uvs[:, 1] = 1.0 - out_uvs[:, 1]  # USD st is bottom-left origin; glTF is top-left
    if display_color is not None:
        out_colors = pick(display_color[0], display_color[1]).astype(np.float32)

    # --- world transform (+ up axis), winding and normals
    m4 = world
    m3 = m4[:3, :3]
    positions = (positions @ m3 + m4[3, :3]).astype(np.float32)
    if out_normals is not None:
        try:
            nm = np.linalg.inv(m3).T
        except np.linalg.LinAlgError:
            nm = m3
        out_normals = out_normals.astype(np.float64) @ nm
        length = np.linalg.norm(out_normals, axis=1, keepdims=True)
        out_normals = (out_normals / np.where(length > 1e-12, length, 1.0)).astype(np.float32)

    flip = np.linalg.det(m3) < 0
    try:
        if mesh.GetOrientationAttr().Get() == UsdGeom.Tokens.leftHanded:
            flip = not flip
    except Exception:
        pass
    if flip:
        tri_index = tri_index[:, [0, 2, 1]]

    tri_mat = face_mat[face_of_tri]
    prims = []
    for mi in np.unique(tri_mat):
        prims.append((int(mi), np.ascontiguousarray(tri_index[tri_mat == mi]).reshape(-1)))
    return [{"positions": positions, "normals": out_normals, "uvs": out_uvs, "colors": out_colors, "prims": prims}]


def convert(usdz_path: Path, glb_path: Path) -> bool:
    """Convert `usdz_path` to a .glb at `glb_path`. Returns False on failure
    (caller falls back to the "unsupported" placeholder)."""
    try:
        from pxr import Gf, Usd, UsdGeom
    except Exception:
        return False

    try:
        stage = Usd.Stage.Open(str(usdz_path))
    except Exception:
        stage = None
    if stage is None:
        return False

    try:
        pkg = _Package(usdz_path)
    except Exception:
        return False

    try:
        up = UsdGeom.GetStageUpAxis(stage)
    except Exception:
        up = UsdGeom.Tokens.y
    up_fix = _Z_UP_TO_Y_UP if up == UsdGeom.Tokens.z else np.eye(3)

    mats = _Materials(pkg)
    xf_cache = UsdGeom.XformCache()
    parts: list[dict] = []
    try:
        prims = list(Usd.PrimRange(stage.GetPseudoRoot(), Usd.TraverseInstanceProxies()))
    except Exception:
        pkg.close()
        return False

    for prim in prims:
        if not prim.IsA(UsdGeom.Mesh):
            continue
        try:
            imageable = UsdGeom.Imageable(prim)
            if imageable.ComputeVisibility() == UsdGeom.Tokens.invisible:
                continue
            if imageable.ComputePurpose() not in (UsdGeom.Tokens.default_, UsdGeom.Tokens.render):
                continue
        except Exception:
            pass
        try:
            world = np.array(xf_cache.GetLocalToWorldTransform(prim), dtype=np.float64)
        except Exception:
            world = np.eye(4)
        world = world.copy()
        world[:3, :3] = world[:3, :3] @ up_fix
        world[3, :3] = world[3, :3] @ up_fix
        try:
            got = _mesh_to_arrays(prim, world, mats)
        except Exception:
            got = None  # one bad mesh shouldn't sink the whole model
        if got:
            parts.extend(got)

    pkg.close()
    if not parts:
        return False
    return _write_glb(glb_path, parts, mats)


# --- glTF writing --------------------------------------------------------------------------


def _write_glb(glb_path: Path, parts: list[dict], mats: _Materials) -> bool:
    bin_buf = bytearray()
    buffer_views: list[dict] = []
    accessors: list[dict] = []

    def push(data: bytes, target: int | None) -> int:
        while len(bin_buf) % 4:
            bin_buf.append(0)
        view: dict = {"buffer": 0, "byteOffset": len(bin_buf), "byteLength": len(data)}
        if target:
            view["target"] = target
        bin_buf.extend(data)
        buffer_views.append(view)
        return len(buffer_views) - 1

    def add_accessor(arr: np.ndarray, gl_type: str, component: int, target: int, minmax: bool = False) -> int:
        acc: dict = {"bufferView": push(arr.tobytes(), target), "componentType": component, "count": int(len(arr)), "type": gl_type}
        if minmax:
            acc["min"] = arr.min(axis=0).astype(float).tolist()
            acc["max"] = arr.max(axis=0).astype(float).tolist()
        accessors.append(acc)
        return len(accessors) - 1

    primitives = []
    for part in parts:
        attrs = {"POSITION": add_accessor(part["positions"], "VEC3", _GLTF_FLOAT, _ARRAY_BUFFER, True)}
        if part["normals"] is not None:
            attrs["NORMAL"] = add_accessor(part["normals"], "VEC3", _GLTF_FLOAT, _ARRAY_BUFFER)
        if part["uvs"] is not None:
            attrs["TEXCOORD_0"] = add_accessor(part["uvs"], "VEC2", _GLTF_FLOAT, _ARRAY_BUFFER)
        if part["colors"] is not None:
            attrs["COLOR_0"] = add_accessor(part["colors"], "VEC3", _GLTF_FLOAT, _ARRAY_BUFFER)
        small = len(part["positions"]) <= 65535
        for mat_index, indices in part["prims"]:
            idx = indices.astype(np.uint16 if small else np.uint32)
            index_acc = add_accessor(idx, "SCALAR", _GLTF_USHORT if small else _GLTF_UINT, _ELEMENT_ARRAY_BUFFER)
            primitives.append({"attributes": attrs, "indices": index_acc, "mode": _TRIANGLES, "material": mat_index})

    gltf_images = []
    gltf_textures = []
    for data, mime in mats.images:
        gltf_images.append({"bufferView": push(data, None), "mimeType": mime})
        gltf_textures.append({"source": len(gltf_images) - 1})

    def tex_ref(index):
        return {"index": index} if index is not None else None

    gltf_materials = []
    for m in mats.materials:
        pbr: dict = {
            "baseColorFactor": list(m["color"]) + [m.get("alpha", 1.0)],
            "metallicFactor": float(m["metallic"]),
            "roughnessFactor": float(m["roughness"]),
        }
        if m.get("base_tex") is not None:
            pbr["baseColorTexture"] = tex_ref(m["base_tex"])
        mat_def: dict = {"pbrMetallicRoughness": pbr, "doubleSided": True}
        if m.get("normal_tex") is not None:
            mat_def["normalTexture"] = tex_ref(m["normal_tex"])
        if m.get("emissive"):
            mat_def["emissiveFactor"] = list(m["emissive"])
            if m.get("emissive_tex") is not None:
                mat_def["emissiveTexture"] = tex_ref(m["emissive_tex"])
        if m.get("alpha_mode"):
            mat_def["alphaMode"] = m["alpha_mode"]
            if m["alpha_mode"] == "MASK":
                mat_def["alphaCutoff"] = float(m.get("alpha_cutoff", 0.5))
        gltf_materials.append(mat_def)

    while len(bin_buf) % 4:
        bin_buf.append(0)

    gltf: dict = {
        "asset": {"version": "2.0", "generator": "Sight usdz_convert"},
        "buffers": [{"byteLength": len(bin_buf)}],
        "bufferViews": buffer_views,
        "accessors": accessors,
        "materials": gltf_materials,
        "meshes": [{"primitives": primitives}],
        "nodes": [{"mesh": 0}],
        "scenes": [{"nodes": [0]}],
        "scene": 0,
    }
    if gltf_images:
        gltf["images"] = gltf_images
        gltf["textures"] = gltf_textures

    json_bytes = json.dumps(gltf).encode("utf-8")
    while len(json_bytes) % 4:
        json_bytes += b" "

    glb_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = glb_path.with_suffix(".tmp")
    with open(tmp, "wb") as f:
        total_len = 12 + 8 + len(json_bytes) + 8 + len(bin_buf)
        f.write(struct.pack("<III", 0x46546C67, 2, total_len))
        f.write(struct.pack("<II", len(json_bytes), 0x4E4F534A))
        f.write(json_bytes)
        f.write(struct.pack("<II", len(bin_buf), 0x004E4942))
        f.write(bytes(bin_buf))
    tmp.replace(glb_path)  # never leave a half-written file where the cache lookup will find it
    return True
