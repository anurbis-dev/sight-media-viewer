# Archived changes — 2026-11

Older entries moved out of RECENT.md; newest first. Append-only history.

## 0.96.5 — 2026-11-20 — Phone: sound from the earliest moment — the cached picture slows instead of the player racing
- **What:** owner (phone debug log 17:00, 0.96.4): "the sound comes very late at start, and it plays on after a stop". The log: (1) with the whisper the player's start lag stayed 0.22-0.26 s (`v.moved`), so the sound came in at the handover, 0.44-0.81 s after the tap, plus the output latency; and every handover with sound overshot by ~0.21 s (`currentTime` 0.2 s past the clock a second later) — the rate change 2x → 1x takes effect only after the ~0.2 s already in Android's audio output, so the player ran on at 2x that long. (2) After a pause with sound the next `play()` jumped +0.21 / +0.22 s (2.37 → 2.58, 3.568 → 3.788; the same in the 0.96.2 log, 8.254 → 8.477, never on the silent clip): the ~0.2 s already in the audio output plays out after the pause and the player goes on from past it. One cause behind all of it: this device's ~0.2 s audio output latency (Chrome waits for the sound to be heard before moving the picture). Now a player with sound plays at its own rate, with its sound, from its start (the sound comes in at ~0.25 s — the soonest the device allows, as before the bridge) and the cached picture slows to half speed while the player is behind it, then hands over (stay: ~0.5 s); no mute, no whisper, no rate change with sound. A silent player (level 0, a clip with no sound) catches up at 2x as before. On Android, after a pause with sound the next play first sends the player to the middle of the frame shown, so it starts there.
- **Where:** mobile/js/app.js — `silentNow()` / `BRIDGE_SLOW` replace `bridgeMutes()` / `BRIDGE_HUSH`; `bridgePlan` (`pr` / `close` per mode); `bridgeStart` (the picture clock `B.t0` / `B.at` / `B.sp`, slowed in `tick` once past `B.x` and from the first moving frame to the handover; 2x and the rate bump only when `B.silent`; no mute / volume; `B.pmu` — muted at play — keys the learnt lag); `bridgeEnd` (rate only; `bridgeLast.why` / `ms`); `applyVol` (no bridge case); `setVol` (switches a running bridge's mode); `setRate` (re-bases with `B.sp`); `togglePlay` (`lagNow(silentNow())`; the `R.padT` seek); the player's "pause" / "seeking" listeners (`R.padT`, `androidAudio`); the WebKit comment; `__sightReview.androidAudio` (tests). tests: the stay step (a clip with sound) asserts rate 1 throughout, never muted, the picture's speed < 0.85, handed over by the player within h + 0.35 s, a mid-bridge level applies at once; with `androidAudio` faked, a pause seeks nothing and notes the frame, the next play first seeks to that frame's middle, a muted pause notes nothing; the first bridge step asserts no mute. ARCHITECTURE, MANUAL.
- **Notes:** the sound after a stop (~0.2 s) is already in the device's output when the pause comes — not cut by the page (Bluetooth headphones would explain a latency this large: ask). The pad seek costs one seek at the next play (hidden by the bridge's wait-for-seek plan; a plain play — no cache, a drawing session — waits for it); Android only, not when muted / a clip without sound / fps unknown, dropped by any seek in between; a seek to the paused time itself is elided by Chrome, hence the frame's middle. iOS: the bridge no longer mutes, so the un-mute-pauses rule no longer applies to it; the `v.sightTap` gate stays (a play with sound outside a tap). The slowed picture is visible as slow motion for ~2·lag (stay) and longer when the player first has to seek (half the seek time again). Not verified on the phone: the next log should show no `currentTime` overshoot after `bridge.end`, `v.play` after a pause at the paused time, and the sound in at ~0.25 s.
- Review (fresh agent): high — with sound the bridge rarely handed over on time: `tick` extrapolated the player's position from `presentationTime` while `follow` compares at `expectedDisplayTime`, so the picture went back to full rate just short of the handover and the gap stalled (9 of 13 instrumented runs: bridges ~1.8 s, saved by the clip's end clamp; on a longer clip "late" with a step back) — the picture now stays slow from the player's first moving frame to the handover, and the e2e asserts a player handover within h + 0.35 s. Medium: the pause seek ran on every pause on every platform (a step after a pause waited behind it, a plain play waited for a whole seek, a `seekTo` onto the same frame settled twice) — now noted at the pause and done by the next play, Android only; tests check the noted frame, the seek's frame and a muted pause. Low: the plan's h for a seek-ahead plan assumed the picture slow from the start (it runs at the rate until past x) — modelled; `setVol` mid-bridge left the mode stale (2x with sound, or a muted start learnt as a sound lag) — `setVol` switches `B.silent`, the lag is keyed by `v.muted` at play (`B.pmu`).
- The same reviewer confirmed all five fixes on its second pass (10 of 10 runs) and found nothing new; its one nit (a ~0.5 % flake when the paused time sits at the frame's middle and gets nudged) is fixed in the test.

## 0.96.4 — 2026-11-20 — Phone: no stall at the handover — the catch-up whispers instead of muting
- **What:** owner (phone debug log 15:13, 0.96.3): the bridge worked (18 starts, all handed over, picture moving within 5-80 ms of the tap), but the player stalled ~150-220 ms right after each handover on the phone clip (`currentTime` behind the wall clock by that much a second later; e.g. the keyframe seek at 3.6 s: handed over at 4.026, 0.217 s short 0.93 s later). Cause: un-muting a playing video on Android starts its audio output then and the video waits for it. The same 230-260 ms is the "HEVC start lag" of 0.96.2 / 0.96.3 — muted, the HEVC clip started in 21-65 ms; unmuted, plain plays took 230-263 ms; the H.264 clip (no sound) never stalled. So the lag was the audio output, not the codec, and the learnt lag swung between the two (muted bridge starts ~0.03-0.08, unmuted plain starts ~0.25), so plays alternated bridged / plain with a 0.25 s wait. Now the catch-up plays at a whisper (`volume` 0.001, not `muted`), so the audio output runs from the start (its ~0.25 s hidden under the cache picture) and the handover only raises the level; the lag is learnt per codec and per sound (muted / no sound vs with sound).
- **Where:** mobile/js/app.js — `bridgeMutes()` / `BRIDGE_HUSH` (new), `bridgeStart` (`B.mute`; whisper or mute), `bridgeEnd` (`applyVol`), `applyVol` (does nothing to a bridging player), `lagKey(m)` / `lagNow(m)` / `noteLag(s, m)` (`:m` keys, `*` / `*:m` fallbacks replace `playLag`), `bridgePlan(…, m)`, `togglePlay` (`lagNow(volLevel < 0.02)`), the plain-play lag listener (keyed by `v.muted`), `__sightReview.setLag` (all keys); the debug `bridge` event logs `mute`. tests/pwa_e2e.cjs + test_pwa.py `test_wcache`: the sampler's hushed column is `muted || volume < 0.01`; the stay step (a clip with sound) asserts never muted and the level back after. ARCHITECTURE, MANUAL.
- **Notes:** still muted where the volume cannot be set (iOS: `volWorks` false — un-muting there is untested on a phone), at level 0, and for a clip known to have no sound (`R.hasAudio === false`; nothing to start). A clip whose sound is still unknown (Chrome guesses after 0.25 s of unmuted play) whispers. The whisper is 0.001 (−60 dB), not 0: Chrome may treat exactly 0 like muted. With the audio output started, the bridge's start lag is ~0.25 s on the phone clip, so its handover comes ~0.5 s after the tap (catch-up at 2x) — the picture moves at once all the same; the sound starts at the handover as before. Not verified on the phone yet: the next log should show no `currentTime` shortfall after `bridge.end`, bridge lags ~0.25 for the clip with sound, and no plain plays of it.
- Review (fresh agent): no high / medium bugs (every exit path restores the sound through `bridgeEnd` → `applyVol`, which runs after `rv.bridge` is cleared). Low, done: the stay e2e step set `hasAudio` after `setLag` and passed only via the `*` fallback (the wc fixtures have no sound: `:m` keys) — order fixed; a level set mid-bridge is now tested (kept off the hushed player, applied at the handover: `__sightReview.setVol`); the first bridge step asserts the mute path (a clip with no sound); `rebind` now ends a running bridge (its new player kept the default level until the old bridge timed out — older gap, sharper now that `applyVol` returns early).
- The same reviewer confirmed all fixes on its second pass and found nothing new (a misplaced test comment, fixed).

## 0.96.3 — 2026-11-20 — Phone: the player catches the cache up unseen — play starts at once everywhere
- **What:** owner (phone debug log 12:41, "the most responsive player"): the 0.96.2 bridge worked (14 starts, no failures), but delays remained: (1) a play from the frame the player stands on — HEVC takes 236-272 ms from `play()` to its first moving frame (H.264 11-44 ms); (2) a tap while seeking near a clip's end (harpy with one keyframe at 4.1-4.8 s, HEVC at 6.1 / 7.5 s): no frame ahead reachable in time, plain play, 0.3-1 s; (3) a 80-160 ms freeze at the handover in 6 of 9 bridges — the cache held at t1 while the player was late (a clip's first seek cost 350-470 ms vs 220-290 predicted, and the learnt start lag 0.14-0.19 s lagged the real ~0.22 s). Now the cache picture always runs at the clock and the player catches it up muted at 2x (`catchRate`, 4x max) then hands over with its rate and sound back; a settled HEVC play bridges too ("stay": no seek); near the end with no handover possible the cache plays the tail alone and the clip ends as if played (on into the next clip).
- **Where:** mobile/js/app.js — the bridge block rewritten (`bridgePlan` stay / wait-for-seek / seek / tail plans by soonest handover, `bridgeStart` with the catch-up watch, `bridgeEnd` restores rate and mute, `bridgeTailEnd`, `lagBy` / `lagNow` / `noteLag` / `catchRate`, `seekCost.o`, `noteSeek(x, s, extra)`); `togglePlay` (bridges a slow settled start too; ended → from 0; `playTapped`), the seek-cost listener (`R.seekN`, `R.seekFrom` / `R.seekX` / `R.seekO`), a plain-play lag listener, the "ended" handler (ends a bridge), `seqSwitch` (`rateNow()`), `rateNow` / `setRate` (bridge clock re-based), `applyVol` (keeps muted during a bridge), `__sightReview.setLag`. tests/pwa_e2e.cjs + test_pwa.py `test_wcache`: stay (faked 0.3 s start: no seek, 2x, muted, handover, rate / sound back), tail (no seek, into clip b), cut (clip a plain to its end), play after the last clip ended. ARCHITECTURE "Play start from the cache", MANUAL.
- **Notes:** trade-offs, deliberate: the picture is instant but the sound starts at the handover — about 2·lag after the tap (~0.5 s for HEVC, it was 0.25 s with the picture frozen meanwhile) — and the first ~0.5 s is the 640 px cached picture; a tail near the end is silent (≤ ~2·lag). The lag is learnt per codec (`wc.codec` 4 chars; the extension before the track is parsed — early samples go under that key), default 0.12 s, not persisted: the first tap of a session on any codec bridges (bridging costs nothing visible). A stay plan is preferred unless a seek is ≥ 0.15 s sooner (seek costs are guesses). A decoder that cannot sustain 2x (4K HEVC?) never catches up: "late" after max(2 s, h + 1 s) hands over with a step back. Still not covered: a tap while seeking where the cache does not reach the handover (HEVC 6.14 s case: cache built to 6.63 s, next keyframe 8 s) — plain play as before. iOS: the bridge only after a `play()` ran inside a tap (`v.sightTap`), as un-muting a play started outside one pauses it. Not tested on a phone yet.
- Review (fresh agent): high — a tap after the clip had ended did nothing (the slow-start check bridged from the end: a 0-length tail → `seekTo(end)`); now an ended clip plays from 0 and a tail needs ≥ 1 frame (e2e "again"). Medium: iOS `played.length` no longer proved the element unlocked (a muted cut play counted) → `v.sightTap`; a stay play begun before the clip's first frame never reached "stuck" (late dropped the picture to black) and learnt the decoder start as lag → late now keeps the cached frame while the player is still loading (`R.keepPic`, off at "playing"), lag learnt only from a decoded start; the cut e2e step had become a tail (lag left at 0.3) → lag reset, asserts clip a ended plainly, rate / mute. Low, done: lag learnt from plain plays too; a seek on its way is let finish (a candidate; its frame not re-sent); `seqSwitch` used the 2x rate; an outside pause during the bridge halts it (0.5 s); `setRate` re-bases instead of pausing; a refused switch at a tail's end lands on the last frame; `setLag` without R. Own fix found by the tests: "seeking" fires as a task, so a seek just sent read the previous seek's start time (seemed finished) — the record is matched by its target (`R.seekX`). Not done: `rebind` → `buildStage` does not end a running bridge (older than this change).
- The same reviewer confirmed the fixes; on its second pass: late still dropped the picture after `hideWhenShown`'s 250 ms timeout on a slow load (now `keepPic` below `readyState` 3), and an "ended" during a bridge with no switch left the stale `scrubT` (a tap then replayed the last frame) — the bridge now ends non-quietly there, and the handover clock is capped at the last frame so a late player still hands over; the in-flight seek record is cleared on "seeked". Flaky e2e runs (7 of 14) then showed a real bug: an rVFC frame arriving while the player was still paused (its play not yet started) ended the catch-up watch for good — the player ran on at 2x to the clip's end, no handover; the watch now keeps watching while paused, and `tick` hands over anyway once the player's `currentTime` is a frame past the clock. The cut step's bridge can be shorter than one sampled frame in Chromium (its player starts at once): asserted by `__sightReview.bridgeLast` instead. Third pass: that safety handover fired on a seek-ahead plan right after `play()` (the player still standing on the frame ahead, `currentTime` already a frame past the clock) — the cache dropped and the picture froze for the start lag; it now also needs the player a frame past its start frame (`B.x + fd`); the bridge e2e step fakes a 300 ms start and asserts no handover before the player left 1 s. The same reviewer confirmed all fixes on its fourth pass and found nothing new. 10 of 10 runs pass.

## 0.96.2 — 2026-11-20 — Phone: play starts at once from the scrub cache, also on into the next clip
- **What:** owner (phone debug log 12:05): play after a scrub or a timeline tap started later the further the playhead was from the clip's start, and a play on into the next clip of a sequence started with a delay. The log: `tap.play` with the player still seeking — seeks of 0.57-1.13 s (a 1-GOP H.264 clip: every seek decodes from frame 0; an HEVC phone clip with ~2.7 s GOPs). A seek costs a decode from the keyframe before the frame, so the wait grew with that distance. Now a play from a frame the player is not standing on plays the scrub cache at once (`.scrubimg`, at the clip's pace) while the player is sent to the first frame ahead it can reach in time — the next keyframe if near enough (one frame to decode), else as far as the measured seek cost needs — and plays on from there when the clock gets there; its own picture takes over once it has moved on. A play on across a cut runs the next clip's cached frames (its neighbour cache) while it opens, and the same bridge carries on when it lands.
- **Where:** mobile/js/app.js — `seekCost` / `playLag` / `keyTimes` / `costAt` / `noteSeek` / `bridgePlan` / `bridgeStart` / `bridgeEnd` / `bridgeHalt` (new, after `dragEnd`); `togglePlay` (bridge first; a tap during it halts), `seekTo` (ends it), the player's "seeked" / "play" handlers (bridge guards) and a seek-cost listener; `seqSwitch` → `seqRun`, `seqApply` (`bridgeStart(p.t, p.run)`); `setPanel` / `openDrawVideo` halt it, `closeReview` ends it; debug: `bridge`, `bridge.end`, `v.moved` (play → first frame really moved, the truth `v.playing` is not); `window.__sightReview` exposes `seekCost`, `togglePlay`, `seekTo` (tests). tests: `wcache` mode checks the bridge (seeks made costly: player sent to the 1 s keyframe, the picture never goes back, the player's picture at the end) and the play on across the cut.
- **Notes:** no sound until the player takes over (deliberate: the picture moving at once was asked for; a gapless sound would need a second player per clip). The bridge needs the cache to hold every frame up to `t1` and `t1` within 3 s (and 2 frames before the end); otherwise the old plain play (wait for the seek). The cost model starts at 80 ms + 6 ms a frame (the phone log: 574 ms at frame 100 of a 1360×752 H.264) and learns from every seek; keyframes come from the WebCodecs track (`R.scrub.wc`), a clip on the hidden-player fallback uses one flat learnt seek time. A play from a settled frame is unchanged: the HEVC clip's ~230 ms between `playing` and the clock moving is the player's own start — not bridged (the player cannot start ahead of its frame without another seek); `v.moved` in the next log will show what is left. Not done: the scrub caches still decode while the clip plays (after `playing` + 300 ms).
- Review (fresh agent): (1) high — `seqApply`'s fallback after `seqRun` played from `p.t` (0): the picture jumped back by the open's time; `seqRun` now records the last frame it showed (`p.shown`), the bridge goes on from it when the held picture stopped (frames ran out), and with no bridge the clip plays from it; (2) a tap while the cut animation runs did not pause (it restarted the old clip / played the new one) — it now lands paused on the frame shown (`togglePlay`, `seqPend.play`); (3) direct pauses left the bridge running and playing later: the note's frame shot (`currentFrame`) and the picture scrub's start now halt it; (4) WebKit allows unmuted play only from a tap until an element has played — no tap bridge there on an element that has never played (`strictPlay`; the cut path was already async, unchanged); (5) a seek that never lands could hold the bridge for good — given up 1.5 s past `t1` (plain play); (6) the bridge showed the nearest frame (half a frame early) and a halt stepped back one — now the frame at or before the clock, and its picture stays through the halt's seek; (7) `playLag` included the next frame's duration and the rate — now the start latency only, not learnt without rVFC; (8) seeks before a player's first frame (decoder start) are not learnt, and the fixed cost `a` is learnt from keyframe seeks; (9) a bridge ended before play released the caches only after 4 s (`playPend` reset); (10) the bridge ended a drag by `dragEnd`, not by clearing the flag. Tests: the seek targets are read from the setter (the "seeking" event reads only the last), a tap during the bridge, no going back across the cut.
- The same reviewer confirmed nine fixes; on its second pass the stuck path still dropped the cached frame at once (the player's old frame / black until its seek landed) — now it keeps the frame at `t1` (`R.keepPic`, cleared by "playing" / `settle` / `seekTo`, taken off by `hideWhenShown`); the held picture during `seqRun` now uses the same frame-at-or-before rule as the bridge (`seqHoldPic(…, prev)`: no step back at the handover); the halt test waits for the bridge instead of a fixed time. It confirmed these too, nothing left open.

## 0.96.1 — 2026-11-20 — Phone scrub cache decoded with WebCodecs; no player seeks while dragging over it; the next clip's frame at a cut
- **What:** owner (phone debug log, two clips in a sequence): scrubbing from one clip into the other showed the last clip's frame stuck on the next one and the cache lagged the playhead. The log showed: the open clip's cache stuck at [0, 4.03] of 8.5 s — every part was a 1-frame hole sought by the hidden player (≈ 800 ms each, `got: 0`), the `dead` marks were cleared by every re-plan (each cut), so it never got past them; the second clip got **no frame in 20 s** (the visible player was `seeking` for the whole scrub = busy, and between gestures the first clip held the turn on its hopeless holes); at a cut the next clip's cache was taken over only after `seqApply`, so the old clip's held frame stayed until the player had sought. Now: (1) an MP4 / MOV whose codec WebCodecs takes is cached by a `VideoDecoder` from the file's sample table — every frame, frame-exact, no seeks, no hidden `<video>` (Chromium: 180 frames of a 6 s 640×360 clip in ≈ 0.9 s, the hidden player took 5 s); (2) a drag over cached frames does not seek the player (it seeks once on release — Sight's scrub-proxy rule), so the caches keep the decoder during a scrub; (3) at a cut the hold is the next clip's cached frame (updated on every move while it opens) and its cache is taken over before the landing seek; (4) the hidden player (WebM, no WebCodecs) patches holes of ≤ 3 frames only once nothing else is missing.
- **Where:** mobile/js/mp4.js (`moovOf`, `codecOf`, `avcTagged`, `trackFromMoov`, `videoTrack`); mobile/js/media.js `ScrubCache` (`open` WebCodecs branch, `onFrame`, `onDecError`, `fetchWc`, `after`, `keep(t, frame)` with the turn, `release` closes the decoder, `LATE` in `next`, opts `blob`); mobile/js/app.js (`pumpSeek` / `dragEnd`, `loadedmetadata` order, `seqHoldPic`, caches get `blob`, debug sample `wc`); mobile/index.html (`img.seqhold`); tests/pwa_e2e.cjs `wcache` + test_pwa.py `test_wcache` (VP9 in MP4), `seqbar` touch step; MANUAL, ARCHITECTURE.
- **Notes:** pts = (dts + ctts − first non-empty edit's media_time) / timescale, matched against the player frame by frame in Chromium (x264 B-frames + edit list, no B-frames, a 90° turn, faststart). A B-frame file with *no* edit list starts at pts > 0 and Chromium's player shows the next GOP's keyframe one frame early at a GOP start — the cache is right there, the player is not (rare: muxers write an edit list). Colours: a decoded VideoFrame is drawn as BT.709 when the stream says nothing, the player takes untagged SD as BT.601 — so an untagged H.264 stream under 720 px is configured as BT.601 (HEVC / AV1 / VP9 untagged SD not handled). The rotation comes from the tkhd matrix, not the decoder config. Fragmented MP4 (mvex) and WebM use the hidden player. A VideoDecoder still takes the decoder turn (one cache at a time keeps one); its errors count in `wcFails`, three and that cache falls back for good; a cut part (`decError` included) is never marked `dead`. `R.want` now stays pending for a whole drag over cached frames: `whenSettled` waits for the release, `togglePlay` already sends it. Not verified on a phone: decode speed, HEVC support (isConfigSupported decides), the play-start delay — send a debug log (`c.wc`, `c.part` with `wc: true`) after trying it. `tests.test_pwa` `test_touch` fails before this change too; `test_round_trip` / `test_unit` need pymupdf (not in this container). New tests: `test_wcache` (VP9 in MP4: all frames of both clips, no seek while dragging over the cache, one seek when the finger rests, the next clip's frame at the cut), `test_mp4_track` (node: pts / sync samples / codec / turn against ffprobe on H.264 with B-frames, VFR, 90°).
- Review (fresh agent): (1) on a variable-frame-rate clip the WebCodecs path took every long frame gap for a hole and decoded its GOP again after every re-plan — the owner's symptom back (59 parts, 57 empty in its repro) — holes now only where the track has a frame (`sorted`), 2 parts / 0 empty; (2) no watchdog: a quiet decoder could hold the turn for good — 2 s without output / 3 s flush = error; (3) a frame the canvas cannot draw never led to the fallback — counted; (4) colours said only by `colr nclx` were lost — passed to the decoder; (5) WebKit plays leading empty edits — added there; (6) `whenSettled` could hang when a drag over the cache ended on the player's own frame — `settleWait`; (7) an adopted cache kept the bar's / track's duration — takes the player's; (8) parser: `n` bounded by stts, `co64` / sample entry by the box's own type, mirrored matrix → fallback. Also from it: a finger resting mid-drag kept the 640 px JPEG — the player now seeks after 250 ms of rest. Left: the hold mirrors with the old clip's mirror and ignores turn / zoom (as the canvas hold did); open GOPs whose sync samples are not IDR may fail three times and fall back.
- The same reviewer confirmed all nine fixes (its harness: VFR / CFR / sparse clips, every frame, no empty part, nothing dead) and raised low points, done after: a watchdog while the page is hidden is not counted, and errors count only in a row (a "done" part resets `wcFails`); an unknown colour name no longer costs WebCodecs (`isConfigSupported` retried without `colorSpace`); a rest on the frame the player already shows hides the cached picture; tkhd guard `m + 20`. Its last check confirmed these; a per-piece "must hold a frame" filter it suggested was tried and dropped (with `from` mid-hole it could hide a lone frame for good; unfiltered, such a piece only ends "short" once, cheaply).

## 0.96.0 — 2026-11-19 — Shift slows every drag, in every viewer
- **What:** stage 4 of `docs/PLAN-viewer-input.md`. Shift now slows the board's pan (middle / Alt+left) and right-drag zoom, Ctrl+Shift+wheel on a board, the 3D wheel and right-drag dolly, and the text viewer's middle-drag scroll and right-drag text size (×0.2), as it already did in the lightbox (0.95.0) and compare. One rule, in MANUAL and ARCHITECTURE.
- **Where:** canvas.js (pan / zoomdrag `drag.fine`, Ctrl+wheel `wheelDelta` + fine); index.html `bind3dZoom` (wheel / right-drag fine), `mountDocStage` (`panD.fine`, `ts.zoomD.fine`, `zoomFactorDrag`); MANUAL, ARCHITECTURE, PLAN.
- **Notes:** the anchored drags (board pan / zoom, text viewer) count the move that sees Shift change at the old speed and re-anchor after it — re-anchoring on that move dropped its step (a 25 px drag lost per Shift change in testing). A Shift+right press anywhere on the full-screen mesh-model canvas still turns the lights (its handler stops the press before the dolly sees it); Shift pressed after a right-drag has started slows the dolly. The board's plain wheel still pans (Shift = sideways, the browser's way); 3D orbit and OrbitControls' pan are not slowed. Compare's split drag still re-anchors on the Shift move (its old code, kept). This closes the plan: stage 5 (the HTML review page, its draw sheet and the phone app taking the same meanings) was dropped by the owner (2026-11-20) — those self-contained pages keep their own gestures (no Shift-fine there).
- Review (fresh agent): rebasing, signs and the board's right-click menu / plain-wheel pan / 3D lights all correct. Found: the board did not record Shift held at the press (the first move ran 5× too fast) — `fine: e.shiftKey` on both drags now; the MANUAL rule overclaimed ("every drag, everywhere") — reworded with its exceptions (board item drags, 3D orbit, the 3D preview's Shift+right = lights anywhere on a mesh canvas), ARCHITECTURE too. The 3D dolly is incremental, so the Shift-change move runs at the new speed (no jump).
- The same reviewer confirmed the fixes and found nothing new.

## 0.95.1 — 2026-11-19 — Board and 3D zoom use the shared zoom maths and finger tracking
- **What:** stage 3 of `docs/PLAN-viewer-input.md`. No visible change meant: the board (right-drag zoom, Ctrl+wheel, two-finger pinch) and the 3D viewer (wheel, right-drag, pinch dolly) now take their zoom factors and finger tracking from `viewer-input.js`.
- **Where:** viewer-input.js (`pinchTracker()` new — the module's own fingers use it too); canvas.js (`zoomFactorDrag` / `zoomFactorWheel`, the pinch on `pinchTracker`, incremental: zoom about the pair's previous middle, then pan by its move); index.html `bind3dZoom` (same helpers; `dolly(f)` takes a factor now).
- **Notes:** the board's left button, item drags, marquee, right-click menu (a right press without a 4 px move) and plain-wheel pan are unchanged — the board does not use `attachViewerInput`, only the helpers. 3D was already incremental and stays so; it keeps its pinch speed (finger ratio ^ zoomSpeed; the 2D pinches ignore zoomSpeed). The board's pinch now goes on with the remaining pair when one of three fingers lifts (it stopped). The 3D Ctrl / Shift right-drags (mesh path) are untouched. Next: stage 4, Shift slows the board / 3D drags.
- Review (fresh agent): the maths matches the removed code (board right-drag / Ctrl+wheel, 3D wheel / right-drag / pinch, the module's pinch on finger add / lift). Found: the board pinch is now incremental, so at MIN / MAX zoom it turns back at once instead of the old dead zone (accepted, noted here); two redraws per board pinch move — now one. Left (as before): `bind3dZoom` drops a finger only on `el`'s pointerup / cancel, so a touch released outside it without capture stays counted.
- The same reviewer confirmed the fixes and found nothing new.

## 0.95.0 — 2026-11-19 — Lightbox 2D viewer on the shared input module: touch pinch, left-drag pan on pictures
- **What:** stage 2 of `docs/PLAN-viewer-input.md`. The lightbox's image / PSD / video viewer (`attachViewer`, also the 3D UV pane) takes its pointer input from `viewer-input.js`, like Compare. New for the user: **two-finger pinch-zoom / pan** on pictures and videos, **a left drag (one finger) pans a picture** (it did nothing), Shift slows pan / right-drag zoom / the wheel (×0.2). Unchanged: click a video = play / pause after 250 ms, double-click = Frame ↔ 100 %, left drag scrubs a video (window width = the clip, Shift ×0.1), Alt-drag turns a picture, Alt-drag scrubs a video and Ctrl+Alt-drag turns it, middle pans, right drag / wheel zoom, digits 1–9.
- **Where:** index.html `attachViewer` (the click / dblclick / pointer / wheel listeners, `clickTimer`, `justScrubbed`, `vs.panD / zoomD / rotD / scrubD` replaced by one `attachViewerInput(wrap, …)`: Alt turn = `claim`, scrub = `beginScrub` / `seekVideo` / `endScrub`, a sequence hands over to `seqScrubBegin` in `scrub.begin`; returns `destroy`), `fillStage` / `closeLight` (destroy `stage._vinput`); viewer-input.js (presses on inputs / textareas / contenteditable are left alone; window touch listeners only while a finger is down); MANUAL, ARCHITECTURE, PLAN.
- **Notes:** the module is attached before `annot.bind2d`, so its second-finger capture hook runs before the annotator's capture `onDown` on the same `.view`: a pinch while drawing drops the stroke (`annot.abortGesture`). The click is decided on pointerup, so while annotating a press the annotator keeps no longer plays / pauses via a stray `click` event. A sequence scrub stays claimed in the old viewer with no-op `to` / `end` until release (its window listeners run it across cuts). The text document viewer is left out (left button = text selection). Next: stage 3 (board and 3D zoom use the exported factors / a pinch helper).
- Review (fresh agent): a second finger did not stop a sequence picture scrub (pinch and scrub together) — `seqScrubBegin` now registers `light.seqDrag {pid, end}`, ended by `abortOthers` and `closeLight`, and a press on a later clip's viewer while one runs stays dead; closing mid-scrub re-pinned the server's RAM window to the closed clip — `closeLight` destroys the input before `releaseMedia`; the UV pane's input was not destroyed when the pane went (`syncUvPane`, "No UVs") — fixed; a prevented press kept focus in a field elsewhere (Space / digits went there) — the module blurs a focused field outside `el` on a plain left press (as the browser did; middle / right / Alt presses keep a half-typed reply open). Accepted: a triple-click on a video toggles on the third click; right-drag zoom is incremental, so past the max scale it zooms out at once on the way back; a mouse release lost outside the browser leaves `seqDrag` set until the next pointerup (a new press stays dead meanwhile).
- The same reviewer confirmed every fix (blur narrowed to a plain left press without Alt after its note) and found nothing new.

## 0.94.2 — 2026-11-19 — Shared viewer input module; Compare runs on it
- **What:** stage 1 of `docs/PLAN-viewer-input.md`. New `app/static/viewer-input.js` (`attachViewerInput`, `zoomFactorDrag`, `zoomFactorWheel`, `wheelDelta`): the press / click / drag decision, the 250 ms click hold, Shift-fine, right-drag / wheel zoom maths, pan, pinch, pointer capture and its retake, window fallbacks. Compare's picture input now goes through it; the behaviour is meant to be unchanged (click, double-click, scrub, split, zoom, pan, wheel, touch tap / scrub / pinch).
- **Where:** viewer-input.js (new); compare.js (`bindStageInput`, `splitDrag`, `liveBox`; `startScrub` split into `scrubBegin` / `scrubTo` / `scrubEnd` — the timeline keeps its own absolute drag; `onDown` / `onMove` / `onUp` / `startPinch` / `onWheel` / `touches` / `C.clickT` / `C.drag` / `C.onScrubEnd` gone); index.html cmp host `abortAnnot`; ARCHITECTURE, PLAN-viewer-input ("As built").
- **Notes:** callbacks are incremental (`pan` px, `zoom` factor about a client point), `scrub.to(frac)` cumulative. A second finger is caught in the stage's capture phase: it now also drops a stroke the compare annotator's first finger began (`abortGesture`) — before, the box-level annotator kept the first finger and the pinch did not start while drawing. A mouse move with no buttons ends a drag (not after a capture loss in it). Next: stage 2, the lightbox's `attachViewer`.
- Review (fresh agent): no high-severity bugs; a stage press while a timeline scrub ran panned the picture (now a dead claim); a throwing end in `destroy` could leave window listeners (try/catch); a double-click between tiles no longer fitted (`dblclick` is not gated by `canStart` now); PLAN stage-1 text fixed. Left: a buttonless mouse move ends a drag unless capture was lost first (per spec capture loss comes first — check the 0.92.1 overlay case on Windows); a finger on an annotator control inside the box counts toward a pinch (stage 2 note); `close` mid-scrub runs `scrubEnd` on media about to be released (harmless).
- The same reviewer confirmed every fix and found nothing new (side effect: a tap on the stage during a timeline scrub no longer toggles play — intended).

## 0.94.1 — 2026-11-19 — Annotation select tool: Ctrl / Shift as in the library grid, 2D too
- **What:** owner: Ctrl in the select tool works as in the main window — Ctrl+click toggles a drawing, Ctrl+drag draws a box even when it starts on a drawing and toggles what it covers; Shift adds (Shift+click, Shift+drag on empty space, Ctrl+Shift+drag). Now in 2D as well as 3D (0.94.0 had limited it to 3D).
- **Where:** annotate.js select branch of `onDown` (the Ctrl marquee no longer gated to `model3d`; a Shift+click on a drawing adds, it used to toggle; the empty-space box clears unless Shift, `toggle: false`), cursor (`S.ctrlHeld` → default everywhere), the select hint; MANUAL.
- **Notes:** a Ctrl+press on a drawing no longer toggles-and-drags it (a Ctrl+drag is a box, as in the grid); to move a drawing, drag without Ctrl. Ctrl stays the momentary eraser only for the drawing tools (`effTool`). Compare's `wantsPress` claims Alt / a finger on a split only, so Ctrl never reaches compare.
- Review (fresh agent): no regressions (Ctrl / Shift / Alt combinations, baked items, boards, compare, the eraser, touch); a Ctrl+click on a selected small drawing or a line's end hit its handle and did nothing — a Ctrl-press (without Shift) now skips the handles; MANUAL wording tightened. Left: the cursor follows Ctrl only on a mouse move, and Cmd on a Mac boxes without changing it (cosmetic, as before in 3D). The same reviewer confirmed the fix and found nothing new.

## 0.94.0 — 2026-11-19 — 3D annotation select tool: Ctrl+drag box select, Box switch for touch
- **What:** merged the never-merged branch `ccr-90d2f55f-eyeipr` (its "0.83.0", numbered then, before master moved on). Select tool while annotating a 3D model: Ctrl+drag draws a selection box even when it starts over a drawing (Ctrl = toggle against the selection it started from, Ctrl+Shift = add — as in the library grid / board); a Ctrl-click without a drag toggles the drawing under it. In 3D a plain empty-space drag still orbits; Ctrl+drag box-selects, and a *Box* switch in the select tool's bar (3D only) makes a plain drag box-select — the touch way. A Ctrl-click on empty space in 3D still picks the model's mesh.
- **Where:** annotate.js (select branch of `onDown`: Ctrl → `S.drag.marquee` with `hit` / `boxed` / `pid`; `S.box3d`; `onMove` 4 px click threshold; `onUp` Ctrl-click toggle, 3D empty Ctrl-click → `S.b3.pickMesh`; second-finger guard; `lostpointercapture` ends a stuck marquee; cursor; `renderProps` Box button + hint); index.html (`pickMeshAt(cx, cy, ctrl)` in boot3d, passed to `bindAnnot3d(…, pick)` → host `pickMesh`, absent for splats); MANUAL.
- **Notes:** owner: **3D only** — 2D needs no Ctrl box mode (no orbit on a drag: a plain drag on empty space is the box), so the branch's 2D change (Ctrl+press on a drawing = box, Ctrl+Shift = add) was dropped; in 2D Ctrl still toggles a drawing on click and a Ctrl box on empty space toggles, as before. The 4 px click threshold and the pointer-tied marquee apply in 2D too (harmless). The annotator grabs the Ctrl press, so the 3D viewer never sees it — hence the explicit `pickMesh` hand-back. A marquee is tied to its pointer: a second finger is ignored, so pinch-zoom is off while *Box* is on. `S.box3d` is per session. **Not merged from that branch:** its "0.83.1" (3D drawings shown only while a note is picked, loose ones hidden then) — master had since made 3D drawings show while watching (`shownOff`), so those hunks (`modeAllows`, `L.root.hidden`, the pick `renderAll`) were dropped in the merge. The branch's own review (4 findings, fixed there) came with it.
- Review of the merge (fresh agent): every box-select hunk present and in scope against today's code (`pickMeshAt` / `bindAnnot3d`, splats pass no pick), no 0.83.1 hunk left, 2D equal to before apart from the 4 px click threshold, no interaction with compare / board / Ctrl eraser; it caught 0.83.1's ARCHITECTURE text still staged in the index — fixed before the commit. Left: Cmd+drag on a Mac does not switch the cursor (cosmetic).

## 0.93.1 — 2026-11-19 — Compare: a double-click no longer toggles play twice; plan for a shared input module
- **What:** a click on the compare picture now waits 250 ms before play / pause, as in the lightbox, so the second click of a double-click (fit) cancels it. New `docs/PLAN-viewer-input.md`: today every viewer (lightbox 2D, sequence, compare, board, 3D zoom, annotator, phone / HTML page) has its own pointer code; 0.93.0 wrote the compare's anew. The plan specifies one `viewer-input.js` module (click hold, scrub / pan / zoom / pinch, Shift-fine, capture handling) and the stages to move each mode onto it.
- **Where:** compare.js (`onUp` timer `C.clickT`, `dropClick`, stage `dblclick`, `close`); docs/PLAN-viewer-input.md (new), docs/PLAN.md (link).
- **Notes:** `dropClick()` runs in `togglePlay` (Space / ▶ while a click is pending would otherwise be undone 250 ms later), `startPinch`, `pause` and `seekLayer` (the annotator stopping / moving the clock), and a scrub start. Two quick clicks within 250 ms do nothing (the lightbox would toggle once) — `pointerup.detail` is not reliable enough to copy its test; left. The lightbox's 2D viewer has no touch pinch today: the plan's stage 2 gives it one.
- Plan review (fresh agent): several facts were wrong or missing (the embedded viewer is the 3D UV pane; the board's wheel pans; 3D dolly is incremental with its own pinch maths; the annotator / board second-finger ordering; lightbox video touch already scrubs; no teardown in `attachViewer`; the doc viewer) — corrected; the same reviewer re-checked, its last three wording items applied.
- Review (fresh agent): correct; Space / ▶ / a pinch / the annotator's pause within the 250 ms could be undone by the pending toggle — fixed with `dropClick`; the same reviewer confirmed it and found nothing new.

## 0.93.0 — 2026-11-19 — Compare: viewer-style picture input, Row fixed, viewer's top bar, Compare from the selection
- **What:** owner's list. (1) On the compare picture a click plays / pauses, a left drag scrubs every clip, a right drag zooms, a middle drag pans — as in the viewer; a swipe split is grabbed only by a press right on it (10 px, finger 24 px), so it no longer eats every click / drag. Touch: tap, one-finger scrub, two-finger pinch-zoom / pan. (2) **Row was black**: the stage got the class `row`, which is the sidebar's menu-row class (`display:flex; height: var(--menu-row-h)`), so every cell had 0 height. The layout class is now `lay-<layout>`. (3) The right end of the compare bar is the lightbox's: notes button (`C`, badge), eye (while drawing), the compare icon (on; closes), annotate as an icon, ✕. (4) Layer chips: click shows / hides (a layer brought back is selected), middle-click removes, the ◉ button is gone. (5) The offset's − / + buttons are gone: drag the number sideways to slide the clip live (6 px per frame), click it to type. (6) **Shift slows every drag** (scrub, timeline, zoom, pan, split, offset) and can change mid-drag without a jump. (7) A chip drag shows the whole chip (mouse: `setDragImage` of a clone; touch: a clone follows the finger). (8) With 2+ images / videos selected, *Compare* sits next to *▶▶ Sequence* in the top bar and the touch selection bar, and the right-click menu has *Compare (N)*.
- **Where:** compare.js (`startScrub` — the timeline's scrub, now shared with the stage —, `splitNear`, `layerAt`, `onDown` / `onMove` / `onUp`, `startPinch`, `zoomAt`, `hoverCursor`, `chipGhost`, offset drag in `bindUi`, the bar markup, CSS `lay-*`, `.cmp-ghost`); index.html (`cmpAnnot` host `notesBtn` / `eyeBtn` / `notesBtnShown`, no `readPanel: false`, `onView` always `cmpBind`, `C` routed to `cmpAnnot` while not drawing, `bindAnnoReset` on the compare's annotate button; `cmpCandidates` / `compareIds`, `#cmpSelBtn`, `#tsCmp`, ctx `cmp`); MANUAL, ARCHITECTURE.
- **Notes:** the scrub click detection is on pointerup (no move ≥ 4 px) — not the `click` event — so the annotator's own click suppression is not involved; while annotating, the annotator's capture `onDown` keeps the press unless `wantsPress` (Alt+left: the nearest split at any distance; a finger on a split). Images only: a left drag pans (nothing to scrub). A second finger cancels a running scrub by dispatching `pointercancel` for its pointer on window (startScrub's own end path). The compare annotator now fetches the selected layer's notes on every selection (for the badge / reading panel), not only while drawing; `showWhileWatching` stays false, so drawings and the eye still show only while drawing. The notes panel state is the lightbox's (`sight.annotate.read`). `[` / `]` keep `Shift` ×10 (keys, not a drag). Selecting a layer: a press on its tile / swipe region, `↑` / `↓`, or a chip click that shows it.
- Review (fresh agent): the touch map outlived a closed comparison (a finger down while it closed made every later tap a pinch and froze the stage); while annotating a chip click hid the layer instead of picking it (no other way to switch layer there); letting go of Shift during a timeline drag jumped to the pointer; a rebuild mid-drag (layout / H / D key) left zoom / pan / pinch on a detached box (NaN view); a chip repaint mid offset-drag killed it and let the closing click toggle the chip; offset padding click toggled; split cursor stuck while annotating. All fixed (`touches.clear()` in open / close and before the `!C` guard, annotating chip click selects, track stays relative after Shift, `d.box` re-queried, offset drag on window listeners). Left as is: a double-click on the picture toggles play twice then fits (net state unchanged, as in the viewer).
- The same reviewer confirmed all fixes; its one optional nit (a mouse released outside the window mid offset-drag kept sliding) is fixed too.

## 0.92.2 — 2026-11-19 — Review import: no blocking dialog, no lightbox hidden under Compare
- **What:** owner: after dropping a review file onto the desktop app, thumbnails stopped appearing and clicks in the sidebar did nothing. Not reproduced in Playwright (single file / bundle / re-import / filtered grid / Tab split / Sequence / Compare / large videos — the server stayed responsive), but two causes in the import path fit. (1) The "Restore deleted notes?" question was a native `confirm()`: it blocks the whole page, and after a drop from the file manager the app window has no focus, so the dialog can sit unseen. It is now a non-blocking bar at the top of the window (*Restore* / ✕, closes itself after 15 s, a hover keeps it); the first merge is reported and the file opens before it shows. (2) A review dropped while Compare was open opened the lightbox hidden under Compare, with drawing mode on, and its video took the compare's RAM windows. The lightbox annotator's `openAsset` now closes Compare first, as the compare annotator's already did.
- **Where:** annotate.js `importFile` / `importedResult` (new, the toast + open of one pass) / `offerRestore` (new, `.an-offer` CSS) / `importedBundle(r, restored)`; index.html `annot` host `openAsset` (`cmp.close()`); library.py `match_review_asset` (a size the file gives as a non-number, or a library row without a size, no longer raises: was a 500 for a plain package); MANUAL.
- **Notes:** every import answer carries `at` (server ms before the merge); Restore flushes pending edits and posts `?restore=1&before=<at>`, so only rows deleted up to the first pass come back — one deleted here while the bar was up stays deleted (`Library.import_annotations(restore_before=)`, Sight only, not in the JS port). Do not build that query with `| 0`: a ms timestamp overflows int32. The restore pass calls `host.openAsset(id, {keep: true})`: Compare closes, but the file already showing is not opened again (that would restart its viewer); from the compare's annotator the lightbox re-reads its notes. Its toast says *Restored from the review file*. The two passes are reported in two toasts now, not summed into one. The bar lives on `document.body` (z-index 130, above the lightbox 50 and Compare 60) and stops pointer / key events from reaching the page under it. Other native `confirm()` calls (remove a folder, remove missing files, reset settings, restore shipped filters, the HTML page's discard-drawing) are left: they come from a click inside the window, which has focus.
- Review (fresh agent): Restore could revive a row deleted after the first pass (the bar stays up, no flush); Restore with Compare open over the lightbox switched drawing on under the overlay and left Compare's view stale; Restore after an import from the compare's annotator restarted the lightbox viewer. Fixed (`restore_before` / `at`, `flush()`, `openAsset` `keep`); test `test_restore_only_rows_deleted_before_the_first_pass`. The same reviewer confirmed all three fixes and found nothing new.

## 0.92.1 — 2026-11-19 — Compare keeps every clip on screen, and a scrub no longer sticks
- **What:** in Compare, every clip's picture keeps moving while they play, and a timeline drag no longer drops a red blocked-media mark and freezes. Until a scrub copy can show a frame, the picture stays where it was and every clip jumps to that frame together when you let go (a clip you have dragged past shows its last frame, and one the playhead has not reached shows its first). Once the copy is ready, the drag follows it, and that decoder is closed again when the full file takes over.
- **Where:** compare.js (`armScrubs`, `releaseScrubDecoder`, `syncVideos`, `queueRelease`, the timeline pointer handlers, `.cmp-m`).
- **Notes:** a plain `<video>` on Windows is promoted to a hardware overlay. Only a couple of those exist, so the clips that do not get one keep their old picture until playback stops, and in Column the overlay lands on the timeline and cancels the drag. `.cmp-m` uses `clip-path: inset(0)` so every compare clip stays on the normal compositor. The dim on a clip outside its span is not changed while the pointer is down (putting opacity back to 1 promotes it and cancels the drag). Losing pointer capture mid-drag is not a release — capture is taken back, and the drag ends on pointerup. The scrub element has no `src` until the drag starts, and the src is removed when the proxy is hidden, so those decoders are not held during playback. While the proxy cannot show a frame, the full file is not seeked on the way down. Letting go seeks every clip once: one the playhead has left goes to its last frame, one it has not reached goes to its first. The proxy stays up until that frame is presented (hiding it on pointer-up flashed the pre-drag picture and kept the decoder). Closing Compare during a drag removes the window listeners that finish it. The RAM byte cache, the scrub mp4 and scrub audio are unchanged.
- Review (fresh agent): an out-of-span proxy was hidden before the full file presented the edge, a clip the playhead had not reached snapped back to its old frame, and closing Compare mid-drag leaked the window listeners. Fixed (`clipLocal`, `atPlayhead`, `queueRelease`, `close`). The same reviewer confirmed the fix and found nothing new.

## 0.92.0 — 2026-11-19 — Compare scrubs every clip from a short-GOP proxy
- **What:** dragging the compare timeline seeks each clip's small scrub copy (a keyframe every few frames), made as soon as the comparison opens, so several clips follow the pointer together. Until a copy is ready, that clip is still seeked, but only one seek at a time, so a slow clip keeps its last frame. Letting go seeks the full file once and the proxy stays up until that frame is on screen.
- **Where:** compare.js `ensureScrubs` / `pumpTime` / `wantTime` / `settleScrub`; library.py `SCRUB_PARALLEL` / `_encode_copy` / `_stop_scrub_procs`; tests/test_playback_copy.py; MANUAL, ARCHITECTURE.
- **Notes:** up to 3 scrub encodes at once (decode, scale and encode each capped at 2 threads). A playback copy still goes first and stops every running scrub encode; those jobs start over. Letting go queues the release time even when a seek is already in flight, so an older `seeked` cannot take the proxy down. Clips under 3 s are skipped, same as the lightbox. The proxy is shown only during the drag, after it has landed on that drag. Difference tiles paint from the proxy while it is the picture on screen. The RAM byte cache is unchanged. The phone scrub cache is unchanged.
- Review (fresh agent): while playing, a full-file seek still in flight when the proxy became ready hid the proxy on that older frame. Fixed (`queueRelease`, `settleScrub` only once the primary is on the playhead). The same reviewer confirmed the fix and found nothing new.

## 0.91.1 — 2026-11-19 — Scrub audio plays from a PCM cache
- **What:** sound while scrubbing no longer stutters. A drag used to `play()` the video for 90 ms at each position, so every move waited on that seek (the scrub copy has no audio). Sight now extracts the clip's audio once to a mono 16-bit PCM cache and plays slices of it while the picture scrubs; a slow drag hears the sound continuously, a jump starts at the pointer.
- **Where:** library.py `start_scrub_audio` / `scrub_audio_path` (file `thumbs/video/<aid>_<stamp>.scruba.pcm`, 22050 Hz mono s16le); server.py `POST/GET /api/video/scrub-audio`; index.html `scrubHear` / `saPlay` (replaces `scrubBlip`); tests/test_playback_copy.py; MANUAL, ARCHITECTURE.
- **Notes:** the cache is built when scrub-audio is turned on or a clip opens with it already on (`Caching sound for scrubbing…` only while an extract is actually running). A clip with no audio track is remembered as `silent` until the file changes. The player stays paused during the drag — nothing sets `_blip` anymore. The PCM is not in the scrub mp4 and not in the RAM byte window: those seeks were the stutter. Playback copies still go first on the video encode slot; this extract has its own one-at-a-time slot and may run beside a scrub-copy encode. Kept like scrub copies: newest 20 files / 1 GB, and the one just made. The phone app has no scrub-audio toggle, so it is unchanged. Windows Int16 is little-endian, matching `s16le`.
- Review (fresh agent): playback-copy cleanup treated `.scruba` as a playback file and deleted it (a locked `.part` could also fail the transcode); a probe with no stream list was stored as `silent` and never retried. Both fixed (`_video_cache_kind`, banner needs `Input #`); the same reviewer confirmed them and found nothing new.

## 0.91.0 — 2026-11-19 — Phone: Settings → Debug log, sent as a file
- **What:** owner: a debug option in Settings that collects data to send as a file, not a screenshot. Settings →
  *Debug log* On / Off; *Send debug log…* shares / downloads `sight-debug-YYYYMMDD-HHMM.txt` (a header with the
  device and app, then one JSON array per line `[ms, event, data]`); *Clear*. Off stops recording but keeps the
  data (Send still works); only Clear deletes it.
- **Where:** mobile/js/debug.js (new: `dbg.log / set / flush / clear / text / sample / info`); hooks in
  mobile/js/media.js (`turn`, `poke`, `c.plan`, `c.open`, `c.part` — part, rate, seek ms, frames got vs
  presented, gaps, why it ended —, `c.busy*`, `c.dead`, `c.release`, `c.broken`; caches get a `tag`) and
  mobile/js/app.js (`dbgPlayer`: play / playing with the delay since the tap, waiting, seeking / seeked ms;
  stage `ptr.down` / `click`, `tap.play`; a `sample` each second: playhead, player, every cache's runs; Settings
  section); index.html (margin rule); MANUAL, ARCHITECTURE.
- **Notes:** `dbg.log` is a no-op while off. Memory: ≤ 15,000 lines and ≤ 6M characters (pre-built JSON strings).
  localStorage `sight-review:debugLog` = `{sessions: [{started, ev}]}`: the earlier saved sessions plus this one
  (≤ 4), newest lines first within 1M characters, written every 15 s, ≤ 2 s after an error / `v.error` /
  `c.broken` (one save per 2 s: a burst of errors must not write the tail each time), at once when the page is
  hidden; the old value is removed first (a failed write never leaves stale data), half the budget on a full
  storage. The file shows them as "# earlier session" blocks. Two tabs recording at once overwrite each other. The first look at a log already showed a real bug: a WebM's frame rate is a
  guess (25) until known, so the fill ran at 60 / 25 = 2.4× on a 30 fps clip and dropped a frame in four; the
  rate now uses the shorter of the guess and the measured step (in 0.90.2 below).
- Review (fresh agent): a failed save left an older tail shown as the previous session; a foreground crash lost
  everything since the last hide; Off deleted the log with no way to send it; memory unbounded per event; a stale
  `sinceTap`; Settings margin — all fixed. Re-checks by the same reviewer found a save per error in a burst and
  the earlier session lost after a restart — both fixed; the third re-check confirmed everything (Playwright:
  quota, reloads, old format, error bursts).

## 0.90.2 — 2026-11-19 — Phone scrub cache: one window across the cut, the player first, every cached part on the strip
- **What:** owner (on the phone, after 0.90.1): tap-to-play lagged up to 4 s even with a full cache; the green strip
  lost the old cache on a jump and showed nothing new while the playhead stood; the fill looked like 30 / 70, not
  70 / 30; behind the playhead it filled towards it. Measured in Playwright first (a 60 s + 20 s sequence, the
  cache sampled each second), which showed: (1) the strip drew only the unbroken run around the playhead, and the
  2× fill drops frames, so that run stayed tiny until the holes were sought one by one; (2) the open clip filled
  its whole window, far behind included, before the next clip got a frame — so in a short clip near its end the
  left side won; (3) a move of the playhead under 2.5 s did not re-target the fill; (4) behind parts of 2 s
  played forwards. Now: the strip draws every cached run (gaps ≤ 3 frames ignored); caches take turns by the
  cost of their next part (distance from the playhead in the sequence, behind × AHEAD / (1 − AHEAD), + the
  range's `base`), the owner yields only to a part cheaper by 3 s; a `from` move is taken at once; behind parts
  are 1 s; while a play starts (until `playing` + 300 ms), the player seeks, or it stalls, no cache fetches
  (`ScrubCache.busy`), and `ScrubCache.poke()` on the player's `play` / `seeking` stops the running part at once.
- **Where:** mobile/js/media.js (`costOf`, `turnPick`, `turnWanted`, `TURN_HYST`, `isBusy`, `ScrubCache.busy /
  poke / wb`, `want` in-place `from` / `base`, `job.held` / `jolt`, `nap`, `stopPart`, `runs(gap)`, the `dead`
  rule, the fill rate); mobile/js/app.js (`cacheFocus` bases, `playPend`, `ScrubCache.busy` hook, `paintCache`
  draws all runs); mobile/index.html (`.tl .cache` is a container of `<i>` runs); MANUAL, ARCHITECTURE.
- **Notes:** tried and rejected: filling at ≤ 40 presented frames/s and patching holes by slow replay — in
  Chromium coverage grew three times slower than 2× + frame-by-frame seeks; the dropped frames are hidden on the
  strip instead. A part is cut only if it held `from` when it began and `from` left it (a playing clip moves
  `from` every frame); jumps / scrubs stop it via `poke`. A cut part (moved / busy / poke / yield / replan /
  closed) is never marked `dead`. Never end a part on the player's `pause` event: the one fired for the previous
  part's own pause arrives later and killed the next part at once. Still a hypothesis on the phone: the play lag
  came from the hidden player decoding next to the visible one — the debug log (0.91.0) will show `sinceTap`.
- Review (fresh agent): a late `pause` event ended every second part; `jolt` cut nearly every part while playing;
  cut parts were marked `dead` for good on clips that fit the window; the idle release never fired while playing;
  busy / jolt unchecked before the first seek / play; `close()` held the turn up to 1.5 s — all fixed, each
  confirmed by the same reviewer with its Playwright repros.

## 0.90.1 — 2026-11-19 — Phone: the open clip's scrub cache no longer loses the decoder to a neighbour
- **What:** owner: in a 2-clip sequence the open clip got no cache at all, the neighbour got all of it. Cause (most
  likely, seen on Android): a neighbour's cache that yielded the turn (or sat idle / parked) kept its hidden
  `<video>`; with the visible player that is three decoders, the open clip's hidden player failed to open and
  `open()` marked the cache `broken` for good. Now only the cache holding the decoder turn keeps a hidden player.
- **Where:** mobile/js/media.js — turn queue (`openCaches`, `turnPick` releases every other cache's player),
  `ScrubCache.open` (a failed open retried after 1.5 s / 3 s, `broken` after 3: deadline `openAt` with its own
  `openT` / `openOk`, not `wake`), `Grabber` (player given back 3 s after its last grab); mobile/js/app.js
  `loadedmetadata` (a pooled `broken` cache is not adopted, a fresh one is made).
- **Notes:** each turn handoff now reopens the other cache's player (a reload, a few hundred ms) — accepted, phones
  have few hardware decoders. The retry wait must not use `wake`: `resolve()` fires on every scrub and would burn
  the 3 tries in under a second. Not reproducible in desktop Chromium (no decoder limit); `test_seq_bar` passes.
- Review (fresh agent): confirmed the cause; found a stale `retryT` and `resolve()` cutting the retry wait short,
  adoption of a broken neighbour cache (same symptom), and the Grabber's player as a third decoder — all fixed and
  confirmed by the same reviewer.

## 0.90.0 — 2026-11-19 — Desktop RAM cache like the phone's: outwards from the playhead, across cuts; ahead share in Settings
- **What:** owner: the desktop cache should work like the phone's, with 70 / 30 instead of 60 / 40, and the share
  in Settings on both. Desktop: the RAM window now loads outwards from the playhead (behind blocks interleaved,
  not after all of the ahead part), and in a lightbox sequence the part past a clip's end goes to the next clip's
  start, before its start to the previous clip's end (loop on wraps) — a cut either way reads from RAM, and the
  hidden preload `<video>` of the next clip is served from it. Settings → Video → *Cache ahead* (50–90 %, default
  70) on the desktop, Settings → *Cache ahead* (50–90 %) in the phone app; the phone default is now 70 too.
- **Where:** app/library.py `SlidingVideoCache` (`_Window.ranges` / `wants`, `_plan`, `configure(mb, ahead)`,
  `focus(path, pos, next, prev)`, `focus_many`, `_missing` costs), app/server.py `/api/video/focus` (`ahead`,
  `next`, `prev`), app/static/index.html (`clampAhead`, `videoAhead` theme key + slider, `pushVideoFocus`
  neighbours, `seqToggleLoop` re-push, host `cacheAhead`), app/static/compare.js (sends `ahead`),
  defaults.json; mobile/js/app.js (`AHEADS`, `setCacheAhead`, settings sheet), mobile/js/media.js `AHEAD` 0.7,
  mobile/index.html; tests/test_video_cache.py (new); MANUAL, ARCHITECTURE.
- **Notes:** the ahead share is server-wide state (like the budget): every focus post carries it, so the saved
  value applies from the first video after a restart. The compare keeps one window per clip and no neighbours.
  The playhead's byte is still `size · t / duration` (no byte↔time index), so the windows are approximate in
  time on VBR files, as before. The phone setting is per device (`localStorage`), not synced with Sight.
- Review (fresh agent): no correctness bugs; three minor ones fixed — a neighbour shorter than the overflow
  wasted the rest of the window (now it goes to the other side of the playhead, desktop and phone); a short
  2-clip loop partner listed blocks twice (`_missing` dedupes, the two ends share one cap); the phone's fill
  weighted behind by a fixed 1.5 (now `AHEAD / (1 − AHEAD)`, like the desktop). Confirmed by the same reviewer
  (20,000 random plans: every range inside its file, no block twice, budget fully used, playhead inside).

## 0.89.0 — 2026-11-19 — Phone: the scrub cache follows the playhead, 60 / 40, across sequence cuts
- **What:** owner: on the phone the cache always started at the clip's start, not at the playhead; near a clip's
  end it must run on into the next clip so the cut is seamless both ways; 60 % ahead / 40 % behind. Now the
  scrub cache is a window of ~1,500 frames around the playhead, filled outwards from it (forward first, a
  second behind weighted 1.5×) and sliding with it; in a group's sequence the overflow past the end goes to
  the next clip's start, past the start to the previous clip's end (loop on wraps), each as that clip's own
  cache, taken over at the cut. The green strip shows the cached run around the playhead (no longer 0 → x).
- **Where:** mobile/js/media.js `ScrubCache` (rewritten: `want`, `next`, `run`, `open`, `fetch`, `span`, turn
  queue `turnTake` / `turnGive`); mobile/js/app.js `cacheFocus`, `scrubPool`, `closeReview(park)`, adoption in
  the video `loadedmetadata`, `paintCache`; tests/pwa_e2e.cjs `seqbar` + test_pwa.py `test_seq_bar`; MANUAL,
  ARCHITECTURE.
- **Notes:** budget is frames (`MAX` × the clip's frame length), not bytes; one hidden player per cache, but they
  take turns on the decoder (current clip first) and an idle one gives its player back after 3 s. The cut
  itself is still one `openReview` (the player is not preloaded, as Sight's adopt does) — the held frame plus
  the adopted cache cover it. Desktop checked, not changed: `SlidingVideoCache` (library.py) is a byte window
  around the playhead, 72 % ahead (`AHEAD`), loading all of the ahead part before any of the behind part, for the
  open clip only; a lightbox sequence preloads the next clip's start through a hidden `<video>`
  (`seqPreload`, the browser's own buffer, not the RAM window) and nothing of the previous clip.
  `tests.test_pwa` `test_touch` fails before this change too (a `.click` on an undefined element).
- Review (fresh agent): a one-frame hole next to the playhead was split at `from` into two halves too short
  to seek into, both marked dead for good (the clip's last frames never cached; flaky test) → holes ≤ 6 frames
  are fetched whole, dead parts are retried after 1.5 s / 3 s, play stops at the last frame; a neighbour got
  the decoder after every chunk of the open clip → the turn is kept while there is work; 60 fps clips at
  1.5× lost every other frame → rate capped at 60 presented fps; an evicted-and-retaken frame leaked a blob
  URL → per-take token; a neighbour with no kept file re-read IndexedDB on every repaint → `scrubPoolMiss`;
  parked caches kept decoding after a cut to a clip without its file → pool cleared. Re-review found the
  retry timer re-arming every 50 ms on past entries → only future entries count, a successful retry
  clears its mark. All confirmed by the same reviewer.

## 0.88.1 — 2026-11-18 — Drawing canvas: tools over the transport, tools row scrolls by drag
- **What:** owner: the drawing tools sat under the video transport, and on a narrow phone some icons went off the
  edge. Now the tools row is the bottom bar's top row (over the host's footer / transport), in one line; when it
  does not fit it scrolls sideways by a drag (finger, pen or mouse), centred while it fits. The colour button
  stays at the right end.
- **Where:** app/static/review-draw.js (`dragScroll`, `.dtrow` inside `.dtools`, bar order, CSS) — shared by
  the phone app and the HTML review page; tests/pwa_e2e.cjs `seqbar` end + test_pwa.py `test_seq_bar`.
- **Notes:** `.rd-panel` is `touch-action: none`, so the scroll is done in JS, not natively. Past 6 px a drag is
  the scroll's: the pressed button gets a synthetic `pointercancel` (cancels its 550 ms hold), open flyouts
  close, the click after a mouse drag is eaten. Flyouts still open above the whole bar (now above the tools).
- Review (fresh agent): touch / pen drag stopped after the first move (the button's implicit capture moving to
  the row fired `lostpointercapture` that ended the drag) → ignored unless on the row itself; a mouse released
  outside the row left the drag stuck → cleared on a buttonless move; a leftover `eat` swallowed one keyboard
  click after a touch drag → cleared on the next task. The test now asserts the full scroll. Confirmed by the
  same reviewer.

## 0.88.0 — 2026-11-18 — Phone: the sequence bar under the timeline, title swipe between clips
- **What:** owner: like Sight, a group's videos should play and scrub across the cuts, not one by one. A review
  whose group has 2+ videos now has a bar under the clip's own timeline with every video as a segment (name, current one
  highlighted, note / drawing ticks, playhead across all); tap / drag it to move through the whole sequence,
  playing runs on into the next clip (loop: the first after the last), a scrub on the picture past a clip's
  edge carries on into the neighbour, the last frame is held until the next clip shows. Swiping the header's
  title sideways switches clips (left = next) for any group, pictures and 3D included.
- **Where:** mobile/js/app.js (`bindTitleSwipe`, `seqInfo` / `seqLoad` / `seqGeom` / `seqAt` / `renderSeqBar` /
  `paintSeqPh` / `bindSeqBar` / `seqDragBegin` … `seqDragEnd` / `seqDragTo` / `seqSwitch` / `seqEnded` /
  `seqApply` / `seqHold*` / `seqStop`; `buildStage` video branch; `bindStage` scrub hand-over; `scrubDelta`
  (+ `scrubStep` wrapper); `openReviewNow` opts.seq, rate / clean carried; `setLoop`, `paintTime`,
  `paintMarkers`), mobile/index.html (`.sqb`, `.seqhold`, `.ttl.swipe`), tests/pwa_e2e.cjs `seqbar`,
  tests/test_pwa.py `test_seq_bar`, MANUAL, ARCHITECTURE.
- **Notes:** each clip is still its own review (notes, drawings, exports untouched); a cut = one `openReview`
  with `{replace, seq}`, so history stays one entry. Drags live on window listeners (`seqDrag`) because the
  bar / stage are rebuilt at a cut. Not done: preloading the next clip (Sight's seamless adopt) — a cut on the
  phone costs one open, hidden by the held frame. Pictures / 3D models are not on the bar (videos only); a clip
  without its file on the phone stays a dimmed segment and stops playback there. No cut while drawing or with an
  unsent note (`seqLocked`: the drag holds at the clip's edge, play stops at the end); ‹ › / title swipe /
  Page keys ask first when a draft would be lost. `ended` goes on only after real play (`R.playOn`: a paused
  seek to the very end also fires `ended`).
- Review (fresh agent): a cut dropped a drawing session / unsent draft → `seqLocked`; a touch drag lost its
  events on iOS once its target was detached → the target is moved into a hidden `.seqkeep` holder at the
  rebuild (`seqKeepTarget` in renderReview; first version moved it too early and blanked the held frame) +
  touchend safety net; paused seek to the end cut → `R.playOn`; hold not watched on a direct seek; a new
  pointer on the new stage mid-drag; panel / filter / hide reset at each cut → carried on `opts.seq`; geometry
  bounced at a cut when a length was guessed → frozen per drag (`seqDrag.G`); seqGo dropped drafts → asks
  (one dialog at a time: no ask while any sheet is open — a flag got stuck when the sheet was closed by its
  backdrop / Back); deleted-clip path repaints the header. All confirmed by the same reviewer.
- Checked (owner asked): scrub on the picture across the cut both ways, mouse and CDP touch, screencast of a
  test clip whose brightness tracks time: no black / blank frame, no flash of the wrong end of the next clip,
  the drag carries on at once (≈ 3–4 frames of held picture at a cut). Found and fixed there: the big Play
  button flashed over the picture at each cut → not added on a clip reached through the sequence (`seqPend`).

## 0.87.4 — 2026-11-18 — New row ids no longer collide on Windows
- **What:** two board cards (or boards, groups, collections, annotations) created in quick succession could get
  the same id on Windows and the second one failed with a UNIQUE constraint error (e.g. duplicating a card twice
  fast). Ids now include a random part. The intermittent `test_board_missing` failure was this bug.
- **Where:** library.py — the five `asset_id(f"<kind>:{time.time_ns()}:…")` generators (collections, boards,
  board items, board groups, annotations) now add `secrets.token_hex(8)`; tests/test_splash_win.py expects the OS
  spelling of the interpreter path (`str(Path("/x/python"))`) — the test, not the code, was wrong.
- **Notes:** Windows `time.time_ns()` has coarse resolution, so a timestamp is not a unique seed. These ids were
  never reproducible; the deterministic import remaps (`anno-import:…`) and path-hash asset ids are unchanged,
  and undo / merge pass the existing id. Full suite passes (87 tests).
- Review (fresh agent): no findings.

## 0.87.3 — 2026-11-18 — Sources: nested folders, clean removal, stale-view reset, connection pool
- **What:** user report "removing a source misbehaves" (two sources, ЛАЙТИНГ and Desktop: ЛАЙТИНГ → Desktop →
  × Desktop → ЛАЙТИНГ shows no previews; the source stays in the menu). Cause: ЛАЙТИНГ lies inside Desktop — not
  the Cyrillic name. Sources may now nest: a file belongs to the innermost source, the outer source shows it too,
  and removing either keeps the files the other still holds. Removing a source while it scanned / was watched left
  rows in All forever; no longer, and startup deletes old leftovers. Removal drops collection membership, asks for
  confirmation (× has no undo on touch), reports a failed DELETE, and resets a filter / cards / selection that
  pointed into it (also from another window). A hidden window gives up its event stream after 10 s (the browser
  allows 6 connections per host across windows) and catches up when shown. Paths compare regardless of Unicode
  form (macOS decomposed "Й").
- **Where:** library.py — `add_source`, `remove_source`, `_reassign`, `_source_scope`, `_nested*`, `_owner`,
  `scan_source` (`_src_gen`, `_scans_running`, nested roots skipped, locked flush), `_touch_one` / `on_moved`,
  `resume_watchers` (ownership fix-up + orphan cleanup), `sources()` (`own`), `normpath` (NFC), `disk_spelling`;
  server.py `/api/events` now an async generator (polls the queue; still ends on `Bus.CLOSE`); index.html remove
  confirm, `syncSourcesView`, `connectEvents` with visibilitychange; tests/test_sources.py (14 tests).
- **Notes:** invariant: a file row's `source_id` is the innermost source holding it — use `_source_scope` for "in
  source X", never a bare `source_id=`. Asset ids are path hashes (one row per file), which is why the inner scan's
  INSERT OR IGNORE used to leave rows on the outer source. Scan / watcher inserts are `INSERT … WHERE
  EXISTS(source)`; the flush checks the per-source generation under `self.lock`; a cancelled scan does not mark
  unreached files missing. Removal keeps thumbnail files on disk, board cards and annotations. Startup deletes
  orphan rows (the owner's library had 3 from a removed "Documents" source — found reading a copy of the DB).
  The old sync events generator held one worker thread per open window. Windows Cyrillic paths were fine
  everywhere checked. Not done: one shared stream for several visible windows; `_reassign` → `hidden()` reads
  `.obj` files under the DB lock; a vanished inner root is not re-checked. `test_board_missing` (intermittent
  UNIQUE id) and `test_splash_win` (path separator) fail on master already.
- Review (fresh agent, run by the implementing agent, three rounds): two medium nested-source edge cases (a
  running outer scan, the outer watcher applying its own rules) and a `flush()` race (check outside the lock) —
  fixed and confirmed; nothing new in round 3.

## 0.87.2 — 2026-11-18 — macOS: Dock icon back; Sight.app answers the Dock (real Cocoa loop)
- **What:** macOS: Sight.app keeps its Dock icon again and answers it. Clicking the icon brings the Sight window to
  the front, restores it if minimized, and opens it again if it was closed. Cmd+Tab to Sight focuses the window.
  Dock "Quit", Cmd+Q and the logout / shutdown quit stop the server cleanly and close the window. **Supersedes
  0.84.2's agent-app approach** (LSUIElement, no Dock icon), which the owner found inconvenient.
- **Where:** new app/macapp.py (`run`, `browser_pid_from_ps`, `find_browser_pid`); Sight.py `main()` mac branch
  (`_serve`, `_window_alive`, `_relaunch`, `_request_stop`, `_close_window`, `_on_server_exit`, `hb_lock`) and
  `_main_cleanup()` (`mac_agent_note()` removed); server.py (`/api/heartbeat?bye=1` → `app.state.window_bye`,
  `/api/events` ends on `Bus.CLOSE`); library.py `Bus.close()` / `CLOSE`; index.html `startHeartbeat` pagehide
  beacon; build_app_macos.sh (pyobjc-framework-Cocoa install + bundle check, LSUIElement removed,
  `NSAppleEventsUsageDescription`, `NSAppSleepDisabled` kept); tests/test_mac_launch.py.
- **Notes:** packaged macOS builds (not `--no-browser`) run NSApplication on the main thread and uvicorn on a
  background thread; without pyobjc it falls back to the old path and logs a line. AppKit exits the process
  itself, so main()'s `finally` never runs there: exit work lives in `_main_cleanup()` — never put cleanup only in
  `finally`. "Is there a window" = fresh heartbeat and no `bye` (Chromium on macOS keeps running windowless); the
  quit watchdog ignores `bye`, so F5 is safe. Dock reopen sends a "reopen" Apple Event only to Sight's own browser
  process (found by its `--user-data-dir` in `ps`), never the user's Chrome; may show a one-time Automation
  prompt; the ad-hoc re-sign resets that grant each build. Quit: `Bus.close()` ends every `/api/events` stream
  so uvicorn's 3 s graceful shutdown completes and `lib.close()` runs; a 10 s force quit (`threading.Timer` +
  `callAfter` — `callLater` does not fire while AppKit waits on the terminate reply) runs the same cleanup.
  Windows / Linux / dev unchanged (only a lock around the watchdog check). Known minor gaps: a second Dock click
  while a relaunched window is still loading can open a blank tab; with two Sight windows, closing one marks the
  app closed for up to 3 s. Not tested on a Mac.
- Review (fresh agent): 6 findings (quit hang at logout, force quit skipping cleanup, blank Chrome window on
  reopen after close, duplicate tabs without a Chromium browser, Automation consent text, watchdog / reopen race),
  fixed; second pass: 5 confirmed, 2 follow-ups (reopen still blank within 10 s of closing, Quit ending on the
  force timer without `lib.close()`) fixed; the same reviewer confirmed both, nothing new beyond the two gaps above.

## 0.87.1 — 2026-11-18 — Notes no longer lost when switching clips; durable annotation write queue
- **What:** user report (macOS desktop): comments written on a sequence's clips were gone after switching clips.
  Root cause: `setAsset()` / `unmount()` called the async `flush()` and then cleared `S.items` synchronously; after
  flush's first `await` the dirty rows were gone, so a debounced (300 ms) update — e.g. a reply / note edit
  committed by the blur when clicking towards the next clip — was silently dropped (reproduced; old code kept
  "original"). Failed writes were only `console.warn`ed. Now every row write goes through one durable queue: kept in
  localStorage until the server has it, retried, a red "unsaved annotation changes — retrying" badge (click / tap =
  retry) while it fails, sent with keepalive on close and at the next start.
- **Where:** annotate.js: module-level `OB` (`obPut` / `obDel` / `obDrain` / `obFlush` / `obOverlay` / `obForget` /
  `obAdopt` / `obBeacon` / `obPaint`), `serverCreate` / `stage` / `flush` / `serverDelete` / `settle`, `load()`
  overlay, `obForget` before the import / reload loads, CSS `.an-outbox`. ARCHITECTURE ("Saving"), MANUAL.
- **Notes:** invariants are in ARCHITECTURE ("Saving (the write queue)"): never write rows outside the queue; leave an
  asset only via `settle()` while `S.asset` is the old one. Landed writes stay 30 s in `OB.recent` and are laid over
  a GET row only if that row is older than the request (`updated_at < sentAt`, same-machine clock — a LAN client
  with clock skew would weaken this; comparing against the server-returned `updated_at` would be the fix). Storage
  key per window; adoption skips entries older than this window's landed write (`at` vs `landedAt`). Not done:
  queued rows carry no library identity (another SIGHT_HOME on the same port would get them as orphan rows); the
  HTML review page's localStorage quota problem (separate track). The browser logins reset the user also reported
  cannot come from Sight (own `--user-data-dir`, no access to the main profile) — not investigated further.
- Review (fresh agent, run by the implementing agent): round 1 — 10 findings (load/GET race, close dropping debounced
  edits and open editors, keepalive sending one request, no timeout, one bad row blocking the queue, silent refusals,
  windows overwriting each other's stored queue, stale storage after a failed setItem, unvalidated restore, live
  references in queued bodies). Round 2 — the recent-overlay hid server-side changes (import) → `sentAt` check +
  `obForget`. Round 3 — refused create showing as a phantom; periodic adoption overwriting a newer write → `at` /
  `landedAt`, frozen-window self-drop (`obHandedOff` before any write / send; handed rows' next write is an upsert).
  All fixed; the same reviewer confirmed every fix (5 rounds). Known limitation it accepted: after a frozen window's
  queue is adopted by another window, the two windows' writes of the same row may land in either order.

## 0.87.0 — 2026-11-18 — Compare: synced video on one clock, toolbar button, drop-to-compare, layer reorder
- **What:** compare clips play on one clock that waits for the slowest clip ("· loading" while held); scrubbing
  (mouse / finger) moves every clip; the video RAM cache is split between the clips around their playheads. The
  compare button moved from the notes panel to the viewer's top bar (greyed out with nothing to compare, badge =
  dropped files). Files dragged from the library beside the viewer (Tab) join a comparison with the open file;
  a drop no longer turns annotating on (only while annotating does a picture become a reference). Touch: select
  files in the library beside the viewer and tap the button. Layer chips reorder by mouse drag or touch hold+drag;
  the order is the split / tile order and is kept in a note's comparison (`session().ids`).
- **Where:** compare.js (`syncVideos` / `canGo`, `paintMirrors`, `pushFocus`, `mkMedia` / `refCopy`, `C.scrub`,
  touch reorder in `bindUi`, `captureView`); library.py `SlidingVideoCache` (`_Window`, `focus_many`); server.py
  `/api/video/focus` `items`; index.html (`#cmpBtn`, `lightCompareIds`, `addToCompareStack`, `paintCmpBtn`,
  `compareFromContext`, focus handling); annotate.js (`onRefDrop` → `host.dropForCompare`, `host.onVersions`,
  versions-row Compare removed); MANUAL, ARCHITECTURE.
- **Notes:** root cause of the desync: the clock ran on while a clip seeked; a 4K / long-GOP seek took longer than
  the 0.25 s tolerance, so the clip was re-seeked forever (6 × 4K60: up to 7.9 s apart → < 0.3 s). Invariant: never
  seek towards a running clock. Paused-clip "ready" = frame + 0.4 s buffered (Chromium keeps paused elements at
  HAVE_CURRENT_DATA). Hung seek > 8 s re-issued; a clip at its end is never play()ed. The lightbox `focus()` is one
  cache window; closing compare re-focuses it. `light.cmpStack` survives moving between its own files. Not done:
  6-connections-per-host with 6+ clips on slow storage; reorder not written back to the drop stack; the button
  ignores note-stored comparisons on files without versions. `tests.test_board_missing` fails on master already
  (UNIQUE board_items.id) — unrelated.
- Review (fresh agent, run by the implementing agent): 8 findings (end-of-clip play() restart, re-seek timer
  counting the seek, lightbox focus wiping compare's windows, hidden reference without a window, stack edge cases,
  mirrors painting mid-seek, stuck scrub, Windows press-and-hold menu). All fixed; same reviewer confirmed.

## 0.86.0 — 2026-11-18 — Number pins with a leader line; note icons on hover; Ctrl+C copies hovered note text; Shift = H/V
- **What:** owner's asks.
  - The note pin tool is now a *number pin*: a click puts a numbered circle, a drag draws a line from the press
    point with the circle where it is let go. A small field then takes the number (Enter / tap elsewhere; empty =
    the next free number; Esc drops a new pin). A click with the tool on a pin, or a double-click with another
    tool, edits its number. The tool no longer focuses the note composer, which had swallowed every hotkey.
  - Shift while drawing (straight stroke, line / arrow, pin line, dragging a line's end) keeps the line horizontal
    or vertical instead of snapping to 15° (rotation still uses 15° steps).
  - A note card's action icons show on hover only; on touch, on the picked card.
  - Ctrl+C with the pointer over a note's / reply's / picture's text (the panel or the text plate) copies that
    text, with a "Copied" toast.
- **Where:** review-core.js: `primsOf` pin (`label`, leader `ax, ay`), `pinLeader` / `pinLineW`, `boundsOf`,
  `hitTest`, `transformItem`, `snapHV` (exported; used by `xfDrag` line ends). annotate.js: pin branch in
  `onDown` / `onMove` / `onUp` / `abortGesture`, `editPin` / `finishPinEdit` / `nextPinNumber` (`S.pinEdit`,
  `.an-pinedit`), `copyHoveredText` (onKey, composer / caption fields), `snapAngle = RC.snapHV`, CSS
  `.an-nh .an-ib`. FORMAT.md pin; MANUAL.
- **Notes:** `label` is a string set when the pin is created (the next free number among this media's pins; older
  pins count with their note number). Pins without `label` / `ax, ay` render as before (the note's number, no
  line); older clients show new pins that way too. The leader is drawn only when its start lies outside the circle.
  The phone / HTML drawing canvas (review-draw.js) has no pin tool; it draws, moves and hit-tests pins through
  review-core, so leaders follow there too. The hovered-text copy steps aside for a real text selection, also
  inside a focused field. On touch there is no Shift, so no H/V constraint there.
- Review (fresh agent, run by the implementing agent): 6 findings — Ctrl+C dead while the composer kept focus; a
  press while the number field was open only confirmed it (every other quick click placed a pin, a double-click
  on a pin flashed the field); the circle showed a different number than the field until confirmed; a short drag
  ending inside a pin stacked a duplicate; a stale comment — all fixed; compare-mode copy not applicable. The same
  reviewer confirmed all fixes, nothing new.

## 0.85.0 — 2026-11-18 — Lightbox video bar: sound, scrub audio, loop, typed frame jump, Shift+arrows
- **What:** the lightbox video bar gets a sound icon (click = mute, press-and-drag up or the wheel = volume with a
  pop-up slider, right-click or long press = sound while scrubbing, shown by an accent dot), a loop button, and a
  clickable position field (type a frame / time + Enter to jump, Esc cancels; right-click or long press = display
  Frame / Time / Frame+time and Local / Global counting — Global only in a sequence of 2+ clips).
  Shift+← / Shift+→ jump to the first / last frame (of the whole sequence when one plays).
- **Where:** index.html (CSS `.vib` / `.vpop` / `.vtime-in` / `.vctx`; vbar markup; block before `bindVBar`:
  `vgesture`, `vApplySnd`, `vApplyLoop`, `vposPaint`, `vposJump`, `vposEdit`, `vposMenu`, `vClips` / `vPos`,
  `vClipFps` / `vFpsMap`, `bindVBarUi`, `lightEdgeJump`; `paintVBar`, `attachViewer`, `seekVideo` /
  `scrubBlip`, `endScrub` / `endBlip`, `seqAdopt` unmute, `closeLight`, keydown Shift+Arrow); annotate.js
  (`fps()` accessor, `followOff` ignores `_blip`); MANUAL.
- **Notes:** prefs in localStorage `sight.vsnd`, `sight.vpos`, `sight.vloop` (type-checked on read; the phone app
  has its own keys). The mobile code has no volume popup — only its gesture logic and icons are reused. The loop
  button hides in a sequence (its bar has its own loop; `el.loop` stays off there because `ended` drives
  `seqAdvance`). Scrub audio was a 90 ms play blip per seek (superseded by 0.91.1, which plays a PCM cache); `el._blip` kept blips out of `_seqPlayedAt` / the
  annotator's follow tick, and the scrub end re-seeks to the pointer time (the blip ran past it). Frames are 0-based,
  floor-based (as annotate's `stepFrame`); fps comes from the annotator when known, else from
  `/api/assets/{id}/info` (cached per id); "≈" until known. Global frames sum each clip's own
  round(duration × fps). In frame modes a bare number (also decimal) is a frame; `12s`, `1:05` are times; `f120`
  a frame. The position input closes on any outside pointerdown. Not done: the sound icon does not grey out for
  clips without audio (mobile does).
- Review (fresh agent): 8 findings — blips left the paused frame ~90 ms past the release, the loop button never
  hid (`.vib` display overrode `[hidden]`), a TypeError closing the lightbox with the field open, the field staying
  focused after a track click (swallowing keys), global frames using one clip's fps, fps unknown outside annotate,
  inconsistent decimal parsing, the sequence-cut unmute timer overriding a user's mute. All fixed; the same
  reviewer confirmed them and noted two leftovers (board-opened video got no fps, Shift+→ used the current clip's
  fps for the last clip), fixed.

## 0.84.2 — 2026-11-18 — macOS: restoring a minimized window no longer shows "not responding"
- **What:** macOS: restoring a minimized Sight window no longer makes macOS report "Sight not responding", and a
  window left minimized for long no longer comes back to a dead page. Sight.app is now an agent with no Dock
  icon: the window lives under the browser's own icon.
- **Where:** build_app_macos.sh (sets `LSUIElement` and `NSAppSleepDisabled` in Info.plist with PlistBuddy, then
  re-signs ad hoc); Sight.py (`_open()` passes the anti-throttling Chromium flags on every platform; new
  `mac_agent_note()` logs whether the bundle is an agent; the watchdog logs why it quits).
- **Notes:** root cause (read from code, ~75% sure, not run on a Mac): Sight.app's main thread is uvicorn and never
  runs a Cocoa event loop, so as a regular Dock app it could not answer the reopen Apple Event sent by a click on
  its Dock icon. Do not give Sight.app a Dock icon / tray again without a real NSApplication loop on the main
  thread (pyobjc) and uvicorn moved to a thread. Second cause: on macOS / Linux Chromium throttled a minimized
  window's 3 s heartbeat to once a minute, so the 10 s watchdog quit the server; the flags were Windows-only
  (Windows command line unchanged). Editing Info.plist after PyInstaller needs the ad-hoc re-sign. Gap: an agent
  app still cannot answer the logout / shutdown quit event (true before too). Needs a check on a Mac build:
  minimize 1 min and 6+ min, restore, log has no "no heartbeat … quitting".
- Review (fresh agent run by the fixing agent): no correctness bugs; Windows command line confirmed unchanged.

## 0.84.1 — 2026-11-18 — 3D: notes panel shows the drawings right away
- **What:** opening the notes panel on a 3D model now shows its annotation drawings at once (before, only after
  clicking a note — and in fact not even then). With annotation mode off they show, not editable, and follow the
  camera: a drawing shows only while the camera is on its view. The eye button / Shift+H toggle them in 3D too.
- **Where:** annotate.js — `shownOff()` includes `model3d` when `S.b3` is bound; `followOff()` keeps the tick
  running for 3D while drawings exist and are not hidden.
- **Notes:** root cause: `shownOff()` covered images, video, PSD and boards but not 3D, so outside annotate mode
  3D never created / unhid its drawing layer. The compare overlay is unaffected (`showWhileWatching: false`).
  The 3D tick runs every frame while drawings exist and annotation is off (cheap signature check; repaints only
  on camera / hidden-mesh / explode / view change); it ends when `S.b3` goes null or drawings are hidden.
- Review (fresh agent): no findings (rAF teardown, null `S.b3` mid-tick, compare, Shift+H vs 3D H keys,
  pointer-events on the layer all checked).

## 0.84.0 — 2026-11-18 — F fits / finds, long-press resets the annotation bar, modifier cursors
- **What:** F fits the open picture / video to the frame in the lightbox (like double-click, but always fit); over
  the thumbnail grid F scrolls to the selected files. Long-press (700 ms, mouse or touch) on the annotate button
  resets the whole annotation toolbar to defaults (toast). The cursor on a picture / video shows what the held
  modifier does (Alt turns a picture / scrubs a video, Ctrl+Alt turns a video, Shift = fine scrub) and during
  pan / zoom / turn drags. The screenshot / area-screenshot buttons are gone from the annotation toolbar
  (S / Shift+S and the composer's buttons stay).
- **Where:** index.html (`light.fit` / `toFit` in `attachViewer`, F in the keydown handler, grid F in a
  window-level capture keydown listener, `bindAnnoReset(btn, annots)`, body classes `k-alt` / `k-ctrl` / `k-shift`
  + `.view` cursor CSS, drag cursors in `attachViewer`, `.vid` class); annotate.js (`resetPrefs(quiet)`, removed
  shot / region buttons, help footer); MANUAL.
- **Notes:** 3D models and canvas boards keep their own F. The grid F listener is capture-phase on `window` so the
  board's F (canvas.js, on document) does not also frame the board in the split view; it swallows repeats too.
  `resetPrefs` covers styles, stamp look, hold and tool for all three annotators (lightbox, board, compare —
  otherwise a stale one saves its old styles back over the reset); not the per-video stamp on/off, drawings,
  notes. The long-press swallows its release click in the capture phase, `fired` is cleared 60 ms after release.
  Modifier classes re-sync on pointermove and clear on blur. An annotator tool's inline cursor wins over the CSS.
- Review (fresh agent): 3 findings — compare annotator not reset (overwrote the reset), a stale long-press flag
  swallowing the next keyboard activation, F framing the board as well as scrolling the grid in split view. Fixed;
  the same reviewer confirmed them and noted held-F repeats still reaching the board (fixed: repeats swallowed).

## 0.83.1 — 2026-11-18 — Reference shadows follow the picture's alpha
- **What:** a reference image with transparency (PNG / WebP) now casts a drop shadow of its alpha shape instead
  of its rectangle — in Sight, the HTML page, the phone app and canvas exports (screenshots / PDF).
- **Where:** review-core.js — `primsOf` image branch (a shadow-only image prim `p.shadow = {dx, dy, blur, a}`
  before the picture), `primSvg` (black `feColorMatrix` + `feGaussianBlur`, `filterUnits="userSpaceOnUse"`
  with an explicit region, unique `rcshN` ids), `primCanvas`.
- **Notes:** canvas path avoids `ctx.filter` (no Safari): it uses `shadowBlur` with the image drawn off-canvas in
  device space (`setTransform` shift by D past the image's device bbox, `shadowOffsetX += D`), skips the shadow
  when its box misses the canvas, and falls back to an offset rect without `getTransform`. Canvas shadows ignore
  the transform, so offset / blur are converted with `getTransform()`. Bordered refs keep the old stacked-box
  shadow (opaque frame). An unloaded picture has no shadow. Needs an on-device iOS check (very large shadow
  offsets).
- Review (fresh agent): 4 findings — a ghost copy of the picture when it sat off the right edge in canvas exports,
  flipped (negative size) refs getting a 1 px shadow, no fallback without `getTransform`, a filter region
  rebuilt on the unclipped image every drag frame. All fixed; the same reviewer confirmed the fixes, nothing new.

## 0.83.0 — 2026-11-18 — Importing a review file offers to restore notes / drawings deleted here
- **What:** owner's report "the review file does not restore notes and drawings". Not a bug in the merge: rule 5
  (FORMAT.md) keeps a row deleted here when the delete is later than the file's copy. Now the import counts
  such rows and asks *Restore them?*; yes merges the same file again with restore on and they come back.
- **Where:** library.py `import_annotations(restore=, kept_deleted=)`; review.py `import_package` /
  `import_review_file` (`restore`, result key `deleted_here`, per clip in a bundle); server.py
  `/api/review/import?restore=1`; annotate.js `importFile` (two POSTs, counts of both passes summed for the toast);
  tests (test_merge_parity `test_restore_deleted_here`, test_review_bundle `test_restore_rows_deleted_here`);
  FORMAT.md rule 5, MANUAL.
- **Notes:** Sight only — the JS `mergeRows` has no restore (default path unchanged, parity holds; stats keys
  unchanged, the ids go to the `kept_deleted` out-list). A restored row is stamped as edited now (note
  `data.edited_at`, drawing `updated_at`) so the file's / a later package's old tombstones do not delete it
  again and other copies revive it on merge. A restore *undeletes*: when the local copy was edited after
  the file was made (then deleted), the local copy comes back, not the file's older one. The question is the
  native `confirm()` (works on touch too) and says "deleted in this library" (a reviewer's tombstone counts too).
- Review (fresh agent): 3 findings — a failed restore pass hidden by the success toast (now reported after the
  normal reload), a bundle clip merged in pass 1 shown as damaged when pass 2 failed (keeps its pass-1 result),
  restore overwriting a newer local copy with the file's older one (fixed as above, test added); prompt wording
  changed. The same reviewer confirmed all fixes, nothing new.

## 0.82.0 — 2026-11-18 — Phone / HTML page drawing: arrows along a stroke and lasso brush
- **What:** owner's ask. The shared drawing canvas (review-draw.js: the HTML page, the phone app) can now make
  0.81's new drawings. *Arrows and lines* row: a sixth kind, *Arrows along a stroke*; with it in hand the row
  ends with three tap-to-cycle icon switches (side left / right / both, away / toward, guide on / off). The brush
  slot became a two-kind slot (brush / lasso); the lasso's row ends with a pattern button opening a second row
  (none, solid, 8 patterns, random).
- **Where:** review-draw.js — `ARROWS` + `stroke` entry, `ASTROKE_OPTS` / `ASTROKE0`, `BRUSHES`, `PATTERNS` /
  `LASSO_PATS` / `RANDOM_PATS` / `patIco`, `astrokeButtons`, `patternButton`, pen keys `brush` / `lasso` /
  `astroke` (saved with the pen), `begin` (lasso keys on the brush; `stroke.t = "astroke"` makes a
  `stroke / arrows` item), `extend` / `finish` treat "astroke" like a brush stroke (dropped under 3 px),
  `roundItem` rounds gap / step / len. MANUAL.
- **Notes:** no new controls for spacing / length / density / fill colour / fill opacity on the phone (the bar
  stays small): arrows `step` = 10 × size, `len` = 6 × size (min 12 / 8 px); lasso `gap` = 1.7 × brush size (min
  5 px), fill = line colour at 0.5 — Sight's panel edits them afterwards. `PATTERNS` is a copy of review-core's
  (RC is looked up only on open, after this script's top level runs). The cycle switches set the pen only — they
  do not restyle selected arrows strokes; picking the stroke kind with arrows / lines selected takes the tool
  instead of converting them. Picking the stroke / lasso kind reopens the row so its switches show. Supersedes
  0.81's "Not done" about review-draw.js. Hold-to-resize on a selection: an arrows stroke resizes its `width`
  (`wkey`), and `gap` / `step` / `len` follow the thickness by the same factor (as RC.transformItem).
- Review (fresh agent): 2 findings — the brush slot (now a group) fell into `groupSel`'s shapes branch, so with
  the transform tool and a shape selected, tapping Brush / Lasso turned the shape into a rectangle instead of
  taking the brush (`groupSel` now returns [] for slots other than arrows / shapes); hold-to-resize did nothing
  on a selected arrows stroke (no `size`) — fixed as above.
  The same reviewer confirmed both fixes; its one edge note (a hand-made 0 thickness → Infinity) is guarded.

## 0.81.0 — 2026-11-18 — Arrows along a stroke; brush lasso close with pattern fill
- **What:** owner's ask. Arrow tool: a *Stroke* on / off icon button in its bar (the tool icon follows); *Stroke* draws a freehand stroke with
  arrows spread along it, turned to its normal — *Every* (spacing), *Length*, *Tip*, *Away / Toward*,
  *Left / Right / Both*, *Guide* (stroke drawn or not) + its dash. Brush: *Close* (lasso: end joins start) with
  *Fill* none / solid / 8 patterns / *Random*, fill colour, *Fill α*, *Spacing*.
- **Where:** review-core.js (`STROKE_TOOLS` + "arrows"; `PATTERNS`, `hatchPath` / `dotsPath` / `fillPrims`;
  `arrowsGeom` / `arrowsPrims` / `arrowsReach`; `strokeOutline` closes `data.close`; bounds / hit / transform),
  annotate.js (DEFAULT_STYLES brush / arrow new keys, LEN_KEYS gap / step / len, P.close / pattern / ipattern /
  bfill / gap / amode / ahead / step / alen / adir / aside / guide, `ARROWS_PROPS`, PROPS.arrows, props `when` /
  `edit` filters in `renderProps`, `t: "cycle"` props (one icon button stepping through options; `fixed` = an
  on / off button for a string value), `ico` on toggles, paintBar arrow icon by mode, onDown "arrows" branch, `RANDOM_PATTERNS`, onUp drops a < 3 px arrows
  stroke, partial eraser opens a cut lasso), FORMAT.md, MANUAL.
- **Notes:** new drawing type `kind stroke / shape_kind "arrows"` (not a mode flag on `arrow`: its geometry is
  a polyline, and older clients skip it cleanly instead of drawing a wrong straight arrow). "Random" is resolved
  when the stroke starts — the item stores the real pattern (the selection's Fill list has no Random:
  `P.ipattern`, `edit: true`). Patterns are geometry clipped to the polygon (no SVG `<pattern>` / clipPath ids:
  ids differ between clients, same reason as the image shadow) — so SVG, canvas exports, the HTML page and the
  phone draw them identically; nonzero fill everywhere (solid, hatch scanlines with winding counts, dots / hit `inPoly`), so a lasso drawn round
  twice stays filled; capped at 300 lines per direction and ≈ 4k dots (re-rendered on every pointer move) —
  line width / dot radius / dashes follow the capped spacing.
- Review (fresh agent): 7 findings — even-odd vs nonzero mismatch (double-wound lasso hollow, solid not
  clickable), empty undo steps / server updates from the partial eraser, slow dense dots, unhittable lasso seam,
  a cut lasso split at its seam, arrows hit on their empty side, old brushes closed later with no fill settings;
  all fixed. Re-review confirmed them; then: widths not following the capped spacing, a cycle button's first
  click with a missing value, the arrow tool's icon — fixed; the reviewer confirmed all, nothing open.. Props `when(get)`
  hides keys that do not apply (Stroke-only keys, fill keys while Close is off). A mirror swaps an arrows
  drawing's left / right. Not done: the HTML page's / phone's own drawing toolbar (review-draw.js) has no
  Stroke-arrows / Close tool yet — they render and transform such drawings, but cannot make them.

## 0.80.0 — 2026-11-18 — Annotation tools cleanup: crop fix, shape tool, note editing, independent panel
- **What:** owner's list. Reference-image crop now actually clips (it only moved the box). Notes panel: a pencil
  on each card (hover; on the picked card for touch) and double-click on the text both edit it (double-click
  did nothing). Picture-text plate keeps its current size while editing. Tab split hides the sidebar's Canvas
  section. Drawing tools (✎ / Shift+A) and the notes panel (speech bubble / C) are independent; the toolbar's
  panel button is gone in the lightbox / board. Annotating always starts with the brush. Line tool removed
  (arrow with heads "none"); rectangle + ellipse are one shape tool (R / O, *Shape* ▭ / ◯ in the bar), no
  Stroke switch, fill off and 50 % by default. A note pin of the note in the making shows the number the note
  will get (was "•"). Onion skin no longer collapses to the picked note when a note / its picture is clicked.
- **Where:** annotate.js (`.an-layer > svg`; `editNote`, `data-edit` / `.an-nedb`, `e.detail > 1` guard;
  `togglePanel` / `panelShown` on `S.readOn` only; `toggle` brush; TOOLS / `setShape` / P.shape / PROPS.rect;
  `loadStyles` migration; `numOf`; `onionOn` / `viewMode`), caption-plate.js (`.editing` rules, min-height pin
  in `startEdit`), review-core.js (image prim's nested svg gets an inline size), index.html (`.nav-canvas`),
  MANUAL.
- **Notes:** root cause of the crop: `.an-layer svg {width:100%; overflow:visible}` also hit the nested `<svg>`
  an image prim clips with; any host CSS `x svg {width:100%}` does the same (note-card previews, HTML page,
  phone), hence the inline style in review-core — keep it. `S.panelOn` now serves only `readPanel: false`
  hosts (version compare), whose toolbar panel button stays. Shape tool keeps id "rect" (saved styles); old
  `line` / `ellipse` items and `setTool("line"|"ellipse")` still work. Onion skin: a pick narrows nothing
  unless a new note is being composed. The fill 20→50 % migration runs once (`sight.annotate.fill50`).
  Verified with Playwright (crop, pencil / dblclick edit, plate sizes, Tab split, panel/tools independence,
  O/R, pin number, onion ghosts after a pick).
- Review (fresh agent): picked note hidden while composing with onion on, 20 % fill reset on every load,
  nested-svg stretch in previews / page / phone; fixed. A claimed "old loose pins get a number" was withdrawn
  by the reviewer (addNote adopts every loose drawing, so the number is right). Re-review: the fill migration
  must save the migrated styles with its marker (else lost, and the board / compare annotators missed it) —
  fixed; the other fixes confirmed.

## 0.79.0 — 2026-11-18 — Reference images on the frame (crop, frame, shadow); library beside the lightbox / player (Tab)
- **What:** owner: reference pictures in the annotating mode of the lightbox and the video player, a toolbar icon,
  settings crop / frame (width, colour) / shadow (strength); pictures dropped onto the frame from outside or picked;
  picking = the board's way (sidebar + thumbnail grid left of the player, a vertical divider) as a mode of its own
  on Tab and a button at the left of the top bar, like the board's. New drawing kind `image` (tool `Shift+I`):
  drop OS files / drag grid files onto the frame (any tool, the mode turns on), click the frame with the tool
  (file picker, placed there), props-bar *From disk… / Library / Add selected* (touch). Selected: Frame, Frame
  colour, Shadow, Opacity, *Crop* (or double-click; Enter / Esc / a press elsewhere ends) and *Reset crop*.
  Tab / ◧ (`#libBtn`, lightbox bar's left end) = library beside the lightbox; Tab on a board toggles its split,
  and the board's ◧ moved to the left of the top bar.
- **Where:** review-core.js (`setImageSource / imageUrl / imageEl / imagesReady / imgCrop`, image prims in
  `primsOf` / `primSvg` / `primCanvas`, bounds / hit / transform / `validItem`, JS merge remaps `data.shot`),
  annotate.js (TOOLS / DEFAULT_STYLES / P / PROPS `image`, `cropFrame` / `applyCrop`, `addRefs` / `storeRef` /
  `pickRefs` / `onRefDrop` / crop mode, `S.crop`), index.html (light split: `applyViewDom`, `placeLightSplit`,
  `toggleLightSplit`, Tab; annotator host `toggleLibrary / pictureSources / selectedPictures`, `pictureSource`;
  board annotator `refImages: false`), review.py (`build_package` ships the shot; HTML page image source,
  `savePic` waits for decoding), library.py (`import_annotations` remaps `data.shot`), mobile (`refShots`,
  `shotIds`, `burn` waits), FORMAT.md, ARCHITECTURE, MANUAL.
- **Notes:** the shadow is six stacked translucent rounded boxes (no SVG filter: filter ids would clash between the
  many SVGs on a page and the canvas has no portable blur) — the same in SVG and canvas, PDF included. A picture
  is stored once per add (a duplicate / copy shares its shot). The crop is in source-picture units, so the picture
  is never stretched; the box is the visible part. Library files: the file when the browser decodes it, PSD's
  composite, else the thumbnail. Not done: pasting a picture from the system clipboard; reference images on boards;
  editing them in the HTML page / phone app (they show there, read-only geometry). Verified with Playwright on an
  isolated SIGHT_HOME: Tab split (lightbox left at the divider, grid shown, back on close), OS-file drop, grid
  drop, Add selected on a video (ctx = the frame), crop by the east grip ([0,0,0.607,1], box narrowed), screenshot.
- Review (fresh agent): the phone repainting forever when a reference image's shot is missing from the package
  (and leaking object URLs), pictures landing on another frame when the video was scrubbed during the upload, Shift+I
  picking a hidden tool on a board, a click inside the crop window making an empty undo step, phone reports / note
  cards burning grey placeholders before the pictures were known, Tab toggling the split behind the stamp popup /
  dialogs, the grid's touch selection bar under the lightbox, a decoded-picture cache never cleared on a new source,
  SVGs with only a viewBox failing; fixed (`rv.refAsked` / `refWait`, ctx taken before the uploads, `setTool` gate,
  2 px threshold, `await refShots` before the report, Tab gate, `--light-l`, cache cleared in `setImageSource`,
  1024 px fallback). Accepted: no LRU on the cache. Re-review: the same reviewer confirmed all nine fixes.

## 0.78.0 — 2026-11-18 — Phone: review a group as a sequence, clip by clip
- **What:** owner: reviewing a sequence on the phone meant going back to the list after every clip. Now a tap on
  a group's picture opens its sequence on the clip last seen there (else the first); the review header of any
  grouped review has ‹ / › around the title and "group · 2 / 5" in the subtitle; Page Up / Page Down on a
  keyboard. Back leaves the sequence in one step. Works for pictures and 3D models too.
- **Where:** mobile/js/app.js (`seqOf`, `openSequence`, `seqRemember`, `seqGo`; `openReview(…, opts.replace)`;
  `renderReview` header, `paintReview` subtitle `els.seq`; group header `thumb`; keydown table),
  mobile/index.html (`.seqb:disabled`), tests/pwa_e2e.cjs `bundle` + test_pwa.py `test_bundle`, MANUAL, ARCHITECTURE.
- **Notes:** the sequence = the review's UI group (`g.keys` order), not `meta.groups`. No wrap at the ends. No
  swipe on the player for clip switching (it competes with scrub / pinch / drawing) — buttons serve touch. A
  clip switch flushes edits (openReview) like Back does; an unsent composer draft is dropped as on Back.
- Review (fresh agent): `pushed` was read from a review still loading (Back out of step after quick ›) → the
  history entry is settled before any await, an overtaken unshown review hands its entry over, `openingKey` is
  the base for quick taps; Back during a loading › was undone → `++openSeq` in leaveReview / route; PageDown
  during an export swapped clips → no switch while `.busy`; hidden reviews were in the sequence → `seqKeys`;
  a deleted clip was a dead end → dropped from the group and skipped. Nits: `openingKey` cleared on a thrown
  open (wrapper `openReview` → `openReviewNow`), header refreshed after a drop (`paintSeq`, player untouched).
  Confirmed by the same reviewer.

## 0.77.0 — 2026-11-18 — The phone app opens and answers a sequence's `.srev` bundle (multi-clip plan, stage 3)
- **What:** opening a bundle on the phone merges every clip into its own review (one summary toast: damaged
  clips / non-media named, the rest land; "same file as clip N" for a duplicate) and puts them in one home
  group named by the bundle's title; a review with no media on the phone is greyed ("Media not on this
  device — notes readable") until its file is picked. The group's menu has *Review file for Sight (.srev)*:
  one bundle of the clips changed since the last send, with the received bundle id (nothing changed → asks
  to send all). Works for user-made groups too (their own id). A one-clip bundle behaves like a package.
- **Where:** mobile/js/model.js (`parseReviewFile`, `buildBundle`, `checkPackage`), mobile/js/app.js
  (`importReviewFile` split into `reviewKeyFor` / `mergeInto` / `importBundle` / `bundleGroup`;
  `dirty(user)`, `packageOf`, `isChanged`, `markSent`, `exportBundle`, `offerFile(…, onSent)`, `nomedia`
  row), mobile/index.html (`.row.nomedia`), tests/pwa_unit.cjs, tests/pwa_e2e.cjs `bundle`,
  tests/test_pwa.py `test_bundle`, MANUAL, ARCHITECTURE, FORMAT, PLAN-multiclip, PLAN-mobile.
- **Notes:** no IndexedDB version bump: new meta fields `groups`, `changed`, `nomedia`. `changed` = time of the
  last user edit; merges never set it (`dirty(false)`); a send clears it only if it is unchanged since the
  package was built. Missing `changed` (made on the phone / before 0.77) counts as changed — extra clips are
  harmless under the merge rules. The UI group holds a review at most once; a reply takes the group's keys plus
  every review whose `meta.groups` has the bundle id. "Merge a review file…" with a bundle imports it as a
  bundle (not into the open review). Merge code untouched (merge parity).
- Review (fresh agent): a review opened mid-import could read its rows before the merge and drop it on the next
  save → busy overlay over the import loop; a lone clip of a later bundle did not join the bundle's existing
  group → `bundleGroup` for any clip count; bundle `version` parsing now matches Python's `int(v or 0)`. All
  confirmed by the same reviewer. Left as is: back / forward during the import can still open a review
  mid-merge (deliberate action, tiny window); `version: []` / `"1_0"` parity quirks.

## 0.76.0 — 2026-11-17 — One web page for a sequence's review (multi-clip plan, stage 2)
- **What:** Sequence → Export → *Web page, all clips* writes **one** page (was one per clip). It has a clip strip on
  top (name, notes, open notes; a dot = changed here), ‹ / › buttons, `←` / `→` (not in text fields, the full-screen
  picture, the drawing canvas or a sheet). The bottom bar counts every clip; *Download reply* = one `.srev` bundle of
  the changed clips with the page's bundle id; *Discard* asks this clip / all clips (Esc / Cancel / backdrop close);
  the clip's details (tap the title) have *Download this clip's reply* — a plain package for Sight < 0.75. Switching
  clips resets the search / state filter. A sequence with one clip with notes gets the ordinary one-clip page.
- **Where:** review.py (`build_html` → `_page`, new `build_html_all`; page script: `useClip`, `switchClip`, `CL`,
  `slotKey`, `changesOf` / `editsOf`, `clipCounts`, `paintStrip`, `replyPackage(c)`, `download` / `downloadClip`,
  `discard`, `header()` clears first, `closeEmpty(target, noRender)`; `plate_js` exposes `hotkey` / `runHotkeys`),
  server.py (`/api/review/export/html-all`, returns `clips`, `missing`), index.html (`seqExportAll` html → one post),
  tests/page_multi_e2e.cjs + test_review_page.py `MultiClipPage`, MANUAL, ARCHITECTURE, PLAN-multiclip.
- **Notes:** data block is now `{clips: [{report, package, edits?}], bundle?, copy?}` (a one-clip page too; `bundle`
  only with 2+ clips). One-clip page invariants kept: storage key `sight-review:<asset id>:<exported_at>[:copy]`,
  reply = plain package (`page_e2e.cjs` passes unchanged). Multi-clip key `sight-review:<bundle id>:<asset id>[:copy]`.
  All clips' edits live in memory (`CL[i].E`, the shown one is `E`; `editsOf(c)` reads the right one) and each save
  writes the shown clip's slot. The page's clips = clips with notes (client scan, as before); a tombstone-only clip
  is not on the page (deletes travel in the `.srev` bundle). A composer with a picture still loading counts as not
  empty and cannot send (`dr.pending`). Stage 3 (phone) not started.
- Review (fresh agent): no correctness bugs; low items fixed — a picture still loading was lost on a clip switch
  (field closed as empty), search / filter carried over to the next clip, discard sheet had no keyboard close,
  missing clips dropped silently from html-all, the strip scrolled on every save. Re-review: names of missing clips
  came out as "clip" and Send could be pressed mid-load → fixed; then Send could stay disabled after a re-render
  mid-load → fixed (`render()` when the field was replaced); all confirmed by the same reviewer.

## 0.75.0 — 2026-11-17 — `.srev` bundle: a sequence's review in one file (multi-clip plan, stage 1)
- **What:** Sequence → Export → *Review file (.srev), all clips* writes **one** file (a bundle, FORMAT.md "Bundle")
  instead of one per clip; clips with notes or with tombstones (all notes deleted since) go in. Importing a bundle
  (drop, Export menu, palette) merges every clip in the library and shows one summary ("2 clips updated · 1 not in
  your library: x · 1 damaged · y: same file as clip 1"); the others still land. Exactly one clip updated → it
  opens as for a plain package; otherwise nothing new opens, open affected clips reload (undo cleared) and the
  sequence's off-screen timeline marks are re-read. Also: the import toast without a lightbox (dropped on the grid)
  now shows (page `flash`, plain text) — before it went to `#v3dToast`, which exists only in the lightbox.
- **Where:** review.py (`parse_review_file`, `build_bundle`, `find_review_asset`, `import_package`,
  `import_review_file`), server.py (`/api/review/import` → `import_review_file`; new `/api/review/export/package-all`
  with `asset_ids`), annotate.js (`importedBundle`, toast passes `ms`), index.html (`seqExportAll` "pkg",
  `seqReviewChanged`, `htmlToText`, main host `toast`), tests/test_review_bundle.py, tests/test_pwa.py
  (`sight_import` calls the shared function), FORMAT.md, MANUAL, ARCHITECTURE, PLAN-multiclip.
- **Notes:** packages inside are unchanged and merge by the same code (merge parity untouched). A plain package's
  import response is exactly as before (404 missing / 400 damaged); a bundle is always 200 with `results` per
  package, each committed on its own. Damaged-file 400s now also cover sqlite binding errors and a non-numeric
  `version` (were 500). Two packages matching one local file: the first claims it even if it turns out damaged;
  the later is reported as duplicate (no second try). Older Sight (< 0.75) rejects a bundle as "Not a Sight review
  file" — the stage-2 page's one-clip reply must stay a plain package. Stage 2 (multi-clip page) and 3 (phone) not
  started.
- Review (fresh agent): damaged inner package lost its name in the report; a duplicate after a damaged first copy
  was imported again; `package-all` iterated a string `asset_ids` per char / 500 on a number; a bundle opened a clip
  even when nothing changed; MANUAL said the `.srev` export visits clips; fixed. Re-review: fixes confirmed except a
  `continue` that skipped reloading the first changed clip when several changed (stale rows + undo over the merge);
  removed, confirmed by the same reviewer.

## 0.74.0 — 2026-11-17 — Onion skin cross-fades between annotated frames, toggled on the eye; one eye, in the top bar
- **What:** owner: onion skin looked odd (every drawing within ±1 s at a flat 22 %); it must fade the current
  drawing out and the next annotated frame's in. Now, while drawing on a video with onion on, between two frames
  that carry drawings the earlier ones fade out and the later ones fade in as the playhead moves (linear over the
  gap; over 1 s before the first / after the last). And the toolbar's eye is gone: the top bar's eye (lightbox
  `#drawEyeBtn`, new `#boardEyeBtn` next to the board's pen) works while drawing too. Owner, next: onion skin is a
  way of viewing, not a tool — its toolbar button is gone; right-click / long-press on the eye toggles it (video;
  click still hides / shows), it works while just watching too and is kept with the settings
  (`sight.annotate.onion`); the eye shows the onion icon while it is on.
- **Where:** annotate.js (`onionFade` replaces `ghostNow`, `paintVisibility` inline opacity, `.an-doc g.ghost` CSS
  removed; `paintEye` used by `paintBar` / `paintBadge`; toolbar `data-act=hide` removed), index.html
  (`#boardEyeBtn`, host `eyeBtn`, activePane, `applyViewDom`), MANUAL, ARCHITECTURE.
- **Notes:** a span = the drawing's frame + its hold (a held drawing fades from the end of its hold); a drawing
  held for the whole clip (`hold: -1`) is not part of it. Spans group by their end / start within half a frame.
  The rules that decide what may show (hidden replies, deleted notes, the compose / pick narrowing) apply to the
  ghosts too. A board's eye shows only while drawing there (the board resets the eye when drawing ends).
  Verified with Playwright: opacities at 0.4 … 3.8 s over drawings at 1.6 / 2.0 / 2.6 s match the formula; no
  toolbar eye; the top-bar eye while drawing hides everything.
- Review (fresh agent): the first cross-fade only counted spans that had ended, so at every annotated frame in the
  middle the previous drawings popped back and the next jumped (and held drawings sat at half opacity); a fade cut
  off when an overlapping hold ended; a hidden state carried over from another file gave no sign while drawing (new
  strokes vanished); fixed (groups by start frame: the group that started last fades out from each drawing's own
  end, the next fades in once it is over; the eye shows while drawing when hidden). Accepted: the version compare
  has no eye (Shift+H still works there; onion is off there). Re-review: fixes confirmed; new: a touch long-press
  on Android / a pen on Windows toggling onion twice (their contextmenu), drawings frozen after onion unhid them
  on a playing video, an earlier group's long hold ending with no fade; fixed; the same reviewer confirmed all three. Then: a pen's barrel
  button (pointerdown `button` 2) counts as a right-click and toggles onion too (confirmed by the same reviewer).

## 0.73.0 (docs) — 2026-11-17 — Plan: one review page / `.srev` bundle for several clips
- **What:** `docs/PLAN-multiclip.md` (linked from PLAN.md and CLAUDE.md): a bundle envelope (`format:
  "sight-review-bundle"`, `.srev` too) around unchanged single-asset packages; stage 1 format + Sight import /
  export, stage 2 the multi-clip page (the page script refactor is the main work), stage 3 the phone app. Owner
  decided: `.srev`, clips without notes left out (clips with tombstones still count), no boards. No code yet.
- Review (fresh agent, three rounds against the code): wrong assumptions (page script reusable per clip, storage
  key, "unchanged clips" savings, the phone's change tracking / `dirty()`, `exportSrev` per clip) and gaps (Sight
  import UI and response, damaged inner packages, shared import function, html-all / package-all, one-clip page
  replying with a plain package, duplicate asset match, bundle id ownership); all written into the plan; the last
  round found it ready to implement.

## 0.73.0 — 2026-11-17 — Notes panel apart from the drawing tools; board notes remember their place
- **What:** owner: open the notes panel just to read and click pictures; drawing is what brings the tools; the
  panel must work on boards too, and a board note must remember where it was written (like a 3D view) and glide
  the camera there (smooth start and stop) when its picture is clicked. A notes button (speech bubble + note
  count) sits in the lightbox bar and, for a board, in the top bar; `C` does the same with the mode off. The
  pen no longer carries the count.
- **Where:** annotate.js (`readKey` / `S.readOn`, `togglePanel`, `panelShown`, `syncPanel` `.an-read`,
  `paintNotesBtn`, `onKey` off-mode C / Esc-unpin, `modeAllows` pin while watching, board `ctxNow` → `bv`,
  `flyToNote`, `boardPreview`, `.an-bprev` click), canvas.js (`stripWidth`, `frameRect(…, opts)`, `viewRect`,
  `flyTo` / `stopFly`), index.html (`#notesBtn`, `#boardNotesBtn`, host `notesBtn` / `notesBtnShown` /
  `boardView`, activePane for the top-bar board buttons), FORMAT.md (board ctx `bv`), MANUAL, ARCHITECTURE.
- **Notes:** the reading panel has no composer (adding a note is part of the drawing mode); card actions (reply,
  resolve, delete) stay. Two flags so the panel does not pop up on every file: reading is off by default,
  drawing keeps its own (`sight.annotate.panel`). `bv` is stored for new board notes only; older ones fly to their
  drawings' bounds. The fly takes 450–1100 ms by distance / zoom ratio, any press or wheel on the board stops it.
  Also: `toggle(false)` closes an enlarged screenshot; the top-bar board pen makes the board the key pane.
- Review (fresh agent): `modeAllows` reading the view mode before declaring it (threw whenever the mode was off and
  a drawing belonged to a note — drawings, leaving the mode and picking a note broke), C in the compare toggling the
  lightbox's reading panel behind it, the compare picking up the lightbox's reading flag (`host.readPanel: false`
  now), a glide still running when another board opens / the board closes (`stopFly` in open / close); fixed.
  Also: closing the reading panel unpins the note; a screenshot landing after the mode was left no longer opens the
  reading panel. Re-review: the same reviewer confirmed every fix. Earlier review of 0.72.0's board pen / screenshots / Esc: board keys going to the
  library after a click on the top-bar pen in split view, a screenshot left open when the mode is switched off by
  the pen; fixed, confirmed by the same reviewer.

## 0.72.0 — 2026-11-17 — Drawings shown while just watching (eye to hide); review export of a whole sequence
- **What:** (1) owner: drawings must show during ordinary playback, without the annotating mode, with an eye to
  switch them off "as in the mobile app". A picture's / video's drawings now stay on show with annotating off
  (a video's on their frames as it plays); an eye button next to the pen in the lightbox bar (and Shift+H)
  hides / shows them — the same flag as the toolbar's eye. 3D keeps drawings for the annotating mode.
  (2) Export ▾ in a sequence has "…, all clips": the review of every clip with notes — one PDF (a section per
  clip, pages numbered through), one ZIP (a folder per clip), a web page / .srev per clip.
- **Where:** annotate.js (`shownOff`, `hasDrawings`, `renderAll` / `tick` / `viewChanged` / `onKey` / `modeAllows`
  / `paintBadge` / `toggle(false)` clears the hover circle; menu `.an-mseq` + API `assetId / ready / fpsKnown /
  report / toast`), index.html (`#drawEyeBtn`; `seqExportAll`, `seqWaitClip`, `reviewerName`; host `seqClips`,
  `seqExport`), review.py (`build_pdf(number=)`, `_number_pages`, `build_pdf_all`, `_zip_report`, `build_zip_all`),
  server.py `/api/review/export/pdf-all|zip-all`, tests/test_review_all.py, MANUAL, ARCHITECTURE.
- **Notes:** with the mode off every drawing of the frame shows (no clean picture after "Add", no compose
  hiding) — that narrowing is an editing aid. The sequence export visits the clips on screen (pictures need
  the clip decoded) and returns to the clip / time it started from (paused or playing as before); a clip that
  does not load in 45 s is skipped and named in the toast. HTML / .srev stay one per file (FORMAT.md is per
  asset). Verified with Playwright: drawings / eye / Shift+H / leaving the frame with the mode off; all four
  exports over a two-clip sequence (PDF pictures carry the drawings, ZIP folders per clip, back on clip 2).
- **Also in 0.72.0** (owner): the board's annotate pen moved from the board's top-left corner to the top bar
  (`#boardAnnoBtn`, next to ◧ — where the lightbox has its pen; canvas.js takes it as `annButton`, its own corner
  button stays only for a host that passes none). A note's attached screenshots are marked apart from its
  drawing previews (`.an-shotw`: camera corner badge, dashed edge; clicks go by `[data-shot]` on the wrapper).
  Esc closes an enlarged screenshot first (annotate.js `onKey`) — before, it was eaten by deselect / pin / leaving
  the mode, so it took several presses.
- Review (fresh agents), watching block: boards and still pictures ticking every frame forever, onion ghosts while
  watching, the compare showing drawings with no way to hide them (and Shift+H hiding the lightbox's behind it),
  Shift+H with no drawings / on key repeat, the eye counting drawings that never show; fixed (the tick runs only
  for a playing video — `followOff`, woken by play / seek; the compare passes `showWhileWatching: false`).
  Export block: a clip switched during its capture mixing clips, playback not resumed, a single export running
  alongside, a stray separator on the board menu, the failure toast lost with the lightbox; fixed (`S.gathering`
  + `host.exportBusy` one-at-a-time, the report checked against the clip on screen, `flash()` fallback).
  Re-review (same agents): export fixes confirmed; watching fixes confirmed, plus a missing pause / ended wake
  (the frame a video stops on could keep the previous frame's drawings) — added.

## 0.71.0 — 2026-11-17 — Dictation: built-in browser engine + one-tap language chip; Groq replaced by "my service"
- **What:** owner: no Groq, keep the app small, use what the system has, picking the language by hand is fine;
  allow any speech-to-text service the user likes. (1) Next to every mic there is a language chip (RU / EN…): a
  tap flips between the two languages used last, Alt+Shift+M does the same from a dictation field, right-click /
  long-press lists all. Switching mid-dictation lets the words heard land, then listens again in the new language.
  (2) Settings → Dictation: *Browser (built in)* (default) or *My service (OpenAI-compatible)* with Address, Model,
  API key (optional) — any `POST …/audio/transcriptions` endpoint: a local whisper server, OpenAI, Groq…
- **Where:** `app/stt.py` (`SttService` replaces `GroqStt`: config `{url, model, key}` in `<SIGHT_HOME>/stt.json`),
  server.py `/api/stt/config` (replaces `/api/stt/key`; JSON content-type required), `dictation.js` (provider
  `service` replaces `groq`; `SWITCH`, `recent()` / `remember()` / `cycle()` / `pickLang()`, chips map, `restart` /
  `stopping` flags), index.html (`bindDictationSettings`, `.stt-row`), tests/test_stt.py, MANUAL, ARCHITECTURE.
- **Notes:** an old `stt.json` with `groq_key` is simply ignored (not configured), and an engine setting `"groq"`
  reads as the browser. Status returns url / model / hasKey, never the key. Changing the address drops a stored
  key unless a new one comes with it (nothing can redirect the user's key to another host); no redirects followed.
  No key → no Authorization header; no model → `whisper-1`. Auto language without a key is impossible with Web
  Speech; local Whisper inside Sight was offered and declined (too heavy) — a local whisper server plugs in as
  "my service". Recent pair: `localStorage["sight.dictation.recent"]` (defaults: browser language + English, or
  + Russian on an English browser); compared via `fullCode` so a bare "ru" browser code equals "ru-RU". Verified
  with Playwright: chip / hotkey / restart on a fake recogniser; Settings → save → a real phrase from Chromium's
  fake mic through the dev server to a fake OpenAI-compatible server (Bearer key, text back).
- Review (fresh agent), chip block: restart after a user stop, Enter / blur not cancelling the restart, a same-base
  pair (en-US/en-GB) not flipping, wrong seeding of regional browser codes, floating chip not re-placed, chip tap
  vs popover close; fixed. Re-review: bare browser code ("ru") needing two taps — fixed; the same reviewer confirmed every fix.
  Service block review: URLs the browser's `new URL()` rejects (spaces, bad port) saved as configured, the system
  proxy applied to a local server (key in clear text to it), the key silently dropped on an address change, the
  old Groq key left on disk, the upload cap relying on Content-Length only; fixed (local hosts bypass the proxy,
  cloud hosts keep it; body read with a running 20 MB cap). Re-review: a key saved with no address could not be
  removed, a one-time race deleting a fresh config with the Groq file; fixed; the same reviewer confirmed all.

## 0.70.0 — 2026-11-17 — Dictation with automatic language detection (Whisper via Groq)
- **What:** Settings → Dictation: engine *Browser* (as before) or *Whisper (Groq)* plus a Groq API key. With
  Whisper the mic's language "Auto" really detects the language (owner's request; the browser's recogniser
  cannot — its "auto" is the browser's language). Words arrive phrase by phrase (after each pause), not live.
- **Where:** new `app/stt.py` (`GroqStt`), `app/server.py` `/api/stt/status|key|transcribe`, `dictation.js`
  provider `groq` + `getEngine` in `createDictationUI`, annotate.js (passes `getEngine`), index.html
  `bindDictationSettings` + Settings markup, `tests/test_stt.py`. PLAN-stt.md (tier 2 done), ARCHITECTURE, MANUAL.
- **Notes:** the key lives only in `<SIGHT_HOME>/stt.json` (0600), never in settings.json / the page / logs;
  `/api/stt/status` says only whether one is set. Stdlib `urllib` multipart, model `whisper-large-v3-turbo`, no
  `language` field = detect. Phrases: one MediaRecorder per phrase (each upload a complete file), cut by 0.7 s of
  quiet after ≥ 0.25 s of voice (AnalyserNode RMS), or at 20 s. Not testable from the dev container (Groq is not
  reachable here): verified up to the POST and the "unreachable" toast with Chromium's fake microphone. Phrases are
  delivered in order (numbered), the next recorder starts before the old stops (no word lost at a 20 s cut), the
  session ends only when every recorder and upload is done, a missing key is reported before recording, leaving
  the composer still appends the phrases in flight (editors that save on blur drop them, Enter drops them).
  `/api/stt/transcribe` takes `audio/*` only (another site's "simple" POST cannot spend the quota) and checks the
  size first; urllib never follows a redirect (it would re-send the key).
- Review (fresh agent): mic left on when stopped during the permission prompt, phrases out of order, last phrase
  lost on blur / just after a cut, suspended AudioContext dropping everything, a word lost at the 20 s cut, no-key
  reported late, unbounded / cross-site POST, mislabelled upstream errors, redirects carrying the key, key file
  briefly world-readable; fixed. Re-review: start errors never reached the toast (end() cleared the session first)
  — fixed; confirmed by the same reviewer.

## 0.69.1 — 2026-11-17 — Sequence: no black frame across a cut, picture scrub runs through clips
- **What:** scrubbing back (or forward) across a cut no longer flashes black; dragging on the picture scrubs the
  whole sequence and runs on into the neighbouring clips instead of stopping at the clip's ends.
- **Where:** index.html `seqHold` / `seqKeepStill` / `seqDropHold` / `seqReleaseHold`, `seqDragTo`, `seqNow`,
  `seqScrubBegin`, the attachViewer scrub hand-over (`sd.handed`), `bindSeqBar` (uses `seqDragTo`), `.seq-hold` CSS.
- **Notes:** a clip opened from scratch shows nothing until decoded, so the frame on screen is held as a canvas
  (the visible scrub copy, else the player, else — mid-seek, when nothing can be drawn — the last presented frame
  of that same element) placed with the player's box and turn / mirror / zoom transform inside a box clipped like
  the frame; it goes when the new clip presents its frame (rVFC, 250 ms fallback; 1.5 s cap). The picture scrub is
  handed to window listeners once it starts (each cut replaces the stage and the element holding the pointer);
  a release outside the window ends it on the next move without a button.
- Review (fresh agent): hold skipped mid-seek, wrong source while the scrub copy shows, geometry for turned /
  masked views, stuck drag after a release outside, a swallowed tap after a cancelled hand-over, rVFC not firing,
  timer of chained holds, `seqNow` before a landing; re-review: the mid-seek still placed with another clip's
  geometry — all fixed; confirmed by the same reviewer.

## 0.69.0 — 2026-11-17 — Compare annotating: splits by Alt / finger, screenshot of the whole comparison
- **What:** while annotating in the compare's Swipe, `Alt`+drag moves the nearest split (as Alt scrubs a video in
  the viewer) and a finger / stylus landing within 24 px of a split moves it — no stroke for that press, no need to
  leave annotating. The annotator's screenshot (`S`, area `Shift+S`) is now the comparison as shown — every visible
  layer in its split region or tile, Difference, dimmed clips, split lines and names — with the drawings on top
  (owner: "that is the point of commenting a comparison"); it was the selected layer alone.
- **Where:** compare.js `wantsPress`, `onDown` (`altPan`; drags keep their `pid`), `captureView`, `C.viewWrap`;
  annotate.js `onDown` → `host.passThrough`, `composeView` → `host.captureView` (drawings clipped to the surface),
  `capture()` area offset; index.html `cmpAnnot` hooks, compare `annotating`.
- **Notes:** `passThrough` is asked after the edit / pen-eraser handling and not while an area is being picked or
  with Alt on the select tool (its duplicate-drag). Outside annotating Alt+left still pans in Swipe. A video layer
  caught mid-seek (`readyState` < 2) is drawn as nothing (black) in the screenshot — left as is (rare). Note
  previews / report pictures still show the annotated layer's own frame (the screenshot is what shows the comparison).
- Review (fresh agent): a resting palm's split drag following the pen (no pointer id on the drag), Alt duplicate-
  drag lost with the select tool, area capture / text edit / pen eraser presses taken near a split, drawings not
  clipped to their tile, label size; fixed (black hole for a seeking video left).

## 0.68.0 — 2026-11-17 — Annotating in the version compare; notes remember the comparison
- **What:** compare (K) has *✎ Annotate* / `A`: the notes panel and drawing tools on the **selected layer**
  (owner's choice) — notes / drawings go to that file at its own frame. A note made there stores the
  comparison (files, order, reference, selected layer, layout, blend, split direction, clip offsets); its card in
  the viewer gets *⧉ Compare · N files* (opens it again on the note's frame, annotating on) and `K` on that file
  opens the newest stored comparison instead of the file's versions.
- **Where:** compare.js — `host.onOpen / onView / onPlaced / onClose / onAnnotButton`, `reportView`, `session()`,
  `pause()`, `seekLayer()`, `ready()`, session look (`C.pBase` / `C.userSet` / `prefsToSave`), ResizeObserver;
  annotate.js — `vidPause` / `vidSeek` (host clock), `host.noteExtra`, note card button (`data-cmp`,
  `host.openCompareSession`), API `reload()`; index.html — `cmpAnnot` (second annotator), `cmpBind` /
  `cmpToggleAnnot`, `openCompareSession`, `latestCompareSession`, `compareFromContext`, compare key routing.
  FORMAT.md — note `compare` (0.68+, Sight only, ignored and kept by other readers). MANUAL, ARCHITECTURE.
- **Notes:** the "session" is stored in the note (owner's choice) — no server table. The compare runs every clip
  on one clock, so the annotator never drives its element there: pause / seek go through the host (`cmp.pause`
  stops on the frame the selected clip shows; `seekLayer` is not snapped to compare's fps, which can differ from
  the clip's). Binding is lazy (a file's notes are fetched once annotating is on). A session opened from a note
  shows its look without overwriting the saved preferences (only what is changed there is saved). Known /
  deliberately left: while annotating the tools own left drag / touch and keys `[ ] R V L Shift+, .` (leave
  annotating to move splits by touch or use those compare keys); the screenshot tool captures the selected layer,
  not the composite; with the playhead before the selected clip's start a new note takes the clip's frame 0;
  the notes panel open / closed setting is shared with the viewer's.
- Review (fresh agent): 12 findings — report export fighting the shared clock, annotating a hidden layer, two fps
  grids, landing before the fps was known, pause moving the frame after the stroke's ctx, session look leaking
  into saved prefs, one-file sessions, heavy lightbox reload, missing host hooks (versions row, review badges),
  no re-place on panel toggle, key / touch conflicts, wasted fetches; fixed or documented as above. Re-review
  rounds: pause landing a frame late / dimming at a clip's first frame, a step past the end dimming the clip, a
  flash after closing during the fps wait, `reload()` keeping undo and racing its own save — fixed; confirmed by
  the same reviewer.

## 0.67.0 — 2026-11-17 — Sequence: every clip's markers, Shift+, / . across clips, up-front conversion (stage 3)
- **What:** the sequence bar shows tick marks for every clip's drawings / notes (taller = a note's);
  `Shift+,` / `Shift+.` continue into the previous / next clips when the current one has no further marker. A
  clip the browser cannot play is found when the sequence opens and converted ahead of its turn.
- **Where:** index.html — `seqLoadMarks`, `seqMarksFromAnnot`, `seqRepaintSoon`, `seqMarker`,
  `seqProbePlayable` / `seqProbe` / `seqConvertAhead`, marks in `paintSeqBar`, `.seq-mk` CSS; annotate.js —
  `renderMarks` → `host.marksChanged`, `jumpMarker` → `host.seqMarker`, API `marks()` / `loading()`.
- **Notes:** the clip on screen reports annotate.js's exact marks; the others are an estimate from their rows
  (drawings' `ctx.t`, a note mark when `data.note` links it; notes' caption frames) fetched once at open. A
  clip left keeps the marks annotate last reported — a re-read raced the debounced save and dropped new marks.
  `seqMarker` stays put while a jump is pending or the clip's rows are loading (else a fast double press skips a
  clip). Conversion: probes load metadata only; `POST /api/video/transcode` goes out only for clips without a
  picture, **one at a time and only for the next two clips** — the server encodes one job at a time, so queuing
  all of them held back the clip the user jumps to and kept ffmpeg busy after closing. Deliberately not done:
  extending the server RAM cache (`SlidingVideoCache`, one file) to prefetch the next clip — the hidden preload
  `<video>` already pulls the next clip's head; worth it only for slow network drives.
- Review (fresh agent): conversions queued for every clip at once, the left clip's re-read racing its save, a
  just-opened clip reporting no marks (Shift+. skipping it), markers past a clip's end, per-clip fetch / repaint
  cost; fixed (landing at t + 1 ms instead of annotate's quarter-frame kept: correct for stored frame starts).
  Re-review: a clip left while its rows were loading kept no marks, a jump into a clip whose conversion failed
  blocked frame / marker keys (pendT never cleared), probes started from clip 0 — fixed; confirmed by the same
  reviewer.

## 0.66.0 — 2026-11-17 — Touch selection by long-press (Sequence stage 2)
- **What:** on a touch screen (finger or stylus) holding a grid tile ~0.5 s starts touch selection mode with
  just that tile; then a tap toggles a tile (appended, so tap order = sequence order), a double tap opens
  nothing, a tap on empty space does nothing (owner's choice: a missed tile must not drop the selection). A
  bottom bar shows "N selected", *▶▶ Play in sequence* (2+ videos) and ✕; ✕ / Esc end the mode.
- **Where:** index.html — `syncTouchSel`, `startLongPress` / `cancelLongPress`, `lastGridPtr` / `fingerish`
  (after `paintSelection`), grid pointerdown / click / dblclick / pointermove / pointercancel, `onPtrUp`,
  card `draggable`, `selectOnly` (drops `state.touchSelect`), `applyViewDom`, `#touchSelBar` + CSS.
- **Notes:** the mode is the explicit flag `state.touchSelect`, set **after** `selectOnly` (which drops it);
  it also drops when the selection becomes empty (`syncTouchSel` from `paintSelection`). `selectSet` paths
  (Ctrl+A, marquee, find in folder) keep it, as specced. A click's input is decided by the same gesture's
  pointerdown (`lastGridPtr`), not the click's own `pointerType` (older Safari clicks are no PointerEvents).
  The long-press sets `skipClick` when it fires, so the release click does not run `clickSelect`. Cards are
  not `draggable` for touch (a held finger would start an HTML5 drag whose dragstart replaces the selection);
  a pen keeps drag-to-board (drag starts only on movement, a still pen gets the long-press). Behaviour
  change outside the mode too: `pointercancel` (a touch scroll) is now an abort in `onPtrUp` — it no longer
  clears the selection as a click on empty space. The bar hides with the grid (full-screen board) and the
  narrow-screen inspector stops above it. `navigator.vibrate` was dropped (no user activation in a timer).
- Review (fresh agent): 8 findings — scroll from empty space wiping the selection (marquee + pointercancel),
  a missed tap ending the mode, click type taken from the click, pen left out, bar over the board, bar
  covering the inspector, vibrate; fixed (the mode surviving `selectSet` kept as specced). The re-review
  caught that the first fix also blocked pen drag-to-board — restored; confirmed by the same reviewer.

## 0.65.0 — 2026-11-17 — Play in sequence (stage 1 of docs/PLAN-viewer.md "clips in sequence")
- **What:** 2+ selected videos play back to back in the lightbox (Space over one of the selected videos,
  top-bar *▶▶ Sequence*, right-click menu, palette), in selection (click) order, cut to cut without a black
  frame. A sequence bar above the clip's timeline: a segment per clip (alternating accent shades, name),
  playhead, tap / drag across all clips, ⏮ / ⏭ / ⟲ buttons. Keys: ← / → clip, Home first clip, Shift+L loop,
  `,` / `.` cross cuts; ↑ / ↓ and arrows with modifiers do nothing (never step out to grid neighbours). Each
  clip keeps its own notes / drawings (shown through the normal `showInLight` → `annot.setAsset`).
- **Where:** index.html — `seqCandidates` … `bindSeqBar` (before `toggleLight`), `.seqbar` markup + CSS,
  `attachViewer` (`opts.adopt`, `ended` listener, `light.vctl`, `seqOnReady`), `showInLight(a, opts)`,
  `fillStage(…, opts)`, `startVideoCache(…, keep)`, `closeLight`, Space / sequence keys, `paintSelection`
  (`#seqBtn`), context menu, palette; annotate.js `stepFrame` → `host.seqEdge`. ARCHITECTURE "Sequence".
- **Notes:** seamless = the next clip is preloaded in a hidden muted `<video class="seq-buf">` and adopted
  (moved into the stage in the same task, src kept). Measured in headless Chromium: the first frame of the
  new clip is on screen at once but held ~70 ms before playback moves on (play() start latency); a muted
  element starts ~30-60 ms sooner, so the adopted clip starts muted and unmutes on its first new frame
  (`_seqWantMuted` keeps the wanted state across quick adopts). Tried and dropped: a play+pause warm-up and
  creeping the buffer at rate 1/16 before the cut — neither shortened the start. `ended` cuts only after real
  playback (`_seqPlayedAt` from `timeupdate` / `playing`), never on a scrub / seek to the end. Not in this
  stage (PLAN-viewer.md): touch multi-select by long-press + bottom bar, markers of all clips on the sequence
  bar and Shift+, / . across clips, server RAM-cache prefetch of the next clip, probing / converting clips up
  front. Known: `#seqBtn` is only refreshed with the selection (may stay shown after a filter change —
  clicking then just flashes); segment widths settle as clip durations load (assets often have none stored).
  The title shows "Clip i/n · name" (the planned frame number is not in the title).
- Review (fresh agent): 12 findings — key repeat running through clips before metadata, modifier+arrows
  leaving the sequence, `ended` on a scrub to the end, pending landing lost on a converted clip / applied to
  the wrong clip, O(n²) selection check, Space over a selected non-video, prev / next not reusing the
  preloaded clip, last-frame landing by the wrong fps, adopted element's autoplay; all fixed except the stale
  button and segment widths shifting during a drag (accepted). The fixes' re-review found two more (clips
  staying muted after quick adopts, `ended` ignored after a very short play) — fixed; confirmed by the same reviewer.

## 0.64.2 — 2026-11-17 — macOS: dictation no longer kills Chrome
- **What:** on a Mac, pressing the dictation mic a second time (after allowing the microphone) made the whole
  browser quit ("Google Chrome quit unexpectedly", user report on 0.62.1).
- **Where:** `Sight.py` — new `mac_launch_prefix(browser)` (the Sight window's browser is started as
  `/usr/bin/open -n -a <Browser>.app --args …` instead of exec'ing the binary), `close_browser(proc, user_data_dir)`
  (macOS: `pkill -f --user-data-dir=<home>/browser`, since `proc` is the short-lived `open`); `tests/test_mac_launch.py`.
- **Notes:** root cause (by analysis, not reproduced — no Mac here): a browser exec'd by Sight is its child, and macOS
  privacy protection (TCC) makes the parent — Sight.app or the Python behind Sight.command — the "responsible" app
  for the microphone. Neither declares `NSMicrophoneUsageDescription`, so the first real capture gets the browser
  process killed by the system. Through `open`, launchd starts the browser as its own app, which asks for the
  microphone under its own name. Rejected: adding `NSMicrophoneUsageDescription` to Sight.app's Info.plist — it covers
  only the packaged build, not Sight.command (Python / Terminal), and makes Sight, not the browser, the app listed in
  Privacy settings. `-n` keeps a separate instance next to the user's own Chrome (the separate `--user-data-dir`
  needs its own process anyway). Verify on a Mac: dictation twice in a row, window position / size restore, quitting
  Sight when its window is closed, and a failed start closing the window.
- Review (fresh agent): the `pkill -f` pattern was a raw regex (odd characters, `.../browser` also matching
  `.../browser2`) and could run before the browser started — now ERE-escaped, anchored at the path's end, run twice
  1 s apart; confirmed by the same reviewer.

## 0.64.1 — 2026-11-17 — Instant native launch splash (Windows)
- **What:** the launch splash (the Sight logo) shows at once and closes when the page is ready. It was a PowerShell
  window started only after 1 s (PowerShell costs ~0.7 s of CPU to start), so it appeared ~1.7 s in or never.
- **Where:** new `app/splash_win.py` (stdlib ctypes: layered, topmost, click-through, no-taskbar window, GDI+ draws
  `app/splash.png` into a premultiplied DIB, DPI-aware, centred on the monitor under the cursor); `app/splash.png`
  (512 px, rendered from `favicon.svg`); `Sight.py` (`Splash`, `--splash` handled at the very top for the frozen exe,
  started first thing in `main()` before `bootstrap()`); `build_exe.bat` (ships `splash.png`); `tests/test_splash_win.py`.
  Removed: `app/splash_screen.ps1`, `LazySplash`, `start_splash` (no PowerShell fallback).
- **Notes:** out of process on purpose: a bad window procedure can only kill the splash, never Sight. Source runs use
  `pythonw -I -S app/splash_win.py IMAGE EVENT 45`; the frozen build `Sight.exe --splash ...`. The splash waits on a
  named manual-reset event `Local\SightSplash-<pid>`; the launcher creates and holds the event before starting it. Its
  name goes into env `SIGHT_SPLASH` so the `bootstrap()` re-exec into the venv reuses the same splash (exactly one);
  `Splash.forget_env()` pops it right after `bootstrap()` returns and in main()'s finally, so the browser / workers /
  a nested Sight never inherit it. Close points unchanged (ready ping, `_open()` finally, `main()` finally); 45 s cap
  (a hard-killed Sight leaves it up to 45 s — accepted). Keep `splash_win.py` stdlib-only and import-light (only `sys`
  at module level). **Untested on Windows** (Linux container) — checklist in PLAN.md "Left to check on Windows" item 2.
- Review (fresh agent, static): env var leaking to children (medium), import cost, close racing the splash's own
  event creation, 1 px scaling fringe — all fixed and confirmed by the same reviewer.

## 0.64.0 — 2026-11-17 — Missing files on boards
- **What:** a board card whose file is gone (source removed, or asset flagged missing) is a clear "Missing"
  placeholder with the file name and its full path instead of an empty card. Adding the folder again (or a late
  thumbnail) brings the pictures back without reloading the page. Space on a placeholder says "File is missing".
- **Where:** `app/library.py` (`board_items.asset_name` / `asset_path` migration + backfill, `add_board_item`,
  `_migrate_asset`), `app/static/canvas.js` (`fillItemEl`, `forgetAssets`, `refreshMissing`, placeholder CSS,
  `createBody`), `app/static/index.html` (SSE hook, `assetUnderPointer`, Space), `tests/test_board_missing.py`,
  `docs/ARCHITECTURE.md`, `MANUAL.md`.
- **Notes:** `_migrate_asset` previously never touched board items (a moved file left its cards dangling); it now
  rewrites `asset_id` + snapshot (bumps revision). Snapshot is server-owned: not PATCHable; POST falls back to the
  body copy only when the asset row is missing. Backfill runs once, only when the columns are added; cards whose
  asset was already deleted stay without a name ("Unknown file"). `getAsset` caches per page (null = 404 only; other failures are not cached and leave the card alone), `refreshMissing` evicts. Cards in state `ok` are re-checked only on `source` / scan-end events, so a file deleted under a live
  source shows the placeholder after the next scan, not instantly. Checked with Playwright (remove / re-add source,
  placeholder text, Space toast) on desktop; touch relies on the text being on the card (no hover needed).
- Review: fresh-agent review found 2 medium (non-404 errors shown as missing; refresh storm/flicker) + 4 low (migration backfill crash-safety, getAsset race, selectedAssetIds during refresh, uncapped snapshot) — fixed. Re-review found a card left blank after a
  failed (non-404) first lookup: one retry sweep 5 s later (`retryTimer`, at most every 5 s). All confirmed by the same reviewer.

## 0.63.0 — 2026-11-17 — Drawings and review notes on Canvas boards
- **What:** the lightbox annotation tools now work on Canvas boards: brush / pencil / highlighter / eraser / line /
  arrow / rect / ellipse / text / pin / select-transform / undo / styles, plus the notes panel (notes, replies,
  open / in progress / done, drawings linked to notes). Drawings are free over the whole board in world
  coordinates (they do not follow items). A pencil button at the top left of the board and **Shift+A** switch
  the mode; the notes panel starts closed on a board. Two fingers pan / pinch-zoom the board (touch had no way
  to move the camera before). With the mode off the drawings stay visible.
- **Where:** `app/static/annotate.js` (board mode: `isBoard()`, host flags `board` / `frameRect`, `abortGesture`,
  `bounds`, `flush`, `modal` exports, CSS `.light.<state>` → `.an-host.<state>`), `app/static/canvas.js`
  (`annot` option: mount, `bindAnnot`, keys, pinch, `frameRect` / `frameAll`, toggle button), `app/static/index.html`
  (`boardAnnot`, Ctrl+A / modal guards), `app/library.py` (`annotations_for_board`, `board_full` uses it),
  `app/server.py` (`GET /api/annotations?board_id=`), `tests/test_board_annotations.py`, docs.
- **Notes:** rows are `scope='board'`, `board_id` (no `target_asset_id`); not in `.srev` / exports (FORMAT.md note).
  Board mode skips everything that needs a picture (screenshots, review state, versions, picture text, note
  previews, stamp, exports / import; only "Copy notes as text" stays). `modeAllows` shows all drawings on a board
  (no compose / clean-picture mode), a picked note narrows to its drawings and moves the camera to them. While the
  mode is on the canvas keys are filtered to F / A / Esc so X / Delete cannot remove items. Plain A is NOT an
  annotation key on a board (keeps framing); Shift+A toggles. Canvas `persistCurrent` awaits `annot.flush()`
  because `setAsset`'s own flush is not awaited and the item map is cleared synchronously (existing lightbox
  quirk, left as is). `bind2d` runs once per board on the same viewport: `attachInput` is guarded by a WeakSet.
  A loose drawing joins the next note wherever it is on the board (lightbox rule, deliberately kept). Checked with
  Playwright (draw / reload / pan / zoom / item move / board switch / pinch / lightbox regression), not on a
  real touch device.
- Review: fresh-agent review found 1 medium (null surface on board switch) + 5 low (load race, open error path, delete order, Shift+A repeat, Esc/Space leak) — fixed. The first Esc/Space fix
  skipped the palette / popup / overlay Esc (found on re-review): the guard now sits after them in index.html's keydown,
  and canvas.js's keydown ignores `e.defaultPrevented` keys (already used by index.html, which runs first). All fixes
  confirmed by the same reviewer.

## 0.62.1 — 2026-11-17 — Add Folder picker: clean errors, no stale folder, network drives, macOS drives and privacy
- **What:** "+ Folder" fixes. Adding a folder that is gone (deleted, drive unplugged while the picker was open)
  now says "Not a folder" instead of "Internal Server Error". A folder that fails to open no longer leaves the
  picker showing the previous folder's path over an error (where "Add this folder" silently added that previous
  folder): the listing stays and a "Can't open <path>." line is added; reopening the picker on a folder that went
  away starts over at home. Fast clicks on a slow drive can no longer let an older listing replace a newer one.
  Breadcrumbs work for UNC paths (`\\server\share\...`).
- **Where:** `app/server.py` — `add_source_or_400` (used by `POST /api/sources` and `/api/sources/pick`),
  `/api/fs/list` (`os.path.abspath` instead of `Path.resolve()`); `app/static/index.html` — `fbCrumbs`,
  `fbNavigate` (`fbNavToken`), `fbRender(failedPath)`, the `#fbSelect` alert (shows `detail`).
- **Notes:** `/api/fs/list` no longer resolves, so on Windows a mapped drive stays `Z:\...` while browsing (resolve()
  can turn it into its UNC path). `Library.add_source` deliberately still resolves: source ids are sha1 of the
  resolved path, changing that would re-id existing sources — so a source added from `Z:` may still be stored
  under its UNC path, as before. `add_source_or_400` checks the folder itself instead of catching `OSError` around
  `add_source`, because the watcher can raise `OSError` after the row is saved (that stays a 500). The mapped-drive
  case is untested on real Windows. Review (fresh agent): two minor issues (reopening on a vanished folder,
  over-broad `OSError` catch) — both fixed and confirmed by the same reviewer; the footer path is also cleared while no folder is open.
- **macOS (user report: "can't set a source, clicking does nothing; can't delete collections"):** not reproduced —
  the picker, source rows and the collection × all work in WebKit (WebKitGTK + WebDriver, the Safari engine) and
  Chromium, and the API works. Fixed what is Mac-only: external / network drives under `/Volumes` are listed in the
  picker (`fs_roots`, read from the `/Volumes` listing only, never touching a drive, so a stalled share can't hang
  it); a folder macOS privacy protection refuses (Desktop, Documents, Downloads, external drives until Sight is
  allowed — EPERM) shows a "System Settings → Privacy & Security" hint instead of "No subfolders here"
  (`fs_list_dir_checked` → `denied` in `/api/fs/list`, `fbDeniedText`), and adding such a folder is refused with
  that reason instead of becoming a source with 0 files (checked on the resolved path, the one stored). The drive
  list is fetched on every picker open. The collection-delete report stays open: needs the user's browser /
  Sight version / console. Review (fresh agent): checked on the link path not the stored one, stalled-share hang in
  `fs_roots`, double listing — all fixed and confirmed by the same reviewer.
- **Stale modules after an update:** `/static` (annotate.js, canvas.js, keys.js, compare.js, vendor …) was served
  without `Cache-Control`, so browsers cached the modules by heuristic while index.html (no-store) was always new:
  after an update the page could run with the previous version's modules. The user's "broke in 0.62" can't come
  from 0.62's code (it only touched the frame stamp in annotate.js), so this is the likely cause. `RevalidatedStatic`
  (server.py) adds `Cache-Control: no-cache`: the cache stays, every load revalidates by ETag (304 on localhost).
  Review (fresh agent, Starlette 1.10.0, 200 / 304 / HEAD / Range checked): nothing found.
- **Esc closes the Settings panel** (it covers the whole sidebar by design, user's confirmation): in the main Esc
  chain after the lightbox and the search, before clearing the selection / closing the narrow drawers; from a
  settings field it blurs the field first. Through `#settingsHead`'s own click, so the open state is saved the same
  way. Touch: the header itself stays the way to close it. MANUAL (Settings panel). Only while the panel is on
  screen (a closed narrow-screen drawer hides it) and not from a text field outside it; Esc from one of its own
  fields closes it even with a search active (the search is kept). Review (fresh agent): Esc closed the hidden panel
  on narrow screens and cleared the search from a settings field — both fixed and confirmed by the same reviewer; Esc on a canvas board still clears the
  board selection and closes the panel in one press (accepted).

## 0.62.0 — 2026-11-17 — Video annotation: the frame stamp is on by default, switched off per video, burned only while on
- **What:** the frame stamp is on for every video until switched off, and the switch (toolbar icon / `Shift+F`)
  belongs to that one video: off in video A leaves video B stamped. While a video's stamp is on, its label is burned
  into that video's report pictures (ZIP, PDF, reviewer page); off = clean pictures. No separate "burn" option (user's
  decision: the stamp's own button is the switch, set once per video, not per frame). The look (mode, size, colours,
  backdrop, font, position) stays one shared preference.
- **Where:** `app/static/annotate.js` — `S.stampVideos`, `stampOn(aid)`, `setStampOn(aid, on)`, `toggleStamp`,
  `toggleStampPop`, `paintStamp`, `paintBar`, `loadStamp`, the reset handler, `bakeFrame(cv, t, aid)` (early return
  when that asset's stamp is off; `gatherReport` passes the loop asset's id, so "export all" uses each asset's own
  state); MANUAL (Frame stamp).
- **Notes:** stored as `sight.annotate.stamp.videos` → `{ [assetId]: false }` for the switched-off videos only (the
  key is deleted when switched back on), written at once (no debounce), not review data — FORMAT.md unchanged; the
  HTML page and the phone consume the burned pictures. The old global `sight.annotate.stamp.on` (0.60.0) is ignored
  and dropped on the next save; no migration (default on makes it moot). `S.stampVideos` is read once at creation: a
  change made in another tab or on the phone shows after a reload, and this tab's next write stores its whole map
  (accepted for a device preference). Opening the ▾ popover on a switched-off video turns it on again. Review (fresh
  agent, two passes: the "burn follows the toggle" step and the per-video state): nothing of substance; `S.asset`
  drives the live state, `setAsset` repaints the bar, non-video assets return false.

## 0.61.0 — 2026-11-17 — Voice dictation in the annotation text fields (desktop); STT plan revised
- **What:** a microphone button in the note composer (it dictates into the last focused composer field: the note
  or the picture text) and a floating one at the corner of a focused note-edit, reply or picture-text field. Click
  / tap or `Alt+M` toggles; the button pulses while listening; interim words show in a muted bubble, only final text
  goes into the field at the caret (undoable with Ctrl+Z); click, Esc or `Alt+M` stop (pending words land), blur or
  Enter abort. Right-click / long-press the mic: language list (Auto = the browser's language + 14), saved as
  `sight.dictation.lang`. No API (Firefox), a denied microphone or no network → the title and a toast explain it.
  Uses the browser's Web Speech API only (Chrome / Edge online via Google, Safari on-device); no backend, no keys.
  `docs/PLAN-stt.md` is the revised plan; the user's `docs/tmp/stt-implementation-plan.md` is kept untouched.
- **Where:** new `app/static/dictation.js` (`createDictation`, `PROVIDERS.webspeech`, `insertAtCaret`,
  `createDictationUI` → `{mic, toggle, stop, destroy}`, `SHORTCUT`); `annotate.js` (import, `S.dict` / `S.dictTa`,
  the mic + `data-dict` in `buildPanel`, `createDictationUI` in `mount` / `destroy` in `unmount`, a labelled
  `keyTable` row, `dictateNote`); MANUAL (Dictation); `docs/PLAN-stt.md`.
- **Notes:** the original plan (Groq whisper-large-v3-turbo as the main engine + Windows SAPI / macOS
  NSSpeechRecognizer fallbacks, a Python `ISTTProvider` / `STTRouter`, 16 kHz capture) was written for a native
  app: Sight's UI is a web page, so every engine there would run in the Python server with audio streamed from the
  page — heavy for no gain, and it missed the free Web Speech API with live interim text. Revised tiers: (1) Web
  Speech now, (2) optional Groq through a backend proxy that holds the key (any browser, better punctuation, audio
  leaves the machine), (3) local whisper only on demand. Interim text is never written into the field (a textarea
  cannot style part of its text, and it would pollute the undo stack). Mic buttons `preventDefault` on mousedown
  so the field keeps focus (a blur would save and close an in-place edit). The shortcut is also bound in the module's
  capture listener because the field handlers stop propagation; `Alt+M` instead of Ctrl+Shift+M (Chrome / Edge's
  profile menu); on macOS Alt+M types "µ" but `e.code` is still KeyM and the character is suppressed. Chrome ends
  continuous sessions on silence: the module restarts them (cap: 3 restarts within 1 s each; 3 `no-speech` sessions
  ≈ 25 s → "No speech heard" and stop). Not done: Groq, dictation outside the annotation panel, a real-microphone
  test (tests use a fake `SpeechRecognition`), touch long-press on a device. Review (fresh agent) found: document /
  window listeners never removed (two instances after reopening the lightbox — fixed with an AbortController + dead
  flag), a focused field removed without blur kept the mic listening (fixed: a 300 ms `isConnected` tick, privacy),
  the reserved shortcut (changed), the language popover ignoring Esc / `registerAutoClose` (fixed), `no-speech`
  ending the session (now a restart), dead buttons kept (pruned). The same reviewer confirmed all six, nothing new.

## 0.60.0 — 2026-11-16 — Video annotation: configurable frame stamp (live and burned into report pictures)
- **What:** the video annotation toolbar has a frame-stamp icon (+ a ▾ for its settings; `Shift+F` while
  annotating): a label with the current frame over the video, not part of the drawings. Drag it (mouse, pen,
  finger) — it snaps to one of eight spots (corners, side centres). Settings (▾ or a tap on the stamp): Show
  (frame + time / frame / time), size, text colour, backdrop colour + opacity (0 = none), font (normal / bold /
  mono), a 3×3 position picker, Reset. Saved per device. The same settings style the label burned into exported
  report pictures; defaults equal the old look (top-left, white on 60 % black), so nothing changes until touched.
- **Where:** `app/static/annotate.js` — `STAMP_DEFAULT` / `STAMP_POS`, `loadStamp` / `saveStamp` (`sight.annotate.stamp`),
  the "frame stamp" section (`stampText`, `stampBox`, `stampXY`, `paintStamp`, `stampDown`, `toggleStamp`,
  `buildStampPop` / `paintStampPop` / `closeStampPop`), `bakeFrame` rewritten on `stampBox` / `stampXY`, a
  labelled `keyTable` row, hooks in `buildBar` / `paintBar` / `renderAll` / `tick` / `toggle(false)` / `onDown`,
  `.an-stamp*` CSS; MANUAL (Frame stamp).
- **Notes:** device preference, not review data (FORMAT.md unchanged). Size is a % of the picture width (min 11 px),
  so the live label equals the burned one up to tiny displays. Show modes split `RC.frameLabel` on " / " —
  review-core, the HTML page and the phone are untouched (they consume the burned pictures). The burn always
  happened whether or not the live stamp was on (changed in 0.62.0: only while it is on, and on by default); the panel's `f<N>` chip is unchanged. The stamp lives in the turned
  layer root, so it rotates with a turned view; stamp clicks are stopped so a tap does not play / pause. `toggleStamp`
  returns false outside annotation mode (the "Video" key group also runs in the plain lightbox). Drag geometry is
  captured at pointerdown (a zoom mid-drag uses stale values, accepted). Default top-left overlaps the lightbox's
  floating "i" button. Review (fresh agent): `Shift+F` flipping the saved preference from the plain lightbox (fixed),
  the popover swallowing every key after a click on its buttons (fixed: only INPUT / SELECT keep keys, buttons blur,
  Esc closes it), `stampDrag` stuck after a cut-off drag (reset in unmount / toggle / layer creation, `lostpointercapture`),
  Alt gestures blocked on the stamp (fixed), ▾ touch size / `tabular-nums` (fixed). The same reviewer confirmed the
  fixes; its last gap (Esc inside a focused slider stopped at the popover) is fixed by letting Escape through.

## 0.59.2 — 2026-11-16 — Video: Alt-scrub with the select tool; smooth mid-clip scrubbing of long-GOP clips
- **What:** with the annotate select tool (V) active, Alt+drag on empty space scrubs a video (or turns a picture)
  again. Clips with long GOPs (phone / screen recordings: the user's sample has keyframes only at 0 and 8.3 s) now
  scrub smoothly in the middle: after two slow seeks during a drag Sight makes a small short-GOP **scrub copy** in
  the background (≤ 960 px, no audio, keyframe every 4 frames) and shows it over the player while dragging; the
  player lands on the full-quality frame when the drag ends.
- **Where:** `annotate.js` `onDown` (Alt in empty space passes to the viewer); `app/library.py` (`SCRUB_TAG` /
  `SCRUB_VF` / `SCRUB_ENC`, `scrub_copy_path`, `scrub_status`, `start_scrub_copy`, the playback-copy job code takes
  a `tag`, jobs keyed `aid+tag`, kind-aware cleanup, `_prune_scrub_copies`, `_encode_copy` with the playback-first
  priority: `_play_cv`, `_play_waiting`, `_scrub_proc`); `app/server.py` (`POST /api/video/scrub`,
  `GET /api/video/scrub/{aid}`); `video-playable.js` (`convertForPlayback(…, kind)`); `index.html` `attachViewer`
  (`.view-scrub` overlay, `loadScrubCopy` / `pumpScrubCopy` / `hideScrubCopy`, `SLOW_SEEKS` / `SLOW_SEEK_MS` /
  `SCRUB_COPY_MIN_S`, `scGen`); `tests/test_playback_copy.py` (8 tests); MANUAL, ARCHITECTURE.
- **Notes:** root cause measured in Edge: a browser seek decodes from the previous keyframe, so on the sample a seek
  took 5 ms at 0.1 s and up to 230 ms at 8.1 s (≈ 27 ms per second of distance); in a 120-move drag over 3 s only
  24 positions painted mid-clip vs 70 at the start; the RAM cache was irrelevant (the file fits in it). With the copy
  91 of 91 frames paint. The copy is never played (`playback_path` ignores it), lives in `thumbs/video/<aid>_<stamp>.scrub.<ext>`
  (the `<aid>_*` rename / delete globs cover it), is requested lazily (the first scrub of a slow clip is still choppy
  until it exists; clips < 3 s never ask), capped to the newest 20 files / 1 GB (`SCRUB_KEEP_FILES` / `SCRUB_KEEP_BYTES`,
  oldest by mtime, never the one just made). One ffmpeg at a time (`_play_slot`); a playback copy (the "Converting…"
  the user waits for) has priority: a running scrub encode is terminated, returns None and is re-run when the slot
  is free (its job stays "working"; under a steady stream of playback jobs it waits). The overlay shows only while
  `light.scrubbing`, only for a seek of the current drag (`scGen`), is hidden on frame steps / marker jumps and
  after the player presents its own frame (rVFC, ≤ 250 ms); copy and original can differ by a fraction of a frame at
  the hand-over. Left: a changed file's old-stamp scrub copy lingers until the next rescan / scrub; the webm branch
  (`libvpx-vp9 -g 4`) is untested; Playwright's Chromium has no H.264, test with Edge (`channel: "msedge"`).
  Review (fresh agent): trigger too eager and uncapped (fixed: scrub-only slow seeks, two needed, min duration,
  cap), stale overlay frame for up to 250 ms (fixed), silent copy errors (warn), missing tests (added); second
  pass found playback copies queued behind a minutes-long scrub encode (fixed: priority + abort, two tests); third
  pass confirmed everything, two nits (unguarded `terminate()` — wrapped; a copy finished right before the
  terminate is redone, rare).

## 0.59.1 — 2026-11-16 — 3D: alpha cut-outs for USD / USDZ in every shading mode
- **What:** a UsdPreviewSurface whose `opacity` reads a texture now renders its cut-outs (leaf cards, fences):
  `opacityThreshold` 0 / unset → BLEND, > 0 → MASK with that cutoff, on both paths (server GLB conversion and USD
  read in the browser). Cut-outs survive Solid, Vertex, Normal, X-ray, the inspector highlight and the grid thumbnail.
- **Where:** `app/usdz_convert.py` (`_Materials._fill` opacity, `_alpha_into_base`, `_bake_alpha`, `_as_8bit`);
  `app/library.py` (`USDZ_CONVERTER_VERSION` 4 → cached conversions redone); `vendor/jsm/loaders/usd/USDComposer.js`
  (`_applyPreviewSurface`, Sight patch: a separate opacity texture → alphaMap clone tagged `userData.usdAlphaChannel`);
  `app/static/model3d-core.js` (`usdMaterialsAsSight` from `parseUsd`, exported `keepAlpha`, `applyBaseMaterial`
  one temp material per group, `xrayMaterial`, `meshHighlight`); `index.html` (Solid retint for material arrays);
  `tests/test_usdz_convert.py` (`TestOpacity`); ARCHITECTURE, MANUAL.
- **Notes:** the user's `Stylized_Palm_tree_set.usdz` (Sketchfab export) still draws opaque **on purpose**: its
  materials wire no `opacity` at all and every texture is a JPEG without alpha — the leaf image has its cut-out area
  flattened to white. usdview / Quick Look show the same white cards; making it work would need a white chroma-key
  guess (not added; re-export the asset with its alpha instead). glTF has no alpha map, so a separate opacity texture
  is baked into the base colour's A channel (16-bit masks scaled, not clipped); three samples an alphaMap's G channel,
  so the browser path redraws the channel into G. All USD materials are double-sided on both paths (the gprim's
  `doubleSided` is not followed; honouring it would hide open shells). Temp materials read the map's alpha through
  `onBeforeCompile`; `material.clone()` drops that hook, fine because originals never carry it. X-ray scales
  `alphaTest` by 0.3 so MASK cards do not vanish. Limits: opacity on its own UV set / transform, opacity scale /
  bias and float (`F`) masks are not handled; after a bake the unused original base image stays in the GLB.
  Review (fresh agent, run by the block's author): 16-bit masks became binary (fixed), a multi-material mesh was cut
  by one part's texture (fixed); the same reviewer confirmed both, nothing new.

## 0.59.0 — 2026-11-16 — Settings: Scan Filtering with a built-in default filter list
- **What:** Settings "Scanning" is now "Scan Filtering". A list shipped with the app, `app/initial_filtering.ini`
  (OS junk, temp / partial files, databases, shortcuts, VCS / build folders, `.sight/`), applies under the user's
  Ignore list — the scanner skips the union of both. A shield button next to Apply opens "Default scan filters"
  to read / edit that list (Save / Restore shipped). Edits are stored as `<SIGHT_HOME>/initial_filtering.ini`,
  which replaces the shipped file; saving text equal to the shipped list removes the copy again.
- **Where:** `app/initial_filtering.ini`; `app/library.py` (`read_default_filter`, `IgnoreRules(user, default)` —
  the one merge point, `Library.set_default_filter`, `_apply_ignore` shared with `set_ignore`); `app/server.py`
  (`GET / PUT / DELETE /api/scan/defaults`); `index.html` (`#dfOverlay`, `dfOpen` / `dfSend`, an Esc branch in the
  main keydown); `build_exe.bat` / `build_app_macos.sh` (`--add-data` for the ini); tests `tests/test_scan_ignore.py`,
  `tests/scan_filter_modal.cjs`; MANUAL (Scan Filtering), ARCHITECTURE (merge order, endpoints).
- **Notes:** the DB meta `scan_ignore` still holds only the user's list; `/api/state` is unchanged. `.log` / `.ini` /
  `.cfg` are shown as text, so they are never in the ini — a test asserts no extension Sight shows is filtered.
  File-style globs match folder names too (`Shots.bak/` would vanish), so the shipped list only has patterns no
  media folder would carry (`*.bak`, `*.temp`, `*.lock`, `*~` deliberately left out; `Library/` and `*.meta` are
  commented examples only). `SKIP_DIRS` stays the fallback when the ini is unreadable (one warning line, bare
  `logging` → stderr / `sight.log` in a frozen build). The user copy is written atomically (`.tmp` + `os.replace`);
  an unwritable home returns a 500 with `detail`, shown in the modal. The scanner only skips, never deletes.
  Not verified: a frozen build actually carrying the ini (no build was run). Review (fresh agent) found: the
  file-style globs pruning folders (fixed: six patterns dropped + a folder test); saving the unchanged shipped
  text created a permanent custom copy that would miss future shipped updates (fixed); non-atomic write and a
  bare "Failed" (fixed); silent fallback (logged). The same reviewer confirmed every fix, nothing new.

## 0.58.0 — 2026-11-16 — Sidebar: info-panel button, chevrons in the folder tree, counter in the Sources header, type icons, collapsible File block
- **What:** the top bar's item counter is replaced by an *Info panel* button (right end) that shows / hides the
  inspector and its drag handle (pressed while open; on narrow screens it toggles the drawer). The folder tree's
  "+" / "−" became a chevron (right = closed, down = open; Shift+click still expands / collapses all). The total
  "N files" (and the "scanning · N" shimmer) moved from the bottom of the sidebar into the Sources header, right
  of the title. *Sidebar icons* now also covers the Types rows (new "file" and "font" icons in the catalogue).
  The inspector's file block (thumbnail, path, facts) collapses under a "File" header; the state is remembered.
- **Where:** `index.html` — `applyDetails` / `syncInfoBtn` / `narrowMQ`, `toggleDetails` (narrow-aware),
  `#infoBtn`; `statusHtml` / `renderStatus` / `renderSources` (`#srcCount`); `renderFolderChildren` /
  `renderSources` (`.tiny.tree-chev`, `aria-expanded`); `row(…, iconId)`, `KIND_ICON`, `renderTypes`, `ICONS`
  "file" / "font"; `renderInsp` + a delegated click on `#insp` (`navCollapse.inspFile`); the coarse-pointer CSS
  block; MANUAL (Info panel, File block), ARCHITECTURE ("Info panel / sidebar" bullet).
- **Notes:** `state.details` drives the wide panel; the narrow drawer's `.open` is not persisted (a
  MutationObserver on `#insp` keeps the button in sync with the Esc / select paths). Fixed on the way: on narrow
  screens the boot code set an inline `display:none` when `details` was false, so the drawer could never open.
  `#srcCount` is rebuilt by every `renderNav`, so it is painted through `statusHtml()` — keep it that way. The
  multi-selection count lives in the inspector's header ("N selected"), the top bar no longer shows it (by the
  user's choice). Touch: the chevron is always visible there (36 px hit area), and the row's hidden buttons use
  `visibility: hidden` with their space reserved, because a visible chevron made a tap set `:hover`, which revealed
  the "×" and shifted it under the finger (a test tap removed the whole source). Rows are ~22 px per hidden button
  wider on touch. Not done: the collapse is not applied to the multi-selection inspector; subfolder rows get no icon.
  Review (fresh agent): no crash-level bugs; found the touch chevron hidden until hover with a 22 px hit area
  (fixed, which surfaced the "×" bug above), static aria labels (fixed), a sentence spliced into ARCHITECTURE
  (fixed). The same reviewer confirmed every fix, nothing new.

## 0.57.0 — 2026-11-16 — Settings: section title colour / size, compact theme row, gear icon
- **What:** two theme settings for the sidebar section headers — *Section titles* (colour, in Colors) and
  *Section title size* (Typography, 9–20 px); they style the `.sec` band, the Settings header included. The theme
  block is one row: the Theme select, a save icon that appears only while the values match no preset (its popover:
  *Save to <name>* when the last picked base is one of your own themes, and *Save as new…*), a × for a user theme,
  a reset icon, and (dev mode) the *app defaults* icon. The Settings header shows a gear when Sidebar icons is on.
- **Where:** `index.html` — `.sec` CSS (`--sec-fg`, `--sec-size`), `.theme-row`, `DEFAULT_THEME` (`secColor`
  "#e9eaec", `secSize` 12), `BUILTIN_THEMES` (explicit sec keys), `secFallback`, `loadTheme`, `applyUi`,
  `saveTheme` (re-renders the row, guarded by a signature), `renderThemeList` (rewritten), `openThemePop` /
  `closeThemePop` / `setThemeBase` / `themeMatches` / `presetVars`, `resetAllSettings`, `renderOptions`;
  `app/static/defaults.json`; MANUAL, ARCHITECTURE.
- **Notes:** a saved theme or user preset without the sec keys gets them from its own `fg` / `textSize − 1`
  (`secFallback`, applied only when a saved theme exists — with none, defaults.json wins, so reload and Reset agree).
  A 0.54 theme with a custom text size therefore shows *Custom* after the upgrade (its derived size differs from
  the preset's explicit 12). The last picked base is `state.themeBase = {kind, name}` in `sight.layout`
  (persisted when preset matching changes it). The popover is a body-level `.top-pop`: besides `registerAutoClose`
  (pointer-move driven, useless on touch) it closes on an outside pointerdown, Escape (in the main keydown, after
  the select popup), when Settings collapses and when the sidebar scrolls. `.light-info .sec` keeps its own look.
  Review (fresh agent) found: the fallback overwrote defaults.json values on a fresh install (fixed); the gear not
  refreshing when Sidebar icons is toggled (fixed); the popover never closing on touch (fixed); `themeBase` not
  persisted after matching (fixed). The same reviewer confirmed every fix, nothing new.

## 0.56.0 — 2026-11-16 — Review mode: shortcut help under "?", no exit cross, 3D bars centred beside the notes panel
- **What:** the annotation hotkey hints are no longer inline text: a "?" button at the end of the annotation
  toolbar (or `Shift+?`) opens a modal list of every annotate-mode shortcut, grouped (general, editing, drawing
  tools, notes and panels, moving the selection, video, 3D). While it is open nothing underneath reacts — pointer,
  wheel and keys are swallowed; Esc, ?, the backdrop, ✕ (also Enter / Space on it) close it. The × that only left
  the mode is gone from the drawing tools bar (A, Esc or the lightbox annotate button leave it; the notes panel's
  × stays). The lightbox's annotate hint reads "Annotating · ? = shortcuts · Esc leaves". On a 3D model the shading
  and animation bars centre on the area left of the notes panel instead of the full width.
- **Where:** `app/static/annotate.js` (`keyTable()` rows `[combo, handler, label, group]`, `helpGroups`,
  `keyName`, `openHelp` / `closeHelp` / `toggleHelp`, `helpOpen()` in the API, the guard at the top of `onKey`,
  `.an-help*` CSS, `.light.an-panel-on { --an-right: 320px }`); `index.html` (early keydown guard
  `if (light && annot.helpOpen())`, `ANNOT_HINT`, `#v3dShade, #v3dAnim { left: calc(50% + (var(--uv-left) −
  var(--an-right)) / 2) }`); MANUAL, ARCHITECTURE.
- **Notes:** the help is rendered from the same table that fires the keys, so it cannot drift — a new shortcut is
  a labelled row in `keyTable()`; rows without a label are not listed (the reserved D row is labelled only for
  3D). `keyTable()` runs per key / per open, so labels follow the current file's kind. `--an-right` is a CSS
  constant because the panel has a fixed 320 px width and no media rule; `.an-top` / `.an-toast` already shift by
  160 px. At 420 px wide the panel covers the lightbox annotate button — hide the panel first (C or its ×).
  Review (fresh agent): no bugs; three nits fixed (the D row listed for images, the Esc label missing the pin-focus
  step, Enter / Space on the help's ✕ swallowed). The same reviewer confirmed them, nothing new.

## 0.55.0 — 2026-11-16 — About dialog behind the brand mark; icon variants to choose from
- **What:** the "S" tile in the sidebar is now the Sight icon (`favicon.svg`, so favicon and mark are one file)
  and a button: click / tap / Enter opens *About Sight <version>* — version, source or frozen build, Python, OS,
  Starlette, three.js, `SIGHT_HOME`, library DB path and size, asset / source / thumbnail counts, ffmpeg path and
  version, usd-core, port, dev mode, uptime, log file — with a Copy button. `docs/tmp/icon-variants.html` shows
  seven icon proposals (eye, viewfinder S, horizon S, aperture, thumbnail grid, slanted S, focus dot) at 16–256 px;
  the user picked 7, *focus dot* (a ring with the focus point off-centre): `app/static/favicon.svg` is now that
  mark (64-unit box, 6-unit strokes = 1.5 px at 16 px).
- **Where:** `app/server.py` (`GET /api/app-info`, `static_info()` cached once, `ffmpeg_info()` cached only once a
  version line was read, `STARTED_AT`); `Sight.py` (`app.state.port`); `index.html` (`#aboutBtn`, `#aboutOverlay`
  on the `.fb-modal` pattern, `aboutOpen` / `aboutClose` / `aboutCopy`, `.mark` / `.about-*` CSS, Esc branch after
  `fbOverlay`, `aboutOverlay` in the canvas `keysEnabled`); MANUAL, ARCHITECTURE.
- **Notes:** three.js revision is parsed from `vendor/three.core.js` (`three.module.js` only re-exports it).
  Counts, DB size and uptime are live; the thumbnail count is the top-level files of `thumbs/` (cheap). The port
  row is dropped when `app.state.port` is unset (tests build the app without Sight.py). A late response is dropped
  by `aboutToken`; a non-OK answer shows one line in the footer. While About is open every other key is swallowed
  (it is modal; it cannot be opened over the lightbox, which covers the sidebar). Touch: 40 px hit area via
  `.mark::after` in the coarse-pointer block. Review (fresh agent, ran the endpoint) found: a failed ffmpeg probe
  cached for good (fixed), `request.url.port` wrong behind a proxy (fixed: listen port), interleaved opens
  duplicating rows (fixed: token), 24 px tap target (fixed). The same reviewer confirmed every fix, nothing new.

## 0.54.0 — 2026-11-16 — Desktop: Graphite theme (compact, Inter), captions under thumbnails, resizable side panels
- **What:** new default look *Graphite*, picked from five variants on a mock-up stand: Inter 13 px, 26 px menu rows,
  30 px controls, sidebar 208 / inspector 260 px, one blue accent, frameless cards with name + one info line
  under the thumbnail, no serif wordmark. Sidebar section headers sit on a tinted band so they no longer merge
  with their rows (user feedback). The sidebar's and inspector's inner edges are drag handles (mouse, pen, touch);
  double-click resets; widths are remembered. Settings gets *Accent* (colour) and *Captions* (under / on the
  thumbnail); presets *Graphite* (was *Dark*) and *Classic* (the old sizes and colours).
- **Where:** `app/static/index.html` (`:root` tokens, shell CSS, `.sec`, `.card.capb`, `.panel-handle`, touch
  media block; `DEFAULT_THEME`, `CLASSIC_LOOK`, `BUILTIN_THEMES`, `migrateTheme`, `applyUi`, `capMetrics`,
  `layout`, card render, `renderOptions`, `PANEL_W` / `clampPanel` / `resizePanel` / `applyPanelWidths`,
  `bindSplitDrag` pixel mode `o.move`), `app/static/defaults.json` (theme + tileSize 160),
  `app/static/vendor/fonts.css` + `vendor/fonts/inter-*.woff2` (Inter variable 5.1.0, OFL, latin + cyrillic),
  ARCHITECTURE (theme, pane helpers), MANUAL (Look, Panel widths).
- **Notes:**
  - `accent` is new and separate from `border` (before, `--accent` was the frame colour). Anything without
    `accent` (old saved themes, old user presets) falls back to `border` — keep that fallback.
  - `capMetrics()` is the only source of the caption block height: CSS reads `--cap-n-lh / --cap-j-lh`,
    `layout()` reserves `L.meta` in grid and masonry. Change one without the other and rows overlap.
  - Migration: a saved theme holds every key, so new defaults would never show. Once (`themeRev` < 2), keys
    still equal to the 0.53 defaults (`CLASSIC_LOOK`) are dropped and get the new defaults; customised keys
    stay (a custom frame colour keeps its frame width / active colour). Written back after boot. Themes
    saved by builds with other defaults than 0.53 keep those values (treated as customised).
  - Dragging a panel edge does not rescale the tile (the `#mainBody` observer skips while `panelResizing`);
    window resizes still do, as before. Drags keep the library area >= 320 px; a window shrunk later can
    still squeeze it. Narrow screens (< 1024 px) ignore the widths (drawers) and hide the handles.
  - Touch screens and the narrow-screen drawers keep 40 px controls / 36 px rows whatever the theme says
    (media block placed after the base rules so it wins the cascade).
  - Not done: the phone app and the HTML review page keep their own look; mono figures and file-type badges
    from the mock-up were left out. *Classic* does not bring back the serif headings or the grey active row.
  - Review (fresh agent, ran the app in Playwright): caption heights verified exact across 22 grid / masonry
    combinations, init order and presets fine. Found: panel drags rescaled the tile on every move (clamped to
    the list mode, zoom drifted for good) → tile kept during drags + 320 px main-area minimum; touch targets
    shrank to 26 / 30 px on phones / drawers → touch media block; migration dropped the frame of a custom frame
    colour → kept; Classic accent not the old one → fixed; version tag hidden at narrow widths → ellipsis;
    touch hit strip covered the panel's own buttons → moved outward. Left: an empty info line leaves a small gap.
    Second pass (same reviewer): all fixes confirmed (tile drift and touch sizes re-run); found the outward touch
    strip now covered the first card column → strip limited to 12 px outside (the grid padding), 6 px inside. The same reviewer
    confirmed it by tapping in Playwright, nothing new. Keep the outer reach <= `--space-4` (grid padding).

## 0.53.2 — 2026-11-16 — Grid: thumbnails of a re-added folder get their size (masonry) and show after a restart
- **What:** in a source folder that had been removed and added again (or whose files changed while Sight was
  closed), masonry drew every card square and, after a restart, part of the thumbnails stayed placeholders.
  Both fixed; libraries already affected are repaired once on the first start.
- **Where:** `app/library.py` — `thumb_path` (trusted files only) / new `_thumb_file`, `prioritize`, `_make_thumb`,
  `remove_source`, `_migrate_asset`, `psd_composite`; new one-time `_untrust_dimless_thumbs` (marker
  `thumbs/trust_v1`); `_load_legacy_thumb_cache` removed. ARCHITECTURE (thumbnail trust).
- **Notes:** root cause: `remove_source` deletes rows but leaves thumbnail files; ids are path hashes, so a re-added
  folder's new rows (no width/height, `has_thumb=0`) met the old files. `prioritize` / `thumb_path` / the legacy
  glob adopted them silently — no `thumb` event (the client kept its placeholder until the grid re-read the item;
  after a restart the background glob had not run yet when the first page was listed) and no size (masonry falls
  back to square). Now a file the row does not know is an orphan: `_make_thumb` deletes it and renders again (once
  per asset, on screen), which stores the size and publishes the event. The repair untrusts image / video rows with
  `has_thumb=1` and no size (only adopted files can be like that); they re-render as they come on screen. The catch-up
  scan's `has_thumb=0` for a changed file (which left the stale file on disk) is covered by the same rule. Model
  thumbnails (client-rendered) are never deleted by `_make_thumb`. Very old libraries whose rows predate `has_thumb`
  re-render their thumbnails on demand (the legacy glob that adopted them is gone). Orphan files of a removed source
  are still not deleted from disk (deliberately: a delete in the background could race a re-add).
  Checked with a script (add → remove → add again → restart, and the repair) — old code: no size, no events; new: sized, 4/4 events.
  Review (fresh agent) found: repair limited to image / video (PSD, PDF, text, font, audio cards are sized by masonry
  too) → now every kind but `model3d`; `psd_composite`'s fallback marked a thumbnail without a `thumb` event → it now
  runs `_make_thumb` (under `_inflight`); a `remove_source` during a render could leave the id trusted → `_make_thumb`
  forgets it when its UPDATE hits no row; unguarded orphan unlink (Windows, file held open) → guarded; boards ask
  `/api/thumb` without the grid's event and got 202 for orphans → GET serves an untrusted file `no-store` while it
  re-renders (`thumb_file()`, public). Left: a sizeless video whose re-render now fails loses its old thumbnail (rare).
  Second pass (same reviewer): fixes 1–3 confirmed; 4+5 together let an orphan held open on Windows (by that very
  GET) survive a failed render and be trusted with no size → `_make_thumb` trusts a file only with a size when an
  orphan could not be deleted, and the GET reads the untrusted file whole (`Response`) instead of streaming it open.
  The same reviewer confirmed both, nothing new found; the script and unit tests pass after them.

## 0.53.1 — 2026-11-16 — Phone: the gallery button is back (two open buttons again)
- **What:** (phone home) two open buttons again, as before 0.51.0: *Photo or video* (the gallery) and *Open a
  file…* (Files: 3D models with textures, `.srev`, any media) — big on an empty home, two icons in the bar once
  there are reviews.
- **Where:** `mobile/js/app.js` `renderHome` (the pre-0.51.0 code restored from git, comment and subtitle updated),
  `mobile/index.html` (`.bar .mini .ib`, two-column `.opens`), MANUAL.
- **Notes:** why two: Android opens its photo picker only for `accept` limited to `image/*` / `video/*`; an input
  with no `accept` (which 3D and `.srev` need) gets Camera / Camcorder / Files and no gallery — a page cannot add
  a gallery item to that menu. iOS shows its photo library either way. The 0.51.0 entry's "the OS offers photo
  library, camera and Files" was true on iOS only. The gallery button takes one file (`multiple` off, as before);
  `test_pwa`'s `openButtons == 1` counts `label.pick-file` only, still one.
  Review (fresh agent): no code bugs (restore matches the pre-0.51.0 code, tests' selectors / counts hold); found
  ARCHITECTURE's "Home open button" still describing the single button — rewritten; the same reviewer confirmed the fix.

## 0.53.0 — 2026-11-15 — 3D: USD in the lightbox + USD animation, splats on the phone, notes' look on the phone; phone UV sets, background, grid cells
- **What:** (Sight) the lightbox opens `.usd` / `.usda` / `.usdc`, a `.usdz` without usd-core, and plays **USD
  animation** (moving transforms, skeletons) — an animated `.usdz` is read in the browser instead of the server's
  still conversion. The floor grid's colours follow the backdrop. (phone) USD animation plays too; **Gaussian
  splats** open (`.splat` / `.spz` / `.ksplat` / `.sog` / splat `.ply`) with notes on views as in Sight; opening a
  note shows the **shading and light it was written with** (Sight's `v3d`; the phone's notes carry one Sight
  restores). The UV view has no note plate: the UV set is named at the top, a swipe sideways shows the mesh's other
  sets. New Background icon (swatches + colour picker), a smaller grid with round cells and a *Cell* slider, grid
  colours from the background.
- **Where:** `model3d-core.js` (`parseUsd`, `usdAsSight` animated layout, `SPLAT_*` / `splatHome`, `gridColors` /
  `tintGrid` / `niceStep` / `modelGrid`); `index.html` (`loadUsd`, `.usdz` fallback, `makeModelManager().modify`,
  `fetchBufferWithProgress` error `status`, `cloneModel` root skeleton, shared splat constants, `syncRig` tint);
  `usdz_convert.py` (`_stage_animated`, `_root_is_crate`, `convert(…, animated_out)`), `library.py` (`.usd*` in
  MODEL_EXT, `.anim` marker, `usdz_is_animated`, `USDZ_CONVERTER_VERSION` 3), `server.py` (409), `fileinfo.py`
  (`_usd`); phone `model3d.js` (`isSplat`, `createSplatViewer`, `setBg` / `setGridCell`, `uvPicture` set),
  `app.js` (`await V.still`, `goView(vk, look)` / `applyNoteLook` / `noteLook`, note `ctx.v3d`, `showUv`, `viewer`
  title mode, Background / Cell rows, `turnB`), `model.js` (`lookOfV3d`, `v3dOfLook`, `views3d` v3d), `media.js`,
  `index.html`, `tools/build_pwa.py` (Spark + Pass.js). Tests: `fixtures/make_anim_usd.py` (+ `anim.usda`,
  `anim_v001.usdz`, `skel.usda`), `fixtures_3d.make_splat` / `make_splat_ply`, lift GLB with two UV sets,
  `test_usdz_convert.py`, `pwa_3d_formats.cjs`, `pwa_3d_tools.cjs`, `pwa_unit.cjs`. Docs: ARCHITECTURE, FORMAT
  (phone v3d), MANUAL, PLAN-mobile stage 4 (its "not done" list is done).
- **Notes:** an animated USD keeps its hierarchy (each mesh split in place, its parts before its children), so mesh
  order matches the still layout but the explode rig differs from the server conversion's flat one. The server
  calls a stage animated only for what three's USDLoader makes clips of (SkelAnimation; translate / orient /
  rotateXYZ / scale; `xformOp:transform*` only in a binary root layer — the loader's text parser gives it none);
  left: animation in a referenced layer of another format may still disagree. Standalone USD layers find textures
  by base name via `/api/model-res`; referenced USD files are not loaded. A splat `still()` is async: Spark's own
  sorting is switched off while it sorts for the still's camera (else an empty picture, cached for good); the
  desktop's splat view pictures are still synchronous (taken with the live sort order — not changed). Phone stills
  keep the default look (textured, studio, default background) so cached view pictures do not depend on it; a
  note's look is shown, not saved (as Sight's `setV3D`); explode stays the view's (findVk matches by it); phone
  "studio" = Sight's studio environment, Headlight / Flat = Sight's lights without one (Flat reads back as Headlight).
  The desktop grid did not follow the backdrop before (fixed colours) — it does now. Spark: three copies of a splat
  file at peak on the phone; off-screen stills blend in linear space (edges a little different from the screen).
  Reviews (a fresh agent per block; each confirmed its fixes): **USD** — nested meshes out of order in the animated
  layout, `is_animated` too broad (then too narrow: suffixed transform ops; text layers), a 409 hiding the browser's
  own error, Windows texture paths, a race in the marker check, two stage opens — all fixed. **Splats** — stills of
  any other camera came out empty (Spark's async readback) — fixed and tested (a view of one ball only); a closed
  viewer returned a blank picture; turn button flash. **Note look** — Go to / reply / edit-drawing used the view's
  look, the look was saved over the device's — fixed; explode left as the view's on purpose. **UV view** — a URL leak
  after close, a picture remade per swipe, errors outside the try, a failed set remembered — fixed. **Grid /
  background** — the 200-cell cap left the finest grid smaller than the model, mid greys hid the lines, the colour
  picker's row rebuilt under an open picker (iOS) — fixed.

## 0.52.0 — 2026-11-15 — Text plate: resizable, no "…" line under the text
- **What:** (everywhere: Sight lightbox, phone viewer, HTML reviewer page) the picture text plate no longer adds a
  "…" line under the text while more is below — that line came and went with the scroll and changed the plate's
  height; now only the last shown line fades out (mask, 1.2em). The plate is resizable: a small bar just outside the
  middle of its free edge (mouse or finger) — a top / bottom plate stays centred (height by up / down, width by
  sideways), a side plate grows into the picture; double-click / double-tap the bar = default size. One size for
  top / bottom, one for the sides, kept per device as shares of the host.
- **Where:** `app/static/caption-plate.js` (`.scp-grip`, `.sz` CSS, `paintSize`, `orient`, resize branch in
  `down` / `move` / `up`, `lostpointercapture` now ends any gesture, `.editing`); `mobile/index.html` and
  `app/review.py` set the new `--scp-bmax`; `MANUAL.md`.
- **Notes:** the size never goes past the host's room in CSS (`--scp-bmax` for a bottom plate's width — the phone /
  reviewer page keep the pencil / download button free; height ≤ host − `--scp-b` − `--scp-t`; side plates leave
  90 px). Minimum: 120 px wide, head + two lines high (measured at the press). The grip sits outside the plate so a
  tap on the head still folds it (`test_touch` taps there). While editing in place the plate takes the field's
  height. Stored state `{side, min, hz, vt}`; older `{side, min}` reads as no size. In a page loaded through
  Playwright `route` + `setContent` pointer capture does not work — test the plate from a served file.
  Review (fresh agent) found, fixed: a grown bottom plate could cover the phone's pencil / the page's button, and
  a tall one the top bars (CSS caps above); a capture lost mid-drag (plate hidden) left the gesture set and froze
  touch gestures (now ended in `lostpointercapture`, any kind); the minimum height left less than a line and the
  editor cramped; the fade hid most of the fifth line (1.6em → 1.2em); a small grip / 3 px threshold on touch
  (bigger hit box on coarse pointers, 8 px); stale comments. Left: a side plate past its CSS cap stores a bigger
  share than shown (no visible effect). The same reviewer confirmed every fix, then found two small ones, fixed: editing
  collapsed a resized side plate (the editing rule is top / bottom only); a wide bottom plate could reach under a
  landscape notch (`--scp-bxmin`, the phone sets it to its left inset); a top plate uses it too). The reviewer confirmed both.

## 0.51.0 — 2026-11-15 — 3D: animation (Sight + phone), phone mesh pick / hide / UV, shading / grid / light bar; one Open button
- **What:** (phone home) one *Open* button for every kind (big *Open a file* on an empty home, *＋ Open* in the bar):
  no `accept`, so the OS offers photo library, camera and Files. (phone 3D) a tap picks a mesh (orange); a row under
  the header: *Hide*, *Only this*, *UV* (its UVs over its texture in the full-screen viewer), *Show all*, ✕; a tap
  on nothing lets it go. Bottom bar (in `els.tp`): Shading / Grid / Light / Explode icons, each opens its choices in a
  row above (the explode slider moved here from the header). Animated models (glTF / FBX clips), Sight and phone:
  play / pause + time slider (+ clip picker). A 3D view now also keeps the animation pose (`ctx.anim {clip, t}`):
  drawings show only on that pose, going to a view / clicking a note puts it back, pictures / exports are taken there.
- **Where:** `app/static/model3d-core.js` — moved here from index.html and shared: `ENV_PRESETS`,
  `applyBaseMaterial` (now takes the solid params; temp materials copy the original's `side`), `applyXray`,
  `setWireOverlay`, the inspector's highlight (`highlightMaterials`, `meshHighlight` — follows `c.visible`) and UV
  picture (`createUvPainter`, `readbackCanvas`, `textureQuad`); new `createAnimator`. `review-core.js` `animMatch`.
  `index.html`: glTF loaders copy `animations` onto the scene, `v3dAnim`, `#v3dAnim` bar / `paintAnimBar`,
  `bindAnnot3d` (`getAnim / setAnim / withAnim / getAnimState / setAnimState / pauseAnim`). `annotate.js`: views
  carry `anim` (`rebuildViews`, `ctxNow`, `viewMatches`, `goView`, `view3dPic`, the export loop, `tick` sig has the
  view, not the time). Phone: `mobile/js/model3d.js` (`setShading / setGrid / setLight`, `pick / select / uvPicture`,
  `onTap`, `anim`, `still` with a pose), `mobile/js/app.js` (`paint3dTools` rewritten, `paintAnim`, `paintSel3d`,
  `tap3d`, `showUv`, `applyLook3d` / `sight-review:v3d`; `liveLook / viewFits / findVk / ctx3d / goView / viewPic`
  with anim; home open button), `mobile/js/model.js` (`animOf`, `views3d`, `drawCtx`), `mobile/index.html`.
  Tests: `tests/pwa_3d_tools.cjs` + `test_pwa.test_model_tools`, `fixtures_3d.make_glb(anim=True)` (two boxes, clip
  "Lift" moving Box 2, UVs). Docs: FORMAT (ctx.anim), ARCHITECTURE, MANUAL.
- **Notes:** animator + explode: every pose change puts the rig's parts at rest, lets the mixer pose, re-bases
  `it.pos`, re-explodes (so they stack); built right after the rig in both viewers, so an animated model now opens
  at clip 0, t 0 (not the bind pose; framing / floor / rig were measured before — older drawings on such a model
  were made on the bind pose). Last pose = duration − 1 ms (a looping action at its duration shows t 0). A view's
  `anim` is fixed when the view is made (like `hidden`); a view with none, or a viewer with no clips, matches any
  pose. Pressing on the model in annotate mode / opening the phone's pencil pauses the clip (a drawing belongs to
  its pose); the export pauses and resumes. Phone shading / grid / light are the device's, not the review's, and
  view stills always use Textured + Studio without grid / selection (pictures are cached). Not done: a desktop
  shortcut for play / pause; Sight's lights / floor on the phone; shading restored from Sight's `v3d` on the phone.
  Review (fresh agent) found, fixed: phone view pictures took the phone's shading / light into the cache; scrubbing
  while playing rebuilt the bar under the finger; Sight's clip picker kept the last model's names; Sight's annotate
  panel repainted every frame while playing (lost clicks); drawing on a playing model hid the drawing at once; a view
  with a pose never matched on a viewer without clips; the export took views at a moving pose; a stuck "finger"
  count could kill taps; the highlight outlived a hidden mesh; a misplaced comment; several photos picked → only
  the first, silently (now a toast). The same reviewer confirmed every fix and found nothing new. Left (low): taps
  on animated skinned meshes may miss (cached bounding sphere).

## 0.50.0 — 2026-11-15 — Cut / copy / paste of selected drawings (Sight, reviewer page, phone)
- **What:** (Sight lightbox) `Ctrl+X` cuts the selected drawings (`Ctrl+C` / `Ctrl+V` were there); the first
  paste after a cut puts them back where they were, later pastes / pastes after a copy step 20 px down-right.
  (Drawing canvas — HTML reviewer page and phone app) `Ctrl+C` / `Ctrl+X` / `Ctrl+V` with the select tool, and
  for touch *Cut / Copy / Paste* buttons in a small bar under the top bar (shown with the select tool and a
  selection or something to paste). The clipboard lives while the page / app is open, so a drawing copied on
  one frame or picture pastes on another.
- **Where:** `app/static/annotate.js` (`cutSelection`, `S.clipCut`, `paste` offset, Ctrl+KeyX in `onKey`);
  `app/static/review-draw.js` (module `clipboard` / `clipCut`, `ctrlOnly`, `copySel`, `pasteClip`, `.dclip` /
  `clipBar` shown in `paint()`, `onKey`); tests `tests/draw_clip.cjs` + `DrawClipboard` in
  `tests/test_review_page.py`; `MANUAL.md`, `docs/ARCHITECTURE.md` (Drawing canvas); `CLAUDE.md` (new house rule:
  every feature works on desktop *and* on a touch screen without a keyboard — the user's default expectation).
- **Notes:** pasted canvas items get no `id` and no `note` / `reply` / `ctx` (hosts treat id-less items as new
  rows and assign those); `z = ++zc` in the copied items' z order. A paste after a cut is in place only while
  none of the cut drawings is back (an undo restores them → the paste is offset, never an unseen twin on top).
  Pasting onto a picture of another doc size does not rescale; the clipboard is re-centred only when it lies
  wholly outside the new `vb`. Keys not applicable (nothing selected / nothing copied / typing) keep the browser
  default. Not done: the system clipboard (copies stay inside Sight / the page), cut / copy / paste of notes.
  Review (fresh agent) found, fixed: cut → undo → paste stacked an invisible duplicate on the original (both
  editors); copies were stacked by selection / array order instead of z; the new test class sat after
  `unittest.main()`; a clicked button kept the focus (Space / Enter pasted again → it blurs). The same reviewer
  confirmed every fix and the buttons (layout at 360 px, stale state). Left as is (low): the canvas' keys do
  not look at `e.target` (pre-existing); the bar covers ~130×46 px at the picture's top centre while shown.

## 0.49.0 — 2026-11-15 — Phone app: 3D models (glTF / GLB, FBX, OBJ, STL, PLY, USD), notes on views
- **What:** (phone app, PLAN-mobile stage 4) *Open a file…* takes 3D models: `.glb` / `.gltf`, `.fbx`, `.obj`,
  `.stl`, `.ply`, `.usdz` / `.usd` / `.usda` / `.usdc`; files a model points at (a `.gltf`'s `.bin`, textures) are
  picked together with it and kept with it. One finger orbits, two zoom / pan; header: eye, quarter turn, explode
  slider, *Show all* (a view's hidden meshes), *Frame*. Notes, drawings and replies stand on **views** (camera +
  hidden meshes + explode) exactly as Sight writes them — numbered as in Sight, a note may hold several views
  (orbit, draw again), cards / the full-screen viewer / PDF / HTML show each view ("V1", "View 1"), replies are
  written over the model with view chips, a `.srev` round-trips with Sight (checked: phone drawings land on the
  same spot in Sight's lightbox).
- **Where:** `mobile/js/model3d.js` (new: `parseModel`, `createViewer` → `getView / setView / still / attach /
  turn / home / setHidden / setExplode`); `mobile/js/app.js` "3D" block (`viewsNow`, `findVk` / `viewFits`, `ctx3d`,
  `updateCurVk`, `goView`, `viewPic`, `frame3dNow`, `drawModel`, `asyncViewAt`, `picExplode`, `buildStage3d`,
  `paint3dTools`) and 3D branches in cards, composer, replies, viewer, editing, exports; `extras` through
  `openAny` / `openMedia` / `openReview` / `autoKeep` / `rebind`; `mobile/js/model.js` (`views3d`, `explodeOf`,
  `noteViews`, `replyViews`, `drawCtx` keeps hidden / explode); `mobile/js/report.js` (`viewAt`, `burn(…, ox, oy)`);
  `mobile/js/store.js` (`keepFile(key, blob, extras)`); `mobile/js/media.js` (`MODEL_EXT`); `mobile/index.html`
  (import map, CSS). **Shared with Sight:** new `app/static/model3d-core.js` — `frameObject3d`,
  `buildExplodeRig` / `applyExplode`, `buildEnvTexture`, `applyTurns`, `dropDeadTextures`, `stlMesh` / `plyMesh`,
  `plyHeaderIsSplat` moved out of `index.html` unchanged (index.html imports them), `meshOrder`, `usdAsSight`;
  `camMatch` moved from annotate.js to `review-core.js` (`RC.camMatch`). Vendored three@0.185.0 `USDLoader.js` +
  `loaders/usd/*` (USDCParser patched: inlined Vec*d / Vec*h). `tools/build_pwa.py` publishes the three.js parts
  (`THREE_FILES`); `.github/workflows/phone-app.yml` paths. Tests: `tests/pwa_3d.cjs`, `tests/pwa_3d_formats.cjs`,
  `tests/fixtures_3d.py`, `tests/fixtures/parts_v001.usdz`, `parts.usdc`, `mats_v001.usdz`; `test_pwa.py`
  `test_model3d`, `test_model_formats`. Docs: ARCHITECTURE (Phone app → 3D), MANUAL, PLAN-mobile.
- **Notes:** USD is read on the phone (no server): `usdAsSight` lays it out as Sight's server conversion does
  (Z-up → Y-up, no metersPerUnit scale, one mesh per material group sharing the part's vertices, under one
  node), so views from Sight match — verified against `usdz_convert` (bounds, mesh order and boxes, textures);
  left: the conversion drops invisible / proxy meshes, the loader keeps them. The explode rig is built at the
  review's turns, as Sight builds it at its own (both depend on it). A view picture's aspect is what its drawings
  need (1–2.4); drawing uses a still at the stage's own aspect. Not done: splats (refused), hiding meshes on the
  phone, Sight's shading / lights (`v3d`) on the phone, Sight's lightbox reading `.usd*` without usd-core.
  Not checked on a real phone (WebGL memory with big models, the Files picker with several files).
  Review 1 (fresh agent, the 3D review logic) found, fixed: a model picked again while loading left the old
  viewer in use and leaking; a single-part model never matched a Sight view with an explode amount (the
  amount is now kept without a rig); a draft drawn on a new view stayed hidden until the camera moved; the
  view's explode / hidden did not follow Sight's `rebuildViews` / `explodeOf`; legacy views' pictures caught the
  live hidden / explode in the cache; a `hidden` list was added to older Sight views; then (second pass) the
  current view is kept while it fits and a note's own view takes the note's amount, as in Sight. The same
  reviewer confirmed every fix. Review 2 (fresh agent, the formats) found, fixed: every USD texture was dropped
  (its images bypass the LoadingManager), USD mesh order / explode differed from Sight's conversion, picking a
  kept model alone wiped its kept textures, a splat `.ply` was read whole to be refused (and saved first), a
  failed viewer build leaked its renderer; then (second pass) USD faces in no GeomSubset were not drawn, two
  subsets of one material made two meshes, and a mesh's parts were not in Sight's material order — the vendored
  USDComposer is patched (marked "Sight") and `usdAsSight` merges / orders parts as `usdz_convert` does. The same
  reviewer confirmed every fix. Left, documented (low, order only): display-colour-only materials share one key,
  invisible / proxy meshes register their materials.

## 0.48.0 — 2026-11-14 — Picture text plate without scrollbar; page captions on their own line, named downloads; notes as ZIP
- **What:** (everywhere: Sight lightbox, phone, reviewer page) the picture text plate has no scrollbar; while text is
  left below, the last shown line fades and "…" stands under it. (HTML reviewer page) under each picture: its title
  ("clip.mp4 · f128 / 0:05+3", attachments "clip.mp4 · Note 1 · Picture 2") with a download button, the picture's own
  text on the next line in the note's text style (15 px); the download — and a new one top right in the full-screen
  viewer — saves the picture with the shown drawings burned in, named "clip.mp4 · f128 · 0.05+3.jpg" instead of the
  browser's "download.jpg". (Sight) Export → *Notes as ZIP*: a folder per note ("Note 01") with its pictures (drawings
  burned in, named as above) and "Note 01.txt" = the note's text + each picture's text under that picture's file name;
  a still image's cover at the root.
- **Where:** `app/static/caption-plate.js` (`.scp-more`, `paintMore`, `.scp-body.more` mask, `--scp-rt`);
  `app/static/review-core.js` (`picFileName`); `app/static/annotate.js` (`gatherReport(forPage, everyNote)` → per picture
  `title` / `text` / `file`, `frameTitle` / `frameText` / `frameFile`, `shotFiles`; `exportZip`, menu `data-ex="zip"`;
  gatherReport now inside the try of every export); `app/review.py` (`build_zip`, `_zip_part`, `_image_ext`; page:
  `picTitle`, `savePic`, `picCaption`, `capParts`, `.pcap` / `.dl` / `.ptext` / `.zdl`, `frameOf` carries `title`);
  `app/server.py` (`POST /api/review/export/zip`); `MANUAL.md`, `docs/ARCHITECTURE.md`.
- **Notes:** a picture inside the page cannot carry a file name for the browser's own "Save image as" (inline data
  URLs always save as "download"), so naming goes through the explicit download buttons (`<a download>` on a blob).
  PDF captions are unchanged (`caption` / `frameCaption` = "<title> — <text>"); pre-0.48 pages split that caption
  (`capParts`, after the media name). Page downloads draw with `RC.drawCanvas` (no SVG-to-canvas taint). In a container
  with no UTF-8 locale headless Chromium names non-ASCII downloads "download" — run Playwright with `LANG=C.UTF-8`.
  Checked: unit tests; the page driven in Playwright (captions, 15 px texts, download names, burned-in drawing, plate
  "…" / no scrollbar); the ZIP exported from the real app on a temp library (names, txt, burned-in rect). Not driven:
  video / 3D ZIP (no video in the container). Replies are not in the ZIP's txt (not asked).
  Review (fresh agent) found, fixed: a media name of ~125+ chars lost the ".jpg" in ZIP names (`_zip_part` cut the
  whole name — now the stem) and the frame label (`picFileName` now cuts the media name, not the frame); an old page
  on a file named "A — B.mp4" split its caption at the wrong dash; a failing report build left the 60 s toast up. The
  same reviewer confirmed all fixes and found nothing new.

## 0.47.0 — 2026-11-14 — No "note frame" on video; frame numbers on previews; reviewer page viewer as on the phone
- **What:** (Sight + phone) a video note no longer marks the frame it was typed on: its big state-coloured markers
  sit on every frame its own drawings (or a picture text of it) are on; the card's time, a click on the card / a
  marker step go to those frames; PDF / HTML / phone reports carry only those frames (a note with only words keeps
  the frame it was written on as a fallback — on the timeline always, in reports / card previews only when it has
  no attached pictures either). Note previews (desktop panel, phone cards) show the frame number top left.
  (HTML reviewer page) the full-screen viewer is the phone's: round Back + pencil (no "✎ Draw" button), the
  caption plate with the note's text and the picture's own text, a strip slide sideways through the note's pictures
  and up / down between notes (keys ←→↑↓, Esc); the pencil answers on any picture of the note (any frame / view; an
  attachment → a drawn-over copy). Frame labels are "f128 / 0:05+3" (frames after the full second), burned smaller.
- **Where:** `app/static/review-core.js` (`noteTimes`, `frameLabel`); `app/static/annotate.js` (`noteFrames`,
  `noteCtx`, `marks()` / `markerTimes`, marker click, `goNote`, `notePreview` / `previewBox(keep)` / `.an-fno`,
  `replyPreview` per frame, `platePic`, `gatherReport` → `frameCtx` + `more`, `bakeFrame` / `frameTitle`);
  `mobile/js/app.js` (`noteTimes`, `markerList`, `jumpNote`, `noteFrame`, `noteCard`, `fnoTag`, `asyncFrameAt(cls)`,
  `threadFrames`, `noteFrameList`, `selectNote` / `goTo` / `showNote`, `replyEntry`), `mobile/js/report.js`,
  `mobile/index.html` (`.fno`); `app/review.py` (`plate_js`, `%%PLATE%%`, viewer `zoom(group, k)` / `GAL` / `galAdd`
  / `drawTarget` / `noteFrameKeys`, `frameOf` reads `frameCtx`, `drawFrames`, `pickFrame`); `tests/pwa_touch.cjs`
  (selection expectation); `MANUAL.md`, `docs/ARCHITECTURE.md`.
- **Notes:** no format change: `data.ctx` of a note is still written and still the merge / hold anchor; only where
  it is *shown* changed. Reply drawings never pick a note's frames (timeline, both reports, phone) — they show with
  their reply. 3D desktop report likewise uses only views with drawings / texts (fallback: the note's own view).
  The page inlines caption-plate.js + keys.js with their import / export keywords stripped (`plate_js` refuses to
  build if any other import / export appears); the page cannot edit picture texts. On the page a tap no longer
  closes the viewer (Back / Esc do, as on the phone). Checked: unit / PWA / page tests pass; the page viewer driven
  in Playwright (swipes, keys, plate, pencil on a second frame → reply row at that frame). The desktop markers /
  report were not driven in a browser (no video in the container) — read and reviewed only.
  Review (fresh agent) found, fixed: a click on a note's later marker jumped back to its first frame (goNote's
  seek won); a reply's preview drew all its drawings over the typed-on frame (now one preview per frame it drew on);
  caption-only frames had no desktop preview; the phone's card tap ignored the fallback frame for a note with
  shots; the page's pencil offered a flat "reply copy" on a media frame image (now only on attachments); the desktop
  report counted reply drawings when picking a note's frames (video and 3D). A second pass of the same reviewer
  over the fixes confirmed them and found one more, fixed: a click on a reply's frame picture did nothing (the
  `.an-rep` early return in `onListClick`; it now picks the note and seeks there). Left: a drag during a pending slide offsets the
  outgoing picture (cosmetic); 3D labels on the page are a bare "View".

## 0.46.5 — 2026-11-14 — Picture text plate: drag scrolls the text; the head moves the plate
- **What:** the text on the picture plate (lightbox, attached-picture view, phone viewer) scrolls the same way
  everywhere: a middle-button drag moves the words with the mouse (no browser autoscroll), and when the text is
  longer than the plate a plain drag on the text scrolls it too (a finger natively) — the plate is then moved
  only by its head (number / label). Short text: a drag anywhere still moves the plate. A tap still folds it.
- **Where:** `app/static/caption-plate.js` — `pan` / `panDown` / `panEnd` (middle drag; the edit field's own
  scroll while editing), `g.scroll` in `down` / `move` / `up`, `.scp-pan` cursor, auxclick / lostpointercapture.
- **Notes:** same feel as index.html `attachPanScroll` (direct follow, no inertia) — the module can't import it
  (the phone has no index.html). Finger scroll stays native (`touch-action: pan-y` → pointercancel). Tests drag
  the plate by its head already.
  Review (fresh agent) found, all fixed: a middle press while the left button was held fired no pointerdown, so
  its mousedown still started autoscroll / paste (a `mousedown` guard now); a stale `.scroll` class (layout change
  without a window resize) could make a finger drag do nothing (touch decides by the class; a ResizeObserver keeps it
  fresh); a pen both panned natively and by script (only the mouse scrolls by script); new text mid-drag jumped
  (the drag scrolls by the step since the last move). Left as is: a middle press on the pencil / scrollbar also pans.

## 0.46.4 — 2026-11-13 — Annotations: dragging a value of a selected drawing no longer stops at the field's edge
- **What:** with the select tool (V) and a line / shape / text selected, dragging a number in the bar (Width, Size,
  Opacity, Radius…) stopped as soon as the pointer left the field. It now goes on until the button is let go, as it
  did for the tool's own settings (nothing selected).
- **Where:** `app/static/annotate.js` — `numDrag` (new), `renderProps` (returns while it is set), `bindNum` (sets it on
  press, clears it and re-renders the bar on pointerup / pointercancel / lostpointercapture).
- **Notes:** root cause: a change to a selected drawing goes through `commit` → `afterChange` → `renderProps`, which
  rebuilt the bar's HTML mid-drag; the dragged control was replaced and its pointer capture went with it (the tool's
  styles path saves without re-rendering, so it never broke there). Checked in Playwright: a rect's Width dragged
  well outside the field went 4 → 71 (4 → 4.4 before the fix).
  Review (fresh agent): found the flag could stick for good if the lightbox closed mid-drag (the capture is lost at
  the document, not the control) — `numDrag` now holds the control and counts only while it is in the page; and that
  the drag kept writing after the selection changed mid-drag (Esc, Delete, a tool key, undo) — the drag now ends when
  its target (selection ids or tool) changes, and the bar is re-rendered then instead of opening the typing field.

## 0.46.3 — 2026-11-13 — A new note takes every loose drawing
- **What:** adding a note now attaches every drawing that has no note yet, whatever frame / view it is on and
  whenever it was drawn — before, only the loose ones on screen and those drawn since the file was opened. A sketch
  left from an earlier opening of the file (drawn, never added) no longer hangs on its frame. The owner chose this
  over a "delete loose drawings" command.
- **Where:** `app/static/annotate.js` — `pendingDrawings` (just `isDrawing && !data.note`). `MANUAL.md`.
- **Notes:** the compose mode (clean picture, view chips) still counts only recent loose drawings
  (`S.composeSince`, `S.adopt`), so an old sketch alone does not keep the picture clean or show the chips; it is
  still counted in the panel line ("+N drawings (k on other frames)"); an empty Add with only old sketches off
  screen gives the "Type a note…" toast instead of an empty note. Known: a forgotten old sketch (or a loose row from
  another reviewer's file, if any) goes into whatever note is added next, under this reviewer's name.
  Review (fresh agent): no correctness bug; the empty-Add case and two stale comments were fixed. Checked in Playwright (video:
  stroke on one frame, reload, note on another frame took it, no loose rows left).

## 0.46.2 — 2026-11-13 — 3D: view numbers show only while a note is made, above its field
- **What:** the numbered 3D view chips are no longer a row at the top of the review panel. They show only while a
  note is being made (drawing, or typing in its fields), right above the note field, titled *Views of this note*,
  and list only the views the new note will hold: those of the drawings waiting for it and the camera on screen (a
  dimmed dashed next number when that camera is no view yet — adding the note makes it). A chip still goes to its
  view. Added notes show their views as their pictures in the card.
- **Where:** `app/static/annotate.js` — `.an-views` moved into `.an-compose`, `renderViews` (rewritten; called from
  `renderPending` too; markup signature on `el.dataset.sig`), CSS `.an-views`, `.an-vchip.new`. `MANUAL.md` (3D).
- **Notes:** a chip's `mousedown` is prevented so the note field keeps the focus (compose mode stays on). Review
  (fresh agent): found that a module-level signature left an empty block after the panel was rebuilt (fixed: the
  signature lives on the element) and a CSS margin on the new span (fixed). Known, left: a click on a chip while the
  camera is still easing off a view can be lost (the chips rebuild as the current view changes). Checked in
  Playwright with a GLB (swiftshader): hidden at rest, shown while drawing / typing, gone after Add, next-number chip
  after an orbit.

## 0.46.1 — 2026-11-13 — Annotations: drawings added to a note are editable again (0.45.0 lock lifted)
- **What:** the owner asked to roll back 0.45.0: a drawing added to a note (or a reply) can again be moved, scaled,
  restyled, nudged, reordered, partly erased and retyped, as before 0.45.0. Undo again reaches back over adding a
  note; drawings it takes off a note now go to the next note instead of hanging loose (below).
- **Where:** `app/static/annotate.js` — `baked` now returns false (the `baked` / `editable` gate and every call site
  of 0.45.0 / 0.45.1 stay), `addNote` no longer clears undo / redo; `S.adopt`, `applyStates`, `composerBack`. `MANUAL.md`. `app/version.py`.
- **Notes:** supersedes 0.45.0 (archived) and the lock part of 0.45.1. Kept on purpose: the gate itself, so the
  planned lock is one function (see `docs/PLAN.md` "Note locks": an artist may not edit a supervisor's original
  notes, only answer with their own; a resolved note is locked entirely). 0.45.1's other fixes stay: Front / Back
  put the selection above / below every drawing, copies of a reply's drawing clear `data.reply`, the Hold selector
  shows for an editable selection (now any). Its dashed outline for a baked selection is unreachable until a lock
  returns. Checked in Playwright (scratch library): a note's stroke moves with the select tool and Ctrl+Z puts it back.
  Review (fresh agent): no lock path left outside the gate; it pointed out that undo across a note leaves drawings
  hanging, fixed here: a drawing that an undo / redo takes off its note (`applyStates`: note set before, null after)
  goes into `S.adopt`, and `pendingDrawings` / the compose mode take it whatever frame / view it is on, so the next
  note picks it up instead of leaving it loose on its frame. Undoing "add note" (`step.added`, `composerBack`) also
  puts its screenshots back into the pending row and its text / picture text back into the fields (a field already
  typed in gets it on a new line); redo takes them out again when a field still holds exactly that text, and makes
  the picture clean as adding did. A second fresh-agent review of this found no correctness bug (the tagged step is
  always the addNote step; stale `S.adopt` ids are harmless — every use also needs `!data.note`). Checked in Playwright (video, two frames + a screenshot: undo, then a note on a third frame took
  both drawings and the screenshot, no loose rows left). Not cleaned: loose drawings already left in libraries by
  earlier sessions (older than the file's opening, not on screen) still wait on their frames.
  Front / Back keep the 0.45.1 rule (z may go below 0; storage accepts it).

## 0.46.0 — 2026-11-13 — Picture texts: each note picture has its own text, shown on a movable plate
- **What:** a note's text is now its topic, and each of the note's own pictures (the image, a video frame, a 3D
  view, an attached screenshot) can carry a text of its own. Desktop: a second field under *Add a note…* (*Text for
  this frame / view / picture*) gives the new note's picture a text; while a note is picked and one of its pictures
  is on screen, a half-transparent plate over the picture shows the note's text and that picture's text, with a
  pencil to edit it in place; the same plate over an attached screenshot; the note card lists the texts (click =
  go to the frame / view, double-click = edit) and marks previews that have one. Phone: the full-screen viewer's
  caption became the same plate (pencil on it → the text sheet); thumbnails with a text get a corner mark; the
  draw pencil stays bottom right: there the plate keeps to the left edge at the foot and, stuck to the right side,
  ends above the pencil (`--scp-bx` / `--scp-bw` / `--scp-rb` in `mobile/index.html`; under 390 px wide the foot
  plate narrows below 80 % to stay clear; on the left side it starts below Back, `--scp-lt`; desktop keeps the
  defaults: centred, 10 % / 80 %). A fresh-agent review of this layout found the narrow-phone overlap and the
  left plate under Back (both fixed); geometry checked by arithmetic for 360 × 800 and 844 × 390. The
  plate: bottom centre, 80 % wide, more than five lines scroll; a tap folds it into an icon, a tap on the icon
  opens it; a drag sticks the plate / icon to the nearest side (left / right: 25 % wide, 80 % high); side and fold
  kept per device. PDF / HTML exports (Sight and phone) show the texts under the pictures.
- **Where:** `app/static/caption-plate.js` (new, shared ES module), `app/static/review-core.js` (`picKey`,
  `captionOf`, `withCaption`), `app/static/annotate.js` (`.an-cin`, `captionsHtml`, `editCaption`, `platePic`,
  `paintPlate` in `tick`, `showShot(src, from)`, `setCaptionFor`, report payload `withPicText` / `picText` /
  `shotCaptions`; `onDown` / dblclick skip `.scp`), `app/review.py` (PDF `picText` / `shotCaptions`, page
  `picText`), `mobile/js/app.js` (`viewer` → `paintPlate`, `markCap`, `sameFrameT`),
  `mobile/js/model.js` (`setCaption`), `mobile/js/report.js`, `mobile/index.html`, `tools/build_pwa.py` +
  workflow paths (publishes `core/caption-plate.js`), `docs/FORMAT.md` (`captions`), `ARCHITECTURE.md`,
  `MANUAL.md`, tests (`pwa_unit.cjs` captions test; `pwa_touch.cjs` / `test_pwa.py` plate fold / side / edit).
- **Notes:** no format version change: `captions` is an optional note field; older clients keep it. It is note
  content: editing stamps `edited_at`, so merges are unchanged (rule 3) — concurrent edits of two different
  pictures' texts keep only the later note copy, as with text / shots (deliberately not a per-caption merge;
  that would need a parity change in `Library.import_annotations` and `mergeRows`). Frame keys are written as
  `t:<ctx.t to 3 dp>` and read by each client's own frame rule (`same` argument), never by string equality.
  Reply pictures have no texts (the reply's words are theirs). Desktop plate shows only in annotation mode with a
  note picked and the frame / view on screen being one of that note's (its own, one it drew on, one with a text).
  The HTML reviewer page shows `picText` and frame / view captions but not screenshot texts, and cannot edit
  texts yet. 3D was checked by reading only (no 3D asset in the container); image and video were driven in
  Playwright on a dev server with a scratch library.
  Review (fresh agent): no crash-level bug. Fixed: (1) a press on the plate body's scrollbar (mouse, long text)
  moved / folded the plate — `down` now skips it; (2) the HTML reviewer page dropped screenshot texts — `thumbs`
  takes `shotCaptions`; (3) the screenshot overlay's plate leaked its resize listener when the lightbox closed or
  the asset changed — `S.shotView` / `closeShotView()` in `setAsset` / `unmount`; (4) `destroy()` of a plate with an
  open edit ran after `S.asset` changed / after `flush` — the plates are now destroyed first; (5) a click on the
  plate's pencil while editing saved and reopened the editor, a press on the plate while editing folded it; (6)
  `captionsHtml` sorted an unknown view as NaN; a click on a screenshot's text row now opens that picture; the
  plate blocks the browser context menu. Left as is: Enter during IME composition saves early (same as every
  editor here; `hotkey` does not check `isComposing`); a frame text on a frame whose drawings were all deleted is
  listed in the card and on the plate but not in the reports (they walk frames with drawings); the screenshot
  overlay's plate does not follow note edits made elsewhere while it is open; `paintPlate` scans the items every
  frame while a note is picked (cheap at review sizes). Fixes re-tested (unit, PWA touch, desktop Playwright), not
  re-reviewed. Not committed.

## 0.45.2 — 2026-11-13 — Lightbox: Alt+drag scrubs a video; a video turns with Ctrl+Alt+drag
- **What:** Alt is the quick 2D gesture again. Alt+drag on a picture turns it by hand, as before. On a video plain
  Alt+drag scrubs it (sideways on the picture), which is what the Alt-over-a-drawing-tool mode (0.40.0) relies on.
  A video's by-hand turn moves to Ctrl+Alt+drag (Cmd+Alt on Mac). Shift still snaps to 15°.
- **Where:** `app/static/index.html` — the viewer `wrap` `pointerdown` (turn branch condition now
  `altKey && (!isVid || ctrlKey || metaKey)`). `MANUAL.md` (Turn by hand). `app/version.py`.
- **Notes:** the 3D lights are on Shift+right-drag (0.41.1), so Alt is free there; the 3D slider label already says
  "Rotate all (Shift+right-drag)". Canvas Alt+drag (crop pan, background pan) is unchanged.
  Plain drag still scrubs a video, as before. Supersedes the 0.43.0 remark "Alt+drag on a video no longer scrubs"
  and the MANUAL turn line. Ctrl-click on a video does not turn it (the turn needs Alt).
  Known, left as is: in annotation mode the Alt cursor and faded bar also show over a picture, where Alt now turns
  it (`altCam` in annotate.js does not check the kind). On Windows an AltGr press reports Ctrl+Alt, so AltGr-drag
  turns a video too.
  Review: two fresh-agent rounds. Round 1 (the Ctrl+Alt-for-both version) found no correctness bug in the turn
  branch. Round 2 (this version) found three, all fixed here: (1) a `pointercancel` (the browser took the pointer
  mid-drag) set `justScrubbed`, but no click follows, so the next real click on the video was swallowed — `end`
  now takes `cancelled` and sets the flag only on pointerup; (2) an image turn set `justScrubbed`, which the click
  handler (video only) never clears — the flag is set only for a video turn; (3) an Alt-scrub press now calls
  `preventDefault()`, as the turn does, so it does not start a native text selection. Not tested in a browser:
  checked by reading the code and `node --check` on the inline script. Not committed.

## 0.45.1 — 2026-11-13 — Annotations: fixes to the 0.45.0 lock
- **What:** review of 0.45.0 found four gaps, fixed here. (1) The Hold selector changed the on-screen time of a
  baked drawing: it now changes only editable drawings, and it is not shown for a selection with none. (2) Front /
  Back (Ctrl+] / Ctrl+[) could put a new drawing under a baked one or give two drawings the same z: Front now puts the
  selection above every drawing, Back below every drawing, keeping the order inside the selection. (3) A baked
  drawing had handles and a box it did nothing to: now it gets only a dashed outline (it is still selected for Delete);
  the box and handles are for the editable selection. (4) Pre-existing: a copy (Ctrl+D, Ctrl+V) of a reply's drawing
  kept `data.reply`, so once added to a note it was left out of that note's own pictures; copies now clear it.
- **Where:** `app/static/annotate.js` — `renderSel` (`editSel` for the box and handles, dashed rect for baked),
  `renderProps` / the `data-shold` handler, `reorder`, `duplicateSelection`, `paste`. `app/version.py`.
- **Notes:** supersedes the 0.45.0 remark that the properties panel does nothing for a baked drawing: the Hold
  selector still shows (for an editable selection; its value is read from the first editable drawing that has a
  time), and the other controls only ever change editable drawings.
  Not tested in a browser: checked by reading the code and `node --check`. Undo of a Front / Back step is the
  generic z snapshot, as before.

## 0.45.0 — 2026-11-13 — Annotations: drawings added to a note are fixed
- **What:** a drawing already added to a note (or to a reply) can no longer be edited. It can still be selected and
  deleted from the frame (Delete, Shift+Delete, the bin, Ctrl+A then Delete, the eraser in full mode). Moving,
  scaling / rotating / line-end handles, restyling (colour, width, text props), arrow nudging, Ctrl+[ / Ctrl+],
  partial erasing and double-click text editing do nothing to it. Only drawings not yet added to a note are editable.
- **Where:** `app/static/annotate.js` — `baked` / `editable` (new, after `visibleDrawings`), `editSel` (handles and
  handle drags), `onDown` (select tool: a baked hit is selected but not dragged; the move drag takes editable ids
  only), text tool and `dblclick` (only editable text opens), `eraseAt` (partial mode skips baked), `nudge`,
  `reorder` (only editable drawings take part; baked z is kept), `setProp`, `addNote` (clears undo / redo).
  `MANUAL.md` (Annotations).
- **Notes:** `baked` means `data.note` is set, so replies' drawings (`data.reply`) are locked too. Copy / duplicate /
  paste of a baked drawing make a new, editable, unattached drawing (the original stays). Deleting a whole note still
  deletes its drawings with it (`onListClick` `data-del`), as before — that is a note action, not a drawing edit.
  Undo: `addNote` now clears the undo and redo stacks, because an older step could otherwise detach a baked drawing
  from its note or rewrite its fields. Known, left as is: the HTML review page and the phone app are not changed; the
  properties panel still shows a baked drawing's values (controls do nothing to it). Not tested in a browser: checked
  by reading the code and `node --check app/static/annotate.js`.

## 0.44.3 — 2026-11-13 — Annotations: hovering a note no longer highlights its drawings
- **What:** in the desktop lightbox, moving the pointer over a note card in the annotation panel does nothing to the
  picture any more. Before, hover dimmed every other note's drawings and, right after a note was made, brought its
  drawings back. Now only a click highlights: a click on the card (or a video / 3D preview frame in it) picks the
  note, and the picture shows only its drawings, as before. A click on a screenshot still opens it full size.
- **Where:** `app/static/annotate.js` — removed `S.focusNote`, the `pointerover` / `pointerleave` handlers on
  `.an-list`, the `hover` field of `viewMode()`, the `dim` class in `paintVisibility` and the `.an-doc g.dim` rule;
  `modeAllows` now lets a note's drawings back only when it is pinned (`S.pinFocus`). `MANUAL.md` (Annotations),
  `docs/ARCHITECTURE.md` (desktop visibility). `app/version.py`.
- **Notes:** `S.pinFocus` is the only "picked note" state now; every place that cleared `focusNote` clears
  `pinFocus` alone. The card's own CSS hover border (`.an-note:hover`) is unchanged — it is styling, not a highlight.
  Known, left as is: after a note is made the picture stays clean until its card is clicked (it used to come back
  on hover). Not tested in a browser: checked by reading the code, `node --check app/static/annotate.js`, and a
  grep that nothing reads `focusNote` / `m.hover` / `.dim` any more. Review (fresh agent, the whole diff): no
  correctness bugs; its doc remark (a screenshot click does not pin) was applied to MANUAL and ARCHITECTURE.

## 0.44.2 — 2026-11-13 — A new note at another explode is a new view
- **What:** a view is a camera, its hidden meshes and an explode amount (within 0.001). A note or drawing made at
  an explode different from the view it is on (the view has added notes, so the slider cannot move it) gets a new
  view with its own chip, instead of joining the old one. Before, the new note took the old view and its picture
  showed the old amount. Drawings not yet added on the same camera and meshes move to the new note's view when the
  note is added, so they take its amount.
- **Where:** `app/static/annotate.js` — `explodeSame` (new), `findVk(cam, hid, ex)` (matches the amount when given),
  `ctxNow` (the live amount decides the view; a new view's stub carries it), `explodeChanged` (the current view
  first, so two views on one camera do not swap), `addNote` (pending drawings on the same camera and meshes take the
  note's view and amount), the render path (`findVk` with the live amount; the amount is in the redraw signature, so
  a view at another amount hides its drawings until it is current). `MANUAL.md`, `docs/FORMAT.md`. `app/version.py`.
- **Notes:** the drawings of a committed view hide while the slider is at another amount (they belong to the amount
  they were made at); they show again when the slider goes back, or when the chip goes there. A drawing drawn on the
  view before the slider moved, then added with the note, goes to the note's view (the new one) — its overlay was
  drawn at the slider's amount then. The file format is unchanged (rows already carry `explode` and `vk`). Not tested
  in a browser: checked by reading the code and `node --check`.
  Review 1 (fresh agent, whole block): confirmed, fixed: the slider could give a view the amount another view on the
  same camera already had (the drawing then stranded on a hidden view) — the slider now stops at that view; an
  addNote adoption ignored the drawing's own amount (it could move a drawing of another amount into an old note's
  view) — now it also needs the same amount; a legacy view (no row explode) now takes its notes' `v3d.explode`
  instead of matching any amount. Left as is (low): a drawing with a hidden-mesh state unknown (null) is adopted
  by any note on its camera; an empty stub view left in the session is dropped at the next rebuild.
  Review 2 (fresh agent, the fixes): no new bug in the fixes. Confirmed, fixed: with no current view the slider
  gave the first view on the camera the new amount (a jump), so now it moves nothing; `findVk` prefers an exact
  amount over a view with no amount (a legacy one). Known, left: (a) a legacy note newer than a view's last row now
  sets the view's amount on load (newest wins, as in 0.42); (b) on open the saved slider amount is live, so a view
  whose camera matches but whose amount differs is not current until its chip is clicked; (c) a drawing that was
  hidden at add time (its view at another amount) is attached to the note but keeps its own view, so it shows
  with the "other views" count, not on the note's own picture. The last small fixes were checked by the author
  (`node --check`, unit tests) and not re-reviewed by a fresh agent.

## 0.44.1 — 2026-11-13 — Explode: added notes keep their explode; the slider moves only the work not yet added
- **What:** moving the 3D explode slider (or Ctrl+right-drag) no longer changes an added note, its pictures or its
  exports. A note's pictures and exports use the explode it was added at; clicking the note goes back to that
  explode. A view that holds added work (a note, or a drawing attached to one) keeps its amount, and the slider
  does not change it. A drawing not yet added on the note's view takes the slider's amount when the note is added.
  Pictures of two notes on one view can now show two amounts.
- **Where:** `app/static/annotate.js` — `explodeChanged` (refuses a view with added work), `viewCommitted` (new),
  `explodeOf(vk, rows)` (new: a row's `ctx.explode`, else a note's `v3d.explode`), `viewLook(look, ex)` (takes the
  explode), `view3dPic(vk, explode)`, `view3dBox`, `goView(vk, v3d, ex)` (note click passes the note's explode),
  `rebuildViews` (keeps the amount of a view with added work), `addNote` (pending drawings on the note's view take
  its explode), the report / export own-frame and more-views code. `MANUAL.md`, `docs/FORMAT.md`. `app/version.py`.
- **Notes:** before this, the slider changed the view's explode, and the pictures and exports of every note on that
  view followed it. Older notes (before 0.42, no `ctx.explode`) are drawn at the `v3d.explode` they were written
  with; a view's own amount (chips) is still set by the newest row when the file loads, so after a reload a chip
  may go to a different amount than in the session where the view was made. Rows are not rewritten by a slider move.
  The `explodeOf` fallback to `view.explode` remains only for a note with neither value. Not tested in a browser:
  checked by reading the code, `node --check`, and `tests.test_merge_parity` / `tests.test_review_page` (OK).
  Review 1 (fresh agent): two confirmed issues, fixed: `rebuildViews` moved a committed view's amount when a newer
  note was added (kept now); the report's own-frame export was taken at the live slider when the note had no `v3d`
  (fixed). One low-impact mismatch left as is: the preview of another view uses the drawings without replies, the
  export uses them too, so with a reply as the first row on that view they can differ.
  Review 2 (fresh agent): a first note on a new view kept a `null` amount from the empty view state (fixed: only a
  real amount is kept). Legacy notes on a view with no amount could follow a newer row (resolved by the `v3d.explode`
  fallback above).
  Review 3 (fresh agent, delta only): no confirmed bugs; v3d.explode on older notes verified (saved since 0.19);
  `explodeOf` filters by view. Left as design: a view with added work keeps the amount of its first note, so a
  second note made at another amount does not move the chips' amount (`view.explode`) — its own pictures are right.
  Not verified in a browser.

## 0.44.0 — 2026-11-13 — Reviewer page: *Download page* saves the page with your changes
- **What:** the reviewer page (Web page for reviewers) has a *Download page* button next to *Download reply*. It
  saves the same page with this reviewer's replies, pictures, drawings, state changes and new notes already in it.
  The copy opens in any browser with those edits in place and can be answered and downloaded again. *Download reply*
  (.srev) is unchanged and is still what Sight imports.
- **Where:** `app/review.py` (`_HTML_TEMPLATE`: `ORIG` / `DATA_TEXT` captured at the start of the script, `D.edits`,
  `D.copy` in `KEY`, `replyPackage()` split out of `download()`, `saveBlob`, `downloadPage()`, the `#dlpage` button
  in the foot, the status text in `render()`). `tests/page_e2e.cjs` (optional 4th argument: the copy; the copy is
  reopened, must show the reply, its two pictures and the new note, and its .srev merges with nothing added).
  `tests/test_review_page.py`. `MANUAL.md`, `docs/ARCHITECTURE.md`. `app/version.py`.
- **Notes:** the copy is a snapshot of the reviewer's local edits, not of the owner's package: the package and report
  inside stay as exported, so the copy's *Download reply* still merges by ids (a second copy is no duplicate).
  Each copy gets a new `copy` id, so copies do not share localStorage with the page they came from. The copy's
  "From" line is the original sender. Sight cannot import the `.html` — a deliberate gap; import the `.srev`.
  The data block is replaced as a literal string (the first match is the block; `<` is escaped as `\u003c` as in
  `build_html`). Not checked at phone width (the foot now has three buttons).
  Review (fresh agent): no confirmed bugs. Checked: the raw-string escape of `<`, `ORIG` taken before any DOM change,
  `$` patterns in the replace (function replacer), PKG never mutated, re-download idempotent, the .srev unchanged,
  original page KEY unchanged, Discard on a copy stays empty after reload. Dropped drafts are not in the copy (as in
  Download reply); stale attachments in E.att are embedded but filtered out by the reply.

## 0.43.1 — 2026-11-13 — Review panel scrolls with middle-drag like the other lightbox panels
- **What:** the review (annotation) panel's note list scrolls by middle-drag, as the info, PSD, 3D and frame
  panels already do; the wheel still scrolls it natively.
- **Where:** `app/static/annotate.js` — `buildPanel` calls `host.panScroll` on `.an-list`. `app/static/index.html`
  — the `createAnnotator` options pass `panScroll: (el) => attachPanScroll(el)`. `app/version.py`.
- **Notes:** the panel keeps its own look (docked column); only the shared scroll helper is used. The helper adds no
  wheel handler and does not change `overflow`. Review (fresh agent): no confirmed bugs (no clash with the list's
  click / dblclick / hover handlers or the right-button thumb zoom; `buildPanel` runs once per lightbox open, so no
  duplicate listeners). Not tested in a browser.

## 0.43.0 — 2026-11-13 — Lightbox: icons follow the file type; corner icons clear the radius; Alt-drag turns a picture to any angle
- **What:** (1) mirror (`#mirBtn`) shows only for images, PSDs and video; the annotate button (`#annoBtn`)
  shows for those and for 3D models, so documents and audio hide both. (The buttons used to stay visible:
  `.btn`'s `display` beat the `hidden` attribute.) (2) With a corner radius set, the corner icons (file info,
  3D gear, video strip, the 3D shading bar's bottom offset) move in by 0.3 × radius, so the rounding does not
  cut them; a circle mask does not move them. (3) Alt+drag on a picture or video turns it about its centre to
  any angle; Shift snaps the angle to absolute 15° steps (0, 15, 30 …). The angle is saved per file when the
  drag ends. Alt+drag on a video no longer scrubs (plain drag still does). (4) The fit of a turned picture
  uses its bounding box at any angle (for 0/90/180/270 it is as before).
- **Where:** `app/static/index.html` — `.btn[hidden]` rule (next to `.v3d-gear[hidden]`), `.info-fab`,
  `.light-info`, `.v3d-gear`, `.v3d-shade`, `.view-hud` (offsets use `var(--hud-in)`), `applyLightFrame()`
  (sets `--hud-in`), the lightbox setup that sets `#mirBtn` / `#annoBtn` `hidden`, `loadTurn` (fractional
  angle), `fitS()` (bounding box), and the viewer's `wrap` pointerdown / pointermove / `end` (`vs.rotD`).
  `MANUAL.md` (turn, mask). `app/version.py`.
- **Notes:** a turn drag ends with a click on the wrap, which is swallowed (`justScrubbed`) only when the angle
  really changed, so a video does not pause after a turn. The HUD offsets are anchored to the lightbox root, not
  to the frame: with an aspect-locked mask the frame is centred, so the inset is approximate there. The turn is
  stored as a float angle per file (the old integer quarter turns still read back). Alt+drag with the select tool
  in annotation mode still duplicates; Alt over a drawing tool reaches the viewer, as before.
  Review (fresh agent): one confirmed bug, fixed (a video paused after an Alt-turn, because the click after the
  turn drag was not swallowed). Checked and no bug: `hidden` on `#splitBtn` (now honoured, as intended), the
  `calc()` values at 0, fitS at 0/90/180/270, the rotation direction with the mirror on, the normalisation of the
  angle delta, the annotation capture order. Not tested in a browser: checked by reading the code and `node --check`.

## 0.42.0 — 2026-11-13 — Explode belongs to the view; one zoom setting for every zoom (3D and version compare too)
- **What:** (1) explode is kept per view. Moving the slider (or Ctrl+right-drag) at a view with drawings sets
  that view's explode; going to the view (chip, note click, Go to) puts it back and replaces the current amount,
  unless a row on that view was made at the current amount (then it stays). New rows store `ctx.explode`.
  (2) A view's still and the export pictures (PDF / .srev frames of 3D notes) render at the view's explode.
  (3) The zoom settings (Speed, Drag axis, Invert) apply to every zoom: the 3D viewer's wheel, right-drag and
  pinch, and the version compare wheel, as they already did for images, video, text and the canvas.
  (4) Settings header "Zoom (images / video)" is now "Zoom".
- **Where:** `app/static/annotate.js` — `EXPL` / `EXP_TOL`, `rebuildViews` (view.explode from the newest row or
  the slider value), `explodeChanged` (exported), `viewExplode` (used by `goView`), `viewLook` (export paths),
  `ctxNow` (rows get `explode`), `view3dPic` (still at `v.explode`, `S.b3.capture(ex)`). `app/static/index.html`
  — the slider `onChange` and the Ctrl-drag call `annot.explodeChanged`; `explodeMap` moved to the top of
  `boot3d`; top-level `renderStill` (applies the view's explode, `refit` = `onExplodeMoved`, restored in
  `finally`) and `bind3dZoom` (wheel, right-drag, pinch via `dollyOut`, `enableZoom` off); both
  `bindAnnot3d` calls; `createCompare` gets `getZoomSettings`; the settings header. `app/static/compare.js` —
  `onWheel` (speed, invert). `docs/FORMAT.md` (`ctx.explode`), `docs/ARCHITECTURE.md`, `MANUAL.md`. `app/version.py`.
- **Notes:** the slider's value is kept in memory until a new row is made at that view, so a slider change with
  no drawing is lost on reload (rows are never rewritten). A view's explode is the newest of the row values and the
  slider value by timestamp; a phone row stamped with a clock ahead of the desktop can win over a newer desktop
  slider. Rows from before 0.42 have no explode: their views keep the live amount. A pinch uses the speed only
  (its direction is the finger gap). The splat viewer keeps zoom toward the pointer via OrbitControls'
  `_updateZoomParameters` (a private method; guarded with `?.`). `review-draw.js` (exported review page) and the
  mobile app keep their own zoom settings. Not tested in a browser: checked by reading the code, `node --check`
  and the two review passes. Review 1 (explode): a report path used the note's unstripped explode (fixed:
  `viewLook`); `renderStill` had no `finally` and no refit (fixed). Left as specified: any row on the target view
  made at the current amount keeps it. Review 2 (zoom): pinch was lost with `enableZoom` off (fixed: pinch in
  `bind3dZoom`); the modifier check blocked the right-drag in the splat viewer (fixed: only the Ctrl / Shift
  handlers that already stop the event take it); the splat right-drag was not cursor-anchored (fixed).

## 0.41.2 — 2026-11-13 — 3D note pictures are stills: a light change no longer re-renders them
- **What:** the pictures on a 3D note's card (one per view the note's drawings were made from) were re-rendered
  every time the shading or the lights changed, so they looked like live mini-viewports. Now each view's
  picture is taken once and kept; moving the light or switching shading leaves it as it was. The drawings on
  top are still vector and follow the view as before.
- **Where:** `app/static/annotate.js` — `view3dPic` (cache key no longer includes the shading; `PIC3` maps the
  key to the data URL), the comment above it. `docs/ARCHITECTURE.md` (3D pictures), `MANUAL.md` (3D). `app/version.py`.
- **Notes:** supersedes the 0.40.1 / 0.40.2 decision to re-capture on a shading change. The still is the one
  made at first use, so it shows the lights the viewer had at that moment, not the note's saved lights; a
  still made while the light is being dragged keeps that light. Still JPEG ≤640 px at quality 0.85, unchanged.
  Stills are per session (cleared by `resetPF`), so a reopened review takes them again with the current lights.
  Explode stays in the key: the first version dropped it with the shading, so a note's still would show the
  assembled model after the explode slider moved (the drawings were made over exploded parts). Found by a fresh
  review (correctness; 1 confirmed finding, fixed; camera, asset reset and null-capture paths were checked OK).
  Not yet checked in a browser: the change was verified by reading the code and a syntax check of annotate.js.

## 0.41.1 — 2026-11-13 — Drawing: round stroke ends, brush circle follows the pen, Alt no longer draws from the centre; 3D light on Shift+right-drag
- **What:** (1) a brush / pencil stroke's start and end are round caps: they used to bulge into the stroke
  (a notch at both ends). (2) The brush circle follows the pointer while a stroke is being drawn (it was
  frozen at the press). (3) With Alt held over a drawing tool the brush circle is hidden (Alt moves the camera).
  (4) Alt no longer draws shapes from the centre (rectangle / ellipse); Shift still makes a square / circle.
  (5) The 3D light direction moves with Shift+right-drag (was Alt+left-drag); the info panel's "Rotate all" label
  says so.
- **Where:** `app/static/review-core.js` — `strokeOutline` (both cap arcs: sweep flag 0; shared with the phone
  app and the HTML page). `app/static/annotate.js` — `renderSel` (circle shown while drawing, hidden under Alt;
  the eraser drag keeps its own circle), `onMove` (stroke branch calls `renderSel`; the Alt shape branch removed),
  `paintAlt` (redraws the circle), the tool labels. `app/static/index.html` — the light-drag `pointerdown`
  (`button 2` + `shiftKey`, no ctrl / meta / alt), `lightYaw` comment and the "Rotate all" label.
  `MANUAL.md` (drawing and 3D). `app/version.py`.
- **Notes:** the cap test: a stroke rendered in headless Chromium from `primsOf` has ink 6 px past both ends
  (before the fix: white there, the cap cut inward). The circle test: with pen events the circle stays on the
  pointer while drawing and is gone while Alt is held. Pressure: a pen stroke with simulated pen pressure
  (CDP `force`, `pointerType: 'pen'`) is 8 px at 0.95 and 2 px at 0.15, so the drawing path uses pressure when the
  browser reports a pen. Not changed: a tablet that reports `pointerType: 'mouse'` (its driver in mouse mode)
  or a brush with the Pressure toggle off draws at constant width by design.

## 0.41.0 — 2026-11-13 — 3D views keep the hidden meshes; numbered in the order they were made; note pick shows its drawings while drawing
- **What:** (1) a view (camera) also records which meshes were hidden (H / Ctrl+H / Alt+H) when it was made;
  a change of hidden meshes starts a new view; going to a view (chip, note click, Go to) shows its meshes as
  they were. (2) The views are numbered in the order they were first made, so the chips, the "View N" labels,
  the pictures of a note and the report agree; the pictures of a note are in view-number order. (3) Clicking
  a note now shows its drawings even while new drawings that are not yet attached to a note are on the
  screen (before, any such drawing hid every note's drawings until it was attached). (4) A note's drawings-count
  caption ("N drawings") is gone; "from <name>" stays.
- **Where:** `app/static/annotate.js` — `rebuildViews` (views sorted by first made; `hidden` from the items'
  ctx), `curHidden` / `sameHidden` / `viewMatches` / `findVk(cam, hid)`, `ctxNow` (3D ctx carries `hidden`),
  `view3dPic` (applies a view's meshes for its picture, restores the live ones; cache key has `hidden`),
  `view3dPreviews` (sorted by `viewNumber`), `goView` (restores `hidden`), `tick` (mesh state in the signature),
  `modeAllows` (a pick wins over `compose`), `renderPanel` (count caption removed). `app/static/index.html` —
  `bindAnnot3d` host gets `getHidden` / `setHidden` from `v3dInspect.meshes`. `docs/FORMAT.md` (3D `hidden`),
  `MANUAL.md` (3D). `app/version.py`.
- **Notes:** the mesh index is the inspector's traversal order, so it is stable for one file only (views are
  per asset, as before). Views made before 0.41 have no `hidden` and match any mesh state, so an old view keeps
  its old behaviour. A 3D preview is still re-captured when the shading changes (0.40.2). Not tested in a
  browser yet: the view-number order, the mesh restore and the pick-while-drawing case were checked by reading
  the code and by a syntax check of annotate.js and the inline scripts of index.html.

## 0.40.2 — 2026-11-13 — Video: drawings show at once after a timeline scrub
- **What:** after a scrub or a seek that lands in the second half of a frame, the drawings of that frame were
  not shown (a new stroke was saved but stayed invisible until the time moved again). Desktop lightbox and
  phone both now decide "the frame on screen" with the same rule the drawings are stored with (the frame's
  start), so the frame's drawings show at once.
- **Where:** `app/static/annotate.js` — `frameNow()` (video: `frameStart(v.currentTime)`). `mobile/js/app.js` —
  `stageDrawings()` (`frameStart(scrubT or currentTime)`). `app/version.py`.
- **Notes:** `ctxVisible` (review-core.js) is a window centred on the stored time (±half a frame), and a
  drawing is stored at `frameStart(t)` = (n + 0.01)·fd, so the frame's own time must be the stored one, not
  the raw player time. Any new "what is on screen" check for video must pass `frameStart`, never the raw time.
  Checked by computing `ctxVisible` on the real review-core.js: raw 2.915 s hid the drawing stored at 2.880,
  the frame start shows it. Not yet checked in a browser with a video scrub.

## 0.40.1 — 2026-11-13 — Review fixes: undecodable clips, list selection, 3D preview cache, phone menu key, PDF sizes
- **What:** (desktop) an undecodable clip that the server cannot convert stops its preview frames at once
  (no 4 s-per-frame retries in one serial pump); (desktop) a text selection dragged out of a note card and
  released in the gap of the notes list no longer drops the picked note; (desktop) 3D previews keep one picture
  per view, replaced when the shading changes, instead of one per shading step. (Phone) the menu key on a
  mouse works again within 1.5 s of a press on a row; a picture without its size is reported in the console
  instead of left out of the PDF silently.
- **Where:** `app/static/annotate.js` — `pumpPF` (`PF.failed`, cleared by `resetPF`), `onListClick` (the empty
  branch checks `getSelection`), `view3dPic` (`PIC3` keyed by asset + view + camera, value `{shade, url}`).
  `mobile/js/app.js` — the row's `contextmenu` (the mouse exemption restored). `mobile/js/report.js` — `rows()`.
  `app/version.py`.
- **Notes:** the Alt-from-centre loss from 0.40.0 is NOT changed here (MANUAL.md still describes it; decision
  pending). A 3D preview is still recaptured for a shading change: the picture must show the shading, so the
  capture moves the live camera twice per view (set and restore). `PF.failed` is per asset: a reopened review
  resets it, and a clip that later becomes decodable needs that reset. The PDF size warning is for a caller
  bug only; `picOf` and `burn` always set `w` / `h` today.

## 0.40.0 — 2026-11-13 — Annotations: hold Alt to move the camera or scrub without the select tool
- **What:** in annotation mode with a drawing tool, holding Alt makes a drag go to the viewer instead of
  drawing: a 3D model orbits, a video scrubs (sideways on the picture). While Alt is held the annotation bar
  and the notes panel do not take the pointer (they are faded). Releasing Alt draws again. With the select
  tool nothing changes (Alt+drag still duplicates).
- **Where:** `app/static/annotate.js` — `altCam()`, `paintAlt()`, `altChanged()` (keydown / keyup of
  `Alt`, blur resets it, like Ctrl); `onDown` (returns before `grab` when `altCam()`); `setTool`, `toggle`
  and `updateCursor` (cursor / class follow it); CSS `.light.an-alt`. `MANUAL.md` (Annotations), `docs/ARCHITECTURE.md`
  (annotation input). `app/version.py`.
- **Notes:** the state is only the Alt key's `keydown` / `keyup` (the same pattern as Ctrl, which is the
  eraser modifier, not a shortcut through `hotkey()`). Shapes lose their "Alt from centre" while Alt is held
  (the press is the viewer's); the select tool's Alt keeps its meaning. Checked with Playwright on the scratch
  GLB: a plain drag draws; with Alt held the drag changes the view and draws nothing, the bar takes no
  pointer (`elementFromPoint`), and after release drawing works again. On the scratch mp4 an Alt-drag
  moved the playhead from 0.0 s to 3.1 s with no drawing. No page errors. Not checked: Mac Option (same
  `Alt` key name, not run), Safari / Firefox, pen tablets. Not committed. The fresh-agent review CLAUDE.md
  asks for was not run (no subagent requested).

## 0.39.0 — 2026-11-13 — 3D notes show a picture per camera view, like video notes
- **What:** a 3D note's card shows a picture of each view its drawings were made from (the note's own view
  first, then the others in the order drawn), with the drawings over it, as a video note shows its frames.
  Clicking the picture of another view picks the note and moves the camera there. A note made from drawings
  on several views (orbit, draw, orbit, draw, then Add) gets one picture per view; the drawings then leave
  the picture as before (the clean picture).
- **Where:** `app/static/annotate.js` — `PIC3` cache, `view3dPic(vk)` (renders from the view's camera with
  `S.b3.capture()`, JPEG ≤640 px, camera put back), `view3dPreviews(n)` / `view3dBox(n, list, cls, goVk)`
  (called from `notePreview` for `model3d`), `resetPF` clears `PIC3`, `onListClick` (`.an-nprev[data-vk]`),
  CSS `.an-nprev[data-vk]`. `MANUAL.md` (Annotations), `docs/ARCHITECTURE.md` (3D previews). `app/version.py`.
- **Notes:** the picture uses the viewer's current shading, not the note's saved one (the saved one is applied
  only when the note is opened, as before). It is made on demand and kept per asset / view / shading; no
  picture is made while a drag (orbit or stroke) is on, so it can show up one refresh later. A note with no
  drawings has no picture, as with video. Checked with Playwright on a scratch GLB: a note from three views
  shows three different renders with their drawings, a click on the second picture moves the camera there and
  the chip follows, the camera stays where it was after the renders, and no page errors. Not checked: a model
  with a very large canvas, Safari / Firefox, the reports (they already capture per view). Not committed. The
  fresh-agent review CLAUDE.md asks for was not run (no subagent requested).

## 0.38.2 — 2026-11-13 — Desktop: a click on the empty notes list drops the picked note
- **What:** in the desktop lightbox's notes panel, a click on empty space in the list (below or between
  the cards) clears the picked note (the `.on` card, its drawings and the view), the same as Esc.
- **Where:** `app/static/annotate.js` — `onListClick` (the no-target branch: `S.pinFocus` / `S.focusNote`
  cleared, `paintVisibility`, `renderPanel`). `MANUAL.md` (Annotations). `app/version.py`.
- **Notes:** a card click still picks it (and a second click on it drops it, as before). Only the note
  pick is cleared; drawing selection is left as it was, like Esc. Checked with Playwright on the scratch
  `SIGHT_HOME`: picked card → 1 `.on`, click on the list's bottom padding → 0, card click → 1 again; no page
  errors. Not committed yet. The fresh-agent review CLAUDE.md asks for was not run (no subagent requested).

## 0.38.1 — 2026-11-13 — Desktop: the picture goes clean as soon as a note is made
- **What:** in the desktop lightbox, once a note is made (Add button or Enter) its drawings and every other
  note's drawings leave the picture at once. Before, they stayed on screen until you started a new drawing.
  A note's drawings come back while its card is hovered or pinned (click); typing a new note, starting a
  drawing or picking a note ends the clean picture.
- **Where:** `app/static/annotate.js` — state `cleanPic`; `addNote` sets it; `viewMode` clears it on compose
  or a pin; `modeAllows` hides note drawings while it is set (except the hovered / pinned note); `setAsset`
  resets it. `MANUAL.md` (Annotations), `docs/ARCHITECTURE.md` (desktop visibility). `app/version.py`.
- **Notes:** opening a file still shows every note's drawings (the idle default is unchanged). Checked with
  Playwright on a scratch `SIGHT_HOME` with a few images: visible note drawings went from 1 (while
  composing) to 0 after Add and after Enter; hovering a card shows its drawings; no page errors. The phone
  app (`mobile/`, `.review.clean`) was not changed and was not checked for the same symptom. Not committed.
  The fresh-agent review that CLAUDE.md asks for was not run (no subagent was requested).

## 0.38.0 — 2026-11-13 — Old video the browser cannot decode plays through a converted copy
- **What:** old .mpg / .mpeg / .vob (MPEG-1/2 program streams), DivX / Xvid, MS-MPEG4, WMV, FLV, H.263,
  Cinepak, MJPEG, DV, Huffyuv, SVQ1 and any other video the browser gives no picture for now open: the
  lightbox shows "Converting for playback… N%", the server converts a copy once with ffmpeg (H.264 + AAC
  in MP4; VP9 + Opus in WebM when the ffmpeg has no x264), and the video plays from that copy. A file that
  cannot be converted shows "Cannot play this file: <ffmpeg's last line>". Copies are kept under
  `thumbs/video/` and served from then on, so the next open needs no conversion.
- **Where:** `app/library.py` — "playback copies" section before `_decode_peaks` (`playback_path`,
  `playback_status`, `start_playback_copy`, `_run_playback_copy`, `_play_encoder`); `_migrate_asset` moves
  copies on a rename; both delete paths drop them. `app/server.py` — `/api/file/{id}`, `/api/video/focus`
  and `/api/video/cache` read `lib.playback_path(a)`; new `POST` / `GET /api/video/transcode`.
  `app/static/video-playable.js` (new: `convertForPlayback`); `index.html` (`watchPlayable`, called from
  `startVideoCache`); `annotate.js` (the note-preview player's first load); `compare.js` (video layers).
  `tests/test_playback_copy.py`. `MANUAL.md`, `app/version.py`.
- **Notes:** the copy is named `<aid>_<size>_<mtime_ns>.<ext>`: a changed source is never served a stale
  copy, and the next conversion removes the older ones. One conversion runs at a time (`_play_slot`);
  the status is kept in `_play_jobs` per asset and a failed one is tried again on the next open. The
  fallback fires on a player error or when metadata arrives with no `videoWidth` (so an audio-only
  "video" is converted too, harmlessly). Files the browser plays are never converted. Deinterlacing
  (`yadif`, only frames flagged interlaced) and even dimensions are part of the conversion. The
  copy is the thing the SlidingVideoCache window runs on, so `focus` / `cache` take the copy's path.
  Checked: every codec in the probe set converted to H.264 and played in Playwright's Chromium through
  `/api/file/` (`ffprobe` shows h264 + aac); the lightbox was driven end to end on an MPEG-2 file with its
  copy removed (error → conversion → picture + playhead moving) and on a non-video .mpg (error message).
  Not checked: the note-preview player and the compare overlay with a converted file (their code is the
  same pattern but not driven in a browser), Safari / Firefox / Windows Chrome. The per-block review by a
  fresh agent that CLAUDE.md asks for was not run (no subagent was requested in this session). Not committed.

## 0.37.1 — 2026-11-13 — 3D: camera positions no longer become "View N" while orbiting
- **What:** with a 3D model open and annotation on, moving the camera (orbit, zoom) added a "View N" entry
  to the panel's view chips and to the pending line for every camera position it passed, with no drawing
  in it. Now a view is recorded only when a drawing or a note is made from that camera.
- **Where:** `app/static/annotate.js` — `ctxNow(forNote, make)`: the panel's pending line calls it without
  `make` and gets `{vk: null, cam}` (no view registered); `newItem`, paste / duplicate and `addNote` pass
  `make = true`.
- **Notes:** the pending line shows no view label while the camera is off every recorded view (it used to
  show the next number). Checked with Playwright on a GLB: an orbit leaves the chips unchanged; one brush
  stroke adds exactly one view.

## 0.37.0 — 2026-11-13 — Desktop review fixes: report names and frame numbers, previews, 3D errors, usd-core install
- **What:** (1) Phone review app on a desktop: a mouse right-click (and Ctrl-click on a Mac) is the browser's
  own menu. The card's menu and the speed / sound controls no longer take it; a touch or pen long press
  still opens the app's menu. (2) PDF and web-page reports name each video frame "<file> · frame N" and burn
  "frame N" into its top-left corner (N = the number the panel shows as "f N"); a 3D view is "<file> · View N",
  an image note "<file>". (3) Note previews of video frames: the hidden preview player is in the document, a
  seek counts only when the player sits on the wanted time with its seek over, a frame not decoded yet is asked
  again (three tries), and a player that fails to load is dropped and made again. (4) A 3D model that fails to
  load shows "<ext> — could not open: <reason>" and stops its render loop (it no longer stays in the loading
  state). A .usdz that cannot open says why: the USD library is missing (a source run prints the pip command),
  the file is gone from disk, or it did not convert. (5) Sight.py: the first-run install of usd-core goes
  through the runtime's own pip when uv is absent, and a failed install is logged with its last error line.
- **Where:** `app/static/annotate.js` (`gatherReport` + `frameNo` / `frameTitle` / `viewTitle` / `bakeFrame`;
  `pfLoad`, `pfSeek`, `pumpPF`, `resetPF`); `app/static/index.html` (`fetchBufferWithProgress` throws the
  server's detail, `loadModel` usdz branch, `boot3d` catch); `app/server.py` (`usdz_problem(a)` as the 404
  detail of `/api/model-glb/{aid}`, `import sys`, `importlib.util`); `Sight.py` (bootstrap usd-core install);
  `mobile/js/app.js` (card `contextmenu`, `vdrag`); `MANUAL.md` (export captions); `app/version.py`.
- **Notes:** not reproduced on Linux Chromium, so no change was made for: the notes panel disappearing when
  annotating (A / the button / 3D Shift+A all keep it), a drawing covered by the frame while drawing, and the
  Mac marquee. The preview changes are written for WebKit (the video in the document; the position check),
  not checked on macOS. FBX display is NOT changed: the reported FBX problem is still open (the loader waits up
  to 20 s for textures before the model is shown; no FBX sample was available here). Runtimes made before this
  version (their `.deps-v4` marker is set) do not retry usd-core: `python -m pip install usd-core` in the
  runtime. The draw canvas (RMB zoom) still blocks the browser menu on a right-drag, because on a Mac the menu
  opens at press. The phone's own PDF captions (`mobile/js/report.js`) are unchanged. Review (four fresh
  agents, one per block): fixed the keyboard menu key being taken by the card menu, the PDF label scale after
  a downscaled frame, a seek timeout caching the old picture, the usdz reason for a missing file, and the
  dead `null` branch; the notes that the loading state was not endless at HEAD (an outer catch existed) are
  reflected in the wording above.

## 0.36.3 — 2026-11-13 — Canvas: the Arrows / Shapes slots restyle a selection
- **What:** with the select tool and arrows / lines (or rectangles / ellipses) selected, the Arrows
  and Shapes rows' choices (heads / dash / line; rectangle, rounded, ellipse, filled or not) and the
  Shapes row's fill colour now change the selected items. Before, the pick switched to drawing with
  that tool and dropped the selection, so an arrow's heads or a shape's fill could not be edited
  once selected. The text slot already worked this way. The rows mark the selection's own variant
  and fill; with nothing of that kind selected, the slots behave as before.
- **Where:** `app/static/review-draw.js` — new `groupSel`, `restyleSel`, `variantIdx`,
  `applyVariant`, `fillSel`, `fillShown` (after `recolour`); the Arrows / Shapes slot handler and
  its variant buttons; `setFill`; `fillButton`. The phone app gets it through `build_pwa.py`.
- **Notes:** the rule is by kind: arrows-only selected + the Shapes slot still takes the rect tool
  and drops the selection. A press-and-hold on the slot (550 ms) still switches tool and resets its
  size, as the text slot does; the R / O / W keys still switch tools. `annotate.js` (desktop) is not
  changed: its tool buttons also clear the selection in `setTool`, which was not tested here.
  Checked in headless Chromium against the old and new file: marquee select, Filled rectangle,
  Double arrow, green fill, Ellipse, flyout marks, the no-selection picks, a rounded rectangle
  filled (marked as Filled rectangle), and the line-colour fill on an outlined shape.
  Review (fresh agent): three findings, all fixed. (1) a rounded rectangle given a fill matched no
  variant, so its flyout mark vanished: a filled one now matches Filled rectangle. (2) an outlined
  variant left the old fill data: it now resets to a fresh outlined shape's (fill = colour, 0.2).
  (3) the line-colour fill did nothing on outlined shapes: it now fills them; and a pick already in
  effect no longer adds an empty undo step (`restyleSel` keeps only copies that change). Not run:
  the radius of a Rounded pick itself (only its mark). The phone build runs in `tests.test_pwa`.

## 0.36.2 — 2026-11-13 — PDF rows: pictures fill the text column
- **What:** in both PDF reports a note's pictures were 90 pt high (70 pt for a reply's), so a 9:16
  frame came out ~50 pt wide and four of them left the right half of the row empty. Now the
  pictures of a row share one height, chosen so that the row spans the text column: a row takes
  pictures while that height stays at least 120 pt (notes) / 100 pt (replies), and never goes
  taller than 240 pt. Four phone frames to a row now come out ~118 × 209 pt each; a lone picture
  that would be taller than 240 pt is capped there and stops short of the right edge.
- **Where:** `app/review.py` `_pic_rows(pics, max_h, min_h, indent)` (called from `build_pdf`);
  `mobile/js/report.js` `toPdf` → `rows(list, x0, width, maxH, minH)`.
- **Notes:** supersedes the fixed 90 / 70 pt row heights of 0.36.0 and 0.36.1 (row heights now
  vary by the row's pictures). Cover and captions unchanged; the HTML reports are unchanged.
  Checked by rendering a sample desktop PDF (portrait and landscape frames, a reply) and the phone
  PDF from the `tests/test_pwa.py` round trip; `tests.test_pwa`, `tests.test_review_page` and
  `tests.test_merge_parity` pass. Not yet reviewed by a fresh agent.

## 0.36.1 — 2026-11-13 — PDF rows: within the text column; captions in two lines under their picture
- **What:** fixes from the fresh-agent review of 0.36.0. Sight's PDF: rows (and the cover, as
  before) ran ~11 pt past the text column into the right margin — PyMuPDF's Story lays content
  out in x ≈ 50..545, so pictures are sized to `CONTENT_W` = 495 pt (each cell's width set: a
  caption no longer widens a narrow picture's cell); the row height is 90 pt (three 16:9 frames
  still fit); a caption that is not a string no longer breaks the export. Phone PDF: a caption
  under a narrow (portrait) picture wraps to two lines instead of being cut to "Frame 1…", and
  sits right under its own picture (not at the row's tallest).
- **Where:** `app/review.py` (`CONTENT_W`, `_img_tag`, `_pic_rows`), `mobile/js/report.js`
  (`rows` → `capLines`). Checked by rendering both PDFs (portrait frames with captions, 9 pictures).

## 0.36.0 — 2026-11-13 — PDF reports: a note's pictures in rows
- **What:** in both PDF reports (Sight's and the phone app's) a note's pictures — its frame / view
  with its caption, the other frames / views it was drawn on, its screenshots — sit side by side in
  rows, each whole, 90 pt high (three 16:9 frames to an A4 row), a small caption under each; a
  reply's pictures likewise at 70 pt, indented. The cover stays one big picture. A note's pictures
  now come right under its words, before its replies (as the phone's HTML report already did).
- **Where:** `app/review.py` `_pic_rows` (one `<table>` per row: PyMuPDF's Story does not wrap a
  table row, so the rows are packed here) used by `build_pdf`; `mobile/js/report.js` `toPdf` →
  `rows(list, x0, width, rowH)`.
- **Notes:** the HTML reports are unchanged (the browser lays them out). Checked by rendering both
  PDFs to pictures (a note with three frames and a portrait screenshot, a reply with two pictures).
  Review (fresh agent): fixes in 0.36.1.

## 0.35.5 — 2026-11-13 — Phone viewer: the incoming picture fades in as it slides
- **What:** in the full-screen viewer the picture coming in now also comes out of transparency
  (0 → 1) while it slides, as the outgoing one fades out — it no longer shows up fully opaque at
  once (what the user saw as "appears abruptly"; the 0.35.4 seek change stays).
- **Where:** `mobile/js/app.js` `viewer` → `show(no, slide)` (the incoming box's keyframes).
  Test: `viewerFade` checks both pictures are part-transparent mid-slide.

## 0.35.4 — 2026-11-13 — Phone viewer: the strip slide is smooth again (no seek on opening)
- **What:** since 0.35.0 a tap on a note's picture also moved the player to that frame before the
  viewer opened; on a phone the first swipes then stuttered and the next picture popped in
  instead of sliding. Back to 0.33's behaviour: the tap selects the note and opens the viewer, the
  player is left alone; Back puts it on the frame last looked at, as before.
- **Where:** `mobile/js/app.js` `openThread` (no `selectNote` / seek, only `R.curNote`).
- **Notes:** cause, as far as could be told without the device (headless Chromium slides fine
  either way): the seek's `settle` grabs and encodes a ≤ 1600 px frame on the main thread right
  under the first swipe, and the grabber's video competes with the player's decoder for the next
  picture (over FADE_WAIT, it comes in blank and pops). Do not seek the player while the viewer
  is opening.

## 0.35.3 — 2026-11-13 — Canvas: the fill row's "the line's colour" is back
- **What:** the Shapes row's fill colour row starts again with *the line's colour* (the default: a
  fill in the line's own colour, lighter), then the six colours — the way back once a colour was
  picked (the user's call, reversing 0.35.0).
- **Where:** `app/static/review-draw.js` `fillButton`. Test: `fill` (7 entries, back to null).

## 0.35.2 — 2026-11-13 — Phone: picked reviews swipe together; fixes to note selection
- **What:** (1) Home: a picked review swiped left / right slides with every other picked one; the
  bin / eye uncovered on any of them deletes (one confirm) / hides all the picked ones.
  (2) Fixes from the fresh-agent review of 0.35.0: a tap on a card or a picture while a new note
  or a reply is being written no longer moves the player or the selection (a text-only note went
  on the tapped note's frame; a reply's pencil drew on another note's frame); closing the viewer
  on another note of a picture review now moves the highlight (`showNote` repaints); a note's
  "first frame" is its own drawings' (`noteFrameList`), not its replies'; a marker step on the
  drawing canvas does not select the note behind it; a text selection made / dropped on a card
  is no tap; while writing over the player the hidden controls show again; the speaker's tooltip
  says "tap: full / mute"; the `select` test clicks and checks the same card.
- **Where:** `mobile/js/app.js` — `rowGestures` (`peers` / `placeAll`, `row._place`), the review
  row's `.sw` buttons, `selectNote`, the card's click, `showNote`, `jumpNote`, `paintSnd`;
  `mobile/index.html` (`.review.clean` rules `:not(.compose)`). Test: `swipeAll`.
- **Notes:** left as reviewed: with the controls hidden a mouse has no way to the panel but the
  round button (the swipe up is touch only). (The fill row's "the line's colour" is back in 0.35.3.)

## 0.35.1 — 2026-11-13 — Phone: the viewer's caption across the width, the pencil over it; no subtitle on home
- **What:** the full-screen viewer's caption (number, frame, words) spans the whole width at the
  foot and the pencil sits just over it, whatever the caption's height. The home screen's title
  has no "Reviews stay on this device" under it (the list's foot says it already).
- **Where:** `mobile/js/app.js` `viewer` (`.vfoot` holds the pencil and the caption; the picture
  boxes go in before it), `renderHome`; `mobile/index.html` (`.view .vfoot`, `.view .cap`).
  Test: `capPlace`.

## 0.35.0 — 2026-11-13 — Phone: selecting a note, controls hidden, mute on a tap
- **What:** (1) A tap on a note's card selects it (the accent frame) and puts the player on the
  first frame of its drawing; a tap on one of its pictures does the same, then opens it full
  screen; a marker step that lands on a note's frame selects it. The highlight no longer follows
  the playhead (that was the confusing part): notes on the frame shown get a lighter frame.
  (2) The header's second row has, at its left end, a button that hides every control; a round
  button in the top left brings them back; the gestures keep working. (3) A tap on the speaker
  mutes / gives full volume; a drag sets the volume from where it is. (4) Canvas: the fill row
  has only the six colours (no "the line's colour" entry; a fill follows the line until one is
  picked).
- **Where:** `mobile/js/app.js` — `paintCurrent` (`.cur` / `.here`), `selectNote`, the card's
  click, `openThread`, `jumpNote`; `setClean`, `.uib` / `.fab.showui` in `buildStage`, icons
  `hideui` / `showui`; the speaker's tap. `mobile/index.html` (`.note.here`, `.review.clean`).
  `app/static/review-draw.js` (`fillButton`). Tests: `select`, `clean`, `mute`, `fill`.
- **Notes:** the controls stay hidden while the review is open (`R.clean`, not kept). With the
  panel open the bar shows as usual. Review (fresh agent): fixes in 0.35.2.

## 0.34.0 — 2026-11-13 — Phone: loop / once button; the viewer's caption shows three lines of words
- **What:** (1) The transport has a button right of the sound: *once* (stops at the end, the
  default) or *loop*; a tap switches, kept on the device; the canvas' transport has it too.
  (2) The full-screen viewer's caption puts the note's / reply's words on their own line under the
  number and the frame, up to three lines; longer words scroll inside the caption (the picture is
  not covered).
- **Where:** `mobile/js/app.js` — `LOOP_KEY` / `loopOn` / `setLoop` / `paintLoop`, `T.loop` in
  `makeTransport`, `v.loop` in `buildStage`, icons `loop` / `once`; `viewer` (`.cap .tx`, its
  pointerdown / touchmove / wheel left to the words). `mobile/index.html` (`.tpi .loopb`, a
  ≤ 360 px layout without the "fps" word, `.view .cap` wraps, `span.tx`). Tests: `loop`,
  `capText` in `pwa_touch.cjs` / `test_pwa.py`.
- **Notes:** the words' scroll is the browser's own (touch-action pan-y on the scroll box; the
  viewer neither captures nor prevents those touches) — headless Chromium's synthetic touches do
  not scroll, so the test checks the box scrolls, is hit and is not prevented. One run of the
  PWA suite out of four ended with an error not seen again (not traced; the next three passed).

## 0.33.6 — 2026-11-13 — Canvas: the text box is a plain switch again
- **What:** the *Text* row's box button switches the box on / off as before; switched on, its
  colours show in the second row (no "no box" entry there — the user's call: off is the switch).
- **Where:** `app/static/review-draw.js` (the text row's button handler, `openSub`). Test:
  `textSub` (on → off hides the row; on again shows six colours).
- **Notes:** to change the box's colour later: tap it off and on again (the colours show), or pick
  it while the box is being switched on.

## 0.33.5 — 2026-11-13 — Canvas: filled shapes get their own fill colour
- **What:** on the drawing canvas (phone + HTML page) the Shapes row ends with *Fill colour*: a
  second row above it — the line's own colour (as before) or black, white, red, yellow, green,
  blue. A colour picked while an outlined shape is in hand switches to its filled kind (rectangle /
  rounded → filled rectangle, ellipse → filled ellipse). The button shows the fill.
- **Where:** `app/static/review-draw.js` — `pen.fill` (saved with the pen), `fillButton` /
  `fillIco` / `setFill`, `subRow` (the second row, now shared with the text's box / font rows),
  `begin` (fill colour / opacity), `recolour`. Tests: `fill` in `pwa_touch.cjs` / `test_pwa.py`
  (the Shapes row has 6 buttons now).
- **Notes:** a fill of its own colour is drawn at 0.6 opacity, the line's own at 0.3 (as before).
  The colour circle recolouring a selection changes a fill only when it was the line's colour (a
  fill picked on purpose stays). FORMAT.md is unchanged (`fill` was already its own field).

## 0.33.4 — 2026-11-13 — Canvas: a second row for the text's box colour and font
- **What:** on the drawing canvas (phone + HTML page) the *Text* row's box and font switches open
  a second row above it: the box's colour (black, white, red, yellow, green, blue; 0.33.6: no
  "no box" in it), and
  the five fonts each shown in itself. The box switch shows the box's colour. The outline stays a
  plain on / off switch (the user's choice: a colour row for it is not needed).
- **Where:** `app/static/review-draw.js` — `openSub` / `closeSub` (`.dfly.dsub`, closed with
  the row), `applyText(patch)` / `putText(d, patch)` (was one key), `TEXT0` + `bg` /
  `outlineColor`, `FONT_IDS`, `TEXT_COLORS`, `boxIco` / `outlineIco`, `styleOf` counts the
  colours. Tests: `textSub` in `pwa_touch.cjs` / `test_pwa.py`.
- **Notes:** a pick folds the second row, the text row stays. The box keeps its opacity (0.6 by
  default) whatever colour; the outline's colour is the pen's (`outlineColor`, black), not offered.

## 0.33.3 — 2026-11-13 — Sight: right-drag sizes a note's pictures
- **What:** in the review panel a right-drag up / down on the notes list makes the notes' square
  pictures bigger / smaller, the way a right-drag zooms the library grid's thumbnails; the size is
  kept with the settings. As many squares to a row as fit, stretched to fill it (default: four).
- **Where:** `app/static/annotate.js` — `bindThumbZoom` (on `.an-list`), `THUMB` / `noteThumb`,
  setting `sight.annotate.thumb` (via `writeJSON` → `host.putSetting`), CSS `.an-pics`
  (`repeat(auto-fill, minmax(min(var(--an-thumb), 100%), 1fr))`).
- **Notes:** same rule as the grid (0.9 px of size per px dragged, up = bigger), 40–320 px; the
  squares grow in steps of whole columns (the row is always filled). A right click without a drag
  does nothing there (no menu in the panel). Checked with Playwright on a dev server.

## 0.33.2 — 2026-11-13 — Sight: a note's pictures as small squares, as on the phone
- **What:** in Sight's review panel a note's pictures (its frame / picture with the drawings, the
  other frames it was drawn on, its screenshots) and a reply's (its drawing, its pictures) are one
  grid of equal squares, four to a row, each cut to fill — no more full-width pictures.
- **Where:** `app/static/annotate.js` — `picGrid`, `renderPanel` / `repliesHtml` use it,
  `previewBox` (overlay `xMidYMid slice`, the box's inline aspect overridden in the grid), CSS
  `.an-pics`.
- **Notes:** clicks are unchanged (they key on `.an-nprev[data-pt]`, `img[data-shot]`,
  `img[data-rshot]`, not on the container). The squares cut the picture's sides off: a drawing
  near the edge of a wide frame may sit outside its square (a click on the note shows them all on
  the picture).
  Checked on a dev server with Playwright (a picture note with screenshots and a reply).

## 0.33.1 — 2026-11-12 — Phone report: replies' drawings on the reply's own pictures
- **What:** the phone's PDF / HTML report no longer burns a reply's drawing onto the note's frame
  (nor its extra frames, nor a picture note's picture): each reply that drew gets its own pictures
  — every frame it drew on, the note's own frame too (a picture review: the picture) — with only
  its drawings, as the app shows them since 0.33.0.
- **Where:** `mobile/js/report.js` `gatherReport` (`noteOnly`, the reply loop). Test: the video
  HTML report has two pictures (the note's frame, the reply's) — `pwa_e2e.cjs` / `test_pwa.py`.
- **Notes:** the cover of a picture review still shows every drawing. Sight's own PDF / HTML
  report is unchanged: it has no reply pictures, so it still shows replies' drawings on the note's
  frame (dropping them there would lose them).

## 0.33.0 — 2026-11-12 — Phone: strip viewer, square note pictures, filters by swipe, text switches, home selection and moves between groups
- **What:** (1) Note viewer: a swipe sends the picture on the way it went, fading out, and the
  next follows it in like a strip (sideways = the note's pictures, up / down = notes). (2) Notes
  list: a swipe left / right steps the status filter. (3) A note's / reply's pictures are one grid
  of equal squares, cut to fill (Settings → *Pictures in a row*, 3–6, default 4). (4) Bug: a
  reply's drawing showed on the note's own picture — now only on the reply's. (5) Transport:
  "25 fps", the rate and the speaker a little apart from the timecode. (6) The turn-90° button is
  gone everywhere (phone header, the canvas on phone + HTML page, Sight's lightbox — Shift+R stays
  there); the header's view icons sit in the middle, *Fit* at the right end. (7) Canvas: the slot
  rows have the bars' see-through look; the *Text* slot has switches — bold, italic, underline,
  box, outline, alignment, font. (8) Home: a tap on a review picks it (tick), its picture opens it;
  the bar at the foot moves (*Move to…*: a group / a new group / out), hides or deletes the picked
  ones; any review — also one in a group — dropped onto another group's header or member moves
  there (picked ones go along); a group's row counts every state; *Picture…* gives a group one of
  its reviews' pictures / cached frames or a colour. (9) Bug: right after a swipe back from a
  review, the next tap on a review did not open it — home taps now act on pointerup.
- **Where:** `mobile/js/app.js` — `viewer` (`show(no, slide)`, `navigate`), `FILTERS` /
  `stepFilter` / `bindPanelPull`, `picBox` (overlay `cover` = slice), `shotThumbs(…, into)`,
  `noteCard` / `replyEntry` (`.pics`), `THUMBS` / `setThumbs`, `drawingsOn` (no reply rows for
  the note), `paintRate` (`<small>fps`), `viewOf` (rot 0), `buildStage` (`.fitb`); home:
  `homeSel` / `toggleSel` / `paintSelBar`, `moveInto` / `groupKeys` / `takeOut` / `moveMenu`,
  `groupThumbSheet`, `groupHead`, `rowGestures` (`tapAct`, `st.targets`), `deleteReviews`,
  `reviewNames`. `mobile/index.html` (`.pics`, `.selbar`, `.gcols` / `.gpics`, `.th.tint`, `.row.sel`,
  `.th.four` fixed: its pictures were zero-sized). `app/static/review-draw.js` (`TEXT_OPTS`,
  `textOpt` / `putText` / `paintTextFly` / `styleOf`, `.dfly.rd-panel`, turn button removed,
  `afterView`). `app/review.py` (stored turn dropped), `app/static/index.html` (`#turnBtn` gone).
  Tests: `pwa_touch.cjs` / `test_pwa.py` (`filterSwipe`, `pics`, `replyOffNote`, `viewerFade`
  strip, `textFly`, `reopen`, `between`, `groupSum`, `pick`, `groupPic`), `pwa_e2e.cjs` opens
  reviews by their picture.
- **Notes:** a picked review stays picked across renders until opened / moved / hidden / deleted
  (pruned when gone). Groups dissolve under two members at the next render, as before (`tidyGroups`).
  The group picture is stored in the group (localStorage, a ≤ 200 px data URL). The phone and the
  HTML page drop a quarter turn stored by an older version (mirror kept); a two-finger turn is
  still the view's own. A new text's outline is 6 % of its size. (The phone report: 0.33.1.)
- **Review (fresh agents):** viewer / notes / turn — no bugs; fixed: the report of an empty
  picture grid (hidden when nothing loads), the view icons jumping when *Fit* came and went, a
  test selector that could hit an attached picture. Canvas text — no bugs; fixed: a switch during
  a selection hold lost its change (stopAdj first), the field lost the focus to the row's buttons
  (keyboard bouncing; a resize folded the row), the row not repainted after undo, the field's
  preview of centred / right text, outline and box colour, Impact not in the font cycle, test
  pen state. Home — fixed: a review dragged while *not* picked took every picked one along; a
  touch that stopped a fling picked / opened a review (a scroll within 150 ms or the page moved:
  no tap); the click a pointerup-tap ends with could land on the selection bar it just brought up
  (*Hide* at once) — eaten once, document-wide (`ghostUntil`, armed only by a pointer tap, not a
  keyboard click); new groups / *Move to…* use the list's order, not the tap order; *Take out* of
  several kept their order; an empty *Move to…* sheet (a toast now); a review's own *Move to…*
  cleared an unrelated selection; the group-picture sheet decoded every cached 1600 px frame
  (≤ 12 small previews per review now, one at a time); a full localStorage lost group changes
  silently (toast); a failed delete skipped the re-render. Left: the update banner covers the
  selection bar while it shows; picked reviews inside a closed group still count.

## 0.32.2 — 2026-11-12 — Phone: the pencil right after a scrub opens at once, on the right frame
- **What:** after a scrub, the pencil (draw) used to come up late and sometimes show a stale frame
  until the clip was moved or the pencil tapped again. Now the canvas opens at once on the
  scrubbed frame's cached picture, and the player's own frame replaces it when its seek lands.
- **Where:** `mobile/js/app.js` — `openDrawVideo` (opens on `rv.frames` / the scrub cache, `early`
  → `S.settled()`), new `painted(v)` used by `frameNow` / `currentFrame`. Test: `penAfterScrub` in
  `pwa_touch.cjs`.
- **Notes:** the root causes: the canvas waited for the last seek (a fast scrub ends on a decode
  from the keyframe), then grabbed the player right after "seeked" — Safari fires it before the
  frame is painted, so the grab could be the old frame, and it was cached under the new frame's
  tag. A grab of a frame not cached yet now waits for a presented frame (rVFC, ≤ 150 ms). Only with
  no picture at all (nothing cached) does the canvas still wait for the player.
- **Review (fresh agent):** fixed — the new-note composer's pencil still grabbed the player
  mid-seek (`currentFrame` now waits for the seek, and grabs again if the player moved while it
  waited for the paint); `seekTo` moves the canvas before pumping the seek (a same-frame seek
  settled before the canvas knew the frame); the canvas' own pause on opening a playing clip no
  longer triggers a second grab (a flicker); the test now opens the canvas while a step's seek is
  on its way. Left: wrong pictures that older versions cached on a device stay until the review is
  reopened from a fresh file / deleted; without rVFC (iOS < 15.4) the paint wait is a 60 ms guess.

## 0.32.1 — 2026-11-12 — One floating bar for the player and the canvas, half see-through
- **What:** the phone player's header and transport now sit on the same floating bar as the
  drawing canvas' top bar and tool bar (inset 8 px, rounded, blurred, half see-through); the halo
  around the player's buttons and text is gone. The canvas' bars (phone and HTML page) are more
  see-through too.
- **Where:** `app/static/review-draw.js` (`.rd-panel` — the one style; `.draw .dtop` / `.dbar` only
  place it; `SightReviewDraw.css()` exported), `mobile/js/app.js` (`DRAW.css()` at start, `hdr` /
  `tp` get `rd-panel`, the pencil sits above the inset transport), `mobile/index.html` (`.hdr` /
  `.tp` insets, `--halo` and the shadows removed, `--rd-ov` lighter: .66 light / .6 dark; `--rd-pop` for the popups over the picture).
- **Notes:** change the look in `.rd-panel` only (the host sets `--rd-ov` / `--rd-fg` / `--rd-line`;
  the HTML page uses the fallbacks). The header and transport now take touches over their whole
  area (no taps through to the picture between buttons).
- **Review (fresh agent):** fixed — a pinch that started on a bar zoomed the whole page
  (`touch-action: none` on `.rd-panel`); on a bright frame in the dark theme the subtitle and the
  timeline track nearly vanished (they now take the bar's own colour; the bar is a little less
  see-through); the canvas' tool rows and size label followed the lighter bar (own `--rd-pop`);
  the bars sat under a landscape notch (safe-area insets, canvas bars too); the timecode lost room
  on 361–400 px phones (the narrow layout up to 400 px, ellipsis). Kept on purpose: the bars take
  touches over their whole area (a visible panel; taps between its buttons no longer reach the
  picture). Left: the pencil / viewer buttons still use the older `--ov` look.

## 0.32.0 — 2026-11-12 — Canvas tool rows and colour circle; the viewer walks the whole thread; replies editable
- **What:** (1) Drawing canvas (phone + HTML page): *Arrows and lines* and *Shapes* are one slot
  each; a tap takes the slot and shows its kinds in a row above the bar (arrow, open, double,
  dashed, line / rectangle, rounded, ellipse, filled rectangle, filled ellipse); a pick or a stroke
  folds the row. The freed slot is a colour circle at the bar's right end with the colours in its
  row; the palette under the tools is gone. (2) Phone: the note viewer's sideways swipe goes
  through the whole note — its frames, its pictures, then each reply's drawings and pictures
  (caption "↳ Bob · …" with the reply's words). (3) Phone: a reply's ⋯ — *Edit text*, *Edit the
  drawing* / *Draw on it*, *Add pictures…*, *Remove its pictures*, *Delete reply…*; "edited" shows.
- **Where:** `app/static/review-draw.js` (`ARROWS`, `SHAPES`, `SLOTS`, `slotOf`, `openFly` /
  `closeFly`, `.dtools` / `.dcol` / `.dfly`, `useColour`, `begin` kinds, pen `arrow` / `shape`);
  `mobile/js/app.js` (`threadItems`, `sameItem`, `loadItem`, `threadView`, `openThread`,
  `shotThumbs(ids, n, rid)`, viewer per-picture `view` / `text`; `replyMenu`,
  `editNoteDrawing(n, rid)`); `mobile/js/model.js` (`editReply`). Tests: `pwa_touch.cjs` (`fly`,
  `thread`, `replyEdit`), `pwa_unit.cjs` (edited reply merge), `pwa_e2e.cjs` / `page_e2e.cjs`
  (picking from a slot's row).
- **Notes:** the line is shape_kind "line" (review-core draws and hit-tests it; Sight has it).
  Folding the row on a pick is hidden-now / removed-next-tick on purpose (see ARCHITECTURE: the
  HTML page's click-away handler). A reply's `edited` is the merge key, so an edit wins over an
  older copy anywhere (Sight / the page / the app merge by it).
- **Review (fresh agents):** Tool rows — fixed: a row stayed where it was across a
  resize / rotation (off screen) — it folds on resize; a tool key, a hold or the top bar left a row
  up with a stale pick — any tool change and the top bar fold it; Esc with a row up cancelled the
  canvas — it folds the row first; on narrow screens the wrapped tools hugged the right edge (the
  colour is now pinned at the row's end); the tests counted a hidden row. Left by design: a tap on
  the picture that folds a row also draws (the user asked for drawing to fold it); a second tap on
  an open slot puts the tool down; a filled ellipse hit-tests as its box (review-core, as before). Thread viewer — fixed: Back did not
  follow the frame when the walk started on, or passed through, an attached picture (a picture
  now carries the frame looked at before, and opening from one counts any frame as a move);
  picture reviews: the card and the thread disagreed on the note's main picture, and up / down
  skipped notes with no drawing — the picture is now always the first item; a picture that does
  not decode is skipped; frames told apart by frame index everywhere (`noteFrameList`, the card). Reply editing — fixed: editing a reply's drawing re-stamped the
  reply, so an older copy of its words could beat a newer edit made elsewhere (no stamp now: the
  drawings merge on their own); `edited` / `deleted` always go past the reply's current stamp (a
  clock behind the author's lost the edit); the menu writes to the note as it is then (a merge
  meanwhile replaced the objects); an edit that would leave a reply empty offers to delete it
  instead; a note's drawing opens on its own frame again (a reply's on its first). Left: removed
  pictures stay in the device's picture store (freed with the review); a reply is one merge unit,
  so the words edited in Sight and pictures changed on the phone at the same time — the later
  edit keeps its copy of both (FORMAT.md).

## 0.31.0 — 2026-11-12 — Phone: speed and sound in the transport; the canvas settles like the player
- **What:** (1) The transport row is ‹ ◀ **fps** timecode · frame **speaker** ▶ ›. The frame rate
  number is the speed: drag up / down = faster / slower (shown as the rate it plays at, accent
  coloured when not the clip's own), tap = the nearest common rate (24, 25, 30, 12…), hold = the
  clip's own. The speaker: drag up / down = volume (a thin level bar at the screen's left edge,
  kept per device), tap = full; grey when the clip has no sound. Also on the canvas' transport.
  No volume gesture on the picture itself (the user's choice: the swipes there stay the panel /
  the list). (2) Drawing canvas (phone + HTML page): a pinch / pan let go smaller than the screen
  goes back to fit with the turn to the nearest quarter, nearly at fit and straight snaps to fit
  (eased), the wheel stops at fit — as the player does.
- **Where:** `mobile/js/app.js` (`vdrag`, `setRate` / `snapRate` / `paintRate`, `applyVol` /
  `setVol` / `paintSnd` / `showVolBar`, `setAudio`, transport row, video set-up, `bindFile`);
  `mobile/js/mp4.js` (`fpsFromMoov` → `audio`); `mobile/index.html` (`.tpi .fps` / `.snd` /
  `.tc`, `.volbar`); `app/static/review-draw.js` (`settleView`, `unease`, wheel). Tests:
  `pwa_unit.cjs` (audio flag), `pwa_touch.cjs` (`speed`, `sound`, `canvasSettle`).
- **Notes:** whether a clip has sound: MP4 / MOV from the container (`soun` track), Safari
  `audioTracks`, Firefox `mozHasAudio` — final and stored (`meta.audio`); Chrome has no API before
  decoding, so after a quarter second of unmuted play with nothing decoded it guesses "none"
  (not stored, taken back as soon as sound decodes; muted play never guesses). iOS ignores a
  page's volume: the drag there only mutes / unmutes. Speed is kept for the review while open
  (`R.rate`), not stored.
- **Review (fresh agents):** canvas settle — fixed: a settle across 0° / 360° spun the picture
  almost a full turn (fit keeps [0, 360)); the ease stayed on for the next gesture (lag, taps
  landing off); the box size jumped while the transform eased; a pinch cut short by the pen or
  a text edit never settled; the wheel refit while typing. Speed / sound — fixed: a sideways slide on a
  control counted as a tap (snapping the speed / full volume); a WebM's frame rate measured while
  playing faster than 1× could be stored wrong (frames dropped) — measured at 1× only; a guessed
  "no sound" did not repaint the icon; after picking another file the old "no sound" stayed (the
  sound is learnt again on a rebind); the timecode was clipped on 320 px phones (narrow layout) and
  jittered with a bold rate; a long press could select the number / open a menu; labels rewritten
  every frame; a second finger on a control. Left: a tap at 1× on a clip whose measured rate is not
  a common one snaps it (e.g. 29.5 → 29.97); the MP4 sound flag counts any sound track, even an
  empty one.

## 0.30.0 — 2026-11-12 — Phone: review groups, tool opacity on the hold, auto full screen
- **What:** (1) Home: a review held, dragged onto the middle of another one (it lights up) and let
  go makes a group of the two (named by the names' common start, else "Group"); more go onto the
  group's header. The header opens / closes on a tap, moves the whole group on hold + drag, and
  its menu has *Open / Close*, *Rename…*, *Ungroup*; a member's menu has *Take out of the group*.
  (2) Drawing canvas (phone + HTML page): press and hold with a tool, drag sideways = that tool's
  opacity (up / down is still the size); the preview reads "6 px · 70 %"; a hold on the tool's
  button resets both. (3) Settings → *Full screen*: Auto (default) / Off — Auto goes full screen
  at the first tap in a browser tab that can, and again after the user leaves it.
- **Where:** `mobile/js/app.js` — `loadGroups` / `saveGroups` / `tidyGroups` / `groupName` /
  `groupOnto` / `ungroupOne` / `groupMenu` / `setGroup` / `groupRow` / `groupHead`, `reviewRow` split
  into content + `rowGestures(row, it, o)` (drop target `.drop`, group `.folded`), `renderHome`
  entries (reviews + `"g:<id>"`), `reviewMenu`; full screen `fsCan` / `enterFS` / `exitFS` /
  `setFsAuto` / `fsTap`, `settings()`; `mobile/index.html` (`.row.group`, `.gm`, `.th.four`,
  `.chev`, `.drop`, `.seg.fs`); `app/static/review-draw.js` (`OPAC0` / `OPAC`, `adjMove` axis for
  tools, `showSize` label, new items' opacity, pen `opac`). Tests: `pwa_touch.cjs` (`opac`,
  `brushReset`, `dropLit` / `group`, `fullscreen`).
- **Notes:** groups and order are per device (localStorage), like the order; a review is in one
  group at most; a group needs two existing reviews (`tidyGroups` dissolves the rest each
  render). Only a review on its own can be dropped (no nesting; a member leaves by its menu). The
  size hold now waits for 10 px to pick its axis (as the selection hold did). iPhone Safari has no
  page full screen and iPad Safari limits typing in it, so iOS tabs do not try (the setting says
  why); the installed app is full screen already; a tap that opens the file picker
  (`label`, `[data-nofs]`) or a text field never asks.
- **Review (fresh agents):** opacity hold — no bugs (a redundant save removed; the text field
  while typing does not show the text opacity, left). Groups — fixed: the saved order
  missed entries never moved by hand, so a new group (and a review taken out / a dissolved group's
  last one) landed after them, not in the target's place — the home list now saves its whole
  order on each render; a group with every member hidden lost its slot on a reorder (`saveOrder`
  keeps `g:` keys); a member reorder moved hidden members to the end; *Ungroup* used a stale member
  order; names lost a trailing "v" / stopped mid-word (`groupName`); a sideways mouse drag on a
  header toggled it; "1 reviews". Left: rows of very different heights (an open group) shift by
  the held row's height, so near an open group the drop light / slide can feel uneven.
  Full screen — fixed: the clip button (opens the picker) asked for full screen; a mouse asked on
  pointerdown (the page resized mid-click); any pointerup asked, also after a scrub, a drag, a hold
  or with more fingers down (now only a plain one-finger tap); text fields asked (iPad limits
  typing in full screen: iOS is left out altogether); Android's back leaves full screen first and
  the next tap went straight back in, so every back press was eaten (now it stays off until the
  next screen, `fsArm`).

## 0.29.0 — 2026-11-12 — Phone: a reply on a video note is written over the player, on any frame
- **What:** *Reply* on a video note (and the viewer's pencil on one) closes the Notes Panel and
  opens the reply in the bar over the player: the player goes to the note's first frame, the
  note's frames are on the timeline and as chips in the bar (tap = go there), its drawings show
  on the picture, and the pencil draws on whatever frame is on screen — several frames, e.g. one
  the note forgot. Sending (or ×) leaves the player on the frame reached and the note lit in the
  list. A reply's card shows each frame it drew on; its viewer swipes sideways over them. Picture
  notes keep the inline reply under the card.
- **Where:** `mobile/js/app.js` — `startReply`, `replyBar`, `closeReply`, `sendReply`,
  `threadFrames`, `replyFrameTimes`, `composing()` / `composeKey()`, `R.replyTo` / `R.curNote`,
  `paintCurrent`, `markerList`, `stageDrawings`, `drawingsOn` (reply filtered by frame),
  `asyncFrameAt(n, t, rid)`, `noteView` (reply frames sideways, pencil); `mobile/index.html`
  (`.newbar .frs`); `mobile/js/report.js` (frames only a reply drew on go with that reply);
  `app/static/annotate.js` (Sight's export: live replies' drawings count for a note's extra
  frames); `app/review.py` (the HTML page's reply thumbnail: only what it drew on that frame);
  `docs/FORMAT.md` (reply drawings may sit on other frames). Tests: `pwa_touch.cjs` reply steps,
  `pwa_e2e.cjs` reply through the bar.
- **Notes:** the reply draft is keyed by the note id (as the inline one), so an inline draft and
  the bar share it. Starting a reply closes the new-note bar but keeps its draft. A note deleted
  or merged away while replied to drops the bar (`paintNewBar`). The drawing canvas of a reply is
  clean (only the reply's own drawings), as before. The HTML page does not list a reply's extra
  frames (only Sight's export does, via the note's extra frames); its reply thumbnail just no
  longer piles other frames' drawings onto the note's frame.
- **Review (fresh agent):** fixed — the bar's "note still there" test read `deleted` (a reply
  field) instead of the row's `deleted_at`, so a note deleted / merged away kept the bar and took
  the reply; the player's pencil while replying drew into a hidden new-note draft (it now opens
  the reply's pencil); a reply drawing on the note's own frame got `{t, hold: 0}` instead of the
  note's ctx (its hold lost); the "typing, leave it alone" guard kept a stale composer; Reply on the
  note being replied to sent the player back to the first frame; frames are now told apart by
  frame index (`frameKey`), and the phone report shows a frame a reply added once. Left: switching
  to another note's reply keeps the first one's draft without asking (it comes back on its Reply).

## 0.28.1 — 2026-11-12 — Phone viewer: pictures cross-fade instead of sliding
- **What:** in the full-screen note viewer a swipe (up / down = another note, sideways = the
  note's other frame) no longer slides the picture off and the next one in from the edge (which
  blinked: the new image was not loaded yet). The swiped picture settles back, the next one is
  decoded, then fades in on top while the old one fades out in the same place.
- **Where:** `mobile/js/app.js` `viewer()` (`show(no, fade)`, `navigate`, `FADE_MS` / `FADE_WAIT`);
  test `viewerFade` in `tests/pwa_touch.cjs` / `tests/test_pwa.py`.
- **Notes:** `show` is async but with no `fade` it never awaits, so the first `show(o)` is still
  synchronous. `o` and `box` switch together only after the decode (capped at 600 ms; a slower
  image fades in blank and pops in). The old box holds full opacity until 45 % of the fade, so the
  pair never lets the background show through mid-way. Old boxes are removed by `onfinish` with a
  timeout fallback. `busyNav` lasts until the fade ends; a swipe while busy just snaps back.
  Fresh-agent review found no bugs; it flagged the mid-fade dimming of a plain both-ways fade and
  the old picture sitting off-centre while the next loads; both fixed as above.

## 0.28.0 — 2026-11-12 — Phone: play inside the drawing canvas, clean timeline for a new note, note frames in the viewer
- **What:** (phone app; review-draw.js gains host hooks, no change on the HTML page)
  On a video's drawing canvas with no tool in hand, a tap plays / pauses: the clip plays in the
  picture's place, each frame's drawings showing as it passes; a pause (or taking up a tool)
  stops on the frame reached, ready to draw. A new note (being written or drawn) has a clean
  timeline: only its own frames, no ticks / dots of earlier notes (red / yellow / green ticks are
  notes by state, grey dots are other frames drawn on). Opening the Notes Panel pauses a playing
  video where it is. The full-screen note viewer: a swipe left / right walks the note's frames
  (caption "0:01.05 · f 30 · 2 / 3"), no swipe closes it any more — only Back (and Esc / system
  back); back in the review the player stands on the frame left on. Home: the big open buttons
  show only while there is no review; after that the bar's small icons, no scroll switching.
  Play after a scrub no longer restarts a seek that is already on its way to that frame. A scrub
  on the canvas no longer dims the picture (it read as a haze over the video): the cached frame
  shows as it is; only a frame with no cached picture at all keeps the old one, dimmed.
- **Where:** `mobile/js/app.js` (`openDrawVideo`: `liveStart` / `liveStop` / `onPause`, `onTap`,
  `onTool`; `frameNow` / `currentFrame` use `snapT`; `togglePlay`; `markerList`; `paintNewBar`
  repaints markers; `setPanel`; `viewer` `navigate(dir, axis)` + `o.side` / `o.label`;
  `noteFrameList`, `noteView(n, f, rid, from)`, `showNote(n, at)`; `renderHome` open buttons),
  `app/static/review-draw.js` (`onTap`, `onTool`, `handle.live`, `.dlive` / `.dbox.live`, empty
  frames not stored), `mobile/index.html` (`.view .cap .fr`), tests `pwa_touch.cjs` /
  `test_pwa.py` (play / pause / play-to-end in the canvas, clean markers, panel pause, viewer
  sideways), `pwa_e2e.cjs` (open buttons by `label.pick-media` / `label.pick-file`).
- **Notes:** *Why play lags after a scrub although the cache bar is green:* the cache is ≤ 640 px
  JPEGs for the screen; the `<video>` decoder still has to seek (back to the keyframe, decode up
  to the frame; phone clips have a keyframe every 1–2 s) and buffer before it plays. Nothing makes
  that instant; what was fixed is the extra seek — `togglePlay` re-set `currentTime` to the frame
  the in-flight seek was already going to, which restarts it. While playing in the canvas, the
  player (hidden under it) is drawn into a ≤ 1280 px canvas per presented frame (rVFC, rAF after
  250 ms without one — an off-screen player may get none); keys are a quarter into the frame
  (`snapT(mediaTime + fd/4)`: millisecond WebM stamps sit a hair below a frame's start); the
  live layer shows from the first frame presented after play (not the pre-seek one); `capSeq` is
  bumped so the tap's own settle grab cannot swap the picture mid-play. `frameNow` refuses to grab
  while playing (it would cache under the wrong tag). An ended clip reads `currentTime = duration`,
  one past the last frame: `frameNow` / `currentFrame` tag with `snapT` (it clamps) — before, the
  canvas stayed dimmed on a stand-in picture after playing to the end. Space is *not* bound in
  the canvas (with a tool in hand a playing clip would abort strokes every frame). The viewer's
  pencil still draws a reply on the note's own frame (replies are one frame), whatever side frame
  is shown.
- **Review (fresh agent):** play-to-end left the canvas dimmed under a past-the-end key (fixed,
  test added); live keys from raw `mediaTime` drew frame k's drawings over k+1 on WebM (quarter
  offset); a pending settle grab could re-key the canvas mid-play (`capSeq`); the live layer
  flashed the pre-seek frame (now from the first presented frame); rVFC may not fire off screen
  (rAF fallback); a second viewer swipe within the 170 ms slide acted on the old picture
  (`busyNav` held until shown); every frame played past left an empty store entry (not stored).

## 0.27.0 — 2026-11-12 — Phone: player gestures, panel by pull-down, canvas in place, hold-to-size, finger undo / redo
- **What:** (phone app; the canvas parts also on the HTML page, same review-draw.js)
  **Fix:** a scrub (or frame steps) followed at once by Play jumped back to an older frame — play
  now starts on the frame on screen. The header and transport over the player have no fill (a halo
  keeps them readable). *+ Note* shows only with the Notes Panel open (or while a new note is being
  written). The panel's ⌃ is gone: pulling the list down from its top note goes back to the player.
  A swipe down on the player goes back to the reviews. Two fingers pan / zoom / turn the player
  (header *Fit* to reset). *Set state* is gone from the phone UI. The drawing canvas opened from the
  player shows the picture exactly where the player did (same box, zoom, turn; bars float over
  it) and hands the view back. Canvas: press and hold with a tool, drag up / down = that tool's size
  (preview circle on the left); select tool + selection: hold, drag up / down = line width,
  sideways = opacity; hold a tool's button = its default size; two-finger tap = undo, three = redo.
  The pencil (*Draw a note*) moved from the header row to a round button at the bottom right of
  the picture (above the transport on a video), where the full-screen viewer has it — it no
  longer jumps between corners from screen to screen.
  **Home:** the drag-to-bin is gone. Swipe a review left = the bin, right = the eye (hide for now);
  press, hold and drag = move it in the list (order kept). No hint text about deleting under the
  list. Scrolled past the two open buttons, they show as two small icons in the bar next to ⚙. Its class is `fab pencil` (the viewer's too,
  was `fab draw`): `.draw` is the canvas' root class — review-draw's injected CSS (`.draw {position:
  fixed; inset: 0}`) and the app's "canvas open" checks (`querySelector(".draw")` turns the
  player's keys off) must never match anything else.
- **Where:** `mobile/js/app.js` (`togglePlay`, `bindStage` replaces bindScrub / bindStageSwipe,
  `R.pv` / `applyPlayerView` / `fitPlayer`, `bindPanelPull`, `swipeLeave`, `playerPlace` +
  `drawCanvas`, `.compose` in `paintNewBar`, review-state menu removed, `reviewRow` / `orderReviews` /
  `hiddenKeys` + bar `.mini` on the home screen, `els.penB` placed in
  `applyStageView`), `mobile/index.html`
  (`.hdr` / `.tp` without fill + `--halo`, `.sv`, `.scrubimg` pointer-events, newbar / `--ph`
  rules), `app/static/review-draw.js` (`pinch`, `fitBox` / `nav` / `onNav`, hold → `adj`,
  `tap`, per-tool `SIZE` + `SIZE0` / `SIZE_RANGE` saved with the pen, tool-button hold),
  tests `tests/pwa_touch.cjs` (new, CDP multi-touch) + `test_pwa.py test_touch`, `pwa_e2e.cjs`
  (opens the panel before *+ Note*; the review state is set through the model).
- **Notes (home):** `reviewRow` replaces `dragToBin`. Order: `localStorage sight-review:order`
  (keys; reviews not in it — new ones — first, newest opened first; `orderReviews`). Hidden:
  `sessionStorage sight-review:hidden` (gone when the app is closed; *Show* under the list clears
  it). While a card is held and dragged the DOM is not reordered — moving its row drops the
  pointer capture and ended the drag after one place; the other rows slide by `translateY` and the
  row is moved once on release. One card open at a time (`openRow`; a pointerdown elsewhere shuts
  it). The bar's mini open buttons (`.bar .mini`, labels around file inputs) show when an
  IntersectionObserver sees `.opens` gone under the bar.
- **Notes:** the play bug: `play` cleared `R.want` while a seek was still queued / in flight, so the
  player played on from the older seek. `togglePlay` sends the target first. Separately, a tap
  landing on the cached scrub frame got no click when that picture hid mid-tap — `.scrubimg` is
  now `pointer-events: none`. (Headless Chromium also drops the click of a tap 0 ms after a drag;
  humans are slower — the test waits 120 ms.) A touch scrub no longer swallows the next click
  (only a mouse drag ends with its own click). `R.pv` is view only (not saved); the quarter turn /
  mirror stay in `R.meta.view`. The review state stays in the data (from Sight, exported, model
  `setReviewState`), only the phone control is gone. Size hold is touch / pen only (a mouse user
  pausing before a drag would trigger it). Tool-button hold resets the size only, not the colour.
  A swipe down while a new note or reply has content asks first.
- **Review (fresh agent, player / canvas):** the view handed back by the canvas was wrong when its
  quarter turn differed from the review's (canvas Fit after a pinch-turn handed back "fitted" =
  no turn; zoom was relative to the canvas' fit, not the player's — ×1.78 off on a 16:9 clip
  turned 90°): `onNav` now converts the zoom with the host's box at its own turn (`boxAt`), and a
  resize while typing refits only a fitted view. A selection hold (`adj`) was not ended by undo /
  redo / trash / recolour / tool change / frame change / keys — a TypeError per move and another
  frame's state pushed onto this frame's undo; all of them now cancel it first (`stopAdj`). A
  cancelled tool-size hold keeps the old size. "Draw on it" in the full-screen viewer used the
  player's place (the viewer is gone before the check) — `noPlace`. Finger taps within 600 ms of
  a pen (palm) no longer undo; the wheel pull-to-close waits 700 ms after scrolling (trackpad
  momentum); the touch test waits for playback instead of sampling at 60 ms.
- **Review (fresh agent, home list):** a tap on a swiped-open card opened the review (the
  document-level closer shut it before the card's click) — the closer now skips the open card
  itself, which also lets an open card be dragged back; a hold let go without moving opened the menu
  on pointerup and the tap's click then hit the sheet's backdrop and closed it — the menu now opens
  from that click (350 ms fallback when none comes); holding near the screen's edge scrolled and
  reordered (moving and edge scroll now start only past 8 px; a still release never saves); a mouse
  released off the card before the hold left a stuck ghost and a second finger left rows shifted —
  the pointer's end is heard on `window`, a second pointer is ignored, cancel puts rows back;
  `saveOrder` keeps reviews hidden for now in their slots; a non-array saved order is ignored;
  the IntersectionObserver reads the latest entry; `renderHome` drops a leftover ghost.

## 0.26.2 — 2026-11-12 — Phone app: why updates did not arrive (address), HTTP notice
- **What:** the app's Pages address redirects to the account's custom domain (github.io → 301 →
  http://pixis.ink/sight-media-viewer/). A copy installed from the github.io address can never update
  (the service worker's update check cannot follow a redirect to another origin), and over plain
  HTTP there is no service worker at all. The home screen now says when it is opened over HTTP, with
  an *Open over HTTPS* link; the worker is registered with `updateViaCache: "none"`.
- **Where:** `mobile/js/app.js` (`renderHome` notice, `initSW`), docs/ARCHITECTURE.md (Address).
- **Notes:** the right address is **https://pixis.ink/sight-media-viewer/**. Not redirected
  automatically: IndexedDB is per origin, reviews made on another address must be exported (.srev)
  and opened in the new one. Enforcing HTTPS is an owner setting (GitHub Pages "Enforce HTTPS" of the
  user site / Cloudflare "Always Use HTTPS"), not something the repo can do. No review agent for this
  small change.

## 0.26.1 — 2026-11-12 — Phone: scrub / frame steps no longer jump back before landing
- **What:** at the end of a scrub, and on every frame step, the picture jumped back a frame and
  then onto the right one. Now it goes straight to the frame.
- **Where:** `mobile/js/media.js` (`ScrubCache` rewritten: frames by media time, `fill`, `exact`),
  `mobile/js/app.js` (`cachedAt`, `showCached`, `hideWhenShown`, `settle`).
- **Notes:** two causes. (1) The cached picture was hidden on `seeked`, but the player paints the
  new frame a moment later (Safari especially), so the old frame flashed up: now it is hidden after
  rVFC reports a presented frame (250 ms fallback); a new cached picture cancels a pending hide.
  (2) The cache was keyed on a grid of the guessed 25 fps (WebM until played), so at 29.97 fps one
  frame in six was never cached and `near()` showed the frame before; steps now use `exact()` only
  (else the player's current frame stays until the seek lands), drags keep `near()`, and the cache
  is keyed by real media times with a gap-filling second pass.
- **Review (fresh agent):** `exact()` first picked the frame by round(mt / fd), which differs from
  what the player shows at (n + 0.25)·fd when stamps jitter (phone VFR clips) — now it takes the
  last cached frame starting at or before that point, only if none is missing in between; the cache
  bar ran backwards while `fill()` added early frames (progress only goes forward); "ended" could
  start a second `fill()` (once-guard, never seek to the very end); frame 0 was never cached (the
  start is a hole too); in a drawing session a step with no exact frame left the old picture under
  the new frame's drawings (falls back to `near()`, dimmed).

## 0.26.0 — 2026-11-12 — Phone app: full-screen player, Notes Panel, multi-frame notes, themes; multi-frame / multi-view notes in Sight
- **What:** the review is a full-screen player: every control in a header over the picture, the
  transport (marker / frame steps, timecode, timeline) over its foot, a thin *Notes Panel* bar that
  slides the player up off the screen and the notes in (filters + ⌃ back). No play button in the
  transport. Marker jumps / steps / timeline taps show the frame at once and the playhead and
  markers line up (one seek path). The scrub on the picture runs from where the clip is at a fixed
  pace (not the screen's width for the whole clip). Note pictures open full screen with floating
  Back / pencil buttons; swipe up / down = next / previous note, sideways = back. The drawing
  canvas' bars float over the picture; a tap on the tool in hand puts it down; on a video the
  canvas has the timeline: scrub / jump to other frames and draw there, *Done* makes one note with
  every frame drawn on. Notes are numbered by when they were made, videos too (also in Sight).
  Light / Dark / Auto theme for the whole app. The ✎ glyph is replaced by the pencil icon (tip
  bottom-left) on the phone and the HTML page. Home: press and hold a review, drag it onto the bin
  that appears at the bottom to delete it (let go without moving = the menu); the footer's
  "Nothing leaves this device…" is on its own line.
  **One note, several pictures (video frames / 3D views), everywhere:** Sight attaches every loose
  drawing made since the file was opened to the next note, whatever frame / view it is on (before:
  only the ones shown now); the note card shows one preview per frame (extra ones small; a click
  goes to that frame); the PDF / HTML report gets `notes[].more [{frame, size, caption, ctx}]` for
  the other frames / views (PDF: after the note's frame; the page: `frameOf("<id>|<i>")`, drawn
  over by ctx like the note's frame).
- **Where:** `mobile/js/app.js` (review screen, `seekTo` / `snapT` / `pumpSeek` / `settle`,
  `makeTransport`, `bindTimeline`, `bindScrub` / `scrubStep`, `setPanel`, `viewer` / `noteView`,
  `drawVideo` / `frameNow` / `framesDraw`, `editNoteDrawing`, themes), `mobile/index.html` (CSS,
  theme tokens), `mobile/js/model.js` (`notesSorted`, `noteFrameTimes`), `mobile/js/report.js`
  (extra frames), `app/static/review-draw.js` (floating bars, tool off, multi-frame API),
  `app/static/annotate.js` (`notesSorted`, `pendingDrawings`, `notePreview` / `previewBox`,
  `gatherReport` `more`, `frameIndex` / `landAt`), `app/review.py` (pencil icons, `build_pdf` and
  the page's `frameOf` / `noteCard` for `more`), `mobile/js/app.js` `dragToBin`, tests
  (`pwa_unit.cjs` frame times at 23.976…120 fps).
- **Notes:** the lag / misplaced playhead had two causes: steps / jumps set `currentTime` directly
  while a seek was in flight (late, lost taps), and the native range input stopped updating once it
  kept focus (`activeElement` check) and its thumb travels a narrower track than the markers'
  percent. A note may now hold drawings on several frames (each row its own `ctx`; the note's ctx is
  the earliest); Sight / the HTML page already show each drawing on its own frame, but Sight's
  report shows only the note's frame (not changed). The multi-frame canvas is used for new notes
  and *Edit the drawing* on videos; replies stay single-frame. The HTML page gets the floating bars
  and tool-off too (same review-draw.js), in its dark default colours. Tests: `pick()` in
  pwa_e2e.cjs takes a tool only when it is not already in hand (a second tap puts it down).
  **Frame times:** a stored ctx.t is (n + 0.01)·fd rounded to 3 dp, which can fall just *below*
  n·fd at 23.976 / 29.97 / 60 / 120 fps. `frameIndex` (model.js, same in annotate.js) recognises a
  stored time and keeps it on frame n (`frameTime(frameTime(t)) === frameTime(t)`); the player is
  sent a quarter into the frame (`pumpSeek`, annotate.js `landAt`), never to the stored time itself
  (0.100 at 29.97 fps showed frame 2 instead of 3 — also in Sight before).
- **Review (fresh agent):** found stepping stuck at 23.976 / 29.97 / 60 fps (re-snapping a rounded
  stored time fell a frame back) and marker jumps landing a frame early — fixed by `frameIndex`
  above, with a unit test; `settle()` ran from `seeked` while the next seek had already started
  (cached frame hidden early, and in a drawing session the old picture cached under the new time) —
  now only when not seeking, and `frameNow` refuses to grab while seeking; a frame grab finishing
  after the user moved on switched the canvas back (`moved` bumps the grab sequence, the grab must
  match the last time); editing a Sight drawing with `hold` lost it (an edited drawing keeps its
  own ctx); a swipe turning into a pinch left the viewer picture offset; a double tap opened two
  drawing sessions (`drawOpening`); `R.dragging` stuck when the canvas closed during a timeline
  drag (`finish` ends it, `lostpointercapture`); a canvas scrub with no duration jumped to frame 0;
  after a stylus, fingers could not scrub with no tool.
- **Review 2 (fresh agent, multi-frame notes / bin):** `frameIndex` took some raw player times for
  stored ones (now only a time with exactly 3 decimals can be stored); previews (Sight's `pumpPF`,
  the phone's `getFrame` → Grabber) seeked to the raw stored time and showed the frame before (now
  a quarter into the frame); `pendingDrawings` would have pulled old markup from other frames into
  an unrelated note — off-screen drawings now count only since the last note (`S.composeSince`),
  compose mode follows the same rule, and the note row says "(n on other frames)"; same-frame
  checks use `sameFrame` (frame index), not float equality; `gatherReport` left `S.curVk` on the
  last extra view and carried one view's look into the next; the home bin: Android's long-press
  `contextmenu` opened the menu over a lifted review, and a mouse held still before dragging lost
  the pointer (capture is now taken on lift).

## 0.25.0 — 2026-11-12 — Phone app remembers the picked file
- **What:** a review opens with its picture / video straight away: the app keeps a copy of the
  file you picked on the device (automatically, no question) and binds it when the review opens.
  Without a copy the stage shows *Pick the file* as before. ⋯ → *Forget the file on this device*
  drops the copy (and stops keeping it for that review); *Remember the file…* brings it back.
- **Where:** `mobile/js/app.js` (`autoKeep`, `openReview`, `rebind`, `paintKeep`, `dropCopy`,
  menu), `tests/pwa_e2e.cjs` + `tests/test_pwa.py` (reload → picture and video reopen with the file).
- **Notes:** a web app cannot keep a handle to a file picked from Photos / Files on iOS (no File
  System Access API there), so "remember" = a copy in IndexedDB `files`; it counts against the
  browser's storage. Skipped when the copy would take usage past 90 % of the quota (the hint then
  says so, with *Try again*). The copy is written after the review is on screen; a review deleted
  meanwhile drops it. `meta.keepAsked` is gone (old records keep the harmless field); `meta.noKeep`
  replaces it. Re-picking a file (rebind) replaces the copy.
- **Review (fresh agent):** the first version put the whole `rv.meta` back after the copy was
  written, so a review closed and reopened meanwhile (or imported into) lost or regained `kept`
  against what was stored; "Forget" during a running copy was undone; a failed replace left the old
  copy bound silently. Now `store.js keepFile / dropFile` patch the stored entry by key in one
  transaction with the file (no write for a deleted review or one marked noKeep), the open review's
  meta follows, a failed replace drops the old copy and shows the hint, and `openReview` sets `kept`
  from what is really in `files`.

## 0.24.0 — 2026-11-12 — One transform tool everywhere, clean picture for new notes, turn / mirror, phone scrub cache
- **What:** the select / transform tool (`V`) is now in the shared drawing canvas too (HTML page,
  phone); its rotate knob follows the pointer out from the pivot (longer arm = finer turn), same in
  Sight. Ctrl held = temporary eraser; a bin clears the drawings on screen (Sight: Shift+Delete).
  A new note (or reply) is drawn on a clean picture: Sight hides other notes' drawings while you
  draw / type a new one, a clicked note shows only its own; cards show the note's (and each reply's)
  drawings over the clean picture / video frame. Sight's panel got the All / Open / In progress /
  Resolved filter. View turn 90° / mirror: Sight's viewer (Shift+R / Shift+M, per file), the
  phone (stage, viewer, canvas; saved with the review), the canvas (buttons + two-finger turn).
  HTML page: the top picture is the original, every card picture is full width, the zoom viewer
  zooms with right-drag / pen side button / wheel / double-click (the canvas: right-drag too).
  Phone: a scrub cache of small frames so scrubbing follows the finger at once.
- **Where:** `app/static/review-core.js` (xf*), `review-draw.js` (rewritten view + select tool),
  `annotate.js` (viewMode / ctxShown, local() through the turn, previews, filter, clearShown,
  Ctrl eraser), `index.html` (attachViewer turn / unturn, buttons, keys, hints), `app/review.py`
  (template), `mobile/js/app.js`, `mobile/js/media.js` (ScrubCache), `mobile/index.html`; new
  `tests/test_review_page.py` + `tests/page_e2e.cjs` (Sight → page → Sight with a reply picture,
  a reply drawing, a resolve and a new drawn note).
- **Notes:** turning / mirroring is view only — doc units (the media's own pixels) never change;
  exports and screenshots stay unturned. Reports use `ctxShown`, never `visibleNow` (the view mode
  must not drop drawings from a PDF). "Pictures lost in the merge" (user report): the round trip
  loses nothing (new test); what looked lost were reply drawings Sight only listed as an eye + count
  and the page's cover showing everything at once — both now shown where they belong. The phone
  cache is memory only (≤ 1500 frames ≤ 640 px); scrubbing still seeks the real player and the
  cached picture hides when the seek lands. The canvas's undo keeps item arrays: transforms work on
  copies, never mutate an object an undo state holds. Review (fresh agent) found and these were fixed: the page viewer's
  tap-close beat its double-click zoom (the close now waits 280 ms); a middle-drag at fit moved a
  hidden pan; the canvas's recolour lost the selection; on touch the 22 px handle reach made small
  objects unmovable (a press on the body > 8 px from a handle moves it); drawings hidden by the view
  mode stayed selected (Delete / nudge acted unseen — the selection is pruned in paintVisibility); a
  screenshot did not switch to the clean picture at once; the preview-frame pump raced on reopening
  the same video (generation token); ScrubCache showed a far-away frame where the clip was not cached
  yet (only ±2 steps now, and the player takes over once it has caught up); a rebind could start a
  cache on the revoked URL. Design change from it: only drawings made since the file was opened
  (data.created ≥ S.openedAt) start the compose mode, so old loose drawings never hide every note's.

## 0.23.1 — 2026-11-12 — Video frame stepping and note times land on the frame on screen (Sight + phone app)
- **What:** in Sight's video lightbox `,` / `.` stepped from the *nearest* frame boundary, so a step taken after a pause or a scrub late in a frame skipped a frame forward (or stayed put backwards); a note / drawing made while paused late in frame k was stored at the raw time and showed on frame k+1. Now a step goes from the frame on screen and a new note / drawing is stored at that frame's start (+0.01 frame, where stepping lands). Without annotating, stepping used 25 fps on every clip (the rate was only read when annotation mode came on); it is now read when a video opens. Found by the fresh-agent review of the phone app (0.23.0), which already had the fix.
- **Where:** `app/static/annotate.js` (`frameStart`, `stepFrame`, `ctxNow`, `setAsset` → `loadFps`); `mobile/js/app.js` (`frameStart` keeps the raw time while the rate is a guess, like Sight). Docs: ARCHITECTURE (phone app video), PLAN.md (known bug removed).
- **Notes:**
  - The frame on screen at time t is `floor(t · fps)`; stored `t = (frame + 0.01) / fps` to 3 dp. Labels still use `round(t · fps)` — the same frame for every time stored this way, and unchanged for older notes (whose `ctxVisible` window also centres on their raw `t`). Older notes are not moved.
  - While the rate is unknown (Sight: before `/info` answers; app: WebM before it is measured) the raw time is kept: snapping to a guessed rate could move a note by a frame.
  - `compare.js` has its own timeline (`snapT` to exact frame starts, no stored times) — checked, not changed.
  - Checked in Sight (dev server, temp SIGHT_HOME, 24 fps WebM): from 1.03 s `.` → 1.0421 (frame 25), `,` → 1.0004 (frame 24); a note at 2.03 s stored at 2.0 with fps read before annotating. `python -m unittest tests.test_pwa tests.test_merge_parity` passes.

## 0.23.0 — 2026-11-12 — Phone app "Sight Review" (PWA): local review on the device
- **What:** stage 3 of `docs/PLAN-mobile.md`. A web app for phones / tablets, installable from Safari (*Add to Home Screen*) / Chrome, fully offline: pick a picture or a video on the device (nothing is uploaded), review it from scratch — notes, replies with pictures, note states, the file's review state, drawings and text on the picture or any video frame (scrub by dragging sideways on the video as in Sight, frame stepping, timecode + frame number, note markers), edit / delete — and export a **PDF** report, a static **HTML** page (both: frames with drawings burned in, notes, replies, pictures) or a **.srev** that merges in Sight (found by name + size); a `.srev` from Sight opens / merges in the app. Reviews live in IndexedDB; the media file can be kept on the device on request. Published to GitHub Pages by a new workflow. The HTML reviewer page's drawing canvas moved into a shared file the app uses as is, and got a **Text** tool (both the page and the app).
- **Where:** new `mobile/` (`index.html`, `sw.js`, `manifest.webmanifest`, `icons/`, `js/app.js`, `model.js`, `store.js`, `media.js`, `mp4.js`, `report.js`, `pdf.js`); new `app/static/review-draw.js` (`SightReviewDraw.open`, CSS injected, scoped to `.draw`; was `drawSheet` + its CSS in `review._HTML_TEMPLATE`); `app/review.py` (`_inline_js` / `draw_js`, `%%DRAW%%`); `tools/build_pwa.py`; `.github/workflows/phone-app.yml`; tests `tests/test_pwa.py`, `tests/pwa_unit.cjs`, `tests/pwa_e2e.cjs`. Docs: ARCHITECTURE ("Phone app"), MANUAL, README, FORMAT (asset id from the app, `app` value), PLAN-mobile (stage 3 done, open question answered).
- **Notes:**
  - Owner's answers (2026-11-12): images + video only for now; the PDF is pages drawn as pictures (canvas + device fonts → one JPEG per page, own ~80-line writer): any script renders, no font shipped, text not selectable.
  - Identity: `key = sha1(lower(name) + "\n" + size)[:16]`; mtime is left out on purpose (iOS gives the pick time for Photos). The app's package carries `asset.id = key`, `path = name`; Sight matches it by name + size. A review imported from Sight keeps Sight's asset (id / path) for the way back.
  - Rows are written only through `mobile/js/model.js`, in Sight's shapes (reply tombstones, status events + `status_at`, `edited_at`, drawings' `data.note` / `data.reply` / ctx, `setReviewState` = `Library.set_review_status`); every merge goes through review-core `mergeRows` — a merge rule change still needs only Python + review-core (+ parity fixture).
  - Owner's requests during the stage: scrub by a sideways drag on the video (same mapping as Sight's click-drag; a tap still plays / pauses, a vertical swipe still scrolls), and a text tool in the canvas (FORMAT.md `text` rows, no format change; Sight's defaults).
  - review-draw.js obeys review-core's rule: no closing script tag / HTML comment opener in the file (`_inline_js` refuses). Its body class is `rd-open` (the page's zoom viewer keeps `zoomed`).
  - Video: fps from the MP4 / MOV `stts`, else measured while playing (`requestVideoFrameCallback`), else 25 ("≈25 fps" shown). Stepping and ctx (`{t: 3 dp, hold: 0}`) as Sight. Card / report frames come from a hidden second `<video>` and are cached in IndexedDB (`frames`), so notes stay readable without the file.
  - Service worker: precache everything, cache-first; a new version waits until the user taps *Reload* (the first install's `clients.claim()` must not reload — found in testing).
  - GitHub Pages needed a one-time setting by the owner (done 2026-11-12): Settings → Pages → Source: *GitHub Actions*; the app is at https://anurbis-dev.github.io/sight-media-viewer/. Deploys only from `master`; other branches just run the unit tests + build. The workflow is `phone-app.yml` ("Phone app (Sight Review)"; first named `pages.yml`); it is separate from `release.yml` — a desktop release does not deploy the app and the app does not need a release.
  - Tested here (Linux, headless Chromium at iPhone size): `python -m unittest tests.test_pwa` — build, unit (model, fps parser on synthetic `moov`, PDF writer opened by PyMuPDF), and a round trip: the app reviews a PNG and a VP9 WebM (stepping, 24 fps measured, drawn notes, reply drawing, reply picture, resolve, review state) → `.srev` imported by Sight's own `Library.import_annotations` path (name + size match, every row, shot file, status history, rect in native px) → Sight adds a reply + note → the app merges it into a fresh profile, re-pick by name + size binds the file, re-import reports "already up to date". Offline reload and the update banner checked by hand with Playwright. **Not checked** (no device here): a real iPhone / iPad / Android — see PLAN-mobile stage 3 "Left to check".
  - Fresh-agent reviews, one per block: (1) moving the canvas out of the page — nothing serious (CSS of all 35 canvas elements compared old vs new: identical); applied: review-core looked up on open (load order), `box-sizing` inside `.draw`, the page test now checks `%%DRAW%%`. (2) the app — fixed: the IndexedDB connection was cached forever (iOS drops it in the background) and a failed save was not retried (now: reconnect + retry once, the pending snapshot stays until written, retried every 3 s); Back (iOS edge swipe / Android) while drawing closed the review under the canvas and Done crashed (now Back closes the viewer / sheet, or is undone while the canvas is open); two quick opens mixed two reviews (fps of one saved into the other) and late frames / thumbnails landed in another or a deleted review (now an open sequence, `rv` everywhere, `putIfAlive`); a JPEG with EXIF rotation from Sight has unrotated width / height while drawings are in the shown size (the file's probed size now wins); double tap on Send sent twice; an edit during an import into the open review was dropped; stepping rounded (skipped a frame from the second half of one) and notes were stored at the raw time (now `frameStart`: floor + 0.01·fd, as Sight's stepping lands — Sight's own copy of the bug is queued in PLAN.md). Not changed: Photos-picker copies (HEIC → JPEG, re-encoded video) do not match Sight's originals by name + size — documented (use Files). (3) text tool + scrub — fixed: the focused text field scrolled the canvas (`overflow: clip`, scroll reset, `preventScroll`), so later fields / zoom anchors were off; a pinch while typing committed and opened a new field (the finger now navigates); wheel / Fit while typing left the field behind (it now follows `apply`); Cancel dropped the typed text even when the discard was declined; Esc during IME composition; a resize while typing never re-fitted; a second finger during a scrub froze the timecode; a mouse released outside the stage left hover scrubbing; a WebM without duration threw; a tap right after a touch scrub was ignored.
  - Not done (later stages / deliberately): PSD / PDF pages, 3D (stage 4), trackers, clouds; drawing on an attached picture (the web page has it); "mine / others" drawing filters (the app is one person's).

## 0.22.0 — 2026-11-12 — Technical debt from PLAN.md: grid refresh past 800, Starlette, faster start, thumbnails off the GIL
- **What:** every queued item of `docs/PLAN.md` (owner's decision 15 in PLAN-mobile: no debt before the phone app). Fixed: a status / tag / thumbnail change of an asset past #800 in the grid now shows (it never did); on a zoomed-in board, panning no longer keeps every original it passed decoded. Faster: server start (Linux container: process start → `/api/health` 390 → 181 ms median), the startup scan waits for the first grid page, the Windows splash's PowerShell only starts when a launch is slow, the API stays responsive while PSD / PDF thumbnails are made (1,000 PDF + text files, same container, back-to-back runs: `/api/assets` while thumbnails are made median 81–93 → 13–14 ms, p90 146 → 31 ms, max 275 → 52–75 ms; all thumbnails 27–29 → ~14 s), three.js is prefetched when the library has 3D files, smaller build. New: `tools/bench_startup.py`, `tools/bench_grid.py`. Windows launch focus: `AllowSetForegroundWindow` + an `AttachThreadInput` fallback.
- **Where:** `app/web.py` (new: FastAPI-shaped router on Starlette); `app/server.py` (imports, `App()`, `POST /api/assets/by-ids`, `first_page_served` in `/api/assets`); `app/library.py` (`_LIST_COLS` / `_list_item` / `assets_by_ids`, `_first_page` gate in `resume_watchers`, `render_psd_thumb` / `render_pdf_thumb`, `HeavyWorkers` + `_heavy`, `thumb_version` caches 0, `_mark_thumb`, `prioritize` regenerates missing files); `app/static/index.html` (`refreshItems` / `refreshIds` / `refreshStaleVisible` / `staleIds`, `loadedIds`, incremental `computeMasonry`, 3D prefetch at the end of boot); `app/static/canvas.js` (`syncResolution` off-screen downgrade); `Sight.py` (starlette dep, `allow_foreground_handoff`, `_bring_to_front`, `LazySplash`, `freeze_support`); `build_exe.bat` / `build_app_macos.sh` (starlette, `--exclude-module` tkinter + 13 pxr bindings); `tools/benchlib.py`, `tools/bench_startup.py`, `tools/bench_grid.py`. Docs: ARCHITECTURE (web.py, grid refresh, heavy pool, scan gate, `_mark_thumb`, canvas), PLAN.md rewritten (what is left to check on Windows), CLAUDE.md (Starlette).
- **Notes:**
  - `app/web.py` rules (ARCHITECTURE has them): params by name from path → query → default; only `Request` / `int` / `float` / `bool` annotations matter; plain `def` → thread pool, `async def` → event loop (wrap blocking library calls in `asyncio.to_thread`); Response as is, else JSON with inf / nan → null (FastAPI did the same; a stored `inf` from a PATCH or a `.srev` made `/api/state` a 500 in the first cut); HEAD on a GET route → 405 as under FastAPI. An A/B of ~80 requests against the FastAPI build matched except the 422 message text and `Allow: HEAD, GET`. Existing runtime venvs keep working (starlette came with fastapi); a fresh one installs starlette.
  - Grid refresh: only what is on screen (+ inspector + lightbox asset) is re-read by id; everything else is marked stale and re-read when its card shows. Never go back to re-reading "offset 0 … N": the server caps `limit` at 800. `pull()` keeps a row it already has stale instead of trusting the duplicate.
  - Heavy thumbnails: 2 spawned worker processes of our own (`HeavyWorkers`; never fork: SQLite + threads), started on first PSD / PDF, stopped after 60 s idle. A timeout (120 s of work) or a crash kills that worker and skips the file for the session — it is never re-rendered in the server (a file that crashes MuPDF would take Sight down). Only if processes cannot start at all does it render in the thread. Text thumbnails stay in threads (cheap). Measured equal to a ProcessPoolExecutor (300 PDFs: 4.93 vs 4.87 s; threads 10.66 s). In a frozen build the children are the exe itself → `multiprocessing.freeze_support()` first in `if __name__ == "__main__"` — keep Sight.py / library.py free of module-level side effects.
  - The splash is still PowerShell (a native ctypes window could not be tested here, and a bad window procedure would crash Sight). Build: `--collect-all pxr` still ships the excluded packages' `__init__.py` (harmless, never imported); `pxr.UsdUI` must stay (UsdShade loads it — excluding it printed a USD warning on every conversion). Linux dist 617 → 581 MB, 30 → 17 USD binding modules.
  - Board originals: also back to the thumbnail when more than a screen away (Playwright, 30 × 12 MP at 4×: 11 originals kept while panning before, ≤ 5 after).
  - Benches: an isolated copy of a SIGHT_HOME (or a synthetic library), a headless Edge / Chrome / Chromium over a stdlib WebSocket CDP client; `bench_grid` also checks the grid never re-anchors `scrollTop` on its own (0 of 600 frames here). Window placement / focus / splash are not measured (no app window) — PLAN.md lists what to check by hand on Windows.
  - Not verified here (Linux container): anything Windows-only — focus, splash, `build_exe.bat`, the frozen exe's worker processes, Defender first-start time. PLAN.md "Left to check on Windows".
  - Fresh-agent reviews, one per block, findings fixed: (1) grid refresh — a Ctrl+A selection of > 5000 was cut by the server but marked fresh (now: on-screen + inspector + lightbox, ≤ 2000 per request, the rest stays stale), duplicates in `pull()` lost their stale mark, the lightbox's asset was not refreshed, `by-ids` ran its query on the event loop; `_bring_to_front` now catches `ctypes.ArgumentError` too. (2) startup — inf / nan → 500 on `/api/state`, `pxr.UsdUI` exclusion warning, HEAD now running GET handlers. (3) thumbnails / grid / canvas / benches — the first cut used a ProcessPoolExecutor: a running job blocked process exit (hung PSD → hidden Sight.exe never exits), a timeout neither cancelled nor killed the job (late writes without DB update, the same file resubmitted until both workers hung), a child that died on a file was re-rendered in the server (crash); replaced by `HeavyWorkers` (tested: hang killed at the timeout, crash → skipped, idle reap, exit with a hung job in flight is immediate, no orphans). A cached 0 could stick (now re-checked after 30 s); has_thumb assets whose file was deleted were never regenerated (pre-existing; now `prioritize` does). Benches: refuse a Python without Sight's deps (the venv re-exec would orphan the server on Windows), stop the server when it never answers.
  - MemPalace is not available in the cloud session; nothing stored there.

## 0.21.0 — 2026-11-11 — HTML reviewer page: vector drawings shown and drawn on the page
- **What:** stage 2 of `docs/PLAN-mobile.md`. The web page for reviewers now gets clean pictures and draws the review's drawings itself (vectors, sharp at any zoom), with *My drawings* / *Others' drawings* switches (pencil next to search). Reviewers can draw: the pencil in a reply / new-note field or *✎ Draw* in the full-screen viewer opens a full-screen canvas — brush with pen pressure, highlighter, arrow, rectangle, ellipse, eraser, five colours, undo / redo, two-finger pinch / pan, "pen draws, finger pans" once a stylus was used, wheel zoom on desktop. A drawing on a note's frame goes with a reply (`data.note` + `data.reply`), a new note can be drawn on the cover (pictures) or on any note's frame (video / 3D; the new note takes that frame's ctx). Drawing on an attachment sends a flattened copy of the picture instead. Sight imports it all through the usual merge; reply drawings get the reply's eye toggle there. Also fixed: exporting a PDF / web page while the video was playing lost every drawing on the video frames (the clip ran on after each seek, so the frame was ~1 frame late and `visibleNow` rejected the drawings) — `gatherReport` now pauses and resumes.
- **Where:** `app/static/annotate.js` (`gatherReport(forPage)`: clean cover / frames + `coverSize`, per-note `size`, reply `id`, `media`; pause during export; `visibleNow` → `frameNow()` + `RC.ctxVisible`). `app/static/review-core.js` (`ctxVisible`, `drawingRow`). `app/server.py` (export/html passes `coverSize`, `media`). `app/review.py` page template: `frameOf` / `vbOf` / `drawingsOf` / `shownOn` / `pic` / `overlay`, `drawSheet` (canvas), `drawFlat`, `editDraw`, `pickFrame`, `drawRows` / `drawCtx`, drafts `draw: {frame, items}`, `E.rows`, viewer entries `{f}` / `{src, note}` with a Draw button (`drawTarget`), `#vwrap` switches. Docs: ARCHITECTURE "HTML reviewer page", FORMAT Context, MANUAL, PLAN-mobile.
- **Notes:**
  - No format change: the page writes ordinary `stroke` (brush / marker) and `shape` (arrow / rect / ellipse) rows. A drawing on a reply copies the note's video `{t, hold}` (so it lives exactly as long as the note's own drawings) or 3D `{vk, cam}`; picture → `ctx: null`. Sizes are screen px at draw time / zoom (brush 6, highlighter 24, shapes 4, eraser radius 14), like Sight's tools.
  - Doc mapping on the page: picture / video frames are the whole media scaled, so the overlay's `viewBox` is `0 0 media.w media.h`; 3D frames use `-500·a -500 1000·a 1000` (a = frame aspect). Checked against Sight: a ring drawn on a GLB cube in Sight sits on the same spot on the page, and a rect drawn on the page sits there in Sight.
  - The eraser only removes objects drawn in the current canvas session; the page never deletes exported rows (no tombstones from the page).
  - Gestures: a second finger during a finger stroke cancels that stroke and becomes a pinch; while a pen draws, fingers are ignored; `pointercancel` finishes a stroke. The canvas is a `.draw` overlay that the document click handler ignores (like `.zoom` / `.pick`). The viewer's Draw button is skipped by the overlay's `pointerdown` (else pointer capture would steal its click).
  - Pages exported before 0.21 keep their own script and burned-in frames. A page with `media` missing (shouldn't happen) falls back to plain frames without drawing.
  - Tested with Playwright on an isolated `SIGHT_HOME`: image / video / GLB exports via the menu, page rendering, every tool, undo / redo / eraser / Ctrl+Z, wheel zoom + drawing while zoomed, synthetic touch (pinch, stroke cancelled by a 2nd finger) and pen (pressure, then finger pans), frame picker, viewer Draw, flat drawing on an attachment, Cancel confirm, remove unsent reply → its rows go, state change + empty-field close, download → import (`added` / `updated` as expected), Sight showing the imported drawings (image, video at f48, 3D view), PDF frames with drawings again. Not checked: a real iPad / Android device.
  - Fresh-agent code review (it also drove the page in headless Chrome) found, all fixed: a `pointercancel` (e.g. an iPad palm rejected by the system) kept its stroke — now dropped; a pen landing while a palm / finger stroke or pan was active was ignored — the pen now wins (palm stroke dropped, pan stopped); × on a draft drawing / picture also closed an otherwise empty field (the click reached the outside-tap handler after the button was gone) — `stopPropagation`; `ctxVisible(c, {vk: undefined})` showed everything — now "no view"; a resize mid-pinch reset the zoom. Not changed: a 3D drawing with `ctx: null` shows on every 3D frame on the page (same as Sight's `visibleNow`), while the PDF's 3D frame filter (`ctx.vk === note vk`) leaves it out.
  - MemPalace was not available in this (cloud) session, so nothing was stored there.

## 0.20.0 — 2026-11-11 — Shared review format (FORMAT.md) and JS core (review-core.js); drawings on replies
- **What:** stage 1 of `docs/PLAN-mobile.md`. The review data contract is written down in `docs/FORMAT.md` (package, rows, every drawing type, ctx, status rows, shots, tombstones, merge rules). Drawing rendering and the merge rules now live in one plain script, `app/static/review-core.js`, used by Sight and inlined into the HTML reviewer page; the mobile app will use it as is. New field `data.reply` on a drawing: in Sight such a drawing gets an eye toggle with its count on the reply, is hidden while the reply is deleted / toggled off, and is deleted (undoably) together with the reply.
- **Where:** new `app/static/review-core.js` (geometry/primitives/bounds/hit tests/transforms/`validItem` moved out of annotate.js unchanged; new `mergeRows` / `mergeReplies` / `mergeHistory` / `contentAt` / `stamp` = JS port of `Library.import_annotations` & co.; `drawCanvas`, `svgMarkup`). `app/static/annotate.js` (imports the core, `replyGone`, `S.hiddenReplies`, `rdrawChip` / `[data-rdraw]`, `deleteReply` takes the reply's drawings, `ghostNow` and reports skip them). `app/review.py` (`core_js()`, `build_html` single-pass `%%TITLE|DATA|CORE%%` substitution, page `download()` uses `RC.mergeRows`). New `docs/FORMAT.md`, `tests/test_merge_parity.py`, `tests/merge_js.cjs`, `tests/fixtures/merge_cases.json` (+ `make_merge_cases.py`). ARCHITECTURE, MANUAL, CLAUDE.md, PLAN-mobile.
- **Notes:**
  - review-core.js is a classic script on purpose (sets `globalThis.SightReviewCore`, `module.exports` under Node): an ES module could not be inlined into the page's classic script nor `require`d by the Node test. annotate.js does `import "/static/review-core.js"` for the side effect and destructures the global. Never write a closing script tag or an HTML comment opener in that file — `core_js()` raises (the page inlines it verbatim).
  - Merge parity: `python -m unittest tests.test_merge_parity` (needs `node`) runs Python `import_annotations` on a temp library and JS `mergeRows` on the same 15 fixtures and compares every row, the stats and that inputs were not mutated. Any merge rule change goes into both + a new fixture case. The JS port keeps ids (lower-cased); Python's re-derivation of non-hex ids / ids of another asset is Sight-only. Python truthiness / `or` / `int()` are emulated (`pyTrue`, `pyOr`, `stamp`, `num`) for the values clients write; NaN, `True` vs `1`, float ids are not.
  - The page's reply file is now `mergeRows(exported rows, local edits)`: replies sorted by `created`, the state by `status_at`, new notes inserted. Exported notes keep their exported `updated_at` (Sight before 0.17 merged notes by it; found in review).
  - Geometry move checked: old (master) vs core functions on 4 000 random items in Node — identical prims / SVG / bounds / hit tests / transforms (the reviewer repeated it on 44 000). Playwright on an isolated `SIGHT_HOME`: core rendering, reply eye toggle, Delete with a hidden selection, reply delete + undo (server rows too), mouse brush, `S` screenshot, PDF + HTML export via the menu, HTML page reply + resolve → download → import back (`updated: 1`), no console errors.
  - Fresh-agent code review found three bugs, all fixed: onion skin still ghosted drawings of hidden / deleted replies; hiding a reply's drawings left them selected so Delete removed them unseen; the page's download bumped exported notes' `updated_at`. It also fuzzed the merge (7 500 random cases, no mismatch on client-written values).
  - Not done (later stages): Sight cannot draw on a reply yet (only show / hide / delete such drawings); the HTML page does not render vectors yet (stage 2 — the core is already inlined there).

## 0.19.3 — 2026-11-11 — HTML page: picture viewer swipes between pictures; no scrolling through it
- **What:** on the reviewer page, dragging on an enlarged picture no longer scrolls the page behind it. A horizontal swipe (← / → on desktop) goes to the next / previous picture, a vertical swipe, a tap or Esc closes; a counter shows *2 / 5*. Galleries: the cover plus every shown note frame; and per note its attachments together with its replies' pictures — never across notes.
- **Where:** `app/review.py` HTML template — `zoom(gal, at)`, `frameGal` (rebuilt in `renderList`, cover at 0), `noteGal` (set in `noteCard`, filled by `thumbs`, reset after each card), `.zoom` CSS (`touch-action: none`, `body.zoomed { overflow: hidden }`).
- **Notes:**
  - The overlay takes pointer events and cancels `touchmove` (non-passive) — that is what stops the page scroll on iOS; `overflow: hidden` on body alone does not.
  - A tap closes on `click`, not on `pointerup`, so the click does not land on the page under the overlay (the document click handler that closes empty fields ignores `.zoom` targets).
  - The frame gallery follows the current filter / search (only shown notes). Pages exported before 0.19.3 keep their old viewer.

## 0.19.2 — 2026-11-11 — Merge the lost 0.15.1–0.15.6 fixes (no console windows; grid blink)
- **What:** Console windows no longer flash on Windows while video/audio thumbnails and waveforms are built, and the library grid no longer blinks / jumps by a row while scrolling or zooming. Both had been fixed in 0.15.1 and 0.15.5, but those commits lived on the side branch `claude/review-and-startup-speed` and never reached master: 0.16.0 (annotations) was branched from 0.15.0, so every build since then shipped without them. This also brings in the rest of that branch: faster startup (0.15.2), maximize/focus on launch (0.15.3), splash closing with the window (0.15.4), `docs/PLAN.md`.
- **Where:** merge of `claude/review-and-startup-speed` (0.15.1–0.15.6 entries below). Conflicts: `server.py` `/api/assets` keeps 0.17's `review` filter and returns 0.15.2's `JSONResponse`; `version.py`; this file.
- **Notes:**
  - Check after a merge that `grep -n "subprocess\." app/*.py` shows `creationflags=NO_WINDOW` (from `fileinfo.py`) on every console program run by the windowless app (ffmpeg, powershell, cmd), and that `.grid` in `index.html` has `overflow-anchor: none`.
  - Before starting a feature branch, branch from the current master, not an older commit: that is how these fixes were lost.

## 0.19.1 — 2026-11-11 — HTML page: empty fields close on an outside tap; new note behind a + button
- **What:** on the reviewer page an empty reply field (no text, picture or *Mark as* state) closes when you tap anywhere else (Esc on desktop). The new-note form is no longer always at the end of the feed: the blue *+* in the bottom bar opens it (one at a time — + again just jumps to it; × discards it; empty + outside tap hides it).
- **Where:** `app/review.py` HTML template — `newOpen` / `opening`, `closeEmpty` on a document `click` listener, `isEmpty`, `focusLater`, `#add` in `.foot`, `.compose h3` close button, composer `data-key`.
- **Notes:**
  - The outside-tap check runs on `click` (bubbling), after the tap's own handler, so a field that very tap opened is skipped via `opening`. It is not done on `pointerdown`: re-rendering there shifts the layout under the finger and the click lands elsewhere.
  - A field with any content stays open on an outside tap — only empty means cancel. Taps on the name dialog or the zoomed picture are ignored.
  - Focus is applied in `requestAnimationFrame` by looking the textarea up by key, because closing another empty field in the same click re-renders the page a second time.

## 0.19.0 — 2026-11-11 — Notes can be *In progress*; reply pictures; HTML page: name gate, pinned filters, chat-style field
- **What:** a note is open, *in progress* (someone took it) or resolved — a clock button in Sight, orange number / timeline marker, logged in the thread like resolve. Replies can carry pictures. The HTML page asks the reviewer's name before anything else; the sender (*From …*), *You: … ✎* and the *All / Open / In progress / Resolved* filters with count badges are pinned with the title; search hides behind an icon. *Reply* opens one full-width field (paper clip = attach, paper plane in the bottom-right corner = send) with *Mark as In progress / Resolved / Reopen* chips — the state goes with the reply or alone. New notes take pictures too; unsent entries have × to take them back.
- **Where:** `app/review.py` (HTML template rewritten: `composer()`, `readImage`, gate `#gate`, `paintSeg`, `statusOf` from the last local event, `E.att`; `build_package` packs reply shots; PDF reply pictures + `EVENT_LABEL` + in-progress tag); `app/library.py` (`import_annotations` remaps `replies[].shots`); `app/static/annotate.js` (`ICON.prog`, `data-prog` toggle, `EVENT` / `eventIcon`, `.prog` styles, `img[data-rshot]` in replies, report / copy text carry reply shots and the state).
- **Notes:**
  - No format change: `progress` is just another `status` value (merged by `status_at` like done/open) and reply `shots` is an optional field. Sight before 0.19 shows an in-progress note as open-looking and ignores reply pictures. `_OPEN_NOTES_SQL` counts in-progress as open (≠ done), as do carry-over and the report's *Open*.
  - Page state model changed: `E = {replies, notes, att}` — no separate `E.status`; a note's state on the page is its last unsent event, else the exported one. On download the last event sets `status` and `status_at` (= that event's time). Pages exported by 0.18 keep their own embedded script, so nothing to migrate.
  - Page pictures are scaled to ≤1600 px JPEG 0.85 in the browser and kept in localStorage (`E.att`) until downloaded; if the quota runs out the page alerts once and asks to download now (edits stay in memory). Enter sends on desktop; on touch screens Enter is a newline.
  - Sight cannot attach pictures to a reply yet (only show them) — the planned mobile review app is the next step.

## 0.18.0 — 2026-11-11 — Review history: resolve / state changes are logged; phone-friendlier HTML page
- **What:** resolving or reopening a note adds an entry to its thread (*✓ Resolved by X · date*), in Sight and on the HTML page; the file's review state keeps a history (who set which state when), shown under the State row in Sight and in the HTML page's details. The HTML page has a pinned title bar — tap it or the arrow for path / chips / state history (collapsed by default) — and a one-line bottom bar (*N changes · Discard · Download reply*).
- **Where:** `app/static/annotate.js` (`statusEvent`, `eventLabel`, event rows in `repliesHtml`, resolve toggle, `copyText`, `gatherReport` passes `event`; `STATE_LABEL`, `histLine`, `.an-rsh` in `paintStatus`, `S.statusHist`); `app/library.py` (`set_review_status` appends history and keeps the row on clear, `merge_history`, status rows union `history` in `import_annotations`); `app/review.py` (HTML template: `.top` header + `#details`, events on Resolve/Reopen with undo-of-unsent, compact footer, state history; PDF `revent` lines).
- **Notes:**
  - A status event is a reply-shaped entry `{id, event: "done"|"open", author, created}` — it merges like a reply (union by id) and needs no format change; Sight before 0.18 shows it as an empty reply. The note's actual state is still `status` / `status_at`; the events are only the log.
  - On the HTML page, toggling back an unsent resolve drops its entry instead of logging a reopen (nothing was sent yet). In Sight every toggle is logged — it is committed immediately.
  - Clearing the review state used to delete the status rows; it now keeps one with `state: null` so the history survives (`_REVIEW_SQL` reads null = no state). Status rows from 0.17.0 have no history — their current state is used as the first entry.
  - History entries set in the same millisecond keep insertion order (stable sort by `at`).

## 0.17.0 — 2026-11-11 — Review round-trips: merge, replies, versions & compare, review state, HTML page for reviewers
- **What:** importing a `.srev` now merges instead of duplicating; notes have replies; files get a review state (Needs review / Changes / Approved) shown on grid cards and filterable in the sidebar; versions of a file (`_v001`, `_v002` …) are detected, open notes can be copied to the next version, and `K` opens a compare view (multi-layer swipe, tile / row / column, over / difference, synced video with a per-clip first-frame offset); a self-contained HTML page lets people without Sight reply / resolve / add notes and send back a `.srev`.
- **Where:** `app/library.py` (`import_annotations` rewritten, `merge_replies`, `annotation_tombstones`, `set_review_status`, `asset_versions` / `version_key`, `_REVIEW_SQL` / `_OPEN_NOTES_SQL` in `list_assets` / `_clause` / `review_counts`, annotations re-targeted in `_migrate_asset`); `app/review.py` (`put_shot`, package `deleted`, `build_html` + template, replies in the PDF); `app/server.py` (`/api/assets/{id}/versions`, `/api/assets/{id}/review-status`, `/api/review/export/html`, `review=` on `/api/assets`, import returns `{added, updated, deleted, unchanged}`); new `app/static/compare.js`; `annotate.js` (replies, state row, versions row + carry-over, `gatherReport` shared by PDF / HTML, host hooks `openCompare` / `onReviewChanged`); `index.html` (`cmp` instance, `compareFromContext`, `K`, palette entry, card `.rv` pill, `REVIEW_ROWS` in `renderTypes`, `filter.review`).
- **Notes:**
  - Merge rules (see ARCHITECTURE "Review API"): ids are kept; per row the later *content stamp* wins (note: `data.edited_at` / `created`; drawing: `updated_at`) — NOT `updated_at` for notes, because replies and resolving bump it and a reviewer's stale copy would then overwrite newer text or revive a deleted note (found in review). Replies are unioned by id, the open/done state goes by `data.status_at`, tombstones travel in `pkg.deleted`. Clock skew between machines decides ties — accepted. `.srev` stays format version 1 (older Sight ignores `deleted` and gives rows fresh ids, as before). Notes edited before 0.17 have no `edited_at`: on a tie the local copy wins.
  - The review state is an annotation row (`kind='status'`) so it travels in packages; a merge can leave two status rows on one asset — readers take the newest, and `set_review_status` retires the others when the state is set or cleared. `validItem` in annotate.js skips it.
  - Independent review fixes also in this version: board shortcuts (canvas.js) are disabled while Compare is open; `K` on a board uses the board selection; a slow-seeking clip in Compare is not re-seeked every frame; an import is one transaction (bad rows → 400, nothing written); versions are looked up in the folder only, not its sub-tree.
  - Versions are only looked for in the same folder (no `v002/shot.mp4` sub-folder layouts) and only for image / video / PSD. Carry-over scales drawings by the pixel-size ratio of the two versions (asset width/height; unknown → 1).
  - Compare: no annotations inside it; no per-layer opacity; 3D models are not comparable. Every visible layer is a live `<video>` (tile + Difference adds a reference copy per cell), so many 4K clips will strain the decoder. The playhead is a wall clock — a stalled clip is re-seeked, not waited for.
  - The HTML page embeds every frame / screenshot as JPEG / PNG data URLs (a picture with one note ≈ 100 KB; long video reviews can be several MB). Reviewer edits live in that browser's localStorage, keyed by asset id + export time, until downloaded. The page shows the file's path (like the PDF).
  - Also fixed: annotations no longer get lost when a file is moved / renamed (they followed the old asset id).

## 0.16.2 — 2026-11-11 — Review files use the short `.srev` extension
- **What:** *Export → Review file* now saves `<name> review.srev` instead of `.sightreview`. Old `.sightreview` files still import (file picker, palette, drag-and-drop).
- **Where:** `app/review.py` (`PACKAGE_EXT`), `app/server.py` (`export_review_package`), `app/static/annotate.js` (Export menu label, file input `accept`), `app/static/index.html` (palette label, `pickReviewFile`, window drop regex), MANUAL / ARCHITECTURE.
- **Notes:** only the extension changed — the JSON inside is identical (`format: "sight-review"`, version 1), so no migration. Keep accepting `.sightreview` on import; files from 0.16.0–0.16.1 are already out there. Import checks the JSON `format`, not the extension, so the extension list only matters for the picker filter and drop detection.

## 0.16.1 — 2026-11-10 — Release builds for all platforms on GitHub Actions
- **What:** a tag `v<APP_VERSION>` — or a manual run (Actions → Release builds) with *Publish a GitHub Release* ticked, which creates that tag itself — builds Windows x64, macOS arm64, macOS x64 and Linux x64 on GitHub, smoke-tests each packaged app and publishes them as a GitHub Release. Manual runs (Actions → Release builds) and pushes that touch the build pipeline build without releasing.
- **Where:** new `.github/workflows/release.yml`; `build_exe.bat` (`if not defined CI pause`); `build_app_macos.sh` (Linux-aware closing message); README "Release builds on GitHub".
- **Notes:**
  - CI calls the same build scripts as a developer, so PyInstaller options live in one place per OS. If you add `--add-data` / `--collect-all` to one script, check whether the other needs it.
  - Smoke test: the packaged binary runs with `--no-browser --port 8799` and a temp `SIGHT_HOME`; it must answer `/api/state` with the version from `app/version.py`. The tag/version check fails the run on a mismatch, so bump `APP_VERSION` before tagging.
  - Runner labels: `windows-latest`, `macos-15` (Apple Silicon), `macos-15-intel` (GitHub's last Intel image; when it is retired, drop that row), `ubuntu-22.04` (older glibc so the Linux build runs on more distros).
  - The Linux build and its smoke test (plus a Cyrillic PDF export from the packaged app) were run in this container; the Windows and macOS jobs could not be run here — the first workflow run is their test.
  - PyMuPDF 2.x has no Intel-Mac wheel and its sdist fails to build (`pymupdf-lite` name mismatch), so both scripts pass `--only-binary pymupdf`: the Intel job gets the newest PyMuPDF that has a wheel, the others are unaffected.
  - macOS builds are not signed / notarized (no Apple certificate in the repo); release notes tell users the right-click → Open step.

## 0.16.0 — 2026-11-10 — Lightbox annotations and review sessions (draw, notes, screenshots, PDF / .sightreview)
- **What:** `A` in the lightbox (`Shift+A` in 3D) turns on annotation mode for images, PSDs, video and 3D models: a compact top toolbar (select, brush with pen pressure, pencil, highlighter, eraser, line, arrow, rect, ellipse, text, numbered pin, screenshot, region screenshot, undo/redo, onion, hide, panel) plus a second row with the current tool's or the selection's settings. All drawings are vector objects, editable later (move / scale / rotate / restyle / bend lines / re-edit text). A right panel collects review notes (text, reviewer, date, screenshots via `S` / `Shift+S`, resolve, delete); a note takes the unattached drawings on screen. Video: drawings and notes sit on a frame, markers on the timeline, `,` `.` frame step, `Shift+,` `Shift+.` marker jumps, hold time, onion skin. 3D: drawings belong to a camera view; notes also save shading/lights/explode/fov and restore them. Export: PDF report, `.sightreview` package (import by drag-drop, panel menu or palette; matched to the same media by path, else name+size), notes as text.
- **Where:**
  - new `app/static/annotate.js` (`createAnnotator`: tools, primitives → SVG + canvas, hit tests, transforms, undo, props bar, panel, markers, screenshots, export/import, keys).
  - new `app/review.py` (shots on disk, `build_pdf` via PyMuPDF `Story`, `build_package`, `parse_package`); routes `/api/review/*` in `server.py`.
  - `library.py`: `add_annotation` accepts a client `id` (revives a tombstoned row); `match_review_asset`, `import_annotations`.
  - `index.html`: `annot` instance + host hooks, `#annoBtn` in the lightbox bar, `annot.setAsset` in `showInLight`, `bind2d` / `viewChanged` in `attachViewer`, `bindAnnot3d` in `boot3d` (mesh + splat), `getView` / `setView` on `makeCameraRig`, `annot.onKey` first in the keydown handler, `syncLightHint`, `pickReviewFile`, window drop of `.sightreview`.
  - Fix in passing: `.light-frame > .view3d > canvas` is absolutely positioned — the px-sized WebGL canvas held the frame's grid track at its old width, so the 3D view never shrank (window narrowed, or now the review panel) and was cut off on the right.
- **Notes:**
  - Data model, coordinate spaces and hooks are written up in ARCHITECTURE.md → "Annotations / review". Board (canvas) annotations are still not built; the table already supports `scope='board'`.
  - Input is taken in the capture phase on the viewer surface with `stopImmediatePropagation`, so the viewer's pan/zoom (middle/right), scrub and orbit stay untouched; a capture-phase `click` guard stops a drawing gesture from also toggling video play. Don't move those listeners to bubble phase.
  - Text editor focus is set synchronously and the toolbar's `mousedown` is cancelled while editing — otherwise fast typing / clicking B lands in the tool shortcuts (`o` → ellipse, …).
  - Saves: create = `POST` per object (client id), edits debounced into `/api/annotations/batch`; updates and deletes await a pending create (`S.creating`) so they can't overtake the insert.
  - 3D views match by camera distance (0.4 %); damping is off while annotating (`annotating(on)`), and `setView` disables damping for one update so a restored view doesn't drift away. A note's `v3d` is applied live (`setV3D`) but not saved to settings.
  - PDF: client composes frames (`composeNative`: native image/video frame, or the 3D view) as JPEG data URLs; the server lays out HTML with MuPDF Story, whose fallback fonts cover Cyrillic. `max-height` is ignored by MuPDF, so images are sized by width (`_img_tag`). Export goes to `~/Downloads` (else `<SIGHT_HOME>/exports`) and is revealed; a missing file manager is ignored.
  - Not done: a `sight://` link / file association that opens a review from a messenger directly (needs launcher + OS registration, untested platform work) — the package file is the transport for now. No point-level stroke editing (Grease Pencil edit mode); strokes transform as a whole and the eraser can split them.
  - Checked with Playwright on an isolated `SIGHT_HOME` (images, video 24 fps, a GLB cube under SwiftShader): every tool, synthetic pen pressure, Shift snapping, bend, eraser + undo, rotate/scale/duplicate/copy/paste/delete, text re-edit, notes, both screenshots, frame stepping and markers, onion, 3D view switch + shading restore, PDF (image/video/3D) and package export + import (UI and API), no JS errors. Not checked: a real pen tablet, Windows/macOS file reveal, the packaged builds.

## 0.15.6 — 2026-11-10 — Grid thumbnails decode asynchronously again
- **What:** Reverts 0.15.4's `decoding="sync"` on grid thumbnails back to the original `async`. Nothing changes visibly.
- **Where:** `index.html` `fillThumb`; `docs/ARCHITECTURE.md`.
- **Notes:** `sync` was added against the scroll blink, but that blink was scroll anchoring (0.15.5), and `sync` made no measurable difference in the off-screen Edge runs. `async` was the deliberate original choice: a fast scroll or the first screen brings dozens of new thumbnails at once, and `sync` makes the frame wait until all of them are decoded (the decode itself still runs off the main thread), while `async` shows the frame and fills the images in. The lightbox keeps `sync` for an already-cached picture: that is a single image, swapped in place, where an empty frame is worse than a short wait.

## 0.15.5 — 2026-11-10 — Grid: no more blinking while dragging slowly (scroll anchoring)
- **What:** The library grid no longer blinks while it is scrolled slowly. At certain positions it flipped between two rows on every frame, and kept doing so after the scrolling stopped.
- **Where:** `index.html` CSS: `.grid { overflow-anchor: none; }`.
- **Notes:**
  - Root cause: Chromium's scroll anchoring. `renderGrid()` moves `.slice` (`top = startRow * rowH`) and replaces the cards above the view. Anchoring "corrected" `scrollTop` by one row to keep its anchor card in place. At the corrected position `startRow` changed back, the slice moved back, and the two flipped every frame. Seen in the owner's own window (two PrintWindow states alternating, content shifted by exactly one row). Reproduced in an off-screen Edge: scrolling 3 px per frame, `scrollTop` flipped 837 ↔ 1043 on its own (row 196 px + gap). With the fix, no flips in 400 steps.
  - Not related to the 0.15.2 speed-ups. The grid code had it before. 0.15.4's `decoding="sync"` was not this bug (reverted in 0.15.6).
  - Removed from `docs/PLAN.md`: the blink item. The "rows unpainted during very fast scrolling" seen in screencasts was most likely the same flip.

## 0.15.4 — 2026-11-10 — Splash closes with the window; thumbnails decode in sync; PLAN.md
- **What:** The "Sight is loading" splash now closes the moment the window shows, and a normal launch, which takes under ~1.7 s, does not show it at all. Grid thumbnails decode in sync (the blinking itself was a different bug, fixed in 0.15.5). New `docs/PLAN.md` lists the queued improvements and known bugs with their numbers.
- **Where:** `Sight.py`: `_close_splash()` in `main()`; `reveal_when_ready(..., on_ready=)` calls it right after the page's ready ping; `start_splash()` passes `-ShowAfterMs 1000`. `app/splash_screen.ps1`: `ShowAfterMs` parameter (sleep before `Show()`), "loading…" built with `[char]0x2026`. `index.html` `fillThumb`: `img.decoding = "sync"`. `CLAUDE.md` points to `docs/PLAN.md`.
- **Notes:**
  - Splash: the owner's test build (0.15.2) kept the splash up ~3 s after the window appeared. That was the 3 s window search fixed in 0.15.3, because the splash was closed only after it. Measured with that build: splash at ~0.7 s, window at ~0.85 s, splash gone at ~3.9 s. Now it is closed before the window search and maximize, so nothing there can hold it up. In 3 source launches it never appeared (window at ~1.3 s). Run alone, the script shows the form at ~1.5 s and is gone 20 ms after `terminate()`.
  - The literal "…" in the BOM-less `.ps1` came out as "â€¦" in Windows PowerShell 5.1, which reads such files as ANSI. Keep that script ASCII-only.
  - Blinking: it was not a regression of 0.15.2. Off-screen Edge runs against 0.15.1 and 0.15.3 showed the same counts. An in-page probe found no card or `<img>` replaced while on screen, in steady state or while the startup scan ran. What remains is Chromium painting a thumbnail empty for a frame: async decoding of images built off-screen (fixed here, the lightbox already did this for cached images), and raster lag during very fast scrolls (see PLAN.md).
  - Focus on launch (`SetForegroundWindow`) depends on Windows' foreground lock; see PLAN.md, bug 2.

## 0.15.3 — 2026-11-10 — Launch: the window opens maximized and focused again
- **What:** If Sight was maximized when it was closed, it opens maximized again, and the window gets focus on launch. Before, neither happened on this machine. The window came up at its normal size, behind whatever had focus.
- **Where:** `Sight.py`: new `_process_tree(root)` (Toolhelp32 snapshot through ctypes); `_find_browser_window(pids, user32)` now takes a set of pids; `reveal_when_ready()` passes `_process_tree(proc.pid)`; `close_browser(proc)` terminates the same tree instead of running a PowerShell WMI query by `--user-data-dir` (0.15.2).
- **Notes:**
  - Root cause: the Popen'd `msedge.exe` is a launcher. It starts the real browser process and exits within a second with code 0. The window belongs to that child, so looking for a window owned by `proc.pid` never matched. `reveal_when_ready()` then returned after its 3 s search without calling `ShowWindow(SW_MAXIMIZE)` or `SetForegroundWindow`. The page's own `moveIntoView()` still brought the window on screen, which hid the bug.
  - The tree includes processes whose parent pid is the launcher's, even after the launcher has exited. `close_browser()` terminates the launcher first, so it cannot start the browser after the snapshot.
  - Checked by launching Sight.py on an isolated `SIGHT_HOME`. With a saved `max: true` the window was maximized and in the foreground (it was neither before the fix). With `max: false` it was not maximized and in the foreground. A start that fails, tested with a `library.db` that cannot be opened, leaves no Edge process behind.

## 0.15.2 — 2026-11-10 — Faster startup and asset list; folder dialog stays on top
- **What:** Sight starts faster and the library list loads faster. Measured on this machine with a copy of the real library (1,028 assets): a source launch (Sight.py) shows its window after 1.4 s instead of 3.9 s; server start to the first `/api/health` takes 1.1 s instead of 2.75 s; one `/api/assets` page of 400 takes 7.5 ms instead of ~20 ms. Sight.exe skips the dependency check, so it gains less, roughly 0.7–1 s of ~2 s by the estimate below (not measured, no exe was built). The Add-folder dialog can no longer open behind the Sight window.
- **Where:**
  - `Sight.py`: `has_deps()` checks the running interpreter in-process with `importlib.util.find_spec` (`DEP_MODULES`); `bootstrap()` re-execs straight into `~/.sight/runtime` when its `.deps-v4` marker exists; new `listen_socket()`; `main()` opens the socket and starts the browser before the server imports, then `server.run(sockets=[sock])`; `launched` dict + `launch_lock` + new `close_browser()` close a browser window opened for a start that failed; the plain-tab fallback waits for `server.started` (`_wait_serving`).
  - `library.py`: `USDZ_CONVERTER_VERSION` (moved from `usdz_convert.CONVERTER_VERSION`); ffmpeg search in a thread (`_search_ffmpeg`, `ffmpeg_exe()`); `_thumb_v` cache in `thumb_version(aid, fresh=False)` and `_forget_thumb()`.
  - `server.py`: `/api/assets` returns a `JSONResponse`; `/api/state` uses `lib.ffmpeg_exe()`; the folder dialog's PowerShell gives `ShowDialog` a hidden top-most owner form.
  - `fileinfo.py`: the one `NO_WINDOW` constant, imported by `library.py` and `server.py` (review of 0.15.1: the flag was spelled out in four places).
- **Notes:**
  - Where the time went (before): the `python -c "import fastapi, …, pymupdf"` dependency probe took 1.4 s per launch, and a Sight.bat launch ran it twice (once before and once after the re-exec into the venv). Importing `usdz_convert` only to read its version constant pulled in numpy (160 ms). `imageio_ffmpeg.get_ffmpeg_exe()` runs `ffmpeg -version` (160 ms). The launcher polled `/api/health` before the server listened, and on Windows a connect to a closed port takes ~2 s to be refused, so each attempt sat out its 0.4 s timeout. That cost ~0.5 s before the browser was even started.
  - Browser in parallel: Edge from launch to the page's ready ping takes ~330 ms warm (750 ms the first time a profile is created). It now overlaps the ~0.6 s of fastapi/uvicorn imports and library setup instead of following them. Its first request waits in the listen backlog until uvicorn takes the socket. On Windows the window stays off-screen until the page has content anyway. If the start fails, `main()` closes that browser through `close_browser()` so no window is left off-screen, and `launch_lock` keeps the launcher thread from starting one after that. Checked with a `library.db` that cannot be opened: no Edge process is left. (0.15.3 replaced the way `close_browser()` finds the browser.) A tab in the user's default browser (no Edge/Chrome found) still opens only once the server serves.
  - `listen_socket()` sets `SO_REUSEADDR` like `free_port()` and uvicorn's own bind, so the same port is picked as before (localStorage, including the cached theme colour, is per port).
  - `has_deps()` with `find_spec` finds a package without importing it, so a package that is present but broken now fails at the real import with a traceback instead of triggering a reinstall. `importlib.invalidate_caches()` runs first, so the check right after a pip install sees the new packages.
  - Thumbnail versions: every path that writes a thumbnail must call `thumb_version(aid, fresh=True)` (`_make_thumb`, `save_uploaded_thumb`, `psd_composite` do), and every path that deletes or invalidates one must call `_forget_thumb()` (all former `_have_thumb.discard` sites do). A missing file (version 0) is never cached.
  - Folder dialog: a console-less PowerShell started by the background server has no window and no foreground rights, so an ownerless `FolderBrowserDialog` can open behind the browser. Not reproduced, only reasoned. The owner form is a standard WinForms pattern and was checked to construct.
  - Still slow, not changed (numbers from `python -X importtime` and cProfile): importing fastapi + pydantic takes ~400 ms and uvicorn ~290 ms, most of what is left of server start. `build_app` (route and pydantic model setup) takes ~100 ms. Edge's own start takes ~250 ms. The client pulls every asset page back to back (400 per request), which is ~125 requests for a 50k library. `import("three")` + GLTFLoader take ~45 + 60 ms on the first 3D open per session.

## 0.15.1 — 2026-11-10 — Windows: no console windows flash while thumbnails are built
- **What:** Adding video or audio files no longer flashes console windows on Windows. Each ffmpeg run for a video thumbnail, an audio thumbnail or a waveform opened its own console for a moment.
- **Where:** `library.py`: module constant `_NO_WINDOW`, passed as `creationflags` in `_thumb_video` and `_decode_peaks`. `server.py`: the same flag on the PowerShell folder picker in `pick_folder` and on the `cmd /c start` fallback in `open_path`.
- **Notes:**
  - The app runs windowless (`pythonw` / PyInstaller `--windowed`), so Windows gives every console child process a new console window. Any new `subprocess` call that runs a console program (ffmpeg, powershell, cmd) must pass `creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)`. The flag is 0 off Windows. `fileinfo.py` already did this, which is why the info panel never flashed.
  - `CREATE_NO_WINDOW` hides only the console. The folder dialog PowerShell opens still shows.
  - Left alone on purpose: `explorer` (a GUI program, no console) and the user-started `winget install` in `offer_ffmpeg_install` (behind `POST /api/install-ffmpeg`).
