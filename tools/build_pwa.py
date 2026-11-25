"""Builds the Sight Review phone app (a PWA, docs/PLAN-mobile.md stage 3) into one static folder.

    python tools/build_pwa.py                 -> dist/pwa/  (what GitHub Pages serves)
    python tools/build_pwa.py --serve 8800    -> build, then serve it on http://127.0.0.1:8800/
    python tools/build_pwa.py --out _site     -> another folder (the Pages workflow uses _site)

The app is mobile/ plus the scripts it shares with Sight: app/static/review-core.js (drawing
primitives, merge rules) and app/static/review-draw.js (the drawing canvas) and app/static/shotgrid-core.js (the ShotGrid link) and app/static/filter-core.js (the filter builder of the
ShotGrid page) and app/static/keys.js (the one
shortcut rule) and app/static/caption-plate.js (the text plate over a full-screen picture) and app/static/model3d-core.js
(3D turns / framing / explode, shared with the lightbox), copied to core/, and the parts of three.js the 3D
viewer needs (three/). The
service worker gets the version (APP_VERSION + a hash of every file, so any change makes phones
offer "New version — Reload") and the list of files to cache for offline use. Standard library only.
"""

from __future__ import annotations

import argparse
import functools
import hashlib
import http.server
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "mobile"
SHARED = {  # published path -> source
    "core/review-core.js": ROOT / "app" / "static" / "review-core.js",
    "core/review-draw.js": ROOT / "app" / "static" / "review-draw.js",
    "core/trackers-core.js": ROOT / "app" / "static" / "trackers-core.js",
    "core/shotgrid-core.js": ROOT / "app" / "static" / "shotgrid-core.js",
    "core/filter-core.js": ROOT / "app" / "static" / "filter-core.js",
    "core/keys.js": ROOT / "app" / "static" / "keys.js",
    "core/caption-plate.js": ROOT / "app" / "static" / "caption-plate.js",
    "core/model3d-core.js": ROOT / "app" / "static" / "model3d-core.js",
    "icons/favicon.svg": ROOT / "app" / "static" / "favicon.svg",
}
# three.js for the 3D viewer (mobile/js/model3d.js), the same vendored build as Sight: only what its
# formats need (glTF / GLB, FBX, OBJ, STL, PLY, USD; Spark for Gaussian splats). index.html maps "three" / "three/addons/" here (import map).
VENDOR = ROOT / "app" / "static" / "vendor"
THREE_FILES = ["three.module.js", "three.core.js", "jsm/controls/OrbitControls.js", "jsm/loaders/GLTFLoader.js",
               "jsm/loaders/DRACOLoader.js", "jsm/utils/BufferGeometryUtils.js", "jsm/utils/SkeletonUtils.js",
               "jsm/libs/meshopt_decoder.module.js", "jsm/libs/draco/gltf/draco_decoder.js",
               "jsm/libs/draco/gltf/draco_decoder.wasm", "jsm/libs/draco/gltf/draco_wasm_wrapper.js",
               "jsm/loaders/FBXLoader.js", "jsm/curves/NURBSCurve.js", "jsm/curves/NURBSUtils.js", "jsm/libs/fflate.module.js",
               "jsm/loaders/OBJLoader.js", "jsm/loaders/STLLoader.js", "jsm/loaders/PLYLoader.js",
               "jsm/loaders/USDLoader.js", "jsm/loaders/usd/USDAParser.js", "jsm/loaders/usd/USDCParser.js",
               "jsm/loaders/usd/USDComposer.js",
               # Gaussian splats: Spark (index.html maps "@sparkjsdev/spark" here) and the one addon it imports
               "spark.module.js", "jsm/postprocessing/Pass.js"]
SHARED.update({"three/" + f: VENDOR / f for f in THREE_FILES})
TEMPLATED = {"index.html", "sw.js"}  # get %%VERSION%% (and sw.js %%FILES%%)


def app_version() -> str:
    m = re.search(r'^APP_VERSION\s*=\s*"([^"]+)"', (ROOT / "app" / "version.py").read_text(encoding="utf-8"), re.M)
    if not m:
        raise SystemExit("APP_VERSION not found in app/version.py")
    return m.group(1)


def collect() -> dict[str, Path]:
    files: dict[str, Path] = {}
    for p in sorted(SRC.rglob("*")):
        if p.is_file() and not p.name.startswith(".") and "__pycache__" not in p.parts:
            files[p.relative_to(SRC).as_posix()] = p
    files.update(SHARED)
    return files


def build(out: Path) -> str:
    files = collect()
    h = hashlib.sha1()
    for rel in sorted(files):
        h.update(rel.encode() + b"\0" + files[rel].read_bytes() + b"\0")
    version = f"{app_version()}-{h.hexdigest()[:8]}"
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    # The service worker caches every file but itself; "./" is the start page.
    cached = ["./"] + sorted(r for r in files if r != "sw.js")
    for rel, src in files.items():
        dest = out / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        if rel in TEMPLATED:
            text = src.read_text(encoding="utf-8").replace("%%VERSION%%", version)
            if rel == "sw.js":
                text = text.replace("%%FILES%%", json.dumps(cached))
            if re.search(r"%%[A-Z]+%%", text):
                raise SystemExit(f"{rel}: unfilled placeholder")
            dest.write_text(text, encoding="utf-8")
        else:
            shutil.copyfile(src, dest)
    (out / ".nojekyll").write_text("", encoding="utf-8")  # serve files as they are on GitHub Pages
    return version


class _Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".webmanifest": "application/manifest+json", ".js": "text/javascript", ".srev": "application/json",
                      ".wasm": "application/wasm"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(ROOT / "dist" / "pwa"))
    ap.add_argument("--serve", type=int, metavar="PORT", help="serve the build on this port after building")
    ap.add_argument("--host", default="127.0.0.1", help="address to serve on (a service worker needs localhost or https)")
    a = ap.parse_args()
    out = Path(a.out).resolve()
    version = build(out)
    print(f"Sight Review {version} -> {out}")
    if a.serve:
        srv = http.server.ThreadingHTTPServer((a.host, a.serve), functools.partial(_Handler, directory=str(out)))
        print(f"Serving on http://{a.host}:{a.serve}/  (Ctrl+C to stop)")
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    sys.exit(main())
