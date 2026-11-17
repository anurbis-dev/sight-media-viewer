"""Speech-to-text through Groq's Whisper (tier 2 of docs/PLAN-stt.md): the page records a phrase and posts it to
/api/stt/transcribe; this module forwards it to Groq with the user's key and returns the text. Whisper finds the
language by itself when none is given, which the browser's own recogniser (tier 1) cannot.

The key lives only here, in <SIGHT_HOME>/stt.json (never in settings.json, which the page reads back, never in
page JS or localStorage, never logged). Standard library only: no new dependency.
"""

from __future__ import annotations

import http.client
import json
import os
import re
import threading
import urllib.error
import urllib.request
import uuid
from pathlib import Path

GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
MODEL = "whisper-large-v3-turbo"
MAX_AUDIO = 20 * 1048576          # Groq's free tier takes 25 MB per request; a dictated phrase is far below
TIMEOUT_S = 40


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    # urllib would re-send the Authorization header to wherever a redirect points: never follow one.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


class SttError(Exception):
    """A failure the page can show: `code` picks its message (no-key, bad-key, rate, failed)."""

    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(detail or code)
        self.code = code


class GroqStt:
    def __init__(self, home: Path) -> None:
        self.path = home / "stt.json"
        self._lock = threading.Lock()

    def _key(self) -> str:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return ""
        key = raw.get("groq_key") if isinstance(raw, dict) else ""
        return key.strip() if isinstance(key, str) else ""

    def status(self) -> dict:
        return {"configured": bool(self._key()), "model": MODEL}

    def set_key(self, key: object) -> bool:
        """Store the key ('' removes it). Returns False for something that cannot be a key."""
        if not isinstance(key, str):
            return False
        key = key.strip()
        if key and (len(key) > 200 or not re.fullmatch(r"[A-Za-z0-9_\-.]+", key)):
            return False
        with self._lock:
            if not key:
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
                f.write(json.dumps({"groq_key": key}))
            os.replace(tmp, self.path)
        return True

    def transcribe(self, audio: bytes, content_type: str, language: str = "") -> str:
        key = self._key()
        if not key:
            raise SttError("no-key")
        if not audio:
            return ""
        if len(audio) > MAX_AUDIO:
            raise SttError("failed", "audio too long")
        lang = language.strip().lower()[:2] if re.fullmatch(r"[A-Za-z]{2}([-_][A-Za-z]{2,4})?", language or "") else ""
        ext = "ogg" if "ogg" in content_type else "mp4" if "mp4" in content_type else "wav" if "wav" in content_type else "webm"
        fields = {"model": MODEL, "response_format": "json", "temperature": "0"}
        if lang:
            fields["language"] = lang   # none: Whisper detects it
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
        req = urllib.request.Request(
            GROQ_URL, data=b"".join(parts), method="POST",
            headers={"Authorization": f"Bearer {key}", "Content-Type": f"multipart/form-data; boundary={boundary}",
                     "User-Agent": "Sight"},
        )
        try:
            with _OPENER.open(req, timeout=TIMEOUT_S) as resp:
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
