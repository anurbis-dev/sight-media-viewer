"""app/review.py build_pdf_all / build_zip_all: a sequence's clips in one PDF / one ZIP."""

import base64
import io
import tempfile
import unittest
import zipfile
from pathlib import Path

from PIL import Image

from app import review


def jpeg_url(color):
    buf = io.BytesIO()
    Image.new("RGB", (64, 36), color).save(buf, "JPEG")
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def report(name, n):
    return {
        "asset_id": name, "title": f"Review — {name}", "footer": "Sight test",
        "notes": [{"num": i + 1, "text": f"{name} note {i + 1}", "status": "open", "frame": jpeg_url("red"),
                   "frameFile": f"{name} f{i}.jpg", "frameText": "pic text" if i == 0 else "", "shots": [], "more": []}
                  for i in range(n)],
    }


class ReviewAllTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())

    def test_pdf_all(self):
        import pymupdf
        out = self.dir / "all.pdf"
        pages = review.build_pdf_all([report("a.mp4", 1), report("b.mp4", 2)], self.dir, out, "Review — a, b")
        self.assertGreaterEqual(pages, 2)   # each clip starts on its own page
        with pymupdf.open(str(out)) as d:
            self.assertEqual(d.page_count, pages)
            text = [p.get_text() for p in d]
        self.assertIn("Review — a.mp4", text[0])
        self.assertIn(f"1 / {pages}", text[0])
        self.assertTrue(any("Review — b.mp4" in t for t in text[1:]))
        self.assertIn(f"{pages} / {pages}", text[-1])   # numbered through, not per clip

    def test_zip_all(self):
        out = self.dir / "all.zip"
        notes, pics = review.build_zip_all([report("a", 1), report("b", 2)], self.dir, out, ["clip a.mp4", "clip b.mp4"])
        self.assertEqual((notes, pics), (3, 3))
        names = zipfile.ZipFile(out).namelist()
        self.assertIn("01 clip a/Note 01/Note 01.txt", names)
        self.assertIn("02 clip b/Note 02/Note 02.txt", names)
        self.assertTrue(any(n.startswith("02 clip b/Note 01/") and n.endswith(".jpg") for n in names))

    def test_zip_single_unchanged(self):
        out = self.dir / "one.zip"
        self.assertEqual(review.build_zip(report("a", 2), self.dir, out, "a.mp4"), (2, 2))
        names = zipfile.ZipFile(out).namelist()
        self.assertIn("Note 01/Note 01.txt", names)


if __name__ == "__main__":
    unittest.main()
