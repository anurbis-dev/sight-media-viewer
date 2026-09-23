@echo off
rem Developer launch: same as Sight.bat, plus "Save as app defaults" (Settings panel and the
rem command palette), which rewrites app\static\defaults.json — the file that ships with the app.
rem Not part of the packaged build, and a packaged Sight.exe ignores SIGHT_DEV anyway.
set SIGHT_DEV=1
call "%~dp0Sight.bat"
