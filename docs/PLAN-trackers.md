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
| 5 | Cache | Version thumbnails on disk in SIGHT_HOME like file thumbnails, refreshed by the Version's `updated_at`. Proxies in their own cache with oldest-first eviction over a size limit (Settings). |

## Stages

### 1. User button and logins panel — done in 0.100.0 (see RECENT)
- As built: Sight's sidebar header and the review panel show the same person button (initials once a name is set) → panel: reviewer name, ShotGrid row (status, Set up… / Settings… opens Settings → ShotGrid, the fields stay there). Phone: the person button on the home bar → sheet (name, ShotGrid connection).
- Sidebar header: person icon (initials when a name is set). Panel: name field; ShotGrid row (status from
  `/api/sg/status`, *Set up…* opens today's Settings → ShotGrid fields here instead); room for more trackers.
- Review panel: the `.an-who` field goes; the icon opens the same panel. Phone: the same panel (name + ShotGrid connection).
- Touch: the icon is a button; the panel is a popover on desktop, a bottom sheet on the phone.

### 2. ShotGrid as a source (Sight)
- Sources list gets a tracker row per connected site; expand → projects (`client.projects()`), cached, refresh button.
- A project in the grid: Versions as virtual assets (no file on disk): code, entity, task, status, author, date,
  thumbnail (`image` field — a signed URL; downloaded once into `<SIGHT_HOME>/sg_thumbs/<site>/<version id>.jpg`,
  re-fetched when `updated_at` changes). Paged loading (500 per page) as the grid scrolls.
- Server: `/api/sg/versions?project=&filter=…&page=` (the server holds the key) and `/api/sg/thumb/{id}`.
- Double-click: proxy download (`sg_uploaded_movie`, else `image`) into `<SIGHT_HOME>/sg_media/`, registered as an
  asset under a hidden "ShotGrid cache" source, linked (`sg_links`) to the Version, opened in the lightbox.

### 3. The filter builder
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
