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

## 0.75.0 — 2026-11-18 — Reference images on the frame (crop, frame, shadow); library beside the lightbox / player (Tab)
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

## 0.67.0 — 2026-11-17 — Sequence: every clip's markers, Shift+, / . across clips, up-front conversion (stage 3)
- **What:** the sequence bar shows tick marks for every clip's drawings / notes (taller = a note's);
  `Shift+,` / `Shift+.` continue into the previous / next clips when the current one has no further marker. A
  clip the browser cannot play is found when the sequence opens and converted ahead of its turn.
- **Where:** index.html — `seqLoadMarks`, `seqMarksFromAnnot`, `seqRepaintSoon`, `seqMarker`,
  `seqProbePlayable` / `seqProbe` / `seqConvertAhead`, marks in `paintSeqBar`, `.seq-mk` CSS; annotate.js —
  `renderMarks` → `host.marksChanged`, `jumpMarker` → `host.seqMarker`, API `marks()` / `loading()`.
- **Notes:** the clip on screen reports annotate.js's exact marks; the others are an estimate from their rows
  (drawings' `ctx.t`, a note mark when `data.note` links it; notes' caption frames) fetched once at open. A
  clip left keeps the marks annotate last reported — a re-read raced the debounced save and dropped new marks.
  `seqMarker` stays put while a jump is pending or the clip's rows are loading (else a fast double press skips a
  clip). Conversion: probes load metadata only; `POST /api/video/transcode` goes out only for clips without a
  picture, **one at a time and only for the next two clips** — the server encodes one job at a time, so queuing
  all of them held back the clip the user jumps to and kept ffmpeg busy after closing. Deliberately not done:
  extending the server RAM cache (`SlidingVideoCache`, one file) to prefetch the next clip — the hidden preload
  `<video>` already pulls the next clip's head; worth it only for slow network drives.
- Review (fresh agent): conversions queued for every clip at once, the left clip's re-read racing its save, a
  just-opened clip reporting no marks (Shift+. skipping it), markers past a clip's end, per-clip fetch / repaint
  cost; fixed (landing at t + 1 ms instead of annotate's quarter-frame kept: correct for stored frame starts).
  Re-review: a clip left while its rows were loading kept no marks, a jump into a clip whose conversion failed
  blocked frame / marker keys (pendT never cleared), probes started from clip 0 — fixed; confirmed by the same
  reviewer.

## 0.66.0 — 2026-11-17 — Touch selection by long-press (Sequence stage 2)
- **What:** on a touch screen (finger or stylus) holding a grid tile ~0.5 s starts touch selection mode with
  just that tile; then a tap toggles a tile (appended, so tap order = sequence order), a double tap opens
  nothing, a tap on empty space does nothing (owner's choice: a missed tile must not drop the selection). A
  bottom bar shows "N selected", *▶▶ Play in sequence* (2+ videos) and ✕; ✕ / Esc end the mode.
- **Where:** index.html — `syncTouchSel`, `startLongPress` / `cancelLongPress`, `lastGridPtr` / `fingerish`
  (after `paintSelection`), grid pointerdown / click / dblclick / pointermove / pointercancel, `onPtrUp`,
  card `draggable`, `selectOnly` (drops `state.touchSelect`), `applyViewDom`, `#touchSelBar` + CSS.
- **Notes:** the mode is the explicit flag `state.touchSelect`, set **after** `selectOnly` (which drops it);
  it also drops when the selection becomes empty (`syncTouchSel` from `paintSelection`). `selectSet` paths
  (Ctrl+A, marquee, find in folder) keep it, as specced. A click's input is decided by the same gesture's
  pointerdown (`lastGridPtr`), not the click's own `pointerType` (older Safari clicks are no PointerEvents).
  The long-press sets `skipClick` when it fires, so the release click does not run `clickSelect`. Cards are
  not `draggable` for touch (a held finger would start an HTML5 drag whose dragstart replaces the selection);
  a pen keeps drag-to-board (drag starts only on movement, a still pen gets the long-press). Behaviour
  change outside the mode too: `pointercancel` (a touch scroll) is now an abort in `onPtrUp` — it no longer
  clears the selection as a click on empty space. The bar hides with the grid (full-screen board) and the
  narrow-screen inspector stops above it. `navigator.vibrate` was dropped (no user activation in a timer).
- Review (fresh agent): 8 findings — scroll from empty space wiping the selection (marquee + pointercancel),
  a missed tap ending the mode, click type taken from the click, pen left out, bar over the board, bar
  covering the inspector, vibrate; fixed (the mode surviving `selectSet` kept as specced). The re-review
  caught that the first fix also blocked pen drag-to-board — restored; confirmed by the same reviewer.

## 0.65.0 — 2026-11-17 — Play in sequence (stage 1 of docs/PLAN-viewer.md "clips in sequence")
- **What:** 2+ selected videos play back to back in the lightbox (Space over one of the selected videos,
  top-bar *▶▶ Sequence*, right-click menu, palette), in selection (click) order, cut to cut without a black
  frame. A sequence bar above the clip's timeline: a segment per clip (alternating accent shades, name),
  playhead, tap / drag across all clips, ⏮ / ⏭ / ⟲ buttons. Keys: ← / → clip, Home first clip, Shift+L loop,
  `,` / `.` cross cuts; ↑ / ↓ and arrows with modifiers do nothing (never step out to grid neighbours). Each
  clip keeps its own notes / drawings (shown through the normal `showInLight` → `annot.setAsset`).
- **Where:** index.html — `seqCandidates` … `bindSeqBar` (before `toggleLight`), `.seqbar` markup + CSS,
  `attachViewer` (`opts.adopt`, `ended` listener, `light.vctl`, `seqOnReady`), `showInLight(a, opts)`,
  `fillStage(…, opts)`, `startVideoCache(…, keep)`, `closeLight`, Space / sequence keys, `paintSelection`
  (`#seqBtn`), context menu, palette; annotate.js `stepFrame` → `host.seqEdge`. ARCHITECTURE "Sequence".
- **Notes:** seamless = the next clip is preloaded in a hidden muted `<video class="seq-buf">` and adopted
  (moved into the stage in the same task, src kept). Measured in headless Chromium: the first frame of the
  new clip is on screen at once but held ~70 ms before playback moves on (play() start latency); a muted
  element starts ~30-60 ms sooner, so the adopted clip starts muted and unmutes on its first new frame
  (`_seqWantMuted` keeps the wanted state across quick adopts). Tried and dropped: a play+pause warm-up and
  creeping the buffer at rate 1/16 before the cut — neither shortened the start. `ended` cuts only after real
  playback (`_seqPlayedAt` from `timeupdate` / `playing`), never on a scrub / seek to the end. Not in this
  stage (PLAN-viewer.md): touch multi-select by long-press + bottom bar, markers of all clips on the sequence
  bar and Shift+, / . across clips, server RAM-cache prefetch of the next clip, probing / converting clips up
  front. Known: `#seqBtn` is only refreshed with the selection (may stay shown after a filter change —
  clicking then just flashes); segment widths settle as clip durations load (assets often have none stored).
  The title shows "Clip i/n · name" (the planned frame number is not in the title).
- Review (fresh agent): 12 findings — key repeat running through clips before metadata, modifier+arrows
  leaving the sequence, `ended` on a scrub to the end, pending landing lost on a converted clip / applied to
  the wrong clip, O(n²) selection check, Space over a selected non-video, prev / next not reusing the
  preloaded clip, last-frame landing by the wrong fps, adopted element's autoplay; all fixed except the stale
  button and segment widths shifting during a drag (accepted). The fixes' re-review found two more (clips
  staying muted after quick adopts, `ended` ignored after a very short play) — fixed; confirmed by the same reviewer.

## 0.64.2 — 2026-11-17 — macOS: dictation no longer kills Chrome
- **What:** on a Mac, pressing the dictation mic a second time (after allowing the microphone) made the whole
  browser quit ("Google Chrome quit unexpectedly", user report on 0.62.1).
- **Where:** `Sight.py` — new `mac_launch_prefix(browser)` (the Sight window's browser is started as
  `/usr/bin/open -n -a <Browser>.app --args …` instead of exec'ing the binary), `close_browser(proc, user_data_dir)`
  (macOS: `pkill -f --user-data-dir=<home>/browser`, since `proc` is the short-lived `open`); `tests/test_mac_launch.py`.
- **Notes:** root cause (by analysis, not reproduced — no Mac here): a browser exec'd by Sight is its child, and macOS
  privacy protection (TCC) makes the parent — Sight.app or the Python behind Sight.command — the "responsible" app
  for the microphone. Neither declares `NSMicrophoneUsageDescription`, so the first real capture gets the browser
  process killed by the system. Through `open`, launchd starts the browser as its own app, which asks for the
  microphone under its own name. Rejected: adding `NSMicrophoneUsageDescription` to Sight.app's Info.plist — it covers
  only the packaged build, not Sight.command (Python / Terminal), and makes Sight, not the browser, the app listed in
  Privacy settings. `-n` keeps a separate instance next to the user's own Chrome (the separate `--user-data-dir`
  needs its own process anyway). Verify on a Mac: dictation twice in a row, window position / size restore, quitting
  Sight when its window is closed, and a failed start closing the window.
- Review (fresh agent): the `pkill -f` pattern was a raw regex (odd characters, `.../browser` also matching
  `.../browser2`) and could run before the browser started — now ERE-escaped, anchored at the path's end, run twice
  1 s apart; confirmed by the same reviewer.

## 0.64.1 — 2026-11-17 — Instant native launch splash (Windows)
- **What:** the launch splash (the Sight logo) shows at once and closes when the page is ready. It was a PowerShell
  window started only after 1 s (PowerShell costs ~0.7 s of CPU to start), so it appeared ~1.7 s in or never.
- **Where:** new `app/splash_win.py` (stdlib ctypes: layered, topmost, click-through, no-taskbar window, GDI+ draws
  `app/splash.png` into a premultiplied DIB, DPI-aware, centred on the monitor under the cursor); `app/splash.png`
  (512 px, rendered from `favicon.svg`); `Sight.py` (`Splash`, `--splash` handled at the very top for the frozen exe,
  started first thing in `main()` before `bootstrap()`); `build_exe.bat` (ships `splash.png`); `tests/test_splash_win.py`.
  Removed: `app/splash_screen.ps1`, `LazySplash`, `start_splash` (no PowerShell fallback).
- **Notes:** out of process on purpose: a bad window procedure can only kill the splash, never Sight. Source runs use
  `pythonw -I -S app/splash_win.py IMAGE EVENT 45`; the frozen build `Sight.exe --splash ...`. The splash waits on a
  named manual-reset event `Local\SightSplash-<pid>`; the launcher creates and holds the event before starting it. Its
  name goes into env `SIGHT_SPLASH` so the `bootstrap()` re-exec into the venv reuses the same splash (exactly one);
  `Splash.forget_env()` pops it right after `bootstrap()` returns and in main()'s finally, so the browser / workers /
  a nested Sight never inherit it. Close points unchanged (ready ping, `_open()` finally, `main()` finally); 45 s cap
  (a hard-killed Sight leaves it up to 45 s — accepted). Keep `splash_win.py` stdlib-only and import-light (only `sys`
  at module level). **Untested on Windows** (Linux container) — checklist in PLAN.md "Left to check on Windows" item 2.
- Review (fresh agent, static): env var leaking to children (medium), import cost, close racing the splash's own
  event creation, 1 px scaling fringe — all fixed and confirmed by the same reviewer.
