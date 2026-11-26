"""Sight's HTTP API and UI server (Starlette through app/web.py)."""

from __future__ import annotations

import asyncio
import importlib.util
import json
import math
import os
import queue
import re
import subprocess
import sys
import time
import unicodedata
from pathlib import Path

# Starlette with FastAPI's decorator shape (app/web.py): FastAPI + pydantic cost ~0.5 s per start.
from .web import App, FileResponse, HTTPException, JSONResponse, Request, Response, StaticFiles, StreamingResponse

from .fileinfo import NO_WINDOW
from .library import Bus, Library, find_ffmpeg, KIND_LABEL, SKIP_DIRS, normpath
from . import review
from .settings import SettingsStore, load_defaults, save_defaults
from .stt import SttError, SttService
from .trackers import TrackerError, Trackers, split_key, tracker_key, tracker_key_of_host
from .version import APP_VERSION

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
STARTED_AT = time.time()


class RevalidatedStatic(StaticFiles):
    """/static with `Cache-Control: no-cache`. Without a header the browser caches the modules by its own
    heuristic (a share of the file's age), so after an update the page (index.html is no-store) could run
    with last version's annotate.js / canvas.js / keys.js — a mixed app with dead buttons. no-cache keeps
    the cache but asks every time; the ETag answer is a 304 on localhost."""

    def file_response(self, *args, **kwargs):
        resp = super().file_response(*args, **kwargs)
        resp.headers["Cache-Control"] = "no-cache"
        return resp


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
            # A console-less PowerShell started by a background process has no window of its own
            # and no foreground rights, so an ownerless dialog can open behind the Sight window.
            # A hidden top-most form as the owner keeps the dialog on top.
            "$o = New-Object System.Windows.Forms.Form -Property @{TopMost = $true; ShowInTaskbar = $false}; "
            "if ($f.ShowDialog($o) -eq 'OK') { $f.SelectedPath }; $o.Dispose()"
        )
        r = subprocess.run(
            ["powershell", "-NoProfile", "-STA", "-Command", ps],
            capture_output=True, text=True,
            # Hide PowerShell's own console; the folder dialog it opens still shows.
            creationflags=NO_WINDOW,
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
        if sys.platform == "darwin":
            # External and network drives mount under /Volumes; the startup disk's entry there is a
            # link back to "/", already listed. Only /Volumes itself is read (DirEntry answers from
            # its listing), never a drive behind it: a stalled network share must not hang the picker.
            try:
                with os.scandir("/Volumes") as it:
                    vols = sorted(it, key=lambda e: e.name.lower())
            except OSError:
                vols = []
            for v in vols:
                try:
                    if v.name.startswith("."):
                        continue
                    if v.is_symlink():
                        if os.readlink(v.path).rstrip("/") == "":
                            continue
                    elif not v.is_dir(follow_symlinks=False):
                        continue
                except OSError:
                    continue
                drives.append({"name": v.name, "path": v.path})
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
    return fs_list_dir_checked(path)[0]


def fs_list_dir_checked(path: Path) -> tuple[list[dict], bool]:
    """fs_list_dir plus whether the listing was refused (macOS privacy protection gives EPERM for
    Desktop, Documents, Downloads and external drives until Sight is allowed)."""
    out: list[dict] = []
    try:
        entries = sorted(path.iterdir(), key=lambda e: e.name.lower())
    except PermissionError:
        return out, True
    except OSError:
        return out, False
    for e in entries:
        if e.name in SKIP_DIRS or e.name.startswith("."):
            continue
        try:
            if e.is_dir():
                out.append({"name": e.name, "path": str(e)})
        except OSError:
            continue
    return out, False


def reveal_path(path: str) -> None:
    reveal_paths([path])


def _win_select_in_folder(folder: str, files: list[str]) -> bool:
    """Opens one Explorer window on `folder` with every one of `files` selected. `explorer /select,`
    only takes a single file, so this goes through the shell API instead. An Explorer window already
    showing that folder is reused. False if the call failed, so the caller can fall back."""
    import ctypes
    from ctypes import wintypes

    shell32, ole32 = ctypes.windll.shell32, ctypes.windll.ole32
    shell32.ILCreateFromPathW.restype = ctypes.c_void_p
    shell32.ILCreateFromPathW.argtypes = [wintypes.LPCWSTR]
    shell32.ILFree.argtypes = [ctypes.c_void_p]
    shell32.SHOpenFolderAndSelectItems.argtypes = [ctypes.c_void_p, wintypes.UINT, ctypes.POINTER(ctypes.c_void_p), wintypes.DWORD]
    ole32.CoInitializeEx(None, 2)  # COINIT_APARTMENTTHREADED; S_FALSE if this worker thread already has COM
    pidls = []
    try:
        folder_pidl = shell32.ILCreateFromPathW(folder)
        if not folder_pidl:
            return False
        pidls.append(folder_pidl)
        items = [p for p in (shell32.ILCreateFromPathW(f) for f in files) if p]
        pidls.extend(items)
        arr = (ctypes.c_void_p * len(items))(*items)
        return shell32.SHOpenFolderAndSelectItems(folder_pidl, len(items), arr, 0) == 0
    except OSError:
        return False
    finally:
        for p in pidls:
            shell32.ILFree(p)


def reveal_paths(paths: list[str]) -> int:
    """Shows files in the OS file manager: one window per parent folder, with all of that folder's
    files selected. Files that no longer exist are skipped (their folder still opens if it exists).
    Returns the number of windows opened."""
    import subprocess
    import sys

    groups: dict[str, list[str]] = {}
    for p in paths:
        parent = os.path.dirname(p)
        files = groups.setdefault(parent, [])
        if os.path.exists(p) and p not in files:
            files.append(p)
    opened = 0
    for folder, files in groups.items():
        if not os.path.isdir(folder):
            continue
        opened += 1
        if sys.platform == "win32":
            if files and _win_select_in_folder(folder, files):
                continue
            subprocess.Popen(["explorer", "/select,", files[0]] if files else ["explorer", folder])
        elif sys.platform == "darwin":
            if not files:
                subprocess.Popen(["open", folder])
                continue
            refs = ", ".join('POSIX file "%s"' % f.replace("\\", "\\\\").replace('"', '\\"') for f in files)
            subprocess.Popen(["osascript", "-e", f'tell application "Finder" to reveal {{{refs}}}', "-e", 'tell application "Finder" to activate'])
        else:
            subprocess.Popen(["xdg-open", folder])
    return opened


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
            subprocess.Popen(
                ["cmd", "/c", "start", "", path], shell=False,
                creationflags=NO_WINDOW,
            )
        return
    subprocess.Popen(["xdg-open", path])


def file_uri_to_path(raw: str) -> str:
    """A dropped ``file://`` URL or an OS path. Empty if it is not a local path."""
    from urllib.parse import unquote, urlparse

    s = (raw or "").strip()
    if not s or s.startswith("#"):
        return ""
    s = s.split("\t", 1)[0].strip()  # text/x-moz-url: URL then title
    if not s.lower().startswith("file:"):
        if s.startswith("\\\\") or (len(s) >= 3 and s[1] == ":" and s[2] in "\\/"):
            return s
        if s.startswith("/") and "://" not in s:
            return s
        return ""
    u = urlparse(s)
    path = unquote(u.path or "")
    host = unquote(u.netloc or "")
    if host and host.lower() not in ("localhost", "127.0.0.1"):
        return "\\\\" + host + path.replace("/", "\\")
    if os.name == "nt" and len(path) >= 3 and path[0] == "/" and path[2] == ":":
        path = path[1:].replace("/", "\\")
    return path


def path_basename(path: str) -> str:
    """Folder name used to match a drop to an Explorer / Finder selection."""
    s = (path or "").replace("/", os.sep).replace("\\", os.sep)
    if len(s) == 3 and s[1] == ":" and s[2] == os.sep:
        return s  # C:\
    s = s.rstrip(os.sep)
    return os.path.basename(s) or s


def drop_name_key(name: str) -> str:
    """Case-folded NFC name so Finder NFD paths match the page's File.name."""
    return os.path.normcase(unicodedata.normalize("NFC", name or ""))


def path_is_dir(path: str) -> bool:
    try:
        return bool(path) and Path(path).expanduser().resolve().is_dir()
    except (OSError, ValueError, RuntimeError):
        return False


def path_is_file(path: str) -> bool:
    try:
        return bool(path) and Path(path).expanduser().resolve().is_file()
    except (OSError, ValueError, RuntimeError):
        return False


def os_manager_selected_paths() -> list[str]:
    """Paths currently selected in Explorer (Windows) or Finder (macOS). Empty elsewhere."""
    import subprocess

    try:
        if sys.platform == "win32":
            ps = (
                "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); "
                "$sh = New-Object -ComObject Shell.Application; $paths = @(); "
                "foreach ($w in @($sh.Windows())) { "
                "  try { $doc = $w.Document; if ($null -eq $doc) { continue }; "
                "    foreach ($i in @($doc.SelectedItems())) { "
                "      $p = [string]$i.Path; if ($p) { $paths += $p } "
                "    } } catch {} "
                "}; $paths | ForEach-Object { $_ }"
            )
            r = subprocess.run(
                ["powershell", "-NoProfile", "-STA", "-Command", ps],
                capture_output=True, timeout=3, creationflags=NO_WINDOW,
            )
            text = r.stdout.decode("utf-8", "replace")
        elif sys.platform == "darwin":
            script = (
                'tell application "Finder"\n'
                "  set out to \"\"\n"
                "  try\n"
                "    set sel to selection as alias list\n"
                "  on error\n"
                "    return \"\"\n"
                "  end try\n"
                "  repeat with i in sel\n"
                "    set out to out & POSIX path of i & linefeed\n"
                "  end repeat\n"
                "  return out\n"
                "end tell"
            )
            r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=3)
            text = r.stdout or ""
        else:
            return []
    except (OSError, subprocess.TimeoutExpired):
        return []
    out = []
    for line in text.splitlines():
        p = line.strip()
        if p and p not in out:
            out.append(p)
    return out


def os_manager_selected_dirs() -> list[str]:
    """Directories currently selected in Explorer (Windows) or Finder (macOS). Empty elsewhere."""
    return [p for p in os_manager_selected_paths() if path_is_dir(p)]


def os_manager_selected_files() -> list[str]:
    """Files currently selected in Explorer (Windows) or Finder (macOS). Empty elsewhere."""
    return [p for p in os_manager_selected_paths() if path_is_file(p)]


def drop_item_paths(
    paths: list[str],
    names: list[str],
    selected: list[str] | None = None,
    *,
    files: bool = False,
) -> tuple[list[str], list[dict]]:
    """Resolve dropped folders (default) or files to OS paths.

    `paths` come from the page (``File.path``, ``file://`` URLs). `names` are the
    dropped item names (for Explorer / Finder selection when the browser hides
    the path). `selected` is that selection; ``None`` reads it from the OS.

    Returns (resolved paths, missed [{name, reason}]).
    """
    check = path_is_file if files else path_is_dir
    resolved: list[str] = []
    seen: set[str] = set()
    have: set[str] = set()

    def take(path: str) -> bool:
        try:
            real = str(Path(path).expanduser().resolve())
        except (OSError, ValueError, RuntimeError):
            return False
        if not check(real):
            return False
        key = os.path.normcase(real)
        if key in seen:
            return True
        seen.add(key)
        resolved.append(real)
        have.add(drop_name_key(path_basename(real)))
        return True

    for raw in paths:
        p = file_uri_to_path(raw if isinstance(raw, str) else "")
        if p:
            take(p)

    need = []
    for n in names:
        if not isinstance(n, str):
            continue
        name = n.strip()
        if not name:
            continue
        if drop_name_key(name) in have:
            continue
        need.append(name)

    missed: list[dict] = []
    if need:
        if selected is not None:
            sel = selected
        else:
            sel = os_manager_selected_files() if files else os_manager_selected_dirs()
        by: dict[str, list[str]] = {}
        for p in sel:
            if not check(p):
                continue
            by.setdefault(drop_name_key(path_basename(p)), []).append(p)
        still = []
        for name in need:
            hits = by.get(drop_name_key(name), [])
            uniq: list[str] = []
            keys: set[str] = set()
            for p in hits:
                try:
                    k = os.path.normcase(str(Path(p).expanduser().resolve()))
                except (OSError, ValueError, RuntimeError):
                    continue
                if k not in keys:
                    keys.add(k)
                    uniq.append(p)
            if len(uniq) == 1:
                take(uniq[0])
            elif len(uniq) > 1:
                missed.append({"name": name, "reason": "ambiguous"})
            else:
                still.append(name)
        for name in still:
            missed.append({"name": name, "reason": "unknown"})
    return resolved, missed


def drop_folder_paths(
    paths: list[str],
    names: list[str],
    selected: list[str] | None = None,
) -> tuple[list[str], list[dict]]:
    """Resolve dropped folders to directory paths. See ``drop_item_paths``."""
    return drop_item_paths(paths, names, selected, files=False)


def drop_file_paths(
    paths: list[str],
    names: list[str],
    selected: list[str] | None = None,
) -> tuple[list[str], list[dict]]:
    """Resolve dropped files to file paths. See ``drop_item_paths``."""
    return drop_item_paths(paths, names, selected, files=True)


def usdz_problem(a: dict | None) -> str:
    """Why a .usdz could not be turned into glTF, for the viewer's placeholder."""
    if not a:
        return "this file is no longer in the library"
    if not Path(a["path"]).exists():
        return "this file is missing from disk"
    # find_spec only: importing pxr here would load the whole USD runtime just to explain an error.
    importlib.invalidate_caches()  # a usd-core installed while the server runs must be seen
    if importlib.util.find_spec("pxr") is None:
        if getattr(sys, "frozen", False):
            return "USDZ needs the usd-core library, which is missing from this build"
        return f"USDZ needs the usd-core library: {sys.executable} -m pip install usd-core"
    return "this USDZ could not be converted"


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


def _where_param(raw: str) -> object:
    """The filter builder's tree from /api/assets?where=<json> (None when absent); 400 when it is not JSON."""
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (ValueError, RecursionError) as e:
        raise HTTPException(400, "where: not JSON") from e


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


def build_app(lib: Library, settings: SettingsStore | None = None, dev: bool = False) -> App:
    app = App()
    app.state.last_heartbeat = time.time()
    # When the page said it was closing (pagehide, ?bye=1) and no heartbeat came since; None otherwise.
    # Read only by the macOS Dock reopen (Sight.py / app/macapp.py), never by the quit watchdog, so a
    # reload (bye, then the new page's heartbeat) changes nothing.
    app.state.window_bye = None
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
            "ffmpeg": bool(lib.ffmpeg_exe()),
            "kinds": KIND_LABEL,
            "tags": lib.tags(),
            "collections": lib.collections(),
            "boards": lib.boards(),
            "scanIgnore": lib.ignore.text,
            "buildMs": BUILD_TIME_MS,
            "version": APP_VERSION,
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
        review: str = "",
        where: str = "",
    ) -> JSONResponse:
        lim = max(1, min(limit, 800))
        cond = _where_param(where)
        try:
            items = lib.list_assets(q, kind, source, tag, bool(missing), collection, offset, lim, folder, sort, order, review, cond)
            total = lib.count_filtered(q, kind, source, tag, bool(missing), collection, folder, review, cond) if offset == 0 else None
        except (ValueError, RecursionError) as e:  # a malformed filter-builder tree (Library.where_sql)
            raise HTTPException(400, str(e)) from e
        lib.first_page_served()  # the startup scan waited for this (Library.resume_watchers)
        # JSONResponse directly: the rows are plain JSON types already, and (under FastAPI) the
        # jsonable_encoder walk of a 400-item page cost ~12 ms more than the dump itself.
        return JSONResponse({"items": items, "offset": offset, "total": total})

    @app.post("/api/assets/by-ids")
    async def assets_by_ids(request: Request) -> JSONResponse:
        ids = (await json_body(request)).get("ids") or []
        if not isinstance(ids, list):
            raise HTTPException(400, "ids must be a list")
        items = await asyncio.to_thread(lib.assets_by_ids, ids[:5000])  # off the event loop
        return JSONResponse({"items": items})

    @app.get("/api/assets/{aid}")
    def one(aid: str) -> dict:
        a = lib.resolve_asset(aid)
        if not a:
            raise HTTPException(404)
        return a

    @app.get("/api/assets/{aid}/info")
    def info(aid: str) -> dict:
        sections = lib.file_info(aid)
        if sections is None:
            raise HTTPException(404)
        return {"sections": sections}

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
            # An untrusted (orphan) file is being rendered again; until then boards, which ask
            # for /api/thumb without waiting for the grid's "thumb" event, still get a picture —
            # never cached, so the new render replaces it on the next load.
            # Read whole (a few tens of KB), not streamed: an open file cannot be replaced on
            # Windows, which would make the render just queued fail on it.
            p = lib.thumb_file(aid)
            try:
                data = p.read_bytes() if p else None
            except OSError:
                data = None
            if not data:
                return JSONResponse({"ok": False, "queued": True}, status_code=202)
            media_type = "image/png" if p.suffix == ".png" else "image/jpeg"
            return Response(data, media_type=media_type, headers={"Cache-Control": "no-store"})
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
        try:
            done = lib.purge_missing(
                q=str(body.get("q") or ""),
                kind=str(body.get("kind") or ""),
                source_id=str(body.get("source") or ""),
                tag=str(body.get("tag") or ""),
                collection_id=str(body.get("collection") or ""),
                folder=str(body.get("folder") or ""),
                review=str(body.get("review") or ""),
                cond=body.get("where") or None,
            )
        except (ValueError, RecursionError) as e:  # a malformed filter-builder tree
            raise HTTPException(400, str(e)) from e
        return {"ok": True, **done}

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
        if not p and lib.usdz_is_animated(aid):
            # Not converted on purpose: the viewer reads an animated stage itself (index.html loadUsd).
            raise HTTPException(409, "this USDZ is animated: it is read in the viewer")
        if not p:
            # The reason goes to the viewer (index.html fetchBufferWithProgress): a missing USD library and
            # a file that does not convert look the same otherwise.
            raise HTTPException(404, usdz_problem(lib.resolve_asset(aid)))
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
        a = lib.resolve_asset(aid)
        if not a or not Path(a["path"]).exists():
            raise HTTPException(404)
        mt = media_type_for(a["path"])
        headers = {"Cache-Control": "private, max-age=60"}
        if a.get("kind") == "video":
            # The playback copy once one exists (see Library.start_playback_copy), else the source.
            return serve_video(request, lib.playback_path(a), lib.video_cache)
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

        def client_gen() -> int | None:
            # Who owns the windows. A late post from the previous owner (a lower gen) must not move them.
            raw = body.get("gen")
            if raw is None or isinstance(raw, bool):
                return None
            try:
                gen = int(raw)
            except (TypeError, ValueError):
                return None
            return gen if gen >= 0 else None

        if body.get("mb") is not None or body.get("ahead") is not None:
            try:
                mb = int(body["mb"]) if body.get("mb") is not None else None
            except (TypeError, ValueError):
                mb = None
            lib.video_cache.configure(mb, body.get("ahead"))  # ahead: percent of the window ahead of the playhead
        if body.get("release"):
            lib.video_cache.release(client_gen())
            return {"ok": True, "mb": lib.video_cache.budget_mb}
        if isinstance(body.get("items"), list):
            # The version compare: one window per clip, the budget split between them (SlidingVideoCache).
            focus = []
            clips: dict[str, str] = {}  # asset id -> playback path (the snapshot key)
            for it in body["items"][:32]:
                a = lib.get_asset(str(it.get("id") or "")) if isinstance(it, dict) else None
                if not a or a.get("kind") != "video" or not Path(a["path"]).exists():
                    continue
                try:
                    t, duration = float(it.get("t") or 0), float(it.get("duration") or 0)
                except (TypeError, ValueError):
                    t, duration = 0.0, 0.0
                if not (math.isfinite(t) and math.isfinite(duration)):
                    t, duration = 0.0, 0.0
                play = lib.playback_path(a)
                size = os.path.getsize(play)
                focus.append((play, max(0, min(size, int(size * (t / duration)) if duration > 0 else 0))))
                clips[str(a["id"])] = play
            lib.video_cache.focus_many(focus, gen=client_gen())
            snaps = lib.video_cache.snapshots(list(dict.fromkeys(clips.values())))
            sample = next(iter(snaps.values()), None)
            return {
                "ok": True,
                "files": len(focus),
                "mb": sample["mb"] if sample else lib.video_cache.budget_mb,
                "bytes": sample["bytes"] if sample else 0,
                # Per clip, keyed by asset id: the blocks actually in RAM (spans), so each timeline can draw them.
                "clips": {aid: snaps[p] for aid, p in clips.items()},
            }
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
        play = lib.playback_path(a)
        size = os.path.getsize(play)
        pos = int(size * (t / duration)) if duration > 0 else 0
        pos = max(0, min(size, pos))

        # A sequence's neighbours: the part of the window past the clip's end / start goes to them.
        def neighbour(key: str) -> str:
            nid = str(body.get(key) or "")
            n = lib.get_asset(nid) if nid and nid != aid else None
            if not n or n.get("kind") != "video" or not Path(n["path"]).exists():
                return ""
            return str(lib.playback_path(n))

        lib.video_cache.focus(play, pos, neighbour("next"), neighbour("prev"), client_gen())
        snap = lib.video_cache.snapshot(play)
        snap.update({"ok": True, "pos": pos, "mb": lib.video_cache.budget_mb})
        return snap

    @app.get("/api/video/cache")
    def video_cache_state(aid: str = "", aids: str = "") -> dict:
        # aids: several clips at once (a sequence, a comparison). Each entry is that file's real RAM
        # runs; bytes / mb / busy are the cache as a whole, same as a one-file snapshot.
        ids = [x.strip() for x in aids.split(",") if x.strip()][:64] if aids.strip() else []
        if ids:
            paths: dict[str, str] = {}
            for i in ids:
                a = lib.get_asset(i)
                if not a or a.get("kind") != "video":
                    continue
                paths[i] = str(lib.playback_path(a))
            snaps = lib.video_cache.snapshots(list(dict.fromkeys(paths.values())))
            files = {i: snaps[p] for i, p in paths.items()}
            sample = next(iter(files.values()), None)
            base = sample or lib.video_cache.snapshot()
            return {"files": files, "bytes": base["bytes"], "mb": base["mb"], "busy": base["busy"]}
        if not aid:
            return lib.video_cache.snapshot()
        a = lib.get_asset(aid)
        if not a or a.get("kind") != "video":
            raise HTTPException(404)
        return lib.video_cache.snapshot(lib.playback_path(a))

    @app.post("/api/video/transcode")
    async def video_transcode_start(request: Request) -> dict:
        # Asked by the player when the browser shows no picture for the file (see index.html
        # convertForPlayback). Returns at once; the conversion runs in the background.
        body = await json_body(request)
        return await asyncio.to_thread(lib.start_playback_copy, str(body.get("id") or ""))  # ffmpeg probes

    @app.get("/api/video/transcode")
    def video_transcode_state(aid: str = "") -> dict:
        return lib.playback_status(aid)

    # Scrub copy (Library.start_scrub_copy): asked by the lightbox once a seek of the clip is slow.
    @app.post("/api/video/scrub")
    async def video_scrub_start(request: Request) -> dict:
        body = await json_body(request)
        return await asyncio.to_thread(lib.start_scrub_copy, str(body.get("id") or ""))

    @app.get("/api/video/scrub")
    def video_scrub_state(aid: str = "") -> dict:
        return lib.scrub_status(aid)

    @app.get("/api/video/scrub/{aid}")
    def video_scrub_file(aid: str, request: Request):
        p = lib.scrub_copy_path(aid)
        if not p:
            raise HTTPException(404)
        return serve_video(request, str(p), lib.video_cache)  # not the window's file: read from disk

    # Scrub audio (Library.start_scrub_audio): mono s16le PCM, played by the lightbox while a drag
    # scrubs. The file URL is stable per asset; `rev` (the source stamp) is only a cache-buster.
    @app.post("/api/video/scrub-audio")
    async def video_scrub_audio_start(request: Request) -> dict:
        body = await json_body(request)
        return await asyncio.to_thread(lib.start_scrub_audio, str(body.get("id") or ""))

    @app.get("/api/video/scrub-audio")
    def video_scrub_audio_state(aid: str = "") -> dict:
        return lib.scrub_audio_status(aid)

    @app.get("/api/video/scrub-audio/{aid}")
    def video_scrub_audio_file(aid: str):
        p = lib.scrub_audio_path(aid)
        if not p:
            raise HTTPException(404)
        return FileResponse(
            p, media_type="application/octet-stream",
            headers={"X-Audio-Rate": str(lib.SCRUB_AUDIO_SR), "Cache-Control": "private"},
        )

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
        # a tracker project's smart collection: {tracker: "<kind>:<host>", trackerProject}; the pre-5b form
        # {sgSite: host, sgProject} is still read (= tracker "shotgrid:<host>")
        tkey, tproj = body.get("tracker") or None, body.get("trackerProject")
        if tkey is None and body.get("sgSite"):
            if not isinstance(body.get("sgSite"), str):
                raise HTTPException(400, "sgSite must be a string")
            if body.get("rule") is not None:   # (without a rule: a plain collection, the sg fields ignored — as before)
                tproj = body.get("sgProject")
                if not isinstance(tproj, int) or isinstance(tproj, bool):
                    raise HTTPException(400, "sgProject must be a number")
                tkey = tracker_key_of_host("shotgrid", body["sgSite"])   # (a host as URL.host gave it)
                if not tkey:
                    raise HTTPException(400, "sgSite must be a host")
        if tkey is not None and not split_key(tkey):
            raise HTTPException(400, "tracker must be a tracker key (<kind>:<host>)")
        try:
            return lib.add_collection(name, str(parent) if parent else None, body.get("rule"), tkey, tproj)
        except ValueError as e:
            raise HTTPException(400, str(e)) from None

    @app.patch("/api/collections/{cid}")
    async def rename_collection(cid: str, request: Request) -> dict:
        body = await json_body(request)
        if "rule" in body:   # (first: a refused rule changes nothing else)
            try:
                lib.set_collection_rule(cid, body.get("rule"))
            except ValueError as e:
                raise HTTPException(400, str(e)) from None
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
    def annotations_for_asset(asset_id: str = "", board_id: str = "", deleted: str = "") -> list[dict]:
        if board_id:
            return lib.annotations_for_board(board_id)
        if not asset_id:
            raise HTTPException(400, "asset_id or board_id required")
        return lib.annotations_for_asset(asset_id, with_deleted=deleted == "1")

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

    # ---- Review sessions (annotations + notes on one asset; see app/review.py) ----------------

    @app.post("/api/review/shots")
    async def add_review_shot(request: Request) -> dict:
        data = await request.body()
        if not data or len(data) > 64 * 1048576:
            raise HTTPException(400, "image body required")
        sid = await asyncio.to_thread(review.save_shot, lib.root, data)
        return {"id": sid, "url": f"/api/review/shots/{sid}"}

    @app.get("/api/review/shots/{sid}")
    def review_shot(sid: str) -> FileResponse:
        p = review.shot_path(lib.root, sid)
        if not p:
            raise HTTPException(404)
        return FileResponse(p, headers={"Cache-Control": "max-age=31536000, immutable"})

    # Review panel previews, stored by the browser (Library.note_previews).
    @app.get("/api/review/nprev/{aid}")
    def note_previews(aid: str) -> dict:
        return lib.note_previews(aid)

    @app.get("/api/review/nprev/{aid}/{key}.jpg")
    def note_preview(aid: str, key: str) -> FileResponse:
        p = lib.note_preview_path(aid, key)
        if not p:
            raise HTTPException(404)
        return FileResponse(p, media_type="image/jpeg", headers={"Cache-Control": "max-age=31536000, immutable"})

    @app.put("/api/review/nprev/{aid}/{key}")
    async def put_note_preview(aid: str, key: str, request: Request, v: str = "") -> dict:
        if int(request.headers.get("content-length") or 0) > lib.NPREV_MAX_BYTES:
            raise HTTPException(413, "too large")
        data = await request.body()
        if not await asyncio.to_thread(lib.save_note_preview, aid, key, data, v):
            raise HTTPException(400, "bad preview")
        return {"ok": True}

    @app.post("/api/review/nprev/{aid}/prune")
    async def prune_note_previews(aid: str, request: Request) -> dict:
        body = await json_body(request)
        keep = body.get("keep")
        if not isinstance(keep, list):
            raise HTTPException(400, "keep list required")
        return {"removed": await asyncio.to_thread(lib.prune_note_previews, aid, keep)}

    def _review_out(path: Path, reveal: bool) -> dict:
        if reveal:
            try:
                reveal_paths([str(path)])
            except OSError:  # no file manager (headless box): the path is still reported
                pass
        return {"ok": True, "path": str(path), "name": path.name}

    @app.post("/api/review/export/pdf")
    async def export_review_pdf(request: Request) -> dict:
        body = await json_body(request)
        a = lib.get_asset(str(body.get("asset_id") or ""))
        stem = review.safe_name(f"{Path(a['name']).stem if a else 'Sight'} review")
        out = review.unique_path(review.export_dir(lib.root), stem, ".pdf")
        try:
            pages = await asyncio.to_thread(review.build_pdf, body, lib.root, out)
        except Exception as e:  # PyMuPDF / Pillow errors: report, don't 500 with a traceback
            raise HTTPException(500, f"PDF export failed: {e}")
        res = await asyncio.to_thread(_review_out, out, bool(body.get("reveal", True)))
        return {**res, "pages": pages}

    @app.post("/api/review/export/zip")
    async def export_review_zip(request: Request) -> dict:
        body = await json_body(request)
        a = lib.get_asset(str(body.get("asset_id") or ""))
        if not a:
            raise HTTPException(404)
        stem = review.safe_name(f"{Path(a['name']).stem} notes")
        out = review.unique_path(review.export_dir(lib.root), stem, ".zip")
        try:
            notes, pictures = await asyncio.to_thread(review.build_zip, body, lib.root, out, a["name"])
        except Exception as e:  # a bad picture / a full disk: report, don't 500 with a traceback
            out.unlink(missing_ok=True)
            raise HTTPException(500, f"ZIP export failed: {e}")
        res = await asyncio.to_thread(_review_out, out, bool(body.get("reveal", True)))
        return {**res, "notes": notes, "pictures": pictures}

    # A sequence's review in one file (index.html seqExportAll): every clip's report (gatherReport) in order.
    async def _all_reports(request: Request) -> tuple[list, list, dict]:
        body = await json_body(request)
        reps = [r for r in body.get("reports") or [] if isinstance(r, dict)]
        if not reps or len(reps) > 500:
            raise HTTPException(400, "reports required")
        names = []
        for r in reps:
            a = lib.get_asset(str(r.get("asset_id") or ""))
            names.append(a["name"] if a else "clip")
        return reps, names, body

    @app.post("/api/review/export/pdf-all")
    async def export_review_pdf_all(request: Request) -> dict:
        reps, names, body = await _all_reports(request)
        stem = review.safe_name(f"Sequence review ({len(reps)} clips)")
        out = review.unique_path(review.export_dir(lib.root), stem, ".pdf")
        try:
            pages = await asyncio.to_thread(review.build_pdf_all, reps, lib.root, out, f"Review — {', '.join(names)}"[:300])
        except Exception as e:  # PyMuPDF / Pillow errors: report, don't 500 with a traceback
            out.unlink(missing_ok=True)
            raise HTTPException(500, f"PDF export failed: {e}")
        res = await asyncio.to_thread(_review_out, out, bool(body.get("reveal", True)))
        return {**res, "pages": pages}

    @app.post("/api/review/export/zip-all")
    async def export_review_zip_all(request: Request) -> dict:
        reps, names, body = await _all_reports(request)
        stem = review.safe_name(f"Sequence notes ({len(reps)} clips)")
        out = review.unique_path(review.export_dir(lib.root), stem, ".zip")
        try:
            notes, pictures = await asyncio.to_thread(review.build_zip_all, reps, lib.root, out, names)
        except Exception as e:
            out.unlink(missing_ok=True)
            raise HTTPException(500, f"ZIP export failed: {e}")
        res = await asyncio.to_thread(_review_out, out, bool(body.get("reveal", True)))
        return {**res, "notes": notes, "pictures": pictures}

    @app.post("/api/review/export/html")
    async def export_review_html(request: Request) -> dict:
        body = await json_body(request)
        a = lib.get_asset(str(body.get("asset_id") or ""))
        if not a:
            raise HTTPException(404)
        rows = lib.annotations_for_asset(a["id"])
        pkg = review.build_package(a, rows, lib.root, str(body.get("author") or ""), APP_VERSION,
                                   lib.annotation_tombstones(a["id"]))
        report = {k: body.get(k) for k in ("title", "subtitle", "meta", "cover", "coverSize", "notes", "media")}
        page = await asyncio.to_thread(review.build_html, report, pkg)
        stem = review.safe_name(f"{Path(a['name']).stem} review")
        out = review.unique_path(review.export_dir(lib.root), stem, ".html")
        out.write_text(page, encoding="utf-8")
        return await asyncio.to_thread(_review_out, out, bool(body.get("reveal", True)))

    # A sequence's review as one web page (index.html seqExportAll "html"): per report the clip's package; one
    # report makes a plain one-clip page (review.build_html_all).
    @app.post("/api/review/export/html-all")
    async def export_review_html_all(request: Request) -> dict:
        reps, names, body = await _all_reports(request)
        author = str(body.get("author") or "")
        missing: list[str] = []

        def build() -> tuple[str, int, str]:
            clips, seen, first = [], set(), ""
            for r, name in zip(reps, names):
                a = lib.get_asset(str(r.get("asset_id") or ""))
                if not a:  # (_all_reports names it "clip": the report's title is the clip's name)
                    missing.append(str(r.get("title") or name))
                if not a or a["id"] in seen:
                    continue
                seen.add(a["id"])
                first = first or a["name"]
                pkg = review.build_package(a, lib.annotations_for_asset(a["id"]), lib.root, author, APP_VERSION,
                                           lib.annotation_tombstones(a["id"]))
                clips.append(({k: r.get(k) for k in ("title", "subtitle", "meta", "cover", "coverSize", "notes", "media")}, pkg))
            if not clips:
                raise HTTPException(404, "none of the clips is in the library")
            title = f"Sequence review — {len(clips)} clip{'' if len(clips) == 1 else 's'}"
            return review.build_html_all(clips, APP_VERSION, title), len(clips), first

        page, n, first = await asyncio.to_thread(build)
        stem = review.safe_name(f"Sequence review ({n} clips)" if n > 1 else f"{Path(first).stem} review")
        out = review.unique_path(review.export_dir(lib.root), stem, ".html")
        out.write_text(page, encoding="utf-8")
        res = await asyncio.to_thread(_review_out, out, bool(body.get("reveal", True)))
        return {**res, "clips": n, "missing": missing}

    @app.post("/api/review/export/package")
    async def export_review_package(request: Request) -> dict:
        body = await json_body(request)
        a = lib.get_asset(str(body.get("asset_id") or ""))
        if not a:
            raise HTTPException(404)
        rows = lib.annotations_for_asset(a["id"])
        pkg = review.build_package(a, rows, lib.root, str(body.get("author") or ""), APP_VERSION,
                                   lib.annotation_tombstones(a["id"]))
        stem = review.safe_name(f"{Path(a['name']).stem} review")
        out = review.unique_path(review.export_dir(lib.root), stem, review.PACKAGE_EXT)
        out.write_text(json.dumps(pkg, ensure_ascii=False), encoding="utf-8")
        return await asyncio.to_thread(_review_out, out, bool(body.get("reveal", True)))

    # A sequence's review files in one bundle (index.html seqExportAll "pkg"): the clips, in order, that
    # have notes or tombstones (all notes deleted since the last send still has to reach the reviewer).
    @app.post("/api/review/export/package-all")
    async def export_review_package_all(request: Request) -> dict:
        body = await json_body(request)
        raw_ids = body.get("asset_ids")
        ids = list(dict.fromkeys(str(x) for x in raw_ids if x)) if isinstance(raw_ids, list) else []
        if not ids or len(ids) > 500:
            raise HTTPException(400, "asset_ids required")
        author = str(body.get("author") or "")

        def build() -> list:
            pkgs = []
            for aid in ids:
                a = lib.get_asset(aid)
                if not a:
                    continue
                rows = lib.annotations_for_asset(a["id"])
                dead = lib.annotation_tombstones(a["id"])
                if not dead and not any(r["kind"] == "note" and not (isinstance(r.get("data"), dict) and r["data"].get("deleted"))
                                       for r in rows):
                    continue
                pkgs.append(review.build_package(a, rows, lib.root, author, APP_VERSION, dead))
            return pkgs

        pkgs = await asyncio.to_thread(build)
        if not pkgs:
            return {"ok": True, "clips": 0}
        title = f"Sequence review — {len(pkgs)} clip{'' if len(pkgs) == 1 else 's'}"
        bundle = review.build_bundle(pkgs, author, APP_VERSION, title)
        stem = review.safe_name(f"Sequence review ({len(pkgs)} clip{'' if len(pkgs) == 1 else 's'})")
        out = review.unique_path(review.export_dir(lib.root), stem, review.PACKAGE_EXT)
        out.write_text(json.dumps(bundle, ensure_ascii=False), encoding="utf-8")
        res = await asyncio.to_thread(_review_out, out, bool(body.get("reveal", True)))
        return {**res, "clips": len(pkgs)}

    @app.get("/api/assets/{aid}/versions")
    def asset_versions(aid: str) -> dict:
        return {"items": lib.asset_versions(aid)}

    @app.put("/api/assets/{aid}/review-status")
    async def put_review_status(aid: str, request: Request) -> dict:
        body = await json_body(request)
        if not lib.get_asset(aid):
            raise HTTPException(404)
        try:
            res = lib.set_review_status(aid, str(body.get("state") or ""), str(body.get("author") or ""))
        except ValueError as e:
            raise HTTPException(400, str(e))
        lib.bus.publish({"type": "batch", "n": 0})
        return res

    @app.post("/api/review/import")
    async def import_review(request: Request) -> dict:
        # A plain package: {ok, asset_id, added, updated, deleted, author}; 404 when its media is not
        # in the library, 400 for a damaged file. A bundle: always 200, per clip in `results`.
        # ?restore=1: also bring back rows deleted here (`deleted_here` in the first answer).
        raw = await request.body()
        # &before=<ms>: only rows deleted at or before it (the first answer's `at`).
        restore = request.query_params.get("restore") == "1"
        try:
            before = int(request.query_params.get("before") or 0) or None
        except ValueError:
            before = None
        try:
            res = await asyncio.to_thread(review.import_review_file, lib, raw, restore, before)
        except ValueError as e:
            raise HTTPException(400, str(e))
        if not res.get("ok"):
            return JSONResponse(res, status_code=404)
        return res

    @app.get("/api/events")
    def events():
        q = lib.bus.subscribe()

        # Async, polling the thread queue: a blocking q.get() in a sync generator kept one worker
        # thread of the shared pool busy per open window for good, so a few windows could starve
        # every other (sync) request of threads.
        async def gen():
            try:
                if lib.bus.closed:  # opened after Bus.close (an EventSource reconnecting during Quit)
                    return
                yield f"data: {json.dumps({'type': 'hello'})}\n\n"
                idle = 0.0
                pulse = 0.0
                while True:
                    try:
                        ev = q.get_nowait()
                    except queue.Empty:
                        await asyncio.sleep(0.1)
                        idle += 0.1
                        pulse += 0.1
                        # The packaged watchdog (Sight.py) quits when /api/heartbeat goes quiet for 10 s.
                        # A ShotGrid grid's thumbnails can hold every browser socket for the whole remote
                        # round trip, so that ping cannot leave. This stream is the window: while it is
                        # open the process stays up, and it ends when the window itself closes.
                        if pulse >= 1.0:
                            pulse = 0.0
                            app.state.last_heartbeat = time.time()
                        if idle >= 15:
                            idle = 0.0
                            yield ":\n\n"
                        continue
                    if ev is Bus.CLOSE:  # server shutting down (Bus.close): end the stream
                        return
                    idle = 0.0
                    yield f"data: {json.dumps(ev)}\n\n"
            finally:
                lib.bus.unsubscribe(q)

        return StreamingResponse(
            gen(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    def try_add_source(path: str) -> tuple[dict | None, str | None]:
        # A folder deleted / a drive unplugged while the picker was open: a 400 with the reason, not a 500.
        # Checked here, not by catching OSError around add_source: that also raises from the watcher
        # (inotify limit, network share) after the row is saved, which is not a rejected folder.
        # Checked on the resolved path, the one add_source stores (a link such as Windows'
        # "My Documents" refuses listing itself while its target is readable).
        try:
            real = Path(path).expanduser().resolve()
            ok = real.is_dir()
        except (OSError, ValueError, RuntimeError):
            ok = False
        if not ok:
            return None, "Not a folder"
        try:
            with os.scandir(real) as it:
                next(it, None)
        except PermissionError:
            # A source the scanner cannot read would sit in the library with 0 files (macOS privacy).
            return None, ("No permission to read this folder"
                          + (" - allow Sight in System Settings > Privacy & Security > Files and Folders" if sys.platform == "darwin" else ""))
        except OSError:
            pass
        try:
            return lib.add_source(path), None
        except ValueError as e:  # gone between the check and add_source
            return None, str(e) or "Not a folder"

    def add_source_or_400(path: str) -> dict:
        got, err = try_add_source(path)
        if err:
            raise HTTPException(400, err)
        return got

    @app.post("/api/sources/pick")
    def pick() -> dict:
        path = pick_folder()
        if not path:
            return {"cancelled": True}
        return add_source_or_400(path)

    @app.get("/api/fs/roots")
    def fs_roots_route() -> dict:
        return fs_roots()

    @app.get("/api/fs/list")
    def fs_list_route(path: str = "") -> dict:
        # abspath, not resolve(): on Windows resolve() turns a mapped network drive (Z:\) into its
        # UNC path, so the browser would leave the drive the user picked. add_source still resolves.
        try:
            p = Path(os.path.abspath(path)) if path else Path.home()
        except (OSError, ValueError):
            raise HTTPException(400, "invalid path")
        if not p.exists() or not p.is_dir():
            raise HTTPException(400, "not a directory")
        parent = p.parent
        # A refused listing (macOS privacy protection) is reported, not shown as an empty folder.
        dirs, denied = fs_list_dir_checked(p)
        return {
            "path": str(p),
            "parent": str(parent) if parent != p else None,
            "dirs": dirs,
            "denied": denied,
        }

    @app.post("/api/sources")
    async def add_source(request: Request) -> dict:
        path = str((await json_body(request)).get("path") or "")
        if not path:
            raise HTTPException(400, "path required")
        return add_source_or_400(path)

    @app.post("/api/sources/drop")
    async def drop_sources(request: Request) -> dict:
        # Folders dropped on the window: paths the page could read (File.path / file://) plus
        # folder names matched to the Explorer / Finder selection (Chromium hides the OS path).
        body = await json_body(request)
        raw_paths = body.get("paths") if isinstance(body.get("paths"), list) else []
        raw_names = body.get("names") if isinstance(body.get("names"), list) else []
        paths = [p for p in raw_paths if isinstance(p, str)]
        names = [n for n in raw_names if isinstance(n, str)]
        found, missed = await asyncio.to_thread(drop_folder_paths, paths, names)
        if len(found) > 32:
            for p in found[32:]:
                missed.append({"name": path_basename(p), "reason": "too many"})
            found = found[:32]
        have = {r["id"] for r in lib.sources()}
        added = []
        for p in found:
            got, err = try_add_source(p)
            if err:
                missed.append({"name": path_basename(p), "reason": "rejected", "detail": err})
                continue
            added.append({**got, "new": got["id"] not in have})
            have.add(got["id"])
        return {"added": added, "missed": missed}

    @app.post("/api/files/drop")
    async def drop_files(request: Request) -> dict:
        # Files dropped on the window: same path resolution as folders (File.path / file:// /
        # Explorer or Finder name match). mode=library indexes them (Dropped files source, or
        # their existing source); mode=view opens them without a library row.
        body = await json_body(request)
        raw_paths = body.get("paths") if isinstance(body.get("paths"), list) else []
        raw_names = body.get("names") if isinstance(body.get("names"), list) else []
        paths = [p for p in raw_paths if isinstance(p, str)]
        names = [n for n in raw_names if isinstance(n, str)]
        mode = body.get("mode") if body.get("mode") in ("library", "view") else "view"
        found, missed = await asyncio.to_thread(drop_file_paths, paths, names)
        if len(found) > 32:
            for p in found[32:]:
                missed.append({"name": path_basename(p), "reason": "too many"})
            found = found[:32]
        items = []
        for p in found:
            if mode == "library":
                got, err, new = lib.add_dropped_file(p)
            else:
                got, err = lib.view_file(p)
                new = False
            if err:
                missed.append({"name": path_basename(p), "reason": err})
                continue
            if got:
                items.append({**got, "new": new})
        return {"items": items, "missed": missed, "mode": mode}

    @app.put("/api/scan/ignore")
    async def scan_ignore(request: Request) -> dict:
        text = (await json_body(request)).get("text")
        if not isinstance(text, str) or len(text) > 20000:
            raise HTTPException(400, "text required")
        return lib.set_ignore(text)

    @app.get("/api/scan/defaults")
    def scan_defaults() -> dict:
        return {"text": lib.default_filter, "custom": lib.default_custom}

    @app.put("/api/scan/defaults")
    async def put_scan_defaults(request: Request) -> dict:
        text = (await json_body(request)).get("text")
        if not isinstance(text, str) or len(text) > 50000:
            raise HTTPException(400, "text required")
        try:
            return lib.set_default_filter(text)
        except OSError as e:
            raise HTTPException(500, f"Cannot write the filter file in the Sight folder: {e.strerror or e}")

    @app.delete("/api/scan/defaults")
    def reset_scan_defaults() -> dict:
        try:
            return lib.set_default_filter(None)
        except OSError as e:
            raise HTTPException(500, f"Cannot remove the filter file in the Sight folder: {e.strerror or e}")

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

    @app.post("/api/assets/reveal")
    async def reveal_many(request: Request) -> dict:
        ids = (await json_body(request)).get("ids") or []
        paths = [a["path"] for a in (lib.get_asset(str(i)) for i in ids) if a]
        if not paths:
            raise HTTPException(404)
        return {"ok": True, "windows": await asyncio.to_thread(reveal_paths, paths)}

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
    def heartbeat(request: Request) -> dict:
        if request.query_params.get("bye") == "1":
            app.state.window_bye = time.time()
        else:
            app.state.last_heartbeat = time.time()
            app.state.window_bye = None
        return {"ok": True}

    @app.get("/api/version")
    def version() -> dict:
        return {"buildMs": BUILD_TIME_MS}

    _static_info: dict = {}
    _ffmpeg_info: dict = {}

    def static_info() -> dict:
        """Facts that cannot change while the process runs (tool versions); probed once, on first use."""
        if _static_info:
            return _static_info
        import platform

        info: dict = {"python": platform.python_version(), "platform": platform.platform(),
                      "frozen": bool(getattr(sys, "frozen", False))}
        try:
            import starlette

            info["starlette"] = starlette.__version__
        except Exception:
            info["starlette"] = ""
        try:  # the vendored three.js declares its revision as `const REVISION = '185'`
            m = re.search(r"const REVISION = '(\w+)'", (STATIC / "vendor" / "three.core.js").read_text(encoding="utf-8")[:20000])
            info["three"] = "r" + m.group(1) if m else ""
        except OSError:
            info["three"] = ""
        info["usd"] = ""
        if importlib.util.find_spec("pxr") is not None:
            try:
                from pxr import Usd

                info["usd"] = ".".join(str(n) for n in Usd.GetVersion())
            except Exception:
                info["usd"] = "installed (version unreadable)"
        _static_info.update(info)
        return _static_info

    def ffmpeg_info() -> dict:
        """ffmpeg path + version line; cached only once found AND probed, so an ffmpeg installed (or a
        probe that timed out) later shows up on the next open without a restart."""
        if _ffmpeg_info:
            return _ffmpeg_info
        exe = lib.ffmpeg_exe()
        out = {"ffmpegPath": exe or "", "ffmpegVersion": ""}
        if exe:
            try:
                text = subprocess.run([exe, "-version"], capture_output=True, text=True, timeout=5,
                                      creationflags=NO_WINDOW).stdout
                out["ffmpegVersion"] = (text.splitlines() or [""])[0]
            except Exception:
                pass
            if out["ffmpegVersion"]:
                _ffmpeg_info.update(out)
        return out

    @app.get("/api/app-info")
    def app_info() -> JSONResponse:
        """Technical facts for the About dialog (the brand mark in the sidebar)."""
        info = {**static_info(), **ffmpeg_info()}
        db = lib.root / "library.db"
        try:
            thumbs = sum(1 for e in os.scandir(lib.thumbs) if e.is_file())
        except OSError:
            thumbs = 0
        counts = {"assets": 0, "sources": 0}
        for key, table in (("assets", "assets"), ("sources", "sources")):
            try:
                counts[key] = int(lib.query(f"SELECT COUNT(*) c FROM {table}")[0]["c"])
            except Exception:
                pass
        info.update({
            "version": APP_VERSION,
            "buildMs": BUILD_TIME_MS,
            "home": str(lib.root),
            "dbPath": str(db),
            "dbBytes": db.stat().st_size if db.exists() else 0,
            "assets": counts["assets"],
            "sources": counts["sources"],
            "thumbnails": thumbs,
            "port": getattr(app.state, "port", None),  # set by the launcher; the Host header can lie behind a proxy
            "dev": dev,
            "uptimeSec": int(time.time() - STARTED_AT),
            "logPath": str(lib.root / "sight.log"),
        })
        return JSONResponse(info, headers={"Cache-Control": "no-store"})

    # Dictation through the user's own speech-to-text service (app/stt.py): the key is set here and never read back.
    stt = SttService(lib.root)

    @app.get("/api/stt/status")
    def stt_status() -> JSONResponse:
        return JSONResponse(stt.status(), headers={"Cache-Control": "no-store"})

    @app.put("/api/stt/config")
    async def stt_config(request: Request) -> dict:
        # JSON only: a cross-site "simple" POST/PUT cannot set it (application/json needs a preflight, never answered).
        if not request.headers.get("content-type", "").lower().startswith("application/json"):
            raise HTTPException(415, "json required")
        if not stt.configure(await json_body(request)):
            raise HTTPException(400, "invalid service settings")
        return stt.status()

    @app.post("/api/stt/transcribe")
    async def stt_transcribe(request: Request) -> JSONResponse:
        # Audio only: another site's form / text/plain "simple" POST is refused (an audio type needs a CORS
        # preflight, which this server never answers), so no page can spend the user's quota. Size first.
        ctype = request.headers.get("content-type", "")
        if not ctype.lower().startswith("audio/"):
            raise HTTPException(415, "audio required")
        try:
            size = int(request.headers.get("content-length") or 0)
        except ValueError:
            size = 0
        if size > 20 * 1048576:
            raise HTTPException(413, "audio too long")
        # Read with a cap: a chunked upload carries no Content-Length.
        buf = bytearray()
        async for chunk in request.stream():
            buf += chunk
            if len(buf) > 20 * 1048576:
                raise HTTPException(413, "audio too long")
        data = bytes(buf)
        lang = request.query_params.get("lang", "")
        try:
            text = await asyncio.to_thread(stt.transcribe, data, ctype, lang)  # a network call: off the event loop
        except SttError as e:
            return JSONResponse({"error": e.code}, status_code=502 if e.code in ("failed", "offline", "rate") else 412)
        return JSONResponse({"text": text}, headers={"Cache-Control": "no-store"})

    # Trackers (app/trackers.py, docs/ARCHITECTURE.md "Tracker adapters"): one adapter per configured site (ShotGrid
    # only yet, app/shotgrid.py, docs/SHOTGRID.md; several sites of one kind since 0.110). The generic routes are
    # /api/trackers/{ref}/… — ref = a tracker key "<kind>:<host>" (URL-encoded or not), or a kind = that kind's primary
    # site (Trackers.get: the first connected, else the first stored — the one site every pre-0.110 client knows); the
    # old /api/sg/… routes stay as aliases for kind "shotgrid" (the phone's and older pages' paths, the tests). status /
    # config / cache with `?spare=1` and a kind: the site Connect a tracker… sets up (Trackers.spare); cache with
    # `?idle=1` and a kind: the kind's cached media of no connected site. A tracker's credentials are set here and never
    # read back; the page's client talks to the tracker through …/fetch, which adds them.
    trk = Trackers(lib.root)

    def _adapter(ref: str, spare: bool = False, request: Request | None = None):
        try:
            if spare and ":" not in ref:
                pin = request.query_params.get("slot", "") if request is not None else ""
                a = trk.spare(ref, int(pin) if re.fullmatch(r"[0-9]{1,5}", pin) else None)   # (ASCII digits: "²" is a digit to isdigit)
            else:
                a = trk.resolve(ref)
        except TrackerError as e:
            raise HTTPException(e.status, str(e)) from None
        if a is None:
            raise HTTPException(404, "no such tracker")
        return a

    def _flag(request: Request | None, name: str) -> bool:
        return bool(request is not None and request.query_params.get(name) in ("1", "true"))

    def _sg_guard(request: Request) -> None:
        # Only Sight's own page: a custom header needs a CORS preflight, which this server never answers, so
        # another site open in the browser cannot make tracker calls with the user's key. The Host check stops DNS
        # rebinding (a site that points its own name at 127.0.0.1 would be same-origin and could send the header).
        if request.headers.get("x-sight") != "1":
            raise HTTPException(403, "Sight page only")
        _sg_local(request)

    def _sg_local(request: Request) -> None:
        host = (request.headers.get("host") or "").lower()
        name = host[1:host.index("]")] if host.startswith("[") and "]" in host else host.rsplit(":", 1)[0]
        if name not in ("127.0.0.1", "localhost", "::1"):
            raise HTTPException(403, "Sight page only")

    def _trk_err(e: TrackerError) -> JSONResponse:
        return JSONResponse({"errors": [{"title": str(e)}]}, status_code=e.status)

    def _cache_source_of(a) -> str:
        d = normpath(Path(a.media_dir()))
        return next((r["id"] for r in lib.query("SELECT id, path FROM sources") if normpath(Path(r["path"])) == d), "")

    # The connected trackers (docs/PLAN-trackers.md decisions 10, 11): the page shows a tracker's controls (sidebar
    # source, You-panel row, review panel link, Filter ▾ fields) only for an entry here. `kinds`: every adapter Sight
    # has (Settings → Trackers → Connect a tracker…); `cacheSources`: every adapter's media cache source, connected or
    # not (the sidebar never lists them).
    @app.get("/api/trackers")
    def trackers_list() -> JSONResponse:
        caches = [c for c in (_cache_source_of(a) for a in trk.all()) if c]
        return JSONResponse({"trackers": trk.connected(), "kinds": trk.kinds, "cacheSources": caches},
                            headers={"Cache-Control": "no-store"})

    def _status_of(a) -> JSONResponse:
        st = a.status()
        st["key"] = tracker_key(a.kind, a.site())   # (this site's tracker key; "" without a site)
        st["kind"] = a.kind
        st["slot"] = a.slot   # (a spare answer's slot: the page pins its later ?spare=1 requests to it with &slot=)
        st["cacheSource"] = _cache_source_of(a)   # (the sidebar hides it by id — paths may be spelled differently)
        return JSONResponse(st, headers={"Cache-Control": "no-store"})

    def trk_status(ref: str, request: Request | None = None) -> JSONResponse:
        return _status_of(_adapter(ref, _flag(request, "spare"), request))

    async def trk_config(ref: str, request: Request) -> JSONResponse:
        a = _adapter(ref, _flag(request, "spare"), request)
        if not request.headers.get("content-type", "").lower().startswith("application/json"):
            raise HTTPException(415, "json required")
        _sg_local(request)
        try:
            got = trk.configure(a, await json_body(request))
        except TrackerError as e:
            raise HTTPException(e.status, str(e)) from None
        if got is None:
            raise HTTPException(400, f"invalid {a.name} settings")
        return _status_of(got)   # (where the settings are now: its key may have changed with the save)

    async def trk_forward(kind: str, request: Request, method: str) -> Response:
        a = _adapter(kind)
        _sg_guard(request)
        url = request.query_params.get("url", "")
        sudo = request.query_params.get("sudo", "")[:200]
        body = None
        if method in ("POST", "PUT"):
            buf = bytearray()
            async for chunk in request.stream():
                buf += chunk
                if len(buf) > 512 * 1048576:
                    raise HTTPException(413, "too big")
            body = bytes(buf)
        # (Content-Range: Coreline's resumable uploads; ShotGrid's adapter forwards only Content-Type / Accept)
        hdrs = {k.lower(): v for k, v in request.headers.items() if k.lower() in ("content-type", "accept", "content-range")}
        try:
            status, ctype, data = await asyncio.to_thread(a.forward, method, url, body, hdrs, sudo)
        except TrackerError as e:
            return _trk_err(e)
        return Response(data, status_code=status, media_type=ctype or None, headers={"Cache-Control": "no-store"})

    # Media entities (a ShotGrid Version): thumbnails / filmstrips cached on disk, one opened as a library file (its
    # viewable media downloaded into the adapter's media cache, a source of its own that the sidebar does not list),
    # the media cache's size.
    async def trk_thumb(kind: str, mid: str, request: Request, pic: str, u: str) -> Response:
        a = _adapter(kind)
        _sg_local(request)   # an <img>: no X-Sight header; it only reads pictures (no token leaves the server)
        if request.headers.get("sec-fetch-site") == "cross-site":
            raise HTTPException(403, "Sight page only")   # another site embedding it (probing ids)
        try:
            got = await asyncio.to_thread(a.picture, a.parse_media_id(mid), "filmstrip" if pic == "filmstrip" else "image", u[:64])
        except TrackerError as e:
            return _trk_err(e)
        if not got:
            return Response(status_code=204)
        return FileResponse(got[0], media_type=got[1], headers={"Cache-Control": "max-age=86400"})

    cache_srcs: dict[str, dict] = {}   # kind -> its media cache's source, added once: {"id", "path", "for"}

    def _cache_source(a) -> dict:
        d = a.media_dir()
        src = cache_srcs.setdefault(a.kind, {})
        if src.get("for") != str(d) or not lib.query("SELECT 1 FROM sources WHERE id=?", (src.get("id", ""),)):
            d.mkdir(parents=True, exist_ok=True)
            got = lib.add_source(str(d))
            src.update({"id": got["id"], "path": got["path"], "for": str(d)})
        return src

    async def trk_open(kind: str, mid: str, request: Request) -> JSONResponse:
        a = _adapter(kind)
        _sg_guard(request)
        from .library import asset_id, kind_of
        try:
            ident = a.parse_media_id(mid)
        except TrackerError as e:
            return _trk_err(e)
        src = await asyncio.to_thread(_cache_source, a)
        try:
            path, v = await asyncio.to_thread(a.fetch_media, ident, Path(src["path"]), lambda n: bool(kind_of(n)))
        except TrackerError as e:
            return _trk_err(e)
        except (OSError, ValueError) as e:
            return JSONResponse({"errors": [{"title": f"Could not save the media ({type(e).__name__})"}]}, status_code=500)
        kind_ = kind_of(str(path))
        await asyncio.to_thread(lib._touch_one, src["id"], str(path), kind_)
        got = lib.get_asset(asset_id(str(path)))
        if not got:
            return JSONResponse({"errors": [{"title": "The downloaded media could not be added to the library"}]}, status_code=500)
        return JSONResponse({"asset": got, "version": v, "record": v})

    def _idle_kind(ref: str) -> str:
        if ":" in ref or trk.get(ref) is None:
            raise HTTPException(404, "no such tracker")
        return ref

    def trk_cache(ref: str, request: Request | None = None) -> JSONResponse:
        if _flag(request, "idle"):   # the kind's media of no connected site (Settings → Trackers' cache line)
            files = trk.idle_cache(_idle_kind(ref))
            info = {"used": sum(p.stat().st_size for p in files), "files": len(files)}
        else:
            info = _adapter(ref, _flag(request, "spare"), request).cache_info()
        return JSONResponse(info, headers={"Cache-Control": "no-store"})

    def trk_cache_clear(ref: str, request: Request) -> dict:
        if _flag(request, "idle"):
            kind = _idle_kind(ref)
            _sg_guard(request)
            n = 0
            for p in trk.idle_cache(kind):
                if not p.name.endswith(".part"):   # (a download under way finishes)
                    try:
                        p.unlink()
                        n += 1
                    except OSError:
                        pass
            return {"ok": True, "removed": n}
        a = _adapter(ref)
        _sg_guard(request)
        return {"ok": True, "removed": a.clear_cache()}

    # A file's link to a media entity, per tracker: filed under the tracker key of the site configured now
    # ("<kind>:<host>", Library tracker_links) — a link made on another site is not this one's.
    def trk_link_get(kind: str, aid: str) -> JSONResponse:
        a = _adapter(kind)
        key = tracker_key(a.kind, a.site())
        got = lib.get_tracker_link(aid, key) if key else None
        return JSONResponse(got or {"link": None, "state": {}}, headers={"Cache-Control": "no-store"})

    async def trk_link_put(kind: str, aid: str, request: Request) -> dict:
        a = _adapter(kind)
        _sg_guard(request)
        body = await json_body(request)
        link, state = body.get("link"), body.get("state")
        if (link is not None and not isinstance(link, dict)) or (state is not None and not isinstance(state, dict)):
            raise HTTPException(400, "link / state must be objects")
        key = tracker_key(a.kind, a.site())
        if not key:
            raise HTTPException(412, f"{a.name} has no site set (Settings → Trackers)")
        if not lib.get_asset(aid):
            raise HTTPException(404)
        lib.set_tracker_link(aid, key, link, state)
        return {"ok": True}

    def trk_link_drop(kind: str, aid: str, request: Request) -> dict:
        a = _adapter(kind)
        _sg_guard(request)
        key = tracker_key(a.kind, a.site())
        if key:
            lib.drop_tracker_link(aid, key)
        return {"ok": True}

    # ---- the routes: /api/trackers/{kind}/… ({kind}: a tracker key or a kind) and the /api/sg/… aliases (kind
    # "shotgrid": its primary site) ----
    @app.get("/api/trackers/{kind}/status")
    def r_trk_status(kind: str, request: Request) -> JSONResponse:
        return trk_status(kind, request)

    @app.put("/api/trackers/{kind}/config")
    async def r_trk_config(kind: str, request: Request) -> JSONResponse:
        return await trk_config(kind, request)

    @app.get("/api/trackers/{kind}/fetch")
    async def r_trk_fetch_get(kind: str, request: Request) -> Response:
        return await trk_forward(kind, request, "GET")

    @app.post("/api/trackers/{kind}/fetch")
    async def r_trk_fetch_post(kind: str, request: Request) -> Response:
        return await trk_forward(kind, request, "POST")

    @app.put("/api/trackers/{kind}/fetch")
    async def r_trk_fetch_put(kind: str, request: Request) -> Response:
        return await trk_forward(kind, request, "PUT")

    @app.delete("/api/trackers/{kind}/fetch")
    async def r_trk_fetch_delete(kind: str, request: Request) -> Response:
        return await trk_forward(kind, request, "DELETE")

    @app.get("/api/trackers/{kind}/thumb/{mid}")
    async def r_trk_thumb(kind: str, mid: str, request: Request, pic: str = "image", u: str = "") -> Response:
        return await trk_thumb(kind, mid, request, pic, u)

    @app.post("/api/trackers/{kind}/open/{mid}")
    async def r_trk_open(kind: str, mid: str, request: Request) -> JSONResponse:
        return await trk_open(kind, mid, request)

    @app.get("/api/trackers/{kind}/cache")
    def r_trk_cache(kind: str, request: Request) -> JSONResponse:
        return trk_cache(kind, request)

    @app.post("/api/trackers/{kind}/cache/clear")
    def r_trk_cache_clear(kind: str, request: Request) -> dict:
        return trk_cache_clear(kind, request)

    @app.get("/api/trackers/{kind}/link/{aid}")
    def r_trk_link_get(kind: str, aid: str) -> JSONResponse:
        return trk_link_get(kind, aid)

    @app.put("/api/trackers/{kind}/link/{aid}")
    async def r_trk_link_put(kind: str, aid: str, request: Request) -> dict:
        return await trk_link_put(kind, aid, request)

    @app.delete("/api/trackers/{kind}/link/{aid}")
    def r_trk_link_drop(kind: str, aid: str, request: Request) -> dict:
        return trk_link_drop(kind, aid, request)

    # Compatibility (kept on purpose): the pre-5b ShotGrid paths, used by the phone's docs / proxy worker protocol,
    # older pages and the tests. Same handlers, kind "shotgrid"; /api/sg/thumb keeps its old `kind=` parameter.
    @app.get("/api/sg/status")
    def sg_status() -> JSONResponse:
        return trk_status("shotgrid")

    @app.put("/api/sg/config")
    async def sg_config(request: Request) -> JSONResponse:
        return await trk_config("shotgrid", request)

    @app.get("/api/sg/fetch")
    async def sg_fetch_get(request: Request) -> Response:
        return await trk_forward("shotgrid", request, "GET")

    @app.post("/api/sg/fetch")
    async def sg_fetch_post(request: Request) -> Response:
        return await trk_forward("shotgrid", request, "POST")

    @app.put("/api/sg/fetch")
    async def sg_fetch_put(request: Request) -> Response:
        return await trk_forward("shotgrid", request, "PUT")

    @app.delete("/api/sg/fetch")
    async def sg_fetch_delete(request: Request) -> Response:
        return await trk_forward("shotgrid", request, "DELETE")

    @app.get("/api/sg/thumb/{vid}")
    async def sg_thumb(vid: str, request: Request, kind: str = "image", u: str = "") -> Response:
        return await trk_thumb("shotgrid", vid, request, kind, u)

    @app.post("/api/sg/open/{vid}")
    async def sg_open(vid: str, request: Request) -> JSONResponse:
        return await trk_open("shotgrid", vid, request)

    @app.get("/api/sg/cache")
    def sg_cache() -> JSONResponse:
        return trk_cache("shotgrid")

    @app.post("/api/sg/cache/clear")
    def sg_cache_clear(request: Request) -> dict:
        return trk_cache_clear("shotgrid", request)

    @app.get("/api/sg/link/{aid}")
    def sg_link_get(aid: str) -> JSONResponse:
        return trk_link_get("shotgrid", aid)

    @app.put("/api/sg/link/{aid}")
    async def sg_link_put(aid: str, request: Request) -> dict:
        return await trk_link_put("shotgrid", aid, request)

    @app.delete("/api/sg/link/{aid}")
    def sg_link_drop(aid: str, request: Request) -> dict:
        return trk_link_drop("shotgrid", aid, request)

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
        app.mount("/static", RevalidatedStatic(directory=STATIC), name="static")

    return app
