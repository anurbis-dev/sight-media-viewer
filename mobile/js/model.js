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

// Notes in Sight's order (video: by time, then created; else by created) — the numbers match Sight.
export function notesSorted(rows, kind){
  const n = live(rows).filter((r) => r.kind === "note");
  if (kind === "video") n.sort((a, b) => ((a.data.ctx && a.data.ctx.t) || 0) - ((b.data.ctx && b.data.ctx.t) || 0) || (a.data.created || 0) - (b.data.created || 0));
  else n.sort((a, b) => (a.data.created || 0) - (b.data.created || 0));
  return n;
}
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
// Tombstones: a deleted reply stays in the list ({id, created, deleted}) so an older copy cannot
// bring it back; its drawings go with it, as in Sight.
export function deleteReply(rows, note, rid, now = Date.now()){
  note.data = Object.assign({}, note.data, { replies: (note.data.replies || []).map((r) => r && r.id === rid ? { id: r.id, created: r.created, deleted: now } : r) });
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
// What a drawing made on a note's frame takes as data.ctx (FORMAT.md Context): video {t, hold}.
export function drawCtx(c){
  if (!c) return null;
  if (c.t != null) return { t: c.t, hold: c.hold || 0 };
  if (c.vk) return { vk: c.vk, cam: c.cam };
  return null;
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
