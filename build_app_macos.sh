#!/bin/bash
# Sight — build a standalone macOS app (dist/Sight.app), no Python install needed to run it.
# Run this ON a Mac: PyInstaller can't cross-compile, so it won't produce a working build
# from Windows or Linux.
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
  "fastapi>=0.115" \
  "uvicorn[standard]>=0.32" \
  "pillow>=10.4" \
  "watchdog>=5.0" \
  "imageio-ffmpeg>=0.5" \
  "psd-tools>=1.10" \
  "zstandard>=0.22" \
  "pymupdf>=1.24" \
  "pyinstaller>=6.10" \
  "pyinstaller-hooks-contrib>=2024.9" \
  "usd-core"

echo "Sight - build: compiling Sight.app (this can take a minute)"
".buildenv/bin/pyinstaller" Sight.py \
  --name Sight \
  --onedir \
  --windowed \
  --noconfirm \
  --clean \
  --add-data "$DIR/app/static:app/static" \
  --collect-all pxr \
  --distpath dist \
  --workpath .buildenv/work \
  --specpath .buildenv

echo
echo "Sight - build: done. dist/Sight.app is ready - copy it anywhere (e.g. /Applications)"
echo "Sight - build: and double-click it. It isn't signed/notarized by Apple, so Gatekeeper"
echo "Sight - build: will block the first launch - right-click Sight.app, choose Open, then"
echo "Sight - build: confirm once; after that it opens normally."
