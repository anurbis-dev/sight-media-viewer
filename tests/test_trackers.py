"""The tracker-neutral layer (docs/ARCHITECTURE.md "Tracker adapters", docs/PLAN-trackers.md stage 5b): tracker keys
(app/trackers.py and app/static/trackers-core.js agree), the adapter registry on both sides, the generic routes
/api/trackers/{kind}/… with the /api/sg/… aliases, links per tracker key, smart collections filed under a tracker key,
and the migrations of pre-0.107 data (sg_links rows, collections.sg_site / sg_project). No network.

    python -m unittest tests.test_trackers
"""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.library import Library  # noqa: E402
from app.shotgrid import ShotGridService  # noqa: E402
from app.trackers import TrackerError, Trackers, host_of, split_key, tracker_key  # noqa: E402

NODE = shutil.which("node")
SITES = ["https://Studio.Example", "studio.example/", "https://studio.example:443", "http://127.0.0.1:8080",
         "https://studio.example:8443", "http://localhost:80", "http://[::1]:5000", "", "https://",
         # unusual spellings the browser canonicalises (review of 0.107.0): both sides must give the same host
         "http://[0:0:0:0:0:0:0:1]:5000", "https://[::FFFF:1.2.3.4]", "http://0x7f.1:8080", "https://127.1", "https://0177.0.0.1",
         "https://08.1", "https://bücher.example", "https://xn--bcher-kva.example", "a.b/c://d", "http://localhost:443",
         "https://localhost:80", "https://x:0443", "https://%41.example", "https://x.", "ftp://x", "HTTPS://Up.Example:8443",
         "https://u:p@studio.example", "http://[1:0:0:2:0:0:0:3]", "http://[fe80::1:0:0:1]:9"]


def insert_asset(lib: Library, aid: str) -> None:
    lib.execute("INSERT INTO assets(id, source_id, path, name, ext, kind, size, mtime, tags, status, added_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?)", (aid, "src", f"/m/{aid}.png", f"{aid}.png", ".png", "image", 1, 1, "[]", "ready", 1))


class KeyTest(unittest.TestCase):
    def test_keys(self):
        self.assertEqual(host_of("https://Studio.Example:443/"), "studio.example")
        self.assertEqual(host_of("studio.example:8443"), "studio.example:8443")
        self.assertEqual(tracker_key("shotgrid", "https://studio.example"), "shotgrid:studio.example")
        self.assertEqual(tracker_key("shotgrid", ""), "")
        self.assertEqual(split_key("shotgrid:studio.example:8443"), ("shotgrid", "studio.example:8443"))
        for bad in ("shotgrid", "shotgrid:", ":x", "Shot:x", "shotgrid:Upper.example", "shotgrid:a b", None, 7, "s:" + "h" * 400):
            self.assertIsNone(split_key(bad), bad)

    def test_stored_hosts_and_valid_sites(self):
        from app.shotgrid import valid_site
        from app.trackers import host_norm, tracker_key_of_host
        # a host stored without its scheme (a link's site, sg_site): its port is kept — http://localhost:443 is
        # "localhost:443" in URL.host, and the configured site gives the same key
        self.assertEqual(tracker_key_of_host("shotgrid", "localhost:443"), tracker_key("shotgrid", "http://localhost:443"))
        self.assertEqual(tracker_key_of_host("shotgrid", "Studio.Example"), tracker_key("shotgrid", "https://studio.example"))
        self.assertEqual(host_norm("[0:0:0:0:0:0:0:1]:5000"), "[::1]:5000")
        for bad in ("", "a/b", "a b", "h?x", "u@h", None):
            self.assertEqual(host_norm(bad), "", bad)
        # a site spelt so that the browser's URL.host would differ is refused (the key must be the same everywhere)
        for bad in ("http://[0:0:0:0:0:0:0:1]:5000", "https://0x7f.1", "https://127.1", "https://%41.example", "https://bücher.example"):
            self.assertFalse(valid_site(bad), bad)
        for ok in ("https://studio.example", "https://xn--bcher-kva.example", "http://127.0.0.1:8080", "http://[::1]:5000", "https://Up.Example"):
            self.assertTrue(valid_site(ok), ok)

    def test_same_rule_in_js(self):
        if not NODE:
            self.skipTest("node is not available")
        js = ("const T = require(process.argv[1]); const sites = JSON.parse(process.argv[2]);"
              "console.log(JSON.stringify(sites.map((s) => [T.hostOf(s), T.key('shotgrid', s), T.split(T.key('shotgrid', s))])));")
        r = subprocess.run([NODE, "-e", js, str(ROOT / "app" / "static" / "trackers-core.js"), json.dumps(SITES)],
                           capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        got = json.loads(r.stdout)
        for s, (h, k, sp) in zip(SITES, got):
            self.assertEqual(h, host_of(s), s)
            self.assertEqual(k, tracker_key("shotgrid", s), s)
            want = split_key(k)
            self.assertEqual(sp, {"kind": want[0], "host": want[1]} if want else None, s)

    def test_js_adapter_interface(self):
        # the ShotGrid adapter registers itself and has every member trackers-core.js lists (whatever the load order)
        if not NODE:
            self.skipTest("node is not available")
        doc = (ROOT / "app" / "static" / "trackers-core.js").read_text(encoding="utf-8")
        js = ("require(process.argv[2]); const T = require(process.argv[1]); const A = T.adapter('shotgrid');"
              "console.log(JSON.stringify({kinds: T.kinds(), keys: A ? Object.keys(A) : [], viaEntry: !!T.adapterOf({id: 'shotgrid'}),"
              " none: T.adapter('nope'), store: A.storeKey('fields')}));")
        r = subprocess.run([NODE, "-e", js, str(ROOT / "app" / "static" / "trackers-core.js"), str(ROOT / "app" / "static" / "shotgrid-core.js")],
                           capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        got = json.loads(r.stdout)
        self.assertEqual(got["kinds"], [{"id": "shotgrid", "name": "ShotGrid"}])
        self.assertTrue(got["viaEntry"])
        self.assertIsNone(got["none"])
        self.assertEqual(got["store"], "sight.sg.fields", "ShotGrid keeps its pre-0.107 setting names")
        want = ["id", "name", "short", "media", "entityTypes", "statusField", "defaultTileFields", "serverClient", "projects",
                "entities", "mediaFields", "filterFields", "toConditions", "browse", "recordId", "recordName", "recordStamp",
                "recordTime", "isVideo", "hasFilmstrip", "filmstripFrames", "filmstripCss", "fmtField", "hiddenDetailFields",
                "findMedia", "loadLink", "linkOf", "linkId", "linkLabel", "linkProject", "linkedIdOf", "sync", "storeKey",
                "recordSub", "settings", "deviceClient", "deviceHint", "deviceNote", "pictureUrl", "mediaSource", "download"]
        for k in want:
            self.assertIn(k, got["keys"])
            self.assertIn(k, doc, f"{k} is documented in trackers-core.js")

    def test_js_settings_form(self):
        # the declarative settings form (stage 5b-2): the fields each app renders, connected = the required ones, the
        # Disconnect body = the stored settings with the secret cleared (as the hand-written forms sent), a key lost
        # with another site, the phone's pre-0.108 storage names kept, the device-side members
        if not NODE:
            self.skipTest("node is not available")
        js = r"""
require(process.argv[2]); const T = require(process.argv[1]); const A = T.adapter('shotgrid');
const st = {configured: true, site: 'https://s.example', script: 'sight', hasKey: true, sudo: true, logins: {Ann: 'ann'},
  statusMap: {open: 'o'}, cacheLimitGB: 5, cacheDir: '/x', ident: 'x'};
const v = {id: 7, code: 'sh010', image: 'https://i/7.jpg', filmstrip_image: null, entity: {name: 'sh010'},
  sg_uploaded_movie: {url: 'https://m/7.mov', name: 'sh010.mov', content_type: 'video/quicktime'}};
console.log(JSON.stringify({
  sight: T.formFields(A, 'sight').map((f) => [f.name, f.type, f.part || '']),
  phone: T.formFields(A, 'phone').map((f) => f.name),
  ready: [T.formReady(A, {site: 'a', script: 'b', key: 'c'}), T.formReady(A, {site: 'a', script: 'b', key: ''})],
  stored: T.formStored(A, 'sight', st), storedEmpty: T.formStored(A, 'sight', {site: 'https://s.example'}),
  lost: [T.secretLost(A, 'sight', st, {...st, hasKey: false, site: 'https://t.example'}), T.secretLost(A, 'sight', st, {...st, hasKey: false})],
  keys: ['connection', 'filter', 'fields', 'where', 'project', 'thumbs', 'thumb'].map((n) => A.storeKey(n, 'phone')),
  clean: A.settings.fields[0].clean('studio.example/api/v1.1'),
  pic: [A.pictureUrl(v, 'image'), A.pictureUrl(v, 'filmstrip')], media: [A.mediaSource(v), A.mediaSource(v, {still: true})],
  sub: A.recordSub(v), note: [A.deviceNote({sudo: true}), A.deviceNote({})],
  hint: [A.deviceHint(new TypeError('x'), {}), A.deviceHint(new TypeError('x'), {proxy: 'p'}), A.deviceHint(new Error('x'), {})],
  via: A.deviceClient({site: 's.example', script: 'a', key: 'b', proxy: 'https://p.example'}).host,
}));"""
        r = subprocess.run([NODE, "-e", js, str(ROOT / "app" / "static" / "trackers-core.js"), str(ROOT / "app" / "static" / "shotgrid-core.js")],
                           capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        got = json.loads(r.stdout)
        self.assertEqual(got["sight"], [["site", "text", ""], ["script", "text", ""], ["key", "secret", ""], ["sudo", "checkbox", ""],
                                        ["logins", "pairs", ""], ["statusMap", "custom", ""], ["cacheLimitGB", "number", "cache"]])
        self.assertEqual(got["phone"], ["site", "script", "key", "proxy", "sudo", "logins", "statusMap"])
        self.assertEqual(got["ready"], [True, False])
        self.assertEqual(got["stored"], {"site": "https://s.example", "script": "sight", "key": "", "sudo": True, "logins": {"Ann": "ann"},
                                         "statusMap": {"open": "o"}, "cacheLimitGB": 5})
        self.assertEqual(got["storedEmpty"], {"site": "https://s.example", "script": "", "key": "", "sudo": False, "logins": {},
                                              "statusMap": {}, "cacheLimitGB": 0})
        self.assertEqual(got["lost"], [True, False])
        self.assertEqual(got["keys"], ["sight-review:sg", "sight-review:sgfilter", "sight-review:sgfields", "sight-review:sgwhere",
                                       "sight-review:sg.project", "sight-review-sgthumbs", "https://sg-thumb.invalid/"])
        self.assertEqual(got["clean"], "https://studio.example")
        self.assertEqual(got["pic"], ["https://i/7.jpg", None])
        self.assertEqual(got["media"], [{"url": "https://m/7.mov", "name": "sh010.mov", "type": "video/quicktime"},
                                        {"url": "https://i/7.jpg", "name": "sh010.jpg", "type": "image/jpeg"}])
        self.assertEqual((got["sub"], got["note"]), ("sh010", ["as reviewer", ""]))
        self.assertTrue(got["hint"][0].startswith(" — the site may not answer"))
        self.assertEqual(got["hint"][1:], ["", ""])
        self.assertEqual(got["via"], "s.example")


class JsSitesTest(unittest.TestCase):
    def test_site_labels_and_per_site_names(self):
        # several sites of one kind (0.110): a site named only beside another of its kind; per-site setting names
        # "<the kind's name>@<host>", read falling back to the per-kind name kept before 0.110
        if not NODE:
            self.skipTest("node is not available")
        js = r"""
require(process.argv[2]); const T = require(process.argv[1]); const A = T.adapter('shotgrid');
const a = {kind: 'shotgrid', key: 'shotgrid:a.example', host: 'a.example'}, b = {kind: 'shotgrid', key: 'shotgrid:b.example', host: 'b.example'};
const c = {kind: 'shotgrid', key: 'shotgrid:a.other', host: 'a.other'}, x = {kind: 'ftrack', key: 'ftrack:z.example', host: 'z.example'};
const store = {'sight.sg.fields': 'old', 'sight.sg.fields@b.example': 'mine'}, get = (k) => k in store ? store[k] : null;
console.log(JSON.stringify({
  labels: [T.siteLabel(a, [a]), T.siteLabel(a, [a, x]), T.siteLabel(a, [a, b]), T.siteLabel(a, [a, c]), T.siteLabel({kind: 's', key: 's:127.0.0.1:9', host: '127.0.0.1:9'}, [{kind: 's', key: 's:x'}])],
  names: [T.storeName(A, 'fields', undefined, 'b.example'), T.storeName(A, 'filter', 'phone', 'b.example'), T.storeName(A, 'fields')],
  reads: [T.readStored(get, A, 'fields', undefined, 'a.example'), T.readStored(get, A, 'fields', undefined, 'b.example'), T.readStored(get, A, 'where', undefined, 'b.example')],
  desktop: (() => { const st = {'sight.sg.fields': 'old'}, g = (k) => k in st ? st[k] : null, s = (k, v) => { st[k] = v; };
    const twoFirst = T.claimLegacy(g, s, A, undefined, ['a.example', 'b.example']);   // (two at once: no owner)
    const claimed = T.claimLegacy(g, s, A, undefined, ['a.example']);                 // (the first launch after the upgrade)
    const b = T.readStored(g, A, 'fields', undefined, 'b.example');                   // (site B opened before A's project)
    const a = T.readStored(g, A, 'fields', undefined, 'a.example');
    return {twoFirst, claimed, b, a, kept: T.claimLegacy(g, s, A, undefined, ['b.example'])}; })(),
  phone: (() => { const st = {'sight-review:sg': JSON.stringify({site: 'https://A.example', key: 'k'}), 'sight-review:sgfilter': 'old-phone'},
    g = (k) => k in st ? st[k] : null, s = (k, v) => { st[k] = v; };
    const owner = T.claimLegacy(g, s, A, 'phone', [T.legacyConnectionHost(g, A)]);
    return {owner, bFirst: T.readStored(g, A, 'filter', 'phone', 'b.example'), a: T.readStored(g, A, 'filter', 'phone', 'a.example'),
      none: T.legacyConnectionHost(() => null, A) || null}; })(),
}));"""
        r = subprocess.run([NODE, "-e", js, str(ROOT / "app" / "static" / "trackers-core.js"), str(ROOT / "app" / "static" / "shotgrid-core.js")],
                           capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        got = json.loads(r.stdout)
        self.assertEqual(got["labels"], ["", "", "a", "a.example", "127.0.0.1:9"])
        self.assertEqual(got["names"], ["sight.sg.fields@b.example", "sight-review:sgfilter@b.example", "sight.sg.fields"])
        # no owner recorded: no fallback; claimLegacy records one only from exactly one host, never by reading order
        self.assertEqual(got["reads"], [None, "mine", None])
        self.assertEqual(got["desktop"], {"twoFirst": None, "claimed": "a.example", "b": None, "a": "old", "kept": "a.example"},
                         "Sight: claimed while one site was connected; site B added later (and opened first) gets nothing")
        self.assertEqual(got["phone"], {"owner": "a.example", "bFirst": None, "a": "old-phone", "none": None},
                         "the phone: the old single connection's host owns the old values, whatever opens first")


class RegistryTest(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = Path(tempfile.mkdtemp(prefix="sight-trk-"))

    def tearDown(self) -> None:
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_old_non_canonical_site_still_saves(self):
        # a site saved before 0.107 in a spelling valid_site now refuses: a logins save / Disconnect (which send the
        # stored site back) rewrite it to the browser's spelling instead of failing; the key stays with it
        sg = ShotGridService(self.dir)
        for old, canon in (("https://[0:0:0:0:0:0:0:1]", "https://[::1]"), ("https://0x7f.1:8443", "https://127.0.0.1:8443"),
                           ("https://%41.Example", "https://a.example")):
            (self.dir / "shotgrid.json").write_text(json.dumps({"site": old, "script": "s", "key": "k"}), encoding="utf-8")
            self.assertTrue(sg.configure({"site": old, "script": "s", "logins": {"Ann": "ann"}}), old)
            st = sg.status()
            self.assertEqual((st["site"], st["hasKey"], st["logins"]), (canon, True, {"Ann": "ann"}), old)
            self.assertTrue(sg.configure({"site": old, "script": "s", "key": ""}), "Disconnect: " + old)
            self.assertEqual((sg.status()["site"], sg.status()["hasKey"]), (canon, False))
            self.assertEqual(sg.tracker(), None)

    def test_registry(self):
        t = Trackers(self.dir)
        self.assertEqual(t.kinds, [{"id": "shotgrid", "name": "ShotGrid"}, {"id": "coreline", "name": "Coreline"}])   # (Coreline: 0.135)
        self.assertIsInstance(t.get("shotgrid"), ShotGridService)
        self.assertIsNone(t.get("ftrack"))
        self.assertEqual((t.connected(), t.key_of("shotgrid")), ([], ""))
        t.get("shotgrid").configure({"site": "Studio.Example", "script": "s"})
        self.assertEqual((t.connected(), t.key_of("shotgrid")), ([], "shotgrid:studio.example"), "a key without a connection")
        t.get("shotgrid").configure({"site": "Studio.Example", "script": "s", "key": "k", "sudo": True})
        self.assertEqual([(e["key"], e["note"]) for e in t.connected()], [("shotgrid:studio.example", "as reviewer")])
        with self.assertRaises(Exception):
            t.get("shotgrid").parse_media_id("12x")
        self.assertEqual(t.get("shotgrid").parse_media_id("12"), 12)


class SeveralSitesTest(unittest.TestCase):
    """Several sites of one kind (0.110, docs/PLAN-trackers.md 5b-2 (4)): one settings file per site, the pre-0.110
    shotgrid.json read as the first one; routes by tracker key; the kind alias = the primary site."""
    def setUp(self) -> None:
        self.dir = Path(tempfile.mkdtemp(prefix="sight-trk2-"))

    def tearDown(self) -> None:
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_single_config_becomes_the_first_site(self):
        old = {"site": "https://one.example", "script": "s", "key": "k1", "logins": {"Ann": "ann"}, "cacheLimitGB": 3}
        (self.dir / "shotgrid.json").write_text(json.dumps(old), encoding="utf-8")
        t = Trackers(self.dir)
        self.assertEqual([e["key"] for e in t.connected()], ["shotgrid:one.example"], "the old file is the first site, key kept")
        self.assertIs(t.get("shotgrid"), t.by_key("shotgrid:one.example"))
        # Connect a tracker… with one site connected: a new slot; the same site again is refused
        sp = t.spare("shotgrid")
        self.assertEqual((sp.slot, sp.stored()), (2, False))
        with self.assertRaises(TrackerError) as e:
            t.configure(sp, {"site": "one.example", "script": "s", "key": "k"})
        self.assertEqual(e.exception.status, 409)
        self.assertFalse(sp.stored())
        self.assertTrue(t.configure(sp, {"site": "two.example", "script": "s2", "key": "k2"}))
        self.assertEqual([e["key"] for e in t.connected()], ["shotgrid:one.example", "shotgrid:two.example"])
        self.assertEqual(json.loads((self.dir / "shotgrid.json").read_text()), old, "the first site's file untouched")
        self.assertEqual(json.loads((self.dir / "shotgrid-2.json").read_text())["key"], "k2")
        # a second registry (a restart) reads both
        t2 = Trackers(self.dir)
        self.assertEqual([e["key"] for e in t2.connected()], ["shotgrid:one.example", "shotgrid:two.example"])
        # changing site 2 to site 1's: refused; disconnect site 1: the alias moves to site 2, site 1 is the spare
        with self.assertRaises(TrackerError):
            t.configure(t.by_key("shotgrid:two.example"), {"site": "one.example", "script": "s2"})
        one = t.by_key("shotgrid:one.example")
        t.configure(one, {"site": "https://one.example", "script": "s", "key": "", "logins": {"Ann": "ann"}})
        self.assertEqual(t.key_of("shotgrid"), "shotgrid:two.example", "the primary = the first connected")
        self.assertIs(t.spare("shotgrid"), one, "Connect a tracker… sets up the kept site again")
        # site 2 takes site 1's (not connected) site: site 1's leftover settings go, no two slots of one site — and the
        # survivor moves into shotgrid.json (the file an older Sight reads)
        got = t.configure(t.by_key("shotgrid:two.example"), {"site": "one.example", "script": "s2", "key": "k2"})
        self.assertEqual((got.slot, ShotGridService.slots(self.dir)), (1, [1]))
        self.assertEqual(json.loads((self.dir / "shotgrid.json").read_text())["script"], "s2")
        self.assertEqual([e["key"] for e in t.connected()], ["shotgrid:one.example"])
        self.assertEqual(t.by_key("shotgrid:one.example").slot, 1)
        # a site past the first saved without a site: refused (it could never be addressed again), nothing stored
        sp = t.spare("shotgrid")
        with self.assertRaises(TrackerError) as e:
            t.configure(sp, {"site": "", "script": "s3", "key": "k3"})
        self.assertEqual((e.exception.status, sp.stored()), (400, False))
        # the pinned spare slot: a connected one by now is refused
        with self.assertRaises(TrackerError) as e:
            t.spare("shotgrid", 1)
        self.assertEqual(e.exception.status, 409)
        self.assertEqual(t.spare("shotgrid", 2).slot, 2)

    def test_by_key_prefers_the_connected_slot(self):
        (self.dir / "shotgrid.json").write_text(json.dumps({"site": "https://one.example", "script": "s"}), encoding="utf-8")
        (self.dir / "shotgrid-2.json").write_text(json.dumps({"site": "https://one.example", "script": "s", "key": "k"}), encoding="utf-8")
        self.assertEqual(Trackers(self.dir).by_key("shotgrid:one.example").slot, 2)

    def test_takeover_that_cannot_move_the_file(self):
        # slot 1 (not connected) has site A, slot 2 saves A, but the file cannot be moved (held open on Windows): one
        # entry for the site all the same, no error
        from unittest import mock
        (self.dir / "shotgrid.json").write_text(json.dumps({"site": "https://one.example", "script": "s"}), encoding="utf-8")
        t = Trackers(self.dir)
        sp = t.spare("shotgrid", 2)
        real = os.replace

        def replace(src, dst):   # (only the move of slot 2's file onto shotgrid.json fails)
            if Path(src).name == "shotgrid-2.json":
                raise PermissionError("in use")
            return real(src, dst)
        with mock.patch("app.shotgrid.os.replace", side_effect=replace):
            got = t.configure(sp, {"site": "one.example", "script": "s2", "key": "k"})
        self.assertEqual((got.slot, ShotGridService.slots(self.dir)), (2, [2]))
        self.assertEqual([e["key"] for e in t.connected()], ["shotgrid:one.example"])

    def test_cache_per_site(self):
        t = Trackers(self.dir)
        a, b = t.spare("shotgrid"), None
        t.configure(a, {"site": "one.example", "script": "s", "key": "k"})
        b = t.spare("shotgrid")
        t.configure(b, {"site": "two.example:8443", "script": "s", "key": "k"})
        for site, name in ((a, "x.mp4"), (b, "y.mp4")):
            site.cache_dir().mkdir(parents=True, exist_ok=True)
            (site.cache_dir() / name).write_bytes(b"1234")
        (a.media_dir() / "gone.example").mkdir()
        (a.media_dir() / "gone.example" / "z.mp4").write_bytes(b"12")
        self.assertEqual((a.cache_info()["files"], b.cache_info()["files"]), (1, 1))
        self.assertEqual(sorted(p.name for p in t.idle_cache("shotgrid")), ["z.mp4"], "files of no connected site")
        self.assertEqual(b.clear_cache(), 1)
        self.assertTrue((a.cache_dir() / "x.mp4").exists(), "Clear cache of one site leaves the other's")
        t.configure(a, {"site": "one.example", "script": "s", "key": ""})
        self.assertEqual(sorted(p.name for p in t.idle_cache("shotgrid")), ["x.mp4", "z.mp4"])


class MigrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="sight-trkmig-"))
        self.home = self.tmp / "home"

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _old_db(self) -> None:
        """A library as Sight 0.106 left it: ShotGrid links in sg_links, ShotGrid smart collections in sg_site /
        sg_project, no tracker columns, no tracker_links table."""
        lib = Library(self.home)
        insert_asset(lib, "a1")
        insert_asset(lib, "a2")
        lib.close()
        c = sqlite3.connect(self.home / "library.db")
        c.execute("DROP TABLE tracker_links")
        c.execute("DELETE FROM meta WHERE key='tracker_links_from_sg'")
        try:
            c.execute("ALTER TABLE collections DROP COLUMN tracker")
            c.execute("ALTER TABLE collections DROP COLUMN tracker_project")
        except sqlite3.OperationalError:   # (SQLite < 3.35: the columns stay, empty — the same migration path)
            c.execute("UPDATE collections SET tracker=NULL, tracker_project=NULL")
        link = {"site": "studio.example", "project": {"id": 70, "name": "Demo"}, "version": {"id": 78, "code": "sh020"},
                "task": None, "entity": None, "firstFrame": 1001}
        c.execute("INSERT INTO sg_links(asset_id, link, state, updated_at) VALUES (?,?,?,?)",
                  ("a1", json.dumps(link), json.dumps({"last": 5}), 9))
        c.execute("INSERT INTO sg_links(asset_id, link, state, updated_at) VALUES (?,?,?,?)", ("a2", "{broken", "{}", 9))
        c.execute("INSERT INTO sg_links(asset_id, link, state, updated_at) VALUES (?,?,?,?)",
                  ("a3", json.dumps(dict(link, site="localhost:443")), "{}", 9))   # (a site http://localhost:443)
        c.execute("INSERT INTO collections(id, name, created_at, sort_order, rule, sg_site, sg_project) VALUES (?,?,?,?,?,?,?)",
                  ("c1", "Approved", 1, 0, json.dumps({"op": "and", "c": []}), "studio.example", 70))
        c.execute("INSERT INTO collections(id, name, created_at, sort_order) VALUES (?,?,?,?)", ("c2", "Plain", 2, 1))
        c.commit()
        c.close()

    def test_migrates_links_and_smart_collections(self):
        self._old_db()
        lib = Library(self.home)
        try:
            got = lib.get_tracker_link("a1", "shotgrid:studio.example")
            self.assertEqual((got["link"]["version"]["code"], got["state"], got["updated_at"]), ("sh020", {"last": 5}, 9))
            self.assertIsNone(lib.get_tracker_link("a2", "shotgrid:studio.example"), "an unreadable old link is left behind")
            self.assertIsNotNone(lib.get_tracker_link("a3", tracker_key("shotgrid", "http://localhost:443")), "its port kept, no scheme guessed")
            by = {c["id"]: c for c in lib.collections()}
            self.assertEqual((by["c1"]["tracker"], by["c1"]["trackerProject"], by["c1"]["sgSite"], by["c1"]["sgProject"]),
                             ("shotgrid:studio.example", "70", "studio.example", 70))
            self.assertEqual((by["c2"]["tracker"], by["c2"]["trackerProject"]), (None, None))
            # a link dropped after the migration does not come back from the old table on the next launch
            lib.drop_tracker_link("a1", "shotgrid:studio.example")
            self.assertEqual(len(lib.query("SELECT * FROM sg_links")), 3, "the old table is left as it was (an older Sight reads it)")
        finally:
            lib.close()
        lib = Library(self.home)
        try:
            self.assertIsNone(lib.get_tracker_link("a1", "shotgrid:studio.example"))
        finally:
            lib.close()

    def test_links_per_tracker(self):
        lib = Library(self.home)
        try:
            insert_asset(lib, "a1")
            lib.set_tracker_link("a1", "shotgrid:one.example", {"site": "one.example", "version": {"id": 1}})
            lib.set_tracker_link("a1", "ftrack:two.example", {"site": "two.example", "version": {"id": 2}}, {"last": 3})
            lib.set_tracker_link("a1", "shotgrid:one.example", None, {"last": 4})
            self.assertEqual(lib.get_tracker_link("a1", "shotgrid:one.example")["state"], {"last": 4})
            self.assertEqual(lib.get_tracker_link("a1", "ftrack:two.example")["link"]["version"]["id"], 2)
            lib.set_tracker_link("a1", "shotgrid:one.example", {"site": "one.example", "version": {"id": 9}})
            self.assertEqual(lib.get_tracker_link("a1", "shotgrid:one.example")["state"], {}, "a new link starts a fresh state")
            lib.drop_tracker_link("a1", "shotgrid:one.example")
            self.assertIsNone(lib.get_tracker_link("a1", "shotgrid:one.example"))
            self.assertIsNotNone(lib.get_tracker_link("a1", "ftrack:two.example"), "the other tracker's link stays")
        finally:
            lib.close()

    def test_smart_collection_keys(self):
        lib = Library(self.home)
        try:
            rule = {"op": "and", "c": []}
            other = lib.add_collection("F", None, rule, "ftrack:two.example", "a1b2-c3")
            self.assertEqual((other["tracker"], other["trackerProject"], other["sgSite"]), ("ftrack:two.example", "a1b2-c3", None))
            sg = lib.add_collection("S", None, rule, "shotgrid:one.example", 70)
            self.assertEqual((sg["trackerProject"], sg["sgSite"], sg["sgProject"]), ("70", "one.example", 70))
            for key, proj in (("one.example", 70), ("shotgrid:one.example", None), ("shotgrid:one.example", "x7"),
                              ("shotgrid:one.example", True), ("ftrack:x", " pad"), ("ftrack:x", "")):
                with self.assertRaises(ValueError, msg=(key, proj)):
                    lib.add_collection("bad", None, rule, key, proj)
            plain = lib.add_collection("P", None, None, "shotgrid:one.example", 70)
            self.assertIsNone(plain["tracker"], "no rule: a plain collection, the tracker is dropped")
            lib.move_collection(sg["id"], plain["id"])
            self.assertIsNone({c["id"]: c for c in lib.collections()}[sg["id"]]["parentId"], "a tracker one stays at the top")
        finally:
            lib.close()


class RoutesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        try:
            from starlette.testclient import TestClient
            from app.server import build_app
        except Exception as e:  # noqa: BLE001
            raise unittest.SkipTest(f"no test client: {e}")
        cls.tmp = Path(tempfile.mkdtemp(prefix="sight-trkhttp-"))
        cls.lib = Library(cls.tmp / "home")
        insert_asset(cls.lib, "a1")
        ShotGridService(cls.lib.root).configure({"site": "https://studio.example", "script": "s", "key": "secret"})
        cls.c = TestClient(build_app(cls.lib), base_url="http://127.0.0.1")

    @classmethod
    def tearDownClass(cls) -> None:
        cls.lib.close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_list_and_status(self):
        got = self.c.get("/api/trackers").json()
        self.assertEqual([(t["id"], t["kind"], t["key"]) for t in got["trackers"]], [("shotgrid", "shotgrid", "shotgrid:studio.example")])
        self.assertEqual(got["kinds"], [{"id": "shotgrid", "name": "ShotGrid"}, {"id": "coreline", "name": "Coreline"}])   # (Coreline: 0.135)
        self.assertIsInstance(got["cacheSources"], list)
        self.assertNotIn("secret", json.dumps(got))
        a, b = self.c.get("/api/trackers/shotgrid/status").json(), self.c.get("/api/sg/status").json()
        self.assertEqual(a, b, "the alias answers the same")
        self.assertEqual((a["key"], a["configured"]), ("shotgrid:studio.example", True))
        for path in ("/api/trackers/nope/status", "/api/trackers/nope/cache", "/api/trackers/nope/link/a1"):
            self.assertEqual(self.c.get(path).status_code, 404, path)
        self.assertEqual(self.c.get("/api/trackers/shotgrid/thumb/abc").status_code, 404, "not a Version id")
        self.assertEqual(self.c.get("/api/trackers/shotgrid/fetch?url=x").status_code, 403, "Sight's page only")

    def test_links_by_site(self):
        X = {"X-Sight": "1"}
        link = {"site": "studio.example", "version": {"id": 78, "code": "sh020"}}
        self.assertEqual(self.c.put("/api/trackers/shotgrid/link/a1", json={"link": link}, headers=X).status_code, 200)
        self.assertEqual(self.c.get("/api/sg/link/a1").json()["link"]["version"]["code"], "sh020", "the alias reads the same row")
        self.assertEqual(self.c.put("/api/sg/link/a1", json={"state": {"last": 1}}, headers=X).status_code, 200)
        self.assertEqual(self.c.get("/api/trackers/shotgrid/link/a1").json()["state"], {"last": 1})
        self.assertEqual(self.c.put("/api/trackers/shotgrid/link/a1", json={"link": link}).status_code, 403, "header needed")
        self.assertEqual(self.c.put("/api/trackers/shotgrid/link/nope", json={"link": link}, headers=X).status_code, 404)
        # another site: its own (empty) link; back: the first one again
        svc = ShotGridService(self.lib.root)
        try:
            svc.configure({"site": "https://other.example", "script": "s", "key": "k"})
            self.assertIsNone(self.c.get("/api/trackers/shotgrid/link/a1").json()["link"])
        finally:
            svc.configure({"site": "https://studio.example", "script": "s", "key": "secret"})
        self.assertEqual(self.c.get("/api/trackers/shotgrid/link/a1").json()["link"]["version"]["id"], 78)
        self.assertEqual(self.c.delete("/api/trackers/shotgrid/link/a1", headers=X).status_code, 200)
        self.assertIsNone(self.c.get("/api/sg/link/a1").json()["link"])

    def test_two_sites_by_key(self):
        X = {"X-Sight": "1"}
        r = self.c.get("/api/trackers/shotgrid/status?spare=1").json()
        self.assertEqual((r["key"], r["configured"], r["site"]), ("", False, ""), "the spare site: a new one (the only one is connected)")
        self.assertEqual(self.c.put("/api/trackers/shotgrid/config?spare=1", json={"site": "https://studio.example", "script": "s", "key": "x"}).status_code,
                         409, "the same site again")
        r = self.c.put("/api/trackers/shotgrid/config?spare=1", json={"site": "https://other.example", "script": "s", "key": "k2"})
        self.assertEqual((r.status_code, r.json()["key"], r.json()["configured"]), (200, "shotgrid:other.example", True))
        try:
            got = self.c.get("/api/trackers").json()
            self.assertEqual([t["key"] for t in got["trackers"]], ["shotgrid:studio.example", "shotgrid:other.example"])
            self.assertNotIn("k2", json.dumps(got))
            self.assertEqual(self.c.get("/api/trackers/shotgrid%3Aother.example/status").json()["site"], "https://other.example")
            self.assertEqual(self.c.get("/api/sg/status").json()["key"], "shotgrid:studio.example", "the alias = the first site")
            self.assertEqual(self.c.get("/api/trackers/shotgrid:nope.example/status").status_code, 404)
            link = {"site": "other.example", "version": {"id": 5}}
            self.assertEqual(self.c.put("/api/trackers/shotgrid%3Aother.example/link/a1", json={"link": link}, headers=X).status_code, 200)
            self.assertIsNone(self.c.get("/api/sg/link/a1").json()["link"], "the first site has its own (none)")
            self.assertEqual(self.c.get("/api/trackers/shotgrid:other.example/link/a1").json()["link"]["version"]["id"], 5)
            self.assertEqual(self.c.get("/api/trackers/shotgrid/cache?idle=1").json(), {"used": 0, "files": 0})
            # Connect a tracker…'s block pins its spare slot: a Disconnect meanwhile does not move its save onto the
            # disconnected site's kept settings; a pinned slot connected by now is refused
            sp = self.c.get("/api/trackers/shotgrid/status?spare=1").json()
            self.assertEqual((sp["slot"], sp["key"]), (3, ""))
            self.c.put("/api/trackers/shotgrid:other.example/config", json={"site": "https://other.example", "script": "s", "key": ""})
            self.assertEqual(self.c.get("/api/trackers/shotgrid/status?spare=1").json()["slot"], 2, "unpinned: the kept site")
            r = self.c.put("/api/trackers/shotgrid/config?spare=1&slot=3", json={"site": "https://third.example", "script": "t"})
            self.assertEqual((r.status_code, r.json()["slot"], r.json()["key"]), (200, 3, "shotgrid:third.example"))
            self.assertEqual(self.c.get("/api/trackers/shotgrid:other.example/status").json()["script"], "s", "the kept site untouched")
            self.assertEqual(self.c.get("/api/trackers/shotgrid/status?spare=1&slot=1").status_code, 409)
            self.assertEqual(self.c.get("/api/trackers/shotgrid/status?spare=1&slot=%C2%B2").status_code, 200, "a non-ASCII digit is no pin")
            r = self.c.put("/api/trackers/shotgrid/config?spare=1&slot=4", json={"site": "", "script": "x"})
            self.assertEqual((r.status_code, r.json()["detail"]), (400, "The site is needed"))
            self.assertEqual(self.c.post("/api/trackers/shotgrid/cache/clear?idle=1").status_code, 403, "header needed")
        finally:
            self.c.delete("/api/trackers/shotgrid:other.example/link/a1", headers=X)
            (self.lib.root / "shotgrid-2.json").unlink(missing_ok=True)
            (self.lib.root / "shotgrid-3.json").unlink(missing_ok=True)

    def test_collections(self):
        tree = {"op": "and", "c": []}
        r = self.c.post("/api/collections", json={"name": "New", "rule": tree, "tracker": "shotgrid:studio.example", "trackerProject": 70})
        self.assertEqual((r.status_code, r.json()["tracker"], r.json()["sgSite"]), (200, "shotgrid:studio.example", "studio.example"))
        r = self.c.post("/api/collections", json={"name": "Old", "rule": tree, "sgSite": "Studio.Example", "sgProject": 71})
        self.assertEqual((r.status_code, r.json()["tracker"], r.json()["trackerProject"]), (200, "shotgrid:studio.example", "71"),
                         "the pre-0.107 form still works")
        r = self.c.post("/api/collections", json={"name": "Plain", "sgSite": "h"})
        self.assertEqual((r.status_code, r.json()["tracker"], r.json()["rule"]), (200, None, None), "no rule: a plain collection, as before")
        r = self.c.post("/api/collections", json={"name": "Port", "rule": tree, "sgSite": "localhost:443", "sgProject": 5})
        self.assertEqual(r.json()["tracker"], "shotgrid:localhost:443", "the old form's host keeps its port")
        self.assertNotIn("tracker_project", json.dumps(self.c.get("/api/collections").json()))
        for bad in ({"tracker": "nokind"}, {"tracker": "shotgrid:Upper"}, {"tracker": 7}, {"tracker": "ftrack:x", "trackerProject": [1]}):
            self.assertEqual(self.c.post("/api/collections", json={"name": "x", "rule": tree, "trackerProject": 1, **bad}).status_code, 400, bad)


if __name__ == "__main__":
    unittest.main()
