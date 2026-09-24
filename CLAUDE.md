# Sight — notes for agents

Sight is a local, in-place media library (FastAPI + SQLite backend, one zero-build HTML/JS frontend).
Read this file first; it is short on purpose. Details live in `docs/`.

## Read before you touch code

1. `docs/RECENT.md` — what changed lately and why, newest first. **Start here** instead of re-reading source.
2. `docs/ARCHITECTURE.md` — how the pieces fit (files, DB tables, API, canvas internals, gotchas).
3. `README.md` / `MANUAL.md` — user-facing behaviour.

## MemPalace (shared memory across sessions)

The MemPalace MCP server (`.mcp.json`, palace `E:/AI_tools/mempalace-palace`, **wing `sight_media_viewer`**)
holds decisions, root causes and user preferences from earlier sessions. Use it to avoid re-reading code.

- **Session start, non-trivial task:** one narrow `mempalace_search` — `wing="sight_media_viewer"`, bare keywords
  as `query`, `limit=3`, `max_distance≈0.8`, add `room` when known. Follow up with `mempalace_get_drawer` by id,
  not a wider search. No `status` / `list_wings` / `get_taxonomy` as a warm-up. Skip it for trivial tasks.
- **Memory vs repo:** `docs/` stays the source of truth in git (other machines have no palace). If a drawer and
  the code disagree, trust the code, fix the drawer (`mempalace_update_drawer` / `mempalace_delete_drawer`)
  and mention the conflict.
- **After a task:** store what the next session should know and cannot see in the diff — root cause, rejected
  approach, user preference — as one short drawer (`mempalace_add_drawer`, rooms such as `architecture`,
  `canvas`, `library`, `launcher`, `bugs`, `decisions`, `preferences`). Run `mempalace_check_duplicate`
  first, update rather than duplicate. This is in addition to the RECENT.md entry, not instead of it.
- **If it misbehaves:** `mempalace_reconnect`, then retry once. Persistent "Error finding id" usually means
  orphaned `mempalace` python/uv processes from old sessions holding the Chroma DB — kill the older process
  trees (never the newest one, it is this session's), reconnect. If still unavailable, work from `docs/`.

## Keep the docs current (every agent, every change)

- After each user-visible change or non-obvious decision, **add an entry at the top of `docs/RECENT.md`**
  (format is in that file): what changed, which files, and what the next agent must know
  (gotchas, invariants, things deliberately not done). Write for someone who will not read the diff.
- Bump `APP_VERSION` in `app/version.py` (minor = feature, patch = fix) and use that number in the entry.
  The version is shown in the window title and next to "Sight" in the sidebar.
- Keep `docs/ARCHITECTURE.md` for facts that stay true; put "what happened" in RECENT.
- User-facing behaviour (new shortcuts, features) also goes into `MANUAL.md`.
- Archiving: RECENT.md holds the newest 15 entries. When you add one, run
  `python tools/archive_changes.py` — it moves older entries to `docs/archive/CHANGES-YYYY-MM.md`
  (append-only history; never edit archived entries, add a new RECENT entry that supersedes them).
  Drop from RECENT anything that a later entry has made obsolete rather than letting it mislead.

## Rules of the house

- **Language:** replies to the user in Russian; code, comments, UI strings and docs strictly English.
- **Shortcuts:** every keyboard shortcut goes through `hotkey()` / `runHotkeys()` in `app/static/keys.js`
  (exact modifier match). Never test `e.key`/`e.code` on its own — Shift+D must not fire plain-D.
- **Reuse, don't reinvent:** if the library grid or lightbox already has a control (zoom, marquee,
  icon picker, rename-on-double-click, pixelation switch), share it instead of writing a second one.
- **Parallel sessions:** several agents may edit this repo at once. Re-read a file right before editing
  it, make targeted edits, never revert changes you don't recognise, and **do not push (or commit)
  without the user asking**. Stage only your own hunks.
- **Build before every push:** when the user asks for a push, first produce a fresh build of the current
  state (Windows: `build_exe.bat` → `dist\Sight\Sight.exe`; macOS: `build_app_macos.sh` → `dist/Sight.app`),
  make sure it succeeds, and only then push. `dist/` is git-ignored — the build is not committed, it just
  has to be up to date and working. If the build fails, fix it or tell the user instead of pushing.
- **Testing UI:** run the dev server (`SIGHT_DEV=1 ~/.sight/runtime/Scripts/python.exe Sight.py --dev
  --no-browser --port NNNN`, pick a fresh port) and drive it with Playwright. Tests must create their
  own boards/items by id and delete them afterwards — the live library is the user's real data.
- Backend (`.py`) changes need a server restart; `index.html`/`canvas.js`/`keys.js` are live on refresh.
