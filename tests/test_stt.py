"""app/stt.py: the Groq key store and the request sent to Groq (urlopen mocked — no network)."""

import io
import json
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

from app.stt import GroqStt, SttError


class FakeResp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class SttTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.stt = GroqStt(self.dir)

    def test_key_store(self):
        self.assertFalse(self.stt.status()["configured"])
        self.assertFalse(self.stt.set_key("not a key!"))
        self.assertFalse(self.stt.set_key(123))
        self.assertTrue(self.stt.set_key("  gsk_abc-123  "))
        self.assertTrue(self.stt.status()["configured"])
        self.assertEqual(json.loads((self.dir / "stt.json").read_text())["groq_key"], "gsk_abc-123")
        self.assertNotIn("groq_key", json.dumps(self.stt.status()))
        self.assertTrue(self.stt.set_key(""))
        self.assertFalse((self.dir / "stt.json").exists())

    def test_no_key(self):
        with self.assertRaises(SttError) as cm:
            self.stt.transcribe(b"x" * 100, "audio/webm")
        self.assertEqual(cm.exception.code, "no-key")

    def test_request_auto_language(self):
        self.stt.set_key("gsk_k")
        seen = {}

        def fake(req, timeout):
            seen["auth"] = req.get_header("Authorization")
            seen["body"] = req.data
            return FakeResp(json.dumps({"text": " привет мир "}).encode())

        with mock.patch("app.stt._OPENER.open", fake):
            self.assertEqual(self.stt.transcribe(b"AUDIO", "audio/webm;codecs=opus", ""), "привет мир")
        self.assertEqual(seen["auth"], "Bearer gsk_k")
        self.assertIn(b'name="model"', seen["body"])
        self.assertNotIn(b'name="language"', seen["body"])   # none: Whisper detects it
        self.assertIn(b"AUDIO", seen["body"])
        with mock.patch("app.stt._OPENER.open", fake):
            self.stt.transcribe(b"AUDIO", "audio/webm", "ru-RU")
        self.assertIn(b'name="language"\r\n\r\nru\r\n', seen["body"])

    def test_errors(self):
        self.stt.set_key("gsk_k")
        for status, code in ((401, "bad-key"), (429, "rate"), (500, "failed")):
            def fake(req, timeout, status=status):
                raise urllib.error.HTTPError(req.full_url, status, "x", {}, None)
            with mock.patch("app.stt._OPENER.open", fake), self.assertRaises(SttError) as cm:
                self.stt.transcribe(b"A", "audio/webm")
            self.assertEqual(cm.exception.code, code)


if __name__ == "__main__":
    unittest.main()
