@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set PYTHONUTF8=1
title Sight

where uv >nul 2>&1
if %errorlevel%==0 (
  echo Sight · starting
  uv run --python 3.12 "%~dp0Sight.py"
  if errorlevel 1 (
    echo.
    echo Sight failed to start.
    pause
  )
  goto :eof
)

where py >nul 2>&1
if %errorlevel%==0 (
  py -3 -c "import sys; raise SystemExit(0 if sys.version_info>=(3,10) else 1)" >nul 2>&1
  if %errorlevel%==0 (
    py -3 "%~dp0Sight.py"
    if errorlevel 1 pause
    goto :eof
  )
)

for /f "delims=" %%P in ('where python 2^>nul') do (
  echo %%P | findstr /i "WindowsApps" >nul
  if errorlevel 1 (
    "%%P" -c "import sys; raise SystemExit(0 if sys.version_info>=(3,10) else 1)" >nul 2>&1
    if %errorlevel%==0 (
      "%%P" "%~dp0Sight.py"
      if errorlevel 1 pause
      goto :eof
    )
  )
)

where winget >nul 2>&1
if %errorlevel%==0 (
  echo Sight needs Python. Installing with winget...
  winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
  py -3 "%~dp0Sight.py"
  if errorlevel 1 pause
  goto :eof
)

echo Sight needs Python 3.10+ or uv.
start https://www.python.org/downloads/
pause
