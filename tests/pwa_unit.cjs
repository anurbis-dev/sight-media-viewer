// Unit tests for the phone app's logic (mobile/js) that needs no browser: the review model (rows,
// replies, states, tombstones, review state, the .srev package and its merge), the MP4 frame-rate
// reader and the PDF writer. Run: node tests/pwa_unit.cjs  (CI: .github/workflows/phone-app.yml).
// tests/test_pwa.py also runs it, and checks the PDF it writes with PyMuPDF.
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
globalThis.SightReviewCore = require(path.join(ROOT, "app", "static", "review-core.js"));
if (!globalThis.crypto) globalThis.crypto = require("crypto").webcrypto;

// The app's modules are browser ES modules without imports of their own (these three).
const load = (name) => import("data:text/javascript;base64," + Buffer.from(fs.readFileSync(path.join(ROOT, "mobile", "js", name))).toString("base64"));

const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAGAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDmaKKK8g/RD//Z", "base64");

// ---- a synthetic moov: one sound track, then one video track (timescale, stts) ----------------
function box(type, ...parts){
  const body = Buffer.concat(parts.map((p) => Buffer.isBuffer(p) ? p : Buffer.from(p)));
  const h = Buffer.alloc(8); h.writeUInt32BE(8 + body.length, 0); h.write(type, 4, "ascii");
  return Buffer.concat([h, body]);
}
const u32 = (...v) => { const b = Buffer.alloc(4 * v.length); v.forEach((x, i) => b.writeUInt32BE(x, i * 4)); return b; };
function trak(handler, timescale, entries, mdhdV1){
  const hdlr = box("hdlr", u32(0, 0), Buffer.from(handler), u32(0, 0, 0), Buffer.from("x\0"));
  const mdhd = mdhdV1 ? box("mdhd", Buffer.from([1, 0, 0, 0]), Buffer.alloc(16), u32(timescale), Buffer.alloc(8), u32(0))
    : box("mdhd", u32(0, 0, 0), u32(timescale), u32(0), u32(0));
  const stts = box("stts", u32(0, entries.length), ...entries.map(([c, d]) => u32(c, d)));
  return box("trak", box("tkhd", Buffer.alloc(84)), box("mdia", mdhd, hdlr, box("minf", box("stbl", stts))));
}
const moovPayload = (...traks) => Buffer.concat(traks);

(async () => {
  const M = await load("model.js");
  const { pdfFromJpegs } = await load("pdf.js");
  const { fpsFromMoov, videoFps } = await load("mp4.js");
  let n = 0;
  const t = (name, fn) => { fn(); n++; };

  // ---- mp4 ----
  t("fps 24 from stts", () => {
    const f = fpsFromMoov(moovPayload(trak("soun", 48000, [[100, 1024]]), trak("vide", 24000, [[96, 1000]])));
    assert.deepStrictEqual(f, { fps: 24, frames: 96, duration: 4 });
  });
  t("fps 29.97 (mdhd v1) and variable rate averages", () => {
    assert.strictEqual(fpsFromMoov(moovPayload(trak("vide", 30000, [[300, 1001]], true))).fps, 29.97);
    assert.strictEqual(fpsFromMoov(moovPayload(trak("vide", 600, [[10, 20], [10, 20], [5, 40]]))).fps, 25);
  });
  t("no video track / garbage -> null", () => {
    assert.strictEqual(fpsFromMoov(moovPayload(trak("soun", 48000, [[10, 1024]]))), null);
    assert.strictEqual(fpsFromMoov(Buffer.from("not a box at all")), null);
  });

  // ---- model ----
  const now = 1790000000000;
  t("note, reply, state, review state, tombstones", () => {
    const rows = [];
    const a = M.newNote({ text: "Sky", author: "Ann", ctx: { t: 1, hold: 0 } }, now);
    const b = M.newNote({ text: "Later", author: "Ann", ctx: { t: 0.5, hold: 0 } }, now + 1);
    rows.push(a, b);
    assert.deepStrictEqual(M.notesSorted(rows, "video").map((r) => r.id), [b.id, a.id]);
    assert.deepStrictEqual(M.notesSorted(rows, "image").map((r) => r.id), [a.id, b.id]);
    const r = M.addReply(a, { text: "ok", author: "Bob", shots: ["0123456789abcdef"] }, now + 10);
    const ev = M.setNoteState(a, "done", "Bob", now + 11);
    assert.strictEqual(a.data.status, "done"); assert.strictEqual(a.data.status_at, now + 11);
    assert.strictEqual(ev.event, "done"); assert.strictEqual(a.data.replies.length, 2);
    const d = M.drawingRows([{ kind: "stroke", shape_kind: "brush", z: 3, data: { color: "#ff0000", size: 4, pts: [1, 2, 0.5, 30, 40, 0.5] } }], { note: a.id, reply: r.id, ctx: { t: 1, hold: 0 }, z: 5 }, now + 12);
    rows.push(...d);
    assert.strictEqual(d[0].z_index, 5); assert.strictEqual(d[0].data.reply, r.id); assert.ok(d[0].x <= 1 && d[0].x + d[0].w >= 30, "bbox covers the stroke");
    assert.strictEqual(M.drawings(rows).length, 1);
    assert.deepStrictEqual([...M.shotIds(rows)], ["0123456789abcdef"]);
    M.deleteReply(rows, a, r.id, now + 20);
    assert.ok(a.data.replies[0].deleted); assert.strictEqual(d[0].deleted_at, now + 20);
    assert.strictEqual(M.shotIds(rows).size, 0);
    M.setReviewState(rows, "changes", "Ann", now + 30);
    M.setReviewState(rows, "approved", "Bob", now + 31);
    assert.strictEqual(M.reviewState(rows), "approved");
    const st = rows.filter((x) => x.kind === "status");
    assert.strictEqual(st.length, 1); assert.deepStrictEqual(st[0].data.history.map((h) => h.state), ["changes", "approved"]);
    M.deleteNote(rows, b.id, now + 40);
    assert.deepStrictEqual(M.counts(rows), { notes: 1, open: 0, progress: 0, done: 1 });
  });
  t("package round trip and merge both ways", () => {
    const rows = [];
    const a = M.newNote({ text: "One", author: "Ann" }, now); rows.push(a);
    const b = M.newNote({ text: "Two", author: "Ann" }, now + 1); rows.push(b);
    M.deleteNote(rows, b.id, now + 5);
    const asset = { id: "a1", name: "x.png", path: "x.png", ext: ".png", kind: "image", size: 10, width: 4, height: 3, extra: "dropped" };
    const pkg = M.buildPackage({ asset, rows, shots: {}, author: "Ann", app: "Sight Review test" }, now + 6);
    assert.strictEqual(pkg.annotations.length, 1);
    assert.deepStrictEqual(pkg.deleted, [{ id: b.id, deleted_at: now + 5 }]);
    assert.ok(!("extra" in pkg.asset) && pkg.asset.mtime === null);
    assert.ok(!("deleted_at" in pkg.annotations[0]));
    const parsed = M.parsePackage("﻿" + JSON.stringify(pkg));
    // Someone else holds both notes; the package's tombstone deletes the second there.
    const other = [JSON.parse(JSON.stringify(a)), Object.assign(JSON.parse(JSON.stringify(b)), { deleted_at: null })];
    M.addReply(other[0], { text: "reply there", author: "Bob" }, now + 7);
    const res = M.mergePackage(other, parsed, {}, now + 8);
    assert.strictEqual(res.stats.deleted, 1);
    assert.strictEqual(res.rows.find((r) => r.id === a.id).data.replies.length, 1);  // local reply kept
    // And back: their reply comes into ours.
    const back = M.mergePackage(rows, M.buildPackage({ asset, rows: res.rows, author: "Bob", app: "t" }, now + 9), {}, now + 10);
    assert.strictEqual(back.rows.find((r) => r.id === a.id).data.replies[0].text, "reply there");
    assert.strictEqual(M.overlap(rows, pkg), 1);
    assert.throws(() => M.parsePackage("{}"), /Not a Sight review file/);
    assert.throws(() => M.parsePackage(JSON.stringify({ format: "sight-review", version: 99, asset: {}, annotations: [] })), /newer Sight/);
  });

  // ---- pdf ----
  let pdfOut = null;
  t("pdf writer: structure and xref offsets", () => {
    const pdf = pdfFromJpegs([{ jpeg: new Uint8Array(JPEG), w: 8, h: 6 }, { jpeg: new Uint8Array(JPEG), w: 8, h: 6 }], { title: "Review — небо 空" });
    const s = Buffer.from(pdf).toString("latin1");
    assert.ok(s.startsWith("%PDF-1.4"));
    assert.ok(s.trimEnd().endsWith("%%EOF"));
    const xref = Number(/startxref\n(\d+)/.exec(s)[1]);
    assert.ok(s.slice(xref).startsWith("xref\n0 10\n"));
    const entries = s.slice(xref).split("\n").slice(3, 12);
    entries.forEach((e, i) => { const off = Number(e.slice(0, 10)); assert.ok(s.slice(off).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`); });
    assert.ok(s.includes("/Count 2"));
    pdfOut = pdf;
  });
  if (process.argv[2]) fs.writeFileSync(process.argv[2], pdfOut);
  console.log(`pwa_unit: ${n} tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });
