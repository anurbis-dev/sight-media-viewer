// The picked media file: what it is, its identity (FORMAT.md "Asset identity"), its size, and
// pictures taken from it (scaled copies, video frames).

import { videoFps } from "./mp4.js";

export const IMAGE_EXT = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif", ".avif", ".bmp", ".tif", ".tiff"];
export const VIDEO_EXT = [".mp4", ".mov", ".m4v", ".webm", ".mkv", ".3gp", ".avi"];
export const REVIEW_EXT = [".srev", ".sightreview"];

export const extOf = (name) => { const m = /\.[^.\\/]+$/.exec(name || ""); return m ? m[0].toLowerCase() : ""; };
export function kindOf(file){
  const t = (file.type || "").toLowerCase(), e = extOf(file.name);
  if (REVIEW_EXT.includes(e)) return "review";
  if (t.startsWith("image/") || IMAGE_EXT.includes(e)) return "image";
  if (t.startsWith("video/") || VIDEO_EXT.includes(e)) return "video";
  if (t === "application/json" || e === ".json") return "review";
  return null;
}

// 16 hex chars of SHA-1 (FORMAT.md id shape). crypto.subtle only exists on https / localhost;
// elsewhere (a file:// test) a 64-bit FNV-1a stands in — ids only need to be stable.
export async function hex16(bytes){
  if (globalThis.crypto && crypto.subtle){
    const h = new Uint8Array(await crypto.subtle.digest("SHA-1", bytes));
    return Array.from(h.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  let a = 0x811c9dc5, b = 0xcbf29ce4;
  for (const x of bytes){ a = Math.imul(a ^ x, 0x01000193) >>> 0; b = Math.imul(b ^ x ^ (a >>> 7), 0x01000193) >>> 0; }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
// The review a file belongs to, made on the device: name + size, so the same file picked again
// (iOS gives no lasting file handle) finds its review, and Sight matches a .srev from the app by
// the same name + size. mtime is deliberately left out: iOS reports the time of picking for
// files from Photos, so it changes on every pick.
export const assetKey = (name, size) => hex16(new TextEncoder().encode(String(name || "").toLowerCase() + "\n" + (size | 0)));

function once(el, ok, bad, ms){
  return new Promise((res, rej) => {
    const t = setTimeout(() => { clean(); rej(new Error("timeout")); }, ms || 15000);
    const y = () => { clean(); res(); }, n = () => { clean(); rej(new Error("cannot open")); };
    function clean(){ clearTimeout(t); el.removeEventListener(ok, y); el.removeEventListener(bad, n); }
    el.addEventListener(ok, y); el.addEventListener(bad, n);
  });
}

export async function probeImage(url){
  const im = new Image();
  im.decoding = "async";
  const p = once(im, "load", "error");
  im.src = url;
  await p;
  if (!im.naturalWidth) throw new Error("cannot open");
  return { w: im.naturalWidth, h: im.naturalHeight, img: im };
}

export async function probeVideo(url, blob){
  const v = document.createElement("video");
  v.muted = true; v.playsInline = true; v.preload = "metadata";
  const p = once(v, "loadedmetadata", "error");
  v.src = url;
  await p;
  const out = { w: v.videoWidth || 0, h: v.videoHeight || 0, duration: Number.isFinite(v.duration) ? v.duration : 0 };
  v.removeAttribute("src"); v.load();
  const f = blob ? await videoFps(blob) : null;
  out.fps = f ? f.fps : null;
  return out;
}

export function canvasBlob(c, type = "image/jpeg", q = 0.86){
  return new Promise((ok, no) => c.toBlob((b) => b ? ok(b) : no(new Error("canvas")), type, q));
}
// Frees a canvas' memory now (iOS caps the total canvas memory of a page).
export function dropCanvas(c){ c.width = 0; c.height = 0; }

// A decoded picture for drawing on a canvas: ImageBitmap where there is one, else an <img>.
export async function decode(blobOrUrl){
  if (typeof blobOrUrl !== "string" && globalThis.createImageBitmap){
    try { return await createImageBitmap(blobOrUrl); } catch { /* HEIC etc.: fall back to <img> */ }
  }
  const url = typeof blobOrUrl === "string" ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  try { return (await probeImage(url)).img; }
  finally { if (typeof blobOrUrl !== "string") setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
const sizeOf = (im) => [im.naturalWidth || im.videoWidth || im.width, im.naturalHeight || im.videoHeight || im.height];

// A JPEG copy of a picture / video frame no larger than `max` px on its long side.
export async function scaled(src, max = 1600, q = 0.86){
  const [w, h] = sizeOf(src);
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, 0, 0, c.width, c.height);
  const blob = await canvasBlob(c, "image/jpeg", q), out = { blob, w: c.width, h: c.height };
  dropCanvas(c);
  return out;
}

// A second, hidden <video> on the same file for taking frames (card pictures, drawing on a note's
// frame, reports) without moving the player. One seek at a time.
export class Grabber {
  constructor(url){ this.url = url; this.v = null; this.q = Promise.resolve(); }
  async ready(){
    if (this.v) return this.v;
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.setAttribute("playsinline", "");
    v.style.cssText = "position:fixed;left:-10px;top:-10px;width:2px;height:2px;opacity:0;pointer-events:none";
    document.body.appendChild(v);
    const p = once(v, "loadeddata", "error", 20000);
    v.src = this.url;
    try { await p; }
    catch (e){
      // iOS may not load a video that has not played: a muted inline play starts it.
      try { await v.play(); v.pause(); } catch { throw e; }
    }
    this.v = v;
    return v;
  }
  grab(t, max = 1600){
    const job = this.q.then(async () => {
      const v = await this.ready();
      await seek(v, t);
      return scaled(v, max);
    });
    this.q = job.catch(() => {});
    return job;
  }
  close(){ if (this.v){ this.v.removeAttribute("src"); this.v.load(); this.v.remove(); this.v = null; } }
}

export function seek(v, t){
  return new Promise((res) => {
    const target = Math.max(0, Math.min(t, (v.duration || t) - 1e-3));
    if (Math.abs(v.currentTime - target) < 1e-4 && v.readyState >= 2){ res(); return; }
    let done = false;
    const fin = () => { if (done) return; done = true; v.removeEventListener("seeked", fin); setTimeout(res, 30); };
    v.addEventListener("seeked", fin);
    v.currentTime = target;
    setTimeout(fin, 4000);
  });
}

// Sight's time label: m:ss.ff (frames), h:mm:ss.ff past an hour.
export function fmtTime(t, fps){
  if (!Number.isFinite(t)) return "";
  const f = Math.round((t % 1) * (fps || 25));
  const s = Math.floor(t) % 60, m = Math.floor(t / 60) % 60, h = Math.floor(t / 3600);
  const p = (n) => String(n).padStart(2, "0");
  return (h ? h + ":" + p(m) : m) + ":" + p(s) + "." + p(Math.min(f, Math.round(fps || 25) - 1));
}
export function fmtBytes(n){
  if (!(n > 0)) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1){ n /= 1024; i++; }
  return (i ? n.toFixed(n < 10 ? 1 : 0) : n) + " " + u[i];
}
