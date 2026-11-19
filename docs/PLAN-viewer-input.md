# Plan: one shared pointer / gesture module for every viewer

Owner's request (0.93.0): the picture should handle the mouse, pen and touch the same way in every viewing mode, and
the code for that should be written once and reused everywhere. Today every mode has its own copy. This file is the
plan for a fresh session. Nothing in it is implemented yet.

## Where the input lives today

| Mode | Code | What it handles | Notes |
|---|---|---|---|
| Lightbox, image / PSD / video | `index.html` `attachViewer()` (~5422–5866), closure state `vs` | click on a video = play / pause, held back 250 ms (`clickTimer`), dblclick = fit ↔ 100 %; left drag on a video = scrub (4 px threshold, the window's width = the clip's length, Shift ×0.1 rebased); Alt+drag = turn a picture (Ctrl+Alt on a video), Shift snaps to 15°; middle = pan; right = zoom drag (`state.theme.zoomAxis / zoomSpeed / zoomInvert`, ×0.012); wheel ×0.0016; `justScrubbed` swallows the click after a drag | **No touch pinch / pan at all** on 2D pictures. A drag on an image with the left button does nothing. |
| Sequence | `index.html` `seqScrubBegin()` (~6760) | the picture scrub is handed over (`sd.handed`) once it starts, measured on the whole sequence, window listeners (the stage is replaced at each cut) | must keep working across cuts |
| Version compare | `compare.js` `onDown / onMove / onUp`, `startScrub`, `startPinch`, `zoomAt`, `splitNear` (0.93.0) | the lightbox's gestures plus a swipe split (grabbed within 10 px, finger 24 px), the layer under the press is selected, two fingers pinch / pan, images-only: left drag pans, Shift slows scrub ×0.1 / zoom and pan ×0.2 / split ×0.1 | written fresh in 0.93.0: **this is the copy to fold back** |
| 3D (lightbox) | `index.html` `bind3dZoom()` (~4966) + three.js OrbitControls; the Ctrl / Shift right-drag handlers bound before it | wheel and right-drag dolly with the same factor as 2D, its own touch pinch (`touches` map) | orbit / pan stay OrbitControls'; only the zoom factor and the pinch are shared with 2D |
| Board (Canvas) | `canvas.js` `createCanvasView()` (~996–1100) | middle / Alt+left = pan, right drag = zoom (a right-click without a drag opens the item menu), wheel, its own two-finger pinch (`fingers`, `pinch`), item drags, marquee, crop | the camera is world-space (`vx, vy, zoom`), not the lightbox's `vs` |
| Annotator overlay (all of the above) | `annotate.js` `attachInput()` — a capture-phase `pointerdown` on the viewer's wrap | while drawing it takes the press unless `host.passThrough(e)` (compare: `cmp.wantsPress`) or Alt over a tool; `suppressClick` eats the click after a stroke | the shared module must sit **under** this: the annotator decides first |
| HTML review page / phone app | `app/static/review-draw.js` (`SightReviewDraw.pinch`), `mobile/js/*` | its own pinch / pan / turn (a quarter turn snaps) | a separate bundle with no build step; **out of scope for stage 1**, but keep the same gesture meanings |

## The gesture contract (what every 2D viewer should do)

| Input | Meaning |
|---|---|
| click (no move ≥ 4 px) | play / pause, held back 250 ms so the second click of a double-click cancels it |
| double-click | the viewer's own action (lightbox: fit ↔ 100 %, compare: fit) |
| left drag | video: scrub (the viewer's width = the timeline), pictures only: pan |
| right drag | zoom anchored at the press point (theme axis / speed / invert) |
| middle drag, Alt+left | pan (lightbox: Alt+left is the turn, see below) |
| wheel | zoom about the cursor (Shift is sideways in most browsers: use `deltaY \|\| deltaX`) |
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
}) → { destroy(), cancel() }
```

What it owns, so no viewer re-implements it:
- the press / click / drag decision (4 px), the 250 ms click hold and its cancel on dblclick, on a drag start, on destroy;
- the Shift rebasing for every drag kind;
- right-drag zoom maths (`exp(raw × 0.012 × speed × fine)`, axis, invert) and wheel maths (`exp(−dy × 0.0016 × speed)`);
  export them too (`zoomFactorDrag`, `zoomFactorWheel`) for `bind3dZoom` and `canvas.js`, which keep their own
  cameras;
- the touch map and the pinch (two fingers: factor + middle-point pan; a second finger cancels a running scrub /
  pan through its `end(…, true)`). Clear the map on `destroy()` and before any guard — 0.93.0's review found a finger
  left in it after a close turning every later tap into a pinch;
- pointer capture, wrapped in `try` (synthetic / lost ids throw), and taking capture back up to 3 times on
  `lostpointercapture` while the button is down (a Windows hardware overlay drops it: see 0.92.1);
- window `pointerup` / `pointercancel` fallbacks removed on end and on `destroy()`;
- a mouse move with no buttons held = a release that never came.

## Stages (one review per stage, per CLAUDE.md)

1. **Module + compare.** Write `viewer-input.js`; move compare.js onto it (the stage scrub keeps its `startScrub`
   path: the module's `scrub.begin` calls it, the timeline keeps its own absolute drag). Splits go through `claim`.
   Playwright: the 0.93.0 checks (click, dblclick does not toggle, scrub, split only near, right-drag zoom, Shift,
   CDP touch tap / scrub / pinch, close with a finger down, layout rebuild mid-drag).
2. **Lightbox 2D.** Move `attachViewer`'s pointer code onto the module: Alt turn and Ctrl+Alt video turn via `claim`,
   the sequence hand-off inside `scrub.begin` / `to` (keep `seqScrubBegin`'s window listeners or fold them in),
   `justScrubbed` goes away (the module does not report a click after a drag), `vctl.begin / end`, scrub audio
   (`scrubHear`). This also gives the lightbox **touch pinch / pan**, which it does not have today. `opts.embedded`
   (the canvas preview) must keep its limits. Check: images, PSD, video, sequence across a cut, annotating (Alt to
   the viewer, `passThrough`), digits 1–9 still set scale.
3. **Board and 3D zoom.** `canvas.js` and `bind3dZoom` use the exported zoom factors and the module's pinch helper
   (not the whole module: their left button means items / orbit). Keep the board's right-click menu (a right press
   without a drag) and the 3D Ctrl / Shift right-drags.
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
