// The viewer interface (docs/PLAN-coreline.md decision 8, R0b): one module per media kind, shared by Sight's
// lightbox and an embedding page (Coreline's review screen). A frame picks the module by kind (viewerFor), mounts it
// into a stage element, and hands the viewer it gets back to the annotator (annotate.js bind(viewer)).
//
// A mounted viewer is a plain object:
//   kind        "image" | "video" (R0c adds "model3d")
//   asset       the asset it shows ({ id, kind, width, height, … })
//   surface     the element drawings go over (annotate.js puts its layer and its listeners on it)
//   media       the <img> / <video> that shows the picture
//   docBox()    { w, h }: the doc box in doc units (FORMAT.md: pixels of the media at native size). Sight takes the
//               decoded element's size (as before R0b); a host that shows a scaled rendition passes the native size
//               as opts.docSize and the rendition is scaled into it.
//   geom()      { x0, y0, s, w, h, turn }: where the doc box sits in the surface (px), its scale, and the CSS
//               transform of the view's turn / mirror (applied in front of the translate + scale)
//   unturn(x,y) surface px → the same point before the turn / mirror (the exact inverse of geom().turn)
//   place()     where the view is now (FORMAT.md ctx): a video { t } (seconds), a picture {}
//   goTo(p)     go to a place (a video seeks to p.t, paused)
//   capture(w)  a canvas of the current view's picture, at most w px wide (note previews, shots)
//   fit(), zoom(n)  frame the picture / n × native size
//   transport   video only: { seek(t), begin(), end() } (a scrub: begin, seek…, end); null for a picture
//   destroy()   drop its window listeners (the stage's content is replaced by the next mount)
//
// mount(stage, asset, src, opts, host): opts.embedded (a picture that is not the frame's own asset: no claim on the
// frame, no annotator), opts.adopt (a video element that takes the new element's place: a sequence's preloaded clip),
// opts.docSize. host: the frame's hooks (see view2d.js).

export const VIEWER_KINDS = ["image", "video"];

// The viewer module for an asset, or null when no viewer module shows it (the frame draws it itself).
// A PSD shows its composite as a picture.
export function viewerFor(a){
  if (!a) return null;
  if (a.kind === "video") return "video";
  if (a.kind === "image" || a.ext === ".psd") return "image";
  return null;
}
