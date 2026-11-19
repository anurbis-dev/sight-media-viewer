// Debug log (Settings → Debug log): what the video pipeline does on this device — the scrub caches (turns,
// hidden players, parts fetched, frames got), the visible player (taps, play / seek latency, stalls), long
// main-thread tasks, errors, and a sample of the state every second. Kept in memory as JSON lines (bounded
// by MAX_CH characters and MAX events); the newest SAVE_CH characters — this session's and the earlier saved
// sessions' (up to KEEP_S) — also go to localStorage every 15 s, soon after an error (≤ one save per 2 s) and
// when the app is hidden, so a reload or a crash keeps them ("earlier session" blocks in the file). Off stops
// recording but keeps what was recorded (Send still works); only Clear deletes it.
// The file: a header, then one JSON array per line: [ms since the log started, event, data].
const KEY = "sight-review:debug", SAVE = "sight-review:debugLog";
const MAX = 15000, MAX_CH = 6e6, SAVE_CH = 1e6, KEEP_S = 4;
let on = false;
try { on = localStorage.getItem(KEY) === "1"; } catch {}
let buf = [], chars = 0, p0 = performance.now(), started = new Date(), info = {}, prev = [];  // prev: [{started, ev}]
let sampler = null, sampleT = 0, hooked = false, dirty = false, lastSave = 0, saveT = 0;

function env(){
  const n = navigator, s = screen || {};
  return {
    app: info, started: started.toISOString(), ua: n.userAgent, platform: n.platform || "", lang: n.language || "",
    screen: [s.width, s.height], viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, cores: n.hardwareConcurrency || null,
    memory: n.deviceMemory || null, standalone: !!(window.matchMedia && matchMedia("(display-mode: standalone)").matches),
    rvfc: "requestVideoFrameCallback" in HTMLVideoElement.prototype,
  };
}
// The earlier sessions and this one, newest lines first, as many as fit `budget` characters. The old value
// goes first: a failed write must not leave stale data; on a full storage, half the budget is tried.
function save(){
  clearTimeout(saveT); saveT = 0;
  if (!dirty) return;
  dirty = false; lastSave = performance.now();
  const all = prev.concat(buf.length ? [{ started: started.toISOString(), ev: buf }] : []).slice(-KEEP_S);
  try { localStorage.removeItem(SAVE); } catch {}
  if (!all.length) return;
  for (let budget = SAVE_CH; budget >= 1000; budget = Math.floor(budget / 2)){
    const out = [];
    let c = 0;
    for (let i = all.length - 1; i >= 0 && c < budget; i--){
      const ev = all[i].ev;
      let n = 0;
      while (n < ev.length && c + ev[ev.length - 1 - n].length + 1 <= budget){ c += ev[ev.length - 1 - n].length + 1; n++; }
      if (n) out.unshift({ started: all[i].started, ev: ev.slice(-n) });
      if (n < ev.length) break;
    }
    try { localStorage.setItem(SAVE, JSON.stringify({ sessions: out })); return; } catch {}
  }
}
// Soon, not at once: a burst of errors must not write the whole tail each time (≤ one save per 2 s).
function saveSoon(){
  const wait = 2000 - (performance.now() - lastSave);
  if (wait <= 0) save();
  else if (!saveT) saveT = setTimeout(save, wait);
}
function loadPrev(){
  try {
    const s = JSON.parse(localStorage.getItem(SAVE) || "null");
    const ok = (x) => x && typeof x.started === "string" && Array.isArray(x.ev) && x.ev.length && x.ev.every((e) => typeof e === "string");
    prev = s && Array.isArray(s.sessions) ? s.sessions.filter(ok) : ok(s) ? [s] : [];
  } catch { prev = []; }
}
function hook(){
  if (hooked) return;
  hooked = true;
  addEventListener("error", (e) => { dbg.log("error", { msg: e.message, at: (e.filename || "").split("/").pop() + ":" + e.lineno }); dbg.flush(); });
  addEventListener("unhandledrejection", (e) => { dbg.log("rejection", { msg: String(e.reason && (e.reason.message || e.reason)) }); dbg.flush(); });
  // Hidden / closing: at once (the page may not come back).
  document.addEventListener("visibilitychange", () => { dbg.log("visibility", document.visibilityState); if (document.visibilityState === "hidden") save(); });
  addEventListener("pagehide", save);
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((x) => dbg.log("longtask", { ms: Math.round(x.duration) }))).observe({ type: "longtask", buffered: false });
  } catch {}  // not in Safari
}
function tick(){
  clearTimeout(sampleT);
  if (!on) return;
  if (sampler){ try { const s = sampler(); if (s) dbg.log("sample", s); } catch (e){ dbg.log("sampleError", String(e && e.message || e)); } }
  if (performance.now() - lastSave > 15000) save();
  sampleT = setTimeout(tick, 1000);
}
function start(){
  hook();
  dbg.log("start", env());
  tick();
}
loadPrev();  // a saved tail is sendable even with the log off now

export const dbg = {
  get on(){ return on; },
  // The app's own facts for the header (version, settings).
  info(o){ Object.assign(info, o); },
  // fn() → an object logged every second as "sample" (or nothing).
  sample(fn){ sampler = fn; },
  // On: recording goes on after what is kept (a new "start" line). Off: stops; what was recorded stays.
  set(v){
    v = !!v;
    if (v === on) return;
    on = v;
    try { localStorage.setItem(KEY, on ? "1" : "0"); } catch {}
    if (on) start();
    else { clearTimeout(sampleT); dirty = true; save(); }
  },
  log(ev, data){
    if (!on) return;
    let line;
    try { line = JSON.stringify([Math.round(performance.now() - p0), ev, data === undefined ? null : data]); }
    catch { line = JSON.stringify([Math.round(performance.now() - p0), ev, "unserialisable"]); }
    buf.push(line); chars += line.length + 1; dirty = true;
    if (buf.length > MAX || chars > MAX_CH){
      let k = Math.max(buf.length - Math.floor(MAX * 0.9), 0), c = 0;
      for (let i = 0; i < k; i++) c += buf[i].length + 1;
      while (chars - c > MAX_CH * 0.9 && k < buf.length - 1){ c += buf[k].length + 1; k++; }
      buf.splice(0, k); chars -= c;
    }
  },
  // Save soon (after an error: the page may die next).
  flush(){ if (dirty) saveSoon(); },
  count(){ return buf.length + prev.reduce((n, x) => n + x.ev.length, 0); },
  clear(){
    buf = []; chars = 0; prev = []; dirty = false; p0 = performance.now(); started = new Date();
    clearTimeout(saveT); saveT = 0;
    try { localStorage.removeItem(SAVE); } catch {}
    if (on) dbg.log("start", env());
  },
  text(){
    const out = ["# Sight review debug log", "# " + JSON.stringify(env())];
    prev.forEach((x) => { out.push("# earlier session (its newest part, saved before the app closed), started " + x.started); x.ev.forEach((e) => out.push(e)); });
    out.push("# this session, started " + started.toISOString() + (on ? "" : " (recording off)"));
    buf.forEach((e) => out.push(e));
    return out.join("\n") + "\n";
  },
  fileName(){ const d = new Date(), p = (n) => String(n).padStart(2, "0"); return `sight-debug-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.txt`; },
};
if (on) start();
