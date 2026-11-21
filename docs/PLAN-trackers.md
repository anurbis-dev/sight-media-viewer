# Plan — trackers inside the library: user / logins, tracker sources, field filter

Decided with the owner on 2026-11-20, after the first ShotGrid link (0.99, docs/SHOTGRID.md). Take a stage, do it,
mark it done here, add the RECENT entry as usual.

## Decisions (do not re-ask)

| # | Topic | Decision |
|---|-------|----------|
| 1 | Who am I | A **user button** (person icon) in the sidebar header opens a panel: the reviewer name (as now, no login needed) and a row per tracker — logged in / log in / log out (ShotGrid first, then Coreline, ftrack). The review panel loses its name field: the same icon there opens the same panel. Phone: the same panel from the reviews screen. |
| 2 | Tracker as a source | A connected tracker appears in the sidebar **as a source** (ShotGrid · site), its **projects nested** under it. A project shows its **Versions** in the grid (flat), narrowed by the filter (decision 4) and grouped by entity / task when asked — no Sequence → Shot tree. |
| 3 | Opening a Version | Double-click: the Version's **web proxy** (uploaded movie / image) downloaded into Sight's cache and opened in the lightbox, the review already linked to that Version (docs/SHOTGRID.md). |
| 4 | Filter | **One filter builder for every source**: conditions on fields — tracker fields (entity type, entity, task, status, author, date, any field of the Version) for tracker sources, kind / tags / date / name for local files. Presets saved. |
| 5 | Cache | Version thumbnails on disk in SIGHT_HOME like file thumbnails, refreshed by the Version's `updated_at`. Proxies in their own cache with oldest-first eviction over a size limit (Settings). **Owner 2026-11-21:** the limit's default is **Auto** = download while the disk has room. |
| 6 | Tile fields | **Read from ShotGrid** (the Version schema); a **Fields ▾** button lets the user pick which fields the tiles show. |
| 7 | Filmstrip | Like ShotGrid: a video's filmstrip thumbnail plays under the pointer on hover (a finger dragged sideways on touch). |
| 8 | Filter UI (owner 2026-11-21) | A **popup on a button** (Filter ▾ in the top bar), conditions field · operator · value in **AND / OR groups**; one builder for the library and ShotGrid; the phone gets the same as a sheet. |
| 9 | Presets | **Smart collections in the sidebar**: a saved filter is a row under Collections (a ShotGrid one under its project); a click applies it; rename by double-click like collections. |
| 10 | Visibility (owner 2026-11-21) | **Tracker UI shows only for a connected tracker.** Not connected = no trace of it: no sidebar source, no row in the You panel, no SG ▾ in the review panel, no ShotGrid tab / "ShotGrid…" item on the phone, no tracker fields in Filter ▾. The one place that offers connecting is Settings → Trackers (*Connect a tracker…*; on the phone its settings sheet). |
| 11 | Several trackers (owner 2026-11-21) | **Several trackers can be connected at once, with one UI for all.** Structurally they are the same: tables of entities and their fields, plain ones and link entities that tie entities together. So the UI is generic over a tracker adapter (entities, fields / schema, links, versions-like media entities, notes); ShotGrid is the first adapter, ftrack / Coreline etc. plug into the same sidebar source rows, Filter ▾ fields, tile Fields ▾, You-panel rows, review-panel link & sync, phone pages. No ShotGrid-only UI paths in new code. |

## Stages

### 1. User button and logins panel — done in 0.100.0 (see RECENT)
- As built: Sight's sidebar header and the review panel show the same person button (initials once a name is set) → panel: reviewer name, ShotGrid row (status, Set up… / Settings… opens Settings → ShotGrid, the fields stay there). Phone: the person button on the home bar → sheet (name, ShotGrid connection).
- Sidebar header: person icon (initials when a name is set). Panel: name field; ShotGrid row (status from
  `/api/sg/status`, *Set up…* opens today's Settings → ShotGrid fields here instead); room for more trackers.
- Review panel: the `.an-who` field goes; the icon opens the same panel. Phone: the same panel (name + ShotGrid connection).
- Touch: the icon is a button; the panel is a popover on desktop, a bottom sheet on the phone.

### 2. ShotGrid as a source (Sight) — done in 0.101.0 (see RECENT)
- As built: "ShotGrid · <site>" is the last row of Sources (expand → projects); a project opens the ShotGrid view (app/static/sg-view.js) in the main area instead of the grid — All / Shots / Assets / Sequences, entity, status, name, Fields ▾ (schema fields, ticked order, `sight.sg.fields`), tiles at the library's tile size, infinite scroll; thumbnails / filmstrips from `/api/sg/thumb/{id}` (disk cache `<SIGHT_HOME>/sg_cache/thumbs/<host>/`), double-click / Enter / a tap opens via `POST /api/sg/open/{id}` (proxy streamed into `sg_cache/media/<host>/<stem>__v<id>.<ext>`, a library source the sidebar hides, indexed with `_touch_one`) then links the review and opens the lightbox. Cache limit: Settings → ShotGrid → Media cache limit (empty = Auto, 2 GB kept free), Clear cache. No Version paging in the sidebar itself, no grouping by entity / task yet (the filter builder, stage 3, comes next).
- Sources list gets a tracker row per connected site; expand → projects (`client.projects()`), cached, refresh button.
- A project in the grid: Versions as virtual assets (no file on disk): code, entity, task, status, author, date,
  thumbnail (`image` field — a signed URL; downloaded once into `<SIGHT_HOME>/sg_thumbs/<site>/<version id>.jpg`,
  re-fetched when `updated_at` changes). Paged loading (500 per page) as the grid scrolls.
- Server: `/api/sg/versions?project=&filter=…&page=` (the server holds the key) and `/api/sg/thumb/{id}`.
- Double-click: proxy download (`sg_uploaded_movie`, else `image`) into `<SIGHT_HOME>/sg_media/`, registered as an
  asset under a hidden "ShotGrid cache" source, linked (`sg_links`) to the Version, opened in the lightbox.

### 3. The filter builder (+ the ShotGrid view onto the library grid)
- **3a done in 0.102.0** (see RECENT): Versions are items of the library grid (`sgList`, `pullSg` paging as the grid nears its end, `sg-source.js`); sg-view.js is gone.
- **3b done in 0.103.0** (see RECENT): Filter ▾ in the top bar → popup builder (app/static/filter-core.js): rows field · operator · value, All / Any, nested groups (3 levels); library fields evaluated by the server (`where_sql`), ShotGrid Version fields sent as REST hash filters (`logical_operator` and / or — the REST counterpart of `filter_operator` all / any). The ShotGrid bar's quick filters (type / entity / status) stay and are ANDed with it. Next: 3c (saved filters = smart collections), 3d (the phone sheet; filter-core.js is a plain script ready for build_pwa).
- **3c done in 0.104.0** (see RECENT): smart collections — *Save as smart collection…* in Filter ▾; library ones under Collections, ShotGrid ones under their project; a click opens it, Filter ▾ then edits its rule; rename by double-click, × deletes, icon by right-click. Next: 3d (the phone sheet).
- **3d done in 0.106.0** (see RECENT): the phone's ShotGrid page has a *Filter* button → a bottom sheet with the same builder (core/filter-core.js shipped by build_pwa; `mountBuilder`, `sgFields`, `toSgConditions` reused, nothing duplicated), ANDed with the quick filters, kept per project (`sight-review:sgwhere`). Smart collections stay Sight-only: they live in the desktop's library DB, which the phone (talking to ShotGrid directly) cannot reach — no phone-local saved filters. Desktop Filter ▾ checked at 390 px on touch: usable as is.
- Blocks, each reviewed on its own: **3a** the ShotGrid view on the library grid; **3b** the filter builder (popup, AND / OR groups; library fields evaluated by the server, ShotGrid fields sent as `_search` filters with `filter_operator` all / any); **3c** smart collections; **3d** the phone.
- **Owner 2026-11-21:** in this stage the ShotGrid view moves onto the library's own grid (a pluggable item source: library rows / ShotGrid Versions — shared virtualisation, tile size, layout, selection, keys; the inspector shows a Version's fields) and app/static/sg-view.js goes.
- A row of conditions above the grid: field ▾ · operator ▾ · value (chips for statuses / entities read from the
  site's schema: `/schema/{entity}/fields`), AND between rows; saved presets per source type.
- Tracker sources: conditions go to ShotGrid as `_search` filters. Local sources: the same UI on library fields
  (kind, tags, rating, date, name, folder) evaluated by the library query.

### 4. Phone — browser done in 0.100.0 (owner asked for it with stage 1)
- As built: the home screen has two pages, Reviews | ShotGrid (tabs in the bar; a swipe sideways anywhere but on a review card). ShotGrid page: project · All / Shots / Assets / Sequences · entity · status · name filter (kept in localStorage `sight-review:sgfilter`), Versions newest first in pages of 60, thumbnails in Cache Storage `sight-review-sgthumbs` keyed by Version id + updated_at; a Version with a review here is outlined; a tap opens that review (media kept) or downloads the web proxy (`sg_uploaded_movie`, else the thumbnail picture), opens it as a review linked to the Version and keeps the file on the device.
- Reviews screen: the user panel (stage 1), a ShotGrid tab with projects → Versions (thumbnails cached in
  IndexedDB), opening a Version downloads its proxy (decision 3 of PLAN-mobile: proxy by default, original on a button).

### 5. Trackers: only when connected, several at once (decisions 10, 11)
- **5a done in 0.105.0** (see RECENT): `GET /api/trackers` lists the connected trackers (ShotGrid: site + script + key,
  `ShotGridService._connected`); the page's `trackers` / `trackerOn` / `refreshTrackers` and the phone's
  `trackers()` / `trackerOn` gate the sidebar source, the You panel / person sheet rows, SG ▾, the phone's ShotGrid
  tab + swipe and its review's *ShotGrid…*; `sight-trackers` on window repaints live. Settings → Trackers (both apps):
  connected trackers (site, state, settings, Disconnect = key removed) + *Connect a tracker…*. Next: 5b (the adapter).
- **5a** visibility: hide every tracker control while it is not connected (today visible regardless: the You panel's
  "ShotGrid · not connected / Set up…" row, the review panel's SG ▾, the phone's ShotGrid tab, its person sheet's
  ShotGrid block, the review "More → ShotGrid…" item); Settings → ShotGrid becomes Settings → Trackers with a list of
  connected trackers + *Connect a tracker…* (the only entry point while none is connected). Re-check on connect /
  disconnect without a reload.
- **5b done in 0.107.0 (first part, 5b-1; see RECENT):** the adapter interface written down (docs/ARCHITECTURE.md
  "Tracker adapters"; server `app/trackers.py`, client `app/static/trackers-core.js`), ShotGrid implements both
  (`ShotGridService`, `SightShotGrid.adapter`). Server: registry `Trackers`, generic routes `/api/trackers/{kind}/…`
  (the `/api/sg/…` ones stay as aliases), links per tracker key (`tracker_links`, `sg_links` copied once), smart
  collections filed under a tracker key (`collections.tracker` / `tracker_project`, `sg_site` rows migrated, old POST
  form still read). Sight's page: a sidebar source row per connected tracker, the item source (tracker-source.js, was
  sg-source.js), smart collections, Settings → Trackers blocks, the You panel, and annotate.js's link ▾ (one per
  connected tracker) all go through the tracker list + adapter; no ShotGrid-only path left there except ShotGrid's own
  settings form. Phone: the tracker list entries carry kind / key, kinds from the registry, per-kind settings sheet.
- **5b-2 (1, 3, 5) done in 0.108.0** (see RECENT): (1) the phone's tracker home pages (`trackerBrowser`, a tab per
  connected tracker) and the review link sheet (`trackerSheet`) go through the adapter (mobile/js/trackers.js, was
  shotgrid.js; no tracker named there); a review's link is kept per tracker key in `reviews.meta.trk` (`meta.sg` of
  older reviews still read and folded in at the next link change); the phone's storage names kept through
  `storeKey(name, "phone")`. (3) a declarative settings form per adapter (`adapter.settings`, one renderer
  `SightTrackers.mountForm` for Sight's Settings → Trackers and the phone's settings sheet; ShotGrid's status codes as an
  adapter-provided custom section). (5) `sgFields` / `toSgConditions` moved into the ShotGrid adapter (`filterFields` /
  `toConditions`); filter-core.js keeps only the generic builder.
- **5b-2 (remains):** (2) the review rows' tracker ids: `data.sg` / reply `sg` (FORMAT.md) are ShotGrid's own — a
  second adapter needs its own row key and merge rule in both `Library.import_annotations` and review-core.js
  (decide with 5c); (4) several sites of one kind (the key allows it; each adapter keeps one configuration, the phone
  one connection per kind).
- **5b** the adapter: a tracker-neutral interface (connect / status, projects, entity types, schema fields incl.
  link fields, browse media entities with filters, thumbnails, media download, notes sync) that sg-source.js /
  shotgrid-core.js implement; index.html, annotate.js and the phone talk to "the trackers" (a list), keyed by
  tracker id + site — sidebar rows, smart collections (`sg_site` → a tracker key), links per tracker.
- **5c** a second adapter proves the interface. **Owner 2026-11-21:** it will be **Coreline**, but Coreline is not ready for integration yet — **deferred**; do not start 5c until the owner says so.

## Open questions (ask when the stage comes)
- Which Version fields the owner wants on the tiles (code + status + author by default?).
- Proxy cache size default.
