"""Speech-to-text through a service the user picks (Settings → Dictation): any endpoint that speaks the
OpenAI-compatible `POST …/audio/transcriptions` (multipart `file` + `model`, Bearer key) — OpenAI, Groq, a local
whisper server (faster-whisper-server / speaches, LocalAI, whisper.cpp's OpenAI mode) and others. The page records
a phrase and posts it to /api/stt/transcribe; this module forwards it and returns the text. Whisper-type services
detect the language when none is given.

The config lives only here, in <SIGHT_HOME>/stt.json (0600). The key is never sent back to the page, never in
settings.json / localStorage, never logged. Changing the URL drops a stored key unless a new one comes with it, so
nothing that can reach the settings can redirect the user's key elsewhere. Standard library only.
"""

from __future__ import annotations

import http.client
import json
import os
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

MAX_AUDIO = 20 * 1048576          # a dictated phrase is far below; most services cap at 25 MB
TIMEOUT_S = 60


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    # urllib would re-send the Authorization header to wherever a redirect points: never follow one.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)
# A local whisper server must never go through a system / corporate proxy (Windows applies one to localhost
# unless "<local>" is excluded) — nor should its key travel there in clear text over http.
_DIRECT = urllib.request.build_opener(_NoRedirect, urllib.request.ProxyHandler({}))
_LOCAL = ("localhost", "127.0.0.1", "::1")


def _opener_for(url: str):
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    return _DIRECT if host in _LOCAL or host.endswith(".localhost") else _OPENER


class SttError(Exception):
    """A failure the page can show: `code` picks its message (not-set, bad-key, rate, offline, failed)."""

    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(detail or code)
        self.code = code


def valid_url(url: str) -> bool:
    if not isinstance(url, str) or len(url) > 500 or not re.fullmatch(r"[\x21-\x7e]+", url):
        return False   # no spaces / control / non-ASCII characters (the page's `new URL()` must accept it too)
    try:
        u = urllib.parse.urlsplit(url)
        u.port   # raises for a non-numeric or out-of-range port
    except ValueError:
        return False
    return u.scheme in ("http", "https") and bool(u.hostname) and not u.username and u.password is None


class SttService:
    def __init__(self, home: Path) -> None:
        self.path = home / "stt.json"
        self._lock = threading.RLock()   # _load() may take it inside configure()

    def _load(self) -> dict:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        if not isinstance(raw, dict):
            return {}
        if "groq_key" in raw:   # the 0.70 Groq-only file: not carried over, and its key does not stay on disk
            with self._lock:   # re-check under the lock: a save in between must not be deleted
                try:
                    if "groq_key" in json.loads(self.path.read_text(encoding="utf-8")):
                        self.path.unlink()
                except (OSError, ValueError, TypeError):
                    pass
            return {}
        out = {k: raw.get(k) for k in ("url", "model", "key")}
        return {k: v.strip() for k, v in out.items() if isinstance(v, str) and v.strip()}

    def status(self) -> dict:
        c = self._load()
        url = c.get("url", "")
        return {"configured": bool(url and valid_url(url)), "url": url, "model": c.get("model", ""), "hasKey": bool(c.get("key"))}

    def configure(self, data: dict) -> bool:
        """Save url / model / key. A missing "key" keeps the stored one (unless the URL changes); "" removes it.
        Returns False for values that cannot be right."""
        url, model, key = data.get("url", ""), data.get("model", ""), data.get("key")
        if not isinstance(url, str) or not isinstance(model, str) or (key is not None and not isinstance(key, str)):
            return False
        url, model = url.strip(), model.strip()
        if url and not valid_url(url):
            return False
        if len(model) > 200 or (model and not re.fullmatch(r"[\w.:/\-]+", model)):
            return False
        if key is not None:
            key = key.strip()
            if len(key) > 500 or (key and not re.fullmatch(r"[\x21-\x7e]+", key)):
                return False
        with self._lock:
            old = self._load()
            if key is None:
                key = old.get("key", "") if old.get("url", "") == url else ""
            if not url:
                key = ""   # a key without an address is never kept (the page could not remove it)
            new = {k: v for k, v in (("url", url), ("model", model), ("key", key)) if v}
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
            # Created readable by the user only from the start (where the OS has such modes).
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(json.dumps(new))
            os.replace(tmp, self.path)
        return True

    def transcribe(self, audio: bytes, content_type: str, language: str = "") -> str:
        c = self._load()
        url = c.get("url", "")
        if not url or not valid_url(url):
            raise SttError("not-set")
        if not audio:
            return ""
        if len(audio) > MAX_AUDIO:
            raise SttError("failed", "audio too long")
        lang = language.strip().lower()[:2] if re.fullmatch(r"[A-Za-z]{2}([-_][A-Za-z]{2,4})?", language or "") else ""
        ext = "ogg" if "ogg" in content_type else "mp4" if "mp4" in content_type else "wav" if "wav" in content_type else "webm"
        fields = {"model": c.get("model") or "whisper-1", "response_format": "json", "temperature": "0"}
        if lang:
            fields["language"] = lang   # none: the service detects it
        boundary = "----sight" + uuid.uuid4().hex
        parts: list[bytes] = []
        for name, value in fields.items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="speech.{ext}"\r\n'
            f"Content-Type: {content_type or 'audio/webm'}\r\n\r\n".encode()
        )
        parts.append(audio)
        parts.append(f"\r\n--{boundary}--\r\n".encode())
        headers = {"Content-Type": f"multipart/form-data; boundary={boundary}", "User-Agent": "Sight"}
        if c.get("key"):
            headers["Authorization"] = f"Bearer {c['key']}"
        req = urllib.request.Request(url, data=b"".join(parts), method="POST", headers=headers)
        try:
            with _opener_for(url).open(req, timeout=TIMEOUT_S) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise SttError("bad-key") from None
            if e.code == 429:
                raise SttError("rate") from None
            raise SttError("failed", f"HTTP {e.code}") from None
        except http.client.HTTPException as e:
            raise SttError("failed", type(e).__name__) from None
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise SttError("offline", type(e).__name__) from None
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except ValueError:
            raise SttError("failed", "not JSON") from None
        text = data.get("text") if isinstance(data, dict) else ""
        return text.strip() if isinstance(text, str) else ""
