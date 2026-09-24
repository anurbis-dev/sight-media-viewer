# Sight — fix plan (bugs, security, performance)

Audience: a coding agent (Claude Code). Findings come from a read-through of `app/library.py`,
`app/server.py`, `Sight.py` and the client code in `app/static/index.html` (repo state of 2026-09-23).
Locate code by function name, not line number. Items marked **[verified]** were reproduced in isolation
(SQLite/JSON behaviour); the rest are from reading the code and need a test before and after the fix.

## Ground rules (from `CLAUDE.md` — re-read it first)

- Read `docs/RECENT.md` and `docs/ARCHITECTURE.md` before touching code. Code, comments, UI strings and
  docs are English.
- Other agents may edit the repo in parallel: re-read a file right before editing, make targeted edits,
  never revert changes you don't recognise. **Do not commit or push unless the user asks.**
- After each finished phase: add an entry at the top of `docs/RECENT.md`, bump `APP_VERSION`
  (patch = fix, minor = feature), run `python tools/archive_changes.py`. Update `docs/ARCHITECTURE.md`
  only if a stable fact changed (e.g. read connections, new endpoint).
- Never test against the real library. Use a temp `SIGHT_HOME` and create/delete your own data.
- Backend `.py` changes need a server restart; frontend files are live on refresh.
- Schema changes must be additive and idempotent (`Library._migrate()`); data rewrites are guarded by
  `PRAGMA user_version` (check first whether it is already used) and run in one transaction.
- Work in the order below. One phase = one reviewable change set.

## Phase 0 — test harness and benchmark (do first)

1. `tests/` with pytest tests that exercise `Library` directly (no server): fixture creates a temp
   `SIGHT_HOME`, a temp source folder with tiny generated files (PIL images, text files), a `Library`
   instance, and cleans up. Dev-only; do not include in the PyInstaller builds. Ask the user before adding
   `pytest` to any requirements list; prefer documenting `pip install pytest` in `tests/README.md`.
2. `tools/bench_library.py`: builds a synthetic library (default 200k `assets` rows, some with tags) in a
   temp `SIGHT_HOME` and times `list_assets` (first page, deep offset, each sort key), `count_filtered`,
   `tags()`, `/api/state`-equivalent, and a text search. Print a table. Record the "before" numbers in the
   RECENT entry; re-run after Phase 4.

## Phase 1 — correctness bugs (user-visible)

### 1.1 Case-insensitive search and sort for non-ASCII text **[verified]**
- Problem: SQLite `lower()` and `COLLATE NOCASE` only fold ASCII. `instr(lower(name), 'фото')` does not
  match `Фото…`. Affects `_clause` (name/note/tags), `_SORT_EXPR` (`name COLLATE NOCASE`,
  `lower(json_extract(tags,'$[0]'))`), `strip_tag`/`rename_tag` (`lower(name)=?` on `tag_order`/`tag_meta`),
  `resolve_model_resource` (`COLLATE NOCASE`).
- Change: register on every SQLite connection (see 4.1 — a helper `_setup_conn(conn)` used for all of
  them): `create_function("ulower", 1, fn, deterministic=True)` with `fn = lambda s: s.lower() if isinstance(s, str) else s`,
  and a collation `UNOCASE` comparing `a.lower()` / `b.lower()`. Replace the uses listed above. The needle
  side keeps using Python `.lower()` so both sides fold identically.
- Test: assets named `Фото кота.jpg`, `PHOTO.JPG`; queries `фото`, `Фото`, `photo` all match the right rows;
  sort by name orders Cyrillic case-insensitively.

### 1.2 Non-ASCII tags are stored escaped and filter by substring **[verified]**
- Problem: `json.dumps(tags)` (in `patch_asset`, `strip_tag`, `rename_tag`) writes `["\u043f…"]`, so
  `tags LIKE '%пейзаж%'` (tag filter) and `instr(lower(tags), …)` (search) never match Cyrillic tags.
  The tag filter is also a substring match: tag `art` matches `["cart"]`; `%`/`_` in tag names act as
  LIKE wildcards.
- Change:
  1. One helper `dump_tags(list) -> str` using `json.dumps(..., ensure_ascii=False)`; use it everywhere
     tags are written.
  2. One-time migration (guarded by `user_version`): rewrite rows whose `tags` contains `\u` to the
     unescaped form, in one transaction. Take a copy of `library.db` next to it first
     (`library.db.bak-<version>`), skip the copy if one exists.
  3. Tag filter in `_clause`: replace `tags LIKE ?` with
     `EXISTS (SELECT 1 FROM json_each(assets.tags) WHERE ulower(value) = ?)` (exact, case-insensitive —
     same semantics as `strip_tag`/`rename_tag`).
- Test: tags `["пейзаж"]`, `["cart"]`, `["Art"]`; filter `пейзаж`, `art`, `ART` return exactly the right
  assets; round-trip through `patch_asset` keeps Cyrillic readable in the DB; migration converts an old
  escaped row and is a no-op on a second run.
- Note (do not change silently): `tags()` counts tags case-sensitively while strip/rename are
  case-insensitive. Mention this in the RECENT entry as an open question for the user.

### 1.3 Thumbnails ignore EXIF orientation **[from code]**
- Problem: `_thumb_image` never applies EXIF orientation, and the saved JPEG has no EXIF, so portrait
  phone photos get sideways thumbnails, and stored `width/height` are the raw (unrotated) size, which
  breaks the masonry aspect ratio.
- Change: in `_thumb_image` (and the PIL fallback in `_thumb_psd`): read orientation via
  `im.getexif().get(0x0112, 1)`; after `im.thumbnail(...)` call `ImageOps.exif_transpose(im)` before
  saving; report `width, height` swapped when orientation ∈ {5,6,7,8}. Check HEIC via `pillow_heif` with a
  real sample: it may already apply orientation, and then it must not be applied twice.
- Existing thumbnails: one-time background pass (guarded by `user_version`) that reads only EXIF
  orientation of JPEG/TIFF/WebP/HEIC assets and re-queues thumbnail + fixes `width/height` for those with
  orientation ≠ 1. Must not block startup and must run at low priority (`PRI_PREFETCH` or lower).
- Test: generate a JPEG with orientation 6 and a known size; thumbnail is upright, reported size is
  swapped; orientation 1 is unchanged.

### 1.4 Rescan never revives `missing` files **[from code]**
- Problem: in `scan_source`, `existing` is built from `SELECT id, path, mtime, size, status` but the
  status is dropped, and `if prev and same mtime/size: continue` skips the row. A file that returned
  unchanged stays `status='missing'` after a rescan (the live watcher's `_touch_one` does revive it, the
  scan does not — inconsistent). Happens when a folder/drive comes back while Sight was closed.
- Change: keep the status in `existing`; when an unchanged file has status `missing`, collect its id and
  `executemany("UPDATE assets SET status='ready' WHERE id=?")` at the end of the scan, then publish a
  `batch` event. Do not touch `excluded`.
- Decision for the user (implement only if they agree): guard against an empty mount point — if the source
  root exists, `seen` is empty and `existing` is not, skip the "mark missing" step and log it.
- Test: scan 3 files; move one out, rescan → `missing`; move it back with the same mtime (`shutil.move`
  keeps it), rescan → `ready`; `excluded` rows untouched.

### 1.5 `copy_asset` overwrites existing files silently **[from code]**
- Problem: `target = dest / a["name"]` then `shutil.copy2` — an existing file with the same name is
  overwritten; copying into the asset's own folder raises `SameFileError` (returned as a 400).
- Change: if `target` exists, pick `name (1).ext`, `name (2).ext`, …; return the final path. Keep
  `mkdir(parents=True)` behaviour.
- Test: copy twice into the same folder → two files; copy into own folder → `name (1).ext`.

## Phase 2 — local-server security (prerequisite for the quick-view work)

Problem: no `Host`/`Origin` checks and `json_body()` ignores `Content-Type`. Any web page can send
"simple" cross-site POSTs to `127.0.0.1:<port>` (add source, purge missing, install-ffmpeg, copy asset,
open native folder dialog), and DNS rebinding lets a page also *read* responses (files via
`/api/file/{id}`, directory listings via `/api/fs/list`).

Changes in `build_app`:
1. `TrustedHostMiddleware` allowing `127.0.0.1`, `localhost`, `[::1]` (kills DNS rebinding).
2. Middleware for `POST/PUT/PATCH/DELETE`: reject (403) if `Sec-Fetch-Site: cross-site`, or if an `Origin`
   header is present and is not `http://127.0.0.1:<port>` / `http://localhost:<port>` (port from config —
   pass it into `build_app`).
3. Defence in depth, last and only after grepping every client `fetch` (`index.html`, `canvas.js`): make
   `json_body` respond 415 when `Content-Type` is not `application/json`. Exceptions to keep working:
   `POST /api/thumb/{aid}` (raw image bytes) and body-less POSTs such as `/api/heartbeat`.
4. Per-run random token is **not** part of this phase; it belongs to the quick-view plan (`/api/preview/*`).
- Tests (TestClient): request with `Host: evil.example` → 400; POST with `Origin: https://evil.example` →
  403; normal same-origin calls still pass; the full UI still loads (Playwright smoke test on a fresh port).

## Phase 3 — packaged app quits by itself on macOS/Linux (needs manual verification)

Problem: the frozen build exits when `/api/heartbeat` hasn't arrived for 10 s (ping every 3 s from a
`setInterval`). Chromium flags that stop timer/renderer throttling are passed only on `win32`. In a
minimised/occluded window Chromium throttles timers (after several minutes down to ~1/min), so the ping can
stop long enough to trigger the exit. Not verified on hardware.

Change:
1. Pass `--disable-renderer-backgrounding`, `--disable-backgrounding-occluded-windows`,
   `--disable-background-timer-throttling` on all platforms (unknown flags are ignored); keep
   `CalculateNativeWinOcclusion` win32-only.
2. Prefer connection presence over timers: count live `/api/events` subscribers
   (`Bus.subscriber_count()`), and quit only after *zero* subscribers for a grace period (≥ 30 s; the sync
   SSE generator can linger up to 15 s after a disconnect). Keep the heartbeat as a secondary signal with a
   longer timeout.
3. This model is replaced anyway when the tray/resident mode from `QUICKVIEW_PLAN.md` lands — keep the
   change small and behind a single function.
- Manual check for the user (an agent cannot do this): frozen macOS build, minimise the window for more than
  6 minutes, restore — the app must still be running.

## Phase 4 — performance (measure with `tools/bench_library.py` after each step)

### 4.1 Read connections (biggest structural win)
- Problem: one `sqlite3` connection guarded by one `threading.Lock`; every read waits for writes from the
  scan and the thumbnail workers. WAL allows concurrent readers.
- Change: thread-local read connections (`PRAGMA query_only=ON`, same `row_factory`, `busy_timeout`, plus
  the `ulower`/`UNOCASE` registrations via `_setup_conn`). `query()` uses the reader without the global
  lock; `execute`/`executemany` and anything writing stay on the locked writer. Track readers in a list and
  close them in `close()`. Check that no code path relies on `query()` seeing uncommitted writes (all
  writers commit immediately — verify).
- Test: run a slow write (executemany of 50k rows) in one thread and time `list_assets` in another.

### 4.2 `tags()` in SQL
- Problem: `tags()` reads every `assets.tags` and `json.loads` each row in Python; it runs on every
  `/api/state` (debounced 200 ms, but triggered by every scan/watcher batch).
- Change:
  `SELECT value, COUNT(*) FROM assets, json_each(assets.tags) WHERE status != 'excluded' GROUP BY value`
  keeping the current ordering logic (`tag_order`, `tag_meta`). Keep case-sensitive counting for now.

### 4.3 Client refresh storms
- Problem: every SSE `batch` event calls `scheduleRefreshItems()` → `refreshItems()`, which re-requests
  `limit=state.items.length` (everything loaded so far), each item incurring a `stat` for its thumbnail
  version; plus `pull(false)` and `/api/state`.
- Change, in two steps: (a) throttle: at most one `refreshItems` per ~1.5 s while `state.meta.scanning`
  (leading + trailing call), and skip it when the batch carries no changes for loaded items;
  (b) add `POST /api/assets/by-ids` (body `{"ids": [...]}`) and make `refreshItems` refresh only the
  currently rendered slice; off-screen items refresh when scrolled into view.
- Server side: cache thumbnail versions in a dict (`_thumb_ver`), set when a thumbnail is written and
  cleared on regenerate/delete, instead of `stat` per item per request.

### 4.4 Thumbnail queue
- `prioritize()` takes the queue lock and does up to two `Path.exists()` per id; the same id can be pushed
  many times while scrolling, so `pending_thumbs()` (heap length + in-flight) is inflated.
- Change: keep a `_queued` set for de-duplication and report `len(_queued) + len(_inflight)`; do the
  filesystem checks before taking the lock (or rely on `_have_thumb` if `_load_thumb_cache` fills it
  completely at startup — verify).

### 4.5 Scan
- `scan_source` builds a `Path` per file and commits per changed file. Use `os.path.join` /
  `os.path.splitext`; collect UPDATEs and apply them with `executemany` in `flush()`.

### 4.6 Query plans on big libraries
- With the benchmark DB, run `EXPLAIN QUERY PLAN` for each sort key and for deep `OFFSET`. Add indexes only
  where they help (`added_at`, `mtime`, `size`); consider keyset pagination for name/added sorts. Text
  search (`instr` scan) stays as is unless the benchmark shows it above ~200 ms at 200k rows; FTS5 is the
  next step then, as a separate change.

## Phase 5 — small things (only if time allows)
- `_thumb_video` uses `-ss 0.8`; videos shorter than that get no thumbnail. Retry with `-ss 0`.
- `/api/events` uses a synchronous generator blocking a worker thread in `q.get(timeout=15)` per open
  window; switch to an async generator fed via `loop.call_soon_threadsafe` when convenient.

## Phase 6 — smaller distributable (~350 MB today)

Cause: the app code and `app/static` are only ~7 MB; the rest is bundled dependencies. Measured by
installing the build dependency list of `build_exe.bat` into a clean Linux venv (proportions carry over to
Windows/macOS, absolute numbers do not):

| Dependency | ≈ size | Only used for |
|---|---|---|
| `usd-core` (`--collect-all pxr`) | 200 MB | USD/USDZ → glTF conversion (`app/usdz_convert.py`, lazy `from pxr import …`) |
| `imageio-ffmpeg` (ffmpeg binary) | 77 MB | video thumbnails (`library.py`, resolved via `imageio_ffmpeg.get_ffmpeg_exe()`) |
| `numpy` (+ OpenBLAS) | 70 MB | `usdz_convert.py` and `psd-tools` (required dependency) |
| `pymupdf` | 64 MB | first-page PDF thumbnail only (the lightbox uses the browser's `<embed>`) |
| `tkinter` / Tcl-Tk | ~15 MB | folder-picker fallback in `server.py` (Windows) |

Constraints for this phase:
- The agent cannot run `build_exe.bat` / `build_app_macos.sh` in its sandbox. Implement and unit-test
  the code paths, then give the user exact commands to build and the measurement command below; the
  before/after numbers come from the user's machine.
- Keep the "no install needed, ffmpeg bundled" promise: 6.3 bundles a slim ffmpeg and only falls back to a system one for rare formats.
- Do these in the order given; each step is independently shippable and measured.

### 6.0 Measure first (user runs this on Windows after a build)
```powershell
Get-ChildItem dist\Sight\_internal -Directory | % { [pscustomobject]@{Name=$_.Name; MB=[math]::Round((gci $_.FullName -Recurse -File | measure Length -Sum).Sum/1MB,1)} } | sort MB -Desc | select -First 12
```
Also record the size of loose files in `_internal` (DLLs) and the total. Paste the table into the RECENT
entry. Adjust the estimates below if the real breakdown differs.

### 6.1 Drop `tkinter` (~15 MB, low risk)
- `server.py` folder picker: on Windows use PowerShell `System.Windows.Forms.FolderBrowserDialog`
  (`powershell -NoProfile -STA`, same style as the existing splash script), macOS keeps `osascript`,
  Linux keeps `zenity`. Remove the `tkinter` fallback or keep it only when `import tkinter` succeeds (it must
  fail gracefully with a clear "no folder picker available" message).
- Add `--exclude-module tkinter` to both build scripts.
- Test: the picker returns a path, cancel returns nothing, a path with spaces/Cyrillic works.

### 6.2 Replace `pymupdf` with `pypdfium2` (~55–60 MB, low risk)
- Only `_thumb_pdf` (search `import pymupdf as fitz`) uses it. Re-implement with
  `pdfium.PdfDocument(path)[0].render(scale=…).to_pil()`, keeping the same thumbnail size, background
  (white, no alpha) and failure behaviour (encrypted/corrupt PDF → no thumbnail, no exception).
- Update the dependency lists in `Sight.py` (`DEPS`, `PROBE`), both build scripts, and any docs. Check the
  `pypdfium2` wheel size for Windows and macOS before committing (expected ~4–6 MB).
- Side benefit to mention in the RECENT entry: `pymupdf` is AGPL/commercial; `pypdfium2` is permissive.
- Test: generate a multi-page PDF with PIL, thumbnail matches page 1 and aspect ratio; a password-protected
  and a truncated PDF fail cleanly.

### 6.3 ffmpeg: slim bundled build with fallbacks (~60–70 MB) — decided with the user
Decision: keep a small ffmpeg bundled, and fall back to a system ffmpeg for formats it cannot decode.
Route every ffmpeg use (thumbnails in `library.py`, status/install endpoints in `server.py`) through one
module-level function set (`get_ffmpeg_candidates()` / `grab_frame(path)`); grep for all uses first.

Resolution chain for a video thumbnail:
1. Bundled slim LGPL build (replaces the full `imageio-ffmpeg` binary in the packaged app; the dev setup
   may keep using `imageio-ffmpeg`).
2. If it fails on that file (non-zero exit, no frame, unsupported codec/demuxer message), retry once with a
   system ffmpeg: `SIGHT_FFMPEG` env var, then `ffmpeg` on `PATH`.
3. If nothing works, show a placeholder tile with a short hint that offers to install a full ffmpeg (the
   existing `install-ffmpeg` endpoint). No error toast, no endless retries: record the failure so the
   worker does not loop (look at how thumbnail failures are recorded today; any schema change is additive
   in `_migrate()`).
4. When the set of available ffmpeg binaries changes (e.g. a system ffmpeg appears after the user installs
   one), requeue video thumbnails that previously failed. Store a small ffmpeg identity string (path +
   version) in settings and compare at startup.

Slim build specification (write it down in `tools/ffmpeg-slim/README.md` with the exact `./configure`
flags so the build is reproducible; never commit binaries to git; pin version and SHA-256 per platform):
- LGPL only: no `--enable-gpl`, no x264/x265. Decoders: h264, hevc, vp8, vp9, av1 (via libdav1d), mpeg4,
  mpeg2video, mjpeg, prores, dnxhd, wmv1/2/3, vc1, flv, theora, gif. Demuxers: mov, matroska/webm, avi,
  mpegts, mpeg, flv, asf, ogg, gif. Filters: `scale`, `format`. Encoders: `mjpeg`, `png` only. Protocols:
  `file`, `pipe` only. Expect roughly 15–30 MB depending on the codec set; if it lands above ~30 MB, trim the
  rarest codecs and rely on the system fallback for them.
- Run it with `-nostdin -protocol_whitelist file,pipe`; ffmpeg parses untrusted files, so record the
  bundled version in the About/log output and document the update procedure.
- Licensing: ship the LGPL text and a link to the exact source/configure flags in a `licenses/` folder of
  the distribution.
- Platforms: Windows x64, macOS arm64 + x64, Linux x64 — one binary per build script.
- Also retry the frame grab with `-ss 0` for videos shorter than 0.8 s (Phase 5).
- Test corpus (generated in dev with a full ffmpeg): h264 mp4, hevc mp4, vp9 webm, av1 mp4, prores mov,
  mpeg2 ts, wmv, mpeg4 avi, flv, gif, a truncated file, an audio-only file. Test that the slim build grabs a
  frame from the supported ones, that unsupported ones fall back to the system ffmpeg (or the placeholder
  when none is installed), and that the truncated file fails cleanly without a retry loop. Video playback in
  the lightbox is unaffected (it uses the browser's `<video>`).

### 6.4 USD as an optional component (~150–200 MB, largest and most invasive)
Try the cheap variant first: replace `--collect-all pxr` with the modules actually used
(`Usd, UsdGeom, UsdShade, Gf, Sdf, Vt, Tf, Ar, Plug, Kind, Pcp, Sdr, Ndr, Ts`, verify the exact set) via
`--collect-submodules`/hidden imports, keeping the plugin resource files USD needs to load (`plugInfo.json`).
Convert a sample `.usdz` from the built app; if it works and the saving is enough, stop here.

Otherwise make USD an add-on:
- Remove `--collect-all pxr` from both build scripts. Build script (separate, run per platform) produces
  `sight-usd-<converterversion>-<platform>-cp312.zip` containing `pxr` and its native libraries from the
  `usd-core` wheel; it must match the bundled Python ABI.
- New `app/components.py`: `component_dir(name)`, `usd_available()`; when present, `sys.path.insert(0, …)`
  and on Windows `os.add_dll_directory(…)` before the first `from pxr import …`. Dev mode already treats
  `usd-core` as optional (see the comment near `Sight.py` line 141): reuse that behaviour.
- Endpoints: `GET /api/components` (status), `POST /api/components/usd/install` (download from a fixed URL
  with a pinned SHA-256 — nothing user-supplied; covered by the Phase 2 Origin/Host checks; progress via the
  existing SSE bus). UI: when a USD/USDZ asset is opened and the pack is missing, show an English prompt
  with the download size and an Install button; converted GLBs are cached, so the pack is needed once per
  model.
- Test: with the pack absent the app starts and other kinds work; opening `.usdz` shows the prompt; after
  install, conversion works without restart; a hash mismatch aborts and deletes the partial file.

### 6.5 Distribution size (optional)
- `dist\Sight` is uncompressed; a zip or installer is roughly half of it. Add a `Compress-Archive` step (or
  7z) to `build_exe.bat`, and an Inno Setup script only if the user wants an installer.
- Do not use UPX (little gain, more antivirus false positives).

Target to report (not a hard requirement): ~130–160 MB unpacked after 6.1–6.4, versus ~350 MB now.
Verify after each step: app launches, cold-start time did not regress, PDF/video/USDZ/PSD thumbnails and the
folder picker still work in the built app.

## Definition of done
- Pytest suite green; benchmark table (before/after) pasted into the RECENT entry.
- Phase 1 fixes demonstrated with the tests above, plus a Playwright smoke test on a fresh port: search
  «фото», filter by a Cyrillic tag, portrait JPEG thumbnail upright, missing→ready after rescan.
- Docs updated (`RECENT.md`, `ARCHITECTURE.md` if needed, `MANUAL.md` only for user-visible behaviour).
- Phase 6: the user has built the app and reported the before/after size table; each removed dependency
  has a working fallback or on-demand path.
- Nothing committed or pushed unless the user asked.
