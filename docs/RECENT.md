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

## 0.35.1 — 2026-11-13 — Phone: the viewer's caption across the width, the pencil over it; no subtitle on home
- **What:** the full-screen viewer's caption (number, frame, words) spans the whole width at the
  foot and the pencil sits just over it, whatever the caption's height. The home screen's title
  has no "Reviews stay on this device" under it (the list's foot says it already).
- **Where:** `mobile/js/app.js` `viewer` (`.vfoot` holds the pencil and the caption; the picture
  boxes go in before it), `renderHome`; `mobile/index.html` (`.view .vfoot`, `.view .cap`).
  Test: `capPlace`.

## 0.35.0 — 2026-11-13 — Phone: selecting a note, controls hidden, mute on a tap
- **What:** (1) A tap on a note's card selects it (the accent frame) and puts the player on the
  first frame of its drawing; a tap on one of its pictures does the same, then opens it full
  screen; a marker step that lands on a note's frame selects it. The highlight no longer follows
  the playhead (that was the confusing part): notes on the frame shown get a lighter frame.
  (2) The header's second row has, at its left end, a button that hides every control; a round
  button in the top left brings them back; the gestures keep working. (3) A tap on the speaker
  mutes / gives full volume; a drag sets the volume from where it is. (4) Canvas: the fill row
  has only the six colours (no "the line's colour" entry; a fill follows the line until one is
  picked).
- **Where:** `mobile/js/app.js` — `paintCurrent` (`.cur` / `.here`), `selectNote`, the card's
  click, `openThread`, `jumpNote`; `setClean`, `.uib` / `.fab.showui` in `buildStage`, icons
  `hideui` / `showui`; the speaker's tap. `mobile/index.html` (`.note.here`, `.review.clean`).
  `app/static/review-draw.js` (`fillButton`). Tests: `select`, `clean`, `mute`, `fill`.
- **Notes:** the controls stay hidden while the review is open (`R.clean`, not kept). With the
  panel open the bar shows as usual. Review (fresh agent): see the next entry if it found anything.

## 0.34.0 — 2026-11-13 — Phone: loop / once button; the viewer's caption shows three lines of words
- **What:** (1) The transport has a button right of the sound: *once* (stops at the end, the
  default) or *loop*; a tap switches, kept on the device; the canvas' transport has it too.
  (2) The full-screen viewer's caption puts the note's / reply's words on their own line under the
  number and the frame, up to three lines; longer words scroll inside the caption (the picture is
  not covered).
- **Where:** `mobile/js/app.js` — `LOOP_KEY` / `loopOn` / `setLoop` / `paintLoop`, `T.loop` in
  `makeTransport`, `v.loop` in `buildStage`, icons `loop` / `once`; `viewer` (`.cap .tx`, its
  pointerdown / touchmove / wheel left to the words). `mobile/index.html` (`.tpi .loopb`, a
  ≤ 360 px layout without the "fps" word, `.view .cap` wraps, `span.tx`). Tests: `loop`,
  `capText` in `pwa_touch.cjs` / `test_pwa.py`.
- **Notes:** the words' scroll is the browser's own (touch-action pan-y on the scroll box; the
  viewer neither captures nor prevents those touches) — headless Chromium's synthetic touches do
  not scroll, so the test checks the box scrolls, is hit and is not prevented. One run of the
  PWA suite out of four ended with an error not seen again (not traced; the next three passed).

## 0.33.6 — 2026-11-13 — Canvas: the text box is a plain switch again
- **What:** the *Text* row's box button switches the box on / off as before; switched on, its
  colours show in the second row (no "no box" entry there — the user's call: off is the switch).
- **Where:** `app/static/review-draw.js` (the text row's button handler, `openSub`). Test:
  `textSub` (on → off hides the row; on again shows six colours).
- **Notes:** to change the box's colour later: tap it off and on again (the colours show), or pick
  it while the box is being switched on.

## 0.33.5 — 2026-11-13 — Canvas: filled shapes get their own fill colour
- **What:** on the drawing canvas (phone + HTML page) the Shapes row ends with *Fill colour*: a
  second row above it — the line's own colour (as before) or black, white, red, yellow, green,
  blue. A colour picked while an outlined shape is in hand switches to its filled kind (rectangle /
  rounded → filled rectangle, ellipse → filled ellipse). The button shows the fill.
- **Where:** `app/static/review-draw.js` — `pen.fill` (saved with the pen), `fillButton` /
  `fillIco` / `setFill`, `subRow` (the second row, now shared with the text's box / font rows),
  `begin` (fill colour / opacity), `recolour`. Tests: `fill` in `pwa_touch.cjs` / `test_pwa.py`
  (the Shapes row has 6 buttons now).
- **Notes:** a fill of its own colour is drawn at 0.6 opacity, the line's own at 0.3 (as before).
  The colour circle recolouring a selection changes a fill only when it was the line's colour (a
  fill picked on purpose stays). FORMAT.md is unchanged (`fill` was already its own field).

## 0.33.4 — 2026-11-13 — Canvas: a second row for the text's box colour and font
- **What:** on the drawing canvas (phone + HTML page) the *Text* row's box and font switches open
  a second row above it: the box's colour (black, white, red, yellow, green, blue; 0.33.6: no
  "no box" in it), and
  the five fonts each shown in itself. The box switch shows the box's colour. The outline stays a
  plain on / off switch (the user's choice: a colour row for it is not needed).
- **Where:** `app/static/review-draw.js` — `openSub` / `closeSub` (`.dfly.dsub`, closed with
  the row), `applyText(patch)` / `putText(d, patch)` (was one key), `TEXT0` + `bg` /
  `outlineColor`, `FONT_IDS`, `TEXT_COLORS`, `boxIco` / `outlineIco`, `styleOf` counts the
  colours. Tests: `textSub` in `pwa_touch.cjs` / `test_pwa.py`.
- **Notes:** a pick folds the second row, the text row stays. The box keeps its opacity (0.6 by
  default) whatever colour; the outline's colour is the pen's (`outlineColor`, black), not offered.

## 0.33.3 — 2026-11-13 — Sight: right-drag sizes a note's pictures
- **What:** in the review panel a right-drag up / down on the notes list makes the notes' square
  pictures bigger / smaller, the way a right-drag zooms the library grid's thumbnails; the size is
  kept with the settings. As many squares to a row as fit, stretched to fill it (default: four).
- **Where:** `app/static/annotate.js` — `bindThumbZoom` (on `.an-list`), `THUMB` / `noteThumb`,
  setting `sight.annotate.thumb` (via `writeJSON` → `host.putSetting`), CSS `.an-pics`
  (`repeat(auto-fill, minmax(min(var(--an-thumb), 100%), 1fr))`).
- **Notes:** same rule as the grid (0.9 px of size per px dragged, up = bigger), 40–320 px; the
  squares grow in steps of whole columns (the row is always filled). A right click without a drag
  does nothing there (no menu in the panel). Checked with Playwright on a dev server.

## 0.33.2 — 2026-11-13 — Sight: a note's pictures as small squares, as on the phone
- **What:** in Sight's review panel a note's pictures (its frame / picture with the drawings, the
  other frames it was drawn on, its screenshots) and a reply's (its drawing, its pictures) are one
  grid of equal squares, four to a row, each cut to fill — no more full-width pictures.
- **Where:** `app/static/annotate.js` — `picGrid`, `renderPanel` / `repliesHtml` use it,
  `previewBox` (overlay `xMidYMid slice`, the box's inline aspect overridden in the grid), CSS
  `.an-pics`.
- **Notes:** clicks are unchanged (they key on `.an-nprev[data-pt]`, `img[data-shot]`,
  `img[data-rshot]`, not on the container). The squares cut the picture's sides off: a drawing
  near the edge of a wide frame may sit outside its square (a click on the note shows them all on
  the picture).
  Checked on a dev server with Playwright (a picture note with screenshots and a reply).

## 0.33.1 — 2026-11-12 — Phone report: replies' drawings on the reply's own pictures
- **What:** the phone's PDF / HTML report no longer burns a reply's drawing onto the note's frame
  (nor its extra frames, nor a picture note's picture): each reply that drew gets its own pictures
  — every frame it drew on, the note's own frame too (a picture review: the picture) — with only
  its drawings, as the app shows them since 0.33.0.
- **Where:** `mobile/js/report.js` `gatherReport` (`noteOnly`, the reply loop). Test: the video
  HTML report has two pictures (the note's frame, the reply's) — `pwa_e2e.cjs` / `test_pwa.py`.
- **Notes:** the cover of a picture review still shows every drawing. Sight's own PDF / HTML
  report is unchanged: it has no reply pictures, so it still shows replies' drawings on the note's
  frame (dropping them there would lose them).

## 0.33.0 — 2026-11-12 — Phone: strip viewer, square note pictures, filters by swipe, text switches, home selection and moves between groups
- **What:** (1) Note viewer: a swipe sends the picture on the way it went, fading out, and the
  next follows it in like a strip (sideways = the note's pictures, up / down = notes). (2) Notes
  list: a swipe left / right steps the status filter. (3) A note's / reply's pictures are one grid
  of equal squares, cut to fill (Settings → *Pictures in a row*, 3–6, default 4). (4) Bug: a
  reply's drawing showed on the note's own picture — now only on the reply's. (5) Transport:
  "25 fps", the rate and the speaker a little apart from the timecode. (6) The turn-90° button is
  gone everywhere (phone header, the canvas on phone + HTML page, Sight's lightbox — Shift+R stays
  there); the header's view icons sit in the middle, *Fit* at the right end. (7) Canvas: the slot
  rows have the bars' see-through look; the *Text* slot has switches — bold, italic, underline,
  box, outline, alignment, font. (8) Home: a tap on a review picks it (tick), its picture opens it;
  the bar at the foot moves (*Move to…*: a group / a new group / out), hides or deletes the picked
  ones; any review — also one in a group — dropped onto another group's header or member moves
  there (picked ones go along); a group's row counts every state; *Picture…* gives a group one of
  its reviews' pictures / cached frames or a colour. (9) Bug: right after a swipe back from a
  review, the next tap on a review did not open it — home taps now act on pointerup.
- **Where:** `mobile/js/app.js` — `viewer` (`show(no, slide)`, `navigate`), `FILTERS` /
  `stepFilter` / `bindPanelPull`, `picBox` (overlay `cover` = slice), `shotThumbs(…, into)`,
  `noteCard` / `replyEntry` (`.pics`), `THUMBS` / `setThumbs`, `drawingsOn` (no reply rows for
  the note), `paintRate` (`<small>fps`), `viewOf` (rot 0), `buildStage` (`.fitb`); home:
  `homeSel` / `toggleSel` / `paintSelBar`, `moveInto` / `groupKeys` / `takeOut` / `moveMenu`,
  `groupThumbSheet`, `groupHead`, `rowGestures` (`tapAct`, `st.targets`), `deleteReviews`,
  `reviewNames`. `mobile/index.html` (`.pics`, `.selbar`, `.gcols` / `.gpics`, `.th.tint`, `.row.sel`,
  `.th.four` fixed: its pictures were zero-sized). `app/static/review-draw.js` (`TEXT_OPTS`,
  `textOpt` / `putText` / `paintTextFly` / `styleOf`, `.dfly.rd-panel`, turn button removed,
  `afterView`). `app/review.py` (stored turn dropped), `app/static/index.html` (`#turnBtn` gone).
  Tests: `pwa_touch.cjs` / `test_pwa.py` (`filterSwipe`, `pics`, `replyOffNote`, `viewerFade`
  strip, `textFly`, `reopen`, `between`, `groupSum`, `pick`, `groupPic`), `pwa_e2e.cjs` opens
  reviews by their picture.
- **Notes:** a picked review stays picked across renders until opened / moved / hidden / deleted
  (pruned when gone). Groups dissolve under two members at the next render, as before (`tidyGroups`).
  The group picture is stored in the group (localStorage, a ≤ 200 px data URL). The phone and the
  HTML page drop a quarter turn stored by an older version (mirror kept); a two-finger turn is
  still the view's own. A new text's outline is 6 % of its size. (The phone report: 0.33.1.)
- **Review (fresh agents):** viewer / notes / turn — no bugs; fixed: the report of an empty
  picture grid (hidden when nothing loads), the view icons jumping when *Fit* came and went, a
  test selector that could hit an attached picture. Canvas text — no bugs; fixed: a switch during
  a selection hold lost its change (stopAdj first), the field lost the focus to the row's buttons
  (keyboard bouncing; a resize folded the row), the row not repainted after undo, the field's
  preview of centred / right text, outline and box colour, Impact not in the font cycle, test
  pen state. Home — fixed: a review dragged while *not* picked took every picked one along; a
  touch that stopped a fling picked / opened a review (a scroll within 150 ms or the page moved:
  no tap); the click a pointerup-tap ends with could land on the selection bar it just brought up
  (*Hide* at once) — eaten once, document-wide (`ghostUntil`, armed only by a pointer tap, not a
  keyboard click); new groups / *Move to…* use the list's order, not the tap order; *Take out* of
  several kept their order; an empty *Move to…* sheet (a toast now); a review's own *Move to…*
  cleared an unrelated selection; the group-picture sheet decoded every cached 1600 px frame
  (≤ 12 small previews per review now, one at a time); a full localStorage lost group changes
  silently (toast); a failed delete skipped the re-render. Left: the update banner covers the
  selection bar while it shows; picked reviews inside a closed group still count.

## 0.32.2 — 2026-11-12 — Phone: the pencil right after a scrub opens at once, on the right frame
- **What:** after a scrub, the pencil (draw) used to come up late and sometimes show a stale frame
  until the clip was moved or the pencil tapped again. Now the canvas opens at once on the
  scrubbed frame's cached picture, and the player's own frame replaces it when its seek lands.
- **Where:** `mobile/js/app.js` — `openDrawVideo` (opens on `rv.frames` / the scrub cache, `early`
  → `S.settled()`), new `painted(v)` used by `frameNow` / `currentFrame`. Test: `penAfterScrub` in
  `pwa_touch.cjs`.
- **Notes:** the root causes: the canvas waited for the last seek (a fast scrub ends on a decode
  from the keyframe), then grabbed the player right after "seeked" — Safari fires it before the
  frame is painted, so the grab could be the old frame, and it was cached under the new frame's
  tag. A grab of a frame not cached yet now waits for a presented frame (rVFC, ≤ 150 ms). Only with
  no picture at all (nothing cached) does the canvas still wait for the player.
- **Review (fresh agent):** fixed — the new-note composer's pencil still grabbed the player
  mid-seek (`currentFrame` now waits for the seek, and grabs again if the player moved while it
  waited for the paint); `seekTo` moves the canvas before pumping the seek (a same-frame seek
  settled before the canvas knew the frame); the canvas' own pause on opening a playing clip no
  longer triggers a second grab (a flicker); the test now opens the canvas while a step's seek is
  on its way. Left: wrong pictures that older versions cached on a device stay until the review is
  reopened from a fresh file / deleted; without rVFC (iOS < 15.4) the paint wait is a 60 ms guess.

## 0.32.1 — 2026-11-12 — One floating bar for the player and the canvas, half see-through
- **What:** the phone player's header and transport now sit on the same floating bar as the
  drawing canvas' top bar and tool bar (inset 8 px, rounded, blurred, half see-through); the halo
  around the player's buttons and text is gone. The canvas' bars (phone and HTML page) are more
  see-through too.
- **Where:** `app/static/review-draw.js` (`.rd-panel` — the one style; `.draw .dtop` / `.dbar` only
  place it; `SightReviewDraw.css()` exported), `mobile/js/app.js` (`DRAW.css()` at start, `hdr` /
  `tp` get `rd-panel`, the pencil sits above the inset transport), `mobile/index.html` (`.hdr` /
  `.tp` insets, `--halo` and the shadows removed, `--rd-ov` lighter: .66 light / .6 dark; `--rd-pop` for the popups over the picture).
- **Notes:** change the look in `.rd-panel` only (the host sets `--rd-ov` / `--rd-fg` / `--rd-line`;
  the HTML page uses the fallbacks). The header and transport now take touches over their whole
  area (no taps through to the picture between buttons).
- **Review (fresh agent):** fixed — a pinch that started on a bar zoomed the whole page
  (`touch-action: none` on `.rd-panel`); on a bright frame in the dark theme the subtitle and the
  timeline track nearly vanished (they now take the bar's own colour; the bar is a little less
  see-through); the canvas' tool rows and size label followed the lighter bar (own `--rd-pop`);
  the bars sat under a landscape notch (safe-area insets, canvas bars too); the timecode lost room
  on 361–400 px phones (the narrow layout up to 400 px, ellipsis). Kept on purpose: the bars take
  touches over their whole area (a visible panel; taps between its buttons no longer reach the
  picture). Left: the pencil / viewer buttons still use the older `--ov` look.

## 0.32.0 — 2026-11-12 — Canvas tool rows and colour circle; the viewer walks the whole thread; replies editable
- **What:** (1) Drawing canvas (phone + HTML page): *Arrows and lines* and *Shapes* are one slot
  each; a tap takes the slot and shows its kinds in a row above the bar (arrow, open, double,
  dashed, line / rectangle, rounded, ellipse, filled rectangle, filled ellipse); a pick or a stroke
  folds the row. The freed slot is a colour circle at the bar's right end with the colours in its
  row; the palette under the tools is gone. (2) Phone: the note viewer's sideways swipe goes
  through the whole note — its frames, its pictures, then each reply's drawings and pictures
  (caption "↳ Bob · …" with the reply's words). (3) Phone: a reply's ⋯ — *Edit text*, *Edit the
  drawing* / *Draw on it*, *Add pictures…*, *Remove its pictures*, *Delete reply…*; "edited" shows.
- **Where:** `app/static/review-draw.js` (`ARROWS`, `SHAPES`, `SLOTS`, `slotOf`, `openFly` /
  `closeFly`, `.dtools` / `.dcol` / `.dfly`, `useColour`, `begin` kinds, pen `arrow` / `shape`);
  `mobile/js/app.js` (`threadItems`, `sameItem`, `loadItem`, `threadView`, `openThread`,
  `shotThumbs(ids, n, rid)`, viewer per-picture `view` / `text`; `replyMenu`,
  `editNoteDrawing(n, rid)`); `mobile/js/model.js` (`editReply`). Tests: `pwa_touch.cjs` (`fly`,
  `thread`, `replyEdit`), `pwa_unit.cjs` (edited reply merge), `pwa_e2e.cjs` / `page_e2e.cjs`
  (picking from a slot's row).
- **Notes:** the line is shape_kind "line" (review-core draws and hit-tests it; Sight has it).
  Folding the row on a pick is hidden-now / removed-next-tick on purpose (see ARCHITECTURE: the
  HTML page's click-away handler). A reply's `edited` is the merge key, so an edit wins over an
  older copy anywhere (Sight / the page / the app merge by it).
- **Review (fresh agents):** Tool rows — fixed: a row stayed where it was across a
  resize / rotation (off screen) — it folds on resize; a tool key, a hold or the top bar left a row
  up with a stale pick — any tool change and the top bar fold it; Esc with a row up cancelled the
  canvas — it folds the row first; on narrow screens the wrapped tools hugged the right edge (the
  colour is now pinned at the row's end); the tests counted a hidden row. Left by design: a tap on
  the picture that folds a row also draws (the user asked for drawing to fold it); a second tap on
  an open slot puts the tool down; a filled ellipse hit-tests as its box (review-core, as before). Thread viewer — fixed: Back did not
  follow the frame when the walk started on, or passed through, an attached picture (a picture
  now carries the frame looked at before, and opening from one counts any frame as a move);
  picture reviews: the card and the thread disagreed on the note's main picture, and up / down
  skipped notes with no drawing — the picture is now always the first item; a picture that does
  not decode is skipped; frames told apart by frame index everywhere (`noteFrameList`, the card). Reply editing — fixed: editing a reply's drawing re-stamped the
  reply, so an older copy of its words could beat a newer edit made elsewhere (no stamp now: the
  drawings merge on their own); `edited` / `deleted` always go past the reply's current stamp (a
  clock behind the author's lost the edit); the menu writes to the note as it is then (a merge
  meanwhile replaced the objects); an edit that would leave a reply empty offers to delete it
  instead; a note's drawing opens on its own frame again (a reply's on its first). Left: removed
  pictures stay in the device's picture store (freed with the review); a reply is one merge unit,
  so the words edited in Sight and pictures changed on the phone at the same time — the later
  edit keeps its copy of both (FORMAT.md).

## 0.31.0 — 2026-11-12 — Phone: speed and sound in the transport; the canvas settles like the player
- **What:** (1) The transport row is ‹ ◀ **fps** timecode · frame **speaker** ▶ ›. The frame rate
  number is the speed: drag up / down = faster / slower (shown as the rate it plays at, accent
  coloured when not the clip's own), tap = the nearest common rate (24, 25, 30, 12…), hold = the
  clip's own. The speaker: drag up / down = volume (a thin level bar at the screen's left edge,
  kept per device), tap = full; grey when the clip has no sound. Also on the canvas' transport.
  No volume gesture on the picture itself (the user's choice: the swipes there stay the panel /
  the list). (2) Drawing canvas (phone + HTML page): a pinch / pan let go smaller than the screen
  goes back to fit with the turn to the nearest quarter, nearly at fit and straight snaps to fit
  (eased), the wheel stops at fit — as the player does.
- **Where:** `mobile/js/app.js` (`vdrag`, `setRate` / `snapRate` / `paintRate`, `applyVol` /
  `setVol` / `paintSnd` / `showVolBar`, `setAudio`, transport row, video set-up, `bindFile`);
  `mobile/js/mp4.js` (`fpsFromMoov` → `audio`); `mobile/index.html` (`.tpi .fps` / `.snd` /
  `.tc`, `.volbar`); `app/static/review-draw.js` (`settleView`, `unease`, wheel). Tests:
  `pwa_unit.cjs` (audio flag), `pwa_touch.cjs` (`speed`, `sound`, `canvasSettle`).
- **Notes:** whether a clip has sound: MP4 / MOV from the container (`soun` track), Safari
  `audioTracks`, Firefox `mozHasAudio` — final and stored (`meta.audio`); Chrome has no API before
  decoding, so after a quarter second of unmuted play with nothing decoded it guesses "none"
  (not stored, taken back as soon as sound decodes; muted play never guesses). iOS ignores a
  page's volume: the drag there only mutes / unmutes. Speed is kept for the review while open
  (`R.rate`), not stored.
- **Review (fresh agents):** canvas settle — fixed: a settle across 0° / 360° spun the picture
  almost a full turn (fit keeps [0, 360)); the ease stayed on for the next gesture (lag, taps
  landing off); the box size jumped while the transform eased; a pinch cut short by the pen or
  a text edit never settled; the wheel refit while typing. Speed / sound — fixed: a sideways slide on a
  control counted as a tap (snapping the speed / full volume); a WebM's frame rate measured while
  playing faster than 1× could be stored wrong (frames dropped) — measured at 1× only; a guessed
  "no sound" did not repaint the icon; after picking another file the old "no sound" stayed (the
  sound is learnt again on a rebind); the timecode was clipped on 320 px phones (narrow layout) and
  jittered with a bold rate; a long press could select the number / open a menu; labels rewritten
  every frame; a second finger on a control. Left: a tap at 1× on a clip whose measured rate is not
  a common one snaps it (e.g. 29.5 → 29.97); the MP4 sound flag counts any sound track, even an
  empty one.

## 0.30.0 — 2026-11-12 — Phone: review groups, tool opacity on the hold, auto full screen
- **What:** (1) Home: a review held, dragged onto the middle of another one (it lights up) and let
  go makes a group of the two (named by the names' common start, else "Group"); more go onto the
  group's header. The header opens / closes on a tap, moves the whole group on hold + drag, and
  its menu has *Open / Close*, *Rename…*, *Ungroup*; a member's menu has *Take out of the group*.
  (2) Drawing canvas (phone + HTML page): press and hold with a tool, drag sideways = that tool's
  opacity (up / down is still the size); the preview reads "6 px · 70 %"; a hold on the tool's
  button resets both. (3) Settings → *Full screen*: Auto (default) / Off — Auto goes full screen
  at the first tap in a browser tab that can, and again after the user leaves it.
- **Where:** `mobile/js/app.js` — `loadGroups` / `saveGroups` / `tidyGroups` / `groupName` /
  `groupOnto` / `ungroupOne` / `groupMenu` / `setGroup` / `groupRow` / `groupHead`, `reviewRow` split
  into content + `rowGestures(row, it, o)` (drop target `.drop`, group `.folded`), `renderHome`
  entries (reviews + `"g:<id>"`), `reviewMenu`; full screen `fsCan` / `enterFS` / `exitFS` /
  `setFsAuto` / `fsTap`, `settings()`; `mobile/index.html` (`.row.group`, `.gm`, `.th.four`,
  `.chev`, `.drop`, `.seg.fs`); `app/static/review-draw.js` (`OPAC0` / `OPAC`, `adjMove` axis for
  tools, `showSize` label, new items' opacity, pen `opac`). Tests: `pwa_touch.cjs` (`opac`,
  `brushReset`, `dropLit` / `group`, `fullscreen`).
- **Notes:** groups and order are per device (localStorage), like the order; a review is in one
  group at most; a group needs two existing reviews (`tidyGroups` dissolves the rest each
  render). Only a review on its own can be dropped (no nesting; a member leaves by its menu). The
  size hold now waits for 10 px to pick its axis (as the selection hold did). iPhone Safari has no
  page full screen and iPad Safari limits typing in it, so iOS tabs do not try (the setting says
  why); the installed app is full screen already; a tap that opens the file picker
  (`label`, `[data-nofs]`) or a text field never asks.
- **Review (fresh agents):** opacity hold — no bugs (a redundant save removed; the text field
  while typing does not show the text opacity, left). Groups — fixed: the saved order
  missed entries never moved by hand, so a new group (and a review taken out / a dissolved group's
  last one) landed after them, not in the target's place — the home list now saves its whole
  order on each render; a group with every member hidden lost its slot on a reorder (`saveOrder`
  keeps `g:` keys); a member reorder moved hidden members to the end; *Ungroup* used a stale member
  order; names lost a trailing "v" / stopped mid-word (`groupName`); a sideways mouse drag on a
  header toggled it; "1 reviews". Left: rows of very different heights (an open group) shift by
  the held row's height, so near an open group the drop light / slide can feel uneven.
  Full screen — fixed: the clip button (opens the picker) asked for full screen; a mouse asked on
  pointerdown (the page resized mid-click); any pointerup asked, also after a scrub, a drag, a hold
  or with more fingers down (now only a plain one-finger tap); text fields asked (iPad limits
  typing in full screen: iOS is left out altogether); Android's back leaves full screen first and
  the next tap went straight back in, so every back press was eaten (now it stays off until the
  next screen, `fsArm`).
