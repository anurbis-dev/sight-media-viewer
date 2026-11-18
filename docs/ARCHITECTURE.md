# Architecture (stable facts)

For "what changed lately" see `RECENT.md`. Update this file only when something here stops being true.

## Layout

```
Sight.py                 launcher (venv bootstrap, window, port); --dev / SIGHT_DEV=1 = developer mode
app/splash_win.py        Windows launch splash (out-of-process, stdlib ctypes) + its start/close helpers; app/splash.png = its picture
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
app/static/model3d-core.js 3D helpers shared by the lightbox and the phone app: applyTurns, frameObject3d, meshOrder,
                         buildExplodeRig / applyExplode, buildEnvTexture, per-format load helpers, ENV_PRESETS,
                         shading (applyBaseMaterial / applyXray / setWireOverlay), the selection highlight
                         (highlightMaterials / meshHighlight), the UV picture (createUvPainter, readbackCanvas,
                         textureQuad), the animation player (createAnimator), USD reading (parseUsd / usdAsSight) and
                         splat placement (SPLAT_EXT, SPLAT_FILE_TYPE_BY_EXT, SPLAT_QUATERNION, splatHome) (ES module)
app/static/compare.js    version compare overlay (swipe / tile / strips, over / difference, synced video)
app/static/keys.js       keyboard-shortcut helpers (hotkey / runHotkeys) — see rule below
app/static/defaults.json shipped default theme / tile size
docs/                    RECENT.md (changelog, newest first), archive/, this file, FORMAT.md (review data contract)
mobile/                  the phone app "Sight Review" (PWA, no build step) — see "Phone app" below
tests/                   test_merge_parity.py (python -m unittest tests.test_merge_parity; needs node);
                         test_pwa.py (phone app: build, pwa_unit.cjs, pwa_e2e.cjs round trip with Sight,
                         pwa_3d.cjs 3D on fixtures_3d.py's two-box GLB through SwiftShader, pwa_3d_formats.cjs
                         every phone 3D format incl. animated USD and splats; fixtures/parts_v001.usdz + parts.usdc,
                         anim.usda / anim_v001.usdz / skel.usda from fixtures/make_anim_usd.py);
                         test_usdz_convert.py (which .usdz the server leaves to the browser; needs usd-core)
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
  (one setting for every zoom: lightbox, canvas, text, 3D via `bind3dZoom` in index.html — OrbitControls'
  own dolly is off there — and version compare via `getZoomSettings`; `review-draw.js` / mobile keep their own),
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
  divider drag (library/board split and the lightbox UV split); with `move(e)` instead of `box`/`set`
  it runs in pixel mode — the sidebar / inspector edges (`#sideHandle` / `#inspHandle`, zero-width
  `.panel-handle` flex items over the panels' borders; widths `state.sideW / inspW` in `sight.layout`,
  limits `PANEL_W`, applied as `--side-w / --insp-w` by `applyPanelWidths()`; narrow-screen drawers
  ignore them); `attachViewer(stage, a, src,
  {embedded:true})` shows any picture with the image lightbox's pan/zoom/fit and returns
  `{fit, zoom}`; hover picks the pane that gets F/digits (`activePane`, `lightPane`).
  `attachPanScroll` handles nested scrollers (inner one wins via `e._panScroll`).
- Info panel / sidebar: The inspector is shown by `state.details` (wide) or `.open` (narrow drawer) via `toggleDetails()` / `applyDetails()`, driven by `#infoBtn`, the `D` key and the palette; its File block collapse is `state.navCollapse.inspFile`. The file counter is `#srcCount` in the Sources header (`statusHtml()`, repainted by `renderStatus()`). Sidebar row icons: `row(..., iconId)`, `KIND_ICON`.
- Theme (desktop look): every Settings knob is a key of `state.theme` (`DEFAULT_THEME`, overridden by
  `app/static/defaults.json`), turned into CSS variables by `applyUi()`. The default look is
  **Graphite** (Inter 13 px self-hosted in `vendor/fonts`, `--ctl-h` 30 px controls, blue `accent`).
  `accent` (selection, focus, active row, hover lines) is separate from `border` (frame colour) since
  0.54; a theme without `accent` falls back to `border`. Captions: `captions: "below"` puts name + one
  joined info line under the thumbnail, and `capMetrics()` is the single source of that block's height
  (CSS `--cap-n-lh / --cap-j-lh` and `layout()`'s `L.meta`, grid and masonry); `"over"` is the older
  overlay with `pack1/pack2`. `themeRev` + `migrateTheme()` move a saved pre-0.54 theme onto the new
  defaults key by key (`CLASSIC_LOOK` = old defaults; the "Classic" preset restores it).
  `secColor` / `secSize` style the `.sec` band (`--sec-fg` / `--sec-size`); a theme or preset lacking them gets
  fg / textSize-1 via `secFallback()` (loadTheme, preset apply and preset matching). The theme row
  (`renderThemeList`) shows the save button only while no preset matches; the last picked/saved preset is
  `state.themeBase` `{kind:"b"|"u", name}` in sight.layout. `saveTheme()` re-renders the row (signature-guarded).
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
- `GET /api/app-info` feeds the About dialog (brand mark button `#aboutBtn`, overlay `#aboutOverlay` reusing `.fb-modal`): version, frozen, python, platform, starlette, three (parsed from `vendor/three.core.js` `REVISION`), usd, ffmpegPath/ffmpegVersion (tool facts probed once, cached in `static_info()`), home, dbPath/dbBytes, assets, sources, thumbnails (top-level files in `thumbs/`), port, dev, uptimeSec, logPath. `/api/health` is only `{ok,name}`, so nothing is duplicated.
- Asset `status`: `ready` | `missing` (file gone) | `excluded` (hidden: inside an excluded folder,
  matched by the scan ignore list, or a compiled `.obj`). Excluded rows are kept so metadata survives;
  anything that revives rows must check both folder exclusion and `Library.hidden()`.
- Table `meta(key, value)` holds library-wide settings the backend needs without a page open
  (`scan_ignore`: the Settings → Scan Filtering ignore list, parsed by `IgnoreRules`).
  Effective scan rules = built-in filter + user list, merged in one place: `IgnoreRules(user_text, default_text)`.
  The built-in filter is `app/initial_filtering.ini` (bundled by build_exe.bat / build_app_macos.sh), replaced by
  `<SIGHT_HOME>/initial_filtering.ini` when it exists (`read_default_filter`; fallback: `SKIP_DIRS`). `scan_ignore` holds
  only the user list. `GET/PUT/DELETE /api/scan/defaults`; PUT/DELETE re-apply and rescan like `set_ignore`.
- 3D animation (`model3d-core.js` `createAnimator`, both viewers): one AnimationMixer on the model root,
  `set({clip, t})` / `seek` / `play` / `pause` / `tick(dt)`; the last pose is `duration − 1 ms` (a looping action
  at its duration shows time 0). glTF loaders copy `gltf.animations` onto the scene (cache clones keep them).
  With an explode rig every pose change puts the rig's parts at their rest positions, lets the mixer pose,
  takes those positions as the rig's bases (`it.pos`) and explodes from there — so explode and animation
  stack. Created right after the rig in both viewers (the model starts at clip 0, t 0). A view's pose is
  `ctx.anim` (FORMAT.md); the lightbox host gives the annotator `getAnim / setAnim / withAnim / getAnimState /
  setAnimState` (`bindAnnot3d`); its bar is `#v3dAnim` (`paintAnimBar`, outside `data-tools`: only with clips).
  USD clips (0.53, three's USDLoader: SkelAnimation, time-sampled translate / orient / rotateXYZ / scale /
  transform on Xform / Scope / Mesh prims, by prim name) survive `usdAsSight` only in its animated layout (below).
- 3D USD in the lightbox (0.53): `.usd` / `.usda` / `.usdc` are read in the browser (`loadUsd` → core `parseUsd`, the
  phone's reading — standalone layers find textures by base name through `/api/model-res`; referenced layers
  are not loaded). A `.usdz` goes to `/api/model-glb` (server conversion, `usdz_convert.py`) first and falls back
  to `loadUsd` on any failure; the server answers **409** for a stage the browser plays as animated
  (`_stage_animated`: what the loader makes clips of — a suffixed `xformOp:transform:*` counts only in a binary
  root layer, since the loader's text parser gives it no clip), remembered by `thumbs/usdz/<aid>.anim` (mtime-fresh,
  cleaned like the cached `.glb`; `USDZ_CONVERTER_VERSION` 3). `cloneModel` copies a USD root's `skeleton`.
- Lightbox 3D explode (`model3d-core.js`, shared with the phone app): `buildExplodeRig` solves an explosion graph per assembly level of the node
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
- Video playback: `/api/file/{id}` (and the focus / cache endpoints) serve `lib.playback_path(a)`, which is
  the source or its converted copy in `thumbs/video/<aid>_<size>_<mtime_ns>.<ext>`. The copy is made
  only when the browser fails on the source: the player calls `POST /api/video/transcode` (see
  `app/static/video-playable.js`), then polls `GET` until `ready`. Any new `<video>` that plays library
  files needs the same fallback (`convertForPlayback`), or it shows nothing for the codecs above.
- Scrub copy (lightbox, `attachViewer` `loadScrubCopy`): a browser seek decodes from the keyframe
  before the target, so a long-GOP clip costs ~0.9 ms per frame of distance (416x960 H.264; ~230 ms
  at the end of an 8.3 s GOP) — RAM cache or not. Two seeks slower than `SLOW_SEEK_MS` (80) *during a
  scrub* (`light.scrubbing`; not the first seek after open, a loop wrap or a frame step), on a clip of
  at least 3 s, ask `POST /api/video/scrub` (`Library.start_scrub_copy`, the playback-copy job with `tag=".scrub"`:
  <= 960 px, no audio, `-g 4 -bf 0`, file `thumbs/video/<aid>_<stamp>.scrub.<ext>`, served by
  `GET /api/video/scrub/{id}`). Once loaded, a `.view-scrub` `<video>` sits right after the player
  (same size / transform via `apply()`), seeks along during a scrub (`scWant` / `pumpScrubCopy`,
  one in flight) and is shown only while `light.scrubbing`; `settleScrub` hides it after the player
  presents its own frame (rVFC, <= 250 ms). The player keeps its own throttled seeks (`pumpSeek`), so
  the landed frame is full quality. A new drag hides the copy until it has landed on that drag's
  position (`scGen`); any other seek of the player (frame step, marker jump) hides it at once.
  Scrub and playback copies share the one-at-a-time `_play_slot` (queued threads, never parallel
  ffmpegs, `_encode_copy`); a playback copy goes first: while one waits scrub jobs hold back, and its
  arrival terminates a running scrub ffmpeg (`_scrub_proc`), whose job then starts over after it. After each scrub copy, `_prune_scrub_copies` keeps the newest 20 / 1 GB in all
  (`SCRUB_KEEP_FILES` / `SCRUB_KEEP_BYTES`), never the one just made. The playback-copy cleanup removes stale files of its own kind only
  (scrub vs playback); the asset rename / delete globs `<aid>_*` cover both.
- `thumb_version()` is cached in memory, a missing file as 0 too (re-checked after 30 s;
  `prioritize` regenerates a has_thumb asset whose file is gone). Code that writes a thumbnail calls
  `thumb_version(aid, fresh=True)`; code that finds or writes one marks it with `_mark_thumb(aid)`
  (never `_have_thumb.add` directly — it also drops a cached 0); code that deletes or invalidates one
  calls `_forget_thumb(aid)`.
- A thumbnail file is **trusted only if the row knows it** (`has_thumb=1` at startup → `_have_thumb`, or
  written / moved / uploaded this session). `thumb_path()` returns trusted files only; `thumb_file()`
  is the raw disk check (GET `/api/thumb` serves an untrusted file `no-store` while it re-renders, for boards). An untrusted file (an orphan: a removed source added again — ids are path
  hashes — or a file changed while Sight was closed) is never adopted: `_make_thumb` deletes it and
  renders again, which also fills width/height (masonry needs them) and publishes the `thumb` event the
  client waits for. Never adopt a file silently in `prioritize` — the client gets no event and the row
  no size. `remove_source` forgets its assets' thumbs in memory (files stay on disk).
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
- Windows launch splash (`app/splash_win.py`, `Splash` in Sight.py): started as the very first thing
  in `main()` (not with `--no-browser`) as a separate process — a source run: `pythonw -I -S
  app/splash_win.py IMAGE EVENT MAXWAIT`; frozen: `Sight.exe --splash ...`, handled at the top of
  Sight.py before any other import. It is a layered topmost click-through window with `splash.png`
  (GDI+ draws into a premultiplied DIB), centred on the monitor under the cursor. Closing = a named
  manual-reset event (`Local\SightSplash-<pid>`, name in env `SIGHT_SPLASH`): the closer
  CreateEventW + SetEvent and keeps the handle, so a close that beats the splash's start is still
  seen. The env var carries the name across `bootstrap()`'s re-exec: the second `main()` starts no
  second splash and closes the same one. Closed on the page's ready ping (`reveal_when_ready(...,
  on_ready)`), in `_open()`'s finally and in `main()`'s finally; the splash also exits after 45 s and
  on any error. It must stay stdlib-only and import-safe on non-Windows. Regenerate `splash.png`
  (512 px, transparent corners) from `favicon.svg` if the mark changes.

## Canvas (boards)

**Data** — tables `boards`, `board_groups`, `board_items`, `annotations` (groups: schema + CRUD +
routes exist, no UI yet; board annotations: see "Board annotations" below). `board_items` = one placement of one asset: `x y w h rotation z_index
opacity desaturate always_on_top crop_x crop_y crop_w crop_h flip_x flip_y color_label locked
playback_state`. Crop is a normalized rectangle of the *source image* (null = uncropped); flip is
per item. Boards hold the saved camera (`viewport_x/y/zoom`).
`board_items` also carries `asset_name` / `asset_path`, a server-side snapshot of the asset row (filled by
`add_board_item`, backfilled once by the migration, rewritten with `asset_id` by `_migrate_asset` when a file moves;
not in `_BOARD_ITEM_FIELDS`, so PATCH cannot touch it; POST only uses a body copy when the asset row is gone —
duplicate / undo of a placeholder). Removing a source deletes its asset rows but not the board items. A card whose
asset is gone or `status='missing'` is drawn by `fillItemEl` (canvas.js) as a `.citem.missing` placeholder (icon,
"Missing", name, path; sizes in `cqmin` of the card; `data-state` = `missing` / `nothumb` / `ok`). `assetResolved`
never holds a gone asset, so Space / Find / Reveal ignore it (Space flashes "File is missing"). `canvasCtl.refreshMissing(all)`
(debounced 500 ms, called from index.html's SSE handler on `thumb` / `batch` / `scan` / `source`) drops the cached
`getAsset` answers of cards that are not `ok` — all cards on `source` and on scan end — and repaints them, so
re-adding a folder (same path = same asset ids) or a late thumbnail fixes the cards without a reload.

**API** — `GET/POST /api/boards`, `PATCH/DELETE /api/boards/{id}`, `POST /api/boards/reorder`,
`GET /api/boards/{id}/full` (board+items+groups+annotations), `POST /api/boards/{id}/items`,
`PATCH …/items/{item}`, `POST …/items/batch`, `DELETE …/items/{item}`, `POST …/items/batch-delete`,
groups (`POST/PATCH/DELETE …/groups[/{gid}]`, `…/ungroup`), annotations (`GET/POST /api/annotations`,
`PATCH/DELETE /api/annotations/{id}`, `POST /api/annotations/batch`; `GET /api/annotations` takes
`asset_id` or `board_id` → `Library.annotations_for_board`). Field whitelist:
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
- **Board annotations (0.63.0)** — drawings and review notes on a board, made by a SECOND instance of
  annotate.js (`boardAnnot` in index.html, `createAnnotator({board: true, …})`) that canvas.js receives as
  `annot` and hosts. Rows: `scope='board'`, `board_id` = the board (no `target_asset_id`), `data.pts` etc.
  exactly as in the lightbox (see "Annotations / review"), so a drawing is in **world units** (the board's
  own coordinates, same as items), free of any item. `/api/boards/{id}/full` and `GET
  /api/annotations?board_id=` read them through `Library.annotations_for_board` (scope 'board', not deleted,
  by z_index); `delete_board` soft-deletes them with the board. Not part of `.srev` / HTML / PDF / ZIP
  exports (those are per asset, FORMAT.md).
  - *Hosting (canvas.js):* `annot.mount(canvasView)` builds the bar, panel and toast inside the view (the view
    is `position: relative; isolation: isolate`; the panel overlays the right edge, `--an-pw`); the toggle
    button `#boardAnnoBtn` in the top bar (index.html, passed as `annButton`; `.canvas-annbtn` only when a host passes none) and **Shift+A** (`KEYMAP`) switch the mode. `open(id)` calls
    `annot.setAsset({id, kind: "board", name})` at once (before the `/full` fetch, so the previous board's
    drawings never show over the new one) and, once loaded, `annot.bind2d({wrap: viewportEl, media: null,
    isVid: false, board: true, geom: () => ({x0: vx, y0: vy, s: zoom, w, h})})` (w/h = the visible world
    size); `worldTransform()` and a ResizeObserver call `annot.viewChanged()` (a board's layer follows the
    camera with the mode OFF too). `persistCurrent()` awaits `annot.flush()` before the board changes
    (`setAsset`'s own flush is not awaited and would find the item map already cleared); `close()` switches the
    mode off. `bind2d` is called for every board on the same viewport: `attachInput` wires it once (`wired`
    WeakSet) and `setAsset` removes the old `.an-layer` of a board view.
  - *Input:* annotate's capture-phase pointer listeners on the viewport stop left-button / pen gestures
    before canvas.js's item / frame / marquee handlers; middle / right / wheel / Alt+drag (drawing tools) fall
    through to canvas.js (pan / zoom). The canvas keydown handler gives `annot.onKey(e)` the key first; while
    the mode is on the board's own item commands are filtered to `VIEW_KEYS` (F, A, Esc), so X / Delete / arrows
    cannot act on items; Shift+A in KEYMAP turns the mode on (the annotator's own table turns it off, and its
    plain-`A` row is dropped in board mode so A keeps framing). index.html: `annotModal()` makes the board's
    help popup modal for its global handler; Ctrl+A is left to the annotator while the mode is on. Touch:
    canvas.js tracks touch pointers on the viewport (capture, registered before annotate's): the second finger
    calls `annot.abortGesture()` (drops the stroke / shape / move the first finger began, an eraser pass keeps
    what it erased), finishes any item drag and starts a pan + pinch-zoom (works with the mode off too;
    `.canvas-viewport` is `touch-action: none`).
  - *Board mode of annotate.js (`isBoard()` = `S.kind === "board"`, host flag `board`)*: `rowBody` →
    `scope: "board", board_id`; `load` → `?board_id=`; `modeAllows`: every drawing shows all the time (no
    "clean picture" compose / cleanPic), a picked note narrows to its drawings and `goNote` calls
    `host.frameRect` (canvas `frameRect`, fits into the strip left of the open panel); with the mode off the
    layer stays visible (`renderAll`, `viewChanged`; `toggle(false)` clears `S.hover` / `S.hidden`); "Clear" /
    "Select all" act on the drawings touching the visible part of the board (`shownDrawings`). The panel key is
    `sight.annotate.panel.board` (default closed). Skipped / hidden: screenshots (bar, panel, S / Shift+S),
    review state row, versions and carry-over, picture text field, note previews (`notePreview` / `previewBox`
    only handle image / psd / video), frame stamp, onion, video / 3D keys, PDF / page / .srev / ZIP export and
    import (the Export menu keeps *Copy notes as text*). CSS rules that were keyed on `.light.<state>`
    (`an-panel-on`, `an-alt`, `an-regioning`) are keyed on `.an-host.<state>` now (`mount()` adds `an-host`, and
    `an-bhost` for a board); the lightbox-only ones (padding, v3d panels) stay on `.light`.
  - *Gotchas:* a loose drawing (no note) joins the NEXT note whatever its place on the board (lightbox rule:
    `pendingDrawings`); a board's notes panel is hidden-and-stale until shown (renderPanel skips a hidden panel,
    as in the lightbox).
- Not built yet (planned): groups UI,
  frames/connectors, opacity/desaturate UI, export, real multi-user/sync (groundwork only:
  revision/updated_at/deleted_at columns, single mutation path).

## Annotations / review (lightbox)

(The same editor also runs on Canvas boards, scope `board` — see "Board annotations" under Canvas.)

**Saving (the write queue, `OB` in annotate.js).** No annotator writes rows with fetch() itself: `serverCreate` /
`stage` (the 300 ms debounced updates) / `serverDelete` put a full copy of the row into one module-level queue shared
by every annotator (lightbox, board, compare) — one entry per row id, the newest wins (`put {body, create}` / `del`,
`key` = asset / board id). The queue drains single-flight (creates and deletes one by one as POST upsert / DELETE,
plain updates in `/api/annotations/batch`, after two batch failures one by one as PATCH, which never revives a
deleted row), retries with backoff, aborts a request after 20 s, and shows a fixed badge (`.an-outbox`, click =
retry) while it fails. It is stored in localStorage per window (`sight-annot-outbox:v2:<id>` = {ts, entries},
refreshed every 5 s, ts 0 on pagehide); a start adopts the keys of windows that stopped refreshing. pagehide
settles every annotator (open editors commit) and sends the queue with keepalive (60 KB budget). `load()` lays the
queued and the lately landed (30 s, `OB.recent`) writes over the GET's rows (`obOverlay`). Invariants: leave an
asset only through `settle()` (blur an open panel field, `finishEdit`, `stage`) while `S.asset` is still the old
one; never write rows outside the queue (ordering per row id depends on it); `flush()` = stage + wait for the queue.

**Reference images** (kind `image`, FORMAT.md) — a drawing whose picture is a shot (`/api/review/shots`, stored by
`storeRef`: decoded in the browser, ≤ 2048 px, PNG when the source may have alpha else JPEG). Added by `addRefs`
(annotate.js) from a drop on the surface (`onRefDrop`: OS files, or `application/x-sight-ids` from the grid via
`host.pictureSources` → index.html `pictureSource`), a click with the tool (`pickRefs`), or *Add selected*
(`host.selectedPictures`). Not on boards (`host.refImages: false`; a board places pictures as items). Scaling is always
uniform (review-core `transformItem` / `xfDrag` treat it like text). Crop mode (`S.crop`, `cropItem()` gates it to the
one selected editable visible image): `cropFrame(d)` = the whole source picture in doc units (origin + rotated axes +
units per picture), `applyCrop` sets the window and a box that keeps the picture where the frame had it; grips move
an edge, "pan" slides the window; the overlay (`cropSvg`) is in the `.an-ui` layer. Canvas exports await
`RC.imagesReady` (composeView, gatherReport1); `RC.setImageSource` is set by each client (annotate.js module
init, the HTML page, the phone's `refShots` which makes object URLs ahead since the core asks synchronously).

**Library beside the lightbox** (index.html, `state.lightSplit` / `lightSplitRatio` in `sight.layout`, Tab and
`#libBtn`) — reuses the board split: `applyViewDom()` shows the grid at its ratio, `#splitHandle`, and behind the
lightbox either the board (still open) or the empty `#lightSlot`; `placeLightSplit()` sets the fixed lightbox's
`left` to the divider's right edge (ResizeObserver on the grid); `body.light-split` hides the inspector. Only while a
lightbox is open (`lightSplitOn`); closing it restores the layout. The divider's double-click (stacked) is ignored
there. Tab also toggles the board split (`toggleCanvasSplit`); `#splitBtn` sits at the left of the top bar.

**Notes panel vs drawing** — two modes: `S.on` (drawing: tools + the panel per `S.panelOn`) and reading
(`S.readOn`, `sight.annotate.read[.board]`): the panel alone, `.an-read` hides the composer; a click on a note /
its picture still picks it and goes to its frame / view / board place. `togglePanel` flips the flag of the mode in
use; the notes button (`#notesBtn` in the lightbox bar, `#boardNotesBtn` in the top bar via `host.notesBtn`) and
`C` open it in either mode. With the mode off a picked note narrows the drawings to its own (`modeAllows`).

**Board notes' place** — a board note's `ctx.bv` (canvas.js `viewRect()`: the rectangle left of the panel); its
card picture (`boardPreview`) shows that rectangle with its drawings; a click → `flyToNote` → `frameRect(…,
{smooth, pad: 0})` → canvas.js `flyTo` (ease-in-out cubic, zoom on a log scale, stopped by any press / wheel).
Older notes without `bv` fall back to their drawings' bounds.

**Drawings while just watching** — `shownOff()` (annotate.js): a board, or a 2D picture / video, keeps its layer
on show with the mode off (not editable, `pointer-events: none`); `modeAllows` shows every drawing of the frame
then (no compose / clean-picture / pin narrowing, except on a board), the tick keeps running while there are
drawings so a video's follow its frame. `S.hidden` is the one hide flag: the toolbar eye, `#drawEyeBtn` in the
lightbox bar / `#boardEyeBtn` for a board (`host.eyeBtn`) — the only eye since 0.74 (none in the toolbar), shown
when there are drawings, while drawing or while watching where they show (`paintEye`) — and Shift+H.

**Onion skin** — `onionFade()`: video, while drawing; the drawings of the last annotated span before the frame fade
out and the next span's fade in, linearly over the gap (1 s at the clip's ends); applied as inline opacity in
`paintVisibility` (no `.ghost` class any more).

**Sequence export** — index.html `seqExportAll(kind)`: finds the clips with notes (`/api/annotations`), visits
each (`seqGo` + `seqWaitClip`: clip on screen, annotator bound and loaded, fps known), takes `annot.report(kind)`
(= `gatherReport`), then POSTs `/api/review/export/pdf-all` | `zip-all` (`review.build_pdf_all` merges per-clip
PDFs and numbers the pages through; `build_zip_all` puts each clip under "NN name/") or one `/export/html` per
clip; `.srev` needs no pictures and no visits: `/export/package-all` with every clip id, the server keeps the clips
with notes or tombstones and writes one bundle (FORMAT.md "Bundle", `review.build_bundle`). Afterwards `seqGo` back to the clip / time it started from.

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

**Picture texts and the text plate** — a note's `data.captions` (FORMAT.md) holds each picture's
own text; `review-core.js` `picKey` / `captionOf` / `withCaption` read and write it (frames match by
the caller's own frame rule). `app/static/caption-plate.js` (ES module, imports `./keys.js`, injects
its own CSS) is the half-transparent plate shown over a full-screen picture: `createPlate(parent,
{storeKey})` → `{set(content), destroy()}` (the HTML reviewer page gets it as a plain script:
review.py `plate_js` drops the import / export keywords of it and keys.js and defines
`SightCaptionPlate`); bottom centre 80 % wide, five lines then a scroll; a tap
folds it into an icon, a drag sticks it to the nearest side (sides: 25 % × 80 %), side / fold kept in
localStorage. Text longer than the plate scrolls by a drag on it (finger: native pan-y; mouse / pen:
`g.scroll`, words follow the pointer) and only the head moves the plate; a middle-button drag anywhere
on it scrolls the same way (`pan`, like index.html `attachPanScroll`, no browser autoscroll). It stops pointer / wheel / touch events from reaching the host (the host's
capture-phase listeners must skip `.scp` targets themselves — annotate.js `onDown` / dblclick do).
Used by annotate.js (on the lightbox surface while a note is picked and one of its pictures is on
screen — `paintPlate` runs every tick — and over an attached picture in `showShot`; `onSave` edits in
place) and by the phone's viewer (`onEdit` opens the app's text sheet); `tools/build_pwa.py`
publishes it as `core/caption-plate.js`.

**Transform (select tool)** — `review-core.js` `xfBox / xfHandles / xfAt / xfStart / xfDrag /
xfSvg / XF_CURSOR / snap15`: handles, hit test, the drag math (move, 8 scale handles, rotate, line
ends / bend) and the selection markup, shared by annotate.js (screen-px overlay: `map` = toScreen,
`u` = 1) and review-draw.js (doc-unit overlay: sizes × doc-per-px). While the rotate knob is
dragged, `D.at` = the pointer: the knob is drawn there with an arm from the pivot (the box centre),
the angle is atan2 about the pivot, so a longer arm turns finer.

**Drawing canvas** (`app/static/review-draw.js`, `SightReviewDraw.open`) — shared by the HTML page
(inlined) and the phone app. Tools: select / transform (`V`), brush, highlighter, arrow, rect,
ellipse, **text**, eraser (Ctrl held = eraser for that stroke). Alt held over a drawing tool (`altCam()`, state `altHeld`,
class `.an-alt` on the lightbox) lets the press through to the viewer (`onDown` returns before `grab`) and
makes the bar / notes panel pointer-inert. The bar (`.dtools`) is built from
`SLOTS`: two slots hold kinds — *Arrows and lines* (`ARROWS`: heads / dash, `line` = shape_kind
"line") and *Shapes* (`SHAPES`: rect / rounded / ellipse, outlined or filled); `pen.arrow` /
`pen.shape` (saved with the pen) pick the kind, `pen.tool` stays the drawing tool key (arrow /
rect / ellipse). A tap on a slot shows its row (`.dfly`, above the bar); a pick, a touch on the
picture, another slot folds it. The rows are `.dfly.rd-panel` (the bars' own look). The *Text*
slot's row is switches (`TEXT_OPTS`: bold, italic, underline, `bgOn`, outline = 6 % of the size,
align cycles; the box (a switch: switched on, it shows its colours `TEXT_COLORS`) and the font
(`FONT_IDS`) use a second row `.dsub` above it — `openSub`) on `pen.text` (also `bg`, `outlineColor`). The Shapes row ends with
*Fill colour* (`fillButton` → `subRow("fill")`): `pen.fill` (null = the line's colour at 0.3, else
that colour at 0.6; the second row: the line's own, then six colours), saved with the pen; recolouring a selection moves a fill only when it
followed the line (saved with the pen, used by a new text); a switch also styles
the text being typed (`edit.it.data`, restored from `edit.before` on cancel; `commitText` compares
`styleOf`) or, with select + texts selected, those texts (copies, one undo step). The Arrows / Shapes
slots do the same with select + arrows / lines or rects / ellipses selected (`groupSel`, `restyleSel`,
`applyVariant`, `setFill`): the choice restyles them and the tool stays select; with nothing of that
kind selected a pick takes the tool as before. While typing,
`mousedown` on the slot / row is prevented so the field keeps the focus (the phone keyboard), and a
resize does not fold the row. `closeFly` hides the row at once and removes it a tick later: the
picking click is still on its way to the host's document handlers, and a detached target reads as
"outside the canvas" (the HTML page then closed an empty new-note draft). The colour is the
`.dcol` circle at the row's end with the colours in its flyout (`useColour`). The trash deletes the selection,
else every item drawn here (one undo step). Ctrl+C / Ctrl+X / Ctrl+V (select tool, exact modifiers via
`ctrlOnly`): `copySel` / `pasteClip` keep copies in the module-level `clipboard` (doc units, shared by
every canvas opened on the page, so a copy crosses frames / pictures); pasted copies get no `id`, no
`note` / `reply` / `ctx` (the host assigns them), `z = ++zc`, offset 20 screen px — 0 for the first paste
after a cut (`clipCut` = the cut objects; not when an undo has put them back) — or moved to the picture's
centre when the clipboard lies wholly outside `vb` (no rescale between pictures of other doc sizes). The
same three as buttons for touch: `.dclip` under the top bar, shown with the select tool and a selection
or a clipboard. Undo keeps whole `items` arrays: a transform drags
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
picture for the new note; **pin** (a note clicked — its card or a video / 3D preview frame in it) only that note's; a click on a
screenshot in a note opens it full size and does not pin.
Hover changes nothing on the picture (0.44.3 removed the hover mode and `S.focusNote`; the only state is
`S.pinFocus`). `S.cleanPic` (set by `addNote`) is the clean picture after a note is made: no note's drawings
show until its card is clicked (pinned); compose and pin clear it (`viewMode` / `modeAllows`).
Hit tests, the eraser, selection and "clear on screen" follow `visibleNow`; reports and exports
use `ctxShown` (every drawing on that frame). Cards show the note's own drawings (and each reply's)
over the clean picture / a video frame from a hidden second player (`previewFrame`, per asset). In 3D
the pictures are stills from each view (`view3dPic`, kept per asset / view / camera / hidden meshes / explode, not per shading: a light change
does not re-render them; made with the camera moved and put back; skipped during a drag); `view3dBox` draws the drawings in the host's units.
A note may hold drawings on several frames / views (each row keeps its own ctx): `pendingDrawings`
= loose drawings shown now + every loose one created since `S.openedAt` (any frame / view);
**No "note's own frame" (0.47+):** a video note stands on the frames its own drawings are on plus
those with a picture text of it — `RC.noteTimes(data, times, same, fallback)` (shared by annotate.js
`noteFrames`, the phone's `noteTimes`, report.js); the frame it was written on (`ctx.t`, still stored
and still the merge / hold anchor) counts only for a note with neither (`fallback`: markers,
selecting it; reports and card previews drop it when the note has attached pictures). Timeline marks
(annotate `marks()`, phone `markerList`), the card's time, a click on the card, and the reports all
follow it. `notePreview` makes one box per frame in time order (`data-pt`: a click goes there; `.an-fno`
the frame number); `gatherReport` gives the note's first picture as `frame` + `frameCtx` and the rest
as `more [{frame, size, caption, title, text, file, ctx}]` (the note's first: `frameCaption`,
`frameTitle`, `frameText`, `frameFile`; attachments `shotCaptions` / `shotFiles` by shot id — `caption`
= "<title> — <text>" for the PDF, `title` / `text` apart for the page and the ZIP, `file` =
`RC.picFileName(title)`, the page's download / ZIP name) (review.py: PDF after the note's frame; the page's
`frameOf(id)` reads `frameCtx`, `frameOf("<id>|<i>")` the rest). Video labels are
`RC.frameLabel(t, fps)` ("f128 / 0:05+3"), also burned small into the frame's corner (`bakeFrame`).
The lightbox view's **turn / mirror** (index.html `attachViewer`: `turn {rot, mir}`, localStorage
`sight.viewTurn`, newest 500 files) is a CSS prefix about the window centre on the media and on
annotate's layer root (`geom().turn`); `unturn(x, y)` maps the pointer back, so pan / zoom and
annotate's `local(e)` / `toDoc` work in the unturned frame. Doc units never change.

**HTML reviewer page** (`review._HTML_TEMPLATE`, built by `build_html(report, pkg)` or, for a sequence,
`build_html_all([(report, pkg)…], app_version, title)`) — data block `{clips: [{report, package, edits?}], bundle?, copy?}`
(`bundle` = `{id, exported_at, app, title}`, only with 2+ clips; one clip → a plain one-clip page). **Several clips**:
the script works on the shown clip through page-wide variables (`R`, `PKG`, `KEY`, `rows`, `E`, `M`, `VEC`,
`noteById`, `exported`, `MEDIA_NAME`, `VIEW_KEY`, `drafts`, `openReply`, `newOpen`) that `useClip(i)` points at
`CL[i]` (stashing the shown clip's `E` / drafts / open fields back first); `switchClip` = `useClip` + `header()`
(clears and redraws) + `render()`; listeners are bound once. Per-clip storage key: one clip
`sight-review:<asset id>:<exported_at>[:copy]` (unchanged since before 0.76), several
`sight-review:<bundle id>:<asset id>[:copy]`. `changes()` sums all clips (`changesOf(E)` = new notes + reply entries);
*Download reply* = a plain package (one clip) or a bundle with the page's `bundle.id` of the changed clips
(`replyPackage(c)` per clip); `#dlclip` in the clip's details = that clip's plain package (Sight < 0.75).
`←` / `→` switch clips via `SightCaptionPlate.runHotkeys` (keys.js exposed by `plate_js`), skipped in text fields
and while `.zoom` / `.draw` / `.pick` / a `.gate` is up. The report
comes from `gatherReport(true)`: **clean** pictures (no drawings burned in) — `cover` (images /
PSD, ≤2000 px) + `coverSize`, per note `frame` (video frame ≤1600 px, or the 3D view capture) +
`size`, reply `id`s, and `media: {kind: image|video|model3d, w, h, fps}`; picture notes get no
frame of their own (the page shows the cover with the note's drawings). The PDF uses
`gatherReport(false)` and still burns drawings in. The page draws the package's drawing rows with
review-core as an SVG overlay (`.ov`, `viewBox` in doc units: `0 0 w h` for pictures / video —
frames are the whole media scaled; `-500·a -500 1000·a 1000` for 3D, a = frame aspect). Frames
(`frameOf(key)`): `"cover"` = every drawing (the page shows the cover itself clean — gallery
entry `clean: true` — the drawings are on the note pictures); a note id = picture notes: the cover filtered by
`data.note`; video / 3D: everything `ctxVisible` at the note's first picture (`frameCtx`; an older
report: its `ctx`); `"<id>|<i>"` its i-th `more` picture. **Viewer** (`zoom(group, k)`): `GAL` is
rebuilt by `renderList` — the cover's group, then one group per listed note (`curG` while its card
is built; `galAdd(entry)` returns the click handler): its frames, shots, then each reply's drawings
(per frame key, `noteFrameKeys`) and shots. Left / right walks a group, up / down the groups; the
step is the phone viewer's strip slide (WAAPI, `SLIDE_MS` / `SLIDE_WAIT`); floating `.zfab` Back /
pencil (`drawTarget`: cover → new note, any note picture → `startReply(id, frameKey)`, a shot →
`replyFlat`); the plate is caption-plate.js (`SightCaptionPlate`, review.py `plate_js`), the
picture's text from the note row's `captions` (`picOfEntry`). A reply draft may be drawn on any of
the note's frame keys (`drawFrames`). Its drawing canvas
(`drawSheet`) edits items in the same doc units, on the clean picture (`base: []`) for a new note
or reply, and opens turned / mirrored as last left (localStorage `sight-review:view:<asset id>`); drafts keep `{frame, items}`; sending turns them
into rows in `E.rows` (localStorage) with `data.note`, `data.reply` (a reply) and the frame's ctx
(`drawCtx`: video `{t, hold}` of the note, 3D `{vk, cam}`); a new note drawn on a frame takes that
note's whole ctx. *Download reply* merges `E.rows` like any other row (`RC.mergeRows`). *Download page* (`downloadPage`)
writes the page back: `ORIG` (the page's markup, captured before any script ran) with the data block replaced by
`{clips: [{report, package, edits}], bundle?, copy}`; the copy starts from each clip's `edits` and keeps its own localStorage keys (`D.copy`). Drawing on
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
The hotkeys are one table, `keyTable()` in annotate.js: rows `[combo, handler, label, group]`. `runHotkeys`
runs it and the "?" help overlay (`openHelp`, toolbar button + Shift+/) is rendered from the same rows, so
a new shortcut = a new row with a label (rows without one are not listed). While the overlay is open it owns
the keyboard: index.html's keydown handler hands every key to `annot.onKey` first (`annot.helpOpen()`) and
returns; only Esc / ? close it. The overlay is a `.an-help` backdrop inside `.light` that swallows pointer,
wheel and touch events. `.light.an-panel-on` sets `--an-right: 320px`; bars centred on the lightbox width
(`#v3dShade`, `#v3dAnim`) subtract it so they centre on the visible strip (left of the notes panel).

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
`POST /api/review/export/zip` (`gatherReport(false, true)` — every picture note gets its own
picture — → `review.build_zip`: a folder per note with its pictures under their `file` names, extension
from the bytes, and "Note NN.txt"), `POST /api/review/export/html` (the page's report: clean pictures + `coverSize` / `media`, see
"HTML reviewer page"; the page embeds the report and the package, see `review.build_html`),
`POST /api/review/export/html-all` (`{reports, author}` like `pdf-all` → per report the asset's package →
`review.build_html_all`; a report whose asset is missing / repeated is dropped, none left → 404), `POST /api/review/import` (raw file body → `review.import_review_file`, the one import
function the tests call too; asset matched by id, then the asset holding most of its row ids, else name+size, else
name+kind; 404 `{missing}` if no match). A bundle answers 200 `{ok, bundle, id, author, results}`, one result per
package (`import_package`'s, or `{ok: false, error}` / `{duplicate: n}` when two packages match one local file),
each committed on its own. Import **merges**
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

**Sequence** (index.html, `openSequence` … `bindSeqBar`) — selected videos played back to back in the
lightbox. `light.seq = {list, i, durs, loop, buf, pendT, pendPlay}`; every clip is shown through the
ordinary `showInLight`, so annotate.js's `setAsset` brings that clip's own notes / fps (nothing is merged,
FORMAT.md `t:` keys stay local). `showInLight` follows the clip by id and ends the sequence for any file
not in it. The next clip is preloaded in a hidden muted `<video class="seq-buf">` inside `.light`
(`seqPreload`); on `ended` `seqAdvance` passes it to `showInLight(a, {adopt})` → `attachViewer`, which
puts it in the place of the element it would have made **in the same task** (so it never leaves the
document and keeps its decoded first frame) and does not reset its `src` (`startVideoCache(…, keep)`).
Gotcha: `<video … />` in the stage markup is not self-closing — the HUD is parsed as its child, so the
adopted element takes the made one's children. Non-adopted moves (`seqGo`: jumps, frame steps across a
cut, scrubbing the bar into another clip) land via `pendT` (< 0 = from the end) / `pendPlay` in
`seqOnReady`, called from the viewer's `onReady`; `autoplay` is turned off for a jump that lands paused.
annotate.js's `stepFrame` calls `host.seqEdge(n, fd)` past either end of a clip. `light.vctl` exposes
the viewer's `seekVideo / beginScrub / endScrub` for the sequence bar. Drags through the sequence (the bar, and the
picture scrub — handed over by attachViewer once it starts, `seqScrubBegin`, on window listeners because the stage
and the element holding the pointer are replaced at each cut) go through `seqDragTo(drag, T)`. Every non-adopted
`seqGo` holds the frame on screen as a canvas over `.light-stage` (`seqHold`) until the new clip presents its
frame (`seqReleaseHold` from `seqOnReady`, 1.5 s cap). Marks: `s.marks[k]` = `[{t, note}]` — the clip on
screen reports annotate.js's own `marks()` through `host.marksChanged` (called by `renderMarks`); other clips
are read from `/api/annotations` (`seqLoadMarks`, an approximation: drawings' `ctx.t`, notes' caption frames),
re-read when the player leaves them. `jumpMarker` with no marker left asks `host.seqMarker(dir)`. Playability:
`seqProbe` loads each other clip's metadata once (hidden `<video preload=metadata>`) and POSTs a playback copy
only for those without a picture — never for all (`start_playback_copy` transcodes anything without a copy).
Touch selection mode (`state.touchSelect`, long-press) — see RECENT 0.66.0.

**Dictation engines** (`dictation.js`): `webspeech` (browser, default) and `service` (the user's own
OpenAI-compatible speech-to-text endpoint) — chosen by the UI setting `sight.dictation.engine` (Settings → Dictation;
annotate.js passes `getEngine`). `service` records one phrase per MediaRecorder (an AnalyserNode RMS gate: 0.7 s of
quiet after ≥ 0.25 s of voice, or 20 s) and POSTs it to `/api/stt/transcribe?lang=xx` (no `lang` = detect).
Server: `app/stt.py` `SttService` — `{url, model, key}` only in `<SIGHT_HOME>/stt.json` (0600; the key never goes
back to the page; a new URL drops the key), set by `PUT /api/stt/config` (JSON only), stdlib multipart POST
(`file`, `model`, `language`?, Bearer key if any, no redirects); errors → `{error: not-set|bad-key|rate|offline|failed}`
→ the mic's toasts. Each mic has a language chip (tap = the other of the two recent languages, Alt+Shift+M).

**Annotating in compare** (index.html `cmpAnnot`) — a second `createAnnotator` instance mounted on the compare
overlay (`host.onOpen` → `mount(C.el)`); compare reports the selected layer's viewer after every rebuild /
selection (`host.onView({asset, wrap, media, isVid, geom, unturn})`: swipe → the whole `.cmp-box`, tiles → its
`.cmp-cell`; `geom` is object-fit: contain inside the media element's box) → `setAsset` (only when the file
changes) + `bind2d`; `onPlaced` → `viewChanged`. The compare runs every clip on one clock, so the annotator
must not drive the element: annotate.js goes through `vidPause` / `vidSeek`, which use `host.pauseVideo` /
`host.seekVideo` when present (→ `cmp.pause()` / `cmp.seekLayer(sel, t)`). New notes get `host.noteExtra()`
= `{compare: cmp.session()}` (FORMAT.md `compare`); a note card with it shows a button when the host has
`openCompareSession` (the lightbox's annotator — not the compare's own). `compareFromContext` asks
`latestCompareSession(focus)` before the file's versions. Keys while compare is open: the annotator's (when on)
→ `A` → compare's. On close, a lightbox underneath is reloaded if anything was annotated (its notes are stale).
`host.passThrough(e)` (→ `cmp.wantsPress`: swipe, Alt+left or a touch / pen press within 24 px of a split) makes
the annotator's capture `onDown` leave the press to compare (whose Alt+left pans only when not annotating).
`host.captureView(dpr)` (→ `cmp.captureView`) paints the screenshot: swipe box or whole stage from the media
elements' boxes, the layers' `clip-path: inset()` regions, `mix-blend-mode: difference` as canvas
`difference`, `.out` at 0.12, split lines and labels; `{cv, ox, oy}` places the annotated surface in it
(`composeView` draws the drawings there; an area capture offsets its rect).

**Compare** (`compare.js`, `createCompare(host)`) — a fixed overlay above the lightbox (z 60).
Every layer's media is placed in the reference layer's frame (`object-fit: contain`, shared
zoom / pan as doc-normalised centre + zoom over fit). Swipe: the reference is drawn whole at the
bottom, every other visible layer is clipped to its region (`clip-path: inset`) — region i belongs
to visible layer i — with `mix-blend-mode: difference` in Difference mode; tile layouts put a copy
of the reference under each cell for the same effect. Video: `C.T` is a wall-clock timeline;
layer local time = T − start/fps; `syncVideos()` holds the clock
(`C.wait`) while any in-span clip is seeking / not ready / > 0.3 s off, then resumes all together (small drift: playbackRate);
never seek towards a running clock. Clips outside their span pause (dimmed). Reference copies under Difference tiles are
canvases painted from its one `<video>`. `SlidingVideoCache` holds one RAM window per file, budget split evenly (`focus_many`). Keys go through `cmp.onKey` first while it is
open and do not reach the library / lightbox.
Exports land in `~/Downloads` (else `<SIGHT_HOME>/exports`) and are revealed in the file manager.

## Phone app (mobile/, PWA)

"Sight Review" — local review on the phone (docs/PLAN-mobile.md stages 3–4). Plain HTML + ES modules,
no build step; `tools/build_pwa.py` assembles `dist/pwa/` (what GitHub Pages serves): `mobile/` plus
`app/static/review-core.js`, `review-draw.js`, `keys.js`, `caption-plate.js`, `model3d-core.js` and
`favicon.svg` copied to `core/` / `icons/`, the part of the vendored three.js a glTF needs
(`THREE_FILES`: core, OrbitControls, the loaders of every phone format and the modules they import) to `three/` (index.html's
import map: `three` → `./three/three.module.js`, `three/addons/` → `./three/jsm/`), and fills `%%VERSION%%` (APP_VERSION + a hash of every file) into `index.html` /
`sw.js` and the file list into `sw.js`. Relative URLs everywhere (it runs under `/<repo>/`).

- **Modules** (`mobile/js/`): `app.js` UI (home list, review screen, transport, cards, composer,
  viewer, exports, SW banner); `model.js` every change to the rows + `.srev` build / parse / merge
  (pure, Node-tested); `store.js` IndexedDB; `media.js` file kind / identity / probing / frame
  grabbing; `mp4.js` fps from the MP4 container; `report.js` report content + static HTML + PDF
  layout; `pdf.js` the PDF writer; `model3d.js` the 3D viewer (below). review-core / review-draw are classic scripts loaded first
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
- **Home open buttons**: two pickers, both into `openAny`. *Photo or video* (`label.pick-media`,
  `accept="image/*,video/*"`, one file) — on Android only such an `accept` opens the photo picker
  (gallery); *Open a file…* (`label.pick-file`, no `accept`, `multiple`: 3D models with their textures,
  `.srev`, any media) — with no `accept` Android offers only Camera / Camcorder / Files. iOS shows its
  photo library either way. Big `.opens` buttons while there is no review at all, otherwise two `.ib`
  icons in the bar (`.mini`); one set is removed once the list is in. Multi-file tests go to `pick-file`.
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
- **Bundles on the phone** (multi-clip stage 3): `importReviewFile` → `M.parseReviewFile`; a bundle goes
  to `importBundle` (per package `reviewKeyFor` + `mergeInto(key, pkg, bundleId)` — no toast / question /
  open; a duplicate key = "same file as clip N"), then `bundleGroup` (a UI group with `bundle: <id>`, made
  of the clips in no group yet). Review meta fields: `groups: [bundleId]` (every bundle the review came
  in), `changed` (time of the last user edit, `false` after a send; missing = never sent → counts as
  changed), `nomedia` (made by an import, cleared when the file is bound). `dirty(user = true)` sets
  `changed`; merges call `dirty(false)`. Group menu → `exportBundle(g)`: the group's keys plus every review
  whose `groups` has `g.bundle`, changed ones only (else asks), id = `g.bundle || g.id`; `offerFile`'s
  `onSent` (Download / successful Share) → `markSent` clears `changed` only if it still equals the value
  packed (`packageOf`). The single-review `.srev` export clears it too.
- **Sequences** (0.78): the group header's `.th` → `openSequence(g)` (opens `g.cur` or the first key; every
  `openReview` of a grouped review stores `cur`, `seqRemember`). In a review whose key is in a group the header
  has `.seqb` ‹ › (`seqGo(±1)`, also Page Up / Down, no wrap); the switch is `openReview(k, …, {replace: true})`
  — `history.replaceState` and the previous review's `pushed` carried over, so Back leaves the sequence.
- **Review groups**: `sight-review:groups` = `[{id, name, keys, open, thumb?, bundle?, cur?}]` (localStorage;
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
  Selection: `R.curNote` is the selected note, the only card `.cur` (`paintCurrent`, pictures too);
  cards on the frame shown get `.here` (lighter), so play / scrub never move the selection. Set by
  a tap on a card (`selectNote`: seek to `noteFrameList(n)[0]`), a picture tapped (`openThread`
  selects only — no seek while the viewer is up, see RECENT 0.35.4), a marker step landing on a note's frame (`jumpNote`), a
  reply, `goTo`, `showNote`. Controls hidden: `setClean` → `.review.clean` (CSS hides `.hdr`,
  `.tp`, the pencil, `.playbig`, `.pbar` with `--pbh: 0` while the panel is closed; `.fab.showui`
  brings them back). Picture notes / no video: the inline composer in the card (`R.openReply`). A sideways drag on the stage scrubs
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
  picture), left / right `o.side(±1)` (a video note's frames, `noteFrameList` = its picture-text frames +
  `M.noteFrameTimes` through `noteTimes`; the caption's `.fr` says `time · f N · i / n`). `from0` (where it was
  opened) travels through nav / side; closing on another note or frame brings it forward
  (`showNote(n, t)`: seeks there, scrolls the card). The step is a strip slide — the only one,
  `show(no, {axis, dir})`: the next `.vb` is built and its image decoded (≤ `SLIDE_WAIT`) before
  `o` / `box` switch; then (WAAPI, `SLIDE_MS`) the old box goes on from where the finger let it go
  to a screen away while fading out (fill forwards, then removed), the new one comes in from a
  screen behind it while fading in; `busyNav` covers load + slide. No seek of the player while the
  viewer opens (RECENT 0.35.4).
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
- **3D** (`model3d.js`, kind `model3d`: `media.js` `MODEL_EXT` = glTF / GLB, FBX, OBJ, STL, PLY, USDZ /
  USD / USDA / USDC). `parseModel(blob, name, extras)` follows the lightbox's `loadModel` per format,
  with its shared parts from `model3d-core.js` (`dropDeadTextures` + `FBX_TEXTURE_WAIT_MS` for FBX,
  `stlMesh` / `plyMesh`). USD has no server here: three's
  `USDLoader` (vendored from three@0.185.0 with its `usd/` parsers; **patched** `USDCParser._readInlinedValue`
  for inlined Vec*d / Vec*h, which r185 returned as undefined; its textures load as plain images, so the
  loader's own onLoad is awaited) + `usdAsSight`, which lays it out as Sight's `usdz_convert.py` GLB: the Z-up
  turn kept, metersPerUnit scale dropped (the conversion does not scale), every mesh baked to world space and
  split per material group into meshes that share the part's vertices (index subsets, as glTF primitives — so
  their bounds, hence the explode rig, are the part's), all under one node. Views of a USD from Sight therefore
  match: camera, hidden list (mesh order) and explode — `test_model_formats` compares the meshes with Sight's
  conversion when usd-core is installed. The vendored `USDComposer.js` is **patched** for this (marked "Sight"):
  every material carries `userData.usdMaterial` (its USD path), a mesh with subsets gets its own material last
  (`usdMeshMaterial`) and its faces in no subset are drawn with it (r185 dropped them); `usdAsSight` merges a
  mesh's faces per material and orders them by first registration (own material, then subsets, in traverse
  order), as `_Materials.add` numbers them. **Animated stages** (the loader made clips): nothing is baked — the
  stage's nodes and skeletons stay (clips find nodes by prim name, bones through the root's `skeleton`), each mesh
  is replaced in place by a Group with its name / transform / visibility holding its per-material parts (skinned
  parts re-bound to the same skeleton), its child prims moved after them, so the mesh order and rest-pose bounds
  are the static layout's; the explode rig sees the hierarchy (differs from the conversion's flat node). Sight's
  lightbox reads such a `.usdz` in the browser too, so Sight and the phone agree. Not matched: the conversion drops invisible and proxy / guide
  meshes; colours differ (Sight writes USD colours into glTF as linear factors, three reads them as sRGB, so
  Sight shows them lighter); materials with no path (display colours) share one key here, where Sight keys
  them by colour, and invisible / proxy meshes register their materials here — both can reorder (not
  recount) the parts of a later multi-material mesh, so its hidden indices may differ from Sight's. **Extras**: files picked
  together with the model (`openAny`: the model is the main file) are resolved by lowercase base name through
  the LoadingManager's URL modifier (any folder the model names, Windows paths too), kept with it in `files`
  (`{key, blob, extras: [{name, blob}]}`; older records have none) and passed again on reopen / rebind.
  three.js is imported only when a model opens (`createViewer(host, blob, {name, extras, turns, onMove})`): a
  gradient-sky env map (`buildEnvTexture` studio) + a key light riding on the camera, OrbitControls
  (one finger orbit, two zoom / pan, damping on; `setView` puts the camera exactly, damping off for that
  step), Sight's `frameObject3d` pushed back until the model fits across a narrow (portrait) screen;
  renders on demand (`controls` change / `need`), `onMove` after each rendered frame. `still(cam,
  {hidden, explode, aspect, max})` renders a view into a 2D canvas in the same task and puts the live
  camera / meshes / explode back; `attach(el)` moves the canvas when the review screen is rebuilt.
  **Grid / background (0.53)**: core `modelGrid` (cells of `niceStep` 1-2-5 sizes, a tenth of the diagonal moved
  `gridCell` −4…4 steps, ≈ 2× the diagonal, ≤ 600 cells) and `gridColors` / `tintGrid` (line colours from the
  background, a minimum contrast for mid greys — the lightbox's `syncRig` tints its floor grid the same way);
  `setGridCell` / `cellSize`, `setBg` / `bg` (also on a splat); the device look stores `bg` and `gridCell`; stills
  keep the default background. UV view: `uvPicture(i, max, set)`; app.js `showUv` opens `viewer` in its `title`
  mode (no caption plate, a `.vtitle` pill "UV1 · 1 / 2 · mesh"), sideways = the next set (one picture per set).
  **Tools (0.51)**: `setShading({base, wire, xray})` / `setGrid("off" | "grid" | "axes")` / `setLight(LIGHTS)`
  (env presets from core `ENV_PRESETS`, "head" = key light + ambient, "flat" = ambient only; env maps built once
  per preset) — this device's look (`sight-review:v3d`, `applyLook3d` on load), never a view's; stills hide the
  grid / axes / selection so cached view pictures do not depend on them. `onTap(x, y)` = a one-finger tap
  under 8 px / 450 ms → `pick` (raycast on visible meshes, hidden-list order) → `select(i)` (core
  `meshHighlight` overlays in the scene); `uvPicture(i)` = core `createUvPainter` (Sight's UV pane), shown in the
  full-screen `viewer`. `anim` = core `createAnimator` (null without clips), ticked in the render loop; `onAnim`
  repaints the anim row. UI (app.js `paint3dTools`): the picked mesh's row `.hdr .sel3d` (`paintSel3d`), the
  bottom bar in `els.tp` (`.b3d`: icon row, `R.opt3d` choice row, anim row; `paintAnim` per frame).
  **Gaussian splats (0.53)**: `isSplat` (core `SPLAT_EXT`, or a `.ply` whose header says so) → `createSplatViewer`:
  Spark (`spark.module.js` + `jsm/postprocessing/Pass.js` in the build, `@sparkjsdev/spark` in the import map), a
  SplatMesh from the file's bytes, placed / framed as the lightbox does (core `SPLAT_QUATERNION`, `splatHome`), the
  same API with the mesh parts inert (`isSplat`, `meshCount` 0, `canExplode` false, `anim` null, `turns` 0 — no turn
  button, no shading / grid / light icons). Spark sorts in a worker after a render, so the canvas renders a 90-frame
  tail after every change, the viewer warms up (render + `spark.update` until `activeSplats`) before it is handed out,
  and **`still()` returns a Promise** (one at a time): Spark's own sorting off (`autoUpdate = false` — its async
  depth readback leaves a pixel buffer bound, which empties a synchronous read, and a sort under way makes
  `update()` skip a camera), wait out a sort under way, `await spark.update` for the still's own camera, then a
  render into an sRGB render target, read back (rows flipped), `autoUpdate` back on — the live canvas does not
  render meanwhile; a closed viewer throws (never a blank picture that would be cached). Callers `await V.still(...)`
  (a mesh viewer's still stays synchronous). **Note look (0.53)**: `views3d` keeps a view's newest note's `ctx.v3d`;
  `goView(vk, look)` applies `look || view.v3d` (`applyNoteLook`: `M.lookOfV3d` → shading / light, shown but not
  saved — as Sight's `setV3D`; the device's own look comes back with the next model); every way of opening a note
  (card, Go to, reply, editing its drawing) passes the note's own `v3d` on its own view, view chips the view's; a new note gets
  `ctx.v3d = M.v3dOfLook(...)` (not on a splat). Stills keep the default look (cached pictures).
  The review side (app.js "3D" block): **views** stand where video frames do. `R.views` =
  `M.views3d(rows)` (oldest first = Sight's View 1, 2…; hidden from the first row that has it, explode
  from the newest), plus drafts' views (`viewsNow`); `findVk(look)` = `RC.camMatch` (moved from annotate.js
  to review-core) + same hidden list + explode within 0.001 + `RC.animMatch` on the view's `anim` (a view
  without hidden / explode / anim — older Sight — matches any); `R.curVk` follows every camera move (`updateCurVk`); the stage overlay is the host's
  space (`vbOf(aspect)` = `-500·a -500 1000·a 1000`) and shows drawings with `ctxVisible(c, {vk})`.
  New rows carry `{vk, cam: {p, t, fov, turns}, hidden, explode}` (`ctx3d(make)`; a new vk only when
  the note / drawing is sent on a camera that is no view; `M.drawCtx` keeps hidden / explode). A note's
  views = `M.noteViews` (its own drawings' + picture texts' views, fallback the written-on view — the
  0.47 video rule); replies' = `M.replyViews`. Pictures (`viewPic`) are stills cached in `frames` under
  `key|vk=<vk>|a<aspect>|x<explode>|h<hidden>`; their aspect is what the view's drawings need (1–2.4,
  `viewAspect`), so the notes stay readable without the model. Drawing (`drawModel`): a still of the
  live view at the stage's own aspect, the canvas over it; the draft's other views are kept (orbit,
  draw again = one more view). Replies are written over the model (`replyOverPlayer`, view chips);
  *Edit the drawing* asks which view when there are several. Turn (`R.meta.turns`, Sight's quarter turn
  about X), *Frame*, the explode slider (`canExplode`), *Show all* when a view hid meshes
  (`meshOrder` = the lightbox inspector's order). No stage swipes in 3D (the fingers move the camera).
- **Exports** (`report.js`): `gatherReport` = Sight's `gatherReport(false)` content (cover with
  every drawing for pictures; a picture note's own frame only when there are several notes and it
  has drawings; video: each frame of `RC.noteTimes` (the first as the note's frame) with everything
  visible there except replies' drawings; each reply that drew: its frames — the note's own too — / the picture with only its
  drawings; 3D: each of the note's views via `src.viewAt` as "View N", burned in the host's units —
  `burn(…, ox, oy)`; replies, pictures). HTML: one file, data-URL images, no script. PDF: A4 laid out in points, each page
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
