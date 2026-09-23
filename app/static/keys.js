// Keyboard shortcuts: ONE rule for the whole app.
//
//   A shortcut fires only when the modifier keys held are EXACTLY the ones the combo names.
//   "KeyD" means a bare D — Shift+D, Ctrl+D, Alt+D, Ctrl+Alt+D are all different combos and never
//   trigger it. Never test `e.key === "d"` (or e.code) on its own in a keydown handler: use hotkey()
//   or runHotkeys() so that a new command can't accidentally fire from a longer combo.
//
// Combo syntax: modifiers joined with "+", then the key — "KeyD", "Ctrl+KeyD", "Ctrl+Alt+Shift+ArrowUp".
//   Ctrl matches Ctrl or Cmd. The key is a KeyboardEvent.code ("KeyD", "ArrowUp", "Delete", "Escape",
//   "Space", "BracketLeft", "Digit1"…), which is the physical key and so works on any keyboard layout;
//   a single character ("/") is also accepted and compared with KeyboardEvent.key.

const parsed = new Map();
function parse(combo){
  let p = parsed.get(combo);
  if (p) return p;
  const parts = combo.split("+");
  // A trailing "+" key ("Ctrl++") splits into an empty last part; treat it as the "+" character.
  const key = parts.pop() || "+";
  p = { ctrl: false, alt: false, shift: false, key };
  for (const m of parts){
    if (m === "Ctrl") p.ctrl = true;
    else if (m === "Alt") p.alt = true;
    else if (m === "Shift") p.shift = true;
  }
  parsed.set(combo, p);
  return p;
}

export function hotkey(e, combo){
  const p = parse(combo);
  if ((e.ctrlKey || e.metaKey) !== p.ctrl || e.altKey !== p.alt || e.shiftKey !== p.shift) return false;
  return e.code === p.key || (p.key.length === 1 && e.key === p.key);
}

// Runs the first matching [combo, handler] entry. A handler that returns false means "not applicable
// right now" (e.g. nothing selected): matching continues and the browser default is left alone.
// Otherwise the event's default action is prevented and true is returned.
export function runHotkeys(e, table){
  for (const [combo, fn] of table){
    if (!hotkey(e, combo)) continue;
    if (fn(e) === false) continue;
    e.preventDefault();
    return true;
  }
  return false;
}
