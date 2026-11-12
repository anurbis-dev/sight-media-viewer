# Plan — mobile review app, drawing, tracker sync

Decided with the owner on 2026-11-11 (one question at a time). This is the plan for the next
sessions; take a stage, do it, mark it done here and add the RECENT entry as usual. Do not start a
later stage before the earlier ones it depends on.

## Decisions (do not re-ask)

| # | Topic | Decision |
|---|-------|----------|
| 1 | Devices | **All**: iPhone, iPad (Apple Pencil: pressure, "pencil draws, finger pans"), Android. One web code base, shipped as a **PWA** (decision 13). |
| 2 | Video in reviews | The **HTML page** keeps only the sent frames (drawing on those). The **app** plays the video itself (a local file now; later a download from a tracker / cloud) and can draw on any frame. Downloaded files need **cleanup** (see Cache). |
| 3 | What is downloaded | *(trackers / clouds, later stages)* A **proxy** by default (Sight writes it next to the `.srev` on export: H.264 720p/1080p); the **original on a button** (check first that the device can play it, warn before downloading). |
| 4 | Clouds | **Later** (changed 2026-11-11): after every tracker. Google Drive first, then Dropbox, behind one storage interface. |
| 5 | Trackers | **Changed 2026-11-11: all tracker work comes after the local app.** First the owner's **own tracker — Coreline** (working repository `anurbis-dev/CueTrack`; it stores vectors like Sight), then **ftrack** (two-way), then **ShotGrid**. |
| 6 | Drawing on a reply | **Vector**, linked to the reply. A flat picture is generated **only** when sending to an external tracker (ftrack / ShotGrid). |
| 7 | Scope of the app | **Now (changed 2026-11-11): local files on the device**, phones first — pick a file (image / video / 3D) from the device, review it from scratch (notes, drawings, states), export. Opening tracker versions / cloud files comes with those stages. |
| 8 | Offline | **Fully offline**: the app works on local files without network; reviews live on the device. Edits made on reviews that came from Sight / a tracker merge back with the same rules as Sight. |
| 9 | 3D | **Full 3D in the app right away**: glTF/GLB downloaded, orbit, notes on new views, drawing over a view (same `ctx.vk` / `cam` as Sight). To check: ftrack has no 3D viewer as far as known — then the model goes as a version component and notes to ftrack as flat pictures of the view. |
| 10 | Order | See Stages. Changed 2026-11-11: local app first, then Coreline, then ftrack / ShotGrid, clouds last. |
| 11 | Builds | **GitHub Actions builds every platform**: Sight (Windows / macOS / Linux, as now) and the app — the PWA deployed to **GitHub Pages**; an Android APK (Capacitor) is optional. |
| 12 | Distribution | **A link to the GitHub Pages PWA** for clients (Sight builds stay on GitHub Releases); App Store / Google Play only if it comes to that. |
| 13 | iPhone | **PWA, not a signed app**: open the link in Safari → Share → *Add to Home Screen*; runs full-screen, offline (Service Worker), updates itself. No Apple account or signing needed. Capacitor / stores only as a fallback if Safari limits block us. |
| 14 | Export from the app | **PDF and HTML as plain viewing formats**, not interactive: anyone opens them anywhere (the note list, frames / views with the drawings burned in, replies, pictures). For a round trip with Sight the app also writes / reads `.srev`. Sight's interactive HTML reviewer page (0.17–0.21) stays as it is. |
| 15 | Technical debt | **Fix the queued items of `docs/PLAN.md` first** (bugs, startup, grid, 3D, tooling) so debt does not pile up — before stage 3. |

Also decided: **Sight is the desktop client of the owner's tracker**, so the annotation format is a
shared contract between Sight, the app and that tracker. Sight as a system-wide quick viewer is a
separate plan: `docs/PLAN-viewer.md`.

## Stages

### 1. Shared annotation format + shared JS core — done in 0.20.0 (see RECENT)
- Write `docs/FORMAT.md`: a versioned JSON schema for everything a review carries — asset identity
  (id, name, size, kind, versions), notes (`text, author, created, status open|progress|done,
  status_at, edited_at, shots, replies, from`), replies and status events, drawings (`stroke`
  brush|pencil|marker with `pts [x,y,p…]`, `shape` rect|ellipse|line|arrow, `text`, `pin`; doc
  units = media pixels; 3D = host screen space 1000 high), `ctx` (video `{t, hold}`, 3D `{vk, cam}`),
  status rows with history, tombstones (`deleted`), shots. Today this lives only in
  ARCHITECTURE.md "Annotations / review" and in code; the `.srev` package is format version 1.
- **New field:** a drawing on a reply carries `data.reply = <reply id>` besides `data.note`
  (decision 6). Sight shows / hides such drawings with the reply; older Sight just shows them.
- Extract into one module (e.g. `app/static/review-core.js`, no build step, plain ES so it can be
  inlined): primitive building + SVG / canvas rendering (`primsOf`, `primSvg`, `primCanvas` from
  annotate.js), stroke outline from pressure, the merge rules (port `Library.import_annotations`,
  `merge_replies`, `merge_history`, `_content_at` to JS — the app and the HTML page merge offline
  edits themselves). Sight's annotate.js uses it; `review.py` inlines it into the HTML page.
- Keep a test that runs the Python and the JS merge on the same fixtures and compares the results
  (the scratchpad `t_merge.py` from the 0.17–0.19 sessions is the starting point).

### 2. Drawing on the HTML page — done in 0.21.0 (see RECENT)
- Export **clean frames** (no burned-in drawings) + the drawings as vectors; the page renders them
  with the core, can show / hide them (own vs others).
- Full-screen drawing canvas from a note frame / the cover / an attachment: brush with pressure,
  marker, arrow, rect, ellipse, eraser, 5 colours, undo / redo; two-finger pinch-zoom / pan; with
  a pen, "pen draws, finger pans" (`pointerType === "pen"`).
- New note with a drawing → `stroke` / `shape` rows with `data.note` and the note's `ctx`; drawing
  on a reply → `data.reply` as well. Page coords → doc coords by `native width / frame width`
  (frames are the whole media scaled to ≤1600 px; 3D views map to the 1000-high screen space by
  the shot's aspect). Downloaded `.srev` carries the rows; Sight's import already merges drawings.
- The swipe viewer (0.19.3, `zoom(gal, at)`) stays the way pictures are viewed; drawing is a
  separate button/mode, not a gesture in the viewer.

### 3. The app — local review on the device (PWA on GitHub Pages; phones first) — done in 0.23.0 (see RECENT)
- Answered 2026-11-12: **images + video only** for now (PSD / PDF pages later); the PDF is made of
  **pages drawn as pictures** (canvas with the device's fonts, one JPEG per page, own writer) —
  no bundled font, any script works, text is not selectable.
- Left to check on a real iPhone / iPad / Android (could not be done in the container): install
  from Safari, Photos / Files pickers (names, HEIC → JPEG), H.264 / HEVC playback and frame grabs
  in the hidden `<video>`, Pencil pressure, Web Share *Save to Files*, storage persistence,
  the update banner.
- Served from GitHub Pages (a workflow builds and deploys it from this repo); web app manifest +
  Service Worker: installable (*Add to Home Screen* on iOS), works offline, updates on the next
  launch (show "new version — reload"). Built on `review-core.js` (rendering, merge) and the HTML
  page's drawing canvas (move `drawSheet` into the core or a shared file instead of copying it).
- **Open a local file**: `<input type="file">` (iOS: Photos / Files; Android: any picker); no
  upload anywhere. Images, video (whatever the device can play — iPhone: H.264 / HEVC; warn
  otherwise), PSD only if a preview is cheap (else later). The asset identity (FORMAT.md) is made
  on the device: name, size, kind, width / height / duration, id = hash of name + size (+ mtime
  when the picker gives it), so a `.srev` from the app matches the same file in Sight by name + size.
- Review from scratch: notes, replies, states, drawings on any video frame (frame stepping,
  timecode; ±1 frame is acceptable), reviewer name like the HTML page.
- Local-first store: IndexedDB for reviews, rows, shots; the picked file itself is not copied
  unless the user asks (iOS gives no lasting file handle: re-pick the file to reopen a review —
  match it by name + size; offer "keep a copy on this device" with the size shown). Call
  `navigator.storage.persist()`.
- **Export** (decision 14): **PDF** (the same content as Sight's PDF report: cover, every note with
  its frame and drawings burned in, replies, pictures) and **static HTML** (one self-contained file,
  no scripts needed to read it), shared through the Web Share API (*Save to Files*, messengers) or
  a download. Also **`.srev`** export / import for the round trip with Sight.
  PDF on the device: decide between a bundled JS PDF writer (needs an embedded font for Cyrillic /
  CJK) and the browser's print-to-PDF of the static HTML (no control of page breaks on iOS) —
  prototype both on an iPhone first.
- iOS facts to design around: home-screen web apps are exempt from Safari's 7-day storage wipe;
  **no Web Share Target** (cannot receive a file from Telegram's share sheet — open it via the file
  picker / Files instead); Web Share API *sending* files works; Pointer Events give Pencil pressure.
- Fallback only if Safari blocks something essential: wrap the same code in Capacitor (needs Apple
  signing for iOS, see the history of decision 12).

### 4. 3D in the app
- three.js + GLTFLoader (as in Sight), same camera rig maths, notes on new views, drawing over a
  view; GLB / glTF picked from the device like any other file.

### 5. Coreline — the owner's tracker (repository `anurbis-dev/CueTrack`)
- The first integration. It stores vectors natively like Sight (decision 6), so it speaks
  FORMAT.md directly; Sight (and the app) become its clients. Read the CueTrack repo first: its
  API, auth, data model; then map asset / version, notes, replies, states, drawings.

### 6. ftrack (two-way)
- **First check CORS**: whether the customer's ftrack server answers a browser request from the
  GitHub Pages origin (preflight with `ftrack-user` / `ftrack-api-key` headers). If not, the PWA
  needs a tiny pass-through proxy (e.g. a Cloudflare Worker that only forwards, stores nothing);
  Sight (desktop, its own server) can call ftrack directly either way. Same check for ShotGrid.
- Native connection from the client to the ftrack REST API (`https://<site>.ftrackapp.com/api`,
  POST of JSON operations), no middle server. ftrack authenticates **user + API key**, not a
  password: do the login like ftrack Connect — the user signs in on their ftrack site in a browser,
  the app receives the personal API key and stores it in the OS keychain / keystore. To confirm
  with the owner and on the customer's site.
- Map: our asset ↔ AssetVersion (and its Task); note ↔ ftrack Note (with `frame` / note
  components for pictures); reply ↔ Note reply; states ↔ ftrack statuses through a **per-site
  mapping table** (open / progress / done ↔ the studio's own status names). Drawings go as
  generated flat pictures (decision 6). Keep the ftrack ids next to ours to sync both ways.
- Proxies for review come from the version's web-playable components (ftrack-review-mp4 /
  image); the app's **cache** of downloaded proxies / originals is cleaned when a review is closed /
  sent and by oldest-first eviction over a size limit (*Clear downloads* shows the space used).
- Sync is the same merge: pull ftrack notes into our rows, push our new / edited rows; conflicts by
  the same stamps. ftrack 3D support: check (decision 9).

### 7. ShotGrid
- ShotGrid REST API: login with user + password is allowed (`grant_type=password`) unless the site
  uses SSO (then browser login / script keys). Note ↔ Note on Version, pictures ↔ Attachments,
  state ↔ `sg_status_list` through the same per-site mapping table.

### 8. Clouds — Google Drive, then Dropbox
- One storage interface. OAuth on the device; a project folder holds `.srev` files + proxies;
  Sight writes the proxy on export (`ffmpeg` is already bundled) and can push / pull the `.srev`
  there. Review from scratch on any file in the folder.

## Open questions (ask when the stage comes)
- ~~Stage 3: which formats besides image / video matter on the phone first~~ — answered: none yet.
- Only if the PWA hits a Safari limit: iOS signing / Apple Developer account for a Capacitor build.
- Coreline: where it runs (URL), how clients authenticate.
- CORS on ftrack / ShotGrid → proxy or not; ftrack login flow and the status names on the
  customer's site; whether 3D is viewable there.
