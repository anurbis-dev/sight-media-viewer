// One cursor system for the view gestures (pan, zoom, rotate, scrub, split / resize drags) in every mode:
// the lightbox viewers, Compare, the 3D viewer, the board, the library grid and the annotator. Call sites only
// say which gesture runs (or what a hover would do); this module owns the cursor values and the priority rule.
//
//   setCursor(el, layer, kind)   kind: a gesture name below, any raw CSS cursor value, or null (clear the layer)
//   during(el, kind) → end()     a gesture cursor for the length of a drag
//
// Layers, highest first:
//   "gesture"  a drag that is running (pan / zoom / rotate / scrub …). Wins over everything on el AND its
//              descendants (an annotator's tool cursor, a child's own CSS cursor, the Alt hint): !important.
//   "hover"    what a press here would grab (a Compare split under the mouse). Inline style on el.
//   "tool"     an annotation tool's cursor. Inline style on el (as before: it beats el's CSS hints).
//   "base"     the idle hint where a drag's primary meaning is a pan (a picture: grab). Zero specificity, so a
//              CSS modifier hint (body.k-rot .view: the rotate cursor, R held) and the layers above beat it.
// Touch has no cursor: setting one during a touch gesture is harmless.
// (The exported HTML review page and the phone app inline review-draw.js, which keeps its own one-line rule.)

// Rotate: CSS has none — a circular arrow (white over a black outline, so it reads on any picture), hotspot in the
// middle, `alias` where data-URI cursors are not supported. Also on :root as --cur-rot for plain CSS rules.
export const ROTATE_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M19 12a7 7 0 1 1-2.2-5.1M19 4v4h-4' stroke='black' stroke-width='4.2'/%3E%3Cpath d='M19 12a7 7 0 1 1-2.2-5.1M19 4v4h-4' stroke='white' stroke-width='2'/%3E%3C/svg%3E") 12 12, alias`;

// The gesture names. Anything else passed as a kind is used as a CSS cursor value as it is.
export const CURSORS = {
  grab: "grab",            // hover: a left drag here pans
  pan: "grabbing",         // panning (also: dragging a board item around)
  zoom: "zoom-in",         // zooming, direction not known yet
  "zoom-in": "zoom-in",
  "zoom-out": "zoom-out",
  rotate: ROTATE_CURSOR,   // turning a picture / orbiting a 3D model / rotating a board item or the lights
  scrub: "ew-resize",      // scrubbing a timeline by dragging the picture
  "resize-x": "ew-resize", // a vertical split / divider (moves sideways)
  "resize-y": "ns-resize", // a horizontal one
  pinch: null,             // two fingers: touch only, no cursor
};

// The zoom cursor for a relative zoom step (> 1: in).
export const zoomCursor = (factor) => (factor >= 1 ? "zoom-in" : "zoom-out");

const LAYERS = ["gesture", "hover", "tool", "base"];
const state = new WeakMap(); // el → { gesture, hover, tool, base } (CSS values)

const valueOf = (kind) => (kind == null || kind === "" ? null : Object.hasOwn(CURSORS, kind) ? CURSORS[kind] : String(kind));

export function setCursor(el, layer, kind){
  if (!el || !LAYERS.includes(layer)) return;
  let s = state.get(el);
  if (!s){ s = {}; state.set(el, s); }
  const v = valueOf(kind);
  s[layer] = v; // (applied again even when unchanged: a className reset may have dropped the class)
  if (layer === "gesture" || layer === "base"){
    const cls = layer === "gesture" ? "cur-g" : "cur-b", prop = `--${cls}`;
    if (v){ el.style.setProperty(prop, v); el.classList.add(cls); }
    else { el.classList.remove(cls); el.style.removeProperty(prop); }
  } else el.style.cursor = s.hover || s.tool || "";
}

export function during(el, kind){
  setCursor(el, "gesture", kind);
  return () => setCursor(el, "gesture", null);
}

// The rules behind the classes (once per document).
if (typeof document !== "undefined" && !document.getElementById("sight-cursors")){
  const st = document.createElement("style");
  st.id = "sight-cursors";
  st.textContent = `:root { --cur-rot: ${ROTATE_CURSOR}; }
:where(.cur-b) { cursor: var(--cur-b); }
.cur-g, .cur-g * { cursor: var(--cur-g) !important; }`;
  document.head.appendChild(st);
}
