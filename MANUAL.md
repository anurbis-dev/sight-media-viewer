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
  images, video and 3D models alike; the choice is saved with the theme.
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
- Video gets automatic thumbnail stills (needs ffmpeg — bundled in the standalone builds,
  otherwise Sight shows an "Install" banner if it can't find one). PSD opens per-layer;
  fonts get a live specimen; 3D models get an interactive viewer (drag to orbit,
  Alt+drag to move the light, Shift+1–4 to switch shading, Shift+5/6 to toggle wireframe/x-ray,
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
