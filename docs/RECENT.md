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

## 0.40.0 — 2026-11-13 — Annotations: hold Alt to move the camera or scrub without the select tool
- **What:** in annotation mode with a drawing tool, holding Alt makes a drag go to the viewer instead of
  drawing: a 3D model orbits, a video scrubs (sideways on the picture). While Alt is held the annotation bar
  and the notes panel do not take the pointer (they are faded). Releasing Alt draws again. With the select
  tool nothing changes (Alt+drag still duplicates).
- **Where:** `app/static/annotate.js` — `altCam()`, `paintAlt()`, `altChanged()` (keydown / keyup of
  `Alt`, blur resets it, like Ctrl); `onDown` (returns before `grab` when `altCam()`); `setTool`, `toggle`
  and `updateCursor` (cursor / class follow it); CSS `.light.an-alt`. `MANUAL.md` (Annotations), `docs/ARCHITECTURE.md`
  (annotation input). `app/version.py`.
- **Notes:** the state is only the Alt key's `keydown` / `keyup` (the same pattern as Ctrl, which is the
  eraser modifier, not a shortcut through `hotkey()`). Shapes lose their "Alt from centre" while Alt is held
  (the press is the viewer's); the select tool's Alt keeps its meaning. Checked with Playwright on the scratch
  GLB: a plain drag draws; with Alt held the drag changes the view and draws nothing, the bar takes no
  pointer (`elementFromPoint`), and after release drawing works again. On the scratch mp4 an Alt-drag
  moved the playhead from 0.0 s to 3.1 s with no drawing. No page errors. Not checked: Mac Option (same
  `Alt` key name, not run), Safari / Firefox, pen tablets. Not committed. The fresh-agent review CLAUDE.md
  asks for was not run (no subagent requested).

## 0.39.0 — 2026-11-13 — 3D notes show a picture per camera view, like video notes
- **What:** a 3D note's card shows a picture of each view its drawings were made from (the note's own view
  first, then the others in the order drawn), with the drawings over it, as a video note shows its frames.
  Clicking the picture of another view picks the note and moves the camera there. A note made from drawings
  on several views (orbit, draw, orbit, draw, then Add) gets one picture per view; the drawings then leave
  the picture as before (the clean picture).
- **Where:** `app/static/annotate.js` — `PIC3` cache, `view3dPic(vk)` (renders from the view's camera with
  `S.b3.capture()`, JPEG ≤640 px, camera put back), `view3dPreviews(n)` / `view3dBox(n, list, cls, goVk)`
  (called from `notePreview` for `model3d`), `resetPF` clears `PIC3`, `onListClick` (`.an-nprev[data-vk]`),
  CSS `.an-nprev[data-vk]`. `MANUAL.md` (Annotations), `docs/ARCHITECTURE.md` (3D previews). `app/version.py`.
- **Notes:** the picture uses the viewer's current shading, not the note's saved one (the saved one is applied
  only when the note is opened, as before). It is made on demand and kept per asset / view / shading; no
  picture is made while a drag (orbit or stroke) is on, so it can show up one refresh later. A note with no
  drawings has no picture, as with video. Checked with Playwright on a scratch GLB: a note from three views
  shows three different renders with their drawings, a click on the second picture moves the camera there and
  the chip follows, the camera stays where it was after the renders, and no page errors. Not checked: a model
  with a very large canvas, Safari / Firefox, the reports (they already capture per view). Not committed. The
  fresh-agent review CLAUDE.md asks for was not run (no subagent requested).

## 0.38.2 — 2026-11-13 — Desktop: a click on the empty notes list drops the picked note
- **What:** in the desktop lightbox's notes panel, a click on empty space in the list (below or between
  the cards) clears the picked note (the `.on` card, its drawings and the view), the same as Esc.
- **Where:** `app/static/annotate.js` — `onListClick` (the no-target branch: `S.pinFocus` / `S.focusNote`
  cleared, `paintVisibility`, `renderPanel`). `MANUAL.md` (Annotations). `app/version.py`.
- **Notes:** a card click still picks it (and a second click on it drops it, as before). Only the note
  pick is cleared; drawing selection is left as it was, like Esc. Checked with Playwright on the scratch
  `SIGHT_HOME`: picked card → 1 `.on`, click on the list's bottom padding → 0, card click → 1 again; no page
  errors. Not committed yet. The fresh-agent review CLAUDE.md asks for was not run (no subagent requested).

## 0.38.1 — 2026-11-13 — Desktop: the picture goes clean as soon as a note is made
- **What:** in the desktop lightbox, once a note is made (Add button or Enter) its drawings and every other
  note's drawings leave the picture at once. Before, they stayed on screen until you started a new drawing.
  A note's drawings come back while its card is hovered or pinned (click); typing a new note, starting a
  drawing or picking a note ends the clean picture.
- **Where:** `app/static/annotate.js` — state `cleanPic`; `addNote` sets it; `viewMode` clears it on compose
  or a pin; `modeAllows` hides note drawings while it is set (except the hovered / pinned note); `setAsset`
  resets it. `MANUAL.md` (Annotations), `docs/ARCHITECTURE.md` (desktop visibility). `app/version.py`.
- **Notes:** opening a file still shows every note's drawings (the idle default is unchanged). Checked with
  Playwright on a scratch `SIGHT_HOME` with a few images: visible note drawings went from 1 (while
  composing) to 0 after Add and after Enter; hovering a card shows its drawings; no page errors. The phone
  app (`mobile/`, `.review.clean`) was not changed and was not checked for the same symptom. Not committed.
  The fresh-agent review that CLAUDE.md asks for was not run (no subagent was requested).

## 0.38.0 — 2026-11-13 — Old video the browser cannot decode plays through a converted copy
- **What:** old .mpg / .mpeg / .vob (MPEG-1/2 program streams), DivX / Xvid, MS-MPEG4, WMV, FLV, H.263,
  Cinepak, MJPEG, DV, Huffyuv, SVQ1 and any other video the browser gives no picture for now open: the
  lightbox shows "Converting for playback… N%", the server converts a copy once with ffmpeg (H.264 + AAC
  in MP4; VP9 + Opus in WebM when the ffmpeg has no x264), and the video plays from that copy. A file that
  cannot be converted shows "Cannot play this file: <ffmpeg's last line>". Copies are kept under
  `thumbs/video/` and served from then on, so the next open needs no conversion.
- **Where:** `app/library.py` — "playback copies" section before `_decode_peaks` (`playback_path`,
  `playback_status`, `start_playback_copy`, `_run_playback_copy`, `_play_encoder`); `_migrate_asset` moves
  copies on a rename; both delete paths drop them. `app/server.py` — `/api/file/{id}`, `/api/video/focus`
  and `/api/video/cache` read `lib.playback_path(a)`; new `POST` / `GET /api/video/transcode`.
  `app/static/video-playable.js` (new: `convertForPlayback`); `index.html` (`watchPlayable`, called from
  `startVideoCache`); `annotate.js` (the note-preview player's first load); `compare.js` (video layers).
  `tests/test_playback_copy.py`. `MANUAL.md`, `app/version.py`.
- **Notes:** the copy is named `<aid>_<size>_<mtime_ns>.<ext>`: a changed source is never served a stale
  copy, and the next conversion removes the older ones. One conversion runs at a time (`_play_slot`);
  the status is kept in `_play_jobs` per asset and a failed one is tried again on the next open. The
  fallback fires on a player error or when metadata arrives with no `videoWidth` (so an audio-only
  "video" is converted too, harmlessly). Files the browser plays are never converted. Deinterlacing
  (`yadif`, only frames flagged interlaced) and even dimensions are part of the conversion. The
  copy is the thing the SlidingVideoCache window runs on, so `focus` / `cache` take the copy's path.
  Checked: every codec in the probe set converted to H.264 and played in Playwright's Chromium through
  `/api/file/` (`ffprobe` shows h264 + aac); the lightbox was driven end to end on an MPEG-2 file with its
  copy removed (error → conversion → picture + playhead moving) and on a non-video .mpg (error message).
  Not checked: the note-preview player and the compare overlay with a converted file (their code is the
  same pattern but not driven in a browser), Safari / Firefox / Windows Chrome. The per-block review by a
  fresh agent that CLAUDE.md asks for was not run (no subagent was requested in this session). Not committed.

## 0.37.1 — 2026-11-13 — 3D: camera positions no longer become "View N" while orbiting
- **What:** with a 3D model open and annotation on, moving the camera (orbit, zoom) added a "View N" entry
  to the panel's view chips and to the pending line for every camera position it passed, with no drawing
  in it. Now a view is recorded only when a drawing or a note is made from that camera.
- **Where:** `app/static/annotate.js` — `ctxNow(forNote, make)`: the panel's pending line calls it without
  `make` and gets `{vk: null, cam}` (no view registered); `newItem`, paste / duplicate and `addNote` pass
  `make = true`.
- **Notes:** the pending line shows no view label while the camera is off every recorded view (it used to
  show the next number). Checked with Playwright on a GLB: an orbit leaves the chips unchanged; one brush
  stroke adds exactly one view.

## 0.37.0 — 2026-11-13 — Desktop review fixes: report names and frame numbers, previews, 3D errors, usd-core install
- **What:** (1) Phone review app on a desktop: a mouse right-click (and Ctrl-click on a Mac) is the browser's
  own menu. The card's menu and the speed / sound controls no longer take it; a touch or pen long press
  still opens the app's menu. (2) PDF and web-page reports name each video frame "<file> · frame N" and burn
  "frame N" into its top-left corner (N = the number the panel shows as "f N"); a 3D view is "<file> · View N",
  an image note "<file>". (3) Note previews of video frames: the hidden preview player is in the document, a
  seek counts only when the player sits on the wanted time with its seek over, a frame not decoded yet is asked
  again (three tries), and a player that fails to load is dropped and made again. (4) A 3D model that fails to
  load shows "<ext> — could not open: <reason>" and stops its render loop (it no longer stays in the loading
  state). A .usdz that cannot open says why: the USD library is missing (a source run prints the pip command),
  the file is gone from disk, or it did not convert. (5) Sight.py: the first-run install of usd-core goes
  through the runtime's own pip when uv is absent, and a failed install is logged with its last error line.
- **Where:** `app/static/annotate.js` (`gatherReport` + `frameNo` / `frameTitle` / `viewTitle` / `bakeFrame`;
  `pfLoad`, `pfSeek`, `pumpPF`, `resetPF`); `app/static/index.html` (`fetchBufferWithProgress` throws the
  server's detail, `loadModel` usdz branch, `boot3d` catch); `app/server.py` (`usdz_problem(a)` as the 404
  detail of `/api/model-glb/{aid}`, `import sys`, `importlib.util`); `Sight.py` (bootstrap usd-core install);
  `mobile/js/app.js` (card `contextmenu`, `vdrag`); `MANUAL.md` (export captions); `app/version.py`.
- **Notes:** not reproduced on Linux Chromium, so no change was made for: the notes panel disappearing when
  annotating (A / the button / 3D Shift+A all keep it), a drawing covered by the frame while drawing, and the
  Mac marquee. The preview changes are written for WebKit (the video in the document; the position check),
  not checked on macOS. FBX display is NOT changed: the reported FBX problem is still open (the loader waits up
  to 20 s for textures before the model is shown; no FBX sample was available here). Runtimes made before this
  version (their `.deps-v4` marker is set) do not retry usd-core: `python -m pip install usd-core` in the
  runtime. The draw canvas (RMB zoom) still blocks the browser menu on a right-drag, because on a Mac the menu
  opens at press. The phone's own PDF captions (`mobile/js/report.js`) are unchanged. Review (four fresh
  agents, one per block): fixed the keyboard menu key being taken by the card menu, the PDF label scale after
  a downscaled frame, a seek timeout caching the old picture, the usdz reason for a missing file, and the
  dead `null` branch; the notes that the loading state was not endless at HEAD (an outer catch existed) are
  reflected in the wording above.

## 0.36.3 — 2026-11-13 — Canvas: the Arrows / Shapes slots restyle a selection
- **What:** with the select tool and arrows / lines (or rectangles / ellipses) selected, the Arrows
  and Shapes rows' choices (heads / dash / line; rectangle, rounded, ellipse, filled or not) and the
  Shapes row's fill colour now change the selected items. Before, the pick switched to drawing with
  that tool and dropped the selection, so an arrow's heads or a shape's fill could not be edited
  once selected. The text slot already worked this way. The rows mark the selection's own variant
  and fill; with nothing of that kind selected, the slots behave as before.
- **Where:** `app/static/review-draw.js` — new `groupSel`, `restyleSel`, `variantIdx`,
  `applyVariant`, `fillSel`, `fillShown` (after `recolour`); the Arrows / Shapes slot handler and
  its variant buttons; `setFill`; `fillButton`. The phone app gets it through `build_pwa.py`.
- **Notes:** the rule is by kind: arrows-only selected + the Shapes slot still takes the rect tool
  and drops the selection. A press-and-hold on the slot (550 ms) still switches tool and resets its
  size, as the text slot does; the R / O / W keys still switch tools. `annotate.js` (desktop) is not
  changed: its tool buttons also clear the selection in `setTool`, which was not tested here.
  Checked in headless Chromium against the old and new file: marquee select, Filled rectangle,
  Double arrow, green fill, Ellipse, flyout marks, the no-selection picks, a rounded rectangle
  filled (marked as Filled rectangle), and the line-colour fill on an outlined shape.
  Review (fresh agent): three findings, all fixed. (1) a rounded rectangle given a fill matched no
  variant, so its flyout mark vanished: a filled one now matches Filled rectangle. (2) an outlined
  variant left the old fill data: it now resets to a fresh outlined shape's (fill = colour, 0.2).
  (3) the line-colour fill did nothing on outlined shapes: it now fills them; and a pick already in
  effect no longer adds an empty undo step (`restyleSel` keeps only copies that change). Not run:
  the radius of a Rounded pick itself (only its mark). The phone build runs in `tests.test_pwa`.

## 0.36.2 — 2026-11-13 — PDF rows: pictures fill the text column
- **What:** in both PDF reports a note's pictures were 90 pt high (70 pt for a reply's), so a 9:16
  frame came out ~50 pt wide and four of them left the right half of the row empty. Now the
  pictures of a row share one height, chosen so that the row spans the text column: a row takes
  pictures while that height stays at least 120 pt (notes) / 100 pt (replies), and never goes
  taller than 240 pt. Four phone frames to a row now come out ~118 × 209 pt each; a lone picture
  that would be taller than 240 pt is capped there and stops short of the right edge.
- **Where:** `app/review.py` `_pic_rows(pics, max_h, min_h, indent)` (called from `build_pdf`);
  `mobile/js/report.js` `toPdf` → `rows(list, x0, width, maxH, minH)`.
- **Notes:** supersedes the fixed 90 / 70 pt row heights of 0.36.0 and 0.36.1 (row heights now
  vary by the row's pictures). Cover and captions unchanged; the HTML reports are unchanged.
  Checked by rendering a sample desktop PDF (portrait and landscape frames, a reply) and the phone
  PDF from the `tests/test_pwa.py` round trip; `tests.test_pwa`, `tests.test_review_page` and
  `tests.test_merge_parity` pass. Not yet reviewed by a fresh agent.

## 0.36.1 — 2026-11-13 — PDF rows: within the text column; captions in two lines under their picture
- **What:** fixes from the fresh-agent review of 0.36.0. Sight's PDF: rows (and the cover, as
  before) ran ~11 pt past the text column into the right margin — PyMuPDF's Story lays content
  out in x ≈ 50..545, so pictures are sized to `CONTENT_W` = 495 pt (each cell's width set: a
  caption no longer widens a narrow picture's cell); the row height is 90 pt (three 16:9 frames
  still fit); a caption that is not a string no longer breaks the export. Phone PDF: a caption
  under a narrow (portrait) picture wraps to two lines instead of being cut to "Frame 1…", and
  sits right under its own picture (not at the row's tallest).
- **Where:** `app/review.py` (`CONTENT_W`, `_img_tag`, `_pic_rows`), `mobile/js/report.js`
  (`rows` → `capLines`). Checked by rendering both PDFs (portrait frames with captions, 9 pictures).

## 0.36.0 — 2026-11-13 — PDF reports: a note's pictures in rows
- **What:** in both PDF reports (Sight's and the phone app's) a note's pictures — its frame / view
  with its caption, the other frames / views it was drawn on, its screenshots — sit side by side in
  rows, each whole, 90 pt high (three 16:9 frames to an A4 row), a small caption under each; a
  reply's pictures likewise at 70 pt, indented. The cover stays one big picture. A note's pictures
  now come right under its words, before its replies (as the phone's HTML report already did).
- **Where:** `app/review.py` `_pic_rows` (one `<table>` per row: PyMuPDF's Story does not wrap a
  table row, so the rows are packed here) used by `build_pdf`; `mobile/js/report.js` `toPdf` →
  `rows(list, x0, width, rowH)`.
- **Notes:** the HTML reports are unchanged (the browser lays them out). Checked by rendering both
  PDFs to pictures (a note with three frames and a portrait screenshot, a reply with two pictures).
  Review (fresh agent): fixes in 0.36.1.

## 0.35.5 — 2026-11-13 — Phone viewer: the incoming picture fades in as it slides
- **What:** in the full-screen viewer the picture coming in now also comes out of transparency
  (0 → 1) while it slides, as the outgoing one fades out — it no longer shows up fully opaque at
  once (what the user saw as "appears abruptly"; the 0.35.4 seek change stays).
- **Where:** `mobile/js/app.js` `viewer` → `show(no, slide)` (the incoming box's keyframes).
  Test: `viewerFade` checks both pictures are part-transparent mid-slide.

## 0.35.4 — 2026-11-13 — Phone viewer: the strip slide is smooth again (no seek on opening)
- **What:** since 0.35.0 a tap on a note's picture also moved the player to that frame before the
  viewer opened; on a phone the first swipes then stuttered and the next picture popped in
  instead of sliding. Back to 0.33's behaviour: the tap selects the note and opens the viewer, the
  player is left alone; Back puts it on the frame last looked at, as before.
- **Where:** `mobile/js/app.js` `openThread` (no `selectNote` / seek, only `R.curNote`).
- **Notes:** cause, as far as could be told without the device (headless Chromium slides fine
  either way): the seek's `settle` grabs and encodes a ≤ 1600 px frame on the main thread right
  under the first swipe, and the grabber's video competes with the player's decoder for the next
  picture (over FADE_WAIT, it comes in blank and pops). Do not seek the player while the viewer
  is opening.

## 0.35.3 — 2026-11-13 — Canvas: the fill row's "the line's colour" is back
- **What:** the Shapes row's fill colour row starts again with *the line's colour* (the default: a
  fill in the line's own colour, lighter), then the six colours — the way back once a colour was
  picked (the user's call, reversing 0.35.0).
- **Where:** `app/static/review-draw.js` `fillButton`. Test: `fill` (7 entries, back to null).

## 0.35.2 — 2026-11-13 — Phone: picked reviews swipe together; fixes to note selection
- **What:** (1) Home: a picked review swiped left / right slides with every other picked one; the
  bin / eye uncovered on any of them deletes (one confirm) / hides all the picked ones.
  (2) Fixes from the fresh-agent review of 0.35.0: a tap on a card or a picture while a new note
  or a reply is being written no longer moves the player or the selection (a text-only note went
  on the tapped note's frame; a reply's pencil drew on another note's frame); closing the viewer
  on another note of a picture review now moves the highlight (`showNote` repaints); a note's
  "first frame" is its own drawings' (`noteFrameList`), not its replies'; a marker step on the
  drawing canvas does not select the note behind it; a text selection made / dropped on a card
  is no tap; while writing over the player the hidden controls show again; the speaker's tooltip
  says "tap: full / mute"; the `select` test clicks and checks the same card.
- **Where:** `mobile/js/app.js` — `rowGestures` (`peers` / `placeAll`, `row._place`), the review
  row's `.sw` buttons, `selectNote`, the card's click, `showNote`, `jumpNote`, `paintSnd`;
  `mobile/index.html` (`.review.clean` rules `:not(.compose)`). Test: `swipeAll`.
- **Notes:** left as reviewed: with the controls hidden a mouse has no way to the panel but the
  round button (the swipe up is touch only). (The fill row's "the line's colour" is back in 0.35.3.)
