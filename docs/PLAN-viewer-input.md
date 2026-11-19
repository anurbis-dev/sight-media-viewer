# Plan: one shared pointer / gesture module for every viewer

Owner's request (after 0.93.0, written in 0.93.1): the picture should handle the mouse, pen and touch the same way in every viewing mode, and
the code for that should be written once and reused everywhere. Today every mode has its own copy. This file is the
plan for a fresh session. **Stage 1 is done (0.94.2)**: `app/static/viewer-input.js` exists and compare runs on it;
the API as built differs from the sketch below in a few places (see "As built").

## Where the input lives today (written before stage 1; Compare and the lightbox 2D rows are history now)

| Mode | Code | What it handles | Notes |
|---|---|---|---|
| Lightbox, image / PSD / video | `index.html` `attachViewer()` (~5422–5866), closure state `vs` | click on a video = play / pause, held back 250 ms (`clickTimer`), dblclick = fit ↔ 100 %; left drag on a video = scrub (4 px threshold, the viewer's width = the clip's length, Shift ×0.1 rebased); Alt+drag = turn a picture (Ctrl+Alt on a video), Shift snaps to 15°; middle = pan; right = zoom drag (`state.theme.zoomAxis / zoomSpeed / zoomInvert`, ×0.012); wheel ×0.0016; `justScrubbed` swallows the click after a drag | **No touch pinch / pan** on 2D pictures; a finger on a video is button 0, so it already scrubs / taps play. A left drag on an image does nothing. Alt+left on a video scrubs (the annotator's `altCam` relies on it). Pan is in the unturned frame (`unturnVec`, ~5800): a shared `pan(dx, dy)` must be unturned by the lightbox. The scrub width is `wrap.clientWidth`. `attachViewer` returns only `{fit, zoom}` and has no teardown: its listeners die with the DOM. |
| Sequence | `index.html` `seqScrubBegin()` (~6760) | the picture scrub is handed over (`sd.handed`) once it starts: width = `.light-frame`, scale = the current clip's duration, position on the whole sequence; window listeners (the stage is replaced at each cut) | must keep working across cuts; returns no cancel handle (a synthetic window `pointercancel` for its pointer ends it, as compare does) |
| Version compare | `compare.js` `onDown / onMove / onUp`, `startScrub`, `startPinch`, `zoomAt`, `splitNear` (0.93.0) | the lightbox's gestures plus a swipe split (grabbed within 10 px, finger 24 px), the layer under the press is selected, two fingers pinch / pan, images-only: left drag pans, Shift slows scrub ×0.1 / zoom and pan ×0.2 / split ×0.1 | written fresh in 0.93.0: **this is the copy to fold back** |
| 3D (lightbox) | `index.html` `bind3dZoom()` (~4974, called for meshes and splats) + three.js OrbitControls; the Ctrl / Shift right-drag handlers (mesh path only, ~4633–4675) bound before it | wheel ×0.0016 and right-drag ×0.012 dolly, but the right-drag is **incremental** per move (not anchored at the press like 2D); its own pinch: `dolly(log(gap ratio) × zoomSpeed)`, no pan | orbit / pan stay OrbitControls'; a shared factor / pinch helper must cover incremental vs anchored, or the plan accepts the change |
| Board (Canvas) | `canvas.js` `createCanvasView()` (~960–1100) | middle / Alt+left = pan (Alt+left on an item = crop-pan, ~314), right drag = zoom after a 4 px threshold (a right-click without a drag over an item opens its menu), **plain wheel pans, Ctrl/Cmd+wheel zooms**, its own two-finger pinch (zoom = z0 × gap ratio + middle-point pan, no speed setting) as a **capture listener before the annotator** that calls `annot.abortGesture()` (a second finger cancels a stroke), item drags, marquee, crop | the camera is world-space (`vx, vy, zoom`), not the lightbox's `vs` |
| Annotator overlay (all of the above) | `annotate.js` `attachInput()` — a capture-phase `pointerdown` on the viewer's wrap (lightbox: `.view`, the same element as the viewer's handlers; compare: `.cmp-box` / `.cmp-cell`, while compare listens on the stage, an ancestor) | while drawing it takes left presses and stops them (`stopImmediatePropagation`); middle / right go through; Alt with a drawing tool goes to the viewer (`altCam`); only the compare annotator has `host.passThrough` (`cmp.wantsPress`); `suppressClick` eats the click after a stroke | the module listens in the bubble phase on the annotated element or an ancestor, never a capture listener above it — except a second-finger hook like the board's, so a pinch works while annotating and aborts the stroke |
| Text document viewer | `index.html` `mountDocStage` (~5147–5210) | middle-drag scroll, right-drag zoom ×0.012, sets `light.setZoom`; left is text selection, the wheel scrolls; no touch | include in stage 2 for pinch, or exclude explicitly |
| HTML review page / phone app | `app/static/review-draw.js` (`SightReviewDraw.pinch`), `mobile/js/*` | its own pinch / pan / turn (a quarter turn snaps) | a separate bundle with no build step; **out of scope for stage 1**, but keep the same gesture meanings |

## The gesture contract (what every 2D viewer should do)

| Input | Meaning |
|---|---|
| click (no move ≥ 4 px) | play / pause, held back 250 ms so the second click of a double-click cancels it |
| double-click | the viewer's own action (lightbox: fit ↔ 100 %, compare: fit) |
| left drag | video: scrub (the viewer's width = the timeline), pictures only: pan |
| right drag | zoom anchored at the press point (theme axis / speed / invert) |
| middle drag | pan. Alt+left differs per mode and stays a `claim`: lightbox picture = turn, lightbox video = scrub, compare = pan (annotating: the nearest split), board = pan / crop-pan |
| wheel | zoom about the cursor (board: plain wheel pans, Ctrl+wheel zooms — keep). With Shift held most browsers send `deltaX`: use `deltaY \|\| deltaX` then |
| Shift held | **every drag slower** (scrub ×0.1, zoom / pan ×0.2), and pressing or releasing it mid-drag rebases without a jump |
| touch: tap / one finger / two fingers | play-pause / scrub (pan for pictures) / pinch-zoom + pan by the fingers' middle |
| mode extras | claimed before the default: compare split, lightbox Alt turn, board item / marquee, annotator stroke |

## The module

New file `app/static/viewer-input.js`, no dependencies except `keys.js` if needed. It does not know about
videos, splits or cameras; the viewer passes callbacks.

```js
export function attachViewerInput(el, {
  claim,        // (e) => null | { move(ev), end(ev, cancelled) } — a mode's own drag (split, Alt turn, item), asked first
  click,        // () => void — after the 250 ms hold (no second click came)
  dblclick,     // () => void
  scrub,        // { begin(e) → bool, to(fracDelta, ev), end(cancelled) } | null — null: a left drag pans
  pan,          // (dx, dy) in CSS px (already scaled by the fine factor)
  zoom,         // (factor, mx, my) — mx / my: px from el's top-left, the anchor
  zoomSettings, // () => ({ zoomAxis, zoomSpeed, zoomInvert })
  canStart,     // (e) => bool — e.g. not while the annotator is drawing
  abortOthers,  // () => void — a second finger came: cancel what the first started elsewhere
                //   (lightbox: annot.abortGesture, compare: cmpAnnot.abortGesture)
}) → { destroy(), cancel() }

The second-finger hook is the module's only capture-phase listener and acts **only on a second touch** (every other
press must reach the annotator first). In the lightbox the module must be attached before `annot.bind2d`
(~5858), as the board's pinch is (canvas.js ~1065); in compare a stage-level capture listener already runs before
the box-level annotator.
```

What it owns, so no viewer re-implements it:
- the press / click / drag decision (4 px), the 250 ms click hold and its cancel on dblclick, on a drag start, on destroy;
- the Shift rebasing for every drag kind;
- right-drag zoom maths (`exp(±raw × 0.012 × speed × fine)`, axis, invert) and wheel maths (`exp(±dy × 0.0016 × speed × fine)`, sign from `zoomInvert`);
  export them too (`zoomFactorDrag`, `zoomFactorWheel`) for `bind3dZoom` and `canvas.js`, which keep their own
  cameras;
- the touch map and the pinch (two fingers: factor + middle-point pan; a second finger cancels a running scrub /
  pan through its `end(…, true)`). Clear the map on `destroy()` and before any guard — 0.93.0's review found a finger
  left in it after a close turning every later tap into a pinch;
- pointer capture, wrapped in `try` (synthetic / lost ids throw), and taking capture back up to 3 times on
  `lostpointercapture` while the button is down (a Windows hardware overlay drops it: see 0.92.1);
- window `pointerup` / `pointercancel` fallbacks removed on end and on `destroy()`; no capture retake on a disconnected element
  (a sequence cut removes the wrap mid-drag), and destroying a viewer mid-drag must not cancel a drag that was handed on;
- a second-finger hook (capture phase) that cancels the first finger's gesture — the annotator's stroke too (`abortGesture`)
  — and starts the pinch;
- a mouse move with no buttons held = a release that never came.

## As built (stage 1)

- `claim(e)` may return `"pan"` / `"zoom"` (the built-in drag for that press, compare's Alt+left) besides a handler;
  it is asked on every press the module may take, so it also notes the press (compare selects the layer).
- `pan(dx, dy, down)` and `zoom(factor, clientX, clientY, down)` are **incremental** (since the last call) and in
  client coordinates; `down` is the press event, for a viewer that measures the pressed box. An anchored right-drag
  is the same as incremental zooms about the press point, except at the zoom clamp (it follows back at once).
- `scrub.to(frac, ev)`: `frac` is cumulative since the drag start (Shift-fine applied per move), so a viewer that
  snaps its time each move (compare) does not lose sub-frame motion.
- `onDrag(kind)` for cursors; `busy()` for hover code; `dropClick()` for Space / ▶ / a pause while a click is held.
- Touch fingers are tracked in capture-phase listeners on `el` and on window (up / cancel); a second finger stops
  propagation (the annotator below never sees it) and calls `abortOthers`.
- A mouse move with no buttons ends the drag, but not after a `lostpointercapture` in that drag (0.92.1's overlay).

## Stages (one review per stage, per CLAUDE.md)

1. **(done, 0.94.2) Module + compare.** Write `viewer-input.js`; move compare.js onto it (as built: `startScrub` was split
   into `scrubBegin` / `scrubTo` / `scrubEnd`; the module's `scrub` calls those, only the timeline's own absolute drag uses `startScrub`). Splits go through `claim`.
   Playwright: the 0.93.0 checks (click, dblclick does not toggle, scrub, split only near, right-drag zoom, Shift,
   CDP touch tap / scrub / pinch, close with a finger down, layout rebuild mid-drag).
2. **(done, 0.95.0) Lightbox 2D.** The doc viewer is left out (its left button selects text; it keeps its own
   middle / right drags). Move `attachViewer`'s pointer code onto the module: Alt turn and Ctrl+Alt video turn via `claim`,
   the sequence hand-off inside `scrub.begin` / `to` (keep `seqScrubBegin`'s window listeners or fold them in),
   `justScrubbed` goes away (the module does not report a click after a drag), `vctl.begin / end`, scrub audio
   (`scrubHear`). This also gives the lightbox **touch pinch / pan** on pictures. `attachViewer` needs a teardown
   (called from `fillStage` — a sequence cut goes through it too — and on close) for the module's `destroy()`. `opts.embedded` (the 3D UV pane,
   ~7513) must keep its limits: no saved turn, no `light.video` / `setZoom`, no scrub copy, no sequence, no
   annotator, no scrub audio. Check: images, PSD, video, sequence across a cut, annotating (Alt with a drawing tool
   to the viewer — `altCam`; middle / right pass through), digits 1–9 still set scale, the doc viewer if included.
3. **Board and 3D zoom.** `canvas.js` and `bind3dZoom` use the exported zoom factors and the module's pinch helper
   (not the whole module: their left button means items / orbit). Keep the board's right-click menu (a right press
   without a drag over an item, 4 px), its wheel = pan / Ctrl+wheel = zoom, and the 3D Ctrl / Shift right-drags
   (mesh path). Decide anchored vs incremental zoom for 3D and say it in RECENT if it changes.
4. **Shift-fine everywhere.** Add the Shift slow-down to the drags that do not have it: the board pan / zoom, the
   lightbox pan / zoom, 3D dolly. Write the rule in ARCHITECTURE and MANUAL as one sentence that holds for all modes.
5. (later, separate) **HTML page / phone parity**: the same meanings in `review-draw.js` / `mobile/`; they cannot import
   the module (no build step, a self-contained page), so either inline a copy kept by a parity test or leave them.

## Gotchas to keep

- Never test `e.key` / `e.code` alone; shortcuts go through `hotkey()` (CLAUDE.md).
- The annotator's capture `pointerdown` runs first; the module must not call `preventDefault` on presses it does not
  take, and must ignore a press the annotator stopped.
- Class names on viewer roots: no bare `row`, `grid`, `col` (global styles in index.html; 0.93.0's black Row).
- Rebuilding a viewer's DOM mid-drag (compare layout keys, H / D / R) detaches the box a drag measures: re-query or
  end the drag (0.93.0 review).
- Video `clip-path: inset(0)` in compare stays (Windows overlays, 0.92.1).
- A click is decided on `pointerup`, not the `click` event: the annotator's `suppressClick` then does not matter.
- Every gesture must have a touch path (CLAUDE.md: desktop and phone, always).
