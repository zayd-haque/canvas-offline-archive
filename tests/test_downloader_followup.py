"""[Codex] Browser cookie scope and immutable recovery regressions; synthetic only."""
import tests
import ast
import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

import requests

SOURCE = Path(__file__).resolve().parents[1] / 'Canvas Module Downloader'
if str(SOURCE) not in sys.path:
    sys.path.insert(0, str(SOURCE))
import downloader
import organizer
import safety
import sorter
import canvas_blueprint


class DownloaderFollowupTests(unittest.TestCase):
    def test_identical_download_bytes_reused_across_urls(self):
        class Response:
            status_code = 200
            headers = {"Content-Disposition": 'attachment; filename="notes.pdf"'}
            url = "https://canvas.example/files/1/download"
            def __init__(self, data): self.data = data
            def iter_content(self, chunk_size): yield self.data
            def close(self): pass
        with tempfile.TemporaryDirectory() as root:
            with patch.object(downloader, "_https_response", side_effect=[
                    Response(b"same PDF"), Response(b"same PDF"), Response(b"changed PDF")]):
                first = downloader.download_file(None, "https://canvas.example/files/1", "Notes", root)
                alias = downloader.download_file(None, "https://canvas.example/files/1/download", "Download", root)
                changed = downloader.download_file(None, "https://canvas.example/files/2", "Notes", root)
            self.assertEqual(first, alias)
            self.assertNotEqual(first, changed)
            self.assertEqual(len(list(Path(root).iterdir())), 2)

    def test_cookie_host_domain_path_expiry_and_secure_scope(self):
        cookies = [
            {'name': 'host', 'value': 'dummy', 'domain': 'canvas.example', 'path': '/private', 'secure': True},
            {'name': 'domain', 'value': 'dummy', 'domain': '.canvas.example', 'path': '/', 'secure': True},
            {'name': 'expired', 'value': 'dummy', 'domain': 'canvas.example', 'path': '/', 'expires': 1},
        ]
        session = downloader.create_session(cookies=cookies)
        self.addCleanup(session.close)
        def header(url):
            return session.prepare_request(requests.Request('GET', url)).headers.get('Cookie', '')
        self.assertIn('host=dummy', header('https://canvas.example/private/file'))
        self.assertNotIn('host=', header('https://child.canvas.example/private/file'))
        self.assertIn('domain=dummy', header('https://child.canvas.example/private/file'))
        self.assertNotIn('host=', header('https://canvas.example/private-other'))
        self.assertNotIn('expired=', header('https://canvas.example/private/file'))
        self.assertEqual(header('http://canvas.example/private/file'), '')
        self.assertEqual(header('https://other.example/private/file'), '')

    def test_redirect_preparation_does_not_forward_host_cookie(self):
        seen = []
        class Adapter(requests.adapters.BaseAdapter):
            def send(self, request, **kwargs):
                seen.append(request)
                response = requests.Response()
                response.request = request
                response.url = request.url
                response._content = b''
                response._content_consumed = True
                response.status_code = 302 if len(seen) == 1 else 200
                if len(seen) == 1:
                    response.headers['Location'] = 'https://child.canvas.example/file'
                return response
            def close(self):
                pass
        session = downloader.create_session(cookies=[{'name': 'host', 'value': 'dummy', 'domain': 'canvas.example', 'secure': True}])
        self.addCleanup(session.close)
        session.mount('https://', Adapter())
        response = downloader._https_response(session, 'https://canvas.example/file')
        self.addCleanup(response.close)
        self.assertEqual(len(seen), 2)
        self.assertIn('host=dummy', seen[0].headers.get('Cookie', ''))
        self.assertNotIn('host=', seen[1].headers.get('Cookie', ''))

    def test_sorter_ignores_recovery_and_hidden_trees(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'DEMO'
            root.mkdir()
            hidden = root / '.reclassification-backup' / 'run-previous' / 'Lectures'
            hidden.mkdir(parents=True)
            for i in range(35):
                (hidden / f'lecture-{i}.pdf').write_bytes(b'synthetic')
            with patch.object(sorter, 'query_llm') as llm, contextlib.redirect_stdout(io.StringIO()):
                sorter.sort_gigantic_folders(str(root), 'DEMO', {'llm_provider': 'gemini'})
            llm.assert_not_called()
            self.assertEqual(len(list(hidden.glob('lecture-*.pdf'))), 35)
            self.assertFalse((hidden / 'Lecture Decks & Presentations').exists())

    def test_reclassification_keeps_each_run_manifest_and_original(self):
        # Load only the function: importing the CLI would start caffeinate.
        tree = ast.parse((SOURCE / 'main.py').read_text())
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'run_local_reclassify')
        namespace = {'os': os, 'CONFIG_PATH': 'unused-synthetic-config'}
        for name in ('resolve_course_root', 'validate_tree', 'contained_path', 'unique_destination', 'atomic_json', 'move_unique'):
            namespace[name] = getattr(safety, name)
        exec(compile(ast.Module(body=[function], type_ignores=[]), 'main.py', 'exec'), namespace)
        class Blueprint:
            file_path_map = {}
            def scan_course_directory(self, *args):
                pass
            def save(self, *args, **kwargs):
                pass
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'DEMO'
            root.mkdir()
            (root / 'canvas_course.json').write_text('{}')
            def organize(out, *args):
                shutil.rmtree(Path(out) / '.temp_downloads')
            with patch.object(organizer, 'organize', organize), patch.object(canvas_blueprint.CourseBlueprint, 'load', return_value=Blueprint()):
                for value in ('first version', 'second version'):
                    (root / 'essay.txt').write_text(value)
                    namespace['run_local_reclassify'](str(root), 'DEMO')
            runs = list((root / '.reclassification-backup').glob('run-*'))
            self.assertEqual(len(runs), 2)
            recovered = set()
            for run in runs:
                mapping = json.loads((run / 'recovery-manifest.json').read_text())
                self.assertEqual(set(mapping), {'essay.txt'})
                recovered.add((run / mapping['essay.txt']).read_text())
            self.assertEqual(recovered, {'first version', 'second version'})


    def test_work_directory_uses_course_root_for_compact_and_nested_layouts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'DEMO'
            nested = root / 'DEMO Lectures & Resources'
            nested.mkdir(parents=True)
            config = {'disk_hierarchy': {'work_folder': '{course} Work'}}
            for output in (root, nested):
                for resolver in (organizer.get_work_dir, sorter._get_work_dir):
                    self.assertEqual(Path(resolver(config, 'DEMO', str(output))), root.resolve() / 'DEMO Work')
