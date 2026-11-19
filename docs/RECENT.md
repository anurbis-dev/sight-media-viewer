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

## 0.87.1 — 2026-11-18 — Notes no longer lost when switching clips; durable annotation write queue
- **What:** user report (macOS desktop): comments written on a sequence's clips were gone after switching clips.
  Root cause: `setAsset()` / `unmount()` called the async `flush()` and then cleared `S.items` synchronously; after
  flush's first `await` the dirty rows were gone, so a debounced (300 ms) update — e.g. a reply / note edit
  committed by the blur when clicking towards the next clip — was silently dropped (reproduced; old code kept
  "original"). Failed writes were only `console.warn`ed. Now every row write goes through one durable queue: kept in
  localStorage until the server has it, retried, a red "unsaved annotation changes — retrying" badge (click / tap =
  retry) while it fails, sent with keepalive on close and at the next start.
- **Where:** annotate.js: module-level `OB` (`obPut` / `obDel` / `obDrain` / `obFlush` / `obOverlay` / `obForget` /
  `obAdopt` / `obBeacon` / `obPaint`), `serverCreate` / `stage` / `flush` / `serverDelete` / `settle`, `load()`
  overlay, `obForget` before the import / reload loads, CSS `.an-outbox`. ARCHITECTURE ("Saving"), MANUAL.
- **Notes:** invariants are in ARCHITECTURE ("Saving (the write queue)"): never write rows outside the queue; leave an
  asset only via `settle()` while `S.asset` is the old one. Landed writes stay 30 s in `OB.recent` and are laid over
  a GET row only if that row is older than the request (`updated_at < sentAt`, same-machine clock — a LAN client
  with clock skew would weaken this; comparing against the server-returned `updated_at` would be the fix). Storage
  key per window; adoption skips entries older than this window's landed write (`at` vs `landedAt`). Not done:
  queued rows carry no library identity (another SIGHT_HOME on the same port would get them as orphan rows); the
  HTML review page's localStorage quota problem (separate track). The browser logins reset the user also reported
  cannot come from Sight (own `--user-data-dir`, no access to the main profile) — not investigated further.
- Review (fresh agent, run by the implementing agent): round 1 — 10 findings (load/GET race, close dropping debounced
  edits and open editors, keepalive sending one request, no timeout, one bad row blocking the queue, silent refusals,
  windows overwriting each other's stored queue, stale storage after a failed setItem, unvalidated restore, live
  references in queued bodies). Round 2 — the recent-overlay hid server-side changes (import) → `sentAt` check +
  `obForget`. Round 3 — refused create showing as a phantom; periodic adoption overwriting a newer write → `at` /
  `landedAt`, frozen-window self-drop (`obHandedOff` before any write / send; handed rows' next write is an upsert).
  All fixed; the same reviewer confirmed every fix (5 rounds). Known limitation it accepted: after a frozen window's
  queue is adopted by another window, the two windows' writes of the same row may land in either order.

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
