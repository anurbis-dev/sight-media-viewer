// Annotations / review session for the lightbox — vector drawings on top of an image, a video frame
// or a 3D view, plus a side panel of review notes with screenshots, exportable as PDF or as a
// .srev review package (see app/review.py).
//
// Self-contained ES module (zero-build): index.html creates one annotator with createAnnotator()
// and drives it from the lightbox (mount/unmount, setAsset, bind2d/bind3d, onKey).
//
// Board mode (host.board, S.kind "board"): a second annotator drives the Canvas board view (canvas.js). The
// "asset" is the board ({id, kind: "board", name}), drawings are FREE in world coordinates (rows scope='board',
// board_id), the notes panel works as in the lightbox; everything that needs a picture (screenshots, versions,
// review state, frame stamp, exports, note previews) is skipped.
//
// Data: one row of the `annotations` table per object (scope='asset', target_asset_id = the asset),
// written through /api/annotations. Client ids are 16 hex chars so undo can revive a deleted row
// under the same id and drawings can point at their note (data.note).
//   kind 'stroke'  shape_kind brush | pencil | marker   data.pts = [x, y, pressure, ...]
//   kind 'shape'   shape_kind rect | ellipse | line | arrow
//   kind 'text', kind 'pin' (numbered callout), kind 'note' (the review comment itself)
// Geometry lives in "doc" units: image/video pixels; for 3D, screen space normalised to a viewport
// 1000 units high, centred (a perspective camera keeps its vertical fov, so this survives resizes).
// Context (data.ctx): video {t, hold} — visible around time t; 3D {vk, cam} — visible while the
// camera matches that view; images: none (always visible).

import { hotkey, runHotkeys } from "/static/keys.js";
import { convertForPlayback } from "/static/video-playable.js";
import { setCursor } from "/static/cursors.js";
// Primitives, rendering, hit tests and the merge rules are shared with the HTML page and the
// mobile app (review-core.js, a plain script that sets globalThis.SightReviewCore; docs/FORMAT.md).
import "/static/review-core.js";
import "/static/trackers-core.js";  // globalThis.SightTrackers — the tracker registry (docs/ARCHITECTURE.md "Tracker adapters")
import "/static/shotgrid-core.js";  // registers the ShotGrid adapter (docs/SHOTGRID.md), shared with the phone app
import { createPlate } from "/static/caption-plate.js";
import { createDictationUI } from "/static/dictation.js";
const RC = globalThis.SightReviewCore;
const { STROKE_TOOLS, FONTS, uid, clamp, r2, hyp, typeOf, esc, fontStack, textLayout,
  primsOf, primSvg, boundsOf, hitTest, transformItem, validItem } = RC;

const SVGNS = "http://www.w3.org/2000/svg";
const ico = (body) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICON = {
  select: ico(`<path d="M5 3l13 7.5-5.6 1.6L9.6 18z"/><path d="M12.4 12.1 17 19"/>`),
  brush: ico(`<path d="M19.5 3.5a2.1 2.1 0 0 1 3 3L13 16l-3-3z"/><path d="M10 13c-3 0-4.5 2-4.5 4.2 0 1.4-1 2.3-2.5 2.8 5 1.2 9.5-.2 9.5-4.3z"/>`),
  pencil: ico(`<path d="M4 20l1-4.5L16 4.5a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="M14 6.5l3 3"/>`),
  marker: ico(`<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>`),
  eraser: ico(`<path d="M8 20h12"/><path d="M5.2 14.8 14 6a2 2 0 0 1 2.8 0l2.8 2.8a2 2 0 0 1 0 2.8L11.2 20H8.4l-3.2-3.2a1.4 1.4 0 0 1 0-2z"/><path d="m9.5 10.5 5 5"/>`),
  arrow: ico(`<path d="M5 19 19 5"/><path d="M10 5h9v9"/>`),
  lasso: ico(RC.TOOL_ICONS.lasso),
  arrows: ico(RC.TOOL_ICONS.arrows),
  rect: ico(`<rect x="4" y="6" width="16" height="12" rx="2"/>`),
  ellipse: ico(`<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>`),
  text: ico(`<path d="M5 7V5h14v2"/><path d="M12 5v14"/><path d="M9 19h6"/>`),
  pin: ico(`<circle cx="14" cy="10" r="6.5"/><path d="M13 7.5h1.5v5"/><path d="M9.4 14.6 4 20"/>`),
  undo: ico(`<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>`),
  redo: ico(`<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>`),
  shot: ico(`<path d="M14.5 5h-5L8 7H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.5"/>`),
  region: ico(`<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><rect x="8" y="8" width="8" height="8" rx="1" stroke-dasharray="2 2"/>`),
  eye: ico(`<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>`),
  eyeOff: ico(`<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>`),
  panel: ico(`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/><path d="M17.5 8h1M17.5 11h1"/>`),
  stamp: ico(`<rect x="3" y="5" width="18" height="14" rx="2"/><rect x="5.5" y="7.5" width="7" height="3.5" rx="1" fill="currentColor" stroke="none"/>`),
  onion: ico(`<circle cx="8" cy="12" r="5" opacity=".45"/><circle cx="16" cy="12" r="5" opacity=".45"/><circle cx="12" cy="12" r="5"/>`),
  annotate: ico(`<path d="M4 20l1-4.5L16 4.5a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="M14 20h6"/>`),
  help: ico(`<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.1 1-1.1 1.8"/><path d="M12 17h.01"/>`),
  close: ico(`<path d="M6 6l12 12M18 6 6 18"/>`),
  check: ico(`<path d="m5 12.5 4.5 4.5L19 7.5"/>`),
  prog: ico(`<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>`),
  trash: ico(`<path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13"/>`),
  reply: ico(`<path d="M10 8 5 12.5l5 4.5"/><path d="M5 12.5h9a5 5 0 0 1 5 5V19"/>`),
  view: ico(`<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/><circle cx="12" cy="12" r="3"/>`),
  image: ico(`<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="m21 16-5-5-9 9"/>`),
};

// [id, combo, label, icon]
const TOOLS = [
  ["select", "KeyV", "Select / move", ICON.select],
  ["brush", "KeyB", "Brush — pen pressure", ICON.brush],
  ["pencil", "KeyP", "Pencil", ICON.pencil],
  ["marker", "KeyM", "Highlighter", ICON.marker],
  ["lasso", "KeyL", "Lasso — a closed stroke filled with a pattern", ICON.lasso],
  ["eraser", "KeyE", "Eraser — or hold Ctrl with any tool", ICON.eraser],
  null,
  ["arrow", "KeyW", "Arrow — a line with Start / End heads set to none · Shift keeps it horizontal / vertical", ICON.arrow],
  ["arrows", "Shift+KeyW", "Stroke arrows — arrows along a freehand stroke", ICON.arrows],
  ["rect", "KeyR", "Shape — rectangle or ellipse (O) · Shift square / circle", ICON.rect],
  ["text", "KeyT", "Text", ICON.text],
  ["pin", "KeyN", "Number pin — click for a numbered circle, drag for a line to it; type the number, Enter", ICON.pin],
  ["image", "Shift+KeyI", "Reference image — click to pick pictures, drop them on the frame, or drag them from the library (Tab)", ICON.image],
];
// The frame stamp (a device preference, not review data): where / how the frame label sits over the video and on
// report pictures. `size` is a percentage of the picture's width; the defaults are the look the label always had.
const STAMP_DEFAULT = { mode: "both", size: 2.2, color: "#ffffff", bg: "#000000", bgOp: 0.6, font: "normal", pos: "tl" };
const STAMP_POS = ["tl", "t", "tr", "l", null, "r", "bl", "b", "br"];
const STAMP_ARROW = { tl: "↖", t: "↑", tr: "↗", l: "←", r: "→", bl: "↙", b: "↓", br: "↘" };
const SWATCHES = ["#ff3b30", "#ff9500", "#ffd60a", "#34c759", "#32ade6", "#3478f6", "#af52de", "#ffffff", "#111111"];
const HEADS = [["none", "—"], ["triangle", "▶"], ["open", "›"], ["diamond", "◆"], ["dot", "●"], ["bar", "|"]];
const BODIES = [["straight", "Straight"], ["curve", "Curve"], ["elbow", "Elbow"]];
const DASHES = [["solid", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"]];
const HOLDS = [[0, "1 frame"], [0.5, "0.5 s"], [1, "1 s"], [2, "2 s"], [-1, "Whole clip"]];

// Sizes in tool styles are screen pixels at the moment of drawing (what you see is what you get);
// they are converted to doc units when an object is created.
const DEFAULT_STYLES = {
  brush: { color: "#ff3b30", size: 8, opacity: 1, pressure: true, smooth: 0.5 },
  // A brush stroke that closes (data.close) and fills; hatchWidth 0 = auto (follows the spacing).
  lasso: { color: "#ff3b30", size: 4, opacity: 1, pressure: true, smooth: 0.5, pattern: "diag", fill: "#ff3b30", fillOpacity: 0.5, gap: 10, hatchWidth: 0 },
  pencil: { color: "#ff3b30", size: 2.5, opacity: 1, pressure: true, smooth: 0.15 },
  marker: { color: "#ffd60a", size: 26, opacity: 0.4, smooth: 0.5 },
  eraser: { size: 26, mode: "object" },
  line: { color: "#ff3b30", width: 4, opacity: 1, dash: "solid", head0: "none", head1: "none", body: "straight", headSize: 1 },
  arrow: { color: "#ff3b30", width: 4, opacity: 1, dash: "solid", head0: "none", head1: "triangle", body: "straight", headSize: 1 },
  // Arrows along a freehand stroke (kind stroke, shape_kind "arrows").
  arrows: { color: "#ff3b30", width: 4, opacity: 1, dash: "solid", head1: "triangle", headSize: 1, step: 40, len: 24, dir: "out", side: "left", guide: true },
  rect: { shape: "rect", color: "#ff3b30", strokeOn: true, width: 4, dash: "solid", fillOn: false, fill: "#ff3b30", fillOpacity: 0.5, radius: 0, opacity: 1 },
  ellipse: { color: "#ff3b30", strokeOn: true, width: 4, dash: "solid", fillOn: false, fill: "#ff3b30", fillOpacity: 0.5, opacity: 1 },
  text: { font: "sans", size: 28, color: "#ffffff", bold: false, italic: false, underline: false, align: "left", bgOn: true, bg: "#000000", bgOpacity: 0.6, outline: 0, outlineColor: "#000000", opacity: 1 },
  pin: { color: "#ff3b30", size: 30 },
  image: { border: 0, borderColor: "#ffffff", shadow: 0, opacity: 1 },
};
// Keys whose value is a length (converted between screen px and doc units).
const LEN_KEYS = new Set(["size", "width", "radius", "outline", "border", "gap", "step", "len", "hatchWidth"]);
// Fill patterns of a lasso (review-core PATTERNS, its names and icons — the same set as the drawing canvas's);
// "random" (the tool only) picks one per stroke.
const PATTERN_OPTS = RC.PATTERNS.map((id) => [id, RC.PATTERN_LABELS[id], ico(RC.patternIcon(id))]);
const RANDOM_PATTERNS = RC.PATTERNS.filter((id) => id !== "none" && id !== "solid");
const hatched = (g) => !["none", "solid"].includes(g("pattern"));

// Props bar descriptors per object type.
//   t: color | num | toggle | select | seg   create: only while drawing (hidden for a selection)
//   edit: only for a selection   when(get): shown while true (get(key) reads the tool's / selection's value)
const P = {
  color: { k: "color", t: "color", label: "Colour" },
  size: { k: "size", t: "num", label: "Size", min: 0.5, max: 400, exp: true, unit: "px" },
  opacity: { k: "opacity", t: "num", label: "Opacity", min: 0.05, max: 1, pct: true },
  pressure: { k: "pressure", t: "toggle", label: "Pressure", title: "Pen pressure changes the width" },
  smooth: { k: "smooth", t: "num", label: "Smooth", min: 0, max: 1, pct: true, create: true },
  width: { k: "width", t: "num", label: "Width", min: 0.5, max: 200, exp: true, unit: "px" },
  dash: { k: "dash", t: "select", label: "Dash", options: DASHES },
  head0: { k: "head0", t: "select", label: "Start", options: HEADS },
  head1: { k: "head1", t: "select", label: "End", options: HEADS },
  body: { k: "body", t: "select", label: "Shape", options: BODIES },
  headSize: { k: "headSize", t: "num", label: "Head", min: 0.3, max: 4, exp: true, unit: "×" },
  shape: { k: "shape", t: "seg", label: "Shape", options: [["rect", "▭"], ["ellipse", "◯"]], create: true },
  fillOn: { k: "fillOn", t: "toggle", label: "Fill" },
  fill: { k: "fill", t: "color", label: "Fill colour" },
  fillOpacity: { k: "fillOpacity", t: "num", label: "Fill α", min: 0, max: 1, pct: true },
  radius: { k: "radius", t: "num", label: "Radius", min: 0, max: 400, exp: false, unit: "px" },
  font: { k: "font", t: "select", label: "Font", options: FONTS.map(([id, n]) => [id, n]) },
  tsize: { k: "size", t: "num", label: "Size", min: 4, max: 600, exp: true, unit: "px" },
  bold: { k: "bold", t: "toggle", label: "B", title: "Bold", cls: "b" },
  italic: { k: "italic", t: "toggle", label: "I", title: "Italic", cls: "i" },
  underline: { k: "underline", t: "toggle", label: "U", title: "Underline", cls: "u" },
  align: { k: "align", t: "seg", label: "Align", options: [["left", "⇤"], ["center", "↔"], ["right", "⇥"]] },
  bgOn: { k: "bgOn", t: "toggle", label: "Box", title: "Background box" },
  bg: { k: "bg", t: "color", label: "Box colour" },
  bgOpacity: { k: "bgOpacity", t: "num", label: "Box α", min: 0, max: 1, pct: true },
  outline: { k: "outline", t: "num", label: "Outline", min: 0, max: 40, exp: false, unit: "px" },
  outlineColor: { k: "outlineColor", t: "color", label: "Outline colour" },
  psize: { k: "size", t: "num", label: "Size", min: 10, max: 200, exp: true, unit: "px" },
  esize: { k: "size", t: "num", label: "Size", min: 2, max: 400, exp: true, unit: "px" },
  emode: { k: "mode", t: "seg", label: "Erase", options: [["object", "Object"], ["partial", "Partial"]] },
  border: { k: "border", t: "num", label: "Frame", min: 0, max: 200, exp: false, unit: "px" },
  borderColor: { k: "borderColor", t: "color", label: "Frame colour" },
  shadow: { k: "shadow", t: "num", label: "Shadow", min: 0, max: 1, pct: true },
  // Lasso (a closed brush stroke): its fill, an icon row (the tool also offers Random; a drawn one keeps the real
  // pattern), the pattern's colour / opacity / spacing and the hatch lines' width (the dots' size); 0 = Auto.
  pattern: { k: "pattern", t: "seg", label: "Fill", options: [...PATTERN_OPTS, ["random", RC.PATTERN_LABELS.random, ico(RC.patternIcon("random"))]], create: true },
  ipattern: { k: "pattern", t: "seg", label: "Fill", options: PATTERN_OPTS, edit: true },
  bfill: { k: "fill", t: "color", label: "Fill colour", when: (g) => g("pattern") !== "none" },
  bfillOpacity: { k: "fillOpacity", t: "num", label: "Fill α", min: 0, max: 1, pct: true, when: (g) => g("pattern") !== "none" },
  gap: { k: "gap", t: "num", label: "Spacing", title: "Pattern density: the distance between lines / dots", min: 2, max: 200, exp: true, unit: "px", when: hatched },
  // (auto: 0 means Auto — RC.hatchMetrics' width, which a drag / scroll from Auto starts at.)
  hatchWidth: { k: "hatchWidth", t: "num", label: "Lines", title: "Hatch line thickness (for dots: their size) — Auto follows the spacing; type 0 or right-click for Auto", min: 0.1, max: 100, exp: true, unit: "px", when: hatched, auto: true },
  // Stroke arrows: arrows along a freehand stroke, turned to its normal.
  ahead: { k: "head1", t: "select", label: "Tip", options: HEADS },
  step: { k: "step", t: "num", label: "Every", title: "Distance between the arrows along the stroke", min: 4, max: 1000, exp: true, unit: "px" },
  alen: { k: "len", t: "num", label: "Length", title: "Length of each arrow", min: 2, max: 600, exp: true, unit: "px" },
  adir: { k: "dir", t: "cycle", label: "Direction", options: [
    ["out", "Away from the stroke", ico(`<path d="M3 20h18"/><path d="M12 16V4M8 8l4-4 4 4"/>`)],
    ["in", "Toward the stroke", ico(`<path d="M3 20h18"/><path d="M12 4v12M8 12l4 4 4-4"/>`)]] },
  // Sides are relative to the direction the stroke was drawn in (the icons draw it left → right).
  aside: { k: "side", t: "cycle", label: "Side", options: [
    ["left", "Left of the stroke", ico(`<path d="M3 16h17M17 13l3 3-3 3"/><path d="M8 12V5M14 12V5"/>`)],
    ["right", "Right of the stroke", ico(`<path d="M3 8h17M17 5l3 3-3 3"/><path d="M8 12v7M14 12v7"/>`)],
    ["both", "Both sides", ico(`<path d="M3 12h17M17 9l3 3-3 3"/><path d="M8 9V3M14 9V3M8 15v6M14 15v6"/>`)]] },
  guide: { k: "guide", t: "toggle", label: "Guide", title: "Guide — draw the stroke itself under the arrows", ico: ico(`<path d="M3 15c3-6 6 6 9 0s6-6 9 0"/>`) },
};
const ARROWS_PROPS = [P.color, P.width, P.opacity, P.ahead, P.headSize, P.step, P.alen, P.adir, P.aside, P.guide, { ...P.dash, when: (g) => g("guide") !== false }];
const PROPS = {
  brush: [P.color, P.size, P.opacity, P.pressure, P.smooth],
  // The lasso tool, and a selected closed brush stroke (propType).
  lasso: [P.color, P.size, P.opacity, P.pressure, P.smooth, P.pattern, P.ipattern, P.bfill, P.bfillOpacity, P.gap, P.hatchWidth],
  pencil: [P.color, P.size, P.opacity, P.pressure, P.smooth],
  marker: [P.color, P.size, P.opacity, P.smooth],
  eraser: [P.esize, P.emode],
  line: [P.color, P.width, P.opacity, P.dash, P.head0, P.head1, P.body, P.headSize],
  arrow: [P.color, P.width, P.opacity, P.dash, P.head0, P.head1, P.body, P.headSize],
  // The stroke arrows tool, and a selected arrows stroke.
  arrows: ARROWS_PROPS,
  // The shape tool (id "rect") draws either; a selected shape keeps its kind. No stroke switch: the outline is
  // always drawn (shapes made with it off keep it off).
  rect: [P.shape, P.color, P.width, P.dash, P.fillOn, P.fill, P.fillOpacity, P.radius, P.opacity],
  ellipse: [P.color, P.width, P.dash, P.fillOn, P.fill, P.fillOpacity, P.opacity],
  text: [P.font, P.tsize, P.color, P.bold, P.italic, P.underline, P.align, P.bgOn, P.bg, P.bgOpacity, P.outline, P.outlineColor, P.opacity],
  pin: [P.color, P.psize],
  image: [P.border, P.borderColor, P.shadow, P.opacity],
  select: [],
};

const isDrawing = (it) => it.kind !== "note";
// The props a drawing shows / takes: a closed brush stroke is a lasso (the lasso tool makes them; FORMAT.md keeps them
// brush strokes with data.close).
const propType = (it) => { const t = typeOf(it); return t === "brush" && it.data?.close ? "lasso" : t; };
// Tools that draw a freehand stroke (the brush circle follows the pointer).
const freehand = (t) => STROKE_TOOLS.has(t) || t === "lasso";
// Reference images (kind "image") show Sight's stored shots.
RC.setImageSource((id) => (/^[0-9a-f]{16}$/.test(String(id)) ? `/api/review/shots/${id}` : ""));
// Pictures a reference image is made from: anything the browser decodes. Kept at most REF_MAX px on the long side.
const REF_MAX = 2048;
const REF_RE = /\.(jpe?g|png|gif|webp|bmp|avif|svg)$/i;
const refAlpha = (typeOrName) => /png|gif|webp|svg|avif/i.test(String(typeOrName || ""));
// A reference image's crop frame: the whole source picture in doc units — origin O (its top-left), axes u / v
// (the drawing's rotation) and the doc units per picture width / height (sx, sy). Cropping moves the box, never
// the picture, so every crop gesture works from the frame taken when it started.
function cropFrame(d){
  const c = RC.imgCrop(d), sx = d.w / c[2], sy = d.h / c[3];
  const a = (d.rot || 0) * Math.PI / 180, u = [Math.cos(a), Math.sin(a)], v = [-Math.sin(a), Math.cos(a)];
  const tlx = d.x + d.w / 2 - u[0] * d.w / 2 - v[0] * d.h / 2, tly = d.y + d.h / 2 - u[1] * d.w / 2 - v[1] * d.h / 2;
  return { O: [tlx - u[0] * c[0] * sx - v[0] * c[1] * sy, tly - u[1] * c[0] * sx - v[1] * c[1] * sy], u, v, sx, sy };
}
const toImg = (F, x, y) => { const dx = x - F.O[0], dy = y - F.O[1]; return [(dx * F.u[0] + dy * F.u[1]) / F.sx, (dx * F.v[0] + dy * F.v[1]) / F.sy]; };
const fromImg = (F, nx, ny) => [F.O[0] + F.u[0] * nx * F.sx + F.v[0] * ny * F.sy, F.O[1] + F.u[1] * nx * F.sx + F.v[1] * ny * F.sy];
// Sets the crop window c (0…1 of the picture) and the box that shows it, the picture staying where frame F has it.
function applyCrop(d, F, c){
  d.w = c[2] * F.sx; d.h = c[3] * F.sy;
  const tl = fromImg(F, c[0], c[1]);
  const cx = tl[0] + F.u[0] * d.w / 2 + F.v[0] * d.h / 2, cy = tl[1] + F.u[1] * d.w / 2 + F.v[1] * d.h / 2;
  d.x = cx - d.w / 2; d.y = cy - d.h / 2;
  d.crop = c[0] <= 1e-4 && c[1] <= 1e-4 && c[2] >= 1 - 1e-4 && c[3] >= 1 - 1e-4 ? null : c.map((v) => Math.round(v * 1e5) / 1e5);
}
// Elements that already carry this module's pointer listeners (a board view keeps one viewport for ever).
const wired = new WeakSet();

function fmtTime(t, fps){
  if (!Number.isFinite(t)) return "";
  const f = Math.round((t % 1) * (fps || 25));
  const s = Math.floor(t) % 60, m = Math.floor(t / 60) % 60, h = Math.floor(t / 3600);
  const p = (n) => String(n).padStart(2, "0");
  return (h ? h + ":" + p(m) : m) + ":" + p(s) + "." + p(Math.min(f, Math.round(fps || 25) - 1));
}
function fmtDate(ms){
  try { return new Date(ms).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
}

// ---- durable write queue (shared by every annotator) ----------------------------------------------
// Every row write goes through this one queue, never straight to fetch(): one entry per row id (the
// newest wins: {op: "put", body, create} or {op: "del"}, `key` = the asset / board it belongs to), kept
// in localStorage until the server has it, retried with backoff while it fails, sent with keepalive when
// the page goes away. Writes are therefore never tied to the annotator's current asset: switching clips
// mid-save, a failed request or a closed window used to drop notes and replies (0.87.1).
// Storage: one key per window (`OB_PREFIX + window id` = {ts, entries}), refreshed while it holds entries;
// a start adopts the keys of windows that stopped refreshing theirs (closed / crashed). The prefix is
// outside "sight.*" on purpose: hydrateSettings() drops sight.* keys the server lacks.
const OB_PREFIX = "sight-annot-outbox:v2:";
// OB_STALE: background tabs run timers about once a minute, so a live window may refresh its key late.
const OB_STALE = 180000, OB_TIMEOUT = 20000, OB_RECENT = 30000;
const OB = {
  map: new Map(), busy: false, gone: false, timer: 0, fails: 0, batchFails: 0, waiters: [], badge: null, note: "", noteTimer: 0,
  key: OB_PREFIX + Math.random().toString(16).slice(2) + Date.now().toString(16),
  // Writes that landed lately (id -> {e, at, sentAt}): a load() whose GET raced them still shows them (obOverlay).
  recent: new Map(),
  inflight: new Set(), // row ids with a request on the way (obBeacon leaves them alone)
  // When the newest write of each row that landed from this window was made (entry.at): an adopted entry made
  // before it is older than what the server has and is skipped (obAdopt).
  landedAt: new Map(),
  handed: new Set(), // rows whose queued writes went to another window: the next write here is an upsert
  stored: false, // the last obSave() wrote this window's key (so a missing key means another window adopted it)
  // Every annotator's "commit what is open and queue it" (settle), for the page going away.
  settlers: new Set(),
};
const OB_ID = /^[0-9a-f]{16}$/;
function obValid(id, e){
  return typeof id === "string" && OB_ID.test(id) && e && typeof e === "object"
    && (e.op === "del" || (e.op === "put" && e.body && typeof e.body === "object" && e.body.id === id));
}
function obSave(){
  try {
    // ts 0 once the page is going away: the next start (a reload, the next launch) adopts it straight away.
    if (OB.map.size) localStorage.setItem(OB.key, JSON.stringify({ ts: OB.gone ? 0 : Date.now(), entries: [...OB.map] }));
    else localStorage.removeItem(OB.key);
    OB.stored = OB.map.size > 0;
  } catch {
    // A stale copy would replay old rows over newer ones at the next start: better none at all.
    OB.stored = false;
    try { localStorage.removeItem(OB.key); } catch {}
  }
}
// Entries of windows that are gone (their key not refreshed for OB_STALE), plus the v1 single key.
function obAdopt(){
  try {
    const now = Date.now(), keys = [];
    for (let i = 0; i < localStorage.length; i++){
      const k = localStorage.key(i);
      if (k && (k === "sight-annot-outbox:v1" || (k.startsWith(OB_PREFIX) && k !== OB.key))) keys.push(k);
    }
    for (const k of keys){
      let v = null;
      try { v = JSON.parse(localStorage.getItem(k)); } catch {}
      const entries = Array.isArray(v) ? v : v && Array.isArray(v.entries) ? v.entries : null;
      if (v && !Array.isArray(v) && now - (Number(v.ts) || 0) < OB_STALE) continue; // a live window's queue
      if (entries) for (const item of entries){
        if (!Array.isArray(item)) continue;
        const [id, e] = item;
        // Not over a newer write of this window (queued, or landed after the adopted one was made).
        if (obValid(id, e) && !OB.map.has(id) && (Number(e.at) || 0) > (OB.landedAt.get(id) ?? -1)) OB.map.set(id, e);
      }
      localStorage.removeItem(k);
    }
  } catch {}
  obSave();
}
// Frozen too long (App Nap, a suspended tab, bfcache) and another window adopted this queue: that window sends
// it, this one drops its copy. Checked before anything here writes or sends (`ignoreGone`: from pageshow).
function obHandedOff(ignoreGone){
  let gone = false;
  try { gone = OB.stored && (ignoreGone || !OB.gone) && localStorage.getItem(OB.key) === null; } catch {}
  if (!gone) return false;
  for (const id of OB.map.keys()) OB.handed.add(id);
  OB.map.clear(); OB.stored = false; obPaint();
  return true;
}
function obPut(body, create){
  obHandedOff();
  const prev = OB.map.get(body.id);
  // A row whose create (or revive after a delete) has not landed yet still needs the POST (an upsert).
  const mustCreate = !!create || prev?.op === "del" || (prev?.op === "put" && prev.create) || OB.handed.delete(body.id);
  // A copy: the row as it is now, whatever happens to the live item afterwards.
  OB.map.set(body.id, { op: "put", body: structuredClone(body), create: mustCreate, key: body.target_asset_id || body.board_id || null, at: Date.now() });
  obSave();
  obKick(0);
}
function obDel(id, key){
  obHandedOff();
  OB.map.set(id, { op: "del", key: key || null, at: Date.now() });
  obSave();
  obKick(0);
}
function obKick(ms){
  if (OB.busy) return; // the running pass re-reads the map before it ends
  clearTimeout(OB.timer);
  OB.timer = setTimeout(obDrain, ms);
}
// Rows of `key` with the writes laid over them that the server may not show yet: queued ones, and ones that
// landed lately while the GET may have read the database before them. A landed write counts only where the row
// the GET returned is older than the request (updated_at < sentAt; same machine, same clock) — or, for a create,
// missing — so a change made on the server since (an import, another window, the phone) is never hidden.
function obOverlay(rows, key){
  const out = new Map(rows.map((r) => [r.id, r]));
  const now = Date.now();
  const lay = (id, e) => {
    if (e.op === "del") out.delete(id);
    else out.set(id, { ...(out.get(id) || {}), id, kind: e.body.kind, shape_kind: e.body.shape_kind, z_index: e.body.z_index, data: structuredClone(e.body.data) });
  };
  for (const [id, r] of OB.recent){
    if (now - r.at > OB_RECENT){ OB.recent.delete(id); continue; }
    if (r.e.key !== key || OB.map.has(id)) continue;
    const row = out.get(id), older = row && (Number(row.updated_at) || 0) < r.sentAt;
    if (r.e.op === "del" ? older : (older || (!row && r.e.create))) lay(id, r.e);
  }
  for (const [id, e] of OB.map) if (e.key === key) lay(id, e);
  return [...out.values()];
}
// The rows of `key` are about to be read after a server-side change (an import, a reload): no landed write may
// stand in for them.
function obForget(key){ for (const [id, r] of OB.recent) if (r.e.key === key) OB.recent.delete(id); }
// 4xx (except 408 / 429) = the server refuses this row for good: retrying cannot help, keep the rest moving.
class ObRefused extends Error {}
async function obFetch(path, opts){
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), OB_TIMEOUT); // a hung request must not stall the queue for good
  try {
    const r = await fetch(path, { ...opts, signal: ctl.signal });
    if (r.ok) return;
    const msg = `${opts.method} ${path}: ${r.status}`;
    if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) throw new ObRefused(msg);
    throw new Error(msg);
  } finally { clearTimeout(t); }
}
const JSON_HDR = { "content-type": "application/json" };
const obReq = (id, e) => e.op === "del" ? [`/api/annotations/${encodeURIComponent(id)}`, { method: "DELETE" }]
  : e.create ? ["/api/annotations", { method: "POST", headers: JSON_HDR, body: JSON.stringify(e.body) }]
  : [`/api/annotations/${encodeURIComponent(id)}`, { method: "PATCH", headers: JSON_HDR, body: JSON.stringify(obFields(e.body)) }];
function obFields(b){ return { data: b.data, z_index: b.z_index, color: b.color, x: b.x, y: b.y, w: b.w, h: b.h, shape_kind: b.shape_kind }; }
// Removes `e` once sent, unless a newer write for the row came in meanwhile (that one is sent next).
// `refused`: the server did not take it; it must not show (OB.recent) nor count as landed.
function obDone(id, e, sentAt, refused){
  if (OB.map.get(id) !== e) return;
  OB.map.delete(id);
  if (!refused){
    OB.recent.set(id, { e, at: Date.now(), sentAt: sentAt || 0 });
    OB.landedAt.set(id, Number(e.at) || Date.now());
  }
  obSave();
}
async function obDrain(){
  if (OB.busy) return;
  obHandedOff();
  OB.busy = true;
  clearTimeout(OB.timer);
  let failed = false;
  try {
    // Each pass sends what the map holds; rows that failed wait for the next timer, the others keep going.
    for (let pass = 0; OB.map.size && pass < 50; pass++){
      const batch = [...OB.map], failedNow = new Set();
      let down = false; // no answer at all (network error / timeout): the other rows would only wait too
      const one = async (id, e) => {
        if (down){ failedNow.add(id); return; }
        const sentAt = Date.now();
        OB.inflight.add(id);
        try { const [p, o] = obReq(id, e); await obFetch(p, o); obDone(id, e, sentAt); }
        catch (err){
          if (err instanceof ObRefused){ console.warn("annotation write refused", err); obDone(id, e, 0, true); obRefusedNote(); }
          else { failedNow.add(id); down = !/^\w+ \S+: \d+$/.test(err.message || ""); console.warn("annotation save failed, will retry", err); }
        }
        finally { OB.inflight.delete(id); }
      };
      // Creates and deletes one by one; plain updates in one batch, or one by one (PATCH: a row gone on the
      // server is skipped, never revived) once the batch failed twice or was refused.
      const updates = batch.filter(([, e]) => e.op === "put" && !e.create && !e.single);
      for (const [id, e] of batch) if (e.op === "del" || e.create || e.single) await one(id, e);
      if (updates.length && down) for (const [id] of updates) failedNow.add(id);
      else if (updates.length){
        const sentAt = Date.now();
        for (const [id] of updates) OB.inflight.add(id);
        try {
          await obFetch("/api/annotations/batch", { method: "POST", headers: JSON_HDR, body: JSON.stringify({ items: updates.map(([id, e]) => ({ id, ...obFields(e.body) })) }) });
          for (const [id, e] of updates) obDone(id, e, sentAt);
          OB.batchFails = 0;
        } catch (err){
          console.warn("annotation batch failed", err);
          if (err instanceof ObRefused || ++OB.batchFails >= 2) for (const [id, e] of updates) if (OB.map.get(id) === e) e.single = true;
          if (!(err instanceof ObRefused)) for (const [id] of updates) failedNow.add(id);
        } finally { for (const [id] of updates) OB.inflight.delete(id); }
      }
      if (failedNow.size){ failed = true; break; }
    }
  } finally {
    OB.busy = false;
    obSave();
  }
  OB.fails = failed ? OB.fails + 1 : 0;
  obPaint();
  if (OB.map.size) OB.timer = setTimeout(obDrain, failed ? Math.min(30000, 1000 * 2 ** Math.min(OB.fails - 1, 5)) : 0);
  // A waiter is done once the entries it waited for are gone (sent, or replaced by newer ones), or on a failure.
  OB.waiters = OB.waiters.filter((w) => {
    const left = w.of.some(([id, e]) => OB.map.get(id) === e);
    if (left && !failed) return true;
    w.res(!left);
    return false;
  });
}
// Resolves once every write queued so far has landed (true), or an attempt failed (false; retries go on).
function obFlush(){
  if (!OB.map.size) return Promise.resolve(true);
  const p = new Promise((res) => OB.waiters.push({ of: [...OB.map], res }));
  if (!OB.busy) obDrain();
  return p;
}
// The page is going away: every request at once (the page may not live to see one answer), keepalive, within
// its 64 KB budget. Whatever does not fit or fails stays stored for the next start.
function obBeacon(){
  let budget = 60000;
  for (const [id, e] of OB.map){
    if (OB.inflight.has(id)) continue; // an older request for the row is on the way: never race it (stays stored)
    const [p, o] = obReq(id, e.op === "put" && !e.create && !e.single ? { ...e, single: true } : e);
    const size = (o.body || "").length + 200;
    if (size > budget) continue;
    budget -= size;
    const sentAt = Date.now();
    OB.inflight.add(id);
    fetch(p, { ...o, keepalive: true }).then((r) => { if (r.ok) obDone(id, e, sentAt); }).catch(() => {})
      .finally(() => OB.inflight.delete(id));
  }
}
function obRefusedNote(){
  OB.note = "⚠ The server refused an annotation change (see the log)";
  clearTimeout(OB.noteTimer);
  OB.noteTimer = setTimeout(() => { OB.note = ""; obPaint(); }, 8000);
}
// A failing or refused save is shown until it goes through: a fixed badge (tap / click = retry now), on every screen.
function obPaint(){
  const show = (OB.fails && OB.map.size) || OB.note;
  if (!show && !OB.badge) return;
  if (!OB.badge){
    const b = document.createElement("button");
    b.type = "button";
    b.className = "an-outbox";
    b.title = "Sight could not save these annotation changes yet. They are kept and retried; click to retry now.";
    b.addEventListener("click", () => { OB.note = ""; OB.fails = 0; obPaint(); obKick(0); });
    document.body.appendChild(b);
    OB.badge = b;
  }
  const n = OB.map.size;
  OB.badge.hidden = !show;
  OB.badge.textContent = OB.fails && n ? `⚠ ${n} unsaved annotation change${n === 1 ? "" : "s"} — retrying` : OB.note;
}
if (typeof window !== "undefined"){
  // Going away for good: open editors commit too. Only hidden (minimized, another app): queue what is
  // committed, leave a field being typed in alone.
  const away = (full) => { for (const s of OB.settlers){ try { (full ? s.settle : s.stage)(); } catch (e){ console.warn(e); } } };
  window.addEventListener("pagehide", () => { away(true); OB.gone = true; obSave(); if (OB.map.size) obBeacon(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden){ away(false); obSave(); if (OB.map.size) obKick(0); } });
  window.addEventListener("pageshow", (e) => { if (!e.persisted) return; obHandedOff(true); OB.gone = false; obSave(); if (OB.map.size) obKick(0); });
  // Keeps this window's stored queue marked as alive, so another window's start does not adopt it.
  setInterval(() => {
    if (!OB.map.size || obHandedOff()) return;
    obSave();
  }, 5000);
  // Writes left over from a closed window or the last session (the server was gone): send them now.
  obAdopt();
  if (OB.map.size) setTimeout(obDrain, 1500);
  // A window that crashed while this one ran: its queue turns stale later and is picked up here.
  setInterval(() => { const n = OB.map.size; obAdopt(); if (OB.map.size > n) obKick(0); }, 60000);
}

// =================================================================================================

export function createAnnotator(host){
  injectStyles();
  // The notes panel's on / off is remembered per host; on a board it starts closed (the view is often narrow).
  const panelKey = host.board ? "sight.annotate.panel.board" : "sight.annotate.panel";
  // The notes panel (S.readOn): notes, replies, a click on a picture goes there; the composer shows while drawing.
  // One switch whether drawing or not (togglePanel); S.panelOn serves only a host without a reading panel.
  const readKey = host.board ? "sight.annotate.read.board" : "sight.annotate.read";
  const S = {
    on: false, panelOn: readJSON(panelKey, host.board ? false : true), readOn: !!readJSON(readKey, false), hidden: false, onion: !!readJSON("sight.annotate.onion", false), hiddenReplies: new Set(),
    tool: "brush", styles: loadStyles(), stamp: loadStamp(), stampVideos: readJSON("sight.annotate.stamp.videos", {}) || {}, stampDrag: false, stampKey: "", hold: readJSON("sight.annotate.hold", 0),
    asset: null, kind: null, items: new Map(), saved: new Set(), loading: null,
    sel: new Set(), crop: null, lastPtr: "mouse", undo: [], redo: [], clip: null, clipCut: false,
    light: null, bar: null, ui: null, b2: null, b3: null, layer: null,
    drag: null, hover: null, edit: null, region: null, pending: [], cleanPic: false, altHeld: false,
    anchors: {}, // last point of each drawing tool, for Shift+click (a straight line from there)
    fps: 25, raf: 0, lastSig: "", dirty: new Set(), saveTimer: 0, views: new Map(), curVk: null,
    status: "", versions: [], prevOpen: null, filter: readJSON("sight.annotate.filter", "all"),
    plate: null, shotView: null, adopt: new Set(), dict: null, dictTa: null,
  };

  // Board mode: the Canvas view's annotator (see the header). Every board-specific branch below goes through this.
  const isBoard = () => S.kind === "board";
  function readJSON(k, dflt){ try { const v = JSON.parse(localStorage.getItem(k)); return v ?? dflt; } catch { return dflt; } }
  function writeJSON(k, v){ try { host.putSetting(k, JSON.stringify(v)); } catch {} }
  function loadStyles(){
    const saved = readJSON("sight.annotate.styles", {}) || {};
    const out = {};
    for (const [k, v] of Object.entries(DEFAULT_STYLES)) out[k] = { ...v, ...(saved[k] || {}) };
    // 0.109: the brush's Close switch and the arrow tool's Stroke mode became the Lasso and Stroke arrows tools —
    // their settings move over once (while the new tool has none saved) and leave the old tools.
    const moveKeys = (from, to, keys) => {
      const src = saved[from] || {};
      if (!saved[to]) for (const key of keys) if (src[key] !== undefined) out[to][key] = src[key];
      for (const key of keys) if (!(key in DEFAULT_STYLES[from])) delete out[from][key];
    };
    moveKeys("brush", "lasso", ["pattern", "fill", "fillOpacity", "gap"]);
    delete out.brush.close;
    moveKeys("arrow", "arrows", ["step", "len", "dir", "side", "guide"]);
    delete out.arrow.mode;
    // The stroke switch is gone: a tool saved with it off would draw invisible outlines. The old fill default
    // (20 %) gives way to the new one.
    const mig = !readJSON("sight.annotate.fill50", false);  // once: a 20 % chosen later stays
    for (const t of ["rect", "ellipse"]){ out[t].strokeOn = true; if (mig && out[t].fillOpacity === 0.2) out[t].fillOpacity = 0.5; }
    // The migrated styles are saved with the marker (the other annotators — board, compare — read them back).
    if (mig){ writeJSON("sight.annotate.styles", out); writeJSON("sight.annotate.fill50", true); }
    if (out.rect.shape !== "ellipse") out.rect.shape = "rect";
    return out;
  }
  function loadStamp(){
    const v = readJSON("sight.annotate.stamp", {}) || {}, d = STAMP_DEFAULT, hex = (x, f) => typeof x === "string" && /^#[0-9a-f]{6}$/i.test(x) ? x : f;
    const num = (x, lo, hi, f) => Number.isFinite(Number(x)) && x !== null && x !== "" ? Math.min(hi, Math.max(lo, Number(x))) : f;
    return {
      mode: ["both", "frame", "time"].includes(v.mode) ? v.mode : d.mode, size: num(v.size, 1, 8, d.size),
      color: hex(v.color, d.color), bg: hex(v.bg, d.bg), bgOp: num(v.bgOp, 0, 1, d.bgOp),
      font: ["normal", "bold", "mono"].includes(v.font) ? v.font : d.font, pos: STAMP_POS.includes(v.pos) && v.pos ? v.pos : d.pos,
    };
  }
  // On / off belongs to the VIDEO, and it is ON by default: sight.annotate.stamp.videos is { assetId: false } for the
  // videos where it was switched off (the key goes when it is switched on again). On, it shows and is burned on every
  // frame of that video. The look above stays one device preference. (A global `on` saved by 0.60 / 0.61.1 is
  // ignored and dropped at the next save.)
  const stampOn = (aid = S.asset?.id) => !!aid && S.stampVideos[aid] !== false;
  function setStampOn(aid, on){
    if (!aid) return;
    if (on) delete S.stampVideos[aid]; else S.stampVideos[aid] = false;
    writeJSON("sight.annotate.stamp.videos", S.stampVideos);
  }
  let stampTimer = 0;
  function saveStamp(){ clearTimeout(stampTimer); stampTimer = setTimeout(() => writeJSON("sight.annotate.stamp", S.stamp), 300); }
  let styleTimer = 0;
  function saveStyles(){ clearTimeout(styleTimer); styleTimer = setTimeout(() => writeJSON("sight.annotate.styles", S.styles), 400); }
  const reviewer = () => localStorage.getItem("sight.reviewer") || "";

  // ---- toast ---------------------------------------------------------------------------------
  let toastTimer = 0;
  function toast(text, ms = 1800){
    const el = S.light?.querySelector(".an-toast");
    if (!el){ host.toast?.(text, ms); return; }
    el.innerHTML = text;
    el.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("on"), ms);
  }

  // ---- persistence ---------------------------------------------------------------------------
  function rowBody(it){
    const b = boundsOf(it);
    const where = isBoard() ? { scope: "board", board_id: S.asset.id } : { scope: "asset", target_asset_id: S.asset.id };
    return {
      id: it.id, ...where, kind: it.kind, shape_kind: it.sub || null,
      z_index: it.z | 0, data: it.data, color: it.data.color || null,
      x: isDrawing(it) ? r2(b[0]) : null, y: isDrawing(it) ? r2(b[1]) : null,
      w: isDrawing(it) ? r2(b[2] - b[0]) : null, h: isDrawing(it) ? r2(b[3] - b[1]) : null,
    };
  }
  // Writes go into the shared queue (OB above) as full rows built NOW, from the asset they belong to, so
  // nothing that happens afterwards (another clip opened, the items cleared) can change or drop them.
  function serverCreate(it){
    S.dirty.delete(it.id);
    S.saved.add(it.id);
    obPut(rowBody(it), true);
  }
  function serverUpdate(id){ S.dirty.add(id); clearTimeout(S.saveTimer); S.saveTimer = setTimeout(flush, 300); }
  // Synchronous: the debounced updates go into the queue with this asset's rows.
  function stage(){
    clearTimeout(S.saveTimer);
    if (S.asset) for (const id of S.dirty){
      const it = S.items.get(id);
      if (!it) continue;
      obPut(rowBody(it), !S.saved.has(id));
      S.saved.add(id);
    }
    S.dirty.clear();
  }
  // Resolves once the queue has reached the server (or the attempt failed; the queue keeps retrying).
  function flush(){ stage(); return obFlush(); }
  function serverDelete(id){
    S.dirty.delete(id);
    if (!S.saved.has(id)) return;
    S.saved.delete(id);
    obDel(id, S.asset?.id);
  }
  // Before the annotator leaves this asset: an editor still open (a note / reply / caption field in the panel,
  // text on the picture, a pin number) commits into THIS asset's rows, then they go into the queue.
  function settle(){
    const ae = document.activeElement;
    if (ae && S.ui?.contains(ae) && ae.matches?.("textarea, input")) ae.blur();
    finishEdit();
    stage();
  }
  OB.settlers.add({ settle, stage });

  // The tracker link popover's state (see "Trackers" below) — kind: the tracker it is open for; per file: msg / picking
  // belong to the file they were made for; projects to the site they were read from; busy: the kind syncing ("" none)
  const trkState = { key: "", busy: "", msg: "", picking: false, projects: null, projSite: "", aid: "" };   // key: the tracker key whose popover is open
  async function load(a){
    const token = {};
    S.loading = token;
    // the tracker link popover belongs to the file it was opened on; a sync of this file repaints it itself
    if (trkState.aid && trkState.aid !== a.id){ const pop = S.ui?.querySelector(".an-trk"); if (pop) pop.hidden = true; }
    let rows = [];
    try { rows = await host.api(`/api/annotations?${isBoard() ? "board_id" : "asset_id"}=${encodeURIComponent(a.id)}`); }
    catch (e){ console.warn(e); if (S.asset?.id === a.id) toast("Could not load the notes of this file"); }
    if (S.loading !== token || S.asset?.id !== a.id) return;
    S.loading = null;
    rows = obOverlay(rows, a.id);  // writes still queued for this file count (re-opened before they landed)
    S.items.clear(); S.saved.clear();
    // The review state is a row of its own (kind 'status', newest wins) — not an editable item.
    const st = rows.filter((r) => r.kind === "status").sort((x, y) => (y.updated_at || 0) - (x.updated_at || 0))[0];
    S.status = st?.data?.state || "";
    // Rows from 0.17.0 have no history: their current state is the one entry.
    S.statusHist = Array.isArray(st?.data?.history) ? st.data.history
      : st?.data?.state ? [{ state: st.data.state, author: st.data.author || "", at: st.data.at || st.updated_at }] : [];
    for (const r of rows){
      if (r.kind === "status") continue;
      const it = { id: r.id, kind: r.kind, sub: r.shape_kind || null, z: r.z_index || 0, data: r.data || {} };
      if (!validItem(it)) continue;
      S.items.set(it.id, it);
      S.saved.add(it.id);
    }
    rebuildViews();
    renderAll();
    renderPanel();
    renderMarks();
    paintBadge();
    loadVersions(a);
  }
  // ---- versions / review state ------------------------------------------------------------------
  async function loadVersions(a){
    S.versions = []; S.prevOpen = null;
    if (S.kind === "model3d" || isBoard()){ renderVersions(); return; }
    let list = [];
    try { list = (await host.api(`/api/assets/${a.id}/versions`)).items || []; } catch {}
    if (S.asset?.id !== a.id) return;
    S.versions = list;
    host.onVersions?.(a.id, list); // (the lightbox's compare button: enabled with 2+ versions)
    const i = list.findIndex((x) => x.id === a.id);
    const prev = i > 0 ? list[i - 1] : null;
    if (prev){
      try {
        const rows = await host.api(`/api/annotations?asset_id=${encodeURIComponent(prev.id)}`);
        if (S.asset?.id !== a.id) return;
        S.prevOpen = { asset: prev, rows };
      } catch {}
    }
    renderVersions();
  }
  // Open notes of the previous version that have not been brought over yet.
  function carryCandidates(){
    const p = S.prevOpen;
    if (!p) return [];
    const have = new Set([...S.items.values()].map((it) => it.data.from?.id).filter(Boolean));
    return p.rows.filter((r) => r.kind === "note" && r.data?.status !== "done" && !have.has(r.id));
  }
  function renderVersions(){
    const el = S.ui?.querySelector(".an-vers");
    if (!el) return;
    const list = S.versions, i = list.findIndex((x) => x.id === S.asset?.id);
    if (list.length < 2 || i < 0){ el.hidden = true; el.innerHTML = ""; return; }
    const cand = carryCandidates();
    el.hidden = false;
    el.innerHTML = `<div class="an-vrow"><span>Version <b>${i + 1}</b> of ${list.length}</span>
        <button type="button" class="an-ib sm" data-ver="-1" title="Previous version"${i ? "" : " disabled"}>‹</button>
        <button type="button" class="an-ib sm" data-ver="1" title="Next version"${i < list.length - 1 ? "" : " disabled"}>›</button></div>
      ${cand.length ? `<div class="an-vrow carry"><span><b>${esc(S.prevOpen.asset.name)}</b> has ${cand.length} open note${cand.length > 1 ? "s" : ""}</span><button type="button" class="an-ib" data-act="carry" title="Copy them (with their drawings) onto this version">Copy here</button></div>` : ""}`;
    el.querySelectorAll("[data-ver]").forEach((b) => { b.onclick = () => { const t = list[i + Number(b.dataset.ver)]; if (t) host.openAsset?.(t.id); }; });
    const cb = el.querySelector("[data-act=carry]");
    if (cb) cb.onclick = () => carryOver();
  }
  // Copies the previous version's open notes and their drawings here (new ids, data.from points
  // at the original), scaled when the two versions differ in size. Video times and 3D views are
  // kept as they are.
  function carryOver(){
    const p = S.prevOpen, notes = carryCandidates();
    if (!p || !notes.length) return;
    const g = geom();
    const fx = g?.nw && p.asset.width ? g.nw / p.asset.width : 1;
    const fy = g?.nh && p.asset.height ? g.nh / p.asset.height : 1;
    const noteIds = new Set(notes.map((n) => n.id)), map = new Map();
    const src = p.rows.filter((r) => noteIds.has(r.id) || (r.kind !== "note" && r.kind !== "status" && noteIds.has(r.data?.note)));
    for (const r of src) map.set(r.id, uid());
    const made = [];
    for (const r of src){
      const it = { id: map.get(r.id), kind: r.kind, sub: r.shape_kind || null, z: r.z_index || 0, data: structuredClone(r.data || {}) };
      if (it.kind === "note"){
        it.data.from = { id: r.id, asset: p.asset.id, name: p.asset.name };
        it.data.shots = it.data.shots || [];
        // a copy is a new note: not the ShotGrid note of the old version (docs/SHOTGRID.md)
        delete it.data.sg;
        if (Array.isArray(it.data.replies)) it.data.replies = it.data.replies.map((x) => { if (x && x.sg){ const y = { ...x }; delete y.sg; return y; } return x; });
      } else {
        it.data.note = map.get(r.data.note);
        if (!validItem(it)) continue;
        if (Math.abs(fx - 1) > 1e-3 || Math.abs(fy - 1) > 1e-3){
          const snapIt = structuredClone(it);
          transformItem(it, snapIt, (x, y) => [x * fx, y * fy], { k: Math.sqrt(fx * fy), sx: fx, sy: fy });
        }
      }
      made.push(it);
    }
    commit(made.map((it) => it.id), () => { for (const it of made) S.items.set(it.id, it); });
    toast(`Copied ${notes.length} open note${notes.length > 1 ? "s" : ""} from <b>${esc(p.asset.name)}</b>`, 3000);
    renderVersions();
  }
  async function setStatus(state){
    if (!S.asset) return;
    const a = S.asset, was = S.status;
    S.status = state;
    paintStatus();
    try {
      const res = await host.api(`/api/assets/${a.id}/review-status`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ state, author: reviewer() }) });
      if (S.asset?.id === a.id && Array.isArray(res?.history)){ S.statusHist = res.history; paintStatus(); }
      host.onReviewChanged?.(a.id);
    } catch (e){
      console.warn(e);
      if (S.asset?.id === a.id){ S.status = was; paintStatus(); }
      toast("Could not save the review state");
    }
  }
  const STATE_LABEL = { review: "Needs review", changes: "Changes requested", approved: "Approved" };
  const histLine = (h) => `${STATE_LABEL[h.state] || "Cleared"}${h.author ? " by " + h.author : ""} · ${fmtDate(h.at)}`;
  // The review state's history ({state, author, at} per change, see Library.set_review_status):
  // the latest change under the switch, the whole list on click.
  function paintStatus(){
    S.ui?.querySelectorAll("[data-rs]").forEach((b) => b.classList.toggle("on", b.dataset.rs === S.status));
    const el = S.ui?.querySelector(".an-rsh");
    if (!el) return;
    const h = S.statusHist || [];
    el.hidden = !h.length;
    if (!h.length) return;
    const list = S.histOpen ? [...h].reverse() : [h[h.length - 1]];
    el.innerHTML = list.map((x) => `<div>${esc(histLine(x))}</div>`).join("")
      + (h.length > 1 ? `<button type="button" class="an-rsh-more">${S.histOpen ? "Less" : `History (${h.length})`}</button>` : "");
    el.querySelector(".an-rsh-more")?.addEventListener("click", () => { S.histOpen = !S.histOpen; paintStatus(); });
  }
  // ---- undo ----------------------------------------------------------------------------------
  const snap = (it) => (it ? structuredClone(it) : null);
  // Runs `mutate` and records one undo step for the objects in `ids` (new objects created inside
  // mutate must be listed too). `merge`: a key — consecutive commits with the same key within
  // 700 ms fold into one step (slider drags, nudges).
  function commit(ids, mutate, merge){
    const before = new Map(ids.map((id) => [id, snap(S.items.get(id))]));
    mutate();
    const after = new Map(ids.map((id) => [id, snap(S.items.get(id))]));
    const last = S.undo[S.undo.length - 1];
    const now = performance.now();
    if (merge && last && last.merge === merge && now - last.at < 700 && ids.every((id) => last.after.has(id))){
      for (const [id, v] of after) last.after.set(id, v);
      last.at = now;
    } else {
      S.undo.push({ before, after, merge, at: now });
      if (S.undo.length > 200) S.undo.shift();
    }
    S.redo.length = 0;
    for (const id of ids) persist(id, before.get(id), after.get(id));
    afterChange();
  }
  function persist(id, before, after){
    if (!after){ S.items.delete(id); S.sel.delete(id); serverDelete(id); return; }
    if (!before || !S.saved.has(id)) serverCreate(S.items.get(id));
    else serverUpdate(id);
  }
  // A drawing that an undo / redo takes off its note (its note: null again) goes into S.adopt: it counts as part of
  // the note being made (the compose mode, viewMode), as when it was drawn. (The next note takes it anyway: every
  // loose drawing goes in, pendingDrawings.)
  function applyStates(states){
    for (const [id, v] of states){
      const had = S.items.has(id);
      if (v && v.kind !== "note" && !v.data?.note && S.items.get(id)?.data?.note) S.adopt.add(id);
      if (!v){ if (had){ S.items.delete(id); S.sel.delete(id); serverDelete(id); } continue; }
      S.items.set(id, structuredClone(v));
      if (!S.saved.has(id)) serverCreate(S.items.get(id));
      else serverUpdate(id);
    }
  }
  function undo(){
    const e = S.undo.pop();
    if (!e){ toast("Nothing to undo"); return; }
    applyStates(e.before);
    // Undoing "add note": its screenshots and words go back to the composer, its drawings wait for the next note.
    if (e.added) composerBack(e.added, true);
    S.redo.push(e);
    afterChange();
  }
  function redo(){
    const e = S.redo.pop();
    if (!e){ toast("Nothing to redo"); return; }
    applyStates(e.after);
    if (e.added){
      composerBack(e.added, false);
      for (const id of e.after.keys()) S.adopt.delete(id);
      S.cleanPic = true;  // as when the note was added: its drawings are on its card
    }
    S.undo.push(e);
    afterChange();
  }
  // a: {text, cap, shots} of a note made by addNote. back = true: into the composer (a field already typed in
  // gets it on a new line, so nothing is lost); false (redo): out of it again when the field still holds it.
  function composerBack(a, back){
    const fields = [[S.ui?.querySelector(".an-input"), a.text || ""], [S.ui?.querySelector(".an-cin"), a.cap || ""]];
    if (back){
      for (const sid of a.shots) if (!S.pending.some((p) => p.id === sid)) S.pending.push({ id: sid, url: `/api/review/shots/${sid}` });
      for (const [f, v] of fields) if (f && v){ f.value = f.value.trim() ? f.value.trimEnd() + "\n" + v : v; f.style.height = "auto"; f.style.height = Math.min(160, f.scrollHeight + 2) + "px"; }
    } else {
      S.pending = S.pending.filter((p) => !a.shots.includes(p.id));
      for (const [f, v] of fields) if (f && v && f.value.trim() === v){ f.value = ""; f.style.height = ""; }
    }
    renderPending();
  }
  let notesSig = "", notesTimer = 0;
  function afterChange(){
    modeCache = null;
    const sig = [...S.items.values()].filter((it) => it.kind === "note").map((n) => n.id + (n.data.status || "")).join();
    if (sig !== notesSig){
      notesSig = sig;
      const id = S.asset?.id;
      clearTimeout(notesTimer);
      notesTimer = setTimeout(() => { flush().then(() => host.onReviewChanged?.(id)); }, 600);
    }
    rebuildViews();
    renderAll();
    renderSel();
    renderPanel();
    renderMarks();
    renderProps();
    paintBadge();
  }

  // ---- context (video time / 3D view) ---------------------------------------------------------
  const video = () => S.b2?.isVid ? S.b2.media : null;
  // A host with its own clock (the version compare: every clip follows a shared playhead) moves and stops the
  // video itself; the lightbox lets the annotator drive the element directly.
  const vidPause = (v) => { if (host.pauseVideo) host.pauseVideo(); else if (!v.paused) v.pause(); };
  const vidSeek = (v, t) => { if (host.seekVideo) host.seekVideo(t); else v.currentTime = t; };
  const frameDur = () => 1 / (S.fps || 25);
  // The frame on screen at time t is the one that started at or before it. A note / drawing made
  // there is stored at that frame's start + a hair (where stepping lands), so ctxVisible shows it on
  // exactly that frame and every client numbers it the same (same rule in mobile/js/app.js). With
  // the frame rate not known yet, the raw time is kept rather than snapped to a guessed rate.
  const frameStart = (t) => {
    if (!S.fpsKnown) return Math.round(t * 1000) / 1000;
    return Math.round((frameIndex(t) + 0.01) * frameDur() * 1000) / 1000;
  };
  // The frame t falls in. A stored time ((n + 0.01)·fd to 3 dp) can round a hair below n·fd at
  // 23.976 / 29.97 / 60 fps, so one is recognised and kept on its frame; others are floored (same
  // rule as mobile/js/model.js frameIndex).
  function frameIndex(t){
    const fd = frameDur(), k = Math.round(t / fd - 0.01);
    // Only a time with exactly 3 decimals can be a stored one (a player's own time never is).
    if (Math.abs(t * 1000 - Math.round(t * 1000)) < 1e-6 && Math.abs(t - Math.round((k + 0.01) * fd * 1000) / 1000) < 6e-4) return Math.max(0, k);
    return Math.floor(t / fd + 1e-6);
  }
  // Two stored times on the same frame (one may predate the known frame rate).
  const sameFrame = (a, b) => S.fpsKnown ? frameIndex(a) === frameIndex(b) : Math.abs(a - b) < 5e-4;
  // Where the player goes to show the frame of a stored time: a quarter into that frame (a stored
  // 0.100 at 29.97 fps is just before frame 3's start and would show frame 2).
  const landAt = (t) => S.fpsKnown ? (frameIndex(t) + 0.25) * frameDur() : t;
  const camMatch = RC.camMatch;  // shared with the phone app (review-core.js)
  // A view is a camera plus the meshes shown or hidden there: {vk, cam, hidden, v3d, explode, anim, created}.
  // anim is the animation pose ({clip, t}) of an animated model the view was made at (null: a static model or
  // an older file — any pose matches); like hidden it is fixed when the view is made.
  // hidden is the mesh indices hidden (null when the file predates it: any mesh state matches). The views
  // are kept in the order they were first made, so the number a view shows (viewNumber, the chips, the
  // pictures of a note, the report) does not depend on the order the items load in.
  // explode is the explode amount the view was last at: set by the slider (explodeChanged, kept in EXPL
  // for this session) or read from the newest new row made there (a row's ctx.explode). Older rows have
  // none. The newer of the two wins.
  const EXPL = new Map();      // vk -> {v, at}: the slider's last value at that view
  const EXP_TOL = 0.001;       // two explode amounts count as the same below this
  function rebuildViews(){
    const made = new Map(), prev = new Map(S.views), added = new Set();
    for (const it of S.items.values()){
      if (it.data?.ctx?.vk && (it.kind === "note" || it.data.note)) added.add(it.data.ctx.vk);
      const c = it.data.ctx;
      if (!c || !c.vk || !c.cam) continue;
      const at = it.data.created || 0;
      let v = made.get(c.vk);
      if (!v){ v = { vk: c.vk, cam: c.cam, hidden: null, v3d: null, explode: null, explodeAt: 0, anim: null, created: at }; made.set(c.vk, v); }
      if (!v.anim && c.anim && typeof c.anim === "object") v.anim = { clip: c.anim.clip | 0, t: Number(c.anim.t) || 0 };
      v.created = Math.min(v.created, at);
      if (Array.isArray(c.hidden) && (v.hidden == null || it.kind === "note")) v.hidden = c.hidden;
      // A note's display settings win over a drawing's bare camera (the last note's, as before).
      if (it.kind === "note" && c.v3d) v.v3d = c.v3d;
      // A note from before 0.42 has no row explode, but the viewer settings it was written with carry its amount.
      const e = typeof c.explode === "number" ? c.explode : (it.kind === "note" && typeof c.v3d?.explode === "number" ? c.v3d.explode : undefined);
      if (e !== undefined && at >= v.explodeAt){ v.explode = e; v.explodeAt = at; }
    }
    for (const v of made.values()){
      const r = EXPL.get(v.vk);
      if (r && r.at >= v.explodeAt){ v.explode = r.v; v.explodeAt = r.at; }
      // A view that holds added work keeps the amount it had (explodeChanged refuses to move it): a newer
      // row, e.g. a note just added, must not move the older notes on it (legacy ones have no explode of their own).
      const old = prev.get(v.vk);
      if (old && old.explode != null && added.has(v.vk)){ v.explode = old.explode; v.explodeAt = old.explodeAt; }
    }
    S.views.clear();
    for (const v of [...made.values()].sort((a, b) => a.created - b.created)) S.views.set(v.vk, v);
  }
  // The slider (or Ctrl+right-drag) moved at the view the camera is on: that view takes the amount, unless
  // it holds added work (a note, or a drawing attached to one) — those keep the amount they were made at.
  // A drawing not yet added takes the amount when its note is added (addNote). Only a user change lands
  // here; restoring a view or a note sets the amount without calling this.
  function explodeChanged(val){
    if (!S.b3 || typeof val !== "number") return;
    // The current view when it is the camera's (two views may share a camera, one per amount), else the camera's.
    const cam = curCam(), hid = curHidden();
    // No current view (the slider is on no view's amount): nothing to move, and a view is not picked by camera
    // alone, which would give it the new amount.
    const vk = viewMatches(S.views.get(S.curVk), cam, hid) ? S.curVk : null;
    if (!vk || viewCommitted(vk)) return;
    // The amount is another view's already (same camera): the slider moves onto that view, this one keeps its own.
    const other = findVk(cam, hid, val);
    if (other && other !== vk) return;
    const at = Date.now();
    EXPL.set(vk, { v: val, at });
    const v = S.views.get(vk);
    if (v){ v.explode = val; v.explodeAt = at; }
  }
  // Added work on a view: a note, or a drawing attached to one.
  function viewCommitted(vk){
    for (const it of S.items.values()) if (it.data?.ctx?.vk === vk && (it.kind === "note" || it.data.note)) return true;
    return false;
  }
  // Going to a view puts its explode back, replacing the current one. Exception: when a row on that view
  // was made at the current amount (not yet attached, or a note), the current amount stays.
  function viewExplode(vk){
    const v = S.views.get(vk);
    if (!v || v.explode == null) return;
    const cur = host.getV3D?.()?.explode ?? 0;
    if (Math.abs(cur - v.explode) < EXP_TOL) return;
    for (const it of S.items.values()){
      const c = it.data?.ctx;
      if (c && c.vk === vk && typeof c.explode === "number" && Math.abs(c.explode - cur) < EXP_TOL) return;
    }
    host.setV3D?.({ explode: v.explode });
  }
  // The settings a picture or export is shown with: the given shading / lights (a note's), and the explode
  // `ex` it is taken at (the note's or its drawing's own, see explodeOf; the look's own when none is given).
  function viewLook(look, ex){
    const { explode, ...rest } = look || {};
    const e = ex ?? explode;
    return e != null ? { ...rest, explode: e } : rest;
  }
  // The explode a note's picture of a view is taken at: the one its own rows on that view were made at, so
  // an added note keeps its look whatever the slider says now. A note from before 0.42 has no row explode,
  // but its viewer settings (v3d) were saved with the explode it was made at. undefined when neither is
  // there (the view's amount is used then).
  function explodeOf(vk, rows){
    for (const it of rows){
      const c = it.data?.ctx;
      if (!c || c.vk !== vk) continue;
      if (typeof c.explode === "number") return c.explode;
      if (it.kind === "note" && typeof c.v3d?.explode === "number") return c.v3d.explode;
    }
    return undefined;
  }
  function curCam(){ return S.b3?.getCam?.() || null; }
  // The meshes hidden right now (sorted indices), null with no 3D host or no inspector.
  function curHidden(){ return S.b3?.getHidden?.() ?? null; }
  // The animation pose now ({clip, t}), null for a model without animation.
  function curAnim(){ return S.b3?.getAnim?.() ?? null; }
  // Two mesh states match; an unknown one (null) matches any.
  const sameHidden = (a, b) => a == null || b == null || (a.length === b.length && a.every((x, i) => x === b[i]));
  const viewMatches = (v, cam, hid, an = curAnim()) => !!v && camMatch(cam, v.cam) && sameHidden(v.hidden, hid) && RC.animMatch(v.anim, an);
  // Another explode amount is another view: a view with no amount (or a call with none) matches any.
  const explodeSame = (v, ex) => v.explode == null || typeof ex !== "number" || Math.abs(v.explode - ex) < EXP_TOL;
  // `ex` is the explode amount to match; undefined matches the camera and meshes only.
  // An exact amount wins over a view with no amount (a legacy one), whatever the order they were made in.
  function findVk(cam, hid = curHidden(), ex){
    if (!cam) return null;
    let loose = null;
    for (const v of S.views.values()){
      if (!viewMatches(v, cam, hid) || (ex !== undefined && !explodeSame(v, ex))) continue;
      if (ex === undefined || v.explode != null) return v.vk;
      if (loose == null) loose = v.vk;
    }
    return loose;
  }
  // The context a new object gets right now. `make` is set only where an object is really created:
  // showing the context (the panel's pending line, which runs on every camera move) must not register
  // a view, or each camera position would become a "View N" with no drawing in it.
  function ctxNow(forNote, make = false){
    // A board note keeps where the camera was (bv: the board rectangle on screen, world units — the 3D view's
    // counterpart): its picture shows that rectangle, a click on it flies the camera back. Drawings need none.
    if (isBoard()){
      const r = forNote ? host.boardView?.() : null;
      return r ? { bv: r } : null;
    }
    if (S.kind === "video"){
      const v = video();
      if (!v) return null;
      return { t: frameStart(v.currentTime), hold: S.hold };
    }
    if (S.kind === "model3d"){
      const cam = curCam();
      if (!cam) return null;
      const hid = curHidden();
      // A view is a camera, its hidden meshes and an explode amount: a new row at another amount is another view.
      const live = host.getV3D?.() || null;
      const ex = typeof live?.explode === "number" ? live.explode : undefined;
      const cur = S.views.get(S.curVk);
      let vk = viewMatches(cur, cam, hid) && explodeSame(cur, ex) ? S.curVk : findVk(cam, hid, ex);
      if (!vk){
        if (!make) return { vk: null, cam };
        vk = uid(); S.views.set(vk, { vk, cam, hidden: hid, v3d: null, explode: ex ?? null, explodeAt: 0, anim: curAnim(), created: Date.now() }); S.curVk = vk;
      }
      const view = S.views.get(vk);
      const c = { vk, cam: view.cam };
      if (view.hidden) c.hidden = view.hidden;
      if (view.anim) c.anim = { clip: view.anim.clip, t: view.anim.t };
      // A new row records the explode it was made at (old rows have none, and keep none).
      if (ex !== undefined) c.explode = ex;
      if (forNote) c.v3d = live;
      return c;
    }
    return null;
  }
  // A drawing made on a reply (data.reply, FORMAT.md) goes with that reply: it disappears when the
  // reply is deleted (here or in a merged review file) and while its eye toggle is off.
  function replyGone(it){
    const rid = it.data.reply;
    if (!rid) return false;
    const r = (S.items.get(it.data.note)?.data.replies || []).find((x) => x.id === rid);
    return !!r?.deleted;
  }
  // The base rule: the drawing's frame / view is on screen, its reply is neither hidden nor
  // deleted, and its note (if it has one) still exists — a drawing of a deleted note never shows.
  function ctxShown(it){
    if (it.data.reply && (S.hiddenReplies.has(it.data.reply) || replyGone(it))) return false;
    if (it.data.note && S.items.get(it.data.note)?.kind !== "note") return false;
    return RC.ctxVisible(it.data.ctx, frameNow());
  }
  // What the media shows besides that (viewMode, worked out once per change):
  //   compose — a new note is being made (its field focused or filled, a drawing being drawn, or
  //             drawings / screenshots waiting for it): only what goes with the new note, a clean
  //             picture otherwise;
  //   pin     — a note picked in the panel (a click on its card or a preview frame): only its drawings.
  // Hovering a card changes nothing on the picture.
  let modeCache = null;
  function viewMode(){
    if (modeCache) return modeCache;
    const inp = S.ui && !S.ui.hidden ? S.ui.querySelector(".an-input") : null, D = S.drag;
    const cin = S.ui && !S.ui.hidden ? S.ui.querySelector(".an-cin") : null;
    // Loose drawings from before (never attached to a note) do not count: only the ones drawn since
    // this file was opened are a new note in the making.
    const compose = !!(inp && (document.activeElement === inp || inp.value.trim())) || !!(cin && (document.activeElement === cin || cin.value.trim())) || !!(D && (D.stroke || D.shape)) || !!(S.edit && S.edit.isNew)
      || S.pending.length > 0 || [...S.items.values()].some((it) => isDrawing(it) && !it.data.note && ((it.data.created || 0) >= S.composeSince || S.adopt.has(it.id)));
    const note = (id) => (id && S.items.get(id)?.kind === "note" ? id : null);
    // With onion skin on, a picked note does not narrow what shows (its frame is sought, every drawing keeps its
    // ghost): picking notes in the panel must not break the onion view.
    const pin = note(S.pinFocus);
    // (While a new note is in the making the pick still narrows: the picked note's drawings must show then.)
    modeCache = { compose, pin: onionOn() && !compose ? null : pin };
    // S.cleanPic (set by addNote) lasts until the next compose or pick.
    if (compose || pin) S.cleanPic = false;
    queueMicrotask(() => { modeCache = null; });
    return modeCache;
  }
  function modeAllows(it){
    if (!it.data.note) return true;
    const m = viewMode();
    if (!S.on && !isBoard()) return m.pin ? it.data.note === m.pin : true;   // just watching: all, or the picked note's
    // A board shows every drawing all the time (no "clean picture" while a note is made); only a picked note
    // narrows it to that note's drawings.
    if (isBoard()) return m.pin ? it.data.note === m.pin : true;
    // Right after a note is made the picture is clean: its drawings are on its card. A note's drawings
    // come back only when that note is picked (a click).
    if (S.cleanPic && m.pin !== it.data.note) return false;
    // A picked note's drawings show even while a new note is being drawn (the pick is what the user asked for).
    if (m.pin) return it.data.note === m.pin;
    return !m.compose;
  }
  function visibleNow(it){ return ctxShown(it) && modeAllows(it); }
  // The view mode may have changed (typing started, a note picked): repaint what shows.
  function modeChanged(){ modeCache = null; if (!S.layer) return; paintVisibility(); renderSel(); renderPending(); }
  // The frame on screen, as review-core's ctxVisible takes it.
  // The frame on screen is the one that started at or before the time (frameStart), the same time a new
  // drawing is stored at. The raw time would sit in the frame's second half after a timeline scrub, and
  // ctxVisible's window (centred on the stored time) would then hide that frame's drawings until the
  // time moved again.
  function frameNow(){
    if (S.kind === "video"){ const v = video(); return v ? { t: frameStart(v.currentTime), fps: S.fps } : null; }
    if (S.kind === "model3d") return { vk: S.curVk || null };
    return null;
  }
  // Onion skin (video; toggled on the eye — right-click / long-press — kept with the settings): between two frames that carry drawings, the last one's drawings fade out and
  // the next one's fade in as the playhead moves from one to the other (a cross-fade over the gap). Before the first /
  // after the last annotated frame the drawings fade in / out over ONION_EDGE seconds. Returns id → opacity (0..1)
  // for the drawings not on screen by their own frame; null when onion skin is off.
  const ONION_EDGE = 1.0;
  // (Not in the version compare: no eye there to turn it off — host.showWhileWatching false.)
  const onionOn = () => S.onion && S.kind === "video" && !!video() && host.showWhileWatching !== false;
  function onionFade(){
    const v = video();
    if (!onionOn()) return null;
    const fd = 1 / (S.fps || 25), t = frameStart(v.currentTime), eps = fd / 2;
    const spans = [];
    for (const it of S.items.values()){
      if (!isDrawing(it)) continue;
      const c = it.data.ctx;
      if (!c || c.t == null || c.hold === -1) continue;   // (a drawing held for the whole clip is always on)
      if (it.data.reply && (S.hiddenReplies.has(it.data.reply) || replyGone(it))) continue;
      if (it.data.note && S.items.get(it.data.note)?.kind !== "note") continue;
      if (!modeAllows(it)) continue;
      spans.push({ id: it.id, s: c.t, e: c.t + Math.max(c.hold || 0, fd) });
    }
    // Groups by start frame, in time order. The group that started last (k) is the "current" one: while one of its
    // drawings is on its own frame it shows as usual; after its own span it fades out towards group k+1, which fades
    // in once the whole group k is over (or k fades over ONION_EDGE when it is the last). Before the first group,
    // that one fades in over ONION_EDGE. Earlier groups are done: a later start ends their ghosts.
    const groups = [];
    for (const x of spans.sort((a, b) => a.s - b.s)){
      const g = groups[groups.length - 1];
      if (g && Math.abs(x.s - g.s) <= eps){ g.list.push(x); g.e = Math.max(g.e, x.e); }
      else groups.push({ s: x.s, e: x.e, list: [x] });
    }
    const out = new Map();
    if (!groups.length) return out;
    const clamp01 = (v) => Math.min(1, Math.max(0, v));
    let k = -1;
    for (let i = 0; i < groups.length; i++) if (groups[i].s <= t + eps) k = i;
    if (k < 0){   // before the first annotated frame
      const p = clamp01(1 - (groups[0].s - t) / (ONION_EDGE + fd));
      for (const x of groups[0].list) out.set(x.id, p);
      return out;
    }
    const cur = groups[k], next = groups[k + 1];
    // How far from an end (seconds after it, counted in frames) to the next group / the edge, 0..1.
    const prog = (end) => clamp01((t + fd - end) / ((next ? next.s - end : ONION_EDGE) + fd));
    for (const x of cur.list) if (x.e <= t + eps) out.set(x.id, 1 - prog(x.e));
    // A drawing of an earlier group held past the current group's start fades out from its own end too (over the
    // edge time) instead of vanishing when its hold runs out.
    for (const g of groups.slice(0, k)) for (const x of g.list){
      if (x.e > cur.s + eps && x.e <= t + eps){ const p = clamp01((t + fd - x.e) / (ONION_EDGE + fd)); if (p < 1) out.set(x.id, 1 - p); }
    }
    if (next && cur.e <= t + eps){ const p = prog(cur.e); for (const x of next.list) out.set(x.id, p); }
    return out;
  }
  function ctxLabel(c){
    if (!c) return "";
    if (c.t != null) return fmtTime(c.t, S.fps) + "  ·  f " + Math.round(c.t * S.fps);
    if (c.vk) return "View " + (viewNumber(c.vk) || "");
    return "";
  }
  function viewNumber(vk){ return [...S.views.keys()].indexOf(vk) + 1; }
  // The frames a video note stands on (RC.noteTimes, 0.47+): its own drawings' frames and the frames
  // with a picture text of it — not the frame it was written on (a text-only note keeps that one when
  // `fallback`, so it is still on the timeline).
  function noteFrames(n, fallback = true){
    const ts = [];
    for (const it of S.items.values()) if (isDrawing(it) && it.data.note === n.id && !it.data.reply && it.data.ctx?.t != null) ts.push(it.data.ctx.t);
    return RC.noteTimes(n.data, ts, sameFrame, fallback);
  }
  // Where a note's card points: its first frame (video), else its own place (3D view).
  function noteCtx(n){
    if (S.kind !== "video") return n.data.ctx || null;
    const t = noteFrames(n)[0];
    return t != null ? { t } : null;
  }

  function notesSorted(){
    const notes = [...S.items.values()].filter((it) => it.kind === "note");
    // By when they were made, videos too (not by frame): a new note always lands at the end, and
    // the phone app / HTML page number them the same (mobile/js/model.js notesSorted).
    notes.sort((a, b) => (a.data.created || 0) - (b.data.created || 0));
    return notes;
  }
  function numOf(it){
    // Not attached yet: the number its note will get (a new note always lands at the end).
    // (addNote takes every loose drawing, old ones too, so each loose pin is the next note's.)
    if (!it.data.note) return it.data.reply ? "" : notesSorted().length + 1;
    const i = notesSorted().findIndex((n) => n.id === it.data.note);
    return i >= 0 ? i + 1 : "";
  }

  // ---- surface (doc <-> screen) --------------------------------------------------------------
  function geom(){
    if (S.b2){
      const g = S.b2.geom();
      return { ox: g.x0, oy: g.y0, s: g.s || 1, w: S.b2.wrap.clientWidth, h: S.b2.wrap.clientHeight, nw: g.w, nh: g.h };
    }
    if (S.b3){
      const w = S.b3.host.clientWidth, h = S.b3.host.clientHeight;
      return { ox: w / 2, oy: h / 2, s: h / 1000 || 1, w, h };
    }
    return null;
  }
  const surfaceEl = () => S.b2?.wrap || S.b3?.host || null;
  // The pointer in the surface's px, in the viewer's unturned frame (the lightbox can turn /
  // mirror the view; the layer turns with the picture, so everything below works unturned).
  function local(e){
    const r = surfaceEl().getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    return S.b2?.unturn ? S.b2.unturn(x, y) : [x, y];
  }
  function toDoc(e){
    const g = geom(), [x, y] = local(e);
    return [(x - g.ox) / g.s, (y - g.oy) / g.s];
  }
  function toScreen(x, y){ const g = geom(); return [g.ox + x * g.s, g.oy + y * g.s]; }
  const k = () => 1 / (geom()?.s || 1); // doc units per screen px

  // ---- layers ---------------------------------------------------------------------------------
  function ensureLayer(){
    const el = surfaceEl();
    if (!el) return null;
    if (S.layer?.root?.isConnected && S.layer.root.parentNode === el) return S.layer;
    S.layer?.root.remove();
    // A rebind that dropped S.layer without removing the node left a second copy of every drawing.
    el.querySelectorAll(":scope > .an-layer").forEach((n) => n.remove());
    const root = document.createElement("div");
    root.className = "an-layer";
    root.innerHTML = `<svg class="an-doc" xmlns="${SVGNS}"></svg><svg class="an-ui" xmlns="${SVGNS}"></svg>`;
    el.appendChild(root);
    S.layer = { root, doc: root.firstElementChild, ui: root.lastElementChild, els: new Map() };
    return S.layer;
  }
  function syncViewBox(){
    const L = S.layer, g = geom();
    if (!L || !g) return;
    L.doc.setAttribute("viewBox", `${r2(-g.ox / g.s)} ${r2(-g.oy / g.s)} ${r2(g.w / g.s)} ${r2(g.h / g.s)}`);
    L.ui.setAttribute("viewBox", `0 0 ${g.w} ${g.h}`);
    const tc = S.b2 ? S.b2.geom().turn || "" : "";
    if (L.root.style.transform !== tc){ L.root.style.transformOrigin = "0 0"; L.root.style.transform = tc; }
  }
  function renderItem(it){
    const L = S.layer;
    if (!L) return;
    let g = L.els.get(it.id);
    if (!g){ g = document.createElementNS(SVGNS, "g"); g.dataset.id = it.id; L.els.set(it.id, g); }
    g.innerHTML = primsOf(it, numOf).map(primSvg).join("");
    g.__z = it.z;
  }
  // Drawings stay on show (not editable) with annotating off: always on a board; on a picture / video during
  // ordinary viewing / playback unless the eye (S.hidden) hides them. 3D too (the camera moves them: followOff ticks).
  // (Not in the version compare: host.showWhileWatching false — it has no eye of its own.)
  const shownOff = () => isBoard() || (host.showWhileWatching !== false && ((!!S.b2 && (S.kind === "image" || S.kind === "video" || S.kind === "psd")) || (!!S.b3 && S.kind === "model3d")));
  // Drawings that can show at all (a deleted / hidden reply's or a deleted note's never do): the eye's subject.
  const hasDrawings = () => {
    for (const it of S.items.values()){
      if (!isDrawing(it) || (it.data.reply && (S.hiddenReplies.has(it.data.reply) || replyGone(it)))) continue;
      if (it.data.note && S.items.get(it.data.note)?.kind !== "note") continue;
      return true;
    }
    return false;
  };
  // A playing video's drawings follow its frame with the mode off: the tick runs only then (a paused one restarts
  // it on play / seek — bind2d). A still picture or a board follows the view through viewChanged.
  const followOff = () => !S.on && !isBoard() && shownOff() && !S.hidden && !!S.layer?.els.size && (!!S.b3 || (!!S.b2?.isVid && !S.b2.media.paused && !S.b2.media._blip));   // _blip: index.html's scrub-audio run, no playback
  function renderAll(){
    const L = S.on || shownOff() ? ensureLayer() : S.layer;
    if (!L) return;
    syncViewBox();
    const list = [...S.items.values()].filter(isDrawing).sort((a, b) => a.z - b.z);
    const keep = new Set(list.map((it) => it.id));
    for (const [id, g] of L.els) if (!keep.has(id)){ g.remove(); L.els.delete(id); }
    for (const it of list){ renderItem(it); L.doc.appendChild(L.els.get(it.id)); }
    paintVisibility();
    L.root.hidden = !S.on && !shownOff();  // shown, not editable, while annotation is off (shownOff)
    paintStamp();
    paintBadge();
    if (followOff()) startTick();   // a playing video's drawings follow its frame
  }
  function paintVisibility(){
    const L = S.layer;
    if (!L) return;
    modeCache = null;
    const m = viewMode();
    // Onion skin is a way of viewing the drawings (the eye's right-click / long-press): drawing or watching.
    const fade = !S.hidden ? onionFade() : null;
    for (const [id, g] of L.els){
      const it = S.items.get(id);
      if (!it) continue;
      const vis = !S.hidden && visibleNow(it);
      const op = !vis && fade ? fade.get(id) : undefined;
      const ghost = op != null && op > 0.02;
      g.style.display = vis || ghost ? "" : "none";
      g.style.opacity = ghost ? String(Math.round(op * 100) / 100) : "";
    }
    // What the view mode hides must not stay selected: Delete / nudge / copy would act on it unseen.
    let unsel = false;
    for (const id of S.sel){ const it = S.items.get(id); if (!it || !visibleNow(it)){ S.sel.delete(id); unsel = true; } }
    if (unsel && !S.drag){ renderSel(); renderProps(); }
  }
  const visibleDrawings = () => [...S.items.values()].filter((it) => isDrawing(it) && visibleNow(it));
  // "On screen" for Select all / Clear: a picture / frame / view shows all of its drawings; a board is bigger than
  // the window, so only the drawings that touch the visible part of it count.
  function shownDrawings(){
    const list = visibleDrawings();
    const g = isBoard() ? geom() : null;
    if (!g) return list;
    const x0 = -g.ox / g.s, y0 = -g.oy / g.s, x1 = x0 + g.w / g.s, y1 = y0 + g.h / g.s;
    return list.filter((it) => { const b = boundsOf(it); return b[2] >= x0 && b[0] <= x1 && b[3] >= y0 && b[1] <= y1; });
  }
  // The one gate for "may this drawing be edited?". 0.45.0 locked every drawing added to a note; 0.46.1 lifted
  // that: every drawing is editable again. A future lock (an artist may not edit a supervisor's notes, only answer
  // with their own; nothing of a resolved note changes) goes here: a `baked` drawing can still be selected and
  // deleted from the frame, but not moved, reshaped, restyled, nudged, reordered, partly erased or retyped
  // (onDown, editSel, eraseAt, nudge, reorder, setProp, the text tool and dblclick all ask `editable`).
  const baked = (_it) => false;
  const editable = (it) => !!it && !baked(it);

  // ---- selection overlay ----------------------------------------------------------------------
  // The selected objects on screen now: the ones the handles (review-core xf*) work on.
  const selVisible = () => [...S.sel].map((id) => S.items.get(id)).filter((it) => it && visibleNow(it));
  // The selected drawings that may be edited (no handles on a baked one).
  const editSel = () => selVisible().filter(editable);
  // Handles in screen px: [id, x, y] (review-core xfHandles, mapped from doc units).
  function handles(){
    if (cropItem()) return [];  // a reference image being cropped has the crop grips instead (cropHandles)
    return RC.xfHandles(editSel(), k(), S.drag?.xf).map(([id, x, y]) => [id, ...toScreen(x, y)]);
  }
  function renderSel(){
    const L = S.layer;
    if (!L) return;
    syncViewBox();
    // Handles and the box are for the editable selection; a baked drawing (selected for Delete) gets a dashed outline.
    const ci = cropItem();
    let html = ci ? cropSvg(ci) : RC.xfSvg(editSel(), { px: k(), u: 1, map: toScreen, D: S.drag?.xf });
    for (const it of selVisible()){
      if (!baked(it)) continue;
      const b = boundsOf(it), a = toScreen(b[0], b[1]), c = toScreen(b[2], b[3]);
      html += `<rect fill="none" stroke="#4c9aff" stroke-width="1" stroke-dasharray="3 3" x="${r2(Math.min(a[0], c[0]))}" y="${r2(Math.min(a[1], c[1]))}" width="${r2(Math.abs(c[0] - a[0]))}" height="${r2(Math.abs(c[1] - a[1]))}"/>`;
    }
    if (S.drag?.marquee){
      const m = S.drag.marquee;
      html += `<rect class="an-marquee" x="${r2(Math.min(m[0], m[2]))}" y="${r2(Math.min(m[1], m[3]))}" width="${r2(Math.abs(m[2] - m[0]))}" height="${r2(Math.abs(m[3] - m[1]))}"/>`;
    }
    if (S.region?.rect){
      const m = S.region.rect, g = geom();
      const x = Math.min(m[0], m[2]), y = Math.min(m[1], m[3]), w = Math.abs(m[2] - m[0]), h = Math.abs(m[3] - m[1]);
      html += `<path class="an-regionshade" d="M0 0H${g.w}V${g.h}H0Z M${x} ${y}v${h}h${w}v${-h}Z"/><rect class="an-region" x="${x}" y="${y}" width="${w}" height="${h}"/><text class="an-regionlbl" x="${x + 4}" y="${y - 6}">${Math.round(w)} × ${Math.round(h)}</text>`;
    }
    // The brush circle: shown while drawing too (it follows the pointer), hidden while Alt moves the camera.
    if (S.drag?.sizeOp) html += sizeOpSvg(S.drag);
    else if (S.hover && !S.region && !altCam()){
      const t = effTool(), st = S.styles[t];
      if (!S.drag?.eraser && (freehand(t) || t === "eraser")){
        const r = Math.max(1, (st.size ?? st.width ?? 2) / 2);
        html += `<circle class="an-cursor${t === "eraser" ? " er" : ""}" cx="${r2(S.hover[0])}" cy="${r2(S.hover[1])}" r="${r2(r)}"/>`;
      }
    }
    if (S.drag?.eraser && S.hover && !altCam()){
      html += `<circle class="an-cursor er" cx="${r2(S.hover[0])}" cy="${r2(S.hover[1])}" r="${r2(Math.max(1, S.styles.eraser.size / 2))}"/>`;
    }
    L.ui.innerHTML = html;
  }

  // ---- pointer input --------------------------------------------------------------------------
  function hitAt(x, y, tolPx = 6){
    const tol = tolPx * k();
    const list = visibleDrawings().sort((a, b) => b.z - a.z);
    return list.find((it) => hitTest(it, x, y, tol)) || null;
  }
  function handleAt(sx, sy){
    for (const [id, x, y] of handles()) if (hyp(sx - x, sy - y) <= 8) return id;
    return null;
  }
  const nextZ = () => Math.max(0, ...[...S.items.values()].map((it) => it.z || 0)) + 1;

  function newItem(kind, sub, data){
    return { id: uid(), kind, sub, z: nextZ(), data: { ...data, ctx: ctxNow(false, true), note: null, created: Date.now() } };
  }
  function styleDoc(t){
    // Tool style converted to doc units.
    const st = { ...S.styles[t] }, kk = k();
    for (const key of LEN_KEYS) if (key in st) st[key] = st[key] * kk;
    return st;
  }

  // ---- reference images: adding, cropping ------------------------------------------------------
  // The reference image being cropped (S.crop: its id) — only while it is the one selected, visible and editable.
  function cropItem(){
    const it = S.crop ? S.items.get(S.crop) : null;
    return it && typeOf(it) === "image" && S.sel.size === 1 && S.sel.has(it.id) && visibleNow(it) && editable(it) ? it : null;
  }
  function startCrop(){
    const sel = editSel();
    if (sel.length !== 1 || typeOf(sel[0]) !== "image") return false;
    if (S.tool !== "select") setTool("select");
    S.crop = sel[0].id;
    toast("Crop: drag an edge or corner · drag inside to move the picture · Enter or Esc when done", 2600);
    renderSel(); renderProps();
    if (S.hover) updateCursor(...S.hover);
    return true;
  }
  function endCrop(){
    if (!S.crop) return false;
    S.crop = null;
    renderSel(); renderProps();
    if (S.hover) updateCursor(...S.hover);
    return true;
  }
  // [handle, sx, sy] of the crop window's corners and edges, in screen px.
  function cropHandles(it){
    const F = cropFrame(it.data), c = RC.imgCrop(it.data), l = c[0], t = c[1], r = c[0] + c[2], b = c[1] + c[3], mx = (l + r) / 2, my = (t + b) / 2;
    return [["nw", l, t], ["n", mx, t], ["ne", r, t], ["e", r, my], ["se", r, b], ["s", mx, b], ["sw", l, b], ["w", l, my]]
      .map(([h, nx, ny]) => [h, ...toScreen(...fromImg(F, nx, ny))]);
  }
  // What a press at (sx, sy) screen / (x, y) doc does to the image being cropped: a grip, "pan" (inside), or null.
  function cropAt(it, sx, sy, x, y){
    const fing = S.lastPtr === "touch" ? 18 : 10;
    const h = cropHandles(it).find(([, hx, hy]) => hyp(sx - hx, sy - hy) <= fing);
    if (h) return h[0];
    const [nx, ny] = toImg(cropFrame(it.data), x, y), c = RC.imgCrop(it.data);
    return nx >= c[0] && nx <= c[0] + c[2] && ny >= c[1] && ny <= c[1] + c[3] ? "pan" : null;
  }
  // The crop overlay: the whole picture dimmed, the kept part at full strength, its outline and grips.
  function cropSvg(it){
    const d = it.data, F = cropFrame(d), c = RC.imgCrop(d), u = RC.imageUrl(d.shot);
    const P = (nx, ny) => toScreen(...fromImg(F, nx, ny));
    const p0 = P(0, 0), p1 = P(1, 0), p2 = P(0, 1);
    const m = `matrix(${[p1[0] - p0[0], p1[1] - p0[1], p2[0] - p0[0], p2[1] - p0[1], p0[0], p0[1]].map((v) => Math.round(v * 1000) / 1000).join(" ")})`;
    const vb = c.map((v) => Math.round(v * 1e5) / 1e5).join(" ");
    let h = "";
    if (u){
      h += `<g transform="${m}" opacity="0.38"><image href="${esc(u)}" x="0" y="0" width="1" height="1" preserveAspectRatio="none"/></g>`;
      h += `<g transform="${m}"><svg x="${c[0]}" y="${c[1]}" width="${c[2]}" height="${c[3]}" viewBox="${vb}" preserveAspectRatio="none" overflow="hidden"><image href="${esc(u)}" x="0" y="0" width="1" height="1" preserveAspectRatio="none"/></svg></g>`;
    }
    const poly = (pts, extra) => `<polygon points="${pts.map((q) => r2(q[0]) + "," + r2(q[1])).join(" ")}" fill="none" stroke="#4c9aff" ${extra}/>`;
    h += poly([P(0, 0), P(1, 0), P(1, 1), P(0, 1)], 'stroke-width="1" stroke-dasharray="4 3"');
    h += poly([P(c[0], c[1]), P(c[0] + c[2], c[1]), P(c[0] + c[2], c[1] + c[3]), P(c[0], c[1] + c[3])], 'stroke-width="1.5"');
    const z = S.lastPtr === "touch" ? 1.6 : 1;
    for (const [, x, y] of cropHandles(it)) h += `<rect x="${r2(x - 5 * z)}" y="${r2(y - 5 * z)}" width="${r2(10 * z)}" height="${r2(10 * z)}" fill="#fff" stroke="#4c9aff" stroke-width="1.5"/>`;
    return h;
  }
  // A crop gesture: a grip moves that edge of the window (the picture stays put), "pan" slides the picture
  // inside the window (the box stays put). Both from the frame / window the gesture started with.
  function cropDrag(D, x, y){
    const it = S.items.get(D.id);
    if (!it) return;
    const [nx, ny] = toImg(D.F, x, y), c = D.c0;
    if (!D.moved && hyp((nx - D.n0[0]) * D.F.sx, (ny - D.n0[1]) * D.F.sy) / k() < 2) return;  // a click is not a crop
    D.moved = true;
    if (D.crop === "pan"){
      const l = clamp(c[0] - (nx - D.n0[0]), 0, 1 - c[2]), t = clamp(c[1] - (ny - D.n0[1]), 0, 1 - c[3]);
      it.data.crop = [l, t, c[2], c[3]].map((v) => Math.round(v * 1e5) / 1e5);
      if (!(l > 1e-4 || t > 1e-4 || c[2] < 1 - 1e-4 || c[3] < 1 - 1e-4)) it.data.crop = null;
    } else {
      const h = D.crop, mx = 12 * k() / D.F.sx, my = 12 * k() / D.F.sy;
      let l = c[0], t = c[1], r = c[0] + c[2], b = c[1] + c[3];
      if (h.includes("w")) l = clamp(nx, 0, r - mx);
      if (h.includes("e")) r = clamp(nx, l + mx, 1);
      if (h.includes("n")) t = clamp(ny, 0, b - my);
      if (h.includes("s")) b = clamp(ny, t + my, 1);
      applyCrop(it.data, D.F, [l, t, r - l, b - t]);
    }
    renderItem(it);
    renderSel();
  }
  function resetCrop(){
    const it = editSel().find((x) => typeOf(x) === "image" && x.data.crop);
    if (!it) return;
    commit([it.id], () => { const d = it.data; applyCrop(d, cropFrame(d), [0, 0, 1, 1]); });
  }
  // One picture (a File / Blob, or a URL of the library's own file) scaled to REF_MAX and stored as a shot.
  async function storeRef(src, alpha){
    const url = typeof src === "string" ? src : URL.createObjectURL(src);
    try {
      const im = new Image();
      im.decoding = "async";
      im.src = url;
      await im.decode();
      let nw = im.naturalWidth || im.width, nh = im.naturalHeight || im.height;
      if (!nw || !nh){ nw = 1024; nh = 1024; }  // an SVG with only a viewBox has no size of its own
      const sc = Math.min(1, REF_MAX / Math.max(nw, nh));
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(nw * sc)); cv.height = Math.max(1, Math.round(nh * sc));
      cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height);
      const type = alpha ? "image/png" : "image/jpeg";
      const blob = await new Promise((res) => cv.toBlob(res, type, 0.9));
      if (!blob) throw new Error("encode failed");
      const r = await host.api("/api/review/shots", { method: "POST", headers: { "content-type": type }, body: blob });
      return { id: r.id, w: cv.width, h: cv.height };
    } finally {
      if (typeof src !== "string") URL.revokeObjectURL(url);
    }
  }
  const refsAllowed = () => supported() && !isBoard() && host.refImages !== false;
  // Adds pictures to the frame / view on screen as reference images, centred on `at` (doc units; null = the
  // middle of the view), each one fitted into a third of the view. srcs: [{src: File | URL, alpha}].
  async function addRefs(srcs, at){
    if (!srcs.length || !refsAllowed() || !surfaceEl()) return;
    if (!S.on && !toggle(true)) return;
    finishEdit();
    if (S.kind === "video"){ const v = video(); if (v) vidPause(v); }  // they belong to the frame they were dropped on
    if (S.b3) S.b3.pauseAnim?.();
    const aid = S.asset?.id, ctx = ctxNow(false, true);  // the frame / view they were dropped on, whatever happens meanwhile
    toast(srcs.length > 1 ? `Adding ${srcs.length} pictures…` : "Adding the picture…", 8000);
    const made = [];
    for (const x of srcs){ try { made.push(await storeRef(x.src, x.alpha)); } catch (e){ console.warn(e); } }
    if (S.asset?.id !== aid || !surfaceEl() || !S.on) return;   // another file / the mode left meanwhile
    if (!made.length){ toast("Could not read the picture"); return; }
    const g = geom(), vw = g.w / g.s, vh = g.h / g.s;
    let [cx, cy] = at || [(g.w / 2 - g.ox) / g.s, (g.h / 2 - g.oy) / g.s];
    const st = styleDoc("image"), its = [];
    for (const m of made){
      const f = Math.min(vw * 0.34 / m.w, vh * 0.34 / m.h), w = m.w * f, h = m.h * f;
      its.push(newItem("image", null, { shot: m.id, x: cx - w / 2, y: cy - h / 2, w, h, rot: 0, crop: null, iw: m.w, ih: m.h, border: st.border, borderColor: st.borderColor, shadow: st.shadow, opacity: st.opacity }));
      cx += 24 * k(); cy += 24 * k();
    }
    for (const it of its) it.data.ctx = ctx && typeof ctx === "object" ? structuredClone(ctx) : ctx;
    if (S.pinFocus){ S.pinFocus = null; renderPanel(); }
    commit(its.map((it) => it.id), () => { for (const it of its) S.items.set(it.id, it); });
    setTool("select");
    S.sel = new Set(its.map((it) => it.id));
    renderSel(); renderProps();
    toast(made.length < srcs.length ? `Added ${made.length} of ${srcs.length} — the rest could not be read` : made.length > 1 ? `${made.length} pictures added` : "Picture added", 1600);
  }
  function pickRefs(at){
    if (!refsAllowed()) return;
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*"; inp.multiple = true;
    inp.onchange = () => { const fs = [...(inp.files || [])]; if (fs.length) addRefs(fs.map((f) => ({ src: f, alpha: refAlpha(f.type || f.name) })), at); };
    inp.click();
  }
  // The pictures selected in the library (the grid beside the lightbox: Tab) — the touch way to bring them in.
  function addSelectedRefs(){
    const list = host.selectedPictures?.() || [];
    if (!list.length){ toast(host.toggleLibrary ? "Select pictures in the library first (Tab shows it)" : "Nothing selected"); return; }
    addRefs(list, null);
  }
  // A drag over the surface that may carry pictures: files from outside, or library files (the grid's drag).
  function refDrag(e){
    const t = e.dataTransfer?.types;
    return !!t && refsAllowed() && !!surfaceEl() && ([...t].includes("Files") || [...t].includes("application/x-sight-ids"));
  }
  // A drop becomes reference images only while annotating. Otherwise library files go to the host's comparison
  // stack (host.dropForCompare: the lightbox compares the open file with them) and nothing turns annotating on.
  function onRefDrop(e){
    if (!refDrag(e)) return;
    const files = [...(e.dataTransfer.files || [])].filter((f) => /^image\//.test(f.type) || REF_RE.test(f.name));
    let ids = [];
    if (!files.length){
      try { ids = JSON.parse(e.dataTransfer.getData("application/x-sight-ids") || "[]"); } catch {}
      if (!Array.isArray(ids)) ids = [];
    }
    if (!S.on){
      if (ids.length && host.dropForCompare){ e.preventDefault(); e.stopPropagation(); host.dropForCompare(ids); return; }
      if (files.length){ e.preventDefault(); e.stopPropagation(); toast("Turn annotating on (A) to drop reference pictures"); }
      return;
    }
    const srcs = files.length ? files.map((f) => ({ src: f, alpha: refAlpha(f.type || f.name) })) : ids.length ? host.pictureSources?.(ids) || [] : [];
    if (!srcs.length) return;  // a review file (.srev) and the like: the page's own drop handler takes it
    e.preventDefault();
    e.stopPropagation();
    addRefs(srcs, toDoc(e));
  }

  let suppressClick = false;
  function onDown(e){
    if (!S.on || !surfaceEl()) return;  // (a board switch nulls the surface while the listeners stay wired)
    // A board's rows are still loading: a stroke now would be wiped by load()'s S.items.clear().
    if (isBoard() && S.loading){ release(e); return; }
    // A second finger while a marquee runs: ignored (it would restart the box and steal the first finger's moves).
    if (S.drag?.marquee && S.drag.pid !== e.pointerId){ release(e); return; }
    // Another pointer during an Ctrl + right-drag: ignored too (it would drop the drag uncommitted).
    if (S.drag?.sizeOp && S.drag.sizeOp.pid !== e.pointerId){ release(e); return; }
    if (!e.altKey && e.target.closest?.(".an-stamp")) return;  // the frame stamp has its own drag
    if (e.target.closest?.(".scp")) return;  // the text plate (caption-plate.js) has its own gestures
    if (S.edit){ if (e.button === 0){ finishEdit(); release(e); } return; }
    if (S.pinEdit){
      // A press on the pin being numbered (a double-click) leaves the field open; elsewhere it sets the number,
      // and with the pin tool goes on to place the next pin.
      if (e.button !== 0) return;
      const [qx, qy] = toDoc(e);
      if (hitAt(qx, qy)?.id === S.pinEdit.it.id){ release(e); S.pinEdit.inp.focus(); return; }
      finishPinEdit();
      if (S.tool !== "pin"){ release(e); return; }
    }
    const pen = e.pointerType === "pen";
    S.lastPtr = e.pointerType;
    // Ctrl + right-drag: the tool's (or the selection's) size sideways, opacity up / down — ahead of the host's own
    // right-button meanings (the viewer's right-drag zoom, the 3D view's Ctrl + right-drag explode). Not Alt: Alt hands
    // the press to the viewer (altCam).
    if (e.button === 2 && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && !S.region && startSizeOp(e)) return;
    const penEraser = pen && (e.buttons & 32 || e.button === 5);
    // The host's own control under the press (compare: a split under the finger, Alt+drag) — not while an area is
    // being picked, with the pen's eraser end, or Alt with the select tool (its duplicate-drag).
    if (!S.region && !penEraser && !(e.altKey && S.tool === "select") && host.passThrough?.(e)) return;
    if (altCam() && e.button === 0) return; // Alt held: the viewer's own press (orbit, scrub), not ours
    if (e.button !== 0 && !penEraser) return; // middle / right: the viewer's pan / zoom
    if (S.kind === "video"){ const v = video(); if (v) vidPause(v); }
    // A playing model stops too: a drawing belongs to the pose it is made at (ctx.anim).
    if (S.b3) S.b3.pauseAnim?.();
    const el = surfaceEl();
    const [x, y] = toDoc(e);
    const [sx, sy] = local(e);
    // Ctrl held: the eraser for this stroke (the select tool keeps Ctrl+click for the selection).
    const tool = penEraser || (e.ctrlKey && !e.metaKey && S.tool !== "select" && !S.region) ? "eraser" : S.tool;

    if (S.region){
      grab(e);
      S.region.rect = [sx, sy, sx, sy];
      S.drag = { region: true };
      renderSel();
      return;
    }
    if (tool === "select"){
      const ci = cropItem();
      if (ci){
        const ch = cropAt(ci, sx, sy, x, y);
        if (ch){
          grab(e);
          const [nx, ny] = toImg(cropFrame(ci.data), x, y);
          S.drag = { crop: ch, id: ci.id, F: cropFrame(ci.data), c0: RC.imgCrop(ci.data).slice(), n0: [nx, ny], ids: [ci.id], src: new Map([[ci.id, snap(ci)]]), moved: false };
          return;
        }
        endCrop();  // a press elsewhere ends cropping and then does what it always does
      }
      const ctrl = e.ctrlKey || e.metaKey;
      // (a Ctrl-press is a selection toggle / box, never a handle drag: a small drawing or a line's ends are mostly handles)
      const h = S.sel.size && !(ctrl && !e.shiftKey) ? handleAt(sx, sy) : null;
      if (h){ grab(e); startHandleDrag(h, x, y, e); return; }
      const hit = hitAt(x, y);
      // Ctrl held = box-select mode, as in the library grid (index.html combineSelection): the drag draws a
      // marquee even over a drawing (Ctrl = toggle against the selection it started from, Ctrl+Shift = add); a
      // Ctrl-click without a drag toggles the drawing under it (onUp). In 3D it is the only way to box-select with
      // a mouse (plain empty space orbits), the Box button is touch's.
      if (ctrl && !e.altKey){
        grab(e);
        S.drag = { marquee: [sx, sy, sx, sy], base: new Set(S.sel), toggle: !e.shiftKey, hit: hit?.id || null, boxed: false, pid: e.pointerId };
        renderSel(); renderProps();
        return;
      }
      if (hit){
        grab(e);
        if (e.shiftKey) S.sel.add(hit.id);  // Shift adds (Ctrl toggles: the box branch above), as in the grid
        else if (!S.sel.has(hit.id)){ S.sel.clear(); S.sel.add(hit.id); }
        if (baked(hit)){ renderSel(); renderProps(); return; }  // selected for Delete; not dragged
        if (e.altKey && S.sel.has(hit.id)) duplicateSelection(0, true);
        const ids = [...S.sel].filter((id) => editable(S.items.get(id)));
        S.drag = { move: true, x, y, ids, src: new Map(ids.map((id) => [id, snap(S.items.get(id))])), moved: false, hit: hit.id, plain: !(e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) };
        renderSel(); renderProps();
        return;
      }
      if (S.kind === "model3d" && !S.box3d){ // empty space in 3D: let the orbit controls have it
        if (S.sel.size){ S.sel.clear(); renderSel(); renderProps(); }
        return;
      }
      // Alt on empty space: the viewer's Alt-drag (scrub a video, turn a picture), as with the drawing
      // tools (altCam). Alt on a drawing keeps its duplicate-drag above; a marquee has no Alt meaning.
      if (e.altKey) return;
      grab(e);
      if (!e.shiftKey) S.sel.clear();  // Shift: the box adds (Ctrl took the branch above)
      S.drag = { marquee: [sx, sy, sx, sy], base: new Set(S.sel), toggle: false, pid: e.pointerId };
      renderSel(); renderProps();
      return;
    }
    grab(e);
    if (S.sel.size){ S.sel.clear(); renderProps(); }
    // Shift+click: a straight line from this tool's last point (Photoshop). Nothing is drawn until the
    // pointer comes up still, so a move becomes the usual constrained drag from this press.
    if (e.shiftKey && !e.altKey && lineTool(tool)){
      S.drag = { shiftClick: true, tool, x, y, sx, sy };
      return;
    }
    beginMark(tool, x, y, sx, sy, e);
  }
  // Brush, pencil, marker, lasso, stroke arrows, line, arrow, eraser: Shift+click joins clicks.
  const lineTool = (t) => freehand(t) || t === "arrows" || t === "line" || t === "arrow" || t === "eraser";
  function beginMark(tool, x, y, sx, sy, e){
    const pen = e.pointerType === "pen";
    if (tool === "eraser"){
      S.drag = { eraser: true, before: new Map(), partial: S.styles.eraser.mode === "partial", toolName: tool };
      eraseAt(x, y);
      return;
    }
    // Drawing starts a new note: a note picked in the panel lets go (the media shows the new one).
    if (S.pinFocus){ S.pinFocus = null; renderPanel(); }
    if (tool === "arrows"){
      // Arrows along a freehand stroke: drawn like a brush stroke, the arrows follow it (review-core arrowsPrims).
      const st = styleDoc(tool);
      const it = newItem("stroke", "arrows", { color: st.color, width: st.width, opacity: st.opacity, dash: st.dash, head1: st.head1, headSize: st.headSize, step: st.step, len: st.len, dir: st.dir, side: st.side, guide: st.guide !== false, pts: [r2(x), r2(y), 0.5] });
      S.items.set(it.id, it);
      S.drag = { stroke: it, sm: [x, y], smooth: 0.5, start: [x, y], minStep: 0.75 * k(), toolName: tool };
      renderAll();
      return;
    }
    if (freehand(tool)){
      const st = styleDoc(tool);
      const p = pen ? clamp(e.pressure || 0.5, 0, 1) : 0.5;
      // The lasso: a brush stroke that closes and fills ("random" picks the pattern now; hatchWidth 0 = auto, not stored).
      const fillKeys = tool === "lasso" ? { close: true, pattern: st.pattern === "random" ? RANDOM_PATTERNS[Math.floor(Math.random() * RANDOM_PATTERNS.length)] : st.pattern, fill: st.fill, fillOpacity: st.fillOpacity, gap: st.gap,
        ...(st.hatchWidth > 0 ? { hatchWidth: st.hatchWidth } : {}) } : {};
      const it = newItem("stroke", tool === "lasso" ? "brush" : tool, { color: st.color, size: st.size, opacity: st.opacity, pressure: st.pressure !== false, pen, ...fillKeys, pts: [r2(x), r2(y), r2(p)] });
      S.items.set(it.id, it);
      S.drag = { stroke: it, sm: [x, y], smooth: st.smooth ?? 0, start: [x, y], minStep: 0.75 * k(), toolName: tool };
      renderAll();
      return;
    }
    if (tool === "line" || tool === "arrow"){
      const st = styleDoc(tool);
      const it = newItem("shape", tool, { color: st.color, width: st.width, opacity: st.opacity, dash: st.dash, head0: st.head0, head1: st.head1, body: st.body, headSize: st.headSize, pts: [x, y, x, y] });
      S.items.set(it.id, it);
      S.drag = { shape: it, x, y, toolName: tool };
      renderAll();
      return;
    }
    if (tool === "rect"){
      const st = styleDoc(tool);
      const it = newItem("shape", st.shape === "ellipse" ? "ellipse" : "rect", { color: st.color, strokeOn: st.strokeOn, width: st.width, dash: st.dash, fillOn: st.fillOn, fill: st.fill, fillOpacity: st.fillOpacity, radius: st.shape === "ellipse" ? 0 : st.radius || 0, opacity: st.opacity, x, y, w: 0, h: 0, rot: 0 });
      S.items.set(it.id, it);
      S.drag = { shape: it, x, y };
      renderAll();
      return;
    }
    if (tool === "text"){
      const hit = hitAt(x, y);
      if (hit && typeOf(hit) === "text" && editable(hit)){ release(e); editText(hit); return; }
      release(e);
      const st = styleDoc("text");
      const it = newItem("text", null, { ...st, text: "", x, y: y - st.size * 0.6, rot: 0 });
      editText(it, true);
      return;
    }
    if (tool === "image"){
      release(e);
      pickRefs([x, y]);
      return;
    }
    if (tool === "pin"){
      // A click: a circle here; a drag: a leader line from here, the circle where it is let go. The number is
      // typed after (editPin). A click on a pin (no drag) edits its number instead.
      const hit = hitAt(x, y);
      const st = styleDoc("pin");
      const it = newItem("pin", null, { color: st.color, size: st.size, x, y, label: nextPinNumber() });
      S.items.set(it.id, it);
      S.drag = { pin: it, x, y, sx, sy, hit: hit && typeOf(hit) === "pin" && editable(hit) ? hit : null, moved: false };
      renderAll();
      return;
    }
  }
  function grab(e){
    e.preventDefault();
    e.stopImmediatePropagation();
    suppressClick = true;
    try { surfaceEl().setPointerCapture(e.pointerId); } catch {}
  }
  function release(e){
    e.preventDefault();
    e.stopImmediatePropagation();
    suppressClick = true;
  }

  function onMove(e){
    if (!S.on) return;
    const el = surfaceEl();
    if (!el) return;
    const [sx, sy] = local(e);
    S.hover = [sx, sy];
    if (S.ctrlHeld !== e.ctrlKey && !S.drag) S.ctrlHeld = e.ctrlKey;
    const D = S.drag;
    if (!D){ updateCursor(sx, sy); renderSel(); return; }
    // Still a Shift+click until the pointer actually moves: then the usual drag from the press (H/V, square).
    if (D.shiftClick){
      if (hyp(sx - D.sx, sy - D.sy) < 4){ updateCursor(sx, sy); renderSel(); return; }
      beginMark(D.tool, D.x, D.y, D.sx, D.sy, e);
      if (!S.drag || S.drag.shiftClick) return;
      return onMove(e);
    }
    e.preventDefault();
    if (D.sizeOp){ moveSizeOp(D, e); return; }
    if (D.region){ S.region.rect[2] = sx; S.region.rect[3] = sy; renderSel(); return; }
    const [x, y] = toDoc(e);
    if (D.stroke){
      const it = D.stroke, d = it.data;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      if (e.shiftKey){
        // Shift: straight stroke from where it started, horizontal or vertical.
        const [ex, ey] = snapAngle(D.start[0], D.start[1], x, y);
        const n = Math.max(2, Math.ceil(hyp(ex - D.start[0], ey - D.start[1]) / Math.max(D.minStep * 4, (d.size || d.width * 2) / 3)));
        d.pts = [];
        for (let i = 0; i <= n; i++) d.pts.push(r2(D.start[0] + (ex - D.start[0]) * i / n), r2(D.start[1] + (ey - D.start[1]) * i / n), 1);
        D.straight = true;
      } else {
        if (D.straight){ d.pts = d.pts.slice(0, 3); D.sm = D.start.slice(); D.straight = false; }
        for (const ce of evs.length ? evs : [e]){
          const [cx, cy] = toDoc(ce);
          const a = 1 - D.smooth * 0.82;
          D.sm = [D.sm[0] + (cx - D.sm[0]) * a, D.sm[1] + (cy - D.sm[1]) * a];
          const n = d.pts.length;
          if (hyp(D.sm[0] - d.pts[n - 3], D.sm[1] - d.pts[n - 2]) < D.minStep) continue;
          const p = d.pen ? clamp(ce.pressure || 0, 0, 1) : 0.5;
          d.pts.push(r2(D.sm[0]), r2(D.sm[1]), r2(p));
        }
        D.last = [x, y, d.pen ? clamp(e.pressure || 0, 0, 1) : 0.5];
      }
      renderItem(it);
      renderSel();  // the brush circle follows the pointer while the stroke is drawn
      return;
    }
    if (D.shape){
      const it = D.shape, d = it.data, t = typeOf(it);
      if (t === "line" || t === "arrow"){
        const [ex, ey] = e.shiftKey ? snapAngle(D.x, D.y, x, y) : [x, y];
        d.pts = [D.x, D.y, ex, ey];
      } else {
        let w = x - D.x, h = y - D.y;
        if (e.shiftKey){ const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
        d.x = D.x; d.y = D.y; d.w = w; d.h = h;
      }
      renderItem(it);
      return;
    }
    if (D.pin){
      const d = D.pin.data;
      if (!D.moved && hyp(sx - D.sx, sy - D.sy) < 6) return;
      D.moved = true;
      const [ex, ey] = e.shiftKey ? snapAngle(D.x, D.y, x, y) : [x, y];
      d.ax = D.x; d.ay = D.y; d.x = ex; d.y = ey;
      renderItem(D.pin);
      return;
    }
    if (D.eraser){ eraseAt(x, y); renderSel(); return; }
    if (D.marquee){
      if (D.pid !== e.pointerId) return;
      if (!D.boxed && hyp(sx - D.marquee[0], sy - D.marquee[1]) <= 4) return;  // a click so far (onUp)
      D.boxed = true;
      D.marquee[2] = sx; D.marquee[3] = sy;
      const [ax, ay] = toDocS(Math.min(D.marquee[0], sx), Math.min(D.marquee[1], sy));
      const [bx, by] = toDocS(Math.max(D.marquee[0], sx), Math.max(D.marquee[1], sy));
      const inBox = new Set(visibleDrawings().filter((it) => { const b = boundsOf(it); return b[0] <= bx && b[2] >= ax && b[1] <= by && b[3] >= ay; }).map((it) => it.id));
      S.sel = new Set(D.base);
      for (const id of inBox){ if (D.toggle && D.base.has(id)) S.sel.delete(id); else S.sel.add(id); }
      renderSel();
      return;
    }
    if (D.move){
      let dx = x - D.x, dy = y - D.y;
      if (e.shiftKey){ if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      if (!D.moved && hyp(dx, dy) / k() < 2) return;
      D.moved = true;
      for (const id of D.ids){
        const it = S.items.get(id), src = D.src.get(id);
        if (it && src) transformItem(it, src, (px, py) => [px + dx, py + dy]);
        renderItem(it);
      }
      renderSel();
      return;
    }
    if (D.crop){ cropDrag(D, x, y); return; }
    if (D.handle){ dragHandle(D, x, y, e); return; }
  }
  const toDocS = (sx, sy) => { const g = geom(); return [(sx - g.ox) / g.s, (sy - g.oy) / g.s]; };

  function onUp(e){
    const D = S.drag;
    if (!D) return;
    if (D.marquee && D.pid !== e.pointerId) return;  // another finger lifting: the box goes on
    if (D.sizeOp && D.sizeOp.pid !== e.pointerId) return;  // the same for an Ctrl + right-drag
    S.drag = null;
    try { surfaceEl()?.releasePointerCapture(e.pointerId); } catch {}
    if (D.shiftClick){
      if (e.type === "pointercancel" || e.type === "lostpointercapture") return;
      const tool = D.tool, x = D.x, y = D.y, a = S.anchors[tool];
      // Screen pixels, same 3 px as a kept stroke: a zoomed-in click is a small document distance.
      if (a && hyp(x - a[0], y - a[1]) / k() >= 3) commitShiftLine(tool, a, [x, y]);
      else if (freehand(tool) || tool === "eraser"){
        beginMark(tool, x, y, D.sx, D.sy, e);
        if (S.drag) onUp({ pointerId: e.pointerId, type: "pointerup", clientX: e.clientX, clientY: e.clientY });
      }
      S.anchors[tool] = [x, y];
      renderSel();
      return;
    }
    if (D.sizeOp){ endSizeOp(D, e.type === "pointercancel" || e.type === "lostpointercapture"); return; }
    if (D.region){ finishRegion(); return; }
    if (D.stroke){
      const it = D.stroke;
      if (D.last && !D.straight){
        const d = it.data, n = d.pts.length;
        if (hyp(D.last[0] - d.pts[n - 3], D.last[1] - d.pts[n - 2]) > 0.01) d.pts.push(r2(D.last[0]), r2(D.last[1]), r2(D.last[2]));
      }
      S.items.delete(it.id);
      const dEnd = it.data, nEnd = dEnd.pts.length;
      const end = nEnd >= 3 ? [dEnd.pts[nEnd - 3], dEnd.pts[nEnd - 2]] : null;
      if (typeOf(it) === "arrows"){
        // An arrows stroke needs some length (a click would leave a dot with no arrows).
        let len = 0;
        const d = it.data;
        for (let i = 3; i < d.pts.length; i += 3) len += hyp(d.pts[i] - d.pts[i - 3], d.pts[i + 1] - d.pts[i - 2]);
        if (len / k() < 3){ renderAll(); if (D.toolName && end) S.anchors[D.toolName] = end; return; }
      }
      commit([it.id], () => S.items.set(it.id, it));
      if (D.toolName && end) S.anchors[D.toolName] = end;
      return;
    }
    if (D.shape){
      const it = D.shape, d = it.data, t = typeOf(it);
      S.items.delete(it.id);
      const tiny = t === "line" || t === "arrow" ? hyp(d.pts[2] - d.pts[0], d.pts[3] - d.pts[1]) / k() < 3 : Math.abs(d.w) / k() < 3 && Math.abs(d.h) / k() < 3;
      // A click leaves no mark, but it is still this tool's point: the next Shift+click starts here.
      if (tiny){
        if ((t === "line" || t === "arrow") && D.toolName && d.pts?.length >= 2)
          S.anchors[D.toolName] = d.pts.length >= 4 ? [d.pts[2], d.pts[3]] : [d.pts[0], d.pts[1]];
        renderAll();
        return;
      }
      if (t === "rect" || t === "ellipse"){ if (d.w < 0){ d.x += d.w; d.w = -d.w; } if (d.h < 0){ d.y += d.h; d.h = -d.h; } }
      commit([it.id], () => S.items.set(it.id, it));
      if ((t === "line" || t === "arrow") && D.toolName) S.anchors[D.toolName] = [d.pts[2], d.pts[3]];
      return;
    }
    if (D.pin){
      const it = D.pin, d = it.data;
      const click = !D.moved || hyp(d.x - D.x, d.y - D.y) <= d.size / 2;  // no line: a circle where it was pressed
      if (click){ delete d.ax; delete d.ay; d.x = D.x; d.y = D.y; }
      if (click && D.hit){ S.items.delete(it.id); renderAll(); editPin(D.hit, false); return; }
      renderItem(it);
      editPin(it, true);
      return;
    }
    if (D.eraser){
      finishEraser(D);
      if (e.clientX != null && surfaceEl()){ const [x, y] = toDoc(e); S.anchors.eraser = [x, y]; }
      return;
    }
    if (D.marquee){
      if (e.type === "pointercancel" || e.type === "lostpointercapture"){ /* the pointer was taken: not a click */ }
      else if (!D.boxed && D.hit){ if (D.toggle && S.sel.has(D.hit)) S.sel.delete(D.hit); else S.sel.add(D.hit); }  // Ctrl(+Shift)-click
      // A click on empty space in 3D is still the viewer's mesh pick / clear (the press never reached it):
      // Ctrl = pick, anything else only clears (as the viewer's own pointerup).
      else if (!D.boxed && S.kind === "model3d") S.b3?.pickMesh?.(e.clientX, e.clientY, !!D.toggle);
      renderSel(); renderProps(); return;
    }
    if (D.move || D.handle || D.crop){
      if (!D.moved){
        if (D.move && D.plain && S.sel.size > 1){ S.sel = new Set([D.hit]); renderProps(); }
        renderSel();
        return;
      }
      const ids = D.ids;
      const after = new Map(ids.map((id) => [id, snap(S.items.get(id))]));
      S.undo.push({ before: D.src, after, at: performance.now() });
      S.redo.length = 0;
      for (const id of ids) serverUpdate(id);
      afterChange();
    }
  }

  // ---- Ctrl + right-drag: size / opacity ---------------------------------------------------------
  // The same gesture as the drawing canvas's press-and-hold drag (review-draw.js), maths shared in RC.sizeOpDrag:
  // sideways the size / width as a ratio of what it had (right = bigger), up / down the opacity (up = more
  // solid), one axis per drag. A drawing tool changes its style (the props bar follows on release); the select
  // tool changes the selection (one undo step). A circle at the press shows the size and opacity.
  // The size descriptor (Size / Width, its range in screen px) of a tool / an item type, or null.
  const sizeProp = (type) => (PROPS[type] || []).find((p) => p.t === "num" && (p.k === "size" || p.k === "width")) || null;
  const hasOpacity = (type) => !!PROPS[type]?.some((p) => p.k === "opacity");
  function startSizeOp(e){
    const t = S.tool, [sx, sy] = local(e);
    const G = { axis: null, x: e.clientX, y: e.clientY, at: [sx, sy], pid: e.pointerId };
    if (t !== "select"){
      const sp = sizeProp(t), st = S.styles[t];
      if (!sp || !st) return false;
      Object.assign(G, { tool: t, key: sp.k, min: sp.min, max: sp.max, s0: st[sp.k], o0: st.opacity, op: hasOpacity(t) });
      grab(e);
      S.drag = { sizeOp: G };
    } else {
      const ids = editSel().map((it) => it.id).filter((id) => { const ty = propType(S.items.get(id)); return sizeProp(ty) || hasOpacity(ty); });
      if (!ids.length) return false;
      G.op = ids.some((id) => hasOpacity(propType(S.items.get(id))));
      grab(e);
      S.drag = { sizeOp: G, ids, src: new Map(ids.map((id) => [id, snap(S.items.get(id))])), moved: false };
    }
    suppressClick = false;  // (grab's flag: a right press brings no click to eat, the next left click would go)
    renderSel();
    return true;
  }
  function moveSizeOp(D, e){
    const G = D.sizeOp;
    if (e.pointerId !== G.pid) return;  // another pointer (a finger, the pen) does not steer it
    const r = surfaceEl().getBoundingClientRect();
    const m = RC.sizeOpDrag(G, e.clientX - G.x, e.clientY - G.y, r.width, r.height);
    if (!m) return;
    if (G.tool){
      const st = S.styles[G.tool];
      if (m.f) st[G.key] = Math.round(clamp(G.s0 * m.f, G.min, G.max) * 10) / 10;
      else if (G.op) st.opacity = RC.opAfter(G.o0, m.dOp);
    } else {
      const kk = k();
      for (const id of D.ids){
        const it = S.items.get(id), src = D.src.get(id);
        if (!it || !src) continue;
        const ty = propType(it), sp = sizeProp(ty), b = src.data, d = it.data;
        if (m.f && sp && typeof b[sp.k] === "number" && b[sp.k] > 0){
          // (the range widened to the value it had: one already outside the props bar's px range at this zoom
          // must not jump to its edge)
          d[sp.k] = clamp(b[sp.k] * m.f, Math.min(b[sp.k], sp.min * kk), Math.max(b[sp.k], sp.max * kk));
          const g = d[sp.k] / b[sp.k];
          // (A lasso's fill — gap, hatchWidth — does not follow the outline: old data without a gap keeps its look by
          // having the size-derived gap written down first.)
          if (RC.isFillStroke(b)){ if (!(Number(b.gap) > 0)) d.gap = RC.hatchMetrics(b).gap0; }
          else for (const x of ["gap", "step", "len", "hatchWidth"]) if (typeof b[x] === "number") d[x] = b[x] * g;  // lengths that follow the width
        }
        if (m.dOp != null && hasOpacity(ty)) d.opacity = RC.opAfter(b.opacity, m.dOp);
        renderItem(it);
      }
      D.moved = true;
    }
    renderSel();
  }
  function endSizeOp(D, cancel){
    const G = D.sizeOp;
    if (G.tool){
      const st = S.styles[G.tool];
      if (cancel){ st[G.key] = G.s0; if (G.o0 !== undefined) st.opacity = G.o0; }
      else saveStyles();
    } else if (cancel || !D.moved){
      for (const [id, src] of D.src) if (src && S.items.has(id)){ S.items.set(id, structuredClone(src)); renderItem(S.items.get(id)); }
    } else {
      const ids = D.ids.filter((id) => S.items.has(id));
      const after = new Map(ids.map((id) => [id, snap(S.items.get(id))]));
      S.undo.push({ before: new Map(ids.map((id) => [id, D.src.get(id)])), after, at: performance.now() });
      S.redo.length = 0;
      for (const id of ids) serverUpdate(id);
      afterChange();
    }
    renderSel(); renderProps();
  }
  // The circle (the size, filled at the opacity) and value at the press of an Ctrl + right-drag.
  function sizeOpSvg(D){
    const G = D.sizeOp;
    let size, op, color;
    if (G.tool){
      const st = S.styles[G.tool];
      size = st[G.key]; op = G.op ? st.opacity ?? 1 : null; color = G.tool === "eraser" ? "none" : st.color || "#fff";
    } else {
      const it = S.items.get(D.ids[0]);
      if (!it) return "";
      const sp = sizeProp(propType(it)), d = it.data;
      size = sp && typeof d[sp.k] === "number" ? d[sp.k] / k() : null; op = hasOpacity(propType(it)) ? d.opacity ?? 1 : null; color = d.color || "#fff";
    }
    const [cx, cy] = G.at, r = Math.max(1, (size || 0) / 2);
    const label = [size != null ? fmtNum({ unit: "px" }, size) + " px" : "", op != null ? Math.round(op * 100) + " %" : ""].filter(Boolean).join(" · ");
    let h = "";
    if (size != null) h += `<circle class="an-cursor" cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(r)}" style="fill:${esc(color)};fill-opacity:${op ?? 1}"${G.tool === "eraser" ? ` stroke-dasharray="3 2"` : ""}/>`;
    return h + `<text class="an-regionlbl" x="${r2(cx)}" y="${r2(cy + r + 16)}" text-anchor="middle">${esc(label)}</text>`;
  }

  // A second finger came down (the board's pinch / pan, canvas.js): the stroke / shape / move the first finger began
  // is dropped (an eraser pass keeps what it erased), so a pinch never leaves a mark.
  function abortGesture(){
    const D = S.drag;
    if (!D) return;
    if (D.eraser){ onUp({ pointerId: -1 }); return; }
    S.drag = null;
    if (D.sizeOp){ endSizeOp(D, true); return; }
    if (D.stroke || D.shape || D.pin) S.items.delete((D.stroke || D.shape || D.pin).id);
    else if (D.src) for (const [id, src] of D.src) if (src) S.items.set(id, structuredClone(src));
    renderAll();
    renderSel(); renderProps();
  }

  // Shift while dragging: horizontal or vertical (a stroke, a line, an arrow, a pin leader). Shift+click, with no
  // move, draws a straight line from this tool's last point instead (commitShiftLine).
  const snapAngle = RC.snapHV;
  function finishEraser(D){
    if (!D?.before?.size) return;
    const after = new Map([...D.before.keys()].map((id) => [id, snap(S.items.get(id))]));
    // Items were already changed live; record the step and persist.
    S.undo.push({ before: D.before, after, at: performance.now() });
    S.redo.length = 0;
    for (const [id, b] of D.before) persist(id, b, after.get(id));
    afterChange();
  }
  // A straight mark from the previous point of this tool to this click.
  function commitShiftLine(tool, a, b){
    const [x0, y0] = a, [x1, y1] = b;
    if (tool === "eraser"){
      const rad = Math.max(S.styles.eraser.size / 2 * k(), 0.5);
      const n = Math.max(1, Math.ceil(hyp(x1 - x0, y1 - y0) / (rad * 0.5)));
      S.drag = { eraser: true, before: new Map(), partial: S.styles.eraser.mode === "partial", toolName: "eraser" };
      for (let i = 0; i <= n; i++) eraseAt(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n);
      const D = S.drag;
      S.drag = null;
      finishEraser(D);
      return;
    }
    if (hyp(x1 - x0, y1 - y0) / k() < 3) return;
    if (tool === "line" || tool === "arrow"){
      const st = styleDoc(tool);
      const it = newItem("shape", tool, { color: st.color, width: st.width, opacity: st.opacity, dash: st.dash, head0: st.head0, head1: st.head1, body: st.body, headSize: st.headSize, pts: [x0, y0, x1, y1] });
      commit([it.id], () => S.items.set(it.id, it));
      return;
    }
    const st = styleDoc(tool);
    const step = Math.max(0.75 * k() * 4, ((st.size || st.width * 2) || 4) / 3);
    const n = Math.max(1, Math.ceil(hyp(x1 - x0, y1 - y0) / step));
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(r2(x0 + (x1 - x0) * i / n), r2(y0 + (y1 - y0) * i / n), 1);
    if (tool === "arrows"){
      const it = newItem("stroke", "arrows", { color: st.color, width: st.width, opacity: st.opacity, dash: st.dash, head1: st.head1, headSize: st.headSize, step: st.step, len: st.len, dir: st.dir, side: st.side, guide: st.guide !== false, pts });
      commit([it.id], () => S.items.set(it.id, it));
      return;
    }
    const fillKeys = tool === "lasso" ? { close: true, pattern: st.pattern === "random" ? RANDOM_PATTERNS[Math.floor(Math.random() * RANDOM_PATTERNS.length)] : st.pattern, fill: st.fill, fillOpacity: st.fillOpacity, gap: st.gap,
      ...(st.hatchWidth > 0 ? { hatchWidth: st.hatchWidth } : {}) } : {};
    const it = newItem("stroke", tool === "lasso" ? "brush" : tool, { color: st.color, size: st.size, opacity: st.opacity, pressure: st.pressure !== false, pen: false, ...fillKeys, pts });
    commit([it.id], () => S.items.set(it.id, it));
  }


  function eraseAt(x, y){
    const D = S.drag, rad = S.styles.eraser.size / 2 * k();
    for (const it of visibleDrawings()){
      if (!hitTest(it, x, y, rad)) continue;
      const t = typeOf(it);
      // A baked drawing is removed whole (a deletion) but never cut into pieces (an edit).
      if (D.partial && STROKE_TOOLS.has(t) && !baked(it)){
        const pts = it.data.pts, keep = [];
        let cur = [], cut = false;
        for (let i = 0; i < pts.length; i += 3){
          if (hyp(pts[i] - x, pts[i + 1] - y) <= rad + (it.data.size || it.data.width || 0) * 0.25){ if (cur.length) keep.push(cur); cur = []; cut = true; }
          else cur.push(pts[i], pts[i + 1], pts[i + 2]);
        }
        if (!cut) continue;  // (within reach as a whole — the arrows, the fill — but no point of the stroke was hit)
        // A cut lasso is open (its pieces lose the fill); its first and last runs met at the seam — one piece.
        if (it.data.close){
          if (keep.length && cur.length && keep[0][0] === pts[0] && keep[0][1] === pts[1]) keep[0] = cur.concat(keep[0]);
          else if (cur.length) keep.push(cur);
        } else if (cur.length) keep.push(cur);
        if (!D.before.has(it.id)) D.before.set(it.id, snap(it));
        if (it.data.close) it.data.close = false;
        if (!keep.length){ S.items.delete(it.id); S.layer?.els.get(it.id)?.remove(); S.layer?.els.delete(it.id); continue; }
        it.data.pts = keep[0];
        renderItem(it);
        for (const piece of keep.slice(1)){
          const n = { ...structuredClone(it), id: uid(), z: nextZ() };
          n.data.pts = piece;
          S.items.set(n.id, n);
          D.before.set(n.id, null);
          renderItem(n);
          S.layer?.doc.appendChild(S.layer.els.get(n.id));
        }
      } else {
        if (!D.before.has(it.id)) D.before.set(it.id, snap(it));
        S.items.delete(it.id);
        S.layer?.els.get(it.id)?.remove();
        S.layer?.els.delete(it.id);
      }
    }
  }

  // Scale / rotate / line-end handles: review-core xfStart / xfDrag (shared with the HTML page's
  // and the phone app's drawing canvas). The rotate handle follows the pointer out from the pivot.
  function startHandleDrag(h, x, y, e){
    const list = editSel(), ids = list.map((it) => it.id);
    S.drag = { handle: h, xf: RC.xfStart(h, list, x, y), ids, src: new Map(ids.map((id) => [id, snap(S.items.get(id))])), moved: false };
  }
  function dragHandle(D, x, y, e){
    D.moved = true;
    RC.xfDrag(D.xf, x, y, { shift: e.shiftKey, alt: e.altKey });
    for (const it of D.xf.items) renderItem(it);
    renderSel();
  }

  function updateCursor(sx, sy){
    const el = surfaceEl();
    if (!el) return;
    let c = "crosshair";
    if (altCam()) c = "";
    else if (S.region) c = "crosshair";
    else if (S.tool === "select" && cropItem()){
      const [x, y] = toDocS(sx, sy), ch = cropAt(cropItem(), sx, sy, x, y);
      c = ch === "pan" ? "grab" : ch ? RC.XF_CURSOR[ch] : "default";
    } else if (S.tool === "select"){
      const h = S.sel.size ? handleAt(sx, sy) : null;
      if (h) c = RC.XF_CURSOR[h];
      else {
        const [x, y] = toDocS(sx, sy);
        c = S.ctrlHeld ? "default" : hitAt(x, y) ? "move" : S.kind === "model3d" && !S.box3d ? "" : "default";
      }
    } else if (freehand(effTool()) || effTool() === "eraser") c = "none";
    else if (S.tool === "text") c = "text";
    else if (S.tool === "image") c = "copy";
    // The "tool" layer (cursors.js): a running view gesture (pan / zoom / turn) still shows its own cursor over it.
    setCursor(el, "tool", c || null);
  }
  // The tool a press would use now: Ctrl held turns any drawing tool into the eraser.
  const effTool = () => S.ctrlHeld && S.tool !== "select" && !S.region ? "eraser" : S.tool;
  function ctrlChanged(on){
    if (S.ctrlHeld === on) return;
    S.ctrlHeld = on;
    if (S.on && S.hover && !S.drag){ updateCursor(...S.hover); renderSel(); }
  }
  // Alt held over a drawing tool (altCam): the press goes to the viewer (orbit, video scrub on the picture)
  // and the bar and notes panel let the pointer through, so the camera / picture moves without switching
  // to the select tool. Select keeps Alt for its duplicate-drag. A state flag, like Ctrl above.
  const altCam = () => !!S.altHeld && S.on && S.tool !== "select" && !S.region;
  function paintAlt(){
    S.light?.classList.toggle("an-alt", altCam());
    if (S.on && S.hover && !S.drag) updateCursor(...S.hover);
    if (S.on && S.hover) renderSel();  // the brush circle shows or goes with Alt
  }
  function altChanged(on){
    if (!!S.altHeld === on) return;
    S.altHeld = on;
    paintAlt();
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Alt") altChanged(true); }, true);
  document.addEventListener("keyup", (e) => { if (e.key === "Alt") altChanged(false); }, true);
  window.addEventListener("blur", () => { ctrlChanged(false); altChanged(false); });

  // ---- text editing ---------------------------------------------------------------------------
  function editText(it, isNew){
    finishEdit();
    const el = surfaceEl();
    if (!el) return;
    const ta = document.createElement("textarea");
    ta.className = "an-textedit";
    ta.spellcheck = false;
    ta.value = it.data.text || "";
    // In the layer, so it turns / mirrors with the picture.
    (S.b2 && S.layer ? S.layer.root : el).appendChild(ta);
    ta.style.pointerEvents = "auto";
    S.edit = { it, ta, isNew, before: isNew ? null : snap(it) };
    if (!isNew){ S.items.set(it.id, it); S.layer?.els.get(it.id)?.setAttribute("opacity", "0"); }
    const place = () => {
      const d = it.data, g = geom(), L = textLayout({ ...d, text: ta.value || " " });
      const [sx, sy] = toScreen(d.x, d.y);
      const fs = d.size * g.s;
      Object.assign(ta.style, {
        left: sx + "px", top: sy + "px", width: Math.max(fs * 2, L.w * g.s + fs) + "px", height: (L.h * g.s + 4) + "px",
        font: `${d.italic ? "italic " : ""}${d.bold ? 700 : 400} ${fs}px/${1.25} ${fontStack(d.font)}`,
        color: d.color, textAlign: d.align || "left", textDecoration: d.underline ? "underline" : "none",
        transform: d.rot ? `rotate(${d.rot}deg)` : "", transformOrigin: "0 0",
        background: d.bgOn ? hexA(d.bg, d.bgOpacity ?? 0.6) : "rgb(0 0 0 / .25)",
        WebkitTextStroke: d.outline ? `${d.outline * g.s}px ${d.outlineColor}` : "",
      });
    };
    S.edit.place = place;
    place();
    ta.addEventListener("input", () => { it.data.text = ta.value; place(); });
    ta.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (hotkey(e, "Escape") || hotkey(e, "Ctrl+Enter")){ e.preventDefault(); finishEdit(); }
    });
    ta.addEventListener("blur", (e) => {
      // Styling the text from the props bar keeps the editor open (focus comes back to it).
      if (e.relatedTarget && S.bar?.contains(e.relatedTarget)) return;
      setTimeout(() => { if (S.edit?.ta === ta && document.activeElement !== ta && !S.bar?.contains(document.activeElement)) finishEdit(); }, 0);
    });
    ta.addEventListener("pointerdown", (e) => e.stopPropagation());
    // Focus at once: keys typed before the next frame would otherwise hit the tool shortcuts.
    // (pointerdown was preventDefault-ed, so no mousedown comes along to move the focus away.)
    ta.focus();
    ta.select();
    requestAnimationFrame(() => { if (S.edit?.ta === ta && document.activeElement !== ta) ta.focus(); });
    renderProps();
  }
  function finishEdit(){
    finishPinEdit();
    const E = S.edit;
    if (!E) return;
    S.edit = null;
    E.ta.remove();
    const it = E.it;
    S.layer?.els.get(it.id)?.removeAttribute("opacity"); // hidden under the editor while it was open
    it.data.text = E.ta.value.replace(/\s+$/, "");
    if (!it.data.text){
      if (!E.isNew) commit([it.id], () => S.items.delete(it.id));
      else S.items.delete(it.id);
      afterChange();
      return;
    }
    if (E.isNew) commit([it.id], () => S.items.set(it.id, it));
    else {
      const after = snap(it);
      S.items.set(it.id, structuredClone(E.before));
      commit([it.id], () => S.items.set(it.id, after));
    }
    S.sel = new Set([it.id]);
    afterChange();
  }
  // ---- pin number ------------------------------------------------------------------------------
  // The smallest number no pin of this media shows yet (older pins show their note's number).
  function nextPinNumber(skip){
    const used = new Set();
    for (const it of S.items.values()) if (typeOf(it) === "pin" && it.id !== skip) used.add(String(it.data.label || numOf(it) || ""));
    let n = 1;
    while (used.has(String(n))) n++;
    return String(n);
  }
  // A small field over the pin: type its number, Enter (or a tap elsewhere) sets it — empty = the next free
  // number; Esc drops a new pin / keeps an old one's number. Keys typed there never reach the tool shortcuts,
  // and the focus leaves it once it is done (so the hotkeys work again with the pin tool still in hand).
  function editPin(it, isNew){
    finishEdit();
    const el = surfaceEl();
    if (!el){ if (isNew) S.items.delete(it.id); return; }
    const inp = document.createElement("input");
    inp.className = "an-pinedit";
    inp.type = "text";
    inp.inputMode = "numeric";
    inp.maxLength = 4;
    inp.spellcheck = false;
    inp.autocomplete = "off";
    inp.value = isNew ? "" : it.data.label || "";
    inp.placeholder = isNew ? String(it.data.label || nextPinNumber(it.id)) : String(it.data.label || numOf(it) || "");
    inp.setAttribute("aria-label", "Pin number");
    (S.b2 && S.layer ? S.layer.root : el).appendChild(inp);
    inp.style.pointerEvents = "auto";
    S.pinEdit = { it, inp, isNew, before: isNew ? null : snap(it) };
    const place = () => {
      const d = it.data, g = geom(), [cx, cy] = toScreen(d.x, d.y), w = Math.max(44, d.size * g.s * 1.4), h = Math.max(30, d.size * g.s);
      Object.assign(inp.style, { left: (cx - w / 2) + "px", top: (cy - h / 2) + "px", width: w + "px", height: h + "px", fontSize: Math.max(14, d.size * g.s * 0.5) + "px" });
    };
    S.pinEdit.place = place;
    place();
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (hotkey(e, "Enter")){ e.preventDefault(); finishPinEdit(); }
      else if (hotkey(e, "Escape")){ e.preventDefault(); finishPinEdit(true); }
    });
    inp.addEventListener("blur", () => setTimeout(() => { if (S.pinEdit?.inp === inp && document.activeElement !== inp) finishPinEdit(); }, 0));
    inp.addEventListener("pointerdown", (e) => e.stopPropagation());
    inp.focus();
    inp.select();
    requestAnimationFrame(() => { if (S.pinEdit?.inp === inp && document.activeElement !== inp) inp.focus(); });
  }
  function finishPinEdit(cancel){
    const E = S.pinEdit;
    if (!E) return;
    S.pinEdit = null;
    E.inp.remove();
    const it = E.it;
    if (cancel){
      if (E.isNew) S.items.delete(it.id);
      renderAll();
      return;
    }
    // Empty: a new pin takes the next free number; an old one keeps what it shows.
    const label = E.inp.value.trim() || (E.isNew ? E.inp.placeholder || nextPinNumber(it.id) : E.before.data.label || "");
    if (E.isNew){
      it.data.label = label;
      S.items.delete(it.id);
      commit([it.id], () => S.items.set(it.id, it));
    } else if (label !== (E.before.data.label || "")){
      const after = structuredClone(E.before);
      after.data.label = label;
      commit([it.id], () => S.items.set(it.id, after));
    }
    afterChange();
  }
  function hexA(hex, a){
    const n = parseInt(String(hex || "#000000").slice(1), 16);
    return `rgb(${n >> 16 & 255} ${n >> 8 & 255} ${n & 255} / ${a})`;
  }

  // ---- selection commands ---------------------------------------------------------------------
  // Removes every drawing on screen now, in one undo step: while a new note is being made that is
  // its drawings, with a note picked that note's, else all on this frame / picture / view.
  function clearShown(){
    if (S.hidden){ toast("Drawings are hidden (Shift+H)"); return; }
    finishEdit();
    const ids = shownDrawings().map((it) => it.id);
    if (!ids.length){ toast("No drawings on screen"); return; }
    commit(ids, () => { for (const id of ids) S.items.delete(id); });
    toast(`Cleared ${ids.length} drawing${ids.length > 1 ? "s" : ""} · Ctrl+Z brings ${ids.length > 1 ? "them" : "it"} back`, 2600);
  }
  function deleteSelection(){
    const ids = [...S.sel].filter((id) => S.items.has(id));
    if (!ids.length) return false;
    commit(ids, () => { for (const id of ids) S.items.delete(id); });
    S.sel.clear();
    afterChange();
    return true;
  }
  function duplicateSelection(offset = 16, inPlace){
    const src = [...S.sel].map((id) => S.items.get(id)).filter(Boolean);
    if (!src.length) return false;
    const off = offset * k();
    const fresh = src.map((it) => {
      const n = structuredClone(it);
      n.id = uid(); n.z = nextZ() + src.indexOf(it);
      transformItem(n, it, (x, y) => [x + off, y + off]);
      n.data.note = null; n.data.reply = null; n.data.created = Date.now(); n.data.ctx = ctxNow(false, true) || n.data.ctx;
      return n;
    });
    commit(fresh.map((n) => n.id), () => { for (const n of fresh) S.items.set(n.id, n); });
    if (inPlace){
      // Alt+drag: the originals stay put, the copies are the ones being dragged.
      S.sel = new Set(fresh.map((n) => n.id));
    } else S.sel = new Set(fresh.map((n) => n.id));
    afterChange();
    return true;
  }
  function copySelection(){
    const src = [...S.sel].map((id) => S.items.get(id)).filter(Boolean).sort((a, b) => (a.z || 0) - (b.z || 0));
    if (!src.length) return false;
    S.clip = src.map(snap); S.clipCut = false;
    toast(`Copied ${src.length}`);
    return true;
  }
  // Ctrl+X: copy, then delete (one undo step). Ctrl+V pastes what was cut in its own place first,
  // copies 20 px down-right (each paste steps on from the last one).
  function cutSelection(){
    const src = [...S.sel].map((id) => S.items.get(id)).filter(Boolean).sort((a, b) => (a.z || 0) - (b.z || 0));
    if (!src.length) return false;
    S.clip = src.map(snap); S.clipCut = true;
    deleteSelection();
    toast(`Cut ${src.length} · Ctrl+V pastes`);
    return true;
  }
  function paste(){
    if (!S.clip?.length) return false;
    // In place after a cut — unless an undo brought the cut drawings back (the clip keeps their ids).
    const off = S.clipCut && !S.clip.some((it) => S.items.has(it.id)) ? 0 : 20 * k();
    S.clipCut = false;
    const fresh = S.clip.map((it, i) => {
      const n = structuredClone(it);
      n.id = uid(); n.z = nextZ() + i;
      transformItem(n, it, (x, y) => [x + off, y + off]);
      n.data.note = null; n.data.reply = null; n.data.ctx = ctxNow(false, true); n.data.created = Date.now();
      return n;
    });
    S.clip = fresh.map(snap);
    commit(fresh.map((n) => n.id), () => { for (const n of fresh) S.items.set(n.id, n); });
    S.sel = new Set(fresh.map((n) => n.id));
    afterChange();
    return true;
  }
  function nudge(dx, dy){
    const ids = [...S.sel].filter((id) => editable(S.items.get(id)));
    if (!ids.length) return false;
    const kk = k();
    commit(ids, () => {
      for (const id of ids){ const it = S.items.get(id), src = snap(it); transformItem(it, src, (x, y) => [x + dx * kk, y + dy * kk]); }
    }, "nudge");
    return true;
  }
  function reorder(dir){
    // Only editable drawings get a new z (a locked one, see `baked`, keeps its own). Front goes above every drawing, back below
    // every drawing, so the values stay unique. The selection keeps its order among itself.
    const all = [...S.items.values()].filter(isDrawing);
    const sel = all.filter((it) => S.sel.has(it.id) && editable(it)).sort((a, b) => a.z - b.z);
    if (!sel.length) return false;
    const zs = all.map((it) => it.z || 0), top = Math.max(...zs), bottom = Math.min(...zs);
    commit(sel.map((it) => it.id), () => sel.forEach((it, i) => { it.z = dir > 0 ? top + 1 + i : bottom - sel.length + i; }));
    return true;
  }
  function selectAll(){
    S.sel = new Set(shownDrawings().map((it) => it.id));
    renderSel(); renderProps();
    return true;
  }

  // ---- toolbar / props ------------------------------------------------------------------------
  function buildBar(lightEl){
    const bar = document.createElement("div");
    bar.className = "an-top";
    bar.hidden = true;
    bar.innerHTML = `
      <div class="an-bar">
        ${TOOLS.map((t) => t ? `<button type="button" class="an-tool" data-tool="${t[0]}" title="${esc(t[2])} (${t[1].replace("Key", "")})">${t[3]}</button>` : `<span class="an-sep"></span>`).join("")}
        <span class="an-sep"></span>
        <button type="button" class="an-tool" data-act="undo" title="Undo (Ctrl+Z)">${ICON.undo}</button>
        <button type="button" class="an-tool" data-act="redo" title="Redo (Ctrl+Shift+Z)">${ICON.redo}</button>
        <button type="button" class="an-tool" data-act="clear" title="Clear the drawings on screen (Shift+Delete)">${ICON.trash}</button>
        <span class="an-sep"></span>
        <button type="button" class="an-tool" data-act="stamp" title="Frame stamp on the video (Shift+F) — drag it to a corner or a side">${ICON.stamp}</button><button type="button" class="an-tool an-chev" data-act="stampset" title="Frame stamp settings">▾</button>
        <button type="button" class="an-tool" data-act="panel" title="Review notes panel (C)">${ICON.panel}</button>
        <button type="button" class="an-tool" data-act="help" title="Keyboard shortcuts (?)">${ICON.help}</button>
      </div>
      <div class="an-props"></div>`;
    bar.addEventListener("pointerdown", (e) => e.stopPropagation());
    // While a text is being edited, the bar's buttons must not take the focus from it.
    bar.addEventListener("mousedown", (e) => { if (S.edit && !e.target.closest("input, select")) e.preventDefault(); });
    bar.querySelectorAll("[data-tool]").forEach((b) => { b.onclick = () => setTool(b.dataset.tool); });
    bar.querySelector("[data-act=undo]").onclick = () => undo();
    bar.querySelector("[data-act=redo]").onclick = () => redo();
    bar.querySelector("[data-act=clear]").onclick = () => clearShown();
    bar.querySelector("[data-act=stamp]").onclick = () => toggleStamp();
    bar.querySelector("[data-act=stampset]").onclick = () => toggleStampPop();
    buildStampPop(lightEl, bar);
    bar.querySelector("[data-act=panel]").onclick = () => togglePanel();
    bar.querySelector("[data-act=help]").onclick = () => toggleHelp();
    lightEl.appendChild(bar);
    return bar;
  }
  function paintBar(){
    const bar = S.bar;
    if (!bar) return;
    bar.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === S.tool));
    const sb = bar.querySelector("[data-tool=rect]"), sk = S.styles.rect.shape === "ellipse" ? "ellipse" : "rect";
    if (sb.dataset.shape !== sk){ sb.dataset.shape = sk; sb.innerHTML = ICON[sk]; }
    bar.querySelector("[data-tool=image]").hidden = isBoard() || host.refImages === false;  // a board places pictures itself
    bar.querySelector("[data-act=stamp]").hidden = bar.querySelector("[data-act=stampset]").hidden = S.kind !== "video";
    bar.querySelector("[data-act=stamp]").classList.toggle("on", stampOn());
    if (S.kind !== "video") closeStampPop();
    paintEye();
    const pb = bar.querySelector("[data-act=panel]");
    pb.hidden = readable();  // the lightbox / board have their own notes button
    pb.classList.toggle("on", S.panelOn);
  }
  // The shape tool's kind: R / O, the bar's Shape switch. (Old names still arrive: "ellipse".)
  function setShape(kind){ S.styles.rect.shape = kind; saveStyles(); setTool("rect"); }
  // Long-press on the annotate button: every toolbar preference back to its default (tool, per-tool colours / sizes /
  // options, the hold time, the frame stamp's look). The drawings, notes and the per-video stamp on / off stay.
  function resetPrefs(quiet){
    S.styles = structuredClone(DEFAULT_STYLES);
    S.stamp = { ...STAMP_DEFAULT };
    S.hold = 0;
    clearTimeout(styleTimer); clearTimeout(stampTimer);
    writeJSON("sight.annotate.styles", S.styles); writeJSON("sight.annotate.stamp", S.stamp); writeJSON("sight.annotate.hold", S.hold);
    if (S.bar){
      if (S.on) setTool("brush"); else S.tool = "brush";
      paintBar(); renderProps();
      try { paintStamp(true); paintStampPop(); } catch {}
    } else S.tool = "brush";
    if (!quiet) toast("Annotation toolbar reset to defaults");
  }
  function setTool(t){
    if (t === "ellipse"){ setShape("ellipse"); return; }
    if (t === "line") t = "arrow";
    if (!PROPS[t] || (t === "image" && !refsAllowed())) return;  // (Shift+I on a board: no such tool there)
    finishEdit();
    S.crop = null;
    S.tool = t;
    if (t !== "select" && S.sel.size){ S.sel.clear(); renderSel(); }
    paintAlt();
    paintBar();
    renderProps();
    if (S.hover) updateCursor(...S.hover);
    renderSel();
  }

  // The props bar shows the selection's properties when something is selected, else the tool's.
  function propsTarget(){
    const sel = [...S.sel].map((id) => S.items.get(id)).filter(Boolean);
    if (S.edit) return { items: [S.edit.it], type: "text" };
    if (sel.length){
      const types = [...new Set(sel.map(propType))];
      return { items: sel, type: types.length === 1 ? types[0] : null, types };
    }
    return { items: null, type: S.tool };
  }
  // The props a target shows: its type's; a mixed selection gets the ones every type has (the same descriptor:
  // a lasso + a brush keep Size / Pressure, a rectangle + an ellipse their outline and fill; at least Colour).
  function propList(tg){
    if (tg.type) return PROPS[tg.type] || [];
    const [first = [], ...rest] = (tg.types || []).map((t) => PROPS[t] || []);
    return first.filter((p) => rest.every((l) => l.includes(p)));
  }
  // The Lines control's maximum for what it edits (RC.hatchMetrics' cap of the spacing; the smallest of a selection's),
  // in the control's px: a width stored above it (the spacing was reduced) shows and edits as the cap.
  function hatchCap(tg){
    if (!tg.items){ const st = S.styles[tg.type] || {}; return RC.hatchMetrics({ pattern: st.pattern, gap: st.gap, size: st.size }).cap; }
    return Math.min(...tg.items.map((it) => RC.hatchMetrics(it.data).capStored)) / k();
  }
  function propValue(tg, p){
    if (!tg.items){
      const v = S.styles[tg.type][p.k];
      return p.k === "hatchWidth" && v > 0 ? Math.min(v, hatchCap(tg)) : v;
    }
    let v = tg.items[0].data[p.k];
    if (p.k === "hatchWidth" && v > 0) return Math.min(v / k(), hatchCap(tg));
    return LEN_KEYS.has(p.k) && typeof v === "number" ? v / k() : v;
  }
  // numDrag: a value is being dragged in the bar. A change to a selected drawing re-renders the bar (commit →
  // afterChange), which would replace the dragged control and drop its pointer capture — the drag then ended as
  // soon as the pointer left the field. The bar waits until the drag ends. It holds the dragged control: a control
  // no longer in the page (the lightbox closed mid-drag) does not hold the bar back.
  let numDrag = null;
  function renderProps(){
    const el = S.bar?.querySelector(".an-props");
    if (!el || numDrag?.isConnected) return;
    if (S.crop && !cropItem()) S.crop = null;  // cropping ends with the image's selection
    const tg = propsTarget();
    let list = propList(tg);
    if (tg.items) list = list.filter((p) => !p.create);
    else list = list.filter((p) => !p.edit);
    list = list.filter((p) => !p.when || p.when((key) => propValue(tg, { k: key })));
    if (!tg.items && tg.type === "rect" && S.styles.rect.shape === "ellipse") list = list.filter((p) => p.k !== "radius");
    let html = "";
    if (tg.items) html += `<span class="an-pl">${tg.items.length > 1 ? tg.items.length + " selected" : (tg.type || "")}</span>`;
    for (const p of list){
      const v = propValue(tg, p);
      if (p.t === "color"){
        html += `<label class="an-pc" title="${esc(p.label)}"><input type="color" data-k="${p.k}" value="${esc(v || "#000000")}"></label>`;
        if (p.k === "color") html += `<span class="an-sw">${SWATCHES.map((c) => `<i data-sw="${c}" style="background:${c}" title="${c}"></i>`).join("")}</span>`;
      } else if (p.t === "num"){
        html += `<span class="an-num" data-k="${p.k}" data-p="${list.indexOf(p)}" title="Drag, scroll or click to type"><b>${esc(p.label)}</b><em>${fmtNum(p, v)}</em></span>`;
      } else if (p.t === "toggle"){
        html += `<button type="button" class="an-tg${p.cls ? " " + p.cls : ""}${v ? " on" : ""}" data-k="${p.k}" title="${esc(p.title || p.label)}">${p.ico || esc(p.label)}</button>`;
      } else if (p.t === "cycle"){
        // One button for a few choices: it shows the current one's icon, a click / tap moves to the next.
        const i = Math.max(0, p.options.findIndex(([id]) => id === v)), nx = p.options[(i + 1) % p.options.length];
        if (p.fixed) html += `<button type="button" class="an-tg${i ? " on" : ""}" data-k="${p.k}" data-cyc title="${esc(p.options[1][1])} (${i ? "on" : "off"})">${p.options[1][2]}</button>`;
        else html += `<button type="button" class="an-tg" data-k="${p.k}" data-cyc title="${esc(p.label)}: ${esc(p.options[i][1])} — click for ${esc(nx[1].toLowerCase())}">${p.options[i][2]}</button>`;
      } else if (p.t === "select"){
        html += `<label class="an-psel" title="${esc(p.label)}"><span>${esc(p.label)}</span><select data-k="${p.k}">${p.options.map(([id, n]) => `<option value="${id}"${id === v ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></label>`;
      } else if (p.t === "seg"){
        // Options with an icon ([id, name, icon]: the lasso's patterns) show it, the name as the tooltip.
        const icons = p.options.some((o) => o[2]);
        html += `<span class="an-seg${icons ? " ico" : ""}" role="group" title="${esc(p.label)}" aria-label="${esc(p.label)}">${p.options.map(([id, n, ic]) => `<button type="button" data-k="${p.k}" data-v="${id}" class="${id === v ? "on" : ""}"${ic ? ` title="${esc(n)}" aria-label="${esc(n)}"` : ""} aria-pressed="${id === v}">${ic || esc(n)}</button>`).join("")}</span>`;
      }
    }
    if (S.kind === "video" && !tg.items && S.tool !== "select" && S.tool !== "eraser"){
      html += `<label class="an-psel" title="How long new drawings stay on screen"><span>Hold</span><select data-hold>${HOLDS.map(([v, n]) => `<option value="${v}"${v === S.hold ? " selected" : ""}>${n}</option>`).join("")}</select></label>`;
    }
    if (tg.items && tg.items.some((it) => editable(it) && S.kind === "video" && it.data.ctx?.t != null)){
      const h = tg.items.find((it) => editable(it) && it.data.ctx?.t != null).data.ctx?.hold ?? 0;
      html += `<label class="an-psel" title="How long the selection stays on screen"><span>Hold</span><select data-shold>${HOLDS.map(([v, n]) => `<option value="${v}"${v === h ? " selected" : ""}>${n}</option>`).join("")}</select></label>`;
    }
    // Reference images: where pictures come from (the tool), crop (one selected picture).
    if (!tg.items && S.tool === "image" && refsAllowed()){
      html += `<span class="an-sep"></span><button type="button" class="an-tg" data-cmd="refdisk" title="Pick pictures on this computer — or click the frame where they should go">From disk…</button>`;
      if (host.toggleLibrary) html += `<button type="button" class="an-tg" data-cmd="reflib" title="Show the library beside the player and drag pictures from it onto the frame (Tab)">Library</button><button type="button" class="an-tg" data-cmd="refsel" title="Add the pictures selected in the library">Add selected</button>`;
    }
    if (tg.items && tg.type === "image" && tg.items.length === 1 && editable(tg.items[0])){
      html += `<span class="an-sep"></span><button type="button" class="an-tg${cropItem() ? " on" : ""}" data-cmd="crop" title="Crop — drag the edges, drag inside to move the picture (double-click the picture; Enter / Esc to finish)">Crop</button>`;
      if (tg.items[0].data.crop) html += `<button type="button" class="an-tg" data-cmd="uncrop" title="Show the whole picture again">Reset crop</button>`;
    }
    if (tg.items){
      html += `<span class="an-sep"></span><button type="button" class="an-tg" data-cmd="front" title="Bring to front (Ctrl+])">Front</button><button type="button" class="an-tg" data-cmd="back" title="Send to back (Ctrl+[)">Back</button><button type="button" class="an-tg" data-cmd="del" title="Delete (Del)">${ICON.trash}</button>`;
    }
    // 3D: plain empty-space drags orbit, so touch (no Ctrl) gets a switch that makes them draw a marquee.
    if (S.kind === "model3d" && S.tool === "select"){
      html += `<span class="an-sep"></span><button type="button" class="an-tg${S.box3d ? " on" : ""}" data-cmd="box3d" title="Box select: dragging empty space draws a selection box instead of orbiting (or hold Ctrl and drag)">Box</button>`;
      if (!tg.items) html += `<span class="an-pl">${S.box3d ? "Drag to box-select · Ctrl+drag toggles" : "Click a drawing to select · drag empty space to orbit · Ctrl+drag to box-select"}</span>`;
    }
    if (!html) html = `<span class="an-pl">${S.tool === "select" ? "Click or drag to select · Ctrl toggles · Shift adds · Alt+drag duplicates" : ""}</span>`;
    el.innerHTML = html;
    el.hidden = !html;
    bindProps(el, tg, list);
  }
  function fmtNum(p, v){
    if (p.auto && !(v > 0)) return "Auto";
    if (v == null || Number.isNaN(v)) return "—";
    if (p.pct) return Math.round(v * 100) + "%";
    if (p.unit === "×") return (Math.round(v * 10) / 10) + "×";
    return (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10) + (p.unit === "px" ? "" : p.unit || "");
  }
  function setProp(p, v, merge){
    const tg = propsTarget();
    if (!tg.items){
      S.styles[tg.type][p.k] = v;
      saveStyles();
      if (p.k === "shape") paintBar();  // the shape tool's icon follows its kind
      return;
    }
    const ids = tg.items.map((it) => it.id).filter((id) => S.items.has(id) && editable(S.items.get(id)));
    const dv = LEN_KEYS.has(p.k) && typeof v === "number" ? v * k() : v;
    if (S.edit){ S.edit.it.data[p.k] = dv; S.edit.place(); if (p.t !== "color") S.edit.ta.focus(); return; }
    if (!ids.length) return;
    // (An Auto value — hatchWidth 0 — is not stored: the field goes.)
    commit(ids, () => { for (const id of ids){ const it = S.items.get(id); if (PROPS[propType(it)]?.some((q) => q.k === p.k)){ if (p.auto && !(dv > 0)) delete it.data[p.k]; else it.data[p.k] = dv; } } }, merge ? "prop:" + p.k : null);
  }
  function bindProps(el, tg, list){
    el.querySelectorAll("input[type=color][data-k]").forEach((inp) => {
      const p = list.find((q) => q.k === inp.dataset.k && q.t === "color");
      inp.addEventListener("input", () => setProp(p, inp.value, true));
    });
    el.querySelectorAll("[data-sw]").forEach((sw) => {
      sw.onclick = () => { setProp(P.color, sw.dataset.sw, false); renderProps(); };
    });
    el.querySelectorAll("button[data-cyc]").forEach((b) => {
      const p = list.find((q) => q.k === b.dataset.k);
      b.onclick = () => {
        const i = Math.max(0, p.options.findIndex(([id]) => id === propValue(propsTarget(), p)));
        setProp(p, p.options[(i + 1) % p.options.length][0], false);
        renderProps();
      };
    });
    el.querySelectorAll("button[data-k]:not([data-v]):not([data-cyc])").forEach((b) => {
      const p = list.find((q) => q.k === b.dataset.k);
      b.onclick = () => { setProp(p, !propValue(propsTarget(), p), false); renderProps(); };
    });
    el.querySelectorAll("button[data-v]").forEach((b) => {
      const p = list.find((q) => q.k === b.dataset.k);
      b.onclick = () => { setProp(p, b.dataset.v, false); renderProps(); };
    });
    el.querySelectorAll("select[data-k]").forEach((s) => {
      const p = list.find((q) => q.k === s.dataset.k);
      s.addEventListener("change", () => { setProp(p, s.value, false); renderProps(); });
    });
    el.querySelector("select[data-hold]")?.addEventListener("change", (e) => { S.hold = Number(e.target.value); writeJSON("sight.annotate.hold", S.hold); });
    el.querySelector("select[data-shold]")?.addEventListener("change", (e) => {
      const v = Number(e.target.value), ids = tg.items.filter(editable).map((it) => it.id);
      if (!ids.length) return;
      commit(ids, () => { for (const id of ids){ const c = S.items.get(id).data.ctx; if (c && c.t != null) c.hold = v; } });
    });
    el.querySelector("[data-cmd=front]")?.addEventListener("click", () => reorder(1));
    el.querySelector("[data-cmd=back]")?.addEventListener("click", () => reorder(-1));
    el.querySelector("[data-cmd=del]")?.addEventListener("click", () => deleteSelection());
    el.querySelector("[data-cmd=box3d]")?.addEventListener("click", () => { S.box3d = !S.box3d; renderProps(); });
    el.querySelector("[data-cmd=refdisk]")?.addEventListener("click", () => pickRefs(null));
    el.querySelector("[data-cmd=reflib]")?.addEventListener("click", () => host.toggleLibrary?.());
    el.querySelector("[data-cmd=refsel]")?.addEventListener("click", () => addSelectedRefs());
    el.querySelector("[data-cmd=crop]")?.addEventListener("click", () => { if (!endCrop()) startCrop(); });
    el.querySelector("[data-cmd=uncrop]")?.addEventListener("click", () => { resetCrop(); renderProps(); });
    el.querySelectorAll(".an-num").forEach((n) => bindNum(n, list[Number(n.dataset.p)]));
  }
  // Compact number control: drag sideways, scroll, or click to type.
  function bindNum(el, p){
    const em = el.querySelector("em");
    const get = () => Number(propValue(propsTarget(), p)) || 0;
    // An Auto value (0) starts a drag / scroll from the hatchWidth that draws what Auto draws (RC.hatchMetrics: a
    // selected lasso's autoStored — hatchWidth is relative to the uncapped spacing; the tool's, in screen px).
    const autoNow = () => {
      const tg = propsTarget();
      if (tg.items) return RC.hatchMetrics(tg.items[0].data).autoStored / k();
      const st = S.styles[tg.type] || {};
      return RC.hatchMetrics({ pattern: st.pattern, gap: st.gap, size: st.size }).auto;
    };
    const cur = () => get() || (p.auto ? autoNow() : 0);
    const set = (v, merge) => {
      v = p.auto && !(v > 0) ? 0 : clamp(v, p.min, p.k === "hatchWidth" ? Math.max(p.min, hatchCap(propsTarget())) : p.max);
      if (!p.pct && p.unit !== "×") v = v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
      else if (p.pct) v = Math.round(v * 100) / 100;
      if (p.k === "hatchWidth" && v > 0) v = Math.min(v, Math.max(p.min, hatchCap(propsTarget())));  // (rounding must not step over the cap)
      setProp(p, v, merge);
      em.textContent = fmtNum(p, v);
    };
    const stepBy = (v, n) => p.exp ? v * Math.exp(n * 0.012) : v + n * (p.pct ? 0.005 : (p.max - p.min) / 300);
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const x0 = e.clientX, v0 = cur();
      let moved = false;
      numDrag = el;
      // What the drag changes: the selection (or the tool) it started on. Another one (Esc, Delete, a tool key,
      // undo mid-drag) ends the drag rather than writing the value into it.
      const tgKey = () => { const t = propsTarget(); return t.items ? t.items.map((it) => it.id).join() : "tool:" + S.tool; };
      const key0 = tgKey();
      const mv = (ev) => {
        if (tgKey() !== key0){ up(); return; }
        const dx = ev.clientX - x0;
        if (!moved && Math.abs(dx) < 3) return;
        moved = true;
        set(stepBy(v0 || (p.exp ? p.min : 0), dx * (ev.shiftKey ? 0.2 : 1)), true);
      };
      const up = () => {
        el.removeEventListener("pointermove", mv);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
        el.removeEventListener("lostpointercapture", up);
        if (numDrag !== el) return;  // (pointerup, then lostpointercapture: once)
        numDrag = null;
        try { el.releasePointerCapture(e.pointerId); } catch {}
        if (!moved && tgKey() === key0 && el.isConnected) typeNum(el, p, get(), (v) => set(v, false));
        else renderProps();
      };
      el.addEventListener("pointermove", mv);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      el.addEventListener("lostpointercapture", up);  // whatever ends the capture ends the drag (numDrag never sticks)
    });
    el.addEventListener("wheel", (e) => { e.preventDefault(); e.stopPropagation(); set(stepBy(cur(), (e.deltaY < 0 ? 8 : -8)), true); }, { passive: false });
    // Right-click: the default — for a selection each drawing its own type's (a brush and a highlighter selected
    // together: opacity 1 and 0.4).
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const tg = propsTarget();
      if (!tg.items || S.edit){ const dflt = (DEFAULT_STYLES[tg.type] || {})[p.k]; if (dflt != null) set(dflt, false); return; }
      const ids = tg.items.map((it) => it.id).filter((id) => S.items.has(id) && editable(S.items.get(id)));
      if (!ids.length) return;
      commit(ids, () => {
        for (const id of ids){
          const it = S.items.get(id), ty = propType(it), dflt = (DEFAULT_STYLES[ty] || {})[p.k];
          if (dflt == null || !PROPS[ty]?.some((q) => q.k === p.k)) continue;
          if (p.auto && !(dflt > 0)) delete it.data[p.k];
          else it.data[p.k] = LEN_KEYS.has(p.k) && typeof dflt === "number" ? dflt * k() : dflt;
        }
      });
      renderProps();
    });
  }
  function typeNum(el, p, v, done){
    const em = el.querySelector("em");
    const inp = document.createElement("input");
    inp.className = "an-numedit";
    inp.value = p.pct ? Math.round(v * 100) : Math.round(v * 10) / 10;
    em.replaceWith(inp);
    inp.focus(); inp.select();
    // (Once: replacing the focused field fires its blur, which would end it a second time mid-replace.)
    let ended = false;
    const end = (ok) => {
      if (ended || !inp.isConnected) return;
      ended = true;
      const n = parseFloat(inp.value.replace(",", "."));
      inp.replaceWith(em);
      if (ok && Number.isFinite(n)) done(p.pct ? n / 100 : n);
    };
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (hotkey(e, "Enter")){ e.preventDefault(); end(true); }
      else if (hotkey(e, "Escape")){ e.preventDefault(); end(false); }
    });
    inp.addEventListener("blur", () => end(true));
  }

  // ---- review panel ---------------------------------------------------------------------------
  function buildPanel(lightEl){
    const el = document.createElement("aside");
    el.className = "an-panel";
    el.hidden = true;
    el.innerHTML = `
      <div class="an-ph">
        <b>Review</b>
        <button type="button" class="an-ib an-user" data-userbtn data-act="user" title="Reviewer name and tracker logins"></button>
        <span class="an-trks"></span>
        <button type="button" class="an-ib" data-act="export" title="Export / import">Export ▾</button>
        <button type="button" class="an-ib" data-act="close" title="Hide panel (C)">${ICON.close}</button>
      </div>
      <div class="an-menu" hidden>
        <button type="button" data-ex="pdf">PDF report…</button>
        <button type="button" data-ex="html" title="One file that opens in any browser — the reviewer can reply, resolve and add notes, then send back a .srev">Web page for reviewers (.html)…</button>
        <button type="button" data-ex="pkg">Review file (.srev)…</button>
        <button type="button" data-ex="zip" title="A folder per note: its pictures (named by file and frame) and a text file with the note's text and its pictures' texts">Notes as ZIP (pictures + text)…</button>
        <button type="button" data-ex="text">Copy notes as text</button>
        <div class="an-mseq" hidden>
          <hr><div class="an-mlbl">Every clip in the sequence with notes</div>
          <button type="button" data-exall="pdf" title="One PDF: a section per clip">PDF report, all clips…</button>
          <button type="button" data-exall="zip" title="One ZIP: a folder per clip, then a folder per note">Notes as ZIP, all clips…</button>
          <button type="button" data-exall="html" title="A web page per clip">Web pages, all clips…</button>
          <button type="button" data-exall="pkg" title="One review file holding every clip with notes, or whose notes were deleted since (needs Sight 0.75 or later to open)">Review file (.srev), all clips…</button>
        </div>
        <hr>
        <button type="button" data-ex="import">Import review file…</button>
        <div class="an-mbg"><hr><div class="an-mlbl" title="When drawings reach past the frame, exported pictures widen to them; this fills the added margin">Backdrop past the frame</div>
          <div class="an-mbgrow"><span class="an-seg"><button type="button" data-xbg="auto" title="The colour of the frame's edge">Auto</button><button type="button" data-xbg="color" title="A colour of your choice">Colour</button></span><input type="color" class="an-xbgc" title="Backdrop colour"></div></div>
      </div>
      <div class="an-menu an-trk" hidden></div>
      <div class="an-rs"><span>State</span><div class="an-seg">
        <button type="button" data-rs="" title="No review state">—</button>
        <button type="button" data-rs="review" title="Waiting for review">Needs review</button>
        <button type="button" data-rs="changes" title="Changes requested">Changes</button>
        <button type="button" data-rs="approved" title="Approved">Approved</button></div></div>
      <div class="an-rsh" hidden></div>
      <div class="an-vers" hidden></div>
      <div class="an-filt an-seg"></div>
      <div class="an-list"></div>
      <div class="an-compose">
        <div class="an-pend"></div>
        <div class="an-views" hidden></div>
        <textarea class="an-input" data-dict rows="2" placeholder="Add a note…  Enter adds · Shift+Enter new line"></textarea>
        <textarea class="an-input an-cin" data-dict rows="1" placeholder="Text for this picture (optional)"></textarea>
        <div class="an-crow">
          <button type="button" class="an-ib" data-act="shot" title="Screenshot (S)">${ICON.shot}</button>
          <button type="button" class="an-ib" data-act="region" title="Screenshot of an area (Shift+S)">${ICON.region}</button>
          <button type="button" class="an-ib" data-act="dict"></button>
          <span class="an-ctx"></span>
          <button type="button" class="btn an-add" data-act="add">Add</button>
        </div>
      </div>
      <input type="file" class="an-file" accept=".srev,.sightreview,application/json" hidden>`;
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
    el.addEventListener("error", (e) => { if (e.target?.dataset?.np) npMissing(e.target); }, true);  // a stored preview gone
    // The reviewer name lives in the user panel (index.html openUserPanel), the same one as the sidebar's person button.
    const who = el.querySelector(".an-user");
    who.onclick = () => host.userPanel?.(who);
    host.paintUserBtns?.(el);  // (not in the page yet)
    const menu = el.querySelector(".an-menu:not(.an-trk)"), exBtn = el.querySelector("[data-act=export]");
    exBtn.onclick = () => {
      menu.hidden = !menu.hidden;
      if (!menu.hidden){ paintXbg(); menu.querySelector(".an-mbg").hidden = isBoard() || S.kind === "model3d"; }  // (2D pictures only)
      // A sequence: the same exports for every clip of it that has notes (the host walks the clips).
      if (!menu.hidden) menu.querySelector(".an-mseq").hidden = !(host.seqClips?.() > 1) || isBoard();
    };
    // Export backdrop past the frame: Auto, or a colour (the swatch also switches to Colour when one is picked).
    const xbgc = menu.querySelector(".an-xbgc");
    const paintXbg = () => {
      const v = exportBgSetting();
      menu.querySelectorAll("[data-xbg]").forEach((b) => b.classList.toggle("on", (b.dataset.xbg === "auto") === (v === "auto")));
      if (v !== "auto") xbgc.value = v;
    };
    xbgc.value = readJSON("sight.annotate.exportBgColor", "#000000");
    menu.querySelectorAll("[data-xbg]").forEach((b) => { b.onclick = () => { writeJSON("sight.annotate.exportBg", b.dataset.xbg === "auto" ? "auto" : xbgc.value); paintXbg(); }; });
    xbgc.addEventListener("input", () => { writeJSON("sight.annotate.exportBg", xbgc.value); writeJSON("sight.annotate.exportBgColor", xbgc.value); paintXbg(); });
    paintXbg();
    menu.querySelectorAll("[data-exall]").forEach((b) => { b.onclick = () => { menu.hidden = true; host.seqExport?.(b.dataset.exall); }; });
    host.registerAutoClose?.(menu, () => { menu.hidden = true; }, exBtn);
    menu.querySelectorAll("[data-ex]").forEach((b) => {
      b.onclick = () => {
        menu.hidden = true;
        const x = b.dataset.ex;
        if (x === "pdf") exportPdf();
        else if (x === "html") exportHtml();
        else if (x === "pkg") exportPackage();
        else if (x === "zip") exportZip();
        else if (x === "text") copyText();
        else if (x === "import") el.querySelector(".an-file").click();
      };
    });
    el.querySelector(".an-file").addEventListener("change", (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importFile(f); });
    el.querySelector("[data-act=close]").onclick = () => togglePanel(false);
    el.querySelectorAll("[data-rs]").forEach((b) => { b.onclick = () => setStatus(b.dataset.rs); });
    el.querySelector(".an-compose [data-act=shot]").onclick = () => screenshot(false);
    el.querySelector(".an-compose [data-act=region]").onclick = () => screenshot(true);
    el.querySelector("[data-act=add]").onclick = () => addNote();
    // Dictation: the mic dictates into the composer field that was focused last (the note by default).
    el.addEventListener("focusin", (e) => { if (e.target.matches?.(".an-compose textarea")) S.dictTa = e.target; });
    S.dict?.mic(el.querySelector("[data-act=dict]"), () => { const t = S.dictTa; return t && t.isConnected ? t : el.querySelector(".an-input"); });
    const inp = el.querySelector(".an-input");
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (hotkey(e, "Ctrl+KeyC") && inp.selectionStart === inp.selectionEnd && copyHoveredText()){ e.preventDefault(); return; }  // nothing selected here: the hovered text
      if (hotkey(e, "Enter")){ e.preventDefault(); addNote(); }
      else if (hotkey(e, "Escape")){ e.preventDefault(); inp.blur(); }
    });
    inp.addEventListener("input", () => { inp.style.height = "auto"; inp.style.height = Math.min(160, inp.scrollHeight + 2) + "px"; modeChanged(); });
    // Typing a new note shows the clean picture (with only the new note's drawings).
    inp.addEventListener("focus", modeChanged);
    inp.addEventListener("blur", modeChanged);
    // The second field: the text of the picture the note is made on (this frame / this view), FORMAT.md
    // captions. The note's own text is the topic. Same keys as the note field.
    const cin = el.querySelector(".an-cin");
    cin.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (hotkey(e, "Ctrl+KeyC") && cin.selectionStart === cin.selectionEnd && copyHoveredText()){ e.preventDefault(); return; }  // nothing selected here: the hovered text
      if (hotkey(e, "Enter")){ e.preventDefault(); addNote(); }
      else if (hotkey(e, "Escape")){ e.preventDefault(); cin.blur(); }
    });
    cin.addEventListener("input", () => { cin.style.height = "auto"; cin.style.height = Math.min(120, cin.scrollHeight + 2) + "px"; modeChanged(); });
    cin.addEventListener("focus", modeChanged);
    cin.addEventListener("blur", modeChanged);
    el.querySelector(".an-filt").addEventListener("click", (e) => {
      const b = e.target.closest?.("[data-filt]");
      if (!b) return;
      S.filter = b.dataset.filt;
      writeJSON("sight.annotate.filter", S.filter);
      renderPanel();
    });
    // Scrolls like the other lightbox panels: the wheel (native) and middle-drag (index.html attachPanScroll).
    host.panScroll?.(el.querySelector(".an-list"));
    el.querySelector(".an-list").addEventListener("click", onListClick);
    el.querySelector(".an-list").addEventListener("dblclick", onListDblClick);
    bindThumbZoom(el, el.querySelector(".an-list"));
    el.querySelector(".an-pend").addEventListener("click", (e) => {
      const x = e.target.closest?.("[data-rm]");
      if (x){ S.pending.splice(Number(x.dataset.rm), 1); renderPending(); return; }
      const im = e.target.closest?.("img[data-src]");
      if (im) showShot(im.dataset.src);
    });
    lightEl.appendChild(el);
    return el;
  }
  function focusComposer(){
    if (!panelShown()) togglePanel(true);
    requestAnimationFrame(() => S.ui?.querySelector(".an-input")?.focus());
  }
  function dictateNote(){
    if (!panelShown()) togglePanel(true);
    requestAnimationFrame(() => { const t = S.dictTa?.isConnected ? S.dictTa : S.ui?.querySelector(".an-input"); if (t) S.dict?.toggle(t); });
  }
  // The notes panel is one switch (S.readOn: the notes button, C), whether drawing or not — the drawing mode
  // neither opens nor closes it. A host without a reading panel (the version compare, host.readPanel false) shows
  // it only while drawing, per S.panelOn (the toolbar's panel button, shown there only).
  function togglePanel(force){
    if (readable()){
      S.readOn = force ?? !S.readOn; writeJSON(readKey, S.readOn);
      // Closing the panel while just watching lets go of the picked note: all the drawings show again.
      if (!S.readOn && !S.on && S.pinFocus){ S.pinFocus = null; paintVisibility(); }
    } else if (S.on){ S.panelOn = force ?? !S.panelOn; writeJSON(panelKey, S.panelOn); }
    syncPanel();
  }
  const readable = () => host.readPanel !== false;
  const panelShown = () => !!S.ui && supported() && (readable() ? S.readOn : S.on && S.panelOn);
  function syncPanel(){
    const show = panelShown();
    if (S.ui){ S.ui.hidden = !show; S.ui.classList.toggle("an-read", !S.on); }
    paintBadge();
    S.light?.classList.toggle("an-panel-on", show);
    paintBar();
    paintBoardPanel();
    if (show) renderPanel();
  }
  // A board has no picture: the panel drops the review state, the picture text, screenshots and every export but
  // "Copy notes as text" (the .srev / PDF / page / ZIP / import formats are per asset, see docs/FORMAT.md).
  function paintBoardPanel(){
    const el = S.ui;
    if (!el) return;
    const b = isBoard();
    el.classList.toggle("an-board", b);
    el.querySelectorAll("[data-ex]:not([data-ex=text])").forEach((x) => { x.hidden = b; });
    el.querySelector(".an-menu:not(.an-trk) > hr").hidden = b;
    el.querySelector(".an-mbg").hidden = b;
    // a link ▾ per connected tracker, none on a board (no media entity) (docs/PLAN-trackers.md decisions 10, 11)
    paintTrkBtns(b);
  }
  // a tracker connected / disconnected in Settings → Trackers (index.html refreshTrackers): its link ▾ comes / goes live
  window.addEventListener("sight-trackers", () => { if (S.ui) paintBoardPanel(); });

  // ---- Trackers (docs/ARCHITECTURE.md "Tracker adapters"; ShotGrid: docs/SHOTGRID.md) -------------------------------
  // A link ▾ per connected tracker in the panel header (its adapter's short name: ShotGrid's reads "SG ▾"). Its popover:
  // link this file to one of the tracker's media entities (project + search, or the one its notes already name), then
  // Sync — the adapter's sync pulls the tracker's notes / replies / pictures (merged by /api/review/import), sends the
  // notes written here (pictures = the report's frames with drawings burned in) and stamps the tracker's ids on the
  // rows. Credentials stay in Sight's server (app/trackers.py); this side only talks to /api/trackers/<tracker key>/… (one link ▾ per connected site, several of one kind included).
  const TRK = () => globalThis.SightTrackers;
  const trkHeaders = { "X-Sight": "1" };
  const trkPath = (key, p) => `/api/trackers/${encodeURIComponent(key)}/${p}`;   // (key: the tracker key)
  const trkAdapter = (key) => TRK()?.adapter(TRK().split(key)?.kind) || null;
  // a per-site setting (the last project picked): "<the kind's name>@<host>", read falling back to the kind's own
  const trkStoreName = (A, key, n) => TRK().storeName(A, n, undefined, TRK().split(key)?.host);
  const trkStored = (A, key, n) => TRK().readStored((k) => localStorage.getItem(k), A, n, undefined, TRK().split(key)?.host);
  async function trkApi(path, opts = {}){
    const r = await fetch(path, { ...opts, headers: { ...trkHeaders, ...(opts.headers || {}) } });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(j?.detail || j?.errors?.[0]?.title || `HTTP ${r.status}`);
    return j;
  }
  // the connected trackers this page has an adapter for (index.html refreshTrackers → host.trackers)
  const trkConnected = () => (host.trackers?.() || []).filter((t) => t && TRK()?.adapterOf(t));
  async function trkClient(key){
    const A = trkAdapter(key);
    const st = await trkApi(trkPath(key, "status"));
    if (!st.configured) throw new Error(`${A.name} is not connected: Settings → Trackers`);
    return { st, A, client: A.serverClient(st.site, key) };
  }
  // The header's link buttons, one per connected tracker (none on a board: no media entity to link).
  function paintTrkBtns(board){
    const box = S.ui?.querySelector(".an-trks");
    if (!box) return;
    const list = board ? [] : trkConnected();
    const sig = list.map((t) => t.key).join(" ");
    if (box.dataset.sig !== sig){
      box.dataset.sig = sig;
      box.innerHTML = list.map((t) => { const A = TRK().adapterOf(t);
        return `<button type="button" class="an-ib" data-act="trk" data-tracker="${esc(t.key)}" data-kind="${esc(t.kind)}" title="${esc(A.name)}${t.host ? " · " + esc(t.host) : ""}: link this file to a ${esc(A.media.one)} and sync the notes both ways">${esc(A.short)}${TRK().siteLabel(t, list) ? " · " + esc(TRK().siteLabel(t, list)) : ""} ▾</button>`; }).join("");
      box.querySelectorAll("[data-act=trk]").forEach((b) => { b.onclick = () => openTrk(b.dataset.tracker, b); });
    }
    if (!list.some((t) => t.key === trkState.key)){ const pop = S.ui.querySelector(".an-trk"); if (pop) pop.hidden = true; }
  }
  function openTrk(key, btn){
    const pop = S.ui?.querySelector(".an-trk");
    if (!pop) return;
    if (!pop.hidden && trkState.key === key){ pop.hidden = true; return; }
    if (trkState.key !== key){ Object.assign(trkState, { key, msg: "", picking: false, projects: null, projSite: "" }); }
    // one auto-close entry for the popover, anchored at the button that opened it this time (the buttons are
    // re-made when the trackers change: a gone anchor closes it)
    const ent = host.registerAutoClose?.(pop, () => { pop.hidden = true; }, btn);
    if (ent){ ent.anchor = btn; ent.armed = false; }
    pop.hidden = false;
    S.ui.querySelector(".an-menu:not(.an-trk)").hidden = true;
    trkPaint();
  }
  async function trkPaint(){
    const box = S.ui?.querySelector(".an-trk");
    if (!box || box.hidden || !S.asset) return;
    const key = trkState.key, A = trkAdapter(key);
    if (!A){ box.hidden = true; return; }
    const aid = S.asset.id;
    if (trkState.aid !== aid){ trkState.aid = aid; trkState.msg = ""; trkState.picking = false; }
    let st, cur;
    try { [st, cur] = await Promise.all([trkApi(trkPath(key, "status")), trkApi(trkPath(key, `link/${encodeURIComponent(aid)}`))]); }
    catch (e){ if (trkState.key === key) box.innerHTML = `<div class="an-mlbl">${esc(e.message)}</div>`; return; }
    if (S.asset?.id !== aid || trkState.key !== key) return;
    const msg = trkState.msg ? `<div class="an-trkmsg">${trkState.msg}</div>` : "";
    if (!st.configured){ box.innerHTML = `<div class="an-mlbl">${esc(A.name)} is not connected — Settings → Trackers.</div>`; return; }
    const L = cur.link, busy = trkState.busy === key;
    if (L && !trkState.picking){
      const last = cur.state?.last ? fmtDate(cur.state.last) : "never";
      box.innerHTML = `<div class="an-mlbl">Linked to <b>${esc(A.linkLabel(L))}</b>${A.linkProject(L) ? " · " + esc(A.linkProject(L)) : ""}<br>Last sync: ${esc(last)}</div>
        <button type="button" data-trk="sync" ${trkState.busy ? "disabled" : ""}>${busy ? "Syncing…" : "Sync now"}</button>
        <button type="button" data-trk="pick">Link to another ${esc(A.media.one)}…</button>
        <button type="button" data-trk="unlink">Unlink</button>${msg}`;
    } else {
      // Pick: the media entity the notes already name (sent from another machine / the phone), or project + search.
      const known = A.linkedIdOf(S.items ? [...S.items.values()] : [], A.siteHost(st.site));
      const stem = (S.asset.name || "").replace(/\.[^.]+$/, "");
      box.innerHTML = `<div class="an-mlbl">Link <b>${esc(S.asset.name)}</b> to a ${esc(A.name)} ${esc(A.media.one)}</div>
        ${known ? `<button type="button" data-trk="known">${esc(A.media.one)} #${esc(known)} (from the notes)</button>` : ""}
        <select class="an-trkproj"><option value="">Loading projects…</option></select>
        <input class="an-trkq" type="search" placeholder="${esc(A.media.one)} name contains…" value="${esc(stem)}" spellcheck="false">
        <div class="an-trklist"></div>
        ${L ? `<button type="button" data-trk="back">Cancel</button>` : ""}${msg}`;
      const sel = box.querySelector(".an-trkproj"), q = box.querySelector(".an-trkq"), list = box.querySelector(".an-trklist");
      q.addEventListener("keydown", (e) => { e.stopPropagation(); if (hotkey(e, "Enter")) find(); });
      let timer = 0;
      q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(find, 400); });
      sel.onchange = () => { try { host.putSetting(trkStoreName(A, key, "project"), sel.value); } catch {} find(); };
      async function find(){
        if (!sel.value){ list.innerHTML = ""; return; }
        list.innerHTML = `<div class="an-mlbl">Searching…</div>`;
        try {
          const { client } = await trkClient(key);
          let vs = await A.findMedia(client, sel.value, q.value.trim());
          if (!vs.length && q.value.trim()){ const short = q.value.trim().replace(/[_. -]*v\d+$/i, ""); if (short !== q.value.trim()) vs = await A.findMedia(client, sel.value, short); }
          list.innerHTML = vs.length ? vs.map((v) => `<button type="button" data-rec="${esc(A.recordId(v))}">${esc(A.recordName(v))}${A.recordSub(v) ? ` <small>${esc(A.recordSub(v))}</small>` : ""}</button>`).join("")
            : `<div class="an-mlbl">No ${esc(A.media.one)} found</div>`;
          list.querySelectorAll("[data-rec]").forEach((b) => { b.onclick = () => trkLink(key, b.dataset.rec); });
        } catch (e){ list.innerHTML = `<div class="an-mlbl">${esc(e.message)}</div>`; }
      }
      try {
        const { client } = await trkClient(key);
        if (trkState.projSite !== st.site){ trkState.projects = null; trkState.projSite = st.site; }
        const ps = trkState.projects || (trkState.projects = await A.projects(client));
        if (S.asset?.id !== aid || trkState.key !== key) return;
        let want = ""; try { want = trkStored(A, key, "project") || ""; } catch {}
        sel.innerHTML = `<option value="">Project…</option>` + ps.map((p) => `<option value="${esc(p.id)}">${esc(p.name || "#" + p.id)}</option>`).join("");
        if (ps.some((p) => String(p.id) === want)){ sel.value = want; find(); }
      } catch (e){ sel.innerHTML = `<option value="">${esc(e.message)}</option>`; }
    }
    box.querySelectorAll("[data-trk]").forEach((b) => {
      b.onclick = () => {
        const a = b.dataset.trk;
        if (a === "sync") trkSync(key);
        else if (a === "pick"){ trkState.picking = true; trkState.msg = ""; trkPaint(); }
        else if (a === "back"){ trkState.picking = false; trkPaint(); }
        else if (a === "known") trkLink(key, A.linkedIdOf([...S.items.values()], A.siteHost(st.site)));
        else if (a === "unlink") trkApi(trkPath(key, `link/${encodeURIComponent(aid)}`), { method: "DELETE" }).then(() => { trkState.msg = ""; trkPaint(); });
      };
    });
  }
  async function trkLink(key, id){
    try {
      const { client, A } = await trkClient(key);
      const link = await A.loadLink(client, id);
      await trkApi(trkPath(key, `link/${encodeURIComponent(S.asset.id)}`), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ link }) });
      if (trkState.key === key){ trkState.picking = false; trkState.msg = `Linked to <b>${esc(A.linkLabel(link))}</b> — Sync now to exchange notes`; }
    } catch (e){ if (trkState.key === key) trkState.msg = esc(e.message); }
    trkPaint();
  }
  // The notes' pictures for the tracker: the report's frames / views with the drawings burned in, then attached pictures.
  async function trkPictures(ids, opt){
    const want = new Set(ids), out = new Map(), skip = opt?.skipShots || new Set();
    const rep = await gatherReport(false, true);
    const blob = async (u) => (await fetch(u)).blob();
    for (const n of rep.notes){
      if (!want.has(n.id)) continue;
      const list = [];
      if (n.frame) list.push({ blob: await blob(n.frame), name: n.frameFile || "frame" });
      for (const m of n.more || []) if (m.frame) list.push({ blob: await blob(m.frame), name: m.file || "frame" });
      for (const sid of n.shots || []){ if (skip.has(sid)) continue; try { list.push({ blob: await blob(`/api/review/shots/${sid}`), name: sid }); } catch {} }
      out.set(n.id, list);
    }
    return out;
  }
  async function trkSync(key){
    if (!S.asset || trkState.busy || exportBusy()) return;
    const a = S.asset, aid = a.id, A = trkAdapter(key);
    trkState.busy = key; trkState.msg = ""; trkPaint();
    const say = (m) => { if (trkState.key === key) trkState.msg = m; };
    try {
      await flush();
      const { st, client } = await trkClient(key);
      const cur = await trkApi(trkPath(key, `link/${encodeURIComponent(aid)}`));
      if (!cur.link) throw new Error(`Not linked to a ${A.media.one}`);
      const asset = { id: a.id, name: a.name, path: a.path, ext: a.ext, kind: a.kind, size: a.size, mtime: a.mtime, width: a.width, height: a.height, duration: a.duration };
      const res = await A.sync({
        client, link: cur.link, asset, fps: S.fps, state: cur.state, settings: st,
        getRows: () => trkApi(`/api/annotations?asset_id=${aid}&deleted=1`),  // tombstones: a note deleted here stays deleted
        importPackage: (pkg) => trkApi("/api/review/import", { method: "POST", body: JSON.stringify(pkg) }),
        pictures: (ids, opt) => S.asset?.id === aid ? trkPictures(ids, opt) : new Map(),
        progress: (t) => toast(esc(t), 60000),
      });
      await trkApi(trkPath(key, `link/${encodeURIComponent(aid)}`), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ state: res.state }) });
      const p = res.pulled, q = res.pushed, from = A.name;
      const parts = [p.added && `${p.added} new from ${from}`, p.updated && `${p.updated} updated from ${from}`, q.notes && `${q.notes} sent`,
        q.updated && `${q.updated} updated on ${from}`, q.replies && `${q.replies} repl${q.replies === 1 ? "y" : "ies"} sent`, q.pictures && `${q.pictures} picture${q.pictures === 1 ? "" : "s"} uploaded`].filter(Boolean);
      if (res.skipped) parts.push(`${res.skipped} note${res.skipped === 1 ? " is" : "s are"} linked to another ${A.media.one} (not sent)`);
      say((parts.map(esc).join(" · ") || "Up to date") + (res.errors.length ? `<br><span class="an-trkerr">${res.errors.map(esc).join("<br>")}</span>` : ""));
      toast(res.errors.length ? `${esc(A.name)} sync: ${res.errors.length} problem${res.errors.length === 1 ? "" : "s"} — see ${esc(A.short)} ▾` : `${esc(A.name)}: ${esc(parts.join(" · ") || "up to date")}`, 4000);
      if (S.asset?.id === aid){ S.undo = []; S.redo = []; obForget(aid); await load(S.asset); }
      host.onReviewChanged?.(aid);
    } catch (e){
      console.warn(e);
      say(`<span class="an-trkerr">${esc(e.message || "Sync failed")}</span>`);
      toast(`${esc(A.name)} sync failed`, 3000);
    } finally {
      trkState.busy = ""; trkPaint();
    }
  }
  // Drawings a new note picks up: every drawing not attached to a note yet, on any frame / view and from any
  // time — a note may hold drawings on several frames of a video or views of a 3D model (each keeps its own ctx),
  // and nothing is left hanging loose: a sketch left from an earlier opening of the file (drawn, never added) or
  // one an undo took off its note goes into the next note too (0.46.3). The panel's line counts the ones off
  // screen ("on other frames / views"). (The compose mode still counts only the recent ones: S.composeSince,
  // S.adopt — an old sketch alone does not keep the picture clean.)
  const pendingDrawings = () => [...S.items.values()].filter((it) => isDrawing(it) && !it.data.note);
  function renderPanel(){
    const el = S.ui;
    if (!el || el.hidden) return;
    const all = notesSorted(), num = new Map(all.map((n, i) => [n.id, i + 1]));
    const stOf = (n) => n.data.status === "done" ? "done" : n.data.status === "progress" ? "progress" : "open";
    const tally = { all: all.length, open: 0, progress: 0, done: 0 };
    for (const n of all) tally[stOf(n)]++;
    if (!(S.filter in tally)) S.filter = "all";
    const filt = el.querySelector(".an-filt");
    filt.hidden = !all.length;
    filt.innerHTML = [["all", "All"], ["open", "Open"], ["progress", "In progress"], ["done", "Resolved"]].map(([k, l]) =>
      `<button type="button" data-filt="${k}" class="${S.filter === k ? "on" : ""}">${l}<i class="an-fc ${k}${tally[k] ? "" : " zero"}">${tally[k]}</i></button>`).join("");
    const notes = S.filter === "all" ? all : all.filter((n) => stOf(n) === S.filter);
    const list = el.querySelector(".an-list");
    const scroll = list.scrollTop;
    list.innerHTML = !all.length ? "" : !notes.length ? `<div class="an-hint"><p>No ${S.filter === "done" ? "resolved" : S.filter === "progress" ? "in-progress" : "open"} notes.</p></div>` : notes.map((n) => {
      const i = num.get(n.id) - 1;
      const d = n.data, done = d.status === "done", prog = d.status === "progress";
      const shots = (d.shots || []).map((sid) => { const ct = RC.captionOf(d, { shot: sid }); return `<span class="an-shotw${ct ? " an-hascap" : ""}" data-src="/api/review/shots/${sid}" data-shot="${sid}" title="${ct ? esc(ct) : "Screenshot — click to enlarge"}"><img src="/api/review/shots/${sid}" alt="" loading="lazy"></span>`; }).join("");
      const ctx = ctxLabel(noteCtx(n));
      return `<div class="an-note${done ? " done" : prog ? " prog" : ""}${S.pinFocus === n.id ? " on" : ""}" data-id="${n.id}">
        <div class="an-nh"><span class="an-nn">${i + 1}</span>${ctx ? `<button type="button" class="an-nctx" data-go="${n.id}" title="Go to">${S.kind === "model3d" ? ICON.view : ""}${esc(ctx)}</button>` : ""}<span class="an-nwho">${esc(d.author || "")}${d.author ? " · " : ""}${esc(fmtDate(d.created))}</span>
          <button type="button" class="an-ib sm an-nedb" data-edit="${n.id}" title="Edit the text (or double-click it)">${ICON.pencil}</button>
          <button type="button" class="an-ib sm" data-reply="${n.id}" title="Reply">${ICON.reply}</button>
          <button type="button" class="an-ib sm${prog ? " on" : ""}" data-prog="${n.id}" title="${prog ? "Not in progress" : "In progress — someone is working on it"}">${ICON.prog}</button>
          <button type="button" class="an-ib sm${done ? " on" : ""}" data-done="${n.id}" title="${done ? "Reopen" : "Resolve"}">${ICON.check}</button>
          <button type="button" class="an-ib sm" data-del="${n.id}" title="Delete note and its drawings">${ICON.trash}</button></div>
        <div class="an-nt" title="Double-click to edit">${esc(d.text || "") || '<i class="an-empty">No text</i>'}</div>
        ${picGrid(notePreview(n) + shots)}
        ${captionsHtml(n)}
        ${d.from ? `<div class="an-nmeta">from ${esc(d.from.name || "previous version")}</div>` : ""}
        ${Array.isArray(d.compare?.ids) && d.compare.ids.length > 1 && host.openCompareSession ? `<div class="an-nmeta"><button type="button" class="an-cmpb" data-cmp="${n.id}" title="Open the comparison this note was written in">⧉ Compare · ${d.compare.ids.length} files</button></div>` : ""}
        ${repliesHtml(n)}
      </div>`;
    }).join("");
    if (!all.length && isBoard()) list.innerHTML = `<div class="an-hint"><p>No notes yet.</p><p>Draw anywhere on the board, then type a note below — the drawings are attached to it. Click a note to bring its drawings into view.</p><p>Press <b>?</b> (or the <b>?</b> button in the toolbar) for all shortcuts.</p></div>`;
    else if (!all.length) list.innerHTML = `<div class="an-hint"><p>No notes yet.</p><p>Draw on the ${S.kind === "model3d" ? "view" : S.kind === "video" ? "frame" : "picture"}, then type a note below — the drawings are attached to it.${S.kind === "video" ? " Notes are pinned to the current frame and show as markers on the timeline." : S.kind === "model3d" ? " The camera, shading and lights are saved with the note." : ""}</p><p>Press <b>?</b> (or the <b>?</b> button in the toolbar) for all shortcuts.</p></div>`;
    list.scrollTop = scroll;
    renderViews();
    renderPending();
    renderVersions();
    paintStatus();
  }
  // ---- note previews: the clean picture / video frame with the note's drawings over it (vector,
  // nothing burned in) ---------------------------------------------------------------------------
  // A video note drawn on several frames: one preview per frame, in time order (each with its frame
  // number in the corner).
  // 3D: a note's pictures are a still of the view from each camera its drawings were made from (the note's
  // own view first), the drawings over it, as a video note's frames. A still is taken once per view and
  // kept (cleared with the video previews, resetPF); the camera goes back right after. A still does not
  // follow the lights: changing the shading does not re-render it (the lights are the viewer's at the
  // moment the still is first taken). The still is taken at the view's own explode (the live one when the
  // view has none), so it matches the drawings made there whatever the slider says now. Explode changes
  // the geometry, so it is in the key; lights are not. PIC3 maps asset + view + camera + hidden meshes +
  // explode to the data URL.
  const PIC3 = new Map();
  function view3dPic(vk, explode){
    const v = S.views.get(vk);
    if (!v || !S.b3) return null;
    const ex = explode ?? v.explode ?? host.getV3D?.()?.explode ?? 0;
    const id = S.asset?.id + "|" + vk + "|" + JSON.stringify(v.cam) + "|" + JSON.stringify(v.hidden) + "|x" + ex + "|a" + JSON.stringify(v.anim);
    const tok = "m" + npHash(id);  // its stored copy (PF.disk, npPut)
    pfAsset();
    if (PF.collect){ PF.collect.add(tok); return null; }
    const hit = PIC3.get(id);
    if (hit) return hit;
    if (PF.disk?.has(tok)){ const u = npUrl(tok); PIC3.set(id, u); return u; }
    // No camera move while a drag (orbit, stroke) is on; the picture comes with the next refresh.
    if (S.drag) return null;
    const save = curCam();
    if (!save) return null;
    const same = camMatch(save, v.cam);
    // The view's meshes (hidden ones stay hidden in its picture), then the live ones back.
    const saveHid = curHidden(), moveMeshes = v.hidden != null && !sameHidden(v.hidden, saveHid) && !!S.b3.setHidden;
    if (!same) S.b3.setCam(v.cam);
    if (moveMeshes) S.b3.setHidden(v.hidden);
    // The view's animation pose for the still only (withAnim puts the live pose back, playing or not).
    const src = v.anim && S.b3.withAnim ? S.b3.withAnim(v.anim, () => S.b3.capture(ex)) : S.b3.capture(ex);
    if (moveMeshes) S.b3.setHidden(saveHid);
    let url = null;
    if (src?.width && src?.height){
      const sc = Math.min(1, NP_SIDE / Math.max(src.width, src.height));
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(src.width * sc)); cv.height = Math.max(1, Math.round(src.height * sc));
      cv.getContext("2d").drawImage(src, 0, 0, cv.width, cv.height);
      url = cv.toDataURL("image/jpeg", 0.82);
      npPut(tok, cv);
    }
    if (!same) S.b3.setCam(save);
    if (url) PIC3.set(id, url);
    return url;
  }
  function view3dPreviews(n){
    if (!S.b3) return "";
    const own = [...S.items.values()].filter((it) => isDrawing(it) && it.data.note === n.id && !it.data.reply);
    const vk0 = n.data.ctx?.vk || null, vks = [];
    own.forEach((it) => { const k = it.data.ctx?.vk || vk0; if (k && !vks.includes(k)) vks.push(k); });
    // In view-number order (the chips' and the report's), the note's own view among them.
    vks.sort((a, b) => viewNumber(a) - viewNumber(b));
    return vks.map((vk) => view3dBox(n, own.filter((it) => (it.data.ctx?.vk || vk0) === vk), vk === vk0 ? "" : " sm", vk === vk0 ? null : vk)).join("");
  }
  // One picture: the render from `vk`, drawn over in the 3D host's units (1000 high, origin at the
  // centre); `goVk` (another view than the note's own) makes a click go there.
  function view3dBox(n, list, cls, goVk){
    const g = geom();
    if (!list.length || !g?.w || !g?.h) return "";
    const vk = goVk || n.data.ctx?.vk || null;
    const url = view3dPic(vk, explodeOf(vk, [n, ...list]));
    const vw = g.w * 1000 / g.h;
    const img = url ? `<img src="${url}"${npAttr(url)} alt="">` : "";
    const ct = RC.captionOf(n.data, { vk });
    return `<div class="an-nprev${cls}${ct ? " an-hascap" : ""}"${goVk ? ` data-vk="${goVk}"` : ""} style="aspect-ratio:${g.w} / ${g.h}" title="${ct ? esc(ct) : goVk ? "Go to this view" : "Show this note's drawings"}">${img}<svg viewBox="${-vw / 2} -500 ${vw} 1000" preserveAspectRatio="xMidYMid slice">${RC.svgMarkup(list, numOf)}</svg></div>`;
  }
  function notePreview(n){
    // A comparison note's picture is the screenshot of the comparison. The selected file's frame would show one layer.
    if (n.data?.compare && (n.data.shots || []).length) return "";
    if (S.kind === "model3d") return view3dPreviews(n);
    if (isBoard()) return boardPreview(n);
    if (!S.b2 || (S.kind !== "image" && S.kind !== "psd" && S.kind !== "video")) return "";
    const own = [...S.items.values()].filter((it) => isDrawing(it) && it.data.note === n.id && !it.data.reply);
    if (S.kind !== "video") return previewBox(n, own, "");
    // (A frame with only a picture text, and a text-only note's frame, show too: keep.)
    return noteFrames(n, !(n.data.shots || []).length).map((t) => previewBox(n, own.filter((it) => it.data.ctx?.t != null && sameFrame(it.data.ctx.t, t)), "", t, true)).join("");
  }
  // A note's / reply's pictures (its frames with the drawings, attached pictures): one grid of equal
  // squares, each cut to fill (as the phone app shows them), as many to a row as fit at the size
  // set by a right-drag up / down on the list — the library grid's thumbnail zoom (×0.9 per px, up =
  // bigger), kept with the settings ("sight.annotate.thumb").
  // A board note's picture: the board rectangle it was written at (ctx.bv; an older note: its drawings' bounds)
  // with its drawings in it, vector, over the board's colour. A click flies the camera there (flyToNote).
  function boardPreview(n){
    const own = [...S.items.values()].filter((it) => isDrawing(it) && it.data.note === n.id && !it.data.reply);
    let r = n.data.ctx?.bv;
    if (!(r?.w > 0 && r?.h > 0)){
      if (!own.length) return "";
      let b = null;
      for (const it of own){ const x = boundsOf(it); b = b ? [Math.min(b[0], x[0]), Math.min(b[1], x[1]), Math.max(b[2], x[2]), Math.max(b[3], x[3])] : x.slice(); }
      const p = Math.max(20, 0.08 * Math.max(b[2] - b[0], b[3] - b[1]));
      r = { x: b[0] - p, y: b[1] - p, w: b[2] - b[0] + 2 * p, h: b[3] - b[1] + 2 * p };
    }
    return `<div class="an-nprev an-bprev" data-bv="${esc(n.id)}" style="aspect-ratio:${r2(r.w)} / ${r2(r.h)}" title="Go to where this note was written"><svg viewBox="${r2(r.x)} ${r2(r.y)} ${r2(r.w)} ${r2(r.h)}" preserveAspectRatio="xMidYMid meet">${RC.svgMarkup(own, numOf)}</svg></div>`;
  }
  const picGrid = (html) => html ? `<div class="an-pics">${html}</div>` : "";
  const THUMB = [40, 320, 62];  // min, max, default (px): four to a row in the panel
  const clampThumb = (n) => Math.round(Math.min(THUMB[1], Math.max(THUMB[0], Number(n) || THUMB[2])));
  let noteThumb = clampThumb(readJSON("sight.annotate.thumb", THUMB[2])), thumbSave = 0;
  function bindThumbZoom(panel, list){
    const apply = () => panel.style.setProperty("--an-thumb", noteThumb + "px");
    apply();
    let drag = null;
    list.addEventListener("pointerdown", (e) => {
      if (e.button !== 2 || e.pointerType !== "mouse") return;
      e.preventDefault();
      drag = { id: e.pointerId, y: e.clientY, size: noteThumb };
      try { list.setPointerCapture(e.pointerId); } catch {}
    });
    list.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!(e.buttons & 2)){ drag = null; return; }  // let go outside the window
      const n = clampThumb(drag.size + (drag.y - e.clientY) * 0.9);
      if (n === noteThumb) return;
      noteThumb = n; apply();
      clearTimeout(thumbSave); thumbSave = setTimeout(() => writeJSON("sight.annotate.thumb", noteThumb), 300);
    });
    const end = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
    list.addEventListener("pointerup", end); list.addEventListener("pointercancel", end);
  }
  // A reply's drawings (made on the HTML page or the phone) on the note's picture, under the reply.
  function replyPreview(n, r){
    if (S.hiddenReplies.has(r.id)) return "";
    const list = replyDrawings(n.id, r.id);
    if (S.kind !== "video") return previewBox(n, list, " sm");
    // Video: one picture per frame the reply drew on (a drawing with no time: the note's frame).
    const tOf = (it) => it.data.ctx?.t ?? n.data.ctx?.t, ts = [];
    list.forEach((it) => { const t = tOf(it); if (t != null && !ts.some((x) => sameFrame(x, t))) ts.push(t); });
    return ts.sort((a, b) => a - b).map((t) => previewBox(n, list.filter((it) => sameFrame(tOf(it), t)), " sm", t)).join("");
  }
  // keep: shown with no drawings too (a note's frame that has only a picture text).
  function previewBox(n, list, cls, at, keep){
    if (!S.b2 || (S.kind !== "image" && S.kind !== "psd" && S.kind !== "video")) return "";
    const g = geom();
    if ((!list.length && !keep) || !g?.nw || !g?.nh) return "";
    let img, pt = "";
    if (S.kind === "video"){
      const t = at ?? n.data.ctx?.t;
      if (t == null) return "";
      if (at != null) pt = ` data-pt="${t}"`;
      const url = previewFrame(t);
      img = (url ? `<img src="${url}"${npAttr(url)} alt="">` : `<img data-ft="${Number(t).toFixed(3)}" alt="">`) + (at != null ? `<span class="an-fno">f${frameNo(t)}</span>` : "");
    } else img = `<img src="${esc(S.b2.media.currentSrc || S.b2.media.src || "")}" alt="">`;
    // A note's own picture with a text of its own gets a mark (a reply's picture: list = its drawings, at = null).
    const tt = S.kind === "video" ? at ?? n.data.ctx?.t : null;
    const ct = list.some((it) => it.data.reply) ? "" : RC.captionOf(n.data, tt != null ? { t: tt } : {}, sameFrame);
    return `<div class="an-nprev${cls}${ct ? " an-hascap" : ""}"${pt} style="aspect-ratio:${g.nw} / ${g.nh}" title="${ct ? esc(ct) : pt ? "Go to this frame" : "Show this note's drawings"}">${img}<svg viewBox="0 0 ${g.nw} ${g.nh}" preserveAspectRatio="xMidYMid slice">${RC.svgMarkup(list, numOf)}</svg></div>`;
  }
  // Video frames for the previews: a second, hidden player of the same file, one seek at a time,
  // kept per time for the open asset.
  // failed: the asset whose clip no player could show (the file and its server copy both failed); its
  // frames are not asked for again until the asset is reset.
  // Stored previews (0.113): every frame / 3D still made here is also sent to the server (PUT
  // /api/review/nprev/<aid>/<key>, Library.note_previews) as a small JPEG (NP_SIDE), so the next opening of the
  // panel loads files instead of seeking / rendering again. disk: the keys stored for PF.aid (null until the list
  // is in), diskV: their version (the file's stamp, in the URL). Keys: "f<t.3>" a video frame, "m<hash>" a 3D
  // still (pic3Id). collect: a Set while previewKeys() gathers the keys the live notes show (nothing is made then).
  const NP_SIDE = 360;
  const PF = { aid: null, v: null, cache: new Map(), want: [], busy: false, gen: 0, tries: new Map(), failed: null, disk: null, diskV: "", diskP: null, collect: null };
  function resetPF(){
    if (PF.v){ PF.v.removeAttribute("src"); PF.v.load(); PF.v.remove(); }
    PF.v = null; PF.aid = null; PF.cache.clear(); PF.want = []; PF.busy = false; PF.gen++; PF.tries = new Map(); PF.failed = null;
    PF.disk = null; PF.diskV = ""; PF.diskP = null;
    clearTimeout(pruneTimer);
    PIC3.clear();
  }
  // PF follows the open asset (a new one resets it and starts loading its stored keys).
  function pfAsset(){
    if (PF.aid !== (S.asset?.id || null)){ resetPF(); PF.aid = S.asset?.id || null; }
    if (PF.aid && !PF.diskP && !isBoard()){
      const aid = PF.aid, gen = PF.gen;
      PF.diskP = host.api(`/api/review/nprev/${encodeURIComponent(aid)}`).then((r) => {
        if (PF.gen !== gen) return;
        PF.disk = new Set(r?.keys || []); PF.diskV = r?.v || "";
      }, () => { if (PF.gen === gen) PF.disk = new Set(); });
    }
    return PF.diskP || Promise.resolve();
  }
  const npUrl = (tok) => `/api/review/nprev/${encodeURIComponent(PF.aid)}/${tok}.jpg?v=${encodeURIComponent(PF.diskV)}`;
  // Stores a preview made here (best effort: a failed upload only means it is made again next time).
  // The upload carries the file version it listed (diskV): the server refuses it if the file changed since.
  // (A 3D still is often taken before the list is in: it waits for it, so it knows the version.)
  function npPut(tok, cv){
    const aid = PF.aid, gen = PF.gen;
    if (!aid) return;
    if (!PF.diskV){ pfAsset().then(() => { if (PF.gen === gen && PF.diskV) npPut(tok, cv); }); return; }
    const ver = PF.diskV;
    if (PF.disk?.has(tok)) return;
    cv.toBlob((b) => {
      if (!b || PF.gen !== gen) return;
      host.api(`/api/review/nprev/${encodeURIComponent(aid)}/${tok}?v=${encodeURIComponent(ver)}`, { method: "PUT", headers: { "content-type": "image/jpeg" }, body: b })
        .then(() => { if (PF.gen === gen) PF.disk?.add(tok); }, () => {});
    }, "image/jpeg", 0.82);
  }
  // A stored preview that is gone (another window pruned it, the file changed): forget it and make it again.
  function npMissing(img){
    const tok = img.dataset.np;
    if (!tok || PF.aid !== S.asset?.id) return;
    img.removeAttribute("data-np");
    PF.disk?.delete(tok);
    if (tok[0] === "f"){
      const key = tok.slice(1);
      PF.cache.delete(key);
      img.removeAttribute("src"); img.dataset.ft = key;
      if (!PF.want.includes(key)) PF.want.push(key);
      queueMicrotask(pumpPF);
    } else {
      for (const [id, u] of PIC3) if (u.includes(`/${tok}.jpg`)) PIC3.delete(id);
      if (panelShown()) renderPanel();
    }
  }
  const npTok = (url) => { const m = /^\/api\/review\/nprev\/[^/]+\/([A-Za-z0-9.-]+)\.jpg/.exec(url || ""); return m ? m[1] : ""; };
  const npAttr = (url) => { const t = npTok(url); return t ? ` data-np="${t}"` : ""; };
  // A short stable token for a long key (cyrb53: 53 bits, as hex).
  function npHash(str){
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++){ const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  }
  function previewFrame(t){
    const key = Number(t).toFixed(3), tok = "f" + key;
    pfAsset();
    if (PF.collect){ PF.collect.add(tok); return null; }
    const hit = PF.cache.get(key);
    if (hit) return hit;
    if (PF.disk?.has(tok)){ const u = npUrl(tok); PF.cache.set(key, u); return u; }
    if (!PF.want.includes(key)) PF.want.push(key);
    queueMicrotask(pumpPF);
    return null;
  }
  // The keys of every preview the live notes and replies show (rendering them with PF.collect on: no frame is
  // sought, no still taken), and the server told to drop the rest. Run after a note / reply is deleted.
  let pruneTimer = 0;
  function schedulePrune(){
    clearTimeout(pruneTimer);
    pruneTimer = setTimeout(prunePreviews, 1500);
  }
  function prunePreviews(){
    // Only on a fully loaded view: a missing player / 3D host / geometry would collect no keys and drop them all.
    if (!PF.aid || PF.aid !== S.asset?.id || isBoard() || !PF.disk || !geom()?.w) return;
    if (!(S.kind === "video" ? S.b2 && geom()?.nw : S.kind === "model3d" && S.b3)) return;
    const keep = new Set(), hid = S.hiddenReplies;
    PF.collect = keep; S.hiddenReplies = new Set();
    try {
      for (const n of notesSorted()){ notePreview(n); for (const r of liveReplies(n)) if (!r.event) replyPreview(n, r); }
    } finally { PF.collect = null; S.hiddenReplies = hid; }
    if (![...PF.disk].some((k) => !keep.has(k))) return;
    const aid = PF.aid, gen = PF.gen;
    host.api(`/api/review/nprev/${encodeURIComponent(aid)}/prune`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ keep: [...keep] }) })
      .then(() => {
        if (PF.gen !== gen || !PF.disk) return;
        for (const k of [...PF.disk]){
          if (keep.has(k)) continue;
          PF.disk.delete(k);
          // (an undo brings the note back: its picture is made and stored again, not read from a deleted file)
          if (k[0] === "f") PF.cache.delete(k.slice(1));
          else for (const [id, u] of PIC3) if (u.includes(`/${k}.jpg`)) PIC3.delete(id);
        }
      }, () => {});
  }
  // The player has its first picture, or `ms` has passed: a browser that does not decode the file
  // may stay silent, and the pump must not wait on it for ever (it then stops for good).
  function pfLoad(v, ms){
    return new Promise((ok, no) => {
      let to = 0;
      const fin = (good) => { clearTimeout(to); v.removeEventListener("loadeddata", onOk); v.removeEventListener("error", onErr); good ? ok() : no(new Error("video")); };
      const onOk = () => fin(true), onErr = () => fin(false);
      to = setTimeout(() => fin(false), ms);
      v.addEventListener("loadeddata", onOk);
      v.addEventListener("error", onErr);
    });
  }
  // Seeks the preview player to t and waits until that picture is presented: "seeked" can come before
  // the new picture is decoded (WebKit), and drawImage would then copy nothing. Four seconds at most.
  // Resolves true only when the player sits on the wanted time with its seek over. A timeout, or a
  // "seeked" left over from an earlier seek, is no picture of t: the caller asks again instead of
  // caching whatever picture the element still shows.
  function pfSeek(v, t){
    return new Promise((ok) => {
      let to = 0, done = false;
      const fin = (good) => {
        if (done) return;
        done = true;
        clearTimeout(to);
        v.removeEventListener("seeked", onSeeked);
        ok(!!good && !v.seeking && Math.abs(v.currentTime - t) < 0.05);
      };
      const onSeeked = () => {
        clearTimeout(to);
        if (typeof v.requestVideoFrameCallback === "function"){ v.requestVideoFrameCallback(() => fin(true)); to = setTimeout(() => fin(true), 1500); }
        else fin(true);
      };
      v.addEventListener("seeked", onSeeked);
      to = setTimeout(() => fin(false), 4000);
      v.currentTime = t;
    });
  }
  async function pumpPF(){
    if (PF.busy || !PF.want.length || !PF.aid) return;
    PF.busy = true;
    // A reset (another asset, or the same one reopened) ends this run: its generation is gone.
    const aid = PF.aid, gen = PF.gen;
    const show = (key, url) => {
      PF.cache.set(key, url);
      S.ui?.querySelectorAll(`img[data-ft="${key}"]`).forEach((im) => { const t = npTok(url); if (t) im.dataset.np = t; im.src = url; im.removeAttribute("data-ft"); });
    };
    try {
      await pfAsset();  // the stored frames first: they need no player
      if (PF.gen !== gen) return;
      while (PF.want.length && PF.gen === gen){
        const key = PF.want.shift(), tok = "f" + key;
        if (PF.disk?.has(tok)){ show(key, npUrl(tok)); continue; }
        if (PF.failed === aid) continue;
        if (!PF.v){
          const nv = document.createElement("video");
          nv.muted = true; nv.preload = "auto"; nv.playsInline = true;
          // Kept in the document, hidden as a 1 px box: a video that is not in the page is not decoded by
          // every browser (WebKit on macOS gave no picture for its seeks), so the seeks showed nothing.
          nv.style.cssText = "position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
          document.body.appendChild(nv);
          PF.v = nv;
          nv.src = `/api/file/${aid}`;
          // No picture from the file itself (a codec the browser cannot decode): play the server's copy.
          let playable = await pfLoad(nv, 8000).then(() => !!nv.videoWidth, () => false);
          if (!playable){
            const res = await convertForPlayback(aid, null, () => PF.gen === gen);
            if (res.ok && PF.gen === gen){
              nv.src = `/api/file/${aid}?copy=${Date.now()}`;
              playable = await pfLoad(nv, 8000).then(() => !!nv.videoWidth, () => false);
            }
          }
          if (PF.gen !== gen) return;
          if (!playable){
            // Nothing can show this clip: drop the player and give up on its unstored frames (no 4 s-per-frame retries).
            PF.failed = aid; PF.tries = new Map();
            nv.removeAttribute("src"); nv.load(); nv.remove(); PF.v = null;
            continue;
          }
        }
        const v = PF.v;
        const landed = await pfSeek(v, landAt(Number(key)));
        if (PF.gen !== gen) break;
        if (!landed || !v.videoWidth || v.readyState < 2){
          // No picture yet: asked again up to three times, then left to the next render.
          const n = (PF.tries.get(key) || 0) + 1;
          PF.tries.set(key, n);
          if (n < 3) PF.want.push(key);
          continue;
        }
        const sc = Math.min(1, NP_SIDE / Math.max(v.videoWidth, v.videoHeight));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(v.videoWidth * sc)); c.height = Math.max(1, Math.round(v.videoHeight * sc));
        c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
        show(key, c.toDataURL("image/jpeg", 0.82));
        npPut(tok, c);
      }
    } catch (e){
      if (PF.gen !== gen) return; // a reset ended this run; its failure is expected
      console.warn("note frame", e);
      // A player that failed to load is dropped (and stops fetching), so the next request makes a new one.
      if (PF.v){ PF.v.removeAttribute("src"); PF.v.load(); PF.v.remove(); PF.v = null; }
    }
    finally { if (PF.gen === gen) PF.busy = false; }
  }
  const liveReplies = (n) => (n.data.replies || []).filter((r) => !r.deleted);
  // A note is open, in progress (someone took it) or done. Every change also leaves an entry in
  // the note's thread (`{id, event: "done"|"progress"|"open", author, created}`), so the history
  // shows who changed the state and when. These entries merge like replies (by id) and are never
  // edited or deleted. Replies may carry pictures (`shots: [id]`, review_shots like a note's).
  const statusEvent = (state) => ({ id: uid(), event: state, author: reviewer(), created: Date.now() });
  const EVENT = { done: ["✓", "Resolved"], progress: ["▸", "In progress"], open: ["↺", "Reopened"] };
  const eventLabel = (r) => (EVENT[r.event] || EVENT.open)[1];
  const eventIcon = (r) => (EVENT[r.event] || EVENT.open)[0];
  // Eye + count for a reply that carries drawings: shows / hides them on the picture.
  function rdrawChip(n, r){
    const c = replyDrawings(n.id, r.id).length;
    if (!c) return "";
    const off = S.hiddenReplies.has(r.id);
    return `<button type="button" class="an-rdraw${off ? " off" : ""}" data-rdraw="${esc(r.id)}" title="${off ? "Show" : "Hide"} this reply's drawing${c > 1 ? "s" : ""}">${off ? ICON.eyeOff : ICON.eye}${c}</button>`;
  }
  function repliesHtml(n){
    const list = liveReplies(n);
    if (!list.length) return "";
    return `<div class="an-replies">${list.map((r) => r.event ? `<div class="an-rep an-rev ${r.event === "done" ? "done" : r.event === "progress" ? "prog" : ""}" data-rid="${esc(r.id)}">
      <span>${eventIcon(r)} ${eventLabel(r)}${r.author ? " by " + esc(r.author) : ""} · ${esc(fmtDate(r.created))}</span></div>` : `<div class="an-rep" data-rid="${esc(r.id)}">
      <div class="an-rh"><span>${esc(r.author || "")}${r.author ? " · " : ""}${esc(fmtDate(r.created))}${r.edited ? " · edited" : ""}</span>${rdrawChip(n, r)}<button type="button" class="an-ib sm" data-rdel="${esc(r.id)}" title="Delete reply">${ICON.close}</button></div>
      ${r.text ? `<div class="an-rt" title="Double-click to edit">${esc(r.text)}</div>` : ""}
      ${picGrid(replyPreview(n, r) + (r.shots || []).map((sid) => `<img src="/api/review/shots/${esc(sid)}" data-rshot="/api/review/shots/${esc(sid)}" alt="" loading="lazy">`).join(""))}</div>`).join("")}</div>`;
  }
  // Inline editor under a note card (new reply) or in place of a reply's text (edit).
  function replyEditor(card, anchor, initial, done){
    const ta = document.createElement("textarea");
    ta.className = "an-input an-redit";
    ta.rows = 1;
    ta.placeholder = "Reply…  Enter sends · Esc cancels";
    ta.value = initial;
    if (anchor) anchor.replaceWith(ta); else card.appendChild(ta);
    ta.style.height = Math.min(160, ta.scrollHeight + 2) + "px";
    ta.focus();
    ta.addEventListener("click", (e) => e.stopPropagation());
    ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(160, ta.scrollHeight + 2) + "px"; });
    let ended = false; // removing the field blurs it, which calls end() a second time
    const end = (ok) => {
      if (ended || !ta.isConnected) return;
      ended = true;
      const v = ta.value.trim();
      ta.remove();
      if (ok && v && v !== initial) done(v); else renderPanel();
    };
    ta.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (hotkey(ev, "Enter")){ ev.preventDefault(); end(true); }
      else if (hotkey(ev, "Escape")){ ev.preventDefault(); end(false); }
    });
    ta.addEventListener("blur", () => end(true));
  }
  function startReply(id){
    const card = S.ui?.querySelector(`.an-note[data-id="${id}"]`);
    if (!card || card.querySelector(".an-redit")) return;
    replyEditor(card, null, "", (text) => {
      commit([id], () => {
        const d = S.items.get(id).data;
        d.replies = [...(d.replies || []), { id: uid(), text, author: reviewer(), created: Date.now() }];
      });
    });
  }
  function editReply(id, rid, el){
    const r = (S.items.get(id)?.data.replies || []).find((x) => x.id === rid);
    if (!r) return;
    replyEditor(el.closest(".an-note"), el, r.text || "", (text) => {
      commit([id], () => {
        const d = S.items.get(id).data;
        d.replies = d.replies.map((x) => (x.id === rid ? { ...x, text, edited: Date.now() } : x));
      });
    });
  }
  // A deleted reply stays as a tombstone so merging a review file from before the delete
  // does not bring it back (see Library.merge_replies).
  // Its drawings (data.reply) go with it, in the same undo step.
  function deleteReply(id, rid){
    const drawn = replyDrawings(id, rid).map((it) => it.id);
    commit([id, ...drawn], () => {
      const d = S.items.get(id).data;
      d.replies = (d.replies || []).map((x) => (x.id === rid ? { id: x.id, created: x.created, deleted: Date.now() } : x));
      for (const x of drawn) S.items.delete(x);
    });
    S.hiddenReplies.delete(rid);
    schedulePrune();
  }
  const replyDrawings = (id, rid) => [...S.items.values()].filter((it) => isDrawing(it) && it.data.note === id && it.data.reply === rid);
  function renderPending(){
    const el = S.ui;
    if (!el) return;
    const pend = el.querySelector(".an-pend");
    pend.innerHTML = S.pending.map((p, i) => `<span class="an-pshot"><img src="${p.url}" data-src="${p.url}" alt=""><button type="button" data-rm="${i}" title="Remove">×</button></span>`).join("");
    pend.hidden = !S.pending.length;
    const n = pendingDrawings().length;
    const c = ctxLabel(ctxNow(false));
    const away = pendingDrawings().filter((it) => !ctxShown(it)).length;
    const cin = el.querySelector(".an-cin");
    if (cin) cin.placeholder = `Text for this ${S.kind === "video" ? "frame" : S.kind === "model3d" ? "view" : "picture"} (optional)`;
    el.querySelector(".an-ctx").textContent = [c, n ? `+${n} drawing${n > 1 ? "s" : ""}${away ? ` (${away} on other ${S.kind === "model3d" ? "views" : "frames"})` : ""}` : ""].filter(Boolean).join("  ·  ");
    renderViews();
  }
  // 3D view numbers: only while a note is being made, right above its field — the views the future note will
  // hold (those of the drawings waiting for it, and the camera on screen, where the note itself goes; a camera
  // that is no view yet shows as the next number, dimmed: the view the note will make). A chip restores its view.
  // Added notes show their views on their cards (the previews), so the chips are not needed then.
  function renderViews(){
    const el = S.ui?.querySelector(".an-views");
    if (!el) return;
    const show = S.kind === "model3d" && !!S.b3 && viewMode().compose;
    let html = "";
    if (show){
      const vks = [];
      for (const it of pendingDrawings()){ const k = it.data.ctx?.vk; if (k && S.views.has(k) && !vks.includes(k)) vks.push(k); }
      const here = ctxNow(false)?.vk || null;
      if (here && !vks.includes(here)) vks.push(here);
      vks.sort((a, b) => viewNumber(a) - viewNumber(b));
      html = vks.map((vk) => { const v = S.views.get(vk); return `<button type="button" class="an-vchip${vk === here ? " on" : ""}" data-vk="${vk}" title="Restore this camera${v.v3d ? ", shading and lights" : ""}${v.hidden?.length ? ", hidden meshes" : ""}">${viewNumber(vk)}</button>`; }).join("")
        + (here ? "" : `<span class="an-vchip new" title="The camera on screen is no view yet: adding the note makes it view ${S.views.size + 1}">${S.views.size + 1}</span>`);
    }
    // The chips' markup is kept on the element (a new panel starts empty), rebuilt only on a change: a chip
    // under the pointer stays clickable.
    if (!html){ el.hidden = true; if (el.dataset.sig){ el.innerHTML = ""; el.dataset.sig = ""; } return; }
    el.hidden = false;
    if (html === el.dataset.sig) return;
    el.dataset.sig = html;
    el.innerHTML = `<span>Views of this note</span>` + html;
    el.querySelectorAll("[data-vk]").forEach((b) => {
      b.onmousedown = (e) => e.preventDefault();  // the note's field keeps the focus (and the compose mode)
      b.onclick = () => goView(b.dataset.vk);
    });
  }
  function onListClick(e){
    const t = e.target.closest?.("[data-cmp],[data-go],[data-done],[data-prog],[data-del],[data-reply],[data-edit],[data-rdel],[data-rdraw],[data-shot],img[data-rshot],.an-rep,.an-cap,.an-note");
    if (!t){
      // A click on the empty list drops the picked note (as Esc does). Not when it ends a text selection
      // dragged out of a card: the click then lands on the list, the common ancestor of the two presses.
      const sl = window.getSelection?.();
      if (sl && !sl.isCollapsed) return;
      if (S.pinFocus){ S.pinFocus = null; paintVisibility(); renderPanel(); }
      return;
    }
    if (t.dataset.rdraw){
      const rid = t.dataset.rdraw;
      if (S.hiddenReplies.has(rid)) S.hiddenReplies.delete(rid);
      else {
        S.hiddenReplies.add(rid);
        // Hidden drawings must not stay selected: Delete would remove them unseen.
        for (const it of S.items.values()) if (it.data.reply === rid) S.sel.delete(it.id);
        renderProps();
      }
      paintVisibility(); renderSel(); renderPanel();
      return;
    }
    if (t.dataset.cmp){ const n = S.items.get(t.dataset.cmp); if (n?.data.compare) host.openCompareSession?.(n.data.compare, n); return; }
    if (t.dataset.reply){ startReply(t.dataset.reply); return; }
    if (t.dataset.edit){ editNote(t.dataset.edit); return; }
    if (t.dataset.rdel){ deleteReply(t.closest(".an-note").dataset.id, t.dataset.rdel); return; }
    if (t.dataset.rshot){ showShot(t.dataset.rshot); return; }
    if (t.classList.contains("an-rep")){
      // A reply's frame picture: the note picked, the clip on that frame.
      const rp = e.target.closest?.(".an-nprev[data-pt]"), card = t.closest(".an-note");
      if (rp && card){
        if (S.pinFocus !== card.dataset.id) goNote(card.dataset.id);
        const v = video(); if (v){ vidPause(v); vidSeek(v, landAt(Number(rp.dataset.pt))); }
      }
      return;
    }
    if (t.classList.contains("an-cap")){
      // A picture's text: the note picked (a second click does not drop it: double-click edits), the
      // clip / camera on that picture.
      const id = t.closest(".an-note").dataset.id, p = picOfKey(t.dataset.cap);
      if (S.pinFocus !== id) goNote(id);
      if (p.shot != null){ showShot(`/api/review/shots/${p.shot}`, { note: id, shot: p.shot }); return; }
      if (p.t != null){ const v = video(); if (v){ vidPause(v); vidSeek(v, landAt(p.t)); } }
      else if (p.vk && S.views.has(p.vk) && p.vk !== S.curVk) goView(p.vk);
      return;
    }
    if (t.dataset.done || t.dataset.prog){
      const id = t.dataset.done || t.dataset.prog, want = t.dataset.done ? "done" : "progress";
      commit([id], () => {
        const d = S.items.get(id).data;
        d.status = d.status === want ? "open" : want;
        d.status_at = Date.now();
        d.replies = [...(d.replies || []), statusEvent(d.status)];
      });
      return;
    }
    if (t.dataset.del){
      const id = t.dataset.del;
      const ids = [id, ...[...S.items.values()].filter((it) => it.data.note === id).map((it) => it.id)];
      commit(ids, () => { for (const x of ids) S.items.delete(x); });
      if (S.pinFocus === id) S.pinFocus = null;
      schedulePrune();  // its stored previews that no other note shows
      return;
    }
    if (t.dataset.shot){
      if (e.altKey){
        const card = t.closest(".an-note"), id = card.dataset.id, sid = t.dataset.shot;
        commit([id], () => { const d = S.items.get(id).data; d.shots = (d.shots || []).filter((x) => x !== sid); d.edited_at = Date.now(); });
        return;
      }
      showShot(t.dataset.src, { note: t.closest(".an-note").dataset.id, shot: t.dataset.shot });
      return;
    }
    const card = t.closest(".an-note");
    // Another frame the note was drawn on: the note picked, the clip on that frame.
    const bp = e.target.closest?.(".an-nprev[data-bv]");
    if (card && bp){
      // A board note's picture: the note picked, the camera flies to where it was written.
      if (S.pinFocus !== card.dataset.id) goNote(card.dataset.id); else flyToNote(card.dataset.id);
      return;
    }
    const pv = e.target.closest?.(".an-nprev[data-pt], .an-nprev[data-vk]");
    if (card && pv?.dataset.vk){
      // Another view the note was drawn from: the note picked, the camera on that view.
      if (S.pinFocus !== card.dataset.id) goNote(card.dataset.id);
      goView(pv.dataset.vk);
      return;
    }
    if (card && pv){
      if (S.pinFocus !== card.dataset.id) goNote(card.dataset.id);
      const v = video(); if (v){ vidPause(v); vidSeek(v, landAt(Number(pv.dataset.pt))); }
      return;
    }
    // The second click of a double-click (which edits the text) keeps the note picked.
    if (card && !(e.detail > 1 && S.pinFocus === card.dataset.id)) goNote(card.dataset.id);
  }
  function onListDblClick(e){
    const cp = e.target.closest?.(".an-cap");
    if (cp){ editCaption(cp); return; }
    const rt = e.target.closest?.(".an-rt");
    if (rt){ editReply(rt.closest(".an-note").dataset.id, rt.closest(".an-rep").dataset.rid, rt); return; }
    const nt = e.target.closest?.(".an-nt");
    if (nt) editNote(nt.closest(".an-note").dataset.id);
  }
  // A note's text edited in place (double-click on it, or the card's pencil): Enter saves, Esc cancels. The card
  // is looked up afresh — a click before it may have rebuilt the list, leaving the clicked node detached.
  function editNote(id){
    const it = S.items.get(id);
    if (!it) return;
    if (S.pinFocus !== id) goNote(id);
    const nt = S.ui?.querySelector(`.an-note[data-id="${id}"] .an-nt`);
    if (!nt) return;
    const ta = document.createElement("textarea");
    ta.className = "an-input an-nedit";
    ta.value = it.data.text || "";
    nt.replaceWith(ta);
    ta.style.height = Math.min(220, ta.scrollHeight + 4) + "px";
    ta.focus();
    let ended = false;
    const end = (ok) => {
      if (ended || !ta.isConnected) return;
      ended = true;
      const v = ta.value.trim();
      ta.remove();
      // edited_at: the note's content stamp — merging a review file compares it, not the row's
      // updated_at (which replies and resolving also move; see Library._content_at).
      if (ok && v !== (it.data.text || "")) commit([id], () => { const d = S.items.get(id).data; d.text = v; d.edited_at = Date.now(); });
      else renderPanel();
    };
    ta.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (hotkey(ev, "Enter")){ ev.preventDefault(); end(true); }
      else if (hotkey(ev, "Escape")){ ev.preventDefault(); end(false); }
    });
    ta.addEventListener("blur", () => end(true));
  }
  // A picture's text in a note card, edited in place (Enter saves, Esc cancels, an empty text removes it).
  function editCaption(row){
    const id = row.closest(".an-note")?.dataset.id, n = id && S.items.get(id);
    if (!n) return;
    const pic = picOfKey(row.dataset.cap), was = RC.captionOf(n.data, pic, sameFrame);
    const ta = document.createElement("textarea");
    ta.className = "an-input an-nedit";
    ta.value = was;
    ta.placeholder = picLabel(n, pic) + " — text (empty removes it)";
    row.replaceWith(ta);
    ta.style.height = Math.min(160, ta.scrollHeight + 4) + "px";
    ta.focus();
    let ended = false;
    const end = (ok) => {
      if (ended || !ta.isConnected) return;
      ended = true;
      const v = ta.value.trim();
      ta.remove();
      if (ok && v !== was) setCaptionFor(id, pic, v); else renderPanel();
    };
    ta.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (hotkey(ev, "Enter")){ ev.preventDefault(); end(true); }
      else if (hotkey(ev, "Escape")){ ev.preventDefault(); end(false); }
    });
    ta.addEventListener("blur", () => end(true));
  }
  function goNote(id){
    const n = S.items.get(id);
    if (!n) return;
    S.pinFocus = S.pinFocus === id ? null : id;
    const c = n.data.ctx, t0 = S.kind === "video" ? noteFrames(n)[0] : null;
    if (t0 != null){ const v = video(); if (v){ vidPause(v); vidSeek(v, landAt(t0)); } }
    if (c?.vk) goView(c.vk, c.v3d, c.explode);
    S.sel = new Set();
    renderSel(); renderProps(); renderPanel(); paintVisibility();
    if (isBoard() && S.pinFocus === id) flyToNote(id);
  }
  // Board: back to where the note was written (ctx.bv), else to its drawings — gliding, not jumping.
  function flyToNote(id){
    const bv = S.items.get(id)?.data.ctx?.bv;
    if (bv && bv.w > 0 && bv.h > 0) host.frameRect?.(bv.x, bv.y, bv.x + bv.w, bv.y + bv.h, { smooth: true, pad: 0 });
    else frameNote(id);
  }
  // Board: the camera goes to the picked note's drawings (the host's frameRect moves the board view).
  function frameNote(id){
    let box = null;
    for (const it of S.items.values()){
      if (!isDrawing(it) || it.data.note !== id || !visibleNow(it)) continue;
      const b = boundsOf(it);
      box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])] : b.slice();
    }
    if (box) host.frameRect?.(box[0], box[1], box[2], box[3], { smooth: true });
  }
  function goView(vk, v3d, ex){
    const v = S.views.get(vk);
    if (!v || !S.b3) return;
    // Shading, lights and the rest come from the note (or the view's last note); explode from the note it
    // was made at (ex), else from the view.
    const look = v3d || v.v3d;
    if (look){ const { explode, ...rest } = look; host.setV3D?.(rest); }
    if (typeof ex === "number") host.setV3D?.({ explode: ex });
    else viewExplode(vk);
    // The meshes the view was made with: hidden ones hidden, the rest shown (an empty list shows all).
    if (v.hidden) S.b3.setHidden?.(v.hidden);
    if (v.anim) S.b3.setAnim?.(v.anim);
    S.b3.setCam(v.cam);
    S.curVk = vk;
    afterChange();
  }
  // An attached picture, large. A note's own picture (from: {note, shot}) shows the text plate: the
  // note's text and the picture's own, editable there.
  function showShot(src, from){
    const ov = document.createElement("div");
    ov.className = "an-shotview";
    ov.innerHTML = `<img src="${src}" alt="">`;
    closeShotView();
    let plate = null;
    const close = () => { plate?.destroy(); ov.remove(); if (S.shotView === close) S.shotView = null; };
    S.shotView = close;
    ov.onclick = close;
    ov.addEventListener("pointerdown", (e) => e.stopPropagation());
    S.light?.appendChild(ov);
    if (!from?.note) return;
    plate = createPlate(ov, { storeKey: "sight.annotate.plate" });
    const pic = { shot: from.shot };
    const paint = () => {
      const n = S.items.get(from.note);
      if (!n || n.kind !== "note" || !ov.isConnected){ plate.set(null); return; }
      const k = (n.data.shots || []).indexOf(from.shot);
      plate.set({ key: n.id + "|" + RC.picKey(pic), num: numOfNote(n.id), cls: noteCls(n), label: "Attached picture" + (k >= 0 && (n.data.shots || []).length > 1 ? " " + (k + 1) : ""),
        theme: n.data.text || "", text: RC.captionOf(n.data, pic), placeholder: "No text for this picture yet",
        onSave: (v) => { setCaptionFor(n.id, pic, v); paint(); } });
    };
    paint();
  }

  // The enlarged attached picture (and its plate), if one is open.
  function closeShotView(){ S.shotView?.(); }

  // ---- picture texts (FORMAT.md captions): the note's text is the topic, each picture may add its own -----
  // The picture a note context stands for: the image itself, the video frame, the 3D view.
  function picOfCtx(c){
    if (S.kind === "video") return c?.t != null ? { t: c.t } : {};
    if (S.kind === "model3d") return c?.vk ? { vk: c.vk } : {};
    return {};
  }
  const numOfNote = (id) => { const i = notesSorted().findIndex((n) => n.id === id); return i >= 0 ? i + 1 : ""; };
  const noteCls = (n) => n.data.status === "done" ? "done" : n.data.status === "progress" ? "progress" : "open";
  function setCaptionFor(id, pic, text){
    const n = S.items.get(id);
    if (!n || n.kind !== "note" || RC.captionOf(n.data, pic, sameFrame) === String(text || "").trim()) return;
    commit([id], () => {
      const d = S.items.get(id).data;
      const caps = RC.withCaption(d, pic, text, sameFrame);
      if (caps) d.captions = caps; else delete d.captions;
      d.edited_at = Date.now();  // the note's content stamp, as for its text
    });
  }
  // A caption key back to its picture (RC.picKey's forms).
  function picOfKey(k){
    if (k.startsWith("shot:")) return { shot: k.slice(5) };
    if (k.startsWith("vk:")) return { vk: k.slice(3) };
    if (k.startsWith("t:") && Number.isFinite(Number(k.slice(2)))) return { t: Number(k.slice(2)) };
    return {};
  }
  function picLabel(n, pic){
    if (pic.shot != null){ const sh = n.data.shots || [], k = sh.indexOf(pic.shot); return "Attached picture" + (k >= 0 && sh.length > 1 ? " " + (k + 1) : ""); }
    if (pic.vk) return "View " + (viewNumber(pic.vk) || "?");
    if (pic.t != null) return fmtTime(pic.t, S.fps);
    return S.kind === "video" ? "Frame" : S.kind === "model3d" ? "View" : "Picture";
  }
  // Under a note's pictures: each picture's own text with which picture it is (frames in time order,
  // views in view order, attached pictures in their order). Double-click edits one.
  function captionsHtml(n){
    const caps = n.data.captions;
    if (!caps || typeof caps !== "object") return "";
    const shots = n.data.shots || [];
    const rank = (p) => p.shot != null ? [3, shots.indexOf(p.shot)] : p.vk ? [2, viewNumber(p.vk) || 1e9] : p.t != null ? [1, p.t] : [0, 0];
    const list = Object.entries(caps).filter(([, v]) => typeof v === "string" && v.trim()).map(([k, v]) => ({ k, v, p: picOfKey(k) }))
      .sort((a, b) => { const x = rank(a.p), y = rank(b.p); return x[0] - y[0] || x[1] - y[1]; });
    if (!list.length) return "";
    return `<div class="an-caps">${list.map((c) => `<div class="an-cap" data-cap="${esc(c.k)}" title="Double-click to edit"><b>${esc(picLabel(n, c.p))}</b><span>${esc(c.v)}</span></div>`).join("")}</div>`;
  }
  // The picture of picked note n that is on screen, or null: the image itself; a video frame the note
  // is on (a frame it drew on, a frame with a text; a text-only note: the frame it was written on); a
  // 3D view of it.
  function platePic(n){
    if (S.kind === "image" || S.kind === "psd") return { pic: {}, label: "Picture" };
    const own = [...S.items.values()].filter((it) => isDrawing(it) && it.data.note === n.id && !it.data.reply);
    const keys = Object.keys(n.data.captions || {}).map(picOfKey);
    if (S.kind === "video"){
      const f = frameNow();
      if (!f) return null;
      const hit = noteFrames(n).find((t) => sameFrame(t, f.t));
      return hit != null ? { pic: { t: Number(hit) }, label: ctxLabel({ t: Number(hit) }) } : null;
    }
    if (S.kind === "model3d"){
      const vk = S.curVk;
      if (!vk) return null;
      const vks = [n.data.ctx?.vk, ...own.map((it) => it.data.ctx?.vk || n.data.ctx?.vk), ...keys.map((p) => p.vk)];
      return vks.includes(vk) ? { pic: { vk }, label: "View " + (viewNumber(vk) || "") } : null;
    }
    return null;
  }
  function ensurePlate(){
    const el = surfaceEl();
    if (!el) return null;
    if (S.plate && S.plate.el.parentNode === el) return S.plate;
    S.plate?.destroy();
    S.plate = createPlate(el, { storeKey: "sight.annotate.plate" });
    return S.plate;
  }
  // The plate over the picture while a note is picked and one of its pictures is on screen (runs every tick).
  function paintPlate(){
    const n = S.on && S.pinFocus ? S.items.get(S.pinFocus) : null;
    const cur = n && n.kind === "note" ? platePic(n) : null;
    if (!cur){ S.plate?.set(null); return; }
    const P = ensurePlate();
    if (!P) return;
    const id = n.id, pic = cur.pic;
    P.set({ key: id + "|" + RC.picKey(pic), num: numOfNote(id), cls: noteCls(n), label: cur.label,
      theme: n.data.text || "", text: RC.captionOf(n.data, pic, sameFrame), placeholder: "No text for this picture yet",
      onSave: (v) => setCaptionFor(id, pic, v) });
  }

  async function addNote(){
    const inp = S.ui?.querySelector(".an-input"), cin = S.ui?.querySelector(".an-cin");
    const text = (inp?.value || "").trim(), capText = (cin?.value || "").trim();
    // Something of this note must be here: words, a screenshot, or a drawing on screen / just made. Old sketches on
    // other frames alone do not make an empty note (they go into the next real one).
    const fresh = (it) => ctxShown(it) || (it.data.created || 0) >= S.composeSince || S.adopt.has(it.id);
    if (!text && !capText && !S.pending.length && !pendingDrawings().some(fresh)){ toast("Type a note, draw, or take a screenshot first"); return; }
    // Compare: the picture is the comparison as shown. The frame and the file are read when that
    // picture is taken — the upload can take a while, and the playhead or the selected layer may move.
    const assetId = S.asset?.id || null;
    let ctx = null;
    if (host.captureView && surfaceEl()){
      try {
        const res = await composeView();
        if (!S.asset || S.asset.id !== assetId){ toast("The layer changed — add the note again"); return; }
        ctx = ctxNow(true, true);
        if (res?.cv){
          const r = await uploadCanvas(res.cv);
          if (!S.asset || S.asset.id !== assetId){ toast("The layer changed — add the note again"); return; }
          S.pending.unshift({ id: r.id, url: r.url });
        }
      } catch (e){ console.warn(e); }
    }
    if (!S.asset || S.asset.id !== assetId){ toast("The layer changed — add the note again"); return; }
    if (!ctx) ctx = ctxNow(true, true);
    const note = { id: uid(), kind: "note", sub: null, z: 0, data: { text, author: reviewer(), created: Date.now(), status: "open", ctx, shots: S.pending.map((p) => p.id) } };
    // The host's context for the note (the version compare: the comparison it was written in, FORMAT.md `compare`).
    const extra = host.noteExtra?.();
    if (extra) Object.assign(note.data, extra);
    // The picture's own text goes to the picture the note is made on (its frame / view / the image).
    const caps = capText ? RC.withCaption(note.data, picOfCtx(ctx), capText, sameFrame) : null;
    if (caps) note.data.captions = caps;
    const linked = pendingDrawings();
    commit([note.id, ...linked.map((it) => it.id)], () => {
      S.items.set(note.id, note);
      for (const it of linked){
        it.data.note = note.id;
        // A drawing not yet added, on the note's camera and meshes, is drawn over the picture the note is made
        // at: it takes the note's view and the amount now (drawings of other cameras keep theirs).
        const pv = it.data.ctx ? S.views.get(it.data.ctx.vk) : null;
        if (ctx && pv && camMatch(pv.cam, ctx.cam) && sameHidden(pv.hidden, ctx.hidden ?? null) && explodeSame(pv, ctx.explode) && RC.animMatch(pv.anim, ctx.anim ?? null)){
          it.data.ctx.vk = ctx.vk;
          if (ctx.explode != null) it.data.ctx.explode = ctx.explode;
        }
      }
    });
    // Marks the step, so undoing it puts the screenshots and the words back into the composer.
    const step = S.undo[S.undo.length - 1];
    if (step) step.added = { text, cap: capText, shots: note.data.shots.slice() };
    S.pending = [];
    for (const it of linked) S.adopt.delete(it.id);
    S.composeSince = Date.now();  // drawings made from here on count as the next note in the making (viewMode)
    S.cleanPic = true;            // the picture goes clean: the drawings are on the new note's card (modeAllows)
    // Leave the field so S / Shift+S / tool keys work again straight away.
    if (inp){ inp.value = ""; inp.style.height = ""; inp.blur(); }
    if (cin){ cin.value = ""; cin.style.height = ""; cin.blur(); }
    S.sel.clear();
    afterChange();
    const list = S.ui?.querySelector(".an-list");
    requestAnimationFrame(() => list?.querySelector(`[data-id="${note.id}"]`)?.scrollIntoView({ block: "nearest" }));
  }

  // ---- timeline markers -----------------------------------------------------------------------
  function renderMarks(){
    const track = S.bar && S.light?.querySelector(".vbar .vtrack");
    if (!track) return;
    let box = track.querySelector(".an-marks");
    const v = S.kind === "video" ? video() : null;
    const dur = v && Number.isFinite(v.duration) ? v.duration : (S.asset?.duration || 0);
    if (!v || !dur){ box?.remove(); host.marksChanged?.(); return; }
    if (!box){
      box = document.createElement("div");
      box.className = "an-marks";
      track.appendChild(box);
      box.addEventListener("pointerdown", (e) => {
        const m = e.target.closest?.("[data-t]");
        if (!m) return;
        e.stopPropagation(); e.preventDefault();
        const vid = video();
        if (!S.on) toggle(true);
        // The note first (it goes to its first frame), then this mark's frame: a note has a mark on each.
        if (m.dataset.note && S.pinFocus !== m.dataset.note) goNote(m.dataset.note);
        if (vid){ vidPause(vid); vidSeek(vid, landAt(Number(m.dataset.t))); }
      });
    }
    let html = "";
    marks().forEach((m) => {
      const n = m.note, t = m.t;
      html += n ? `<i class="an-mk note${n.data.status === "done" ? " done" : n.data.status === "progress" ? " prog" : ""}" data-t="${t}" data-note="${n.id}" style="left:${(t / dur * 100).toFixed(3)}%" title="${esc(m.num + ". " + (n.data.text || "").slice(0, 80))}"></i>`
        : `<i class="an-mk" data-t="${t}" style="left:${(t / dur * 100).toFixed(3)}%" title="Drawing at ${fmtTime(t, S.fps)}"></i>`;
    });
    box.innerHTML = html;
    host.marksChanged?.(); // a sequence of clips (index.html) shows this clip's marks on its own bar too
  }
  // The timeline's marks: {t, note?, num?}. A note has a mark on each frame it stands on (noteFrames:
  // its drawings' and its picture texts' frames — not the frame it was written on); a frame with only
  // loose drawings or a reply's has a plain one.
  function marks(){
    const out = [], seen = [];
    const has = (t) => seen.some((x) => sameFrame(x, t));
    notesSorted().forEach((n, i) => noteFrames(n).forEach((t) => {
      if (has(t)) return;
      seen.push(t); out.push({ t, note: n, num: i + 1 });
    }));
    for (const it of S.items.values()){
      const t = it.data.ctx?.t;
      if (!isDrawing(it) || t == null || has(t)) continue;
      seen.push(t); out.push({ t });
    }
    return out;
  }
  function markerTimes(){
    return marks().map((m) => m.t).sort((a, b) => a - b);
  }
  function stepFrame(n){
    const v = video();
    if (!v) return false;
    vidPause(v);
    if (!(v.duration > 0) || v.readyState < 1) return true; // no metadata yet: nothing to step (nor to cross)
    const fd = frameDur();
    // From the frame on screen (floor): rounding skipped a frame from its second half.
    const t = (Math.floor(v.currentTime / fd + 1e-6) + n) * fd + fd * 0.01;
    // A sequence of clips (index.html): past either end, the step moves into the neighbouring clip.
    if ((t < 0 || t > (v.duration || 0) - fd * 0.5) && host.seqEdge?.(n, fd)) return true;
    vidSeek(v, clamp(t, 0, v.duration || 0));
    return true;
  }
  function jumpMarker(dir){
    const v = video();
    if (!v) return false;
    const ts = markerTimes(), cur = v.currentTime, eps = frameDur() * 0.5;
    const t = dir > 0 ? ts.find((x) => x > cur + eps) : [...ts].reverse().find((x) => x < cur - eps);
    // A sequence of clips: the nearest marker in the clips after / before this one.
    if (t == null){ if (!host.seqMarker?.(dir)) toast(dir > 0 ? "No later marker" : "No earlier marker"); else v.pause(); return true; }
    vidPause(v);
    vidSeek(v, landAt(t));
    return true;
  }

  // ---- frame stamp ----------------------------------------------------------------------------
  // The frame on screen as a label over the video (not a drawing; annotation mode, video only). One icon toggles
  // it, the ▾ beside it (or a tap on the stamp) opens the settings, a drag - mouse, pen or finger - moves it and
  // snaps to the nearest of eight spots on release. While it is on, the same settings draw the label burned
  // into report pictures (bakeFrame), so both look alike: sizes are relative to the picture's width.
  function stampText(t, mode){
    const parts = RC.frameLabel(t, S.fps).split(" / ");  // "f128 / 0:05+3"
    return mode === "frame" ? parts[0] : mode === "time" ? parts[1] || parts[0] : parts.join(" / ");
  }
  let stampCx = null;
  // The label's box for a picture W px wide: font, padding, inset from the edge, and its size.
  function stampBox(text, W, st){
    const fs = Math.max(11, Math.round(W * st.size / 100)), pad = Math.round(fs * 0.4), m = Math.round(fs * 0.6);
    const font = `${st.font === "bold" ? 800 : 600} ${fs}px ${st.font === "mono" ? "ui-monospace, Consolas, monospace" : "system-ui, sans-serif"}`;
    const cx = stampCx || (stampCx = document.createElement("canvas").getContext("2d"));
    cx.font = font;
    return { fs, pad, m, font, text, w: Math.ceil(cx.measureText(text).width) + pad * 2, h: fs + pad * 2 };
  }
  // The box's top-left corner in a W x H picture for one of the eight spots.
  function stampXY(pos, W, H, b){
    return [pos.includes("l") ? b.m : pos.includes("r") ? W - b.m - b.w : (W - b.w) / 2,
      pos.includes("t") ? b.m : pos.includes("b") ? H - b.m - b.h : (H - b.h) / 2];
  }
  function paintStamp(force){
    const L = S.layer;
    if (!L) return;
    const g = geom(), v = video(), st = S.stamp, aOn = stampOn();
    const show = S.on && S.kind === "video" && aOn && g && g.nw && v;
    if (!show){ if (L.stamp) L.stamp.hidden = true; return; }
    if (!L.stamp){
      const el = document.createElement("div");
      el.className = "an-stamp";
      el.addEventListener("pointerdown", stampDown);
      for (const t of ["click", "dblclick"]) el.addEventListener(t, (ev) => ev.stopPropagation());  // not a play / pause of the viewer underneath
      L.root.appendChild(el);
      L.stamp = el;
      S.stampKey = ""; S.stampDrag = false;
    }
    if (S.stampDrag) return;
    const W = g.nw * g.s, H = g.nh * g.s, b = stampBox(stampText(frameStart(v.currentTime), st.mode), W, st);
    const [x, y] = stampXY(st.pos, W, H, b);
    const key = [b.text, b.font, b.w, b.h, st.color, st.bg, st.bgOp, r2(g.ox + x), r2(g.oy + y)].join("|");
    L.stamp.hidden = false;
    if (key === S.stampKey && !force) return;
    S.stampKey = key;
    const e = L.stamp;
    e.textContent = b.text;
    e.style.cssText = `left:${g.ox + x}px;top:${g.oy + y}px;width:${b.w}px;height:${b.h}px;font:${b.font};line-height:${b.fs}px;padding:${b.pad}px 0;` +
      `color:${st.color};background:${st.bgOp > 0 ? hexA(st.bg, st.bgOp) : "transparent"}`;
  }
  function stampDown(e){
    if (e.altKey || e.button !== 0 || !S.on || S.stampDrag) return;  // Alt: the viewer's own press; a second pointer is ignored
    e.preventDefault(); e.stopPropagation();
    // (g is taken at pointerdown: a zoom in mid-drag uses stale values - accepted.)
    const el = e.currentTarget, g = geom(), [px, py] = local(e), x0 = el.offsetLeft, y0 = el.offsetTop;
    const W = g.nw * g.s, H = g.nh * g.s, w = el.offsetWidth, h = el.offsetHeight;
    let moved = false;
    S.stampDrag = true;
    try { el.setPointerCapture(e.pointerId); } catch {}
    const mv = (ev) => {
      const [cx, cy] = local(ev);
      if (!moved && Math.hypot(cx - px, cy - py) < 4) return;
      moved = true;
      el.style.left = clamp(x0 + cx - px, g.ox, g.ox + W - w) + "px";
      el.style.top = clamp(y0 + cy - py, g.oy, g.oy + H - h) + "px";
    };
    const end = (ev) => {
      el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", end); el.removeEventListener("pointercancel", end); el.removeEventListener("lostpointercapture", end);
      try { el.releasePointerCapture(e.pointerId); } catch {}
      S.stampDrag = false;
      if (moved && ev.type === "pointerup"){
        const cx = el.offsetLeft - g.ox + w / 2, cy = el.offsetTop - g.oy + h / 2, b = { m: Math.round(Math.max(11, Math.round(W * S.stamp.size / 100)) * 0.6), w, h };
        let best = null, bd = Infinity;
        for (const pos of STAMP_POS){
          if (!pos) continue;
          const [x, y] = stampXY(pos, W, H, b), d = Math.hypot(x + w / 2 - cx, y + h / 2 - cy);
          if (d < bd){ bd = d; best = pos; }
        }
        S.stamp.pos = best; saveStamp(); paintStampPop();
      } else if (!moved && ev.type === "pointerup") toggleStampPop(true);
      paintStamp(true);
    };
    el.addEventListener("pointermove", mv); el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end); el.addEventListener("lostpointercapture", end);
  }
  function toggleStamp(){
    if (S.kind !== "video" || !S.on) return false;  // Video-group rows also run outside annotation mode: let the key fall through there
    setStampOn(S.asset?.id, !stampOn());
    paintBar(); paintStamp(true); paintStampPop();
    toast(stampOn() ? "Frame stamp on" : "Frame stamp off");
    return true;
  }
  let stampPop = null;
  function buildStampPop(lightEl, bar){
    stampPop?.remove();
    const seg = (k, opts) => `<span class="an-seg">${opts.map(([id, n]) => `<button type="button" data-sk="${k}" data-sv="${id}">${n}</button>`).join("")}</span>`;
    const pop = document.createElement("div");
    pop.className = "an-stampop";
    pop.hidden = true;
    pop.innerHTML = `
      <div class="an-spr"><b>Frame stamp</b><button type="button" class="an-ib" data-sx="close" title="Close">${ICON.close}</button></div>
      <div class="an-spr"><span>Show</span>${seg("mode", [["both", "Frame + time"], ["frame", "Frame"], ["time", "Time"]])}</div>
      <div class="an-spr"><span>Size</span><input type="range" data-sr="size" min="1" max="8" step="0.1"><em data-se="size"></em></div>
      <div class="an-spr"><span>Text</span><label class="an-pc"><input type="color" data-sc="color"></label>
        <span>Backdrop</span><label class="an-pc"><input type="color" data-sc="bg"></label></div>
      <div class="an-spr"><span>Opacity</span><input type="range" data-sr="bgOp" min="0" max="1" step="0.05"><em data-se="bgOp"></em></div>
      <div class="an-spr"><span>Font</span>${seg("font", [["normal", "Normal"], ["bold", "Bold"], ["mono", "Mono"]])}</div>
      <div class="an-spr"><span>Position</span><span class="an-spos">${STAMP_POS.map((p) => p ? `<button type="button" data-sk="pos" data-sv="${p}" title="${p}">${STAMP_ARROW[p]}</button>` : `<i></i>`).join("")}</span>
        <button type="button" class="an-ib" data-sx="reset" title="Back to the default look">Reset</button></div>`;
    pop.addEventListener("pointerdown", (e) => e.stopPropagation());
    // Sliders / colour inputs keep their own keys; Escape still reaches onKey so it can close the popover.
    pop.addEventListener("keydown", (e) => { if (/^(INPUT|SELECT)$/.test(e.target.tagName) && !hotkey(e, "Escape")) e.stopPropagation(); });
    pop.addEventListener("click", (e) => e.target.closest?.("button")?.blur());  // a focused button must not swallow keys
    const set = (k, v) => { S.stamp[k] = v; saveStamp(); paintStamp(true); paintStampPop(); };
    pop.querySelectorAll("[data-sk]").forEach((b) => { b.onclick = () => set(b.dataset.sk, b.dataset.sv); });
    pop.querySelectorAll("[data-sr]").forEach((r) => r.addEventListener("input", () => set(r.dataset.sr, Number(r.value))));
    pop.querySelectorAll("[data-sc]").forEach((c) => c.addEventListener("input", () => set(c.dataset.sc, c.value)));
    pop.querySelector("[data-sx=close]").onclick = () => closeStampPop();
    pop.querySelector("[data-sx=reset]").onclick = () => { S.stamp = { ...STAMP_DEFAULT }; saveStamp(); paintStamp(true); paintStampPop(); };
    lightEl.appendChild(pop);
    stampPop = pop;
    host.registerAutoClose?.(pop, () => { pop.hidden = true; }, bar.querySelector("[data-act=stampset]"));
    paintStampPop();
  }
  function paintStampPop(){
    const pop = stampPop, st = S.stamp;
    if (!pop) return;
    pop.querySelectorAll("[data-sk]").forEach((b) => b.classList.toggle("on", String(st[b.dataset.sk]) === b.dataset.sv));
    pop.querySelectorAll("[data-sr]").forEach((r) => { r.value = st[r.dataset.sr]; });
    pop.querySelectorAll("[data-sc]").forEach((c) => { c.value = st[c.dataset.sc]; });
    pop.querySelector("[data-se=size]").textContent = st.size.toFixed(1) + "%";
    pop.querySelector("[data-se=bgOp]").textContent = Math.round(st.bgOp * 100) + "%";
  }
  function closeStampPop(){ if (stampPop) stampPop.hidden = true; }
  // force: open (a tap on the stamp); without: toggle (the ▾). Opening shows the stamp, so a change is seen at once.
  function toggleStampPop(force){
    const pop = stampPop, btn = S.bar?.querySelector("[data-act=stampset]");
    if (!pop || !btn || S.kind !== "video") return;
    if (!(force ?? pop.hidden)){ pop.hidden = true; return; }
    if (!stampOn()){ setStampOn(S.asset?.id, true); paintBar(); paintStamp(true); }
    pop.hidden = false;
    paintStampPop();
    const lr = S.light.getBoundingClientRect(), br = btn.getBoundingClientRect();
    pop.style.left = clamp(br.left - lr.left - pop.offsetWidth / 2, 8, Math.max(8, lr.width - pop.offsetWidth - 8)) + "px";
    pop.style.top = (br.bottom - lr.top + 8) + "px";
  }

  // ---- tick: follow video time / camera / viewport --------------------------------------------
  function tick(){
    S.raf = 0;
    if (!S.light) return;
    const g = geom();
    let sig = g ? `${r2(g.ox)},${r2(g.oy)},${r2(g.s)},${g.w},${g.h}` : "";
    const v = video();
    if (v) sig += "|" + v.currentTime.toFixed(3);
    if (S.b3){
      const cam = curCam(), hid = curHidden();
      const ex = host.getV3D?.()?.explode;
      const vk = S.drag ? S.curVk : findVk(cam, hid, typeof ex === "number" ? ex : undefined);
      if (vk !== S.curVk && !S.drag){ S.curVk = vk; renderViews(); }
      if (cam) sig += "|" + cam.p.map((x) => x.toFixed(4)).join(",") + "|" + cam.t.map((x) => x.toFixed(4)).join(",");
      // A mesh shown or hidden (H, Ctrl+H, Alt+H) moves to another view like a camera move does.
      sig += "|h" + (hid ? hid.join(",") : "-");
      // The explode amount too: a view at another amount is another view (its drawings hide until it is the current one).
      sig += "|e" + (typeof ex === "number" ? ex.toFixed(4) : "-");
      // And the view itself (the animation pose decides it too): not the pose's time, which would repaint the
      // panel every frame while a model plays.
      sig += "|v" + (S.curVk || "-");
    }
    if (sig !== S.lastSig){
      S.lastSig = sig;
      if (!S.on && S.layer && shownOff()){ syncViewBox(); paintVisibility(); }
      if (S.on){
        syncViewBox();
        paintVisibility();
        paintStamp();
        renderSel();
        if (S.edit) S.edit.place();
        if (S.pinEdit) S.pinEdit.place();
        if (S.ui && !S.ui.hidden) renderPending();
      }
    }
    if (S.on){ paintPlate(); S.raf = requestAnimationFrame(tick); }
    else if (followOff()) S.raf = requestAnimationFrame(tick);
  }
  function startTick(){ if (!S.raf) S.raf = requestAnimationFrame(tick); }

  // ---- screenshots / compositing --------------------------------------------------------------
  const drawItems = (cx, items) => RC.drawCanvas(cx, items, numOf);
  // What is on screen right now (picture + visible drawings), at device resolution.
  async function composeView(){
    await RC.imagesReady(visibleDrawings());  // reference images decoded before they are drawn
    const g = geom();
    if (!g) return null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cv = document.createElement("canvas");
    cv.width = Math.round(g.w * dpr); cv.height = Math.round(g.h * dpr);
    const cx = cv.getContext("2d");
    const bg = getComputedStyle(surfaceEl()).backgroundColor;
    cx.fillStyle = bg && bg !== "rgba(0, 0, 0, 0)" ? bg : getComputedStyle(document.body).getPropertyValue("--bg").trim() || "#151619";
    cx.fillRect(0, 0, cv.width, cv.height);
    // The host paints what is on screen itself (compare: every layer in its split / tile, blend mode, labels);
    // ox / oy: where this surface sits in that picture. The drawings go on top, in this surface's geometry.
    const hv = S.b2 && host.captureView?.(dpr);
    if (hv){
      const hx = hv.cv.getContext("2d");
      hx.save();
      hx.beginPath(); hx.rect(dpr * hv.ox, dpr * hv.oy, dpr * g.w, dpr * g.h); hx.clip(); // (on screen they stay in this surface)
      hx.setTransform(dpr * g.s, 0, 0, dpr * g.s, dpr * (g.ox + hv.ox), dpr * (g.oy + hv.oy));
      if (!S.hidden) drawItems(hx, visibleDrawings());
      hx.restore();
      return { cv: hv.cv, dpr, ox: hv.ox, oy: hv.oy };
    }
    if (S.b2){
      const m = S.b2.media;
      cx.setTransform(dpr * g.s, 0, 0, dpr * g.s, dpr * g.ox, dpr * g.oy);
      try { cx.drawImage(m, 0, 0, g.nw, g.nh); } catch {}
    } else if (S.b3){
      const c3 = S.b3.capture();
      if (c3) cx.drawImage(c3, 0, 0, cv.width, cv.height);
      cx.setTransform(dpr * g.s, 0, 0, dpr * g.s, dpr * g.ox, dpr * g.oy);
    }
    if (!S.hidden) drawItems(cx, visibleDrawings());
    cx.setTransform(1, 0, 0, 1, 0, 0);
    return { cv, dpr };
  }
  // The area an exported 2D picture covers, in native pixels: the frame, grown to every drawing that reaches past
  // its edge plus a margin of 3% of the frame's longer side on that side. Capped at three frames each way (a stray
  // drawing far away must not make a giant picture of nothing).
  function exportExtent(items, nw, nh){
    let x0 = 0, y0 = 0, x1 = nw, y1 = nh;
    for (const it of items){
      const b = boundsOf(it);
      if (!b.every(Number.isFinite) || (b[2] - b[0] <= 0 && b[3] - b[1] <= 0)) continue;
      x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]);
    }
    const pad = 0.03 * Math.max(nw, nh);
    if (x0 < 0) x0 = Math.max(-3 * nw, x0 - pad);
    if (y0 < 0) y0 = Math.max(-3 * nh, y0 - pad);
    if (x1 > nw) x1 = Math.min(4 * nw, x1 + pad);
    if (y1 > nh) y1 = Math.min(4 * nh, y1 + pad);
    return [Math.floor(x0), Math.floor(y0), Math.ceil(x1), Math.ceil(y1)];
  }
  // The backdrop of an exported picture where it reaches past the frame: a set colour, or "auto" = the mean
  // colour of the frame's outer edge, so the margin reads as the frame going on. Kept in the settings
  // ("sight.annotate.exportBg"); set in the Export menu.
  const exportBgSetting = () => { const v = readJSON("sight.annotate.exportBg", "auto"); return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : "auto"; };
  function exportBackdrop(media){
    const v = exportBgSetting();
    if (v !== "auto") return v;
    try {
      const N = 32, c = document.createElement("canvas");
      c.width = N; c.height = N;
      const cx = c.getContext("2d", { willReadFrequently: true });
      cx.drawImage(media, 0, 0, N, N);
      const d = cx.getImageData(0, 0, N, N).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
        if (x > 1 && x < N - 2 && y > 1 && y < N - 2) continue;  // the outer two-pixel ring of the frame only
        const i = (y * N + x) * 4, a = d[i + 3] / 255;
        r += d[i] * a; g += d[i + 1] * a; b += d[i + 2] * a; n++;  // a transparent edge counts as black
      }
      const h = (x) => Math.round(x / n).toString(16).padStart(2, "0");
      return "#" + h(r) + h(g) + h(b);
    } catch { return "#000000"; }
  }
  // The full frame at native resolution (images / video), or the 3D view as rendered — used for
  // the PDF. `filter(it)` picks the drawings.
  function composeNative(filter, maxSide = 2000){
    const g = geom();
    if (!g) return null;
    if (S.b2){
      const m = S.b2.media, nw = g.nw, nh = g.nh;
      if (!nw || !nh) return null;
      const items = [...S.items.values()].filter((it) => isDrawing(it) && filter(it));
      // Drawings past the frame's edge widen the picture to them (plus a small margin on that side), over the
      // export backdrop (exportBackdrop: a set colour, or Auto = the frame's edge colour). [x0, y0]: the frame's
      // top-left in the picture, in native pixels.
      const [x0, y0, x1, y1] = exportExtent(items, nw, nh), W = x1 - x0, H = y1 - y0;
      const s = Math.min(1, maxSide / Math.max(W, H));
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(W * s)); cv.height = Math.max(1, Math.round(H * s));
      const cx = cv.getContext("2d");
      // The frame's rectangle in the picture's pixels: the margin strips around it get the backdrop (not under it,
      // so a see-through picture looks the same widened or not), and the frame stamp sits on it (bakeFrame).
      // Whole pixels, so the frame's edge meets the margin without a half-covered seam.
      const fx = Math.round(-x0 * s), fy = Math.round(-y0 * s);
      const fw = Math.max(1, Math.min(cv.width - fx, Math.round(nw * s))), fh = Math.max(1, Math.min(cv.height - fy, Math.round(nh * s)));
      cv.frameRect = [fx, fy, fw, fh];
      if (W > nw || H > nh){
        cx.fillStyle = exportBackdrop(m);
        const r = (x, y, w, h) => { if (w > 0 && h > 0) cx.fillRect(x, y, w, h); };
        r(0, 0, cv.width, fy); r(0, fy + fh, cv.width, cv.height - fy - fh);
        r(0, fy, fx, fh); r(fx + fw, fy, cv.width - fx - fw, fh);
      }
      try { cx.drawImage(m, fx, fy, fw, fh); } catch { return null; }
      cx.setTransform(fw / nw, 0, 0, fh / nh, fx, fy);
      drawItems(cx, items);
      return cv;
    }
    if (S.b3){
      const c3 = S.b3.capture();
      if (!c3) return null;
      const cv = document.createElement("canvas");
      cv.width = c3.width; cv.height = c3.height;
      const cx = cv.getContext("2d");
      cx.drawImage(c3, 0, 0);
      const sc = c3.height / 1000;
      cx.setTransform(sc, 0, 0, sc, c3.width / 2, c3.height / 2);
      drawItems(cx, [...S.items.values()].filter((it) => isDrawing(it) && filter(it)));
      return cv;
    }
    return null;
  }
  async function uploadCanvas(cv){
    const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
    if (!blob) throw new Error("encode failed");
    const r = await host.api("/api/review/shots", { method: "POST", headers: { "content-type": "image/png" }, body: blob });
    return r;
  }
  async function screenshot(region){
    if (!S.on) toggle(true);
    if (!surfaceEl()){ toast("Nothing to capture"); return; }
    if (region){
      finishEdit();
      S.region = { rect: null };
      S.light.classList.add("an-regioning");
      toast("Drag over the area to capture · Esc cancels", 2600);
      if (S.hover) updateCursor(...S.hover);
      renderSel();
      return;
    }
    await capture(null);
  }
  async function finishRegion(){
    const R = S.region;
    S.region = null;
    S.light?.classList.remove("an-regioning");
    renderSel();
    if (!R?.rect) return;
    const [a, b, c, d] = R.rect;
    const rect = [Math.min(a, c), Math.min(b, d), Math.abs(c - a), Math.abs(d - b)];
    if (rect[2] < 6 || rect[3] < 6){ toast("Area too small"); return; }
    await capture(rect);
  }
  function cancelRegion(){
    if (!S.region) return false;
    S.region = null;
    S.light?.classList.remove("an-regioning");
    renderSel();
    return true;
  }
  async function capture(rect){
    try {
      const res = await composeView();
      if (!res) return;
      let cv = res.cv;
      if (rect){
        const c2 = document.createElement("canvas"), dpr = res.dpr;
        c2.width = Math.round(rect[2] * dpr); c2.height = Math.round(rect[3] * dpr);
        const ox = res.ox || 0, oy = res.oy || 0; // (rect is in this surface's pixels)
        c2.getContext("2d").drawImage(cv, (rect[0] + ox) * dpr, (rect[1] + oy) * dpr, c2.width, c2.height, 0, 0, c2.width, c2.height);
        cv = c2;
      }
      const r = await uploadCanvas(cv);
      S.pending.push({ id: r.id, url: r.url });
      modeChanged();  // a screenshot waiting for its note: the clean picture
      S.light?.querySelector(".an-flash")?.classList.remove("go");
      const fl = S.light?.querySelector(".an-flash");
      if (fl){ void fl.offsetWidth; fl.classList.add("go"); }
      if (S.on && !panelShown()) togglePanel(true);
      renderPending();
      toast("Screenshot added to the note");
    } catch (e){
      console.warn(e);
      toast("Screenshot failed");
    }
  }

  // ---- export / import ------------------------------------------------------------------------
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
  function seekTo(v, t){
    return new Promise((res) => {
      if (Math.abs(v.currentTime - t) < 1e-4 && v.readyState >= 2){ res(); return; }
      let ended = false;
      const done = () => { if (ended) return; ended = true; v.removeEventListener("seeked", done); setTimeout(res, 30); };
      v.addEventListener("seeked", done);
      vidSeek(v, t); // a host with its own clock (compare) moves it; its element seeks on the next frame
      setTimeout(done, 3000);
    });
  }
  // Renders what a report needs: the cover (picture with every drawing) and per note its frame /
  // view with the drawings burned in (PDF). `forPage` (the HTML reviewer page): the pictures are
  // clean — the page draws the drawings itself from the package rows with review-core (and lets the
  // reviewer draw on them), so it gets the cover / frames without drawings, their pixel sizes and
  // `media` (how pictures map to doc units); picture notes get no frame of their own (the page
  // shows the cover with the note's drawings).
  // Report pictures are named by their file (and, for a video frame, RC.frameLabel: the frame number the
  // panel shows, and the timecode). While the frame stamp is on, that label is also burned into the picture's
  // corner, so it stays with the picture once it is taken out of the report; stamp off = clean pictures.
  const frameNo = (t) => Math.round(t * S.fps);
  const frameTitle = (a, t) => `${a.name} · ${RC.frameLabel(t, S.fps)}`;
  const viewTitle = (a, vk) => `${a.name} · View ${viewNumber(vk) || ""}`.trimEnd();
  // The label takes the frame-stamp settings (position, text, size, colours, font); the defaults are the look it
  // always had (top-left, "f128 / 0:05+3", white on a 60% black backdrop). The stamp's own toggle decides
  // whether it is burned at all (0.62.0), per video: `aid` is the exported asset (a report may run over several).
  function bakeFrame(cv, t, aid){
    if (!cv || !stampOn(aid)) return;
    const st = S.stamp, text = stampText(t, st.mode);
    if (!text) return;
    // On the frame, sized to it, also when the picture was widened past it (composeNative frameRect).
    const [fx, fy, fw, fh] = cv.frameRect || [0, 0, cv.width, cv.height];
    const b = stampBox(text, fw, st), [sx, sy] = stampXY(st.pos, fw, fh, b), x = fx + sx, y = fy + sy, cx = cv.getContext("2d");
    cx.save();
    // composeNative leaves its downscale on the context: draw the label in device pixels.
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.font = b.font;
    cx.textBaseline = "top";
    if (st.bgOp > 0){ cx.fillStyle = hexA(st.bg, st.bgOp); cx.fillRect(x, y, b.w, b.h); }
    cx.fillStyle = st.color;
    cx.fillText(text, x + b.pad, y + b.pad);
    cx.restore();
  }
  // everyNote (the notes ZIP): a note on a picture gets its own picture even when it is the only note.
  // Every picture also comes as {title, text, file}: which picture it is, its own text, and the file
  // name it gets in the ZIP / when downloaded from the page (RC.picFileName of the title).
  async function gatherReport(forPage, everyNote){
    S.gathering = true;
    try { return await gatherReport1(forPage, everyNote); } finally { S.gathering = false; }
  }
  // One export at a time: two would seek the same video under each other (and a sequence export switches clips).
  function exportBusy(){
    if (!S.gathering && !host.exportBusy?.()) return false;
    toast("An export is already running", 2500);
    return true;
  }
  async function gatherReport1(forPage, everyNote){
    await RC.imagesReady([...S.items.values()].filter(isDrawing));  // composeNative draws reference images synchronously
    const a = S.asset, notes = notesSorted();
    const toJpeg = (cv) => cv ? cv.toDataURL("image/jpeg", 0.9) : null;
    const out = [];
    const v = video();
    const keep = { t: v?.currentTime, playing: !!v && !v.paused, cam: curCam(), v3d: host.getV3D?.(), vk: S.curVk, hidden: S.hidden, hiddenReplies: S.hiddenReplies, anim: S.b3?.getAnimState?.() ?? null };
    // A playing model stops for the pictures (views without a pose would be taken wherever the clip is).
    if (S.b3) S.b3.pauseAnim?.();
    S.hidden = false; S.hiddenReplies = new Set();
    // A playing clip runs on after each seek: the frame would land late and miss its drawings.
    if (keep.playing) vidPause(v);
    let cover = null, coverSize = null;
    try {
      const pick = (f) => forPage ? () => false : f;
      let cv = S.b2 && !S.b2.isVid ? composeNative(pick((it) => !replyGone(it))) : null;
      cover = toJpeg(cv);
      if (cv) coverSize = [cv.width, cv.height];
      for (const [i, n] of notes.entries()){
        const d = n.data, c = d.ctx || null;
        let frame = null, cap = "", size = null, frameCtx = null, ownPic = picOfCtx(c);
        const more = [];
        const own = (it) => it.data.note === n.id && !replyGone(it);
        // A video note's / 3D note's pictures are the frames / views it has drawings or a picture text on
        // (0.47+: not the frame / view it was written on — a note with nothing there but its words keeps
        // that one, unless it has attached pictures). The first is the note's `frame` (frameCtx: where it
        // is), the rest `more`: {frame, size, caption, ctx}, each with everything shown there (the page
        // draws over them by ctx).
        // (A reply's drawing counts when its reply lives: the phone lets a reply draw on a frame the note missed.)
        const mine = [...S.items.values()].filter((it) => isDrawing(it) && own(it));
        const pics = [];  // {cv, caption, title, text, ctx, pic}
        const picOf = (cv, title, p, ctx, file) => { const text = RC.captionOf(d, p, sameFrame); return { cv, caption: [title, text].filter(Boolean).join(" — "), title, text, file: RC.picFileName(file || title), ctx, pic: p }; };
        if (S.b2 && !S.b2.isVid){
          // One note on a picture: its frame would just repeat the cover.
          if (!forPage && (everyNote || notes.length > 1) && [...S.items.values()].some(own)){ const cv0 = composeNative(own, 1600); if (cv0) pics.push(picOf(cv0, a.name, ownPic, null, `${a.name} · Note ${i + 1}`)); }
        } else if (v && c?.t != null){
          const fb = !(d.shots || []).length;
          for (const t of RC.noteTimes(d, mine.filter((it) => !it.data.reply).map((it) => it.data.ctx?.t), sameFrame, fb)){
            await seekTo(v, landAt(t));
            const cm = composeNative(pick((it) => ctxShown(it)), 1600);  // every drawing on that frame, whatever the panel shows
            if (cm){ bakeFrame(cm, t, a.id); pics.push(picOf(cm, frameTitle(a, t), { t }, { t, hold: 0 })); }
          }
        } else if (S.b3 && c?.vk){
          const vks = [];
          const addVk = (k) => { if (k && !vks.includes(k) && S.views.has(k)) vks.push(k); };
          mine.forEach((it) => { if (!it.data.reply) addVk(it.data.ctx?.vk || c.vk); });
          Object.keys(d.captions || {}).forEach((k) => { const p = picOfKey(k); if (p.vk && RC.captionOf(d, p)) addVk(p.vk); });
          if (!vks.length && !(d.shots || []).length) addVk(c.vk);
          vks.sort((x, y) => viewNumber(x) - viewNumber(y));
          for (const vk of vks){
            const view = S.views.get(vk);
            const look = vk === c.vk ? c.v3d || view.v3d : view.v3d || keep.v3d, ex = explodeOf(vk, vk === c.vk ? [n] : mine) ?? view.explode;
            if (look || ex != null) host.setV3D?.(viewLook(look, ex));
            if (view.anim) S.b3.setAnim?.(view.anim);
            S.b3.setCam(view.cam);
            S.curVk = vk;
            await nextFrame(); await nextFrame(); await nextFrame();
            const cm = composeNative(pick((it) => (it.data.ctx?.vk || (it.data.note === n.id ? c.vk : null)) === vk && !replyGone(it)));
            if (cm) pics.push(picOf(cm, viewTitle(a, vk), { vk }, { vk, cam: view.cam }));
          }
        }
        let own1 = null;
        pics.forEach((p, k) => {
          if (k){ more.push({ frame: toJpeg(p.cv), size: [p.cv.width, p.cv.height], caption: p.caption, title: p.title, text: p.text, file: p.file, ctx: p.ctx }); return; }
          frame = toJpeg(p.cv); size = [p.cv.width, p.cv.height]; cap = p.caption; frameCtx = p.ctx; ownPic = p.pic; own1 = p;
        });
        // Picture texts (FORMAT.md captions): under each picture, after which picture it is; a note with no
        // picture of its own (one note on an image: the cover is it) shows its picture's text under its words.
        const ownText = frame ? "" : RC.captionOf(d, ownPic, sameFrame);
        const shotCaptions = {}, shotFiles = {};
        (d.shots || []).forEach((sid, k) => {
          const t = RC.captionOf(d, { shot: sid }); if (t) shotCaptions[sid] = t;
          shotFiles[sid] = RC.picFileName(`${a.name} · Note ${i + 1} · Picture ${k + 1}`);
        });
        out.push({ id: n.id, num: i + 1, ctx: ctxLabel(frameCtx || noteCtx(n)), author: d.author || "", date: fmtDate(d.created), text: d.text || "", status: d.status, frame, size, frameCtx,
          frameCaption: cap, frameTitle: own1?.title || "", frameText: own1?.text || "", frameFile: own1?.file || "",
          picText: ownText, shotCaptions, shotFiles, more, shots: d.shots || [],
          replies: liveReplies(n).map((r) => ({ id: r.id, author: r.author || "", date: fmtDate(r.created), text: r.text || "", event: r.event || "", shots: r.shots || [] })) });
      }
    } finally {
      if (v && keep.t != null) await seekTo(v, keep.t);
      if (keep.playing && !host.pauseVideo) v.play().catch(() => {}); // (a host clock stays paused)
      if (S.b3 && keep.cam){ if (keep.v3d) host.setV3D?.(keep.v3d); S.b3.setCam(keep.cam); }
      if (S.b3 && keep.anim) S.b3.setAnimState?.(keep.anim);  // (playing again if it was)
      if (S.b3) S.curVk = keep.vk;
      S.hidden = keep.hidden; S.hiddenReplies = keep.hiddenReplies;
      paintVisibility();
    }
    const g = geom(), nw = g?.nw || a.width, nh = g?.nh || a.height;
    const dims = nw && nh ? `${nw} × ${nh}` : "";
    const stateLabel = STATE_LABEL[S.status] || "";
    return {
      asset_id: a.id,
      title: `Review — ${a.name}`,
      subtitle: a.path || "",
      meta: [["Type", (a.ext || "").replace(".", "").toUpperCase()], ["Size", dims], ["Duration", a.duration ? fmtTime(a.duration, S.fps) : ""], ["State", stateLabel], ["Reviewer", reviewer()], ["Notes", String(notes.length)], ["Open", String(notes.filter((n) => n.data.status !== "done").length)], ["In progress", String(notes.filter((n) => n.data.status === "progress").length || "")], ["Exported", fmtDate(Date.now())]],
      cover, coverSize, notes: out,
      media: { kind: S.b3 ? "model3d" : S.b2?.isVid ? "video" : S.b2 ? "image" : null, w: nw || null, h: nh || null, fps: S.fps },
      footer: `Sight ${host.appVersion?.() || ""}`.trim(), reveal: true, author: reviewer(),
    };
  }
  async function exportPdf(){
    if (!S.asset || exportBusy()) return;
    await flush();
    toast("Building PDF…", 60000);
    try {
      const payload = await gatherReport(false);
      const r = await host.api("/api/review/export/pdf", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      toast(`Saved <b>${esc(r.name)}</b> · ${r.pages} page${r.pages > 1 ? "s" : ""}`, 4000);
    } catch (e){
      console.warn(e);
      toast("PDF export failed", 3000);
    }
  }
  async function exportHtml(){
    if (!S.asset || exportBusy()) return;
    await flush();
    toast("Building the web page…", 60000);
    try {
      const payload = await gatherReport(true);
      const r = await host.api("/api/review/export/html", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      toast(`Saved <b>${esc(r.name)}</b> — opens in any browser; replies come back as a .srev file`, 5000);
    } catch (e){
      console.warn(e);
      toast("Export failed", 3000);
    }
  }
  async function exportZip(){
    if (!S.asset || exportBusy()) return;
    await flush();
    toast("Building the ZIP…", 60000);
    try {
      const payload = await gatherReport(false, true);
      const r = await host.api("/api/review/export/zip", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      toast(`Saved <b>${esc(r.name)}</b> · ${r.notes} note${r.notes === 1 ? "" : "s"}, ${r.pictures} picture${r.pictures === 1 ? "" : "s"}`, 4000);
    } catch (e){
      console.warn(e);
      toast("ZIP export failed", 3000);
    }
  }
  async function exportPackage(){
    if (!S.asset) return;
    await flush();
    try {
      const r = await host.api("/api/review/export/package", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ asset_id: S.asset.id, author: reviewer(), reveal: true }) });
      toast(`Saved <b>${esc(r.name)}</b> — send it; Sight opens it on the same file`, 4500);
    } catch (e){
      console.warn(e);
      toast("Export failed", 3000);
    }
  }
  async function copyText(){
    const a = S.asset, notes = notesSorted();
    const lines = [`Review — ${a.name}`, a.path || "", ""];
    notes.forEach((n, i) => {
      const d = n.data, c = ctxLabel(d.ctx);
      lines.push(`${i + 1}.${c ? " [" + c + "]" : ""} ${d.text || "(no text)"}${d.status === "done" ? "  ✓ resolved" : d.status === "progress" ? "  ▸ in progress" : ""}`);
      const by = [d.author, fmtDate(d.created)].filter(Boolean).join(", ");
      if (by) lines.push("   — " + by);
      for (const r of liveReplies(n)){
        lines.push(r.event ? `   ${eventIcon(r)} ${eventLabel(r)}${r.author ? " by " + r.author : ""}, ${fmtDate(r.created)}`
          : `   ↳ ${r.author ? r.author + ": " : ""}${r.text || ""}${r.shots?.length ? ` [${r.shots.length} picture${r.shots.length > 1 ? "s" : ""}]` : ""}`);
      }
    });
    try { await navigator.clipboard.writeText(lines.join("\n")); toast(`Copied ${notes.length} note${notes.length === 1 ? "" : "s"}`); }
    catch { toast("Clipboard not available"); }
  }
  async function importFile(file){
    let r;
    await flush();
    const body = await file.arrayBuffer();
    const post = async (restore, before) => {
      try {
        const res = await fetch("/api/review/import" + (restore ? `?restore=1&before=${Number.isFinite(before) ? before : ""}` : ""), { method: "POST", body });
        const r = await res.json().catch(() => ({}));
        if (res.status === 404){ toast(`The media is not in your library: <b>${esc(r.missing || "?")}</b> — add its folder and import again`, 5000); return null; }
        if (!res.ok){ toast(esc(r.detail || "Import failed"), 3500); return null; }
        return r;
      } catch (e){
        console.warn(e);
        toast("Import failed", 3000);
        return null;
      }
    };
    if (!(r = await post(false))) return;
    await importedResult(r, false);
    // Rows of the file that were deleted here after their last edit stay deleted by the merge rules
    // (FORMAT.md rule 5); the user may be importing the file precisely to get them back — offer it. On a bar,
    // not confirm(): a native dialog blocks the whole page, and after a file is dropped from the file manager
    // the window has no focus, so the dialog could sit unseen while thumbnails and clicks stopped working.
    const gone = r.bundle ? (r.results || []).reduce((s, x) => s + ((x.ok && x.deleted_here) | 0), 0) : r.deleted_here | 0;
    if (gone) offerRestore(gone, async () => {
      // Only rows deleted up to pass 1 (its `at`): one deleted here while the bar was up stays deleted.
      await flush();
      const again = await post(true, r.at);  // (pass 1 is committed either way)
      if (!again){ toast("The review merged, but restoring the deleted notes / drawings failed", 5000); return; }
      await importedResult(again, true);
    });
  }
  // The answer of one import pass: a toast, and the file opens (or reloads) with its notes. `restored`: the second
  // pass (?restore=1), which only revives rows deleted here — the file is already open from the first one.
  async function importedResult(r, restored){
    if (r.bundle){ await importedBundle(r, restored); return; }
    const parts = [["new", r.added], ["updated", r.updated], ["deleted", r.deleted]].filter(([, n]) => n).map(([w, n]) => `${n} ${w}`);
    toast(restored ? `Restored from the review file: ${parts.join(" · ") || "nothing"}`
      : parts.length ? `Merged review${r.author ? " from <b>" + esc(r.author) + "</b>" : ""}: ${parts.join(" · ")}` : "Already up to date — nothing new in this review file", 3500);
    await host.openAsset?.(r.asset_id, { keep: restored });
    if (S.asset?.id === r.asset_id){
      // The rows changed underneath the undo history; it would restore pre-merge states.
      S.undo = []; S.redo = [];
      obForget(S.asset.id); await load(S.asset); toggle(true); togglePanel(true);
    }
    host.onReviewChanged?.(r.asset_id);
  }
  // A non-blocking question at the bottom of the window (above the lightbox and the compare): a button for the
  // mouse and touch alike; it goes away by itself, on ✕, or when the next offer replaces it.
  let offerEl = null;
  function offerRestore(n, run){
    offerEl?._close();
    const el = document.createElement("div");
    el.className = "an-offer";
    el.setAttribute("role", "alertdialog");
    el.innerHTML = `<span>This review file holds ${n} note${n === 1 ? "" : "s"} / drawing${n === 1 ? "" : "s"} deleted in this library.</span>
      <button type="button" class="an-offer-go">Restore</button><button type="button" class="an-offer-x" title="Keep them deleted" aria-label="Keep them deleted">${ICON.close}</button>`;
    let timer = 0;
    el._close = () => { clearTimeout(timer); el.remove(); if (offerEl === el) offerEl = null; };
    for (const t of ["pointerdown", "mousedown", "dblclick", "contextmenu", "wheel", "keydown"]) el.addEventListener(t, (e) => e.stopPropagation());
    el.querySelector(".an-offer-go").addEventListener("click", (e) => { e.stopPropagation(); el._close(); run(); });
    el.querySelector(".an-offer-x").addEventListener("click", (e) => { e.stopPropagation(); el._close(); });
    // Hovering (or touching) keeps it: the timer starts again when the pointer leaves.
    const arm = () => { clearTimeout(timer); timer = setTimeout(el._close, 15000); };
    el.addEventListener("pointerenter", () => clearTimeout(timer));
    el.addEventListener("pointerleave", arm);
    document.body.appendChild(el);
    offerEl = el;
    arm();
  }
  // A bundle (several clips' packages in one .srev, docs/FORMAT.md "Bundle"): one summary toast; an affected clip
  // that is open reloads (its undo history would restore pre-merge states); nothing new opens unless exactly one
  // clip was updated — then it opens as for a single package.
  async function importedBundle(r, restored = false){
    const res = Array.isArray(r.results) ? r.results : [];
    const ok = res.filter((x) => x.ok), changed = ok.filter((x) => x.added || x.updated || x.deleted);
    const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
    const names = (xs) => xs.map((x) => esc(x.name || "?")).join(", ");
    const missing = res.filter((x) => !x.ok && x.missing != null), bad = res.filter((x) => !x.ok && x.error);
    const dup = res.filter((x) => !x.ok && x.duplicate != null);
    const parts = [];
    if (changed.length) parts.push(`${plural(changed.length, "clip")} updated`);
    if (ok.length > changed.length) parts.push(`${ok.length - changed.length} already up to date`);
    if (missing.length) parts.push(`${missing.length} not in your library: <b>${names(missing)}</b>`);
    if (bad.length) parts.push(`${bad.length} damaged${bad.some((x) => x.name) ? ": " + names(bad.filter((x) => x.name)) : ""}`);
    if (dup.length) parts.push(dup.map((x) => `${esc(x.name || "?")}: same file as clip ${x.duplicate + 1}`).join(" · "));
    const head = `${restored ? "Restored from the review" : "Review"} of ${plural(res.length, "clip")}${r.author ? " from <b>" + esc(r.author) + "</b>" : ""}`;
    toast(`${head}: ${parts.join(" · ") || "nothing imported"}`, missing.length || bad.length || dup.length ? 7000 : 4000);
    if (changed.length === 1){
      const aid = changed[0].asset_id;
      await host.openAsset?.(aid, { keep: restored });
      if (S.asset?.id === aid){ S.undo = []; S.redo = []; obForget(S.asset.id); await load(S.asset); toggle(true); togglePanel(true); }
      host.onReviewChanged?.(aid);
      return;
    }
    for (const x of ok){
      if (S.asset?.id === x.asset_id){ S.undo = []; S.redo = []; obForget(S.asset.id); await load(S.asset); }
      host.onReviewChanged?.(x.asset_id);
    }
  }

  // ---- mode -----------------------------------------------------------------------------------
  const supported = () => S.kind === "image" || S.kind === "video" || S.kind === "psd" || S.kind === "model3d" || S.kind === "board";
  function toggle(force){
    const want = force ?? !S.on;
    if (want && !supported()){ toast("Annotations work on images, video and 3D models"); return false; }
    if (want === S.on) return true;
    S.on = want;
    if (want){ S.tool = "brush"; S.crop = null; }  // the drawing mode always starts with the brush
    if (!want){
      closeHelp(); closeStampPop(); closeShotView(); S.stampDrag = false; finishEdit(); cancelRegion(); S.sel.clear(); S.crop = null; S.drag = null; S.pinFocus = null; flush();
      // A board keeps its drawings on show with the mode off: no hover circle, no "hidden" left over from the bar.
      S.hover = null;   // drawings stay on show (shownOff): no brush circle left over the picture
      if (isBoard()) S.hidden = false;
    }
    S.light?.classList.toggle("an-on", S.on);
    paintAlt();
    S.b3?.annotating?.(S.on);
    if (S.bar) S.bar.hidden = !S.on;
    const el = surfaceEl();
    if (el){ setCursor(el, "tool", null); el.classList.toggle("an-active", S.on); }
    if (S.on && S.kind === "video" && !S.fpsKnown) loadFps();
    renderAll();
    renderSel();
    paintBar();
    renderProps();
    syncPanel();
    paintBadge();
    paintPlate();
    host.onModeChange?.(S.on);
    startTick();
    return true;
  }
  function toggleHidden(){ S.hidden = !S.hidden; paintBar(); paintBadge(); paintVisibility(); renderSel(); if (followOff()) startTick(); toast(S.hidden ? "Drawings hidden" : "Drawings shown"); }
  // The notes button (index.html #notesBtn in the lightbox bar, #boardNotesBtn in the top bar for a board — host.notesBtn):
  // opens / closes the panel of the mode in use; its badge counts the notes.
  function paintNotesBtn(nb, n){
    if (!nb) return;
    nb.hidden = !supported() || host.notesBtnShown?.() === false;
    nb.classList.toggle("on", panelShown());
    nb.setAttribute("aria-pressed", panelShown() ? "true" : "false");
    const nbad = nb.querySelector(".an-badge");
    if (nbad){ nbad.textContent = n || ""; nbad.hidden = !n; }
    if (!nb.dataset.wired){ nb.dataset.wired = "1"; nb.addEventListener("click", () => { if (S.asset && supported()) togglePanel(); }); }
  }
  function paintBadge(){
    paintEye();
    if (host.notesBtn) paintNotesBtn(host.notesBtn(), [...S.items.values()].filter((it) => it.kind === "note").length);
    const b = S.light?.querySelector("#annoBtn");
    if (!b) return;
    b.classList.toggle("on", S.on);
    b.hidden = !supported();
    const n = [...S.items.values()].filter((it) => it.kind === "note").length;
    const badge = b.querySelector(".an-badge");
    if (badge){ badge.textContent = n || ""; badge.hidden = !n; }
    paintNotesBtn(S.light.querySelector("#notesBtn"), n);
  }
  // The one eye (hide / show the drawings), in the top bar: index.html #drawEyeBtn in the lightbox bar, #boardEyeBtn for a
  // board (host.eyeBtn). Shown when there are drawings: while drawing (any file), or while just watching where they show
  // (shownOff: a picture / video; a board shows its drawings while watching and resets the eye when drawing ends).
  function paintEye(){
    const eye = host.eyeBtn ? host.eyeBtn() : S.light?.querySelector("#drawEyeBtn");
    if (!eye) return;
    // (While drawing, a hidden state carried over from another file shows even with nothing drawn yet: new strokes
    // would vanish without a sign.)
    eye.hidden = !S.asset || !supported() || !(hasDrawings() || (S.on && S.hidden)) || host.notesBtnShown?.() === false || !(S.on || (shownOff() && !isBoard()));
    const vid = S.kind === "video", onion = vid && S.onion;
    eye.innerHTML = S.hidden ? ICON.eyeOff : onion ? ICON.onion : ICON.eye;
    eye.classList.toggle("off", !!S.hidden);
    eye.classList.toggle("onion", onion);
    eye.title = (S.hidden ? "Show" : "Hide") + " the drawings (Shift+H)"
      + (vid ? ` · right-click / long-press: onion skin ${onion ? "off" : "on"} (drawings fade between annotated frames)` : "");
    eye.setAttribute("aria-pressed", S.hidden ? "true" : "false");
    if (eye.dataset.wired) return;
    eye.dataset.wired = "1";
    let lp = 0, longed = false, lastPT = "mouse";
    eye.addEventListener("click", (e) => { if (longed){ longed = false; e.preventDefault(); return; } if (S.asset) toggleHidden(); });
    // A touch / pen long-press is the timer's; Android Chrome and Windows pens also fire contextmenu for it — not twice.
    eye.addEventListener("contextmenu", (e) => { e.preventDefault(); if (lastPT === "mouse") toggleOnion(); });
    // (A pen's barrel button comes as button 2: a right-click like the mouse's, its contextmenu toggles, no timer.)
    eye.addEventListener("pointerdown", (e) => { longed = false; lastPT = e.button === 2 ? "mouse" : e.pointerType || "mouse"; if (lastPT === "mouse") return; lp = setTimeout(() => { longed = true; toggleOnion(); }, 550); });
    const cancel = () => clearTimeout(lp);
    eye.addEventListener("pointerup", cancel); eye.addEventListener("pointercancel", cancel); eye.addEventListener("pointerleave", cancel);
  }
  // Onion skin: a way of viewing a video's drawings, not a tool — on the eye (right-click / long-press).
  function toggleOnion(){
    if (!S.asset || S.kind !== "video") return;
    S.onion = !S.onion;
    writeJSON("sight.annotate.onion", S.onion);
    if (S.onion && S.hidden){ S.hidden = false; paintBar(); }   // asking for the ghosts means showing the drawings
    paintBadge(); paintVisibility(); renderSel();
    if (followOff()) startTick();   // a playing video's drawings follow again (the tick stopped while they were hidden)
    toast(S.onion ? "Onion skin on — drawings fade between annotated frames" : "Onion skin off");
  }
  async function loadFps(){
    const a = S.asset;
    try {
      const info = await host.api(`/api/assets/${a.id}/info`);
      for (const sec of info.sections || []) for (const row of sec.rows || []){
        if (/frame rate/i.test(row[0] || "")){ const f = parseFloat(row[1]); if (f > 0 && S.asset?.id === a.id){ S.fps = f; S.fpsKnown = true; } }
      }
    } catch {}
    renderPanel();
  }

  // ---- keyboard -------------------------------------------------------------------------------
  // The one hotkey table: [combo, handler, label, group]. runHotkeys reads the first two; the help overlay
  // ("?") is rendered from the same rows (rows with the same label + group are shown as one line, so aliases
  // like Ctrl+Y / Ctrl+Shift+Z cannot drift from what actually fires). A row without a label is not listed.
  function keyTable(){
    const G = { tool: "Drawing tools", edit: "Editing", notes: "Notes and panels", nav: "Moving the selection", video: "Video", d3: "3D models", gen: "General" };
    const rows = [
      ["Shift+Slash", () => toggleHelp(), "Show / hide this list", G.gen],
      ["Escape", () => { if (endCrop()) return; if (S.sel.size){ S.sel.clear(); renderSel(); renderProps(); return; } if (S.pinFocus){ S.pinFocus = null; paintVisibility(); renderPanel(); return; } toggle(false); }, "Deselect / clear pin focus, then leave annotation mode", G.gen],
      ["KeyA", () => toggle(false), "Leave annotation mode (in a 3D view: Shift+A)", G.gen], ["Shift+KeyA", (e) => e.repeat || toggle(false), "Leave annotation mode (in a 3D view: Shift+A)", G.gen],
      ["Ctrl+KeyZ", () => undo(), "Undo", G.edit], ["Ctrl+Shift+KeyZ", () => redo(), "Redo", G.edit], ["Ctrl+KeyY", () => redo(), "Redo", G.edit],
      ["Delete", () => deleteSelection(), "Delete the selection", G.edit], ["Backspace", () => deleteSelection(), "Delete the selection", G.edit], ["KeyX", () => deleteSelection(), "Delete the selection", G.edit],
      ["Shift+Delete", () => clearShown(), "Clear the drawings on screen", G.edit],
      ["Ctrl+KeyC", () => copySelection(), "Copy", G.edit], ["Ctrl+KeyX", () => cutSelection(), "Cut", G.edit], ["Ctrl+KeyV", () => paste(), "Paste", G.edit], ["Ctrl+KeyD", () => duplicateSelection(), "Duplicate", G.edit],
      ["Ctrl+KeyA", () => selectAll(), "Select all drawings on screen", G.edit],
      ["Ctrl+BracketRight", () => reorder(1), "Bring forward", G.edit], ["Ctrl+BracketLeft", () => reorder(-1), "Send backward", G.edit],
      ["BracketLeft", () => resizeTool(1 / 1.2), "Smaller brush / stroke / text", G.tool], ["BracketRight", () => resizeTool(1.2), "Larger brush / stroke / text", G.tool],
      ...TOOLS.filter(Boolean).map(([id, combo, label]) => [combo, () => (id === "rect" ? setShape("rect") : setTool(id)), id === "rect" ? "Rectangle" : label, G.tool]),
      ["KeyO", () => setShape("ellipse"), "Ellipse", G.tool],
      ["KeyS", () => { screenshot(false); }, "Screenshot of the view into the note", G.notes], ["Shift+KeyS", () => { screenshot(true); }, "Screenshot of an area", G.notes],
      ["KeyC", () => togglePanel(), "Show / hide the notes panel", G.notes], ["Shift+KeyH", () => toggleHidden(), "Hide / show the drawings", G.notes],
      ["Enter", () => { if (!endCrop()) focusComposer(); }, "Write a note (Enter adds it, Shift+Enter is a new line); finish cropping", G.notes],
      ["Alt+KeyM", () => dictateNote(), "Dictate into the note / reply / picture text (again: stop; right-click the mic: language)", G.notes],
      ["ArrowLeft", () => nudge(-1, 0), "Nudge the selection 1 px", G.nav], ["ArrowRight", () => nudge(1, 0), "Nudge the selection 1 px", G.nav], ["ArrowUp", () => nudge(0, -1), "Nudge the selection 1 px", G.nav], ["ArrowDown", () => nudge(0, 1), "Nudge the selection 1 px", G.nav],
      ["Shift+ArrowLeft", () => nudge(-10, 0), "Nudge the selection 10 px", G.nav], ["Shift+ArrowRight", () => nudge(10, 0), "Nudge the selection 10 px", G.nav], ["Shift+ArrowUp", () => nudge(0, -10), "Nudge the selection 10 px", G.nav], ["Shift+ArrowDown", () => nudge(0, 10), "Nudge the selection 10 px", G.nav],
      ["Comma", () => stepFrame(-1), "Previous frame (also outside annotation mode)", G.video], ["Period", () => stepFrame(1), "Next frame (also outside annotation mode)", G.video],
      ["Shift+KeyF", () => toggleStamp(), "Frame stamp on the video (drag it to a corner / side; settings: the ▾ next to its icon)", G.video],
      ["Shift+Comma", () => jumpMarker(-1), "Previous note marker on the timeline", G.video], ["Shift+Period", () => jumpMarker(1), "Next note marker on the timeline", G.video],
      // 3D: D would still fly the camera (W/A/S are taken above) and move it off the drawings.
      ["KeyD", () => S.kind === "model3d", S.kind === "model3d" ? "Reserved: does not fly the camera while annotating (W / A / S are tools)" : null, G.d3],
    ];
    // A board: A / S / video and 3D keys are not annotation keys there — A frames the whole board (canvas.js),
    // Shift+A leaves the mode (and enters it, from the canvas).
    if (!isBoard()) return rows;
    const off = new Set(["KeyA", "KeyS", "Shift+KeyS", "Comma", "Period", "Shift+Comma", "Shift+Period", "Shift+KeyF", "KeyD"]);
    return rows.filter((r) => !off.has(r[0])).map((r) => (r[0] === "Shift+KeyA" ? [r[0], r[1], "Enter / leave annotation mode", r[3]] : r));
  }
  // What a combo looks like to a person: KeyV -> V, Ctrl+Shift+KeyZ -> Ctrl+Shift+Z, BracketLeft -> [.
  const KEY_NAMES = { BracketLeft: "[", BracketRight: "]", Comma: ",", Period: ".", Slash: "?", Delete: "Del", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓" };
  const keyName = (c) => c.split("+").map((k) => KEY_NAMES[k] || k.replace(/^Key/, "")).join("+").replace("Shift+?", "?");
  // [{ group, rows: [[keys[], label]] }] in table order.
  function helpGroups(){
    const groups = new Map();
    for (const [combo, , label, group] of keyTable()){
      if (!label) continue;
      if (!groups.has(group)) groups.set(group, new Map());
      const g = groups.get(group);
      if (!g.has(label)) g.set(label, []);
      g.get(label).push(keyName(combo));
    }
    // Mouse / touch things that are not hotkeys (static: they live in the pointer code, not in the table).
    const extra = {
      "Drawing tools": [[["Ctrl (held)"], "Eraser with any tool"], [["Shift+click"], "Straight line from the last point of this tool (brush, pencil, marker, lasso, stroke arrows, line, arrow, eraser)"], [["Shift (held)"], "While dragging: stroke, line, arrow or pin line horizontal or vertical; rectangle square, ellipse circle"]],
      "General": [[["Alt + drag"], isBoard() ? "Pan the board while a drawing tool is active (middle-drag and the wheel pan too, right-drag / Ctrl+wheel zoom)" : "Hand the drag to the viewer (pan / zoom, orbit in 3D) while a drawing tool is active"],
        [["Ctrl + right-drag"], "Sideways: the tool's size (right = bigger), up / down: its opacity (up = more solid); with the select tool, the selection's (touch: press and hold, then drag, in the phone app / review page)"]],
      ...(S.kind !== "model3d" ? {} : { "3D models": [[["Shift+A"], "Enter / leave annotation mode (A flies the camera in a 3D view)"], [["Alt+1–9"], "Save the camera view (1–9 recall it)"]] }),
    };
    for (const [group, rows] of Object.entries(extra)){
      if (!groups.has(group)) groups.set(group, new Map());
      for (const [keys, label] of rows) groups.get(group).set(label, keys);
    }
    return [...groups].map(([group, rows]) => ({ group, rows: [...rows].map(([label, keys]) => [keys, label]) }));
  }
  let help = null;
  function openHelp(){
    if (help || !S.light) return;
    document.activeElement?.blur?.();
    const el = document.createElement("div");
    el.className = "an-help";
    el.innerHTML = `<div class="an-hcard" role="dialog" aria-label="Annotation shortcuts">
      <div class="an-hh"><b>Annotation shortcuts</b><button type="button" class="an-ib" data-act="hclose" title="Close (Esc)">${ICON.close}</button></div>
      <div class="an-hbody">${helpGroups().map((g) => `<section><h4>${esc(g.group)}</h4>${g.rows.map(([keys, label]) => `<div class="an-hrow"><span class="an-hk">${keys.map((k) => `<kbd>${esc(k)}</kbd>`).join("")}</span><span>${esc(label)}</span></div>`).join("")}</section>`).join("")}</div>
      <p class="an-hfoot">On a touch screen every tool, undo and the notes panel have a button in the toolbar (screenshots: the buttons by the note field).</p></div>`;
    // A full-screen backdrop: nothing underneath sees the pointer, wheel or touch while this is open.
    for (const t of ["pointerdown", "pointerup", "pointermove", "mousedown", "mouseup", "dblclick", "contextmenu", "touchstart", "touchend", "wheel", "touchmove"]){
      el.addEventListener(t, (ev) => {
        ev.stopPropagation();
        const inBody = !!ev.target.closest?.(".an-hbody");
        if (ev.cancelable && (t === "contextmenu" || ((t === "wheel" || t === "touchmove") && !inBody))) ev.preventDefault();
      }, { passive: false });
    }
    el.addEventListener("click", (ev) => { ev.stopPropagation(); if (ev.target === el || ev.target.closest("[data-act=hclose]")) closeHelp(); });
    S.light.appendChild(el);
    help = el;
    el.querySelector("[data-act=hclose]").focus({ preventScroll: true });
  }
  function closeHelp(){
    if (!help) return;
    help.remove(); help = null;
  }
  function toggleHelp(){ if (help) closeHelp(); else openHelp(); return true; }
  function onKey(e){
    if (!S.light) return false;
    // The help overlay owns the keyboard: only Esc (and ?) get through, everything else is swallowed so
    // neither the annotator nor the lightbox behind it acts. Browser shortcuts (Ctrl/Alt, F-keys) are left alone.
    if (help){
      if (hotkey(e, "Escape") || hotkey(e, "Shift+Slash")){ e.preventDefault(); closeHelp(); }
      // Enter / Space on the focused close button must still press it (keyboard-only users).
      else if (e.target?.closest?.("[data-act=hclose]") && (hotkey(e, "Enter") || hotkey(e, "Space"))) { /* default: click */ }
      else if (!e.ctrlKey && !e.metaKey && !e.altKey && !/^F\d+$/.test(e.code)) e.preventDefault();
      return true;
    }
    // A Ctrl + right-drag in progress: Esc cancels it, other keys wait (Ctrl is already down: a stray Ctrl+Z / Ctrl+D
    // mid-drag would mix an undo or a copy into the drag's own step).
    if (S.drag?.sizeOp){ e.preventDefault(); if (hotkey(e, "Escape")) abortGesture(); return true; }
    if (stampPop && !stampPop.hidden && hotkey(e, "Escape")){ e.preventDefault(); closeStampPop(); return true; }
    // An enlarged screenshot closes first (before deselect / pin / leaving the mode would eat the Esc).
    if (S.shotView && hotkey(e, "Escape")){ e.preventDefault(); closeShotView(); return true; }
    const tag = e.target?.tagName;
    const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable;
    // Ctrl+C with the pointer over a note's / reply's / picture's text (the panel or the text plate): copies that text.
    // (Also from a focused field with nothing selected in it, e.g. the note composer kept focused.)
    const fieldSel = typing && typeof e.target.selectionStart === "number" && e.target.selectionStart !== e.target.selectionEnd;
    if (!fieldSel && !e.target?.isContentEditable && hotkey(e, "Ctrl+KeyC") && copyHoveredText()){ e.preventDefault(); return true; }
    if (!S.on){
      if (typing) return false;
      // The notes panel opens for reading without the drawing tools (C, or the notes button).
      if (supported() && readable() && hotkey(e, "KeyC") && !e.repeat){ e.preventDefault(); togglePanel(); return true; }
      if (S.pinFocus && hotkey(e, "Escape")){ e.preventDefault(); S.pinFocus = null; paintVisibility(); renderPanel(); return true; }
      // The eye works while just watching too (drawings are shown on playback).
      if (shownOff() && !isBoard() && hasDrawings() && hotkey(e, "Shift+KeyH")){ e.preventDefault(); if (!e.repeat) toggleHidden(); return true; }
      // Frame stepping works in any video, annotating or not.
      if (S.kind === "video") return runHotkeys(e, keyTable().filter((r) => r[3] === "Video"));
      return false;
    }
    if (typing) return false;
    if (S.region && hotkey(e, "Escape")){ e.preventDefault(); cancelRegion(); return true; }
    return runHotkeys(e, keyTable());
  }
  // The text under the pointer in the notes panel / the text plate (a note's text, a reply, a picture's text), copied
  // to the clipboard. Not when there is a real text selection (the browser copies that) or nothing is hovered.
  function copyHoveredText(){
    const sel = window.getSelection?.();
    if (sel && !sel.isCollapsed && String(sel).trim()) return false;
    const el = S.light?.querySelector(".an-nt:hover, .an-rt:hover, .an-cap:hover, .scp-theme:hover, .scp-text:hover");
    if (!el) return false;
    let text;
    if (el.classList.contains("an-nt")){
      const n = S.items.get(el.closest(".an-note")?.dataset.id);
      text = n?.kind === "note" ? n.data.text : "";
    } else if (el.classList.contains("an-cap")) text = el.querySelector("span")?.textContent;
    else text = el.textContent;
    if (!text || !String(text).trim()) return false;
    navigator.clipboard?.writeText(String(text)).then(() => toast("Copied"), () => toast("Clipboard not available"))
      ?? toast("Clipboard not available");
    return true;
  }
  function resizeTool(f){
    const tg = propsTarget();
    const p = propList(tg).find((q) => q.k === "size" || q.k === "width");
    if (!p) return false;
    const step = (v) => clamp(Math.round((Number(v) || 1) * f * 10) / 10, p.min, p.max);  // screen px
    if (!tg.items || S.edit) setProp(p, step(propValue(tg, p)), true);
    else {
      // A selection: each drawing from its own value (one selected: as the tool), one undo step per run of presses.
      const ids = tg.items.map((it) => it.id).filter((id) => S.items.has(id) && editable(S.items.get(id)));
      if (!ids.length) return false;
      const kk = k();
      commit(ids, () => {
        for (const id of ids){
          const it = S.items.get(id);
          if (PROPS[propType(it)]?.some((q) => q.k === p.k)) it.data[p.k] = step(it.data[p.k] / kk) * kk;
        }
      }, "prop:" + p.k);
    }
    renderProps(); renderSel();
    return true;
  }

  // ---- lifecycle ------------------------------------------------------------------------------
  function mount(lightEl){
    S.light = lightEl;
    lightEl.classList.add("an-host");  // the CSS below keys on this (the lightbox and a board view share it)
    if (host.board) lightEl.classList.add("an-bhost");
    S.dict = createDictationUI({ host: lightEl, registerAutoClose: host.registerAutoClose, floating: ".an-nedit, .an-redit, .scp-ta", toast,
      getEngine: () => readJSON("sight.dictation.engine", "webspeech"),
      getLang: () => readJSON("sight.dictation.lang", ""), setLang: (v) => writeJSON("sight.dictation.lang", v) });
    S.bar = buildBar(lightEl);
    S.ui = buildPanel(lightEl);
    const t = document.createElement("div");
    t.className = "an-toast";
    lightEl.appendChild(t);
    const fl = document.createElement("div");
    fl.className = "an-flash";
    lightEl.appendChild(fl);
    paintBar();
  }
  function unmount(){
    closeHelp();
    // The plates first: an edit still open there saves into this asset's notes before the flush.
    S.plate?.destroy(); S.plate = null;
    S.dict?.destroy(); S.dict = S.dictTa = null;
    closeShotView();
    settle();
    obFlush();
    cancelAnimationFrame(S.raf);
    S.raf = 0;
    S.on = false; S.stampDrag = false;
    S.light = S.bar = S.ui = null;
    S.b2 = S.b3 = null;
    S.layer = null;
    S.asset = null;
    S.items.clear(); S.saved.clear(); S.sel.clear();
    S.undo = []; S.redo = []; S.pending = []; S.adopt.clear();
    resetPF();
    host.onModeChange?.(false);
  }
  function setAsset(a){
    // The plates first (an open edit saves into the old asset's notes), then the flush.
    S.plate?.destroy(); S.plate = null;
    closeShotView();
    settle();
    obFlush();
    cancelRegion();
    S.asset = a;
    S.kind = a.ext === ".psd" ? "psd" : a.kind;
    // Always drop the overlay. Compare reuses its viewer node; leaving the old layer painted a second copy.
    S.layer?.root.remove();
    (S.b2?.wrap || S.b3?.host)?.querySelectorAll(":scope > .an-layer").forEach((n) => n.remove());
    S.b2 = S.b3 = null;
    S.layer = null;
    S.anchors = {};
    S.items.clear(); S.saved.clear(); S.sel.clear(); S.crop = null;
    S.undo = []; S.redo = []; S.pending = [];
    S.views.clear(); S.curVk = null;
    S.pinFocus = null; S.cleanPic = false; S.hiddenReplies.clear(); S.adopt.clear();
    S.openedAt = S.composeSince = Date.now();
    resetPF();
    S.status = ""; S.statusHist = []; S.versions = []; S.prevOpen = null;
    notesSig = "";
    S.fps = 25; S.fpsKnown = false;
    S.lastSig = "";
    if (!supported() && S.on) toggle(false);
    paintBadge();
    paintBar();
    renderProps();
    if (supported()) load(a);
    else { renderPanel(); }
    // Frame stepping (`,` / `.`) works without annotating too: it needs the clip's real rate.
    if (S.kind === "video") loadFps();
    if (S.on && S.kind === "video") loadFps();
    syncPanel();
  }
  function attachInput(el){
    if (wired.has(el)) return;  // a board view re-binds the same viewport for every board
    wired.add(el);
    el.addEventListener("pointerdown", onDown, true);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    // A marquee whose pointer lost capture without an up / cancel reaching us ends here: otherwise the
    // second-pointer guard in onDown would swallow every later touch (new pointerIds) while it is stuck.
    el.addEventListener("lostpointercapture", (e) => { if ((S.drag?.marquee && S.drag.pid === e.pointerId) || S.drag?.sizeOp?.pid === e.pointerId) onUp(e); });
    el.addEventListener("pointerleave", (e) => {
      // A pan is captured by an ancestor (compare's stage). Leaving must not freeze the brush circle.
      if (e.buttons) return;
      S.hover = null;
      if (S.on && !S.drag) renderSel();
    });
    // Pictures dropped on the frame become reference images (files from outside, or files dragged from the library).
    el.addEventListener("dragover", (e) => { if (!refDrag(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
    el.addEventListener("drop", onRefDrop);
    // A drawing gesture must not also count as the viewer's click (video play/pause) or
    // double-click (frame / 100%).
    el.addEventListener("click", (e) => { if (suppressClick){ suppressClick = false; e.stopImmediatePropagation(); } }, true);
    el.addEventListener("dblclick", (e) => {
      if (!S.on || e.target.closest?.(".scp")) return;
      const [x, y] = toDoc(e);
      const hit = hitAt(x, y);
      if (hit && typeOf(hit) === "text" && editable(hit)){ e.stopImmediatePropagation(); e.preventDefault(); editText(hit); return; }
      // A pin: double-click edits its number (with the pin tool a single click does).
      if (S.tool !== "pin" && !S.pinEdit && hit && typeOf(hit) === "pin" && editable(hit)){ e.stopImmediatePropagation(); e.preventDefault(); editPin(hit, false); return; }
      // A reference image: double-click crops it (again, or on the empty frame: done).
      if (S.tool === "select" && hit && typeOf(hit) === "image" && editable(hit)){
        e.stopImmediatePropagation(); e.preventDefault();
        if (cropItem()?.id === hit.id){ endCrop(); return; }
        S.sel = new Set([hit.id]);
        startCrop();
        return;
      }
      if (S.tool !== "select"){ e.stopImmediatePropagation(); e.preventDefault(); }
    }, true);
  }
  // Images / video: the viewer's wrap, media element and geometry (x0, y0, scale, natural size).
  const vidWired = new WeakSet();
  function bind2d(view){
    if (!S.light || !S.asset) return;
    const same = S.b2?.wrap === view.wrap && S.layer?.root?.isConnected && S.layer.root.parentNode === view.wrap;
    S.b2 = view;
    S.b3 = null;
    if (!same){
      S.layer?.root.remove();
      view.wrap.querySelectorAll(":scope > .an-layer").forEach((n) => n.remove());
      S.layer = null;
    }
    attachInput(view.wrap);
    if (S.on) view.wrap.classList.add("an-active");
    if (view.isVid && view.media && !vidWired.has(view.media)){
      vidWired.add(view.media);
      const v = view.media;
      v.addEventListener("loadedmetadata", () => renderMarks());
      // Watching with the mode off: playing / seeking moves the frame, the drawings follow (followOff).
      const wake = () => { if (!S.on && S.b2?.media === v && shownOff()){ S.lastSig = ""; startTick(); } };
      v.addEventListener("play", wake); v.addEventListener("seeked", wake);
      v.addEventListener("pause", wake); v.addEventListener("ended", wake);   // the frame it stopped on
      v.addEventListener("durationchange", () => renderMarks());
    }
    if (same){ syncViewBox(); if (S.on) renderSel(); startTick(); return; }
    renderAll();
    renderMarks();
    renderPanel();  // the note previews need the picture
    startTick();
  }
  // The viewer's view moved. A board keeps its drawings on show with the mode off, so its layer follows too.
  function viewChanged(){
    if (!S.layer || !(S.on || shownOff())) return;
    syncViewBox();
    if (S.on){ renderSel(); if (S.edit) S.edit.place(); if (S.pinEdit) S.pinEdit.place(); }
  }
  // 3D: host element, camera get/set, synchronous capture of the rendered frame.
  function bind3d(r){
    if (!S.light || !S.asset || S.asset.id !== r.aid) return;
    S.layer?.root.remove();
    r.host.querySelectorAll(":scope > .an-layer").forEach((n) => n.remove());
    S.b3 = r;
    S.b2 = null;
    S.layer = null;
    attachInput(r.host);
    if (S.on){ r.host.classList.add("an-active"); r.annotating?.(true); }
    renderAll();
    startTick();
  }

  // A pan captures an ancestor of the surface (compare's stage), so pointermove never reaches onMove and the
  // brush circle stayed where the drag started. Follow the pointer while it is over this host.
  function trackHover(e){
    if (!S.on || !S.light?.contains(e.target)) return;
    const el = surfaceEl();
    if (!el || el.contains(e.target)) return;
    const r = el.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom;
    if (!inside){
      if (!S.drag && S.hover){ S.hover = null; renderSel(); }
      return;
    }
    const [sx, sy] = local(e);
    if (S.hover && S.hover[0] === sx && S.hover[1] === sy) return;
    S.hover = [sx, sy];
    if (!S.drag) renderSel();
  }
  window.addEventListener("pointermove", trackHover, true);

  return {
    mount, unmount, setAsset, bind2d, bind3d, viewChanged, toggle, onKey, helpOpen: () => !!help, importFile, explodeChanged,
    isOn: () => S.on, resetPrefs,
    supports: () => supported(),
    // The open video's timeline marks: [{t, note}] (note: true for a note's frame), for a sequence's bar.
    marks: () => (S.kind === "video" ? marks().map((m) => ({ t: m.t, note: !!m.note })) : []),
    loading: () => !!S.loading, // the open asset's rows are still being fetched (its marks are not known yet)
    // For the sequence export (index.html seqExportAll): which file is bound, is it ready to be pictured, its report.
    assetId: () => S.asset?.id || null,
    busy: () => !!S.gathering,
    ready: () => !!S.asset && !S.loading && !!(S.b2 || S.b3),
    fpsKnown: () => S.kind !== "video" || !!S.fpsKnown,
    fps: () => S.fps,   // the open video's frame rate (25 until fpsKnown), for the lightbox's position field
    report: async (kind) => { await flush(); return gatherReport(kind === "html", kind === "zip"); },
    toast: (text, ms) => toast(text, ms),
    // Re-read the open file's rows (edited elsewhere); undo / redo would write the old copies back over them.
    reload: () => {
      const a = S.asset;
      if (!a || !supported()) return;
      S.undo = []; S.redo = []; paintBar();
      Promise.resolve(flush()).then(() => { if (S.asset === a){ obForget(a.id); load(a); } }); // after its own pending save lands
    },
    // For the board view (canvas.js): save pending edits, drop a half-drawn gesture, the drawings' bounds, modal state.
    flush: () => flush(), abortGesture, modal: () => !!help || !!stampPop && !stampPop.hidden,
    bounds: () => { let b = null; for (const it of S.items.values()){ if (!isDrawing(it)) continue; const x = boundsOf(it); b = b ? [Math.min(b[0], x[0]), Math.min(b[1], x[1]), Math.max(b[2], x[2]), Math.max(b[3], x[3])] : x.slice(); } return b; },
  };
}

// ---- styles -----------------------------------------------------------------------------------
let stylesInjected = false;
function injectStyles(){
  if (stylesInjected) return;
  stylesInjected = true;
  const st = document.createElement("style");
  st.textContent = `
.an-outbox { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 100000; max-width: calc(100vw - 32px);
  padding: 10px 16px; border-radius: 10px; border: 1px solid #c0392b; background: #2a1414; color: #ffd9d4; font: 13px/1.3 system-ui, sans-serif;
  cursor: pointer; box-shadow: 0 6px 24px rgba(0,0,0,.45); }
.an-outbox[hidden] { display: none; }
.an-layer { position: absolute; inset: 0; pointer-events: none; z-index: 3; isolation: isolate; }
.an-layer[hidden] { display: none; }
.an-layer > svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.an-active { touch-action: none; }
.an-ui .an-selbox { fill: none; stroke: #4c9aff; stroke-width: 1; stroke-dasharray: 3 3; }
.an-ui .an-selall { fill: none; stroke: #4c9aff; stroke-width: 1; }
.an-ui .an-handle { fill: #fff; stroke: #4c9aff; stroke-width: 1.5; }
.an-ui .an-handle.rot, .an-ui .an-handle.bend { fill: #4c9aff; stroke: #fff; }
.an-ui .an-rotline { stroke: #4c9aff; stroke-width: 1; }
.an-ui .an-marquee { fill: rgb(76 154 255 / .12); stroke: #4c9aff; stroke-width: 1; }
.an-ui .an-cursor { fill: none; stroke: #fff; stroke-width: 1; filter: drop-shadow(0 0 1px #000) drop-shadow(0 0 1px #000); }
.an-ui .an-cursor.er { stroke-dasharray: 3 2; }
.an-ui .an-regionshade { fill: rgb(0 0 0 / .45); fill-rule: evenodd; }
.an-ui .an-region { fill: none; stroke: #fff; stroke-width: 1; stroke-dasharray: 4 3; }
.an-ui .an-regionlbl { fill: #fff; font: 11px system-ui, sans-serif; paint-order: stroke; stroke: rgb(0 0 0 / .7); stroke-width: 3; }
.an-pinedit { position: absolute; z-index: 6; margin: 0; padding: 0 4px; box-sizing: border-box; border: 1px solid #4c9aff; border-radius: 8px; outline: none; background: rgb(20 20 24 / .9); color: #fff; font-weight: 700; text-align: center; font-family: system-ui, sans-serif; }
.an-pinedit::placeholder { color: rgb(255 255 255 / .55); }
.an-textedit { position: absolute; z-index: 6; margin: 0; padding: 0; border: 1px dashed #4c9aff; outline: none; resize: none; overflow: hidden; white-space: pre; min-width: 24px; box-sizing: content-box; }
.an-top { position: absolute; left: 50%; top: 58px; transform: translateX(-50%); z-index: 13; display: flex; flex-direction: column; align-items: center; gap: 6px; pointer-events: none; max-width: calc(100% - 140px); }
.an-top[hidden] { display: none; }
.an-host.an-panel-on .an-top { left: calc(50% - 160px); max-width: calc(100% - 460px); }
.an-bar, .an-props { pointer-events: auto; display: flex; align-items: center; gap: 2px; padding: 4px; border-radius: 10px; background: rgb(14 14 16 / .78); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border: 1px solid var(--border); box-shadow: 0 10px 30px rgb(0 0 0 / .35); flex-wrap: wrap; justify-content: center; }
.an-props { padding: 3px 6px; gap: 6px; font-size: 11px; color: var(--muted); min-height: 28px; box-sizing: border-box; }
.an-props[hidden] { display: none; }
.an-tool { width: 30px; height: 30px; border-radius: 7px; display: grid; place-items: center; color: var(--muted); }
.an-tool[hidden] { display: none; }
.an-tool:hover { background: var(--surface-2); color: var(--fg); }
.an-tool.on { background: var(--surface-3, #2a2b31); color: var(--accent); box-shadow: inset 0 0 0 1px var(--border-strong); }
.an-sep { width: 1px; height: 18px; background: var(--border); margin: 0 3px; flex: none; }
.an-pl { color: var(--subtle); padding: 0 4px; text-transform: capitalize; white-space: nowrap; }
.an-pc { display: inline-flex; }
.an-pc input[type=color] { width: 22px; height: 22px; padding: 0; border: 1px solid var(--border-strong); border-radius: 6px; background: none; cursor: pointer; }
.an-pc input[type=color]::-webkit-color-swatch-wrapper { padding: 0; }
.an-pc input[type=color]::-webkit-color-swatch { border: none; border-radius: 5px; }
.an-sw { display: inline-flex; gap: 3px; }
.an-sw i { width: 12px; height: 12px; border-radius: 50%; cursor: pointer; box-shadow: inset 0 0 0 1px rgb(255 255 255 / .25); }
.an-sw i:hover { transform: scale(1.25); }
.an-num { display: inline-flex; align-items: baseline; gap: 4px; padding: 3px 7px; border-radius: 6px; background: var(--surface-2); cursor: ew-resize; user-select: none; white-space: nowrap; }
.an-num:hover { background: var(--surface-3, #2a2b31); }
.an-num b { font-weight: 500; color: var(--subtle); }
.an-num em { font-style: normal; color: var(--fg); font-variant-numeric: tabular-nums; min-width: 22px; text-align: right; }
.an-numedit { width: 44px; font: inherit; color: var(--fg); background: var(--bg); border: 1px solid var(--accent); border-radius: 4px; padding: 0 3px; outline: none; }
.an-tg { height: 24px; min-width: 24px; padding: 0 7px; border-radius: 6px; color: var(--muted); background: var(--surface-2); font-size: 11px; display: inline-grid; place-items: center; }
.an-tg svg { width: 14px; height: 14px; }
.an-tg[data-cyc] svg, .an-tg[data-k] svg { width: 16px; height: 16px; }
.an-tg:hover { color: var(--fg); }
.an-tg.on { color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.an-tg.b { font-weight: 700; } .an-tg.i { font-style: italic; font-family: Georgia, serif; } .an-tg.u { text-decoration: underline; }
.an-psel { display: inline-flex; align-items: center; gap: 4px; }
.an-psel span { color: var(--subtle); }
.an-psel select { height: 24px; font-size: 11px; color: var(--fg); background: var(--surface-2); border: none; border-radius: 6px; padding: 0 4px; }
.an-seg { display: inline-flex; background: var(--surface-2); border-radius: 6px; padding: 2px; gap: 1px; }
.an-seg button { height: 20px; padding: 0 7px; border-radius: 4px; color: var(--muted); font-size: 11px; }
.an-seg button.on { background: var(--surface-3, #2a2b31); color: var(--accent); }
.an-seg.ico button { width: 24px; padding: 0; display: inline-grid; place-items: center; }
.an-seg.ico svg { width: 16px; height: 16px; }
@media (pointer: coarse) { .an-seg.ico button { width: 34px; height: 34px; } .an-seg.ico svg { width: 20px; height: 20px; } }
.an-toast { position: absolute; left: 50%; bottom: 84px; transform: translateX(-50%); z-index: 30; padding: 7px 14px; border-radius: 999px; font-size: 12px; color: var(--fg); background: rgb(10 10 11 / .82); border: 1px solid var(--border); pointer-events: none; opacity: 0; transition: opacity 160ms ease; white-space: nowrap; max-width: 80%; overflow: hidden; text-overflow: ellipsis; }
.an-toast.on { opacity: 1; }
.an-host.an-panel-on .an-toast { left: calc(50% - 160px); }
.an-flash { position: absolute; inset: 0; z-index: 29; background: #fff; opacity: 0; pointer-events: none; }
.an-flash.go { animation: an-flash .35s ease-out; }
@keyframes an-flash { 0% { opacity: .35; } 100% { opacity: 0; } }
.light.an-panel-on { padding-right: 320px; --an-right: 320px; }
.light.an-panel-on .v3d-gear, .light.an-panel-on .v3d-panel, .light.an-panel-on .frame-pop { right: 336px; }
.an-panel { position: absolute; right: 0; top: 0; bottom: 0; width: 320px; z-index: 20; display: flex; flex-direction: column; background: var(--surface, #1b1c20); border-left: 1px solid var(--border); box-sizing: border-box; font-size: 12px; color: var(--fg); }
.an-panel[hidden] { display: none; }
.an-ph { display: flex; align-items: center; gap: 6px; padding: 10px 10px 8px 14px; border-bottom: 1px solid var(--border); }
.an-ph b { font-size: 13px; font-weight: 600; }
.an-user { margin-left: auto; width: 26px; height: 26px; border-radius: 50%; border: 1px solid var(--border); font-size: 11px; font-weight: 600; display: grid; place-items: center; padding: 0; }
.an-ib { height: 26px; min-width: 26px; padding: 0 6px; border-radius: 6px; color: var(--muted); display: inline-grid; place-items: center; font-size: 11px; white-space: nowrap; }
.an-ib:hover { background: var(--surface-2); color: var(--fg); }
.an-ib.on { color: #34c759; }
.an-ph .an-ib[hidden] { display: none; }
.an-trks { display: inline-flex; align-items: center; gap: 6px; }   /* (a link ▾ per connected tracker: paintTrkBtns) */
.an-trks:empty { display: none; }
.an-ib.sm { height: 22px; min-width: 22px; padding: 0; }
.an-ib.sm svg { width: 14px; height: 14px; }
.an-menu { position: absolute; right: 40px; top: 42px; z-index: 22; display: flex; flex-direction: column; padding: 4px; min-width: 210px; border-radius: 10px; background: rgb(22 22 25 / .97); border: 1px solid var(--border); box-shadow: 0 20px 50px rgb(0 0 0 / .5); }
.an-chev { width: 24px; margin-left: -4px; font-size: 10px; }
.an-stamp { position: absolute; z-index: 4; box-sizing: border-box; text-align: center; white-space: nowrap; overflow: hidden; pointer-events: auto; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; }
.an-stamp[hidden] { display: none; }
.an-stamp:active { cursor: grabbing; }
.an-stampop { position: absolute; z-index: 22; display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; width: 280px; max-width: calc(100% - 16px); box-sizing: border-box; border-radius: 10px; background: rgb(22 22 25 / .97); border: 1px solid var(--border); box-shadow: 0 20px 50px rgb(0 0 0 / .5); color: var(--fg); font-size: 11px; }
.an-stampop[hidden] { display: none; }
.an-spr { display: flex; align-items: center; gap: 8px; }
.an-spr > span:first-child, .an-spr > b { min-width: 50px; color: var(--muted); }
.an-spr > b { color: var(--fg); flex: 1; }
.an-spr input[type=range] { flex: 1; min-width: 0; accent-color: var(--accent); }
.an-spr em { font-style: normal; min-width: 34px; text-align: right; color: var(--muted); }
.an-spos { display: inline-grid; grid-template-columns: repeat(3, 26px); gap: 2px; flex: 1; }
.an-spos button { height: 22px; border-radius: 4px; background: var(--surface-2); color: var(--muted); }
.an-spos button.on { background: var(--surface-3, #2a2b31); color: var(--accent); box-shadow: inset 0 0 0 1px var(--border-strong); }
.an-menu[hidden] { display: none; }
.an-trk { width: 280px; gap: 4px; }
.an-trk select, .an-trk input { width: 100%; padding: 6px 8px; border-radius: 6px; background: rgb(255 255 255 / .06); color: var(--fg); border: 1px solid var(--border); font-size: 12px; }
.an-trklist { display: flex; flex-direction: column; max-height: 240px; overflow: auto; }
.an-trklist small { opacity: .6; margin-left: 4px; }
.an-trkmsg { padding: 6px 10px; font-size: 12px; opacity: .85; }
.an-trkerr { color: #ff8a80; }
.an-menu button { text-align: left; padding: 7px 10px; border-radius: 6px; color: var(--fg); font-size: 12px; }
.an-menu button:hover { background: var(--surface-2); }
.an-mlbl { padding: 4px 10px 2px; font-size: 10.5px; color: var(--muted); }
.an-mseq[hidden], .an-mbg[hidden] { display: none; }
.an-mbgrow { display: flex; align-items: center; gap: 8px; padding: 2px 10px 6px; }
.an-mbgrow .an-seg button { text-align: center; padding: 0 9px; height: 26px; }
.an-xbgc { width: 34px; height: 26px; padding: 0; border: 1px solid var(--border); border-radius: 6px; background: none; }
.an-menu hr { border: none; border-top: 1px solid var(--border); margin: 4px 2px; }
.an-rs { display: flex; align-items: center; gap: 8px; padding: 8px 14px 0; color: var(--subtle); font-size: 11px; }
.an-rs .an-seg { flex: 1; display: flex; }
.an-rs .an-seg button { flex: 1; padding: 0 4px; white-space: nowrap; }
.an-rsh { padding: 4px 14px 0 50px; color: var(--subtle); font-size: 10px; line-height: 1.5; }
.an-rsh-more { border: 0; background: none; color: var(--accent, #4c9aff); font: inherit; padding: 0; cursor: pointer; }
.an-rs [data-rs=review].on { color: #ff9f0a; } .an-rs [data-rs=changes].on { color: #ff453a; } .an-rs [data-rs=approved].on { color: #34c759; }
.an-vers { padding: 6px 14px 0; display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--subtle); }
.an-vers[hidden] { display: none; }
.an-vrow { display: flex; align-items: center; gap: 4px; }
.an-vrow > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-vrow b { color: var(--fg); font-weight: 600; }
.an-vrow .an-ib[disabled] { opacity: .35; pointer-events: none; }
.an-vrow.carry { padding: 5px 4px 5px 8px; border-radius: 8px; background: rgb(255 159 10 / .12); color: var(--fg); }
.an-views { display: flex; align-items: center; gap: 4px; padding: 0 0 6px; flex-wrap: wrap; color: var(--subtle); font-size: 11px; }
.an-vchip.new { display: inline-grid; place-items: center; opacity: .55; box-shadow: inset 0 0 0 1px var(--border); border-style: dashed; }
.an-views[hidden] { display: none; }
.an-views > span:first-child { margin-right: 4px; }
.an-vchip { min-width: 24px; height: 22px; border-radius: 6px; background: var(--surface-2); color: var(--muted); font-size: 11px; }
.an-vchip.on { color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.an-filt { display: flex; margin: 8px 14px 0; }
.an-filt[hidden] { display: none; }
.an-filt button { flex: 1; padding: 0 4px; white-space: nowrap; display: inline-flex; align-items: center; justify-content: center; gap: 4px; }
.an-fc { font-style: normal; min-width: 15px; height: 15px; padding: 0 4px; border-radius: 8px; background: var(--muted); color: #fff; font-size: 9.5px; font-weight: 700; line-height: 15px; }
.an-fc.open { background: #ff453a; } .an-fc.progress { background: #ff9f0a; } .an-fc.done { background: #34c759; } .an-fc.zero { opacity: .4; }
.an-nprev { position: relative; width: 100%; margin: 6px 0 2px; border-radius: 6px; overflow: hidden; background: #000; }
.an-nprev.sm { margin-top: 4px; }
.an-nprev[data-pt] { display: inline-block; width: calc(50% - 3px); margin-right: 6px; vertical-align: top; cursor: pointer; }
.an-nprev[data-vk], .an-nprev[data-bv] { cursor: pointer; }
.an-nprev.an-bprev { background: var(--canvas-bg, #1b1c20); background-image: radial-gradient(rgb(255 255 255 / .09) 1px, transparent 1px); background-size: 12px 12px; }
.an-nprev img, .an-nprev svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.an-nprev .an-fno { position: absolute; left: 3px; top: 3px; z-index: 1; padding: 0 4px; border-radius: 4px; background: rgb(0 0 0 / .6); color: #fff; font: 600 10px/15px system-ui, sans-serif; font-variant-numeric: tabular-nums; pointer-events: none; }
.an-list { flex: 1; min-height: 0; overflow: auto; padding: 8px 8px 12px; display: flex; flex-direction: column; gap: 6px; }
.an-offer { position: fixed; left: 50%; top: 56px; transform: translateX(-50%); width: max-content; z-index: 130; display: flex; align-items: center; gap: 10px; box-sizing: border-box; max-width: calc(100% - 32px); padding: 8px 8px 8px 14px; border-radius: 12px; font-size: 13px; color: var(--fg); background: rgb(10 10 11 / .92); border: 1px solid var(--border); box-shadow: 0 6px 24px rgb(0 0 0 / .45); }
.an-offer span { flex: 1 1 auto; min-width: 0; }
.an-offer button { flex: none; display: inline-grid; place-items: center; min-height: 32px; border-radius: 8px; color: var(--fg); background: var(--surface-2); border: 1px solid var(--border); cursor: pointer; }
.an-offer .an-offer-go { padding: 0 14px; color: var(--accent); }
.an-offer .an-offer-x { width: 32px; padding: 0; color: var(--muted); }
.an-help { position: absolute; inset: 0; z-index: 60; display: grid; place-items: center; padding: 16px; box-sizing: border-box; background: rgb(0 0 0 / .62); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); cursor: default; touch-action: none; }
.an-hcard { width: min(640px, 100%); max-height: 100%; display: flex; flex-direction: column; border-radius: 12px; background: var(--surface, #1b1c20); border: 1px solid var(--border-strong, var(--border)); box-shadow: 0 24px 70px rgb(0 0 0 / .6); color: var(--fg); font-size: 12px; overflow: hidden; }
.an-hh { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px 8px 16px; border-bottom: 1px solid var(--border); }
.an-hh b { font-size: 14px; font-weight: 600; }
.an-hbody { overflow: auto; overscroll-behavior: contain; touch-action: pan-y; padding: 4px 16px 8px; display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); column-gap: 24px; }
.an-hbody h4 { margin: 12px 0 4px; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--subtle); }
.an-hrow { display: flex; gap: 10px; align-items: baseline; padding: 3px 0; line-height: 1.4; }
.an-hk { flex: 0 0 auto; min-width: 84px; display: inline-flex; flex-wrap: wrap; gap: 3px; }
.an-hk kbd { font: 11px/1 ui-monospace, Consolas, monospace; padding: 3px 6px; border-radius: 5px; background: var(--surface-2); border: 1px solid var(--border); color: var(--fg); }
.an-hfoot { margin: 0; padding: 8px 16px 12px; color: var(--subtle); border-top: 1px solid var(--border); }
.an-hint { color: var(--subtle); padding: 10px 8px; line-height: 1.5; }
.an-hint p { margin: 0 0 8px; }
.an-note { padding: 8px 10px; border-radius: 10px; background: var(--surface-2); border: 1px solid transparent; cursor: pointer; }
.an-note:hover { border-color: var(--border-strong); }
.an-note.on { border-color: var(--accent); }
/* A note's action icons show on hover only; on a touch screen (no hover) on the picked (tapped) note. */
.an-nh .an-ib { visibility: hidden; }
.an-note:hover .an-nh .an-ib, .an-note.on .an-nh .an-ib, .an-nh .an-ib:focus-visible { visibility: visible; }
@media (hover: none) { .an-note:hover:not(.on) .an-nh .an-ib { visibility: hidden; } }
.an-note.done { opacity: .6; }
.an-note.done .an-nt { text-decoration: line-through; text-decoration-color: rgb(255 255 255 / .35); }
.an-nh { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.an-nn { flex: none; min-width: 18px; height: 18px; padding: 0 4px; box-sizing: border-box; border-radius: 9px; background: #d0342c; color: #fff; font-size: 10px; font-weight: 700; display: grid; place-items: center; }
.an-note.done .an-nn { background: #2f9d5b; }
.an-note.prog .an-nn { background: #e08a00; }
.an-nctx { display: inline-flex; align-items: center; gap: 3px; height: 18px; padding: 0 6px; border-radius: 5px; background: var(--surface-3, #2a2b31); color: var(--accent); font-size: 10px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.an-nctx svg { width: 12px; height: 12px; }
.an-nwho { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--subtle); font-size: 10px; }
.an-nt { white-space: pre-wrap; word-break: break-word; line-height: 1.45; user-select: text; }
.an-empty { color: var(--subtle); }
.an-shots { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; }
.an-pics { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(var(--an-thumb, 62px), 100%), 1fr)); gap: 4px; margin: 6px 0 2px; }
.an-pics > .an-nprev, .an-pics > .an-nprev[data-pt] { aspect-ratio: 1 / 1 !important; display: block; width: 100%; margin: 0; border-radius: 5px; }
.an-pics > .an-nprev img { object-fit: cover; }
.an-pics > img { display: block; width: 100%; height: auto; aspect-ratio: 1 / 1; object-fit: cover; border-radius: 5px; border: 1px solid var(--border); cursor: zoom-in; }
.an-shots img { height: 54px; max-width: 100%; border-radius: 5px; object-fit: cover; border: 1px solid var(--border); cursor: zoom-in; }
.an-nmeta { margin-top: 4px; color: var(--subtle); font-size: 10px; }
.an-replies { margin-top: 6px; padding-left: 8px; border-left: 2px solid var(--border-strong); display: flex; flex-direction: column; gap: 5px; }
.an-rep { cursor: default; }
.an-rh { display: flex; align-items: center; gap: 4px; color: var(--subtle); font-size: 10px; }
.an-rh span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.an-rh .an-ib { visibility: hidden; height: 16px; min-width: 16px; }
.an-rep:hover .an-rh .an-ib, .an-note.on .an-rh .an-ib, .an-rh .an-ib:focus-visible { visibility: visible; }
.an-rdraw { flex: none; display: inline-flex; align-items: center; gap: 2px; height: 16px; padding: 0 5px 0 3px; border: 0; border-radius: 8px; background: none; color: var(--subtle); font: inherit; font-size: 10px; cursor: pointer; }
.an-rdraw svg { width: 12px; height: 12px; }
.an-rdraw:hover { color: var(--fg); background: rgb(127 127 127 / .18); }
.an-rdraw.off { opacity: .55; }
.an-rev { color: var(--subtle); font-size: 10px; }
.an-rev.done { color: var(--ok, #2f9d5b); }
.an-rev.prog { color: #e0a030; }
.an-rt { white-space: pre-wrap; word-break: break-word; line-height: 1.4; user-select: text; }
.an-redit { margin-top: 6px; min-height: 30px; }
.an-compose { border-top: 1px solid var(--border); padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 6px; }
.an-panel.an-read .an-compose { display: none; }
.an-pend { display: flex; gap: 4px; flex-wrap: wrap; }
.an-pend[hidden] { display: none; }
.an-pshot { position: relative; }
.an-pshot img { height: 46px; border-radius: 5px; border: 1px solid var(--border); display: block; cursor: zoom-in; }
.an-pshot button { position: absolute; right: -5px; top: -5px; width: 16px; height: 16px; border-radius: 50%; background: #000; color: #fff; font-size: 11px; line-height: 1; border: 1px solid var(--border-strong); }
.an-input { width: 100%; box-sizing: border-box; resize: none; font: 12px/1.45 var(--font, system-ui); color: var(--fg); background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 7px 9px; outline: none; min-height: 40px; }
.an-input:focus { border-color: var(--border-strong); }
.an-nedit { margin: 2px 0; }
.an-crow { display: flex; align-items: center; gap: 4px; }
.an-ctx { flex: 1; min-width: 0; color: var(--subtle); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
.an-add { height: 28px; padding: 0 14px; }
.an-shotview { position: absolute; inset: 0; z-index: 40; display: grid; place-items: center; background: rgb(0 0 0 / .82); cursor: zoom-out; }
.an-cin { margin-top: 4px; font-size: 12.5px; }
/* The text plate over the picture (caption-plate.js): clear of the zoom chip at the foot and of the
   tool bar at the top. */
.scp { --scp-b: 30px; --scp-t: 140px; }
.an-caps { margin: 4px 0 2px; display: flex; flex-direction: column; gap: 3px; }
.an-cap { font-size: 12.5px; line-height: 1.4; white-space: pre-wrap; word-break: break-word; padding: 3px 7px; border-radius: 5px; background: rgb(255 255 255 / .05); border-left: 2px solid rgb(255 255 255 / .25); cursor: pointer; user-select: text; }
.an-cap b { font-weight: 600; opacity: .7; margin-right: 6px; font-variant-numeric: tabular-nums; }
.an-nprev.an-hascap::after { content: ""; position: absolute; right: 3px; bottom: 3px; width: 15px; height: 15px; border-radius: 4px; background: rgb(0 0 0 / .65) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2.6' stroke-linecap='round'%3E%3Cpath d='M5 7h14M5 12h14M5 17h9'/%3E%3C/svg%3E") center / 11px no-repeat; pointer-events: none; }
.an-pics > img.an-hascap, .an-pics > .an-shotw.an-hascap { outline: 2px solid rgb(255 255 255 / .55); outline-offset: -2px; }
/* A screenshot (a captured picture) among the note's drawing previews: a camera corner badge and a dashed edge. */
.an-pics > .an-shotw { position: relative; display: block; aspect-ratio: 1 / 1; border-radius: 5px; overflow: hidden; border: 1px dashed rgb(255 255 255 / .35); cursor: zoom-in; }
.an-shotw img { display: block; width: 100%; height: 100%; object-fit: cover; }
.an-shotw::before { content: ""; position: absolute; left: 3px; top: 3px; width: 15px; height: 15px; border-radius: 4px; background: rgb(0 0 0 / .65) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2.2' stroke-linejoin='round'%3E%3Cpath d='M4 8h3l2-3h6l2 3h3v11H4z'/%3E%3Ccircle cx='12' cy='13' r='3.2'/%3E%3C/svg%3E") center / 11px no-repeat; pointer-events: none; }
.an-shotw.an-hascap::after { content: ""; position: absolute; right: 3px; bottom: 3px; width: 15px; height: 15px; border-radius: 4px; background: rgb(0 0 0 / .65) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2.6' stroke-linecap='round'%3E%3Cpath d='M5 7h14M5 12h14M5 17h9'/%3E%3C/svg%3E") center / 11px no-repeat; pointer-events: none; }
.an-shotview img { max-width: 92%; max-height: 92%; border-radius: 6px; box-shadow: 0 20px 60px rgb(0 0 0 / .6); }
.vtrack .an-marks { position: absolute; inset: 0; pointer-events: none; }
.an-mk { position: absolute; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%; background: #ffd60a; box-shadow: 0 0 0 1px rgb(0 0 0 / .5); pointer-events: auto; cursor: pointer; }
.an-mk.note { width: 10px; height: 10px; margin: -5px 0 0 -5px; background: #ff453a; box-shadow: 0 0 0 1.5px #fff; }
.an-mk.note.done { background: #34c759; }
.an-mk.note.prog { background: #ff9f0a; }
.an-mk:hover { transform: scale(1.35); }
.an-cmpb { border: 1px solid var(--border-strong, #444); background: transparent; color: inherit; border-radius: 6px; padding: 2px 8px; font: inherit; cursor: pointer; }
.an-cmpb:hover { border-color: var(--accent); }
.cmp.an-panel-on { padding-right: 320px; --an-right: 320px; }
.cmp-annb.on { color: var(--accent); }
.light-bar .an-btn { position: relative; }
.light-bar .an-btn.on { color: var(--accent); }
.an-badge { position: absolute; right: 2px; top: 2px; min-width: 14px; height: 14px; padding: 0 3px; box-sizing: border-box; border-radius: 7px; background: #d0342c; color: #fff; font-size: 9px; font-weight: 700; line-height: 14px; text-align: center; }
.an-badge[hidden] { display: none; }
.an-host.an-regioning .an-top { opacity: .3; pointer-events: none; }
/* Alt held over a drawing tool (altCam): the bar and the notes panel do not take the pointer. */
.an-host.an-alt .an-top, .an-host.an-alt .an-panel { opacity: .5; }
.an-host.an-alt .an-panel, .an-host.an-alt .an-top *, .an-host.an-alt .an-panel * { pointer-events: none !important; }
/* Board mode (the Canvas view hosts the annotator): the bar sits at the top of the view, the panel overlays its
   right edge, and what needs a picture is not offered. */
.an-host.an-bhost { --an-pw: min(320px, 62%); }
.an-host.an-bhost .an-top { top: 54px; max-width: calc(100% - 100px); }
.an-host.an-bhost.an-panel-on .an-top { left: calc((100% - var(--an-pw)) / 2); max-width: calc(100% - var(--an-pw) - 24px); }
.an-host.an-bhost.an-panel-on .an-toast { left: calc((100% - var(--an-pw)) / 2); }
.an-host.an-bhost .an-panel { width: var(--an-pw); }
.an-host.an-bhost .an-bar, .an-host.an-bhost .an-props { flex-wrap: wrap; justify-content: center; }
.an-panel.an-board .an-rs, .an-panel.an-board .an-rsh, .an-panel.an-board .an-vers, .an-panel.an-board .an-cin,
.an-panel.an-board .an-crow [data-act=shot], .an-panel.an-board .an-crow [data-act=region] { display: none; }
`;
  document.head.appendChild(st);
}
