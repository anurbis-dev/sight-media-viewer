# Plan — next improvements

Work queued for a later session, with the numbers behind each item. Measured on 2026-11-10 on the
owner's machine with a copy of the real library (1,028 assets, 3,600 thumbnails) unless stated
otherwise. Take an item, do it, delete it from here, and add the RECENT entry as usual. Add new
items with their numbers. Order inside a section is the suggested order.

Bigger plans live in their own files: **`docs/PLAN-mobile.md`** (the review app for local files on
the phone next, then the owner's tracker Coreline, ftrack / ShotGrid, clouds last) and
**`docs/PLAN-viewer.md`** (Sight as the tray quick viewer on Space, later).

## Left to check on Windows (done in 0.22.0, not verifiable in the Linux container)

1. **Launch focus** — `allow_foreground_handoff()` + the `AttachThreadInput` fallback in
   `_bring_to_front()`: start Sight from a script / shortcut launcher ~10 times and count how often
   the window comes up focused (it was about half before).
2. **Splash** (0.64.1, `app/splash_win.py`, out-of-process ctypes window) — verify on Windows: it
   shows within ~0.2 s of double-clicking Sight.exe and on a source run (`Sight.bat`), picture crisp and
   rounded with no black box (layered window), centred on the monitor under the cursor, at 100 % and
   150-200 % scaling and on a second monitor with another DPI; no taskbar button, never steals focus,
   clicks pass through; it disappears when the app window shows (not ~3 s later), also on a first run
   that re-execs into the venv (exactly one splash, no flicker/second one), with `--no-browser` (none),
   and when the start fails (gone at once, or after 45 s at the latest). No `pythonw`/`Sight.exe`
   process is left behind (Task Manager). If nothing shows, run
   `pythonw -I -S app\splash_win.py app\splash.png Local\x 10` from a console with `python` instead of
   `pythonw` and remove the `except` in `run()` to see the error.
3. **Build** — `build_exe.bat` with `starlette` and the `--exclude-module` list: the build runs, a
   USDZ still converts, a PDF / PSD thumbnail is made by the worker processes in the frozen exe
   (`freeze_support`), and time the first start after a fresh build (Windows Defender scans every
   new DLL; the build has 14 fewer USD binding DLLs and no pydantic).
4. **Numbers** — run `python tools/bench_startup.py --home <copy of ~/.sight>` and
   `python tools/bench_grid.py --home <copy>` on the owner's machine and put the results here
   (Linux container: health 390 → 181 ms median after the Starlette switch).

## Ideas, not scheduled

- **Note locks** (asked 2026-11-13, after rolling back the 0.45.0 lock in 0.46.1): roles — an artist (not a
  supervisor) may not edit original notes (text, picture texts, drawings), only answer with their own replies; and a
  resolved (done) note is locked for any change. In Sight the drawing side is one gate, `baked(it)` in
  `app/static/annotate.js` (every edit path already asks `editable`); note text / picture text / shots edits and the
  phone app / HTML page need the same check. Needs a source of the role (reviewer name → role? a tracker?) — ask.

- Load grid pages on demand around the scroll position instead of pulling the whole list at start
  (0.22.0 made the pull cheap — incremental id set and masonry — but a 50k library still sends
  ~125 requests). Many features rely on `state.items` holding every asset (select all, counts,
  `assetById`), so this is a bigger change.
