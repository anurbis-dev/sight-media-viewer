# Plan — next improvements

Work queued for a later session, with the numbers behind each item. Measured on 2026-11-10 on the
owner's machine with a copy of the real library (1,028 assets, 3,600 thumbnails) unless stated
otherwise. Take an item, do it, delete it from here, and add the RECENT entry as usual. Add new
items with their numbers. Order inside a section is the suggested order.

Bigger plans live in their own files: **`docs/PLAN-mobile.md`** (the review app for local files on
the phone next, then the owner's tracker Coreline, ftrack / ShotGrid, clouds last), **`docs/PLAN-coreline.md`**
(Sight's desktop review — lightbox + notes panel — built into Coreline; Sight as its optional external reviewer) and
**`docs/PLAN-viewer.md`** (Sight as the tray quick viewer on Space, later), **`docs/PLAN-multiclip.md`** (one review page / `.srev`
bundle for several clips — a sequence's review). **`docs/PLAN-viewer-input.md`** — one shared pointer / gesture module for
every viewer (lightbox, compare, sequence, board, 3D zoom) — done (stages 1–4, 0.94.2 – 0.96.0); stage 5 (HTML page / phone parity) dropped.

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

## Found by the R0-0 regression tests (not fixed there: R0-0 changes no app code)

Each was seen while pinning today's behaviour (docs/PLAN-coreline.md, R0-0). The tests pin what the code does now;
a fix is its own block, and changes the pinned check in the same block.

1. **No next / previous file in the lightbox without a keyboard** (0.134.1 tests): ← / → / ↑ / ↓ step through the
   grid, but there is no swipe and no button, so on a touch screen the lightbox must be closed and another tile
   opened. CLAUDE.md asks every feature to work on touch too.
2. **A phone-size browser cannot open a tile** (0.134.1 tests): opening waits for the grid's native `dblclick`.
   In Chromium's phone emulation (`isMobile`, the page is zoomable: `initial-scale=1` without `user-scalable=no`) two
   taps are a double-tap zoom and no `dblclick` comes. A touch laptop / tablet (`hasTouch` without `isMobile`) gets it;
   the R0 tests use that. Check on a real phone before fixing (a tap-tap detector on the tile, as the board has?).
3. **`.` on a video's last frame lands on `t = duration`** (0.134.1 tests, `stepFrame` in annotate.js): the clamp
   lets the step go one frame past the last frame's start, so the position read-out shows `f 100` of a 100-frame
   clip (frames 0–99). `Shift+→` lands on the last frame properly (`duration − ½ frame`).
4. **A video's `width` / `height` in the library are its thumbnail's** (`_thumb_video` returns the 360-wide JPEG's
   size: a 320 × 240 clip is stored as 360 × 270), not the clip's. The lightbox geometry does not use them: `attachViewer`
   `onReady` sets the viewer's `vs.nat` from `videoWidth` / `videoHeight`, so drawings are in decoded pixels (R0b must
   keep that; R0-0 block 2's golden-geometry tests pin it). The columns themselves stay wrong and are still read:
   `annotate.js` `carryOver()` (item 5), `nw = g?.nw || a.width` in the export (~:5216) and the asset object built at
   ~:3580. A future "native size from the host" (Coreline) must not read these columns for Sight.
5. **Carrying notes over from an earlier version of a video scales its drawings wrongly** (read from the code, not run;
   found in the 0.134.1 review): `carryOver()` scales by `fx = g.nw / p.asset.width`, the decoded width of this
   version over the earlier version's *thumbnail* width (item 4): a 1920-wide clip gets drawings × 5.3. Images are not
   affected (their columns are the real size). Fix with item 4, and test it with two versions of a clip.
6. **On touch, a tap on the drawing toolbar right after a finger stroke brings no click** (0.135.1 tests, a touch
   laptop in Chromium's emulation): within about half a second of a pencil stroke drawn with a finger, a tap on Undo
   gives `pointerdown` / `pointerup` / `touchend` but no `click`, so nothing is undone. The same tap 0.6 s later works,
   so does one after a finger that held still before lifting, and so does a mouse stroke. The toolbar is not inside the
   surface whose capture listener eats clicks (`suppressClick`), so this looks like Chromium's tap suppression after a
   fling rather than the annotator. Check on a real touch screen; fix only if it shows there. `r0_tools_e2e.cjs` waits
   0.7 s before such a tap.

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
