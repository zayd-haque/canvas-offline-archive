"""[Codex] PDF worker text survives Windows legacy parent encoding."""
import tests
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


class PdfWorkerEncodingTests(unittest.TestCase):
    def test_unicode_worker_output_with_legacy_parent_encoding(self):
        source = Path(__file__).resolve().parents[1] / 'Canvas Module Downloader' / 'safety.py'
        spec = importlib.util.spec_from_file_location('pdf_encoding_safety', source)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            # Real child process; a small parser stand-in isolates transport encoding.
            Path(directory, 'pypdf.py').write_text(
                "class Page:\n def extract_text(self): return 'Chemistry \\u0081 \\u03b1'\n"
                "class PdfReader:\n def __init__(self, path): self.pages=[Page()]\n",
                encoding='utf-8',
            )
            with patch.dict(os.environ, {'PYTHONPATH': directory, 'PYTHONIOENCODING': 'utf-8'}), \
                    patch('subprocess._text_encoding', return_value='cp1252'):
                text = module.bounded_pdf_text(Path(directory, 'fixture.pdf'))
            self.assertIn('Chemistry \u0081 \u03b1', text)
