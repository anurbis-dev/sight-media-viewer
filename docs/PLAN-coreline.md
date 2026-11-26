# Plan — review inside Coreline (player + comments), Sight as an optional external reviewer

Owner, 2026-11-25: build Sight's review into Coreline itself, as its own player and commenting. Leave out Sight's
desktop app, the library / tracker browser and the heavy extras. Sight (desktop) becomes an optional external media
reviewer of Coreline. **The look to take is Sight's desktop one**: the lightbox (picture / video) on the left, the
notes panel on the right. Not the phone app's screen. On the phone the notes go under the player (owner,
2026-11-25). Coreline also needs **3D** (and documents such as scripts, deferred by the owner on 2026-11-25: focus is
images, video and 3D). So the viewing side is split into viewer modules behind one interface (decision 8), not one
more lightbox.

This replaces stage 5c of docs/PLAN-trackers.md (a Coreline adapter written against a Coreline with no review layer)
and refines stage 5 of docs/PLAN-mobile.md. Coreline is the private repository `anurbis-dev/CueTrack`. It was read
on 2026-11-25 at `ea411a7`, at pre-MVP. It has a data core, permissions, a journal with realtime, a media pipeline and
a web client prototype. Its ROADMAP lists "Media and review" after MVP. Work done there follows Coreline's
AGENTS.md:
- an ADR first;
- schema as data;
- every change journaled;
- permissions enforced on the server, down to fields;
- i18n;
- mobile first-class;
- a `coreline` CLI command for each new server capability;
- `npm run typecheck` / `npm test` green.

## Decisions

| # | Topic | Decision |
|---|-------|----------|
| 1 | Look | Sight's **desktop review**: a viewer (decision 8) with `annotate.js` (notes panel on the right, drawing tools, threads, states, review state) beside it. On a narrow screen the panel goes under the player (decision 6). |
| 2 | Data | **Coreline stores FORMAT.md v1 rows as they are**: every row column (`id`, `kind`, `shape_kind`, `x` `y` `w` `h`, `rotation`, `z_index`, `color`, `locked`, `data`, stamps) plus tombstones. No second annotation model, so `.srev`, Sight, the phone app and Coreline share one contract and one merge. |
| 3 | Code | **Sight stays the source** of the shared modules: `review-core.js` (primitives, merge), the viewer modules (`app/static/viewers/*`, with `viewer-input.js` and `model3d-core.js`) and `annotate.js` (once R0 has made them host-neutral), their small helpers (`keys.js`, `key-help.js`, `cursors.js`, `caption-plate.js`), and three.js / spark. Coreline **vendors** them unchanged from a pinned Sight commit: a sync script, a `VERSION` file, never edited there. The vendored folder is excluded from Coreline's `checkJs` (its web tsconfig is strict). The server gets a `.d.ts` for the merge. Coreline's own code is the host: data, i18n labels, theme tokens. |
| 4 | Merge | The Coreline server merges with **the same `mergeRows`**, not a third port. Coreline is ESM (`"type": "module"`), so `module.exports` in review-core.js is dead code there. Load it with a side-effect `import` and read `globalThis.SightReviewCore`. Sight's `tests/fixtures/merge_cases.json` runs in Coreline's tests too. `mergeRows` returns `{rows, stats}`, so the server diffs them to get the changed rows (response, journal). |
| 5 | Scope | **In (first):** image and video, frame-accurate transport, notes on a frame / the picture, threads, note states, annotate.js's drawing tools, the file's review state, attached pictures (shots), `.srev` import / export, realtime between reviewers. **Next:** 3D (decision 8). **Deferred:** documents (R5). **Out (now):** compare, sequences / multi-clip bundles, boards, PDF / HTML reports, dictation, the library beside the lightbox, tracker link ▾ (inside Coreline the record *is* the link). Out means the host does not offer it; rows that carry such data are kept untouched (FORMAT.md: keep unknown fields). |
| 6 | Phone | **Owner 2026-11-25:** the same code on the phone, the notes **under the player** (the phone app's layout idea, not its code). Coreline rule 8 requires the phone; annotate.js is touch-ready but has no narrow layout today. |
| 7 | Sight | Sight talks to Coreline through its tracker adapter (docs/PLAN-trackers.md 5b), **after** Coreline's review layer exists. It browses Versions, opens the original or the `web` rendition, and pulls / pushes rows through Coreline's review API (merge on the server). Optional: Coreline works fully without it. |
| 8 | Viewers | **One viewer interface, one module per media kind**, shared by Sight and Coreline: `image`, `video`, `model3d` (later `document`, `audio`). A viewer mounts into a stage and gives annotate.js what it binds to today through `bind2d` / `bind3d`. That is: the surface element; the doc box and the view transform (doc units); the **place** now (FORMAT.md `ctx`: video `{t, hold}`, 3D `{vk, cam}`); go to a place; a capture of the current view (note previews, shots); and its own transport / toolbar slot. annotate.js gets one `bind(viewer)` instead of a branch per kind. The lightbox (Sight) and the review screen (Coreline) are thin frames that pick a viewer by kind. |

## What Sight has to give up first (found 2026-11-25)

- `annotate.js` (6.1k lines) is a module created with `createAnnotator(host)` (:551). Sight makes three: lightbox
  (index.html:1856), board (1918), compare (1945). Most `host.*` hooks are optional (board, compare, sequences,
  trackers, library). But it is tied to Sight's server well beyond `host`:
  - **`host.api`:** 14 calls, about 8 path families: `/api/annotations`, `/api/review/shots`, `/api/review/export/*`,
    `/api/assets/:id/versions|review|info`, `/api/trackers/…`.
  - **The write queue `OB`** (:278-540) is a module-level singleton shared by every annotator. It starts on import
    (pagehide / visibilitychange / pageshow listeners, a `setInterval`) and persists in `localStorage`
    (`sight-annot-outbox:v2:<window>`); a new window adopts a stale window's outbox. It calls `fetch()` itself, with
    hard-coded paths:
    - POST on create; PATCH of `obFields` (`data`, `z_index`, `color`, the box, `shape_kind` — not `rotation` /
      `locked`), where a row gone on the server is skipped, never revived;
    - plain updates in `/api/annotations/batch`, single requests after two failures;
    - a 4xx other than 408 / 429 = refused for good (`ObRefused`);
    - a keepalive beacon on pagehide.
  - **Other direct `fetch()`:** `trkApi` (:3438, 3583), `/api/review/import` (:5301), shot blobs (:3559).
  - **URLs in HTML templates:** `/api/review/shots/<id>` (:894, 3630, 4094, 4242), note previews `npUrl` →
    `/api/review/nprev/…` (:3883), the original through `/api/file/<aid>` in a hidden `<video>` for note previews
    (:4026). Plus module-level `RC.setImageSource(… "/api/review/shots/" …)` (:239), global state inside review-core.
  - **fps:** parsed from a "frame rate" row of `/api/assets/:id/info` (:5497).
  - **Imports:** absolute `/static/…` paths (:24-34; also key-help.js, dictation.js). `video-playable.js` polls
    `/api/video/{transcode,scrub}`; `dictation.js` calls `/api/stt/*` and is created on every mount (:5659);
    `trackers-core.js` / `shotgrid-core.js` register globals on import.
  - **Settings:** read from `localStorage` directly (`readJSON`), written through `host.putSetting` (:573):
    `sight.annotate.filter`, `.styles`, `.stamp`, `.stamp.videos`, a tracker project key.
  - **Author:** a free-text name from `localStorage "sight.reviewer"` (:622), written into notes, replies, status
    events and the review state.
  - **CSS / DOM:** one global stylesheet injected into `<head>` (:6147) on Sight's unprefixed tokens (`--border`,
    `--fg`, `--accent`, `--surface*`, `--muted`, `--bg`, `--font`, `--ui-k`, `--bar-h`, `--an-pw`; Coreline's are
    `--ct-*`). It appends to `document.body` (outbox badge "Sight could not save…", :521), and puts key / pointer
    listeners on document / window.
  - **Live updates:** only `reload()` of everything, which clears undo / redo; no "apply these rows by id".
- The lightbox is not a module. The 2D player is `attachViewer` in index.html (:6767-7167; `paintVBar` 6640,
  `seekVideo` 6904, `beginScrub` 6921), the video bar from :7169 (`bindVBar` 7675, scrub audio 7201-7300),
  `toggleLight` 8296 / `showInLight` 8617 open it. It is mixed with 3D, sequences, compare, trackers.
  **Its geometry is the decoded element's:** `vs.nat` starts from the asset's size (:6799) but `onReady` overwrites it
  with `videoWidth` / `naturalWidth` (:7007), and `geom()` hands that to annotate.js as doc units. A 1920-wide
  rendition of a 4K original would give drawings in 1920-px units.
- Viewers by kind are branches of index.html (`fillStage` :6377-6397: `attachViewer` for image / video / PSD,
  `boot3d` :5667 for 3D, `mountWave` audio, `mountFontStage`, `mountDocStage`). A PDF is an `<embed>` (the browser's own viewer: nothing can be drawn on it),
  text files a `<pre>`. annotate.js knows two surfaces only (`bind2d`, `bind3d`, ~5771). `model3d-core.js` is already
  a shared ES module (turns, framing, explode, environments, splats, USD parsing); the 3D viewer around it (~1400
  lines) is in index.html.
- Neither has a narrow-screen layout. annotate.js has `pointer: coarse` sizes but places the panel right of the picture
  at 320 px.
- UI strings are inline English: annotate.js, plus review-core.js (`PATTERN_LABELS`, the `FONTS` labels). Coreline puts
  every string through i18n.

## Mapping onto Coreline (what was found there)

- **Auth:** a session cookie, or `Authorization: Bearer <api key>` (`/api/auth/api-keys`). Sight keeps the key on its
  server, as for ShotGrid. Coreline sends no CORS headers. Its own page needs none (same origin); the phone app stays
  local-only for now.
- **Media access:** `GET /api/records/:type/:id/files/:field` returns signed URLs, but only if the reader may see the
  record *and* that field. Bytes come from `/api/media/:id/:kind?exp=&sig=` with Range. That route ignores Bearer and
  cookies; links live 6 h; with object storage it answers 302 to the storage's own signed URL. `GET /api/files/:id` is
  for the uploader or an admin only. So the review API must return signed URLs for the shots of every reviewer.
- **Renditions:**

  | Media | What the worker makes |
  |-------|-----------------------|
  | Video | `web` (H.264 MP4 ≤ 1920 wide), `poster`, `scrub` sprite |
  | Image | `web` (WebP ≤ 2048 on the long side), `thumb` |

  - Above `media.maxProcessSize` / `maxProcessDuration` nothing is made (`skipped: "too_large"`).
  - With `media.originals = delete` there is no `original` URL.
  - Files keep `width`, `height`, `fps`, `duration` either way.
- **Gotcha, doc units:** FORMAT.md doc units are pixels of the media at **native size**. The player shows a scaled `web`
  rendition, so the viewer module (R0b) must keep the host's native `width` × `height` as its doc box and scale the
  rendition into it (today it takes the decoded size, see above). With no `web` rendition: play the original if it is
  there and playable, else "no preview".
- **Author:** the signed-in user, not a typed name. The server stamps / checks `author` on notes, replies, events and
  review state it receives from its own users (Sight's pushed rows keep theirs).
- **Asset identity** in a `.srev` written by Coreline:
  - `asset.id` = `coreline:<host>:<file id>`;
  - `name` / `size` = the original's (so Sight's name + size match finds a local copy);
  - `kind`, `width`, `height`, `duration`.
- **Notes:** Coreline has a `note` entity:
  - fields `subject`, `body`, `author`, `about`, `to`, `status`, `reply_to`, `attachment`, `thumbnail`;
  - threads in `apps/web/src/lib/notes.js`;
  - statuses open / in_progress / done / closed (FORMAT.md has open / progress / done).

  The review rows stay the source of truth (decision 2). Mirroring them into `note` records is R5.
- **Realtime:** Coreline's WebSocket subscribes to views of entity types and sends entity records. Review rows are
  not records, so they need a new subscription or message kind and a journal key of their own (like the system
  `_settings` / `_view` events).
- **Journal volume:** do not write one event per pointer move. annotate.js already sends one row per finished stroke,
  and debounces updates by 300 ms. Measure it against Coreline's budgets (AGENTS rule 6).

## Stages

R0 is on the Sight side. R1–R3 are Coreline PRs (ADR first, in R1). R0 and R1 can run in parallel.

### R0 — Sight: make the desktop review embeddable (this repo)
**No regressions (owner, 2026-11-25): Sight desktop is in daily use by people; it must keep working exactly as it
does.** R0 is a restructuring of code they rely on, so:
- **R0-0 first — a safety net, before any refactor.** Existing cover of this code: `annot_tools_e2e`, board
  annotations, `grade_parts_e2e`, `export_extent_e2e`, `draw_clip` / `draw_lasso`, review page / bundle / all,
  `page_e2e` / `page_multi_e2e`, `sg_view_e2e`, `sg_sight`, `trackers_e2e` / `trackers_multi_e2e`, playback copy,
  video cache, merge parity, the pwa tests. Write Playwright regression tests for what it lacks, and make them pass
  on the code *as it is now*:
  - opening image / video / PSD / 3D in the lightbox, next / previous, closing; PSD layer switching and preview;
  - video transport: play / pause, frame step, scrub (also the scrub copy and scrub audio), loop, the video bar,
    fps, the timeline marks; playback conversion of a video the browser cannot decode (`video-playable.js`);
  - zoom / pan / fit on 2D and 3D, 3D turns / camera / explode / shading;
  - **stored geometry, golden:** a known drawing on a known image and on a video stores exactly the same row
    (`x` / `y` / `w` / `h`, `data` points), including a file whose decoded size differs from the asset's
    `width` / `height` (R0b rewires `vs.nat` / `geom()`; behaviour tests would not catch a shift in units);
  - notes: new note on a frame / view, reply, edit, states, delete, the review state, filters, the panel's on / off,
    picking a note goes to its frame / view; the reviewer name (`sight.reviewer`) in notes, replies, events and the
    review state;
  - every drawing tool, select / transform, undo / redo, the eye, onion skin;
  - the write queue: offline → kept → online → saved, no duplicate, nothing revived; a second window adopting a
    stale window's outbox; the pagehide keepalive beacon;
  - settings round trip: `sight.annotate.styles` / `.filter` / `.stamp` / `.stamp.videos` through `host.putSetting`
    and back after a reload (incl. `hydrateSettings` dropping keys the server lacks);
  - shots / reference images (also dragged in from the library split), note previews, dictation opening;
  - 3D: turns and saved cameras per asset, `.usdz` with and without the server conversion, an FBX with textures
    beside it (`/api/model-res`), a splat;
  - board annotations, compare (incl. files dropped for compare), sequences (the other two annotators); the library
    split (Tab);
  - `.srev` / HTML / PDF export and import, the tracker link ▾ (with the fake ShotGrid server);
  - panel / toolbar placement at Interface Scale 0.75× and 1.75× (`--ui-k`), light and dark theme;
  - a text snapshot of the bars, panel and `?` lists (R0e must change no string);
  - keyboard shortcuts of these modes, and the touch path (`hasTouch` contexts) for each.

  In this container the dev server is `SIGHT_DEV=1 python3 Sight.py --dev --no-browser --port N` (CLAUDE.md's
  command is the Windows runtime). "Green" means **no unexpected skips**: several tests skip quietly without
  Playwright or ffmpeg (`skipUnless`); `test_mac_launch` / `test_splash_win` skip on Linux by design.
- **Refactor steps change no behaviour.** No feature, fix or look change mixed into a refactor step; a bug found on
  the way is its own entry. The R0-0 tests stay unchanged through R0 (a test changed in the same step as the code
  does not count as proof). **The only behaviour changes in R0**, each its own block with its own tests:
  - R0a's stamp tracking. Sight's store sends the row stamps and Sight's server ignores them (it sets `created_at` /
    `updated_at` itself, library.py:4524-4560), so Sight behaves the same. **Fresh undo / redo stamps
    (`data.edited_at` = now) only for a store that merges on the server** (`store.mergesOnServer`, Coreline). Sight's
    store keeps today's undo, which restores the old `edited_at` (`applyStates`, annotate.js:858). Stamping there
    would let an undone copy win a later `.srev` merge against another client's newer edit. A merge test pins this.
  - R0a's queue keyed by store. Sight keeps its key: the old `sight-annot-outbox:v2` entries are still sent.
  - R0a's "apply rows by id". Unused by Sight until something calls it.
  - R0d's narrow layout. It only takes effect below the breakpoint, which Sight's window rarely reaches.
- **Small steps, each shippable on its own.** One R0 block = one version (CLAUDE.md: minor for a feature such as
  R0d, patch for a pure refactor), merged only with the whole suite green. Each block can ship to people before the
  next one starts, so a regression shows up in a small diff. The owner is told which blocks to try on Windows: the
  native window, file dialogs, performance on real footage — things this container cannot check.
- **The reviewer of each R0 block is asked about regressions first**: what behaviour the old code had that the
  new one may lose:
  - event order, focus, timing;
  - a host hook no longer called;
  - a localStorage key renamed;
  - an outbox format change: `sight-annot-outbox:v2` entries left by the old version must still be sent after an
    update.
- **Performance:** run the startup / grid benchmarks (`tools/bench_*.py`) before and after each block, on the same
  machine. The lightbox open / frame-step timings need a small tool written in R0-0. Headless timings here (software
  WebGL for 3D) are noisy and do not stand for Windows, so the real-footage timing is on the owner's checklist.
- Keys, settings and stored data keep their names (`sight.annotate.*`, the outbox), or get a migration that reads
  the old ones.

Each block reviewed on its own.
- **R0a — annotate.js host-neutral.** Everything it gets from Sight's server goes through one `host.store`:
  - rows: load, put / delete (the write queue's transport), apply incoming rows by id (new: keeps undo / redo; an
    undo entry whose row changed meanwhile is dropped, not written back);
  - **stamps in every put:** a put carries the client's `created_at` / `updated_at`. Today neither the create body
    (`rowBody`, :636) nor the PATCH sends stamps, and the annotator's items (`{id, kind, sub, z, data}`) keep no row
    stamps or `deleted_at` at all, so R0a adds stamp tracking (the queue entry's `at`, :361, is the source for
    `updated_at`); without it `mergeRows` takes `now` and a stale outbox entry would win.
  - **undo / redo on a store that merges on the server** (`store.mergesOnServer`) write their copy stamped now:
    `data.edited_at` for a note (the merge judges notes by `edited_at || created`, not `updated_at`), `updated_at`
    for other rows; an undone delete is stamped with the undo time (later than any `deleted_at` this client wrote).
    Sight's store keeps today's undo (old stamps restored), see "No regressions";
  - shots: put, URL (also the one `RC.setImageSource` uses, set per store, not module-wide);
  - media URL + fps + native size of the asset (no `/api/file`, no `/info` parsing);
  - note previews (`nprev`): a store hook, or made in the browser from the viewer's capture;
  - optional: versions, review import / export, trackers, playback conversion, dictation. Missing = the control
    hides, and its module is not imported (dynamic `import()`).
  - **The write queue** stays one per page but is created on the first store, keyed by the store (Sight: as today;
    Coreline: `coreline:<host>:<user>`, so a sign-out never replays one user's writes under another). Its request
    rules (create / patch-never-revives / batch / refused) become the store contract, written in ARCHITECTURE.md.
  - Settings through the host (read and write); the author from the host; CSS tokens through one prefix the host
    maps (`--an-*` defaults); user-facing texts through labels (R0e); relative or import-map imports, not `/static/`.
- **R0b — the viewer interface and the 2D viewers** (`app/static/viewers/`): write the interface (decision 8),
  then `image` and `video` modules (player, transport, video bar, zoom / pan through viewer-input.js, frame
  stepping, fps); annotate.js's `bind2d` becomes `bind(viewer)`. index.html's lightbox becomes a frame that picks
  the viewer; sequences and compare drive viewers instead of owning their own players. The biggest step: split it.
  - **R0b-1 (done, 0.142.2):** the interface (`viewers/viewer.js`), the 2D core and the image / video modules
    (`view2d.js`, `image.js`, `video.js`: element, doc box with `opts.docSize`, zoom / pan / fit / turn, seek pump,
    scrub copy, transport), annotate.js `bind(viewer)`. index.html's `attachViewer` is the frame (`viewerHost`).
  - **R0b-2:** the video bar (sound, loop, position field, fps from `/info`), scrub audio and the RAM cache calls move
    from index.html into the video module, behind store / host hooks (`/api/video/*` through the store with R0a).
  - **R0b-3:** sequences and compare drive viewer modules instead of their own players.
- **R0c — the 3D viewer as a module** (`model3d`): the 3D code of index.html (roughly :4941-6365 — `boot3d` :5667,
  `dispose3d`, `gltfLoaderWithDecoders` with DRACO / meshopt, `makeModelManager`, `loadModel` / `loadModelCached` /
  `loadUsd`, splat sniffing, shading / lights / explode, `get/setModelTurns` / `get/setModelCam`; thumbnails
  :3049-3190 and the model inspector :9062 stay Sight's) onto `model3d-core.js`, behind the same interface (`bind3d`
  folds into `bind`). Its ties to Sight's server go through the store:
  - sibling resources (`/api/model-res/:aid?name=`: textures / buffers beside the model file);
  - conversion to GLB (`/api/model-glb/:aid`), used for `.usdz` only and optional (three's USDLoader is the
    fallback);
  - per-asset turns and cameras (today `readAllCams` / `setModelTurns` in the browser);
  - the three.js / spark import map (absolute `/static/vendor/…` :935).

  Three.js and spark stay vendored.
- **R0d — narrow layout:** below a breakpoint the notes panel goes under the player (decision 6), in Sight's window
  and in an embedding page.
- **R0e — labels hook:** every UI string of the shared modules through a `labels` object (English defaults), so
  Coreline can feed its i18n.
- Write the embedding contract (host hooks, store, labels, CSS tokens, viewer interface) into ARCHITECTURE.md.
  FORMAT.md does not change.

### R1 — Coreline: ADR "Review layer" + storage + API
- ADR: decisions 2–4, permissions, realtime, vendoring.
- **Table** `review_rows`: every FORMAT.md row column (decision 2) plus `deleted_at`.
  - Key `(record_type, record_id, field, id)`. Ids are kept as they come, never re-derived: two records cannot
    collide under this key, and a re-derived id would come back to Sight as a new row (duplicate notes). Sight
    already re-derives on its own import when an id belongs to another asset.
- **Permissions:** read / write a record's review = see / edit that record and its file field (the same check as
  `/api/records/:type/:id/files/:field`). A field the user cannot see never shows its review anywhere.
- **API:**
  - `GET /api/review/:type/:id/:field` → rows plus shots with signed URLs;
  - `POST …/merge` with rows + tombstones → server `mergeRows`, the changed rows back;
  - row put / delete for the write queue, with the store contract's rules (R0a). **A put is merged, not
    replaced:** replies, status events and captions live inside `note.data`, so two reviewers replying at once would
    lose one reply, and a replayed offline outbox would overwrite newer content. The server runs `mergeRows` with that
    one row (and returns the merged row). Undo writes are stamped now (R0a), so they still win the merge;
  - `.srev` import / export;
  - CLI `coreline review export|import`.
- **Realtime:** journal events under a review key; a subscription per record + field.
- **Tests:** `merge_cases.json` through the server merge.

### R2 — Coreline: the review screen (desktop look)
- The vendored viewers + annotate.js, with Coreline as the host: `store` = the R1 API, `labels` = i18n, its `--ct-*`
  theme tokens mapped onto annotate.js's `--an-*`, author = the signed-in user.
- Where the vendored files live: `apps/web/src/vendor/sight/` served as is, excluded from `checkJs`, imported
  relatively (R0a) so the URL prefix does not matter.
- Opens from a Version (record page, grid tile).
- The player uses the `web` rendition, the poster until it is ready, and the scrub sprite for hover. Incoming journal
  deltas go through the store's "apply rows by id" (R0a).
- Mouse / keyboard and touch both. Phone layout as in R0d.

### R2b — Coreline: 3D
- The `model3d` viewer from R0c in the review screen. Coreline's media worker makes no renditions for 3D today: the
  viewer loads the original. **GLB first** (self-contained): a `.gltf` with external buffers / textures cannot load
  from one file field; it needs the store's sibling-resource hook and a way to keep those files (e.g. a multi-file
  field or a zip) — a Coreline decision for then. Right after GLB: the other single-file formats `loadModel` already
  reads in the browser (STL, PLY, OBJ / FBX without external textures, USD / USDA / USDC, USDZ through three's
  USDLoader, splats). OBJ + MTL and FBX with textures wait on the same sibling-file decision as `.gltf`.

### R3 — Coreline: pictures and files
- Shots (screenshots, attached pictures, reference images) through resumable uploads, with a FORMAT shot id → file id
  table.
- `.srev` import / export in the UI.

### R4 — Sight: the Coreline adapter (was docs/PLAN-trackers.md 5c)
**Done in 0.135.0** (docs/CORELINE.md: decisions, mapping, what to check on a real server). Review only, as proposed.
- Implements the adapter interface (`app/trackers.py`, `trackers-core.js`):
  - connect (host + API key), projects, schema fields, Versions with filters, thumbnails / scrub;
  - open the original or the `web` rendition, through the signed URLs of the record's file field;
  - review sync = pull rows + merge locally, push rows to Coreline's merge API. No flat pictures, unlike ShotGrid.
- The link lives in `tracker_links` (per asset, tracker key `coreline:<host>`; record type + id + field go into its
  `link` / `state`).
- Answers the first half of 5b-2 (2), a second adapter's row key: none is needed, the rows themselves are shared.
  The second half (two ShotGrid sites, one `data.sg` per note) stays open. A per-note Coreline link added later (R5)
  would reopen it: a FORMAT.md field + a merge rule in both `Library.import_annotations` and review-core.js.

### R5 — later
- Mirror review notes into Coreline `note` records (inbox, notifications; status mapping incl. `closed`).
- Playlists / screening room, version compare, audio, shared links (Coreline has none yet).
- **Documents (scripts)**, deferred by the owner 2026-11-25. Sketch kept for then:
  - a `document` viewer: PDF pages rendered to canvases with pdf.js (Apache-2.0), not `<embed>`, so they can be drawn
    on; Fountain / plain text laid out into pages; `.fdx` later;
  - a page is a still picture for annotate.js;
  - an optional `ctx.page` in FORMAT.md. An older reader **shows** such a drawing on every page (`ctxVisible`,
    review-core.js:1445, filters only on `at.t` / `at.vk`); older Sight cannot annotate documents anyway
    (`supported()`), so only its reports / exports would show it;
  - a first-page thumbnail from Coreline's worker;
  - later, notes anchored to a text range (a line of dialogue).
  - Ask then: which formats first (PDF only, or Fountain / Final Draft too)?
- The phone app talking to Coreline (needs CORS or same-origin hosting).

## Open questions (ask when the stage comes)
- R1: can a review sit on any file field (`media`, `attachment`), or only a Version's `media`? Proposed: any file
  field, keyed by record + field.
- R2: who may change a note's state: anyone who can edit the Version, or only its author and leads?
- R4: ~~does Sight upload new versions to Coreline?~~ Review only (0.135.0, as proposed; uploading stays out).
