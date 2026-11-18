"""Adding / removing source folders (app/library.py: add_source, remove_source, scan_source).

    python -m unittest tests.test_sources
"""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
import unicodedata
import unittest
from pathlib import Path
from unittest import mock

from app import library
from app.library import Library, asset_id


def png(p: Path) -> Path:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"\x89PNG\r\n\x1a\n" + os.urandom(16))
    return p


class SourcesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="sight-src-"))
        self.lib = Library(self.tmp / "home")
        # No live watchers in these tests: they would race the synchronous scans below.
        self.watch = mock.patch.object(Library, "_watch", lambda *a, **k: None)
        self.watch.start()
        # add_source scans in a thread; run it inline instead so the tests are deterministic.
        self.thread = mock.patch.object(library.threading, "Thread", _InlineThread)
        self.thread.start()

    def tearDown(self) -> None:
        self.thread.stop()
        self.watch.stop()
        self.lib.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def ids(self, sid: str) -> set[str]:
        return {r["id"] for r in self.lib.query("SELECT id FROM assets WHERE source_id=?", (sid,))}

    def orphans(self) -> int:
        return self.lib.query(
            "SELECT COUNT(*) c FROM assets WHERE source_id NOT IN (SELECT id FROM sources)")[0]["c"]

    @unittest.skipUnless(os.name == "nt", "case-insensitive paths")
    def test_same_folder_other_case_is_one_source(self) -> None:
        root = self.tmp / "Pics"
        png(root / "a.png")
        sid = self.lib.add_source(str(root))["id"]
        self.assertEqual(self.lib.add_source(str(root).lower())["id"], sid)
        self.assertEqual(len(self.lib.sources()), 1)

    def test_add_scan_remove_readd(self) -> None:
        root = self.tmp / "картинки"
        a = png(root / "a.png")
        png(root / "sub" / "b.png")
        sid = self.lib.add_source(str(root))["id"]
        self.assertEqual(len(self.ids(sid)), 2)
        self.lib.execute("UPDATE assets SET rating=5 WHERE id=?", (asset_id(str(a)),))
        self.lib.remove_source(sid)
        self.assertEqual(self.lib.sources(), [])
        self.assertEqual(self.lib.query("SELECT COUNT(*) c FROM assets")[0]["c"], 0)
        again = self.lib.add_source(str(root) + os.sep)  # trailing separator: same folder, same id
        self.assertEqual(again["id"], sid)
        self.assertEqual(len(self.ids(sid)), 2)

    def test_remove_during_scan_leaves_no_rows(self) -> None:
        root = self.tmp / "pics"
        for i in range(5):
            png(root / f"d{i}" / f"{i}.png")
        sid = asset_id(str(root.resolve()))
        self.lib.execute("INSERT INTO sources(id, name, path, added_at, sort_order) VALUES (?,?,?,?,0)",
                         (sid, "pics", str(root.resolve()), 1))
        real_walk = os.walk

        def walk(*a, **k):  # the source is removed while the walk is half way
            for i, step in enumerate(real_walk(*a, **k)):
                if i == 2:
                    self.lib.remove_source(sid)
                yield step

        with mock.patch.object(library.os, "walk", walk), mock.patch.object(library, "BATCH", 1):
            self.lib.scan_source(sid)
        self.assertEqual(self.orphans(), 0)
        self.assertEqual(self.lib.scanning, 0)

    def test_watcher_event_after_remove_adds_nothing(self) -> None:
        root = self.tmp / "pics"
        png(root / "a.png")
        sid = self.lib.add_source(str(root))["id"]
        self.lib.remove_source(sid)
        late = png(root / "late.png")
        self.lib._touch_one(sid, str(late), "image")
        self.assertEqual(self.orphans(), 0)

    def test_remove_drops_collection_membership(self) -> None:
        root = self.tmp / "pics"
        a = png(root / "a.png")
        sid = self.lib.add_source(str(root))["id"]
        cid = self.lib.add_collection("C")["id"]
        self.lib.execute("INSERT INTO collection_assets(collection_id, asset_id) VALUES (?,?)",
                         (cid, asset_id(str(a))))
        self.lib.remove_source(sid)
        col = next(c for c in self.lib.collections() if c["id"] == cid)
        self.assertEqual(col["count"], 0)

    def counts(self) -> dict[str, int]:
        return {s["name"]: s["count"] for s in self.lib.sources()}

    def listed(self, sid: str) -> set[str]:
        return {a["name"] for a in self.lib.list_assets(source_id=sid, limit=1000)}

    def nest(self) -> tuple[Path, Path]:
        desk = self.tmp / "Desktop"
        light = desk / "ЛАЙТИНГ"
        png(desk / "d1.png")
        png(desk / "other" / "d2.png")
        png(light / "кадр1.png")
        png(light / "Свет" / "кадр2.png")
        return desk, light

    def test_nested_source_added_after_its_parent(self) -> None:
        # The user's case: Desktop first, then ЛАЙТИНГ inside it. The inner source used to show
        # 0 files, and removing Desktop took ЛАЙТИНГ's files with it ("previews are gone").
        desk, light = self.nest()
        d = self.lib.add_source(str(desk))["id"]
        self.lib.execute("UPDATE assets SET rating=5 WHERE id=?", (asset_id(str(light / "кадр1.png")),))
        l_ = self.lib.add_source(str(light))["id"]
        self.assertEqual(self.counts(), {"Desktop": 4, "ЛАЙТИНГ": 2})
        self.assertEqual(self.listed(l_), {"кадр1.png", "кадр2.png"})
        self.assertEqual(len(self.listed(d)), 4)
        self.lib.scan_source(d)  # the outer rescan leaves the inner folder alone
        self.assertEqual(self.lib.query("SELECT COUNT(*) c FROM assets WHERE status='missing'")[0]["c"], 0)
        self.lib.remove_source(d)
        self.assertEqual(self.counts(), {"ЛАЙТИНГ": 2})
        self.assertEqual(self.listed(l_), {"кадр1.png", "кадр2.png"})
        rating = self.lib.query("SELECT rating FROM assets WHERE id=?", (asset_id(str(light / "кадр1.png")),))[0][0]
        self.assertEqual(rating, 5)
        self.assertEqual(self.orphans(), 0)

    def test_nested_source_typed_in_other_unicode_form(self) -> None:
        # macOS lists "Й" decomposed (NFD); a typed / pasted path has it composed (NFC).
        desk = self.tmp / "Desktop"
        nfd = unicodedata.normalize("NFD", "ЛАЙТИНГ")
        png(desk / nfd / "кадр1.png")
        png(desk / "d1.png")
        d = self.lib.add_source(str(desk))["id"]
        got = self.lib.add_source(str(desk / unicodedata.normalize("NFC", "ЛАЙТИНГ")))
        self.assertEqual(Path(got["path"]).name, nfd)  # stored as the folder listing spells it
        self.assertEqual(self.counts(), {"Desktop": 2, nfd: 1})
        self.assertEqual(self.lib.query("SELECT COUNT(*) c FROM assets")[0]["c"], 2)  # no duplicate rows
        self.lib.remove_source(d)
        self.assertEqual(len(self.ids(got["id"])), 1)

    def test_parent_added_after_nested_source(self) -> None:
        desk, light = self.nest()
        l_ = self.lib.add_source(str(light))["id"]
        d = self.lib.add_source(str(desk))["id"]
        self.assertEqual(self.counts(), {"ЛАЙТИНГ": 2, "Desktop": 4})
        self.assertEqual(len(self.listed(d)), 4)
        self.lib.remove_source(l_)  # its files stay, now Desktop's
        self.assertEqual(self.counts(), {"Desktop": 4})
        self.assertEqual(self.ids(d), {asset_id(str(p)) for p in [
            desk / "d1.png", desk / "other" / "d2.png", light / "кадр1.png", light / "Свет" / "кадр2.png"]})
        self.lib.remove_source(d)
        self.assertEqual(self.lib.query("SELECT COUNT(*) c FROM assets")[0]["c"], 0)

    def test_nested_source_added_while_the_outer_scan_walks(self) -> None:
        desk, light = self.nest()
        d = asset_id(str(desk.resolve()))
        self.lib.execute("INSERT INTO sources(id, name, path, added_at, sort_order) VALUES (?,?,?,?,0)",
                         (d, "Desktop", str(desk.resolve()), 1))
        real_walk = os.walk
        added = []

        def walk(top, *a, **k):
            for i, step in enumerate(real_walk(top, *a, **k)):
                if i == 0 and not added:
                    added.append(None)  # the add rescans Desktop (inline here): only once
                    added[0] = self.lib.add_source(str(light))["id"]
                yield step

        with mock.patch.object(library.os, "walk", walk), mock.patch.object(library, "BATCH", 1):
            self.lib.scan_source(d)
        self.assertEqual(len(self.ids(added[0])), 2)
        self.assertEqual(len(self.ids(d)), 2)
        self.assertEqual(self.counts(), {"Desktop": 4, "ЛАЙТИНГ": 2})

    def test_outer_watcher_leaves_nested_files_alone(self) -> None:
        desk, light = self.nest()
        d = self.lib.add_source(str(desk))["id"]
        l_ = self.lib.add_source(str(light))["id"]
        self.lib.set_excluded(l_, str(light / "cache"), True)
        x = png(light / "cache" / "x.png")
        self.lib._touch_one(d, str(x), "image")  # the outer watcher's event
        self.assertFalse(self.lib.query("SELECT 1 FROM assets WHERE id=?", (asset_id(str(x)),)))
        y = png(light / "new.png")
        self.lib._touch_one(d, str(y), "image")
        self.lib._touch_one(l_, str(y), "image")
        self.assertEqual(self.lib.query("SELECT source_id FROM assets WHERE id=?", (asset_id(str(y)),))[0][0], l_)

    @unittest.skipUnless(sys.platform == "darwin", "needs a file system that ignores the Unicode form")
    def test_nested_inside_an_outer_root_stored_in_other_unicode_form(self) -> None:
        nfd, nfc = unicodedata.normalize("NFD", "ЙОД"), unicodedata.normalize("NFC", "ЙОД")
        png(self.tmp / nfd / "sub" / "a.png")
        png(self.tmp / nfd / "b.png")
        outer = str((self.tmp / nfc).resolve())  # an old library: the root stored as typed
        o = asset_id(outer)
        self.lib.execute("INSERT INTO sources(id, name, path, added_at, sort_order) VALUES (?,?,?,?,0)",
                         (o, nfc, outer, 1))
        self.lib.scan_source(o)
        self.assertEqual(len(self.ids(o)), 2)
        inner = self.lib.add_source(str(self.tmp / nfd / "sub"))
        self.assertTrue(inner["path"].startswith(outer))
        self.assertEqual(self.lib.query("SELECT COUNT(*) c FROM assets")[0]["c"], 2)  # no doubles
        self.assertEqual(len(self.ids(inner["id"])), 1)

    def test_parent_excluding_the_nested_folder(self) -> None:
        desk, light = self.nest()
        d = self.lib.add_source(str(desk))["id"]
        self.lib.add_source(str(light))
        self.lib.set_excluded(d, str(light), True)
        self.assertEqual(self.counts(), {"Desktop": 2, "ЛАЙТИНГ": 2})

    def test_startup_hands_files_to_the_nested_source(self) -> None:
        desk, light = self.nest()
        d = self.lib.add_source(str(desk))["id"]
        l_ = asset_id(str(light.resolve()))  # an old library: the inner source added but left empty
        self.lib.execute("INSERT INTO sources(id, name, path, added_at, sort_order) VALUES (?,?,?,?,1)",
                         (l_, light.name, str(light.resolve()), 2))
        self.assertEqual(len(self.ids(d)), 4)
        self.lib._first_page.set()
        self.lib.resume_watchers()
        self.assertEqual(len(self.ids(l_)), 2)
        self.assertEqual(self.counts(), {"Desktop": 4, "ЛАЙТИНГ": 2})

    def test_startup_drops_rows_of_removed_sources(self) -> None:
        self.lib.execute(
            "INSERT INTO assets(id, source_id, path, name, ext, kind, size, mtime, added_at) VALUES (?,?,?,?,?,?,?,?,?)",
            ("x", "gone", "/nowhere/x.png", "x.png", ".png", "image", 1, 1.0, 1))
        self.lib.resume_watchers()
        self.assertEqual(self.orphans(), 0)


class _InlineThread:
    def __init__(self, target=None, args=(), kwargs=None, daemon=None, **_kw) -> None:
        self._t, self._a, self._k = target, args, kwargs or {}

    def start(self) -> None:
        if self._t is not None:
            self._t(*self._a, **self._k)

    def join(self, timeout: float | None = None) -> None:
        pass


if __name__ == "__main__":
    unittest.main()
