"""Settings that outlive a session: the UI's own knobs and the app window's geometry.

The UI keeps its options in localStorage, but that is per-origin (http://127.0.0.1:<port>) and the
launcher takes the first free port, so a busy port used to start from a blank profile. The copy
kept here, in <SIGHT_HOME>/settings.json, does not depend on the port or on which browser
profile happens to be in use: the page loads it before reading anything and writes back every change.
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path

UI_PREFIX = "sight."
MAX_UI_BYTES = 2 * 1024 * 1024
MIN_W, MIN_H = 320, 240


def _int(v: object, lo: int, hi: int) -> int | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    n = int(v)
    return n if lo <= n <= hi else None


def clean_window(raw: object) -> dict | None:
    """Validated window geometry, or None if it isn't usable. `x`/`y`/`w`/`h` are the *normal*
    (un-maximized) bounds — kept while maximized so un-maximizing lands somewhere sensible."""
    if not isinstance(raw, dict):
        return None
    w = _int(raw.get("w"), MIN_W, 20000)
    h = _int(raw.get("h"), MIN_H, 20000)
    if w is None or h is None:
        return None
    out: dict = {"w": w, "h": h, "max": bool(raw.get("max"))}
    x = _int(raw.get("x"), -30000, 30000)
    y = _int(raw.get("y"), -30000, 30000)
    if x is not None and y is not None:
        out["x"], out["y"] = x, y
    return out


DEFAULT_SECTIONS = ("theme", "viewer3d")


def load_defaults(path: Path) -> dict:
    """App defaults shipped in app/static/defaults.json — what "reset" returns to and what a fresh
    install starts from. Missing or broken file means {}: the UI then uses its built-in constants."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return clean_defaults(raw) or {}


def clean_defaults(raw: object) -> dict | None:
    if not isinstance(raw, dict):
        return None
    out: dict = {}
    for name in DEFAULT_SECTIONS:
        section = raw.get(name)
        if isinstance(section, dict):
            out[name] = {
                k: v for k, v in section.items()
                if isinstance(k, str) and isinstance(v, (str, int, float, bool))
            }
    tile = raw.get("tileSize")
    if isinstance(tile, (int, float)) and not isinstance(tile, bool):
        out["tileSize"] = tile
    return out or None


def save_defaults(path: Path, raw: object) -> bool:
    data = clean_defaults(raw)
    if data is None:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)
    return True


class SettingsStore:
    def __init__(self, home: Path) -> None:
        self.path = home / "settings.json"
        self._lock = threading.Lock()
        self._data = self._load()

    def _load(self) -> dict:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {"ui": {}, "window": None}
        if not isinstance(raw, dict):
            return {"ui": {}, "window": None}
        ui = raw.get("ui")
        ui = {k: v for k, v in ui.items() if isinstance(k, str) and isinstance(v, str)} if isinstance(ui, dict) else {}
        return {"ui": ui, "window": clean_window(raw.get("window"))}

    def _save(self) -> None:
        # Write-then-replace so a crash or a kill mid-write can't leave a truncated settings file.
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(self.path.name + ".tmp")
        tmp.write_text(json.dumps(self._data, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, self.path)

    def snapshot(self) -> dict:
        with self._lock:
            return {"ui": dict(self._data["ui"]), "window": self._data["window"]}

    def window(self) -> dict | None:
        with self._lock:
            return self._data["window"]

    def set_ui(self, ui: object) -> bool:
        if not isinstance(ui, dict):
            return False
        clean = {
            k: v for k, v in ui.items()
            if isinstance(k, str) and k.startswith(UI_PREFIX) and isinstance(v, str)
        }
        if sum(len(k) + len(v) for k, v in clean.items()) > MAX_UI_BYTES:
            return False
        with self._lock:
            if clean == self._data["ui"]:
                return True
            self._data["ui"] = clean
            self._save()
        return True

    def set_window(self, raw: object) -> bool:
        win = clean_window(raw)
        if win is None:
            return False
        with self._lock:
            if win == self._data["window"]:
                return True
            self._data["window"] = win
            self._save()
        return True
