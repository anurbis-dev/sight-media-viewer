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

## 0.134.0 (docs) — 2026-11-25 — Plan: Sight's desktop review built into Coreline
- **What:** `docs/PLAN-coreline.md`. The owner chose: Coreline is not ready for a tracker adapter (no review layer,
  pre-MVP). So Coreline gets its own player and commenting, built from **Sight's desktop review**: the lightbox on the
  left, annotate.js's notes panel on the right; on the phone the notes go under the player. It is not built from the
  phone app's screen; the owner preferred the desktop look. The owner also wants 3D in Coreline, so viewing is split
  into viewer modules behind one interface (image, video, model3d). Documents (scripts) are deferred by the owner
  (R5 keeps a sketch). Sight becomes an optional external reviewer. Linked from PLAN.md, CLAUDE.md and PLAN-mobile stage 5.
  PLAN-trackers 5c is superseded: the adapter is now R4. No code yet.
- **Where:** docs only. The Coreline repo was read at `ea411a7`. This session cannot push there (the GitHub App has no
  write access), so the Coreline stages R1–R3 are for a session in that repository.
- **Notes:**
  - FORMAT.md v1 rows are stored as they are in Coreline, every column (incl. `shape_kind`, `rotation`, `locked`),
    keyed by record + file field + id.
  - The server merges with the same `mergeRows`. Coreline is ESM, so it uses a side-effect import + `globalThis`, not
    `module.exports`. Sight's `merge_cases.json` runs in Coreline's tests.
  - R0 (Sight side) comes first: annotate.js made host-neutral (`host.store`: its write queue, direct fetches, URLs
    in templates, fps, author, settings, CSS tokens, `/static/` imports), viewer modules (2D first,
    then 3D), a narrow layout, a labels hook for i18n.
  - **No regressions** (owner: Sight desktop is in daily use). R0 starts with R0-0, Playwright regression tests of
    today's lightbox / annotator behaviour passing on the current code. Refactor steps change no behaviour and do not
    edit those tests. Each block ships as its own version with the whole suite green and benchmarks no worse.
    Stored keys / the outbox format stay readable.
  - R1: a row put is merged on the server, not replaced (replies live in `note.data`); ids are never re-derived.
  - Gotchas for R2:
    - drawings are in the original's pixels, while the `web` rendition is scaled (video ≤ 1920 wide, image WebP ≤ 2048),
      and today's lightbox takes the decoded size as doc units;
    - `/api/media` takes signed URLs only (from the record's file field), not Bearer;
    - review rows need a new realtime subscription (Coreline's WS sends entity records).
- **Review:** a fresh agent checked the first draft against both repos. It found 4 errors, 4 smaller inaccuracies, and
  2 problems with this entry:
  - review-draw.js is a full-screen sheet, not a mountable widget (moot now: the desktop look uses annotate.js);
  - `module.exports` is dead under Coreline's ESM;
  - the table lacked `shape_kind` / `rotation` / `locked` and an id scope;
  - media needs signed URLs;
  - renditions differ for images, and some files get none;
  - the WS needs a new message kind;
  - permissions must follow the file field;
  - R4 settles only half of 5b-2 (2);
  - this entry had a placeholder review line, and the archive step had not been run.

  All are fixed in the rewrite. A second round on the desktop-based rewrite found:
  - the write queue and many URLs bypass `host.api`;
  - the doc-unit size comes from the decoded element;
  - the lightbox core is `attachViewer` (wrong lines given);
  - the id re-derive policy contradicted the key and would duplicate notes on a Sight round trip;
  - lost replies if a put replaces the row;
  - no "apply rows by id" entry point;
  - the outbox is not per user;
  - the author is a typed name;
  - imports, settings, CSS tokens and note previews are tied to Sight.

  A third round found:
  - undo writes had to name their stamp (`edited_at` for notes);
  - puts must carry the client's stamps, or a stale outbox wins;
  - `mountStage` does not exist (it is `fillStage`);
  - the 3D viewer is ~1400 lines tied to Sight's server (model-res, model-glb), so GLB first;
  - the vendored list was incomplete.

  Further rounds added two more fixes:
  - the regression block clashed with R0a / R0d; it now names the only behaviour changes;
  - fresh undo stamps are limited to server-merging stores, so Sight's undo keeps old stamps and `.srev` merges do
    not change.

  The same reviewer confirmed every fix.

## 0.134.0 — 2026-11-25 — Loading mark: the Sight "eye" turning, wherever something loads
- **What:** every "loading / working…" text now has the Sight logo beside it (ring + blue focus dot) turning, so
  the dot orbits — desktop and phone. A bigger mark above the text in the tracker grid's "Loading…" and the phone's
  busy overlay / "Loading the model…"; the mark alone in the phone's note-picture placeholders (were "…").
- **Where:** CSS `.ld` / `.ld-col` / `@keyframes ld-spin` in `app/static/index.html` and `mobile/index.html` (keep
  them alike); `ldPhase()` in index.html. Used in index.html (scan counter, Reading file…, Loading model… label,
  font / text / waveform / UVs / layers / tracker fields / About, review export `say()`s, playback-conversion HUD,
  tracker "Connecting…", scan defaults "Saving…", ffmpeg "Installing…"), `annotate.js` (sync progress and
  Building… toasts, Searching…, Syncing… button), `tracker-source.js` (fields), `mobile/js/app.js` (`busy()`,
  model wait, picture placeholders), `mobile/js/trackers.js` (Searching… / Loading… / Connecting…). ARCHITECTURE
  (Frontend conventions) has the rule.
- **Notes:**
  - Pure CSS, `::before` on the element: a border circle in `currentColor` + a radial-gradient dot at the favicon's
    proportions, the whole box rotating (the ring is round, so only the dot seems to move). Inline-block, so it
    also sits in one-line ellipsized toasts. `textContent` changes keep it (the model % label relies on that).
  - Put `.ld` only where the wait's content is later *replaced* (a span inside) or the element removed — never on
    an element that then shows the result. `<option>` texts ("Loading projects…") are left: `::before` does not
    render there. Plain-text toasts (`flash()`, `flashV3DToast`) get no mark.
  - Marks rebuilt by innerHTML several times a second (scan counter per batch, progress toasts) would restart at 0°
    and stall: they carry `style="--ld-d:-<performance.now()>ms"` (no modulus, so it fits the 4 s reduced-motion
    duration too). Reduced motion: a slow 4 s turn, not none.
  - Side fixes: the annotator's host toasts (lightbox 3D, board, compare) now pass `htmlToText(text)` — HTML from
    annotate.js used to show as raw text there; phone picture placeholders drop on a failed picture (`.catch`); the
    ffmpeg Install button comes back if the request fails.
  - Not done: the Windows launch splash (`app/splash_win.py`, a static PNG in a native layered window) stays still.
    Pre-existing: a UV / PSD layers pane left after its inspection is cleared (not replaced) keeps its wait text.
  - Review (fresh agent): found raw markup in the board / compare host toasts, the restart-at-0° stall, forever-
    spinning phone placeholders, and missed spots (HUD, Connecting, Saving, Installing, Syncing) — all fixed; the
    second pass confirmed them and caught the phase modulus breaking reduced motion (fixed) and the Install button
    stuck on a failed request (fixed). `test_pwa`: same 3 failures with and without the change (pre-existing here).

## 0.133.1 — 2026-11-25 — Phone app: a pinch never zooms the page
- **What:** pinching a splat / model / picture on the phone sometimes became browser page zoom: the whole UI grew
  past the screen edges. The phone app now turns page zoom off: a pinch only reaches the app's own zoom.
- **Where:** `mobile/index.html` (viewport meta `maximum-scale=1, user-scalable=no`), `mobile/js/app.js` ("no page
  zoom" block before "full screen": cancels iOS `gesture*` events and any `touchmove` with more than one touch,
  non-passive on `document`); MANUAL (phone section).
- **Notes:**
  - Android Chrome honours `user-scalable=no`; iOS Safari ignores it, hence the JS block. All the app's pinches run on
    pointer events, which a cancelled touchmove does not stop (it only stops the browser's gesture and the
    pointercancel that came with it). Likely origin: `.stage` is `touch-action: manipulation`, which lets the browser
    take a pinch that does not start on the 3D canvas (`touch-action: none`). Left as is: the JS block covers it.
  - Left open: on iOS a second finger landing while one is already scrolling a list sends non-cancelable touchmoves;
    page zoom can still start there (rare, not fixable from JS). The document-level non-passive touchmove makes
    Chrome wait on the main thread before a scroll starts; accepted (it must cover bars too).
  - Not changed: Sight's HTML review page (`app/review.py`) keeps page zoom (text to read; it has no splat viewer).
  - Checked in mobile Chromium: a two-finger touchmove is cancelled, a one-finger one is not. `test_touch` and
    `test_model3d` fail with and without this change (pre-existing, unrelated).
  - Review (fresh agent): no correctness bugs; the notes above (iOS non-cancelable case, scroll latency, version bump
    for the service-worker cache) came from it. No fixes, so no second pass was needed.

## 0.133.0 — 2026-11-25 — Gaussian splats turn a quarter about X, like meshes (lightbox and phone)
- **What:** splats often arrive upside down or Z-up. The lightbox's ↻ button (`Shift+7`, the only button of the shade
  bar on a splat) and the phone's ⟳ *Turn the model a quarter* now turn a splat as they turn a mesh: a quarter turn
  about X on top of the half turn every splat gets, re-framed from the turned bounds, remembered per file
  (lightbox `sight.v3dRot`, its card thumbnail follows; phone `R.meta.turns`).
- **Where:** `app/static/model3d-core.js` `turnSplat`; `mobile/js/model3d.js` `createSplatViewer` (`turns`, `setTurns`,
  `getView` / `setView` / `turn`, `still` at `cam.turns`, `bounds()` per turn); `mobile/js/app.js` (turn button no
  longer hidden for splats, `SPLAT_EXT` import dropped); `app/static/index.html` (`boot3d` splat branch `place` /
  `turnTo` / camera rig turns / `onV3DRotate`, scene info bounds per turn; `#v3dShade.splat` CSS shows only ↻;
  `renderSplatThumb` turned); tests (`fixtures_3d.make_splat(dy=)`, `pwa_3d_formats.cjs` `turned`,
  `test_model_formats` balls_up.splat); ARCHITECTURE splat paragraph, MANUAL.
- **Notes:**
  - No new data-contract field: a splat view's `cam.turns` means what it means for a mesh, so a note written at one
    turn turns the splat back to it when opened (phone `setView`, lightbox camera rig `turns.set` → `turnTo`, which
    also stores the turn per file — as meshes do). A splat note from before 0.133 has `turns: 0` and still matches.
  - Only about X (Sight's mesh turn). A splat whose up is another axis (e.g. X-up) cannot be put upright with it;
    no other axis was added (it would need a new ctx field on both sides).
  - Phone stills at another turn turn the splat for the still and back while `stilling` (the live canvas waits).
    The lightbox's view capture is synchronous (as before): right after a turn Spark's sort may still be for the
    previous pose for a frame.
  - Review (fresh agent): pose composition, setView order, matrix freshness, persistence / thumbnail, teardown and
    touch / keys confirmed. Found: on the phone a turn (or a setView with another turn) landing while a still was
    awaited turned the mesh mid-still and the still's `finally` put back the *old* turn while `turns` / notes said the
    new one → `stillTurns`: during a still `setTurns` measures the new turn's bounds and puts the mesh straight back
    at the still's turn; the `finally` turns to the current `turns`. Second pass (same reviewer): fix confirmed, nothing new.

## 0.132.0 — 2026-11-25 — Big Gaussian splats: level of detail (phone and lightbox), lighter phone viewer
- **What:** a 32 MB .spz (millions of splats) froze a mid-range Android phone. Splats over a budget now load with
  Spark's LoD tree and draw at most the budget, picked for the camera (coarser out of view / behind it): phone
  600k, lightbox Spark's per-device default (2.5M on a desktop). The phone viewer also caps the pixel ratio at 1.5
  (was 2), drops it to 1 while the camera moves, and uses smaller splat footprints (`maxStdDev` sqrt(5)) for big
  files. Files at or under the budget load exactly as before: LoD is asked for only when a file is likely
  over the budget (`splatCountHint`: .splat size / 32, a .ply's header, an .spz's gzipped header; .ksplat / .sog
  4 bytes per splat as an upper bound), Spark's `lodAbove` then decides on the real count.
- **Where:** `app/static/model3d-core.js` (`SPLAT_LOD_PHONE`, `splatLodOptions`, `splatCountHint`, `splatLodFor`,
  `splatSource`, `splatBox`),
  `mobile/js/model3d.js` `createSplatViewer` (LoD options, pixel ratio, render tail, `still()` LoD loop, `V.lod`),
  `app/static/index.html` (`boot3d` splat branch — now disposes the SplatMesh / SparkRenderer on stop;
  `fetchHead` (Range request for the hint); `renderSplatThumb` bounds; imports), tests (`fixtures_3d.py`
  `make_big_splat` + the new `make_splat_spz` SPZ v2 / v3 fixtures; `test_pwa.py` `test_model_formats` now also
  opens SPZ v2 / v3 and checks small files get no tree, new `test_big_splat`; `pwa_3d_formats.cjs` reports `lod`),
  ARCHITECTURE (splat paragraph "Big splats").
- **Notes:**
  - A big file keeps **only** the LoD tree (`nonLod` off): `packedSplats.numSplats` is 0 and
    `SplatMesh.getBoundingBox` is empty — use `splatSource` / `splatBox`. Spark does not report the original count
    once the tree is built: the shown count (phone `splatCount`, lightbox info row) comes from the exact hint, else
    the tree's (originals + merged nodes, e.g. 700k → 788k; lightbox label "(LoD tree)").
  - Asking for `lod` at all sends a file through Spark's other decoder (csplatarray), even if `lodAbove` then
    skips the tree: that is why the hint gates it. An inexact hint errs high (LoD asked, `lodAbove` guards).
  - Stills (phone): Spark's LoD pick runs in a worker and is used only by the next generate, and is skipped while
    the worker is busy — `still()` loops update / wait-idle until `currentLod` stops changing, at the still's own
    render size. Do not add `minSortIntervalMs` (makes `update()` return before the sort).
  - Nothing is drawn until the first LoD pick lands (no fallback to the originals); the phone warm-up waits up to
    10 s for a tree (3 s otherwise). The tree is built in Spark's load worker (700k splats ≈ 1.3 s in desktop
    Chromium); not measured on a phone.
  - Not verified on a real Mali GPU (SwiftShader only). Desktop LoD checked in Playwright with a temporarily
    lowered budget (700k-splat file, tree built, framed right); a 2.7M-splat file is too slow to draw in
    SwiftShader to check at the real budget. Grid thumbnails still load without LoD.
  - Review (fresh agent): (1) `still()` did not cancel a deferred live update (`spark.updateTimeoutId`, Spark's
    non-preUpdate path) that could sort for the live camera during the still's `update` → cleared after
    `autoUpdate = false` (the lightbox takes no Spark-sorted stills); (2) the lightbox never disposed the
    SparkRenderer / SplatMesh, leaking an LoD worker with a tree copy per open → disposed in the viewer's `stop()`
    (the thumbnail already did); (3) `lod: true` for every file changed the decoder for small ones (.ksplat / .sog
    untested) → LoD only when `splatCountHint` says likely over budget; (4) info row showed the tree count → the
    hint's exact count. Tests: small-splat hint asserted {800, exact} for .splat / .ply / SPZ v2 / v3; big
    splat count 700000. Second pass (same reviewer): all four fixes confirmed; found a deferred Spark update
    (`setTimeout(updateInternal)` from the last render) firing after `spark.dispose()` and re-creating its sort / LoD
    workers → every dispose (lightbox, thumbnail, phone) now clears `spark.updateTimeoutId` first (confirmed by the same reviewer). Not covered by tests:
    the hint of an .spz over 64 KB (truncated gzip slice; falls back to size/4 on any error).

## 0.131.0 — 2026-11-25 — Drop a file: sidebar adds it, the rest of the window just opens it
- **What:** dropping a supported media file on the window either adds it to the library (left strip, the sidebar's width, in the accent colour) or only opens it in the viewer (the rest of the window, a white veil). Folders still add as sources (the whole-window overlay). **A** on a file that was only opened adds it, then drawing works.
- **Where:** app/library.py — `ensure_dropped_source`, `add_dropped_file`, `view_file`, `resolve_asset`; app/server.py — `drop_file_paths`, `POST /api/files/drop`; app/static/index.html — `#srcDrop` two zones, `takeDroppedFiles` / `addDroppedFiles` / `ensureLightInLibrary`; tests/test_sources.py `DropFilesTest`; tests/drop_files_e2e.cjs; MANUAL, ARCHITECTURE.
- **Notes:** files stay on disk; the parent folder is not added. **Dropped files** is an inbox source (`<SIGHT_HOME>/dropped`) that is never scanned or watched — each row keeps the original path; adding that folder later as a source reassigns the row (same path-hash id). View-only assets are in-memory (`Library._ephemeral`) so they are not in All / the grid. Same path already in the library: both zones return that row. 32-file cap, NFC name match, capture-phase drop, overlay hide timeout — same as folders. Image drop onto the annotator while drawing is still a reference picture. Overlay display uses `:not([hidden])` (a later `data-kind` rule had shown the overlay always). Busy file drops queue as separate jobs (mode is not mixed). A lone `.srev` is not POSTed as media.
- **Review:** a fresh reviewer found: OS image drop while drawing on the board or compare still opened the file (→ `dropOnAnnotatorSurface` checks all three annotators and `.canvas-viewport` / `.cmp-stage`); overlay `[hidden]` lost to `[data-kind=folder]` so the tint stayed up (→ `:not([hidden])`); library-zone hit-test vs `min-width: 168px` at UI scale &lt; 1 (→ drop the min-width, JS already uses `--side-w × --ui-k`); view-only text / transcode / model sidecars / USDZ used `get_asset` (→ `resolve_asset`); `.srev` also POSTed as unsupported (→ skip); busy queue mixed modes (→ job list); compare **A** did not promote (→ `cmpToggleAnnot` through `ensureLightInLibrary`). Same reviewer then found leftover `scrub_audio_*` still on `get_asset` and compare A promoting `light.asset` instead of the selected layer (→ `resolve_asset`, `ensureInLibrary(assetById(cmp.selectedId()))`). It confirmed those. No new blocking issues.

## 0.130.0 — 2026-11-25 — Drop folders on the window to add them as sources
- **What:** dropping one or more folders from Explorer / Finder onto the Sight window adds them as library sources (the same as **+ Folder**). A dashed overlay says so while a folder drag is over the window. A `.srev` in the same drop still imports.
- **Where:** app/server.py — `file_uri_to_path`, `drop_folder_paths`, `drop_name_key`, `os_manager_selected_dirs`, `POST /api/sources/drop`; app/static/index.html — `#srcDrop`, `takeDroppedFolders` / `addDroppedFolders` (window `drop` in capture); annotate.js `onRefDrop` lets mixed folder+pictures bubble; tests/test_sources.py `DropFoldersTest`; MANUAL, ARCHITECTURE.
- **Notes:** Chromium does not give the OS path of a dropped folder to the page. The server takes whatever the page could read (`File.path`, `file://` in `text/uri-list` / `text/plain` / `text/x-moz-url`) and matches remaining folder names to the current Explorer (Shell.Application `SelectedItems`) or Finder selection. Two selected folders with the same name are skipped (`ambiguous`) rather than guessing. Dropped *files* are not turned into sources (their parent is not added). Already-indexed folders return `new: false`. Overlay is `pointer-events: none` so the drop still lands on the page. Linux has no file-manager selection hook; `file://` from the drag still works there. Explorer matching runs in `asyncio.to_thread` so PowerShell / osascript cannot stall SSE. Names are NFC-folded (`drop_name_key`) so Finder NFD paths match `File.name`. At most 32 folders per drop (`too many`). Window drop is capture-phase so a folder+image drop on the lightbox still adds the folder. File-only drops with directory entries do not POST. Overlay hides if `dragover` stops (~500 ms) or the pointer leaves the window. A second drop while busy is queued.
- **Review:** a fresh reviewer agent found: Explorer lookup blocked the event loop (→ `to_thread`); overlay could stick and a Chromium drop with no names/paths was silent (→ hide timeout, + Folder toast); folder+pictures on the annotator swallowed the folders (→ capture-phase drop, `onRefDrop` does not `stopPropagation` when a directory is present); file-only URI POSTs, silent 32-cap, busy drop discarded (→ skip file-only POST, `too many`, queue). NFC vs NFD name match added. Same reviewer then found `dropHasFolders(e)` ran after `await getAsFileSystemHandle`, so the uri-list fallback could no-op (→ snapshot `folderHint` / uris in the drop tick). Real Explorer `DataTransfer` still untested in this environment (devtools cannot synthesize a folder drag).

## 0.129.1 — 2026-11-25 — Version off the sidebar name; search folds Cyrillic; Filter is an icon
- **What:** the version number is gone from next to "Sight" in the sidebar (it stays in the window title and in About, the brand icon). The library search box matches names / notes / tags case-insensitively for Cyrillic (and other non-ASCII), so a note "Коммент" is found by "коммент". The top-bar Filter control is always the funnel icon (no "Filter" / "Flt" label); while any condition is on, the funnel is filled with the accent colour.
- **Where:** app/static/index.html (`#verTag` dropped, `renderBuildTag` only sets `document.title`, `#filterBtn` always `icon` + SVG, `renderFilterBtn` toggles `.on` / title); app/library.py `_clause` search uses `ulower` (already registered for the filter builder); tests/test_filter.py `test_search_q_unicode_case`; tests/sg_view_e2e.cjs asserts `#filterBtn.on` instead of `.tl-l` text; docs/ARCHITECTURE.md (`ulower` for search and the filter builder).
- **Notes:** SQLite's `lower()` only folds A–Z, which is why a capital Cyrillic note missed the search; `ulower` is Python `str.lower` (same callback the filter builder already used). The Filter count is in the tooltip, not on the button. The shrinking top bar (`.tl1` / `.tl2`) no longer has a Filter label step.
- **Review:** a fresh reviewer agent found one nit: `docs/ARCHITECTURE.md` still said search used ASCII SQLite `lower()` (→ now `ulower`, same as the filter builder). No leftover `#verTag` / `FILTER_ICON` / `#filterBtn .tl-l`. The same reviewer confirmed the doc fix.

## 0.129.0 — 2026-11-25 — Ctrl+click on the bin deletes every drawing not in a note, on all frames
- **What:** in the annotation toolbar, `Ctrl`+click (Mac: Cmd+click or Ctrl+click) on the bin — touch: a long press (600 ms); keys: `Ctrl+Delete` — deletes every drawing of the file that is not attached to a note, on every frame of a video / view of a model, in one undo step. A plain click still clears only what is on screen (`Shift+Delete`).
- **Where:** app/static/annotate.js — `clearLoose` (next to `clearShown`), the bin's handlers in `buildBar` (long press, Mac contextmenu, click), keyTable row `Ctrl+Delete` (so it is in the "?" list), `e.repeat` guard also on `Shift+Delete`; MANUAL.
- **Notes:** "not in a note" = `!data.note`; reply drawings carry `data.note` and stay; reference pictures (`typeOf === "image"`) stay; drawings of a note still being written have no note yet and go too (spec taken literally; Ctrl+Z brings them back while the file is open — undo is per file). On a board the Ctrl path is the plain clear (a board is nearly all loose drawings, mostly off screen). The long press is touch / pen only, like the eye's, so a slow mouse click is never the file-wide delete. Ctrl+Shift+Delete was avoided: Chromium's clear-browsing-data shortcut. Drawings whose note was deleted (invisible orphans) are kept. Browser (temp library, 4 s MP4, one note with a drawing at 0.5 s, loose drawings at 1 / 2 / 3 s): Ctrl+click, long press and Ctrl+Delete each removed the three loose ones from the server and kept the note's; Ctrl+Z put them back.
- **Review:** a fresh reviewer agent found: the long press also fired on a slow mouse click (→ touch / pen only); on a board it wiped the whole board and everywhere it took reference pictures (→ board = plain clear, pictures excluded); Mac Ctrl+click became a swallowed context menu (→ the contextmenu handler takes it); a stale long-press flag could swallow a keyboard click, and key repeat re-ran the clear (→ `e.detail` check, `e.repeat` guards). The composing note's drawings are deleted on purpose (documented). Its later Mac note (a contextmenu reporting button 2) → the Ctrl press is recorded on pointerdown, a click after that menu is swallowed, the flag cleared on leave / cancel. The same reviewer confirmed every fix and found nothing new.

## 0.128.0 — 2026-11-25 — Ctrl snaps a video scrub to annotated frames; Ctrl+←/→ jump to them; turning moves to held R
- **What:** holding Ctrl while scrubbing a video — dragging the picture (plain or Alt-drag), the video bar's timeline, a sequence's picture or its sequence bar — snaps the playhead to the nearest annotated frame (a timeline mark: a drawing's or a note's frame) within ~10 px of the pointer; nothing that near, it follows the pointer. `Ctrl+←` / `Ctrl+→` jump to the previous / next mark (as `Shift+,` / `Shift+.`, which stay), also outside annotation mode and on into a sequence's other clips. Free turning moved off Alt / Ctrl+Alt (Ctrl+Alt-drag on a video clashed with the snap): **hold R and drag** turns a picture or a video (Shift: 15° steps); while annotating R is the rectangle tool, so it is R + Alt-drag there. Plain Alt-drag on a picture now pans (on a video it still scrubs).
- **Where:** app/static/index.html — `SNAP_PX`, `scrubSnapped`, `scrubSnap`, `seqSnap` (next to `seqTotal`), `rotDown` / `rotHeld`; attachViewer's `claim` (R held, no Ctrl) and `scrub.to(frac, ev)`; `bindVBar` `tAt`; `seqScrubBegin` move; the seq-track move; the key tracker by the keyup handler (k-rot body class, R keydown / keyup / blur); cursor CSS (`.k-rot` rotate cursor, Alt / Shift scrub cursors skip it); the viewer "?" rows; imports `FINE_SCRUB`. app/static/annotate.js — `snapTime(t, tol)` on the instance (nearest `marks()` time → `landAt`), keyTable rows `Ctrl+ArrowLeft/Right` → `jumpMarker` (Video group, so they also run outside annotation mode; dropped on a board, where canvas.js's Ctrl+arrows align); labels of the marker rows. MANUAL, ARCHITECTURE (claim cursor example).
- **Notes:** the snap tolerance is in pointer px turned into seconds per control (viewer drag: the window's width is the clip, ×0.1 with Shift; bars: their own width), so it feels the same everywhere. The snapped time is not fed back into the drag's own position (the sequence drag keeps `drag.T` unsnapped), so releasing Ctrl goes on from the pointer. Snapped landing: the clip on screen lands a quarter into the frame (annotate `landAt`); another clip of a sequence a hair after its stored time (as `seqMarker`). R hold: set on a bare R or Alt+R keydown outside text fields, cleared on any R keyup and window blur; a drag already turning keeps turning if R is let go. Ctrl+R-drag does not turn (Ctrl is the snap). Touch: no Ctrl — a tap on a timeline mark goes to it (unchanged); no touch turn added (Alt-turn had none either). The lightbox's plain arrows / sequence arrows are untouched: annotate.js `onKey` runs before them. Browser check (own port + temp library, 8 s MP4 with marks at 2 s / 5 s, a PNG): Ctrl+→/→/← land on 2.01 / 5.01 / 2.01 without leaving the file; a drag ending 0.06 s short of a mark stays put without Ctrl, lands on it with Ctrl (and Ctrl+Alt); the video bar the same; R+drag turns the video and the picture; Ctrl+Alt-drag on the video scrubs, Alt-drag on the picture pans; annotating, Alt+R+drag turns and draws nothing. Sequence snapping not driven in the browser.
- **Review:** a fresh reviewer agent found no blocking bugs (snap math, seqSnap offsets / clamp, key order, R-hold lifecycle checked). It found: while annotating, R then Alt-drag turned the view but left the Rectangle tool picked (→ the R tracker keeps `annot.toolNow()` from a bare R and the claim puts it back with `annot.restoreTool`); Shift then R is Shift+R (90°), so Shift must come during the drag (→ said in the help row and MANUAL), and Shift+R had no repeat guard (→ `!e.repeat`); stale `k-alt` rotate-hint text in annotate.js / cursors.js / ARCHITECTURE (→ fixed). Accepted: Ctrl+←/→ on a video jumps marks instead of stepping files; compare with its annotator off swallows Ctrl+←/→ as it does , / .; with the select tool a bare R clears the selection (restoring the tool does not bring it back; Alt+R first avoids it). The same reviewer confirmed every fix and found nothing new.

## 0.127.1 — 2026-11-25 — Number pins: dark number on a light pin colour
- **What:** a number pin's number was always white, unreadable on a yellow / white pin. Now it is near-black (#111) on a light fill, white on a dark one. Of the palette, green, yellow and white get the dark number (green pins change too: white on that green was ~2.2:1, #111 ~8.5:1); red and blue stay white.
- **Where:** app/static/review-core.js — new `pinInk(color)` (exported), used for the pin's text prim in `primsOf`; MANUAL.
- **Notes:** one render path for the desktop, the HTML page and the phone (SVG and canvas both draw the prim's `fill`); nothing on the Python side draws pins. The measure is the Rec.709 luma of the sRGB values, as `gridColors` (model3d-core.js) uses for the 3D grid, but not shared code: the grid blends toward the opposite of the backdrop, here it is a two-way pick at 0.6 (WCAG's ~0.18 crossover would turn the red and blue pins' text black), and review-core.js must stay self-contained (no modules). Parses #rgb / #rgba / #rrggbb / #rrggbbaa, rgb() with numbers or %, a few light names; anything else keeps white. The white ring round the circle is unchanged (a white pin on a light picture still has no edge — not done).
- **Review:** a fresh reviewer agent found no bugs; its two gaps (rgb() with %, named colours like "white") are covered. The same reviewer confirmed both and found nothing new.

## 0.127.0 — 2026-11-25 — "?" lists every control of the mode on screen; top bars lose the shortcut text
- **What:** `?` (or a new **?** button: library top bar, viewer top bar, compare top bar — for touch) opens a list of every control and shortcut of what is on screen: the library (plus a Board group when a board is shown), the viewer of a picture / PSD / document, a video, a sequence, a 3D model (splats: fewer rows), the comparison. While drawing, `?` / the button is the annotator's own list (lightbox, compare, board). The viewer's and the compare's top bars now only say "Hit ? for detailed controls description and full hotkeys mapping list" (the per-kind hint strings are gone).
- **Where:** new app/static/key-help.js (`buildKeyHelp`, `showKeyHelp` / `closeKeyHelp` / `keyHelpOpen` / `onKeyHelpKey`, `helpKey`, `isHelpKey`, `keyName`, `HELP_HINT`; CSS `.kh*`); annotate.js `openHelp` / its modal key branch now use it (old `.an-help*` CSS removed, `toggleHelp` exported); compare.js `helpGroups()` (exported on the instance), `.cmp-helpb` → `host.showHelp`, hint constants removed; index.html `syncLightHint`, `lightGeneralRows`, `lightHelpGroups`, `browserHelpGroups`, `openModeHelp`, `#lightHelpBtn`, `#helpBtn`, keydown (`keyHelpOpen()` first; "?" in the compare branch and after `annot.onKey`), canvas `keysEnabled` adds `!keyHelpOpen()`; canvas.js `toggleAnnotHelp`; MANUAL, ARCHITECTURE.
- **Notes:** the lightbox / library / board lists are hand-written rows in index.html (the compare's in compare.js) — a new or changed shortcut there must be added to them (the annotator's list is still generated from `keyTable()`). The shared list is one fixed overlay on `<body>` (z 10000), modal like the annotator's: Esc / ? close, other keys swallowed (Ctrl / Alt / F-keys keep the browser default, and the board's canvas.js handler is off via `keysEnabled`). "?" matches Shift+Slash or the "?" character (German / French layouts); the annotator's own table still binds Shift+Slash only. In the split view (Tab) the library's ? shows the viewer's list (the mode on screen). The list is built when opened; it does not refresh if the file changes underneath (it is modal, so only playback can change it). Browser (isolated SIGHT_HOME, 2 PNG, 2 MP4, 1 STL): every mode's list, Esc closes only the list, buttons open it, annotating → annotation list, phone width (375 px) library list.
- **Review:** a fresh reviewer agent found: the compare's ? button did nothing (`showHelp` missing in the host); Ctrl / Alt keys reached a board's canvas.js handler under the list (Ctrl+Z undid on the board); the library button ignored board annotation (touch users had no way to the board annotator's list, and two overlays could stack); holding ? flickered; ? only by key position (German / French); "Double-click / F: Fit / 100 %" (F only fits); Alt+drag scrub missing for video. All fixed as above; the split-view behaviour kept on purpose. Second round, same reviewer: a held ? still closed the list on the first repeat (→ `helpKey` and the annotator's row ignore repeats), "?" by character never reached a board annotator (→ index.html routes it through `openModeHelp` → `toggleAnnotHelp`, prevented so canvas.js does not toggle again), the library button could stack a list over the board annotator's in the split view (→ `annotModal()` returns first). The same reviewer confirmed every fix and found nothing new.

## 0.126.0 — 2026-11-25 — Number pins editable (both points, text); faster note pictures for stills
- **What:** a selected number pin (select tool) has a handle on each point: the square moves the point pinned, the round one (just outside the circle, away from the line) moves the circle; a pin with no line has the square on its rim to pull one out, dropping it back on the circle removes the line; Shift keeps the line horizontal / vertical. A *Number…* button in the styles bar (touch) opens the pin's field, like a double-click; an existing pin's field takes any short text (`inputMode` text). Notes panel on a still picture: the cards show one scaled-down copy of the picture instead of the full file each.
- **Where:** app/static/review-core.js — `xfHandles` (one pin: `pa` / `pc`), `xfDrag` (pa / pc branch), `XF_CURSOR`; review-draw.js `roundItem` rounds `ax` / `ay`; annotate.js — `dragHandle` (2 px threshold), `renderProps` / `bindProps` (`pinnum`), `editPin` inputMode, new `stillPic` / `makeStill` used by `previewBox`; MANUAL.
- **Notes:** the still copy is a JPEG over black (short side 720, long ≤ 2400) made once per picture URL from the lightbox's decoded `<img>` (canvas `toBlob`), cached in `STILL`; cards made before it is ready (`img[data-still]` inside `S.ui`) are switched over; a picture already ≤ 1.25× that size keeps the file. Not done: the last blob is not revoked when the annotator moves to a video / closes (one per instance, replaced on the next picture). Video frames / 3D stills were already small (0.113). `pc` moves the circle by the pointer's travel (its handle is off-centre). Several pins selected: no handles (as before). The HTML page / phone get the pin handles through review-core but have no pin tool or label field. Browser (6000×4000 PNG, 13 notes): the card picture is a 1080×720 blob; pa / pc drags move one point each and are saved; *Number…* set "A1"; a 1 px-jitter click changes nothing.
- **Review:** a fresh reviewer agent found: handle drags had no move threshold, so a tap on a pin handle made a stub line / nudged the circle (→ 2 px threshold in `dragHandle`); *Number…* used the item object from the last props render (→ looks the live one up); the `pc` handle on the circle's centre covered small pins and the number, and took over the whole-pin move (→ moved outside the circle); `ax` / `ay` not rounded on the page (→ added); the blob switch-over queried the whole document (→ scoped to `S.ui`). The same reviewer confirmed all fixes and found nothing new (the unrevoked last blob judged not worth handling).

## 0.125.1 — 2026-11-24 — A picture dropped while annotating no longer joins the comparison
- **What:** with the library beside the lightbox (Tab) and annotating on, dragging a picture from the grid onto the frame added it as a reference picture and also made it a compare candidate (⧉ said "Compare these 2 files"). Now the drop only adds the reference picture; the library selection goes back to what it was before the drag. With annotating off the drop still adds the file to the comparison, as before.
- **Where:** app/static/index.html — `cardDrag` (the live tile drag), `restoreDragSel`, `finish()` in `ensureCard` (honours `d.restoreSel`), host hook `refsDropped`; app/static/annotate.js — `onRefDrop` calls `host.refsDropped?.()` when it takes library ids.
- **Notes:** root cause: a tile drag selects the dragged tiles and keeps that selection when a target takes the drop; beside the lightbox `lightCompareIds()` counts the library selection as the comparison set while `light.cmpStack` is empty. The drop is fine on its own — it is the selection side effect. Backlog 4 (smart collection) re-checked, still not reproduced — one lead noted in PLAN-desktop-ui.md (the search box stays on and is ANDed with the smart rule). 15 / 16 still wait for the owner's details.
- **Review:** a fresh reviewer agent found no bugs (checked drop / dragend / detached-tile order, annotating off, collection / board drops, OS files, overlapping drags). Its note: a video-only drop while annotating added nothing but kept the drag's selection, so the video became a compare candidate (→ `refsDropped` is called for any library ids taken while annotating). Left on purpose: a tile already selected before the drag stays selected (the user's own pick), and the touch way (*Library selection → add*, `addSelectedRefs`) keeps the selection — there the user selected the files themselves. The same reviewer confirmed the follow-up.

## 0.125.0 — 2026-11-24 — Compare and sequence become modes of the viewer
- **What:** viewing more than one file, the lightbox's top bar has **One · Sequence · Compare** (the same switch in the compare's bar): the same set one at a time, back to back (videos), or side by side, switching in place. `Space` over one of 2+ selected images / videos now opens the viewer on that set (videos only still start a sequence, as before). Compare opened beside the library (Tab) takes the viewer's place instead of covering the library. Compare's ⤢ keeps the set. Compare's bar wraps instead of squeezing labels when narrow.
- **Where:** app/static/index.html — `VMODES`, `paintModes`, `paintLightModes` (from `paintCmpBtn`), `switchViewMode`, `lightShowSet`; `lightCompareIds` also counts a sequence's clips; `openSequence` / `endSequence` repaint (and restore the title); the Space handler seeds the set; CSS `.vmodes`, `body.light-split .cmp`; compare host `openInLight(a, ids)`, `paintModes`; app/static/compare.js — `.cmp-modes` slot painted in `build()`, ⤢ passes the layer ids, `.cmp-bar` wraps; MANUAL.
- **Notes:** the set is `light.cmpStack` (+ the sequence's list); its order and its file objects are kept in `light.vset` (`lightSetAssets`) while it still matches — the switch passes files, not ids, since a compare can hold versions / downloads that are not in `state.items`; coming back from a compare with the same files keeps the lightbox's order. Moving the viewer to a file outside the set drops it (unchanged rule). K: with a set (also one from Space over a selection) it compares the set — versions / a note's stored comparison are reached from a single file, as before; in a sequence K still goes to versions (the switch's Compare compares the clips). A tile click beside an open compare only selects. Sequence from the switch starts (playing, at 0 — the compare's playhead is not carried) on the current file when it is a video, and keeps the set's pictures; going there reopens the lightbox (`openSequence`), so the position in a previous sequence is not kept. The lightbox bar now wraps on a narrow screen. *One* from a compare shows the selected layer. Not done: a sequence of pictures (stills with a duration), compare drawn inside the lightbox element itself (it is still the compare overlay, placed over the viewer). Backlog 18–21 are done with this.
- **Review:** a fresh reviewer agent found: a tile click beside an open compare swapped the lightbox's file behind it (→ only selects); *One* / Sequence lost files that are not in `state.items` (versions, downloads) (→ the switch passes file objects); the set's order was scrambled on every switch (→ `light.vset`, sequence clips first); K in a sequence lost versions (→ `lightCompareIds` does not count the clips); Sequence from a later layer opened paused (→ plays); the lightbox bar pushed ✕ off a phone screen (→ wraps, 36 px touch buttons). Follow-up: ⤢ skipped the order check (→ goes through `switchViewMode`). The same reviewer confirmed every fix and found nothing new. Browser: set clip1, clip2, img1 — One → Sequence → Compare → One → K → Sequence → One; a sequence on clip 2 → One → Sequence stays on Clip 2/2 and plays; compare beside the library starts at the divider.
