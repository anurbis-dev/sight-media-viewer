// Green runs on a timeline: blocks of this file actually in RAM, as a fraction of the file.
// The server sends `spans` (half-open byte runs). A snapshot with only start/end is not drawn —
// that pair is the one loaded run around the playhead and would hide holes. Bytes map like the
// playhead (size · t / duration). One painter for the lightbox bar, a sequence segment and a compare lane.

export function cacheBarHtml(snap){
  if (!snap || !(snap.size > 0) || !Array.isArray(snap.spans)) return "";
  let html = "";
  for (const pair of snap.spans){
    const a = Number(pair[0]), b = Number(pair[1]);
    if (!(b > a)) continue;
    const l = Math.max(0, Math.min(100, a / snap.size * 100));
    const w = Math.max(0, Math.min(100, b / snap.size * 100) - l);
    if (w <= 0) continue;
    html += `<i style="left:${l.toFixed(3)}%;width:${w.toFixed(3)}%"></i>`;
  }
  return html;
}
