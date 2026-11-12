"""Shared helpers for tools/bench_*.py — stdlib only, so the benches run with any Python 3.10+.

- `isolated_home(src)`: a throwaway SIGHT_HOME — a copy of `src` (a real library to measure on)
  or an empty one. Benches never write the live library. A copied library still watches and scans
  its sources — the real media folders — read-only, like Sight itself.
- `start_sight(home, ...)`: launches Sight (source `Sight.py` or a built exe) with --no-browser on a
  free port; returns the process, the base URL and the ms until /api/health answered.
- `Browser` / `Page`: an off-screen Chromium-family browser (Edge / Chrome / Chromium) driven over
  the DevTools protocol through a minimal WebSocket client (`CDP`).
- `make_images(folder, n)`: a synthetic library when no real one is given.

Gotcha (from the 2026-11-10 session): never kill processes by command line pattern — the bench's
own command line contains the same home path. Everything started here is stopped by its handle.
"""

from __future__ import annotations

import base64
import contextlib
import json
import os
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextlib.contextmanager
def isolated_home(src: str | None):
    tmp = Path(tempfile.mkdtemp(prefix="sight-bench-"))
    home = tmp / "home"
    try:
        if src:
            # The library and settings only: thumbnails are copied too (a cold thumbnail cache is
            # not what a real start looks like), the browser profile and runtime venv are not.
            shutil.copytree(src, home, ignore=shutil.ignore_patterns("browser", "runtime", "*.log"))
        else:
            home.mkdir()
        yield home
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def wait_http(url: str, timeout: float = 30.0) -> None:
    deadline = time.time() + timeout
    while True:
        try:
            urllib.request.urlopen(url, timeout=1).read()
            return
        except Exception:
            if time.time() > deadline:
                raise TimeoutError(url)
            time.sleep(0.005)


def start_sight(home: Path, exe: str | None = None, port: int | None = None):
    port = port or free_port()
    if not exe:
        # Without Sight's dependencies Sight.py installs a venv into the (temp) home and re-execs —
        # on Windows as a new process, so this handle would no longer stop the server.
        try:
            import starlette, uvicorn  # noqa: F401
        except ImportError:
            sys.exit("Run the bench with Sight's own Python (e.g. ~/.sight/runtime/Scripts/python.exe) or pass --exe.")
    cmd = [exe] if exe else [sys.executable, str(ROOT / "Sight.py")]
    env = {**os.environ, "SIGHT_HOME": str(home)}
    env.pop("SIGHT_DEV", None)
    t0 = time.perf_counter()
    proc = subprocess.Popen([*cmd, "--no-browser", "--port", str(port)], cwd=str(ROOT), env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f"http://127.0.0.1:{port}"
    try:
        wait_http(base + "/api/health")
    except BaseException:
        stop(proc)
        raise
    return proc, base, (time.perf_counter() - t0) * 1000


def stop(proc: subprocess.Popen) -> None:
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


def api(base: str, path: str, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, method="POST" if body is not None else "GET",
                                 headers={"content-type": "application/json"} if body is not None else {})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b"null")


def make_images(folder: Path, n: int) -> None:
    from PIL import Image  # Sight's own dependency

    folder.mkdir(parents=True, exist_ok=True)
    for i in range(n):
        w, h = (640, 480) if i % 3 else (480, 720)
        Image.new("RGB", (w, h), ((i * 37) % 256, (i * 91) % 256, (i * 53) % 256)).save(folder / f"img_{i:05d}.jpg", quality=70)


# ---- browser + DevTools protocol ----------------------------------------------------------------

def find_browser() -> str | None:
    """Edge / Chrome / Chromium, the same family Sight opens its window with."""
    sys.path.insert(0, str(ROOT))
    try:
        import Sight  # find_app_browser() knows every install location Sight supports

        found = Sight.find_app_browser()
        if found:
            return found[0]
    except Exception:
        pass
    for name in ("chromium", "chromium-browser", "google-chrome", "microsoft-edge"):
        path = shutil.which(name)
        if path:
            return path
    for path in ("/opt/pw-browsers/chromium",):
        for p in Path(path).glob("**/chrome") if Path(path).is_dir() else []:
            return str(p)
    return None


class CDP:
    """A minimal WebSocket (RFC 6455) client speaking the DevTools protocol: send() a method and
    wait for its result; events that arrive meanwhile are kept in `events`."""

    def __init__(self, ws_url: str) -> None:
        rest = ws_url.split("://", 1)[1]
        hostport, path = rest.split("/", 1)
        host, port = hostport.split(":")
        self.sock = socket.create_connection((host, int(port)), timeout=60)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f"GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\n"
                           f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        head = b""
        while b"\r\n\r\n" not in head:
            head += self.sock.recv(1)
        if b" 101 " not in head.split(b"\r\n", 1)[0]:
            raise ConnectionError(head.decode(errors="replace"))
        self.next_id = 0
        self.events: list[dict] = []

    def _recv_exact(self, n: int) -> bytes:
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise ConnectionError("closed")
            buf += chunk
        return buf

    def _recv(self) -> dict:
        data = b""
        while True:
            b0, b1 = self._recv_exact(2)
            n = b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._recv_exact(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._recv_exact(8))[0]
            payload = self._recv_exact(n)
            if b0 & 0x0F == 8:
                raise ConnectionError("closed")
            if b0 & 0x0F in (0, 1):
                data += payload
                if b0 & 0x80:
                    return json.loads(data)

    def send(self, method: str, **params):
        self.next_id += 1
        msg = json.dumps({"id": self.next_id, "method": method, "params": params}).encode()
        mask = os.urandom(4)
        head = bytes([0x81])
        n = len(msg)
        head += bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack(">H", n) if n < 65536 else bytes([0x80 | 127]) + struct.pack(">Q", n)
        self.sock.sendall(head + mask + bytes(c ^ mask[i % 4] for i, c in enumerate(msg)))
        while True:
            m = self._recv()
            if m.get("id") == self.next_id:
                if "error" in m:
                    raise RuntimeError(f"{method}: {m['error']}")
                return m.get("result", {})
            self.events.append(m)

    def eval(self, expr: str, await_promise: bool = True):
        r = self.send("Runtime.evaluate", expression=expr, awaitPromise=await_promise, returnByValue=True)
        if "exceptionDetails" in r:
            raise RuntimeError(r["exceptionDetails"].get("text"))
        return r.get("result", {}).get("value")


class Browser:
    """An off-screen (headless) browser with its own throwaway profile."""

    def __init__(self, exe: str, width: int = 1400, height: int = 900) -> None:
        self.profile = tempfile.mkdtemp(prefix="sight-bench-browser-")
        self.proc = subprocess.Popen([
            exe, "--headless=new", "--remote-debugging-port=0", f"--user-data-dir={self.profile}",
            f"--window-size={width},{height}", "--no-first-run", "--no-default-browser-check",
            "--no-sandbox", "about:blank",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        port_file = Path(self.profile) / "DevToolsActivePort"
        deadline = time.time() + 30
        while not port_file.exists() or not port_file.read_text().strip():
            if time.time() > deadline:
                raise TimeoutError("browser did not start")
            time.sleep(0.05)
        self.port = int(port_file.read_text().split()[0])

    def page(self) -> CDP:
        targets = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json/list").read())
        page = next(t for t in targets if t.get("type") == "page")
        cdp = CDP(page["webSocketDebuggerUrl"])
        cdp.send("Page.enable")
        cdp.send("Runtime.enable")
        return cdp

    def close(self) -> None:
        self.proc.terminate()
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        shutil.rmtree(self.profile, ignore_errors=True)


def wait_js(cdp: CDP, cond: str, timeout: float = 30.0) -> float:
    """Polls a JS condition in the page; returns the ms it took."""
    t0 = time.perf_counter()
    while not cdp.eval(f"!!({cond})", await_promise=False):
        if time.perf_counter() - t0 > timeout:
            raise TimeoutError(cond)
        time.sleep(0.01)
    return (time.perf_counter() - t0) * 1000


def summary(values: list[float]) -> str:
    s = sorted(values)
    return f"median {s[len(s) // 2]:.0f} ms  (min {s[0]:.0f}, max {s[-1]:.0f}, n={len(s)})"
