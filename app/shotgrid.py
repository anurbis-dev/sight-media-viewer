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
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

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
    # https only; plain http only for a server on this machine (a local test / proxy)
    return u.scheme == "https" or (u.scheme == "http" and u.hostname in _LOCAL)


class SgError(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status


class ShotGridService:
    def __init__(self, home: Path) -> None:
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

    def status(self) -> dict:
        c = self._load()
        site = c.get("site", "")
        return {
            "configured": bool(site and c.get("script") and c.get("key")),
            "site": site, "script": c.get("script", ""), "hasKey": bool(c.get("key")),
            "statusMap": c.get("statusMap") or {}, "logins": c.get("logins") or {}, "sudo": bool(c.get("sudo")),
        }

    def configure(self, data: dict) -> bool:
        """Save the settings. A missing "key" keeps the stored one (unless site / script change); "" removes it.
        Returns False for values that cannot be right."""
        if not isinstance(data, dict):
            return False
        site = site_url(data.get("site", "")) if isinstance(data.get("site", ""), str) else None
        script, key = data.get("script", ""), data.get("key")
        smap, logins, sudo = data.get("statusMap") or {}, data.get("logins") or {}, data.get("sudo", False)
        if site is None or not isinstance(script, str) or (key is not None and not isinstance(key, str)):
            return False
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
                key = old.get("key", "") if (old.get("site", ""), old.get("script", "")) == (site, script) else ""
            if not site or not script:
                key = ""
            new = {"site": site, "script": script, "key": key, "statusMap": smap, "logins": logins, "sudo": bool(sudo)}
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
        if not (site and c.get("script") and c.get("key")):
            raise SgError(412, "ShotGrid is not set up (Settings → ShotGrid)")
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
