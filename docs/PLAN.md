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
2. **Splash** — still the PowerShell window, but only started when a launch takes over ~1 s
   (`LazySplash`). Check a cold first start still shows it and a normal start never does. A native
   in-process window (ctypes) was not attempted: untestable here, and a bad window procedure crashes
   the whole app.
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
