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

## 0.61.0 — 2026-11-17 — Voice dictation in the annotation text fields (desktop); STT plan revised
- **What:** a microphone button in the note composer (it dictates into the last focused composer field: the note
  or the picture text) and a floating one at the corner of a focused note-edit, reply or picture-text field. Click
  / tap or `Alt+M` toggles; the button pulses while listening; interim words show in a muted bubble, only final text
  goes into the field at the caret (undoable with Ctrl+Z); click, Esc or `Alt+M` stop (pending words land), blur or
  Enter abort. Right-click / long-press the mic: language list (Auto = the browser's language + 14), saved as
  `sight.dictation.lang`. No API (Firefox), a denied microphone or no network → the title and a toast explain it.
  Uses the browser's Web Speech API only (Chrome / Edge online via Google, Safari on-device); no backend, no keys.
  `docs/PLAN-stt.md` is the revised plan; the user's `docs/tmp/stt-implementation-plan.md` is kept untouched.
- **Where:** new `app/static/dictation.js` (`createDictation`, `PROVIDERS.webspeech`, `insertAtCaret`,
  `createDictationUI` → `{mic, toggle, stop, destroy}`, `SHORTCUT`); `annotate.js` (import, `S.dict` / `S.dictTa`,
  the mic + `data-dict` in `buildPanel`, `createDictationUI` in `mount` / `destroy` in `unmount`, a labelled
  `keyTable` row, `dictateNote`); MANUAL (Dictation); `docs/PLAN-stt.md`.
- **Notes:** the original plan (Groq whisper-large-v3-turbo as the main engine + Windows SAPI / macOS
  NSSpeechRecognizer fallbacks, a Python `ISTTProvider` / `STTRouter`, 16 kHz capture) was written for a native
  app: Sight's UI is a web page, so every engine there would run in the Python server with audio streamed from the
  page — heavy for no gain, and it missed the free Web Speech API with live interim text. Revised tiers: (1) Web
  Speech now, (2) optional Groq through a backend proxy that holds the key (any browser, better punctuation, audio
  leaves the machine), (3) local whisper only on demand. Interim text is never written into the field (a textarea
  cannot style part of its text, and it would pollute the undo stack). Mic buttons `preventDefault` on mousedown
  so the field keeps focus (a blur would save and close an in-place edit). The shortcut is also bound in the module's
  capture listener because the field handlers stop propagation; `Alt+M` instead of Ctrl+Shift+M (Chrome / Edge's
  profile menu); on macOS Alt+M types "µ" but `e.code` is still KeyM and the character is suppressed. Chrome ends
  continuous sessions on silence: the module restarts them (cap: 3 restarts within 1 s each; 3 `no-speech` sessions
  ≈ 25 s → "No speech heard" and stop). Not done: Groq, dictation outside the annotation panel, a real-microphone
  test (tests use a fake `SpeechRecognition`), touch long-press on a device. Review (fresh agent) found: document /
  window listeners never removed (two instances after reopening the lightbox — fixed with an AbortController + dead
  flag), a focused field removed without blur kept the mic listening (fixed: a 300 ms `isConnected` tick, privacy),
  the reserved shortcut (changed), the language popover ignoring Esc / `registerAutoClose` (fixed), `no-speech`
  ending the session (now a restart), dead buttons kept (pruned). The same reviewer confirmed all six, nothing new.

## 0.60.0 — 2026-11-16 — Video annotation: configurable frame stamp (live and burned into report pictures)
- **What:** the video annotation toolbar has a frame-stamp icon (+ a ▾ for its settings; `Shift+F` while
  annotating): a label with the current frame over the video, not part of the drawings. Drag it (mouse, pen,
  finger) — it snaps to one of eight spots (corners, side centres). Settings (▾ or a tap on the stamp): Show
  (frame + time / frame / time), size, text colour, backdrop colour + opacity (0 = none), font (normal / bold /
  mono), a 3×3 position picker, Reset. Saved per device. The same settings style the label burned into exported
  report pictures; defaults equal the old look (top-left, white on 60 % black), so nothing changes until touched.
- **Where:** `app/static/annotate.js` — `STAMP_DEFAULT` / `STAMP_POS`, `loadStamp` / `saveStamp` (`sight.annotate.stamp`),
  the "frame stamp" section (`stampText`, `stampBox`, `stampXY`, `paintStamp`, `stampDown`, `toggleStamp`,
  `buildStampPop` / `paintStampPop` / `closeStampPop`), `bakeFrame` rewritten on `stampBox` / `stampXY`, a
  labelled `keyTable` row, hooks in `buildBar` / `paintBar` / `renderAll` / `tick` / `toggle(false)` / `onDown`,
  `.an-stamp*` CSS; MANUAL (Frame stamp).
- **Notes:** device preference, not review data (FORMAT.md unchanged). Size is a % of the picture width (min 11 px),
  so the live label equals the burned one up to tiny displays. Show modes split `RC.frameLabel` on " / " —
  review-core, the HTML page and the phone are untouched (they consume the burned pictures). The burn always
  happens, whether or not the live stamp is on; the panel's `f<N>` chip is unchanged. The stamp lives in the turned
  layer root, so it rotates with a turned view; stamp clicks are stopped so a tap does not play / pause. `toggleStamp`
  returns false outside annotation mode (the "Video" key group also runs in the plain lightbox). Drag geometry is
  captured at pointerdown (a zoom mid-drag uses stale values, accepted). Default top-left overlaps the lightbox's
  floating "i" button. Review (fresh agent): `Shift+F` flipping the saved preference from the plain lightbox (fixed),
  the popover swallowing every key after a click on its buttons (fixed: only INPUT / SELECT keep keys, buttons blur,
  Esc closes it), `stampDrag` stuck after a cut-off drag (reset in unmount / toggle / layer creation, `lostpointercapture`),
  Alt gestures blocked on the stamp (fixed), ▾ touch size / `tabular-nums` (fixed). The same reviewer confirmed the
  fixes; its last gap (Esc inside a focused slider stopped at the popover) is fixed by letting Escape through.

## 0.59.2 — 2026-11-16 — Video: Alt-scrub with the select tool; smooth mid-clip scrubbing of long-GOP clips
- **What:** with the annotate select tool (V) active, Alt+drag on empty space scrubs a video (or turns a picture)
  again. Clips with long GOPs (phone / screen recordings: the user's sample has keyframes only at 0 and 8.3 s) now
  scrub smoothly in the middle: after two slow seeks during a drag Sight makes a small short-GOP **scrub copy** in
  the background (≤ 960 px, no audio, keyframe every 4 frames) and shows it over the player while dragging; the
  player lands on the full-quality frame when the drag ends.
- **Where:** `annotate.js` `onDown` (Alt in empty space passes to the viewer); `app/library.py` (`SCRUB_TAG` /
  `SCRUB_VF` / `SCRUB_ENC`, `scrub_copy_path`, `scrub_status`, `start_scrub_copy`, the playback-copy job code takes
  a `tag`, jobs keyed `aid+tag`, kind-aware cleanup, `_prune_scrub_copies`, `_encode_copy` with the playback-first
  priority: `_play_cv`, `_play_waiting`, `_scrub_proc`); `app/server.py` (`POST /api/video/scrub`,
  `GET /api/video/scrub/{aid}`); `video-playable.js` (`convertForPlayback(…, kind)`); `index.html` `attachViewer`
  (`.view-scrub` overlay, `loadScrubCopy` / `pumpScrubCopy` / `hideScrubCopy`, `SLOW_SEEKS` / `SLOW_SEEK_MS` /
  `SCRUB_COPY_MIN_S`, `scGen`); `tests/test_playback_copy.py` (8 tests); MANUAL, ARCHITECTURE.
- **Notes:** root cause measured in Edge: a browser seek decodes from the previous keyframe, so on the sample a seek
  took 5 ms at 0.1 s and up to 230 ms at 8.1 s (≈ 27 ms per second of distance); in a 120-move drag over 3 s only
  24 positions painted mid-clip vs 70 at the start; the RAM cache was irrelevant (the file fits in it). With the copy
  91 of 91 frames paint. The copy is never played (`playback_path` ignores it), lives in `thumbs/video/<aid>_<stamp>.scrub.<ext>`
  (the `<aid>_*` rename / delete globs cover it), is requested lazily (the first scrub of a slow clip is still choppy
  until it exists; clips < 3 s never ask), capped to the newest 20 files / 1 GB (`SCRUB_KEEP_FILES` / `SCRUB_KEEP_BYTES`,
  oldest by mtime, never the one just made). One ffmpeg at a time (`_play_slot`); a playback copy (the "Converting…"
  the user waits for) has priority: a running scrub encode is terminated, returns None and is re-run when the slot
  is free (its job stays "working"; under a steady stream of playback jobs it waits). The overlay shows only while
  `light.scrubbing`, only for a seek of the current drag (`scGen`), is hidden on frame steps / marker jumps and
  after the player presents its own frame (rVFC, ≤ 250 ms); copy and original can differ by a fraction of a frame at
  the hand-over. Left: a changed file's old-stamp scrub copy lingers until the next rescan / scrub; the webm branch
  (`libvpx-vp9 -g 4`) is untested; Playwright's Chromium has no H.264, test with Edge (`channel: "msedge"`).
  Review (fresh agent): trigger too eager and uncapped (fixed: scrub-only slow seeks, two needed, min duration,
  cap), stale overlay frame for up to 250 ms (fixed), silent copy errors (warn), missing tests (added); second
  pass found playback copies queued behind a minutes-long scrub encode (fixed: priority + abort, two tests); third
  pass confirmed everything, two nits (unguarded `terminate()` — wrapped; a copy finished right before the
  terminate is redone, rare).

## 0.59.1 — 2026-11-16 — 3D: alpha cut-outs for USD / USDZ in every shading mode
- **What:** a UsdPreviewSurface whose `opacity` reads a texture now renders its cut-outs (leaf cards, fences):
  `opacityThreshold` 0 / unset → BLEND, > 0 → MASK with that cutoff, on both paths (server GLB conversion and USD
  read in the browser). Cut-outs survive Solid, Vertex, Normal, X-ray, the inspector highlight and the grid thumbnail.
- **Where:** `app/usdz_convert.py` (`_Materials._fill` opacity, `_alpha_into_base`, `_bake_alpha`, `_as_8bit`);
  `app/library.py` (`USDZ_CONVERTER_VERSION` 4 → cached conversions redone); `vendor/jsm/loaders/usd/USDComposer.js`
  (`_applyPreviewSurface`, Sight patch: a separate opacity texture → alphaMap clone tagged `userData.usdAlphaChannel`);
  `app/static/model3d-core.js` (`usdMaterialsAsSight` from `parseUsd`, exported `keepAlpha`, `applyBaseMaterial`
  one temp material per group, `xrayMaterial`, `meshHighlight`); `index.html` (Solid retint for material arrays);
  `tests/test_usdz_convert.py` (`TestOpacity`); ARCHITECTURE, MANUAL.
- **Notes:** the user's `Stylized_Palm_tree_set.usdz` (Sketchfab export) still draws opaque **on purpose**: its
  materials wire no `opacity` at all and every texture is a JPEG without alpha — the leaf image has its cut-out area
  flattened to white. usdview / Quick Look show the same white cards; making it work would need a white chroma-key
  guess (not added; re-export the asset with its alpha instead). glTF has no alpha map, so a separate opacity texture
  is baked into the base colour's A channel (16-bit masks scaled, not clipped); three samples an alphaMap's G channel,
  so the browser path redraws the channel into G. All USD materials are double-sided on both paths (the gprim's
  `doubleSided` is not followed; honouring it would hide open shells). Temp materials read the map's alpha through
  `onBeforeCompile`; `material.clone()` drops that hook, fine because originals never carry it. X-ray scales
  `alphaTest` by 0.3 so MASK cards do not vanish. Limits: opacity on its own UV set / transform, opacity scale /
  bias and float (`F`) masks are not handled; after a bake the unused original base image stays in the GLB.
  Review (fresh agent, run by the block's author): 16-bit masks became binary (fixed), a multi-material mesh was cut
  by one part's texture (fixed); the same reviewer confirmed both, nothing new.

## 0.59.0 — 2026-11-16 — Settings: Scan Filtering with a built-in default filter list
- **What:** Settings "Scanning" is now "Scan Filtering". A list shipped with the app, `app/initial_filtering.ini`
  (OS junk, temp / partial files, databases, shortcuts, VCS / build folders, `.sight/`), applies under the user's
  Ignore list — the scanner skips the union of both. A shield button next to Apply opens "Default scan filters"
  to read / edit that list (Save / Restore shipped). Edits are stored as `<SIGHT_HOME>/initial_filtering.ini`,
  which replaces the shipped file; saving text equal to the shipped list removes the copy again.
- **Where:** `app/initial_filtering.ini`; `app/library.py` (`read_default_filter`, `IgnoreRules(user, default)` —
  the one merge point, `Library.set_default_filter`, `_apply_ignore` shared with `set_ignore`); `app/server.py`
  (`GET / PUT / DELETE /api/scan/defaults`); `index.html` (`#dfOverlay`, `dfOpen` / `dfSend`, an Esc branch in the
  main keydown); `build_exe.bat` / `build_app_macos.sh` (`--add-data` for the ini); tests `tests/test_scan_ignore.py`,
  `tests/scan_filter_modal.cjs`; MANUAL (Scan Filtering), ARCHITECTURE (merge order, endpoints).
- **Notes:** the DB meta `scan_ignore` still holds only the user's list; `/api/state` is unchanged. `.log` / `.ini` /
  `.cfg` are shown as text, so they are never in the ini — a test asserts no extension Sight shows is filtered.
  File-style globs match folder names too (`Shots.bak/` would vanish), so the shipped list only has patterns no
  media folder would carry (`*.bak`, `*.temp`, `*.lock`, `*~` deliberately left out; `Library/` and `*.meta` are
  commented examples only). `SKIP_DIRS` stays the fallback when the ini is unreadable (one warning line, bare
  `logging` → stderr / `sight.log` in a frozen build). The user copy is written atomically (`.tmp` + `os.replace`);
  an unwritable home returns a 500 with `detail`, shown in the modal. The scanner only skips, never deletes.
  Not verified: a frozen build actually carrying the ini (no build was run). Review (fresh agent) found: the
  file-style globs pruning folders (fixed: six patterns dropped + a folder test); saving the unchanged shipped
  text created a permanent custom copy that would miss future shipped updates (fixed); non-atomic write and a
  bare "Failed" (fixed); silent fallback (logged). The same reviewer confirmed every fix, nothing new.

## 0.58.0 — 2026-11-16 — Sidebar: info-panel button, chevrons in the folder tree, counter in the Sources header, type icons, collapsible File block
- **What:** the top bar's item counter is replaced by an *Info panel* button (right end) that shows / hides the
  inspector and its drag handle (pressed while open; on narrow screens it toggles the drawer). The folder tree's
  "+" / "−" became a chevron (right = closed, down = open; Shift+click still expands / collapses all). The total
  "N files" (and the "scanning · N" shimmer) moved from the bottom of the sidebar into the Sources header, right
  of the title. *Sidebar icons* now also covers the Types rows (new "file" and "font" icons in the catalogue).
  The inspector's file block (thumbnail, path, facts) collapses under a "File" header; the state is remembered.
- **Where:** `index.html` — `applyDetails` / `syncInfoBtn` / `narrowMQ`, `toggleDetails` (narrow-aware),
  `#infoBtn`; `statusHtml` / `renderStatus` / `renderSources` (`#srcCount`); `renderFolderChildren` /
  `renderSources` (`.tiny.tree-chev`, `aria-expanded`); `row(…, iconId)`, `KIND_ICON`, `renderTypes`, `ICONS`
  "file" / "font"; `renderInsp` + a delegated click on `#insp` (`navCollapse.inspFile`); the coarse-pointer CSS
  block; MANUAL (Info panel, File block), ARCHITECTURE ("Info panel / sidebar" bullet).
- **Notes:** `state.details` drives the wide panel; the narrow drawer's `.open` is not persisted (a
  MutationObserver on `#insp` keeps the button in sync with the Esc / select paths). Fixed on the way: on narrow
  screens the boot code set an inline `display:none` when `details` was false, so the drawer could never open.
  `#srcCount` is rebuilt by every `renderNav`, so it is painted through `statusHtml()` — keep it that way. The
  multi-selection count lives in the inspector's header ("N selected"), the top bar no longer shows it (by the
  user's choice). Touch: the chevron is always visible there (36 px hit area), and the row's hidden buttons use
  `visibility: hidden` with their space reserved, because a visible chevron made a tap set `:hover`, which revealed
  the "×" and shifted it under the finger (a test tap removed the whole source). Rows are ~22 px per hidden button
  wider on touch. Not done: the collapse is not applied to the multi-selection inspector; subfolder rows get no icon.
  Review (fresh agent): no crash-level bugs; found the touch chevron hidden until hover with a 22 px hit area
  (fixed, which surfaced the "×" bug above), static aria labels (fixed), a sentence spliced into ARCHITECTURE
  (fixed). The same reviewer confirmed every fix, nothing new.

## 0.57.0 — 2026-11-16 — Settings: section title colour / size, compact theme row, gear icon
- **What:** two theme settings for the sidebar section headers — *Section titles* (colour, in Colors) and
  *Section title size* (Typography, 9–20 px); they style the `.sec` band, the Settings header included. The theme
  block is one row: the Theme select, a save icon that appears only while the values match no preset (its popover:
  *Save to <name>* when the last picked base is one of your own themes, and *Save as new…*), a × for a user theme,
  a reset icon, and (dev mode) the *app defaults* icon. The Settings header shows a gear when Sidebar icons is on.
- **Where:** `index.html` — `.sec` CSS (`--sec-fg`, `--sec-size`), `.theme-row`, `DEFAULT_THEME` (`secColor`
  "#e9eaec", `secSize` 12), `BUILTIN_THEMES` (explicit sec keys), `secFallback`, `loadTheme`, `applyUi`,
  `saveTheme` (re-renders the row, guarded by a signature), `renderThemeList` (rewritten), `openThemePop` /
  `closeThemePop` / `setThemeBase` / `themeMatches` / `presetVars`, `resetAllSettings`, `renderOptions`;
  `app/static/defaults.json`; MANUAL, ARCHITECTURE.
- **Notes:** a saved theme or user preset without the sec keys gets them from its own `fg` / `textSize − 1`
  (`secFallback`, applied only when a saved theme exists — with none, defaults.json wins, so reload and Reset agree).
  A 0.54 theme with a custom text size therefore shows *Custom* after the upgrade (its derived size differs from
  the preset's explicit 12). The last picked base is `state.themeBase = {kind, name}` in `sight.layout`
  (persisted when preset matching changes it). The popover is a body-level `.top-pop`: besides `registerAutoClose`
  (pointer-move driven, useless on touch) it closes on an outside pointerdown, Escape (in the main keydown, after
  the select popup), when Settings collapses and when the sidebar scrolls. `.light-info .sec` keeps its own look.
  Review (fresh agent) found: the fallback overwrote defaults.json values on a fresh install (fixed); the gear not
  refreshing when Sidebar icons is toggled (fixed); the popover never closing on touch (fixed); `themeBase` not
  persisted after matching (fixed). The same reviewer confirmed every fix, nothing new.

## 0.56.0 — 2026-11-16 — Review mode: shortcut help under "?", no exit cross, 3D bars centred beside the notes panel
- **What:** the annotation hotkey hints are no longer inline text: a "?" button at the end of the annotation
  toolbar (or `Shift+?`) opens a modal list of every annotate-mode shortcut, grouped (general, editing, drawing
  tools, notes and panels, moving the selection, video, 3D). While it is open nothing underneath reacts — pointer,
  wheel and keys are swallowed; Esc, ?, the backdrop, ✕ (also Enter / Space on it) close it. The × that only left
  the mode is gone from the drawing tools bar (A, Esc or the lightbox annotate button leave it; the notes panel's
  × stays). The lightbox's annotate hint reads "Annotating · ? = shortcuts · Esc leaves". On a 3D model the shading
  and animation bars centre on the area left of the notes panel instead of the full width.
- **Where:** `app/static/annotate.js` (`keyTable()` rows `[combo, handler, label, group]`, `helpGroups`,
  `keyName`, `openHelp` / `closeHelp` / `toggleHelp`, `helpOpen()` in the API, the guard at the top of `onKey`,
  `.an-help*` CSS, `.light.an-panel-on { --an-right: 320px }`); `index.html` (early keydown guard
  `if (light && annot.helpOpen())`, `ANNOT_HINT`, `#v3dShade, #v3dAnim { left: calc(50% + (var(--uv-left) −
  var(--an-right)) / 2) }`); MANUAL, ARCHITECTURE.
- **Notes:** the help is rendered from the same table that fires the keys, so it cannot drift — a new shortcut is
  a labelled row in `keyTable()`; rows without a label are not listed (the reserved D row is labelled only for
  3D). `keyTable()` runs per key / per open, so labels follow the current file's kind. `--an-right` is a CSS
  constant because the panel has a fixed 320 px width and no media rule; `.an-top` / `.an-toast` already shift by
  160 px. At 420 px wide the panel covers the lightbox annotate button — hide the panel first (C or its ×).
  Review (fresh agent): no bugs; three nits fixed (the D row listed for images, the Esc label missing the pin-focus
  step, Enter / Space on the help's ✕ swallowed). The same reviewer confirmed them, nothing new.

## 0.55.0 — 2026-11-16 — About dialog behind the brand mark; icon variants to choose from
- **What:** the "S" tile in the sidebar is now the Sight icon (`favicon.svg`, so favicon and mark are one file)
  and a button: click / tap / Enter opens *About Sight <version>* — version, source or frozen build, Python, OS,
  Starlette, three.js, `SIGHT_HOME`, library DB path and size, asset / source / thumbnail counts, ffmpeg path and
  version, usd-core, port, dev mode, uptime, log file — with a Copy button. `docs/tmp/icon-variants.html` shows
  seven icon proposals (eye, viewfinder S, horizon S, aperture, thumbnail grid, slanted S, focus dot) at 16–256 px;
  the user picked 7, *focus dot* (a ring with the focus point off-centre): `app/static/favicon.svg` is now that
  mark (64-unit box, 6-unit strokes = 1.5 px at 16 px).
- **Where:** `app/server.py` (`GET /api/app-info`, `static_info()` cached once, `ffmpeg_info()` cached only once a
  version line was read, `STARTED_AT`); `Sight.py` (`app.state.port`); `index.html` (`#aboutBtn`, `#aboutOverlay`
  on the `.fb-modal` pattern, `aboutOpen` / `aboutClose` / `aboutCopy`, `.mark` / `.about-*` CSS, Esc branch after
  `fbOverlay`, `aboutOverlay` in the canvas `keysEnabled`); MANUAL, ARCHITECTURE.
- **Notes:** three.js revision is parsed from `vendor/three.core.js` (`three.module.js` only re-exports it).
  Counts, DB size and uptime are live; the thumbnail count is the top-level files of `thumbs/` (cheap). The port
  row is dropped when `app.state.port` is unset (tests build the app without Sight.py). A late response is dropped
  by `aboutToken`; a non-OK answer shows one line in the footer. While About is open every other key is swallowed
  (it is modal; it cannot be opened over the lightbox, which covers the sidebar). Touch: 40 px hit area via
  `.mark::after` in the coarse-pointer block. Review (fresh agent, ran the endpoint) found: a failed ffmpeg probe
  cached for good (fixed), `request.url.port` wrong behind a proxy (fixed: listen port), interleaved opens
  duplicating rows (fixed: token), 24 px tap target (fixed). The same reviewer confirmed every fix, nothing new.

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
