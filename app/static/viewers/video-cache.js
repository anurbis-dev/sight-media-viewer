// The video viewer's RAM cache calls (part of the video module, viewers/video.js; R0b-2). Moved out of index.html
// unchanged; the server calls go through the store (store.video, store.mediaUrl, store.convertForPlayback).
//
// The video's RAM cache lives on the server (SlidingVideoCache): the player tells it where the
// playhead is and how much RAM the settings allow, it keeps a window of the file filled around that
// spot (sliding with the playhead) and reports back the blocks actually in RAM — those runs are the
// green on the timeline (a hole stays a hole; the planned window is not drawn). Bytes map onto the
// clip the same way the playhead's byte is chosen (size · t / duration). The painter is
// video-cache-bar.js, the same one a compare lane uses. The <video> itself just streams
// /api/file/<id>, which is served through that window, so playback starts at once instead
// of after the whole file has been downloaded.
//
// host (the frame; Sight's lightbox in index.html):
//   ctl()          the frame's state object (Sight: `light`, null once closed). Read / written here: video, asset,
//                  seq, scrubT, snap, seqSnaps, focusHeld, focusAt, focusTimer, focusAbort, cacheTimer
//   store          the store (store.video.focus / .cache, store.mediaUrl, store.convertForPlayback)
//   cacheMb() / cacheAhead()   the RAM budget (MB) and its share ahead of the playhead (percent), clamped
//   cacheGen()     the generation of the windows' owner (bumped when compare takes them / hands them back)
//   paintVBar()    repaint the video bar
import { cacheBarHtml } from "../video-cache-bar.js";

export function paintCacheBars(el, snap){
  if (!el) return;
  const html = cacheBarHtml(snap);
  if (el._html === html) return;
  el._html = html;
  el.innerHTML = html;
}

export function createVideoCache(host){
  const lt = () => host.ctl();
  const store = host.store;
  const paintVBar = () => host.paintVBar();
  function applyCacheSnap(snap){
    if (!lt() || !snap) return;
    lt().snap = snap;
    // A sequence: this reply is the clip on screen. Keep it with the others the poll gathered.
    if (lt().seq){
      const id = lt().seq.list[lt().seq.i]?.id;
      if (id){ lt().seqSnaps = lt().seqSnaps || {}; lt().seqSnaps[id] = snap; }
    }
    paintVBar();
  }
  function applyCacheFiles(j){
    if (!lt() || !j) return;
    const files = j.files || {};
    // A sequence poll is the whole answer: merge would keep a green run on a clip this request did not
    // include. Past 64 clips that is the one just left behind — its window is already gone (only the open
    // clip and its neighbours are held, and those ids are always in the request).
    let snaps;
    if (lt().seq){
      const keep = new Set(lt().seq.list.map((a) => a.id));
      snaps = {};
      for (const id of Object.keys(files)) if (keep.has(id)) snaps[id] = files[id];
    } else snaps = Object.assign({}, files);
    lt().seqSnaps = snaps;
    const id = lt().seq ? lt().seq.list[lt().seq.i]?.id : lt().asset?.id;
    if (id && files[id]) lt().snap = files[id];
    paintVBar();
  }
  // Tell the server where the playhead is (throttled: minGap ms between posts, with a trailing post
  // so the last position always gets through). Every post carries the RAM budget from the settings,
  // so the saved value applies from the first video after a restart, not only after the slider moves.
  function pushVideoFocus(el, a, minGap){
    if (!lt() || lt().video !== el || lt().focusHeld) return; // compare owns the windows while it is open
    clearTimeout(lt().focusTimer);
    const wait = minGap - (performance.now() - lt().focusAt);
    if (wait > 0){ lt().focusTimer = setTimeout(() => pushVideoFocus(el, a, 0), wait); return; }
    lt().focusAt = performance.now();
    const t = lt().scrubT != null ? lt().scrubT : el.currentTime;
    // A sequence: the window runs on past the clip's end into the next clip, before its start into the previous
    // one (loop on: around), so a cut either way reads from RAM.
    const s = lt().seq, n = s ? s.list.length : 0;
    const nb = (k) => (s && k !== s.i && s.list[k] ? s.list[k].id : undefined);
    const next = s ? nb(s.i + 1 < n ? s.i + 1 : s.loop ? 0 : -1) : undefined;
    const prev = s ? nb(s.i > 0 ? s.i - 1 : s.loop ? n - 1 : -1) : undefined;
    lt().focusAbort?.abort();
    const ac = new AbortController();
    lt().focusAbort = ac;
    store.video.focus({ id: a.id, t: t || 0, duration: Number.isFinite(el.duration) ? el.duration : 0, mb: host.cacheMb(), ahead: host.cacheAhead(), next, prev, gen: host.cacheGen() }, ac.signal)
      .then((r) => r.json()).then((snap) => { if (lt() && lt().video === el && !lt().focusHeld) applyCacheSnap(snap); }).catch(() => {});
  }
  // keep: the element already streams the file (a preloaded sequence clip) — don't reload it.
  function startVideoCache(el, a, keep){
    releaseMedia(false);
    if (!keep) el.src = store.mediaUrl(a.id);
    watchPlayable(el, a);
    pushVideoFocus(el, a, 0);
    // The window keeps filling after the focus reply, so poll to keep the strip honest. A sequence asks
    // for every clip; only a clip that has a window (the one on screen, and its neighbours) comes back with runs.
    lt().cacheTimer = setInterval(() => {
      if (!lt() || lt().video !== el) return;
      const ids = lt().seq && lt().seq.list.length > 1 ? seqCacheIds(lt().seq) : null;
      store.video.cache(ids || a.id).then((r) => r.json()).then((j) => {
        if (!lt() || lt().video !== el || !j) return;
        if (j.files) applyCacheFiles(j); else applyCacheSnap(j);
      }).catch(() => {});
    }, 500);
  }
  // Up to 64 clips per poll (the server's cap). The clip on screen and its two neighbours go first, so a
  // long sequence still shows the windows that are actually being filled.
  function seqCacheIds(s){
    const ids = s.list.map((a) => a.id), n = ids.length;
    if (n <= 64) return ids;
    const at = (k) => ids[(k + n) % n];
    const near = new Set([at(s.i)]);
    if (s.i + 1 < n || s.loop) near.add(at(s.i + 1));
    if (s.i > 0 || s.loop) near.add(at(s.i - 1));
    const out = ids.filter((id) => near.has(id));
    for (const id of ids){ if (out.length >= 64) break; if (!near.has(id)) out.push(id); }
    return out;
  }
  // The browser decodes only some codecs. When the file gives no picture (an error, or metadata without
  // a video size), the server makes a playback copy (video-playable.js) and the player switches to it,
  // keeping its place in the HUD line under the picture meanwhile. Asked once per opened file.
  function watchPlayable(el, a){
    let asked = false;
    const fallback = async () => {
      if (asked || !lt() || lt().video !== el) return;
      asked = true;
      const hud = el.parentElement?.querySelector(".view-hud");
      // (the loading mark only while converting: show("") and the error take it off)
      const show = (text, busy) => { if (hud){ hud.textContent = text; hud.classList.toggle("ld", !!busy); } };
      show("Converting for playback…", true);
      const res = await store.convertForPlayback(a.id, (p) => show(`Converting for playback… ${Math.round(p * 100)}%`, true),
        () => !!lt() && lt().video === el);
      if (!lt() || lt().video !== el) return;
      // A sequence jump waiting to land on this clip never will: let frame / marker keys move on again.
      if (!res.ok){ show(`Cannot play this file: ${res.error}`); if (lt().seq) lt().seq.pendT = lt().seq.pendPlay = null; return; }
      show("");
      el.src = store.mediaUrl(a.id, { copy: true });
      pushVideoFocus(el, a, 0);
    };
    el.addEventListener("error", fallback);
    el.addEventListener("loadedmetadata", () => { if (!el.videoWidth) fallback(); });
  }
  // free: also drop the server-side window (player closed / moved to a non-video) so a big RAM budget
  // doesn't stay resident with nothing playing.
  function releaseMedia(free){
    if (!lt()) return;
    clearInterval(lt().cacheTimer);
    clearTimeout(lt().focusTimer);
    lt().cacheTimer = lt().focusTimer = 0;
    lt().focusAbort?.abort();
    // Compare still open: its clips keep the windows. A release here would drop them.
    if (free && !lt().focusHeld) store.video.release(host.cacheGen()).catch(() => {});
  }
  return { pushVideoFocus, startVideoCache, watchPlayable, releaseMedia };
}
