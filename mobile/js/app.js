// Sight Review — the phone app (docs/PLAN-mobile.md stage 3). A local file is picked on the device
// (nothing is uploaded) and reviewed from scratch: notes, replies, states, drawings on the picture
// or any video frame; the review lives in IndexedDB (store.js) and leaves the device only as an
// export: PDF / static HTML (report.js) or a .srev that merges in Sight (model.js, review-core).
// Rendering and the merge come from review-core.js, the drawing canvas from review-draw.js (both
// shared with Sight's HTML reviewer page), shortcuts from Sight's keys.js.

import * as DB from "./store.js";
import { kindOf, assetKey, extOf, probeImage, probeVideo, scaled, Grabber, ScrubCache, seek, fmtTime, fmtBytes, decode, hex16, dropCanvas, canvasBlob } from "./media.js";
import { videoFps } from "./mp4.js";
import * as M from "./model.js";
import { gatherReport, toHtml, toPdf, fmtDate } from "./report.js";
import { runHotkeys } from "../core/keys.js";

const RC = window.SightReviewCore, DRAW = window.SightReviewDraw;
if (DRAW.css) DRAW.css();  // its floating bar (.rd-panel) dresses the player's header and transport too
const VERSION = window.SIGHT_REVIEW_VERSION && !window.SIGHT_REVIEW_VERSION.includes("%%") ? window.SIGHT_REVIEW_VERSION : "dev";
const APP_VER = VERSION.split("-")[0];
const APP_LABEL = "Sight Review " + APP_VER;
const SVGNS = "http://www.w3.org/2000/svg";
const root = document.getElementById("app");

// ---- small helpers -----------------------------------------------------------------------------
function el(tag, cls, text){ const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
function btn(cls, text, fn, title){ const b = el("button", cls, text); b.type = "button"; if (fn) b.onclick = fn; if (title){ b.title = title; b.setAttribute("aria-label", title); } return b; }
const ICONS = {
  photo: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-9 9"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  back: '<path d="m15 5-7 7 7 7"/>', more: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/>', pause: '<path d="M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z" fill="currentColor"/>',
  prev: '<path d="M14 6 8 12l6 6"/>', next: '<path d="m10 6 6 6-6 6"/>',
  snd: '<path d="M4 9.5h3l5-4v13l-5-4H4z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6"/><path d="M18.4 6.6a7.6 7.6 0 0 1 0 10.8"/>',
  sndoff: '<path d="M4 9.5h3l5-4v13l-5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  loop: '<path d="M17 3l3 3-3 3"/><path d="M4 11.5V10a4 4 0 0 1 4-4h12"/><path d="M7 21l-3-3 3-3"/><path d="M20 12.5V14a4 4 0 0 1-4 4H4"/>',
  hideui: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 9h18M3 15h18" stroke-dasharray="2 2.4"/>',
  showui: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 9h18M3 15h18"/>',
  once: '<path d="M3.5 12h12"/><path d="m11.5 7.5 4.5 4.5-4.5 4.5"/><path d="M20 6v12"/>',
  stepb: '<path d="M6 5v14"/><path d="M18 6 10 12l8 6z" fill="currentColor"/>', stepf: '<path d="M18 5v14"/><path d="m6 6 8 6-8 6z" fill="currentColor"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  pen: '<path d="M4 20l1-4.5L16 4.5a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="M14 20h6"/>',
  clip: '<path d="m20.5 11.5-8.3 8.3a5.2 5.2 0 0 1-7.4-7.4l8.6-8.6a3.5 3.5 0 0 1 4.9 4.9l-8.6 8.6a1.7 1.7 0 0 1-2.5-2.5l7.9-7.9"/>',
  send: '<path d="M3.4 20.4 21 12 3.4 3.6 3.4 10.2 15 12 3.4 13.8z" fill="currentColor" stroke="none"/>',
  fit: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', up: '<path d="m6 15 6-6 6 6"/>',
  turn: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>', mirror: '<path d="M12 3v18"/><path d="M8 7 3 17h5z"/><path d="M16 7l5 10h-5z"/>',
};
function ico(name, size = 20){ return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`; }
function ibtn(name, title, fn, size){ const b = btn("ib", null, fn, title); b.innerHTML = ico(name, size); return b; }
const now = () => Date.now();
const r3 = (t) => Math.round(t * 1000) / 1000;
const stemOf = (name) => String(name || "review").replace(/\.[^.]+$/, "");
const safeName = (s) => String(s).replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_").trim() || "review";
const blobToDataUrl = (blob) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(r.error); r.readAsDataURL(blob); });
function dataUrlBytes(u){
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(String(u || ""));
  if (!m) return null;
  try {
    if (!m[2]) return { type: m[1] || "application/octet-stream", bytes: new TextEncoder().encode(decodeURIComponent(m[3])) };
    const bin = atob(m[3]), b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return { type: m[1] || "image/jpeg", bytes: b };
  } catch { return null; }
}

let toastT = null;
function toast(msg, ms = 2600){
  let t = document.querySelector(".toast");
  if (!t){ t = el("div", "toast"); document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false;
  t.classList.toggle("hi", root.classList.contains("review"));  // clear of the transport and the note bar
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
}
function busy(msg){
  const b = el("div", "busy"), d = el("div", "", msg); b.appendChild(d); document.body.appendChild(b);
  return { set(m){ d.textContent = m; }, done(){ b.remove(); } };
}
// A sheet over the page: from the bottom (menus) or centred (questions). Returns close().
const sheets = [];
function sheet(build, mid){
  const back = el("div", "back" + (mid ? " mid" : "")), sh = el("div", "sheet");
  back.appendChild(sh);
  const close = () => { back.remove(); const i = sheets.indexOf(close); if (i >= 0) sheets.splice(i, 1); };
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
  build(sh, close);
  document.body.appendChild(back);
  sheets.push(close);
  return close;
}
function menu(title, items){
  sheet((sh, close) => {
    if (title) sh.appendChild(el("h2", "", title));
    const m = el("div", "menu");
    items.filter(Boolean).forEach((it) => {
      const b = btn(it.danger ? "danger" : "", it.label, () => { close(); it.fn(); });
      if (it.note){ b.appendChild(el("small", "", it.note)); }
      m.appendChild(b);
    });
    sh.appendChild(m);
  });
}
function ask({ title, text, ok = "OK", cancel = "Cancel", danger }){
  return new Promise((res) => {
    sheet((sh, close) => {
      sh.appendChild(el("h2", "", title));
      if (text) sh.appendChild(el("p", "", text));
      const a = el("div", "acts");
      a.appendChild(btn("btn", cancel, () => { close(); res(false); }));
      a.appendChild(btn("btn primary" + (danger ? " danger" : ""), ok, () => { close(); res(true); }));
      sh.appendChild(a);
    }, true);
  });
}
function askText({ title, text, value = "", ok = "Save", multiline, placeholder }){
  return new Promise((res) => {
    sheet((sh, close) => {
      sh.appendChild(el("h2", "", title));
      if (text) sh.appendChild(el("p", "", text));
      const f = el("form"), inp = el(multiline ? "textarea" : "input");
      if (!multiline){ inp.type = "text"; inp.maxLength = 80; inp.autocomplete = "name"; }
      inp.value = value; inp.placeholder = placeholder || "";
      const a = el("div", "acts");
      a.appendChild(btn("btn", "Cancel", () => { close(); res(null); }));
      const s = el("button", "btn primary", ok); s.type = "submit"; a.appendChild(s);
      f.appendChild(inp); f.appendChild(a);
      f.onsubmit = (e) => { e.preventDefault(); close(); res(inp.value); };
      sh.appendChild(f);
      setTimeout(() => inp.focus(), 40);
    }, true);
  });
}

// ---- theme: Auto (the system's) / Light / Dark, one look for the player and the notes ---------
const THEMES = { auto: "Auto", light: "Light", dark: "Dark" };
let theme = "auto";
try { theme = THEMES[localStorage.getItem("sight-review:theme")] ? localStorage.getItem("sight-review:theme") : "auto"; } catch {}
function applyTheme(){
  const h = document.documentElement;
  if (theme === "auto") delete h.dataset.theme; else h.dataset.theme = theme;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    if (!m.dataset.auto) m.dataset.auto = m.content;
    m.content = theme === "auto" ? m.dataset.auto : theme === "dark" ? "#141416" : "#f5f5f7";
  });
}
function setTheme(t){
  theme = THEMES[t] ? t : "auto";
  try { localStorage.setItem("sight-review:theme", theme); } catch {}
  applyTheme();
}
applyTheme();

// ---- reviewer name -----------------------------------------------------------------------------
let who = "";
try { who = localStorage.getItem("sight-review:name") || ""; } catch {}
async function setName(){
  const v = await askText({ title: "Who is reviewing?", text: "Your name goes on every note, reply, drawing and state change you make.", value: who, ok: "Continue", placeholder: "Your name" });
  if (v == null || !v.trim()) return false;
  who = v.trim();
  try { localStorage.setItem("sight-review:name", who); } catch {}
  return true;
}
const ensureName = async () => !!who || setName();

// ---- current review ----------------------------------------------------------------------------
// R: {meta (the reviews record), rows, file, url, video, grab, fps, frames: Map(tag → {blob, w, h,
// url}), shotUrls, drafts, openReply, newOpen, replyTo, curNote, filter, hide}
let R = null;
const kindNow = () => R && R.meta.asset.kind;
// The bar over the player is writing something: a new note (newOpen) or a reply on a video note
// over the player (replyTo = its id). Drafts are keyed by "+new" / the note's id.
const composing = () => !!(R && (R.newOpen || R.replyTo));
const composeKey = () => R.replyTo || "+new";
const docW = () => R.meta.asset.width || 0, docH = () => R.meta.asset.height || 0;
function numMap(){
  const m = new Map();
  M.notesSorted(R.rows, kindNow()).forEach((n, i) => m.set(n.id, i + 1));
  return m;
}
let NUM = new Map();
const numOf = (it) => NUM.get(it.data && it.data.note) || "";

let saveT = null, savePending = null;
function dirty(){
  R.meta.updated = now();
  R.meta.counts = M.counts(R.rows);
  const meta = R.meta, rows = R.rows;
  clearTimeout(saveT);
  savePending = () => DB.saveReview(meta, rows);
  saveT = setTimeout(flush, 250);
  paintReview();
}
// Writes the latest snapshot. A failed write stays pending and is tried again (next flush, or in
// 3 s), so a dropped database connection does not lose the edits.
let saveWarned = false;
function flush(){
  clearTimeout(saveT);
  const p = savePending;
  if (!p) return Promise.resolve();
  return p().then(() => { if (savePending === p) savePending = null; saveWarned = false; }, (e) => {
    console.error(e);
    if (!saveWarned){ saveWarned = true; toast("Could not save on this device: " + (e.message || e) + " — trying again", 5000); }
    if (savePending === p){ clearTimeout(saveT); saveT = setTimeout(flush, 3000); }
  });
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
window.addEventListener("pagehide", () => { flush(); });

// Cached clean pictures (store.js "frames"): the picture ≤ 1600 px and video frames by time.
// `rv` is the review asking: the user may have switched to another one by the time it lands.
async function cachedFrame(rv, tag, make){
  const hit = rv.frames.get(tag);
  if (hit) return hit;
  const id = rv.meta.key + "|" + tag;
  let f = await DB.get("frames", id).catch(() => null);
  if (!f && make){
    const m = await make().catch((e) => { console.warn("frame", e); return null; });
    if (!m) return null;
    f = { id, review: rv.meta.key, blob: m.blob, w: m.w, h: m.h };
    putIfAlive(rv, "frames", f);
  }
  if (!f) return null;
  if (rv.frames.has(tag)) return rv.frames.get(tag);
  const out = { blob: f.blob, w: f.w, h: f.h, url: URL.createObjectURL(f.blob) };
  if (R === rv) rv.frames.set(tag, out); else setTimeout(() => URL.revokeObjectURL(out.url), 60000);
  return out;
}
// Late writes (thumbnail, measured fps, a frame) of a review that may have been deleted meanwhile.
async function putIfAlive(rv, store, value){
  try { if (await DB.has("reviews", rv.meta.key)) await DB.put(store, value); } catch (e){ console.warn(e); }
}
const frameTag = (t) => "t=" + Number(t).toFixed(3);
const memFrame = (t) => R.frames.get(frameTag(t)) || null;
function getFrame(t, rv = R){
  // Grabbed a quarter into its frame: a stored time can sit a hair before the frame's start.
  const at = rv.fpsKnown ? (M.frameIndex(t, rv.fps) + 0.25) / rv.fps : t;
  return cachedFrame(rv, frameTag(t), rv.grab ? () => rv.grab.grab(at, 1600) : null);
}
function getPicture(rv = R){
  return cachedFrame(rv, "img", rv.file ? async () => { const im = await decode(rv.file); const s = await scaled(im, 1600); if (im.close) im.close(); return s; } : null);
}
async function shotUrl(id){
  if (R.shotUrls.has(id)) return R.shotUrls.get(id);
  const s = await DB.get("shots", id).catch(() => null);
  if (!s) return null;
  const u = URL.createObjectURL(s.blob);
  R.shotUrls.set(id, u);
  return u;
}

// ---- opening files -----------------------------------------------------------------------------
function picker(accept, multiple, onFiles){
  const inp = el("input"); inp.type = "file"; if (accept) inp.accept = accept; inp.multiple = !!multiple;
  inp.onchange = () => { const fs = Array.from(inp.files || []); inp.value = ""; if (fs.length) onFiles(fs); };
  return inp;
}
async function openAny(files){
  const f = files[0], k = kindOf(f);
  if (k === "review") return importReviewFile(f, null);
  if (k === "image" || k === "video") return openMedia(f);
  toast("The app opens pictures, videos and Sight review files (.srev)", 4000);
}
async function openMedia(file){
  const key = await assetKey(file.name, file.size);
  let meta = await DB.get("reviews", key);
  if (!meta){
    const kind = kindOf(file), url = URL.createObjectURL(file);
    let info;
    try {
      info = kind === "image" ? await probeImage(url) : await probeVideo(url, file);
      if (!info.w) throw new Error("no picture");
    } catch {
      URL.revokeObjectURL(url);
      toast(kind === "video" ? "This device cannot play this video (format or codec). iPhone plays H.264 / HEVC MP4 and MOV." : "This device cannot show this picture.", 5000);
      return;
    }
    URL.revokeObjectURL(url);
    const t = now();
    meta = { key, asset: { id: key, name: file.name, path: file.name, ext: extOf(file.name), kind, size: file.size,
      mtime: file.lastModified ? Math.round(file.lastModified / 1000) : null, width: info.w, height: info.h, duration: kind === "video" ? info.duration || null : null },
      fps: info.fps || null, created: t, opened: t, updated: t, counts: M.counts([]), thumb: null, kept: false };
    await DB.saveReview(meta, []);
    DB.persist();
  }
  await openReview(key, file);
}

// ---- import / merge a .srev ------------------------------------------------------------------
async function importReviewFile(file, intoKey){
  let pkg;
  try { pkg = M.parsePackage(await file.text()); }
  catch (e){ toast(e.message || "Not a Sight review file", 4000); return; }
  const a = pkg.asset;
  if (a.kind && a.kind !== "image" && a.kind !== "video"){ toast(`This review is for a ${a.kind} file — the app opens pictures and videos for now.`, 5000); return; }
  await flush();
  let key = intoKey;
  if (!key){
    // An earlier import of the same review first (it holds the rows), then the same name + size.
    let best = null, bestN = 0;
    for (const m of await DB.all("reviews")){
      const rr = await DB.get("rows", m.key), n = M.overlap(rr ? rr.rows : [], pkg);
      if (n > bestN){ best = m.key; bestN = n; }
    }
    key = best || await assetKey(a.name, a.size);
  }
  let meta = await DB.get("reviews", key);
  if (intoKey && meta && (String(meta.asset.name).toLowerCase() !== String(a.name || "").toLowerCase() || (a.size != null && meta.asset.size !== a.size))){
    if (!await ask({ title: "Another file?", text: `This review file is for “${a.name}”. Merge it into the review of “${meta.asset.name}” anyway?`, ok: "Merge" })) return;
  }
  if (!meta){
    const t = now();
    const asset = Object.fromEntries(M.ASSET_KEYS.map((k) => [k, a[k] === undefined ? null : a[k]]));
    if (!asset.kind) asset.kind = kindOf({ name: asset.name || "", type: "" }) || "image";
    if (!asset.ext) asset.ext = extOf(asset.name);
    meta = { key, asset, fps: null, created: t, opened: t, updated: t, counts: M.counts([]), thumb: null, kept: false };
  }
  // Pictures: hex ids are kept (the same id is the same picture), others get one from the bytes.
  const shotMap = {};
  for (const [sid, url] of Object.entries(pkg.shots && typeof pkg.shots === "object" ? pkg.shots : {})){
    const d = dataUrlBytes(url);
    if (!d) continue;
    const id = /^[0-9a-f]{16}$/.test(sid) ? sid : await hex16(d.bytes);
    if (id !== sid) shotMap[sid] = id;
    if (!await DB.has("shots", id)) await DB.put("shots", { id, blob: new Blob([d.bytes], { type: d.type }) });
  }
  const open = R && R.meta.key === key;
  const rows = open ? R.rows : ((await DB.get("rows", key)) || { rows: [] }).rows;
  const res = M.mergePackage(rows, pkg, shotMap);
  meta.counts = M.counts(res.rows); meta.updated = now();
  // The open review takes the merged rows at once: an edit made while they are saved goes into them.
  if (open){ R.rows = res.rows; R.meta = Object.assign(R.meta, { counts: meta.counts, updated: meta.updated }); dirty(); }
  else await DB.saveReview(meta, res.rows);
  const s = res.stats, parts = [["new", s.added], ["updated", s.updated], ["deleted", s.deleted]].filter((x) => x[1]).map((x) => x[1] + " " + x[0]);
  toast(parts.length ? `Merged the review${pkg.author ? " from " + pkg.author : ""}: ${parts.join(" · ")}` : "Already up to date — nothing new in this review file", 4000);
  if (!open) await openReview(key, null);
}

// ---- screens -------------------------------------------------------------------------------
function route(){
  // Back (iOS edge swipe, Android back) while the canvas, the viewer or a sheet is open closes that
  // instead of the review under it; the canvas is left to its own Done / Cancel.
  if (R && location.hash !== "#r=" + R.meta.key && (document.querySelector(".draw") || sheets.length)){
    if (!document.querySelector(".draw")) sheets[sheets.length - 1]();
    history.pushState(null, "", "#r=" + R.meta.key);
    return;
  }
  const m = /^#r=([0-9a-f]{16})$/.exec(location.hash);
  if (m && (!R || R.meta.key !== m[1])) openReview(m[1], null, true);
  else if (!m) { closeReview(); renderHome(); }
}
window.addEventListener("popstate", route);

function isStandalone(){ return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; }
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

// ---- full screen ---------------------------------------------------------------------------------
// Auto (Settings, on by default): the first tap goes full screen in a browser tab that can (Android
// Chrome, desktop browsers). Not on iOS: iPhone Safari has no page full screen, iPad Safari limits
// typing in it — the installed app is full screen anyway. Only a plain one-finger tap asks (not a
// scrub, a drag, a hold, a pinch: the page would resize under it), never one that opens the file
// picker (the picker would close it again) or goes into a text field. Left by the user (Android's
// back leaves full screen first, Esc, the system's swipe): it stays off until the next screen (a
// review opened / closed), so a second back press is not eaten too.

const FS_KEY = "sight-review:fs", docEl = document.documentElement;
const fsReq = docEl.requestFullscreen || docEl.webkitRequestFullscreen;
const fsCan = () => !!fsReq && !isStandalone() && !isIOS() && !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
const fsOn = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
let fsAuto = true, fsArmed = true, fsLeaving = false;
try { fsAuto = localStorage.getItem(FS_KEY) !== "0"; } catch {}
const fsArm = () => { fsArmed = true; };
["fullscreenchange", "webkitfullscreenchange"].forEach((ev) => document.addEventListener(ev, () => {
  if (fsOn()) return;
  if (!fsLeaving) fsArmed = false;  // the user left it: not again until the next screen
  fsLeaving = false;
}));
function enterFS(){
  if (!fsCan() || fsOn()) return;
  fsArmed = true;
  try { const pr = fsReq.call(docEl, { navigationUI: "hide" }); if (pr && pr.catch) pr.catch(() => {}); } catch {}
}
function exitFS(){
  if (!fsOn()) return;
  fsLeaving = true;
  try { const pr = (document.exitFullscreen || document.webkitExitFullscreen).call(document); if (pr && pr.catch) pr.catch(() => {}); } catch {}
}
function setFsAuto(on){
  fsAuto = on;
  try { localStorage.setItem(FS_KEY, on ? "1" : "0"); } catch {}
  if (on) enterFS(); else exitFS();
}
// Asked on pointerup (the press's activation still holds then, for a mouse too, and the page does
// not resize between press and release).
const fsDown = new Map();
let fsMulti = false;
document.addEventListener("pointerdown", (e) => { if (!fsDown.size) fsMulti = false; else fsMulti = true; fsDown.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.timeStamp }); }, true);
const fsUp = (e) => {
  const d = fsDown.get(e.pointerId);
  fsDown.delete(e.pointerId);
  if (e.type !== "pointerup" || !d || fsMulti || fsDown.size || !fsAuto || !fsArmed || fsOn() || !fsCan()) return;
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12 || e.timeStamp - d.t > 600) return;  // a drag / a hold
  if (e.target.closest && e.target.closest("label, input, textarea, select, [contenteditable], a[href], .sheet, [data-nofs]")) return;
  enterFS();
};
document.addEventListener("pointerup", fsUp, true);
document.addEventListener("pointercancel", fsUp, true);

async function renderHome(){
  fsArm();  // a new screen: auto full screen may ask again
  document.title = "Sight Review";
  openRow = null;
  document.querySelectorAll("body > .item.ghost").forEach((g) => g.remove());  // a drag cut short by this render
  root.textContent = "";
  root.className = "home";
  const bar = el("header", "bar"), ttl = el("div", "ttl");
  ttl.appendChild(el("b", "", "Sight Review"));
  // The two open buttons: big ones on an empty home screen, two small icons in the bar next to
  // Settings once there is a review (renderHome picks one set when the list is in).
  const mini = el("div", "mini");
  [["photo", "Photo or video", "image/*,video/*", "pick-media"], ["file", "Open a file…", "", "pick-file"]].forEach(([icon, title, accept, cls]) => {
    const l = el("label", "ib " + cls); l.title = title; l.setAttribute("aria-label", title);
    l.innerHTML = ico(icon, 20);
    l.appendChild(picker(accept, false, openAny));
    mini.appendChild(l);
  });
  mini.hidden = true;
  bar.appendChild(el("span")); bar.appendChild(ttl); bar.appendChild(mini); bar.appendChild(ibtn("gear", "Settings", settings));
  root.appendChild(bar);
  const main = el("main");
  const opens = el("div", "opens");
  const l1 = el("label", "main pick-media"), l2 = el("label", "pick-file");
  l1.appendChild(el("b", "", "Photo or video")); l1.appendChild(el("small", "", "from the library or camera roll"));
  l1.appendChild(picker("image/*,video/*", false, openAny));
  l2.appendChild(el("b", "", "Open a file…")); l2.appendChild(el("small", "", "Files: media or a .srev review"));
  l2.appendChild(picker("", false, openAny));
  opens.appendChild(l1); opens.appendChild(l2);
  opens.hidden = true;
  main.appendChild(opens);
  // Opened over plain HTTP (a custom domain without HTTPS enforced): no service worker there, so no
  // offline use and no updates. Not redirected on its own: the reviews of this address live in its
  // own storage, which the HTTPS address cannot see.
  if (location.protocol === "http:" && !/^(localhost|127\.|\[::1\])/.test(location.hostname)){
    const h = el("div", "hint"), p = el("p"), https = "https:" + location.href.slice(5).replace(/#.*$/, "");
    p.innerHTML = "<b>This address has no HTTPS</b>, so the app cannot work offline or update itself. Open it over HTTPS and add that to the Home Screen. Reviews made here stay here: export each one (⋯ → Review file for Sight) and open the file in the HTTPS app.";
    const b = el("a", "btn", "Open over HTTPS"); b.href = https;
    p.appendChild(el("br")); p.appendChild(b);
    h.appendChild(p);
    main.appendChild(h);
  }
  let hide = false;
  try { hide = localStorage.getItem("sight-review:hint") === "1"; } catch {}
  if (!isStandalone() && !hide){
    const h = el("div", "hint"), p = el("p");
    p.innerHTML = isIOS() ? "<b>Install the app:</b> tap Share, then <b>Add to Home Screen</b>. It then runs full screen and offline. Reviews made here in Safari are not seen by the installed app." : "<b>Install the app</b> from the browser menu (Install app / Add to Home screen) to use it offline, full screen.";
    h.appendChild(p);
    h.appendChild(btn("", "×", () => { try { localStorage.setItem("sight-review:hint", "1"); } catch {} h.remove(); }, "Hide"));
    main.appendChild(h);
  }
  const list = el("section", "list");
  main.appendChild(list);
  const foot = el("p", "foot");
  foot.appendChild(el("span", "", APP_LABEL)); foot.appendChild(el("br")); foot.appendChild(el("span", "", "Nothing leaves this device unless you share it"));
  main.appendChild(foot);
  root.appendChild(main);
  const all = await DB.all("reviews").catch(() => []);
  if (!main.isConnected) return;  // another screen took over meanwhile
  // One set of open buttons in the page: the big ones only while there is no review at all.
  (all.length ? opens : mini).remove();
  mini.hidden = opens.hidden = false;
  if (!all.length){ list.appendChild(el("p", "empty", "No reviews yet. Open a picture or a video to start one, or open a .srev file someone sent you.")); return; }
  const hidden = hiddenKeys(), groups = tidyGroups(all.map((m) => m.key)), byKey = new Map(all.map((m) => [m.key, m]));
  const inGroup = new Set(groups.flatMap((g) => g.keys));
  // The list's entries: reviews on their own and groups (each placed as one, "g:<id>").
  const entries = all.filter((m) => !inGroup.has(m.key)).map((m) => ({ key: m.key, opened: m.opened, m }))
    .concat(groups.map((g) => ({ key: "g:" + g.id, opened: Math.max(...g.keys.map((k) => byKey.get(k).opened || 0)), g })));
  list.appendChild(el("h2", "", "Reviews"));
  let shown = 0;
  const ordered = orderReviews(entries);
  // Saved as shown, every entry in its slot: group changes splice into the real places.
  try { localStorage.setItem("sight-review:order", JSON.stringify(ordered.map((x) => x.key))); } catch {}
  ordered.forEach((x) => {
    if (x.m){ if (!hidden.has(x.key)){ list.appendChild(reviewRow(x.m)); shown++; } return; }
    const ms = x.g.keys.map((k) => byKey.get(k)).filter((m) => !hidden.has(m.key));
    if (ms.length){ list.appendChild(groupRow(x.g, ms)); shown += ms.length; }
  });
  // The selection (taps on reviews): only reviews still listed; its bar at the foot.
  [...homeSel].forEach((k) => { if (!byKey.has(k) || hidden.has(k)) homeSel.delete(k); });
  paintSelBar();
  const nh = all.length - shown;
  if (nh){
    const f = el("p", "foot");
    f.appendChild(document.createTextNode(`${nh} hidden for now · `));
    f.appendChild(btn("lnk", "Show", () => { setHidden(new Set()); renderHome(); }));
    list.appendChild(f);
  }
}
// The list's order is the user's (press, hold, drag): `sight-review:order` keeps the keys in order
// (a group as "g:<id>"); reviews not in it yet (new ones) come first, newest opened first.
function loadOrder(){
  let order = [];
  try { order = JSON.parse(localStorage.getItem("sight-review:order")); } catch {}
  return Array.isArray(order) ? order.filter((k) => typeof k === "string") : [];
}
function orderReviews(metas){
  const at = new Map(loadOrder().map((k, i) => [k, i]));
  return metas.slice().sort((a, b) => {
    const ia = at.has(a.key) ? at.get(a.key) : -1, ib = at.has(b.key) ? at.get(b.key) : -1;
    if (ia < 0 || ib < 0) return ia < 0 && ib < 0 ? (b.opened || 0) - (a.opened || 0) : ia < 0 ? -1 : 1;
    return ia - ib;
  });
}
// The rows on screen in their new order, written into the slots the shown reviews had in the saved
// order, so reviews hidden for now keep their places; shown ones not saved yet (new ones, listed
// first) get slots in front. Keys of deleted reviews drop out.
function saveOrder(shown){
  const prev = loadOrder(), vis = new Set(shown), hid = hiddenKeys(), q = shown.slice(), out = [];
  const fresh = shown.filter((k) => !prev.includes(k)).length;
  for (let i = 0; i < fresh; i++) out.push(q.shift());
  prev.forEach((k) => { if (vis.has(k)) out.push(q.shift()); else if (hid.has(k) || k.startsWith("g:")) out.push(k); });
  out.push(...q);
  try { localStorage.setItem("sight-review:order", JSON.stringify(out)); } catch {}
}
// "Hide for now": until the app is closed (sessionStorage), or *Show* under the list.
function hiddenKeys(){ try { return new Set(JSON.parse(sessionStorage.getItem("sight-review:hidden")) || []); } catch { return new Set(); } }
function setHidden(set){ try { sessionStorage.setItem("sight-review:hidden", JSON.stringify([...set])); } catch {} }
// Groups of reviews (a review held and let go on another one): `sight-review:groups` =
// [{id, name, keys (in order), open}]. A review is in one group at most; a group of fewer than two
// reviews that still exist dissolves (the one left goes back to the list in the group's place).
function loadGroups(){
  let g = [];
  try { g = JSON.parse(localStorage.getItem("sight-review:groups")); } catch {}
  return Array.isArray(g) ? g.filter((x) => x && typeof x.id === "string" && Array.isArray(x.keys)) : [];
}
function saveGroups(gs){ try { localStorage.setItem("sight-review:groups", JSON.stringify(gs)); } catch { toast("Could not save the groups: this device's storage for the app is full", 4000); } }
function tidyGroups(keys){
  const have = new Set(keys), seen = new Set(), out = [];
  let changed = false;
  const order = loadOrder();
  loadGroups().forEach((g) => {
    const ks = g.keys.filter((k) => typeof k === "string" && have.has(k) && !seen.has(k));
    if (ks.length !== g.keys.length) changed = true;
    if (ks.length < 2){
      changed = true;
      const i = order.indexOf("g:" + g.id);
      if (i >= 0) order.splice(i, 1, ...ks);
      return;
    }
    ks.forEach((k) => seen.add(k));
    out.push(Object.assign({}, g, { keys: ks }));
  });
  if (changed){ saveGroups(out); try { localStorage.setItem("sight-review:order", JSON.stringify(order)); } catch {} }
  return out;
}
// The name a new group gets: what the two names start with (shot_v001 + shot_v002 → "shot"), or "Group".
function groupName(a, b){
  a = String(a || ""); b = String(b || "");
  let i = 0;
  while (i < a.length && i < b.length && a[i].toLowerCase() === b[i].toLowerCase()) i++;
  let p = a.slice(0, i);
  // Cut mid-word ("clip.m" of clip.mp4 / clip.mov, "shot_v00" of shot_v001 / v002): back to the word's start.
  if (i < a.length && /[a-z]/i.test(a[i]) && /\w$/.test(p)) p = p.replace(/[^\s._-]*$/, "");
  p = p.replace(/[\s._-]*(v\d+|\d+)?[\s._-]*$/i, "").trim();
  return p.length >= 2 ? p : "Group";
}
const saveOrderKeys = (order) => { try { localStorage.setItem("sight-review:order", JSON.stringify(order)); } catch { toast("Could not save the list's order: this device's storage for the app is full", 4000); } };
// The picked reviews in the list's order (a new group is named and ordered by it).
const pickedInOrder = () => { const ks = [...document.querySelectorAll(".list .row[data-key]")].map((x) => x.dataset.key).filter((k) => homeSel.has(k)); homeSel.forEach((k) => { if (!ks.includes(k)) ks.push(k); }); return ks; };
// Moves reviews `keys` (on their own or out of their groups) onto `on`: a group ("g:<id>") → into
// it, last; a review in a group → into that group, after it; a review on its own → a new group of
// it and them, in its place. Groups left with one review dissolve on the next render (tidyGroups).
function moveInto(keys, on, names){
  keys = keys.filter((k) => k !== on);
  if (!keys.length) return;
  const gs = loadGroups(), order = loadOrder().filter((k) => !keys.includes(k));
  gs.forEach((g) => { g.keys = g.keys.filter((k) => !keys.includes(k)); });
  const tg = on.startsWith("g:") ? gs.find((g) => "g:" + g.id === on) : gs.find((g) => g.keys.includes(on));
  if (on.startsWith("g:") && !tg) return;
  if (tg){
    const i = on.startsWith("g:") ? tg.keys.length : tg.keys.indexOf(on) + 1;
    tg.keys.splice(i, 0, ...keys);
    toast(keys.length > 1 ? `${keys.length} reviews moved to “${tg.name}”` : `Moved to “${tg.name}”`, 1800);
  } else {
    const g = { id: RC.uid(), name: groupName(names.get(on), names.get(keys[0])), keys: [on, ...keys], open: true };
    gs.push(g);
    const i = order.indexOf(on);
    if (i >= 0) order[i] = "g:" + g.id; else order.unshift("g:" + g.id);
    toast(`Grouped as “${g.name}” — hold it to rename`, 2200);
  }
  saveGroups(gs); saveOrderKeys(order);
}
// A new group of `keys` (at least two), in the first one's place in the list.
function groupKeys(keys, names){
  const gs = loadGroups(), order = loadOrder();
  const first = keys[0], fg = gs.find((g) => g.keys.includes(first));
  let at = fg ? order.indexOf("g:" + fg.id) + 1 : order.indexOf(first);
  gs.forEach((g) => { g.keys = g.keys.filter((k) => !keys.includes(k)); });
  const o2 = order.filter((k, i) => { if (keys.includes(k)){ if (i < at) at--; return false; } return true; });
  const g = { id: RC.uid(), name: groupName(names.get(keys[0]), names.get(keys[1])), keys: keys.slice(), open: true };
  gs.push(g);
  o2.splice(at >= 0 ? Math.min(at, o2.length) : 0, 0, "g:" + g.id);
  saveGroups(gs); saveOrderKeys(o2);
  toast(`Grouped as “${g.name}” — hold it to rename`, 2200);
}
// Out of their groups: back in the list right after the group each was in.
function takeOut(keys){
  const gs = loadGroups(), after = new Map();  // how many went in after each group so far (their order kept)
  let order = loadOrder();
  keys.forEach((key) => {
    const g = gs.find((x) => x.keys.includes(key));
    if (!g) return;
    g.keys = g.keys.filter((k) => k !== key);
    order = order.filter((k) => k !== key);
    const i = order.indexOf("g:" + g.id), n = after.get(g.id) || 0;
    order.splice(i >= 0 ? Math.min(i + 1 + n, order.length) : n, 0, key);
    after.set(g.id, n + 1);
  });
  saveGroups(gs); saveOrderKeys(order);
}
const ungroupOne = (key) => takeOut([key]);
// Where reviews can go: each group they are not all in already, a new group of them, out of their groups.
// fromSel: the picked reviews (the selection is done with afterwards), else one review's own menu.
function moveMenu(keys, fromSel){
  const gs = loadGroups(), names = reviewNames(), inG = keys.filter((k) => gs.some((g) => g.keys.includes(k)));
  const what = keys.length > 1 ? `${keys.length} reviews` : names.get(keys[0]) || "Review";
  const done = () => { if (fromSel) homeSel.clear(); renderHome(); };
  const items = [
    ...gs.filter((g) => !keys.every((k) => g.keys.includes(k))).map((g) => ({ label: `Into “${g.name}”`, note: `${g.keys.length} review${g.keys.length > 1 ? "s" : ""}`, fn: () => { moveInto(keys, "g:" + g.id, names); done(); } })),
    keys.length > 1 ? { label: "Into a new group", fn: () => { groupKeys(keys, names); done(); } } : null,
    inG.length ? { label: inG.length > 1 ? "Out of their groups" : "Out of the group", fn: () => { takeOut(inG); done(); } } : null,
  ].filter(Boolean);
  if (!items.length){ toast("No group to move it to yet — drop it onto another review to make one", 2600); return; }
  menu("Move " + what, items);
}
function groupMenu(g){
  menu(g.name, [
    { label: g.open ? "Close the group" : "Open the group", fn: () => setGroup(g.id, { open: !g.open }) },
    { label: "Rename…", fn: async () => { const v = await askText({ title: "Group name", value: g.name }); if (v != null && v.trim()) setGroup(g.id, { name: v.trim() }); } },
    { label: "Picture…", note: "a frame, a picture or a colour", fn: () => groupThumbSheet(g) },
    { label: "Ungroup", fn: () => {
      const all = loadGroups(), cur = all.find((x) => x.id === g.id) || g, gs = all.filter((x) => x.id !== g.id), order = loadOrder(), i = order.indexOf("g:" + g.id);
      if (i >= 0) order.splice(i, 1, ...cur.keys); else order.unshift(...cur.keys);
      saveGroups(gs);
      try { localStorage.setItem("sight-review:order", JSON.stringify(order)); } catch {}
      renderHome();
    } },
  ]);
}
// The group's picture: one of its reviews' pictures / frames kept on the device (a ≤ 200 px copy
// is stored with the group), a plain colour, or Auto (its first four reviews').
const GROUP_COLORS = ["#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#00c7be", "#0a84ff", "#5e5ce6", "#bf5af2", "#ff2d55", "#8e8e93"];
async function groupThumbSheet(g){
  const all = await DB.all("reviews").catch(() => []), byKey = new Map(all.map((m) => [m.key, m]));
  const ms = g.keys.map((k) => byKey.get(k)).filter(Boolean), urls = [];
  sheet((sh, close) => {
    sh.appendChild(el("h2", "", "Group picture"));
    const pick = async (blobOrUrl) => {
      close();
      try {
        let url = blobOrUrl;
        if (typeof url !== "string"){ const im = await decode(blobOrUrl), sc = await scaled(im, 200, 0.8); if (im.close) im.close(); url = await blobToDataUrl(sc.blob); }
        setGroup(g.id, { thumb: { url } });
      } catch { toast("Could not use that picture"); }
    };
    const cols = el("div", "gcols");
    GROUP_COLORS.forEach((c) => { const b = btn("gcol", null, () => { close(); setGroup(g.id, { thumb: { color: c } }); }, "Colour " + c); b.style.background = c; b.dataset.c = c; cols.appendChild(b); });
    sh.appendChild(el("b", "lab", "Colour"));
    sh.appendChild(cols);
    ms.forEach((m) => {
      sh.appendChild(el("b", "lab", m.asset.name || "Review"));
      const row = el("div", "gpics");
      if (m.thumb){ const b = btn("gpic", null, () => pick(m.thumb), "Its picture"); b.style.backgroundImage = `url("${m.thumb}")`; row.appendChild(b); }
      // Its frames / picture cached on the device (the frames its notes are on, among them).
      // (Small previews made one at a time: the cached frames are up to 1600 px each.)
      DB.framesOf(m.key).then(async (fs) => {
        fs.sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
        for (const f of fs.slice(0, 12)){
          if (!row.isConnected) return;
          const b = btn("gpic", null, () => pick(f.blob), "This frame"); b.dataset.frame = f.id; row.appendChild(b);
          try { const im = await decode(f.blob), sc = await scaled(im, 160, 0.75); if (im.close) im.close(); const u = URL.createObjectURL(sc.blob); urls.push(u); b.style.backgroundImage = `url("${u}")`; }
          catch { b.remove(); }
        }
        if (row.isConnected && !row.children.length) row.appendChild(el("span", "", "No pictures on this device yet"));
      }).catch(() => {});
      sh.appendChild(row);
    });
    const a = el("div", "acts");
    a.appendChild(btn("btn", "Auto", () => { close(); setGroup(g.id, { thumb: null }); }));
    a.appendChild(btn("btn primary", "Cancel", close));
    sh.appendChild(a);
  });
  // The frames' blob URLs go with the sheet.
  const watch = setInterval(() => { if (!document.querySelector(".sheet .gpics")){ clearInterval(watch); urls.forEach((u) => URL.revokeObjectURL(u)); } }, 1000);
}
function setGroup(id, ch, quiet){
  const gs = loadGroups(), g = gs.find((x) => x.id === id);
  if (!g) return;
  Object.assign(g, ch);
  saveGroups(gs);
  if (!quiet) renderHome();
}
// A group in the list: its header (a tap opens / closes it; press, hold and drag moves the whole
// group; a hold let go: its menu) over its reviews, which move among themselves.
function groupRow(g, ms){
  const row = reviewRow(null, { g, ms });
  const gm = el("div", "gm");
  ms.forEach((m) => gm.appendChild(reviewRow(m)));
  row.appendChild(gm);
  return row;
}
const TRASH = '<path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13"/>';
// One review in the list: the card over two actions it uncovers — swipe left: the bin (delete),
// swipe right: the eye (hide for now); a tap on the uncovered action does it, a tap on the card or
// elsewhere closes it, a drag the other way closes it too. Press and hold, then drag up / down:
// moves the review in the list (let go without moving: its menu). A mouse: drag sideways = swipe,
// up / down = move. The pointer's end is heard on window (a mouse may leave the card before the
// hold lifts it; a re-render may detach it). A review on its own, moved and held over the middle
// of another one (or a group's header), goes into a group with it when let go there.
// grp: {g, ms} — this is a group's header row instead (no swipe; a tap opens / closes it).
let openRow = null;
// A home tap acts on pointerup; the click it ends with may land on whatever is there by then (the
// selection bar it just brought up, the review it opened): eaten, once, within ghostUntil.
let ghostUntil = 0, lastListScroll = -1e9;
window.addEventListener("scroll", () => { lastListScroll = performance.now(); }, { passive: true, capture: true });
document.addEventListener("click", (e) => { if (performance.now() < ghostUntil){ ghostUntil = 0; e.preventDefault(); e.stopImmediatePropagation(); } }, true);
document.addEventListener("pointerdown", () => { ghostUntil = 0; }, true);  // a new press: its own click counts
function closeOpenRow(except){ if (openRow && openRow !== except){ openRow.shut(); } }
function reviewRow(m, grp){
  if (grp) return groupHead(grp);
  const row = el("div", "row"), it = btn("item", null, null), th = el("span", "th"), tx = el("span", "tx");
  // On a picked review the uncovered actions do it to every picked one (they slid together).
  const hideB = btn("sw hide", null, () => {
    const ks = homeSel.has(m.key) ? pickedInOrder() : [m.key], h = hiddenKeys();
    ks.forEach((k) => h.add(k)); setHidden(h); if (homeSel.has(m.key)) homeSel.clear(); openRow = null; renderHome();
    toast(ks.length > 1 ? `${ks.length} hidden for now — Show under the list brings them back` : "Hidden for now — Show under the list brings it back", 2400);
  }, "Hide for now");
  hideB.innerHTML = ico("eyeoff", 22);
  const delB = btn("sw del", null, async () => {
    row._shut();
    if (!homeSel.has(m.key)){ deleteReview(m); return; }
    const all = await DB.all("reviews").catch(() => []);
    deleteReviews(all.filter((x) => homeSel.has(x.key)));
  }, "Delete this review");
  delB.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${TRASH}</svg>`;
  row.appendChild(hideB); row.appendChild(delB); row.appendChild(it);
  row.dataset.key = m.key;
  row.classList.toggle("sel", homeSel.has(m.key));
  th.title = "Open"; th.setAttribute("aria-label", "Open " + (m.asset.name || "the review"));
  if (m.thumb) th.style.backgroundImage = `url("${m.thumb}")`; else th.textContent = m.asset.kind === "video" ? "VIDEO" : "IMAGE";
  tx.appendChild(el("b", "", m.asset.name || "(no name)"));
  const c = m.counts || {}, info = el("span");
  if (c.notes){
    [["open", c.open], ["progress", c.progress], ["done", c.done]].forEach(([k, v]) => { if (v) info.appendChild(el("i", "dot " + k, String(v))); });
    info.appendChild(document.createTextNode(` ${c.notes} note${c.notes > 1 ? "s" : ""}`));
  } else info.appendChild(document.createTextNode("No notes"));
  info.appendChild(document.createTextNode(" · " + fmtDate(m.updated)));
  tx.appendChild(info);
  tx.appendChild(el("span", "", m.kept ? "File kept on this device" : fmtBytes(m.asset.size) + (m.asset.kind === "video" ? " video" : " picture")));
  it.appendChild(th); it.appendChild(tx);
  return rowGestures(row, it, { open: () => toggleSel(m.key, row), thumb: () => { homeSel.clear(); openReview(m.key, null); }, menu: () => reviewMenu(m), name: m.asset.name });
}
// Reviews picked on the home screen (a tap on a review; its picture opens it): the bar at the
// foot moves / hides / deletes them all at once; held and dragged, a picked review takes the others.
const homeSel = new Set();
function toggleSel(key, row){
  if (homeSel.has(key)) homeSel.delete(key); else homeSel.add(key);
  if (row) row.classList.toggle("sel", homeSel.has(key));
  paintSelBar();
}
function paintSelBar(){
  let bar = root.querySelector(":scope > .selbar");
  if (!homeSel.size || !root.classList.contains("home")){ if (bar) bar.remove(); root.classList.remove("selecting"); return; }
  if (!bar){ bar = el("div", "selbar"); root.appendChild(bar); }
  root.classList.add("selecting");
  bar.textContent = "";
  const keys = () => pickedInOrder();
  bar.appendChild(btn("ib", "×", () => { homeSel.clear(); document.querySelectorAll(".list .row.sel").forEach((r) => r.classList.remove("sel")); paintSelBar(); }, "Clear the selection"));
  bar.appendChild(el("span", "", `${homeSel.size} selected`));
  bar.appendChild(btn("btn primary", "Move to…", () => moveMenu(pickedInOrder(), true)));
  bar.appendChild(btn("btn", "Hide", () => { const h = hiddenKeys(); keys().forEach((k) => h.add(k)); setHidden(h); homeSel.clear(); renderHome(); toast("Hidden for now — Show under the list brings them back", 2400); }));
  const del = btn("ib danger", null, async () => { const all = await DB.all("reviews").catch(() => []); deleteReviews(all.filter((m) => homeSel.has(m.key))); }, "Delete the selected reviews");
  del.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${TRASH}</svg>`;
  bar.appendChild(del);
}
// A group's header: up to four of its pictures, the name, how many reviews and their notes.
function groupHead({ g, ms }){
  const row = el("div", "row group" + (g.open ? "" : " shut")), it = btn("item", null, null), th = el("span", "th four"), tx = el("span", "tx");
  row.dataset.key = "g:" + g.id;
  const tb = g.thumb;
  if (tb && tb.url){ th.className = "th"; th.style.backgroundImage = `url("${tb.url}")`; }
  else if (tb && tb.color){ th.className = "th tint"; th.style.background = tb.color; th.textContent = (g.name || "G").trim().charAt(0).toUpperCase(); }
  else ms.slice(0, 4).forEach((m) => { const q = el("i"); if (m.thumb) q.style.backgroundImage = `url("${m.thumb}")`; th.appendChild(q); });
  tx.appendChild(el("b", "", g.name));
  // Every state over all its reviews' notes, as a review's row shows them.
  const sum = (k) => ms.reduce((a, m) => a + ((m.counts && m.counts[k]) || 0), 0), n = sum("notes");
  const info = el("span");
  [["open", sum("open")], ["progress", sum("progress")], ["done", sum("done")]].forEach(([k, v]) => { if (v) info.appendChild(el("i", "dot " + k, String(v))); });
  info.appendChild(document.createTextNode(` ${ms.length} review${ms.length > 1 ? "s" : ""} · ${n ? n + " note" + (n > 1 ? "s" : "") : "no notes"}`));
  tx.appendChild(info);
  const chev = el("span", "chev"); chev.innerHTML = ico("back", 18);
  it.appendChild(th); it.appendChild(tx); it.appendChild(chev);
  row.appendChild(it);
  return rowGestures(row, it, { group: true, name: g.name,
    open: () => { g.open = !g.open; row.classList.toggle("shut", !g.open); setGroup(g.id, { open: g.open }, true); },
    menu: () => groupMenu(g) });
}
// Swipe / hold-to-move / tap / menu on a list row (a review, or a group's header: o.group).
function rowGestures(row, it, o){
  const W = 84;  // how far a swiped card stays open
  let off = 0;
  const place = (x, anim) => {
    off = x;
    it.style.transition = anim ? "transform .2s ease-out" : "";
    it.style.transform = x ? `translateX(${x}px)` : "";
    row.classList.toggle("l", x > 0); row.classList.toggle("r", x < 0);
  };
  // A picked review slides with the other picked ones (each placed the same way).
  const peers = () => homeSel.has(row.dataset.key) ? [...document.querySelectorAll(".list .row.sel")].filter((r) => r !== row && r._place) : [];
  const placeAll = (x, anim) => { place(x, anim); peers().forEach((r) => r._place(x, anim)); };
  function shut(){ placeAll(0, true); if (openRow === ctl) openRow = null; }
  row._place = place;
  const ctl = { shut, row };
  // st: the pointer in play; mode: null | "swipe" | "move"; eatUntil: the click a gesture ends with
  // is not a tap; menuT: the menu of a hold let go without moving, opened by that click (or a
  // moment later when none comes) — opened on pointerup, the click would land on the sheet's
  // backdrop and close it at once.
  let st = null, lp = null, mode = null, eatUntil = 0, ghost = null, scrollT = null, menuT = null;
  row._shut = shut;
  const lift = () => {
    if (!st || mode) return;
    if (st.mouse && st.buttons === 0){ end(); return; }  // the button went up off the card
    mode = "move";
    closeOpenRow(); place(0);
    if (navigator.vibrate) try { navigator.vibrate(12); } catch {}
    const r = it.getBoundingClientRect();
    ghost = it.cloneNode(true); ghost.classList.add("ghost");
    Object.assign(ghost.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px" });
    st.gy = r.top - st.y;
    document.body.appendChild(ghost);
    row.classList.add("lifted");
    if (o.group) row.classList.add("folded");  // a group moves as its header (its reviews tucked in)
    try { it.setPointerCapture(st.id); } catch {}  // a mouse held still, then moved off the card
    // The rows' places when lifted (page px); while moving, the DOM stays as it is (moving the held
    // card's row would drop its pointer capture) — the other rows slide out of the way instead.
    st.rows = [...row.parentNode.querySelectorAll(":scope > .row")];
    st.idx = st.rows.indexOf(row);
    st.mids = st.rows.map((x) => { const b = x.getBoundingClientRect(); return b.top + scrollY + b.height / 2; });
    st.H = row.offsetHeight + 8;  // the others slide by the held row's height (+ the gap)
    st.to = st.idx;
    // A review (on its own or in a group) can go onto another row: a review on its own → a group
    // with it, a group's header or one of its reviews → into that group. Not onto its own group, nor
    // onto reviews picked with it (they all go together).
    const ownG = row.parentNode && row.parentNode.classList.contains("gm") ? row.parentNode.parentNode : null;
    const going = homeSel.has(row.dataset.key) ? homeSel : new Set([row.dataset.key]);
    st.targets = o.group ? [] : [...document.querySelectorAll(".list .row[data-key]")].filter((x) => x !== row && x !== ownG && !(ownG && x.parentNode === ownG.querySelector(":scope > .gm")) &&
      !going.has(x.dataset.key) && x.offsetParent !== null);
  };
  // While moving: the place the ghost's middle has reached; the rows between slide by one; near
  // the screen's top / bottom the page scrolls.
  const moveTo = (y) => {
    ghost.style.top = y + st.gy + "px";
    const mid = y + st.gy + it.offsetHeight / 2 + scrollY;
    // Over the middle part of another row (where it is drawn now): that row is the drop target, the
    // rows stay where they are.
    let drop = null;
    st.targets.forEach((x) => {
      const b = (x.querySelector(":scope > .item") || x).getBoundingClientRect(), c = b.top + scrollY + b.height / 2;
      if (Math.abs(c - mid) < b.height * 0.26) drop = x;
    });
    if (st.drop !== drop){ if (st.drop) st.drop.classList.remove("drop"); st.drop = drop; if (drop) drop.classList.add("drop"); }
    st.lastY = y;
    if (drop){ clearInterval(scrollT); return; }
    let to = 0;
    st.rows.forEach((x, i) => { if (i !== st.idx && st.mids[i] < mid) to++; });
    st.to = to;
    st.rows.forEach((x, i) => {
      let k = i === st.idx ? to : i < st.idx ? i : i - 1;  // its index among the others
      if (i !== st.idx && k >= to) k++;
      x.style.transition = "transform .15s";
      x.style.transform = i === st.idx || k === i ? "" : `translateY(${k > i ? st.H : -st.H}px)`;
    });
    clearInterval(scrollT);
    const edge = y < 90 ? -1 : y > innerHeight - 90 ? 1 : 0;
    if (edge) scrollT = setInterval(() => { if (!st || !ghost){ clearInterval(scrollT); return; } scrollBy(0, edge * 8); moveTo(st.lastY); }, 16);
  };
  // keep: the new place counts (a release after moving); else the rows go back as they were.
  const end = (keep) => {
    clearTimeout(lp); lp = null; clearInterval(scrollT);
    window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onCancel);
    if (ghost) ghost.remove();
    ghost = null;
    let movedRow = false;
    if (st && st.drop){
      // Let go on another row: grouped with it (the list is drawn again).
      st.drop.classList.remove("drop");
      const on = st.drop.dataset.key, key = row.dataset.key;
      st.rows.forEach((x) => { x.style.transition = ""; x.style.transform = ""; });
      row.classList.remove("lifted", "folded");
      if (mode) eatUntil = performance.now() + 600;
      st = null; mode = null;
      if (keep && on && key){
        // A picked review takes the others picked with it (in the list's order).
        const keys = homeSel.has(key) ? pickedInOrder() : [key];
        moveInto(keys, on, reviewNames());
        if (homeSel.has(key)) homeSel.clear();
        renderHome();
      }
      return false;
    }
    if (st && st.rows){
      st.rows.forEach((x) => { x.style.transition = ""; x.style.transform = ""; });
      const others = st.rows.filter((x) => x !== row), list = row.parentNode;
      if (keep && st.to !== st.idx && list && row.isConnected){
        if (st.to < others.length) list.insertBefore(row, others[st.to]); else others[others.length - 1].after(row);
        movedRow = true;
      }
    }
    row.classList.remove("lifted", "folded");
    if (mode) eatUntil = performance.now() + 600;
    st = null; mode = null;
    return movedRow;
  };
  // A plain tap acts as the finger lifts (not on the click after it: a click can get lost when the
  // page changes under the finger — after a swipe back from a review, or going full screen on that
  // tap); the click that follows is eaten.
  const tapAct = (onThumb) => {
    if (off){ shut(); return; }
    if (onThumb && o.thumb) o.thumb(); else o.open();
  };
  const onUp = (e) => {
    if (!st || e.pointerId !== st.id) return;
    const m0 = mode, moved = st.moved;
    if (!m0 && e.type === "pointerup" && (!st.mouse || e.button === 0)){
      // A touch that stopped a fling (the list was scrolling just before, or moved under it) is no tap.
      const th = st.thumb, fling = !st.mouse && (st.downAt - lastListScroll < 150 || Math.abs(scrollY - st.sy) > 2);
      end(false);
      eatUntil = performance.now() + 700;
      ghostUntil = performance.now() + 500;  // the click this tap ends with: eaten wherever it lands
      if (fling) return;
      tapAct(th);
      return;
    }
    if (m0 === "swipe"){
      const x = off;
      end();
      if (x <= -W * 0.6){ placeAll(-W, true); openRow = ctl; }
      else if (x >= W * 0.6){ placeAll(W, true); openRow = ctl; }
      else shut();
      return;
    }
    if (m0 === "move" && !moved){
      end(false);
      menuT = setTimeout(() => { menuT = null; if (row.isConnected) o.menu(); }, 350);
      return;
    }
    if (end(m0 === "move") && row.parentNode){
      const box = row.parentNode, keys = [...box.querySelectorAll(":scope > .row")].map((x) => x.dataset.key);
      // Inside a group: the group's own order; else the list's.
      const gr = box.classList.contains("gm") && box.parentNode.dataset.key;
      if (gr){
        // Into the slots the shown members had: hidden ones keep theirs.
        const id = gr.slice(2), g = loadGroups().find((x) => x.id === id);
        if (g){ const q = keys.slice(), vis = new Set(keys); setGroup(id, { keys: g.keys.map((k) => vis.has(k) ? q.shift() : k).concat(q) }, true); }
      }
      else saveOrder(keys);
    }
  };
  const onCancel = (e) => { if (!st || e.pointerId !== st.id) return; if (mode === "swipe") shut(); end(false); };
  let lastType = "mouse", downAt = 0;
  it.addEventListener("pointerdown", (e) => {
    lastType = e.pointerType; downAt = performance.now();
    if (st || (e.pointerType === "mouse" && e.button !== 0)) return;  // a second finger: ignored
    eatUntil = 0;
    closeOpenRow(ctl);
    st = { id: e.pointerId, x: e.clientX, y: e.clientY, off, moved: false, mouse: e.pointerType === "mouse", buttons: e.buttons, thumb: !!(e.target.closest && e.target.closest(".th")), sy: scrollY, downAt: performance.now() };
    window.addEventListener("pointerup", onUp); window.addEventListener("pointercancel", onCancel);
    lp = setTimeout(lift, 420);
  });
  it.addEventListener("pointermove", (e) => {
    if (!st || e.pointerId !== st.id) return;
    st.buttons = e.buttons;
    const dx = e.clientX - st.x, dy = e.clientY - st.y, far = Math.abs(dx) + Math.abs(dy) > 8;
    if (!mode){
      if (!far) return;
      clearTimeout(lp);
      if (Math.abs(dx) > Math.abs(dy)){ if (o.group){ end(); eatUntil = performance.now() + 350; return; } mode = "swipe"; try { it.setPointerCapture(e.pointerId); } catch {} }
      else if (st.mouse) lift();
      else { end(); return; }  // a finger moving up / down before the hold: the list scrolls
    }
    if (mode === "swipe"){
      let x = st.off + dx;
      if (Math.abs(x) > W) x = Math.sign(x) * (W + (Math.abs(x) - W) * 0.3);  // past the action: resists
      placeAll(x);
      return;
    }
    // Moving starts only past the jitter of a finger held for the menu (and only then scrolls).
    if (!st.moved && !far) return;
    st.moved = true;
    moveTo(e.clientY);
  });
  // A lifted / swiped card does not scroll the page under the finger.
  it.addEventListener("touchmove", (e) => { if (mode) e.preventDefault(); }, { passive: false });
  // A tap picks the review (its picture: opens it; a group's header: opens / closes the group) — or,
  // on a card swiped open, closes it. Acted on as the finger lifts (tapAct); a click with no
  // pointer before it (the keyboard) acts here.
  it.addEventListener("click", (e) => {
    if (menuT){ clearTimeout(menuT); menuT = null; e.preventDefault(); o.menu(); return; }
    if (performance.now() < eatUntil){ e.stopImmediatePropagation(); e.preventDefault(); eatUntil = 0; return; }
    tapAct(!!(e.target.closest && e.target.closest(".th")));
  });
  // A mouse's right click is the browser's own menu (the app does not take it on a desktop). The menu
  // key and a touch's long press open ours; a touch's long press is the lift above, not a menu.
  it.addEventListener("contextmenu", (e) => {
    if (lastType === "mouse" && (e.button === 2 || e.ctrlKey)) return;  // a mouse's right / Ctrl click
    e.preventDefault();
    if (st || mode || menuT || (lastType !== "mouse" && e.button !== 2 && performance.now() - downAt < 1500)) return;
    o.menu();
  });
  return row;
}
// Every review's name by key, the ones in closed groups too (from the rows' titles).
function reviewNames(){
  const out = rowNames();
  loadGroups().forEach((g) => g.keys.forEach((k) => { if (!out.has(k)){ const r = document.querySelector(`.list .row[data-key="${k}"] .tx b`); if (r) out.set(k, r.textContent); } }));
  return out;
}
// Each row's review name by key (a new group is named after the two).
function rowNames(){
  const out = new Map();
  document.querySelectorAll(".list .row[data-key]").forEach((r) => { const b = r.querySelector(":scope > .item .tx b"); if (b) out.set(r.dataset.key, b.textContent); });
  return out;
}
function reviewMenu(m){
  const inG = loadGroups().some((g) => g.keys.includes(m.key));
  menu(m.asset.name, [{ label: "Open", fn: () => openReview(m.key, null) },
    { label: homeSel.has(m.key) ? "Unselect" : "Select", fn: () => toggleSel(m.key, document.querySelector(`.list .row[data-key="${m.key}"]`)) },
    { label: "Move to…", fn: () => moveMenu([m.key], false) },
    inG ? { label: "Take out of the group", fn: () => { ungroupOne(m.key); renderHome(); } } : null,
    { label: "Hide for now", fn: () => { const h = hiddenKeys(); h.add(m.key); setHidden(h); renderHome(); } },
    { label: "Delete this review…", danger: true, fn: () => deleteReview(m) }]);
}
// A tap outside a swiped-open card closes it (on the card itself, the card's own tap does).
document.addEventListener("pointerdown", (e) => {
  if (!openRow || !e.target.closest) return;
  if (e.target.closest(".row .sw") || e.target.closest(".row") === openRow.row) return;
  closeOpenRow();
}, true);
const deleteReview = (m) => deleteReviews([m]);
async function deleteReviews(ms){
  if (!ms.length) return;
  const one = ms.length === 1;
  if (!await ask({ title: one ? "Delete this review?" : `Delete ${ms.length} reviews?`, text: (one ? `“${ms[0].asset.name}”: its` : "Their") + " notes, replies, drawings and pictures on this device. Export a .srev first to keep them.", ok: "Delete", danger: true })) return;
  await flush();
  const gone = new Set(ms.map((m) => m.key));
  try { for (const m of ms){
    const mine = (await DB.get("rows", m.key)) || { rows: [] }, shared = new Set();
    for (const o of await DB.all("reviews")){
      if (o.key === m.key) continue;
      const rr = await DB.get("rows", o.key);
      if (rr) M.shotIds(rr.rows).forEach((s) => shared.add(s));
    }
    await DB.deleteReview(m.key, M.shotIds(mine.rows), shared);
    if (R && R.meta.key === m.key){ closeReview(); history.replaceState(null, "", location.pathname + location.search); }
  } } catch (e){ toast("Could not delete every review: " + (e.message || e), 4000); }
  gone.forEach((k) => homeSel.delete(k));
  renderHome();
}

async function settings(){
  const u = await DB.usage();
  sheet((sh, close) => {
    sh.appendChild(el("h2", "", "Settings"));
    const kv = el("div", "kv");
    const row = (k, v) => { kv.appendChild(el("b", "", k)); kv.appendChild(el("span", "", v)); };
    row("Your name", who || "—");
    if (u) row("Storage", `${fmtBytes(u.used)} used${u.quota ? " of " + fmtBytes(u.quota) : ""}${u.persisted ? " · kept" : ""}`);
    row("Version", VERSION);
    sh.appendChild(kv);
    const th = el("div", "seg themes");
    const paintTh = () => th.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.t === theme));
    Object.entries(THEMES).forEach(([k, label]) => { const b = btn("", label, () => { setTheme(k); paintTh(); }); b.dataset.t = k; th.appendChild(b); });
    sh.appendChild(el("b", "lab", "Theme"));
    sh.appendChild(th); paintTh();
    sh.appendChild(el("b", "lab", "Pictures in a row"));
    const tr = el("div", "seg thumbs");
    const paintTr = () => tr.querySelectorAll("button").forEach((b) => b.classList.toggle("on", Number(b.dataset.n) === thumbsRow));
    THUMBS.forEach((n) => { const b = btn("", String(n), () => { setThumbs(n); paintTr(); }); b.dataset.n = String(n); tr.appendChild(b); });
    sh.appendChild(tr); paintTr();
    sh.appendChild(el("b", "lab", "Full screen"));
    if (fsCan()){
      const fs = el("div", "seg fs");
      const paintFs = () => fs.querySelectorAll("button").forEach((b) => b.classList.toggle("on", (b.dataset.v === "1") === fsAuto));
      [["1", "Auto"], ["0", "Off"]].forEach(([v, label]) => { const b = btn("", label, () => { setFsAuto(v === "1"); paintFs(); }); b.dataset.v = v; fs.appendChild(b); });
      sh.appendChild(fs); paintFs();
      sh.appendChild(el("p", "", "Auto: the app goes full screen at your first tap, and again after you leave it."));
    } else sh.appendChild(el("p", "", isStandalone() ? "The installed app is full screen already." : isIOS() ? "Safari on iPhone / iPad does not keep a page full screen. Add the app to the Home Screen: it then runs full screen." : "This browser cannot show a page full screen. Add the app to the Home Screen: it then runs full screen."));
    if (u && !u.persisted) sh.appendChild(el("p", "", "The browser may clear the reviews when the device runs low on space. Installing the app (Add to Home Screen) and allowing storage below keeps them."));
    const a = el("div", "acts");
    a.appendChild(btn("btn", "Change name", async () => { close(); await setName(); }));
    if (u && !u.persisted) a.appendChild(btn("btn", "Keep storage", async () => { close(); toast(await DB.persist() ? "Storage will be kept" : "The browser did not allow it (install the app first)", 3500); }));
    a.appendChild(btn("btn primary", "Done", close));
    sh.appendChild(a);
  });
}

function closeReview(){
  if (!R) return;
  flush();
  if (R.video){ R.video.pause(); R.video.removeAttribute("src"); R.video.load(); }
  if (R.grab) R.grab.close();
  if (R.scrub) R.scrub.close();
  if (R.url) URL.revokeObjectURL(R.url);
  R.frames.forEach((f) => URL.revokeObjectURL(f.url));
  R.shotUrls.forEach((u) => URL.revokeObjectURL(u));
  R.drafts && Object.values(R.drafts).forEach((d) => d.shots.forEach((s) => URL.revokeObjectURL(s.url)));
  TPS.clear();
  R = null;
  els = null;
  root.style.removeProperty("--nbh");
}

// Only the latest open counts: a second tap while the first review is still loading wins, and the
// first one stops at its next step (each open has its own `rv`, nothing writes through `R` late).
let openSeq = 0;
async function openReview(key, file, fromRoute){
  const seq = ++openSeq;
  fsArm();
  await flush();
  const meta = await DB.get("reviews", key);
  if (seq !== openSeq) return;
  if (!meta){ if (fromRoute){ history.replaceState(null, "", location.pathname); renderHome(); } else toast("This review is not on the device any more"); return; }
  const rr = await DB.get("rows", key);
  // A file picked before is kept on the device (autoKeep), so the review opens with it; without
  // one the stage asks for the file.
  const picked = !!file;
  if (!file){
    const kept = await DB.get("files", key).catch(() => null);
    if (kept) file = kept.blob;
    meta.kept = !!kept;  // what is really stored wins over the flag (a stale write may have reset it)
  }
  if (seq !== openSeq) return;
  closeReview();
  const rv = R = { meta, rows: rr ? rr.rows : [], file: null, url: null, video: null, grab: null, fps: meta.fps || 25, fpsKnown: !!meta.fps,
    frames: new Map(), shotUrls: new Map(), drafts: {}, openReply: {}, newOpen: false, replyTo: null, curNote: null, filter: "all", hide: false, scrubT: null, want: null, dragging: false, panel: false, cacheF: 0, drawS: null, pv: PV0(), rate: 1, hasAudio: typeof meta.audio === "boolean" ? meta.audio : null, audioSure: typeof meta.audio === "boolean" };
  if (file) await bindFile(rv, file);
  if (R !== rv) return;
  meta.opened = now();
  DB.put("reviews", meta).catch(() => {});
  if (!fromRoute && location.hash !== "#r=" + key){ history.pushState(null, "", "#r=" + key); rv.pushed = true; }
  renderReview();
  if (picked && rv.file) autoKeep(rv);
}
// Keeps the picked file in the app (IndexedDB "files") so the review opens with it next time — the
// phone gives a web app no lasting access to a picked file. Not when the user said to forget it
// (noKeep) or the device is short of room; then the review asks for the file again. The stored
// entry is changed by key in one transaction (store.js keepFile / dropFile), never by putting a
// meta object that may be stale; the open review's own meta follows.
const sameKey = (key) => (R && R.meta.key === key ? R : null);
async function autoKeep(rv, replace){
  const key = rv.meta.key, f = rv.file;
  if (rv.meta.noKeep || !f) return;
  let cur = null;
  if (rv.meta.kept){
    cur = await DB.get("files", key).catch(() => null);
    if (cur && cur.blob && cur.blob.size === f.size && !replace) return;
  }
  let ok = false, why = null;
  try {
    const e = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
    const used = (e && e.usage || 0) - (cur && cur.blob ? cur.blob.size : 0);  // a replaced copy frees its room
    if (e && e.quota && used + f.size > e.quota * 0.9) throw new Error("not enough room on this device");
    ok = await DB.keepFile(key, f);
    if (ok) DB.persist();
  } catch (e){
    console.warn("keep", e);
    why = e.message || String(e);
    // A copy that could not be replaced is not the file in use any more: drop it.
    if (replace) await DB.dropFile(key, false).catch(() => {});
  }
  const live = sameKey(key);
  if (live){
    if (ok){ live.meta.kept = true; live.keepFailed = null; }
    else if (why){ if (replace) live.meta.kept = false; live.keepFailed = why; }
    if (els) paintKeep();
  }
}

async function bindFile(rv, file){
  rv.file = file;
  rv.url = URL.createObjectURL(file);
  const a = rv.meta.asset;
  if (a.kind === "video") rv.grab = new Grabber(rv.url);
  try {
    // Doc units are the picture as shown, rotation (EXIF, video matrix) applied: the file's own
    // size wins over a stored one (Sight stores the unrotated pixel size of a rotated JPEG, while
    // its editor draws in the shown size); a review from Sight may also lack sizes.
    const info = a.kind === "image" ? await probeImage(rv.url) : await probeVideo(rv.url, null);
    if (info.w && info.h){ a.width = info.w; a.height = info.h; }
    if (a.kind === "video") a.duration = a.duration || info.duration || null;
    if (a.kind === "video" && (!rv.fpsKnown || rv.meta.audio == null)){
      const f = await videoFps(file);
      if (f && !rv.fpsKnown){ rv.fps = f.fps; rv.fpsKnown = true; rv.meta.fps = f.fps; }
      if (f && typeof f.audio === "boolean" && R === rv) setAudio(f.audio);
    }
  } catch (e){ console.warn(e); }
  if (R !== rv) return;
  if (!rv.meta.thumb){
    (async () => {
      let s;
      if (a.kind === "image"){ const im = await decode(file); s = await scaled(im, 200, 0.8); if (im.close) im.close(); }
      else s = await rv.grab.grab(Math.min(1, (a.duration || 2) / 3), 200);
      rv.meta.thumb = await blobToDataUrl(s.blob);
      putIfAlive(rv, "reviews", rv.meta);
    })().catch((e) => console.warn("thumb", e));
  }
  if (a.kind === "image") getPicture(rv);
}

// ---- review screen -----------------------------------------------------------------------------
// The player fills the screen, with the review's controls in a header over the picture and the
// transport over its foot (on the canvas' floating bar, .rd-panel). Under it the thin Notes Panel bar: a tap (or a
// swipe up, on it or on the picture) slides the player, same size, up off the screen and the notes
// in; the bar then holds the status filters, and pulling the list down from its top note goes back
// to the player (bindPanelPull). The new-note bar shows only with the panel open, or while a new
// note is being written (then the player makes room for it).
let els = null;  // the review screen's parts
let nbRO = null;
function renderReview(){
  const a = R.meta.asset;
  document.title = a.name + " — Sight Review";
  root.textContent = ""; root.className = "review" + (R.panel ? " open" : "");
  const slide = el("div", "slide"), player = el("div", "player"), stage = el("div", "stage");
  const hdr = el("header", "hdr rd-panel"), r1 = el("div", "row"), r2 = el("div", "row"), ttl = el("div", "ttl");
  ttl.appendChild(el("b", "", a.name));
  const sub = el("span");
  ttl.appendChild(sub);
  r1.appendChild(ibtn("back", "All reviews", leaveReview));
  r1.appendChild(ttl);
  r1.appendChild(ibtn("more", "Export and more", reviewActions));
  hdr.appendChild(r1); hdr.appendChild(r2);
  const tp = el("div", "tp rd-panel");
  player.appendChild(stage); player.appendChild(hdr); player.appendChild(tp);
  const pbar = el("div", "pbar"), plist = el("div", "plist"), keep = el("div", "keep"), notes = el("div", "notes");
  plist.appendChild(keep); plist.appendChild(notes);
  slide.appendChild(player); slide.appendChild(pbar); slide.appendChild(plist);
  root.appendChild(slide);
  const newbar = el("footer", "newbar"), nb = el("div");
  newbar.appendChild(nb);
  root.appendChild(newbar);
  els = { sub, stage, tools: r2, tp, pbar, plist, keep, notes, nb, newbar, svg: null, T: null };
  // The player's height leaves room for the new-note bar, whatever it holds.
  if (!nbRO) nbRO = new ResizeObserver(() => { if (els && els.newbar.isConnected) root.style.setProperty("--nbh", els.newbar.offsetHeight + "px"); });
  nbRO.disconnect(); nbRO.observe(newbar);
  bindPanelBar(pbar);
  bindPanelPull(plist, pbar);
  buildStage();
  paintReview();
}
function leaveReview(){
  if (R && R.pushed) history.back();
  else { closeReview(); history.replaceState(null, "", location.pathname + location.search); renderHome(); }
}
function setPanel(open){
  if (!R || !els) return;
  R.panel = !!open;
  // The player slides off the screen: a playing clip stops where it is (paused, not rewound — the
  // list then marks the note on that frame), it must not run on unseen.
  if (R.panel && R.video && !R.video.paused) R.video.pause();
  root.classList.toggle("open", R.panel);
  paintPanelBar();
}
function paintPanelBar(){
  const pb = els.pbar;
  pb.textContent = "";
  if (!R.panel){
    pb.title = "Show the notes";
    pb.appendChild(el("i", "grip"));
    pb.appendChild(el("span", "lbl", "Notes Panel"));
    return;
  }
  pb.title = "";
  const seg = el("div", "seg");
  paintSeg(seg, M.counts(R.rows));
  pb.appendChild(seg);
}
function bindPanelBar(pb){
  let y0 = null;
  pb.addEventListener("pointerdown", (e) => { y0 = R && !R.panel ? e.clientY : null; });
  pb.addEventListener("pointermove", (e) => { if (y0 != null && y0 - e.clientY > 24){ y0 = null; setPanel(true); } });
  pb.addEventListener("click", (e) => { if (R && !R.panel && !e.target.closest("button")) setPanel(true); });
}
// The status filters in the panel's order; a swipe sideways on the list (or the filter bar) steps
// through them: left = the next one (All → Open → In progress → Resolved), right = back.
const FILTERS = ["all", "open", "progress", "done"];
function stepFilter(dir){
  const i = FILTERS.indexOf(R.filter), j = RC.clamp(i + dir, 0, FILTERS.length - 1);
  if (j === i) return;
  R.filter = FILTERS[j];
  paintReview();
  const n = els && els.notes;
  if (n && n.animate) n.animate([{ transform: `translateX(${dir * 40}px)`, opacity: 0.3 }, { transform: "none", opacity: 1 }], { duration: 200, easing: "ease-out" });
}
// Back to the player: pulling the list down when it is already at its top note (a finger that
// started there, so a fling that just reached the top does not close it), on the list or on the
// filter bar; with a mouse / trackpad, scrolling up on at the top.
function bindPanelPull(plist, pb){
  let s = null, side = null;
  const startAt = (e, top) => {
    s = R && R.panel && e.touches.length === 1 && top ? { y: e.touches[0].clientY, x: e.touches[0].clientX } : null;
    // Sideways: the filters (not from a text field, where a finger selects text).
    const tg = e.target && e.target.closest ? e.target : null;
    side = R && R.panel && e.touches.length === 1 && !(tg && tg.closest("textarea, input, .cmp")) ? { y: e.touches[0].clientY, x: e.touches[0].clientX } : null;
  };
  plist.addEventListener("touchstart", (e) => startAt(e, plist.scrollTop <= 0), { passive: true });
  pb.addEventListener("touchstart", (e) => startAt(e, true), { passive: true });
  const move = (e) => {
    if (side){
      if (e.touches.length !== 1){ side = null; }
      else {
        const dx = e.touches[0].clientX - side.x, dy = e.touches[0].clientY - side.y;
        if (Math.abs(dy) > 24 && Math.abs(dy) > Math.abs(dx)) side = null;  // scrolling
        else if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2){ side = null; s = null; stepFilter(dx < 0 ? 1 : -1); return; }
      }
    }
    if (!s) return;
    if (e.touches.length !== 1 || plist.scrollTop > 0){ s = null; return; }
    const dy = e.touches[0].clientY - s.y, dx = e.touches[0].clientX - s.x;
    if (dy < -10 || Math.abs(dx) > Math.max(30, dy)){ s = null; return; }  // scrolling on, or sideways
    if (dy > 60){ s = null; setPanel(false); }
  };
  plist.addEventListener("touchmove", move, { passive: true });
  pb.addEventListener("touchmove", move, { passive: true });
  const end = () => { s = null; side = null; };
  ["touchend", "touchcancel"].forEach((ev) => { plist.addEventListener(ev, end); pb.addEventListener(ev, end); });
  let lastScroll = 0, pull = 0;
  plist.addEventListener("scroll", () => { lastScroll = performance.now(); pull = 0; }, { passive: true });
  plist.addEventListener("wheel", (e) => {
    // (Well after the last scroll: a trackpad fling that reached the top keeps sending wheel events.)
    if (!R || !R.panel || plist.scrollTop > 0 || e.deltaY >= 0 || performance.now() - lastScroll < 700){ if (performance.now() - lastScroll < 700) lastScroll = performance.now(); pull = 0; return; }
    pull += e.deltaY * (e.deltaMode === 1 ? 30 : 1);
    if (pull < -160){ pull = 0; setPanel(false); }
  }, { passive: true });
}

function overlay(vb, list, cls){
  const s = document.createElementNS(SVGNS, "svg");
  s.setAttribute("viewBox", vb.join(" "));
  // cover: a thumbnail cut to fill its box (the picture is object-fit: cover, cut the same way).
  s.setAttribute("preserveAspectRatio", cls === "stage" ? "xMidYMid meet" : cls === "cover" ? "xMidYMid slice" : "none");
  s.innerHTML = RC.svgMarkup(list, numOf);
  return s;
}
// A draft's drawing: the frame it was made on, plus (video) more frames of the same note.
const drawFrames = (draw) => draw ? [{ frame: draw.frame, items: draw.items }].concat(draw.more || []) : [];
// What shows on the main picture right now.
// While a new note is open the picture is clean: only that note's own drawing shows (on its frames).
function stageDrawings(){
  if (R.hide) return [];
  // The frame on screen, by the rule drawings are stored with (frameStart): a timeline scrub lands mid-frame,
  // and the raw time would hide that frame's drawings until the time moved again.
  const v = R.video, at = kindNow() === "video" ? (v ? { t: frameStart(R.scrubT != null ? R.scrubT : v.currentTime), fps: R.fps } : null) : null;
  if (kindNow() === "video" && !at) return [];
  if (R.newOpen || R.replyTo){
    const d = R.drafts[composeKey()];
    const mine = drawFrames(d && d.draw).filter((x) => !at || RC.ctxVisible(x.frame.ctx, at)).flatMap((x) => x.items);
    // A reply: over the note's own drawings (and its earlier replies'), the rest of the review off.
    const theirs = R.replyTo ? M.drawings(R.rows).filter((r) => r.data.note === R.replyTo && (!at || RC.ctxVisible(r.data.ctx, at))) : [];
    return theirs.concat(mine);
  }
  const all = M.drawings(R.rows);
  return at ? all.filter((it) => RC.ctxVisible(it.data.ctx, at)) : all;
}
function paintOverlay(){
  if (!els || !els.svg) return;
  els.svg.setAttribute("viewBox", [0, 0, docW() || 1, docH() || 1].join(" "));
  els.svg.innerHTML = RC.svgMarkup(stageDrawings(), numOf);
}
// The view's turn (0 / 90 / 180 / 270°) and mirror, kept with the review (R.meta.view): the stage,
// the full-screen viewer and the drawing canvas show the picture that way. View only — drawings
// stay in the picture's own pixels.
// No turn button since 0.33 (a two-finger turn is the player's own view, not kept): a quarter turn
// stored by an older version is dropped, the mirror kept.
const viewOf = () => ({ rot: 0, mirror: !!(R.meta.view && R.meta.view.mirror) });
// Places an element showing the whole picture (object-fit: contain) turned / mirrored in a W × H box.
function turnEl(n, W, H, vw){
  const side = vw.rot % 180 !== 0, tf = (vw.rot ? `rotate(${vw.rot}deg) ` : "") + (vw.mirror ? "scaleX(-1)" : "");
  Object.assign(n.style, side ? { width: H + "px", height: W + "px", left: (W - H) / 2 + "px", top: (H - W) / 2 + "px" } : { width: "", height: "", left: "", top: "" });
  n.style.transform = tf;
}
function applyStageView(){
  if (!els || !els.stage) return;
  const st = els.stage, W = st.clientWidth, H = st.clientHeight, vw = viewOf();
  st.querySelectorAll(":scope > .sv > img, :scope > .sv > video, :scope > .sv > svg").forEach((n) => turnEl(n, W, H, vw));
  if (els.penB) els.penB.style.bottom = ((els.tp && !els.tp.hidden ? els.tp.offsetHeight + 8 : 0) + 14) + "px";
  applyPlayerView();
}
function setView(vw){
  R.meta.view = { rot: ((vw.rot % 360) + 360) % 360, mirror: !!vw.mirror };
  putIfAlive(R, "reviews", R.meta);
  applyStageView();
  if (els && els.mirB) els.mirB.classList.toggle("on", R.meta.view.mirror);
}

let stageRO = null;
function buildStage(){
  const { stage, tools, tp } = els, a = R.meta.asset;
  stage.textContent = ""; tools.textContent = ""; tp.textContent = ""; tp.hidden = true;
  if (els.T){ TPS.delete(els.T); els.T = null; }
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  els.svg = svg;
  // The picture, its drawings and the cached scrub frame move together (two-finger view, R.pv).
  const sv = el("div", "sv");
  els.sv = sv;
  const missing = (what) => {
    const n = el("div", "none"), d = el("div");
    d.appendChild(el("div", "", what));
    d.appendChild(el("div", "", `${a.name} · ${fmtBytes(a.size)}`));
    const l = el("label"); l.appendChild(document.createTextNode("Pick the file"));
    l.appendChild(picker(a.kind === "video" ? "video/*" : "image/*", false, (fs) => rebind(fs[0])));
    d.appendChild(l); n.appendChild(d); stage.appendChild(n);
  };
  bindStage(stage);
  if (a.kind === "image"){
    const show = (url) => { const img = el("img"); img.src = url; img.alt = ""; img.draggable = false; stage.textContent = ""; sv.appendChild(img); sv.appendChild(svg); stage.appendChild(sv); paintOverlay(); applyStageView(); };
    if (R.url) show(R.url);
    else {
      getPicture().then((p) => { if (!els || els.stage !== stage) return; if (p) show(p.url); else missing("The picture is not on this device."); });
    }
  } else if (a.kind === "video"){
    if (!R.url) missing("Pick the video again to play it and draw on its frames. Notes and their frames stay readable.");
    else {
      const v = el("video");
      v.playsInline = true; v.setAttribute("playsinline", ""); v.preload = "auto"; v.src = R.url;
      R.video = v;
      applyVol(v); v.playbackRate = v.defaultPlaybackRate = R.rate || 1; v.loop = loopOn;
      // A cached frame shown over the player while a seek is on its way (ScrubCache).
      const si = el("img", "scrubimg"); si.alt = ""; si.draggable = false; si.hidden = true;
      els.scrubImg = si;
      sv.appendChild(v); sv.appendChild(si); sv.appendChild(svg); stage.appendChild(sv);
      const big = btn("playbig", null, () => togglePlay(), "Play"); big.innerHTML = ico("play", 30);
      stage.appendChild(big);
      v.addEventListener("loadedmetadata", () => {
        if (!R || R.video !== v) return;
        const aa = R.meta.asset;
        if (!aa.width && v.videoWidth){ aa.width = v.videoWidth; aa.height = v.videoHeight; }
        if (!aa.duration && Number.isFinite(v.duration)) aa.duration = v.duration;
        // Sound: Safari lists the tracks, Firefox says; Chrome only once it has decoded some (timeupdate).
        if (v.audioTracks && typeof v.audioTracks.length === "number") setAudio(v.audioTracks.length > 0);
        else if (typeof v.mozHasAudio === "boolean") setAudio(v.mozHasAudio);
        paintTime(); paintMarkers(); paintOverlay(); applyStageView();
        const rv = R, d = Number.isFinite(v.duration) ? v.duration : aa.duration;
        if (!rv.scrub && d && rv.url && v.src === rv.url){  // not a player whose file was just swapped (rebind)
          rv.scrub = new ScrubCache(rv.url, d, rv.fps, (f) => { if (R === rv){ rv.cacheF = f; TPS.forEach(paintCache); } });
          // After the player's own first frame, so the two do not race for the decoder.
          setTimeout(() => { if (R === rv && rv.scrub) rv.scrub.start(); }, 600);
        }
      });
      v.addEventListener("error", () => toast("This device cannot play this video (format or codec).", 5000));
      ["timeupdate", "pause"].forEach((ev) => v.addEventListener(ev, () => { paintTime(); paintOverlay(); paintCurrent(); if (composing() && els.where) els.where(); }));
      // Chrome: no sound decoded after a quarter second of (unmuted) play = the clip has none — a
      // guess, taken back as soon as some sound is decoded after all (the container's word, from
      // mp4.js / Safari / Firefox, is final: audioSure).
      let lastT = null;
      v.addEventListener("timeupdate", () => {
        if (!R || R.video !== v || R.audioSure || R.hasAudio === true || !("webkitAudioDecodedByteCount" in v)) return;
        const t = v.currentTime, dt = lastT == null ? 0 : t - lastT;
        lastT = v.paused ? null : t;
        if (v.webkitAudioDecodedByteCount > 0){ setAudio(true); return; }
        if (v.paused || v.muted) return;
        if (dt > 0 && dt < 0.5) R.playedFor = (R.playedFor || 0) + dt;
        if (R.playedFor > 0.25 && R.hasAudio == null) setAudio(false, true);
      });
      v.addEventListener("seeked", () => {
        if (!R || R.video !== v) return;
        pumpSeek(v);
        if (R.want == null && !R.dragging && !v.seeking) settle(v);
        else if (R.want == null && R.scrubT != null && Math.abs(v.currentTime - R.scrubT) < frameDur()) hideWhenShown(v);  // the player has caught up
        if (composing() && els.where) els.where();
      });
      // The big play button only until the clip is first played or moved: it would cover the frame.
      // (A seek still landing keeps the cached picture until its frame is shown: settle on "seeked".)
      v.addEventListener("play", () => { big.remove(); R.scrubT = null; R.want = null; if (!v.seeking) hideCached(); paintTime(); loop(); });
      v.addEventListener("seeking", () => big.remove());
      els.T = makeTransport();
      tp.appendChild(els.T.el); tp.hidden = false;
    }
  }
  // The pencil floats at the bottom right of the picture, as in the full-screen viewer (on a
  // video: just above the transport) — the same place on every screen and every kind of media.
  if (els.penB) els.penB.remove();
  const draw = btn("fab pencil", null, () => drawNew(), "Draw a note on this picture / frame");
  draw.innerHTML = ico("pen", 24);
  els.penB = draw;
  stage.parentNode.appendChild(draw);
  const eye = ibtn(R.hide ? "eyeoff" : "eye", "Show / hide drawings", () => { R.hide = !R.hide; eye.innerHTML = ico(R.hide ? "eyeoff" : "eye"); eye.classList.toggle("on", R.hide); paintOverlay(); });
  eye.classList.toggle("on", R.hide);
  tools.appendChild(eye);
  const mirB = ibtn("mirror", "Mirror the view", () => setView({ rot: viewOf().rot, mirror: !viewOf().mirror }));
  mirB.classList.toggle("on", viewOf().mirror);
  els.mirB = mirB;
  tools.appendChild(mirB);
  // Left end: hide every control; the round button left in the top left corner brings them back
  // (the gestures keep working meanwhile).
  const uiB = ibtn("hideui", "Hide the controls", () => setClean(true));
  uiB.classList.add("uib");
  tools.appendChild(uiB);
  if (els.showB) els.showB.remove();
  const showB = btn("fab showui", null, () => setClean(false), "Show the controls"); showB.innerHTML = ico("showui", 22);
  els.showB = showB;
  stage.parentNode.appendChild(showB);
  root.classList.toggle("clean", !!R.clean);
  const fitB = ibtn("fit", "Fit to screen", fitPlayer);
  fitB.classList.add("fitb");
  els.fitB = fitB;
  tools.appendChild(fitB);
  if (!stageRO){ stageRO = new ResizeObserver(() => applyStageView()); }
  stageRO.disconnect(); stageRO.observe(stage);
  applyPlayerView();
}
async function rebind(file){
  const a = R.meta.asset;
  if (file.size !== a.size || file.name.toLowerCase() !== String(a.name).toLowerCase()){
    if (!await ask({ title: "A different file?", text: `This review is for “${a.name}” (${fmtBytes(a.size)}); you picked “${file.name}” (${fmtBytes(file.size)}). Drawings land in the wrong place if the picture differs. Use it anyway?`, ok: "Use it" })) return;
  }
  const rv = R;
  if (rv.url) URL.revokeObjectURL(rv.url);
  rv.url = null;
  if (rv.grab) rv.grab.close();
  if (rv.scrub) rv.scrub.close();
  rv.grab = null; rv.scrub = null; rv.cacheF = 0; rv.want = null; rv.scrubT = null;
  // Another file: whether it has sound is learnt again.
  delete rv.meta.audio; rv.hasAudio = null; rv.audioSure = false; rv.playedFor = 0;
  const old = rv.frames.get("img");
  if (old){ URL.revokeObjectURL(old.url); rv.frames.delete("img"); }
  await DB.del("frames", rv.meta.key + "|img").catch(() => {});
  await bindFile(rv, file);
  if (R !== rv) return;
  DB.put("reviews", rv.meta).catch(() => {});
  buildStage(); paintReview();
  autoKeep(rv, true);  // the file picked now is the one to open with next time
}

// ---- video transport ---------------------------------------------------------------------------
const frameDur = () => 1 / (R.fps || 25);
const durOf = () => { const v = R && R.video; return (v && Number.isFinite(v.duration) && v.duration) || (R && R.meta.asset.duration) || 0; };
// Play starts from the frame on screen: a scrub / step whose last seek has not been sent (R.want)
// would otherwise be dropped, and the clip played on from the older position the player still
// stands on. A seek already on its way to that frame (or landed there) is left alone: setting
// currentTime again restarts it — the decoder goes back to the keyframe and decodes up to the
// frame once more, which is the lag after a scrub (the scrub cache holds pictures for the screen,
// not the decoder's state: the player itself must still seek before it can play).
function togglePlay(){
  const v = R && R.video;
  if (!v) return;
  if (!v.paused){ v.pause(); return; }
  const t = R.want != null ? R.want : R.scrubT;
  if (t != null){
    R.want = null;
    if (R.dragging) dragEnd();
    // (While seeking, currentTime already reads the position asked for.)
    const there = R.fpsKnown ? frameIdx(v.currentTime) === frameIdx(t) : Math.abs(v.currentTime - t) < 1e-3;
    if (!there) v.currentTime = R.fpsKnown ? Math.min((frameIdx(t) + 0.25) * frameDur(), durOf() || Infinity) : t;
  }
  v.play().catch(() => {});
}
// The frame on screen at time t is the one that started at or before t; a time inside it is kept as
// that frame's start + a hair (as Sight's stepping lands), so a note made there shows on exactly
// that frame (review-core ctxVisible) and Sight numbers it the same. Raw time while the frame rate
// is still a guess (same rule as annotate.js frameStart).
function frameStart(t){ return R.fpsKnown ? M.frameTime(t, R.fps) : r3(t); }
const frameIdx = (t) => M.frameIndex(t, R.fps);
// Every move of the playhead (frame steps, marker jumps, the timeline, the scrub on the picture)
// goes through seekTo: the time is snapped to its frame and shown at once (timecode, playhead,
// drawings, the cached frame), one seek is in flight and the latest wanted time goes next, so the
// player never queues up stale seeks; `R.scrubT` is the time on screen until the last one lands.
const posNow = () => R.want != null ? R.want : R.scrubT != null ? R.scrubT : R.video.currentTime;
function snapT(t){
  const d = durOf();
  t = Math.max(0, d ? Math.min(t, d) : t);
  if (!R.fpsKnown) return r3(t);
  let s = frameStart(t);
  if (d){
    // Not past the last frame: the clip's frame count (a duration a hair over a whole number of
    // frames still ends on that number).
    const fd = frameDur(), x = d / fd, n = Math.abs(x - Math.round(x)) < 0.05 ? Math.round(x) : Math.ceil(x);
    s = Math.min(s, r3((Math.max(1, n) - 1 + 0.01) * fd));
  }
  return s;
}
function seekTo(t){
  const v = R && R.video;
  if (!v) return;
  if (!v.paused) v.pause();
  t = snapT(t);
  R.scrubT = t; R.want = t;
  if (R.drawS) R.drawS.moved(t);  // first: a seek that lands at once (same frame) settles the canvas
  showCached(t);
  pumpSeek(v);
  paintTime(); paintOverlay(); paintCurrent();
}
function pumpSeek(v){
  if (R.want == null || v.seeking) return;
  const t = R.want;
  R.want = null;
  // The player is sent a quarter into the frame (well inside it, whatever the container's stamps)
  // unless it already shows that frame.
  const same = R.fpsKnown ? frameIdx(v.currentTime) === frameIdx(t) : Math.abs(t - v.currentTime) <= 1e-4;
  if (!same){
    const d = durOf();
    v.currentTime = R.fpsKnown ? Math.min((frameIdx(t) + 0.25) * frameDur(), d || Infinity) : t;
  } else if (!R.dragging) settle(v);
}
// The last seek has landed and nothing is being dragged: the player's own frame is the truth again.
function settle(v){
  if (!R || R.video !== v) return;
  R.scrubT = null;
  hideWhenShown(v);
  paintTime(); paintOverlay(); paintCurrent();
  if (R.drawS) R.drawS.settled();
}
function dragEnd(){
  R.dragging = false;
  const v = R.video;
  if (v && R.want == null && !v.seeking) settle(v);
}
// ±n frames from the frame on screen (or the one already on its way: quick taps add up).
function step(n){
  if (!R || !R.video) return;
  seekTo((frameIdx(posNow()) + n + 0.01) * frameDur());
}
// Markers on the timeline: notes (by state: red open, yellow in progress, green resolved ticks),
// drawings on other frames (grey dots), and the frames drawn on in the open drawing session / the
// new note's draft (accent dots). A new note being written, and a drawing session, show only their
// own frames: a clean timeline, as the picture is clean (stageDrawings) — the marker jumps and the
// timeline's snap then go only to those frames too.
function markerList(){
  const out = [], seen = new Set();
  const d = R.drafts[composeKey()];
  const mine = R.drawS ? R.drawS.times() : drawFrames(d && d.draw).map((x) => x.frame.ctx && x.frame.ctx.t).filter((t) => t != null);
  if (R.drawS || R.newOpen) return mine.map((t) => ({ t, cls: "mine" }));
  // A reply over the player: the note's frames (its tick, dots for the frames drawn on) + the reply's.
  const rn = R.replyTo && R.rows.find((r) => r.id === R.replyTo && r.deleted_at == null);
  if (rn){
    const c0 = rn.data.ctx && rn.data.ctx.t;
    threadFrames(rn).forEach((t) => { seen.add(r3(t)); out.push({ t, cls: c0 != null && r3(t) === r3(c0) ? M.noteState(rn) : "dr" }); });
    mine.forEach((t) => out.push({ t, cls: "mine" }));
    return out;
  }
  M.notesSorted(R.rows, "video").forEach((n) => {
    const t = n.data.ctx && n.data.ctx.t;
    if (t == null) return;
    seen.add(r3(t)); out.push({ t, cls: M.noteState(n) });
  });
  M.drawings(R.rows).forEach((r) => {
    const t = r.data.ctx && r.data.ctx.t;
    if (t == null || seen.has(r3(t))) return;
    seen.add(r3(t)); out.push({ t, cls: "dr" });
  });
  mine.forEach((t) => out.push({ t, cls: "mine" }));
  return out;
}
function jumpNote(dir){
  if (!R || !R.video) return;
  const ts = [...new Set(markerList().map((m) => r3(m.t)))].sort((a, b) => a - b);
  const cur = posNow(), eps = frameDur() * 0.5;
  const t = dir > 0 ? ts.find((x) => x > cur + eps) : ts.reverse().find((x) => x < cur - eps);
  if (t == null){ toast(dir > 0 ? "No later marker" : "No earlier marker"); return; }
  seekTo(t);
  // Landed on a note's own frame: that note is selected (its card brought into view).
  const n = !composing() && !R.drawS && listedNotes().find((x) => x.data.ctx && x.data.ctx.t != null && frameKey(x.data.ctx.t) === frameKey(t));
  if (n){ R.curNote = n.id; paintCurrent(); const c = els && els.notes.querySelector(`.note[data-id="${n.id}"]`); if (c) c.scrollIntoView({ block: "nearest" }); }
}
// Transports on screen: the player's, and the drawing canvas's while a video is drawn on.
const TPS = new Set();
function makeTransport(){
  const T = { el: el("div", "tpi") }, row = el("div", "row");
  T.tc = el("span", "tc");
  // Left of the time: the frame rate it plays at (drag up / down = speed, tap = the nearest common
  // rate, hold = the clip's own); right of the frame number: the sound (drag = volume, tap = full;
  // grey when the clip has none).
  T.fps = btn("fps", null, null, "Playback speed: drag up / down · tap: the nearest common rate · hold: the clip's own");
  vdrag(T.fps, { begin: () => { T.r0 = rateNow(); }, move: (dy) => setRate(T.r0 * Math.pow(2, -dy / 110)), tap: snapRate, hold: () => setRate(1) });
  T.snd = btn("ib snd", null, null, "Volume: drag up / down from where it is · tap: full / mute");
  vdrag(T.snd, { begin: () => { T.v0 = volNow(); }, move: (dy) => { if (R && R.hasAudio !== false) setVol(T.v0 - dy / 140); },
    tap: () => { if (R && R.hasAudio === false) toast("This clip has no sound", 1600); else setVol(volLevel < 0.02 ? 1 : 0); } });
  // Right of the sound: loop / play once and stop at the end.
  T.loop = btn("ib loopb", null, () => setLoop(!loopOn));
  [ibtn("prev", "Previous marker", () => jumpNote(-1)), ibtn("stepb", "Previous frame", () => step(-1)), T.fps, T.tc, T.snd, T.loop,
    ibtn("stepf", "Next frame", () => step(1)), ibtn("next", "Next marker", () => jumpNote(1))].forEach((b) => row.appendChild(b));
  const tl = el("div", "tl"), trk = el("div", "trk");
  T.cache = el("i", "cache"); T.marks = el("div"); T.ph = el("i", "ph");
  trk.appendChild(T.cache); trk.appendChild(T.marks); trk.appendChild(T.ph);
  tl.appendChild(trk);
  T.trk = trk;
  bindTimeline(tl, T);
  T.el.appendChild(row); T.el.appendChild(tl);
  TPS.add(T);
  paintTransport(T); paintMarks(T); paintCache(T);
  return T;
}
// The timeline: a tap or drag puts the playhead there (within 10 px of a marker: on it).
function bindTimeline(tl, T){
  let id = null;
  const at = (e) => {
    const r = T.trk.getBoundingClientRect(), d = durOf();
    if (!d || !r.width) return null;
    const x = e.clientX - r.left;
    let best = null, bd = 10;
    markerList().forEach((m) => { const dx = Math.abs(m.t / d * r.width - x); if (dx < bd){ bd = dx; best = m.t; } });
    return best != null ? best : RC.clamp(x / r.width, 0, 1) * d;
  };
  tl.addEventListener("pointerdown", (e) => {
    if (!R || !R.video || (e.pointerType === "mouse" && e.button !== 0)) return;
    const t = at(e);
    if (t == null) return;
    e.preventDefault();
    id = e.pointerId;
    try { tl.setPointerCapture(id); } catch {}
    R.dragging = true;
    seekTo(t);
  });
  tl.addEventListener("pointermove", (e) => { if (e.pointerId !== id) return; const t = at(e); if (t != null) seekTo(t); });
  const end = (e) => { if (e.pointerId !== id) return; id = null; dragEnd(); };
  tl.addEventListener("pointerup", end); tl.addEventListener("pointercancel", end); tl.addEventListener("lostpointercapture", end);
}
function paintTransport(T){
  const v = R && R.video;
  if (!v) return;
  const t = R.scrubT != null ? R.scrubT : v.currentTime, d = durOf();
  T.tc.textContent = `${fmtTime(t, R.fps)} · f ${Math.round(t * R.fps)}`;
  paintRate(T); paintSnd(T); paintLoop(T);
  T.ph.style.left = (d ? Math.min(100, Math.max(0, t / d * 100)) : 0).toFixed(3) + "%";
}
// ---- speed and sound -------------------------------------------------------------------------------
// A vertical drag control on a small button: begin(), move(dy since the press), tap(), hold() (½ s
// without moving). It keeps the pointer to itself (the stage / canvas under it do not see it).
function vdrag(b, o){
  let st = null, ptrMouse = false;
  b.style.touchAction = "none";
  // A mouse's right click keeps the browser's menu; a touch's long press is the hold, not a menu.
  b.addEventListener("contextmenu", (e) => { if (!(ptrMouse && (e.button === 2 || e.ctrlKey))) e.preventDefault(); });
  b.addEventListener("pointerdown", (e) => {
    ptrMouse = e.pointerType === "mouse";
    if (st || (e.pointerType === "mouse" && e.button !== 0)) return;  // one finger at a time
    e.preventDefault(); e.stopPropagation();
    st = { id: e.pointerId, x: e.clientX, y: e.clientY, drag: false, held: false, far: false };
    try { b.setPointerCapture(e.pointerId); } catch {}
    st.ht = setTimeout(() => { if (st && !st.drag){ st.held = true; if (o.hold) o.hold(); } }, 500);
    if (o.begin) o.begin();
  });
  b.addEventListener("pointermove", (e) => {
    if (!st || e.pointerId !== st.id) return;
    const dy = e.clientY - st.y;
    if (Math.hypot(e.clientX - st.x, dy) > 8){ st.far = true; if (!st.drag) clearTimeout(st.ht); }  // a slide is no tap / hold
    if (!st.drag && Math.abs(dy) > 6 && !st.held){ st.drag = true; clearTimeout(st.ht); }
    if (st.drag) o.move(dy);
  });
  const end = (e) => {
    if (!st || e.pointerId !== st.id) return;
    clearTimeout(st.ht);
    const s0 = st; st = null;
    if (e.type === "pointerup" && !s0.drag && !s0.held && !s0.far && o.tap) o.tap();
    if (s0.drag && o.end) o.end();
  };
  b.addEventListener("pointerup", end); b.addEventListener("pointercancel", end); b.addEventListener("lostpointercapture", end);
  b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); });
}
// Speed: the video's playbackRate (0.1…4), shown as the frame rate it plays at.
const COMMON_FPS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 12.5, 15, 20, 23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 72, 90, 100, 120];
const rateNow = () => (R && R.video ? R.video.playbackRate : 1) || 1;
function setRate(r){
  if (!R || !R.video) return;
  r = RC.clamp(r, 0.1, 4);
  if (Math.abs(r - 1) < 0.004) r = 1;
  R.rate = r;
  R.video.playbackRate = R.video.defaultPlaybackRate = r;
  TPS.forEach(paintRate);
}
// The common frame rate nearest to the one it plays at now (by ratio), within the speed range.
function snapRate(){
  if (!R || !R.video) return;
  const f = R.fps * rateNow(), ok = COMMON_FPS.filter((c) => c / R.fps >= 0.1 && c / R.fps <= 4);
  if (!ok.length) return;
  const best = ok.reduce((a, c) => Math.abs(Math.log(c / f)) < Math.abs(Math.log(a / f)) ? c : a, ok[0]);
  setRate(Math.abs(best - R.fps) / R.fps < 1e-3 ? 1 : best / R.fps);
}
const fmtFps = (f) => Math.abs(f - Math.round(f)) < 0.005 ? String(Math.round(f)) : f < 10 ? f.toFixed(2).replace(/0$/, "") : (Math.round(f * 100) / 100).toString();
function paintRate(T){
  if (!T.fps || !R) return;
  const r = rateNow(), txt = (R.fpsKnown ? "" : "≈") + fmtFps(R.fps * r);
  if (T.fps.dataset.v === txt) return;
  T.fps.dataset.v = txt;
  T.fps.textContent = txt;
  T.fps.appendChild(el("small", "", "fps"));
  T.fps.classList.toggle("on", r !== 1);
  T.fps.title = (r !== 1 ? `×${Math.round(r * 100) / 100} · ` : "") + "Playback speed: drag up / down · tap: the nearest common rate · hold: the clip's own";
}
// Sound: the level is the device's (localStorage), 0 = muted. iOS ignores a page's volume: there the
// drag only mutes / unmutes (below / above half).
const VOL_KEY = "sight-review:vol";
let volLevel = 1, volWorks = null;
try { const x = Number(localStorage.getItem(VOL_KEY)); if (localStorage.getItem(VOL_KEY) != null && x >= 0 && x <= 1) volLevel = x; } catch {}
const volNow = () => volLevel;
function applyVol(v){
  if (volWorks == null){ try { v.volume = 0.5; volWorks = Math.abs(v.volume - 0.5) < 0.01; } catch { volWorks = false; } }
  try { v.volume = volWorks ? volLevel : 1; } catch {}
  v.muted = volLevel < 0.02;
}
function setVol(x){
  x = RC.clamp(x, 0, 1);
  if (volWorks === false) x = x < 0.5 ? 0 : 1;
  volLevel = Math.round(x * 100) / 100;
  try { localStorage.setItem(VOL_KEY, String(volLevel)); } catch {}
  if (R && R.video) applyVol(R.video);
  showVolBar();
  TPS.forEach(paintSnd);
}
function setAudio(has, guess){
  if (!R) return;
  if (!guess) R.audioSure = true;
  if (R.hasAudio === has) return;
  R.hasAudio = has;
  TPS.forEach(paintSnd);
  if (guess) return;  // not stored: a guess is made again next time
  if (R.meta.audio !== has){ R.meta.audio = has; putIfAlive(R, "reviews", R.meta); }
  TPS.forEach(paintSnd);
}
// Playing mode, kept on the device: loop (on from the start at the end) or once (stops at the end).
const LOOP_KEY = "sight-review:loop";
let loopOn = false;
try { loopOn = localStorage.getItem(LOOP_KEY) === "1"; } catch {}
function setLoop(on){
  loopOn = on;
  try { localStorage.setItem(LOOP_KEY, on ? "1" : "0"); } catch {}
  if (R && R.video) R.video.loop = on;
  TPS.forEach(paintLoop);
  toast(on ? "Loop: plays on from the start" : "Once: stops at the end", 1400);
}
function paintLoop(T){
  if (!T.loop) return;
  const name = loopOn ? "loop" : "once";
  if (T.loop.dataset.ico === name) return;
  T.loop.dataset.ico = name;
  T.loop.innerHTML = ico(name, 20);
  T.loop.classList.toggle("on", loopOn);
  T.loop.title = loopOn ? "Loop (tap: play once and stop)" : "Play once and stop (tap: loop)";
  T.loop.setAttribute("aria-label", T.loop.title);
}
function paintSnd(T){
  if (!T.snd || !R) return;
  const none = R.hasAudio === false, off = !none && volLevel < 0.02;
  const name = none || off ? "sndoff" : "snd";
  if (T.snd.dataset.ico !== name){ T.snd.innerHTML = ico(name, 20); T.snd.dataset.ico = name; }
  if (T.snd.dataset.st === name + none + volLevel) return;
  T.snd.dataset.st = name + none + volLevel;
  T.snd.classList.toggle("none", none);
  T.snd.title = none ? "This clip has no sound" : `Volume ${Math.round(volLevel * 100)} %: drag up / down from here · tap: full / mute`;
}
// The level while it is set: a thin bar at the screen's left edge, gone a moment after.
let volBar = null, volBarT = null;
function showVolBar(){
  if (!volBar){ volBar = el("div", "volbar"); volBar.appendChild(el("i")); document.body.appendChild(volBar); }
  volBar.firstChild.style.height = (volLevel * 100).toFixed(1) + "%";
  volBar.classList.add("on");
  clearTimeout(volBarT);
  volBarT = setTimeout(() => { if (volBar) volBar.classList.remove("on"); }, 900);
}
function paintMarks(T){
  const d = durOf();
  T.marks.textContent = "";
  if (!d) return;
  markerList().sort((a, b) => (a.cls === "mine") - (b.cls === "mine")).forEach((m) => {
    const i = el("i", "mk " + m.cls);
    i.style.left = Math.min(100, m.t / d * 100).toFixed(3) + "%";
    T.marks.appendChild(i);
  });
}
function paintCache(T){ T.cache.style.width = ((R && R.cacheF || 0) * 100).toFixed(1) + "%"; }
function paintTime(){ if (R && R.video) TPS.forEach(paintTransport); }
function paintMarkers(){ if (R && R.video) TPS.forEach(paintMarks); }
// The scrub cache (ScrubCache) puts the frame wanted up at once; the player's own picture takes
// over when its last seek has landed.
function cachedAt(t){
  const sc = R && R.scrub;
  if (!sc) return null;
  // Dragging: the nearest picture keeps up with the finger. A step / jump: only that very frame —
  // a neighbour first would show the picture going back and then forward.
  return R.dragging ? sc.near(t) : R.fpsKnown ? sc.exact(t, frameDur(), frameIdx(t)) : null;
}
function showCached(t){
  const si = els && els.scrubImg, u = cachedAt(t);
  if (!si) return;
  hideSeq++;
  if (u){ if (si.getAttribute("src") !== u) si.src = u; si.hidden = false; }
  else si.hidden = true;
}
function hideCached(){ if (els && els.scrubImg) els.scrubImg.hidden = true; }
// The player says "seeked" before it has painted the new frame (Safari above all): the cached
// picture goes only once a frame of the new position is on screen (rVFC; at most 250 ms), or the
// old frame flashes up in between.
function hideWhenShown(v){
  const seq = ++hideSeq;
  const go = () => { if (seq === hideSeq && R && R.video === v && R.want == null && !v.seeking) hideCached(); };
  if (v.requestVideoFrameCallback){
    let done = false;
    v.requestVideoFrameCallback(() => { done = true; go(); });
    setTimeout(() => { if (!done) go(); }, 250);
  } else requestAnimationFrame(() => requestAnimationFrame(go));
}
let hideSeq = 0;
// Drag left / right on the picture: the clip runs on from where it is, at a fixed pace (a frame per
// 4 px when slow, faster the faster the finger moves; Shift a quarter of that) — not the screen's
// width for the whole clip. Nothing happens until the finger has moved sideways a few px, so a tap
// still plays / pauses.
function scrubStep(t, dx, dt, fine){
  const speed = Math.abs(dx) / Math.max(1, dt);  // px per ms
  const gain = 0.25 * Math.min(12, 1 + Math.max(0, speed - 0.25) * 5) * (fine ? 0.25 : 1);
  return RC.clamp(t + dx * gain * frameDur(), 0, durOf() || 0);
}
// The player's picture. One finger: a drag sideways scrubs the video, a swipe up opens the Notes
// Panel, a swipe down goes back to the reviews, a tap plays / pauses (a picture: opens it full
// screen). Two fingers pan, zoom and turn it (the drawing canvas' rules, SightReviewDraw.pinch);
// the finger left after a pinch pans on. Bound once per stage element (a rebind rebuilds inside).
function bindStage(stage){
  if (stage.dataset.bound) return;
  stage.dataset.bound = "1";
  stage.style.touchAction = "none";
  const pts = new Map();
  let one = null, g = null, eatUntil = 0;
  const rel = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const centre = () => [stage.clientWidth / 2, stage.clientHeight / 2];
  // Stage px on screen → the same point of the untransformed picture, and back (pin).
  const inv = (p, pv) => {
    const c = centre(), a = -pv.r * Math.PI / 180, x = p[0] - c[0] - pv.o[0], y = p[1] - c[1] - pv.o[1];
    return [c[0] + (x * Math.cos(a) - y * Math.sin(a)) / pv.z, c[1] + (x * Math.sin(a) + y * Math.cos(a)) / pv.z];
  };
  const pin = (q, p) => {
    const c = centre(), pv = R.pv, a = pv.r * Math.PI / 180, x = (q[0] - c[0]) * pv.z, y = (q[1] - c[1]) * pv.z;
    pv.o = [p[0] - c[0] - (x * Math.cos(a) - y * Math.sin(a)), p[1] - c[1] - (x * Math.sin(a) + y * Math.cos(a))];
  };
  const mid = (p) => p[1] ? [(p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2] : [p[0].x, p[0].y];
  const gestStart = () => {
    const p = [...pts.values()];
    if (!p.length || !R){ g = null; return; }
    g = { q: inv(mid(p), R.pv), z: R.pv.z, r: R.pv.r, d: p[1] ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0, a: p[1] ? Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x) : 0 };
  };
  const gestMove = () => {
    const p = [...pts.values()];
    if (!p.length || !R) return;
    if (p[1] && g.d){ const k = DRAW.pinch(g, p[0], p[1], 0.5, 16); R.pv.z = k.z; R.pv.r = k.r; }
    pin(g.q, mid(p));
    applyPlayerView();
  };
  stage.addEventListener("pointerdown", (e) => {
    if (!R || e.target.closest("button, label, input") || (e.pointerType === "mouse" && e.button !== 0)) return;
    if (e.pointerType === "mouse" && pts.size) return;
    const p = rel(e);
    pts.set(e.pointerId, { x: p[0], y: p[1] });
    if (pts.size === 1 && !g){
      eatUntil = 0;  // a click from here on belongs to this new tap
      one = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: 0, lt: 0, t: 0, mode: null, mouse: e.pointerType === "mouse" };
      return;
    }
    // A second finger: the picture is moved by two; a scrub under way stops where it is.
    if (one){ if (one.mode === "scrub") dragEnd(); one = null; }
    eatUntil = Infinity;
    try { stage.setPointerCapture(e.pointerId); } catch {}
    gestStart();
  });
  stage.addEventListener("pointermove", (e) => {
    const q = pts.get(e.pointerId);
    if (!q || !R) return;
    const p = rel(e);
    q.x = p[0]; q.y = p[1];
    if (g){ gestMove(); return; }
    if (!one || e.pointerId !== one.id) return;
    if (one.mouse && !(e.buttons & 1)){ up(e); return; }  // released outside the stage
    const v = R.video;
    if (!one.mode){
      const dx = e.clientX - one.x, dy = e.clientY - one.y;
      // Sideways a few px (video): the scrub. Nothing happens before, so a tap still plays / pauses.
      if (v && Math.abs(dx) >= 6 && Math.abs(dx) >= Math.abs(dy)){
        one.mode = "scrub"; one.lx = e.clientX; one.lt = e.timeStamp; one.t = posNow();
        R.dragging = true;
        v.pause();
        try { stage.setPointerCapture(e.pointerId); } catch {}
        return;
      }
      if (one.mouse) return;
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)){ one.mode = "none"; return; }
      if (dy < -40 && -dy > Math.abs(dx) * 1.5){ one.mode = "none"; setPanel(true); }
      else if (dy > 60 && dy > Math.abs(dx) * 1.5){ one.mode = "none"; swipeLeave(); }
      return;
    }
    // The clip runs on from where it is, at a fixed pace (scrubStep), not the screen's width for the whole clip.
    if (one.mode !== "scrub" || !v) return;
    const dx = e.clientX - one.lx, dt = e.timeStamp - one.lt;
    one.lx = e.clientX; one.lt = e.timeStamp;
    if (!dx || !durOf()) return;  // a recorder's WebM may have no duration
    one.t = scrubStep(one.t, dx, dt, e.shiftKey);
    seekTo(one.t);
  });
  function up(e){
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (one && e.pointerId === one.id){
      // A mouse drag ends with a click (a moved touch does not): only the one right after it is
      // eaten — a tap on Play right after a touch scrub must play.
      if (one.mode && one.mouse) eatUntil = performance.now() + 350;
      if (one.mode === "scrub" && R) dragEnd();
      one = null;
    }
    if (!g) return;
    if (pts.size){ gestStart(); return; }
    g = null;
    eatUntil = performance.now() + 350;
    if (!R) return;
    const pv = R.pv, q90 = Math.round(pv.r / 90) * 90;
    // Zoomed out past fit: back to the whole picture; near fit and straight: exactly fit.
    if (pv.z < 1) R.pv = { z: 1, r: q90, o: [0, 0] };
    else if (pv.z < 1.04 && pv.r === q90 && Math.hypot(pv.o[0], pv.o[1]) < 24) R.pv = { z: 1, r: q90, o: [0, 0] };
    applyPlayerView(true);
  }
  stage.addEventListener("pointerup", up);
  stage.addEventListener("pointercancel", up);
  stage.addEventListener("lostpointercapture", (e) => { if (e.pointerType === "mouse") up(e); });
  stage.addEventListener("click", (e) => {
    if (!R || !els || performance.now() < eatUntil || e.target.closest("button, label, input")) return;
    const v = R.video;
    if (v){ if (e.target === v || e.target === els.scrubImg) togglePlay(); }
    else if (kindNow() === "image" && e.target.tagName === "IMG") openPicture();
  });
  stage.addEventListener("wheel", (e) => {
    if (!R) return;
    e.preventDefault();
    const p = rel(e), q = inv(p, R.pv);
    R.pv.z = RC.clamp(R.pv.z * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), 1, 16);
    if (R.pv.z <= 1.0001) R.pv = { z: 1, r: R.pv.r, o: [0, 0] }; else pin(q, p);
    applyPlayerView();
  }, { passive: false });
}
// A swipe down is easy to make by accident: a new note being written is not dropped without asking.
function swipeLeave(){
  if (!R) return;
  const busyD = Object.values(R.drafts).some((d) => d && (d.text.trim() || d.shots.length || d.state || d.draw));
  if (!busyD){ leaveReview(); return; }
  const rv = R;
  ask({ title: "Leave this review?", text: "A note or reply you are writing is not sent yet and will be lost.", ok: "Leave", danger: true })
    .then((y) => { if (y && R === rv) leaveReview(); });
}
// The player's own view (R.pv): zoom z, turn r (degrees), offset o (px from the centre). For looking
// only — not kept with the review, unlike the quarter turn / mirror (R.meta.view).
function PV0(){ return { z: 1, r: 0, o: [0, 0] }; }
const pvFitted = (pv) => Math.abs(pv.z - 1) < 1e-3 && !pv.o[0] && !pv.o[1] && Math.abs(pv.r % 360) < 1e-3;
function applyPlayerView(anim){
  const sv = els && els.sv;
  if (!sv || !R) return;
  const pv = R.pv;
  sv.style.transition = anim ? "transform .2s ease-out" : "";
  sv.style.transform = pvFitted(pv) ? "" : `translate(${pv.o[0]}px,${pv.o[1]}px) rotate(${pv.r}deg) scale(${pv.z})`;
  if (els.fitB) els.fitB.hidden = pvFitted(pv);
}
// The controls hidden (R.clean, for this review while it is open): only the button that shows them.
function setClean(on){
  if (!R) return;
  R.clean = !!on;
  root.classList.toggle("clean", R.clean);
  applyStageView();
}
function fitPlayer(){ if (!R) return; R.pv = PV0(); applyPlayerView(true); }
// While playing: overlay + time every frame, and the frame rate measured when the container did
// not say (WebM): the median gap between presented frames, snapped to a common rate.
const RATES = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120];
function loop(){
  const v = R && R.video;
  if (!v) return;
  const gaps = [];
  let last = null;
  const tick = (_, meta) => {
    if (!R || R.video !== v || v.paused) return;
    if (meta && !R.fpsKnown && v.playbackRate === 1){  // faster, frames are dropped: the gaps lie
      if (last && meta.presentedFrames === last.presentedFrames + 1){
        const g = meta.mediaTime - last.mediaTime;
        if (g > 0.004 && g < 0.2) gaps.push(g);
      }
      last = meta;
      if (gaps.length >= 30){
        // WebM stamps are whole milliseconds (24 fps: 41 / 42 ms): average the gaps near the median.
        const med = gaps.slice().sort((a, b) => a - b)[gaps.length >> 1], near = gaps.filter((g) => g > med * 0.6 && g < med * 1.4);
        const f = near.length / near.reduce((s, g) => s + g, 0);
        const snap = RATES.reduce((best, r) => Math.abs(r - f) < Math.abs(best - f) ? r : best, RATES[0]);
        R.fps = Math.abs(snap - f) / snap < 0.015 ? snap : Math.round(f * 1000) / 1000; R.fpsKnown = true; R.meta.fps = R.fps;
        putIfAlive(R, "reviews", R.meta);
        paintReview();
      }
    }
    paintOverlay(); paintTime(); paintCurrent();
    next();
  };
  const next = () => v.requestVideoFrameCallback ? v.requestVideoFrameCallback(tick) : requestAnimationFrame(() => tick(0, null));
  next();
}

// ---- notes list --------------------------------------------------------------------------------
function paintReview(){
  if (!R || !els) return;
  NUM = numMap();
  const c = M.counts(R.rows), a = R.meta.asset;
  els.sub.textContent = [c.notes ? `${c.notes} note${c.notes > 1 ? "s" : ""}` : "No notes yet", a.kind === "video" && a.duration ? fmtTime(a.duration, R.fps) : a.width ? `${a.width} × ${a.height}` : ""].filter(Boolean).join(" · ");
  paintKeep();
  paintPanelBar();
  renderNotes();
  paintNewBar();
  paintMarkers(); paintOverlay();
}
// Shown only when the file could not be kept: reopening the review will ask for it.
function paintKeep(){
  const k = els.keep;
  k.textContent = "";
  if (!R.file || R.meta.kept || !R.keepFailed || R.meta.noKeep) return;
  const h = el("div", "hint"), p = el("p");
  p.appendChild(document.createTextNode(`The file is not kept on this device (${R.keepFailed}): reopening this review will ask for it again. `));
  const b = btn("btn", `Try again · ${fmtBytes(R.file.size)}`, keepCopy);
  p.appendChild(b);
  h.appendChild(p);
  h.appendChild(btn("", "×", () => { R.keepFailed = null; h.remove(); }, "Hide"));
  k.appendChild(h);
}
async function keepCopy(){
  const b = busy("Keeping a copy…");
  try {
    const rv = R;
    rv.meta.noKeep = false;
    await DB.put("reviews", rv.meta);
    if (!await DB.keepFile(rv.meta.key, rv.file)) throw new Error("the review is gone");
    rv.meta.kept = true; rv.keepFailed = null;
    DB.persist();
    toast("The file is kept on this device");
  } catch (e){ toast("Could not keep the file: " + (e.message || e), 5000); }
  finally { b.done(); paintKeep(); }
}
async function dropCopy(){
  R.meta.kept = false; R.meta.noKeep = true;
  await DB.dropFile(R.meta.key, true);
  toast("The file is forgotten on this device; the review stays. Reopening it asks for the file.", 4000);
}
function paintSeg(seg, c){
  [["all", "All", c.notes], ["open", "Open", c.open], ["progress", "In progress", c.progress], ["done", "Resolved", c.done]].forEach(([k, label, n]) => {
    const b = btn(R.filter === k ? "on" : "", label, () => { R.filter = k; paintReview(); });
    b.appendChild(el("i", "", String(n || 0)));
    seg.appendChild(b);
  });
}
const listedNotes = () => M.notesSorted(R.rows, kindNow()).filter((n) => R.filter === "all" || M.noteState(n) === R.filter);
function renderNotes(){
  const box = els.notes, keepY = els.plist.scrollTop;
  box.textContent = "";
  const notes = listedNotes();
  notes.forEach((n) => box.appendChild(noteCard(n)));
  if (!notes.length) box.appendChild(el("p", "empty", R.filter === "all" ? (kindNow() === "video" ? "No notes yet. Pause on a frame and add a note below, or draw on it." : "No notes yet. Add one below, or draw on the picture.") : "No notes here."));
  els.plist.scrollTop = keepY;
  paintCurrent();
}
// The selected note (R.curNote: tapped, replied to, looked at, reached by a marker step) has the
// accent frame (.cur); the notes on the frame shown now a lighter one (.here), so playing or
// scrubbing past notes never moves the selection.
function paintCurrent(){
  if (!els || !R) return;
  const v = R.video, t = v ? (R.scrubT != null ? R.scrubT : v.currentTime) : null, fd = v ? frameDur() : 0;
  els.notes.querySelectorAll(".note").forEach((c) => {
    c.classList.toggle("cur", c.dataset.id === R.curNote);
    c.classList.toggle("here", t != null && c.dataset.t != null && Math.abs(Number(c.dataset.t) - t) < fd * 0.75);
  });
}
// A tap on a note's card (not on its buttons / pictures / fields): it is selected and the player
// goes to the first frame its drawing is on (else its own frame); at = a frame of it to go to.
// While a note / reply is being written the player stays where it is (a new note goes on the frame
// on screen; a reply keeps its note): nothing moves, nothing is selected.
function selectNote(n, at){
  if (!R || composing()) return;
  R.curNote = n.id;
  if (R.video && kindNow() === "video"){ const t = at != null ? at : noteFrameList(n)[0]; if (t != null) seekTo(t); }  // its own drawings' frames, not its replies'
  paintCurrent();
}

// A note's picture to show / draw on: {url, vb, ctx, at, note} or null.
async function noteFrame(n){
  const c = n.data.ctx, vb = [0, 0, docW(), docH()];
  if (!vb[2] || !vb[3]) return null;
  if (kindNow() === "image"){
    const url = R.url || (await getPicture() || {}).url;
    return url ? { url, vb, ctx: null, at: null, note: n.id } : null;
  }
  if (kindNow() === "video" && c && c.t != null){
    const f = await getFrame(c.t);
    return f ? { url: f.url, vb, ctx: c, at: { t: c.t, fps: R.fps } } : null;
  }
  return null;
}
// Drawings on a note's picture: pictures — that note's drawings; video — what shows at its time.
// Replies' drawings only on the reply's own pictures (opts.reply), never on the note's.
function drawingsOn(f, opts = {}){
  return M.drawings(R.rows).filter((r) => opts.reply ? r.data.reply === opts.reply && (!f.at || RC.ctxVisible(r.data.ctx, f.at)) : !r.data.reply && (f.note ? r.data.note === f.note : RC.ctxVisible(r.data.ctx, f.at)));
}
function picBox(f, list, cls){
  const w = el("div", "fw" + (cls ? " " + cls : "")), i = el("img");
  i.src = f.url; i.alt = ""; i.draggable = false; w.appendChild(i);
  if (list.length) w.appendChild(overlay(f.vb, list, "cover"));
  return w;
}
// Fills a placeholder with a note's picture once it is there (cached, or taken from the video).
function asyncPic(n, list, cls, onTap){
  const ph = el("div", "fw wait" + (cls ? " " + cls : ""), "…");
  noteFrame(n).then((f) => {
    if (!f){ ph.remove(); return; }
    const box = picBox(f, list(f), cls);
    box.onclick = () => onTap(f);
    ph.replaceWith(box);
  });
  return ph;
}
// One more frame of a video note (or of a reply: rid, its drawings only), filled in once it is there.
function asyncFrameAt(n, t, rid){
  const rv = R, ph = el("div", "fw sm wait", "…");
  getFrame(t).then((fr) => {
    if (R !== rv || !fr){ ph.remove(); return; }
    const f = { url: fr.url, vb: [0, 0, docW(), docH()], ctx: { t, hold: 0 }, at: { t, fps: R.fps } };
    const box = picBox(f, rid ? drawingsOn(f, { reply: rid }) : drawingsOn(f), "sm");
    box.onclick = () => openThread(n, rid ? { kind: "frame", t, rid } : { kind: "frame", t });
    ph.replaceWith(box);
  });
  return ph;
}
// Attached pictures, into a picture grid; a tap opens them in note n's thread (rid: a reply's).
function shotThumbs(ids, n, rid, into){
  (ids || []).forEach((sid) => {
    const w = el("div", "fw shot"), i = el("img"); i.alt = ""; i.draggable = false; w.appendChild(i);
    shotUrl(String(sid)).then((u) => { if (u){ i.src = u; w.onclick = () => n ? openThread(n, rid ? { kind: "shot", id: String(sid), rid } : { kind: "shot", id: String(sid) }) : openShot(u); } else w.remove(); });
    into.appendChild(w);
  });
}
// A note's / reply's pictures: one grid of equal squares (Settings → Pictures in a row), each
// picture cut to fill its square (fitted by its short side).
const THUMBS_KEY = "sight-review:thumbs", THUMBS = [3, 4, 5, 6];
let thumbsRow = 4;
try { const x = Number(localStorage.getItem(THUMBS_KEY)); if (THUMBS.includes(x)) thumbsRow = x; } catch {}
const applyThumbs = () => document.documentElement.style.setProperty("--thumbs", String(thumbsRow));
applyThumbs();
function setThumbs(n){ thumbsRow = n; try { localStorage.setItem(THUMBS_KEY, String(n)); } catch {} applyThumbs(); }

function noteCard(n){
  const id = n.id, st = M.noteState(n), c = n.data.ctx, kind = kindNow();
  const card = el("div", "note " + st);
  card.dataset.id = id;
  card.addEventListener("click", (e) => {
    if (e.target.closest("button, a, input, textarea, label, .fw, .cmp, .x")) return;
    const sl = window.getSelection && getSelection();
    if (sl && !sl.isCollapsed && card.contains(sl.anchorNode)) return;  // a text selection made / dropped, not a tap
    selectNote(n);
  });
  if (kind === "video" && c && c.t != null) card.dataset.t = String(c.t);
  const h = el("div", "nh");
  h.appendChild(el("span", "num", String(NUM.get(id) || "")));
  if (kind === "video" && c && c.t != null){
    const b = btn("ctx", fmtTime(c.t, R.fps), () => goTo(n), "Go to this frame");
    h.appendChild(b);
  }
  h.appendChild(el("span", "who", [n.data.author, fmtDate(n.data.created)].filter(Boolean).join(" · ") + (n.data.edited_at ? " · edited" : "")));
  h.appendChild(el("span", "state " + st, M.NOTE_STATES[st]));
  h.appendChild(ibtn("more", "Note actions", () => noteMenu(n), 18));
  card.appendChild(h);
  if (n.data.text) card.appendChild(el("div", "text", n.data.text));
  // Its pictures in one grid: the video frame with what is drawn there (a picture note: only when
  // it has drawings), the other frames it was drawn on (time order), then its attached pictures.
  const pics = el("div", "pics");
  const own = M.drawings(R.rows).filter((r) => r.data.note === id && !r.data.reply);
  if (kind === "video" ? (c && c.t != null) : own.length){
    const mf = kind === "video" ? memFrame(c.t) : null;
    if (mf){
      const f = { url: mf.url, vb: [0, 0, docW(), docH()], ctx: c, at: { t: c.t, fps: R.fps } };
      const box = picBox(f, drawingsOn(f), "");
      box.onclick = () => openThread(n, { kind: "frame", t: c.t });
      pics.appendChild(box);
    } else pics.appendChild(asyncPic(n, (f) => drawingsOn(f), "", (f) => openThread(n, f.at ? { kind: "frame", t: f.at.t } : { kind: "frame" })));
  }
  if (kind === "video" && c && c.t != null)
    M.noteFrameTimes(R.rows, n).filter((t) => frameKey(t) !== frameKey(c.t)).forEach((t) => pics.appendChild(asyncFrameAt(n, t)));
  shotThumbs(n.data.shots, n, null, pics);
  if (pics.children.length) card.appendChild(pics);
  const reps = (n.data.replies || []).filter((r) => r && !r.deleted);
  if (reps.length){
    const rb = el("div", "replies");
    reps.forEach((r) => rb.appendChild(replyEntry(n, r)));
    card.appendChild(rb);
  }
  if (R.openReply[id]){
    card.appendChild(composer({ key: id, placeholder: "Reply", status: st, frameFor: () => noteFrame(n).then((f) => f && Object.assign(f, { base: drawingsOn(f) })),
      onSend: (text, shots, state, draw) => { delete R.openReply[id]; sendReply(n, text, shots, state, draw); } }));
    if (R.openReply[id] === "focus"){ R.openReply[id] = true; focusLater(id); }
  } else {
    const acts = el("div", "acts");
    // A video note: the reply is written over the player, on any frame (one forgotten last time).
    acts.appendChild(btn("btn", "Reply", () => { if (replyOverPlayer(n)) startReply(n); else { R.openReply[id] = "focus"; renderNotes(); } }));
    if (st !== "done") acts.appendChild(btn("btn", "Resolve", () => quickState(n, "done")));
    else acts.appendChild(btn("btn", "Reopen", () => quickState(n, "open")));
    card.appendChild(acts);
  }
  return card;
}
async function quickState(n, s){
  if (!await ensureName()) return;
  M.setNoteState(n, s, who);
  dirty();
}
// Every frame a video note's thread is on: its own frame, the frames it was drawn on and the ones
// its replies drew on, in time order (one time per frame, by r3).
// One key per frame (by index when the rate is known: two stored times a hair apart are one frame).
const frameKey = (t) => R.fpsKnown ? frameIdx(t) : r3(t);
function threadFrames(n){
  const c = n.data.ctx, by = new Map();
  if (c && c.t != null) by.set(frameKey(c.t), c.t);
  M.drawings(R.rows).forEach((r) => { const t = r.data.note === n.id && r.data.ctx ? r.data.ctx.t : null; if (typeof t === "number" && !by.has(frameKey(t))) by.set(frameKey(t), t); });
  return [...by.values()].sort((a, b) => a - b);
}
// The frames a reply drew on (video, time order), [] for a picture, null with no drawing.
function replyFrameTimes(n, rid){
  const own = M.drawings(R.rows).filter((x) => x.data.reply === rid);
  if (!own.length) return null;
  if (kindNow() !== "video") return [];
  const by = new Map(), c = n.data.ctx;
  own.forEach((x) => { const t = x.data.ctx && x.data.ctx.t != null ? x.data.ctx.t : c && c.t; if (t != null && !by.has(frameKey(t))) by.set(frameKey(t), t); });
  return [...by.values()].sort((a, b) => a - b);
}
const replyOverPlayer = (n) => kindNow() === "video" && !!R.video && !!(n.data.ctx && n.data.ctx.t != null);
// A reply on a video note, over the player: the panel goes, the player stands on the note's first
// frame (or the one given), its frames are on the timeline and its drawings on the picture; the
// pencil draws on whatever frame is on screen, as many as wanted. Leaving keeps the frame reached
// and the note lit in the list.
function startReply(n, at){
  if (!replyOverPlayer(n)) return false;
  if (R.replyTo === n.id && at == null){ setPanel(false); return true; }  // already: stay on the frame reached
  if (R.newOpen) R.newOpen = false;  // its draft stays for the next "+ Note"
  delete R.openReply[n.id];
  R.replyTo = n.id; R.curNote = n.id;
  setPanel(false);
  seekTo(at != null ? at : threadFrames(n)[0]);
  renderNotes();
  paintNewBar(); paintOverlay();
  return true;
}
function closeReply(){
  const id = R.replyTo;
  R.replyTo = null;
  paintNewBar(); paintOverlay();
  const card = id && els.notes.querySelector(`.note[data-id="${id}"]`);
  if (card) card.scrollIntoView({ block: "nearest" });
  paintCurrent();
}
// A reply with its text, pictures, state change and drawing (each frame drawn on keeps its own
// drawings: a frame the note was not on yet is added to the thread).
function sendReply(n, text, shots, state, draw){
  const t = now(), c = n.data.ctx;
  // On the note's own frame: the note's ctx (its hold too, FORMAT.md); on another frame its own.
  const own = (fc) => !fc || fc.t == null || !c || c.t == null || frameKey(fc.t) === frameKey(c.t);
  if (text || shots.length || draw){
    const r = M.addReply(n, { text, author: who, shots }, t);
    drawFrames(draw).forEach((x) => { const fc = x.frame && x.frame.ctx; R.rows.push(...M.drawingRows(x.items, { note: n.id, reply: r.id, ctx: M.drawCtx(own(fc) ? c : fc), z: M.maxZ(R.rows) + 1 }, t)); });
  }
  if (state) M.setNoteState(n, state, who, t + 1);
  dirty();
}
function replyEntry(n, r){
  if (r.event){
    const d = el("div", "rep ev " + r.event);
    d.textContent = (r.event === "done" ? "✓ " : r.event === "progress" ? "▸ " : "↺ ") + (M.EVENT_LABEL[r.event] || "Reopened") + (r.author ? " by " + r.author : "") + " · " + fmtDate(r.created);
    return d;
  }
  const d = el("div", "rep");
  d.appendChild(el("div", "rh", [r.author, fmtDate(r.created)].filter(Boolean).join(" · ")));
  if (r.text) d.appendChild(el("div", "rt", r.text));
  const rt = replyFrameTimes(n, r.id), c = n.data.ctx, pics = el("div", "pics");
  if (rt){
    // A video reply drawn on several frames: each of them (the note's own frame through noteFrame).
    if (rt.length > 1 || (rt.length && !(c && c.t != null && frameKey(rt[0]) === frameKey(c.t)))) rt.forEach((t) => pics.appendChild(asyncFrameAt(n, t, r.id)));
    else pics.appendChild(asyncPic(n, (f) => drawingsOn(f, { reply: r.id }), "sm", (f) => openThread(n, f.at ? { kind: "frame", t: f.at.t, rid: r.id } : { kind: "frame", rid: r.id })));
  }
  shotThumbs(r.shots, n, r.id, pics);
  if (pics.children.length) d.appendChild(pics);
  if (r.edited) d.firstChild.textContent += " · edited";
  const mb = ibtn("more", "Reply actions", () => replyMenu(n, r), 16); mb.classList.add("x");
  d.appendChild(mb);
  return d;
}
// A reply's menu: its text, its drawing, its pictures, or the reply itself.
function replyMenu(n, r){
  const drawn = M.drawings(R.rows).some((x) => x.data.reply === r.id), shots = r.shots || [];
  // Written to the note as it is then (a merge meanwhile replaces the row objects).
  const live = () => { const n2 = R && R.rows.find((x) => x.id === n.id && x.deleted_at == null), r2 = n2 && (n2.data.replies || []).find((x) => x.id === r.id && !x.deleted); return r2 ? [n2, r2] : null; };
  const empty = (r2, patch) => { const x = Object.assign({}, r2, patch); return !(x.text || "").trim() && !(x.shots || []).length && !M.drawings(R.rows).some((d) => d.data.reply === r.id); };
  const offerDelete = async () => {
    if (!await ask({ title: "Nothing would be left", text: "A reply needs words, a picture or a drawing. Delete the reply instead?", ok: "Delete", danger: true })) return;
    const L = live(); if (L){ M.deleteReply(R.rows, L[0], r.id); dirty(); }
  };
  menu("Reply" + (r.author ? " by " + r.author : ""), [
    { label: "Edit text", fn: async () => {
      const v = await askText({ title: "Edit reply", value: r.text || "", multiline: true });
      if (v == null || v.trim() === (r.text || "")) return;
      const L = live(); if (!L) return;
      if (empty(L[1], { text: v.trim() })){ offerDelete(); return; }
      M.editReply(L[0], r.id, { text: v.trim() }); dirty();
    } },
    { label: drawn ? "Edit the drawing" : "Draw on it", fn: () => editNoteDrawing(n, r.id) },
    { label: "Add pictures…", fn: () => {
      const rv = R, p = picker("image/*", true, async (fs) => {
        const add = [];
        for (const fl of fs){
          if (R !== rv) return;  // another review now: nothing stored for this one
          try {
            const im = await decode(fl), sc = await scaled(im, 1600, 0.85); if (im.close) im.close();
            const id = RC.uid();
            await DB.put("shots", { id, blob: sc.blob });
            if (R === rv) rv.shotUrls.set(id, URL.createObjectURL(sc.blob));
            add.push(id);
          } catch { toast("Could not read that picture"); }
        }
        const L = R === rv && add.length ? live() : null;
        if (!L) return;
        M.editReply(L[0], r.id, { shots: (L[1].shots || []).concat(add) }); dirty();
      });
      document.body.appendChild(p); p.click(); setTimeout(() => p.remove(), 60000);
    } },
    shots.length ? { label: shots.length > 1 ? `Remove its ${shots.length} pictures` : "Remove its picture", fn: async () => {
      const L0 = live();
      if (L0 && empty(L0[1], { shots: [] })){ offerDelete(); return; }
      if (!await ask({ title: "Remove the pictures?", text: "The pictures attached to this reply (not its drawing).", ok: "Remove", danger: true })) return;
      const L = live(); if (!L) return;
      M.editReply(L[0], r.id, { shots: [] }); dirty();
    } } : null,
    { label: "Delete reply…", danger: true, fn: async () => {
      if (!await ask({ title: "Delete this reply?", text: "Its pictures and drawings go with it. Sight removes it too when it merges this review.", ok: "Delete", danger: true })) return;
      const L = live(); if (!L) return;
      M.deleteReply(R.rows, L[0], r.id);
      dirty();
    } },
  ]);
}
function noteMenu(n){
  const own = M.drawings(R.rows).filter((r) => r.data.note === n.id && !r.data.reply);
  menu("Note " + (NUM.get(n.id) || ""), [
    { label: "Edit text", fn: () => editText(n) },
    { label: own.length ? "Edit the drawing" : "Draw on this note", fn: () => editNoteDrawing(n) },
    M.noteState(n) !== "progress" ? { label: "Mark in progress", fn: () => quickState(n, "progress") } : null,
    { label: "Delete note…", danger: true, fn: async () => {
      if (!await ask({ title: "Delete this note?", text: "With its replies and drawings. Sight removes it too when it merges this review.", ok: "Delete", danger: true })) return;
      M.deleteNote(R.rows, n.id); dirty();
    } },
  ]);
}
async function editText(n){
  const v = await askText({ title: "Edit note", value: n.data.text || "", multiline: true });
  if (v == null || v.trim() === (n.data.text || "")) return;
  M.editNote(n, { text: v.trim() });
  dirty();
}
// Opens the canvas with the note's own drawings editable; Done keeps / adds / removes rows (a
// drawing changed there is replaced: tombstone + a new row, as any merge reads it). A video note
// opens over the player with every frame it was drawn on.
// rid: a reply's drawing instead (its rows keep data.reply; on a video, any frame, as when replying).
async function editNoteDrawing(n, rid){
  if (!await ensureName()) return;
  const rv = R, own = M.drawings(R.rows).filter((r) => r.data.note === n.id && (rid ? r.data.reply === rid : !r.data.reply));
  const byId = new Map(own.map((r) => [r.id, r]));
  const asItem = (r) => ({ id: r.id, kind: r.kind, shape_kind: r.shape_kind, z: r.z_index, data: r.data });
  const apply = (list) => {
    if (R !== rv) return;
    const t = now(), kept = new Set(), fresh = [];
    list.forEach((x) => x.items.forEach((it) => {
      const r = it.id && byId.get(it.id);
      if (r && JSON.stringify(it.data) === JSON.stringify(r.data)) kept.add(r.id);
      else fresh.push({ it, ctx: r && r.data.ctx ? r.data.ctx : x.ctx });  // an edited drawing keeps its ctx (hold)
    }));
    const gone = own.filter((r) => !kept.has(r.id)).map((r) => r.id);
    if (!gone.length && !fresh.length) return;
    M.deleteRows(R.rows, gone, t);
    // A reply's new drawing on the note's own frame takes the note's ctx (its hold), as sendReply does.
    const c0 = n.data.ctx, onNote = (cx) => rid && cx && cx.t != null && c0 && c0.t != null && frameKey(cx.t) === frameKey(c0.t);
    fresh.forEach(({ it, ctx }) => R.rows.push(...M.drawingRows([Object.assign({}, it, { id: undefined })], Object.assign({ note: n.id, ctx: M.drawCtx(onNote(ctx) ? c0 : ctx), z: M.maxZ(R.rows) + 1 }, rid ? { reply: rid } : {}), t)));
    dirty();  // (the reply itself is not re-stamped: its drawings merge on their own, and a newer
              // edit of its words elsewhere must not lose to this copy's older words)
  };
  const c = n.data.ctx;
  if (kindNow() === "video" && rv.video && c && c.t != null){
    const groups = new Map();
    own.forEach((r) => { const tt = frameStart(r.data.ctx && r.data.ctx.t != null ? r.data.ctx.t : c.t), k = frameTag(tt); if (!groups.has(k)) groups.set(k, { frame: { ctx: { t: tt, hold: 0 } }, items: [] }); groups.get(k).items.push(asItem(r)); });
    // From its first frame (a reply's may not be the note's).
    const first = rid ? [...groups.values()].map((g) => g.frame.ctx.t).sort((a, b) => a - b)[0] : null;
    seekTo(first != null ? first : c.t);
    await whenSettled(rv);
    if (R !== rv) return;
    drawVideo({ frames: [...groups.values()], onDone: (list) => apply(list.map((x) => ({ ctx: x.frame.ctx, items: x.items }))) });
    return;
  }
  const f = await noteFrame(n);
  if (!f){ toast(kindNow() === "video" ? "Pick the video again to draw on its frames" : "The picture is not on this device"); return; }
  // On the clean picture: only this note's (reply's) own drawings, editable.
  drawCanvas({ src: f.url, vb: f.vb, base: [], items: own.map(asItem), onDone: (items) => apply([{ ctx: n.data.ctx, items }]) });
}
// Resolves once the player has (most likely) painted the frame it stands on: its next presented
// frame (rVFC), at most 150 ms — a paused player that already shows it presents nothing new.
function painted(v){
  return new Promise((ok) => {
    let done = false;
    const go = () => { if (!done){ done = true; ok(); } };
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(go);
    setTimeout(go, v.requestVideoFrameCallback ? 150 : 60);
  });
}
// Resolves once the player stands still on the last time asked for.
function whenSettled(rv){
  return new Promise((ok) => {
    const v = rv.video;
    const check = () => { if (R !== rv || !v || (rv.want == null && !v.seeking)){ if (v) v.removeEventListener("seeked", check); ok(); } };
    if (v) v.addEventListener("seeked", check);
    check();
  });
}
function goTo(n){
  const c = n.data.ctx, v = R.video;
  if (!v || !c || c.t == null){ if (!v && kindNow() === "video") toast("Pick the video again to play it"); return; }
  R.curNote = n.id;
  seekTo(c.t);
  setPanel(false);
}
function focusLater(key){
  requestAnimationFrame(() => {
    const ta = document.querySelector(`.cmp[data-key="${key}"] textarea`);
    if (ta){ ta.focus(); ta.scrollIntoView({ block: "center" }); }
  });
}

// ---- composer (message field) ------------------------------------------------------------------
// opts: {key, placeholder, status (a note's state, null for a new note), frameFor() → frame to draw
// on ({url, vb, ctx, base}), onSend(text, shotIds, state, draw), label}
function newDraft(){ return { text: "", shots: [], state: "", draw: null }; }
function composer(opts){
  const dr = R.drafts[opts.key] = R.drafts[opts.key] || newDraft();
  const box = el("div", "cmp"); box.dataset.key = opts.key;
  const send = btn("send", null, null, "Send"); send.innerHTML = ico("send", 17);
  const can = () => !!(dr.text.trim() || dr.shots.length || dr.state || dr.draw);
  const paint = () => { send.disabled = !can(); };
  if (opts.status){
    const o = el("div", "opts"); o.appendChild(el("span", "", "Mark as"));
    ["progress", "done", "open"].forEach((s) => {
      if (s === opts.status) return;
      const b = btn("opt " + s + (dr.state === s ? " on" : ""), s === "open" ? "Reopen" : M.NOTE_STATES[s], () => {
        dr.state = dr.state === s ? "" : s;
        o.querySelectorAll(".opt").forEach((x) => x.classList.remove("on"));
        if (dr.state) b.classList.add("on");
        paint();
      });
      o.appendChild(b);
    });
    box.appendChild(o);
  }
  const f = el("div", "field"), atts = el("div", "atts");
  function paintAtts(){
    atts.textContent = ""; atts.hidden = !dr.shots.length && !dr.draw;
    drawFrames(dr.draw).forEach((x) => {
      const s0 = el("span"), th = picBox(x.frame, x.items, "");
      th.title = "Edit the drawing"; th.onclick = () => drawDraft(x.frame);
      s0.appendChild(th);
      s0.appendChild(btn("", "×", (e) => {
        e.stopPropagation();
        const left = drawFrames(dr.draw).filter((y) => y.frame !== x.frame);
        dr.draw = framesDraw(left);
        paintAtts(); paint(); paintPen(); if (opts.onChange) opts.onChange();
      }, "Remove the drawing"));
      atts.appendChild(s0);
    });
    dr.shots.forEach((a, i) => {
      const s = el("span"), im = el("img"); im.src = a.url; im.alt = ""; s.appendChild(im);
      s.appendChild(btn("", "×", (e) => { e.stopPropagation(); URL.revokeObjectURL(a.url); dr.shots.splice(i, 1); paintAtts(); paint(); }, "Remove picture"));
      atts.appendChild(s);
    });
  }
  const ta = el("textarea"); ta.rows = 1; ta.placeholder = opts.placeholder; ta.value = dr.text;
  const grow = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + 2 + "px"; };
  ta.oninput = () => { dr.text = ta.value; grow(); paint(); };
  const file = picker("image/*", true, async (fs) => {
    for (const fl of fs){
      try { const im = await decode(fl); const s = await scaled(im, 1600, 0.85); if (im.close) im.close(); dr.shots.push({ id: RC.uid(), blob: s.blob, url: URL.createObjectURL(s.blob) }); }
      catch { toast("Could not read that picture"); }
    }
    paintAtts(); paint();
  });
  const clip = btn("clip", null, () => file.click(), "Attach pictures"); clip.innerHTML = ico("clip", 19);
  clip.dataset.nofs = "1";  // opens the file picker: no full screen on this tap
  const pen = btn("pen", null, async () => {
    if (opts.here && kindNow() === "video" && R.video) return drawDraft(null);  // the frame on screen now
    if (dr.draw) return drawDraft(dr.draw.frame);
    const fr = await opts.frameFor();
    if (!fr){ toast(kindNow() === "video" ? "Pick the video again to draw on its frames" : "The picture is not on this device"); return; }
    drawDraft(fr);
  }, "Draw"); pen.innerHTML = ico("pen", 19);
  const paintPen = () => pen.classList.toggle("on", !!dr.draw);
  async function drawDraft(fr){
    const rv = R;
    if (!await ensureName() || R !== rv) return;
    const done = (list) => {
      if (R !== rv) return;
      dr.draw = framesDraw(list);
      paintAtts(); paint(); paintPen();
      if (opts.onChange) opts.onChange();
    };
    // A new note on a video: drawn over the player, on as many frames as wanted (from the one asked for).
    if (opts.multi && kindNow() === "video" && rv.video){
      if (fr && fr.ctx && fr.ctx.t != null) seekTo(fr.ctx.t);
      drawVideo({ frames: drawFrames(dr.draw), onDone: done });
      return;
    }
    // A new note or a reply is drawn on the clean picture: the other notes' drawings stay on theirs.
    drawCanvas({ src: fr.url, vb: fr.vb, base: [], items: dr.draw ? dr.draw.items : [], onDone: (items) => done(items.length ? [{ frame: fr, items }] : []) });
  }
  let sending = false;  // a second tap while the pictures are being stored must not send it twice
  send.onclick = async () => {
    if (sending || !can()) return;
    const rv = R;
    sending = true; send.disabled = true;
    try {
      if (!await ensureName()) return;
      for (const a of dr.shots) await DB.put("shots", { id: a.id, blob: a.blob });
      if (R !== rv || rv.drafts[opts.key] !== dr) return;
      dr.shots.forEach((a) => rv.shotUrls.set(a.id, a.url));
      delete rv.drafts[opts.key];
      opts.onSend(dr.text.trim(), dr.shots.map((a) => a.id), dr.state, dr.draw);
    } catch (e){ toast("Could not store the pictures: " + (e.message || e), 5000); }
    finally { sending = false; paint(); }
  };
  f.appendChild(atts); f.appendChild(ta); f.appendChild(clip); f.appendChild(pen); f.appendChild(send); f.appendChild(file);
  box.appendChild(f);
  paintAtts(); paint(); paintPen();
  requestAnimationFrame(grow);
  return box;
}

// The new-note bar at the bottom: "+ Note" opens the message field; a video note goes on the frame
// that is on screen when it is sent (or the frame its drawing was made on).
function ctxNow(){
  if (kindNow() !== "video") return null;
  const v = R.video;
  return v ? { t: frameStart(v.currentTime), hold: 0 } : null;
}
function paintNewBar(){
  const nb = els.nb;
  const rn = R.replyTo && R.rows.find((r) => r.id === R.replyTo && r.deleted_at == null);
  if (R.replyTo && !rn) R.replyTo = null;  // the note went (deleted, merged away)
  root.classList.toggle("compose", composing());  // the bar shows over the player too (index.html)
  paintMarkers();  // a new note: only its own frames on the timeline (a reply: its note's)
  const ae = document.activeElement;
  // Typing in the composer the bar shows: leave it alone.
  if ((R.newOpen === true || rn) && ae && ae.tagName === "TEXTAREA" && nb.contains(ae) && ae.closest(".cmp").dataset.key === composeKey()) return;
  nb.textContent = "";
  els.where = null;
  if (rn){ replyBar(nb, rn); return; }
  const canNote = kindNow() !== "video" || !!R.video;
  if (!R.newOpen){
    const row = el("div", "row");
    const add = btn("add", "+ Note", () => { if (!canNote){ toast("Pick the video again to add notes on its frames"); return; } R.newOpen = "focus"; paintNewBar(); });
    row.appendChild(add);
    nb.appendChild(row);
    paintOverlay();
    return;
  }
  const row = el("div", "row"), lab = el("span");
  const where = () => {
    const d = R.drafts["+new"], c = d && d.draw ? d.draw.frame.ctx : ctxNow(), more = d && d.draw && d.draw.more ? d.draw.more.length : 0;
    lab.textContent = "New note" + (c && c.t != null ? " at " + fmtTime(c.t, R.fps) + " · f " + Math.round(c.t * R.fps) : "") + (more ? ` + ${more} more frame${more > 1 ? "s" : ""}` : "");
  };
  row.appendChild(lab);
  row.appendChild(btn("ib", "×", () => {
    const d = R.drafts["+new"];
    if (d && (d.text.trim() || d.shots.length || d.draw)){ ask({ title: "Discard this note?", ok: "Discard", danger: true }).then((y) => { if (y){ delete R.drafts["+new"]; R.newOpen = false; paintNewBar(); } }); return; }
    delete R.drafts["+new"]; R.newOpen = false; paintNewBar();
  }, "Close"));
  nb.appendChild(row);
  nb.appendChild(composer({ key: "+new", placeholder: "Add a note…", status: null, multi: true, frameFor: currentFrame, onChange: () => { where(); paintOverlay(); paintMarkers(); },
    onSend: (text, shots, state, draw) => {
      const t = now(), ctx = draw ? draw.frame.ctx : ctxNow();
      const n = M.newNote({ text, author: who, ctx, shots }, t);
      R.rows.push(n);
      // Every frame drawn on goes with the note, each drawing on its own frame.
      drawFrames(draw).forEach((x) => R.rows.push(...M.drawingRows(x.items, { note: n.id, ctx: M.drawCtx(x.frame.ctx || ctx), z: M.maxZ(R.rows) + 1 }, t)));
      R.newOpen = false;
      dirty();
      if (!R.panel) toast(`Note ${NUM.get(n.id) || ""} added — in the Notes Panel`, 2000);
    } }));
  where();
  els.where = where;
  paintOverlay();  // a new note: the clean picture (with only its own drawing)
  if (R.newOpen === "focus"){ R.newOpen = true; focusLater("+new"); }
}
// The reply bar over the player: "Reply to note 3 at 0:01.05 · f 30", the note's frames to go to
// (the frame on screen lit), × to leave (the frame reached stays), and the message field.
function replyBar(nb, n){
  const id = n.id, row = el("div", "row"), lab = el("span"), fr = el("div", "frs");
  const where = () => {
    const d = R.drafts[id], c = ctxNow(), k = drawFrames(d && d.draw).length;
    lab.textContent = `Reply to note ${NUM.get(id) || ""}` + (c && c.t != null ? " at " + fmtTime(c.t, R.fps) + " · f " + Math.round(c.t * R.fps) : "") + (k ? ` · drawn on ${k} frame${k > 1 ? "s" : ""}` : "");
    const cur = c && c.t != null ? frameIdx(c.t) : null;
    fr.querySelectorAll("button").forEach((b) => b.classList.toggle("on", cur != null && frameIdx(Number(b.dataset.t)) === cur));
  };
  row.appendChild(lab);
  row.appendChild(btn("ib", "×", () => {
    const d = R.drafts[id];
    const go = () => { delete R.drafts[id]; closeReply(); };
    if (d && (d.text.trim() || d.shots.length || d.state || d.draw)){ ask({ title: "Discard this reply?", ok: "Discard", danger: true }).then((y) => { if (y && R.replyTo === id) go(); }); return; }
    go();
  }, "Close"));
  nb.appendChild(row);
  const ts = threadFrames(n);
  if (ts.length > 1){
    ts.forEach((t) => { const b = btn("fr", "f " + Math.round(t * R.fps), () => seekTo(t), "Go to this frame"); b.dataset.t = String(t); fr.appendChild(b); });
    nb.appendChild(fr);
  }
  nb.appendChild(composer({ key: id, placeholder: "Reply", status: M.noteState(n), multi: true, here: true, frameFor: currentFrame,
    onChange: () => { where(); paintOverlay(); paintMarkers(); },
    onSend: (text, shots, state, draw) => {
      R.replyTo = null;
      sendReply(n, text, shots, state, draw);
      closeReply();
      if (!R.panel) toast(`Reply added to note ${NUM.get(id) || ""}`, 2000);
    } }));
  where();
  els.where = where;
  paintOverlay();
}
// The picture on screen as a frame to draw a new note on: the picture, or the paused video frame.
async function currentFrame(){
  const rv = R, vb = [0, 0, docW(), docH()];
  if (!vb[2] || !vb[3]) return null;
  if (kindNow() === "image"){
    const url = rv.url || (await getPicture(rv) || {}).url;
    return url && R === rv ? { url, vb, ctx: null, at: null, base: M.drawings(rv.rows) } : null;
  }
  const v = rv.video;
  if (!v) return null;
  v.pause();
  await whenSettled(rv);  // a seek on its way (right after a scrub): its frame, not the one before
  if (R !== rv) return null;
  if (v.readyState < 2) await seek(v, v.currentTime);
  if (R !== rv) return null;
  const t = snapT(v.currentTime), tag = frameTag(t);  // (not past the last frame: an ended clip)
  let f = rv.frames.get(tag);
  if (!f){
    await painted(v);  // not the frame before the seek (it is cached under this frame's tag)
    if (R !== rv) return null;
    if (v.seeking || !v.paused || snapT(v.currentTime) !== t) return currentFrame();  // moved meanwhile: that frame
    const s = await scaled(v, 1600).catch(() => null);
    if (!s || R !== rv) return null;
    f = { blob: s.blob, w: s.w, h: s.h, url: URL.createObjectURL(s.blob) };
    rv.frames.set(tag, f);
    putIfAlive(rv, "frames", { id: rv.meta.key + "|" + tag, review: rv.meta.key, blob: s.blob, w: s.w, h: s.h });
  }
  const ctx = { t, hold: 0 };
  return { url: f.url, vb, ctx, at: { t, fps: rv.fps }, base: M.drawings(rv.rows).filter((r) => RC.ctxVisible(r.data.ctx, { t, fps: rv.fps })) };
}
async function drawNew(fromViewer){
  // While a reply is written over the player its pencil draws the reply.
  if (R.replyTo){ const p = document.querySelector(`.newbar .cmp[data-key="${R.replyTo}"] .pen`); if (p){ p.click(); return; } }
  if (!await ensureName()) return;
  const rv = R, d = R.drafts["+new"] = R.drafts["+new"] || newDraft();
  const done = (list) => {
    if (R !== rv) return;
    d.draw = framesDraw(list);
    R.newOpen = d.draw || R.newOpen ? "focus" : R.newOpen;
    paintNewBar(); paintMarkers();
  };
  // A video: drawn over the player on as many frames as wanted, the draft's frames kept.
  if (kindNow() === "video" && rv.video){ drawVideo({ frames: drawFrames(d.draw), onDone: done, noPlace: fromViewer === true }); return; }
  const fr = await currentFrame();
  if (!fr){ toast(kindNow() === "video" ? "Pick the video again to draw on its frames" : "The picture is not on this device"); return; }
  if (d.draw && !(await ask({ title: "Replace the drawing?", text: "The new note already has a drawing.", ok: "Replace" }))) return;
  if (R !== rv) return;
  drawCanvas({ src: fr.url, vb: fr.vb, base: [], items: [], noPlace: fromViewer === true, onDone: (items) => { if (items.length) done([{ frame: fr, items }]); } });
}
// [{frame, items}] (any order) → a draft's drawing: the earliest frame first (the note's), the rest in `more`.
function framesDraw(list){
  const l = (list || []).filter((x) => x.items && x.items.length).slice().sort((a, b) => ((a.frame.ctx && a.frame.ctx.t) || 0) - ((b.frame.ctx && b.frame.ctx.t) || 0));
  return l.length ? { frame: l[0].frame, items: l[0].items, more: l.slice(1) } : null;
}
// The video frame on screen now, as a picture (cached by its time). `want`: the time a seek asked
// for, when the player stands on it (its frame's tag, even if the stored time rounds a hair below).
async function frameNow(rv, want){
  const v = rv.video;
  if (!v) return null;
  // Still the old frame (seeking), or moving on (playing): never cache it under a wrong time.
  if (v.seeking || !v.paused) return null;
  if (v.readyState < 2) await seek(v, v.currentTime);
  if (R !== rv || v.seeking) return null;
  // snapT: an ended clip reads currentTime = duration, one past its last frame.
  const cur = snapT(v.currentTime);
  if (!rv.frames.get(frameTag(frameStart(cur)))){
    await painted(v);  // "seeked" comes before the frame is on screen (Safari): grab it after
    if (R !== rv || v.seeking || !v.paused || snapT(v.currentTime) !== cur) return null;
  }
  const on = want != null && (rv.fpsKnown ? frameIdx(want) === frameIdx(cur) : Math.abs(want - cur) < 1e-3);
  const t = frameStart(on ? want : cur), tag = frameTag(t);
  let f = rv.frames.get(tag);
  if (!f){
    const s = await scaled(v, 1600).catch(() => null);
    if (!s || R !== rv) return null;
    f = rv.frames.get(tag);
    if (!f){
      f = { blob: s.blob, w: s.w, h: s.h, url: URL.createObjectURL(s.blob) };
      rv.frames.set(tag, f);
      putIfAlive(rv, "frames", { id: rv.meta.key + "|" + tag, review: rv.meta.key, blob: s.blob, w: s.w, h: s.h });
    }
  }
  return { tag, t, url: f.url };
}

// ---- drawing on a video: several frames, one note ---------------------------------------------
// The canvas over the player with the player's timeline in its foot. Tap the tool in hand to put
// it down: one finger then scrubs (as on the player), a tap plays / pauses (the playing clip is
// painted into the canvas in the picture's place, each frame showing its own drawings; a pause or
// a tool taken up stops on the frame reached), the timeline / steps / marker jumps move to
// another frame, and a tool taken up draws there. Done hands back every frame drawn on —
// [{frame, items}] — for one note. frames: what the draft / note already holds (kept per frame).
async function drawVideo({ frames = [], onDone, noPlace }){
  const rv = R, v = rv.video;
  if (!v || rv.drawS || rv.drawOpening) return;  // one session at a time (a double tap)
  rv.drawOpening = true;
  try { await openDrawVideo(rv, v, frames, onDone, noPlace); } finally { rv.drawOpening = false; }
}
async function openDrawVideo(rv, v, frames, onDone, noPlace){
  let ownPause = !v.paused;  // this pause's event (queued) is not the user's: no second grab
  v.pause();
  // Opens at once on the frame on screen: its picture from the frame cache, else the scrub
  // cache's — the player's own frame replaces it once its seek has landed and it is painted
  // (S.settled, from settle()). Waiting for the seek first was the lag after a scrub. Only with no
  // picture at all is the player waited for.
  let fr = null, early = false;
  const t0 = snapT(posNow()), vb0 = [0, 0, docW(), docH()];
  if (vb0[2] && vb0[3]){
    const kept = rv.frames.get(frameTag(frameStart(t0))), pic = (kept && kept.url) || cachedAt(t0) || (rv.scrub && rv.scrub.near(t0));
    if (pic){ fr = { url: pic, vb: vb0, ctx: { t: frameStart(t0), hold: 0 }, at: { t: frameStart(t0), fps: rv.fps } }; early = !kept; }
  }
  if (!fr){
    await whenSettled(rv);
    if (R !== rv) return;
    fr = await currentFrame();
  }
  if (!fr || R !== rv){ if (R === rv) toast("Could not take this frame"); return; }
  const init = {};
  frames.forEach((x) => { if (x.frame.ctx && x.frame.ctx.t != null) init[frameTag(frameStart(x.frame.ctx.t))] = x.items; });
  const k0 = frameTag(fr.ctx.t), others = Object.assign({}, init);
  delete others[k0];
  const T = makeTransport();
  let h = null, keys = Object.keys(init), capSeq = 0, st = 0, last = fr.ctx.t;
  const S = rv.drawS = {
    times: () => keys.map((k) => Number(k.slice(2))),
    // The frame wanted shows at once (the cached one, as it is — dimming it read as a haze over
    // the video on every scrub) with that frame's drawings… (A step with no exact cached frame:
    // the nearest one rather than the old picture under the new frame's drawings; with no cached
    // picture at all the old one stays, dimmed: it is not this frame.)
    moved: (t) => {
      last = t; capSeq++;
      if (!h) return;
      const pic = cachedAt(t) || (rv.scrub && rv.scrub.near(t));
      h.setFrame(frameTag(t), pic, !pic);
    },
    // …and the player's own frame replaces it when the seek has landed.
    settled: async () => {
      const seq = ++capSeq, f = await frameNow(rv, last);
      if (seq !== capSeq || !h || R !== rv || rv.drawS !== S || !f || f.tag !== frameTag(frameStart(last))) return;
      h.setFrame(f.tag, f.url, false);
    },
  };
  // Playing inside the canvas: the player (hidden under it) is painted into a canvas in the
  // picture's place every frame it presents, and the canvas follows the frame (its drawings).
  let liveSeq = 0, liveC = null;
  const liveStart = () => {
    if (!h || R !== rv || rv.drawS !== S) return;
    const seq = ++liveSeq;
    capSeq++;  // a grab still on its way (the tap's own settle) must not swap the frame mid-play
    if (!liveC){
      liveC = document.createElement("canvas");
      const k = Math.min(1, 1280 / Math.max(v.videoWidth || 1, v.videoHeight || 1));
      liveC.width = Math.max(1, Math.round((v.videoWidth || 16) * k)); liveC.height = Math.max(1, Math.round((v.videoHeight || 9) * k));
    }
    const g = liveC.getContext("2d");
    // The live layer comes up with the first frame presented after play (a play right after a
    // seek would otherwise paint the frame from before it). A frame's stamp sits on its start, and
    // millisecond stamps (WebM) a hair below it: the key is taken a quarter into the frame, as seeks
    // land. rVFC may not fire for a player that is off screen (the panel open; Safari): after
    // 250 ms without a frame, animation frames take over.
    let shown = false, last = 0, raf = false;
    const tick = (_, meta) => {
      if (seq !== liveSeq || !h || v.paused) return;
      last = performance.now();
      try { g.drawImage(v, 0, 0, liveC.width, liveC.height); } catch {}
      if (!shown){ shown = true; h.live(liveC); }
      const mt = meta && meta.mediaTime != null ? meta.mediaTime : v.currentTime;
      h.setFrame(frameTag(snapT(rv.fpsKnown ? mt + 0.25 * frameDur() : mt)), null, false);
      next();
    };
    const next = () => raf || !v.requestVideoFrameCallback ? requestAnimationFrame(() => tick(0, null)) : v.requestVideoFrameCallback(tick);
    const watch = () => {
      if (seq !== liveSeq || !h || v.paused || raf) return;
      if (performance.now() - last > 250){ raf = true; next(); } else setTimeout(watch, 250);
    };
    last = performance.now();
    next();
    setTimeout(watch, 250);
  };
  const liveStop = () => {
    liveSeq++;
    if (h) h.live(null);
  };
  const onPlay = () => liveStart();
  // A plain pause (not one a seek made: seekTo has already moved the canvas): the canvas stops on
  // the frame reached, the player's own picture of it once the frame is grabbed.
  const onPause = () => {
    if (ownPause){ ownPause = false; return; }
    liveStop();
    if (!h || R !== rv || rv.drawS !== S || rv.scrubT != null || rv.want != null) return;
    S.moved(snapT(v.currentTime));
    if (!v.seeking) S.settled();
  };
  v.addEventListener("play", onPlay); v.addEventListener("pause", onPause);
  const finish = () => {
    v.removeEventListener("play", onPlay); v.removeEventListener("pause", onPause);
    liveStop();
    if (!v.paused) v.pause();
    if (liveC){ dropCanvas(liveC); liveC = null; }
    if (rv.drawS === S) rv.drawS = null;
    TPS.delete(T); h = null;
    if (R === rv){ if (R.dragging) dragEnd(); paintMarkers(); paintOverlay(); }  // a drag on its footer ends with it
  };
  h = drawCanvas({ src: fr.url, vb: fr.vb, base: [], items: init[k0] || [], frameKey: k0, noPlace, frames: others, footer: T.el,
    onScrub: (e) => {
      if (R !== rv || (e.phase !== "end" && !durOf())) return;  // a WebM with no duration: nothing to scrub
      if (e.phase === "start"){ st = posNow(); R.dragging = true; }
      else if (e.phase === "move"){ st = scrubStep(st, e.dx, e.dt, e.fine); seekTo(st); }
      else dragEnd();
    },
    onFrames: (ks) => { keys = ks; paintMarks(T); },
    // A tap with no tool: play / pause, as on the player. A tool taken up stops the clip there.
    onTap: () => { if (R === rv && rv.drawS === S) togglePlay(); },
    onTool: (t) => { if (t && !v.paused) v.pause(); },
    onKey: (e) => runHotkeys(e, [["Comma", () => step(-1)], ["Period", () => step(1)], ["ArrowLeft", () => step(-1)], ["ArrowRight", () => step(1)],
      ["Shift+ArrowLeft", () => jumpNote(-1)], ["Shift+ArrowRight", () => jumpNote(1)]]),
    onCancel: finish,
    onDone: async (items, all) => {
      finish();
      const list = [];
      for (const x of all || []){
        const t = Number(x.key.slice(2)), f = rv.frames.get(x.key) || await getFrame(t, rv);
        if (!f) continue;
        list.push({ frame: { url: f.url, vb: fr.vb, ctx: { t, hold: 0 }, at: { t, fps: rv.fps } }, items: x.items });
      }
      if (R === rv) onDone(list);
    } });
  paintMarks(T); paintMarkers();
  // Opened on a cached picture with the player already standing there: its own frame now (on its
  // way, settle() asks when the seek lands).
  if (early && rv.want == null && !v.seeking && rv.scrubT == null) S.settled();
}

// The drawing canvas, opened turned / mirrored as the review's view; its turn / mirror buttons
// change that view.
// Opened from the player (on screen, no full-screen viewer over it), the canvas shows the picture
// exactly where and how the player does — same box, zoom, turn — with the bars floating over it, and
// hands its view back to the player when it closes: drawing only takes the tools up.
// o.noPlace: opened from somewhere else (the full-screen viewer has closed by then, so the check
// for it in playerPlace cannot see it).
function drawCanvas(o){
  const rv = R;
  return DRAW.open(Object.assign({ numOf, view: viewOf(), onView: (vw) => { if (R === rv) setView({ rot: vw.rot, mirror: vw.mirror }); } }, o.noPlace ? {} : playerPlace(), o));
}
function playerPlace(){
  if (!R || !els || !els.stage || R.panel || document.querySelector(".view")) return {};
  const rv = R, st = els.stage, box = () => {
    if (R !== rv || !st.isConnected || rv.panel) return null;
    const b = st.getBoundingClientRect();
    return b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < innerHeight ? b : null;
  };
  if (!box()) return {};
  return { fitBox: box, nav: { z: rv.pv.z, r: rv.pv.r, o: rv.pv.o.slice() },
    onNav: (n) => { if (R === rv){ rv.pv = { z: n.z, r: n.r, o: n.o.slice() }; applyPlayerView(); } } };
}

// ---- full-screen viewer ------------------------------------------------------------------------
// A picture with its drawings, no bar: a round Back button and (when it can be drawn on) a pencil
// float over it. Pinch / double-tap / wheel zoom, drag to pan while zoomed. At fit, a swipe up /
// down goes to the next / previous note (o.nav), a swipe left / right to the next / previous
// picture of the same note (o.side: a video note's frames). Only the Back button (or the system's
// back / Esc) leaves — no swipe closes it.
// o: {url, vb, rows, view, onDraw(), note, label (caption: which frame), nav(dir) / side(dir) →
// Promise<o | null>, onClose(o)}
// The next picture comes in like a strip: the swiped one goes on the way the finger sent it,
// fading out, the next follows it in from that side, one screen behind, fading in (decoded first, at most
// SLIDE_WAIT ms, so it never comes in blank).
const SLIDE_MS = 300, SLIDE_WAIT = 600;
function viewer(o){
  const v = el("div", "view"), cap = el("div", "cap");
  const back = btn("fab back", null, () => close(), "Back"); back.innerHTML = ico("back", 24);
  const pen = btn("fab pencil", null, () => { const cur = o; close(); cur.onDraw(); }, "Draw on it"); pen.innerHTML = ico("pen", 24);
  // The caption across the whole width at the foot, the pencil just over it (whatever its height).
  const foot = el("div", "vfoot");
  foot.appendChild(pen); foot.appendChild(cap);
  v.appendChild(foot); v.appendChild(back);
  let box = null, V = { z: 1, x: 0, y: 0 }, off = [0, 0], busyNav = false;
  const close = () => {
    v.remove(); window.removeEventListener("resize", fit); document.removeEventListener("keydown", onKey, true);
    const i = sheets.indexOf(close); if (i >= 0) sheets.splice(i, 1);
    if (o.onClose) o.onClose(o);
  };
  // slide {axis: "x" | "y", dir: 1 (next: comes from the right / bottom) | -1}: the old picture goes
  // on from where the finger left it, fading out; the new one follows it in, a screen behind.
  async function show(no, slide){
    const nb = el("div", "vb");
    const img = el("img"); img.src = no.url; img.alt = ""; img.draggable = false; nb.appendChild(img);
    if (no.rows && no.rows.length) nb.appendChild(overlay(no.vb, no.rows));
    if (slide){
      await Promise.race([img.decode ? img.decode().catch(() => {}) : Promise.resolve(), new Promise((r) => setTimeout(r, SLIDE_WAIT))]);
      if (!v.isConnected) return;
    }
    const was = box, wasV = V, wasOff = off;
    o = no; box = nb;
    v.insertBefore(box, foot);
    pen.hidden = !o.onDraw;
    cap.textContent = "";
    cap.className = "cap" + (o.note ? " " + M.noteState(o.note) : "");
    if (o.note){
      cap.appendChild(el("span", "num", String(NUM.get(o.note.id) || "")));
      const c = o.note.data.ctx, lab = o.label || (c && c.t != null && R ? fmtTime(c.t, R.fps) : "");
      if (lab) cap.appendChild(el("span", "fr", lab));
      const tx = o.text != null ? o.text : o.note.data.text;  // a reply's picture: the reply's words
      if (tx || !lab) cap.appendChild(el("span", "tx", tx || "Note"));
    } else if (o.label) cap.appendChild(el("span", "fr", o.label));
    off = [0, 0];
    fit();
    if (!was) return;
    if (!slide || !was.animate){ was.remove(); return; }
    // Along the swipe's axis: the old one from where it was let go to a screen away, the new one
    // from a screen (minus that) behind it to its place — the two move as one strip.
    const ax = slide.axis === "x", D = (ax ? innerWidth : innerHeight) * slide.dir, k = ax ? 0 : 1;
    const at = (vv, o2, d) => `translate(${vv.x + o2[0] + (ax ? d : 0)}px,${vv.y + o2[1] + (ax ? 0 : d)}px) scale(${vv.z})`;
    const ease = "cubic-bezier(.25,.8,.3,1)";
    // The incoming one comes out of transparency as the outgoing one fades.
    box.animate([{ transform: at(V, [0, 0], D + wasOff[k]), opacity: 0 }, { transform: at(V, [0, 0], 0), opacity: 1 }], { duration: SLIDE_MS, easing: ease });
    was.animate([{ transform: at(wasV, wasOff, 0), opacity: 1 }, { transform: at(wasV, [0, 0], -D), opacity: 0 }], { duration: SLIDE_MS, easing: ease, fill: "forwards" }).onfinish = () => was.remove();
    setTimeout(() => was.remove(), SLIDE_MS + 200);  // onfinish never comes for a node already gone
  }
  function fit(){
    const vw = o.view || { rot: 0, mirror: false };  // per picture: an attached one is not turned
    const W = innerWidth, H = innerHeight, a = vw.rot % 180 ? o.vb[3] / o.vb[2] : o.vb[2] / o.vb[3];
    let w = W, h = W / a;
    if (h > H){ h = H; w = H * a; }
    box.style.width = w + "px"; box.style.height = h + "px";
    box.querySelectorAll(":scope > img, :scope > svg").forEach((n) => turnEl(n, w, h, vw));
    V = { z: 1, x: (W - w) / 2, y: (H - h) / 2 };
    apply();
  }
  const apply = (anim) => {
    box.style.transition = anim ? "transform .2s ease-out" : "";
    box.style.transform = `translate(${V.x + off[0]}px,${V.y + off[1]}px) scale(${V.z})`;
  };
  const zoomAt = (x, y, z) => { z = RC.clamp(z, 1, 12); const lx = (x - V.x) / V.z, ly = (y - V.y) / V.z; V = { z, x: x - lx * z, y: y - ly * z }; if (z === 1) fit(); else apply(); };
  // Swipes at fit: the picture follows the finger along the axis it set off on; up / down walks
  // the notes (o.nav), sideways the note's own pictures (o.side). The next one slides in behind it.
  async function navigate(dir, axis = "y"){
    if (busyNav){ off = [0, 0]; apply(true); return; }
    const fn = axis === "x" ? o.side : o.nav;
    // Busy until the next picture is shown: a second swipe (or Back) in between would act on the old one.
    // The swiped picture waits where it was let go while the next one loads, then both slide.
    const next = fn ? await (busyNav = true, fn(dir)).catch(() => null) : null;
    if (!v.isConnected){ busyNav = false; return; }
    if (!next){
      busyNav = false;
      off = [0, 0]; apply(true);
      if (axis === "y") toast(dir > 0 ? "No later note" : "No earlier note", 1500);
      else if (o.side) toast(dir > 0 ? "The note's last picture" : "The note's first picture", 1500);
      return;
    }
    await show(next, { axis, dir });
    setTimeout(() => { busyNav = false; }, SLIDE_MS);  // a swipe mid-slide would stack two
  }
  const pts = new Map();
  let g = null, lastTap = 0, sw = null;
  const start = () => {
    const p = [...pts.values()];
    if (!p.length){ g = null; return; }
    const m = p.length > 1 ? [(p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2] : [p[0].x, p[0].y];
    if (sw && sw.axis && (off[0] || off[1])){ off = [0, 0]; apply(true); }  // a swipe that became a pinch
    g = { v: { ...V }, m, d: p.length > 1 ? RC.hyp(p[0].x - p[1].x, p[0].y - p[1].y) : 0 };
    sw = p.length === 1 && V.z <= 1.01 ? { x: p[0].x, y: p[0].y, axis: null } : null;
  };
  v.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".fab, .cap .tx")) return;  // (the caption's words scroll on their own)
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { v.setPointerCapture(e.pointerId); } catch {}
    start();
  });
  v.addEventListener("pointermove", (e) => {
    const q = pts.get(e.pointerId);
    if (!q || !g) return;
    q.x = e.clientX; q.y = e.clientY;
    if (sw){
      const dx = q.x - sw.x, dy = q.y - sw.y;
      if (!sw.axis && Math.abs(dx) + Math.abs(dy) > 10) sw.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (sw.axis){ off = sw.axis === "x" ? [dx, 0] : [0, dy]; apply(); }
      return;
    }
    const p = [...pts.values()];
    const m = p.length > 1 ? [(p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2] : [p[0].x, p[0].y];
    const z = p.length > 1 && g.d ? RC.clamp(g.v.z * RC.hyp(p[0].x - p[1].x, p[0].y - p[1].y) / g.d, 1, 12) : g.v.z;
    const lx = (g.m[0] - g.v.x) / g.v.z, ly = (g.m[1] - g.v.y) / g.v.z;
    V = { z, x: m[0] - lx * z, y: m[1] - ly * z };
    apply();
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    const q = pts.get(e.pointerId), moved = g && Math.abs(q.x - g.m[0]) + Math.abs(q.y - g.m[1]) > 10;
    pts.delete(e.pointerId);
    if (sw && sw.axis && e.type === "pointerup"){
      const dx = q.x - sw.x, dy = q.y - sw.y;
      sw = null;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy)){ navigate(dx < 0 ? 1 : -1, "x"); start(); return; }
      if (Math.abs(dy) > 70) { navigate(dy < 0 ? 1 : -1); start(); return; }
      off = [0, 0]; apply(true);
    } else if (sw && sw.axis){ sw = null; off = [0, 0]; apply(true); }
    if (!pts.size && !moved && e.type === "pointerup"){
      const t = now();
      if (t - lastTap < 320){ zoomAt(e.clientX, e.clientY, V.z > 1.2 ? 1 : 2.5); lastTap = 0; } else lastTap = t;
    }
    if (V.z <= 1.01 && (off[0] || off[1]) === 0) fit();
    start();
  };
  v.addEventListener("pointerup", up); v.addEventListener("pointercancel", up);
  const inText = (e) => !!(e.target.closest && e.target.closest(".cap .tx"));
  v.addEventListener("wheel", (e) => { if (inText(e)) return; e.preventDefault(); zoomAt(e.clientX, e.clientY, V.z * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  v.addEventListener("touchmove", (e) => { if (!inText(e)) e.preventDefault(); }, { passive: false });
  function onKey(e){
    if (sheets[sheets.length - 1] !== close) return;
    runHotkeys(e, [["ArrowDown", () => navigate(1)], ["ArrowUp", () => navigate(-1)], ["ArrowLeft", () => navigate(-1, "x")], ["ArrowRight", () => navigate(1, "x")]]);
  }
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", fit);
  document.body.appendChild(v);
  sheets.push(close);
  show(o);
}
async function openPicture(){
  const url = R.url || (await getPicture() || {}).url;
  if (!url) return;
  viewer({ url, vb: [0, 0, docW() || 1, docH() || 1], rows: stageDrawings(), view: viewOf(), onDraw: () => drawNew(true) });
}
// A note's pictures, full screen. Sideways walks the whole thread in order (threadItems): the
// note's frames (a video: in time order), its attached pictures, then each reply's drawn frames
// and attached pictures — the caption says which ("0:01.05 · f 30 · 2 / 7", "↳ Bob · Picture …").
// Up / down walks the notes in the list's order (the filter on), each from its first picture. The
// list / player follow the note and frame it was left on. from: where the viewer was opened ({id, t}).
function noteFrameList(n){
  const c = n.data.ctx;
  if (kindNow() !== "video" || !c || c.t == null) return [];
  const by = new Map();
  [c.t, ...M.noteFrameTimes(R.rows, n)].forEach((t) => { if (!by.has(frameKey(t))) by.set(frameKey(t), t); });
  return [...by.values()].sort((a, b) => a - b);
}
// Items: {kind: "frame", t?, rid?} (t: a video frame; rid: a reply's drawing) | {kind: "shot", id, rid?}.
function threadItems(n){
  const out = [], video = kindNow() === "video";
  // A picture review: the picture with the note's drawings, always (up / down visits every note).
  if (video) noteFrameList(n).forEach((t) => out.push({ kind: "frame", t }));
  else out.push({ kind: "frame" });
  (n.data.shots || []).forEach((id) => out.push({ kind: "shot", id: String(id) }));
  M.liveReplies(n).forEach((r) => {
    if (r.event) return;
    const rt = replyFrameTimes(n, r.id);
    if (rt) (video ? rt : [null]).forEach((t) => out.push(t == null ? { kind: "frame", rid: r.id } : { kind: "frame", t, rid: r.id }));
    (r.shots || []).forEach((id) => out.push({ kind: "shot", id: String(id), rid: r.id }));
  });
  return out;
}
const sameItem = (a, b) => a.kind === b.kind && (a.rid || null) === (b.rid || null) &&
  (a.kind === "shot" ? a.id === b.id : (a.t == null) === (b.t == null) && (a.t == null || frameKey(a.t) === frameKey(b.t)));
// One item as a picture: {url, vb, rows, at} or null (not on this device).
async function loadItem(n, it, rv = R){
  if (it.kind === "shot"){
    const url = await shotUrl(it.id);
    if (!url) return null;
    const im = new Image(); im.src = url;
    await (im.decode ? im.decode().catch(() => {}) : new Promise((ok) => { im.onload = im.onerror = ok; }));
    if (!im.naturalWidth) return null;  // a picture that does not decode: skipped
    return { url, vb: [0, 0, im.naturalWidth, im.naturalHeight], rows: [], at: null, shot: true };
  }
  let f;
  if (it.t != null){
    if (!docW() || !docH()) return null;
    const fr = await getFrame(it.t, rv);
    if (!fr || R !== rv) return null;
    f = { url: fr.url, vb: [0, 0, docW(), docH()], ctx: { t: it.t, hold: 0 }, at: { t: it.t, fps: rv.fps } };
  } else {
    f = await noteFrame(n);
    if (!f || R !== rv) return null;
  }
  return Object.assign(f, { rows: it.rid ? drawingsOn(f, { reply: it.rid }) : drawingsOn(f) });
}
// prevAt: the frame looked at before (an attached picture keeps it, so Back still follows it).
function threadView(n, items, i, f, from, prevAt){
  const rv = R, it = items[i], t0 = it.t != null ? it.t : f.at ? f.at.t : null;
  const from0 = from || { id: n.id, t: t0 };
  const rep = it.rid ? (n.data.replies || []).find((x) => x.id === it.rid) : null;
  const where = it.kind === "shot" ? "Picture" : t0 != null ? `${fmtTime(t0, R.fps)} · f ${Math.round(t0 * R.fps)}` : "Drawing";
  const label = (rep ? `↳ ${rep.author || "Reply"} · ` : "") + where + (items.length > 1 ? ` · ${i + 1} / ${items.length}` : "");
  return { url: f.url, vb: f.vb, view: f.shot ? null : viewOf(), note: n, label, text: rep ? rep.text || "" : undefined,
    at: it.kind === "shot" ? prevAt || null : f.at, rows: f.rows,
    onDraw: f.shot ? null : () => {
      if (R !== rv) return;
      // A video note: the reply over the player, drawn on the frame looked at.
      if (startReply(n, t0)){ const p = document.querySelector(`.newbar .cmp[data-key="${n.id}"] .pen`); if (p) p.click(); return; }
      setPanel(true); R.openReply[n.id] = true; renderNotes();
      const box = document.querySelector(`.cmp[data-key="${n.id}"]`);
      if (box) box.querySelector(".pen").click(); },
    nav: async (dir) => {
      if (R !== rv) return null;
      const list = listedNotes();
      for (let k = list.findIndex((x) => x.id === n.id) + dir; k >= 0 && k < list.length; k += dir){
        const its = threadItems(list[k]);
        for (let j = 0; j < its.length; j++){
          const f2 = await loadItem(list[k], its[j], rv);
          if (R !== rv) return null;
          if (f2) return threadView(list[k], its, j, f2, from0, null);
        }
      }
      return null;
    },
    side: items.length > 1 ? async (dir) => {
      for (let j = i + dir; j >= 0 && j < items.length; j += dir){
        const f2 = await loadItem(n, items[j], rv);
        if (R !== rv) return null;
        if (f2) return threadView(n, items, j, f2, from0, it.kind === "shot" ? prevAt : f.at);
      }
      return null;
    } : null,
    onClose: (last) => {
      if (R !== rv || !last.note) return;
      const t = last.at ? last.at.t : null;
      if (last.note.id !== from0.id || (t != null && (from0.t == null || frameKey(t) !== frameKey(from0.t)))) showNote(last.note, t);
    } };
}
// Opens note n's thread at item `at` (a frame / picture tapped in its card) — the note selected; the
// player is left alone while the viewer is up (a seek now would grab and encode a frame on the main
// thread right under the first swipe: the slide stuttered on phones), Back puts it on the frame
// last looked at (onClose → showNote).
async function openThread(n, at){
  if (R && !composing()){ R.curNote = n.id; paintCurrent(); }
  const rv = R, items = threadItems(n);
  let i = items.findIndex((x) => sameItem(x, at));
  if (i < 0){ items.unshift(at); i = 0; }
  const f = await loadItem(n, items[i], rv);
  if (!f || R !== rv){ if (R === rv) toast("That picture is not on this device"); return; }
  viewer(threadView(n, items, i, f));
}
// Brings a note forward: its card into view in the list, the player onto its frame (or the frame
// of it given: one of its other frames).
function showNote(n, at){
  const c = n.data.ctx, t = at != null ? at : c && c.t;
  R.curNote = n.id;
  if (R.video && t != null) seekTo(t);
  paintCurrent();
  const card = els && els.notes.querySelector(`.note[data-id="${n.id}"]`);
  if (card) card.scrollIntoView({ block: "nearest" });
}
function openShot(url){
  const im = new Image();
  im.onload = () => viewer({ url, vb: [0, 0, im.naturalWidth || 1, im.naturalHeight || 1], rows: [] });
  im.src = url;
}

// ---- actions, exports --------------------------------------------------------------
function reviewActions(){
  const items = [
    { label: "PDF report", note: "share / save", fn: () => exportReport("pdf") },
    { label: "Web page (HTML)", note: "opens anywhere", fn: () => exportReport("html") },
    { label: "Review file for Sight (.srev)", fn: exportSrev },
    { label: "Merge a review file…", fn: () => { const p = picker("", false, (fs) => importReviewFile(fs[0], R.meta.key)); document.body.appendChild(p); p.click(); setTimeout(() => p.remove(), 60000); } },
    R.file && !R.meta.kept ? { label: "Remember the file on this device", note: fmtBytes(R.file.size), fn: keepCopy } : null,
    R.meta.kept ? { label: "Forget the file on this device", note: "frees " + fmtBytes(R.meta.asset.size), fn: dropCopy } : null,
    { label: R.file ? "Use another copy of the file…" : "Pick the file…", fn: () => { const p = picker(kindNow() === "video" ? "video/*" : "image/*", false, (fs) => rebind(fs[0])); document.body.appendChild(p); p.click(); setTimeout(() => p.remove(), 60000); } },
    { label: "Your name: " + (who || "—"), fn: setName },
    { label: "Settings (theme, storage)…", fn: settings },
    { label: "Delete this review…", danger: true, fn: () => deleteReview(R.meta) },
  ];
  menu(R.meta.asset.name, items);
}
// A finished file: Share (Save to Files, messengers…) needs a fresh tap, so it is offered here.
function offerFile(blob, name, what){
  const file = new File([blob], name, { type: blob.type || "application/octet-stream" });
  const canShare = !!(navigator.canShare && navigator.share && (() => { try { return navigator.canShare({ files: [file] }); } catch { return false; } })());
  sheet((sh, close) => {
    sh.appendChild(el("h2", "", what + " ready"));
    sh.appendChild(el("p", "", `${name} · ${fmtBytes(blob.size)}`));
    const a = el("div", "acts");
    a.appendChild(btn("btn", "Close", close));
    a.appendChild(btn(canShare ? "btn" : "btn primary", "Download", () => {
      const u = URL.createObjectURL(blob), l = el("a");
      l.href = u; l.download = name; document.body.appendChild(l); l.click(); l.remove();
      setTimeout(() => URL.revokeObjectURL(u), 30000);
    }));
    if (canShare) a.appendChild(btn("btn primary", "Share…", async () => {
      try { await navigator.share({ files: [file], title: name }); close(); }
      catch (e){ if (e && e.name !== "AbortError") toast("Sharing failed: " + (e.message || e)); }
    }));
    sh.appendChild(a);
  });
}
function reportSrc(){
  return {
    picture: () => getPicture(),
    frameAt: (t) => getFrame(t),
    shot: async (id) => { const s = await DB.get("shots", id).catch(() => null); return s ? s.blob : null; },
  };
}
async function exportReport(type){
  await flush();
  const b = busy(type === "pdf" ? "Making the PDF…" : "Making the web page…");
  try {
    const a = Object.assign({}, R.meta.asset);
    const payload = await gatherReport({ asset: a, rows: R.rows, fps: R.fps, author: who, appLabel: APP_LABEL, src: reportSrc(), progress: (i, n) => b.set(`Frames ${i + 1} / ${n}…`) });
    if (a.kind === "video" && payload.notes.some((n) => !n.frame) && !R.grab) toast("Some frames are not on this device: pick the video again to include them", 5000);
    b.set(type === "pdf" ? "Laying out the pages…" : "Writing the page…");
    const stem = safeName(stemOf(a.name) + " review");
    if (type === "pdf"){
      const out = await toPdf(payload);
      offerFile(out.blob, stem + ".pdf", `PDF (${out.pages} page${out.pages > 1 ? "s" : ""})`);
    } else offerFile(await toHtml(payload), stem + ".html", "Web page");
  } catch (e){
    console.error(e);
    toast("Export failed: " + (e.message || e), 5000);
  } finally { b.done(); }
}
async function exportSrev(){
  await flush();
  if (!await ensureName()) return;
  const shots = {};
  for (const id of M.shotIds(R.rows)){
    const s = await DB.get("shots", id).catch(() => null);
    if (s) shots[id] = await blobToDataUrl(s.blob);
  }
  const pkg = M.buildPackage({ asset: R.meta.asset, rows: R.rows, shots, author: who, app: APP_LABEL + " (phone)" });
  const name = safeName(stemOf(R.meta.asset.name) + " review" + (who ? " - " + who : "")) + ".srev";
  offerFile(new Blob([JSON.stringify(pkg)], { type: "application/json" }), name, "Review file");
}

// ---- keys (desktop / iPad keyboard), through Sight's one shortcut rule -----------------------
document.addEventListener("keydown", (e) => {
  if (document.querySelector(".draw")) return;  // the canvas has its own keys
  if (sheets.length){ runHotkeys(e, [["Escape", () => { sheets[sheets.length - 1](); }]]); return; }
  if (e.target.closest && e.target.closest("input, textarea, select")) return;
  if (e.code === "Space" && e.target.closest && e.target.closest("button")) return;
  if (!R || !R.video) return;
  runHotkeys(e, [
    ["Space", () => togglePlay()], ["Comma", () => step(-1)], ["Period", () => step(1)],
    ["ArrowLeft", () => step(-1)], ["ArrowRight", () => step(1)],
    ["Shift+ArrowLeft", () => jumpNote(-1)], ["Shift+ArrowRight", () => jumpNote(1)],
  ]);
});
// An empty reply field closes when the user taps elsewhere (as on the HTML page).
document.addEventListener("click", (e) => {
  // A target gone from the page was re-rendered by its own handler (e.g. the Reply button that
  // just opened this field).
  if (!R || !els || !e.target.isConnected || e.target.closest(".view, .draw, .back, .cmp, .newbar")) return;
  let changed = false;
  Object.keys(R.openReply).forEach((k) => {
    const d = R.drafts[k], card = els.notes.querySelector(`.note[data-id="${k}"]`);
    if (card && card.contains(e.target)) return;
    if (d && (d.text.trim() || d.shots.length || d.state || d.draw)) return;
    delete R.openReply[k]; delete R.drafts[k]; changed = true;
  });
  if (changed) renderNotes();
});

// ---- service worker: offline + "new version — reload" -------------------------------------------
function initSW(){
  if (!("serviceWorker" in navigator) || VERSION === "dev") return;
  const bar = document.getElementById("update");
  let reg = null, asked = false, reloading = false;
  const offer = () => { if (reg && reg.waiting && navigator.serviceWorker.controller) bar.hidden = false; };
  document.getElementById("reload").onclick = () => { asked = true; if (reg && reg.waiting) reg.waiting.postMessage({ type: "skip" }); else location.reload(); };
  // Only the update the user asked for reloads the page (the first install also changes the
  // controller, via clients.claim, and must not reload a review that is being worked on).
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (!asked || reloading) return; reloading = true; flush().finally(() => location.reload()); });
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((r) => {
    reg = r;
    offer();
    r.addEventListener("updatefound", () => {
      const w = r.installing;
      if (w) w.addEventListener("statechange", () => { if (w.state === "installed") offer(); });
    });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") r.update().catch(() => {}); });
  }).catch((e) => console.warn("service worker", e));
}

// The review screen never scrolls as a whole (the list scrolls inside it); a focus or
// scrollIntoView must not shift it.
root.addEventListener("scroll", () => { if (root.scrollTop || root.scrollLeft){ root.scrollTop = 0; root.scrollLeft = 0; } });
initSW();
route();
// For tests and debugging only.
window.__sightReview = { get R(){ return R; }, DB, M, flush, openMedia, importReviewFile, drawingsOn };
