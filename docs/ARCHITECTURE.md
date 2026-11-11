# Architecture (stable facts)

For "what changed lately" see `RECENT.md`. Update this file only when something here stops being true.

## Layout

```
Sight.py                 launcher (venv bootstrap, window, port); --dev / SIGHT_DEV=1 = developer mode
app/server.py            FastAPI app; routes are closures inside build_app(lib, settings, dev)
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
app/static/compare.js    version compare overlay (swipe / tile / strips, over / difference, synced video)
app/static/keys.js       keyboard-shortcut helpers (hotkey / runHotkeys) — see rule below
app/static/defaults.json shipped default theme / tile size
docs/                    RECENT.md (changelog, newest first), archive/, this file, FORMAT.md (review data contract)
tests/                   test_merge_parity.py (python -m unittest tests.test_merge_parity; needs node)
build_exe.bat            Windows PyInstaller build (dist\Sight\Sight.exe); pauses skipped when CI is set
build_app_macos.sh       macOS build (dist/Sight.app); on Linux the same script gives dist/Sight/Sight
.github/workflows/release.yml  CI: all four platform builds + headless smoke test; tag v<APP_VERSION> publishes a Release
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
- `thumb_version()` is cached in memory. Code that writes a thumbnail calls
  `thumb_version(aid, fresh=True)`; code that deletes or invalidates one calls `_forget_thumb(aid)`.
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
  view centre first. The original has the same aspect, so crop maths is unaffected.
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
`POST /api/review/export/html` (same payload as the PDF; the page embeds the report and the
package, see `review.build_html`), `POST /api/review/import` (raw file body; asset matched by id,
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
