# Archived changes — 2026-09

Older entries moved out of RECENT.md; newest first. Append-only history.

## 0.3.0 — 2026-09-24 — 3D viewer: soft shadows with light size, environment shadow on the floor, floor fades on explode
- **What:** lightbox 3D shadows no longer show stair steps. Each light has a **Size (softness)** slider (angular diameter, 0–45°): 0 gives a crisp, anti-aliased edge; larger sizes give soft shadows that stay sharp where an object touches the floor and blur with distance (contact hardening). Ambient and Environment light now cast a soft shadow on the floor too (they fill direct shadows and darken the floor under/around the model), weighted by the sky's brightness per direction, so a custom env image with a bright spot throws its shadow away from it. With explode, the floor, grid and its shadows fade out smoothly once parts sink below the floor, and fade back when they return.
- **Where:** `index.html`: new `PCSS_GLSL` / `patchSoftShadows` / `pcssRadius`, `skyLumFromPreset` / `skyLumFromImage`, `makeSkyOcclusion` (next to `applyExplode`); `boot3d` rig: `fitShadows`, `onExplodeMoved`, `syncRig` (light size, floor fade, sky-shadow restart key, shadow-only mix), `fitRig` (floor/grid centred on the model, measured with explode undone); `v3dLightRows` (Size slider); `DEFAULT_V3D` + `defaults.json` (`l1size`/`l2size`/`l3size`, `shadowStrength` 0.35 → 0.6).
- **Notes:**
  - Shadows: renderer uses `BasicShadowMap` and `patchSoftShadows` swaps that mode's `getShadow()` in `THREE.ShaderChunk.shadowmap_pars_fragment` for PCSS (16 blocker taps + 32 filter taps, receiver-plane depth bias via `dFdx`). `light.shadow.radius` is repurposed: penumbra radius in shadow UV per unit shadow depth (`pcssRadius`). If a three.js update changes the chunk text, the patch logs a warning and falls back to `PCFShadowMap` (radius in texels) — re-check the markers after upgrading `vendor/three*`. The patch is global but only affects Basic-mode shadows; nothing else in the app uses them.
  - Shadow frusta now hug the model's bounding sphere (was ±diagonal, half the texels wasted) at 2048², refit on turn and on every explode change; lights are placed around the model centre, not the orbit target, so panning away never loses the shadow.
  - Sky shadow (`makeSkyOcclusion`): 64 cosine-distributed directions, 8 per frame, each a soft shadow map rendered onto a 512² floor texture and summed; camera-independent, restarts only when env on/off/preset/image, env strength, ambient, custom-image yaw, turn or explode change. **Gotcha:** three picks shadow casters by the *rendering* camera's layers, so each sample renders twice — an empty-frustum camera on layers 5+6 refreshes the sample light's map (the model is put on layer 6 by `markCasters`), then a layer-5 camera draws the receiver with `shadowMap.autoUpdate` off. The solid floor uses the result as `aoMap` (scales exactly its ambient + env light); the shadow-only floor gets an overlay plane. Shadow-only darkness is split by energy: direct shadows × direct share, sky shadow × ambient+env share (so turning env up lightens direct shadows, as on the solid floor).
  - Explode fade: target = 1 − smoothstep(depth of the lowest part below the floor / 15% of model size), eased over ~120 ms. The floor stays where the assembled model stands.
  - Not done: objects don't get env shadows on themselves (no SSAO); the thumbnail renderer is unchanged. The custom-image sky direction follows three's `envMapRotation` for PMREM maps (lookup = Ry(−yaw)·dir) — verified only for presets (symmetric), not with a real HDRI.
  - Tested with Playwright on an isolated `SIGHT_HOME` (multi-part OBJ): hard/soft/env/env-only/shadow-only/explode.

## 0.2.8 — 2026-09-24 — 3D thumbnails: studio environment + one key light
- **What:** 3D model thumbnails came out dark. They are now lit by the "studio" environment map (the same procedural preset as the lightbox's Environment light) plus a single directional key light above-left of the camera. Existing model thumbnails are dropped once on server start and re-render as they scroll into view.
- **Where:** `index.html`: `renderModelThumb` (`THUMB_KEY`, `THUMB_ENV_INTENSITY`, cached `thumbEnvTex` built with `buildEnvTexture(…, ENV_PRESETS.studio)`); the old `THUMB_RIG` (ambient + 3 directionals) is gone. `library.py`: `MODEL_THUMB_VERSION` 2 → 3; `_drop_stale_model_thumbs` now drops **all** `kind='model3d'` thumbnails when `MODEL_THUMB_VERSION` changes, and only FBX/USDZ when just the USDZ converter version changes.
- **Notes:** cause: glTF/PBR materials are mostly lit by `scene.environment`; without one, ambient + directionals leave them dull. The env texture belongs to the thumb renderer's GL context and is rebuilt if that context is lost. If PMREM fails, a flat ambient (0.8) is the fallback. Splat thumbnails are unaffected (colors are baked in). Changing the thumbnail look again → bump `MODEL_THUMB_VERSION`. Checked with Playwright on an isolated `SIGHT_HOME` (untextured white character + textured palms): bright, no blown highlights.

## 0.2.7 — 2026-09-24 — Hovering a result takes focus off the search box
- **What:** after typing a query, Space over a result typed a space into the search box instead of previewing it. Now moving the cursor onto a library card or a canvas board item blurs the search box, so Space previews the hovered asset at once.
- **Where:** `index.html`: the global `pointermove` listener (next to `lastPtr` / `assetUnderPointer`).
- **Notes:** only real pointer movement onto `.card[data-id]` / `.citem[data-asset-id]` blurs; a cursor that merely rests over the grid while typing does not. The pending search debounce (`qTimer`) still applies the query after the blur. Only the `#q` field is affected; other inputs (rename, tags) keep focus.

## 0.2.6 — 2026-09-24 — Lightbox opens on the thumbnail, full image fades in when ready
- **What:** a big image in the lightbox used to paint top-down at native size while loading, then jump to fit. Now the card thumbnail shows at once, already framed to the window. The full image stays hidden until it is loaded and decoded, then fades in (0.25 s) over it. The thumbnail stays fully opaque underneath and is removed once the fade ends. A full image that is already in the browser's memory cache (e.g. going back to the previous image) is drawn at once, with no thumbnail and no fade.
- **Where:** `index.html`: `attachViewer` (`.view-ph` placeholder `<img>`, `loading`/`reveal` classes on `.view-media`, `reveal()`, `apply()` mirrors the transform onto the placeholder, early `openMode()` from stored `a.width/height`), `.view-ph`/`.view-media.loading`/`.view-media.reveal` CSS.
- **Notes:** images and PSD composites only; video is unchanged. The placeholder is stretched to the full image's box (same transform), so zoom/pan before the file arrives carries over. With no stored size, the thumbnail's aspect is used until the real image reports its size. A file that fails to load keeps its thumbnail. With no thumbnail, the broken image is shown. The reveal runs once, so PSD layer swaps (`img.src` changes) only re-fit. Do not fade the thumbnail out at the same time: a cross-fade of two layers dips toward the dark backdrop mid-way, which flickered when flipping through images quickly. "Already cached" is detected with a probe `new Image()` whose `complete`/`naturalWidth` are true synchronously for a memory-cached URL. It does not detect images that are only in the disk cache; those still go through the thumbnail. The placeholder has `decoding="sync"` so a cached thumbnail paints in the same frame the stage is swapped. The placeholder deliberately does not have the `view-media` class: `img.view-media` selectors (PSD layers) must hit only the full image. Tested with Playwright and a 2 s delay on `/api/file`.

## 0.2.5 — 2026-09-24 — Card info lines on short thumbnails are packed, not dropped
- **What:** on a short card (a wide image in masonry, a small tile) the info fields under the name (kind, date, resolution, size) used to disappear, so an enabled field was never shown there and, with Name off, the card had no caption at all. Now the fields are joined into one line ("1920×1080 · 2.2 MB") under the name. On a very short card that line sits on the name's row, and the name gives way (ellipsis).
- **Where:** `index.html`: `ensureCard` (chooses `pack1`/`pack2` instead of the old `short` class; new `.j` joined line in the card markup), `.card.pack1`/`.card.pack2`/`.meta .j` CSS.
- **Notes:** the choice uses estimated line heights from `textSize`, not DOM measurements (no layout reads during render). The info block may cover up to 70% of the thumbnail; with that ratio cards of ~130 px and taller still show every line stacked, as before. Compact rows are unchanged. Canvas items show only the name and were not touched. With all four fields on, a narrow pack1 card still truncates the joined line; that is accepted.

## 0.2.4 — 2026-09-24 — In-page color picker that closes when the cursor leaves
- **What:** color swatches (Settings → Colors, 3D viewer colors, icon picker color) no longer open the browser's native color popup. They open an in-page picker with a saturation/value square, a hue strip, a hex field and an eyedropper. Like every other popup, it closes when the cursor moves away from it.
- **Where:** `index.html`: `#colorPop` + `.color-pop` CSS; `openColorPicker`/`closeColorPop`/`cpDrag`/`hsvToHex`/`hexToHsv`; a capture-phase `click` listener on `input[type="color"]` (calls `preventDefault`, so the native popup never opens); `registerAutoClose` (now returns its entry, gains a nesting rule and an `autoClosePaused` flag); the `#ctx` outside-pointerdown ignores clicks inside `#colorPop`; Esc in the global keydown.
- **Notes:** cause: the native Chromium/WebView2 popup is outside the page's DOM, so `registerAutoClose` could not see or close it. A page also cannot move the OS cursor into it (the suggested workaround). The `<input type="color">` stays the source of truth: the picker sets `.value`, fires `input` on every change and one `change` when it closes (if the value changed), matching the native dialog. Existing `oninput` handlers (theme, v3d) and the icon picker's `change` handler work unchanged. Nesting rule in `registerAutoClose`: a popup whose anchor sits inside another popup keeps that parent open while the cursor is near it, and closes itself once its anchor is no longer rendered. The eyedropper sets `autoClosePaused` while it runs. The button only appears where `window.EyeDropper` exists. New `<input type="color">` elements get the picker automatically, so there is no per-input wiring.

## 0.2.3 — 2026-09-24 — Details panel shows only the thumbnail; PSD layers moved to the lightbox
- **What:** selecting a file no longer loads it into the main Details panel. There is no video player, waveform, font sample, text/PDF view or PSD render there any more. Every kind shows the same thumbnail as its library card (or the kind placeholder), like 3D models already did. The Details panel holds general info only. PSD layers moved to the lightbox: a ☰ button in the bottom-right corner (or D) opens a Layers panel. Clicking a layer shows that layer's render; "Composite" goes back to the flattened image.
- **Where:** `index.html`: `renderInsp` (one `.insp-thumb[data-thumb]` slot for all kinds), `applyThumb` (fills that slot when a late thumbnail arrives, any kind), lightbox `#psdBtn`/`#psdPanel` (`data-tools="psd"`, reuses the `.v3d-gear`/`.v3d-panel` look), `togglePsdPanel`, `loadPsdLayers`, `showInLight` (`syncLightTools` gets `"psd"` for .psd files), global keydown (D in a PSD lightbox toggles layers instead of Details).
- **Fix (same version):** the PSD lightbox used to show the 360 px card thumbnail, stretched. `/api/psd/{id}/preview` now serves a full-resolution composite. `library.psd_composite` renders it into `thumbs/psd/<id>_full.png` (so the existing `<id>_*.png` rename/delete globs cover it), re-renders when the PSD's mtime is newer, and falls back to the thumbnail only if rendering fails. Backend change, so the server must be restarted.
- **Notes:** thumbnail generation is unchanged (`_thumb_psd` on the server). Group rows are labels only because the backend cannot render a group. A layer PNG is the size of the layer, not the canvas. `attachViewer` re-fits when the image fires `load`, so swapping `src` frames each layer correctly. Tested with Playwright: selecting one file of each kind makes no `/api/file`, `/api/psd` or `/api/model-*` requests. The PSD panel was tested on a mocked PSD (the live library has none). An image without a thumbnail shows the placeholder, not the full file.

## 0.2.2 — 2026-09-24 — First click on a library card no longer swallowed
- **What:** a plain click on a card sometimes did nothing and only the second click selected it (reported on macOS, looked like "window activation"). Now the first click always selects.
- **Where:** `index.html` — grid `pointerdown` resets `skipClick` at the start of every gesture.
- **Notes:** cause: `onPtrUp` sets `skipClick` after a right-drag tile zoom or an active box-select, and only the grid's `click` handler cleared it. A right button never fires `click`, and a box released outside the grid fires it elsewhere, so the flag stayed set and ate the next real click (and blocked dblclick → lightbox). Canvas was checked: it selects on pointerdown and has no such flag. Not a macOS window-activation issue — Chromium delivers the first click to an inactive app window.

## 0.2.1 — 2026-09-24 — Packaged app survives sleep/resume
- **What:** after the PC woke from sleep the Sight window stopped working — the packaged build's server had quit itself. It now stays up.
- **Where:** `Sight.py` (`_watch_tab` watchdog: `RESUME_GAP`; new `--disable-background-timer-throttling` launch flag), `index.html` (`startHeartbeat` also pings on visibilitychange/focus/pageshow/online).
- **Notes:** cause: the frozen build quits when no heartbeat arrives for 10 s, measured on wall-clock time. On resume the watchdog thread ran before the page could ping and saw an hours-old heartbeat. The watchdog now treats a tick longer than 5 s as a suspend and grants the 30 s startup grace again. Source runs (Sight.bat) have no watchdog and were never affected. Not done: a "server stopped" banner in the page — a dead server still leaves a dead window.

## 0.2.0 — 2026-09-23 — Version number, agent docs, changes archive
- **What:** the version now shows after "Sight" in the sidebar header and in the window title; added `CLAUDE.md`, `docs/ARCHITECTURE.md`, this file and the archive script.
- **Where:** `app/version.py` (single source), `app/server.py` (`/api/state` → `version`), `index.html` (`renderBuildTag`, `#verTag`), `CLAUDE.md`, `docs/`, `tools/archive_changes.py`.
- **Notes:** bump `APP_VERSION` for every shipped change and reuse the number in the entry. Agents: read this file before reading code; add an entry after every change.

## 0.2.0 — 2026-09-23 — One shortcut rule for the whole app
- **What:** shortcuts fire only with exactly their modifiers (Shift+D no longer toggles Details).
- **Where:** new `app/static/keys.js` (`hotkey`, `runHotkeys`); canvas.js commands are one `KEYMAP` table; index.html's global keydown uses `hotkey()` for D, X/Delete, Ctrl+A, Ctrl+K, Space, Escape, Backspace.
- **Notes:** never write `e.key === "x"` alone. "/" is matched by character (may need Shift on some layouts) with explicit Ctrl/Alt/Meta guards. The 3D viewer's Shift+digit / Alt+digit code and lightbox arrows read modifiers on purpose and were left alone.

## 0.2.0 — 2026-09-23 — Crop rework: Alt-pan, no distortion, Shift resets
- **What:** Alt+drag on a picture pans it inside its crop; crop grips are small (28 px) and centred on each edge; frame/handle colours all use `--card-active-color`; a cropped picture can never be stretched; resizing a cropped item scales it proportionally; Shift while resizing drops the crop.
- **Where:** canvas.js — `applyCropFlip`, `cropBasis`, `cropAxis`, `startCrop`, `startCropPan`, `uncropForResize`, `.ccrop`/`.cframe` CSS.
- **Notes:** cropped `<img>` is sized by width only (`height:auto`) — the crop window's vertical extent is derived from the box, stored `crop_h` is re-synced on the next drag. Don't switch back to `object-fit: fill`.

## 0.2.0 — 2026-09-23 — Crop (Alt), mirror, duplicate, X delete
- **What:** hold Alt over an item for non-destructive edge/corner crop; Alt+X / Alt+V mirror selected items in place; Ctrl+D duplicates (new instance, offset 24 px); X deletes; the transform frame no longer lingers after delete.
- **Where:** `library.py` (`flip_x`/`flip_y` columns via `_migrate`, `_BOARD_ITEM_FIELDS`, `add_board_item`), canvas.js (crop, `mirrorItems`, `duplicateSelection`, `deleteSelection`, `removeItemLocal` → `updateFrame`).
- **Notes:** crop rectangle is normalized source-image space; flip is applied to the whole thumb area so crop stays un-mirrored. Backend change → restart the server.

## 0.2.0 — 2026-09-23 — Transform frame, group transform, layers, align without overlap
- **What:** one screen-space transform frame (common box for multi-selection, zoom-independent handles); group resize/rotate; `[` `]` move one layer, ↑/↓ to front/back; Align = gravity, Normalize separates overlaps.
- **Where:** canvas.js — `updateFrame`, `startResize`/`startRotate` (single + group), `restack`, `gravity`, `separateItems`, `commitLayout`.
- **Notes:** items no longer contain handles. `restack` renumbers z 0..n-1 as it goes.

## 0.2.0 — 2026-09-23 — PureRef-style arrange commands
- **What:** align (Ctrl+arrows), normalize height/width/size/scale (Ctrl+Alt+arrows), distribute (Ctrl+Alt+Shift+↑/↓), arrange optimal (Ctrl+P) and by name/addition/order/path/random (Ctrl+Alt+N/A/O/D/R), stack (Ctrl+Alt+S). Act on the selection, or all items if none selected.
- **Where:** canvas.js arrange section (`alignItems`, `normalizeItems`, `distributeItems`, `arrangeItems`, `packRows`, `stackItems`).
- **Notes:** shortcuts taken from PureRef's handbook. Normalize uses the *average* size — PureRef's "From first" option is not implemented (its default was not documented). Padding 10 = PureRef default.

## 0.2.0 — 2026-09-23 — Split divider, F/A framing, Ctrl+A, shared pixelation
- **What:** draggable divider between library and board (ratio/orientation remembered, double-click flips side-by-side/stacked); F frames selection, A frames all; Ctrl+A selects items instead of interface text; pixel-art stays crisp on the board and in the Details multi-select stack; Ctrl+drag box-select works over items.
- **Where:** index.html (`splitHandle`, `applyViewDom`, `combineSelection`, `selectAllInActivePane`, `#mainBody` ResizeObserver), canvas.js (`frameItems`, marquee).
- **Notes:** the library zoom reset happened because tile rescaling watched the grid's width (0 when hidden) — it now watches `#mainBody`. The Details stack bug was an inline `onload="markSmallSrc(...)"` calling module-scope functions (silent ReferenceError).

## 0.2.0 — 2026-09-23 — Canvas Phase 1 fix pass
- **What:** board opens beside the library (split view), right-drag zoom = the lightbox's, middle/right buttons work over items, marquee modifiers = grid's, Shift-rotate snaps to 15°, boards renamed/re-iconed like Collections, canvas toolbar and "add files" removed, split toggle moved to the header.
- **Where:** index.html (`renderCanvasBoards`, `showBoardCtx`, `openBoard`), canvas.js.
- **Notes:** root cause of the "stuck clicks": `.canvas-view{display:flex}` beat the UA `[hidden]` rule, so the canvas never hid — see the CSS gotcha in ARCHITECTURE.md.

## 0.2.0 — 2026-09-23 — Canvas Phase 1 core + Phase 0 backend
- **What:** "Canvas" section in the sidebar; boards with pan/zoom, drag files in from the library, move/resize/rotate, multi-select, z-order, undo/redo, autosave. Backend: `boards`, `board_groups`, `board_items`, `annotations` tables and REST API.
- **Where:** `library.py`, `server.py`, `canvas.js`, index.html.
- **Notes:** tables carry revision/updated_at/deleted_at for future sync (no sync yet). Groups and annotations have backend only.

## 0.1.1 — 2026-09-22 — Themes
- **What:** the default dark theme was lightened and small text (Note, Tags, chips) enlarged; added built-in presets Тёмная / Мягкая тёмная / Светлая / Тёплая in Settings → Theme.
- **Where:** index.html (`DEFAULT_THEME`, `BUILTIN_THEMES`, `renderThemeList`), `app/static/defaults.json`.
- **Notes:** `defaults.json` overrides `DEFAULT_THEME` at runtime — keep the two in sync. The preset names are Russian by the user's choice.
