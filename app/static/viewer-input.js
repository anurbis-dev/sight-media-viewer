// One pointer / gesture layer for the viewers (docs/PLAN-viewer-input.md). It knows nothing about videos,
// splits or cameras: a viewer passes callbacks, the module decides what a press, a drag, a wheel turn and
// two fingers mean, the same way everywhere.
//
// The gesture contract: a click (no move ≥ 4 px) is reported after 250 ms unless a second click comes
// (a double-click is the viewer's own); a left drag scrubs (a video) or pans (pictures only); a right drag
// zooms anchored at the press; a middle drag pans; the wheel zooms about the cursor; Shift held slows every
// drag (scrub ×0.1, zoom / pan ×0.2) and may change mid-drag without a jump; two fingers pinch-zoom and pan
// by their middle. A mode's own drags (a split, an Alt turn) are claimed before any of that.

export const DRAG_PX = 4;          // a press that moves less is a click
export const CLICK_MS = 250;       // the click hold: a second click within it is a double-click
export const ZOOM_DRAG = 0.012;    // right-drag zoom per px (× the theme's zoomSpeed)
export const ZOOM_WHEEL = 0.0016;  // wheel zoom per delta unit (× zoomSpeed)
export const FINE = 0.2;           // Shift: zoom / pan
export const FINE_SCRUB = 0.1;     // Shift: scrub

// Right-drag zoom factor for a pointer move of (dx, dy) px; t = {zoomAxis, zoomSpeed, zoomInvert}.
export function zoomFactorDrag(dx, dy, t = {}, fine = false){
  const raw = t.zoomAxis === "x" ? dx : -dy;
  return Math.exp((t.zoomInvert ? -raw : raw) * ZOOM_DRAG * (t.zoomSpeed ?? 1) * (fine ? FINE : 1));
}
// The wheel's vertical delta (with Shift held most browsers turn the wheel sideways).
export const wheelDelta = (e) => e.deltaY || (e.shiftKey ? e.deltaX : 0);
// Wheel zoom factor for a delta (zoomAxis is not a wheel setting).
export function zoomFactorWheel(dy, t = {}, fine = false){
  return Math.exp((t.zoomInvert ? dy : -dy) * ZOOM_WHEEL * (t.zoomSpeed ?? 1) * (fine ? FINE : 1));
}

// el: the element the viewer's picture lives in (listened to in the bubble phase, so an annotator's capture
// listener on it or below sees presses first). Options, all optional:
//   canStart(e) → bool        a press / wheel / double-click here belongs to the viewer (e.g. on a picture)
//   claim(e) → null | "pan" | "zoom" | { move(ev), end(ev, cancelled) }
//                             asked first on every press it may take (it may also note the press: compare
//                             selects the layer under it); null: the default meaning of the button
//   click()                   a click, after the 250 ms hold
//   dblclick(e)               anywhere on el (canStart is not asked)
//   scrub: { begin(e) → bool, to(frac, ev), end(cancelled) }
//                             a left drag: begin false (nothing to scrub) → it pans. frac: the drag so far as
//                             a fraction of scrubWidth(), Shift-fine already applied, starting at 0
//   scrubWidth() → px         default el.clientWidth
//   pan(dx, dy, down)         CSS px since the last call (Shift-fine applied); down: the press event
//   zoom(factor, x, y, down)  relative to the current view, about client point (x, y)
//   zoomSettings() → {zoomAxis, zoomSpeed, zoomInvert}
//   wheel: false              leave the wheel to the viewer
//   onDrag(kind)              "pan" | "zoom" | "scrub" | "pinch" | null — for cursors
//   abortOthers()             a second finger came: cancel what the first one started elsewhere (an
//                             annotator stroke, another control's scrub)
// Returns { destroy(), cancel(), dropClick(), busy() }.
export function attachViewerInput(el, o = {}){
  const touches = new Map(); // every finger on el: pointerId → {x, y} (capture phase, so the annotator's count too)
  let g = null;              // the running gesture
  let clickT = 0, alive = true, winOn = false;
  const zs = () => o.zoomSettings?.() || {};
  const capture = (pid) => { try { el.setPointerCapture(pid); } catch {} }; // (synthetic / lost ids throw)
  const dropClick = () => { if (clickT){ clearTimeout(clickT); clickT = 0; } };
  const setKind = (k) => { try { o.onDrag?.(k); } catch {} };
  // A text field / editor inside el (an annotator's text box, a pin number) keeps its own press.
  const EDIT = "input, textarea, select, [contenteditable]:not([contenteditable=false])";
  const editable = (e) => !!e.target?.closest?.(EDIT);
  // A prevented pointerdown moves no focus: a field focused elsewhere would keep taking Space / digits.
  const blurOutside = () => { const a = document.activeElement; if (a && a !== document.body && !el.contains(a) && a.matches?.(EDIT)) a.blur(); };

  function addWin(){
    if (winOn) return;
    winOn = true;
    window.addEventListener("pointermove", onWinMove);
    window.addEventListener("pointerup", onWinUp);
    window.addEventListener("pointercancel", onWinUp);
  }
  function dropWin(){
    if (!winOn) return;
    winOn = false;
    window.removeEventListener("pointermove", onWinMove);
    window.removeEventListener("pointerup", onWinUp);
    window.removeEventListener("pointercancel", onWinUp);
  }

  // End the gesture: ev — the event that ended it (null: cancel() / destroy()).
  function finish(ev, cancelled){
    const d = g;
    if (!d) return;
    g = null;
    dropWin();
    try {
      if (d.kind === "claim") d.h.end?.(ev, cancelled);
      else if (d.kind === "scrub") o.scrub?.end?.(cancelled);
    } finally {
      if (d.kind !== "press" && d.kind !== "claim") setKind(null);
    }
    // A click: decided on pointerup (not the click event, so an annotator's click suppression is not involved).
    // A second one inside the hold is a double-click's: neither toggles (the dblclick event does its own thing).
    if (d.kind === "press" && !cancelled && ev?.type === "pointerup" && o.click && alive){
      if (clickT){ dropClick(); return; }
      clickT = setTimeout(() => { clickT = 0; if (alive) o.click(); }, CLICK_MS);
    }
  }

  function start(kind, e, extra){
    g = { kind, pid: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, down: e, took: 0, lost: false, ...extra };
    capture(e.pointerId);
    addWin();
    if (kind !== "press" && kind !== "claim") setKind(kind);
  }

  function onDown(e){
    if (!alive || g || editable(e)) return;
    if (e.pointerType === "touch" && touches.size > 1) return; // (the pinch has it)
    if (o.canStart && !o.canStart(e)) return;
    const c = o.claim?.(e);
    if (c && typeof c === "object"){ e.preventDefault(); dropClick(); start("claim", e, { h: c }); return; }
    let kind = c === "pan" || c === "zoom" ? c : null;
    if (!kind){
      if (e.button === 1) kind = "pan";
      else if (e.button === 2) kind = o.zoom ? "zoom" : null;
      else if (e.button === 0) kind = "press";
    }
    if (!kind || (kind === "pan" && !o.pan) || (kind === "zoom" && !o.zoom)) return;
    e.preventDefault();
    if (kind === "press" && !e.altKey) blurOutside(); // (a plain left press, as the browser did; middle / right / Alt keep a field's text open)
    start(kind, e);
  }

  function onWinMove(e){
    if (!g || g.kind === "pinch" || e.pointerId !== g.pid) return;
    // A mouse moving with no button held: its release never reached us (outside the window, a lost capture).
    // Not after a capture loss in this drag: a hardware overlay drops capture and reports no buttons while the
    // button is still down (0.92.1), and its pointerup still comes.
    if (e.pointerType === "mouse" && e.buttons === 0 && !g.lost){ finish(e, false); return; }
    if (g.kind === "claim"){ g.h.move?.(e); return; }
    const fine = e.shiftKey, f = fine ? FINE : 1;
    if (g.kind === "press"){
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < DRAG_PX) return;
      dropClick(); // (a click just before this drag must not toggle under it)
      if (o.scrub && o.scrub.begin(e)){
        g.kind = "scrub"; g.frac = 0; g.lx = e.clientX; g.ly = e.clientY; // (from here: no jump by the threshold)
        setKind("scrub");
        o.scrub.to(0, e);
        return;
      }
      if (!o.pan){ g.kind = "dead"; return; }
      g.kind = "pan"; // pictures only: a left drag pans (counted from the press)
      setKind("pan");
    }
    const dx = e.clientX - g.lx, dy = e.clientY - g.ly;
    g.lx = e.clientX; g.ly = e.clientY;
    if (g.kind === "scrub"){
      g.frac += dx / Math.max(1, o.scrubWidth?.() || el.clientWidth) * (fine ? FINE_SCRUB : 1);
      o.scrub.to(g.frac, e);
    } else if (g.kind === "pan") o.pan(dx * f, dy * f, g.down);
    else if (g.kind === "zoom") o.zoom(zoomFactorDrag(dx, dy, zs(), fine), g.x, g.y, g.down);
  }
  function onWinUp(e){
    if (!g || g.kind === "pinch" || e.pointerId !== g.pid) return;
    finish(e, e.type === "pointercancel");
  }
  // A hardware overlay (Windows) drops capture while the button is still down: not a release, take it back.
  function onLost(e){
    if (!g || g.kind === "pinch" || e.pointerId !== g.pid) return;
    g.lost = true;
    if (!el.isConnected || g.took >= 3) return;
    g.took++;
    capture(e.pointerId);
  }

  // ---- fingers (capture phase: a second finger must reach us before an annotator under it) ----
  const pair = () => { const [a, b] = touches.values(); return { gap: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; };
  // Window up / cancel only while a finger is down (a finger released after its capture was lost), so a viewer
  // that is never destroyed leaves nothing on window.
  let touchWin = false;
  function touchWinSync(){
    const want = touches.size > 0 && alive;
    if (want === touchWin) return;
    touchWin = want;
    const f = want ? "addEventListener" : "removeEventListener";
    window[f]("pointerup", onTouchUp, true);
    window[f]("pointercancel", onTouchUp, true);
  }
  function onTouchDown(e){
    if (!alive || e.pointerType !== "touch") return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    touchWinSync();
    if (touches.size < 2 || !(o.zoom || o.pan)) return;
    // A second finger: what the first one started stops (a scrub ends where it is, a stroke is dropped), the two pinch.
    e.stopImmediatePropagation();
    e.preventDefault();
    if (touches.size > 2) return;
    dropClick();
    if (g) finish(e, true);
    try { o.abortOthers?.(); } catch {}
    capture(e.pointerId);
    const p = pair();
    g = { kind: "pinch", down: e, gap: p.gap, mx: p.mx, my: p.my };
    setKind("pinch");
  }
  function onTouchMove(e){
    if (e.pointerType !== "touch" || !touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g?.kind !== "pinch" || touches.size < 2) return;
    const p = pair();
    if (o.zoom) o.zoom(p.gap / g.gap, g.mx, g.my, g.down);
    if (o.pan) o.pan(p.mx - g.mx, p.my - g.my, g.down); // (the pair's middle drags the picture with it)
    g.gap = p.gap; g.mx = p.mx; g.my = p.my;
  }
  function onTouchUp(e){
    if (e.pointerType !== "touch" || !touches.delete(e.pointerId)) return;
    touchWinSync();
    if (g?.kind !== "pinch") return;
    // One finger left: it does nothing until the other comes back (a new pinch) or it lifts too.
    if (touches.size === 0){ g = null; setKind(null); }
    else if (touches.size >= 2){ const p = pair(); g.gap = p.gap; g.mx = p.mx; g.my = p.my; }
  }

  function onWheel(e){
    if (!alive || !o.zoom || (o.canStart && !o.canStart(e))) return;
    e.preventDefault();
    o.zoom(zoomFactorWheel(wheelDelta(e), zs(), e.shiftKey), e.clientX, e.clientY, e);
  }
  function onDbl(e){
    if (!alive || editable(e)) return; // (anywhere on el, as before: compare fits from the gap between tiles too)
    dropClick();
    o.dblclick?.(e);
  }

  el.addEventListener("pointerdown", onTouchDown, true);
  el.addEventListener("pointermove", onTouchMove, true);
  el.addEventListener("pointerup", onTouchUp, true);
  el.addEventListener("pointercancel", onTouchUp, true);
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("lostpointercapture", onLost);
  if (o.wheel !== false) el.addEventListener("wheel", onWheel, { passive: false });
  el.addEventListener("dblclick", onDbl);

  return {
    // A gesture is running (hover cursors stay as they are).
    busy: () => !!g,
    dropClick,
    // End the running gesture as cancelled (a scrub ends where it is) and forget every finger.
    cancel(){ finish(null, true); g = null; touches.clear(); touchWinSync(); setKind(null); },
    destroy(){
      if (!alive) return;
      try { finish(null, true); } catch {} // (a throwing end must not leave the window listeners behind)
      g = null;
      alive = false;
      dropClick();
      dropWin();
      touches.clear(); // (a finger down when the viewer goes never sends its pointerup here: 0.93.0)
      touchWinSync();
      el.removeEventListener("pointerdown", onTouchDown, true);
      el.removeEventListener("pointermove", onTouchMove, true);
      el.removeEventListener("pointerup", onTouchUp, true);
      el.removeEventListener("pointercancel", onTouchUp, true);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("lostpointercapture", onLost);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("dblclick", onDbl);
    },
  };
}
