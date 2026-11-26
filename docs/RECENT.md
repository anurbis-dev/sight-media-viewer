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

## 0.135.1 — 2026-11-26 — R0-0 block 2: regression tests of the annotator (geometry golden, notes, tools)
- **What:** the second block of the R0-0 safety net (docs/PLAN-coreline.md). It pins what the annotator does now.
  No app code changed (only the version).
- **Where:**
  - `tests/test_r0_annotate.py` runs three page scripts on one temporary library:
    - `tests/r0_geometry_e2e.cjs` + `tests/fixtures/r0_geometry_golden.json`. Known drawings, with real pointer input,
      must store exactly the golden's rows (to 0.001). The drawings: every tool on a 1600 × 1000 picture at fit, then
      a note; a picture whose asset row says 800 × 600 but decodes to 400 × 300; a clip on frame 25; a clip with a 2:1
      pixel aspect (shown 640 × 240). Rewrite the golden with `SIGHT_R0_GOLDEN=update` (only a clean run writes it).
    - `tests/r0_notes_e2e.cjs`:
      - the reviewer name (You panel) signs notes, replies, state events and the review state;
      - Add, an empty Add, undo / redo of adding a note (the words come back into the composer);
      - reply and its edit, note edits, In progress / Resolve / Reopen, a reply's tombstone;
      - the filters, the review state and its history;
      - the clean picture after a note, picking a note (also while just watching), the panel on / off, delete;
      - video notes on frames, their marks, a pick seeks;
      - touch.
    - `tests/r0_tools_e2e.cjs`:
      - each tool's key and button;
      - select, grips, move, resize, turn, nudge, Shift+click, marquee, Ctrl+A, duplicate, copy / cut / paste,
        Ctrl+], the bin;
      - undo / redo by keys and buttons;
      - the eraser (Object and Partial);
      - the eye, and onion skin, whose ghost opacities are pinned (0.5 / 0.5 half way, 0.25 / 0.75);
      - touch, including a finger drag with the select tool.
  - The shared harness:
    - `run_page()` resets the server's UI settings to the class's before every script. Synced settings, such as the
      notes panel left open, changed the next script's fit scale.
    - `make_video(sar="2:1")` wrote 1:1: `setsar=2:1` reads as sar=2, max=1. Fixed.
    - The report carries `t.data`.
  - `docs/PLAN.md` "Found by the R0-0 regression tests", item 6: a tap on the drawing toolbar within about 0.5 s of a
    finger stroke brings no click in Chromium's emulation. It is probably fling tap suppression; check on a real
    touch screen.
- **Notes:**
  - **The golden alone does not prove units.** Strokes are aimed through the layer's own transform, so stored numbers
    stay the same whatever unit the layer uses. The `layerUnits` checks catch a unit shift: the layer must map
    (0, 0)–(decoded size) onto the media's own box.
  - For "decoded ≠ row", the seed renders the thumbnail first. Rendering one rewrites the row's size, which made the
    case hollow.
  - The golden is this container's Chromium at 1400 × 900. A text row's box (system fonts) and `revision` (it counts
    writes, which the queue coalesces) are left out.
  - The tools script draws on a 2000 × 1300 picture, so screen px ≠ picture px (asserted). Drags assert they land on
    the picture, not under a bar.
  - Deliberately not done here:
    - notes on a 3D view (block 4);
    - the reference image tool (block 3);
    - a phone-size context (PLAN item 2: a tile cannot be opened there).
- **Review:** a fresh agent reviewed the block and mutated app code to prove the checks. It found:
  - the hollow "decoded ≠ row" case;
  - the golden depending on test order (shared UI settings);
  - scale checks that were vacuous at s = 1;
  - a font-dependent text box in the golden;
  - a `null` golden that silently skipped the comparison;
  - a wrong cause in PLAN item 6;
  - coverage gaps (add-note undo, touch move);
  - a vacuous `.every`;
  - fixed waits;
  - columns not pinned.

  All were fixed. On re-review it found `revision` in the golden (write-coalescing dependent), also fixed. The same
  reviewer confirmed every fix. Its mutations now fail the intended checks: asset-row size in `onReady`, nudge
  without the scale, the author dropped, the onion fade, undo. Green alone, in reverse order, and with three runs at
  once.

## 0.135.0 — 2026-11-26 — Coreline tracker adapter (PLAN-coreline R4)
- **What:** Coreline is a second tracker kind beside ShotGrid (desktop only). Settings → Trackers → *Connect a tracker…*
  → Coreline (server + API key). Its projects sit under Sources. Their Versions show as library tiles, with thumbnails,
  the scrub sprite as a filmstrip, the status / type filters, Fields ▾ and Filter ▾. A double-click (touch: a tap on the
  selected tile) downloads the **original** and opens it. **CL ▾ → Sync now** pulls Coreline's review rows into Sight's
  own import and pushes the rows changed here to Coreline's merge API, with pictures uploaded as shots. Review only: no
  Version upload (the plan's open question, settled as proposed).
- **Where:**
  - new: `app/coreline.py` (server adapter), `app/static/coreline-core.js` (client adapter + sync), `docs/CORELINE.md`
    (decisions, mapping, what to check on a real server), tests `tests/test_coreline.py`, `cl_fake_server.cjs` (a fake
    built from Coreline main 9cffd42's API.md / ADR-0037 / ADR-0006; it merges with review-core.js `mergeRows`, as
    Coreline does), `cl_sight.cjs` (the sync through Sight's server) and `cl_view_e2e.cjs` (browser, mouse and touch);
  - edited: `app/trackers.py` (registry), `app/server.py` (`Content-Range` now passed through `…/fetch`; ShotGrid's
    adapter ignores it), `app/static/index.html` (one import);
  - expectations updated now that two kinds exist: `tests/test_trackers.py` (kinds), `trackers_e2e.cjs` /
    `trackers_multi_e2e.cjs` (while ShotGrid's fields are open, *Connect a tracker…* still offers Coreline);
  - MANUAL, ARCHITECTURE, PLAN-coreline, CLAUDE.md (doc list).
- **Notes:**
  - The generic tracker UI (tracker-source.js, annotate.js link ▾, Settings form) needed no change. ShotGrid's code is
    untouched.
  - Media id = `"<type>:<id>:<field>"`. The link is `{site, type, id, field, code, project, source?, scaled?, file?}`,
    filed under `coreline:<host>`.
  - Doc units: Sight opens the original. If Coreline has no original (or Sight cannot open its type), Sight opens the
    `web` rendition. If that rendition's size differs from the original's, the link says `scaled` and Sync refuses:
    drawings would land in rendition pixels. Scaling rows (`transformItem`) is left for later.
  - Push sends only rows whose content (a hash, stamps left out) differs from Coreline's copy and was not sent as is
    (`state.sent`). Tombstones go only for rows Coreline had.
  - The same Version linked to two files: Sight's import re-derives ids that another file holds. Sync records those
    derived ids (`state.foreign`), never sends them (they would duplicate on Coreline) and says so.
  - The key never reaches the page. The proxy refuses every `/api/auth/…` route except `GET /api/auth/me`, so the
    page cannot mint or list keys.
  - Not used: the WS realtime (Sync is a button).
  - The phone app does not load the adapter: Coreline has no CORS.
  - Pre-existing, not from this change: `test_annot_tools.test_tools` and `test_review_page.test_cut_copy_paste` fail
    on origin/master too (checked in a clean worktree). `test_r0_lightbox` needs `psd-tools` (it was installed here and
    passes).
- **Review:** a fresh agent reviewed it in four rounds.
  - Round 1, 10 findings:
    - **high:** the proxy's account-route guard could be passed with dot segments (`/api/x/../auth/api-keys` reached
      Coreline with the key). Now `_guard_path` refuses dot / empty segments, backslashes and encoded dots / slashes,
      and checks on-site redirects too;
    - a failed picture upload was never retried;
    - a re-linked scaled preview lost its `scaled` mark. The link now keeps the original's size, and Sync refuses a
      file of another size (swapped sizes are accepted);
    - one 400 switched a server to plain queries;
    - a short page stopped the grid's paging, and the entity list was capped at 1000;
    - "no picture" answers were cached while renditions were still being made;
    - the web rendition's extension was guessed;
    - possible cache-name clashes;
    - id case;
    - a route to check on a real server (docs).
  - Rounds 2–4 found smaller follow-ups:
    - only the final shots PUT's 409 counts as "taken";
    - a missing picture is reported once and downloaded when it appears on Coreline;
    - 403 is handled like 404 on the file lookup;
    - ids are lowercased throughout;
    - a ready file without renditions is cached as final.
  - All of it is fixed; the same reviewer confirmed every fix, and ShotGrid's code paths are unchanged.
  - The whole suite: the same 8 failures with and without the change (`test_pwa` ×4, `test_review_all.test_pdf_all`,
    `test_sources.test_file_uri_to_path`, and the two above), compared against a clean origin/master worktree.
    Plus 8 new Coreline tests, green.

## 0.134.1 — 2026-11-26 — R0-0 block 1: regression tests of the 2D lightbox and video transport
- **What:** the first block of the R0-0 safety net (docs/PLAN-coreline.md). Playwright tests pin how the lightbox and
  the video transport behave *now*, before the R0 refactor. Also a timing tool for the lightbox. No app code changed
  (only the version).
- **Where:**
  - `tests/r0_harness.py`, shared by every R0-0 block. `LiveCase` makes a temporary library (never the live one) with
    the media a test writes, waits until every file is ready, and serves it in-process. `run_page()` runs a node
    script; `assertReport()` needs no fatal error, no page errors, every check ok, and at least `min_checks` of them.
    `needs()` skips when node / Playwright / ffmpeg / psd-tools is missing; with `SIGHT_REQUIRE_E2E=1` that is a
    failure instead. `SIGHT_R0_REPORT=<dir>` writes the whole report as JSON. Media makers: PNG, quadrant PNG,
    layered PSD, H.264 / MPEG-1 clips.
  - `tests/r0_lib.cjs`: page helpers. A check is `t.ok/eq/near(name, …)`. Desktop and touch pages; a touch page is a
    touch laptop (`hasTouch`, no `isMobile`), see PLAN.md "Found by the R0-0 regression tests" 2. Also: pinch / finger
    drag over CDP, `vstate` / `vsettled` / `vplaying`, a Web Audio start counter (`window.__abStarts`).
  - `tests/test_r0_lightbox.py` + `tests/r0_lightbox_e2e.cjs`, 156 checks:
    - pictures: open, fit, zoom (digits, F, double-click, wheel about the cursor, right-drag), pan, pixelation, turn
      and mirror kept per file, ← → ↑ ↓, closing (Esc, ✕, Space);
    - PSD: preview, layers panel (D and the button), a layer, back to Composite;
    - video: autoplay, Space and click (the 250 ms hold), `.` `,` Shift+← →, the position field and its menu, fps
      from the file, bar and stage scrub (Shift-fine), loop, mute and volume, scrub sound (heard through Web Audio),
      timeline marks (a press on a mark enters annotation mode), RAM read-out, the scrub copy, playback conversion,
      zoom / turn / resize refit, → leaving a video stops it;
    - touch: pinch, pan, double tap, mirror, layers, tap / drag on the video and the bar, long press.
  - `tools/bench_lightbox.py`: stdlib + benchlib, runs on Windows. It times open image (cold / warm), next image,
    open video, frame step and close, using real CDP input and timing inside the page. Synthetic media, or
    `--home <copy>` with `--image` / `--video`. Run it before and after each R0 block.
  - `docs/PLAN.md`: a new section of what the tests found (not fixed):
    - no next / previous file on touch;
    - phone emulation cannot open a tile;
    - `.` on the last frame lands on `t = duration`;
    - a video's `width` / `height` columns are its thumbnail's;
    - so carrying notes over between versions of a video scales them wrongly.
- **Notes:**
  - **The grid order is the scan order** (readdir: alphabetical on NTFS, hashed on ext4, reverse creation on tmpfs).
    `LiveCase.ui_settings` writes the temp home's `settings.json` with Name sort, which wins over localStorage. Keep
    it in later blocks, or read the order from `.card[data-id]`.
  - A press on a timeline mark belongs to the mark (it enters annotation mode), so scrub presses avoid them.
  - A stage scrub counts from where it became a drag (4 px), not from the press point.
  - A small picture opens at 100 %, never upscaled.
  - The R0 refactor must keep these tests unchanged. The selectors used (`#lightClose`, `.vbar [data-cur]`,
    `.view-media`, `.view-hud`, `#psdBtn` …) are the contract.
  - Suite here before this block: 6 failures that predate it. 3 in `test_pwa`, known. 3 not looked into:
    - `test_annot_tools`, its touch part;
    - `test_review_page` cut / copy / paste;
    - `test_sources` `file_uri_to_path`, a Windows path.
    `usd-core` is not installed, so the USD tests skip. Installed here: psd-tools, watchdog, pymupdf, zstandard,
    imageio-ffmpeg (Sight's own deps).
- **Review:** a fresh agent reviewed the block. It broke app code on purpose to catch checks that pass vacuously
  (`git checkout` afterwards). It found:
  - the grid-order dependence: 6 checks failed every run on tmpfs;
  - a hollow "turn kept per file" check;
  - a hollow scrub-sound check (the fetch came from the toggle, not the scrub);
  - bench crashes ("next" onto a non-image, tiles not rendered);
  - wrong "(cold)" labels;
  - autoplay / loop timing races;
  - checks with no precondition;
  - harness gaps (silent scan timeout, unasserted server start, leak on a failed set-up, a low `min_checks`);
  - PLAN item 4 was inaccurate, and the carry-over bug behind it.

  Everything is fixed, and gaps it named are covered (touch layers button, video zoom / turn, resize refit, leaving a
  video). The second pass found the "video left is stopped" check hollow (a detached element) and fixed 600 ms waits
  that flaked under load. Fixed too. The same reviewer confirmed every fix. Its mutations now fail the intended
  checks: turn fallback, `saPlay` stubbed, ResizeObserver refit, the scrub copy's hide. The suite is green alone, on
  tmpfs, and with two runs at once.

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
