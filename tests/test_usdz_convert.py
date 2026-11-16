"""Sight's USDZ → GLB conversion: which stages it leaves to the browser (animated ones).

    python -m unittest tests.test_usdz_convert

Needs usd-core (pxr); skipped without it.
"""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "tests" / "fixtures"

try:
    from pxr import Gf, Sdf, Usd, UsdGeom, UsdUtils
except Exception:  # pragma: no cover - optional dependency
    Usd = None


@unittest.skipIf(Usd is None, "usd-core is not installed")
class TestAnimated(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())

    def run_convert(self, src: Path) -> tuple[bool, list]:
        from app.usdz_convert import convert

        out: list = []
        return convert(src, self.tmp / (src.stem + ".glb"), out), out

    def package(self, layer: Path) -> Path:
        z = layer.with_name(layer.stem + "_" + layer.suffix[1:] + ".usdz")
        UsdUtils.CreateNewUsdzPackage(Sdf.AssetPath(str(layer)), str(z))
        return z

    def test_fixtures(self) -> None:
        # anim_v001.usdz: a time-sampled translate — left to the browser (it plays it); still stages convert.
        self.assertEqual(self.run_convert(FIX / "anim_v001.usdz"), (False, [True]))
        for name in ("parts_v001.usdz", "mats_v001.usdz"):
            self.assertEqual(self.run_convert(FIX / name), (True, []), name)

    def test_what_the_browser_plays(self) -> None:
        def stage(name: str, add_op) -> Path:
            p = self.tmp / name
            st = Usd.Stage.CreateNew(str(p))
            x = UsdGeom.Xform.Define(st, "/X")
            add_op(x)
            m = UsdGeom.Mesh.Define(st, "/X/M")
            m.CreatePointsAttr([(0, 0, 0), (1, 0, 0), (0, 1, 0)])
            m.CreateFaceVertexCountsAttr([3])
            m.CreateFaceVertexIndicesAttr([0, 1, 2])
            st.Save()
            return p

        def rotate_y(x) -> None:  # the loader makes no clip of a rotateY: a still conversion
            op = x.AddRotateYOp()
            op.Set(0.0, 0)
            op.Set(90.0, 10)

        def transform(x) -> None:  # Houdini's suffixed transform op: a clip only from a binary root layer
            op = x.AddTransformOp(opSuffix="transform")
            op.Set(Gf.Matrix4d(1), 0)
            op.Set(Gf.Matrix4d(1).SetTranslate(Gf.Vec3d(1, 0, 0)), 10)

        self.assertEqual(self.run_convert(self.package(stage("roty.usda", rotate_y))), (True, []))
        self.assertEqual(self.run_convert(self.package(stage("xp.usdc", transform))), (False, [True]))
        self.assertEqual(self.run_convert(self.package(stage("xp.usda", transform))), (True, []))


if __name__ == "__main__":
    unittest.main()
