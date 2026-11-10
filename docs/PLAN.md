# Plan — next improvements

Work queued for a later session, with the numbers behind each item. Measured on 2026-11-10 on the
owner's machine with a copy of the real library (1,028 assets, 3,600 thumbnails) unless stated
otherwise. Take an item, do it, delete it from here, and add the RECENT entry as usual. Add new
items with their numbers. Order inside a section is the suggested order.

## Bugs found, not fixed yet

1. **`refreshItems()` refreshes only the first 800 assets.** It asks `/api/assets` for
   `limit=state.items.length`, but the server caps `limit` at 800. In a larger library a status,
   tag or thumbnail change on an asset past #800 never reaches a grid that already loaded it,
   until a full reload. Fix: page through like `pull()` does, or add an id-list endpoint
   (`POST /api/assets/by-ids`) and refresh only the cards in `cardPool` plus the selection.
2. **Window focus on launch depends on Windows' foreground lock.** `reveal_when_ready()` calls
   `SetForegroundWindow`, which Windows refuses unless Sight was started by the foreground
   process (a double-click in Explorer qualifies; a start from a script or a shortcut launcher may
   not). In test launches from a background process it worked in about half the runs. Options:
   `AllowSetForegroundWindow(ASFW_ANY)` at the very start of `main()` (while Sight still holds
   the right), so the browser may take focus itself, or the `AttachThreadInput` dance.
## Startup

Current state (source launch, Sight.py → window on screen): 1.4 s. Sight.exe: not measured after
0.15.2; it reached "listening" in ~0.9 s before. Measure it first next time (see Tooling).

3. **FastAPI → plain Starlette.** fastapi + pydantic imports take ~400 ms, and `build_app` (route
   and pydantic model setup for ~100 routes) another ~100 ms. That is most of what is left of the
   server start. Sight uses no request validation that Starlette's own routing can't do with a few
   helpers. Big but mechanical change in `server.py`. uvicorn itself costs ~290 ms and stays.
4. **Startup scan competes with the first paint.** `resume_watchers()` starts an `os.walk` of
   every source right away (Desktop + Downloads here) while the page loads its first pages.
   Delay the scan start by ~2 s, or until the page's first `/api/assets` is served.
5. **The splash costs a PowerShell start (~0.7 s of CPU) on every launch** although it is now
   shown only when a launch takes longer than ~1.7 s. Replace it with a small window created
   in-process through ctypes, started only after that delay, or drop it.
6. **Frozen build size.** `--collect-all pxr` bundles the whole USD runtime. Windows Defender
   scans every new DLL on the first start of a fresh build, which makes the first launch after
   each build slow. Exclude what is unused (tkinter, test packages) and check the first-start time.

## Library and grid

7. **The client pulls every asset page at start, back to back** (400 per request, 16 ms apart):
   ~125 requests for 50k assets, each one also rebuilding `have = new Set(state.items.map(...))`
   (O(n) per page, O(n²/400) total) and recomputing masonry for the whole list (the masonry
   signature includes the item count). Load pages on demand around the scroll position, or
   at least keep the id set and masonry columns incremental.
8. **Negative thumbnail versions are not cached.** Rows with `has_thumb=1` whose file is gone still
   cost two `stat()` calls per listing. Cache 0 too, with the same invalidation rules as 0.15.2.
9. **Thumbnail workers are threads.** PIL releases the GIL in decode and resize, but PSD, PDF and
    text thumbnails do not; a large import keeps 2–4 threads busy and the server less responsive.
    Measure a 1,000-file import first; a small process pool for the heavy kinds is the likely fix.

## 3D and canvas

10. **First 3D open per session loads three.js on demand:** `import("three")` ~45 ms plus
    GLTFLoader ~60 ms. Prefetch both with `requestIdleCallback` a few seconds after the grid is
    ready.
11. **Canvas full-resolution swap (0.14.0) was never checked in a browser.** Check with many large
    pictures on one board: memory and frame time while zooming in and out.

## Tooling

12. **No automated tests or benchmarks in the repo.** The 2026-11-10 session measured with
    throwaway scripts. They should become `tools/bench_startup.py` (source and exe: process start
    → `/api/health`, → window on screen, maximized/focused, splash shown/closed) and
    `tools/bench_grid.py` (off-screen Edge with `--remote-debugging-port`, wheel-scroll the grid
    through CDP, count blank frames from `Page.startScreencast`, and step `scrollTop` 3 px per frame to check that it never changes on its own, which catches the 0.15.5 scroll-anchoring flip). Each one isolated with its own
    `SIGHT_HOME` copy, never against the live library.
    Gotcha found there: a bench that kills processes by command line must exclude its own pid,
    or it kills itself when the home path is in its own arguments.
