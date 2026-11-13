# Archived changes — 2026-11

Older entries moved out of RECENT.md; newest first. Append-only history.

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
  panel open the bar shows as usual. Review (fresh agent): fixes in 0.35.2.

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

## 0.29.0 — 2026-11-12 — Phone: a reply on a video note is written over the player, on any frame
- **What:** *Reply* on a video note (and the viewer's pencil on one) closes the Notes Panel and
  opens the reply in the bar over the player: the player goes to the note's first frame, the
  note's frames are on the timeline and as chips in the bar (tap = go there), its drawings show
  on the picture, and the pencil draws on whatever frame is on screen — several frames, e.g. one
  the note forgot. Sending (or ×) leaves the player on the frame reached and the note lit in the
  list. A reply's card shows each frame it drew on; its viewer swipes sideways over them. Picture
  notes keep the inline reply under the card.
- **Where:** `mobile/js/app.js` — `startReply`, `replyBar`, `closeReply`, `sendReply`,
  `threadFrames`, `replyFrameTimes`, `composing()` / `composeKey()`, `R.replyTo` / `R.curNote`,
  `paintCurrent`, `markerList`, `stageDrawings`, `drawingsOn` (reply filtered by frame),
  `asyncFrameAt(n, t, rid)`, `noteView` (reply frames sideways, pencil); `mobile/index.html`
  (`.newbar .frs`); `mobile/js/report.js` (frames only a reply drew on go with that reply);
  `app/static/annotate.js` (Sight's export: live replies' drawings count for a note's extra
  frames); `app/review.py` (the HTML page's reply thumbnail: only what it drew on that frame);
  `docs/FORMAT.md` (reply drawings may sit on other frames). Tests: `pwa_touch.cjs` reply steps,
  `pwa_e2e.cjs` reply through the bar.
- **Notes:** the reply draft is keyed by the note id (as the inline one), so an inline draft and
  the bar share it. Starting a reply closes the new-note bar but keeps its draft. A note deleted
  or merged away while replied to drops the bar (`paintNewBar`). The drawing canvas of a reply is
  clean (only the reply's own drawings), as before. The HTML page does not list a reply's extra
  frames (only Sight's export does, via the note's extra frames); its reply thumbnail just no
  longer piles other frames' drawings onto the note's frame.
- **Review (fresh agent):** fixed — the bar's "note still there" test read `deleted` (a reply
  field) instead of the row's `deleted_at`, so a note deleted / merged away kept the bar and took
  the reply; the player's pencil while replying drew into a hidden new-note draft (it now opens
  the reply's pencil); a reply drawing on the note's own frame got `{t, hold: 0}` instead of the
  note's ctx (its hold lost); the "typing, leave it alone" guard kept a stale composer; Reply on the
  note being replied to sent the player back to the first frame; frames are now told apart by
  frame index (`frameKey`), and the phone report shows a frame a reply added once. Left: switching
  to another note's reply keeps the first one's draft without asking (it comes back on its Reply).

## 0.28.1 — 2026-11-12 — Phone viewer: pictures cross-fade instead of sliding
- **What:** in the full-screen note viewer a swipe (up / down = another note, sideways = the
  note's other frame) no longer slides the picture off and the next one in from the edge (which
  blinked: the new image was not loaded yet). The swiped picture settles back, the next one is
  decoded, then fades in on top while the old one fades out in the same place.
- **Where:** `mobile/js/app.js` `viewer()` (`show(no, fade)`, `navigate`, `FADE_MS` / `FADE_WAIT`);
  test `viewerFade` in `tests/pwa_touch.cjs` / `tests/test_pwa.py`.
- **Notes:** `show` is async but with no `fade` it never awaits, so the first `show(o)` is still
  synchronous. `o` and `box` switch together only after the decode (capped at 600 ms; a slower
  image fades in blank and pops in). The old box holds full opacity until 45 % of the fade, so the
  pair never lets the background show through mid-way. Old boxes are removed by `onfinish` with a
  timeout fallback. `busyNav` lasts until the fade ends; a swipe while busy just snaps back.
  Fresh-agent review found no bugs; it flagged the mid-fade dimming of a plain both-ways fade and
  the old picture sitting off-centre while the next loads; both fixed as above.

## 0.28.0 — 2026-11-12 — Phone: play inside the drawing canvas, clean timeline for a new note, note frames in the viewer
- **What:** (phone app; review-draw.js gains host hooks, no change on the HTML page)
  On a video's drawing canvas with no tool in hand, a tap plays / pauses: the clip plays in the
  picture's place, each frame's drawings showing as it passes; a pause (or taking up a tool)
  stops on the frame reached, ready to draw. A new note (being written or drawn) has a clean
  timeline: only its own frames, no ticks / dots of earlier notes (red / yellow / green ticks are
  notes by state, grey dots are other frames drawn on). Opening the Notes Panel pauses a playing
  video where it is. The full-screen note viewer: a swipe left / right walks the note's frames
  (caption "0:01.05 · f 30 · 2 / 3"), no swipe closes it any more — only Back (and Esc / system
  back); back in the review the player stands on the frame left on. Home: the big open buttons
  show only while there is no review; after that the bar's small icons, no scroll switching.
  Play after a scrub no longer restarts a seek that is already on its way to that frame. A scrub
  on the canvas no longer dims the picture (it read as a haze over the video): the cached frame
  shows as it is; only a frame with no cached picture at all keeps the old one, dimmed.
- **Where:** `mobile/js/app.js` (`openDrawVideo`: `liveStart` / `liveStop` / `onPause`, `onTap`,
  `onTool`; `frameNow` / `currentFrame` use `snapT`; `togglePlay`; `markerList`; `paintNewBar`
  repaints markers; `setPanel`; `viewer` `navigate(dir, axis)` + `o.side` / `o.label`;
  `noteFrameList`, `noteView(n, f, rid, from)`, `showNote(n, at)`; `renderHome` open buttons),
  `app/static/review-draw.js` (`onTap`, `onTool`, `handle.live`, `.dlive` / `.dbox.live`, empty
  frames not stored), `mobile/index.html` (`.view .cap .fr`), tests `pwa_touch.cjs` /
  `test_pwa.py` (play / pause / play-to-end in the canvas, clean markers, panel pause, viewer
  sideways), `pwa_e2e.cjs` (open buttons by `label.pick-media` / `label.pick-file`).
- **Notes:** *Why play lags after a scrub although the cache bar is green:* the cache is ≤ 640 px
  JPEGs for the screen; the `<video>` decoder still has to seek (back to the keyframe, decode up
  to the frame; phone clips have a keyframe every 1–2 s) and buffer before it plays. Nothing makes
  that instant; what was fixed is the extra seek — `togglePlay` re-set `currentTime` to the frame
  the in-flight seek was already going to, which restarts it. While playing in the canvas, the
  player (hidden under it) is drawn into a ≤ 1280 px canvas per presented frame (rVFC, rAF after
  250 ms without one — an off-screen player may get none); keys are a quarter into the frame
  (`snapT(mediaTime + fd/4)`: millisecond WebM stamps sit a hair below a frame's start); the
  live layer shows from the first frame presented after play (not the pre-seek one); `capSeq` is
  bumped so the tap's own settle grab cannot swap the picture mid-play. `frameNow` refuses to grab
  while playing (it would cache under the wrong tag). An ended clip reads `currentTime = duration`,
  one past the last frame: `frameNow` / `currentFrame` tag with `snapT` (it clamps) — before, the
  canvas stayed dimmed on a stand-in picture after playing to the end. Space is *not* bound in
  the canvas (with a tool in hand a playing clip would abort strokes every frame). The viewer's
  pencil still draws a reply on the note's own frame (replies are one frame), whatever side frame
  is shown.
- **Review (fresh agent):** play-to-end left the canvas dimmed under a past-the-end key (fixed,
  test added); live keys from raw `mediaTime` drew frame k's drawings over k+1 on WebM (quarter
  offset); a pending settle grab could re-key the canvas mid-play (`capSeq`); the live layer
  flashed the pre-seek frame (now from the first presented frame); rVFC may not fire off screen
  (rAF fallback); a second viewer swipe within the 170 ms slide acted on the old picture
  (`busyNav` held until shown); every frame played past left an empty store entry (not stored).

## 0.27.0 — 2026-11-12 — Phone: player gestures, panel by pull-down, canvas in place, hold-to-size, finger undo / redo
- **What:** (phone app; the canvas parts also on the HTML page, same review-draw.js)
  **Fix:** a scrub (or frame steps) followed at once by Play jumped back to an older frame — play
  now starts on the frame on screen. The header and transport over the player have no fill (a halo
  keeps them readable). *+ Note* shows only with the Notes Panel open (or while a new note is being
  written). The panel's ⌃ is gone: pulling the list down from its top note goes back to the player.
  A swipe down on the player goes back to the reviews. Two fingers pan / zoom / turn the player
  (header *Fit* to reset). *Set state* is gone from the phone UI. The drawing canvas opened from the
  player shows the picture exactly where the player did (same box, zoom, turn; bars float over
  it) and hands the view back. Canvas: press and hold with a tool, drag up / down = that tool's size
  (preview circle on the left); select tool + selection: hold, drag up / down = line width,
  sideways = opacity; hold a tool's button = its default size; two-finger tap = undo, three = redo.
  The pencil (*Draw a note*) moved from the header row to a round button at the bottom right of
  the picture (above the transport on a video), where the full-screen viewer has it — it no
  longer jumps between corners from screen to screen.
  **Home:** the drag-to-bin is gone. Swipe a review left = the bin, right = the eye (hide for now);
  press, hold and drag = move it in the list (order kept). No hint text about deleting under the
  list. Scrolled past the two open buttons, they show as two small icons in the bar next to ⚙. Its class is `fab pencil` (the viewer's too,
  was `fab draw`): `.draw` is the canvas' root class — review-draw's injected CSS (`.draw {position:
  fixed; inset: 0}`) and the app's "canvas open" checks (`querySelector(".draw")` turns the
  player's keys off) must never match anything else.
- **Where:** `mobile/js/app.js` (`togglePlay`, `bindStage` replaces bindScrub / bindStageSwipe,
  `R.pv` / `applyPlayerView` / `fitPlayer`, `bindPanelPull`, `swipeLeave`, `playerPlace` +
  `drawCanvas`, `.compose` in `paintNewBar`, review-state menu removed, `reviewRow` / `orderReviews` /
  `hiddenKeys` + bar `.mini` on the home screen, `els.penB` placed in
  `applyStageView`), `mobile/index.html`
  (`.hdr` / `.tp` without fill + `--halo`, `.sv`, `.scrubimg` pointer-events, newbar / `--ph`
  rules), `app/static/review-draw.js` (`pinch`, `fitBox` / `nav` / `onNav`, hold → `adj`,
  `tap`, per-tool `SIZE` + `SIZE0` / `SIZE_RANGE` saved with the pen, tool-button hold),
  tests `tests/pwa_touch.cjs` (new, CDP multi-touch) + `test_pwa.py test_touch`, `pwa_e2e.cjs`
  (opens the panel before *+ Note*; the review state is set through the model).
- **Notes (home):** `reviewRow` replaces `dragToBin`. Order: `localStorage sight-review:order`
  (keys; reviews not in it — new ones — first, newest opened first; `orderReviews`). Hidden:
  `sessionStorage sight-review:hidden` (gone when the app is closed; *Show* under the list clears
  it). While a card is held and dragged the DOM is not reordered — moving its row drops the
  pointer capture and ended the drag after one place; the other rows slide by `translateY` and the
  row is moved once on release. One card open at a time (`openRow`; a pointerdown elsewhere shuts
  it). The bar's mini open buttons (`.bar .mini`, labels around file inputs) show when an
  IntersectionObserver sees `.opens` gone under the bar.
- **Notes:** the play bug: `play` cleared `R.want` while a seek was still queued / in flight, so the
  player played on from the older seek. `togglePlay` sends the target first. Separately, a tap
  landing on the cached scrub frame got no click when that picture hid mid-tap — `.scrubimg` is
  now `pointer-events: none`. (Headless Chromium also drops the click of a tap 0 ms after a drag;
  humans are slower — the test waits 120 ms.) A touch scrub no longer swallows the next click
  (only a mouse drag ends with its own click). `R.pv` is view only (not saved); the quarter turn /
  mirror stay in `R.meta.view`. The review state stays in the data (from Sight, exported, model
  `setReviewState`), only the phone control is gone. Size hold is touch / pen only (a mouse user
  pausing before a drag would trigger it). Tool-button hold resets the size only, not the colour.
  A swipe down while a new note or reply has content asks first.
- **Review (fresh agent, player / canvas):** the view handed back by the canvas was wrong when its
  quarter turn differed from the review's (canvas Fit after a pinch-turn handed back "fitted" =
  no turn; zoom was relative to the canvas' fit, not the player's — ×1.78 off on a 16:9 clip
  turned 90°): `onNav` now converts the zoom with the host's box at its own turn (`boxAt`), and a
  resize while typing refits only a fitted view. A selection hold (`adj`) was not ended by undo /
  redo / trash / recolour / tool change / frame change / keys — a TypeError per move and another
  frame's state pushed onto this frame's undo; all of them now cancel it first (`stopAdj`). A
  cancelled tool-size hold keeps the old size. "Draw on it" in the full-screen viewer used the
  player's place (the viewer is gone before the check) — `noPlace`. Finger taps within 600 ms of
  a pen (palm) no longer undo; the wheel pull-to-close waits 700 ms after scrolling (trackpad
  momentum); the touch test waits for playback instead of sampling at 60 ms.
- **Review (fresh agent, home list):** a tap on a swiped-open card opened the review (the
  document-level closer shut it before the card's click) — the closer now skips the open card
  itself, which also lets an open card be dragged back; a hold let go without moving opened the menu
  on pointerup and the tap's click then hit the sheet's backdrop and closed it — the menu now opens
  from that click (350 ms fallback when none comes); holding near the screen's edge scrolled and
  reordered (moving and edge scroll now start only past 8 px; a still release never saves); a mouse
  released off the card before the hold left a stuck ghost and a second finger left rows shifted —
  the pointer's end is heard on `window`, a second pointer is ignored, cancel puts rows back;
  `saveOrder` keeps reviews hidden for now in their slots; a non-array saved order is ignored;
  the IntersectionObserver reads the latest entry; `renderHome` drops a leftover ghost.

## 0.26.2 — 2026-11-12 — Phone app: why updates did not arrive (address), HTTP notice
- **What:** the app's Pages address redirects to the account's custom domain (github.io → 301 →
  http://pixis.ink/sight-media-viewer/). A copy installed from the github.io address can never update
  (the service worker's update check cannot follow a redirect to another origin), and over plain
  HTTP there is no service worker at all. The home screen now says when it is opened over HTTP, with
  an *Open over HTTPS* link; the worker is registered with `updateViaCache: "none"`.
- **Where:** `mobile/js/app.js` (`renderHome` notice, `initSW`), docs/ARCHITECTURE.md (Address).
- **Notes:** the right address is **https://pixis.ink/sight-media-viewer/**. Not redirected
  automatically: IndexedDB is per origin, reviews made on another address must be exported (.srev)
  and opened in the new one. Enforcing HTTPS is an owner setting (GitHub Pages "Enforce HTTPS" of the
  user site / Cloudflare "Always Use HTTPS"), not something the repo can do. No review agent for this
  small change.

## 0.26.1 — 2026-11-12 — Phone: scrub / frame steps no longer jump back before landing
- **What:** at the end of a scrub, and on every frame step, the picture jumped back a frame and
  then onto the right one. Now it goes straight to the frame.
- **Where:** `mobile/js/media.js` (`ScrubCache` rewritten: frames by media time, `fill`, `exact`),
  `mobile/js/app.js` (`cachedAt`, `showCached`, `hideWhenShown`, `settle`).
- **Notes:** two causes. (1) The cached picture was hidden on `seeked`, but the player paints the
  new frame a moment later (Safari especially), so the old frame flashed up: now it is hidden after
  rVFC reports a presented frame (250 ms fallback); a new cached picture cancels a pending hide.
  (2) The cache was keyed on a grid of the guessed 25 fps (WebM until played), so at 29.97 fps one
  frame in six was never cached and `near()` showed the frame before; steps now use `exact()` only
  (else the player's current frame stays until the seek lands), drags keep `near()`, and the cache
  is keyed by real media times with a gap-filling second pass.
- **Review (fresh agent):** `exact()` first picked the frame by round(mt / fd), which differs from
  what the player shows at (n + 0.25)·fd when stamps jitter (phone VFR clips) — now it takes the
  last cached frame starting at or before that point, only if none is missing in between; the cache
  bar ran backwards while `fill()` added early frames (progress only goes forward); "ended" could
  start a second `fill()` (once-guard, never seek to the very end); frame 0 was never cached (the
  start is a hole too); in a drawing session a step with no exact frame left the old picture under
  the new frame's drawings (falls back to `near()`, dimmed).

## 0.26.0 — 2026-11-12 — Phone app: full-screen player, Notes Panel, multi-frame notes, themes; multi-frame / multi-view notes in Sight
- **What:** the review is a full-screen player: every control in a header over the picture, the
  transport (marker / frame steps, timecode, timeline) over its foot, a thin *Notes Panel* bar that
  slides the player up off the screen and the notes in (filters + ⌃ back). No play button in the
  transport. Marker jumps / steps / timeline taps show the frame at once and the playhead and
  markers line up (one seek path). The scrub on the picture runs from where the clip is at a fixed
  pace (not the screen's width for the whole clip). Note pictures open full screen with floating
  Back / pencil buttons; swipe up / down = next / previous note, sideways = back. The drawing
  canvas' bars float over the picture; a tap on the tool in hand puts it down; on a video the
  canvas has the timeline: scrub / jump to other frames and draw there, *Done* makes one note with
  every frame drawn on. Notes are numbered by when they were made, videos too (also in Sight).
  Light / Dark / Auto theme for the whole app. The ✎ glyph is replaced by the pencil icon (tip
  bottom-left) on the phone and the HTML page. Home: press and hold a review, drag it onto the bin
  that appears at the bottom to delete it (let go without moving = the menu); the footer's
  "Nothing leaves this device…" is on its own line.
  **One note, several pictures (video frames / 3D views), everywhere:** Sight attaches every loose
  drawing made since the file was opened to the next note, whatever frame / view it is on (before:
  only the ones shown now); the note card shows one preview per frame (extra ones small; a click
  goes to that frame); the PDF / HTML report gets `notes[].more [{frame, size, caption, ctx}]` for
  the other frames / views (PDF: after the note's frame; the page: `frameOf("<id>|<i>")`, drawn
  over by ctx like the note's frame).
- **Where:** `mobile/js/app.js` (review screen, `seekTo` / `snapT` / `pumpSeek` / `settle`,
  `makeTransport`, `bindTimeline`, `bindScrub` / `scrubStep`, `setPanel`, `viewer` / `noteView`,
  `drawVideo` / `frameNow` / `framesDraw`, `editNoteDrawing`, themes), `mobile/index.html` (CSS,
  theme tokens), `mobile/js/model.js` (`notesSorted`, `noteFrameTimes`), `mobile/js/report.js`
  (extra frames), `app/static/review-draw.js` (floating bars, tool off, multi-frame API),
  `app/static/annotate.js` (`notesSorted`, `pendingDrawings`, `notePreview` / `previewBox`,
  `gatherReport` `more`, `frameIndex` / `landAt`), `app/review.py` (pencil icons, `build_pdf` and
  the page's `frameOf` / `noteCard` for `more`), `mobile/js/app.js` `dragToBin`, tests
  (`pwa_unit.cjs` frame times at 23.976…120 fps).
- **Notes:** the lag / misplaced playhead had two causes: steps / jumps set `currentTime` directly
  while a seek was in flight (late, lost taps), and the native range input stopped updating once it
  kept focus (`activeElement` check) and its thumb travels a narrower track than the markers'
  percent. A note may now hold drawings on several frames (each row its own `ctx`; the note's ctx is
  the earliest); Sight / the HTML page already show each drawing on its own frame, but Sight's
  report shows only the note's frame (not changed). The multi-frame canvas is used for new notes
  and *Edit the drawing* on videos; replies stay single-frame. The HTML page gets the floating bars
  and tool-off too (same review-draw.js), in its dark default colours. Tests: `pick()` in
  pwa_e2e.cjs takes a tool only when it is not already in hand (a second tap puts it down).
  **Frame times:** a stored ctx.t is (n + 0.01)·fd rounded to 3 dp, which can fall just *below*
  n·fd at 23.976 / 29.97 / 60 / 120 fps. `frameIndex` (model.js, same in annotate.js) recognises a
  stored time and keeps it on frame n (`frameTime(frameTime(t)) === frameTime(t)`); the player is
  sent a quarter into the frame (`pumpSeek`, annotate.js `landAt`), never to the stored time itself
  (0.100 at 29.97 fps showed frame 2 instead of 3 — also in Sight before).
- **Review (fresh agent):** found stepping stuck at 23.976 / 29.97 / 60 fps (re-snapping a rounded
  stored time fell a frame back) and marker jumps landing a frame early — fixed by `frameIndex`
  above, with a unit test; `settle()` ran from `seeked` while the next seek had already started
  (cached frame hidden early, and in a drawing session the old picture cached under the new time) —
  now only when not seeking, and `frameNow` refuses to grab while seeking; a frame grab finishing
  after the user moved on switched the canvas back (`moved` bumps the grab sequence, the grab must
  match the last time); editing a Sight drawing with `hold` lost it (an edited drawing keeps its
  own ctx); a swipe turning into a pinch left the viewer picture offset; a double tap opened two
  drawing sessions (`drawOpening`); `R.dragging` stuck when the canvas closed during a timeline
  drag (`finish` ends it, `lostpointercapture`); a canvas scrub with no duration jumped to frame 0;
  after a stylus, fingers could not scrub with no tool.
- **Review 2 (fresh agent, multi-frame notes / bin):** `frameIndex` took some raw player times for
  stored ones (now only a time with exactly 3 decimals can be stored); previews (Sight's `pumpPF`,
  the phone's `getFrame` → Grabber) seeked to the raw stored time and showed the frame before (now
  a quarter into the frame); `pendingDrawings` would have pulled old markup from other frames into
  an unrelated note — off-screen drawings now count only since the last note (`S.composeSince`),
  compose mode follows the same rule, and the note row says "(n on other frames)"; same-frame
  checks use `sameFrame` (frame index), not float equality; `gatherReport` left `S.curVk` on the
  last extra view and carried one view's look into the next; the home bin: Android's long-press
  `contextmenu` opened the menu over a lifted review, and a mouse held still before dragging lost
  the pointer (capture is now taken on lift).

## 0.25.0 — 2026-11-12 — Phone app remembers the picked file
- **What:** a review opens with its picture / video straight away: the app keeps a copy of the
  file you picked on the device (automatically, no question) and binds it when the review opens.
  Without a copy the stage shows *Pick the file* as before. ⋯ → *Forget the file on this device*
  drops the copy (and stops keeping it for that review); *Remember the file…* brings it back.
- **Where:** `mobile/js/app.js` (`autoKeep`, `openReview`, `rebind`, `paintKeep`, `dropCopy`,
  menu), `tests/pwa_e2e.cjs` + `tests/test_pwa.py` (reload → picture and video reopen with the file).
- **Notes:** a web app cannot keep a handle to a file picked from Photos / Files on iOS (no File
  System Access API there), so "remember" = a copy in IndexedDB `files`; it counts against the
  browser's storage. Skipped when the copy would take usage past 90 % of the quota (the hint then
  says so, with *Try again*). The copy is written after the review is on screen; a review deleted
  meanwhile drops it. `meta.keepAsked` is gone (old records keep the harmless field); `meta.noKeep`
  replaces it. Re-picking a file (rebind) replaces the copy.
- **Review (fresh agent):** the first version put the whole `rv.meta` back after the copy was
  written, so a review closed and reopened meanwhile (or imported into) lost or regained `kept`
  against what was stored; "Forget" during a running copy was undone; a failed replace left the old
  copy bound silently. Now `store.js keepFile / dropFile` patch the stored entry by key in one
  transaction with the file (no write for a deleted review or one marked noKeep), the open review's
  meta follows, a failed replace drops the old copy and shows the hint, and `openReview` sets `kept`
  from what is really in `files`.

## 0.24.0 — 2026-11-12 — One transform tool everywhere, clean picture for new notes, turn / mirror, phone scrub cache
- **What:** the select / transform tool (`V`) is now in the shared drawing canvas too (HTML page,
  phone); its rotate knob follows the pointer out from the pivot (longer arm = finer turn), same in
  Sight. Ctrl held = temporary eraser; a bin clears the drawings on screen (Sight: Shift+Delete).
  A new note (or reply) is drawn on a clean picture: Sight hides other notes' drawings while you
  draw / type a new one, a clicked note shows only its own; cards show the note's (and each reply's)
  drawings over the clean picture / video frame. Sight's panel got the All / Open / In progress /
  Resolved filter. View turn 90° / mirror: Sight's viewer (Shift+R / Shift+M, per file), the
  phone (stage, viewer, canvas; saved with the review), the canvas (buttons + two-finger turn).
  HTML page: the top picture is the original, every card picture is full width, the zoom viewer
  zooms with right-drag / pen side button / wheel / double-click (the canvas: right-drag too).
  Phone: a scrub cache of small frames so scrubbing follows the finger at once.
- **Where:** `app/static/review-core.js` (xf*), `review-draw.js` (rewritten view + select tool),
  `annotate.js` (viewMode / ctxShown, local() through the turn, previews, filter, clearShown,
  Ctrl eraser), `index.html` (attachViewer turn / unturn, buttons, keys, hints), `app/review.py`
  (template), `mobile/js/app.js`, `mobile/js/media.js` (ScrubCache), `mobile/index.html`; new
  `tests/test_review_page.py` + `tests/page_e2e.cjs` (Sight → page → Sight with a reply picture,
  a reply drawing, a resolve and a new drawn note).
- **Notes:** turning / mirroring is view only — doc units (the media's own pixels) never change;
  exports and screenshots stay unturned. Reports use `ctxShown`, never `visibleNow` (the view mode
  must not drop drawings from a PDF). "Pictures lost in the merge" (user report): the round trip
  loses nothing (new test); what looked lost were reply drawings Sight only listed as an eye + count
  and the page's cover showing everything at once — both now shown where they belong. The phone
  cache is memory only (≤ 1500 frames ≤ 640 px); scrubbing still seeks the real player and the
  cached picture hides when the seek lands. The canvas's undo keeps item arrays: transforms work on
  copies, never mutate an object an undo state holds. Review (fresh agent) found and these were fixed: the page viewer's
  tap-close beat its double-click zoom (the close now waits 280 ms); a middle-drag at fit moved a
  hidden pan; the canvas's recolour lost the selection; on touch the 22 px handle reach made small
  objects unmovable (a press on the body > 8 px from a handle moves it); drawings hidden by the view
  mode stayed selected (Delete / nudge acted unseen — the selection is pruned in paintVisibility); a
  screenshot did not switch to the clean picture at once; the preview-frame pump raced on reopening
  the same video (generation token); ScrubCache showed a far-away frame where the clip was not cached
  yet (only ±2 steps now, and the player takes over once it has caught up); a rebind could start a
  cache on the revoked URL. Design change from it: only drawings made since the file was opened
  (data.created ≥ S.openedAt) start the compose mode, so old loose drawings never hide every note's.

## 0.23.1 — 2026-11-12 — Video frame stepping and note times land on the frame on screen (Sight + phone app)
- **What:** in Sight's video lightbox `,` / `.` stepped from the *nearest* frame boundary, so a step taken after a pause or a scrub late in a frame skipped a frame forward (or stayed put backwards); a note / drawing made while paused late in frame k was stored at the raw time and showed on frame k+1. Now a step goes from the frame on screen and a new note / drawing is stored at that frame's start (+0.01 frame, where stepping lands). Without annotating, stepping used 25 fps on every clip (the rate was only read when annotation mode came on); it is now read when a video opens. Found by the fresh-agent review of the phone app (0.23.0), which already had the fix.
- **Where:** `app/static/annotate.js` (`frameStart`, `stepFrame`, `ctxNow`, `setAsset` → `loadFps`); `mobile/js/app.js` (`frameStart` keeps the raw time while the rate is a guess, like Sight). Docs: ARCHITECTURE (phone app video), PLAN.md (known bug removed).
- **Notes:**
  - The frame on screen at time t is `floor(t · fps)`; stored `t = (frame + 0.01) / fps` to 3 dp. Labels still use `round(t · fps)` — the same frame for every time stored this way, and unchanged for older notes (whose `ctxVisible` window also centres on their raw `t`). Older notes are not moved.
  - While the rate is unknown (Sight: before `/info` answers; app: WebM before it is measured) the raw time is kept: snapping to a guessed rate could move a note by a frame.
  - `compare.js` has its own timeline (`snapT` to exact frame starts, no stored times) — checked, not changed.
  - Checked in Sight (dev server, temp SIGHT_HOME, 24 fps WebM): from 1.03 s `.` → 1.0421 (frame 25), `,` → 1.0004 (frame 24); a note at 2.03 s stored at 2.0 with fps read before annotating. `python -m unittest tests.test_pwa tests.test_merge_parity` passes.

## 0.23.0 — 2026-11-12 — Phone app "Sight Review" (PWA): local review on the device
- **What:** stage 3 of `docs/PLAN-mobile.md`. A web app for phones / tablets, installable from Safari (*Add to Home Screen*) / Chrome, fully offline: pick a picture or a video on the device (nothing is uploaded), review it from scratch — notes, replies with pictures, note states, the file's review state, drawings and text on the picture or any video frame (scrub by dragging sideways on the video as in Sight, frame stepping, timecode + frame number, note markers), edit / delete — and export a **PDF** report, a static **HTML** page (both: frames with drawings burned in, notes, replies, pictures) or a **.srev** that merges in Sight (found by name + size); a `.srev` from Sight opens / merges in the app. Reviews live in IndexedDB; the media file can be kept on the device on request. Published to GitHub Pages by a new workflow. The HTML reviewer page's drawing canvas moved into a shared file the app uses as is, and got a **Text** tool (both the page and the app).
- **Where:** new `mobile/` (`index.html`, `sw.js`, `manifest.webmanifest`, `icons/`, `js/app.js`, `model.js`, `store.js`, `media.js`, `mp4.js`, `report.js`, `pdf.js`); new `app/static/review-draw.js` (`SightReviewDraw.open`, CSS injected, scoped to `.draw`; was `drawSheet` + its CSS in `review._HTML_TEMPLATE`); `app/review.py` (`_inline_js` / `draw_js`, `%%DRAW%%`); `tools/build_pwa.py`; `.github/workflows/phone-app.yml`; tests `tests/test_pwa.py`, `tests/pwa_unit.cjs`, `tests/pwa_e2e.cjs`. Docs: ARCHITECTURE ("Phone app"), MANUAL, README, FORMAT (asset id from the app, `app` value), PLAN-mobile (stage 3 done, open question answered).
- **Notes:**
  - Owner's answers (2026-11-12): images + video only for now; the PDF is pages drawn as pictures (canvas + device fonts → one JPEG per page, own ~80-line writer): any script renders, no font shipped, text not selectable.
  - Identity: `key = sha1(lower(name) + "\n" + size)[:16]`; mtime is left out on purpose (iOS gives the pick time for Photos). The app's package carries `asset.id = key`, `path = name`; Sight matches it by name + size. A review imported from Sight keeps Sight's asset (id / path) for the way back.
  - Rows are written only through `mobile/js/model.js`, in Sight's shapes (reply tombstones, status events + `status_at`, `edited_at`, drawings' `data.note` / `data.reply` / ctx, `setReviewState` = `Library.set_review_status`); every merge goes through review-core `mergeRows` — a merge rule change still needs only Python + review-core (+ parity fixture).
  - Owner's requests during the stage: scrub by a sideways drag on the video (same mapping as Sight's click-drag; a tap still plays / pauses, a vertical swipe still scrolls), and a text tool in the canvas (FORMAT.md `text` rows, no format change; Sight's defaults).
  - review-draw.js obeys review-core's rule: no closing script tag / HTML comment opener in the file (`_inline_js` refuses). Its body class is `rd-open` (the page's zoom viewer keeps `zoomed`).
  - Video: fps from the MP4 / MOV `stts`, else measured while playing (`requestVideoFrameCallback`), else 25 ("≈25 fps" shown). Stepping and ctx (`{t: 3 dp, hold: 0}`) as Sight. Card / report frames come from a hidden second `<video>` and are cached in IndexedDB (`frames`), so notes stay readable without the file.
  - Service worker: precache everything, cache-first; a new version waits until the user taps *Reload* (the first install's `clients.claim()` must not reload — found in testing).
  - GitHub Pages needed a one-time setting by the owner (done 2026-11-12): Settings → Pages → Source: *GitHub Actions*; the app is at https://anurbis-dev.github.io/sight-media-viewer/. Deploys only from `master`; other branches just run the unit tests + build. The workflow is `phone-app.yml` ("Phone app (Sight Review)"; first named `pages.yml`); it is separate from `release.yml` — a desktop release does not deploy the app and the app does not need a release.
  - Tested here (Linux, headless Chromium at iPhone size): `python -m unittest tests.test_pwa` — build, unit (model, fps parser on synthetic `moov`, PDF writer opened by PyMuPDF), and a round trip: the app reviews a PNG and a VP9 WebM (stepping, 24 fps measured, drawn notes, reply drawing, reply picture, resolve, review state) → `.srev` imported by Sight's own `Library.import_annotations` path (name + size match, every row, shot file, status history, rect in native px) → Sight adds a reply + note → the app merges it into a fresh profile, re-pick by name + size binds the file, re-import reports "already up to date". Offline reload and the update banner checked by hand with Playwright. **Not checked** (no device here): a real iPhone / iPad / Android — see PLAN-mobile stage 3 "Left to check".
  - Fresh-agent reviews, one per block: (1) moving the canvas out of the page — nothing serious (CSS of all 35 canvas elements compared old vs new: identical); applied: review-core looked up on open (load order), `box-sizing` inside `.draw`, the page test now checks `%%DRAW%%`. (2) the app — fixed: the IndexedDB connection was cached forever (iOS drops it in the background) and a failed save was not retried (now: reconnect + retry once, the pending snapshot stays until written, retried every 3 s); Back (iOS edge swipe / Android) while drawing closed the review under the canvas and Done crashed (now Back closes the viewer / sheet, or is undone while the canvas is open); two quick opens mixed two reviews (fps of one saved into the other) and late frames / thumbnails landed in another or a deleted review (now an open sequence, `rv` everywhere, `putIfAlive`); a JPEG with EXIF rotation from Sight has unrotated width / height while drawings are in the shown size (the file's probed size now wins); double tap on Send sent twice; an edit during an import into the open review was dropped; stepping rounded (skipped a frame from the second half of one) and notes were stored at the raw time (now `frameStart`: floor + 0.01·fd, as Sight's stepping lands — Sight's own copy of the bug is queued in PLAN.md). Not changed: Photos-picker copies (HEIC → JPEG, re-encoded video) do not match Sight's originals by name + size — documented (use Files). (3) text tool + scrub — fixed: the focused text field scrolled the canvas (`overflow: clip`, scroll reset, `preventScroll`), so later fields / zoom anchors were off; a pinch while typing committed and opened a new field (the finger now navigates); wheel / Fit while typing left the field behind (it now follows `apply`); Cancel dropped the typed text even when the discard was declined; Esc during IME composition; a resize while typing never re-fitted; a second finger during a scrub froze the timecode; a mouse released outside the stage left hover scrubbing; a WebM without duration threw; a tap right after a touch scrub was ignored.
  - Not done (later stages / deliberately): PSD / PDF pages, 3D (stage 4), trackers, clouds; drawing on an attached picture (the web page has it); "mine / others" drawing filters (the app is one person's).

## 0.22.0 — 2026-11-12 — Technical debt from PLAN.md: grid refresh past 800, Starlette, faster start, thumbnails off the GIL
- **What:** every queued item of `docs/PLAN.md` (owner's decision 15 in PLAN-mobile: no debt before the phone app). Fixed: a status / tag / thumbnail change of an asset past #800 in the grid now shows (it never did); on a zoomed-in board, panning no longer keeps every original it passed decoded. Faster: server start (Linux container: process start → `/api/health` 390 → 181 ms median), the startup scan waits for the first grid page, the Windows splash's PowerShell only starts when a launch is slow, the API stays responsive while PSD / PDF thumbnails are made (1,000 PDF + text files, same container, back-to-back runs: `/api/assets` while thumbnails are made median 81–93 → 13–14 ms, p90 146 → 31 ms, max 275 → 52–75 ms; all thumbnails 27–29 → ~14 s), three.js is prefetched when the library has 3D files, smaller build. New: `tools/bench_startup.py`, `tools/bench_grid.py`. Windows launch focus: `AllowSetForegroundWindow` + an `AttachThreadInput` fallback.
- **Where:** `app/web.py` (new: FastAPI-shaped router on Starlette); `app/server.py` (imports, `App()`, `POST /api/assets/by-ids`, `first_page_served` in `/api/assets`); `app/library.py` (`_LIST_COLS` / `_list_item` / `assets_by_ids`, `_first_page` gate in `resume_watchers`, `render_psd_thumb` / `render_pdf_thumb`, `HeavyWorkers` + `_heavy`, `thumb_version` caches 0, `_mark_thumb`, `prioritize` regenerates missing files); `app/static/index.html` (`refreshItems` / `refreshIds` / `refreshStaleVisible` / `staleIds`, `loadedIds`, incremental `computeMasonry`, 3D prefetch at the end of boot); `app/static/canvas.js` (`syncResolution` off-screen downgrade); `Sight.py` (starlette dep, `allow_foreground_handoff`, `_bring_to_front`, `LazySplash`, `freeze_support`); `build_exe.bat` / `build_app_macos.sh` (starlette, `--exclude-module` tkinter + 13 pxr bindings); `tools/benchlib.py`, `tools/bench_startup.py`, `tools/bench_grid.py`. Docs: ARCHITECTURE (web.py, grid refresh, heavy pool, scan gate, `_mark_thumb`, canvas), PLAN.md rewritten (what is left to check on Windows), CLAUDE.md (Starlette).
- **Notes:**
  - `app/web.py` rules (ARCHITECTURE has them): params by name from path → query → default; only `Request` / `int` / `float` / `bool` annotations matter; plain `def` → thread pool, `async def` → event loop (wrap blocking library calls in `asyncio.to_thread`); Response as is, else JSON with inf / nan → null (FastAPI did the same; a stored `inf` from a PATCH or a `.srev` made `/api/state` a 500 in the first cut); HEAD on a GET route → 405 as under FastAPI. An A/B of ~80 requests against the FastAPI build matched except the 422 message text and `Allow: HEAD, GET`. Existing runtime venvs keep working (starlette came with fastapi); a fresh one installs starlette.
  - Grid refresh: only what is on screen (+ inspector + lightbox asset) is re-read by id; everything else is marked stale and re-read when its card shows. Never go back to re-reading "offset 0 … N": the server caps `limit` at 800. `pull()` keeps a row it already has stale instead of trusting the duplicate.
  - Heavy thumbnails: 2 spawned worker processes of our own (`HeavyWorkers`; never fork: SQLite + threads), started on first PSD / PDF, stopped after 60 s idle. A timeout (120 s of work) or a crash kills that worker and skips the file for the session — it is never re-rendered in the server (a file that crashes MuPDF would take Sight down). Only if processes cannot start at all does it render in the thread. Text thumbnails stay in threads (cheap). Measured equal to a ProcessPoolExecutor (300 PDFs: 4.93 vs 4.87 s; threads 10.66 s). In a frozen build the children are the exe itself → `multiprocessing.freeze_support()` first in `if __name__ == "__main__"` — keep Sight.py / library.py free of module-level side effects.
  - The splash is still PowerShell (a native ctypes window could not be tested here, and a bad window procedure would crash Sight). Build: `--collect-all pxr` still ships the excluded packages' `__init__.py` (harmless, never imported); `pxr.UsdUI` must stay (UsdShade loads it — excluding it printed a USD warning on every conversion). Linux dist 617 → 581 MB, 30 → 17 USD binding modules.
  - Board originals: also back to the thumbnail when more than a screen away (Playwright, 30 × 12 MP at 4×: 11 originals kept while panning before, ≤ 5 after).
  - Benches: an isolated copy of a SIGHT_HOME (or a synthetic library), a headless Edge / Chrome / Chromium over a stdlib WebSocket CDP client; `bench_grid` also checks the grid never re-anchors `scrollTop` on its own (0 of 600 frames here). Window placement / focus / splash are not measured (no app window) — PLAN.md lists what to check by hand on Windows.
  - Not verified here (Linux container): anything Windows-only — focus, splash, `build_exe.bat`, the frozen exe's worker processes, Defender first-start time. PLAN.md "Left to check on Windows".
  - Fresh-agent reviews, one per block, findings fixed: (1) grid refresh — a Ctrl+A selection of > 5000 was cut by the server but marked fresh (now: on-screen + inspector + lightbox, ≤ 2000 per request, the rest stays stale), duplicates in `pull()` lost their stale mark, the lightbox's asset was not refreshed, `by-ids` ran its query on the event loop; `_bring_to_front` now catches `ctypes.ArgumentError` too. (2) startup — inf / nan → 500 on `/api/state`, `pxr.UsdUI` exclusion warning, HEAD now running GET handlers. (3) thumbnails / grid / canvas / benches — the first cut used a ProcessPoolExecutor: a running job blocked process exit (hung PSD → hidden Sight.exe never exits), a timeout neither cancelled nor killed the job (late writes without DB update, the same file resubmitted until both workers hung), a child that died on a file was re-rendered in the server (crash); replaced by `HeavyWorkers` (tested: hang killed at the timeout, crash → skipped, idle reap, exit with a hung job in flight is immediate, no orphans). A cached 0 could stick (now re-checked after 30 s); has_thumb assets whose file was deleted were never regenerated (pre-existing; now `prioritize` does). Benches: refuse a Python without Sight's deps (the venv re-exec would orphan the server on Windows), stop the server when it never answers.
  - MemPalace is not available in the cloud session; nothing stored there.

## 0.21.0 — 2026-11-11 — HTML reviewer page: vector drawings shown and drawn on the page
- **What:** stage 2 of `docs/PLAN-mobile.md`. The web page for reviewers now gets clean pictures and draws the review's drawings itself (vectors, sharp at any zoom), with *My drawings* / *Others' drawings* switches (pencil next to search). Reviewers can draw: the pencil in a reply / new-note field or *✎ Draw* in the full-screen viewer opens a full-screen canvas — brush with pen pressure, highlighter, arrow, rectangle, ellipse, eraser, five colours, undo / redo, two-finger pinch / pan, "pen draws, finger pans" once a stylus was used, wheel zoom on desktop. A drawing on a note's frame goes with a reply (`data.note` + `data.reply`), a new note can be drawn on the cover (pictures) or on any note's frame (video / 3D; the new note takes that frame's ctx). Drawing on an attachment sends a flattened copy of the picture instead. Sight imports it all through the usual merge; reply drawings get the reply's eye toggle there. Also fixed: exporting a PDF / web page while the video was playing lost every drawing on the video frames (the clip ran on after each seek, so the frame was ~1 frame late and `visibleNow` rejected the drawings) — `gatherReport` now pauses and resumes.
- **Where:** `app/static/annotate.js` (`gatherReport(forPage)`: clean cover / frames + `coverSize`, per-note `size`, reply `id`, `media`; pause during export; `visibleNow` → `frameNow()` + `RC.ctxVisible`). `app/static/review-core.js` (`ctxVisible`, `drawingRow`). `app/server.py` (export/html passes `coverSize`, `media`). `app/review.py` page template: `frameOf` / `vbOf` / `drawingsOf` / `shownOn` / `pic` / `overlay`, `drawSheet` (canvas), `drawFlat`, `editDraw`, `pickFrame`, `drawRows` / `drawCtx`, drafts `draw: {frame, items}`, `E.rows`, viewer entries `{f}` / `{src, note}` with a Draw button (`drawTarget`), `#vwrap` switches. Docs: ARCHITECTURE "HTML reviewer page", FORMAT Context, MANUAL, PLAN-mobile.
- **Notes:**
  - No format change: the page writes ordinary `stroke` (brush / marker) and `shape` (arrow / rect / ellipse) rows. A drawing on a reply copies the note's video `{t, hold}` (so it lives exactly as long as the note's own drawings) or 3D `{vk, cam}`; picture → `ctx: null`. Sizes are screen px at draw time / zoom (brush 6, highlighter 24, shapes 4, eraser radius 14), like Sight's tools.
  - Doc mapping on the page: picture / video frames are the whole media scaled, so the overlay's `viewBox` is `0 0 media.w media.h`; 3D frames use `-500·a -500 1000·a 1000` (a = frame aspect). Checked against Sight: a ring drawn on a GLB cube in Sight sits on the same spot on the page, and a rect drawn on the page sits there in Sight.
  - The eraser only removes objects drawn in the current canvas session; the page never deletes exported rows (no tombstones from the page).
  - Gestures: a second finger during a finger stroke cancels that stroke and becomes a pinch; while a pen draws, fingers are ignored; `pointercancel` finishes a stroke. The canvas is a `.draw` overlay that the document click handler ignores (like `.zoom` / `.pick`). The viewer's Draw button is skipped by the overlay's `pointerdown` (else pointer capture would steal its click).
  - Pages exported before 0.21 keep their own script and burned-in frames. A page with `media` missing (shouldn't happen) falls back to plain frames without drawing.
  - Tested with Playwright on an isolated `SIGHT_HOME`: image / video / GLB exports via the menu, page rendering, every tool, undo / redo / eraser / Ctrl+Z, wheel zoom + drawing while zoomed, synthetic touch (pinch, stroke cancelled by a 2nd finger) and pen (pressure, then finger pans), frame picker, viewer Draw, flat drawing on an attachment, Cancel confirm, remove unsent reply → its rows go, state change + empty-field close, download → import (`added` / `updated` as expected), Sight showing the imported drawings (image, video at f48, 3D view), PDF frames with drawings again. Not checked: a real iPad / Android device.
  - Fresh-agent code review (it also drove the page in headless Chrome) found, all fixed: a `pointercancel` (e.g. an iPad palm rejected by the system) kept its stroke — now dropped; a pen landing while a palm / finger stroke or pan was active was ignored — the pen now wins (palm stroke dropped, pan stopped); × on a draft drawing / picture also closed an otherwise empty field (the click reached the outside-tap handler after the button was gone) — `stopPropagation`; `ctxVisible(c, {vk: undefined})` showed everything — now "no view"; a resize mid-pinch reset the zoom. Not changed: a 3D drawing with `ctx: null` shows on every 3D frame on the page (same as Sight's `visibleNow`), while the PDF's 3D frame filter (`ctx.vk === note vk`) leaves it out.
  - MemPalace was not available in this (cloud) session, so nothing was stored there.

## 0.20.0 — 2026-11-11 — Shared review format (FORMAT.md) and JS core (review-core.js); drawings on replies
- **What:** stage 1 of `docs/PLAN-mobile.md`. The review data contract is written down in `docs/FORMAT.md` (package, rows, every drawing type, ctx, status rows, shots, tombstones, merge rules). Drawing rendering and the merge rules now live in one plain script, `app/static/review-core.js`, used by Sight and inlined into the HTML reviewer page; the mobile app will use it as is. New field `data.reply` on a drawing: in Sight such a drawing gets an eye toggle with its count on the reply, is hidden while the reply is deleted / toggled off, and is deleted (undoably) together with the reply.
- **Where:** new `app/static/review-core.js` (geometry/primitives/bounds/hit tests/transforms/`validItem` moved out of annotate.js unchanged; new `mergeRows` / `mergeReplies` / `mergeHistory` / `contentAt` / `stamp` = JS port of `Library.import_annotations` & co.; `drawCanvas`, `svgMarkup`). `app/static/annotate.js` (imports the core, `replyGone`, `S.hiddenReplies`, `rdrawChip` / `[data-rdraw]`, `deleteReply` takes the reply's drawings, `ghostNow` and reports skip them). `app/review.py` (`core_js()`, `build_html` single-pass `%%TITLE|DATA|CORE%%` substitution, page `download()` uses `RC.mergeRows`). New `docs/FORMAT.md`, `tests/test_merge_parity.py`, `tests/merge_js.cjs`, `tests/fixtures/merge_cases.json` (+ `make_merge_cases.py`). ARCHITECTURE, MANUAL, CLAUDE.md, PLAN-mobile.
- **Notes:**
  - review-core.js is a classic script on purpose (sets `globalThis.SightReviewCore`, `module.exports` under Node): an ES module could not be inlined into the page's classic script nor `require`d by the Node test. annotate.js does `import "/static/review-core.js"` for the side effect and destructures the global. Never write a closing script tag or an HTML comment opener in that file — `core_js()` raises (the page inlines it verbatim).
  - Merge parity: `python -m unittest tests.test_merge_parity` (needs `node`) runs Python `import_annotations` on a temp library and JS `mergeRows` on the same 15 fixtures and compares every row, the stats and that inputs were not mutated. Any merge rule change goes into both + a new fixture case. The JS port keeps ids (lower-cased); Python's re-derivation of non-hex ids / ids of another asset is Sight-only. Python truthiness / `or` / `int()` are emulated (`pyTrue`, `pyOr`, `stamp`, `num`) for the values clients write; NaN, `True` vs `1`, float ids are not.
  - The page's reply file is now `mergeRows(exported rows, local edits)`: replies sorted by `created`, the state by `status_at`, new notes inserted. Exported notes keep their exported `updated_at` (Sight before 0.17 merged notes by it; found in review).
  - Geometry move checked: old (master) vs core functions on 4 000 random items in Node — identical prims / SVG / bounds / hit tests / transforms (the reviewer repeated it on 44 000). Playwright on an isolated `SIGHT_HOME`: core rendering, reply eye toggle, Delete with a hidden selection, reply delete + undo (server rows too), mouse brush, `S` screenshot, PDF + HTML export via the menu, HTML page reply + resolve → download → import back (`updated: 1`), no console errors.
  - Fresh-agent code review found three bugs, all fixed: onion skin still ghosted drawings of hidden / deleted replies; hiding a reply's drawings left them selected so Delete removed them unseen; the page's download bumped exported notes' `updated_at`. It also fuzzed the merge (7 500 random cases, no mismatch on client-written values).
  - Not done (later stages): Sight cannot draw on a reply yet (only show / hide / delete such drawings); the HTML page does not render vectors yet (stage 2 — the core is already inlined there).

## 0.19.3 — 2026-11-11 — HTML page: picture viewer swipes between pictures; no scrolling through it
- **What:** on the reviewer page, dragging on an enlarged picture no longer scrolls the page behind it. A horizontal swipe (← / → on desktop) goes to the next / previous picture, a vertical swipe, a tap or Esc closes; a counter shows *2 / 5*. Galleries: the cover plus every shown note frame; and per note its attachments together with its replies' pictures — never across notes.
- **Where:** `app/review.py` HTML template — `zoom(gal, at)`, `frameGal` (rebuilt in `renderList`, cover at 0), `noteGal` (set in `noteCard`, filled by `thumbs`, reset after each card), `.zoom` CSS (`touch-action: none`, `body.zoomed { overflow: hidden }`).
- **Notes:**
  - The overlay takes pointer events and cancels `touchmove` (non-passive) — that is what stops the page scroll on iOS; `overflow: hidden` on body alone does not.
  - A tap closes on `click`, not on `pointerup`, so the click does not land on the page under the overlay (the document click handler that closes empty fields ignores `.zoom` targets).
  - The frame gallery follows the current filter / search (only shown notes). Pages exported before 0.19.3 keep their old viewer.

## 0.19.2 — 2026-11-11 — Merge the lost 0.15.1–0.15.6 fixes (no console windows; grid blink)
- **What:** Console windows no longer flash on Windows while video/audio thumbnails and waveforms are built, and the library grid no longer blinks / jumps by a row while scrolling or zooming. Both had been fixed in 0.15.1 and 0.15.5, but those commits lived on the side branch `claude/review-and-startup-speed` and never reached master: 0.16.0 (annotations) was branched from 0.15.0, so every build since then shipped without them. This also brings in the rest of that branch: faster startup (0.15.2), maximize/focus on launch (0.15.3), splash closing with the window (0.15.4), `docs/PLAN.md`.
- **Where:** merge of `claude/review-and-startup-speed` (0.15.1–0.15.6 entries below). Conflicts: `server.py` `/api/assets` keeps 0.17's `review` filter and returns 0.15.2's `JSONResponse`; `version.py`; this file.
- **Notes:**
  - Check after a merge that `grep -n "subprocess\." app/*.py` shows `creationflags=NO_WINDOW` (from `fileinfo.py`) on every console program run by the windowless app (ffmpeg, powershell, cmd), and that `.grid` in `index.html` has `overflow-anchor: none`.
  - Before starting a feature branch, branch from the current master, not an older commit: that is how these fixes were lost.

## 0.19.1 — 2026-11-11 — HTML page: empty fields close on an outside tap; new note behind a + button
- **What:** on the reviewer page an empty reply field (no text, picture or *Mark as* state) closes when you tap anywhere else (Esc on desktop). The new-note form is no longer always at the end of the feed: the blue *+* in the bottom bar opens it (one at a time — + again just jumps to it; × discards it; empty + outside tap hides it).
- **Where:** `app/review.py` HTML template — `newOpen` / `opening`, `closeEmpty` on a document `click` listener, `isEmpty`, `focusLater`, `#add` in `.foot`, `.compose h3` close button, composer `data-key`.
- **Notes:**
  - The outside-tap check runs on `click` (bubbling), after the tap's own handler, so a field that very tap opened is skipped via `opening`. It is not done on `pointerdown`: re-rendering there shifts the layout under the finger and the click lands elsewhere.
  - A field with any content stays open on an outside tap — only empty means cancel. Taps on the name dialog or the zoomed picture are ignored.
  - Focus is applied in `requestAnimationFrame` by looking the textarea up by key, because closing another empty field in the same click re-renders the page a second time.

## 0.19.0 — 2026-11-11 — Notes can be *In progress*; reply pictures; HTML page: name gate, pinned filters, chat-style field
- **What:** a note is open, *in progress* (someone took it) or resolved — a clock button in Sight, orange number / timeline marker, logged in the thread like resolve. Replies can carry pictures. The HTML page asks the reviewer's name before anything else; the sender (*From …*), *You: … ✎* and the *All / Open / In progress / Resolved* filters with count badges are pinned with the title; search hides behind an icon. *Reply* opens one full-width field (paper clip = attach, paper plane in the bottom-right corner = send) with *Mark as In progress / Resolved / Reopen* chips — the state goes with the reply or alone. New notes take pictures too; unsent entries have × to take them back.
- **Where:** `app/review.py` (HTML template rewritten: `composer()`, `readImage`, gate `#gate`, `paintSeg`, `statusOf` from the last local event, `E.att`; `build_package` packs reply shots; PDF reply pictures + `EVENT_LABEL` + in-progress tag); `app/library.py` (`import_annotations` remaps `replies[].shots`); `app/static/annotate.js` (`ICON.prog`, `data-prog` toggle, `EVENT` / `eventIcon`, `.prog` styles, `img[data-rshot]` in replies, report / copy text carry reply shots and the state).
- **Notes:**
  - No format change: `progress` is just another `status` value (merged by `status_at` like done/open) and reply `shots` is an optional field. Sight before 0.19 shows an in-progress note as open-looking and ignores reply pictures. `_OPEN_NOTES_SQL` counts in-progress as open (≠ done), as do carry-over and the report's *Open*.
  - Page state model changed: `E = {replies, notes, att}` — no separate `E.status`; a note's state on the page is its last unsent event, else the exported one. On download the last event sets `status` and `status_at` (= that event's time). Pages exported by 0.18 keep their own embedded script, so nothing to migrate.
  - Page pictures are scaled to ≤1600 px JPEG 0.85 in the browser and kept in localStorage (`E.att`) until downloaded; if the quota runs out the page alerts once and asks to download now (edits stay in memory). Enter sends on desktop; on touch screens Enter is a newline.
  - Sight cannot attach pictures to a reply yet (only show them) — the planned mobile review app is the next step.

## 0.18.0 — 2026-11-11 — Review history: resolve / state changes are logged; phone-friendlier HTML page
- **What:** resolving or reopening a note adds an entry to its thread (*✓ Resolved by X · date*), in Sight and on the HTML page; the file's review state keeps a history (who set which state when), shown under the State row in Sight and in the HTML page's details. The HTML page has a pinned title bar — tap it or the arrow for path / chips / state history (collapsed by default) — and a one-line bottom bar (*N changes · Discard · Download reply*).
- **Where:** `app/static/annotate.js` (`statusEvent`, `eventLabel`, event rows in `repliesHtml`, resolve toggle, `copyText`, `gatherReport` passes `event`; `STATE_LABEL`, `histLine`, `.an-rsh` in `paintStatus`, `S.statusHist`); `app/library.py` (`set_review_status` appends history and keeps the row on clear, `merge_history`, status rows union `history` in `import_annotations`); `app/review.py` (HTML template: `.top` header + `#details`, events on Resolve/Reopen with undo-of-unsent, compact footer, state history; PDF `revent` lines).
- **Notes:**
  - A status event is a reply-shaped entry `{id, event: "done"|"open", author, created}` — it merges like a reply (union by id) and needs no format change; Sight before 0.18 shows it as an empty reply. The note's actual state is still `status` / `status_at`; the events are only the log.
  - On the HTML page, toggling back an unsent resolve drops its entry instead of logging a reopen (nothing was sent yet). In Sight every toggle is logged — it is committed immediately.
  - Clearing the review state used to delete the status rows; it now keeps one with `state: null` so the history survives (`_REVIEW_SQL` reads null = no state). Status rows from 0.17.0 have no history — their current state is used as the first entry.
  - History entries set in the same millisecond keep insertion order (stable sort by `at`).

## 0.17.0 — 2026-11-11 — Review round-trips: merge, replies, versions & compare, review state, HTML page for reviewers
- **What:** importing a `.srev` now merges instead of duplicating; notes have replies; files get a review state (Needs review / Changes / Approved) shown on grid cards and filterable in the sidebar; versions of a file (`_v001`, `_v002` …) are detected, open notes can be copied to the next version, and `K` opens a compare view (multi-layer swipe, tile / row / column, over / difference, synced video with a per-clip first-frame offset); a self-contained HTML page lets people without Sight reply / resolve / add notes and send back a `.srev`.
- **Where:** `app/library.py` (`import_annotations` rewritten, `merge_replies`, `annotation_tombstones`, `set_review_status`, `asset_versions` / `version_key`, `_REVIEW_SQL` / `_OPEN_NOTES_SQL` in `list_assets` / `_clause` / `review_counts`, annotations re-targeted in `_migrate_asset`); `app/review.py` (`put_shot`, package `deleted`, `build_html` + template, replies in the PDF); `app/server.py` (`/api/assets/{id}/versions`, `/api/assets/{id}/review-status`, `/api/review/export/html`, `review=` on `/api/assets`, import returns `{added, updated, deleted, unchanged}`); new `app/static/compare.js`; `annotate.js` (replies, state row, versions row + carry-over, `gatherReport` shared by PDF / HTML, host hooks `openCompare` / `onReviewChanged`); `index.html` (`cmp` instance, `compareFromContext`, `K`, palette entry, card `.rv` pill, `REVIEW_ROWS` in `renderTypes`, `filter.review`).
- **Notes:**
  - Merge rules (see ARCHITECTURE "Review API"): ids are kept; per row the later *content stamp* wins (note: `data.edited_at` / `created`; drawing: `updated_at`) — NOT `updated_at` for notes, because replies and resolving bump it and a reviewer's stale copy would then overwrite newer text or revive a deleted note (found in review). Replies are unioned by id, the open/done state goes by `data.status_at`, tombstones travel in `pkg.deleted`. Clock skew between machines decides ties — accepted. `.srev` stays format version 1 (older Sight ignores `deleted` and gives rows fresh ids, as before). Notes edited before 0.17 have no `edited_at`: on a tie the local copy wins.
  - The review state is an annotation row (`kind='status'`) so it travels in packages; a merge can leave two status rows on one asset — readers take the newest, and `set_review_status` retires the others when the state is set or cleared. `validItem` in annotate.js skips it.
  - Independent review fixes also in this version: board shortcuts (canvas.js) are disabled while Compare is open; `K` on a board uses the board selection; a slow-seeking clip in Compare is not re-seeked every frame; an import is one transaction (bad rows → 400, nothing written); versions are looked up in the folder only, not its sub-tree.
  - Versions are only looked for in the same folder (no `v002/shot.mp4` sub-folder layouts) and only for image / video / PSD. Carry-over scales drawings by the pixel-size ratio of the two versions (asset width/height; unknown → 1).
  - Compare: no annotations inside it; no per-layer opacity; 3D models are not comparable. Every visible layer is a live `<video>` (tile + Difference adds a reference copy per cell), so many 4K clips will strain the decoder. The playhead is a wall clock — a stalled clip is re-seeked, not waited for.
  - The HTML page embeds every frame / screenshot as JPEG / PNG data URLs (a picture with one note ≈ 100 KB; long video reviews can be several MB). Reviewer edits live in that browser's localStorage, keyed by asset id + export time, until downloaded. The page shows the file's path (like the PDF).
  - Also fixed: annotations no longer get lost when a file is moved / renamed (they followed the old asset id).

## 0.16.2 — 2026-11-11 — Review files use the short `.srev` extension
- **What:** *Export → Review file* now saves `<name> review.srev` instead of `.sightreview`. Old `.sightreview` files still import (file picker, palette, drag-and-drop).
- **Where:** `app/review.py` (`PACKAGE_EXT`), `app/server.py` (`export_review_package`), `app/static/annotate.js` (Export menu label, file input `accept`), `app/static/index.html` (palette label, `pickReviewFile`, window drop regex), MANUAL / ARCHITECTURE.
- **Notes:** only the extension changed — the JSON inside is identical (`format: "sight-review"`, version 1), so no migration. Keep accepting `.sightreview` on import; files from 0.16.0–0.16.1 are already out there. Import checks the JSON `format`, not the extension, so the extension list only matters for the picker filter and drop detection.

## 0.16.1 — 2026-11-10 — Release builds for all platforms on GitHub Actions
- **What:** a tag `v<APP_VERSION>` — or a manual run (Actions → Release builds) with *Publish a GitHub Release* ticked, which creates that tag itself — builds Windows x64, macOS arm64, macOS x64 and Linux x64 on GitHub, smoke-tests each packaged app and publishes them as a GitHub Release. Manual runs (Actions → Release builds) and pushes that touch the build pipeline build without releasing.
- **Where:** new `.github/workflows/release.yml`; `build_exe.bat` (`if not defined CI pause`); `build_app_macos.sh` (Linux-aware closing message); README "Release builds on GitHub".
- **Notes:**
  - CI calls the same build scripts as a developer, so PyInstaller options live in one place per OS. If you add `--add-data` / `--collect-all` to one script, check whether the other needs it.
  - Smoke test: the packaged binary runs with `--no-browser --port 8799` and a temp `SIGHT_HOME`; it must answer `/api/state` with the version from `app/version.py`. The tag/version check fails the run on a mismatch, so bump `APP_VERSION` before tagging.
  - Runner labels: `windows-latest`, `macos-15` (Apple Silicon), `macos-15-intel` (GitHub's last Intel image; when it is retired, drop that row), `ubuntu-22.04` (older glibc so the Linux build runs on more distros).
  - The Linux build and its smoke test (plus a Cyrillic PDF export from the packaged app) were run in this container; the Windows and macOS jobs could not be run here — the first workflow run is their test.
  - PyMuPDF 2.x has no Intel-Mac wheel and its sdist fails to build (`pymupdf-lite` name mismatch), so both scripts pass `--only-binary pymupdf`: the Intel job gets the newest PyMuPDF that has a wheel, the others are unaffected.
  - macOS builds are not signed / notarized (no Apple certificate in the repo); release notes tell users the right-click → Open step.

## 0.16.0 — 2026-11-10 — Lightbox annotations and review sessions (draw, notes, screenshots, PDF / .sightreview)
- **What:** `A` in the lightbox (`Shift+A` in 3D) turns on annotation mode for images, PSDs, video and 3D models: a compact top toolbar (select, brush with pen pressure, pencil, highlighter, eraser, line, arrow, rect, ellipse, text, numbered pin, screenshot, region screenshot, undo/redo, onion, hide, panel) plus a second row with the current tool's or the selection's settings. All drawings are vector objects, editable later (move / scale / rotate / restyle / bend lines / re-edit text). A right panel collects review notes (text, reviewer, date, screenshots via `S` / `Shift+S`, resolve, delete); a note takes the unattached drawings on screen. Video: drawings and notes sit on a frame, markers on the timeline, `,` `.` frame step, `Shift+,` `Shift+.` marker jumps, hold time, onion skin. 3D: drawings belong to a camera view; notes also save shading/lights/explode/fov and restore them. Export: PDF report, `.sightreview` package (import by drag-drop, panel menu or palette; matched to the same media by path, else name+size), notes as text.
- **Where:**
  - new `app/static/annotate.js` (`createAnnotator`: tools, primitives → SVG + canvas, hit tests, transforms, undo, props bar, panel, markers, screenshots, export/import, keys).
  - new `app/review.py` (shots on disk, `build_pdf` via PyMuPDF `Story`, `build_package`, `parse_package`); routes `/api/review/*` in `server.py`.
  - `library.py`: `add_annotation` accepts a client `id` (revives a tombstoned row); `match_review_asset`, `import_annotations`.
  - `index.html`: `annot` instance + host hooks, `#annoBtn` in the lightbox bar, `annot.setAsset` in `showInLight`, `bind2d` / `viewChanged` in `attachViewer`, `bindAnnot3d` in `boot3d` (mesh + splat), `getView` / `setView` on `makeCameraRig`, `annot.onKey` first in the keydown handler, `syncLightHint`, `pickReviewFile`, window drop of `.sightreview`.
  - Fix in passing: `.light-frame > .view3d > canvas` is absolutely positioned — the px-sized WebGL canvas held the frame's grid track at its old width, so the 3D view never shrank (window narrowed, or now the review panel) and was cut off on the right.
- **Notes:**
  - Data model, coordinate spaces and hooks are written up in ARCHITECTURE.md → "Annotations / review". Board (canvas) annotations are still not built; the table already supports `scope='board'`.
  - Input is taken in the capture phase on the viewer surface with `stopImmediatePropagation`, so the viewer's pan/zoom (middle/right), scrub and orbit stay untouched; a capture-phase `click` guard stops a drawing gesture from also toggling video play. Don't move those listeners to bubble phase.
  - Text editor focus is set synchronously and the toolbar's `mousedown` is cancelled while editing — otherwise fast typing / clicking B lands in the tool shortcuts (`o` → ellipse, …).
  - Saves: create = `POST` per object (client id), edits debounced into `/api/annotations/batch`; updates and deletes await a pending create (`S.creating`) so they can't overtake the insert.
  - 3D views match by camera distance (0.4 %); damping is off while annotating (`annotating(on)`), and `setView` disables damping for one update so a restored view doesn't drift away. A note's `v3d` is applied live (`setV3D`) but not saved to settings.
  - PDF: client composes frames (`composeNative`: native image/video frame, or the 3D view) as JPEG data URLs; the server lays out HTML with MuPDF Story, whose fallback fonts cover Cyrillic. `max-height` is ignored by MuPDF, so images are sized by width (`_img_tag`). Export goes to `~/Downloads` (else `<SIGHT_HOME>/exports`) and is revealed; a missing file manager is ignored.
  - Not done: a `sight://` link / file association that opens a review from a messenger directly (needs launcher + OS registration, untested platform work) — the package file is the transport for now. No point-level stroke editing (Grease Pencil edit mode); strokes transform as a whole and the eraser can split them.
  - Checked with Playwright on an isolated `SIGHT_HOME` (images, video 24 fps, a GLB cube under SwiftShader): every tool, synthetic pen pressure, Shift snapping, bend, eraser + undo, rotate/scale/duplicate/copy/paste/delete, text re-edit, notes, both screenshots, frame stepping and markers, onion, 3D view switch + shading restore, PDF (image/video/3D) and package export + import (UI and API), no JS errors. Not checked: a real pen tablet, Windows/macOS file reveal, the packaged builds.

## 0.15.6 — 2026-11-10 — Grid thumbnails decode asynchronously again
- **What:** Reverts 0.15.4's `decoding="sync"` on grid thumbnails back to the original `async`. Nothing changes visibly.
- **Where:** `index.html` `fillThumb`; `docs/ARCHITECTURE.md`.
- **Notes:** `sync` was added against the scroll blink, but that blink was scroll anchoring (0.15.5), and `sync` made no measurable difference in the off-screen Edge runs. `async` was the deliberate original choice: a fast scroll or the first screen brings dozens of new thumbnails at once, and `sync` makes the frame wait until all of them are decoded (the decode itself still runs off the main thread), while `async` shows the frame and fills the images in. The lightbox keeps `sync` for an already-cached picture: that is a single image, swapped in place, where an empty frame is worse than a short wait.

## 0.15.5 — 2026-11-10 — Grid: no more blinking while dragging slowly (scroll anchoring)
- **What:** The library grid no longer blinks while it is scrolled slowly. At certain positions it flipped between two rows on every frame, and kept doing so after the scrolling stopped.
- **Where:** `index.html` CSS: `.grid { overflow-anchor: none; }`.
- **Notes:**
  - Root cause: Chromium's scroll anchoring. `renderGrid()` moves `.slice` (`top = startRow * rowH`) and replaces the cards above the view. Anchoring "corrected" `scrollTop` by one row to keep its anchor card in place. At the corrected position `startRow` changed back, the slice moved back, and the two flipped every frame. Seen in the owner's own window (two PrintWindow states alternating, content shifted by exactly one row). Reproduced in an off-screen Edge: scrolling 3 px per frame, `scrollTop` flipped 837 ↔ 1043 on its own (row 196 px + gap). With the fix, no flips in 400 steps.
  - Not related to the 0.15.2 speed-ups. The grid code had it before. 0.15.4's `decoding="sync"` was not this bug (reverted in 0.15.6).
  - Removed from `docs/PLAN.md`: the blink item. The "rows unpainted during very fast scrolling" seen in screencasts was most likely the same flip.

## 0.15.4 — 2026-11-10 — Splash closes with the window; thumbnails decode in sync; PLAN.md
- **What:** The "Sight is loading" splash now closes the moment the window shows, and a normal launch, which takes under ~1.7 s, does not show it at all. Grid thumbnails decode in sync (the blinking itself was a different bug, fixed in 0.15.5). New `docs/PLAN.md` lists the queued improvements and known bugs with their numbers.
- **Where:** `Sight.py`: `_close_splash()` in `main()`; `reveal_when_ready(..., on_ready=)` calls it right after the page's ready ping; `start_splash()` passes `-ShowAfterMs 1000`. `app/splash_screen.ps1`: `ShowAfterMs` parameter (sleep before `Show()`), "loading…" built with `[char]0x2026`. `index.html` `fillThumb`: `img.decoding = "sync"`. `CLAUDE.md` points to `docs/PLAN.md`.
- **Notes:**
  - Splash: the owner's test build (0.15.2) kept the splash up ~3 s after the window appeared. That was the 3 s window search fixed in 0.15.3, because the splash was closed only after it. Measured with that build: splash at ~0.7 s, window at ~0.85 s, splash gone at ~3.9 s. Now it is closed before the window search and maximize, so nothing there can hold it up. In 3 source launches it never appeared (window at ~1.3 s). Run alone, the script shows the form at ~1.5 s and is gone 20 ms after `terminate()`.
  - The literal "…" in the BOM-less `.ps1` came out as "â€¦" in Windows PowerShell 5.1, which reads such files as ANSI. Keep that script ASCII-only.
  - Blinking: it was not a regression of 0.15.2. Off-screen Edge runs against 0.15.1 and 0.15.3 showed the same counts. An in-page probe found no card or `<img>` replaced while on screen, in steady state or while the startup scan ran. What remains is Chromium painting a thumbnail empty for a frame: async decoding of images built off-screen (fixed here, the lightbox already did this for cached images), and raster lag during very fast scrolls (see PLAN.md).
  - Focus on launch (`SetForegroundWindow`) depends on Windows' foreground lock; see PLAN.md, bug 2.

## 0.15.3 — 2026-11-10 — Launch: the window opens maximized and focused again
- **What:** If Sight was maximized when it was closed, it opens maximized again, and the window gets focus on launch. Before, neither happened on this machine. The window came up at its normal size, behind whatever had focus.
- **Where:** `Sight.py`: new `_process_tree(root)` (Toolhelp32 snapshot through ctypes); `_find_browser_window(pids, user32)` now takes a set of pids; `reveal_when_ready()` passes `_process_tree(proc.pid)`; `close_browser(proc)` terminates the same tree instead of running a PowerShell WMI query by `--user-data-dir` (0.15.2).
- **Notes:**
  - Root cause: the Popen'd `msedge.exe` is a launcher. It starts the real browser process and exits within a second with code 0. The window belongs to that child, so looking for a window owned by `proc.pid` never matched. `reveal_when_ready()` then returned after its 3 s search without calling `ShowWindow(SW_MAXIMIZE)` or `SetForegroundWindow`. The page's own `moveIntoView()` still brought the window on screen, which hid the bug.
  - The tree includes processes whose parent pid is the launcher's, even after the launcher has exited. `close_browser()` terminates the launcher first, so it cannot start the browser after the snapshot.
  - Checked by launching Sight.py on an isolated `SIGHT_HOME`. With a saved `max: true` the window was maximized and in the foreground (it was neither before the fix). With `max: false` it was not maximized and in the foreground. A start that fails, tested with a `library.db` that cannot be opened, leaves no Edge process behind.

## 0.15.2 — 2026-11-10 — Faster startup and asset list; folder dialog stays on top
- **What:** Sight starts faster and the library list loads faster. Measured on this machine with a copy of the real library (1,028 assets): a source launch (Sight.py) shows its window after 1.4 s instead of 3.9 s; server start to the first `/api/health` takes 1.1 s instead of 2.75 s; one `/api/assets` page of 400 takes 7.5 ms instead of ~20 ms. Sight.exe skips the dependency check, so it gains less, roughly 0.7–1 s of ~2 s by the estimate below (not measured, no exe was built). The Add-folder dialog can no longer open behind the Sight window.
- **Where:**
  - `Sight.py`: `has_deps()` checks the running interpreter in-process with `importlib.util.find_spec` (`DEP_MODULES`); `bootstrap()` re-execs straight into `~/.sight/runtime` when its `.deps-v4` marker exists; new `listen_socket()`; `main()` opens the socket and starts the browser before the server imports, then `server.run(sockets=[sock])`; `launched` dict + `launch_lock` + new `close_browser()` close a browser window opened for a start that failed; the plain-tab fallback waits for `server.started` (`_wait_serving`).
  - `library.py`: `USDZ_CONVERTER_VERSION` (moved from `usdz_convert.CONVERTER_VERSION`); ffmpeg search in a thread (`_search_ffmpeg`, `ffmpeg_exe()`); `_thumb_v` cache in `thumb_version(aid, fresh=False)` and `_forget_thumb()`.
  - `server.py`: `/api/assets` returns a `JSONResponse`; `/api/state` uses `lib.ffmpeg_exe()`; the folder dialog's PowerShell gives `ShowDialog` a hidden top-most owner form.
  - `fileinfo.py`: the one `NO_WINDOW` constant, imported by `library.py` and `server.py` (review of 0.15.1: the flag was spelled out in four places).
- **Notes:**
  - Where the time went (before): the `python -c "import fastapi, …, pymupdf"` dependency probe took 1.4 s per launch, and a Sight.bat launch ran it twice (once before and once after the re-exec into the venv). Importing `usdz_convert` only to read its version constant pulled in numpy (160 ms). `imageio_ffmpeg.get_ffmpeg_exe()` runs `ffmpeg -version` (160 ms). The launcher polled `/api/health` before the server listened, and on Windows a connect to a closed port takes ~2 s to be refused, so each attempt sat out its 0.4 s timeout. That cost ~0.5 s before the browser was even started.
  - Browser in parallel: Edge from launch to the page's ready ping takes ~330 ms warm (750 ms the first time a profile is created). It now overlaps the ~0.6 s of fastapi/uvicorn imports and library setup instead of following them. Its first request waits in the listen backlog until uvicorn takes the socket. On Windows the window stays off-screen until the page has content anyway. If the start fails, `main()` closes that browser through `close_browser()` so no window is left off-screen, and `launch_lock` keeps the launcher thread from starting one after that. Checked with a `library.db` that cannot be opened: no Edge process is left. (0.15.3 replaced the way `close_browser()` finds the browser.) A tab in the user's default browser (no Edge/Chrome found) still opens only once the server serves.
  - `listen_socket()` sets `SO_REUSEADDR` like `free_port()` and uvicorn's own bind, so the same port is picked as before (localStorage, including the cached theme colour, is per port).
  - `has_deps()` with `find_spec` finds a package without importing it, so a package that is present but broken now fails at the real import with a traceback instead of triggering a reinstall. `importlib.invalidate_caches()` runs first, so the check right after a pip install sees the new packages.
  - Thumbnail versions: every path that writes a thumbnail must call `thumb_version(aid, fresh=True)` (`_make_thumb`, `save_uploaded_thumb`, `psd_composite` do), and every path that deletes or invalidates one must call `_forget_thumb()` (all former `_have_thumb.discard` sites do). A missing file (version 0) is never cached.
  - Folder dialog: a console-less PowerShell started by the background server has no window and no foreground rights, so an ownerless `FolderBrowserDialog` can open behind the browser. Not reproduced, only reasoned. The owner form is a standard WinForms pattern and was checked to construct.
  - Still slow, not changed (numbers from `python -X importtime` and cProfile): importing fastapi + pydantic takes ~400 ms and uvicorn ~290 ms, most of what is left of server start. `build_app` (route and pydantic model setup) takes ~100 ms. Edge's own start takes ~250 ms. The client pulls every asset page back to back (400 per request), which is ~125 requests for a 50k library. `import("three")` + GLTFLoader take ~45 + 60 ms on the first 3D open per session.

## 0.15.1 — 2026-11-10 — Windows: no console windows flash while thumbnails are built
- **What:** Adding video or audio files no longer flashes console windows on Windows. Each ffmpeg run for a video thumbnail, an audio thumbnail or a waveform opened its own console for a moment.
- **Where:** `library.py`: module constant `_NO_WINDOW`, passed as `creationflags` in `_thumb_video` and `_decode_peaks`. `server.py`: the same flag on the PowerShell folder picker in `pick_folder` and on the `cmd /c start` fallback in `open_path`.
- **Notes:**
  - The app runs windowless (`pythonw` / PyInstaller `--windowed`), so Windows gives every console child process a new console window. Any new `subprocess` call that runs a console program (ffmpeg, powershell, cmd) must pass `creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)`. The flag is 0 off Windows. `fileinfo.py` already did this, which is why the info panel never flashed.
  - `CREATE_NO_WINDOW` hides only the console. The folder dialog PowerShell opens still shows.
  - Left alone on purpose: `explorer` (a GUI program, no console) and the user-started `winget install` in `offer_ffmpeg_install` (behind `POST /api/install-ffmpeg`).
