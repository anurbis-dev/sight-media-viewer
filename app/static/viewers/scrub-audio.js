// Sound while scrubbing, for the video viewer (part of the video module, viewers/video.js; R0b-2). Moved out of
// index.html unchanged; the server calls go through the store (store.video.scrubAudio).
//
// Sound while scrubbing. A play() of the <video> at each drag position waits on that seek (the scrub copy
// has no audio), so the sound stuttered. The server keeps a mono 16-bit PCM of the clip (Library.start_scrub_audio);
// a drag plays a slice of it through Web Audio and leaves the player paused. One slice runs on while the
// playhead stays inside it, so a slow drag is continuous; a jump starts a new slice at the pointer.
//
// host:
//   ctl()      the frame's state object (Sight: `light`, null once closed): scrubbing, scrubT
//   store      the store (store.video.scrubAudio.status / start / range)
//   sound()    the player's sound settings { vol, muted, scrub } (scrub: sound while scrubbing), read live
//   muted()    the sound is off (muted, or the volume near 0)
//   flash(s)   a short message ("Caching sound for scrubbing…")
export function createScrubAudio(host){
  const lt = () => host.ctl();
  const store = host.store;
  const sa = {
    ctx: null, gain: null, voice: null, voiceG: null,
    aid: null, state: "", pcm: null, t0: 0, dur: 0, sr: 22050, rev: "", grain: 0,
    heardT: 0, gen: 0, busy: false, want: null, told: false,
  };
  function saEnsureCtx(){
    if (!sa.ctx){
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      sa.ctx = new C();
      sa.gain = sa.ctx.createGain();
      sa.gain.connect(sa.ctx.destination);
    }
    sa.gain.gain.value = host.muted() ? 0 : host.sound().vol;
    if (sa.ctx.state === "suspended") sa.ctx.resume();
    return sa.ctx;
  }
  function saApplyVol(){
    if (!sa.ctx || !sa.gain) return;
    sa.gain.gain.value = host.muted() ? 0 : host.sound().vol;
    if (host.muted()) scrubSilence();
  }
  function scrubSilence(){
    const src = sa.voice, g = sa.voiceG;
    sa.voice = null; sa.voiceG = null;
    if (!src) return;
    const ctx = sa.ctx;
    if (ctx && g){
      const now = ctx.currentTime;
      try {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(0, now + 0.012);
        src.stop(now + 0.014);
      } catch { try { src.stop(); } catch {} }
    } else { try { src.stop(); } catch {} }
  }
  function scrubAudioStop(){
    scrubSilence();
    sa.want = null;
  }
  function saTouch(aid){
    if (sa.aid === aid) return;
    scrubSilence();
    sa.gen++;
    sa.aid = aid;
    sa.state = "";
    sa.pcm = null;
    sa.t0 = 0;
    sa.dur = 0;
    sa.sr = 22050;
    sa.rev = "";
    sa.want = null;
    sa.told = false;
  }
  function saEnd(){ return sa.t0 + (sa.pcm && sa.sr ? sa.pcm.length / sa.sr : 0); }
  function saCovers(t){
    if (!sa.pcm || sa.state !== "ready" || !(sa.sr > 0)) return false;
    const end = saEnd();
    if (t < sa.t0 || t >= end - 0.02) return false;
    const fileEnd = sa.dur > 0.05 ? sa.dur : end;
    if (sa.t0 > 0.05 && t < sa.t0 + 3) return false;
    if (end < fileEnd - 0.2 && t > end - 4) return false;
    return true;
  }
  function saPlay(t){
    const ctx = saEnsureCtx();
    if (!ctx || !sa.pcm || !sa.sr) return;
    if (sa.dur && t >= sa.dur - 0.05){ scrubSilence(); return; }
    const now = ctx.currentTime;
    if (sa.voice && t >= sa.heardT - 0.03 && t < sa.heardT + sa.grain - 0.05) return;
    scrubSilence();
    const sr = sa.sr;
    let i0 = Math.floor((t - sa.t0) * sr);
    if (i0 < 0) i0 = 0;
    const n = Math.min(sa.pcm.length - i0, Math.floor(0.4 * sr));
    if (n < Math.floor(0.03 * sr)){ return; }
    const buf = ctx.createBuffer(1, n, sr);
    const ch = buf.getChannelData(0);
    const pcm = sa.pcm;
    const fade = Math.min(n >> 2, Math.floor(0.006 * sr));
    for (let i = 0; i < n; i++){
      let s = pcm[i0 + i] / 32768;
      if (i < fade) s *= i / fade;
      else if (i > n - fade) s *= (n - i) / fade;
      ch[i] = s;
    }
    const g = ctx.createGain();
    g.connect(sa.gain);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(g);
    src.start();
    sa.voice = src;
    sa.voiceG = g;
    sa.heardT = t;
    sa.grain = n / sr;
    src.onended = () => { if (sa.voice === src){ sa.voice = null; sa.voiceG = null; } };
  }
  async function saJob(gen){
    const aid = sa.aid;
    let st;
    try { st = await store.video.scrubAudio.status(aid).then((r) => r.json()); }
    catch { return null; }
    if (sa.gen !== gen) return null;
    if (st.state === "none" || st.state === "failed"){
      try {
        st = await store.video.scrubAudio.start(aid).then((r) => r.json());
      } catch { return null; }
      if (st.state === "working" && !sa.told){ sa.told = true; host.flash("Caching sound for scrubbing…"); }
    }
    let lost = 0;
    while (st.state === "working" || st.state === "none"){
      if (sa.gen !== gen || !lt()) return null;
      await new Promise((r) => setTimeout(r, 600));
      try { st = await store.video.scrubAudio.status(aid).then((r) => r.json()); lost = 0; }
      catch { if (++lost >= 10) return null; }
    }
    return sa.gen === gen ? st : null;
  }
  async function saFetch(gen, t){
    const sr = sa.sr || 22050;
    const WIN = 48, BACK = 12;
    let start = Math.max(0, t - BACK);
    if (sa.dur > WIN && start + WIN > sa.dur) start = Math.max(0, sa.dur - WIN);
    const sample0 = Math.floor(start * sr);
    const nSamp = Math.max(1, Math.floor(WIN * sr));
    const b0 = sample0 * 2, b1 = b0 + nSamp * 2 - 1;
    let r;
    try {
      r = await store.video.scrubAudio.range(sa.aid, sa.rev, b0, b1);
    } catch { return false; }
    if (sa.gen !== gen) return false;
    if (r.status === 404) return "gone";
    if (!r.ok) return false;
    const buf = await r.arrayBuffer();
    if (sa.gen !== gen || buf.byteLength < 2) return false;
    let origin = 0;
    if (r.status === 206){
      origin = b0;
      const m = /bytes (\d+)-/i.exec(r.headers.get("content-range") || "");
      if (m) origin = Number(m[1]);
    }
    let off = 0;
    if (origin % 2){ origin -= 1; off = 1; }
    const n = Math.floor((buf.byteLength - off) / 2);
    if (n < 2) return false;
    sa.pcm = new Int16Array(buf.slice(off, off + n * 2));
    sa.t0 = (origin + off) / 2 / sr;
    return true;
  }
  function saPump(){
    if (sa.busy) return;
    sa.busy = true;
    const gen = sa.gen;
    (async () => {
      try {
        while (sa.gen === gen && sa.aid && sa.want != null && lt()){
          const t = sa.want;
          if (sa.state !== "ready" && sa.state !== "silent" && sa.state !== "failed"){
            const st = await saJob(gen);
            if (sa.gen !== gen) return;
            if (!st){ if (lt()) sa.state = "failed"; return; }
            if (st.state !== "ready" && st.state !== "silent"){ sa.state = "failed"; return; }
            if (st.state === "silent"){ sa.state = "silent"; return; }
            sa.sr = st.sr || 22050;
            sa.dur = Number(st.duration) || 0;
            sa.rev = st.rev || "";
            sa.state = "ready";
          }
          if (sa.state !== "ready") return;
          if (!saCovers(t)){
            const mark = sa.t0 + "/" + (sa.pcm ? sa.pcm.length : 0);
            const ok = await saFetch(gen, t);
            if (sa.gen !== gen) return;
            if (ok === "gone"){ sa.state = ""; sa.pcm = null; continue; } // the file went away: ask again
            if (!ok || mark === sa.t0 + "/" + (sa.pcm ? sa.pcm.length : 0)) return;
          }
          if (lt()?.scrubbing && host.sound().scrub && !host.muted() && saCovers(lt().scrubT ?? t)) saPlay(lt().scrubT ?? t);
          if (sa.want == null || sa.want === t || saCovers(sa.want)) return;
        }
      } catch (e) {
        console.warn("Sight: scrub audio", e);
        if (sa.gen === gen && sa.state !== "ready") sa.state = "failed";
      } finally {
        sa.busy = false;
        if (sa.gen !== gen && sa.aid && sa.want != null && lt() && sa.state !== "silent" && sa.state !== "failed") saPump();
      }
    })();
  }
  function scrubPrepare(aid, t){
    if (!host.sound().scrub || !aid) return;
    saTouch(aid);
    if (sa.state === "failed") sa.state = "";
    sa.want = t || 0;
    if (sa.state === "silent") return;
    if (sa.state === "ready" && saCovers(sa.want)) return;
    saPump();
  }
  function scrubHear(aid, t){
    if (!aid) return;
    if (!host.sound().scrub){ scrubSilence(); return; }
    saTouch(aid);
    sa.want = t;
    if (host.muted()){ scrubSilence(); return; }
    if (sa.state === "silent" || sa.state === "failed") return;
    // resume() has to run inside the drag gesture; the slice itself may start later, once the cache arrives.
    saEnsureCtx();
    if (sa.state === "ready" && saCovers(t)){ saPlay(t); return; }
    saPump();
  }
  return { scrubPrepare, scrubHear, scrubSilence, scrubAudioStop, saApplyVol };
}
