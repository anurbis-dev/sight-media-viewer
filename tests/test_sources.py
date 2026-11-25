"""Adding / removing source folders (app/library.py: add_source, remove_source, scan_source).

    python -m unittest tests.test_sources
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
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


from tests.test_annot_tools import NODE, ROOT, free_port, has_playwright  # noqa: E402


@unittest.skipUnless(has_playwright(), "node with Playwright not available")
class DropFoldersE2E(unittest.TestCase):
    """Overlay + POST /api/sources/drop in the page (tests/drop_folders_e2e.cjs)."""

    @classmethod
    def setUpClass(cls) -> None:
        import threading
        import time
        import uvicorn
        from app.server import build_app

        cls.NODE, cls.ROOT = NODE, ROOT
        cls.tmp = Path(tempfile.mkdtemp(prefix="sight-drop-e2e-"))
        cls.lib = Library(cls.tmp / "home")
        cls.folder = cls.tmp / "DropMe"
        cls.folder.mkdir()
        png(cls.folder / "a.png")
        cls.port = free_port()
        cls.server = uvicorn.Server(uvicorn.Config(build_app(cls.lib), host="127.0.0.1", port=cls.port, log_level="warning"))
        cls.thread = threading.Thread(target=cls.server.run, daemon=True)
        cls.thread.start()
        for _ in range(100):
            if cls.server.started:
                break
            time.sleep(0.05)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.should_exit = True
        cls.thread.join(5)
        for w in list(cls.lib._watchers.values()):
            w.stop()
        cls.lib.close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_overlay_and_sidebar(self) -> None:
        r = subprocess.run(
            [self.NODE, str(self.ROOT / "tests" / "drop_folders_e2e.cjs"),
             f"http://127.0.0.1:{self.port}", str(self.folder), self.folder.name],
            capture_output=True, text=True, timeout=120, cwd=self.ROOT / "tests",
        )
        self.assertEqual(r.returncode, 0, r.stdout[-4000:] + r.stderr[-4000:])
        res = json.loads(r.stdout)
        self.assertTrue(res["ok"])
        self.assertEqual(res["name"], self.folder.name)


@unittest.skipUnless(has_playwright(), "node with Playwright not available")
class DropFilesE2E(unittest.TestCase):
    """Two-zone overlay + POST /api/files/drop (tests/drop_files_e2e.cjs)."""

    @classmethod
    def setUpClass(cls) -> None:
        import threading
        import time
        import uvicorn
        from app.server import build_app

        cls.NODE, cls.ROOT = NODE, ROOT
        cls.tmp = Path(tempfile.mkdtemp(prefix="sight-drop-file-e2e-"))
        cls.lib = Library(cls.tmp / "home")
        cls.pic = png(cls.tmp / "clip.png")
        cls.port = free_port()
        cls.server = uvicorn.Server(uvicorn.Config(build_app(cls.lib), host="127.0.0.1", port=cls.port, log_level="warning"))
        cls.thread = threading.Thread(target=cls.server.run, daemon=True)
        cls.thread.start()
        for _ in range(100):
            if cls.server.started:
                break
            time.sleep(0.05)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.should_exit = True
        cls.thread.join(5)
        for w in list(cls.lib._watchers.values()):
            w.stop()
        cls.lib.close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_overlay_and_dropped_source(self) -> None:
        r = subprocess.run(
            [self.NODE, str(self.ROOT / "tests" / "drop_files_e2e.cjs"),
             f"http://127.0.0.1:{self.port}", str(self.pic)],
            capture_output=True, text=True, timeout=120, cwd=self.ROOT / "tests",
        )
        self.assertEqual(r.returncode, 0, r.stdout[-4000:] + r.stderr[-4000:])
        res = json.loads(r.stdout)
        self.assertTrue(res["ok"])
        self.assertEqual(res["name"], "clip.png")


class DropFoldersTest(unittest.TestCase):
    """Folders dropped on the window (POST /api/sources/drop, app/server.py drop_folder_paths)."""

    def test_file_uri_to_path(self) -> None:
        from app.server import file_uri_to_path

        self.assertEqual(file_uri_to_path(""), "")
        self.assertEqual(file_uri_to_path("https://example.com/x"), "")
        self.assertEqual(file_uri_to_path("/Users/me/Pics"), "/Users/me/Pics")
        self.assertEqual(file_uri_to_path("file:///Users/me/Pics"), "/Users/me/Pics")
        self.assertEqual(file_uri_to_path("file:///C:/Users/me/Pics"), r"C:\Users\me\Pics")
        self.assertEqual(file_uri_to_path("file://localhost/C:/Users/me/Pics"), r"C:\Users\me\Pics")
        self.assertEqual(file_uri_to_path("file://server/share/folder"), r"\\server\share\folder")
        self.assertEqual(file_uri_to_path(r"C:\Users\me\Pics"), r"C:\Users\me\Pics")
        self.assertEqual(file_uri_to_path("file:///C:/foo%20bar"), r"C:\foo bar")
        self.assertEqual(file_uri_to_path("file:///tmp/x\ttitle"), "/tmp/x")

    def test_name_match_and_ambiguous(self) -> None:
        from app.server import drop_folder_paths

        tmp = Path(tempfile.mkdtemp(prefix="sight-drop-"))
        try:
            a = tmp / "Photos"
            b = tmp / "other" / "Photos"
            c = tmp / "Renders"
            a.mkdir()
            b.mkdir(parents=True)
            c.mkdir()
            (tmp / "file.png").write_bytes(b"x")
            paths, missed = drop_folder_paths([str(c)], ["Photos"], selected=[str(a)])
            self.assertEqual({Path(p).resolve() for p in paths}, {c.resolve(), a.resolve()})
            self.assertEqual(missed, [])
            paths, missed = drop_folder_paths([], ["Photos"], selected=[str(a), str(b)])
            self.assertEqual(paths, [])
            self.assertEqual(missed, [{"name": "Photos", "reason": "ambiguous"}])
            paths, missed = drop_folder_paths([], ["Missing"], selected=[str(a)])
            self.assertEqual(paths, [])
            self.assertEqual(missed, [{"name": "Missing", "reason": "unknown"}])
            paths, missed = drop_folder_paths([str(tmp / "file.png")], [], selected=[])
            self.assertEqual(paths, [])
            cafe = tmp / unicodedata.normalize("NFC", "Café")
            cafe.mkdir()
            paths, missed = drop_folder_paths(
                [], [unicodedata.normalize("NFD", "Café")], selected=[str(cafe)])
            self.assertEqual({Path(p).resolve() for p in paths}, {cafe.resolve()})
            self.assertEqual(missed, [])
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def _drop(self, lib: Library, paths: list[str], names: list[str]) -> dict:
        import asyncio
        from starlette.requests import Request
        from app.server import build_app

        app = build_app(lib)
        body = json.dumps({"paths": paths, "names": names}).encode()
        for r in app.routes:
            if getattr(r, "path", "") == "/api/sources/drop" and "POST" in (getattr(r, "methods", None) or ()):
                async def receive():
                    return {"type": "http.request", "body": body, "more_body": False}
                scope = {"type": "http", "method": "POST", "path": "/api/sources/drop", "path_params": {},
                         "query_string": b"", "headers": [(b"content-type", b"application/json")]}
                res = asyncio.run(r.endpoint(Request(scope, receive)))
                return res if isinstance(res, dict) else json.loads(res.body)
        self.fail("POST /api/sources/drop not found")

    def test_drop_http_adds(self) -> None:
        tmp = Path(tempfile.mkdtemp(prefix="sight-drop-http-"))
        lib = Library(tmp / "home")
        watch = mock.patch.object(Library, "_watch", lambda *a, **k: None)
        scan = mock.patch.object(Library, "scan_source", lambda *a, **k: None)
        sel = mock.patch("app.server.os_manager_selected_dirs", lambda: [])
        watch.start()
        scan.start()
        sel.start()
        try:
            folder = tmp / "shots"
            folder.mkdir()
            png(folder / "a.png")
            body = self._drop(lib, [str(folder)], ["shots"])
            self.assertEqual(len(body["added"]), 1)
            self.assertTrue(body["added"][0]["new"])
            self.assertEqual(body["added"][0]["name"], "shots")
            again = self._drop(lib, [str(folder)], [])
            self.assertEqual(len(again["added"]), 1)
            self.assertFalse(again["added"][0]["new"])
            nope = self._drop(lib, [str(tmp / "gone")], ["gone"])
            self.assertEqual(nope["added"], [])
            self.assertEqual(nope["missed"][0]["reason"], "unknown")
            file_only = self._drop(lib, [str(folder / "a.png")], [])
            self.assertEqual(file_only["added"], [])
            self.assertEqual(file_only["missed"], [])
            extra = []
            for i in range(33):
                d = tmp / f"cap{i:02d}"
                d.mkdir()
                extra.append(str(d))
            capped = self._drop(lib, extra, [])
            self.assertEqual(len(capped["added"]), 32)
            self.assertTrue(any(m["reason"] == "too many" for m in capped["missed"]))
        finally:
            sel.stop()
            scan.stop()
            watch.stop()
            lib.close()
            shutil.rmtree(tmp, ignore_errors=True)


class DropFilesTest(unittest.TestCase):
    """Files dropped on the window (POST /api/files/drop)."""

    def _drop(self, lib: Library, paths: list[str], names: list[str], mode: str = "library") -> dict:
        import asyncio
        from starlette.requests import Request
        from app.server import build_app

        app = build_app(lib)
        body = json.dumps({"paths": paths, "names": names, "mode": mode}).encode()
        for r in app.routes:
            if getattr(r, "path", "") == "/api/files/drop" and "POST" in (getattr(r, "methods", None) or ()):
                async def receive():
                    return {"type": "http.request", "body": body, "more_body": False}
                scope = {"type": "http", "method": "POST", "path": "/api/files/drop", "path_params": {},
                         "query_string": b"", "headers": [(b"content-type", b"application/json")]}
                res = asyncio.run(r.endpoint(Request(scope, receive)))
                return res if isinstance(res, dict) else json.loads(res.body)
        self.fail("POST /api/files/drop not found")

    def test_file_uri_and_name_match(self) -> None:
        from app.server import drop_file_paths

        tmp = Path(tempfile.mkdtemp(prefix="sight-dropf-"))
        try:
            a = png(tmp / "shot.png")
            other = tmp / "other"
            other.mkdir()
            b = png(other / "shot.png")
            paths, missed = drop_file_paths([str(a)], [], selected=[])
            self.assertEqual({Path(p).resolve() for p in paths}, {a.resolve()})
            paths, missed = drop_file_paths([], ["shot.png"], selected=[str(a)])
            self.assertEqual({Path(p).resolve() for p in paths}, {a.resolve()})
            paths, missed = drop_file_paths([], ["shot.png"], selected=[str(a), str(b)])
            self.assertEqual(paths, [])
            self.assertEqual(missed, [{"name": "shot.png", "reason": "ambiguous"}])
            paths, missed = drop_file_paths([str(tmp)], [], selected=[])
            self.assertEqual(paths, [])
            cafe = png(tmp / unicodedata.normalize("NFC", "Café.png"))
            paths, missed = drop_file_paths(
                [], [unicodedata.normalize("NFD", "Café.png")], selected=[str(cafe)])
            self.assertEqual({Path(p).resolve() for p in paths}, {cafe.resolve()})
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_drop_http_library_and_view(self) -> None:
        tmp = Path(tempfile.mkdtemp(prefix="sight-drop-file-http-"))
        lib = Library(tmp / "home")
        watch = mock.patch.object(Library, "_watch", lambda *a, **k: None)
        scan = mock.patch.object(Library, "scan_source", lambda *a, **k: None)
        sel = mock.patch("app.server.os_manager_selected_files", lambda: [])
        watch.start()
        scan.start()
        sel.start()
        try:
            pic = png(tmp / "clip.png")
            viewed = self._drop(lib, [str(pic)], ["clip.png"], "view")
            self.assertEqual(len(viewed["items"]), 1)
            self.assertTrue(viewed["items"][0]["ephemeral"])
            self.assertEqual(lib.query("SELECT COUNT(*) c FROM assets")[0]["c"], 0)
            self.assertIsNotNone(lib.resolve_asset(viewed["items"][0]["id"]))
            added = self._drop(lib, [str(pic)], [], "library")
            self.assertEqual(len(added["items"]), 1)
            self.assertTrue(added["items"][0]["new"])
            self.assertFalse(added["items"][0].get("ephemeral"))
            self.assertEqual(lib.query("SELECT COUNT(*) c FROM assets")[0]["c"], 1)
            srcs = lib.sources()
            self.assertTrue(any(s.get("dropped") for s in srcs))
            self.assertEqual(srcs[0]["name"] if srcs[0].get("dropped") else next(s["name"] for s in srcs if s.get("dropped")), "Dropped files")
            again = self._drop(lib, [str(pic)], [], "library")
            self.assertFalse(again["items"][0]["new"])
            folder = tmp / "shots"
            folder.mkdir()
            inside = png(folder / "in.png")
            sid = lib.add_source(str(folder))["id"]
            # add_source is mocked scan: index the file by dropping it
            got = self._drop(lib, [str(inside)], [], "library")
            self.assertEqual(got["items"][0]["source_id"], sid)
            txt = tmp / "notes.txt"
            txt.write_text("hi")
            doc = self._drop(lib, [str(txt)], [], "view")
            self.assertEqual(doc["items"][0]["kind"], "document")
            nope = self._drop(lib, [str(tmp / "gone.png")], ["gone.png"], "view")
            self.assertEqual(nope["items"], [])
            self.assertEqual(nope["missed"][0]["reason"], "unknown")
            bad = tmp / "x.xyz"
            bad.write_bytes(b"x")
            skip = self._drop(lib, [str(bad)], [], "view")
            self.assertEqual(skip["missed"][0]["reason"], "unsupported")
            extra = [str(png(tmp / f"cap{i:02d}.png")) for i in range(33)]
            capped = self._drop(lib, extra, [], "view")
            self.assertEqual(len(capped["items"]), 32)
            self.assertTrue(any(m["reason"] == "too many" for m in capped["missed"]))
        finally:
            sel.stop()
            scan.stop()
            watch.stop()
            lib.close()
            shutil.rmtree(tmp, ignore_errors=True)


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
