// The tracker grid's cache merge (app/static/tracker-view.js): rows stay, and a later read changes them by id.
// Run: node tests/trk_view.mjs
import assert from "node:assert";
import { applyDelta, appendPage, retiredIds, watermark } from "../app/static/tracker-view.js";

const idOf = (r) => r.id;
const stampOf = (r) => r.updated_at;
const timeOf = (r) => Date.parse(r.created_at);
const row = (id, created, updated, code) => ({ id, code: code || id, created_at: created, updated_at: updated });

const page = [
  row(3, "2026-11-03T00:00:00Z", "2026-11-03T00:00:00Z", "c"),
  row(2, "2026-11-02T00:00:00Z", "2026-11-02T00:00:00Z", "b"),
  row(1, "2026-11-01T00:00:00Z", "2026-11-01T00:00:00Z", "a"),
];
const view = { records: page, more: true, page: 1 };

// a changed row is replaced in place; the order stays
{
  const next = applyDelta(view, { upserts: [row(2, "2026-11-02T00:00:00Z", "2026-11-05T00:00:00Z", "b2")], removed: [] }, idOf, stampOf, timeOf);
  assert.deepStrictEqual(next.records.map((r) => r.code), ["c", "b2", "a"]);
  assert.strictEqual(next.changed, true);
  assert.deepStrictEqual(view.records.map((r) => r.code), ["c", "b", "a"], "the stored rows are not rewritten");
}

// an older stamp does not overwrite
{
  const next = applyDelta(view, { upserts: [row(2, "2026-11-02T00:00:00Z", "2026-11-01T00:00:00Z", "old")], removed: [] }, idOf, stampOf, timeOf);
  assert.strictEqual(next.records[1].code, "b");
  assert.strictEqual(next.changed, false);
}

// a new Version newer than the tail lands in order; one older than the loaded pages waits
{
  const next = applyDelta(view, {
    upserts: [
      row(9, "2026-11-04T00:00:00Z", "2026-11-04T00:00:00Z", "new"),
      row(8, "2026-10-01T00:00:00Z", "2026-11-04T00:00:00Z", "old-page"),
    ],
    removed: [],
  }, idOf, stampOf, timeOf);
  assert.deepStrictEqual(next.records.map((r) => r.code), ["new", "c", "b", "a"]);
}

// once every page is loaded, an older new row is inserted too
{
  const done = { records: page, more: false, page: 1 };
  const next = applyDelta(done, { upserts: [row(8, "2026-10-01T00:00:00Z", "2026-11-04T00:00:00Z", "old-page")], removed: [] }, idOf, stampOf, timeOf);
  assert.deepStrictEqual(next.records.map((r) => r.code), ["c", "b", "a", "old-page"]);
}

// a row the site dropped leaves; the others stay
{
  const next = applyDelta(view, { upserts: [], removed: [2, "nope"] }, idOf, stampOf, timeOf);
  assert.deepStrictEqual(next.records.map((r) => r.id), [3, 1]);
}

// the next page appends, and a row we already have is not stored twice
{
  const next = appendPage(view, [row(1, "2026-11-01T00:00:00Z", "2026-11-01T00:00:00Z", "a"), row(4, "2026-10-02T00:00:00Z", "2026-10-02T00:00:00Z", "d")], 2, idOf);
  assert.deepStrictEqual(next.records.map((r) => r.code), ["c", "b", "a", "d"]);
  assert.strictEqual(next.more, true);
  assert.strictEqual(next.page, 2);
  const last = appendPage(next, [row(5, "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z", "e")], 2, idOf);
  assert.strictEqual(last.more, false);
}

assert.strictEqual(watermark(page, stampOf), "2026-11-03T00:00:00Z");
assert.strictEqual(watermark([], stampOf), "");

// a retired read that is really the active rows (the site ignored the flag) removes nothing
assert.deepStrictEqual(retiredIds([row(2, "", "2026-11-05T00:00:00Z")], [row(2, "", "2026-11-05T00:00:00Z")], idOf), []);
assert.deepStrictEqual(retiredIds([row(2, "", "2026-11-05T00:00:00Z")], [row(7, "", "2026-11-05T00:00:00Z")], idOf), ["7"]);

console.log("trk_view: ok");
