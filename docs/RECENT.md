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

## 0.122.14 — 2026-11-24 — Compare with pictures only: the top bar's hint fits
- **What:** a comparison of still images (no video) already worked — layouts, Swipe, Difference, See-through, zoom / pan, annotate, opened from a grid selection or by dropping pictures onto the lightbox (backlog 18, checked in the browser). Its top-bar hint still said "Click play · drag scrub · [ ] shift layer"; with pictures only it now reads "Drag / middle-drag pan · wheel / right-drag zoom …", and with a video "[ ] shift clip".
- **Where:** app/static/compare.js — `HINT_VIDEO` / `HINT_PICS` / `HINT_KEYS`, set in `build()` (runs on every layer change).
- **Notes:** backlog 18 is closed on that check; if the owner meant something else (e.g. the lightbox's own compare of one picture with no versions — `K` then flashes "select 2 or more"), it is item 21's merge into the lightbox.
- **Review:** a fresh reviewer agent found no bugs (checked: `build()` reruns on every layer add / remove; Space / click / `[` `]` do nothing with pictures only); its nit (middle-drag missing from the pictures hint) is added.

## 0.122.13 — 2026-11-24 — Lightbox: Tab right after opening refits the picture
- **What:** pressing Tab (library beside the viewer) right after the lightbox opened could leave the picture fitted to the old, wider window. Now it refits to the narrower viewer.
- **Where:** app/static/index.html `attachViewer` — the `.view` ResizeObserver, `openMode`.
- **Notes:** the observer used to drop its first callback as "the initial observation"; when the split landed before that first delivery, the dropped callback already carried the new width, and a picture fitted synchronously at attach (cached image) was never refitted. It now compares with the wrap size read at attach; a 0-size callback (closing / hidden) resets that size, so the wrap is reframed whatever size it comes back at. `openMode` on a 0-sized wrap (embedded pane not laid out) sets mode `"open"` and the observer picks fit / 100 % once there is a size (before: it chose 100 % and never fitted). Browser: Space + Tab dispatched in one task, image fills the 709 px viewer.
- **Review:** a fresh reviewer agent found no bugs in the fix; its note (a 0-wide wrap at `onReady` stuck at 100 %, pre-existing) is fixed as above; its follow-up (a wrap that goes to 0 and returns at the same size after an `onReady` in between was not framed) → the 0 branch resets the stored size. The same reviewer confirmed both fixes.

## 0.122.12 — 2026-11-24 — Arrow / line: the middle handle bends the curve in any direction
- **What:** the middle handle of a selected line or arrow can be dragged anywhere: the curve passes through it, so it leans toward one end as well as bowing out (Shift: a symmetric arc). Works in Sight, on the HTML review page and in the phone app (shared review-core).
- **Where:** app/static/review-core.js — `bendCtrl` / `bendHandle` read the new optional `data.bendA`, new `setBendAt`, `xfDrag` (bend / mid), `transformItem` (maps the handle, exact under any affine map); review-draw.js `roundItem` rounds `bendA`; FORMAT.md; MANUAL.
- **Notes:** `bendA` = the curve middle's offset along the chord (positive toward `pts[2..3]`), absent = 0; the control point is 2·H − M. A Sight / page / app without it draws a symmetric arc of the same `bend`. A curve with no `bend` (the default l/4) now gets an explicit one after any transform, so a mirror / non-uniform scale is exact (before: it kept its old bow). Backlog 15 (screenshot without the drawing) and 16 (slow large images) did not reproduce here; notes in PLAN-desktop-ui.md.
- **Review:** a fresh reviewer agent found: a curve with the default bend (null) skipped the transform branch, so a mirror kept its old bow (pre-existing; → the branch also runs for `body: "curve"`); `bendA` was not rounded in review-draw.js `roundItem` (→ added); FORMAT wording. The same reviewer confirmed the fixes and found nothing new. Verified in node: the handle sits on the curve at t = .5; a drag to (85, −30) on a 100 px chord puts the handle there; Shift drops `bendA`; an affine map sends the handle exactly to its image. Not driven in the browser UI (same `xfDrag` path as before).

## 0.122.11 — 2026-11-24 — Compare: drawing / note marks on the shared timeline
- **What:** compare's shared timeline shows a tick for every frame with a drawing or a note's picture, per clip, in the clip's colour (taller for a note), where that frame sits after the clip's offset. A click / tap on a tick goes to that frame.
- **Where:** app/static/compare.js — `loadMarks` (rows → marks, the rule of index.html `seqLoadMarks`), `setMarks` (exported), marks in `paintTimeline`, a mark press in the track's pointerdown, CSS `.cmp-mk`; annotate.js `renderMarks` calls `host.marksChanged` also when the viewer has no `.vbar` (compare); index.html compare annotator host `marksChanged` → `cmp.setMarks`; MANUAL.
- **Notes:** each video layer's marks are fetched once per compare (`l.marks`: undefined = not asked, null = asked); the annotated layer's are replaced live from `cmpAnnot.marks()` (skipped while its rows load). A layer removed and added again is a new object and fetches again. A press on a tick (11 px wide, full height) seeks and does not start a scrub. The lightbox's own `marksChanged` (`seqMarksFromAnnot`) now also runs when the lightbox has no bar (an image): guarded, harmless. Left: if the annotated layer's rows fail to load, its fetched marks are replaced by an empty list (network error only). Browser: two generated clips, a drawing at 2 s on clip B shows at 50 %; a pencil stroke on clip A appears at once; a click on B's tick lands on f 48.
- **Review:** a fresh reviewer agent found no bugs (edge case and nits above; a comment added for the lanes' nth-child order).

## 0.122.10 — 2026-11-24 — HTML review page: pictures grow to drawings past the frame
- **What:** on the exported HTML review page a note picture (and its thumbnail, the full-screen view and the downloaded picture) whose drawings reach past the frame's edge is enlarged to take them in, as Sight's own exports are; before, those drawings were cut off at the frame.
- **Where:** app/review.py `_HTML_TEMPLATE` — `extOf` (the rule of annotate.js `exportExtent`: drawings' bounds + 3% of the longer side, at most 3 frames each way; null for 3D / nothing outside), `placeExt` (box `aspect-ratio`, picture absolutely placed in %), `overlay(f, list, ext)`, `pic(..., flat)`, the viewer's `show()` (box aspect from ext), `savePic` (grown canvas, ≤ 8000 px a side); CSS `.fw.ext`; MANUAL.
- **Notes:** the overlay's viewBox becomes the grown area in vb units; colour areas still get `media.vb = vbOf(f)`, so they stay on the picture. The draft chip under the note field stays frame-sized (`flat`). The margin is a neutral grey (no Auto edge colour as in Sight); it is also under a transparent picture's see-through parts. `aspect-ratio` needs iOS Safari 15+. The phone app (mobile/js/app.js `overlay`) and the page's drawing canvas (review-draw.js) are not changed. Browser: rect at x 1000–1400 on a 1200×800 frame shows grown on the note, full screen, and downloads as 1439×939.
- **Review:** a fresh reviewer agent found: the downloaded picture (`savePic`) stayed frame-sized (→ grown the same way); a ~2 px drift on bordered thumbnails (→ `box-sizing: border-box`); notes on the grey under transparency and iOS < 15 (left, above). The same reviewer confirmed both fixes and found nothing new (nit left: the frame offset in the download is not rounded to whole px).

## 0.122.9 — 2026-11-24 — Library tiles snap to sizes that fill the row
- **What:** the grid's thumbnail size (right-drag up / down, window resize) snaps to the nearest size at which a row of tiles fills the width exactly — no empty strip on the right.
- **Where:** app/static/index.html `layout()` (cols = round of the asked size, cell = the fill width, kept within TILE_MIN / TILE_MAX); `.grid` CSS `scrollbar-gutter: stable`; MANUAL.
- **Notes:** `state.tile` stays the size asked for (stored, rescaled with the window, saved as app default); only the cell shown is snapped, so a drag moves between column counts and never drifts. The cell is floored to a quarter px from `clientWidth − 1` (a rounded clientWidth at 125 % / 150 % could overflow by a fraction). The stable scrollbar gutter is required: the cell now follows the width, so a scrollbar coming and going would change the row height and could toggle itself forever. Compact (list) mode is still chosen by `state.tile < COMPACT`, so a snapped cell can be a little under 72 px. Touch has no tile-size gesture (pre-existing, not added here). Browser: 1400 px window, right-drag through 120…345 px: rows end within 2.5 px of the content edge, no horizontal scroll.
- **Review:** a fresh reviewer agent found: a scrollbar that appears / disappears could resize the tiles forever (→ `scrollbar-gutter: stable`; side effect: a scrollbar-wide strip stays on the right on Windows even with no scrollbar, read as padding); a sub-px horizontal overflow at fractional DPR (→ `w − 1`). The same reviewer confirmed both fixes and found nothing new.

## 0.122.8 — 2026-11-24 — Drawing marquee stays upright on screen when the picture is turned
- **What:** the select tool's box (plain or Ctrl / Shift drag) is drawn and hit-tested as a box upright on screen; before, with a turned / mirrored lightbox picture it was a box in the picture's frame, turned with it.
- **Where:** app/static/annotate.js — `rawLocal`, `boxQuad`, `boxMeetsQuad` (SAT), `inQuad`; marquee start (two places in onDown), the `D.marquee` branch of onMove, the marquee in `renderSel` (now a `<polygon>`); MANUAL.
- **Notes:** `D.marquee` holds raw surface px (not unturned). It is drawn in the turned `.an-ui` layer as the unturned corners of the screen box, and tested in doc units as a convex quad: a drawing whose doc bbox touches the quad is in; a colour area only when all its bbox corners are inside. With no turn (boards, 3D, compare: no / identity `unturn`) it is the old axis-aligned test exactly. Browser: picture turned 90°, a screen box round a stroke selects it, the marquee's screen rect equals the dragged rect.
- **Review:** a fresh reviewer agent found no bugs (nit: a comment said "world coordinates" — reworded).

## 0.122.7 — 2026-11-24 — Lightbox: a panned picture turns about its own centre
- **What:** Shift+R, the turn button and Alt+drag turn the picture about its own centre, wherever it was panned to, instead of about the window centre (which swung a panned picture off screen). Mirror flips do the same.
- **Where:** app/static/index.html `attachViewer` — `pivot()` (window centre + `vs.pan`), `turnCss`, `unturn`, `zoomAt`, the Alt-drag claim, `pan` (`unturnVec` removed); MANUAL; ARCHITECTURE.
- **Notes:** `vs.pan` is now a screen-space move of the picture's centre (before: a move in the unturned frame). So a pan adds the raw pointer delta, and `zoomAt` keeps the pixel under the pointer by `C' = m − k·(m − C)` (no unturn needed, valid for any turn). `turnCss` and `unturn` share `pivot()`, so the drawings' layer (annotate.js takes `geom().turn` and `unturn`) stays aligned. Browser: pan, Shift+R → centre unchanged; pan while turned → moves with the pointer; wheel zoom while turned keeps the pixel under the pointer.
- **Review:** a fresh reviewer agent found no bugs; its nit (ARCHITECTURE still said "about the window centre") is fixed.

## 0.122.6 — 2026-11-24 — Dragged tile pile disappears on release
- **What:** the pile of dragged thumbnails no longer hangs at the drop spot while the drop target works; it hides the moment the drag is released.
- **Where:** `index.html` tile `dragstart` → `dropped` (window capture `drop`) hides `d.g`; `finish` still removes it on `dragend`.
- **Notes:** backlog item 4 (smart collection saved from Filter ▾ does not filter) did not reproduce: save from All / from Images, reload, click All then the row, name / kind / ext / path / Any-group rules all filter. Waiting for the owner's exact field / value. Review (fresh agent): no bugs found.

## 0.122.5 — 2026-11-24 — app/version.py restored (app did not start since 0.122.2)
- **What:** the 0.122.2 commit emptied `app/version.py`, so `from .version import APP_VERSION` failed and the app could not start on 0.122.2–0.122.4. The file is back.
- **Where:** `app/version.py`.
- **Notes:** after any agent edit, check `python -c "import app.version"` before committing — a truncated file passes review of the JS diff.

## 0.122.4 — 2026-11-24 — Notes panel: draggable left edge; picture-size drag 2.8x more sensitive
- **What:** the notes panel's left edge is a resize handle (mouse drag, touch drag, double-click / double-tap resets); the width is kept (`sight.annotate.panelw`). The right-drag that sizes the note pictures now moves 2.5 px per px (was 0.9).
- **Where:** app/static/annotate.js — `bindPanelEdge`, `applyPanelW`, `panelRoom`, `THUMB_PER_PX`; CSS `--an-pw` replaces the hardcoded 320px / 160px / 336px (lightbox, compare, bar, toasts, v3d panels); MANUAL.
- **Notes:** the width is the host's `--an-pw` inline px (capped at 80% of the window, 62% on a board); re-read from storage when the panel shows so lightbox / board / compare instances stay in step. Review (fresh agent) found: the compare view's hardcoded 320px, instances out of sync, no re-clamp on window resize, a dead zone when dragging past the cap, no touch reset: all fixed; the reviewer's re-confirmation of those fixes confirmed afterwards; its two nits (a resize listener leaked per lightbox open, a cancelled tap counting as a tap) are fixed. Browser: drag, persist, reset checked (mouse); touch and the right-drag sensitivity not exercised.

## 0.122.3 — 2026-11-24 — Tab: the library beside the lightbox opens on the current file
- **What:** turning the library split on (Tab, or the ◧ button) scrolls the grid to the file open in the lightbox, centred.
- **Where:** app/static/index.html — `toggleLightSplit`, new `scrollGridToLight` (uses `scrollGridToIndex`); MANUAL.
- **Notes:** runs once now and once in the next frame (the grid is re-laid out at its new width). Does nothing if the file is not in `state.items` (not paged in yet / filtered out), and does not run when the split is already persisted as on at lightbox open (not done). Tested in the browser with 300 files. Review (fresh agent): no bugs.

## 0.122.2 — 2026-11-24 — Thumbnail "N open" chip clears after the last note is deleted
- **What:** deleting the only open note in the lightbox review panel left "1 open" on the library card until a reload.
- **Where:** app/static/annotate.js — `noteSig()`; `load()` now primes `notesSig` from the loaded rows.
- **Notes:** `notesSig` was reset to "" per asset and never set by `load()`, so deleting the sole note gave sig "" == "" and `onReviewChanged` never fired. Verified in the browser (delete via panel, chip hidden). Review (fresh agent): no bugs. Known, left: `reload()` of the host does not call `onReviewChanged`; replies are not part of the signature (pre-existing).

## 0.122.1 — 2026-11-24 — Sidebar: Missing hidden at 0, review rows in their own "Reviews" section
- **What:** the *Missing* row under Types shows only while some files are missing (or its filter is on). The review rows (Open notes / Needs review / Changes requested / Approved) moved from Types into a new collapsible, drag-sortable *Reviews* section, hidden while all of them are empty. New backlog: `docs/PLAN-desktop-ui.md` (owner's desktop list, sorted S/M/L).
- **Where:** app/static/index.html — `NAV_SECTIONS` (+ "reviews"), `loadNavOrder` (keeps a saved order, inserts a new section after its default predecessor), `renderTypes`, new `renderReviews`, `bindSectionDrag` onReorder (a hidden section keeps its place); MANUAL.
- **Notes:** a section hidden at render time is not in the DOM, so a drag reorder re-inserts it from the old order — otherwise it would vanish from navOrder for good. Review (fresh agent): no bugs; its cosmetic note (new section landing at a fixed index in a custom order) is fixed. Browser: empty library shows neither Missing nor Reviews.

## 0.122.0 — 2026-11-24 — Windows taskbar shows "Sight Media Viewer", not Edge
- **What:** on Windows the app window's taskbar button and Alt+Tab name come from a Start Menu shortcut "Sight Media Viewer" instead of "Microsoft Edge". The window is given the app id `Sight.MediaViewer` (System.AppUserModel.ID) and the shortcut carries the same id.
- **Where:** Sight.py — `set_window_app_id()` (called from `reveal_when_ready()` once the window is found), `_store_set_app_id()`, `ensure_start_menu_shortcut()` (started in a background thread from `main()`), `set_shortcut_app_id()`, `shortcut_path()`; constants `APP_ID`, `APP_NAME`. app/version.py.
- **Notes:** the shortcut is written to `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Sight Media Viewer.lnk` on first start and rewritten when the app's folder or Python changes. It is a plain launcher (`pythonw Sight.py`, or the frozen exe). Icon: `app/sight.ico` (Windows: the shortcut, and the exe via build_exe.bat `--icon`) and `app/sight.icns` (macOS: the bundle via build_app_macos.sh `--icon`). Both are made by `tools/make_app_icons.py` from the sidebar/splash mark (favicon.svg geometry); re-run it if the mark changes. macOS: the bundle name stays Sight.app; `CFBundleDisplayName` = "Sight Media Viewer" is set in Info.plist for the Dock / Finder label (not run on a Mac: unverified). The mac icon sits on the standard 824 px grid with a shadow; the Windows one fills the tile. Tested on this machine: the window and the .lnk read back `Sight.MediaViewer`, and `--app-id` was tried and ignored by Edge (so the id is set on the window, not by a flag). NOT verified: the visible taskbar label itself (no screenshot taken). Chrome/Brave/Vivaldi windows get the same id, which is intended. Removing the app: delete that .lnk. Only ensure/set functions run on Windows; macOS and Linux are untouched. Review (fresh agent): nothing important. Applied: platform guard in `set_window_app_id`, and the release of the store is bound before the try, so the finally can always run (the second review found a NameError path in my first version of that fix, now closed). Left as nits: a python.exe fallback when pythonw.exe is missing (opens a console from the Start Menu), the shortcut rewritten on every start (two starts at once can race silently), and PropVariant 20 bytes on 32-bit Python (harmless: only vt and p are read).
