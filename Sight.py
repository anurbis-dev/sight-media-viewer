#!/usr/bin/env python3
"""Sight — in-place media library.

Double-click Sight.command (Mac) or Sight.bat (Windows), or run this file.
It installs what it needs, finds ffmpeg, starts the local app, and opens it.
Close the terminal window to quit.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

MIN_PY = (3, 10)
DEPS = [
    "starlette>=0.40",
    "uvicorn[standard]>=0.32",
    "pillow>=10.4",
    "watchdog>=5.0",
    "imageio-ffmpeg>=0.5",
    "psd-tools>=1.10",
    "zstandard>=0.22",
    "pymupdf>=1.24",
]
DEP_MODULES = ("starlette", "uvicorn", "PIL", "watchdog", "imageio_ffmpeg", "psd_tools", "zstandard", "pymupdf")
PROBE = "import " + ", ".join(DEP_MODULES)
ROOT = Path(__file__).resolve().parent


def data_dir() -> Path:
    raw = os.environ.get("SIGHT_HOME")
    return Path(raw).expanduser() if raw else Path.home() / ".sight"


def venv_python(home: Path) -> Path:
    if sys.platform == "win32":
        return home / "runtime" / "Scripts" / "python.exe"
    return home / "runtime" / "bin" / "python"


def venv_pip(home: Path) -> Path:
    if sys.platform == "win32":
        return home / "runtime" / "Scripts" / "pip.exe"
    return home / "runtime" / "bin" / "pip"


def fix_frozen_streams() -> None:
    """A --windowed frozen build has no console, so sys.stdout/stderr are None — print() would
    crash. Route them to a log file instead, so log() and any traceback stay diagnosable."""
    if not getattr(sys, "frozen", False):
        return
    if sys.stdout is not None and sys.stderr is not None:
        return
    home = data_dir()
    home.mkdir(parents=True, exist_ok=True)
    log_file = open(home / "sight.log", "a", encoding="utf-8", buffering=1)
    sys.stdout = log_file
    sys.stderr = log_file


def fatal(msg: str) -> None:
    if getattr(sys, "frozen", False):
        if sys.platform == "win32":
            try:
                import ctypes

                ctypes.windll.user32.MessageBoxW(0, msg, "Sight", 0x10)
                return
            except Exception:
                pass
        elif sys.platform == "darwin":
            try:
                quoted = '"' + msg.replace("\\", "\\\\").replace('"', '\\"') + '"'
                subprocess.run(["osascript", "-e", f'display alert "Sight" message {quoted}'])
                return
            except Exception:
                pass
    print(msg, file=sys.stderr, flush=True)


def log(msg: str) -> None:
    print(f"Sight · {msg}", flush=True)


def _same_file(a: str | Path, b: str | Path) -> bool:
    return os.path.normcase(os.path.abspath(a)) == os.path.normcase(os.path.abspath(b))


def has_deps(python: str | Path) -> bool:
    """Whether `python` can import the libraries Sight needs. For the running interpreter this is
    checked in-process with find_spec, which locates a package without importing it: the old
    subprocess that imported them all cost ~1.4 s on every launch. Another interpreter still gets
    the subprocess probe."""
    if _same_file(python, sys.executable):
        import importlib
        import importlib.util

        importlib.invalidate_caches()  # a pip install a moment ago must be seen
        return all(importlib.util.find_spec(m) is not None for m in DEP_MODULES)
    r = subprocess.run([str(python), "-c", PROBE], capture_output=True)
    return r.returncode == 0


def install_deps(py: Path) -> None:
    uv = shutil.which("uv")
    if uv:
        cmd = [uv, "pip", "install", "--python", str(py), *DEPS]
        if subprocess.run([*cmd, "--offline"], capture_output=True).returncode == 0:
            return
        log("downloading libraries")
        subprocess.check_call(cmd)
        return
    pip = str(py.parent / ("pip.exe" if sys.platform == "win32" else "pip"))
    subprocess.check_call([pip, "install", "--disable-pip-version-check", "-q", *DEPS])


def bootstrap() -> None:
    if getattr(sys, "frozen", False):
        return  # single-file build already bundles everything it needs
    if sys.version_info < MIN_PY:
        sys.exit(f"Sight needs Python {MIN_PY[0]}.{MIN_PY[1]}+ (found {sys.version.split()[0]})")
    if has_deps(sys.executable):
        return
    home = data_dir()
    home.mkdir(parents=True, exist_ok=True)
    runtime = home / "runtime"
    py = venv_python(home)
    marker = runtime / ".deps-v4"
    in_venv = Path(sys.prefix).resolve() == runtime.resolve()
    if not in_venv and py.exists() and marker.exists():
        # The private runtime was complete when the marker was written. Re-exec straight into it:
        # probing it from here would start a second Python just to import everything (~1.4 s), and
        # the re-exec'd run checks its own libraries in-process anyway and reinstalls what is gone.
        os.execv(str(py), [str(py), str(Path(__file__).resolve()), *sys.argv[1:]])
    if not py.exists():
        log("setting up a private runtime (once)")
        subprocess.check_call([sys.executable, "-m", "venv", str(runtime)])
    if not has_deps(py):
        log("installing libraries")
        try:
            install_deps(py)
        except subprocess.CalledProcessError:
            sys.exit(
                "Sight could not install libraries (no network to PyPI).\n"
                "Connect once, or run: uv pip install --python %s %s"
                % (py, " ".join(DEPS))
            )
        uv = shutil.which("uv")
        if uv:
            subprocess.run(
                [uv, "pip", "install", "--python", str(py), "pillow-heif"],
                capture_output=True,
            )
            # Optional: lets the app convert .usdz models to glTF for viewing/thumbnails
            # (see app/usdz_convert.py). Not in DEPS/PROBE — usd-core has no wheel for
            # every platform/Python combo, and USDZ support degrading to "open
            # externally" shouldn't take the whole app down with it.
            subprocess.run(
                [uv, "pip", "install", "--python", str(py), "usd-core"],
                capture_output=True,
            )
    if not has_deps(py):
        sys.exit("Sight runtime is missing libraries.")
    marker.write_text("ok\n", encoding="utf-8")
    if not in_venv:
        os.execv(str(py), [str(py), str(Path(__file__).resolve()), *sys.argv[1:]])


def find_app_browser() -> list[str] | None:
    """A browser that supports --app=URL: a chromeless window with no tabs or address bar,
    the same thing Chrome/Edge's "Install as app" produces. Preferred over a normal tab so
    Sight looks and behaves like a real desktop app."""
    if sys.platform == "win32":
        for var, vendor in (
            ("PROGRAMFILES(X86)", "Microsoft/Edge/Application/msedge.exe"),
            ("PROGRAMFILES", "Microsoft/Edge/Application/msedge.exe"),
            ("LOCALAPPDATA", "Microsoft/Edge/Application/msedge.exe"),
            ("PROGRAMFILES", "Google/Chrome/Application/chrome.exe"),
            ("PROGRAMFILES(X86)", "Google/Chrome/Application/chrome.exe"),
            ("LOCALAPPDATA", "Google/Chrome/Application/chrome.exe"),
            ("PROGRAMFILES", "BraveSoftware/Brave-Browser/Application/brave.exe"),
            ("PROGRAMFILES(X86)", "BraveSoftware/Brave-Browser/Application/brave.exe"),
            ("LOCALAPPDATA", "BraveSoftware/Brave-Browser/Application/brave.exe"),
            ("PROGRAMFILES", "Vivaldi/Application/vivaldi.exe"),
            ("LOCALAPPDATA", "Vivaldi/Application/vivaldi.exe"),
        ):
            base = os.environ.get(var)
            if not base:
                continue
            cand = Path(base) / vendor
            if cand.exists():
                return [str(cand)]
    elif sys.platform == "darwin":
        for cand in (
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
            "/Applications/Vivaldi.app/Contents/MacOS/Vivaldi",
        ):
            if Path(cand).exists():
                return [cand]
    else:
        for name in ("microsoft-edge", "google-chrome", "chromium", "chromium-browser", "brave-browser", "vivaldi"):
            hit = shutil.which(name)
            if hit:
                return [hit]
    return None


def listen_socket(port: int = 0, start: int = 8765) -> "socket.socket":
    """A loopback socket that is already bound and listening, on `port` or the first free one from
    `start`. main() opens it before the slow server imports and hands it to uvicorn later, so the
    browser can start in parallel: its connections wait in the backlog until the server takes over.
    (Polling a port nobody listens on yet is slow on Windows, where each refused connect takes ~2 s.)
    SO_REUSEADDR as free_port() and uvicorn's own bind set it, so the port picked stays the same."""
    import socket

    for p in [port] if port else range(start, start + 30):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("127.0.0.1", p))
            s.listen(128)
            return s
        except OSError:
            s.close()
            if port:
                raise
    raise RuntimeError("No free port")


def free_port(start: int = 8765) -> int:
    import socket

    for port in range(start, start + 30):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError("No free port")


def bundle_root() -> Path:
    """Where bundled files (app/, etc.) live: the source tree normally, or PyInstaller's onedir
    _internal folder once frozen — ROOT itself isn't reliable there (__file__ for the frozen entry
    script doesn't point at a real path on disk)."""
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return ROOT


def start_splash(show_after_ms: int = 0) -> subprocess.Popen | None:
    """Shows a small native "Sight is loading" indicator the instant Sight launches — purely a
    sign of life while bootstrap/server start happen, not a mask for the real window (that's
    reveal_when_ready() below: the real fix for the browser's own blank/white first frame is to
    never let it reach the screen in the first place, not to cover it with something else the same
    size). Windows only (no equivalent here for macOS yet); returns None on any failure, since a
    missing splash should never block the app itself from starting."""
    if sys.platform != "win32":
        return None
    script = bundle_root() / "app" / "splash_screen.ps1"
    if not script.exists():
        return None
    try:
        return subprocess.Popen(
            [
                "powershell", "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass",
                "-File", str(script), "-MaxWaitSeconds", "45", "-ShowAfterMs", str(show_after_ms),
            ],
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except OSError:
        return None


class LazySplash:
    """Starts the splash only if the launch is still going after `delay` seconds. PowerShell costs
    ~0.7 s of CPU to start, which every launch used to pay although a launch that brings its window
    up within ~1.7 s never showed the splash (it waited ShowAfterMs = 1 s after starting). Now a
    fast launch starts nothing, and a slow one shows the splash at about the same moment as before
    (delay + PowerShell's own start). close() is safe from any thread, before or after the start."""

    def __init__(self, delay: float = 1.0) -> None:
        self._lock = threading.Lock()
        self._closed = False
        self.proc: subprocess.Popen | None = None
        self._timer = threading.Timer(delay, self._start)
        self._timer.daemon = True
        self._timer.start()

    def _start(self) -> None:
        with self._lock:
            if not self._closed:
                self.proc = start_splash()

    def close(self) -> None:
        with self._lock:
            self._closed = True
            self._timer.cancel()
            if self.proc and self.proc.poll() is None:
                self.proc.terminate()


def _process_tree(root: int) -> set[int]:
    """`root` and every process descended from it that is still running (Windows only).

    Needed because the Popen'd msedge.exe is usually not the browser: it starts the real browser
    process and exits within a second (exit code 0), so the window and the processes to close
    belong to its child. A child keeps its parent's pid after the parent has exited."""
    import ctypes
    from ctypes import wintypes

    class PROCESSENTRY32W(ctypes.Structure):
        _fields_ = [
            ("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD),
            ("th32ProcessID", wintypes.DWORD), ("th32DefaultHeapID", ctypes.c_size_t),
            ("th32ModuleID", wintypes.DWORD), ("cntThreads", wintypes.DWORD),
            ("th32ParentProcessID", wintypes.DWORD), ("pcPriClassBase", wintypes.LONG),
            ("dwFlags", wintypes.DWORD), ("szExeFile", wintypes.WCHAR * 260),
        ]

    kernel32 = ctypes.windll.kernel32
    kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    snap = kernel32.CreateToolhelp32Snapshot(0x2, 0)  # TH32CS_SNAPPROCESS
    if not snap or snap == wintypes.HANDLE(-1).value:
        return {root}
    children: dict[int, list[int]] = {}
    try:
        entry = PROCESSENTRY32W()
        entry.dwSize = ctypes.sizeof(PROCESSENTRY32W)
        ok = kernel32.Process32FirstW(snap, ctypes.byref(entry))
        while ok:
            children.setdefault(entry.th32ParentProcessID, []).append(entry.th32ProcessID)
            ok = kernel32.Process32NextW(snap, ctypes.byref(entry))
    finally:
        kernel32.CloseHandle(snap)
    tree, todo = {root}, [root]
    while todo:
        for kid in children.get(todo.pop(), ()):
            if kid not in tree:
                tree.add(kid)
                todo.append(kid)
    return tree


def _find_browser_window(pids: set[int], user32) -> int | None:
    """The real top-level browser window of any of `pids`, or None if there isn't one (yet).
    Matches on window class, not just "owned by this pid": a Chromium process briefly owns several
    other top-level windows during startup too (IME, drag-and-drop, power-broadcast helpers —
    Chrome_WidgetWin_0 and others), and Chrome_WidgetWin_1 is the real one."""
    import ctypes
    from ctypes import wintypes

    found: list[int] = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def _cb(hwnd: int, _lparam: int) -> bool:
        owner_pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner_pid))
        if owner_pid.value not in pids:
            return True
        cls = ctypes.create_unicode_buffer(64)
        user32.GetClassNameW(hwnd, cls, 64)
        if cls.value == "Chrome_WidgetWin_1":
            found.append(hwnd)
            return False
        return True

    user32.EnumWindows(_cb, 0)
    return found[0] if found else None


def _offscreen_point() -> tuple[int, int]:
    """A fixed point far outside any plausible monitor arrangement — _open() launches the browser
    window there instead of hiding it (see reveal_when_ready() for why hiding doesn't work).

    Deliberately NOT computed from this process's own view of the monitors (GetSystemMetrics and
    friends): this process isn't marked DPI-aware, so on any display at other than 100% scaling
    those calls can return values Windows has silently rescaled — inconsistently enough, in testing,
    that even explicitly requesting DPI-awareness at runtime didn't make them trustworthy either.
    Chromium reads this value itself, straight off the command line, in its own coordinate space —
    so a plain number well beyond any real desktop is both simpler and more reliable than trying to
    compute a "just past the last monitor" point here. -32000 also isn't arbitrary: it's the exact
    value Windows itself parks minimized/hidden windows at, which index.html's own window-geometry
    reporting (see moveIntoView()/startWindowTracker() there) already special-cases."""
    return -32000, -32000


def reveal_when_ready(
    proc: subprocess.Popen, ready_port: int, maximized: bool, on_ready=None, timeout: float = 30.0,
) -> None:
    """`proc`'s window was launched off-screen (see _open() below) rather than hidden. Hiding was
    the first thing tried here, and it doesn't work: Windows fully suspends a Chromium window's
    rendering while it's hidden — confirmed by testing, requestAnimationFrame simply stops firing,
    for the whole time it's hidden, no matter what — so a "hide, wait for real content, then show"
    approach always shows a stale/blank frame first regardless, which then has to redraw from
    scratch. A window that's merely off-screen keeps rendering normally the whole time, so once
    index.html's __signalReady() pings ready_port (real content is actually on screen — see
    index.html for how it confirms that), there's nothing left to do here but maximize/focus it.

    Moving the window to its actual saved (or centered) position is *not* done here on purpose —
    that already happened, synchronously, in the browser itself, in index.html's moveIntoView(),
    called right before it pinged ready_port. It belongs there and not here because that runs in
    the browser's own coordinate space, which is always correct, where a cross-process move from
    this (DPI-unaware) process is exactly the unreliable thing _offscreen_point() above avoids.
    Maximizing has no in-browser equivalent, so it's the one piece of geometry still applied here —
    but ShowWindow(SW_MAXIMIZE) takes no coordinates, so it isn't exposed to that problem.

    Bounded by `timeout`: if the page never pings (crash, stuck load), whatever's there is brought
    to the front anyway once it elapses rather than sitting off-screen forever.

    `on_ready` runs the moment the page pings (it closes the splash): the window is on screen from
    then on, so nothing that follows here (finding the window, maximizing) may keep the splash up."""
    import ctypes

    user32 = ctypes.windll.user32
    _wait_for_ping(ready_port, timeout=timeout)
    if on_ready:
        on_ready()
    hwnd = None
    deadline = time.time() + 3.0
    while hwnd is None and time.time() < deadline:
        hwnd = _find_browser_window(_process_tree(proc.pid), user32)
        if hwnd is None:
            time.sleep(0.02)
    if hwnd is None:
        return
    if maximized:
        user32.ShowWindow(hwnd, 3)  # SW_MAXIMIZE
    _bring_to_front(hwnd, user32)


def _bring_to_front(hwnd: int, user32) -> None:
    """SetForegroundWindow, which Windows' foreground lock refuses unless this process was started
    by the foreground process (a double-click in Explorer qualifies; a script or a launcher may not).
    allow_foreground_handoff() at startup covers most of it; if Windows still refuses, attach to
    the input queue of the window that has the focus — then the call is the focus owner's own."""
    import ctypes

    try:
        if user32.SetForegroundWindow(hwnd):
            return
        kernel32 = ctypes.windll.kernel32
        fg = user32.GetForegroundWindow()
        fg_thread = user32.GetWindowThreadProcessId(fg, None) if fg else 0
        me = kernel32.GetCurrentThreadId()
        if not fg_thread or fg_thread == me:
            return
        if user32.AttachThreadInput(me, fg_thread, True):
            try:
                user32.BringWindowToTop(hwnd)
                user32.SetForegroundWindow(hwnd)
            finally:
                user32.AttachThreadInput(me, fg_thread, False)
    except Exception:  # ctypes.ArgumentError included: focus is a nicety, never a crash
        pass


def allow_foreground_handoff() -> None:
    """While Sight still holds the right to take the foreground (it was just started by the user),
    let any process take it — the browser window it opens, the venv re-exec of itself. Must run
    first thing: the right is gone once the user clicks elsewhere. Windows only; no-op elsewhere."""
    if sys.platform != "win32":
        return
    try:
        import ctypes

        ctypes.windll.user32.AllowSetForegroundWindow(-1)  # ASFW_ANY
    except (OSError, AttributeError):
        pass


def close_browser(proc: subprocess.Popen) -> None:
    """Closes the browser main() opened, when the start failed after the launch. On Windows the
    Popen handle is usually only a launcher that has already exited (see _process_tree()), so the
    processes it started are closed too. The launcher goes first, so it cannot start the browser
    after the snapshot of its children was taken."""
    if proc.poll() is None:
        proc.terminate()
    if sys.platform == "win32":
        import ctypes

        kernel32 = ctypes.windll.kernel32
        for pid in _process_tree(proc.pid) - {proc.pid}:
            handle = kernel32.OpenProcess(0x0001, False, pid)  # PROCESS_TERMINATE
            if handle:
                kernel32.TerminateProcess(handle, 1)
                kernel32.CloseHandle(handle)


def _wait_for_ping(ready_port: int, timeout: float) -> None:
    """Blocks until something connects to ready_port, or `timeout` elapses. A plain socket listener,
    not an HTTP server: the page's `no-cors` fetch() just needs the TCP handshake to succeed, never
    reads the response."""
    import socket

    srv: socket.socket | None = None
    try:
        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind(("127.0.0.1", ready_port))
        srv.listen(1)
        srv.settimeout(timeout)
        conn, _ = srv.accept()
        conn.close()
    except OSError:
        pass
    finally:
        if srv:
            srv.close()


def main() -> None:
    allow_foreground_handoff()
    fix_frozen_streams()
    import argparse

    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--dev", action="store_true")
    parser.add_argument("--help", "-h", action="store_true")
    args, _ = parser.parse_known_args()
    if args.help:
        print("Sight — double-click this file. Optional: --port N --no-browser --dev")
        return
    # Developer mode (also SIGHT_DEV=1, or Sight-dev.bat) unlocks "Save as app defaults", which
    # rewrites app/static/defaults.json. A packaged build never honours it.
    dev = (args.dev or os.environ.get("SIGHT_DEV") == "1") and not getattr(sys, "frozen", False)

    splash: LazySplash | None = None
    # The server once built (its `started` turns True when it serves) and the browser process this
    # launch opened, so a failed start can close a window that would otherwise wait off-screen.
    launched: dict[str, object] = {}
    # Guards the browser launch against main()'s exit: once main() has given up ("failed"), the
    # launcher thread must not start a browser any more.
    launch_lock = threading.Lock()
    try:
        bootstrap()
        # After bootstrap(), not before: a source/dev run without its deps yet re-execs itself into
        # a private venv (os.execv, which on Windows spawns a whole new process rather than replacing
        # this one), so main() — and anything started earlier in it — would otherwise run twice. A
        # packaged build's bootstrap() returns immediately, so this costs it nothing. The splash
        # closes itself once _open() below is done opening the window — the try/finally here is
        # only the fallback for "something went wrong before that ever happened".
        if not args.no_browser and sys.platform == "win32":
            splash = LazySplash()
        if str(ROOT) not in sys.path:
            sys.path.insert(0, str(ROOT))

        home = data_dir()
        from app.settings import SettingsStore  # stdlib only, cheap

        settings = SettingsStore(home)
        # Listen before the server is even imported (~0.3 s of starlette/uvicorn imports and library
        # setup), so the browser window can start in parallel with all of that.
        sock = listen_socket(args.port or int(os.environ.get("SIGHT_PORT") or 0))
        port = sock.getsockname()[1]
        url = f"http://127.0.0.1:{port}/"
        log(f"opening {url}")
        frozen = getattr(sys, "frozen", False)
        log("closing the Sight tab will quit" if frozen else "close this window to quit")

        def _wait_serving(timeout: float = 20.0) -> None:
            deadline = time.time() + timeout
            while time.time() < deadline and not getattr(launched.get("server"), "started", False):
                time.sleep(0.02)

        def _close_splash() -> None:
            if splash:
                splash.close()

        def _open() -> None:
            # Whichever branch below actually opens the window, the splash always gets closed right
            # after — a single guaranteed spot, so it can never linger on screen because some branch
            # forgot to close it.
            try:
                browser = find_app_browser()
                # The page pings this once it actually has content on screen (see __signalReady()
                # in index.html) — that's what tells reveal_when_ready() below the window may be
                # maximized/focused (index.html's own moveIntoView() has, by then, already moved it
                # into view itself). Windows-only, same as the off-screen-launch mechanism itself.
                ready_port = free_port(47990) if sys.platform == "win32" else None
                query = "?app=1" + (f"&ready={ready_port}" if ready_port else "")
                if browser:
                    launch_extra: list[str] = []
                    maximized = False
                    if sys.platform == "win32":
                        # Launch off-screen (not hidden — see reveal_when_ready() for why) at its
                        # final size, so index.html's moveIntoView() only has to move it into place,
                        # never resize it. window-position deliberately does NOT go here: the real,
                        # saved/centered position is applied from inside the page itself, once ready.
                        win = settings.window()
                        w, h = (win["w"], win["h"]) if win else (1280, 860)
                        maximized = bool(win.get("max")) if win else False
                        off_x, off_y = _offscreen_point()
                        launch_extra = [
                            f"--window-size={w},{h}",
                            f"--window-position={off_x},{off_y}",
                            "--disable-features=CalculateNativeWinOcclusion",
                            "--disable-backgrounding-occluded-windows",
                            "--disable-renderer-backgrounding",
                            # A minimized window is "hidden" to Chromium, which would otherwise
                            # throttle the heartbeat timer to once a minute and let the watchdog quit.
                            "--disable-background-timer-throttling",
                        ]
                    try:
                        # Sight gets its own browser profile, hence its own browser process. With the
                        # user's regular profile a running Edge/Chrome would take over the launch and
                        # drop --window-position/--window-size, so the window opened in the default
                        # spot and jumped to the saved one after the page had loaded.
                        # ?app=1 tells the page it lives in its own window, so it may track and
                        # restore that window's geometry (a plain browser tab must not).
                        # Started before the server is up on purpose (see listen_socket()); on
                        # Windows the window stays off-screen until the page has content anyway.
                        with launch_lock:
                            if launched.get("failed"):
                                return
                            proc = subprocess.Popen([
                                *browser,
                                f"--user-data-dir={home / 'browser'}",
                                "--no-first-run",
                                "--no-default-browser-check",
                                *launch_extra,
                                f"--app={url}{query}",
                            ])
                            launched["browser"] = proc
                        if sys.platform == "win32" and ready_port:
                            reveal_when_ready(proc, ready_port, maximized, on_ready=_close_splash)
                        return
                    except OSError:
                        pass
                # A tab in the user's own browser opens on screen right away and cannot be closed
                # again if the start fails, so it waits until the server serves.
                _wait_serving()
                if sys.platform == "win32":
                    try:
                        os.startfile(url)  # type: ignore[attr-defined]
                        return
                    except OSError:
                        pass
                webbrowser.open(url)
            finally:
                _close_splash()

        if not args.no_browser:
            threading.Thread(target=_open, daemon=True).start()

        import uvicorn

        from app.library import Library
        from app.server import build_app

        lib = Library(home)  # looks for ffmpeg in the background; lib.ffmpeg_exe() waits for it

        def _log_ffmpeg() -> None:
            exe = lib.ffmpeg_exe()
            log(f"ffmpeg · {exe}" if exe else "ffmpeg not found — video stills wait until a clip is on screen")

        threading.Thread(target=_log_ffmpeg, daemon=True).start()
        lib.resume_watchers()
        app = build_app(lib, settings, dev)
        if dev:
            log("developer mode - 'Save as app defaults' rewrites app/static/defaults.json")

        config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
        server = uvicorn.Server(config)
        launched["server"] = server

        if frozen and not args.no_browser:
            # No console window to close, so treat "no tab pinging /api/heartbeat for a while" as
            # the signal to quit (see startHeartbeat() in index.html). STARTUP_GRACE covers the
            # time between the server coming up and the browser actually opening the page.
            HEARTBEAT_TIMEOUT = 10.0
            STARTUP_GRACE = 30.0
            app.state.last_heartbeat = time.time() + (STARTUP_GRACE - HEARTBEAT_TIMEOUT)

            # A tick that took far longer than its 1 s sleep means the machine was suspended (sleep /
            # hibernate): every thread was frozen, so the stale heartbeat says nothing about the tab.
            # Without this the watchdog woke first after resume and quit under a perfectly live window.
            RESUME_GAP = 5.0

            def _watch_tab() -> None:
                last_tick = time.time()
                while not server.should_exit:
                    time.sleep(1)
                    now = time.time()
                    if now - last_tick > RESUME_GAP:
                        app.state.last_heartbeat = now + (STARTUP_GRACE - HEARTBEAT_TIMEOUT)
                    last_tick = now
                    if now - app.state.last_heartbeat > HEARTBEAT_TIMEOUT:
                        server.should_exit = True
                        return

            threading.Thread(target=_watch_tab, daemon=True).start()

        try:
            server.run(sockets=[sock])
        finally:
            lib.close()
    finally:
        # A browser window opened for a server that never started would wait off-screen for good,
        # so close it, and stop the launcher thread from opening one after this point.
        if not getattr(launched.get("server"), "started", False):
            with launch_lock:
                launched["failed"] = True
                browser_proc = launched.get("browser")
                if isinstance(browser_proc, subprocess.Popen):
                    close_browser(browser_proc)
        # Normally _open()'s own finally has already closed the splash — this only catches
        # "something went wrong before _open() ever ran" (failed bootstrap, an exception above), so
        # it doesn't sit on screen for its full timeout.
        if splash:
            splash.close()


if __name__ == "__main__":
    # The thumbnail process pool (Library._heavy) spawns children; in a frozen build each child is
    # this exe started again with multiprocessing's arguments, which freeze_support() runs and exits.
    import multiprocessing

    multiprocessing.freeze_support()
    try:
        main()
    except Exception as exc:
        fatal(f"Sight failed to start:\n{exc}")
        raise
