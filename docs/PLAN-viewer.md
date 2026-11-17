# Plan — Sight as the system quick viewer (later)

Decided with the owner on 2026-11-11. Not started; comes after the mobile plan's early stages
(`docs/PLAN-mobile.md`) unless the owner says otherwise.

## Goal
Sight lives in the tray / menu bar and opens **any file instantly** in a light player with the
review tools (notes, drawing, export for clients). The full Sight window opens only on a separate
command. On macOS it plays the role of Quick Look, on Windows it replaces the QuickLook app.

## Decisions
- **Space on a selected file everywhere** (Windows Explorer and macOS Finder) opens the quick
  viewer. Done later, as its own piece of work.

## Notes for whoever takes it
- Instant open means the server is already running and a player window is kept warm and hidden;
  measure open time (target: picture on screen < 300 ms after the key press).
- Windows: a global keyboard hook that, on Space, reads the selection of the foreground Explorer
  window (Shell.Application windows / IShellWindows → `Document.SelectedItems`), the way the
  QuickLook app does; skip it while a rename edit box or the desktop search has focus.
- macOS: Space in Finder belongs to the system Quick Look. Options: a Quick Look preview extension
  (sandboxed, cannot run Sight's server — limited), or intercepting Space for Finder through an
  event tap (needs Accessibility permission). Decide after a prototype.
- Tray: start with the OS session (optional), menu: Open Sight, Quit; the player and the full
  window share the server and the library.
- File association / "Open with Sight" as a fallback that works without hooks.

---

# Plan — clips in sequence ("Sequence" mode)

Designed with the owner on 2026-11-17. Not started. Desktop Sight only (mouse / keyboard and touch
screen); not in the phone app for now, not in `.srev` / the HTML page (each clip is reviewed on its own).

## Goal
Pick several videos in the grid and watch them back to back on one timeline, like a cut, with each
clip's own notes and drawings switching in as the playhead crosses into it.

## Decisions
- **Start:** 2+ videos selected, Space with the cursor over one of the selected tiles → Sequence.
  Space over an unselected tile keeps today's behaviour (preview that tile). This **changes the
  documented contract** ("Space always previews the thumbnail under the cursor, whatever is
  selected", MANUAL.md *Preview*; code comment in index.html's Space handler) — update MANUAL and the
  comment; keep the `e.repeat` guard and `heavyKeyBlocked` on the new branch.
- **Touch:** today the selection context menu opens only on a right-button press and a 2+ selection
  needs Ctrl / Shift / marquee, so neither works on a touch screen. v1 needs (a) a visible
  *Play in sequence* button (top bar, shown while 2+ videos are selected; in touch selection mode
  also a bottom bar within thumb reach: "N selected · ▶▶ Play in sequence · ✕", ✕ leaves the
  mode; z-index above the narrow-screen inspector / sidebar drawer (fixed, z 20) or close the
  inspector when the mode starts, and pad the grid's bottom so the bar does not hide the last row)
  and (b) **touch
  multi-select by long-press** (owner's choice): holding a tile (~500 ms, finger nearly still)
  toggles it in / out of the selection, appending like Ctrl-click (so click order holds); the
  existing selected style (`.on`) is the feedback. The long-press also turns on **touch selection
  mode**; when the mode is off, that first long-press starts a fresh selection with just this tile
  (a tile selected by an earlier plain tap does not become clip 1; call `selectOnly(id)` first,
  then set the flag, since `selectOnly` drops it). The mode is an explicit flag
  (e.g. `state.touchSelect`), not "selection non-empty" (a plain tap's
  `selectOnly(id)` keeps the selection almost never empty). While it is on, a plain tap with
  `pointerType === "touch"` toggles the tile (mouse clicks unchanged) and the grid's `dblclick` is
  ignored (else two quick taps toggle twice and open the preview). The flag drops whenever the
  selection is cleared (inside `selectOnly`, both the null and single-id paths — covers the
  empty-space tap and Esc) and whenever the selection becomes empty (last tile toggled off, items
  leaving the list). Implementation traps (index.html grid pointer code):
  - set `skipClick = true` when the timer fires (pointerdown resets it), or the release `click`
    runs `clickSelect` → `selectOnly` and wipes the toggle (and opens the inspector < 1024 px);
  - cards become `draggable` on pointerdown and a held touch starts an HTML5 drag whose
    `dragstart` calls `selectOnly` — no `draggable` for `pointerType === "touch"`;
  - cancel the timer on movement and `pointercancel` (the browser scrolls the grid); tile resize
    and marquee are not touch features, nothing else to keep;
  - the tag chips' long-press handler is the pattern to reuse. Also in the palette and the
  selection's context menu.
- **Order = click order** of the selection. Fact: Ctrl-click appends to `state.selectedIds`
  (`toggleSelect`; un-toggle + re-add moves an item to the end), Ctrl+Shift adds a range in grid
  order; a plain Shift-range or a replace-marquee replaces the selection with grid order.
  Non-video items are skipped.
- **Lives in the lightbox** (player, scrub, notes panel, drawing are there), not in Compare (no
  annotations there; its timeline is stacked per-layer lanes, not a segmented bar). Base the
  timeline on the lightbox's own timeline + annotate.js markers.
- **Annotations stay per clip.** Nothing is merged or rewritten: rows keep their asset and local
  `t:` key (FORMAT.md). The notes panel and drawing overlay follow the clip under the playhead; a
  note made in Sequence goes to that clip at its local time. annotate.js is one instance mounted per
  asset, so crossing a boundary remounts it for the next clip — do it without stalling playback
  (mount ahead of the cut, or swap after the video swap). Session-only: no saved sequence.
- **Timeline:** one segment per clip, same base hue with alternating lightness (≈ ±8 % L) and a
  thin divider; colours from theme tokens (light and dark). Clip name on hover / while the playhead
  is in it (touch). Note markers of every clip at `start_i + t`, tinted like their segment.

## Model
- `seq = [{asset, start, dur, fps}]`, `start` = running sum of durations; global T → clip i with
  local `t = T − start_i`.
- **Seamless cuts are a must** (owner, 2026-11-17). Two `<video>` elements, double-buffered: the
  next clip is loaded and seeked to 0 ahead of the boundary and swapped in, so the cut has no
  black or frozen frame. A single player with only a byte cache is not enough: changing `src`
  re-creates the decoder (~0.1–0.3 s gap even with the bytes in RAM).
  annotate.js reads the active element via its `video()` getter: the swap must update what it
  returns, or frame steps, markers and screenshots hit the hidden buffer.
- **RAM cache:** `SlidingVideoCache` (library.py) is a window over one file — `focus()` on another
  path drops every block, `stream()` serves RAM only for `self.path`. Prefetching the next clip's
  head needs the class extended (a second slot / head-prefetch list with its own share of the
  budget); never `focus` the next clip, it wipes the playing one. Decide what the green cache strip
  shows (`snapshot(path)` reports one window) — the current clip's window is enough.
- **Conversion:** the server has no playability check — `POST /api/video/transcode`
  (`start_playback_copy`) starts a full transcode for any library video without a copy, so never
  POST blindly for every clip. On opening the sequence, probe each clip on the client the way the
  player already decides: a hidden muted `<video preload="metadata">` per clip (one or two at a
  time); only clips that give no picture are POSTed (`convertForPlayback`). A transcode takes about
  the clip's length, so clips still converting at their cut are waited for or skipped (note in the
  title bar). Once a copy exists `/api/file/<id>` serves it (`?copy=` is only a cache-buster).

## Keys (all through `hotkey()`; each also has a transport button for touch)
- `,` / `.` step a frame by the current clip's fps and cross boundaries.
- `Shift+,` / `Shift+.` keep their lightbox meaning — previous / next note marker — now across all clips.
- `←` / `→` (today: previous / next asset, raw `e.key` checks — convert to `hotkey()`) jump to the
  previous / next clip start, so they never leave the sequence. `↑` / `↓` do nothing in Sequence.
- Loop the whole sequence: the lightbox has no loop toggle today — add a loop button plus a free key
  (not `L`: the Line tool in annotation mode takes precedence).
- **Annotation mode takes keys first** (index.html's key handler gives annotate.js precedence):
  annotate.js binds `,` / `.` / `Shift+,` / `Shift+.` itself — its `stepFrame` clamps to the mounted
  `<video>`'s `0..duration` and `jumpMarker` sees only the mounted clip's markers — so crossing
  boundaries and all-clip markers need a Sequence hook that annotate.js calls. `←` / `→` while
  annotating stay nudge (no clip jump there; use the transport buttons).
- `Home` → T = 0. Each clip plays its own sound at the shared volume. Esc closes.
- Title: "Clip 2/5 · name.mp4 · f128".

## Not in v1
In / out trims, reordering inside the mode, exporting the cut, transitions, the phone app.
