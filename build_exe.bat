@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Sight - build app folder

where uv >nul 2>&1
if not %errorlevel%==0 (
  echo This build script needs uv ^(https://astral.sh/uv^).
  echo Install it, then run this file again.
  pause
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
  "fastapi>=0.115" ^
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
  --quiet
if errorlevel 1 goto :fail

rem A running dist\Sight\Sight.exe locks its files and PyInstaller can't clear the folder.
echo Sight - build : stopping any running Sight from dist
powershell -NoProfile -Command "Get-Process Sight -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '%~dp0dist\Sight\*' } | Stop-Process -Force; Start-Sleep -Seconds 1"

echo Sight - build : compiling Sight (this can take a minute)
".buildenv\Scripts\pyinstaller.exe" Sight.py ^
  --name Sight ^
  --onedir ^
  --windowed ^
  --noconfirm ^
  --clean ^
  --add-data "%~dp0app\static;app\static" ^
  --add-data "%~dp0app\splash_screen.ps1;app" ^
  --collect-all pxr ^
  --distpath dist ^
  --workpath .buildenv\work ^
  --specpath .buildenv
if errorlevel 1 goto :fail

echo.
echo Sight - build : done. dist\Sight\Sight.exe is ready.
echo Sight - build : copy the whole dist\Sight folder anywhere and double-click Sight.exe in it
echo Sight - build : - no Python install needed, ffmpeg is bundled in, no console window opens,
echo Sight - build : and closing the Sight browser tab stops the app.
pause
exit /b 0

:fail
echo.
echo Sight - build failed. See the messages above.
pause
exit /b 1
