"""Trackers — the tracker-neutral layer between Sight and a production tracker (docs/PLAN-trackers.md decision 11,
docs/ARCHITECTURE.md "Tracker adapters").

Several trackers can be connected at once and the UI is one for all of them. A tracker is identified by its **kind**
(the adapter: "shotgrid") plus its **site**; the pair is the **tracker key** "<kind>:<host>" (host lowercased, default
port dropped — `tracker_key`). Everything Sight keeps per tracker is filed under that key: a file's link to a media
entity (`tracker_links`), a smart collection of a tracker project (`collections.tracker`), the sidebar source rows.

An adapter is one object per configured site (several sites of one kind can be connected at once, 0.110), made by
`Trackers` with Sight's home folder and the site's slot. The server's routes `/api/trackers/{ref}/…` delegate to it
(app/server.py) — ref = a tracker key, or a kind for that kind's primary site; the old `/api/sg/…` routes are aliases
for kind "shotgrid".
The interface an adapter implements (duck-typed; `ShotGridService` in app/shotgrid.py is the first one, `CorelineService`
in app/coreline.py the second):

    kind: str, name: str                     "shotgrid", "ShotGrid"
    tracker() -> dict | None                 its /api/trackers entry while connected (configured and usable), else
                                             None: {id, kind, key, name, site, host, note}
    site() -> str                            the configured site ("" none) — the tracker key's host comes from it
    status() -> dict                         settings as the page may see them (never a secret), incl. `configured`
    configure(data: dict, taken) -> bool     save the settings (False: refused values; `taken` = the keys other connected
                                             sites of the kind have — the same site again raises TrackerError 409)
    forward(method, url, body, headers, sudo) -> (status, content type, body)
                                             one request on the page's behalf (the page's client talks through it;
                                             the server adds the credentials) — raises TrackerError
    picture(media_id: str, kind: str, stamp: str) -> (Path, content type) | None
                                             a media entity's thumbnail ("image") / filmstrip, cached on disk
    fetch_media(media_id: str, root: Path, can_open) -> (Path, record dict)
                                             download a media entity's viewable file into the media cache
    media_dir() -> Path                      the kind's media cache folder (a library source the sidebar hides; one for
                                             every site of the kind)
    cache_dir() -> Path                      this site's folder inside it (its downloads, size, limit, Clear cache)
    cache_info() -> dict                     {used, files, free, limitGB} of this site's folder
    clear_cache() -> int                     files removed from this site's folder
    slot: int, slots(home) -> [int], stored(), remove(), take_over(other)
                                             one adapter per configured site: `cls(home, slot)`; the stored slots in
                                             order; whether this slot has settings; delete them; move another slot's
                                             settings into this one (Trackers.configure)

Media ids travel as strings (`parse_media_id` turns them into what the adapter needs; a refused one is a 404).
Errors are `TrackerError(status, detail)`; `SgError` is ShotGrid's (a subclass).

Standard library only.
"""

from __future__ import annotations

import ipaddress
import re
import threading
import urllib.parse
from pathlib import Path

KIND_RE = re.compile(r"[a-z][a-z0-9_-]{0,31}")


class TrackerError(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status


_SCHEME = re.compile(r"[a-z][a-z0-9+.-]*://", re.I)
_DEFAULT_PORT = {"http": 80, "https": 443}


def _ipv4(h: str) -> str | None:
    """The WHATWG URL rule for a host that "ends in a number" ('0x7f.1', '127.1', '0177.0.0.1'): its dotted-quad form,
    "" when it is no valid address (the browser refuses the URL), None when it is not an IPv4 host at all."""
    parts = h.split(".")
    if len(parts) > 1 and parts[-1] == "":
        parts = parts[:-1]
    num = lambda p: re.fullmatch(r"\d+", p) or re.fullmatch(r"0x[0-9a-f]*", p)   # (hostname is lowercased)
    if not parts or not num(parts[-1]):
        return None
    if len(parts) > 4:
        return ""
    nums = []
    for p in parts:
        if re.fullmatch(r"0x[0-9a-f]*", p):
            nums.append(int(p[2:] or "0", 16))
        elif re.fullmatch(r"0[0-7]+", p):
            nums.append(int(p, 8))
        elif re.fullmatch(r"0|[1-9]\d*", p):
            nums.append(int(p))
        else:
            return ""
    if any(n > 255 for n in nums[:-1]) or nums[-1] >= 256 ** (5 - len(nums)):
        return ""
    v = nums[-1] + sum(n * 256 ** (3 - i) for i, n in enumerate(nums[:-1]))
    return ".".join(str((v >> s) & 255) for s in (24, 16, 8, 0))


def _ipv6_text(ip: ipaddress.IPv6Address) -> str:
    """The WHATWG IPv6 serializer: eight hex pieces, the first longest run of 2+ zero pieces as "::", never a dotted
    IPv4 tail (Python's `compressed` writes ::ffff:1.2.3.4, the browser ::ffff:102:304)."""
    n = int(ip)
    pieces = [(n >> (112 - 16 * i)) & 0xFFFF for i in range(8)]
    best, blen, i = -1, 1, 0
    while i < 8:
        if pieces[i] == 0:
            j = i
            while j < 8 and pieces[j] == 0:
                j += 1
            if j - i > blen:
                best, blen = i, j - i
            i = j
        else:
            i += 1
    if best < 0:
        return ":".join(f"{p:x}" for p in pieces)
    return ":".join(f"{p:x}" for p in pieces[:best]) + "::" + ":".join(f"{p:x}" for p in pieces[best + blen:])


def _canon_hostname(h: str | None) -> str:
    """A hostname (as urlsplit gives it: lowercased, IPv6 without brackets) the way the browser's URL.host spells it:
    IPv6 compressed in brackets, IPv4 in any WHATWG spelling as a dotted quad, a non-ASCII name in punycode (IDNA 2003 —
    the same as the browser's for ordinary names; a configured site must be ASCII anyway, `valid_site`). "" = none."""
    if not h:
        return ""
    if "%" in h:
        h = urllib.parse.unquote(h).lower()   # (the browser decodes a percent-encoded host first)
    if ":" in h:
        try:
            return f"[{_ipv6_text(ipaddress.IPv6Address(h))}]"
        except ValueError:
            return ""
    if not h.isascii():
        try:
            h = h.encode("idna").decode("ascii").lower()
        except UnicodeError:
            return ""
    v4 = _ipv4(h)
    if v4 is not None:
        return v4
    return h if re.fullmatch(r"[a-z0-9_-]+(\.[a-z0-9_-]+)*\.?", h) else ""


def canonical_hostname(h: str | None) -> bool:
    """True when the browser spells this hostname (urlsplit's) the same way — `valid_site` refuses any other, so a
    configured site's key is the same on the server and in the page."""
    c = _canon_hostname(h)
    return bool(c) and c == (f"[{h}]" if h and ":" in h else h)


def host_of(site: str) -> str:
    """'https://Studio.example:443' -> 'studio.example' — the same rule as the browser's URL.host (SightTrackers.hostOf):
    no scheme = https, http(s) only, the hostname canonical (`_canon_hostname`), the scheme's default port dropped."""
    s = (site or "").strip()
    if not s:
        return ""
    if not _SCHEME.match(s):
        s = "https://" + s
    try:
        u = urllib.parse.urlsplit(s)
        host = _canon_hostname(u.hostname)
        port = u.port
    except ValueError:
        return ""
    scheme = u.scheme.lower()
    if not host or scheme not in _DEFAULT_PORT:
        return ""
    if port is not None and port != _DEFAULT_PORT[scheme]:
        host += f":{port}"
    return host


def host_norm(host: str) -> str:
    """A host already in URL.host form, stored without its scheme (a ShotGrid link's `site`, a pre-0.107 smart
    collection's `sg_site`) -> the same canonical spelling, its port kept as it is (URL.host dropped the default port of
    the scheme it came with; guessing a scheme here would drop a port that was not the default: http://h:443)."""
    if not isinstance(host, str) or not re.fullmatch(r"[\x21-\x7e]+", host.strip()):
        return ""
    try:
        u = urllib.parse.urlsplit("//" + host.strip())
        name, port = _canon_hostname(u.hostname), u.port
    except ValueError:
        return ""
    if not name or u.path or u.query or u.fragment or u.username is not None:
        return ""
    return name + (f":{port}" if port is not None else "")


def tracker_key(kind: str, site: str) -> str:
    """The tracker key "<kind>:<host>" of a site ("" when there is none)."""
    host = host_of(site)
    return f"{kind}:{host}" if kind and host else ""


def tracker_key_of_host(kind: str, host: str) -> str:
    """The tracker key from a host stored without its scheme (`host_norm`)."""
    h = host_norm(host)
    return f"{kind}:{h}" if kind and h else ""


def split_key(key: object) -> tuple[str, str] | None:
    """"shotgrid:studio.example" -> ("shotgrid", "studio.example"); None for anything that is not a tracker key."""
    if not isinstance(key, str) or len(key) > 300:
        return None
    kind, sep, host = key.partition(":")
    if not sep or not KIND_RE.fullmatch(kind) or not host or not re.fullmatch(r"[\x21-\x7e]+", host) or host != host.lower():
        return None
    return kind, host


class Trackers:
    """The adapters Sight has (the registry): per kind, one adapter **per configured site** (0.110 — several sites of
    one kind at once, docs/PLAN-trackers.md 5b-2 (4)). An adapter class has `kind`, `name`, `slots(home)` (its stored
    sites' slot numbers, in order) and is made as `cls(home, slot)`; each instance is one site (one settings file) and
    is kept for the process (its tokens live in it). A route names a tracker by its **key** "<kind>:<host>" (any slot
    whose site gives that key, connected or not) or by its **kind** alone — the kind's *primary* site (`get`): the first
    connected one, else the first stored, else slot 1 (the only site a pre-0.110 client knows; `/api/sg/…` and
    `/api/trackers/<kind>/…` stay aliases of it). `spare(kind)`: where *Connect a tracker…* saves — the first stored site
    that is not connected (its settings kept from a Disconnect), else a new slot (nothing stored until it is saved)."""

    def __init__(self, home: Path) -> None:
        from .coreline import CorelineService
        from .shotgrid import ShotGridService
        self.home = home
        self._classes = {c.kind: c for c in (ShotGridService, CorelineService)}
        self._made: dict[tuple[str, int], object] = {}
        self._lock = threading.RLock()

    @property
    def kinds(self) -> list[dict]:
        return [{"id": c.kind, "name": c.name} for c in self._classes.values()]

    def _inst(self, kind: str, slot: int):
        with self._lock:
            a = self._made.get((kind, slot))
            if a is None:
                a = self._made[(kind, slot)] = self._classes[kind](self.home, slot)
            return a

    def sites(self, kind: str) -> list:
        """Every stored site of `kind` (connected or not), in slot order."""
        cls = self._classes.get(kind)
        return [self._inst(kind, n) for n in cls.slots(self.home)] if cls else []

    def get(self, kind: str):
        """The kind's primary site (see the class) — None for a kind Sight has no adapter for."""
        if kind not in self._classes:
            return None
        ss = self.sites(kind)
        return next((a for a in ss if a.tracker()), None) or (ss[0] if ss else self._inst(kind, 1))

    def by_key(self, key: str):
        """The site whose tracker key is `key` (connected or not; a connected one first, should two slots name it),
        else None."""
        sk = split_key(key)
        if not sk or sk[0] not in self._classes:
            return None
        hits = [a for a in self.sites(sk[0]) if tracker_key(sk[0], a.site()) == key]
        return next((a for a in hits if a.tracker()), None) or (hits[0] if hits else None)

    def resolve(self, ref: str):
        """A route's tracker: a tracker key ("<kind>:<host>") or a kind (its primary site); None = no such tracker."""
        return self.by_key(ref) if ":" in (ref or "") else self.get(ref)

    def spare(self, kind: str, slot: int | None = None):
        """Where Connect a tracker… → <kind> saves: the first stored site of it not connected, else a new slot. `slot`:
        the one a first answer named (the page pins its later requests to it, so a Disconnect meanwhile cannot move a
        save onto another site's kept settings) — TrackerError 409 when that slot is connected by now."""
        if kind not in self._classes:
            return None
        if slot is not None:
            if not 1 <= slot <= 9999:
                raise TrackerError(404, "no such tracker")
            a = self._inst(kind, slot)
            if a.tracker():
                raise TrackerError(409, f"Another {a.name} site was connected here meanwhile — use Connect a tracker… again")
            return a
        ss = self.sites(kind)
        a = next((a for a in ss if not a.tracker()), None)
        if a is not None:
            return a
        used = {a.slot for a in ss}
        return self._inst(kind, next(n for n in range(1, len(used) + 2) if n not in used))

    def all(self) -> list:
        """One adapter per kind (its primary site) — for what is the kind's own: the media cache folder (one library
        source for every site of a kind)."""
        return [self.get(k) for k in self._classes]

    def connected(self) -> list[dict]:
        return [t for k in self._classes for t in (a.tracker() for a in self.sites(k)) if t]

    def key_of(self, kind: str) -> str:
        """The tracker key of `kind`'s primary site as configured now ("" without a site)."""
        a = self.get(kind)
        return tracker_key(kind, a.site()) if a else ""

    def configure(self, a, data: dict):
        """Save one site's settings (`a.configure`) -> the adapter that holds them now, None for refused values. A site
        another *connected* site of the kind has is refused (TrackerError 409 from the adapter); a *not connected*
        stored site with the same one is dropped (this one took it over — e.g. Connect a tracker… set up a site again
        whose old settings were kept in another slot). When the dropped one was slot 1, the saved settings move into
        slot 1 (`take_over`): the first site stays in the file an older Sight reads (ShotGrid: shotgrid.json)."""
        with self._lock:
            others = [b for b in self.sites(a.kind) if b is not a]
            taken = {t["key"] for t in (b.tracker() for b in others) if t}
            if not a.configure(data, taken):
                return None
            key = tracker_key(a.kind, a.site())
            for b in others:
                if key and not b.tracker() and tracker_key(a.kind, b.site()) == key:
                    if b.slot == 1 and a.stored() and b.take_over(a):
                        a = b
                    else:
                        b.remove()   # (also when the move failed: one stored entry for the site either way)
            return a

    def idle_cache(self, kind: str) -> list[Path]:
        """The kind's cached media files that belong to no connected site (another site's folder, a site switched away
        from): the "Tracker media cache … Clear" line of Settings → Trackers."""
        a = self.get(kind)
        if a is None:
            return []
        root = Path(a.media_dir())
        busy = [Path(b.cache_dir()) for b in self.sites(kind) if b.tracker()]
        if not root.exists():
            return []
        return [p for p in root.rglob("*") if p.is_file() and not any(p.is_relative_to(d) for d in busy)]
