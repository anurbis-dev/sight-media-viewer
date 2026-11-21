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

## Open questions (ask when the stage comes)
- Which Version fields the owner wants on the tiles (code + status + author by default?).
- Proxy cache size default.
