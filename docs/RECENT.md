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
