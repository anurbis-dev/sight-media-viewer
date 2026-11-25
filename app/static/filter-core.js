// Filter builder — one field filter for every source (docs/PLAN-trackers.md stage 3b): conditions field · operator ·
// value in AND / OR groups. The library's fields are evaluated by Sight's server (Library.where_sql, `toLibWire`);
// a tracker project's fields and their translation into the tracker's own filter form belong to that tracker's adapter
// (`filterFields` / `toConditions`, trackers-core.js; ShotGrid's in shotgrid-core.js) — this file stays generic.
//
// Plain script, no build step, no imports: one global `SightFilter` (also `module.exports` under Node, for
// tests/filter_unit.cjs), so the phone app can load it like shotgrid-core.js (stage 3d).
//
// Model: a group {op: "and" | "or", c: [condition | group]}, a condition {f: field name, o: operator, v: value}.
// A field: {name, label, type, values?: [[value, label]], ops?: [operator ids], srcType?: the source's own type (an
// adapter's)}. Types: text, enum, tags, number, date, entity (a tracker's link field), bool. The value kinds an operator takes: text, number, days, date
// (YYYY-MM-DD), enum (one of field.values), none.

var SightFilter = (function(){
  "use strict";

  var MAX_DEPTH = 3;   // the root group and two levels of groups under it (the server allows 4)
  var MAX_ROWS = 100, MAX_TEXT = 500;   // the server's limits (Library.where_sql)
  var OPS = {
    contains: ["contains", "text"], not_contains: ["doesn't contain", "text"], is: ["is", "text"], is_not: ["is not", "text"],
    starts_with: ["starts with", "text"], ends_with: ["ends with", "text"],
    empty: ["is empty", "none"], not_empty: ["is not empty", "none"],
    has: ["has tag", "text"], not_has: ["doesn't have tag", "text"],
    gt: ["greater than", "number"], lt: ["less than", "number"],
    in_last: ["in the last … days", "days"], on: ["on", "date"], before: ["before", "date"], after: ["after", "date"],
    yes: ["is Yes", "none"], no: ["is No", "none"],
  };
  var TYPE_OPS = {
    text: ["contains", "not_contains", "is", "is_not", "starts_with", "ends_with", "empty", "not_empty"],
    enum: ["is", "is_not"],
    tags: ["has", "not_has", "contains", "empty", "not_empty"],
    number: ["is", "is_not", "gt", "lt"],
    date: ["in_last", "on", "before", "after"],
    entity: ["contains", "not_contains", "is", "empty", "not_empty"],
    bool: ["yes", "no"],
  };
  var KIND_VALUES = [["image", "Image"], ["video", "Video"], ["audio", "Audio"], ["model3d", "3D"], ["document", "Document"], ["font", "Font"], ["design", "Design"]];
  var REVIEW_VALUES = [["none", "No review state"], ["review", "In review"], ["changes", "Changes requested"], ["approved", "Approved"]];
  // The library's fields (the server's Library.where_sql knows the same names).
  var LIB_FIELDS = [
    { name: "name", label: "Name", type: "text", ops: ["contains", "not_contains", "is", "is_not", "starts_with", "ends_with"] },
    { name: "kind", label: "Type", type: "enum", values: KIND_VALUES },
    { name: "ext", label: "Extension", type: "text", ops: ["is", "is_not", "contains"], strip: "." },
    { name: "tags", label: "Tags", type: "tags" },
    { name: "rating", label: "Rating", type: "number" },
    { name: "mtime", label: "Modified", type: "date" },
    { name: "added", label: "Added", type: "date" },
    { name: "path", label: "Path", type: "text", ops: ["contains", "not_contains", "starts_with"] },
    { name: "note", label: "Note", type: "text", ops: ["contains", "not_contains", "empty", "not_empty"] },
    { name: "review", label: "Review", type: "enum", values: REVIEW_VALUES },
  ];

  function opsOf(field){ return (field && (field.ops || TYPE_OPS[field.type])) || []; }
  function valueKind(field, op){
    var k = (OPS[op] || [])[1] || "none";
    if (k === "text" && field && field.type === "enum") return "enum";
    if (k === "text" && field && field.type === "number") return "number";
    return k;
  }
  function fieldOf(fields, name){ for (var i = 0; i < (fields || []).length; i++) if (fields[i].name === name) return fields[i]; return null; }
  function isGroup(x){ return !!x && typeof x === "object" && (x.op === "and" || x.op === "or") && Array.isArray(x.c); }
  function empty(){ return { op: "and", c: [] }; }
  // A stored / synced tree made safe to edit: groups and condition objects only, depth and size capped.
  function sanitize(t, depth){
    depth = depth || 1;
    if (!isGroup(t)) return depth === 1 ? empty() : null;
    var out = { op: t.op, c: [] };
    t.c.forEach(function(x){
      if (isGroup(x)){ if (depth < MAX_DEPTH){ var g = sanitize(x, depth + 1); if (g) out.c.push(g); } }
      else if (x && typeof x === "object" && typeof x.f === "string" && typeof x.o === "string"){
        var v = x.v;
        out.c.push({ f: x.f, o: x.o, v: v == null || typeof v === "object" ? "" : typeof v === "string" ? v.slice(0, MAX_TEXT) : v });
      }
    });
    return out;
  }
  function rows(t){ var n = 0; (function walk(g){ g.c.forEach(function(x){ if (isGroup(x)) walk(x); else n++; }); })(t); return n; }
  function dateOk(s){ return typeof s === "string" && /^\d{4}-\d\d-\d\d$/.test(s) && isFinite(Date.parse(s + "T00:00:00")); }
  // A condition with everything it needs (an incomplete row in the builder is kept there but filters nothing).
  function complete(c, fields){
    var f = fieldOf(fields, c && c.f);
    if (!f || opsOf(f).indexOf(c.o) < 0) return false;
    var k = valueKind(f, c.o), v = c.v;
    if (k === "none") return true;
    if (k === "number") return v !== "" && v != null && isFinite(Number(v));
    if (k === "days") return v !== "" && v != null && isFinite(Number(v)) && Number(v) > 0;
    if (k === "date") return dateOk(v);
    if (k === "enum") return (f.values || []).length ? f.values.some(function(x){ return String(x[0]) === String(v); }) : v != null && String(v) !== "";
    var s = v == null ? "" : String(v).trim();
    if (f.strip) s = s.replace(new RegExp("^[" + f.strip.replace(/[\]\\^-]/g, "\\$&") + "]+"), "");
    return s !== "" && s.length <= MAX_TEXT;
  }
  // The tree with only complete conditions on known fields and no empty group; null when nothing is left.
  function clean(tree, fields, depth){
    depth = depth || 1;
    if (!isGroup(tree) || depth > MAX_DEPTH) return null;
    var out = [];
    tree.c.forEach(function(x){
      if (isGroup(x)){ var g = clean(x, fields, depth + 1); if (g) out.push(g); }
      else if (complete(x, fields)) out.push({ f: x.f, o: x.o, v: x.v === undefined ? null : x.v });
    });
    return out.length ? { op: tree.op, c: out } : null;
  }
  function count(tree, fields){
    var n = 0, t = clean(tree, fields);
    (function walk(g){ if (g) g.c.forEach(function(x){ if (isGroup(x)) walk(x); else n++; }); })(t);
    return n;
  }
  // Local midnight of a YYYY-MM-DD day (+ `plus` days), epoch ms.
  function dayStart(s, plus){ var p = s.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2] + (plus || 0)).getTime(); }

  // For /api/assets?where=: dates resolved to epoch-ms bounds in the viewer's time zone, values trimmed.
  function toLibWire(tree, fields, now){
    now = now == null ? Date.now() : now;
    var t = clean(tree, fields || LIB_FIELDS);
    if (!t) return null;
    return (function conv(g){
      return { op: g.op, c: g.c.map(function(x){
        if (isGroup(x)) return conv(x);
        var f = fieldOf(fields || LIB_FIELDS, x.f);
        if (f.type === "date"){
          if (x.o === "in_last") return { f: x.f, o: "gte", v: now - Number(x.v) * 86400000 };
          if (x.o === "before") return { f: x.f, o: "lt", v: dayStart(x.v) };
          if (x.o === "after") return { f: x.f, o: "gte", v: dayStart(x.v, 1) };
          return { f: x.f, o: "between", v: [dayStart(x.v), dayStart(x.v, 1)] };
        }
        var k = valueKind(f, x.o);
        if (k === "none") return { f: x.f, o: x.o };
        if (k === "number") return { f: x.f, o: x.o, v: Number(x.v) };
        return { f: x.f, o: x.o, v: String(x.v).trim() };
      }) };
    })(t);
  }

  // ---- Helpers for the tracker adapters ----------------------------------------------------------------------
  // A tracker's own fields and its filter form live in its adapter (ShotGrid: shotgrid-core.js `filterFields` /
  // `toConditions`, reached through SightTrackers.adapter(kind)); these generic pieces are what they build on.
  // namedIn(tree, name, into): the values the tree's conditions on field `name` name, added to `into` as keys (a value
  // filtered out never shows on a record, yet a list field built from the values seen must still offer it).
  function namedIn(tree, name, into){
    (function walk(g){ if (isGroup(g)) g.c.forEach(function(x){ if (isGroup(x)) walk(x); else if (x && x.f === name && x.v != null && x.v !== "") into[String(x.v)] = 1; }); })(tree);
    return into;
  }
  // ---- The builder UI (browser only) ---------------------------------------------------------------------------
  // mountBuilder(host, {fields, tree, onChange(tree), suggest(field) → [strings]}) renders the editor into `host`.
  // Every edit reaches onChange (a typed value after a short pause); a row still incomplete stays in the tree but
  // filters nothing. Returns {set(tree, fields), flush()}.
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(ch){ return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function mountBuilder(host, o){
    var fields = o.fields || [], tree = sanitize(o.tree);
    var timer = 0, dlSeq = 0;
    function at(path){ var x = tree; (path ? path.split(".") : []).forEach(function(i){ x = x.c[Number(i)]; }); return x; }
    function parentOf(path){ var p = path.split("."); var i = Number(p.pop()); return { g: at(p.join(".")), i: i }; }
    function emit(){ clearTimeout(timer); timer = 0; o.onChange(JSON.parse(JSON.stringify(tree))); }
    function later(){ clearTimeout(timer); timer = setTimeout(emit, 350); }
    function newCond(){
      var f = fields[0];
      return { f: f ? f.name : "", o: f ? opsOf(f)[0] : "", v: "" };
    }
    function valueHtml(c, f){
      var k = valueKind(f, c.o), v = c.v == null ? "" : c.v;
      if (k === "none") return "";
      if (k === "enum"){
        return '<select class="flt-v" aria-label="Value"><option value="">—</option>' + (f.values || []).map(function(x){
          return '<option value="' + esc(x[0]) + '"' + (String(x[0]) === String(v) ? " selected" : "") + ">" + esc(x[1]) + "</option>"; }).join("") + "</select>";
      }
      if (k === "date") return '<input class="flt-v" type="date" aria-label="Date" value="' + esc(dateOk(v) ? v : "") + '">';
      if (k === "days") return '<span class="flt-days"><input class="flt-v" type="number" min="1" step="1" inputmode="numeric" aria-label="Days" value="' + esc(v) + '"> days</span>';
      if (k === "number") return '<input class="flt-v" type="number" step="any" inputmode="decimal" aria-label="Value" value="' + esc(v) + '">';
      var list = o.suggest ? o.suggest(f, c.o) : null, id = "";
      if (list && list.length){
        id = "flt-dl-" + (++dlSeq);
        return '<input class="flt-v" type="text" maxlength="500" spellcheck="false" aria-label="Value" list="' + id + '" value="' + esc(v) + '"><datalist id="' + id + '">' +
          list.slice(0, 300).map(function(s){ return '<option value="' + esc(s) + '">'; }).join("") + "</datalist>";
      }
      return '<input class="flt-v" type="text" maxlength="500" spellcheck="false" aria-label="Value" value="' + esc(v) + '">';
    }
    function condHtml(c, path){
      var f = fieldOf(fields, c.f);
      var fopts = fields.map(function(x){ return '<option value="' + esc(x.name) + '"' + (x.name === c.f ? " selected" : "") + ">" + esc(x.label) + "</option>"; }).join("");
      if (!f) fopts = '<option value="' + esc(c.f) + '" selected>' + esc(c.f || "—") + "</option>" + fopts;   // (the source's fields not read yet)
      var ops = f ? opsOf(f) : [c.o];
      var oopts = ops.map(function(op){ return '<option value="' + esc(op) + '"' + (op === c.o ? " selected" : "") + ">" + esc((OPS[op] || [op])[0]) + "</option>"; }).join("");
      return '<div class="flt-row' + (complete(c, fields) ? "" : " incomplete") + '" data-path="' + path + '">' +
        '<select class="flt-f" aria-label="Field">' + fopts + "</select>" +
        '<select class="flt-o" aria-label="Operator">' + oopts + "</select>" +
        (f ? valueHtml(c, f) : "") +
        '<button type="button" class="flt-x" data-act="del" title="Remove this condition" aria-label="Remove">✕</button></div>';
    }
    function groupHtml(g, path, depth){
      var rows = g.c.map(function(x, i){ var p = path === "" ? String(i) : path + "." + i; return isGroup(x) ? groupHtml(x, p, depth + 1) : condHtml(x, p); }).join("");
      return '<div class="flt-group' + (depth === 1 ? " root" : "") + '" data-path="' + path + '">' +
        '<div class="flt-ghead"><select class="flt-join" aria-label="Match"><option value="and"' + (g.op === "and" ? " selected" : "") + '>All</option><option value="or"' + (g.op === "or" ? " selected" : "") + ">Any</option></select>" +
        "<span>of these" + (depth === 1 ? "" : " (group)") + "</span>" +
        (depth === 1 ? "" : '<button type="button" class="flt-x" data-act="delg" title="Remove this group" aria-label="Remove group">✕</button>') + "</div>" +
        (rows || (depth === 1 ? '<div class="flt-none">No conditions: everything shows.</div>' : "")) +
        '<div class="flt-gacts"><button type="button" class="btn ghost" data-act="add">+ Condition</button>' +
        (depth < MAX_DEPTH ? '<button type="button" class="btn ghost" data-act="addg">+ Group</button>' : "") +
        (depth === 1 && g.c.length ? '<button type="button" class="btn ghost flt-clear" data-act="clear">Clear</button>' : "") + "</div></div>";
    }
    // (focus stays inside: the button pressed may be gone, and Esc / typing should still reach the builder)
    function paint(focusPath, sel){
      var inside = host.contains(document.activeElement);
      host.innerHTML = groupHtml(tree, "", 1);
      var r = focusPath != null ? host.querySelector('[data-path="' + focusPath + '"] > ' + (sel || ".flt-f")) : null;
      if (r) r.focus();
      else if (inside && !host.contains(document.activeElement)){ var a = host.querySelector('[data-act="add"]'); if (a) a.focus(); }
    }
    function pathOf(el){ var r = el.closest("[data-path]"); return r ? r.getAttribute("data-path") : null; }
    host.addEventListener("click", function(e){
      var b = e.target.closest("button[data-act]");
      if (!b || !host.contains(b)) return;
      var path = pathOf(b), act = b.getAttribute("data-act");
      if (act === "add" || act === "addg"){
        var g = at(path);
        if (rows(tree) + (act === "add" ? 1 : 2) > MAX_ROWS) return;
        g.c.push(act === "add" ? newCond() : { op: g.op === "and" ? "or" : "and", c: [newCond(), newCond()] });
        paint((path === "" ? "" : path + ".") + (g.c.length - 1) + (act === "addg" ? ".0" : ""));
      } else if (act === "del" || act === "delg"){
        var pr = parentOf(path), gp = path.split(".").slice(0, -1).join(".");
        pr.g.c.splice(pr.i, 1);
        paint(gp, '.flt-gacts > [data-act="add"]');
      } else if (act === "clear"){ tree = empty(); paint(); }
      emit();
    });
    host.addEventListener("change", function(e){
      var t = e.target, path = pathOf(t);
      if (path == null) return;
      if (t.classList.contains("flt-join")){ at(path).op = t.value === "or" ? "or" : "and"; emit(); return; }
      var c = at(path);
      if (!c || isGroup(c)) return;
      if (t.classList.contains("flt-f")){
        var f = fieldOf(fields, t.value), keepOp = f && opsOf(f).indexOf(c.o) >= 0, oldF = fieldOf(fields, c.f);
        c.f = t.value;
        if (!keepOp) c.o = f ? opsOf(f)[0] : "";
        if (!keepOp || !oldF || oldF.type !== (f && f.type)) c.v = "";
        paint(path, ".flt-f"); emit();
      } else if (t.classList.contains("flt-o")){
        var f2 = fieldOf(fields, c.f), before = valueKind(f2, c.o);
        c.o = t.value;
        if (valueKind(f2, c.o) !== before) c.v = "";
        paint(path, ".flt-o"); emit();
      } else if (t.classList.contains("flt-v")){ c.v = t.value; mark(t, c); emit(); }
    });
    host.addEventListener("input", function(e){
      var t = e.target;
      if (!t.classList.contains("flt-v")) return;
      var c = at(pathOf(t));
      if (!c || isGroup(c)) return;
      c.v = t.value; mark(t, c); later();
    });
    function mark(t, c){ var r = t.closest(".flt-row"); if (r) r.classList.toggle("incomplete", !complete(c, fields)); }
    paint();
    return {
      set: function(t, f){ if (f) fields = f; tree = sanitize(t); paint(); },
      flush: function(){ if (timer) emit(); },
    };
  }

  return {
    OPS: OPS, TYPE_OPS: TYPE_OPS, LIB_FIELDS: LIB_FIELDS, KIND_VALUES: KIND_VALUES, REVIEW_VALUES: REVIEW_VALUES, MAX_DEPTH: MAX_DEPTH,
    opsOf: opsOf, valueKind: valueKind, fieldOf: fieldOf, isGroup: isGroup, empty: empty, sanitize: sanitize, complete: complete, clean: clean, count: count,
    toLibWire: toLibWire, dayStart: dayStart, namedIn: namedIn, mountBuilder: mountBuilder,
  };
})();
if (typeof globalThis !== "undefined") globalThis.SightFilter = SightFilter;
if (typeof module === "object" && module && module.exports) module.exports = SightFilter;
