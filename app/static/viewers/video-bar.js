// The video viewer's bar (part of the video module, viewers/video.js; R0b-2): sound, loop, the position field
// (fps from the store), the playhead and the RAM strip, the track's scrub. Moved out of index.html unchanged;
// the frame's DOM (light.bar: .vtrack, .vplay, .vcaches, [data-mem], [data-snd], .vpop, [data-loop], [data-cur],
// [data-dur]) is still the frame's, built by the lightbox.
//
// ---- Video bar: sound, loop, position field ---------------------------------------------------------
// Sound: click = mute / unmute, press and drag up / down = volume (a slider pops up above the icon),
// right-click / long press = "scrub audio" (the sound is heard while scrubbing). Loop: replay this clip at its end
// (inside a sequence the sequence bar's loop rules, so the button hides). The position field: click = type a
// frame to jump to, right-click / long press = display (frame / time / both, local or sequence time). All of it
// is the player's, not the clip's, and kept in localStorage.
//
// host (the frame; Sight's lightbox in index.html):
//   ctl()          the frame's state object (Sight: `light`, null once closed): bar, el, video, asset, vctl, seq,
//                  scrubbing, scrubT, snap, posEdit
//   store          the store (store.fps; the scrub audio's store.video.scrubAudio)
//   annot          the annotator (fpsKnown, fps: the frame rate it knows)
//   curAsset()     the asset on screen (a sequence's clip)
//   flash(s), fmtTime(t), placeMenu(m, x, y), uiK()   the frame's helpers
//   seqDurs(), seqLocate(T), seqGo(k, t, play), paintSeqBar(full)   the sequence player
//   scrubSnapped(e), scrubSnap(t, tol), snapPx()                    Ctrl-scrub snap to an annotated frame
import { paintCacheBars } from "./video-cache.js";
import { createScrubAudio } from "./scrub-audio.js";

export function createVideoBar(host){
  const lt = () => host.ctl();
  // (sound while scrubbing: it reads the sound settings below live)
  const { scrubPrepare, scrubHear, scrubSilence, scrubAudioStop, saApplyVol } = createScrubAudio({
    ctl: host.ctl, store: host.store, flash: (s) => host.flash(s), sound: () => vsnd, muted: () => vIsMuted(),
  });
  const VICO = {
    snd: '<path d="M4 9.5h3l5-4v13l-5-4H4z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6"/><path d="M18.4 6.6a7.6 7.6 0 0 1 0 10.8"/>',
    sndoff: '<path d="M4 9.5h3l5-4v13l-5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
    loop: '<path d="M17 3l3 3-3 3"/><path d="M4 11.5V10a4 4 0 0 1 4-4h12"/><path d="M7 21l-3-3 3-3"/><path d="M20 12.5V14a4 4 0 0 1-4 4H4"/>',
    once: '<path d="M3.5 12h12"/><path d="m11.5 7.5 4.5 4.5-4.5 4.5"/><path d="M20 6v12"/>',
  };
  const vico = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${VICO[n]}</svg>`;
  const vstore = (key, def) => { try { return { ...def, ...(JSON.parse(localStorage.getItem(key) || "null") || {}) }; } catch { return { ...def }; } };
  const vsave = (key, o) => { try { localStorage.setItem(key, JSON.stringify(o)); } catch {} };
  const vsnd = vstore("sight.vsnd", { vol: 1, muted: false, scrub: false });   // scrub: audio while scrubbing
  const vpos = vstore("sight.vpos", { disp: "time", base: "local" });          // disp: time | frame | both
  const vloop = vstore("sight.vloop", { on: false });
  vsnd.vol = typeof vsnd.vol === "number" && vsnd.vol >= 0 && vsnd.vol <= 1 ? vsnd.vol : 1;
  vsnd.muted = vsnd.muted === true; vsnd.scrub = vsnd.scrub === true; vloop.on = vloop.on === true;
  if (!["time", "frame", "both"].includes(vpos.disp)) vpos.disp = "time";
  if (!["local", "global"].includes(vpos.base)) vpos.base = "local";
  const vIsMuted = () => vsnd.muted || vsnd.vol < 0.02;
  function paintVBar(){
    if (!lt()?.bar) return;
    const el = lt().video;
    const dur = el && Number.isFinite(el.duration) ? el.duration : 0;
    const cur = lt().scrubT != null ? lt().scrubT : (el ? el.currentTime : 0);
    vposPaint(cur, dur);
    const play = lt().bar.querySelector(".vplay");
    play.style.left = (dur > 0 ? (cur / dur) * 100 : 0) + "%";
    paintCacheBars(lt().bar.querySelector(".vcaches"), lt().snap);
    const snap = lt().snap;
    lt().bar.querySelector("[data-mem]").textContent = snap ? `RAM ${Math.round(snap.bytes / 1048576)} / ${snap.mb} MB` : "";
    if (lt().seq) host.paintSeqBar(false);
  }
  // Volume / mute onto a video the lightbox shows (a sequence's adopted clip takes the old clip's state).
  function vApplySnd(v){
    if (!v) return;
    try { v.volume = vsnd.vol; } catch {}
    v.muted = vIsMuted();
    if (v._seqWantMuted !== undefined) v._seqWantMuted = v.muted;
    saApplyVol();
    if (!vIsMuted() && vsnd.scrub && lt()?.scrubbing && lt().asset)
      scrubHear(lt().asset.id, lt().scrubT ?? v.currentTime ?? 0);
  }
  function vApplyLoop(v){ if (v) v.loop = !!vloop.on && !lt()?.seq; }
  let vpopT = 0;
  function vSndPaint(show){
    const bar = lt()?.bar;
    if (!bar) return;
    const b = bar.querySelector("[data-snd]"), pop = bar.querySelector(".vpop");
    const off = vIsMuted(), pct = Math.round((off ? 0 : vsnd.vol) * 100);
    const st = `${off}|${vsnd.scrub}|${pct}`;
    if (b.dataset.st !== st){
      b.dataset.st = st;
      b.innerHTML = vico(off ? "sndoff" : "snd");
      b.classList.toggle("scrub", vsnd.scrub);
      b.title = `Sound ${off ? "off" : pct + " %"} — click: ${off ? "unmute" : "mute"} · drag up / down: volume · right-click / long press: sound while scrubbing (now ${vsnd.scrub ? "on" : "off"})`;
      b.setAttribute("aria-label", b.title);
    }
    pop.querySelector("i").style.height = pct + "%";
    pop.querySelector("b").textContent = String(pct);
    if (show){
      pop.hidden = false;
      clearTimeout(vpopT);
      vpopT = setTimeout(() => { pop.hidden = true; }, 900);
    }
  }
  function vSetVol(x){
    x = Math.min(1, Math.max(0, x));
    vsnd.vol = Math.round(x * 100) / 100;
    vsnd.muted = vsnd.vol < 0.02;
    vsave("sight.vsnd", vsnd); vApplySnd(lt()?.video); vSndPaint(true);
  }
  function vToggleMute(){
    if (vIsMuted()){ vsnd.muted = false; if (vsnd.vol < 0.02) vsnd.vol = 1; } else vsnd.muted = true;
    vsave("sight.vsnd", vsnd); vApplySnd(lt()?.video); vSndPaint(true);
  }
  function vToggleScrubSnd(){
    vsnd.scrub = !vsnd.scrub;
    vsave("sight.vsnd", vsnd); vSndPaint(false);
    host.flash(vsnd.scrub ? "Sound while scrubbing: on" : "Sound while scrubbing: off");
    if (vsnd.scrub && lt()?.asset?.kind === "video") scrubPrepare(lt().asset.id, lt().scrubT ?? lt().video?.currentTime ?? 0);
    else scrubAudioStop();
  }
  function vLoopPaint(){
    const b = lt()?.bar?.querySelector("[data-loop]");
    if (!b) return;
    b.hidden = !!lt().seq;   // a sequence has its own loop (the bar above)
    vApplyLoop(lt().video);
    const k = vloop.on ? "loop" : "once";
    if (b.dataset.ico !== k){
      b.dataset.ico = k; b.innerHTML = vico(k); b.classList.toggle("on", vloop.on);
      b.title = vloop.on ? "Loop: replays from the start (click: play once and stop)" : "Play once and stop (click: loop)";
      b.setAttribute("aria-label", b.title);
    }
  }
  function vToggleLoop(){
    vloop.on = !vloop.on; vsave("sight.vloop", vloop);
    vLoopPaint();
    host.flash(vloop.on ? "Loop: replays from the start" : "Once: stops at the end");
  }
  // A press-and-drag / tap / right-click control on a small element. o: begin(), move(dy), tap(), ctx(x, y)
  // (a mouse's right click, or a touch's long press), wheel(dir). It keeps the pointer to itself (the stage under it does not see it).
  function vgesture(b, o){
    let st = null, mouse = false;
    b.style.touchAction = "none";
    b.addEventListener("contextmenu", (e) => { e.preventDefault(); if (mouse && o.ctx) o.ctx(e.clientX, e.clientY); });
    b.addEventListener("pointerdown", (e) => {
      mouse = e.pointerType === "mouse";
      if (e.button !== 0 || st) return;
      e.preventDefault(); e.stopPropagation();
      st = { id: e.pointerId, x: e.clientX, y: e.clientY, drag: false, held: false, far: false };
      try { b.setPointerCapture(e.pointerId); } catch {}
      if (!mouse && o.ctx) st.ht = setTimeout(() => { if (st && !st.drag && !st.far){ st.held = true; o.ctx(st.x, st.y); } }, 500);
      if (o.begin) o.begin();
    });
    b.addEventListener("pointermove", (e) => {
      if (!st || e.pointerId !== st.id) return;
      const dy = e.clientY - st.y;
      if (Math.hypot(e.clientX - st.x, dy) > 8){ st.far = true; clearTimeout(st.ht); }
      if (o.move && !st.drag && Math.abs(dy) > 6 && !st.held){ st.drag = true; clearTimeout(st.ht); }
      if (st.drag) o.move(dy);
    });
    const end = (e) => {
      if (!st || e.pointerId !== st.id) return;
      clearTimeout(st.ht);
      const s0 = st; st = null;
      if (e.type === "pointerup" && !s0.drag && !s0.held && !s0.far && o.tap) o.tap(e);
    };
    b.addEventListener("pointerup", end); b.addEventListener("pointercancel", end); b.addEventListener("lostpointercapture", end);
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); });
    if (o.wheel) b.addEventListener("wheel", (e) => { e.preventDefault(); o.wheel(e.deltaY < 0 ? 1 : -1); }, { passive: false });
  }
  // Position field. A clip's frame rate: the annotator's once it knows it, else the store's (the file's info, loaded
  // lazily and cached per file — the other clips of a sequence too); until it is known 25 is used and shown as ≈.
  const vFpsMap = new Map();   // asset id -> fps (0: not known / failed)
  function vFpsLoad(a){
    if (!a || vFpsMap.has(a.id)) return;
    vFpsMap.set(a.id, 0);
    host.store.fps(a).then((f) => { if (f > 0) vFpsMap.set(a.id, f); }).catch(() => {}).then(() => { if (lt()) paintVBar(); });
  }
  function vClipFps(a, cur){
    if (cur && host.annot.fpsKnown() && host.annot.fps?.() > 0) return { fps: host.annot.fps(), known: true };
    const f = a ? vFpsMap.get(a.id) : 0;
    if (f === undefined) vFpsLoad(a);
    return f > 0 ? { fps: f, known: true } : { fps: 25, known: false };
  }
  const vSeqOn = () => !!lt()?.seq && lt().seq.list.length > 1;
  const vGlobal = () => vpos.base === "global" && vSeqOn();
  const vCurAsset = () => host.curAsset();
  // The sequence's clips: { d: seconds, fps, known } (known: both its duration and its frame rate are).
  function vClips(){
    const s = lt().seq, durs = host.seqDurs();
    return durs.map((d, k) => { const f = vClipFps(s.list[k], k === s.i); return { d, fps: f.fps, known: f.known && s.durs[k] > 0 }; });
  }
  // Where the playhead is, in this clip or (global) in the whole sequence: seconds t of d, frame f of df.
  function vPos(cur, dur){
    if (!vGlobal()){
      const c = vClipFps(vCurAsset(), true);
      return { t: cur, d: dur, f: Math.floor(cur * c.fps + 1e-6), df: Math.round(dur * c.fps), known: c.known };
    }
    const cl = vClips(), i = lt().seq.i, cc = Math.min(cur, cl[i].d);
    let t = 0, f = 0, d = 0, df = 0, known = true;
    cl.forEach((c, k) => {
      const n = Math.round(c.d * c.fps);
      if (k < i){ t += c.d; f += n; }
      d += c.d; df += n; known = known && c.known;
    });
    return { t: t + cc, d, f: f + Math.floor(cc * cl[i].fps + 1e-6), df, known };
  }
  function vposText(t, f, known){
    const fs = `${known ? "" : "≈"}f ${f}`;
    return vpos.disp === "frame" ? fs : vpos.disp === "both" ? `${host.fmtTime(t)} · ${fs}` : host.fmtTime(t);
  }
  function vposPaint(cur, dur){
    const bar = lt().bar, p = vPos(cur, dur);
    const ce = bar.querySelector("[data-cur]");
    if (!lt().posEdit){
      const s = vposText(p.t, p.f, p.known);
      if (ce.textContent !== s) ce.textContent = s;
      ce.style.minWidth = vpos.disp === "time" ? "" : vpos.disp === "frame" ? "56px" : "104px";
    }
    const de = bar.querySelector("[data-dur]"), ds = vposText(p.d, p.df, p.known);
    if (de.textContent !== ds) de.textContent = ds;
    vLoopPaint();
  }
  // Jump to what was typed: "f120", or a bare number (a frame; seconds when the display is plain time), or "1:05" /
  // "1:05.5" / "12s" (a time). With the sequence's time base it is the sequence's frame / time.
  function vposJump(txt){
    const el = lt()?.video;
    if (!el || !(el.duration > 0)) return false;
    const s = txt.trim().replace(",", ".");
    let frame = null, sec = null, m;
    if ((m = /^f\s*(\d+)$/i.exec(s))) frame = Number(m[1]);
    else if ((m = /^(\d+(?:\.\d+)?)\s*s$/i.exec(s))) sec = Number(m[1]);
    else if (/^\d+(:\d{1,2}){1,2}(\.\d+)?$/.test(s)) sec = s.split(":").reduce((a, x) => a * 60 + Number(x), 0);
    else if (/^\d+(\.\d+)?$/.test(s)){ if (vpos.disp === "time") sec = Number(s); else frame = Math.round(Number(s)); }
    else return false;
    if (vGlobal()){
      let k, t;
      if (sec != null) ({ k, t } = host.seqLocate(sec));
      else {
        const cl = vClips();
        for (k = 0; k < cl.length - 1; k++){ const nf = Math.round(cl[k].d * cl[k].fps); if (frame < nf) break; frame -= nf; }
        t = Math.min((frame + 0.01) / cl[k].fps, Math.max(0, cl[k].d - 0.5 / cl[k].fps));
      }
      host.seqGo(k, t, !el.paused);
      return true;
    }
    const fps = vClipFps(vCurAsset(), true).fps;
    if (sec == null) sec = (frame + 0.01) / fps;
    lt().vctl.seek(Math.min(sec, Math.max(0, el.duration - 0.5 / fps)));
    return true;
  }
  function vposEdit(){
    const bar = lt()?.bar, el = lt()?.video;
    if (!bar || !el || lt().posEdit || !(el.duration > 0)) return;
    const ce = bar.querySelector("[data-cur]");
    const p = vPos(lt().scrubT != null ? lt().scrubT : el.currentTime, el.duration);
    const inp = document.createElement("input");
    inp.className = "vtime-in"; inp.type = "text"; inp.spellcheck = false; inp.autocomplete = "off";
    inp.setAttribute("aria-label", "Jump to frame");
    inp.value = vpos.disp === "time" ? host.fmtTime(p.t) : String(p.f);
    inp.title = "Enter: jump · Esc: cancel — a frame number, or a time such as 1:05 or 12s";
    let done = false;
    // A press anywhere else ends the edit (a press on the track / stage never moves the focus: it is prevented).
    const away = (e) => { if (e.target !== inp) close(); };
    const close = () => {
      if (done) return;
      done = true;
      document.removeEventListener("pointerdown", away, true);
      inp.remove(); ce.hidden = false;
      if (lt()?.posEdit === inp){ lt().posEdit = null; paintVBar(); }
    };
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation();   // Esc / arrows / Space are this field's, not the lightbox's
      if (e.key === "Enter"){ e.preventDefault(); if (vposJump(inp.value)) close(); else inp.style.borderColor = "#d9534f"; }
      else if (e.key === "Escape"){ e.preventDefault(); close(); }
    });
    inp.addEventListener("input", () => { inp.style.borderColor = ""; });
    inp.addEventListener("blur", close);
    ["pointerdown", "click", "dblclick"].forEach((n) => inp.addEventListener(n, (e) => e.stopPropagation()));
    lt().posEdit = inp;
    ce.hidden = true;
    ce.after(inp);
    document.addEventListener("pointerdown", away, true);
    inp.focus(); inp.select();
  }
  let vMenuOff = null;
  function vposMenu(x, y){
    vMenuClose();
    const m = document.createElement("div");
    m.className = "ctx vctx";
    const mk = (grp, val, label, cur, dis) => `<button type="button" data-g="${grp}" data-v="${val}"${cur ? ' class="on"' : ""}${dis ? " disabled" : ""}>${label}</button>`;
    const seqOk = vSeqOn();
    m.innerHTML = `<div class="sub">Show</div>` +
      mk("disp", "frame", "Frame", vpos.disp === "frame") + mk("disp", "time", "Time", vpos.disp === "time") + mk("disp", "both", "Frame + time", vpos.disp === "both") +
      `<div class="sep"></div><div class="sub">Counted from</div>` +
      mk("base", "local", "This clip (local)", vpos.base !== "global" || !seqOk) +
      mk("base", "global", seqOk ? "The whole sequence (global)" : "The whole sequence (needs a sequence of 2+ clips)", vpos.base === "global" && seqOk, !seqOk);
    m.onclick = (e) => {
      const b = e.target.closest("button[data-g]");
      if (!b || b.disabled) return;
      vpos[b.dataset.g] = b.dataset.v;
      vsave("sight.vpos", vpos);
      vMenuClose(); paintVBar();
    };
    m.style.visibility = "hidden";
    lt().el.append(m);
    host.placeMenu(m, x, y - m.offsetHeight * host.uiK() - 6);
    m.style.visibility = "";
    const away = (e) => { if (!m.contains(e.target)) vMenuClose(); };
    const esc = (e) => { if (e.key === "Escape"){ e.stopPropagation(); e.preventDefault(); vMenuClose(); } };
    setTimeout(() => { if (vMenuOff) document.addEventListener("pointerdown", away, true); }, 0);
    window.addEventListener("keydown", esc, true);
    vMenuOff = () => { m.remove(); document.removeEventListener("pointerdown", away, true); window.removeEventListener("keydown", esc, true); vMenuOff = null; };
  }
  function vMenuClose(){ if (vMenuOff) vMenuOff(); }
  function bindVBarUi(bar){
    const snd = bar.querySelector("[data-snd]"), loop = bar.querySelector("[data-loop]"), cur = bar.querySelector("[data-cur]");
    let v0 = 1;
    vgesture(snd, {
      begin: () => { v0 = vIsMuted() ? 0 : vsnd.vol; },
      move: (dy) => vSetVol(v0 - dy / 110),
      tap: () => vToggleMute(),
      ctx: () => vToggleScrubSnd(),
      wheel: (d) => vSetVol((vIsMuted() ? 0 : vsnd.vol) + d * 0.05),
    });
    loop.onclick = () => vToggleLoop();
    vgesture(cur, { tap: () => vposEdit(), ctx: (x, y) => vposMenu(x, y) });
    vSndPaint(false); vLoopPaint();
  }

  function bindVBar(el, seekVideo, beginScrub, endScrub){
    const bar = lt()?.bar;
    if (!bar) return;
    const track = bar.querySelector(".vtrack");
    const tAt = (e) => {
      const r = track.getBoundingClientRect();
      const dur = el.duration || 0, w = Math.max(r.width, 1);
      const t = Math.min(dur, Math.max(0, ((e.clientX - r.left) / w) * dur));
      return host.scrubSnapped(e) ? host.scrubSnap(t, host.snapPx() / w * dur) : t; // Ctrl: the nearest annotated frame
    };
    const onMove = (e) => seekVideo(tAt(e));
    const onUp = (e) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (e.type === "pointerup") seekVideo(tAt(e));
      endScrub();
    };
    track.onpointerdown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      beginScrub();
      seekVideo(tAt(e));
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    };
  }
  return {
    paintVBar, bindVBarUi, bindVBar, vApplySnd, vApplyLoop, vIsMuted, vClipFps, vMenuClose,
    scrubPrepare, scrubHear, scrubSilence, scrubAudioStop,
  };
}
