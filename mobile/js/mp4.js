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

// The moov box's payload of an ISO-BMFF file (MP4 / MOV), or null (not one, no moov, too big).
async function moovOf(blob){
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
    if (type === "moov") return len > MAX_MOOV ? null : readAt(blob, o + hdr, o + len);
    if (o === 0 && type !== "ftyp" && type !== "wide" && type !== "free" && type !== "mdat" && type !== "skip") return null;  // not ISO-BMFF
    o += len;
  }
  return null;
}

const hex2 = (n) => n.toString(16).padStart(2, "0");
// ISO/IEC 23091-2 colour codes (colr nclx) as a WebCodecs VideoColorSpaceInit, or null when one is not known.
function nclxSpace(p, t, m, full){
  const P = { 1: "bt709", 5: "bt470bg", 6: "smpte170m", 9: "bt2020", 12: "smpte432" }[p];
  const T = { 1: "bt709", 6: "smpte170m", 8: "linear", 13: "iec61966-2-1", 16: "pq", 18: "hlg" }[t];
  const M = { 0: "rgb", 1: "bt709", 5: "bt470bg", 6: "smpte170m", 9: "bt2020-ncl" }[m];
  return P && T && M ? { primaries: P, transfer: T, matrix: M, fullRange: full } : null;
}
// Whether an H.264 stream says its colours (avcC's first SPS: VUI colour_description with a matrix that is not
// "unspecified"); null when it cannot be read.
export function avcTagged(avcc){
  try {
    if (avcc.length < 8 || (avcc[5] & 31) < 1) return null;
    const len = (avcc[6] << 8) | avcc[7], raw = avcc.subarray(9, 8 + len);  // (past the NAL header byte)
    const b = [];
    for (let i = 0; i < raw.length; i++){
      if (i >= 2 && raw[i] === 3 && raw[i - 1] === 0 && raw[i - 2] === 0 && b.length >= 2 && b[b.length - 1] === 0 && b[b.length - 2] === 0) continue;  // emulation prevention
      b.push(raw[i]);
    }
    let pos = 0;
    const u = (n) => { let v = 0; for (let k = 0; k < n; k++){ if (pos >= b.length * 8) throw new Error("sps"); v = v * 2 + ((b[pos >> 3] >> (7 - (pos & 7))) & 1); pos++; } return v; };
    const ue = () => { let z = 0; while (!u(1)){ if (++z > 31) throw new Error("sps"); } return (2 ** z) - 1 + u(z); };
    const se = () => { const k = ue(); return k & 1 ? (k + 1) / 2 : -k / 2; };
    const prof = u(8); u(16); ue();
    if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(prof)){
      const cf = ue();
      if (cf === 3) u(1);
      ue(); ue(); u(1);
      if (u(1)){
        for (let i = 0; i < (cf === 3 ? 12 : 8); i++){
          if (!u(1)) continue;
          let last = 8, next = 8;
          for (let j = 0; j < (i < 6 ? 16 : 64); j++){ if (next) next = (last + se() + 256) % 256; last = next || last; }
        }
      }
    }
    ue();
    const poc = ue();
    if (poc === 0) ue();
    else if (poc === 1){ u(1); se(); se(); for (let i = ue(); i > 0; i--) se(); }
    ue(); u(1); ue(); ue();
    if (!u(1)) u(1);
    u(1);
    if (u(1)){ ue(); ue(); ue(); ue(); }
    if (!u(1)) return false;            // no VUI
    if (u(1) && u(8) === 255) u(32);    // aspect ratio
    if (u(1)) u(1);                     // overscan
    if (!u(1)) return false;            // no video signal type
    u(4);
    if (!u(1)) return false;            // no colour description
    u(16);
    return u(8) !== 2;                  // matrix 2: unspecified
  } catch { return null; }
}
// WebCodecs codec string + decoder description of a visual sample entry (stsd's first), or null.
function codecOf(dv, entry){
  const type = entry.type;
  const kids = boxes(dv, entry.start + 78, entry.end);  // after the VisualSampleEntry fields
  const box = (t) => kids.find((x) => x.type === t) || null;
  const bytes = (b) => new Uint8Array(dv.buffer, dv.byteOffset + b.start, b.end - b.start).slice();
  if (type === "avc1" || type === "avc3"){
    const c = box("avcC");
    if (!c || c.end - c.start < 4) return null;
    const d = bytes(c), colr = box("colr"), vui = avcTagged(d);
    // The container's colours (colr nclx), which the decoder never sees: passed on when the stream says none
    // (the player uses them). untagged: neither says.
    const nclx = !!colr && colr.end - colr.start >= 11 && typeAt(dv, colr.start) === "nclx";
    const cs = nclx && vui === false ? nclxSpace(dv.getUint16(colr.start + 4), dv.getUint16(colr.start + 6), dv.getUint16(colr.start + 8), !!(dv.getUint8(colr.start + 10) & 0x80)) : null;
    return { codec: type + "." + hex2(d[1]) + hex2(d[2]) + hex2(d[3]), description: d, untagged: !nclx && vui === false, colorSpace: cs };
  }
  if (type === "hvc1" || type === "hev1"){
    const c = box("hvcC");
    if (!c || c.end - c.start < 23) return null;
    const b1 = dv.getUint8(c.start + 1), space = b1 >> 6, tier = (b1 >> 5) & 1, prof = b1 & 31;
    let compat = dv.getUint32(c.start + 2), rev = 0;
    for (let i = 0; i < 32; i++){ rev = (rev << 1) | (compat & 1); compat >>>= 1; }
    const cons = [];
    for (let i = 0; i < 6; i++) cons.push(dv.getUint8(c.start + 6 + i));
    while (cons.length && !cons[cons.length - 1]) cons.pop();
    const s = type + "." + (space ? "ABC"[space - 1] : "") + prof + "." + (rev >>> 0).toString(16).toUpperCase() + "." + (tier ? "H" : "L") + dv.getUint8(c.start + 12)
      + cons.map((x) => "." + x.toString(16).toUpperCase()).join("");
    return { codec: s, description: bytes(c) };
  }
  if (type === "av01"){
    const c = box("av1C");
    if (!c || c.end - c.start < 4) return null;
    const b1 = dv.getUint8(c.start + 1), b2 = dv.getUint8(c.start + 2);
    const depth = b2 & 0x40 ? (b2 & 0x20 ? 12 : 10) : 8;  // high_bitdepth, twelve_bit
    return { codec: "av01." + (b1 >> 5) + "." + String(b1 & 31).padStart(2, "0") + (b2 & 0x80 ? "H" : "M") + "." + String(depth).padStart(2, "0"), description: bytes(c) };
  }
  if (type === "vp09"){
    const c = box("vpcC");
    if (!c || c.end - c.start < 7) return null;
    const p = c.start + 4;  // (a full box)
    return { codec: "vp09." + String(dv.getUint8(p)).padStart(2, "0") + "." + String(dv.getUint8(p + 1)).padStart(2, "0") + "." + String(dv.getUint8(p + 2) >> 4).padStart(2, "0") };
  }
  return null;
}

// moov payload bytes -> the first video track's samples for decoding it with WebCodecs, or null (no video
// track, a fragmented file, a codec not described here). Samples in decode order: off / size (bytes in the file),
// pts (seconds, as the player's currentTime: the edit list's start taken off), key (a sync sample). gops: [i0, i1)
// decode-order ranges starting at a sync sample, with their presentation span [lo, hi). rot: the display turn
// (tkhd matrix: 0 / 90 / 180 / 270, clockwise).
// emptyEdits: count the edit list's leading empty edits as a delay (WebKit's AVFoundation does; Chrome does not).
export function trackFromMoov(u8, emptyEdits){
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const top = boxes(dv, 0, u8.byteLength);
  if (top.some((b) => b.type === "mvex")) return null;  // fragmented: the samples are in moof boxes
  for (const trak of top.filter((b) => b.type === "trak")){
    const mdia = child(dv, trak, "mdia"), hdlr = mdia && child(dv, mdia, "hdlr");
    if (!hdlr || hdlr.end - hdlr.start < 12 || typeAt(dv, hdlr.start + 8) !== "vide") continue;
    const mdhd = child(dv, mdia, "mdhd"), stbl = child(dv, child(dv, mdia, "minf") || { start: 0, end: 0 }, "stbl");
    if (!mdhd || !stbl) continue;
    const ts = dv.getUint32(mdhd.start + (dv.getUint8(mdhd.start) === 1 ? 20 : 12));
    const get = (t) => child(dv, stbl, t);
    const stsd = get("stsd"), stts = get("stts"), stsz = get("stsz"), stsc = get("stsc"), stco = get("stco") || get("co64");
    if (!ts || !stsd || !stts || !stsz || !stsc || !stco) continue;
    const entry = boxes(dv, stsd.start + 8, stsd.end)[0];
    const cod = entry && codecOf(dv, entry);
    if (!cod) return null;
    const n = dv.getUint32(stsz.start + 8), fixed = dv.getUint32(stsz.start + 4);
    let sttsN = 0;
    for (let e = 0, ne = dv.getUint32(stts.start + 4); e < ne && stts.start + 16 + e * 8 <= stts.end; e++) sttsN += dv.getUint32(stts.start + 8 + e * 8);
    // (A malformed count must not make the phone allocate hundreds of MB.)
    if (!n || n > 4e6 || n > sttsN + 1 || (!fixed && stsz.start + 12 + n * 4 > stsz.end)) return null;
    const size = new Uint32Array(n), off = new Float64Array(n), dts = new Float64Array(n), pts = new Float64Array(n), key = new Uint8Array(n);
    for (let i = 0; i < n; i++) size[i] = fixed || dv.getUint32(stsz.start + 12 + i * 4);
    // Decode times (stts).
    let i = 0, t = 0;
    for (let e = 0, ne = dv.getUint32(stts.start + 4); e < ne && i < n; e++){
      const o = stts.start + 8 + e * 8;
      if (o + 8 > stts.end) break;
      const c = dv.getUint32(o), d = dv.getUint32(o + 4);
      for (let k = 0; k < c && i < n; k++, i++){ dts[i] = t; t += d; }
    }
    const lastDur = i > 1 ? dts[i - 1] - dts[i - 2] : t;
    for (; i < n; i++){ dts[i] = t; t += lastDur; }
    // Composition offsets (ctts: unsigned in version 0, signed in 1 — read both as signed, as players do).
    const ctts = get("ctts");
    pts.set(dts);
    if (ctts){
      i = 0;
      for (let e = 0, ne = dv.getUint32(ctts.start + 4); e < ne && i < n; e++){
        const o = ctts.start + 8 + e * 8;
        if (o + 8 > ctts.end) break;
        const c = dv.getUint32(o), d = dv.getInt32(o + 4);
        for (let k = 0; k < c && i < n; k++, i++) pts[i] += d;
      }
    }
    // Sync samples (stss; none: every sample is one).
    const stss = get("stss");
    if (stss){
      for (let e = 0, ne = dv.getUint32(stss.start + 4); e < ne; e++){
        const o = stss.start + 8 + e * 4;
        if (o + 4 > stss.end) break;
        const k = dv.getUint32(o) - 1;
        if (k >= 0 && k < n) key[k] = 1;
      }
    } else key.fill(1);
    // Offsets: chunks (stco / co64) of samples-per-chunk runs (stsc).
    const co64 = stco.type === "co64", nc = dv.getUint32(stco.start + 4);
    const chunkOff = (c) => co64 ? dv.getUint32(stco.start + 8 + c * 8) * 2 ** 32 + dv.getUint32(stco.start + 12 + c * 8) : dv.getUint32(stco.start + 8 + c * 4);
    if (stco.start + 8 + nc * (co64 ? 8 : 4) > stco.end) return null;
    const runs = [];
    for (let e = 0, ne = dv.getUint32(stsc.start + 4); e < ne; e++){
      const o = stsc.start + 8 + e * 12;
      if (o + 12 > stsc.end) break;
      runs.push([dv.getUint32(o) - 1, dv.getUint32(o + 4)]);
    }
    i = 0;
    for (let r = 0; r < runs.length && i < n; r++){
      const c1 = r + 1 < runs.length ? runs[r + 1][0] : nc;
      for (let c = runs[r][0]; c < c1 && i < n; c++){
        let o = chunkOff(c);
        for (let k = 0; k < runs[r][1] && i < n; k++, i++){ off[i] = o; o += size[i]; }
      }
    }
    if (i < n) return null;
    // The edit list's start (the first edit that is not empty): the player's time 0. Empty edits are not counted
    // (Chrome does not).
    let start = 0, dwell = 0;
    const edts = child(dv, trak, "edts"), elst = edts && child(dv, edts, "elst");
    const mvhd = top.find((b) => b.type === "mvhd"), mts = mvhd ? dv.getUint32(mvhd.start + (dv.getUint8(mvhd.start) === 1 ? 20 : 12)) : 0;
    if (elst){
      const v1 = dv.getUint8(elst.start) === 1, ne = dv.getUint32(elst.start + 4), sz = v1 ? 20 : 12;
      for (let e = 0; e < ne; e++){
        const o = elst.start + 8 + e * sz;
        if (o + sz > elst.end) break;
        const mt = v1 ? dv.getInt32(o + 8) * 2 ** 32 + dv.getUint32(o + 12) : dv.getInt32(o + 4);
        if (mt >= 0){ start = mt; break; }
        if (mts) dwell += (v1 ? dv.getUint32(o) * 2 ** 32 + dv.getUint32(o + 4) : dv.getUint32(o)) / mts;  // an empty edit (segment duration, movie timescale)
      }
    }
    if (!emptyEdits) dwell = 0;
    for (let k = 0; k < n; k++) pts[k] = (pts[k] - start) / ts + dwell;
    // The display turn from the track header's matrix.
    const tkhd = child(dv, trak, "tkhd");
    let rot = 0;
    if (tkhd){
      const m = tkhd.start + (dv.getUint8(tkhd.start) === 1 ? 52 : 40);
      if (m + 20 <= tkhd.end){
        const a = dv.getInt32(m), b = dv.getInt32(m + 4), c = dv.getInt32(m + 12), d = dv.getInt32(m + 16);
        if (a * d - b * c < 0) return null;  // mirrored: not handled here (the hidden player shows it as the player does)
        rot = ((Math.round(Math.atan2(b, a) * 180 / Math.PI / 90) * 90) % 360 + 360) % 360;
      }
    }
    // Groups of pictures: a sync sample up to the next; each one's presentation span.
    const gops = [], fd = n > 1 ? (t / n) / ts : 1 / 30;
    for (let k = 0; k < n; ){
      let j = k + 1;
      while (j < n && !key[j]) j++;
      let lo = Infinity, hi = -Infinity;
      for (let q = k; q < j; q++){ if (pts[q] < lo) lo = pts[q]; if (pts[q] > hi) hi = pts[q]; }
      gops.push({ i0: k, i1: j, lo, hi: hi + fd });
      k = j;
    }
    if (!key[0]) return null;  // no sync sample to start from
    let end = 0;
    for (let k = 0; k < n; k++) if (pts[k] > end) end = pts[k];
    // The coded picture size (the sample entry's), before the turn.
    const w = dv.getUint16(entry.start + 24), h = dv.getUint16(entry.start + 26);
    // Sorted presentation times (shown frames only): where frames really are, for telling a hole from a long frame.
    const sorted = Float64Array.from(pts).filter((x) => x > -1e-4).sort();
    return { codec: cod.codec, description: cod.description, untagged: !!cod.untagged, colorSpace: cod.colorSpace, w, h, sorted, rot, n, off, size, pts, key, gops, fd, duration: end + fd };
  }
  return null;
}

// The first video track of an MP4 / MOV for WebCodecs (trackFromMoov), or null.
export async function videoTrack(blob, emptyEdits){
  try {
    const m = await moovOf(blob);
    return m ? trackFromMoov(m, emptyEdits) : null;
  } catch (e){
    console.warn("track", e);
    return null;
  }
}

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
