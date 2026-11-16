"""Writes the animated USD fixtures (needs usd-core):

    python tests/fixtures/make_anim_usd.py

- anim.usda / anim_v001.usdz — a Y-up stage at 24 fps, frames 0…48 (2 s): a static box "Base" at the origin
  (half size 0.5), and an Xform "Arm" whose translate goes (2, 0, 0) → (2, 2, 0), holding a box "Box" with two
  materials (GeomSubsets: faces 0–5 red, 6–11 blue) — split into two meshes in place.
- skel.usda — a SkelRoot with a two-joint skeleton (root, tip at y 1) and a SkelAnimation that turns the tip
  90° about Z over frames 0…24 (1 s); a 1 × 2 × 1 box, its top half bound to the tip.
"""
from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

from pxr import Gf, Sdf, Usd, UsdGeom, UsdShade, UsdSkel, UsdUtils, Vt

HERE = Path(__file__).resolve().parent


def box_mesh(stage, path: str, c=(0.0, 0.0, 0.0), h=(0.5, 0.5, 0.5)):
    m = UsdGeom.Mesh.Define(stage, path)
    pts, counts, idx = [], [], []
    for x in (-1, 1):
        for y in (-1, 1):
            for z in (-1, 1):
                pts.append(Gf.Vec3f(c[0] + x * h[0], c[1] + y * h[1], c[2] + z * h[2]))
    quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    for q in quads:  # two triangles per side: 12 faces
        counts += [3, 3]
        idx += [q[0], q[1], q[2], q[0], q[2], q[3]]
    m.CreatePointsAttr(pts)
    m.CreateFaceVertexCountsAttr(counts)
    m.CreateFaceVertexIndicesAttr(idx)
    return m


def material(stage, path: str, rgb):
    mat = UsdShade.Material.Define(stage, path)
    sh = UsdShade.Shader.Define(stage, path + "/S")
    sh.CreateIdAttr("UsdPreviewSurface")
    sh.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*rgb))
    mat.CreateSurfaceOutput().ConnectToSource(sh.ConnectableAPI(), "surface")
    return mat


def anim_stage(path: Path) -> None:
    st = Usd.Stage.CreateNew(str(path))
    UsdGeom.SetStageUpAxis(st, UsdGeom.Tokens.y)
    st.SetTimeCodesPerSecond(24)
    st.SetStartTimeCode(0)
    st.SetEndTimeCode(48)
    root = UsdGeom.Xform.Define(st, "/Root")
    st.SetDefaultPrim(root.GetPrim())
    red, blue = material(st, "/Root/Looks/Red", (1, 0, 0)), material(st, "/Root/Looks/Blue", (0, 0, 1))
    base = box_mesh(st, "/Root/Base")
    UsdShade.MaterialBindingAPI.Apply(base.GetPrim()).Bind(blue)
    arm = UsdGeom.Xform.Define(st, "/Root/Arm")
    t = arm.AddTranslateOp()
    t.Set(Gf.Vec3d(2, 0, 0), 0)
    t.Set(Gf.Vec3d(2, 2, 0), 48)
    b = box_mesh(st, "/Root/Arm/Box")
    api = UsdShade.MaterialBindingAPI.Apply(b.GetPrim())
    api.Bind(red)
    sub = UsdShade.MaterialBindingAPI(b.GetPrim()).CreateMaterialBindSubset("half", Vt.IntArray(list(range(6, 12))))
    UsdShade.MaterialBindingAPI.Apply(sub.GetPrim()).Bind(blue)
    st.GetRootLayer().Save()


def skel_stage(path: Path) -> None:
    st = Usd.Stage.CreateNew(str(path))
    UsdGeom.SetStageUpAxis(st, UsdGeom.Tokens.y)
    st.SetTimeCodesPerSecond(24)
    st.SetStartTimeCode(0)
    st.SetEndTimeCode(24)
    sr = UsdSkel.Root.Define(st, "/Rig")
    st.SetDefaultPrim(sr.GetPrim())
    sk = UsdSkel.Skeleton.Define(st, "/Rig/Skel")
    joints = ["root", "root/tip"]
    sk.CreateJointsAttr(joints)
    rest = [Gf.Matrix4d(1), Gf.Matrix4d(1).SetTranslate(Gf.Vec3d(0, 1, 0))]
    sk.CreateRestTransformsAttr(rest)
    sk.CreateBindTransformsAttr([Gf.Matrix4d(1), Gf.Matrix4d(1).SetTranslate(Gf.Vec3d(0, 1, 0))])
    an = UsdSkel.Animation.Define(st, "/Rig/Skel/Anim")
    an.CreateJointsAttr(joints)
    an.CreateTranslationsAttr([Gf.Vec3f(0, 0, 0), Gf.Vec3f(0, 1, 0)])
    an.CreateScalesAttr([Gf.Vec3h(1, 1, 1), Gf.Vec3h(1, 1, 1)])
    rot = an.CreateRotationsAttr()
    rot.Set([Gf.Quatf(1, 0, 0, 0), Gf.Quatf(1, 0, 0, 0)], 0)
    q = Gf.Rotation(Gf.Vec3d(0, 0, 1), 90).GetQuat()
    rot.Set([Gf.Quatf(1, 0, 0, 0), Gf.Quatf(q.GetReal(), *[float(x) for x in q.GetImaginary()])], 24)
    UsdSkel.BindingAPI.Apply(sk.GetPrim()).CreateAnimationSourceRel().SetTargets([an.GetPath()])
    m = box_mesh(st, "/Rig/Body", c=(0, 1, 0), h=(0.5, 1, 0.5))
    bind = UsdSkel.BindingAPI.Apply(m.GetPrim())
    bind.CreateSkeletonRel().SetTargets([sk.GetPath()])
    pts = m.GetPointsAttr().Get()
    ji = [1 if p[1] > 1 else 0 for p in pts]
    bind.CreateJointIndicesPrimvar(False, 1).Set(ji)
    bind.CreateJointWeightsPrimvar(False, 1).Set([1.0] * len(pts))
    bind.CreateGeomBindTransformAttr(Gf.Matrix4d(1))
    st.GetRootLayer().Save()


if __name__ == "__main__":
    anim_stage(HERE / "anim.usda")
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d) / "anim_v001.usda"
        shutil.copyfile(HERE / "anim.usda", tmp)
        UsdUtils.CreateNewUsdzPackage(Sdf.AssetPath(str(tmp)), str(HERE / "anim_v001.usdz"))
    skel_stage(HERE / "skel.usda")
