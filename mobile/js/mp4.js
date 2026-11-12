// Frame rate of an MP4 / MOV file (what phones record), read from the container: the video
// track's media timescale (mdhd) and sample durations (stts). Browsers do not expose the frame
// rate, and frame stepping / frame numbers need it. Only the top-level box headers and the moov
// box are read (File.slice), so a large video is not loaded. Returns null when it cannot tell
// (WebM, MKV, broken files) — the caller then measures it while playing or assumes 25.

const MAX_MOOV = 64 * 1024 * 1024;

const typeAt = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));

// Child boxes of [start, end) in a DataView: [{type, start (payload), end}].
function boxes(dv, start, end){
  const out = [];
  let o = start;
  while (o + 8 <= end){
    let size = dv.getUint32(o), hdr = 8;
    const type = typeAt(dv, o + 4);
    if (size === 1){
      if (o + 16 > end) break;
      size = dv.getUint32(o + 8) * 2 ** 32 + dv.getUint32(o + 12); hdr = 16;
    } else if (size === 0) size = end - o;
    if (size < hdr || o + size > end) break;
    out.push({ type, start: o + hdr, end: o + size });
    o += size;
  }
  return out;
}
const child = (dv, b, type) => boxes(dv, b.start, b.end).find((x) => x.type === type) || null;

// moov payload bytes -> {fps, frames, duration, audio} of the first video track (audio: the file has
// a sound track too), or null.
export function fpsFromMoov(u8){
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const traks = boxes(dv, 0, u8.byteLength).filter((b) => b.type === "trak");
  const audio = traks.some((trak) => {
    const mdia = child(dv, trak, "mdia"), hdlr = mdia && child(dv, mdia, "hdlr");
    return !!hdlr && hdlr.end - hdlr.start >= 12 && typeAt(dv, hdlr.start + 8) === "soun";
  });
  for (const trak of traks){
    const mdia = child(dv, trak, "mdia");
    if (!mdia) continue;
    const hdlr = child(dv, mdia, "hdlr");
    if (!hdlr || hdlr.end - hdlr.start < 12 || typeAt(dv, hdlr.start + 8) !== "vide") continue;
    const mdhd = child(dv, mdia, "mdhd");
    if (!mdhd) continue;
    const ver = dv.getUint8(mdhd.start);
    const timescale = dv.getUint32(mdhd.start + (ver === 1 ? 20 : 12));
    const stbl = child(dv, child(dv, mdia, "minf") || { start: 0, end: 0 }, "stbl");
    const stts = stbl && child(dv, stbl, "stts");
    if (!timescale || !stts) continue;
    const count = dv.getUint32(stts.start + 4);
    let frames = 0, ticks = 0;
    for (let i = 0; i < count; i++){
      const o = stts.start + 8 + i * 8;
      if (o + 8 > stts.end) break;
      const c = dv.getUint32(o), d = dv.getUint32(o + 4);
      frames += c; ticks += c * d;
    }
    if (!frames || !ticks) continue;
    const fps = Math.round(timescale * frames / ticks * 1000) / 1000;
    if (!(fps > 1 && fps < 1000)) continue;
    return { fps, frames, duration: ticks / timescale, audio };
  }
  return null;
}

const readAt = async (blob, a, b) => new Uint8Array(await blob.slice(a, b).arrayBuffer());

export async function videoFps(blob){
  try {
    let o = 0;
    const size = blob.size;
    while (o + 8 <= size){
      const h = await readAt(blob, o, Math.min(size, o + 16));
      const dv = new DataView(h.buffer);
      let len = dv.getUint32(0), hdr = 8;
      const type = typeAt(dv, 4);
      if (len === 1){ if (h.length < 16) return null; len = dv.getUint32(8) * 2 ** 32 + dv.getUint32(12); hdr = 16; }
      else if (len === 0) len = size - o;
      if (len < hdr) return null;
      if (type === "moov"){
        if (len > MAX_MOOV) return null;
        return fpsFromMoov(await readAt(blob, o + hdr, o + len));
      }
      if (o === 0 && type !== "ftyp" && type !== "wide" && type !== "free" && type !== "mdat" && type !== "skip") return null;  // not ISO-BMFF
      o += len;
    }
  } catch (e){
    console.warn("fps", e);
  }
  return null;
}
