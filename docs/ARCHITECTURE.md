# Architecture (stable facts)

For "what changed lately" see `RECENT.md`. Update this file only when something here stops being true.

## Layout

```
Sight.py                 launcher (venv bootstrap, window, port); --dev / SIGHT_DEV=1 = developer mode
app/server.py            HTTP API + UI server; routes are closures inside build_app(lib, settings, dev)
app/web.py               FastAPI-shaped router on plain Starlette (@app.get on plain functions; see below)
app/library.py           Library class: SQLite (WAL) at <SIGHT_HOME>/library.db, scanning, thumbs, CRUD
app/fileinfo.py          per-type file details for the lightbox info overlay (GET /api/assets/{id}/info)
app/review.py            review sessions: screenshot files, PDF report (PyMuPDF Story), .srev package,
                         HTML page for reviewers without Sight
app/settings.py          settings.json store (UI prefs) + defaults
app/version.py           APP_VERSION (single source; exposed in /api/state as "version")
app/static/index.html    the whole UI: one inline <script type="module"> (no build step)
app/static/canvas.js     the Canvas (board) view — ES module imported by index.html
app/static/annotate.js   lightbox annotations + review notes panel — ES module imported by index.html
app/static/review-core.js  drawing primitives + merge rules shared with the HTML page / mobile app (docs/FORMAT.md)
app/static/review-draw.js  the full-screen drawing canvas (SightReviewDraw.open) shared by the HTML page and the phone app
app/static/compare.js    version compare overlay (swipe / tile / strips, over / difference, synced video)
app/static/keys.js       keyboard-shortcut helpers (hotkey / runHotkeys) — see rule below
app/static/defaults.json shipped default theme / tile size
docs/                    RECENT.md (changelog, newest first), archive/, this file, FORMAT.md (review data contract)
mobile/                  the phone app "Sight Review" (PWA, no build step) — see "Phone app" below
tests/                   test_merge_parity.py (python -m unittest tests.test_merge_parity; needs node);
                         test_pwa.py (phone app: build, pwa_unit.cjs, pwa_e2e.cjs round trip with Sight)
tools/                   archive_changes.py; build_pwa.py (phone app → dist/pwa, --serve PORT); bench_startup.py / bench_grid.py (benchlib.py: isolated SIGHT_HOME
                         copy, headless Edge/Chrome/Chromium over a stdlib CDP client — never the live library)
build_exe.bat            Windows PyInstaller build (dist\Sight\Sight.exe); pauses skipped when CI is set
build_app_macos.sh       macOS build (dist/Sight.app); on Linux the same script gives dist/Sight/Sight
.github/workflows/release.yml   CI: all four platform builds + headless smoke test; tag v<APP_VERSION> publishes a Release
.github/workflows/phone-app.yml CI: phone app unit tests + build on every branch; deploys to GitHub Pages from master
```

`SIGHT_HOME` defaults to `~/.sight` (library.db, settings.json, thumbnails, review_shots/, private venv).

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
- Popups: every menu/popover closes via `registerAutoClose(el, close, anchor)` (cursor more than
  25 px away, never while a button is held; a popup anchored inside another keeps its parent open).
  Every `<input type="color">` opens the in-page `#colorPop` picker, never the native popup, which
  the page cannot close. It fires `input` while changing and `change` on close.
  Likewise every `<select>` opens the in-page `#selPop` list (always inside the window, flips
  upward near the bottom edge); it sets the select's value and fires `input` + `change`.
- Lightbox 3D selection: `setInspectSel(sel, reveal)` is the one entry point (info panel lists and
  Ctrl+click picking in the viewport); `v3dInspect.sel` is `{kind: "mat"|"tex"|"mesh", i}` or null.
- Lightbox 3D shadows: `BasicShadowMap` + a PCSS `getShadow()` patched into three's shader chunk
  (`patchSoftShadows`); `light.shadow.radius` means penumbra UV per unit shadow depth, not texels.
  Floor shadow from ambient/env is accumulated by `makeSkyOcclusion` (layers 5/6 — three selects
  shadow casters by the rendering camera's layers). Re-check the chunk markers after a three upgrade.
- Shared pane helpers: `bindSplitDrag(handle, {box, stacked, set, end, dblclick})` is the one
  divider drag (library/board split and the lightbox UV split); `attachViewer(stage, a, src,
  {embedded:true})` shows any picture with the image lightbox's pan/zoom/fit and returns
  `{fit, zoom}`; hover picks the pane that gets F/digits (`activePane`, `lightPane`).
  `attachPanScroll` handles nested scrollers (inner one wins via `e._panScroll`).
- `cloneModel` clones each distinct material once — meshes that shared a material keep sharing it.
- Library grid tile rescaling on window resize is driven by `#mainBody` width (not the grid's), so
  hiding/squeezing the grid for the board split never changes the zoom.
- `.grid` has `overflow-anchor: none`. Any scroller whose content is virtualised needs it: Chromium's
  scroll anchoring otherwise shifts `scrollTop` when the code swaps the nodes above the view.
- Grid thumbnails use `decoding="async"` on purpose: a scroll can bring dozens of new thumbnails at
  once, and their decoding must not hold up the frame.

## Backend conventions

- IDs are content hashes: `asset_id(f"<ns>:{time.time_ns()}:…")` (16 hex chars).
- `json_body()` returns `{}` for any non-dict JSON → batch endpoints take `{"items": [...]}` /
  `{"ids": [...]}`, never a bare array.
- New tables carry `created_at`, `updated_at`, `revision`, `deleted_at` (sync groundwork; no sync
  exists yet). Additive migrations live in `Library._migrate()` (`CREATE TABLE IF NOT EXISTS`,
  `PRAGMA table_info` + `ALTER TABLE ADD COLUMN`).
- `/api/state` returns sources, counts, tags, collections, **boards**, scanIgnore, buildMs, **version**.
- Asset `status`: `ready` | `missing` (file gone) | `excluded` (hidden: inside an excluded folder,
  matched by the scan ignore list, or a compiled `.obj`). Excluded rows are kept so metadata survives;
  anything that revives rows must check both folder exclusion and `Library.hidden()`.
- Table `meta(key, value)` holds library-wide settings the backend needs without a page open
  (`scan_ignore`: the Settings → Scanning ignore list, parsed by `IgnoreRules`).
- Lightbox 3D explode: `buildExplodeRig` solves an explosion graph per assembly level of the node
  hierarchy (box-based blocking, grounded largest part, one model axis per part, ride-along carry);
  `applyExplode(rig, t)` only sets `position`. Rebuilt per load, independent of the 90° turns.
  Guards: graph only up to `EXPLODE_GRAPH_MAX` parts per assembly and within `EXPLODE_BUDGET_MS`
  (else O(n) axial mode); no explode above `EXPLODE_MAX_MESHES`; no per-part recursion or spreads.
- 3D: `mesh.material` may be an **array** (multi-material mesh); code that walks materials must
  handle both forms.
- Windows console children (ffmpeg, powershell, cmd) get `creationflags=NO_WINDOW` (defined in
  `fileinfo.py`); the app has no console, so each would otherwise flash a console window.
- ffmpeg is found in a background thread at startup: read it through `lib.ffmpeg_exe()` (waits for
  the search, retries when none was found), not `lib.ffmpeg`.
- `thumb_version()` is cached in memory, a missing file as 0 too (re-checked after 30 s;
  `prioritize` regenerates a has_thumb asset whose file is gone). Code that writes a thumbnail calls
  `thumb_version(aid, fresh=True)`; code that finds or writes one marks it with `_mark_thumb(aid)`
  (never `_have_thumb.add` directly — it also drops a cached 0); code that deletes or invalidates one
  calls `_forget_thumb(aid)`.
- PSD and PDF thumbnails render in 2 worker processes (`HeavyWorkers` in library.py, used through
  `Library._heavy`; module-level `render_psd_thumb` / `render_pdf_thumb`, `_heavy_child`): psd_tools
  and MuPDF hold the GIL and made the whole server sluggish from the thumbnail threads. Not a
  ProcessPoolExecutor: its jobs cannot be killed and its exit hook waits for them (a hung PSD kept the
  process alive). Workers are spawned (never fork), daemonic, started on demand, stopped after 60 s
  idle; a job that times out (120 s from when a worker takes it) or kills its worker is remembered by
  path + mtime and skipped for the session — never re-rendered in the server process. Only when
  processes cannot start at all does a thumbnail render in the thread. `Sight.py` calls
  `multiprocessing.freeze_support()` first thing (frozen builds start children as the exe itself);
  nothing at module level in Sight.py or app/library.py may have side effects (a spawned child
  imports them).
- No FastAPI / pydantic (they cost ~0.5 s per start): `app/web.py`'s `App` keeps FastAPI's decorator
  shape. Handler parameters are filled by name from the path, then the query string, else their
  default; annotations are read as strings and only `Request`, `int`, `float`, `bool` matter (bad
  value → 422); plain `def` handlers run in the thread pool, `async def` on the loop (keep blocking
  library calls out of `async` handlers or wrap them in `asyncio.to_thread`); a Response goes out as
  is, anything else as JSON; `HTTPException` → `{"detail": ...}`.
- Startup scan: watchers start at once, the catch-up walk of every source waits until the first
  `GET /api/assets` is served (`Library.first_page_served`) or 3 s, so it does not compete with the
  first paint.
- Grid refresh: `pull()` only appends (offset = loaded count); `refreshItems()` (on scan batches and
  review changes) re-reads by id (`POST /api/assets/by-ids`) only the cards on screen, the inspector's
  and the lightbox's asset, and marks every other loaded item stale (`staleIds`); a stale card is
  re-read when it comes on screen (`refreshStaleVisible` from `renderGrid`). `/api/assets` caps
  `limit` at 800, so never re-read "the first N". Masonry positions are extended, not recomputed,
  while `pull()` appends to the same array.
- Launch order in `Sight.py`: bootstrap → `listen_socket()` → browser started in parallel → server
  imports → `server.run(sockets=[sock])`. The browser's first request waits in the socket backlog.
  Keep heavy imports (numpy, psd_tools, pymupdf, usd) out of the startup path: import them inside
  the function that needs them.

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
  snap to the dot grid; frame handles: resize on the corner nearest the cursor, opposite corner pinned (single: free, Shift keeps asset ratio;
  cropped: proportional; Shift on a cropped item drops the crop), top knob rotate; multi-selection
  scales uniformly / rotates about the common box.
- Crop: hold **Alt** over an item → grips on edges/corners (drag = crop that edge, picture stays put; drag
  back out to restore); **Alt+drag on the picture** pans it inside the crop. Rendering: cropped `<img>` is
  sized by width only (`width = 100/crop_w %`, `height:auto`, `translate(-crop_x, -crop_y)`), so it can
  never be stretched; an uncropped item shows a cover-fitted image, and `cropBasis()` starts a first
  crop from exactly that window (no jump). Mirror flips the whole thumb area (crop stays in
  un-mirrored source coordinates; `cropAxis` accounts for flips and rotation).
- Resolution: items load `/api/thumb` (360px). `syncResolution()` (debounced via `scheduleResCheck()` from
  `worldTransform`, `layoutItemEl`, img `load`, window resize) swaps a visible item's `<img>` to the original
  (`fullResUrl`: `/api/file` for browser-decodable rasters, `/api/psd/{id}/preview` for PSD; no SVG/TIFF/HEIC)
  once the shown source width in device px exceeds 1.25× the thumbnail's, and back below 0.8×. State lives in
  `img.dataset` (`res` = thumb/loading/full/failed, `thumbW`, `fullW`); at most 3 decodes at once, nearest the
  view centre first. An original more than a screen away from the view goes back to the thumbnail too
  (panning a zoomed-in board kept every original it passed decoded). The original has the same aspect,
  so crop maths is unaffected.
- Shortcuts (canvas.js `KEYMAP`; PureRef-compatible where PureRef has one): F frame selection, A frame
  all, Ctrl+A select all (index.html), Ctrl+arrows align, Ctrl+Alt+arrows normalize
  height/width/size/scale, Ctrl+Alt+Shift+↑/↓ distribute row/column, Ctrl+P arrange optimal,
  Ctrl+Alt+N/A/O/D/R arrange by name/addition/order/path/random (repeat reverses), Ctrl+Alt+S stack,
  ↑/↓ front/back, `[` `]` one layer, X/Delete/Backspace delete, Ctrl+D duplicate (new instance),
  Alt+X / Alt+V mirror, Ctrl+Z / Ctrl+Shift+Z undo/redo. Align = "gravity" (items stop against each
  other, padding 10) and Normalize separates overlaps, so results never overlap; Stack overlaps on
  purpose.
- Not built yet (planned): annotations on boards (the lightbox has them, see below), groups UI,
  frames/connectors, opacity/desaturate UI, export, real multi-user/sync (groundwork only:
  revision/updated_at/deleted_at columns, single mutation path).

## Annotations / review (lightbox)

**Data** — rows of `annotations` with `scope='asset'`, `target_asset_id` = the asset. `kind` /
`shape_kind`: `stroke` brush|pencil|marker (`data.pts` = flat `[x, y, pressure, …]`), `shape`
rect|ellipse|line|arrow, `text`, `pin`, `note` (the review comment: `text, author, created, status
open|progress|done, status_at, edited_at, shots: [shot ids], replies: [{id, text, author, created,
edited?, deleted?, shots?: [shot ids]} | {id, event: "done"|"progress"|"open", author, created}],
from?: {id, asset, name}` when copied from a previous version — `event` entries log state changes
in the thread and are never edited; reply pictures are review_shots like a note's, packed into
`.srev` `shots` by `build_package` and remapped on import), and
`status` — the asset's review state (`data.state` review|changes|approved|null, `data.history`
[{state, author, at}] with state "" = cleared; the newest row wins, `Library.set_review_status`
keeps one row per asset, appends to the history and on clear keeps the row with state null; it is
not an editable item in annotate.js). A drawing points at its note with `data.note`. Ids are 16 hex chars
made by the client; `POST /api/annotations` with an existing id revives the (tombstoned) row — undo
of a delete relies on that. The x/y/w/h columns hold the drawing's bounding box only for queries;
the geometry is in `data`.

**Coordinates** — "doc" units: image/video pixels (the viewer's `geom()` = `{x0, y0, s, w, h}` from
`attachViewer`); 3D: screen space of the 3D host, 1000 units high, origin at the centre (the
perspective camera keeps its vertical fov, so this holds across resizes). Sizes in tool styles are
screen px and are converted on creation (`LEN_KEYS`), so a 4 px brush looks 4 px at any zoom.

**Context** — `data.ctx`: video `{t, hold}` (visible from t for max(hold, one frame); hold −1 =
whole clip), 3D `{vk, cam:{p,t,fov,turns}}` (+ `v3d`, a copy of `state.v3d`, on notes). A 3D
drawing shows only while the live camera matches its view within 0.4 % of the camera distance
(`camMatch`); orbit damping is switched off while annotating so the camera stops exactly. Images:
no context, always visible.

**Format** — the rows, package and merge rules are specified in `docs/FORMAT.md` (the contract with
the HTML page, the mobile app and the owner's tracker). A drawing made on a reply carries
`data.reply` besides `data.note`; annotate.js hides it with a deleted reply / the reply's eye toggle
(`S.hiddenReplies`, session only) and deletes it with the reply.

**Shared core** — `app/static/review-core.js` is a plain script (no imports, sets
`globalThis.SightReviewCore`, `module.exports` under Node) holding the geometry → primitives
(`primsOf`, `primSvg`, `primCanvas`, `drawCanvas`, `svgMarkup`), bounds / hit tests / transforms,
`validItem` and the JS merge (`mergeRows`, `mergeReplies`, `mergeHistory`, `contentAt` — a port of
`Library.import_annotations`). annotate.js imports it for its side effect and destructures the
global; `review.build_html` inlines it verbatim into the HTML page (`core_js()` refuses a source
containing a closing script tag or an HTML comment opener). `tests/test_merge_parity.py` runs the
Python and the JS merge on `tests/fixtures/merge_cases.json` and compares every row.
`ctxVisible(c, at)` is the one visibility rule for a context on a frame (`{t, fps}` video, `{vk}`
3D, null = picture); annotate.js `visibleNow` goes through it. `drawingRow(it, at)` makes a
FORMAT.md row (bbox columns from `boundsOf`) from an editor item.

**Transform (select tool)** — `review-core.js` `xfBox / xfHandles / xfAt / xfStart / xfDrag /
xfSvg / XF_CURSOR / snap15`: handles, hit test, the drag math (move, 8 scale handles, rotate, line
ends / bend) and the selection markup, shared by annotate.js (screen-px overlay: `map` = toScreen,
`u` = 1) and review-draw.js (doc-unit overlay: sizes × doc-per-px). While the rotate knob is
dragged, `D.at` = the pointer: the knob is drawn there with an arm from the pivot (the box centre),
the angle is atan2 about the pivot, so a longer arm turns finer.

**Drawing canvas** (`app/static/review-draw.js`, `SightReviewDraw.open`) — shared by the HTML page
(inlined) and the phone app. Tools: select / transform (`V`), brush, highlighter, arrow, rect,
ellipse, **text**, eraser (Ctrl held = eraser for that stroke). The bar (`.dtools`) is built from
`SLOTS`: two slots hold kinds — *Arrows and lines* (`ARROWS`: heads / dash, `line` = shape_kind
"line") and *Shapes* (`SHAPES`: rect / rounded / ellipse, outlined or filled); `pen.arrow` /
`pen.shape` (saved with the pen) pick the kind, `pen.tool` stays the drawing tool key (arrow /
rect / ellipse). A tap on a slot shows its row (`.dfly`, above the bar); a pick, a touch on the
picture, another slot folds it. The rows are `.dfly.rd-panel` (the bars' own look). The *Text*
slot's row is switches (`TEXT_OPTS`: bold, italic, underline, `bgOn`, outline = 6 % of the size,
align cycles; the box and the font open a second row `.dsub` above it — `openSub`: none + the box
colours `TEXT_COLORS` / `FONT_IDS`) on `pen.text` (also `bg`, `outlineColor`). The Shapes row ends with
*Fill colour* (`fillButton` → `subRow("fill")`): `pen.fill` (null = the line's colour at 0.3, else
that colour at 0.6), saved with the pen; recolouring a selection moves a fill only when it
followed the line (saved with the pen, used by a new text); a switch also styles
the text being typed (`edit.it.data`, restored from `edit.before` on cancel; `commitText` compares
`styleOf`) or, with select + texts selected, those texts (copies, one undo step). While typing,
`mousedown` on the slot / row is prevented so the field keeps the focus (the phone keyboard), and a
resize does not fold the row. `closeFly` hides the row at once and removes it a tick later: the
picking click is still on its way to the host's document handlers, and a detached target reads as
"outside the canvas" (the HTML page then closed an empty new-note draft). The colour is the
`.dcol` circle at the row's end with the colours in its flyout (`useColour`). The trash deletes the selection,
else every item drawn here (one undo step). Undo keeps whole `items` arrays: a transform drags
*copies* of the selected objects (`stroke.prev` restores on a tap / cancel), never objects an undo
state holds. View: `screen = V.o + Rot(V.r)·diag(V.z·V.m, V.z)·(local − box centre)` (`fwd0` /
`inv` / `pin` keep a local point under a screen point for pinch, wheel, right-drag zoom); two
fingers zoom + pan + turn (snaps to quarters within 6°), the top bar mirrors / fits (no turn
button since 0.33; fit straightens to the nearest quarter, the box size swaps on 90 / 270).
`o.view {rot, mirror}` opens it that way, `o.onView` hears the mirror button (it reports the
host's quarter `viewR` unchanged; a two-finger turn goes back through `onNav`). The text field lives inside the
transformed box (box px = doc / (vb.w / BW)), so it turns and zooms with the picture. Text:
the field opens on pointer *up* (iOS shows the keyboard only from a touch-end gesture), a tap on a
text drawn in this session edits it, a tap elsewhere / Done / Esc commits, empty text removes it;
Sight's text defaults (dark box 0.6, size 24 screen px at the current zoom → doc units).
The bars float over the picture (`.dtop` / `.dbar`, colours from the host's `--rd-bg / --rd-ov /
--rd-fg / --rd-line`, dark by default); fit centres the picture between them when it fits there,
else on the whole screen — unless the host passes `o.fitBox()` (a viewport rect: the picture is
fitted into it with no padding, bars ignored) and `o.nav {z, r, o}` (its own zoom / extra turn /
offset from that fit, opened with; `o.onNav` gets the view back on close, relative to the fit
centre and the quarter turn last reported by `onView`). Gestures: hold (450 ms, touch / pen, ≤ 8 /
4 px) with a tool → `adj`: the stroke it began is aborted, then one axis per hold (the first
10 px): a vertical drag sets `SIZE[tool]` on a log scale (screen height = `SIZE_RANGE` ratio), a
sideways one `OPAC[tool]` (0.05…1, 0.8 × width = full range; none for the eraser, always size; new
items take `OPAC`), preview `.dsize` on the left ("px · %"); with select +
a selection, copies are adjusted (one axis per hold: y = width key `WKEY[kind]` ×16 per screen,
x = opacity), one undo step. When a pinch / pan / right-drag zoom ends (`settleView`, the
player's rule): z < 1 → fit with the turn to the nearest quarter, z < 1.04 straight and < 24 px
from `fitC` → exactly fit; eased .2 s (transform / size), started from the angle nearest the
target so 0° / 360° never spins round; any move clears the ease (`unease`). The wheel stops at fit
and recentres there. Sizes are per tool (`SIZE0` defaults), saved with the pen
(`sight-review:pen` `sizes`, `opac`); a hold on a tool button resets that tool's size and opacity. Two / three touches
down and up within 400 ms, none moved 14 px → undo / redo, the view restored to before (`tap`).
`SightReviewDraw.pinch(g, a, b)` is the two-finger zoom / turn rule, shared with the phone player. A tap on the tool in hand puts it down (`pen.tool = null`, never saved;
each open starts with the last real tool): one finger then calls `o.onScrub({phase, dx, dt, fine})`
if given, else pans; such a finger that comes up within 500 ms having moved ≤ 10 px calls
`o.onTap()` (the phone: play / pause). `o.onTool(tool)` hears a tool taken up / put down;
`handle.live(node)` puts a host node (`.dlive`) in the picture's place (`.dbox.live` hides the
img), `live(null)` takes it out. Video sessions: `o.frameKey` + `o.frames {key: items}` make it multi-frame —
`store` keeps each other frame's `{items, undo, redo}`, `handle.setFrame(key, src, pending)` swaps
them (and the picture, dimmed while pending), `o.onFrames(keys)` reports frames holding drawings,
`o.footer` sits above the tools, `o.onKey(e)` lets the host take keys; Done → `onDone(items,
[{key, items}])`. `open()` returns `{setFrame, close, live, frameKey}`.

**Visibility on the desktop** (annotate.js) — `ctxShown(it)` is the base rule (ctx on screen,
reply not hidden / deleted, its note still exists — a drawing of a deleted note never shows);
`visibleNow` adds the view mode (`viewMode()`, cached per microtask, reset in `afterChange` /
`paintVisibility`): **compose** (the note field focused or filled, a stroke / shape being drawn, a
new text, screenshots or unattached drawings waiting) shows only unattached drawings = a clean
picture for the new note; **pin** (a note clicked) only that note's; **hover** dims the others.
Hit tests, the eraser, selection and "clear on screen" follow `visibleNow`; reports and exports
use `ctxShown` (every drawing on that frame). Cards show the note's own drawings (and each reply's)
over the clean picture / a video frame from a hidden second player (`previewFrame`, per asset).
A note may hold drawings on several frames / views (each row keeps its own ctx): `pendingDrawings`
= loose drawings shown now + every loose one created since `S.openedAt` (any frame / view);
`notePreview` makes one box per frame (`data-pt` on the extra ones: a click goes there);
`gatherReport` adds `more [{frame, size, caption, ctx}]` per note (review.py: PDF after the
note's frame; the page's `frameOf("<id>|<i>")`).
The lightbox view's **turn / mirror** (index.html `attachViewer`: `turn {rot, mir}`, localStorage
`sight.viewTurn`, newest 500 files) is a CSS prefix about the window centre on the media and on
annotate's layer root (`geom().turn`); `unturn(x, y)` maps the pointer back, so pan / zoom and
annotate's `local(e)` / `toDoc` work in the unturned frame. Doc units never change.

**HTML reviewer page** (`review._HTML_TEMPLATE`, built by `build_html(report, pkg)`) — the report
comes from `gatherReport(true)`: **clean** pictures (no drawings burned in) — `cover` (images /
PSD, ≤2000 px) + `coverSize`, per note `frame` (video frame ≤1600 px, or the 3D view capture) +
`size`, reply `id`s, and `media: {kind: image|video|model3d, w, h, fps}`; picture notes get no
frame of their own (the page shows the cover with the note's drawings). The PDF uses
`gatherReport(false)` and still burns drawings in. The page draws the package's drawing rows with
review-core as an SVG overlay (`.ov`, `viewBox` in doc units: `0 0 w h` for pictures / video —
frames are the whole media scaled; `-500·a -500 1000·a 1000` for 3D, a = frame aspect). Frames
(`frameOf(key)`): `"cover"` = every drawing (the page shows the cover itself clean — gallery
entry `clean: true` — the drawings are on the note pictures); a note id = picture notes: the cover filtered by
`data.note`; video / 3D: everything `ctxVisible` at the note's `ctx`. Its drawing canvas
(`drawSheet`) edits items in the same doc units, on the clean picture (`base: []`) for a new note
or reply, and opens turned / mirrored as last left (localStorage `sight-review:view:<asset id>`); drafts keep `{frame, items}`; sending turns them
into rows in `E.rows` (localStorage) with `data.note`, `data.reply` (a reply) and the frame's ctx
(`drawCtx`: video `{t, hold}` of the note, 3D `{vk, cam}`); a new note drawn on a frame takes that
note's whole ctx. *Download reply* merges `E.rows` like any other row (`RC.mergeRows`). Drawing on
an attachment is flattened into a new JPEG attachment (`drawFlat`): attachments have no doc space.

**Rendering** — every object becomes primitives (`primsOf`) that both the SVG overlay (`primSvg`) and
the canvas compositor (`primCanvas`, screenshots and PDF frames) draw, so they match. The overlay is
two SVGs in the viewer's surface (`.view` wrap or `#light3d`): `an-doc` (viewBox = the visible doc
rect) and `an-ui` (screen px: selection, handles, marquee, brush cursor, region). Brush/pencil are
filled outlines from per-point radii (pressure, or a taper for mouse strokes); the highlighter is a
stroked path.

**Input** — capture-phase listeners on the surface take left-button / pen gestures before the
viewer's own pan/scrub/play/orbit handlers (`stopImmediatePropagation`); middle/right and, in 3D,
select-tool drags on empty space pass through. `pointerType === "pen"` strokes store pressure;
`buttons & 32` (pen eraser end) erases. Keys: `annot.onKey(e)` runs first in the document keydown
handler while the lightbox is open (A / Shift+A toggle is in index.html: plain A in 3D flies the
camera).

**Host hooks** — `createAnnotator(host)` gets `api, putSetting, registerAutoClose, toast, getV3D,
setV3D, openAsset, onModeChange`. The lightbox calls `mount` / `unmount`, `setAsset(a)` (before
`fillStage`), `attachViewer` calls `bind2d({wrap, media, isVid, geom})` + `viewChanged()` from
`apply()`, `boot3d` calls `bindAnnot3d` → `bind3d({aid, host, getCam, setCam, capture,
annotating})`; `capture()` renders and returns the WebGL canvas in the same task (no
preserveDrawingBuffer needed). The camera rig has `getView()` / `setView()` for this.

**Review API** — `POST /api/review/shots` (raw PNG/JPEG body → `{id, url}`), `GET
/api/review/shots/{id}`, `POST /api/review/export/pdf` (client sends notes + JPEG data URLs; server
lays out HTML with PyMuPDF `Story`, which brings fallback fonts for Cyrillic/CJK), `POST
/api/review/export/package` (server builds the `.srev` JSON from the rows + shots; legacy `.sightreview` files still import),
`POST /api/review/export/html` (the page's report: clean pictures + `coverSize` / `media`, see
"HTML reviewer page"; the page embeds the report and the package, see `review.build_html`), `POST /api/review/import` (raw file body; asset matched by id,
else name+size, else name+kind; 404 `{missing}` if no match). Import **merges**
(`Library.import_annotations`, one transaction, rolled back on a malformed row): rows keep their
ids (an id that already belongs to another asset gets a stable derived one), the later **content
stamp** wins (`_content_at`: a note's `data.edited_at`, else `data.created`; a drawing's
`updated_at`), a local delete beats an incoming row not edited after it, package `deleted`
tombstones delete rows not edited since, a note's replies are always unioned by id
(`merge_replies`; deleted replies stay as tombstones) and its open/done state goes by
`data.status_at`; a status row's `history` is unioned (`merge_history`). So a reply or a resolve never makes a stale copy of a note's text win, and never
revives a deleted note. annotate.js sets `edited_at` on text / screenshot edits and `status_at`
on resolve. The import route matches the asset by package id, then the asset already holding most
of the package's row ids (`asset_holding_annotations`), then name+size / kind. Shots keep their ids
(`put_shot`; a non-hex id becomes a content hash and `data.shots` is remapped).
`GET /api/assets/{id}/versions` (`Library.asset_versions` / `version_key`: same folder, same name
once the last v/ver/version/rev/r + digits token is cut out), `PUT /api/assets/{id}/review-status`.
`GET /api/assets` takes `review=open|review|changes|approved` and returns `review` / `open_notes`
per item (subqueries `_REVIEW_SQL` / `_OPEN_NOTES_SQL`); `/api/state` counts carry `review_*`.
Moving / renaming a file (`_migrate_asset`) re-targets its annotations.

**Compare** (`compare.js`, `createCompare(host)`) — a fixed overlay above the lightbox (z 60).
Every layer's media is placed in the reference layer's frame (`object-fit: contain`, shared
zoom / pan as doc-normalised centre + zoom over fit). Swipe: the reference is drawn whole at the
bottom, every other visible layer is clipped to its region (`clip-path: inset`) — region i belongs
to visible layer i — with `mix-blend-mode: difference` in Difference mode; tile layouts put a copy
of the reference under each cell for the same effect. Video: `C.T` is a wall-clock timeline;
layer local time = T − start/fps; `syncVideos()` nudges playbackRate for drift < 0.25 s and seeks
beyond, pauses clips outside their span (dimmed). Keys go through `cmp.onKey` first while it is
open and do not reach the library / lightbox.
Exports land in `~/Downloads` (else `<SIGHT_HOME>/exports`) and are revealed in the file manager.

## Phone app (mobile/, PWA)

"Sight Review" — local review on the phone (docs/PLAN-mobile.md stage 3). Plain HTML + ES modules,
no build step; `tools/build_pwa.py` assembles `dist/pwa/` (what GitHub Pages serves): `mobile/` plus
`app/static/review-core.js`, `review-draw.js`, `keys.js` and `favicon.svg` copied to `core/` /
`icons/`, and fills `%%VERSION%%` (APP_VERSION + a hash of every file) into `index.html` /
`sw.js` and the file list into `sw.js`. Relative URLs everywhere (it runs under `/<repo>/`).

- **Modules** (`mobile/js/`): `app.js` UI (home list, review screen, transport, cards, composer,
  viewer, exports, SW banner); `model.js` every change to the rows + `.srev` build / parse / merge
  (pure, Node-tested); `store.js` IndexedDB; `media.js` file kind / identity / probing / frame
  grabbing; `mp4.js` fps from the MP4 container; `report.js` report content + static HTML + PDF
  layout; `pdf.js` the PDF writer. review-core / review-draw are classic scripts loaded first
  (globals `SightReviewCore`, `SightReviewDraw`); keys go through `core/keys.js` `runHotkeys`.
- **Identity**: a review per media file, `key = assetKey(name, size)` = first 16 hex of SHA-1 of
  `lower(name) + "\n" + size` (mtime deliberately out: iOS reports the pick time for Photos).
  Re-picking the same file finds its review; Sight matches the app's `.srev` by name + size (its
  `asset.id` is the key, `path` = the name). A review imported from Sight keeps Sight's `asset`
  (id, path) so exporting back matches by id; its local key is still name + size.
- **Storage** (IndexedDB `sight-review`): `reviews` (list entry: asset, fps, counts, thumb data
  URL, kept / keepAsked), `rows` (`{key, rows}` — FORMAT.md rows plus `deleted_at`, tombstones
  kept like Sight's table), `shots` (`{id, blob}`), `frames` (clean pictures by `key|img` = the
  picture ≤ 1600 px and `key|t=<sec 3 dp>` = video frames, so cards / reports work without the
  file), `files` (the media: kept automatically when a file is picked — `autoKeep`, after the
  review is on screen; not when `meta.noKeep` (⋯ *Forget the file*) or the copy would take the
  storage past 90 % of the quota — then a hint says the review will ask for it again).
  `openReview` binds the kept copy when no file is passed; none → the stage's *Pick the file*. Saves are debounced 250 ms
  (`dirty()` → `flush()`), flushed on `visibilitychange: hidden`, `pagehide`, before opening /
  importing / exporting; a failed write stays pending and is retried (3 s / next flush). store.js
  reopens a lost connection (iOS drops it in the background) and retries a call once.
  Async work holds its own review (`rv`) and checks `R === rv` before touching the screen;
  `openReview` has a sequence number (the latest tap wins); late writes go through `putIfAlive`
  (not into a review deleted meanwhile). Back while the canvas / viewer / a sheet is open does not
  leave the review (`route`). `navigator.storage.persist()` is asked on the first file.
- **Rows** are written in Sight's shapes (`model.js`): `newNote`, `addReply`, `setNoteState`
  (status + `status_at` + an event in the thread), `editNote` (`edited_at`), `deleteReply` (reply
  tombstone `{id, created, deleted}` + its drawings' `deleted_at`), `deleteNote` (note + its
  drawings), `drawingRows` (review-core `drawingRow`, `data.note` / `data.reply` / ctx),
  `setReviewState` (= `Library.set_review_status`: one live status row, history unioned).
  Import = `mergeRows` with the package's `deleted` and a shot-id map (non-hex ids → SHA-1 of the
  bytes, as `review.put_shot`); the target review is the one holding most of the package's row
  ids, else name + size, else a new review from the package's asset (it then asks for the file).
- **Layout**: `#app.review` is fixed full-screen; `.slide` = `.player` (height `--ph` = viewport −
  `--pbh` 30 px; with `.compose` — a new note open — also − `--nbh`, the new-note bar's measured
  height) + `.pbar` (Notes Panel) + `.plist` (the scrolling list). `R.panel` (`setPanel`) adds
  `.open`: the slide moves up by `--ph`, the bar grows to hold the filters. The new-note bar is
  slid away (transform + visibility, so it keeps its measured height) unless `.open` or
  `.compose`. Back to the player: pull the list down from its top (`bindPanelPull`: a touch that
  started at scrollTop 0, > 60 px down; wheel up at the top after 300 ms without scrolling). The
  header (`.hdr`) and transport (`.tp`) float over the player, inset 8 px, on the canvas' bar style
  (`.rd-panel` from review-draw.js, put in the page by `DRAW.css()`; one style for both screens,
  half see-through via `--rd-ov`); they take the touches over their whole area.
- **Stage gestures** (`bindStage`, once per stage element): one finger — sideways ≥ 6 px scrubs
  (video), up 40 px opens the panel, down 60 px leaves the review, a tap = click (video: play /
  pause; picture: full screen). Two fingers: `R.pv {z, r, o}` (view only, not saved) as a CSS
  transform on `.sv` (wraps img / video / scrubimg / svg; `turnEl` still turns the children by
  `R.meta.view`); the finger left after a pinch pans; z < 1 snaps back to fit. The header's Fit
  button shows when not fitted. The pencil is a `.fab.pencil` in `.player` (bottom right; on a
  video `applyStageView` lifts it above the transport), matching the viewer's. `drawCanvas` passes `playerPlace()` (fitBox = the stage rect,
  nav = `R.pv`, onNav sets it) when the player is on screen (panel closed, no viewer).
  The root never scrolls (a scroll listener resets it); the list scrolls inside `.plist`.
  Themes: `html[data-theme=light|dark]` (Settings, `sight-review:theme`), none = system; the
  stage, overlays (`--ov*`) and the canvas (`--rd-*`) follow it.
- **Home open buttons**: the big `.opens` pair only while there is no review at all; otherwise the
  two small icons in the bar (`.mini`). One set is removed once the list is in (no scroll
  switching). Labels carry `pick-media` / `pick-file` (tests use them).
- **Home list**: `reviewRow` — swipe left / right uncovers the bin / eye (`.sw`), hold + drag
  reorders (`sight-review:order` in localStorage, new reviews first), hide for now =
  `sight-review:hidden` in sessionStorage. While dragging, the DOM is not reordered (that drops the
  held card's pointer capture): other rows slide by transform (by the held row's height), the row
  moves on release. The gestures live in `rowGestures(row, it, o)` (`o.open`, `o.menu`,
  `o.group`), shared by review rows and group headers (`groupHead`, no swipe).
- **Home taps / selection**: a tap acts on `pointerup` (`tapAct`; the click after is eaten — a
  click got lost when the page changed under the finger, e.g. right after a swipe back from a
  review), a click with no pointer (keyboard) acts on the click. A tap on a card toggles
  `homeSel` (`.sel`), on its picture (`.th`) opens the review; `.selbar` (Move to… / Hide /
  Delete) acts on all picked.
- **Review groups**: `sight-review:groups` = `[{id, name, keys, open, thumb?}]` (localStorage;
  `thumb` = `{url}` a ≤ 200 px data URL or `{color}`); the order list holds a group as
  `"g:<id>"`. Any review (on its own or a member) held over the middle of another visible row's
  `.item` (`st.targets`: not its own group / siblings / the picked ones) and let go →
  `moveInto(keys, on)` (a review on its own → new group in its slot; a header or a member → into
  that group); a picked review takes every picked one. `groupKeys` / `takeOut` serve *Move to…*. `tidyGroups` (each render) drops keys of deleted reviews
  and dissolves groups under two members, putting the rest back in the group's slot. Members are
  ordinary rows in `.gm` (reorder among themselves → `g.keys`); a lifted group header is `.folded`.
- **Full screen** (`enterFS` / `fsUp`): Auto (`sight-review:fs` ≠ "0") requests full screen on the
  `pointerup` (capture) of a plain one-finger tap (≤ 12 px, ≤ 600 ms, no other pointer down; not
  on labels / inputs / text fields / links / sheets / `[data-nofs]` — the file picker), where
  `fsCan()` (the API exists, not standalone, not iOS). A full-screen exit the app did not ask for
  (Android back, Esc) disarms it until the next screen (`fsArm` in `renderHome` / `openReview`).
  Settings: Auto / Off.
- **Notes order**: by `data.created` for every kind (`notesSorted`, same in annotate.js) — numbers
  match Sight; the frame does not count.
- **Frame math** (`model.js frameIndex / frameTime`, same rule in annotate.js): a stored time is
  `(n + 0.01)·fd` to 3 dp and may round below `n·fd`; `frameIndex` recognises it (within 0.6 ms)
  and keeps frame n, other times are floored. Seeks go a quarter into the frame (`pumpSeek`;
  annotate.js `landAt`), so the player shows frame n whatever the rounding.
- **Video**: every playhead move goes through `seekTo(t)` (frame steps, marker jumps, the timeline,
  scrubs): snapped to its frame (`snapT`, never past the clip's last frame), shown at once
  (`R.scrubT` drives timecode, playhead, overlay; the ScrubCache frame), one seek in flight and the
  latest wanted time next (`R.want`, `pumpSeek`); `settle` when it lands and nothing is dragged
  (`R.dragging`). `posNow()` = the pending / shown time, so quick steps add up. The timeline
  (`makeTransport`, `.tl`) puts markers, cache bar and playhead in the same track percent; a tap
  within 10 px of a marker lands on it. Its row: ‹ ◀ `fps` timecode `snd` ▶ ›. `vdrag(button,
  {begin, move(dy), tap, hold})` is the small vertical-drag control (pointer captured, stage /
  canvas never see it). Speed = `video.playbackRate` (0.1…4, `R.rate`; shown as `fps × rate`;
  tap → `snapRate` to the nearest `COMMON_FPS` by ratio, hold → 1). Volume = `volLevel`
  (`sight-review:vol`, per device; `applyVol` on each video, 0 = muted; `volWorks` false on iOS
  → only mute / unmute); `.volbar` at the left edge while set. Sound present: `R.hasAudio`
  (true / false / null) from mp4.js (`audio`: a `soun` track), Safari `audioTracks`, Firefox
  `mozHasAudio` — final, stored as `meta.audio` (`audioSure`); Chrome: a guess after 0.25 s of
  unmuted play with no `webkitAudioDecodedByteCount`, taken back if sound decodes later, not stored. `markerList()` = notes (by state: red / yellow / green ticks),
  drawings on other frames (grey dots), and the frames of the open drawing session / new-note draft
  (accent dots) — while a session (`R.drawS`) or a new note (`R.newOpen`) is open, *only* its own
  frames (a clean timeline; marker jumps and the timeline snap follow it); while a reply is
  written over the player (`R.replyTo`) the note's thread frames (`threadFrames`: its tick, dots
  for the other frames it / its replies drew on) and the reply draft's. `paintNewBar` repaints
  the markers.
- **Reply over the player** (video note, video loaded): `startReply(n, at)` → `R.replyTo` (the bar
  is `replyBar`: label, frame chips, ×, composer `{key: note id, multi, here}` — the pencil opens
  `drawVideo` on the frame on screen), panel closed, seek to the thread's first frame. The stage
  shows the note's drawings + the draft (`stageDrawings`). `sendReply` writes one drawing set per
  frame drawn on, each with that frame's ctx. `composing()` = `R.newOpen || R.replyTo` (the
  `.compose` layout, `els.where`); starting a reply closes the new-note bar (its draft stays).
  `R.curNote` (set by a reply, `goTo`, `showNote`) keeps a card `.cur` while no note is on the
  frame shown. Picture notes / no video: the inline composer in the card (`R.openReply`). A sideways drag on the stage scrubs
  from the current position (`scrubStep`: ¼ frame per px, up to ×12 with finger speed, Shift ¼;
  starts after 6 px of mostly-horizontal movement; the click right after a mouse scrub is
  swallowed); a swipe up on the stage opens the panel. No play button in the transport (tap the
  picture / Space; the big one shows until first play). `togglePlay` first sends the pending /
  in-flight target (`R.want` / `R.scrubT`) to the player, so play starts on the frame on screen —
  but not when the player already stands on / is seeking to that frame (`currentTime` reads the
  target while seeking): setting it again restarts the decoder's seek from the keyframe;
  `.scrubimg` has `pointer-events: none` (it hides as its seek lands, often mid-tap). The player's time is
  the truth; the frame on screen is `floor(t/fd)`; stepping lands on `(frame + n + 0.01)·fd`
  and a new note / drawing ctx is `{t: frameStart(t), hold: 0}` = `(frame + 0.01)·fd` to 3 dp, so it
  shows on exactly that frame (same rule in Sight's annotate.js `frameStart` / `stepFrame`;
  both keep the raw time while the frame rate is still a guess); the overlay shows
  `ctxVisible(ctx, {t, fps})`. fps comes from the MP4 / MOV container (`stts` of the video track,
  averaged); otherwise it is measured while playing (`requestVideoFrameCallback`, gaps near the
  median averaged, snapped to a common rate within 1.5 %), 25 until then (shown as "≈25 fps").
  Frames for cards, reply drawings and reports come from a second hidden `<video>` (`Grabber`,
  one seek at a time) and are cached in `frames`.
- **Scrub cache** (`media.js ScrubCache`): after the video opens, a hidden muted player runs
  through the clip (rate max(1, min(4, duration / 20))) and keeps a ≤ 640 px JPEG of every frame it
  presents (`requestVideoFrameCallback`), keyed by the frame's own media time (`mts` sorted, `urls`
  by ms) — never on a grid of a guessed rate (a WebM's rate is unknown until played; a 25 fps grid
  lost every sixth frame of a 29.97 clip). Long clips keep frames at least `d / 1500` apart. After
  the pass, `fill()` seeks into every gap wider than 1.5× the usual step (≤ 600 seeks). In memory
  only, blob URLs. Shown in `.scrubimg` over the player while a seek is on its way: a drag shows
  `near(t)` (the closest), a step / jump only `exact(t, fd, n)` (that very frame, by
  `round(mt / fd)`) — a neighbour would look like a jump back. It is hidden only once the player has
  *presented* a frame of the new position (`hideWhenShown`: rVFC after `seeked`, ≤ 250 ms) —
  `seeked` comes before the paint (Safari), and hiding then flashed the old frame. Closed (URLs
  revoked) with the review / on re-pick. No rVFC (old WebKit): no cache.
- **Drawing on a video** (`drawVideo`): the canvas opens multi-frame over the paused player with a
  second transport (`makeTransport`) as its footer; `R.drawS {times, moved, settled}` ties it to
  `seekTo` — `moved(t)` shows that frame's drawings over the cached frame (not dimmed; dimmed only when no cached picture exists and the old one stays), `settled()`
  grabs the player's exact frame (`frameNow`, cached in `frames` under `frameTag`) and swaps it in.
  Done → `[{frame, items}]`; a draft keeps `{frame, items, more}` (`framesDraw`: earliest first =
  the note's ctx); sending writes each frame's drawings with that frame's ctx. *Edit the drawing*
  on a video note opens all its frames (`M.noteFrameTimes`); a changed drawing is replaced
  (tombstone + new row). Cards show the extra frames small; reports add them before the note's
  pictures. Replies stay one frame. With no tool, a tap (`onTap`) = `togglePlay`: while playing
  (`liveStart`) the player is painted into a ≤ 1280 px canvas (`h.live`) every presented frame and
  `h.setFrame(frameTag(snapT(mediaTime)), null)` follows it (each frame's drawings show); a plain
  pause (`rv.scrubT` / `rv.want` unset — a seek's own pause is seekTo's business) → `moved` +
  `settled` on the frame reached; `onTool` (a tool taken up) pauses; Done / Cancel pause and drop
  the canvas. `frameNow` never grabs while playing or seeking (it would cache a frame under the
  wrong tag).
- **Viewer**: no bar — floating `.fab` Back / pencil; no swipe closes it (Back, Esc, system back
  do). At fit, up / down calls `o.nav(±1)` (note frames: the next note in the list's order with a
  picture), left / right `o.side(±1)` (a video note's frames, `noteFrameList` = its ctx frame +
  `M.noteFrameTimes`, by r3; the caption's `.fr` says `time · f N · i / n`). `from0` (where it was
  opened) travels through nav / side; closing on another note or frame brings it forward
  (`showNote(n, t)`: seeks there, scrolls the card). The step is a cross-fade (`show(no, true)`):
  the next `.vb` is built and its image decoded (≤ `FADE_WAIT`) before `o` / `box` switch, then it
  fades in on top while the old box holds, fades and is removed; `busyNav` covers load + fade.
- **Thread viewer**: `threadItems(n)` = `{kind: "frame", t?, rid?}` / `{kind: "shot", id, rid?}`
  — the note's frames (`noteFrameList`; a picture: one, if it has its own drawings), its shots,
  then per live reply its drawn frames (`replyFrameTimes`) and shots. `openThread(n, item)` from
  any thumbnail (`sameItem` by frame key / shot id / reply); `loadItem` → {url, vb, rows, at}
  (a missing shot is skipped by the swipe); `threadView` → viewer opts (`view` null for shots: not
  turned; `text` = the reply's words; `onDraw` only on frames). Up / down: the next note's first
  loadable item.
- **Reply editing**: `M.editReply(note, rid, patch)` sets `edited` (the reply merge key);
  `replyMenu` (⋯ on a reply): text, drawing (`editNoteDrawing(n, rid)` — the reply's rows only,
  any frame on a video, the note's ctx on its own frame), add / remove shots, delete.
- **View**: `R.meta.view {rot, mirror}` (saved with the list entry) turns / mirrors the stage
  (`turnEl`: a 90 / 270 element gets the stage's swapped size, centred), the full-screen viewer and
  the canvas (`drawCanvas` passes `view` / `onView`). While a new note is open the stage shows only
  its own drawing (`stageDrawings`); canvases for a new note / reply / a note's drawing open clean.
- **Overlays**: the stage `<svg>` uses `viewBox 0 0 w h` + `xMidYMid meet`, which matches the
  media's `object-fit: contain`; card pictures use `preserveAspectRatio="none"` over the scaled
  picture (same aspect). Doc units are pixels of the picture as shown (`asset.width/height`; when
  the file is bound its probed size wins — rotation applied — over a stored one).
- **Exports** (`report.js`): `gatherReport` = Sight's `gatherReport(false)` content (cover with
  every drawing for pictures; a picture note's own frame only when there are several notes and it
  has drawings; video: the frame at the note's time with everything visible there except replies'
  drawings; each reply that drew: its frames — the note's own too — / the picture with only its
  drawings; replies, pictures). HTML: one file, data-URL images, no script. PDF: A4 laid out in points, each page
  drawn on a canvas at 2 px/pt with the device's fonts (any script) and stored as one JPEG per page
  (`pdf.js`, objects: catalog, pages, info, then page / content / image per page). Files are
  offered in a sheet with *Share…* (Web Share with a file — needs a fresh tap, hence the sheet)
  and *Download*.
- **Address**: the Pages site of `anurbis-dev` has a custom domain, so
  `https://anurbis-dev.github.io/sight-media-viewer/` answers 301 → `http://pixis.ink/sight-media-viewer/`
  (Cloudflare in front; HTTPS works but is not enforced). Use **https://pixis.ink/sight-media-viewer/**.
  A copy installed from github.io never updates (a service-worker script update cannot follow a
  redirect to another origin); over plain HTTP there is no service worker at all (the home screen
  says so, with a link to HTTPS — no automatic redirect: each origin has its own IndexedDB).
  Cloudflare sends JS with `max-age=14400`: the install precaches with `cache: "reload"` and the
  worker is registered with `updateViaCache: "none"`.
- **Service worker** (`sw.js`): precaches every file of the build (cache `sight-review-<version>`),
  serves cache-first, navigations get `./`; old caches are dropped on activate, `clients.claim()`.
  A new version waits; the page shows *Reload* and only then sends `{type: "skip"}` and reloads on
  `controllerchange` (the first install's claim must not reload). `reg.update()` on becoming
  visible.
