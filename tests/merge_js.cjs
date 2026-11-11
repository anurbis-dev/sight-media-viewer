// Runs review-core.js mergeRows on every case of a fixture file and prints the results as JSON
// (used by tests/test_merge_parity.py; Node 18+).   node tests/merge_js.cjs tests/fixtures/merge_cases.json
"use strict";
const fs = require("fs");
const path = require("path");
const RC = require(path.join(__dirname, "..", "app", "static", "review-core.js"));

const cases = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const out = cases.map((c) => {
  const local = JSON.parse(JSON.stringify(c.local));
  const incoming = JSON.parse(JSON.stringify(c.incoming));
  const res = RC.mergeRows(local, incoming, { deleted: c.deleted, now: c.now, shotMap: c.shot_map });
  // Inputs must not be changed by the merge.
  const untouched = JSON.stringify(local) === JSON.stringify(c.local) && JSON.stringify(incoming) === JSON.stringify(c.incoming);
  return { name: c.name, stats: res.stats, rows: res.rows, untouched };
});
process.stdout.write(JSON.stringify(out));
