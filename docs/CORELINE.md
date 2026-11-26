# Coreline link (Sight as an external reviewer of Coreline)

Stage R4 of docs/PLAN-coreline.md (0.135.0). Coreline is the owner's tracker (`anurbis-dev/cuetrack`). Since its
ADR-0037 (R1, PRs #65–#68) it stores Sight's own review rows (docs/FORMAT.md v1) per record + file field and merges
them on its server with Sight's `review-core.js` `mergeRows`, vendored byte-for-byte. So, unlike ShotGrid, the sync
moves **rows**, not notes + flat pictures. Built against Coreline main `9cffd42` (docs/API.md, ADR-0037, ADR-0006
filters, the schema of `packages/shared`, as passed on by the orchestrator session) **without a real server**: the
tests run a fake (`tests/cl_fake_server.cjs`). See "To check on a real server".

## Decisions

| Topic | Decision |
|-------|----------|
| Scope | Review only (PLAN-coreline open question R4, as proposed): browse Versions, open the media, sync the review. Sight never uploads new Versions. |
| Auth | Coreline API key (`Authorization: Bearer`), kept by Sight's server in `coreline.json` (0600), never sent back to the page. Sight acts with that user's permissions. |
| Transport | Coreline sends no CORS headers: every request goes through `/api/trackers/coreline:<host>/fetch?url=` (like ShotGrid's). Desktop only: the phone app does not load the adapter. |
| Link | `tracker_links` under `coreline:<host>`; link = `{site: host, type, id, field, code, project: {id}, source?, scaled?, file?}` (record type + id + file field). |
| Media | Open = the **original** (FORMAT.md doc units are the original's pixels). Only without one (deleted on Coreline, or a type Sight cannot open) the `web` rendition; when its size differs from the original's the link says `scaled` and Sync refuses the file. Sync also refuses any linked file whose width × height differ from the original's (the link keeps the original's size: a proxy linked by hand). |
| Realtime | Not used: Sync is a button, as for ShotGrid (Coreline's `review_sub` WebSocket is for its own page). |

## Pieces

| File | Role |
|------|------|
| `app/coreline.py` | `CorelineService` — the server adapter (app/trackers.py interface): settings, `forward()` (adds the key on the server only; refuses every `/api/auth/…` route but `GET /api/auth/me`, so the page cannot mint / list / revoke keys — and any path with dot / empty segments, backslashes or encoded dots / slashes, so a server resolving `/api/x/../auth/…` cannot be led there, nor an on-site redirect; https only elsewhere; a redirect from a signed media link is followed without the key), `picture()` (the file's `thumb` / `poster` rendition, an image's `web`; `filmstrip` = the `scrub` sprite re-tiled with Pillow into one row of 240-px frames, ≤ 60), `fetch_media()` (original, else `web` (its extension from its mime); `<name>__c<id>.<ext>` / `.web.<ext>` (`__c<type>-<id>-<field>` for another type / field) in `coreline_cache/media/<host>/`, reused while the file id + sha256 + source match, `.clsrc` beside it), the media cache (limit / Auto / Clear, as ShotGrid's). Media id = `"<type>:<id>:<field>"`. |
| `app/static/coreline-core.js` | `SightCoreline.adapter` — the client adapter (trackers-core.js interface) + the sync. Plain script, Node-loadable. |
| `app/trackers.py` | registers `CorelineService` beside `ShotGridService`. |
| `app/server.py` | the generic tracker routes, unchanged but for `Content-Range` now passed through `…/fetch` (Coreline's resumable uploads; ShotGrid's adapter ignores it). |
| `app/static/index.html` | one `import "/static/coreline-core.js"`. Settings form, sidebar source, grid, link ▾ (**CL ▾**) are the generic tracker UI. |

## Mapping

| Sight | Coreline |
|-------|----------|
| projects | `GET /api/me/projects` → `{id, display}` |
| Version list | `POST /api/query {type, filter, sort: [{field: "createdAt", dir: "desc"}], limit, cursor, columns}` — cursor-paged (cursors kept per query); a server that refuses the sort / columns once gets plain queries |
| quick filters | project `{field: "project", op: "is", value: {type: "project", id}}`; All / Shots / Assets `{field: "entity:<type>.<display field>", op: "is_not_null"}`; an entity `{field: "entity", op: "is", value: {type, id}}`; status `{field: <status field>, op: "is", value}`; the search box `{field: <display field>, op: "contains"}` |
| Filter ▾ | ADR-0006 nodes (`{and|or: […]}`, `{field, op, value}`): text ops as named; empty / not empty = `is_null` / `is_not_null`; numbers `is`/`is_not`/`gt`/`lt`; dates `in_last {n, unit: "day"}`, a `date` field `is`/`lt`/`gt` "YYYY-MM-DD", a `datetime` field `lt` / `gte` / `between` local midnights in UTC; a link field by its targets' display field (`entity:shot.code`, an `or` over the targets) |
| tile fields / captions | the schema's Version fields (file / image fields left out); status choices from the schema's status lists; a link field shows its `columns` display value |
| the media type / file field | read from `GET /api/schema`: type `version` (else one labelled Version, else the first with a file field), field `media` (else the first file field, else the first image field that is not `thumbnail`), status field `status`; display field = the type's `displayField` (else code / name / title) |
| thumbnails, filmstrip, open | `GET /api/records/:type/:id/files/:field` → signed `/api/media/:id/:kind?exp=&sig=` URLs (server-relative) |
| review pull | `GET /api/review/:type/:id/:field` → `{rows, deleted, shots, seq}` → one package through Sight's own import (`/api/review/import`; its merge rules decide); shots this machine lacks downloaded once (data URLs in the package) |
| review push | the rows whose content here differs from Coreline's copy and was not sent as it is (`state.sent`: a hash of the content, stamps left out — Sight's import stamps rows itself) + tombstones → `POST …/merge {rows, deleted}` in batches (≤ 1000 rows / 8 MB); pictures the pushed rows name that Coreline lacks: `POST /api/uploads` → `PUT` chunks with `Content-Range` → `…/complete` → `PUT …/shots/<shot id> {file}` |
| authors | kept as written (Coreline keeps the free-text names Sight sends) |

State (`tracker_links.state`, per file): `{sent: {rowId: hash, "d:<id>": deleted_at}, shots: {id: "got"|"up"}, foreign, seq, last}`.

**The same Version on two files** (a local copy and the copy opened from Coreline): Sight's import gives a row whose id
another file holds a derived id (`sha1("anno-import:<asset>:<id>")[:16]`). The sync sees Coreline's rows missing here
under their own ids, records the derived ids in `state.foreign`, never sends them (they would be duplicates on
Coreline) and says so ("… are on another file in Sight already … sync that file instead").

**Not done (deliberately):** no Version upload; no realtime (WS) — a button; the phone app; a scaled `web` preview is
not synced (rows would need scaling between rendition and original units — `review-core.js transformItem` could do it
later); review state (`kind: "status"` rows) travels like any row, but Coreline's own Version `status` field is not
changed.

## To check on a real server (could not be done in the container)
- `sort: [{field: "createdAt", …}]` on `/api/query` (record meta, not a schema field): if refused, the adapter drops
  sort and columns for that server (unsorted list).
- The shape of `columns` in `/api/query` (sent as an array of field keys; a string / number value is shown).
- `entity:<type>.<display field>` with `is_not_null` for "Shots" / "Assets".
- The status lists' key in `/api/schema` (read as `statusLists` / `status_lists` / `statuses`, array or map).
- `POST /api/uploads/:id/complete`'s answer: the file id is read from `file.id`, `fileId` or `id`, else the upload id
  is sent to `PUT …/shots/:id`.
- That `GET /api/records/:type/:id/files/:field` is allowed with an API key for a file field the user can see.
- Width × height of a rotated phone video / an EXIF-rotated picture: Sync accepts the original's size either way round
  (Sight may store the shown orientation, Coreline the coded one).
- A Version whose media Coreline replaced by a file of another size: the link keeps the old size until the Version is
  picked again (CL ▾ → Link to another Version…) — Sync refuses meanwhile, naming both sizes.
- `GET /api/records/:type/:id` (one record): Open and Link read the Version with it. It is in Coreline's API.md list
  (Data), but if it answers otherwise, `POST /api/query` filtered by id is the fallback to write.
