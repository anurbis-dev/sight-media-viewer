"""Windows launch splash: a tiny out-of-process native window that appears within milliseconds.

Why a separate process: PowerShell needs ~0.7 s of CPU just to start, so the old splash could never
be instant, and an in-process ctypes window would put a bad window procedure inside the app itself.
This module is stdlib-only and has two halves:

* launcher side (any OS, no side effects on import): `launch()` starts the splash process once per
  launch, `close()` tells it to go away. Called from Sight.py's main().
* splash side (Windows only): `run()` / `python splash_win.py IMAGE EVENT [MAXWAIT]` - a borderless,
  topmost, click-through, no-taskbar layered window showing a PNG, centred on the monitor under the
  cursor, drawn once with GDI+. It exits when the named event is signalled, after MAXWAIT seconds,
  or on any error (silently - the splash must never get in the app's way).

Closing is by a named manual-reset event (name in env SIGHT_SPLASH). Both sides CreateEventW the same
name, so whoever comes first creates it and a SetEvent that arrives before the splash has even started
is still seen (the closer keeps its handle open on purpose, so the signalled event outlives it). The
name also survives bootstrap()'s os.execv re-exec through the environment: the second main() sees the
variable, starts nothing and closes the same splash.
"""

from __future__ import annotations

import sys  # nothing else at module level: the splash process starts with `python -I -S` and must stay light

ENV_VAR = "SIGHT_SPLASH"  # name of the close event; set means "a splash was started in this launch"
MAX_WAIT = 45  # seconds: safety net if nobody ever closes it
LOGICAL_SIZE = 256  # window size at 96 dpi; splash.png is 512 px so 200 % scaling stays sharp


# ---------------------------------------------------------------- launcher side (any OS)

def splash_command(frozen: bool, executable: str, script, image, event: str,
                   max_wait: int = MAX_WAIT) -> list[str]:
    """argv that starts the splash process. Frozen onedir build: the exe itself with `--splash`
    (handled at the very top of Sight.py, before any heavy import). Source run: the interpreter
    (pythonw if next to it) in isolated, no-site mode - stdlib is all it needs - on this file."""
    from pathlib import Path

    if frozen:
        return [executable, "--splash", str(image), event, str(max_wait)]
    exe = Path(executable)
    pythonw = exe.with_name("pythonw.exe")
    if pythonw.exists():
        exe = pythonw
    return [str(exe), "-I", "-S", str(script), str(image), event, str(max_wait)]


def open_event(name: str):
    """Creates (or opens) the named close event and returns its handle, None when unavailable."""
    if sys.platform != "win32":
        return None
    try:
        import ctypes
        from ctypes import c_void_p, wintypes

        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.CreateEventW.argtypes = [c_void_p, wintypes.BOOL, wintypes.BOOL, wintypes.LPCWSTR]
        k32.CreateEventW.restype = c_void_p
        return k32.CreateEventW(None, True, False, name) or None
    except Exception:
        return None


def _kernel32_call(fn: str, handle) -> None:
    if not handle or sys.platform != "win32":
        return
    try:
        import ctypes
        from ctypes import c_void_p, wintypes

        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        func = getattr(k32, fn)
        func.argtypes = [c_void_p]
        func.restype = wintypes.BOOL
        func(handle)
    except Exception:
        pass


def signal(handle) -> None:
    """Tells the splash to exit (SetEvent). Safe to repeat or with None."""
    _kernel32_call("SetEvent", handle)


def release(handle) -> None:
    """CloseHandle on a handle from open_event(); call once, after signal()."""
    _kernel32_call("CloseHandle", handle)


def launch(bundle_root, frozen: bool | None = None, environ=None, popen=None):
    """Starts the splash unless this launch already has one (re-exec). Returns (event name, event
    handle); (None, None) when nothing is running (not Windows, files missing, start failed). The
    caller holds the handle until it is done, so a close can never race the splash's own CreateEvent
    (the re-exec'd process opens the same named event again). Never raises."""
    try:
        import os

        environ = os.environ if environ is None else environ
        if sys.platform != "win32":
            return None, None
        existing = environ.get(ENV_VAR)
        if existing:
            return existing, open_event(existing)
        import subprocess

        image = bundle_root / "app" / "splash.png"
        script = bundle_root / "app" / "splash_win.py"
        frozen = bool(getattr(sys, "frozen", False)) if frozen is None else frozen
        if not image.exists() or (not frozen and not script.exists()):
            return None, None
        event = f"Local\\SightSplash-{os.getpid()}"
        handle = open_event(event)  # before the start, so the splash finds it
        try:
            (popen or subprocess.Popen)(
                splash_command(frozen, sys.executable, script, image, event),
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                close_fds=True,
            )
        except Exception:
            release(handle)
            return None, None
        environ[ENV_VAR] = event
        return event, handle
    except Exception:
        return None, None


# ---------------------------------------------------------------- splash side (Windows only)

def run(argv: list[str]) -> None:
    """Entry for the splash process: argv = [image, event, max_wait?]. Never raises."""
    try:
        image, event = argv[0], argv[1]
        max_wait = float(argv[2]) if len(argv) > 2 else MAX_WAIT
        if sys.platform == "win32":
            _show(image, event, max_wait)
    except BaseException:
        pass


def _show(image: str, event: str, max_wait: float) -> None:
    import ctypes
    import time
    from ctypes import POINTER, WINFUNCTYPE, Structure, byref, c_int, c_long, c_size_t, c_ssize_t, c_ubyte
    from ctypes import c_uint, c_ushort, c_void_p, sizeof, wintypes

    deadline = time.monotonic() + max_wait
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    u32 = ctypes.WinDLL("user32", use_last_error=True)
    g32 = ctypes.WinDLL("gdi32", use_last_error=True)
    gp = ctypes.WinDLL("gdiplus", use_last_error=True)

    class POINT(Structure):
        _fields_ = [("x", c_long), ("y", c_long)]

    class SIZE(Structure):
        _fields_ = [("cx", c_long), ("cy", c_long)]

    class RECT(Structure):
        _fields_ = [("left", c_long), ("top", c_long), ("right", c_long), ("bottom", c_long)]

    class MONITORINFO(Structure):
        _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", RECT), ("rcWork", RECT), ("dwFlags", wintypes.DWORD)]

    class MSG(Structure):
        _fields_ = [("hwnd", c_void_p), ("message", c_uint), ("wParam", c_size_t), ("lParam", c_ssize_t),
                    ("time", wintypes.DWORD), ("pt", POINT)]

    class BLENDFUNCTION(Structure):
        _fields_ = [("BlendOp", c_ubyte), ("BlendFlags", c_ubyte), ("SourceConstantAlpha", c_ubyte),
                    ("AlphaFormat", c_ubyte)]

    class BITMAPINFOHEADER(Structure):
        _fields_ = [("biSize", wintypes.DWORD), ("biWidth", c_long), ("biHeight", c_long), ("biPlanes", c_ushort),
                    ("biBitCount", c_ushort), ("biCompression", wintypes.DWORD), ("biSizeImage", wintypes.DWORD),
                    ("biXPelsPerMeter", c_long), ("biYPelsPerMeter", c_long), ("biClrUsed", wintypes.DWORD),
                    ("biClrImportant", wintypes.DWORD)]

    class GdiplusStartupInput(Structure):
        _fields_ = [("GdiplusVersion", c_uint), ("DebugEventCallback", c_void_p),
                    ("SuppressBackgroundThread", wintypes.BOOL), ("SuppressExternalCodecs", wintypes.BOOL)]

    # LRESULT / WPARAM / LPARAM are pointer-sized: c_ssize_t / c_size_t / c_ssize_t (64-bit safe).
    WNDPROC = WINFUNCTYPE(c_ssize_t, c_void_p, c_uint, c_size_t, c_ssize_t)

    class WNDCLASSEXW(Structure):
        _fields_ = [("cbSize", c_uint), ("style", c_uint), ("lpfnWndProc", WNDPROC), ("cbClsExtra", c_int),
                    ("cbWndExtra", c_int), ("hInstance", c_void_p), ("hIcon", c_void_p), ("hCursor", c_void_p),
                    ("hbrBackground", c_void_p), ("lpszMenuName", wintypes.LPCWSTR),
                    ("lpszClassName", wintypes.LPCWSTR), ("hIconSm", c_void_p)]

    def sig(fn, restype, *argtypes):
        fn.restype = restype
        fn.argtypes = list(argtypes)

    sig(k32.GetModuleHandleW, c_void_p, wintypes.LPCWSTR)
    sig(k32.CreateEventW, c_void_p, c_void_p, wintypes.BOOL, wintypes.BOOL, wintypes.LPCWSTR)
    sig(k32.WaitForSingleObject, wintypes.DWORD, c_void_p, wintypes.DWORD)
    sig(u32.DefWindowProcW, c_ssize_t, c_void_p, c_uint, c_size_t, c_ssize_t)
    sig(u32.RegisterClassExW, c_ushort, POINTER(WNDCLASSEXW))
    sig(u32.CreateWindowExW, c_void_p, wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD,
        c_int, c_int, c_int, c_int, c_void_p, c_void_p, c_void_p, c_void_p)
    sig(u32.ShowWindow, wintypes.BOOL, c_void_p, c_int)
    sig(u32.DestroyWindow, wintypes.BOOL, c_void_p)
    sig(u32.PostQuitMessage, None, c_int)
    sig(u32.GetDC, c_void_p, c_void_p)
    sig(u32.ReleaseDC, c_int, c_void_p, c_void_p)
    sig(u32.GetCursorPos, wintypes.BOOL, POINTER(POINT))
    sig(u32.MonitorFromPoint, c_void_p, POINT, wintypes.DWORD)  # POINT by value
    sig(u32.GetMonitorInfoW, wintypes.BOOL, c_void_p, POINTER(MONITORINFO))
    sig(u32.UpdateLayeredWindow, wintypes.BOOL, c_void_p, c_void_p, POINTER(POINT), POINTER(SIZE), c_void_p,
        POINTER(POINT), wintypes.DWORD, POINTER(BLENDFUNCTION), wintypes.DWORD)
    sig(u32.MsgWaitForMultipleObjects, wintypes.DWORD, wintypes.DWORD, POINTER(c_void_p), wintypes.BOOL,
        wintypes.DWORD, wintypes.DWORD)
    sig(u32.PeekMessageW, wintypes.BOOL, POINTER(MSG), c_void_p, c_uint, c_uint, c_uint)
    sig(u32.TranslateMessage, wintypes.BOOL, POINTER(MSG))
    sig(u32.DispatchMessageW, c_ssize_t, POINTER(MSG))
    sig(g32.CreateCompatibleDC, c_void_p, c_void_p)
    sig(g32.CreateDIBSection, c_void_p, c_void_p, POINTER(BITMAPINFOHEADER), c_uint, POINTER(c_void_p),
        c_void_p, wintypes.DWORD)
    sig(g32.SelectObject, c_void_p, c_void_p, c_void_p)
    sig(gp.GdiplusStartup, c_int, POINTER(c_size_t), POINTER(GdiplusStartupInput), c_void_p)
    sig(gp.GdiplusShutdown, None, c_size_t)
    sig(gp.GdipCreateBitmapFromFile, c_int, wintypes.LPCWSTR, POINTER(c_void_p))
    sig(gp.GdipCreateBitmapFromScan0, c_int, c_int, c_int, c_int, c_int, c_void_p, POINTER(c_void_p))
    sig(gp.GdipGetImageGraphicsContext, c_int, c_void_p, POINTER(c_void_p))
    sig(gp.GdipSetInterpolationMode, c_int, c_void_p, c_int)
    sig(gp.GdipSetPixelOffsetMode, c_int, c_void_p, c_int)
    sig(gp.GdipGetImageWidth, c_int, c_void_p, POINTER(c_uint))
    sig(gp.GdipGetImageHeight, c_int, c_void_p, POINTER(c_uint))
    sig(gp.GdipCreateImageAttributes, c_int, POINTER(c_void_p))
    sig(gp.GdipSetImageAttributesWrapMode, c_int, c_void_p, c_int, c_uint, wintypes.BOOL)
    sig(gp.GdipDisposeImageAttributes, c_int, c_void_p)
    sig(gp.GdipDrawImageRectRectI, c_int, c_void_p, c_void_p, c_int, c_int, c_int, c_int, c_int, c_int, c_int,
        c_int, c_int, c_void_p, c_void_p, c_void_p)  # g img dx dy dw dh sx sy sw sh unit attrs cb data
    sig(gp.GdipDeleteGraphics, c_int, c_void_p)
    sig(gp.GdipDisposeImage, c_int, c_void_p)

    # DPI awareness first, so every coordinate below is physical pixels. Best effort, newest API first.
    try:
        sig(u32.SetProcessDpiAwarenessContext, wintypes.BOOL, c_void_p)
        if not u32.SetProcessDpiAwarenessContext(c_void_p(-4)):  # PER_MONITOR_AWARE_V2
            u32.SetProcessDPIAware()
    except (AttributeError, OSError):
        try:
            u32.SetProcessDPIAware()
        except (AttributeError, OSError):
            pass

    # The close event first: if the app already signalled it, there is nothing to show.
    close_ev = k32.CreateEventW(None, True, False, event)
    if not close_ev or k32.WaitForSingleObject(close_ev, 0) == 0:  # 0 = already signalled
        return

    # Monitor under the cursor, its DPI scale and the centred rectangle.
    pt = POINT()
    u32.GetCursorPos(byref(pt))
    hmon = u32.MonitorFromPoint(pt, 2)  # MONITOR_DEFAULTTONEAREST
    mi = MONITORINFO()
    mi.cbSize = sizeof(MONITORINFO)
    if not hmon or not u32.GetMonitorInfoW(hmon, byref(mi)):
        return
    dpi = 96
    try:
        shcore = ctypes.WinDLL("shcore")
        sig(shcore.GetDpiForMonitor, c_long, c_void_p, c_int, POINTER(c_uint), POINTER(c_uint))
        dx, dy = c_uint(0), c_uint(0)
        if shcore.GetDpiForMonitor(hmon, 0, byref(dx), byref(dy)) == 0 and dx.value:
            dpi = dx.value
    except (AttributeError, OSError):
        pass
    side = max(64, round(LOGICAL_SIZE * dpi / 96))
    mw, mh = mi.rcMonitor.right - mi.rcMonitor.left, mi.rcMonitor.bottom - mi.rcMonitor.top
    x = mi.rcMonitor.left + (mw - side) // 2
    y = mi.rcMonitor.top + (mh - side) // 2

    # GDI+ draws the PNG straight into a 32-bit top-down DIB section wrapped as a premultiplied-ARGB
    # bitmap (format 0xE200B), which is exactly what UpdateLayeredWindow(ULW_ALPHA) wants.
    token = c_size_t(0)
    start = GdiplusStartupInput(1, None, False, False)
    if gp.GdiplusStartup(byref(token), byref(start), None) != 0:
        return
    try:
        screen_dc = u32.GetDC(None)
        mem_dc = g32.CreateCompatibleDC(screen_dc)
        bmi = BITMAPINFOHEADER(sizeof(BITMAPINFOHEADER), side, -side, 1, 32, 0, 0, 0, 0, 0, 0)
        bits = c_void_p()
        dib = g32.CreateDIBSection(mem_dc, byref(bmi), 0, byref(bits), None, 0)
        if not (screen_dc and mem_dc and dib and bits.value):
            return
        g32.SelectObject(mem_dc, dib)

        src, target, graphics = c_void_p(), c_void_p(), c_void_p()
        if gp.GdipCreateBitmapFromFile(image, byref(src)) != 0:
            return
        if gp.GdipCreateBitmapFromScan0(side, side, side * 4, 0xE200B, bits, byref(target)) != 0:
            return
        if gp.GdipGetImageGraphicsContext(target, byref(graphics)) != 0:
            return
        gp.GdipSetInterpolationMode(graphics, 7)  # HighQualityBicubic
        gp.GdipSetPixelOffsetMode(graphics, 4)  # HighQuality (half-pixel offset: no edge shift)
        # Tile-flip wrap mode: the default clamps against transparent black and leaves a 1 px fringe.
        attrs, iw, ih = c_void_p(), c_uint(0), c_uint(0)
        gp.GdipGetImageWidth(src, byref(iw))
        gp.GdipGetImageHeight(src, byref(ih))
        if gp.GdipCreateImageAttributes(byref(attrs)) == 0:
            gp.GdipSetImageAttributesWrapMode(attrs, 3, 0, False)  # WrapModeTileFlipXY
        gp.GdipDrawImageRectRectI(graphics, src, 0, 0, side, side, 0, 0, iw.value, ih.value,
                                  2, attrs, None, None)  # UnitPixel
        if attrs:
            gp.GdipDisposeImageAttributes(attrs)
        gp.GdipDeleteGraphics(graphics)
        gp.GdipDisposeImage(target)
        gp.GdipDisposeImage(src)

        # The window procedure does nothing but quit on destroy; the callback object is kept alive
        # in `wndproc` for the whole message loop (a collected callback would crash the process).
        def _wndproc(hwnd, msg, wparam, lparam):
            if msg == 0x0002:  # WM_DESTROY
                u32.PostQuitMessage(0)
                return 0
            return u32.DefWindowProcW(hwnd, msg, wparam, lparam)

        wndproc = WNDPROC(_wndproc)
        cls = WNDCLASSEXW()
        cls.cbSize = sizeof(WNDCLASSEXW)
        cls.lpfnWndProc = wndproc
        cls.hInstance = k32.GetModuleHandleW(None)
        cls.lpszClassName = "SightSplash"
        if not u32.RegisterClassExW(byref(cls)):
            return
        WS_POPUP = 0x80000000
        ex = 0x80000 | 0x8 | 0x80 | 0x8000000 | 0x20  # LAYERED TOPMOST TOOLWINDOW NOACTIVATE TRANSPARENT
        hwnd = u32.CreateWindowExW(ex, "SightSplash", "Sight", WS_POPUP, x, y, side, side,
                                   None, None, cls.hInstance, None)
        if not hwnd:
            return
        dst, size, origin = POINT(x, y), SIZE(side, side), POINT(0, 0)
        blend = BLENDFUNCTION(0, 0, 255, 1)  # AC_SRC_OVER, 255, AC_SRC_ALPHA
        if not u32.UpdateLayeredWindow(hwnd, screen_dc, byref(dst), byref(size), mem_dc, byref(origin),
                                       0, byref(blend), 2):  # ULW_ALPHA
            u32.DestroyWindow(hwnd)
            return
        u32.ShowWindow(hwnd, 4)  # SW_SHOWNOACTIVATE

        handles = (c_void_p * 1)(close_ev)
        msg = MSG()
        while True:
            remaining = int((deadline - time.monotonic()) * 1000)
            if remaining <= 0:
                break
            r = u32.MsgWaitForMultipleObjects(1, handles, False, remaining, 0x04FF)  # QS_ALLINPUT
            if r != 1:  # 0 = event signalled, 0x102 = timeout, 0xFFFFFFFF = failed
                break
            quit_now = False
            while u32.PeekMessageW(byref(msg), None, 0, 0, 1):  # PM_REMOVE
                if msg.message == 0x0012:  # WM_QUIT
                    quit_now = True
                    break
                u32.TranslateMessage(byref(msg))
                u32.DispatchMessageW(byref(msg))
            if quit_now:
                break
        u32.DestroyWindow(hwnd)
    finally:
        gp.GdiplusShutdown(token)


if __name__ == "__main__":
    run(sys.argv[1:])
