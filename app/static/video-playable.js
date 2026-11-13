// Playback copies for video the browser cannot decode (old MPEG-1/2 program streams, DivX / Xvid, WMV,
// FLV, H.263, ...). The server converts such a file to H.264 once (Library.start_playback_copy in
// app/library.py); /api/file/<id> serves that copy from then on. Players call convertForPlayback when
// their file gives no picture, then point their <video> at /api/file/<id>?copy=<n> to reload it.

const POLL_MS = 600;
const MAX_LOST = 10; // consecutive failed status polls before giving up (the server is gone)

export async function convertForPlayback(aid, onProgress, stillWanted = () => true){
  let s;
  try {
    s = await fetch("/api/video/transcode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: aid }),
    }).then((r) => r.json());
  } catch {
    return { ok: false, error: "the server did not answer" };
  }
  let lost = 0;
  for (;;){
    if (s.state === "ready") return { ok: true };
    if (s.state === "failed" || s.state === "missing" || s.state === "none"){
      return { ok: false, error: s.error || s.state };
    }
    if (!stillWanted()) return { ok: false, error: "cancelled" };
    if (onProgress) onProgress(Number(s.progress) || 0);
    await new Promise((r) => setTimeout(r, POLL_MS));
    try {
      s = await fetch(`/api/video/transcode?aid=${encodeURIComponent(aid)}`).then((r) => r.json());
      lost = 0;
    } catch {
      if (++lost >= MAX_LOST) return { ok: false, error: "the server stopped answering" };
    }
  }
}
