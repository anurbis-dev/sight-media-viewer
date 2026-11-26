// Sight's store for annotate.js: every call the annotator makes to Sight's own server, in one object
// (docs/ARCHITECTURE.md "Annotator store"). annotate.js never builds a Sight URL or calls fetch() for Sight's
// API itself; another host (Coreline, docs/PLAN-coreline.md R2) hands it its own store with the same members.
//
// index.html makes ONE store and gives it to all three annotators (lightbox, board, compare): the write queue
// is one per page and belongs to the first store it sees.
//
// `api(path, opts)` is index.html's api(): JSON in / out, throws on an HTTP error.
import { convertForPlayback } from "./video-playable.js";
import { createDictationUI } from "./dictation.js";

const enc = encodeURIComponent;
const JSON_HDR = { "content-type": "application/json" };
const SHOT_ID = /^[0-9a-f]{16}$/;

export function createSightStore({ api }){
  // A row write of the queue (annotate.js obDrain / obBeacon) as a fetch request: [path, options].
  const rowReq = (req) => {
    switch (req.op){
      case "create": return ["/api/annotations", { method: "POST", headers: JSON_HDR, body: JSON.stringify(req.body) }];
      case "patch": return [`/api/annotations/${enc(req.id)}`, { method: "PATCH", headers: JSON_HDR, body: JSON.stringify(req.body) }];
      case "delete": return [`/api/annotations/${enc(req.id)}`, { method: "DELETE" }];
      case "batch": return ["/api/annotations/batch", { method: "POST", headers: JSON_HDR, body: JSON.stringify({ items: req.items }) }];
      default: throw new Error("unknown row write " + req.op);
    }
  };
  // The tracker link ▾ (annotate.js "Trackers"): Sight's server holds the credentials (app/trackers.py).
  const trkHeaders = { "X-Sight": "1" };
  async function trkApi(path, opts = {}){
    const r = await fetch(path, { ...opts, headers: { ...trkHeaders, ...(opts.headers || {}) } });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(j?.detail || j?.errors?.[0]?.title || `HTTP ${r.status}`);
    return j;
  }
  const shotUrl = (id) => `/api/review/shots/${id}`;
  return {
    kind: "sight",
    // Sight's server stores what it is sent (Library: created_at / updated_at are its own); undo restores old stamps.
    mergesOnServer: false,
    // The write queue's localStorage keys: one per window (prefix + window id), plus the single key of 0.87.x.
    // Outside "sight.*" on purpose: hydrateSettings() drops sight.* keys the server lacks.
    queue: { prefix: "sight-annot-outbox:v2:", legacy: ["sight-annot-outbox:v1"] },

    // ---- rows ----
    // The rows of an asset ("asset") or a board ("board"), as the server has them.
    loadRows: (scope, id) => api(`/api/annotations?${scope === "board" ? "board_id" : "asset_id"}=${enc(id)}`),
    // One write of the queue: {op: "create", body} | {op: "patch", id, body} | {op: "delete", id} |
    // {op: "batch", items}. `extra` goes into fetch (signal, keepalive). Resolves to the Response ({ok, status});
    // the queue reads the status (annotate.js obFetch: 4xx other than 408 / 429 = refused for good).
    writeRow: (req, extra) => { const [p, o] = rowReq(req); return fetch(p, { ...o, ...extra }); },

    // ---- the file's review state, versions, the frame rate ----
    setReviewState: (aid, state, author) => api(`/api/assets/${aid}/review-status`, { method: "PUT", headers: JSON_HDR, body: JSON.stringify({ state, author }) }),
    versions: async (aid) => (await api(`/api/assets/${aid}/versions`)).items,
    // The asset's frame rate from its info rows (0: unknown).
    fps: async (asset) => {
      const info = await api(`/api/assets/${asset.id}/info`);
      let fps = 0;
      for (const sec of info.sections || []) for (const row of sec.rows || []){
        if (/frame rate/i.test(row[0] || "")){ const f = parseFloat(row[1]); if (f > 0) fps = f; }
      }
      return fps;
    },
    // The original media (note previews seek it in a hidden <video>); `copy`: the server's playable copy.
    mediaUrl: (aid, opts) => opts?.copy ? `/api/file/${aid}?copy=${Date.now()}` : `/api/file/${aid}`,
    // A clip no browser decoder can show: the server makes a playable copy (video-playable.js).
    convertForPlayback: (aid, onProgress, alive) => convertForPlayback(aid, onProgress, alive),

    // ---- shots (screenshots, attached pictures, reference images) ----
    putShot: (blob, type) => api("/api/review/shots", { method: "POST", headers: { "content-type": type }, body: blob }),
    shotUrl,
    // The picture of a reference image (review-core.js setImageSource): Sight's shot ids only.
    shotSrc: (id) => (SHOT_ID.test(String(id)) ? shotUrl(id) : ""),
    shotBlob: async (id) => (await fetch(shotUrl(id))).blob(),

    // ---- stored note previews (Library.note_previews) ----
    previews: {
      list: (aid) => api(`/api/review/nprev/${enc(aid)}`),
      url: (aid, tok, v) => `/api/review/nprev/${enc(aid)}/${tok}.jpg?v=${enc(v)}`,
      put: (aid, tok, v, blob) => api(`/api/review/nprev/${enc(aid)}/${tok}?v=${enc(v)}`, { method: "PUT", headers: { "content-type": "image/jpeg" }, body: blob }),
      prune: (aid, keep) => api(`/api/review/nprev/${enc(aid)}/prune`, { method: "POST", headers: JSON_HDR, body: JSON.stringify({ keep }) }),
    },

    // ---- exports / import (app/review.py) ----
    // kind: "pdf" | "html" | "zip" (payload = the report) | "package" (payload {asset_id, author, reveal}).
    exportReview: (kind, payload) => api(`/api/review/export/${kind}`, { method: "POST", headers: JSON_HDR, body: JSON.stringify(payload) }),
    // A .srev file's bytes; resolves to the Response (annotate.js reads 404 = the media is not in the library).
    importReview: (body, opts) => fetch("/api/review/import" + (opts?.restore ? `?restore=1&before=${Number.isFinite(opts.before) ? opts.before : ""}` : ""), { method: "POST", body }),

    // ---- the tracker link ▾ (docs/ARCHITECTURE.md "Tracker adapters") ----
    trackers: {
      // `p` is relative to the tracker key: "status", "link/<asset id>".
      api: (key, p, opts) => trkApi(`/api/trackers/${enc(key)}/${p}`, opts),
      rows: (aid) => trkApi(`/api/annotations?asset_id=${aid}&deleted=1`),  // with tombstones
      importPackage: (pkg) => trkApi("/api/review/import", { method: "POST", body: JSON.stringify(pkg) }),
    },

    // ---- dictation (dictation.js; the speech-to-text service is Sight's /api/stt) ----
    dictation: (opts) => createDictationUI(opts),
  };
}
