// The shared timeline painter. A span covering 100 of size 1000 is 10% wide.
// A snapshot with only start/end (no spans array) paints nothing.
import { cacheBarHtml } from "../app/static/video-cache-bar.js";

const partial = cacheBarHtml({ size: 1000, spans: [[0, 100]] });
const hole = cacheBarHtml({ size: 1000, spans: [[0, 100], [500, 600]] });
const full = cacheBarHtml({ size: 1000, spans: [[0, 1000]] });
const nostart = cacheBarHtml({ size: 1000, start: 0, end: 1000 });
const empty = cacheBarHtml({ size: 1000, spans: [] });

const ok = partial === '<i style="left:0.000%;width:10.000%"></i>'
  && hole === '<i style="left:0.000%;width:10.000%"></i><i style="left:50.000%;width:10.000%"></i>'
  && full === '<i style="left:0.000%;width:100.000%"></i>'
  && nostart === ""
  && empty === "";

console.log(JSON.stringify({ ok, partial, hole, full, nostart, empty }));
if (!ok) process.exit(1);
