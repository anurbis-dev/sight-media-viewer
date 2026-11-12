// Reports made on the device (decision 14 in PLAN-mobile): the same content as Sight's PDF report
// (review.build_pdf) — cover, every note with its frame and the drawings burned in, replies,
// pictures — as a PDF (pages drawn on a canvas with the device's fonts, packed by pdf.js) or a
// static HTML file (one self-contained file, no scripts).

import { decode, canvasBlob, dropCanvas, fmtTime } from "./media.js";
import { pdfFromJpegs } from "./pdf.js";
import { notesSorted, liveReplies, drawings, NOTE_STATES, REVIEW_STATES, EVENT_LABEL, reviewState } from "./model.js";

const RC = () => globalThis.SightReviewCore;
export function fmtDate(ms){
  try { return new Date(ms).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
}

// A picture {blob, w, h} with drawings (doc units docW × docH) burned in, ≤ 1600 px.
export async function burn(pic, docW, docH, items, numOf){
  if (!pic) return null;
  if (!items.length) return pic;
  const im = await decode(pic.blob);
  const c = document.createElement("canvas");
  c.width = pic.w; c.height = pic.h;
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(im, 0, 0, c.width, c.height);
  if (im.close) im.close();
  g.setTransform(c.width / (docW || c.width), 0, 0, c.height / (docH || c.height), 0, 0);
  RC().drawCanvas(g, items, numOf);
  const blob = await canvasBlob(c, "image/jpeg", 0.88), out = { blob, w: c.width, h: c.height };
  dropCanvas(c);
  return out;
}
async function picOf(blob){
  if (!blob) return null;
  try {
    const im = await decode(blob), w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
    if (im.close) im.close();
    return { blob, w, h };
  } catch { return null; }
}

// src: { picture(): {blob, w, h} | null  (image, the clean picture ≤ 1600 px),
//        frameAt(t): {blob, w, h} | null  (video frame, clean), shot(id): Blob | null }
export async function gatherReport({ asset, rows, fps, author, appLabel, src, progress }){
  const kind = asset.kind, notes = notesSorted(rows, kind), all = drawings(rows);
  const num = new Map(notes.map((n, i) => [n.id, i + 1]));
  const numOf = (it) => num.get(it.data && it.data.note) || "";
  const W = asset.width, H = asset.height;
  let cover = null, picture = null;
  if (kind === "image"){
    picture = await src.picture();
    cover = await burn(picture, W, H, all, numOf);
  }
  const shotPics = async (ids) => (await Promise.all((ids || []).map(async (s) => picOf(await src.shot(String(s)))))).filter(Boolean);
  const out = [];
  for (const [i, n] of notes.entries()){
    if (progress) progress(i, notes.length);
    const d = n.data, c = d.ctx || null;
    let frame = null, cap = "";
    if (kind === "image"){
      const own = all.filter((it) => it.data.note === n.id);
      // One note on a picture: its frame would just repeat the cover.
      if (notes.length > 1 && own.length) frame = await burn(picture, W, H, own, numOf);
    } else if (kind === "video" && c && c.t != null){
      const f = await src.frameAt(c.t);
      if (f) frame = await burn(f, W || f.w, H || f.h, all.filter((it) => RC().ctxVisible(it.data.ctx, { t: c.t, fps })), numOf);
      cap = "Frame " + Math.round(c.t * fps) + " · " + fmtTime(c.t, fps);
    }
    const replies = [];
    for (const r of liveReplies(n)) replies.push({ author: r.author || "", date: fmtDate(r.created), text: r.text || "", event: r.event || "", shots: await shotPics(r.shots) });
    out.push({ num: i + 1, ctx: c && c.t != null ? fmtTime(c.t, fps) + "  ·  f " + Math.round(c.t * fps) : "", author: d.author || "", date: fmtDate(d.created),
      text: d.text || "", status: d.status, frame, frameCaption: cap, shots: await shotPics(d.shots), replies });
  }
  const st = reviewState(rows);
  return {
    title: "Review — " + asset.name,
    subtitle: asset.path && asset.path !== asset.name ? asset.path : "",
    meta: [["Type", (asset.ext || "").replace(".", "").toUpperCase()], ["Size", W && H ? `${W} × ${H}` : ""],
      ["Duration", asset.duration ? fmtTime(asset.duration, fps) : ""], ["State", REVIEW_STATES[st] || ""], ["Reviewer", author || ""],
      ["Notes", String(notes.length)], ["Open", String(notes.filter((n) => n.data.status !== "done").length)],
      ["In progress", String(notes.filter((n) => n.data.status === "progress").length || "")], ["Exported", fmtDate(Date.now())]],
    cover, notes: out, footer: appLabel || "Sight Review",
  };
}

// ---- static HTML -----------------------------------------------------------------------------

const blobUrl = (blob) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(r.error); r.readAsDataURL(blob); });
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const HTML_CSS = `
:root { --bg: #f5f5f7; --card: #fff; --fg: #1d1d1f; --muted: #6e6e73; --line: #d9d9de; --red: #d0342c; --green: #2f9d5b; --amber: #d98200; --chip: #ececf0; }
@media (prefers-color-scheme: dark) { :root { --bg: #141416; --card: #1f1f23; --fg: #f2f2f0; --muted: #9a9aa2; --line: #34343a; --amber: #f0a020; --chip: #2a2a30; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 900px; margin: 0 auto; padding: 18px 16px 40px; }
h1 { font-size: 20px; margin: 0 0 2px; word-break: break-word; }
.sub { color: var(--muted); font-size: 12px; word-break: break-all; margin: 0 0 8px; }
.meta { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 14px; padding: 0; }
.meta span { background: var(--chip); border-radius: 999px; padding: 2px 10px; font-size: 12px; }
.meta b { font-weight: 600; color: var(--muted); margin-right: 4px; }
img { display: block; max-width: 100%; height: auto; border-radius: 8px; }
.cover { width: 100%; margin-bottom: 6px; }
.note { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; margin: 12px 0; break-inside: avoid; }
.nh { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 12px; color: var(--muted); }
.num { min-width: 22px; height: 22px; border-radius: 11px; background: var(--red); color: #fff; display: inline-grid; place-items: center; font-weight: 700; font-size: 11px; padding: 0 6px; }
.progress .num { background: var(--amber); } .done .num { background: var(--green); }
.ctx { font-weight: 600; color: var(--fg); font-variant-numeric: tabular-nums; }
.state { margin-left: auto; font-weight: 600; }
.state.progress { color: var(--amber); } .state.done { color: var(--green); }
.text { white-space: pre-wrap; word-break: break-word; margin: 6px 0; font-size: 16px; }
.done .text { text-decoration: line-through; text-decoration-color: var(--muted); }
.frame { margin: 8px 0 2px; }
.cap { font-size: 11px; color: var(--muted); }
.shots { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.shots img { max-height: 220px; width: auto; border: 1px solid var(--line); }
.replies { margin: 10px 0 0; padding-left: 12px; border-left: 2px solid var(--line); }
.rep { margin: 6px 0; } .rep .rh { font-size: 11px; color: var(--muted); } .rep .rt { white-space: pre-wrap; word-break: break-word; }
.ev { font-size: 12px; color: var(--muted); }
.gen { font-size: 11px; color: var(--muted); text-align: center; margin-top: 30px; }
@media print { body { background: #fff; } .note { border-color: #ccc; } }
`;

export async function toHtml(p){
  const img = async (pic, cls) => pic ? `<img class="${cls || ""}" src="${await blobUrl(pic.blob)}" width="${pic.w}" height="${pic.h}" alt="">` : "";
  const shots = async (list) => list.length ? `<div class="shots">${(await Promise.all(list.map((s) => img(s)))).join("")}</div>` : "";
  const parts = [`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(p.title)}</title><style>${HTML_CSS}</style></head><body><main>`];
  parts.push(`<h1>${esc(p.title)}</h1>`);
  if (p.subtitle) parts.push(`<p class="sub">${esc(p.subtitle)}</p>`);
  const meta = p.meta.filter((m) => m[1] !== "" && m[1] != null);
  if (meta.length) parts.push(`<p class="meta">${meta.map((m) => `<span><b>${esc(m[0])}</b>${esc(m[1])}</span>`).join("")}</p>`);
  parts.push(await img(p.cover, "cover"));
  for (const n of p.notes){
    const st = n.status === "done" ? "done" : n.status === "progress" ? "progress" : "open";
    parts.push(`<section class="note ${st}"><div class="nh"><span class="num">${n.num}</span>`);
    if (n.ctx) parts.push(`<span class="ctx">${esc(n.ctx)}</span>`);
    parts.push(`<span>${esc([n.author, n.date].filter(Boolean).join(" · "))}</span><span class="state ${st}">${esc(NOTE_STATES[st])}</span></div>`);
    if (n.text) parts.push(`<div class="text">${esc(n.text)}</div>`);
    if (n.frame) parts.push(await img(n.frame, "frame"));
    if (n.frameCaption) parts.push(`<div class="cap">${esc(n.frameCaption)}</div>`);
    parts.push(await shots(n.shots));
    if (n.replies.length){
      parts.push(`<div class="replies">`);
      for (const r of n.replies){
        if (r.event){ parts.push(`<div class="rep ev">${esc((EVENT_LABEL[r.event] || "Reopened") + (r.author ? " by " + r.author : "") + " · " + r.date)}</div>`); continue; }
        parts.push(`<div class="rep"><div class="rh">${esc([r.author, r.date].filter(Boolean).join(" · "))}</div>${r.text ? `<div class="rt">${esc(r.text)}</div>` : ""}${await shots(r.shots)}</div>`);
      }
      parts.push(`</div>`);
    }
    parts.push(`</section>`);
  }
  if (!p.notes.length) parts.push(`<p class="gen">No notes.</p>`);
  parts.push(`<p class="gen">${esc(p.footer)}</p></main></body></html>`);
  return new Blob(parts, { type: "text/html" });
}

// ---- PDF -------------------------------------------------------------------------------------
// A4 in points, laid out like review.build_pdf, drawn at SCALE px per point.

const PAGE = [595, 842], M = 40, CW = PAGE[0] - 2 * M, BOTTOM = PAGE[1] - M - 10, SCALE = 2;
const FAM = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif';
const C = { fg: "#1d1d1f", muted: "#6e6e73", sub: "#3a3a3c", line: "#c7c7cc", red: "#d0342c", green: "#34a853", amber: "#c77c02", cap: "#8e8e93" };
const font = (r) => `${r.bold ? "700" : "400"} ${r.size}px ${FAM}`;

let mctx = null;
function measure(r, s){
  if (!mctx) mctx = document.createElement("canvas").getContext("2d");
  mctx.font = font(r);
  return mctx.measureText(s).width;
}
// Runs [{text, size, bold, color, badge}] wrapped to `width` → lines [{h, frags: [{x, text, run}]}].
// Words break at spaces; a word wider than a line (CJK text has no spaces) breaks between characters.
function wrap(runs, width){
  const lines = [];
  let cur = [], x = 0, lh = 0;
  const push = () => { lines.push({ h: lh, frags: cur }); cur = []; x = 0; lh = 0; };
  const place = (text, r, w) => { cur.push({ x, text, run: r, w }); x += w; lh = Math.max(lh, r.size * 1.35); };
  for (const r of runs){
    if (r.badge){
      const w = measure(r, r.text) + r.size * 0.9;
      if (x + w > width && cur.length) push();
      place(r.text, r, w);
      continue;
    }
    const paras = String(r.text).split("\n");
    paras.forEach((para, pi) => {
      if (pi > 0){ if (!cur.length) lh = r.size * 1.35; push(); }
      for (const tok of para.split(/(\s+)/)){
        if (!tok) continue;
        const space = /^\s+$/.test(tok);
        if (space){ if (cur.length) place(" ", r, measure(r, " ")); continue; }
        let w = measure(r, tok);
        if (x + w <= width){ place(tok, r, w); continue; }
        if (cur.length && w <= width){ push(); place(tok, r, w); continue; }
        let chunk = "";
        for (const ch of Array.from(tok)){
          const cw = measure(r, chunk + ch);
          if (x + cw > width && (chunk || cur.length)){ if (chunk) place(chunk, r, measure(r, chunk)); push(); chunk = ch; }
          else chunk += ch;
        }
        if (chunk) place(chunk, r, measure(r, chunk));
      }
    });
  }
  if (cur.length) push();
  return lines;
}

export async function toPdf(p){
  const pages = [[]];
  let y = M;
  const brk = () => { pages.push([]); y = M; };
  const need = (h) => { if (y + h > BOTTOM && y > M) brk(); };
  const add = (h, draw) => { need(h); pages[pages.length - 1].push({ y, draw }); y += h; };
  const gap = (h) => { y += h; };
  const textLines = (runs, x0, width, opts = {}) => {
    for (const ln of wrap(runs, width)){
      add(ln.h, (g, yy) => {
        if (opts.bar){ g.fillStyle = C.line; g.fillRect(x0 - 7.5, yy, 1.5, ln.h); }
        for (const f of ln.frags){
          const r = f.run;
          g.font = font(r);
          g.textBaseline = "middle";
          if (r.badge){
            g.fillStyle = r.bg; g.fillRect(x0 + f.x, yy + ln.h * 0.12, f.w, ln.h * 0.76);
            g.fillStyle = "#fff"; g.fillText(f.text, x0 + f.x + r.size * 0.45, yy + ln.h / 2);
          } else {
            g.fillStyle = r.color || C.fg; g.fillText(f.text, x0 + f.x, yy + ln.h / 2);
            if (r.strike){ g.fillRect(x0 + f.x, yy + ln.h / 2, f.w, 0.6); }
          }
        }
      });
    }
  };
  const image = (pic, x0, width, maxH) => {
    if (!pic) return;
    const k = Math.min(width / pic.w, maxH / pic.h), w = pic.w * k, h = pic.h * k;
    gap(4);
    add(h + 2, async (g, yy) => {
      const im = await decode(pic.blob);
      g.drawImage(im, x0, yy, w, h);
      if (im.close) im.close();
    });
  };
  textLines([{ text: p.title, size: 17, bold: true }], M, CW); gap(2);
  if (p.subtitle){ textLines([{ text: p.subtitle, size: 8.5, color: C.muted }], M, CW); gap(6); }
  const meta = p.meta.filter((m) => m[1] !== "" && m[1] != null);
  if (meta.length){
    const runs = [];
    meta.forEach((m, i) => { runs.push({ text: (i ? "  ·  " : "") + m[0] + " ", size: 8.5, bold: true, color: C.sub }, { text: m[1], size: 8.5, color: C.sub }); });
    textLines(runs, M, CW); gap(10);
  }
  image(p.cover, M, CW, 380);
  for (const n of p.notes){
    const done = n.status === "done";
    gap(12); need(60);
    add(8, (g, yy) => { g.fillStyle = C.line; g.fillRect(M, yy, CW, 0.6); });
    const head = [{ text: String(n.num), size: 9, bold: true, badge: true, bg: done ? C.green : C.red }];
    if (n.ctx) head.push({ text: "  " + n.ctx, size: 9, bold: true, color: C.sub });
    const who = [n.author, n.date].filter(Boolean).join(" · ");
    if (who) head.push({ text: "   " + who, size: 9, color: C.muted });
    if (done) head.push({ text: "   Resolved", size: 9, bold: true, color: C.green });
    else if (n.status === "progress") head.push({ text: "   In progress", size: 9, bold: true, color: C.amber });
    textLines(head, M, CW); gap(3);
    if (n.text){ textLines([{ text: n.text, size: 10.5, strike: done, color: done ? C.muted : C.fg }], M, CW); gap(4); }
    for (const r of n.replies){
      if (r.event){
        textLines([{ text: (EVENT_LABEL[r.event] || "Reopened") + (r.author ? " by " + r.author : "") + " · " + r.date, size: 8.5, color: C.muted }], M + 16, CW - 16, { bar: true });
        gap(4); continue;
      }
      const runs = [{ text: [r.author, r.date].filter(Boolean).join(" · "), size: 8.5, color: C.muted }];
      if (r.text) runs.push({ text: "\n" + r.text, size: 9.5 });
      textLines(runs, M + 16, CW - 16, { bar: true });
      for (const s of r.shots) image(s, M + 16, CW - 16, 200);
      gap(4);
    }
    if (n.frame){
      image(n.frame, M, CW, 300);
      if (n.frameCaption) textLines([{ text: n.frameCaption, size: 7.5, color: C.cap }], M, CW);
    }
    for (const s of n.shots) image(s, M, CW, 300);
  }
  // Render: one JPEG per page.
  const total = pages.length, jpegs = [];
  for (const [i, ops] of pages.entries()){
    const c = document.createElement("canvas");
    c.width = Math.round(PAGE[0] * SCALE); c.height = Math.round(PAGE[1] * SCALE);
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    for (const op of ops) await op.draw(g, op.y);
    g.font = font({ size: 7.5 }); g.fillStyle = "#8c8c94"; g.textBaseline = "alphabetic";
    const label = `${i + 1} / ${total}`;
    g.fillText(label, PAGE[0] - M - measure({ size: 7.5 }, label), PAGE[1] - 22);
    if (p.footer) g.fillText(p.footer, M, PAGE[1] - 22);
    const blob = await canvasBlob(c, "image/jpeg", 0.85);
    jpegs.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height });
    dropCanvas(c);
  }
  return { blob: new Blob([pdfFromJpegs(jpegs, { title: p.title, creator: p.footer, pageW: PAGE[0], pageH: PAGE[1] })], { type: "application/pdf" }), pages: total };
}
