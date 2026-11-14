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

## 0.46.5 — 2026-11-14 — Picture text plate: drag scrolls the text; the head moves the plate
- **What:** the text on the picture plate (lightbox, attached-picture view, phone viewer) scrolls the same way
  everywhere: a middle-button drag moves the words with the mouse (no browser autoscroll), and when the text is
  longer than the plate a plain drag on the text scrolls it too (a finger natively) — the plate is then moved
  only by its head (number / label). Short text: a drag anywhere still moves the plate. A tap still folds it.
- **Where:** `app/static/caption-plate.js` — `pan` / `panDown` / `panEnd` (middle drag; the edit field's own
  scroll while editing), `g.scroll` in `down` / `move` / `up`, `.scp-pan` cursor, auxclick / lostpointercapture.
- **Notes:** same feel as index.html `attachPanScroll` (direct follow, no inertia) — the module can't import it
  (the phone has no index.html). Finger scroll stays native (`touch-action: pan-y` → pointercancel). Tests drag
  the plate by its head already.
  Review (fresh agent) found, all fixed: a middle press while the left button was held fired no pointerdown, so
  its mousedown still started autoscroll / paste (a `mousedown` guard now); a stale `.scroll` class (layout change
  without a window resize) could make a finger drag do nothing (touch decides by the class; a ResizeObserver keeps it
  fresh); a pen both panned natively and by script (only the mouse scrolls by script); new text mid-drag jumped
  (the drag scrolls by the step since the last move). Left as is: a middle press on the pencil / scrollbar also pans.

## 0.46.4 — 2026-11-13 — Annotations: dragging a value of a selected drawing no longer stops at the field's edge
- **What:** with the select tool (V) and a line / shape / text selected, dragging a number in the bar (Width, Size,
  Opacity, Radius…) stopped as soon as the pointer left the field. It now goes on until the button is let go, as it
  did for the tool's own settings (nothing selected).
- **Where:** `app/static/annotate.js` — `numDrag` (new), `renderProps` (returns while it is set), `bindNum` (sets it on
  press, clears it and re-renders the bar on pointerup / pointercancel / lostpointercapture).
- **Notes:** root cause: a change to a selected drawing goes through `commit` → `afterChange` → `renderProps`, which
  rebuilt the bar's HTML mid-drag; the dragged control was replaced and its pointer capture went with it (the tool's
  styles path saves without re-rendering, so it never broke there). Checked in Playwright: a rect's Width dragged
  well outside the field went 4 → 71 (4 → 4.4 before the fix).
  Review (fresh agent): found the flag could stick for good if the lightbox closed mid-drag (the capture is lost at
  the document, not the control) — `numDrag` now holds the control and counts only while it is in the page; and that
  the drag kept writing after the selection changed mid-drag (Esc, Delete, a tool key, undo) — the drag now ends when
  its target (selection ids or tool) changes, and the bar is re-rendered then instead of opening the typing field.

## 0.46.3 — 2026-11-13 — A new note takes every loose drawing
- **What:** adding a note now attaches every drawing that has no note yet, whatever frame / view it is on and
  whenever it was drawn — before, only the loose ones on screen and those drawn since the file was opened. A sketch
  left from an earlier opening of the file (drawn, never added) no longer hangs on its frame. The owner chose this
  over a "delete loose drawings" command.
- **Where:** `app/static/annotate.js` — `pendingDrawings` (just `isDrawing && !data.note`). `MANUAL.md`.
- **Notes:** the compose mode (clean picture, view chips) still counts only recent loose drawings
  (`S.composeSince`, `S.adopt`), so an old sketch alone does not keep the picture clean or show the chips; it is
  still counted in the panel line ("+N drawings (k on other frames)"); an empty Add with only old sketches off
  screen gives the "Type a note…" toast instead of an empty note. Known: a forgotten old sketch (or a loose row from
  another reviewer's file, if any) goes into whatever note is added next, under this reviewer's name.
  Review (fresh agent): no correctness bug; the empty-Add case and two stale comments were fixed. Checked in Playwright (video:
  stroke on one frame, reload, note on another frame took it, no loose rows left).

## 0.46.2 — 2026-11-13 — 3D: view numbers show only while a note is made, above its field
- **What:** the numbered 3D view chips are no longer a row at the top of the review panel. They show only while a
  note is being made (drawing, or typing in its fields), right above the note field, titled *Views of this note*,
  and list only the views the new note will hold: those of the drawings waiting for it and the camera on screen (a
  dimmed dashed next number when that camera is no view yet — adding the note makes it). A chip still goes to its
  view. Added notes show their views as their pictures in the card.
- **Where:** `app/static/annotate.js` — `.an-views` moved into `.an-compose`, `renderViews` (rewritten; called from
  `renderPending` too; markup signature on `el.dataset.sig`), CSS `.an-views`, `.an-vchip.new`. `MANUAL.md` (3D).
- **Notes:** a chip's `mousedown` is prevented so the note field keeps the focus (compose mode stays on). Review
  (fresh agent): found that a module-level signature left an empty block after the panel was rebuilt (fixed: the
  signature lives on the element) and a CSS margin on the new span (fixed). Known, left: a click on a chip while the
  camera is still easing off a view can be lost (the chips rebuild as the current view changes). Checked in
  Playwright with a GLB (swiftshader): hidden at rest, shown while drawing / typing, gone after Add, next-number chip
  after an orbit.

## 0.46.1 — 2026-11-13 — Annotations: drawings added to a note are editable again (0.45.0 lock lifted)
- **What:** the owner asked to roll back 0.45.0: a drawing added to a note (or a reply) can again be moved, scaled,
  restyled, nudged, reordered, partly erased and retyped, as before 0.45.0. Undo again reaches back over adding a
  note; drawings it takes off a note now go to the next note instead of hanging loose (below).
- **Where:** `app/static/annotate.js` — `baked` now returns false (the `baked` / `editable` gate and every call site
  of 0.45.0 / 0.45.1 stay), `addNote` no longer clears undo / redo; `S.adopt`, `applyStates`, `composerBack`. `MANUAL.md`. `app/version.py`.
- **Notes:** supersedes 0.45.0 (archived) and the lock part of 0.45.1. Kept on purpose: the gate itself, so the
  planned lock is one function (see `docs/PLAN.md` "Note locks": an artist may not edit a supervisor's original
  notes, only answer with their own; a resolved note is locked entirely). 0.45.1's other fixes stay: Front / Back
  put the selection above / below every drawing, copies of a reply's drawing clear `data.reply`, the Hold selector
  shows for an editable selection (now any). Its dashed outline for a baked selection is unreachable until a lock
  returns. Checked in Playwright (scratch library): a note's stroke moves with the select tool and Ctrl+Z puts it back.
  Review (fresh agent): no lock path left outside the gate; it pointed out that undo across a note leaves drawings
  hanging, fixed here: a drawing that an undo / redo takes off its note (`applyStates`: note set before, null after)
  goes into `S.adopt`, and `pendingDrawings` / the compose mode take it whatever frame / view it is on, so the next
  note picks it up instead of leaving it loose on its frame. Undoing "add note" (`step.added`, `composerBack`) also
  puts its screenshots back into the pending row and its text / picture text back into the fields (a field already
  typed in gets it on a new line); redo takes them out again when a field still holds exactly that text, and makes
  the picture clean as adding did. A second fresh-agent review of this found no correctness bug (the tagged step is
  always the addNote step; stale `S.adopt` ids are harmless — every use also needs `!data.note`). Checked in Playwright (video, two frames + a screenshot: undo, then a note on a third frame took
  both drawings and the screenshot, no loose rows left). Not cleaned: loose drawings already left in libraries by
  earlier sessions (older than the file's opening, not on screen) still wait on their frames.
  Front / Back keep the 0.45.1 rule (z may go below 0; storage accepts it).

## 0.46.0 — 2026-11-13 — Picture texts: each note picture has its own text, shown on a movable plate
- **What:** a note's text is now its topic, and each of the note's own pictures (the image, a video frame, a 3D
  view, an attached screenshot) can carry a text of its own. Desktop: a second field under *Add a note…* (*Text for
  this frame / view / picture*) gives the new note's picture a text; while a note is picked and one of its pictures
  is on screen, a half-transparent plate over the picture shows the note's text and that picture's text, with a
  pencil to edit it in place; the same plate over an attached screenshot; the note card lists the texts (click =
  go to the frame / view, double-click = edit) and marks previews that have one. Phone: the full-screen viewer's
  caption became the same plate (pencil on it → the text sheet); thumbnails with a text get a corner mark; the
  draw pencil stays bottom right: there the plate keeps to the left edge at the foot and, stuck to the right side,
  ends above the pencil (`--scp-bx` / `--scp-bw` / `--scp-rb` in `mobile/index.html`; under 390 px wide the foot
  plate narrows below 80 % to stay clear; on the left side it starts below Back, `--scp-lt`; desktop keeps the
  defaults: centred, 10 % / 80 %). A fresh-agent review of this layout found the narrow-phone overlap and the
  left plate under Back (both fixed); geometry checked by arithmetic for 360 × 800 and 844 × 390. The
  plate: bottom centre, 80 % wide, more than five lines scroll; a tap folds it into an icon, a tap on the icon
  opens it; a drag sticks the plate / icon to the nearest side (left / right: 25 % wide, 80 % high); side and fold
  kept per device. PDF / HTML exports (Sight and phone) show the texts under the pictures.
- **Where:** `app/static/caption-plate.js` (new, shared ES module), `app/static/review-core.js` (`picKey`,
  `captionOf`, `withCaption`), `app/static/annotate.js` (`.an-cin`, `captionsHtml`, `editCaption`, `platePic`,
  `paintPlate` in `tick`, `showShot(src, from)`, `setCaptionFor`, report payload `withPicText` / `picText` /
  `shotCaptions`; `onDown` / dblclick skip `.scp`), `app/review.py` (PDF `picText` / `shotCaptions`, page
  `picText`), `mobile/js/app.js` (`viewer` → `paintPlate`, `markCap`, `sameFrameT`),
  `mobile/js/model.js` (`setCaption`), `mobile/js/report.js`, `mobile/index.html`, `tools/build_pwa.py` +
  workflow paths (publishes `core/caption-plate.js`), `docs/FORMAT.md` (`captions`), `ARCHITECTURE.md`,
  `MANUAL.md`, tests (`pwa_unit.cjs` captions test; `pwa_touch.cjs` / `test_pwa.py` plate fold / side / edit).
- **Notes:** no format version change: `captions` is an optional note field; older clients keep it. It is note
  content: editing stamps `edited_at`, so merges are unchanged (rule 3) — concurrent edits of two different
  pictures' texts keep only the later note copy, as with text / shots (deliberately not a per-caption merge;
  that would need a parity change in `Library.import_annotations` and `mergeRows`). Frame keys are written as
  `t:<ctx.t to 3 dp>` and read by each client's own frame rule (`same` argument), never by string equality.
  Reply pictures have no texts (the reply's words are theirs). Desktop plate shows only in annotation mode with a
  note picked and the frame / view on screen being one of that note's (its own, one it drew on, one with a text).
  The HTML reviewer page shows `picText` and frame / view captions but not screenshot texts, and cannot edit
  texts yet. 3D was checked by reading only (no 3D asset in the container); image and video were driven in
  Playwright on a dev server with a scratch library.
  Review (fresh agent): no crash-level bug. Fixed: (1) a press on the plate body's scrollbar (mouse, long text)
  moved / folded the plate — `down` now skips it; (2) the HTML reviewer page dropped screenshot texts — `thumbs`
  takes `shotCaptions`; (3) the screenshot overlay's plate leaked its resize listener when the lightbox closed or
  the asset changed — `S.shotView` / `closeShotView()` in `setAsset` / `unmount`; (4) `destroy()` of a plate with an
  open edit ran after `S.asset` changed / after `flush` — the plates are now destroyed first; (5) a click on the
  plate's pencil while editing saved and reopened the editor, a press on the plate while editing folded it; (6)
  `captionsHtml` sorted an unknown view as NaN; a click on a screenshot's text row now opens that picture; the
  plate blocks the browser context menu. Left as is: Enter during IME composition saves early (same as every
  editor here; `hotkey` does not check `isComposing`); a frame text on a frame whose drawings were all deleted is
  listed in the card and on the plate but not in the reports (they walk frames with drawings); the screenshot
  overlay's plate does not follow note edits made elsewhere while it is open; `paintPlate` scans the items every
  frame while a note is picked (cheap at review sizes). Fixes re-tested (unit, PWA touch, desktop Playwright), not
  re-reviewed. Not committed.

## 0.45.2 — 2026-11-13 — Lightbox: Alt+drag scrubs a video; a video turns with Ctrl+Alt+drag
- **What:** Alt is the quick 2D gesture again. Alt+drag on a picture turns it by hand, as before. On a video plain
  Alt+drag scrubs it (sideways on the picture), which is what the Alt-over-a-drawing-tool mode (0.40.0) relies on.
  A video's by-hand turn moves to Ctrl+Alt+drag (Cmd+Alt on Mac). Shift still snaps to 15°.
- **Where:** `app/static/index.html` — the viewer `wrap` `pointerdown` (turn branch condition now
  `altKey && (!isVid || ctrlKey || metaKey)`). `MANUAL.md` (Turn by hand). `app/version.py`.
- **Notes:** the 3D lights are on Shift+right-drag (0.41.1), so Alt is free there; the 3D slider label already says
  "Rotate all (Shift+right-drag)". Canvas Alt+drag (crop pan, background pan) is unchanged.
  Plain drag still scrubs a video, as before. Supersedes the 0.43.0 remark "Alt+drag on a video no longer scrubs"
  and the MANUAL turn line. Ctrl-click on a video does not turn it (the turn needs Alt).
  Known, left as is: in annotation mode the Alt cursor and faded bar also show over a picture, where Alt now turns
  it (`altCam` in annotate.js does not check the kind). On Windows an AltGr press reports Ctrl+Alt, so AltGr-drag
  turns a video too.
  Review: two fresh-agent rounds. Round 1 (the Ctrl+Alt-for-both version) found no correctness bug in the turn
  branch. Round 2 (this version) found three, all fixed here: (1) a `pointercancel` (the browser took the pointer
  mid-drag) set `justScrubbed`, but no click follows, so the next real click on the video was swallowed — `end`
  now takes `cancelled` and sets the flag only on pointerup; (2) an image turn set `justScrubbed`, which the click
  handler (video only) never clears — the flag is set only for a video turn; (3) an Alt-scrub press now calls
  `preventDefault()`, as the turn does, so it does not start a native text selection. Not tested in a browser:
  checked by reading the code and `node --check` on the inline script. Not committed.

## 0.45.1 — 2026-11-13 — Annotations: fixes to the 0.45.0 lock
- **What:** review of 0.45.0 found four gaps, fixed here. (1) The Hold selector changed the on-screen time of a
  baked drawing: it now changes only editable drawings, and it is not shown for a selection with none. (2) Front /
  Back (Ctrl+] / Ctrl+[) could put a new drawing under a baked one or give two drawings the same z: Front now puts the
  selection above every drawing, Back below every drawing, keeping the order inside the selection. (3) A baked
  drawing had handles and a box it did nothing to: now it gets only a dashed outline (it is still selected for Delete);
  the box and handles are for the editable selection. (4) Pre-existing: a copy (Ctrl+D, Ctrl+V) of a reply's drawing
  kept `data.reply`, so once added to a note it was left out of that note's own pictures; copies now clear it.
- **Where:** `app/static/annotate.js` — `renderSel` (`editSel` for the box and handles, dashed rect for baked),
  `renderProps` / the `data-shold` handler, `reorder`, `duplicateSelection`, `paste`. `app/version.py`.
- **Notes:** supersedes the 0.45.0 remark that the properties panel does nothing for a baked drawing: the Hold
  selector still shows (for an editable selection; its value is read from the first editable drawing that has a
  time), and the other controls only ever change editable drawings.
  Not tested in a browser: checked by reading the code and `node --check`. Undo of a Front / Back step is the
  generic z snapshot, as before.

## 0.45.0 — 2026-11-13 — Annotations: drawings added to a note are fixed
- **What:** a drawing already added to a note (or to a reply) can no longer be edited. It can still be selected and
  deleted from the frame (Delete, Shift+Delete, the bin, Ctrl+A then Delete, the eraser in full mode). Moving,
  scaling / rotating / line-end handles, restyling (colour, width, text props), arrow nudging, Ctrl+[ / Ctrl+],
  partial erasing and double-click text editing do nothing to it. Only drawings not yet added to a note are editable.
- **Where:** `app/static/annotate.js` — `baked` / `editable` (new, after `visibleDrawings`), `editSel` (handles and
  handle drags), `onDown` (select tool: a baked hit is selected but not dragged; the move drag takes editable ids
  only), text tool and `dblclick` (only editable text opens), `eraseAt` (partial mode skips baked), `nudge`,
  `reorder` (only editable drawings take part; baked z is kept), `setProp`, `addNote` (clears undo / redo).
  `MANUAL.md` (Annotations).
- **Notes:** `baked` means `data.note` is set, so replies' drawings (`data.reply`) are locked too. Copy / duplicate /
  paste of a baked drawing make a new, editable, unattached drawing (the original stays). Deleting a whole note still
  deletes its drawings with it (`onListClick` `data-del`), as before — that is a note action, not a drawing edit.
  Undo: `addNote` now clears the undo and redo stacks, because an older step could otherwise detach a baked drawing
  from its note or rewrite its fields. Known, left as is: the HTML review page and the phone app are not changed; the
  properties panel still shows a baked drawing's values (controls do nothing to it). Not tested in a browser: checked
  by reading the code and `node --check app/static/annotate.js`.

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
