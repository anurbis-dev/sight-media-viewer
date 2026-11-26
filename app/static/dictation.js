// Voice dictation for text fields (tier 1 of docs/PLAN-stt.md): the browser's own Web Speech API.
// Free, no key, streaming interim results; Chrome / Edge send audio to Google's service (online),
// Safari recognises on the device / Siri, Firefox has no recogniser (the button explains that).
//
// Self-contained ES module (zero-build). Two layers:
//   createDictation({lang, onInterim, onFinal, onState, onError}) -> {start, stop, abort, state}
//       the provider-neutral facade (providers are registered by name; only "webspeech" exists today).
//   createDictationUI({root, getLang, setLang, toast, floating}) -> {mic, toggle, stop, listening, ...}
//       mic buttons + insertion at the caret (so Ctrl+Z works) + the interim bubble + language popover.
import { hotkey } from "./keys.js";

// ---- provider facade ------------------------------------------------------------------------
const Rec = () => globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
export const dictationSupported = () => !!Rec();

const PROVIDERS = {
  webspeech: {
    available: () => !!Rec(),
    create(o){
      const rec = new (Rec())();
      rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
      rec.lang = o.lang || navigator.language || "en-US";
      let want = false, errored = false, startedAt = 0, quick = 0, silent = 0;
      rec.onstart = () => o.onState("listening");
      rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++){
          const r = e.results[i], t = r[0]?.transcript || "";
          if (r.isFinal){ if (t.trim()) o.onFinal(t); } else interim += t;
        }
        silent = 0; o.onInterim(interim);
      };
      rec.onerror = (e) => { if (e.error === "aborted") return; if (e.error === "no-speech"){ silent++; return; }   // silence at the start: onend restarts (bounded)
        errored = true; o.onError(e.error); };
      rec.onend = () => {
        // Chrome ends a continuous session on silence / after about a minute: keep going while wanted.
        if (want && silent >= 3){ want = false; o.onError("no-speech"); return; }   // ~25 s of silence: close the mic
        if (want && !errored){
          quick = Date.now() - startedAt < 1000 ? quick + 1 : 0;
          if (quick < 3){ try { startedAt = Date.now(); rec.start(); return; } catch {} }
        }
        want = false; o.onInterim(""); o.onState("idle");
      };
      return {
        start(){ want = true; errored = false; silent = 0; startedAt = Date.now(); quick = 0; o.onState("starting"); try { rec.start(); } catch { o.onError("start-failed"); } },
        stop(){ want = false; try { rec.stop(); } catch {} },   // delivers what is pending, then onend
        abort(){ want = false; try { rec.abort(); } catch {} }, // drops it
      };
    },
  },
  // The user's own speech-to-text service (Settings → Dictation; any OpenAI-compatible /audio/transcriptions):
  // Whisper-type services find the language themselves. The server holds the URL and key (/api/stt/*);
  // the page records one phrase at a time — a pause in the speech (or 20 s) closes it — and posts
  // it. No live words: the bubble says "Transcribing…" while a phrase is out. Each phrase is its own recording
  // (a MediaRecorder restarted per phrase), so every upload is a complete file.
  service: {
    available: () => !!(navigator.mediaDevices?.getUserMedia && globalThis.MediaRecorder && (globalThis.AudioContext || globalThis.webkitAudioContext)),
    create(o){
      const SILENCE_MS = 700, MAX_MS = 20000, MIN_SPEECH_MS = 250, LEVEL = 0.018;
      const mime = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported?.(m)) || "";
      const lang = (o.lang || "").split("-")[0];   // "" = let the service detect it
      let want = false, ended = true, dropped = false, stream = null, actx = null, raf = 0, lastT = 0, heard = false;
      let ph = null;              // the phrase being recorded: { rec, chunks, at, voiceMs, quietSince, seq }
      let open = 0;               // recorders not yet stopped + uploads not yet answered: the session ends at 0
      let seqNext = 0, seqOut = 0; const done = new Map();   // answers go into the field in phrase order
      const finishIfIdle = () => { if (!want && open === 0) end(); };
      const deliver = () => {
        while (done.has(seqOut)){ const t = done.get(seqOut); done.delete(seqOut); seqOut++; if (t && !dropped) o.onFinal(t); }
      };
      const send = async (blob, seq) => {
        open++; o.onInterim("Transcribing…");
        let text = "";
        try {
          const r = await fetch(`/api/stt/transcribe${lang ? "?lang=" + encodeURIComponent(lang) : ""}`, { method: "POST", headers: { "content-type": blob.type || "audio/webm" }, body: blob });
          const j = await r.json().catch(() => ({}));
          if (!dropped){
            if (r.ok) text = j.text || "";
            else { want = false; o.onError("stt-" + (j.error || "failed")); }
          }
        } catch { if (!dropped){ want = false; o.onError("stt-server"); } }
        finally {
          done.set(seq, text); deliver();
          open--;
          if (!dropped && open === (ph ? 1 : 0)) o.onInterim("");
          finishIfIdle();
        }
      };
      // A new recorder starts before the old one stops (a cut at 20 s falls mid-speech: no word lost in between).
      const newPhrase = () => {
        const p = { chunks: [], at: performance.now(), voiceMs: 0, quietSince: 0, seq: seqNext++ };
        p.rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        p.rec.ondataavailable = (e) => { if (e.data?.size) p.chunks.push(e.data); };
        p.rec.onstop = () => {
          open--;
          // Speech heard (or the level meter never worked — a suspended AudioContext reads zeros: send it anyway).
          const blob = new Blob(p.chunks, { type: p.rec.mimeType || mime || "audio/webm" });
          if (!dropped && (p.voiceMs >= MIN_SPEECH_MS || !heard) && blob.size >= 1200) send(blob, p.seq);
          else { done.set(p.seq, ""); deliver(); }
          finishIfIdle();
        };
        open++;
        p.rec.start();
        ph = p;
      };
      const cut = () => {
        const old = ph;
        if (!old || old.rec.state !== "recording") return;
        if (want) newPhrase(); else ph = null;
        old.rec.stop();
      };
      const end = () => {
        if (ended) return;
        ended = true; want = false; ph = null;
        cancelAnimationFrame(raf);
        try { stream?.getTracks().forEach((t) => t.stop()); } catch {}
        try { actx?.close(); } catch {}
        stream = actx = null;
        o.onInterim(""); o.onState("idle");
      };
      const watch = (an) => {
        const buf = new Float32Array(an.fftSize);
        const loop = (t) => {
          if (ended) return;
          if (an.getFloatTimeDomainData) an.getFloatTimeDomainData(buf); else buf.fill(0);
          let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          const rms = Math.sqrt(sum / buf.length), dt = lastT ? t - lastT : 0; lastT = t;
          if (rms > 0) heard = true;
          const p = ph;
          if (p){
            if (rms > LEVEL){ p.voiceMs += dt; p.quietSince = 0; } else if (!p.quietSince) p.quietSince = t;
            if (want && ((p.voiceMs >= MIN_SPEECH_MS && p.quietSince && t - p.quietSince > SILENCE_MS) || t - p.at > MAX_MS)) cut();
          }
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      };
      return {
        async start(){
          want = true; ended = false; dropped = false; heard = false; open = 0; seqNext = seqOut = 0; done.clear();
          o.onState("starting");
          try {
            // Not set up: say so before anything is recorded (the first phrase would be lost otherwise).
            const st = await fetch("/api/stt/status").then((r) => r.json()).catch(() => null);
            if (!want){ end(); return; }
            if (!st){ o.onError("stt-server"); end(); return; }
            if (!st.configured){ o.onError("stt-not-set"); end(); return; }
            let s;
            try { s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
            catch (e){ o.onError(e?.name === "NotAllowedError" ? "not-allowed" : "audio-capture"); end(); return; }
            // Stopped while the permission prompt was open: release this stream right away (the mic light goes off).
            if (!want || ended){ s.getTracks().forEach((t) => t.stop()); end(); return; }
            stream = s;
            const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
            actx = new AC();
            await actx.resume?.().catch(() => {});   // created after an await: it may start suspended (Safari)
            const an = actx.createAnalyser(); an.fftSize = 2048;
            actx.createMediaStreamSource(stream).connect(an);
            if (!want || ended){ end(); return; }
            watch(an);
            newPhrase();
            o.onState("listening");
          } catch { o.onError("audio-capture"); end(); }
        },
        // The phrase being recorded and those in flight still land, in order; then the session ends.
        stop(){ want = false; if (ph?.rec.state === "recording") cut(); else finishIfIdle(); if (ended === false && open === 0) end(); },
        abort(){ want = false; dropped = true; const p = ph; ph = null; try { if (p?.rec.state === "recording") p.rec.stop(); } catch {} end(); },
      };
    },
  },
};

export function createDictation({ lang, provider = "webspeech", onInterim = () => {}, onFinal = () => {}, onState = () => {}, onError = () => {} } = {}){
  const P = PROVIDERS[provider];
  if (!P?.available()) return null;
  let state = "idle";
  const impl = P.create({ lang, onInterim, onFinal, onError,
    onState: (s) => { state = s; onState(s); } });
  return { ...impl, get state(){ return state; } };
}

// ---- text insertion -------------------------------------------------------------------------
// At the caret / over the selection, a space joined sensibly. execCommand keeps the field's undo stack
// (Ctrl+Z removes the phrase); setRangeText is the fallback where it is refused.
export function insertAtCaret(ta, text){
  let t = String(text).trim();
  if (!t) return;
  // The field has lost the focus meanwhile (the service's last phrase lands after a blur): append, keep the focus where it is.
  if (document.activeElement !== ta && ta.dataset.dictLate != null){
    const v0 = ta.value;
    if (v0 && !/\s$/.test(v0)) t = " " + t;
    ta.setRangeText(t, v0.length, v0.length, "end");
    ta.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: t }));
    return;
  }
  const v = ta.value, s = ta.selectionStart ?? v.length, e = ta.selectionEnd ?? s;
  const before = v.slice(0, s), after = v.slice(e);
  if (before && !/\s$/.test(before) && !/^[,.;:!?)\]»”…]/.test(t)) t = " " + t;
  if (after && !/^[\s,.;:!?)\]»”…]/.test(after)) t += " ";
  if (document.activeElement !== ta) ta.focus({ preventScroll: true });
  ta.setSelectionRange(s, e);
  let ok = false;
  try { ok = document.execCommand("insertText", false, t); } catch {}
  if (!ok || ta.value === v){
    ta.setRangeText(t, s, e, "end");
    ta.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: t }));
  }
}

// ---- UI -------------------------------------------------------------------------------------
export const SHORTCUT = "Alt+KeyM";
export const SWITCH = "Alt+Shift+KeyM";   // next language of the recent pair
const RECENT_KEY = "sight.dictation.recent";
export const LANGS = [["", "Auto (browser language)"], ["en-US", "English (US)"], ["en-GB", "English (UK)"], ["ru-RU", "Русский"], ["uk-UA", "Українська"],
  ["de-DE", "Deutsch"], ["fr-FR", "Français"], ["es-ES", "Español"], ["it-IT", "Italiano"], ["pt-BR", "Português (BR)"], ["pl-PL", "Polski"], ["tr-TR", "Türkçe"],
  ["ja-JP", "日本語"], ["ko-KR", "한국어"], ["zh-CN", "中文"]];
const MIC = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`;
const CSS = `
.dict-mic { width: 26px; height: 26px; padding: 0; border: 0; border-radius: 13px; display: inline-grid; place-items: center; background: transparent; color: var(--muted, #999); cursor: pointer; flex: none; }
.dict-mic:hover { background: var(--surface-2, rgb(127 127 127 / .2)); color: var(--fg, #eee); }
.dict-mic.on { color: #fff; background: #d64545; animation: dict-pulse 1.3s ease-out infinite; }
.dict-mic.na { opacity: .45; }
.dict-mic.fl { position: fixed; z-index: 60; background: var(--surface-3, #2a2b31); box-shadow: 0 1px 4px rgb(0 0 0 / .4); width: 28px; height: 28px; }
.dict-mic[hidden], .dict-pv[hidden], .dict-pop[hidden] { display: none; }
@keyframes dict-pulse { 0% { box-shadow: 0 0 0 0 rgb(214 69 69 / .6); } 100% { box-shadow: 0 0 0 9px rgb(214 69 69 / 0); } }
@media (prefers-reduced-motion: reduce) { .dict-mic.on { animation: none; } }
.dict-pv { position: fixed; z-index: 61; max-width: 320px; padding: 4px 9px; border-radius: 8px; font: italic 12px/1.4 var(--font, system-ui); color: var(--muted, #aaa); background: rgb(10 10 11 / .86); border: 1px solid var(--border, #444); pointer-events: none; white-space: pre-wrap; word-break: break-word; }
.dict-pop { position: fixed; z-index: 62; display: flex; flex-direction: column; max-height: 60vh; overflow: auto; padding: 4px; border-radius: 10px; background: var(--surface-3, #25262b); border: 1px solid var(--border-strong, #555); box-shadow: 0 6px 20px rgb(0 0 0 / .5); }
.dict-pop button { text-align: left; padding: 7px 12px; border-radius: 6px; font-size: 12px; color: var(--fg, #eee); min-height: 30px; }
.dict-pop button:hover { background: var(--surface-2, rgb(127 127 127 / .2)); }
.dict-pop button.sel { color: var(--accent, #4c9aff); }
.dict-lang { height: 22px; min-width: 26px; padding: 0 5px; border: 1px solid var(--border, #444); border-radius: 11px; background: transparent; color: var(--muted, #999); font: 600 10px/20px var(--font, system-ui); letter-spacing: .03em; cursor: pointer; flex: none; }
.dict-lang:hover { color: var(--fg, #eee); background: var(--surface-2, rgb(127 127 127 / .2)); }
.dict-lang.fl { position: fixed; z-index: 60; background: var(--surface-3, #2a2b31); box-shadow: 0 1px 4px rgb(0 0 0 / .4); }
.dict-lang[hidden] { display: none; }
@media (pointer: coarse) { .dict-lang { height: 28px; min-width: 34px; border-radius: 14px; font-size: 11px; } }
`;

// getEngine(): "webspeech" (the browser) or "service" (the user's speech-to-text service, set up in Settings).
export function createDictationUI({ root = document, getLang = () => "", setLang = () => {}, getEngine = () => "webspeech", toast = () => {}, floating = "", host = document.body, registerAutoClose = null } = {}){
  if (!document.getElementById("dict-style")){
    const st = document.createElement("style"); st.id = "dict-style"; st.textContent = CSS; document.head.appendChild(st);
  }
  const ac = new AbortController(), sig = { signal: ac.signal }, sigC = { signal: ac.signal, capture: true };
  let dead = false;                // destroy() ran: every document-level handler below is a no-op and removed
  let cur = null;                  // { ta, btn, dict, ended }
  let fl = null, flTa = null;      // the floating mic and the field it is next to
  let bubble = null, pop = null;
  const buttons = new Map();   // button → () => its field
  const engine = () => (getEngine() === "service" && PROVIDERS.service.available() ? "service" : "webspeech");
  const supported = () => PROVIDERS[engine()].available();
  // The service with no language picked detects it; the browser's recogniser needs one (its "auto" = the browser's).
  const langOf = () => getLang() || (engine() === "service" ? "" : navigator.language || "en-US");
  const langName = () => langOf() || "auto-detect";
  const label = () => `Dictation (${engine() === "service" ? "service, " : ""}${langName()}) — Alt+M. Right-click or long-press: language`;
  // The two languages used last: the chip next to each mic flips between them in one tap (Alt+Shift+M).
  const fullCode = (c) => LANGS.find(([k]) => k && k.toLowerCase() === (c || "").toLowerCase())?.[0]
    || LANGS.find(([k]) => k && k.split("-")[0] === (c || "").split("-")[0])?.[0] || c;
  function recent(){
    let r = null;
    try { r = JSON.parse(localStorage.getItem(RECENT_KEY)); } catch {}
    r = Array.isArray(r) ? r.filter((x) => typeof x === "string" && x) : [];
    const nav = fullCode(navigator.language || "en-US");
    for (const d of [nav, nav.startsWith("en") ? "ru-RU" : "en-US"]) if (r.length < 2 && !r.includes(d)) r.push(d);
    return r.slice(0, 2);
  }
  function remember(code){
    if (!code) return;
    const r = [code, ...recent().filter((x) => x !== code)].slice(0, 2);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(r)); } catch {}
  }
  const shortName = () => (langOf() ? langOf().split("-")[0].toUpperCase() : "AUTO");
  function pickLang(code, quiet){
    setLang(code); remember(code); paint();
    if (!quiet) toast(`Dictation language: ${code || (engine() === "service" ? "auto-detect" : "auto (" + (navigator.language || "en-US") + ")")}`);
    // Mid-dictation: let the words already heard land, then listen again in the new language.
    // (Not when the user is already stopping it: the new language is then only for next time.)
    if (cur && !cur.stopping){ cur.restart = true; stop(false); }
  }
  function cycle(){
    const now = fullCode(langOf()), r = recent();   // "ru" (a bare browser code) = "ru-RU" of the pair
    const next = r.find((x) => x !== now) || r[0];
    pickLang(next);
  }
  const chips = new Map();   // mic button → its language chip

  function paint(prune){
    for (const [b, chip] of chips){
      if (prune && !b.isConnected){ chips.delete(b); chip.remove(); continue; }
      if (!b.classList.contains("fl") && b.isConnected && chip.previousElementSibling !== b) b.after(chip);
      chip.hidden = b.hidden || !supported(); chip.textContent = shortName();
      chip.title = `Dictation language: ${langName()} — click: switch to the other recent one (Alt+Shift+M). Right-click or long-press: all languages`;
    }
    for (const [b, get] of buttons){ if (prune && !b.isConnected){ buttons.delete(b); continue; } const mine = !!cur && get() === cur.ta; b.classList.toggle("on", mine); b.classList.toggle("na", !supported()); b.title = supported() ? (mine ? "Stop dictation (Esc)" : label()) : "Dictation needs Chrome, Edge or Safari"; b.setAttribute("aria-pressed", mine ? "true" : "false"); }
    if (fl && flTa && !fl.hidden) placeFloat();   // the floating chip's width follows its text
  }
  function place(el, ta, below){
    const r = ta.getBoundingClientRect();
    el.style.left = Math.max(4, Math.min(innerWidth - el.offsetWidth - 4, r.left)) + "px";
    const y = below ? r.bottom + 4 : r.top - el.offsetHeight - 4;
    el.style.top = Math.max(4, Math.min(innerHeight - el.offsetHeight - 4, y < 4 ? r.bottom + 4 : y)) + "px";
  }
  function showBubble(text){
    if (!cur) return;
    if (!bubble){ bubble = document.createElement("div"); bubble.className = "dict-pv"; host.appendChild(bubble); }
    bubble.hidden = false;
    bubble.textContent = text || `Listening… (${langName()})`;
    place(bubble, cur.ta, false);
  }
  const hideBubble = () => { if (bubble) bubble.hidden = true; };

  function finish(){
    const c = cur; cur = null;
    if (c){ c.ta.removeEventListener("blur", c.onBlur); c.ta.removeEventListener("keydown", c.onKey, true); delete c.ta.dataset.dictLate; }
    hideBubble(); paint();
    if (c?.restart && !dead && c.ta.isConnected && document.activeElement === c.ta) start(c.ta, c.btn);
  }
  function stop(discard){
    const c = cur;
    if (!c) return;
    if (discard){ c.dict.abort(); finish(); } else { c.stopping = true; c.dict.stop(); }   // stop() lets the last words land, then onState idle
  }
  const messages = {
    "not-allowed": "Microphone is blocked — allow it for this page in the browser's site settings",
    "service-not-allowed": "Microphone is blocked — allow it for this page in the browser's site settings",
    "audio-capture": "No microphone found",
    "network": "Speech service unreachable — Chrome and Edge need an internet connection for dictation",
    "language-not-supported": "This language is not supported for dictation",
    "no-speech": "No speech heard",
    "stt-not-set": "No speech-to-text service set up — Settings → Dictation",
    "stt-bad-key": "The speech-to-text service did not accept the key — Settings → Dictation",
    "stt-rate": "The speech-to-text service's limit is reached — try again in a minute",
    "stt-offline": "The speech-to-text service is unreachable — check its address and the connection",
    "stt-server": "The Sight server did not answer",
    "stt-failed": "The speech-to-text service could not transcribe that phrase",
  };
  function start(ta, btn){
    if (!supported()){
      toast("Dictation is not available in this browser — use Chrome, Edge or Safari"); return;
    }
    if (cur) stop(true);
    const c = { ta, btn, ended: false };
    c.dict = createDictation({
      provider: engine(),
      lang: langOf(),
      onInterim: (t) => { if (cur === c && ta.isConnected) showBubble(t); },
      onFinal: (t) => { if (cur === c && ta.isConnected) insertAtCaret(ta, t); },
      onState: (s) => { if (cur !== c) return; if (!ta.isConnected){ stop(true); return; } if (s === "idle") finish(); },
      onError: (code) => { if (cur !== c) return; c.restart = false; c.dict.abort(); finish(); toast(messages[code] || `Dictation stopped (${code})`); },
    });
    // Leaving the field: the browser's words are already in; the service's phrases still out are appended to the note
    // composer when they land (the focus stays where it went; a field that left the page gets nothing).
    // (Not the editors that save on blur — the floating ones: a phrase landing after their save would be lost.)
    c.onBlur = () => { c.restart = false; if (engine() === "service" && !(floating && ta.matches(floating))){ ta.dataset.dictLate = ""; stop(false); } else stop(true); };
    // Enter sends / saves the field: the words in flight go nowhere.
    c.onKey = (e) => { if (hotkey(e, "Enter")){ c.restart = false; stop(true); } };
    ta.addEventListener("blur", c.onBlur);
    ta.addEventListener("keydown", c.onKey, true);
    cur = c; paint(); showBubble("");
    Promise.resolve(c.dict.start()).catch(() => {});
  }
  function toggle(ta, btn){
    if (!ta) return;
    if (cur && cur.ta === ta){ cur.restart = false; stop(false); return; }
    if (document.activeElement !== ta) ta.focus({ preventScroll: true });
    start(ta, btn || null);
  }

  // ---- language popover (right-click / long-press on any mic) ----
  function closePop(){ if (pop){ pop.remove(); pop = null; } }
  function openPop(btn){
    closePop();
    pop = document.createElement("div"); pop.className = "dict-pop";
    const now = getLang();
    const g = engine() === "service";
    for (const [code, name] of LANGS){
      const b = document.createElement("button"); b.type = "button"; b.textContent = code ? `${name} · ${code}` : g ? "Auto (detect the language)" : name;
      if (code === now) b.classList.add("sel");
      b.onclick = () => { closePop(); pickLang(code); };
      pop.appendChild(b);
    }
    pop.addEventListener("mousedown", (e) => e.preventDefault());   // keep the field focused (a blur would end an edit)
    host.appendChild(pop);
    registerAutoClose?.(pop, closePop, btn);
    const r = btn.getBoundingClientRect();
    pop.style.left = Math.max(4, Math.min(innerWidth - pop.offsetWidth - 4, r.right - pop.offsetWidth)) + "px";
    pop.style.top = Math.max(4, Math.min(innerHeight - pop.offsetHeight - 4, r.top - pop.offsetHeight - 4 < 4 ? r.bottom + 4 : r.top - pop.offsetHeight - 4)) + "px";
  }
  document.addEventListener("pointerdown", (e) => { if (!dead && pop && !pop.contains(e.target) && !e.target.closest?.(".dict-mic, .dict-lang")) closePop(); }, sigC);

  // A mic button for a field: getTa() returns the field it dictates into (null → nothing happens).
  function mic(btn, getTa){
    btn.classList.add("dict-mic"); btn.type = "button"; btn.innerHTML = MIC; btn.setAttribute("aria-label", "Dictate");
    buttons.set(btn, () => { try { return getTa(); } catch { return null; } }); paint();
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", (e) => { e.stopPropagation(); if (pop) closePop(); toggle(getTa(), btn); });
    btn.addEventListener("contextmenu", (e) => { e.preventDefault(); openPop(btn); });
    let lp = 0, longed = false;
    btn.addEventListener("pointerdown", (e) => { longed = false; if (e.pointerType === "mouse") return; lp = setTimeout(() => { longed = true; openPop(btn); }, 550); });
    const cancel = () => clearTimeout(lp);
    btn.addEventListener("pointerup", cancel); btn.addEventListener("pointercancel", cancel); btn.addEventListener("pointerleave", cancel);
    btn.addEventListener("click", (e) => { if (longed){ e.stopImmediatePropagation(); longed = false; } }, true);
    // The language chip: tap flips between the two recent languages, right-click / long-press lists them all.
    const chip = document.createElement("button"); chip.type = "button"; chip.className = "dict-lang";
    if (btn.classList.contains("fl")){ chip.classList.add("fl"); host.appendChild(chip); }
    chips.set(btn, chip);
    chip.addEventListener("mousedown", (e) => e.preventDefault());
    chip.addEventListener("contextmenu", (e) => { e.preventDefault(); openPop(chip); });
    let clp = 0, clonged = false;
    chip.addEventListener("pointerdown", (e) => { clonged = false; if (e.pointerType === "mouse") return; clp = setTimeout(() => { clonged = true; openPop(chip); }, 550); });
    const ccancel = () => clearTimeout(clp);
    chip.addEventListener("pointerup", ccancel); chip.addEventListener("pointercancel", ccancel); chip.addEventListener("pointerleave", ccancel);
    chip.addEventListener("click", (e) => { e.stopPropagation(); if (clonged){ clonged = false; return; } if (pop) closePop(); cycle(); });
    paint();
    return btn;
  }
  function newMic(cls){ const b = document.createElement("button"); if (cls) b.classList.add(cls); return b; }

  // ---- floating mic: appears next to fields matching `floating` while they have the focus ----
  function placeFloat(){
    if (!fl || !flTa) return;
    if (!flTa.isConnected){ hideFloat(); return; }
    const r = flTa.getBoundingClientRect();
    fl.style.left = Math.max(2, Math.min(innerWidth - 30, r.right - 32)) + "px";
    fl.style.top = Math.max(2, Math.min(innerHeight - 30, r.bottom - 32)) + "px";
    const chip = chips.get(fl);
    if (chip){ chip.style.left = (parseFloat(fl.style.left) - chip.offsetWidth - 4) + "px"; chip.style.top = (parseFloat(fl.style.top) + (28 - chip.offsetHeight) / 2) + "px"; }
  }
  function hideFloat(){ if (fl){ fl.hidden = true; const c = chips.get(fl); if (c) c.hidden = true; } flTa = null; }
  if (floating){
    root.addEventListener("focusin", (e) => {
      if (dead) return;
      const t = e.target;
      if (!t.matches?.(floating)) return;
      if (!fl){ fl = mic(newMic("fl"), () => flTa); host.appendChild(fl); }
      flTa = t; fl.hidden = false; paint(); placeFloat();
      t.addEventListener("input", placeFloat, sig);
      t.addEventListener("blur", () => { t.removeEventListener("input", placeFloat); if (flTa === t) hideFloat(); }, { once: true, ...sig });
    }, sig);
    addEventListener("resize", placeFloat, sig);
  }

  // Esc ends dictation first (the field's own Esc handling still runs); the shortcut toggles it from inside a field.
  document.addEventListener("keydown", (e) => {
    if (dead) return;
    if (pop && hotkey(e, "Escape")) closePop();
    if (cur && hotkey(e, "Escape")){ cur.restart = false; stop(false); }
    else if (hotkey(e, SWITCH)){
      const a = document.activeElement;
      if (a && a.tagName === "TEXTAREA" && (cur?.ta === a || a.matches(floating || ".dict-ok") || a.dataset.dict != null)){ e.preventDefault(); e.stopPropagation(); cycle(); }
    }
    else if (hotkey(e, SHORTCUT)){
      const a = document.activeElement;
      if (a && a.tagName === "TEXTAREA" && (cur?.ta === a || a.matches(floating || ".dict-ok") || a.dataset.dict != null)){ e.preventDefault(); e.stopPropagation(); toggle(a, cur?.btn || null); }
    }
  }, sigC);

  // A field that left the page (note saved, panel re-rendered) may never fire blur: stop listening, hide the mic.
  const tick = setInterval(() => {
    if (cur && !cur.ta.isConnected) stop(true);
    if (flTa && !flTa.isConnected){ hideFloat(); paint(); }
    paint(true);
  }, 300);

  return {
    mic, toggle, stop: (discard) => stop(!!discard), listening: () => cur?.ta || null, closePop, paint,
    destroy(){ dead = true; ac.abort(); clearInterval(tick); stop(true); closePop(); fl?.remove(); bubble?.remove(); for (const c of chips.values()) c.remove(); },
  };
}
