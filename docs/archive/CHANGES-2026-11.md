# Archived changes — 2026-11

Older entries moved out of RECENT.md; newest first. Append-only history.

## 0.15.1 — 2026-11-10 — Windows: no console windows flash while thumbnails are built
- **What:** Adding video or audio files no longer flashes console windows on Windows. Each ffmpeg run for a video thumbnail, an audio thumbnail or a waveform opened its own console for a moment.
- **Where:** `library.py`: module constant `_NO_WINDOW`, passed as `creationflags` in `_thumb_video` and `_decode_peaks`. `server.py`: the same flag on the PowerShell folder picker in `pick_folder` and on the `cmd /c start` fallback in `open_path`.
- **Notes:**
  - The app runs windowless (`pythonw` / PyInstaller `--windowed`), so Windows gives every console child process a new console window. Any new `subprocess` call that runs a console program (ffmpeg, powershell, cmd) must pass `creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)`. The flag is 0 off Windows. `fileinfo.py` already did this, which is why the info panel never flashed.
  - `CREATE_NO_WINDOW` hides only the console. The folder dialog PowerShell opens still shows.
  - Left alone on purpose: `explorer` (a GUI program, no console) and the user-started `winget install` in `offer_ffmpeg_install` (behind `POST /api/install-ffmpeg`).
