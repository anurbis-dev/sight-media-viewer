# Sight — user manual

- **Sources** — add the folders you want browsed (sidebar → add source, or drag one in).
  Sight watches them live; nothing is imported or duplicated.
- **Search** — press `/` to jump to the search box (matches file names and tags).
- **Command palette** — `Ctrl/Cmd+K`: run actions, jump to a kind/collection/file.
- **Filters** — sidebar lists kinds (image, video, audio, PSD, font, document, 3D model),
  tags and collections; click to filter, and drag assets into a collection to group them.
- **Tags** — select one or more assets and edit tags in the details panel.
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
- **Canvas (boards)** — the **Canvas** section in the sidebar holds boards: free-form moodboards.
  `+` creates one; click a board to open it, click it again to close. Double-click a board to rename
  it, right-click it to change its icon/colour, drag rows to reorder. A board opens **beside the
  library** so you can drag files from the grid onto it (the header button ◧ hides/shows the library
  pane; drag the divider to resize it — the size is remembered — and double-click the divider to
  switch between side by side and stacked). The same asset can be placed on a board any number of times.
  - **Move around:** middle-drag (or Alt+drag on empty space) pans, mouse wheel pans, Ctrl+wheel or
    right-drag zooms — the same zoom controls as the full-screen preview. `F` frames the selection
    (everything if nothing is selected), `A` frames everything.
  - **Select:** click, Shift/Ctrl-click, or drag a box (plain drag replaces the selection, Ctrl-drag
    toggles, Ctrl+Shift-drag adds — same as in the library, and it also works when you start over an
    item). `Ctrl+A` selects all in the pane you last used. `Esc` clears.
  - **Transform:** one frame with a corner handle (resize; Shift keeps the picture's proportions) and a
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
  slider only appears for models made of several parts.
  - **Camera** — `W A S D` fly the camera (speed slider under Camera in the settings panel);
    `F` frames the whole model again; `Alt+1…9` saves the current view under that digit
    (overwriting what was there) and `1…9` jumps back to it. Saved views are kept per model.
  - Gaussian splats (`.splat`, `.spz`, `.ksplat`, `.sog`, and splat-flavored `.ply`) get their
    own interactive viewer too (drag to orbit, same camera keys) — no shading controls, since a
    splat's color is already baked in.
