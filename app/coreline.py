"""Coreline link — Sight's server side of the Coreline tracker adapter (docs/PLAN-coreline.md R4, docs/CORELINE.md).

Coreline (the owner's tracker) stores Sight's review rows itself (its ADR-0037 review layer: FORMAT.md v1 rows per
record + file field, merged on its server with Sight's own review-core.js `mergeRows`). The sync runs in the page
(app/static/coreline-core.js); this module keeps the connection and is the page's pass-through to the server:

- The config lives only here, one file per connected server (0600): <SIGHT_HOME>/coreline.json for the first,
  coreline-2.json, … for more (the same slots as ShotGrid's, app/trackers.py `Trackers`). It holds the server address,
  an API key (Coreline → Account → API keys; sent as `Authorization: Bearer`) and the media cache limit. The key is
  never sent back to the page, never logged; changing the server drops a stored key unless a new one comes with it.
- `forward()` (/api/trackers/coreline:<host>/fetch?url=…) forwards one request: to the configured server with the key
  (never its account routes: the page cannot mint or list keys with it), anywhere else over https without it (a signed
  media link redirected to object storage). Coreline sends no CORS headers, so the page always goes through here.
- Thumbnails / the filmstrip / opening a Version use the record's file field: `GET /api/records/:type/:id/files/:field`
  hands out signed media URLs (`/api/media/:id/:kind?exp=&sig=`, server-relative). A media id is "<type>:<id>:<field>".
  Opening prefers the **original** (FORMAT.md doc units are the original's pixels); only without one (deleted on the
  server, or a type Sight cannot open) the `web` rendition, and the record says `scaled` when its size differs — the
  page's sync refuses such a file (drawings would land in the wrong units).

Standard library only (Pillow, already Sight's, re-tiles the scrub sprite into a one-row filmstrip).
"""

from __future__ import annotations

import hashlib
import http.client
import io
import json
import os
import re
import shutil
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from .shotgrid import _opener_for, canonical_site, site_url, valid_site
from .trackers import TrackerError, host_of, tracker_key

TIMEOUT_S = 120
MAX_BODY = 512 * 1048576
STRIP_W = 240          # one filmstrip frame's width (coreline-core.js FILMSTRIP_W): the sprite's tiles are scaled to it
MAX_STRIP = 60         # frames kept in the filmstrip


class ClError(TrackerError):
    pass


_MID = re.compile(r"([a-z][a-z0-9_]{0,63}):([1-9][0-9]{0,18}):([a-z][a-z0-9_]{0,63})")


class CorelineService:
    """The Coreline tracker adapter, one per configured server (app/trackers.py lists the interface). `slot` numbers
    the settings file: 1 = coreline.json, n = coreline-<n>.json."""
    kind = "coreline"
    name = "Coreline"

    def __init__(self, home: Path, slot: int = 1) -> None:
        self.home = home
        self.slot = int(slot)
        self.path = home / ("coreline.json" if self.slot == 1 else f"coreline-{self.slot}.json")
        self._lock = threading.RLock()

    # ---- settings ------------------------------------------------------------------------------------------------
    @staticmethod
    def slots(home: Path) -> list[int]:
        out = [1] if (home / "coreline.json").is_file() else []
        try:
            names = [p.name for p in home.glob("coreline-*.json")]
        except OSError:
            names = []
        for n in names:
            m = re.fullmatch(r"coreline-([1-9]\d{0,3})\.json", n)
            if m and int(m.group(1)) > 1:
                out.append(int(m.group(1)))
        return sorted(out)

    def stored(self) -> bool:
        return self.path.is_file()

    def remove(self) -> None:
        with self._lock:
            try:
                self.path.unlink()
            except OSError:
                pass

    def take_over(self, other: "CorelineService") -> bool:
        with self._lock, other._lock:
            try:
                os.replace(other.path, self.path)
            except OSError:
                return False
        return True

    def _load(self) -> dict:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        return raw if isinstance(raw, dict) else {}

    @staticmethod
    def _connected(c: dict) -> bool:
        return bool(c.get("site") and c.get("key"))

    def status(self) -> dict:
        c = self._load()
        site, key = c.get("site", ""), c.get("key", "")
        # `ident`: another key = maybe another user (the page reads the projects again); a short hash, never the key
        ident = f"{site}|{hashlib.sha256(key.encode()).hexdigest()[:12]}" if key else f"{site}|"
        return {"configured": self._connected(c), "site": site, "hasKey": bool(key),
                "cacheLimitGB": float(c.get("cacheLimitGB") or 0), "cacheDir": str(self.media_dir()), "ident": ident}

    def site(self) -> str:
        return self._load().get("site", "")

    def tracker(self) -> dict | None:
        c = self._load()
        if not self._connected(c):
            return None
        site = c["site"]
        return {"id": self.kind, "kind": self.kind, "key": tracker_key(self.kind, site), "name": self.name, "site": site,
                "host": host_of(site) or site, "note": ""}

    @staticmethod
    def parse_media_id(s: str) -> tuple[str, int, str]:
        """'version:12:media' -> ('version', 12, 'media'), else TrackerError 404."""
        m = _MID.fullmatch(s) if isinstance(s, str) else None
        if not m:
            raise ClError(404, "no such Version")
        return m.group(1), int(m.group(2)), m.group(3)

    def configure(self, data: dict, taken=()) -> bool:
        """Save the settings. A missing "key" keeps the stored one (unless the server changes); "" removes it."""
        if not isinstance(data, dict):
            return False
        site = site_url(data.get("site", "")) if isinstance(data.get("site", ""), str) else None
        key = data.get("key")
        limit = data.get("cacheLimitGB")
        if limit is not None and (isinstance(limit, bool) or not isinstance(limit, (int, float)) or not 0 <= limit <= 100000):
            return False
        if site is None or (key is not None and not isinstance(key, str)):
            return False
        if site:
            site = canonical_site(site)
        if site and not valid_site(site):
            return False
        if not site and self.slot != 1:
            raise ClError(400, "The server is needed")
        if site and tracker_key(self.kind, site) in taken:
            raise ClError(409, f"{host_of(site)} is already connected in Sight")
        if key is not None:
            key = key.strip()
            if len(key) > 500 or (key and not re.fullmatch(r"[\x21-\x7e]+", key)):
                return False
        with self._lock:
            old = self._load()
            if key is None:
                key = old.get("key", "") if canonical_site(old.get("site", "")) == site else ""
            if not site:
                key = ""
            if limit is None:
                limit = old.get("cacheLimitGB") or 0
            new = {k: v for k, v in {"site": site, "key": key, "cacheLimitGB": limit}.items() if v}
            if not new:
                try:
                    self.path.unlink()
                except FileNotFoundError:
                    pass
                return True
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_name(self.path.name + ".tmp")
            try:
                tmp.unlink()
            except FileNotFoundError:
                pass
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(json.dumps(new))
            os.replace(tmp, self.path)
        return True

    # ---- the pass-through ----------------------------------------------------------------------------------------
    @staticmethod
    def _on_site(url: str, site: str) -> bool:
        u = urllib.parse.urlsplit(url)
        return bool(site) and f"{u.scheme}://{u.netloc}".lower() == site.lower()

    @staticmethod
    def _guard_path(method: str, raw_path: str) -> None:
        """The account routes: the key could mint / list / revoke keys or sign in as someone — never from the page (only
        who the key is: GET /api/auth/me, the settings' Test). A path with dot segments, empty segments or backslashes is
        refused outright (a server resolving `/api/x/../auth/…` would reach them past a plain prefix check)."""
        path = urllib.parse.unquote(raw_path or "/")
        segs = path.split("/")[1:]
        if "\\" in path or any(x in (".", "..") for x in segs) or "" in segs[:-1] or "%" in path or re.search(r"%2e|%2f|%5c", raw_path or "", re.I):
            raise ClError(400, "unusual path")
        low = path.lower()
        if (low == "/api/auth" or low.startswith("/api/auth/")) and not (method == "GET" and low.rstrip("/") == "/api/auth/me"):
            raise ClError(400, "the account routes are not available through Sight")

    def forward(self, method: str, url: str, body: bytes | None, headers: dict, sudo: str = "") -> tuple[int, str, bytes]:
        """One request on the page's behalf -> (status, content type, body). Raises ClError for refusals."""
        c = self._load()
        site = c.get("site", "")
        if not self._connected(c):
            raise ClError(412, "Coreline is not connected (Settings → Trackers)")
        if method not in ("GET", "POST", "PUT", "DELETE"):
            raise ClError(405, "method")
        try:
            u = urllib.parse.urlsplit(url)
        except ValueError:
            raise ClError(400, "bad url") from None
        on_site = self._on_site(url, site)
        if not on_site and u.scheme != "https":
            raise ClError(400, "https only")
        if on_site:
            self._guard_path(method, u.path)
        h = {"User-Agent": "Sight"}
        for k in ("Content-Type", "Accept", "Content-Range"):
            v = headers.get(k.lower())
            if v:
                h[k] = v
        if on_site:
            h["Authorization"] = "Bearer " + c["key"]
        req = urllib.request.Request(url, data=body if method in ("POST", "PUT") else None, method=method, headers=h)
        try:
            with _opener_for(url).open(req, timeout=TIMEOUT_S) as resp:
                return resp.status, resp.headers.get("Content-Type", ""), resp.read(MAX_BODY)
        except urllib.error.HTTPError as e:
            if e.code in (301, 302, 303, 307, 308) and method == "GET" and e.headers.get("Location"):
                # a signed media link answered with the storage's own signed link: fetched without the key
                loc = urllib.parse.urljoin(url, e.headers["Location"])
                if not loc.lower().startswith("https://") and not self._on_site(loc, site):
                    raise ClError(400, "redirect to http") from None
                hh = {"User-Agent": "Sight"}
                if self._on_site(loc, site):
                    self._guard_path("GET", urllib.parse.urlsplit(loc).path)   # (a redirect cannot lead the key there)
                    hh["Authorization"] = "Bearer " + c["key"]
                try:
                    with _opener_for(loc).open(urllib.request.Request(loc, method="GET", headers=hh), timeout=TIMEOUT_S) as resp:
                        return resp.status, resp.headers.get("Content-Type", ""), resp.read(MAX_BODY)
                except urllib.error.HTTPError as e2:
                    return e2.code, e2.headers.get("Content-Type", ""), e2.read()[:65536]
                except (urllib.error.URLError, http.client.HTTPException, TimeoutError, OSError) as e2:
                    raise ClError(502, f"Coreline media not reachable ({type(e2).__name__})") from None
            return e.code, e.headers.get("Content-Type", ""), e.read()[:65536]
        except (urllib.error.URLError, http.client.HTTPException, TimeoutError, OSError) as e:
            raise ClError(502, f"Coreline server not reachable ({type(e).__name__})") from None

    # ---- the server's own calls (thumbnails, opening a Version) --------------------------------------------------
    def api(self, method: str, path: str, body: dict | None = None) -> dict:
        url = self._load().get("site", "") + path
        data = json.dumps(body).encode() if body is not None else None
        status, _ctype, raw = self.forward(method, url, data, {"content-type": "application/json", "accept": "application/json"})
        try:
            j = json.loads(raw.decode("utf-8") or "{}")
        except ValueError:
            j = {}
        if status >= 400:
            err = j.get("error") if isinstance(j, dict) and isinstance(j.get("error"), dict) else {}
            msg = err.get("message") or f"Coreline answered {status}"
            raise ClError(status if status in (400, 401, 403, 404, 409) else 502, msg)
        return j if isinstance(j, dict) else {}

    def describe(self, mid: tuple[str, int, str]) -> dict:
        """The record's file field with signed URLs (GET /api/records/:type/:id/files/:field)."""
        t, i, f = mid
        return self.api("GET", f"/api/records/{t}/{i}/files/{f}")

    def record(self, mid: tuple[str, int, str]) -> dict:
        t, i, _f = mid
        return self.api("GET", f"/api/records/{t}/{i}")

    def _media_url(self, rel: object) -> str:
        if not isinstance(rel, str) or not rel:
            return ""
        site = self._load().get("site", "")
        url = urllib.parse.urljoin(site + "/", rel)
        return url if url.lower().startswith(("https://", "http://")) else ""

    def _host_dir(self, root: str) -> Path:
        host = urllib.parse.urlsplit(self._load().get("site", "")).netloc.replace(":", "_") or "none"
        return self.home / "coreline_cache" / root / re.sub(r"[^\w.-]", "_", host)

    def media_dir(self) -> Path:
        return (self.home / "coreline_cache" / "media").resolve()

    def cache_dir(self) -> Path:
        return self.media_dir() / self._host_dir("x").name

    def _get_bytes(self, url: str, limit: int = MAX_BODY) -> tuple[bytes, str]:
        status, ctype, raw = self.forward("GET", url, None, {})
        if status >= 400:
            raise ClError(502, f"download failed ({status})")
        return raw[:limit], ctype

    @staticmethod
    def _strip(sprite: bytes, meta: dict) -> bytes | None:
        """The scrub sprite (a grid: columns × rows tiles) as one row of frames STRIP_W px wide (the filmstrip layout
        the grid's scrub reads), JPEG. None when it cannot be read."""
        try:
            from PIL import Image
            im = Image.open(io.BytesIO(sprite))
            im.load()
            cols = int(meta.get("columns") or 0)
            rows = int(meta.get("rows") or 0)
            tw = int(meta.get("tileWidth") or 0)
            th = int(meta.get("tileHeight") or 0)
            frames = int(meta.get("frames") or cols * rows)
            if cols < 1 or rows < 1:
                return None
            if tw < 1 or th < 1:
                tw, th = im.width // cols, im.height // rows
            frames = max(1, min(frames, cols * rows))
            pick = [round(i * (frames - 1) / (MAX_STRIP - 1)) for i in range(MAX_STRIP)] if frames > MAX_STRIP else list(range(frames))
            oh = max(1, round(th * STRIP_W / tw))
            out = Image.new("RGB", (STRIP_W * len(pick), oh))
            for n, i in enumerate(pick):
                x, y = (i % cols) * tw, (i // cols) * th
                tile = im.crop((x, y, x + tw, y + th)).convert("RGB").resize((STRIP_W, oh))
                out.paste(tile, (n * STRIP_W, 0))
            buf = io.BytesIO()
            out.save(buf, "JPEG", quality=82)
            return buf.getvalue()
        except Exception:   # (a damaged sprite: no filmstrip, never a failed request)
            return None

    def picture(self, mid: tuple[str, int, str], kind: str, stamp: str) -> tuple[Path, str] | None:
        """A Version's thumbnail ("image": the file's thumb / poster rendition, else an image's web one) or filmstrip
        (the scrub sprite re-tiled), cached on disk with the record's stamp beside it (a newer stamp fetches again)."""
        t, i, f = mid
        d = self._host_dir("thumbs")
        base = f"{t}_{i}_{f}_{'filmstrip' if kind == 'filmstrip' else 'image'}"
        fp, meta = d / base, d / (base + ".json")
        try:
            m = json.loads(meta.read_text(encoding="utf-8"))
            if fp.exists() and (not stamp or m.get("u") == stamp):
                return (fp, m.get("type") or "image/jpeg") if m.get("has") else None
        except (OSError, ValueError):
            pass
        desc = self.describe(mid)
        urls = desc.get("urls") if isinstance(desc.get("urls"), dict) else {}
        rend = desc.get("renditions") if isinstance(desc.get("renditions"), dict) else {}
        raw, ctype = b"", ""
        if kind == "filmstrip":
            u = self._media_url(urls.get("scrub"))
            if u:
                sprite, _ = self._get_bytes(u, 64 * 1048576)
                raw = self._strip(sprite, rend.get("scrub") if isinstance(rend.get("scrub"), dict) else {}) or b""
                ctype = "image/jpeg"
        else:
            image = str(desc.get("kind") or desc.get("mime") or "").startswith("image")
            u = self._media_url(urls.get("thumb") or urls.get("poster") or (urls.get("web") if image else ""))
            if u:
                raw, ctype = self._get_bytes(u, 32 * 1048576)
        if not raw:
            # Remembered as "no picture" only when none will come: a failed / skipped file, or an image asked for a
            # filmstrip. A file or rendition still being made, or a sprite that could not be read, is asked again.
            final = desc.get("status") == "failed" or bool(desc.get("skipped"))
            if kind == "filmstrip" and not str(desc.get("kind") or desc.get("mime") or "").startswith("video"):
                final = True
            # a ready file without the rendition (audio, a document, a video with no scrub sprite) will not get one:
            # remembered, so the grid does not ask Coreline again on every paint
            image = str(desc.get("kind") or desc.get("mime") or "").startswith("image")
            want = ("scrub",) if kind == "filmstrip" else ("thumb", "poster", "web") if image else ("thumb", "poster")
            if desc.get("status") == "ready" and not any(k in rend for k in want):
                final = True
            if not final:
                return None
        d.mkdir(parents=True, exist_ok=True)
        tmp = fp.with_name(fp.name + f".{threading.get_ident()}.tmp")
        tmp.write_bytes(raw)
        os.replace(tmp, fp)
        mtmp = meta.with_name(meta.name + f".{threading.get_ident()}.tmp")
        mtmp.write_text(json.dumps({"u": stamp, "has": bool(raw), "type": ctype}), encoding="utf-8")
        os.replace(mtmp, meta)
        return (fp, ctype or "image/jpeg") if raw else None

    # ---- the media cache (like ShotGrid's: a size limit in GB, 0 = Auto keeping RESERVE free) --------------------
    RESERVE = 2 * 1024 ** 3
    IN_USE = 15 * 60

    def cache_info(self) -> dict:
        d = self.cache_dir()
        files = [p for p in d.rglob("*") if p.is_file()] if d.exists() else []
        used = sum(p.stat().st_size for p in files)
        free = shutil.disk_usage(d if d.exists() else self.home).free
        return {"used": used, "files": len(files), "free": free, "limitGB": float(self._load().get("cacheLimitGB") or 0)}

    def clear_cache(self) -> int:
        d = self.cache_dir()
        n = 0
        for p in (d.rglob("*") if d.exists() else []):
            if p.is_file() and not p.name.endswith(".part"):
                try:
                    p.unlink()
                    n += 1
                except OSError:
                    pass
        return n

    def make_room(self, need: int, keep: Path | None = None) -> None:
        d = self.cache_dir()
        d.mkdir(parents=True, exist_ok=True)
        limit = float(self._load().get("cacheLimitGB") or 0) * 1024 ** 3
        every = [p for p in d.rglob("*") if p.is_file()]
        used = sum(p.stat().st_size for p in every)
        recent = time.time() - self.IN_USE
        files = sorted((p for p in every if p != keep and not p.name.endswith((".part", ".clsrc")) and p.stat().st_atime < recent),
                       key=lambda p: p.stat().st_atime)
        evictable = sum(p.stat().st_size for p in files)

        def ok() -> bool:
            if limit and used + need > limit:
                return False
            return shutil.disk_usage(d).free - need >= self.RESERVE

        msg = "Not enough room for this Version's media (Coreline cache limit or free disk space)"
        if (limit and used - evictable + need > limit) or shutil.disk_usage(d).free + evictable - need < self.RESERVE:
            if not ok():
                raise ClError(507, msg)
        while not ok() and files:
            p = files.pop(0)
            try:
                size = p.stat().st_size
                p.unlink()
                used -= size
                side = p.with_name(p.name + ".clsrc")
                if side.exists():
                    used -= side.stat().st_size
                    side.unlink()
            except OSError:
                pass
        if not ok():
            raise ClError(507, msg)

    def fetch_media(self, mid: tuple[str, int, str], root: Path | None = None, can_open=None) -> tuple[Path, dict]:
        """Downloads a Version's media into the media cache: the original when Coreline keeps it and Sight can open
        it, else the `web` rendition. Reused while it is the same file. Returns (path, record) — the record as
        /api/records gives it, plus `field`, `file` (the file's size / kind / fps / duration, no URLs), `source`
        ("original" | "web") and `scaled` (the web rendition's size differs from the original's: FORMAT.md doc units
        are the original's pixels, so the page does not sync this file)."""
        t, i, f = mid
        rec = self.record(mid)
        desc = self.describe(mid)
        if not desc or not desc.get("id"):
            raise ClError(404, "This Version has no media")
        urls = desc.get("urls") if isinstance(desc.get("urls"), dict) else {}
        rend = desc.get("renditions") if isinstance(desc.get("renditions"), dict) else {}
        name = desc.get("name") if isinstance(desc.get("name"), str) and desc.get("name") else f"{t}{i}"
        stem, ext = os.path.splitext(re.sub(r'[\x00-\x1f\\/:*?"<>|]+', "_", name).strip().strip(". "))
        stem = (stem or f"{t}{i}")[:100]
        video = str(desc.get("kind") or desc.get("mime") or "").startswith("video")
        source, url, scaled = "", "", False
        if urls.get("original") and ext not in ("", ".") and len(ext) <= 8 and (not can_open or can_open(stem + ext)):
            source, url = "original", self._media_url(urls["original"])
        elif urls.get("web"):
            source, url = "web", self._media_url(urls["web"])
            w = rend.get("web") if isinstance(rend.get("web"), dict) else {}
            ext = {"video/mp4": ".mp4", "video/webm": ".webm", "image/webp": ".webp", "image/jpeg": ".jpg", "image/png": ".png"}.get(
                str(w.get("mime") or "").lower(), ".mp4" if video else ".webp")
            ow, oh = desc.get("width"), desc.get("height")
            scaled = not (ow and oh and w.get("width") == ow and w.get("height") == oh)
            if can_open and not can_open(stem + ext):
                raise ClError(415, f"Sight cannot open this Version's media ({ext})")
        if not url:
            if urls.get("original") and can_open and not can_open(stem + ext):
                raise ClError(415, f"Sight cannot open this Version's media ({ext or 'no extension'}) and Coreline has no web preview of it")
            raise ClError(404, "This Version's media is not available (still processing, or no preview)")
        d = (root or self.media_dir()) / self._host_dir("x").name
        tag = f"__c{i}" if (t, f) == ("version", "media") else f"__c{t}-{i}-{f}"   # (one file per record + field)
        path = d / f"{stem}{tag}{'' if source == 'original' else '.web'}{ext}"
        mark = f"{desc.get('id')}|{desc.get('sha256') or desc.get('size') or ''}|{source}"
        side = path.with_name(path.name + ".clsrc")
        keep = {k: desc.get(k) for k in ("id", "name", "size", "mime", "kind", "width", "height", "duration", "fps", "originalDeleted")}
        out = dict(rec, field=f, file=keep, source=source, scaled=scaled)
        try:
            same = side.read_text(encoding="utf-8") == mark
        except OSError:
            same = False
        if path.exists() and path.stat().st_size and same:
            st = path.stat()
            os.utime(path, (time.time(), st.st_mtime))
            return path, out
        d.mkdir(parents=True, exist_ok=True)
        self._stream_to(url, path, int(desc.get("size") or 0) if source == "original" else 0)
        side.write_text(mark, encoding="utf-8")
        return path, out

    def _stream_to(self, url: str, path: Path, size_hint: int = 0) -> None:
        """Streams a signed media link to `path` (via .part), making room first; a redirect (object storage) is
        followed without the key."""
        c = self._load()
        site = c.get("site", "")
        on_site = self._on_site(url, site)
        if not on_site and not url.lower().startswith("https://"):
            raise ClError(400, "https only")
        h = {"User-Agent": "Sight"}
        if on_site:
            h["Authorization"] = "Bearer " + c.get("key", "")
        tmp = path.with_name(path.name + ".part")
        try:
            try:
                resp = _opener_for(url).open(urllib.request.Request(url, headers=h), timeout=TIMEOUT_S)
            except urllib.error.HTTPError as e:
                loc = e.headers.get("Location") if e.code in (301, 302, 303, 307, 308) else None
                if not loc:
                    raise ClError(502, f"download failed ({e.code})") from None
                loc = urllib.parse.urljoin(url, loc)
                if not loc.lower().startswith("https://"):
                    raise ClError(400, "redirect to http") from None
                resp = _opener_for(loc).open(urllib.request.Request(loc, headers={"User-Agent": "Sight"}), timeout=TIMEOUT_S)
            with resp:
                size = int(resp.headers.get("Content-Length") or 0) or size_hint
                self.make_room(size or 64 * 1048576)
                got = 0
                with open(tmp, "wb") as fh:
                    while True:
                        chunk = resp.read(1048576)
                        if not chunk:
                            break
                        fh.write(chunk)
                        got += len(chunk)
                        if not size and got % (256 * 1048576) < 1048576:
                            self.make_room(256 * 1048576, keep=tmp)
            os.replace(tmp, path)
        except (urllib.error.URLError, http.client.HTTPException, TimeoutError, OSError) as e:
            raise ClError(502, f"download failed ({type(e).__name__})") from None
        finally:
            try:
                tmp.unlink()
            except OSError:
                pass
