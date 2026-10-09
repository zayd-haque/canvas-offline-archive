"""[Codex] Windows OCR routing and bounded PDF raster regressions."""

import tests

import json
import subprocess
import sys
import types
import unittest
from unittest.mock import patch

from canvas_app import ocr, ocr_windows


class WindowsOCRTests(unittest.TestCase):
    def test_windows_capability_and_batch_use_local_helper(self):
        output = b'{"page":1,"text":"Recovered from scan"}\n'
        with patch.object(ocr.sys, 'platform', 'win32'), \
             patch.object(ocr, '_windows_available', return_value=True), \
             patch.object(ocr.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, output)) as run:
            self.assertEqual(ocr.capability()['engine'], 'windows-ocr')
            pages, warning = ocr._recognize_batch('scan.pdf', [1])
            self.assertEqual(ocr.cache_version(), 'windows-ocr-v1:1:1')
        self.assertEqual(pages, {1: 'Recovered from scan'})
        self.assertIsNone(warning)
        command = run.call_args.args[0]
        self.assertEqual(command[:2], [sys.executable, str(ocr_windows.__file__)])
        self.assertEqual(command[-2:], ['scan.pdf', '1'])

    def test_render_caps_page_size_and_uses_bgra(self):
        bitmap = types.SimpleNamespace(width=1224, height=1584, stride=4896, close=lambda: None)
        page = types.SimpleNamespace(get_size=lambda: (612, 792), close=lambda: None)
        calls = []
        page.render = lambda **kwargs: (calls.append(kwargs), bitmap)[1]
        pdfium = types.SimpleNamespace(raw=types.SimpleNamespace(FPDFBitmap_BGRA=4))
        with patch.dict(sys.modules, {'pypdfium2': pdfium}):
            result = ocr_windows.render_page([page], 1, 2048)
        self.assertIs(result, bitmap)
        self.assertEqual(calls, [{'scale': 2.0, 'force_bitmap_format': 4}])

    def test_page_failure_is_reported_without_aborting_batch(self):
        class Engine:
            async def recognize_async(self, image):
                return types.SimpleNamespace(text='Indexed page')

        engine = Engine()
        engine_class = types.SimpleNamespace(
            max_image_dimension=2048,
            try_create_from_user_profile_languages=lambda: engine)
        class Document(list):
            def close(self):
                pass

        closable = types.SimpleNamespace(close=lambda: None)
        pdfium = types.SimpleNamespace(PdfDocument=lambda path: Document([object(), object()]))
        modules = {'pypdfium2': pdfium,
                   'winrt.windows.media.ocr': types.SimpleNamespace(OcrEngine=engine_class)}
        records = []
        with patch.dict(sys.modules, modules), \
             patch.object(ocr_windows, 'render_page', side_effect=[ValueError('bad page'), closable]), \
             patch.object(ocr_windows, 'software_bitmap', return_value=closable), \
             patch('builtins.print', side_effect=lambda value, **kwargs: records.append(json.loads(value))):
            import asyncio
            asyncio.run(ocr_windows.recognize('scan.pdf', [1, 2]))
        self.assertEqual(records[0]['error'], 'ValueError')
        self.assertEqual(records[1]['text'], 'Indexed page')


if __name__ == '__main__':
    unittest.main()
