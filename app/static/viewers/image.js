// The image viewer (viewers/viewer.js has the interface): a still picture (also a PSD's composite) on the 2D core,
// view2d.js — its thumbnail placeholder, the fade-in once decoded, zoom / pan / fit, the view's turn / mirror.
import { mount2d } from "./view2d.js";

export function mountImage(stage, a, src, opts, host){
  return mount2d(stage, a, src, opts || {}, host, null);
}
