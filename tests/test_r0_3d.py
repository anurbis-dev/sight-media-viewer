"""R0-0 block 4 (docs/PLAN-coreline.md, "R0-0 first — a safety net"): the lightbox's 3D viewer as it behaves before
the R0 refactor (R0c moves it into model3d-core.js). The page script lists its checks:

  tests/r0_3d_e2e.cjs   open a GLB, zoom / pan / orbit / fit, shading, explode, turns and saved cameras per asset,
                        a .usdz with and without the server's conversion, an FBX with its texture beside it
                        (/api/model-res), a Gaussian splat, a note on a 3D view, touch

WebGL runs on SwiftShader here, so the checks read the rendered picture (where the red and blue boxes are) and the
stored settings, not exact pixels.

    python -m unittest tests.test_r0_3d
"""
from __future__ import annotations

import shutil
import unittest

from tests.fixtures_3d import make_glb, make_splat
from tests.r0_harness import ROOT, LiveCase, needs, png

FIX = ROOT / "tests" / "fixtures"


def make_textured_fbx(path, tex: str) -> None:
    """ASCII FBX 7.4: one 2 x 2 quad facing +Z, UVs over the whole texture, a material whose DiffuseColor is the
    texture `tex` (by relative name: the file beside the model; three's FBXLoader takes the name from the Video node)."""
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
	Geometry: 1000, "Geometry::Quad", "Mesh" {{
		Vertices: *12 {{
			a: -1,-1,0,1,-1,0,1,1,0,-1,1,0
		}}
		PolygonVertexIndex: *4 {{
			a: 0,1,2,-4
		}}
		GeometryVersion: 124
		LayerElementUV: 0 {{
			Version: 101
			Name: "UVMap"
			MappingInformationType: "ByPolygonVertex"
			ReferenceInformationType: "IndexToDirect"
			UV: *8 {{
				a: 0,0,1,0,1,1,0,1
			}}
			UVIndex: *4 {{
				a: 0,1,2,3
			}}
		}}
		LayerElementMaterial: 0 {{
			Version: 101
			Name: ""
			MappingInformationType: "AllSame"
			ReferenceInformationType: "IndexToDirect"
			Materials: *1 {{
				a: 0
			}}
		}}
		Layer: 0 {{
			Version: 100
			LayerElement:  {{
				Type: "LayerElementUV"
				TypedIndex: 0
			}}
			LayerElement:  {{
				Type: "LayerElementMaterial"
				TypedIndex: 0
			}}
		}}
	}}
	Model: 2000, "Model::Quad", "Mesh" {{
		Version: 232
	}}
	Material: 3000, "Material::Mat", "" {{
		Version: 102
		ShadingModel: "lambert"
		Properties70:  {{
			P: "DiffuseColor", "Color", "", "A",1,1,1
		}}
	}}
	Texture: 4000, "Texture::Tex", "" {{
		Type: "TextureVideoClip"
		Version: 202
		TextureName: "Texture::Tex"
		FileName: "{tex}"
		RelativeFilename: "{tex}"
	}}
	Video: 5000, "Video::Tex", "Clip" {{
		Type: "Clip"
		Filename: "{tex}"
		RelativeFilename: "{tex}"
	}}
}}
Connections:  {{
	C: "OO",1000,2000
	C: "OO",2000,0
	C: "OO",3000,2000
	C: "OP",4000,3000, "DiffuseColor"
	C: "OO",5000,4000
}}
'''
    path.write_text(text)


def media(folder):
    make_glb(folder / "m_boxes.glb")                 # two boxes side by side: red at x = -0.6, blue at x = +0.6
    make_glb(folder / "m_other.glb")                 # the same, another asset (turns / cameras are per asset)
    make_glb(folder / "m_step.glb", at=((-0.6, 0.0, 0.0), (0.6, 1.0, 0.0)))   # blue raised: a quarter turn shows
    shutil.copy(FIX / "parts_v001.usdz", folder / "m_parts.usdz")
    make_textured_fbx(folder / "m_quad.fbx", "m_green.png")
    (folder / "m_green.png").write_bytes(png(64, 64, (30, 220, 40)))
    make_splat(folder / "m_balls.splat")             # a red ball at x = -1, a blue one at x = +1


@needs(usd=True)
class R0Model3D(LiveCase):
    make_media = staticmethod(media)

    def test_3d(self) -> None:
        self.assertReport(self.run_page("r0_3d_e2e.cjs", timeout=1800), min_checks=40)


if __name__ == "__main__":
    unittest.main()
