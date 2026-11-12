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
const VERSION = window.SIGHT_REVIEW_VERSION && !window.SIGHT_REVIEW_VERSION.includes("%%") ? window.SIGHT_REVIEW_VERSION : "dev";
const APP_VER = VERSION.split("-")[0];
const APP_LABEL = "Sight Review " + APP_VER;
const SVGNS = "http://www.w3.org/2000/svg";
const root = document.getElementById("app");

// ---- small helpers -----------------------------------------------------------------------------
function el(tag, cls, text){ const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
function btn(cls, text, fn, title){ const b = el("button", cls, text); b.type = "button"; if (fn) b.onclick = fn; if (title){ b.title = title; b.setAttribute("aria-label", title); } return b; }
const ICONS = {
  back: '<path d="m15 5-7 7 7 7"/>', more: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/>', pause: '<path d="M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z" fill="currentColor"/>',
  prev: '<path d="M14 6 8 12l6 6"/>', next: '<path d="m10 6 6 6-6 6"/>',
  stepb: '<path d="M6 5v14"/><path d="M18 6 10 12l8 6z" fill="currentColor"/>', stepf: '<path d="M18 5v14"/><path d="m6 6 8 6-8 6z" fill="currentColor"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  pen: '<path d="M4 20l1-4.5L16 4.5a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="M14 20h6"/>',
  clip: '<path d="m20.5 11.5-8.3 8.3a5.2 5.2 0 0 1-7.4-7.4l8.6-8.6a3.5 3.5 0 0 1 4.9 4.9l-8.6 8.6a1.7 1.7 0 0 1-2.5-2.5l7.9-7.9"/>',
  send: '<path d="M3.4 20.4 21 12 3.4 3.6 3.4 10.2 15 12 3.4 13.8z" fill="currentColor" stroke="none"/>',
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
// url}), shotUrls, drafts, openReply, newOpen, filter, hide}
let R = null;
const kindNow = () => R && R.meta.asset.kind;
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

async function renderHome(){
  document.title = "Sight Review";
  root.textContent = "";
  root.className = "home";
  const bar = el("header", "bar"), ttl = el("div", "ttl");
  ttl.appendChild(el("b", "", "Sight Review"));
  ttl.appendChild(el("span", "", "Reviews stay on this device"));
  bar.appendChild(el("span")); bar.appendChild(ttl); bar.appendChild(ibtn("gear", "Settings", settings));
  root.appendChild(bar);
  const main = el("main");
  const opens = el("div", "opens");
  const l1 = el("label", "main"), l2 = el("label");
  l1.appendChild(el("b", "", "Photo or video")); l1.appendChild(el("small", "", "from the library or camera roll"));
  l1.appendChild(picker("image/*,video/*", false, openAny));
  l2.appendChild(el("b", "", "Open a file…")); l2.appendChild(el("small", "", "Files: media or a .srev review"));
  l2.appendChild(picker("", false, openAny));
  opens.appendChild(l1); opens.appendChild(l2);
  main.appendChild(opens);
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
  const metas = (await DB.all("reviews").catch(() => [])).sort((a, b) => (b.opened || 0) - (a.opened || 0));
  if (!metas.length){ list.appendChild(el("p", "empty", "No reviews yet. Open a picture or a video to start one, or open a .srev file someone sent you.")); return; }
  list.appendChild(el("h2", "", "Reviews"));
  metas.forEach((m) => {
    const it = btn("item", null, () => openReview(m.key, null)), th = el("span", "th"), tx = el("span", "tx");
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
    dragToBin(it, m);
    list.appendChild(it);
  });
  list.appendChild(el("p", "foot", "Press and hold a review, then drag it onto the bin to delete it."));
}
// Press and hold a review (a mouse may just drag it): it lifts, a bin appears at the bottom, and
// dropping it there deletes it (after the usual question). Let go without moving: the menu.
function dragToBin(it, m){
  let st = null, lp = null, lifted = false, ghost = null, bin = null, over = false, fired = false;
  const overBin = (x, y) => { if (!bin) return false; const r = bin.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top - 12 && y <= r.bottom; };
  const lift = () => {
    if (!st) return;
    lifted = true; fired = true;
    if (navigator.vibrate) try { navigator.vibrate(12); } catch {}
    const r = it.getBoundingClientRect();
    ghost = it.cloneNode(true); ghost.classList.add("ghost");
    Object.assign(ghost.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px" });
    st.gx = r.left - st.x; st.gy = r.top - st.y;
    document.body.appendChild(ghost);
    it.classList.add("lifted");
    try { it.setPointerCapture(st.id); } catch {}  // a mouse held still, then moved off the item
    bin = el("div", "bin");
    bin.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13"/></svg><span>Drop here to delete</span>';
    document.body.appendChild(bin);
    requestAnimationFrame(() => bin && bin.classList.add("on"));
  };
  const end = () => {
    clearTimeout(lp); lp = null;
    if (ghost) ghost.remove();
    if (bin) bin.remove();
    ghost = bin = null; lifted = false; over = false; st = null;
    it.classList.remove("lifted");
  };
  let lastType = "mouse", downAt = 0;
  it.addEventListener("pointerdown", (e) => {
    lastType = e.pointerType; downAt = performance.now();
    if (e.pointerType === "mouse" && e.button !== 0) return;
    fired = false;
    st = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, mouse: e.pointerType === "mouse" };
    lp = setTimeout(lift, 420);
  });
  it.addEventListener("pointermove", (e) => {
    if (!st || e.pointerId !== st.id) return;
    const far = Math.abs(e.clientX - st.x) + Math.abs(e.clientY - st.y) > 8;
    if (!lifted){
      if (!far) return;
      clearTimeout(lp);
      if (st.mouse) lift();
      else { st = null; return; }  // a finger moving before the hold: the list scrolls
    }
    if (far) st.moved = true;
    ghost.style.left = e.clientX + st.gx + "px"; ghost.style.top = e.clientY + st.gy + "px";
    over = overBin(e.clientX, e.clientY);
    bin.classList.toggle("hot", over);
    ghost.classList.toggle("hot", over);
  });
  // A lifted review does not scroll the page under the finger.
  it.addEventListener("touchmove", (e) => { if (lifted) e.preventDefault(); }, { passive: false });
  it.addEventListener("pointerup", (e) => {
    if (!st || e.pointerId !== st.id){ end(); return; }
    const drop = lifted && over, menuNow = lifted && !st.moved;
    end();
    if (drop) deleteReview(m);
    else if (menuNow) reviewMenu(m);
  });
  it.addEventListener("pointercancel", end);
  it.addEventListener("lostpointercapture", () => { if (lifted) end(); });
  it.addEventListener("click", (e) => { if (fired){ e.stopImmediatePropagation(); e.preventDefault(); fired = false; } }, true);
  // Right click / the menu key: the menu. A touch's long press is the lift above, not a menu.
  it.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (st || lifted || (lastType !== "mouse" && e.button !== 2 && performance.now() - downAt < 1500)) return;
    reviewMenu(m);
  });
}
function reviewMenu(m){
  menu(m.asset.name, [{ label: "Open", fn: () => openReview(m.key, null) }, { label: "Delete this review…", danger: true, fn: () => deleteReview(m) }]);
}
async function deleteReview(m){
  if (!await ask({ title: "Delete this review?", text: `“${m.asset.name}”: its notes, replies, drawings and pictures on this device. Export a .srev first to keep them.`, ok: "Delete", danger: true })) return;
  await flush();
  const mine = (await DB.get("rows", m.key)) || { rows: [] }, shared = new Set();
  for (const o of await DB.all("reviews")){
    if (o.key === m.key) continue;
    const rr = await DB.get("rows", o.key);
    if (rr) M.shotIds(rr.rows).forEach((s) => shared.add(s));
  }
  await DB.deleteReview(m.key, M.shotIds(mine.rows), shared);
  if (R && R.meta.key === m.key){ closeReview(); history.replaceState(null, "", location.pathname + location.search); }
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
    frames: new Map(), shotUrls: new Map(), drafts: {}, openReply: {}, newOpen: false, filter: "all", hide: false, scrubT: null, want: null, dragging: false, panel: false, cacheF: 0, drawS: null };
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
    if (a.kind === "video" && !rv.fpsKnown){
      const f = await videoFps(file);
      if (f){ rv.fps = f.fps; rv.fpsKnown = true; rv.meta.fps = f.fps; }
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
// The player fills the screen above the new-note bar, with the review's controls in a header over
// the picture and the transport over its foot. Under it the thin Notes Panel bar: a tap (or a swipe
// up, on it or on the picture) slides the player, same size, up off the screen and the notes in;
// the bar then holds the status filters and an arrow back to the player.
let els = null;  // the review screen's parts
let nbRO = null;
function renderReview(){
  const a = R.meta.asset;
  document.title = a.name + " — Sight Review";
  root.textContent = ""; root.className = "review" + (R.panel ? " open" : "");
  const slide = el("div", "slide"), player = el("div", "player"), stage = el("div", "stage");
  const hdr = el("header", "hdr"), r1 = el("div", "row"), r2 = el("div", "row"), ttl = el("div", "ttl");
  ttl.appendChild(el("b", "", a.name));
  const sub = el("span");
  ttl.appendChild(sub);
  r1.appendChild(ibtn("back", "All reviews", leaveReview));
  r1.appendChild(ttl);
  r1.appendChild(ibtn("more", "Export and more", reviewActions));
  hdr.appendChild(r1); hdr.appendChild(r2);
  const tp = el("div", "tp");
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
  pb.appendChild(ibtn("up", "Back to the player", () => setPanel(false)));
}
function bindPanelBar(pb){
  let y0 = null;
  pb.addEventListener("pointerdown", (e) => { y0 = R && !R.panel ? e.clientY : null; });
  pb.addEventListener("pointermove", (e) => { if (y0 != null && y0 - e.clientY > 24){ y0 = null; setPanel(true); } });
  pb.addEventListener("click", (e) => { if (R && !R.panel && !e.target.closest("button")) setPanel(true); });
}
// A swipe up on the picture opens the panel too (sideways belongs to the scrub).
function bindStageSwipe(stage){
  let s = null;
  stage.addEventListener("pointerdown", (e) => { s = e.pointerType === "mouse" ? null : { id: e.pointerId, x: e.clientX, y: e.clientY }; });
  stage.addEventListener("pointermove", (e) => {
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)){ s = null; return; }
    if (dy < -40 && -dy > Math.abs(dx) * 1.5){ s = null; stage.dataset.swiped = String(performance.now()); setPanel(true); }
  });
  stage.addEventListener("pointerup", () => { s = null; });
  stage.addEventListener("pointercancel", () => { s = null; });
}
const justSwiped = (stage) => performance.now() - Number(stage.dataset.swiped || 0) < 400;

function overlay(vb, list, cls){
  const s = document.createElementNS(SVGNS, "svg");
  s.setAttribute("viewBox", vb.join(" "));
  s.setAttribute("preserveAspectRatio", cls === "stage" ? "xMidYMid meet" : "none");
  s.innerHTML = RC.svgMarkup(list, numOf);
  return s;
}
// A draft's drawing: the frame it was made on, plus (video) more frames of the same note.
const drawFrames = (draw) => draw ? [{ frame: draw.frame, items: draw.items }].concat(draw.more || []) : [];
// What shows on the main picture right now.
// While a new note is open the picture is clean: only that note's own drawing shows (on its frames).
function stageDrawings(){
  if (R.hide) return [];
  const v = R.video, at = kindNow() === "video" ? (v ? { t: R.scrubT != null ? R.scrubT : v.currentTime, fps: R.fps } : null) : null;
  if (kindNow() === "video" && !at) return [];
  if (R.newOpen){
    const d = R.drafts["+new"];
    return drawFrames(d && d.draw).filter((x) => !at || RC.ctxVisible(x.frame.ctx, at)).flatMap((x) => x.items);
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
const viewOf = () => R.meta.view || { rot: 0, mirror: false };
// Places an element showing the whole picture (object-fit: contain) turned / mirrored in a W × H box.
function turnEl(n, W, H, vw){
  const side = vw.rot % 180 !== 0, tf = (vw.rot ? `rotate(${vw.rot}deg) ` : "") + (vw.mirror ? "scaleX(-1)" : "");
  Object.assign(n.style, side ? { width: H + "px", height: W + "px", left: (W - H) / 2 + "px", top: (H - W) / 2 + "px" } : { width: "", height: "", left: "", top: "" });
  n.style.transform = tf;
}
function applyStageView(){
  if (!els || !els.stage) return;
  const st = els.stage, W = st.clientWidth, H = st.clientHeight, vw = viewOf();
  st.querySelectorAll(":scope > img, :scope > video, :scope > svg").forEach((n) => turnEl(n, W, H, vw));
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
  const missing = (what) => {
    const n = el("div", "none"), d = el("div");
    d.appendChild(el("div", "", what));
    d.appendChild(el("div", "", `${a.name} · ${fmtBytes(a.size)}`));
    const l = el("label"); l.appendChild(document.createTextNode("Pick the file"));
    l.appendChild(picker(a.kind === "video" ? "video/*" : "image/*", false, (fs) => rebind(fs[0])));
    d.appendChild(l); n.appendChild(d); stage.appendChild(n);
  };
  bindStageSwipe(stage);
  if (a.kind === "image"){
    const show = (url) => { const img = el("img"); img.src = url; img.alt = ""; img.draggable = false; stage.textContent = ""; stage.appendChild(img); stage.appendChild(svg); paintOverlay(); applyStageView();
      stage.onclick = () => { if (!justSwiped(stage)) openPicture(); }; };
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
      // A cached frame shown over the player while a seek is on its way (ScrubCache).
      const si = el("img", "scrubimg"); si.alt = ""; si.draggable = false; si.hidden = true;
      els.scrubImg = si;
      stage.appendChild(v); stage.appendChild(si); stage.appendChild(svg);
      const big = btn("playbig", null, () => togglePlay(), "Play"); big.innerHTML = ico("play", 30);
      stage.appendChild(big);
      v.addEventListener("loadedmetadata", () => {
        if (!R || R.video !== v) return;
        const aa = R.meta.asset;
        if (!aa.width && v.videoWidth){ aa.width = v.videoWidth; aa.height = v.videoHeight; }
        if (!aa.duration && Number.isFinite(v.duration)) aa.duration = v.duration;
        paintTime(); paintMarkers(); paintOverlay(); applyStageView();
        const rv = R, d = Number.isFinite(v.duration) ? v.duration : aa.duration;
        if (!rv.scrub && d && rv.url && v.src === rv.url){  // not a player whose file was just swapped (rebind)
          rv.scrub = new ScrubCache(rv.url, d, rv.fps, (f) => { if (R === rv){ rv.cacheF = f; TPS.forEach(paintCache); } });
          // After the player's own first frame, so the two do not race for the decoder.
          setTimeout(() => { if (R === rv && rv.scrub) rv.scrub.start(); }, 600);
        }
      });
      v.addEventListener("error", () => toast("This device cannot play this video (format or codec).", 5000));
      ["timeupdate", "pause"].forEach((ev) => v.addEventListener(ev, () => { paintTime(); paintOverlay(); paintCurrent(); if (R && R.newOpen && els.where) els.where(); }));
      v.addEventListener("seeked", () => {
        if (!R || R.video !== v) return;
        pumpSeek(v);
        if (R.want == null && !R.dragging && !v.seeking) settle(v);
        else if (R.want == null && R.scrubT != null && Math.abs(v.currentTime - R.scrubT) < frameDur()) hideCached();  // the player has caught up
        if (R.newOpen && els.where) els.where();
      });
      // The big play button only until the clip is first played or moved: it would cover the frame.
      v.addEventListener("play", () => { big.remove(); hideCached(); R.scrubT = null; R.want = null; paintTime(); loop(); });
      v.addEventListener("seeking", () => big.remove());
      bindScrub(stage, v);
      els.T = makeTransport();
      tp.appendChild(els.T.el); tp.hidden = false;
    }
  }
  const draw = ibtn("pen", "Draw a note on this picture / frame", () => drawNew());
  tools.appendChild(draw);
  const eye = ibtn(R.hide ? "eyeoff" : "eye", "Show / hide drawings", () => { R.hide = !R.hide; eye.innerHTML = ico(R.hide ? "eyeoff" : "eye"); eye.classList.toggle("on", R.hide); paintOverlay(); });
  eye.classList.toggle("on", R.hide);
  tools.appendChild(eye);
  tools.appendChild(ibtn("turn", "Turn the view 90°", () => setView({ rot: viewOf().rot + 90, mirror: viewOf().mirror })));
  const mirB = ibtn("mirror", "Mirror the view", () => setView({ rot: viewOf().rot, mirror: !viewOf().mirror }));
  mirB.classList.toggle("on", viewOf().mirror);
  els.mirB = mirB;
  tools.appendChild(mirB);
  if (!stageRO){ stageRO = new ResizeObserver(() => applyStageView()); }
  stageRO.disconnect(); stageRO.observe(stage);
  tools.appendChild(el("span", "sp"));
  const st = btn("rstate", "", reviewStateMenu, "Review state");
  els.rstate = st;
  tools.appendChild(st);
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
function togglePlay(){ const v = R && R.video; if (!v) return; if (v.paused) v.play().catch(() => {}); else v.pause(); }
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
  showCached(t);
  pumpSeek(v);
  paintTime(); paintOverlay(); paintCurrent();
  if (R.drawS) R.drawS.moved(t);
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
  hideCached();
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
// Markers on the timeline: notes (by state), drawings on other frames, and the frames drawn on in
// the open drawing session / the new note's draft.
function markerList(){
  const out = [], seen = new Set();
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
  const mine = R.drawS ? R.drawS.times() : drawFrames(R.drafts["+new"] && R.drafts["+new"].draw).map((x) => x.frame.ctx && x.frame.ctx.t).filter((t) => t != null);
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
}
// Transports on screen: the player's, and the drawing canvas's while a video is drawn on.
const TPS = new Set();
function makeTransport(){
  const T = { el: el("div", "tpi") }, row = el("div", "row");
  T.tc = el("span", "tc");
  [ibtn("prev", "Previous marker", () => jumpNote(-1)), ibtn("stepb", "Previous frame", () => step(-1)), T.tc,
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
  T.tc.textContent = `${fmtTime(t, R.fps)} · f ${Math.round(t * R.fps)}${R.fpsKnown ? "" : " (≈" + Math.round(R.fps) + " fps)"}`;
  T.ph.style.left = (d ? Math.min(100, Math.max(0, t / d * 100)) : 0).toFixed(3) + "%";
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
function showCached(t){
  const si = els && els.scrubImg, u = R && R.scrub && R.scrub.near(t);
  if (!si) return;
  if (u){ if (si.getAttribute("src") !== u) si.src = u; si.hidden = false; }
  else si.hidden = true;
}
function hideCached(){ if (els && els.scrubImg) els.scrubImg.hidden = true; }
// Drag left / right on the picture: the clip runs on from where it is, at a fixed pace (a frame per
// 4 px when slow, faster the faster the finger moves; Shift a quarter of that) — not the screen's
// width for the whole clip. Nothing happens until the finger has moved sideways a few px, so a tap
// still plays / pauses.
function scrubStep(t, dx, dt, fine){
  const speed = Math.abs(dx) / Math.max(1, dt);  // px per ms
  const gain = 0.25 * Math.min(12, 1 + Math.max(0, speed - 0.25) * 5) * (fine ? 0.25 : 1);
  return RC.clamp(t + dx * gain * frameDur(), 0, durOf() || 0);
}
function bindScrub(stage, v){
  stage.style.touchAction = "none";
  let sd = null, scrubEnd = -1e9;
  const stop = () => {
    if (sd && sd.on){ scrubEnd = performance.now(); dragEnd(); }
    sd = null;
  };
  stage.addEventListener("pointerdown", (e) => {
    if (sd && !(e.pointerType === "mouse" && e.pointerId === sd.id)) return;  // a second finger: the first one keeps the scrub
    sd = null;
    scrubEnd = -1e9;  // a click from here on belongs to this new tap
    if (e.target.closest("button") || (e.pointerType === "mouse" && e.button !== 0)) return;
    sd = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: 0, lt: 0, t: 0, on: false };
  });
  stage.addEventListener("pointermove", (e) => {
    if (!sd || e.pointerId !== sd.id || !R || R.video !== v) return;
    if (e.pointerType === "mouse" && !(e.buttons & 1)){ stop(); return; }  // released outside the stage
    if (!sd.on){
      const dx = e.clientX - sd.x, dy = e.clientY - sd.y;
      if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(dy)) return;
      sd.on = true; sd.lx = e.clientX; sd.lt = e.timeStamp; sd.t = posNow();
      R.dragging = true;
      v.pause();
      try { stage.setPointerCapture(e.pointerId); } catch {}
      return;
    }
    const dx = e.clientX - sd.lx, dt = e.timeStamp - sd.lt;
    sd.lx = e.clientX; sd.lt = e.timeStamp;
    if (!dx || !durOf()) return;  // a recorder's WebM may have no duration
    sd.t = scrubStep(sd.t, dx, dt, e.shiftKey);
    seekTo(sd.t);
  });
  const end = (e) => { if (sd && e.pointerId === sd.id) stop(); };
  stage.addEventListener("pointerup", end);
  stage.addEventListener("pointercancel", end);
  stage.addEventListener("click", (e) => {
    // A mouse drag ends with a click (a moved touch does not): only the one right after a scrub is eaten.
    if (performance.now() - scrubEnd < 350 || justSwiped(stage)) return;
    if (e.target === v || e.target === els.scrubImg) togglePlay();
  });
}
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
    if (meta && !R.fpsKnown){
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
  const st = M.reviewState(R.rows);
  if (els.rstate){ els.rstate.textContent = M.REVIEW_STATES[st] || "Set state"; els.rstate.className = "rstate " + st; }
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
// The note(s) on the frame now (video).
function paintCurrent(){
  if (!els || !R || !R.video) return;
  const t = R.scrubT != null ? R.scrubT : R.video.currentTime, fd = frameDur();
  els.notes.querySelectorAll(".note[data-t]").forEach((c) => c.classList.toggle("cur", Math.abs(Number(c.dataset.t) - t) < fd * 0.75));
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
function drawingsOn(f, opts = {}){
  return M.drawings(R.rows).filter((r) => opts.reply ? r.data.reply === opts.reply : f.note ? r.data.note === f.note : RC.ctxVisible(r.data.ctx, f.at));
}
function picBox(f, list, cls){
  const w = el("div", "fw" + (cls ? " " + cls : "")), i = el("img");
  i.src = f.url; i.alt = ""; i.draggable = false; w.appendChild(i);
  if (list.length) w.appendChild(overlay(f.vb, list));
  return w;
}
// Fills a placeholder with a note's picture once it is there (cached, or taken from the video).
function asyncPic(n, list, cls, onTap){
  const ph = el("div", "fw wait" + (cls ? " " + cls : ""), "Loading the frame…");
  noteFrame(n).then((f) => {
    if (!f){ ph.remove(); return; }
    const box = picBox(f, list(f), cls);
    box.onclick = () => onTap(f);
    ph.replaceWith(box);
  });
  return ph;
}
// One more frame of a video note, filled in once it is there.
function asyncFrameAt(n, t){
  const rv = R, ph = el("div", "fw sm wait", "…");
  getFrame(t).then((fr) => {
    if (R !== rv || !fr){ ph.remove(); return; }
    const f = { url: fr.url, vb: [0, 0, docW(), docH()], ctx: { t, hold: 0 }, at: { t, fps: R.fps } };
    const box = picBox(f, drawingsOn(f), "sm");
    box.onclick = () => openFrame(n, f);
    ph.replaceWith(box);
  });
  return ph;
}
function shotThumbs(ids, gal){
  const sh = el("div", "shots");
  (ids || []).forEach((sid) => {
    const i = el("img"); i.alt = "";
    shotUrl(String(sid)).then((u) => { if (u){ i.src = u; i.onclick = () => openShot(u); } else i.remove(); });
    sh.appendChild(i);
  });
  return (ids || []).length ? sh : null;
}

function noteCard(n){
  const id = n.id, st = M.noteState(n), c = n.data.ctx, kind = kindNow();
  const card = el("div", "note " + st);
  card.dataset.id = id;
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
  // Its picture: the video frame with everything drawn there; a picture note only when it has drawings.
  const own = M.drawings(R.rows).filter((r) => r.data.note === id);
  if (kind === "video" ? (c && c.t != null) : own.length){
    const mf = kind === "video" ? memFrame(c.t) : null;
    if (mf){
      const f = { url: mf.url, vb: [0, 0, docW(), docH()], ctx: c, at: { t: c.t, fps: R.fps } };
      const box = picBox(f, drawingsOn(f), "");
      box.onclick = () => openFrame(n, f);
      card.appendChild(box);
    } else card.appendChild(asyncPic(n, (f) => drawingsOn(f), "", (f) => openFrame(n, f)));
  }
  // A video note drawn on more frames: those frames too, small, in time order.
  if (kind === "video" && c && c.t != null){
    const extra = M.noteFrameTimes(R.rows, n).filter((t) => r3(t) !== r3(c.t));
    if (extra.length){
      const row = el("div", "shots");
      extra.forEach((t) => row.appendChild(asyncFrameAt(n, t)));
      card.appendChild(row);
    }
  }
  const sh = shotThumbs(n.data.shots);
  if (sh) card.appendChild(sh);
  const reps = (n.data.replies || []).filter((r) => r && !r.deleted);
  if (reps.length){
    const rb = el("div", "replies");
    reps.forEach((r) => rb.appendChild(replyEntry(n, r)));
    card.appendChild(rb);
  }
  if (R.openReply[id]){
    card.appendChild(composer({ key: id, placeholder: "Reply", status: st, frameFor: () => noteFrame(n).then((f) => f && Object.assign(f, { base: drawingsOn(f) })),
      onSend: (text, shots, state, draw) => {
        const t = now();
        if (text || shots.length || draw){
          const r = M.addReply(n, { text, author: who, shots }, t);
          if (draw) R.rows.push(...M.drawingRows(draw.items, { note: id, reply: r.id, ctx: M.drawCtx(c), z: M.maxZ(R.rows) + 1 }, t));
        }
        if (state) M.setNoteState(n, state, who, t + 1);
        delete R.openReply[id];
        dirty();
      } }));
    if (R.openReply[id] === "focus"){ R.openReply[id] = true; focusLater(id); }
  } else {
    const acts = el("div", "acts");
    acts.appendChild(btn("btn", "Reply", () => { R.openReply[id] = "focus"; renderNotes(); }));
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
function replyEntry(n, r){
  if (r.event){
    const d = el("div", "rep ev " + r.event);
    d.textContent = (r.event === "done" ? "✓ " : r.event === "progress" ? "▸ " : "↺ ") + (M.EVENT_LABEL[r.event] || "Reopened") + (r.author ? " by " + r.author : "") + " · " + fmtDate(r.created);
    return d;
  }
  const d = el("div", "rep");
  d.appendChild(el("div", "rh", [r.author, fmtDate(r.created)].filter(Boolean).join(" · ")));
  if (r.text) d.appendChild(el("div", "rt", r.text));
  if (M.drawings(R.rows).some((x) => x.data.reply === r.id)){
    d.appendChild(asyncPic(n, (f) => drawingsOn(f, { reply: r.id }), "sm", (f) => openFrame(n, f, r.id)));
  }
  const sh = shotThumbs(r.shots);
  if (sh) d.appendChild(sh);
  d.appendChild(btn("x", "×", async () => {
    if (!await ask({ title: "Delete this reply?", text: "Its pictures and drawings go with it. Sight removes it too when it merges this review.", ok: "Delete", danger: true })) return;
    M.deleteReply(R.rows, n, r.id);
    dirty();
  }, "Delete reply"));
  return d;
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
async function editNoteDrawing(n){
  if (!await ensureName()) return;
  const rv = R, own = M.drawings(R.rows).filter((r) => r.data.note === n.id && !r.data.reply);
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
    fresh.forEach(({ it, ctx }) => R.rows.push(...M.drawingRows([Object.assign({}, it, { id: undefined })], { note: n.id, ctx: M.drawCtx(ctx), z: M.maxZ(R.rows) + 1 }, t)));
    dirty();
  };
  const c = n.data.ctx;
  if (kindNow() === "video" && rv.video && c && c.t != null){
    const groups = new Map();
    own.forEach((r) => { const tt = frameStart(r.data.ctx && r.data.ctx.t != null ? r.data.ctx.t : c.t), k = frameTag(tt); if (!groups.has(k)) groups.set(k, { frame: { ctx: { t: tt, hold: 0 } }, items: [] }); groups.get(k).items.push(asItem(r)); });
    seekTo(c.t);
    await whenSettled(rv);
    if (R !== rv) return;
    drawVideo({ frames: [...groups.values()], onDone: (list) => apply(list.map((x) => ({ ctx: x.frame.ctx, items: x.items }))) });
    return;
  }
  const f = await noteFrame(n);
  if (!f){ toast(kindNow() === "video" ? "Pick the video again to draw on its frames" : "The picture is not on this device"); return; }
  // On the clean picture: only this note's own drawings, editable.
  drawCanvas({ src: f.url, vb: f.vb, base: [], items: own.map(asItem), onDone: (items) => apply([{ ctx: n.data.ctx, items }]) });
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
  const pen = btn("pen", null, async () => {
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
      if (fr.ctx && fr.ctx.t != null) seekTo(fr.ctx.t);
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
  const ae = document.activeElement;
  if (R.newOpen === true && ae && ae.tagName === "TEXTAREA" && nb.contains(ae)) return;  // typing: leave it alone
  nb.textContent = "";
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
  if (v.readyState < 2) await seek(v, v.currentTime);
  const t = frameStart(v.currentTime), tag = frameTag(t);
  let f = rv.frames.get(tag);
  if (!f){
    const s = await scaled(v, 1600).catch(() => null);
    if (!s || R !== rv) return null;
    f = { blob: s.blob, w: s.w, h: s.h, url: URL.createObjectURL(s.blob) };
    rv.frames.set(tag, f);
    putIfAlive(rv, "frames", { id: rv.meta.key + "|" + tag, review: rv.meta.key, blob: s.blob, w: s.w, h: s.h });
  }
  const ctx = { t, hold: 0 };
  return { url: f.url, vb, ctx, at: { t, fps: rv.fps }, base: M.drawings(rv.rows).filter((r) => RC.ctxVisible(r.data.ctx, { t, fps: rv.fps })) };
}
async function drawNew(){
  if (!await ensureName()) return;
  const rv = R, d = R.drafts["+new"] = R.drafts["+new"] || newDraft();
  const done = (list) => {
    if (R !== rv) return;
    d.draw = framesDraw(list);
    R.newOpen = d.draw || R.newOpen ? "focus" : R.newOpen;
    paintNewBar(); paintMarkers();
  };
  // A video: drawn over the player on as many frames as wanted, the draft's frames kept.
  if (kindNow() === "video" && rv.video){ drawVideo({ frames: drawFrames(d.draw), onDone: done }); return; }
  const fr = await currentFrame();
  if (!fr){ toast(kindNow() === "video" ? "Pick the video again to draw on its frames" : "The picture is not on this device"); return; }
  if (d.draw && !(await ask({ title: "Replace the drawing?", text: "The new note already has a drawing.", ok: "Replace" }))) return;
  if (R !== rv) return;
  drawCanvas({ src: fr.url, vb: fr.vb, base: [], items: [], onDone: (items) => { if (items.length) done([{ frame: fr, items }]); } });
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
  if (v.seeking) return null;  // the picture is still the old frame: never cache it under the new time
  if (v.readyState < 2) await seek(v, v.currentTime);
  if (R !== rv || v.seeking) return null;
  const on = want != null && (rv.fpsKnown ? frameIdx(want) === frameIdx(v.currentTime) : Math.abs(want - v.currentTime) < 1e-3);
  const t = frameStart(on ? want : v.currentTime), tag = frameTag(t);
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
// it down: one finger then scrubs (as on the player), the timeline / steps / marker jumps move to
// another frame, and a tool taken up draws there. Done hands back every frame drawn on —
// [{frame, items}] — for one note. frames: what the draft / note already holds (kept per frame).
async function drawVideo({ frames = [], onDone }){
  const rv = R, v = rv.video;
  if (!v || rv.drawS || rv.drawOpening) return;  // one session at a time (a double tap)
  rv.drawOpening = true;
  try { await openDrawVideo(rv, v, frames, onDone); } finally { rv.drawOpening = false; }
}
async function openDrawVideo(rv, v, frames, onDone){
  v.pause();
  await whenSettled(rv);
  if (R !== rv) return;
  const fr = await currentFrame();
  if (!fr || R !== rv){ if (R === rv) toast("Could not take this frame"); return; }
  const init = {};
  frames.forEach((x) => { if (x.frame.ctx && x.frame.ctx.t != null) init[frameTag(frameStart(x.frame.ctx.t))] = x.items; });
  const k0 = frameTag(fr.ctx.t), others = Object.assign({}, init);
  delete others[k0];
  const T = makeTransport();
  let h = null, keys = Object.keys(init), capSeq = 0, st = 0, last = fr.ctx.t;
  const S = rv.drawS = {
    times: () => keys.map((k) => Number(k.slice(2))),
    // The frame wanted shows at once (the cached one, dimmed) with that frame's drawings…
    moved: (t) => { last = t; capSeq++; if (h) h.setFrame(frameTag(t), rv.scrub && rv.scrub.near(t), true); },
    // …and the player's own frame replaces it when the seek has landed.
    settled: async () => {
      const seq = ++capSeq, f = await frameNow(rv, last);
      if (seq !== capSeq || !h || R !== rv || rv.drawS !== S || !f || f.tag !== frameTag(frameStart(last))) return;
      h.setFrame(f.tag, f.url, false);
    },
  };
  const finish = () => {
    if (rv.drawS === S) rv.drawS = null;
    TPS.delete(T); h = null;
    if (R === rv){ if (R.dragging) dragEnd(); paintMarkers(); paintOverlay(); }  // a drag on its footer ends with it
  };
  h = drawCanvas({ src: fr.url, vb: fr.vb, base: [], items: init[k0] || [], frameKey: k0, frames: others, footer: T.el,
    onScrub: (e) => {
      if (R !== rv || (e.phase !== "end" && !durOf())) return;  // a WebM with no duration: nothing to scrub
      if (e.phase === "start"){ st = posNow(); R.dragging = true; }
      else if (e.phase === "move"){ st = scrubStep(st, e.dx, e.dt, e.fine); seekTo(st); }
      else dragEnd();
    },
    onFrames: (ks) => { keys = ks; paintMarks(T); },
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
  paintMarks(T);
}

// The drawing canvas, opened turned / mirrored as the review's view; its turn / mirror buttons
// change that view.
function drawCanvas(o){
  const rv = R;
  return DRAW.open(Object.assign({ numOf, view: viewOf(), onView: (vw) => { if (R === rv) setView({ rot: vw.rot, mirror: vw.mirror }); } }, o));
}

// ---- full-screen viewer ------------------------------------------------------------------------
// A picture with its drawings, no bar: a round Back button and (when it can be drawn on) a pencil
// float over it. Pinch / double-tap / wheel zoom, drag to pan while zoomed. At fit, a swipe up /
// down goes to the next / previous note (o.nav) and a sideways swipe goes back to the player.
// o: {url, vb, rows, view, onDraw(), note (caption), nav(dir) → Promise<o | null>, onClose(o)}
function viewer(o){
  const v = el("div", "view"), cap = el("div", "cap");
  const back = btn("fab back", null, () => close(), "Back"); back.innerHTML = ico("back", 24);
  const pen = btn("fab draw", null, () => { const cur = o; close(); cur.onDraw(); }, "Draw on it"); pen.innerHTML = ico("pen", 24);
  v.appendChild(cap); v.appendChild(back); v.appendChild(pen);
  let box = null, V = { z: 1, x: 0, y: 0 }, off = [0, 0], busyNav = false;
  const close = () => {
    v.remove(); window.removeEventListener("resize", fit); document.removeEventListener("keydown", onKey, true);
    const i = sheets.indexOf(close); if (i >= 0) sheets.splice(i, 1);
    if (o.onClose) o.onClose(o);
  };
  function show(no){
    o = no;
    if (box) box.remove();
    box = el("div", "vb");
    const img = el("img"); img.src = o.url; img.alt = ""; img.draggable = false; box.appendChild(img);
    if (o.rows && o.rows.length) box.appendChild(overlay(o.vb, o.rows));
    v.insertBefore(box, cap);
    pen.hidden = !o.onDraw;
    cap.textContent = "";
    cap.className = "cap" + (o.note ? " " + M.noteState(o.note) : "");
    if (o.note){
      cap.appendChild(el("span", "num", String(NUM.get(o.note.id) || "")));
      const c = o.note.data.ctx;
      cap.appendChild(el("span", "", [c && c.t != null && R ? fmtTime(c.t, R.fps) : "", o.note.data.text || ""].filter(Boolean).join(" · ") || "Note"));
    }
    off = [0, 0];
    fit();
  }
  const vw = o.view || { rot: 0, mirror: false };
  function fit(){
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
  // Swipes at fit: the picture follows the finger along the axis it set off on.
  async function navigate(dir){
    if (busyNav) return;
    const next = o.nav ? await (busyNav = true, o.nav(dir)).finally(() => { busyNav = false; }) : null;
    if (!v.isConnected) return;
    if (!next){ off = [0, 0]; apply(true); toast(dir > 0 ? "No later note" : "No earlier note", 1500); return; }
    off = [0, dir > 0 ? -innerHeight : innerHeight]; apply(true);
    setTimeout(() => { if (!v.isConnected) return; show(next); off = [0, dir > 0 ? innerHeight * 0.4 : -innerHeight * 0.4]; apply(); requestAnimationFrame(() => { off = [0, 0]; apply(true); }); }, 170);
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
    if (e.target.closest(".fab")) return;
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
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy)){ close(); return; }
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
  v.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, V.z * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  v.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
  function onKey(e){
    if (sheets[sheets.length - 1] !== close) return;
    runHotkeys(e, [["ArrowDown", () => navigate(1)], ["ArrowUp", () => navigate(-1)], ["ArrowLeft", close], ["ArrowRight", close]]);
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
  viewer({ url, vb: [0, 0, docW() || 1, docH() || 1], rows: stageDrawings(), view: viewOf(), onDraw: drawNew });
}
// A note's picture, full screen; swiping up / down walks the notes in the list's order (the
// filter on), and the list / player follow the note it was left on.
function noteView(n, f, rid){
  const rv = R;
  return { url: f.url, vb: f.vb, view: viewOf(), note: n, rows: rid ? drawingsOn(f, { reply: rid }) : drawingsOn(f),
    onDraw: () => { if (R !== rv) return; setPanel(true); R.openReply[n.id] = true; renderNotes();
      const box = document.querySelector(`.cmp[data-key="${n.id}"]`);
      if (box) box.querySelector(".pen").click(); },
    nav: rid ? null : async (dir) => {
      if (R !== rv) return null;
      const list = listedNotes();
      for (let i = list.findIndex((x) => x.id === n.id) + dir; i >= 0 && i < list.length; i += dir){
        const f2 = await noteFrame(list[i]);
        if (R !== rv) return null;
        if (f2) return noteView(list[i], f2);
      }
      return null;
    },
    onClose: (last) => { if (R === rv && last.note && last.note.id !== n.id) showNote(last.note); } };
}
function openFrame(n, f, rid){ viewer(noteView(n, f, rid)); }
// Brings a note forward: its card into view in the list, the player onto its frame.
function showNote(n){
  const c = n.data.ctx;
  if (R.video && c && c.t != null) seekTo(c.t);
  const card = els && els.notes.querySelector(`.note[data-id="${n.id}"]`);
  if (card) card.scrollIntoView({ block: "nearest" });
}
function openShot(url){
  const im = new Image();
  im.onload = () => viewer({ url, vb: [0, 0, im.naturalWidth || 1, im.naturalHeight || 1], rows: [] });
  im.src = url;
}

// ---- review state, actions, exports --------------------------------------------------------------
function reviewStateMenu(){
  const cur = M.reviewState(R.rows);
  menu("Review state", Object.entries(M.REVIEW_STATES).map(([k, label]) => ({ label: (k === cur ? "✓ " : "") + label, fn: () => setState(k) }))
    .concat(cur ? [{ label: "Clear the state", fn: () => setState("") }] : []));
}
async function setState(s){
  if (!await ensureName()) return;
  M.setReviewState(R.rows, s, who);
  dirty();
}
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
  navigator.serviceWorker.register("sw.js").then((r) => {
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
window.__sightReview = { get R(){ return R; }, DB, M, flush, openMedia, importReviewFile };
