// Unit tests of app/static/filter-core.js (run by tests/test_filter.py): the model, the library wire form, and the
// ShotGrid adapter's Filter ▾ fields / hash filters (shotgrid-core.js, reached through the trackers registry as the
// pages do — filter-core.js itself keeps no tracker code).
"use strict";
const assert = require("assert");
const F = require("../app/static/filter-core.js");
require("../app/static/shotgrid-core.js");
const A = require("../app/static/trackers-core.js").adapter("shotgrid");
assert.strictEqual(F.sgFields, undefined, "no ShotGrid code left in filter-core");
assert.strictEqual(F.toSgConditions, undefined);

const L = F.LIB_FIELDS;
// complete / clean / count
assert.strictEqual(F.complete({ f: "name", o: "contains", v: " " }, L), false, "blank text");
assert.strictEqual(F.complete({ f: "name", o: "empty" }, L), false, "name has no 'empty'");
assert.strictEqual(F.complete({ f: "note", o: "empty" }, L), true);
assert.strictEqual(F.complete({ f: "rating", o: "gt", v: "x" }, L), false);
assert.strictEqual(F.complete({ f: "rating", o: "gt", v: "3" }, L), true);
assert.strictEqual(F.complete({ f: "mtime", o: "in_last", v: "0" }, L), false, "days > 0");
assert.strictEqual(F.complete({ f: "mtime", o: "on", v: "2026-13-40" }, L), false);
assert.strictEqual(F.complete({ f: "kind", o: "is", v: "virus" }, L), false, "enum value from the list");
assert.strictEqual(F.complete({ f: "nope", o: "is", v: "x" }, L), false);
assert.strictEqual(F.complete({ f: "ext", o: "contains", v: " .. " }, L), false, "an extension of dots only");
assert.strictEqual(F.complete({ f: "ext", o: "is", v: ".png" }, L), true);
assert.strictEqual(F.complete({ f: "name", o: "is", v: "x".repeat(501) }, L), false, "the server's text limit");
assert.deepStrictEqual(F.sanitize({ op: "or", c: [null, "x", { f: "name", o: "is", v: { a: 1 } }, { op: "and", c: [{ f: "kind", o: "is", v: "video" }] }] }),
  { op: "or", c: [{ f: "name", o: "is", v: "" }, { op: "and", c: [{ f: "kind", o: "is", v: "video" }] }] }, "junk children dropped");
assert.deepStrictEqual(F.sanitize("junk"), F.empty());
const tree = { op: "or", c: [
  { f: "kind", o: "is", v: "video" },
  { f: "name", o: "contains", v: "" },
  { op: "and", c: [{ f: "tags", o: "has", v: " hero " }, { f: "rating", o: "gt", v: "3" }] },
  { op: "and", c: [{ f: "name", o: "is", v: "" }] },
] };
assert.deepStrictEqual(F.clean(tree, L), { op: "or", c: [
  { f: "kind", o: "is", v: "video" },
  { op: "and", c: [{ f: "tags", o: "has", v: " hero " }, { f: "rating", o: "gt", v: "3" }] },
] }, "incomplete rows and empty groups dropped");
assert.strictEqual(F.count(tree, L), 3);
assert.strictEqual(F.clean(F.empty(), L), null);
assert.strictEqual(F.clean({ op: "and", c: [{ op: "and", c: [{ op: "and", c: [{ op: "and", c: [{ f: "kind", o: "is", v: "video" }] }] }] }] }, L), null, "deeper than MAX_DEPTH");

// the library wire form: dates resolved to local-midnight epoch ms, numbers / text normalised
const now = new Date(2026, 10, 21, 15, 30).getTime();
const day = (y, m, d) => new Date(y, m - 1, d).getTime();
assert.deepStrictEqual(F.toLibWire({ op: "and", c: [
  { f: "mtime", o: "in_last", v: "7" }, { f: "added", o: "before", v: "2026-11-20" },
  { f: "added", o: "after", v: "2026-11-20" }, { f: "mtime", o: "on", v: "2026-03-29" },
  { f: "rating", o: "gt", v: "3" }, { f: "tags", o: "has", v: " hero " }, { f: "note", o: "empty", v: "junk" },
] }, L, now), { op: "and", c: [
  { f: "mtime", o: "gte", v: now - 7 * 86400000 }, { f: "added", o: "lt", v: day(2026, 11, 20) },
  { f: "added", o: "gte", v: day(2026, 11, 21) }, { f: "mtime", o: "between", v: [day(2026, 3, 29), day(2026, 3, 30)] },
  { f: "rating", o: "gt", v: 3 }, { f: "tags", o: "has", v: "hero" }, { f: "note", o: "empty" },
] });
assert.strictEqual(F.toLibWire(F.empty(), L), null);

// ShotGrid: schema fields → builder fields → hash filters
const schema = [
  { name: "code", label: "Version Name", type: "text" },
  { name: "sg_status_list", label: "Status", type: "status_list", values: ["rev", "apr"], labels: { rev: "Pending Review", apr: "Approved" } },
  { name: "sg_kind", label: "Kind", type: "list" },
  { name: "entity", label: "Link", type: "entity" },
  { name: "created_at", label: "Date Created", type: "date_time" },
  { name: "sg_due", label: "Due", type: "date" },
  { name: "sg_frames", label: "Frames", type: "number" },
  { name: "sg_final", label: "Final", type: "checkbox" },
  { name: "tag_list", label: "Tags", type: "tag_list" },
];
const S = A.filterFields(schema);
assert.deepStrictEqual(S.map((f) => f.name), ["code", "sg_status_list", "sg_kind", "entity", "created_at", "sg_due", "sg_frames", "sg_final"], "unsupported types left out");
const st = F.fieldOf(S, "sg_status_list");
assert.strictEqual(st.type, "enum");
assert.deepStrictEqual(st.values, [["rev", "Pending Review"], ["apr", "Approved"]]);
assert.strictEqual(F.fieldOf(S, "sg_kind").type, "text", "a list without choices is typed");
assert.ok(F.opsOf(F.fieldOf(S, "created_at")).includes("empty"));
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
assert.deepStrictEqual(A.toConditions({ op: "and", c: [
  { f: "sg_status_list", o: "is", v: "rev" },
  { op: "or", c: [{ f: "entity", o: "contains", v: " 010 " }, { f: "entity", o: "empty" }] },
  { f: "created_at", o: "in_last", v: "3" },
  { f: "created_at", o: "on", v: "2026-11-20" },
  { f: "created_at", o: "before", v: "2026-11-20" },
  { f: "sg_due", o: "after", v: "2026-11-20" },
  { f: "sg_frames", o: "gt", v: "100" },
  { f: "sg_final", o: "yes" },
  { f: "code", o: "not_contains", v: "wip" },
  { f: "code", o: "contains", v: "" },
] }, S), { logical_operator: "and", conditions: [
  { path: "sg_status_list", relation: "is", values: ["rev"] },
  { logical_operator: "or", conditions: [{ path: "entity", relation: "name_contains", values: ["010"] }, { path: "entity", relation: "is", values: [null] }] },
  { path: "created_at", relation: "in_last", values: [3, "DAY"] },
  { path: "created_at", relation: "between", values: [iso(day(2026, 11, 20)), iso(day(2026, 11, 21) - 1000)] },
  { path: "created_at", relation: "less_than", values: [iso(day(2026, 11, 20))] },
  { path: "sg_due", relation: "greater_than", values: ["2026-11-20"] },
  { path: "sg_frames", relation: "greater_than", values: [100] },
  { path: "sg_final", relation: "is", values: [true] },
  { path: "code", relation: "not_contains", values: ["wip"] },
] });
assert.strictEqual(A.toConditions({ op: "and", c: [{ f: "code", o: "is", v: "" }] }, S), null);
// a list field without schema choices: the values seen on the records plus the ones the conditions name
const seenS = A.filterFields(schema, { seen: { sg_kind: new Set(["plate", "comp"]), sg_status_list: ["x"] },
  tree: { op: "and", c: [{ op: "or", c: [{ f: "sg_kind", o: "is", v: "anim" }] }, { f: "code", o: "is", v: "plate" }] } });
assert.deepStrictEqual(F.fieldOf(seenS, "sg_kind").values, [["anim", "anim"], ["comp", "comp"], ["plate", "plate"]]);
assert.strictEqual(F.fieldOf(seenS, "sg_kind").type, "enum");
assert.deepStrictEqual(F.fieldOf(seenS, "sg_status_list").values, [["rev", "Pending Review"], ["apr", "Approved"]], "schema choices win");
assert.strictEqual(F.fieldOf(A.filterFields(schema, { seen: { sg_kind: [] } }), "sg_kind").type, "text", "nothing seen or named: typed");
assert.deepStrictEqual(F.fieldOf(A.filterFields(schema, { seen: { sg_kind: ["__proto__"] }, tree: { op: "and", c: [{ f: "sg_kind", o: "is", v: "constructor" }] } }), "sg_kind").values,
  [["__proto__", "__proto__"], ["constructor", "constructor"]], "values that are Object.prototype names stay values");

console.log("filter_unit: ok");
