# Sight — user manual

- **Sources** — add the folders you want browsed (sidebar → add source, or drag one in).
  Sight watches them live; nothing is imported or duplicated.
- **Search** — press `/` to jump to the search box (matches file names and tags). Moving the
  cursor onto a result takes focus off the search box, so Space previews it right away.
- **About Sight** — click (or tap) the Sight icon at the top of the sidebar: version, Python / OS, library and ffmpeg paths, counts, uptime and log file. *Copy* puts the whole list on the clipboard (handy for bug reports); Esc, the x or a click outside closes it.
- **Command palette** — `Ctrl/Cmd+K`: run actions, jump to a kind/collection/file.
- **Filters** — sidebar lists kinds (image, video, audio, PSD, font, document, 3D model),
  tags and collections; click to filter, and drag assets into a collection to group them.
- **Tags** — select one or more assets and edit tags in the details panel.
- **Details preview** — the details panel shows only the file's thumbnail plus its info, for every
  type. Playback, waveforms, font/text previews and the 3D viewer are in the lightbox (Space /
  double-click).
- **Fit and find** — in the lightbox `F` fits the picture / video to the frame (as a double-click does); over the
  thumbnail grid `F` scrolls it to the selected files. The cursor shows what a held Alt / Shift does on a picture or video (turn, scrub).
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
- **3D animation** — a model with animation clips (glTF / GLB, FBX, USD — moving transforms and skeletons) shows a bar above the shading
  toolbar: ▶ / ❚❚, a time slider to scrub (pauses) and, with several clips, a clip picker. A drawing or note
  belongs to the pose it was made at: playing or scrubbing away hides it, clicking the note puts the clip
  and time back (Sight and the phone alike).
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
- **Library beside the player** — `Tab` (or ◧ at the left end of the lightbox's top bar) shows the sidebar
  and the library grid on the left and the lightbox / video player on the right, with a divider to drag
  (the width is remembered; the sidebar's Canvas section is hidden there). Double-click a thumbnail to open it, drag pictures from the grid onto the frame
  as reference images while annotating. `Tab` again (or ◧) gives the lightbox the whole window; it opens the
  way you left it. On a board `Tab` shows / hides the library beside it in the same way (◧ now sits at the
  left of the top bar).
- **Reading notes** — the speech-bubble button in the lightbox's top bar (its badge counts the notes) or `C`
  opens the notes panel without the drawing tools: read the notes and replies, click a note or its picture to go
  to its frame / view (only its drawings show; Esc shows all again). The same button sits in the top bar for a
  board; there a note's picture is the part of the board you were looking at when you wrote it, and a click on it
  glides the camera back there.
- **Annotations & review** — in the lightbox of an image, PSD, video or 3D model press `A`
  (`Shift+A` in 3D, where A flies the camera) or the pen button in the top bar. A compact toolbar
  appears at the top with a second row that always shows the settings of the current tool — or of
  the selected drawings, which stay editable: every drawing is a vector object you can select, move,
  scale, rotate, restyle and delete at any time. With annotating off, a picture's or video's drawings still
  show while you just watch (a video's on their frames as it plays); the eye button next to the pen (or
  `Shift+H`) hides / shows them — the one eye, in the top bar, while drawing too (a board's sits next to its pen). In a 3D model a note shows a picture of each camera
  view its drawings were made from (its own view first), like a video note's frames; click a picture
  of another view to go to it. Hold **Alt** with a drawing tool to work the picture without switching to
  the select tool: a drag orbits a 3D model or scrubs a video (sideways on the picture), and the toolbar and
  the notes panel stop taking the pointer until Alt is let go. With the select tool Alt keeps its own
  duplicate-drag on a drawing; Alt+drag on empty space scrubs the video (turns a picture), as without
  annotating.
  - Tools: `V` select · `B` brush (pen-tablet pressure changes the width) · `P` pencil ·
    `M` highlighter · `E` eraser (whole object, or *Partial* to cut through strokes; the pen's
    eraser end erases too) · `W` arrow (set both heads to *none* for a plain line) · `R` / `O` the shape tool as
    a rectangle / an ellipse (its *Shape* switch ▭ / ◯ in the styles bar does the same by touch) · `T` text ·
    `N` number pin: a click puts a numbered circle there, a drag draws a line from where you pressed and puts the
    circle where you let go (a callout). A small field then asks for the number — type it and Enter (or tap
    elsewhere); left empty it takes the next free number, Esc drops the new pin. A click on a pin with this tool
    (or a double-click with another one) changes its number. Pins from before 0.84 keep showing their note's
    number. The tool's keys stay live once the number is set. `[` / `]` make the brush / width smaller / larger. Switching annotating on always starts with
    the brush. The drawing tools and the notes panel are independent: the ✎ button / `Shift+A` shows / hides
    the tools only, the speech-bubble button / `C` the panel only.
  - **Reference images** (`Shift+I`, the picture button in the toolbar): put pictures on the frame /
    picture as references. Drop picture files from outside onto the frame (any tool — annotating turns on
    by itself), drag pictures from the library beside the player (below), click the frame with the tool to
    pick files on the computer (they land where you clicked), or use the tool's *From disk…* / *Library* /
    *Add selected* buttons (*Add selected* takes the pictures selected in the library — the way on a touch
    screen). On a video a reference image belongs to the frame it was dropped on (and *Hold*, like any
    drawing). A selected reference image has: *Frame* (border width) and its colour, *Shadow* (strength),
    *Opacity*; corners scale it without stretching, the knob turns it. *Crop* (or double-click the picture)
    shows the whole picture dimmed with grips: drag an edge or corner to cut it, drag inside to slide the
    picture within the cut; Enter / Esc / a press elsewhere finishes, *Reset crop* shows it all again.
    Reference images travel with the review (web page, `.srev`, PDF / ZIP pictures, the phone app shows
    them).
  - Shapes: width, dash (solid / dashed / dotted), fill on/off (off by default, 50 % when on), fill colour and
    opacity, corner radius (rectangle), overall opacity. Lines and arrows: start and end heads
    (none, triangle, open, diamond, dot, bar), straight / curved / elbow body, head size; drag the
    middle handle of a selected line to bend it. The arrow tool's *Stroke* button (wave with arrows; the
    tool's icon follows it) draws a freehand stroke with arrows along it, each turned to the stroke's normal —
    *Every* (distance between them), *Length*, *Tip* (head) and three icon buttons that step through their
    states on each click / tap: direction (away from the stroke / toward it), side (left / right / both,
    relative to the direction you drew in), guide (draw the stroke itself; its dash). Brush: *Close* (lasso icon)
    joins the stroke's end to its start like a lasso and fills it — *Fill* none / solid / a pattern (lines in
    four directions, grid, cross-hatch, dots, dashes) or *Random* (a different pattern each stroke), fill
    colour, *Fill α*, *Spacing* (pattern density). A selected closed stroke changes them too; erasing a piece
    out of it opens it. Text: font, size, colour, bold / italic / underline,
    alignment, background box (colour, opacity), outline; double-click a text to edit it again
    (`Ctrl+Enter` or Esc finishes).
  - While drawing: `Shift` keeps lines, arrows, a pin's line and straight brush strokes horizontal or vertical
    (also when dragging a line's end), makes rectangles square and ellipses round. Select tool: click /
    Shift+click / drag a box to select, drag to move (Shift locks the axis), Alt+drag duplicates,
    corner handles scale (Shift keeps the ratio), the round knob rotates (Shift: 15° steps) — while
    you turn it the knob follows the pointer out from the centre, so pulling it further away turns
    more finely; arrows nudge (Shift ×10). Hold `Ctrl` with any drawing tool to erase for a moment;
    the bin in the toolbar (`Shift+Delete`) clears the drawings on screen in one step (undo brings
    them back). `Ctrl+Z` / `Ctrl+Shift+Z` undo / redo, `Ctrl+C` / `Ctrl+X` / `Ctrl+V`
    copy / cut / paste the selected drawings (a paste after a cut puts them back where they were, after
    a copy 20 px down-right), `Ctrl+D`, `Delete`, `Ctrl+A`, `Ctrl+[` / `Ctrl+]` back / front. Middle- and right-drag still pan and zoom.
    Drawings already added to a note stay editable like any other.
  - **Review notes** — the panel on the right (`C`) collects notes. Type and press Enter: the note
    takes every drawing that isn't attached to a note yet — on screen, on other frames of a video or
    other views of a 3D model, including a sketch left from an earlier opening of the file or one an
    undo took off its note (the line under the field counts them, "+3 drawings (2 on other frames)"),
    so no drawing is left hanging — one note can hold pictures of several frames / views (as vector drawings, shown on a
    picture of each frame in its card; click one of the other frames to go to it; the PDF / web page
    show every frame / view). A card's pictures — its frames and screenshots, a reply's too — are
    small equal squares, each cut to fill (as in the phone app), as many to a row as fit; right-drag up
    / down on the list makes them bigger / smaller (like the thumbnails in the library grid), kept, the reviewer name (field at the top), and the date. While a new note is being made — you draw, or type in the field — the picture is clean:
    other notes' drawings are hidden until the note is added. *All / Open / In progress / Resolved*
    above the list filter the notes. `?` (or the ? button in the toolbar) opens a list of every annotation shortcut; Esc / ? / a click outside closes it, and nothing underneath reacts while it is open. `S` adds a screenshot of what you see, `Shift+S` one of an area
    you drag out; they go into the note you are writing. Click a note to jump to it (only its drawings
    show; click it again, click empty space in the list, or Esc to see all; hovering a note does nothing to the picture; right after you make a note the picture is clean, and that note's drawings come back when you click its card or a video / 3D preview frame in it), attached screenshots carry a small camera badge and a dashed edge (drawing previews do not); click one to enlarge it, Esc or a click closes it; double-click its text (or the pencil on the card) to edit — a card's buttons (pencil, reply, in progress,
    resolve, delete; a reply's) show while the pointer is over it, and on the picked (tapped) card on a touch
    screen; `Ctrl+C` with the pointer over a note's, a reply's or a picture's text (in the panel or on the text
    plate over the picture) copies that text — a real text selection is copied as usual, the clock marks it *In progress* (someone took
    it), ✓ resolves it, the bin deletes it with its
    drawings. Alt+click a screenshot in a note removes it.
    **Picture texts** — the note's text is its topic; each of its pictures (the image, a video frame,
    a 3D view, an attached screenshot) can carry a text of its own. The second field under *Add a
    note…* (*Text for this frame / view / picture*) gives one to the picture the note is made on.
    While a note is picked and one of its pictures is on screen (its frame, a frame it was drawn on,
    its view), a half-transparent plate over the picture shows the note's text with the picture's
    text under it; the pencil on the plate edits that picture's text (Enter saves, Shift+Enter new
    line, Esc cancels, an empty text removes it). Click an attached screenshot of the note: the same
    plate over it. The plate sits at the foot, 80 % wide (more than five lines scroll inside it, with
    no scrollbar — the last line shown fades out while there is more; the plate keeps its size);
    drag the small bar in the middle of its inner edge to resize it (across the edge: height, along it:
    width; double-click the bar: default size — kept per device, one size for top / bottom, one for the sides);
    click it to fold it into a round icon, click the icon to open it; drag the plate or the icon to
    any of the four sides — on the left / right it is 25 % wide and 80 % high. The side and the fold
    are kept. A long text scrolls by the wheel, a drag on the text or a middle-button drag (the words
    follow the mouse); then only the plate's head (number / label) moves the plate. In the note card the texts are listed under its pictures (a mark in a preview's
    corner shows which have one); click one to go to that frame / view, double-click to edit it.
    The PDF report and the reviewer page show them under the pictures. The arrow button on a note adds a
    **reply** (Enter sends); double-click a reply to edit it, × deletes it. **Dictation:** the mic button under the note field (and next to a reply, note or picture text while you edit it) listens and types what you say at the cursor; click it again, Esc or Alt+M stops; the small language chip next to it (RU / EN…) switches between the two languages you used last in one tap (Alt+Shift+M from the field; mid-dictation it carries on in the new language); right-click / long-press the chip or the mic for all languages (default: the browser's). Needs Chrome, Edge or Safari; Chrome / Edge send the audio to Google, so it is online only. Or use **any speech-to-text service you like** (Settings → Dictation → Engine *My service*): paste its OpenAI-compatible transcription address (a local whisper server such as `http://localhost:8000/v1/audio/transcriptions`, or OpenAI, Groq…), the model name and, if it needs one, an API key, then *Save*. Whisper-type services detect the language by themselves (leave the language on *Auto*); each phrase is sent after you pause, so words appear phrase by phrase. The key stays on the Sight server (never shown again; *Forget key* removes it; changing the address drops it). Resolving or reopening
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
  - **Reset the toolbar** — hold the pen button (the one that turns annotating on) for about a second: every tool's colours, sizes
    and options, the hold time and the frame stamp's look return to their defaults (a normal click still toggles annotating).
  - **Turn by hand** — Alt+drag on a picture turns it about its centre, to any angle (on a video Alt+drag
    scrubs; Ctrl+Alt+drag turns the video. A clip with few keyframes — many phone and screen
    recordings — seeks slowly in the middle; once a scrub of it is slow Sight makes a small scrub copy
    in the background and later drags show it, so every position along the way is drawn. Sight keeps
    the newest 20 scrub copies, 1 GB at most, and makes one again when needed); hold
    Shift to snap to absolute 15° steps (0, 15, 30 …). Sight remembers the angle per file.
  - **Video bar** — right of the timeline: the *sound* icon (click = mute / unmute; press and drag up / down,
    or the mouse wheel = volume, with a slider above the icon; right-click or long press = *sound while
    scrubbing* on / off, shown by a dot on the icon) and the *loop* button (replay at the end; inside a
    sequence the sequence bar's loop applies). The position field left of the timeline: click and type a
    frame number (or a time such as 1:05) + Enter to jump, Esc cancels; right-click or long press picks
    *Frame / Time / Frame + time* and, with a sequence of 2+ clips, *local* or *global* counting.
    Shift+← / Shift+→ jump to the first / last frame (of the whole sequence while one plays). All kept per device.
  - **Versions** — files in the same folder whose names differ only in a version token
    (`shot_v001`, `shot_v002`, `shot.v3`, `shot_rev4`, `shot_r5`; a name without one counts as the
    first) are versions of each other. The panel shows *Version 2 of 3* with ‹ › to step through them
    and *Compare*. When the previous version still has open notes, *Copy here* brings them over
    with their drawings (scaled if the size changed; the note says where it came from).
  - **Video** — drawings belong to the frame they were made on. A note has a marker on each frame
    its drawings (or a text of one of its pictures) are on — not on the frame where it was typed; a
    note with nothing but words keeps the frame it was written on (red = note, orange = in progress,
    green = resolved, yellow = a drawing with no note). The note's previews in the panel show each
    of those frames, numbered in the top-left corner. Click a marker to go there. `,` / `.`
    step one frame, `Shift+,` / `Shift+.` jump to the previous / next marker (these work outside the
    annotation mode too). *Hold* in the tool settings keeps new drawings visible for 0.5–2 s or the
    whole clip; onion skin — right-click or long-press the eye in the top bar (a way of viewing, drawing or not; remembered; picking a note in the panel goes to its frame but keeps every drawing and ghost on show)
    — cross-fades between annotated frames: as the playhead moves on,
    the last frame's drawings fade out and the next annotated frame's fade in (over the last / first second at
    the clip's ends).
    The frame-stamp button (Shift+F, annotation mode only) is on by default; switch it off per video (the others keep it). On, it shows the current frame over the video and is burned into every report picture of that video; drag it (mouse, pen or finger) and it snaps to
    a corner or the middle of a side. The ▾ next to it (or a tap on the stamp) sets what it shows, size, colours, backdrop,
    font and position. The same label is burned into the report pictures (ZIP, PDF, the
    reviewer page); switched off for a video, its pictures carry no frame label.
  - **3D** — a drawing belongs to the camera view it was made in, and a note also saves the shading,
    lights, explode and field of view. A view also keeps which meshes were hidden (H / Ctrl+H / Alt+H)
    when it was made: a change of hidden meshes starts a new view, and going back to a view shows its
    meshes as they were. Orbiting away hides the drawings; a click on the note (or on one of its
    view pictures) brings the camera, settings and meshes back. While you make a note (draw, or type in
    its field), the numbered *Views of this note* chips sit right above its field: the views the new note
    will hold — those of its waiting drawings and the camera on screen (a dimmed next number when that
    camera is no view yet: adding the note makes it); a chip goes to its view. Once the note is added the
    chips go; its views are its pictures in the card. Views and a note's pictures are numbered in the
    order the views were made. A note's pictures are stills taken
    once per view: turning the light or the shading does not redraw them (the drawings on them do follow
    the view). Explode is kept too: a note's pictures and exports stay at the explode it was added at, and
    clicking the note goes back to that explode. Moving the explode slider (or Ctrl+right-drag) changes only
    the view you are on while it holds no added note; a drawing not yet added takes the slider's amount when
    its note is added. If the view already has added notes, the slider cannot move it, so a new note made at
    the changed explode starts a new view with its own number. Going to a view puts the view's
    explode back. An older drawing has none.
    While annotating, left-drag on
    empty space with the select tool orbits. The zoom settings (Speed, Drag axis, Invert) apply to the 3D
    camera too — the wheel and right-drag — as they do to images, video, text and version compare.
  - **Export** (panel → Export): *PDF report* (every note with its frame / view and screenshots —
    a note's pictures side by side in rows under its words, then its replies — saved to Downloads and shown in the file manager; a video note brings only the frames it has drawings or picture texts on; each video frame is captioned with its file name, frame number and timecode, e.g. "clip.mp4 · f128 / 0:05+3" — the frames after the full second — and carries that label, small, in its top-left corner), *Notes as ZIP* — a folder per note ("Note 01" …) with its
    pictures, drawings burned in, each named by the file and the frame / view as under it in the reports
    ("clip.mp4 · f128 · 0.05+3.jpg", attached pictures "clip.mp4 · Note 1 · Picture 2.png"), and
    "Note 01.txt": the note's text, then the text of each of its pictures that has one under that
    picture's file name; a still picture's cover with every drawing sits at the top of the archive. *Review file (.srev)* — one file with
    all drawings, notes and screenshots to send by mail or messenger; whoever opens it in Sight
    (drag it onto the window, the same Export menu → Import, or the palette "Import review file")
    gets the review on the same media file, found by path, else by name and size. Importing
    **merges**: the same file twice changes nothing, a file that went to someone and came back adds
    their replies / new notes / resolved states, and what was deleted on one side is deleted on the
    other (unless it was edited there later). A file that holds notes / drawings you deleted here
    (an older copy of your own review, say) asks *Restore them?* — yes brings them back. *Web page for reviewers (.html)* — one file that opens
    in any browser, on a phone too, no Sight needed: the picture / frames with the drawings, every
    note, screenshot and reply. The picture on top is the original; each note shows its frame with
    its drawings, and every picture in a card is shown at full width. Under each picture: which
    picture it is (file name and frame) with a download button, and the picture's own text on the next
    line, in the note's text size. The download (and the one at the top right of the full-screen
    viewer) saves the picture with the drawings shown on it, named after that line —
    "clip.mp4 · f128 · 0.05+3.jpg" — not "download.jpg". The page first asks the reviewer's name (nothing can be done
    without it; *You: … ✎* changes it). The title, who sent the page, and the *All / Open / In
    progress / Resolved* filters with their counts stay pinned at the top; tap the title (or the
    arrow) for the file details and the review-state history. *Reply* opens a message field (paper
    clip attaches pictures, the paper plane sends) with *Mark as In progress / Resolved / Reopen*
    above it — a state can be sent alone or with the reply, and is logged in the thread like in
    Sight. A field left empty closes when you tap anywhere else. A new note starts from the blue
    *+* in the bottom bar (one at a time; it can carry pictures too). Unsent entries have × to take
    them back. Tap a picture to view it full screen, as on the phone: swipe left / right (or ← / →)
    for the note's next / previous picture (its frames, its attachments, then its replies'), swipe up
    / down (or ↑ / ↓) for the next / previous note — the picture goes on the way you swiped, fading
    out, and the next one follows it in like a strip; the round ← Back button (or Esc) leaves. A
    half-transparent plate at the foot shows the note's number, which picture it is, the note's text
    and the picture's own text (tap it to fold it into an icon, drag it to another side). Right-drag
    (mouse, or the pen's side button) zooms as in Sight, so do the wheel, a pinch and a double-click;
    drag to pan while zoomed in. **Drawing**: the pencil in a message field (or the round pencil in
    the full-screen viewer, bottom right) opens a full-screen canvas over the picture — a reply can be
    drawn on any of the note's pictures (any of its frames / views; an attached picture gives a
    drawn-over copy), a new note over the picture or — video / 3D — over a note frame you pick; the
    new note then sits on that frame. A new note or a reply is drawn on the clean picture. Tools:
    select / transform (`V`: tap or drag a box to select, drag to move, handles scale, the round knob
    rotates and follows your finger out from the centre for finer turns; a colour recolours the
    selection; *Cut / Copy / Paste* under the top bar — or `Ctrl+X` / `Ctrl+C` / `Ctrl+V` — cut, copy and
    paste it, also onto another frame or picture while the page / app is open; a paste after a cut lands
    where the drawing was), brush (pen pressure), highlighter, arrow, rectangle, ellipse, text (tap where it
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
- **Phone app (Sight Review)** — review pictures, videos and 3D models on a phone or tablet, offline, without
  Sight: open the app's link (GitHub Pages of this repository) in Safari → Share → *Add to Home
  Screen* (Android: *Install app*); it then starts like an app and works without network. Reviews
  made in Safari before installing stay in Safari. Two open buttons — big ones on an
  empty home screen, two small icons in the bar once there are reviews: *Photo or video* opens the phone's
  gallery; *Open a file…* opens Files (pictures, videos, 3D models — glTF / GLB, FBX, OBJ, STL, PLY, USDZ / USD,
  Gaussian splats, picked together with their textures — or a `.srev` someone sent). Nothing is
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
  shows its kinds in a row above the bar (arrow, open arrow, double arrow, dashed arrow, line, arrows
  along a stroke — with it, three tap-to-cycle switches: side left / right / both, away / toward the
  stroke, guide drawn or not; spacing and length follow the size /
  rectangle, rounded, ellipse, filled rectangle, filled ellipse — and at its end the fill colour:
  a second row with the line's own colour (lighter, the default) or one of six; picking a colour
  with an outlined shape in hand takes its filled kind): tap one to draw with it, or just
  draw — the row folds and the tool stays. The brush has such a row too: brush, or lasso (the end
  joins the start and the inside is filled in the line's colour, half see-through) with its pattern
  button — a second row of patterns (none, solid, lines, grid, cross-hatch, dots, dashes, random); tapping the slot again with its row up puts the tool
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
  you like; *Done* makes them one note (its card shows every frame drawn on, each with its frame number in the
  corner; the note's markers are on those frames, not on the frame where it was typed). Each note has
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
  pictures; a half-transparent plate at the foot (80 % wide, at the left edge so the pencil bottom right stays free) tells which ("0:01.05 · f 30 · 2 / 7",
  "↳ Bob · Picture") with the note's / reply's words and, on the note's own pictures, the picture's
  own text under them — more than five lines scroll inside the plate (no scrollbar: the last line shown
  fades out while there is more; drag the small bar on its inner edge to resize it, double-tap the bar for
  the default size; drag the text; to move the
  plate then, drag its head); the pencil on the plate writes
  or changes that picture's text (the note's text stays its topic; a picture with a text has a mark
  in its corner in the card, and the PDF / HTML exports show the text under it); a tap on the plate
  folds it into a round icon, a tap on the icon opens it; drag the plate or the icon to any side of
  the screen — on the left / right it is 25 % wide and up to 80 % high (on the right it ends above the
  pencil; kept for next time); a swipe up /
  down shows the next / previous note — the picture goes on the way you swiped, fading out, and the
  next one follows it in like a strip, fading in; the round ← Back button (top left) leaves — no swipe does; the pencil
  (bottom right) draws a reply on it; back in the review the player stands on the frame you left on). Settings (⚙ on
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
  their frames stay readable without the file.
  A `.srev` of a whole sequence (Sight's *Review file, all clips*, or the reply of the all-clips web page)
  opens every clip at once: one toast sums them up (a damaged clip or one that is not a picture, video
  or 3D model is named, the rest still land), and the clips become one group on the home screen
  (named by the file's title). A clip whose media is not on the phone is greyed (“Media not on this
  device — notes readable”) until you open it and pick its file. Hold the group for *Review file for
  Sight (.srev)*: one file with every clip you changed since the last send (notes, replies, states,
  drawings, deletions) — Sight 0.75+ merges each into its clip. With nothing changed it asks whether to
  send all. Any group you made yourself sends the same way.
  Tap a group's picture to review it as a sequence: it opens on the clip you saw last there (the first one
  at first); the header shows ‹ / › around the clip's name and “group · 2 / 5” under it (keyboard: Page Up /
  Page Down). Back leaves the sequence in one step. Pictures and 3D models in a group work the same way. For a round trip with Sight, open the
  original from Files (*Open a file…*): the Photos picker hands over a converted copy (HEIC becomes
  JPEG, video may be re-encoded), whose name / size Sight does not know. Press and hold a review in
  the list to delete it. When a new version of the app is out, a bar offers *Reload*.
- **3D on the phone** — *Open a file…* takes `.glb` / `.gltf`, `.fbx`, `.obj`, `.stl`, `.ply` and USD
  (`.usdz`, `.usd`, `.usda`, `.usdc`; read on the phone itself, no Sight needed — placed exactly as Sight
  shows it, so views match). A model that uses files beside it (a `.gltf`'s `.bin`, an FBX's textures):
  pick them together with it (select several files in Files); they are kept with the model on the device,
  and a `.gltf` without its `.bin` says which file it needs. **Gaussian splats** (`.splat`, `.spz`, `.ksplat`,
  `.sog`, a splat `.ply`) open too, placed as Sight places them: notes and drawings go on views as on a model;
  a splat has no meshes, shading, light, explode or turn, so those controls are not shown.
  One finger turns the camera round the model, two zoom and pan.
  The header has the eye (drawings), ⟳ *Turn the model a quarter* (which way is up, as Sight's turn
  button; kept with the review) and ⛶ *Frame the model*. **Tap a part** of the model to pick its mesh
  (orange); a row under the header then offers *Hide*, *Only this* (hide the others), *UV* (the mesh's UVs
  over its texture, full screen, pinch to zoom; the UV set is named at the top — *UV1 · 1 / 2* — and a mesh with
  several sets shows the next one with a swipe to the side) and ✕; a tap on empty space lets it go. While meshes are
  hidden the row shows *Show all*. The **bottom bar** has Shading, Grid, Light, Background and Explode icons;
  a tap opens its choices in a row above (Solid / Vertex / Textured / Normal + Wire / X-ray; Off / Grid / Grid +
  axes, with a *Cell* slider under it — round cell sizes, shown in model units; Studio / Sunset / Overcast /
  Night / Headlight / Flat; background swatches and a colour picker; the explode slider). The grid's lines take
  their colour from the background (light on a dark one, dark on a light one), in Sight too. Shading, grid,
  light and background are this phone's (a splat has only the background). A note keeps the shading and light it was written with: opening it (here or in Sight)
  shows them again (for that look only — the phone's own choice is not overwritten), as Sight does with its own notes (Sight's lights without an environment read as Headlight;
  the phone's Headlight / Flat as Sight's lights without an environment). A model with **animation** adds a row with ▶ / ❚❚ and a time slider
  (several clips: a chip switches them). A note goes on the **view** on screen — the camera, the hidden
  meshes, the explode and the animation pose — like a video note on its frame; views are numbered as in Sight (View 1 is the
  first one made). The pencil draws over the view on screen; turn to another view and draw again for
  the same note (each view keeps its drawings). A card shows each of the note's views (V1, V2… in the
  corner); a tap on the card or its *View N* button puts the camera there. *Reply* writes over the model
  on the note's view, with chips for its other views; *Edit the drawing* asks which view when there are
  several. Views from Sight (their hidden meshes and explode included) open the same way, and the
  `.srev` goes back to Sight with every view in place. PDF / web page: each view as a picture, "View N".
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
  - **Annotate** (✎ in the top bar, or `A`): the notes panel and drawing tools of the viewer, on the
    **selected layer** — notes and drawings go to that file, at its own frame (a video layer's local
    time). Click a layer chip (or a tile) to annotate another file. A note written here remembers the
    comparison — the files, their order, reference, layout and offsets: its card in the viewer has
    *⧉ Compare · N files*, which opens it again on the note's frame, and `K` on that file brings the same
    files back (the newest such note wins) instead of its versions. While annotating, the left button draws: `Alt`+drag
    moves the nearest split (as it scrubs a video in the viewer), and a finger or stylus that lands on a split
    moves it instead of drawing. The tools' keys (`[` `]` brush size, `R` `V` `L` tools, `Shift+,` / `.`
    markers) win over the compare's; leave annotating (`A` / Esc) to shift layers or change the reference by
    key. The screenshot (`S` / the camera, or an area with `Shift+S`) is the comparison as shown — every
    layer in its split or tile, Difference, the split lines and names — with the drawings on top.
  - Wheel zooms around the cursor, right / middle drag pans (left drag in the tile layouts),
    double-click or `F` fits, `0` shows the reference at 100 %. `Esc` / `K` closes.
- **Play in sequence** — select two or more videos (Ctrl-click them in the order you want: that order
  is kept; a Shift-range or a marquee adds them in grid order) and press Space over one of them, or
  click *▶▶ Sequence* in the top bar (also in the right-click menu and the palette). The clips play back
  to back in the full-screen viewer, cut to cut with no black frame. The bar above the timeline shows
  every clip as a segment (alternating shades, name inside); tap or drag it to move through the whole
  sequence, the timeline under it is the current clip's own. Dragging on the picture scrubs the whole sequence
  too: it runs on past a clip's start or end into the neighbouring clip (the last frame stays on screen until
  the next clip's frame is ready — no black flash). ⏮ / ⏭ or `←` / `→` go to the previous /
  next clip's start, `Home` to the first clip, ⟲ or `Shift+L` loops the whole sequence; `,` / `.` step
  frames across the cuts. Ticks on the sequence bar mark every clip's drawings and notes (the taller ones
  are notes); `Shift+,` / `Shift+.` jump to the previous / next one, on into the other clips. A clip the
  browser cannot play is converted as soon as the sequence opens, so it is usually ready by its turn. Each clip keeps its own notes and drawings: the notes panel and the drawings
  switch with the clip on screen, and a note written there belongs to that clip. While annotating, the
  arrows stay the nudge keys. **Export** (notes panel → *Export ▾* → *…, all clips*) takes the review of every
  clip in the sequence that has notes: one PDF (a section per clip), one ZIP (a folder per clip), one web
  page for all of them, or one `.srev` review file for all of them (a clip whose notes were all deleted since is
  included too, so the deletes reach the other side); for the PDF, ZIP and web pages the viewer visits the clips
  to picture them, then returns to where you were. Importing such a file (drag it in, or *Import review file*) merges every clip it holds that
  is in your library and tells you in one message how many were updated, which are not in your library and which
  could not be read; the others still land. Older Sight versions (before 0.75) cannot open it.
  The **web page for all clips** has a strip of the clips on top (name, notes, open notes; a dot marks a clip
  changed on the page): tap one, use the ‹ / › buttons at its ends, or `←` / `→` (not while typing). The bottom
  bar counts every clip's changes; *Download reply* gives one `.srev` with the clips answered, *Discard* asks
  whether to drop this clip's changes or every clip's. For a Sight older than 0.75, tap the clip's title and use
  *Download this clip's reply* (a review file for that clip alone). A sequence with one clip with notes gets
  the ordinary one-clip page.
  Opening any other file from the viewer ends the sequence; `Esc` closes.
- **Selecting by touch** — hold a tile for half a second to start touch selection with just that tile;
  then each tap adds or removes a tile (the order you tap is the sequence order) and a double tap opens
  nothing. A bar at the bottom shows how many are selected, *▶▶ Play in sequence* (2+ videos) and ✕;
  ✕ or `Esc` ends it (a tap that misses a tile does nothing then). A stylus works like a finger. Moving
  the finger while holding just scrolls.
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
  Space previews the thumbnail under the cursor whatever is selected, and leaves the selection as
  it was — except over one of two or more selected videos, where it plays them in sequence (below). ←/→ move to the next/previous asset and ↑/↓ move one row up/down in the
  thumbnail grid; `D` (or the panel button at the right end of the top bar, which also works by touch) toggles the
  details panel; its "File" block (preview + name + facts) collapses by its header; the total file
  count sits in the Sources header; drag up/down on the grid resizes tiles.
  `Esc` closes the preview; with none open it clears the thumbnail selection.
  Opening or stepping onto a heavy asset (a 3D model, a PSD, anything over 100 MB) with Space or
  the arrow keys has a short cooldown (~0.7 s), and holding the key down does nothing — so a burst
  of presses can't pile up loads. Light assets like images are never throttled.
- **Mask and corner radius** — the ◱ button in the full-screen preview's top bar opens a popover:
  pick a mask (16:9, 4:3, 1:1, 9:16, … or Circle) to clip the preview to a frame of that shape, and
  set the frame's corner radius. "Full" with radius 0 is the plain edge-to-edge preview. Works for
  images, video and 3D models alike; the choice is saved with the theme. With a radius set, the corner
  icons (info, 3D gear, video strip) move in from the corners so the rounding does not cut them.
- **Look** — the default theme is *Graphite*: compact rows, Inter, one blue accent, captions under the
  thumbnails. Settings → Theme switches presets (*Classic* brings back the sizes and colours from before 0.54:
  larger text, framed cards, names on the thumbnail; the panels stay compact); Settings → Colors → *Accent* changes the selection / focus colour, and
  Settings → Layout → *Captions* puts names under or on the thumbnails.
- **Panel widths** — drag the inner edge of the sidebar or of the inspector (mouse, pen or finger) to
  make it wider or narrower (the thumbnails keep their size, the number of columns changes); double-click
  the edge for the default width. The widths are remembered.
- **Settings panel** — the *Settings* header at the bottom of the sidebar opens the panel over the whole
  sidebar; click the header again or press Esc to close it (it stays open across restarts until closed).
- **Settings are remembered** — every option (Settings panel, 3D viewer rig, saved camera views,
  tile size, inspector/sidebar sections) and the app window's position, size and maximized state
  are saved to `settings.json` in the Sight data folder (`~/.sight`, or `SIGHT_HOME`) and come
  back on the next launch, whichever port or browser profile it opens on.
  **Themes** — the *Theme* row at the top of Settings picks a preset; once you change a value it shows
  *Custom* and a save button appears: *Save to <name>* (when you started from one of your own themes) or
  *Save as new…*. The × deletes one of your themes. *Section titles* (colour) and *Section title size*
  restyle the sidebar headers and the Settings header.
  **Reset all to defaults** (the round-arrow button in the theme row, or `Ctrl/Cmd+K`) puts the theme, 3D viewer settings and
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
  - **Missing files:** if a file is gone (its folder was removed from Sight, or the file was deleted / moved
    away) its card turns into a **Missing** placeholder showing the file name and the path it had (hover for
    the full path). Add the folder again and the pictures come back by themselves, no reload needed.
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
  - **Draw and write notes on a board:** the pen button in the top bar, next to ◧ (or
    **Shift+A**; Shift+A or Esc leaves again) switches on the same tools as the full-screen viewer: brush,
    pencil, highlighter, eraser, arrow, shape (rectangle / ellipse), text, note pin, select / transform,
    undo / redo and the styles bar (`B P M E W R O T N V`, `Ctrl+Z` — press `?` in the mode for the list).
    Drawings are **free on the board** (they do not belong to items and do not move with them), at any
    zoom. While the mode is on, a drag draws (items and their frame do not react; one finger draws on a
    touch screen) and the keys go to the tools, so `X` / `Delete` act on the selected drawing, never on
    items. Panning and zooming still work as usual: wheel, middle-drag, Alt+drag, Ctrl+wheel / right-drag
    — and **two fingers** pan and pinch-zoom the board (also with the mode off). `F` / `A` frame the board
    (drawings included). With the mode off the drawings stay visible and the board behaves exactly as
    before. The notes button in the top bar opens the **notes panel** (starts closed on a board): type a note
    and press Enter — the drawings made since the last note are attached to it; a note has replies, an
    Open / In progress / Resolved state and a delete button as in the viewer. Clicking a note card shows
    only its drawings and moves the camera to them (click it again to show everything). A board has no
    picture, so there are no screenshots, review state, versions or export formats here — only
    *Copy notes as text*. Deleting a board deletes its drawings and notes.
  - Boards, their items, crops and the camera position are saved automatically.
- **Excluding folders** — the × next to a subfolder removes it from the library; everything
  under it goes with it, so its subfolders aren't listed while it's excluded.
- **Ignore list** — Settings → Scan Filtering → Ignore skips files and folders by name in every source,
  one pattern per line, then *Apply*: `*.meta` or `Thumbs.db` (a file or folder name anywhere,
  `*` `?` `[..]` wildcards), `Library/` (folders only), `Library/PackageCache` (that folder path
  anywhere), `#` for comments. Case-insensitive. Hidden files keep their tags and ratings and come
  back when the pattern is removed. `.obj` files that are compiled code (Unity BurstCache, Visual
  Studio build output) are skipped automatically — they are not 3D meshes.
- **Default filters** — under your Ignore list Sight applies a built-in list (`app/initial_filtering.ini`:
  Thumbs.db, .DS_Store, *.tmp, *.part, *.db, .git/, node_modules/ ...). Open it with the shield button
  next to *Apply* (Settings → Scan Filtering), edit it and *Save* (a copy goes to your Sight folder and
  replaces the shipped one; sources are rescanned), or *Restore shipped* to go back. Works the same on a phone.
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
  - USD: `.usdz` is converted once into glTF when the optional usd-core library is installed; `.usd`,
    `.usda` and `.usdc`, a `.usdz` without usd-core and an **animated** `.usdz` are read in the viewer itself
    (as the phone app reads them), so their animation plays. A standalone `.usda` / `.usdc` finds its textures
    by name beside the model (or in the usual texture folders); other USD files it references are not loaded.
  - Gaussian splats (`.splat`, `.spz`, `.ksplat`, `.sog`, and splat-flavored `.ply`) get their
    own interactive viewer too (drag to orbit, same camera keys) — no shading controls, since a
    splat's color is already baked in.
