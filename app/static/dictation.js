// Voice dictation for text fields (tier 1 of docs/PLAN-stt.md): the browser's own Web Speech API.
// Free, no key, streaming interim results; Chrome / Edge send audio to Google's service (online),
// Safari recognises on the device / Siri, Firefox has no recogniser (the button explains that).
//
// Self-contained ES module (zero-build). Two layers:
//   createDictation({lang, onInterim, onFinal, onState, onError}) -> {start, stop, abort, state}
//       the provider-neutral facade (providers are registered by name; only "webspeech" exists today).
//   createDictationUI({root, getLang, setLang, toast, floating}) -> {mic, toggle, stop, listening, ...}
//       mic buttons + insertion at the caret (so Ctrl+Z works) + the interim bubble + language popover.
import { hotkey } from "/static/keys.js";

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
  // groq: later, through a backend proxy that holds the key (docs/PLAN-stt.md).
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
`;

export function createDictationUI({ root = document, getLang = () => "", setLang = () => {}, toast = () => {}, floating = "", host = document.body, registerAutoClose = null } = {}){
  if (!document.getElementById("dict-style")){
    const st = document.createElement("style"); st.id = "dict-style"; st.textContent = CSS; document.head.appendChild(st);
  }
  const ac = new AbortController(), sig = { signal: ac.signal }, sigC = { signal: ac.signal, capture: true };
  let dead = false;                // destroy() ran: every document-level handler below is a no-op and removed
  let cur = null;                  // { ta, btn, dict, ended }
  let fl = null, flTa = null;      // the floating mic and the field it is next to
  let bubble = null, pop = null;
  const buttons = new Map();   // button → () => its field
  const langOf = () => getLang() || navigator.language || "en-US";
  const label = () => `Dictation (${langOf()}) — Alt+M. Right-click or long-press: language`;

  function paint(prune){
    for (const [b, get] of buttons){ if (prune && !b.isConnected){ buttons.delete(b); continue; } const mine = !!cur && get() === cur.ta; b.classList.toggle("on", mine); b.classList.toggle("na", !dictationSupported()); b.title = dictationSupported() ? (mine ? "Stop dictation (Esc)" : label()) : "Dictation needs Chrome, Edge or Safari"; b.setAttribute("aria-pressed", mine ? "true" : "false"); }
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
    bubble.textContent = text || `Listening… (${langOf()})`;
    place(bubble, cur.ta, false);
  }
  const hideBubble = () => { if (bubble) bubble.hidden = true; };

  function finish(){
    const c = cur; cur = null;
    if (c){ c.ta.removeEventListener("blur", c.onBlur); c.ta.removeEventListener("keydown", c.onKey, true); }
    hideBubble(); paint();
  }
  function stop(discard){
    const c = cur;
    if (!c) return;
    if (discard){ c.dict.abort(); finish(); } else c.dict.stop();   // stop() lets the last words land, then onState idle
  }
  const messages = {
    "not-allowed": "Microphone is blocked — allow it for this page in the browser's site settings",
    "service-not-allowed": "Microphone is blocked — allow it for this page in the browser's site settings",
    "audio-capture": "No microphone found",
    "network": "Speech service unreachable — Chrome and Edge need an internet connection for dictation",
    "language-not-supported": "This language is not supported for dictation",
    "no-speech": "No speech heard",
  };
  function start(ta, btn){
    if (!dictationSupported()){
      toast("Dictation is not available in this browser — use Chrome, Edge or Safari"); return;
    }
    if (cur) stop(true);
    const c = { ta, btn, ended: false };
    c.dict = createDictation({
      lang: langOf(),
      onInterim: (t) => { if (cur === c && ta.isConnected) showBubble(t); },
      onFinal: (t) => { if (cur === c && ta.isConnected) insertAtCaret(ta, t); },
      onState: (s) => { if (cur !== c) return; if (!ta.isConnected){ stop(true); return; } if (s === "idle") finish(); },
      onError: (code) => { if (cur !== c) return; c.dict.abort(); finish(); toast(messages[code] || `Dictation stopped (${code})`); },
    });
    c.onBlur = () => stop(true);
    // Enter sends / saves the field: the words in flight go nowhere.
    c.onKey = (e) => { if (hotkey(e, "Enter")) stop(true); };
    ta.addEventListener("blur", c.onBlur);
    ta.addEventListener("keydown", c.onKey, true);
    cur = c; paint(); showBubble("");
    c.dict.start();
  }
  function toggle(ta, btn){
    if (!ta) return;
    if (cur && cur.ta === ta){ stop(false); return; }
    if (document.activeElement !== ta) ta.focus({ preventScroll: true });
    start(ta, btn || null);
  }

  // ---- language popover (right-click / long-press on any mic) ----
  function closePop(){ if (pop){ pop.remove(); pop = null; } }
  function openPop(btn){
    closePop();
    pop = document.createElement("div"); pop.className = "dict-pop";
    const now = getLang();
    for (const [code, name] of LANGS){
      const b = document.createElement("button"); b.type = "button"; b.textContent = code ? `${name} · ${code}` : name;
      if (code === now) b.classList.add("sel");
      b.onclick = () => { setLang(code); closePop(); paint(); toast(`Dictation language: ${code || "auto (" + (navigator.language || "en-US") + ")"}`); };
      pop.appendChild(b);
    }
    pop.addEventListener("mousedown", (e) => e.preventDefault());   // keep the field focused (a blur would end an edit)
    host.appendChild(pop);
    registerAutoClose?.(pop, closePop, btn);
    const r = btn.getBoundingClientRect();
    pop.style.left = Math.max(4, Math.min(innerWidth - pop.offsetWidth - 4, r.right - pop.offsetWidth)) + "px";
    pop.style.top = Math.max(4, Math.min(innerHeight - pop.offsetHeight - 4, r.top - pop.offsetHeight - 4 < 4 ? r.bottom + 4 : r.top - pop.offsetHeight - 4)) + "px";
  }
  document.addEventListener("pointerdown", (e) => { if (!dead && pop && !pop.contains(e.target) && !e.target.closest?.(".dict-mic")) closePop(); }, sigC);

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
  }
  function hideFloat(){ if (fl) fl.hidden = true; flTa = null; }
  if (floating){
    root.addEventListener("focusin", (e) => {
      if (dead) return;
      const t = e.target;
      if (!t.matches?.(floating)) return;
      if (!fl){ fl = mic(newMic("fl"), () => flTa); host.appendChild(fl); }
      flTa = t; fl.hidden = false; placeFloat(); paint();
      t.addEventListener("input", placeFloat, sig);
      t.addEventListener("blur", () => { t.removeEventListener("input", placeFloat); if (flTa === t) hideFloat(); }, { once: true, ...sig });
    }, sig);
    addEventListener("resize", placeFloat, sig);
  }

  // Esc ends dictation first (the field's own Esc handling still runs); the shortcut toggles it from inside a field.
  document.addEventListener("keydown", (e) => {
    if (dead) return;
    if (pop && hotkey(e, "Escape")) closePop();
    if (cur && hotkey(e, "Escape")) stop(false);
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
    destroy(){ dead = true; ac.abort(); clearInterval(tick); stop(true); closePop(); fl?.remove(); bubble?.remove(); },
  };
}
