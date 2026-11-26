// A tracker project's grid, kept the way Coreline keeps a view (apps/web LiveView, ADR-0026):
// the rows already downloaded stay, in order, and a later read changes them by id.
// A newer stamp replaces that one row. A row that was not here is inserted by its time
// only when it belongs in the pages already loaded (a newer Version lands at the top;
// an older one waits for the next page). A row the site no longer lists is removed.
// Plain ES module. No browser APIs, so tests/trk_view.mjs can load it.

// The newest stamp among the rows ("" when none carry one). ISO-8601 stamps compare as text.
export function watermark(records, stampOf){
  let best = "";
  for (const r of records){
    const s = String(stampOf(r) || "");
    if (s > best) best = s;
  }
  return best;
}

// Ids from a "retired" read that are not also in the active read.
// A site that ignores the retired flag echoes the active rows back: every id is in `upserts`,
// so this returns nothing and the grid is not wiped.
export function retiredIds(upserts, retired, idOf){
  const up = new Set(upserts.map((r) => String(idOf(r))));
  const out = [];
  for (const r of retired){
    const id = String(idOf(r));
    if (!up.has(id)) out.push(id);
  }
  return out;
}

// `change`: { upserts: records[], removed: ids[] }. `view`: { records, more, page }.
// Records stay newest-first by timeOf. Returns a new view plus `changed`.
export function applyDelta(view, change, idOf, stampOf, timeOf){
  const removed = new Set((change.removed || []).map((id) => String(id)));
  let next = removed.size ? view.records.filter((r) => !removed.has(String(idOf(r)))) : view.records.slice();
  let changed = next.length !== view.records.length;
  const seen = new Set(next.map((r) => String(idOf(r))));
  for (const rec of change.upserts || []){
    const id = String(idOf(rec));
    const at = next.findIndex((r) => String(idOf(r)) === id);
    if (at >= 0){
      const prev = next[at];
      const stamp = String(stampOf(rec) || "");
      if (stamp && stamp >= String(stampOf(prev) || "") && JSON.stringify(rec) !== JSON.stringify(prev)){
        next[at] = rec;
        changed = true;
      }
      continue;
    }
    const t = timeOf(rec) || 0;
    // Still more pages below this one: a row older than the last loaded row belongs down there.
    if (view.more && next.length && t < (timeOf(next[next.length - 1]) || 0)) continue;
    if (seen.has(id)) continue;
    let i = 0;
    while (i < next.length && (timeOf(next[i]) || 0) >= t) i++;
    next.splice(i, 0, rec);
    seen.add(id);
    changed = true;
  }
  return { records: next, more: !!view.more, page: view.page || 0, changed };
}

// The next page, appended. Rows already stored are skipped. `more` is "the page came back full".
export function appendPage(view, pageRecords, pageSize, idOf){
  const have = new Set(view.records.map((r) => String(idOf(r))));
  const add = [];
  for (const r of pageRecords){
    const id = String(idOf(r));
    if (have.has(id)) continue;
    have.add(id);
    add.push(r);
  }
  const more = pageRecords.length === pageSize;
  return {
    records: view.records.concat(add), more, page: (view.page || 0) + 1,
    changed: add.length > 0 || !!view.more !== more,
  };
}
