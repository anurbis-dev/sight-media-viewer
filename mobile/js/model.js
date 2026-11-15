// The review's rows on the device and every change the app makes to them, in the shapes Sight
// writes (docs/FORMAT.md): notes with replies / status events, drawings with data.note /
// data.reply / ctx, the file's review state, tombstones (deleted_at), and the .srev package.
// Pure functions over plain rows (no DOM), so tests/pwa_unit.cjs runs them in Node.

const RC = () => globalThis.SightReviewCore;

export const ROW_KEYS = ["id", "kind", "shape_kind", "x", "y", "w", "h", "rotation", "z_index", "color", "data", "locked", "created_at", "updated_at"];
export const NOTE_STATES = { open: "Open", progress: "In progress", done: "Resolved" };
export const REVIEW_STATES = { review: "Needs review", changes: "Changes requested", approved: "Approved" };
export const EVENT_LABEL = { done: "Resolved", progress: "In progress", open: "Reopened" };

export const live = (rows) => rows.filter((r) => r.deleted_at == null);
export const byId = (rows, id) => rows.find((r) => r.id === id) || null;

// Notes in Sight's order: by when they were made, earlier first — videos too (the frame does not
// count), so the numbers match Sight and a new note always lands at the end.
export function notesSorted(rows, kind){
  const n = live(rows).filter((r) => r.kind === "note");
  n.sort((a, b) => (a.data.created || 0) - (b.data.created || 0));
  return n;
}
// The frame a time falls in. A stored frame time ((n + 0.01)·fd to 3 dp, see frameTime) can round
// a hair below n·fd at 23.976 / 29.97 / 60 fps and up, so one is recognised as such and kept on
// its frame; any other time is floored.
export function frameIndex(t, fps){
  const fd = 1 / (fps || 25), k = Math.round(t / fd - 0.01);
  // Only a time with exactly 3 decimals can be a stored one (a player's own time never is).
  if (Math.abs(t * 1000 - Math.round(t * 1000)) < 1e-6 && Math.abs(t - Math.round((k + 0.01) * fd * 1000) / 1000) < 6e-4) return Math.max(0, k);
  return Math.floor(t / fd + 1e-6);
}
// A time as stored for its frame (a note's / drawing's ctx.t): the frame's start + a hair, 3 dp, so
// it shows on exactly that frame (review-core ctxVisible) and Sight numbers it the same.
// frameTime(frameTime(t)) === frameTime(t).
export const frameTime = (t, fps) => Math.round((frameIndex(t, fps) + 0.01) / (fps || 25) * 1000) / 1000;
export const liveReplies = (note) => (note.data.replies || []).filter((r) => r && !r.deleted);
export const noteState = (note) => (note.data.status === "done" || note.data.status === "progress") ? note.data.status : "open";

// A drawing made with a reply goes with it: gone when the reply is deleted.
export function replyGone(rows, it){
  const rid = it.data && it.data.reply;
  if (!rid) return false;
  const n = byId(rows, it.data.note);
  if (!n || n.deleted_at != null) return false;
  const r = (n.data.replies || []).find((x) => x && x.id === rid);
  return !!(r && r.deleted);
}
export function drawings(rows){
  return live(rows).filter((r) => r.kind !== "note" && r.kind !== "status" && r.data && RC().validItem(r) && !replyGone(rows, r));
}
// The frames a video note was drawn on (its own drawings, not its replies'), in time order.
export function noteFrameTimes(rows, note){
  const ts = new Set();
  drawings(rows).forEach((r) => { if (r.data.note === note.id && !r.data.reply && r.data.ctx && r.data.ctx.t != null) ts.add(r.data.ctx.t); });
  return [...ts].sort((a, b) => a - b);
}
export const maxZ = (rows) => rows.reduce((m, r) => Math.max(m, r.z_index || 0), 0);

export function counts(rows){
  const c = { notes: 0, open: 0, progress: 0, done: 0 };
  live(rows).forEach((r) => { if (r.kind === "note"){ c.notes++; c[noteState(r)]++; } });
  return c;
}

function noteRow(data, now){
  return { id: RC().uid(), kind: "note", shape_kind: null, x: null, y: null, w: null, h: null, rotation: 0, z_index: 0, color: null,
    locked: 0, data, created_at: now, updated_at: now, deleted_at: null };
}
export function newNote({ text, author, ctx, shots }, now = Date.now()){
  return noteRow({ text: text || "", author: author || "", created: now, status: "open", ctx: ctx || null, shots: shots || [] }, now);
}
export function addReply(note, { text, author, shots }, now = Date.now()){
  const r = { id: RC().uid(), text: text || "", author: author || "", created: now };
  if (shots && shots.length) r.shots = shots;
  note.data = Object.assign({}, note.data, { replies: (note.data.replies || []).concat([r]) });
  note.updated_at = Math.max(now, note.updated_at || 0);
  return r;
}
// A state change: the note's status / status_at (the merge key) and an event in the thread.
export function setNoteState(note, state, author, now = Date.now()){
  const ev = { id: RC().uid(), event: state, author: author || "", created: now };
  note.data = Object.assign({}, note.data, { status: state, status_at: now, replies: (note.data.replies || []).concat([ev]) });
  note.updated_at = Math.max(now, note.updated_at || 0);
  return ev;
}
export function editNote(note, patch, now = Date.now()){
  note.data = Object.assign({}, note.data, patch, { edited_at: now });
  note.updated_at = Math.max(now, note.updated_at || 0);
}
// A picture's own text (FORMAT.md captions): pic = {} | {t} | {shot}; "" removes it. It is the
// note's content, so it stamps edited_at like the note's text (the later edit wins the merge).
export function setCaption(note, pic, text, same, now = Date.now()){
  const caps = RC().withCaption(note.data, pic, text, same);
  const data = Object.assign({}, note.data, { edited_at: now });
  if (caps) data.captions = caps; else delete data.captions;
  note.data = data;
  note.updated_at = Math.max(now, note.updated_at || 0);
}
// A reply's text / pictures changed: `edited` is its merge key (the later edit wins, FORMAT.md) —
// always past the stamp it has, so a clock behind the reply author's still wins.
const after = (r, now) => Math.max(now, RC().stamp(r.edited != null ? r.edited : r.created) + 1);
export function editReply(note, rid, patch, now = Date.now()){
  note.data = Object.assign({}, note.data, { replies: (note.data.replies || []).map((r) => r && r.id === rid && !r.deleted ? Object.assign({}, r, patch, { edited: after(r, now) }) : r) });
  note.updated_at = Math.max(now, note.updated_at || 0);
}
// Tombstones: a deleted reply stays in the list ({id, created, deleted}) so an older copy cannot
// bring it back; its drawings go with it, as in Sight.
export function deleteReply(rows, note, rid, now = Date.now()){
  note.data = Object.assign({}, note.data, { replies: (note.data.replies || []).map((r) => r && r.id === rid ? { id: r.id, created: r.created, deleted: after(r, now) } : r) });
  note.updated_at = Math.max(now, note.updated_at || 0);
  rows.forEach((r) => { if (r.deleted_at == null && r.data && r.data.reply === rid && r.data.note === note.id){ r.deleted_at = now; r.updated_at = now; } });
}
export function deleteRows(rows, ids, now = Date.now()){
  const s = new Set(ids);
  rows.forEach((r) => { if (s.has(r.id) && r.deleted_at == null){ r.deleted_at = now; r.updated_at = now; } });
}
// A note and every drawing that belongs to it.
export function deleteNote(rows, id, now = Date.now()){
  deleteRows(rows, rows.filter((r) => r.id === id || (r.data && r.data.note === id)).map((r) => r.id), now);
}
// Canvas items ({kind, shape_kind, z, data}) as drawing rows of note `note` (reply `reply`).
export function drawingRows(items, { note, reply, ctx, z }, now = Date.now()){
  return items.map((it, i) => {
    const d = Object.assign({}, it.data, { note: note || null, ctx: ctx ? JSON.parse(JSON.stringify(ctx)) : null });
    if (reply) d.reply = reply; else delete d.reply;
    if (!d.created) d.created = now;
    return Object.assign(RC().drawingRow({ id: RC().uid(), kind: it.kind, shape_kind: it.shape_kind, z: z + i, data: d }, now), { deleted_at: null });
  });
}
// What a drawing made on a note's frame takes as data.ctx (FORMAT.md Context): video {t, hold};
// 3D {vk, cam} with the view's hidden meshes / explode when the view has them (0.41 / 0.42).
export function drawCtx(c){
  if (!c) return null;
  if (c.t != null) return { t: c.t, hold: c.hold || 0 };
  if (c.vk){
    const o = { vk: c.vk, cam: c.cam };
    if (Array.isArray(c.hidden)) o.hidden = c.hidden.slice();
    if (typeof c.explode === "number") o.explode = c.explode;
    return o;
  }
  return null;
}
// The 3D views a review's rows stand on (FORMAT.md 3D ctx), oldest first: {vk, cam, hidden, explode,
// created} — Sight's rebuildViews (annotate.js), so the numbers match ("View 1" is the first one made):
// a row's time is data.created; hidden = a note's list, else the first given (null: none, matches any);
// explode = the newest row's ctx.explode, or a pre-0.42 note's v3d.explode, else null.
export function views3d(rows){
  const out = new Map();
  live(rows).forEach((r) => {
    const c = r.data && r.data.ctx;
    if (!c || !c.vk || !c.cam || !Array.isArray(c.cam.p) || !Array.isArray(c.cam.t)) return;
    const at = r.data.created || 0;
    let v = out.get(c.vk);
    if (!v){ v = { vk: c.vk, cam: c.cam, hidden: null, explode: null, explodeAt: 0, created: at }; out.set(c.vk, v); }
    v.created = Math.min(v.created, at);
    if (Array.isArray(c.hidden) && (v.hidden == null || r.kind === "note")) v.hidden = c.hidden.slice();
    const e = typeof c.explode === "number" ? c.explode : r.kind === "note" && c.v3d && typeof c.v3d.explode === "number" ? c.v3d.explode : undefined;
    if (e !== undefined && at >= v.explodeAt){ v.explode = e; v.explodeAt = at; }
  });
  return new Map([...out.values()].sort((a, b) => a.created - b.created).map((v) => [v.vk, v]));
}
// The explode a note's (a reply's) picture of view vk is taken at: that of its own rows there (Sight's
// explodeOf: an added note keeps the look it was made with), a pre-0.42 note's v3d.explode, else undefined
// (then the view's amount).
export function explodeOf(vk, rows){
  for (const r of rows){
    const c = r && r.data && r.data.ctx;
    if (!c || c.vk !== vk) continue;
    if (typeof c.explode === "number") return c.explode;
    if (r.kind === "note" && c.v3d && typeof c.v3d.explode === "number") return c.v3d.explode;
  }
  return undefined;
}
// The views a 3D note stands on (like RC.noteTimes for video, 0.47+): those its own drawings are on
// and those with a picture text of it, in view order; the view it was written on only when it has
// neither (fallback).
export function noteViews(rows, note, order, fallback = true){
  const c = note.data.ctx, vk0 = c && c.vk, vks = [];
  const add = (k) => { if (k && !vks.includes(k)) vks.push(k); };
  drawings(rows).forEach((r) => { if (r.data.note === note.id && !r.data.reply) add((r.data.ctx && r.data.ctx.vk) || vk0); });
  Object.keys(note.data.captions || {}).forEach((k) => { if (k.startsWith("vk:") && String(note.data.captions[k] || "").trim()) add(k.slice(3)); });
  if (!vks.length && fallback) add(vk0);
  const rank = (k) => { const i = order.indexOf(k); return i < 0 ? 1e9 : i; };
  return vks.sort((a, b) => rank(a) - rank(b));
}
// The views a reply drew on (view order), null with no drawing.
export function replyViews(rows, note, rid, order){
  const own = drawings(rows).filter((x) => x.data.reply === rid && x.data.note === note.id);
  if (!own.length) return null;
  const vk0 = note.data.ctx && note.data.ctx.vk, vks = [];
  own.forEach((x) => { const k = (x.data.ctx && x.data.ctx.vk) || vk0; if (k && !vks.includes(k)) vks.push(k); });
  const rank = (k) => { const i = order.indexOf(k); return i < 0 ? 1e9 : i; };
  return vks.sort((a, b) => rank(a) - rank(b));
}

// The file's review state (Library.set_review_status): the newest live status row; setting it
// again keeps one row, retires the others and appends to the history.
export function statusRows(rows){
  return live(rows).filter((r) => r.kind === "status").sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
}
export function reviewState(rows){
  const r = statusRows(rows)[0];
  return (r && r.data && r.data.state) || "";
}
export function setReviewState(rows, state, author, now = Date.now()){
  const cur = statusRows(rows);
  if (!cur.length && !state) return null;
  let history = [];
  cur.forEach((r) => {
    const d = r.data || {};
    const past = (Array.isArray(d.history) && d.history.length) ? d.history : d.state ? [{ state: d.state, author: d.author || "", at: d.at }] : [];
    history = RC().mergeHistory(history, past);
  });
  cur.slice(1).forEach((r) => { r.deleted_at = now; r.updated_at = now; });
  history.push({ state, author: author || "", at: now });
  const data = { state: state || null, author: author || "", at: now, history };
  if (cur.length){ cur[0].data = data; cur[0].updated_at = now; return cur[0]; }
  const row = { id: RC().uid(), kind: "status", shape_kind: null, x: null, y: null, w: null, h: null, rotation: 0, z_index: 0, color: null,
    locked: 0, data, created_at: now, updated_at: now, deleted_at: null };
  rows.push(row);
  return row;
}

// Shot ids a set of rows refers to (note pictures and live replies' pictures).
export function shotIds(rows){
  const out = new Set();
  live(rows).forEach((r) => {
    const d = r.data || {};
    (d.shots || []).forEach((s) => out.add(String(s)));
    (d.replies || []).forEach((x) => { if (x && !x.deleted) (x.shots || []).forEach((s) => out.add(String(s))); });
  });
  return out;
}

// ---- .srev package ---------------------------------------------------------------------------

export const ASSET_KEYS = ["id", "name", "path", "ext", "kind", "size", "mtime", "width", "height", "duration"];

export function buildPackage({ asset, rows, shots, author, app }, now = Date.now()){
  return {
    format: RC().FORMAT, version: RC().FORMAT_VERSION, app, exported_at: now, author: author || "",
    asset: Object.fromEntries(ASSET_KEYS.map((k) => [k, asset[k] === undefined ? null : asset[k]])),
    annotations: live(rows).map((r) => Object.fromEntries(ROW_KEYS.map((k) => [k, r[k] === undefined ? null : r[k]]))),
    deleted: rows.filter((r) => r.deleted_at != null).map((r) => ({ id: r.id, deleted_at: r.deleted_at })),
    shots: shots || {},
  };
}
// review.parse_package's checks.
export function parsePackage(text){
  let pkg;
  try { pkg = JSON.parse(String(text).replace(/^﻿/, "")); }
  catch { throw new Error("Not a Sight review file"); }
  if (!pkg || typeof pkg !== "object" || pkg.format !== RC().FORMAT) throw new Error("Not a Sight review file");
  if ((parseInt(pkg.version, 10) || 0) > RC().FORMAT_VERSION) throw new Error("This review file was made by a newer Sight");
  if (!Array.isArray(pkg.annotations) || !pkg.asset || typeof pkg.asset !== "object") throw new Error("Review file is incomplete");
  return pkg;
}
// Merges a package into the rows held here by the shared rules (review-core mergeRows =
// Library.import_annotations). shotMap renames picture ids (non-hex ids get one derived from the
// bytes, as in Sight).
export function mergePackage(rows, pkg, shotMap, now = Date.now()){
  const res = RC().mergeRows(rows, pkg.annotations.filter((r) => r && typeof r === "object"), { deleted: Array.isArray(pkg.deleted) ? pkg.deleted : [], shotMap: shotMap || {}, now });
  res.rows.forEach((r) => { if (r.deleted_at === undefined) r.deleted_at = null; });
  return res;
}
// How many of a package's row ids a review already holds (finds an earlier import of the same
// review, like Library.asset_holding_annotations).
export function overlap(rows, pkg){
  const have = new Set(rows.map((r) => String(r.id).toLowerCase()));
  return pkg.annotations.filter((r) => r && have.has(String(r.id).toLowerCase())).length;
}
