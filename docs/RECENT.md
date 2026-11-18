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

## 0.79.1 — 2026-11-18 — Drawing canvas: tools over the transport, tools row scrolls by drag
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

## 0.79.0 — 2026-11-18 — Phone: the sequence bar under the timeline, title swipe between clips
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

## 0.69.0 — 2026-11-17 — Compare annotating: splits by Alt / finger, screenshot of the whole comparison
- **What:** while annotating in the compare's Swipe, `Alt`+drag moves the nearest split (as Alt scrubs a video in
  the viewer) and a finger / stylus landing within 24 px of a split moves it — no stroke for that press, no need to
  leave annotating. The annotator's screenshot (`S`, area `Shift+S`) is now the comparison as shown — every visible
  layer in its split region or tile, Difference, dimmed clips, split lines and names — with the drawings on top
  (owner: "that is the point of commenting a comparison"); it was the selected layer alone.
- **Where:** compare.js `wantsPress`, `onDown` (`altPan`; drags keep their `pid`), `captureView`, `C.viewWrap`;
  annotate.js `onDown` → `host.passThrough`, `composeView` → `host.captureView` (drawings clipped to the surface),
  `capture()` area offset; index.html `cmpAnnot` hooks, compare `annotating`.
- **Notes:** `passThrough` is asked after the edit / pen-eraser handling and not while an area is being picked or
  with Alt on the select tool (its duplicate-drag). Outside annotating Alt+left still pans in Swipe. A video layer
  caught mid-seek (`readyState` < 2) is drawn as nothing (black) in the screenshot — left as is (rare). Note
  previews / report pictures still show the annotated layer's own frame (the screenshot is what shows the comparison).
- Review (fresh agent): a resting palm's split drag following the pen (no pointer id on the drag), Alt duplicate-
  drag lost with the select tool, area capture / text edit / pen eraser presses taken near a split, drawings not
  clipped to their tile, label size; fixed (black hole for a seeking video left).

## 0.68.0 — 2026-11-17 — Annotating in the version compare; notes remember the comparison
- **What:** compare (K) has *✎ Annotate* / `A`: the notes panel and drawing tools on the **selected layer**
  (owner's choice) — notes / drawings go to that file at its own frame. A note made there stores the
  comparison (files, order, reference, selected layer, layout, blend, split direction, clip offsets); its card in
  the viewer gets *⧉ Compare · N files* (opens it again on the note's frame, annotating on) and `K` on that file
  opens the newest stored comparison instead of the file's versions.
- **Where:** compare.js — `host.onOpen / onView / onPlaced / onClose / onAnnotButton`, `reportView`, `session()`,
  `pause()`, `seekLayer()`, `ready()`, session look (`C.pBase` / `C.userSet` / `prefsToSave`), ResizeObserver;
  annotate.js — `vidPause` / `vidSeek` (host clock), `host.noteExtra`, note card button (`data-cmp`,
  `host.openCompareSession`), API `reload()`; index.html — `cmpAnnot` (second annotator), `cmpBind` /
  `cmpToggleAnnot`, `openCompareSession`, `latestCompareSession`, `compareFromContext`, compare key routing.
  FORMAT.md — note `compare` (0.68+, Sight only, ignored and kept by other readers). MANUAL, ARCHITECTURE.
- **Notes:** the "session" is stored in the note (owner's choice) — no server table. The compare runs every clip
  on one clock, so the annotator never drives its element there: pause / seek go through the host (`cmp.pause`
  stops on the frame the selected clip shows; `seekLayer` is not snapped to compare's fps, which can differ from
  the clip's). Binding is lazy (a file's notes are fetched once annotating is on). A session opened from a note
  shows its look without overwriting the saved preferences (only what is changed there is saved). Known /
  deliberately left: while annotating the tools own left drag / touch and keys `[ ] R V L Shift+, .` (leave
  annotating to move splits by touch or use those compare keys); the screenshot tool captures the selected layer,
  not the composite; with the playhead before the selected clip's start a new note takes the clip's frame 0;
  the notes panel open / closed setting is shared with the viewer's.
- Review (fresh agent): 12 findings — report export fighting the shared clock, annotating a hidden layer, two fps
  grids, landing before the fps was known, pause moving the frame after the stroke's ctx, session look leaking
  into saved prefs, one-file sessions, heavy lightbox reload, missing host hooks (versions row, review badges),
  no re-place on panel toggle, key / touch conflicts, wasted fetches; fixed or documented as above. Re-review
  rounds: pause landing a frame late / dimming at a clip's first frame, a step past the end dimming the clip, a
  flash after closing during the fps wait, `reload()` keeping undo and racing its own save — fixed; confirmed by
  the same reviewer.
