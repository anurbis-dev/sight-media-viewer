# Plan — one review page / review file for several clips

Owner's request (0.73.0): a sequence's review as **one** web page for reviewers instead of a page per clip.
The page never embeds video: it holds each clip's cover, the frames with drawings (JPEG), the notes / replies, the
screenshots and the rows — it grows with the notes and the clips' covers / shots, not with the video. What stands
in the way is the exchange format: a `.srev` package is one asset (`asset` required, FORMAT.md "Package"), the page
holds one report + one package and sends back one `.srev`, Sight's import and the phone app read one asset per file.

The design keeps every package exactly as it is (one asset each, the same rows, the same merge rules) and adds an
envelope around several of them. `Library.import_annotations` / `review-core.js` merge code is not touched, so
`tests.test_merge_parity` stays valid. Today's "all clips" web page / .srev exports (index.html `seqExportAll`)
make one file per clip; older Sight and older phone apps reject an unknown `format` with "Not a Sight review
file" (review.py `parse_package`, mobile model.js `parsePackage`) — clean, if not very telling.

## Stage 1 — the bundle format, Sight's import and export (backend, FORMAT.md, annotate.js import UI)

**Done in 0.75.0** (see RECENT). Deviation: `package-all` takes `asset_ids` (every clip of the sequence, no
reports — a package needs no pictures) and the server keeps the clips with notes or tombstones.

- **FORMAT.md, new section "Bundle"**: `{format: "sight-review-bundle", version: 1, id, app, exported_at, author,
  title?, packages: [package, …]}`. `id`: a random bundle id (the page's storage key and the phone's group key
  use it). Each entry is a complete package (its own `asset`, `annotations`, `deleted`, `shots`; shots stay per
  package). Order = clip order; one asset at most once. Extension `.srev` too (decided); import tells the
  two apart by `format`. A bundle with one package is legal, an empty one is an error; `version` > 1 → "made by a
  newer Sight", like a package.
- **Parsing**: `review.parse_review_file(raw) -> list[package]` — a plain package → `[pkg]`; a bundle → each inner
  package through `parse_package`'s own checks (format, version, `asset`, `annotations`), an inner one failing its
  checks is reported for that clip, not for the file.
- **One import function** shared by the endpoint and the tests: asset matching (id → rows already held →
  name / size), shots (`put_shot`), `import_annotations` → `{ok, asset_id | missing, stats | error}`. Today
  `tests/test_pwa.py::sight_import` copies the endpoint's logic; it calls the shared function instead.
- **`/api/review/import`**: a plain package keeps today's response exactly (404 for missing media, 400 for a
  damaged file, `{ok, asset_id, added, updated, deleted, author}`). A bundle answers **200** with
  `{ok, bundle: true, results: [per package]}`: packages are committed one by one, so a missing clip or a damaged
  package is reported in its entry and never turns the whole request into an error.
- **Sight's import UI** (annotate.js `importFile`, reached from the Export menu, index.html drop handler and
  `pickReviewFile`): for a bundle, toast a summary ("3 clips updated · 1 not in your library: name · 1 damaged"),
  reload / clear undo for every affected asset that is open (the lightbox one, the sequence's clips), and open
  nothing new unless a single clip was updated (then as today).
- **Export**: `/api/review/export/package-all` — one bundle for the sequence's clips with notes; the server makes
  the bundle's `id` / `exported_at` and, per report's `asset_id`, looks the asset up and builds its package
  (`build_package(…, annotation_tombstones(…))`). Sequence → Export → "Review file, all clips" uses it instead of
  the per-clip loop.
- **Two packages matching one local asset** (the name + size / kind fallback): detected, the second entry reported
  as "same file as clip N" instead of importing twice and counting the clip twice in the toast.
- **Mixed replies**: a plain "this clip's reply" followed by a bundle holding the same clip re-imports with no
  effect under the merge rules — no dedupe logic needed.
- Tests: parse (plain / bundle / empty / unknown version / one damaged inner package), import of a bundle with one
  missing and one damaged package (others land), a plain package unchanged; export of a two-clip bundle.

## Stage 2 — the multi-clip web page

The page script (review.py `build_html`, one IIFE) holds page-wide state from one clip — `R`, `PKG`, `rows`, `E`,
`KEY`, `VIEW_KEY`, `M`, `VEC`, `noteById` / `numById`, `exported`, `drafts`, `openReply`, `newOpen` — fixed element
ids (`#app`, `#seg`, `#details`, `#from`, `#dl`, `#dlpage`, `#reset`, `#status`), a document click listener and a
`header()` that appends. **The main work and risk is a refactor**: that state goes into a per-clip object swapped
on a clip switch, the header and the list cleared and redrawn, listeners bound once.

- **Data**: `{clips: [{report, package, edits}], bundle: {id, exported_at, title}, copy}`; a one-clip page uses the
  same shape with one clip — and its reply stays a **plain package** (never a one-clip bundle: older Sight / phones).
- **Storage**: each clip's slot keyed `"sight-review:" + bundle.id + ":" + asset.id (+ ":" + copy)` (today:
  `asset.id + ":" + PKG.exported_at (+ copy)`; a single-clip page may keep that formula — each page carries its own
  script, so old pages keep their key whatever the new code does, and a new export has a new `exported_at` anyway). The reviewer's name (`sight-review:name`) and the show / plate settings stay page-wide.
  localStorage is shared by all `file://` pages (one origin in Chromium) and attached pictures are data URLs: the
  "cannot keep that many pictures" alert gets more likely with many clips — it names the clip.
- **UI**: a clip strip at the top (name, note count, open count; a tap switches); the current clip's cover / notes
  as now. Desktop: ← / → between clips through `hotkey()` (keys.js is only inside the `SightCaptionPlate` wrapper
  today: expose it), not in text fields, the full-screen picture or the drawing canvas. Phone: the strip scrolls
  sideways; no swipe on the header (it competes with the strip and the header's tap-to-expand) — prev / next
  buttons instead.
- **The bottom bar is for the whole page**: the change count sums all clips (`changes()` per clip: new notes +
  reply entries — drawings always come with one of those); "Download reply" is enabled when any clip changed;
  "Discard" asks whether to drop this clip's changes or all.
- **"Download reply"**: a bundle of the clips with changes (unchanged ones left out — safe under merge rules 3 / 6,
  it only saves size; an included clip still re-sends its whole package as today's `replyPackage()` does). Name:
  the bundle's title ("Sequence review — 3 clips.srev"). "This clip's reply" (plain package) for a receiver on an
  older Sight — a button on the multi-clip page, reachable by mouse and touch (the only way back for an older Sight
  when one clip changed: the reply is otherwise a one-package bundle). **"Download the page"** reads every clip's slot (only the current clip's state is in memory).
- **Reply bundle id**: the page's reply reuses the page's `bundle.id` (Sight / the phone can map it back to its
  group); the reply's `exported_at` is new.
- **Sight**: `/api/review/export/html-all` (like `pdf-all`: `_all_reports` + per report the asset and its package,
  bundle `id` / `exported_at` made by the server) and
  `seqExportAll`'s "html" branch collects the reports for it instead of posting per clip.
- Tests: `tests/page_e2e.cjs` keeps passing unchanged on a one-clip page; a new two-clip case: switch clips, reply
  on each, Download reply → a bundle of two packages that imports (the shared import function) onto the right
  assets; one clip changed → a bundle of one; discard one / all. The data block changes shape
  (`{report, package, edits, copy}` → `{clips, bundle, copy}`): a one-clip page's "Download the page" copy must
  still reply with a plain package (today's test imports `copy.html.srev` and expects 0 added — keep that).

## Stage 3 — the phone app

- **Open**: `mobile/js/model.js` `parsePackage` accepts a bundle; `importReviewFile` already opens a review without
  its media (`openReview(key, null)`) — refactor it into a per-package import that does not toast, ask (`intoKey`
  "Another file?") or open by itself, and loop it. "Import into the open review" does not apply to a bundle.
- **Group**: the phone has no group concept (reviews are separate, keyed by name + size). Keep the bundle id with
  the review keys it opened into (IndexedDB), shown as one entry with its clips; a clip whose media is not on the
  phone is listed greyed, its notes readable.
- **Changed since import**: a per-review mark set at the user-edit call sites — not in `dirty()` as it is (the
  import calls `dirty()` too, app.js `importReviewFile`), or `dirty(userEdit)` with the import passing false;
  `meta.updated` cannot serve (the import bumps it). Deletions count (the phone writes tombstones, `deleted`). The
  mark is cleared only after a successful send and survives later merges (a new bundle from Sight arriving before
  the reply goes out keeps it). A review may sit in more than one group (the same clip in two bundles): the model
  keeps a list of groups per review — a `groups: [bundleId]` field on the review's meta record (no new IndexedDB
  store, no DB version bump); the group ids are the bundle ids received, and a reply reuses them.
- **Sending back**: a helper returning a package for any review key (rows from IndexedDB, or `R.rows` after
  `flush()` when that review is open), name asked once, one file offered for the whole bundle — not `exportSrev`
  per clip (it packs only the open review and offers a file per call). The bundle carries its group's id.
- PLAN-mobile.md / FORMAT.md cross-references; `tests/pwa_*.cjs` cases for opening and sending a bundle.

## Decided (owner, 2026-11-17)

1. The bundle uses the **`.srev`** extension too; import tells it from a package by `format`.
2. **Clips with no notes are left out** of the page and the bundle (as the PDF / ZIP "all clips" do). For the
   bundle / page a clip with tombstones (all its notes deleted since the last send) still counts — otherwise the
   deletions never reach the reviewer or the phone and an older copy there keeps those notes.
3. **Boards stay out** for now (board rows are never exported, FORMAT.md).

## Order and size

Stage 1 is small and safe (envelope, shared import function, import UI summary, bundle export). Stage 2 is the
bulk (the page script refactor). Stage 3 depends on 1 and is independent of 2. Each stage gets its own review
(CLAUDE.md), RECENT entry and version bump.
