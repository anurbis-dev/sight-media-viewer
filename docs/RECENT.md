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

## 0.95.1 — 2026-11-19 — Board and 3D zoom use the shared zoom maths and finger tracking
- **What:** stage 3 of `docs/PLAN-viewer-input.md`. No visible change meant: the board (right-drag zoom, Ctrl+wheel, two-finger pinch) and the 3D viewer (wheel, right-drag, pinch dolly) now take their zoom factors and finger tracking from `viewer-input.js`.
- **Where:** viewer-input.js (`pinchTracker()` new — the module's own fingers use it too); canvas.js (`zoomFactorDrag` / `zoomFactorWheel`, the pinch on `pinchTracker`, incremental: zoom about the pair's previous middle, then pan by its move); index.html `bind3dZoom` (same helpers; `dolly(f)` takes a factor now).
- **Notes:** the board's left button, item drags, marquee, right-click menu (a right press without a 4 px move) and plain-wheel pan are unchanged — the board does not use `attachViewerInput`, only the helpers. 3D was already incremental and stays so; it keeps its pinch speed (finger ratio ^ zoomSpeed; the 2D pinches ignore zoomSpeed). The board's pinch now goes on with the remaining pair when one of three fingers lifts (it stopped). The 3D Ctrl / Shift right-drags (mesh path) are untouched. Next: stage 4, Shift slows the board / 3D drags.
- Review (fresh agent): the maths matches the removed code (board right-drag / Ctrl+wheel, 3D wheel / right-drag / pinch, the module's pinch on finger add / lift). Found: the board pinch is now incremental, so at MIN / MAX zoom it turns back at once instead of the old dead zone (accepted, noted here); two redraws per board pinch move — now one. Left (as before): `bind3dZoom` drops a finger only on `el`'s pointerup / cancel, so a touch released outside it without capture stays counted.
- The same reviewer confirmed the fixes and found nothing new.

## 0.95.0 — 2026-11-19 — Lightbox 2D viewer on the shared input module: touch pinch, left-drag pan on pictures
- **What:** stage 2 of `docs/PLAN-viewer-input.md`. The lightbox's image / PSD / video viewer (`attachViewer`, also the 3D UV pane) takes its pointer input from `viewer-input.js`, like Compare. New for the user: **two-finger pinch-zoom / pan** on pictures and videos, **a left drag (one finger) pans a picture** (it did nothing), Shift slows pan / right-drag zoom / the wheel (×0.2). Unchanged: click a video = play / pause after 250 ms, double-click = Frame ↔ 100 %, left drag scrubs a video (window width = the clip, Shift ×0.1), Alt-drag turns a picture, Alt-drag scrubs a video and Ctrl+Alt-drag turns it, middle pans, right drag / wheel zoom, digits 1–9.
- **Where:** index.html `attachViewer` (the click / dblclick / pointer / wheel listeners, `clickTimer`, `justScrubbed`, `vs.panD / zoomD / rotD / scrubD` replaced by one `attachViewerInput(wrap, …)`: Alt turn = `claim`, scrub = `beginScrub` / `seekVideo` / `endScrub`, a sequence hands over to `seqScrubBegin` in `scrub.begin`; returns `destroy`), `fillStage` / `closeLight` (destroy `stage._vinput`); viewer-input.js (presses on inputs / textareas / contenteditable are left alone; window touch listeners only while a finger is down); MANUAL, ARCHITECTURE, PLAN.
- **Notes:** the module is attached before `annot.bind2d`, so its second-finger capture hook runs before the annotator's capture `onDown` on the same `.view`: a pinch while drawing drops the stroke (`annot.abortGesture`). The click is decided on pointerup, so while annotating a press the annotator keeps no longer plays / pauses via a stray `click` event. A sequence scrub stays claimed in the old viewer with no-op `to` / `end` until release (its window listeners run it across cuts). The text document viewer is left out (left button = text selection). Next: stage 3 (board and 3D zoom use the exported factors / a pinch helper).
- Review (fresh agent): a second finger did not stop a sequence picture scrub (pinch and scrub together) — `seqScrubBegin` now registers `light.seqDrag {pid, end}`, ended by `abortOthers` and `closeLight`, and a press on a later clip's viewer while one runs stays dead; closing mid-scrub re-pinned the server's RAM window to the closed clip — `closeLight` destroys the input before `releaseMedia`; the UV pane's input was not destroyed when the pane went (`syncUvPane`, "No UVs") — fixed; a prevented press kept focus in a field elsewhere (Space / digits went there) — the module blurs a focused field outside `el` on a plain left press (as the browser did; middle / right / Alt presses keep a half-typed reply open). Accepted: a triple-click on a video toggles on the third click; right-drag zoom is incremental, so past the max scale it zooms out at once on the way back; a mouse release lost outside the browser leaves `seqDrag` set until the next pointerup (a new press stays dead meanwhile).
- The same reviewer confirmed every fix (blur narrowed to a plain left press without Alt after its note) and found nothing new.

## 0.94.2 — 2026-11-19 — Shared viewer input module; Compare runs on it
- **What:** stage 1 of `docs/PLAN-viewer-input.md`. New `app/static/viewer-input.js` (`attachViewerInput`, `zoomFactorDrag`, `zoomFactorWheel`, `wheelDelta`): the press / click / drag decision, the 250 ms click hold, Shift-fine, right-drag / wheel zoom maths, pan, pinch, pointer capture and its retake, window fallbacks. Compare's picture input now goes through it; the behaviour is meant to be unchanged (click, double-click, scrub, split, zoom, pan, wheel, touch tap / scrub / pinch).
- **Where:** viewer-input.js (new); compare.js (`bindStageInput`, `splitDrag`, `liveBox`; `startScrub` split into `scrubBegin` / `scrubTo` / `scrubEnd` — the timeline keeps its own absolute drag; `onDown` / `onMove` / `onUp` / `startPinch` / `onWheel` / `touches` / `C.clickT` / `C.drag` / `C.onScrubEnd` gone); index.html cmp host `abortAnnot`; ARCHITECTURE, PLAN-viewer-input ("As built").
- **Notes:** callbacks are incremental (`pan` px, `zoom` factor about a client point), `scrub.to(frac)` cumulative. A second finger is caught in the stage's capture phase: it now also drops a stroke the compare annotator's first finger began (`abortGesture`) — before, the box-level annotator kept the first finger and the pinch did not start while drawing. A mouse move with no buttons ends a drag (not after a capture loss in it). Next: stage 2, the lightbox's `attachViewer`.
- Review (fresh agent): no high-severity bugs; a stage press while a timeline scrub ran panned the picture (now a dead claim); a throwing end in `destroy` could leave window listeners (try/catch); a double-click between tiles no longer fitted (`dblclick` is not gated by `canStart` now); PLAN stage-1 text fixed. Left: a buttonless mouse move ends a drag unless capture was lost first (per spec capture loss comes first — check the 0.92.1 overlay case on Windows); a finger on an annotator control inside the box counts toward a pinch (stage 2 note); `close` mid-scrub runs `scrubEnd` on media about to be released (harmless).
- The same reviewer confirmed every fix and found nothing new (side effect: a tap on the stage during a timeline scrub no longer toggles play — intended).

## 0.94.1 — 2026-11-19 — Annotation select tool: Ctrl / Shift as in the library grid, 2D too
- **What:** owner: Ctrl in the select tool works as in the main window — Ctrl+click toggles a drawing, Ctrl+drag draws a box even when it starts on a drawing and toggles what it covers; Shift adds (Shift+click, Shift+drag on empty space, Ctrl+Shift+drag). Now in 2D as well as 3D (0.94.0 had limited it to 3D).
- **Where:** annotate.js select branch of `onDown` (the Ctrl marquee no longer gated to `model3d`; a Shift+click on a drawing adds, it used to toggle; the empty-space box clears unless Shift, `toggle: false`), cursor (`S.ctrlHeld` → default everywhere), the select hint; MANUAL.
- **Notes:** a Ctrl+press on a drawing no longer toggles-and-drags it (a Ctrl+drag is a box, as in the grid); to move a drawing, drag without Ctrl. Ctrl stays the momentary eraser only for the drawing tools (`effTool`). Compare's `wantsPress` claims Alt / a finger on a split only, so Ctrl never reaches compare.
- Review (fresh agent): no regressions (Ctrl / Shift / Alt combinations, baked items, boards, compare, the eraser, touch); a Ctrl+click on a selected small drawing or a line's end hit its handle and did nothing — a Ctrl-press (without Shift) now skips the handles; MANUAL wording tightened. Left: the cursor follows Ctrl only on a mouse move, and Cmd on a Mac boxes without changing it (cosmetic, as before in 3D). The same reviewer confirmed the fix and found nothing new.

## 0.94.0 — 2026-11-19 — 3D annotation select tool: Ctrl+drag box select, Box switch for touch
- **What:** merged the never-merged branch `ccr-90d2f55f-eyeipr` (its "0.83.0", numbered then, before master moved on). Select tool while annotating a 3D model: Ctrl+drag draws a selection box even when it starts over a drawing (Ctrl = toggle against the selection it started from, Ctrl+Shift = add — as in the library grid / board); a Ctrl-click without a drag toggles the drawing under it. In 3D a plain empty-space drag still orbits; Ctrl+drag box-selects, and a *Box* switch in the select tool's bar (3D only) makes a plain drag box-select — the touch way. A Ctrl-click on empty space in 3D still picks the model's mesh.
- **Where:** annotate.js (select branch of `onDown`: Ctrl → `S.drag.marquee` with `hit` / `boxed` / `pid`; `S.box3d`; `onMove` 4 px click threshold; `onUp` Ctrl-click toggle, 3D empty Ctrl-click → `S.b3.pickMesh`; second-finger guard; `lostpointercapture` ends a stuck marquee; cursor; `renderProps` Box button + hint); index.html (`pickMeshAt(cx, cy, ctrl)` in boot3d, passed to `bindAnnot3d(…, pick)` → host `pickMesh`, absent for splats); MANUAL.
- **Notes:** owner: **3D only** — 2D needs no Ctrl box mode (no orbit on a drag: a plain drag on empty space is the box), so the branch's 2D change (Ctrl+press on a drawing = box, Ctrl+Shift = add) was dropped; in 2D Ctrl still toggles a drawing on click and a Ctrl box on empty space toggles, as before. The 4 px click threshold and the pointer-tied marquee apply in 2D too (harmless). The annotator grabs the Ctrl press, so the 3D viewer never sees it — hence the explicit `pickMesh` hand-back. A marquee is tied to its pointer: a second finger is ignored, so pinch-zoom is off while *Box* is on. `S.box3d` is per session. **Not merged from that branch:** its "0.83.1" (3D drawings shown only while a note is picked, loose ones hidden then) — master had since made 3D drawings show while watching (`shownOff`), so those hunks (`modeAllows`, `L.root.hidden`, the pick `renderAll`) were dropped in the merge. The branch's own review (4 findings, fixed there) came with it.
- Review of the merge (fresh agent): every box-select hunk present and in scope against today's code (`pickMeshAt` / `bindAnnot3d`, splats pass no pick), no 0.83.1 hunk left, 2D equal to before apart from the 4 px click threshold, no interaction with compare / board / Ctrl eraser; it caught 0.83.1's ARCHITECTURE text still staged in the index — fixed before the commit. Left: Cmd+drag on a Mac does not switch the cursor (cosmetic).

## 0.93.1 — 2026-11-19 — Compare: a double-click no longer toggles play twice; plan for a shared input module
- **What:** a click on the compare picture now waits 250 ms before play / pause, as in the lightbox, so the second click of a double-click (fit) cancels it. New `docs/PLAN-viewer-input.md`: today every viewer (lightbox 2D, sequence, compare, board, 3D zoom, annotator, phone / HTML page) has its own pointer code; 0.93.0 wrote the compare's anew. The plan specifies one `viewer-input.js` module (click hold, scrub / pan / zoom / pinch, Shift-fine, capture handling) and the stages to move each mode onto it.
- **Where:** compare.js (`onUp` timer `C.clickT`, `dropClick`, stage `dblclick`, `close`); docs/PLAN-viewer-input.md (new), docs/PLAN.md (link).
- **Notes:** `dropClick()` runs in `togglePlay` (Space / ▶ while a click is pending would otherwise be undone 250 ms later), `startPinch`, `pause` and `seekLayer` (the annotator stopping / moving the clock), and a scrub start. Two quick clicks within 250 ms do nothing (the lightbox would toggle once) — `pointerup.detail` is not reliable enough to copy its test; left. The lightbox's 2D viewer has no touch pinch today: the plan's stage 2 gives it one.
- Plan review (fresh agent): several facts were wrong or missing (the embedded viewer is the 3D UV pane; the board's wheel pans; 3D dolly is incremental with its own pinch maths; the annotator / board second-finger ordering; lightbox video touch already scrubs; no teardown in `attachViewer`; the doc viewer) — corrected; the same reviewer re-checked, its last three wording items applied.
- Review (fresh agent): correct; Space / ▶ / a pinch / the annotator's pause within the 250 ms could be undone by the pending toggle — fixed with `dropClick`; the same reviewer confirmed it and found nothing new.

## 0.93.0 — 2026-11-19 — Compare: viewer-style picture input, Row fixed, viewer's top bar, Compare from the selection
- **What:** owner's list. (1) On the compare picture a click plays / pauses, a left drag scrubs every clip, a right drag zooms, a middle drag pans — as in the viewer; a swipe split is grabbed only by a press right on it (10 px, finger 24 px), so it no longer eats every click / drag. Touch: tap, one-finger scrub, two-finger pinch-zoom / pan. (2) **Row was black**: the stage got the class `row`, which is the sidebar's menu-row class (`display:flex; height: var(--menu-row-h)`), so every cell had 0 height. The layout class is now `lay-<layout>`. (3) The right end of the compare bar is the lightbox's: notes button (`C`, badge), eye (while drawing), the compare icon (on; closes), annotate as an icon, ✕. (4) Layer chips: click shows / hides (a layer brought back is selected), middle-click removes, the ◉ button is gone. (5) The offset's − / + buttons are gone: drag the number sideways to slide the clip live (6 px per frame), click it to type. (6) **Shift slows every drag** (scrub, timeline, zoom, pan, split, offset) and can change mid-drag without a jump. (7) A chip drag shows the whole chip (mouse: `setDragImage` of a clone; touch: a clone follows the finger). (8) With 2+ images / videos selected, *Compare* sits next to *▶▶ Sequence* in the top bar and the touch selection bar, and the right-click menu has *Compare (N)*.
- **Where:** compare.js (`startScrub` — the timeline's scrub, now shared with the stage —, `splitNear`, `layerAt`, `onDown` / `onMove` / `onUp`, `startPinch`, `zoomAt`, `hoverCursor`, `chipGhost`, offset drag in `bindUi`, the bar markup, CSS `lay-*`, `.cmp-ghost`); index.html (`cmpAnnot` host `notesBtn` / `eyeBtn` / `notesBtnShown`, no `readPanel: false`, `onView` always `cmpBind`, `C` routed to `cmpAnnot` while not drawing, `bindAnnoReset` on the compare's annotate button; `cmpCandidates` / `compareIds`, `#cmpSelBtn`, `#tsCmp`, ctx `cmp`); MANUAL, ARCHITECTURE.
- **Notes:** the scrub click detection is on pointerup (no move ≥ 4 px) — not the `click` event — so the annotator's own click suppression is not involved; while annotating, the annotator's capture `onDown` keeps the press unless `wantsPress` (Alt+left: the nearest split at any distance; a finger on a split). Images only: a left drag pans (nothing to scrub). A second finger cancels a running scrub by dispatching `pointercancel` for its pointer on window (startScrub's own end path). The compare annotator now fetches the selected layer's notes on every selection (for the badge / reading panel), not only while drawing; `showWhileWatching` stays false, so drawings and the eye still show only while drawing. The notes panel state is the lightbox's (`sight.annotate.read`). `[` / `]` keep `Shift` ×10 (keys, not a drag). Selecting a layer: a press on its tile / swipe region, `↑` / `↓`, or a chip click that shows it.
- Review (fresh agent): the touch map outlived a closed comparison (a finger down while it closed made every later tap a pinch and froze the stage); while annotating a chip click hid the layer instead of picking it (no other way to switch layer there); letting go of Shift during a timeline drag jumped to the pointer; a rebuild mid-drag (layout / H / D key) left zoom / pan / pinch on a detached box (NaN view); a chip repaint mid offset-drag killed it and let the closing click toggle the chip; offset padding click toggled; split cursor stuck while annotating. All fixed (`touches.clear()` in open / close and before the `!C` guard, annotating chip click selects, track stays relative after Shift, `d.box` re-queried, offset drag on window listeners). Left as is: a double-click on the picture toggles play twice then fits (net state unchanged, as in the viewer).
- The same reviewer confirmed all fixes; its one optional nit (a mouse released outside the window mid offset-drag kept sliding) is fixed too.

## 0.92.2 — 2026-11-19 — Review import: no blocking dialog, no lightbox hidden under Compare
- **What:** owner: after dropping a review file onto the desktop app, thumbnails stopped appearing and clicks in the sidebar did nothing. Not reproduced in Playwright (single file / bundle / re-import / filtered grid / Tab split / Sequence / Compare / large videos — the server stayed responsive), but two causes in the import path fit. (1) The "Restore deleted notes?" question was a native `confirm()`: it blocks the whole page, and after a drop from the file manager the app window has no focus, so the dialog can sit unseen. It is now a non-blocking bar at the top of the window (*Restore* / ✕, closes itself after 15 s, a hover keeps it); the first merge is reported and the file opens before it shows. (2) A review dropped while Compare was open opened the lightbox hidden under Compare, with drawing mode on, and its video took the compare's RAM windows. The lightbox annotator's `openAsset` now closes Compare first, as the compare annotator's already did.
- **Where:** annotate.js `importFile` / `importedResult` (new, the toast + open of one pass) / `offerRestore` (new, `.an-offer` CSS) / `importedBundle(r, restored)`; index.html `annot` host `openAsset` (`cmp.close()`); library.py `match_review_asset` (a size the file gives as a non-number, or a library row without a size, no longer raises: was a 500 for a plain package); MANUAL.
- **Notes:** every import answer carries `at` (server ms before the merge); Restore flushes pending edits and posts `?restore=1&before=<at>`, so only rows deleted up to the first pass come back — one deleted here while the bar was up stays deleted (`Library.import_annotations(restore_before=)`, Sight only, not in the JS port). Do not build that query with `| 0`: a ms timestamp overflows int32. The restore pass calls `host.openAsset(id, {keep: true})`: Compare closes, but the file already showing is not opened again (that would restart its viewer); from the compare's annotator the lightbox re-reads its notes. Its toast says *Restored from the review file*. The two passes are reported in two toasts now, not summed into one. The bar lives on `document.body` (z-index 130, above the lightbox 50 and Compare 60) and stops pointer / key events from reaching the page under it. Other native `confirm()` calls (remove a folder, remove missing files, reset settings, restore shipped filters, the HTML page's discard-drawing) are left: they come from a click inside the window, which has focus.
- Review (fresh agent): Restore could revive a row deleted after the first pass (the bar stays up, no flush); Restore with Compare open over the lightbox switched drawing on under the overlay and left Compare's view stale; Restore after an import from the compare's annotator restarted the lightbox viewer. Fixed (`restore_before` / `at`, `flush()`, `openAsset` `keep`); test `test_restore_only_rows_deleted_before_the_first_pass`. The same reviewer confirmed all three fixes and found nothing new.

## 0.92.1 — 2026-11-19 — Compare keeps every clip on screen, and a scrub no longer sticks
- **What:** in Compare, every clip's picture keeps moving while they play, and a timeline drag no longer drops a red blocked-media mark and freezes. Until a scrub copy can show a frame, the picture stays where it was and every clip jumps to that frame together when you let go (a clip you have dragged past shows its last frame, and one the playhead has not reached shows its first). Once the copy is ready, the drag follows it, and that decoder is closed again when the full file takes over.
- **Where:** compare.js (`armScrubs`, `releaseScrubDecoder`, `syncVideos`, `queueRelease`, the timeline pointer handlers, `.cmp-m`).
- **Notes:** a plain `<video>` on Windows is promoted to a hardware overlay. Only a couple of those exist, so the clips that do not get one keep their old picture until playback stops, and in Column the overlay lands on the timeline and cancels the drag. `.cmp-m` uses `clip-path: inset(0)` so every compare clip stays on the normal compositor. The dim on a clip outside its span is not changed while the pointer is down (putting opacity back to 1 promotes it and cancels the drag). Losing pointer capture mid-drag is not a release — capture is taken back, and the drag ends on pointerup. The scrub element has no `src` until the drag starts, and the src is removed when the proxy is hidden, so those decoders are not held during playback. While the proxy cannot show a frame, the full file is not seeked on the way down. Letting go seeks every clip once: one the playhead has left goes to its last frame, one it has not reached goes to its first. The proxy stays up until that frame is presented (hiding it on pointer-up flashed the pre-drag picture and kept the decoder). Closing Compare during a drag removes the window listeners that finish it. The RAM byte cache, the scrub mp4 and scrub audio are unchanged.
- Review (fresh agent): an out-of-span proxy was hidden before the full file presented the edge, a clip the playhead had not reached snapped back to its old frame, and closing Compare mid-drag leaked the window listeners. Fixed (`clipLocal`, `atPlayhead`, `queueRelease`, `close`). The same reviewer confirmed the fix and found nothing new.

## 0.92.0 — 2026-11-19 — Compare scrubs every clip from a short-GOP proxy
- **What:** dragging the compare timeline seeks each clip's small scrub copy (a keyframe every few frames), made as soon as the comparison opens, so several clips follow the pointer together. Until a copy is ready, that clip is still seeked, but only one seek at a time, so a slow clip keeps its last frame. Letting go seeks the full file once and the proxy stays up until that frame is on screen.
- **Where:** compare.js `ensureScrubs` / `pumpTime` / `wantTime` / `settleScrub`; library.py `SCRUB_PARALLEL` / `_encode_copy` / `_stop_scrub_procs`; tests/test_playback_copy.py; MANUAL, ARCHITECTURE.
- **Notes:** up to 3 scrub encodes at once (decode, scale and encode each capped at 2 threads). A playback copy still goes first and stops every running scrub encode; those jobs start over. Letting go queues the release time even when a seek is already in flight, so an older `seeked` cannot take the proxy down. Clips under 3 s are skipped, same as the lightbox. The proxy is shown only during the drag, after it has landed on that drag. Difference tiles paint from the proxy while it is the picture on screen. The RAM byte cache is unchanged. The phone scrub cache is unchanged.
- Review (fresh agent): while playing, a full-file seek still in flight when the proxy became ready hid the proxy on that older frame. Fixed (`queueRelease`, `settleScrub` only once the primary is on the playhead). The same reviewer confirmed the fix and found nothing new.

## 0.91.1 — 2026-11-19 — Scrub audio plays from a PCM cache
- **What:** sound while scrubbing no longer stutters. A drag used to `play()` the video for 90 ms at each position, so every move waited on that seek (the scrub copy has no audio). Sight now extracts the clip's audio once to a mono 16-bit PCM cache and plays slices of it while the picture scrubs; a slow drag hears the sound continuously, a jump starts at the pointer.
- **Where:** library.py `start_scrub_audio` / `scrub_audio_path` (file `thumbs/video/<aid>_<stamp>.scruba.pcm`, 22050 Hz mono s16le); server.py `POST/GET /api/video/scrub-audio`; index.html `scrubHear` / `saPlay` (replaces `scrubBlip`); tests/test_playback_copy.py; MANUAL, ARCHITECTURE.
- **Notes:** the cache is built when scrub-audio is turned on or a clip opens with it already on (`Caching sound for scrubbing…` only while an extract is actually running). A clip with no audio track is remembered as `silent` until the file changes. The player stays paused during the drag — nothing sets `_blip` anymore. The PCM is not in the scrub mp4 and not in the RAM byte window: those seeks were the stutter. Playback copies still go first on the video encode slot; this extract has its own one-at-a-time slot and may run beside a scrub-copy encode. Kept like scrub copies: newest 20 files / 1 GB, and the one just made. The phone app has no scrub-audio toggle, so it is unchanged. Windows Int16 is little-endian, matching `s16le`.
- Review (fresh agent): playback-copy cleanup treated `.scruba` as a playback file and deleted it (a locked `.part` could also fail the transcode); a probe with no stream list was stored as `silent` and never retried. Both fixed (`_video_cache_kind`, banner needs `Input #`); the same reviewer confirmed them and found nothing new.

## 0.91.0 — 2026-11-19 — Phone: Settings → Debug log, sent as a file
- **What:** owner: a debug option in Settings that collects data to send as a file, not a screenshot. Settings →
  *Debug log* On / Off; *Send debug log…* shares / downloads `sight-debug-YYYYMMDD-HHMM.txt` (a header with the
  device and app, then one JSON array per line `[ms, event, data]`); *Clear*. Off stops recording but keeps the
  data (Send still works); only Clear deletes it.
- **Where:** mobile/js/debug.js (new: `dbg.log / set / flush / clear / text / sample / info`); hooks in
  mobile/js/media.js (`turn`, `poke`, `c.plan`, `c.open`, `c.part` — part, rate, seek ms, frames got vs
  presented, gaps, why it ended —, `c.busy*`, `c.dead`, `c.release`, `c.broken`; caches get a `tag`) and
  mobile/js/app.js (`dbgPlayer`: play / playing with the delay since the tap, waiting, seeking / seeked ms;
  stage `ptr.down` / `click`, `tap.play`; a `sample` each second: playhead, player, every cache's runs; Settings
  section); index.html (margin rule); MANUAL, ARCHITECTURE.
- **Notes:** `dbg.log` is a no-op while off. Memory: ≤ 15,000 lines and ≤ 6M characters (pre-built JSON strings).
  localStorage `sight-review:debugLog` = `{sessions: [{started, ev}]}`: the earlier saved sessions plus this one
  (≤ 4), newest lines first within 1M characters, written every 15 s, ≤ 2 s after an error / `v.error` /
  `c.broken` (one save per 2 s: a burst of errors must not write the tail each time), at once when the page is
  hidden; the old value is removed first (a failed write never leaves stale data), half the budget on a full
  storage. The file shows them as "# earlier session" blocks. Two tabs recording at once overwrite each other. The first look at a log already showed a real bug: a WebM's frame rate is a
  guess (25) until known, so the fill ran at 60 / 25 = 2.4× on a 30 fps clip and dropped a frame in four; the
  rate now uses the shorter of the guess and the measured step (in 0.90.2 below).
- Review (fresh agent): a failed save left an older tail shown as the previous session; a foreground crash lost
  everything since the last hide; Off deleted the log with no way to send it; memory unbounded per event; a stale
  `sinceTap`; Settings margin — all fixed. Re-checks by the same reviewer found a save per error in a burst and
  the earlier session lost after a restart — both fixed; the third re-check confirmed everything (Playwright:
  quota, reloads, old format, error bursts).

## 0.90.2 — 2026-11-19 — Phone scrub cache: one window across the cut, the player first, every cached part on the strip
- **What:** owner (on the phone, after 0.90.1): tap-to-play lagged up to 4 s even with a full cache; the green strip
  lost the old cache on a jump and showed nothing new while the playhead stood; the fill looked like 30 / 70, not
  70 / 30; behind the playhead it filled towards it. Measured in Playwright first (a 60 s + 20 s sequence, the
  cache sampled each second), which showed: (1) the strip drew only the unbroken run around the playhead, and the
  2× fill drops frames, so that run stayed tiny until the holes were sought one by one; (2) the open clip filled
  its whole window, far behind included, before the next clip got a frame — so in a short clip near its end the
  left side won; (3) a move of the playhead under 2.5 s did not re-target the fill; (4) behind parts of 2 s
  played forwards. Now: the strip draws every cached run (gaps ≤ 3 frames ignored); caches take turns by the
  cost of their next part (distance from the playhead in the sequence, behind × AHEAD / (1 − AHEAD), + the
  range's `base`), the owner yields only to a part cheaper by 3 s; a `from` move is taken at once; behind parts
  are 1 s; while a play starts (until `playing` + 300 ms), the player seeks, or it stalls, no cache fetches
  (`ScrubCache.busy`), and `ScrubCache.poke()` on the player's `play` / `seeking` stops the running part at once.
- **Where:** mobile/js/media.js (`costOf`, `turnPick`, `turnWanted`, `TURN_HYST`, `isBusy`, `ScrubCache.busy /
  poke / wb`, `want` in-place `from` / `base`, `job.held` / `jolt`, `nap`, `stopPart`, `runs(gap)`, the `dead`
  rule, the fill rate); mobile/js/app.js (`cacheFocus` bases, `playPend`, `ScrubCache.busy` hook, `paintCache`
  draws all runs); mobile/index.html (`.tl .cache` is a container of `<i>` runs); MANUAL, ARCHITECTURE.
- **Notes:** tried and rejected: filling at ≤ 40 presented frames/s and patching holes by slow replay — in
  Chromium coverage grew three times slower than 2× + frame-by-frame seeks; the dropped frames are hidden on the
  strip instead. A part is cut only if it held `from` when it began and `from` left it (a playing clip moves
  `from` every frame); jumps / scrubs stop it via `poke`. A cut part (moved / busy / poke / yield / replan /
  closed) is never marked `dead`. Never end a part on the player's `pause` event: the one fired for the previous
  part's own pause arrives later and killed the next part at once. Still a hypothesis on the phone: the play lag
  came from the hidden player decoding next to the visible one — the debug log (0.91.0) will show `sinceTap`.
- Review (fresh agent): a late `pause` event ended every second part; `jolt` cut nearly every part while playing;
  cut parts were marked `dead` for good on clips that fit the window; the idle release never fired while playing;
  busy / jolt unchecked before the first seek / play; `close()` held the turn up to 1.5 s — all fixed, each
  confirmed by the same reviewer with its Playwright repros.

## 0.90.1 — 2026-11-19 — Phone: the open clip's scrub cache no longer loses the decoder to a neighbour
- **What:** owner: in a 2-clip sequence the open clip got no cache at all, the neighbour got all of it. Cause (most
  likely, seen on Android): a neighbour's cache that yielded the turn (or sat idle / parked) kept its hidden
  `<video>`; with the visible player that is three decoders, the open clip's hidden player failed to open and
  `open()` marked the cache `broken` for good. Now only the cache holding the decoder turn keeps a hidden player.
- **Where:** mobile/js/media.js — turn queue (`openCaches`, `turnPick` releases every other cache's player),
  `ScrubCache.open` (a failed open retried after 1.5 s / 3 s, `broken` after 3: deadline `openAt` with its own
  `openT` / `openOk`, not `wake`), `Grabber` (player given back 3 s after its last grab); mobile/js/app.js
  `loadedmetadata` (a pooled `broken` cache is not adopted, a fresh one is made).
- **Notes:** each turn handoff now reopens the other cache's player (a reload, a few hundred ms) — accepted, phones
  have few hardware decoders. The retry wait must not use `wake`: `resolve()` fires on every scrub and would burn
  the 3 tries in under a second. Not reproducible in desktop Chromium (no decoder limit); `test_seq_bar` passes.
- Review (fresh agent): confirmed the cause; found a stale `retryT` and `resolve()` cutting the retry wait short,
  adoption of a broken neighbour cache (same symptom), and the Grabber's player as a third decoder — all fixed and
  confirmed by the same reviewer.

## 0.90.0 — 2026-11-19 — Desktop RAM cache like the phone's: outwards from the playhead, across cuts; ahead share in Settings
- **What:** owner: the desktop cache should work like the phone's, with 70 / 30 instead of 60 / 40, and the share
  in Settings on both. Desktop: the RAM window now loads outwards from the playhead (behind blocks interleaved,
  not after all of the ahead part), and in a lightbox sequence the part past a clip's end goes to the next clip's
  start, before its start to the previous clip's end (loop on wraps) — a cut either way reads from RAM, and the
  hidden preload `<video>` of the next clip is served from it. Settings → Video → *Cache ahead* (50–90 %, default
  70) on the desktop, Settings → *Cache ahead* (50–90 %) in the phone app; the phone default is now 70 too.
- **Where:** app/library.py `SlidingVideoCache` (`_Window.ranges` / `wants`, `_plan`, `configure(mb, ahead)`,
  `focus(path, pos, next, prev)`, `focus_many`, `_missing` costs), app/server.py `/api/video/focus` (`ahead`,
  `next`, `prev`), app/static/index.html (`clampAhead`, `videoAhead` theme key + slider, `pushVideoFocus`
  neighbours, `seqToggleLoop` re-push, host `cacheAhead`), app/static/compare.js (sends `ahead`),
  defaults.json; mobile/js/app.js (`AHEADS`, `setCacheAhead`, settings sheet), mobile/js/media.js `AHEAD` 0.7,
  mobile/index.html; tests/test_video_cache.py (new); MANUAL, ARCHITECTURE.
- **Notes:** the ahead share is server-wide state (like the budget): every focus post carries it, so the saved
  value applies from the first video after a restart. The compare keeps one window per clip and no neighbours.
  The playhead's byte is still `size · t / duration` (no byte↔time index), so the windows are approximate in
  time on VBR files, as before. The phone setting is per device (`localStorage`), not synced with Sight.
- Review (fresh agent): no correctness bugs; three minor ones fixed — a neighbour shorter than the overflow
  wasted the rest of the window (now it goes to the other side of the playhead, desktop and phone); a short
  2-clip loop partner listed blocks twice (`_missing` dedupes, the two ends share one cap); the phone's fill
  weighted behind by a fixed 1.5 (now `AHEAD / (1 − AHEAD)`, like the desktop). Confirmed by the same reviewer
  (20,000 random plans: every range inside its file, no block twice, budget fully used, playhead inside).
