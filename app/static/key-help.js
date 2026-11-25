// The "?" help overlay: a card listing a mode's controls and shortcuts, grouped. One look for every mode —
// the annotator's own list (annotate.js), the lightbox (picture / PSD / video / 3D / sequence), the compare and
// the library browser (index.html). Shown with a full-screen backdrop that keeps the pointer, wheel and touch from
// whatever is underneath; the keyboard is the caller's to route (onKeyHelpKey below for the shared one).
//
//   buildKeyHelp({ title, groups, foot, onClose }) -> element   the overlay (caller appends / removes it)
//   showKeyHelp(opts) / closeKeyHelp() / keyHelpOpen()          the app-wide one, fixed over the whole window
//   onKeyHelpKey(e)                                             its modal key handling (Esc / ? close, the rest is swallowed)
//   keyName("Ctrl+Shift+KeyZ") -> "Ctrl+Shift+Z"                how a combo reads to a person
//
// groups: [{ group: "Title", rows: [[["Key", "Alt key"], "What it does"], …] }] — keys are shown as given.
import { hotkey } from "/static/keys.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const CLOSE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`;

const KEY_NAMES = { BracketLeft: "[", BracketRight: "]", Comma: ",", Period: ".", Slash: "?", Delete: "Del", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓" };
export const keyName = (c) => c.split("+").map((k) => KEY_NAMES[k] || k.replace(/^Key/, "").replace(/^Digit/, "")).join("+").replace("Shift+?", "?");

// "?": the Shift+Slash key, or the "?" character wherever a layout puts it (German Shift+ß, French Shift+,).
export const isHelpKey = (e) => hotkey(e, "Shift+Slash") || hotkey(e, "Shift+?") || hotkey(e, "?");

// The one line a top bar shows instead of a list of shortcuts.
export const HELP_HINT = "Hit ? for detailed controls description and full hotkeys mapping list";

let styled = false;
function ensureStyle(){
  if (styled) return;
  styled = true;
  const st = document.createElement("style");
  st.textContent = `
.kh { position: absolute; inset: 0; z-index: 60; display: grid; place-items: center; padding: 16px; box-sizing: border-box; background: rgb(0 0 0 / .62); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); cursor: default; touch-action: none; }
.kh.kh-fixed { position: fixed; z-index: 10000; }
.kh-card { width: min(640px, 100%); max-height: 100%; display: flex; flex-direction: column; border-radius: 12px; background: var(--surface, #1b1c20); border: 1px solid var(--border-strong, var(--border)); box-shadow: 0 24px 70px rgb(0 0 0 / .6); color: var(--fg); font-size: 12px; overflow: hidden; }
.kh-wide .kh-card { width: min(860px, 100%); }
.kh-hh { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px 8px 16px; border-bottom: 1px solid var(--border); }
.kh-hh b { font-size: 14px; font-weight: 600; }
.kh-x { display: inline-grid; place-items: center; width: 32px; height: 32px; padding: 0; border-radius: 8px; border: 1px solid transparent; background: none; color: var(--muted, var(--fg)); cursor: pointer; }
.kh-x:hover, .kh-x:focus-visible { background: var(--surface-2); border-color: var(--border); color: var(--fg); }
.kh-body { overflow: auto; overscroll-behavior: contain; touch-action: pan-y; padding: 4px 16px 8px; display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); column-gap: 24px; }
.kh-body h4 { margin: 12px 0 4px; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--subtle); }
.kh-row { display: flex; gap: 10px; align-items: baseline; padding: 3px 0; line-height: 1.4; }
.kh-k { flex: 0 0 auto; min-width: 84px; max-width: 45%; display: inline-flex; flex-wrap: wrap; gap: 3px; }
.kh-k kbd { font: 11px/1 ui-monospace, Consolas, monospace; padding: 3px 6px; border-radius: 5px; background: var(--surface-2); border: 1px solid var(--border); color: var(--fg); }
.kh-foot { margin: 0; padding: 8px 16px 12px; color: var(--subtle); border-top: 1px solid var(--border); }
`;
  document.head.appendChild(st);
}

export function buildKeyHelp({ title, groups, foot, onClose, wide }){
  ensureStyle();
  const el = document.createElement("div");
  el.className = "kh" + (wide ? " kh-wide" : "");
  el.innerHTML = `<div class="kh-card" role="dialog" aria-label="${esc(title)}">
    <div class="kh-hh"><b>${esc(title)}</b><button type="button" class="kh-x" data-act="hclose" title="Close (Esc)" aria-label="Close">${CLOSE_ICON}</button></div>
    <div class="kh-body">${groups.filter((g) => g.rows.length).map((g) => `<section><h4>${esc(g.group)}</h4>${g.rows.map(([keys, label]) => `<div class="kh-row"><span class="kh-k">${keys.map((k) => `<kbd>${esc(k)}</kbd>`).join("")}</span><span>${esc(label)}</span></div>`).join("")}</section>`).join("")}</div>
    ${foot ? `<p class="kh-foot">${esc(foot)}</p>` : ""}</div>`;
  // A full-screen backdrop: nothing underneath sees the pointer, wheel or touch while this is open.
  for (const t of ["pointerdown", "pointerup", "pointermove", "mousedown", "mouseup", "dblclick", "contextmenu", "touchstart", "touchend", "wheel", "touchmove"]){
    el.addEventListener(t, (ev) => {
      ev.stopPropagation();
      const inBody = !!ev.target.closest?.(".kh-body");
      if (ev.cancelable && (t === "contextmenu" || ((t === "wheel" || t === "touchmove") && !inBody))) ev.preventDefault();
    }, { passive: false });
  }
  el.addEventListener("click", (ev) => { ev.stopPropagation(); if (ev.target === el || ev.target.closest("[data-act=hclose]")) onClose?.(); });
  return el;
}

// The modal key rule shared by every help overlay: Esc / ? close it, Enter / Space press its focused close button,
// everything else is swallowed so nothing behind it acts. Browser shortcuts (Ctrl / Alt, F-keys) are left alone.
// Returns true when the key closed it.
export function helpKey(e, close){
  if (hotkey(e, "Escape") || isHelpKey(e)){ e.preventDefault(); if (!e.repeat) close(); return true; } // (a held ? does not flicker)
  if (e.target?.closest?.("[data-act=hclose]") && (hotkey(e, "Enter") || hotkey(e, "Space"))) return false; // default: click
  if (!e.ctrlKey && !e.metaKey && !e.altKey && !/^F\d+$/.test(e.code)) e.preventDefault();
  return false;
}

let shared = null;
export function keyHelpOpen(){ return !!shared; }
export function closeKeyHelp(){
  if (!shared) return;
  shared.remove(); shared = null;
}
export function showKeyHelp(opts){
  closeKeyHelp();
  document.activeElement?.blur?.();
  shared = buildKeyHelp({ ...opts, onClose: closeKeyHelp });
  shared.classList.add("kh-fixed");
  document.body.appendChild(shared);
  shared.querySelector("[data-act=hclose]").focus({ preventScroll: true });
}
export function onKeyHelpKey(e){ if (shared) helpKey(e, closeKeyHelp); }
