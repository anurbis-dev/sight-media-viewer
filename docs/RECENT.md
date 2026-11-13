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

## 0.33.4 — 2026-11-13 — Canvas: a second row for the text's box colour and font
- **What:** on the drawing canvas (phone + HTML page) the *Text* row's box and font switches open
  a second row above it: no box / the box's colour (black, white, red, yellow, green, blue), and
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
