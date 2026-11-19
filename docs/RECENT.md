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

## 0.89.0 — 2026-11-19 — Phone: the scrub cache follows the playhead, 60 / 40, across sequence cuts
- **What:** owner: on the phone the cache always started at the clip's start, not at the playhead; near a clip's
  end it must run on into the next clip so the cut is seamless both ways; 60 % ahead / 40 % behind. Now the
  scrub cache is a window of ~1,500 frames around the playhead, filled outwards from it (forward first, a
  second behind weighted 1.5×) and sliding with it; in a group's sequence the overflow past the end goes to
  the next clip's start, past the start to the previous clip's end (loop on wraps), each as that clip's own
  cache, taken over at the cut. The green strip shows the cached run around the playhead (no longer 0 → x).
- **Where:** mobile/js/media.js `ScrubCache` (rewritten: `want`, `next`, `run`, `open`, `fetch`, `span`, turn
  queue `turnTake` / `turnGive`); mobile/js/app.js `cacheFocus`, `scrubPool`, `closeReview(park)`, adoption in
  the video `loadedmetadata`, `paintCache`; tests/pwa_e2e.cjs `seqbar` + test_pwa.py `test_seq_bar`; MANUAL,
  ARCHITECTURE.
- **Notes:** budget is frames (`MAX` × the clip's frame length), not bytes; one hidden player per cache, but they
  take turns on the decoder (current clip first) and an idle one gives its player back after 3 s. The cut
  itself is still one `openReview` (the player is not preloaded, as Sight's adopt does) — the held frame plus
  the adopted cache cover it. Desktop checked, not changed: `SlidingVideoCache` (library.py) is a byte window
  around the playhead, 72 % ahead (`AHEAD`), loading all of the ahead part before any of the behind part, for the
  open clip only; a lightbox sequence preloads the next clip's start through a hidden `<video>`
  (`seqPreload`, the browser's own buffer, not the RAM window) and nothing of the previous clip.
  `tests.test_pwa` `test_touch` fails before this change too (a `.click` on an undefined element).
- Review (fresh agent): a one-frame hole next to the playhead was split at `from` into two halves too short
  to seek into, both marked dead for good (the clip's last frames never cached; flaky test) → holes ≤ 6 frames
  are fetched whole, dead parts are retried after 1.5 s / 3 s, play stops at the last frame; a neighbour got
  the decoder after every chunk of the open clip → the turn is kept while there is work; 60 fps clips at
  1.5× lost every other frame → rate capped at 60 presented fps; an evicted-and-retaken frame leaked a blob
  URL → per-take token; a neighbour with no kept file re-read IndexedDB on every repaint → `scrubPoolMiss`;
  parked caches kept decoding after a cut to a clip without its file → pool cleared. Re-review found the
  retry timer re-arming every 50 ms on past entries → only future entries count, a successful retry
  clears its mark. All confirmed by the same reviewer.

## 0.88.1 — 2026-11-18 — Drawing canvas: tools over the transport, tools row scrolls by drag
- **What:** owner: the drawing tools sat under the video transport, and on a narrow phone some icons went off the
  edge. Now the tools row is the bottom bar's top row (over the host's footer / transport), in one line; when it
  does not fit it scrolls sideways by a drag (finger, pen or mouse), centred while it fits. The colour button
  stays at the right end.
- **Where:** app/static/review-draw.js (`dragScroll`, `.dtrow` inside `.dtools`, bar order, CSS) — shared by
  the phone app and the HTML review page; tests/pwa_e2e.cjs `seqbar` end + test_pwa.py `test_seq_bar`.
- **Notes:** `.rd-panel` is `touch-action: none`, so the scroll is done in JS, not natively. Past 6 px a drag is
  the scroll's: the pressed button gets a synthetic `pointercancel` (cancels its 550 ms hold), open flyouts
  close, the click after a mouse drag is eaten. Flyouts still open above the whole bar (now above the tools).
- Review (fresh agent): touch / pen drag stopped after the first move (the button's implicit capture moving to
  the row fired `lostpointercapture` that ended the drag) → ignored unless on the row itself; a mouse released
  outside the row left the drag stuck → cleared on a buttonless move; a leftover `eat` swallowed one keyboard
  click after a touch drag → cleared on the next task. The test now asserts the full scroll. Confirmed by the
  same reviewer.

## 0.88.0 — 2026-11-18 — Phone: the sequence bar under the timeline, title swipe between clips
- **What:** owner: like Sight, a group's videos should play and scrub across the cuts, not one by one. A review
  whose group has 2+ videos now has a bar under the clip's own timeline with every video as a segment (name, current one
  highlighted, note / drawing ticks, playhead across all); tap / drag it to move through the whole sequence,
  playing runs on into the next clip (loop: the first after the last), a scrub on the picture past a clip's
  edge carries on into the neighbour, the last frame is held until the next clip shows. Swiping the header's
  title sideways switches clips (left = next) for any group, pictures and 3D included.
- **Where:** mobile/js/app.js (`bindTitleSwipe`, `seqInfo` / `seqLoad` / `seqGeom` / `seqAt` / `renderSeqBar` /
  `paintSeqPh` / `bindSeqBar` / `seqDragBegin` … `seqDragEnd` / `seqDragTo` / `seqSwitch` / `seqEnded` /
  `seqApply` / `seqHold*` / `seqStop`; `buildStage` video branch; `bindStage` scrub hand-over; `scrubDelta`
  (+ `scrubStep` wrapper); `openReviewNow` opts.seq, rate / clean carried; `setLoop`, `paintTime`,
  `paintMarkers`), mobile/index.html (`.sqb`, `.seqhold`, `.ttl.swipe`), tests/pwa_e2e.cjs `seqbar`,
  tests/test_pwa.py `test_seq_bar`, MANUAL, ARCHITECTURE.
- **Notes:** each clip is still its own review (notes, drawings, exports untouched); a cut = one `openReview`
  with `{replace, seq}`, so history stays one entry. Drags live on window listeners (`seqDrag`) because the
  bar / stage are rebuilt at a cut. Not done: preloading the next clip (Sight's seamless adopt) — a cut on the
  phone costs one open, hidden by the held frame. Pictures / 3D models are not on the bar (videos only); a clip
  without its file on the phone stays a dimmed segment and stops playback there. No cut while drawing or with an
  unsent note (`seqLocked`: the drag holds at the clip's edge, play stops at the end); ‹ › / title swipe /
  Page keys ask first when a draft would be lost. `ended` goes on only after real play (`R.playOn`: a paused
  seek to the very end also fires `ended`).
- Review (fresh agent): a cut dropped a drawing session / unsent draft → `seqLocked`; a touch drag lost its
  events on iOS once its target was detached → the target is moved into a hidden `.seqkeep` holder at the
  rebuild (`seqKeepTarget` in renderReview; first version moved it too early and blanked the held frame) +
  touchend safety net; paused seek to the end cut → `R.playOn`; hold not watched on a direct seek; a new
  pointer on the new stage mid-drag; panel / filter / hide reset at each cut → carried on `opts.seq`; geometry
  bounced at a cut when a length was guessed → frozen per drag (`seqDrag.G`); seqGo dropped drafts → asks
  (one dialog at a time: no ask while any sheet is open — a flag got stuck when the sheet was closed by its
  backdrop / Back); deleted-clip path repaints the header. All confirmed by the same reviewer.
- Checked (owner asked): scrub on the picture across the cut both ways, mouse and CDP touch, screencast of a
  test clip whose brightness tracks time: no black / blank frame, no flash of the wrong end of the next clip,
  the drag carries on at once (≈ 3–4 frames of held picture at a cut). Found and fixed there: the big Play
  button flashed over the picture at each cut → not added on a clip reached through the sequence (`seqPend`).

## 0.87.4 — 2026-11-18 — New row ids no longer collide on Windows
- **What:** two board cards (or boards, groups, collections, annotations) created in quick succession could get
  the same id on Windows and the second one failed with a UNIQUE constraint error (e.g. duplicating a card twice
  fast). Ids now include a random part. The intermittent `test_board_missing` failure was this bug.
- **Where:** library.py — the five `asset_id(f"<kind>:{time.time_ns()}:…")` generators (collections, boards,
  board items, board groups, annotations) now add `secrets.token_hex(8)`; tests/test_splash_win.py expects the OS
  spelling of the interpreter path (`str(Path("/x/python"))`) — the test, not the code, was wrong.
- **Notes:** Windows `time.time_ns()` has coarse resolution, so a timestamp is not a unique seed. These ids were
  never reproducible; the deterministic import remaps (`anno-import:…`) and path-hash asset ids are unchanged,
  and undo / merge pass the existing id. Full suite passes (87 tests).
- Review (fresh agent): no findings.

## 0.87.3 — 2026-11-18 — Sources: nested folders, clean removal, stale-view reset, connection pool
- **What:** user report "removing a source misbehaves" (two sources, ЛАЙТИНГ and Desktop: ЛАЙТИНГ → Desktop →
  × Desktop → ЛАЙТИНГ shows no previews; the source stays in the menu). Cause: ЛАЙТИНГ lies inside Desktop — not
  the Cyrillic name. Sources may now nest: a file belongs to the innermost source, the outer source shows it too,
  and removing either keeps the files the other still holds. Removing a source while it scanned / was watched left
  rows in All forever; no longer, and startup deletes old leftovers. Removal drops collection membership, asks for
  confirmation (× has no undo on touch), reports a failed DELETE, and resets a filter / cards / selection that
  pointed into it (also from another window). A hidden window gives up its event stream after 10 s (the browser
  allows 6 connections per host across windows) and catches up when shown. Paths compare regardless of Unicode
  form (macOS decomposed "Й").
- **Where:** library.py — `add_source`, `remove_source`, `_reassign`, `_source_scope`, `_nested*`, `_owner`,
  `scan_source` (`_src_gen`, `_scans_running`, nested roots skipped, locked flush), `_touch_one` / `on_moved`,
  `resume_watchers` (ownership fix-up + orphan cleanup), `sources()` (`own`), `normpath` (NFC), `disk_spelling`;
  server.py `/api/events` now an async generator (polls the queue; still ends on `Bus.CLOSE`); index.html remove
  confirm, `syncSourcesView`, `connectEvents` with visibilitychange; tests/test_sources.py (14 tests).
- **Notes:** invariant: a file row's `source_id` is the innermost source holding it — use `_source_scope` for "in
  source X", never a bare `source_id=`. Asset ids are path hashes (one row per file), which is why the inner scan's
  INSERT OR IGNORE used to leave rows on the outer source. Scan / watcher inserts are `INSERT … WHERE
  EXISTS(source)`; the flush checks the per-source generation under `self.lock`; a cancelled scan does not mark
  unreached files missing. Removal keeps thumbnail files on disk, board cards and annotations. Startup deletes
  orphan rows (the owner's library had 3 from a removed "Documents" source — found reading a copy of the DB).
  The old sync events generator held one worker thread per open window. Windows Cyrillic paths were fine
  everywhere checked. Not done: one shared stream for several visible windows; `_reassign` → `hidden()` reads
  `.obj` files under the DB lock; a vanished inner root is not re-checked. `test_board_missing` (intermittent
  UNIQUE id) and `test_splash_win` (path separator) fail on master already.
- Review (fresh agent, run by the implementing agent, three rounds): two medium nested-source edge cases (a
  running outer scan, the outer watcher applying its own rules) and a `flush()` race (check outside the lock) —
  fixed and confirmed; nothing new in round 3.

## 0.87.2 — 2026-11-18 — macOS: Dock icon back; Sight.app answers the Dock (real Cocoa loop)
- **What:** macOS: Sight.app keeps its Dock icon again and answers it. Clicking the icon brings the Sight window to
  the front, restores it if minimized, and opens it again if it was closed. Cmd+Tab to Sight focuses the window.
  Dock "Quit", Cmd+Q and the logout / shutdown quit stop the server cleanly and close the window. **Supersedes
  0.84.2's agent-app approach** (LSUIElement, no Dock icon), which the owner found inconvenient.
- **Where:** new app/macapp.py (`run`, `browser_pid_from_ps`, `find_browser_pid`); Sight.py `main()` mac branch
  (`_serve`, `_window_alive`, `_relaunch`, `_request_stop`, `_close_window`, `_on_server_exit`, `hb_lock`) and
  `_main_cleanup()` (`mac_agent_note()` removed); server.py (`/api/heartbeat?bye=1` → `app.state.window_bye`,
  `/api/events` ends on `Bus.CLOSE`); library.py `Bus.close()` / `CLOSE`; index.html `startHeartbeat` pagehide
  beacon; build_app_macos.sh (pyobjc-framework-Cocoa install + bundle check, LSUIElement removed,
  `NSAppleEventsUsageDescription`, `NSAppSleepDisabled` kept); tests/test_mac_launch.py.
- **Notes:** packaged macOS builds (not `--no-browser`) run NSApplication on the main thread and uvicorn on a
  background thread; without pyobjc it falls back to the old path and logs a line. AppKit exits the process
  itself, so main()'s `finally` never runs there: exit work lives in `_main_cleanup()` — never put cleanup only in
  `finally`. "Is there a window" = fresh heartbeat and no `bye` (Chromium on macOS keeps running windowless); the
  quit watchdog ignores `bye`, so F5 is safe. Dock reopen sends a "reopen" Apple Event only to Sight's own browser
  process (found by its `--user-data-dir` in `ps`), never the user's Chrome; may show a one-time Automation
  prompt; the ad-hoc re-sign resets that grant each build. Quit: `Bus.close()` ends every `/api/events` stream
  so uvicorn's 3 s graceful shutdown completes and `lib.close()` runs; a 10 s force quit (`threading.Timer` +
  `callAfter` — `callLater` does not fire while AppKit waits on the terminate reply) runs the same cleanup.
  Windows / Linux / dev unchanged (only a lock around the watchdog check). Known minor gaps: a second Dock click
  while a relaunched window is still loading can open a blank tab; with two Sight windows, closing one marks the
  app closed for up to 3 s. Not tested on a Mac.
- Review (fresh agent): 6 findings (quit hang at logout, force quit skipping cleanup, blank Chrome window on
  reopen after close, duplicate tabs without a Chromium browser, Automation consent text, watchdog / reopen race),
  fixed; second pass: 5 confirmed, 2 follow-ups (reopen still blank within 10 s of closing, Quit ending on the
  force timer without `lib.close()`) fixed; the same reviewer confirmed both, nothing new beyond the two gaps above.
