"""macOS only: a real Cocoa event loop for the packaged Sight.app.

Sight.app is a regular Dock app, but its window is a separate browser instance (Chromium --app,
started through `open -n -a`, see Sight.py's mac_launch_prefix). Without an event loop the app never
answers the Apple Events macOS sends it (a Dock click to bring a minimized window back, Dock "Quit",
the quit sent at logout / shutdown), so macOS flagged it "not responding". run() puts NSApplication
on the main thread, moves the server to a background thread and answers those events:

- Dock click (reopen) / Cmd+Tab to Sight: the browser window comes to the front; a minimized one is
  restored; a closed one is opened again.
- Quit (Dock menu, Cmd+Q, logout): the server stops cleanly, then the app exits.

pyobjc (pyobjc-framework-Cocoa) is imported lazily: without it run() returns False and Sight.py keeps
the old behaviour (server on the main thread). Nothing here runs on other platforms.
"""
from __future__ import annotations

import subprocess
import threading
from typing import Callable

QUIT_TIMEOUT = 10.0  # s: a server that will not stop must not hold up logout


def browser_pid_from_ps(ps_output: str, user_data_dir: str) -> int | None:
    """The main process of Sight's own browser in `ps -axww -o pid=,command=` output: the one whose
    command line carries Sight's --user-data-dir and no --type= (helpers / renderers have one). The
    `open` that launched it (same arguments) is skipped too."""
    token = f"--user-data-dir={user_data_dir}"
    for line in ps_output.splitlines():
        pid_s, _, cmd = line.strip().partition(" ")
        if not pid_s.isdigit():
            continue
        cmd = cmd.strip()
        if cmd.startswith("/usr/bin/open ") or " --type=" in cmd:
            continue
        # The path may hold spaces, so match the whole flag followed by a space or the line end.
        if cmd.endswith(token) or (token + " ") in cmd:
            return int(pid_s)
    return None


def find_browser_pid(user_data_dir: str) -> int | None:
    try:
        out = subprocess.run(["/bin/ps", "-axww", "-o", "pid=,command="],
                             capture_output=True, text=True, timeout=3).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    return browser_pid_from_ps(out, user_data_dir)


def _fourcc(code: str) -> int:
    return int.from_bytes(code.encode("ascii"), "big")


def run(
    serve: Callable[[], None],
    *,
    user_data_dir: str,
    window_alive: Callable[[], bool],
    relaunch: Callable[[], None],
    request_stop: Callable[[], None],
    on_server_exit: Callable[[BaseException | None, bool], None],
    log: Callable[[str], None],
) -> bool:
    """Runs `serve` on a background thread and the Cocoa event loop on this (main) thread. Returns
    False at once when pyobjc is missing; otherwise it does not return: the app exits from AppKit
    once the server has stopped. `on_server_exit(exc, quit_requested)` runs on the main thread after
    `serve` returns or raises, before the exit — the place for cleanup, since AppKit's exit skips
    the caller's `finally` blocks. `request_stop` asks the server to stop (Quit); `window_alive` says
    whether a Sight window is open (its heartbeat is fresh); `relaunch` opens the window again."""
    try:
        import objc
        from AppKit import (
            NSApplication,
            NSApplicationActivateAllWindows,
            NSApplicationActivateIgnoringOtherApps,
            NSMenu,
            NSMenuItem,
            NSRunningApplication,
        )
        from Foundation import NSAppleEventDescriptor, NSObject
        from PyObjCTools import AppHelper
    except Exception as exc:
        log(f"macOS: no Cocoa event loop (pyobjc not available: {exc}) - the Dock icon may show 'not responding'")
        return False

    NS_TERMINATE_NOW, NS_TERMINATE_LATER = 1, 2
    state = {"done": False, "terminating": False, "replied": False, "exited": False, "exc": None}
    app = NSApplication.sharedApplication()

    def front(reopen: bool) -> None:
        if state["terminating"]:
            return
        if not window_alive():
            # The window was closed (a windowless browser may still run: Chromium on macOS does not
            # quit with its last window, and reopening that would give a blank new-tab window).
            if reopen:
                log("macOS: Dock reopen - no live Sight window, opening it again")
                relaunch()
            return
        pid = find_browser_pid(user_data_dir)
        target = NSRunningApplication.runningApplicationWithProcessIdentifier_(pid) if pid else None
        if target is None:
            return  # a live window not in Sight's own browser (a tab in the user's browser)
        target.unhide()
        # macOS 14+: cooperative activation - Sight is active right now (the user clicked it), so it
        # yields to the browser; the IgnoringOtherApps flag is what older systems need.
        if app.respondsToSelector_("yieldActivationToApplication:"):
            app.yieldActivationToApplication_(target)
        ok = target.activateWithOptions_(NSApplicationActivateAllWindows | NSApplicationActivateIgnoringOtherApps)
        if not reopen:
            return
        # Activation does not bring back a minimized window; the browser's own reopen handling does
        # (a Dock click on its icon). Sent to that one process, so the user's own Chrome is untouched.
        sent = False
        try:
            desc = NSAppleEventDescriptor.descriptorWithProcessIdentifier_(pid)
            event = NSAppleEventDescriptor.appleEventWithEventClass_eventID_targetDescriptor_returnID_transactionID_(
                _fourcc("aevt"), _fourcc("rapp"), desc, -1, 0)  # kAutoGenerateReturnID, kAnyTransactionID
            _reply, err = event.sendEventWithOptions_timeout_error_(1, 2.0, None)  # kAENoReply
            sent = err is None
            if err is not None:
                log(f"macOS: reopen event to the browser failed: {err}")
        except Exception as exc:
            log(f"macOS: reopen event to the browser failed: {exc}")
        log(f"macOS: Dock reopen - browser pid {pid} activated={bool(ok)} reopen_sent={sent}")

    def reply_and_exit() -> None:
        if state["replied"]:
            return
        state["replied"] = True
        if state["terminating"]:
            app.replyToApplicationShouldTerminate_(True)
        else:
            app.terminate_(None)

    def exit_work(exc: BaseException | None) -> None:
        if state["exited"]:
            return
        state["exited"] = True
        try:
            on_server_exit(exc, state["terminating"])
        except Exception as err:
            log(f"macOS: cleanup failed: {err}")

    def server_done() -> None:
        state["done"] = True
        exit_work(state["exc"])
        reply_and_exit()

    def force_quit() -> None:
        if not state["done"] and not state["replied"]:
            log(f"macOS: server did not stop within {QUIT_TIMEOUT:.0f} s - quitting anyway")
            exit_work(None)  # best effort: the window and main()'s cleanup, not lib.close()
            reply_and_exit()

    class SightAppDelegate(NSObject):
        @objc.typedSelector(b"Z@:@Z")
        def applicationShouldHandleReopen_hasVisibleWindows_(self, _app, _visible):
            try:
                front(reopen=True)
            except Exception as exc:
                log(f"macOS: Dock reopen failed: {exc}")
            return False

        def applicationDidBecomeActive_(self, _note):
            # Cmd+Tab (or a Dock click) to Sight, which has no window of its own: hand the focus on.
            try:
                front(reopen=False)
            except Exception as exc:
                log(f"macOS: activation hand-off failed: {exc}")

        @objc.typedSelector(b"Q@:@")
        def applicationShouldTerminate_(self, _app):
            if state["done"]:
                return NS_TERMINATE_NOW
            if not state["terminating"]:
                state["terminating"] = True
                log("macOS: quit requested - stopping the server")
                try:
                    request_stop()
                except Exception as exc:
                    log(f"macOS: stopping the server failed: {exc}")
                # Not AppHelper.callLater: a delayed perform runs only in the default run-loop mode,
                # and while a "terminate later" reply is pending AppKit runs the modal-panel mode.
                # callAfter (performSelectorOnMainThread) runs in common modes.
                timer = threading.Timer(QUIT_TIMEOUT, lambda: AppHelper.callAfter(force_quit))
                timer.daemon = True
                timer.start()
            return NS_TERMINATE_LATER

    def serve_thread() -> None:
        try:
            serve()
        except BaseException as exc:  # reported by on_server_exit on the main thread
            state["exc"] = exc
        finally:
            AppHelper.callAfter(server_done)

    delegate = SightAppDelegate.alloc().init()
    app.setDelegate_(delegate)
    # A minimal menu bar, so Cmd+Q / "Quit Sight" work while Sight itself is the active app.
    menubar = NSMenu.alloc().init()
    app_item = NSMenuItem.alloc().init()
    menubar.addItem_(app_item)
    app_menu = NSMenu.alloc().init()
    app_menu.addItemWithTitle_action_keyEquivalent_("Quit Sight", "terminate:", "q")
    app_item.setSubmenu_(app_menu)
    app.setMainMenu_(menubar)

    threading.Thread(target=serve_thread, name="sight-server", daemon=True).start()
    log("macOS: Cocoa event loop running (server on a background thread)")
    AppHelper.runEventLoop(installInterrupt=False)
    return True
