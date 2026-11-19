// The picked media file: what it is, its identity (FORMAT.md "Asset identity"), its size, and
// pictures taken from it (scaled copies, video frames).

import { videoFps } from "./mp4.js";

export const IMAGE_EXT = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif", ".avif", ".bmp", ".tif", ".tiff"];
export const VIDEO_EXT = [".mp4", ".mov", ".m4v", ".webm", ".mkv", ".3gp", ".avi"];
export const REVIEW_EXT = [".srev", ".sightreview"];
// 3D (model3d.js createViewer): the formats Sight's lightbox opens — meshes, and Gaussian splats (a .ply is
// either: its header says which).
export const MODEL_EXT = [".glb", ".gltf", ".fbx", ".obj", ".stl", ".ply", ".usdz", ".usd", ".usda", ".usdc", ".splat", ".spz", ".ksplat", ".sog"];

export const extOf = (name) => { const m = /\.[^.\\/]+$/.exec(name || ""); return m ? m[0].toLowerCase() : ""; };
export function kindOf(file){
  const t = (file.type || "").toLowerCase(), e = extOf(file.name);
  if (REVIEW_EXT.includes(e)) return "review";
  if (t.startsWith("image/") || IMAGE_EXT.includes(e)) return "image";
  if (t.startsWith("video/") || VIDEO_EXT.includes(e)) return "video";
  if (MODEL_EXT.includes(e) || t === "model/gltf-binary" || t === "model/gltf+json") return "model3d";
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

// The scrub cache: small JPEG frames around the playhead, kept in memory while the review is open, so
// a scrub or a frame step on the phone shows the frame at once (like Sight's RAM cache) while the
// player is still decoding its seek. The host says which parts of the clip it wants (`want`: ranges,
// each filled outwards from its `from` point — forward first, then backward, a backward second
// counting AHEAD / (1 − AHEAD) forward ones, so both ends of the window fill together); frames that fall out of every range
// are dropped. A hidden player plays through each missing part muted (faster than real time) and
// keeps every frame it presents (requestVideoFrameCallback), by the frame's own media time — not on
// a grid of a guessed frame rate (a WebM's rate is unknown until played). Short holes it skipped
// (a busy device) are sought one frame at a time. near(t): the closest frame; exact(t, fd, n): frame n
// or nothing; span(t): the cached run around t.
// Several caches (the open clip, its neighbours in a sequence) take turns on the decoder, the lowest
// `prio` first; an idle cache gives its hidden player back.
const turnQ = new Set();
let turnOwner = null;
function turnPick(){
  if (turnOwner) return;
  let best = null;
  turnQ.forEach((c) => { if (!best || c.prio < best.prio) best = c; });
  if (best){ turnQ.delete(best); turnOwner = best; best._turn(); }
}
const turnTake = (c) => new Promise((ok) => { c._turn = ok; turnQ.add(c); turnPick(); });
function turnGive(c){ turnQ.delete(c); if (turnOwner === c) turnOwner = null; turnPick(); }
const turnWanted = (c) => { for (const o of turnQ) if (o.prio < c.prio) return true; return false; };

export class ScrubCache {
  static MAX = 1500;     // frames in all the ranges of one window (≈ 50 MB of 640 px JPEGs)
  static AHEAD = 0.7;    // share of the window in front of the playhead (the app's Settings: 50-90 %)
  static CHUNK = 2;      // seconds played per turn
  // url: the clip (revoked by close when `own`); fps: a number or a function (the host's estimate).
  constructor(url, duration, fps, onProgress, opts){
    this.url = url; this.own = !!(opts && opts.own); this.prio = (opts && opts.prio) || 0;
    this.d = duration || 0; this.fps = fps; this.onProgress = onProgress || null;
    this.mts = [];             // media times of the frames taken, sorted
    this.urls = new Map();     // ms of the media time → blob URL (null while it is being encoded)
    this.ranges = []; this.spec = null; this.gen = 0; this.dead = new Map();
    this.v = null; this.c = null; this.closed = false; this.broken = false; this.running = false;
    this.wake = null; this.idleT = 0; this.progT = 0; this.retryT = 0;
  }
  fd(){ const f = typeof this.fps === "function" ? this.fps() : this.fps; return 1 / (f > 0 ? f : 30); }
  // Seconds a full window holds.
  winLen(){ return ScrubCache.MAX * this.fd(); }
  // The usual step between kept frames: their median gap (a frame), the guessed frame length until then.
  step(){
    const m = this.mts, n = Math.min(m.length, 400);
    if (n < 10) return this.fd();
    const g = [];
    for (let i = 1; i < n; i++) g.push(m[i] - m[i - 1]);
    g.sort((a, b) => a - b);
    return Math.max(1e-3, g[g.length >> 1]);
  }
  // spec: [{lo, hi, from, end}] in seconds (end: counted back from the clip's end, lo / hi / from ≤ 0).
  // Small moves are ignored (no re-plan while a clip plays on): a range edge or `from` must move by
  // more than 0.5 s or 5 % of the window.
  want(spec){
    if (this.closed) return;
    const tol = Math.max(0.5, this.winLen() * 0.05), old = this.spec;
    const same = old && old.length === spec.length && spec.every((r, i) => { const o = old[i]; return !!o.end === !!r.end && Math.abs(o.lo - r.lo) <= tol && Math.abs(o.hi - r.hi) <= tol && Math.abs(o.from - r.from) <= tol; });
    if (same) return;
    this.spec = spec.map((r) => ({ lo: r.lo, hi: r.hi, from: r.from, end: !!r.end }));
    this.resolve();
  }
  resolve(){
    const d = this.d;
    this.gen++; this.dead.clear();
    this.ranges = !this.spec ? [] : this.spec.map((r) => {
      const b = r.end ? d : 0;
      if (r.end && !d) return null;  // the clip's length is learnt when its player opens
      const lo = Math.max(0, b + r.lo), hi = d ? Math.min(d, b + r.hi) : b + r.hi;
      return hi > lo ? { lo, hi, from: Math.max(lo, Math.min(hi, b + r.from)) } : null;
    }).filter(Boolean);
    this.evict();
    if (this.spec && this.spec.some((r) => r.end) && !d) this.ranges.push({ meta: true });
    if (this.wake){ const w = this.wake; this.wake = null; w(); }
    else this.run();
  }
  evict(){
    const m = this.mts, fd = this.fd(), keep = [];
    if (!this.ranges.length && !m.length) return;
    for (const t of m){
      if (this.ranges.some((r) => !r.meta && t >= r.lo - fd && t <= r.hi + fd)) keep.push(t);
      else { const k = Math.round(t * 1000), u = this.urls.get(k); if (typeof u === "string") URL.revokeObjectURL(u); this.urls.delete(k); }
    }
    if (keep.length !== m.length){ this.mts = keep; this.report(); }
  }
  // The next part to fetch: [a, b], nearest a range's `from` first (behind it weighted, see above), or null.
  next(){
    if (!this.d && this.ranges.length) return { meta: true };
    const st = this.step(), tol = st * 1.6, m = this.mts, CH = ScrubCache.CHUNK;
    const wb = ScrubCache.AHEAD / Math.max(0.05, 1 - ScrubCache.AHEAD);  // a second behind costs this many ahead
    let best = null;
    const offer = (a, b, pr) => {
      const dd = this.dead.get(Math.round(a * 1000));
      if (b - a <= st * 0.5 || (dd && performance.now() < dd.until)) return;
      if (!best || pr < best.pr) best = { a, b, pr };
    };
    const hole = (a, b, from) => {
      // A short hole is fetched whole (sought frame by frame): split at `from`, a one-frame hole would give two
      // halves too short to seek into, and neither would ever be filled.
      if (b - a <= st * 6){ offer(a, b, b <= from ? (from - b) * wb : a >= from ? a - from : 0); return; }
      if (b <= from) offer(Math.max(a, b - CH), b, (from - b) * wb);
      else if (a >= from) offer(a, Math.min(b, a + CH), a - from);
      else { offer(from, Math.min(b, from + CH), 0); offer(Math.max(a, from - CH), from, 0.001); }
    };
    for (const r of this.ranges){
      if (r.meta) continue;
      let i = this.at(r.lo), prev = null;
      if (i > 0 && r.lo - m[i - 1] < tol) prev = m[i - 1];
      if (prev == null){
        if (i >= m.length || m[i] > r.hi){ hole(r.lo, r.hi, r.from); continue; }
        if (m[i] - r.lo > tol) hole(r.lo, m[i], r.from);
        prev = m[i]; i++;
      }
      for (; i < m.length && m[i] <= r.hi; i++){
        if (m[i] - prev > tol) hole(prev, m[i], r.from);
        prev = m[i];
      }
      if (r.hi - prev > tol) hole(prev, r.hi, r.from);
    }
    return best;
  }
  async run(){
    if (this.running || this.closed || this.broken) return;
    this.running = true;
    try {
      while (!this.closed && !this.broken){
        if (!this.next()){
          clearTimeout(this.idleT); clearTimeout(this.retryT);
          this.idleT = setTimeout(() => { if (!this.wake || this.closed) return; this.release(); }, 3000);
          // A part that gave nothing is tried again later (deadUntil): wake for it.
          const nowT = performance.now(), due = Math.min(Infinity, ...[...this.dead.values()].map((x) => x.until).filter((u) => u > nowT));
          if (Number.isFinite(due)) this.retryT = setTimeout(() => { if (this.wake){ const w = this.wake; this.wake = null; w(); } }, Math.max(50, due - performance.now()));
          await new Promise((ok) => { this.wake = ok; });
          continue;
        }
        await turnTake(this);
        // The turn is kept while there is work, given up only to a cache of a lower prio waiting.
        try {
          while (!this.closed && !this.broken){
            clearTimeout(this.idleT);
            if (!await this.open()) break;
            const job = this.next();
            if (!job) break;
            if (job.meta){ this.broken = true; break; }  // no length even from its player: nothing to plan
            await this.fetch(job);
            if (turnWanted(this)) break;
          }
        } finally { turnGive(this); }
      }
    } finally { this.running = false; }
  }
  // The hidden player, opened when needed (given back after 3 s idle). False: none can be had.
  async open(){
    if (this.v) return true;
    const v = document.createElement("video");
    if (!v.requestVideoFrameCallback){ this.broken = true; return false; }  // old WebKit: no cache, the player alone
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.setAttribute("playsinline", "");
    v.style.cssText = "position:fixed;left:-10px;top:-10px;width:2px;height:2px;opacity:0;pointer-events:none";
    document.body.appendChild(v);
    this.v = v;
    v.src = this.url;
    const ok = await new Promise((res) => {
      const tm = setTimeout(() => fin(false), 8000);
      const fin = (x) => { clearTimeout(tm); this._openEnd = null; res(x); };
      this._openEnd = fin;  // close() ends the wait at once (the turn is held meanwhile)
      v.addEventListener("loadeddata", () => fin(true), { once: true });
      v.addEventListener("error", () => fin(false), { once: true });
    });
    if (this.closed || this.v !== v) return false;
    if (!ok){ this.broken = true; this.release(); return false; }
    this.fresh = true;
    if (Number.isFinite(v.duration) && v.duration > 0 && Math.abs(v.duration - this.d) > 1e-3){ this.d = v.duration; this.resolve(); }
    return true;
  }
  seekTo(t){
    const v = this.v;
    return new Promise((ok) => {
      let tm = 0;
      const done = (_, meta) => { clearTimeout(tm); ok(meta ? meta.mediaTime : null); };
      v.requestVideoFrameCallback(done);
      tm = setTimeout(() => done(0, null), 800);
      v.currentTime = t;
    });
  }
  // One part: played through (or sought frame by frame when short); a part that gives no new frame is
  // not asked for again until the ranges change (the end of a clip, a stall).
  async fetch(job){
    const v = this.v, gen = this.gen, st = this.step(), n0 = this.mts.length;
    const fresh = this.fresh;
    this.fresh = false;
    let got = false;
    const keepAt = (mt) => { if (mt != null && this.keep(mt)) got = true; };  // (keep checks the ranges)
    if (job.b - job.a <= st * 6){
      let prev = job.a;
      while (job.b - prev > st * 1.5 && !this.closed && this.v === v && this.gen === gen){
        const mt = await this.seekTo(Math.max(0, Math.min(this.d - st * 0.5, prev + st * 1.25)));
        if (mt == null || mt <= prev + st * 0.5) break;
        keepAt(mt);
        prev = mt;
      }
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - job.a) > st * 2 || v.ended){ const mt = await this.seekTo(job.a); keepAt(mt); }
      else if (fresh && v.readyState >= 2 && !v.seeking) keepAt(v.currentTime);  // a player just opened stands on its first frame (no rVFC for it)
      if (!this.closed && this.v === v && this.gen === gen){
        const len = this.ranges.reduce((s, r) => s + (r.meta ? 0 : r.hi - r.lo), 0);
        // Faster than real time, but not past ~60 presented frames a second (a 60 fps clip at 1.5× drops every other one).
        v.playbackRate = Math.max(1, Math.min(4, Math.max(1.5, len / 20), 60 * this.fd()));
        await new Promise((ok) => {
          let wd = 0, fin = false;
          const end = () => { if (fin) return; fin = true; clearTimeout(wd); v.removeEventListener("ended", end); v.pause(); ok(); };
          const arm = () => { clearTimeout(wd); wd = setTimeout(end, 1500); };
          const tick = (_, meta) => {
            if (fin) return;
            if (this.closed || this.v !== v){ end(); return; }
            keepAt(meta.mediaTime);
            if (meta.mediaTime >= job.b - st * 0.5 || meta.mediaTime + st * 1.5 >= this.d || v.ended || this.gen !== gen || turnWanted(this)){ end(); return; }
            arm();
            v.requestVideoFrameCallback(tick);
          };
          v.requestVideoFrameCallback(tick);
          arm();
          v.play().catch(end);
          v.addEventListener("ended", end);
        });
      }
    }
    // A part that gave nothing waits 1.5 s, 3 s, then for good (until the ranges change).
    if (got) this.dead.delete(Math.round(job.a * 1000));  // a retry that worked
    else if (this.gen === gen && this.mts.length === n0){
      const k = Math.round(job.a * 1000), dd = this.dead.get(k) || { n: 0, until: 0 };
      dd.n++; dd.until = dd.n >= 3 ? Infinity : performance.now() + 1500 * dd.n;
      this.dead.set(k, dd);
    }
  }
  at(t){  // index of the first frame at or after t
    const m = this.mts;
    let lo = 0, hi = m.length;
    while (lo < hi){ const k = (lo + hi) >> 1; if (m[k] < t) lo = k + 1; else hi = k; }
    return lo;
  }
  keep(t){
    const key = Math.round(t * 1000), v = this.v;
    if (this.urls.has(key) || !v || !v.videoWidth) return false;
    if (!this.ranges.some((r) => !r.meta && t >= r.lo - this.fd() && t <= r.hi + this.fd())) return false;
    const w = Math.min(640, v.videoWidth), h = Math.max(1, Math.round(w * v.videoHeight / v.videoWidth));
    if (!this.c){ this.c = document.createElement("canvas"); this.c.width = w; this.c.height = h; }
    this.c.getContext("2d").drawImage(v, 0, 0, w, h);
    const tok = {};
    this.urls.set(key, tok);  // taken; the JPEG follows (tok: this take, not a later one of the same frame)
    this.mts.splice(this.at(t), 0, t);
    this.c.toBlob((b) => {
      if (this.closed) return;
      if (this.urls.get(key) !== tok) return;  // dropped meanwhile (out of the ranges), maybe taken again
      if (!b){ this.urls.delete(key); const j = this.mts.indexOf(t); if (j >= 0) this.mts.splice(j, 1); return; }
      this.urls.set(key, URL.createObjectURL(b));
      this.report();
    }, "image/jpeg", 0.75);
    return true;
  }
  report(){ if (this.progT || this.closed) return; this.progT = setTimeout(() => { this.progT = 0; if (!this.closed && this.onProgress) this.onProgress(); }, 120); }
  pic(i){ const u = i >= 0 && i < this.mts.length ? this.urls.get(Math.round(this.mts[i] * 1000)) : null; return typeof u === "string" ? u : null; }
  // The cached frame closest to t, if one is close (a part not cached yet shows the player instead).
  near(t){
    const i = this.at(t), tol = Math.max(0.1, this.step() * 2.5);
    let best = null, bd = Infinity;
    for (const j of [i - 1, i, i - 2, i + 1]){
      const u = this.pic(j);
      if (u && Math.abs(this.mts[j] - t) < bd){ bd = Math.abs(this.mts[j] - t); best = u; }
    }
    return bd <= tol ? best : null;
  }
  // The frame the player will show for frame n (it is sent to (n + 0.25)·fd and shows the last
  // frame starting at or before that), or null — a step must not show a neighbour first. Only when
  // that frame is cached and nothing is missing in between (it starts within a frame of the bound),
  // so jittery stamps (phone clips) or an offset start give the same frame as the player.
  exact(t, fd, n){
    const b = Math.min((n + 0.25) * fd, this.d || Infinity) + 1e-4, i = this.at(b) - 1;
    if (i < 0) return null;
    return b - this.mts[i] <= fd + 2e-4 ? this.pic(i) : null;
  }
  // [from, to] seconds: the unbroken run of cached frames around t (null when t is not in one).
  span(t){
    const m = this.mts, st = this.step(), tol = st * 1.6;
    if (!m.length) return null;
    let i = this.at(t + 1e-6) - 1;  // the last frame at or before t
    if (i < 0){ if (m[0] - t > tol) return null; i = 0; }
    else if (t - m[i] > tol) return null;
    let a = i, b = i;
    while (a > 0 && m[a] - m[a - 1] <= tol) a--;
    while (b + 1 < m.length && m[b + 1] - m[b] <= tol) b++;
    return [a === 0 && m[0] <= tol ? 0 : m[a], Math.min(this.d || Infinity, m[b] + st)];
  }
  release(){ if (this.v){ this.v.pause(); this.v.removeAttribute("src"); this.v.load(); this.v.remove(); this.v = null; } if (this.c){ dropCanvas(this.c); this.c = null; } }
  close(){
    this.closed = true;
    clearTimeout(this.idleT); clearTimeout(this.progT); clearTimeout(this.retryT);
    if (this.wake){ const w = this.wake; this.wake = null; w(); }
    if (this._openEnd) this._openEnd(false);
    if (this._turn && turnQ.has(this)){ turnQ.delete(this); this._turn(); }  // its loop wakes, sees `closed`, gives the turn back
    this.release();
    this.urls.forEach((u) => { if (typeof u === "string") URL.revokeObjectURL(u); });
    this.urls.clear(); this.mts = [];
    if (this.own && this.url) URL.revokeObjectURL(this.url);
  }
}
