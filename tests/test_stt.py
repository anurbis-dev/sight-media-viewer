"""app/stt.py: the user's speech-to-text service config and the request sent to it (urlopen mocked — no network)."""

import io
import json
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

from app.stt import SttError, SttService

URL = "http://localhost:8000/v1/audio/transcriptions"


class FakeResp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class SttTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.stt = SttService(self.dir)

    def test_config_store(self):
        self.assertFalse(self.stt.status()["configured"])
        self.assertFalse(self.stt.configure({"url": "ftp://x/y"}))
        self.assertFalse(self.stt.configure({"url": "http://user:pw@host/x"}))
        self.assertFalse(self.stt.configure({"url": URL, "key": "has space"}))
        self.assertFalse(self.stt.configure({"url": URL, "model": "bad model!"}))
        self.assertFalse(self.stt.configure({"url": 5}))
        for bad in ("http://a b/x", "http://h:abc/x", "http://h:99999/x", "http://h/\u00e9"):
            self.assertFalse(self.stt.configure({"url": bad}), bad)
        self.assertTrue(self.stt.configure({"url": URL, "model": "Systran/faster-whisper-small", "key": " sk-abc "}))
        st = self.stt.status()
        self.assertEqual((st["configured"], st["url"], st["model"], st["hasKey"]), (True, URL, "Systran/faster-whisper-small", True))
        self.assertNotIn("sk-abc", json.dumps(st))
        self.assertEqual(json.loads((self.dir / "stt.json").read_text())["key"], "sk-abc")
        # No "key": kept while the URL stays; a new URL drops it (the key never follows the address elsewhere).
        self.assertTrue(self.stt.configure({"url": URL, "model": "m"}))
        self.assertTrue(self.stt.status()["hasKey"])
        self.assertTrue(self.stt.configure({"url": "https://evil.example/v1/audio/transcriptions"}))
        self.assertFalse(self.stt.status()["hasKey"])
        self.assertTrue(self.stt.configure({"url": URL, "key": "k2"}))
        self.assertTrue(self.stt.configure({"url": URL, "key": ""}))
        self.assertFalse(self.stt.status()["hasKey"])
        self.assertTrue(self.stt.configure({"url": "", "key": "orphan"}))
        self.assertFalse(self.stt.status()["hasKey"])
        self.assertTrue(self.stt.configure({"url": ""}))
        self.assertFalse((self.dir / "stt.json").exists())

    def test_old_groq_file_removed(self):
        (self.dir / "stt.json").write_text(json.dumps({"groq_key": "gsk_old"}))
        self.assertFalse(self.stt.status()["configured"])
        self.assertFalse((self.dir / "stt.json").exists())

    def test_proxy_bypass_for_local(self):
        from app import stt
        self.assertIs(stt._opener_for(URL), stt._DIRECT)
        self.assertIs(stt._opener_for("http://[::1]:8000/x"), stt._DIRECT)
        self.assertIs(stt._opener_for("https://api.openai.com/v1/audio/transcriptions"), stt._OPENER)

    def test_not_set(self):
        with self.assertRaises(SttError) as cm:
            self.stt.transcribe(b"x" * 100, "audio/webm")
        self.assertEqual(cm.exception.code, "not-set")

    def test_request(self):
        self.stt.configure({"url": URL, "key": "sk-k", "model": "whisper-large-v3-turbo"})
        seen = {}

        def fake(req, timeout):
            seen["url"] = req.full_url
            seen["auth"] = req.get_header("Authorization")
            seen["body"] = req.data
            return FakeResp(json.dumps({"text": " привет мир "}).encode())

        with mock.patch("app.stt._DIRECT.open", fake):
            self.assertEqual(self.stt.transcribe(b"AUDIO", "audio/webm;codecs=opus", ""), "привет мир")
        self.assertEqual((seen["url"], seen["auth"]), (URL, "Bearer sk-k"))
        self.assertIn(b'name="model"\r\n\r\nwhisper-large-v3-turbo\r\n', seen["body"])
        self.assertNotIn(b'name="language"', seen["body"])   # none: the service detects it
        self.assertIn(b"AUDIO", seen["body"])
        with mock.patch("app.stt._DIRECT.open", fake):
            self.stt.transcribe(b"AUDIO", "audio/webm", "ru-RU")
        self.assertIn(b'name="language"\r\n\r\nru\r\n', seen["body"])
        # No key, no model: no Authorization header, the default model.
        self.stt.configure({"url": URL, "key": ""})
        with mock.patch("app.stt._DIRECT.open", fake):
            self.stt.transcribe(b"AUDIO", "audio/webm")
        self.assertIsNone(seen["auth"])
        self.assertIn(b'name="model"\r\n\r\nwhisper-1\r\n', seen["body"])

    def test_errors(self):
        self.stt.configure({"url": URL})
        for status, code in ((401, "bad-key"), (429, "rate"), (500, "failed")):
            def fake(req, timeout, status=status):
                raise urllib.error.HTTPError(req.full_url, status, "x", {}, None)
            with mock.patch("app.stt._DIRECT.open", fake), self.assertRaises(SttError) as cm:
                self.stt.transcribe(b"A", "audio/webm")
            self.assertEqual(cm.exception.code, code)

        def down(req, timeout):
            raise urllib.error.URLError("refused")
        with mock.patch("app.stt._DIRECT.open", down), self.assertRaises(SttError) as cm:
            self.stt.transcribe(b"A", "audio/webm")
        self.assertEqual(cm.exception.code, "offline")


if __name__ == "__main__":
    unittest.main()
