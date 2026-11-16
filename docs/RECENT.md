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

## 0.54.0 — 2026-11-16 — Desktop: Graphite theme (compact, Inter), captions under thumbnails, resizable side panels
- **What:** new default look *Graphite*, picked from five variants on a mock-up stand: Inter 13 px, 26 px menu rows,
  30 px controls, sidebar 208 / inspector 260 px, one blue accent, frameless cards with name + one info line
  under the thumbnail, no serif wordmark. Sidebar section headers sit on a tinted band so they no longer merge
  with their rows (user feedback). The sidebar's and inspector's inner edges are drag handles (mouse, pen, touch);
  double-click resets; widths are remembered. Settings gets *Accent* (colour) and *Captions* (under / on the
  thumbnail); presets *Graphite* (was *Dark*) and *Classic* (the old sizes and colours).
- **Where:** `app/static/index.html` (`:root` tokens, shell CSS, `.sec`, `.card.capb`, `.panel-handle`, touch
  media block; `DEFAULT_THEME`, `CLASSIC_LOOK`, `BUILTIN_THEMES`, `migrateTheme`, `applyUi`, `capMetrics`,
  `layout`, card render, `renderOptions`, `PANEL_W` / `clampPanel` / `resizePanel` / `applyPanelWidths`,
  `bindSplitDrag` pixel mode `o.move`), `app/static/defaults.json` (theme + tileSize 160),
  `app/static/vendor/fonts.css` + `vendor/fonts/inter-*.woff2` (Inter variable 5.1.0, OFL, latin + cyrillic),
  ARCHITECTURE (theme, pane helpers), MANUAL (Look, Panel widths).
- **Notes:**
  - `accent` is new and separate from `border` (before, `--accent` was the frame colour). Anything without
    `accent` (old saved themes, old user presets) falls back to `border` — keep that fallback.
  - `capMetrics()` is the only source of the caption block height: CSS reads `--cap-n-lh / --cap-j-lh`,
    `layout()` reserves `L.meta` in grid and masonry. Change one without the other and rows overlap.
  - Migration: a saved theme holds every key, so new defaults would never show. Once (`themeRev` < 2), keys
    still equal to the 0.53 defaults (`CLASSIC_LOOK`) are dropped and get the new defaults; customised keys
    stay (a custom frame colour keeps its frame width / active colour). Written back after boot. Themes
    saved by builds with other defaults than 0.53 keep those values (treated as customised).
  - Dragging a panel edge does not rescale the tile (the `#mainBody` observer skips while `panelResizing`);
    window resizes still do, as before. Drags keep the library area >= 320 px; a window shrunk later can
    still squeeze it. Narrow screens (< 1024 px) ignore the widths (drawers) and hide the handles.
  - Touch screens and the narrow-screen drawers keep 40 px controls / 36 px rows whatever the theme says
    (media block placed after the base rules so it wins the cascade).
  - Not done: the phone app and the HTML review page keep their own look; mono figures and file-type badges
    from the mock-up were left out. *Classic* does not bring back the serif headings or the grey active row.
  - Review (fresh agent, ran the app in Playwright): caption heights verified exact across 22 grid / masonry
    combinations, init order and presets fine. Found: panel drags rescaled the tile on every move (clamped to
    the list mode, zoom drifted for good) → tile kept during drags + 320 px main-area minimum; touch targets
    shrank to 26 / 30 px on phones / drawers → touch media block; migration dropped the frame of a custom frame
    colour → kept; Classic accent not the old one → fixed; version tag hidden at narrow widths → ellipsis;
    touch hit strip covered the panel's own buttons → moved outward. Left: an empty info line leaves a small gap.
    Second pass (same reviewer): all fixes confirmed (tile drift and touch sizes re-run); found the outward touch
    strip now covered the first card column → strip limited to 12 px outside (the grid padding), 6 px inside. The same reviewer
    confirmed it by tapping in Playwright, nothing new. Keep the outer reach <= `--space-4` (grid padding).

## 0.53.2 — 2026-11-16 — Grid: thumbnails of a re-added folder get their size (masonry) and show after a restart
- **What:** in a source folder that had been removed and added again (or whose files changed while Sight was
  closed), masonry drew every card square and, after a restart, part of the thumbnails stayed placeholders.
  Both fixed; libraries already affected are repaired once on the first start.
- **Where:** `app/library.py` — `thumb_path` (trusted files only) / new `_thumb_file`, `prioritize`, `_make_thumb`,
  `remove_source`, `_migrate_asset`, `psd_composite`; new one-time `_untrust_dimless_thumbs` (marker
  `thumbs/trust_v1`); `_load_legacy_thumb_cache` removed. ARCHITECTURE (thumbnail trust).
- **Notes:** root cause: `remove_source` deletes rows but leaves thumbnail files; ids are path hashes, so a re-added
  folder's new rows (no width/height, `has_thumb=0`) met the old files. `prioritize` / `thumb_path` / the legacy
  glob adopted them silently — no `thumb` event (the client kept its placeholder until the grid re-read the item;
  after a restart the background glob had not run yet when the first page was listed) and no size (masonry falls
  back to square). Now a file the row does not know is an orphan: `_make_thumb` deletes it and renders again (once
  per asset, on screen), which stores the size and publishes the event. The repair untrusts image / video rows with
  `has_thumb=1` and no size (only adopted files can be like that); they re-render as they come on screen. The catch-up
  scan's `has_thumb=0` for a changed file (which left the stale file on disk) is covered by the same rule. Model
  thumbnails (client-rendered) are never deleted by `_make_thumb`. Very old libraries whose rows predate `has_thumb`
  re-render their thumbnails on demand (the legacy glob that adopted them is gone). Orphan files of a removed source
  are still not deleted from disk (deliberately: a delete in the background could race a re-add).
  Checked with a script (add → remove → add again → restart, and the repair) — old code: no size, no events; new: sized, 4/4 events.
  Review (fresh agent) found: repair limited to image / video (PSD, PDF, text, font, audio cards are sized by masonry
  too) → now every kind but `model3d`; `psd_composite`'s fallback marked a thumbnail without a `thumb` event → it now
  runs `_make_thumb` (under `_inflight`); a `remove_source` during a render could leave the id trusted → `_make_thumb`
  forgets it when its UPDATE hits no row; unguarded orphan unlink (Windows, file held open) → guarded; boards ask
  `/api/thumb` without the grid's event and got 202 for orphans → GET serves an untrusted file `no-store` while it
  re-renders (`thumb_file()`, public). Left: a sizeless video whose re-render now fails loses its old thumbnail (rare).
  Second pass (same reviewer): fixes 1–3 confirmed; 4+5 together let an orphan held open on Windows (by that very
  GET) survive a failed render and be trusted with no size → `_make_thumb` trusts a file only with a size when an
  orphan could not be deleted, and the GET reads the untrusted file whole (`Response`) instead of streaming it open.
  The same reviewer confirmed both, nothing new found; the script and unit tests pass after them.

## 0.53.1 — 2026-11-16 — Phone: the gallery button is back (two open buttons again)
- **What:** (phone home) two open buttons again, as before 0.51.0: *Photo or video* (the gallery) and *Open a
  file…* (Files: 3D models with textures, `.srev`, any media) — big on an empty home, two icons in the bar once
  there are reviews.
- **Where:** `mobile/js/app.js` `renderHome` (the pre-0.51.0 code restored from git, comment and subtitle updated),
  `mobile/index.html` (`.bar .mini .ib`, two-column `.opens`), MANUAL.
- **Notes:** why two: Android opens its photo picker only for `accept` limited to `image/*` / `video/*`; an input
  with no `accept` (which 3D and `.srev` need) gets Camera / Camcorder / Files and no gallery — a page cannot add
  a gallery item to that menu. iOS shows its photo library either way. The 0.51.0 entry's "the OS offers photo
  library, camera and Files" was true on iOS only. The gallery button takes one file (`multiple` off, as before);
  `test_pwa`'s `openButtons == 1` counts `label.pick-file` only, still one.
  Review (fresh agent): no code bugs (restore matches the pre-0.51.0 code, tests' selectors / counts hold); found
  ARCHITECTURE's "Home open button" still describing the single button — rewritten; the same reviewer confirmed the fix.

## 0.53.0 — 2026-11-15 — 3D: USD in the lightbox + USD animation, splats on the phone, notes' look on the phone; phone UV sets, background, grid cells
- **What:** (Sight) the lightbox opens `.usd` / `.usda` / `.usdc`, a `.usdz` without usd-core, and plays **USD
  animation** (moving transforms, skeletons) — an animated `.usdz` is read in the browser instead of the server's
  still conversion. The floor grid's colours follow the backdrop. (phone) USD animation plays too; **Gaussian
  splats** open (`.splat` / `.spz` / `.ksplat` / `.sog` / splat `.ply`) with notes on views as in Sight; opening a
  note shows the **shading and light it was written with** (Sight's `v3d`; the phone's notes carry one Sight
  restores). The UV view has no note plate: the UV set is named at the top, a swipe sideways shows the mesh's other
  sets. New Background icon (swatches + colour picker), a smaller grid with round cells and a *Cell* slider, grid
  colours from the background.
- **Where:** `model3d-core.js` (`parseUsd`, `usdAsSight` animated layout, `SPLAT_*` / `splatHome`, `gridColors` /
  `tintGrid` / `niceStep` / `modelGrid`); `index.html` (`loadUsd`, `.usdz` fallback, `makeModelManager().modify`,
  `fetchBufferWithProgress` error `status`, `cloneModel` root skeleton, shared splat constants, `syncRig` tint);
  `usdz_convert.py` (`_stage_animated`, `_root_is_crate`, `convert(…, animated_out)`), `library.py` (`.usd*` in
  MODEL_EXT, `.anim` marker, `usdz_is_animated`, `USDZ_CONVERTER_VERSION` 3), `server.py` (409), `fileinfo.py`
  (`_usd`); phone `model3d.js` (`isSplat`, `createSplatViewer`, `setBg` / `setGridCell`, `uvPicture` set),
  `app.js` (`await V.still`, `goView(vk, look)` / `applyNoteLook` / `noteLook`, note `ctx.v3d`, `showUv`, `viewer`
  title mode, Background / Cell rows, `turnB`), `model.js` (`lookOfV3d`, `v3dOfLook`, `views3d` v3d), `media.js`,
  `index.html`, `tools/build_pwa.py` (Spark + Pass.js). Tests: `fixtures/make_anim_usd.py` (+ `anim.usda`,
  `anim_v001.usdz`, `skel.usda`), `fixtures_3d.make_splat` / `make_splat_ply`, lift GLB with two UV sets,
  `test_usdz_convert.py`, `pwa_3d_formats.cjs`, `pwa_3d_tools.cjs`, `pwa_unit.cjs`. Docs: ARCHITECTURE, FORMAT
  (phone v3d), MANUAL, PLAN-mobile stage 4 (its "not done" list is done).
- **Notes:** an animated USD keeps its hierarchy (each mesh split in place, its parts before its children), so mesh
  order matches the still layout but the explode rig differs from the server conversion's flat one. The server
  calls a stage animated only for what three's USDLoader makes clips of (SkelAnimation; translate / orient /
  rotateXYZ / scale; `xformOp:transform*` only in a binary root layer — the loader's text parser gives it none);
  left: animation in a referenced layer of another format may still disagree. Standalone USD layers find textures
  by base name via `/api/model-res`; referenced USD files are not loaded. A splat `still()` is async: Spark's own
  sorting is switched off while it sorts for the still's camera (else an empty picture, cached for good); the
  desktop's splat view pictures are still synchronous (taken with the live sort order — not changed). Phone stills
  keep the default look (textured, studio, default background) so cached view pictures do not depend on it; a
  note's look is shown, not saved (as Sight's `setV3D`); explode stays the view's (findVk matches by it); phone
  "studio" = Sight's studio environment, Headlight / Flat = Sight's lights without one (Flat reads back as Headlight).
  The desktop grid did not follow the backdrop before (fixed colours) — it does now. Spark: three copies of a splat
  file at peak on the phone; off-screen stills blend in linear space (edges a little different from the screen).
  Reviews (a fresh agent per block; each confirmed its fixes): **USD** — nested meshes out of order in the animated
  layout, `is_animated` too broad (then too narrow: suffixed transform ops; text layers), a 409 hiding the browser's
  own error, Windows texture paths, a race in the marker check, two stage opens — all fixed. **Splats** — stills of
  any other camera came out empty (Spark's async readback) — fixed and tested (a view of one ball only); a closed
  viewer returned a blank picture; turn button flash. **Note look** — Go to / reply / edit-drawing used the view's
  look, the look was saved over the device's — fixed; explode left as the view's on purpose. **UV view** — a URL leak
  after close, a picture remade per swipe, errors outside the try, a failed set remembered — fixed. **Grid /
  background** — the 200-cell cap left the finest grid smaller than the model, mid greys hid the lines, the colour
  picker's row rebuilt under an open picker (iOS) — fixed.

## 0.52.0 — 2026-11-15 — Text plate: resizable, no "…" line under the text
- **What:** (everywhere: Sight lightbox, phone viewer, HTML reviewer page) the picture text plate no longer adds a
  "…" line under the text while more is below — that line came and went with the scroll and changed the plate's
  height; now only the last shown line fades out (mask, 1.2em). The plate is resizable: a small bar just outside the
  middle of its free edge (mouse or finger) — a top / bottom plate stays centred (height by up / down, width by
  sideways), a side plate grows into the picture; double-click / double-tap the bar = default size. One size for
  top / bottom, one for the sides, kept per device as shares of the host.
- **Where:** `app/static/caption-plate.js` (`.scp-grip`, `.sz` CSS, `paintSize`, `orient`, resize branch in
  `down` / `move` / `up`, `lostpointercapture` now ends any gesture, `.editing`); `mobile/index.html` and
  `app/review.py` set the new `--scp-bmax`; `MANUAL.md`.
- **Notes:** the size never goes past the host's room in CSS (`--scp-bmax` for a bottom plate's width — the phone /
  reviewer page keep the pencil / download button free; height ≤ host − `--scp-b` − `--scp-t`; side plates leave
  90 px). Minimum: 120 px wide, head + two lines high (measured at the press). The grip sits outside the plate so a
  tap on the head still folds it (`test_touch` taps there). While editing in place the plate takes the field's
  height. Stored state `{side, min, hz, vt}`; older `{side, min}` reads as no size. In a page loaded through
  Playwright `route` + `setContent` pointer capture does not work — test the plate from a served file.
  Review (fresh agent) found, fixed: a grown bottom plate could cover the phone's pencil / the page's button, and
  a tall one the top bars (CSS caps above); a capture lost mid-drag (plate hidden) left the gesture set and froze
  touch gestures (now ended in `lostpointercapture`, any kind); the minimum height left less than a line and the
  editor cramped; the fade hid most of the fifth line (1.6em → 1.2em); a small grip / 3 px threshold on touch
  (bigger hit box on coarse pointers, 8 px); stale comments. Left: a side plate past its CSS cap stores a bigger
  share than shown (no visible effect). The same reviewer confirmed every fix, then found two small ones, fixed: editing
  collapsed a resized side plate (the editing rule is top / bottom only); a wide bottom plate could reach under a
  landscape notch (`--scp-bxmin`, the phone sets it to its left inset); a top plate uses it too). The reviewer confirmed both.

## 0.51.0 — 2026-11-15 — 3D: animation (Sight + phone), phone mesh pick / hide / UV, shading / grid / light bar; one Open button
- **What:** (phone home) one *Open* button for every kind (big *Open a file* on an empty home, *＋ Open* in the bar):
  no `accept`, so the OS offers photo library, camera and Files. (phone 3D) a tap picks a mesh (orange); a row under
  the header: *Hide*, *Only this*, *UV* (its UVs over its texture in the full-screen viewer), *Show all*, ✕; a tap
  on nothing lets it go. Bottom bar (in `els.tp`): Shading / Grid / Light / Explode icons, each opens its choices in a
  row above (the explode slider moved here from the header). Animated models (glTF / FBX clips), Sight and phone:
  play / pause + time slider (+ clip picker). A 3D view now also keeps the animation pose (`ctx.anim {clip, t}`):
  drawings show only on that pose, going to a view / clicking a note puts it back, pictures / exports are taken there.
- **Where:** `app/static/model3d-core.js` — moved here from index.html and shared: `ENV_PRESETS`,
  `applyBaseMaterial` (now takes the solid params; temp materials copy the original's `side`), `applyXray`,
  `setWireOverlay`, the inspector's highlight (`highlightMaterials`, `meshHighlight` — follows `c.visible`) and UV
  picture (`createUvPainter`, `readbackCanvas`, `textureQuad`); new `createAnimator`. `review-core.js` `animMatch`.
  `index.html`: glTF loaders copy `animations` onto the scene, `v3dAnim`, `#v3dAnim` bar / `paintAnimBar`,
  `bindAnnot3d` (`getAnim / setAnim / withAnim / getAnimState / setAnimState / pauseAnim`). `annotate.js`: views
  carry `anim` (`rebuildViews`, `ctxNow`, `viewMatches`, `goView`, `view3dPic`, the export loop, `tick` sig has the
  view, not the time). Phone: `mobile/js/model3d.js` (`setShading / setGrid / setLight`, `pick / select / uvPicture`,
  `onTap`, `anim`, `still` with a pose), `mobile/js/app.js` (`paint3dTools` rewritten, `paintAnim`, `paintSel3d`,
  `tap3d`, `showUv`, `applyLook3d` / `sight-review:v3d`; `liveLook / viewFits / findVk / ctx3d / goView / viewPic`
  with anim; home open button), `mobile/js/model.js` (`animOf`, `views3d`, `drawCtx`), `mobile/index.html`.
  Tests: `tests/pwa_3d_tools.cjs` + `test_pwa.test_model_tools`, `fixtures_3d.make_glb(anim=True)` (two boxes, clip
  "Lift" moving Box 2, UVs). Docs: FORMAT (ctx.anim), ARCHITECTURE, MANUAL.
- **Notes:** animator + explode: every pose change puts the rig's parts at rest, lets the mixer pose, re-bases
  `it.pos`, re-explodes (so they stack); built right after the rig in both viewers, so an animated model now opens
  at clip 0, t 0 (not the bind pose; framing / floor / rig were measured before — older drawings on such a model
  were made on the bind pose). Last pose = duration − 1 ms (a looping action at its duration shows t 0). A view's
  `anim` is fixed when the view is made (like `hidden`); a view with none, or a viewer with no clips, matches any
  pose. Pressing on the model in annotate mode / opening the phone's pencil pauses the clip (a drawing belongs to
  its pose); the export pauses and resumes. Phone shading / grid / light are the device's, not the review's, and
  view stills always use Textured + Studio without grid / selection (pictures are cached). Not done: a desktop
  shortcut for play / pause; Sight's lights / floor on the phone; shading restored from Sight's `v3d` on the phone.
  Review (fresh agent) found, fixed: phone view pictures took the phone's shading / light into the cache; scrubbing
  while playing rebuilt the bar under the finger; Sight's clip picker kept the last model's names; Sight's annotate
  panel repainted every frame while playing (lost clicks); drawing on a playing model hid the drawing at once; a view
  with a pose never matched on a viewer without clips; the export took views at a moving pose; a stuck "finger"
  count could kill taps; the highlight outlived a hidden mesh; a misplaced comment; several photos picked → only
  the first, silently (now a toast). The same reviewer confirmed every fix and found nothing new. Left (low): taps
  on animated skinned meshes may miss (cached bounding sphere).

## 0.50.0 — 2026-11-15 — Cut / copy / paste of selected drawings (Sight, reviewer page, phone)
- **What:** (Sight lightbox) `Ctrl+X` cuts the selected drawings (`Ctrl+C` / `Ctrl+V` were there); the first
  paste after a cut puts them back where they were, later pastes / pastes after a copy step 20 px down-right.
  (Drawing canvas — HTML reviewer page and phone app) `Ctrl+C` / `Ctrl+X` / `Ctrl+V` with the select tool, and
  for touch *Cut / Copy / Paste* buttons in a small bar under the top bar (shown with the select tool and a
  selection or something to paste). The clipboard lives while the page / app is open, so a drawing copied on
  one frame or picture pastes on another.
- **Where:** `app/static/annotate.js` (`cutSelection`, `S.clipCut`, `paste` offset, Ctrl+KeyX in `onKey`);
  `app/static/review-draw.js` (module `clipboard` / `clipCut`, `ctrlOnly`, `copySel`, `pasteClip`, `.dclip` /
  `clipBar` shown in `paint()`, `onKey`); tests `tests/draw_clip.cjs` + `DrawClipboard` in
  `tests/test_review_page.py`; `MANUAL.md`, `docs/ARCHITECTURE.md` (Drawing canvas); `CLAUDE.md` (new house rule:
  every feature works on desktop *and* on a touch screen without a keyboard — the user's default expectation).
- **Notes:** pasted canvas items get no `id` and no `note` / `reply` / `ctx` (hosts treat id-less items as new
  rows and assign those); `z = ++zc` in the copied items' z order. A paste after a cut is in place only while
  none of the cut drawings is back (an undo restores them → the paste is offset, never an unseen twin on top).
  Pasting onto a picture of another doc size does not rescale; the clipboard is re-centred only when it lies
  wholly outside the new `vb`. Keys not applicable (nothing selected / nothing copied / typing) keep the browser
  default. Not done: the system clipboard (copies stay inside Sight / the page), cut / copy / paste of notes.
  Review (fresh agent) found, fixed: cut → undo → paste stacked an invisible duplicate on the original (both
  editors); copies were stacked by selection / array order instead of z; the new test class sat after
  `unittest.main()`; a clicked button kept the focus (Space / Enter pasted again → it blurs). The same reviewer
  confirmed every fix and the buttons (layout at 360 px, stale state). Left as is (low): the canvas' keys do
  not look at `e.target` (pre-existing); the bar covers ~130×46 px at the picture's top centre while shown.

## 0.49.0 — 2026-11-15 — Phone app: 3D models (glTF / GLB, FBX, OBJ, STL, PLY, USD), notes on views
- **What:** (phone app, PLAN-mobile stage 4) *Open a file…* takes 3D models: `.glb` / `.gltf`, `.fbx`, `.obj`,
  `.stl`, `.ply`, `.usdz` / `.usd` / `.usda` / `.usdc`; files a model points at (a `.gltf`'s `.bin`, textures) are
  picked together with it and kept with it. One finger orbits, two zoom / pan; header: eye, quarter turn, explode
  slider, *Show all* (a view's hidden meshes), *Frame*. Notes, drawings and replies stand on **views** (camera +
  hidden meshes + explode) exactly as Sight writes them — numbered as in Sight, a note may hold several views
  (orbit, draw again), cards / the full-screen viewer / PDF / HTML show each view ("V1", "View 1"), replies are
  written over the model with view chips, a `.srev` round-trips with Sight (checked: phone drawings land on the
  same spot in Sight's lightbox).
- **Where:** `mobile/js/model3d.js` (new: `parseModel`, `createViewer` → `getView / setView / still / attach /
  turn / home / setHidden / setExplode`); `mobile/js/app.js` "3D" block (`viewsNow`, `findVk` / `viewFits`, `ctx3d`,
  `updateCurVk`, `goView`, `viewPic`, `frame3dNow`, `drawModel`, `asyncViewAt`, `picExplode`, `buildStage3d`,
  `paint3dTools`) and 3D branches in cards, composer, replies, viewer, editing, exports; `extras` through
  `openAny` / `openMedia` / `openReview` / `autoKeep` / `rebind`; `mobile/js/model.js` (`views3d`, `explodeOf`,
  `noteViews`, `replyViews`, `drawCtx` keeps hidden / explode); `mobile/js/report.js` (`viewAt`, `burn(…, ox, oy)`);
  `mobile/js/store.js` (`keepFile(key, blob, extras)`); `mobile/js/media.js` (`MODEL_EXT`); `mobile/index.html`
  (import map, CSS). **Shared with Sight:** new `app/static/model3d-core.js` — `frameObject3d`,
  `buildExplodeRig` / `applyExplode`, `buildEnvTexture`, `applyTurns`, `dropDeadTextures`, `stlMesh` / `plyMesh`,
  `plyHeaderIsSplat` moved out of `index.html` unchanged (index.html imports them), `meshOrder`, `usdAsSight`;
  `camMatch` moved from annotate.js to `review-core.js` (`RC.camMatch`). Vendored three@0.185.0 `USDLoader.js` +
  `loaders/usd/*` (USDCParser patched: inlined Vec*d / Vec*h). `tools/build_pwa.py` publishes the three.js parts
  (`THREE_FILES`); `.github/workflows/phone-app.yml` paths. Tests: `tests/pwa_3d.cjs`, `tests/pwa_3d_formats.cjs`,
  `tests/fixtures_3d.py`, `tests/fixtures/parts_v001.usdz`, `parts.usdc`, `mats_v001.usdz`; `test_pwa.py`
  `test_model3d`, `test_model_formats`. Docs: ARCHITECTURE (Phone app → 3D), MANUAL, PLAN-mobile.
- **Notes:** USD is read on the phone (no server): `usdAsSight` lays it out as Sight's server conversion does
  (Z-up → Y-up, no metersPerUnit scale, one mesh per material group sharing the part's vertices, under one
  node), so views from Sight match — verified against `usdz_convert` (bounds, mesh order and boxes, textures);
  left: the conversion drops invisible / proxy meshes, the loader keeps them. The explode rig is built at the
  review's turns, as Sight builds it at its own (both depend on it). A view picture's aspect is what its drawings
  need (1–2.4); drawing uses a still at the stage's own aspect. Not done: splats (refused), hiding meshes on the
  phone, Sight's shading / lights (`v3d`) on the phone, Sight's lightbox reading `.usd*` without usd-core.
  Not checked on a real phone (WebGL memory with big models, the Files picker with several files).
  Review 1 (fresh agent, the 3D review logic) found, fixed: a model picked again while loading left the old
  viewer in use and leaking; a single-part model never matched a Sight view with an explode amount (the
  amount is now kept without a rig); a draft drawn on a new view stayed hidden until the camera moved; the
  view's explode / hidden did not follow Sight's `rebuildViews` / `explodeOf`; legacy views' pictures caught the
  live hidden / explode in the cache; a `hidden` list was added to older Sight views; then (second pass) the
  current view is kept while it fits and a note's own view takes the note's amount, as in Sight. The same
  reviewer confirmed every fix. Review 2 (fresh agent, the formats) found, fixed: every USD texture was dropped
  (its images bypass the LoadingManager), USD mesh order / explode differed from Sight's conversion, picking a
  kept model alone wiped its kept textures, a splat `.ply` was read whole to be refused (and saved first), a
  failed viewer build leaked its renderer; then (second pass) USD faces in no GeomSubset were not drawn, two
  subsets of one material made two meshes, and a mesh's parts were not in Sight's material order — the vendored
  USDComposer is patched (marked "Sight") and `usdAsSight` merges / orders parts as `usdz_convert` does. The same
  reviewer confirmed every fix. Left, documented (low, order only): display-colour-only materials share one key,
  invisible / proxy meshes register their materials.

## 0.48.0 — 2026-11-14 — Picture text plate without scrollbar; page captions on their own line, named downloads; notes as ZIP
- **What:** (everywhere: Sight lightbox, phone, reviewer page) the picture text plate has no scrollbar; while text is
  left below, the last shown line fades and "…" stands under it. (HTML reviewer page) under each picture: its title
  ("clip.mp4 · f128 / 0:05+3", attachments "clip.mp4 · Note 1 · Picture 2") with a download button, the picture's own
  text on the next line in the note's text style (15 px); the download — and a new one top right in the full-screen
  viewer — saves the picture with the shown drawings burned in, named "clip.mp4 · f128 · 0.05+3.jpg" instead of the
  browser's "download.jpg". (Sight) Export → *Notes as ZIP*: a folder per note ("Note 01") with its pictures (drawings
  burned in, named as above) and "Note 01.txt" = the note's text + each picture's text under that picture's file name;
  a still image's cover at the root.
- **Where:** `app/static/caption-plate.js` (`.scp-more`, `paintMore`, `.scp-body.more` mask, `--scp-rt`);
  `app/static/review-core.js` (`picFileName`); `app/static/annotate.js` (`gatherReport(forPage, everyNote)` → per picture
  `title` / `text` / `file`, `frameTitle` / `frameText` / `frameFile`, `shotFiles`; `exportZip`, menu `data-ex="zip"`;
  gatherReport now inside the try of every export); `app/review.py` (`build_zip`, `_zip_part`, `_image_ext`; page:
  `picTitle`, `savePic`, `picCaption`, `capParts`, `.pcap` / `.dl` / `.ptext` / `.zdl`, `frameOf` carries `title`);
  `app/server.py` (`POST /api/review/export/zip`); `MANUAL.md`, `docs/ARCHITECTURE.md`.
- **Notes:** a picture inside the page cannot carry a file name for the browser's own "Save image as" (inline data
  URLs always save as "download"), so naming goes through the explicit download buttons (`<a download>` on a blob).
  PDF captions are unchanged (`caption` / `frameCaption` = "<title> — <text>"); pre-0.48 pages split that caption
  (`capParts`, after the media name). Page downloads draw with `RC.drawCanvas` (no SVG-to-canvas taint). In a container
  with no UTF-8 locale headless Chromium names non-ASCII downloads "download" — run Playwright with `LANG=C.UTF-8`.
  Checked: unit tests; the page driven in Playwright (captions, 15 px texts, download names, burned-in drawing, plate
  "…" / no scrollbar); the ZIP exported from the real app on a temp library (names, txt, burned-in rect). Not driven:
  video / 3D ZIP (no video in the container). Replies are not in the ZIP's txt (not asked).
  Review (fresh agent) found, fixed: a media name of ~125+ chars lost the ".jpg" in ZIP names (`_zip_part` cut the
  whole name — now the stem) and the frame label (`picFileName` now cuts the media name, not the frame); an old page
  on a file named "A — B.mp4" split its caption at the wrong dash; a failing report build left the 60 s toast up. The
  same reviewer confirmed all fixes and found nothing new.

## 0.47.0 — 2026-11-14 — No "note frame" on video; frame numbers on previews; reviewer page viewer as on the phone
- **What:** (Sight + phone) a video note no longer marks the frame it was typed on: its big state-coloured markers
  sit on every frame its own drawings (or a picture text of it) are on; the card's time, a click on the card / a
  marker step go to those frames; PDF / HTML / phone reports carry only those frames (a note with only words keeps
  the frame it was written on as a fallback — on the timeline always, in reports / card previews only when it has
  no attached pictures either). Note previews (desktop panel, phone cards) show the frame number top left.
  (HTML reviewer page) the full-screen viewer is the phone's: round Back + pencil (no "✎ Draw" button), the
  caption plate with the note's text and the picture's own text, a strip slide sideways through the note's pictures
  and up / down between notes (keys ←→↑↓, Esc); the pencil answers on any picture of the note (any frame / view; an
  attachment → a drawn-over copy). Frame labels are "f128 / 0:05+3" (frames after the full second), burned smaller.
- **Where:** `app/static/review-core.js` (`noteTimes`, `frameLabel`); `app/static/annotate.js` (`noteFrames`,
  `noteCtx`, `marks()` / `markerTimes`, marker click, `goNote`, `notePreview` / `previewBox(keep)` / `.an-fno`,
  `replyPreview` per frame, `platePic`, `gatherReport` → `frameCtx` + `more`, `bakeFrame` / `frameTitle`);
  `mobile/js/app.js` (`noteTimes`, `markerList`, `jumpNote`, `noteFrame`, `noteCard`, `fnoTag`, `asyncFrameAt(cls)`,
  `threadFrames`, `noteFrameList`, `selectNote` / `goTo` / `showNote`, `replyEntry`), `mobile/js/report.js`,
  `mobile/index.html` (`.fno`); `app/review.py` (`plate_js`, `%%PLATE%%`, viewer `zoom(group, k)` / `GAL` / `galAdd`
  / `drawTarget` / `noteFrameKeys`, `frameOf` reads `frameCtx`, `drawFrames`, `pickFrame`); `tests/pwa_touch.cjs`
  (selection expectation); `MANUAL.md`, `docs/ARCHITECTURE.md`.
- **Notes:** no format change: `data.ctx` of a note is still written and still the merge / hold anchor; only where
  it is *shown* changed. Reply drawings never pick a note's frames (timeline, both reports, phone) — they show with
  their reply. 3D desktop report likewise uses only views with drawings / texts (fallback: the note's own view).
  The page inlines caption-plate.js + keys.js with their import / export keywords stripped (`plate_js` refuses to
  build if any other import / export appears); the page cannot edit picture texts. On the page a tap no longer
  closes the viewer (Back / Esc do, as on the phone). Checked: unit / PWA / page tests pass; the page viewer driven
  in Playwright (swipes, keys, plate, pencil on a second frame → reply row at that frame). The desktop markers /
  report were not driven in a browser (no video in the container) — read and reviewed only.
  Review (fresh agent) found, fixed: a click on a note's later marker jumped back to its first frame (goNote's
  seek won); a reply's preview drew all its drawings over the typed-on frame (now one preview per frame it drew on);
  caption-only frames had no desktop preview; the phone's card tap ignored the fallback frame for a note with
  shots; the page's pencil offered a flat "reply copy" on a media frame image (now only on attachments); the desktop
  report counted reply drawings when picking a note's frames (video and 3D). A second pass of the same reviewer
  over the fixes confirmed them and found one more, fixed: a click on a reply's frame picture did nothing (the
  `.an-rep` early return in `onListClick`; it now picks the note and seeks there). Left: a drag during a pending slide offsets the
  outgoing picture (cosmetic); 3D labels on the page are a bare "View".

## 0.46.5 — 2026-11-14 — Picture text plate: drag scrolls the text; the head moves the plate
- **What:** the text on the picture plate (lightbox, attached-picture view, phone viewer) scrolls the same way
  everywhere: a middle-button drag moves the words with the mouse (no browser autoscroll), and when the text is
  longer than the plate a plain drag on the text scrolls it too (a finger natively) — the plate is then moved
  only by its head (number / label). Short text: a drag anywhere still moves the plate. A tap still folds it.
- **Where:** `app/static/caption-plate.js` — `pan` / `panDown` / `panEnd` (middle drag; the edit field's own
  scroll while editing), `g.scroll` in `down` / `move` / `up`, `.scp-pan` cursor, auxclick / lostpointercapture.
- **Notes:** same feel as index.html `attachPanScroll` (direct follow, no inertia) — the module can't import it
  (the phone has no index.html). Finger scroll stays native (`touch-action: pan-y` → pointercancel). Tests drag
  the plate by its head already.
  Review (fresh agent) found, all fixed: a middle press while the left button was held fired no pointerdown, so
  its mousedown still started autoscroll / paste (a `mousedown` guard now); a stale `.scroll` class (layout change
  without a window resize) could make a finger drag do nothing (touch decides by the class; a ResizeObserver keeps it
  fresh); a pen both panned natively and by script (only the mouse scrolls by script); new text mid-drag jumped
  (the drag scrolls by the step since the last move). Left as is: a middle press on the pencil / scrollbar also pans.

## 0.46.4 — 2026-11-13 — Annotations: dragging a value of a selected drawing no longer stops at the field's edge
- **What:** with the select tool (V) and a line / shape / text selected, dragging a number in the bar (Width, Size,
  Opacity, Radius…) stopped as soon as the pointer left the field. It now goes on until the button is let go, as it
  did for the tool's own settings (nothing selected).
- **Where:** `app/static/annotate.js` — `numDrag` (new), `renderProps` (returns while it is set), `bindNum` (sets it on
  press, clears it and re-renders the bar on pointerup / pointercancel / lostpointercapture).
- **Notes:** root cause: a change to a selected drawing goes through `commit` → `afterChange` → `renderProps`, which
  rebuilt the bar's HTML mid-drag; the dragged control was replaced and its pointer capture went with it (the tool's
  styles path saves without re-rendering, so it never broke there). Checked in Playwright: a rect's Width dragged
  well outside the field went 4 → 71 (4 → 4.4 before the fix).
  Review (fresh agent): found the flag could stick for good if the lightbox closed mid-drag (the capture is lost at
  the document, not the control) — `numDrag` now holds the control and counts only while it is in the page; and that
  the drag kept writing after the selection changed mid-drag (Esc, Delete, a tool key, undo) — the drag now ends when
  its target (selection ids or tool) changes, and the bar is re-rendered then instead of opening the typing field.

## 0.46.3 — 2026-11-13 — A new note takes every loose drawing
- **What:** adding a note now attaches every drawing that has no note yet, whatever frame / view it is on and
  whenever it was drawn — before, only the loose ones on screen and those drawn since the file was opened. A sketch
  left from an earlier opening of the file (drawn, never added) no longer hangs on its frame. The owner chose this
  over a "delete loose drawings" command.
- **Where:** `app/static/annotate.js` — `pendingDrawings` (just `isDrawing && !data.note`). `MANUAL.md`.
- **Notes:** the compose mode (clean picture, view chips) still counts only recent loose drawings
  (`S.composeSince`, `S.adopt`), so an old sketch alone does not keep the picture clean or show the chips; it is
  still counted in the panel line ("+N drawings (k on other frames)"); an empty Add with only old sketches off
  screen gives the "Type a note…" toast instead of an empty note. Known: a forgotten old sketch (or a loose row from
  another reviewer's file, if any) goes into whatever note is added next, under this reviewer's name.
  Review (fresh agent): no correctness bug; the empty-Add case and two stale comments were fixed. Checked in Playwright (video:
  stroke on one frame, reload, note on another frame took it, no loose rows left).

## 0.46.2 — 2026-11-13 — 3D: view numbers show only while a note is made, above its field
- **What:** the numbered 3D view chips are no longer a row at the top of the review panel. They show only while a
  note is being made (drawing, or typing in its fields), right above the note field, titled *Views of this note*,
  and list only the views the new note will hold: those of the drawings waiting for it and the camera on screen (a
  dimmed dashed next number when that camera is no view yet — adding the note makes it). A chip still goes to its
  view. Added notes show their views as their pictures in the card.
- **Where:** `app/static/annotate.js` — `.an-views` moved into `.an-compose`, `renderViews` (rewritten; called from
  `renderPending` too; markup signature on `el.dataset.sig`), CSS `.an-views`, `.an-vchip.new`. `MANUAL.md` (3D).
- **Notes:** a chip's `mousedown` is prevented so the note field keeps the focus (compose mode stays on). Review
  (fresh agent): found that a module-level signature left an empty block after the panel was rebuilt (fixed: the
  signature lives on the element) and a CSS margin on the new span (fixed). Known, left: a click on a chip while the
  camera is still easing off a view can be lost (the chips rebuild as the current view changes). Checked in
  Playwright with a GLB (swiftshader): hidden at rest, shown while drawing / typing, gone after Add, next-number chip
  after an orbit.

## 0.46.1 — 2026-11-13 — Annotations: drawings added to a note are editable again (0.45.0 lock lifted)
- **What:** the owner asked to roll back 0.45.0: a drawing added to a note (or a reply) can again be moved, scaled,
  restyled, nudged, reordered, partly erased and retyped, as before 0.45.0. Undo again reaches back over adding a
  note; drawings it takes off a note now go to the next note instead of hanging loose (below).
- **Where:** `app/static/annotate.js` — `baked` now returns false (the `baked` / `editable` gate and every call site
  of 0.45.0 / 0.45.1 stay), `addNote` no longer clears undo / redo; `S.adopt`, `applyStates`, `composerBack`. `MANUAL.md`. `app/version.py`.
- **Notes:** supersedes 0.45.0 (archived) and the lock part of 0.45.1. Kept on purpose: the gate itself, so the
  planned lock is one function (see `docs/PLAN.md` "Note locks": an artist may not edit a supervisor's original
  notes, only answer with their own; a resolved note is locked entirely). 0.45.1's other fixes stay: Front / Back
  put the selection above / below every drawing, copies of a reply's drawing clear `data.reply`, the Hold selector
  shows for an editable selection (now any). Its dashed outline for a baked selection is unreachable until a lock
  returns. Checked in Playwright (scratch library): a note's stroke moves with the select tool and Ctrl+Z puts it back.
  Review (fresh agent): no lock path left outside the gate; it pointed out that undo across a note leaves drawings
  hanging, fixed here: a drawing that an undo / redo takes off its note (`applyStates`: note set before, null after)
  goes into `S.adopt`, and `pendingDrawings` / the compose mode take it whatever frame / view it is on, so the next
  note picks it up instead of leaving it loose on its frame. Undoing "add note" (`step.added`, `composerBack`) also
  puts its screenshots back into the pending row and its text / picture text back into the fields (a field already
  typed in gets it on a new line); redo takes them out again when a field still holds exactly that text, and makes
  the picture clean as adding did. A second fresh-agent review of this found no correctness bug (the tagged step is
  always the addNote step; stale `S.adopt` ids are harmless — every use also needs `!data.note`). Checked in Playwright (video, two frames + a screenshot: undo, then a note on a third frame took
  both drawings and the screenshot, no loose rows left). Not cleaned: loose drawings already left in libraries by
  earlier sessions (older than the file's opening, not on screen) still wait on their frames.
  Front / Back keep the 0.45.1 rule (z may go below 0; storage accepts it).
