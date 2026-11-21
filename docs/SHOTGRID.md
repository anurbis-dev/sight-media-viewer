# ShotGrid link (Autodesk Flow Production Tracking)

Two-way sync of a review (a Sight asset, a phone review) with one ShotGrid **Version**: notes, replies, note
states and pictures. First tracker integration (PLAN-mobile decision 5, order changed by the owner on 2026-11-20:
ShotGrid first). Built in 0.99.0 against the REST API v1.1 **without a real site** (the container cannot reach
one): everything runs against a fake (`tests/sg_fake.cjs`). See "To check on a real site" below.

## Decisions (owner, 2026-11-20)

| Topic | Decision |
|-------|----------|
| Clients | Sight **and** the phone app in one go, one shared core (`app/static/shotgrid-core.js`). |
| Auth | **API script** (Admin → Scripts: script name + application key), `client_credentials`. Optional **post as the reviewer** (`sudo_as_login`) with a reviewer name → login table. No user / password (Autodesk Identity sites refuse it). |
| Scope v1 | Two-way: pull ShotGrid notes / replies / image attachments, push our notes (text, state, pictures with the drawings burned in) and replies. |
| Testing | Fake site in the tests; the owner checks on the studio's site. |

## Pieces

| File | Role |
|------|------|
| `app/static/shotgrid-core.js` | `SightShotGrid`: REST client (`createClient`), `loadVersion`, `linkedVersionOf`, `sync`, and `SightShotGrid.adapter` — the ShotGrid client adapter the generic UI uses (0.107; interface in trackers-core.js, docs/ARCHITECTURE.md "Tracker adapters"). Plain script (like review-core), Node-loadable. |
| `app/shotgrid.py` | Sight's server side — the ShotGrid adapter of `app/trackers.py`: config in `<SIGHT_HOME>/shotgrid.json` (0600; the key is never sent back, dropped when site / script change), the token (per sudo login), `forward()` for `…/fetch`. |
| `app/server.py` | `GET /api/trackers` (connected trackers), and per kind `/api/trackers/shotgrid/…` (0.107): `GET status`, `PUT config` (JSON only), `GET/POST/PUT/DELETE fetch?url=…[&sudo=]` (header `X-Sight: 1` required: no other site can use the key), `GET/PUT/DELETE link/{asset}`; the pre-0.107 `/api/sg/status`, `/api/sg/config`, `/api/sg/fetch`, `/api/sg/link/{asset}` … stay as aliases. `GET /api/annotations?asset_id=…&deleted=1` (tombstones too). |
| `app/library.py` | table `tracker_links(asset_id, tracker key, link JSON, state JSON, updated_at)` (0.107; a link is filed under `shotgrid:<host>` of the site configured now; the old `sg_links` rows were copied in once); `get_tracker_link / set_tracker_link / drop_tracker_link`. A new link starts a fresh state. |
| `app/static/index.html` | Settings → Trackers → ShotGrid (site, script name, key, post as reviewer, reviewer logins, note status codes, media cache limit / Clear cache; Test / Save / Disconnect — removes the key; since 0.108 made from the adapter's declarative form, `SightShotGrid.adapter.settings`, by the generic `bindTrackerForms`). Shown only while connected or being connected (*Connect a tracker…*); every ShotGrid control in the page shows only while `/api/trackers` lists it (docs/PLAN-trackers.md decision 10). |
| `app/static/annotate.js` | Review panel **SG ▾** (since 0.107 the generic link ▾ of each connected tracker, labelled by the adapter): link (Version from the notes, or project + search), Sync now, link to another, Unlink. |
| `mobile/js/trackers.js` | Phone (was shotgrid.js; generic over the adapters since 0.108): Settings → Trackers → *ShotGrid settings…* (the adapter's settings form: the same fields + **Proxy**), the home screen's ShotGrid page, *Export and more → ShotGrid…* (link / Sync / Unlink). |
| `app/static/tracker-source.js` | ShotGrid Versions in the library grid (0.102 as sg-source.js; tracker-neutral since 0.107, through the adapter): filter bar, Fields ▾ captions, filmstrip scrub, the inspector's fields, open (index.html `pullTrk`, `openTrkItem`, `toggleLight` / `showInLight` / `lightStep` hooks). Server side: `/api/trackers/shotgrid/thumb/{id}?pic=image|filmstrip&u=<updated_at>` (local Host only; disk cache; alias `/api/sg/thumb/{id}?kind=`), `POST …/open/{id}` (proxy → media cache → library file), `GET …/cache`, `POST …/cache/clear`; `ShotGridService.picture / fetch_media / make_room` (limit `cacheLimitGB`, 0 = Auto keeping 2 GB free; refused before deleting anything when eviction cannot help). |
| `tools/sg-proxy-worker.js` | Cloudflare Worker pass-through for the phone when the site does not answer browsers (CORS). Same protocol as `/api/sg/fetch`. |

### Transport
`createClient({site, script, key, via, serverAuth, headers})`. Every request may go through a proxy as
`via + encodeURIComponent(targetUrl)`. **Sight**: `via = "/api/trackers/shotgrid/fetch?url="` (`adapter.serverClient`; the old `/api/sg/fetch?url=` is the same route), `serverAuth: true` — the page never
holds the key or a token; the server adds `Authorization` for the site and nothing for other (https) hosts (signed
storage links); the sudo login goes as `&sudo=`. **Phone**: the core requests tokens itself (key in localStorage
`sight-review:sg`), directly or through the worker (`proxy` → `<proxy>/?url=`).

## Mapping

| Ours | ShotGrid |
|------|----------|
| asset / phone review | Version (`link = {site, project, version {id, code}, task, entity, firstFrame}`) |
| note | Note: `note_links = [Version]`, `tasks = [Version.sg_task]`, `project`, `content` = text, `subject` = `<author — >version code · frame N` (author only when not posting as the reviewer), `sg_status_list` = state through the code table (default `opn` / `ip` / `clsd`; a site that refuses the code gets the note without a status) |
| note pictures | Attachments named `sight-<noteId>-<n>.jpg`: the report's frames / views with the drawings burned in (Sight: `gatherReport(false, true)`; phone: report.js) + attached pictures. Re-uploaded (old `sight-<noteId>-*` deleted) when the note's drawings / pictures change (`picSig`). |
| reply | Reply (`entity` = the Note); text `Author: text` when not posting as the reviewer (stripped again on pull) |
| ShotGrid note | note row with id `idFor("<host>:note:<id>")` (stable on every client), author = user name, `edited_at` = `updated_at` |
| ShotGrid reply | reply id `idFor("<host>:reply:<id>")` |
| ShotGrid image attachment (not `sight-*`) | a note picture (shot id `idFor("<host>:att:<id>")`); `annot*.<frame>.png/jpg` names give the note a video frame (`ctx.t` from the Version's first frame) |
| frame number | `firstFrame + round(t · fps)` (`sg_first_frame`, else the start of `frame_range`, else 0) |

Ids on our rows (FORMAT.md): note `data.sg = {site, id, v}` (v = Version id), reply `sg = <Reply id>`. The merge keeps
them from either copy, so a `.srev` carries them to the other client: the phone syncing a review Sight already
sent creates no duplicates. A review whose notes carry `data.sg.v` offers that Version when linking.

### Sync (`SightShotGrid.sync`)
1. Read the Version's Notes, their Replies and Attachments.
2. **Pull** → one package merged by the host's own import (Sight `/api/review/import`, phone `mergeInto`):
   new ShotGrid notes; for linked notes the text (when changed on ShotGrid since this client last saw it), the state
   (when its code changed there), new replies / reply edits, new pictures. Conflicts follow the merge rules
   (content stamps): ShotGrid's `updated_at` against our `edited_at`.
3. **Push** what changed here since the last sync: new notes (+ pictures, replies), text / state changes, new /
   edited replies, changed pictures.
4. Stamp the new ShotGrid ids on the rows (a second import; the merge keeps `sg`).
5. The host saves `state` (per client: what it last saw / sent — `notes[id] = {sg, at, sgst, pushed, st, pics}`,
   `replies`, `last`): Sight in `tracker_links.state`, the phone in `reviews.meta.trk["shotgrid:<host>"].state` (before 0.108 `reviews.meta.sg.state`, still read).

**Not done (deliberately, v1):** deletes do not travel either way (a note deleted here stays on ShotGrid and is
not pulled back; one deleted on ShotGrid stays here); reply pictures / reply drawings are not uploaded; the
Version's own status and the review state row are not synced; no Version media download (the phone opens local
files only); no auto sync (a button).

## To check on a real site (could not be done in the container)
- `sudo_as_login` as a form field of the `client_credentials` token request (the fake accepts it; if the REST API
  wants it elsewhere, change `_token` in app/shotgrid.py and `token()` in the core).
- `Note.sg_status_list` codes of the studio (Settings → note statuses), `options[fields]` on create / update.
- The upload flow: `GET …/_upload?filename=` → `PUT links.upload` → `POST links.complete_upload {upload_info, upload_data}`.
- Attachment `this_file.url` (signed S3 link, or a site link that redirects — both handled).
- The `annot*.<frame>` naming of ShotGrid's own review annotations.
- CORS: whether the site answers the phone app's origin; if not, deploy `tools/sg-proxy-worker.js`.
- The filter builder's hash filters (0.103.0, the adapter's `toConditions`, was filter-core's `toSgConditions`): `Content-Type: application/vnd+shotgun.api3_hash+json`,
  `{filters: {logical_operator, conditions: [{path, relation, values}]}}`; `name_contains` / `name_is` /
  `name_not_contains` on entity fields, `is` / `is_not` with `[null]` for empty, `in_last [n, "DAY"]`, `between` on
  date_time with ISO strings; `properties.valid_values` / `display_values` in `/schema/versions/fields`.

**Owner 2026-11-21:** the media cache's files show in the library's All and type filters like every source's files (the viewer's shared logic); only the cache source's row is hidden from Sources.
