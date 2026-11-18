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

## 0.87.0 — 2026-11-18 — Compare: synced video on one clock, toolbar button, drop-to-compare, layer reorder
- **What:** compare clips play on one clock that waits for the slowest clip ("· loading" while held); scrubbing
  (mouse / finger) moves every clip; the video RAM cache is split between the clips around their playheads. The
  compare button moved from the notes panel to the viewer's top bar (greyed out with nothing to compare, badge =
  dropped files). Files dragged from the library beside the viewer (Tab) join a comparison with the open file;
  a drop no longer turns annotating on (only while annotating does a picture become a reference). Touch: select
  files in the library beside the viewer and tap the button. Layer chips reorder by mouse drag or touch hold+drag;
  the order is the split / tile order and is kept in a note's comparison (`session().ids`).
- **Where:** compare.js (`syncVideos` / `canGo`, `paintMirrors`, `pushFocus`, `mkMedia` / `refCopy`, `C.scrub`,
  touch reorder in `bindUi`, `captureView`); library.py `SlidingVideoCache` (`_Window`, `focus_many`); server.py
  `/api/video/focus` `items`; index.html (`#cmpBtn`, `lightCompareIds`, `addToCompareStack`, `paintCmpBtn`,
  `compareFromContext`, focus handling); annotate.js (`onRefDrop` → `host.dropForCompare`, `host.onVersions`,
  versions-row Compare removed); MANUAL, ARCHITECTURE.
- **Notes:** root cause of the desync: the clock ran on while a clip seeked; a 4K / long-GOP seek took longer than
  the 0.25 s tolerance, so the clip was re-seeked forever (6 × 4K60: up to 7.9 s apart → < 0.3 s). Invariant: never
  seek towards a running clock. Paused-clip "ready" = frame + 0.4 s buffered (Chromium keeps paused elements at
  HAVE_CURRENT_DATA). Hung seek > 8 s re-issued; a clip at its end is never play()ed. The lightbox `focus()` is one
  cache window; closing compare re-focuses it. `light.cmpStack` survives moving between its own files. Not done:
  6-connections-per-host with 6+ clips on slow storage; reorder not written back to the drop stack; the button
  ignores note-stored comparisons on files without versions. `tests.test_board_missing` fails on master already
  (UNIQUE board_items.id) — unrelated.
- Review (fresh agent, run by the implementing agent): 8 findings (end-of-clip play() restart, re-seek timer
  counting the seek, lightbox focus wiping compare's windows, hidden reference without a window, stack edge cases,
  mirrors painting mid-seek, stuck scrub, Windows press-and-hold menu). All fixed; same reviewer confirmed.

## 0.86.0 — 2026-11-18 — Number pins with a leader line; note icons on hover; Ctrl+C copies hovered note text; Shift = H/V
- **What:** owner's asks.
  - The note pin tool is now a *number pin*: a click puts a numbered circle, a drag draws a line from the press
    point with the circle where it is let go. A small field then takes the number (Enter / tap elsewhere; empty =
    the next free number; Esc drops a new pin). A click with the tool on a pin, or a double-click with another
    tool, edits its number. The tool no longer focuses the note composer, which had swallowed every hotkey.
  - Shift while drawing (straight stroke, line / arrow, pin line, dragging a line's end) keeps the line horizontal
    or vertical instead of snapping to 15° (rotation still uses 15° steps).
  - A note card's action icons show on hover only; on touch, on the picked card.
  - Ctrl+C with the pointer over a note's / reply's / picture's text (the panel or the text plate) copies that
    text, with a "Copied" toast.
- **Where:** review-core.js: `primsOf` pin (`label`, leader `ax, ay`), `pinLeader` / `pinLineW`, `boundsOf`,
  `hitTest`, `transformItem`, `snapHV` (exported; used by `xfDrag` line ends). annotate.js: pin branch in
  `onDown` / `onMove` / `onUp` / `abortGesture`, `editPin` / `finishPinEdit` / `nextPinNumber` (`S.pinEdit`,
  `.an-pinedit`), `copyHoveredText` (onKey, composer / caption fields), `snapAngle = RC.snapHV`, CSS
  `.an-nh .an-ib`. FORMAT.md pin; MANUAL.
- **Notes:** `label` is a string set when the pin is created (the next free number among this media's pins; older
  pins count with their note number). Pins without `label` / `ax, ay` render as before (the note's number, no
  line); older clients show new pins that way too. The leader is drawn only when its start lies outside the circle.
  The phone / HTML drawing canvas (review-draw.js) has no pin tool; it draws, moves and hit-tests pins through
  review-core, so leaders follow there too. The hovered-text copy steps aside for a real text selection, also
  inside a focused field. On touch there is no Shift, so no H/V constraint there.
- Review (fresh agent, run by the implementing agent): 6 findings — Ctrl+C dead while the composer kept focus; a
  press while the number field was open only confirmed it (every other quick click placed a pin, a double-click
  on a pin flashed the field); the circle showed a different number than the field until confirmed; a short drag
  ending inside a pin stacked a duplicate; a stale comment — all fixed; compare-mode copy not applicable. The same
  reviewer confirmed all fixes, nothing new.

## 0.85.0 — 2026-11-18 — Lightbox video bar: sound, scrub audio, loop, typed frame jump, Shift+arrows
- **What:** the lightbox video bar gets a sound icon (click = mute, press-and-drag up or the wheel = volume with a
  pop-up slider, right-click or long press = sound while scrubbing, shown by an accent dot), a loop button, and a
  clickable position field (type a frame / time + Enter to jump, Esc cancels; right-click or long press = display
  Frame / Time / Frame+time and Local / Global counting — Global only in a sequence of 2+ clips).
  Shift+← / Shift+→ jump to the first / last frame (of the whole sequence when one plays).
- **Where:** index.html (CSS `.vib` / `.vpop` / `.vtime-in` / `.vctx`; vbar markup; block before `bindVBar`:
  `vgesture`, `vApplySnd`, `vApplyLoop`, `vposPaint`, `vposJump`, `vposEdit`, `vposMenu`, `vClips` / `vPos`,
  `vClipFps` / `vFpsMap`, `bindVBarUi`, `lightEdgeJump`; `paintVBar`, `attachViewer`, `seekVideo` /
  `scrubBlip`, `endScrub` / `endBlip`, `seqAdopt` unmute, `closeLight`, keydown Shift+Arrow); annotate.js
  (`fps()` accessor, `followOff` ignores `_blip`); MANUAL.
- **Notes:** prefs in localStorage `sight.vsnd`, `sight.vpos`, `sight.vloop` (type-checked on read; the phone app
  has its own keys). The mobile code has no volume popup — only its gesture logic and icons are reused. The loop
  button hides in a sequence (its bar has its own loop; `el.loop` stays off there because `ended` drives
  `seqAdvance`). Scrub audio = a 90 ms play blip per seek; `el._blip` keeps blips out of `_seqPlayedAt` / the
  annotator's follow tick, and the scrub end re-seeks to the pointer time (the blip ran past it). Frames are 0-based,
  floor-based (as annotate's `stepFrame`); fps comes from the annotator when known, else from
  `/api/assets/{id}/info` (cached per id); "≈" until known. Global frames sum each clip's own
  round(duration × fps). In frame modes a bare number (also decimal) is a frame; `12s`, `1:05` are times; `f120`
  a frame. The position input closes on any outside pointerdown. Not done: the sound icon does not grey out for
  clips without audio (mobile does).
- Review (fresh agent): 8 findings — blips left the paused frame ~90 ms past the release, the loop button never
  hid (`.vib` display overrode `[hidden]`), a TypeError closing the lightbox with the field open, the field staying
  focused after a track click (swallowing keys), global frames using one clip's fps, fps unknown outside annotate,
  inconsistent decimal parsing, the sequence-cut unmute timer overriding a user's mute. All fixed; the same
  reviewer confirmed them and noted two leftovers (board-opened video got no fps, Shift+→ used the current clip's
  fps for the last clip), fixed.

## 0.84.2 — 2026-11-18 — macOS: restoring a minimized window no longer shows "not responding"
- **What:** macOS: restoring a minimized Sight window no longer makes macOS report "Sight not responding", and a
  window left minimized for long no longer comes back to a dead page. Sight.app is now an agent with no Dock
  icon: the window lives under the browser's own icon.
- **Where:** build_app_macos.sh (sets `LSUIElement` and `NSAppSleepDisabled` in Info.plist with PlistBuddy, then
  re-signs ad hoc); Sight.py (`_open()` passes the anti-throttling Chromium flags on every platform; new
  `mac_agent_note()` logs whether the bundle is an agent; the watchdog logs why it quits).
- **Notes:** root cause (read from code, ~75% sure, not run on a Mac): Sight.app's main thread is uvicorn and never
  runs a Cocoa event loop, so as a regular Dock app it could not answer the reopen Apple Event sent by a click on
  its Dock icon. Do not give Sight.app a Dock icon / tray again without a real NSApplication loop on the main
  thread (pyobjc) and uvicorn moved to a thread. Second cause: on macOS / Linux Chromium throttled a minimized
  window's 3 s heartbeat to once a minute, so the 10 s watchdog quit the server; the flags were Windows-only
  (Windows command line unchanged). Editing Info.plist after PyInstaller needs the ad-hoc re-sign. Gap: an agent
  app still cannot answer the logout / shutdown quit event (true before too). Needs a check on a Mac build:
  minimize 1 min and 6+ min, restore, log has no "no heartbeat … quitting".
- Review (fresh agent run by the fixing agent): no correctness bugs; Windows command line confirmed unchanged.

## 0.84.1 — 2026-11-18 — 3D: notes panel shows the drawings right away
- **What:** opening the notes panel on a 3D model now shows its annotation drawings at once (before, only after
  clicking a note — and in fact not even then). With annotation mode off they show, not editable, and follow the
  camera: a drawing shows only while the camera is on its view. The eye button / Shift+H toggle them in 3D too.
- **Where:** annotate.js — `shownOff()` includes `model3d` when `S.b3` is bound; `followOff()` keeps the tick
  running for 3D while drawings exist and are not hidden.
- **Notes:** root cause: `shownOff()` covered images, video, PSD and boards but not 3D, so outside annotate mode
  3D never created / unhid its drawing layer. The compare overlay is unaffected (`showWhileWatching: false`).
  The 3D tick runs every frame while drawings exist and annotation is off (cheap signature check; repaints only
  on camera / hidden-mesh / explode / view change); it ends when `S.b3` goes null or drawings are hidden.
- Review (fresh agent): no findings (rAF teardown, null `S.b3` mid-tick, compare, Shift+H vs 3D H keys,
  pointer-events on the layer all checked).

## 0.84.0 — 2026-11-18 — F fits / finds, long-press resets the annotation bar, modifier cursors
- **What:** F fits the open picture / video to the frame in the lightbox (like double-click, but always fit); over
  the thumbnail grid F scrolls to the selected files. Long-press (700 ms, mouse or touch) on the annotate button
  resets the whole annotation toolbar to defaults (toast). The cursor on a picture / video shows what the held
  modifier does (Alt turns a picture / scrubs a video, Ctrl+Alt turns a video, Shift = fine scrub) and during
  pan / zoom / turn drags. The screenshot / area-screenshot buttons are gone from the annotation toolbar
  (S / Shift+S and the composer's buttons stay).
- **Where:** index.html (`light.fit` / `toFit` in `attachViewer`, F in the keydown handler, grid F in a
  window-level capture keydown listener, `bindAnnoReset(btn, annots)`, body classes `k-alt` / `k-ctrl` / `k-shift`
  + `.view` cursor CSS, drag cursors in `attachViewer`, `.vid` class); annotate.js (`resetPrefs(quiet)`, removed
  shot / region buttons, help footer); MANUAL.
- **Notes:** 3D models and canvas boards keep their own F. The grid F listener is capture-phase on `window` so the
  board's F (canvas.js, on document) does not also frame the board in the split view; it swallows repeats too.
  `resetPrefs` covers styles, stamp look, hold and tool for all three annotators (lightbox, board, compare —
  otherwise a stale one saves its old styles back over the reset); not the per-video stamp on/off, drawings,
  notes. The long-press swallows its release click in the capture phase, `fired` is cleared 60 ms after release.
  Modifier classes re-sync on pointermove and clear on blur. An annotator tool's inline cursor wins over the CSS.
- Review (fresh agent): 3 findings — compare annotator not reset (overwrote the reset), a stale long-press flag
  swallowing the next keyboard activation, F framing the board as well as scrolling the grid in split view. Fixed;
  the same reviewer confirmed them and noted held-F repeats still reaching the board (fixed: repeats swallowed).

## 0.83.1 — 2026-11-18 — Reference shadows follow the picture's alpha
- **What:** a reference image with transparency (PNG / WebP) now casts a drop shadow of its alpha shape instead
  of its rectangle — in Sight, the HTML page, the phone app and canvas exports (screenshots / PDF).
- **Where:** review-core.js — `primsOf` image branch (a shadow-only image prim `p.shadow = {dx, dy, blur, a}`
  before the picture), `primSvg` (black `feColorMatrix` + `feGaussianBlur`, `filterUnits="userSpaceOnUse"`
  with an explicit region, unique `rcshN` ids), `primCanvas`.
- **Notes:** canvas path avoids `ctx.filter` (no Safari): it uses `shadowBlur` with the image drawn off-canvas in
  device space (`setTransform` shift by D past the image's device bbox, `shadowOffsetX += D`), skips the shadow
  when its box misses the canvas, and falls back to an offset rect without `getTransform`. Canvas shadows ignore
  the transform, so offset / blur are converted with `getTransform()`. Bordered refs keep the old stacked-box
  shadow (opaque frame). An unloaded picture has no shadow. Needs an on-device iOS check (very large shadow
  offsets).
- Review (fresh agent): 4 findings — a ghost copy of the picture when it sat off the right edge in canvas exports,
  flipped (negative size) refs getting a 1 px shadow, no fallback without `getTransform`, a filter region
  rebuilt on the unclipped image every drag frame. All fixed; the same reviewer confirmed the fixes, nothing new.

## 0.83.0 — 2026-11-18 — Importing a review file offers to restore notes / drawings deleted here
- **What:** owner's report "the review file does not restore notes and drawings". Not a bug in the merge: rule 5
  (FORMAT.md) keeps a row deleted here when the delete is later than the file's copy. Now the import counts
  such rows and asks *Restore them?*; yes merges the same file again with restore on and they come back.
- **Where:** library.py `import_annotations(restore=, kept_deleted=)`; review.py `import_package` /
  `import_review_file` (`restore`, result key `deleted_here`, per clip in a bundle); server.py
  `/api/review/import?restore=1`; annotate.js `importFile` (two POSTs, counts of both passes summed for the toast);
  tests (test_merge_parity `test_restore_deleted_here`, test_review_bundle `test_restore_rows_deleted_here`);
  FORMAT.md rule 5, MANUAL.
- **Notes:** Sight only — the JS `mergeRows` has no restore (default path unchanged, parity holds; stats keys
  unchanged, the ids go to the `kept_deleted` out-list). A restored row is stamped as edited now (note
  `data.edited_at`, drawing `updated_at`) so the file's / a later package's old tombstones do not delete it
  again and other copies revive it on merge. A restore *undeletes*: when the local copy was edited after
  the file was made (then deleted), the local copy comes back, not the file's older one. The question is the
  native `confirm()` (works on touch too) and says "deleted in this library" (a reviewer's tombstone counts too).
- Review (fresh agent): 3 findings — a failed restore pass hidden by the success toast (now reported after the
  normal reload), a bundle clip merged in pass 1 shown as damaged when pass 2 failed (keeps its pass-1 result),
  restore overwriting a newer local copy with the file's older one (fixed as above, test added); prompt wording
  changed. The same reviewer confirmed all fixes, nothing new.

## 0.82.0 — 2026-11-18 — Phone / HTML page drawing: arrows along a stroke and lasso brush
- **What:** owner's ask. The shared drawing canvas (review-draw.js: the HTML page, the phone app) can now make
  0.81's new drawings. *Arrows and lines* row: a sixth kind, *Arrows along a stroke*; with it in hand the row
  ends with three tap-to-cycle icon switches (side left / right / both, away / toward, guide on / off). The brush
  slot became a two-kind slot (brush / lasso); the lasso's row ends with a pattern button opening a second row
  (none, solid, 8 patterns, random).
- **Where:** review-draw.js — `ARROWS` + `stroke` entry, `ASTROKE_OPTS` / `ASTROKE0`, `BRUSHES`, `PATTERNS` /
  `LASSO_PATS` / `RANDOM_PATS` / `patIco`, `astrokeButtons`, `patternButton`, pen keys `brush` / `lasso` /
  `astroke` (saved with the pen), `begin` (lasso keys on the brush; `stroke.t = "astroke"` makes a
  `stroke / arrows` item), `extend` / `finish` treat "astroke" like a brush stroke (dropped under 3 px),
  `roundItem` rounds gap / step / len. MANUAL.
- **Notes:** no new controls for spacing / length / density / fill colour / fill opacity on the phone (the bar
  stays small): arrows `step` = 10 × size, `len` = 6 × size (min 12 / 8 px); lasso `gap` = 1.7 × brush size (min
  5 px), fill = line colour at 0.5 — Sight's panel edits them afterwards. `PATTERNS` is a copy of review-core's
  (RC is looked up only on open, after this script's top level runs). The cycle switches set the pen only — they
  do not restyle selected arrows strokes; picking the stroke kind with arrows / lines selected takes the tool
  instead of converting them. Picking the stroke / lasso kind reopens the row so its switches show. Supersedes
  0.81's "Not done" about review-draw.js. Hold-to-resize on a selection: an arrows stroke resizes its `width`
  (`wkey`), and `gap` / `step` / `len` follow the thickness by the same factor (as RC.transformItem).
- Review (fresh agent): 2 findings — the brush slot (now a group) fell into `groupSel`'s shapes branch, so with
  the transform tool and a shape selected, tapping Brush / Lasso turned the shape into a rectangle instead of
  taking the brush (`groupSel` now returns [] for slots other than arrows / shapes); hold-to-resize did nothing
  on a selected arrows stroke (no `size`) — fixed as above.
  The same reviewer confirmed both fixes; its one edge note (a hand-made 0 thickness → Infinity) is guarded.

## 0.81.0 — 2026-11-18 — Arrows along a stroke; brush lasso close with pattern fill
- **What:** owner's ask. Arrow tool: a *Stroke* on / off icon button in its bar (the tool icon follows); *Stroke* draws a freehand stroke with
  arrows spread along it, turned to its normal — *Every* (spacing), *Length*, *Tip*, *Away / Toward*,
  *Left / Right / Both*, *Guide* (stroke drawn or not) + its dash. Brush: *Close* (lasso: end joins start) with
  *Fill* none / solid / 8 patterns / *Random*, fill colour, *Fill α*, *Spacing*.
- **Where:** review-core.js (`STROKE_TOOLS` + "arrows"; `PATTERNS`, `hatchPath` / `dotsPath` / `fillPrims`;
  `arrowsGeom` / `arrowsPrims` / `arrowsReach`; `strokeOutline` closes `data.close`; bounds / hit / transform),
  annotate.js (DEFAULT_STYLES brush / arrow new keys, LEN_KEYS gap / step / len, P.close / pattern / ipattern /
  bfill / gap / amode / ahead / step / alen / adir / aside / guide, `ARROWS_PROPS`, PROPS.arrows, props `when` /
  `edit` filters in `renderProps`, `t: "cycle"` props (one icon button stepping through options; `fixed` = an
  on / off button for a string value), `ico` on toggles, paintBar arrow icon by mode, onDown "arrows" branch, `RANDOM_PATTERNS`, onUp drops a < 3 px arrows
  stroke, partial eraser opens a cut lasso), FORMAT.md, MANUAL.
- **Notes:** new drawing type `kind stroke / shape_kind "arrows"` (not a mode flag on `arrow`: its geometry is
  a polyline, and older clients skip it cleanly instead of drawing a wrong straight arrow). "Random" is resolved
  when the stroke starts — the item stores the real pattern (the selection's Fill list has no Random:
  `P.ipattern`, `edit: true`). Patterns are geometry clipped to the polygon (no SVG `<pattern>` / clipPath ids:
  ids differ between clients, same reason as the image shadow) — so SVG, canvas exports, the HTML page and the
  phone draw them identically; nonzero fill everywhere (solid, hatch scanlines with winding counts, dots / hit `inPoly`), so a lasso drawn round
  twice stays filled; capped at 300 lines per direction and ≈ 4k dots (re-rendered on every pointer move) —
  line width / dot radius / dashes follow the capped spacing.
- Review (fresh agent): 7 findings — even-odd vs nonzero mismatch (double-wound lasso hollow, solid not
  clickable), empty undo steps / server updates from the partial eraser, slow dense dots, unhittable lasso seam,
  a cut lasso split at its seam, arrows hit on their empty side, old brushes closed later with no fill settings;
  all fixed. Re-review confirmed them; then: widths not following the capped spacing, a cycle button's first
  click with a missing value, the arrow tool's icon — fixed; the reviewer confirmed all, nothing open.. Props `when(get)`
  hides keys that do not apply (Stroke-only keys, fill keys while Close is off). A mirror swaps an arrows
  drawing's left / right. Not done: the HTML page's / phone's own drawing toolbar (review-draw.js) has no
  Stroke-arrows / Close tool yet — they render and transform such drawings, but cannot make them.

## 0.80.0 — 2026-11-18 — Annotation tools cleanup: crop fix, shape tool, note editing, independent panel
- **What:** owner's list. Reference-image crop now actually clips (it only moved the box). Notes panel: a pencil
  on each card (hover; on the picked card for touch) and double-click on the text both edit it (double-click
  did nothing). Picture-text plate keeps its current size while editing. Tab split hides the sidebar's Canvas
  section. Drawing tools (✎ / Shift+A) and the notes panel (speech bubble / C) are independent; the toolbar's
  panel button is gone in the lightbox / board. Annotating always starts with the brush. Line tool removed
  (arrow with heads "none"); rectangle + ellipse are one shape tool (R / O, *Shape* ▭ / ◯ in the bar), no
  Stroke switch, fill off and 50 % by default. A note pin of the note in the making shows the number the note
  will get (was "•"). Onion skin no longer collapses to the picked note when a note / its picture is clicked.
- **Where:** annotate.js (`.an-layer > svg`; `editNote`, `data-edit` / `.an-nedb`, `e.detail > 1` guard;
  `togglePanel` / `panelShown` on `S.readOn` only; `toggle` brush; TOOLS / `setShape` / P.shape / PROPS.rect;
  `loadStyles` migration; `numOf`; `onionOn` / `viewMode`), caption-plate.js (`.editing` rules, min-height pin
  in `startEdit`), review-core.js (image prim's nested svg gets an inline size), index.html (`.nav-canvas`),
  MANUAL.
- **Notes:** root cause of the crop: `.an-layer svg {width:100%; overflow:visible}` also hit the nested `<svg>`
  an image prim clips with; any host CSS `x svg {width:100%}` does the same (note-card previews, HTML page,
  phone), hence the inline style in review-core — keep it. `S.panelOn` now serves only `readPanel: false`
  hosts (version compare), whose toolbar panel button stays. Shape tool keeps id "rect" (saved styles); old
  `line` / `ellipse` items and `setTool("line"|"ellipse")` still work. Onion skin: a pick narrows nothing
  unless a new note is being composed. The fill 20→50 % migration runs once (`sight.annotate.fill50`).
  Verified with Playwright (crop, pencil / dblclick edit, plate sizes, Tab split, panel/tools independence,
  O/R, pin number, onion ghosts after a pick).
- Review (fresh agent): picked note hidden while composing with onion on, 20 % fill reset on every load,
  nested-svg stretch in previews / page / phone; fixed. A claimed "old loose pins get a number" was withdrawn
  by the reviewer (addNote adopts every loose drawing, so the number is right). Re-review: the fill migration
  must save the migrated styles with its marker (else lost, and the board / compare annotators missed it) —
  fixed; the other fixes confirmed.

## 0.79.0 — 2026-11-18 — Reference images on the frame (crop, frame, shadow); library beside the lightbox / player (Tab)
- **What:** owner: reference pictures in the annotating mode of the lightbox and the video player, a toolbar icon,
  settings crop / frame (width, colour) / shadow (strength); pictures dropped onto the frame from outside or picked;
  picking = the board's way (sidebar + thumbnail grid left of the player, a vertical divider) as a mode of its own
  on Tab and a button at the left of the top bar, like the board's. New drawing kind `image` (tool `Shift+I`):
  drop OS files / drag grid files onto the frame (any tool, the mode turns on), click the frame with the tool
  (file picker, placed there), props-bar *From disk… / Library / Add selected* (touch). Selected: Frame, Frame
  colour, Shadow, Opacity, *Crop* (or double-click; Enter / Esc / a press elsewhere ends) and *Reset crop*.
  Tab / ◧ (`#libBtn`, lightbox bar's left end) = library beside the lightbox; Tab on a board toggles its split,
  and the board's ◧ moved to the left of the top bar.
- **Where:** review-core.js (`setImageSource / imageUrl / imageEl / imagesReady / imgCrop`, image prims in
  `primsOf` / `primSvg` / `primCanvas`, bounds / hit / transform / `validItem`, JS merge remaps `data.shot`),
  annotate.js (TOOLS / DEFAULT_STYLES / P / PROPS `image`, `cropFrame` / `applyCrop`, `addRefs` / `storeRef` /
  `pickRefs` / `onRefDrop` / crop mode, `S.crop`), index.html (light split: `applyViewDom`, `placeLightSplit`,
  `toggleLightSplit`, Tab; annotator host `toggleLibrary / pictureSources / selectedPictures`, `pictureSource`;
  board annotator `refImages: false`), review.py (`build_package` ships the shot; HTML page image source,
  `savePic` waits for decoding), library.py (`import_annotations` remaps `data.shot`), mobile (`refShots`,
  `shotIds`, `burn` waits), FORMAT.md, ARCHITECTURE, MANUAL.
- **Notes:** the shadow is six stacked translucent rounded boxes (no SVG filter: filter ids would clash between the
  many SVGs on a page and the canvas has no portable blur) — the same in SVG and canvas, PDF included. A picture
  is stored once per add (a duplicate / copy shares its shot). The crop is in source-picture units, so the picture
  is never stretched; the box is the visible part. Library files: the file when the browser decodes it, PSD's
  composite, else the thumbnail. Not done: pasting a picture from the system clipboard; reference images on boards;
  editing them in the HTML page / phone app (they show there, read-only geometry). Verified with Playwright on an
  isolated SIGHT_HOME: Tab split (lightbox left at the divider, grid shown, back on close), OS-file drop, grid
  drop, Add selected on a video (ctx = the frame), crop by the east grip ([0,0,0.607,1], box narrowed), screenshot.
- Review (fresh agent): the phone repainting forever when a reference image's shot is missing from the package
  (and leaking object URLs), pictures landing on another frame when the video was scrubbed during the upload, Shift+I
  picking a hidden tool on a board, a click inside the crop window making an empty undo step, phone reports / note
  cards burning grey placeholders before the pictures were known, Tab toggling the split behind the stamp popup /
  dialogs, the grid's touch selection bar under the lightbox, a decoded-picture cache never cleared on a new source,
  SVGs with only a viewBox failing; fixed (`rv.refAsked` / `refWait`, ctx taken before the uploads, `setTool` gate,
  2 px threshold, `await refShots` before the report, Tab gate, `--light-l`, cache cleared in `setImageSource`,
  1024 px fallback). Accepted: no LRU on the cache. Re-review: the same reviewer confirmed all nine fixes.

## 0.78.0 — 2026-11-18 — Phone: review a group as a sequence, clip by clip
- **What:** owner: reviewing a sequence on the phone meant going back to the list after every clip. Now a tap on
  a group's picture opens its sequence on the clip last seen there (else the first); the review header of any
  grouped review has ‹ / › around the title and "group · 2 / 5" in the subtitle; Page Up / Page Down on a
  keyboard. Back leaves the sequence in one step. Works for pictures and 3D models too.
- **Where:** mobile/js/app.js (`seqOf`, `openSequence`, `seqRemember`, `seqGo`; `openReview(…, opts.replace)`;
  `renderReview` header, `paintReview` subtitle `els.seq`; group header `thumb`; keydown table),
  mobile/index.html (`.seqb:disabled`), tests/pwa_e2e.cjs `bundle` + test_pwa.py `test_bundle`, MANUAL, ARCHITECTURE.
- **Notes:** the sequence = the review's UI group (`g.keys` order), not `meta.groups`. No wrap at the ends. No
  swipe on the player for clip switching (it competes with scrub / pinch / drawing) — buttons serve touch. A
  clip switch flushes edits (openReview) like Back does; an unsent composer draft is dropped as on Back.
- Review (fresh agent): `pushed` was read from a review still loading (Back out of step after quick ›) → the
  history entry is settled before any await, an overtaken unshown review hands its entry over, `openingKey` is
  the base for quick taps; Back during a loading › was undone → `++openSeq` in leaveReview / route; PageDown
  during an export swapped clips → no switch while `.busy`; hidden reviews were in the sequence → `seqKeys`;
  a deleted clip was a dead end → dropped from the group and skipped. Nits: `openingKey` cleared on a thrown
  open (wrapper `openReview` → `openReviewNow`), header refreshed after a drop (`paintSeq`, player untouched).
  Confirmed by the same reviewer.

## 0.77.0 — 2026-11-18 — The phone app opens and answers a sequence's `.srev` bundle (multi-clip plan, stage 3)
- **What:** opening a bundle on the phone merges every clip into its own review (one summary toast: damaged
  clips / non-media named, the rest land; "same file as clip N" for a duplicate) and puts them in one home
  group named by the bundle's title; a review with no media on the phone is greyed ("Media not on this
  device — notes readable") until its file is picked. The group's menu has *Review file for Sight (.srev)*:
  one bundle of the clips changed since the last send, with the received bundle id (nothing changed → asks
  to send all). Works for user-made groups too (their own id). A one-clip bundle behaves like a package.
- **Where:** mobile/js/model.js (`parseReviewFile`, `buildBundle`, `checkPackage`), mobile/js/app.js
  (`importReviewFile` split into `reviewKeyFor` / `mergeInto` / `importBundle` / `bundleGroup`;
  `dirty(user)`, `packageOf`, `isChanged`, `markSent`, `exportBundle`, `offerFile(…, onSent)`, `nomedia`
  row), mobile/index.html (`.row.nomedia`), tests/pwa_unit.cjs, tests/pwa_e2e.cjs `bundle`,
  tests/test_pwa.py `test_bundle`, MANUAL, ARCHITECTURE, FORMAT, PLAN-multiclip, PLAN-mobile.
- **Notes:** no IndexedDB version bump: new meta fields `groups`, `changed`, `nomedia`. `changed` = time of the
  last user edit; merges never set it (`dirty(false)`); a send clears it only if it is unchanged since the
  package was built. Missing `changed` (made on the phone / before 0.77) counts as changed — extra clips are
  harmless under the merge rules. The UI group holds a review at most once; a reply takes the group's keys plus
  every review whose `meta.groups` has the bundle id. "Merge a review file…" with a bundle imports it as a
  bundle (not into the open review). Merge code untouched (merge parity).
- Review (fresh agent): a review opened mid-import could read its rows before the merge and drop it on the next
  save → busy overlay over the import loop; a lone clip of a later bundle did not join the bundle's existing
  group → `bundleGroup` for any clip count; bundle `version` parsing now matches Python's `int(v or 0)`. All
  confirmed by the same reviewer. Left as is: back / forward during the import can still open a review
  mid-merge (deliberate action, tiny window); `version: []` / `"1_0"` parity quirks.

## 0.76.0 — 2026-11-17 — One web page for a sequence's review (multi-clip plan, stage 2)
- **What:** Sequence → Export → *Web page, all clips* writes **one** page (was one per clip). It has a clip strip on
  top (name, notes, open notes; a dot = changed here), ‹ / › buttons, `←` / `→` (not in text fields, the full-screen
  picture, the drawing canvas or a sheet). The bottom bar counts every clip; *Download reply* = one `.srev` bundle of
  the changed clips with the page's bundle id; *Discard* asks this clip / all clips (Esc / Cancel / backdrop close);
  the clip's details (tap the title) have *Download this clip's reply* — a plain package for Sight < 0.75. Switching
  clips resets the search / state filter. A sequence with one clip with notes gets the ordinary one-clip page.
- **Where:** review.py (`build_html` → `_page`, new `build_html_all`; page script: `useClip`, `switchClip`, `CL`,
  `slotKey`, `changesOf` / `editsOf`, `clipCounts`, `paintStrip`, `replyPackage(c)`, `download` / `downloadClip`,
  `discard`, `header()` clears first, `closeEmpty(target, noRender)`; `plate_js` exposes `hotkey` / `runHotkeys`),
  server.py (`/api/review/export/html-all`, returns `clips`, `missing`), index.html (`seqExportAll` html → one post),
  tests/page_multi_e2e.cjs + test_review_page.py `MultiClipPage`, MANUAL, ARCHITECTURE, PLAN-multiclip.
- **Notes:** data block is now `{clips: [{report, package, edits?}], bundle?, copy?}` (a one-clip page too; `bundle`
  only with 2+ clips). One-clip page invariants kept: storage key `sight-review:<asset id>:<exported_at>[:copy]`,
  reply = plain package (`page_e2e.cjs` passes unchanged). Multi-clip key `sight-review:<bundle id>:<asset id>[:copy]`.
  All clips' edits live in memory (`CL[i].E`, the shown one is `E`; `editsOf(c)` reads the right one) and each save
  writes the shown clip's slot. The page's clips = clips with notes (client scan, as before); a tombstone-only clip
  is not on the page (deletes travel in the `.srev` bundle). A composer with a picture still loading counts as not
  empty and cannot send (`dr.pending`). Stage 3 (phone) not started.
- Review (fresh agent): no correctness bugs; low items fixed — a picture still loading was lost on a clip switch
  (field closed as empty), search / filter carried over to the next clip, discard sheet had no keyboard close,
  missing clips dropped silently from html-all, the strip scrolled on every save. Re-review: names of missing clips
  came out as "clip" and Send could be pressed mid-load → fixed; then Send could stay disabled after a re-render
  mid-load → fixed (`render()` when the field was replaced); all confirmed by the same reviewer.
