"""ShotGrid (Autodesk Flow Production Tracking) link — Sight's server side (docs/SHOTGRID.md).

The sync itself runs in the page (app/static/shotgrid-core.js, shared with the phone app); this module keeps the
connection settings and is the page's pass-through to the studio's site:

- The config lives only here, in <SIGHT_HOME>/shotgrid.json (0600): site, API script name and key, the state ↔
  status-code table, reviewer name → ShotGrid login, whether to post as the reviewer (sudo). The key is never sent
  back to the page, never in settings.json / localStorage, never logged. Changing the site or the script name drops a
  stored key unless a new one comes with it, so nothing that can reach the settings can redirect the key elsewhere.
- `forward()` (GET/POST/PUT/DELETE /api/sg/fetch?url=…) forwards one request: to the configured site with a Bearer
  token this module gets with the key (per sudo login, refreshed), anywhere else over https without any token (the
  signed storage links ShotGrid hands out for uploads / downloads). Redirects are never followed with the token.

Standard library only.
"""

from __future__ import annotations

import http.client
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

from .trackers import TrackerError, _canon_hostname, canonical_hostname, host_of, tracker_key

TIMEOUT_S = 120
MAX_BODY = 512 * 1048576
STATES = ("open", "progress", "done")
_LOCAL = ("localhost", "127.0.0.1", "::1")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)
_DIRECT = urllib.request.build_opener(_NoRedirect, urllib.request.ProxyHandler({}))


def _opener_for(url: str):
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    return _DIRECT if host in _LOCAL else _OPENER


def site_url(s: str) -> str:
    """'studio.shotgrid.autodesk.com/' -> 'https://studio.shotgrid.autodesk.com' (same rule as SightShotGrid.siteUrl)."""
    s = (s or "").strip().rstrip("/")
    if not s:
        return ""
    if not re.match(r"https?://", s, re.I):
        s = "https://" + s
    return re.sub(r"/api(/v[\d.]+)?$", "", s, flags=re.I)


def canonical_site(url: str) -> str:
    """The site with its hostname spelt as the browser's URL.host spells it ('https://[0:0:0:0:0:0:0:1]' ->
    'https://[::1]', 'https://0x7f.1' -> 'https://127.0.0.1'), so a site saved before 0.107 in another spelling still
    saves (valid_site refuses non-canonical hostnames). Anything it cannot read comes back as it was (valid_site
    judges it). A non-ASCII hostname is left alone (valid_site refuses it, as before 0.107): Python's IDNA 2003 maps
    some letters (ß, ς, ZWJ) to another domain than the browser's IDNA 2008 would."""
    try:
        u = urllib.parse.urlsplit(url)
        if not urllib.parse.unquote(u.hostname or "").isascii():
            return url
        name, port = _canon_hostname(u.hostname), u.port
    except ValueError:
        return url
    if not name or u.username is not None or u.password is not None:
        return url
    return urllib.parse.urlunsplit((u.scheme, name + (f":{port}" if port is not None else ""), u.path, u.query, u.fragment))


def valid_site(url: str) -> bool:
    if not url or len(url) > 300 or not re.fullmatch(r"[\x21-\x7e]+", url):
        return False
    try:
        u = urllib.parse.urlsplit(url)
        u.port
    except ValueError:
        return False
    if not u.hostname or u.username or u.password is not None or u.path not in ("", "/") or u.query:
        return False
    if not canonical_hostname(u.hostname):
        return False   # spelt so that the browser's URL.host differs (0x7f.1, [0:0::1], %41…): the tracker key must agree
    # https only; plain http only for a server on this machine (a local test / proxy)
    return u.scheme == "https" or (u.scheme == "http" and u.hostname in _LOCAL)


class SgError(TrackerError):
    pass


class ShotGridService:
    """The ShotGrid tracker adapter (app/trackers.py lists the interface; docs/ARCHITECTURE.md "Tracker adapters")."""
    kind = "shotgrid"
    name = "ShotGrid"

    def __init__(self, home: Path) -> None:
        self.home = home
        self.path = home / "shotgrid.json"
        self._lock = threading.RLock()
        # (site, script, sudo login — "" = the script) -> (token, until). Keyed by site + script too: a token asked for
        # just before the settings changed must never be sent to the new site.
        self._tokens: dict[tuple[str, str, str], tuple[str, float]] = {}

    def _load(self) -> dict:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        return raw if isinstance(raw, dict) else {}

    @staticmethod
    def _connected(c: dict) -> bool:
        # The one definition of "connected" (configured and usable): site + script name + key saved. The UI shows
        # ShotGrid's controls only while this holds (docs/PLAN-trackers.md decision 10; /api/trackers).
        return bool(c.get("site") and c.get("script") and c.get("key"))

    def status(self) -> dict:
        c = self._load()
        site = c.get("site", "")
        return {
            "configured": self._connected(c),
            "site": site, "script": c.get("script", ""), "hasKey": bool(c.get("key")),
            "statusMap": c.get("statusMap") or {}, "logins": c.get("logins") or {}, "sudo": bool(c.get("sudo")),
            "cacheLimitGB": float(c.get("cacheLimitGB") or 0), "cacheDir": str(self.media_dir()),
            # (the tracker interface: another `ident` = another connection — the page reads the projects again)
            "ident": f"{site}|{c.get('script', '')}",
        }

    def site(self) -> str:
        return self._load().get("site", "")

    def tracker(self) -> dict | None:
        """This tracker's entry in /api/trackers while it is connected, else None. `id` is the kind (as before 5b),
        `key` the tracker key every per-tracker record is filed under, `note` a short state for the You panel."""
        c = self._load()
        if not self._connected(c):
            return None
        site = c["site"]
        return {"id": self.kind, "kind": self.kind, "key": tracker_key(self.kind, site), "name": self.name, "site": site,
                "host": host_of(site) or site, "note": "as reviewer" if c.get("sudo") else ""}

    @staticmethod
    def parse_media_id(s: str) -> int:
        """A Version id from a route (a positive integer), else TrackerError 404."""
        if not isinstance(s, str) or not re.fullmatch(r"[1-9]\d{0,15}", s):
            raise SgError(404, "no such Version")
        return int(s)

    def configure(self, data: dict) -> bool:
        """Save the settings. A missing "key" keeps the stored one (unless site / script change); "" removes it.
        Returns False for values that cannot be right."""
        if not isinstance(data, dict):
            return False
        site = site_url(data.get("site", "")) if isinstance(data.get("site", ""), str) else None
        script, key = data.get("script", ""), data.get("key")
        smap, logins, sudo = data.get("statusMap") or {}, data.get("logins") or {}, data.get("sudo", False)
        limit = data.get("cacheLimitGB")   # downloaded Versions' media: GB, 0 = Auto (while the disk has room); missing = kept
        if limit is not None and (isinstance(limit, bool) or not isinstance(limit, (int, float)) or not 0 <= limit <= 100000):
            return False
        if site is None or not isinstance(script, str) or (key is not None and not isinstance(key, str)):
            return False
        if site:
            site = canonical_site(site)   # (an older, non-canonical spelling is rewritten, not refused)
        if site and not valid_site(site):
            return False
        script = script.strip()
        if len(script) > 200 or (script and not re.fullmatch(r"[\x21-\x7e ]+", script)):
            return False
        if key is not None:
            key = key.strip()
            if len(key) > 500 or (key and not re.fullmatch(r"[\x21-\x7e]+", key)):
                return False
        if not isinstance(smap, dict) or any(k not in STATES or not isinstance(v, str) or len(v) > 40 for k, v in smap.items()):
            return False
        if not isinstance(logins, dict) or len(logins) > 500 or any(
                not isinstance(k, str) or not isinstance(v, str) or len(k) > 200 or len(v) > 200 for k, v in logins.items()):
            return False
        smap = {k: v.strip() for k, v in smap.items() if v.strip()}
        logins = {k.strip(): v.strip() for k, v in logins.items() if k.strip() and v.strip()}
        with self._lock:
            old = self._load()
            if key is None:
                key = old.get("key", "") if (canonical_site(old.get("site", "")), old.get("script", "")) == (site, script) else ""
            if not site or not script:
                key = ""
            if limit is None:
                limit = old.get("cacheLimitGB") or 0
            new = {"site": site, "script": script, "key": key, "statusMap": smap, "logins": logins, "sudo": bool(sudo), "cacheLimitGB": limit}
            new = {k: v for k, v in new.items() if v}
            self._tokens = {}
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

    # ---- the token (script key -> Bearer token; per sudo login) ---------------------------------------
    def _token(self, c: dict, sudo: str, fresh: bool = False) -> str:
        with self._lock:
            t = self._tokens.get((c["site"], c["script"], sudo))
            if t and not fresh and t[1] > time.time() + 30:
                return t[0]
        form = {"grant_type": "client_credentials", "client_id": c["script"], "client_secret": c["key"]}
        if sudo:
            form["sudo_as_login"] = sudo
        url = c["site"] + "/api/v1.1/auth/access_token"
        req = urllib.request.Request(url, data=urllib.parse.urlencode(form).encode(), method="POST", headers={
            "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json", "User-Agent": "Sight"})
        try:
            with _opener_for(url).open(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as e:
            body = e.read()[:2000].decode("utf-8", "replace")
            raise SgError(e.code if e.code in (400, 401, 403) else 502,
                          f"ShotGrid refused the script name / key{' (or acting as ' + sudo + ')' if sudo else ''}: {body}") from None
        except (urllib.error.URLError, http.client.HTTPException, TimeoutError, OSError, ValueError) as e:
            raise SgError(502, f"ShotGrid site not reachable ({type(e).__name__})") from None
        tok = data.get("access_token") if isinstance(data, dict) else None
        if not tok:
            raise SgError(502, "ShotGrid gave no token")
        with self._lock:
            self._tokens[(c["site"], c["script"], sudo)] = (tok, time.time() + float(data.get("expires_in") or 600))
        return tok

    def forward(self, method: str, url: str, body: bytes | None, headers: dict, sudo: str = "") -> tuple[int, str, bytes]:
        """One request on the page's behalf -> (status, content type, body). Raises SgError for refusals."""
        c = self._load()
        site = c.get("site", "")
        if not self._connected(c):
            raise SgError(412, "ShotGrid is not connected (Settings → Trackers)")
        if method not in ("GET", "POST", "PUT", "DELETE"):
            raise SgError(405, "method")
        try:
            u = urllib.parse.urlsplit(url)
        except ValueError:
            raise SgError(400, "bad url") from None
        on_site = f"{u.scheme}://{u.netloc}".lower() == site.lower()
        if not on_site and u.scheme != "https":
            raise SgError(400, "https only")
        if on_site and "/auth/" in urllib.parse.unquote(u.path).lower():
            raise SgError(400, "the token is Sight's own")   # the page never sees a token (any spelling of the path)
        if not c.get("sudo"):
            sudo = ""   # "Post as the reviewer" off: never act as anyone else, whatever the page asks
        h = {"User-Agent": "Sight"}
        for k in ("Content-Type", "Accept"):
            v = headers.get(k.lower())
            if v:
                h[k] = v
        for attempt in (0, 1):
            if on_site:
                h["Authorization"] = "Bearer " + self._token(c, sudo, fresh=attempt == 1)
            req = urllib.request.Request(url, data=body if method in ("POST", "PUT") else None, method=method, headers=h)
            try:
                with _opener_for(url).open(req, timeout=TIMEOUT_S) as resp:
                    return resp.status, resp.headers.get("Content-Type", ""), resp.read(MAX_BODY)
            except urllib.error.HTTPError as e:
                if e.code == 401 and on_site and attempt == 0:
                    continue   # token expired early: one fresh one
                if e.code in (301, 302, 303, 307, 308) and method == "GET" and e.headers.get("Location"):
                    # a file link served through the site: fetched from where it points, without the token
                    loc = urllib.parse.urljoin(url, e.headers["Location"])
                    if not loc.lower().startswith("https://") and not loc.lower().startswith(site.lower() + "/"):
                        raise SgError(400, "redirect to http") from None
                    req2 = urllib.request.Request(loc, method="GET", headers={"User-Agent": "Sight"})
                    try:
                        with _opener_for(loc).open(req2, timeout=TIMEOUT_S) as resp:
                            return resp.status, resp.headers.get("Content-Type", ""), resp.read(MAX_BODY)
                    except urllib.error.HTTPError as e2:
                        return e2.code, e2.headers.get("Content-Type", ""), e2.read()[:65536]
                return e.code, e.headers.get("Content-Type", ""), e.read()[:65536]
            except (urllib.error.URLError, http.client.HTTPException, TimeoutError, OSError) as e:
                raise SgError(502, f"ShotGrid not reachable ({type(e).__name__})") from None
        raise SgError(502, "unreachable")


    # ---- the server's own calls (Sight's ShotGrid view: thumbnails, opening a Version) ---------------------
    def api(self, method: str, path: str, body: dict | None = None) -> dict:
        c = self._load()
        url = c.get("site", "") + "/api/v1.1" + path
        data = json.dumps(body).encode() if body is not None else None
        status, _ctype, raw = self.forward(method, url, data, {"content-type": "application/json", "accept": "application/json"})
        try:
            j = json.loads(raw.decode("utf-8") or "{}")
        except ValueError:
            j = {}
        if status >= 400:
            err = (j.get("errors") or [{}])[0] if isinstance(j, dict) else {}
            raise SgError(status if status < 500 else 502, err.get("title") or f"ShotGrid answered {status}")
        return j

    def version(self, vid: int, fields: list[str]) -> dict:
        j = self.api("GET", f"/entity/versions/{int(vid)}?fields=" + urllib.parse.quote(",".join(fields)))
        d = j.get("data") or {}
        out = {"type": d.get("type"), "id": d.get("id")}
        out.update(d.get("attributes") or {})
        for k, v in (d.get("relationships") or {}).items():
            out[k] = v.get("data") if isinstance(v, dict) else v
        return out

    def _host_dir(self, root: str) -> Path:
        host = urllib.parse.urlsplit(self._load().get("site", "")).netloc.replace(":", "_") or "none"
        return self.home / "sg_cache" / root / re.sub(r"[^\w.-]", "_", host)

    def media_dir(self) -> Path:
        # resolved: the library stores a source's resolved path, and a file must match its source by path
        return (self.home / "sg_cache" / "media").resolve()

    def _get_bytes(self, url: str, limit: int = MAX_BODY) -> tuple[bytes, str]:
        status, ctype, raw = self.forward("GET", url, None, {})
        if status >= 400:
            raise SgError(502, f"download failed ({status})")
        return raw[:limit], ctype

    # Thumbnails / filmstrips on disk, one file per Version and kind, with the Version's updated_at beside it:
    # a request with the same stamp is served from disk; a newer one fetches again. Returns (path, type) or None.
    def picture(self, vid: int, kind: str, stamp: str) -> tuple[Path, str] | None:
        field = "filmstrip_image" if kind == "filmstrip" else "image"
        d = self._host_dir("thumbs")
        f, meta = d / f"{int(vid)}_{kind}", d / f"{int(vid)}_{kind}.json"
        try:
            m = json.loads(meta.read_text(encoding="utf-8"))
            if f.exists() and (not stamp or m.get("u") == stamp):
                return (f, m.get("type") or "image/jpeg") if m.get("has") else None
        except (OSError, ValueError):
            pass
        v = self.version(vid, [field, "updated_at"])
        url = v.get(field)
        d.mkdir(parents=True, exist_ok=True)
        has, ctype = False, ""
        if isinstance(url, str) and "/images/status/transient/" in url:
            return None   # still being made on ShotGrid: not remembered, asked again next time
        if isinstance(url, str) and url.startswith(("http://", "https://")):
            raw, ctype = self._get_bytes(url, 32 * 1048576)
            has = bool(raw)
        else:
            raw = b""
        # written aside, then swapped in: a request streaming the old file is not cut short
        tmp = f.with_name(f.name + f".{threading.get_ident()}.tmp")
        tmp.write_bytes(raw)
        os.replace(tmp, f)
        mtmp = meta.with_name(meta.name + f".{threading.get_ident()}.tmp")
        mtmp.write_text(json.dumps({"u": stamp or str(v.get("updated_at") or ""), "has": has, "type": ctype}), encoding="utf-8")
        os.replace(mtmp, meta)
        return (f, ctype or "image/jpeg") if has else None

    # Media of opened Versions (their web proxy) in <home>/sg_cache/media: a size limit in GB, or 0 = Auto — as much as
    # the disk holds, keeping RESERVE free. Oldest (by last open) go first.
    RESERVE = 2 * 1024 ** 3
    IN_USE = 15 * 60

    def cache_info(self) -> dict:
        d = self.media_dir()
        files = [p for p in d.rglob("*") if p.is_file()] if d.exists() else []
        used = sum(p.stat().st_size for p in files)
        free = shutil.disk_usage(d if d.exists() else self.home).free
        return {"used": used, "files": len(files), "free": free, "limitGB": float(self._load().get("cacheLimitGB") or 0)}

    def clear_cache(self) -> int:
        """Deletes the downloaded media (a download under way finishes). Returns the number of files removed."""
        d = self.media_dir()
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
        d = self.media_dir()
        d.mkdir(parents=True, exist_ok=True)
        limit = float(self._load().get("cacheLimitGB") or 0) * 1024 ** 3
        every = [p for p in d.rglob("*") if p.is_file()]
        used = sum(p.stat().st_size for p in every)   # downloads under way (.part) count, they are not evicted
        # Never evicted: downloads under way and files opened in the last IN_USE seconds (the one in the preview).
        recent = time.time() - self.IN_USE
        files = sorted((p for p in every if p != keep and not p.name.endswith((".part", ".sgsrc")) and p.stat().st_atime < recent),
                       key=lambda p: p.stat().st_atime)
        evictable = sum(p.stat().st_size for p in files)

        def ok() -> bool:
            if limit and used + need > limit:
                return False
            return shutil.disk_usage(d).free - need >= self.RESERVE

        # evicting cannot help (bigger than the limit itself, or than the disk could hold with the whole cache gone):
        # refused before anything is deleted
        if (limit and used - evictable + need > limit) or shutil.disk_usage(d).free + evictable - need < self.RESERVE:
            if not ok():
                raise SgError(507, "Not enough room for this Version's media (ShotGrid cache limit or free disk space)")
        while not ok() and files:
            p = files.pop(0)
            try:
                size = p.stat().st_size
                p.unlink()
                used -= size   # (only once it is really gone: a file in use on Windows stays and still counts)
                side = p.with_name(p.name + ".sgsrc")   # its upload mark goes with it (kept alone it is never evicted)
                if side.exists():
                    used -= side.stat().st_size
                    side.unlink()
            except OSError:
                pass
        if not ok():
            raise SgError(507, "Not enough room for this Version's media (ShotGrid cache limit or free disk space)")

    def fetch_media(self, vid: int, root: Path | None = None, can_open=None) -> tuple[Path, dict]:
        """Downloads a Version's web proxy (uploaded movie, else its picture) into the media cache (`root`: the cache
        source's own path as the library spells it); reuses the file there while it is the same upload. `can_open(name)`
        refuses a type Sight cannot open before anything is downloaded. Returns (path, version record)."""
        fields = ["code", "project", "entity", "sg_task", "sg_first_frame", "frame_range", "sg_status_list",
                  "sg_uploaded_movie", "image", "updated_at"]
        v = self.version(vid, fields)
        up = v.get("sg_uploaded_movie")
        if isinstance(up, dict) and up.get("url"):
            url, name = up["url"], up.get("name") or f"{v.get('code') or vid}.mp4"
        elif isinstance(v.get("image"), str) and v["image"].startswith(("http://", "https://")):
            url, name = v["image"], f"{v.get('code') or vid}.jpg"
        else:
            raise SgError(404, "This Version has no media")
        name = name if isinstance(name, str) else f"{v.get('code') or vid}"
        stem, ext = os.path.splitext(re.sub(r'[\x00-\x1f\\/:*?"<>|]+', "_", name).strip().strip(". "))
        if ext in ("", ".") or len(ext) > 8:
            ext = ".mp4" if isinstance(up, dict) else ".jpg"
        stem = (stem or f"version{int(vid)}")[:100]
        if can_open and not can_open(stem + ext):
            raise SgError(415, f"Sight cannot open this Version's media ({ext})")
        d = (root or self.media_dir()) / self._host_dir("x").name
        path = d / f"{stem}__v{int(vid)}{ext}"
        # the same upload (its attachment id, else the Version's stamp) reuses the file; a new one downloads again
        mark = str((up or {}).get("id") or "") if isinstance(up, dict) else ""
        mark = mark or str(v.get("updated_at") or "")
        side = path.with_name(path.name + ".sgsrc")
        try:
            same = side.read_text(encoding="utf-8") == mark
        except OSError:
            same = False
        if path.exists() and path.stat().st_size and same:
            st = path.stat()
            os.utime(path, (time.time(), st.st_mtime))   # last opened (atime): kept longest; mtime as is (no re-thumbnail)
            return path, v
        d.mkdir(parents=True, exist_ok=True)
        self._stream_to(url, path)
        side.write_text(mark, encoding="utf-8")
        return path, v

    def _stream_to(self, url: str, path: Path) -> None:
        """Streams a download to `path` (via .part), making room for its announced size first and as it grows.
        The site's own links get the token; a redirect is followed without it (a signed storage link)."""
        c = self._load()
        site = c.get("site", "")
        u = urllib.parse.urlsplit(url)
        on_site = f"{u.scheme}://{u.netloc}".lower() == site.lower()
        if not on_site and u.scheme != "https":
            raise SgError(400, "https only")
        h = {"User-Agent": "Sight"}
        if on_site:
            h["Authorization"] = "Bearer " + self._token(c, "")
        tmp = path.with_name(path.name + ".part")
        try:
            try:
                resp = _opener_for(url).open(urllib.request.Request(url, headers=h), timeout=TIMEOUT_S)
            except urllib.error.HTTPError as e:
                loc = e.headers.get("Location") if e.code in (301, 302, 303, 307, 308) else None
                if not loc:
                    raise SgError(502, f"download failed ({e.code})") from None
                loc = urllib.parse.urljoin(url, loc)
                if not loc.lower().startswith("https://"):
                    raise SgError(400, "redirect to http") from None
                resp = _opener_for(loc).open(urllib.request.Request(loc, headers={"User-Agent": "Sight"}), timeout=TIMEOUT_S)
            with resp:
                size = int(resp.headers.get("Content-Length") or 0)
                self.make_room(size or 64 * 1048576)
                got = 0
                with open(tmp, "wb") as f:
                    while True:
                        chunk = resp.read(1048576)
                        if not chunk:
                            break
                        f.write(chunk)
                        got += len(chunk)
                        if not size and got % (256 * 1048576) < 1048576:
                            self.make_room(256 * 1048576, keep=tmp)   # (.part counts in `used` already)
            os.replace(tmp, path)
        except (urllib.error.URLError, http.client.HTTPException, TimeoutError, OSError) as e:
            raise SgError(502, f"download failed ({type(e).__name__})") from None
        finally:
            try:
                tmp.unlink()
            except OSError:
                pass
