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

## 0.44.3 — 2026-11-13 — Annotations: hovering a note no longer highlights its drawings
- **What:** in the desktop lightbox, moving the pointer over a note card in the annotation panel does nothing to the
  picture any more. Before, hover dimmed every other note's drawings and, right after a note was made, brought its
  drawings back. Now only a click highlights: a click on the card (or a video / 3D preview frame in it) picks the
  note, and the picture shows only its drawings, as before. A click on a screenshot still opens it full size.
- **Where:** `app/static/annotate.js` — removed `S.focusNote`, the `pointerover` / `pointerleave` handlers on
  `.an-list`, the `hover` field of `viewMode()`, the `dim` class in `paintVisibility` and the `.an-doc g.dim` rule;
  `modeAllows` now lets a note's drawings back only when it is pinned (`S.pinFocus`). `MANUAL.md` (Annotations),
  `docs/ARCHITECTURE.md` (desktop visibility). `app/version.py`.
- **Notes:** `S.pinFocus` is the only "picked note" state now; every place that cleared `focusNote` clears
  `pinFocus` alone. The card's own CSS hover border (`.an-note:hover`) is unchanged — it is styling, not a highlight.
  Known, left as is: after a note is made the picture stays clean until its card is clicked (it used to come back
  on hover). Not tested in a browser: checked by reading the code, `node --check app/static/annotate.js`, and a
  grep that nothing reads `focusNote` / `m.hover` / `.dim` any more. Review (fresh agent, the whole diff): no
  correctness bugs; its doc remark (a screenshot click does not pin) was applied to MANUAL and ARCHITECTURE.

## 0.44.2 — 2026-11-13 — A new note at another explode is a new view
- **What:** a view is a camera, its hidden meshes and an explode amount (within 0.001). A note or drawing made at
  an explode different from the view it is on (the view has added notes, so the slider cannot move it) gets a new
  view with its own chip, instead of joining the old one. Before, the new note took the old view and its picture
  showed the old amount. Drawings not yet added on the same camera and meshes move to the new note's view when the
  note is added, so they take its amount.
- **Where:** `app/static/annotate.js` — `explodeSame` (new), `findVk(cam, hid, ex)` (matches the amount when given),
  `ctxNow` (the live amount decides the view; a new view's stub carries it), `explodeChanged` (the current view
  first, so two views on one camera do not swap), `addNote` (pending drawings on the same camera and meshes take the
  note's view and amount), the render path (`findVk` with the live amount; the amount is in the redraw signature, so
  a view at another amount hides its drawings until it is current). `MANUAL.md`, `docs/FORMAT.md`. `app/version.py`.
- **Notes:** the drawings of a committed view hide while the slider is at another amount (they belong to the amount
  they were made at); they show again when the slider goes back, or when the chip goes there. A drawing drawn on the
  view before the slider moved, then added with the note, goes to the note's view (the new one) — its overlay was
  drawn at the slider's amount then. The file format is unchanged (rows already carry `explode` and `vk`). Not tested
  in a browser: checked by reading the code and `node --check`.
  Review 1 (fresh agent, whole block): confirmed, fixed: the slider could give a view the amount another view on the
  same camera already had (the drawing then stranded on a hidden view) — the slider now stops at that view; an
  addNote adoption ignored the drawing's own amount (it could move a drawing of another amount into an old note's
  view) — now it also needs the same amount; a legacy view (no row explode) now takes its notes' `v3d.explode`
  instead of matching any amount. Left as is (low): a drawing with a hidden-mesh state unknown (null) is adopted
  by any note on its camera; an empty stub view left in the session is dropped at the next rebuild.
  Review 2 (fresh agent, the fixes): no new bug in the fixes. Confirmed, fixed: with no current view the slider
  gave the first view on the camera the new amount (a jump), so now it moves nothing; `findVk` prefers an exact
  amount over a view with no amount (a legacy one). Known, left: (a) a legacy note newer than a view's last row now
  sets the view's amount on load (newest wins, as in 0.42); (b) on open the saved slider amount is live, so a view
  whose camera matches but whose amount differs is not current until its chip is clicked; (c) a drawing that was
  hidden at add time (its view at another amount) is attached to the note but keeps its own view, so it shows
  with the "other views" count, not on the note's own picture. The last small fixes were checked by the author
  (`node --check`, unit tests) and not re-reviewed by a fresh agent.

## 0.44.1 — 2026-11-13 — Explode: added notes keep their explode; the slider moves only the work not yet added
- **What:** moving the 3D explode slider (or Ctrl+right-drag) no longer changes an added note, its pictures or its
  exports. A note's pictures and exports use the explode it was added at; clicking the note goes back to that
  explode. A view that holds added work (a note, or a drawing attached to one) keeps its amount, and the slider
  does not change it. A drawing not yet added on the note's view takes the slider's amount when the note is added.
  Pictures of two notes on one view can now show two amounts.
- **Where:** `app/static/annotate.js` — `explodeChanged` (refuses a view with added work), `viewCommitted` (new),
  `explodeOf(vk, rows)` (new: a row's `ctx.explode`, else a note's `v3d.explode`), `viewLook(look, ex)` (takes the
  explode), `view3dPic(vk, explode)`, `view3dBox`, `goView(vk, v3d, ex)` (note click passes the note's explode),
  `rebuildViews` (keeps the amount of a view with added work), `addNote` (pending drawings on the note's view take
  its explode), the report / export own-frame and more-views code. `MANUAL.md`, `docs/FORMAT.md`. `app/version.py`.
- **Notes:** before this, the slider changed the view's explode, and the pictures and exports of every note on that
  view followed it. Older notes (before 0.42, no `ctx.explode`) are drawn at the `v3d.explode` they were written
  with; a view's own amount (chips) is still set by the newest row when the file loads, so after a reload a chip
  may go to a different amount than in the session where the view was made. Rows are not rewritten by a slider move.
  The `explodeOf` fallback to `view.explode` remains only for a note with neither value. Not tested in a browser:
  checked by reading the code, `node --check`, and `tests.test_merge_parity` / `tests.test_review_page` (OK).
  Review 1 (fresh agent): two confirmed issues, fixed: `rebuildViews` moved a committed view's amount when a newer
  note was added (kept now); the report's own-frame export was taken at the live slider when the note had no `v3d`
  (fixed). One low-impact mismatch left as is: the preview of another view uses the drawings without replies, the
  export uses them too, so with a reply as the first row on that view they can differ.
  Review 2 (fresh agent): a first note on a new view kept a `null` amount from the empty view state (fixed: only a
  real amount is kept). Legacy notes on a view with no amount could follow a newer row (resolved by the `v3d.explode`
  fallback above).
  Review 3 (fresh agent, delta only): no confirmed bugs; v3d.explode on older notes verified (saved since 0.19);
  `explodeOf` filters by view. Left as design: a view with added work keeps the amount of its first note, so a
  second note made at another amount does not move the chips' amount (`view.explode`) — its own pictures are right.
  Not verified in a browser.

## 0.44.0 — 2026-11-13 — Reviewer page: *Download page* saves the page with your changes
- **What:** the reviewer page (Web page for reviewers) has a *Download page* button next to *Download reply*. It
  saves the same page with this reviewer's replies, pictures, drawings, state changes and new notes already in it.
  The copy opens in any browser with those edits in place and can be answered and downloaded again. *Download reply*
  (.srev) is unchanged and is still what Sight imports.
- **Where:** `app/review.py` (`_HTML_TEMPLATE`: `ORIG` / `DATA_TEXT` captured at the start of the script, `D.edits`,
  `D.copy` in `KEY`, `replyPackage()` split out of `download()`, `saveBlob`, `downloadPage()`, the `#dlpage` button
  in the foot, the status text in `render()`). `tests/page_e2e.cjs` (optional 4th argument: the copy; the copy is
  reopened, must show the reply, its two pictures and the new note, and its .srev merges with nothing added).
  `tests/test_review_page.py`. `MANUAL.md`, `docs/ARCHITECTURE.md`. `app/version.py`.
- **Notes:** the copy is a snapshot of the reviewer's local edits, not of the owner's package: the package and report
  inside stay as exported, so the copy's *Download reply* still merges by ids (a second copy is no duplicate).
  Each copy gets a new `copy` id, so copies do not share localStorage with the page they came from. The copy's
  "From" line is the original sender. Sight cannot import the `.html` — a deliberate gap; import the `.srev`.
  The data block is replaced as a literal string (the first match is the block; `<` is escaped as `\u003c` as in
  `build_html`). Not checked at phone width (the foot now has three buttons).
  Review (fresh agent): no confirmed bugs. Checked: the raw-string escape of `<`, `ORIG` taken before any DOM change,
  `$` patterns in the replace (function replacer), PKG never mutated, re-download idempotent, the .srev unchanged,
  original page KEY unchanged, Discard on a copy stays empty after reload. Dropped drafts are not in the copy (as in
  Download reply); stale attachments in E.att are embedded but filtered out by the reply.

## 0.43.1 — 2026-11-13 — Review panel scrolls with middle-drag like the other lightbox panels
- **What:** the review (annotation) panel's note list scrolls by middle-drag, as the info, PSD, 3D and frame
  panels already do; the wheel still scrolls it natively.
- **Where:** `app/static/annotate.js` — `buildPanel` calls `host.panScroll` on `.an-list`. `app/static/index.html`
  — the `createAnnotator` options pass `panScroll: (el) => attachPanScroll(el)`. `app/version.py`.
- **Notes:** the panel keeps its own look (docked column); only the shared scroll helper is used. The helper adds no
  wheel handler and does not change `overflow`. Review (fresh agent): no confirmed bugs (no clash with the list's
  click / dblclick / hover handlers or the right-button thumb zoom; `buildPanel` runs once per lightbox open, so no
  duplicate listeners). Not tested in a browser.

## 0.43.0 — 2026-11-13 — Lightbox: icons follow the file type; corner icons clear the radius; Alt-drag turns a picture to any angle
- **What:** (1) mirror (`#mirBtn`) shows only for images, PSDs and video; the annotate button (`#annoBtn`)
  shows for those and for 3D models, so documents and audio hide both. (The buttons used to stay visible:
  `.btn`'s `display` beat the `hidden` attribute.) (2) With a corner radius set, the corner icons (file info,
  3D gear, video strip, the 3D shading bar's bottom offset) move in by 0.3 × radius, so the rounding does not
  cut them; a circle mask does not move them. (3) Alt+drag on a picture or video turns it about its centre to
  any angle; Shift snaps the angle to absolute 15° steps (0, 15, 30 …). The angle is saved per file when the
  drag ends. Alt+drag on a video no longer scrubs (plain drag still does). (4) The fit of a turned picture
  uses its bounding box at any angle (for 0/90/180/270 it is as before).
- **Where:** `app/static/index.html` — `.btn[hidden]` rule (next to `.v3d-gear[hidden]`), `.info-fab`,
  `.light-info`, `.v3d-gear`, `.v3d-shade`, `.view-hud` (offsets use `var(--hud-in)`), `applyLightFrame()`
  (sets `--hud-in`), the lightbox setup that sets `#mirBtn` / `#annoBtn` `hidden`, `loadTurn` (fractional
  angle), `fitS()` (bounding box), and the viewer's `wrap` pointerdown / pointermove / `end` (`vs.rotD`).
  `MANUAL.md` (turn, mask). `app/version.py`.
- **Notes:** a turn drag ends with a click on the wrap, which is swallowed (`justScrubbed`) only when the angle
  really changed, so a video does not pause after a turn. The HUD offsets are anchored to the lightbox root, not
  to the frame: with an aspect-locked mask the frame is centred, so the inset is approximate there. The turn is
  stored as a float angle per file (the old integer quarter turns still read back). Alt+drag with the select tool
  in annotation mode still duplicates; Alt over a drawing tool reaches the viewer, as before.
  Review (fresh agent): one confirmed bug, fixed (a video paused after an Alt-turn, because the click after the
  turn drag was not swallowed). Checked and no bug: `hidden` on `#splitBtn` (now honoured, as intended), the
  `calc()` values at 0, fitS at 0/90/180/270, the rotation direction with the mirror on, the normalisation of the
  angle delta, the annotation capture order. Not tested in a browser: checked by reading the code and `node --check`.

## 0.42.0 — 2026-11-13 — Explode belongs to the view; one zoom setting for every zoom (3D and version compare too)
- **What:** (1) explode is kept per view. Moving the slider (or Ctrl+right-drag) at a view with drawings sets
  that view's explode; going to the view (chip, note click, Go to) puts it back and replaces the current amount,
  unless a row on that view was made at the current amount (then it stays). New rows store `ctx.explode`.
  (2) A view's still and the export pictures (PDF / .srev frames of 3D notes) render at the view's explode.
  (3) The zoom settings (Speed, Drag axis, Invert) apply to every zoom: the 3D viewer's wheel, right-drag and
  pinch, and the version compare wheel, as they already did for images, video, text and the canvas.
  (4) Settings header "Zoom (images / video)" is now "Zoom".
- **Where:** `app/static/annotate.js` — `EXPL` / `EXP_TOL`, `rebuildViews` (view.explode from the newest row or
  the slider value), `explodeChanged` (exported), `viewExplode` (used by `goView`), `viewLook` (export paths),
  `ctxNow` (rows get `explode`), `view3dPic` (still at `v.explode`, `S.b3.capture(ex)`). `app/static/index.html`
  — the slider `onChange` and the Ctrl-drag call `annot.explodeChanged`; `explodeMap` moved to the top of
  `boot3d`; top-level `renderStill` (applies the view's explode, `refit` = `onExplodeMoved`, restored in
  `finally`) and `bind3dZoom` (wheel, right-drag, pinch via `dollyOut`, `enableZoom` off); both
  `bindAnnot3d` calls; `createCompare` gets `getZoomSettings`; the settings header. `app/static/compare.js` —
  `onWheel` (speed, invert). `docs/FORMAT.md` (`ctx.explode`), `docs/ARCHITECTURE.md`, `MANUAL.md`. `app/version.py`.
- **Notes:** the slider's value is kept in memory until a new row is made at that view, so a slider change with
  no drawing is lost on reload (rows are never rewritten). A view's explode is the newest of the row values and the
  slider value by timestamp; a phone row stamped with a clock ahead of the desktop can win over a newer desktop
  slider. Rows from before 0.42 have no explode: their views keep the live amount. A pinch uses the speed only
  (its direction is the finger gap). The splat viewer keeps zoom toward the pointer via OrbitControls'
  `_updateZoomParameters` (a private method; guarded with `?.`). `review-draw.js` (exported review page) and the
  mobile app keep their own zoom settings. Not tested in a browser: checked by reading the code, `node --check`
  and the two review passes. Review 1 (explode): a report path used the note's unstripped explode (fixed:
  `viewLook`); `renderStill` had no `finally` and no refit (fixed). Left as specified: any row on the target view
  made at the current amount keeps it. Review 2 (zoom): pinch was lost with `enableZoom` off (fixed: pinch in
  `bind3dZoom`); the modifier check blocked the right-drag in the splat viewer (fixed: only the Ctrl / Shift
  handlers that already stop the event take it); the splat right-drag was not cursor-anchored (fixed).

## 0.41.2 — 2026-11-13 — 3D note pictures are stills: a light change no longer re-renders them
- **What:** the pictures on a 3D note's card (one per view the note's drawings were made from) were re-rendered
  every time the shading or the lights changed, so they looked like live mini-viewports. Now each view's
  picture is taken once and kept; moving the light or switching shading leaves it as it was. The drawings on
  top are still vector and follow the view as before.
- **Where:** `app/static/annotate.js` — `view3dPic` (cache key no longer includes the shading; `PIC3` maps the
  key to the data URL), the comment above it. `docs/ARCHITECTURE.md` (3D pictures), `MANUAL.md` (3D). `app/version.py`.
- **Notes:** supersedes the 0.40.1 / 0.40.2 decision to re-capture on a shading change. The still is the one
  made at first use, so it shows the lights the viewer had at that moment, not the note's saved lights; a
  still made while the light is being dragged keeps that light. Still JPEG ≤640 px at quality 0.85, unchanged.
  Stills are per session (cleared by `resetPF`), so a reopened review takes them again with the current lights.
  Explode stays in the key: the first version dropped it with the shading, so a note's still would show the
  assembled model after the explode slider moved (the drawings were made over exploded parts). Found by a fresh
  review (correctness; 1 confirmed finding, fixed; camera, asset reset and null-capture paths were checked OK).
  Not yet checked in a browser: the change was verified by reading the code and a syntax check of annotate.js.

## 0.41.1 — 2026-11-13 — Drawing: round stroke ends, brush circle follows the pen, Alt no longer draws from the centre; 3D light on Shift+right-drag
- **What:** (1) a brush / pencil stroke's start and end are round caps: they used to bulge into the stroke
  (a notch at both ends). (2) The brush circle follows the pointer while a stroke is being drawn (it was
  frozen at the press). (3) With Alt held over a drawing tool the brush circle is hidden (Alt moves the camera).
  (4) Alt no longer draws shapes from the centre (rectangle / ellipse); Shift still makes a square / circle.
  (5) The 3D light direction moves with Shift+right-drag (was Alt+left-drag); the info panel's "Rotate all" label
  says so.
- **Where:** `app/static/review-core.js` — `strokeOutline` (both cap arcs: sweep flag 0; shared with the phone
  app and the HTML page). `app/static/annotate.js` — `renderSel` (circle shown while drawing, hidden under Alt;
  the eraser drag keeps its own circle), `onMove` (stroke branch calls `renderSel`; the Alt shape branch removed),
  `paintAlt` (redraws the circle), the tool labels. `app/static/index.html` — the light-drag `pointerdown`
  (`button 2` + `shiftKey`, no ctrl / meta / alt), `lightYaw` comment and the "Rotate all" label.
  `MANUAL.md` (drawing and 3D). `app/version.py`.
- **Notes:** the cap test: a stroke rendered in headless Chromium from `primsOf` has ink 6 px past both ends
  (before the fix: white there, the cap cut inward). The circle test: with pen events the circle stays on the
  pointer while drawing and is gone while Alt is held. Pressure: a pen stroke with simulated pen pressure
  (CDP `force`, `pointerType: 'pen'`) is 8 px at 0.95 and 2 px at 0.15, so the drawing path uses pressure when the
  browser reports a pen. Not changed: a tablet that reports `pointerType: 'mouse'` (its driver in mouse mode)
  or a brush with the Pressure toggle off draws at constant width by design.

## 0.41.0 — 2026-11-13 — 3D views keep the hidden meshes; numbered in the order they were made; note pick shows its drawings while drawing
- **What:** (1) a view (camera) also records which meshes were hidden (H / Ctrl+H / Alt+H) when it was made;
  a change of hidden meshes starts a new view; going to a view (chip, note click, Go to) shows its meshes as
  they were. (2) The views are numbered in the order they were first made, so the chips, the "View N" labels,
  the pictures of a note and the report agree; the pictures of a note are in view-number order. (3) Clicking
  a note now shows its drawings even while new drawings that are not yet attached to a note are on the
  screen (before, any such drawing hid every note's drawings until it was attached). (4) A note's drawings-count
  caption ("N drawings") is gone; "from <name>" stays.
- **Where:** `app/static/annotate.js` — `rebuildViews` (views sorted by first made; `hidden` from the items'
  ctx), `curHidden` / `sameHidden` / `viewMatches` / `findVk(cam, hid)`, `ctxNow` (3D ctx carries `hidden`),
  `view3dPic` (applies a view's meshes for its picture, restores the live ones; cache key has `hidden`),
  `view3dPreviews` (sorted by `viewNumber`), `goView` (restores `hidden`), `tick` (mesh state in the signature),
  `modeAllows` (a pick wins over `compose`), `renderPanel` (count caption removed). `app/static/index.html` —
  `bindAnnot3d` host gets `getHidden` / `setHidden` from `v3dInspect.meshes`. `docs/FORMAT.md` (3D `hidden`),
  `MANUAL.md` (3D). `app/version.py`.
- **Notes:** the mesh index is the inspector's traversal order, so it is stable for one file only (views are
  per asset, as before). Views made before 0.41 have no `hidden` and match any mesh state, so an old view keeps
  its old behaviour. A 3D preview is still re-captured when the shading changes (0.40.2). Not tested in a
  browser yet: the view-number order, the mesh restore and the pick-while-drawing case were checked by reading
  the code and by a syntax check of annotate.js and the inline scripts of index.html.

## 0.40.2 — 2026-11-13 — Video: drawings show at once after a timeline scrub
- **What:** after a scrub or a seek that lands in the second half of a frame, the drawings of that frame were
  not shown (a new stroke was saved but stayed invisible until the time moved again). Desktop lightbox and
  phone both now decide "the frame on screen" with the same rule the drawings are stored with (the frame's
  start), so the frame's drawings show at once.
- **Where:** `app/static/annotate.js` — `frameNow()` (video: `frameStart(v.currentTime)`). `mobile/js/app.js` —
  `stageDrawings()` (`frameStart(scrubT or currentTime)`). `app/version.py`.
- **Notes:** `ctxVisible` (review-core.js) is a window centred on the stored time (±half a frame), and a
  drawing is stored at `frameStart(t)` = (n + 0.01)·fd, so the frame's own time must be the stored one, not
  the raw player time. Any new "what is on screen" check for video must pass `frameStart`, never the raw time.
  Checked by computing `ctxVisible` on the real review-core.js: raw 2.915 s hid the drawing stored at 2.880,
  the frame start shows it. Not yet checked in a browser with a video scrub.

## 0.40.1 — 2026-11-13 — Review fixes: undecodable clips, list selection, 3D preview cache, phone menu key, PDF sizes
- **What:** (desktop) an undecodable clip that the server cannot convert stops its preview frames at once
  (no 4 s-per-frame retries in one serial pump); (desktop) a text selection dragged out of a note card and
  released in the gap of the notes list no longer drops the picked note; (desktop) 3D previews keep one picture
  per view, replaced when the shading changes, instead of one per shading step. (Phone) the menu key on a
  mouse works again within 1.5 s of a press on a row; a picture without its size is reported in the console
  instead of left out of the PDF silently.
- **Where:** `app/static/annotate.js` — `pumpPF` (`PF.failed`, cleared by `resetPF`), `onListClick` (the empty
  branch checks `getSelection`), `view3dPic` (`PIC3` keyed by asset + view + camera, value `{shade, url}`).
  `mobile/js/app.js` — the row's `contextmenu` (the mouse exemption restored). `mobile/js/report.js` — `rows()`.
  `app/version.py`.
- **Notes:** the Alt-from-centre loss from 0.40.0 is NOT changed here (MANUAL.md still describes it; decision
  pending). A 3D preview is still recaptured for a shading change: the picture must show the shading, so the
  capture moves the live camera twice per view (set and restore). `PF.failed` is per asset: a reopened review
  resets it, and a clip that later becomes decodable needs that reset. The PDF size warning is for a caller
  bug only; `picOf` and `burn` always set `w` / `h` today.

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
