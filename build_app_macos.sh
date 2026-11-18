#!/bin/bash
# Sight — build a standalone macOS app (dist/Sight.app), no Python install needed to run it.
# Run this ON a Mac: PyInstaller can't cross-compile, so it won't produce a working build
# from Windows or Linux. On Linux the same script builds the Linux app (dist/Sight/Sight).
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

if ! command -v uv >/dev/null 2>&1; then
  echo "This build script needs uv (https://astral.sh/uv)."
  echo "Install it, then run this file again."
  exit 1
fi

PY=".buildenv/bin/python"
if [ ! -x "$PY" ]; then
  echo "Sight - build: preparing build environment - once, cached in .buildenv"
  uv venv .buildenv --python 3.12
fi

echo "Sight - build: installing dependencies"
uv pip install --python "$PY" \
  "starlette>=0.40" \
  "uvicorn[standard]>=0.32" \
  "pillow>=10.4" \
  "watchdog>=5.0" \
  "imageio-ffmpeg>=0.5" \
  "psd-tools>=1.10" \
  "zstandard>=0.22" \
  "pymupdf>=1.24" \
  "pyinstaller>=6.10" \
  "pyinstaller-hooks-contrib>=2024.9" \
  "usd-core" \
  --only-binary pymupdf
# --only-binary: never compile PyMuPDF from source (slow, and it fails). Newer PyMuPDF releases ship
# no Intel-Mac wheel, so there uv falls back to the newest version that still has one.

echo "Sight - build: compiling Sight.app (this can take a minute)"
# --exclude-module: tkinter is unused; of the USD runtime, app/usdz_convert.py loads only Ar Gf Kind Pcp Plug
# Sdf Sdr Tf Trace Ts Usd UsdGeom UsdShade UsdUI Vt Work (UsdShade pulls UsdUI) - the rest are left out (fewer
# DLLs for the virus scanner on a fresh build's first start). Keep the lists in both build scripts equal.
".buildenv/bin/pyinstaller" Sight.py \
  --name Sight \
  --onedir \
  --windowed \
  --noconfirm \
  --clean \
  --add-data "$DIR/app/static:app/static" \
  --add-data "$DIR/app/initial_filtering.ini:app" \
  --collect-all pxr \
  --exclude-module tkinter \
  --exclude-module pxr.UsdPhysics \
  --exclude-module pxr.UsdVol \
  --exclude-module pxr.UsdLod \
  --exclude-module pxr.UsdValidation \
  --exclude-module pxr.UsdRi \
  --exclude-module pxr.UsdHydra \
  --exclude-module pxr.UsdProc \
  --exclude-module pxr.UsdRender \
  --exclude-module pxr.UsdSemantics \
  --exclude-module pxr.UsdMedia \
  --exclude-module pxr.UsdProfiles \
  --exclude-module pxr.UsdSkel \
  --exclude-module pxr.UsdLux \
  --distpath dist \
  --workpath .buildenv/work \
  --specpath .buildenv

if [ "$(uname)" = "Darwin" ]; then
  # Sight.app is only the server: its main thread runs uvicorn, never a Cocoa event loop, and the window is
  # the browser's own app. As a regular Dock app it could not answer the Apple Events macOS sends it (a click
  # on its Dock icon to bring a minimized window back), so macOS flagged it "not responding". LSUIElement makes
  # it an agent: no Dock icon, no Cmd+Tab entry, nothing to answer. NSAppSleepDisabled keeps App Nap from
  # slowing the server while its (invisible) app is in the background. Editing Info.plist breaks PyInstaller's
  # ad-hoc signature seal, so the bundle is signed ad hoc again (--deep, as PyInstaller itself signs it).
  PLIST="dist/Sight.app/Contents/Info.plist"
  for kv in "LSUIElement:true" "NSAppSleepDisabled:true"; do
    key="${kv%%:*}"; val="${kv#*:}"
    /usr/libexec/PlistBuddy -c "Set :$key $val" "$PLIST" 2>/dev/null \
      || /usr/libexec/PlistBuddy -c "Add :$key bool $val" "$PLIST"
  done
  codesign --force --deep --sign - dist/Sight.app
fi

echo
if [ "$(uname)" = "Darwin" ]; then
  echo "Sight - build: done. dist/Sight.app is ready - copy it anywhere (e.g. /Applications)"
  echo "Sight - build: and double-click it. It isn't signed/notarized by Apple, so Gatekeeper"
  echo "Sight - build: will block the first launch - right-click Sight.app, choose Open, then"
  echo "Sight - build: confirm once; after that it opens normally."
else
  # Same PyInstaller --onedir build elsewhere (Linux): a plain folder, no .app bundle.
  echo "Sight - build: done. dist/Sight/Sight is ready - copy the whole dist/Sight folder anywhere."
fi
