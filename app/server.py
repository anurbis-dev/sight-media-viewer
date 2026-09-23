"""FastAPI app for Sight."""

from __future__ import annotations

import json
import os
import queue
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .library import Library, find_ffmpeg, KIND_LABEL, SKIP_DIRS, normpath
from .settings import SettingsStore, load_defaults, save_defaults

STATIC = Path(__file__).resolve().parent / "static"
DEFAULTS_FILE = STATIC / "defaults.json"
APP_DIR = Path(__file__).resolve().parent


def app_build_time() -> int:
    """Newest mtime across the backend `.py` sources, computed once at process start — this is
    literally "is this the process you last restarted", since only `.py` changes need Sight.bat
    restarted to take effect. `index.html` changes are always live on a plain refresh (served
    with Cache-Control: no-store), so it's deliberately excluded — a badge covering it would lag
    behind edits that don't actually need a restart, defeating its own purpose."""
    best = 0.0
    for f in APP_DIR.glob("*.py"):
        try:
            best = max(best, f.stat().st_mtime)
        except OSError:
            continue
    return int(best * 1000)


BUILD_TIME_MS = app_build_time()


def pick_folder() -> str:
    import shutil
    import subprocess
    import sys

    if sys.platform == "darwin":
        r = subprocess.run(
            ["osascript", "-e", 'POSIX path of (choose folder with prompt "Add folder to Sight")'],
            capture_output=True, text=True,
        )
        return r.stdout.strip().rstrip("/")
    if sys.platform == "win32":
        ps = (
            "Add-Type -AssemblyName System.Windows.Forms; "
            "$f = New-Object System.Windows.Forms.FolderBrowserDialog; "
            "$f.Description = 'Add folder to Sight'; "
            "if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath }"
        )
        r = subprocess.run(
            ["powershell", "-NoProfile", "-STA", "-Command", ps],
            capture_output=True, text=True,
        )
        return r.stdout.strip()
    for cmd in (
        ["zenity", "--file-selection", "--directory", "--title=Add folder to Sight"],
        ["kdialog", "--getexistingdirectory", ".", "Add folder to Sight"],
    ):
        if shutil.which(cmd[0]):
            r = subprocess.run(cmd, capture_output=True, text=True)
            if r.returncode == 0:
                return r.stdout.strip()
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.wm_attributes("-topmost", 1)
        path = filedialog.askdirectory(title="Add folder to Sight")
        root.destroy()
        return path or ""
    except Exception:
        return ""


def fs_roots() -> dict:
    """Drive letters (Windows) or `/` (POSIX) plus common shortcut folders — feeds the
    in-app folder browser so "Add Folder" never has to shell out to a native OS dialog."""
    import sys

    home = Path.home()
    drives: list[dict] = []
    if sys.platform == "win32":
        import string

        for letter in string.ascii_uppercase:
            p = Path(f"{letter}:/")
            if p.exists():
                drives.append({"name": f"{letter}:", "path": str(p)})
    else:
        drives.append({"name": "/", "path": "/"})
    shortcuts = [
        ("Home", home),
        ("Desktop", home / "Desktop"),
        ("Documents", home / "Documents"),
        ("Downloads", home / "Downloads"),
        ("Pictures", home / "Pictures"),
        ("Videos", home / "Videos"),
    ]
    return {
        "drives": drives,
        "shortcuts": [{"name": n, "path": str(p)} for n, p in shortcuts if p.exists()],
    }


def fs_list_dir(path: Path) -> list[dict]:
    """Immediate subdirectories of `path`, lazily listed (no precomputed has-children)."""
    out: list[dict] = []
    try:
        entries = sorted(path.iterdir(), key=lambda e: e.name.lower())
    except (PermissionError, OSError):
        return out
    for e in entries:
        if e.name in SKIP_DIRS or e.name.startswith("."):
            continue
        try:
            if e.is_dir():
                out.append({"name": e.name, "path": str(e)})
        except OSError:
            continue
    return out


def reveal_path(path: str) -> None:
    import subprocess
    import sys

    if sys.platform == "darwin":
        subprocess.Popen(["open", "-R", path])
    elif sys.platform == "win32":
        subprocess.Popen(["explorer", "/select,", path])
    else:
        subprocess.Popen(["xdg-open", str(Path(path).parent)])


def open_path(path: str) -> None:
    import subprocess
    import sys

    if sys.platform == "darwin":
        subprocess.Popen(["open", path])
        return
    if sys.platform == "win32":
        try:
            os.startfile(path)  # type: ignore[attr-defined]
        except OSError:
            subprocess.Popen(["cmd", "/c", "start", "", path], shell=False)
        return
    subprocess.Popen(["xdg-open", path])


def media_type_for(path: str) -> str | None:
    ext = Path(path).suffix.lower()
    return {
        ".gltf": "model/gltf+json",
        ".glb": "model/gltf-binary",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
        ".mp4": "video/mp4",
        ".m4v": "video/mp4",
        ".mov": "video/quicktime",
        ".webm": "video/webm",
        ".mkv": "video/x-matroska",
        ".avi": "video/x-msvideo",
        ".mpg": "video/mpeg",
        ".mpeg": "video/mpeg",
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".flac": "audio/flac",
        ".ogg": "audio/ogg",
        ".opus": "audio/opus",
        ".m4a": "audio/mp4",
        ".aac": "audio/aac",
        ".pdf": "application/pdf",
        ".ttf": "font/ttf",
        ".otf": "font/otf",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
        ".txt": "text/plain",
        ".md": "text/markdown",
        ".json": "application/json",
        ".xml": "application/xml",
        ".csv": "text/csv",
    }.get(ext)


def offer_ffmpeg_install() -> tuple[bool, str]:
    import shutil
    import subprocess
    import sys

    if sys.platform == "darwin" and shutil.which("brew"):
        try:
            subprocess.check_call(["brew", "install", "ffmpeg"])
            return True, "Installed ffmpeg with Homebrew."
        except subprocess.CalledProcessError as e:
            return False, f"Homebrew install failed: {e}"
    if sys.platform == "win32" and shutil.which("winget"):
        try:
            subprocess.check_call(
                [
                    "winget", "install", "-e", "--id", "Gyan.FFmpeg",
                    "--accept-package-agreements", "--accept-source-agreements",
                ],
            )
            return True, "Installed ffmpeg with winget."
        except subprocess.CalledProcessError as e:
            return False, f"winget install failed: {e}"
    try:
        import imageio_ffmpeg

        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe:
            return True, "Using bundled ffmpeg."
    except Exception as e:
        return False, f"Could not fetch a bundled ffmpeg: {e}"
    return False, "Install ffmpeg from https://ffmpeg.org/download.html"


async def json_body(request: Request) -> dict:
    try:
        data = await request.json()
    except Exception:
        data = {}
    return data if isinstance(data, dict) else {}


class RangeNotSatisfiable(Exception):
    pass


def parse_byte_range(header: str | None, size: int) -> tuple[int, int] | None:
    """Half-open (start, end) of a single ``Range: bytes=…`` request. None means "send it all"
    (no header, or one we don't understand — the spec says to ignore those); RangeNotSatisfiable
    means the range lies outside the file (416)."""
    if not header or not header.startswith("bytes=") or "," in header:
        return None
    first, _, last = header[6:].strip().partition("-")
    try:
        a = int(first) if first else None
        b = int(last) if last else None
    except ValueError:
        return None
    if a is None:  # suffix form "-N": the final N bytes
        if not b or b < 0 or size <= 0:
            raise RangeNotSatisfiable
        return max(0, size - b), size
    end = size if b is None else min(size, b + 1)
    if a < 0 or a >= size or end <= a:
        raise RangeNotSatisfiable
    return a, end


def serve_video(request: Request, path: str, cache) -> StreamingResponse | Response:
    """Range-aware video response fed through the sliding RAM window (see SlidingVideoCache)."""
    size = os.path.getsize(path)
    headers = {"Accept-Ranges": "bytes", "Cache-Control": "no-store"}
    try:
        rng = parse_byte_range(request.headers.get("range"), size)
    except RangeNotSatisfiable:
        return Response(status_code=416, headers={**headers, "Content-Range": f"bytes */{size}"})
    start, end = rng or (0, size)
    headers["Content-Length"] = str(end - start)
    if rng:
        headers["Content-Range"] = f"bytes {start}-{end - 1}/{size}"
    return StreamingResponse(
        cache.stream(path, start, end),
        status_code=206 if rng else 200,
        media_type=media_type_for(path) or "video/mp4",
        headers=headers,
    )


def build_app(lib: Library, settings: SettingsStore | None = None, dev: bool = False) -> FastAPI:
    app = FastAPI(title="Sight", docs_url=None, redoc_url=None)
    app.state.last_heartbeat = time.time()
    settings = settings or SettingsStore(lib.root)

    @app.get("/")
    def home() -> FileResponse:
        index = STATIC / "index.html"
        if not index.exists():
            raise HTTPException(500, "UI missing")
        return FileResponse(index, media_type="text/html", headers={"Cache-Control": "no-store"})

    @app.get("/api/state")
    def state() -> dict:
        return {
            "sources": lib.sources(),
            "counts": lib.counts(),
            "pending": lib.pending_thumbs(),
            "scanning": lib.scanning > 0,
            "scanned": lib.scanned,
            "ffmpeg": bool(lib.ffmpeg or find_ffmpeg()),
            "kinds": KIND_LABEL,
            "tags": lib.tags(),
            "collections": lib.collections(),
            "buildMs": BUILD_TIME_MS,
        }

    @app.get("/api/tags")
    def tags() -> list[dict]:
        return lib.tags()

    @app.post("/api/tags/remove")
    async def remove_tag(request: Request) -> dict:
        body = await json_body(request)
        name = str(body.get("name") or "")
        n = lib.strip_tag(name)
        return {"ok": True, "updated": n}

    @app.post("/api/tags/rename")
    async def rename_tag(request: Request) -> dict:
        body = await json_body(request)
        old = str(body.get("old") or "")
        new = str(body.get("new") or "")
        n = lib.rename_tag(old, new)
        return {"ok": True, "updated": n}

    @app.post("/api/tags/reorder")
    async def tags_reorder(request: Request) -> dict:
        names = (await json_body(request)).get("names") or []
        if not isinstance(names, list):
            raise HTTPException(400, "names required")
        lib.reorder_tags([str(x) for x in names])
        return {"ok": True}

    @app.post("/api/tags/icon")
    async def set_tag_icon(request: Request) -> dict:
        body = await json_body(request)
        name = str(body.get("name") or "")
        icon = body.get("icon")
        color = body.get("color")
        lib.set_tag_icon(name, str(icon) if icon else None, str(color) if color else None)
        return {"ok": True}

    @app.get("/api/assets")
    def assets(
        q: str = "",
        kind: str = "",
        source: str = "",
        tag: str = "",
        missing: int = 0,
        collection: str = "",
        offset: int = 0,
        limit: int = 400,
        folder: str = "",
        sort: str = "",
        order: str = "asc",
    ) -> dict:
        lim = max(1, min(limit, 800))
        items = lib.list_assets(q, kind, source, tag, bool(missing), collection, offset, lim, folder, sort, order)
        total = lib.count_filtered(q, kind, source, tag, bool(missing), collection, folder) if offset == 0 else None
        return {"items": items, "offset": offset, "total": total}

    @app.get("/api/assets/{aid}")
    def one(aid: str) -> dict:
        a = lib.get_asset(aid)
        if not a:
            raise HTTPException(404)
        return a

    @app.patch("/api/assets/{aid}")
    async def patch(aid: str, request: Request) -> dict:
        a = lib.patch_asset(aid, await json_body(request))
        if not a:
            raise HTTPException(404)
        return a

    @app.get("/api/thumb/{aid}")
    def thumb(aid: str):
        p = lib.thumb_path(aid)
        if not p:
            lib.prioritize([aid], 0)
            return JSONResponse({"ok": False, "queued": True}, status_code=202)
        media_type = "image/png" if p.suffix == ".png" else "image/jpeg"
        return FileResponse(
            p,
            media_type=media_type,
            headers={"Cache-Control": "public, max-age=31536000, immutable"},
        )

    @app.post("/api/thumb/{aid}")
    async def upload_thumb(aid: str, request: Request) -> dict:
        # Client-rendered thumbnails (3D models — no headless GL on the server to render them).
        data = await request.body()
        if len(data) > 4 * 1024 * 1024:
            raise HTTPException(413, "thumbnail too large")
        ok = lib.save_uploaded_thumb(aid, data)
        if not ok:
            raise HTTPException(404)
        return {"ok": True}

    @app.post("/api/missing/purge")
    async def purge_missing(request: Request) -> dict:
        # Cleans the index of files that were moved or deleted; never touches files on disk.
        # An empty body cleans the whole library; filter fields (mirrors GET /api/assets) scope
        # it to the matching view instead — e.g. "just what's missing under the current filter".
        body = await json_body(request)
        return {
            "ok": True,
            **lib.purge_missing(
                q=str(body.get("q") or ""),
                kind=str(body.get("kind") or ""),
                source_id=str(body.get("source") or ""),
                tag=str(body.get("tag") or ""),
                collection_id=str(body.get("collection") or ""),
                folder=str(body.get("folder") or ""),
            ),
        }

    @app.post("/api/thumbs/refresh")
    async def refresh_thumbs(request: Request) -> dict:
        # Force-regenerate: drop the cached thumbnails of these assets and rebuild them.
        body = await json_body(request)
        ids = body.get("ids") or []
        if not isinstance(ids, list):
            raise HTTPException(400)
        return {"ok": True, "ids": lib.refresh_thumbs([str(x) for x in ids])}

    @app.get("/api/assets/{aid}/companions")
    def companions(aid: str) -> list[dict]:
        return lib.companions(aid)

    @app.get("/api/waveform/{aid}")
    def waveform(aid: str):
        p = lib.make_waveform(aid)
        if not p:
            raise HTTPException(404)
        return FileResponse(
            p,
            media_type="application/json",
            headers={"Cache-Control": "public, max-age=31536000, immutable"},
        )

    @app.get("/api/model-res/{aid}")
    def model_res(aid: str, name: str = ""):
        # A texture / .bin a model refers to by relative name (see resolve_model_resource).
        p = lib.resolve_model_resource(aid, name)
        if not p:
            raise HTTPException(404)
        return FileResponse(
            p,
            media_type=media_type_for(str(p)) or "application/octet-stream",
            headers={"Cache-Control": "private, max-age=60"},
        )

    @app.get("/api/model-glb/{aid}")
    def model_glb(aid: str):
        p = lib.make_usdz_glb(aid)
        if not p:
            raise HTTPException(404)
        return FileResponse(
            p,
            media_type="model/gltf-binary",
            headers={"Cache-Control": "private, max-age=60"},
        )

    @app.get("/api/text/{aid}")
    def text_preview(aid: str) -> dict:
        data = lib.read_text_preview(aid)
        if data is None:
            raise HTTPException(404)
        return data

    @app.get("/api/file/{aid}")
    def file(aid: str, request: Request):
        a = lib.get_asset(aid)
        if not a or not Path(a["path"]).exists():
            raise HTTPException(404)
        mt = media_type_for(a["path"])
        headers = {"Cache-Control": "private, max-age=60"}
        if a.get("kind") == "video":
            return serve_video(request, a["path"], lib.video_cache)
        if a.get("kind") in ("model3d", "font", "document"):
            # No filename= here on purpose: FileResponse then adds Content-Disposition:
            # attachment, which makes Chromium's PDF viewer refuse a <embed> of it outright
            # ("Couldn't load plugin") instead of rendering inline — same risk for fonts/models
            # loaded programmatically rather than saved.
            return FileResponse(a["path"], media_type=mt, headers=headers)
        return FileResponse(a["path"], media_type=mt, filename=a["name"], headers=headers)

    @app.post("/api/video/focus")
    async def video_focus(request: Request) -> dict:
        body = await json_body(request)
        if body.get("mb") is not None:
            try:
                lib.video_cache.configure(int(body["mb"]))
            except (TypeError, ValueError):
                pass
        if body.get("release"):
            lib.video_cache.release()
            return {"ok": True, "mb": lib.video_cache.budget_mb}
        aid = str(body.get("id") or "")
        if not aid:
            return {"ok": True, "mb": lib.video_cache.budget_mb}
        a = lib.get_asset(aid)
        if not a or a.get("kind") != "video" or not Path(a["path"]).exists():
            raise HTTPException(404)
        try:
            t = float(body.get("t") or 0)
            duration = float(body.get("duration") or 0)
        except (TypeError, ValueError):
            t, duration = 0.0, 0.0
        size = os.path.getsize(a["path"])
        pos = int(size * (t / duration)) if duration > 0 else 0
        pos = max(0, min(size, pos))
        lib.video_cache.focus(a["path"], pos)
        snap = lib.video_cache.snapshot(a["path"])
        snap.update({"ok": True, "pos": pos, "mb": lib.video_cache.budget_mb})
        return snap

    @app.get("/api/video/cache")
    def video_cache_state(aid: str = "") -> dict:
        if not aid:
            return lib.video_cache.snapshot()
        a = lib.get_asset(aid)
        if not a or a.get("kind") != "video":
            raise HTTPException(404)
        return lib.video_cache.snapshot(a["path"])

    @app.get("/api/psd/{aid}/layers")
    def psd_layers(aid: str):
        layers = lib.psd_layers(aid)
        if layers is None:
            raise HTTPException(404)
        return layers

    @app.get("/api/psd/{aid}/preview")
    def psd_preview(aid: str):
        p = lib.psd_composite(aid)
        if not p:
            raise HTTPException(404)
        return FileResponse(p, media_type="image/png" if p.suffix == ".png" else "image/jpeg")

    @app.get("/api/psd/{aid}/layer/{index}")
    def psd_layer(aid: str, index: int):
        p = lib.psd_layer_image(aid, index)
        if not p:
            raise HTTPException(404)
        return FileResponse(p, media_type="image/png")

    @app.get("/api/collections")
    def collections() -> list[dict]:
        return lib.collections()

    @app.post("/api/collections")
    async def add_collection(request: Request) -> dict:
        body = await json_body(request)
        name = str(body.get("name") or "Untitled")
        parent = body.get("parentId") or body.get("parent_id")
        return lib.add_collection(name, str(parent) if parent else None)

    @app.patch("/api/collections/{cid}")
    async def rename_collection(cid: str, request: Request) -> dict:
        body = await json_body(request)
        if "name" in body:
            lib.rename_collection(cid, str(body.get("name") or "Untitled"))
        if "parentId" in body:
            parent = body.get("parentId")
            lib.move_collection(cid, str(parent) if parent else None)
        if "icon" in body or "color" in body:
            icon = body.get("icon")
            color = body.get("color")
            lib.set_collection_icon(cid, str(icon) if icon else None, str(color) if color else None)
        return {"ok": True}

    @app.delete("/api/collections/{cid}")
    def drop_collection(cid: str) -> dict:
        lib.delete_collection(cid)
        return {"ok": True}

    @app.post("/api/collections/reorder")
    async def collections_reorder(request: Request) -> dict:
        ids = (await json_body(request)).get("ids") or []
        if not isinstance(ids, list):
            raise HTTPException(400, "ids required")
        lib.reorder_collections([str(x) for x in ids])
        return {"ok": True}

    @app.post("/api/collections/{cid}/assets")
    async def collect_assets(cid: str, request: Request) -> dict:
        body = await json_body(request)
        ids = body.get("ids") or []
        lib.add_to_collection(cid, [str(x) for x in ids])
        return {"ok": True}

    @app.delete("/api/collections/{cid}/assets")
    async def uncollect_assets(cid: str, request: Request) -> dict:
        body = await json_body(request)
        ids = body.get("ids") or []
        lib.remove_from_collection(cid, [str(x) for x in ids])
        return {"ok": True}

    @app.post("/api/visible")
    async def visible(request: Request) -> dict:
        body = await json_body(request)
        ids = body.get("ids") or []
        extra = body.get("prefetch") or []
        if isinstance(ids, list):
            lib.prioritize([str(x) for x in ids], 0)
        if isinstance(extra, list):
            lib.prioritize([str(x) for x in extra], 1)
        return {"ok": True, "pending": lib.pending_thumbs()}

    # ---- Canvas boards ---------------------------------------------------------------
    # Infinite-canvas moodboards: named, ordered, holding freely positioned placements of
    # library assets (board_items) plus text/drawing/shape annotations. Route shapes mirror
    # the /api/collections block above.

    @app.get("/api/boards")
    def boards() -> list[dict]:
        return lib.boards()

    @app.post("/api/boards")
    async def add_board(request: Request) -> dict:
        body = await json_body(request)
        return lib.add_board(str(body.get("name") or "Untitled"))

    @app.patch("/api/boards/{bid}")
    async def update_board(bid: str, request: Request) -> dict:
        body = await json_body(request)
        board = lib.update_board(bid, body)
        if not board:
            raise HTTPException(404)
        return board

    @app.delete("/api/boards/{bid}")
    def drop_board(bid: str) -> dict:
        lib.delete_board(bid)
        return {"ok": True}

    @app.post("/api/boards/reorder")
    async def boards_reorder(request: Request) -> dict:
        ids = (await json_body(request)).get("ids") or []
        if not isinstance(ids, list):
            raise HTTPException(400, "ids required")
        lib.reorder_boards([str(x) for x in ids])
        return {"ok": True}

    @app.get("/api/boards/{bid}/full")
    def board_full(bid: str) -> dict:
        full = lib.board_full(bid)
        if not full:
            raise HTTPException(404)
        return full

    @app.post("/api/boards/{bid}/items")
    async def add_board_item(bid: str, request: Request) -> dict:
        body = await json_body(request)
        if not body.get("asset_id"):
            raise HTTPException(400, "asset_id required")
        return lib.add_board_item(bid, body)

    @app.patch("/api/boards/{bid}/items/{item_id}")
    async def update_board_item(bid: str, item_id: str, request: Request) -> dict:
        body = await json_body(request)
        item = lib.update_board_item(item_id, body)
        if not item:
            raise HTTPException(404)
        return item

    @app.post("/api/boards/{bid}/items/batch")
    async def batch_update_board_items(bid: str, request: Request) -> dict:
        body = await json_body(request)
        lib.batch_update_board_items(body.get("items") or [])
        return {"ok": True}

    @app.delete("/api/boards/{bid}/items/{item_id}")
    def drop_board_item(bid: str, item_id: str) -> dict:
        lib.delete_board_items([item_id])
        return {"ok": True}

    @app.post("/api/boards/{bid}/items/batch-delete")
    async def batch_delete_board_items(bid: str, request: Request) -> dict:
        ids = (await json_body(request)).get("ids") or []
        lib.delete_board_items([str(x) for x in ids])
        return {"ok": True}

    @app.post("/api/boards/{bid}/groups")
    async def add_board_group(bid: str, request: Request) -> dict:
        body = await json_body(request)
        item_ids = [str(x) for x in (body.get("item_ids") or [])]
        annotation_ids = [str(x) for x in (body.get("annotation_ids") or [])]
        return lib.add_board_group(bid, item_ids, annotation_ids, str(body.get("name") or ""))

    @app.patch("/api/boards/{bid}/groups/{gid}")
    async def update_board_group(bid: str, gid: str, request: Request) -> dict:
        body = await json_body(request)
        group = lib.update_board_group(gid, body)
        if not group:
            raise HTTPException(404)
        return group

    @app.post("/api/boards/{bid}/groups/{gid}/ungroup")
    def ungroup_board_group(bid: str, gid: str) -> dict:
        lib.ungroup_board_group(gid)
        return {"ok": True}

    @app.delete("/api/boards/{bid}/groups/{gid}")
    def drop_board_group(bid: str, gid: str) -> dict:
        lib.delete_board_group(gid)
        return {"ok": True}

    @app.get("/api/annotations")
    def annotations_for_asset(asset_id: str = "") -> list[dict]:
        if not asset_id:
            raise HTTPException(400, "asset_id required")
        return lib.annotations_for_asset(asset_id)

    @app.post("/api/annotations")
    async def add_annotation(request: Request) -> dict:
        body = await json_body(request)
        try:
            return lib.add_annotation(body)
        except ValueError as e:
            raise HTTPException(400, str(e))

    @app.patch("/api/annotations/{aid}")
    async def update_annotation(aid: str, request: Request) -> dict:
        body = await json_body(request)
        anno = lib.update_annotation(aid, body)
        if not anno:
            raise HTTPException(404)
        return anno

    @app.delete("/api/annotations/{aid}")
    def drop_annotation(aid: str) -> dict:
        lib.delete_annotation(aid)
        return {"ok": True}

    @app.post("/api/annotations/batch")
    async def batch_update_annotations(request: Request) -> dict:
        body = await json_body(request)
        lib.batch_update_annotations(body.get("items") or [])
        return {"ok": True}

    @app.get("/api/events")
    def events():
        q = lib.bus.subscribe()

        def gen():
            try:
                yield f"data: {json.dumps({'type': 'hello'})}\n\n"
                while True:
                    try:
                        ev = q.get(timeout=15)
                    except queue.Empty:
                        yield ":\n\n"
                        continue
                    yield f"data: {json.dumps(ev)}\n\n"
            finally:
                lib.bus.unsubscribe(q)

        return StreamingResponse(
            gen(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.post("/api/sources/pick")
    def pick() -> dict:
        path = pick_folder()
        if not path:
            return {"cancelled": True}
        return lib.add_source(path)

    @app.get("/api/fs/roots")
    def fs_roots_route() -> dict:
        return fs_roots()

    @app.get("/api/fs/list")
    def fs_list_route(path: str = "") -> dict:
        p = Path(path) if path else Path.home()
        try:
            p = p.resolve()
        except OSError:
            raise HTTPException(400, "invalid path")
        if not p.exists() or not p.is_dir():
            raise HTTPException(400, "not a directory")
        parent = p.parent
        return {
            "path": str(p),
            "parent": str(parent) if parent != p else None,
            "dirs": fs_list_dir(p),
        }

    @app.post("/api/sources")
    async def add_source(request: Request) -> dict:
        path = str((await json_body(request)).get("path") or "")
        if not path:
            raise HTTPException(400, "path required")
        return lib.add_source(path)

    @app.delete("/api/sources/{sid}")
    def drop_source(sid: str) -> dict:
        lib.remove_source(sid)
        return {"ok": True}

    @app.post("/api/sources/{sid}/rescan")
    def rescan_source(sid: str) -> dict:
        if not lib.rescan_source(sid):
            raise HTTPException(404)
        return {"ok": True}

    @app.post("/api/sources/reorder")
    async def sources_reorder(request: Request) -> dict:
        ids = (await json_body(request)).get("ids") or []
        if not isinstance(ids, list):
            raise HTTPException(400, "ids required")
        lib.reorder_sources([str(x) for x in ids])
        return {"ok": True}

    @app.get("/api/sources/{sid}/tree")
    def source_tree(sid: str, path: str = "") -> dict:
        root = lib.source_root(sid)
        if root is None:
            raise HTTPException(404, "unknown source")
        target = Path(path) if path else Path(root)
        try:
            target = target.resolve()
        except OSError:
            raise HTTPException(400, "invalid path")
        if not target.is_dir():
            raise HTTPException(400, "not a directory")
        root_n = normpath(root)
        target_n = normpath(target)
        if target_n != root_n and not target_n.startswith(root_n + os.sep):
            raise HTTPException(400, "outside source")
        exc = lib.excluded_set(sid)
        dirs = fs_list_dir(target)
        for d in dirs:
            d["excluded"] = normpath(d["path"]) in exc
        return {"path": str(target), "dirs": dirs}

    @app.post("/api/sources/{sid}/exclude")
    async def source_exclude(sid: str, request: Request) -> dict:
        body = await json_body(request)
        p = str(body.get("path") or "")
        excluded = bool(body.get("excluded"))
        if not p:
            raise HTTPException(400, "path required")
        root = lib.source_root(sid)
        if root is None:
            raise HTTPException(404, "unknown source")
        root_n = normpath(root)
        p_n = normpath(p)
        if p_n == root_n or not p_n.startswith(root_n + os.sep):
            raise HTTPException(400, "path must be inside the source")
        try:
            return lib.set_excluded(sid, p, excluded)
        except ValueError as e:
            raise HTTPException(404, str(e)) from e

    @app.post("/api/assets/{aid}/open")
    def open_asset(aid: str) -> dict:
        a = lib.get_asset(aid)
        if not a:
            raise HTTPException(404)
        open_path(a["path"])
        return {"ok": True}

    @app.post("/api/assets/{aid}/reveal")
    def reveal(aid: str) -> dict:
        a = lib.get_asset(aid)
        if not a:
            raise HTTPException(404)
        reveal_path(a["path"])
        return {"ok": True}

    @app.post("/api/assets/{aid}/copy")
    async def copy(aid: str, request: Request) -> dict:
        dest = str((await json_body(request)).get("dest") or "")
        if not dest:
            raise HTTPException(400, "dest required")
        try:
            copied = lib.copy_asset(aid, dest)
        except Exception as e:
            raise HTTPException(400, str(e)) from e
        return {"path": copied}

    @app.post("/api/install-ffmpeg")
    def install_ffmpeg() -> JSONResponse:
        ok, msg = offer_ffmpeg_install()
        if ok:
            lib.ffmpeg = find_ffmpeg()
        return JSONResponse({"ok": ok, "message": msg, "ffmpeg": bool(lib.ffmpeg)})

    @app.get("/api/health")
    def health() -> dict:
        return {"ok": True, "name": "Sight"}

    @app.post("/api/heartbeat")
    def heartbeat() -> dict:
        app.state.last_heartbeat = time.time()
        return {"ok": True}

    @app.get("/api/version")
    def version() -> dict:
        return {"buildMs": BUILD_TIME_MS}

    @app.get("/api/settings")
    def get_settings() -> JSONResponse:
        return JSONResponse(settings.snapshot(), headers={"Cache-Control": "no-store"})

    @app.put("/api/settings/ui")
    async def put_settings_ui(request: Request) -> dict:
        if not settings.set_ui(await json_body(request)):
            raise HTTPException(400, "invalid settings")
        return {"ok": True}

    @app.put("/api/settings/window")
    async def put_settings_window(request: Request) -> dict:
        if not settings.set_window(await json_body(request)):
            raise HTTPException(400, "invalid window geometry")
        return {"ok": True}

    @app.get("/api/defaults")
    def app_defaults() -> JSONResponse:
        # `dev` tells the page whether to offer "save as app defaults" at all.
        return JSONResponse(
            {"defaults": load_defaults(DEFAULTS_FILE), "dev": dev},
            headers={"Cache-Control": "no-store"},
        )

    # Developer-only: rewrites the defaults file that ships with the app. The route does not even
    # exist unless Sight was started in dev mode (never in a packaged build), so an end user has
    # no way to reach it — not a hidden button, an absent endpoint.
    if dev:
        @app.post("/api/dev/save-defaults")
        async def dev_save_defaults(request: Request) -> dict:
            if not save_defaults(DEFAULTS_FILE, await json_body(request)):
                raise HTTPException(400, "nothing to save")
            return {"ok": True, "path": str(DEFAULTS_FILE)}

    if STATIC.exists():
        app.mount("/static", StaticFiles(directory=STATIC), name="static")

    return app
