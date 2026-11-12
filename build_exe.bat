@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Sight - build app folder
rem On CI (GitHub Actions sets CI=true) the "press any key" pauses are skipped.

where uv >nul 2>&1
if not %errorlevel%==0 (
  echo This build script needs uv ^(https://astral.sh/uv^).
  echo Install it, then run this file again.
  if not defined CI pause
  exit /b 1
)

set PY=.buildenv\Scripts\python.exe

if not exist "%PY%" (
  echo Sight - build : preparing build environment - once, cached in .buildenv
  uv venv .buildenv --python 3.12 --quiet
  if errorlevel 1 goto :fail
)

echo Sight - build : installing dependencies
uv pip install --python "%PY%" ^
  "starlette>=0.40" ^
  "uvicorn[standard]>=0.32" ^
  "pillow>=10.4" ^
  "watchdog>=5.0" ^
  "imageio-ffmpeg>=0.5" ^
  "psd-tools>=1.10" ^
  "zstandard>=0.22" ^
  "pymupdf>=1.24" ^
  "pyinstaller>=6.10" ^
  "pyinstaller-hooks-contrib>=2024.9" ^
  "usd-core" ^
  --only-binary pymupdf ^
  --quiet
if errorlevel 1 goto :fail

rem A running dist\Sight\Sight.exe locks its files and PyInstaller can't clear the folder.
echo Sight - build : stopping any running Sight from dist
powershell -NoProfile -Command "Get-Process Sight -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '%~dp0dist\Sight\*' } | Stop-Process -Force; Start-Sleep -Seconds 1"

echo Sight - build : compiling Sight (this can take a minute)
rem --exclude-module: tkinter is unused; of the USD runtime, app/usdz_convert.py loads only Ar Gf Kind Pcp Plug
rem Sdf Sdr Tf Trace Ts Usd UsdGeom UsdShade UsdUI Vt Work (UsdShade pulls UsdUI) - the rest are left out (fewer
rem DLLs for the virus scanner on a fresh build's first start). Keep the lists in both build scripts equal.
".buildenv\Scripts\pyinstaller.exe" Sight.py ^
  --name Sight ^
  --onedir ^
  --windowed ^
  --noconfirm ^
  --clean ^
  --add-data "%~dp0app\static;app\static" ^
  --add-data "%~dp0app\splash_screen.ps1;app" ^
  --collect-all pxr ^
  --exclude-module tkinter ^
  --exclude-module pxr.UsdPhysics ^
  --exclude-module pxr.UsdVol ^
  --exclude-module pxr.UsdLod ^
  --exclude-module pxr.UsdValidation ^
  --exclude-module pxr.UsdRi ^
  --exclude-module pxr.UsdHydra ^
  --exclude-module pxr.UsdProc ^
  --exclude-module pxr.UsdRender ^
  --exclude-module pxr.UsdSemantics ^
  --exclude-module pxr.UsdMedia ^
  --exclude-module pxr.UsdProfiles ^
  --exclude-module pxr.UsdSkel ^
  --exclude-module pxr.UsdLux ^
  --distpath dist ^
  --workpath .buildenv\work ^
  --specpath .buildenv
if errorlevel 1 goto :fail

echo.
echo Sight - build : done. dist\Sight\Sight.exe is ready.
echo Sight - build : copy the whole dist\Sight folder anywhere and double-click Sight.exe in it
echo Sight - build : - no Python install needed, ffmpeg is bundled in, no console window opens,
echo Sight - build : and closing the Sight browser tab stops the app.
if not defined CI pause
exit /b 0

:fail
echo.
echo Sight - build failed. See the messages above.
if not defined CI pause
exit /b 1
