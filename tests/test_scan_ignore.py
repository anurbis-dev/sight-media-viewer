"""Scan filtering: the built-in app/initial_filtering.ini + the user's Ignore list (app/library.py).

    python -m unittest tests.test_scan_ignore
"""
from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

from app import fileinfo, library
from app.library import FILTER_INI, SHIPPED_FILTER, IgnoreRules, Library, read_default_filter


def all_shown_exts() -> set[str]:
    exts: set[str] = set()
    for mod in (library, fileinfo):
        for name, val in vars(mod).items():
            if name.endswith("_EXT") and isinstance(val, (set, frozenset, tuple, list)):
                exts |= {x for x in val if isinstance(x, str) and x.startswith(".")}
    return exts


class ScanIgnoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="sight-ign-"))

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_shipped_ini_parses(self) -> None:
        text = SHIPPED_FILTER.read_text(encoding="utf-8")
        rules = IgnoreRules("", text)
        self.assertGreater(len(rules.rules), 20)
        for name, is_dir in (("Thumbs.db", False), ("a.tmp", False), (".DS_Store", False), ("._x", False),
                             ("node_modules", True), ("$RECYCLE.BIN", True), ("System Volume Information", True),
                             (".Trash-1000", True), ("x.part", False)):
            self.assertTrue(rules.leaf(["sub", name], is_dir), name)
        self.assertFalse(rules.leaf(["pic.png"], False))
        self.assertTrue(rules.path(["node_modules", "a", "pic.png"]))
        self.assertTrue(rules.path(["x", "THUMBS.DB"]))

    def test_media_folders_with_file_like_names_survive(self) -> None:
        rules = IgnoreRules("", SHIPPED_FILTER.read_text(encoding="utf-8"))
        for parts in (["Shots.bak", "a.png"], ["render.temp", "a.png"], ["proj~", "a.png"], ["x.lock", "a.png"]):
            self.assertFalse(rules.path(parts), parts)
        for parts in (["Thumbs.db"], ["x.tmp"], ["node_modules", "x.png"]):
            self.assertTrue(rules.path(parts), parts)

    def test_saving_shipped_text_removes_user_copy(self) -> None:
        lib = Library(self.tmp)
        try:
            lib.set_default_filter("x.y\n")
            self.assertTrue((self.tmp / FILTER_INI).exists())
            lib.set_default_filter(SHIPPED_FILTER.read_text(encoding="utf-8"))
            self.assertFalse((self.tmp / FILTER_INI).exists())
            self.assertFalse(lib.default_custom)
            self.assertFalse((self.tmp / (FILTER_INI + ".tmp")).exists())
        finally:
            lib._stop.set()
            lib.conn.close()

    def test_union_of_defaults_and_user(self) -> None:
        rules = IgnoreRules("*.meta\nLibrary/\n", "Thumbs.db\n.git/\n")
        self.assertEqual(rules.text, "*.meta\nLibrary/\n")  # only the user's list is kept as text
        self.assertTrue(rules.path(["Thumbs.db"]))  # default (file)
        self.assertTrue(rules.path([".git", "x.png"]))  # default (folder)
        self.assertTrue(rules.path(["a.png.meta"]))  # user (file)
        self.assertTrue(rules.path(["Library", "x.png"]))  # user (folder)
        self.assertFalse(rules.path(["a.png"]))
        self.assertFalse(rules.leaf(["Library"], False))  # trailing slash = folders only

    def test_user_copy_overrides_shipped(self) -> None:
        text, custom = read_default_filter(self.tmp)
        self.assertFalse(custom)
        self.assertEqual(text, SHIPPED_FILTER.read_text(encoding="utf-8").replace("\r\n", "\n"))
        (self.tmp / FILTER_INI).write_text("only.me\n", encoding="utf-8")
        text, custom = read_default_filter(self.tmp)
        self.assertTrue(custom)
        self.assertEqual(text, "only.me\n")
        lib = Library(self.tmp)
        try:
            self.assertTrue(lib.default_custom)
            self.assertTrue(lib.ignore.path(["only.me"]))
            self.assertFalse(lib.ignore.path(["Thumbs.db"]))
            lib.set_default_filter(None)  # restore shipped
            self.assertFalse((self.tmp / FILTER_INI).exists())
            self.assertFalse(lib.default_custom)
            self.assertTrue(lib.ignore.path(["Thumbs.db"]))
            lib.set_default_filter("x.y\n")
            self.assertTrue(lib.default_custom)
            self.assertTrue(lib.ignore.path(["x.y"]))
        finally:
            lib._stop.set()
            lib.conn.close()

    def test_no_shown_extension_is_filtered(self) -> None:
        rules = IgnoreRules("", SHIPPED_FILTER.read_text(encoding="utf-8"))
        exts = all_shown_exts()
        self.assertIn(".obj", exts)
        self.assertIn(".log", exts)  # text files are shown, so *.log must not be in the list
        for ext in sorted(exts):
            self.assertFalse(rules.path(["dir", "file" + ext]), ext)
        for ext in (".obj", ".log", ".ini", ".cfg"):
            self.assertFalse(rules.path(["file" + ext]), ext)

    def test_fallback_when_unreadable(self) -> None:
        old = library.SHIPPED_FILTER
        library.SHIPPED_FILTER = self.tmp / "missing.ini"
        try:
            text, custom = library.read_default_filter(self.tmp)
        finally:
            library.SHIPPED_FILTER = old
        self.assertFalse(custom)
        self.assertTrue(IgnoreRules("", text).path([".git", "x"]))


if __name__ == "__main__":
    unittest.main()
