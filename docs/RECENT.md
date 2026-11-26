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

## 0.141.6 — 2026-11-26 — R0a block 2: the write queue is keyed by the store
- **What:** the annotator's durable write queue keeps its localStorage keys under the store's own prefix, so a
  page of another host (Coreline: one prefix per host and user) never replays Sight's queue or another user's.
  Sight keeps its keys: `sight-annot-outbox:v2:<window>`, plus the old v1 key. Behaviour of Sight is unchanged.
- **Where:**
  - `annotate.js`: `obStart(store)` from the first `createAnnotator` (the window key, adopting closed windows'
    queues, the 1.5 s drain, `RC.setImageSource`); `OB.prefix` / `OB.legacy` / `OB.key` from `store.queue`.
  - `sight-store.js`: `queue: {prefix: "sight-annot-outbox:v2:", legacy: ["sight-annot-outbox:v1"]}`.
  - New `tests/r0a_host.html` (a host page that is not Sight, with a fake store that records every call),
    `tests/r0a_store_e2e.cjs`, `tests/test_r0a_store.py`. Later R0a blocks add their checks there.
  - `docs/ARCHITECTURE.md` "Annotator store": `queue`.
- **Notes:**
  - The page listeners (pagehide beacon, visibilitychange, pageshow, the 5 s / 60 s timers) stay registered at
    import, guarded until a store started the queue. Do not move them into `obStart`: index.html's own pagehide
    (settings, keepalive) would then run first and could take the page's keepalive budget before the beacon.
  - A prefix must end with ":"; a key is adopted only when what follows the prefix holds no ":" (a window id), so
    a longer prefix of another user (`…:u1:x:`) is never taken. Hosts encode the parts they put in a prefix.
  - One store object per page: a second `createAnnotator` with another store throws (index.html passes one
    `annotStore`). No `store.queue` = `annot-outbox:<store.kind>:`.
  - Adopting other windows' keys now happens at the first `createAnnotator` (after index.html's settings fetch),
    not at import; nothing is sent earlier than before.
- **Review:** a fresh agent found no regression for Sight. It found:
  - (medium) a prefix that begins another user's prefix would adopt that user's queue. Fixed (the ":" rule above,
    with a test);
  - (low) a second store with the same prefix was silently accepted. Fixed (identity check, with a test).

  The same reviewer confirmed both fixes and found nothing new. It noted that window ids must never hold ":"
  (random hex + `Date.now` hex today): the ":" rule depends on it.
- **Suite** (Linux, SIGHT_REQUIRE_E2E=1): `test_r0_lightbox`, `_annotate`, `_review`, `_views`, `test_r0a_store` pass, except
  R0Export's PDF check (fails the same way on origin/master here, see 0.141.5). `test_r0_review` re-run after the fixes.

## 0.141.5 — 2026-11-26 — R0a block 1: the annotator talks to the server only through `host.store`
- **What:** a refactor; Sight behaves the same. annotate.js has no `/api/…` URL, no `fetch()` of Sight's API, no
  `localStorage` read of a setting and no `/static/` import left. It is the first block of R0a (docs/PLAN-coreline.md).
- **Where:**
  - new `app/static/sight-store.js` (`createSightStore({api})`): every call the annotator made, with the same URLs,
    methods, headers and bodies: rows, review state, versions, fps (parsed from `/info` there), media URL,
    playback conversion, shots, stored note previews, exports, import, the tracker link ▾, dictation.
  - `annotate.js`:
    - `host.store` is required;
    - the queue sends through `OB.store.writeRow(req, extra)` (`obReq` now builds `{op, id, body}`);
    - settings are read with `host.getSetting` (falls back to localStorage), the author comes from `host.author()`;
    - imports are relative (`./keys.js`); also in `key-help.js` and `dictation.js`;
    - trackers-core / shotgrid-core / dictation / video-playable are no longer imported here;
    - optional store members, when missing, hide their control (exports, import, the mic, link ▾, versions).
  - `index.html`: one `annotStore` and one `annotBase` (store, getSetting, putSetting, author) for all three
    annotators; their `api` is gone.
  - `docs/ARCHITECTURE.md`: "Annotator store" (the members and the queue's store contract).
- **Notes:**
  - One store per page: the write queue takes the first one and sets `RC.setImageSource(store.shotSrc)` (it was set at
    module load). Adopted outbox writes still go out 1.5 s after the start (`obKick(1500)` on the first store).
  - `getSetting` must stay a function declaration: S's initializer reads settings before the line it sits on.
  - The pagehide beacon still calls `fetch(…, {keepalive: true})` synchronously inside the handler.
  - The queue's error message is now `<op> <id>: <status>`; obDrain only tests its shape (an HTTP answer vs none).
  - Not done here: the queue keyed per store, stamps in puts, "apply rows by id", CSS tokens (next R0a blocks).
- **Review:** a fresh agent compared every replaced call with the old code. It found:
  - (high) `getSetting` was a `const` declared after S's initializer, so every startup setting read hit the TDZ, was
    swallowed by `readJSON`'s catch and returned the default (styles, stamp, panel state…), and the next style change
    would have written the defaults back. The R0 settings test caught it too. Fixed (function declaration);
  - (low) adopted writes went out at 0 ms instead of 1.5 s. Fixed.

  The same reviewer confirmed both fixes and found nothing new.
- **Suite** (Linux, SIGHT_REQUIRE_E2E=1, every test module): every R0 test passes except R0Export's PDF check, which
  fails the same way on a clean origin/master here (the PDF build; `test_review_all.test_pdf_all` is the known twin).
  Otherwise the known failures only: `test_pwa` ×4, `test_annot_tools.test_tools`, `test_review_page.test_cut_copy_paste`,
  `test_sources.test_file_uri_to_path`. 2 skips by design (macOS / Windows launchers).

## 0.141.4 — 2026-11-26 — R0-0 block 5: regression tests of the board, compare, sequence, exports, trackers and the look
- **What:** the last block of the R0-0 safety net (docs/PLAN-coreline.md). No app code changed (only the version).
  It is also the first R0 run on Windows: blocks 1–4 pass there too, after the two environmental fixes below.
- **Where:** `tests/test_r0_views.py` runs four page scripts. Each script's header lists its checks:
  - `r0_board_e2e.cjs`: the board's annotator (Shift+A, the button, Esc). A stroke and a note are board rows in world
    units, drawn on a moved and zoomed camera, and the camera moves them. The item keys are held back while drawing;
    with it off, plain A frames. Undo / redo, the notes button, the library split (Tab, ◧). Touch: a tap, a two-finger
    pan + pinch, a finger stroke.
  - `r0_compare_e2e.cjs`: compare from the selection (the button, K). Layouts 1–4, Swipe, Difference, ↑ / ↓, H, the
    chips. A stroke and a note made in compare go to the selected file; the note keeps `data.compare`, and K in the
    lightbox brings that session back. A card dropped from the split onto the lightbox joins the set (⧉ counts 2).
    The sequence: bar, title, ← / →, ⏮ / ⏭, Shift+L, a click on the track. Touch: long press, the touch bar's Compare
    and Play in sequence, the buttons.
  - `r0_export_e2e.cjs`: from Export ▾, PDF, web page (opened in a browser), `.srev` (format, asset id and name,
    author, rows, points in picture px) and Copy as text. An edited `.srev` imported back (a reply, a new note), then
    again (nothing doubled). The ShotGrid link ▾ against `sg_fake_server.cjs`: the pick view, project, search, link,
    Sync now ("1 sent", `data.sg`), Unlink. Touch.
  - `r0_ui_e2e.cjs`: Interface Scale 0.75 / 1 / 1.75 (`--ui-k`), the bars' sizes and their placement on screen. The
    Light theme, kept across a reload, then Graphite. A text snapshot, `tests/r0_ui_snapshot.json`, of the top bars,
    the lightbox / video / sequence / compare bars, the annotator's bar, the review panel and every mode's `?` list.
    Touch at 1.75×.
- **Notes:**
  - **Windows (environmental, tests only):**
    - Playwright's own Chromium on Windows has no H.264, so every MP4 stayed black and blocks 1–4 failed at
      `waitMedia`. `r0_lib.cjs` now launches Edge on win32 (`channel: "msedge"`, the browser Sight.py opens there);
      `SIGHT_PW_CHANNEL` overrides it (`""` = Playwright's Chromium).
    - `run_page` decoded node's output with the ANSI code page and crashed on some bytes; it now reads UTF-8.
    - With both fixes, blocks 1–4 pass on Windows unchanged: no font or file-order differences showed.
  - Tools on this machine: ffmpeg is `imageio_ffmpeg`'s binary (already in `~/.sight/runtime`), put on PATH as
    `D:\AI_dev\.testbin\ffmpeg.exe`. The `playwright` npm package (1.56.1, matching the cached browsers) lives in
    `D:\AI_dev\node_modules`, outside the repo; node finds it by walking up from `tests/`.
  - R0Export patches `app.review.export_dir` to a temp folder and `app.server.reveal_paths` to a no-op, so nothing
    lands in the real Downloads and no Explorer window opens. Class cleanups undo the patches and stop the fake ShotGrid
    even if set-up fails.
  - Pinned as they are, not bugs:
    - a board opens with the library beside it (`canvasSplit` on);
    - Stack with Swipe on (the default) is written `"swipe"` in a note's `compare`;
    - the review panel is not zoomed by the Interface Scale (320 px at every scale);
    - at 1.75× the annotator toolbar and the compare bar wrap onto more lines (only "at least scaled" is checked).
  - The snapshot leaves out file names, times, the RAM figure and the dictation chip (it shows the browser's
    language). Rewrite it with `SIGHT_R0_UPDATE_SNAPSHOT=1` only on purpose. R0e must leave it unchanged.
  - The tracker link ▾ on Coreline is still covered by `cl_view_e2e`, and the SG ▾ show / hide by `trackers_e2e`. The
    ZIP export is covered by `test_review_all`.
  - Board touch: a tap on the annotate button right after a finger stroke brings no click. This is PLAN.md "Found by
    the R0-0 regression tests" item 6, already known; the script waits 0.6 s.
- **Review:** a fresh agent reviewed the block and ran four app-code mutations:
  - compare's `noteExtra` returning null: caught;
  - board rows in viewport px: caught only by the camera check;
  - the `.srev` author dropped: not caught;
  - plain A toggling the board annotator: not caught.

  It found five problems, all fixed:
  - the px checks were circular: page px came from the annotation layer's own transform. Now they come from the card
    box, the compare `<img>` and the lightbox media box, and the board strokes are drawn on a moved and zoomed camera;
  - the `.srev` author and asset id were not checked;
  - "plain A frames" was not checked;
  - the second import waited a fixed 1.5 s; it now waits for the `/api/review/import` response;
  - R0Export could leak its patches and the fake ShotGrid if set-up failed.

  The same reviewer re-ran the mutations and confirmed every fix. Each mutation is now caught by a named check: the viewport-px
  board rows by the four world-units checks too.
- **Suite** (Windows, SIGHT_REQUIRE_E2E=1, 182 tests, 5 skipped by design): every R0 test passes (blocks 1–5).
  12 older tests fail. None is from this block, which changes no app code:
  - the R0Export flake found by this run is fixed: the picture re-fits a moment after the panel shows, so the script
    now waits 0.6 s of stillness before aiming;
  - known before: `test_pwa` ×4, `test_annot_tools.test_tools`, `test_review_page.test_cut_copy_paste`;
  - Windows-only, in older tests, environmental:
    - `test_coreline.ConfigTest.test_store` expects POSIX mode 0o600 (NTFS gives 0o666);
    - `test_review_page.test_two_clips`, `test_pwa.test_bundle` and `test_trackers.test_js_settings_form` read node's
      output with the ANSI code page, so "—" / "·" arrive garbled (the same fix as `run_page`'s would do);
    - `test_pwa.test_touch` and `test_export_extent.test_page` were not looked into.

    These tests launch Playwright's own Chromium (no H.264 on Windows). `test_review_all.test_pdf_all` and
    `test_sources` pass here.

## 0.141.3 — 2026-11-26 — The drop-zone test reaches the real drag handler
- **What:** `test_sources.DropFilesE2E` failed on a clean master with `dropKind is not defined` since 0.135.2. A stale
  test, not an app bug: dropping files works. Only the test changed (and the version).
- **Where:** `tests/drop_files_e2e.cjs`.
- **Notes:**
  - `dropKind()` lives in index.html's `<script type="module">`, so it is not on `window`. The app's own capture
    `dragenter` / `dragover` handler (`onOsFileDrag`) calls it from the same module and works. The test called it
    from `page.evaluate`, which cannot see module-scoped names.
  - The test now dispatches fake drag events on `document.body`: a plain `Event` with `dataTransfer`, `clientX` and
    `clientY` defined on it. It reads what the real handler did: `#srcDrop` hidden, `data-kind`, `data-hot`, and
    `defaultPrevented`. It covers the same seven cases as before (octet-stream, empty type, image, a real file entry,
    a folder entry, no items, a Sight-internal drag) and also pins the zone split (x 40 = library, x 900 = view) and
    that the drag is accepted.
  - Deliberately not done: exposing `dropKind` on `window` just for the test.
  - A mutation that puts back the pre-0.135.2 rule (an entry-less item counts as a folder) fails the test.
  - Checked by hand with Playwright on a temp library, using a real `DataTransfer` and `DragEvent`s. An untyped
    `.mkv`, an octet-stream `.exr` and a `image/png` each got the overlay (kind `file`, zone by X). Each drop was
    accepted and posted `/api/files/drop` with the matching `mode`.
  - `test_sources.DropFoldersTest.test_file_uri_to_path` still fails on Linux: it expects a Windows path. It is
    unrelated and was left as is.
- **Review:** a fresh agent found no bugs. It ran seven mutations of the drag path and six were caught. The seventh,
  `unknown` dropped from `dropKind`'s "file" condition, changes no behaviour because the `osFileDrag` fallback still
  answers "file".
  - It noted one gap: nothing pinned that the window listener is a capture one, so a child that stops `dragover`
    cannot block the drop. Now covered by the `stopped` case: the probe is dispatched on a child that calls
    `stopPropagation`. A non-capture `dragover` listener fails that case.

  The same reviewer confirmed the fix and found nothing new.
- **Suite:** `test_sources` passes apart from `test_file_uri_to_path`. Every R0 test passes with SIGHT_REQUIRE_E2E=1
  (`test_r0_annotate`, `_lightbox`, `_review`, `_3d`). They need psd-tools and usd-core, installed here with pip.

## 0.141.2 — 2026-11-26 — R0-0 block 4: regression tests of the 3D viewer
- **What:** the fourth block of the R0-0 safety net (docs/PLAN-coreline.md): the lightbox's 3D viewer as it is
  before R0c. No app code changed (only the version).
- **Where:**
  - `tests/test_r0_3d.py` + `tests/r0_3d_e2e.cjs` cover (the script's header lists every check):
    - open, F, zoom / dolly / pan / orbit, explode (slider, Ctrl+right-drag), shading (Shift+1…6, the buttons);
    - turns and saved views per asset, through the server;
    - `.usdz` with and without the server's conversion;
    - an FBX texture through `/api/model-res`;
    - a splat;
    - a note on a 3D view (its `ctx.vk`, a pick goes back to it);
    - touch.
  - Harness and fixtures:
    - `needs(usd=True)`: usd-core (`pxr`) is needed for the server's conversion, installed here with pip;
    - `tests/fixtures_3d.make_glb(at=…)` places the two boxes (default unchanged);
    - the test file writes a textured ASCII FBX. Three's FBXLoader takes the texture's name from a `Video` node
      connected to the `Texture`: without one it asks for nothing.
- **Notes:**
  - The picture is read back from a screenshot (red / blue / green pixel boxes, above the shading bar, whose buttons
    are coloured too). `still()` waits until two frames agree, since camera moves ease.
  - **F frames the model from the current side** (`frameBox` keeps the direction). So after an orbit F does not
    return to the opening side, and the opening framing differs from F's (a tighter fit). Both are pinned as they
    are. A reopen shows the opening side again.
  - Shift+7's quarter turn about X is invisible on two boxes along X (a cube maps onto itself). The turn checks use
    `m_step.glb`, whose blue box is raised.
  - In 3D, A flies left (WASD): annotating is toggled with `#annoBtn`.
  - A page that already has an FBX cached from its grid thumbnail may not ask for the texture again. The FBX case
    runs in a fresh page.
  - PSD (layers, preview) was covered in block 1.
  - `makeCameraRig`'s header comment (index.html, "frame-all (F) back to the framing the model opened with") holds
    only for splats; a mesh's F keeps the side. A stale comment, not changed here.
  - One run takes about 13 min here (SwiftShader); `run_page` allows 30.
- **Review:** a fresh agent reviewed it in one round, with mutations:
  - The mutations were: camera save without `turns`, the explode slider's onChange emptied, the USDLoader fallback
    replaced by a throw, `setModelTurns` not saving, the model manager's URL modifier removed. All were caught.
  - It found no bugs and six gaps, all fixed:
    - a view saved at one turn and recalled at another was never tried (now: three more turns, then 1 brings the
      turn back);
    - the explode thresholds had a 1 px margin (now 10 px; the mutation moves 0 px);
    - Normal / Vertex / wire / X-ray checked only the button (now: the picture changes);
    - an orbit could not be told from a pan (now: the boxes' gap must change, as a pan keeps it);
    - the timeout was near the run time;
    - the `.usdz` check counted the corner controls (now: the margins are ignored).

  The same reviewer confirmed every fix. It re-ran a recall that ignores `cam.turns`, and the new checks caught it.
  Still uncovered: a note picked after a turn (`setView`'s turn line), and the splat's own turn.
- **Suite** (SIGHT_REQUIRE_E2E=1, with usd-core): every R0 test passes. The same 9 failures as in 0.138.1 (R0-0 block 3), none from this
  block: `test_pwa` ×4, `test_review_all.test_pdf_all`, `test_annot_tools.test_tools`,
  `test_review_page.test_cut_copy_paste`, `test_sources` (`DropFilesE2E`, `file_uri_to_path`).
- **Block 5 handoff** (the last R0-0 block; the owner runs it from a local session):
  - What is left, per docs/PLAN-coreline.md R0-0:
    - board annotations, compare (incl. dropped files), sequences, the library split (Tab);
    - `.srev` / HTML / PDF export and import;
    - the tracker link ▾ with the fake ShotGrid server (`tests/sg_fake_server.cjs`) and Coreline's fake
      (`tests/cl_fake_server.cjs`, docs/CORELINE.md);
    - UI scale 0.75× / 1.75× (`--ui-k`), light / dark;
    - a text snapshot of the bars, the panel and the `?` lists;
    - shortcuts and the touch path of each mode.
  - Some of this is covered by older tests; check before writing new ones: `test_board_annotations`,
    `test_review_page` / `_bundle` / `_all`, `sg_view_e2e`, `trackers_e2e`, `cl_view_e2e`, `drop_files_e2e`.
  - The harness:
    - reuse `tests/r0_harness.py` (`LiveCase`, `run_page`, `needs`) and `tests/r0_lib.cjs`;
    - `SIGHT_REQUIRE_E2E=1` makes a missing tool a failure;
    - `SIGHT_R0_REPORT=<dir>` writes each script's JSON report.
  - Needed:
    - node with Playwright, ffmpeg, psd-tools, usd-core.
  - Lessons:
    - poll, never wait a fixed time for a debounced write (300–400 ms timers);
    - a click on an element the app may hide by itself can time out quietly;
    - read storage from a non-app same-origin page (`/api/settings`) when app pages' timers could interfere;
    - `isVisible()` ignores overlap: use `elementFromPoint` to tell whether the library split is shown.

## 0.141.1 — 2026-11-26 — Single-video scrub follows the compare
- **What:** a clip of a few seconds gets a short-GOP scrub copy as soon as it opens. A drag shows that copy, and the full file is sought once when you let go. The green on the timeline is unchanged: it is the part of the file actually in RAM (one painter, shared with compare). A file that fits the cache budget still turns the whole line green, and that is not a sign the seek is instant.
- **Where:** `app/static/video-cache-bar.js` (`cacheBarHtml`), `index.html` (`loadScrubCopy` from `onReady`, `seekVideo`, `endScrub`), `compare.js` (the lane uses the same painter), `MANUAL.md`, `docs/ARCHITECTURE.md`.
- **Notes:** the copy is asked only when the file already has a picture (`videoWidth`) and is at least 3 s. The proxy is created with no `src`; a drag sets it, and after the full file presents the frame `src` is cleared, so a hidden copy does not hold a hardware decoder. Until the copy can show a frame the full file is still seeked, so the picture does not sit still for the whole encode. Two slow seeks during a drag still ask, if the open-time ask did not run. `endScrub` queues the full-file seek before `settleScrub`: the timeline calls `seekVideo` while the drag is still on, and a picture drag only calls `endScrub`. The solo RAM budget and `stream()` are unchanged. `start`/`end` without a `spans` array draws nothing.
- **Review:** pending.

## 0.141.0 — 2026-11-26 — Tracker grid keeps what it downloaded
- **What:** a ShotGrid or Coreline project you already opened comes back at once, and only Versions that changed on the site are updated in place. Switching project or type no longer clears the grid and asks for every page again. The source row shimmers while Sight is connecting and turns red when the site does not answer; it stays until you disconnect it. A window full of thumbnails no longer makes the packaged app quit and show "Failed to fetch".
- **Where:** `app/static/tracker-view.js` (merge by id), `tracker-source.js` (the view cache, IndexedDB `sight-tracker-views`), `shotgrid-core.js` / `coreline-core.js` (`since`, retired), `index.html` (paint the cache, three thumbnail sockets, the source row), `app/server.py` (the event stream keeps the window alive), `Sight.py`.
- **Notes:** the cache key is tracker + project + type + entity + status + search + filter, not the ticked fields — a new field is read onto the rows already stored. A read keeps the view it started with, and one view's delta and next page run one after another, so a switch cannot file rows under the wrong key or drop a page. A row older than the pages loaded so far is not pulled up into them. A retired read that echoes the active rows removes nothing. A site that refuses "changed since" (HTTP 400) keeps the cached rows. The event stream refreshes the packaged watchdog every second, because Chromium allows six connections to localhost and the thumbnails used to hold all of them. A thumbnail waits until its tile is in the document, then takes one of three slots.
- **Review:** pending.

## 0.140.1 — 2026-11-26 — Guides: 2- and 3-point lines meet, not at the picture's corners
- **What:** 2- and 3-point guides no longer fan across the four corners of the picture. Inside the file that fan was
  the same even star for every point, so the lines ran parallel and never met. Outside, the outermost lines ran
  through the picture's corners, as if the corners were vanishing points. Lines now pass through the other vanishing
  points and through two station rows they share, inside or outside the picture.
- **Where:** `app/static/guides.js` (`linesForPoints`, `linkedLines`, `stationRows`; `drawPersp` uses them);
  `tests/guides_persp_e2e.cjs`; `MANUAL.md`, `docs/ARCHITECTURE.md`.
- **Notes:** 1-point is unchanged (a star inside the picture, the picture's corner angle outside). The station rows
  sit inside the picture, off the horizon and off the handles. A station line that would pass through a picture
  corner is skipped when the line is aimed at that corner (about a degree), including when the corner lies behind
  the sample. A handle near a corner keeps the rest of its fan. Lines through the other vanishing points are never merged.
  Samples the points can share are drawn by all of them; a point that has run out of spread does not shorten the
  others, and each point still fills its own count. A handle outside the picture is drawn out to the end of its
  own lines; two handles whose joining line misses the picture are still joined.
- **Review:** a fresh reviewer found three holes: a handle a few pixels from a media corner lost every station line (every ray counted as hitting that corner); point 3 dropped the line through the second horizon handle when the two handles subtended under 0.012 rad; above the old 34-sample grid the slider count was not drawn and the three points diverged. Fixed: a corner counts only when the line is aimed at it (about a degree); lines through the other vanishing points are never merged; 81 samples per row, then each point fills its own count after the shared ones. The same reviewer then found two more: a corner behind the sample still lay on the full chord, and a far handle's angle gap capped every fan. Fixed by testing the whole line, and by a 5e-4 rad duplicate gap so one point cannot shorten the others. It then found the corner-exemption disk was too small, so a handle just outside it collapsed again. Fixed by the angle test above. The same reviewer confirmed that and found no new correctness bug. A handle a few pixels from a corner can still have one chord end within a pixel of that corner; the rest of the fan stays.

## 0.140.0 — 2026-11-26 — Guides: one Perspective item, real 2- and 3-point
- **What:** the Guides menu has one **Perspective** item with a 1 / 2 / 3 count beside it (a count turns it on; the
  item toggles it and keeps the last count). 2-point: both vanishing points sit on one dashed horizon; moving either
  up / down, or dragging the diamond on the horizon, moves both. 3-point: the same two plus a zenith / nadir point,
  kept at least 5 % of the height off the horizon. Lines still radiate from each point with their own count.
- **Where:** `app/static/guides.js` (`isPersp`, `rec.np`, `pointsFor` evening-out, `keepOffHorizon`, `moveVp`
  horizon drag `i = -1`, `drawPersp` horizon line + tab, the menu); `app/static/index.html` help text;
  `tests/test_guides.py` (seeds a 0.138 entry) + `tests/guides_persp_e2e.cjs`; `MANUAL.md`, `docs/ARCHITECTURE.md`.
- **Notes:**
  - Stored modes stay "1" / "2" / "3" (`sight.guides`), so 0.138 entries load and 0.138 can still read new ones; old
    2- / 3-point points at different heights are shown on their mean height (rewritten on the next drag). `np` is a
    new field (the last count).
  - Whatever is dragged gives way: dragging point 3 keeps it off the horizon; dragging the horizon (or point 1 / 2)
    toward point 3 makes the horizon jump past it.
  - The horizon line takes no presses: only its tab (halfway between points 1 and 2, slid into the window when that
    is off screen; its cursor follows a turned view). 1-point has no tab: its point moves the horizon.
  - Not done: vertical guide lines for 2-point (verticals are simply not drawn as a fan).
- **Review:** a fresh reviewer found no correctness bugs. It found that a full-width horizon hit band ate pen strokes,
  pans and pinches that started on that row (now a small tab), a fixed `ns-resize` cursor that was wrong on a turned
  view (now per angle), plain buttons inside the `role=menu` (now `menuitemradio`), MANUAL wording for 1-point, and
  test gaps: the Esc check only read storage (now the points on screen), no turned-view case (added), a touch drag
  that grabbed near point 3 (now the tab). The same reviewer confirmed every fix and found nothing new.

## 0.139.0 — 2026-11-26 — Guides: rulers outside the picture, Ctrl+click delete, Shift+H
- **What:** the grid's rulers lie just outside the picture's top / left edges, reach out to a guide dragged past the
  picture, and stay inside the window when zoomed in. Ctrl+click a guide (long-press with a finger) deletes it.
  Shift+H and the eye hide / show the guides with the drawings; the eye shows whenever guides are on. Snap sits to the
  right of Grid in the menu.
- **Where:** `app/static/guides.js` (`rulerFrames`, `rulerAt`, `overRuler` in view px, `deleteGuide`, the long press,
  `hooks.hidden` / `reveal` / `onModeChange`, `active()` / `refresh()`); `app/static/annotate.js` (`eyeSubject`,
  `toggleHidden` → `host.onHiddenChange`, API `hidden` / `setHidden` / `repaintEye`); `app/static/index.html` (the hooks
  both ways, help text); `tests/test_guides.py` + `tests/guides_e2e.cjs`; `MANUAL.md`, `docs/ARCHITECTURE.md`.
- **Notes:**
  - Deliberate: at Frame fit a picture touches the window on one axis (`fitS` has no margin), so that ruler is clamped
    into the window and lies over the picture's edge there. Goal 3 (stay in the window) wins. Not done: a fit margin
    while the grid is on.
  - Picking a guide mode while the eye hides things shows both again (one state).
  - Touch: a press that moves less than 10 px (mouse 4 px) does not move or re-snap the guide, so a tap opens its field
    and a 550 ms hold deletes it.
  - The board / compare annotators do not pass `hasGuides`; their eye is unchanged.
- **Review:** a fresh reviewer found: (1) the drag-to-delete test read the rulers as last drawn, so a fast flick onto
  the ruler past its old end did not delete; the rulers are now rebuilt before the test. (2) The fit-covers-ruler case
  (kept, see Notes). (3) The toast said "Guides" on the board / compare eye with nothing drawn; now "Drawings" when no
  guides. (4) A report export flipped `S.hidden` without telling the guides; it now calls `onHiddenChange` on restore.
  (5) The long press needed a perfectly still finger; touch now has a 10 px still zone. Tests added for drag-back,
  the flick, the left ruler stretching and a 90° turn. The same reviewer confirmed all fixes. It also noted (older
  behaviour) that a tap on an existing guide where it crosses a ruler deleted it; now delete-on-ruler needs a real drag
  (or a fresh guide); confirmed by the same reviewer.

## 0.138.1 — 2026-11-26 — R0-0 block 3: regression tests of the write queue, settings, shots, previews, dictation
- **What:** the third block of the R0-0 safety net (docs/PLAN-coreline.md). It pins what the annotator's plumbing does
  now. No app code changed (only the version).
- **Where:** `tests/test_r0_review.py` runs two page scripts on one temporary library:
  - `tests/r0_queue_e2e.cjs`:
    - offline → kept → online → saved: a create, a change and a create-then-delete wait in this window's
      `sight-annot-outbox:v2:<window>` key (one entry per row), the badge counts them, the server has none; a reload
      while offline keeps them (the pagehide beacon tried all three and failed; the new window adopts its own old key
      and the layer shows the queued state); the badge's click sends them once each (no duplicate, the deleted one
      never created, the outbox and badge gone);
    - nothing revived, both paths pinned by the logged URL: a change of a row another window deleted goes in
      `/api/annotations/batch` (skipped, no note); one queued offline until the batch failed twice goes alone as
      `PATCH /api/annotations/<id>` (404: the refused note). The row stays a tombstone either way;
    - a second window: a live window's outbox is left alone; a frozen one (a CDP debugger pause: its timers stop,
      checked by its stamp staying stale) is adopted and sent by the next window; the frozen one, woken, drops its
      copy and its next write of that row is a `POST` upsert (`OB.handed`), one row;
    - **outboxes left by the old version**, written as literal 0.135.x JSON (frozen through R0): a closed window's v2
      key with a create, a change, a delete and a create without `at`, plus the v1 key, are each sent once
      (POST ×3, the batch, DELETE) and removed; a live window's v2 key is left alone;
    - the pagehide keepalive beacon: a closed window's write goes as one keepalive POST; its key stays (ts 0) and the
      next start sends it again as a POST upsert (still one row); closed while even the beacon fails, the next window
      sends it at once. This pins `fetch(…, {keepalive: true})`: moving to `navigator.sendBeacon` would need the test
      changed, in its own step;
    - settings: `sight.annotate.styles` (a brush colour), `.filter`, `.stamp` (mode, position), `.stamp.videos` (off
      for one clip) reach the server and come back in a fresh browser, shown in the UI; `hydrateSettings` drops a
      `sight.*` key the server lacks and keeps one outside `sight.*`;
    - touch: the badge's tap retries.
  - `tests/r0_shots_e2e.cjs`:
    - screenshots: S, Shift+S (an area, 240 × 120 → a 240 × 120 picture; Esc cancels), the composer's button, × drops
      one, a click enlarges, the note's `data.shots`, its card;
    - reference images (`kind: "image"`): the tool's click → the file picker; a card dragged from the library split
      (Tab) lands where dropped; Shift+click + "add selected" (the range includes the open file: both are added);
    - note previews: a picture note's card has the 720-px still (a blob) with its drawing in picture px; a video
      note's frame is stored (`/api/review/nprev/<aid>`, key `f1.000`), loaded from there in a fresh browser, pruned
      when the note goes;
    - dictation with a stand-in `SpeechRecognition`: Alt+M on / off, words land in the note field, the mic button,
      its right-click language list;
    - touch: the screenshot button, the mic, the library button, a long press to select a card, "add selected".
  - `docs/PLAN.md` "Found by the R0-0 regression tests", item 7: the picture jumps by a bar's height once a library
    drag is under way (the `.vmodes` bar shows), so a drop lands off from where it was aimed before the jump.
- **Notes:**
  - Every write is logged by the wrapper (localStorage `__r0_writes`); storage is read from a same-origin page that is
    not the app (`/api/settings`), and no other app page stays open in the beacon / old-outbox parts: an app page's
    60 s re-adopt timer would take the keys being checked.
  - "Offline" is a fetch wrapper per tab (sessionStorage `__r0_off`, kept across a reload), not `page.route`: a
    keepalive request of a page being unloaded escapes the route, so the "reload while offline" case was sending
    everything through the beacon. The wrapper fails writes as a network error does (the queue's "down" path).
  - The app's pagehide pushes every `sight.*` key it holds (`settingsPushTimer` is never reset), so the
    hydrateSettings case sets its keys from a same-origin page that is not the app (`/api/settings`).
  - Opening the stamp's settings switches the stamp on for that clip; the checks allow for it.
  - In the split a plain click shows the file in the lightbox; Ctrl+click and Shift+click only select (checked); on
    touch a tap shows the file, a long press selects.
  - Not done here: 3D (block 4), board / compare / sequences, exports, trackers, scale / theme (block 5). Queue
    behaviour outside the R0-0 list is not pinned either: the `landedAt` guard (an adopted entry older than a write
    this window landed), `obOverlay` (a GET racing a landed write), the pageshow / bfcache branch, the beacon's 60 KB
    budget and in-flight skip, `obFlush` waiters.
- **Review:** a fresh agent reviewed the block and mutated app code (obAdopt, OB_STALE, keepalive, PATCH revive,
  hydrateSettings, writeJSON, storeRef, npPut, …) to test the checks. Caught at once: 9 of 13. It found:
  - old-format outboxes never tested (a refactor dropping v1 / adding a required field stayed green);
  - the beacon checks racing: other pages' 60 s re-adopt timer, and (on re-review) the closing page itself seeing the
    keepalive answer and clearing its key; the wrapper now sends the keepalive write and never answers the page;
  - the "freeze" not freezing (B refreshed its stamp; it passed only by timing);
  - the hand-off upsert check vacuous (D had made the row);
  - the revive case taking the batch or the single path by timing;
  - × and Esc checks that could pass vacuously, a missing touch stop check;
  - the `landedAt` guard uncovered (listed above as not done).

  All but the last were fixed as described above. Re-review rounds found two more timing flakes, both fixed:
  - the badge click racing the queue's own retry: the click may now time out quietly, and the checks after it stay strict;
  - a fixed 300 ms wait racing the 300 ms debounce of a change: it is polled for now.

  The same reviewer confirmed every fix. Every mutation it ran fails a named check, and 8 runs at once are green.
- **Suite:** 9 failures, none from this block, which changes no app code:
  - `test_pwa` ×4, `test_review_all.test_pdf_all`, `test_annot_tools.test_tools`, `test_review_page.test_cut_copy_paste`, `test_sources.test_file_uri_to_path`: known;
  - new on origin/master since 0.135.2: `test_sources.DropFilesE2E` fails on a clean checkout of it too (`dropKind is not defined` in `drop_files_e2e.cjs`).

## 0.138.0 — 2026-11-26 — Lightbox guides
- **What:** a picture, PSD or video gets a Guides button in the lightbox bar: a grid with rulers (drag a guide, snap to a step or type pixels) or 1-, 2- or 3-point perspective (drag each vanishing point, set how many lines). Guides stick to the picture through pan, zoom, turn and mirror, and are remembered per file. The button is hidden for 3D and audio.
- **Where:** new `app/static/guides.js`; `app/static/index.html` — `mountGuides`, the button, `light.guideGeom`, `passThrough` on the lightbox annotator. `MANUAL.md`, `docs/ARCHITECTURE.md`.
- **Notes:** positions are image pixels. `sight.guides` goes through `putSetting` (a bare localStorage write would be deleted on the next start). At most 400 files are kept. No new shortcut. Not on compare, not on the phone.
- **Review:** a fresh reviewer found one hole: changing the grid snap step saved it but left the ruler ticks on the old step until the next pan or drag (`paintMenu` `applySnap` never called `refresh()`, while the density sliders did). Fixed: both the live input and the change call `refresh()` (it only redraws the overlay, so the field keeps focus). The same reviewer confirmed that and found nothing new. The pen button and its right-click reset from 0.136.0 stayed in place; the guides button sits after the flip button.

## 0.137.0 — 2026-11-26 — 3D camera eases, and Q/E move up and down
- **What:** WASD fly eases in and out instead of starting and stopping dead. E raises the camera and Q lowers it. Shift slows the whole fly, the same way it slows pan and zoom.
- **Where:** `app/static/index.html` — `makeCameraRig`, `CAM_MOVE_KEYS`, the 3D help and the Camera panel. `MANUAL.md`.
- **Notes:** meshes and splats share the rig. Q/E move on world Y and fold into the same wish as WASD before one normalise. Shift multiplies that wish by `FINE`. Releasing a key or Shift eases out; velocity is cleared when the viewer is disposed and when the camera jumps (frame, recall, turn). Fly is ignored while annotating, in a text field, or with Ctrl/Alt/Cmd.
- **Review:** the same reviewer that checked the guides merge found nothing wrong in the fly rig (wish axes, Shift, ease-out, halt on dispose and on a jump).

## 0.136.0 — 2026-11-26 — Annotation tools keep their settings
- **What:** each drawing tool's colour, size and options stay as you left them on the next file and the next time Sight starts. Turning annotating on still starts on the brush. Right-click the pen (long-press with a finger) puts every tool back to the defaults; right-click one tool's icon (or long-press it) resets only that tool.
- **Where:** `app/static/annotate.js` — `sharedStyles`, `sharedStamp`, `flushPrefs` on `pagehide` (capture) and `setAsset`, `resetTool`; `app/static/index.html` `bindAnnoReset`; `app/static/compare.js` pen tooltip. `MANUAL.md`, `docs/ARCHITECTURE.md`.
- **Notes:** the lightbox, compare and the board share one styles object and one stamp look. The tool in hand is not stored. Style and stamp writes are debounced; the flush runs in the capture phase so it lands in localStorage before index.html sends `settings.json`. A full reset still writes the shared objects in place. The shape tool's reset also clears the old ellipse slot. Selection-only property edits still do not become the tool's defaults (a colour-grade edit does). A mouse long-press on the pen no longer resets — that was easy to hit by holding the click.
- **Review:** a fresh reviewer found the touch path double-fired. A finger or pen long-press both reset and toggled (or switched tool): `pointerup` cleared the timer before Windows fired `contextmenu` on release, the click then cleared the swallow flag, and that menu reset again. A release between the browser's menu (~500 ms) and the timer did both. Fixed the same way as the eye's onion toggle: `contextmenu` resets only for a mouse (a pen's barrel button counts as one); the timer is the touch path and `pointerup` only cancels it, so the click still sees the flag. The same reviewer confirmed that and found nothing new.

## 0.135.2 — 2026-11-26 — File drop zones no longer give up on untyped files
- **What:** dropping a file always gets the two zones (sidebar = add, the rest = view). A file whose drag carries no directory entry — empty MIME or `application/octet-stream`, which is how a lot of real files arrive — used to be treated as a folder, so the zones never came up and the drop did nothing.
- **Where:** `app/static/index.html` — `dropKind`, `readDropped`, capture `dragenter`/`dragover`; `tests/drop_files_e2e.cjs`; `docs/ARCHITECTURE.md`.
- **Notes:** a folder drag is only a drag that contains a directory entry. `dragenter` and `dragover` are accepted even when `items` is still empty, otherwise the browser never fires `drop`. Entries and `getAsFile()` are read once on drop (a second call is empty in WebView2). While drawing, a picture dropped on the lightbox / compare / board stays a reference even when `File.type` is empty — the name test matches annotate.js `REF_RE` (jpeg/png/gif/webp/bmp/avif/svg). A directory the entry still reports is never sent to `/api/files/drop`.
- **Review:** a fresh reviewer found one hole: an untyped image (`shot.png`, type `""` or `application/octet-stream`) dropped while drawing was opened as a file and also added as a reference, because the capture handler only bailed on `image/*`. Fixed by the same name test as `REF_RE`, applied only to `dataTransfer.files` (the list the annotator reads). A first cut also bailed when the file existed only via `getAsFile()` and `files` was empty, which neither opened it nor added a reference; that fallback was removed. The same reviewer confirmed both fixes and found nothing new. It also noted the folder fallthrough cannot see a live directory, so it does not POST one to `/api/files/drop`.
