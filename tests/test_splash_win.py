"""Pure parts of the Windows launch splash (app/splash_win.py); the Win32 window itself needs Windows."""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app import splash_win


def _tree(tmp: Path, script: bool = True, image: bool = True) -> Path:
    (tmp / "app").mkdir()
    if script:
        (tmp / "app" / "splash_win.py").write_text("")
    if image:
        (tmp / "app" / "splash.png").write_bytes(b"png")
    return tmp


class SplashLaunchTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)

    def test_command_frozen_and_source(self):
        img, script = self.root / "splash.png", self.root / "splash_win.py"
        self.assertEqual(
            splash_win.splash_command(True, "C:/S/Sight.exe", script, img, "Local\\E", 45),
            ["C:/S/Sight.exe", "--splash", str(img), "Local\\E", "45"],
        )
        cmd = splash_win.splash_command(False, "/x/python", script, img, "Local\\E", 45)
        self.assertEqual(cmd[0], "/x/python")  # no pythonw next to it
        self.assertEqual(cmd[1:3], ["-I", "-S"])
        self.assertEqual(cmd[3:], [str(script), str(img), "Local\\E", "45"])
        (self.root / "pythonw.exe").write_text("")
        self.assertEqual(
            splash_win.splash_command(False, str(self.root / "python.exe"), script, img, "e")[0],
            str(self.root / "pythonw.exe"),
        )

    def test_not_windows_starts_nothing(self):
        popen = mock.Mock()
        env = {}
        with mock.patch.object(splash_win.sys, "platform", "linux"):
            self.assertEqual(splash_win.launch(_tree(self.root), False, env, popen), (None, None))
        popen.assert_not_called()
        self.assertEqual(env, {})

    def test_started_once_across_reexec(self):
        _tree(self.root)
        popen, env = mock.Mock(), {}
        with mock.patch.object(splash_win.sys, "platform", "win32"):
            first, _ = splash_win.launch(self.root, False, env, popen)
            self.assertTrue(first and first.startswith("Local\\SightSplash-"))
            self.assertEqual(env[splash_win.ENV_VAR], first)
            second, _ = splash_win.launch(self.root, False, env, popen)  # the re-exec'd main()
        self.assertEqual(second, first)
        popen.assert_called_once()

    def test_missing_files_and_popen_failure(self):
        with mock.patch.object(splash_win.sys, "platform", "win32"):
            for kw, frozen in (({"image": False}, False), ({"script": False}, False)):
                with tempfile.TemporaryDirectory() as d:
                    popen, env = mock.Mock(), {}
                    self.assertEqual(splash_win.launch(_tree(Path(d), **kw), frozen, env, popen), (None, None))
                    popen.assert_not_called()
            # frozen build needs the png only (the code is inside the exe)
            with tempfile.TemporaryDirectory() as d:
                popen = mock.Mock()
                self.assertTrue(splash_win.launch(_tree(Path(d), script=False), True, {}, popen)[0])
            env = {}
            self.assertEqual(splash_win.launch(_tree(self.root), False, env, mock.Mock(side_effect=OSError)), (None, None))
            self.assertEqual(env, {})  # nothing recorded: a retry may start one

    def test_close_and_run_are_safe_off_windows(self):
        splash_win.signal(None)
        splash_win.signal(123)
        splash_win.release(123)
        splash_win.run([])
        splash_win.run(["only-one"])
        splash_win.run(["missing.png", "Local\\x", "1"])


if __name__ == "__main__":
    unittest.main()
