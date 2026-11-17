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

## 0.68.0 — 2026-11-17 — Annotating in the version compare; notes remember the comparison
- **What:** compare (K) has *✎ Annotate* / `A`: the notes panel and drawing tools on the **selected layer**
  (owner's choice) — notes / drawings go to that file at its own frame. A note made there stores the
  comparison (files, order, reference, selected layer, layout, blend, split direction, clip offsets); its card in
  the viewer gets *⧉ Compare · N files* (opens it again on the note's frame, annotating on) and `K` on that file
  opens the newest stored comparison instead of the file's versions.
- **Where:** compare.js — `host.onOpen / onView / onPlaced / onClose / onAnnotButton`, `reportView`, `session()`,
  `pause()`, `seekLayer()`, `ready()`, session look (`C.pBase` / `C.userSet` / `prefsToSave`), ResizeObserver;
  annotate.js — `vidPause` / `vidSeek` (host clock), `host.noteExtra`, note card button (`data-cmp`,
  `host.openCompareSession`), API `reload()`; index.html — `cmpAnnot` (second annotator), `cmpBind` /
  `cmpToggleAnnot`, `openCompareSession`, `latestCompareSession`, `compareFromContext`, compare key routing.
  FORMAT.md — note `compare` (0.68+, Sight only, ignored and kept by other readers). MANUAL, ARCHITECTURE.
- **Notes:** the "session" is stored in the note (owner's choice) — no server table. The compare runs every clip
  on one clock, so the annotator never drives its element there: pause / seek go through the host (`cmp.pause`
  stops on the frame the selected clip shows; `seekLayer` is not snapped to compare's fps, which can differ from
  the clip's). Binding is lazy (a file's notes are fetched once annotating is on). A session opened from a note
  shows its look without overwriting the saved preferences (only what is changed there is saved). Known /
  deliberately left: while annotating the tools own left drag / touch and keys `[ ] R V L Shift+, .` (leave
  annotating to move splits by touch or use those compare keys); the screenshot tool captures the selected layer,
  not the composite; with the playhead before the selected clip's start a new note takes the clip's frame 0;
  the notes panel open / closed setting is shared with the viewer's.
- Review (fresh agent): 12 findings — report export fighting the shared clock, annotating a hidden layer, two fps
  grids, landing before the fps was known, pause moving the frame after the stroke's ctx, session look leaking
  into saved prefs, one-file sessions, heavy lightbox reload, missing host hooks (versions row, review badges),
  no re-place on panel toggle, key / touch conflicts, wasted fetches; fixed or documented as above. Re-review
  rounds: pause landing a frame late / dimming at a clip's first frame, a step past the end dimming the clip, a
  flash after closing during the fps wait, `reload()` keeping undo and racing its own save — fixed; confirmed by
  the same reviewer.

## 0.67.0 — 2026-11-17 — Sequence: every clip's markers, Shift+, / . across clips, up-front conversion (stage 3)
- **What:** the sequence bar shows tick marks for every clip's drawings / notes (taller = a note's);
  `Shift+,` / `Shift+.` continue into the previous / next clips when the current one has no further marker. A
  clip the browser cannot play is found when the sequence opens and converted ahead of its turn.
- **Where:** index.html — `seqLoadMarks`, `seqMarksFromAnnot`, `seqRepaintSoon`, `seqMarker`,
  `seqProbePlayable` / `seqProbe` / `seqConvertAhead`, marks in `paintSeqBar`, `.seq-mk` CSS; annotate.js —
  `renderMarks` → `host.marksChanged`, `jumpMarker` → `host.seqMarker`, API `marks()` / `loading()`.
- **Notes:** the clip on screen reports annotate.js's exact marks; the others are an estimate from their rows
  (drawings' `ctx.t`, a note mark when `data.note` links it; notes' caption frames) fetched once at open. A
  clip left keeps the marks annotate last reported — a re-read raced the debounced save and dropped new marks.
  `seqMarker` stays put while a jump is pending or the clip's rows are loading (else a fast double press skips a
  clip). Conversion: probes load metadata only; `POST /api/video/transcode` goes out only for clips without a
  picture, **one at a time and only for the next two clips** — the server encodes one job at a time, so queuing
  all of them held back the clip the user jumps to and kept ffmpeg busy after closing. Deliberately not done:
  extending the server RAM cache (`SlidingVideoCache`, one file) to prefetch the next clip — the hidden preload
  `<video>` already pulls the next clip's head; worth it only for slow network drives.
- Review (fresh agent): conversions queued for every clip at once, the left clip's re-read racing its save, a
  just-opened clip reporting no marks (Shift+. skipping it), markers past a clip's end, per-clip fetch / repaint
  cost; fixed (landing at t + 1 ms instead of annotate's quarter-frame kept: correct for stored frame starts).
  Re-review: a clip left while its rows were loading kept no marks, a jump into a clip whose conversion failed
  blocked frame / marker keys (pendT never cleared), probes started from clip 0 — fixed; confirmed by the same
  reviewer.

## 0.66.0 — 2026-11-17 — Touch selection by long-press (Sequence stage 2)
- **What:** on a touch screen (finger or stylus) holding a grid tile ~0.5 s starts touch selection mode with
  just that tile; then a tap toggles a tile (appended, so tap order = sequence order), a double tap opens
  nothing, a tap on empty space does nothing (owner's choice: a missed tile must not drop the selection). A
  bottom bar shows "N selected", *▶▶ Play in sequence* (2+ videos) and ✕; ✕ / Esc end the mode.
- **Where:** index.html — `syncTouchSel`, `startLongPress` / `cancelLongPress`, `lastGridPtr` / `fingerish`
  (after `paintSelection`), grid pointerdown / click / dblclick / pointermove / pointercancel, `onPtrUp`,
  card `draggable`, `selectOnly` (drops `state.touchSelect`), `applyViewDom`, `#touchSelBar` + CSS.
- **Notes:** the mode is the explicit flag `state.touchSelect`, set **after** `selectOnly` (which drops it);
  it also drops when the selection becomes empty (`syncTouchSel` from `paintSelection`). `selectSet` paths
  (Ctrl+A, marquee, find in folder) keep it, as specced. A click's input is decided by the same gesture's
  pointerdown (`lastGridPtr`), not the click's own `pointerType` (older Safari clicks are no PointerEvents).
  The long-press sets `skipClick` when it fires, so the release click does not run `clickSelect`. Cards are
  not `draggable` for touch (a held finger would start an HTML5 drag whose dragstart replaces the selection);
  a pen keeps drag-to-board (drag starts only on movement, a still pen gets the long-press). Behaviour
  change outside the mode too: `pointercancel` (a touch scroll) is now an abort in `onPtrUp` — it no longer
  clears the selection as a click on empty space. The bar hides with the grid (full-screen board) and the
  narrow-screen inspector stops above it. `navigator.vibrate` was dropped (no user activation in a timer).
- Review (fresh agent): 8 findings — scroll from empty space wiping the selection (marquee + pointercancel),
  a missed tap ending the mode, click type taken from the click, pen left out, bar over the board, bar
  covering the inspector, vibrate; fixed (the mode surviving `selectSet` kept as specced). The re-review
  caught that the first fix also blocked pen drag-to-board — restored; confirmed by the same reviewer.

## 0.65.0 — 2026-11-17 — Play in sequence (stage 1 of docs/PLAN-viewer.md "clips in sequence")
- **What:** 2+ selected videos play back to back in the lightbox (Space over one of the selected videos,
  top-bar *▶▶ Sequence*, right-click menu, palette), in selection (click) order, cut to cut without a black
  frame. A sequence bar above the clip's timeline: a segment per clip (alternating accent shades, name),
  playhead, tap / drag across all clips, ⏮ / ⏭ / ⟲ buttons. Keys: ← / → clip, Home first clip, Shift+L loop,
  `,` / `.` cross cuts; ↑ / ↓ and arrows with modifiers do nothing (never step out to grid neighbours). Each
  clip keeps its own notes / drawings (shown through the normal `showInLight` → `annot.setAsset`).
- **Where:** index.html — `seqCandidates` … `bindSeqBar` (before `toggleLight`), `.seqbar` markup + CSS,
  `attachViewer` (`opts.adopt`, `ended` listener, `light.vctl`, `seqOnReady`), `showInLight(a, opts)`,
  `fillStage(…, opts)`, `startVideoCache(…, keep)`, `closeLight`, Space / sequence keys, `paintSelection`
  (`#seqBtn`), context menu, palette; annotate.js `stepFrame` → `host.seqEdge`. ARCHITECTURE "Sequence".
- **Notes:** seamless = the next clip is preloaded in a hidden muted `<video class="seq-buf">` and adopted
  (moved into the stage in the same task, src kept). Measured in headless Chromium: the first frame of the
  new clip is on screen at once but held ~70 ms before playback moves on (play() start latency); a muted
  element starts ~30-60 ms sooner, so the adopted clip starts muted and unmutes on its first new frame
  (`_seqWantMuted` keeps the wanted state across quick adopts). Tried and dropped: a play+pause warm-up and
  creeping the buffer at rate 1/16 before the cut — neither shortened the start. `ended` cuts only after real
  playback (`_seqPlayedAt` from `timeupdate` / `playing`), never on a scrub / seek to the end. Not in this
  stage (PLAN-viewer.md): touch multi-select by long-press + bottom bar, markers of all clips on the sequence
  bar and Shift+, / . across clips, server RAM-cache prefetch of the next clip, probing / converting clips up
  front. Known: `#seqBtn` is only refreshed with the selection (may stay shown after a filter change —
  clicking then just flashes); segment widths settle as clip durations load (assets often have none stored).
  The title shows "Clip i/n · name" (the planned frame number is not in the title).
- Review (fresh agent): 12 findings — key repeat running through clips before metadata, modifier+arrows
  leaving the sequence, `ended` on a scrub to the end, pending landing lost on a converted clip / applied to
  the wrong clip, O(n²) selection check, Space over a selected non-video, prev / next not reusing the
  preloaded clip, last-frame landing by the wrong fps, adopted element's autoplay; all fixed except the stale
  button and segment widths shifting during a drag (accepted). The fixes' re-review found two more (clips
  staying muted after quick adopts, `ended` ignored after a very short play) — fixed; confirmed by the same reviewer.

## 0.64.2 — 2026-11-17 — macOS: dictation no longer kills Chrome
- **What:** on a Mac, pressing the dictation mic a second time (after allowing the microphone) made the whole
  browser quit ("Google Chrome quit unexpectedly", user report on 0.62.1).
- **Where:** `Sight.py` — new `mac_launch_prefix(browser)` (the Sight window's browser is started as
  `/usr/bin/open -n -a <Browser>.app --args …` instead of exec'ing the binary), `close_browser(proc, user_data_dir)`
  (macOS: `pkill -f --user-data-dir=<home>/browser`, since `proc` is the short-lived `open`); `tests/test_mac_launch.py`.
- **Notes:** root cause (by analysis, not reproduced — no Mac here): a browser exec'd by Sight is its child, and macOS
  privacy protection (TCC) makes the parent — Sight.app or the Python behind Sight.command — the "responsible" app
  for the microphone. Neither declares `NSMicrophoneUsageDescription`, so the first real capture gets the browser
  process killed by the system. Through `open`, launchd starts the browser as its own app, which asks for the
  microphone under its own name. Rejected: adding `NSMicrophoneUsageDescription` to Sight.app's Info.plist — it covers
  only the packaged build, not Sight.command (Python / Terminal), and makes Sight, not the browser, the app listed in
  Privacy settings. `-n` keeps a separate instance next to the user's own Chrome (the separate `--user-data-dir`
  needs its own process anyway). Verify on a Mac: dictation twice in a row, window position / size restore, quitting
  Sight when its window is closed, and a failed start closing the window.
- Review (fresh agent): the `pkill -f` pattern was a raw regex (odd characters, `.../browser` also matching
  `.../browser2`) and could run before the browser started — now ERE-escaped, anchored at the path's end, run twice
  1 s apart; confirmed by the same reviewer.

## 0.64.1 — 2026-11-17 — Instant native launch splash (Windows)
- **What:** the launch splash (the Sight logo) shows at once and closes when the page is ready. It was a PowerShell
  window started only after 1 s (PowerShell costs ~0.7 s of CPU to start), so it appeared ~1.7 s in or never.
- **Where:** new `app/splash_win.py` (stdlib ctypes: layered, topmost, click-through, no-taskbar window, GDI+ draws
  `app/splash.png` into a premultiplied DIB, DPI-aware, centred on the monitor under the cursor); `app/splash.png`
  (512 px, rendered from `favicon.svg`); `Sight.py` (`Splash`, `--splash` handled at the very top for the frozen exe,
  started first thing in `main()` before `bootstrap()`); `build_exe.bat` (ships `splash.png`); `tests/test_splash_win.py`.
  Removed: `app/splash_screen.ps1`, `LazySplash`, `start_splash` (no PowerShell fallback).
- **Notes:** out of process on purpose: a bad window procedure can only kill the splash, never Sight. Source runs use
  `pythonw -I -S app/splash_win.py IMAGE EVENT 45`; the frozen build `Sight.exe --splash ...`. The splash waits on a
  named manual-reset event `Local\SightSplash-<pid>`; the launcher creates and holds the event before starting it. Its
  name goes into env `SIGHT_SPLASH` so the `bootstrap()` re-exec into the venv reuses the same splash (exactly one);
  `Splash.forget_env()` pops it right after `bootstrap()` returns and in main()'s finally, so the browser / workers /
  a nested Sight never inherit it. Close points unchanged (ready ping, `_open()` finally, `main()` finally); 45 s cap
  (a hard-killed Sight leaves it up to 45 s — accepted). Keep `splash_win.py` stdlib-only and import-light (only `sys`
  at module level). **Untested on Windows** (Linux container) — checklist in PLAN.md "Left to check on Windows" item 2.
- Review (fresh agent, static): env var leaking to children (medium), import cost, close racing the splash's own
  event creation, 1 px scaling fringe — all fixed and confirmed by the same reviewer.

## 0.64.0 — 2026-11-17 — Missing files on boards
- **What:** a board card whose file is gone (source removed, or asset flagged missing) is a clear "Missing"
  placeholder with the file name and its full path instead of an empty card. Adding the folder again (or a late
  thumbnail) brings the pictures back without reloading the page. Space on a placeholder says "File is missing".
- **Where:** `app/library.py` (`board_items.asset_name` / `asset_path` migration + backfill, `add_board_item`,
  `_migrate_asset`), `app/static/canvas.js` (`fillItemEl`, `forgetAssets`, `refreshMissing`, placeholder CSS,
  `createBody`), `app/static/index.html` (SSE hook, `assetUnderPointer`, Space), `tests/test_board_missing.py`,
  `docs/ARCHITECTURE.md`, `MANUAL.md`.
- **Notes:** `_migrate_asset` previously never touched board items (a moved file left its cards dangling); it now
  rewrites `asset_id` + snapshot (bumps revision). Snapshot is server-owned: not PATCHable; POST falls back to the
  body copy only when the asset row is missing. Backfill runs once, only when the columns are added; cards whose
  asset was already deleted stay without a name ("Unknown file"). `getAsset` caches per page (null = 404 only; other failures are not cached and leave the card alone), `refreshMissing` evicts. Cards in state `ok` are re-checked only on `source` / scan-end events, so a file deleted under a live
  source shows the placeholder after the next scan, not instantly. Checked with Playwright (remove / re-add source,
  placeholder text, Space toast) on desktop; touch relies on the text being on the card (no hover needed).
- Review: fresh-agent review found 2 medium (non-404 errors shown as missing; refresh storm/flicker) + 4 low (migration backfill crash-safety, getAsset race, selectedAssetIds during refresh, uncapped snapshot) — fixed. Re-review found a card left blank after a
  failed (non-404) first lookup: one retry sweep 5 s later (`retryTimer`, at most every 5 s). All confirmed by the same reviewer.

## 0.63.0 — 2026-11-17 — Drawings and review notes on Canvas boards
- **What:** the lightbox annotation tools now work on Canvas boards: brush / pencil / highlighter / eraser / line /
  arrow / rect / ellipse / text / pin / select-transform / undo / styles, plus the notes panel (notes, replies,
  open / in progress / done, drawings linked to notes). Drawings are free over the whole board in world
  coordinates (they do not follow items). A pencil button at the top left of the board and **Shift+A** switch
  the mode; the notes panel starts closed on a board. Two fingers pan / pinch-zoom the board (touch had no way
  to move the camera before). With the mode off the drawings stay visible.
- **Where:** `app/static/annotate.js` (board mode: `isBoard()`, host flags `board` / `frameRect`, `abortGesture`,
  `bounds`, `flush`, `modal` exports, CSS `.light.<state>` → `.an-host.<state>`), `app/static/canvas.js`
  (`annot` option: mount, `bindAnnot`, keys, pinch, `frameRect` / `frameAll`, toggle button), `app/static/index.html`
  (`boardAnnot`, Ctrl+A / modal guards), `app/library.py` (`annotations_for_board`, `board_full` uses it),
  `app/server.py` (`GET /api/annotations?board_id=`), `tests/test_board_annotations.py`, docs.
- **Notes:** rows are `scope='board'`, `board_id` (no `target_asset_id`); not in `.srev` / exports (FORMAT.md note).
  Board mode skips everything that needs a picture (screenshots, review state, versions, picture text, note
  previews, stamp, exports / import; only "Copy notes as text" stays). `modeAllows` shows all drawings on a board
  (no compose / clean-picture mode), a picked note narrows to its drawings and moves the camera to them. While the
  mode is on the canvas keys are filtered to F / A / Esc so X / Delete cannot remove items. Plain A is NOT an
  annotation key on a board (keeps framing); Shift+A toggles. Canvas `persistCurrent` awaits `annot.flush()`
  because `setAsset`'s own flush is not awaited and the item map is cleared synchronously (existing lightbox
  quirk, left as is). `bind2d` runs once per board on the same viewport: `attachInput` is guarded by a WeakSet.
  A loose drawing joins the next note wherever it is on the board (lightbox rule, deliberately kept). Checked with
  Playwright (draw / reload / pan / zoom / item move / board switch / pinch / lightbox regression), not on a
  real touch device.
- Review: fresh-agent review found 1 medium (null surface on board switch) + 5 low (load race, open error path, delete order, Shift+A repeat, Esc/Space leak) — fixed. The first Esc/Space fix
  skipped the palette / popup / overlay Esc (found on re-review): the guard now sits after them in index.html's keydown,
  and canvas.js's keydown ignores `e.defaultPrevented` keys (already used by index.html, which runs first). All fixes
  confirmed by the same reviewer.

## 0.62.1 — 2026-11-17 — Add Folder picker: clean errors, no stale folder, network drives, macOS drives and privacy
- **What:** "+ Folder" fixes. Adding a folder that is gone (deleted, drive unplugged while the picker was open)
  now says "Not a folder" instead of "Internal Server Error". A folder that fails to open no longer leaves the
  picker showing the previous folder's path over an error (where "Add this folder" silently added that previous
  folder): the listing stays and a "Can't open <path>." line is added; reopening the picker on a folder that went
  away starts over at home. Fast clicks on a slow drive can no longer let an older listing replace a newer one.
  Breadcrumbs work for UNC paths (`\\server\share\...`).
- **Where:** `app/server.py` — `add_source_or_400` (used by `POST /api/sources` and `/api/sources/pick`),
  `/api/fs/list` (`os.path.abspath` instead of `Path.resolve()`); `app/static/index.html` — `fbCrumbs`,
  `fbNavigate` (`fbNavToken`), `fbRender(failedPath)`, the `#fbSelect` alert (shows `detail`).
- **Notes:** `/api/fs/list` no longer resolves, so on Windows a mapped drive stays `Z:\...` while browsing (resolve()
  can turn it into its UNC path). `Library.add_source` deliberately still resolves: source ids are sha1 of the
  resolved path, changing that would re-id existing sources — so a source added from `Z:` may still be stored
  under its UNC path, as before. `add_source_or_400` checks the folder itself instead of catching `OSError` around
  `add_source`, because the watcher can raise `OSError` after the row is saved (that stays a 500). The mapped-drive
  case is untested on real Windows. Review (fresh agent): two minor issues (reopening on a vanished folder,
  over-broad `OSError` catch) — both fixed and confirmed by the same reviewer; the footer path is also cleared while no folder is open.
- **macOS (user report: "can't set a source, clicking does nothing; can't delete collections"):** not reproduced —
  the picker, source rows and the collection × all work in WebKit (WebKitGTK + WebDriver, the Safari engine) and
  Chromium, and the API works. Fixed what is Mac-only: external / network drives under `/Volumes` are listed in the
  picker (`fs_roots`, read from the `/Volumes` listing only, never touching a drive, so a stalled share can't hang
  it); a folder macOS privacy protection refuses (Desktop, Documents, Downloads, external drives until Sight is
  allowed — EPERM) shows a "System Settings → Privacy & Security" hint instead of "No subfolders here"
  (`fs_list_dir_checked` → `denied` in `/api/fs/list`, `fbDeniedText`), and adding such a folder is refused with
  that reason instead of becoming a source with 0 files (checked on the resolved path, the one stored). The drive
  list is fetched on every picker open. The collection-delete report stays open: needs the user's browser /
  Sight version / console. Review (fresh agent): checked on the link path not the stored one, stalled-share hang in
  `fs_roots`, double listing — all fixed and confirmed by the same reviewer.
- **Stale modules after an update:** `/static` (annotate.js, canvas.js, keys.js, compare.js, vendor …) was served
  without `Cache-Control`, so browsers cached the modules by heuristic while index.html (no-store) was always new:
  after an update the page could run with the previous version's modules. The user's "broke in 0.62" can't come
  from 0.62's code (it only touched the frame stamp in annotate.js), so this is the likely cause. `RevalidatedStatic`
  (server.py) adds `Cache-Control: no-cache`: the cache stays, every load revalidates by ETag (304 on localhost).
  Review (fresh agent, Starlette 1.10.0, 200 / 304 / HEAD / Range checked): nothing found.
- **Esc closes the Settings panel** (it covers the whole sidebar by design, user's confirmation): in the main Esc
  chain after the lightbox and the search, before clearing the selection / closing the narrow drawers; from a
  settings field it blurs the field first. Through `#settingsHead`'s own click, so the open state is saved the same
  way. Touch: the header itself stays the way to close it. MANUAL (Settings panel). Only while the panel is on
  screen (a closed narrow-screen drawer hides it) and not from a text field outside it; Esc from one of its own
  fields closes it even with a search active (the search is kept). Review (fresh agent): Esc closed the hidden panel
  on narrow screens and cleared the search from a settings field — both fixed and confirmed by the same reviewer; Esc on a canvas board still clears the
  board selection and closes the panel in one press (accepted).

## 0.62.0 — 2026-11-17 — Video annotation: the frame stamp is on by default, switched off per video, burned only while on
- **What:** the frame stamp is on for every video until switched off, and the switch (toolbar icon / `Shift+F`)
  belongs to that one video: off in video A leaves video B stamped. While a video's stamp is on, its label is burned
  into that video's report pictures (ZIP, PDF, reviewer page); off = clean pictures. No separate "burn" option (user's
  decision: the stamp's own button is the switch, set once per video, not per frame). The look (mode, size, colours,
  backdrop, font, position) stays one shared preference.
- **Where:** `app/static/annotate.js` — `S.stampVideos`, `stampOn(aid)`, `setStampOn(aid, on)`, `toggleStamp`,
  `toggleStampPop`, `paintStamp`, `paintBar`, `loadStamp`, the reset handler, `bakeFrame(cv, t, aid)` (early return
  when that asset's stamp is off; `gatherReport` passes the loop asset's id, so "export all" uses each asset's own
  state); MANUAL (Frame stamp).
- **Notes:** stored as `sight.annotate.stamp.videos` → `{ [assetId]: false }` for the switched-off videos only (the
  key is deleted when switched back on), written at once (no debounce), not review data — FORMAT.md unchanged; the
  HTML page and the phone consume the burned pictures. The old global `sight.annotate.stamp.on` (0.60.0) is ignored
  and dropped on the next save; no migration (default on makes it moot). `S.stampVideos` is read once at creation: a
  change made in another tab or on the phone shows after a reload, and this tab's next write stores its whole map
  (accepted for a device preference). Opening the ▾ popover on a switched-off video turns it on again. Review (fresh
  agent, two passes: the "burn follows the toggle" step and the per-video state): nothing of substance; `S.asset`
  drives the live state, `setAsset` repaints the bar, non-video assets return false.

## 0.61.0 — 2026-11-17 — Voice dictation in the annotation text fields (desktop); STT plan revised
- **What:** a microphone button in the note composer (it dictates into the last focused composer field: the note
  or the picture text) and a floating one at the corner of a focused note-edit, reply or picture-text field. Click
  / tap or `Alt+M` toggles; the button pulses while listening; interim words show in a muted bubble, only final text
  goes into the field at the caret (undoable with Ctrl+Z); click, Esc or `Alt+M` stop (pending words land), blur or
  Enter abort. Right-click / long-press the mic: language list (Auto = the browser's language + 14), saved as
  `sight.dictation.lang`. No API (Firefox), a denied microphone or no network → the title and a toast explain it.
  Uses the browser's Web Speech API only (Chrome / Edge online via Google, Safari on-device); no backend, no keys.
  `docs/PLAN-stt.md` is the revised plan; the user's `docs/tmp/stt-implementation-plan.md` is kept untouched.
- **Where:** new `app/static/dictation.js` (`createDictation`, `PROVIDERS.webspeech`, `insertAtCaret`,
  `createDictationUI` → `{mic, toggle, stop, destroy}`, `SHORTCUT`); `annotate.js` (import, `S.dict` / `S.dictTa`,
  the mic + `data-dict` in `buildPanel`, `createDictationUI` in `mount` / `destroy` in `unmount`, a labelled
  `keyTable` row, `dictateNote`); MANUAL (Dictation); `docs/PLAN-stt.md`.
- **Notes:** the original plan (Groq whisper-large-v3-turbo as the main engine + Windows SAPI / macOS
  NSSpeechRecognizer fallbacks, a Python `ISTTProvider` / `STTRouter`, 16 kHz capture) was written for a native
  app: Sight's UI is a web page, so every engine there would run in the Python server with audio streamed from the
  page — heavy for no gain, and it missed the free Web Speech API with live interim text. Revised tiers: (1) Web
  Speech now, (2) optional Groq through a backend proxy that holds the key (any browser, better punctuation, audio
  leaves the machine), (3) local whisper only on demand. Interim text is never written into the field (a textarea
  cannot style part of its text, and it would pollute the undo stack). Mic buttons `preventDefault` on mousedown
  so the field keeps focus (a blur would save and close an in-place edit). The shortcut is also bound in the module's
  capture listener because the field handlers stop propagation; `Alt+M` instead of Ctrl+Shift+M (Chrome / Edge's
  profile menu); on macOS Alt+M types "µ" but `e.code` is still KeyM and the character is suppressed. Chrome ends
  continuous sessions on silence: the module restarts them (cap: 3 restarts within 1 s each; 3 `no-speech` sessions
  ≈ 25 s → "No speech heard" and stop). Not done: Groq, dictation outside the annotation panel, a real-microphone
  test (tests use a fake `SpeechRecognition`), touch long-press on a device. Review (fresh agent) found: document /
  window listeners never removed (two instances after reopening the lightbox — fixed with an AbortController + dead
  flag), a focused field removed without blur kept the mic listening (fixed: a 300 ms `isConnected` tick, privacy),
  the reserved shortcut (changed), the language popover ignoring Esc / `registerAutoClose` (fixed), `no-speech`
  ending the session (now a restart), dead buttons kept (pruned). The same reviewer confirmed all six, nothing new.

## 0.60.0 — 2026-11-16 — Video annotation: configurable frame stamp (live and burned into report pictures)
- **What:** the video annotation toolbar has a frame-stamp icon (+ a ▾ for its settings; `Shift+F` while
  annotating): a label with the current frame over the video, not part of the drawings. Drag it (mouse, pen,
  finger) — it snaps to one of eight spots (corners, side centres). Settings (▾ or a tap on the stamp): Show
  (frame + time / frame / time), size, text colour, backdrop colour + opacity (0 = none), font (normal / bold /
  mono), a 3×3 position picker, Reset. Saved per device. The same settings style the label burned into exported
  report pictures; defaults equal the old look (top-left, white on 60 % black), so nothing changes until touched.
- **Where:** `app/static/annotate.js` — `STAMP_DEFAULT` / `STAMP_POS`, `loadStamp` / `saveStamp` (`sight.annotate.stamp`),
  the "frame stamp" section (`stampText`, `stampBox`, `stampXY`, `paintStamp`, `stampDown`, `toggleStamp`,
  `buildStampPop` / `paintStampPop` / `closeStampPop`), `bakeFrame` rewritten on `stampBox` / `stampXY`, a
  labelled `keyTable` row, hooks in `buildBar` / `paintBar` / `renderAll` / `tick` / `toggle(false)` / `onDown`,
  `.an-stamp*` CSS; MANUAL (Frame stamp).
- **Notes:** device preference, not review data (FORMAT.md unchanged). Size is a % of the picture width (min 11 px),
  so the live label equals the burned one up to tiny displays. Show modes split `RC.frameLabel` on " / " —
  review-core, the HTML page and the phone are untouched (they consume the burned pictures). The burn always
  happened whether or not the live stamp was on (changed in 0.62.0: only while it is on, and on by default); the panel's `f<N>` chip is unchanged. The stamp lives in the turned
  layer root, so it rotates with a turned view; stamp clicks are stopped so a tap does not play / pause. `toggleStamp`
  returns false outside annotation mode (the "Video" key group also runs in the plain lightbox). Drag geometry is
  captured at pointerdown (a zoom mid-drag uses stale values, accepted). Default top-left overlaps the lightbox's
  floating "i" button. Review (fresh agent): `Shift+F` flipping the saved preference from the plain lightbox (fixed),
  the popover swallowing every key after a click on its buttons (fixed: only INPUT / SELECT keep keys, buttons blur,
  Esc closes it), `stampDrag` stuck after a cut-off drag (reset in unmount / toggle / layer creation, `lostpointercapture`),
  Alt gestures blocked on the stamp (fixed), ▾ touch size / `tabular-nums` (fixed). The same reviewer confirmed the
  fixes; its last gap (Esc inside a focused slider stopped at the popover) is fixed by letting Escape through.

## 0.59.2 — 2026-11-16 — Video: Alt-scrub with the select tool; smooth mid-clip scrubbing of long-GOP clips
- **What:** with the annotate select tool (V) active, Alt+drag on empty space scrubs a video (or turns a picture)
  again. Clips with long GOPs (phone / screen recordings: the user's sample has keyframes only at 0 and 8.3 s) now
  scrub smoothly in the middle: after two slow seeks during a drag Sight makes a small short-GOP **scrub copy** in
  the background (≤ 960 px, no audio, keyframe every 4 frames) and shows it over the player while dragging; the
  player lands on the full-quality frame when the drag ends.
- **Where:** `annotate.js` `onDown` (Alt in empty space passes to the viewer); `app/library.py` (`SCRUB_TAG` /
  `SCRUB_VF` / `SCRUB_ENC`, `scrub_copy_path`, `scrub_status`, `start_scrub_copy`, the playback-copy job code takes
  a `tag`, jobs keyed `aid+tag`, kind-aware cleanup, `_prune_scrub_copies`, `_encode_copy` with the playback-first
  priority: `_play_cv`, `_play_waiting`, `_scrub_proc`); `app/server.py` (`POST /api/video/scrub`,
  `GET /api/video/scrub/{aid}`); `video-playable.js` (`convertForPlayback(…, kind)`); `index.html` `attachViewer`
  (`.view-scrub` overlay, `loadScrubCopy` / `pumpScrubCopy` / `hideScrubCopy`, `SLOW_SEEKS` / `SLOW_SEEK_MS` /
  `SCRUB_COPY_MIN_S`, `scGen`); `tests/test_playback_copy.py` (8 tests); MANUAL, ARCHITECTURE.
- **Notes:** root cause measured in Edge: a browser seek decodes from the previous keyframe, so on the sample a seek
  took 5 ms at 0.1 s and up to 230 ms at 8.1 s (≈ 27 ms per second of distance); in a 120-move drag over 3 s only
  24 positions painted mid-clip vs 70 at the start; the RAM cache was irrelevant (the file fits in it). With the copy
  91 of 91 frames paint. The copy is never played (`playback_path` ignores it), lives in `thumbs/video/<aid>_<stamp>.scrub.<ext>`
  (the `<aid>_*` rename / delete globs cover it), is requested lazily (the first scrub of a slow clip is still choppy
  until it exists; clips < 3 s never ask), capped to the newest 20 files / 1 GB (`SCRUB_KEEP_FILES` / `SCRUB_KEEP_BYTES`,
  oldest by mtime, never the one just made). One ffmpeg at a time (`_play_slot`); a playback copy (the "Converting…"
  the user waits for) has priority: a running scrub encode is terminated, returns None and is re-run when the slot
  is free (its job stays "working"; under a steady stream of playback jobs it waits). The overlay shows only while
  `light.scrubbing`, only for a seek of the current drag (`scGen`), is hidden on frame steps / marker jumps and
  after the player presents its own frame (rVFC, ≤ 250 ms); copy and original can differ by a fraction of a frame at
  the hand-over. Left: a changed file's old-stamp scrub copy lingers until the next rescan / scrub; the webm branch
  (`libvpx-vp9 -g 4`) is untested; Playwright's Chromium has no H.264, test with Edge (`channel: "msedge"`).
  Review (fresh agent): trigger too eager and uncapped (fixed: scrub-only slow seeks, two needed, min duration,
  cap), stale overlay frame for up to 250 ms (fixed), silent copy errors (warn), missing tests (added); second
  pass found playback copies queued behind a minutes-long scrub encode (fixed: priority + abort, two tests); third
  pass confirmed everything, two nits (unguarded `terminate()` — wrapped; a copy finished right before the
  terminate is redone, rare).

## 0.59.1 — 2026-11-16 — 3D: alpha cut-outs for USD / USDZ in every shading mode
- **What:** a UsdPreviewSurface whose `opacity` reads a texture now renders its cut-outs (leaf cards, fences):
  `opacityThreshold` 0 / unset → BLEND, > 0 → MASK with that cutoff, on both paths (server GLB conversion and USD
  read in the browser). Cut-outs survive Solid, Vertex, Normal, X-ray, the inspector highlight and the grid thumbnail.
- **Where:** `app/usdz_convert.py` (`_Materials._fill` opacity, `_alpha_into_base`, `_bake_alpha`, `_as_8bit`);
  `app/library.py` (`USDZ_CONVERTER_VERSION` 4 → cached conversions redone); `vendor/jsm/loaders/usd/USDComposer.js`
  (`_applyPreviewSurface`, Sight patch: a separate opacity texture → alphaMap clone tagged `userData.usdAlphaChannel`);
  `app/static/model3d-core.js` (`usdMaterialsAsSight` from `parseUsd`, exported `keepAlpha`, `applyBaseMaterial`
  one temp material per group, `xrayMaterial`, `meshHighlight`); `index.html` (Solid retint for material arrays);
  `tests/test_usdz_convert.py` (`TestOpacity`); ARCHITECTURE, MANUAL.
- **Notes:** the user's `Stylized_Palm_tree_set.usdz` (Sketchfab export) still draws opaque **on purpose**: its
  materials wire no `opacity` at all and every texture is a JPEG without alpha — the leaf image has its cut-out area
  flattened to white. usdview / Quick Look show the same white cards; making it work would need a white chroma-key
  guess (not added; re-export the asset with its alpha instead). glTF has no alpha map, so a separate opacity texture
  is baked into the base colour's A channel (16-bit masks scaled, not clipped); three samples an alphaMap's G channel,
  so the browser path redraws the channel into G. All USD materials are double-sided on both paths (the gprim's
  `doubleSided` is not followed; honouring it would hide open shells). Temp materials read the map's alpha through
  `onBeforeCompile`; `material.clone()` drops that hook, fine because originals never carry it. X-ray scales
  `alphaTest` by 0.3 so MASK cards do not vanish. Limits: opacity on its own UV set / transform, opacity scale /
  bias and float (`F`) masks are not handled; after a bake the unused original base image stays in the GLB.
  Review (fresh agent, run by the block's author): 16-bit masks became binary (fixed), a multi-material mesh was cut
  by one part's texture (fixed); the same reviewer confirmed both, nothing new.

## 0.59.0 — 2026-11-16 — Settings: Scan Filtering with a built-in default filter list
- **What:** Settings "Scanning" is now "Scan Filtering". A list shipped with the app, `app/initial_filtering.ini`
  (OS junk, temp / partial files, databases, shortcuts, VCS / build folders, `.sight/`), applies under the user's
  Ignore list — the scanner skips the union of both. A shield button next to Apply opens "Default scan filters"
  to read / edit that list (Save / Restore shipped). Edits are stored as `<SIGHT_HOME>/initial_filtering.ini`,
  which replaces the shipped file; saving text equal to the shipped list removes the copy again.
- **Where:** `app/initial_filtering.ini`; `app/library.py` (`read_default_filter`, `IgnoreRules(user, default)` —
  the one merge point, `Library.set_default_filter`, `_apply_ignore` shared with `set_ignore`); `app/server.py`
  (`GET / PUT / DELETE /api/scan/defaults`); `index.html` (`#dfOverlay`, `dfOpen` / `dfSend`, an Esc branch in the
  main keydown); `build_exe.bat` / `build_app_macos.sh` (`--add-data` for the ini); tests `tests/test_scan_ignore.py`,
  `tests/scan_filter_modal.cjs`; MANUAL (Scan Filtering), ARCHITECTURE (merge order, endpoints).
- **Notes:** the DB meta `scan_ignore` still holds only the user's list; `/api/state` is unchanged. `.log` / `.ini` /
  `.cfg` are shown as text, so they are never in the ini — a test asserts no extension Sight shows is filtered.
  File-style globs match folder names too (`Shots.bak/` would vanish), so the shipped list only has patterns no
  media folder would carry (`*.bak`, `*.temp`, `*.lock`, `*~` deliberately left out; `Library/` and `*.meta` are
  commented examples only). `SKIP_DIRS` stays the fallback when the ini is unreadable (one warning line, bare
  `logging` → stderr / `sight.log` in a frozen build). The user copy is written atomically (`.tmp` + `os.replace`);
  an unwritable home returns a 500 with `detail`, shown in the modal. The scanner only skips, never deletes.
  Not verified: a frozen build actually carrying the ini (no build was run). Review (fresh agent) found: the
  file-style globs pruning folders (fixed: six patterns dropped + a folder test); saving the unchanged shipped
  text created a permanent custom copy that would miss future shipped updates (fixed); non-atomic write and a
  bare "Failed" (fixed); silent fallback (logged). The same reviewer confirmed every fix, nothing new.
