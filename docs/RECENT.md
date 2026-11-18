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

## 0.75.0 — 2026-11-17 — `.srev` bundle: a sequence's review in one file (multi-clip plan, stage 1)
- **What:** Sequence → Export → *Review file (.srev), all clips* writes **one** file (a bundle, FORMAT.md "Bundle")
  instead of one per clip; clips with notes or with tombstones (all notes deleted since) go in. Importing a bundle
  (drop, Export menu, palette) merges every clip in the library and shows one summary ("2 clips updated · 1 not in
  your library: x · 1 damaged · y: same file as clip 1"); the others still land. Exactly one clip updated → it
  opens as for a plain package; otherwise nothing new opens, open affected clips reload (undo cleared) and the
  sequence's off-screen timeline marks are re-read. Also: the import toast without a lightbox (dropped on the grid)
  now shows (page `flash`, plain text) — before it went to `#v3dToast`, which exists only in the lightbox.
- **Where:** review.py (`parse_review_file`, `build_bundle`, `find_review_asset`, `import_package`,
  `import_review_file`), server.py (`/api/review/import` → `import_review_file`; new `/api/review/export/package-all`
  with `asset_ids`), annotate.js (`importedBundle`, toast passes `ms`), index.html (`seqExportAll` "pkg",
  `seqReviewChanged`, `htmlToText`, main host `toast`), tests/test_review_bundle.py, tests/test_pwa.py
  (`sight_import` calls the shared function), FORMAT.md, MANUAL, ARCHITECTURE, PLAN-multiclip.
- **Notes:** packages inside are unchanged and merge by the same code (merge parity untouched). A plain package's
  import response is exactly as before (404 missing / 400 damaged); a bundle is always 200 with `results` per
  package, each committed on its own. Damaged-file 400s now also cover sqlite binding errors and a non-numeric
  `version` (were 500). Two packages matching one local file: the first claims it even if it turns out damaged;
  the later is reported as duplicate (no second try). Older Sight (< 0.75) rejects a bundle as "Not a Sight review
  file" — the stage-2 page's one-clip reply must stay a plain package. Stage 2 (multi-clip page) and 3 (phone) not
  started.
- Review (fresh agent): damaged inner package lost its name in the report; a duplicate after a damaged first copy
  was imported again; `package-all` iterated a string `asset_ids` per char / 500 on a number; a bundle opened a clip
  even when nothing changed; MANUAL said the `.srev` export visits clips; fixed. Re-review: fixes confirmed except a
  `continue` that skipped reloading the first changed clip when several changed (stale rows + undo over the merge);
  removed, confirmed by the same reviewer.

## 0.74.0 — 2026-11-17 — Onion skin cross-fades between annotated frames, toggled on the eye; one eye, in the top bar
- **What:** owner: onion skin looked odd (every drawing within ±1 s at a flat 22 %); it must fade the current
  drawing out and the next annotated frame's in. Now, while drawing on a video with onion on, between two frames
  that carry drawings the earlier ones fade out and the later ones fade in as the playhead moves (linear over the
  gap; over 1 s before the first / after the last). And the toolbar's eye is gone: the top bar's eye (lightbox
  `#drawEyeBtn`, new `#boardEyeBtn` next to the board's pen) works while drawing too. Owner, next: onion skin is a
  way of viewing, not a tool — its toolbar button is gone; right-click / long-press on the eye toggles it (video;
  click still hides / shows), it works while just watching too and is kept with the settings
  (`sight.annotate.onion`); the eye shows the onion icon while it is on.
- **Where:** annotate.js (`onionFade` replaces `ghostNow`, `paintVisibility` inline opacity, `.an-doc g.ghost` CSS
  removed; `paintEye` used by `paintBar` / `paintBadge`; toolbar `data-act=hide` removed), index.html
  (`#boardEyeBtn`, host `eyeBtn`, activePane, `applyViewDom`), MANUAL, ARCHITECTURE.
- **Notes:** a span = the drawing's frame + its hold (a held drawing fades from the end of its hold); a drawing
  held for the whole clip (`hold: -1`) is not part of it. Spans group by their end / start within half a frame.
  The rules that decide what may show (hidden replies, deleted notes, the compose / pick narrowing) apply to the
  ghosts too. A board's eye shows only while drawing there (the board resets the eye when drawing ends).
  Verified with Playwright: opacities at 0.4 … 3.8 s over drawings at 1.6 / 2.0 / 2.6 s match the formula; no
  toolbar eye; the top-bar eye while drawing hides everything.
- Review (fresh agent): the first cross-fade only counted spans that had ended, so at every annotated frame in the
  middle the previous drawings popped back and the next jumped (and held drawings sat at half opacity); a fade cut
  off when an overlapping hold ended; a hidden state carried over from another file gave no sign while drawing (new
  strokes vanished); fixed (groups by start frame: the group that started last fades out from each drawing's own
  end, the next fades in once it is over; the eye shows while drawing when hidden). Accepted: the version compare
  has no eye (Shift+H still works there; onion is off there). Re-review: fixes confirmed; new: a touch long-press
  on Android / a pen on Windows toggling onion twice (their contextmenu), drawings frozen after onion unhid them
  on a playing video, an earlier group's long hold ending with no fade; fixed; the same reviewer confirmed all three. Then: a pen's barrel
  button (pointerdown `button` 2) counts as a right-click and toggles onion too (confirmed by the same reviewer).

## 0.73.0 (docs) — 2026-11-17 — Plan: one review page / `.srev` bundle for several clips
- **What:** `docs/PLAN-multiclip.md` (linked from PLAN.md and CLAUDE.md): a bundle envelope (`format:
  "sight-review-bundle"`, `.srev` too) around unchanged single-asset packages; stage 1 format + Sight import /
  export, stage 2 the multi-clip page (the page script refactor is the main work), stage 3 the phone app. Owner
  decided: `.srev`, clips without notes left out (clips with tombstones still count), no boards. No code yet.
- Review (fresh agent, three rounds against the code): wrong assumptions (page script reusable per clip, storage
  key, "unchanged clips" savings, the phone's change tracking / `dirty()`, `exportSrev` per clip) and gaps (Sight
  import UI and response, damaged inner packages, shared import function, html-all / package-all, one-clip page
  replying with a plain package, duplicate asset match, bundle id ownership); all written into the plan; the last
  round found it ready to implement.

## 0.73.0 — 2026-11-17 — Notes panel apart from the drawing tools; board notes remember their place
- **What:** owner: open the notes panel just to read and click pictures; drawing is what brings the tools; the
  panel must work on boards too, and a board note must remember where it was written (like a 3D view) and glide
  the camera there (smooth start and stop) when its picture is clicked. A notes button (speech bubble + note
  count) sits in the lightbox bar and, for a board, in the top bar; `C` does the same with the mode off. The
  pen no longer carries the count.
- **Where:** annotate.js (`readKey` / `S.readOn`, `togglePanel`, `panelShown`, `syncPanel` `.an-read`,
  `paintNotesBtn`, `onKey` off-mode C / Esc-unpin, `modeAllows` pin while watching, board `ctxNow` → `bv`,
  `flyToNote`, `boardPreview`, `.an-bprev` click), canvas.js (`stripWidth`, `frameRect(…, opts)`, `viewRect`,
  `flyTo` / `stopFly`), index.html (`#notesBtn`, `#boardNotesBtn`, host `notesBtn` / `notesBtnShown` /
  `boardView`, activePane for the top-bar board buttons), FORMAT.md (board ctx `bv`), MANUAL, ARCHITECTURE.
- **Notes:** the reading panel has no composer (adding a note is part of the drawing mode); card actions (reply,
  resolve, delete) stay. Two flags so the panel does not pop up on every file: reading is off by default,
  drawing keeps its own (`sight.annotate.panel`). `bv` is stored for new board notes only; older ones fly to their
  drawings' bounds. The fly takes 450–1100 ms by distance / zoom ratio, any press or wheel on the board stops it.
  Also: `toggle(false)` closes an enlarged screenshot; the top-bar board pen makes the board the key pane.
- Review (fresh agent): `modeAllows` reading the view mode before declaring it (threw whenever the mode was off and
  a drawing belonged to a note — drawings, leaving the mode and picking a note broke), C in the compare toggling the
  lightbox's reading panel behind it, the compare picking up the lightbox's reading flag (`host.readPanel: false`
  now), a glide still running when another board opens / the board closes (`stopFly` in open / close); fixed.
  Also: closing the reading panel unpins the note; a screenshot landing after the mode was left no longer opens the
  reading panel. Re-review: the same reviewer confirmed every fix. Earlier review of 0.72.0's board pen / screenshots / Esc: board keys going to the
  library after a click on the top-bar pen in split view, a screenshot left open when the mode is switched off by
  the pen; fixed, confirmed by the same reviewer.

## 0.72.0 — 2026-11-17 — Drawings shown while just watching (eye to hide); review export of a whole sequence
- **What:** (1) owner: drawings must show during ordinary playback, without the annotating mode, with an eye to
  switch them off "as in the mobile app". A picture's / video's drawings now stay on show with annotating off
  (a video's on their frames as it plays); an eye button next to the pen in the lightbox bar (and Shift+H)
  hides / shows them — the same flag as the toolbar's eye. 3D keeps drawings for the annotating mode.
  (2) Export ▾ in a sequence has "…, all clips": the review of every clip with notes — one PDF (a section per
  clip, pages numbered through), one ZIP (a folder per clip), a web page / .srev per clip.
- **Where:** annotate.js (`shownOff`, `hasDrawings`, `renderAll` / `tick` / `viewChanged` / `onKey` / `modeAllows`
  / `paintBadge` / `toggle(false)` clears the hover circle; menu `.an-mseq` + API `assetId / ready / fpsKnown /
  report / toast`), index.html (`#drawEyeBtn`; `seqExportAll`, `seqWaitClip`, `reviewerName`; host `seqClips`,
  `seqExport`), review.py (`build_pdf(number=)`, `_number_pages`, `build_pdf_all`, `_zip_report`, `build_zip_all`),
  server.py `/api/review/export/pdf-all|zip-all`, tests/test_review_all.py, MANUAL, ARCHITECTURE.
- **Notes:** with the mode off every drawing of the frame shows (no clean picture after "Add", no compose
  hiding) — that narrowing is an editing aid. The sequence export visits the clips on screen (pictures need
  the clip decoded) and returns to the clip / time it started from (paused or playing as before); a clip that
  does not load in 45 s is skipped and named in the toast. HTML / .srev stay one per file (FORMAT.md is per
  asset). Verified with Playwright: drawings / eye / Shift+H / leaving the frame with the mode off; all four
  exports over a two-clip sequence (PDF pictures carry the drawings, ZIP folders per clip, back on clip 2).
- **Also in 0.72.0** (owner): the board's annotate pen moved from the board's top-left corner to the top bar
  (`#boardAnnoBtn`, next to ◧ — where the lightbox has its pen; canvas.js takes it as `annButton`, its own corner
  button stays only for a host that passes none). A note's attached screenshots are marked apart from its
  drawing previews (`.an-shotw`: camera corner badge, dashed edge; clicks go by `[data-shot]` on the wrapper).
  Esc closes an enlarged screenshot first (annotate.js `onKey`) — before, it was eaten by deselect / pin / leaving
  the mode, so it took several presses.
- Review (fresh agents), watching block: boards and still pictures ticking every frame forever, onion ghosts while
  watching, the compare showing drawings with no way to hide them (and Shift+H hiding the lightbox's behind it),
  Shift+H with no drawings / on key repeat, the eye counting drawings that never show; fixed (the tick runs only
  for a playing video — `followOff`, woken by play / seek; the compare passes `showWhileWatching: false`).
  Export block: a clip switched during its capture mixing clips, playback not resumed, a single export running
  alongside, a stray separator on the board menu, the failure toast lost with the lightbox; fixed (`S.gathering`
  + `host.exportBusy` one-at-a-time, the report checked against the clip on screen, `flash()` fallback).
  Re-review (same agents): export fixes confirmed; watching fixes confirmed, plus a missing pause / ended wake
  (the frame a video stops on could keep the previous frame's drawings) — added.

## 0.71.0 — 2026-11-17 — Dictation: built-in browser engine + one-tap language chip; Groq replaced by "my service"
- **What:** owner: no Groq, keep the app small, use what the system has, picking the language by hand is fine;
  allow any speech-to-text service the user likes. (1) Next to every mic there is a language chip (RU / EN…): a
  tap flips between the two languages used last, Alt+Shift+M does the same from a dictation field, right-click /
  long-press lists all. Switching mid-dictation lets the words heard land, then listens again in the new language.
  (2) Settings → Dictation: *Browser (built in)* (default) or *My service (OpenAI-compatible)* with Address, Model,
  API key (optional) — any `POST …/audio/transcriptions` endpoint: a local whisper server, OpenAI, Groq…
- **Where:** `app/stt.py` (`SttService` replaces `GroqStt`: config `{url, model, key}` in `<SIGHT_HOME>/stt.json`),
  server.py `/api/stt/config` (replaces `/api/stt/key`; JSON content-type required), `dictation.js` (provider
  `service` replaces `groq`; `SWITCH`, `recent()` / `remember()` / `cycle()` / `pickLang()`, chips map, `restart` /
  `stopping` flags), index.html (`bindDictationSettings`, `.stt-row`), tests/test_stt.py, MANUAL, ARCHITECTURE.
- **Notes:** an old `stt.json` with `groq_key` is simply ignored (not configured), and an engine setting `"groq"`
  reads as the browser. Status returns url / model / hasKey, never the key. Changing the address drops a stored
  key unless a new one comes with it (nothing can redirect the user's key to another host); no redirects followed.
  No key → no Authorization header; no model → `whisper-1`. Auto language without a key is impossible with Web
  Speech; local Whisper inside Sight was offered and declined (too heavy) — a local whisper server plugs in as
  "my service". Recent pair: `localStorage["sight.dictation.recent"]` (defaults: browser language + English, or
  + Russian on an English browser); compared via `fullCode` so a bare "ru" browser code equals "ru-RU". Verified
  with Playwright: chip / hotkey / restart on a fake recogniser; Settings → save → a real phrase from Chromium's
  fake mic through the dev server to a fake OpenAI-compatible server (Bearer key, text back).
- Review (fresh agent), chip block: restart after a user stop, Enter / blur not cancelling the restart, a same-base
  pair (en-US/en-GB) not flipping, wrong seeding of regional browser codes, floating chip not re-placed, chip tap
  vs popover close; fixed. Re-review: bare browser code ("ru") needing two taps — fixed; the same reviewer confirmed every fix.
  Service block review: URLs the browser's `new URL()` rejects (spaces, bad port) saved as configured, the system
  proxy applied to a local server (key in clear text to it), the key silently dropped on an address change, the
  old Groq key left on disk, the upload cap relying on Content-Length only; fixed (local hosts bypass the proxy,
  cloud hosts keep it; body read with a running 20 MB cap). Re-review: a key saved with no address could not be
  removed, a one-time race deleting a fresh config with the Groq file; fixed; the same reviewer confirmed all.

## 0.70.0 — 2026-11-17 — Dictation with automatic language detection (Whisper via Groq)
- **What:** Settings → Dictation: engine *Browser* (as before) or *Whisper (Groq)* plus a Groq API key. With
  Whisper the mic's language "Auto" really detects the language (owner's request; the browser's recogniser
  cannot — its "auto" is the browser's language). Words arrive phrase by phrase (after each pause), not live.
- **Where:** new `app/stt.py` (`GroqStt`), `app/server.py` `/api/stt/status|key|transcribe`, `dictation.js`
  provider `groq` + `getEngine` in `createDictationUI`, annotate.js (passes `getEngine`), index.html
  `bindDictationSettings` + Settings markup, `tests/test_stt.py`. PLAN-stt.md (tier 2 done), ARCHITECTURE, MANUAL.
- **Notes:** the key lives only in `<SIGHT_HOME>/stt.json` (0600), never in settings.json / the page / logs;
  `/api/stt/status` says only whether one is set. Stdlib `urllib` multipart, model `whisper-large-v3-turbo`, no
  `language` field = detect. Phrases: one MediaRecorder per phrase (each upload a complete file), cut by 0.7 s of
  quiet after ≥ 0.25 s of voice (AnalyserNode RMS), or at 20 s. Not testable from the dev container (Groq is not
  reachable here): verified up to the POST and the "unreachable" toast with Chromium's fake microphone. Phrases are
  delivered in order (numbered), the next recorder starts before the old stops (no word lost at a 20 s cut), the
  session ends only when every recorder and upload is done, a missing key is reported before recording, leaving
  the composer still appends the phrases in flight (editors that save on blur drop them, Enter drops them).
  `/api/stt/transcribe` takes `audio/*` only (another site's "simple" POST cannot spend the quota) and checks the
  size first; urllib never follows a redirect (it would re-send the key).
- Review (fresh agent): mic left on when stopped during the permission prompt, phrases out of order, last phrase
  lost on blur / just after a cut, suspended AudioContext dropping everything, a word lost at the 20 s cut, no-key
  reported late, unbounded / cross-site POST, mislabelled upstream errors, redirects carrying the key, key file
  briefly world-readable; fixed. Re-review: start errors never reached the toast (end() cleared the session first)
  — fixed; confirmed by the same reviewer.

## 0.69.1 — 2026-11-17 — Sequence: no black frame across a cut, picture scrub runs through clips
- **What:** scrubbing back (or forward) across a cut no longer flashes black; dragging on the picture scrubs the
  whole sequence and runs on into the neighbouring clips instead of stopping at the clip's ends.
- **Where:** index.html `seqHold` / `seqKeepStill` / `seqDropHold` / `seqReleaseHold`, `seqDragTo`, `seqNow`,
  `seqScrubBegin`, the attachViewer scrub hand-over (`sd.handed`), `bindSeqBar` (uses `seqDragTo`), `.seq-hold` CSS.
- **Notes:** a clip opened from scratch shows nothing until decoded, so the frame on screen is held as a canvas
  (the visible scrub copy, else the player, else — mid-seek, when nothing can be drawn — the last presented frame
  of that same element) placed with the player's box and turn / mirror / zoom transform inside a box clipped like
  the frame; it goes when the new clip presents its frame (rVFC, 250 ms fallback; 1.5 s cap). The picture scrub is
  handed to window listeners once it starts (each cut replaces the stage and the element holding the pointer);
  a release outside the window ends it on the next move without a button.
- Review (fresh agent): hold skipped mid-seek, wrong source while the scrub copy shows, geometry for turned /
  masked views, stuck drag after a release outside, a swallowed tap after a cancelled hand-over, rVFC not firing,
  timer of chained holds, `seqNow` before a landing; re-review: the mid-seek still placed with another clip's
  geometry — all fixed; confirmed by the same reviewer.
