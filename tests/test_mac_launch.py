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


if __name__ == "__main__":
    unittest.main()
