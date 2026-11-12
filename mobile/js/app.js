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
  plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
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
  return cachedFrame(rv, frameTag(t), rv.grab ? () => rv.grab.grab(t, 1600) : null);
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
  main.appendChild(el("p", "foot", `${APP_LABEL} · nothing leaves this device unless you share it`));
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
    let lp = null;
    it.addEventListener("contextmenu", (e) => { e.preventDefault(); reviewMenu(m); });
    it.addEventListener("pointerdown", () => { lp = setTimeout(() => { lp = "fired"; reviewMenu(m); }, 600); });
    ["pointerup", "pointercancel", "pointerleave"].forEach((ev) => it.addEventListener(ev, () => { if (lp !== "fired") clearTimeout(lp); }));
    it.addEventListener("click", (e) => { if (lp === "fired"){ e.stopImmediatePropagation(); lp = null; } }, true);
    list.appendChild(it);
  });
  list.appendChild(el("p", "foot", "Press and hold a review to delete it."));
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
  R = null;
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
  if (!file){ const kept = await DB.get("files", key).catch(() => null); if (kept) file = kept.blob; }
  if (seq !== openSeq) return;
  closeReview();
  const rv = R = { meta, rows: rr ? rr.rows : [], file: null, url: null, video: null, grab: null, fps: meta.fps || 25, fpsKnown: !!meta.fps,
    frames: new Map(), shotUrls: new Map(), drafts: {}, openReply: {}, newOpen: false, filter: "all", hide: false, scrubT: null };
  if (file) await bindFile(rv, file);
  if (R !== rv) return;
  meta.opened = now();
  DB.put("reviews", meta).catch(() => {});
  if (!fromRoute && location.hash !== "#r=" + key){ history.pushState(null, "", "#r=" + key); rv.pushed = true; }
  renderReview();
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
let els = null;  // the review screen's parts
function renderReview(){
  const a = R.meta.asset;
  document.title = a.name + " — Sight Review";
  root.textContent = ""; root.className = "review";
  const bar = el("header", "bar"), ttl = el("div", "ttl");
  ttl.appendChild(el("b", "", a.name));
  const sub = el("span");
  ttl.appendChild(sub);
  bar.appendChild(ibtn("back", "All reviews", () => {
    if (R && R.pushed) history.back();
    else { closeReview(); history.replaceState(null, "", location.pathname + location.search); renderHome(); }
  }));
  bar.appendChild(ttl);
  bar.appendChild(ibtn("more", "Export and more", reviewActions));
  root.appendChild(bar);
  const media = el("div", "media"), stage = el("div", "stage");
  media.appendChild(stage);
  const transport = el("div", "transport"), scrub = el("div", "scrub"), tools = el("div", "tools");
  media.appendChild(transport); media.appendChild(scrub); media.appendChild(tools);
  root.appendChild(media);
  const keep = el("div", "keep");
  root.appendChild(keep);
  const seg = el("div", "seg"), notes = el("div", "notes");
  root.appendChild(seg); root.appendChild(notes);
  const newbar = el("footer", "newbar"), nb = el("div");
  newbar.appendChild(nb);
  root.appendChild(newbar);
  els = { sub, stage, transport, scrub, tools, keep, seg, notes, nb, svg: null };
  buildStage();
  paintReview();
}

function overlay(vb, list, cls){
  const s = document.createElementNS(SVGNS, "svg");
  s.setAttribute("viewBox", vb.join(" "));
  s.setAttribute("preserveAspectRatio", cls === "stage" ? "xMidYMid meet" : "none");
  s.innerHTML = RC.svgMarkup(list, numOf);
  return s;
}
// What shows on the main picture right now.
// While a new note is open the picture is clean: only that note's own drawing shows (on its frame).
function stageDrawings(){
  if (R.hide) return [];
  const v = R.video, at = kindNow() === "video" ? (v ? { t: R.scrubT != null ? R.scrubT : v.currentTime, fps: R.fps } : null) : null;
  if (kindNow() === "video" && !at) return [];
  if (R.newOpen){
    const d = R.drafts["+new"];
    if (!d || !d.draw) return [];
    return !at || RC.ctxVisible(d.draw.frame.ctx, at) ? d.draw.items : [];
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
  const { stage, transport, scrub, tools } = els, a = R.meta.asset;
  stage.textContent = ""; transport.textContent = ""; scrub.textContent = ""; tools.textContent = "";
  transport.hidden = scrub.hidden = true;
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
  if (a.kind === "image"){
    const show = (url) => { const img = el("img"); img.src = url; img.alt = ""; img.draggable = false; stage.textContent = ""; stage.appendChild(img); stage.appendChild(svg); paintOverlay(); applyStageView();
      stage.onclick = () => openPicture(); };
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
      // A cached frame shown over the player while a scrub waits for its seek (ScrubCache).
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
        if (!rv.scrub && d){
          rv.scrub = new ScrubCache(rv.url, d, rv.fps, (f) => { if (R === rv && els && els.cacheBar) els.cacheBar.style.width = (f * 100).toFixed(1) + "%"; });
          // After the player's own first frame, so the two do not race for the decoder.
          setTimeout(() => { if (R === rv && rv.scrub) rv.scrub.start(); }, 600);
        }
      });
      v.addEventListener("error", () => toast("This device cannot play this video (format or codec).", 5000));
      ["timeupdate", "seeked", "pause"].forEach((ev) => v.addEventListener(ev, () => { paintTime(); paintOverlay(); paintCurrent(); if (R && R.newOpen && els.where) els.where(); }));
      // The big play button only until the clip is first played or moved: it would cover the frame.
      v.addEventListener("play", () => { big.remove(); paintTime(); loop(); });
      v.addEventListener("seeking", () => big.remove());
      bindScrub(stage, v);
      buildTransport();
    }
  }
  const draw = btn("btn", "✎ Draw a note", () => drawNew(), "Draw on this picture / frame and add a note");
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
  if (rv.grab) rv.grab.close();
  if (rv.scrub) rv.scrub.close();
  rv.grab = null; rv.scrub = null;
  const old = rv.frames.get("img");
  if (old){ URL.revokeObjectURL(old.url); rv.frames.delete("img"); }
  await DB.del("frames", rv.meta.key + "|img").catch(() => {});
  await bindFile(rv, file);
  if (R !== rv) return;
  DB.put("reviews", rv.meta).catch(() => {});
  buildStage(); paintReview();
}

// ---- video transport ---------------------------------------------------------------------------
const frameDur = () => 1 / (R.fps || 25);
function togglePlay(){ const v = R && R.video; if (!v) return; if (v.paused) v.play().catch(() => {}); else v.pause(); }
// The frame on screen at time t is the one that started at or before t; a time inside it is kept as
// that frame's start + a hair (as Sight's stepping lands), so a note made there shows on exactly
// that frame (review-core ctxVisible) and Sight numbers it the same. Raw time while the frame rate
// is still a guess (same rule as annotate.js frameStart).
function frameStart(t){ if (!R.fpsKnown) return r3(t); const fd = frameDur(); return r3((Math.floor(t / fd + 1e-6) + 0.01) * fd); }
// ±n frames from the frame on screen.
function step(n){
  const v = R && R.video;
  if (!v) return;
  v.pause();
  const fd = frameDur();
  v.currentTime = Math.min(Math.max((Math.floor(v.currentTime / fd + 1e-6) + n) * fd + fd * 0.01, 0), v.duration || 0);
}
function jumpNote(dir){
  const v = R && R.video;
  if (!v) return;
  const ts = [...new Set(M.notesSorted(R.rows, "video").map((n) => n.data.ctx && n.data.ctx.t).filter((t) => t != null))].sort((a, b) => a - b);
  const cur = v.currentTime, eps = frameDur() * 0.5;
  const t = dir > 0 ? ts.find((x) => x > cur + eps) : ts.reverse().find((x) => x < cur - eps);
  if (t == null){ toast(dir > 0 ? "No later note" : "No earlier note"); return; }
  v.pause(); v.currentTime = t;
}
// Drag left / right on the picture scrubs, as Sight's click-drag on the video: the stage's width is
// the whole clip (Shift: a tenth of it). Nothing happens until the finger has moved sideways a few
// px, so a tap still plays / pauses and an upward / downward swipe still scrolls the page
// (touch-action: pan-y). Only the latest wanted time is sought; the next seek goes out when the
// previous one has landed, so a long-GOP clip does not freeze under the finger.
// The scrub cache (ScrubCache) puts the frame under the finger up at once; the player's own picture
// takes over when its last seek has landed.
function showCached(t){
  const si = els && els.scrubImg, u = R && R.scrub && R.scrub.near(t);
  if (!si) return;
  if (u){ if (si.getAttribute("src") !== u) si.src = u; si.hidden = false; }
}
function hideCached(){ if (els && els.scrubImg) els.scrubImg.hidden = true; }
function bindScrub(stage, v){
  stage.style.touchAction = "pan-y";
  let sd = null, want = null, scrubEnd = -1e9;
  const pump = () => { if (want == null || v.seeking) return; const t = want; want = null; if (Math.abs(t - v.currentTime) > 1e-3) v.currentTime = t; };
  const settle = () => { if (R && R.video === v && R.scrubT != null){ R.scrubT = null; paintTime(); paintOverlay(); } hideCached(); };
  v.addEventListener("seeked", () => { pump(); if (!sd && want == null) settle(); });
  v.addEventListener("play", hideCached);
  const stop = () => {
    if (sd && sd.on){ scrubEnd = performance.now(); if (want == null && !v.seeking) settle(); }
    sd = null;
  };
  stage.addEventListener("pointerdown", (e) => {
    if (sd && !(e.pointerType === "mouse" && e.pointerId === sd.id)) return;  // a second finger: the first one keeps the scrub
    sd = null;
    scrubEnd = -1e9;  // a click from here on belongs to this new tap
    if (e.target.closest("button") || (e.pointerType === "mouse" && e.button !== 0)) return;
    sd = { id: e.pointerId, x: e.clientX, y: e.clientY, t0: 0, on: false, fine: e.shiftKey };
  });
  stage.addEventListener("pointermove", (e) => {
    if (!sd || e.pointerId !== sd.id || !R || R.video !== v) return;
    if (e.pointerType === "mouse" && !(e.buttons & 1)){ stop(); return; }  // released outside the stage
    if (!sd.on){
      const dx = e.clientX - sd.x, dy = e.clientY - sd.y;
      if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(dy)) return;
      sd.on = true; sd.x = e.clientX; sd.t0 = v.currentTime;  // rebase here so the picture does not jump
      R.scrubT = sd.t0;
      v.pause();
      try { stage.setPointerCapture(e.pointerId); } catch {}
    }
    if (e.shiftKey !== sd.fine){ sd.fine = e.shiftKey; sd.x = e.clientX; sd.t0 = R.scrubT; }
    const d = Number.isFinite(v.duration) ? v.duration : (R.meta.asset.duration || 0);  // a recorder's WebM may have none
    if (!d) return;
    const t = Math.min(d, Math.max(0, sd.t0 + (e.clientX - sd.x) / Math.max(stage.clientWidth, 1) * d * (sd.fine ? 0.1 : 1)));
    R.scrubT = t; want = t;
    showCached(t);
    pump(); paintTime(); paintOverlay();
  });
  const end = (e) => { if (sd && e.pointerId === sd.id) stop(); };
  stage.addEventListener("pointerup", end);
  stage.addEventListener("pointercancel", end);
  stage.addEventListener("click", (e) => {
    // A mouse drag ends with a click (a moved touch does not): only the one right after a scrub is eaten.
    if (performance.now() - scrubEnd < 350) return;
    if (e.target === v) togglePlay();
  });
}
function buildTransport(){
  const { transport, scrub } = els;
  transport.hidden = scrub.hidden = false;
  const play = ibtn("play", "Play / pause", togglePlay);
  els.play = play;
  const tc = el("span", "tc");
  els.tc = tc;
  [play, ibtn("prev", "Previous note", () => jumpNote(-1)), ibtn("stepb", "Previous frame", () => step(-1)), tc, ibtn("stepf", "Next frame", () => step(1)), ibtn("next", "Next note", () => jumpNote(1))].forEach((b) => transport.appendChild(b));
  const r = el("input"); r.type = "range"; r.min = "0"; r.step = "any"; r.value = "0"; r.setAttribute("aria-label", "Position");
  r.addEventListener("input", () => { const v = R.video; if (!v) return; if (!v.paused) v.pause(); showCached(Number(r.value)); v.currentTime = Number(r.value); });
  r.addEventListener("change", () => { const v = R.video; if (v && !v.seeking) hideCached(); });
  els.range = r;
  els.marks = el("div");
  els.cacheBar = el("i", "cachebar"); els.cacheBar.title = "Frames ready for scrubbing";
  scrub.appendChild(els.cacheBar); scrub.appendChild(els.marks); scrub.appendChild(r);
}
function paintTime(){
  const v = R && R.video;
  if (!v || !els.tc) return;
  const t = R.scrubT != null ? R.scrubT : v.currentTime;
  els.tc.textContent = `${fmtTime(t, R.fps)} · f ${Math.round(t * R.fps)}${R.fpsKnown ? "" : " (≈" + Math.round(R.fps) + " fps)"}`;
  els.play.innerHTML = ico(v.paused ? "play" : "pause");
  const d = Number.isFinite(v.duration) ? v.duration : (R.meta.asset.duration || 0);
  els.range.max = String(d || 0);
  if (document.activeElement !== els.range) els.range.value = String(t);
}
function paintMarkers(){
  if (!els || !els.marks) return;
  const v = R.video, d = (v && Number.isFinite(v.duration) && v.duration) || R.meta.asset.duration || 0;
  els.marks.textContent = "";
  if (!d) return;
  M.notesSorted(R.rows, "video").forEach((n) => {
    const t = n.data.ctx && n.data.ctx.t;
    if (t == null) return;
    const m = el("i", "mk " + M.noteState(n));
    m.style.left = `calc(${Math.min(100, t / d * 100)}% )`;
    els.marks.appendChild(m);
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
    paintOverlay(); paintTime();
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
  paintSeg(c);
  renderNotes();
  paintNewBar();
  paintMarkers(); paintOverlay();
}
function paintKeep(){
  const k = els.keep;
  k.textContent = "";
  if (!R.file || R.meta.kept || R.meta.keepAsked) return;
  const h = el("div", "hint"), p = el("p");
  p.appendChild(document.createTextNode("Reopening this review later needs the file again (the phone gives the app no lasting access). "));
  const b = btn("btn", `Keep a copy here · ${fmtBytes(R.file.size)}`, keepCopy);
  p.appendChild(b);
  h.appendChild(p);
  h.appendChild(btn("", "×", () => { R.meta.keepAsked = true; DB.put("reviews", R.meta).catch(() => {}); h.remove(); }, "Hide"));
  k.appendChild(h);
}
async function keepCopy(){
  const b = busy("Keeping a copy…");
  try {
    await DB.put("files", { key: R.meta.key, blob: R.file });
    R.meta.kept = true;
    await DB.put("reviews", R.meta);
    DB.persist();
    toast("The file is kept on this device");
  } catch (e){ toast("Could not keep the file: " + (e.message || e), 5000); }
  finally { b.done(); paintKeep(); }
}
async function dropCopy(){
  await DB.del("files", R.meta.key);
  R.meta.kept = false; R.meta.keepAsked = true;
  await DB.put("reviews", R.meta);
  toast("The copy is removed; the review stays");
}
function paintSeg(c){
  const seg = els.seg;
  seg.textContent = "";
  [["all", "All", c.notes], ["open", "Open", c.open], ["progress", "In progress", c.progress], ["done", "Resolved", c.done]].forEach(([k, label, n]) => {
    const b = btn(R.filter === k ? "on" : "", label, () => { R.filter = k; paintReview(); });
    b.appendChild(el("i", "", String(n || 0)));
    seg.appendChild(b);
  });
}
function renderNotes(){
  const box = els.notes, keepY = window.scrollY;
  box.textContent = "";
  const notes = M.notesSorted(R.rows, kindNow()).filter((n) => R.filter === "all" || M.noteState(n) === R.filter);
  notes.forEach((n) => box.appendChild(noteCard(n)));
  if (!notes.length) box.appendChild(el("p", "empty", R.filter === "all" ? (kindNow() === "video" ? "No notes yet. Pause on a frame and add a note below, or draw on it." : "No notes yet. Add one below, or draw on the picture.") : "No notes here."));
  window.scrollTo(0, keepY);
  paintCurrent();
}
// The note(s) on the frame now (video).
function paintCurrent(){
  if (!els || !R || !R.video) return;
  const t = R.video.currentTime, fd = frameDur();
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
// Opens the canvas with the note's own drawings editable; Done keeps / adds / removes rows.
async function editNoteDrawing(n){
  if (!await ensureName()) return;
  const f = await noteFrame(n);
  if (!f){ toast(kindNow() === "video" ? "Pick the video again to draw on its frames" : "The picture is not on this device"); return; }
  const rv = R, own = M.drawings(R.rows).filter((r) => r.data.note === n.id && !r.data.reply);
  const ownIds = new Set(own.map((r) => r.id));
  // On the clean picture: only this note's own drawings, editable.
  drawCanvas({ src: f.url, vb: f.vb, base: [],
    items: own.map((r) => ({ id: r.id, kind: r.kind, shape_kind: r.shape_kind, z: r.z_index, data: r.data })),
    onDone: (items) => {
      if (R !== rv) return;
      const kept = new Set(items.filter((it) => it.id && ownIds.has(it.id)).map((it) => it.id));
      const gone = own.filter((r) => !kept.has(r.id)).map((r) => r.id);
      const fresh = items.filter((it) => !it.id || !ownIds.has(it.id));
      if (!gone.length && !fresh.length) return;
      const t = now();
      M.deleteRows(R.rows, gone, t);
      R.rows.push(...M.drawingRows(fresh, { note: n.id, ctx: M.drawCtx(n.data.ctx), z: M.maxZ(R.rows) + 1 }, t));
      dirty();
    } });
}
function goTo(n){
  const c = n.data.ctx, v = R.video;
  if (!v || !c || c.t == null){ if (!v && kindNow() === "video") toast("Pick the video again to play it"); return; }
  v.pause(); v.currentTime = c.t;
  window.scrollTo({ top: 0, behavior: "smooth" });
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
    if (dr.draw){
      const s0 = el("span"), th = picBox(dr.draw.frame, dr.draw.items, "");
      th.title = "Edit the drawing"; th.onclick = () => drawDraft(dr.draw.frame);
      s0.appendChild(th);
      s0.appendChild(btn("", "×", (e) => { e.stopPropagation(); dr.draw = null; paintAtts(); paint(); paintPen(); if (opts.onChange) opts.onChange(); }, "Remove the drawing"));
      atts.appendChild(s0);
    }
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
    // A new note or a reply is drawn on the clean picture: the other notes' drawings stay on theirs.
    drawCanvas({ src: fr.url, vb: fr.vb, base: [], items: dr.draw ? dr.draw.items : [], onDone: (items) => {
      if (R !== rv) return;
      dr.draw = items.length ? { frame: fr, items } : null;
      paintAtts(); paint(); paintPen();
      if (opts.onChange) opts.onChange();
    } });
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
  const where = () => { const d = R.drafts["+new"]; const c = d && d.draw ? d.draw.frame.ctx : ctxNow(); lab.textContent = "New note" + (c && c.t != null ? " at " + fmtTime(c.t, R.fps) + " · f " + Math.round(c.t * R.fps) : ""); };
  row.appendChild(lab);
  row.appendChild(btn("ib", "×", () => {
    const d = R.drafts["+new"];
    if (d && (d.text.trim() || d.shots.length || d.draw)){ ask({ title: "Discard this note?", ok: "Discard", danger: true }).then((y) => { if (y){ delete R.drafts["+new"]; R.newOpen = false; paintNewBar(); } }); return; }
    delete R.drafts["+new"]; R.newOpen = false; paintNewBar();
  }, "Close"));
  nb.appendChild(row);
  nb.appendChild(composer({ key: "+new", placeholder: "Add a note…", status: null, frameFor: currentFrame, onChange: () => { where(); paintOverlay(); },
    onSend: (text, shots, state, draw) => {
      const t = now(), ctx = draw ? draw.frame.ctx : ctxNow();
      const n = M.newNote({ text, author: who, ctx, shots }, t);
      R.rows.push(n);
      if (draw) R.rows.push(...M.drawingRows(draw.items, { note: n.id, ctx: M.drawCtx(ctx), z: M.maxZ(R.rows) + 1 }, t));
      R.newOpen = false;
      dirty();
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
  const fr = await currentFrame();
  if (!fr){ toast(kindNow() === "video" ? "Pick the video again to draw on its frames" : "The picture is not on this device"); return; }
  const rv = R, d = R.drafts["+new"] = R.drafts["+new"] || newDraft();
  if (d.draw && !(await ask({ title: "Replace the drawing?", text: "The new note already has a drawing.", ok: "Replace" }))) return;
  if (R !== rv) return;
  drawCanvas({ src: fr.url, vb: fr.vb, base: [], items: [], onDone: (items) => {
    if (!items.length || R !== rv) return;
    d.draw = { frame: fr, items };
    R.newOpen = "focus";
    paintNewBar();
  } });
}

// The drawing canvas, opened turned / mirrored as the review's view; its turn / mirror buttons
// change that view.
function drawCanvas(o){
  const rv = R;
  DRAW.open(Object.assign({ numOf, view: viewOf(), onView: (vw) => { if (R === rv) setView({ rot: vw.rot, mirror: vw.mirror }); } }, o));
}

// ---- full-screen viewer ------------------------------------------------------------------------
// A picture with its drawings: pinch / double-tap / wheel zoom, drag to pan. o: {url, vb, rows, onDraw}
function viewer(o){
  const v = el("div", "view"), box = el("div", "vb"), img = el("img"), top = el("div", "vt");
  img.src = o.url; img.alt = ""; img.draggable = false; box.appendChild(img);
  if (o.rows && o.rows.length) box.appendChild(overlay(o.vb, o.rows));
  const close = () => { v.remove(); window.removeEventListener("resize", fit); const i = sheets.indexOf(close); if (i >= 0) sheets.splice(i, 1); };
  top.appendChild(btn("btn", "Close", close));
  top.appendChild(el("span", "sp"));
  if (o.onDraw) top.appendChild(btn("btn", "✎ Draw", () => { close(); o.onDraw(); }));
  v.appendChild(box); v.appendChild(top);
  let V = { z: 1, x: 0, y: 0 }, base = { w: 1, h: 1 };
  const vw = o.view || { rot: 0, mirror: false };
  function fit(){
    const W = innerWidth, H = innerHeight, a = vw.rot % 180 ? o.vb[3] / o.vb[2] : o.vb[2] / o.vb[3];
    let w = W, h = W / a;
    if (h > H){ h = H; w = H * a; }
    base = { w, h };
    box.style.width = w + "px"; box.style.height = h + "px";
    box.querySelectorAll(":scope > img, :scope > svg").forEach((n) => turnEl(n, w, h, vw));
    V = { z: 1, x: (W - w) / 2, y: (H - h) / 2 };
    apply();
  }
  const apply = () => { box.style.transform = `translate(${V.x}px,${V.y}px) scale(${V.z})`; };
  const zoomAt = (x, y, z) => { z = RC.clamp(z, 1, 12); const lx = (x - V.x) / V.z, ly = (y - V.y) / V.z; V = { z, x: x - lx * z, y: y - ly * z }; if (z === 1) fit(); else apply(); };
  const pts = new Map();
  let g = null, lastTap = 0;
  const start = () => {
    const p = [...pts.values()];
    if (!p.length){ g = null; return; }
    const m = p.length > 1 ? [(p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2] : [p[0].x, p[0].y];
    g = { v: { ...V }, m, d: p.length > 1 ? RC.hyp(p[0].x - p[1].x, p[0].y - p[1].y) : 0 };
  };
  v.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".vt")) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { v.setPointerCapture(e.pointerId); } catch {}
    start();
  });
  v.addEventListener("pointermove", (e) => {
    const q = pts.get(e.pointerId);
    if (!q || !g) return;
    q.x = e.clientX; q.y = e.clientY;
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
    if (!pts.size && !moved && e.type === "pointerup"){
      const t = now();
      if (t - lastTap < 320){ zoomAt(e.clientX, e.clientY, V.z > 1.2 ? 1 : 2.5); lastTap = 0; } else lastTap = t;
    }
    if (V.z <= 1.01) fit();
    start();
  };
  v.addEventListener("pointerup", up); v.addEventListener("pointercancel", up);
  v.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, V.z * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  v.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
  window.addEventListener("resize", fit);
  document.body.appendChild(v);
  sheets.push(close);
  fit();
}
async function openPicture(){
  const url = R.url || (await getPicture() || {}).url;
  if (!url) return;
  viewer({ url, vb: [0, 0, docW() || 1, docH() || 1], rows: stageDrawings(), view: viewOf(), onDraw: drawNew });
}
function openFrame(n, f, rid){
  viewer({ url: f.url, vb: f.vb, view: viewOf(), rows: rid ? drawingsOn(f, { reply: rid }) : drawingsOn(f), onDraw: () => {
    R.openReply[n.id] = true; renderNotes();
    const box = document.querySelector(`.cmp[data-key="${n.id}"]`);
    if (box) box.querySelector(".pen").click();
  } });
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
    R.file && !R.meta.kept ? { label: "Keep a copy on this device", note: fmtBytes(R.file.size), fn: keepCopy } : null,
    R.meta.kept ? { label: "Remove the kept copy", fn: dropCopy } : null,
    { label: R.file ? "Use another copy of the file…" : "Pick the file…", fn: () => { const p = picker(kindNow() === "video" ? "video/*" : "image/*", false, (fs) => rebind(fs[0])); document.body.appendChild(p); p.click(); setTimeout(() => p.remove(), 60000); } },
    { label: "Your name: " + (who || "—"), fn: setName },
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

initSW();
route();
// For tests and debugging only.
window.__sightReview = { get R(){ return R; }, DB, M, flush, openMedia, importReviewFile };
