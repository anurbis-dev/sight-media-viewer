// The text plate over a full-screen picture: a note's text (the topic) and the text of the picture
// shown (FORMAT.md `captions`), on a half-transparent plate. Shared by Sight's lightbox
// (annotate.js) and the phone app's viewer (mobile/js/app.js, published as core/caption-plate.js).
//
//   - Bottom centre, 80 % of the width; more than five lines scroll inside it. A host may move it:
//     --scp-bx / --scp-bw (left edge / width at the foot; the phone puts it at the left edge and
//     narrows it on small screens, clear of its pencil), --scp-lt (top of the plate on the left
//     side; the phone keeps it below its Back button),
//     --scp-rb (bottom of the plate on the right side; the phone lifts it over the pencil), and
//     --scp-b / --scp-t / --scp-l / --scp-r (distance from each side).
//   - A tap on the plate folds it into a round icon at the same side; a tap on the icon opens it.
//   - Dragging the plate or the icon sticks it to the nearest of the four sides when let go. On the
//     left / right side the plate is 80 % high and 25 % wide.
//   - Side and folded state are a per-device convenience (localStorage, `storeKey`).
//
// createPlate(parent, {storeKey}) → {el, set(c), destroy(), editing()}. `parent` must be positioned;
// the plate fills it (pointer-transparent except the plate / icon). c = null hides it, else
// {key, num, cls, label, theme, text, placeholder, onEdit() | onSave(text)}: num / cls — the note's
// number and state class (open / progress / done), label — which picture ("0:01.05", "View 2"),
// theme — the note's text, text — the picture's own text; onEdit: the host edits the text itself
// (the phone's sheet); onSave: the plate edits it in place (Enter saves, Shift+Enter new line, Esc
// cancels). `key` names the picture: a set() with the same content does nothing.

import { hotkey } from "./keys.js";

const SIDES = ["b", "t", "l", "r"];
const ICON_TEXT = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 11h16M4 16h10"/></svg>`;
const ICON_EDIT = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;

let styled = false;
function injectStyles(){
  if (styled) return;
  styled = true;
  const st = document.createElement("style");
  st.textContent = `
.scp { position: absolute; inset: 0; pointer-events: none; z-index: 6; --scp-a: .62; }
.scp[hidden] { display: none; }
.scp-plate, .scp-icon { position: absolute; pointer-events: auto; touch-action: none; user-select: none; -webkit-user-select: none; box-sizing: border-box; color: #fff; background: rgb(16 16 18 / var(--scp-a)); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); box-shadow: 0 4px 18px rgb(0 0 0 / .25); cursor: grab; }
.scp-drag { cursor: grabbing; transition: none !important; }
.scp-plate { display: flex; flex-direction: column; gap: 3px; padding: 7px 12px 9px; border-radius: 12px; font: 13.5px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; }
.scp.b .scp-plate, .scp.t .scp-plate { left: 10%; width: 80%; }
.scp.b .scp-plate { left: var(--scp-bx, 10%); width: var(--scp-bw, 80%); }
.scp.b .scp-plate { bottom: var(--scp-b, 12px); }
.scp.t .scp-plate { top: var(--scp-t, 12px); }
.scp.l .scp-plate, .scp.r .scp-plate { top: 10%; height: 80%; width: 25%; min-width: 96px; }
.scp.l .scp-plate { left: var(--scp-l, 12px); top: var(--scp-lt, 10%); height: min(80%, calc(100% - var(--scp-lt, 10%) - 12px)); }
.scp.r .scp-plate { right: var(--scp-r, 12px); top: auto; bottom: var(--scp-rb, 10%); height: min(80%, calc(100% - var(--scp-rb, 10%) - 12px)); }
.scp-head { display: flex; align-items: center; gap: 8px; min-height: 22px; font-size: 12px; opacity: .9; }
.scp-num { flex: none; min-width: 20px; height: 20px; padding: 0 5px; box-sizing: border-box; border-radius: 10px; display: grid; place-items: center; font-weight: 700; font-size: 11.5px; background: #ff453a; color: #fff; }
.scp-num.progress { background: #ff9f0a; color: #000; }
.scp-num.done { background: #30d158; color: #000; }
.scp-lab { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
.scp-edit { flex: none; width: 26px; height: 26px; margin: -3px -6px -3px 0; border: 0; border-radius: 13px; padding: 0; display: grid; place-items: center; background: transparent; color: inherit; cursor: pointer; }
.scp-edit:hover { background: rgb(255 255 255 / .16); }
.scp-body { overflow-y: auto; overscroll-behavior: contain; white-space: pre-wrap; overflow-wrap: anywhere; -webkit-overflow-scrolling: touch; }
.scp.b .scp-body, .scp.t .scp-body { max-height: calc(1.35em * 5); }
.scp.l .scp-body, .scp.r .scp-body { flex: 1 1 auto; min-height: 0; }
.scp-body.scroll { touch-action: pan-y; }
.scp-theme { opacity: .78; }
.scp-theme.solo { opacity: 1; }
.scp-text { font-weight: 600; }
.scp-theme + .scp-text { margin-top: 4px; padding-top: 4px; border-top: 1px solid rgb(255 255 255 / .2); }
.scp-ph { opacity: .55; font-style: italic; }
.scp-ta { width: 100%; box-sizing: border-box; min-height: calc(1.35em * 3); max-height: calc(1.35em * 8); resize: none; font: inherit; color: #fff; background: rgb(255 255 255 / .1); border: 1px solid rgb(255 255 255 / .35); border-radius: 8px; padding: 5px 7px; outline: none; user-select: text; -webkit-user-select: text; touch-action: auto; }
.scp.l .scp-ta, .scp.r .scp-ta { max-height: none; flex: 1 1 auto; }
.scp-icon { width: 42px; height: 42px; border-radius: 21px; border: 1px solid rgb(255 255 255 / .25); padding: 0; display: grid; place-items: center; }
.scp-icon i { position: absolute; right: -3px; top: -3px; min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box; border-radius: 8px; font: 700 10.5px/16px system-ui, sans-serif; font-style: normal; background: #ff453a; color: #fff; }
.scp-icon i.progress { background: #ff9f0a; color: #000; }
.scp-icon i.done { background: #30d158; color: #000; }
.scp-icon i:empty { display: none; }
.scp.b .scp-icon { left: calc(50% - 21px); bottom: var(--scp-b, 12px); }
.scp.t .scp-icon { left: calc(50% - 21px); top: var(--scp-t, 12px); }
.scp.l .scp-icon { top: calc(50% - 21px); left: var(--scp-l, 12px); }
.scp.r .scp-icon { top: calc(50% - 21px); right: var(--scp-r, 12px); }
.scp .scp-icon, .scp.min .scp-plate { display: none; }
.scp.min .scp-icon { display: grid; }
`;
  document.head.appendChild(st);
}

function readState(key){
  try {
    const v = JSON.parse(localStorage.getItem(key));
    if (v && typeof v === "object") return { side: SIDES.includes(v.side) ? v.side : "b", min: !!v.min };
  } catch {}
  return { side: "b", min: false };
}
function writeState(key, s){ try { localStorage.setItem(key, JSON.stringify(s)); } catch {} }

const sigOf = (c) => c ? [c.key, c.num, c.cls, c.label, c.theme, c.text, c.placeholder, !!c.onEdit, !!c.onSave].map((x) => x == null ? "" : String(x)).join("\u0001") : "";

export function createPlate(parent, opts = {}){
  injectStyles();
  const storeKey = opts.storeKey || "sight.captionPlate";
  const st = readState(storeKey);
  const root = document.createElement("div");
  root.className = "scp";
  root.hidden = true;
  root.innerHTML = `<div class="scp-plate"><div class="scp-head"><span class="scp-num"></span><span class="scp-lab"></span><button type="button" class="scp-edit" title="Text for this picture" aria-label="Text for this picture">${ICON_EDIT}</button></div><div class="scp-body"></div></div><button type="button" class="scp-icon" title="Show the text" aria-label="Show the text">${ICON_TEXT}<i></i></button>`;
  const plate = root.querySelector(".scp-plate"), icon = root.querySelector(".scp-icon");
  const num = root.querySelector(".scp-num"), lab = root.querySelector(".scp-lab"), edit = root.querySelector(".scp-edit");
  const body = root.querySelector(".scp-body"), badge = icon.querySelector("i");
  parent.appendChild(root);
  let cur = null, sig = null, editor = null, gone = false, endedAt = 0;

  const paintState = () => {
    SIDES.forEach((s) => root.classList.toggle(s, s === st.side));
    root.classList.toggle("min", st.min);
    paintScroll();
  };
  // A body with more text than it shows scrolls by a vertical finger drag; otherwise the drag moves the plate.
  function paintScroll(){ body.classList.toggle("scroll", body.scrollHeight > body.clientHeight + 1); }

  function render(){
    const c = cur;
    if (!c){ root.hidden = true; return; }
    root.hidden = false;
    num.textContent = c.num != null ? String(c.num) : "";
    num.hidden = c.num == null || c.num === "";
    num.className = "scp-num" + (c.cls ? " " + c.cls : "");
    badge.textContent = num.textContent;
    badge.className = c.cls || "";
    lab.textContent = c.label || "";
    edit.hidden = !(c.onEdit || c.onSave);
    body.textContent = "";
    const theme = (c.theme || "").trim(), text = (c.text || "").trim();
    if (theme){ const d = document.createElement("div"); d.className = "scp-theme" + (text ? "" : " solo"); d.textContent = theme; body.appendChild(d); }
    if (text){ const d = document.createElement("div"); d.className = "scp-text"; d.textContent = text; body.appendChild(d); }
    if (!theme && !text && (c.onEdit || c.onSave) && c.placeholder){ const d = document.createElement("div"); d.className = "scp-ph"; d.textContent = c.placeholder; body.appendChild(d); }
    body.scrollTop = 0;
    paintState();
  }
  function set(c){
    if (gone) return;
    const s = sigOf(c);
    cur = c || null;
    if (editor){ editor.pending = true; return; }  // the edit keeps its picture; the plate catches up when it ends
    if (s === sig) return;
    sig = s;
    render();
  }

  // ---- in-place edit (onSave) --------------------------------------------------------------------
  function startEdit(){
    const c = cur;
    if (!c) return;
    if (c.onEdit){ c.onEdit(); return; }
    if (!c.onSave || editor) return;
    if (st.min){ st.min = false; writeState(storeKey, st); paintState(); }
    const ta = document.createElement("textarea");
    ta.className = "scp-ta";
    ta.value = c.text || "";
    ta.placeholder = c.placeholder || "Text for this picture";
    ta.rows = 3;
    body.textContent = "";
    body.appendChild(ta);
    editor = { ta, save: c.onSave, before: ta.value, pending: false };
    ta.focus();
    ta.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (hotkey(e, "Enter")){ e.preventDefault(); endEdit(true); }
      else if (hotkey(e, "Escape")){ e.preventDefault(); endEdit(false); }
    });
    ta.addEventListener("blur", () => endEdit(true));
  }
  function endEdit(ok){
    const ed = editor;
    if (!ed) return;
    editor = null;
    endedAt = performance.now();
    const v = ed.ta.value.trim();
    sig = null;  // the body was replaced: draw it again whatever the content
    if (ok && v !== ed.before.trim()) ed.save(v);
    if (!gone) render();
  }
  // A press on the pencil while editing blurs the field (which saves): that click must not open it again.
  edit.addEventListener("click", (e) => { e.stopPropagation(); if (performance.now() - endedAt > 400) startEdit(); });

  // ---- tap / drag ------------------------------------------------------------------------------
  let g = null;
  const stop = (e) => e.stopPropagation();
  function down(e){
    e.stopPropagation();
    if (g || (e.pointerType === "mouse" && e.button !== 0)) return;
    if (e.target.closest(".scp-edit, .scp-ta") || editor) return;  // (editing: a press only ends the edit)
    // A press on the body's own scrollbar scrolls; it neither moves nor folds the plate.
    if (e.target === body && body.scrollHeight > body.clientHeight + 1 && e.clientX - body.getBoundingClientRect().left >= body.clientWidth) return;
    const el = e.currentTarget;
    g = { id: e.pointerId, el, x: e.clientX, y: e.clientY, moved: false };
    try { el.setPointerCapture(e.pointerId); } catch {}
  }
  function move(e){
    e.stopPropagation();
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (!g.moved && Math.abs(dx) + Math.abs(dy) < 8) return;
    if (!g.moved){ g.moved = true; g.el.classList.add("scp-drag"); }
    g.el.style.transform = `translate(${dx}px,${dy}px)`;
  }
  function up(e){
    e.stopPropagation();
    if (!g || e.pointerId !== g.id) return;
    const d = g;
    g = null;
    try { d.el.releasePointerCapture(e.pointerId); } catch {}
    if (e.type === "pointercancel" || !d.moved){
      d.el.style.transform = ""; d.el.classList.remove("scp-drag");
      if (e.type === "pointerup" && !d.moved){
        // A tap: the plate folds, the icon opens.
        st.min = d.el === plate;
        writeState(storeKey, st);
        paintState();
      }
      return;
    }
    // Let go: the side nearest to the pointer (in shares of the width / height) takes it.
    const r = root.getBoundingClientRect();
    const fx = (e.clientX - r.left) / (r.width || 1), fy = (e.clientY - r.top) / (r.height || 1);
    const dist = { l: fx, r: 1 - fx, t: fy, b: 1 - fy };
    const side = SIDES.reduce((a, s) => dist[s] < dist[a] ? s : a, "b");
    const from = d.el.getBoundingClientRect();
    d.el.style.transform = "";
    st.side = side;
    writeState(storeKey, st);
    paintState();
    // From where it was let go to its place.
    const to = d.el.getBoundingClientRect();
    d.el.classList.remove("scp-drag");
    if (d.el.animate && to.width && to.height){
      const ox = from.left + from.width / 2 - (to.left + to.width / 2), oy = from.top + from.height / 2 - (to.top + to.height / 2);
      d.el.animate([{ transform: `translate(${ox}px,${oy}px)`, opacity: .85 }, { transform: "none", opacity: 1 }], { duration: 180, easing: "cubic-bezier(.25,.8,.3,1)" });
    }
  }
  for (const el of [plate, icon]){
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    // The host's own gestures (zoom, swipe, drawing, play / pause) stay off the plate; the body still
    // scrolls natively (wheel, finger).
    ["click", "dblclick", "wheel", "touchstart", "touchmove"].forEach((t) => el.addEventListener(t, stop, { passive: true }));
    el.addEventListener("contextmenu", (e) => { e.stopPropagation(); e.preventDefault(); });
  }
  const onResize = () => paintScroll();
  window.addEventListener("resize", onResize);
  paintState();

  return {
    el: root,
    set,
    editing: () => !!editor,
    destroy(){
      gone = true;
      if (editor){ const ed = editor; editor = null; const v = ed.ta.value.trim(); if (v !== ed.before.trim()) ed.save(v); }
      window.removeEventListener("resize", onResize);
      root.remove();
    },
  };
}
