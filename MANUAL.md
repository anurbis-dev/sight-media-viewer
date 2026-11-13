# Sight — user manual

- **Sources** — add the folders you want browsed (sidebar → add source, or drag one in).
  Sight watches them live; nothing is imported or duplicated.
- **Search** — press `/` to jump to the search box (matches file names and tags). Moving the
  cursor onto a result takes focus off the search box, so Space previews it right away.
- **Command palette** — `Ctrl/Cmd+K`: run actions, jump to a kind/collection/file.
- **Filters** — sidebar lists kinds (image, video, audio, PSD, font, document, 3D model),
  tags and collections; click to filter, and drag assets into a collection to group them.
- **Tags** — select one or more assets and edit tags in the details panel.
- **Details preview** — the details panel shows only the file's thumbnail plus its info, for every
  type. Playback, waveforms, font/text previews and the 3D viewer are in the lightbox (Space /
  double-click).
- **File info** — in the lightbox press `I` (or the round *i* button in the top-left corner) for a translucent info
  overlay in the top-left corner, like Blender's viewport info. It shows the file's basics plus what
  only that type has: EXIF/camera data for photos, codecs/frame rate/bit depth for video, sample
  rate/channels/tags for audio, family/glyphs/axes for fonts, pages/metadata for PDFs, layers for
  PSDs, the Blender version for .blend, file counts and live mesh/triangle/texture stats for 3D.
  Video shows duration with the exact frame count, fps, codecs and the color profile (Rec. 709 /
  Rec. 2020, range, SDR/HDR). For 3D models it lists every material (as a shaded ball) and every
  texture (thumbnail, size, slot); click one to highlight in orange the polygons that use it,
  click it again to clear. The Materials, Textures and Meshes lists open on a click on their
  header (remembered) and scroll on their own (wheel or middle-drag).
  In the 3D view itself, **Ctrl+click** a part of the model to select its mesh (Ctrl+click it
  again to deselect); a click on empty space clears any selection. `F` frames the selection, or
  the whole model as it is now (exploded, minus hidden meshes), without turning the view.
  `H` hides the selected mesh, `Ctrl+H` hides everything else, `Alt+H` shows all meshes again.
- **3D toolbar extras** — **Ctrl+right-drag** over the model pulls its parts apart (explode, same as
  the slider at the right end of the toolbar). It works like a CAD exploded view: the largest part
  stays in place, every other part slides out along one axis of the model in a direction it can
  leave without passing through its neighbours, parts go together with the part they sit on, and
  groups from the file's hierarchy separate first and then come apart themselves. Next to the 90° turn button: Floor, Grid, Shadow only
  (an invisible floor that still catches the shadow) and the light anchor — globe = lights fixed
  to the world, camera = lights follow the camera. The gear panel has the camera's field of view
  and the Solid shading material (color, metallic, roughness).
- **UV editor** — in the lightbox of a 3D model press `U` (or the *UV* button at the left end of the
  bottom toolbar): the view splits into the UV layout on the left and the model on the right; drag the
  divider to resize. The UV side pans/zooms like an image (middle-drag, right-drag, wheel, 1–9,
  double-click); `F` fits whichever side is under the cursor. It shows the UVs of the selected
  material / texture / mesh from the info overlay (in orange) over its base-color texture, or all
  UVs when nothing is selected. The UV side has its own bottom toolbar: *UV1 / UV2 …* to pick the
  UV set (shown when the part has more than one) and a channel list for the texture —
  RGB, RGBA (over a checker), R, G, B or A as grayscale.
  It stays open while you flip through files and is remembered next time.
- **PSD layers** — in the lightbox of a PSD press `D` (or the ☰ button bottom-right) for the layer
  list; click a layer to view it alone, "Composite" to return to the full image.
- **Annotations & review** — in the lightbox of an image, PSD, video or 3D model press `A`
  (`Shift+A` in 3D, where A flies the camera) or the pen button in the top bar. A compact toolbar
  appears at the top with a second row that always shows the settings of the current tool — or of
  the selected drawings, which stay editable: every drawing is a vector object you can select, move,
  scale, rotate, restyle and delete at any time. In a 3D model a note shows a picture of each camera
  view its drawings were made from (its own view first), like a video note's frames; click a picture
  of another view to go to it. Hold **Alt** with a drawing tool to work the picture without switching to
  the select tool: a drag orbits a 3D model or scrubs a video (sideways on the picture), and the toolbar and
  the notes panel stop taking the pointer until Alt is let go. With the select tool Alt keeps its own
  duplicate-drag.
  - Tools: `V` select · `B` brush (pen-tablet pressure changes the width) · `P` pencil ·
    `M` highlighter · `E` eraser (whole object, or *Partial* to cut through strokes; the pen's
    eraser end erases too) · `L` line · `W` arrow · `R` rectangle · `O` ellipse · `T` text ·
    `N` numbered pin. `[` / `]` make the brush / width smaller / larger.
  - Shapes: stroke on/off, width, dash (solid / dashed / dotted), fill on/off, fill colour and
    opacity, corner radius (rectangle), overall opacity. Lines and arrows: start and end heads
    (none, triangle, open, diamond, dot, bar), straight / curved / elbow body, head size; drag the
    middle handle of a selected line to bend it. Text: font, size, colour, bold / italic / underline,
    alignment, background box (colour, opacity), outline; double-click a text to edit it again
    (`Ctrl+Enter` or Esc finishes).
  - While drawing: `Shift` snaps lines, arrows and straight brush strokes to 15° steps (0/45/90…),
    makes rectangles square and ellipses round. Select tool: click /
    Shift+click / drag a box to select, drag to move (Shift locks the axis), Alt+drag duplicates,
    corner handles scale (Shift keeps the ratio), the round knob rotates (Shift: 15° steps) — while
    you turn it the knob follows the pointer out from the centre, so pulling it further away turns
    more finely; arrows nudge (Shift ×10). Hold `Ctrl` with any drawing tool to erase for a moment;
    the bin in the toolbar (`Shift+Delete`) clears the drawings on screen in one step (undo brings
    them back). `Ctrl+Z` / `Ctrl+Shift+Z` undo / redo, `Ctrl+C` / `Ctrl+V` / `Ctrl+D`,
    `Delete`, `Ctrl+A`, `Ctrl+[` / `Ctrl+]` back / front. Middle- and right-drag still pan and zoom.
    A drawing already added to a note is fixed: it can be deleted from the frame, but not moved,
    scaled, restyled, nudged, reordered, partly erased or retyped. Only drawings not yet added are editable.
  - **Review notes** — the panel on the right (`C`) collects notes. Type and press Enter: the note
    takes the drawings currently on screen that aren't attached to a note yet, plus every loose
    drawing you made since opening the file on other frames of a video or other views of a 3D
    model — one note can hold pictures of several frames / views (as vector drawings, shown on a
    picture of each frame in its card; click one of the other frames to go to it; the PDF / web page
    show every frame / view). A card's pictures — its frames and screenshots, a reply's too — are
    small equal squares, each cut to fill (as in the phone app), as many to a row as fit; right-drag up
    / down on the list makes them bigger / smaller (like the thumbnails in the library grid), kept, the reviewer name (field at the top), and the date. While a new note is being made — you draw, or type in the field — the picture is clean:
    other notes' drawings are hidden until the note is added. *All / Open / In progress / Resolved*
    above the list filter the notes. `S` adds a screenshot of what you see, `Shift+S` one of an area
    you drag out; they go into the note you are writing. Click a note to jump to it (only its drawings
    show; click it again, click empty space in the list, or Esc to see all; hovering a note does nothing to the picture; right after you make a note the picture is clean, and that note's drawings come back when you click its card or a video / 3D preview frame in it), double-click its text to edit, the clock marks it *In progress* (someone took
    it), ✓ resolves it, the bin deletes it with its
    drawings. Alt+click a screenshot in a note removes it. The arrow button on a note adds a
    **reply** (Enter sends); double-click a reply to edit it, × deletes it. Resolving or reopening
    a note — or marking it in progress — adds a line to its thread (*✓ Resolved by Anna · date*), so
    the history shows who did it and when; these lines cannot be edited or deleted. Pictures a
    reviewer attached to a reply (on the web page) show under it; click to enlarge. A reply that
    came with drawings (made in the mobile app or on the web page) shows them on a picture under it
    and an eye with their count: click it to hide / show those drawings; deleting the reply (or the
    note) deletes its drawings too.
  - **Review state** — the *State* row at the top of the panel marks the file *Needs review*,
    *Changes* or *Approved*. Under it: who set the state last and when; *History* lists every
    change. The grid shows it as a pill on the card together with the number of open
    notes, and the sidebar (under Types) gets *Open notes / Needs review / Changes requested /
    Approved* rows that filter the library.
  - **Turn / mirror the view** — `Shift+R` turns a picture or video by 90°, the mirror button at
    the top of the viewer (`Shift+M`) mirrors it; Sight remembers it per file. Only the
    view changes: the file and the drawings on it stay as they are. Mirror and the annotate
    button show only for pictures, PSDs and video (annotate also for 3D models); documents hide them.
  - **Turn by hand** — Alt+drag on a picture turns it about its centre, to any angle (on a video Alt+drag
    scrubs; Ctrl+Alt+drag turns the video); hold
    Shift to snap to absolute 15° steps (0, 15, 30 …). Sight remembers the angle per file.
  - **Versions** — files in the same folder whose names differ only in a version token
    (`shot_v001`, `shot_v002`, `shot.v3`, `shot_rev4`, `shot_r5`; a name without one counts as the
    first) are versions of each other. The panel shows *Version 2 of 3* with ‹ › to step through them
    and *Compare*. When the previous version still has open notes, *Copy here* brings them over
    with their drawings (scaled if the size changed; the note says where it came from).
  - **Video** — drawings and notes belong to the frame they were made on, and show as markers on the
    timeline (red = note, orange = in progress, green = resolved, yellow = drawing). Click a marker to go there. `,` / `.`
    step one frame, `Shift+,` / `Shift+.` jump to the previous / next marker (these work outside the
    annotation mode too). *Hold* in the tool settings keeps new drawings visible for 0.5–2 s or the
    whole clip; the onion button shows drawings within ±1 s faded.
  - **3D** — a drawing belongs to the camera view it was made in, and a note also saves the shading,
    lights, explode and field of view. A view also keeps which meshes were hidden (H / Ctrl+H / Alt+H)
    when it was made: a change of hidden meshes starts a new view, and going back to a view shows its
    meshes as they were. Orbiting away hides the drawings; the numbered *Views* chips at the top of the
    panel, or a click on the note, bring the camera, settings and meshes back. The chips and the
    pictures of a note are numbered in the order the views were made. A note's pictures are stills taken
    once per view: turning the light or the shading does not redraw them (the drawings on them do follow
    the view). Explode is kept too: a note's pictures and exports stay at the explode it was added at, and
    clicking the note goes back to that explode. Moving the explode slider (or Ctrl+right-drag) changes only
    the view you are on while it holds no added note; a drawing not yet added takes the slider's amount when
    its note is added. If the view already has added notes, the slider cannot move it, so a new note made at
    the changed explode starts a new view with its own chip. Going to a view by its chip puts the view's
    explode back. An older drawing has none.
    While annotating, left-drag on
    empty space with the select tool orbits. The zoom settings (Speed, Drag axis, Invert) apply to the 3D
    camera too — the wheel and right-drag — as they do to images, video, text and version compare.
  - **Export** (panel → Export): *PDF report* (every note with its frame / view and screenshots —
    a note's pictures side by side in rows under its words, then its replies — saved to Downloads and shown in the file manager; each video frame is captioned with its file name and frame number, e.g. "clip.mp4 · frame 24", and carries the frame number in its top-left corner), *Review file (.srev)* — one file with
    all drawings, notes and screenshots to send by mail or messenger; whoever opens it in Sight
    (drag it onto the window, the same Export menu → Import, or the palette "Import review file")
    gets the review on the same media file, found by path, else by name and size. Importing
    **merges**: the same file twice changes nothing, a file that went to someone and came back adds
    their replies / new notes / resolved states, and what was deleted on one side is deleted on the
    other (unless it was edited there later). *Web page for reviewers (.html)* — one file that opens
    in any browser, on a phone too, no Sight needed: the picture / frames with the drawings, every
    note, screenshot and reply. The picture on top is the original; each note shows its frame with
    its drawings, and every picture in a card is shown at full width. The page first asks the reviewer's name (nothing can be done
    without it; *You: … ✎* changes it). The title, who sent the page, and the *All / Open / In
    progress / Resolved* filters with their counts stay pinned at the top; tap the title (or the
    arrow) for the file details and the review-state history. *Reply* opens a message field (paper
    clip attaches pictures, the paper plane sends) with *Mark as In progress / Resolved / Reopen*
    above it — a state can be sent alone or with the reply, and is logged in the thread like in
    Sight. A field left empty closes when you tap anywhere else. A new note starts from the blue
    *+* in the bottom bar (one at a time; it can carry pictures too). Unsent entries have × to take
    them back. Tap a picture to view it full screen: swipe left / right (or ← / →) for the next
    or previous one — the picture and the note frames form one row, a note's attachments (its own
    and its replies') another — and swipe up / down, tap or Esc to close. Right-drag (mouse, or the pen's side button) zooms
    as in Sight, so do the wheel and a double-click; drag to pan while zoomed in. **Drawing**: the pencil
    in a message field (or *✎ Draw* in the full-screen viewer) opens a full-screen canvas over the
    note's frame (a new note: over the picture, or — video / 3D — over a note frame you pick; the
    new note then sits on that frame). A new note or a reply is drawn on the clean picture. Tools:
    select / transform (`V`: tap or drag a box to select, drag to move, handles scale, the round knob
    rotates and follows your finger out from the centre for finer turns; a colour recolours the
    selection), brush (pen pressure), highlighter, arrow, rectangle, ellipse, text (tap where it
    goes, type; tap your text again to change it, empty it to remove it), eraser (or hold Ctrl),
    five colours, undo / redo (Ctrl+Z / Ctrl+Shift+Z), the bin (deletes the selection, else clears
    everything drawn here), *Done* / *Cancel*. Two fingers zoom, pan and turn the picture (a
    quarter turn snaps); the top bar turns it 90°, mirrors it and fits it back. Once you have drawn
    with a pen (Apple Pencil, stylus) the pen draws and a finger pans; with a mouse the wheel and
    right-drag zoom, the middle button pans. The drawing goes with
    the reply as vectors and shows in Sight on that frame / view under the reply's eye toggle. Tap
    an attached picture in the field (or *✎ Draw* on an attachment in the viewer) to draw over a
    copy of it instead — that one is sent as a flat picture. The pencil next to the search shows
    or hides *My drawings* / *Others' drawings* on the page. Everything
    stays in that browser until *Download reply*; importing that `.srev` file brings it all in. *Download page*
    saves the same page with your changes in it (it opens in any browser, with the replies, notes and drawings
    already there, and can be answered and downloaded again); Sight does not import that file — send the `.srev` back for that. *Copy notes as text* puts a numbered list with timecodes on the clipboard.
- **Phone app (Sight Review)** — review pictures and videos on a phone or tablet, offline, without
  Sight: open the app's link (GitHub Pages of this repository) in Safari → Share → *Add to Home
  Screen* (Android: *Install app*); it then starts like an app and works without network. Reviews
  made in Safari before installing stay in Safari. *Photo or video* picks from the library / camera
  roll, *Open a file…* from Files (pictures, videos, or a `.srev` someone sent). Nothing is
  uploaded: the review lives on the device. The app asks your name once (Settings ⚙ or the ⋯ menu
  changes it). The review is a full-screen player: a header over the picture (no background, the
  picture shows through) holds ← (all reviews), the name, ⋯, and a row with the eye (hide
  drawings) and mirror (the full-screen view and the canvas follow; the drawings stay put on the
  picture) in the middle of the bar and, when the view is zoomed, *Fit* at its right end; at its
  left end the button that hides every control (header, transport, pencil, Notes Panel bar) — only
  a round button in the top left corner is left, which brings them back; the gestures keep working.
  Two fingers on the picture pan, zoom and turn it (as on the drawing canvas — on both, letting go
  smaller than the screen, or nearly at fit and straight, goes back to fit with the turn to the
  nearest quarter); a swipe down goes
  back to the list of reviews. Under the picture the thin **Notes Panel** bar: tap it (or swipe up
  on it / on the picture) and the player slides up off the screen and the notes come in; the bar
  then holds the filters (All / Open / In progress / Resolved) — a swipe left / right on the list
  steps to the next / previous one; a playing video pauses where it is. A tap on a note selects it
  (the accent frame) and puts the player on the first frame of its drawing; a tap on one of its
  pictures selects it and opens the picture full screen (Back leaves the player on the frame last
  looked at); stepping to a note's marker selects it too. A
  lighter frame marks the notes on the frame shown now. A note's pictures (its
  frames, attached pictures; a reply's too) are equal squares in a row, each cut to fill its
  square — Settings → *Pictures in a row* (3–6, 4 by default); a reply's drawing shows on the
  reply's pictures only, not on the note's. Pull the list down when it is at
  its top note to go back to the player. *+ Note* shows only with the panel open. The pencil
  (*Draw a note*) floats at the bottom right of the picture — on a video just above the
  transport — the same place as in the full-screen view, for pictures and videos alike. On a video the transport sits over the foot of the picture: ‹ › previous / next marker
  (notes and frames drawn on), ◀ ▶ one frame back / forward, the timecode and frame number with
  the frame rate ("25 fps") on its left and the sound on its right, then the playing mode — once (stops at the
  end; the default) or loop, a tap switches, kept on the device — and a timeline with the markers. The
  frame rate (≈ while the app is still measuring it) is also the speed: drag it up / down to play
  faster / slower (the number shows the rate it plays at, in the accent colour when not the
  clip's own), tap it for the nearest common rate (24, 25, 30, 12, 15…), hold it for the clip's own
  speed. The speaker: drag it up / down for the volume from where it is (a thin bar at the screen's
  left edge shows the level; kept on the device), tap it to mute / back to full volume; grey when the clip has no sound
  (iPhone / iPad Safari only mutes / unmutes). The canvas' transport has both too. The timeline (tap / drag anywhere; near a marker it lands on it). Drag left / right
  across the picture to scrub from where the clip is (a frame per few pixels, faster when you move
  faster; Shift with a mouse = finer) — the clip's length no longer spreads over the screen's
  width; after opening, the app runs through the clip once and keeps small frames in memory (the
  green line in the timeline), so the picture follows at once. Tap the picture to play / pause
  (keyboard: Space, `,` / `.` or ← / →, Shift+← / → for markers); play starts from the frame on
  screen, also right after a scrub. Notes are listed and numbered in
  the order they were made (on a video too — not by frame; Sight numbers them the same). *+ Note*
  adds a note — on a video at the frame on screen; while it is open the picture is clean (only its
  own drawing) and so is the timeline (only the frames it is drawn on). The pencil opens the drawing canvas (select / transform, brush with pen pressure,
  highlighter, arrows and lines, shapes, text, eraser, the colour, undo / redo, clear, pinch / pan /
  turn), its buttons floating over the picture. A tap on *Arrows and lines* or *Shapes* takes it and
  shows its kinds in a row above the bar (arrow, open arrow, double arrow, dashed arrow, line /
  rectangle, rounded, ellipse, filled rectangle, filled ellipse — and at its end the fill colour:
  a second row with the line's own colour (lighter, the default) or one of six; picking a colour
  with an outlined shape in hand takes its filled kind): tap one to draw with it, or just
  draw — the row folds and the tool stays; tapping the slot again with its row up puts the tool
  down. *Text* has a row of switches: bold, italic, underline, the box behind the text, outline,
  alignment (left / centre / right) and font; switched on, the box shows its colours in a second
  row above (tap it again: no box), the font button opens the fonts there (sans, serif, mono,
  hand, impact). They style the
  text being typed and the next ones; with the select tool and texts selected, a tap on *Text*
  shows the row for those texts (the tool stays select; `T` takes the text tool). The colour is the circle at the bar's right end: a tap shows the colours above it. Opened from the player, the picture stays exactly
  where and as big as it was (zoom and turn too) — drawing only brings the tools up; closing keeps
  the view. Press and hold with a tool, then drag up / down: that tool's size (a circle on the
  left shows it); with the select tool and a selection, hold and drag up / down for the line width,
  sideways for the opacity; hold with a drawing tool and drag sideways: its opacity (right = more
  solid; the circle and the "px · %" under it show it; kept like the size). Press and hold a
  tool's button: its default size and opacity. Tap with two fingers
  to undo, with three to redo. On a video the canvas has the timeline at its
  foot: tap the tool in hand to put it down (no fill), then drag the picture or the timeline / the
  step and marker buttons to another frame — or tap the picture to play and tap again to stop on
  a frame (the drawings of each frame show as it plays; taking a tool up stops it) — take a tool
  again and draw there — as many frames as
  you like; *Done* makes them one note (its card shows every frame drawn on). Each note has
  *Reply* (text, pictures, a drawing, *Mark as In progress / Resolved / Reopen*; on a video note
  the panel goes and the reply is written in the bar over the player, which stands on the note's
  first frame — its frames are on the timeline and as chips to tap, and the pencil draws on any
  frame you move to, as many as you like, e.g. one the note forgot; closing it or sending leaves
  the player on the frame reached and the note lit in the list; a picture note's reply opens under
  it and draws on its picture),
  *Resolve* / *Reopen*, and ⋯ for *Edit text*, *Edit the drawing* (a video note: all its frames),
  *Mark in progress*, *Delete*; a reply's ⋯ has *Edit text*, *Edit the drawing* (*Draw on it*; on a
  video over the player, any frames), *Add pictures…*, *Remove its pictures*, *Delete reply…* (an
  edited reply says so). Tap a timecode to go to that frame, a picture to
  view it full screen (pinch / double-tap to zoom; at full size a swipe left / right — or ← / → —
  goes through the whole note: its frames, its attached pictures, then each reply's drawings and
  pictures, the caption telling which ("0:01.05 · f 30 · 2 / 7", "↳ Bob · Picture") with the note's /
  reply's words under it — up to three lines, more scroll inside the caption; a swipe up /
  down shows the next / previous note — the picture goes on the way you swiped, fading out, and the
  next one follows it in like a strip, fading in; the round ← Back button leaves — no swipe does; the pencil
  draws a reply on it; back in the review the player stands on the frame you left on). Settings (⚙ on
  the home screen, or ⋯ → *Settings*) has the theme: Auto (the system's), Light, Dark — the player
  and the notes share it — and *Full screen*: Auto (the default — the app goes full screen at the
  first tap in a browser tab; left with Back, it comes back on the next screen) or Off. Safari on
  iPhone / iPad does not do it; the installed app (Add to Home Screen) is full screen anyway. The eye hides the drawings on the picture. (The file's review state —
  Needs review / Changes requested / Approved — is set in Sight; the app keeps and exports it.)
  ⋯ menu: *PDF report* and *Web page (HTML)* — the same content as Sight's PDF report (pictures /
  frames with the drawings, every note, reply and picture; in the PDF a note's pictures sit side by
  side in rows), plain files anyone can open; *Review
  file for Sight (.srev)* — drag it into Sight to merge everything (Sight finds the file by name and
  size); *Merge a review file…*; *Share…* sends a finished file to Files, mail or a messenger. On the home screen, tap a review's
  picture to open it; a tap on the review itself picks it (a tick on the picture; tap again to drop
  it) — with reviews picked, the bar at the foot has *Move to…* (into a group, a new group of them,
  out of their groups), *Hide*, the bin (delete them) and ×; a picked review swiped left / right
  takes the other picked ones along, and the bin / eye it uncovers deletes / hides all of them. Swipe a review
  left to uncover the bin (tap it to delete the review), right to uncover the eye (tap it to hide
  the review for now — until the app is closed, or *Show* under the list); press and hold a review
  and drag it up / down to move it in the list (the order is kept; new reviews come first); let go
  without moving for its menu. Drag it onto the middle of another review (it lights up) and let
  go: the two make a group (named by what their names start with — hold the group for *Rename…*,
  *Picture…*, *Ungroup*); drop more onto the group's header to add them. A review in a group can
  be dropped the same way onto another group's header or onto one of its reviews (it moves
  there), or onto a review on its own (a new group); a picked review takes all the picked ones with
  it. A group's row counts open / in progress / resolved notes over all its reviews; its picture
  is its first four reviews', or (*Picture…*) one of its reviews' pictures or cached frames, or a
  colour. Tap a group's header to open / close
  it; hold and drag it to move the whole group; inside, reviews swipe and move as in the list, and
  a review's menu has *Move to…* and *Take out of the group* (a group of one goes away). The two big open buttons show only while there is no review yet;
  after that they are the two small icons next to ⚙.
  Opening a `.srev` from Sight makes (or updates) the review of that file; pick the file once to
  see it. The app remembers the file you picked (it keeps a copy on the device — a web app
  gets no lasting access to a picked file) and opens the review with it next time; ⋯ → *Forget the
  file on this device* frees the room. When there is no copy (it was forgotten, the device was
  short of room, or the review came from a `.srev`), the review shows *Pick the file*. Notes and
  their frames stay readable without the file. For a round trip with Sight, open the
  original from Files (*Open a file…*): the Photos picker hands over a converted copy (HEIC becomes
  JPEG, video may be re-encoded), whose name / size Sight does not know. Press and hold a review in
  the list to delete it. When a new version of the app is out, a bar offers *Reload*.
- **Compare versions** — `K`: in the grid with two or more images / videos selected, compares
  those; with one selected or under the cursor (or in the lightbox), compares the versions of that
  file (see *Versions* above). Also the palette and the review panel's *Compare* button.
  - Layouts (`1`–`4`): **Swipe** — all layers stacked in one view and cut by split lines, one
    region per layer; drag anywhere to move the nearest split (Alt+drag pans), `V` switches between
    side-by-side and top / bottom splits. **Tile**, **Row** (horizontal strip), **Column** (vertical
    strip) — one cell per layer.
  - Blend: **Over** shows the layers as they are; **Difference** (`D`) draws each layer as the
    difference to the reference layer (★, `R` makes the selected layer the reference) — identical
    pixels turn black, so any change stands out. Works in every layout.
  - Layers bar at the bottom: click selects (`↑` / `↓`), ☆ reference, ◉ show / hide (`H`), drag a
    chip to reorder, ⤢ opens the file in the viewer, × removes, *+ Add* brings in another version.
  - Video: one timeline for all clips, played in sync (`Space`, `,` / `.` frame, `Shift` ×10,
    `Home`, `L` loop). Each clip has a **first-frame offset** (− / + on its chip, click the number to
    type it, or `[` / `]` for the selected clip, `Shift` ×10): where its first frame sits on the
    timeline, to line up clips that start or run differently. The coloured bars on the timeline show
    each clip's span; 🔈 picks whose sound plays.
  - Wheel zooms around the cursor, right / middle drag pans (left drag in the tile layouts),
    double-click or `F` fits, `0` shows the reference at 100 %. `Esc` / `K` closes.
- **Missing files** — files that were moved or deleted stay in the library as "Missing" (sidebar),
  and show up right away (no need to switch views/sources to see it — the grid updates live).
  To clear them out: hover the Missing row and click 🧹 (whole library), run "Remove missing files
  from library" in the palette (whole library), or right-click empty grid space (no selection
  needed) → "Remove missing files" — that one is scoped to whatever filter/search is currently
  active, so it only touches what you're looking at. Only the library entries go (with their tags,
  ratings, notes and collection membership) — nothing on disk is touched. A file that is back at
  its path is restored instead, and entries from a source folder that can't be reached right now
  (unplugged drive) are kept.
  A file moved to another folder (even a different source) is recognized rather than treated as a
  delete-plus-new-file, as long as its name and size still match exactly one missing entry — its
  tags, rating, note and cached thumbnail carry over to the new location. Moves inside a watched
  folder are caught live; moves across sources or made while Sight wasn't running are caught on
  the next scan of the destination (right-click a source → Force rescan) or when you clear missing
  files. A genuine rename (same folder, new name) isn't matched this way — matching is by name, so
  a changed name looks like a different file — except when caught live by the watcher, which knows
  the exact old/new pairing and always carries the metadata over.
- **Reveal in File System** — right-click → "Reveal in File System" (or "Reveal" in the details
  panel) shows the selection in Explorer / Finder: one window per folder, with every selected file
  in that folder selected.
- **Find in Folder** — right-click → "Find in Folder" (library grid or a board) jumps the library to
  where the selected files live and selects them there. One folder opens that folder; files from
  several subfolders of one source open the deepest folder that holds them all (the folder view
  includes subfolders); files from different sources open "All". The sidebar tree unfolds to the
  folder, search and type filters are cleared, and the grid scrolls to the first file. Both commands
  are also in the palette.
- **Force rescan** — right-click a source in the sidebar → "Force rescan" to walk its folder again
  right away, instead of waiting on the live file-watcher (useful after changes on a network share,
  or to reconcile a move immediately — see above).
- **Refresh thumbnails** — thumbnails are cached once made. To force new ones for the current
  selection (stale or black-backed tiles), use the ⟳ button in the details panel, "Refresh
  thumbnail(s)" in the right-click menu, or "Refresh thumbnails of selection" in the palette.
- **Preview** — double-click an asset, or point at it and press Space, to open it full-screen.
  Space always previews the thumbnail under the cursor, whatever is selected, and leaves the
  selection as it was. ←/→ move to the next/previous asset and ↑/↓ move one row up/down in the
  thumbnail grid; `D` toggles the details panel; drag up/down on the grid resizes tiles.
  `Esc` closes the preview; with none open it clears the thumbnail selection.
  Opening or stepping onto a heavy asset (a 3D model, a PSD, anything over 100 MB) with Space or
  the arrow keys has a short cooldown (~0.7 s), and holding the key down does nothing — so a burst
  of presses can't pile up loads. Light assets like images are never throttled.
- **Mask and corner radius** — the ◱ button in the full-screen preview's top bar opens a popover:
  pick a mask (16:9, 4:3, 1:1, 9:16, … or Circle) to clip the preview to a frame of that shape, and
  set the frame's corner radius. "Full" with radius 0 is the plain edge-to-edge preview. Works for
  images, video and 3D models alike; the choice is saved with the theme. With a radius set, the corner
  icons (info, 3D gear, video strip) move in from the corners so the rounding does not cut them.
- **Settings are remembered** — every option (Settings panel, 3D viewer rig, saved camera views,
  tile size, inspector/sidebar sections) and the app window's position, size and maximized state
  are saved to `settings.json` in the Sight data folder (`~/.sight`, or `SIGHT_HOME`) and come
  back on the next launch, whichever port or browser profile it opens on.
  **Reset all to defaults** (Settings panel, or `Ctrl/Cmd+K`) puts the theme, 3D viewer settings and
  tile size back to the app defaults; your saved views, model turns and named themes stay.
- **Color picker** — clicking any color swatch (theme colors, 3D viewer colors, icon color) opens
  a small picker next to it: drag in the square for shade, on the strip for hue, type a hex code,
  or use the eyedropper to pick a color from the screen. Changes apply live. It closes when the
  cursor moves away from it, on a click elsewhere, on `Esc`/`Enter` (in the hex field), or on a
  second click on the swatch.
- **Canvas (boards)** — the **Canvas** section in the sidebar holds boards: free-form moodboards.
  `+` creates one; click a board to open it, click it again to close. Double-click a board to rename
  it, right-click it to change its icon/colour, drag rows to reorder. A board opens **beside the
  library** so you can drag files from the grid onto it (the header button ◧ hides/shows the library
  pane; drag the divider to resize it — the size is remembered — and double-click the divider to
  switch between side by side and stacked). The same asset can be placed on a board any number of times.
  - **Move around:** middle-drag (or Alt+drag on empty space) pans, mouse wheel pans, Ctrl+wheel or
    right-drag zooms — the same zoom controls as the full-screen preview. `F` frames the selection
    (everything if nothing is selected), `A` frames everything. Pictures are shown from their small
    library thumbnails so large boards stay fast; zoom in on one and it switches to the original file
    (JPEG, PNG, GIF, WebP, BMP, AVIF, PSD) a moment later, and back to the thumbnail when you zoom out.
  - **Select:** click, Shift/Ctrl-click, or drag a box (plain drag replaces the selection, Ctrl-drag
    toggles, Ctrl+Shift-drag adds — same as in the library, and it also works when you start over an
    item). `Ctrl+A` selects all in the pane you last used. `Esc` clears.
  - **Right-click** an item (a click, not a drag — right-drag still zooms) for Find in Folder, Reveal
    in File System and Open Natively. It acts on the selection; an unselected item is selected first.
  - **Transform:** one frame with a resize handle that sits on whichever corner the cursor is nearest (the
    opposite corner stays put; Shift keeps the picture's proportions) and a
    knob above (rotate; Shift = 15° steps). With several items selected the frame is common to all and
    scales / rotates them together. Hold Ctrl while moving or resizing to snap to the dot grid.
  - **Crop (non-destructive):** hold **Alt** over an item — grips appear on its edges and corners; drag
    one to crop that side (the picture stays where it is; drag back out to restore). **Alt+drag on the
    picture** slides it inside the crop. Resizing a cropped item keeps its proportions; **Shift** while
    resizing removes the crop. The original file is never touched.
  - **Edit:** `Ctrl+D` duplicates (a new instance of the same file), `X` / `Delete` removes from the
    board, `Alt+X` / `Alt+V` mirror horizontally / vertically, `[` / `]` move one layer back / forward,
    `↑` / `↓` bring to front / send to back, `Ctrl+Z` / `Ctrl+Shift+Z` undo / redo.
  - **Arrange (PureRef's shortcuts; act on the selection, or on everything if nothing is selected):**
    `Ctrl+←/→/↑/↓` align left/right/top/bottom (items stop against each other, they don't overlap);
    `Ctrl+Alt+←/→/↑/↓` normalize height / width / size / scale; `Ctrl+Alt+Shift+↑/↓` distribute in a
    row / column; `Ctrl+P` arrange optimally to fit the view; `Ctrl+Alt+N/A/O/D/R` arrange by name /
    addition / layer order / path / randomly (press again to reverse); `Ctrl+Alt+S` stack.
  - Boards, their items, crops and the camera position are saved automatically.
- **Excluding folders** — the × next to a subfolder removes it from the library; everything
  under it goes with it, so its subfolders aren't listed while it's excluded.
- **Ignore list** — Settings → Scanning → Ignore skips files and folders by name in every source,
  one pattern per line, then *Apply*: `*.meta` or `Thumbs.db` (a file or folder name anywhere,
  `*` `?` `[..]` wildcards), `Library/` (folders only), `Library/PackageCache` (that folder path
  anywhere), `#` for comments. Case-insensitive. Hidden files keep their tags and ratings and come
  back when the pattern is removed. `.obj` files that are compiled code (Unity BurstCache, Visual
  Studio build output) are skipped automatically — they are not 3D meshes.
- Video in the full-screen preview: drag on the picture (or the timeline) to scrub — dragging
  across the window covers the whole clip, hold `Shift` for fine control; `Space` plays/pauses.
  The green strip on the timeline is the RAM cache: a window around the playhead whose size is
  set in Settings → RAM cache (32–2048 MB) and which slides as you play or scrub.
- Video the browser cannot play (old `.mpg` / `.mpeg` / `.vob`, DivX / Xvid, WMV, FLV and similar)
  is converted once to an H.264 copy: the viewer shows "Converting for playback… N%" and then plays
  it. The copy is kept in the library's `thumbs/video` folder (about the size of the original), so
  the next open is immediate. Delete a file's copy from that folder to make it again.
- Video gets automatic thumbnail stills (needs ffmpeg — bundled in the standalone builds,
  otherwise Sight shows an "Install" banner if it can't find one). PSD opens per-layer;
  fonts get a live specimen; 3D models get an interactive viewer (drag to orbit,
  Shift+right-drag to turn the light, Shift+1–4 to switch shading, Shift+5/6 to toggle wireframe/x-ray,
  Shift+7 to turn the model 90°, `G` for the view-settings panel). The toolbar shown over the
  viewer belongs to the asset's type — images, fonts etc. don't get the 3D one. The explode
  slider only appears for models made of several parts; while parts are pushed below the floor,
  the floor and its shadows fade out. Each light's **Size** sets how soft its shadow is (0 =
  crisp; larger = softer away from the contact point). With the floor on, ambient and
  Environment light also cast a soft shadow on it. A model opened recently is kept in
  memory (up to Settings → RAM cache) and reopens without the loading bar; a model
  bigger than that budget loads from disk every time.
  - **Camera** — `W A S D` fly the camera (speed slider under Camera in the settings panel);
    `F` frames the whole model again; `Alt+1…9` saves the current view under that digit
    (overwriting what was there) and `1…9` jumps back to it. Saved views are kept per model.
  - Gaussian splats (`.splat`, `.spz`, `.ksplat`, `.sog`, and splat-flavored `.ply`) get their
    own interactive viewer too (drag to orbit, same camera keys) — no shading controls, since a
    splat's color is already baked in.
