// The video viewer (viewers/viewer.js has the interface): the 2D core (view2d.js) plus a video's own parts —
// seeking that keeps up with a scrub, the scrub copy, the transport (seek / begin / end), playback ticks and the
// frame's video bar, RAM cache and sequence hooks.
//
// Video hooks of the host (Sight's lightbox in index.html):
//   paintVBar()                       repaint the video bar (playhead, cache, position)
//   vApplySnd(el) / vApplyLoop(el)    the player's volume / mute and loop onto a new element
//   bindVBar(el, seek, begin, end)    wire the bar's track to this transport
//   startVideoCache(el, a, keep)      start streaming + the RAM cache window (keep: the element already streams)
//   pushVideoFocus(el, a, minGap)     tell the RAM cache where the playhead is (throttled)
//   scrubPrepare(id, t) / scrubHear(id, t) / scrubSilence()   sound while scrubbing
//   scrubSnapped(e) / scrubSnap(t, tol) / snapPx()            Ctrl-scrub snap to an annotated frame
//   seqOnReady(el) / seqKeepStill(el) / seqAdvance() / seqScrubBegin(e, fine)   the sequence player
//   convertForPlayback(id, onProgress, alive, kind)            the server's playback / scrub copies
import { FINE_SCRUB } from "../viewer-input.js";
import { mount2d } from "./view2d.js";

export function mountVideo(stage, a, src, opts, host){
  return mount2d(stage, a, src, opts || {}, host, videoParts);
}

function videoParts({ el, wrap, a, opts, host, L, apply }){
  let scEl = null; // the scrub copy over a video (see loadScrubCopy)
  // Scrubbing sets currentTime far faster than a long-GOP clip can decode. Firing a seek per
  // pointer event piles them up and the picture freezes until the pointer stops, so only the latest
  // wanted time is kept and the next seek goes out once the previous one has landed ("seeked").
  // The playhead (scrubT) still follows the pointer instantly.
  let seekWant = null;
  function pumpSeek(){
    if (seekWant == null || el.seeking) return;
    const t = seekWant;
    seekWant = null;
    if (Math.abs(t - el.currentTime) > 0.001) el.currentTime = t;
  }
  // A long-GOP clip (a keyframe every few seconds) is slow to seek however fast the disk is: each
  // seek decodes from the keyframe before it, so the cost grows towards the middle of each GOP
  // (~230 ms for the 8.3 s GOP of a 416x960 phone clip) and a drag painted about one position in five.
  // RAM in the green bar does not change that. A clip of at least 3 s asks for a scrub copy as soon
  // as it can play (compare.js ensureScrubs does the same when compare opens). Two slow seeks during
  // a scrub still ask, if that did not. Once the copy can show a frame, a drag seeks only the copy
  // (a keyframe every 4 frames, ~2 ms a seek) and the full file is sought once when the drag ends.
  // Until then the full file is still seeked, so the picture does not sit still for the whole encode.
  // The copy is shown over the player (same geometry, apply()) and hidden when the player itself has
  // landed on the last position. The copy's frame times can differ from the original's by a fraction
  // of a frame, so the hand-over may "pop" by that much.
  const SLOW_SEEK_MS = 80, SLOW_SEEKS = 2, SCRUB_COPY_MIN_S = 3;
  let seekAt = 0, slowSeeks = 0, scAsked = false, scWant = null, scGen = 0, scSeekGen = -1;
  function loadScrubCopy(){
    if (scAsked || opts.embedded || !L() || !(Number.isFinite(el.duration) && el.duration >= SCRUB_COPY_MIN_S)) return;
    scAsked = true;
    host.convertForPlayback(a.id, null, () => !!L() && L().video === el, "scrub").then((res) => {
      if (!res.ok || !L() || L().video !== el || !el.isConnected) return;
      const v = document.createElement("video");
      v.className = "view-scrub";
      v.muted = true; v.playsInline = true; v.preload = "auto"; v.hidden = true;
      // No src yet (compare.js armScrubs). A hidden proxy that is already decoding holds a
      // hardware decoder, and on Windows the clip on screen then stutters or fails a seek.
      v.addEventListener("error", () => {
        if (!v.getAttribute("src")) return; // dropping the decoder fires error too
        console.warn("Sight: the scrub copy did not load", a.id, v.error?.code);
        v.hidden = true;
        if (scEl === v) scEl = null;
      });
      v.addEventListener("loadedmetadata", () => { if (L()?.scrubbing) pumpScrubCopy(); });
      v.addEventListener("seeked", () => {
        pumpScrubCopy();
        if (L()?.scrubbing && scWant == null && !v.seeking && scSeekGen === scGen) v.hidden = false; // not a seek from the last drag
      });
      el.after(v); // under the drawings and the HUD
      scEl = v;
      apply();
      if (L()?.scrubbing) armScrubCopy();
    });
  }
  function armScrubCopy(){
    if (!scEl || scEl.getAttribute("src")) return;
    scEl.src = `/api/video/scrub/${a.id}`;
  }
  // The full file is the picture again: hide the proxy first, then drop its src.
  function releaseScrubCopy(){
    const v = scEl;
    if (!v) return;
    v.hidden = true;
    scWant = null;
    if (!v.getAttribute("src")) return;
    try { v.pause(); v.removeAttribute("src"); v.load(); } catch {}
  }
  function pumpScrubCopy(){
    if (!scEl || scWant == null || scEl.seeking || scEl.readyState < 1) return;
    const t = scWant;
    scWant = null;
    if (Math.abs(t - scEl.currentTime) > 0.001){ scSeekGen = scGen; scEl.currentTime = t; }
    else if (L()?.scrubbing && !scEl.seeking) scEl.hidden = false;
  }
  // The copy can stand in for the full file during a drag (compare.js syncVideos: readyState >= 1).
  function scrubCopyReady(){
    return !!(L()?.scrubbing && scEl && scEl.getAttribute("src") && scEl.readyState >= 1 && !scEl.error);
  }
  function hideScrubCopy(){
    if (!scEl) return;
    const v = scEl, gen = scGen;
    if (!v.getAttribute("src")){ v.hidden = true; return; }
    let done = false;
    // Only once the player has presented its own frame of the position, or the old one would flash.
    // Then drop the decoder. A newer drag (scGen) keeps the proxy it just armed.
    const hide = () => { if (done) return; done = true; if (L() && !L().scrubbing && scEl === v && scGen === gen) releaseScrubCopy(); };
    if (el.requestVideoFrameCallback) el.requestVideoFrameCallback(hide);
    setTimeout(hide, 250);
  }
  function seekVideo(t){
    const dur = el.duration || 0;
    if (!dur) return null;
    t = Math.min(dur, Math.max(0, t));
    if (L()) L().scrubT = t;
    host.paintVBar();
    // A drag with a short-GOP copy seeks only that copy. The full file is sought once in endScrub
    // (the timeline's pointer-up calls seekVideo while the drag is still on, so this must not
    // queue it). Until the copy can show a frame the full file is still seeked.
    if (scrubCopyReady()){
      seekWant = null;
      scWant = t;
      pumpScrubCopy();
    } else {
      seekWant = t;
      pumpSeek();
      if (scEl && L()?.scrubbing){ scWant = t; pumpScrubCopy(); }
    }
    host.pushVideoFocus(el, a, 200); // keep the RAM window under the playhead while scrubbing
    if (L()?.scrubbing) host.scrubHear(a.id, t);
    return t;
  }
  // Hand the playhead back to the element once the last seek has landed.
  function settleScrub(){
    if (L() && !L().scrubbing && seekWant == null && !el.seeking){ L().scrubT = null; host.paintVBar(); hideScrubCopy(); }
  }
  function beginScrub(){
    if (!L()) return;
    L().scrubbing = true;
    el.pause();
    scGen++;
    if (scEl){ scEl.hidden = true; scWant = null; } // shown again once it has landed on this drag's position
    armScrubCopy();
  }
  function endScrub(){
    if (!L() || !L().scrubbing) return;
    const t = L().scrubT;
    L().scrubbing = false;
    host.scrubSilence();
    // One seek of the full file, before settleScrub. A picture drag only calls endScrub; the
    // timeline calls seekVideo first, and that call may have touched only the copy. A sequence
    // cut calls this on the clip being left, then opens the next one.
    if (t != null && el.duration){
      seekWant = Math.min(el.duration, Math.max(0, t));
      pumpSeek();
    }
    host.pushVideoFocus(el, a, 0);
    settleScrub();
  }
  // A left drag on the picture (viewer-input.js scrub): the window's width is the clip.
  let scrubT0 = 0, handed = false;
  const dragScrub = {
    begin: (e) => {
      handed = false;
      // Sequence: the scrub belongs to the whole sequence, so it does not stop at this clip's ends. Its own
      // window listeners run it (the stage is replaced at each cut); here it only stays claimed until release.
      // (one already running — a finger pressed on an earlier clip's viewer — : this press stays dead)
      if (L()?.seq && !opts.embedded){ handed = true; if (!L().seqDrag) host.seqScrubBegin(e, e.shiftKey); return true; }
      scrubT0 = el.currentTime;
      beginScrub();
      return true;
    },
    to: (frac, ev) => {
      if (handed) return;
      const dur = el.duration || 0, t = scrubT0 + frac * dur;
      seekVideo(host.scrubSnapped(ev) ? host.scrubSnap(t, host.snapPx() / Math.max(1, wrap.clientWidth) * dur * (ev.shiftKey ? FINE_SCRUB : 1)) : t);
    },
    end: () => { if (!handed) endScrub(); handed = false; },
  };
  return {
    transport: { seek: (t) => seekVideo(t), begin: () => beginScrub(), end: () => endScrub() },
    dragScrub,
    follow(style){
      if (!scEl) return;
      scEl.style.width = style.width;
      scEl.style.height = style.height;
      scEl.style.transform = style.transform;
    },
    // (the seek listeners go in before the core's own load / ready listeners, as they always did)
    listenEarly(){
      el.addEventListener("seeking", () => {
        seekAt = performance.now();
        // A seek that is no scrub nor its hand-over (frame step, marker jump): the copy goes at once.
        if (scEl && L() && !L().scrubbing && L().scrubT == null){ scEl.hidden = true; scWant = null; }
      });
      el.addEventListener("seeked", () => {
        if (L()?.scrubbing && seekAt && performance.now() - seekAt > SLOW_SEEK_MS && ++slowSeeks >= SLOW_SEEKS) loadScrubCopy();
      });
    },
    onReady(){
      host.paintVBar(); host.seqOnReady(el);
      if (!opts.embedded) host.scrubPrepare(a.id, el.currentTime || 0);
      // A picture means the file plays: an unplayable file starts a playback transcode, which
      // would kill a scrub encode. Clips under 3 s are skipped inside loadScrubCopy.
      if (el.videoWidth) loadScrubCopy();
    },
    // Playback ticks, the sequence's cut at the end, the bar and the RAM cache (after the core's size observer).
    wire(){
      // timeupdate alone (a few ticks/sec) is what made the playhead visibly jump — a rAF
      // loop while playing sweeps it smoothly instead, same fix as the audio waveform.
      let vRaf = 0;
      const vTick = () => {
        if (!L() || L().video !== el){ vRaf = 0; return; }
        host.paintVBar();
        vRaf = requestAnimationFrame(vTick);
      };
      el.addEventListener("play", () => { if (!vRaf) vRaf = requestAnimationFrame(vTick); });
      const stopVTick = () => { if (vRaf) cancelAnimationFrame(vRaf); vRaf = 0; };
      el.addEventListener("pause", stopVTick);
      el.addEventListener("ended", stopVTick);
      el.addEventListener("timeupdate", () => {
        if (L()?.scrubbing || el.seeking || seekWant != null) return;
        if (L()) L().scrubT = null;
        host.paintVBar();
        host.pushVideoFocus(el, a, 1000); // playback: slide the RAM window about once a second
      });
      el.addEventListener("seeked", () => { pumpSeek(); settleScrub(); host.seqKeepStill(el); });
      el.addEventListener("loadeddata", () => { if (el.videoWidth) loadScrubCopy(); });
      el.addEventListener("pause", () => host.seqKeepStill(el));
      // Sequence: cut on the end of playback only — a scrub or a seek to the very end fires "ended" too (paused).
      el.addEventListener("timeupdate", () => { if (!el.paused && !el._blip) el._seqPlayedAt = performance.now(); });
      el.addEventListener("playing", () => { if (!el._blip) el._seqPlayedAt = performance.now(); });
      el.addEventListener("ended", () => {
        if (!L()?.seq || L().video !== el || L().scrubbing || L().scrubT != null) return;
        if (!(performance.now() - (el._seqPlayedAt || -1e9) < 1500)) return;
        host.seqAdvance();
      });
      host.bindVBar(el, seekVideo, beginScrub, endScrub);
      host.startVideoCache(el, a, !!opts.adopt);
    },
  };
}
