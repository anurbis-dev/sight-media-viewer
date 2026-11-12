// Local-first storage on the device (IndexedDB "sight-review"). Nothing leaves the device unless
// the user exports / shares it.
//
//   reviews  {key, asset, created, opened, updated, counts: {notes, open, progress, done}, thumb,
//             kept: bool}                     one per media file; key = assetKey(name, size)
//   rows     {key, rows: [FORMAT.md row + deleted_at]}   the review's rows, tombstones included
//   shots    {id, blob}                     attached pictures (FORMAT.md shots), by shot id
//   frames   {id: key + "|" + tag, review, blob, w, h}   cached clean pictures: "img" (the picture
//             scaled to <= 1600 px) and "t=<sec>" (video frames) — notes stay readable, and reports
//             can be made, without the media file
//   files    {key, blob}                    the media file itself, only if the user kept a copy

const NAME = "sight-review", VERSION = 1;
let dbp = null;

function open(){
  if (!dbp){
    const p = dbp = new Promise((ok, no) => {
      const r = indexedDB.open(NAME, VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore("reviews", { keyPath: "key" });
        d.createObjectStore("rows", { keyPath: "key" });
        d.createObjectStore("shots", { keyPath: "id" });
        d.createObjectStore("frames", { keyPath: "id" }).createIndex("review", "review");
        d.createObjectStore("files", { keyPath: "key" });
      };
      r.onsuccess = () => {
        const d = r.result;
        // A newer app version upgrades the database; iOS also drops the connection of an app that
        // was in the background. Either way the next call opens a new one.
        d.onversionchange = () => { d.close(); if (dbp === p) dbp = null; };
        d.onclose = () => { if (dbp === p) dbp = null; };
        ok(d);
      };
      r.onerror = () => no(r.error);
      r.onblocked = () => no(new Error("The database is in use by another window of the app"));
    });
    p.catch(() => { if (dbp === p) dbp = null; });
  }
  return dbp;
}

// A call on a lost connection fails with InvalidStateError ("The database connection is closing")
// or UnknownError ("Connection to Indexed Database server lost"): reopen once and try again.
async function retry(fn){
  try { return await fn(await open()); }
  catch (e){
    const lost = e && (/InvalidStateError|UnknownError|TransactionInactiveError/.test(e.name || "") || /connection/i.test(e.message || ""));
    if (!lost) throw e;
    dbp = null;
    return fn(await open());
  }
}
const req = (r) => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });

function run(stores, mode, fn){
  return retry((d) => new Promise((ok, no) => {
    const t = d.transaction(stores, mode);
    let out;
    t.oncomplete = () => ok(out);
    t.onerror = () => no(t.error);
    t.onabort = () => no(t.error || new Error("Storage transaction aborted"));
    out = fn(t);
  }));
}

export const get = (store, key) => retry((d) => req(d.transaction(store).objectStore(store).get(key)));
export const all = (store) => retry((d) => req(d.transaction(store).objectStore(store).getAll()));
export const put = (store, value) => run([store], "readwrite", (t) => { t.objectStore(store).put(value); });
export const del = (store, key) => run([store], "readwrite", (t) => { t.objectStore(store).delete(key); });
export const has = (store, key) => retry((d) => req(d.transaction(store).objectStore(store).count(key))).then((n) => n > 0);

export const framesOf = (review) => retry((d) => req(d.transaction("frames").objectStore("frames").index("review").getAll(review)));

// Removes a review with its rows, cached pictures, kept file and the pictures only it used.
export async function deleteReview(key, shotIds, sharedShots){
  const frames = await framesOf(key);
  await run(["reviews", "rows", "frames", "files", "shots"], "readwrite", (t) => {
    t.objectStore("reviews").delete(key);
    t.objectStore("rows").delete(key);
    t.objectStore("files").delete(key);
    frames.forEach((f) => t.objectStore("frames").delete(f.id));
    shotIds.forEach((s) => { if (!sharedShots.has(s)) t.objectStore("shots").delete(s); });
  });
}

// Saves a review's rows and its list entry together.
export const saveReview = (meta, rows) => run(["reviews", "rows"], "readwrite", (t) => {
  t.objectStore("reviews").put(meta);
  t.objectStore("rows").put({ key: meta.key, rows });
});

export async function usage(){
  try {
    const e = await navigator.storage.estimate();
    return { used: e.usage || 0, quota: e.quota || 0, persisted: navigator.storage.persisted ? await navigator.storage.persisted() : false };
  } catch { return null; }
}
export async function persist(){
  try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; }
  catch { return false; }
}
