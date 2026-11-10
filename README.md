# Sight

A local, in-place media library. Point it at folders on disk — images, video, audio, PSD,
fonts, documents (PDF), 3D models, Gaussian splats — and it indexes and previews them without
copying or uploading anything. Runs entirely on `127.0.0.1`.

## Run it

No build needed — these install what's missing (into a private venv under `~/.sight`, not
system-wide) and open the app:

- **Windows**: double-click `Sight.bat`
- **macOS**: double-click `Sight.command`

Requires Python 3.10+ (or [`uv`](https://astral.sh/uv), which the scripts prefer if present).
Opens in its own app-style window (Edge/Chrome/Brave/Vivaldi, whichever is installed) instead
of a browser tab; falls back to a normal tab if none of those are found. The window uses its own
browser profile (`~/.sight/browser`), separate from your everyday one — that is what lets it open
straight at its saved position and size even while that browser is already running.

Useful flags/env vars: `--port N`, `--no-browser`, `SIGHT_PORT`, `SIGHT_HOME` (where the
library index and settings live — defaults to `~/.sight`).

### App defaults (for developers)

`app/static/defaults.json` holds the app's default theme, 3D-viewer settings and tile size. A fresh
install starts from it and "Reset all to defaults" (Settings panel, or Ctrl+K) returns to it; it
ships inside the build. To change it, run **`Sight-dev.bat`** (or `--dev` / `SIGHT_DEV=1`), set the
app up the way you want, and press **Save as app defaults (dev)** in the Settings panel (or the
"Dev: save current settings…" palette action) — then rebuild. Outside dev mode the button doesn't
exist and the server has no route to write the file; a packaged build ignores dev mode entirely.

## Build a standalone app (no Python required to run it)

Packages Sight + all its dependencies (including ffmpeg) into a self-contained app via
[`uv`](https://astral.sh/uv) + PyInstaller. Each platform must be built *on* that platform —
PyInstaller doesn't cross-compile.

- **Windows**: run `build_exe.bat` → `dist\Sight\Sight.exe`. Copy the whole `dist\Sight`
  folder (the .exe needs the files next to it).
- **macOS**: run `build_app_macos.sh` on a Mac → `dist/Sight.app`. It's unsigned, so the
  first launch needs right-click → Open once (Gatekeeper otherwise refuses it).

- **Linux**: `build_app_macos.sh` works there too → `dist/Sight/Sight` (opens its window in an
  installed Chrome / Chromium / Edge / Brave / Vivaldi).

Both scripts cache their build environment in `.buildenv/` (safe to delete any time) and
produce a folder-style app rather than a single file — a single-file build has to
re-extract itself on every launch, which is noticeably slower to start. Closing the app's
window stops it automatically; there's no console/terminal window to close.

### Release builds on GitHub (all platforms at once)

`.github/workflows/release.yml` builds Windows x64, macOS Apple Silicon, macOS Intel and Linux x64
on GitHub's runners with the same two scripts, starts each packaged app headless as a smoke test
(it must answer `/api/state` with the right version), and zips it.

- **Publish a release:** bump `APP_VERSION` in `app/version.py`, commit, then
  `git tag v0.16.1 && git push origin v0.16.1`. The tag has to match `APP_VERSION`, else the run
  fails. The four archives are attached to a new GitHub Release with generated notes.
- **Just build:** Actions tab → *Release builds* → *Run workflow* (artifacts only, kept 14 days).
  A push that changes the workflow or the build scripts runs it too.

## User manual

See [MANUAL.md](MANUAL.md).

## Versions and project notes

The current version (`app/version.py`) is shown in the window title and after the name in the
sidebar header. What changed lately is in [docs/RECENT.md](docs/RECENT.md) (older entries move to
`docs/archive/` via `python tools/archive_changes.py`); how things fit together is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Contributors and AI agents: start with
[CLAUDE.md](CLAUDE.md).
