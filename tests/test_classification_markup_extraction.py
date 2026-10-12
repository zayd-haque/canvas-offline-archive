"""[Codex] Preserve useful identity evidence in bounded HTML/EPUB excerpts."""
import tests  # Required deterministic randomizer hook
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "Canvas Module Downloader"))
import organizer


class TestClassificationMarkupExtraction(unittest.TestCase):
    def setUp(self):
        self.workspace = tempfile.TemporaryDirectory()
        self.addCleanup(self.workspace.cleanup)
        self.root = Path(self.workspace.name)

    def html(self, text):
        path = self.root / "document.html"
        path.write_text(text, encoding="utf-8")
        return str(path)

    def epub(self, entries):
        path = self.root / "reader.epub"
        with zipfile.ZipFile(path, "w") as archive:
            for name, text in entries.items():
                archive.writestr(name, text)
        return str(path)

    def test_html_block_boundaries_and_inline_entities(self):
        text = organizer._html_classification_text(self.html(
            "<h1>Discussion Worksheet</h1><p>Explain <b>why</b> A &amp; B interact.</p>"
            "<p>Compare two examples.<br>Give evidence.</p>"))
        self.assertEqual(text.splitlines(), ["Discussion Worksheet", "Explain why A & B interact.",
                                            "Compare two examples.", "Give evidence."])

    def test_html_hidden_text_never_becomes_classification_evidence(self):
        text = organizer._html_classification_text(self.html(
            "<script>Final Exam Answer Key</script><style>Homework Solutions</style>"
            "<h1>Lecture Notes</h1><p>Visible explanation.</p>"))
        self.assertNotIn("Answer", text)
        self.assertNotIn("Homework", text)
        self.assertIn("Visible explanation.", text)

    def test_html_truncated_hidden_element_is_suppressed(self):
        for tag in ("script", "style"):
            with self.subTest(tag=tag):
                text = organizer._html_classification_text(self.html(
                    "<h1>Lecture</h1><" + tag + ">" + "Final Exam Answer Key " * 100), max_chars=80)
                self.assertNotIn("Answer", text)
                self.assertEqual(text, "Lecture")

    def test_html_raw_read_and_output_are_bounded(self):
        path = self.html("<p>" + "visible " * 1000 + "</p>")
        requests = []
        class RecordingReader(io.BytesIO):
            def read(self, size=-1):
                requests.append(size)
                return super().read(size)
        with patch("builtins.open", return_value=RecordingReader(Path(path).read_bytes())):
            text = organizer._html_classification_text(path, max_chars=40)
        self.assertTrue(requests)
        self.assertTrue(all(0 < size <= 256 * 1024 for size in requests))
        self.assertLessEqual(len(text), 40)

    def test_epub_spine_precedes_filename_order_and_excludes_unlisted_html(self):
        path = self.epub({
            "META-INF/container.xml": '<container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>',
            "OPS/package.opf": '<package><manifest><item id="one" href="z.xhtml" media-type="application/xhtml+xml"/>'
                               '<item id="two" href="a.xhtml" media-type="application/xhtml+xml"/></manifest>'
                               '<spine><itemref idref="one"/><itemref idref="two"/></spine></package>',
            "OPS/a.xhtml": "<p>Second chapter.</p>",
            "OPS/z.xhtml": "<h1>First chapter.</h1>",
            "OPS/000-navigation.xhtml": "<p>Unlisted navigation clutter.</p>",
        })
        text = organizer._epub_classification_text(path)
        self.assertLess(text.index("First chapter."), text.index("Second chapter."))
        self.assertNotIn("clutter", text)

    def test_epub_entities_and_hidden_content(self):
        path = self.epub({"chapter.xhtml": "<h1>Reading &amp; Discussion</h1>"
                         "<script>Exam Answer Key</script><style>Solutions</style><p>A&#160;B</p>"})
        text = organizer._epub_classification_text(path)
        self.assertIn("Reading & Discussion", text)
        self.assertIn("A B", text)
        self.assertNotIn("Exam", text)
        self.assertNotIn("Solutions", text)

    def test_epub_excerpt_does_not_read_entire_large_member(self):
        path = self.epub({"chapter.xhtml": "<p>Reading introduction.</p>" + "paragraph " * 200000})
        sizes = []
        original = zipfile.ZipExtFile.read
        def recording(source, size=-1):
            sizes.append(size)
            return original(source, size)
        with patch.object(zipfile.ZipExtFile, "read", recording):
            text = organizer._epub_classification_text(path, max_chars=100)
        self.assertLessEqual(len(text), 100)
        self.assertTrue(sizes)
        self.assertTrue(all(0 < size <= 256 * 1024 for size in sizes))

    def test_external_entity_declarations_are_not_processed(self):
        document = '<!DOCTYPE html [<!ENTITY x SYSTEM "file:///private/secret">]><p>&x;</p>'
        self.assertEqual(organizer._html_classification_text(self.html(document)), "")
        self.assertEqual(organizer._epub_classification_text(self.epub({"chapter.xhtml": document})), "")

    def test_epub_spine_rejects_external_and_traversing_hrefs(self):
        path = self.epub({
            "META-INF/container.xml": '<container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>',
            "OPS/package.opf": '<package><manifest>'
                '<item id="valid" href="chapter.xhtml" media-type="application/xhtml+xml"/>'
                '<item id="outside" href="../../escape.xhtml" media-type="application/xhtml+xml"/>'
                '<item id="remote" href="https://example.invalid/exam.xhtml" media-type="application/xhtml+xml"/>'
                '</manifest><spine><itemref idref="outside"/><itemref idref="remote"/>'
                '<itemref idref="valid"/></spine></package>',
            "OPS/chapter.xhtml": "<p>Assigned reading.</p>",
            "../escape.xhtml": "<p>External Answer Key.</p>",
        })
        text = organizer._epub_classification_text(path)
        self.assertIn("Assigned reading.", text)
        self.assertNotIn("External", text)
