# Recent changes

Newest first. Keep the **newest 15** entries here; `python tools/archive_changes.py` moves the rest to
`docs/archive/CHANGES-YYYY-MM.md`. Stable facts belong in `ARCHITECTURE.md`, not here.

Entry format (heading must be exactly `## <version> — <YYYY-MM-DD> — <title>` so the script can parse it):

```
## 0.2.1 — 2026-09-24 — Short title
- **What:** user-visible change in one or two lines.
- **Where:** files / functions touched.
- **Notes:** invariants, gotchas, decisions, things deliberately NOT done — what the next agent must know.
```

Add new entries directly below this line.

## 0.26.2 — 2026-11-12 — Phone app: why updates did not arrive (address), HTTP notice
- **What:** the app's Pages address redirects to the account's custom domain (github.io → 301 →
  http://pixis.ink/sight-media-viewer/). A copy installed from the github.io address can never update
  (the service worker's update check cannot follow a redirect to another origin), and over plain
  HTTP there is no service worker at all. The home screen now says when it is opened over HTTP, with
  an *Open over HTTPS* link; the worker is registered with `updateViaCache: "none"`.
- **Where:** `mobile/js/app.js` (`renderHome` notice, `initSW`), docs/ARCHITECTURE.md (Address).
- **Notes:** the right address is **https://pixis.ink/sight-media-viewer/**. Not redirected
  automatically: IndexedDB is per origin, reviews made on another address must be exported (.srev)
  and opened in the new one. Enforcing HTTPS is an owner setting (GitHub Pages "Enforce HTTPS" of the
  user site / Cloudflare "Always Use HTTPS"), not something the repo can do. No review agent for this
  small change.

## 0.26.1 — 2026-11-12 — Phone: scrub / frame steps no longer jump back before landing
- **What:** at the end of a scrub, and on every frame step, the picture jumped back a frame and
  then onto the right one. Now it goes straight to the frame.
- **Where:** `mobile/js/media.js` (`ScrubCache` rewritten: frames by media time, `fill`, `exact`),
  `mobile/js/app.js` (`cachedAt`, `showCached`, `hideWhenShown`, `settle`).
- **Notes:** two causes. (1) The cached picture was hidden on `seeked`, but the player paints the
  new frame a moment later (Safari especially), so the old frame flashed up: now it is hidden after
  rVFC reports a presented frame (250 ms fallback); a new cached picture cancels a pending hide.
  (2) The cache was keyed on a grid of the guessed 25 fps (WebM until played), so at 29.97 fps one
  frame in six was never cached and `near()` showed the frame before; steps now use `exact()` only
  (else the player's current frame stays until the seek lands), drags keep `near()`, and the cache
  is keyed by real media times with a gap-filling second pass.
- **Review (fresh agent):** `exact()` first picked the frame by round(mt / fd), which differs from
  what the player shows at (n + 0.25)·fd when stamps jitter (phone VFR clips) — now it takes the
  last cached frame starting at or before that point, only if none is missing in between; the cache
  bar ran backwards while `fill()` added early frames (progress only goes forward); "ended" could
  start a second `fill()` (once-guard, never seek to the very end); frame 0 was never cached (the
  start is a hole too); in a drawing session a step with no exact frame left the old picture under
  the new frame's drawings (falls back to `near()`, dimmed).

## 0.26.0 — 2026-11-12 — Phone app: full-screen player, Notes Panel, multi-frame notes, themes; multi-frame / multi-view notes in Sight
- **What:** the review is a full-screen player: every control in a header over the picture, the
  transport (marker / frame steps, timecode, timeline) over its foot, a thin *Notes Panel* bar that
  slides the player up off the screen and the notes in (filters + ⌃ back). No play button in the
  transport. Marker jumps / steps / timeline taps show the frame at once and the playhead and
  markers line up (one seek path). The scrub on the picture runs from where the clip is at a fixed
  pace (not the screen's width for the whole clip). Note pictures open full screen with floating
  Back / pencil buttons; swipe up / down = next / previous note, sideways = back. The drawing
  canvas' bars float over the picture; a tap on the tool in hand puts it down; on a video the
  canvas has the timeline: scrub / jump to other frames and draw there, *Done* makes one note with
  every frame drawn on. Notes are numbered by when they were made, videos too (also in Sight).
  Light / Dark / Auto theme for the whole app. The ✎ glyph is replaced by the pencil icon (tip
  bottom-left) on the phone and the HTML page. Home: press and hold a review, drag it onto the bin
  that appears at the bottom to delete it (let go without moving = the menu); the footer's
  "Nothing leaves this device…" is on its own line.
  **One note, several pictures (video frames / 3D views), everywhere:** Sight attaches every loose
  drawing made since the file was opened to the next note, whatever frame / view it is on (before:
  only the ones shown now); the note card shows one preview per frame (extra ones small; a click
  goes to that frame); the PDF / HTML report gets `notes[].more [{frame, size, caption, ctx}]` for
  the other frames / views (PDF: after the note's frame; the page: `frameOf("<id>|<i>")`, drawn
  over by ctx like the note's frame).
- **Where:** `mobile/js/app.js` (review screen, `seekTo` / `snapT` / `pumpSeek` / `settle`,
  `makeTransport`, `bindTimeline`, `bindScrub` / `scrubStep`, `setPanel`, `viewer` / `noteView`,
  `drawVideo` / `frameNow` / `framesDraw`, `editNoteDrawing`, themes), `mobile/index.html` (CSS,
  theme tokens), `mobile/js/model.js` (`notesSorted`, `noteFrameTimes`), `mobile/js/report.js`
  (extra frames), `app/static/review-draw.js` (floating bars, tool off, multi-frame API),
  `app/static/annotate.js` (`notesSorted`, `pendingDrawings`, `notePreview` / `previewBox`,
  `gatherReport` `more`, `frameIndex` / `landAt`), `app/review.py` (pencil icons, `build_pdf` and
  the page's `frameOf` / `noteCard` for `more`), `mobile/js/app.js` `dragToBin`, tests
  (`pwa_unit.cjs` frame times at 23.976…120 fps).
- **Notes:** the lag / misplaced playhead had two causes: steps / jumps set `currentTime` directly
  while a seek was in flight (late, lost taps), and the native range input stopped updating once it
  kept focus (`activeElement` check) and its thumb travels a narrower track than the markers'
  percent. A note may now hold drawings on several frames (each row its own `ctx`; the note's ctx is
  the earliest); Sight / the HTML page already show each drawing on its own frame, but Sight's
  report shows only the note's frame (not changed). The multi-frame canvas is used for new notes
  and *Edit the drawing* on videos; replies stay single-frame. The HTML page gets the floating bars
  and tool-off too (same review-draw.js), in its dark default colours. Tests: `pick()` in
  pwa_e2e.cjs takes a tool only when it is not already in hand (a second tap puts it down).
  **Frame times:** a stored ctx.t is (n + 0.01)·fd rounded to 3 dp, which can fall just *below*
  n·fd at 23.976 / 29.97 / 60 / 120 fps. `frameIndex` (model.js, same in annotate.js) recognises a
  stored time and keeps it on frame n (`frameTime(frameTime(t)) === frameTime(t)`); the player is
  sent a quarter into the frame (`pumpSeek`, annotate.js `landAt`), never to the stored time itself
  (0.100 at 29.97 fps showed frame 2 instead of 3 — also in Sight before).
- **Review (fresh agent):** found stepping stuck at 23.976 / 29.97 / 60 fps (re-snapping a rounded
  stored time fell a frame back) and marker jumps landing a frame early — fixed by `frameIndex`
  above, with a unit test; `settle()` ran from `seeked` while the next seek had already started
  (cached frame hidden early, and in a drawing session the old picture cached under the new time) —
  now only when not seeking, and `frameNow` refuses to grab while seeking; a frame grab finishing
  after the user moved on switched the canvas back (`moved` bumps the grab sequence, the grab must
  match the last time); editing a Sight drawing with `hold` lost it (an edited drawing keeps its
  own ctx); a swipe turning into a pinch left the viewer picture offset; a double tap opened two
  drawing sessions (`drawOpening`); `R.dragging` stuck when the canvas closed during a timeline
  drag (`finish` ends it, `lostpointercapture`); a canvas scrub with no duration jumped to frame 0;
  after a stylus, fingers could not scrub with no tool.
- **Review 2 (fresh agent, multi-frame notes / bin):** `frameIndex` took some raw player times for
  stored ones (now only a time with exactly 3 decimals can be stored); previews (Sight's `pumpPF`,
  the phone's `getFrame` → Grabber) seeked to the raw stored time and showed the frame before (now
  a quarter into the frame); `pendingDrawings` would have pulled old markup from other frames into
  an unrelated note — off-screen drawings now count only since the last note (`S.composeSince`),
  compose mode follows the same rule, and the note row says "(n on other frames)"; same-frame
  checks use `sameFrame` (frame index), not float equality; `gatherReport` left `S.curVk` on the
  last extra view and carried one view's look into the next; the home bin: Android's long-press
  `contextmenu` opened the menu over a lifted review, and a mouse held still before dragging lost
  the pointer (capture is now taken on lift).

## 0.25.0 — 2026-11-12 — Phone app remembers the picked file
- **What:** a review opens with its picture / video straight away: the app keeps a copy of the
  file you picked on the device (automatically, no question) and binds it when the review opens.
  Without a copy the stage shows *Pick the file* as before. ⋯ → *Forget the file on this device*
  drops the copy (and stops keeping it for that review); *Remember the file…* brings it back.
- **Where:** `mobile/js/app.js` (`autoKeep`, `openReview`, `rebind`, `paintKeep`, `dropCopy`,
  menu), `tests/pwa_e2e.cjs` + `tests/test_pwa.py` (reload → picture and video reopen with the file).
- **Notes:** a web app cannot keep a handle to a file picked from Photos / Files on iOS (no File
  System Access API there), so "remember" = a copy in IndexedDB `files`; it counts against the
  browser's storage. Skipped when the copy would take usage past 90 % of the quota (the hint then
  says so, with *Try again*). The copy is written after the review is on screen; a review deleted
  meanwhile drops it. `meta.keepAsked` is gone (old records keep the harmless field); `meta.noKeep`
  replaces it. Re-picking a file (rebind) replaces the copy.
- **Review (fresh agent):** the first version put the whole `rv.meta` back after the copy was
  written, so a review closed and reopened meanwhile (or imported into) lost or regained `kept`
  against what was stored; "Forget" during a running copy was undone; a failed replace left the old
  copy bound silently. Now `store.js keepFile / dropFile` patch the stored entry by key in one
  transaction with the file (no write for a deleted review or one marked noKeep), the open review's
  meta follows, a failed replace drops the old copy and shows the hint, and `openReview` sets `kept`
  from what is really in `files`.

## 0.24.0 — 2026-11-12 — One transform tool everywhere, clean picture for new notes, turn / mirror, phone scrub cache
- **What:** the select / transform tool (`V`) is now in the shared drawing canvas too (HTML page,
  phone); its rotate knob follows the pointer out from the pivot (longer arm = finer turn), same in
  Sight. Ctrl held = temporary eraser; a bin clears the drawings on screen (Sight: Shift+Delete).
  A new note (or reply) is drawn on a clean picture: Sight hides other notes' drawings while you
  draw / type a new one, a clicked note shows only its own; cards show the note's (and each reply's)
  drawings over the clean picture / video frame. Sight's panel got the All / Open / In progress /
  Resolved filter. View turn 90° / mirror: Sight's viewer (Shift+R / Shift+M, per file), the
  phone (stage, viewer, canvas; saved with the review), the canvas (buttons + two-finger turn).
  HTML page: the top picture is the original, every card picture is full width, the zoom viewer
  zooms with right-drag / pen side button / wheel / double-click (the canvas: right-drag too).
  Phone: a scrub cache of small frames so scrubbing follows the finger at once.
- **Where:** `app/static/review-core.js` (xf*), `review-draw.js` (rewritten view + select tool),
  `annotate.js` (viewMode / ctxShown, local() through the turn, previews, filter, clearShown,
  Ctrl eraser), `index.html` (attachViewer turn / unturn, buttons, keys, hints), `app/review.py`
  (template), `mobile/js/app.js`, `mobile/js/media.js` (ScrubCache), `mobile/index.html`; new
  `tests/test_review_page.py` + `tests/page_e2e.cjs` (Sight → page → Sight with a reply picture,
  a reply drawing, a resolve and a new drawn note).
- **Notes:** turning / mirroring is view only — doc units (the media's own pixels) never change;
  exports and screenshots stay unturned. Reports use `ctxShown`, never `visibleNow` (the view mode
  must not drop drawings from a PDF). "Pictures lost in the merge" (user report): the round trip
  loses nothing (new test); what looked lost were reply drawings Sight only listed as an eye + count
  and the page's cover showing everything at once — both now shown where they belong. The phone
  cache is memory only (≤ 1500 frames ≤ 640 px); scrubbing still seeks the real player and the
  cached picture hides when the seek lands. The canvas's undo keeps item arrays: transforms work on
  copies, never mutate an object an undo state holds. Review (fresh agent) found and these were fixed: the page viewer's
  tap-close beat its double-click zoom (the close now waits 280 ms); a middle-drag at fit moved a
  hidden pan; the canvas's recolour lost the selection; on touch the 22 px handle reach made small
  objects unmovable (a press on the body > 8 px from a handle moves it); drawings hidden by the view
  mode stayed selected (Delete / nudge acted unseen — the selection is pruned in paintVisibility); a
  screenshot did not switch to the clean picture at once; the preview-frame pump raced on reopening
  the same video (generation token); ScrubCache showed a far-away frame where the clip was not cached
  yet (only ±2 steps now, and the player takes over once it has caught up); a rebind could start a
  cache on the revoked URL. Design change from it: only drawings made since the file was opened
  (data.created ≥ S.openedAt) start the compose mode, so old loose drawings never hide every note's.

## 0.23.1 — 2026-11-12 — Video frame stepping and note times land on the frame on screen (Sight + phone app)
- **What:** in Sight's video lightbox `,` / `.` stepped from the *nearest* frame boundary, so a step taken after a pause or a scrub late in a frame skipped a frame forward (or stayed put backwards); a note / drawing made while paused late in frame k was stored at the raw time and showed on frame k+1. Now a step goes from the frame on screen and a new note / drawing is stored at that frame's start (+0.01 frame, where stepping lands). Without annotating, stepping used 25 fps on every clip (the rate was only read when annotation mode came on); it is now read when a video opens. Found by the fresh-agent review of the phone app (0.23.0), which already had the fix.
- **Where:** `app/static/annotate.js` (`frameStart`, `stepFrame`, `ctxNow`, `setAsset` → `loadFps`); `mobile/js/app.js` (`frameStart` keeps the raw time while the rate is a guess, like Sight). Docs: ARCHITECTURE (phone app video), PLAN.md (known bug removed).
- **Notes:**
  - The frame on screen at time t is `floor(t · fps)`; stored `t = (frame + 0.01) / fps` to 3 dp. Labels still use `round(t · fps)` — the same frame for every time stored this way, and unchanged for older notes (whose `ctxVisible` window also centres on their raw `t`). Older notes are not moved.
  - While the rate is unknown (Sight: before `/info` answers; app: WebM before it is measured) the raw time is kept: snapping to a guessed rate could move a note by a frame.
  - `compare.js` has its own timeline (`snapT` to exact frame starts, no stored times) — checked, not changed.
  - Checked in Sight (dev server, temp SIGHT_HOME, 24 fps WebM): from 1.03 s `.` → 1.0421 (frame 25), `,` → 1.0004 (frame 24); a note at 2.03 s stored at 2.0 with fps read before annotating. `python -m unittest tests.test_pwa tests.test_merge_parity` passes.

## 0.23.0 — 2026-11-12 — Phone app "Sight Review" (PWA): local review on the device
- **What:** stage 3 of `docs/PLAN-mobile.md`. A web app for phones / tablets, installable from Safari (*Add to Home Screen*) / Chrome, fully offline: pick a picture or a video on the device (nothing is uploaded), review it from scratch — notes, replies with pictures, note states, the file's review state, drawings and text on the picture or any video frame (scrub by dragging sideways on the video as in Sight, frame stepping, timecode + frame number, note markers), edit / delete — and export a **PDF** report, a static **HTML** page (both: frames with drawings burned in, notes, replies, pictures) or a **.srev** that merges in Sight (found by name + size); a `.srev` from Sight opens / merges in the app. Reviews live in IndexedDB; the media file can be kept on the device on request. Published to GitHub Pages by a new workflow. The HTML reviewer page's drawing canvas moved into a shared file the app uses as is, and got a **Text** tool (both the page and the app).
- **Where:** new `mobile/` (`index.html`, `sw.js`, `manifest.webmanifest`, `icons/`, `js/app.js`, `model.js`, `store.js`, `media.js`, `mp4.js`, `report.js`, `pdf.js`); new `app/static/review-draw.js` (`SightReviewDraw.open`, CSS injected, scoped to `.draw`; was `drawSheet` + its CSS in `review._HTML_TEMPLATE`); `app/review.py` (`_inline_js` / `draw_js`, `%%DRAW%%`); `tools/build_pwa.py`; `.github/workflows/phone-app.yml`; tests `tests/test_pwa.py`, `tests/pwa_unit.cjs`, `tests/pwa_e2e.cjs`. Docs: ARCHITECTURE ("Phone app"), MANUAL, README, FORMAT (asset id from the app, `app` value), PLAN-mobile (stage 3 done, open question answered).
- **Notes:**
  - Owner's answers (2026-11-12): images + video only for now; the PDF is pages drawn as pictures (canvas + device fonts → one JPEG per page, own ~80-line writer): any script renders, no font shipped, text not selectable.
  - Identity: `key = sha1(lower(name) + "\n" + size)[:16]`; mtime is left out on purpose (iOS gives the pick time for Photos). The app's package carries `asset.id = key`, `path = name`; Sight matches it by name + size. A review imported from Sight keeps Sight's asset (id / path) for the way back.
  - Rows are written only through `mobile/js/model.js`, in Sight's shapes (reply tombstones, status events + `status_at`, `edited_at`, drawings' `data.note` / `data.reply` / ctx, `setReviewState` = `Library.set_review_status`); every merge goes through review-core `mergeRows` — a merge rule change still needs only Python + review-core (+ parity fixture).
  - Owner's requests during the stage: scrub by a sideways drag on the video (same mapping as Sight's click-drag; a tap still plays / pauses, a vertical swipe still scrolls), and a text tool in the canvas (FORMAT.md `text` rows, no format change; Sight's defaults).
  - review-draw.js obeys review-core's rule: no closing script tag / HTML comment opener in the file (`_inline_js` refuses). Its body class is `rd-open` (the page's zoom viewer keeps `zoomed`).
  - Video: fps from the MP4 / MOV `stts`, else measured while playing (`requestVideoFrameCallback`), else 25 ("≈25 fps" shown). Stepping and ctx (`{t: 3 dp, hold: 0}`) as Sight. Card / report frames come from a hidden second `<video>` and are cached in IndexedDB (`frames`), so notes stay readable without the file.
  - Service worker: precache everything, cache-first; a new version waits until the user taps *Reload* (the first install's `clients.claim()` must not reload — found in testing).
  - GitHub Pages needed a one-time setting by the owner (done 2026-11-12): Settings → Pages → Source: *GitHub Actions*; the app is at https://anurbis-dev.github.io/sight-media-viewer/. Deploys only from `master`; other branches just run the unit tests + build. The workflow is `phone-app.yml` ("Phone app (Sight Review)"; first named `pages.yml`); it is separate from `release.yml` — a desktop release does not deploy the app and the app does not need a release.
  - Tested here (Linux, headless Chromium at iPhone size): `python -m unittest tests.test_pwa` — build, unit (model, fps parser on synthetic `moov`, PDF writer opened by PyMuPDF), and a round trip: the app reviews a PNG and a VP9 WebM (stepping, 24 fps measured, drawn notes, reply drawing, reply picture, resolve, review state) → `.srev` imported by Sight's own `Library.import_annotations` path (name + size match, every row, shot file, status history, rect in native px) → Sight adds a reply + note → the app merges it into a fresh profile, re-pick by name + size binds the file, re-import reports "already up to date". Offline reload and the update banner checked by hand with Playwright. **Not checked** (no device here): a real iPhone / iPad / Android — see PLAN-mobile stage 3 "Left to check".
  - Fresh-agent reviews, one per block: (1) moving the canvas out of the page — nothing serious (CSS of all 35 canvas elements compared old vs new: identical); applied: review-core looked up on open (load order), `box-sizing` inside `.draw`, the page test now checks `%%DRAW%%`. (2) the app — fixed: the IndexedDB connection was cached forever (iOS drops it in the background) and a failed save was not retried (now: reconnect + retry once, the pending snapshot stays until written, retried every 3 s); Back (iOS edge swipe / Android) while drawing closed the review under the canvas and Done crashed (now Back closes the viewer / sheet, or is undone while the canvas is open); two quick opens mixed two reviews (fps of one saved into the other) and late frames / thumbnails landed in another or a deleted review (now an open sequence, `rv` everywhere, `putIfAlive`); a JPEG with EXIF rotation from Sight has unrotated width / height while drawings are in the shown size (the file's probed size now wins); double tap on Send sent twice; an edit during an import into the open review was dropped; stepping rounded (skipped a frame from the second half of one) and notes were stored at the raw time (now `frameStart`: floor + 0.01·fd, as Sight's stepping lands — Sight's own copy of the bug is queued in PLAN.md). Not changed: Photos-picker copies (HEIC → JPEG, re-encoded video) do not match Sight's originals by name + size — documented (use Files). (3) text tool + scrub — fixed: the focused text field scrolled the canvas (`overflow: clip`, scroll reset, `preventScroll`), so later fields / zoom anchors were off; a pinch while typing committed and opened a new field (the finger now navigates); wheel / Fit while typing left the field behind (it now follows `apply`); Cancel dropped the typed text even when the discard was declined; Esc during IME composition; a resize while typing never re-fitted; a second finger during a scrub froze the timecode; a mouse released outside the stage left hover scrubbing; a WebM without duration threw; a tap right after a touch scrub was ignored.
  - Not done (later stages / deliberately): PSD / PDF pages, 3D (stage 4), trackers, clouds; drawing on an attached picture (the web page has it); "mine / others" drawing filters (the app is one person's).

## 0.22.0 — 2026-11-12 — Technical debt from PLAN.md: grid refresh past 800, Starlette, faster start, thumbnails off the GIL
- **What:** every queued item of `docs/PLAN.md` (owner's decision 15 in PLAN-mobile: no debt before the phone app). Fixed: a status / tag / thumbnail change of an asset past #800 in the grid now shows (it never did); on a zoomed-in board, panning no longer keeps every original it passed decoded. Faster: server start (Linux container: process start → `/api/health` 390 → 181 ms median), the startup scan waits for the first grid page, the Windows splash's PowerShell only starts when a launch is slow, the API stays responsive while PSD / PDF thumbnails are made (1,000 PDF + text files, same container, back-to-back runs: `/api/assets` while thumbnails are made median 81–93 → 13–14 ms, p90 146 → 31 ms, max 275 → 52–75 ms; all thumbnails 27–29 → ~14 s), three.js is prefetched when the library has 3D files, smaller build. New: `tools/bench_startup.py`, `tools/bench_grid.py`. Windows launch focus: `AllowSetForegroundWindow` + an `AttachThreadInput` fallback.
- **Where:** `app/web.py` (new: FastAPI-shaped router on Starlette); `app/server.py` (imports, `App()`, `POST /api/assets/by-ids`, `first_page_served` in `/api/assets`); `app/library.py` (`_LIST_COLS` / `_list_item` / `assets_by_ids`, `_first_page` gate in `resume_watchers`, `render_psd_thumb` / `render_pdf_thumb`, `HeavyWorkers` + `_heavy`, `thumb_version` caches 0, `_mark_thumb`, `prioritize` regenerates missing files); `app/static/index.html` (`refreshItems` / `refreshIds` / `refreshStaleVisible` / `staleIds`, `loadedIds`, incremental `computeMasonry`, 3D prefetch at the end of boot); `app/static/canvas.js` (`syncResolution` off-screen downgrade); `Sight.py` (starlette dep, `allow_foreground_handoff`, `_bring_to_front`, `LazySplash`, `freeze_support`); `build_exe.bat` / `build_app_macos.sh` (starlette, `--exclude-module` tkinter + 13 pxr bindings); `tools/benchlib.py`, `tools/bench_startup.py`, `tools/bench_grid.py`. Docs: ARCHITECTURE (web.py, grid refresh, heavy pool, scan gate, `_mark_thumb`, canvas), PLAN.md rewritten (what is left to check on Windows), CLAUDE.md (Starlette).
- **Notes:**
  - `app/web.py` rules (ARCHITECTURE has them): params by name from path → query → default; only `Request` / `int` / `float` / `bool` annotations matter; plain `def` → thread pool, `async def` → event loop (wrap blocking library calls in `asyncio.to_thread`); Response as is, else JSON with inf / nan → null (FastAPI did the same; a stored `inf` from a PATCH or a `.srev` made `/api/state` a 500 in the first cut); HEAD on a GET route → 405 as under FastAPI. An A/B of ~80 requests against the FastAPI build matched except the 422 message text and `Allow: HEAD, GET`. Existing runtime venvs keep working (starlette came with fastapi); a fresh one installs starlette.
  - Grid refresh: only what is on screen (+ inspector + lightbox asset) is re-read by id; everything else is marked stale and re-read when its card shows. Never go back to re-reading "offset 0 … N": the server caps `limit` at 800. `pull()` keeps a row it already has stale instead of trusting the duplicate.
  - Heavy thumbnails: 2 spawned worker processes of our own (`HeavyWorkers`; never fork: SQLite + threads), started on first PSD / PDF, stopped after 60 s idle. A timeout (120 s of work) or a crash kills that worker and skips the file for the session — it is never re-rendered in the server (a file that crashes MuPDF would take Sight down). Only if processes cannot start at all does it render in the thread. Text thumbnails stay in threads (cheap). Measured equal to a ProcessPoolExecutor (300 PDFs: 4.93 vs 4.87 s; threads 10.66 s). In a frozen build the children are the exe itself → `multiprocessing.freeze_support()` first in `if __name__ == "__main__"` — keep Sight.py / library.py free of module-level side effects.
  - The splash is still PowerShell (a native ctypes window could not be tested here, and a bad window procedure would crash Sight). Build: `--collect-all pxr` still ships the excluded packages' `__init__.py` (harmless, never imported); `pxr.UsdUI` must stay (UsdShade loads it — excluding it printed a USD warning on every conversion). Linux dist 617 → 581 MB, 30 → 17 USD binding modules.
  - Board originals: also back to the thumbnail when more than a screen away (Playwright, 30 × 12 MP at 4×: 11 originals kept while panning before, ≤ 5 after).
  - Benches: an isolated copy of a SIGHT_HOME (or a synthetic library), a headless Edge / Chrome / Chromium over a stdlib WebSocket CDP client; `bench_grid` also checks the grid never re-anchors `scrollTop` on its own (0 of 600 frames here). Window placement / focus / splash are not measured (no app window) — PLAN.md lists what to check by hand on Windows.
  - Not verified here (Linux container): anything Windows-only — focus, splash, `build_exe.bat`, the frozen exe's worker processes, Defender first-start time. PLAN.md "Left to check on Windows".
  - Fresh-agent reviews, one per block, findings fixed: (1) grid refresh — a Ctrl+A selection of > 5000 was cut by the server but marked fresh (now: on-screen + inspector + lightbox, ≤ 2000 per request, the rest stays stale), duplicates in `pull()` lost their stale mark, the lightbox's asset was not refreshed, `by-ids` ran its query on the event loop; `_bring_to_front` now catches `ctypes.ArgumentError` too. (2) startup — inf / nan → 500 on `/api/state`, `pxr.UsdUI` exclusion warning, HEAD now running GET handlers. (3) thumbnails / grid / canvas / benches — the first cut used a ProcessPoolExecutor: a running job blocked process exit (hung PSD → hidden Sight.exe never exits), a timeout neither cancelled nor killed the job (late writes without DB update, the same file resubmitted until both workers hung), a child that died on a file was re-rendered in the server (crash); replaced by `HeavyWorkers` (tested: hang killed at the timeout, crash → skipped, idle reap, exit with a hung job in flight is immediate, no orphans). A cached 0 could stick (now re-checked after 30 s); has_thumb assets whose file was deleted were never regenerated (pre-existing; now `prioritize` does). Benches: refuse a Python without Sight's deps (the venv re-exec would orphan the server on Windows), stop the server when it never answers.
  - MemPalace is not available in the cloud session; nothing stored there.

## 0.21.0 — 2026-11-11 — HTML reviewer page: vector drawings shown and drawn on the page
- **What:** stage 2 of `docs/PLAN-mobile.md`. The web page for reviewers now gets clean pictures and draws the review's drawings itself (vectors, sharp at any zoom), with *My drawings* / *Others' drawings* switches (pencil next to search). Reviewers can draw: the pencil in a reply / new-note field or *✎ Draw* in the full-screen viewer opens a full-screen canvas — brush with pen pressure, highlighter, arrow, rectangle, ellipse, eraser, five colours, undo / redo, two-finger pinch / pan, "pen draws, finger pans" once a stylus was used, wheel zoom on desktop. A drawing on a note's frame goes with a reply (`data.note` + `data.reply`), a new note can be drawn on the cover (pictures) or on any note's frame (video / 3D; the new note takes that frame's ctx). Drawing on an attachment sends a flattened copy of the picture instead. Sight imports it all through the usual merge; reply drawings get the reply's eye toggle there. Also fixed: exporting a PDF / web page while the video was playing lost every drawing on the video frames (the clip ran on after each seek, so the frame was ~1 frame late and `visibleNow` rejected the drawings) — `gatherReport` now pauses and resumes.
- **Where:** `app/static/annotate.js` (`gatherReport(forPage)`: clean cover / frames + `coverSize`, per-note `size`, reply `id`, `media`; pause during export; `visibleNow` → `frameNow()` + `RC.ctxVisible`). `app/static/review-core.js` (`ctxVisible`, `drawingRow`). `app/server.py` (export/html passes `coverSize`, `media`). `app/review.py` page template: `frameOf` / `vbOf` / `drawingsOf` / `shownOn` / `pic` / `overlay`, `drawSheet` (canvas), `drawFlat`, `editDraw`, `pickFrame`, `drawRows` / `drawCtx`, drafts `draw: {frame, items}`, `E.rows`, viewer entries `{f}` / `{src, note}` with a Draw button (`drawTarget`), `#vwrap` switches. Docs: ARCHITECTURE "HTML reviewer page", FORMAT Context, MANUAL, PLAN-mobile.
- **Notes:**
  - No format change: the page writes ordinary `stroke` (brush / marker) and `shape` (arrow / rect / ellipse) rows. A drawing on a reply copies the note's video `{t, hold}` (so it lives exactly as long as the note's own drawings) or 3D `{vk, cam}`; picture → `ctx: null`. Sizes are screen px at draw time / zoom (brush 6, highlighter 24, shapes 4, eraser radius 14), like Sight's tools.
  - Doc mapping on the page: picture / video frames are the whole media scaled, so the overlay's `viewBox` is `0 0 media.w media.h`; 3D frames use `-500·a -500 1000·a 1000` (a = frame aspect). Checked against Sight: a ring drawn on a GLB cube in Sight sits on the same spot on the page, and a rect drawn on the page sits there in Sight.
  - The eraser only removes objects drawn in the current canvas session; the page never deletes exported rows (no tombstones from the page).
  - Gestures: a second finger during a finger stroke cancels that stroke and becomes a pinch; while a pen draws, fingers are ignored; `pointercancel` finishes a stroke. The canvas is a `.draw` overlay that the document click handler ignores (like `.zoom` / `.pick`). The viewer's Draw button is skipped by the overlay's `pointerdown` (else pointer capture would steal its click).
  - Pages exported before 0.21 keep their own script and burned-in frames. A page with `media` missing (shouldn't happen) falls back to plain frames without drawing.
  - Tested with Playwright on an isolated `SIGHT_HOME`: image / video / GLB exports via the menu, page rendering, every tool, undo / redo / eraser / Ctrl+Z, wheel zoom + drawing while zoomed, synthetic touch (pinch, stroke cancelled by a 2nd finger) and pen (pressure, then finger pans), frame picker, viewer Draw, flat drawing on an attachment, Cancel confirm, remove unsent reply → its rows go, state change + empty-field close, download → import (`added` / `updated` as expected), Sight showing the imported drawings (image, video at f48, 3D view), PDF frames with drawings again. Not checked: a real iPad / Android device.
  - Fresh-agent code review (it also drove the page in headless Chrome) found, all fixed: a `pointercancel` (e.g. an iPad palm rejected by the system) kept its stroke — now dropped; a pen landing while a palm / finger stroke or pan was active was ignored — the pen now wins (palm stroke dropped, pan stopped); × on a draft drawing / picture also closed an otherwise empty field (the click reached the outside-tap handler after the button was gone) — `stopPropagation`; `ctxVisible(c, {vk: undefined})` showed everything — now "no view"; a resize mid-pinch reset the zoom. Not changed: a 3D drawing with `ctx: null` shows on every 3D frame on the page (same as Sight's `visibleNow`), while the PDF's 3D frame filter (`ctx.vk === note vk`) leaves it out.
  - MemPalace was not available in this (cloud) session, so nothing was stored there.

## 0.20.0 — 2026-11-11 — Shared review format (FORMAT.md) and JS core (review-core.js); drawings on replies
- **What:** stage 1 of `docs/PLAN-mobile.md`. The review data contract is written down in `docs/FORMAT.md` (package, rows, every drawing type, ctx, status rows, shots, tombstones, merge rules). Drawing rendering and the merge rules now live in one plain script, `app/static/review-core.js`, used by Sight and inlined into the HTML reviewer page; the mobile app will use it as is. New field `data.reply` on a drawing: in Sight such a drawing gets an eye toggle with its count on the reply, is hidden while the reply is deleted / toggled off, and is deleted (undoably) together with the reply.
- **Where:** new `app/static/review-core.js` (geometry/primitives/bounds/hit tests/transforms/`validItem` moved out of annotate.js unchanged; new `mergeRows` / `mergeReplies` / `mergeHistory` / `contentAt` / `stamp` = JS port of `Library.import_annotations` & co.; `drawCanvas`, `svgMarkup`). `app/static/annotate.js` (imports the core, `replyGone`, `S.hiddenReplies`, `rdrawChip` / `[data-rdraw]`, `deleteReply` takes the reply's drawings, `ghostNow` and reports skip them). `app/review.py` (`core_js()`, `build_html` single-pass `%%TITLE|DATA|CORE%%` substitution, page `download()` uses `RC.mergeRows`). New `docs/FORMAT.md`, `tests/test_merge_parity.py`, `tests/merge_js.cjs`, `tests/fixtures/merge_cases.json` (+ `make_merge_cases.py`). ARCHITECTURE, MANUAL, CLAUDE.md, PLAN-mobile.
- **Notes:**
  - review-core.js is a classic script on purpose (sets `globalThis.SightReviewCore`, `module.exports` under Node): an ES module could not be inlined into the page's classic script nor `require`d by the Node test. annotate.js does `import "/static/review-core.js"` for the side effect and destructures the global. Never write a closing script tag or an HTML comment opener in that file — `core_js()` raises (the page inlines it verbatim).
  - Merge parity: `python -m unittest tests.test_merge_parity` (needs `node`) runs Python `import_annotations` on a temp library and JS `mergeRows` on the same 15 fixtures and compares every row, the stats and that inputs were not mutated. Any merge rule change goes into both + a new fixture case. The JS port keeps ids (lower-cased); Python's re-derivation of non-hex ids / ids of another asset is Sight-only. Python truthiness / `or` / `int()` are emulated (`pyTrue`, `pyOr`, `stamp`, `num`) for the values clients write; NaN, `True` vs `1`, float ids are not.
  - The page's reply file is now `mergeRows(exported rows, local edits)`: replies sorted by `created`, the state by `status_at`, new notes inserted. Exported notes keep their exported `updated_at` (Sight before 0.17 merged notes by it; found in review).
  - Geometry move checked: old (master) vs core functions on 4 000 random items in Node — identical prims / SVG / bounds / hit tests / transforms (the reviewer repeated it on 44 000). Playwright on an isolated `SIGHT_HOME`: core rendering, reply eye toggle, Delete with a hidden selection, reply delete + undo (server rows too), mouse brush, `S` screenshot, PDF + HTML export via the menu, HTML page reply + resolve → download → import back (`updated: 1`), no console errors.
  - Fresh-agent code review found three bugs, all fixed: onion skin still ghosted drawings of hidden / deleted replies; hiding a reply's drawings left them selected so Delete removed them unseen; the page's download bumped exported notes' `updated_at`. It also fuzzed the merge (7 500 random cases, no mismatch on client-written values).
  - Not done (later stages): Sight cannot draw on a reply yet (only show / hide / delete such drawings); the HTML page does not render vectors yet (stage 2 — the core is already inlined there).

## 0.19.3 — 2026-11-11 — HTML page: picture viewer swipes between pictures; no scrolling through it
- **What:** on the reviewer page, dragging on an enlarged picture no longer scrolls the page behind it. A horizontal swipe (← / → on desktop) goes to the next / previous picture, a vertical swipe, a tap or Esc closes; a counter shows *2 / 5*. Galleries: the cover plus every shown note frame; and per note its attachments together with its replies' pictures — never across notes.
- **Where:** `app/review.py` HTML template — `zoom(gal, at)`, `frameGal` (rebuilt in `renderList`, cover at 0), `noteGal` (set in `noteCard`, filled by `thumbs`, reset after each card), `.zoom` CSS (`touch-action: none`, `body.zoomed { overflow: hidden }`).
- **Notes:**
  - The overlay takes pointer events and cancels `touchmove` (non-passive) — that is what stops the page scroll on iOS; `overflow: hidden` on body alone does not.
  - A tap closes on `click`, not on `pointerup`, so the click does not land on the page under the overlay (the document click handler that closes empty fields ignores `.zoom` targets).
  - The frame gallery follows the current filter / search (only shown notes). Pages exported before 0.19.3 keep their old viewer.

## 0.19.2 — 2026-11-11 — Merge the lost 0.15.1–0.15.6 fixes (no console windows; grid blink)
- **What:** Console windows no longer flash on Windows while video/audio thumbnails and waveforms are built, and the library grid no longer blinks / jumps by a row while scrolling or zooming. Both had been fixed in 0.15.1 and 0.15.5, but those commits lived on the side branch `claude/review-and-startup-speed` and never reached master: 0.16.0 (annotations) was branched from 0.15.0, so every build since then shipped without them. This also brings in the rest of that branch: faster startup (0.15.2), maximize/focus on launch (0.15.3), splash closing with the window (0.15.4), `docs/PLAN.md`.
- **Where:** merge of `claude/review-and-startup-speed` (0.15.1–0.15.6 entries below). Conflicts: `server.py` `/api/assets` keeps 0.17's `review` filter and returns 0.15.2's `JSONResponse`; `version.py`; this file.
- **Notes:**
  - Check after a merge that `grep -n "subprocess\." app/*.py` shows `creationflags=NO_WINDOW` (from `fileinfo.py`) on every console program run by the windowless app (ffmpeg, powershell, cmd), and that `.grid` in `index.html` has `overflow-anchor: none`.
  - Before starting a feature branch, branch from the current master, not an older commit: that is how these fixes were lost.

## 0.19.1 — 2026-11-11 — HTML page: empty fields close on an outside tap; new note behind a + button
- **What:** on the reviewer page an empty reply field (no text, picture or *Mark as* state) closes when you tap anywhere else (Esc on desktop). The new-note form is no longer always at the end of the feed: the blue *+* in the bottom bar opens it (one at a time — + again just jumps to it; × discards it; empty + outside tap hides it).
- **Where:** `app/review.py` HTML template — `newOpen` / `opening`, `closeEmpty` on a document `click` listener, `isEmpty`, `focusLater`, `#add` in `.foot`, `.compose h3` close button, composer `data-key`.
- **Notes:**
  - The outside-tap check runs on `click` (bubbling), after the tap's own handler, so a field that very tap opened is skipped via `opening`. It is not done on `pointerdown`: re-rendering there shifts the layout under the finger and the click lands elsewhere.
  - A field with any content stays open on an outside tap — only empty means cancel. Taps on the name dialog or the zoomed picture are ignored.
  - Focus is applied in `requestAnimationFrame` by looking the textarea up by key, because closing another empty field in the same click re-renders the page a second time.

## 0.19.0 — 2026-11-11 — Notes can be *In progress*; reply pictures; HTML page: name gate, pinned filters, chat-style field
- **What:** a note is open, *in progress* (someone took it) or resolved — a clock button in Sight, orange number / timeline marker, logged in the thread like resolve. Replies can carry pictures. The HTML page asks the reviewer's name before anything else; the sender (*From …*), *You: … ✎* and the *All / Open / In progress / Resolved* filters with count badges are pinned with the title; search hides behind an icon. *Reply* opens one full-width field (paper clip = attach, paper plane in the bottom-right corner = send) with *Mark as In progress / Resolved / Reopen* chips — the state goes with the reply or alone. New notes take pictures too; unsent entries have × to take them back.
- **Where:** `app/review.py` (HTML template rewritten: `composer()`, `readImage`, gate `#gate`, `paintSeg`, `statusOf` from the last local event, `E.att`; `build_package` packs reply shots; PDF reply pictures + `EVENT_LABEL` + in-progress tag); `app/library.py` (`import_annotations` remaps `replies[].shots`); `app/static/annotate.js` (`ICON.prog`, `data-prog` toggle, `EVENT` / `eventIcon`, `.prog` styles, `img[data-rshot]` in replies, report / copy text carry reply shots and the state).
- **Notes:**
  - No format change: `progress` is just another `status` value (merged by `status_at` like done/open) and reply `shots` is an optional field. Sight before 0.19 shows an in-progress note as open-looking and ignores reply pictures. `_OPEN_NOTES_SQL` counts in-progress as open (≠ done), as do carry-over and the report's *Open*.
  - Page state model changed: `E = {replies, notes, att}` — no separate `E.status`; a note's state on the page is its last unsent event, else the exported one. On download the last event sets `status` and `status_at` (= that event's time). Pages exported by 0.18 keep their own embedded script, so nothing to migrate.
  - Page pictures are scaled to ≤1600 px JPEG 0.85 in the browser and kept in localStorage (`E.att`) until downloaded; if the quota runs out the page alerts once and asks to download now (edits stay in memory). Enter sends on desktop; on touch screens Enter is a newline.
  - Sight cannot attach pictures to a reply yet (only show them) — the planned mobile review app is the next step.

## 0.18.0 — 2026-11-11 — Review history: resolve / state changes are logged; phone-friendlier HTML page
- **What:** resolving or reopening a note adds an entry to its thread (*✓ Resolved by X · date*), in Sight and on the HTML page; the file's review state keeps a history (who set which state when), shown under the State row in Sight and in the HTML page's details. The HTML page has a pinned title bar — tap it or the arrow for path / chips / state history (collapsed by default) — and a one-line bottom bar (*N changes · Discard · Download reply*).
- **Where:** `app/static/annotate.js` (`statusEvent`, `eventLabel`, event rows in `repliesHtml`, resolve toggle, `copyText`, `gatherReport` passes `event`; `STATE_LABEL`, `histLine`, `.an-rsh` in `paintStatus`, `S.statusHist`); `app/library.py` (`set_review_status` appends history and keeps the row on clear, `merge_history`, status rows union `history` in `import_annotations`); `app/review.py` (HTML template: `.top` header + `#details`, events on Resolve/Reopen with undo-of-unsent, compact footer, state history; PDF `revent` lines).
- **Notes:**
  - A status event is a reply-shaped entry `{id, event: "done"|"open", author, created}` — it merges like a reply (union by id) and needs no format change; Sight before 0.18 shows it as an empty reply. The note's actual state is still `status` / `status_at`; the events are only the log.
  - On the HTML page, toggling back an unsent resolve drops its entry instead of logging a reopen (nothing was sent yet). In Sight every toggle is logged — it is committed immediately.
  - Clearing the review state used to delete the status rows; it now keeps one with `state: null` so the history survives (`_REVIEW_SQL` reads null = no state). Status rows from 0.17.0 have no history — their current state is used as the first entry.
  - History entries set in the same millisecond keep insertion order (stable sort by `at`).
