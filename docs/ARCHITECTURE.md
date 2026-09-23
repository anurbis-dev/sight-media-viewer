# Architecture (stable facts)

For "what changed lately" see `RECENT.md`. Update this file only when something here stops being true.

## Layout

```
Sight.py                 launcher (venv bootstrap, window, port); --dev / SIGHT_DEV=1 = developer mode
app/server.py            FastAPI app; routes are closures inside build_app(lib, settings, dev)
app/library.py           Library class: SQLite (WAL) at <SIGHT_HOME>/library.db, scanning, thumbs, CRUD
app/settings.py          settings.json store (UI prefs) + defaults
app/version.py           APP_VERSION (single source; exposed in /api/state as "version")
app/static/index.html    the whole UI: one inline <script type="module"> (no build step)
app/static/canvas.js     the Canvas (board) view — ES module imported by index.html
app/static/keys.js       keyboard-shortcut helpers (hotkey / runHotkeys) — see rule below
app/static/defaults.json shipped default theme / tile size
docs/                    RECENT.md (changelog, newest first), archive/, this file
```

`SIGHT_HOME` defaults to `~/.sight` (library.db, settings.json, thumbnails, private venv).

## Frontend conventions

- Zero-build: an inline module can't be `import`ed from, so split-out modules (`canvas.js`) are
  self-contained and receive anything they need from index.html as **options** to
  `createCanvasView({...})` (`combineSelection`, `markSmallSrc`, `syncPixelation`, `keysEnabled`,
  `getZoomSettings`). `keys.js` is a standalone module both import.
- **Shortcuts:** `hotkey(e, "Ctrl+Alt+KeyD")` matches only when the held modifiers are *exactly* those;
  `runHotkeys(e, [[combo, handler], …])` runs the first match (handler returning `false` = not
  applicable, keep looking). Keys are `KeyboardEvent.code`, so layout independent. Never test
  `e.key`/`e.code` alone.
- CSS gotcha: a plain `.foo { display:flex }` beats the UA `[hidden]` rule by source order; write
  `.foo:not([hidden]) { display:flex }` (canvas.js injects its own `<style>` this way).
- Reused controls: right-drag / wheel zoom formula and `zoomAxis/zoomSpeed/zoomInvert` theme settings
  (lightbox = canvas), marquee modes via `combineSelection` (plain = replace, Ctrl = toggle,
  Ctrl+Shift = add), `markSmallSrc`/`syncPixelation` (nearest-neighbour for small sources),
  `navDblClick` (double-click detection across nav re-renders), `showIconPicker`.
- Library grid tile rescaling on window resize is driven by `#mainBody` width (not the grid's), so
  hiding/squeezing the grid for the board split never changes the zoom.

## Backend conventions

- IDs are content hashes: `asset_id(f"<ns>:{time.time_ns()}:…")` (16 hex chars).
- `json_body()` returns `{}` for any non-dict JSON → batch endpoints take `{"items": [...]}` /
  `{"ids": [...]}`, never a bare array.
- New tables carry `created_at`, `updated_at`, `revision`, `deleted_at` (sync groundwork; no sync
  exists yet). Additive migrations live in `Library._migrate()` (`CREATE TABLE IF NOT EXISTS`,
  `PRAGMA table_info` + `ALTER TABLE ADD COLUMN`).
- `/api/state` returns sources, counts, tags, collections, **boards**, buildMs, **version**.

## Canvas (boards)

**Data** — tables `boards`, `board_groups`, `board_items`, `annotations` (groups/annotations: schema +
CRUD + routes exist, no UI yet). `board_items` = one placement of one asset: `x y w h rotation z_index
opacity desaturate always_on_top crop_x crop_y crop_w crop_h flip_x flip_y color_label locked
playback_state`. Crop is a normalized rectangle of the *source image* (null = uncropped); flip is
per item. Boards hold the saved camera (`viewport_x/y/zoom`).

**API** — `GET/POST /api/boards`, `PATCH/DELETE /api/boards/{id}`, `POST /api/boards/reorder`,
`GET /api/boards/{id}/full` (board+items+groups+annotations), `POST /api/boards/{id}/items`,
`PATCH …/items/{item}`, `POST …/items/batch`, `DELETE …/items/{item}`, `POST …/items/batch-delete`,
groups (`POST/PATCH/DELETE …/groups[/{gid}]`, `…/ungroup`), annotations (`GET/POST /api/annotations`,
`PATCH/DELETE /api/annotations/{id}`, `POST /api/annotations/batch`). Field whitelist:
`Library._BOARD_ITEM_FIELDS`.

**View (canvas.js)** — DOM + CSS-transform "world" (`translate(vx,vy) scale(zoom)`), items are absolutely
positioned cards (same theme variables as library cards; frame widths divided by `--cz` so they stay
constant on screen). Screen-space overlays sit beside the world so handles are zoom-independent:
`.cframe` (transform frame: one item's rotated box, or the common box for a multi-selection) and
`.ccrop` (Alt-crop grips). The board opens beside the library grid (`#mainBody`, draggable
`#splitHandle`, ratio/orientation persisted in the `sight.layout` setting, double-click flips
side-by-side/stacked); header button `#splitBtn` toggles the grid pane.
- Persistence: edits update local state, `scheduleSave()` debounces (300 ms) a batch PATCH; camera is
  saved on close/switch (`persistCurrent`).
- Undo/redo: `pushUndo` entries `move` (whole-item before/after snapshots — used by move, resize,
  rotate, crop, mirror, align/arrange, layers, group ops), `add`, `delete`. Delete-undo and add-redo
  re-POST rows (fresh ids written back into the entry). `commitLayout(list, mutate)` = one undo step
  for any layout command; it diffs `TRACKED` fields.
- Interactions: left-drag item = move; Ctrl+drag anywhere = marquee (Ctrl toggle, Ctrl+Shift add, plain
  drag on background = replace); middle-drag / Alt+drag on background = pan; right-drag / Ctrl+wheel =
  zoom (lightbox formula); wheel = pan; Shift while rotating = 15° steps; Ctrl while moving/resizing =
  snap to the dot grid; frame handles: bottom-right resize (single: free, Shift keeps asset ratio;
  cropped: proportional; Shift on a cropped item drops the crop), top knob rotate; multi-selection
  scales uniformly / rotates about the common box.
- Crop: hold **Alt** over an item → grips on edges/corners (drag = crop that edge, picture stays put; drag
  back out to restore); **Alt+drag on the picture** pans it inside the crop. Rendering: cropped `<img>` is
  sized by width only (`width = 100/crop_w %`, `height:auto`, `translate(-crop_x, -crop_y)`), so it can
  never be stretched; an uncropped item shows a cover-fitted image, and `cropBasis()` starts a first
  crop from exactly that window (no jump). Mirror flips the whole thumb area (crop stays in
  un-mirrored source coordinates; `cropAxis` accounts for flips and rotation).
- Shortcuts (canvas.js `KEYMAP`; PureRef-compatible where PureRef has one): F frame selection, A frame
  all, Ctrl+A select all (index.html), Ctrl+arrows align, Ctrl+Alt+arrows normalize
  height/width/size/scale, Ctrl+Alt+Shift+↑/↓ distribute row/column, Ctrl+P arrange optimal,
  Ctrl+Alt+N/A/O/D/R arrange by name/addition/order/path/random (repeat reverses), Ctrl+Alt+S stack,
  ↑/↓ front/back, `[` `]` one layer, X/Delete/Backspace delete, Ctrl+D duplicate (new instance),
  Alt+X / Alt+V mirror, Ctrl+Z / Ctrl+Shift+Z undo/redo. Align = "gravity" (items stop against each
  other, padding 10) and Normalize separates overlaps, so results never overlap; Stack overlaps on
  purpose.
- Not built yet (planned): annotations UI (drawing/stickers/text/shapes, universal: canvas + single
  asset in the lightbox), groups UI, frames/connectors, opacity/desaturate UI, export, real
  multi-user/sync (groundwork only: revision/updated_at/deleted_at columns, single mutation path).
