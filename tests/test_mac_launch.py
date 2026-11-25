"""mac_launch_prefix: on macOS the browser is started through `open` (TCC responsibility, see Sight.py)."""
import importlib.util
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("sight_launcher", ROOT / "Sight.py")
sight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sight)


class MacLaunchPrefix(unittest.TestCase):
    CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

    def test_darwin_uses_open(self):
        with mock.patch.object(sight.sys, "platform", "darwin"):
            self.assertEqual(sight.mac_launch_prefix([self.CHROME]),
                             ["/usr/bin/open", "-n", "-a", "/Applications/Google Chrome.app", "--args"])

    def test_darwin_non_bundle_unchanged(self):
        with mock.patch.object(sight.sys, "platform", "darwin"):
            self.assertEqual(sight.mac_launch_prefix(["/usr/local/bin/chromium"]), ["/usr/local/bin/chromium"])

    def test_other_platforms_unchanged(self):
        for plat in ("win32", "linux"):
            with mock.patch.object(sight.sys, "platform", plat):
                self.assertEqual(sight.mac_launch_prefix([self.CHROME]), [self.CHROME])


sys.path.insert(0, str(ROOT))
from app import macapp  # noqa: E402


class MacAppBrowserPid(unittest.TestCase):
    """app/macapp.py finds Sight's own browser (not the user's Chrome, not its helpers) for Dock reopen."""
    UDD = "/Users/me/Library/Application Support/Sight/browser"
    CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

    def ps(self, *rows):
        return "\n".join(f"  {pid} {cmd}" for pid, cmd in rows) + "\n"

    def test_main_process_found(self):
        out = self.ps(
            (101, self.CHROME),  # the user's own Chrome
            (202, f"/usr/bin/open -n -a /Applications/Google Chrome.app --args --user-data-dir={self.UDD} --app=x"),
            (303, f"{self.CHROME} Helper (Renderer).app/x --type=renderer --user-data-dir={self.UDD}"),
            (404, f"{self.CHROME} --user-data-dir={self.UDD} --no-first-run --app=http://127.0.0.1:1/?app=1"),
        )
        self.assertEqual(macapp.browser_pid_from_ps(out, self.UDD), 404)

    def test_flag_at_line_end(self):
        self.assertEqual(macapp.browser_pid_from_ps(self.ps((7, f"{self.CHROME} --user-data-dir={self.UDD}")), self.UDD), 7)

    def test_longer_path_not_matched(self):
        out = self.ps((8, f"{self.CHROME} --user-data-dir={self.UDD}2 --app=x"))
        self.assertIsNone(macapp.browser_pid_from_ps(out, self.UDD))

    def test_none_running(self):
        self.assertIsNone(macapp.browser_pid_from_ps(self.ps((1, self.CHROME)), self.UDD))

    def test_no_pyobjc_falls_back(self):
        # Without pyobjc run() must return False at once and never call serve (Sight.py then serves itself).
        logs, served = [], []
        with mock.patch.dict(sys.modules, {"objc": None}):
            ok = macapp.run(lambda: served.append(1), user_data_dir=self.UDD, window_alive=lambda: True, relaunch=lambda: None,
                            request_stop=lambda: None, on_server_exit=lambda e, q: None, log=logs.append)
        self.assertFalse(ok)
        self.assertEqual(served, [])
        self.assertTrue(any("pyobjc" in m for m in logs))


class BusClose(unittest.TestCase):
    """macOS Quit ends the page's /api/events stream through Bus.close, so shutdown does not wait for it."""

    def setUp(self):
        try:
            from app.library import Bus
        except ImportError as exc:  # app.library needs the runtime deps
            self.skipTest(f"app.library not importable: {exc}")
        self.Bus = Bus

    def test_close_reaches_subscribers_even_when_full(self):
        bus = self.Bus()
        q = bus.subscribe()
        for i in range(600):  # past maxsize: the oldest are dropped, the close marker must survive
            bus.publish({"type": "x", "i": i})
        bus.close()
        self.assertTrue(bus.closed)
        last = None
        while not q.empty():
            last = q.get_nowait()
        self.assertIs(last, self.Bus.CLOSE)


if __name__ == "__main__":
    unittest.main()
